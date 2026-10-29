/**
 * Runtime Accuracy Harness Types – Chunk 58
 *
 * Types for the automatic per-extraction quality gate that runs after
 * deterministic checks, comparison safety, and publish decisions.
 */

// ---------------------------------------------------------------------------
// Gate Decision
// ---------------------------------------------------------------------------

export type RuntimeAccuracyGateDecision =
  | 'pass'
  | 'pass_with_warnings'
  | 'needs_human_review'
  | 'block_publish';

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type RuntimeAccuracyIssueSeverity = 'critical' | 'warning' | 'info';

export type RuntimeAccuracyIssue = {
  code: string;
  severity: RuntimeAccuracyIssueSeverity;
  message: string;
  source_page_number: number | null;
  source_item_number: string | null;
};

export type RuntimeSuspiciousRow = {
  source_page_number: number | null;
  source_item_number: string | null;
  reason_codes: string[];
  messages: string[];
  publish_decision: string | null;
  offer_price: number | null;
  original_price: number | null;
  size_text: string | null;
  comparison_eligible: boolean;
};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export type RuntimeAccuracyThresholds = {
  maxCriticalFailuresForPublish: number;
  maxPublishableRowsWithBlockingErrors: number;
  maxUnsafeComparisonEligibleRows: number;

  maxSkipRateWarning: number;
  maxValidationFailureRateWarning: number;
  maxValidationCorrectionRateWarning: number;
  maxLowConfidenceValidationRateWarning: number;
  maxPageWarningRateWarning: number;
};

export const DEFAULT_RUNTIME_ACCURACY_THRESHOLDS: RuntimeAccuracyThresholds = {
  maxCriticalFailuresForPublish: 0,
  maxPublishableRowsWithBlockingErrors: 0,
  maxUnsafeComparisonEligibleRows: 0,

  maxSkipRateWarning: 0.35,
  maxValidationFailureRateWarning: 0.15,
  maxValidationCorrectionRateWarning: 0.30,
  maxLowConfidenceValidationRateWarning: 0.25,
  maxPageWarningRateWarning: 0.40,
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type PageStyleProfileStatusEntry = {
  pageNumber: number;
  message: string;
};

export type PageStyleProfileStatus = {
  mode: 'all_pages' | 'disabled';
  totalPagesWithCrops: number;
  completedPages: number;
  failedPages: number;
  missingPages: number[];
  failures: PageStyleProfileStatusEntry[];
};

export type RuntimeAccuracyHarnessInput = {
  extractionPackagePath: string;
  leafletId: string | null;

  pageStyleProfileStatus: PageStyleProfileStatus;

  items: import('./canonicalOffer').CanonicalOffer[];

  context: {
    supermarketSlug: string | null;
    locationScope: 'national' | 'region' | 'city' | null;
    cityId: string | null;
    regionId: string | null;
    offerStartDate: string | null;
    offerEndDate: string | null;
  };

  cropSuggestionStatus?: {
    enabled: boolean;
    mode: string;
    failures: Array<{ pageNumber: number, message: string }>;
  };

  manualCropSession?: import('./manualCrop').ManualCropSession;

  autoAcceptanceDecisions?: import('./autoAcceptance').PageAutoAcceptanceDecision[];

  isDryRun?: boolean;
};

// ---------------------------------------------------------------------------
// Page Summary
// ---------------------------------------------------------------------------

export type RuntimePageSummary = {
  page_number: number;
  item_count: number;
  publish_count: number;
  skip_count: number;
  warning_count: number;
  blocking_error_count: number;
  suspicious_count: number;
  style_profile_status: 'completed' | 'missing' | 'failed' | 'disabled';
};

// ---------------------------------------------------------------------------
// Auto Actions
// ---------------------------------------------------------------------------

export type RuntimeAutoActionType =
  | 'revalidated_item'
  | 'regenerated_page_style_profile'
  | 'quarantined_item'
  | 'created_fixture_candidate'
  | 'blocked_publish'
  | 'skipped_due_to_dry_run'
  | 'none';

export type RuntimeAutoAction = {
  action: RuntimeAutoActionType;
  source_page_number: number | null;
  source_item_number: string | null;
  reason: string;
  result: string;
};

// ---------------------------------------------------------------------------
// Fixture Candidate
// ---------------------------------------------------------------------------

export type RuntimeFixtureCandidate = {
  fixture_candidate_id: string;
  path: string;
  reason_codes: string[];
  source_page_number: number | null;
  source_item_number: string | null;
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type RuntimeAccuracyHarnessResult = {
  schema_version: 1;
  created_at: string;

  decision: RuntimeAccuracyGateDecision;

  summary: {
    total_items: number;
    publish_count: number;
    publish_but_exclude_from_comparison_count: number;
    skip_or_quarantine_count: number;

    blocking_error_count: number;
    warning_count: number;
    comparison_excluded_count: number;

    critical_failure_count: number;
    suspicious_row_count: number;
    page_style_profile_failure_count: number;
    low_confidence_validation_count: number;
    validation_correction_count: number;
  };

  critical_failures: RuntimeAccuracyIssue[];
  warnings: RuntimeAccuracyIssue[];
  suspicious_rows: RuntimeSuspiciousRow[];

  page_summaries: RuntimePageSummary[];

  thresholds: RuntimeAccuracyThresholds;

  auto_actions: RuntimeAutoAction[];

  fixture_candidates: RuntimeFixtureCandidate[];
};

// ---------------------------------------------------------------------------
// Manifest Extension
// ---------------------------------------------------------------------------

export type RuntimeAccuracyHarnessManifestEntry = {
  status: 'not_started' | 'running' | 'completed' | 'failed';
  decision: RuntimeAccuracyGateDecision | null;
  started_at: string | null;
  completed_at: string | null;
  report_path: string;
  fixture_candidates_dir: string;
  critical_failure_count: number;
  suspicious_row_count: number;
};
