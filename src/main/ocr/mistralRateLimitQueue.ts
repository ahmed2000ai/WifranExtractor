import { loadEnvConfig } from '../config/env'
import { warn } from '../logging/logger'

export type MistralRequestKind =
  | 'page_offer_extraction'
  | 'page_offer_retry'
  | 'item_extraction'
  | 'style_profile'
  | 'item_validation'
  | 'document_ocr'
  | 'other';

export type MistralQueuedRequestMetadata = {
  kind: MistralRequestKind;
  label?: string;
  pageNumber?: number | null;
  itemNumber?: string | null;
  estimatedTokens?: number | null;
};

export type MistralQueueProgress = {
  queued: number;
  running: number;
  completedByKind: Record<string, number>;
  failedByKind: Record<string, number>;
  waitingMs: number;
  waitReason: 'min_interval' | 'rpm_limit' | 'tpm_limit' | 'retry_after' | 'none';
};

class MistralRateLimitQueue {
  private queue: Array<() => Promise<void>> = [];
  private isProcessing = false;

  private lastRequestAt = 0;
  private retryAfterUntil = 0;

  public progress: MistralQueueProgress = {
    queued: 0,
    running: 0,
    completedByKind: {},
    failedByKind: {},
    waitingMs: 0,
    waitReason: 'none'
  };

  private getConfig() {
    loadEnvConfig(); // ensures env is loaded
    return {
      maxConcurrent: parseInt(process.env.MISTRAL_MAX_CONCURRENT_REQUESTS || '1', 10),
      minRequestIntervalMs: parseInt(process.env.MISTRAL_MIN_REQUEST_INTERVAL_MS || '1100', 10),
    };
  }

  public async runWithMistralRateLimit<T>(
    metadata: MistralQueuedRequestMetadata,
    fn: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.progress.queued++;
      
      const task = async () => {
        this.progress.queued--;
        this.progress.running++;
        
        try {
          await this.enforceRateLimits(metadata.kind);
          
          let attempt = 0;
          const isPageOcr = metadata.kind === 'page_offer_extraction' || metadata.kind === 'page_offer_retry';
          const maxRetries = isPageOcr ? 3 : 5;

          while (attempt < maxRetries) {
            attempt++;
            try {
              const result = await fn();
              this.lastRequestAt = Date.now();
              this.recordSuccess(metadata.kind);
              resolve(result);
              return;
            } catch (err: any) {
              const status = err.status || err.statusCode;
              if (status === 429) {
                const diagMessage = extractAndFormatMistral429Diagnostics({
                  err,
                  requestKind: metadata.kind,
                  pageNumber: metadata.pageNumber,
                  attempt
                });
                warn(diagMessage);

                const retryAfter = err.headers?.get?.('retry-after') || err.retryAfter;
                const baseWait = retryAfter ? parseInt(retryAfter, 10) * 1000 : 15000;
                const waitMs = Math.min(baseWait * Math.pow(2, attempt - 1), 120000);
                
                this.retryAfterUntil = Date.now() + waitMs;
                this.progress.waitReason = 'retry_after';
                this.progress.waitingMs = waitMs;
                
                warn(`Mistral 429 Rate Limited. Kind: ${metadata.kind}. Waiting ${waitMs}ms...`);
                await new Promise(r => setTimeout(r, waitMs));
                this.progress.waitReason = 'none';
                this.progress.waitingMs = 0;
                continue;
              }

              // Normal error, if we exhausted retries or it's not a retryable error, throw
              if (attempt >= maxRetries) {
                warn(`Mistral request failed after ${maxRetries} retries. Kind=${metadata.kind}, item=${metadata.itemNumber || 'none'}. Error: ${err.message}`);
                throw err;
              }

              // Transient 5xx retry logic
              if (err.status >= 500) {
                await new Promise(r => setTimeout(r, 5000 * attempt));
                continue;
              }

              throw err;
            }
          }
        } catch (finalErr) {
          this.recordFailure(metadata.kind);
          reject(finalErr);
        } finally {
          this.progress.running--;
          // Start next in queue
          setTimeout(() => this.processNext(), 0);
        }
      };

      this.queue.push(task);
      this.processNext();
    });
  }

  private async enforceRateLimits(kind?: MistralRequestKind) {
    const config = this.getConfig();
    const now = Date.now();
    let waitMs = 0;
    let reason: MistralQueueProgress['waitReason'] = 'none';

    // Check Retry-After
    if (this.retryAfterUntil > now) {
      waitMs = this.retryAfterUntil - now;
      reason = 'retry_after';
    } else {
      // Global min request interval (5000ms for page-first requests)
      const minInterval = (kind === 'page_offer_extraction' || kind === 'page_offer_retry')
        ? Math.max(5000, config.minRequestIntervalMs)
        : config.minRequestIntervalMs;

      const timeSinceLast = now - this.lastRequestAt;
      if (timeSinceLast < minInterval) {
        waitMs = minInterval - timeSinceLast;
        reason = 'min_interval';
      }
    }

    if (waitMs > 0) {
      this.progress.waitReason = reason;
      this.progress.waitingMs = waitMs;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.progress.waitReason = 'none';
      this.progress.waitingMs = 0;
    }
  }

  private processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    // By default, maxConcurrent = 1
    const config = this.getConfig();
    if (this.progress.running >= config.maxConcurrent) {
      return;
    }

    this.isProcessing = true;
    const task = this.queue.shift();
    if (task) {
      task().finally(() => {
        this.isProcessing = false;
        this.processNext();
      });
    } else {
      this.isProcessing = false;
    }
  }

  private recordSuccess(kind: MistralRequestKind) {
    this.progress.completedByKind[kind] = (this.progress.completedByKind[kind] || 0) + 1;
  }

  private recordFailure(kind: MistralRequestKind) {
    this.progress.failedByKind[kind] = (this.progress.failedByKind[kind] || 0) + 1;
  }

  public getQueueSummary() {
    const totalRequests = Object.values(this.progress.completedByKind).reduce((a, b) => a + b, 0)
      + Object.values(this.progress.failedByKind).reduce((a, b) => a + b, 0);
    return {
      total_mistral_requests: totalRequests,
      total_queue_wait_ms: 0,
      completed_by_kind: { ...this.progress.completedByKind },
      failed_by_kind: { ...this.progress.failedByKind },
      retry_after_count: 0,
      rate_limit_429_count: 0
    };
  }
}

function redactSensitiveString(str: string): string {
  if (!str) return str;
  let result = str;

  const mistralKey = process.env.MISTRAL_API_KEY;
  if (mistralKey && mistralKey.length > 5) {
    result = result.split(mistralKey).join('[REDACTED_API_KEY]');
  }
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseKey && supabaseKey.length > 5) {
    result = result.split(supabaseKey).join('[REDACTED_SECRET]');
  }
  const supabaseAnon = process.env.SUPABASE_ANON_KEY;
  if (supabaseAnon && supabaseAnon.length > 5) {
    result = result.split(supabaseAnon).join('[REDACTED_SECRET]');
  }

  result = result.replace(/mstrl_[a-zA-Z0-9_-]+/g, '[REDACTED_API_KEY]');
  result = result.replace(/(authorization\s*[:=]\s*['"]?)(?:Bearer\s+)?[^'",\s}]+/gi, '$1[REDACTED]');
  result = result.replace(/(Bearer\s+)[a-zA-Z0-9._-]+/gi, '$1[REDACTED]');
  result = result.replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/gi, '[REDACTED_BASE64_IMAGE]');
  result = result.replace(/(?:[A-Za-z0-9+/]{4}){16,}={0,2}/g, '[REDACTED_BASE64]');

  return result;
}

function sanitizeObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return typeof obj === 'string' ? redactSensitiveString(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sensitiveKeyRegex = /^(authorization|api[-_]?key|key|secret|token|password|image|image[-_]?url|image[-_]?data|image[-_]?base64|base64)$/i;
  const result: Record<string, any> = {};

  for (const [k, v] of Object.entries(obj)) {
    if (sensitiveKeyRegex.test(k)) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'string') {
      result[k] = redactSensitiveString(v);
    } else if (typeof v === 'object' && v !== null) {
      result[k] = sanitizeObject(v);
    } else {
      result[k] = v;
    }
  }

  return result;
}

export function sanitizeMistral429Body(rawBody: unknown): string {
  if (rawBody === undefined || rawBody === null) {
    return 'none';
  }

  if (typeof rawBody === 'object') {
    try {
      const sanitized = sanitizeObject(rawBody);
      return redactSensitiveString(JSON.stringify(sanitized));
    } catch {
      return 'unparseable_object';
    }
  }

  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (!trimmed) return 'none';

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        const sanitized = sanitizeObject(parsed);
        return redactSensitiveString(JSON.stringify(sanitized));
      }
    } catch {
      // Not JSON, treat as plain text
    }

    const sanitized = redactSensitiveString(trimmed);
    return sanitized.length > 1000 ? sanitized.substring(0, 1000) + '...[truncated]' : sanitized;
  }

  return redactSensitiveString(String(rawBody));
}

function extractHeader(err: any, headerNames: string[]): string | null {
  const headers = err?.headers || err?.rawResponse?.headers || err?.response?.headers;
  if (!headers) return null;

  for (const name of headerNames) {
    if (typeof headers.get === 'function') {
      const val = headers.get(name) ?? headers.get(name.toLowerCase());
      if (val !== null && val !== undefined && val !== '') return String(val);
    } else if (headers instanceof Map) {
      for (const [k, v] of headers.entries()) {
        if (String(k).toLowerCase() === name.toLowerCase() && v !== null && v !== undefined && v !== '') {
          return String(v);
        }
      }
    } else if (typeof headers === 'object') {
      const foundKey = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
      if (foundKey && headers[foundKey] !== undefined && headers[foundKey] !== null && headers[foundKey] !== '') {
        return String(headers[foundKey]);
      }
    }
  }
  return null;
}

export type Mistral429DiagnosticParams = {
  status: number | string;
  requestKind: string;
  page?: number | null;
  attempt: number;
  retryAfter?: string | null;
  rateLimitLimit?: string | null;
  rateLimitRemaining?: string | null;
  rateLimitReset?: string | null;
  body?: unknown;
};

export function formatMistral429Diagnostics(params: Mistral429DiagnosticParams): string {
  const pageStr = params.page !== undefined && params.page !== null ? String(params.page) : 'none';
  const retryAfterStr = params.retryAfter ?? 'none';
  const limitStr = params.rateLimitLimit ?? 'none';
  const remainingStr = params.rateLimitRemaining ?? 'none';
  const resetStr = params.rateLimitReset ?? 'none';
  const bodyStr = sanitizeMistral429Body(params.body);

  return [
    '[MISTRAL_429]',
    `status=${params.status}`,
    `requestKind=${params.requestKind}`,
    `page=${pageStr}`,
    `attempt=${params.attempt}`,
    `retryAfter=${retryAfterStr}`,
    `rateLimitLimit=${limitStr}`,
    `rateLimitRemaining=${remainingStr}`,
    `rateLimitReset=${resetStr}`,
    `body=${bodyStr}`
  ].join('\n');
}

export function extractAndFormatMistral429Diagnostics(opts: {
  err: any;
  requestKind: string;
  pageNumber?: number | null;
  attempt: number;
}): string {
  const { err, requestKind, pageNumber, attempt } = opts;
  const status = err?.status || err?.statusCode || 429;
  const retryAfter = extractHeader(err, ['retry-after', 'Retry-After']) || (err?.retryAfter ? String(err.retryAfter) : null);

  const directLimit = extractHeader(err, ['x-ratelimit-limit', 'X-RateLimit-Limit']);
  const reqMinLimit = extractHeader(err, ['x-ratelimit-limit-req-minute']);
  const tokensMinLimit = extractHeader(err, ['x-ratelimit-limit-tokens-minute']);
  let rateLimitLimit: string | null = directLimit;
  if (!rateLimitLimit && (reqMinLimit || tokensMinLimit)) {
    rateLimitLimit = [
      reqMinLimit ? `${reqMinLimit} (req/min)` : null,
      tokensMinLimit ? `${tokensMinLimit} (tokens/min)` : null
    ].filter(Boolean).join(', ');
  }

  const directRem = extractHeader(err, ['x-ratelimit-remaining', 'X-RateLimit-Remaining']);
  const reqMinRem = extractHeader(err, ['x-ratelimit-remaining-req-minute']);
  const tokensMinRem = extractHeader(err, ['x-ratelimit-remaining-tokens-minute']);
  let rateLimitRemaining: string | null = directRem;
  if (!rateLimitRemaining && (reqMinRem || tokensMinRem)) {
    rateLimitRemaining = [
      reqMinRem ? `${reqMinRem} (req/min)` : null,
      tokensMinRem ? `${tokensMinRem} (tokens/min)` : null
    ].filter(Boolean).join(', ');
  }

  const directReset = extractHeader(err, ['x-ratelimit-reset', 'X-RateLimit-Reset']);
  const reqMinReset = extractHeader(err, ['x-ratelimit-reset-req-minute']);
  const tokensMinReset = extractHeader(err, ['x-ratelimit-reset-tokens-minute']);
  let rateLimitReset: string | null = directReset;
  if (!rateLimitReset && (reqMinReset || tokensMinReset)) {
    rateLimitReset = [
      reqMinReset ? `${reqMinReset} (req/min)` : null,
      tokensMinReset ? `${tokensMinReset} (tokens/min)` : null
    ].filter(Boolean).join(', ');
  }

  const body = err?.body ?? err?.response?.data ?? err?.data ?? err?.message;

  return formatMistral429Diagnostics({
    status,
    requestKind,
    page: pageNumber,
    attempt,
    retryAfter,
    rateLimitLimit,
    rateLimitRemaining,
    rateLimitReset,
    body
  });
}

export const sharedMistralRateLimitQueue = new MistralRateLimitQueue();
export const mistralRateLimitQueue = sharedMistralRateLimitQueue;

export function runWithMistralRateLimit<T>(
  metadata: MistralQueuedRequestMetadata,
  fn: () => Promise<T>
): Promise<T> {
  return sharedMistralRateLimitQueue.runWithMistralRateLimit(metadata, fn);
}

// Ensure future chunks know how to call:
// runWithMistralRateLimit({ kind: 'style_profile', pageNumber }, () => callMistral(...));
// runWithMistralRateLimit({ kind: 'item_validation', pageNumber, itemNumber }, () => callMistral(...));
