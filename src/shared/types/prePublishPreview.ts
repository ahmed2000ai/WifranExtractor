export type PrePublishPreviewItem = {
  source_page_number: number | null;
  source_item_number: string;
  crop_path: string;
  thumbnail_path?: string | null;
  catalog_image_url?: string | null;
  crop_image_url?: string | null;

  publish_decision:
    | 'publish'
    | 'publish_but_exclude_from_comparison'
    | 'skip_or_quarantine';

  preview_eligible: boolean;
  display_in_preview: boolean;

  confidence: 'high' | 'medium' | 'low' | 'not_run';

  comparison_eligible: boolean;
  comparison_exclusion_reason: string | null;

  fields: Array<{
    field_name: string;
    value: string | number | boolean | null;
  }>;

  blocking_errors: Array<{
    code: string;
    message: string;
  }>;

  non_blocking_warnings: Array<{
    code: string;
    message: string;
  }>;

  harness_issue_codes?: string[];

  page_first_diagnostics?: {
    ocr_block_confidence: number | null;
    evidence_link_confidence: number | null;
    current_price_anchor_matched: boolean;
    page_completeness_status: string;
    source_pass: 'primary' | 'retry';
    crop_confidence: number;
    has_unmatched_evidence: boolean;
    uncovered_price_anchor_on_page: boolean;
    page_unresolved: boolean;
  };

  raw?: {
    canonical?: Record<string, unknown>;
    raw_ocr_json?: Record<string, unknown>;
    raw_validation_json?: Record<string, unknown> | null;
  };
};

export type PrePublishPreviewSummary = {
  leaflet_id: string | null;
  package_name: string;
  supermarket_name: string | null;
  coverage_scope: string | null;
  location_label: string | null;
  offer_start_date: string | null;
  offer_end_date: string | null;
  db_update_status?: 'not_started' | 'in_progress' | 'completed' | 'failed';
  published_at?: string | null;

  counts: {
    total_items: number;
    publish: number;
    publish_but_exclude_from_comparison: number;
    skip_or_quarantine: number;
    warnings: number;
    blocking_errors: number;
    non_grocery: number;

    display_unit_price_visible: number;
    display_unit_price_hidden: number;
    display_unit_price_below_threshold: number;
    display_unit_price_calculation_error: number;
  };

  page_style_profile_status?: {
    mode: 'all_pages' | 'disabled';
    status: string;
    completed_pages: number;
    failed_pages: number;
    missing_pages: number;
  };

  runtime_accuracy_gate?: {
    decision: 'pass' | 'pass_with_warnings' | 'needs_human_review' | 'block_publish' | null;
    critical_failure_count: number;
    suspicious_row_count: number;
    fixture_candidate_count: number;
    page_style_profile_failure_count: number;
  };

  extraction_mode?: import('./pageFirstExtractionMode').ExtractionMode;
  page_first_metrics?: {
    offers_detected: number;
    offers_linked: number;
    crops_generated: number;
    unresolved_pages: number;
    estimated_cost_usd: number;
  };

  items: PrePublishPreviewItem[];
};

