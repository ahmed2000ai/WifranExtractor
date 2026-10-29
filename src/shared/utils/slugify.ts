export function createSlug(input: string): string {
  if (!input) return ''

  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF-]/g, '') // Keep alphanumeric, whitespace, arabic letters, and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-+|-+$/g, '') // Trim hyphens from edges
}

export function ensureSlugFallback(input: {
  preferred?: string | null
  fallback?: string | null
  prefix: string
}): string {
  let slug = ''

  if (input.preferred) {
    slug = createSlug(input.preferred)
  }

  if (!slug && input.fallback) {
    slug = createSlug(input.fallback)
  }

  if (!slug) {
    // Generate a random-ish fallback
    slug = `${input.prefix}-${Math.random().toString(36).substring(2, 9)}`
  }

  return slug
}
