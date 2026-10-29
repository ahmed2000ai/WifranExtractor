# Antigravity Prompt Chunk 58: Automatic Runtime Accuracy Harness and Self-Improving Quality Gate

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 58.

Chunks 41–57 should already have completed or be in progress, especially:

```text id="39xk7q"
56-replace-representative-style-profile-with-page-level-profiling.md
57-offline-extraction-and-wifran-utilization-accuracy-harness.md
```

This chunk adds an automatic runtime accuracy harness inside the extraction workflow.

The operator should not need to manually run the harness before every leaflet.

The app should automatically evaluate extraction quality after every run, improve safety where possible, and block publishing when the run is not trustworthy.

This chunk must not write to Supabase during tests.

This chunk must not upload images during tests.

This chunk must not call real Mistral during tests.

---

## 1. Purpose

The offline fixture harness proves the code against known golden cases.

This chunk adds a runtime harness that evaluates every actual extraction package.

The runtime harness does not usually have perfect ground truth, but it can still improve safety by detecting:

```text id="7nfp43"
size/content values misclassified as prices
old/original prices misclassified as current offer prices
ambiguous offer prices
unsafe comparison calculations
invalid location scope
failed page style profiles
low validation confidence
high page-level anomaly rates
suspicious publish decisions
```

The runtime harness must run automatically before Pre-Publish Preview and before any dry-run or real publish.

---

## 2. Target Workflow

The extraction workflow should become:

```text id="jf6rwj"
Select PDF
→ Render pages
→ Open crop editor
→ Create/adjust crop boxes
→ Start extraction
→ For each page with crops:
     generate/load page-level style profile
     extract item crops
     normalize raw OCR JSON
     run style-aware validation
     run deterministic checks
     calculate comparison safety
     decide publish / publish-but-exclude / skip

→ Automatic Runtime Accuracy Harness
     calculate run-level quality metrics
     detect critical failures
     detect suspicious rows
     optionally retry/revalidate selected rows once
     create fixture candidates
     assign run quality status

→ Pre-Publish Preview
→ Dry Run Publish
→ Controlled real-publish rehearsal
```

The operator should see the harness result in the UI automatically.

---

## 3. Runtime Harness Decisions

Create a run-level quality decision:

```ts id="um5e0v"
export type RuntimeAccuracyGateDecision =
  | 'pass'
  | 'pass_with_warnings'
  | 'needs_human_review'
  | 'block_publish';
```

Meaning:

```text id="l35y6f"
pass:
  run is eligible for preview and dry-run publish

pass_with_warnings:
  run is eligible, but warnings must be shown clearly

needs_human_review:
  preview allowed, but dry-run/real publish blocked until operator reviews flagged rows

block_publish:
  preview allowed for inspection, but dry-run/real publish is blocked
```

Important:

```text id="td1lm0"
Pre-Publish Preview should still open for block_publish runs so the operator can inspect what happened.
But publish buttons must be disabled until the run is fixed or explicitly reprocessed.
```

Do not add a dangerous “force publish” override in this chunk.

---

## 4. Files to Create

Recommended new files:

```text id="iwfvbq"
src/shared/types/runtimeAccuracyHarness.ts
src/shared/utils/runtimeAccuracyHarness.ts
src/main/accuracy/runtimeAccuracyHarnessService.ts
src/main/accuracy/runtimeFixtureCandidateService.ts
src/main/reporting/runtimeAccuracyReportService.ts
```

Recommended tests:

```text id="ubri78"
src/shared/utils/__tests__/runtimeAccuracyHarness.test.ts
src/main/accuracy/__tests__/runtimeAccuracyHarnessService.test.ts
src/main/accuracy/__tests__/runtimeFixtureCandidateService.test.ts
src/main/reporting/__tests__/runtimeAccuracyReportService.test.ts
```

Use existing project conventions if different.

---

## 5. Runtime Harness Input

The harness should evaluate the final canonical items after:

```text id="fn94yk"
page-level style profile
item extraction
normalization
style-aware validation
deterministic checks
comparison safety
publish decision
```

Recommended input type:

```ts id="m3jztq"
export type RuntimeAccuracyHarnessInput = {
  extractionPackagePath: string;
  leafletId: string | null;

  pageStyleProfileStatus: {
    mode: 'all_pages' | 'disabled';
    totalPagesWithCrops: number;
    completedPages: number;
    failedPages: number;
    missingPages: number[];
    failures: Array<{
      pageNumber: number;
      message: string;
    }>;
  };

  items: CanonicalOffer[];

  context: {
    supermarketSlug: string | null;
    locationScope: 'national' | 'region' | 'city' | null;
    cityId: string | null;
    regionId: string | null;
    offerStartDate: string | null;
    offerEndDate: string | null;
  };
};
```

---

## 6. Runtime Harness Output

Create:

```ts id="8nk4ke"
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

  page_summaries: Array<{
    page_number: number;
    item_count: number;
    publish_count: number;
    skip_count: number;
    warning_count: number;
    blocking_error_count: number;
    suspicious_count: number;
    style_profile_status: 'completed' | 'missing' | 'failed' | 'disabled';
  }>;

  thresholds: RuntimeAccuracyThresholds;

  auto_actions: Array<{
    action:
      | 'revalidated_item'
      | 'regenerated_page_style_profile'
      | 'quarantined_item'
      | 'created_fixture_candidate'
      | 'blocked_publish'
      | 'none';
    source_page_number: number | null;
    source_item_number: string | null;
    reason: string;
    result: string;
  }>;

  fixture_candidates: Array<{
    fixture_candidate_id: string;
    path: string;
    reason_codes: string[];
    source_page_number: number | null;
    source_item_number: string | null;
  }>;
};
```

Use existing type naming if different.

---

## 7. Critical Blocking Conditions

The runtime harness must return `block_publish` if any row marked publishable has:

```text id="n1xjvu"
size_misclassified_as_price
offer_price_matches_size_value
offer_price_is_size_candidate
original_price_misclassified_as_offer_price
missing_offer_price
ambiguous_offer_price
missing_product_title
invalid_location_scope
missing_city_for_city_scope
missing_region_for_region_scope
expired_offer_end_date
unsafe_image_path
```

Also block if:

```text id="bw41wh"
comparison_eligible = true but comparison_unit_price is null
comparison_eligible = true but comparison calculation has unsafe_price_basis_calculation
comparison_eligible = true but comparison_unit is unsupported
publish_decision = publish while blocking_errors is non-empty
publish_decision = publish_but_exclude_from_comparison while blocking_errors is non-empty
```

Zero tolerance:

```text id="yx0w1z"
wrong offer price published = 0 allowed
size-as-price published = 0 allowed
old-price-as-offer-price published = 0 allowed
invalid location published = 0 allowed
unsafe comparison for comparison_eligible=true = 0 allowed
```

---

## 8. Warning / Review Conditions

Return `needs_human_review` when:

```text id="6yi7nr"
too many rows are skip_or_quarantine
too many rows have validation_result = fail
too many rows have validation_result = corrected
too many rows have low validation confidence
too many rows are missing original_price
a page has unusually high warning/error rate
page style profile failed for a page that has publishable rows
page style profile is missing for a page that has publishable rows
```

Recommended default thresholds:

```ts id="qb5wu8"
export const DEFAULT_RUNTIME_ACCURACY_THRESHOLDS = {
  maxCriticalFailuresForPublish: 0,
  maxPublishableRowsWithBlockingErrors: 0,
  maxUnsafeComparisonEligibleRows: 0,

  maxSkipRateWarning: 0.35,
  maxValidationFailureRateWarning: 0.15,
  maxValidationCorrectionRateWarning: 0.30,
  maxLowConfidenceValidationRateWarning: 0.25,
  maxPageWarningRateWarning: 0.40,
};
```

These thresholds should be configurable later, but default safely now.

---

## 9. Automatic Accuracy Improvement Actions

The runtime harness should improve safety automatically, but not fake correctness.

Allowed automatic actions:

### 9.1 Revalidate suspicious item once

If a row is suspicious and not already revalidated, allow one stricter revalidation call.

Examples:

```text id="arlie9"
offer price conflicts with candidates
validation confidence is low
deterministic checks disagree with model recommendation
original price and offer price appear swapped
comparison_eligible=true but content is unclear
```

Use shared Mistral queue.

Do not call real Mistral during tests.

Use config:

```text id="40ml6t"
RUNTIME_HARNESS_REVALIDATE_SUSPICIOUS_ITEMS=true
```

Default:

```text id="1dcdtq"
true
```

Emergency disable:

```text id="okwxhw"
false
```

### 9.2 Regenerate failed page style profile once

If page style profile failed and page has crops, allow one retry.

Use config:

```text id="4ruanp"
RUNTIME_HARNESS_RETRY_FAILED_PAGE_STYLE_PROFILE=true
```

Default:

```text id="uq5tgc"
true
```

### 9.3 Quarantine unsafe rows

If a row remains unsafe after checks/revalidation, set or keep:

```text id="jrmygi"
publish_decision = skip_or_quarantine
```

Do not auto-publish uncertain rows.

### 9.4 Create fixture candidates

For each suspicious or blocked row, save a local fixture candidate.

Do not require operator action.

Recommended path:

```text id="csd0xa"
metadata/fixture-candidates/page-001-item-004/
```

Contents:

```text id="52r6mr"
crop.webp
raw_mistral_response.json
canonical.json
validation.json
page_style_profile.json
runtime_issue.json
fixture-candidate.json
```

The candidate should include reason codes, but not pretend to know ground truth.

The operator/developer can later promote it to a golden fixture.

---

## 10. Runtime Harness Report

Write:

```text id="1kivjr"
metadata/reports/runtime-accuracy-harness-report.json
```

Also write a concise markdown summary:

```text id="96xb03"
metadata/reports/runtime-accuracy-harness-report.md
```

Include:

```text id="48o768"
run-level decision
critical failures
warnings
suspicious rows
page summaries
auto actions
fixture candidate paths
thresholds
publish gate status
```

Update `accuracy-run-report.json` to include a reference to this report.

---

## 11. Manifest Integration

Update `extraction_manifest.json` safely.

Add:

```json id="6qc4u5"
{
  "runtime_accuracy_harness": {
    "status": "not_started",
    "decision": null,
    "started_at": null,
    "completed_at": null,
    "report_path": "metadata/reports/runtime-accuracy-harness-report.json",
    "fixture_candidates_dir": "metadata/fixture-candidates",
    "critical_failure_count": 0,
    "suspicious_row_count": 0
  }
}
```

Allowed statuses:

```text id="67utqv"
not_started
running
completed
failed
```

Older manifests without this field must load safely.

---

## 12. Workflow Integration

The runtime harness must run automatically after extraction decisions are calculated and before Pre-Publish Preview is enabled.

Required behavior:

```text id="bpeph8"
extraction completed
→ runtime harness starts automatically
→ runtime harness report written
→ Pre-Publish Preview enabled with harness status
```

If harness decision is:

```text id="z7sagu"
pass or pass_with_warnings:
  preview enabled
  dry-run publish allowed after preview approval

needs_human_review:
  preview enabled
  dry-run publish disabled until operator reviews flagged rows or reruns/fixes extraction

block_publish:
  preview enabled for inspection
  dry-run publish disabled
  real publish disabled
```

Do not hide the preview. The operator must be able to inspect why the harness blocked the run.

---

## 13. Pre-Publish Preview Integration

Add a visible harness summary at the top of Pre-Publish Preview:

```text id="0qjq7s"
Runtime Accuracy Gate: PASS / PASS WITH WARNINGS / NEEDS HUMAN REVIEW / BLOCKED

Critical failures: 0
Suspicious rows: 3
Fixture candidates created: 3
Page style profile failures: 0
```

Add filters:

```text id="ng62q5"
Harness Suspicious
Harness Critical
Fixture Candidates
```

Each item card should show harness issue badges if applicable.

---

## 14. Publish Gate Integration

Dry-run publish and real publish rehearsal must check the runtime harness decision.

Rules:

```text id="9e5q66"
pass:
  allow existing preview/dry-run flow

pass_with_warnings:
  allow dry-run, show warning

needs_human_review:
  block dry-run and real publish unless a future explicit review workflow marks issues resolved

block_publish:
  block dry-run and real publish
```

Do not add force override in this chunk.

---

## 15. QA/Dry-Run Integration

In QA/dry-run mode:

```text id="9qs4pj"
runtime harness should run using existing artifacts
runtime harness must not call Mistral automatically
if revalidation would be needed, record action as skipped_due_to_dry_run
fixture candidates may still be created locally
```

Dry-run report should include:

```text id="vfbgmw"
runtime_harness_decision
runtime_harness_report_path
critical_failure_count
suspicious_row_count
fixture_candidate_count
```

---

## 16. Tests

Add or update tests.

Recommended files:

```text id="f1ykhx"
src/shared/utils/__tests__/runtimeAccuracyHarness.test.ts
src/main/accuracy/__tests__/runtimeAccuracyHarnessService.test.ts
src/main/accuracy/__tests__/runtimeFixtureCandidateService.test.ts
src/main/reporting/__tests__/runtimeAccuracyReportService.test.ts
src/renderer/src/components/prepublish/__tests__/RuntimeAccuracySummary.test.tsx
```

Required tests:

```text id="t35ziw"
runtime harness passes clean valid run
runtime harness pass_with_warnings for missing original prices only
runtime harness block_publish if publish row has size_misclassified_as_price
runtime harness block_publish if publish row has old-price-as-offer-price
runtime harness block_publish if comparison_eligible row has null unit price
runtime harness needs_human_review if skip rate exceeds threshold
runtime harness needs_human_review if page warning rate exceeds threshold
runtime harness records page style profile failures
runtime harness creates fixture candidates for suspicious rows
runtime harness does not call Mistral in dry-run mode
runtime harness records revalidation skipped_due_to_dry_run
Pre-Publish Preview shows harness status
dry-run publish blocked when runtime decision is block_publish
dry-run publish blocked when runtime decision is needs_human_review
dry-run publish allowed when runtime decision is pass
```

Do not call real Mistral.

Do not call real Supabase.

Mock filesystem where practical.

---

## 17. Documentation

Update:

```text id="qq9u1x"
docs/developer/accuracy-harness.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
README.md
```

Document:

```text id="m6a5c9"
offline golden harness = developer regression safety
runtime harness = automatic per-extraction quality gate
runtime harness runs automatically after extraction
runtime harness can block publish
fixture candidates are created automatically
operator should inspect harness warnings in Pre-Publish Preview
```

---

## 18. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not upload images.
* Do not write to Supabase.
* Do not publish offers.
* Do not delete extraction folders.
* Do not call real Mistral during tests.
* Do not call real Supabase during tests.
* Do not log image base64.
* Do not log Mistral request bodies containing images.
* Do not add DB migrations.
* Do not add DB columns.

---

## 19. Acceptance Criteria

This chunk is complete when:

* Runtime accuracy harness exists.
* Runtime harness runs automatically after extraction decisions are calculated.
* Runtime harness writes JSON and markdown reports.
* Runtime harness updates manifest.
* Runtime harness creates fixture candidates for suspicious rows.
* Runtime harness can block dry-run and real publish.
* Runtime harness summary appears in Pre-Publish Preview.
* QA/dry-run mode does not call Mistral automatically.
* Critical zero-tolerance conditions block publish.
* Page-level anomaly detection exists.
* Harness result is included in dry-run report.
* Tests are added or updated.
* TypeScript compiles.
* No tests call real Mistral.
* No tests call Supabase.
* The app remains runnable.

---

## 20. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the automatic runtime accuracy harness and publish quality gate changes needed for this chunk, keep the app runnable, then stop.

Do not perform real OCR, real Mistral calls, image upload, DB writes, or real publishing during tests.

---

## 21. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="jksxw3"
files modified
files created
runtime harness behavior
automatic workflow integration
quality gate decisions
auto revalidation behavior
fixture candidate behavior
report paths
manifest fields
Pre-Publish Preview changes
publish gate changes
tests added/updated
commands run
commands skipped and why
whether typecheck passed
whether tests passed
confirmation that no real Mistral/Supabase calls were run
remaining risks
recommended next step
```

The recommended next step should be:

```text id="j5p3l6"
Run a QA extraction on a copied package, confirm the runtime harness report is generated automatically, then inspect Pre-Publish Preview before Dry Run Publish.