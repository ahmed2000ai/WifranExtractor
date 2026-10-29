# Antigravity Prompt Chunk 17: End-to-End Testing With Fixtures and Sample PDFs

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 17. Prompt Chunks 01 to 16 should already have created the full application flow from PDF selection through OCR, promotional filtering, image cropping, import tracking, entity matching, offer preparation, offer sync, and results/logging UI.

## 1. Read These Files First

Before coding, read all files inside:

```text
project-knowledge/
```

Specifically read:

```text
project-knowledge/00-prd-wifran-offers-extractor.md
project-knowledge/01-product-brief-and-scope.md
project-knowledge/02-wifran-db-schema-and-sync-rules.md
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/06-env-security-and-credentials.md
project-knowledge/07-sample-extraction-json.md
project-knowledge/08-antigravity-development-plan.md
```

Treat these files as the source of truth.

## 2. Goal of This Prompt Chunk

Add testing coverage and end-to-end verification for the Wifran Offers Extractor.

The goal is to make sure the app is reliable before packaging and daily internal use.

This chunk should add tests or validation scripts for:

```text
OCR schema validation
OCR normalization
Arabic numeral conversion
price parsing
unit normalization
promotional/banner filtering
bounding box normalization
image cropping logic
offer calculations
duplicate detection logic where practical
offer payload preparation
safe row status mapping
pipeline summary building
```

This chunk should also add a manual end-to-end testing checklist for real supermarket PDF leaflets.

Do **not** add database migrations.

Do **not** publish offers automatically.

Do **not** delete existing Wifran data.

Do **not** modify customer/user tables.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
scripts/validateFixtures.ts
scripts/runLocalSmokeTests.ts
src/shared/fixtures/README.md
src/shared/fixtures/valid-ocr-response.json
src/shared/fixtures/empty-ocr-response.json
src/shared/fixtures/promotional-banner-response.json
src/shared/fixtures/promotional-filter-edge-cases.json
src/shared/fixtures/missing-price-response.json
src/shared/fixtures/missing-product-name-response.json
src/shared/fixtures/missing-bounding-box-response.json
src/shared/fixtures/invalid-original-price-response.json
src/shared/fixtures/loyalty-offer-response.json
src/shared/fixtures/normalized-row-example.json
src/shared/fixtures/final-offer-payload-example.json
docs/testing/manual-e2e-test-checklist.md
docs/testing/sample-pdf-testing-guide.md
README.md
package.json
```

If the project already has a test framework, use it and add test files in the existing convention.

If the project does not have a test framework, add simple Node/TypeScript scripts that can be run with `npm` scripts.

## 4. Testing Philosophy

Tests should protect against the most expensive mistakes:

```text
creating fake offers from promotional banners
creating fake offers from generic 1+1 graphics
losing Arabic text
guessing missing prices
accepting invalid prices
creating offers without product names
using wrong page numbers
cropping banners instead of product items
publishing offers automatically
exposing secrets in renderer/logs
```

Focus on correctness and safety.

Do not over-engineer testing infrastructure.

## 5. Required Package Scripts

Add or confirm package scripts:

```json
{
  "scripts": {
    "typecheck": "...",
    "validate:fixtures": "...",
    "test:smoke": "...",
    "test": "..."
  }
}
```

If `test` is not backed by a real test runner yet, it can run:

```text
npm run typecheck && npm run validate:fixtures && npm run test:smoke
```

Do not add broken scripts.

## 6. Fixture Validation Script

Create or update:

```text
scripts/validateFixtures.ts
```

This script should load fixtures and assert expected behavior.

It must validate:

```text
valid-ocr-response.json
empty-ocr-response.json
promotional-banner-response.json
promotional-filter-edge-cases.json
missing-price-response.json
missing-product-name-response.json
missing-bounding-box-response.json
invalid-original-price-response.json
loyalty-offer-response.json
```

Expected outcomes:

### Valid OCR response

```text
schema parses
rows normalize successfully
valid product rows are not skipped
product 1+1 rows are not treated as banners
offer prices remain numeric
Arabic product names are preserved
```

### Empty OCR response

```text
{ items: [] } is accepted
no rows are created
not treated as invalid JSON
```

### Promotional banner response

```text
row is skipped
skip_reason = NON_PRODUCT_PROMOTIONAL_AREA
no offer payload is created
```

### Promotional edge cases

Must assert:

```text
real product with 1+1 is not skipped
generic 1+1 banner is skipped
date badge only is skipped
sponsor/logo-only row is skipped
Lurpak product row is not skipped
ambiguous promo row becomes warning, not automatic imported offer
```

### Missing price

```text
status = error
error code includes MISSING_OFFER_PRICE
no final offer payload should be created
```

### Missing product name

```text
status = error
error code includes MISSING_PRODUCT_NAME
no final offer payload should be created
```

### Missing bounding box

```text
status = warning
error/warning code includes MISSING_BOUNDING_BOX
row can still proceed as needs_review if core data is valid
```

### Invalid original price

```text
warning or error is produced according to current documented rule
negative discount is not calculated
```

### Loyalty offer

```text
is_loyalty_required is preserved
loyalty_notes_ar is preserved
loyalty_notes_en is preserved
```

The script should print a readable pass/fail summary and exit non-zero on failure.

## 7. Smoke Test Script

Create:

```text
scripts/runLocalSmokeTests.ts
```

This should run lightweight pure-code checks that do not require real Supabase or Mistral credentials.

Test areas:

```text
Arabic numeral conversion
price parsing
unit normalization
bounding box normalization
offer calculations
data quality scoring
storage path sanitization
pipeline summary building
safe status mapping
```

Do not call:

```text
Mistral OCR API
Supabase database
Supabase Storage
real file upload
real offer sync
```

Smoke tests should be offline and safe.

## 8. OCR and Normalization Tests

Add coverage for:

```text
top-level OCR shape
required items array
missing optional fields normalization
empty strings converted to null
warnings array defaulting to []
confidence range handling
page_number positive integer validation
offer_price validation
original_price >= offer_price logic
pack_quantity normalization
unit normalization
```

Ensure invalid data produces clear issue codes.

## 9. Promotional/Banner Filtering Tests

Add explicit tests for:

```text
campaign slogan only
generic 1+1 banner
date badge only
supermarket logo only
sponsor logo only
cover/header only
real product with 1+1
real product with sponsor brand name
ambiguous promo text
```

Required result:

```text
Obvious non-product promotional rows are skipped.
Real product offers are kept.
Ambiguous rows are warning, not silently imported.
```

## 10. Bounding Box Tests

Add tests for:

```text
already pixel-based x/y/width/height box
top-left/bottom-right box
camelCase topLeft/bottomRight box
polygon box
normalized 0-to-1 coordinate box
missing box
box outside page
box too small
box too large
padding and clamping
```

Expected behavior:

```text
valid boxes normalize correctly
out-of-bounds boxes are clamped when safe
invalid boxes produce clear issues
promotional/banner rows are not cropped
```

## 11. Offer Calculation Tests

Add tests for:

```text
discount amount
discount percentage
invalid original price below offer price
missing original price
unit price with pack quantity
unit price skipped when pack data missing
data quality score
```

Rules:

```text
Do not calculate negative discounts.
Do not calculate unit price when pack data is ambiguous.
Round discount percentage consistently.
```

## 12. Offer Payload Tests

Test payload preparation for:

```text
valid matched row
row missing product_id but otherwise valid
row missing image
row with warnings
row below data quality threshold
duplicate row
promotional/banner skipped row
error row missing price
```

Expected:

```text
valid rows produce payload
warning rows produce needs_review where appropriate
missing image produces needs_review or error according to config
duplicates are skipped when configured
promotional/banner rows produce no payload
error rows produce no payload
no payload uses status published
```

## 13. Pipeline Summary Tests

Add tests for:

```text
summary before any run
summary after OCR only
summary after cropping
summary after import tracking
summary after entity matching
summary after offer preparation
summary after final sync
partial failure
promotional skipped rows
duplicate rows
needs_review imported rows
```

Expected:

```text
counts are correct
stages show correct status
rows preserve row IDs
created offer IDs are visible when present
skipped promotional rows remain visible
```

## 14. Security Smoke Checks

Add simple static or runtime checks where practical.

Check that renderer code does not import main-process config modules.

At minimum, add comments or a smoke script check for forbidden patterns:

```text
import ... from '../../main/config/env'
process.env.SUPABASE_SERVICE_ROLE_KEY
process.env.MISTRAL_API_KEY
ipcRenderer exposed directly
config:getMistralApiKey
config:getSupabaseServiceRoleKey
db:query
sql:execute
```

If implementing a static scan script is easy, include it in `test:smoke`.

If not, document this as manual review checklist.

## 15. Manual E2E Test Checklist

Create:

```text
docs/testing/manual-e2e-test-checklist.md
```

Include step-by-step manual testing:

## 15.1 Setup

```text
Install dependencies.
Create .env.local from .env.example.
Add Supabase and Mistral credentials locally.
Start app in development mode.
Confirm settings page shows config ready.
```

## 15.2 Reference Data

```text
Open Import page.
Confirm supermarkets load.
Select a supermarket.
Confirm valid city/region options appear.
```

## 15.3 PDF Preprocessing

```text
Select a sample supermarket leaflet PDF.
Validate file name and size.
Run PDF preprocessing.
Confirm page count.
Confirm chunk count.
Confirm rendered pages count.
Confirm workspace path exists.
```

## 15.4 OCR

```text
Run OCR on one chunk.
Confirm product items extracted.
Confirm cover/banner-only pages return zero items or skipped banner rows.
Run OCR on all chunks.
Confirm failed chunks are visible if any.
```

## 15.5 Promotional Filtering

```text
Confirm generic campaign banners are skipped.
Confirm real product 1+1 offers are not skipped.
Confirm skipped promotional count appears in summary.
```

## 15.6 Image Cropping

```text
Run local image cropping.
Confirm valid rows create local cropped images.
Confirm missing bounding boxes are warnings.
Confirm promotional rows are not cropped.
```

## 15.7 Import Tracking

```text
Save import tracking.
Confirm offer_source created.
Confirm import_batch created.
Confirm import_rows created.
Confirm validation_errors created for warnings/errors.
```

## 15.8 Entity Matching

```text
Run entity matching.
Confirm brands/products are reused or created according to config.
Confirm categories are matched but not auto-created by default.
Confirm promotional rows create no brands/products.
```

## 15.9 Offer Preparation

```text
Prepare offer payloads.
Confirm draft/needs_review status only.
Confirm duplicate rows are detected.
Confirm no published status.
```

## 15.10 Offer Sync

```text
Run final sync.
Confirm images upload.
Confirm offers are inserted as draft or needs_review.
Confirm import_rows.created_offer_id is updated.
Confirm import_batches final status is updated.
Confirm duplicate/promotional/error rows are not inserted as offers.
```

## 15.11 Results Review

```text
Open Results page.
Check imported count.
Check needs review count.
Check skipped promotional count.
Check duplicate count.
Open row details.
Confirm created offer IDs appear.
```

## 16. Sample PDF Testing Guide

Create:

```text
docs/testing/sample-pdf-testing-guide.md
```

Explain how to test with real PDFs:

```text
Use short 1-3 page PDFs first.
Then test dense weekly leaflets.
Then test PDFs with cover pages.
Then test PDFs with large banners and generic 1+1 campaign graphics.
Then test Arabic-only leaflets.
Then test mixed Arabic/English leaflets.
```

Include what to record:

```text
supermarket name
PDF page count
OCR chunk size
render DPI
OCR extracted item count
skipped promotional count
cropped image count
imported offers count
errors/warnings
manual notes about false positives/false negatives
```

## 17. Test Data Safety

Testing with real database sync must be careful.

Rules:

```text
Use draft or needs_review only.
Do not publish.
Use a test supermarket/location if available.
Use short offer date ranges if testing.
Do not delete existing offers.
Do not truncate tables.
Do not modify customers/users.
```

If testing against production Wifran DB, document that the operator should review created draft/needs_review offers after sync.

## 18. README Update

Update README with:

```text
How to run typecheck
How to run fixture validation
How to run smoke tests
How to perform manual E2E testing
Where testing docs are located
Current limitations
Known safe testing behavior
```

## 19. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` secrets to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic IPC.
* Do not publish offers automatically.
* Do not use `status = published`.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not modify customer user data.
* Do not create offers from promotional/banner rows.
* Do not make tests depend on real credentials unless explicitly documented as manual E2E steps.

## 20. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 21. Acceptance Criteria

This chunk is complete when:

* Fixture validation script exists and runs.
* Offline smoke test script exists and runs.
* Promotional/banner filtering tests cover edge cases.
* OCR normalization fixture tests cover valid/error/warning/skipped rows.
* Bounding box normalization tests cover supported input forms.
* Offer calculation tests cover discounts/unit price/data quality.
* Offer payload tests ensure no `published` status is produced.
* Pipeline summary tests or checks exist.
* Security smoke checks or manual checklist exists.
* Manual E2E checklist exists.
* Sample PDF testing guide exists.
* README explains how to run tests.
* TypeScript compiles.
* App still starts.

## 22. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How fixture validation works.
* How smoke tests work.
* How to run tests.
* What manual E2E checklist covers.
* Any assumptions made about test framework/tooling.
* Any issues or TODOs.

Keep the project runnable after this chunk.