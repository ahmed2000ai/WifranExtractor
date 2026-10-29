export function calculateDiscountAmount(
  offerPrice: number | null,
  originalPrice: number | null
): number | null {
  if (offerPrice === null || originalPrice === null) return null
  if (originalPrice < offerPrice) return null // Invalid if original is less than offer
  if (offerPrice < 0 || originalPrice < 0) return null

  const discount = originalPrice - offerPrice
  return Number(discount.toFixed(2))
}

export function calculateDiscountPercentage(
  offerPrice: number | null,
  originalPrice: number | null
): number | null {
  if (offerPrice === null || originalPrice === null) return null
  if (originalPrice <= 0 || originalPrice < offerPrice) return null
  if (offerPrice < 0) return null

  const percentage = ((originalPrice - offerPrice) / originalPrice) * 100
  return Number(percentage.toFixed(2))
}

export function calculateUnitPrice(input: {
  offerPrice: number | null
  packSizeValue: number | null
  packQuantity: number | null
}): number | null {
  const { offerPrice, packSizeValue, packQuantity } = input
  
  if (offerPrice === null || offerPrice <= 0) return null
  
  // Need either size or quantity to calculate something meaningful
  if (!packSizeValue && !packQuantity) return null
  
  // Standardize the divisor based on quantity and size
  const qty = packQuantity && packQuantity > 0 ? packQuantity : 1
  const size = packSizeValue && packSizeValue > 0 ? packSizeValue : 1
  
  const divisor = qty * size
  if (divisor <= 0) return null
  
  const unitPrice = offerPrice / divisor
  return Number(unitPrice.toFixed(2))
}

export function calculateDataQualityScore(input: {
  hasTitle: boolean
  hasValidOfferPrice: boolean
  hasValidOriginalPrice: boolean
  hasBrand: boolean
  hasCategory: boolean
  hasProduct: boolean
  hasValidPackData: boolean
  hasImage: boolean
  confidenceAcceptable: boolean
  hasWarnings: boolean
  hasErrors: boolean
}): number {
  if (input.hasErrors) return 0

  let score = 0

  // Core requirements (highly weighted)
  if (input.hasTitle) score += 20
  if (input.hasValidOfferPrice) score += 20
  
  // Important references
  if (input.hasProduct) score += 15
  else if (input.hasBrand && input.hasCategory) score += 10
  else if (input.hasBrand || input.hasCategory) score += 5
  
  // Enhancement data
  if (input.hasValidOriginalPrice) score += 10
  if (input.hasValidPackData) score += 10
  if (input.hasImage) score += 15
  
  // OCR Confidence validation
  if (input.confidenceAcceptable) score += 10

  // Penalize warnings
  if (input.hasWarnings) score -= 10

  // Clamp 0-100
  return Math.max(0, Math.min(100, score))
}
