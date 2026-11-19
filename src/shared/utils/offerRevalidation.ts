import type { LeafletMetadataScope } from '../types/batchExtraction'
import { detectItemDomainFromTitle } from './priceAndUnitNormalizer'
import {
  assessOfferQuantitySemanticsConflict,
  isFragmentedOrInvalidTitle,
  isValidCalendarDateIso
} from './nonCatalogPublicationPolicy'

export interface NormalizedUnitMeasurement {
  rawText: string
  count: number
  value: number
  totalValue: number
  unit: 'g' | 'ml'
}

export interface OfferRevalidationResult {
  isValid: boolean
  quarantineReasons: string[]
  conflictCodes: string[]
  blockingErrors: string[]
  warnings: string[]
  v3RetentionMode: string | null
  imageSubjectScope?: 'product_package' | 'representative_assortment' | 'unverified' | null
}

const NON_BYPASSABLE_UNCONFIRMED_CONFLICTS = new Set([
  'INCOMPLETE_VISIBLE_ASSORTMENT',
  'TEXT_VS_IMAGE_CONFLICT',
  'PRICE_ROLE_AMBIGUOUS',
  'COMPOUND_TIER_INCOMPLETE',
  'MISSING_OR_INVALID_PROMO_PRICE'
])

export function normalizeArabicDigits(text: string): string {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩'
  const extendedArabic = '۰۱۲۳۴۵۶۷۸۹'
  let out = ''
  for (const ch of text) {
    const idx1 = arabicIndic.indexOf(ch)
    if (idx1 >= 0) {
      out += String(idx1)
      continue
    }
    const idx2 = extendedArabic.indexOf(ch)
    if (idx2 >= 0) {
      out += String(idx2)
      continue
    }
    out += ch
  }
  return out
    .replace(/(\d)[،,٫](\d)/g, '$1.$2')
    .replace(/[\u00d7\u2715\u2716\u2a2f\u2a09\u274c*]/g, 'x')
}

function toBaseUnitMeasurement(
  numStr: string,
  rawUnit: string,
  rawText: string,
  count = 1
): NormalizedUnitMeasurement | null {
  const val = Number(numStr)
  if (!Number.isFinite(val) || val <= 0) return null
  const safeCount = Number.isFinite(count) && count > 0 ? count : 1
  const u = rawUnit.toLowerCase().trim()
  if (['kg', 'kilogram', 'kilograms', 'كج', 'كجم', 'كيلو', 'كيلوجرام', 'كيلوغرام'].includes(u)) {
    const each = val * 1000
    return { rawText, count: safeCount, value: each, totalValue: each * safeCount, unit: 'g' }
  }
  if (['g', 'gm', 'gms', 'gram', 'grams', 'جم', 'غ', 'جرام', 'غرام'].includes(u)) {
    return { rawText, count: safeCount, value: val, totalValue: val * safeCount, unit: 'g' }
  }
  if (['l', 'lt', 'ltr', 'liter', 'liters', 'litre', 'litres', 'ل', 'لتر', 'ليتر'].includes(u)) {
    const each = val * 1000
    return { rawText, count: safeCount, value: each, totalValue: each * safeCount, unit: 'ml' }
  }
  if (['ml', 'mls', 'milliliter', 'milliliters', 'مل', 'ملل', 'مليلتر'].includes(u)) {
    return { rawText, count: safeCount, value: val, totalValue: val * safeCount, unit: 'ml' }
  }
  return null
}

export function extractUnitMeasurementsFromText(text?: string | null): NormalizedUnitMeasurement[] {
  if (!text) return []
  const norm = normalizeArabicDigits(String(text))
  const results: NormalizedUnitMeasurement[] = []
  const rx =
    /(?:(\d+)\s*[x×*]\s*)?(\d+(?:\.\d+)?)\s*(kg|kilograms?|g|gms?|grams?|ml|mls|l|ltr|lt|liters?|litres?|كيلوجرام|كيلوغرام|كجم|كج|كيلو|جرام|غرام|جم|غ|ملل|مليلتر|مل|لتر|ليتر|ل)(?:\s*[x×*]\s*(\d+)(?![a-zA-Z\u0600-\u06FF]))?(?![a-zA-Z\u0600-\u06FF])/gi
  let m: RegExpExecArray | null
  while ((m = rx.exec(norm)) !== null) {
    const count = m[1] ? Number(m[1]) : m[4] ? Number(m[4]) : 1
    const parsed = toBaseUnitMeasurement(m[2], m[3], m[0], count)
    if (parsed) results.push(parsed)
  }
  return results
}

export function detectEnArUnitVolumeConflict(params: {
  titleEn?: string | null
  titleAr?: string | null
  eachSizeValue?: number | null
  eachSizeUnit?: string | null
  saleUnitType?: string | null
  isExplicitAssorted?: boolean
}): string | null {
  const isExplicitAssorted = Boolean(
    params.isExplicitAssorted ||
    /assorted|متنوع/i.test(`${params.titleEn || ''} ${params.titleAr || ''}`)
  )
  const enMeasures = extractUnitMeasurementsFromText(params.titleEn)
  const arMeasures = extractUnitMeasurementsFromText(params.titleAr)

  const formatMeasure = (m: NormalizedUnitMeasurement) =>
    m.count > 1 ? `${m.count} x ${m.value}${m.unit}` : `${m.value}${m.unit}`

  const structured =
    params.eachSizeValue != null &&
    Number(params.eachSizeValue) > 0 &&
    params.eachSizeUnit
      ? toBaseUnitMeasurement(
          String(params.eachSizeValue),
          String(params.eachSizeUnit),
          `${params.eachSizeValue}${params.eachSizeUnit}`
        )
      : null

  if (enMeasures.length > 0 && arMeasures.length > 0) {
    // Prefer matching dimension pair (e.g. volume vs volume) so stray cross-dimension bleed ("LARGE 400G")
    // does not obscure or false-fail a matching primary volume offer (1.5L X2 vs 1.5L X2).
    const sameDimPairs = enMeasures.flatMap((enM) =>
      arMeasures.filter((arM) => arM.unit === enM.unit).map((arM) => ({ enM, arM }))
    )

    if (sameDimPairs.length > 0) {
      const hasAgreeingPair = sameDimPairs.some(({ enM, arM }) => {
        const maxEach = Math.max(enM.value, arM.value)
        const maxTotal = Math.max(enM.totalValue, arM.totalValue)
        const matchesEach = maxEach > 0 && Math.abs(enM.value - arM.value) / maxEach <= 0.05
        const matchesTotal = maxTotal > 0 && Math.abs(enM.totalValue - arM.totalValue) / maxTotal <= 0.05
        if (!matchesEach && !matchesTotal) return false
        if (!structured || isExplicitAssorted) return true
        return (
          enM.unit === structured.unit &&
          Math.abs(enM.value - structured.value) / Math.max(enM.value, structured.value) <= 0.05
        )
      })
      if (!hasAgreeingPair) {
        const { enM, arM } = sameDimPairs[0]
        return `EN measurement "${enM.rawText}" (${formatMeasure(enM)}) conflicts with Arabic measurement "${arM.rawText}" (${formatMeasure(arM)}).`
      }
      // If a matching same-dimension pair agrees with EN, AR, and structured size, ignore stray bleed of a different dimension.
      return null
    }

    const en0 = enMeasures[0]
    const ar0 = arMeasures[0]
    if (en0.unit !== ar0.unit) {
      return `EN measurement "${en0.rawText}" (${formatMeasure(en0)}) conflicts with Arabic measurement "${ar0.rawText}" (${formatMeasure(ar0)}).`
    }
  }

  if (structured && !isExplicitAssorted) {
    const allMeasures = [...enMeasures, ...arMeasures]
    const sameDimMeasures = allMeasures.filter((m) => m.unit === structured.unit)
    const measuresToCheck = sameDimMeasures.length > 0 ? sameDimMeasures : allMeasures
    for (const m of measuresToCheck) {
      if (m.unit !== structured.unit) {
        return `Title measurement "${m.rawText}" (${formatMeasure(m)}) conflicts with structured size ${structured.rawText} (${structured.value}${structured.unit}).`
      }
      const maxVal = Math.max(m.value, structured.value)
      if (maxVal > 0 && Math.abs(m.value - structured.value) / maxVal > 0.05) {
        return `Title measurement "${m.rawText}" (${formatMeasure(m)}) conflicts with structured size ${structured.rawText} (${structured.value}${structured.unit}).`
      }
    }
  }

  return null
}

/**
 * Revalidates a draft offer item after operator corrections using deterministic validation checks.
 * Never allows a blocked offer to clear if any deterministic factual, metadata, assortment, unit, or price error remains.
 */
export function normalizeAssortedTitle(title: string, lang: 'en' | 'ar'): string {
  const trimmed = (title || '').trim()
  if (!trimmed) return trimmed
  if (lang === 'en') {
    if (/\s*[-—]\s*assorted$/i.test(trimmed)) return trimmed
    if (/\bassorted\b/i.test(trimmed)) {
      return trimmed.replace(/\s*[-—]\s*assorted/i, '') + ' — Assorted'
    }
    return `${trimmed} — Assorted`
  } else {
    if (/\s*[-—]\s*متنوع$/u.test(trimmed)) return trimmed
    if (/متنوع/u.test(trimmed)) {
      return trimmed.replace(/\s*[-—]\s*متنوع/u, '') + ' — متنوع'
    }
    return `${trimmed} — متنوع`
  }
}

export function revalidateOfferItem(params: {
  item: Record<string, any>
  leafletMetadata?: LeafletMetadataScope | null
  confirmConflictResolution?: boolean
}): OfferRevalidationResult {
  const { item, leafletMetadata, confirmConflictResolution = false } = params
  const existingConflicts = Array.isArray(item.conflictCodes) ? item.conflictCodes.map(String) : []
  const nextConflicts: string[] = []
  const quarantineReasons: string[] = []
  const blockingErrors: string[] = []
  const warnings: string[] = []

  const titleEn = String(item.titleEn || '').trim()
  const titleAr = String(item.titleAr || '').trim()
  const brand = String(item.brandEn || item.brand || item.brandAr || '').trim()
  const category = item.category ? String(item.category) : null
  // Wifran MVP: Internal fixed SAR currency; ignore/strip stale currency conflict flags.

  const assortmentStatus = String(item.assortment_status || '').toLowerCase()
  const isExplicitAssorted =
    assortmentStatus === 'unsplit_assortment' ||
    assortmentStatus === 'assorted' ||
    /assorted|متنوع/i.test(`${titleEn} ${titleAr}`)

  const domain = detectItemDomainFromTitle(
    titleEn,
    titleAr,
    category,
    {
      commodityTag: item.canonical?.commodity_tag ?? null,
      categoryHint: category
    }
  )
  if (domain !== 'grocery' && domain !== 'household' && domain !== 'personal_care') {
    quarantineReasons.push('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')
    blockingErrors.push(`Offer domain '${domain}' is outside default grocery consumer scope.`)
  }

  if (isFragmentedOrInvalidTitle(titleEn, titleAr)) {
    quarantineReasons.push('FRAGMENTED_OR_MISSING_TITLE')
    blockingErrors.push('Product title (English or Arabic) is missing or fragmented.')
  }

  const rawPromoPrice = item.priceAfter !== null && item.priceAfter !== undefined ? item.priceAfter : item.promoPrice
  const promoPrice = rawPromoPrice !== null && rawPromoPrice !== undefined ? Number(rawPromoPrice) : NaN
  if (!Number.isFinite(promoPrice) || promoPrice <= 0) {
    quarantineReasons.push('INVALID_OR_MISSING_OFFER_PRICE')
    blockingErrors.push('Promotional price must be greater than zero.')
  }

  const rawOrigPrice = item.priceBefore !== null && item.priceBefore !== undefined ? item.priceBefore : item.originalPrice
  if (rawOrigPrice !== null && rawOrigPrice !== undefined) {
    const origPrice = Number(rawOrigPrice)
    if (!Number.isFinite(origPrice) || (Number.isFinite(promoPrice) && origPrice < promoPrice)) {
      quarantineReasons.push('ORIGINAL_PRICE_LESS_THAN_OFFER_PRICE')
      blockingErrors.push('Original price must be greater than or equal to promotional price.')
    }
  }

  // Size / weight sufficiency (weighted loose items allowed without fixed unit size)
  const saleUnit = String(item.sale_unit_type || '').toLowerCase()
  const isWeighted = saleUnit === 'kg' || saleUnit === 'weighted'
  const hasSize =
    (typeof item.each_size_value === 'number' && Number.isFinite(item.each_size_value) && item.each_size_value > 0 && Boolean(item.each_size_unit)) ||
    (typeof item.total_content_value === 'number' && Number.isFinite(item.total_content_value) && item.total_content_value > 0 && Boolean(item.total_content_unit)) ||
    isWeighted
  if (!hasSize) {
    quarantineReasons.push('MISSING_UNIT_SIZE')
    blockingErrors.push('Size value and unit (e.g., 400g, 1.5l, or kg) are required.')
  }

  if (!brand && !isWeighted) {
    warnings.push('Brand name is missing; verify catalog or non-catalog brand identity.')
  }

  // EN vs AR weight/volume check
  const unitConflictMsg = detectEnArUnitVolumeConflict({
    titleEn,
    titleAr,
    eachSizeValue: typeof item.each_size_value === 'number' ? item.each_size_value : null,
    eachSizeUnit: item.each_size_unit || null,
    saleUnitType: item.sale_unit_type || null,
    isExplicitAssorted
  })
  if (unitConflictMsg) {
    nextConflicts.push('EN_AR_WEIGHT_VOLUME_CONFLICT')
    quarantineReasons.push('FACT_OR_PROMO_CONFLICT', 'EN_AR_WEIGHT_VOLUME_CONFLICT')
    blockingErrors.push(unitConflictMsg)
  }

  // Quantity / pack count conflict check
  const qtyConflict = assessOfferQuantitySemanticsConflict({
    titleEn,
    titleAr,
    inner_pack_count: item.inner_pack_count ?? null,
    total_content_value: item.total_content_value ?? null,
    total_content_unit: item.total_content_unit ?? null,
    each_size_value: item.each_size_value ?? null,
    each_size_unit: item.each_size_unit ?? null,
    sale_unit_type: item.sale_unit_type ?? null
  })
  if (qtyConflict.hasConflict) {
    const code =
      qtyConflict.conflictKind === 'pack_count_conflict'
        ? 'EN_AR_PACK_COUNT_CONFLICT'
        : qtyConflict.conflictKind === 'unit_or_measure_conflict'
          ? 'EN_AR_WEIGHT_VOLUME_CONFLICT'
          : 'PROMO_QTY_VS_MFG_PACK_CONFLICT'
    if (!nextConflicts.includes(code)) nextConflicts.push(code)
    if (!quarantineReasons.includes('FACT_OR_PROMO_CONFLICT')) quarantineReasons.push('FACT_OR_PROMO_CONFLICT')
    if (!quarantineReasons.includes(code)) quarantineReasons.push(code)
    if (code !== 'EN_AR_WEIGHT_VOLUME_CONFLICT' || !unitConflictMsg) {
      blockingErrors.push(qtyConflict.reason || 'Quantity / pack count conflict remains unresolved.')
    }
  } else if (existingConflicts.includes('PROMO_QTY_VS_MFG_PACK_CONFLICT')) {
    const packCountNum = item.inner_pack_count != null ? Number(item.inner_pack_count) : null
    const combinedText = normalizeArabicDigits(`${titleEn} ${titleAr} ${item.sizeText || ''} ${item.promoNotes || ''}`)
    const hasMultipackToken =
      /\b\d+\s*x\s*\d+|\d+(?:\.\d+)?\s*(?:ml|l|ltr|litre|liter|g|gm|gms|gram|kg|pcs|مل|لتر|جم|جرام|كجم)?\s*x\s*\d+|\b(?:pack\s+of\s+\d+|multipack|carton)\b|شد|كرتون/i.test(
        combinedText
      )
    const hasConsistentPackSemantics =
      packCountNum == null ||
      packCountNum <= 1 ||
      hasMultipackToken
    if (!hasConsistentPackSemantics && !confirmConflictResolution) {
      nextConflicts.push('PROMO_QTY_VS_MFG_PACK_CONFLICT')
      quarantineReasons.push('FACT_OR_PROMO_CONFLICT', 'PROMO_QTY_VS_MFG_PACK_CONFLICT')
      blockingErrors.push('Original extraction flagged promo vs manufacturer pack quantity conflict; confirm pack count resolution.')
    }
  }

  // Assortment ambiguity check
  const isAmbiguousAssortment =
    !isExplicitAssorted &&
    (assortmentStatus === 'visual_multiple_variants' ||
      assortmentStatus === 'multiple_variants' ||
      assortmentStatus === 'ambiguous')
  if (isAmbiguousAssortment) {
    nextConflicts.push('INCOMPLETE_VISIBLE_ASSORTMENT')
    quarantineReasons.push('INCOMPLETE_VISIBLE_ASSORTMENT')
    blockingErrors.push('Card shows multiple or incomplete assortment variants; confirm single-SKU identity and set assortment_status to confirmed_single_sku.')
  }

  // Carry over other unconfirmed extraction-time conflicts until explicitly resolved after fixing facts
  for (const code of existingConflicts) {
    if (
      code === 'SINGLE_DAY_OFFER_EXCEPTION' ||
      code === 'EN_AR_WEIGHT_VOLUME_CONFLICT' ||
      code === 'EN_AR_PACK_COUNT_CONFLICT' ||
      code === 'CURRENCY_UNVERIFIED_OR_CONFLICT' ||
      code === 'PROMO_QTY_VS_MFG_PACK_CONFLICT' ||
      (isExplicitAssorted &&
        (code === 'INCOMPLETE_VISIBLE_ASSORTMENT' ||
          code === 'MULTIPLE_PRODUCT_VARIANTS_DETECTED' ||
          code === 'WEIGHT_RANGE_UNPAIRED'))
    ) {
      continue
    }
    if (NON_BYPASSABLE_UNCONFIRMED_CONFLICTS.has(code) && !confirmConflictResolution) {
      if (!nextConflicts.includes(code)) nextConflicts.push(code)
      if (!quarantineReasons.includes(code)) quarantineReasons.push(code)
      blockingErrors.push(`Extraction conflict ${code} requires operator inspection and confirmation after correcting fields.`)
    }
  }

  if (existingConflicts.includes('SINGLE_DAY_OFFER_EXCEPTION') && !nextConflicts.includes('SINGLE_DAY_OFFER_EXCEPTION')) {
    nextConflicts.push('SINGLE_DAY_OFFER_EXCEPTION')
  }

  // Check metadata date validity on leaflet if present
  const startDate = leafletMetadata?.offerStartDate || null
  const endDate = leafletMetadata?.offerEndDate || null
  if (startDate && endDate && isValidCalendarDateIso(startDate) && isValidCalendarDateIso(endDate) && startDate > endDate) {
    quarantineReasons.push('INVALID_OFFER_DATE_RANGE')
    blockingErrors.push(`Leaflet validity start date (${startDate}) exceeds end date (${endDate}).`)
  }

  const dedupConflicts = Array.from(new Set(nextConflicts))
  const dedupQuarantines = Array.from(new Set(quarantineReasons))
  const dedupBlocking = Array.from(new Set(blockingErrors))

  const NON_BLOCKING_ASSORTMENT_CODES = new Set([
    'SINGLE_DAY_OFFER_EXCEPTION',
    'MULTIPLE_PRODUCT_VARIANTS_DETECTED',
    'INCOMPLETE_VISIBLE_ASSORTMENT',
    'WEIGHT_RANGE_UNPAIRED'
  ])

  // Suppress per-unit pricing on mixed-size assortment
  if (isExplicitAssorted) {
    const combinedSizes = `${titleEn} ${titleAr} ${item.sizeOrWeight || ''}`
    const hasMultipleSizes = /\d+(?:\.\d+)?\s*(?:ml|l|ltr|g|gm|gms|kg)\s*[\/\\,]\s*\d+(?:\.\d+)?\s*(?:ml|l|ltr|g|gm|gms|kg)/i.test(combinedSizes)
    if (hasMultipleSizes) {
      item.unit_price = null
      item.unit_price_unit = null
      item.informational_inner_unit_price = null
      item.display_unit_price_label_ar = null
      item.display_unit_price_label_en = null
    }
  }

  const activeQuarantines = isExplicitAssorted
    ? dedupQuarantines.filter((c) => !NON_BLOCKING_ASSORTMENT_CODES.has(c))
    : dedupQuarantines
  const activeBlocking = isExplicitAssorted
    ? dedupBlocking.filter((msg) => !/assortment variants|single-SKU|INCOMPLETE_VISIBLE_ASSORTMENT/i.test(msg))
    : dedupBlocking

  const hasHardConflicts =
    activeQuarantines.length > 0 ||
    dedupConflicts.some((c) =>
      isExplicitAssorted ? !NON_BLOCKING_ASSORTMENT_CODES.has(c) : c !== 'SINGLE_DAY_OFFER_EXCEPTION'
    )
  const isValid = !hasHardConflicts && activeBlocking.length === 0

  const nextRetentionMode = isValid
    ? isExplicitAssorted
      ? 'unsplit_assortment'
      : item.v3RetentionMode === 'quarantined_do_not_publish'
        ? 'operator_resolved_single_sku'
        : item.v3RetentionMode ?? null
    : 'quarantined_do_not_publish'

  const finalConflicts = isExplicitAssorted
    ? dedupConflicts.filter((c) => !NON_BLOCKING_ASSORTMENT_CODES.has(c))
    : dedupConflicts

  return {
    isValid,
    quarantineReasons: isValid ? [] : activeQuarantines,
    conflictCodes: finalConflicts,
    blockingErrors: isValid ? [] : activeBlocking,
    warnings: Array.from(new Set(warnings)),
    v3RetentionMode: nextRetentionMode,
    imageSubjectScope: isExplicitAssorted
      ? 'representative_assortment'
      : isValid && item.productThumbLocalPath && item.imageSubjectScope === 'unverified'
        ? 'product_package'
        : item.imageSubjectScope ?? null
  }
}
