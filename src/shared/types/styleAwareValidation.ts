export type StyleAwareValidationResult = {
  schema_version: 1;

  validation_id: string;
  leaflet_id: string | null;
  source_page_number: number | null;
  source_item_number: string;
  crop_path: string | null;

  created_at: string;
  model: string | null;

  validation_result: 'pass' | 'fail' | 'corrected';

  corrected_fields: {
    offer_price: number | null;
    original_price: number | null;
    size_text: string | null;
    pack_quantity: number | null;
    bundle_quantity: number | null;
    price_basis:
      | 'each'
      | 'per_pack'
      | 'per_box'
      | 'per_bag'
      | 'per_kg'
      | 'per_2kg'
      | 'per_dozen'
      | 'bundle'
      | 'multi_buy'
      | 'unknown'
      | null;
    promotion_mechanic:
      | 'standard_price'
      | 'bogo'
      | 'bundle'
      | 'multi_buy'
      | 'loyalty_required'
      | 'selected_branches'
      | 'unknown'
      | null;
  };

  blocking_errors: Array<{
    code: string;
    message: string;
  }>;

  non_blocking_warnings: Array<{
    code: string;
    message: string;
  }>;

  comparison: {
    comparison_eligible: boolean | null;
    comparison_exclusion_reason: string | null;
    comparison_confidence: 'high' | 'medium' | 'low';
  };

  visual_evidence: {
    offer_price: {
      explanation: string | null;
      text_color: string | null;
      price_block_color: string | null;
      relative_size: 'largest' | 'large' | 'medium' | 'small' | 'unknown' | null;
      is_crossed_out: boolean | null;
      near_currency_symbol: boolean | null;
      position_hint: string | null;
    };
    original_price: {
      explanation: string | null;
      is_crossed_out: boolean | null;
      relative_size: string | null;
      position_hint: string | null;
    };
    size: {
      explanation: string | null;
      attached_unit: string | null;
      near_product_title_or_pack: boolean | null;
    };
    promotion: {
      explanation: string | null;
    };
  };

  publish_decision:
    | 'publish'
    | 'publish_but_exclude_from_comparison'
    | 'skip_or_quarantine';

  confidence: 'high' | 'medium' | 'low';

  raw_model_response: Record<string, unknown> | null;
};
