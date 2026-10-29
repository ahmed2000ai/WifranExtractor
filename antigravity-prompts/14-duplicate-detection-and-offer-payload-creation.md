# Antigravity Prompt Chunk 14: Duplicate Detection and Offer Payload Creation

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 14. Prompt Chunks 01 to 13 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, validated import form, local PDF preprocessing, OCR schemas/validation, Mistral OCR integration, controlled OCR pipeline, promotional/banner filtering, local image cropping, import tracking persistence, and brand/category/product matching.

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

Implement duplicate offer detection and final offer payload preparation.

This chunk should take rows that have already gone through:

```text
OCR extraction
normalization
promotional/banner filtering
local image cropping
import tracking persistence
brand/category/product matching
```

and prepare safe final `offers` payloads for later sync.

This chunk should:

```text
build final offer payloads from normalized rows
calculate discount amount
calculate discount percentage
calculate unit price when safe
calculate data quality score
set final offer status to draft or needs_review
detect likely duplicate offers
mark duplicate rows as skipped
attach duplicate_offer_id when found
update import_rows.normalized_data with offer payload and duplicate result when importRowId exists
insert validation_errors for duplicates and payload issues when possible
show offer payload and duplicate results in the UI
```

This chunk must **not** insert final `offers` records yet.

Do **not** upload cropped images to Supabase Storage yet.

Do **not** insert final offers yet.

Do **not** publish offers.

Do **not** add database migrations.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/offerPayload.ts
src/shared/utils/offerCalculations.ts
src/main/db/duplicateOfferService.ts
src/main/db/offerPayloadBuilder.ts
src/main/db/offerPreparationService.ts
src/main/ipc/offerPreparationIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useOfferPreparation.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve these responsibilities.

## 4. Database Tables Used in This Chunk

This chunk may read from:

```text
offers
products
brands
categories
```

This chunk may write only to:

```text
import_rows
validation_errors
```

This chunk must not write to:

```text
offers
offer_sources
import_batches except optional status/count update if already needed
products
brands
categories
product_aliases
saved_offers
watched_items
shopping_lists
profiles
```

Do not add migrations.

## 5. Supabase Security Requirements

All database reads/writes must happen in the Electron main process.

Rules:

* Use the existing Supabase admin client in the main process.
* Do not expose service role key to renderer.
* Do not expose Supabase client to renderer.
* Do not expose generic DB query IPC.
* Do not create raw SQL execution methods.
* Validate renderer input before any database read/write.

Forbidden IPC methods:

```text
db:query
db:insert
sql:execute
supabase:raw
```

Only create narrow offer-preparation IPC methods.

## 6. Shared Offer Payload Types

Create:

```text
src/shared/types/offerPayload.ts
```

Add renderer-safe types.

Recommended:

```ts
export type OfferPayloadInputRow = {
  importRowId?: string | null;
  rowNumber?: number | null;
  rowId: string;
  pageNumber: number;
  status: 'valid' | 'warning' | 'error' | 'skipped' | 'matched';
  skipReason?: string | null;
  normalizedData: unknown;
};

export type PreparedOfferPayload = {
  product_id: string | null;
  supermarket_id: string;
  city_id: string | null;
  region_id: string | null;
  category_id: string | null;
  brand_id: string | null;

  title_ar: string | null;
  title_en: string | null;

  offer_price: number;
  original_price: number | null;
  discount_amount: number | null;
  discount_percentage: number | null;

  pack_size_value: number | null;
  pack_size_unit: string | null;
  pack_quantity: number | null;
  unit_price: number | null;
  unit_price_unit: string | null;

  offer_start_date: string;
  offer_end_date: string;
  status: 'draft' | 'needs_review';

  image_url: string | null;
  source_id: string | null;
  source_page_number: number;
  source_reference: string | null;

  deal_score: number | null;
  deal_label: string | null;
  data_quality_score: number;

  is_loyalty_required: boolean;
  loyalty_notes_ar: string | null;
  loyalty_notes_en: string | null;

  quantity_limit: string | null;
  notes_ar: string | null;
  notes_en: string | null;
};

export type OfferPreparationIssue = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  fieldName?: string | null;
  message: string;
};

export type DuplicateOfferMatch = {
  duplicateOfferId: string;
  matchReason: string;
};

export type OfferPreparationRowResult = {
  rowId: string;
  importRowId?: string | null;
  rowNumber?: number | null;
  status: 'prepared' | 'needs_review' | 'duplicate' | 'error' | 'skipped';
  payload: PreparedOfferPayload | null;
  duplicate: DuplicateOfferMatch | null;
  updatedNormalizedData: unknown;
  issues: OfferPreparationIssue[];
};

export type OfferPreparationInput = {
  importBatchId?: string | null;
  sourceId?: string | null;
  supermarketId: string;
  cityId: string | null;
  regionId: string | null;
  offerStartDate: string;
  offerEndDate: string;
  rows: OfferPayloadInputRow[];
  options: {
    skipDuplicateOffers: boolean;
    defaultOfferStatus: 'draft' | 'needs_review';
    dataQualityNeedsReviewThreshold: number;
    requireImageForDraft: boolean;
  };
};

export type OfferPreparationResult = {
  ok: boolean;
  totalRows: number;
  preparedRows: number;
  needsReviewRows: number;
  duplicateRows: number;
  errorRows: number;
  skippedRows: number;
  results: OfferPreparationRowResult[];
  error?: {
    code: string;
    message: string;
  };
};
```

Adjust based on existing normalized row types if needed.

## 7. Calculation Utilities

Create:

```text
src/shared/utils/offerCalculations.ts
```

Implement helpers:

```ts
export function calculateDiscountAmount(
  offerPrice: number | null,
  originalPrice: number | null
): number | null;

export function calculateDiscountPercentage(
  offerPrice: number | null,
  originalPrice: number | null
): number | null;

export function calculateUnitPrice(input: {
  offerPrice: number | null;
  packSizeValue: number | null;
  packQuantity: number | null;
}): number | null;

export function calculateDataQualityScore(input: {
  hasTitle: boolean;
  hasValidOfferPrice: boolean;
  hasValidOriginalPrice: boolean;
  hasBrand: boolean;
  hasCategory: boolean;
  hasProduct: boolean;
  hasValidPackData: boolean;
  hasImage: boolean;
  confidenceAcceptable: boolean;
  hasWarnings: boolean;
  hasErrors: boolean;
}): number;
```

Rules:

* `discount_amount = original_price - offer_price` only when both are valid and `original_price >= offer_price`.
* `discount_percentage = ((original_price - offer_price) / original_price) * 100` only when safe.
* Round discount percentage to 2 decimals.
* Do not calculate negative discounts.
* Do not calculate unit price when pack data is ambiguous or missing.
* Data quality score should be 0 to 100.

## 8. Offer Payload Builder

Create:

```text
src/main/db/offerPayloadBuilder.ts
```

Implement:

```ts
export function buildPreparedOfferPayload(input: {
  normalizedData: unknown;
  supermarketId: string;
  cityId: string | null;
  regionId: string | null;
  sourceId: string | null;
  offerStartDate: string;
  offerEndDate: string;
  defaultOfferStatus: 'draft' | 'needs_review';
  dataQualityNeedsReviewThreshold: number;
  requireImageForDraft: boolean;
}): {
  payload: PreparedOfferPayload | null;
  issues: OfferPreparationIssue[];
};
```

Responsibilities:

1. Extract matched IDs from `normalizedData.matched`.
2. Extract offer fields from `normalizedData.offer`.
3. Extract crop/image fields from `normalizedData.image` if available.
4. Extract source page number and row ID.
5. Validate required offer fields.
6. Calculate discount amount and percentage.
7. Calculate unit price when safe.
8. Calculate data quality score.
9. Set status to `draft` or `needs_review`.
10. Return issues for missing/uncertain data.

## 9. Required Fields Before Preparing a Final Offer Payload

Do not produce a final payload unless these are valid:

```text
supermarket_id
city_id OR region_id
title_ar OR title_en
offer_price > 0
offer_end_date
source_page_number
row is not NON_PRODUCT_PROMOTIONAL_AREA
row is not skipped
row is not error
```

Strongly recommended fields:

```text
product_id
source_id
offer_start_date
image_url or local image path placeholder
brand_id
category_id
```

If recommended fields are missing, produce payload with `status = needs_review` or create warning, unless the missing field is required by DB constraints.

## 10. Offer Status Rules

For this chunk, prepared payloads may use only:

```text
draft
needs_review
```

Rules:

```text
If row has no warnings/errors and data_quality_score >= threshold:
  status = draft

If row has warnings or data_quality_score < threshold:
  status = needs_review

If image is missing and REQUIRE_IMAGE_FOR_DRAFT = false:
  status = needs_review

If image is missing and REQUIRE_IMAGE_FOR_DRAFT = true:
  return error or block payload according to existing config behavior
```

Do not use:

```text
published
approved
expired
rejected
```

Do not publish offers automatically.

## 11. Duplicate Offer Service

Create:

```text
src/main/db/duplicateOfferService.ts
```

Implement:

```ts
export async function findDuplicateOffer(input: {
  supermarketId: string;
  cityId: string | null;
  regionId: string | null;
  productId: string | null;
  titleAr: string | null;
  titleEn: string | null;
  offerStartDate: string;
  offerEndDate: string;
  offerPrice: number;
  packSizeValue: number | null;
  packSizeUnit: string | null;
  packQuantity: number | null;
}): Promise<DuplicateOfferMatch | null>;
```

Duplicate criteria:

```text
same supermarket_id
same city_id OR same region_id
same product_id if available
same offer_start_date
same offer_end_date
same offer_price
same pack_size_value
same pack_size_unit
same pack_quantity
```

Fallback if product_id is missing:

```text
same title_ar or same title_en
same supermarket/location/date/price/pack fields
```

Rules:

* Search existing `offers`.
* Do not create or update offers in this chunk.
* If duplicate is found, return `duplicateOfferId`.
* If no duplicate is found, return `null`.
* If duplicate check fails due to DB error, return row warning/error but continue other rows.

## 12. Offer Preparation Service

Create:

```text
src/main/db/offerPreparationService.ts
```

Implement:

```ts
export async function prepareOffersForSync(
  input: OfferPreparationInput
): Promise<OfferPreparationResult>;
```

Responsibilities:

1. Validate input.
2. Skip rows with status `skipped`.
3. Skip rows with `skipReason = NON_PRODUCT_PROMOTIONAL_AREA`.
4. Skip/error rows with blocking errors.
5. Build prepared offer payload.
6. Run duplicate detection.
7. If duplicate and `skipDuplicateOffers = true`:

   * status = duplicate
   * payload = null or preserved for review only
   * set duplicate offer ID in normalized data
   * add `DUPLICATE_OFFER_DETECTED`
8. If duplicate and `skipDuplicateOffers = false`:

   * keep payload but add warning.
9. Update import row normalized data if `importRowId` exists.
10. Insert validation errors for issues if `importBatchId` and `importRowId` exist.
11. Return row-level results.
12. Continue if one row fails.

## 13. Normalized Data Shape Update

Update normalized row data to include:

```json
{
  "prepared_offer": {
    "payload": {},
    "status": "draft",
    "data_quality_score": 90
  },
  "matched": {
    "product_id": "uuid-or-null",
    "brand_id": "uuid-or-null",
    "category_id": "uuid-or-null",
    "duplicate_offer_id": "uuid-or-null"
  }
}
```

Do not remove existing OCR, crop, or matching metadata.

## 14. Duplicate Handling Rules

If duplicate is found and skipping duplicates is enabled:

```text
import_rows.status = skipped
normalizedData.matched.duplicate_offer_id = existing offer id
normalizedData.prepared_offer = null or marked duplicate
validation_errors.error_code = DUPLICATE_OFFER_DETECTED
validation_errors.severity = info
```

Do not create a new offer later for this row unless the user explicitly changes duplicate handling.

## 15. Validation Error Codes

Add or confirm these codes:

```text
DUPLICATE_OFFER_DETECTED
OFFER_PAYLOAD_BUILD_FAILED
MISSING_REQUIRED_OFFER_FIELD
MISSING_LOCATION
MISSING_TITLE
MISSING_VALID_OFFER_PRICE
MISSING_SOURCE_PAGE_NUMBER
OFFER_IMAGE_MISSING
OFFER_STATUS_NEEDS_REVIEW
UNIT_PRICE_CALCULATION_SKIPPED
DUPLICATE_CHECK_FAILED
```

Use existing codes where already available.

## 16. Import Row Update Rules

If `importRowId` exists:

* Update `import_rows.normalized_data` with:

  * prepared offer payload
  * calculated fields
  * data quality score
  * duplicate result
  * issues
* If duplicate is found and skipped, update `import_rows.status = skipped`.
* If payload preparation fails, update `import_rows.status = error`.
* If payload has warnings, update `import_rows.status = warning`.
* Do not set `created_offer_id`.
* Do not mark `import_rows.status = imported`.

## 17. Validation Error Persistence

If `importBatchId` and `importRowId` exist:

Create `validation_errors` records for payload and duplicate issues.

Examples:

```json
{
  "severity": "info",
  "field_name": null,
  "error_code": "DUPLICATE_OFFER_DETECTED",
  "message": "Skipped row because a matching offer already exists."
}
```

```json
{
  "severity": "warning",
  "field_name": "image_url",
  "error_code": "OFFER_IMAGE_MISSING",
  "message": "No uploaded image URL exists yet. Offer will need review until storage upload is completed."
}
```

Do not insert duplicate validation errors if the same code/field already exists for the row, if this is easy to check.

## 18. IPC Requirements

Create:

```text
src/main/ipc/offerPreparationIpc.ts
```

Add narrow IPC handler:

```text
offerPreparation:prepare
```

Input:

```ts
OfferPreparationInput
```

Output:

```ts
OfferPreparationResult
```

Do not expose generic DB IPC.

Update:

```text
src/main/ipc/registerIpcHandlers.ts
```

to register offer preparation IPC.

## 19. Preload API Requirements

Update preload to expose:

```ts
window.wifranExtractor.offerPreparation = {
  prepare: (
    input: OfferPreparationInput
  ) => Promise<OfferPreparationResult>
};
```

Do not expose raw `ipcRenderer`.

Do not expose Supabase client.

Do not expose service role key.

## 20. Renderer Hook

Create:

```text
src/renderer/hooks/useOfferPreparation.ts
```

Responsibilities:

* Start offer preparation.
* Track running state.
* Store result.
* Store error.
* Provide reset function.

Recommended return shape:

```ts
{
  running: boolean;
  result: OfferPreparationResult | null;
  error: string | null;
  prepareOffers: (input: OfferPreparationInput) => Promise<void>;
  reset: () => void;
}
```

## 21. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

After entity matching has completed, add a section:

```text
Prepare Offers and Check Duplicates
```

Show:

```text
Rows ready for offer preparation
Skip duplicate offers: true/false
Default offer status
Data quality threshold
Require image for draft: true/false
```

Use values from safe config status:

```text
SKIP_DUPLICATE_OFFERS
DEFAULT_OFFER_STATUS
DATA_QUALITY_NEEDS_REVIEW_THRESHOLD
REQUIRE_IMAGE_FOR_DRAFT
```

Add button:

```text
Prepare Offer Payloads
```

Enable only when:

```text
entity matching has completed OR matched normalized rows exist
form metadata is valid
Supabase config is ready
not currently preparing
```

When clicked:

* Build `OfferPreparationInput`.
* Include `importBatchId` and `sourceId` if available.
* Include selected supermarket/location/dates.
* Include matched normalized rows.
* Call `window.wifranExtractor.offerPreparation.prepare`.
* Show result summary.

Do not insert final offers.

## 22. Results Page Integration

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Show preparation columns:

```text
Prepared Status
Offer Status
Data Quality Score
Duplicate Offer ID
Prepared Payload Issues
```

Add summary cards:

```text
Prepared rows
Needs review rows
Duplicate rows
Payload errors
Skipped rows
```

No final offer IDs yet.

## 23. Logs Page Integration

Update logs with messages such as:

```text
Preparing final offer payloads.
Calculated discounts and data quality scores.
Duplicate detected for row page-2-item-5.
Prepared 80 offer payloads.
Marked 4 rows as duplicates.
Offer preparation completed.
```

Do not log secrets.

Avoid logging huge payloads by default.

## 24. Error Handling

Handle:

```text
missing Supabase config
invalid input rows
missing product/title/price/location
invalid date range
payload build failure
duplicate check failure
import row update failure
validation error insert failure
```

One row failure should not stop all rows.

Return row-level errors.

## 25. README Update

Update README with:

* Offer payload preparation added.
* Duplicate detection added.
* No final offers are created yet.
* Prepared payloads use `draft` or `needs_review`.
* Duplicate rows are skipped by default.
* Supabase service role key remains main-process only.
* How to prepare payloads after entity matching.

## 26. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose generic DB IPC.
* Do not upload files to Supabase Storage.
* Do not insert final `offers`.
* Do not publish offers.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not create offer payloads for promotional/banner rows.
* Do not mark any row as imported.

## 27. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 28. Acceptance Criteria

This chunk is complete when:

* Offer calculation utilities exist.
* Final offer payload builder exists.
* Required offer fields are validated.
* Discount amount and percentage are calculated safely.
* Unit price is calculated only when safe.
* Data quality score is calculated.
* Offer status is set to `draft` or `needs_review`.
* Duplicate detection reads existing `offers`.
* Duplicate rows are marked as duplicate/skipped when configured.
* Prepared payloads are attached to normalized row data.
* Import rows are updated when persisted row IDs are available.
* Validation errors are saved for duplicates and payload issues when possible.
* Results UI shows prepared payload status and duplicates.
* No final offers are inserted.
* No image upload is implemented.
* TypeScript compiles.
* App still starts.

## 29. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How offer payload creation works.
* How calculations work.
* How duplicate detection works.
* How duplicate rows are handled.
* Which tables are read/written.
* Any assumptions made about schema fields.
* Any issues or TODOs.

Keep the project runnable after this chunk.