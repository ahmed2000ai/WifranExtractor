export type DeterministicOfferCheckSeverity = 'blocking' | 'warning' | 'comparison_exclusion';

export type DeterministicOfferCheckCode =
  | 'size_misclassified_as_price'
  | 'offer_price_matches_size_value'
  | 'offer_price_not_in_price_candidates'
  | 'offer_price_is_size_candidate'
  | 'original_price_misclassified_as_offer_price'
  | 'missing_offer_price'
  | 'ambiguous_offer_price'
  | 'missing_product_title'
  | 'unresolved_supermarket'
  | 'invalid_location_scope'
  | 'missing_city_for_city_scope'
  | 'missing_region_for_region_scope'
  | 'invalid_offer_end_date'
  | 'expired_offer_end_date'
  | 'unsafe_image_path'
  | 'duplicate_conflict_unresolved'
  | 'missing_original_price'
  | 'missing_brand'
  | 'low_confidence_category'
  | 'unclear_promotion_mechanic'
  | 'low_confidence_style_profile'
  | 'validation_corrected_noncritical_field'
  | 'unclear_pack_size'
  | 'unclear_total_content'
  | 'unclear_price_basis'
  | 'non_grocery_item'
  | 'unsupported_comparison_domain'
  | 'unsupported_comparison_unit'
  | 'unsafe_price_basis_calculation'
  | 'unclear_bundle_quantity';

export type DeterministicOfferCheckIssue = {
  code: DeterministicOfferCheckCode | string;
  severity: DeterministicOfferCheckSeverity;
  message: string;
  field?: string | null;
  evidence?: Record<string, unknown>;
};

export type DeterministicOfferCheckResult = {
  blocking_errors: DeterministicOfferCheckIssue[];
  non_blocking_warnings: DeterministicOfferCheckIssue[];
  comparison_exclusions: DeterministicOfferCheckIssue[];
  has_blocking_errors: boolean;
  has_warnings: boolean;
  has_comparison_exclusions: boolean;
};
