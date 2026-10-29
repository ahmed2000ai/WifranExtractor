export type AccuracyRunReport = {
  schema_version: 1;

  report_id: string;

  created_at: string;
  updated_at: string | null;

  package: {
    package_name: string;
    package_path: string | null;
    leaflet_id: string | null;
    source_pdf_path: string | null;
  };

  context: {
    supermarket_name: string | null;
    supermarket_slug: string | null;
    coverage_scope: 'national' | 'region' | 'city' | null;
    location_label: string | null;
    city_id: string | null;
    region_id: string | null;
    offer_start_date: string | null;
    offer_end_date: string | null;
    /** @deprecated Use page_style_profiles_status */
    style_profile_selection_status: string | null;
    /** @deprecated */
    selected_style_profile_pages: number[] | null;
    /** @deprecated */
    leaflet_style_profile_generated: boolean;
    /** @deprecated */
    leaflet_style_profile_path: string | null;
    /** @deprecated */
    style_profile_generation_error: string | null;

    page_style_profile_mode?: 'all_pages' | 'disabled';
    page_style_profiles_status?: string | null;
    page_style_profiles_completed_pages?: number;
    page_style_profiles_failed_pages?: number;
    page_style_profiles_missing_pages?: number;
    page_style_profile_errors_by_page?: Array<{ page: number; error: string }>;
  };

  counts: {
    total_crops: number;
    total_raw_json: number;
    total_canonical_items: number;

    extraction_calls: number;
    validation_calls: number;
    style_profile_calls: number;

    extracted_count: number;
    validation_pass_count: number;
    validation_corrected_count: number;
    validation_failed_count: number;

    publish_count: number;
    publish_but_exclude_from_comparison_count: number;
    skip_or_quarantine_count: number;

    display_unit_price_visible_count: number;
    display_unit_price_hidden_count: number;
    display_unit_price_below_threshold_count: number;
    display_unit_price_calculation_error_count: number;

    warning_count: number;
    blocking_error_count: number;

    comparison_eligible_count: number;
    comparison_excluded_count: number;
    non_grocery_count: number;

    price_ambiguity_count: number;
    size_as_price_detections: number;
    old_price_as_offer_price_detections: number;

    image_upload_success_count: number;
    image_upload_failure_count: number;
    db_upsert_success_count: number;
    db_upsert_failure_count: number;

    pre_publish_preview_opened_count: number;
    pre_publish_approved_count: number;

    automatic_fixed_grid_generated_count: number;
    manual_grid_generated_count: number;
    pages_with_cv_suggestions: number;
    pages_with_template_suggestions: number;
    pages_confirmed_without_changes: number;
    pages_corrected_after_detection: number;
    pages_created_manually: number;
    training_annotations_created: number;
    training_annotations_updated: number;
    training_annotation_save_failures: number;
    negative_examples_saved: number;
    active_template_count: number;
    archived_template_count: number;
  };

  display_unit_price_hidden_reasons: Record<string, number>;

  warnings_by_code: Record<string, number>;
  errors_by_code: Record<string, number>;
  comparison_exclusions_by_code: Record<string, number>;

  queue_summary: {
    total_mistral_requests: number;
    total_queue_wait_ms: number | null;
    completed_by_kind: Record<string, number>;
    failed_by_kind: Record<string, number>;
    retry_after_count: number | null;
    rate_limit_429_count: number | null;
  };

  pre_publish_preview: {
    status: 'not_opened' | 'opened' | 'approved' | 'not_available';
    opened_at: string | null;
    approved_at: string | null;
    publish_count: number;
    publish_but_exclude_from_comparison_count: number;
    skip_or_quarantine_count: number;

    warning_count: number;
    blocking_error_count: number;
  };

  db_update: {
    status: 'not_started' | 'running' | 'completed' | 'failed' | 'partial';
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
  };

  items: AccuracyRunReportItem[];
};

export type AccuracyRunReportItem = {
  source_page_number: number | null;
  source_item_number: string;
  crop_path: string | null;
  raw_json_path: string | null;
  canonical_json_path: string | null;
  validation_json_path: string | null;

  title_ar: string | null;
  title_en: string | null;
  brand_text: string | null;
  item_domain: string | null;

  offer_price: number | null;
  original_price: number | null;
  currency: string | null;

  size_text: string | null;
  pack_quantity: number | null;
  bundle_quantity: number | null;
  price_basis: string | null;
  promotion_mechanic: string | null;

  extraction_confidence: string | null;
  validation_result: string | null;
  validation_confidence: string | null;

  publish_decision:
    | 'publish'
    | 'publish_but_exclude_from_comparison'
    | 'skip_or_quarantine';

  comparison_eligible: boolean;
  comparison_unit: string | null;
  comparison_unit_price: number | null;
  comparison_exclusion_reason: string | null;

  blocking_errors: Array<{ code: string; message: string }>;
  non_blocking_warnings: Array<{ code: string; message: string }>;

  image_upload_status: 'not_started' | 'success' | 'failed' | 'skipped';
  db_upsert_status: 'not_started' | 'success' | 'failed' | 'skipped';
  db_error_message: string | null;
};
