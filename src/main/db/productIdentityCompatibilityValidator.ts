import { normalizeEnglishText } from '../../shared/utils/textNormalization'
import {
  canonicalizeUnit,
  parseAndNormalizeQuantity,
  PROMO_MECHANIC_REGEX
} from '../../shared/utils/priceAndUnitNormalizer'
import {
  getCanonicalBrandId,
  extractNormalizedTokenBag,
  areTokenBagsCompatible
} from '../../shared/utils/bilingualTokenNormalizer'
import {
  extractStructuredQuantityConfig,
  comparePackageConfigurations,
  extractStructuredVariantFacts,
  compareProductVariants,
  classifyCommodityPackaging
} from './variantDisambiguationService'
import {
  validateCatalogMatchingWithPackageSafeguards,
  detectPackageConfigurationContext
} from '../../shared/utils/packageQuantitySafeguards'
import type { CanonicalExtractionUnit } from '../../shared/types/leafletExtraction'

export {
  extractStructuredQuantityConfig,
  comparePackageConfigurations,
  extractStructuredVariantFacts,
  compareProductVariants,
  classifyCommodityPackaging,
  validateCatalogMatchingWithPackageSafeguards,
  detectPackageConfigurationContext
}

export function classifyOfferAmbiguity(offer: {
  title_en: string
  title_ar?: string | null
  brand_name?: string | null
  brand_state?: string | null
  sale_unit_type?: string | null
  inner_pack_count?: number | null
  each_size_value?: number | null
  each_size_unit?: string | null
  assortment_status?: string | null
}): { isAmbiguous: boolean; reason?: 'assortment' | 'loose_commodity' | 'generic_unbranded' | 'missing_identity'; details?: string } {
  const title = (offer.title_en || '').trim()
  const lowerTitle = title.toLowerCase()

  // 1. Assortment checks (WIFRAN-07G §6.A, WIFRAN-07H §2)
  const isExplicitAssortment =
    offer.assortment_status === 'assortment_indicated' ||
    offer.assortment_status === 'indicated_with_conflict' ||
    offer.assortment_status === 'choice_among_options'

  const hasAssortmentKeywords =
    lowerTitle.includes('asstd') ||
    lowerTitle.includes('assorted') ||
    lowerTitle.includes('5+1 free') ||
    lowerTitle.includes('منوع') ||
    lowerTitle.includes('مشكل')

  if (isExplicitAssortment || hasAssortmentKeywords) {
    return {
      isAmbiguous: true,
      reason: 'assortment',
      details: 'Assorted promotional bundle, multi-variety pack, or unspecified variant options'
    }
  }

  // Multi-brand or multi-choice bundle slashes in title (e.g. Taj Al-Hind / Taj Mahal, L'Oreal / Garnier, Oska / Arwa)
  if (
    lowerTitle.includes(' / ') ||
    lowerTitle.includes(' /') ||
    lowerTitle.includes('/ ')
  ) {
    return {
      isAmbiguous: true,
      reason: 'assortment',
      details: 'Multiple alternative brands or products combined in a single offer'
    }
  }

  // Brand conflict between English and Arabic title
  if (
    (lowerTitle.includes('krypton') && offer.title_ar?.includes('جيباس')) ||
    (lowerTitle.includes('geepas') && offer.title_ar?.includes('كريبتون'))
  ) {
    return {
      isAmbiguous: true,
      reason: 'assortment',
      details: 'Brand conflict between English and Arabic title'
    }
  }

  // 2. Loose measured-weight unbranded commodities (WIFRAN-07G §6.C, WIFRAN-07H §2)
  const isPerKg = offer.sale_unit_type === 'kg' || lowerTitle.includes('per kg') || lowerTitle.includes('per kg')
  const hasConfirmedBrand = offer.brand_name && offer.brand_state === 'confirmed'
  if (isPerKg && !hasConfirmedBrand) {
    return {
      isAmbiguous: true,
      reason: 'loose_commodity',
      details: 'Unbranded loose measured-weight commodity (meat, fish, produce or bulk grain)'
    }
  }

  // 3. Generic unbranded appliances/cookware/items lacking concrete brand or model (WIFRAN-07G §6.B)
  const isGenericTitle =
    lowerTitle.startsWith('electric peeling') ||
    lowerTitle.startsWith('hand mixer') ||
    lowerTitle.startsWith('plastic dish drainer') ||
    lowerTitle.startsWith('stainless steel fry pan') ||
    lowerTitle.startsWith('camping backpack') ||
    lowerTitle.startsWith('writing tab') ||
    lowerTitle.startsWith('wireless neckband') ||
    lowerTitle.startsWith('true wireless earbuds')

  if (!offer.brand_name && isGenericTitle) {
    return {
      isAmbiguous: true,
      reason: 'generic_unbranded',
      details: 'Generic unbranded item lacking concrete brand, model or verifiable identity'
    }
  }

  // Non-grocery items lacking specific model number or pattern/color specification
  if (lowerTitle.includes('hair trimmer') || lowerTitle.includes('bed sheet') || lowerTitle.includes('flashlight')) {
    return {
      isAmbiguous: true,
      reason: 'missing_identity',
      details: 'General merchandise item lacking specific model number or pattern/color specification'
    }
  }

  return { isAmbiguous: false }
}

export interface IdentityCompatibilityResult {
  isCompatible: boolean
  status:
    | 'verified_compatible'
    | 'rejected_contradictory'
    | 'rejected_insufficient_evidence'
    | 'rejected_ambiguous_offer'
    | 'rejected_multiple_candidates'
    | 'rejected_candidate_search_incomplete'
    | 'rejected_database_lookup_failure'
    | 'no_eligible_candidate'
  reason: string
  details?: string
  conflicts?: string[]
}

export interface ExtractedIdentityFacts {
  brand: string | null
  flavorOrVariant: string | null
  fatContent: 'full_fat' | 'low_fat' | 'skimmed' | null
  sizeValue: number | null
  sizeUnit: CanonicalExtractionUnit | null
  packCount: number | null
  saleUnitType: string | null
  categorySlug: string | null
  domain: string | null
  rawTitleEn: string
  rawTitleAr: string
  isAmbiguous: boolean
  ambiguityReason?: string
}

export function extractFatContent(text: string): 'full_fat' | 'low_fat' | 'skimmed' | null {
  if (!text) return null
  const lower = text.toLowerCase()

  // Skimmed / Zero Fat
  if (
    /\b(skimmed|zero\s*fat|fat\s*free|non[\s-]*fat)\b/i.test(lower) ||
    /(خالي\s*الدسم|بدون\s*دسم|منزوع\s*الدسم)/.test(text)
  ) {
    return 'skimmed'
  }

  // Low Fat
  if (
    /\b(low\s*fat|semi[\s-]*skimmed|light)\b/i.test(lower) ||
    /(قليل\s*الدسم|لايت)/.test(text)
  ) {
    return 'low_fat'
  }

  // Full Fat / Full Cream
  if (
    /\b(full\s*fat|full\s*cream|whole\s*milk)\b/i.test(lower) ||
    /(كامل\s*الدسم)/.test(text)
  ) {
    return 'full_fat'
  }

  return null
}

export function extractFlavorOrCut(text: string): string | null {
  if (!text) return null
  const lower = text.toLowerCase()

  // Chicken cuts
  if (/\b(drumstick|drumsticks|سيقان)\b/i.test(lower)) return 'drumstick'
  if (/\b(fillet|breast|صدور|فيليه)\b/i.test(lower)) return 'fillet'
  if (/\b(wing|wings|أجنحة)\b/i.test(lower)) return 'wing'
  if (/\b(whole|كامل)\b/i.test(lower) && /\b(chicken|دجاج)\b/i.test(lower)) return 'whole_chicken'

  // Flavors
  if (/\b(chicken\s*curry|curry)\b/i.test(lower) || /كاري/.test(text)) return 'curry'
  if (/\b(beef|meat)\b/i.test(lower) || /بقر|لحم/.test(text)) return 'beef'
  if (/\bchicken\b/i.test(lower) || /دجاج/.test(text)) return 'chicken'
  if (/\b(strawberry|فراولة)\b/i.test(lower)) return 'strawberry'
  if (/\b(chocolate|شوكولاته|شوكولاتة)\b/i.test(lower)) return 'chocolate'
  if (/\b(vanilla|فانيلا|فانيليا)\b/i.test(lower)) return 'vanilla'
  if (/\b(orange|برتقال)\b/i.test(lower)) return 'orange'
  if (/\b(mango|مانجو|مانجا)\b/i.test(lower)) return 'mango'
  if (/\b(lemon|lime|ليمون)\b/i.test(lower)) return 'lemon'

  return null
}

export function extractOfferIdentityFacts(offer: any): ExtractedIdentityFacts {
  const titleEn = (
    offer.titleEn ||
    offer.title_en ||
    offer.originalOcr?.titleEn ||
    offer.product_name_en ||
    ''
  ).trim()
  const titleAr = (
    offer.titleAr ||
    offer.title_ar ||
    offer.originalOcr?.titleAr ||
    offer.product_name_ar ||
    ''
  ).trim()

  const combinedText = `${titleEn} ${titleAr}`

  // 1. Ambiguity check
  const ambiguity = classifyOfferAmbiguity({
    title_en: titleEn,
    title_ar: titleAr,
    brand_name: offer.brand || offer.brand_name || offer.originalOcr?.brand || null,
    brand_state: offer.brand_state || null,
    sale_unit_type: offer.saleUnitType || offer.sale_unit_type || null,
    inner_pack_count: offer.innerPackCount != null ? Number(offer.innerPackCount) : (offer.inner_pack_count != null ? Number(offer.inner_pack_count) : null),
    each_size_value: offer.eachSizeValue != null ? Number(offer.eachSizeValue) : (offer.each_size_value != null ? Number(offer.each_size_value) : null),
    each_size_unit: offer.eachSizeUnit || offer.each_size_unit || null,
    assortment_status: offer.assortmentStatus || offer.assortment_status || offer.contract_v2?.assortment?.status || null
  })

  // 2. Brand
  let brand = (
    offer.brand ||
    offer.brand_name ||
    offer.brand_candidate_text ||
    offer.originalOcr?.brand ||
    offer.contract_v2?.product_facts?.brand_assertion?.value ||
    null
  )
  const offerBag = extractNormalizedTokenBag(combinedText)
  if (!brand && offerBag.brandId) {
    brand = offerBag.brandId
  }
  if (brand) {
    brand = normalizeEnglishText(brand)
  }

  // 3. Fat content & Flavor
  const fatContent =
    extractFatContent(offer.variantOrFlavor || offer.variant_or_flavor || '') ||
    extractFatContent(combinedText) ||
    offerBag.fatContentId
  const flavorOrVariant =
    extractFlavorOrCut(offer.variantOrFlavor || offer.variant_or_flavor || '') ||
    extractFlavorOrCut(combinedText) ||
    offerBag.cutId ||
    offerBag.grainVariantId

  // 4. Size & Pack quantity
  let sizeVal: number | null =
    offer.eachSizeValue != null ? Number(offer.eachSizeValue) : (offer.each_size_value != null ? Number(offer.each_size_value) : null)
  let sizeUnit: CanonicalExtractionUnit | null = canonicalizeUnit(offer.eachSizeUnit || offer.each_size_unit || null)
  let packCount: number | null =
    offer.innerPackCount != null ? Number(offer.innerPackCount) : (offer.inner_pack_count != null ? Number(offer.inner_pack_count) : null)

  const rawSizeText = offer.sizeOrWeight || offer.size_text || offer.originalOcr?.sizeOrWeight || ''

  const promoText = [
    titleEn,
    titleAr,
    rawSizeText,
    offer.condition_text,
    offer.promoNotes,
    offer.promo_notes,
    offer.bonus_wording
  ].filter(Boolean).join(' ')
  const isPromoMechanic = PROMO_MECHANIC_REGEX.test(promoText) || offer.promotion_mechanic === 'multi_buy'
  const hasExplicitMultipackInText = /\b\d+\s*x\s*\d+|\b\d+\s*[a-zA-Z\u0600-\u06FF]+\s*x\s*\d+|\b\d+\s*s\b/i.test(`${rawSizeText} ${titleEn} ${titleAr}`)

  if (isPromoMechanic && !hasExplicitMultipackInText && packCount != null && packCount > 1) {
    packCount = 1
  }

  // If size is still missing or packCount is missing, run parseAndNormalizeQuantity
  const parsedQty = parseAndNormalizeQuantity({
    size_text: rawSizeText,
    title_en: titleEn,
    title_ar: titleAr,
    item_domain: offer.item_domain || 'grocery',
    unit_type: offer.unit_type || null,
    ai_pack_quantity: packCount,
    ai_each_size_value: sizeVal,
    ai_each_size_unit: sizeUnit,
    is_uniform_size_across_variants: true,
    offer_price: offer.offer_price || null,
    price_basis: offer.price_basis || null,
    condition_text: offer.condition_text || offer.promoNotes || offer.promo_notes || offer.bonus_wording || null,
    promotion_mechanic: isPromoMechanic ? 'multi_buy' : null,
    bundle_quantity: null
  })

  if (sizeVal == null && parsedQty.each_size_value != null) {
    sizeVal = Number(parsedQty.each_size_value)
  }
  if (!sizeUnit && parsedQty.each_size_unit) {
    sizeUnit = canonicalizeUnit(parsedQty.each_size_unit)
  }
  if (packCount == null && parsedQty.pack_quantity != null) {
    packCount = parsedQty.pack_quantity
  }
  if (packCount == null) {
    packCount = 1
  }

  return {
    brand,
    flavorOrVariant,
    fatContent,
    sizeValue: sizeVal,
    sizeUnit,
    packCount,
    saleUnitType: offer.saleUnitType || offer.sale_unit_type || 'each',
    categorySlug: offer.categorySlug || offer.category_slug || offer.contract_v2?.product_facts?.category_slug || null,
    domain: offer.item_domain || null,
    rawTitleEn: titleEn,
    rawTitleAr: titleAr,
    isAmbiguous: ambiguity.isAmbiguous,
    ambiguityReason: ambiguity.reason
  }
}

export function extractProductIdentityFacts(product: any): ExtractedIdentityFacts {
  const titleEn = (product.name_en || product.item_name_complete || '').trim()
  const titleAr = (product.name_ar || '').trim()
  const combinedText = `${product.item_name_complete || ''} ${titleEn} ${titleAr} ${product.canonical_product_key || ''}`

  // Brand
  let brand = (
    product.brand_name ||
    product.brand ||
    product.canonical_product_key?.split(':')[0] ||
    null
  )
  if (brand && brand !== 'unbranded') {
    brand = normalizeEnglishText(brand)
  } else {
    brand = null
  }

  // Parse key if available: e.g. "nadec:nadec-uht-milk-full-fat-4x1lt:full-fat:1liter:4xpack"
  let keyVariant: string | null = null
  let keySizeVal: number | null = null
  let keySizeUnit: CanonicalExtractionUnit | null = null
  let keyPack: number | null = null

  if (product.canonical_product_key) {
    const parts = product.canonical_product_key.split(':')
    if (parts.length >= 5) {
      if (parts[2] && parts[2] !== 'std') {
        keyVariant = parts[2]
      }
      const sizeMatch = parts[3].match(/^(\d+(?:\.\d+)?)([a-z]+)$/i)
      if (sizeMatch) {
        keySizeVal = Number(sizeMatch[1])
        keySizeUnit = canonicalizeUnit(sizeMatch[2])
      }
      const packMatch = parts[4].match(/^(\d+)x/i)
      if (packMatch) {
        keyPack = Number(packMatch[1])
      }
    }
  }

  const prodBag = extractNormalizedTokenBag(combinedText)
  if (!brand && prodBag.brandId) {
    brand = prodBag.brandId
  }

  const fatContent =
    extractFatContent(product.variant_or_flavor || keyVariant || '') ||
    extractFatContent(combinedText) ||
    prodBag.fatContentId

  const flavorOrVariant =
    extractFlavorOrCut(product.variant_or_flavor || keyVariant || '') ||
    extractFlavorOrCut(combinedText) ||
    prodBag.cutId ||
    prodBag.grainVariantId

  let sizeVal: number | null =
    product.each_size_value != null
      ? Number(product.each_size_value)
      : (product.default_pack_size_value != null ? Number(product.default_pack_size_value) : keySizeVal)

  let sizeUnit: CanonicalExtractionUnit | null =
    canonicalizeUnit(product.each_size_unit || product.default_pack_size_unit) || keySizeUnit

  let packCount: number | null =
    product.inner_pack_count != null ? Number(product.inner_pack_count) : keyPack

  if (sizeVal == null || !sizeUnit || packCount == null) {
    const parsedQty = parseAndNormalizeQuantity({
      size_text: '',
      title_en: titleEn,
      title_ar: titleAr,
      item_domain: 'grocery',
      unit_type: null,
      ai_pack_quantity: null,
      ai_each_size_value: sizeVal,
      ai_each_size_unit: sizeUnit,
      is_uniform_size_across_variants: true,
      offer_price: null,
      price_basis: null,
      bundle_quantity: null
    })

    if (sizeVal == null && parsedQty.each_size_value != null) {
      sizeVal = Number(parsedQty.each_size_value)
    }
    if (!sizeUnit && parsedQty.each_size_unit) {
      sizeUnit = canonicalizeUnit(parsedQty.each_size_unit)
    }
    if (packCount == null && parsedQty.pack_quantity != null) {
      packCount = parsedQty.pack_quantity
    }
  }

  if (packCount == null) packCount = 1

  return {
    brand,
    flavorOrVariant,
    fatContent,
    sizeValue: sizeVal,
    sizeUnit,
    packCount,
    saleUnitType: product.sale_unit_type || 'each',
    categorySlug: product.category_slug || null,
    domain: null,
    rawTitleEn: titleEn,
    rawTitleAr: titleAr,
    isAmbiguous: false
  }
}

/**
 * Validates whether a candidate product in public.products is safely and unambiguously
 * compatible with the source offer's identity facts.
 */
export function validateProductIdentityCompatibility(
  offerInput: any,
  candidateProduct: any
): IdentityCompatibilityResult {
  if (!candidateProduct) {
    return {
      isCompatible: false,
      status: 'rejected_insufficient_evidence',
      reason: 'Candidate product is null or undefined.'
    }
  }

  // 1. Verification status gate
  const verStatus = candidateProduct.verification_status
  if (verStatus && ['unverified', 'candidate', 'rejected'].includes(verStatus)) {
    return {
      isCompatible: false,
      status: 'rejected_insufficient_evidence',
      reason: `Candidate product #${candidateProduct.id} is unverified (status: '${verStatus}'). Auto-match blocked.`
    }
  }

  // 2. Extract facts
  const offerFacts = extractOfferIdentityFacts(offerInput)
  const prodFacts = extractProductIdentityFacts(candidateProduct)

  // 3. Ambiguous offer gate (Assortments, loose per-kg commodities, generic merchandise)
  if (offerFacts.isAmbiguous) {
    return {
      isCompatible: false,
      status: 'rejected_ambiguous_offer',
      reason: `Offer represents an ambiguous entity (${offerFacts.ambiguityReason || 'assortment/commodity'}); catalog SKU assignment blocked.`
    }
  }

  const conflicts: string[] = []

  // 4. Brand check
  if (offerFacts.brand && prodFacts.brand) {
    const canonOfferBrand = getCanonicalBrandId(offerFacts.brand) || offerFacts.brand.toLowerCase().replace(/[^a-z0-9]/g, '')
    const canonProdBrand = getCanonicalBrandId(prodFacts.brand) || prodFacts.brand.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (canonOfferBrand && canonProdBrand && canonOfferBrand !== canonProdBrand && !canonOfferBrand.includes(canonProdBrand) && !canonProdBrand.includes(canonOfferBrand)) {
      conflicts.push(`Brand mismatch: offer='${offerFacts.brand}' vs product='${prodFacts.brand}'`)
    }
  }

  // 5 & 6. Variant, Cut & Fat Content Check (Milestone 2C Variant Disambiguation)
  const offerVar = extractStructuredVariantFacts({
    ...offerInput,
    title_en: offerFacts.rawTitleEn,
    title_ar: offerFacts.rawTitleAr,
    variant_or_flavor: offerFacts.flavorOrVariant
  })
  const prodVar = extractStructuredVariantFacts({
    ...candidateProduct,
    title_en: prodFacts.rawTitleEn,
    title_ar: prodFacts.rawTitleAr,
    variant_or_flavor: prodFacts.flavorOrVariant
  })
  const variantResult = compareProductVariants(offerVar, prodVar)
  if (!variantResult.isCompatible) {
    if (variantResult.status === 'rejected_insufficient_evidence' && conflicts.length === 0) {
      return {
        isCompatible: false,
        status: 'rejected_insufficient_evidence',
        reason: variantResult.reason,
        conflicts: variantResult.conflicts
      }
    }
    for (const c of variantResult.conflicts) {
      if (!conflicts.some((existing) => existing.includes(c) || c.includes(existing))) {
        conflicts.push(c)
      }
    }
  }

  // 7 & 8. 4D Package Configuration Check (Milestone 2C Pack-Size Disambiguation)
  const offerConfig = extractStructuredQuantityConfig({
    ...offerInput,
    title_en: offerFacts.rawTitleEn,
    title_ar: offerFacts.rawTitleAr,
    sale_unit_type: offerFacts.saleUnitType,
    inner_pack_count: offerFacts.packCount,
    each_size_value: offerFacts.sizeValue,
    each_size_unit: offerFacts.sizeUnit
  })
  const prodConfig = extractStructuredQuantityConfig({
    ...candidateProduct,
    title_en: prodFacts.rawTitleEn,
    title_ar: prodFacts.rawTitleAr,
    sale_unit_type: prodFacts.saleUnitType,
    inner_pack_count: prodFacts.packCount,
    each_size_value: prodFacts.sizeValue,
    each_size_unit: prodFacts.sizeUnit
  })
  const pkgResult = comparePackageConfigurations(offerConfig, prodConfig)
  if (!pkgResult.isCompatible) {
    if (pkgResult.status === 'rejected_insufficient_evidence' && conflicts.length === 0) {
      return {
        isCompatible: false,
        status: 'rejected_insufficient_evidence',
        reason: pkgResult.reason,
        conflicts: pkgResult.conflicts
      }
    }
    for (const c of pkgResult.conflicts) {
      if (!conflicts.some((existing) => existing.includes(c) || c.includes(existing))) {
        conflicts.push(c)
      }
    }
  }

  // 8b. Reusable Package Variant vs Multipack Safeguards Check
  const pkgSafeguard = validateCatalogMatchingWithPackageSafeguards(
    {
      ...offerInput,
      title_en: offerFacts.rawTitleEn,
      title_ar: offerFacts.rawTitleAr,
      each_size_value: offerFacts.sizeValue,
      each_size_unit: offerFacts.sizeUnit,
      inner_pack_count: offerFacts.packCount,
      sale_unit_type: offerFacts.saleUnitType
    },
    candidateProduct
  )
  if (!pkgSafeguard.isCompatible) {
    if (pkgSafeguard.status === 'rejected_ambiguous_offer') {
      return {
        isCompatible: false,
        status: 'rejected_ambiguous_offer',
        reason: pkgSafeguard.reason
      }
    }
    if (pkgSafeguard.status === 'rejected_insufficient_evidence' && conflicts.length === 0) {
      return {
        isCompatible: false,
        status: 'rejected_insufficient_evidence',
        reason: pkgSafeguard.reason
      }
    }
    if (!conflicts.some((existing) => existing.includes(pkgSafeguard.reason) || pkgSafeguard.reason.includes(existing))) {
      conflicts.push(pkgSafeguard.reason)
    }
  }

  // 9. Category check (if both known)
  if (offerFacts.categorySlug && prodFacts.categorySlug) {
    const cOffer = offerFacts.categorySlug.toLowerCase().trim()
    const cProd = prodFacts.categorySlug.toLowerCase().trim()
    if (cOffer !== cProd) {
      conflicts.push(`Category mismatch: offer='${cOffer}' vs product='${cProd}'`)
    }
  }

  // 10. Bilingual Token Bag Compatibility Check (Milestone 2B)
  const offerBag = extractNormalizedTokenBag(`${offerFacts.rawTitleEn} ${offerFacts.rawTitleAr}`)
  const prodBag = extractNormalizedTokenBag(`${prodFacts.rawTitleEn} ${prodFacts.rawTitleAr}`)
  const tokenCompat = areTokenBagsCompatible(offerBag, prodBag)

  if (!tokenCompat.isCompatible) {
    for (const c of tokenCompat.conflicts) {
      if (c.includes('lacks') && conflicts.length === 0) {
        return {
          isCompatible: false,
          status: 'rejected_insufficient_evidence',
          reason: c
        }
      }
      if (!conflicts.some((existing) => existing.includes(c) || c.includes(existing))) {
        conflicts.push(c)
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      isCompatible: false,
      status: 'rejected_contradictory',
      reason: `Identity contradiction: ${conflicts.join('; ')}`,
      conflicts
    }
  }

  return {
    isCompatible: true,
    status: 'verified_compatible',
    reason: 'Product identity and attributes verified compatible.'
  }
}

/**
 * Filters a list of candidate products, discarding unverified, contradictory, or insufficient
 * candidates, and ensures that an automatic match is accepted ONLY if exactly 1 compatible verified product remains.
 */
export function selectSingleCompatibleVerifiedProduct(
  offerInput: any,
  candidateProducts: any[],
  options?: { isTruncated?: boolean; hasLookupFailure?: boolean }
): {
  matchedProduct: any | null
  result: IdentityCompatibilityResult
} {
  if (options?.hasLookupFailure) {
    return {
      matchedProduct: null,
      result: {
        isCompatible: false,
        status: 'rejected_database_lookup_failure',
        reason: 'Database lookup failure occurred during candidate retrieval. Auto-match blocked.'
      }
    }
  }

  if (options?.isTruncated) {
    return {
      matchedProduct: null,
      result: {
        isCompatible: false,
        status: 'rejected_candidate_search_incomplete',
        reason: 'Candidate search exceeded limit of 25 products (results truncated). Auto-match blocked.'
      }
    }
  }

  if (!candidateProducts || candidateProducts.length === 0) {
    return {
      matchedProduct: null,
      result: {
        isCompatible: false,
        status: 'no_eligible_candidate',
        reason: 'No candidate products supplied for matching.'
      }
    }
  }

  const compatibleCandidates: Array<{ product: any; result: IdentityCompatibilityResult }> = []
  const rejectionReasons: string[] = []

  for (const prod of candidateProducts) {
    const validation = validateProductIdentityCompatibility(offerInput, prod)
    if (validation.isCompatible) {
      compatibleCandidates.push({ product: prod, result: validation })
    } else {
      rejectionReasons.push(`Product #${prod.id}: ${validation.reason}`)
    }
  }

  if (compatibleCandidates.length === 0) {
    return {
      matchedProduct: null,
      result: {
        isCompatible: false,
        status: rejectionReasons.some((r) => r.includes('Identity contradiction'))
          ? 'rejected_contradictory'
          : rejectionReasons.some((r) => r.includes('ambiguous entity'))
            ? 'rejected_ambiguous_offer'
            : 'rejected_insufficient_evidence',
        reason: rejectionReasons.join(' | ') || 'No compatible verified products found.'
      }
    }
  }

  // Check unique distinct product IDs among compatible candidates
  const uniqueProductIds = new Set(compatibleCandidates.map((c) => String(c.product.id)))

  if (uniqueProductIds.size === 1) {
    return {
      matchedProduct: compatibleCandidates[0].product,
      result: compatibleCandidates[0].result
    }
  }

  // Multi-candidate ambiguity: >= 2 distinct product IDs compatible
  return {
    matchedProduct: null,
    result: {
      isCompatible: false,
      status: 'rejected_multiple_candidates',
      reason: `Multiple distinct verified products (${Array.from(uniqueProductIds).join(', ')}) matched offer. Manual review required.`
    }
  }
}
