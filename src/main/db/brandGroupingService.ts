/**
 * Brand Grouping and Catalog Candidate Retrieval Service
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001
 *
 * Implements brand-first normalization, brand status classification,
 * cross-leaflet offer deduplication, and indexed catalog candidate retrieval.
 * CATEGORY IS NOT REQUIRED OR USED AS A PREREQUISITE.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
  BrandMatchStatus,
  CompactCatalogCandidate,
  NormalizedIdentityAttributes
} from '../../shared/types/catalogMatching'
import { UnifiedBatchOffer } from '../../shared/types/batchExtraction'
import {
  normalizeArabicText,
  normalizeEnglishText,
  normalizeSearchText,
  isMeaningfulText
} from '../../shared/utils/textNormalization'
import { canonicalizeUnit } from '../../shared/utils/priceAndUnitNormalizer'
import { getCanonicalBrandId } from '../../shared/utils/bilingualTokenNormalizer'
import { areSizesStrictlyCompatible, arePackConfigsStrictlyCompatible } from '../../shared/utils/sizeCompatibility'
import { resolveQuantityAndPromoSemantics, evaluateIdentitySufficiency } from './productIdentityPolicy'
import { MatchingEvidenceOverlayService } from './matchingEvidenceOverlayService'

export interface AbsenceVerificationResult {
  isExhaustivelyAbsent: boolean
  foundCandidate: CompactCatalogCandidate | null
  coverage: 'complete' | 'partial' | 'inconclusive'
  searchDiagnostics: string[]
}

const COMMODITY_KEYWORDS = [
  'طماطم', 'بطاطس', 'بصل', 'خيار', 'تفاح', 'موز', 'برتقال', 'ليمون', 'جزر', 'لحم', 'دجاج', 'سمك',
  'tomato', 'potato', 'onion', 'cucumber', 'apple', 'banana', 'orange', 'lemon', 'carrot', 'meat', 'beef', 'chicken', 'fish'
]

function isLikelyCommodity(text: string): boolean {
  const lower = text.toLowerCase()
  return COMMODITY_KEYWORDS.some((kw) => lower.includes(kw))
}

export interface BrandGroup {
  brandKey: string
  brandNameAr: string | null
  brandNameEn: string | null
  brandStatus: BrandMatchStatus
  uniqueIdentities: DeduplicatedIdentityItem[]
  candidates: CompactCatalogCandidate[]
}

export interface DeduplicatedIdentityItem {
  identityKey: string
  normalizedAttrs: NormalizedIdentityAttributes
  memberOffers: UnifiedBatchOffer[]
}

// Built-in registry of known brand aliases & transliterations
const BRAND_ALIAS_REGISTRY: Record<string, { brandKey: string; nameEn: string; nameAr: string }> = {
  // Almarai
  'almarai': { brandKey: 'almarai', nameEn: 'Almarai', nameAr: 'المراعي' },
  'al marai': { brandKey: 'almarai', nameEn: 'Almarai', nameAr: 'المراعي' },
  'المراعي': { brandKey: 'almarai', nameEn: 'Almarai', nameAr: 'المراعي' },
  'مراعي': { brandKey: 'almarai', nameEn: 'Almarai', nameAr: 'المراعي' },
  // Nadec
  'nadec': { brandKey: 'nadec', nameEn: 'Nadec', nameAr: 'نادك' },
  'نادك': { brandKey: 'nadec', nameEn: 'Nadec', nameAr: 'نادك' },
  // Pepsi
  'pepsi': { brandKey: 'pepsi', nameEn: 'Pepsi', nameAr: 'بيبسي' },
  'بيبسي': { brandKey: 'pepsi', nameEn: 'Pepsi', nameAr: 'بيبسي' },
  // Coca Cola
  'coca-cola': { brandKey: 'coca_cola', nameEn: 'Coca-Cola', nameAr: 'كوكاكولا' },
  'coca cola': { brandKey: 'coca_cola', nameEn: 'Coca-Cola', nameAr: 'كوكاكولا' },
  'كوكاكولا': { brandKey: 'coca_cola', nameEn: 'Coca-Cola', nameAr: 'كوكاكولا' },
  'كوكا كولا': { brandKey: 'coca_cola', nameEn: 'Coca-Cola', nameAr: 'كوكاكولا' },
  // Nestle
  'nestle': { brandKey: 'nestle', nameEn: 'Nestle', nameAr: 'نستله' },
  'nestlé': { brandKey: 'nestle', nameEn: 'Nestle', nameAr: 'نستله' },
  'نستله': { brandKey: 'nestle', nameEn: 'Nestle', nameAr: 'نستله' },
  // Fazco
  'fazco': { brandKey: 'fazco', nameEn: 'Fazco', nameAr: 'فازكو' },
  'فازكو': { brandKey: 'fazco', nameEn: 'Fazco', nameAr: 'فازكو' },
  // Afia
  'afia': { brandKey: 'afia', nameEn: 'Afia', nameAr: 'عافية' },
  'عافية': { brandKey: 'afia', nameEn: 'Afia', nameAr: 'عافية' },
  // Sadia
  'sadia': { brandKey: 'sadia', nameEn: 'Sadia', nameAr: 'ساديا' },
  'ساديا': { brandKey: 'sadia', nameEn: 'Sadia', nameAr: 'ساديا' },
  // Sunbullah
  'sunbulah': { brandKey: 'sunbulah', nameEn: 'Sunbulah', nameAr: 'السنبلة' },
  'al sunbulah': { brandKey: 'sunbulah', nameEn: 'Sunbulah', nameAr: 'السنبلة' },
  'السنبلة': { brandKey: 'sunbulah', nameEn: 'Sunbulah', nameAr: 'السنبلة' },
  // Americana
  'americana': { brandKey: 'americana', nameEn: 'Americana', nameAr: 'امريكانا' },
  'أمريكانا': { brandKey: 'americana', nameEn: 'Americana', nameAr: 'امريكانا' },
  'امريكانا': { brandKey: 'americana', nameEn: 'Americana', nameAr: 'امريكانا' },
  // Goody
  'goody': { brandKey: 'goody', nameEn: 'Goody', nameAr: 'قودي' },
  'قودي': { brandKey: 'goody', nameEn: 'Goody', nameAr: 'قودي' },
  // Lipton
  'lipton': { brandKey: 'lipton', nameEn: 'Lipton', nameAr: 'ليبتون' },
  'ليبتون': { brandKey: 'lipton', nameEn: 'Lipton', nameAr: 'ليبتون' },
  // Dettol
  'dettol': { brandKey: 'dettol', nameEn: 'Dettol', nameAr: 'ديدول' },
  'ديتول': { brandKey: 'dettol', nameEn: 'Dettol', nameAr: 'ديتول' },
  // Tide
  'tide': { brandKey: 'tide', nameEn: 'Tide', nameAr: 'تايد' },
  'تايد': { brandKey: 'tide', nameEn: 'Tide', nameAr: 'تايد' },
  // Fairy
  'fairy': { brandKey: 'fairy', nameEn: 'Fairy', nameAr: 'فيري' },
  'فيري': { brandKey: 'fairy', nameEn: 'Fairy', nameAr: 'فيري' },
  // Ariel
  'ariel': { brandKey: 'ariel', nameEn: 'Ariel', nameAr: 'اريال' },
  'اريال': { brandKey: 'ariel', nameEn: 'Ariel', nameAr: 'اريال' },
  'أريال': { brandKey: 'ariel', nameEn: 'Ariel', nameAr: 'اريال' },
  // Tanmiah / Golden Chicken / Radwa / Entaj
  'tanmiah': { brandKey: 'tanmiah', nameEn: 'Tanmiah', nameAr: 'التنمية' },
  'التنمية': { brandKey: 'tanmiah', nameEn: 'Tanmiah', nameAr: 'التنمية' },
  'تنمية': { brandKey: 'tanmiah', nameEn: 'Tanmiah', nameAr: 'التنمية' },
  'golden chicken': { brandKey: 'golden_chicken', nameEn: 'Golden Chicken', nameAr: 'الفروج الذهبي' },
  'الفروج الذهبي': { brandKey: 'golden_chicken', nameEn: 'Golden Chicken', nameAr: 'الفروج الذهبي' },
  'radwa': { brandKey: 'radwa', nameEn: 'Radwa', nameAr: 'رضوى' },
  'رضوى': { brandKey: 'radwa', nameEn: 'Radwa', nameAr: 'رضوى' },
  'entaj': { brandKey: 'entaj', nameEn: 'Entaj', nameAr: 'إنتاج' },
  'إنتاج': { brandKey: 'entaj', nameEn: 'Entaj', nameAr: 'إنتاج' },
  'انتاج': { brandKey: 'entaj', nameEn: 'Entaj', nameAr: 'إنتاج' },
  // Seara / Fakieh
  'seara': { brandKey: 'seara', nameEn: 'Seara', nameAr: 'سيارا' },
  'سيارا': { brandKey: 'seara', nameEn: 'Seara', nameAr: 'سيارا' },
  'fakieh': { brandKey: 'fakieh', nameEn: 'Fakieh', nameAr: 'فقيه' },
  'فقيه': { brandKey: 'fakieh', nameEn: 'Fakieh', nameAr: 'فقيه' }
}

const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670\u0640]/g

function normalizeArabicForBrandMatch(text: string): string {
  return text
    .replace(ARABIC_DIACRITICS_REGEX, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .trim()
}

function escapeBrandRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resolveKnownBrandMeta(rawValue: string | null | undefined): { brandKey: string; nameEn: string; nameAr: string } | null {
  const trimmed = (rawValue || '').trim().toLowerCase()
  if (!trimmed) return null

  const directAlias = BRAND_ALIAS_REGISTRY[trimmed]
  if (directAlias) return directAlias

  const arNorm = normalizeArabicForBrandMatch(trimmed)
  for (const [alias, meta] of Object.entries(BRAND_ALIAS_REGISTRY)) {
    if (/[\u0600-\u06FF]/.test(alias) && normalizeArabicForBrandMatch(alias) === arNorm) {
      return meta
    }
  }

  const tokenBrandId = getCanonicalBrandId(trimmed)
  if (tokenBrandId) {
    const cleanKey = tokenBrandId.replace('brand:', '')
    return { brandKey: cleanKey, nameEn: rawValue!.trim(), nameAr: rawValue!.trim() }
  }
  return null
}

function detectVerifiedBrandsInText(
  titleEn?: string | null,
  titleAr?: string | null
): Map<string, { brandKey: string; nameEn: string; nameAr: string }> {
  const found = new Map<string, { brandKey: string; nameEn: string; nameAr: string }>()
  const enLower = (titleEn || '').trim().toLowerCase()
  const arNorm = normalizeArabicForBrandMatch(titleAr || '')

  for (const [alias, meta] of Object.entries(BRAND_ALIAS_REGISTRY)) {
    const isArabicAlias = /[\u0600-\u06FF]/.test(alias)
    if (isArabicAlias) {
      if (!arNorm) continue
      const normAlias = normalizeArabicForBrandMatch(alias)
      const re = new RegExp(`(?:^|[^\\u0600-\\u06FFa-z0-9])${escapeBrandRegex(normAlias)}(?:$|[^\\u0600-\\u06FFa-z0-9])`)
      if (re.test(arNorm)) {
        found.set(meta.brandKey, meta)
      }
    } else {
      if (!enLower) continue
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeBrandRegex(alias)}(?:$|[^a-z0-9])`, 'i')
      if (re.test(enLower)) {
        found.set(meta.brandKey, meta)
      }
    }
  }

  // Also respect verified multi-word or single-token canonical brand dictionary entries
  for (const textSample of [enLower, arNorm]) {
    if (!textSample) continue
    const words = textSample.split(/\s+/).filter(Boolean)
    for (let i = 0; i < words.length; i++) {
      for (const spanLen of [2, 1]) {
        if (i + spanLen > words.length) continue
        const phrase = words.slice(i, i + spanLen).join(' ').replace(/^[^a-z0-9\u0600-\u06FF]+|[^a-z0-9\u0600-\u06FF]+$/gi, '')
        if (!phrase) continue
        const canonicalId = getCanonicalBrandId(phrase)
        if (canonicalId) {
          const cleanKey = canonicalId.replace('brand:', '')
          if (!found.has(cleanKey)) {
            found.set(cleanKey, { brandKey: cleanKey, nameEn: phrase, nameAr: phrase })
          }
        }
      }
    }
  }

  return found
}

function hasChoiceOrMultiBrandSeparator(titleEn?: string | null, titleAr?: string | null): boolean {
  const combined = `${titleEn || ''} ${titleAr || ''}`.trim()
  if (/\s+(?:or|أو)\s+/i.test(combined)) return true
  for (const raw of [titleEn || '', titleAr || '']) {
    const t = raw.trim()
    if (!t || /^[^/]+\/\s*(?:kg|kilo|bag|pc|pcs|piece|pack|ctn|carton|كيلو|كجم|كغ|حبة|قطعة|كيس|ربطة|علبة|كرتون)\s*$/i.test(t)) {
      continue
    }
    const withoutFraction = t.replace(/\b1\s*\/\s*2\b/g, '').trim()
    if (/[/]/.test(withoutFraction)) return true
  }
  return false
}

export class BrandGroupingService {
  private evidenceOverlay?: MatchingEvidenceOverlayService

  constructor(evidenceOverlay?: MatchingEvidenceOverlayService) {
    this.evidenceOverlay = evidenceOverlay
  }

  public setEvidenceOverlay(overlay?: MatchingEvidenceOverlayService): void {
    this.evidenceOverlay = overlay
  }

  /**
   * Normalize an extracted brand name into a canonical brand identity key and status.
   */
  public normalizeBrand(params: {
    brandRaw?: string | null
    brandAr?: string | null
    brandEn?: string | null
    titleAr?: string | null
    titleEn?: string | null
  }): {
    brandKey: string
    brandNameAr: string | null
    brandNameEn: string | null
    status: BrandMatchStatus
  } {
    // 1. Check if explicitly unbranded commodity (loose tomatoes, local butchery meat, onions per kg)
    const combinedTitles = `${params.titleAr || ''} ${params.titleEn || ''}`.trim()
    const isCommodity = isLikelyCommodity(combinedTitles)
    const rawBrandText = (params.brandRaw || params.brandEn || params.brandAr || '').trim().toLowerCase()

    // Explicit indicators that the commodity is genuinely unbranded/loose
    const isExplicitlyUnbrandedCommodity =
      rawBrandText === 'unbranded' ||
      rawBrandText === 'بدون علامة' ||
      rawBrandText === 'بدون ماركة' ||
      rawBrandText === 'local' ||
      rawBrandText === 'محلي' ||
      rawBrandText === 'طازج محلي' ||
      combinedTitles.includes('بالكيلو') ||
      combinedTitles.toLowerCase().includes('per kg') ||
      combinedTitles.toLowerCase().includes('loose') ||
      combinedTitles.toLowerCase().includes('bulk')

    if (isCommodity && isExplicitlyUnbrandedCommodity) {
      return {
        brandKey: 'unbranded_commodity',
        brandNameAr: 'بدون علامة تجارية',
        brandNameEn: 'Unbranded Commodity',
        status: 'unbranded'
      }
    }

    // 2. Check explicitly multi-brand / assortment indications
    // Preserve legitimate single brands containing '&' (e.g. M&M's, Qoot & Root, Head & Shoulders)
    const SINGLE_BRANDS_WITH_AMPERSAND = new Set([
      "m&m's",
      'm&ms',
      'm&m',
      'qoot & root',
      'qoot&root',
      'head & shoulders',
      'johnson & johnson',
      'arm & hammer'
    ])
    const isMultiBrandAmpersand =
      rawBrandText.includes('&') &&
      !SINGLE_BRANDS_WITH_AMPERSAND.has(rawBrandText) &&
      /\s+&\s+/.test(rawBrandText)

    // Distinguish true multi-brand slashes ("Al Arabi / Shams") from bilingual labels of ONE brand ("كادبري / Cadbury")
    let isMultiBrandSlash = false
    const bilingualParts: string[] = []
    if (rawBrandText.includes('/')) {
      const parts = rawBrandText
        .split('/')
        .map((p) => p.trim())
        .filter(Boolean)
      const hasArabic = (s: string) => /[\u0600-\u06FF]/.test(s)
      const hasLatin = (s: string) => /[a-z]/i.test(s)
      if (
        parts.length === 2 &&
        ((hasArabic(parts[0]) && !hasLatin(parts[0]) && hasLatin(parts[1]) && !hasArabic(parts[1])) ||
          (hasArabic(parts[1]) && !hasLatin(parts[1]) && hasLatin(parts[0]) && !hasArabic(parts[0])))
      ) {
        bilingualParts.push(...parts)
      } else if (rawBrandText.includes(' / ') || parts.length > 1) {
        isMultiBrandSlash = true
      }
    }

    if (
      isMultiBrandAmpersand ||
      isMultiBrandSlash ||
      rawBrandText.includes(' or ') ||
      rawBrandText.includes(' أو ')
    ) {
      return {
        brandKey: 'multi_brand_assortment',
        brandNameAr: params.brandAr || 'تشكيلة علامات تجارية',
        brandNameEn: params.brandEn || 'Multi-Brand Assortment',
        status: 'multi_brand'
      }
    }

    // Detect cross-field contradiction on bilingual splits & explicit EN/AR pairs (when brandRaw isn't a single override)
    const titleVerifiedBrands = detectVerifiedBrandsInText(params.titleEn, params.titleAr)
    if (!params.brandRaw) {
      const enMeta = resolveKnownBrandMeta(params.brandEn)
      const arMeta = resolveKnownBrandMeta(params.brandAr)
      if (enMeta && arMeta && enMeta.brandKey !== arMeta.brandKey) {
        return {
          brandKey: 'unknown_brand',
          brandNameAr: 'علامة غير محددة',
          brandNameEn: 'Unknown Brand',
          status: 'unknown'
        }
      }
    }

    // 3. Resolve through alias registry
    const candidatesToTry: string[] = []
    for (const bp of bilingualParts) candidatesToTry.push(bp.toLowerCase())
    if (params.brandRaw) candidatesToTry.push(params.brandRaw.trim().toLowerCase())
    if (params.brandEn) candidatesToTry.push(params.brandEn.trim().toLowerCase())
    if (params.brandAr) candidatesToTry.push(params.brandAr.trim().toLowerCase())

    for (const raw of candidatesToTry) {
      const aliasMatch = resolveKnownBrandMeta(raw)
      if (aliasMatch && BRAND_ALIAS_REGISTRY[raw]) {
        return {
          brandKey: aliasMatch.brandKey,
          brandNameAr: aliasMatch.nameAr,
          brandNameEn: aliasMatch.nameEn,
          status: 'known'
        }
      }
    }

    // 4. Try canonical token normalizer
    for (const raw of candidatesToTry) {
      const tokenBrandId = getCanonicalBrandId(raw)
      if (tokenBrandId) {
        const cleanKey = tokenBrandId.replace('brand:', '')
        return {
          brandKey: cleanKey,
          brandNameAr: params.brandAr || cleanKey,
          brandNameEn: params.brandEn || cleanKey,
          status: 'known'
        }
      }
    }

    // 5. If brand is provided but not in known dictionary, check validity
    const placeholderBrandKeys = new Set([
      'unknown',
      'unknown_brand',
      'unspecified',
      'unspecified_brand',
      'n_a',
      'none',
      'null'
    ])
    const mainBrand = (bilingualParts.find((p) => !/[\u0600-\u06FF]/.test(p)) || params.brandEn || params.brandAr || params.brandRaw || '').trim()
    if (isMeaningfulText(mainBrand)) {
      const normalizedBrandText = normalizeEnglishText(mainBrand) || normalizeArabicText(mainBrand) || mainBrand.toLowerCase()
      const cleanKey = normalizedBrandText.replace(/[^a-z0-9\u0600-\u06FF]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown_brand'
      if (cleanKey.length > 1 && !placeholderBrandKeys.has(cleanKey)) {
        return {
          brandKey: cleanKey,
          brandNameAr: params.brandAr || bilingualParts.find((p) => /[\u0600-\u06FF]/.test(p)) || null,
          brandNameEn: params.brandEn || mainBrand,
          status: 'known'
        }
      }
    }

    // 5.5 Conservative recovery when explicit brand was omitted (e.g. legacy Othaim records):
    // Recover ONLY when a single unambiguous verified brand alias appears in the title,
    // without loose/commodity flags, multi-brand/choice separators, or contradictory EN/AR brands.
    if (
      !isExplicitlyUnbrandedCommodity &&
      !hasChoiceOrMultiBrandSeparator(params.titleEn, params.titleAr) &&
      titleVerifiedBrands.size === 1
    ) {
      const recovered = Array.from(titleVerifiedBrands.values())[0]
      return {
        brandKey: recovered.brandKey,
        brandNameAr: recovered.nameAr,
        brandNameEn: recovered.nameEn,
        status: 'known'
      }
    }

    // 6. Genuinely missing or unreadable brand
    return {
      brandKey: 'unknown_brand',
      brandNameAr: 'علامة غير محددة',
      brandNameEn: 'Unknown Brand',
      status: 'unknown'
    }
  }

  /**
   * Extract normalized identity attributes from a UnifiedBatchOffer.
   */
  public extractNormalizedAttributes(offer: UnifiedBatchOffer): NormalizedIdentityAttributes {
    const brandInfo = this.normalizeBrand({
      brandRaw: offer.brand,
      brandAr: offer.brandAr,
      brandEn: offer.brandEn,
      titleAr: offer.titleAr,
      titleEn: offer.titleEn
    })

    // Extract fat content or variant if mentioned in title
    let fatContent: string | null = null
    const textLower = `${offer.titleEn} ${offer.titleAr}`.toLowerCase()
    if (textLower.includes('full cream') || textLower.includes('full fat') || textLower.includes('كامل الدسم')) {
      fatContent = 'Full Fat'
    } else if (textLower.includes('low fat') || textLower.includes('قليل الدسم')) {
      fatContent = 'Low Fat'
    } else if (textLower.includes('skimmed') || textLower.includes('zero fat') || textLower.includes('خالي الدسم')) {
      fatContent = 'Zero Fat'
    }

    const evidence =
      offer.matchingEvidence ||
      this.evidenceOverlay?.getAnnotationForSource([
        offer.sourceOfferId,
        (offer as any).canonicalSourceId,
        offer.batchOfferKey
      ]) ||
      null

    const pkgResolution = resolveQuantityAndPromoSemantics(offer, evidence)
    const canonicalAssortmentStatus =
      offer.assortment_status ||
      (offer.canonical as any)?.contract_v2?.assortment?.status ||
      evidence?.assortment_status ||
      null

    let resolvedUnit = offer.each_size_unit ? canonicalizeUnit(offer.each_size_unit) : null
    if (
      !resolvedUnit &&
      (!offer.each_size_unit || offer.each_size_unit === 'other') &&
      offer.each_size_value !== null &&
      offer.each_size_value !== undefined
    ) {
      const hintText = `${offer.sizeOrWeight || ''} ${offer.titleEn || ''} ${offer.titleAr || ''}`
      if (/\b(?:sheet|sheets)\b|منديل|مناديل/i.test(hintText)) {
        resolvedUnit = 'sheet'
      } else if (/\b(?:roll|rolls)\b|رول/i.test(hintText)) {
        resolvedUnit = 'roll'
      }
    }

    const baseAttrs: NormalizedIdentityAttributes = {
      brandKey: brandInfo.brandKey,
      brandNameAr: brandInfo.brandNameAr,
      brandNameEn: brandInfo.brandNameEn,
      brandStatus: brandInfo.status,
      productNameAr: offer.titleAr,
      productNameEn: offer.titleEn,
      variantOrFlavor:
        offer.variantOrFlavor ||
        (offer.canonical as any)?.product?.variant_or_flavor ||
        (offer.canonical as any)?.product?.variant ||
        (offer.canonical as any)?.variant ||
        (offer.canonical as any)?.flavor ||
        null,
      fatContent,
      eachSizeValue: offer.each_size_value,
      eachSizeUnit: resolvedUnit,
      innerPackCount: pkgResolution.manufacturerPackCount,
      saleUnitType: offer.sale_unit_type || 'piece',
      productForm: null,
      commodityType: brandInfo.status === 'unbranded' ? 'fresh_produce' : null,
      manufacturerPackCount: pkgResolution.manufacturerPackCount,
      promoPurchaseQuantity: pkgResolution.promoPurchaseQuantity,
      promotionMechanic: pkgResolution.promotionMechanic,
      packagingSemantics: pkgResolution.packagingSemantics,
      assortmentStatus: canonicalAssortmentStatus,
      evidenceAnnotation: evidence
    }

    const sufficiency = evaluateIdentitySufficiency(baseAttrs, offer, evidence)
    return {
      ...baseAttrs,
      isAssortment: sufficiency.isAssortment,
      isIdentitySufficient: sufficiency.isSufficient,
      insufficiencyReasons: sufficiency.reasons,
      insufficiencyCodes: sufficiency.codes
    }
  }

  /**
   * Group batch offers strictly by brand, deduplicating equivalent incoming offers.
   * NO CATEGORY PREREQUISITE.
   */
  public groupOffersByBrand(offers: UnifiedBatchOffer[]): BrandGroup[] {
    const brandMap: Map<string, {
      brandKey: string
      brandNameAr: string | null
      brandNameEn: string | null
      brandStatus: BrandMatchStatus
      identitiesMap: Map<string, DeduplicatedIdentityItem>
    }> = new Map()

    for (const offer of offers) {
      const attrs = this.extractNormalizedAttributes(offer)
      const bKey = attrs.brandKey

      if (!brandMap.has(bKey)) {
        brandMap.set(bKey, {
          brandKey: bKey,
          brandNameAr: attrs.brandNameAr,
          brandNameEn: attrs.brandNameEn,
          brandStatus: attrs.brandStatus,
          identitiesMap: new Map()
        })
      }

      const group = brandMap.get(bKey)!

      // Deduplication key: Normalized brand + normalized titles + canonical physical size + manufacturer pack + fat + variant
      // Retail promotional purchase quantities are intentionally excluded from manufacturer identity.
      // Insufficient/assortment records remain isolated per sourceOfferId to avoid unsafe merging.
      const toLatinDigits = (s: string | null) =>
        s ? s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) : ''
      const normAr = toLatinDigits(normalizeArabicText(attrs.productNameAr))
      const normEn = toLatinDigits(normalizeEnglishText(attrs.productNameEn))
      let canonVal = attrs.eachSizeValue
      let canonUnit = attrs.eachSizeUnit || 'x'
      if (canonVal !== null) {
        if (canonUnit === 'kg') {
          canonVal = canonVal * 1000
          canonUnit = 'g'
        } else if (canonUnit === 'l') {
          canonVal = canonVal * 1000
          canonUnit = 'ml'
        }
      }
      const sizeStr = canonVal !== null ? Number(canonVal).toFixed(2) : 'x'
      const unitStr = canonUnit
      const packStr = String(attrs.manufacturerPackCount ?? attrs.innerPackCount ?? 1)
      const fatStr = attrs.fatContent || 'x'
      const variantStr = normalizeSearchText(attrs.variantOrFlavor) || 'x'
      const insufficientSuffix = attrs.isIdentitySufficient === false ? `:ambiguous:${offer.sourceOfferId}` : ''

      const identityKey = `${bKey}:${normAr}:${normEn}:${sizeStr}:${unitStr}:${packStr}:${fatStr}:${variantStr}${insufficientSuffix}`

      if (!group.identitiesMap.has(identityKey)) {
        group.identitiesMap.set(identityKey, {
          identityKey,
          normalizedAttrs: attrs,
          memberOffers: []
        })
      }

      group.identitiesMap.get(identityKey)!.memberOffers.push(offer)
    }

    // Convert map to BrandGroup array
    const result: BrandGroup[] = []
    for (const entry of brandMap.values()) {
      result.push({
        brandKey: entry.brandKey,
        brandNameAr: entry.brandNameAr,
        brandNameEn: entry.brandNameEn,
        brandStatus: entry.brandStatus,
        uniqueIdentities: Array.from(entry.identitiesMap.values()),
        candidates: [] // Populated by candidate retrieval
      })
    }

    return result
  }

  public extractSearchTokens(
    nameEn?: string | null,
    nameAr?: string | null,
    excludeTerms?: Array<string | null | undefined>
  ): string[] {
    const tokens: string[] = []
    const stopWords = new Set([
      'the', 'and', 'with', 'for', 'from', 'in', 'of', 'pack', 'fresh', 'premium', 'original', 'natural',
      'من', 'في', 'مع', 'على', 'طازج', 'أصلي', 'طبيعي', 'عرض', 'خاص', 'حبة', 'حبات'
    ])
    if (excludeTerms) {
      for (const term of excludeTerms) {
        if (!term) continue
        for (const w of String(term).toLowerCase().split(/[\s,./\-_()]+/)) {
          if (w.length >= 2) stopWords.add(w)
        }
      }
    }

    if (nameEn) {
      const enWords = nameEn.toLowerCase().split(/[\s,./\-_()]+/)
      for (const w of enWords) {
        if (w.length >= 3 && !stopWords.has(w) && !/^\d+$/.test(w)) {
          tokens.push(w)
        }
      }
    }

    if (nameAr) {
      const arWords = nameAr.split(/[\s,./\-_()]+/)
      for (const w of arWords) {
        if (w.length >= 3 && !stopWords.has(w) && !/^\d+$/.test(w)) {
          tokens.push(w)
        }
      }
    }

    return Array.from(new Set(tokens))
  }

  private mapRowToCandidate(row: any, brandGroup: BrandGroup): CompactCatalogCandidate {
    return {
      id: String(row.id),
      brand: row.brand_name || brandGroup.brandNameEn || brandGroup.brandKey,
      nameAr: row.name_ar || '',
      nameEn: row.name_en || '',
      variant: row.variant_or_flavor || null,
      sizeValue: row.each_size_value !== null ? Number(row.each_size_value) : null,
      sizeUnit: row.each_size_unit ? canonicalizeUnit(row.each_size_unit) : null,
      packCount: row.inner_pack_count ? Number(row.inner_pack_count) : 1,
      imageUrl: row.default_image_url || null
    }
  }

  public rankCandidatesForIdentities(
    candidates: CompactCatalogCandidate[],
    identities: DeduplicatedIdentityItem[]
  ): CompactCatalogCandidate[] {
    const scored = candidates.map((cand) => {
      let maxScore = 0
      for (const item of identities) {
        let score = 0
        const attrs = item.normalizedAttrs

        // Exact size & pack compatibility (+25 points)
        if (attrs.eachSizeValue !== null && cand.sizeValue !== null) {
          const sizeCheck = areSizesStrictlyCompatible(
            attrs.eachSizeValue,
            attrs.eachSizeUnit,
            cand.sizeValue,
            cand.sizeUnit
          )
          if (sizeCheck.isCompatible) {
            score += 25
            if ((attrs.innerPackCount || 1) === (cand.packCount || 1)) {
              score += 15
            }
          }
        }

        // Variant or fat match (+10 points)
        if (attrs.fatContent && cand.variant) {
          if (attrs.fatContent.toLowerCase() === cand.variant.toLowerCase()) {
            score += 10
          }
        } else if (attrs.variantOrFlavor && cand.variant) {
          if (attrs.variantOrFlavor.toLowerCase() === cand.variant.toLowerCase()) {
            score += 10
          }
        }

        // Name token overlap (+5 points per token)
        const candNameLower = `${cand.nameEn} ${cand.nameAr}`.toLowerCase()
        const tokens = this.extractSearchTokens(attrs.productNameEn, attrs.productNameAr)
        for (const t of tokens) {
          if (candNameLower.includes(t)) {
            score += 5
          }
        }

        if (score > maxScore) maxScore = score
      }
      return { candidate: cand, score: maxScore }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored.map((s) => s.candidate)
  }

  private buildBrandFilterClause(brandGroup: BrandGroup): string {
    const rawTerms = [
      brandGroup.brandNameEn || brandGroup.brandKey,
      brandGroup.brandKey.toLowerCase(),
      brandGroup.brandKey.toLowerCase().replace(/_/g, ' '),
      brandGroup.brandNameAr || ''
    ]
    const sanitize = (s: string) => s.replace(/[(),.%*]/g, ' ').trim()
    const terms = Array.from(new Set(rawTerms.map(sanitize).filter((t) => t.length >= 2)))
    if (terms.length === 0) return `brand_name.ilike.%${sanitize(brandGroup.brandKey)}%`
    return terms.map((t) => `brand_name.ilike.%${t}%`).join(',')
  }

  private getEquivalentSizeValues(sizeValue: number, sizeUnit: string | null): number[] {
    const values = new Set<number>([sizeValue])
    const u = sizeUnit ? canonicalizeUnit(sizeUnit) : null
    if (u === 'kg' || u === 'l') {
      values.add(Number((sizeValue * 1000).toFixed(4)))
    } else if (u === 'g' || u === 'ml') {
      values.add(Number((sizeValue / 1000).toFixed(6)))
    }
    return Array.from(values)
  }

  /**
   * Enhanced candidate retrieval:
   * 1. Normalizes brand identity using verified aliases and bilingual names.
   * 2. Retrieves candidates according to the extracted item's product name and identity attributes.
   * 3. Uses structured size, unit, variant and packaging information to rank candidates without arbitrary cutoff.
   * 4. Supports large brand catalogs (400+ products) by querying targeted keywords and sizes within the brand.
   * 5. Provides fallback search across the broader catalog when brand queries return zero candidates.
   * 6. Does NOT require category classification.
   * 7. Records candidate coverage completeness and fallback actions.
   */
  public async retrieveBrandCandidates(
    supabase: SupabaseClient,
    brandGroup: BrandGroup,
    candidateLimit: number = 50
  ): Promise<{
    candidates: CompactCatalogCandidate[]
    totalBrandProducts: number
    retrievalCompleteness: 'complete' | 'shortlist_ranked' | 'fallback_used' | 'insufficient'
    fallbackActions: string[]
  }> {
    const fallbackActions: string[] = []
    const candidatesMap = new Map<string, CompactCatalogCandidate>()

    const isKnownBrand = brandGroup.brandStatus === 'known'

    try {
      let totalBrandProducts = 0

      if (isKnownBrand) {
        const brandOrFilter = this.buildBrandFilterClause(brandGroup)

        // 1. Get total count of products for this brand
        const { count } = await supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .or(brandOrFilter)

        totalBrandProducts = count || 0

        // 2A. If catalog for brand is small (<= candidateLimit), retrieve all products for the brand
        if (totalBrandProducts <= candidateLimit && totalBrandProducts > 0) {
          const { data } = await supabase
            .from('products')
            .select(`
              id,
              name_ar,
              name_en,
              brand_name,
              variant_or_flavor,
              each_size_value,
              each_size_unit,
              inner_pack_count,
              default_image_url
            `)
            .or(brandOrFilter)
            .limit(candidateLimit)

          if (data) {
            for (const row of data) {
              candidatesMap.set(String(row.id), this.mapRowToCandidate(row, brandGroup))
            }
          }

          const smallBrandCandidates = this.rankCandidatesForIdentities(
            Array.from(candidatesMap.values()),
            brandGroup.uniqueIdentities
          )
          await this.enrichCandidatesWithProductImages(supabase, smallBrandCandidates)

          return {
            candidates: smallBrandCandidates,
            totalBrandProducts,
            retrievalCompleteness: 'complete',
            fallbackActions
          }
        }

        // 2B. If catalog for brand is large (> candidateLimit, e.g. 400+ products):
        // Query candidates targeted by the extracted items' keywords, sizes, and variants within this brand!
        if (totalBrandProducts > candidateLimit) {
          fallbackActions.push(`Large brand catalog detected (${totalBrandProducts} products). Executing targeted token retrieval.`)

          for (const item of brandGroup.uniqueIdentities) {
            const attrs = item.normalizedAttrs
            const tokens = this.extractSearchTokens(attrs.productNameEn, attrs.productNameAr)

            // Search by prominent title tokens within the brand
            for (const token of tokens.slice(0, 4)) {
              if (token.length < 3) continue
              const { data: tokenData } = await supabase
                .from('products')
                .select(`
                  id,
                  name_ar,
                  name_en,
                  brand_name,
                  variant_or_flavor,
                  each_size_value,
                  each_size_unit,
                  inner_pack_count,
                  default_image_url
                `)
                .or(brandOrFilter)
                .or(`name_en.ilike.%${token}%,name_ar.ilike.%${token}%`)
                .limit(25)

              if (tokenData) {
                for (const row of tokenData) {
                  candidatesMap.set(String(row.id), this.mapRowToCandidate(row, brandGroup))
                }
              }
            }

            // Also search by equivalent size values within the brand (supports kg<->g and l<->ml)
            if (attrs.eachSizeValue !== null && attrs.eachSizeUnit) {
              const equivSizes = this.getEquivalentSizeValues(attrs.eachSizeValue, attrs.eachSizeUnit)
              const { data: sizeData } = await supabase
                .from('products')
                .select(`
                  id,
                  name_ar,
                  name_en,
                  brand_name,
                  variant_or_flavor,
                  each_size_value,
                  each_size_unit,
                  inner_pack_count,
                  default_image_url
                `)
                .or(brandOrFilter)
                .in('each_size_value', equivSizes)
                .limit(20)

              if (sizeData) {
                for (const row of sizeData) {
                  candidatesMap.set(String(row.id), this.mapRowToCandidate(row, brandGroup))
                }
              }
            }
          }
        }
      }

      // 3. Fallback search:
      // Trigger cross-catalog search ONLY for unknown/unbranded items.
      // Known brands must NEVER cross-pollinate into other brands' candidates!
      if (candidatesMap.size === 0 && !isKnownBrand) {
        fallbackActions.push('Unbranded/unknown brand. Triggering cross-catalog fallback search.')

        for (const item of brandGroup.uniqueIdentities.slice(0, 5)) {
          const tokens = this.extractSearchTokens(item.normalizedAttrs.productNameEn, item.normalizedAttrs.productNameAr)
          for (const token of tokens.slice(0, 3)) {
            if (token.length < 3) continue
            const { data: fallbackData } = await supabase
              .from('products')
              .select(`
                id,
                name_ar,
                name_en,
                brand_name,
                variant_or_flavor,
                each_size_value,
                each_size_unit,
                inner_pack_count,
                default_image_url
              `)
              .or(`name_en.ilike.%${token}%,name_ar.ilike.%${token}%`)
              .limit(15)

            if (fallbackData) {
              for (const row of fallbackData) {
                candidatesMap.set(String(row.id), this.mapRowToCandidate(row, brandGroup))
              }
            }
          }
        }
      }

      // 4. Rank candidates by relevance to the unique identities in this group
      const rankedCandidates = this.rankCandidatesForIdentities(
        Array.from(candidatesMap.values()),
        brandGroup.uniqueIdentities
      ).slice(0, candidateLimit)

      // 5. Enrich ranked candidates with approved primary public.product_images URLs when default_image_url is unset
      await this.enrichCandidatesWithProductImages(supabase, rankedCandidates)

      const isShortlist = totalBrandProducts > candidateLimit
      const retrievalCompleteness =
        rankedCandidates.length > 0
          ? isShortlist
            ? 'shortlist_ranked'
            : fallbackActions.some((f) => f.includes('fallback search'))
            ? 'fallback_used'
            : 'complete'
          : 'insufficient'

      return {
        candidates: rankedCandidates,
        totalBrandProducts,
        retrievalCompleteness,
        fallbackActions
      }
    } catch (err) {
      console.warn(`[BrandGroupingService] Candidate retrieval failed for brand ${brandGroup.brandKey}:`, err)
      return {
        candidates: [],
        totalBrandProducts: 0,
        retrievalCompleteness: 'insufficient',
        fallbackActions: [`Lookup error: ${err}`]
      }
    }
  }

  private async enrichCandidatesWithProductImages(
    supabase: SupabaseClient,
    candidates: CompactCatalogCandidate[]
  ): Promise<void> {
    if (candidates.length === 0) return
    try {
      const candidateIds = candidates
        .map((c) => Number(c.id))
        .filter((n) => Number.isFinite(n) && n > 0)
      if (candidateIds.length === 0) return
      const { data: piRows } = await supabase
        .from('product_images')
        .select('product_id, public_url, role, approval_status')
        .in('product_id', candidateIds)
        .eq('approval_status', 'approved')
      if (!Array.isArray(piRows) || piRows.length === 0) return
      const primaryByPid = new Map<string, string>()
      for (const row of piRows as any[]) {
        const pid = String(row.product_id || '')
        const url = typeof row.public_url === 'string' ? row.public_url.trim() : ''
        if (!pid || !url) continue
        if (row.role === 'primary' || !primaryByPid.has(pid)) {
          primaryByPid.set(pid, url)
        }
      }
      for (const cand of candidates) {
        const piUrl = primaryByPid.get(String(cand.id))
        if (piUrl && !cand.imageUrl) {
          cand.imageUrl = piUrl
        }
      }
    } catch {
      // Non-fatal: product_images may be absent in older test mocks
    }
  }

  /**
   * Completeness-Aware Verification Policy:
   * Verifies whether an item proposing to be a new temporary product is exhaustively absent
   * from the entire brand catalog or broader database, preventing false new-product creation.
   */
  public async verifyAbsenceInBrandCatalog(
    supabase: SupabaseClient,
    brandGroup: BrandGroup,
    item: DeduplicatedIdentityItem
  ): Promise<AbsenceVerificationResult> {
    const searchDiagnostics: string[] = []
    const attrs = item.normalizedAttrs

    // 1. If brand catalog was small and completely retrieved into candidates:
    if (brandGroup.candidates.length >= (brandGroup as any).totalBrandProducts && (brandGroup as any).totalBrandProducts > 0) {
      return {
        isExhaustivelyAbsent: true,
        foundCandidate: null,
        coverage: 'complete',
        searchDiagnostics: ['Entire brand catalog was evaluated; item is exhaustively absent.']
      }
    }

    // 2. If brand identification is uncertain (unknown brand):
    // We cannot definitively rule out existing catalog products under unrecognized brands.
    if (attrs.brandStatus === 'unknown') {
      const tokens = this.extractSearchTokens(attrs.productNameEn, attrs.productNameAr)
      if (tokens.length > 0 && attrs.eachSizeValue !== null && attrs.eachSizeUnit) {
        const { data: crossData } = await supabase
          .from('products')
          .select(`
            id, name_ar, name_en, brand_name, variant_or_flavor,
            each_size_value, each_size_unit, inner_pack_count, default_image_url
          `)
          .eq('each_size_value', attrs.eachSizeValue)
          .or(`name_en.ilike.%${tokens[0]}%,name_ar.ilike.%${tokens[0]}%`)
          .limit(20)

        if (crossData && crossData.length > 0) {
          for (const row of crossData) {
            const cand = this.mapRowToCandidate(row, brandGroup)
            const packCompat = arePackConfigsStrictlyCompatible({
              sizeValue1: attrs.eachSizeValue,
              sizeUnit1: attrs.eachSizeUnit,
              packCount1: attrs.innerPackCount,
              sizeValue2: cand.sizeValue,
              sizeUnit2: cand.sizeUnit,
              packCount2: cand.packCount
            })
            if (packCompat.isCompatible) {
              return {
                isExhaustivelyAbsent: false,
                foundCandidate: cand,
                coverage: 'complete',
                searchDiagnostics: [`Discovered matching candidate ${cand.id} via cross-catalog search`]
              }
            }
          }
        }
      }
      return {
        isExhaustivelyAbsent: false,
        foundCandidate: null,
        coverage: 'inconclusive',
        searchDiagnostics: ['Brand is unknown; candidate evaluation cannot exhaustively rule out existing catalog products']
      }
    }

    // 3. For known brands where totalBrandProducts > candidateLimit (partial shortlist):
    // Execute targeted secondary search within this brand for this specific item's tokens and unit-equivalent sizes
    try {
      const brandOrFilter = this.buildBrandFilterClause(brandGroup)
      const brandExclude = [brandGroup.brandNameEn, brandGroup.brandNameAr, brandGroup.brandKey.replace(/_/g, ' ')]
      const tokens = this.extractSearchTokens(attrs.productNameEn, attrs.productNameAr, brandExclude)
      const equivSizes =
        attrs.eachSizeValue !== null
          ? this.getEquivalentSizeValues(attrs.eachSizeValue, attrs.eachSizeUnit)
          : []

      // Query 3A: Search within brand by non-brand product tokens + unit-equivalent size
      for (const token of tokens.slice(0, 3)) {
        if (token.length < 3) continue
        let query = supabase
          .from('products')
          .select(`
            id, name_ar, name_en, brand_name, variant_or_flavor,
            each_size_value, each_size_unit, inner_pack_count, default_image_url
          `)
          .or(brandOrFilter)
          .or(`name_en.ilike.%${token}%,name_ar.ilike.%${token}%`)

        if (equivSizes.length > 0) {
          query = query.in('each_size_value', equivSizes)
        }

        const { data: matchedRows } = await query.limit(25)
        if (matchedRows && matchedRows.length > 0) {
          for (const row of matchedRows) {
            const cand = this.mapRowToCandidate(row, brandGroup)
            const packCompat = arePackConfigsStrictlyCompatible({
              sizeValue1: attrs.eachSizeValue,
              sizeUnit1: attrs.eachSizeUnit,
              packCount1: attrs.innerPackCount,
              sizeValue2: cand.sizeValue,
              sizeUnit2: cand.sizeUnit,
              packCount2: cand.packCount
            })
            if (!packCompat.isCompatible) continue

            const candTokens = this.extractSearchTokens(cand.nameEn, cand.nameAr, brandExclude)
            if (tokens.length > 0 && !tokens.some((t) => candTokens.includes(t))) continue

            // Fat content compatibility
            if (attrs.fatContent) {
              const candFat = cand.variant || cand.nameEn || cand.nameAr || ''
              if (
                attrs.fatContent.toLowerCase().includes('full') &&
                candFat.toLowerCase().includes('low')
              ) continue
              if (
                attrs.fatContent.toLowerCase().includes('low') &&
                candFat.toLowerCase().includes('full')
              ) continue
            }

            // Variant / flavor check if present
            if (attrs.variantOrFlavor && cand.variant) {
              const vOffer = attrs.variantOrFlavor.toLowerCase()
              const vCand = cand.variant.toLowerCase()
              if (!vOffer.includes(vCand) && !vCand.includes(vOffer)) continue
            }

            return {
              isExhaustivelyAbsent: false,
              foundCandidate: cand,
              coverage: 'complete',
              searchDiagnostics: [`Targeted secondary search discovered compatible product ${cand.id}`]
            }
          }
        }
      }

      // Query 3B: If no candidate matched, check how many products in this brand share this unit-equivalent size
      if (attrs.eachSizeValue !== null && attrs.eachSizeUnit) {
        const { count: sizeCount } = await supabase
          .from('products')
          .select('id', { count: 'exact', head: true })
          .or(brandOrFilter)
          .in('each_size_value', equivSizes)

        if ((sizeCount || 0) === 0) {
          // No product of this size exists in this brand! Absence is proven.
          return {
            isExhaustivelyAbsent: true,
            foundCandidate: null,
            coverage: 'complete',
            searchDiagnostics: [`Brand has 0 products with size ${attrs.eachSizeValue} ${attrs.eachSizeUnit} (checked equivalents: ${equivSizes.join(', ')})`]
          }
        }

        // If size count is small (<= 25), fetch all of them and verify none match
        if ((sizeCount || 0) <= 25) {
          const { data: allSizeRows } = await supabase
            .from('products')
            .select(`
              id, name_ar, name_en, brand_name, variant_or_flavor,
              each_size_value, each_size_unit, inner_pack_count, default_image_url
            `)
            .or(brandOrFilter)
            .in('each_size_value', equivSizes)

          if (allSizeRows) {
            for (const row of allSizeRows) {
              const cand = this.mapRowToCandidate(row, brandGroup)
              const packCompat = arePackConfigsStrictlyCompatible({
                sizeValue1: attrs.eachSizeValue,
                sizeUnit1: attrs.eachSizeUnit,
                packCount1: attrs.innerPackCount,
                sizeValue2: cand.sizeValue,
                sizeUnit2: cand.sizeUnit,
                packCount2: cand.packCount
              })
              if (packCompat.isCompatible) {
                const candTokens = this.extractSearchTokens(cand.nameEn, cand.nameAr, brandExclude)
                const hasOverlap = tokens.some(t => candTokens.includes(t))
                if (hasOverlap) {
                  return {
                    isExhaustivelyAbsent: false,
                    foundCandidate: cand,
                    coverage: 'complete',
                    searchDiagnostics: [`Matched product ${cand.id} among all brand products of this size`]
                  }
                }
              }
            }
          }
          return {
            isExhaustivelyAbsent: true,
            foundCandidate: null,
            coverage: 'complete',
            searchDiagnostics: [`All ${sizeCount} brand products of size ${attrs.eachSizeValue} ${attrs.eachSizeUnit} inspected; none match.`]
          }
        }
      }

      // If we reach here, there are many products of this size and candidate coverage is partial
      return {
        isExhaustivelyAbsent: false,
        foundCandidate: null,
        coverage: 'partial',
        searchDiagnostics: ['Brand catalog contains uninspected candidates outside shortlist; absence cannot be confirmed']
      }
    } catch (err: any) {
      searchDiagnostics.push(`Secondary search error: ${err.message}`)
      return {
        isExhaustivelyAbsent: false,
        foundCandidate: null,
        coverage: 'inconclusive',
        searchDiagnostics
      }
    }
  }
}
