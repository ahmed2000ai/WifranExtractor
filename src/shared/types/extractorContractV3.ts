/**
 * WIFRAN-EXTRACTOR-IDENTITY-005D (WP4 Stage 1)
 * Additive Extraction V3 Contract Types (`wifran.extractor.card/3.0`)
 *
 * Strictly additive, opt-in, and disabled by default.
 * Preserves frozen `wifran.extractor.offer/2.0` and `legacy`/`optimized`/`compact_v1` contracts untouched.
 */

export type ExtractorContractV3SchemaVersion = 'wifran.extractor.card/3.0';

export type V3AssortmentStatus =
  | 'confirmed_single_sku'
  | 'explicit_assortment'
  | 'visual_multiple_variants'
  | 'unknown_insufficient_evidence';

export type V3AssortmentEvidenceSource =
  | 'assorted_badge'
  | 'multi_pack_image'
  | 'slash_title'
  | 'choice_or_separator'
  | 'sku_code_list'
  | 'swatch_icons'
  | 'operator_verified'
  | 'printed_leaflet_text'
  | 'insufficient_evidence';

export type V3PriceBasis =
  | 'each'
  | 'per_kg'
  | 'buy_n'
  | 'per_pack'
  | 'shared_assortment'
  | 'unknown';

export type V3SaleBasis =
  | 'single_unit'
  | 'sealed_multipack'
  | 'factory_bonus_pack'
  | 'multi_buy_checkout'
  | 'buy_x_get_y_checkout'
  | 'weighed_per_kg'
  | 'piece_or_tray'
  | 'unknown';

export type V3CanonicalOrExtendedUnit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'pcs'
  | 'roll'
  | 'sheet'
  | 'cm'
  | 'inch'
  | 'gb'
  | 'tb';

export type V3EvidenceType =
  | 'printed_leaflet_text'
  | 'printed_package_label'
  | 'visible_variant_label'
  | 'manufacturer_packaging_marking'
  | 'printed_retailer_sku_code'
  | 'en_ar_text_agreement'
  | 'conflicting_text_descriptions'
  | 'source_card_shared_caption'
  | 'verified_operator_correction';

export type V3ConflictCode =
  | 'EN_AR_WEIGHT_VOLUME_CONFLICT'
  | 'EN_AR_PACK_COUNT_CONFLICT'
  | 'TEXT_VS_IMAGE_CONFLICT'
  | 'PRICE_ROLE_AMBIGUOUS'
  | 'CURRENCY_UNVERIFIED_OR_CONFLICT'
  | 'PROMO_QTY_VS_MFG_PACK_CONFLICT'
  | 'COMPOUND_SHARED_CAPTION_CONFLICT'
  | 'UNLABELED_SWATCH_OR_BOTTLE_VARIANTS'
  | 'INCOMPLETE_VISIBLE_ASSORTMENT'
  | 'RETAILER_SKU_WITHOUT_VARIANT_NAMES'
  | 'WEIGHT_RANGE_UNPAIRED'
  | 'MISSING_CRITICAL_IDENTITY_ATTRIBUTES';

export type V3ItemDomain =
  | 'grocery'
  | 'household'
  | 'personal_care'
  | 'fresh_loose'
  | 'bakery_inhouse'
  | 'electronics'
  | 'appliance'
  | 'textiles_home'
  | 'other_non_grocery';

export interface OperatorCorrectionV3 {
  corrected_value: string | number | boolean | null;
  corrected_by: string;
  corrected_at: string;
  rationale: string;
  reversible: boolean;
}

/**
 * Compact field-level evidence entry preserving original extraction values,
 * source evidence, normalized values, and non-destructive operator corrections.
 * Internal crop/source provenance references MUST stay internal and never leak to public DTOs.
 */
export interface EvidenceEntryV3 {
  evidence_id: string;
  target_field: string;
  evidence_type: V3EvidenceType;
  extracted_value: string | number | boolean | null;
  original_source_evidence: string | null;
  normalized_value: string | number | boolean | null;
  confidence: 'high' | 'medium' | 'low' | 'uncertain';
  uncertainty_reason?: string | null;
  source_ref_internal?: string | null;
  operator_correction?: OperatorCorrectionV3 | null;
}

export interface QuantityPriceTierV3 {
  quantity: number;
  unit_or_basis: string;
  price: number;
  currency: string | null;
  basis: 'standard' | 'loyalty' | 'member';
}

export interface SubItemV3 {
  sub_item_ref: string; // e.g. 's01', 's02'
  brand_en: string | null;
  brand_ar: string | null;
  product_name_en: string | null; // Nullable so Arabic-only offers never fail schema
  product_name_ar: string | null;
  variant_or_flavor: string | null;
  product_form: string | null;
  each_size_value: number | null;
  each_size_unit: V3CanonicalOrExtendedUnit | null;
  /**
   * Explicitly nullable: NEVER default an unknown manufacturer pack count to 1.
   */
  manufacturer_pack_count: number | null;
  printed_retailer_sku_code: string | null;
  is_retailer_sku_only_not_gtin: true;
  /**
   * Optional independent promo price ONLY when the source card explicitly prints separate
   * per-child pricing (e.g., compound card with separate single vs carton badges).
   */
  independent_promo_price?: number | null;
  independent_original_price?: number | null;
  retailer_checkout_multibuy_qty?: number | null;
  evidence_refs: string[];
  unknown_attributes: string[];
  conflict_attributes: string[];
  safe_for_catalog_matching: boolean;
}

export interface AssortmentAssessmentV3 {
  status: V3AssortmentStatus;
  visible_variant_count: number | null;
  identifiable_sub_item_count: number;
  assortment_evidence: V3AssortmentEvidenceSource[];
  is_enumerated_list_complete: boolean;
  all_options_linkable: boolean;
}

export interface QuantityAndPromoV3 {
  sale_basis: V3SaleBasis;
  each_size_value: number | null;
  each_size_unit: V3CanonicalOrExtendedUnit | null;
  /**
   * Strictly factory inner units inside ONE sealed retail unit, or null if unknown.
   * Never derived from checkout promo multi-buy quantity alone.
   */
  manufacturer_pack_count: number | null;
  retailer_checkout_multibuy_qty: number | null;
  factory_bonus_paid_qty: number | null;
  factory_bonus_free_qty: number | null;
  customer_limit_pcs: number | null;
  shared_promotional_price: number | null;
  quantity_price_tiers: QuantityPriceTierV3[];
  is_per_weight_pricing: boolean;
  loyalty_required: boolean;
  loyalty_program_name: string | null;
}

export interface PriceIntegrityV3 {
  promo_price: number | null;
  original_price: number | null;
  currency: string | null;
  currency_evidence: string | null;
  price_basis: V3PriceBasis;
  price_role_confidence: 'high' | 'medium' | 'low' | 'conflicting';
  promo_conditions: string | null;
  price_conflict_flags: V3ConflictCode[];
}

export interface NonGrocerySpecsV3 {
  domain: V3ItemDomain;
  electronics_model_number?: string | null;
  screen_size_inches?: number | null;
  storage_capacity?: string | null;
  connectivity_variant?: string | null;
  textile_dimensions?: string | null;
  bakery_measurement?: string | null;
  display_size_text?: string | null;
  excluded_from_default_grocery_feed: boolean;
}

export interface CompoundCardContextV3 {
  compound_group_id: string | null;
  card_shared_caption_en: string | null;
  card_shared_caption_ar: string | null;
  has_multiple_price_badges_in_card: boolean;
  has_different_packaging_across_entries: boolean;
  inherited_caption_attributes_requiring_override: string[];
}

export interface OfferContractV3Record {
  schema_version: ExtractorContractV3SchemaVersion;
  source_card: {
    leaflet_id: string;
    page_number: number;
    source_offer_id: string;
    source_evidence_ref_internal: string | null;
    retailer_id: string | null;
    retailer_name: string | null;
    offer_start_date: string | null;
    offer_end_date: string | null;
    location_scope: 'national' | 'region' | 'city' | null;
    city_id: string | null;
    region_id: string | null;
    raw_text: {
      title_ar: string | null;
      title_en: string | null;
      size_text: string | null;
      promo_badge_text: string | null;
      price_text_candidates: string[];
    };
  };
  pricing: PriceIntegrityV3;
  assortment: AssortmentAssessmentV3;
  sub_items: SubItemV3[];
  quantity_and_promo: QuantityAndPromoV3;
  non_grocery_specs: NonGrocerySpecsV3;
  compound_card_context?: CompoundCardContextV3 | null;
  category_evidence?: {
    commodity_tag?: string | null;
    category_hint?: string | null;
  } | null;
  extraction_confidence: 'high' | 'medium' | 'low';
  evidence_conflicts: V3ConflictCode[];
  evidence_ledger: EvidenceEntryV3[];
  printed_retailer_sku_codes: string[];
}

export type DecompositionBasisV3 =
  | 'explicit_text_slash'
  | 'explicit_package_labels'
  | 'retailer_sku_code_map'
  | 'multi_brand_explicit_pairs'
  | 'compound_price_tier_split';

export interface DecomposedSubItemCandidateV3 {
  parent_source_offer_id: string;
  sub_item_ref: string;
  candidate_key: string; // `${parent_source_offer_id}::${sub_item_ref}`
  decomposition_basis: DecompositionBasisV3;
  source_evidence_refs: string[];
  brand_en: string | null;
  brand_ar: string | null;
  product_name_en: string | null;
  product_name_ar: string | null;
  variant_or_flavor: string | null;
  each_size_value: number;
  each_size_unit: V3CanonicalOrExtendedUnit;
  manufacturer_pack_count: number;
  printed_retailer_sku_code: string | null;
  is_retailer_sku_only_not_gtin: true;
  pricing_mode: 'shared_assortment_price' | 'independent_card_price';
  parent_promo_price: number;
  parent_original_price: number | null;
  currency: string;
  price_basis: V3PriceBasis;
  promo_conditions: string | null;
  retailer_checkout_multibuy_qty: number | null;
  customer_limit_pcs: number | null;
  loyalty_required: boolean;
  offer_start_date: string | null;
  offer_end_date: string | null;
  location_scope: 'national' | 'region' | 'city' | null;
  retailer_id: string | null;
  retailer_name: string | null;
  /**
   * Preserves isolated temporary identity namespace so siblings never collide
   * unless physical attributes actually match identically.
   */
  isolated_identity_token: string;
}

export interface V3DecompositionResult {
  parent_source_offer_id: string;
  decomposed: boolean;
  decomposition_basis: DecompositionBasisV3 | null;
  parent_offer_retention_mode:
    | 'decomposed_shared_promo_parent'
    | 'decomposed_compound_tier_parent'
    | 'unsplit_single_sku'
    | 'unsplit_non_catalog_candidate'
    | 'quarantined_do_not_publish';
  children: DecomposedSubItemCandidateV3[];
  unresolved_sub_items: SubItemV3[];
  rejection_reasons: string[];
  conflict_codes: V3ConflictCode[];
  normalized_card: OfferContractV3Record;
}

