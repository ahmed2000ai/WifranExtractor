# Antigravity Prompt Chunk 57: Offline Extraction and Wifran Utilization Accuracy Harness

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 57.

Chunks 41–56 should already have completed or be in progress, especially:

```text id="098gvo"
46-deterministic-price-size-and-publishing-sanity-checks.md
47-comparison-safety-and-publish-decision-engine.md
48-pre-publish-preview-and-human-publish-approval-gate.md
49-accuracy-run-report-and-regression-fixtures.md
50-supabase-metadata-mapping-for-extraction-quality.md
51-end-to-end-safe-local-verification-with-fixtures.md
52-manual-qa-dry-run-with-copied-extraction-package.md
56-replace-representative-style-profile-with-page-level-profiling.md
```

This chunk adds an offline accuracy harness that tests the full extraction-to-utilization chain.

This harness must not call Mistral.

This harness must not upload images.

This harness must not write to Supabase.

This harness must not publish offers.

The goal is to prove whether Wifran can safely trust extracted offers before any real publish rehearsal.

---

## 1. Why This Harness Exists

Do not test only:

```text id="vnjrho"
Did Mistral return JSON?
```

The harness must test the whole safety chain:

```text id="5ijdgf"
crop image or fixture
→ raw model JSON
→ canonical normalization
→ style-aware validation result
→ deterministic checks
→ comparison metadata
→ publish/skip decision
→ DB-ready payload dry-run
→ Wifran utilization behavior
```

The most important failure to prevent is:

```text id="6gb2f0"
wrong offer price being published
```

A skipped valid offer is annoying.

A wrong published offer price damages trust.

---

## 2. Read These Files First

Inspect the current implementation:

```text id="dzc3ea"
src/shared/types/canonicalOffer.ts
src/shared/utils/canonicalOfferNormalizer.ts
src/shared/utils/legacyOcrFieldMapper.ts
src/shared/utils/deterministicOfferChecks.ts
src/shared/utils/comparisonSafety.ts
src/shared/utils/publishDecisionEngine.ts
src/shared/types/styleAwareValidation.ts
src/shared/types/comparisonSafety.ts
src/shared/types/publishDecision.ts
src/main/db/offerSyncMapper.ts
src/main/db/offerPreparationService.ts
src/main/prepublish/
src/main/reporting/accuracyRunReportService.ts
src/main/ocr/styleAwareValidationPromptBuilder.ts
src/main/ocr/styleProfilePromptBuilder.ts
src/shared/fixtures/
tests/fixtures/
```

Also inspect any existing tests added by Chunks 49–56.

Adapt paths if the actual project structure differs.

---

## 3. Goal

Create a reusable offline harness that can run fixture cases and verify:

```text id="zlav9o"
offer price correctness
original price correctness
size/content correctness
pack quantity correctness
bundle quantity correctness
promotion detection correctness
old-price vs offer-price separation
size-as-price prevention
unit price calculation correctness
comparison eligibility correctness
publish decision correctness
DB payload eligibility correctness
Wifran visibility and recommendation behavior
```

The harness should become the standard regression test layer.

Every new known extraction failure should become a fixture.

---

## 4. Harness Levels

Implement Level 1 fully in this chunk.

Prepare interfaces for Level 2 and Level 3, but do not call live services.

### Level 1: Offline Fixture Harness

No API calls.

Input:

```text id="ied23p"
fixture crop path or placeholder
saved raw Mistral response JSON
optional saved style validation response JSON
optional page style profile JSON
trusted import context
expected canonical fields
expected comparison result
expected publish decision
expected Wifran utilization result
```

Purpose:

```text id="xf7q8s"
fast regression testing
normalization testing
validation rule testing
unit-price testing
publish decision testing
Wifran utilization contract testing
```

### Level 2: Live Model Evaluation Harness

Prepare only as a future stub.

It may eventually call Mistral on selected fixture crop images.

Do not implement live calls in this chunk.

### Level 3: End-to-End Dry-Run Harness

Use existing dry-run publish pipeline where practical.

Do not write to Supabase.

Do not run real OCR.

Do not upload images.

---

## 5. Fixture Folder Structure

Create or standardize:

```text id="b8dlz0"
tests/fixtures/accuracy-harness/
```

Each fixture should live in its own folder:

```text id="w5r3lg"
tests/fixtures/accuracy-harness/othaim-oil-1-5l/
  fixture.json
  crop.webp optional
  raw_mistral_response.json
  style_validation_response.json optional
  page_style_profile.json optional
  expected_canonical.json optional
  expected_comparison.json optional
  expected_decision.json optional
  expected_utilization.json optional
```

If the project already has a fixture folder from Chunk 49, reuse it but add a clear harness-specific structure.

---

## 6. Main Fixture Schema

Create a fixture schema.

Recommended file:

```text id="j2qmvx"
src/shared/types/accuracyHarness.ts
```

or:

```text id="0jgqvx"
src/shared/schemas/accuracyHarnessFixtureSchema.ts
```

Recommended shape:

```ts id="78joum"
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
```

Use existing type conventions if different.

---

## 7. Harness Runner

Create:

```text id="4i400s"
src/shared/accuracy-harness/runAccuracyHarnessFixture.ts
```

or:

```text id="io0cqi"
src/shared/utils/accuracyHarnessRunner.ts
```

Recommended function:

```ts id="yk1jxb"
export function runAccuracyHarnessFixture(
  fixture: AccuracyHarnessFixture
): AccuracyHarnessFixtureResult
```

The runner should perform:

```text id="n4fv1p"
raw_mistral_response
→ normalizeAnyItemOcrResponse / canonical normalizer
→ attach trusted_context
→ apply mocked style_validation_response if present
→ runDeterministicOfferChecks
→ applyDeterministicCheckResultToCanonicalOffer
→ evaluateComparisonSafety
→ applyComparisonSafetyToCanonicalOffer
→ decidePublishAction
→ applyPublishDecisionToCanonicalOffer
→ build DB-ready dry-run payload if eligible
→ evaluate Wifran utilization behavior
→ compare actual vs expected
```

Do not call Mistral.

Do not call Supabase.

Do not read network resources.

---

## 8. Fixture Result Type

Create:

```ts id="efl8uw"
export type AccuracyHarnessFixtureResult = {
  fixture_id: string;
  passed: boolean;
  failures: Array<{
    path: string;
    expected: unknown;
    actual: unknown;
    message: string;
  }>;
  actual: {
    canonical: Record<string, unknown>;
    blocking_error_codes: string[];
    warning_codes: string[];
    comparison: Record<string, unknown>;
    decision: Record<string, unknown>;
    utilization: Record<string, unknown>;
    db_payload?: Record<string, unknown> | null;
  };
};
```

---

## 9. Required Golden Fixtures

Add at least these fixtures.

### 9.1 Othaim oil 1.5L

Expected:

```text id="18g6wl"
1.5L = size/content
15.99 = original price
10 = offer price
comparison_unit = liter
comparison_eligible = true
comparison_unit_price = 6.67 SAR/liter within tolerance
publish_decision = publish
```

### 9.2 Bad oil size-as-price

Bad raw input should simulate:

```text id="uacsr6"
offer_price = 1.5 or 1.51
size text = 1.5L
current/old price confusion possible
```

Expected:

```text id="k10a0k"
blocking error = size_misclassified_as_price or offer_price_matches_size_value
publish_decision = skip_or_quarantine
should_upsert_db = false
```

### 9.3 Fairy 730ml 1+1

Expected:

```text id="fai33v"
730ml = size/content
1+1 = bundle quantity 2
21.99 = original price
10 = offer price
total content = 1.46L
comparison_unit = liter
comparison_unit_price = 6.85 SAR/liter within tolerance
publish_decision = publish
```

### 9.4 Bad Fairy old price as current

Bad raw input should simulate:

```text id="a0x3v0"
offer_price = 21.99
original_price = null
size = 730ml
promotion = 1+1
```

Expected:

```text id="66ykve"
blocking error = original_price_misclassified_as_offer_price
or validation fails if not confidently corrected
publish_decision = skip_or_quarantine
```

### 9.5 8 × 135g pack

Expected:

```text id="76qg3c"
pack_quantity = 8
each_size = 135g
total_content = 1080g = 1.08kg
comparison_unit = kilogram
comparison unit price calculated correctly
```

### 9.6 Watermelon per 2kg

Expected:

```text id="g1zgxz"
price_basis = per_2kg
comparison_unit = kilogram
comparison_unit_price = offer_price / 2
publish_decision = publish if title and offer price are clear
```

### 9.7 30 pieces

Expected:

```text id="521eic"
30PCS = quantity/content, not price
comparison_unit = piece if category supports piece comparison
comparison_unit_price = offer_price / 30
```

### 9.8 TV / electronics

Expected:

```text id="n4faj1"
item_domain = electronics
screen_size is preserved as product attribute
screen_size is not treated as price
comparison_eligible = false
comparison_exclusion_reason = non_grocery_item or unsupported_comparison_domain
publish_decision = publish_but_exclude_from_comparison if display fields are safe
```

### 9.9 Valid but unclear pack size

Expected:

```text id="b74wvy"
publish_decision = publish_but_exclude_from_comparison
comparison_eligible = false
comparison_exclusion_reason = unclear_pack_size or unclear_total_content
```

### 9.10 Missing title

Expected:

```text id="m0w4cv"
blocking error = missing_product_title
publish_decision = skip_or_quarantine
should_upsert_db = false
```

### 9.11 Missing offer price

Expected:

```text id="olq95q"
blocking error = missing_offer_price
publish_decision = skip_or_quarantine
should_upsert_db = false
```

### 9.12 Invalid location scope

Expected:

```text id="cryyjo"
city scope without city_id → missing_city_for_city_scope
region scope without region_id → missing_region_for_region_scope
national scope with city_id or region_id → invalid_location_scope
publish_decision = skip_or_quarantine
```

---

## 10. Wifran Utilization Contract

Add a lightweight offline utilization evaluator.

Recommended file:

```text id="h1arzd"
src/shared/accuracy-harness/wifranUtilizationEvaluator.ts
```

This does not need the full Wifran app.

It should simulate the key rules Wifran needs.

Recommended function:

```ts id="9pjinu"
export function evaluateWifranUtilization(input: {
  canonicalOffer: CanonicalOffer;
  decisionResult: PublishDecisionResult;
  comparisonResult: ComparisonSafetyResult;
  userCityId?: string | null;
}): WifranUtilizationResult
```

It should evaluate:

```text id="pwiurd"
appears_for_city
included_in_search
included_in_best_unit_price_ranking
excluded_from_comparison
display_size_text
display_unit_price_text
```

Location behavior:

```text id="aktzfu"
national → appears for all cities
region → appears for cities in that region if region context is available
city → appears only for matching city_id
```

Comparison behavior:

```text id="nwom7b"
comparison_eligible=true → may be included in best unit-price ranking
comparison_eligible=false → excluded from comparison/ranking
publish_but_exclude_from_comparison → visible in search/display but excluded from ranking
skip_or_quarantine → not visible and not ranked
```

---

## 11. Metrics Report

Add a harness summary report generator.

Recommended file:

```text id="94b5vd"
src/shared/accuracy-harness/accuracyHarnessReport.ts
```

It should output metrics:

```text id="dbr9q9"
total fixtures
passed fixtures
failed fixtures
offer_price accuracy
original_price accuracy
size/content accuracy
pack_quantity accuracy
bundle_quantity accuracy
comparison eligibility accuracy
unit price calculation accuracy
publish decision accuracy
false publish count
false publish wrong price count
size-as-price published count
old-price-as-offer-price published count
comparison error count for comparison_eligible=true
```

The most important zero-tolerance metrics are:

```text id="pf9ncu"
false_publish_wrong_price_count = 0
size_as_price_published_count = 0
old_price_as_offer_price_published_count = 0
comparison_error_for_eligible_count = 0
invalid_location_published_count = 0
```

---

## 12. Thresholds

Add thresholds.

Recommended defaults:

```ts id="svyosq"
export const DEFAULT_ACCURACY_THRESHOLDS = {
  falsePublishWrongPriceMax: 0,
  sizeAsPricePublishedMax: 0,
  oldPriceAsOfferPricePublishedMax: 0,
  invalidLocationPublishedMax: 0,
  comparisonErrorForEligibleMax: 0,
};
```

If a threshold fails, the harness command/test should fail.

---

## 13. CLI / Script

Add a safe command:

```text id="zy0y33"
npm run harness:accuracy
```

It should run the offline fixture harness only.

It must not:

```text id="a9lmne"
call Mistral
upload images
write to Supabase
publish offers
delete files
```

It should print a clear summary and write:

```text id="ut96s4"
wifran-offers-extractor/antigravity-reports/57-accuracy-harness-report.json
wifran-offers-extractor/antigravity-reports/57-accuracy-harness-report.md
```

If project root is already `wifran-offers-extractor`, use:

```text id="nf9o5s"
antigravity-reports/57-accuracy-harness-report.json
antigravity-reports/57-accuracy-harness-report.md
```

---

## 14. Tests

Add tests for the harness itself.

Recommended files:

```text id="dbkcxx"
src/shared/accuracy-harness/__tests__/accuracyHarnessRunner.test.ts
src/shared/accuracy-harness/__tests__/wifranUtilizationEvaluator.test.ts
src/shared/accuracy-harness/__tests__/accuracyHarnessReport.test.ts
```

Required tests:

```text id="h5qz7h"
oil 1.5L valid fixture passes
bad oil size-as-price fixture fails publishing
Fairy 730ml 1+1 fixture passes
bad Fairy old-price-as-current fixture fails publishing
8x135g fixture calculates total content
watermelon per_2kg fixture calculates unit price
TV/electronics fixture is comparison excluded
valid but unclear pack size becomes publish_but_exclude_from_comparison
missing title becomes skip_or_quarantine
missing offer price becomes skip_or_quarantine
invalid city scope becomes skip_or_quarantine
national offer appears for all cities
city offer appears only for matching city
publish_but_exclude offer appears in search but not ranking
skip_or_quarantine does not appear in search or ranking
threshold failure fails report
```

Do not call real Mistral.

Do not call Supabase.

---

## 15. Documentation

Create or update:

```text id="e1aa3y"
docs/developer/accuracy-harness.md
```

Document:

```text id="pjikla"
why the harness exists
how to add a fixture
how to run npm run harness:accuracy
what each metric means
zero-tolerance thresholds
when to use live model evaluation later
how this protects Wifran recommendations
```

Also update README if appropriate.

---

## 16. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not call Mistral.
* Do not upload images.
* Do not write to Supabase.
* Do not publish offers.
* Do not delete extraction folders.
* Do not add DB migrations.
* Do not add DB columns.
* Do not log secrets or env values.

---

## 17. Acceptance Criteria

This chunk is complete when:

* Offline accuracy harness exists.
* Golden fixture structure exists.
* Required fixtures are added.
* Harness runner executes normalization, checks, comparison, decision, DB dry-run mapping, and utilization evaluation.
* Wifran utilization evaluator exists.
* Harness metrics report exists.
* Zero-tolerance thresholds exist.
* `npm run harness:accuracy` exists and runs offline only.
* Harness report is written to Antigravity reports.
* Tests cover the required fixture cases.
* No tests call Mistral.
* No tests call Supabase.
* TypeScript compiles.
* The app remains runnable.

---

## 18. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the offline extraction and Wifran utilization accuracy harness changes needed for this chunk, keep the app runnable, then stop.

Do not perform live model calls, real OCR, image upload, DB writes, or real publishing.

---

## 19. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="dcubie"
files modified
files created
fixture structure
fixtures added
harness runner behavior
Wifran utilization evaluator behavior
metrics tracked
thresholds enforced
harness report paths
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

```text id="cd6jcx"
Run npm run harness:accuracy, inspect zero-tolerance metrics, then run QA dry-run only if the harness passes.