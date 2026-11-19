/**
 * WIFRAN-EXTRACTOR-IDENTITY-005G (WP6-B & WP6-C)
 * Deterministic, Impact-Driven Card Crop & Page-Context Verification Selector.
 *
 * Replaces naive confidence-only or missing-optional-field rules with concrete
 * identity, price-role, assortment-completeness, loyalty/eligibility, and geometry triggers.
 * Strictly offline and retailer-agnostic (never hardcodes retailer names).
 */

import type { OfferContractV3Record } from '../../../shared/types/extractorContractV3';
import type {
  CardCropSelectionDecision,
  CropSelectionPriority,
  CropSelectionTriggerCode,
  NormalizedBox2D,
  PageContextTriggerCode,
  PageContextVerificationNeed,
  V3RawComponentBoxes
} from '../../../shared/types/hybridExtractionV3';
import { decomposeV3OfferCard } from '../offerV3DecompositionEngine';

const COMPOUND_TIER_CUE_REGEX =
  /\b(carton|ctn|box|piece|pcs|single|tray)\b|كرتون|الحبة|حبة|حبات|علبة|صندوق/i;

const LOYALTY_OR_TERMS_BANNER_REGEX =
  /\b(loyalty|rewards?|members?|exclusive|club|terms?|conditions?|valid(?:ity)?|limit|per\s+customer|app)\b|ولاء|مكافآت|أعضاء|الأعضاء|للأعضاء|حصري|بطاقة|تطبيق|شروط|ساري|حتى|بحد\s+أقصى|عرض\s+الأعضاء/i;

const EXCLUSION_BANNER_REGEX =
  /\b(except|exclud(?:e|es|ing)|not\s+valid\s+(?:on|for)|excludes)\b|ما\s*عدا|باستثناء|لا\s*يشمل|غير\s*شامل|يستثنى|تستثنى/i;

const REGIONAL_SCOPE_BANNER_REGEX =
  /\b(riyadh|jeddah|dammam|khobar|makkah|madinah|region|branch(?:es)?\s+only|selected\s+stores)\b|الرياض|جدة|الدمام|الخبر|مكة|المدينة|فروع|فرع|المنطقة|فقط\s+في\s+فروع/i;

const BEVERAGE_HINT_REGEX =
  /\b(cola|pepsi|7\s*up|mirinda|juice|drink|water|milk|tea|coffee|malt|moussy|soda|nectar|sun\s*top|lipton)\b|عصير|شراب|مياه|حليب|شاي|قهوة|بيبسي|موسي/i;

const INDEPENDENT_PACKAGING_EVIDENCE_TYPES = new Set([
  'printed_package_label',
  'visible_variant_label',
  'manufacturer_packaging_marking'
]);

function measureNormalizedBox(box: NormalizedBox2D | null | undefined): {
  valid: boolean;
  areaFraction: number;
  minDim: number;
} {
  if (!box || !isValidBox2D(box)) {
    return { valid: false, areaFraction: 0, minDim: 0 };
  }
  const height = box[2] - box[0];
  const width = box[3] - box[1];
  return {
    valid: true,
    areaFraction: (height * width) / 1_000_000,
    minDim: Math.min(height, width)
  };
}

export function cardHasIndependentPackagingEvidence(card: OfferContractV3Record): boolean {
  return (card.evidence_ledger || []).some((entry) =>
    INDEPENDENT_PACKAGING_EVIDENCE_TYPES.has(entry.evidence_type)
  );
}

function isValidBox2D(box: NormalizedBox2D | null | undefined): boolean {
  if (!box) return true; // Individual optional box may be omitted
  if (!Array.isArray(box) || box.length !== 4) return false;
  const [ymin, xmin, ymax, xmax] = box;
  if ([ymin, xmin, ymax, xmax].some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return false;
  }
  if (ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) return false;
  if (ymax <= ymin || xmax <= xmin) return false;
  return true;
}

export function hasAnyValidCardComponentBox(components?: V3RawComponentBoxes | null): {
  hasAnyBox: boolean;
  allPresentBoxesValid: boolean;
  issues: string[];
} {
  if (!components || typeof components !== 'object') {
    return {
      hasAnyBox: false,
      allPresentBoxesValid: false,
      issues: ['MISSING_COMPONENTS_BBOX_OBJECT']
    };
  }

  const keys: Array<keyof V3RawComponentBoxes> = [
    'product_graphic_box',
    'promo_price_box',
    'original_price_box',
    'title_text_box',
    'unit_and_size_badge_box'
  ];

  let presentCount = 0;
  let allValid = true;
  const issues: string[] = [];

  for (const key of keys) {
    const box = components[key];
    if (box != null) {
      presentCount++;
      if (!isValidBox2D(box)) {
        allValid = false;
        issues.push(`INVALID_COMPONENT_BOX:${key}`);
      }
    }
  }

  if (presentCount === 0) {
    issues.push('NO_COMPONENT_BOXES_PRESENT');
  }

  return {
    hasAnyBox: presentCount > 0,
    allPresentBoxesValid: presentCount > 0 && allValid,
    issues
  };
}

export interface CardSelectionContext {
  components?: V3RawComponentBoxes | null;
  rawConfidence?: number | null;
  pageHasPerCardLimits?: boolean;
  pageContextSuspectedIncomplete?: boolean;
}

/**
 * Evaluates a single decoded V3 card to decide whether high-resolution crop
 * verification is mandatory (`P0`), recommended (`P1`), or unnecessary (`P2`).
 */
export function evaluateCardForCropVerification(
  card: OfferContractV3Record,
  context: CardSelectionContext = {}
): CardCropSelectionDecision {
  const decomposition = decomposeV3OfferCard(card);
  const norm = decomposition.normalized_card;

  const triggerSet = new Set<CropSelectionTriggerCode>();
  const reasons: string[] = [];
  const missRiskAuditNotes: string[] = [];

  let p0Count = 0;
  let p1Count = 0;

  let identityImpact = false;
  let priceOrQuantityImpact = false;
  let eligibilityOrLoyaltyImpact = false;
  let completenessOrAssortmentImpact = false;
  let geometryOrImageTextImpact = false;

  const addP0 = (code: CropSelectionTriggerCode, reason: string) => {
    triggerSet.add(code);
    reasons.push(reason);
    p0Count++;
  };

  const addP1 = (code: CropSelectionTriggerCode, reason: string) => {
    triggerSet.add(code);
    reasons.push(reason);
    p1Count++;
  };

  // 1. Existing or normalized conflicts (EN/AR weight/volume, text-vs-image, SKU mismatch, etc.)
  const allConflicts = Array.from(
    new Set([...norm.evidence_conflicts, ...decomposition.conflict_codes, ...norm.pricing.price_conflict_flags])
  );
  if (allConflicts.length > 0) {
    addP0(
      'CONFLICT_FLAGGED',
      `Detected ${allConflicts.length} extraction/normalization conflict(s): ${allConflicts.join(', ')}.`
    );
    identityImpact = true;
    geometryOrImageTextImpact = true;
  }

  // 2. Price role anomaly / missing currency / price inversion (WP6 §14 guard)
  const promoPrice = norm.pricing.promo_price;
  const origPrice = norm.pricing.original_price;
  if (
    promoPrice === null ||
    !Number.isFinite(promoPrice) ||
    promoPrice <= 0 ||
    (origPrice !== null && promoPrice >= origPrice) ||
    norm.pricing.price_role_confidence === 'conflicting' ||
    !norm.pricing.currency
  ) {
    addP0(
      'PRICE_ROLE_OR_PROMO_ANOMALY',
      `Price integrity anomaly (promo=${String(promoPrice)}, original=${String(origPrice)}, currency=${String(norm.pricing.currency)}, roleConf=${norm.pricing.price_role_confidence}).`
    );
    priceOrQuantityImpact = true;
  }

  // 3. Confidence checks
  const rawConfLow = typeof context.rawConfidence === 'number' && context.rawConfidence < 0.72;
  if (
    norm.extraction_confidence === 'low' ||
    norm.pricing.price_role_confidence === 'low' ||
    rawConfLow
  ) {
    addP0(
      'LOW_CONFIDENCE_OR_UNCERTAIN_PRICE',
      `Low extraction or price-role confidence (${norm.extraction_confidence}/${norm.pricing.price_role_confidence}).`
    );
    priceOrQuantityImpact = true;
    identityImpact = true;
  } else if (
    norm.extraction_confidence === 'medium' ||
    norm.pricing.price_role_confidence === 'medium'
  ) {
    addP1(
      'MEDIUM_CONFIDENCE_VERIFICATION',
      `Medium confidence on extraction or price role (${norm.extraction_confidence}/${norm.pricing.price_role_confidence}).`
    );
    priceOrQuantityImpact = true;
  }

  // 4. Assortment & decomposition completeness
  const isAssortment = norm.assortment.status !== 'confirmed_single_sku';
  const visibleCount = norm.assortment.visible_variant_count ?? 0;
  const subItemsCount = norm.sub_items.length;

  if (isAssortment) {
    if (
      !norm.assortment.is_enumerated_list_complete ||
      subItemsCount === 0 ||
      (visibleCount > 1 && visibleCount > subItemsCount)
    ) {
      addP0(
        'UNSPLIT_AMBIGUOUS_ASSORTMENT_WITH_SKU',
        `Assortment (${norm.assortment.status}) is incomplete or missing readable sub-items (visible=${visibleCount}, sub_items=${subItemsCount}, complete=${norm.assortment.is_enumerated_list_complete}).`
      );
      completenessOrAssortmentImpact = true;
      identityImpact = true;
    } else if (
      subItemsCount >= 2 &&
      (norm.printed_retailer_sku_codes.length > 0 ||
        norm.sub_items.some((s) => !s.variant_or_flavor && !s.brand_en && !s.brand_ar))
    ) {
      // e.g. BinDawood multi-SKU card where full-page might misread bottle labels or swatches
      addP1(
        'ASSORTMENT_SUB_ITEM_ENRICHMENT',
        `Assortment with ${subItemsCount} sub-items and retailer SKUs (${norm.printed_retailer_sku_codes.length}) warrants high-res variant verification.`
      );
      completenessOrAssortmentImpact = true;
    }
  }

  // 5. Compound / multi-tier / weight-range / beverage-pcs ambiguity
  const combinedText = `${norm.source_card.raw_text.title_en || ''} ${norm.source_card.raw_text.title_ar || ''} ${norm.source_card.raw_text.promo_badge_text || ''} ${norm.pricing.promo_conditions || ''}`;
  const nonNullSubPrices = norm.sub_items
    .map((s) => s.independent_promo_price)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0);
  const hasDistinctSubPrices = new Set(nonNullSubPrices.map((p) => Number(p.toFixed(2)))).size > 1;
  const hasSubPriceDifferingFromCard =
    promoPrice != null &&
    nonNullSubPrices.some((p) => Math.abs(p - promoPrice) > 0.01);
  const hasPartialMultiSubPrices =
    norm.sub_items.length > 1 &&
    nonNullSubPrices.length > 0 &&
    nonNullSubPrices.length < norm.sub_items.length;
  const hasIndependentSubPrices =
    hasDistinctSubPrices || hasSubPriceDifferingFromCard || hasPartialMultiSubPrices;
  if (
    norm.compound_card_context?.has_multiple_price_badges_in_card ||
    norm.compound_card_context?.has_different_packaging_across_entries ||
    hasIndependentSubPrices ||
    (norm.sub_items.length > 1 && !decomposition.decomposed)
  ) {
    addP0(
      'COMPOUND_MULTI_TIER_OR_UNPAIRED_WEIGHT',
      'Compound multi-tier card or multi-item pricing requires crop verification to prevent missed/merged tiers.'
    );
    priceOrQuantityImpact = true;
    completenessOrAssortmentImpact = true;
  } else if (
    norm.quantity_and_promo.loyalty_required &&
    norm.quantity_and_promo.retailer_checkout_multibuy_qty != null &&
    (COMPOUND_TIER_CUE_REGEX.test(combinedText) || context.components?.promo_price_box != null)
  ) {
    // e.g. loyalty 3-pcs card like Sun Top where a secondary single-pc price badge may coexist on the card
    addP1(
      'CUSTOMER_LIMIT_OR_LOYALTY_UNCERTAINTY',
      'Loyalty multibuy card may contain a secondary non-member pricing tier or per-customer limit.'
    );
    priceOrQuantityImpact = true;
    eligibilityOrLoyaltyImpact = true;
  }

  // Packaged grocery critical identity completeness (ignore optional variant_or_flavor / original_price / customer_limit)
  const isPackagedDomain =
    norm.non_grocery_specs.domain === 'grocery' ||
    norm.non_grocery_specs.domain === 'household' ||
    norm.non_grocery_specs.domain === 'personal_care';
  const sub0 = norm.sub_items[0];
  const hasBrand = Boolean(
    sub0 && ((sub0.brand_en && sub0.brand_en.trim()) || (sub0.brand_ar && sub0.brand_ar.trim()))
  );
  const hasTopSize =
    norm.quantity_and_promo.each_size_value != null &&
    norm.quantity_and_promo.each_size_unit != null;
  const allDecomposedSubItemsHaveOwnIdentityAndSize =
    isAssortment &&
    decomposition.decomposed &&
    norm.sub_items.length > 0 &&
    norm.sub_items.every(
      (s) =>
        Boolean((s.brand_en && s.brand_en.trim()) || (s.brand_ar && s.brand_ar.trim()) || hasBrand) &&
        s.each_size_value != null &&
        s.each_size_unit != null
    );
  const hasSize = hasTopSize || allDecomposedSubItemsHaveOwnIdentityAndSize;

  if (isPackagedDomain) {
    if (!hasBrand || !hasSize) {
      addP0(
        'MISSING_CRITICAL_IDENTITY_ATTRIBUTES',
        `Packaged ${norm.non_grocery_specs.domain} offer lacks critical identity fields (hasBrand=${hasBrand}, hasSize=${hasSize}).`
      );
      identityImpact = true;
    }

    const isLegitimateCountedTeaOrPods =
      /\b(bags?|tea\s*bags?|sachets?|pods?|capsules?)\b|أكياس|كيس|كبسولات/i.test(combinedText);
    if (
      norm.quantity_and_promo.each_size_unit === 'pcs' &&
      BEVERAGE_HINT_REGEX.test(combinedText) &&
      !isLegitimateCountedTeaOrPods
    ) {
      addP0(
        'PACKAGED_BEVERAGE_PCS_AMBIGUITY',
        'Beverage card extracted with pcs unit instead of individual bottle/can volume; verify label on high-res crop.'
      );
      identityImpact = true;
    }
  }

  // 5B. Generalizable WP7-A rule: caption-only evidence on small/dense packaged product graphics
  // catches hidden packaging contradictions (e.g. Arabic caption 2.5kg vs small visible 2kg bag).
  const hasIndependentPkgEvidence = cardHasIndependentPackagingEvidence(norm);
  const isPackagedFixedUnitDomain =
    isPackagedDomain && !norm.quantity_and_promo.is_per_weight_pricing;
  const graphicMetrics = measureNormalizedBox(context.components?.product_graphic_box ?? null);
  const isSmallOrDenseGraphic =
    graphicMetrics.valid && (graphicMetrics.areaFraction < 0.025 || graphicMetrics.minDim < 130);
  const isUltraSmallBilingualGraphic =
    graphicMetrics.valid && (graphicMetrics.areaFraction < 0.005 || graphicMetrics.minDim < 45);
  const isMonolingualTitle =
    Boolean(norm.source_card.raw_text.title_ar?.trim()) !==
    Boolean(norm.source_card.raw_text.title_en?.trim());

  const hasPromoOrMultiBuyCondition =
    norm.quantity_and_promo.sale_basis === 'multi_buy_checkout' ||
    Boolean(norm.pricing.promo_conditions) ||
    Boolean(norm.quantity_and_promo.customer_limit_pcs);

  if (isPackagedFixedUnitDomain && !hasIndependentPkgEvidence && isSmallOrDenseGraphic) {
    const areaPct = (graphicMetrics.areaFraction * 100).toFixed(2);
    if (isMonolingualTitle) {
      addP0(
        'UNVERIFIED_PACKAGING_EVIDENCE_FOR_IDENTITY',
        `Packaged ${norm.non_grocery_specs.domain} offer lacks independent packaging-label evidence and bilingual cross-check while product_graphic_box is small (${areaPct}%, minDim=${graphicMetrics.minDim}/1000).`
      );
      addP0(
        'DENSE_OR_SMALL_PACKAGING_TEXT',
        `Small/dense package graphic (${areaPct}%, minDim=${graphicMetrics.minDim}/1000) risks misread pack weight or flavor from full-page scale.`
      );
      identityImpact = true;
      geometryOrImageTextImpact = true;
    } else if (
      isAssortment ||
      !hasBrand ||
      !hasSize ||
      hasPromoOrMultiBuyCondition ||
      norm.extraction_confidence !== 'high' ||
      (typeof context.rawConfidence === 'number' && context.rawConfidence < 0.85) ||
      isUltraSmallBilingualGraphic
    ) {
      addP1(
        'DENSE_OR_SMALL_PACKAGING_TEXT',
        `Packaged ${norm.non_grocery_specs.domain} card has small product graphic (${areaPct}%, minDim=${graphicMetrics.minDim}/1000) requiring visual confirmation.`
      );
      geometryOrImageTextImpact = true;
    }
  }

  const requiresCropVerificationForCatalogMatch =
    isPackagedFixedUnitDomain && !hasIndependentPkgEvidence;

  // 6. Geometry quality check (only flags invalid geometry when component boxes are provided/required)
  if (context.components !== undefined) {
    const geom = hasAnyValidCardComponentBox(context.components);
    if (geom.hasAnyBox && !geom.allPresentBoxesValid) {
      addP0(
        'INVALID_OR_LOW_QUALITY_BBOX',
        `Invalid card component bounding box geometry: ${geom.issues.join(', ')}.`
      );
      geometryOrImageTextImpact = true;
    }
  }

  // 7. P1 check: original_price_box detected visually on card, yet original_price is null
  if (context.components?.original_price_box != null && origPrice == null) {
    addP1(
      'MISSING_ORIGINAL_PRICE_WITH_BADGE_BOX',
      'Visual original_price_box localized on card while numeric original_price is null.'
    );
    priceOrQuantityImpact = true;
  }

  // 8. P1 check: sibling cards on page specify per-card customer limits while this card omitted it
  if (
    context.pageHasPerCardLimits &&
    norm.quantity_and_promo.customer_limit_pcs == null &&
    isPackagedDomain &&
    p0Count === 0
  ) {
    addP1(
      'CUSTOMER_LIMIT_OR_LOYALTY_UNCERTAINTY',
      'Other cards on the same page specify customer_limit_pcs; verify whether a small limit caption appears on this card.'
    );
    eligibilityOrLoyaltyImpact = true;
  }

  // Self-audit miss risks (subtle signs full-page pass might look clean while hiding risk)
  if (
    norm.assortment.assortment_evidence.includes('assorted_badge') &&
    norm.assortment.is_enumerated_list_complete
  ) {
    missRiskAuditNotes.push(
      'Card carries assorted_badge with is_enumerated_list_complete=true; crop check advisable to confirm no hidden variants remain.'
    );
    if (p0Count === 0 && p1Count === 0) {
      addP1(
        'ASSORTMENT_SUB_ITEM_ENRICHMENT',
        'Assorted badge co-occurs with complete=true; verify all illustrated flavors match extracted sub_items.'
      );
      completenessOrAssortmentImpact = true;
    }
  }

  let priority: CropSelectionPriority = 'P2';
  if (p0Count > 0) {
    priority = 'P0';
  } else if (p1Count > 0) {
    priority = 'P1';
  } else {
    triggerSet.add('NO_VERIFICATION_NEEDED');
    reasons.push(
      'High-confidence complete card with clean price roles, clear identity attributes, and zero detected conflicts.'
    );
  }

  let knownLimitationNote: string | null = null;
  if (requiresCropVerificationForCatalogMatch) {
    knownLimitationNote =
      priority === 'P2'
        ? 'Full-page extraction holds leaflet caption evidence only (no independent packaging label/marking). Retained for caption safety/P2 quality audit; requires crop confirmation before catalog SKU matching.'
        : 'Full-page extraction holds leaflet caption evidence only (no independent packaging label/marking); high-res crop confirmation is required before catalog SKU matching.';
    missRiskAuditNotes.push(knownLimitationNote);
  }

  return {
    sourceOfferId: norm.source_card.source_offer_id,
    offerNumber: context.components ? Number(norm.source_card.source_offer_id.split('_').pop() || 0) : 0,
    priority,
    needsCrop: priority !== 'P2',
    triggerCodes: Array.from(triggerSet),
    reasons,
    impactDimensions: {
      identityImpact,
      priceOrQuantityImpact,
      eligibilityOrLoyaltyImpact,
      completenessOrAssortmentImpact,
      geometryOrImageTextImpact
    },
    missRiskAuditNotes,
    requiresCropVerificationForCatalogMatch,
    hasIndependentPackagingEvidence: hasIndependentPkgEvidence,
    knownLimitationNote,
    p2Audit: undefined
  };
}

function stableFnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function classifyP2AuditStratum(card: OfferContractV3Record): string {
  const domain = card.non_grocery_specs.domain || 'grocery';
  if (
    domain === 'electronics' ||
    domain === 'appliance' ||
    domain === 'textiles_home' ||
    domain === 'other_non_grocery'
  ) {
    return `${domain}::non_grocery`;
  }
  if (card.quantity_and_promo.is_per_weight_pricing) {
    return `${domain}::loose_or_random_weight`;
  }
  if (
    (card.quantity_and_promo.manufacturer_pack_count ?? 1) > 1 ||
    (card.quantity_and_promo.retailer_checkout_multibuy_qty ?? 1) > 1
  ) {
    return `${domain}::multi_pack_or_multibuy`;
  }
  return `${domain}::single_sku_packaged`;
}

/**
 * Selects an independent, deterministic stratified quality-audit sample from cards
 * scored `P2` so false-negative risks on "clean" cards are continuously monitored
 * without altering risk-based P0/P1 triggers.
 */
export function selectIndependentP2AuditSample(input: {
  items: Array<{ card: OfferContractV3Record; decision: CardCropSelectionDecision }>;
  enabled: boolean;
  sampleRate?: number;
  seed?: string;
  minSampleCount?: number;
  maxSampleCount?: number;
}): {
  eligibleP2Count: number;
  selectedOfferIds: string[];
  stratumByOfferId: Record<string, string>;
} {
  const p2Items = input.items.filter((item) => item.decision.priority === 'P2');
  const stratumByOfferId: Record<string, string> = {};
  for (const item of p2Items) {
    stratumByOfferId[item.decision.sourceOfferId] = classifyP2AuditStratum(item.card);
  }

  if (!input.enabled || p2Items.length === 0) {
    return {
      eligibleP2Count: p2Items.length,
      selectedOfferIds: [],
      stratumByOfferId
    };
  }

  const rate = Math.max(0, Math.min(1, input.sampleRate ?? 0.2));
  const minCount = input.minSampleCount ?? (rate > 0 ? 1 : 0);
  const maxCount = input.maxSampleCount ?? p2Items.length;
  const targetCount = Math.min(
    p2Items.length,
    maxCount,
    Math.max(minCount, Math.round(p2Items.length * rate))
  );
  if (targetCount <= 0) {
    return {
      eligibleP2Count: p2Items.length,
      selectedOfferIds: [],
      stratumByOfferId
    };
  }

  const seed = input.seed || 'wp7_p2_audit_v1';
  const buckets = new Map<string, string[]>();
  for (const item of p2Items) {
    const id = item.decision.sourceOfferId;
    const stratum = stratumByOfferId[id];
    const list = buckets.get(stratum) || [];
    list.push(id);
    buckets.set(stratum, list);
  }

  const sortedStrata = Array.from(buckets.keys()).sort();
  for (const stratum of sortedStrata) {
    const ids = buckets.get(stratum)!;
    ids.sort((a, b) => {
      const ha = stableFnv1a32(`${seed}::${stratum}::${a}`);
      const hb = stableFnv1a32(`${seed}::${stratum}::${b}`);
      return ha !== hb ? ha - hb : a.localeCompare(b);
    });
  }

  const selected: string[] = [];
  let roundIdx = 0;
  while (selected.length < targetCount) {
    let addedInRound = false;
    for (const stratum of sortedStrata) {
      const ids = buckets.get(stratum)!;
      if (roundIdx < ids.length) {
        selected.push(ids[roundIdx]);
        addedInRound = true;
        if (selected.length >= targetCount) break;
      }
    }
    if (!addedInRound) break;
    roundIdx++;
  }

  return {
    eligibleP2Count: p2Items.length,
    selectedOfferIds: selected,
    stratumByOfferId
  };
}

export function markDecisionAsIndependentP2Audit(
  decision: CardCropSelectionDecision,
  stratum: string,
  options?: { samplingRate?: number; seed?: string }
): CardCropSelectionDecision {
  const triggerCodes = Array.from(
    new Set<CropSelectionTriggerCode>([...decision.triggerCodes, 'INDEPENDENT_P2_QUALITY_AUDIT'])
  );
  return {
    ...decision,
    needsCrop: true,
    triggerCodes,
    reasons: [
      ...decision.reasons,
      `Selected for stratified Independent P2 Quality Audit (${stratum}).`
    ],
    p2Audit: {
      selectedForAudit: true,
      stratum,
      samplingRate: options?.samplingRate ?? 0.2,
      seed: options?.seed ?? 'wp7_p2_audit_v1',
      reason: `Stratified random audit sampling on clean P2 card in stratum ${stratum}.`
    }
  };
}

/**
 * Assesses whether the full-page extraction likely missed page-wide header/footer
 * conditions (e.g. loyalty-only banner, validity dates, page currency, exclusions,
 * regional scope, or per-customer limits). Completely retailer-agnostic.
 */
export function assessPageContextVerificationNeed(input: {
  cards: OfferContractV3Record[];
  isLoyaltyPage: boolean;
  loyaltyProgramName: string | null;
  validityStartDate: string | null;
  validityEndDate: string | null;
  pageCurrency: string | null;
  ignoredBanners: string[];
}): PageContextVerificationNeed {
  const triggers = new Set<PageContextTriggerCode>();
  const reasons: string[] = [];
  const banners = (input.ignoredBanners || []).map((b) => String(b || ''));

  const bannerMatchesTerms = banners.filter((b) => LOYALTY_OR_TERMS_BANNER_REGEX.test(b));
  const bannerMatchesExclusions = banners.filter((b) => EXCLUSION_BANNER_REGEX.test(b));
  const bannerMatchesRegional = banners.filter((b) => REGIONAL_SCOPE_BANNER_REGEX.test(b));

  const cardsWithoutLoyaltyCount = input.cards.filter(
    (c) => !c.quantity_and_promo.loyalty_required
  ).length;
  const anyCustomerLimit = input.cards.some(
    (c) => c.quantity_and_promo.customer_limit_pcs != null
  );

  if (!input.isLoyaltyPage && !input.loyaltyProgramName) {
    if (bannerMatchesTerms.length > 0) {
      triggers.add('PAGE_WIDE_LOYALTY_SUSPECTED_OR_MISSING');
      reasons.push(
        `Ignored page banner(s) contain loyalty/membership/terms keywords (${bannerMatchesTerms.join(' | ')}) while is_loyalty_page=false.`
      );
    } else if (
      input.cards.length >= 6 &&
      cardsWithoutLoyaltyCount === input.cards.length &&
      (!input.validityStartDate || !input.validityEndDate || anyCustomerLimit || banners.length > 0)
    ) {
      triggers.add('PAGE_WIDE_LOYALTY_SUSPECTED_OR_MISSING');
      reasons.push(
        `Multi-card page (${input.cards.length} cards, 0 loyalty-tagged) exhibits header/footer context cues (banners=${banners.length}, missingDates=${!input.validityStartDate || !input.validityEndDate}, limits=${anyCustomerLimit}).`
      );
    }
  }

  if (bannerMatchesExclusions.length > 0) {
    triggers.add('PAGE_WIDE_EXCLUSIONS_SUSPECTED');
    reasons.push(
      `Banner/footnote contains exclusion wording (${bannerMatchesExclusions.join(' | ')}); verify scope & excluded categories/offers.`
    );
  }

  if (bannerMatchesRegional.length > 0) {
    triggers.add('PAGE_WIDE_REGIONAL_SCOPE_SUSPECTED');
    reasons.push(
      `Banner/footnote mentions city or branch scope (${bannerMatchesRegional.join(' | ')}); verify regional applicability.`
    );
  }

  // WIFRAN-MVP: Currency is internally fixed to SAR; loyalty, promotional terms,
  // and page-wide customer limit crops are decommissioned from routine MVP scope.

  if (!input.validityStartDate || !input.validityEndDate) {
    triggers.add('MISSING_PAGE_VALIDITY_DATES');
    reasons.push(
      `Page validity dates incomplete (start=${String(input.validityStartDate)}, end=${String(input.validityEndDate)}).`
    );
  }

  const needsPageContextVerification = triggers.size > 0;
  const recommendedRegions: PageContextVerificationNeed['recommendedRegions'] = needsPageContextVerification
    ? [
        { regionKind: 'page_header', normalizedBox: [0, 0, 210, 1000] },
        { regionKind: 'page_footer', normalizedBox: [840, 0, 1000, 1000] }
      ]
    : [];
  if (bannerMatchesExclusions.length > 0 || bannerMatchesRegional.length > 0) {
    recommendedRegions.push({
      regionKind: 'full_page_context',
      normalizedBox: [0, 0, 1000, 1000]
    });
  }

  return {
    needsPageContextVerification,
    triggerCodes: Array.from(triggers),
    reasons,
    recommendedRegions
  };
}

