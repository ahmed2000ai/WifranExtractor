/**
 * Variant & Package Configuration Disambiguation Service
 * Milestone 2C: WIFRAN-EXTRACTOR-IDENTITY-002C
 *
 * Provides deterministic package-configuration and product-variant disambiguation:
 * 1. 4D quantity-configuration model (sale-unit type, inner-pack count, individual-unit content, total package content).
 * 2. Exact package configuration comparison (1x1000ml = 1x1L, 4x0.5L = 4x500ml, 10x0.6kg = 10x600g).
 * 3. Strict rejection of pack & size contradictions (4x250ml != 1x1L, 10x600g != 1x600g, 12x1L != 1x12L).
 * 4. Distinct commodity packaging classification (loose per-kg produce vs prepacked retail SKUs, random-weight vs fixed-weight).
 * 5. Comprehensive variant compatibility (Full Fat vs Low Fat vs Skimmed, Fresh vs UHT, Frozen vs Chilled, cuts, flavors, sugar).
 */

import {
  normalizeMeasurement,
  MeasurementDimension
} from '../../shared/utils/unitEquivalence'
import {
  extractNormalizedTokenBag
} from '../../shared/utils/bilingualTokenNormalizer'
import {
  parseAndNormalizeQuantity,
  canonicalizeUnit
} from '../../shared/utils/priceAndUnitNormalizer'

export type SaleUnitType = 'each' | 'pack' | 'kg' | 'weight' | 'volume' | 'piece' | 'unknown'

export interface IndividualUnitContent {
  value: number
  unit: string
  dimension: MeasurementDimension
  baseValue: number // in base SI units: ml for volume, g for mass, pcs for count
  baseUnit: string  // 'ml' | 'g' | 'pcs' | 'other'
}

export interface TotalPackageContent {
  totalBaseValue: number
  totalBaseUnit: string
  provenance: 'computed' | 'explicit' | 'unknown'
}

export interface StructuredQuantityConfig {
  saleUnitType: SaleUnitType
  innerPackCount: number | null
  individualUnitContent: IndividualUnitContent | null
  totalPackageContent: TotalPackageContent | null
  assortmentStatus: string | null
  knownOptions: string[]
  isIndivisibleSaleUnit: boolean
  priceBasis: string | null
  isRandomWeight: boolean
  isLooseCommodity: boolean
  rawSizeText: string | null
}

export interface PackageConfigurationComparisonResult {
  isCompatible: boolean
  status: 'verified_compatible' | 'rejected_contradictory' | 'rejected_insufficient_evidence'
  conflicts: string[]
  reason: string
}

export interface StructuredVariantFacts {
  fatContent: 'full_fat' | 'low_fat' | 'skimmed' | null
  preservation: 'fresh' | 'long_life' | 'frozen' | 'chilled' | null
  grainVariant: 'sella' | 'basmati' | 'white_rice' | 'brown_rice' | null
  meatCut: 'drumstick' | 'fillet' | 'breast' | 'wing' | 'whole_chicken' | 'thigh' | null
  sugarModifier: 'zero_sugar' | 'original' | 'plain' | null
  flavor: string | null
  packageForm: 'square' | 'sheet' | 'roll' | null
  specialtyModifiers: string[]
  isFlavored: boolean
}

export interface VariantComparisonResult {
  isCompatible: boolean
  status: 'verified_compatible' | 'rejected_contradictory' | 'rejected_insufficient_evidence'
  conflicts: string[]
  reason: string
}

export interface CommodityPackagingClassification {
  isLooseCommodity: boolean
  isRandomWeight: boolean
  isPrepacked: boolean
  isAssortedBundle: boolean
  reason?: string
}

/**
 * Promotional pricing patterns (e.g. "Buy 2 Get 1 Free", "3 for SAR 10", "2+1 free", "اشتري 2 واحصل على 1")
 * that indicate commercial transaction discounts rather than manufacturer physical multipack packaging.
 */
const PROMO_MECHANIC_REGEX =
  /(?:buy\s*\d+\s*(?:get\s*\d+\s*free|pcs|pc|items|حبات|قطع)?|\b\d+\s*\+\s*\d+\s*free|\b\d+\s*for\s*(?:sar\s*)?\d+|\bاشتري\s*\d+\s*(?:واحصل\s*على\s*\d+|حبات|قطع)?|\b\d+\s*حبات\s*بسعر\s*\d+|\b\d+\s*pc(?:s)?\s*per\s*customer)/i

/**
 * Extracts recognized poultry cuts or flavor variants from text.
 */
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

/**
 * Classifies whether an item is a loose commodity, random weight, prepacked SKU, or assorted bundle.
 */
export function classifyCommodityPackaging(entity: any): CommodityPackagingClassification {
  const titleEn = (entity.title_en || entity.name_en || entity.titleEn || entity.item_name_complete || '').toLowerCase().trim()
  const titleAr = (entity.title_ar || entity.name_ar || entity.titleAr || '').trim()
  const combined = `${titleEn} ${titleAr}`

  const saleUnit = (entity.sale_unit_type || entity.saleUnitType || '').toLowerCase().trim()
  const priceBasis = (entity.price_basis || entity.priceBasis || '').toLowerCase().trim()
  const assortmentStatus = (entity.assortment_status || entity.assortmentStatus || entity.contract_v2?.assortment?.status || '').toLowerCase().trim()

  // 1. Assorted bundle check
  if (
    assortmentStatus === 'assortment_indicated' ||
    assortmentStatus === 'indicated_with_conflict' ||
    assortmentStatus === 'unknown_composition' ||
    titleEn.includes('asstd') ||
    titleEn.includes('assorted') ||
    combined.includes('مشكل') ||
    combined.includes('منوع')
  ) {
    return {
      isLooseCommodity: false,
      isRandomWeight: false,
      isPrepacked: true,
      isAssortedBundle: true,
      reason: 'Assortment bundle containing multiple selectable or indeterminate variants'
    }
  }

  // 2. Loose commodity per kg check (produce, fish, butcher counter)
  const hasLooseKeywords =
    titleEn.includes('per kg') ||
    titleEn.includes('/kg') ||
    titleEn.includes('loose') ||
    combined.includes('بالكيلو') ||
    combined.includes('طازج بالكيلو') ||
    combined.includes('وزن')

  const isExplicitPackaged = (saleUnit === 'each' || saleUnit === 'pack') && !hasLooseKeywords && priceBasis !== 'per_kg'
  const hasFixedPack =
    (entity.inner_pack_count != null && Number(entity.inner_pack_count) > 1) ||
    (entity.innerPackCount != null && Number(entity.innerPackCount) > 1)

  if ((saleUnit === 'kg' || hasLooseKeywords || priceBasis === 'per_kg') && !isExplicitPackaged && !hasFixedPack) {
    return {
      isLooseCommodity: true,
      isRandomWeight: true,
      isPrepacked: false,
      isAssortedBundle: false,
      reason: 'Loose measured-weight commodity sold per kg'
    }
  }

  // 3. Random weight butchery / meat / deli
  if (priceBasis === 'per_kg' && !isExplicitPackaged && !hasFixedPack) {
    return {
      isLooseCommodity: true,
      isRandomWeight: true,
      isPrepacked: false,
      isAssortedBundle: false,
      reason: 'Random-weight product priced per kg'
    }
  }

  // 4. Prepacked retail packaged SKU
  return {
    isLooseCommodity: false,
    isRandomWeight: false,
    isPrepacked: true,
    isAssortedBundle: false
  }
}

/**
 * Extracts a complete 4-dimensional StructuredQuantityConfig from an offer or catalog product.
 */
export function extractStructuredQuantityConfig(entity: any): StructuredQuantityConfig {
  const titleEn = (entity.title_en || entity.name_en || entity.titleEn || entity.item_name_complete || '').trim()
  const titleAr = (entity.title_ar || entity.name_ar || entity.titleAr || '').trim()
  const rawSizeText = String(entity.size_text || entity.size_value || entity.sizeOrWeight || entity.size || '').trim()

  const packaging = classifyCommodityPackaging(entity)

  // 1. Inner Pack Count
  let packCount: number | null = null
  if (entity.inner_pack_count != null && !isNaN(Number(entity.inner_pack_count)) && Number(entity.inner_pack_count) >= 1) {
    packCount = Number(entity.inner_pack_count)
  } else if (entity.innerPackCount != null && !isNaN(Number(entity.innerPackCount)) && Number(entity.innerPackCount) >= 1) {
    packCount = Number(entity.innerPackCount)
  }

  // Parse pack count from canonical product key if present (e.g. "...:4xpack" or "...:10xeach")
  if (packCount == null && entity.canonical_product_key) {
    const parts = String(entity.canonical_product_key).split(':')
    if (parts.length >= 5) {
      const match = parts[4].match(/^(\d+)x/i)
      if (match) {
        packCount = Number(match[1])
      }
    }
  }

  // Check promotional text: do NOT let commercial promo mechanics ("Buy 2 Get 1 Free") invent a pack count
  const promoText = [
    titleEn,
    titleAr,
    rawSizeText,
    entity.promoNotes,
    entity.promo_notes,
    entity.condition_text,
    entity.bonus_wording
  ].filter(Boolean).join(' ')
  const isPromoMechanic = PROMO_MECHANIC_REGEX.test(promoText)

  // Guard against upstream extraction mistaking commercial multi-buy for physical multipack
  const hasExplicitMultipackInText = /\b\d+\s*x\s*\d+|\b\d+\s*[a-zA-Z\u0600-\u06FF]+\s*x\s*\d+|\b\d+\s*s\b/i.test(`${rawSizeText} ${titleEn} ${titleAr}`)
  if (isPromoMechanic && !hasExplicitMultipackInText && packCount != null && packCount > 1) {
    packCount = 1
  }

  // Parse size & pack from text if not yet fully determined
  let sizeVal: number | null =
    entity.each_size_value != null && !isNaN(Number(entity.each_size_value))
      ? Number(entity.each_size_value)
      : (entity.eachSizeValue != null && !isNaN(Number(entity.eachSizeValue)) ? Number(entity.eachSizeValue) : null)

  let sizeUnitStr: string | null = entity.each_size_unit || entity.eachSizeUnit || null

  if (sizeVal == null || !sizeUnitStr || packCount == null) {
    const parsed = parseAndNormalizeQuantity({
      size_text: rawSizeText,
      title_en: titleEn,
      title_ar: titleAr,
      item_domain: entity.item_domain || 'grocery',
      unit_type: entity.unit_type || entity.sale_unit_type || entity.saleUnitType || null,
      ai_pack_quantity: packCount,
      ai_each_size_value: sizeVal,
      ai_each_size_unit: sizeUnitStr as any,
      is_uniform_size_across_variants: true,
      offer_price: entity.offer_price || null,
      price_basis: entity.price_basis || null,
      condition_text: entity.condition_text || entity.promoNotes || entity.promo_notes || entity.bonus_wording || null,
      promotion_mechanic: isPromoMechanic ? 'multi_buy' : null,
      bundle_quantity: null
    })

    if (sizeVal == null && parsed.each_size_value != null) {
      sizeVal = Number(parsed.each_size_value)
    }
    if (!sizeUnitStr && parsed.each_size_unit) {
      sizeUnitStr = parsed.each_size_unit
    }
    if (packCount == null && parsed.pack_quantity != null) {
      packCount = parsed.pack_quantity
    }
  }

  // Default pack count for standard single packaged items
  if (packCount == null && !packaging.isLooseCommodity) {
    packCount = 1
  }

  // 2. Individual Unit Content
  let individualUnitContent: IndividualUnitContent | null = null
  if (sizeVal != null && sizeUnitStr) {
    const norm = normalizeMeasurement(sizeVal, sizeUnitStr)
    if (norm && norm.isRecognized) {
      individualUnitContent = {
        value: norm.rawValue,
        unit: norm.canonicalUnit,
        dimension: norm.dimension,
        baseValue: norm.baseValue,
        baseUnit: norm.baseUnit
      }
    } else {
      const canonU = canonicalizeUnit(sizeUnitStr) || sizeUnitStr
      individualUnitContent = {
        value: sizeVal,
        unit: canonU,
        dimension: 'other',
        baseValue: sizeVal,
        baseUnit: canonU
      }
    }
  }

  // 3. Total Package Content
  let totalPackageContent: TotalPackageContent | null = null
  if (packCount != null && individualUnitContent != null) {
    const totalVal = Number((packCount * individualUnitContent.baseValue).toFixed(4))
    totalPackageContent = {
      totalBaseValue: totalVal,
      totalBaseUnit: individualUnitContent.baseUnit,
      provenance: 'computed'
    }
  }

  // If explicit total content exists, check against computed
  const explicitTotalVal =
    entity.total_content_value != null && !isNaN(Number(entity.total_content_value))
      ? Number(entity.total_content_value)
      : (entity.totalContentValue != null && !isNaN(Number(entity.totalContentValue)) ? Number(entity.totalContentValue) : null)
  const explicitTotalUnit = entity.total_content_unit || entity.totalContentUnit || null

  if (explicitTotalVal != null && explicitTotalUnit) {
    const normTot = normalizeMeasurement(explicitTotalVal, explicitTotalUnit)
    if (normTot && normTot.isRecognized) {
      if (!totalPackageContent) {
        totalPackageContent = {
          totalBaseValue: normTot.baseValue,
          totalBaseUnit: normTot.baseUnit,
          provenance: 'explicit'
        }
      }
    }
  }

  // 4. Sale Unit Type
  let saleUnitType: SaleUnitType = 'each'
  const rawSaleUnit = (entity.sale_unit_type || entity.saleUnitType || '').toLowerCase().trim()
  if (packaging.isLooseCommodity) {
    saleUnitType = 'kg'
  } else if (packCount != null && packCount > 1) {
    saleUnitType = 'pack'
  } else if (rawSaleUnit === 'pack') {
    saleUnitType = 'pack'
  } else if (rawSaleUnit === 'kg' || rawSaleUnit === 'weight') {
    saleUnitType = 'kg'
  } else if (rawSaleUnit === 'piece' || rawSaleUnit === 'pcs') {
    saleUnitType = 'piece'
  } else if (rawSaleUnit === 'volume') {
    saleUnitType = 'volume'
  }

  return {
    saleUnitType,
    innerPackCount: packCount,
    individualUnitContent,
    totalPackageContent,
    assortmentStatus: entity.assortment_status || entity.assortmentStatus || null,
    knownOptions: entity.known_options || entity.knownOptions || [],
    isIndivisibleSaleUnit: entity.is_indivisible_sale_unit ?? true,
    priceBasis: entity.price_basis || entity.priceBasis || null,
    isRandomWeight: packaging.isRandomWeight,
    isLooseCommodity: packaging.isLooseCommodity,
    rawSizeText: rawSizeText || null
  }
}

/**
 * Compares two StructuredQuantityConfigs to enforce deterministic package configuration equivalence
 * and reject pack-size contradictions.
 *
 * Enforces:
 * - 1 x 1000ml == 1 x 1L (volume equivalence)
 * - 4 x 0.5L == 4 x 500ml (volume equivalence)
 * - 10 x 0.6kg == 10 x 600g (mass equivalence)
 * - Strict rejection of:
 *   * 4 x 250ml vs 1 x 1L (same total volume, contradictory pack structure)
 *   * 2 x 500g vs 1 x 1kg
 *   * 12 x 1L vs 1 x 12L
 *   * 10 x 600g vs 1 x 600g (Fakieh canary invariant)
 *   * 6 x 330ml vs 6 x 250ml
 *   * Loose produce per kg vs prepacked 1kg product
 */
export function comparePackageConfigurations(
  offerConfig: StructuredQuantityConfig,
  prodConfig: StructuredQuantityConfig
): PackageConfigurationComparisonResult {
  const conflicts: string[] = []

  // 1. Loose Commodity vs Prepacked Product Check
  if (offerConfig.isLooseCommodity && !prodConfig.isLooseCommodity) {
    conflicts.push('Sale unit mismatch: loose per-kg commodity cannot match prepacked retail product SKU')
  } else if (!offerConfig.isLooseCommodity && prodConfig.isLooseCommodity) {
    conflicts.push('Sale unit mismatch: packaged offer cannot match loose per-kg commodity SKU')
  }

  // 2. Random-Weight vs Fixed-Weight Check
  if (offerConfig.isRandomWeight && !prodConfig.isRandomWeight) {
    conflicts.push('Weight type mismatch: random-weight offer cannot match fixed-weight product SKU')
  } else if (!offerConfig.isRandomWeight && prodConfig.isRandomWeight) {
    conflicts.push('Weight type mismatch: fixed-weight offer cannot match random-weight product SKU')
  }

  // 3. Sale Unit Type Semantics Check (kg vs each/pack)
  if (offerConfig.saleUnitType === 'kg' && prodConfig.saleUnitType && prodConfig.saleUnitType !== 'kg') {
    conflicts.push(`Sale unit mismatch: per-kg bulk offer cannot match packaged unit SKU (${prodConfig.saleUnitType})`)
  } else if (prodConfig.saleUnitType === 'kg' && offerConfig.saleUnitType && offerConfig.saleUnitType !== 'kg') {
    conflicts.push('Sale unit mismatch: packaged offer cannot match per-kg bulk product')
  }

  // 4. Inner Pack Count Check
  if (offerConfig.innerPackCount != null && prodConfig.innerPackCount != null) {
    if (offerConfig.innerPackCount !== prodConfig.innerPackCount) {
      conflicts.push(`Pack quantity mismatch: offer=${offerConfig.innerPackCount} vs product=${prodConfig.innerPackCount}`)
    }
  } else if (offerConfig.innerPackCount != null && offerConfig.innerPackCount > 1 && prodConfig.innerPackCount == null) {
    conflicts.push(`Pack quantity mismatch: offer specifies multipack of ${offerConfig.innerPackCount} but candidate product lacks pack count`)
  } else if (prodConfig.innerPackCount != null && prodConfig.innerPackCount > 1 && offerConfig.innerPackCount == null) {
    conflicts.push(`Pack quantity mismatch: candidate product specifies multipack of ${prodConfig.innerPackCount} but offer lacks pack count`)
  }

  // 5. Individual Unit Content Check (Exact Scaled Decimal / 2A Math)
  if (offerConfig.individualUnitContent && prodConfig.individualUnitContent) {
    const oContent = offerConfig.individualUnitContent
    const pContent = prodConfig.individualUnitContent

    // Dimension check
    if (oContent.dimension !== pContent.dimension) {
      conflicts.push(
        `Package unit dimension mismatch: offer='${oContent.unit}' (${oContent.dimension}) is incompatible with product='${pContent.unit}' (${pContent.dimension})`
      )
    } else {
      // Scaled decimal value check
      if (Math.abs(oContent.baseValue - pContent.baseValue) > 0.001) {
        conflicts.push(
          `Package size mismatch: offer=${oContent.value}${oContent.unit} (${oContent.baseValue}${oContent.baseUnit}) vs product=${pContent.value}${pContent.unit} (${pContent.baseValue}${pContent.baseUnit})`
        )
      }
    }
  } else if (offerConfig.individualUnitContent && !prodConfig.individualUnitContent) {
    if (conflicts.length === 0) {
      return {
        isCompatible: false,
        status: 'rejected_insufficient_evidence',
        conflicts: [],
        reason: `Candidate product lacks package size to verify exact SKU match against offer (${offerConfig.individualUnitContent.value} ${offerConfig.individualUnitContent.unit}).`
      }
    }
  } else if (!offerConfig.individualUnitContent && prodConfig.individualUnitContent) {
    if (conflicts.length === 0) {
      return {
        isCompatible: false,
        status: 'rejected_insufficient_evidence',
        conflicts: [],
        reason: `Offer lacks package size to verify exact SKU match against candidate product (${prodConfig.individualUnitContent.value} ${prodConfig.individualUnitContent.unit}).`
      }
    }
  }

  // 6. Total Package Content Guard
  // INVARIANT: Matching total package content MUST NEVER override pack count or individual size contradictions!
  if (conflicts.length > 0) {
    return {
      isCompatible: false,
      status: 'rejected_contradictory',
      conflicts,
      reason: conflicts.join(' | ')
    }
  }

  return {
    isCompatible: true,
    status: 'verified_compatible',
    conflicts: [],
    reason: 'Package configuration is fully compatible.'
  }
}

/**
 * Extracts structured variant attributes from an offer or catalog product.
 */
export function extractStructuredVariantFacts(entity: any): StructuredVariantFacts {
  const titleEn = (entity.title_en || entity.name_en || entity.titleEn || entity.item_name_complete || '').trim()
  const titleAr = (entity.title_ar || entity.name_ar || entity.titleAr || '').trim()
  const combined = `${titleEn} ${titleAr} ${entity.variant_or_flavor || entity.variantOrFlavor || ''}`

  const tokenBag = extractNormalizedTokenBag(combined)

  const fatContent = tokenBag.fatContentId
  const preservation = tokenBag.preservationId
  const grainVariant = (tokenBag.grainVariantId as any) || null
  let meatCut = (tokenBag.cutId as any) || null
  if (!meatCut) {
    const rawVal = (entity.variant_or_flavor || entity.variantOrFlavor || '').toLowerCase()
    const cut = extractFlavorOrCut(rawVal) || extractFlavorOrCut(combined)
    if (cut && ['drumstick', 'fillet', 'wing', 'whole_chicken'].includes(cut)) {
      meatCut = cut
    }
  }

  // Formulation / Sugar
  let sugarModifier: 'zero_sugar' | 'original' | 'plain' | null = null
  for (const t of tokenBag.tokens) {
    if (t.id === 'mod:zero_sugar') sugarModifier = 'zero_sugar'
    else if (t.id === 'mod:original') sugarModifier = 'original'
    else if (t.id === 'mod:plain') sugarModifier = 'plain'
  }

  // Package Form
  let packageForm: 'square' | 'sheet' | 'roll' | null = null
  for (const t of tokenBag.tokens) {
    if (t.id === 'pac:square') packageForm = 'square'
    else if (t.id === 'pac:sheet') packageForm = 'sheet'
    else if (t.id === 'pac:roll') packageForm = 'roll'
  }

  // Flavor extraction from curated dictionary or raw tokens
  let flavor: string | null = null
  const KNOWN_FLAVORS = new Set(['curry', 'beef', 'chicken', 'strawberry', 'chocolate', 'vanilla', 'mango', 'orange', 'lemon'])
  for (const t of tokenBag.tokens) {
    const rawId = t.id.replace('mod:', '')
    if (KNOWN_FLAVORS.has(rawId)) {
      flavor = rawId
      break
    }
  }
  if (!flavor) {
    const rawVal = (entity.variant_or_flavor || entity.variantOrFlavor || '').toLowerCase()
    const flv = extractFlavorOrCut(rawVal) || extractFlavorOrCut(combined)
    if (flv && !['drumstick', 'fillet', 'wing', 'whole_chicken'].includes(flv)) {
      flavor = flv
    }
  }

  // Specialty Modifiers (e.g. organic, cardamom, truffle, smoked, boneless, spicy)
  const SPECIALTY_KEYWORDS: Record<string, string> = {
    organic: 'organic',
    عضوي: 'organic',
    cardamom: 'cardamom',
    هيل: 'cardamom',
    حبهان: 'cardamom',
    truffle: 'truffle',
    كمأة: 'truffle',
    smoked: 'smoked',
    مدخن: 'smoked',
    boneless: 'boneless',
    مخلي: 'boneless',
    spicy: 'spicy',
    حار: 'spicy'
  }
  const specialtyModifiers: string[] = []
  for (const [kw, norm] of Object.entries(SPECIALTY_KEYWORDS)) {
    if (combined.toLowerCase().includes(kw) && !specialtyModifiers.includes(norm)) {
      specialtyModifiers.push(norm)
    }
  }

  return {
    fatContent,
    preservation,
    grainVariant,
    meatCut,
    sugarModifier,
    flavor,
    packageForm,
    specialtyModifiers,
    isFlavored: flavor != null
  }
}

/**
 * Compares two StructuredVariantFacts to enforce strict attribute disambiguation:
 * - Fat Content: Full Fat vs Low Fat vs Skimmed
 * - Preservation: Fresh vs Long Life / UHT, Chilled vs Frozen
 * - Sugar: Zero Sugar vs Original
 * - Grains: Sella Basmati vs Plain Basmati
 * - Cuts: Drumstick vs Fillet, Whole vs Cuts
 * - Flavors: Chocolate vs Vanilla vs Plain
 * - Specialty: Organic, Cardamom, Truffle, etc.
 */
export function compareProductVariants(
  offerVar: StructuredVariantFacts,
  prodVar: StructuredVariantFacts
): VariantComparisonResult {
  const conflicts: string[] = []

  // 1. Fat Content Check
  if (offerVar.fatContent && prodVar.fatContent) {
    if (offerVar.fatContent !== prodVar.fatContent) {
      conflicts.push(`Fat content mismatch: offer='${offerVar.fatContent}' vs product='${prodVar.fatContent}'`)
    }
  } else if (offerVar.fatContent && !prodVar.fatContent) {
    conflicts.push(`Candidate product lacks specific fat content (${offerVar.fatContent}) claimed by offer`)
  } else if (!offerVar.fatContent && prodVar.fatContent) {
    if (conflicts.length === 0) {
      return {
        isCompatible: false,
        status: 'rejected_insufficient_evidence',
        conflicts: [],
        reason: `Offer lacks fat content specification to verify exact SKU match against candidate product (${prodVar.fatContent}).`
      }
    }
  }

  // 2. Preservation / Thermal Processing Check
  if (offerVar.preservation && prodVar.preservation) {
    if (offerVar.preservation !== prodVar.preservation) {
      conflicts.push(`Preservation mismatch: offer='${offerVar.preservation}' vs product='${prodVar.preservation}'`)
    }
  }

  // 3. Sugar & Formulation Check
  if (offerVar.sugarModifier && prodVar.sugarModifier) {
    if (offerVar.sugarModifier !== prodVar.sugarModifier) {
      conflicts.push(`Sugar formulation mismatch: offer='${offerVar.sugarModifier}' vs product='${prodVar.sugarModifier}'`)
    }
  } else if (offerVar.sugarModifier === 'zero_sugar' && prodVar.sugarModifier !== 'zero_sugar') {
    conflicts.push('Sugar formulation mismatch: offer specifies Zero Sugar but product is standard formulation')
  } else if (prodVar.sugarModifier === 'zero_sugar' && offerVar.sugarModifier !== 'zero_sugar') {
    conflicts.push('Sugar formulation mismatch: product specifies Zero Sugar but offer lacks Zero Sugar specification')
  }

  // 4. Grain Variant Check (Sella vs Plain Basmati)
  if (offerVar.grainVariant === 'sella' && prodVar.grainVariant !== 'sella') {
    conflicts.push('Variant mismatch: offer specifies Sella Basmati but product lacks Sella distinction')
  } else if (prodVar.grainVariant === 'sella' && offerVar.grainVariant !== 'sella') {
    conflicts.push('Variant mismatch: product specifies Sella Basmati but offer lacks Sella distinction')
  } else if (offerVar.grainVariant && prodVar.grainVariant && offerVar.grainVariant !== prodVar.grainVariant) {
    conflicts.push(`Grain variant mismatch: offer='${offerVar.grainVariant}' vs product='${prodVar.grainVariant}'`)
  }

  // 5. Poultry & Meat Cuts Check
  if (offerVar.meatCut && prodVar.meatCut) {
    if (offerVar.meatCut !== prodVar.meatCut) {
      conflicts.push(`Variant/flavor mismatch: offer='${offerVar.meatCut}' vs product='${prodVar.meatCut}'`)
      conflicts.push(`Cut/part mismatch: offer='${offerVar.meatCut}' vs product='${prodVar.meatCut}'`)
    }
  } else if (offerVar.meatCut && !prodVar.meatCut) {
    conflicts.push(`Candidate product lacks specific flavor/variant/cut (${offerVar.meatCut}) claimed by offer`)
  } else if (!offerVar.meatCut && prodVar.meatCut) {
    if (conflicts.length === 0) {
      return {
        isCompatible: false,
        status: 'rejected_insufficient_evidence',
        conflicts: [],
        reason: `Offer lacks flavor/variant/cut specification to verify exact SKU match against candidate product (${prodVar.meatCut}).`
      }
    }
  }

  // 6. Flavor Check
  if (offerVar.flavor && prodVar.flavor) {
    if (offerVar.flavor !== prodVar.flavor) {
      conflicts.push(`Variant/flavor mismatch: offer='${offerVar.flavor}' vs product='${prodVar.flavor}'`)
    }
  } else if (offerVar.flavor && !prodVar.flavor) {
    conflicts.push(`Candidate product lacks specific flavor/variant/cut (${offerVar.flavor}) claimed by offer`)
  } else if (!offerVar.flavor && prodVar.flavor) {
    if (conflicts.length === 0) {
      return {
        isCompatible: false,
        status: 'rejected_insufficient_evidence',
        conflicts: [],
        reason: `Offer lacks flavor specification to verify exact SKU match against candidate product (${prodVar.flavor}).`
      }
    }
  }

  // 7. Specialty Modifiers Check (e.g. Organic, Cardamom, Truffle)
  if (offerVar.specialtyModifiers.length > 0 || prodVar.specialtyModifiers.length > 0) {
    const setOffer = new Set(offerVar.specialtyModifiers)
    const setProd = new Set(prodVar.specialtyModifiers)

    for (const m1 of offerVar.specialtyModifiers) {
      if (!setProd.has(m1)) {
        conflicts.push(`Offer contains meaningful modifier '${m1}' not present on candidate product`)
      }
    }
    for (const m2 of prodVar.specialtyModifiers) {
      if (!setOffer.has(m2)) {
        conflicts.push(`Candidate product contains meaningful modifier '${m2}' not present on offer`)
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      isCompatible: false,
      status: 'rejected_contradictory',
      conflicts,
      reason: conflicts.join(' | ')
    }
  }

  return {
    isCompatible: true,
    status: 'verified_compatible',
    conflicts: [],
    reason: 'Product variant is fully compatible.'
  }
}
