/**
 * WIFRAN-EXTRACTOR-IDENTITY-005D (WP4 Stage 1)
 * Deterministic Evidence-Aware V3 Normalization & Safe Parent-Child Decomposition Engine.
 *
 * Strictly offline & deterministic. Never mutates original extraction evidence or
 * invokes live Gemini APIs / production DB writes.
 */

import {
  DecomposedSubItemCandidateV3,
  DecompositionBasisV3,
  OfferContractV3Record,
  SubItemV3,
  V3CanonicalOrExtendedUnit,
  V3ConflictCode,
  V3DecompositionResult
} from '../../shared/types/extractorContractV3';
import {
  canonicalizeUnit,
  detectItemDomainFromTitle
} from '../../shared/utils/priceAndUnitNormalizer';
import {
  assessOfferQuantitySemanticsConflict,
  isValidCalendarDateIso
} from '../../shared/utils/nonCatalogPublicationPolicy';

export const FACTUAL_PUBLICATION_CONFLICT_CODES = new Set<V3ConflictCode>([
  'PRICE_ROLE_AMBIGUOUS',
  'EN_AR_WEIGHT_VOLUME_CONFLICT',
  'EN_AR_PACK_COUNT_CONFLICT',
  'TEXT_VS_IMAGE_CONFLICT',
  'PROMO_QTY_VS_MFG_PACK_CONFLICT',
  'COMPOUND_SHARED_CAPTION_CONFLICT'
]);

export const IDENTITY_GAP_CONFLICT_CODES = new Set<V3ConflictCode>([
  'MISSING_CRITICAL_IDENTITY_ATTRIBUTES',
  'INCOMPLETE_VISIBLE_ASSORTMENT',
  'UNLABELED_SWATCH_OR_BOTTLE_VARIANTS',
  'RETAILER_SKU_WITHOUT_VARIANT_NAMES',
  'WEIGHT_RANGE_UNPAIRED'
]);

const CHECKOUT_PROMO_PHRASE_REGEX =
  /\b(?:at\s+checkout|checkout\s+promo|buy\s+\d+\s+get\s+\d+|max\s+\d+\s+per\s+customer|customer\s+limit)\b|عند\s*الدفع|اشتري\s*\d+\s*واحصل/i;

const POSITIVE_BONUS_PACK_TEXT_REGEX =
  /\b\d+\s*\+\s*\d+\s*(?:free|bonus|مجانا)?\b|\+\s*\d+\s*(?:free|مجانا)\b|factory\s*bonus|عبوة\s*مجانية/i;

const POSITIVE_MULTIPACK_TEXT_REGEX =
  /\b\d+\s*[x×*]\s*\d+|\d+(?:[.,،٫]\d+)?\s*(?:ml|l|ltr|litre|liter|g|gm|gms|gram|kg|pcs|مل|لتر|جم|جرام|كجم)?\s*[x×*]\s*\d+|\b\d+\s*\+\s*\d+\b|\b(?:pack\s+of\s+\d+|multipack|carton)\b|شد|كرتون/i;

const POSITIVE_PACKAGING_EVIDENCE_TYPES = new Set([
  'manufacturer_packaging_marking',
  'printed_package_label',
  'printed_leaflet_text',
  'verified_operator_correction'
]);

const CHILD_OVERRIDE_EVIDENCE_TYPES = new Set([
  'printed_package_label',
  'visible_variant_label',
  'manufacturer_packaging_marking',
  'verified_operator_correction'
]);

const NON_DECOMPOSABLE_COMMODITY_DOMAINS = new Set([
  'fresh_loose',
  'bakery_inhouse',
  'electronics',
  'appliance',
  'textiles_home',
  'other_non_grocery'
]);

const RANGE_SIZE_REGEX =
  /\b\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|ml|l|lt|ltr|pcs)\b/i;

const LIQUID_OR_BEVERAGE_KEYWORD_REGEX =
  /(?:\b(?:coca[\s-]?cola|cola|pepsi|soda|juice|nectar|milk|water|oil|shampoo|detergent|bleach|drink|beverage|tea)\b|كوكا\s*كولا|بيبسي|عصير|حليب|لبن|مياه|زيت|شامبو)/i;

const PLACEHOLDER_VARIANTS_REGEX =
  /^(?:assorted|asstd|various|mixed|منوع|منوعة|مشكل|option\s*\d+|sku\s*\d+|variant\s*\d+)$/i;

const GENERIC_INFERRED_VARIANT_REGEX =
  /^(?:automatic|original|normal|regular|classic|standard|basic|أوتوماتيك|اتوماتيك|عادي|أصلي|كلاسيك)$/i;

const ASSORTED_DIETARY_ONLY_VARIANT_REGEX =
  /^(?:automatic|original|normal|regular|classic|standard|basic|zero\s*sugar|sugar\s*free|no\s*added\s*sugar|no\s*sugar|diet|light|lite|low\s*fat|أوتوماتيك|اتوماتيك|عادي|أصلي|كلاسيك|زيرو\s*سكر|بدون\s*سكر|خالي\s*من\s*السكر|دايت|لايت|قليل\s*الدسم)$/i;

const EGG_PRODUCT_REGEX = /(?:^|[^\p{L}\p{N}])(?:eggs?|بيض(?:ة)?)(?=$|[^\p{L}\p{N}])/iu;
const MULTI_TRAY_BUNDLE_REGEX =
  /\b\d+\s*[x×*]\s*(?:15|20|24|30|36)\b|كرتون|\d+\s*(?:trays?|اطباق|أطباق)/iu;

const TITLE_ASSORTMENT_MARKER_REGEX =
  /(?:^|[^\p{L}\p{N}])(?:assorted|asstd|متنوع|منوع|مشكل)(?=$|[^\p{L}\p{N}])/iu;

const CHECKOUT_PCS_MULTIBUY_REGEX =
  /(?:^|[^\p{L}\p{N}])(\d{1,2})\s*(?:pcs?|pieces?|حبات|حبة)(?=$|[^\p{L}\p{N}])/iu;

function toLatinDigitsSimple(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function normalizeTokenText(s: string | null | undefined): string {
  return toLatinDigitsSimple(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function textContainsTokenPhrase(haystackNorm: string, needleRaw: string | null | undefined): boolean {
  const needleNorm = normalizeTokenText(needleRaw);
  if (!needleNorm || needleNorm.length < 2) return false;
  if (haystackNorm.includes(needleNorm)) return true;
  const words = needleNorm.split(' ').filter((w) => w.length >= 3);
  return words.length > 0 && words.every((w) => haystackNorm.includes(w));
}

function extractExplicitCaptionAlternatives(card: OfferContractV3Record): string[] {
  const rawTitleEn = toLatinDigitsSimple(card.source_card.raw_text.title_en || '');
  if (!rawTitleEn) return [];
  // Strip parenthesized size expressions like "(12 x 150ml)" or "(400gm ...)"
  const parenContentMatches: string[] = [];
  const withoutParens = rawTitleEn.replace(/\(([^)]+)\)/g, (_m, inner: string) => {
    if (inner.includes('/') && !/^\s*\d/.test(inner.trim())) {
      parenContentMatches.push(inner);
    }
    return ' ';
  });

  const candidateChunks = parenContentMatches.length > 0 ? parenContentMatches : [withoutParens];
  const results = new Set<string>();

  for (const chunk of candidateChunks) {
    if (!/[\/]|(?:\s+or\s+)/i.test(chunk)) continue;
    const rawParts = chunk.split(/\s*\/\s*|\s+\bor\b\s+/i);
    if (rawParts.length < 2) continue;

    for (const part of rawParts) {
      let cleaned = part
        .replace(/\b\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|mg|ml|l|lt|ltr|pcs|roll|sheet)\b/gi, '')
        .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|mg|ml|l|lt|ltr|pcs|roll|sheet|oz)\b/gi, '')
        .replace(/\b(?:asstd\.?|assorted|drinking|mineral|water|noodles?|pasta|rice|basmati|shampoo|detergent|powder|gel|ice\s*cream|oil)\b/gi, '')
        .trim();
      cleaned = cleaned.replace(/^[-–:,\s]+|[-–:,\s]+$/g, '');
      const norm = normalizeTokenText(cleaned);
      if (norm && norm.length >= 2 && !/^\d+$/.test(norm)) {
        results.add(norm);
      }
    }
  }
  return Array.from(results);
}

function isCatalogSafeSizeUnit(unit: V3CanonicalOrExtendedUnit | null): boolean {
  if (!unit) return false;
  return unit === 'g' || unit === 'kg' || unit === 'ml' || unit === 'l' || unit === 'pcs' || unit === 'roll' || unit === 'sheet';
}

function resolveEffectiveFieldValue(
  card: OfferContractV3Record,
  fieldPath: string,
  fallbackValue: string | number | boolean | null
): { value: string | number | boolean | null; hasOperatorOverride: boolean } {
  const matching = card.evidence_ledger.find(
    (entry) => entry.target_field === fieldPath && entry.operator_correction
  );
  if (matching && matching.operator_correction) {
    return {
      value: matching.operator_correction.corrected_value,
      hasOperatorOverride: true
    };
  }
  return {
    value: fallbackValue,
    hasOperatorOverride: false
  };
}

/**
 * Normalizes a V3 offer card without overwriting `evidence_ledger[].extracted_value`
 * or `original_source_evidence`, and evaluates domain, price/currency, EN/AR quantity,
 * compound shared-caption, and assortment conflicts.
 */
export function normalizeV3OfferCard(card: OfferContractV3Record): {
  normalizedCard: OfferContractV3Record;
  conflictCodes: V3ConflictCode[];
  notes: string[];
} {
  const conflicts = new Set<V3ConflictCode>(
    (card.evidence_conflicts || []).filter((code) => code !== 'CURRENCY_UNVERIFIED_OR_CONFLICT')
  );
  for (const pc of card.pricing.price_conflict_flags || []) {
    if (pc !== 'CURRENCY_UNVERIFIED_OR_CONFLICT') {
      conflicts.add(pc);
    }
  }
  const notes: string[] = [];

  // Apply non-destructive operator corrections (original values remain intact in evidence_ledger)
  const promoOverride = resolveEffectiveFieldValue(card, 'pricing.promo_price', card.pricing.promo_price);

  const effectivePromoPrice =
    typeof promoOverride.value === 'number' ? promoOverride.value : card.pricing.promo_price;
  // Wifran MVP: Currency is strictly fixed internal 'SAR' (not extracted from Gemini).
  const normalizedCurrency = 'SAR';

  // 1. Price & currency integrity (§4)
  if (effectivePromoPrice === null || !(effectivePromoPrice > 0)) {
    conflicts.add('PRICE_ROLE_AMBIGUOUS');
    notes.push('Promotional price is missing or non-positive.');
  }
  if (card.pricing.price_role_confidence === 'conflicting' || card.pricing.price_role_confidence === 'low') {
    conflicts.add('PRICE_ROLE_AMBIGUOUS');
    notes.push(
      `Price role confidence flagged as "${card.pricing.price_role_confidence}" between promotional and regular price.`
    );
  }
  if (
    card.pricing.price_basis === 'unknown' ||
    (card.pricing.price_basis === 'buy_n' &&
      !(card.quantity_and_promo.retailer_checkout_multibuy_qty && card.quantity_and_promo.retailer_checkout_multibuy_qty >= 2) &&
      !(card.pricing.promo_conditions && card.pricing.promo_conditions.trim())) ||
    (card.quantity_and_promo.sale_basis === 'buy_x_get_y_checkout' &&
      !(card.quantity_and_promo.retailer_checkout_multibuy_qty && card.quantity_and_promo.retailer_checkout_multibuy_qty >= 2) &&
      !(card.pricing.promo_conditions && card.pricing.promo_conditions.trim()))
  ) {
    conflicts.add('PRICE_ROLE_AMBIGUOUS');
    notes.push(
      `Conditional or ambiguous price basis ("${card.pricing.price_basis}" / "${card.quantity_and_promo.sale_basis}") lacks required structured conditions and must remain in review.`
    );
  }
  if (
    effectivePromoPrice !== null &&
    card.pricing.original_price !== null &&
    card.pricing.original_price <= effectivePromoPrice &&
    !promoOverride.hasOperatorOverride
  ) {
    conflicts.add('PRICE_ROLE_AMBIGUOUS');
    notes.push('Original price is less than or equal to promotional price.');
  }

  // Validate calendar dates if provided (never synthesize dates from now())
  if (card.source_card.offer_start_date && !isValidCalendarDateIso(card.source_card.offer_start_date)) {
    conflicts.add('PRICE_ROLE_AMBIGUOUS');
    notes.push(`Invalid offer_start_date "${card.source_card.offer_start_date}".`);
  }
  if (card.source_card.offer_end_date && !isValidCalendarDateIso(card.source_card.offer_end_date)) {
    conflicts.add('PRICE_ROLE_AMBIGUOUS');
    notes.push(`Invalid offer_end_date "${card.source_card.offer_end_date}".`);
  }
  if (
    card.source_card.offer_start_date &&
    card.source_card.offer_end_date &&
    isValidCalendarDateIso(card.source_card.offer_start_date) &&
    isValidCalendarDateIso(card.source_card.offer_end_date) &&
    card.source_card.offer_end_date < card.source_card.offer_start_date
  ) {
    conflicts.add('PRICE_ROLE_AMBIGUOUS');
    notes.push(`offer_end_date (${card.source_card.offer_end_date}) precedes offer_start_date (${card.source_card.offer_start_date}).`);
  }

  // 2. Domain classification & grocery consumer boundary (§2E, §9, §12)
  const titleEn = card.source_card.raw_text.title_en || '';
  const titleAr = card.source_card.raw_text.title_ar || '';
  const detectedDomain = detectItemDomainFromTitle(
    titleEn,
    titleAr,
    card.non_grocery_specs.domain,
    card.category_evidence
      ? {
          commodityTag: card.category_evidence.commodity_tag ?? null,
          categoryHint: card.category_evidence.category_hint ?? null
        }
      : null
  );

  let effectiveDomain = card.non_grocery_specs.domain;
  if (
    detectedDomain === 'electronics' ||
    detectedDomain === 'appliance' ||
    detectedDomain === 'other_non_grocery'
  ) {
    if (effectiveDomain === 'grocery' || effectiveDomain === 'household' || effectiveDomain === 'personal_care') {
      effectiveDomain = detectedDomain === 'other_non_grocery' && /sheet|شرشف|blanket|towel|pillow/i.test(`${titleEn} ${titleAr}`)
        ? 'textiles_home'
        : detectedDomain;
    }
  }
  const excludedFromGroceryFeed =
    effectiveDomain === 'electronics' ||
    effectiveDomain === 'appliance' ||
    effectiveDomain === 'textiles_home' ||
    effectiveDomain === 'other_non_grocery';

  // 3. Weight, volume & pack conflict checks (§2D & WP2-R1 parity + WP5F-D egg tray semantics)
  const isEggProduct = EGG_PRODUCT_REGEX.test(
    `${titleEn} ${titleAr} ${card.sub_items.map((s) => `${s.product_name_en || ''} ${s.product_name_ar || ''}`).join(' ')}`
  );
  const rawCombinedPromoAndTitle = toLatinDigitsSimple(
    [
      titleEn,
      titleAr,
      card.source_card.raw_text.size_text || '',
      card.source_card.raw_text.promo_badge_text || '',
      ...(card.source_card.raw_text.price_text_candidates || [])
    ]
      .join(' ')
      .trim()
  );

  const isSingleEggTrayMisclassifiedAsMultipack =
    isEggProduct &&
    card.quantity_and_promo.each_size_unit === 'pcs' &&
    card.quantity_and_promo.each_size_value !== null &&
    card.quantity_and_promo.each_size_value >= 6 &&
    (card.quantity_and_promo.manufacturer_pack_count === card.quantity_and_promo.each_size_value ||
      card.quantity_and_promo.manufacturer_pack_count === 1 ||
      card.quantity_and_promo.manufacturer_pack_count === null) &&
    !MULTI_TRAY_BUNDLE_REGEX.test(toLatinDigitsSimple(rawCombinedPromoAndTitle));

  const effectiveMfgPackCount = isSingleEggTrayMisclassifiedAsMultipack
    ? 1
    : card.quantity_and_promo.manufacturer_pack_count;
  const effectiveSaleBasis = isSingleEggTrayMisclassifiedAsMultipack
    ? 'piece_or_tray'
    : card.quantity_and_promo.sale_basis;
  const effectivePriceBasis =
    isSingleEggTrayMisclassifiedAsMultipack && card.pricing.price_basis === 'per_pack'
      ? 'each'
      : card.pricing.price_basis;

  const sizeTextCombined = `${card.source_card.raw_text.size_text || ''} ${titleEn} ${titleAr}`.trim();
  if (RANGE_SIZE_REGEX.test(sizeTextCombined) && card.sub_items.some((s) => !s.each_size_value)) {
    conflicts.add('WEIGHT_RANGE_UNPAIRED');
    notes.push('Range weight detected without explicit per-child package weights.');
  }

  if (titleEn && titleAr) {
    const qtyConflict = assessOfferQuantitySemanticsConflict({
      titleEn,
      titleAr,
      inner_pack_count: effectiveMfgPackCount,
      each_size_value: card.quantity_and_promo.each_size_value,
      each_size_unit: card.quantity_and_promo.each_size_unit
    });
    if (qtyConflict.conflictKind === 'pack_count_conflict') {
      conflicts.add('EN_AR_PACK_COUNT_CONFLICT');
      notes.push(qtyConflict.reason || 'EN/AR pack count conflict detected.');
    } else if (qtyConflict.conflictKind === 'unit_or_measure_conflict') {
      conflicts.add('EN_AR_WEIGHT_VOLUME_CONFLICT');
      notes.push(qtyConflict.reason || 'EN/AR weight or volume unit conflict detected.');
    }
  }

  // Never allow checkout promo qty alone to stand in as manufacturer pack count without sealed multipack evidence
  if (
    card.quantity_and_promo.retailer_checkout_multibuy_qty !== null &&
    effectiveMfgPackCount !== null &&
    effectiveMfgPackCount === card.quantity_and_promo.retailer_checkout_multibuy_qty &&
    (effectiveSaleBasis === 'single_unit' ||
      effectiveSaleBasis === 'multi_buy_checkout' ||
      effectiveSaleBasis === 'buy_x_get_y_checkout')
  ) {
    conflicts.add('PROMO_QTY_VS_MFG_PACK_CONFLICT');
    notes.push('Checkout multibuy offer cannot populate manufacturer_pack_count without sealed multipack evidence.');
  }

  // 3B. Evidence-ledger verification for factory bonus (5+1 Free), sealed multipack, EN/AR conflicts, and shared captions (§4)

  for (const entry of card.evidence_ledger) {
    if (entry.operator_correction) continue;

    if (entry.evidence_type === 'conflicting_text_descriptions') {
      const targetLower = entry.target_field.toLowerCase();
      if (targetLower.includes('currency')) {
        continue;
      }
      if (targetLower.includes('pack') || targetLower.includes('count')) {
        conflicts.add('EN_AR_PACK_COUNT_CONFLICT');
      } else if (targetLower.includes('price')) {
        conflicts.add('PRICE_ROLE_AMBIGUOUS');
      } else {
        conflicts.add('EN_AR_WEIGHT_VOLUME_CONFLICT');
      }
      notes.push(`Evidence ledger flagged conflicting descriptions on "${entry.target_field}".`);
    }

    const targetsPackField =
      entry.target_field.includes('manufacturer_pack_count') ||
      entry.target_field.includes('factory_bonus') ||
      entry.target_field === 'quantity_and_promo';

    if (targetsPackField) {
      if (CHECKOUT_PROMO_PHRASE_REGEX.test(entry.original_source_evidence || '') &&
        (effectiveSaleBasis === 'factory_bonus_pack' ||
          effectiveSaleBasis === 'sealed_multipack' ||
          (effectiveMfgPackCount ?? 0) > 1)
      ) {
        conflicts.add('PROMO_QTY_VS_MFG_PACK_CONFLICT');
        notes.push('Evidence ledger indicates checkout promotion rather than sealed manufacturer pack.');
      }

      if (
        entry.target_field === 'quantity_and_promo.manufacturer_pack_count' &&
        typeof entry.extracted_value === 'number' &&
        effectiveMfgPackCount !== null &&
        entry.extracted_value !== effectiveMfgPackCount &&
        !isSingleEggTrayMisclassifiedAsMultipack
      ) {
        conflicts.add('PROMO_QTY_VS_MFG_PACK_CONFLICT');
        notes.push(
          `Evidence ledger manufacturer_pack_count (${entry.extracted_value}) contradicts structured field (${effectiveMfgPackCount}).`
        );
      }

      if (
        entry.target_field === 'quantity_and_promo.manufacturer_pack_count' &&
        (entry.confidence === 'low' || entry.confidence === 'uncertain')
      ) {
        conflicts.add('PROMO_QTY_VS_MFG_PACK_CONFLICT');
        notes.push('Evidence ledger packaging evidence has low/uncertain confidence.');
      }
    }

    if (entry.evidence_type === 'source_card_shared_caption') {
      const targetPrefix = entry.target_field.split('.').slice(0, 2).join('.');
      const hasIndependentChildOverride = card.evidence_ledger.some(
        (other) =>
          other !== entry &&
          CHILD_OVERRIDE_EVIDENCE_TYPES.has(other.evidence_type) &&
          (other.confidence === 'high' || other.confidence === 'medium') &&
          (other.target_field.startsWith('sub_items') ||
            other.target_field.startsWith(targetPrefix) ||
            other.target_field === entry.target_field)
      );
      if (!hasIndependentChildOverride) {
        conflicts.add('COMPOUND_SHARED_CAPTION_CONFLICT');
        notes.push(
          `Shared caption evidence on "${entry.target_field}" lacks independent child-specific packaging evidence.`
        );
      }
    }
  }

  // Factory bonus pack (e.g., 5+1 Free) MUST NOT self-verify without arithmetic consistency + source packaging evidence
  if (effectiveSaleBasis === 'factory_bonus_pack') {
    const paid = card.quantity_and_promo.factory_bonus_paid_qty;
    const free = card.quantity_and_promo.factory_bonus_free_qty;
    const mfgPack = effectiveMfgPackCount;
    const arithmeticValid =
      paid !== null && free !== null && paid >= 1 && free >= 1 && mfgPack !== null && paid + free === mfgPack;

    const hasLedgerBonusSupport = card.evidence_ledger.some(
      (entry) =>
        POSITIVE_PACKAGING_EVIDENCE_TYPES.has(entry.evidence_type) &&
        (entry.confidence === 'high' || entry.confidence === 'medium') &&
        !CHECKOUT_PROMO_PHRASE_REGEX.test(entry.original_source_evidence || '') &&
        (entry.target_field.includes('factory_bonus') ||
          entry.target_field.includes('manufacturer_pack_count') ||
          POSITIVE_BONUS_PACK_TEXT_REGEX.test(entry.original_source_evidence || ''))
    );
    const hasRawTextBonusSupport =
      POSITIVE_BONUS_PACK_TEXT_REGEX.test(rawCombinedPromoAndTitle) &&
      !CHECKOUT_PROMO_PHRASE_REGEX.test(rawCombinedPromoAndTitle);

    if (!arithmeticValid || (!hasLedgerBonusSupport && !hasRawTextBonusSupport)) {
      conflicts.add('PROMO_QTY_VS_MFG_PACK_CONFLICT');
      notes.push(
        'factory_bonus_pack requires valid paid+free sum and non-checkout source packaging evidence in evidence_ledger[] or printed text.'
      );
    }
  }

  // Sealed multipack (>1) MUST NOT self-verify when neither printed text nor packaging evidence ledger supports it
  if (
    !isSingleEggTrayMisclassifiedAsMultipack &&
    effectiveSaleBasis === 'sealed_multipack' &&
    (effectiveMfgPackCount ?? 0) > 1
  ) {
    const hasLedgerMultipackSupport = card.evidence_ledger.some(
      (entry) =>
        POSITIVE_PACKAGING_EVIDENCE_TYPES.has(entry.evidence_type) &&
        (entry.confidence === 'high' || entry.confidence === 'medium') &&
        !CHECKOUT_PROMO_PHRASE_REGEX.test(toLatinDigitsSimple(entry.original_source_evidence || '')) &&
        (entry.target_field.includes('manufacturer_pack_count') ||
          POSITIVE_MULTIPACK_TEXT_REGEX.test(toLatinDigitsSimple(entry.original_source_evidence || '')))
    );
    const hasRawMultipackSupport =
      POSITIVE_MULTIPACK_TEXT_REGEX.test(rawCombinedPromoAndTitle) &&
      !CHECKOUT_PROMO_PHRASE_REGEX.test(rawCombinedPromoAndTitle);

    if (!hasLedgerMultipackSupport && !hasRawMultipackSupport) {
      conflicts.add('PROMO_QTY_VS_MFG_PACK_CONFLICT');
      notes.push(
        'sealed_multipack requires printed multipack markings or supporting packaging evidence in evidence_ledger[].'
      );
    }
  }

  // Price-as-pack-count trap: refuse manufacturer_pack_count > 1 when it matches price integers
  // (e.g. "5 SAR" -> pack=5, "9.99 SAR" -> pack=9) or single_unit without multipack markings
  const hasExplicitMultipackOrBonusSupport =
    (POSITIVE_MULTIPACK_TEXT_REGEX.test(rawCombinedPromoAndTitle) &&
      !CHECKOUT_PROMO_PHRASE_REGEX.test(rawCombinedPromoAndTitle)) ||
    card.evidence_ledger.some(
      (entry) =>
        POSITIVE_PACKAGING_EVIDENCE_TYPES.has(entry.evidence_type) &&
        (entry.confidence === 'high' || entry.confidence === 'medium') &&
        !CHECKOUT_PROMO_PHRASE_REGEX.test(toLatinDigitsSimple(entry.original_source_evidence || '')) &&
        (entry.target_field.includes('manufacturer_pack_count') ||
          entry.target_field.includes('factory_bonus') ||
          POSITIVE_MULTIPACK_TEXT_REGEX.test(toLatinDigitsSimple(entry.original_source_evidence || '')))
    );

  const mfgPackCount = effectiveMfgPackCount;
  if (mfgPackCount !== null && mfgPackCount > 1 && !hasExplicitMultipackOrBonusSupport) {
    const matchesPromoPriceInt =
      effectivePromoPrice !== null &&
      (mfgPackCount === Math.round(effectivePromoPrice) || mfgPackCount === Math.floor(effectivePromoPrice));
    const matchesOrigPriceInt =
      card.pricing.original_price !== null &&
      (mfgPackCount === Math.round(card.pricing.original_price) ||
        mfgPackCount === Math.floor(card.pricing.original_price));
    const matchesCandidatePriceInt = (card.source_card.raw_text.price_text_candidates || []).some((rawCand) => {
      const n = Number(rawCand);
      return Number.isFinite(n) && (mfgPackCount === Math.round(n) || mfgPackCount === Math.floor(n));
    });

    if (
      effectiveSaleBasis === 'single_unit' ||
      matchesPromoPriceInt ||
      matchesOrigPriceInt ||
      matchesCandidatePriceInt
    ) {
      conflicts.add('PROMO_QTY_VS_MFG_PACK_CONFLICT');
      notes.push(
        `manufacturer_pack_count (${mfgPackCount}) lacks multipack packaging evidence and appears confused with promo price/single_unit.`
      );
    }
  }

  // 4. Compound card shared-caption check (§7)
  if (card.compound_card_context) {
    const inherited = card.compound_card_context.inherited_caption_attributes_requiring_override || [];
    if (
      inherited.length > 0 &&
      card.quantity_and_promo.manufacturer_pack_count === null &&
      card.sub_items.length <= 1
    ) {
      conflicts.add('COMPOUND_SHARED_CAPTION_CONFLICT');
      notes.push(
        `Compound card shared caption attributes (${inherited.join(', ')}) lack child-specific override.`
      );
    }
  }

  // 5. Assortment completeness checks (WP5F-B + WP5F-C)
  let resolvedAssortmentStatus = card.assortment.status;
  let resolvedIsEnumeratedComplete = card.assortment.is_enumerated_list_complete;

  if (
    card.assortment.visible_variant_count !== null &&
    card.assortment.visible_variant_count > card.sub_items.length &&
    card.assortment.status !== 'confirmed_single_sku'
  ) {
    if (card.assortment.assortment_evidence.includes('swatch_icons')) {
      conflicts.add('UNLABELED_SWATCH_OR_BOTTLE_VARIANTS');
    } else {
      conflicts.add('INCOMPLETE_VISIBLE_ASSORTMENT');
    }
    notes.push(
      `Visible variant count (${card.assortment.visible_variant_count}) exceeds identifiable sub-items (${card.sub_items.length}).`
    );
  }

  // WP5F-C: Single confirmed SKU with <=1 printed retailer SKU code should NOT trigger RETAILER_SKU_WITHOUT_VARIANT_NAMES
  const isConfirmedSingleSkuWithSingleCode =
    resolvedAssortmentStatus === 'confirmed_single_sku' &&
    card.sub_items.length <= 1 &&
    card.printed_retailer_sku_codes.length <= 1 &&
    (card.assortment.visible_variant_count === null || card.assortment.visible_variant_count <= 1) &&
    !TITLE_ASSORTMENT_MARKER_REGEX.test(`${titleEn} ${titleAr}`);

  if (
    !isConfirmedSingleSkuWithSingleCode &&
    card.printed_retailer_sku_codes.length > 0 &&
    card.sub_items.length > 0 &&
    card.sub_items.every(
      (s) =>
        (!s.variant_or_flavor || PLACEHOLDER_VARIANTS_REGEX.test(s.variant_or_flavor.trim())) &&
        Boolean(s.printed_retailer_sku_code)
    )
  ) {
    conflicts.add('RETAILER_SKU_WITHOUT_VARIANT_NAMES');
    notes.push('Printed retailer SKU codes are present without distinguishing named variants.');
  }

  // WP5F-B: Generic/inferred variant prevention, Asstd. complete-flag override, and caption-vs-image subset guard
  const isCompoundTierCard = Boolean(
    card.sub_items.length >= 2 &&
      (card.compound_card_context?.has_multiple_price_badges_in_card ||
        card.sub_items.every((s) => s.independent_promo_price !== null && s.independent_promo_price !== undefined))
  );

  if (resolvedAssortmentStatus !== 'confirmed_single_sku' && !isCompoundTierCard && card.sub_items.length >= 2) {
    const printedTextNorm = normalizeTokenText(
      [
        titleEn,
        titleAr,
        card.source_card.raw_text.size_text || '',
        card.source_card.raw_text.promo_badge_text || '',
        card.compound_card_context?.card_shared_caption_en || '',
        card.compound_card_context?.card_shared_caption_ar || ''
      ].join(' ')
    );
    const titleOnlyNorm = normalizeTokenText(`${titleEn} ${titleAr}`);
    const hasSubItemLabelLedger = card.evidence_ledger.some(
      (e) =>
        (e.evidence_type === 'printed_package_label' ||
          e.evidence_type === 'visible_variant_label' ||
          e.evidence_type === 'verified_operator_correction') &&
        e.target_field.startsWith('sub_items') &&
        (e.confidence === 'high' || e.confidence === 'medium')
    );

    const allVariantsGenericAndUngrounded =
      !hasSubItemLabelLedger &&
      card.sub_items.every(
        (s) =>
          Boolean(s.variant_or_flavor) &&
          GENERIC_INFERRED_VARIANT_REGEX.test(s.variant_or_flavor!.trim()) &&
          !textContainsTokenPhrase(printedTextNorm, s.variant_or_flavor)
      );

    const multiSkuUngroundedVariants =
      card.printed_retailer_sku_codes.length >= 2 &&
      !hasSubItemLabelLedger &&
      card.sub_items.every(
        (s) => Boolean(s.variant_or_flavor) && !textContainsTokenPhrase(printedTextNorm, s.variant_or_flavor)
      );

    if (allVariantsGenericAndUngrounded || multiSkuUngroundedVariants) {
      resolvedIsEnumeratedComplete = false;
      conflicts.add('UNLABELED_SWATCH_OR_BOTTLE_VARIANTS');
      if (card.printed_retailer_sku_codes.length >= 2) {
        conflicts.add('RETAILER_SKU_WITHOUT_VARIANT_NAMES');
      }
      notes.push(
        'Sub-item variant labels appear generically inferred from multi-SKU/bag graphics without printed caption or ledger label grounding.'
      );
    }

    const assortedMarkerPresent =
      TITLE_ASSORTMENT_MARKER_REGEX.test(`${titleEn} ${titleAr}`) ||
      TITLE_ASSORTMENT_MARKER_REGEX.test(card.source_card.raw_text.promo_badge_text || '') ||
      card.assortment.assortment_evidence.includes('assorted_badge');

    const subItemsGroundedOnlyInGenericPromoLedger =
      card.evidence_ledger.length > 0 &&
      card.sub_items.every(
        (s) =>
          s.evidence_refs.length > 0 &&
          s.evidence_refs.every((ref) => {
            const entry = card.evidence_ledger.find((e) => e.evidence_id === ref);
            return (
              Boolean(entry) &&
              !entry!.target_field.startsWith('sub_items') &&
              !textContainsTokenPhrase(
                normalizeTokenText(
                  `${entry!.extracted_value || ''} ${entry!.original_source_evidence || ''}`
                ),
                s.variant_or_flavor
              )
            );
          })
      );

    if (
      assortedMarkerPresent &&
      resolvedIsEnumeratedComplete &&
      !hasSubItemLabelLedger &&
      card.sub_items.every(
        (s) =>
          Boolean(s.variant_or_flavor) &&
          ASSORTED_DIETARY_ONLY_VARIANT_REGEX.test(s.variant_or_flavor!.trim()) &&
          !textContainsTokenPhrase(titleOnlyNorm, s.variant_or_flavor)
      ) &&
      (TITLE_ASSORTMENT_MARKER_REGEX.test(`${titleEn} ${titleAr}`) ||
        subItemsGroundedOnlyInGenericPromoLedger)
    ) {
      resolvedIsEnumeratedComplete = false;
      conflicts.add('INCOMPLETE_VISIBLE_ASSORTMENT');
      conflicts.add('UNLABELED_SWATCH_OR_BOTTLE_VARIANTS');
      notes.push(
        'Assorted/متنوع card only lists generic/dietary tier descriptors (e.g. Regular / Zero Sugar) without printed specific flavor evidence.'
      );
    }

    if (TITLE_ASSORTMENT_MARKER_REGEX.test(`${titleEn} ${titleAr}`) && resolvedIsEnumeratedComplete) {
      const hasUnlistedVariantInAsstdTitle = card.sub_items.some(
        (s) => !s.variant_or_flavor || !textContainsTokenPhrase(titleOnlyNorm, s.variant_or_flavor)
      );
      if (hasUnlistedVariantInAsstdTitle) {
        resolvedIsEnumeratedComplete = false;
        conflicts.add('INCOMPLETE_VISIBLE_ASSORTMENT');
        notes.push(
          'Title contains explicit Asstd./متنوع assortment marker while sub-item variants are not explicitly enumerated in printed title.'
        );
      }
    }
  }

  if (resolvedAssortmentStatus !== 'confirmed_single_sku' && card.sub_items.length >= 2) {
    const captionAlts = extractExplicitCaptionAlternatives(card);
    if (captionAlts.length >= 3) {
      const missingAlts = captionAlts.filter(
        (alt) =>
          !card.sub_items.some((s) =>
            textContainsTokenPhrase(
              normalizeTokenText(
                `${s.brand_en || ''} ${s.brand_ar || ''} ${s.product_name_en || ''} ${s.product_name_ar || ''} ${s.variant_or_flavor || ''}`
              ),
              alt
            )
          )
      );
      if (missingAlts.length > 0) {
        resolvedIsEnumeratedComplete = false;
        conflicts.add('INCOMPLETE_VISIBLE_ASSORTMENT');
        notes.push(
          `Printed caption enumerates options [${missingAlts.join(', ')}] omitted from sub_items[] (caption-vs-image subset mismatch).`
        );
      }
    }
  }

  // Empty sub_items[] NEVER proves confirmed_single_sku (§2B)
  if (card.assortment.status === 'confirmed_single_sku' && card.sub_items.length === 0) {
    resolvedAssortmentStatus = 'unknown_insufficient_evidence';
    conflicts.add('MISSING_CRITICAL_IDENTITY_ATTRIBUTES');
    notes.push(
      'assortment.status was confirmed_single_sku with empty sub_items[]; downgraded to unknown_insufficient_evidence.'
    );
  }

  // WP5F-F.B + WP5F-D: Sanitize Arabic-only sub-item English leaks & normalize egg trays / compound multibuy
  const isArabicOnlyCard = !card.source_card.raw_text.title_en || !card.source_card.raw_text.title_en.trim();
  const nonTitleEnglishContextNorm = normalizeTokenText(
    `${card.source_card.raw_text.promo_badge_text || ''} ${card.compound_card_context?.card_shared_caption_en || ''}`
  );
  const normalizedSubItems: SubItemV3[] = card.sub_items.map((sub, sIdx) => {
    let nextNameEn = sub.product_name_en;
    const hasNameEnCorrection = card.evidence_ledger.some(
      (e) =>
        e.operator_correction &&
        (e.target_field === `sub_items[${sIdx}].product_name_en` || e.target_field === 'sub_items.product_name_en')
    );
    if (
      isArabicOnlyCard &&
      nextNameEn &&
      nextNameEn.trim() &&
      !hasNameEnCorrection &&
      !textContainsTokenPhrase(nonTitleEnglishContextNorm, nextNameEn) &&
      normalizeTokenText(nextNameEn) !== normalizeTokenText(sub.brand_en)
    ) {
      notes.push(`Stripped ungrounded English product_name_en "${nextNameEn}" from Arabic-only sub-item ${sub.sub_item_ref}.`);
      nextNameEn = null;
    }

    let nextPackCount = sub.manufacturer_pack_count;
    if (
      isSingleEggTrayMisclassifiedAsMultipack &&
      sub.each_size_unit === 'pcs' &&
      sub.each_size_value === card.quantity_and_promo.each_size_value &&
      sub.manufacturer_pack_count === card.quantity_and_promo.each_size_value
    ) {
      nextPackCount = 1;
    }

    let nextMultibuy = sub.retailer_checkout_multibuy_qty ?? null;
    if (
      nextMultibuy === null &&
      sub.independent_promo_price !== null &&
      sub.independent_promo_price !== undefined &&
      (nextPackCount ?? 1) === 1
    ) {
      const m = CHECKOUT_PCS_MULTIBUY_REGEX.exec(
        toLatinDigitsSimple(`${sub.variant_or_flavor || ''} ${nextNameEn || ''} ${sub.product_name_ar || ''}`)
      );
      if (m && Number(m[1]) >= 2) {
        nextMultibuy = Number(m[1]);
      }
    }

    return {
      ...sub,
      product_name_en: nextNameEn,
      manufacturer_pack_count: nextPackCount,
      retailer_checkout_multibuy_qty: nextMultibuy
    };
  });

  // Deep-clone normalized copy without mutating caller's original card
  const normalizedCard: OfferContractV3Record = {
    ...card,
    assortment: {
      ...card.assortment,
      status: resolvedAssortmentStatus,
      is_enumerated_list_complete: resolvedIsEnumeratedComplete
    },
    pricing: {
      ...card.pricing,
      promo_price: effectivePromoPrice,
      currency: normalizedCurrency,
      price_basis: effectivePriceBasis,
      price_conflict_flags: Array.from(
        new Set((card.pricing.price_conflict_flags || []).filter((c) => c !== 'CURRENCY_UNVERIFIED_OR_CONFLICT'))
      )
    },
    quantity_and_promo: {
      ...card.quantity_and_promo,
      sale_basis: effectiveSaleBasis,
      manufacturer_pack_count: effectiveMfgPackCount,
      is_per_weight_pricing:
        card.quantity_and_promo.is_per_weight_pricing ||
        card.pricing.price_basis === 'per_kg' ||
        card.quantity_and_promo.sale_basis === 'weighed_per_kg'
    },
    non_grocery_specs: {
      ...card.non_grocery_specs,
      domain: effectiveDomain,
      excluded_from_default_grocery_feed: excludedFromGroceryFeed
    },
    evidence_conflicts: Array.from(conflicts),
    sub_items: normalizedSubItems
  };

  return {
    normalizedCard,
    conflictCodes: Array.from(conflicts),
    notes
  };
}

function determineDecompositionBasis(card: OfferContractV3Record): DecompositionBasisV3 {
  if (card.compound_card_context?.has_multiple_price_badges_in_card && card.sub_items.every((s) => s.independent_promo_price)) {
    return 'compound_price_tier_split';
  }
  const hasMultipleBrands =
    new Set(
      card.sub_items
        .map((s) => (s.brand_en || s.brand_ar || '').trim().toLowerCase())
        .filter(Boolean)
    ).size > 1;
  if (hasMultipleBrands) return 'multi_brand_explicit_pairs';
  if (card.assortment.assortment_evidence.includes('sku_code_list')) return 'retailer_sku_code_map';
  if (
    card.assortment.assortment_evidence.includes('slash_title') ||
    card.assortment.assortment_evidence.includes('choice_or_separator')
  ) {
    return 'explicit_text_slash';
  }
  return 'explicit_package_labels';
}

function validateChildSubItem(
  sub: SubItemV3,
  card: OfferContractV3Record
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const hasName = Boolean(
    (sub.product_name_en && sub.product_name_en.trim().length > 1) ||
      (sub.product_name_ar && sub.product_name_ar.trim().length > 1)
  );
  if (!hasName) {
    reasons.push(`${sub.sub_item_ref}: Missing product name (EN or AR).`);
  }

  const hasBrand = Boolean((sub.brand_en && sub.brand_en.trim()) || (sub.brand_ar && sub.brand_ar.trim()));
  if (!hasBrand) {
    reasons.push(`${sub.sub_item_ref}: Missing sub-item brand identity.`);
  }

  // Must not decompose into unbranded/loose produce
  const combinedSubTitle = `${sub.product_name_en || ''} ${sub.product_name_ar || ''}`.toLowerCase();
  if (
    card.quantity_and_promo.is_per_weight_pricing ||
    /\/\s*(?:kg|kilo|كيلو)\b/i.test(combinedSubTitle)
  ) {
    reasons.push(`${sub.sub_item_ref}: Loose / per-kg item is non-catalog and must not decompose.`);
  }

  if (sub.each_size_value === null || !(sub.each_size_value > 0) || !isCatalogSafeSizeUnit(sub.each_size_unit)) {
    reasons.push(`${sub.sub_item_ref}: Missing or non-catalog unit size/unit.`);
  } else if (
    sub.each_size_unit === 'pcs' &&
    sub.each_size_value <= 1 &&
    LIQUID_OR_BEVERAGE_KEYWORD_REGEX.test(combinedSubTitle)
  ) {
    reasons.push(`${sub.sub_item_ref}: Beverage/liquid expressed as <=1 pcs lacks physical volume.`);
  }

  // Strictly refuse to default unknown manufacturer pack count to 1!
  if (sub.manufacturer_pack_count === null || !(sub.manufacturer_pack_count >= 1)) {
    reasons.push(`${sub.sub_item_ref}: manufacturer_pack_count is explicitly unknown (null).`);
  }

  if (sub.unknown_attributes.length > 0 && !sub.safe_for_catalog_matching) {
    reasons.push(`${sub.sub_item_ref}: Has unknown critical attributes (${sub.unknown_attributes.join(', ')}).`);
  }

  if (sub.conflict_attributes.length > 0) {
    reasons.push(`${sub.sub_item_ref}: Has conflict attributes (${sub.conflict_attributes.join(', ')}).`);
  }

  if (!sub.safe_for_catalog_matching) {
    reasons.push(`${sub.sub_item_ref}: safe_for_catalog_matching is false.`);
  }

  if (sub.variant_or_flavor && PLACEHOLDER_VARIANTS_REGEX.test(sub.variant_or_flavor.trim())) {
    reasons.push(`${sub.sub_item_ref}: Placeholder variant "${sub.variant_or_flavor}" lacks distinguishing identity.`);
  }

  // SKU code alone without real product name/variant or distinguishing attribute cannot support safe decomposition
  if (
    sub.printed_retailer_sku_code &&
    !sub.variant_or_flavor &&
    !hasBrand
  ) {
    reasons.push(`${sub.sub_item_ref}: Retailer SKU code lacks distinguishing product/variant identity.`);
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

/**
 * Deterministically decomposes a normalized V3 source offer card into catalog-matchable
 * `DecomposedSubItemCandidateV3[]` ONLY when all 7 decomposition criteria are satisfied.
 */
export function decomposeV3OfferCard(rawCard: OfferContractV3Record): V3DecompositionResult {
  const { normalizedCard, conflictCodes, notes } = normalizeV3OfferCard(rawCard);
  const parentId = normalizedCard.source_card.source_offer_id;
  const domain = normalizedCard.non_grocery_specs.domain;
  const rejectionReasons: string[] = [...notes];

  if (normalizedCard.non_grocery_specs.excluded_from_default_grocery_feed) {
    const hasNonGroceryNote = rejectionReasons.some((r) => /non[-_\s]?grocery|excluded/i.test(r));
    if (!hasNonGroceryNote) {
      rejectionReasons.push(
        `Non-grocery exclusion: domain '${domain || 'other_non_grocery'}' is excluded from the default consumer grocery feed.`
      );
    }
  }
  if (normalizedCard.pricing.promo_price === null) {
    const hasPriceNote = rejectionReasons.some((r) => /promo_price|price/i.test(r));
    if (!hasPriceNote) {
      rejectionReasons.push('Missing promo price: a numeric SAR promo_price is required for publication.');
    }
  }

  const hasFactualPublicationConflict =
    normalizedCard.pricing.promo_price === null ||
    normalizedCard.non_grocery_specs.excluded_from_default_grocery_feed ||
    conflictCodes.some((code) => FACTUAL_PUBLICATION_CONFLICT_CODES.has(code));

  if (hasFactualPublicationConflict) {
    const fallbackReason =
      conflictCodes.length > 0
        ? [`Blocked by conflict code(s): ${conflictCodes.join(', ')}.`]
        : ['Quarantined pending manual review validation.'];
    return {
      parent_source_offer_id: parentId,
      decomposed: false,
      decomposition_basis: null,
      parent_offer_retention_mode: 'quarantined_do_not_publish',
      children: [],
      unresolved_sub_items: normalizedCard.sub_items,
      rejection_reasons:
        rejectionReasons.length > 0
          ? rejectionReasons
          : fallbackReason,
      conflict_codes: conflictCodes,
      normalized_card: normalizedCard
    };
  }

  // Identity-insufficiency gaps block catalog decomposition/matching WITHOUT falsely quarantining valid grocery promotions
  if (conflictCodes.length > 0) {
    return {
      parent_source_offer_id: parentId,
      decomposed: false,
      decomposition_basis: null,
      parent_offer_retention_mode: 'unsplit_non_catalog_candidate',
      children: [],
      unresolved_sub_items: normalizedCard.sub_items,
      rejection_reasons:
        rejectionReasons.length > 0
          ? rejectionReasons
          : [`Catalog identity insufficient without factual publication conflict: ${conflictCodes.join(', ')}.`],
      conflict_codes: conflictCodes,
      normalized_card: normalizedCard
    };
  }

  // Single-SKU confirmed cards do not fan out into multi-child decompositions
  if (normalizedCard.assortment.status === 'confirmed_single_sku') {
    return {
      parent_source_offer_id: parentId,
      decomposed: false,
      decomposition_basis: null,
      parent_offer_retention_mode: 'unsplit_single_sku',
      children: [],
      unresolved_sub_items: [],
      rejection_reasons: [],
      conflict_codes: [],
      normalized_card: normalizedCard
    };
  }

  // Empty sub_items[] never proves single SKU!
  if (normalizedCard.assortment.status === 'unknown_insufficient_evidence') {
    rejectionReasons.push('Assortment status is unknown_insufficient_evidence; empty sub_items[] cannot be assumed single SKU.');
    return {
      parent_source_offer_id: parentId,
      decomposed: false,
      decomposition_basis: null,
      parent_offer_retention_mode: 'unsplit_non_catalog_candidate',
      children: [],
      unresolved_sub_items: normalizedCard.sub_items,
      rejection_reasons: rejectionReasons,
      conflict_codes: [],
      normalized_card: normalizedCard
    };
  }

  if (NON_DECOMPOSABLE_COMMODITY_DOMAINS.has(domain) || normalizedCard.quantity_and_promo.is_per_weight_pricing) {
    rejectionReasons.push(`Domain "${domain}" / per-weight pricing does not decompose into branded catalog SKUs.`);
    return {
      parent_source_offer_id: parentId,
      decomposed: false,
      decomposition_basis: null,
      parent_offer_retention_mode: normalizedCard.non_grocery_specs.excluded_from_default_grocery_feed
        ? 'quarantined_do_not_publish'
        : 'unsplit_non_catalog_candidate',
      children: [],
      unresolved_sub_items: normalizedCard.sub_items,
      rejection_reasons: rejectionReasons,
      conflict_codes: [],
      normalized_card: normalizedCard
    };
  }

  if (!normalizedCard.assortment.is_enumerated_list_complete) {
    rejectionReasons.push('assortment.is_enumerated_list_complete is false; partial assortments cannot decompose.');
    return {
      parent_source_offer_id: parentId,
      decomposed: false,
      decomposition_basis: null,
      parent_offer_retention_mode: 'unsplit_non_catalog_candidate',
      children: [],
      unresolved_sub_items: normalizedCard.sub_items,
      rejection_reasons: rejectionReasons,
      conflict_codes: [],
      normalized_card: normalizedCard
    };
  }

  if (normalizedCard.sub_items.length < 2) {
    rejectionReasons.push('Fewer than 2 explicit sub_items identified; parent card remains unsplit.');
    return {
      parent_source_offer_id: parentId,
      decomposed: false,
      decomposition_basis: null,
      parent_offer_retention_mode: 'unsplit_non_catalog_candidate',
      children: [],
      unresolved_sub_items: normalizedCard.sub_items,
      rejection_reasons: rejectionReasons,
      conflict_codes: [],
      normalized_card: normalizedCard
    };
  }

  // Validate ALL children atomically: incomplete/unsafe child aborts complete fan-out
  const childFailures: string[] = [];
  for (const sub of normalizedCard.sub_items) {
    const check = validateChildSubItem(sub, normalizedCard);
    if (!check.valid) {
      childFailures.push(...check.reasons);
    }
  }

  // Ensure children are distinguishable (no duplicate identical sub-items)
  const identitySignatures = new Set<string>();
  for (const sub of normalizedCard.sub_items) {
    const sig = [
      (sub.brand_en || sub.brand_ar || '').trim().toLowerCase(),
      (sub.product_name_en || sub.product_name_ar || '').trim().toLowerCase(),
      (sub.variant_or_flavor || '').trim().toLowerCase(),
      String(sub.each_size_value ?? ''),
      String(canonicalizeUnit(sub.each_size_unit) ?? ''),
      String(sub.manufacturer_pack_count ?? ''),
      String(sub.independent_promo_price ?? '')
    ].join('|');
    if (identitySignatures.has(sig)) {
      childFailures.push(`${sub.sub_item_ref}: Indistinguishable duplicate sub-item signature "${sig}".`);
    }
    identitySignatures.add(sig);
  }

  if (childFailures.length > 0) {
    return {
      parent_source_offer_id: parentId,
      decomposed: false,
      decomposition_basis: null,
      parent_offer_retention_mode: 'unsplit_non_catalog_candidate',
      children: [],
      unresolved_sub_items: normalizedCard.sub_items,
      rejection_reasons: [...rejectionReasons, ...childFailures],
      conflict_codes: [],
      normalized_card: normalizedCard
    };
  }

  const basis = determineDecompositionBasis(normalizedCard);
  const pricingMode: 'shared_assortment_price' | 'independent_card_price' =
    basis === 'compound_price_tier_split' ? 'independent_card_price' : 'shared_assortment_price';

  const children: DecomposedSubItemCandidateV3[] = normalizedCard.sub_items.map((sub) => {
    const canonUnit = canonicalizeUnit(sub.each_size_unit) || sub.each_size_unit!;
    const childPromo =
      pricingMode === 'independent_card_price' && sub.independent_promo_price
        ? sub.independent_promo_price
        : normalizedCard.pricing.promo_price!;
    const childOrig =
      pricingMode === 'independent_card_price' && sub.independent_original_price !== undefined
        ? sub.independent_original_price ?? null
        : normalizedCard.pricing.original_price;

    return {
      parent_source_offer_id: parentId,
      sub_item_ref: sub.sub_item_ref,
      candidate_key: `${parentId}::${sub.sub_item_ref}`,
      decomposition_basis: basis,
      source_evidence_refs: sub.evidence_refs,
      brand_en: sub.brand_en,
      brand_ar: sub.brand_ar,
      product_name_en: sub.product_name_en,
      product_name_ar: sub.product_name_ar,
      variant_or_flavor: sub.variant_or_flavor,
      each_size_value: sub.each_size_value!,
      each_size_unit: canonUnit as V3CanonicalOrExtendedUnit,
      manufacturer_pack_count: sub.manufacturer_pack_count!,
      printed_retailer_sku_code: sub.printed_retailer_sku_code,
      is_retailer_sku_only_not_gtin: true,
      pricing_mode: pricingMode,
      parent_promo_price: childPromo,
      parent_original_price: childOrig,
      currency: normalizedCard.pricing.currency!,
      price_basis: normalizedCard.pricing.price_basis,
      promo_conditions: normalizedCard.pricing.promo_conditions,
      retailer_checkout_multibuy_qty:
        sub.retailer_checkout_multibuy_qty ?? normalizedCard.quantity_and_promo.retailer_checkout_multibuy_qty,
      customer_limit_pcs: normalizedCard.quantity_and_promo.customer_limit_pcs,
      loyalty_required: normalizedCard.quantity_and_promo.loyalty_required,
      offer_start_date: normalizedCard.source_card.offer_start_date,
      offer_end_date: normalizedCard.source_card.offer_end_date,
      location_scope: normalizedCard.source_card.location_scope,
      retailer_id: normalizedCard.source_card.retailer_id,
      retailer_name: normalizedCard.source_card.retailer_name,
      isolated_identity_token: `${parentId}::${sub.sub_item_ref}::${(sub.variant_or_flavor || sub.brand_en || sub.brand_ar || '').toLowerCase()}`
    };
  });

  return {
    parent_source_offer_id: parentId,
    decomposed: true,
    decomposition_basis: basis,
    parent_offer_retention_mode:
      pricingMode === 'independent_card_price'
        ? 'decomposed_compound_tier_parent'
        : 'decomposed_shared_promo_parent',
    children,
    unresolved_sub_items: [],
    rejection_reasons: [],
    conflict_codes: [],
    normalized_card: normalizedCard
  };
}
