import { CanonicalOffer } from '../types/canonicalOffer'
import { parsePrice, calculateDiscountAmount, calculateDiscountPercentage } from './priceParsing'
import { normalizePackUnit } from './unitNormalization'

export function mapLegacyOcrFieldsToCanonical(
  parsed: Record<string, unknown>,
  canonical: CanonicalOffer
): void {
  const p = parsed as any

  canonical.product.title_ar = p.name_ar || p.arabic_name || p.title_ar || null
  canonical.product.title_en = p.name_en || p.english_name || p.title_en || null
  canonical.product.description_ar = p.description_ar || null
  canonical.product.description_en = p.description_en || null
  canonical.product.brand_text = p.brand || null
  canonical.product.category_hint = p.category || p.category_hint || null

  const offerPriceRaw = p.offer_price || p.current_price || p.sale_price || p.price
  const originalPriceRaw = p.original_price || p.old_price || p.was_price

  canonical.prices.offer_price = parsePrice(offerPriceRaw)
  canonical.prices.original_price = parsePrice(originalPriceRaw)
  canonical.prices.discount_amount = calculateDiscountAmount(canonical.prices.offer_price, canonical.prices.original_price)
  canonical.prices.discount_percentage = calculateDiscountPercentage(canonical.prices.offer_price, canonical.prices.original_price)
  canonical.prices.currency = canonical.prices.offer_price ? 'SAR' : null

  canonical.content.size_text = p.size || p.unit_size || p.pack_size || null
  canonical.content.each_size_unit = normalizePackUnit(p.unit_type) as any
  canonical.content.pack_quantity = parsePrice(p.pack_quantity) || null
  canonical.content.bundle_quantity = parsePrice(p.bundle_quantity) || null

  canonical.promotion.special_offer = p.special_offer || null
  canonical.promotion.condition_text = p.price_condition || null

  // Synthetic price candidates
  if (offerPriceRaw != null) {
    canonical.prices.all_price_candidates.push({
      raw_text: String(offerPriceRaw),
      normalized_value: canonical.prices.offer_price,
      currency: 'SAR',
      visual_role: 'prominent_current_price',
      classified_as: 'offer_price',
      confidence: 'medium',
      evidence: 'Legacy synthesized',
      visual_evidence: { relative_size: 'unknown', position_hint: 'unknown', is_crossed_out: false }
    })
  }

  if (originalPriceRaw != null) {
    canonical.prices.all_price_candidates.push({
      raw_text: String(originalPriceRaw),
      normalized_value: canonical.prices.original_price,
      currency: 'SAR',
      visual_role: 'crossed_out_old_price',
      classified_as: 'original_price',
      confidence: 'medium',
      evidence: 'Legacy synthesized',
      visual_evidence: { relative_size: 'unknown', position_hint: 'unknown', is_crossed_out: true }
    })
  }

  // Preserve unknown fields
  const knownKeys = new Set([
    'name_ar', 'arabic_name', 'title_ar', 'name_en', 'english_name', 'title_en',
    'description_ar', 'description_en', 'brand', 'category', 'category_hint',
    'offer_price', 'current_price', 'sale_price', 'price',
    'original_price', 'old_price', 'was_price',
    'size', 'unit_size', 'pack_size', 'unit_type', 'pack_quantity', 'bundle_quantity',
    'special_offer', 'price_condition'
  ])

  for (const [key, value] of Object.entries(parsed)) {
    if (!knownKeys.has(key)) {
      canonical.raw.raw_attributes[key] = value
    }
  }
}
