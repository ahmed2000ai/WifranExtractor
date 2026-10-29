export function isRetryableOcrError(error: any): boolean {
  if (!error) return false
  
  const msg = (error.message || '').toLowerCase()
  const code = error.status || error.code || error.statusCode

  // Direct status codes
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(code)) return true

  // String matching for fetch errors or network dropouts
  if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('socket hang up') || msg.includes('fetch failed')) {
    return true
  }

  // Not retryable: 400, 401, 403, schemas, file reading
  if ([400, 401, 403].includes(code)) return false
  if (msg.includes('missing_mistral_api_key')) return false
  if (msg.includes('ocr_file_read_error')) return false
  if (msg.includes('ocr_json_parse_error')) return false

  // Fallback, if it has a status code > 500
  if (typeof code === 'number' && code >= 500) return true

  return false
}

export function getRetryDelayMs(input: { attempt: number, baseDelayMs: number, retryAfterMs?: number | null }): number {
  let delay = 0
  if (input.retryAfterMs) {
    delay = input.retryAfterMs
  } else {
    // Exponential backoff: baseDelayMs * 2^(attempt - 1)
    delay = input.baseDelayMs * Math.pow(2, input.attempt - 1)
  }
  
  // Add jitter +/- 20%
  const jitter = delay * 0.2
  const randomizedDelay = delay - jitter + (Math.random() * (jitter * 2))
  
  return randomizedDelay
}

export async function runWithOcrRetry<T extends { usageInfo?: unknown; _rawTokens?: number; }>(input: {
  operation: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  queue?: import('./ocrRateLimitQueue').OcrRateLimitQueue,
  chunkId: string,
  pageCount: number,
  dense?: boolean,
  onRetry?: (event: { attempt: number; delayMs: number; error: unknown }) => void,
  onWait?: (info: import('./ocrRateLimitQueue').OcrRateLimitWaitInfo) => void
}): Promise<{ result: T, attempts: number }> {
  let attempt = 1
  let nextRetryAfterMs: number | null = null;

  while (true) {
    try {
      if (input.queue) {
        await input.queue.waitBeforeNextRequest({
          chunkId: input.chunkId,
          pageCount: input.pageCount,
          dense: input.dense,
          retryAfterMs: nextRetryAfterMs,
          onWait: input.onWait
        });
        nextRetryAfterMs = null; // Reset it after using it
      }

      const result = await input.operation()
      
      if (input.queue) {
        let actualTokens: number | null = null;
        if (result && typeof result === 'object') {
          actualTokens = result._rawTokens || null;
        }
        input.queue.recordUsage({
          chunkId: input.chunkId,
          estimatedTokens: input.dense ? 5000 * input.pageCount : 3000 * input.pageCount,
          actualTokens
        });
      }

      return { result, attempts: attempt }
    } catch (err: any) {
      if (attempt > input.maxRetries || !isRetryableOcrError(err)) {
        throw err
      }
      
      let retryAfterMs: number | null = null
      const headers = err.headers || err.response?.headers
      if (headers) {
        const retryAfterVal = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after']
        if (retryAfterVal) {
          const ra = parseInt(retryAfterVal, 10)
          if (!isNaN(ra)) {
            retryAfterMs = ra * 1000
          }
        }
      }

      if (!input.queue) {
        const delayMs = getRetryDelayMs({ attempt, baseDelayMs: input.baseDelayMs, retryAfterMs })
        
        if (input.onRetry) {
          input.onRetry({ attempt, delayMs, error: err })
        }

        await new Promise(resolve => setTimeout(resolve, delayMs))
      } else {
        nextRetryAfterMs = retryAfterMs;
        if (input.onRetry) {
          input.onRetry({ attempt, delayMs: retryAfterMs || 0, error: err })
        }
      }
      attempt++
    }
  }
}
