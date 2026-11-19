/**
 * Wifran Extractor — Package Size and Multipack Safeguards Engine
 *
 * Implements reusable safeguards to:
 * 1. Distinguish standalone package variants, multipack bundles, conditional quantity discounts,
 *    and ambiguous package configurations using full offer context.
 * 2. Guard catalog matching against pack-size contradictions and prevent fictional SKU creation.
 * 3. Enforce image safety by blocking physically conflicting packaging artwork from catalog and consumer views.
 */

import {
  normalizeArabicNumerals,
  parseAndNormalizeQuantity,
  detectCustomerPurchaseLimit
} from './priceAndUnitNormalizer'
export { detectCustomerPurchaseLimit }
import {
  normalizeMeasurement,
  getMeasurementDimension,
  type CanonicalMeasurement
} from './unitEquivalence'
import { areSizesStrictlyCompatible } from './sizeCompatibility'

export type PackageConfigurationKind =
  | 'standalone_package_variant'    // Distinct nominal package size (e.g. 10 kg bag, 5 kg bag, 1.5 L bottle)
  | 'multipack_bundle'              // Multiple individual packages sold together (e.g. 2 x 5 kg, 4 x 1 L)
  | 'conditional_quantity_discount' // Purchase limit (Max 2 pcs) or multi-buy promo condition where unit is 1 pc
  | 'ambiguous_unconfirmed'         // Insufficient evidence or conflicting packaging indications

export interface PackageContextInput {
  titleEn?: string | null
  titleAr?: string | null
  sizeText?: string | null
  rawSizeText?: string | null
  tableHeading?: string | null          // e.g. "SIZE", "الحجم", "QTY", "الكمية", "العرض"
  rowLabel?: string | null              // e.g. "5 KG", "10 KG", "2 PCS", "حبة"
  printedPackageLabel?: string | null   // e.g. "5KG", "10KG" from packaging artwork OCR
  conditionText?: string | null         // e.g. "حد أقصى 2 حبة", "Max 2 per customer"
  promoNotes?: string | null
  bonusWording?: string | null
  promotionMechanic?: string | null     // e.g. "multi_buy", "bundle", "tier_discount"
  pricingTiers?: Array<{ label?: string | null; price?: number | null; sizeText?: string | null }> | null
  offerPrice?: number | null
  eachSizeValue?: number | null
  eachSizeUnit?: string | null
  innerPackCount?: number | null
  totalContentValue?: number | null
  totalContentUnit?: string | null
  saleUnitType?: string | null
  assortmentStatus?: string | null
}

export interface PackageContextAnalysis {
  configurationKind: PackageConfigurationKind
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]

  physicalPackage: {
    nominalSizeValue: number | null
    nominalSizeUnit: string | null
    packCount: number
    isMultipack: boolean
    totalContentValue: number | null
    totalContentUnit: string | null
    saleUnitType: 'piece' | 'pack' | 'kg' | 'volume' | 'bundle'
  }

  promotionalCondition: {
    hasCustomerPurchaseLimit: boolean
    customerLimitPcs: number | null
    isMultiBuyPricing: boolean
    multiBuyRequiredQuantity: number | null
    isQuantityDiscountCondition: boolean
    conditionSummary: string | null
  }

  catalogMatchingPolicy: {
    allowAutomaticDirectMatch: boolean
    preventFictionalSkuCreation: boolean
    targetMatchMode:
      | 'exact_standalone_sku'
      | 'bundle_referencing_underlying_sku'
      | 'candidate_only_unverified'
      | 'blocked_contradictory'
    underlyingProductRequirements: {
      requiredNominalSizeValue: number | null
      requiredNominalSizeUnit: string | null
      requiredPackCount: number
    } | null
    blockReason?: string
    enforceCandidateStatus: boolean
  }

  imageSafetyPolicy: {
    printedLabelConflict: boolean
    printedLabel: string | null
    advertisedSizeLabel: string | null
    blockCatalogImage: boolean
    blockConsumerDisplay: boolean
    allowIllustrativeConsumerDisplayWithApproval: boolean
    recommendedImageClassification: 'exact_product' | 'illustrative' | 'blocked_mismatch'
    quarantineReason?: string
  }
}

export interface ImageSafetyDecision {
  isSafeForCatalog: boolean
  isSafeForConsumerDisplay: boolean
  allowIllustrativeWithApproval: boolean
  hasConflict: boolean
  classification: 'exact_product' | 'illustrative' | 'blocked_mismatch'
  reason: string
}

// ---------------------------------------------------------------------------
// Helper Parsers
// ---------------------------------------------------------------------------

/**
 * Extracts simple numeric weight/volume label from package text (e.g. "5KG", "10 kg", "1.5L", "725ml")
 */
export function parsePackageWeightLabel(
  label?: string | null
): { value: number; unit: string; canonicalMeasurement?: CanonicalMeasurement } | null {
  if (!label || typeof label !== 'string') return null
  const cleaned = normalizeArabicNumerals(label).trim().replace(/[()]/g, ' ')
  const m = cleaned.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)$/i)
  if (!m) return null

  const val = Number(m[1])
  const u = m[2].toLowerCase()
  const norm = normalizeMeasurement(val, u)
  if (!norm || !norm.isRecognized) {
    return { value: val, unit: u }
  }
  return {
    value: norm.rawValue,
    unit: norm.canonicalUnit,
    canonicalMeasurement: norm
  }
}

/**
 * Detects multi-buy / promotional conditions (e.g. "Buy 2 get 1 free", "2 for 15 SAR").
 */
export function detectMultiBuyPromoCondition(
  text?: string | null
): { isMultiBuy: boolean; requiredQty: number | null; freeQty?: number | null; matchedPhrase?: string } {
  if (!text || typeof text !== 'string') return { isMultiBuy: false, requiredQty: null }
  const clean = normalizeArabicNumerals(text)

  // Pattern 1: Buy X Get Y Free / اشتري X واحصل على Y مجانا
  const mBuyGet = clean.match(/(?:اشتري|buy)\s*(\d+)\s*(?:واحصل\s*على|get)\s*(\d+)\s*(?:مجانا|free)/i)
  if (mBuyGet) {
    return {
      isMultiBuy: true,
      requiredQty: parseInt(mBuyGet[1], 10),
      freeQty: parseInt(mBuyGet[2], 10),
      matchedPhrase: mBuyGet[0]
    }
  }

  // Pattern 2: X+Y Free
  const mPlus = clean.match(/\b(\d+)\s*\+\s*(\d+)\s*(?:free|مجانا)/i)
  if (mPlus) {
    return {
      isMultiBuy: true,
      requiredQty: parseInt(mPlus[1], 10) + parseInt(mPlus[2], 10),
      freeQty: parseInt(mPlus[2], 10),
      matchedPhrase: mPlus[0]
    }
  }

  // Pattern 3: X pcs for Y SAR / X حبات بسعر Y
  const mFor = clean.match(/\b(\d+)\s*(?:pcs?|pieces?|حبة|حبات|قطع|أكياس|كيس)\s*(?:for|بسعر|بـ)\s*(?:sar\s*)?(\d+(?:\.\d+)?)/i)
  if (mFor) {
    return {
      isMultiBuy: true,
      requiredQty: parseInt(mFor[1], 10),
      matchedPhrase: mFor[0]
    }
  }

  return { isMultiBuy: false, requiredQty: null }
}

/**
 * Detects explicit physical multipacks in packaging descriptions (e.g. "2 x 5 kg", "2x5kg", "4 x 1 L").
 */
export function detectExplicitPhysicalMultipack(
  text?: string | null
): {
  isMultipack: boolean
  packCount: number | null
  unitSizeValue: number | null
  unitSizeUnit: string | null
  matchedPhrase?: string
} {
  if (!text || typeof text !== 'string') {
    return { isMultipack: false, packCount: null, unitSizeValue: null, unitSizeUnit: null }
  }
  const clean = normalizeArabicNumerals(text)

  // Pattern 1: "2 x 5 kg", "2 x 5kg", "2 × 5 كجم", "2 كيس × 5 كجم", "4 cans x 330 ml"
  const m1 = clean.match(
    /\b(\d+)\s*(?:pcs?|pieces?|bags?|cans?|bottles?|حبة|حبات|قطع|أكياس|كيس|علب|علبة|زجاجة|قوارير|قارورة)?\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)/i
  )
  if (m1) {
    const count = parseInt(m1[1], 10)
    const val = parseFloat(m1[2])
    const u = m1[3].toLowerCase()
    const norm = normalizeMeasurement(val, u)
    if (norm && norm.isRecognized && count > 1) {
      return {
        isMultipack: true,
        packCount: count,
        unitSizeValue: norm.rawValue,
        unitSizeUnit: norm.canonicalUnit,
        matchedPhrase: m1[0]
      }
    }
  }

  // Pattern 2: "5kg x 2", "5 kg × 2"
  const m2 = clean.match(/\b(\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)\s*(?:x|×|\*)\s*(\d+)\b/i)
  if (m2) {
    const val = parseFloat(m2[1])
    const u = m2[2].toLowerCase()
    const count = parseInt(m2[3], 10)
    const norm = normalizeMeasurement(val, u)
    if (norm && norm.isRecognized && count > 1) {
      return {
        isMultipack: true,
        packCount: count,
        unitSizeValue: norm.rawValue,
        unitSizeUnit: norm.canonicalUnit,
        matchedPhrase: m2[0]
      }
    }
  }

  // Pattern 3: "ربطة 2 كيس 5 كجم"
  const m3 = clean.match(
    /(?:ربطة|مجموعة|كرتون|shrinkwrap|twin\s*pack|duo\s*pack)\s*(?:من\s*)?(\d+)?\s*(?:pcs?|pieces?|bags?|cans?|bottles?|حبة|حبات|قطع|أكياس|كيس|علب|علبة)?\s*(?:x|×|\*|وزن|سعة)?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)/i
  )
  if (m3) {
    const count = m3[1] ? parseInt(m3[1], 10) : 2
    const val = parseFloat(m3[2])
    const u = m3[3].toLowerCase()
    const norm = normalizeMeasurement(val, u)
    if (norm && norm.isRecognized) {
      return {
        isMultipack: true,
        packCount: count,
        unitSizeValue: norm.rawValue,
        unitSizeUnit: norm.canonicalUnit,
        matchedPhrase: m3[0]
      }
    }
  }

  return { isMultipack: false, packCount: null, unitSizeValue: null, unitSizeUnit: null }
}

/**
 * Analyzes table heading and row context without making blind assumptions.
 */
export function analyzeTableHeading(
  heading?: string | null,
  rowLabel?: string | null
): {
  headingType: 'size_variant' | 'quantity_condition' | 'generic' | 'none'
  inferredIntent: string
} {
  if (!heading || typeof heading !== 'string') {
    return { headingType: 'none', inferredIntent: 'No table heading provided' }
  }

  const cleanHead = heading.trim().toLowerCase()
  const cleanRow = rowLabel ? rowLabel.trim().toLowerCase() : ''

  const isSizeHead = /^(?:size|الحجم|الوزن|المقاس|حجم|وزن)$/i.test(cleanHead)
  const isQtyHead = /^(?:qty|quantity|الكمية|عدد|حبة|قطع|عرض)$/i.test(cleanHead)

  // Cross-examine row label if present
  const rowIsPureCount = /^\d+\s*(?:pcs?|pc|حبة|حبات|قطع|أكياس|كيس)$/i.test(cleanRow)
  const rowIsWeightOrVolume = /^\d+(?:\.\d+)?\s*(?:kg|g|l|ml|كجم|جم|لتر|مل)$/i.test(cleanRow)

  if (isSizeHead) {
    if (rowIsPureCount) {
      return {
        headingType: 'quantity_condition',
        inferredIntent: 'Heading labeled SIZE but row specifies piece count; corrected to quantity condition.'
      }
    }
    return {
      headingType: 'size_variant',
      inferredIntent: 'Heading specifies nominal package size variant.'
    }
  }

  if (isQtyHead) {
    if (rowIsWeightOrVolume) {
      return {
        headingType: 'size_variant',
        inferredIntent: 'Heading labeled QTY but row specifies physical nominal weight/volume; corrected to size variant.'
      }
    }
    return {
      headingType: 'quantity_condition',
      inferredIntent: 'Heading specifies promotional quantity condition or count.'
    }
  }

  return { headingType: 'generic', inferredIntent: 'Heading is generic or descriptive.' }
}

// ---------------------------------------------------------------------------
// Core Safeguard Analysis
// ---------------------------------------------------------------------------

/**
 * Uses full offer context to distinguish package variants, multipacks, quantity discounts,
 * and ambiguous configurations.
 */
export function detectPackageConfigurationContext(
  input: PackageContextInput
): PackageContextAnalysis {
  const reasons: string[] = []

  const titleEn = input.titleEn || ''
  const titleAr = input.titleAr || ''
  const combinedTitle = `${titleEn} ${titleAr}`.trim()
  const fullTextContext = [
    combinedTitle,
    input.sizeText,
    input.rawSizeText,
    input.conditionText,
    input.promoNotes,
    input.bonusWording,
    input.rowLabel
  ]
    .filter(Boolean)
    .join(' ')

  // 1. Detect customer purchase limits (e.g. "Max 2 pcs")
  const limitCheck = detectCustomerPurchaseLimit(fullTextContext)
  if (limitCheck.hasLimit) {
    reasons.push(`Detected purchase limit: ${limitCheck.limitPcs} pcs (${limitCheck.matchedPhrase})`)
  }

  // 2. Detect multi-buy / promotional condition
  const multiBuyCheck = detectMultiBuyPromoCondition(fullTextContext)
  if (multiBuyCheck.isMultiBuy) {
    reasons.push(`Detected multi-buy promotional condition: ${multiBuyCheck.matchedPhrase}`)
  }

  // 3. Detect explicit physical multipack in text (e.g. "2 x 5 kg")
  const multiPackCheck = detectExplicitPhysicalMultipack(fullTextContext)
  if (multiPackCheck.isMultipack) {
    reasons.push(
      `Detected explicit physical multipack: ${multiPackCheck.packCount} x ${multiPackCheck.unitSizeValue}${multiPackCheck.unitSizeUnit}`
    )
  }

  // 4. Cross-examine table heading and row label
  const tableCheck = analyzeTableHeading(input.tableHeading, input.rowLabel)
  if (tableCheck.headingType !== 'none') {
    reasons.push(`Table heading analysis: [${tableCheck.headingType}] ${tableCheck.inferredIntent}`)
  }

  // 5. Inspect printed packaging label on artwork (if provided from OCR)
  const printedLabelParsed = parsePackageWeightLabel(input.printedPackageLabel)
  if (printedLabelParsed) {
    reasons.push(`Packaging artwork printed label: ${printedLabelParsed.value} ${printedLabelParsed.unit}`)
  }

  // 6. Determine primary package dimensions
  let nominalVal = input.eachSizeValue ?? null
  let nominalUnit = input.eachSizeUnit ? input.eachSizeUnit.toLowerCase() : null
  let packCount = input.innerPackCount != null && input.innerPackCount >= 1 ? input.innerPackCount : 1

  // If explicit multipack parsed from text
  if (multiPackCheck.isMultipack && multiPackCheck.unitSizeValue != null && multiPackCheck.unitSizeUnit) {
    nominalVal = multiPackCheck.unitSizeValue
    nominalUnit = multiPackCheck.unitSizeUnit
    packCount = multiPackCheck.packCount || 2
  } else {
    if (nominalVal == null && input.sizeText) {
      const parsedLabel = parsePackageWeightLabel(input.sizeText)
      if (parsedLabel) {
        nominalVal = parsedLabel.value
        nominalUnit = parsedLabel.unit
      }
    }
    if (nominalVal == null && (titleEn || titleAr || input.sizeText)) {
      const parsedQty = parseAndNormalizeQuantity({
        title_en: titleEn,
        title_ar: titleAr,
        size_text: input.sizeText || '',
        item_domain: 'grocery',
        unit_type: input.saleUnitType || 'piece'
      })
      if (parsedQty && parsedQty.each_size_value != null && parsedQty.each_size_unit) {
        nominalVal = parsedQty.each_size_value
        nominalUnit = String(parsedQty.each_size_unit).toLowerCase()
        if (parsedQty.pack_quantity > 1 && !multiPackCheck.isMultipack) {
          packCount = parsedQty.pack_quantity
        }
      }
    }
  }

  // Guard: If a purchase limit was detected and packCount equals the purchase limit without
  // any physical multipack text, DO NOT let the purchase limit inflate the pack count!
  if (limitCheck.hasLimit && !multiPackCheck.isMultipack && packCount === limitCheck.limitPcs && packCount > 1) {
    reasons.push(`Corrected pack count from ${packCount} to 1 (isolated purchase limit from pack size).`)
    packCount = 1
  }

  // Compute total content
  let totalContentVal = input.totalContentValue ?? null
  let totalContentUnit = input.totalContentUnit ? input.totalContentUnit.toLowerCase() : nominalUnit
  if (totalContentVal == null && nominalVal != null) {
    totalContentVal = Number((packCount * nominalVal).toFixed(4))
    totalContentUnit = nominalUnit
  }

  // 7. Classify Configuration Kind
  let configurationKind: PackageConfigurationKind = 'standalone_package_variant'
  let confidence: 'high' | 'medium' | 'low' = 'high'

  // Check assortment status first
  const isAssortment =
    input.assortmentStatus === 'multiple_variants' ||
    input.assortmentStatus === 'explicit_assortment' ||
    input.assortmentStatus === 'unsplit_assortment' ||
    /\b(?:assorted|منوع|مشكل)\b/i.test(combinedTitle)

  if (isAssortment) {
    configurationKind = 'ambiguous_unconfirmed'
    reasons.push('Assortment promotion spanning multiple variant sizes or flavors.')
  } else if (multiPackCheck.isMultipack) {
    configurationKind = 'multipack_bundle'
  } else if (multiBuyCheck.isMultiBuy && !tableCheck.headingType.includes('size')) {
    configurationKind = 'conditional_quantity_discount'
  } else if (limitCheck.hasLimit && packCount === 1) {
    configurationKind = 'conditional_quantity_discount'
  } else if (tableCheck.headingType === 'size_variant' && nominalVal != null) {
    configurationKind = 'standalone_package_variant'
  } else if (tableCheck.headingType === 'quantity_condition') {
    configurationKind = 'conditional_quantity_discount'
  } else if (nominalVal != null && nominalUnit != null) {
    configurationKind = 'standalone_package_variant'
  } else if (!input.sizeText && !combinedTitle.match(/\d+\s*(?:kg|g|l|ml|كجم|جم|لتر|مل)/i)) {
    // Standard un-sized or count-based item
    configurationKind = 'standalone_package_variant'
  } else {
    configurationKind = 'ambiguous_unconfirmed'
    confidence = 'low'
    reasons.push('Insufficient evidence to determine definite package configuration.')
  }

  // 8. Image Safety Check against printed label
  let printedLabelConflict = false
  let blockCatalogImage = false
  let blockConsumerDisplay = false
  let allowIllustrativeConsumerDisplayWithApproval = false
  let recommendedImageClassification: 'exact_product' | 'illustrative' | 'blocked_mismatch' = 'exact_product'
  let quarantineReason: string | undefined

  const advertisedSizeLabel = nominalVal != null && nominalUnit ? `${nominalVal} ${nominalUnit}` : null

  if (printedLabelParsed && nominalVal != null && nominalUnit) {
    // If the offer is a multipack bundle (e.g. 2 x 5 kg) and printed label matches the individual unit (5 kg):
    if (configurationKind === 'multipack_bundle' && packCount > 1) {
      const unitCompat = areSizesStrictlyCompatible(printedLabelParsed.value, printedLabelParsed.unit, nominalVal, nominalUnit)
      if (unitCompat.isCompatible) {
        // Individual package matches, but consumer must see it is a bundle, not a single package in catalog
        blockCatalogImage = true
        blockConsumerDisplay = false
        allowIllustrativeConsumerDisplayWithApproval = true
        recommendedImageClassification = 'illustrative'
        reasons.push('Packaging artwork represents single component package of a multipack bundle.')
      } else {
        printedLabelConflict = true
        blockCatalogImage = true
        blockConsumerDisplay = true
        recommendedImageClassification = 'blocked_mismatch'
        quarantineReason = `Printed packaging label (${printedLabelParsed.value}${printedLabelParsed.unit}) conflicts with bundle unit size (${nominalVal}${nominalUnit}).`
      }
    } else {
      // Standalone variant: compare directly
      const compat = areSizesStrictlyCompatible(printedLabelParsed.value, printedLabelParsed.unit, nominalVal, nominalUnit)
      if (!compat.isCompatible) {
        printedLabelConflict = true
        blockCatalogImage = true
        blockConsumerDisplay = true
        allowIllustrativeConsumerDisplayWithApproval = false
        recommendedImageClassification = 'blocked_mismatch'
        quarantineReason = `Packaging artwork physically prints ${printedLabelParsed.value}${printedLabelParsed.unit}, conflicting with advertised ${advertisedSizeLabel} offer. Visual packaging mismatch blocked.`
        reasons.push(quarantineReason)
      } else {
        recommendedImageClassification = 'exact_product'
      }
    }
  } else if (!printedLabelParsed && nominalVal != null) {
    // No printed weight label on bag graphic (e.g. Al Walimah sack)
    if (nominalVal >= 10 || packCount > 1) {
      // Cannot prove it is exact catalog product photography without printed weight or verification
      blockCatalogImage = true
      allowIllustrativeConsumerDisplayWithApproval = true
      recommendedImageClassification = 'illustrative'
      reasons.push('Package graphic lacks printed weight label; requires operator confirmation for illustrative consumer display.')
    }
  }

  // 9. Catalog Matching Policy
  let allowAutomaticDirectMatch = true
  let preventFictionalSkuCreation = true
  let targetMatchMode: PackageContextAnalysis['catalogMatchingPolicy']['targetMatchMode'] = 'exact_standalone_sku'
  let underlyingProductRequirements: PackageContextAnalysis['catalogMatchingPolicy']['underlyingProductRequirements'] = null
  let blockReason: string | undefined
  let enforceCandidateStatus = false

  if (isAssortment || configurationKind === 'ambiguous_unconfirmed') {
    allowAutomaticDirectMatch = false
    targetMatchMode = 'candidate_only_unverified'
    enforceCandidateStatus = true
    blockReason = 'Assortment or unconfirmed package configuration cannot automatically match an exact SKU.'
  } else if (configurationKind === 'multipack_bundle') {
    // A promotional bundle references the underlying product (5 kg) without creating a fictional 10 kg manufacturer sack!
    targetMatchMode = 'bundle_referencing_underlying_sku'
    underlyingProductRequirements = {
      requiredNominalSizeValue: nominalVal,
      requiredNominalSizeUnit: nominalUnit,
      requiredPackCount: 1
    }
    preventFictionalSkuCreation = true
    // Bundle must maintain candidate / unverified status if not verified as a commercial bundle
    enforceCandidateStatus = true
    reasons.push(`Promotional bundle references underlying single SKU (${nominalVal}${nominalUnit}) without inventing fictional SKU.`)
  } else if (configurationKind === 'conditional_quantity_discount') {
    targetMatchMode = 'exact_standalone_sku'
    underlyingProductRequirements = {
      requiredNominalSizeValue: nominalVal,
      requiredNominalSizeUnit: nominalUnit,
      requiredPackCount: 1
    }
    reasons.push(`Conditional quantity promotion matches underlying single SKU (${nominalVal}${nominalUnit}).`)
  }

  // Sale unit type
  let saleUnitType: PackageContextAnalysis['physicalPackage']['saleUnitType'] = 'piece'
  if (nominalUnit === 'kg' && packCount === 1) {
    saleUnitType = 'piece'
  } else if (packCount > 1) {
    saleUnitType = configurationKind === 'multipack_bundle' ? 'bundle' : 'pack'
  } else if (getMeasurementDimension(nominalUnit) === 'volume') {
    saleUnitType = 'volume'
  }

  return {
    configurationKind,
    confidence,
    reasons,
    physicalPackage: {
      nominalSizeValue: nominalVal,
      nominalSizeUnit: nominalUnit,
      packCount,
      isMultipack: packCount > 1,
      totalContentValue: totalContentVal,
      totalContentUnit: totalContentUnit,
      saleUnitType
    },
    promotionalCondition: {
      hasCustomerPurchaseLimit: limitCheck.hasLimit,
      customerLimitPcs: limitCheck.limitPcs,
      isMultiBuyPricing: multiBuyCheck.isMultiBuy,
      multiBuyRequiredQuantity: multiBuyCheck.requiredQty,
      isQuantityDiscountCondition: multiBuyCheck.isMultiBuy || limitCheck.hasLimit,
      conditionSummary: limitCheck.hasLimit
        ? `Purchase limit: max ${limitCheck.limitPcs} pcs`
        : multiBuyCheck.isMultiBuy
          ? `Multi-buy promo: ${multiBuyCheck.matchedPhrase}`
          : null
    },
    catalogMatchingPolicy: {
      allowAutomaticDirectMatch,
      preventFictionalSkuCreation,
      targetMatchMode,
      underlyingProductRequirements,
      blockReason,
      enforceCandidateStatus
    },
    imageSafetyPolicy: {
      printedLabelConflict,
      printedLabel: printedLabelParsed ? `${printedLabelParsed.value}${printedLabelParsed.unit}` : null,
      advertisedSizeLabel,
      blockCatalogImage,
      blockConsumerDisplay,
      allowIllustrativeConsumerDisplayWithApproval,
      recommendedImageClassification,
      quarantineReason
    }
  }
}

// ---------------------------------------------------------------------------
// Reusable Validation Safeguards for Catalog Matching & Image Safety
// ---------------------------------------------------------------------------

/**
 * Reusable Image Safety Validator.
 * Detects printed package size conflicts and determines exact vs illustrative vs blocked status.
 */
export function validateImageSafetyWithPackageSafeguards(params: {
  printedLabel?: string | null
  advertisedSizeValue?: number | null
  advertisedSizeUnit?: string | null
  advertisedPackCount?: number | null
  isOperatorApprovedIllustrative?: boolean
  hasNoPrintedLabelOnPackaging?: boolean
}): ImageSafetyDecision {
  const {
    printedLabel,
    advertisedSizeValue,
    advertisedSizeUnit,
    advertisedPackCount: _advertisedPackCount,
    isOperatorApprovedIllustrative,
    hasNoPrintedLabelOnPackaging
  } = params

  const parsedLabel = parsePackageWeightLabel(printedLabel)

  // 1. If graphic has an explicit printed label and advertised size is specified:
  if (parsedLabel && advertisedSizeValue != null && advertisedSizeUnit) {
    const isEquivalent = areSizesStrictlyCompatible(
      parsedLabel.value,
      parsedLabel.unit,
      advertisedSizeValue,
      advertisedSizeUnit
    ).isCompatible

    if (!isEquivalent) {
      return {
        isSafeForCatalog: false,
        isSafeForConsumerDisplay: false,
        allowIllustrativeWithApproval: false,
        hasConflict: true,
        classification: 'blocked_mismatch',
        reason: `Printed packaging label (${parsedLabel.value}${parsedLabel.unit}) conflicts with advertised offer size (${advertisedSizeValue}${advertisedSizeUnit}). Mismatched image blocked from both catalog and consumer display.`
      }
    }

    return {
      isSafeForCatalog: true,
      isSafeForConsumerDisplay: true,
      allowIllustrativeWithApproval: true,
      hasConflict: false,
      classification: 'exact_product',
      reason: 'Printed packaging label matches advertised offer size.'
    }
  }

  // 2. Packaging graphic has NO printed label (e.g. Al Walimah sack):
  if (!parsedLabel || hasNoPrintedLabelOnPackaging) {
    if (isOperatorApprovedIllustrative) {
      return {
        isSafeForCatalog: false, // Cannot be canonical catalog photography without verified label
        isSafeForConsumerDisplay: true,
        allowIllustrativeWithApproval: true,
        hasConflict: false,
        classification: 'illustrative',
        reason: 'Operator-approved representative image for consumer offer display.'
      }
    }

    return {
      isSafeForCatalog: false,
      isSafeForConsumerDisplay: false,
      allowIllustrativeWithApproval: true,
      hasConflict: false,
      classification: 'illustrative',
      reason: 'Packaging graphic lacks verified printed size label. Requires operator approval before consumer display.'
    }
  }

  return {
    isSafeForCatalog: false,
    isSafeForConsumerDisplay: false,
    allowIllustrativeWithApproval: false,
    hasConflict: false,
    classification: 'blocked_mismatch',
    reason: 'Unverified packaging image.'
  }
}

/**
 * Reusable Catalog Matching Safeguard Validator.
 * Enforces package variant vs multipack checks during catalog resolution.
 */
export function validateCatalogMatchingWithPackageSafeguards(
  offerInput: any,
  candidateProduct: any
): {
  isCompatible: boolean
  status:
    | 'verified_compatible'
    | 'bundle_underlying_compatible'
    | 'rejected_contradictory'
    | 'rejected_insufficient_evidence'
    | 'rejected_ambiguous_offer'
  reason: string
  enforceCandidateStatus?: boolean
} {
  if (!candidateProduct) {
    return {
      isCompatible: false,
      status: 'rejected_insufficient_evidence',
      reason: 'Candidate product is null or undefined.'
    }
  }

  const analysis = detectPackageConfigurationContext({
    titleEn: offerInput.title_en || offerInput.titleEn,
    titleAr: offerInput.title_ar || offerInput.titleAr,
    sizeText: offerInput.size_text || offerInput.sizeOrWeight,
    conditionText: offerInput.condition_text || offerInput.promoNotes,
    tableHeading: offerInput.table_heading || offerInput.tableHeading,
    rowLabel: offerInput.row_label || offerInput.rowLabel,
    printedPackageLabel: offerInput.printed_package_label || offerInput.printedPackageLabel,
    eachSizeValue: offerInput.each_size_value != null ? Number(offerInput.each_size_value) : offerInput.eachSizeValue,
    eachSizeUnit: offerInput.each_size_unit || offerInput.eachSizeUnit,
    innerPackCount: offerInput.inner_pack_count != null ? Number(offerInput.inner_pack_count) : offerInput.innerPackCount,
    assortmentStatus: offerInput.assortment_status || offerInput.assortmentStatus
  })

  // 1. Ambiguous offers or assortments cannot automatically match exact SKUs
  if (analysis.configurationKind === 'ambiguous_unconfirmed') {
    return {
      isCompatible: false,
      status: 'rejected_ambiguous_offer',
      reason: `Ambiguous package configuration (${analysis.reasons.join('; ')}). Exact SKU match blocked.`,
      enforceCandidateStatus: true
    }
  }

  const prodSizeVal = candidateProduct.each_size_value != null ? Number(candidateProduct.each_size_value) : null
  const prodSizeUnit = candidateProduct.each_size_unit ? String(candidateProduct.each_size_unit).toLowerCase() : null
  const prodPack = candidateProduct.inner_pack_count != null ? Number(candidateProduct.inner_pack_count) : 1

  // 2. Multipack bundle: allows referencing underlying product without creating fictional manufacturer SKUs
  if (analysis.configurationKind === 'multipack_bundle') {
    const requiredUnit = analysis.catalogMatchingPolicy.underlyingProductRequirements
    if (requiredUnit && prodSizeVal != null && prodSizeUnit) {
      const unitCompat = areSizesStrictlyCompatible(
        requiredUnit.requiredNominalSizeValue,
        requiredUnit.requiredNominalSizeUnit,
        prodSizeVal,
        prodSizeUnit
      )

      if (unitCompat.isCompatible && prodPack === 1) {
        return {
          isCompatible: true,
          status: 'bundle_underlying_compatible',
          reason: `Promotional bundle (${analysis.physicalPackage.packCount} x ${requiredUnit.requiredNominalSizeValue}${requiredUnit.requiredNominalSizeUnit}) correctly references underlying single-piece catalog product #${candidateProduct.id}.`,
          enforceCandidateStatus: true // Must maintain candidate status on the bundle offer
        }
      }
    }

    return {
      isCompatible: false,
      status: 'rejected_contradictory',
      reason: `Multipack bundle (${analysis.physicalPackage.packCount} x ${analysis.physicalPackage.nominalSizeValue}${analysis.physicalPackage.nominalSizeUnit}) is incompatible with catalog product #${candidateProduct.id} (${prodSizeVal}${prodSizeUnit}, pack of ${prodPack}).`
    }
  }

  // 3. Standalone package variant: strict equality
  if (analysis.physicalPackage.nominalSizeValue != null && analysis.physicalPackage.nominalSizeUnit && prodSizeVal != null && prodSizeUnit) {
    const sizeCompat = areSizesStrictlyCompatible(
      analysis.physicalPackage.nominalSizeValue,
      analysis.physicalPackage.nominalSizeUnit,
      prodSizeVal,
      prodSizeUnit
    )
    if (!sizeCompat.isCompatible) {
      return {
        isCompatible: false,
        status: 'rejected_contradictory',
        reason: `Package size contradiction: offer requires ${analysis.physicalPackage.nominalSizeValue} ${analysis.physicalPackage.nominalSizeUnit} standalone variant, but candidate product #${candidateProduct.id} is ${prodSizeVal} ${prodSizeUnit}.`
      }
    }

    if (analysis.physicalPackage.packCount !== prodPack) {
      return {
        isCompatible: false,
        status: 'rejected_contradictory',
        reason: `Pack count contradiction: offer specifies pack of ${analysis.physicalPackage.packCount}, but candidate product specifies pack of ${prodPack}.`
      }
    }
  }

  return {
    isCompatible: true,
    status: 'verified_compatible',
    reason: 'Package configuration and size verified compatible.'
  }
}
