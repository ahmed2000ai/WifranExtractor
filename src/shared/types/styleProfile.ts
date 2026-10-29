export type LeafletStyleProfile = {
  schema_version: 1;
  profile_id: string;
  leaflet_id: string | null;
  scope: 'leaflet' | 'page';
  page_number: number | null;
  selected_page_numbers: number[] | null;
  source_image_path: string | null;
  created_at: string;
  model: string | null;
  confidence: 'high' | 'medium' | 'low';

  offer_price_patterns: Array<{
    description: string;
    color_notes: string | null;
    price_block_color: string | null;
    relative_size: 'largest' | 'large' | 'medium' | 'small' | 'mixed' | 'unknown';
    position_notes: string | null;
    sar_symbol_notes: string | null;
    examples: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;

  original_price_patterns: Array<{
    description: string;
    color_notes: string | null;
    relative_size: 'largest' | 'large' | 'medium' | 'small' | 'mixed' | 'unknown';
    crossed_out_notes: string | null;
    position_notes: string | null;
    examples: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;

  size_patterns: Array<{
    description: string;
    unit_examples: string[];
    position_notes: string | null;
    near_product_text_notes: string | null;
    inside_price_block_notes: string | null;
    confidence: 'high' | 'medium' | 'low';
  }>;

  promotion_patterns: Array<{
    description: string;
    examples: string[];
    position_notes: string | null;
    visual_notes: string | null;
    confidence: 'high' | 'medium' | 'low';
  }>;

  condition_patterns: Array<{
    description: string;
    examples: string[];
    position_notes: string | null;
    confidence: 'high' | 'medium' | 'low';
  }>;

  non_price_attribute_patterns: Array<{
    description: string;
    examples: string[];
    attribute_type:
      | 'screen_size'
      | 'resolution'
      | 'pack_quantity'
      | 'product_feature'
      | 'other';
    confidence: 'high' | 'medium' | 'low';
  }>;

  warnings: Array<{
    code: string;
    message: string;
  }>;

  notes: string[];

  raw_model_response: Record<string, unknown> | null;
};

export type LeafletStyleProfileSelectionMetadata = {
  schema_version: 1;
  created_at: string;
  leaflet_id: string | null;
  selected_page_numbers: number[];
  selected_page_image_paths: string[];
  status: 'not_started' | 'selected' | 'generating' | 'generated' | 'skipped' | 'failed';
  profile_path: string | null;
  error_message: string | null;
};
