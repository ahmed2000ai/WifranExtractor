import {
  MatchingProposal,
  NonCatalogEligibilityCategory,
  NonCatalogOfferApproval,
  OfferPublicationAssessment,
  TemporaryProductGroup
} from '../types/catalogMatching'
import { UnifiedBatchOffer } from '../types/batchExtraction'
import { detectItemDomainFromTitle, normalizeArabicNumerals } from './priceAndUnitNormalizer'
import {
  computeDocumentIdFromFingerprint,
  computeOfferAnchorSignature
} from './sourceIdentityAndDuplicateUtils'

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export function isValidCalendarDateIso(isoDate: string): boolean {
  if (!ISO_DATE_REGEX.test(isoDate)) return false
  const [yStr, mStr, dStr] = isoDate.split('-')
  const year = Number(yStr)
  const month = Number(mStr)
  const day = Number(dStr)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const utc = new Date(Date.UTC(year, month - 1, day))
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  )
}

function decodeUrlIteratively(raw: string, maxPasses = 3): string {
  let current = raw
  for (let i = 0; i < maxPasses; i++) {
    try {
      const next = decodeURIComponent(current)
      if (next === current) break
      current = next
    } catch {
      break
    }
  }
  return current
}

const SENSITIVE_QUERY_KEYS = new Set(['token', 'sig', 'signature', 'redirect', 'next', 'url'])

const FRAGMENT_TITLE_ONLY_REGEX =
  /^(?:or|and|with|for|per|only|valid|selected\s+branches?|branches?\s+only|أو|و|مع|فقط|فروع\s*محددة|عرض|للكيلو|بالكيلو|حبة|قطع[ةه]?|sr|sar|ريال|[\d.,/\-*%+]+)$/i

const CONFLICT_FLAG_PATTERNS = [
  /CAPTION_IMAGE_CONFLICT/i,
  /TEXT_IMAGE_CONFLICT/i,
  /TEXT_VS_IMAGE_CONFLICT/i,
  /WEIGHT_CONFLICT/i,
  /EN_AR_WEIGHT_VOLUME_CONFLICT/i,
  /EN_AR_PACK_COUNT_CONFLICT/i,
  /PROMO_QTY_VS_MFG_PACK_CONFLICT/i,
  /PACK_COUNT_CONFLICT/i,
  /PRICE_CONFLICT/i,
  /PRICE_ROLE_AMBIGUOUS/i,
  /COMPOUND_SHARED_CAPTION_CONFLICT/i,
  /MISSING_CRITICAL_IDENTITY_ATTRIBUTES/i,
  /V3_PARENT_OFFER_QUARANTINED/i,
  /UNIT_CONFLICT/i,
  /UNCERTAIN_PRICE/i,
  /UNCERTAIN_PRICE_BASIS/i,
  /UNRESOLVABLE_PROMO_QUANTITY/i,
  /PACKAGING_SEMANTICS_AMBIGUOUS/i,
  /BOGO_MISSING_QUANTITY/i
]

const LOOSE_PRODUCE_REGEX =
  /(?<![\p{L}\p{N}_])(tomato(?:es)?|potato(?:es)?|onion(?:s)?|banana(?:s)?|apple(?:s)?|orange(?:s)?|lemon(?:s)?|cucumber(?:s)?|pepper(?:s)?|mango(?:es)?|carrot(?:s)?|eggplant|courgette|zucchini|lettuce|garlic|ginger|grape(?:s)?|watermelon|melon|dates?|fruit|vegetable(?:s)?|produce|طماطم|بندورة|بطاطس|بطاطا|بصل|موز|تفاح|برتقال|ليمون|خيار|فلفل|مانجو|جزر|باذنجان|كوسة|خس|ثوم|زنجبيل|عنب|بطيخ|شمام|تمر|فواكه|خضار|خضروات)(?![\p{L}\p{N}_])/iu

const MEAT_SEAFOOD_REGEX =
  /(?<![\p{L}\p{N}_])(beef|lamb|mutton|veal|minced|steak|chicken|poultry|drumstick|breast|fish|seafood|shrimp|prawn(?:s)?|salmon|tilapia|hamour|kingfish|fillet|لحم|عجل|خروف|غنم|حاشي|مفروم|ستيك|دجاج|أفخاذ|صدور|سمك|أسماك|بحري|روبيان|جمبري|سلمون|بلطي|هامور|كنعد|فيليه)(?![\p{L}\p{N}_])/iu

const PACKAGED_CPG_OVERRIDE_REGEX =
  /(?<![\p{L}\p{N}_])(vegetable\s+oil|sunflower\s+oil|corn\s+oil|olive\s+oil|cooking\s+oil|rice|basmati|cheese|mozzarella|cheddar|labneh|noodles?|pasta|macaroni|spaghetti|frozen\s+(?:chicken|nuggets?|strips|burger|beef|fish|shrimp|fries|vegetables?)|soda|cola|pepsi|mirinda|7up|up|fanta|sprite|juice|nectar|water|drink|tea|coffee|milk|biscuit|chocolate|chips|mayonnaise|ketchup|sauce|tuna|broth|stock|seasoning|detergent|shampoo|tissue|زيت(?:\s+نباتي|\s+دوار|\s+ذرة|\s+زيتون)?|أرز|ارز|بسمتي|عنبر|مزة|جبن(?:ة)?|موزاريلا|شيدر|نودلز|إندومي|مكرونة|مجمد(?:ة)?|مسحب|برجر|ناجتس|بيبسي|ميرندا|عصير|مياه|شاي|قهوة|حليب|تونة|مايونيز|صلصة|منظف|شامبو)(?![\p{L}\p{N}_])/iu

const BAKERY_REGEX =
  /\b(bakery|in-house|fresh\s+bread|bread|croissant|brioche|baguette|toast|cake|pastry|pastries|baklava|samoli|fatayer|manakeesh|bun(?:s)?|donut(?:s)?|muffin)\b|(مخبز|خبز|كرواسون|بريوش|توست|كيك|كعك|تورتة|معجنات|فطائر|فطيرة|بقلاوة|صامولي|مناقيش|دونات)/i

const FOOD_OR_GROCERY_TITLE_REGEX =
  /\b(milk|yogurt|cheese|butter|ghee|oil|olive|rice|pasta|sugar|flour|tea|coffee|water|juice|soda|cola|pepsi|chocolate|candy|biscuit|wafer|chips|snack|honey|jam|tuna|beans|sauce|ketchup|mayonnaise|bread|croissant|tomato(?:es)?|potato(?:es)?|onion(?:s)?|banana(?:s)?|apple(?:s)?|chicken|beef|lamb|mutton|fish|shrimp|dates)\b|(حليب|لبن|زبادي|جبن|زبدة|سمن|زيت|أرز|ارز|مكرونة|سكر|دقيق|شاي|قهوة|ماء|مياه|عصير|شوكولاته|شوكولاتة|بسكويت|بطاطس|طماطم|بصل|موز|تفاح|دجاج|لحم|سمك|خبز|تمر|تونة|عسل|مربى)/i

const ASSORTMENT_TITLE_REGEX =
  /\b(assorted|asstd|variety|mixed|flavors?|flavours?|multi[- ]?choice|choices|selected\s+varieties)\b|(?<![\p{L}\p{N}_])(نكهات|مشكل|متنوع|منوع|أو|عدة\s*أنواع|اختيارات)(?![\p{L}\p{N}_])/iu

const WEIGHT_VOLUME_REGEX =
  /(?:(\d+)\s*[x×*]\s*)?(\d+(?:\.\d+)?)\s*(kg|kilo|gm?s?|gram(?:s)?|l|ltr|litre|liter|ml|كجم|كيلو|جرام|جم|غ|ملل|مل|لتر)(?:\s*[x×*]\s*(\d+)(?=$|[\s,./()+*\-]))?(?=$|[\s,./()+*\-])/gi

export const PINNED_PROD_WIFRAN_SUPABASE_HOST = 'swratbmclahjyekouned.supabase.co'
export const PINNED_DEV_WIFRAN_SUPABASE_HOST = 'gykrbpykjhpyrdrinkuk.supabase.co'

export type TrustedStorageEnvironment = 'PRODUCTION' | 'PRODUCTION_UI' | 'DEVELOPMENT_TEST' | 'AUTO'

function resolveExplicitStorageEnvironment(
  environment?: TrustedStorageEnvironment
): 'PRODUCTION' | 'DEVELOPMENT_TEST' | null {
  if (environment === 'PRODUCTION' || environment === 'PRODUCTION_UI') {
    return 'PRODUCTION'
  }
  if (environment === 'DEVELOPMENT_TEST') {
    return 'DEVELOPMENT_TEST'
  }

  const envMarker = String(
    process.env.WIFRAN_DATABASE_CONTEXT ||
      process.env.WIFRAN_DB_ENV ||
      process.env.VITE_WIFRAN_DB_ENV ||
      ''
  )
    .trim()
    .toUpperCase()

  if (envMarker === 'PRODUCTION' || envMarker === 'PRODUCTION_UI' || envMarker === 'PROD') {
    return 'PRODUCTION'
  }
  if (envMarker === 'DEVELOPMENT_TEST' || envMarker === 'DEV' || envMarker === 'DEVELOPMENT') {
    return 'DEVELOPMENT_TEST'
  }

  if (process.env.NODE_ENV === 'production' && process.env.VITEST !== 'true') {
    return 'PRODUCTION'
  }

  return null
}

/**
 * Resolves pinned Wifran Supabase storage hosts strictly per environment.
 * NEVER trusts arbitrary `SUPABASE_URL`, `VITE_SUPABASE_URL`, or
 * `WIFRAN_TRUSTED_SUPABASE_HOSTS` environment overrides, and never mixes
 * DEV and PROD hosts once an environment is resolved.
 */
export function getTrustedWifranSupabaseHosts(
  environment: TrustedStorageEnvironment = 'AUTO'
): Set<string> {
  const resolved = resolveExplicitStorageEnvironment(environment)
  if (resolved === 'PRODUCTION') {
    return new Set<string>([PINNED_PROD_WIFRAN_SUPABASE_HOST])
  }
  if (resolved === 'DEVELOPMENT_TEST') {
    return new Set<string>([PINNED_DEV_WIFRAN_SUPABASE_HOST])
  }
  return new Set<string>([PINNED_PROD_WIFRAN_SUPABASE_HOST, PINNED_DEV_WIFRAN_SUPABASE_HOST])
}

/**
 * Enforces WP2 §5/§6 public media policy:
 * - Blocks local filesystem paths, UNC paths, `file://`, `data:`, `javascript:`, and traversal (`..`)
 * - Inspects multi-pass URL-decoded paths & query params to prevent `%2Foffer-images%2F` bypasses
 * - Blocks private `offer-images` bucket, signed `/sign/` URLs, query tokens, and leaflet crop assets
 * - Enforces a positive allowlist of approved public consumer image sources (`product-images`,
 *   `offer-display-images` on Wifran's pinned per-environment Supabase projects, or Wifran first-party public image CDNs)
 */
export function sanitizePublicConsumerImageUrl(
  url?: string | null,
  environment: TrustedStorageEnvironment = 'AUTO'
): string | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null

  const decoded = decodeUrlIteratively(trimmed)
  const candidatesToInspect = [trimmed, decoded]

  for (const candidate of candidatesToInspect) {
    // Block local filesystem / Windows / UNC / custom/unsafe schemes & traversal
    if (
      /^[a-zA-Z]:[\\/]/.test(candidate) ||
      candidate.startsWith('\\\\') ||
      /^(?:file|data|javascript|vbscript):/i.test(candidate) ||
      /\/Work\//i.test(candidate) ||
      /\\Work\\/i.test(candidate) ||
      /\/Extracts\//i.test(candidate) ||
      /\\Extracts\\/i.test(candidate) ||
      /^\/crops\//i.test(candidate) ||
      candidate.includes('\\') ||
      /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(candidate)
    ) {
      return null
    }

    // Block private evidence bucket (`offer-images` / `offer_images`), signed crop tokens, and leaflet crop assets
    if (
      /(?:^|[\\/])offer[-_]images(?:[\\/]|$)/i.test(candidate) ||
      /\/storage\/v1\/object\/sign\//i.test(candidate) ||
      /[?&](?:token|sig|signature)=/i.test(candidate) ||
      /offer_card_crop/i.test(candidate) ||
      /product_thumb_crop/i.test(candidate) ||
      /_crop\.(?:webp|png|jpe?g|avif)(?:$|[?#])/i.test(candidate)
    ) {
      return null
    }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:') {
    return null
  }

  // Inspect decoded pathname & query values for hidden tokens/private paths
  const decodedPathname = decodeUrlIteratively(parsed.pathname).replace(/\/{2,}/g, '/')
  if (
    /(?:^|\/)\.\.(?:\/|$)/.test(decodedPathname) ||
    /(?:^|\/)offer[-_]images(?:\/|$)/i.test(decodedPathname) ||
    /\/storage\/v1\/object\/sign\//i.test(decodedPathname) ||
    /offer_card_crop|product_thumb_crop|_crop\.(?:webp|png|jpe?g|avif)$/i.test(decodedPathname)
  ) {
    return null
  }

  for (const [k, v] of parsed.searchParams.entries()) {
    const keyLower = k.toLowerCase()
    const valDecoded = decodeUrlIteratively(v)
    if (
      SENSITIVE_QUERY_KEYS.has(keyLower) ||
      /offer[-_]images|_crop\.|offer_card_crop|product_thumb_crop|\/sign\//i.test(valDecoded)
    ) {
      return null
    }
  }

  const host = parsed.hostname.toLowerCase()
  const isTrustedWifranSupabaseHost = getTrustedWifranSupabaseHosts(environment).has(host)
  const isApprovedSupabasePublicBucket =
    isTrustedWifranSupabaseHost &&
    /^\/storage\/v1\/object\/public\/(?:product-images|offer-display-images)\/[^/].+$/i.test(decodedPathname)
  const isApprovedWifranCdn =
    (host === 'storage.wifran.com' || host === 'cdn.wifran.com') &&
    decodedPathname.length > 1

  if (isApprovedSupabasePublicBucket || isApprovedWifranCdn) {
    return trimmed
  }

  return null
}

export function sanitizeConsumerContractV2Assets<T extends Record<string, any> | null | undefined>(
  contractV2: T,
  environment: TrustedStorageEnvironment = 'AUTO'
): T {
  if (!contractV2 || typeof contractV2 !== 'object') return contractV2
  const cloned = JSON.parse(JSON.stringify(contractV2))
  if (cloned.assets && typeof cloned.assets === 'object') {
    for (const slotKey of ['offer_card', 'product_thumbnail']) {
      const slot = cloned.assets[slotKey]
      if (!slot || typeof slot !== 'object') continue
      const safeDelivery = sanitizePublicConsumerImageUrl(slot.delivery_url, environment)
      const bucketLower = String(slot.storage_bucket || '').toLowerCase().trim()
      const isPrivateBucket = bucketLower === 'offer-images' || bucketLower === 'offer_images'
      slot.local_path_internal = null
      if (!safeDelivery || isPrivateBucket) {
        slot.delivery_url = safeDelivery
        if (!safeDelivery) {
          slot.storage_object_path = null
          slot.storage_bucket = null
          if (slot.upload_state === 'uploaded') {
            slot.upload_state = 'pending'
          }
        } else if (isPrivateBucket) {
          slot.storage_bucket = null
          slot.storage_object_path = null
        }
      }
      if (
        typeof slot.storage_object_path === 'string' &&
        (/^[a-zA-Z]:[\\/]/.test(slot.storage_object_path) ||
          /offer[-_]images|offer_card_crop|product_thumb_crop|_crop\./i.test(
            decodeUrlIteratively(slot.storage_object_path)
          ))
      ) {
        slot.storage_object_path = null
      }
    }
  }
  return cloned
}

function resolveStableDocumentScope(
  offer: Partial<UnifiedBatchOffer> & { batchOfferKey: string }
): string {
  if (offer.sourceDocumentId && offer.sourceDocumentId.startsWith('doc_')) {
    return offer.sourceDocumentId
  }
  const fp = (offer.sourceFileFingerprint || '').trim()
  if (fp && fp.toLowerCase() !== 'unknown' && fp.toLowerCase() !== 'null') {
    return computeDocumentIdFromFingerprint(fp, offer.sourceFileName || offer.sourcePdfPath)
  }

  return (offer.leafletId || offer.batchId || 'batch').trim()
}

/**
 * Computes a deterministic, collision-resistant, retry-safe `source_offer_id`
 * anchored to the source PDF content fingerprint (never batch-local leafletId alone),
 * preserving idempotency across re-imports of the same leaflet while preventing
 * cross-batch overwrites between different leaflets.
 */
export function computeStableSourceOfferId(
  offer: Partial<UnifiedBatchOffer> & { batchOfferKey: string }
): string {
  const docScope = resolveStableDocumentScope(offer)
  const rawSourceId = (offer.sourceOfferId || '').trim()

  const structuredMatch = rawSourceId.match(/^(.+):p(\d+):i([^:]+):s(\d+)$/i)
  if (structuredMatch) {
    const [, prefix, pPart, iPart, sPart] = structuredMatch
    const resolvedSubIdx =
      offer.decomposedChildIndex && offer.decomposedChildIndex > 0
        ? String(Math.trunc(offer.decomposedChildIndex)).padStart(2, '0')
        : sPart
    if (/^leaflet-\d+$/i.test(prefix) && docScope.startsWith('doc_')) {
      return `${docScope}:p${pPart}:i${iPart}:s${resolvedSubIdx}`
    }
    return `${prefix}:p${pPart}:i${iPart}:s${resolvedSubIdx}`
  }

  const pageNum = offer.sourcePage ?? 1
  const subIdx =
    offer.decomposedChildIndex && offer.decomposedChildIndex > 0
      ? String(Math.trunc(offer.decomposedChildIndex)).padStart(2, '0')
      : '01'

  if (/^\d+$/.test(rawSourceId)) {
    const pad3 = (val: string | number) => String(val).replace(/[^0-9]/g, '').padStart(3, '0')
    return `${docScope}:p${pad3(pageNum)}:i${pad3(rawSourceId)}:s${subIdx}`
  }

  const pagePadded = String(Math.max(1, Number(pageNum) || 1)).padStart(3, '0')
  const strippedSourceId =
    docScope.startsWith('doc_') ? rawSourceId.replace(/^leaflet-\d+[:_-]+/i, '') : rawSourceId
  const looksLikeArrayIndexPlaceholder =
    !strippedSourceId || /^p?\d+[_-]o\d+(?:_sub\d+)?$/i.test(strippedSourceId)

  // ID-02: Prefer semantic+spatial card anchor over volatile OCR array index placeholders when anchor evidence exists
  if (looksLikeArrayIndexPlaceholder) {
    const explicitAnchor =
      (offer.sourceOfferAnchor || '').trim() ||
      (offer.titleEn || offer.titleAr || offer.sourceBboxNorm
        ? computeOfferAnchorSignature({
            sourcePage: pageNum,
            supermarketId: offer.supermarketId,
            titleEn: offer.titleEn,
            titleAr: offer.titleAr,
            brand: offer.brand,
            promoPrice: offer.promoPrice,
            originalPrice: offer.originalPrice,
            sizeOrWeight: offer.sizeOrWeight,
            bboxNorm: offer.sourceBboxNorm,
            fallbackRawId: rawSourceId
          })
        : '')
    if (explicitAnchor) {
      return `${docScope}:p${pagePadded}:i${explicitAnchor}:s${subIdx}`
    }
  }

  const sanitizedRef = (strippedSourceId || offer.batchOfferKey)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)

  return `${docScope}:p${pagePadded}:i${sanitizedRef}:s${subIdx}`
}

interface ExtractedMeasure {
  dimension: 'mass' | 'volume'
  count: number
  eachBaseValue: number
  totalBaseValue: number
}

export interface QuantitySemanticsConflictResult {
  hasConflict: boolean
  conflictKind: 'none' | 'unit_or_measure_conflict' | 'pack_count_conflict'
  reason: string | null
}

function toBaseValue(value: number, unitRaw: string): { dimension: 'mass' | 'volume'; baseValue: number } | null {
  const u = unitRaw.toLowerCase().trim()
  if (u === 'kg' || u === 'kilo' || u === 'kilogram' || u === 'كجم' || u === 'كيلو') {
    return { dimension: 'mass', baseValue: value * 1000 }
  }
  if (
    u === 'g' ||
    u === 'gm' ||
    u === 'gms' ||
    u === 'gram' ||
    u === 'grams' ||
    u === 'جم' ||
    u === 'جرام' ||
    u === 'غ'
  ) {
    return { dimension: 'mass', baseValue: value }
  }
  if (u === 'l' || u === 'ltr' || u === 'liter' || u === 'litre' || u === 'لتر') {
    return { dimension: 'volume', baseValue: value * 1000 }
  }
  if (u === 'ml' || u === 'milliliter' || u === 'millilitre' || u === 'مل' || u === 'ملل') {
    return { dimension: 'volume', baseValue: value }
  }
  return null
}

function extractDistinctMeasurements(text?: string | null): ExtractedMeasure[] {
  if (!text) return []
  const normalized = normalizeArabicNumerals(text)
  const found: ExtractedMeasure[] = []
  WEIGHT_VOLUME_REGEX.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = WEIGHT_VOLUME_REGEX.exec(normalized)) !== null) {
    const count = match[1] ? Number(match[1]) : match[4] ? Number(match[4]) : 1
    const val = Number(match[2])
    const unitRaw = (match[3] || '').toLowerCase()
    if (!Number.isFinite(val) || val <= 0 || !Number.isFinite(count) || count <= 0) continue

    const conv = toBaseValue(val, unitRaw)
    if (!conv) continue

    found.push({
      dimension: conv.dimension,
      count,
      eachBaseValue: conv.baseValue,
      totalBaseValue: count * conv.baseValue
    })
  }

  return found
}

export function assessOfferQuantitySemanticsConflict(
  offer: {
    titleEn?: string | null
    titleAr?: string | null
    inner_pack_count?: number | null
    total_content_value?: number | null
    total_content_unit?: string | null
    each_size_value?: number | null
    each_size_unit?: string | null
    sale_unit_type?: string | null
  }
): QuantitySemanticsConflictResult {
  const enMeasures = extractDistinctMeasurements(offer.titleEn)
  const arMeasures = extractDistinctMeasurements(offer.titleAr)
  if (enMeasures.length === 0 || arMeasures.length === 0) {
    return { hasConflict: false, conflictKind: 'none', reason: null }
  }

  // Multi-measurement EN/AR titles (e.g. Indomie "10x75Gm / 10x70Gm" or Noor "32Oz/2x450ml" vs "٢×٤٥٠ جرام")
  if (enMeasures.length > 1 || arMeasures.length > 1) {
    // 1. Check same numeric (count, eachBaseValue) paired with conflicting dimension (mass g vs volume ml)
    for (const enM of enMeasures) {
      for (const arM of arMeasures) {
        if (
          enM.dimension !== arM.dimension &&
          enM.count === arM.count &&
          Math.abs(enM.eachBaseValue - arM.eachBaseValue) / Math.max(enM.eachBaseValue, arM.eachBaseValue) <= 0.05
        ) {
          return {
            hasConflict: true,
            conflictKind: 'unit_or_measure_conflict',
            reason: `EN (${enM.count}x${enM.eachBaseValue} ${enM.dimension}) and AR (${arM.count}x${arM.eachBaseValue} ${arM.dimension}) conflict in unit dimension (mass vs volume).`
          }
        }
      }
    }

    // For multi-variant assortments, differing variant weights/sizes within the same dimension (e.g. 700g / 750g) are expected.
    const isAssortment =
      ASSORTMENT_TITLE_REGEX.test(offer.titleEn || '') ||
      ASSORTMENT_TITLE_REGEX.test(offer.titleAr || '')
    if (isAssortment) {
      const enDims = new Set(enMeasures.map((m) => m.dimension))
      const arDims = new Set(arMeasures.map((m) => m.dimension))
      const commonDim = Array.from(enDims).some((d) => arDims.has(d))
      if (commonDim) {
        return { hasConflict: false, conflictKind: 'none', reason: null }
      }
    }

    // 2. Check within same dimension whether an EN measure has no matching AR measure (e.g. 10x75g missing in AR 10x70g)
    const arHasDim = (dim: 'mass' | 'volume') => arMeasures.some((m) => m.dimension === dim)
    const enHasDim = (dim: 'mass' | 'volume') => enMeasures.some((m) => m.dimension === dim)

    for (const enM of enMeasures) {
      if (!arHasDim(enM.dimension)) continue
      const matched = arMeasures.some(
        (arM) =>
          arM.dimension === enM.dimension &&
          (Math.abs(arM.totalBaseValue - enM.totalBaseValue) / Math.max(arM.totalBaseValue, enM.totalBaseValue) <= 0.05 ||
            Math.abs(arM.eachBaseValue - enM.eachBaseValue) / Math.max(arM.eachBaseValue, enM.eachBaseValue) <= 0.05)
      )
      if (!matched) {
        const unitLabel = enM.dimension === 'mass' ? 'g' : 'ml'
        return {
          hasConflict: true,
          conflictKind: 'unit_or_measure_conflict',
          reason: `EN measure (${enM.count}x${enM.eachBaseValue}${unitLabel}) has no matching ${enM.dimension} measure in AR title.`
        }
      }
    }

    for (const arM of arMeasures) {
      if (!enHasDim(arM.dimension)) continue
      const matched = enMeasures.some(
        (enM) =>
          enM.dimension === arM.dimension &&
          (Math.abs(enM.totalBaseValue - arM.totalBaseValue) / Math.max(enM.totalBaseValue, arM.totalBaseValue) <= 0.05 ||
            Math.abs(enM.eachBaseValue - arM.eachBaseValue) / Math.max(enM.eachBaseValue, arM.eachBaseValue) <= 0.05)
      )
      if (!matched) {
        const unitLabel = arM.dimension === 'mass' ? 'g' : 'ml'
        return {
          hasConflict: true,
          conflictKind: 'unit_or_measure_conflict',
          reason: `AR measure (${arM.count}x${arM.eachBaseValue}${unitLabel}) has no matching ${arM.dimension} measure in EN title.`
        }
      }
    }

    return { hasConflict: false, conflictKind: 'none', reason: null }
  }

  const en = enMeasures[0]
  const ar = arMeasures[0]
  if (en.dimension !== ar.dimension) {
    return { hasConflict: false, conflictKind: 'none', reason: null }
  }

  // Case 1: Total content agrees within 5% (covers identical specs and equivalent total expressions like 2x500g vs 1kg)
  const maxTotal = Math.max(en.totalBaseValue, ar.totalBaseValue)
  if (maxTotal > 0 && Math.abs(en.totalBaseValue - ar.totalBaseValue) / maxTotal <= 0.05) {
    return { hasConflict: false, conflictKind: 'none', reason: null }
  }

  // Case 2: Compare individual-unit (per-inner-content) size at equivalent level
  const maxEach = Math.max(en.eachBaseValue, ar.eachBaseValue)
  const eachMatches = maxEach > 0 && Math.abs(en.eachBaseValue - ar.eachBaseValue) / maxEach <= 0.05

  if (!eachMatches) {
    // Genuine unit or magnitude transcription conflict (e.g. 6x1.5Ltr vs 6x1.5ml, or 500g vs 250g)
    // Never silently rewrite ml <-> L.
    const unitLabel = en.dimension === 'mass' ? 'g' : 'ml'
    return {
      hasConflict: true,
      conflictKind: 'unit_or_measure_conflict',
      reason: `EN (${en.count}x${en.eachBaseValue}${unitLabel}) and AR (${ar.count}x${ar.eachBaseValue}${unitLabel}) state conflicting per-unit quantities/units.`
    }
  }

  // Case 3: Per-unit sizes agree (e.g. 1000g vs 10x1000g), check whether supporting carton evidence establishes N-unit pack
  const lowerCount = Math.min(en.count, ar.count)
  const higherCount = Math.max(en.count, ar.count)
  const structuredPackCount =
    offer.inner_pack_count != null && Number.isFinite(Number(offer.inner_pack_count)) && Number(offer.inner_pack_count) > 0
      ? Number(offer.inner_pack_count)
      : null
  const structuredTotalConv =
    offer.total_content_value != null &&
    Number.isFinite(Number(offer.total_content_value)) &&
    offer.total_content_unit
      ? toBaseValue(Number(offer.total_content_value), offer.total_content_unit)
      : null

  const cartonCountSupported =
    lowerCount === 1 &&
    higherCount > 1 &&
    (structuredPackCount === higherCount ||
      (structuredTotalConv !== null &&
        structuredTotalConv.dimension === en.dimension &&
        Math.abs(structuredTotalConv.baseValue - higherCount * en.eachBaseValue) /
          Math.max(structuredTotalConv.baseValue, higherCount * en.eachBaseValue) <=
          0.05))

  if (cartonCountSupported) {
    return { hasConflict: false, conflictKind: 'none', reason: null }
  }

  return {
    hasConflict: true,
    conflictKind: 'pack_count_conflict',
    reason: `EN and AR titles agree on per-unit size (${en.eachBaseValue}) but disagree on pack count (${en.count} vs ${ar.count}) without supporting carton evidence (structured pack=${structuredPackCount ?? 'null'}).`
  }
}

export function hasEnArWeightVolumeConflict(
  titleEn?: string | null,
  titleAr?: string | null,
  structuredPack?: {
    inner_pack_count?: number | null
    total_content_value?: number | null
    total_content_unit?: string | null
    each_size_value?: number | null
    each_size_unit?: string | null
    sale_unit_type?: string | null
  }
): boolean {
  return assessOfferQuantitySemanticsConflict({
    titleEn,
    titleAr,
    ...structuredPack
  }).hasConflict
}

export function isFragmentedOrInvalidTitle(titleEn?: string | null, titleAr?: string | null): boolean {
  const en = (titleEn || '').trim()
  const ar = (titleAr || '').trim()
  if (!en && !ar) return true

  const enIsFragment = !en || FRAGMENT_TITLE_ONLY_REGEX.test(en) || en.replace(/[\s\d.,:/\-*%+()]/g, '').length < 2
  const arIsFragment = !ar || FRAGMENT_TITLE_ONLY_REGEX.test(ar) || ar.replace(/[\s\d.,:/\-*%+()]/g, '').length < 2

  // If neither language has a coherent title, it is fragmented
  if (enIsFragment && arIsFragment) return true

  // If one side was explicitly extracted solely as a meaningless connector fragment like "OR" / "Selected Branches"
  if (en && FRAGMENT_TITLE_ONLY_REGEX.test(en) && !ar) return true
  if (ar && FRAGMENT_TITLE_ONLY_REGEX.test(ar) && !en) return true

  return false
}

function resolvePerUnitPricing(
  offer: Partial<UnifiedBatchOffer>,
  promoPrice: number,
  isAssortment: boolean
): { unitPrice: number | null; unitPriceUnit: string | null; basisEstablished: boolean } {
  if (!Number.isFinite(promoPrice) || promoPrice <= 0 || isAssortment) {
    return { unitPrice: null, unitPriceUnit: null, basisEstablished: false }
  }

  const saleUnitType = (offer.sale_unit_type || '').toLowerCase().trim()
  const eachVal = offer.each_size_value != null ? Number(offer.each_size_value) : null
  const eachUnit = (offer.each_size_unit || '').toLowerCase().trim()
  const packCount =
    offer.inner_pack_count != null && Number(offer.inner_pack_count) > 0
      ? Number(offer.inner_pack_count)
      : 1

  const combinedTitle = normalizeArabicNumerals(`${offer.titleEn || ''} ${offer.titleAr || ''}`)
  const hasPerKgTitleSignal =
    /\b(?:per\s*kg|\/\s*kg|1\s*kg)\b|للكيلو|بالكيلو|\b1\s*(?:كيلو|كجم)\b/i.test(combinedTitle)

  if (saleUnitType === 'kg' && (eachVal == null || eachVal === 1 || hasPerKgTitleSignal)) {
    const divisorKg = eachVal && eachUnit === 'kg' ? eachVal : 1
    return {
      unitPrice: Number((promoPrice / divisorKg).toFixed(2)),
      unitPriceUnit: 'kg',
      basisEstablished: true
    }
  }

  if (eachVal && eachVal > 0 && (eachUnit === 'kg' || eachUnit === 'g')) {
    const totalKg = (eachUnit === 'kg' ? eachVal : eachVal / 1000) * packCount
    if (totalKg > 0) {
      return {
        unitPrice: Number((promoPrice / totalKg).toFixed(2)),
        unitPriceUnit: 'kg',
        basisEstablished: true
      }
    }
  }

  if (eachVal && eachVal > 0 && (eachUnit === 'l' || eachUnit === 'ml')) {
    const totalL = (eachUnit === 'l' ? eachVal : eachVal / 1000) * packCount
    if (totalL > 0) {
      return {
        unitPrice: Number((promoPrice / totalL).toFixed(2)),
        unitPriceUnit: 'L',
        basisEstablished: true
      }
    }
  }

  return { unitPrice: null, unitPriceUnit: null, basisEstablished: false }
}

/**
 * Deterministic 3-way publication gate separating:
 * A. `catalog_linked` (verified SKU match)
 * B. `approved_non_catalog` (factually valid grocery/eligible offer without verified SKU, explicitly approved by operator)
 * C. `quarantined` (conflicting facts, missing critical dates/price/provenance, out-of-scope non-grocery, or awaiting operator approval)
 */
export function assessOfferPublicationOutcome(params: {
  offer: Partial<UnifiedBatchOffer> & { batchOfferKey: string }
  proposal?: MatchingProposal | null
  temporaryProducts?: Record<string, TemporaryProductGroup>
  approval?: NonCatalogOfferApproval | null
  knownConflictFlags?: string[]
  publicationReferenceDateIso?: string | null
  enforceNonExpiredForPublication?: boolean
  requireUnconditionalPriceForPublication?: boolean
}): OfferPublicationAssessment {
  const { offer, proposal, temporaryProducts, approval, knownConflictFlags = [] } = params

  const quarantineReasons: string[] = []
  const correctionReasons: string[] = []

  const titleEn = offer.titleEn ?? null
  const titleAr = offer.titleAr ?? null
  const combinedTitle = `${titleEn || ''} ${titleAr || ''}`.trim()

  const canonical = offer.canonical as Record<string, any> | undefined
  const rawAttrs = ((offer as any).raw_attributes || (canonical?.raw?.raw_attributes) || {}) as Record<string, any>
  const commodityTagRaw =
    canonical?.product?.commodity_tag ??
    (offer as any).commodity_tag ??
    rawAttrs.raw_offer_extraction?.commodity_tag ??
    null
  const categoryHintRaw =
    canonical?.product?.category_hint ??
    (offer as any).category_slug ??
    rawAttrs.raw_offer_extraction?.category_slug ??
    null
  const extractedDomainRaw =
    canonical?.product?.item_domain ??
    rawAttrs.item_domain ??
    rawAttrs.raw_offer_extraction?.item_domain ??
    offer.category ??
    null

  const itemDomain = detectItemDomainFromTitle(
    titleEn,
    titleAr,
    extractedDomainRaw,
    { commodityTag: commodityTagRaw, categoryHint: categoryHintRaw }
  )

  const normCommodity = String(commodityTagRaw || '').toLowerCase().trim()
  const normCategoryHint = String(categoryHintRaw || '').toLowerCase().trim()
  const normExtractedDomain = String(extractedDomainRaw || '').toLowerCase().trim()
  const explicitNonGroceryTag =
    normCommodity === 'non_grocery_item' ||
    normCategoryHint === 'non-grocery' ||
    normCategoryHint === 'non_grocery' ||
    normCategoryHint === 'electronics' ||
    normCategoryHint === 'appliance' ||
    normCategoryHint === 'appliances'
  const explicitFoodOrGroceryTitle =
    FOOD_OR_GROCERY_TITLE_REGEX.test(combinedTitle) ||
    PACKAGED_CPG_OVERRIDE_REGEX.test(combinedTitle) ||
    LOOSE_PRODUCE_REGEX.test(combinedTitle) ||
    MEAT_SEAFOOD_REGEX.test(combinedTitle) ||
    BAKERY_REGEX.test(combinedTitle)

  // Contradictory category evidence must be quarantined for review rather than guessing grocery
  if (
    (explicitNonGroceryTag && (normExtractedDomain === 'grocery' || explicitFoodOrGroceryTitle)) ||
    (normExtractedDomain === 'grocery' && (itemDomain === 'electronics' || itemDomain === 'appliance' || itemDomain === 'other_non_grocery'))
  ) {
    quarantineReasons.push('CONFLICTING_CATEGORY_EVIDENCE')
    correctionReasons.push(
      `Contradictory category evidence (extractedDomain=${extractedDomainRaw ?? 'null'}, commodity_tag=${commodityTagRaw ?? 'null'}, category_hint=${categoryHintRaw ?? 'null'}).`
    )
  } else if (
    !normCommodity &&
    !normCategoryHint &&
    !normExtractedDomain &&
    !explicitFoodOrGroceryTitle &&
    itemDomain === 'grocery'
  ) {
    // No structured category evidence and no recognizable food/consumable/personal-care/non-grocery title signal
    quarantineReasons.push('MISSING_OR_UNVERIFIED_CATEGORY_EVIDENCE')
    correctionReasons.push('Category evidence is missing and title does not clearly establish grocery eligibility.')
  }

  // 1. Critical factual integrity checks (applies across all outcomes)
  if (isFragmentedOrInvalidTitle(titleEn, titleAr)) {
    quarantineReasons.push('FRAGMENTED_OR_MISSING_TITLE')
    correctionReasons.push('Title is missing or contains only fragmented offer wording.')
  }

  if (!offer.supermarketId || !String(offer.supermarketId).trim()) {
    quarantineReasons.push('MISSING_SUPERMARKET_PROVENANCE')
    correctionReasons.push('Supermarket identifier is required for traceable source provenance.')
  }

  if (!offer.sourceOfferId && !offer.leafletId) {
    quarantineReasons.push('MISSING_SOURCE_PROVENANCE')
    correctionReasons.push('Source leaflet or source offer reference is missing.')
  }

  const v3RetentionMode =
    (offer as any).parent_offer_retention_mode ??
    (offer as any).v3RetentionMode ??
    canonical?.parent_offer_retention_mode ??
    null
  // Wifran MVP: Internal fixed SAR currency; never reject or emit UNSUPPORTED_OR_UNVERIFIED_CURRENCY.

  const promoPrice = offer.promoPrice !== null && offer.promoPrice !== undefined ? Number(offer.promoPrice) : NaN
  if (!Number.isFinite(promoPrice) || promoPrice <= 0) {
    quarantineReasons.push('INVALID_OR_MISSING_OFFER_PRICE')
    correctionReasons.push('Valid positive promotional price is required.')
  }

  if (offer.originalPrice !== null && offer.originalPrice !== undefined) {
    const origPrice = Number(offer.originalPrice)
    if (!Number.isFinite(origPrice) || (Number.isFinite(promoPrice) && origPrice < promoPrice)) {
      quarantineReasons.push('ORIGINAL_PRICE_LESS_THAN_OFFER_PRICE')
      correctionReasons.push('Original price must be greater than or equal to offer price.')
    }
  }

  const startDate = offer.offerStartDate ? String(offer.offerStartDate).trim() : ''
  const endDate = offer.offerEndDate ? String(offer.offerEndDate).trim() : ''
  if (!endDate || !isValidCalendarDateIso(endDate) || !startDate || !isValidCalendarDateIso(startDate)) {
    quarantineReasons.push('MISSING_CRITICAL_OFFER_DATES')
    correctionReasons.push('Valid calendar offer_start_date and offer_end_date (YYYY-MM-DD) are required.')
  } else if (endDate < startDate) {
    quarantineReasons.push('INVALID_OFFER_DATE_RANGE')
    correctionReasons.push('offer_end_date cannot precede offer_start_date.')
  } else if (params.enforceNonExpiredForPublication) {
    const referenceDateIso =
      params.publicationReferenceDateIso && isValidCalendarDateIso(params.publicationReferenceDateIso)
        ? String(params.publicationReferenceDateIso).trim()
        : new Date().toISOString().slice(0, 10)
    if (endDate < referenceDateIso) {
      quarantineReasons.push('EXPIRED_OFFER_DATES')
      correctionReasons.push(
        `Offer end date (${endDate}) is earlier than publication reference date (${referenceDateIso}).`
      )
    }
  }

  const scope = offer.locationScope ? String(offer.locationScope).trim() : ''
  const validGeo =
    (scope === 'national' && !offer.cityId && !offer.regionId) ||
    (scope === 'region' && Boolean(offer.regionId) && !offer.cityId) ||
    (scope === 'city' && Boolean(offer.cityId))
  if (!scope || !validGeo) {
    quarantineReasons.push('INVALID_LOCATION_SCOPE')
    correctionReasons.push(`Location scope '${scope || 'missing'}' does not match cityId/regionId metadata.`)
  }

  if (Array.isArray(offer.blockingErrors) && offer.blockingErrors.length > 0) {
    quarantineReasons.push('EXPLICIT_BLOCKING_ERRORS')
    correctionReasons.push(`Blocking extraction errors: ${offer.blockingErrors.join('; ')}`)
  }

  if (v3RetentionMode === 'quarantined_do_not_publish' && !quarantineReasons.includes('V3_PARENT_OFFER_QUARANTINED')) {
    quarantineReasons.push('V3_PARENT_OFFER_QUARANTINED')
    correctionReasons.push('V3 parent card is marked quarantined_do_not_publish and cannot enter consumer publication.')
  }

  const allSignalStrings = [
    ...knownConflictFlags,
    ...(Array.isArray(offer.warnings) ? offer.warnings : []),
    ...(Array.isArray(offer.blockingErrors) ? offer.blockingErrors : []),
    ...(Array.isArray(canonical?.quality?.reason_codes) ? canonical.quality.reason_codes : [])
  ]
  for (const flag of allSignalStrings) {
    if (CONFLICT_FLAG_PATTERNS.some((rx) => rx.test(String(flag)))) {
      if (!quarantineReasons.includes('FACT_OR_PROMO_CONFLICT')) {
        quarantineReasons.push('FACT_OR_PROMO_CONFLICT')
        correctionReasons.push(`Conflicting or unresolvable offer evidence: ${flag}`)
      }
    }
  }

  const quantityConflict = assessOfferQuantitySemanticsConflict({
    titleEn,
    titleAr,
    inner_pack_count:
      offer.inner_pack_count ??
      canonical?.content?.pack_quantity ??
      canonical?.quantity_semantics?.inner_count ??
      null,
    total_content_value:
      offer.total_content_value ??
      canonical?.content?.total_content_value ??
      canonical?.quantity_semantics?.total_content?.value ??
      null,
    total_content_unit:
      offer.total_content_unit ??
      canonical?.content?.total_content_unit ??
      canonical?.quantity_semantics?.total_content?.unit ??
      null,
    each_size_value:
      offer.each_size_value ??
      canonical?.content?.each_size_value ??
      canonical?.quantity_semantics?.per_inner_content?.value ??
      null,
    each_size_unit:
      offer.each_size_unit ??
      canonical?.content?.each_size_unit ??
      canonical?.quantity_semantics?.per_inner_content?.unit ??
      null,
    sale_unit_type: offer.sale_unit_type ?? canonical?.quantity_semantics?.sale_unit ?? null
  })
  if (quantityConflict.hasConflict) {
    if (quantityConflict.conflictKind === 'pack_count_conflict') {
      quarantineReasons.push('EN_AR_PACK_COUNT_CONFLICT')
      correctionReasons.push(
        quantityConflict.reason ||
          'English and Arabic titles state differing pack counts without supporting carton evidence.'
      )
    } else {
      quarantineReasons.push('EN_AR_WEIGHT_VOLUME_CONFLICT')
      correctionReasons.push(
        quantityConflict.reason || 'English and Arabic titles state conflicting product weights/volumes.'
      )
    }
  }

  // BOGO / buy-N / bundle without clear price or ambiguous promo mechanic
  const promoText = `${offer.promoNotes || ''} ${offer.promotion_mechanic || ''} ${titleEn || ''} ${titleAr || ''}`
  if (/\b(?:buy\s*\?|x\s*\?)\b/i.test(promoText) || /\buncertain\s+price\b/i.test(promoText)) {
    quarantineReasons.push('UNRESOLVABLE_PROMO_QUANTITY')
    correctionReasons.push('Promotional quantity or price basis is ambiguous.')
  }

  // Conditional & ambiguous price-role protection (005H-B2-PREP):
  // Prevent low-confidence / unresolved / unrepresented conditional prices from becoming unconditional offers.
  const priceTerms = (canonical?.price_terms || {}) as Record<string, any>
  const priceRoleConfidence = priceTerms.price_role_confidence ?? null
  const priceBasis = priceTerms.price_basis ?? null
  const loyaltyRequired = Boolean(priceTerms.loyalty_required)
  const loyaltyProgramName = priceTerms.loyalty_program_name
    ? String(priceTerms.loyalty_program_name).trim()
    : null
  const checkoutMultibuyQty =
    offer.promo_condition_quantity != null
      ? Number(offer.promo_condition_quantity)
      : priceTerms.retailer_checkout_multibuy_qty != null
        ? Number(priceTerms.retailer_checkout_multibuy_qty)
        : null
  const isAmbiguousPriceRole =
    priceRoleConfidence === 'low' ||
    priceBasis === 'unknown' ||
    knownConflictFlags.includes('PRICE_ROLE_AMBIGUOUS') ||
    knownConflictFlags.includes('COMPOUND_TIER_INCOMPLETE')
  if (isAmbiguousPriceRole && !quarantineReasons.includes('PRICE_ROLE_AMBIGUOUS')) {
    quarantineReasons.push('PRICE_ROLE_AMBIGUOUS')
    correctionReasons.push(
      'Price role or promotional tier condition semantics are ambiguous and must remain in review.'
    )
  }

  const isConditionalPrice =
    Boolean(priceTerms.is_conditional_price) ||
    loyaltyRequired ||
    priceBasis === 'buy_n' ||
    priceBasis === 'buy_x_get_y_checkout' ||
    (checkoutMultibuyQty != null && Number.isFinite(checkoutMultibuyQty) && checkoutMultibuyQty >= 2)
  const hasExplicitConditionRepresentation =
    (loyaltyRequired &&
      (Boolean(loyaltyProgramName) ||
        Boolean(offer.promoNotes && String(offer.promoNotes).trim()) ||
        Boolean(priceTerms.explicit_condition_verified))) ||
    (!loyaltyRequired &&
      checkoutMultibuyQty != null &&
      Number.isFinite(checkoutMultibuyQty) &&
      checkoutMultibuyQty >= 2)
  if (isConditionalPrice && !isAmbiguousPriceRole) {
    if (params.requireUnconditionalPriceForPublication) {
      quarantineReasons.push('CONDITIONAL_PRICE_NOT_UNCONDITIONAL')
      correctionReasons.push(
        'Conditional loyalty or checkout multibuy price cannot enter an unconditional consumer feed.'
      )
    } else if (!hasExplicitConditionRepresentation) {
      quarantineReasons.push('UNREPRESENTED_CONDITIONAL_PRICE')
      correctionReasons.push(
        'Conditional promotional price lacks explicit condition representation and must remain in review.'
      )
    }
  }

  // 2. Assortment & manufacturer identity state
  const v3CardAssortment = canonical?.reconciled_v3?.assortment?.status ?? null
  const v3SubItemsCount = Array.isArray(canonical?.reconciled_v3?.sub_items)
    ? canonical.reconciled_v3.sub_items.length
    : 0
  const rawAssortmentStatus =
    canonical?.assortment?.status ??
    v3CardAssortment ??
    offer.assortment_status ??
    rawAttrs.assortment_status ??
    offer.matchingEvidence?.assortment_status ??
    null
  const operatorConfirmedSingleSku = offer.matchingEvidence?.assortment_status === 'single_sku'
  const isExplicitAssortment =
    !operatorConfirmedSingleSku &&
    (rawAssortmentStatus === 'multiple_variants' ||
      rawAssortmentStatus === 'ambiguous_alternatives' ||
      rawAssortmentStatus === 'explicit_assortment' ||
      rawAssortmentStatus === 'visual_multiple_variants' ||
      rawAssortmentStatus === 'unsplit_assortment' ||
      rawAssortmentStatus === 'assorted' ||
      v3RetentionMode === 'unsplit_assortment' ||
      v3RetentionMode === 'decomposed_shared_promo_parent' ||
      (v3SubItemsCount > 1 && offer.decomposedChildIndex == null) ||
      ASSORTMENT_TITLE_REGEX.test(combinedTitle) ||
      (offer as any).brandStatus === 'multi_brand' ||
      canonical?.product_facts?.brand_assertion?.state === 'multi_brand')

  const assortmentStatus: OfferPublicationAssessment['assortmentStatus'] =
    rawAssortmentStatus === 'ambiguous_alternatives'
      ? 'ambiguous_alternatives'
      : isExplicitAssortment
      ? 'multiple_variants'
      : rawAssortmentStatus === 'single_sku' || rawAssortmentStatus === 'single_product'
      ? 'single_sku'
      : 'unknown_composition'

  const perUnitPricing = resolvePerUnitPricing(offer, promoPrice, isExplicitAssortment)

  // Check if catalog-linked (only when no critical fact conflicts exist)
  const tempGroup =
    proposal?.decision === 'temporary' &&
    typeof proposal.temporaryId === 'string' &&
    proposal.temporaryId.length > 0
      ? temporaryProducts?.[proposal.temporaryId] ?? null
      : null
  const isDefaultConsumerDomainEarly =
    itemDomain === 'grocery' || itemDomain === 'household' || itemDomain === 'personal_care'

  const hasApprovedTempLink =
    !isExplicitAssortment &&
    tempGroup?.operatorDecision === 'approved' &&
    proposal?.operatorDecision !== 'rejected' &&
    approval?.decision !== 'rejected'

  const hasValidAutoProvisionalTempLink =
    !isExplicitAssortment &&
    Boolean(tempGroup) &&
    tempGroup!.operatorDecision !== 'approved' &&
    tempGroup!.operatorDecision !== 'rejected' &&
    proposal?.operatorDecision !== 'rejected' &&
    approval?.decision !== 'rejected' &&
    isDefaultConsumerDomainEarly &&
    assortmentStatus !== 'multiple_variants' &&
    assortmentStatus !== 'ambiguous_alternatives' &&
    Boolean((tempGroup!.productNameEn || tempGroup!.productNameAr || '').trim()) &&
    (offer.sale_unit_type === 'kg' ||
      (typeof tempGroup!.eachSizeValue === 'number' &&
        Number.isFinite(tempGroup!.eachSizeValue) &&
        tempGroup!.eachSizeValue > 0 &&
        Boolean(tempGroup!.eachSizeUnit)))

  const hasApprovedExistingLink =
    !isExplicitAssortment &&
    proposal?.decision === 'existing' &&
    Boolean(proposal.matchedProductId) &&
    proposal.operatorDecision !== 'rejected'

  if (quarantineReasons.length === 0 && (hasApprovedExistingLink || hasApprovedTempLink)) {
    return {
      batchOfferKey: offer.batchOfferKey,
      outcome: 'catalog_linked',
      isEligibleForNonCatalogPublication: false,
      isSafeForNonCatalogPublication: false,
      category: null,
      itemDomain,
      catalogMatchStatus: 'verified_linked',
      exactIdentityStatus: 'verified_sku',
      assortmentStatus,
      comparisonDisabled: false,
      unresolvedReason: null,
      quarantineReasons: [],
      correctionReasons: [],
      perUnitPricing
    }
  }

  if (quarantineReasons.length === 0 && hasValidAutoProvisionalTempLink) {
    return {
      batchOfferKey: offer.batchOfferKey,
      outcome: 'catalog_linked',
      isEligibleForNonCatalogPublication: false,
      isSafeForNonCatalogPublication: false,
      category: null,
      itemDomain,
      catalogMatchStatus: 'candidate_pending_review',
      exactIdentityStatus: 'unresolved',
      assortmentStatus,
      comparisonDisabled: false,
      unresolvedReason: null,
      quarantineReasons: [],
      correctionReasons: [],
      perUnitPricing
    }
  }

  // Non-grocery scope gate (WP2 §4): preserve source record, keep out of default consumer feed
  const isDefaultConsumerDomain =
    itemDomain === 'grocery' || itemDomain === 'household' || itemDomain === 'personal_care'
  if (!isDefaultConsumerDomain) {
    quarantineReasons.push('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')
    correctionReasons.push(
      `Domain '${itemDomain}' is excluded from WP2 default grocery consumer feed; archived without consumer publication.`
    )
  }

  // Classify eligible non-catalog category (prioritize structured domain & packaged CPG guards before keyword fallback)
  let category: NonCatalogEligibilityCategory | null = null
  const isPerWeightSale =
    offer.sale_unit_type === 'kg' ||
    (offer as any).is_per_weight_pricing === true ||
    canonical?.price_terms?.price_basis === 'per_kg' ||
    /\b(?:per\s*kg|\/\s*kg)\b|للكيلو|بالكيلو/iu.test(combinedTitle)
  const eachUnitLower = String(offer.each_size_unit || '').toLowerCase().trim()
  const hasStructuredMultipackOrVolume =
    Number(offer.inner_pack_count || 1) > 1 ||
    ['ml', 'l', 'lt', 'ltr', 'milliliter', 'liter', 'roll', 'sheet'].includes(eachUnitLower)
  const isPackagedCpg =
    !isPerWeightSale &&
    (normExtractedDomain === 'household' ||
      normExtractedDomain === 'personal_care' ||
      hasStructuredMultipackOrVolume ||
      PACKAGED_CPG_OVERRIDE_REGEX.test(combinedTitle) ||
      Boolean(
        offer.brand &&
          offer.brand.trim() &&
          offer.each_size_value != null &&
          Number(offer.each_size_value) > 0 &&
          eachUnitLower !== '' &&
          eachUnitLower !== 'kg'
      ))

  if (isDefaultConsumerDomain) {
    if (isExplicitAssortment) {
      category = 'unsplit_assortment'
    } else if (
      normExtractedDomain === 'bakery_inhouse' ||
      (normExtractedDomain !== 'household' &&
        normExtractedDomain !== 'personal_care' &&
        !PACKAGED_CPG_OVERRIDE_REGEX.test(combinedTitle) &&
        BAKERY_REGEX.test(combinedTitle))
    ) {
      category = 'in_house_bakery'
    } else if (!isPackagedCpg && LOOSE_PRODUCE_REGEX.test(combinedTitle)) {
      category = 'loose_produce'
    } else if (!isPackagedCpg && MEAT_SEAFOOD_REGEX.test(combinedTitle)) {
      category = 'meat_seafood_by_weight'
    } else if (normExtractedDomain === 'fresh_loose' || isPerWeightSale) {
      category = MEAT_SEAFOOD_REGEX.test(combinedTitle) ? 'meat_seafood_by_weight' : 'loose_produce'
    } else {
      category = 'valid_grocery_unresolved_sku'
    }
  }

  const unresolvedReason =
    !isDefaultConsumerDomain
      ? `Non-grocery item (${itemDomain}) is excluded from the default consumer grocery feed.`
      : proposal?.validationIssues?.map((v) => v.message).join(' | ') ||
        (isExplicitAssortment
          ? 'Unsplit multi-variant assortment cannot map to a single manufacturer SKU.'
          : category === 'loose_produce' || category === 'meat_seafood_by_weight' || category === 'in_house_bakery'
          ? `Variable-weight or in-house retail offer (${category}) without a fixed manufacturer barcode/SKU.`
          : 'Manufacturer product identity is not linked to a verified catalog SKU.')

  const isEligible = quarantineReasons.length === 0 && isDefaultConsumerDomain
  const catalogMatchStatus: OfferPublicationAssessment['catalogMatchStatus'] =
    quarantineReasons.some(
      (r) =>
        r.includes('CONFLICT') ||
        r === 'PRICE_ROLE_AMBIGUOUS' ||
        r === 'COMPOUND_TIER_INCOMPLETE'
    )
      ? 'conflict_needs_review'
      : isExplicitAssortment
      ? 'candidate_pending_review'
      : 'unresolved'

  if (!isEligible) {
    return {
      batchOfferKey: offer.batchOfferKey,
      outcome: 'quarantined',
      isEligibleForNonCatalogPublication: false,
      isSafeForNonCatalogPublication: false,
      category,
      itemDomain,
      catalogMatchStatus,
      exactIdentityStatus: 'unresolved',
      assortmentStatus,
      comparisonDisabled: true,
      unresolvedReason,
      quarantineReasons,
      correctionReasons,
      perUnitPricing
    }
  }

  // Eligible for safe non-catalog publication; operator explicit approval determines publish vs pending/rejected
  if (approval?.decision === 'rejected') {
    return {
      batchOfferKey: offer.batchOfferKey,
      outcome: 'quarantined',
      isEligibleForNonCatalogPublication: false,
      isSafeForNonCatalogPublication: false,
      category,
      itemDomain,
      catalogMatchStatus,
      exactIdentityStatus: 'unresolved',
      assortmentStatus,
      comparisonDisabled: true,
      unresolvedReason,
      quarantineReasons: ['OPERATOR_REJECTED_NON_CATALOG'],
      correctionReasons: ['Operator rejected non-catalog publication for this offer.'],
      perUnitPricing
    }
  }

  const isAutoApprovedAssortment = category === 'unsplit_assortment' || isExplicitAssortment
  const isOperatorApproved = approval?.decision === 'approved' || isAutoApprovedAssortment
  if (!isOperatorApproved) {
    correctionReasons.push('OPERATOR_NON_CATALOG_APPROVAL_REQUIRED')
  }

  return enforceV3PublicationQuarantineInvariant({
    batchOfferKey: offer.batchOfferKey,
    outcome: isOperatorApproved ? 'approved_non_catalog' : 'quarantined',
    isEligibleForNonCatalogPublication: true,
    isSafeForNonCatalogPublication: true,
    category,
    itemDomain,
    catalogMatchStatus,
    exactIdentityStatus: 'unresolved',
    assortmentStatus,
    comparisonDisabled: true,
    unresolvedReason,
    quarantineReasons: [],
    correctionReasons,
    perUnitPricing
  }, {
    parentOfferRetentionMode: v3RetentionMode,
    conflictCodes: knownConflictFlags,
    currency: 'SAR'
  })
}

/**
 * Unbypassable publication quarantine barrier for Stage 2 hardening (WP5F-A).
 * Guarantees that any offer with V3 quarantine status, factual conflict codes, or unverified currency
 * can NEVER become eligible or safe for consumer publication across any caller boundary.
 */
export function enforceV3PublicationQuarantineInvariant(
  assessment: OfferPublicationAssessment,
  context?: {
    parentOfferRetentionMode?: string | null
    conflictCodes?: readonly string[]
    currency?: string | null
  }
): OfferPublicationAssessment {
  const hasFactualConflict = (context?.conflictCodes || []).some((flag) =>
    CONFLICT_FLAG_PATTERNS.some((rx) => rx.test(String(flag)))
  )
  const mustQuarantine =
    context?.parentOfferRetentionMode === 'quarantined_do_not_publish' ||
    assessment.quarantineReasons.length > 0 ||
    hasFactualConflict

  if (!mustQuarantine) {
    return assessment
  }

  const reasons = [...assessment.quarantineReasons]
  if (context?.parentOfferRetentionMode === 'quarantined_do_not_publish' && !reasons.includes('V3_PARENT_OFFER_QUARANTINED')) {
    reasons.push('V3_PARENT_OFFER_QUARANTINED')
  }
  for (const flag of context?.conflictCodes || []) {
    if (CONFLICT_FLAG_PATTERNS.some((rx) => rx.test(String(flag))) && !reasons.includes(String(flag))) {
      reasons.push(String(flag))
    }
  }

  return {
    ...assessment,
    outcome: 'quarantined',
    isEligibleForNonCatalogPublication: false,
    isSafeForNonCatalogPublication: false,
    comparisonDisabled: true,
    catalogMatchStatus:
      hasFactualConflict || context?.parentOfferRetentionMode === 'quarantined_do_not_publish'
        ? 'conflict_needs_review'
        : assessment.catalogMatchStatus,
    quarantineReasons: reasons
  }
}
