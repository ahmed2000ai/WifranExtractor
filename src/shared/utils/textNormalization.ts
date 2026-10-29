export function normalizeArabicText(value: string | null | undefined): string | null {
  if (!value) return null
  
  let text = value.trim()
  if (text.length === 0) return null

  // Remove tatweel (kashida)
  text = text.replace(/ـ/g, '')

  // Normalize Alef
  text = text.replace(/[أإآ]/g, 'ا')
  
  // Normalize Yeh
  text = text.replace(/ى/g, 'ي')
  
  // Normalize Teh Marbuta
  text = text.replace(/ة/g, 'ه')

  // Collapse multiple spaces
  text = text.replace(/\s+/g, ' ')

  return text
}

export function normalizeEnglishText(value: string | null | undefined): string | null {
  if (!value) return null
  
  let text = value.trim().toLowerCase()
  if (text.length === 0) return null

  // Collapse multiple spaces
  text = text.replace(/\s+/g, ' ')

  return text
}

export function normalizeSearchText(value: string | null | undefined): string | null {
  if (!value) return null
  
  let text = value.trim().toLowerCase()
  if (text.length === 0) return null

  // Remove harmless punctuation
  text = text.replace(/[.,/#!$%^&*;:{}=\-_`~()\[\]"'’]/g, ' ')
  
  // Collapse spaces
  text = text.replace(/\s+/g, ' ')

  return text.trim() || null
}

export function isMeaningfulText(value: string | null | undefined): boolean {
  if (!value) return false
  const text = value.trim()
  return text.length > 1
}
