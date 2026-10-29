import type { ExtractorOfferContractV2 } from './extractorContractV2';

export type CanonicalPriceCandidate = {
  raw_text: string;
  normalized_value: number | null;
  currency: 'SAR' | null;
  visual_role: 'prominent_current_price' | 'crossed_out_old_price' | 'smaller_old_price' | 'price_label' | 'ambiguous' | 'not_a_price' | string;
  classified_as: 'offer_price' | 'original_price' | 'ambiguous_price' | 'not_a_price' | string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string | null;
  visual_evidence: Record<string, unknown>;
};

export type CanonicalSizeCandidate = {
  raw_text: string;
  normalized_value: number | null;
  unit: string | null;
  classified_as: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string | null;
  visual_evidence: Record<string, unknown>;
};

export type CanonicalQualityIssue = {
  code: string;
  message: string;
  severity?: 'error' | 'warning' | 'info';
  field_name?: string;
};

export type CanonicalOffer = {
  schema_version?: 'wifran.extractor.offer/2.0';
  contract_v2?: ExtractorOfferContractV2;

  source: {
    leaflet_id: string | null;
    source_page_number: number | null;
    source_item_number: string;
    external_image_id: string | null;
    crop_path?: string | null;
    thumbnail_path?: string | null;
    page_area_share_pct?: number | null;
    json_path?: string | null;
  };

  trusted_context: {
    supermarket_id: string | null;
    supermarket_slug?: string | null;
    location_scope: 'national' | 'region' | 'city' | null;
    city_id: string | null;
    region_id: string | null;
    offer_start_date: string | null;
    offer_end_date: string | null;
  };

  product: {
    title_ar: string | null;
    title_en: string | null;
    normalized_title_ar?: string | null;
    normalized_title_en?: string | null;
    commodity_tag?: string | null;
    brand_text: string | null;
    category_hint: string | null;
    item_domain: 'grocery' | 'household' | 'personal_care' | 'electronics' | 'appliance' | 'other_non_grocery' | 'unknown';
    description_ar: string | null;
    description_en: string | null;
  };

  prices: {
    offer_price: number | null;
    original_price: number | null;
    currency: 'SAR' | null;
    discount_amount: number | null;
    discount_percentage: number | null;
    price_basis: 'each' | 'per_pack' | 'per_box' | 'per_bag' | 'per_kg' | 'per_2kg' | 'per_dozen' | 'bundle' | 'multi_buy' | 'unknown';
    price_condition_text: string | null;
    all_price_candidates: CanonicalPriceCandidate[];
  };

  content: {
    size_text: string | null;
    pack_quantity: number | null;
    bundle_quantity: number | null;
    each_size_value: number | null;
    each_size_unit: 'liter' | 'milliliter' | 'kilogram' | 'gram' | 'piece' | 'inch' | 'dozen' | 'other' | null;
    total_content_value: number | null;
    total_content_unit: 'liter' | 'milliliter' | 'kilogram' | 'gram' | 'piece' | 'dozen' | 'other' | null;
  };

  promotion: {
    mechanic: 'standard_price' | 'bogo' | 'bundle' | 'multi_buy' | 'loyalty_required' | 'selected_branches' | 'unknown';
    special_offer: string | null;
    condition_text: string | null;
    quantity_limit?: string | null;
    bundle_quantity: number | null;
  };

  comparison: {
    comparison_eligible: boolean;
    comparison_unit: string | null;
    comparison_unit_price: number | null;
    comparison_confidence: 'high' | 'medium' | 'low';
    comparison_exclusion_reason: string | null;
  };

  image: {
    image_bucket: string | null;
    image_path: string | null;
    image_url: string | null;
    thumbnail_path?: string | null;
    thumbnail_url?: string | null;
    image_source_type: 'leaflet_crop' | string | null;
  };

  display: {
    show_display_unit_price: boolean;
    display_unit_price: number | null;
    display_unit_price_unrounded?: number | null;
    display_unit_basis_value: number | null;
    display_unit_basis_unit: 'g' | 'kg' | 'ml' | 'l' | 'piece' | 'pieces' | null;
    display_unit_family: 'mass' | 'volume' | 'count' | null;
    display_unit_price_label_ar: string | null;
    display_unit_price_label_en: string | null;
    below_min_display_price_threshold: boolean;
    min_display_unit_price_sar: number;
    hidden_reason: 'comparison_not_eligible' | 'missing_offer_price' | 'missing_total_content' | 'unsupported_unit' | 'non_grocery_item' | 'unsafe_conversion' | null;
  };

  quality: {
    publish_decision: 'publish' | 'publish_but_exclude_from_comparison' | 'skip_or_quarantine';
    extraction_confidence: 'high' | 'medium' | 'low';
    validation_confidence: 'high' | 'medium' | 'low' | 'not_run';
    comparison_confidence: 'high' | 'medium' | 'low';
    blocking_errors: CanonicalQualityIssue[];
    non_blocking_warnings: CanonicalQualityIssue[];
  };

  style_validation: {
    validation_result: 'not_run' | 'pass' | 'fail' | 'corrected';
    visual_evidence: Record<string, unknown>;
    corrected_fields: Record<string, unknown>;
    style_profile_scope: 'page' | 'leaflet' | 'none';
  };

  pre_publish: {
    preview_eligible: boolean;
    preview_group: 'publish' | 'publish_but_exclude_from_comparison' | 'skip_or_quarantine';
    display_in_preview: boolean;
  };

  raw: {
    raw_ocr_json: Record<string, unknown>;
    raw_validation_json: Record<string, unknown> | null;
    raw_ocr_text: string | null;
    raw_attributes: Record<string, unknown>;
  };
};
