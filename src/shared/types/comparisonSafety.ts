export type ComparisonUnit =
  | 'liter'
  | 'milliliter'
  | 'kilogram'
  | 'gram'
  | 'piece'
  | 'dozen'
  | null;

export type ComparisonConfidence = 'high' | 'medium' | 'low';

export type ComparisonExclusionReason =
  | 'not_evaluated'
  | 'unclear_pack_size'
  | 'unclear_total_content'
  | 'unclear_price_basis'
  | 'non_grocery_item'
  | 'unsupported_comparison_domain'
  | 'unsupported_comparison_unit'
  | 'unsafe_price_basis_calculation'
  | 'unclear_bundle_quantity'
  | 'missing_offer_price'
  | 'missing_comparison_unit'
  | 'missing_total_content'
  | 'invalid_total_content'
  | 'comparison_blocked_by_quality_error'
  | string
  | null;

export type ComparisonSafetyResult = {
  comparison_eligible: boolean;
  comparison_unit: ComparisonUnit;
  comparison_unit_price: number | null;
  comparison_confidence: ComparisonConfidence;
  comparison_exclusion_reason: ComparisonExclusionReason;
  evidence: {
    offer_price: number | null;
    price_basis: string | null;
    size_text: string | null;
    pack_quantity: number | null;
    bundle_quantity: number | null;
    each_size_value: number | null;
    each_size_unit: string | null;
    total_content_value: number | null;
    total_content_unit: string | null;
    item_domain: string | null;
  };
};
