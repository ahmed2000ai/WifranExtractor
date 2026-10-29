// TODO: Future chunks must redact secrets before logging
export function info(message: string, meta?: unknown): void {
  console.log(`[INFO] ${message}`, meta || '')
}

export function warn(message: string, meta?: unknown): void {
  console.warn(`[WARN] ${message}`, meta || '')
}

export function error(message: string, meta?: unknown): void {
  console.error(`[ERROR] ${message}`, meta || '')
}

export function debug(message: string, meta?: unknown): void {
  console.debug(`[DEBUG] ${message}`, meta || '')
}
