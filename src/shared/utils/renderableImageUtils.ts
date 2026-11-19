/**
 * Converts local filesystem paths (e.g. Windows paths or POSIX crop paths) into
 * Electron's privileged `local-file://get?path=...` protocol URL so `<img>`
 * elements can render extracted crops and local display images safely.
 */
export function toRenderableImageSrc(rawPathOrUrl?: string | null): string | null {
  if (!rawPathOrUrl) return null
  const trimmed = rawPathOrUrl.trim()
  if (!trimmed) return null

  if (/^(https?:\/\/|data:|blob:|local-file:\/\/)/i.test(trimmed)) {
    return trimmed
  }

  if (/^file:\/\//i.test(trimmed)) {
    try {
      const urlObj = new URL(trimmed)
      let decoded = decodeURIComponent(urlObj.pathname)
      if (/^\/[a-zA-Z]:/.test(decoded)) {
        decoded = decoded.slice(1)
      }
      return `local-file://get?path=${encodeURIComponent(decoded)}`
    } catch {
      return `local-file://get?path=${encodeURIComponent(trimmed)}`
    }
  }

  return `local-file://get?path=${encodeURIComponent(trimmed)}`
}

