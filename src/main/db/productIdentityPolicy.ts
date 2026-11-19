/**
 * Shared Product Identity, Packaging Semantics & Sufficiency Policy
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-002A
 *
 * Single source of truth shared across:
 * - BrandGroupingService
 * - GeminiMatchingService
 * - CatalogMatchingOrchestrator
 * - TemporaryProductRegistry
 * - VerifiedMatchCacheService
 * - CatalogPublicationService
 * - LiveCatalogMatchingBenchmarkRunner & offline replay harness
 */

import {
  MatchingEvidenceAnnotation,
  NormalizedIdentityAttributes,
  PackagingSemantics
} from '../../shared/types/catalogMatching'
import { UnifiedBatchOffer } from '../../shared/types/batchExtraction'
import { PROMO_MECHANIC_REGEX } from '../../shared/utils/priceAndUnitNormalizer'
import { findMatchingRawExtractionEntry } from '../../shared/utils/canonicalRawAttributes'

export interface QuantityAndPromoResolution {
  manufacturerPackCount: number
  promoPurchaseQuantity: number | null
  promotionMechanic: string | null
  packagingSemantics: PackagingSemantics
  isPackagingAmbiguous: boolean
  diagnostics: string[]
}

export interface IdentitySufficiencyEvaluation {
  isSufficient: boolean
  isAssortment: boolean
  evidenceGapDetected: boolean
  codes: string[]
  reasons: string[]
}

const MANUFACTURER_MULTIPACK_REGEX =
  /(?:(\d+)\s*[x×]\s*\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|ml|l|lt|ltr|pcs|pc|s|sheet|sheets|roll|rolls|منديل|مناديل)?\b|\b\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|ml|l|lt|ltr|sheet|sheets)\s*[x×]\s*(\d+)\b|\b\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|ml|l|lt|ltr)\s+(\d+)\s*s\b|\bpack\s*of\s*(\d+)\b|\b(\d+)\s*-?\s*pack\b|\bcarton\b|كرتون)/i

const RETAIL_PROMO_QTY_REGEX =
  /(?:promo\s*(\d+)\s*(?:pieces|pcs|pc)\b|\b(\d+)\s*(?:pieces|pcs|pc)\s*promo\b|buy\s*(\d+)\s*(?:get\s*\d+\s*(?:free|مجان|مجانا|مجاناً)|(?:pcs|pc|pieces|items|units)?)\b|\b(\d+)\s*for\s*(?:sar\s*)?\d+|عرض\s*(\d+)\s*(?:حبات|حبة|قطع|قطعة)|اشتري\s*(\d+)(?:\s*(?:و\s*)?احصل\s*على\s*\d+\s*(?:مجان|مجانا|مجاناً))?|(\d+)\s*(?:حبات|حبة)\s*بسعر)/i

const BARE_PROMO_QTY_REGEX = /^\s*(\d+)\s*(?:pieces|pcs|pc|حبات|حبة|قطع|قطعة)\s*$/i
const IN_PACK_BONUS_REGEX = /\d+\s*\+\s*\d+\s*(?:free|مجان|مجانا|مجاناً)/i
const EXPLICIT_CHECKOUT_BXGY_REGEX =
  /(?:buy\s*\d+\s*get\s*\d+\s*(?:free|مجان|مجانا|مجاناً)?|اشتري\s*\d+\s*(?:و\s*)?احصل\s*على\s*\d+\s*(?:مجان|مجانا|مجاناً)?)/i
const EXPLICIT_MULTI_BUY_WORDING_REGEX =
  /(?:promo\s*\d+\s*(?:pieces|pcs|pc)\b|\b\d+\s*(?:pieces|pcs|pc)\s*promo\b|\bbuy\s*\d+\b|\b\d+\s*for\s*(?:sar\s*)?\d+|عرض\s*\d+\s*(?:حبات|حبة|قطع|قطعة)|اشتري\s*\d+|\d+\s*(?:حبات|حبة)\s*بسعر)/i

function toLatinDigitsSimple(str: string): string {
  return str
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

const PREPARED_MARINADE_REGEX =
  /(?:\b(?:marinated|seasoned|spiced|flavored|flavoured)\b|متبل|متبلة|بالتتبيلة|بنكهة|متبل\s)/i

const DISTINGUISHING_RECIPE_MODIFIER_REGEX =
  /(?:\b(?:plain|original|classic|mild|hot|spicy|chili|chilli|garlic|lemon|lime|herb|herbs|bbq|barbecue|shawarma|tandoori|tikka|peri|mexican|italian|honey|mustard|teriyaki|soy|butter|black\s*pepper|pepper|mint|yogurt|tomato|cheese|onion|mushroom|paprika|sumac|zaatar|arabic|oriental|charcoal|smoky|honey\s*mustard)\b|عادي|أصلي|اصلي|كلاسيك|حار|بارد|فلفل|ثوم|ليمون|أعشاب|اعشاب|باربكيو|شاورما|تندوري|تكا|مكسيكي|إيطالي|ايطالي|عسل|خردل|صويا|زبدة|نعناع|طماطم|جبن|بصل|فطر|بابريكا|سماق|زعتر|عربي|شرقي|فحم)/i

const SAFE_SINGLE_SKU_MIXED_COMPOUNDS_REGEX =
  /\bmixed\s+(?:parts|cuts|pieces|chicken\s+parts|vegetables|veggies|greens|salads?|herbs|spices|berries|fruits?|nuts|seeds|grains|beans|legumes|pickles|seafood|grill)\b/gi

const ALWAYS_ASSORTMENT_TEXT_REGEX =
  /(?:\basstd\b|\bassorted\b|\bmulti[- ]?flavou?rs?\b|\bmulti[- ]?variants?\b|منوع|منوعة|منوعه|مشكل|مشكلة|مشكله)/i

export function hasExplicitAssortmentKeyword(text: string): boolean {
  if (!text) return false
  if (ALWAYS_ASSORTMENT_TEXT_REGEX.test(text)) return true
  const withoutSafeMixedCompounds = text.replace(SAFE_SINGLE_SKU_MIXED_COMPOUNDS_REGEX, ' ')
  return /\bmixed\b/i.test(withoutSafeMixedCompounds)
}

const EXPLICIT_ASSORTMENT_STATUSES = new Set([
  'assortment_indicated',
  'indicated_with_conflict',
  'choice_among_options',
  'unknown_composition',
  'multiple_variants',
  'ambiguous_alternatives',
  'explicit_assortment',
  'visual_multiple_variants',
  'assorted'
])

/**
 * Separates physical manufacturer packaging from retailer-level promotional quantities
 * using explicit structured signals and textual evidence — NEVER blind universal rewriting.
 */
export function resolveQuantityAndPromoSemantics(
  offer: Partial<UnifiedBatchOffer>,
  evidence?: MatchingEvidenceAnnotation | null
): QuantityAndPromoResolution {
  const diagnostics: string[] = []
  const rawPackCount =
    offer.inner_pack_count !== null && offer.inner_pack_count !== undefined && offer.inner_pack_count > 0
      ? Number(offer.inner_pack_count)
      : 1

  const resolvedEvidence = evidence ?? offer.matchingEvidence ?? null
  if (resolvedEvidence?.quantity_semantics === 'manufacturer_multipack') {
    const packCount =
      resolvedEvidence.manufacturer_pack_count && resolvedEvidence.manufacturer_pack_count > 1
        ? resolvedEvidence.manufacturer_pack_count
        : rawPackCount > 1
        ? rawPackCount
        : 1
    diagnostics.push(`Operator overlay verified manufacturer multipack (pack=${packCount}).`)
    return {
      manufacturerPackCount: packCount,
      promoPurchaseQuantity: resolvedEvidence.promo_purchase_quantity ?? null,
      promotionMechanic: offer.promotion_mechanic || null,
      packagingSemantics: 'manufacturer_multipack',
      isPackagingAmbiguous: false,
      diagnostics
    }
  }
  if (
    resolvedEvidence?.quantity_semantics === 'retail_promo_quantity' ||
    resolvedEvidence?.quantity_semantics === 'checkout_multibuy'
  ) {
    const promoQty = resolvedEvidence.promo_purchase_quantity ?? (rawPackCount > 1 ? rawPackCount : null)
    diagnostics.push(`Operator overlay verified retail promotional quantity (promo_qty=${promoQty}, pack=${resolvedEvidence.manufacturer_pack_count ?? 1}).`)
    return {
      manufacturerPackCount: resolvedEvidence.manufacturer_pack_count ?? 1,
      promoPurchaseQuantity: promoQty,
      promotionMechanic: offer.promotion_mechanic || null,
      packagingSemantics: 'single_unit_with_retail_promo',
      isPackagingAmbiguous: false,
      diagnostics
    }
  }

  // Extract canonical structured promotion fields if present
  const canonicalPromo = (offer.canonical as any)?.promotion
  const canonicalContent = (offer.canonical as any)?.content

  const titleText = toLatinDigitsSimple(`${offer.titleEn || ''} ${offer.titleAr || ''}`.trim())
  const promoText = toLatinDigitsSimple(
    `${offer.promoNotes || ''} ${offer.free_units_text || ''} ${
      typeof canonicalPromo?.special_offer === 'string' ? canonicalPromo.special_offer : ''
    }`.trim()
  )
  const sizeTextForRegex = toLatinDigitsSimple(`${offer.sizeOrWeight || ''} ${canonicalContent?.size_text || ''}`.trim())
  const combinedText = `${titleText} ${sizeTextForRegex} ${promoText}`.trim()

  const promotionMechanic: string | null =
    offer.promotion_mechanic ||
    (canonicalPromo && typeof canonicalPromo.mechanic === 'string' ? canonicalPromo.mechanic : null)

  let explicitPromoQty: number | null =
    offer.promo_condition_quantity !== undefined && offer.promo_condition_quantity !== null
      ? Number(offer.promo_condition_quantity)
      : null

  const promoQtyMatch = RETAIL_PROMO_QTY_REGEX.exec(combinedText)
  if (explicitPromoQty === null && promoQtyMatch) {
    const captured = promoQtyMatch.slice(1).find((v) => v && /^\d+$/.test(v))
    if (captured) explicitPromoQty = Number(captured)
  }

  const multipackSourceText = `${titleText} ${sizeTextForRegex}`.trim()
  const multipackMatch = MANUFACTURER_MULTIPACK_REGEX.exec(multipackSourceText)
  const sizeFirstMatch =
    /(?:\b\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|ml|l|lt|ltr|sheet|sheets)\s*[x×]\s*(\d+)\b|\b\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|ml|l|lt|ltr)\s+(\d+)\s*s\b)/i.exec(
      multipackSourceText
    )
  const capturedMultipackNum = multipackMatch
    ? multipackMatch.slice(1).find((v) => v && /^\d+$/.test(v))
    : undefined
  const isSmallSizeFirstFallback = Boolean(
    sizeFirstMatch &&
      capturedMultipackNum &&
      Number(capturedMultipackNum) < 4 &&
      !/\b(?:pack|carton|box)\b|كرتون|ربطة/i.test(multipackSourceText)
  )
  const hasExplicitMultipackText = Boolean(multipackMatch) && !isSmallSizeFirstFallback

  // Handle concise standalone multi-buy strings in promo fields (e.g. promotion.special_offer = "2pcs", "3 pcs", "9 حبات")
  // only when there is no manufacturer multipack notation.
  const barePromoMatch =
    !hasExplicitMultipackText &&
    BARE_PROMO_QTY_REGEX.exec(
      toLatinDigitsSimple(
        String(
          (typeof canonicalPromo?.special_offer === 'string' && canonicalPromo.special_offer) ||
            offer.promoNotes ||
            ''
        )
      )
    )
  if (barePromoMatch) {
    const bareQty = Number(barePromoMatch[1])
    if (bareQty > 1 && (explicitPromoQty === null || explicitPromoQty === bareQty)) {
      explicitPromoQty = bareQty
    }
  }

  const hasPlusFreeBonus = IN_PACK_BONUS_REGEX.test(combinedText)
  const hasExplicitCheckoutPromo =
    offer.quantity_semantics === 'retail_promo_quantity' ||
    offer.quantity_semantics === 'checkout_multibuy' ||
    EXPLICIT_MULTI_BUY_WORDING_REGEX.test(combinedText) ||
    EXPLICIT_CHECKOUT_BXGY_REGEX.test(combinedText)
  const capturedMultipackCount = capturedMultipackNum ? Number(capturedMultipackNum) : null
  const hasConsistentMultipackCount =
    capturedMultipackCount === null ||
    rawPackCount <= 1 ||
    capturedMultipackCount === rawPackCount

  const isInPackBonusMultipack =
    hasExplicitMultipackText &&
    hasConsistentMultipackCount &&
    hasPlusFreeBonus &&
    !hasExplicitCheckoutPromo

  const hasMultiBuyMechanic =
    !isInPackBonusMultipack &&
    (promotionMechanic === 'multi_buy' ||
      promotionMechanic === 'bxgy' ||
      RETAIL_PROMO_QTY_REGEX.test(combinedText) ||
      Boolean(barePromoMatch) ||
      PROMO_MECHANIC_REGEX.test(combinedText))

  // Explicit ambiguity marker from caller/source contract
  if (offer.quantity_semantics === 'ambiguous') {
    diagnostics.push('Quantity semantics explicitly marked ambiguous in source offer')
    return {
      manufacturerPackCount: rawPackCount,
      promoPurchaseQuantity: explicitPromoQty,
      promotionMechanic,
      packagingSemantics: 'ambiguous',
      isPackagingAmbiguous: true,
      diagnostics
    }
  }

  // Legacy/structured conflict: unit-priced "Each" alongside pack_quantity > 1 (e.g. Othaim Sadia 5 flavors @ Each)
  const rawPriceCondition = String(
    (offer.canonical as any)?.price_condition || offer.promoNotes || ''
  ).trim()
  const isPricedEach = /^(?:each|per\s*each|للحبة|للحبه|للقطعة|للقطعه)$/i.test(rawPriceCondition)
  if (rawPackCount > 1 && isPricedEach) {
    diagnostics.push(
      `PACKAGING_AMBIGUITY: price_condition="${rawPriceCondition}" conflicts with pack_quantity=${rawPackCount} (individual unit pricing vs sealed multipack).`
    )
    return {
      manufacturerPackCount: 1,
      promoPurchaseQuantity: null,
      promotionMechanic,
      packagingSemantics: 'ambiguous',
      isPackagingAmbiguous: true,
      diagnostics
    }
  }

  // Case A: Explicit conflict between manufacturer multipack pattern and promo-only expectation
  // e.g. both "4x250ml" and quantity_semantics = 'retail_promo_quantity' with promo qty = 4 without carton context
  if (
    (offer.quantity_semantics === 'retail_promo_quantity' ||
      offer.quantity_semantics === 'checkout_multibuy') &&
    hasExplicitMultipackText &&
    !hasMultiBuyMechanic
  ) {
    diagnostics.push('Conflicting multipack text vs retail_promo_quantity assertion without promo mechanic evidence')
    return {
      manufacturerPackCount: rawPackCount,
      promoPurchaseQuantity: explicitPromoQty,
      promotionMechanic,
      packagingSemantics: 'ambiguous',
      isPackagingAmbiguous: true,
      diagnostics
    }
  }

  // In-pack X+Y bonus sealed multipacks (e.g. Softy "7+3 Free" 10 x 130 Sheets) require explicit sealed multipack text
  const resolvedBonusMultipackCount =
    rawPackCount > 1 ? rawPackCount : capturedMultipackCount ?? 1
  if (isInPackBonusMultipack && resolvedBonusMultipackCount > 1) {
    diagnostics.push(`Confirmed in-pack bonus sealed multipack (${resolvedBonusMultipackCount})`)
    return {
      manufacturerPackCount: resolvedBonusMultipackCount,
      promoPurchaseQuantity: null,
      promotionMechanic,
      packagingSemantics: 'manufacturer_multipack',
      isPackagingAmbiguous: false,
      diagnostics
    }
  }

  // Never infer manufacturer_pack_count = N + M from N+M Free alone (even when pack_quantity = N + M)
  if (hasPlusFreeBonus && !hasExplicitCheckoutPromo && !hasExplicitMultipackText) {
    diagnostics.push(
      'PACKAGING_AMBIGUITY: N+M Free bonus phrasing lacks both explicit sealed multipack notation (e.g. "6x125g" or "Pack of 6") and explicit checkout promo wording (e.g. "Buy 5 Get 1 Free").'
    )
    return {
      manufacturerPackCount: 1,
      promoPurchaseQuantity: null,
      promotionMechanic,
      packagingSemantics: 'ambiguous',
      isPackagingAmbiguous: true,
      diagnostics
    }
  }

  // Case B: Clear retail promo multi-buy on a single-unit product
  // e.g. Seara 900g (Promo 3 Pieces) where canonical had size_text=3x900g or pack=3 + mechanic=multi_buy,
  // OR Fakieh 600g (Buy 2 pcs promo) where pack_quantity=2 without manufacturer multipack evidence.
  if (
    (explicitPromoQty !== null && explicitPromoQty > 1) ||
    ((hasMultiBuyMechanic ||
      offer.quantity_semantics === 'retail_promo_quantity' ||
      offer.quantity_semantics === 'checkout_multibuy') &&
      !hasExplicitMultipackText)
  ) {
    // If title/size explicitly specifies a true manufacturer carton (e.g. "10 x 900g" AND retail promo buy 2 cartons),
    // keep the carton count as manufacturer pack and promo condition separate.
    const explicitCartonCount = capturedMultipackNum ? Number(capturedMultipackNum) : null
    const isBuyXOfDistinctCarton =
      explicitCartonCount !== null &&
      explicitCartonCount > 1 &&
      rawPackCount === explicitCartonCount &&
      explicitPromoQty !== null &&
      explicitCartonCount !== explicitPromoQty

    if (isBuyXOfDistinctCarton) {
      diagnostics.push(
        `Manufacturer multipack (${explicitCartonCount}) separated from retail purchase quantity (${explicitPromoQty})`
      )
      return {
        manufacturerPackCount: explicitCartonCount,
        promoPurchaseQuantity: explicitPromoQty,
        promotionMechanic,
        packagingSemantics: 'manufacturer_multipack',
        isPackagingAmbiguous: false,
        diagnostics
      }
    }

    // If the multi-buy quantity matches rawPackCount, rawPackCount is 1, or explicit checkout BXGY/retail promo wording applies,
    // physical manufacturer pack is 1 single SKU while promoPurchaseQuantity holds the multi-buy count.
    if (
      rawPackCount === 1 ||
      explicitPromoQty === rawPackCount ||
      offer.quantity_semantics === 'retail_promo_quantity' ||
      offer.quantity_semantics === 'checkout_multibuy' ||
      promotionMechanic === 'multi_buy' ||
      promotionMechanic === 'bxgy' ||
      EXPLICIT_CHECKOUT_BXGY_REGEX.test(combinedText)
    ) {
      const promoQty = explicitPromoQty ?? (rawPackCount > 1 ? rawPackCount : null)
      diagnostics.push(
        `Separated single-unit manufacturer pack (1) from retail multi-buy promotion qty (${promoQty ?? 'unspecified'})`
      )
      return {
        manufacturerPackCount: 1,
        promoPurchaseQuantity: promoQty,
        promotionMechanic,
        packagingSemantics: 'single_unit_with_retail_promo',
        isPackagingAmbiguous: false,
        diagnostics
      }
    }
  }

  // Case C: rawPackCount > 1 without retail promo signals — verify explicit manufacturer multipack evidence!
  if (rawPackCount > 1) {
    if (
      (hasPlusFreeBonus ? hasExplicitMultipackText && hasConsistentMultipackCount : hasExplicitMultipackText) ||
      (!hasPlusFreeBonus && offer.quantity_semantics === 'manufacturer_multipack')
    ) {
      diagnostics.push(`Confirmed manufacturer multipack of ${rawPackCount}`)
      return {
        manufacturerPackCount: rawPackCount,
        promoPurchaseQuantity: null,
        promotionMechanic,
        packagingSemantics: 'manufacturer_multipack',
        isPackagingAmbiguous: false,
        diagnostics
      }
    }

    // Ambiguous! pack > 1 exists in structured data, but neither title/size indicates a sealed multipack
    // nor promo fields indicate retail multi-buy. Refuse forced match or forced temp SKU creation.
    diagnostics.push(
      `PACKAGING_AMBIGUITY: pack_quantity=${rawPackCount} has neither explicit manufacturer multipack text (e.g. "${rawPackCount}x...") nor explicit retail promo multi-buy evidence.`
    )
    return {
      manufacturerPackCount: rawPackCount,
      promoPurchaseQuantity: null,
      promotionMechanic,
      packagingSemantics: 'ambiguous',
      isPackagingAmbiguous: true,
      diagnostics
    }
  }

  // Case D: Promo mechanic mentions "multi_buy" or unknown promo quantity with missing size or uncertain quantity
  if (
    hasMultiBuyMechanic &&
    explicitPromoQty === null &&
    (offer.each_size_value === null || offer.each_size_value === undefined)
  ) {
    diagnostics.push('Promotional multi-buy mechanic present without clear unit size or quantity')
    return {
      manufacturerPackCount: 1,
      promoPurchaseQuantity: null,
      promotionMechanic,
      packagingSemantics: 'ambiguous',
      isPackagingAmbiguous: true,
      diagnostics
    }
  }

  // Case E: Standard single manufacturer unit (including customer purchase limits like max 5 per customer)
  if (offer.customer_limit && offer.customer_limit > 0) {
    diagnostics.push(`Customer purchase limit (${offer.customer_limit}) does not change manufacturer pack=1`)
  }
  return {
    manufacturerPackCount: 1,
    promoPurchaseQuantity: null,
    promotionMechanic,
    packagingSemantics: 'single_unit_retail',
    isPackagingAmbiguous: false,
    diagnostics
  }
}

/**
 * Separates Question B (Is the extracted identity sufficiently complete & unambiguous?)
 * from Question A (Is it in the catalog?). Must run globally across matching, caching,
 * temporary registry, benchmark runner, and publication preflight.
 */
export function evaluateIdentitySufficiency(
  attrs: Partial<NormalizedIdentityAttributes>,
  offer?: Partial<UnifiedBatchOffer> | null,
  evidence?: MatchingEvidenceAnnotation | null
): IdentitySufficiencyEvaluation {
  const codes: string[] = []
  const reasons: string[] = []
  let isAssortment = Boolean(attrs.isAssortment)
  let evidenceGapDetected = false

  const resolvedEvidence = evidence ?? attrs.evidenceAnnotation ?? offer?.matchingEvidence ?? null
  const titleEn = (attrs.productNameEn || offer?.titleEn || '').trim()
  const titleAr = (attrs.productNameAr || offer?.titleAr || '').trim()
  const combinedTitle = `${titleEn} ${titleAr}`.trim()

  // 1. Brand completeness
  if (attrs.brandStatus === 'multi_brand') {
    isAssortment = true
    codes.push('MULTI_BRAND_ASSORTMENT')
    reasons.push('Multi-brand offer spans multiple manufacturers and cannot map to one SKU.')
  } else if (attrs.brandStatus === 'unbranded') {
    codes.push('UNBRANDED_COMMODITY')
    reasons.push('Unbranded loose/commodity offer requires manual verification before catalog SKU assignment.')
  } else if (attrs.brandStatus === 'unknown') {
    codes.push('UNKNOWN_BRAND')
    reasons.push('Brand identity is missing or unknown.')
  }

  // 2. Evidence overlay / canonical assortment status (and item-matched raw_attributes fallback)
  const matchedRawEntry = findMatchingRawExtractionEntry(offer?.canonical)
  const rawAssortmentFlag = matchedRawEntry?.is_multi_brand_or_variant === true
  const v3Card = (offer?.canonical as any)?.reconciled_v3
  const v3SubItemsCount = Array.isArray(v3Card?.sub_items) ? v3Card.sub_items.length : 0
  const v3RetentionMode = (offer as any)?.v3RetentionMode || null
  const isV3MultiVariantParent =
    (v3SubItemsCount > 1 && offer?.decomposedChildIndex == null) ||
    v3RetentionMode === 'decomposed_shared_promo_parent' ||
    v3RetentionMode === 'unsplit_assortment'

  const assortmentStatus =
    attrs.assortmentStatus ||
    offer?.assortment_status ||
    v3Card?.assortment?.status ||
    (offer?.canonical as any)?.assortment?.status ||
    (offer?.canonical as any)?.contract_v2?.assortment?.status ||
    (rawAssortmentFlag ? 'multiple_variants' : null)

  if (resolvedEvidence) {
    if (
      resolvedEvidence.assortment_status === 'multiple_variants' ||
      resolvedEvidence.assortment_status === 'ambiguous_alternatives' ||
      resolvedEvidence.identity_resolution === 'requires_review'
    ) {
      isAssortment = true
      codes.push('EVIDENCE_OVERLAY_ASSORTMENT')
      reasons.push(
        `Verified matching evidence (${resolvedEvidence.evidence_source}) flags ${resolvedEvidence.assortment_status}: ${resolvedEvidence.notes || 'requires operator review'}.`
      )
    }
  }

  const operatorConfirmedSingleSku = resolvedEvidence?.assortment_status === 'single_sku'
  const isResolvedAssortment =
    assortmentStatus === 'unsplit_assortment' ||
    attrs.assortmentStatus === 'unsplit_assortment' ||
    offer?.assortment_status === 'unsplit_assortment'

  if (!operatorConfirmedSingleSku && isResolvedAssortment) {
    // Operator-confirmed unsplit_assortment remains provisional-eligible for assortment-level
    // non-catalog publication while isAssortment=true blocks any single-SKU catalog link.
    isAssortment = true
  } else if (
    !operatorConfirmedSingleSku &&
    (isV3MultiVariantParent || (assortmentStatus && EXPLICIT_ASSORTMENT_STATUSES.has(assortmentStatus.toLowerCase())))
  ) {
    isAssortment = true
    codes.push('STRUCTURED_ASSORTMENT_STATUS')
    reasons.push(
      `Structured assortment (${assortmentStatus || v3RetentionMode || 'multi_sub_items'}) prohibits single-SKU linking.`
    )
  }

  if (!isResolvedAssortment) {

    // 3. Textual assortment / slash / binary-choice multi-product indicators
    if (!operatorConfirmedSingleSku && hasExplicitAssortmentKeyword(combinedTitle)) {
      isAssortment = true
      codes.push('TEXT_ASSORTMENT_KEYWORD')
      reasons.push('Offer title explicitly indicates assorted or mixed product variants.')
    }

    const isUnitPriceSlashOnly = (t: string) =>
      /^[^/]+\/\s*(?:kg|kilo|bag|pc|pcs|piece|pack|ctn|carton|كيلو|كجم|كغ|حبة|قطعة|كيس|ربطة|علبة|كرتون)\s*$/i.test(
        t.trim()
      )
    const hasSemanticSlash = (t: string) => {
      if (!t || isUnitPriceSlashOnly(t)) return false
      // Ignore harmless fraction notation like "1/2 Price"
      const withoutFraction = t.replace(/\b1\s*\/\s*2\b/g, '').trim()
      return /[/]/.test(withoutFraction)
    }
    const hasChoiceJoiner = /\s+(?:or|أو)\s+/i.test(combinedTitle)

    if (!operatorConfirmedSingleSku && (hasSemanticSlash(titleEn) || hasSemanticSlash(titleAr) || hasChoiceJoiner)) {
      isAssortment = true
      codes.push('MULTI_OPTION_SLASH_TITLE')
      reasons.push('Slash-separated or choice-joined ("or" / "أو") alternatives combine multiple distinct products/variants under one offer.')
    }
  }

  // 4. Packaging semantics ambiguity (honoring operator-verified overlay when explicitly confirmed)
  const effectivePkgSemantics = resolvedEvidence?.quantity_semantics
    ? resolveQuantityAndPromoSemantics(offer || {}, resolvedEvidence).packagingSemantics
    : attrs.packagingSemantics

  if (effectivePkgSemantics === 'ambiguous') {
    codes.push('PACKAGING_SEMANTICS_AMBIGUOUS')
    reasons.push('Pack quantity vs promotional purchase quantity cannot be disambiguated from available evidence.')
  }

  // 5. Core product identity completeness (title + packaged net weight + unit)
  if (!titleEn && !titleAr) {
    codes.push('MISSING_PRODUCT_IDENTITY')
    reasons.push('Product title is missing in both English and Arabic.')
  }

  const v3NonGrocerySpecs = (offer?.canonical as any)?.reconciled_v3?.non_grocery_specs
  const explicitNonGroceryDomains = new Set([
    'electronics',
    'appliance',
    'appliances',
    'textiles_home',
    'home_appliance',
    'apparel',
    'furniture',
    'tools',
    'automotive',
    'toys',
    'stationery',
    'other_non_grocery'
  ])
  const v3DomainRaw = String(v3NonGrocerySpecs?.domain || '').toLowerCase().trim()
  const offerCatRaw = String(offer?.category || '').toLowerCase().trim()
  const canonicalDomainRaw = String((offer?.canonical as any)?.item_domain || '').toLowerCase().trim()
  const nonGroceryTitleRx =
    /\b(?:smart\s*tv|qled|oled|uhd|led\s*tv|television|microwave|air\s*fryer|vacuum|blender|food\s*processor|kettle|iron|steam\s*iron|heater|washing\s*machine|refrigerator|freezer|air\s*conditioner|laptop|tablet|smartphone|mobile\s*phone|printer|router|headphone|earbud|speaker|camera|drill|suitcase|luggage|blanket|comforter|pillow|bedsheet|towel|frying\s*pan|cookware|pressure\s*cooker)\b|تلفزيون|شاشة|ميكروويف|قلاية\s*هوائية|مكنسة|خلاط|غلاية|مكواة|غسالة|ثلاجة|فريزر|مكيف|لابتوب|جوال|سماعة|حقيبة\s*سفر|بطانية|لحاف|وسادة|مخدة|منشفة|مقلاة|أواني|طنجرة\s*ضغط/i
  const detectedNonGroceryDomain =
    (v3DomainRaw && explicitNonGroceryDomains.has(v3DomainRaw) && v3DomainRaw) ||
    (canonicalDomainRaw && explicitNonGroceryDomains.has(canonicalDomainRaw) && canonicalDomainRaw) ||
    (offerCatRaw && explicitNonGroceryDomains.has(offerCatRaw) && offerCatRaw) ||
    (v3NonGrocerySpecs?.excluded_from_default_grocery_feed === true ? 'other_non_grocery' : '') ||
    (Array.isArray(offer?.quarantineReasons) && offer.quarantineReasons.includes('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')
      ? 'other_non_grocery'
      : '') ||
    (nonGroceryTitleRx.test(combinedTitle) ? 'non_grocery' : '')
  const isNonGroceryItem = Boolean(detectedNonGroceryDomain)

  if (isNonGroceryItem) {
    if (!codes.includes('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')) {
      codes.push('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')
      reasons.push(
        `Non-grocery exclusion (${detectedNonGroceryDomain}): excluded from the default grocery consumer feed; grocery net weight/volume requirements do not apply.`
      )
    }
  } else {
    const isPieceUnit =
      attrs.eachSizeUnit === 'pcs' ||
      attrs.eachSizeUnit === 'pc' ||
      attrs.eachSizeUnit === 'piece'
    const hasExplicitPhysicalDimension =
      /\b\d+(?:\.\d+)?\s*(?:x|×|\*)\s*\d+(?:\.\d+)?\s*(?:cm|mm|m|inch|in)\b|\b\d+(?:\.\d+)?\s*(?:cm|mm|inch|ft)\b/i.test(
        `${combinedTitle} ${offer?.sizeOrWeight || ''}`
      )
    const isBeverageOrLiquidInPieces =
      isPieceUnit &&
      /(?:\b(?:coca[\s-]?cola|cola|pepsi|soda|juice|nectar|milk|water|oil|shampoo|detergent|bleach|drink|beverage)\b|كوكا\s*كولا|كوكاكولا|بيبسي|عصير|حليب|لبن|مياه|زيت|شامبو)/i.test(
        `${combinedTitle} ${attrs.brandNameEn || ''} ${attrs.brandNameAr || ''}`
      )
    const isUnderspecifiedSinglePieceCount =
      isPieceUnit &&
      attrs.eachSizeValue !== null &&
      attrs.eachSizeValue !== undefined &&
      attrs.eachSizeValue <= 1 &&
      !hasExplicitPhysicalDimension

    if (
      (attrs.eachSizeValue === null || attrs.eachSizeValue === undefined || !attrs.eachSizeUnit) &&
      attrs.saleUnitType !== 'kg'
    ) {
      codes.push('MISSING_UNIT_SIZE')
      reasons.push('Net unit size/weight is missing and required for reliable catalog SKU matching.')
    } else if ((isBeverageOrLiquidInPieces || isUnderspecifiedSinglePieceCount) && !isResolvedAssortment) {
      codes.push('MISSING_UNIT_SIZE')
      reasons.push(
        'Unit count expressed in pieces ("1 pcs" / unmeasured beverage pieces) does not establish individual physical volume or net weight.'
      )
    }
  }

  // 6. Variant / recipe ambiguity ONLY when prepared/seasoned/marinated/flavored requires distinction
  if (PREPARED_MARINADE_REGEX.test(combinedTitle)) {
    const hasRecipeModifier =
      Boolean(attrs.variantOrFlavor && attrs.variantOrFlavor.trim().length > 1) ||
      DISTINGUISHING_RECIPE_MODIFIER_REGEX.test(combinedTitle)

    if (!hasRecipeModifier) {
      codes.push('AMBIGUOUS_UNSPECIFIED_MARINADE_OR_FLAVOR')
      reasons.push(
        'Prepared/marinated/flavored product lacks distinguishing recipe or flavor specification needed to separate manufacturer SKUs.'
      )
    }
  }

  // Diagnostic note if known generic multi-SKU title exists without assortment metadata (Section 5.5)
  if (!resolvedEvidence && !assortmentStatus && !isAssortment && codes.length === 0) {
    const promoLim = offer?.customer_limit ?? null
    if (promoLim && promoLim >= 5 && /nuggets|assort/i.test(combinedTitle)) {
      evidenceGapDetected = true
    }
  }

  return {
    isSufficient: codes.length === 0,
    isAssortment,
    evidenceGapDetected,
    codes,
    reasons
  }
}
