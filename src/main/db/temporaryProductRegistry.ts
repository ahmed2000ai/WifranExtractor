/**
 * Temporary Product Registry & Cross-Request Reconciliation Service
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001
 *
 * Implements deterministic reconciliation of model-generated temporary labels (e.g. "t1")
 * into collision-resistant batch-scoped temporary IDs (e.g. "t_batch_001").
 * Groups identical new products across leaflets and separate Gemini requests.
 * Strictly prevents false merges across different sizes, variants, pack counts, or brands.
 */

import {
  NormalizedIdentityAttributes,
  TemporaryProductGroup,
  OperatorDecisionStatus
} from '../../shared/types/catalogMatching'
import { UnifiedBatchOffer } from '../../shared/types/batchExtraction'
import {
  normalizeArabicText,
  normalizeEnglishText,
  normalizeSearchText
} from '../../shared/utils/textNormalization'
import { arePackConfigsStrictlyCompatible } from '../../shared/utils/sizeCompatibility'
import { evaluateIdentitySufficiency } from './productIdentityPolicy'

const CONCEPT_GROUPS: Array<{ concept: string; conflictingFamily?: string; terms: string[] }> = [
  // Storage / thermal state
  { concept: 'frozen', conflictingFamily: 'state', terms: ['frozen', 'مجمد', 'مجمده'] },
  { concept: 'fresh', conflictingFamily: 'state', terms: ['fresh', 'chilled', 'طازج', 'طازجه', 'مبرد'] },
  // Poultry cuts & forms
  { concept: 'breast', conflictingFamily: 'cut', terms: ['breast', 'breasts', 'صدور', 'صدر'] },
  { concept: 'thigh', conflictingFamily: 'cut', terms: ['thigh', 'thighs', 'افخاذ', 'فخذ'] },
  { concept: 'wings', conflictingFamily: 'cut', terms: ['wing', 'wings', 'اجنحه', 'جناح'] },
  { concept: 'drumstick', conflictingFamily: 'cut', terms: ['drumstick', 'drumsticks', 'سيقان'] },
  { concept: 'fillet', conflictingFamily: 'cut', terms: ['fillet', 'fillets', 'فيليه'] },
  { concept: 'nuggets', conflictingFamily: 'cut', terms: ['nugget', 'nuggets', 'ناجتس'] },
  { concept: 'burger', conflictingFamily: 'cut', terms: ['burger', 'burgers', 'برجر', 'برغر'] },
  { concept: 'strips', conflictingFamily: 'cut', terms: ['strip', 'strips', 'tenders', 'ستربس', 'تندر', 'تندرز'] },
  { concept: 'popcorn', conflictingFamily: 'cut', terms: ['popcorn', 'بوبكورن', 'بوب'] },
  { concept: 'mince', conflictingFamily: 'cut', terms: ['mince', 'minced', 'مفروم', 'مفرومه'] },
  // Flavor / recipe modifiers (each acts as its own distinguishing modifier)
  { concept: 'spicy', terms: ['spicy', 'hot', 'chili', 'chilli', 'حار', 'حاره', 'سبايسي', 'فلفل'] },
  { concept: 'original', terms: ['original', 'classic', 'plain', 'عادي', 'اصلي', 'كلاسيك'] },
  {
    concept: 'zero_sugar',
    terms: [
      'zero',
      'zero calories',
      'zero sugar',
      'no sugar',
      'sugar free',
      'diet',
      'light',
      'زيرو',
      'دايت',
      'لايت',
      'بدون سكر',
      'خالي من السكر',
      'خالي سكر'
    ]
  },
  {
    concept: 'gluten_free',
    terms: ['gluten free', 'خالي من الجلوتين', 'خال من الجلوتين', 'بدون جلوتين']
  },
  {
    concept: 'lactose_free',
    terms: ['lactose free', 'خالي من اللاكتوز', 'خال من اللاكتوز', 'بدون لاكتوز']
  },
  {
    concept: 'fat_free',
    terms: ['fat free', 'zero fat', 'skimmed', 'skim', 'خالي الدسم', 'خالي من الدسم', 'بدون دسم']
  },
  {
    concept: 'caffeine_free',
    terms: ['caffeine free', 'decaf', 'decaffeinated', 'خالي من الكافيين', 'بدون كافيين']
  },
  {
    concept: 'fragrance_free',
    terms: ['fragrance free', 'unscented', 'scent free', 'خالي من العطر', 'بدون عطر', 'غير معطر']
  },
  {
    concept: 'free_range',
    terms: ['free range', 'مرعى حر', 'حر المراعي', 'بيض بلدي حر']
  },
  { concept: 'cheese', terms: ['cheese', 'جبن', 'جبنه'] },
  { concept: 'garlic', terms: ['garlic', 'ثوم'] },
  { concept: 'bbq', terms: ['bbq', 'barbecue', 'باربكيو'] },
  { concept: 'lemon', terms: ['lemon', 'lime', 'ليمون'] },
  { concept: 'mango', terms: ['mango', 'مانجو'] },
  { concept: 'orange', terms: ['orange', 'برتقال'] },
  { concept: 'strawberry', terms: ['strawberry', 'فراوله'] },
  { concept: 'apple', terms: ['apple', 'تفاح'] },
  { concept: 'mixed_berry', terms: ['berry', 'berries', 'mixed fruit', 'توت', 'فواكه مشكله'] },
  { concept: 'chocolate', terms: ['chocolate', 'choco', 'cocoa', 'شوكولاته', 'شوكولا', 'كاكاو'] },
  { concept: 'vanilla', terms: ['vanilla', 'فانيليا', 'فانيلا'] },
  { concept: 'salted', conflictingFamily: 'salt', terms: ['salted', 'مملح', 'مملحه'] },
  { concept: 'unsalted', conflictingFamily: 'salt', terms: ['unsalted', 'غير مملح', 'بدون ملح'] },
  { concept: 'fine_sugar', conflictingFamily: 'texture', terms: ['fine', 'ناعم'] },
  { concept: 'coarse_sugar', conflictingFamily: 'texture', terms: ['coarse', 'خشن'] },
  // Core bilingual nouns (non-conflicting general product types)
  { concept: 'chicken', terms: ['chicken', 'دجاج', 'فروج'] },
  { concept: 'tender', terms: ['tender', 'طري', 'طريه'] },
  { concept: 'milk', terms: ['milk', 'حليب', 'لبن'] },
  { concept: 'juice', terms: ['juice', 'nectar', 'عصير', 'نكتار'] },
  { concept: 'butter', terms: ['butter', 'زبده', 'زبد'] },
  { concept: 'calrose', conflictingFamily: 'grain_variety', terms: ['calrose', 'كالروز'] },
  { concept: 'basmati', conflictingFamily: 'grain_variety', terms: ['basmati', 'بسمتي', 'مزه', 'سيلا', 'مزّة'] },
  { concept: 'egyptian_rice', conflictingFamily: 'grain_variety', terms: ['egyptian rice', 'ارز مصري', 'رز مصري'] },
  { concept: 'rice', terms: ['rice', 'ارز', 'رز'] },
  { concept: 'oil', terms: ['oil', 'زيت'] },
  { concept: 'water', terms: ['water', 'ماء', 'مياه'] },
  { concept: 'coffee', terms: ['coffee', 'قهوه'] },
  { concept: 'tea', terms: ['tea', 'شاي'] },
  { concept: 'sugar', terms: ['sugar', 'سكر'] },
  { concept: 'honey', terms: ['honey', 'عسل'] },
  { concept: 'shampoo', terms: ['shampoo', 'شامبو'] },
  { concept: 'soap', terms: ['soap', 'صابون'] },
  { concept: 'detergent', terms: ['detergent', 'powder', 'liquidwash', 'مسحوق', 'غسيل'] }
]

const FLAVOR_MODIFIER_CONCEPTS = new Set([
  'spicy', 'original', 'zero_sugar', 'gluten_free', 'lactose_free', 'fat_free',
  'caffeine_free', 'fragrance_free', 'free_range',
  'cheese', 'garlic', 'bbq', 'lemon', 'mango',
  'orange', 'strawberry', 'apple', 'mixed_berry', 'chocolate', 'vanilla',
  'salted', 'unsalted', 'fine_sugar', 'coarse_sugar'
])

function toLatinDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

function stripRetailPromoNoiseForFingerprint(text: string): string {
  return text
    // Strip N+M / N+M Free promotional bonus badges (EN & AR, including compacted "(3+7مجاناً)" or standalone "7+3")
    .replace(/\d+\s*\+\s*\d+(?:\s*(?:free|bonus|extra|مجاناً|مجانا|مجان))?/gi, ' ')
    // Strip explicit retail multi-buy & BXGY promo wording without disturbing factory multipack counts (e.g. "10x130")
    .replace(/\b(?:buy|get)\s*\d+(?:\s*(?:get\s*\d+\s*)?(?:pcs?|pieces?|items?|units?|free|bonus))?/gi, ' ')
    .replace(/\b\d+\s*for(?:\s*(?:sar\s*)?\d+(?:\.\d+)?)?\b/gi, ' ')
    // Strip quantity limits & loyalty/member noise while keeping nutrition/product attributes ("sugar free", "free range", etc.)
    .replace(/\b(?:limit|max|maximum)(?:\s*\d+)?(?:\s*per\s*(?:customer|person|household|member|card|receipt))?\b/gi, ' ')
    .replace(/\bper\s*(?:customer|person|household|member|card|receipt)\b/gi, ' ')
    .replace(/\b(?:loyalty(?:\s*(?:card|member|members|program|only))?|member\s*(?:price|only)|iktissab|club\s*card)\b/gi, ' ')
    .replace(/(?<!\b(?:sugar|fat|trans\s*fat|gluten|lactose|caffeine|fragrance|scent|dairy|nut|soy|egg|cholesterol|alcohol|salt|sodium|bpa|paraben|sulfate|dye|phosphate|soap)[-\s])\bfree(?!\s+range\b)\b/gi, ' ')
    // Arabic promo / bonus / customer-limit / loyalty noise
    .replace(/عرض\s*\d*(?:\s*(?:حبات|حبة|قطع|قطعة))?/g, ' ')
    .replace(/اشتري\s*\d+(?:\s*(?:و\s*)?احصل\s*على\s*\d+(?:\s*(?:مجاناً|مجانا|مجان))?)?/g, ' ')
    .replace(/\d+\s*(?:حبات|حبة|قطع|قطعة)?\s*بسعر(?:\s*\d+(?:\.\d+)?)?/g, ' ')
    .replace(/(?:ب?حد\s*(?:أقصى|اقصى)|لكل\s*(?:عميل|فرد|متسوق|عائلة|عضو)|للفرد|للعميل|بطاقة\s*(?:الولاء|العضوية|اكتساب)|أعضاء\s*الولاء|اعضاء\s*الولاء|مجاناً|مجانا|مجان|مجاني|هدية)/g, ' ')
}

function tokenizeCoreWords(
  textEn: string | null | undefined,
  textAr: string | null | undefined,
  brandEn?: string | null,
  brandAr?: string | null
): { enTokens: string[]; arTokens: string[]; concepts: Set<string> } {
  const stopWords = new Set([
    'g', 'gm', 'gms', 'gram', 'grams', 'kg', 'kgs', 'kilo', 'ml', 'l', 'ltr', 'pack', 'pcs', 'pc',
    'piece', 'pieces', 'promo', 'offer', 'buy', 'for', 'per', 'each', 'carton', 'bag', 'bottle',
    'can', 'box', 'whole', 'the', 'and', 'with', 'in', 'of',
    'bonus', 'extra', 'plus', 'limit', 'max', 'maximum', 'customer', 'household', 'member', 'members',
    'loyalty', 'card', 'only', 'save', 'saver', 'discount', 'special', 'get',
    'جم', 'جرام', 'كجم', 'كيلو', 'مل', 'لتر', 'حبه', 'حبات', 'عرض', 'قطع', 'قطعه', 'كرتون', 'كيس', 'علبه', 'كامل', 'كامله', 'من', 'مع', 'في',
    'مجان', 'مجانا', 'مجاني', 'هديه', 'اضافي', 'حد', 'اقصى', 'للفرد', 'للعميل', 'عميل', 'بطاقه', 'ولاء', 'الولاء', 'عضويه', 'العضويه', 'فقط', 'توفير', 'خصم'
  ])

  const brandStop = new Set<string>()
  for (const b of [brandEn, brandAr]) {
    const cleanB = normalizeSearchText(normalizeArabicText(toLatinDigits(b || '')) || toLatinDigits(b || ''))
    if (cleanB) cleanB.split(' ').forEach((t) => brandStop.add(t))
  }

  const promoStrippedEn = stripRetailPromoNoiseForFingerprint(toLatinDigits(normalizeEnglishText(textEn) || ''))
  const promoStrippedAr = stripRetailPromoNoiseForFingerprint(normalizeArabicText(toLatinDigits(textAr || '')) || '')
  const cleanEn = normalizeSearchText(promoStrippedEn) || ''
  const cleanAr = normalizeSearchText(promoStrippedAr) || ''

  const stripNoise = (tokens: string[]) =>
    tokens.filter((t) => {
      if (!t || stopWords.has(t) || brandStop.has(t)) return false
      if (/^\d+(?:\.\d+)?$/.test(t)) return false
      if (/^\d+\s*[x×]\s*\d+$/i.test(t)) return false
      if (/^\d+(?:\.\d+)?(?:g|gm|gms|kg|ml|l|ltr|pcs|pc)$/i.test(t)) return false
      return t.length >= 2
    })

  const enTokens = stripNoise(cleanEn.split(' '))
  const arTokens = stripNoise(cleanAr.split(' '))
  const allJoined = `${cleanEn} ${cleanAr}`

  const concepts = new Set<string>()
  for (const grp of CONCEPT_GROUPS) {
    for (const term of grp.terms) {
      if (enTokens.includes(term) || arTokens.includes(term) || allJoined.includes(` ${term} `) || allJoined === term) {
        concepts.add(grp.concept)
        break
      }
    }
  }

  return { enTokens, arTokens, concepts }
}

export class TemporaryProductRegistry {
  private batchId: string
  private groups: Map<string, TemporaryProductGroup> = new Map()
  private nextSequence: number = 1

  constructor(batchId: string, initialGroups?: Record<string, TemporaryProductGroup>) {
    this.batchId = batchId
    if (initialGroups) {
      for (const [id, grp] of Object.entries(initialGroups)) {
        this.groups.set(id, { ...grp })
        const match = id.match(/_(\d+)$/)
        if (match) {
          const num = parseInt(match[1], 10)
          if (num >= this.nextSequence) {
            this.nextSequence = num + 1
          }
        }
      }
    }
  }

  /**
   * Generates a collision-resistant, deterministic temporary ID.
   * Format: t_<batchId>_<3-digit-sequence>
   */
  private generateTemporaryId(): string {
    const seqStr = String(this.nextSequence++).padStart(3, '0')
    // Sanitize batchId for safe identifier
    const safeBatchId = this.batchId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
    return `t_${safeBatchId}_${seqStr}`
  }

  /**
   * Reconciles a proposed temporary match from a Gemini request against
   * previously registered temporary products in this batch.
   */
  public reconcileTemporaryOffer(params: {
    requestTempRef: string // e.g. "t1"
    requestScopedMap: Map<string, string> // maps "t1" -> already assigned batch temporary ID for this request
    attrs: NormalizedIdentityAttributes
    sourceOffer: UnifiedBatchOffer
  }): {
    temporaryId: string
    isNewGroup: boolean
    mergedWithExisting: boolean
  } {
    const { requestTempRef, requestScopedMap, attrs, sourceOffer } = params

    // Global Identity Sufficiency Gate (§6.3, §6.4):
    // Catalog absence or model "tX" must NEVER create a temporary product for insufficient/ambiguous identities.
    const sufficiency = evaluateIdentitySufficiency(attrs, sourceOffer, attrs.evidenceAnnotation)
    if (!sufficiency.isSufficient) {
      throw new Error(
        `INSUFFICIENT_IDENTITY_FOR_TEMPORARY_PRODUCT: Refusing temporary proposal for "${attrs.productNameEn || attrs.productNameAr}" (${sufficiency.codes.join(', ')}: ${sufficiency.reasons.join(' ')})`
      )
    }

    const collisionWarnings: string[] = []

    // 1. If this request already mapped "t1" to a batch-scoped ID in the current request,
    // verify strict identity compatibility BEFORE merging so duplicate "t1" labels never corrupt distinct SKUs!
    if (requestScopedMap.has(requestTempRef)) {
      const existingBatchTempId = requestScopedMap.get(requestTempRef)!
      const group = this.groups.get(existingBatchTempId)
      if (group && this.areIdentitiesEquivalent(attrs, group)) {
        if (!group.sourceOfferKeys.includes(sourceOffer.batchOfferKey)) {
          group.sourceOfferKeys.push(sourceOffer.batchOfferKey)
        }
        if (sourceOffer.supermarketName && !group.retailers.includes(sourceOffer.supermarketName)) {
          group.retailers.push(sourceOffer.supermarketName)
        }
        group.updatedAt = new Date().toISOString()
        return { temporaryId: existingBatchTempId, isNewGroup: false, mergedWithExisting: true }
      }
      if (group) {
        collisionWarnings.push(
          `MODEL_LOCAL_TEMP_REF_COLLISION: Request reused "${requestTempRef}" for incompatible identity; routed separately by product identity.`
        )
      }
    }

    // 2. Check if any previously registered group across other requests/leaflets
    // has strictly compatible identity attributes (cross-request reconciliation)
    let matchingExistingGroup: TemporaryProductGroup | null = null

    for (const group of this.groups.values()) {
      if (this.areIdentitiesEquivalent(attrs, group)) {
        matchingExistingGroup = group
        break
      }
    }

    if (matchingExistingGroup) {
      if (!matchingExistingGroup.sourceOfferKeys.includes(sourceOffer.batchOfferKey)) {
        matchingExistingGroup.sourceOfferKeys.push(sourceOffer.batchOfferKey)
      }
      if (sourceOffer.supermarketName && !matchingExistingGroup.retailers.includes(sourceOffer.supermarketName)) {
        matchingExistingGroup.retailers.push(sourceOffer.supermarketName)
      }
      for (const warn of collisionWarnings) {
        if (!matchingExistingGroup.validationWarnings.includes(warn)) {
          matchingExistingGroup.validationWarnings.push(warn)
        }
      }
      if (!matchingExistingGroup.canonicalFingerprint) {
        matchingExistingGroup.canonicalFingerprint = this.buildCanonicalIdentityFingerprint(matchingExistingGroup)
      }
      matchingExistingGroup.updatedAt = new Date().toISOString()
      requestScopedMap.set(requestTempRef, matchingExistingGroup.temporaryId)

      return {
        temporaryId: matchingExistingGroup.temporaryId,
        isNewGroup: false,
        mergedWithExisting: true
      }
    }

    // 3. Otherwise, create a new temporary product group
    const newTempId = this.generateTemporaryId()
    const newGroup: TemporaryProductGroup = {
      temporaryId: newTempId,
      canonicalFingerprint: this.buildCanonicalIdentityFingerprint(attrs),
      brandKey: attrs.brandKey,
      brandNameAr: attrs.brandNameAr,
      brandNameEn: attrs.brandNameEn,
      productNameAr: attrs.productNameAr,
      productNameEn: attrs.productNameEn,
      variantOrFlavor: attrs.variantOrFlavor,
      fatContent: attrs.fatContent,
      eachSizeValue: attrs.eachSizeValue,
      eachSizeUnit: attrs.eachSizeUnit,
      innerPackCount: attrs.manufacturerPackCount ?? attrs.innerPackCount ?? 1,
      saleUnitType: attrs.saleUnitType || 'piece',
      productForm: attrs.productForm,
      sourceOfferKeys: [sourceOffer.batchOfferKey],
      retailers: sourceOffer.supermarketName ? [sourceOffer.supermarketName] : [],
      sampleThumbCropPath: sourceOffer.productThumbCropPath || null,
      operatorDecision: 'proposed',
      validationWarnings: [...collisionWarnings],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    this.groups.set(newTempId, newGroup)
    requestScopedMap.set(requestTempRef, newTempId)

    return {
      temporaryId: newTempId,
      isNewGroup: true,
      mergedWithExisting: false
    }
  }

  /**
   * Builds a deterministic canonical identity fingerprint shared across requests, leaflets, and bilingual titles.
   */
  public buildCanonicalIdentityFingerprint(
    input: NormalizedIdentityAttributes | TemporaryProductGroup
  ): string {
    const packCount =
      ('manufacturerPackCount' in input ? input.manufacturerPackCount : undefined) ??
      input.innerPackCount ??
      1
    let sizePart = 'nosize'
    if (input.eachSizeValue && input.eachSizeUnit) {
      let val = Number(input.eachSizeValue)
      let unit = String(input.eachSizeUnit).trim().toLowerCase()
      if (unit === 'kg' || unit === 'kilogram' || unit === 'kilograms') {
        val *= 1000
        unit = 'g'
      } else if (unit === 'l' || unit === 'ltr' || unit === 'liter' || unit === 'litre') {
        val *= 1000
        unit = 'ml'
      } else if (unit === 'gm' || unit === 'gms' || unit === 'gram' || unit === 'grams') {
        unit = 'g'
      }
      sizePart = `${Number(val.toFixed(4))}${unit}`
    }

    const { enTokens, arTokens, concepts } = tokenizeCoreWords(
      input.productNameEn,
      input.productNameAr,
      input.brandNameEn,
      input.brandNameAr
    )
    const variantStr = normalizeSearchText(toLatinDigits(input.variantOrFlavor || '')) || '-'
    const fatStr = normalizeSearchText(toLatinDigits(input.fatContent || '')) || '-'
    const formStr = normalizeSearchText(toLatinDigits(input.productForm || '')) || '-'
    const semanticPart =
      concepts.size > 0
        ? Array.from(concepts).sort().join('+')
        : [...enTokens, ...arTokens].sort().join('_') || 'unnamed'

    return `${input.brandKey}|${semanticPart}|${sizePart}_x${packCount}|v:${variantStr}|f:${fatStr}|m:${formStr}`
  }

  /**
   * Conservative equivalence comparison:
   * Returns true ONLY if brand, canonical size, pack count, variant/flavor, fat content,
   * product form/cut/state concepts, and core identity tokens/concepts strictly match.
   */
  public areIdentitiesEquivalent(
    a: NormalizedIdentityAttributes,
    b: TemporaryProductGroup
  ): boolean {
    if (!evaluateIdentitySufficiency(a, null, a.evidenceAnnotation).isSufficient) return false

    // 1. Brand must match
    if (a.brandKey !== b.brandKey) return false

    // 2. Strict size & manufacturer package compatibility (1L == 1000ml, 500g == 0.5kg; rejects 950ml vs 1L, 4x250ml vs 1L)
    const packCheck = arePackConfigsStrictlyCompatible({
      sizeValue1: a.eachSizeValue,
      sizeUnit1: a.eachSizeUnit,
      packCount1: a.manufacturerPackCount ?? a.innerPackCount ?? 1,
      sizeValue2: b.eachSizeValue,
      sizeUnit2: b.eachSizeUnit,
      packCount2: b.innerPackCount ?? 1
    })
    if (!packCheck.isCompatible) return false

    // 3. Fat content must not conflict
    const fatA = normalizeSearchText(toLatinDigits(a.fatContent || '')) || ''
    const fatB = normalizeSearchText(toLatinDigits(b.fatContent || '')) || ''
    if (fatA !== fatB) return false

    // 4. Product form must not conflict when both are specified
    const formA = normalizeSearchText(toLatinDigits(a.productForm || '')) || ''
    const formB = normalizeSearchText(toLatinDigits(b.productForm || '')) || ''
    if (formA && formB && formA !== formB) return false

    // 5. Extract core words & bilingual concepts for both identities
    const tokensA = tokenizeCoreWords(a.productNameEn, a.productNameAr, a.brandNameEn, a.brandNameAr)
    const tokensB = tokenizeCoreWords(b.productNameEn, b.productNameAr, b.brandNameEn, b.brandNameAr)

    // 6. Strict variant / flavor equality (allows bilingual equivalent concepts, forbids missing or different variants)
    const varA = normalizeSearchText(toLatinDigits(a.variantOrFlavor || '')) || ''
    const varB = normalizeSearchText(toLatinDigits(b.variantOrFlavor || '')) || ''
    if (varA || varB) {
      const varTokensA = tokenizeCoreWords(a.variantOrFlavor, a.variantOrFlavor)
      const varTokensB = tokenizeCoreWords(b.variantOrFlavor, b.variantOrFlavor)
      if (varA && varB) {
        const sameNormalizedVar = varA === varB
        const sameSingleConcept =
          varTokensA.concepts.size > 0 &&
          varTokensA.concepts.size === varTokensB.concepts.size &&
          Array.from(varTokensA.concepts).every((c) => varTokensB.concepts.has(c))
        if (!sameNormalizedVar && !sameSingleConcept) return false
      } else if (varA && !varB) {
        // Variant present on A only: permit ONLY if B's title explicitly contains those variant tokens/concepts
        const bHasVarToken =
          [...varTokensA.enTokens, ...varTokensA.arTokens].length > 0 &&
          [...varTokensA.enTokens, ...varTokensA.arTokens].every(
            (t) => tokensB.enTokens.includes(t) || tokensB.arTokens.includes(t)
          )
        const bHasVarConcept =
          varTokensA.concepts.size > 0 &&
          Array.from(varTokensA.concepts).every((c) => tokensB.concepts.has(c))
        if (!bHasVarToken && !bHasVarConcept) return false
      } else if (varB && !varA) {
        const aHasVarToken =
          [...varTokensB.enTokens, ...varTokensB.arTokens].length > 0 &&
          [...varTokensB.enTokens, ...varTokensB.arTokens].every(
            (t) => tokensA.enTokens.includes(t) || tokensA.arTokens.includes(t)
          )
        const aHasVarConcept =
          varTokensB.concepts.size > 0 &&
          Array.from(varTokensB.concepts).every((c) => tokensA.concepts.has(c))
        if (!aHasVarToken && !aHasVarConcept) return false
      }
    }

    // 7. Conflicting concept families (e.g. frozen vs fresh, breast vs strips, salted vs unsalted, fine vs coarse)
    const familyMapA = new Map<string, string>()
    const familyMapB = new Map<string, string>()
    for (const grp of CONCEPT_GROUPS) {
      if (!grp.conflictingFamily) continue
      if (tokensA.concepts.has(grp.concept)) familyMapA.set(grp.conflictingFamily, grp.concept)
      if (tokensB.concepts.has(grp.concept)) familyMapB.set(grp.conflictingFamily, grp.concept)
    }
    for (const [family, conceptA] of familyMapA.entries()) {
      const conceptB = familyMapB.get(family)
      if (conceptB && conceptB !== conceptA) return false
      // A specific poultry cut (e.g. breast, nuggets, strips) must never merge with an unspecified/whole chicken title
      if (family === 'cut' && !conceptB) return false
      // A specific grain variety (e.g. calrose, basmati) must never merge with an unspecified/generic rice title
      if (family === 'grain_variety' && !conceptB) return false
    }
    for (const [family] of familyMapB.entries()) {
      if (family === 'cut' && !familyMapA.has('cut')) return false
      if (family === 'grain_variety' && !familyMapA.has('grain_variety')) return false
    }

    // 8. Distinguishing flavor/recipe modifiers must be symmetric across both sides
    for (const mod of FLAVOR_MODIFIER_CONCEPTS) {
      if (tokensA.concepts.has(mod) !== tokensB.concepts.has(mod)) return false
    }

    // 9. Token-level same-language OR strict bilingual concept matching (never naive substring .includes())
    const tokenJaccard = (list1: string[], list2: string[]): number => {
      if (list1.length === 0 || list2.length === 0) return 0
      const s1 = new Set(list1)
      const s2 = new Set(list2)
      let inter = 0
      for (const x of s1) if (s2.has(x)) inter++
      const union = s1.size + s2.size - inter
      return union > 0 ? inter / union : 0
    }

    const enScore = tokenJaccard(tokensA.enTokens, tokensB.enTokens)
    const arScore = tokenJaccard(tokensA.arTokens, tokensB.arTokens)
    if (enScore >= 0.7 || arScore >= 0.7) {
      return true
    }

    // Bilingual fallback (e.g. English-only offer vs Arabic-only offer of same SKU):
    // Requires matching concepts without stray unmatched flavor/cut concepts
    if (tokensA.concepts.size > 0 && tokensA.concepts.size === tokensB.concepts.size) {
      const allConceptsMatch = Array.from(tokensA.concepts).every((c) => tokensB.concepts.has(c))
      if (allConceptsMatch) {
        if (tokensA.concepts.size >= 2) return true
        // Single-concept bilingual match allowed only when neither title carries unaccounted distinguishing tokens
        const aLeftover = tokensA.enTokens.length + tokensA.arTokens.length
        const bLeftover = tokensB.enTokens.length + tokensB.arTokens.length
        if (aLeftover <= 2 && bLeftover <= 2) return true
      }
    }

    return false
  }

  public getGroups(): Record<string, TemporaryProductGroup> {
    const result: Record<string, TemporaryProductGroup> = {}
    for (const [id, grp] of this.groups.entries()) {
      result[id] = { ...grp }
    }
    return result
  }

  public getGroup(temporaryId: string): TemporaryProductGroup | null {
    return this.groups.get(temporaryId) || null
  }

  public setDecision(
    temporaryId: string,
    decision: OperatorDecisionStatus,
    linkedPermanentProductId?: string | null
  ): boolean {
    const grp = this.groups.get(temporaryId)
    if (!grp) return false
    grp.operatorDecision = decision
    if (linkedPermanentProductId !== undefined) {
      grp.linkedPermanentProductId = linkedPermanentProductId
    }
    grp.updatedAt = new Date().toISOString()
    return true
  }

  public mergeGroups(sourceTempId: string, targetTempId: string): boolean {
    const src = this.groups.get(sourceTempId)
    const tgt = this.groups.get(targetTempId)
    if (!src || !tgt) return false

    // Merge source offers into target
    for (const key of src.sourceOfferKeys) {
      if (!tgt.sourceOfferKeys.includes(key)) {
        tgt.sourceOfferKeys.push(key)
      }
    }
    for (const ret of src.retailers) {
      if (!tgt.retailers.includes(ret)) {
        tgt.retailers.push(ret)
      }
    }
    tgt.operatorDecision = 'merged'
    tgt.updatedAt = new Date().toISOString()

    // Delete source
    this.groups.delete(sourceTempId)
    return true
  }

  public splitGroup(temporaryId: string, offerKeysToExtract: string[]): string | null {
    const grp = this.groups.get(temporaryId)
    if (!grp || offerKeysToExtract.length === 0) return null

    // Remove from existing
    grp.sourceOfferKeys = grp.sourceOfferKeys.filter((k) => !offerKeysToExtract.includes(k))
    grp.updatedAt = new Date().toISOString()

    // Create new group
    const newId = this.generateTemporaryId()
    const newGrp: TemporaryProductGroup = {
      ...grp,
      temporaryId: newId,
      sourceOfferKeys: offerKeysToExtract,
      operatorDecision: 'split',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    this.groups.set(newId, newGrp)
    return newId
  }
}
