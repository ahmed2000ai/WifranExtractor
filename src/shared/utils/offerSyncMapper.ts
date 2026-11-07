import { OfferSyncIssue } from '../../shared/types/offerSync'

function sanitizeStorageValue(val: string | null | undefined): string | null {
  if (!val) return null
  // EX-36: Ensure no local Windows path is ever written to storage or image URL fields
  if (/^[a-zA-Z]:[\\/]/.test(val) || val.includes('\\Work\\') || val.includes('/Work/')) {
    return null
  }
  return val
}

export function mapPreparedPayloadToOffersInsert(input: {
  preparedPayload: any
  imageUrl: string | null
  storageBucket: string | null
  storagePath: string | null
  thumbnailUrl?: string | null
  thumbnailStoragePath?: string | null
  sourceId: string | null
  includeV2Columns?: boolean
  createdBy?: string | null
}): {
  payload: Record<string, any> | null
  issues: OfferSyncIssue[]
} {
  const issues: OfferSyncIssue[] = []
  const prep = input.preparedPayload
  const includeV2 = input.includeV2Columns !== false

  if (!prep) {
    issues.push({ severity: 'error', code: 'MISSING_PAYLOAD', message: 'No prepared payload provided.' })
    return { payload: null, issues }
  }

  // Required Field Checks
  const supermarketId = prep.supermarket_id || prep.trusted_context?.supermarket_id
  if (!supermarketId) issues.push({ severity: 'error', code: 'MISSING_SUPERMARKET_ID', message: 'Supermarket ID required.' })

  // B-04: Validate geography strictly by location_scope
  const cityId = prep.city_id ?? prep.trusted_context?.city_id ?? null
  const regionId = prep.region_id ?? prep.trusted_context?.region_id ?? null
  const scope = prep.location_scope || prep.trusted_context?.location_scope || (cityId ? 'city' : (regionId ? 'region' : 'national'))
  if (scope === 'national') {
    if (cityId || regionId) {
      issues.push({
        severity: 'error',
        code: 'INVALID_NATIONAL_LOCATION_COMBINATION',
        message: 'National offers cannot have city_id or region_id.'
      })
    }
  } else if (scope === 'region') {
    if (!regionId) {
      issues.push({
        severity: 'error',
        code: 'MISSING_REGION_ID',
        message: 'Region offers require region_id.'
      })
    }
    if (cityId) {
      issues.push({
        severity: 'error',
        code: 'INVALID_REGION_LOCATION_COMBINATION',
        message: 'Region offers cannot have city_id.'
      })
    }
  } else if (scope === 'city') {
    if (!cityId) {
      issues.push({
        severity: 'error',
        code: 'MISSING_CITY_ID',
        message: 'City offers require city_id.'
      })
    }
  } else {
    issues.push({
      severity: 'error',
      code: 'INVALID_LOCATION_SCOPE',
      message: `Invalid location scope: ${scope}`
    })
  }

  const titleAr = prep.title_ar || prep.product?.title_ar
  const titleEn = prep.title_en || prep.product?.title_en
  if (!titleAr && !titleEn) issues.push({ severity: 'error', code: 'MISSING_TITLE', message: 'Title required.' })

  const offerPrice = prep.offer_price ?? prep.prices?.offer_price
  if (!offerPrice || offerPrice <= 0) issues.push({ severity: 'warning', code: 'MISSING_VALID_OFFER_PRICE', message: 'Offer price is missing or invalid. Set to 0.' })
  const offerEndDate = prep.offer_end_date || prep.trusted_context?.offer_end_date
  if (!offerEndDate) issues.push({ severity: 'error', code: 'MISSING_OFFER_END_DATE', message: 'Offer end date required.' })

  if (issues.some(i => i.severity === 'error')) {
    return { payload: null, issues }
  }

  const v2 = prep.contract_v2 ? JSON.parse(JSON.stringify(prep.contract_v2)) : null
  const sanitizedImageUrl = sanitizeStorageValue(input.imageUrl)
  const sanitizedStoragePath = sanitizeStorageValue(input.storagePath)
  const sanitizedThumbUrl = sanitizeStorageValue(input.thumbnailUrl || prep.thumbnail_url)
  const sanitizedThumbStoragePath = sanitizeStorageValue(input.thumbnailStoragePath || prep.thumbnail_storage_path)

  // B-09 / MEDIA-01: Reconcile contract_v2 assets when uploaded
  const isMediaUploaded = Boolean(sanitizedImageUrl || sanitizedStoragePath || sanitizedThumbUrl || sanitizedThumbStoragePath)
  if (v2?.assets) {
    if (v2.assets.offer_card) {
      if (sanitizedImageUrl) {
        v2.assets.offer_card.upload_state = 'uploaded'
        v2.assets.offer_card.delivery_url = sanitizedImageUrl
      }
      if (sanitizedStoragePath) {
        v2.assets.offer_card.storage_object_path = sanitizedStoragePath
      }
      if (input.storageBucket) {
        v2.assets.offer_card.storage_bucket = input.storageBucket
      }
      v2.assets.offer_card.local_path_internal = null
    }

    if (v2.assets.product_thumbnail) {
      if (sanitizedThumbUrl) {
        v2.assets.product_thumbnail.upload_state = 'uploaded'
        v2.assets.product_thumbnail.delivery_url = sanitizedThumbUrl
      }
      if (sanitizedThumbStoragePath) {
        v2.assets.product_thumbnail.storage_object_path = sanitizedThumbStoragePath
      }
      if (input.storageBucket) {
        v2.assets.product_thumbnail.storage_bucket = input.storageBucket
      }
      v2.assets.product_thumbnail.local_path_internal = null
    }
  }

  // Strip MEDIA_UPLOAD_PENDING from reason codes when media is uploaded
  let reasonCodes: string[] = v2?.assessments?.reason_codes || prep.reason_codes || []
  if (isMediaUploaded) {
    reasonCodes = reasonCodes.filter(c => c !== 'MEDIA_UPLOAD_PENDING')
    if (v2?.assessments) {
      v2.assessments.reason_codes = reasonCodes
    }
  }

  const isLoyaltyRequired = v2?.eligibility?.loyalty?.requirement === 'required' || Boolean(prep.is_loyalty_required)

  const payload: Record<string, any> = {
    // 001 Base Fields
    product_id: prep.product_id || null,
    supermarket_id: supermarketId,
    location_scope: scope,
    city_id: cityId,
    region_id: regionId,
    category_id: prep.category_id || null,
    brand_id: prep.brand_id || null,

    title_ar: titleAr || null,
    title_en: titleEn || null,

    offer_price: offerPrice || 0,
    original_price: prep.original_price ?? prep.prices?.original_price ?? null,
    discount_amount: prep.discount_amount || null,
    discount_percentage: prep.discount_percentage || null,

    pack_size_value: prep.pack_size_value || null,
    pack_size_unit: prep.pack_size_unit || null,
    pack_quantity: prep.pack_quantity || null,
    unit_price: prep.unit_price ?? prep.display?.display_unit_price ?? prep.comparison?.unit_price ?? null,
    unit_price_unit: prep.unit_price_unit ?? prep.display?.display_unit_price_label_en ?? prep.comparison?.comparison_unit ?? null,

    offer_start_date: prep.offer_start_date || prep.trusted_context?.offer_start_date || null,
    offer_end_date: offerEndDate,
    status: prep.status === 'needs_review'
      ? 'needs_review'
      : prep.status === 'draft'
      ? 'draft'
      : (prep.status === 'published' || prep.quality?.publish_decision === 'publish' || prep.quality?.publish_decision === 'publish_but_exclude_from_comparison')
      ? 'published'
      : 'needs_review',

    image_url: sanitizedImageUrl,
    image_path: sanitizedStoragePath,
    image_bucket: input.storageBucket || null,
    image_source_type: prep.image_source_type || 'external_tool',
    // B-05: Use only the canonical public.offers column source_id (not offer_source_id)
    source_id: prep.source_id || prep.offer_source_id || input.sourceId || null,
    source_page_number: prep.source_page_number || prep.source?.source_page_number || 1,
    source_item_number: prep.source_item_number || prep.source?.source_item_number || null,
    source_reference: prep.source_reference || null,
    external_image_id: prep.external_image_id || prep.source?.external_image_id || null,

    deal_score: prep.deal_score || null,
    deal_label: prep.deal_label || null,
    data_quality_score: prep.data_quality_score || 0,

    is_loyalty_required: isLoyaltyRequired,
    loyalty_notes_ar: prep.loyalty_notes_ar || null,
    loyalty_notes_en: prep.loyalty_notes_en || null,

    quantity_limit: prep.quantity_limit || null,
    notes_ar: prep.notes_ar || null,
    notes_en: prep.notes_en || null,
    
    // B-06: Set created_by to input.createdBy ?? null (never a hardcoded zero UUID)
    created_by: input.createdBy ?? null
  }

  // 005 wifran.extractor.offer/2.0 Additive Columns
  if (includeV2) {
    const pagePadded = String(prep.source_page_number || 1).padStart(3, '0')
    const itemPadded = String(prep.source_item_number || '001').padStart(3, '0')
    const fallbackSourceOfferId = `${prep.leaflet_id || 'unknown'}:p${pagePadded}:i${itemPadded}:s01`

    payload.source_offer_id = v2?.record_metadata?.source_offer_id || prep.source_offer_id || fallbackSourceOfferId
    payload.source_revision = v2?.record_metadata?.source_revision ?? prep.source_revision ?? 1
    payload.semantic_checksum = v2?.record_metadata?.semantic_checksum || prep.semantic_checksum || null
    payload.contract_version = v2?.record_metadata?.schema_version || (v2 ? 'wifran.extractor.offer/2.0' : null)
    payload.compound_group_id = v2?.record_metadata?.compound_group_id || prep.compound_group_id || null
    payload.supersedes_source_offer_id = v2?.record_metadata?.supersedes_source_offer_id ?? prep.supersedes_source_offer_id ?? null

    payload.exact_identity_status = v2?.product_facts?.exact_identity_status || prep.exact_identity_status || 'unresolved'
    payload.category_slug = prep.category_slug || prep.product?.category_hint || v2?.product_facts?.derived_subcategory_slug || null
    payload.derived_subcategory_slug = v2?.product_facts?.derived_subcategory_slug || prep.derived_subcategory_slug || null
    payload.commodity_tag = v2?.product_facts?.derived_subcategory_slug || prep.commodity_tag || prep.product?.commodity_tag || null
    payload.item_domain = prep.item_domain || prep.product?.item_domain || v2?.product_facts?.item_domain || 'grocery'
    payload.brand_state = v2?.product_facts?.brand_assertion?.state || prep.brand_state || 'unknown'
    payload.brand_candidate_text = v2?.product_facts?.brand_assertion?.candidate_unverified || prep.brand_candidate_text || null
    payload.normalized_title_ar = prep.normalized_title_ar || prep.product?.normalized_title_ar || v2?.product?.normalized_title_ar || null
    payload.normalized_title_en = prep.normalized_title_en || prep.product?.normalized_title_en || v2?.product?.normalized_title_en || null
    payload.product_attributes = v2?.product_facts?.attributes || prep.product_attributes || {}

    payload.assortment_status = v2?.assortment?.status || prep.assortment_status || 'unknown_composition'
    payload.known_options = v2?.assortment?.known_options || prep.known_options || []
    payload.sale_unit_type = v2?.quantity_semantics?.sale_unit || prep.sale_unit_type || 'pack'
    payload.inner_pack_count = v2 ? (v2.quantity_semantics.inner_count ?? null) : (prep.inner_pack_count !== undefined ? prep.inner_pack_count : (prep.sale_unit_type === 'kg' ? null : 1))
    payload.each_size_value = v2?.quantity_semantics?.per_inner_content?.value ?? prep.each_size_value ?? null
    payload.each_size_unit = v2?.quantity_semantics?.per_inner_content?.unit ?? prep.each_size_unit ?? null
    payload.total_content_value = v2?.quantity_semantics?.total_content?.value ?? prep.total_content_value ?? null
    payload.total_content_unit = v2?.quantity_semantics?.total_content?.unit ?? prep.total_content_unit ?? null
    payload.is_indivisible_sale_unit = v2?.quantity_semantics?.is_indivisible_sale_unit !== undefined ? v2.quantity_semantics.is_indivisible_sale_unit : (prep.is_indivisible_sale_unit !== false)

    payload.currency = v2?.price_terms?.currency || prep.currency || prep.prices?.currency || 'SAR'
    payload.price_basis = v2?.price_terms?.source_reported_price_basis || prep.price_basis || prep.prices?.price_basis || 'each'
    payload.verified_non_member_price = v2?.price_terms?.verified_current_non_member_price ?? null
    payload.promo_mechanic = v2?.promotion_terms?.mechanic || prep.promo_mechanic || prep.promotion?.mechanic || 'standard_price'
    payload.bonus_wording = v2?.promotion_terms?.bonus_wording || prep.bonus_wording || prep.promotion?.special_offer || null
    payload.bonus_fulfillment = v2?.promotion_terms?.bonus_fulfillment || prep.bonus_fulfillment || 'not_applicable'
    payload.loyalty_requirement = v2?.eligibility?.loyalty?.requirement || (isLoyaltyRequired ? 'required' : 'unknown')
    payload.is_loyalty_required = v2 ? (v2.eligibility?.loyalty?.requirement === 'required') : isLoyaltyRequired
    payload.quantity_limit_value = v2?.eligibility?.quantity_limit?.value ?? prep.quantity_limit_value ?? null
    payload.quantity_limit_unit = v2?.eligibility?.quantity_limit?.unit ?? prep.quantity_limit_unit ?? null
    payload.quantity_limit_scope = v2?.eligibility?.quantity_limit?.scope ?? prep.quantity_limit_scope ?? null

    payload.informational_inner_unit_price = prep.informational_inner_unit_price ?? null
    payload.display_unit_price_label_ar = prep.display_unit_price_label_ar ?? prep.display?.display_unit_price_label_ar ?? null
    payload.display_unit_price_label_en = prep.display_unit_price_label_en ?? prep.display?.display_unit_price_label_en ?? null
    payload.thumbnail_storage_path = sanitizedThumbStoragePath
    payload.thumbnail_url = sanitizedThumbUrl
    payload.image_subject_scope = v2?.assets?.offer_card?.subject_scope || v2?.assets?.product_thumbnail?.subject_scope || prep.image_subject_scope || (payload.assortment_status === 'single_product' ? 'exact_product' : 'representative_assortment')
    payload.page_area_share_pct = prep.page_area_share_pct ?? null
    payload.is_front_page = prep.is_front_page ?? false
    payload.is_hero_offer = prep.is_hero_offer ?? false

    payload.scoped_assessments = v2?.assessments?.capabilities || v2?.assessments?.structural_capabilities || prep.scoped_assessments || {}
    payload.reason_codes = reasonCodes
    payload.contract_v2 = v2 || null

    // WIFRAN-07G/07H/07J: Catalog Match & Identity Verification Fields
    if (prep.catalog_match_status !== undefined) {
      payload.catalog_match_status = prep.catalog_match_status || null
    }
    if (prep.catalog_verification_basis !== undefined) {
      payload.catalog_verification_basis = prep.catalog_verification_basis || null
    }
    if (prep.catalog_verified_by !== undefined) {
      payload.catalog_verified_by = prep.catalog_verified_by || null
    }
    if (prep.catalog_verified_at !== undefined) {
      payload.catalog_verified_at = prep.catalog_verified_at || null
    }
  }

  return { payload, issues }
}

export const mapPreparedOfferToDbInsert = mapPreparedPayloadToOffersInsert;
