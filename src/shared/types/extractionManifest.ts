import type { ExtractionMode, PageFirstRolloutMode } from './pageFirstExtractionMode';

export type PageFirstManifestSection = {
  status: 'not_started' | 'in_progress' | 'completed' | 'failed' | 'paused';
  rollout_mode: PageFirstRolloutMode;
  model: string;

  total_pages: number;
  primary_completed_pages: number;
  retry_completed_pages: number;
  completed_pages: number;
  unresolved_pages: number;
  failed_pages: number;

  offers_detected: number;
  offers_linked: number;
  crops_generated: number;

  estimated_cost_usd: number;
  budget_usd: number;

  started_at: string | null;
  completed_at: string | null;

  page_state_path: string;
  report_path: string;
};

export type ExtractionStatus =
  | 'not_started'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'failed';

export type ExtractionStageStatus =
  | 'not_started'
  | 'in_progress'
  | 'partial'
  | 'completed'
  | 'failed'
  | 'skipped';

export type ExtractionManifest = {
  schema_version: 1;

  extraction_mode?: ExtractionMode;
  page_first_ocr?: PageFirstManifestSection;

  extraction_status: ExtractionStatus;
  db_update_status: 'not_started' | 'in_progress' | 'completed' | 'failed';

  leaflet_filename_metadata?: {
    source_file_name: string;
    parsed_ok: boolean;
    supermarket_code: string | null;
    supermarket_description: string | null;
    location_code: string | null;
    location_description: string | null;
    promotion_start_date: string | null;
    errors: Array<{
      code: string;
      message: string;
    }>;
    warnings: Array<{
      code: string;
      message: string;
    }>;
  };

  /** @deprecated Replaced by page_style_profiles in Chunk 56 */
  style_profile_selection?: {
    status: 'not_started' | 'selected' | 'generating' | 'generated' | 'skipped' | 'failed';
    selected_page_numbers: number[];
    profile_path: string | null;
    selection_path: string | null;
    started_at: string | null;
    completed_at: string | null;
    skipped_at: string | null;
    error_message: string | null;
  };

  page_style_profiles?: {
    mode: 'all_pages' | 'disabled';
    status: 'not_started' | 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'disabled';
    total_pages: number;
    completed_pages: number;
    failed_pages: number;
    missing_pages?: number[]; // Added to track which pages were missing/skipped
    started_at: string | null;
    completed_at: string | null;
    profile_dir: string;
    failures: Array<{
      page_number: number;
      message: string;
    }>;
  };

  crop_suggestions?: {
    status: 'not_started' | 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'disabled';
    mode: 'brand_template_then_local_cv' | 'local_cv_only' | 'brand_template_only';
    total_pages: number;
    completed_pages: number;
    failed_pages: number;
    suggestions_dir: string;
    started_at: string | null;
    completed_at: string | null;
    failures: Array<{
      page_number: number;
      message: string;
    }>;
  };

  pre_publish_preview?: {
    status: 'not_opened' | 'opened' | 'approved';
    opened_at: string | null;
    approved_at: string | null;
    approved_by: string | null;
    summary: {
      publish_count: number;
      publish_but_exclude_from_comparison_count: number;
      skip_or_quarantine_count: number;
      warning_count: number;
      blocking_error_count: number;
    };
  };

  real_publish_rehearsal?: {
    status: 'not_started' | 'blocked' | 'running' | 'completed' | 'failed' | 'partial';
    started_at: string | null;
    completed_at: string | null;
    report_path: string | null;
    eligible_rows: number;
    max_rows_allowed: number;
    target_classification: 'sandbox' | 'production' | 'unknown';
    error_message: string | null;
  };

  runtime_accuracy_harness?: {
    status: 'not_started' | 'running' | 'completed' | 'failed';
    decision: 'pass' | 'pass_with_warnings' | 'needs_human_review' | 'block_publish' | null;
    started_at: string | null;
    completed_at: string | null;
    report_path: string;
    fixture_candidates_dir: string;
    critical_failure_count: number;
    suspicious_row_count: number;
  };

  fixed_grid_defaults?: {
    enabled: boolean;
    removed_at: string;
  };

  template_library_reset?: {
    status: 'completed';
    archive_path: string;
    archived_template_count: number;
    active_template_count: number;
  };

  training_annotations?: {
    status: 'collecting';
    dataset_root: string;
    eligible_annotation_count: number;
    negative_example_count: number;
    save_failure_count: number;
  };

  local_offer_block_detector?: {
    runtime_status: 'not_checked' | 'ready' | 'initializing' | 'unavailable' | 'error';
    active_model_id: string | null;
    active_model_version: string | null;
    model_maturity: 'no_active_model' | 'immature' | 'validated' | 'highly_validated';
    inference_status: 'not_started' | 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'disabled';
    pages_completed: number;
    pages_failed: number;
    pages_using_cv_fallback: number;
    training_status: 'collecting_data' | 'training_ready' | 'training_running' | 'candidate_ready' | 'error';
    candidate_model_id: string | null;
    last_training_started_at: string | null;
    last_training_completed_at: string | null;
    last_candidate_result: string | null;
  };

  crop_auto_acceptance?: {
    mode: 'disabled' | 'shadow' | 'assisted' | 'automatic';
    status: 'not_started' | 'evaluating' | 'completed' | 'failed';
    active_model_id: string | null;
    auto_accepted_pages: number;
    recommended_accept_pages: number;
    review_required_pages: number;
    blocked_pages: number;
    audited_pages: number;
    review_queue_path: string;
    report_path: string;
  };

  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  recovered_from_existing_folder?: boolean;

  extraction_folder_name: string;
  extraction_folder_path?: string;

  pdf_file_name: string;
  pdf_base_name: string;
  page_count?: number | null;

  processing_scope: {
    mode: 'all_pages' | 'selected_pages';
    pages: number[];
  };

  supermarket: {
    id?: string | null;
    name?: string | null;
    slug?: string | null;
  };

  location: {
    location_scope?: 'national' | 'region' | 'city' | null;
    city_id?: string | null;
    region_id?: string | null;
    display_name?: string | null;
    location_slug?: string | null;
  };

  offer_dates: {
    valid_from?: string | null;
    valid_to?: string | null;
  };

  stages: {
    pdf_copy: ExtractionStageStatus;
    page_rendering: ExtractionStageStatus;
    manual_crop: ExtractionStageStatus;
    crop_generation: ExtractionStageStatus;
    item_ocr: ExtractionStageStatus;
    key_discovery: ExtractionStageStatus;
    review_package: ExtractionStageStatus;
    db_update: ExtractionStageStatus;
  };

  counts: {
    pages_rendered: number;
    chunks: number;
    crop_images: number;
    json_files: number;
    matched_crop_json_pairs: number;
    orphan_crop_images: number;
    orphan_json_files: number;
    keys_with_values: number;
    keys_without_values: number;
  };

  paths: {
    pdf: string;
    chunks_dir: string;
    pages_dir: string;
    crops_dir: string;
    json_dir: string;
    logs_dir: string;
    metadata_dir: string;
    reports_dir?: string;
    accuracy_run_report?: string;
    pre_publish_preview_summary?: string;
    manual_crop_layout: string;
    flexible_item_ocr_summary: string;
    ocr_returned_keys: string;
    ocr_keys_without_values: string;
    session_layout_learning_dir?: string;
  };
  reports?: {
    accuracy_run_report?: {
      status: 'not_started' | 'generated' | 'failed';
      path: string;
      updated_at: string | null;
    };
    pre_publish_preview_summary?: {
      status: 'not_started' | 'generated' | 'failed';
      path: string;
      updated_at: string | null;
    };
  };

  validation: {
    package_valid: boolean;
    db_update_eligible: boolean;
    checked_at: string;
    warnings: Array<{
      code: string;
      message: string;
    }>;
    errors: Array<{
      code: string;
      message: string;
    }>;
  };
};

export type DbEligiblePackageItem = {
  pageNumber: number;
  itemNumber: string;
  cropPath: string;
  jsonPath: string;
  jsonData: Record<string, unknown>;
};

export type ExtractionPackageValidationResult = {
  ok: boolean;
  dbEligible: boolean;
  warnings: Array<{ code: string; message: string }>;
  errors: Array<{ code: string; message: string }>;
};

export type ExtractionPackageScanResult = {
  counts: ExtractionManifest['counts'];
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
};

export type OpenExtractionPackageResult = {
  ok: boolean;
  manifest?: ExtractionManifest;
  validation?: ExtractionPackageValidationResult;
  mode?: 'loaded_completed' | 'loaded_incomplete' | 'recovered';
  error?: string;
};

export type ContinueExtractionResult = {
  ok: boolean;
  resumeAction?: 'start_rendering' | 'open_manual_crop' | 'resume_crops' | 'resume_ocr' | 'rebuild_review' | 'validate_completed';
  error?: string;
};

export type AvailableExtractionItem = {
  folderName: string;
  folderPath: string;
  supermarketId: string | null;
  supermarketName: string | null;
  supermarketCode: string | null;
  locationLabel: string | null;
  offerDates: {
    valid_from?: string | null;
    valid_to?: string | null;
  } | null;
  extractionStatus: string;
  dbUpdateStatus: string;
  pageCount: number;
  cropCount: number;
  itemCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  hasPrePublishSummary: boolean;
  hasCanonicalJson: boolean;
  canPreview: boolean;
};

