import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sharedMistralRateLimitQueue,
  mistralRateLimitQueue,
  formatMistral429Diagnostics,
  extractAndFormatMistral429Diagnostics,
  sanitizeMistral429Body
} from '../mistralRateLimitQueue';

describe('MistralRateLimitQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset queue state for tests
    (sharedMistralRateLimitQueue as any).queue = [];
    (sharedMistralRateLimitQueue as any).isProcessing = false;
    (sharedMistralRateLimitQueue as any).lastRequestAt = 0;
    (sharedMistralRateLimitQueue as any).retryAfterUntil = 0;
    sharedMistralRateLimitQueue.progress = {
      queued: 0,
      running: 0,
      completedByKind: {},
      failedByKind: {},
      waitingMs: 0,
      waitReason: 'none'
    };
    
    process.env.MISTRAL_MIN_REQUEST_INTERVAL_MS = '1000';
    process.env.MISTRAL_MAX_CONCURRENT_REQUESTS = '1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MISTRAL_MIN_REQUEST_INTERVAL_MS;
    delete process.env.MISTRAL_MAX_CONCURRENT_REQUESTS;
  });

  it('runs one request at a time by default and enforces minimum delay', async () => {
    const fn1 = vi.fn().mockResolvedValue('res1');
    const fn2 = vi.fn().mockResolvedValue('res2');

    const p1 = sharedMistralRateLimitQueue.runWithMistralRateLimit({ kind: 'item_extraction' }, fn1);
    const p2 = sharedMistralRateLimitQueue.runWithMistralRateLimit({ kind: 'item_validation' }, fn2);

    expect(sharedMistralRateLimitQueue.progress.queued).toBe(1);
    expect(sharedMistralRateLimitQueue.progress.running).toBe(1);

    // fn1 runs immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled();

    // After fn1 finishes, queue waits for interval
    await vi.advanceTimersByTimeAsync(500);
    expect(fn2).not.toHaveBeenCalled(); // 1000ms not yet passed

    await vi.advanceTimersByTimeAsync(500);
    expect(fn2).toHaveBeenCalledTimes(1); // 1000ms passed

    const res1 = await p1;
    const res2 = await p2;
    expect(res1).toBe('res1');
    expect(res2).toBe('res2');
    
    expect(sharedMistralRateLimitQueue.progress.completedByKind['item_extraction']).toBe(1);
    expect(sharedMistralRateLimitQueue.progress.completedByKind['item_validation']).toBe(1);
  });

  it('respects global Retry-After on 429 response', async () => {
    let attempt = 0;
    const fn1 = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt === 1) {
        const err = new Error('Rate Limited') as any;
        err.status = 429;
        err.headers = new Map([['retry-after', '2']]); // 2 seconds
        throw err;
      }
      return 'success1';
    });
    
    const fn2 = vi.fn().mockResolvedValue('success2');

    const p1 = sharedMistralRateLimitQueue.runWithMistralRateLimit({ kind: 'style_profile' }, fn1);

    await vi.advanceTimersByTimeAsync(0);
    expect(fn1).toHaveBeenCalledTimes(1);
    
    // Attempt 1 threw 429. The queue reads retryAfter (2s) -> waitMs = 2000.
    // So we wait 2 seconds.
    expect(sharedMistralRateLimitQueue.progress.waitReason).toBe('retry_after');
    expect(sharedMistralRateLimitQueue.progress.waitingMs).toBeGreaterThan(0);

    const p2 = sharedMistralRateLimitQueue.runWithMistralRateLimit({ kind: 'item_extraction' }, fn2);

    // Advance 1s, fn1 should not retry yet
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn1).toHaveBeenCalledTimes(1);

    // Advance 1s, fn1 retries and succeeds
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn1).toHaveBeenCalledTimes(2);

    await p1; // Should resolve now

    // Now fn2 runs, but it must respect the 1s interval from fn1's success
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn2).toHaveBeenCalledTimes(1);

    await p2;
  });

  it('propagates thrown errors after max retries', async () => {
    const fn1 = vi.fn().mockImplementation(async () => {
      const err = new Error('Fatal') as any;
      err.status = 400; // Not a retryable error according to the generic logic
      throw err;
    });

    await expect(
      sharedMistralRateLimitQueue.runWithMistralRateLimit({ kind: 'other' }, fn1)
    ).rejects.toThrow('Fatal');

    expect(sharedMistralRateLimitQueue.progress.failedByKind['other']).toBe(1);
  });

  it('exports mistralRateLimitQueue alias and returns queue summary', () => {
    expect(mistralRateLimitQueue).toBe(sharedMistralRateLimitQueue);
    sharedMistralRateLimitQueue.progress.completedByKind['item_extraction'] = 3;
    sharedMistralRateLimitQueue.progress.failedByKind['item_validation'] = 1;

    const summary = mistralRateLimitQueue.getQueueSummary();
    expect(summary.total_mistral_requests).toBe(4);
    expect(summary.completed_by_kind['item_extraction']).toBe(3);
    expect(summary.failed_by_kind['item_validation']).toBe(1);
  });

  describe('HTTP 429 Diagnostics & Redaction', () => {
    it('formats 429 diagnostics with all required fields in the exact format', () => {
      const output = formatMistral429Diagnostics({
        status: 429,
        requestKind: 'page_offer_extraction',
        page: 1,
        attempt: 2,
        retryAfter: '60',
        rateLimitLimit: '0',
        rateLimitRemaining: '0',
        rateLimitReset: '30',
        body: { message: 'Rate limit exceeded' }
      });

      expect(output).toContain('[MISTRAL_429]');
      expect(output).toContain('status=429');
      expect(output).toContain('requestKind=page_offer_extraction');
      expect(output).toContain('page=1');
      expect(output).toContain('attempt=2');
      expect(output).toContain('retryAfter=60');
      expect(output).toContain('rateLimitLimit=0');
      expect(output).toContain('rateLimitRemaining=0');
      expect(output).toContain('rateLimitReset=30');
      expect(output).toContain('body={"message":"Rate limit exceeded"}');
    });

    it('extracts headers from error objects including Map and standard objects', () => {
      const err = {
        statusCode: 429,
        headers: new Map([
          ['retry-after', '15'],
          ['x-ratelimit-limit', '100'],
          ['x-ratelimit-remaining', '0'],
          ['x-ratelimit-reset', '45']
        ]),
        body: JSON.stringify({ error: 'Too Many Requests' })
      };

      const output = extractAndFormatMistral429Diagnostics({
        err,
        requestKind: 'item_extraction',
        pageNumber: 3,
        attempt: 1
      });

      expect(output).toContain('status=429');
      expect(output).toContain('requestKind=item_extraction');
      expect(output).toContain('page=3');
      expect(output).toContain('attempt=1');
      expect(output).toContain('retryAfter=15');
      expect(output).toContain('rateLimitLimit=100');
      expect(output).toContain('rateLimitRemaining=0');
      expect(output).toContain('rateLimitReset=45');
      expect(output).toContain('body={"error":"Too Many Requests"}');
    });

    it('handles fallback values when headers or page are absent', () => {
      const err = new Error('Unknown 429');
      (err as any).status = 429;

      const output = extractAndFormatMistral429Diagnostics({
        err,
        requestKind: 'other',
        pageNumber: null,
        attempt: 1
      });

      expect(output).toContain('[MISTRAL_429]');
      expect(output).toContain('status=429');
      expect(output).toContain('requestKind=other');
      expect(output).toContain('page=none');
      expect(output).toContain('attempt=1');
      expect(output).toContain('retryAfter=none');
      expect(output).toContain('rateLimitLimit=none');
      expect(output).toContain('rateLimitRemaining=none');
      expect(output).toContain('rateLimitReset=none');
      expect(output).toContain('body=Unknown 429');

      expect(sanitizeMistral429Body(null)).toBe('none');
      expect(sanitizeMistral429Body(undefined)).toBe('none');
      expect(sanitizeMistral429Body('')).toBe('none');
      expect(sanitizeMistral429Body('Plain rate limit error')).toBe('Plain rate limit error');
    });

    it('strictly redacts API keys, Authorization headers, and base64 image data', () => {
      process.env.MISTRAL_API_KEY = 'mstrl_super_secret_key_12345';
      const fakeBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

      const bodyWithSecrets = {
        message: 'Rate limit for key mstrl_super_secret_key_12345',
        authorization: 'Bearer secret_token_xyz',
        headers: {
          Authorization: 'Bearer my_auth_secret'
        },
        image: fakeBase64,
        nested: {
          apiKey: 'mstrl_another_key_99999'
        }
      };

      const output = formatMistral429Diagnostics({
        status: 429,
        requestKind: 'page_offer_extraction',
        page: 2,
        attempt: 1,
        body: bodyWithSecrets
      });

      expect(output).not.toContain('mstrl_super_secret_key_12345');
      expect(output).not.toContain('secret_token_xyz');
      expect(output).not.toContain('my_auth_secret');
      expect(output).not.toContain('mstrl_another_key_99999');
      expect(output).not.toContain(fakeBase64);
      expect(output).toContain('[REDACTED');
    });

    it('logs [MISTRAL_429] diagnostics to logger when runWithMistralRateLimit receives a 429', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let attempt = 0;
      const fn = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt === 1) {
          const err: any = new Error('Rate Limited');
          err.status = 429;
          err.headers = new Map([
            ['retry-after', '1'],
            ['x-ratelimit-limit-req-minute', '0'],
            ['x-ratelimit-remaining-req-minute', '0']
          ]);
          err.body = JSON.stringify({ object: 'error', message: 'Rate limit exceeded', code: '1300' });
          throw err;
        }
        return 'success';
      });

      const promise = sharedMistralRateLimitQueue.runWithMistralRateLimit(
        { kind: 'page_offer_extraction', pageNumber: 1 },
        fn
      );

      await vi.advanceTimersByTimeAsync(0);

      // Verify warn was called with [MISTRAL_429]
      const warnCalls = warnSpy.mock.calls.map(c => String(c[0]));
      const diagCall = warnCalls.find(msg => msg.includes('[MISTRAL_429]'));
      expect(diagCall).toBeDefined();
      expect(diagCall).toContain('status=429');
      expect(diagCall).toContain('requestKind=page_offer_extraction');
      expect(diagCall).toContain('page=1');
      expect(diagCall).toContain('attempt=1');
      expect(diagCall).toContain('rateLimitLimit=0 (req/min)');
      expect(diagCall).toContain('rateLimitRemaining=0 (req/min)');
      expect(diagCall).toContain('body={"object":"error","message":"Rate limit exceeded","code":"1300"}');

      // Let queue retry and finish
      await vi.advanceTimersByTimeAsync(1000);
      const res = await promise;
      expect(res).toBe('success');

      warnSpy.mockRestore();
    });
  });
});
