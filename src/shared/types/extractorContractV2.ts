/**
 * Wifran Extractor Offer Contract v2.0 Specification (`wifran.extractor.offer/2.0`)
 * Defined per WIFRAN-03 and WIFRAN-04 Architecture Specifications.
 */

export type ExtractorContractV2SchemaVersion = 'wifran.extractor.offer/2.0';

export type ExactIdentityStatusV2 = 
  | 'verified_exact' 
  | 'product_family_only' 
  | 'unresolved' 
  | 'conflicting';

export type BrandAssertionStateV2 = 
  | 'supported' 
  | 'unknown' 
  | 'conflicting';

export type BrandAssertionV2 = {
  value: string | null;
  state: BrandAssertionStateV2;
  candidate_unverified: string | null;
  provenance: string | null;
};

export type AttributeStateV2 = 
  | 'supported' 
  | 'unknown' 
  | 'conflicting' 
  | 'not_applicable';

export type ControlledAttributeV2 = {
  value: string | number | null;
  state: AttributeStateV2;
  provenance: string | null;
};

export type AssortmentStatusV2 = 
  | 'single_product' 
  | 'assortment_indicated' 
  | 'choice_among_options' 
  | 'mixed_bundle' 
  | 'unknown_composition' 
  | 'indicated_with_conflict';

export type AssortmentCompositionTypeV2 = 
  | 'single' 
  | 'alternatives' 
  | 'bundle' 
  | 'unknown';

export type KnownAssortmentOptionV2 = {
  id?: string;
  title_ar?: string;
  title_en?: string;
  variant_name?: string;
};

export type AssortmentSourceAssertionV2 = {
  source_path: string;
  value: any;
};

export type SaleUnitV2 = 
  | 'pack' 
  | 'each' 
  | 'kg' 
  | 'qualifying_group' 
  | 'unknown';

export type PriceBasisV2 = 
  | 'per_pack' 
  | 'each' 
  | 'per_kg' 
  | 'qualifying_group' 
  | 'unknown';

export type PromotionMechanicV2 = 
  | 'standard_price' 
  | 'markdown' 
  | 'bonus_pack' 
  | 'buy_x_get_y' 
  | 'multibuy_bundle' 
  | 'unresolved';

export type BonusFulfillmentV2 = 
  | 'not_applicable' 
  | 'sealed_pack_included' 
  | 'checkout_scan_separate' 
  | 'unresolved';

export type LoyaltyRequirementV2 = 
  | 'required' 
  | 'not_required' 
  | 'unknown';

export type SalesChannelV2 = 
  | 'in_store' 
  | 'online' 
  | 'both' 
  | 'unknown';

export type CoordinateSystemDeclarationV2 = 
  | 'normalized_0_1000_ymin_xmin_ymax_xmax' 
  | 'undeclared_legacy';

export type CapabilityStateV2 = 
  | 'supported' 
  | 'conditional' 
  | 'needs_review' 
  | 'blocked' 
  | 'not_applicable';

export type CapabilityTypeV2 = 
  | 'offer_display' 
  | 'save_to_list' 
  | 'selected_offer_subtotal' 
  | 'unit_price_calculation' 
  | 'exact_product_comparison' 
  | 'automatic_list_fulfillment';

export type AssetSubjectScopeV2 = 
  | 'exact_product' 
  | 'offer_group'
  | 'representative_assortment' 
  | 'promotional_banner' 
  | 'unverified'
  | 'unknown';

export type AssetUploadStateV2 = 
  | 'uploaded' 
  | 'pending' 
  | 'failed' 
  | 'not_applicable';

export type AssetReferenceV2 = {
  local_path_internal: string | null;
  storage_bucket: string | null;
  storage_object_path: string | null;
  subject_scope: AssetSubjectScopeV2;
  upload_state: AssetUploadStateV2;
};

export interface ExtractorOfferContractV2 {
  // 1. Record Metadata
  record_metadata: {
    schema_version: ExtractorContractV2SchemaVersion;
    source_offer_id: string; // ${leaflet_id}:p${pad3(page)}:i${pad3(item)}:s01
    source_revision: number;
    semantic_checksum: string; // SHA-256 over canonical semantic fields
    producer_model: string | null;
    supersedes_source_offer_id?: string | null;
  };

  // 2. Product Facts
  product_facts: {
    exact_identity_status: ExactIdentityStatusV2;
    verified_product_id: string | number | null;
    gtin: string | null;
    brand_assertion: BrandAssertionV2;
    derived_subcategory_slug: string | null;
    attributes: Record<string, ControlledAttributeV2>;
  };

  // 3. Assortment
  assortment: {
    status: AssortmentStatusV2;
    composition_type: AssortmentCompositionTypeV2;
    known_options: KnownAssortmentOptionV2[];
    is_uniform_size: boolean | null;
    source_assertions: AssortmentSourceAssertionV2[];
  };

  // 4. Quantity Semantics
  quantity_semantics: {
    sale_unit: SaleUnitV2;
    inner_count: number | null;
    per_inner_content: {
      value: number | null;
      unit: string | null;
    };
    total_content: {
      value: number | null;
      unit: string | null;
    };
    is_indivisible_sale_unit: boolean;
  };

  // 5. Price Terms
  price_terms: {
    currency: 'SAR';
    source_reported_offer_price: string; // Decimal string e.g. "25.00"
    source_reported_price_basis: PriceBasisV2;
    source_reported_original_price: string | null;
    verified_current_non_member_price: null; // Always null from extractor
  };

  // 6. Promotion Terms
  promotion_terms: {
    mechanic: PromotionMechanicV2;
    bonus_wording: string | null;
    bonus_fulfillment: BonusFulfillmentV2;
    bonus_already_included_in_inner_count: boolean;
    structured_checkout_rule: Record<string, any> | null;
  };

  // 7. Eligibility
  eligibility: {
    loyalty: {
      requirement: LoyaltyRequirementV2;
      program_id: string | null;
      source_path: string | null;
      restriction_coverage?: string | null;
    };
    sales_channel: SalesChannelV2;
    quantity_limit: {
      value: number | null;
      unit: string | null;
      scope: 'per_customer' | 'per_transaction' | 'unknown' | null;
    };
  };

  // 8. Evidence
  evidence: {
    coordinate_system: CoordinateSystemDeclarationV2;
    offer_price_evidence_complete: boolean;
    original_price_evidence_complete: boolean;
  };

  // 9. Assessments
  assessments: {
    capabilities: Record<CapabilityTypeV2, CapabilityStateV2>;
    structural_capabilities?: Record<CapabilityTypeV2, CapabilityStateV2>;
    confidence: {
      extraction_confidence: 'high' | 'medium' | 'low';
      unit_math_confidence: 'high' | 'medium' | 'low';
      identity_confidence: 'high' | 'medium' | 'low';
    };
    reason_codes: string[];
  };

  // 10. Assets
  assets: {
    offer_card: AssetReferenceV2;
    product_thumbnail: AssetReferenceV2;
  };
}

export type ScenarioPurchaseResult = {
  full_packs_required: number;
  payable_price: string;
  supplied_units: number;
  surplus_units: number;
  total_supplied_content: number | null;
  total_supplied_content_unit: string | null;
};

export type ConsumerOfferProjection = {
  source_offer_id: string;
  leaflet_id: string | null;
  supermarket_id: string | null;
  supermarket_slug: string | null;
  location_scope: string | null;
  product_id?: number | string | null;
  city_id: string | null;
  region_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  temporal_lifecycle_state: 'upcoming' | 'active' | 'expired';

  title_ar: string | null;
  title_en: string | null;
  normalized_title_ar: string | null;
  normalized_title_en: string | null;
  brand_name: string | null;
  category_slug: string | null;
  derived_subcategory_slug?: string | null;
  derived_subcategory?: string | null;
  commodity_tag: string | null;
  item_domain: string | null;
  product_attributes?: Record<string, any>;

  offer_price: string;
  /** Advertised/source-reported reference price (backward compatibility; never a verified non-member price). */
  original_price: string | null;
  source_reported_original_price: string | null;
  verified_non_member_price: string | null;
  currency: 'SAR';
  price_basis: string;

  sale_unit: string;
  inner_count: number | null;
  is_indivisible_sale_unit?: boolean;
  size_text: string | null;
  total_content_value: number | null;
  total_content_unit: string | null;

  promotion_mechanic: string;
  special_offer_tag: string | null;
  bonus_wording?: string | null;
  bonus_fulfillment?: string;
  loyalty_requirement?: 'required' | 'unknown' | 'not_required' | string;
  is_loyalty_required: boolean;

  assortment_status: AssortmentStatusV2 | string;
  exact_identity_status: ExactIdentityStatusV2 | string;
  reason_codes?: string[];

  display_unit_price: number | null;
  display_unit_price_label_ar: string | null;
  display_unit_price_label_en: string | null;

  image_url: string | null;
  thumbnail_url: string | null;
  image_subject_scope: AssetSubjectScopeV2;
  card_image_subject_scope?: AssetSubjectScopeV2;
  thumbnail_subject_scope?: AssetSubjectScopeV2;
  card_image_upload_state?: string;
  thumbnail_upload_state?: string;

  // C-02 Structured Domain Objects
  quantity_semantics: {
    sale_unit: string;
    inner_count: number | null;
    is_indivisible_sale_unit: boolean;
    each_size_value?: number | null;
    each_size_unit?: string | null;
    total_content_value: number | null;
    total_content_unit: string | null;
  };

  eligibility: {
    loyalty_requirement: 'required' | 'unknown' | 'not_required' | string;
    sales_channel: string;
    quantity_limit_value: number | null;
    quantity_limit_unit: string | null;
    quantity_limit_scope: string | null;
  };

  capabilities: Record<CapabilityTypeV2, CapabilityStateV2>;

  assessments: {
    capabilities: Record<CapabilityTypeV2, CapabilityStateV2>;
    reason_codes: string[];
  };
};

export type ConsumerOfferDTO = ConsumerOfferProjection;

