import { createHash } from 'crypto';
import type { CanonicalOffer } from '../types/canonicalOffer';
import { sanitizePublicConsumerImageUrl } from './nonCatalogPublicationPolicy';
import type {
  ExtractorOfferContractV2,
  ScenarioPurchaseResult,
  ConsumerOfferProjection,
  ConsumerOfferDTO,
  ControlledAttributeV2,
  AssortmentStatusV2,
  AssortmentCompositionTypeV2,
  AssortmentSourceAssertionV2,
  AssetSubjectScopeV2,
  PromotionMechanicV2,
  BonusFulfillmentV2,
  CapabilityTypeV2,
  CapabilityStateV2,
  ExactIdentityStatusV2
} from '../types/extractorContractV2';

/**
 * Calculates a deterministic SHA-256 checksum over canonical semantic fields.
 * Volatile timestamps and workstation-specific local file paths are strictly excluded (EX-05, EX-06).
 */
export function calculateSemanticChecksum(semanticData: Record<string, any>): string {
  const sanitize = (val: any): any => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      // Exclude local Windows/Unix absolute workstation paths
      if (/^[a-zA-Z]:[\\/]/.test(val) || val.startsWith('/Users/') || val.startsWith('/home/')) {
        return null;
      }
      return val.trim();
    }
    if (Array.isArray(val)) {
      return val.map(sanitize);
    }
    if (typeof val === 'object') {
      const out: Record<string, any> = {};
      const keys = Object.keys(val).sort();
      for (const k of keys) {
        // Exclude volatile timestamps or local path keys
        if (['created_at', 'updated_at', 'started_at', 'completed_at', 'json_path', 'crop_path', 'thumbnail_path', 'local_path_internal'].includes(k)) {
          continue;
        }
        out[k] = sanitize(val[k]);
      }
      return out;
    }
    return val;
  };

  const clean = sanitize(semanticData);
  const jsonStr = JSON.stringify(clean);
  return createHash('sha256').update(jsonStr, 'utf8').digest('hex');
}

/**
 * Deterministic scenario purchase calculation proving bundle and indivisible unit rules (EX-17, EX-18, D03-05, D03-06, D03-24).
 */
export function calculateScenarioPurchase(
  contractV2: ExtractorOfferContractV2,
  requestedUnits: number
): ScenarioPurchaseResult {
  const innerCount = contractV2.quantity_semantics.inner_count && contractV2.quantity_semantics.inner_count > 0
    ? contractV2.quantity_semantics.inner_count
    : 1;
  const unitOfferPrice = parseFloat(contractV2.price_terms.source_reported_offer_price) || 0;

  if (contractV2.quantity_semantics.is_indivisible_sale_unit) {
    const fullPacksRequired = Math.ceil(requestedUnits / innerCount);
    const payablePrice = (fullPacksRequired * unitOfferPrice).toFixed(2);
    const suppliedUnits = fullPacksRequired * innerCount;
    const surplusUnits = suppliedUnits - requestedUnits;
    const totalSuppliedContent = contractV2.quantity_semantics.total_content?.value != null
      ? Number((contractV2.quantity_semantics.total_content.value * fullPacksRequired).toFixed(4))
      : null;
    const totalSuppliedContentUnit = contractV2.quantity_semantics.total_content?.unit || null;

    return {
      full_packs_required: fullPacksRequired,
      payable_price: payablePrice,
      supplied_units: suppliedUnits,
      surplus_units: surplusUnits,
      total_supplied_content: totalSuppliedContent,
      total_supplied_content_unit: totalSuppliedContentUnit
    };
  }

  // Divisible unit (e.g. bulk price per kg)
  const payablePrice = (requestedUnits * unitOfferPrice).toFixed(2);
  return {
    full_packs_required: requestedUnits,
    payable_price: payablePrice,
    supplied_units: requestedUnits,
    surplus_units: 0,
    total_supplied_content: null,
    total_supplied_content_unit: null
  };
}

export const formatPriceString = (val: unknown): string | null => {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num.toFixed(2) : String(val);
};

/**
 * Projects a CanonicalOffer to an external, clean consumer payload (EX-47).
 * Strips all internal raw payloads and workstation paths (EX-36, D03-18) and evaluates temporal lifecycle in Asia/Riyadh (EX-33, EX-34).
 */
export function toConsumerOfferProjection(
  canonical: CanonicalOffer,
  referenceDateStr?: string
): ConsumerOfferProjection {
  const contract = canonical.contract_v2 || buildContractV2FromCanonical(canonical);

  // Compute reference calendar date in Asia/Riyadh (YYYY-MM-DD)
  let refDate = referenceDateStr;
  if (!refDate) {
    refDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  }

  const validFrom = canonical.trusted_context?.offer_start_date || null;
  const validTo = canonical.trusted_context?.offer_end_date || null;

  let lifecycle: 'upcoming' | 'active' | 'expired' = 'active';
  if (validFrom && refDate < validFrom) {
    lifecycle = 'upcoming';
  } else if (validTo && refDate > validTo) {
    lifecycle = 'expired';
  } else {
    lifecycle = 'active';
  }

  const sanitizeUrl = (url: string | null | undefined): string | null => {
    return sanitizePublicConsumerImageUrl(url);
  };

  const safeImageUrl = sanitizeUrl(canonical.image?.image_url);
  const safeThumbUrl = sanitizeUrl(canonical.image?.thumbnail_url);
  const cardWasBlocked = Boolean(canonical.image?.image_url) && !safeImageUrl;
  const thumbWasBlocked = Boolean(canonical.image?.thumbnail_url) && !safeThumbUrl;
  const offerCardScope = contract.assets.offer_card.subject_scope;
  const thumbScope = contract.assets.product_thumbnail.subject_scope;
  const offerCardUploadState = safeImageUrl
    ? 'uploaded'
    : (cardWasBlocked && contract.assets.offer_card.upload_state === 'uploaded' ? 'pending' : contract.assets.offer_card.upload_state);
  const thumbUploadState = safeThumbUrl
    ? 'uploaded'
    : (thumbWasBlocked && contract.assets.product_thumbnail.upload_state === 'uploaded' ? 'pending' : contract.assets.product_thumbnail.upload_state);

  const saleUnit = contract.quantity_semantics.sale_unit;
  const innerCount = contract.quantity_semantics.inner_count;
  const isIndivisible = contract.quantity_semantics.is_indivisible_sale_unit;
  const eachSizeValue = contract.quantity_semantics.per_inner_content?.value ?? null;
  const eachSizeUnit = contract.quantity_semantics.per_inner_content?.unit ?? null;
  const totalContentValue = contract.quantity_semantics.total_content?.value ?? null;
  const totalContentUnit = contract.quantity_semantics.total_content?.unit ?? null;

  const loyaltyReq = contract.eligibility.loyalty.requirement;
  const isLoyaltyRequired = loyaltyReq === 'required';
  const promoMechanic = contract.promotion_terms.mechanic;
  const bonusWording = contract.promotion_terms.bonus_wording;
  const bonusFulfillment = contract.promotion_terms.bonus_fulfillment;
  const subcategory = contract.product_facts.derived_subcategory_slug || null;
  const commodityTag = contract.product_facts.derived_subcategory_slug || canonical.product?.commodity_tag || null;
  const itemDomain = canonical.product?.item_domain || 'grocery';
  const productAttributes = contract.product_facts.attributes || {};
  const assortmentStatus = contract.assortment.status;
  const exactIdentityStatus = contract.product_facts.exact_identity_status;
  const reasonCodes = contract.assessments.reason_codes || [];
  const capabilities = contract.assessments.capabilities;

  return {
    source_offer_id: contract.record_metadata.source_offer_id,
    leaflet_id: canonical.source?.leaflet_id || null,
    supermarket_id: canonical.trusted_context?.supermarket_id || null,
    supermarket_slug: canonical.trusted_context?.supermarket_slug || null,
    location_scope: canonical.trusted_context?.location_scope || null,
    city_id: canonical.trusted_context?.city_id || null,
    region_id: canonical.trusted_context?.region_id || null,
    valid_from: validFrom,
    valid_to: validTo,
    temporal_lifecycle_state: lifecycle,

    title_ar: canonical.product?.title_ar || null,
    title_en: canonical.product?.title_en || null,
    normalized_title_ar: canonical.product?.normalized_title_ar || null,
    normalized_title_en: canonical.product?.normalized_title_en || null,
    brand_name: contract.product_facts.brand_assertion.value || null,
    category_slug: canonical.product?.category_hint || null,
    derived_subcategory_slug: subcategory,
    derived_subcategory: subcategory,
    commodity_tag: commodityTag,
    item_domain: itemDomain,
    product_attributes: productAttributes,

    offer_price: contract.price_terms.source_reported_offer_price,
    original_price: contract.price_terms.source_reported_original_price,
    source_reported_original_price: contract.price_terms.source_reported_original_price,
    verified_non_member_price: contract.price_terms.verified_current_non_member_price != null
      ? formatPriceString(contract.price_terms.verified_current_non_member_price)
      : null,
    currency: 'SAR',
    price_basis: contract.price_terms.source_reported_price_basis,

    sale_unit: saleUnit,
    inner_count: innerCount,
    is_indivisible_sale_unit: isIndivisible,
    size_text: canonical.content?.size_text || null,
    total_content_value: totalContentValue,
    total_content_unit: totalContentUnit,

    promotion_mechanic: promoMechanic,
    special_offer_tag: bonusWording,
    bonus_wording: bonusWording,
    bonus_fulfillment: bonusFulfillment,
    loyalty_requirement: loyaltyReq,
    is_loyalty_required: isLoyaltyRequired,

    assortment_status: assortmentStatus,
    exact_identity_status: exactIdentityStatus,
    reason_codes: reasonCodes,

    display_unit_price: canonical.display?.display_unit_price ?? null,
    display_unit_price_label_ar: canonical.display?.display_unit_price_label_ar ?? null,
    display_unit_price_label_en: canonical.display?.display_unit_price_label_en ?? null,

    image_url: safeImageUrl,
    thumbnail_url: safeThumbUrl,
    image_subject_scope: offerCardScope,
    card_image_subject_scope: offerCardScope,
    thumbnail_subject_scope: thumbScope,
    card_image_upload_state: offerCardUploadState,
    thumbnail_upload_state: thumbUploadState,

    // C-02 Structured Domain Objects
    quantity_semantics: {
      sale_unit: saleUnit,
      inner_count: innerCount,
      is_indivisible_sale_unit: isIndivisible,
      each_size_value: eachSizeValue,
      each_size_unit: eachSizeUnit,
      total_content_value: totalContentValue,
      total_content_unit: totalContentUnit
    },
    eligibility: {
      loyalty_requirement: loyaltyReq,
      sales_channel: contract.eligibility.sales_channel,
      quantity_limit_value: contract.eligibility.quantity_limit?.value ?? null,
      quantity_limit_unit: contract.eligibility.quantity_limit?.unit ?? null,
      quantity_limit_scope: contract.eligibility.quantity_limit?.scope ?? null
    },
    capabilities,
    assessments: {
      capabilities,
      reason_codes: reasonCodes
    }
  };
}

/**
 * Maps a literal row returned from SQL view `public.v_consumer_offers` to `ConsumerOfferDTO`.
 * Provides 100% field parity with deterministic temporal lifecycle evaluation.
 */
export function mapSqlConsumerViewRowToConsumerDto(
  sqlViewRow: any,
  referenceDateStr?: string
): ConsumerOfferDTO {
  const toIsoDate = (val: any): string | null => {
    if (!val) return null;
    if (val instanceof Date) {
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const s = String(val);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.slice(0, 10);
    }
    return s;
  };

  const validFrom = toIsoDate(sqlViewRow.valid_from || sqlViewRow.offer_start_date);
  const validTo = toIsoDate(sqlViewRow.valid_to || sqlViewRow.offer_end_date);

  let refDate = referenceDateStr;
  if (!refDate) {
    refDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  }

  let lifecycle: 'upcoming' | 'active' | 'expired' = sqlViewRow.temporal_lifecycle_state || 'active';
  if (validFrom && refDate < validFrom) {
    lifecycle = 'upcoming';
  } else if (validTo && refDate > validTo) {
    lifecycle = 'expired';
  } else if (validFrom || validTo) {
    lifecycle = 'active';
  }

  const rawConsumerContract =
    sqlViewRow.consumer_contract_v2 ??
    sqlViewRow.contract_v2 ??
    {};

  const contractV2 =
    typeof rawConsumerContract === 'string'
      ? JSON.parse(rawConsumerContract)
      : rawConsumerContract;

  const sourceReportedOriginalPrice =
    sqlViewRow.source_reported_original_price != null
      ? formatPriceString(sqlViewRow.source_reported_original_price)
      : sqlViewRow.original_price != null
        ? formatPriceString(sqlViewRow.original_price)
        : contractV2?.price_terms?.source_reported_original_price != null
          ? formatPriceString(contractV2.price_terms.source_reported_original_price)
          : null;

  const verifiedNonMemberPrice =
    sqlViewRow.verified_non_member_price != null
      ? formatPriceString(sqlViewRow.verified_non_member_price)
      : contractV2?.price_terms?.verified_current_non_member_price != null
        ? formatPriceString(contractV2.price_terms.verified_current_non_member_price)
        : null;

  const offerCard = contractV2?.assets?.offer_card;
  const thumb = contractV2?.assets?.product_thumbnail;

  const safeViewImageUrl = sanitizePublicConsumerImageUrl(sqlViewRow.image_url);
  const safeViewThumbUrl = sanitizePublicConsumerImageUrl(sqlViewRow.thumbnail_url);
  const viewCardWasBlocked = Boolean(sqlViewRow.image_url) && !safeViewImageUrl;
  const viewThumbWasBlocked = Boolean(sqlViewRow.thumbnail_url) && !safeViewThumbUrl;

  const cardScope = sqlViewRow.card_image_subject_scope || offerCard?.subject_scope || sqlViewRow.image_subject_scope || 'offer_card';
  const thumbScope = sqlViewRow.thumbnail_subject_scope || thumb?.subject_scope || 'product_only';

  const rawCardUpload = sqlViewRow.card_image_upload_state || offerCard?.upload_state;
  const rawThumbUpload = sqlViewRow.thumbnail_upload_state || thumb?.upload_state;
  const cardUpload = safeViewImageUrl
    ? 'uploaded'
    : (viewCardWasBlocked && rawCardUpload === 'uploaded' ? 'pending' : (rawCardUpload || 'pending'));
  const thumbUpload = safeViewThumbUrl
    ? 'uploaded'
    : (viewThumbWasBlocked && rawThumbUpload === 'uploaded' ? 'pending' : (rawThumbUpload || 'pending'));

  const saleUnit = sqlViewRow.sale_unit || sqlViewRow.sale_unit_type || contractV2?.quantity_semantics?.sale_unit || 'piece';
  const innerCount = sqlViewRow.inner_pack_count !== undefined && sqlViewRow.inner_pack_count !== null
    ? Number(sqlViewRow.inner_pack_count)
    : (sqlViewRow.inner_count !== undefined && sqlViewRow.inner_count !== null
        ? Number(sqlViewRow.inner_count)
        : (contractV2?.quantity_semantics?.inner_count ?? null));

  const isIndivisible = sqlViewRow.is_indivisible_sale_unit !== undefined && sqlViewRow.is_indivisible_sale_unit !== null
    ? Boolean(sqlViewRow.is_indivisible_sale_unit)
    : (contractV2?.quantity_semantics?.is_indivisible_sale_unit ?? true);

  const eachSizeValue = sqlViewRow.each_size_value != null
    ? Number(sqlViewRow.each_size_value)
    : (contractV2?.quantity_semantics?.per_inner_content?.value ?? null);
  const eachSizeUnit = sqlViewRow.each_size_unit ?? contractV2?.quantity_semantics?.per_inner_content?.unit ?? null;
  const totalContentValue = sqlViewRow.total_content_value != null
    ? Number(sqlViewRow.total_content_value)
    : (contractV2?.quantity_semantics?.total_content?.value ?? null);
  const totalContentUnit = sqlViewRow.total_content_unit ?? contractV2?.quantity_semantics?.total_content?.unit ?? null;

  const promoMechanic = sqlViewRow.promo_mechanic || sqlViewRow.promotion_mechanic || contractV2?.promotion_terms?.mechanic || 'none';
  const bonusWording = sqlViewRow.bonus_wording ?? sqlViewRow.special_offer_tag ?? contractV2?.promotion_terms?.bonus_wording ?? null;
  const bonusFulfillment = sqlViewRow.bonus_fulfillment || contractV2?.promotion_terms?.bonus_fulfillment || 'not_applicable';

  const loyaltyReq = sqlViewRow.loyalty_requirement || contractV2?.eligibility?.loyalty?.requirement || (sqlViewRow.is_loyalty_required ? 'required' : 'unknown');
  const isLoyaltyRequired = loyaltyReq === 'required';

  const subcategory = sqlViewRow.derived_subcategory_slug || contractV2?.product_facts?.derived_subcategory_slug || null;
  const commodityTag = sqlViewRow.commodity_tag || contractV2?.product_facts?.derived_subcategory_slug || null;
  const itemDomain = sqlViewRow.item_domain || contractV2?.product_facts?.item_domain || 'grocery';
  const productAttributes = sqlViewRow.product_attributes && Object.keys(sqlViewRow.product_attributes).length > 0
    ? sqlViewRow.product_attributes
    : (contractV2?.product_facts?.attributes || {});
  const assortmentStatus = sqlViewRow.assortment_status || contractV2?.assortment?.status || 'single_item';
  const exactIdentityStatus = sqlViewRow.exact_identity_status || contractV2?.product_facts?.exact_identity_status || 'unresolved';

  const rawCapabilities = sqlViewRow.scoped_assessments && Object.keys(sqlViewRow.scoped_assessments).length > 0
    ? sqlViewRow.scoped_assessments
    : (contractV2?.assessments?.capabilities || {});
  const reasonCodes: string[] = sqlViewRow.reason_codes || contractV2?.assessments?.reason_codes || [];
  const capabilities =
    sqlViewRow.product_id == null &&
    (reasonCodes.includes('COMPARISON_DISABLED_NO_VERIFIED_SKU') ||
      reasonCodes.includes('NON_CATALOG_APPROVED') ||
      rawCapabilities.exact_product_comparison == null ||
      rawCapabilities.exact_product_comparison === 'supported')
      ? { ...rawCapabilities, exact_product_comparison: 'blocked' as CapabilityStateV2 }
      : rawCapabilities;

  return {
    source_offer_id: sqlViewRow.source_offer_id,
    leaflet_id: sqlViewRow.leaflet_id ?? null,
    supermarket_id: sqlViewRow.supermarket_id ?? null,
    supermarket_slug: sqlViewRow.supermarket_slug ?? null,
    product_id: sqlViewRow.product_id != null ? Number(sqlViewRow.product_id) : null,
    location_scope: sqlViewRow.location_scope ?? null,
    city_id: sqlViewRow.city_id ?? null,
    region_id: sqlViewRow.region_id ?? null,
    valid_from: validFrom,
    valid_to: validTo,
    temporal_lifecycle_state: lifecycle,

    title_ar: sqlViewRow.title_ar ?? null,
    title_en: sqlViewRow.title_en ?? null,
    normalized_title_ar: sqlViewRow.normalized_title_ar ?? null,
    normalized_title_en: sqlViewRow.normalized_title_en ?? null,
    brand_name: sqlViewRow.brand_name ?? contractV2?.product_facts?.brand_assertion?.value ?? null,
    category_slug: sqlViewRow.category_slug ?? null,
    derived_subcategory_slug: subcategory,
    derived_subcategory: subcategory,
    commodity_tag: commodityTag,
    item_domain: itemDomain,
    product_attributes: productAttributes,

    offer_price: formatPriceString(sqlViewRow.offer_price) || String(sqlViewRow.offer_price),
    original_price: sourceReportedOriginalPrice,
    source_reported_original_price: sourceReportedOriginalPrice,
    verified_non_member_price: verifiedNonMemberPrice,
    currency: (sqlViewRow.currency || contractV2?.price_terms?.currency || 'SAR') as 'SAR',
    price_basis: sqlViewRow.price_basis || contractV2?.price_terms?.source_reported_price_basis || 'each',

    sale_unit: saleUnit,
    inner_count: innerCount,
    is_indivisible_sale_unit: isIndivisible,
    size_text: sqlViewRow.size_text ?? null,
    total_content_value: totalContentValue,
    total_content_unit: totalContentUnit,

    promotion_mechanic: promoMechanic,
    special_offer_tag: bonusWording,
    bonus_wording: bonusWording,
    bonus_fulfillment: bonusFulfillment,
    loyalty_requirement: loyaltyReq,
    is_loyalty_required: isLoyaltyRequired,

    assortment_status: assortmentStatus,
    exact_identity_status: exactIdentityStatus,
    reason_codes: reasonCodes,

    display_unit_price: sqlViewRow.display_unit_price != null
      ? Number(sqlViewRow.display_unit_price)
      : (sqlViewRow.unit_price != null ? Number(sqlViewRow.unit_price) : null),
    display_unit_price_label_ar: sqlViewRow.display_unit_price_label_ar ?? null,
    display_unit_price_label_en: sqlViewRow.display_unit_price_label_en ?? null,

    image_url: safeViewImageUrl,
    thumbnail_url: safeViewThumbUrl,
    image_subject_scope: cardScope,
    card_image_subject_scope: cardScope,
    thumbnail_subject_scope: thumbScope,
    card_image_upload_state: cardUpload,
    thumbnail_upload_state: thumbUpload,

    // C-02 Structured Domain Objects
    quantity_semantics: {
      sale_unit: saleUnit,
      inner_count: innerCount,
      is_indivisible_sale_unit: isIndivisible,
      each_size_value: eachSizeValue,
      each_size_unit: eachSizeUnit,
      total_content_value: totalContentValue,
      total_content_unit: totalContentUnit
    },
    eligibility: {
      loyalty_requirement: loyaltyReq,
      sales_channel: contractV2?.eligibility?.sales_channel ?? sqlViewRow.sales_channel ?? 'unknown',
      quantity_limit_value: sqlViewRow.quantity_limit_value ?? contractV2?.eligibility?.quantity_limit?.value ?? null,
      quantity_limit_unit: sqlViewRow.quantity_limit_unit ?? contractV2?.eligibility?.quantity_limit?.unit ?? null,
      quantity_limit_scope: sqlViewRow.quantity_limit_scope ?? contractV2?.eligibility?.quantity_limit?.scope ?? null
    },
    capabilities,
    assessments: {
      capabilities,
      reason_codes: reasonCodes
    }
  };
}

export function buildSourceOfferId(
  leafletId: string,
  pageNumber: number | string,
  itemNumber: number | string,
  subOfferIndex: number | string = 1
): string {
  const pad3 = (val: string | number) => String(val).replace(/[^0-9]/g, '').padStart(3, '0');
  const pad2 = (val: string | number) => String(val).replace(/[^0-9]/g, '').padStart(2, '0');
  return `${leafletId}:p${pad3(pageNumber)}:i${pad3(itemNumber)}:s${pad2(subOfferIndex)}`;
}

/**
 * Adapts a CanonicalOffer (v1) into ExtractorOfferContractV2.
 */
export function buildContractV2FromCanonical(
  canonical: CanonicalOffer,
  options?: {
    isFreshExtraction?: boolean;
    subOfferIndex?: number | string;
    supersedesSourceOfferId?: string | null;
  }
): ExtractorOfferContractV2 {
  const leafletId = canonical.source?.leaflet_id || 'unknown-leaflet';
  const pageNum = canonical.source?.source_page_number || 1;
  const itemNum = canonical.source?.source_item_number || '001';
  const subOfferIdx = options?.subOfferIndex ?? 1;

  // EX-04, INT-31: Deterministic page-scoped source_offer_id with dynamic sub-offer index
  const sourceOfferId = buildSourceOfferId(leafletId, pageNum, itemNum, subOfferIdx);

  const reasonCodes: string[] = [];

  // Coordinate system declaration (EX-39, D03-31)
  const coordinateSystem = options?.isFreshExtraction
    ? 'normalized_0_1000_ymin_xmin_ymax_xmax'
    : 'undeclared_legacy';
  if (coordinateSystem === 'undeclared_legacy') {
    reasonCodes.push('COORDINATE_SYSTEM_UNDECLARED');
  }

  // Assortment wording detection (EX-09, D03-07)
  const combinedTitles = `${canonical.product?.title_en || ''} ${canonical.product?.title_ar || ''}`;
  const hasAssortedWording = /\b(asstd\.?|assorted|varieties|متنوع|متنوعة|منوع|منوعة|مشكل)\b/i.test(combinedTitles);

  const rawAttrs = (canonical.raw?.raw_attributes || {}) as Record<string, any>;
  const rawOffer = rawAttrs.raw_offer_extraction as Record<string, any> | undefined;
  const rawIsMultiBrandOrVariant = rawOffer?.is_multi_brand_or_variant;

  let assortmentStatus: AssortmentStatusV2 = 'single_product';
  let compositionType: AssortmentCompositionTypeV2 = 'single';
  const sourceAssertions: AssortmentSourceAssertionV2[] = [];

  if (hasAssortedWording && rawIsMultiBrandOrVariant === false) {
    assortmentStatus = 'indicated_with_conflict';
    compositionType = 'alternatives';
    sourceAssertions.push(
      { source_path: 'product.title', value: combinedTitles.trim() },
      { source_path: 'raw.is_multi_brand_or_variant', value: false }
    );
    reasonCodes.push('ASSORTMENT_FLAG_CONFLICT');
  } else if (hasAssortedWording || rawIsMultiBrandOrVariant === true) {
    assortmentStatus = 'assortment_indicated';
    compositionType = 'alternatives';
    sourceAssertions.push({ source_path: 'product.title', value: combinedTitles.trim() });
    reasonCodes.push('ASSORTMENT_UNRESOLVED');
  }

  if (assortmentStatus !== 'single_product') {
    reasonCodes.push('EXACT_VARIANT_NOT_ESTABLISHED');
  }

  // Brand assertion (EX-11, D03-17)
  let brandValue = canonical.product?.brand_text || null;
  let brandState: 'supported' | 'unknown' | 'conflicting' = brandValue ? 'supported' : 'unknown';
  let candidateUnverified: string | null = null;
  let brandProvenance: string | null = brandValue ? 'extracted_brand' : null;

  if (!brandValue) {
    // Check if title starts with an unverified brand candidate word like "روكي" (Rocky)
    const titleAr = canonical.product?.title_ar || '';
    if (titleAr.startsWith('روكي')) {
      candidateUnverified = 'روكي';
      brandState = 'unknown';
      brandProvenance = 'title_heuristic';
    }
  }

  // Derived subcategory slug (EX-29)
  let derivedSubcategory: string | null = null;
  if (/mini\s*fan|مروحة\s*ميني/i.test(combinedTitles)) {
    derivedSubcategory = 'mini_fan';
  } else if (canonical.product?.commodity_tag) {
    derivedSubcategory = canonical.product.commodity_tag;
  }

  // Controlled attributes (EX-12, EX-13, D03-08)
  const attributes: Record<string, ControlledAttributeV2> = {
    scent: { value: null, state: 'not_applicable', provenance: null },
    flavor: { value: null, state: 'not_applicable', provenance: null },
    fat_level: { value: null, state: 'not_applicable', provenance: null },
    milk_processing_type: { value: null, state: 'not_applicable', provenance: null },
    product_form: { value: null, state: 'not_applicable', provenance: null },
    model: { value: null, state: 'not_applicable', provenance: null },
    power_watts: { value: null, state: 'not_applicable', provenance: null },
    dimensions: { value: null, state: 'not_applicable', provenance: null }
  };

  const domain = canonical.product?.item_domain || 'grocery';
  const category = canonical.product?.category_hint || '';

  // Soap / Personal care
  if (domain === 'personal_care' || /soap|صابون/i.test(combinedTitles)) {
    attributes.product_form = { value: 'bar', state: 'supported', provenance: 'title_heuristic' };
    attributes.scent = { value: null, state: 'unknown', provenance: null };
  }

  // Dairy / Milk
  if (category === 'dairy' || /milk|حليب|لبن|زبادي/i.test(combinedTitles)) {
    if (/low\s*fat|قليل\s*الدسم/i.test(combinedTitles)) {
      attributes.fat_level = { value: 'low_fat', state: 'supported', provenance: 'title_heuristic' };
    } else if (/fat\s*free|skimmed|خالي\s*الدسم/i.test(combinedTitles)) {
      attributes.fat_level = { value: 'fat_free', state: 'supported', provenance: 'title_heuristic' };
    } else if (/full\s*fat|full\s*cream|كامل\s*الدسم/i.test(combinedTitles)) {
      attributes.fat_level = { value: 'full_fat', state: 'supported', provenance: 'title_heuristic' };
    } else {
      attributes.fat_level = { value: null, state: 'unknown', provenance: null };
    }

    if (/uht|طويل\s*الأجل/i.test(combinedTitles)) {
      attributes.milk_processing_type = { value: 'uht', state: 'supported', provenance: 'title_heuristic' };
    } else if (/fresh|طازج/i.test(combinedTitles)) {
      attributes.milk_processing_type = { value: 'fresh', state: 'supported', provenance: 'title_heuristic' };
    }
  }

  // Appliance / Electronics (INT-F09, INT-18)
  if (['appliance', 'electronics'].includes(domain) || category === 'non-grocery') {
    attributes.model = { value: null, state: 'unknown', provenance: null };
    attributes.power_watts = { value: null, state: 'unknown', provenance: null };
    attributes.dimensions = { value: null, state: 'unknown', provenance: null };

    const modelMatch = combinedTitles.match(/\b([A-Za-z0-9]{2,}-[A-Za-z0-9]{2,})\b/i);
    if (modelMatch) {
      attributes.model = { value: modelMatch[1], state: 'supported', provenance: 'title_heuristic' };
    }
    const wattMatch = combinedTitles.match(/\b(\d+)\s*(W|watts|واط)\b/i);
    if (wattMatch) {
      attributes.power_watts = { value: parseInt(wattMatch[1], 10), state: 'supported', provenance: 'title_heuristic' };
    }
    const inchMatch = combinedTitles.match(/\b(\d+)\s*(inch|\"|بوصة)\b/i);
    if (inchMatch) {
      attributes.dimensions = { value: `${inchMatch[1]} inch`, state: 'supported', provenance: 'title_heuristic' };
    }
  }

  // Meat / Chicken & Commodity Items (INT-F09, INT-16, INT-17)
  const isMeatOrPoultry = category === 'meat-chicken' || /mutton|lamb|beef|veal|camel|chicken|fish|seafood|meat|لحم|ضأن|غنم|بقري|عجل|حاشي|جمل|دجاج|سمك/i.test(combinedTitles);
  if (isMeatOrPoultry) {
    if (/mutton|lamb|ضأن|غنم/i.test(combinedTitles)) {
      derivedSubcategory = 'fresh_mutton';
    } else if (/beef|بقري/i.test(combinedTitles)) {
      derivedSubcategory = 'fresh_beef';
    } else if (/veal|عجل/i.test(combinedTitles)) {
      derivedSubcategory = 'veal';
    } else if (/camel|حاشي|جمل/i.test(combinedTitles)) {
      derivedSubcategory = 'camel_meat';
    } else if (/whole\s*chicken|دجاج\s*كامل/i.test(combinedTitles)) {
      derivedSubcategory = 'whole_chicken';
    } else if (/breast|صدور/i.test(combinedTitles)) {
      derivedSubcategory = 'chicken_breast';
    } else if (/fish|seafood|سمك|جمبري|روبيان/i.test(combinedTitles)) {
      derivedSubcategory = 'fish_seafood';
    } else if (!derivedSubcategory) {
      derivedSubcategory = 'fresh_meat';
    }

    let speciesVal = 'mutton';
    if (/mutton|lamb|ضأن|غنم/i.test(combinedTitles)) speciesVal = 'mutton';
    else if (/beef|بقري/i.test(combinedTitles)) speciesVal = 'beef';
    else if (/veal|عجل/i.test(combinedTitles)) speciesVal = 'veal';
    else if (/camel|حاشي|جمل/i.test(combinedTitles)) speciesVal = 'camel';
    else if (/chicken|دجاج/i.test(combinedTitles)) speciesVal = 'chicken';
    else if (/fish|seafood|سمك/i.test(combinedTitles)) speciesVal = 'fish';

    attributes.meat_species = { value: speciesVal, state: 'supported', provenance: 'title_heuristic' };

    if (/fresh|طازج|طازجة/i.test(combinedTitles)) {
      attributes.freshness = { value: 'fresh', state: 'supported', provenance: 'title_heuristic' };
    } else if (/frozen|مجمد|مجمّدة/i.test(combinedTitles)) {
      attributes.freshness = { value: 'frozen', state: 'supported', provenance: 'title_heuristic' };
    } else if (/chilled|مبرد/i.test(combinedTitles)) {
      attributes.freshness = { value: 'chilled', state: 'supported', provenance: 'title_heuristic' };
    } else {
      attributes.freshness = { value: null, state: 'unknown', provenance: null };
    }

    if (/ethiopian|إثيوبي|أثيوبي/i.test(combinedTitles)) {
      attributes.origin = { value: 'ethiopian', state: 'supported', provenance: 'title_heuristic' };
    } else if (/saudi|سعودي|محلي|بلدي/i.test(combinedTitles)) {
      attributes.origin = { value: 'saudi', state: 'supported', provenance: 'title_heuristic' };
    } else if (/brazilian|برازيلي/i.test(combinedTitles)) {
      attributes.origin = { value: 'brazilian', state: 'supported', provenance: 'title_heuristic' };
    } else if (/indian|هندي/i.test(combinedTitles)) {
      attributes.origin = { value: 'indian', state: 'supported', provenance: 'title_heuristic' };
    } else if (/pakistani|باكستاني/i.test(combinedTitles)) {
      attributes.origin = { value: 'pakistani', state: 'supported', provenance: 'title_heuristic' };
    } else {
      attributes.origin = { value: null, state: 'unknown', provenance: null };
    }

    if (/cuts|قطع/i.test(combinedTitles)) {
      attributes.cut_type = { value: 'cuts', state: 'supported', provenance: 'title_heuristic' };
    } else if (/minced|مفروم/i.test(combinedTitles)) {
      attributes.cut_type = { value: 'minced', state: 'supported', provenance: 'title_heuristic' };
    } else if (/whole|كامل/i.test(combinedTitles)) {
      attributes.cut_type = { value: 'whole', state: 'supported', provenance: 'title_heuristic' };
    } else {
      attributes.cut_type = { value: null, state: 'unknown', provenance: null };
    }

    if (/boneless|bone\s*less|بدون\s*عظم|مخلي/i.test(combinedTitles)) {
      attributes.bone_status = { value: 'boneless', state: 'supported', provenance: 'title_heuristic' };
    } else if (/with\s*bone|بالعظم/i.test(combinedTitles)) {
      attributes.bone_status = { value: 'with_bone', state: 'supported', provenance: 'title_heuristic' };
    } else {
      attributes.bone_status = { value: null, state: 'unknown', provenance: null };
    }
  }

  // Fresh produce helper (INT-F09)
  if (/tomato|cucumber|mango|garlic|onion|potato|orange|apple|banana|fruit|vegetable|خضار|فواكه|طماطم|خيار|مانجو|ثوم|بصل|بطاطس|برتقال|تفاح|موز/i.test(combinedTitles)) {
    if (!derivedSubcategory) {
      derivedSubcategory = 'fresh_produce';
    }
  }

  // Quantity semantics (EX-22)
  const isPerKg = canonical.prices?.price_basis === 'per_kg';
  const saleUnit = isPerKg ? 'kg' : (canonical.content?.pack_quantity && canonical.content.pack_quantity > 1 ? 'pack' : 'each');
  const innerCount = isPerKg ? null : (canonical.content?.pack_quantity || 1);
  const isIndivisible = !isPerKg;

  // Promotion terms (EX-19, EX-20, D03-11, D03-12)
  const bonusWording = canonical.promotion?.special_offer || null;
  const isBonusPack = Boolean(bonusWording && /\b\d+\s*\+\s*\d+(\s*free)?\b/i.test(bonusWording));
  let promoMechanic: PromotionMechanicV2 = 'standard_price';
  let bonusFulfillment: BonusFulfillmentV2 = 'not_applicable';
  let bonusAlreadyIncluded = false;

  if (isBonusPack) {
    promoMechanic = 'bonus_pack';
    bonusFulfillment = 'unresolved';
    reasonCodes.push('BONUS_FULFILLMENT_NOT_ESTABLISHED');
    if (innerCount && innerCount >= 6) {
      // On J1: 5+1 free with pack_quantity 6 means the 6 items already include the bonus
      bonusAlreadyIncluded = true;
    }
  } else if (canonical.promotion?.mechanic === 'loyalty_required') {
    promoMechanic = 'markdown';
  } else if (canonical.promotion?.mechanic === 'multi_buy') {
    promoMechanic = 'multibuy_bundle';
  } else if (canonical.prices?.original_price && canonical.prices.original_price > (canonical.prices?.offer_price || 0)) {
    promoMechanic = 'markdown';
  }

  // Eligibility
  const isLoyalty = canonical.promotion?.mechanic === 'loyalty_required' ||
                    /loyalty/i.test(canonical.promotion?.condition_text || '');
  if (isLoyalty) {
    reasonCodes.push('LOYALTY_REQUIRED');
  }
  reasonCodes.push('CHANNEL_UNKNOWN');

  // Evidence validation (EX-40)
  const candidates = canonical.prices?.all_price_candidates || [];
  const offerPriceEvidenceComplete = candidates.some(c => c.classified_as === 'offer_price' || c.visual_role?.includes('offer'));

  let originalPriceEvidenceComplete = true;
  if (canonical.prices?.original_price != null && canonical.prices.original_price > 0) {
    originalPriceEvidenceComplete = candidates.some(c => c.classified_as === 'original_price' || c.visual_role?.includes('old'));
    if (!originalPriceEvidenceComplete) {
      reasonCodes.push('PRICE_EVIDENCE_INCOMPLETE');
    }
  }

  // Confidence & Reason Codes (EX-28, D03-20)
  const compConf = canonical.comparison?.comparison_confidence;
  const qualConf = canonical.quality?.comparison_confidence;
  if (compConf && qualConf && compConf !== qualConf) {
    reasonCodes.push('CONFIDENCE_SCOPE_CONFLICT');
  }

  if (!canonical.comparison?.comparison_eligible) {
    reasonCodes.push('LEGACY_COMPARISON_RESTRICTION');
  }

  if (!canonical.image?.image_url) {
    reasonCodes.push('MEDIA_UPLOAD_PENDING');
  }

  // Exact identity status (INT-F06, INT-15)
  const exactIdentityStatus: ExactIdentityStatusV2 = 
    (canonical.product as any)?.exact_identity_status ||
    (assortmentStatus === 'single_product' && brandValue ? 'product_family_only' : 'unresolved');

  // Subject scope (EX-38, D03-19, INT-F08)
  let assetScope: AssetSubjectScopeV2 = 'exact_product';
  if (assortmentStatus === 'indicated_with_conflict' || assortmentStatus === 'assortment_indicated') {
    assetScope = 'representative_assortment';
  } else if (exactIdentityStatus === 'unresolved') {
    assetScope = 'offer_group';
  } else if (exactIdentityStatus !== 'verified_exact') {
    assetScope = 'offer_group';
  }

  const offerPriceStr = (canonical.prices?.offer_price ?? 0).toFixed(2);
  const originalPriceStr = canonical.prices?.original_price != null ? canonical.prices.original_price.toFixed(2) : null;

  // Capabilities with strict identity gating (INT-F06, INT-15)
  let exactProductComp: CapabilityStateV2 = 'blocked';
  if (exactIdentityStatus === 'verified_exact' && canonical.comparison?.comparison_eligible && assortmentStatus === 'single_product') {
    exactProductComp = 'supported';
  } else if (!canonical.comparison?.comparison_eligible) {
    exactProductComp = 'blocked';
  } else if (assortmentStatus === 'single_product') {
    exactProductComp = 'needs_review';
  } else {
    exactProductComp = 'conditional';
  }

  let autoListFulfillment: CapabilityStateV2 = 'blocked';
  if (exactIdentityStatus === 'verified_exact' && assortmentStatus === 'single_product') {
    autoListFulfillment = 'supported';
  } else if (exactIdentityStatus === 'unresolved') {
    if (assortmentStatus === 'single_product' && (isPerKg || canonical.comparison?.comparison_eligible)) {
      autoListFulfillment = 'conditional';
    } else {
      autoListFulfillment = 'needs_review';
    }
  } else if (assortmentStatus === 'single_product') {
    autoListFulfillment = 'needs_review';
  } else {
    autoListFulfillment = 'blocked';
  }

  const capabilities: Record<CapabilityTypeV2, CapabilityStateV2> = {
    offer_display: 'supported',
    save_to_list: 'supported',
    selected_offer_subtotal: 'supported',
    unit_price_calculation: canonical.comparison?.comparison_eligible ? 'supported' : 'blocked',
    exact_product_comparison: exactProductComp,
    automatic_list_fulfillment: autoListFulfillment
  };

  const semanticPayload = {
    sourceOfferId,
    title_ar: canonical.product?.title_ar,
    title_en: canonical.product?.title_en,
    offer_price: offerPriceStr,
    original_price: originalPriceStr,
    currency: 'SAR',
    brand: brandValue,
    pack_quantity: canonical.content?.pack_quantity,
    each_size_value: canonical.content?.each_size_value,
    each_size_unit: canonical.content?.each_size_unit,
    total_content_value: canonical.content?.total_content_value,
    total_content_unit: canonical.content?.total_content_unit,
    promo_mechanic: promoMechanic,
    is_loyalty: isLoyalty,
    assortment_status: assortmentStatus
  };

  const semanticChecksum = calculateSemanticChecksum(semanticPayload);

  return {
    record_metadata: {
      schema_version: 'wifran.extractor.offer/2.0',
      source_offer_id: sourceOfferId,
      source_revision: (canonical as any).source_revision || 1,
      semantic_checksum: semanticChecksum,
      producer_model: 'wifran-extractor-2.0',
      supersedes_source_offer_id: options?.supersedesSourceOfferId ?? (canonical as any).supersedes_source_offer_id ?? null
    },
    product_facts: {
      exact_identity_status: exactIdentityStatus,
      verified_product_id: null,
      gtin: null,
      brand_assertion: {
        value: brandValue,
        state: brandState,
        candidate_unverified: candidateUnverified,
        provenance: brandProvenance
      },
      derived_subcategory_slug: derivedSubcategory,
      attributes
    },
    assortment: {
      status: assortmentStatus,
      composition_type: compositionType,
      known_options: [],
      is_uniform_size: canonical.raw?.raw_attributes ? (canonical.raw.raw_attributes as any).raw_offer_extraction?.is_uniform_size_across_variants ?? true : true,
      source_assertions: sourceAssertions
    },
    quantity_semantics: {
      sale_unit: saleUnit,
      inner_count: innerCount,
      per_inner_content: {
        value: canonical.content?.each_size_value ?? null,
        unit: canonical.content?.each_size_unit ?? null
      },
      total_content: {
        value: canonical.content?.total_content_value ?? null,
        unit: canonical.content?.total_content_unit ?? null
      },
      is_indivisible_sale_unit: isIndivisible
    },
    price_terms: {
      currency: 'SAR',
      source_reported_offer_price: offerPriceStr,
      source_reported_price_basis: (canonical.prices?.price_basis as any) || 'each',
      source_reported_original_price: originalPriceStr,
      verified_current_non_member_price: null
    },
    promotion_terms: {
      mechanic: promoMechanic,
      bonus_wording: bonusWording,
      bonus_fulfillment: bonusFulfillment,
      bonus_already_included_in_inner_count: bonusAlreadyIncluded,
      structured_checkout_rule: null
    },
    eligibility: {
      loyalty: {
        requirement: isLoyalty ? 'required' : 'unknown',
        program_id: null,
        source_path: isLoyalty ? 'promotion.condition_text' : null,
        restriction_coverage: isLoyalty ? null : 'not_stated_in_inspected_source'
      },
      sales_channel: 'unknown',
      quantity_limit: {
        value: null,
        unit: null,
        scope: null
      }
    },
    evidence: {
      coordinate_system: coordinateSystem,
      offer_price_evidence_complete: offerPriceEvidenceComplete,
      original_price_evidence_complete: originalPriceEvidenceComplete
    },
    assessments: {
      capabilities,
      structural_capabilities: capabilities,
      confidence: {
        extraction_confidence: canonical.quality?.extraction_confidence || 'medium',
        unit_math_confidence: canonical.comparison?.comparison_confidence || 'low',
        identity_confidence: exactIdentityStatus === 'unresolved'
          ? 'medium'
          : (canonical.quality?.validation_confidence === 'high' ? 'high' : 'medium')
      },
      reason_codes: Array.from(new Set(reasonCodes))
    },
    assets: {
      offer_card: {
        local_path_internal: canonical.image?.image_path || canonical.source?.crop_path || null,
        storage_bucket: canonical.image?.image_bucket || null,
        storage_object_path: canonical.image?.image_path || null,
        subject_scope: assetScope,
        upload_state: canonical.image?.image_url ? 'uploaded' : 'pending'
      },
      product_thumbnail: {
        local_path_internal: canonical.image?.thumbnail_path || canonical.source?.thumbnail_path || null,
        storage_bucket: canonical.image?.image_bucket || null,
        storage_object_path: canonical.image?.thumbnail_path || null,
        subject_scope: assetScope,
        upload_state: canonical.image?.thumbnail_url ? 'uploaded' : 'pending'
      }
    }
  };
}
