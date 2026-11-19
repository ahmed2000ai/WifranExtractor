import { CanonicalOffer } from '../types/canonicalOffer'
import { parsePrice, calculateDiscountAmount, calculateDiscountPercentage } from './priceParsing'
import { normalizePackUnit } from './unitNormalization'
import { normalizeArabicNumerals, isTechOrCellularToken } from './priceAndUnitNormalizer'

const COUNTING_OR_SALE_UNIT_REGEX =
  /^(?:pcs|pc|p|piece|pieces|each|per\s*each|ea|pack|packs|pk|box|carton|ctn|bag|bags|حبة|حبات|قطعة|قطع|علبة|كيس|كرتون|ربطة)$/i

export interface LegacyQuantityExtraction {
  size_text: string | null
  each_size_value: number | null
  each_size_unit: string | null
  pack_quantity: number | null
  bundle_quantity: number | null
  sale_unit_type: string | null
  sale_unit_raw: string | null
}

function normalizeLegacyUnitToken(rawUnit: unknown): string | null {
  if (typeof rawUnit !== 'string') return null
  const trimmed = normalizeArabicNumerals(rawUnit).trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (/^(?:each|per\s*each|ea)$/i.test(lower)) return 'piece'
  if (/^(?:inch|inches|in|بوصة|["”])$/i.test(lower)) return 'inch'
  return normalizePackUnit(trimmed)
}

function isCountingOrSaleUnit(rawUnit: unknown): boolean {
  if (typeof rawUnit !== 'string') return false
  return COUNTING_OR_SALE_UNIT_REGEX.test(normalizeArabicNumerals(rawUnit).trim())
}

/**
 * Extracts physical unit size/unit separately from counting/sale unit (e.g., `unit: "PCS"` vs `size_unit: "L"`),
 * without inventing multipack expressions when not supported by source evidence.
 */
export function extractLegacyQuantityAndSize(parsed: Record<string, unknown>): LegacyQuantityExtraction {
  const p = parsed as any

  const rawExplicitSizeUnit =
    typeof p.size_unit === 'string' && p.size_unit.trim()
      ? p.size_unit.trim()
      : typeof p.unit_type === 'string' && p.unit_type.trim()
      ? p.unit_type.trim()
      : null

  const rawCountingOrUnitField =
    typeof p.unit === 'string' && p.unit.trim() ? p.unit.trim() : null

  const rawSizeCandidate = p.size ?? p.unit_size ?? p.pack_size ?? p.unit_weight ?? null
  let eachSizeValue: number | null = null
  let embeddedUnitRaw: string | null = null
  let numericOnlyRaw: string | null = null

  if (typeof rawSizeCandidate === 'number' && Number.isFinite(rawSizeCandidate) && rawSizeCandidate > 0) {
    eachSizeValue = rawSizeCandidate
    numericOnlyRaw = String(rawSizeCandidate)
  } else if (typeof rawSizeCandidate === 'string' && rawSizeCandidate.trim()) {
    const normalizedStr = normalizeArabicNumerals(rawSizeCandidate).trim()
    const numOnlyMatch = /^(\d+(?:\.\d+)?)$/.exec(normalizedStr)
    const numWithUnitMatch = /^(\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)$/.exec(normalizedStr)
    if (numOnlyMatch) {
      const n = Number(numOnlyMatch[1])
      if (Number.isFinite(n) && n > 0) {
        eachSizeValue = n
        numericOnlyRaw = numOnlyMatch[1]
      }
    } else if (numWithUnitMatch && !isTechOrCellularToken(normalizedStr)) {
      const n = Number(numWithUnitMatch[1])
      if (Number.isFinite(n) && n > 0) {
        eachSizeValue = n
        embeddedUnitRaw = numWithUnitMatch[2]
      }
    }
  }

  // Physical unit precedence:
  // 1) Explicit `size_unit` / `unit_type` (unless it is a counting unit while embedded size has a physical unit)
  // 2) Embedded unit in `size` / `unit_size` / `pack_size` / `unit_weight`
  // 3) `unit` only when explicit `size_unit`/`unit_type` and embedded physical unit are absent
  let chosenPhysicalUnitRaw: string | null = null
  if (rawExplicitSizeUnit && !(isCountingOrSaleUnit(rawExplicitSizeUnit) && embeddedUnitRaw && !isCountingOrSaleUnit(embeddedUnitRaw))) {
    chosenPhysicalUnitRaw = rawExplicitSizeUnit
  } else if (embeddedUnitRaw) {
    chosenPhysicalUnitRaw = embeddedUnitRaw
  } else if (rawCountingOrUnitField) {
    chosenPhysicalUnitRaw = rawCountingOrUnitField
  }

  const eachSizeUnit = normalizeLegacyUnitToken(chosenPhysicalUnitRaw)

  // Preserve counting/sale unit separately whenever `p.unit` is a counting/sale unit (or explicit sale_unit_type)
  const saleUnitRaw =
    rawCountingOrUnitField && isCountingOrSaleUnit(rawCountingOrUnitField)
      ? rawCountingOrUnitField
      : null
  const isLooseKgUnit =
    !rawSizeCandidate &&
    rawCountingOrUnitField !== null &&
    /^(?:kg|kgs|kilo|kilogram|kilograms|كيلو|كجم|كغ)$/i.test(normalizeArabicNumerals(rawCountingOrUnitField).trim())
  const saleUnitType = normalizeLegacyUnitToken(
    p.sale_unit_type || saleUnitRaw || (isLooseKgUnit ? 'kg' : null)
  )

  let sizeText: string | null = null
  if (typeof rawSizeCandidate === 'string' && rawSizeCandidate.trim()) {
    const trimmed = rawSizeCandidate.trim()
    if (numericOnlyRaw && chosenPhysicalUnitRaw && !isCountingOrSaleUnit(chosenPhysicalUnitRaw)) {
      const unitSuffix = chosenPhysicalUnitRaw === 'inch' ? ' inch' : chosenPhysicalUnitRaw
      sizeText = `${trimmed}${unitSuffix}`
    } else {
      sizeText = trimmed
    }
  } else if (typeof rawSizeCandidate === 'number' && Number.isFinite(rawSizeCandidate) && rawSizeCandidate > 0) {
    sizeText =
      chosenPhysicalUnitRaw && !isCountingOrSaleUnit(chosenPhysicalUnitRaw)
        ? `${rawSizeCandidate}${chosenPhysicalUnitRaw === 'inch' ? ' inch' : chosenPhysicalUnitRaw}`
        : String(rawSizeCandidate)
  } else if (typeof p.size_or_weight === 'string' && p.size_or_weight.trim()) {
    sizeText = p.size_or_weight.trim()
  }

  const packQtyParsed = parsePrice(p.pack_quantity)
  const bundleQtyParsed = parsePrice(p.bundle_quantity)

  return {
    size_text: sizeText,
    each_size_value: eachSizeValue,
    each_size_unit: eachSizeUnit,
    pack_quantity: packQtyParsed && packQtyParsed > 0 ? packQtyParsed : null,
    bundle_quantity: bundleQtyParsed && bundleQtyParsed > 0 ? bundleQtyParsed : null,
    sale_unit_type: saleUnitType,
    sale_unit_raw: saleUnitRaw
  }
}

export function mapLegacyOcrFieldsToCanonical(
  parsed: Record<string, unknown>,
  canonical: CanonicalOffer
): void {
  const p = parsed as any

  canonical.product.title_ar =
    p.name_ar || p.arabic_name || p.product_name_arabic || p.arabic_product_name || p.title_ar || null
  canonical.product.title_en =
    p.name_en || p.english_name || p.product_name_english || p.english_product_name || p.title_en || null
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

  const qty = extractLegacyQuantityAndSize(parsed)
  canonical.content.size_text = qty.size_text
  canonical.content.each_size_value = qty.each_size_value
  canonical.content.each_size_unit = qty.each_size_unit as any
  canonical.content.pack_quantity = qty.pack_quantity
  canonical.content.bundle_quantity = qty.bundle_quantity
  if (qty.sale_unit_type) {
    ;(canonical.content as any).sale_unit_type = qty.sale_unit_type
  }
  if (qty.sale_unit_raw) {
    canonical.raw.raw_attributes.sale_unit = qty.sale_unit_raw
  }

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
    'name_ar', 'arabic_name', 'product_name_arabic', 'arabic_product_name', 'title_ar',
    'name_en', 'english_name', 'product_name_english', 'english_product_name', 'title_en',
    'description_ar', 'description_en', 'brand', 'category', 'category_hint',
    'offer_price', 'current_price', 'sale_price', 'price',
    'original_price', 'old_price', 'was_price',
    'size', 'size_unit', 'unit_size', 'pack_size', 'unit_type', 'unit', 'unit_weight', 'pack_quantity', 'bundle_quantity',
    'special_offer', 'price_condition'
  ])

  for (const [key, value] of Object.entries(parsed)) {
    if (!knownKeys.has(key)) {
      canonical.raw.raw_attributes[key] = value
    }
  }
}
