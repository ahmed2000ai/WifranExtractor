/**
 * Accuracy Harness Types – Chunk 57
 *
 * Defines the fixture schema and result types for the offline
 * extraction-to-utilization accuracy harness.
 *
 * No network calls. No Supabase. No Mistral.
 */

// ---------------------------------------------------------------------------
// Fixture Schema
// ---------------------------------------------------------------------------

export type AccuracyHarnessFixture = {
  schema_version: 1;

  id: string;
  description: string;
  supermarket_slug: string | null;

  source: {
    crop_path?: string | null;
    page_number?: number | null;
    item_number?: string | null;
    notes?: string[];
  };

  trusted_context: {
    supermarket_id?: string | null;
    supermarket_slug?: string | null;
    location_scope: 'national' | 'region' | 'city';
    city_id?: string | null;
    region_id?: string | null;
    city_slug?: string | null;
    region_slug?: string | null;
    offer_start_date: string;
    offer_end_date: string;
  };

  inputs: {
    raw_mistral_response: Record<string, unknown>;
    style_validation_response?: Record<string, unknown> | null;
    page_style_profile?: Record<string, unknown> | null;
  };

  expected: {
    canonical?: {
      title_ar?: string | null;
      title_en?: string | null;
      offer_price?: number | null;
      original_price?: number | null;
      size_text?: string | null;
      pack_quantity?: number | null;
      bundle_quantity?: number | null;
      price_basis?: string | null;
      promotion_mechanic?: string | null;
      item_domain?: string | null;
    };

    blocking_error_codes?: string[];
    warning_codes?: string[];
    comparison_exclusion_codes?: string[];

    comparison?: {
      comparison_eligible: boolean;
      comparison_unit?: string | null;
      comparison_unit_price?: number | null;
      comparison_exclusion_reason?: string | null;
      tolerance?: number;
    };

    decision: {
      publish_decision:
        | 'publish'
        | 'publish_but_exclude_from_comparison'
        | 'skip_or_quarantine';
      should_upsert_db: boolean;
      should_upload_image: boolean;
      status_for_db?: 'published' | 'needs_review' | 'skipped' | null;
    };

    display?: {
      show_display_unit_price?: boolean;
      display_unit_price?: number | null;
      display_unit_basis_value?: number | null;
      display_unit_basis_unit?: 'g' | 'kg' | 'ml' | 'l' | 'piece' | 'pieces' | null;
      display_unit_price_label_ar?: string | null;
      display_unit_price_label_en?: string | null;
      hidden_reason?: string | null;
    };

    utilization?: {
      appears_for_city_ids?: string[];
      hidden_for_city_ids?: string[];
      included_in_search?: boolean;
      included_in_best_unit_price_ranking?: boolean;
      excluded_from_comparison?: boolean;
      display_size_text_ar?: string | null;
      display_unit_price_text?: string | null;
    };
  };
};

// ---------------------------------------------------------------------------
// Fixture Result
// ---------------------------------------------------------------------------

export type AccuracyHarnessFailure = {
  path: string;
  expected: unknown;
  actual: unknown;
  message: string;
};

export type AccuracyHarnessFixtureResult = {
  fixture_id: string;
  passed: boolean;
  failures: AccuracyHarnessFailure[];
  actual: {
    canonical: Record<string, unknown>;
    blocking_error_codes: string[];
    warning_codes: string[];
    comparison_exclusion_codes: string[];
    comparison: Record<string, unknown>;
    decision: Record<string, unknown>;
    display?: Record<string, unknown>;
    utilization: Record<string, unknown>;
    db_payload?: Record<string, unknown> | null;
  };
};

// ---------------------------------------------------------------------------
// Wifran Utilization Result
// ---------------------------------------------------------------------------

export type WifranUtilizationResult = {
  appears_for_city_ids: string[];
  hidden_for_city_ids: string[];
  included_in_search: boolean;
  included_in_best_unit_price_ranking: boolean;
  excluded_from_comparison: boolean;
  display_size_text_ar: string | null;
  display_unit_price_text: string | null;
};

// ---------------------------------------------------------------------------
// Harness Report
// ---------------------------------------------------------------------------

export type AccuracyHarnessMetrics = {
  total_fixtures: number;
  passed_fixtures: number;
  failed_fixtures: number;
  offer_price_accuracy: number;
  original_price_accuracy: number;
  size_content_accuracy: number;
  pack_quantity_accuracy: number;
  bundle_quantity_accuracy: number;
  comparison_eligibility_accuracy: number;
  unit_price_calculation_accuracy: number;
  publish_decision_accuracy: number;

  // Zero-tolerance counters
  false_publish_count: number;
  false_publish_wrong_price_count: number;
  size_as_price_published_count: number;
  old_price_as_offer_price_published_count: number;
  comparison_error_for_eligible_count: number;
  invalid_location_published_count: number;
};

export type AccuracyHarnessReport = {
  schema_version: 1;
  run_at: string;
  metrics: AccuracyHarnessMetrics;
  thresholds_passed: boolean;
  threshold_failures: string[];
  fixture_results: AccuracyHarnessFixtureResult[];
};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export type AccuracyThresholds = {
  falsePublishWrongPriceMax: number;
  sizeAsPricePublishedMax: number;
  oldPriceAsOfferPricePublishedMax: number;
  invalidLocationPublishedMax: number;
  comparisonErrorForEligibleMax: number;
};

export const DEFAULT_ACCURACY_THRESHOLDS: AccuracyThresholds = {
  falsePublishWrongPriceMax: 0,
  sizeAsPricePublishedMax: 0,
  oldPriceAsOfferPricePublishedMax: 0,
  invalidLocationPublishedMax: 0,
  comparisonErrorForEligibleMax: 0,
};

// ---------------------------------------------------------------------------
// Level 2 & Level 3 stubs (prepared, not implemented)
// ---------------------------------------------------------------------------

/** Level 2: Live Model Evaluation Harness – future stub */
export interface LiveModelEvaluationHarnessInput {
  fixture_crop_paths: string[];
  model_id: string;
  // Will call Mistral on selected fixture crop images in the future
}

/** Level 3: End-to-End Dry-Run Harness – future stub */
export interface EndToEndDryRunHarnessInput {
  fixture_ids: string[];
  dry_run_only: true;
  // Uses existing dry-run publish pipeline; no Supabase writes, no real OCR, no image upload
}
