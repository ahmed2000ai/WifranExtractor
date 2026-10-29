import { convertArabicNumeralsToWestern } from './arabicNumerals'

export function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value >= 0 ? value : null

  if (typeof value === 'string') {
    let normalized = convertArabicNumeralsToWestern(value)
    
    // Remove currency symbols and formatting
    normalized = normalized.replace(/SAR|ر\.س|SR|ريال/gi, '')
    normalized = normalized.replace(/,/g, '.')
    normalized = normalized.replace(/[^\d.]/g, '')

    // Handle multiple decimal points (e.g. 1.23.45 -> 1.2345)
    const parts = normalized.split('.')
    if (parts.length > 2) {
      normalized = parts[0] + '.' + parts.slice(1).join('')
    }

    const parsed = parseFloat(normalized)
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed
    }
  }

  return null
}

export function calculateDiscountAmount(
  offerPrice: number | null,
  originalPrice: number | null
): number | null {
  if (offerPrice === null || originalPrice === null) return null
  if (originalPrice < offerPrice) return null
  return Number((originalPrice - offerPrice).toFixed(2))
}

export function calculateDiscountPercentage(
  offerPrice: number | null,
  originalPrice: number | null
): number | null {
  if (offerPrice === null || originalPrice === null || originalPrice === 0) return null
  if (originalPrice < offerPrice) return null
  
  const discount = originalPrice - offerPrice
  const percentage = (discount / originalPrice) * 100
  return Number(percentage.toFixed(2))
}
