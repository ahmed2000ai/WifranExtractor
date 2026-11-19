/**
 * Centralized Offline UAT Network Isolation Guard (`WIFRAN_OFFLINE_UAT=1`).
 *
 * Ensures that even if `.env.local` contains live Gemini, Mistral, or Supabase credentials,
 * external network calls are blocked consistently across SDK factories, direct `fetch` calls,
 * Main-process global `fetch`, and Chromium `session.defaultSession.webRequest`.
 */

const ALLOWED_NON_HTTP_PROTOCOLS = new Set([
  'file:',
  'local-file:',
  'devtools:',
  'data:',
  'blob:',
  'chrome-extension:',
  'about:'
])

const ALLOWED_LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isOfflineUatMode(): boolean {
  return process.env.WIFRAN_OFFLINE_UAT === '1'
}

export function assertNotOfflineUat(operation: string): void {
  if (isOfflineUatMode()) {
    throw new Error(`OFFLINE_UAT_GUARD: ${operation} is strictly blocked in Offline UAT Mode.`)
  }
}

export function isAllowedLocalUrlInOfflineUat(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return false
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }

  if (ALLOWED_NON_HTTP_PROTOCOLS.has(parsed.protocol)) {
    return true
  }

  if (
    parsed.protocol === 'http:' ||
    parsed.protocol === 'https:' ||
    parsed.protocol === 'ws:' ||
    parsed.protocol === 'wss:'
  ) {
    const hostname = parsed.hostname.toLowerCase()
    return ALLOWED_LOCAL_HOSTNAMES.has(hostname)
  }

  return false
}

function extractFetchUrl(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (input && typeof input === 'object' && 'url' in input && typeof (input as any).url === 'string') {
    return (input as any).url
  }
  return String(input ?? '')
}

type GuardedFetchFn = typeof fetch & {
  __wifranOfflineUatGuarded?: boolean
  __wifranOriginalFetch?: typeof fetch
}

export function installOfflineUatFetchGuard(): void {
  if (!isOfflineUatMode() || typeof globalThis.fetch !== 'function') {
    return
  }

  const currentFetch = globalThis.fetch as GuardedFetchFn
  if (currentFetch.__wifranOfflineUatGuarded) {
    return
  }

  const originalFetch = currentFetch.bind(globalThis)
  const guardedFetch: GuardedFetchFn = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (isOfflineUatMode()) {
        const targetUrl = extractFetchUrl(input)
        if (!isAllowedLocalUrlInOfflineUat(targetUrl)) {
          throw new Error(
            `OFFLINE_UAT_GUARD: External HTTP request blocked in Offline UAT Mode (${targetUrl}).`
          )
        }
      }
      return originalFetch(input, init)
    },
    {
      __wifranOfflineUatGuarded: true,
      __wifranOriginalFetch: originalFetch
    }
  )

  globalThis.fetch = guardedFetch
}

