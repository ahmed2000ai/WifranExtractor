# Accuracy Harness – Developer Guide

## Why the Harness Exists

The accuracy harness tests the **full extraction-to-utilization chain** offline, without calling Mistral, uploading images, writing to Supabase, or publishing offers.

The most important failure to prevent is:

> **A wrong offer price being published.**

A skipped valid offer is annoying. A wrong published offer price damages trust.

The harness verifies:

```
crop/fixture → raw model JSON → canonical normalization → style-aware validation
→ deterministic checks → comparison safety → publish decision → DB payload dry-run
→ Wifran utilization behavior
```

## How to Run

```bash
npm run harness:accuracy
```

This command:
- Loads all fixture folders from `tests/fixtures/accuracy-harness/`
- Runs each fixture through the full offline pipeline
- Generates a report with metrics and zero-tolerance counters
- Writes reports to:
  - `antigravity-reports/57-accuracy-harness-report.json`
  - `antigravity-reports/57-accuracy-harness-report.md`
- Exits with code 1 if any threshold fails or any fixture fails

To run the test suite directly:

```bash
npm run test:harness
```

## How to Add a Fixture

1. Create a new folder under `tests/fixtures/accuracy-harness/`:

```
tests/fixtures/accuracy-harness/my-new-fixture/
  fixture.json
  crop.webp          (optional)
  raw_mistral_response.json  (optional, if separate)
```

2. Define `fixture.json` following the schema:

```json
{
  "schema_version": 1,
  "id": "my-new-fixture",
  "description": "What this fixture tests",
  "supermarket_slug": "othaim",

  "source": {
    "page_number": 1,
    "item_number": "001",
    "notes": ["Why this fixture exists"]
  },

  "trusted_context": {
    "supermarket_id": "sm-othaim",
    "location_scope": "national",
    "offer_start_date": "2026-06-01",
    "offer_end_date": "2026-12-31"
  },

  "inputs": {
    "raw_mistral_response": {
      "name_en": "Product Name",
      "offer_price": 10,
      "size": "1L"
    }
  },

  "expected": {
    "blocking_error_codes": [],
    "comparison": {
      "comparison_eligible": true,
      "comparison_unit": "liter",
      "comparison_unit_price": 10.0,
      "tolerance": 0.05
    },
    "decision": {
      "publish_decision": "publish",
      "should_upsert_db": true,
      "should_upload_image": true
    }
  }
}
```

3. Run `npm run harness:accuracy` to verify it passes.

4. **Every new known extraction failure should become a fixture.**

## What Each Metric Means

### Field Accuracy Metrics (0.0 – 1.0)

| Metric | Description |
|---|---|
| `offer_price_accuracy` | % of fixtures where actual offer_price matches expected |
| `original_price_accuracy` | % of fixtures where actual original_price matches expected |
| `size_content_accuracy` | % of fixtures where actual size_text matches expected |
| `pack_quantity_accuracy` | % of fixtures where actual pack_quantity matches expected |
| `bundle_quantity_accuracy` | % of fixtures where actual bundle_quantity matches expected |
| `comparison_eligibility_accuracy` | % of fixtures where comparison_eligible matches expected |
| `unit_price_calculation_accuracy` | % of fixtures where unit price is within tolerance |
| `publish_decision_accuracy` | % of fixtures where publish decision matches expected |

### Zero-Tolerance Counters (must be 0)

| Counter | Description | Threshold |
|---|---|---|
| `false_publish_wrong_price_count` | Published offer with wrong price | 0 |
| `size_as_price_published_count` | Size value published as price | 0 |
| `old_price_as_offer_price_published_count` | Old price published as offer price | 0 |
| `comparison_error_for_eligible_count` | Eligible offer failed comparison | 0 |
| `invalid_location_published_count` | Invalid location scope published | 0 |

## Zero-Tolerance Thresholds

These thresholds are enforced by `DEFAULT_ACCURACY_THRESHOLDS`:

```typescript
export const DEFAULT_ACCURACY_THRESHOLDS = {
  falsePublishWrongPriceMax: 0,
  sizeAsPricePublishedMax: 0,
  oldPriceAsOfferPricePublishedMax: 0,
  invalidLocationPublishedMax: 0,
  comparisonErrorForEligibleMax: 0,
};
```

If **any** threshold is exceeded, the harness fails with exit code 1.

## Harness Levels

### Level 1: Offline Fixture Harness (Implemented)

- No API calls
- Uses saved raw Mistral response JSON as input
- Fast regression testing

### Level 1.5: Runtime Accuracy Harness (Implemented)

- Runs automatically at the end of the `cropAndItemOcrWorkflow` (after normalization, validation, and publish decision)
- Acts as a **Quality Gate** before the Pre-Publish Preview
- Detects critical failures (e.g., size as price) and rate-based anomalies (e.g., high validation failure rate)
- Generates `fixture-candidates` for suspicious rows that developers can later promote to golden fixtures
- Disables publish if the `decision` is `block_publish` or `needs_human_review`

### Level 2: Live Model Evaluation Harness (Future Stub)

- Will call Mistral on selected fixture crop images
- Interfaces defined but not implemented

### Level 3: End-to-End Dry-Run Harness (Future Stub)

- Uses existing dry-run publish pipeline
- No real Supabase writes
- Interfaces defined but not implemented

## How This Protects Wifran Recommendations

The harness includes a **Wifran Utilization Evaluator** that simulates how the Wifran app would consume published offers:

- **Location visibility**: National offers appear for all cities; city-scoped offers appear only for matching cities
- **Search inclusion**: Published offers appear in search; quarantined offers do not
- **Best unit-price ranking**: Only comparison-eligible published offers are included
- **Display texts**: Size text and unit price text are generated for display

This ensures that extraction errors don't propagate to end-user recommendations.

## File Structure

```
src/shared/types/accuracyHarness.ts          – Type definitions
src/shared/accuracy-harness/
  index.ts                                    – Barrel export
  runAccuracyHarnessFixture.ts               – Main harness runner
  wifranUtilizationEvaluator.ts              – Utilization evaluator
  accuracyHarnessReport.ts                   – Report generator
  __tests__/
    accuracyHarnessRunner.test.ts            – Runner tests
    wifranUtilizationEvaluator.test.ts       – Utilization tests
    accuracyHarnessReport.test.ts            – Report tests

tests/fixtures/accuracy-harness/             – Golden fixture folders
  othaim-oil-1-5l/fixture.json
  bad-oil-size-as-price/fixture.json
  fairy-730ml-1-plus-1/fixture.json
  bad-fairy-old-price-as-current/fixture.json
  pack-8x135g/fixture.json
  watermelon-per-2kg/fixture.json
  30-pieces/fixture.json
  tv-electronics/fixture.json
  unclear-pack-size/fixture.json
  missing-title/fixture.json
  missing-offer-price/fixture.json
  invalid-location-city-scope-no-city/fixture.json
  invalid-location-region-scope-no-region/fixture.json
  invalid-location-national-with-city/fixture.json
  city-scope-riyadh-offer/fixture.json
  national-scope-offer/fixture.json

scripts/runAccuracyHarness.ts                – CLI entry point
```
