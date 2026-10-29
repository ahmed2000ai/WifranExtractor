# Antigravity Prompt Chunk 12: Import Batch, Import Rows, and Validation Errors

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 12. Prompt Chunks 01 to 11 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, validated import form, local PDF preprocessing, shared OCR schemas/fixtures/validation, Mistral OCR integration, controlled OCR pipeline, promotional/banner filtering, and local item image cropping.

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

Implement the first database write layer for import tracking.

This chunk should persist the extraction run into Wifran’s import tracking tables:

```text
offer_sources
import_batches
import_rows
validation_errors
```

This chunk should **not** create final offers yet.

It should save the source/batch/row/error records so every OCR extraction is traceable before product matching and final offer sync are implemented.

Do **not** insert final records into `offers` yet.

Do **not** upload cropped images to Supabase Storage yet.

Do **not** implement brand/category/product matching yet.

Do **not** create products, brands, or categories yet.

Do **not** implement duplicate detection yet.

Do **not** publish offers.

Do **not** add database migrations.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/importTracking.ts
src/main/db/importTrackingService.ts
src/main/db/importTrackingMappers.ts
src/main/ipc/importTrackingIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useImportTracking.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve the same responsibilities.

## 4. Database Tables Used in This Chunk

This chunk may write only to:

```text
offer_sources
import_batches
import_rows
validation_errors
```

This chunk must not write to:

```text
offers
products
brands
categories
product_aliases
audit_logs
offer_status_history
saved_offers
watched_items
shopping_lists
profiles
```

Audit logs can be added later if needed.

## 5. Supabase Security Requirements

All Supabase writes must happen in the Electron main process.

Use the existing main-process Supabase admin client created in earlier chunks.

Rules:

* Use `SUPABASE_SERVICE_ROLE_KEY` only in the main process.
* Do not expose the service role key to the renderer.
* Do not expose the Supabase admin client to the renderer.
* Do not expose generic DB query IPC.
* Do not create raw SQL execution methods.
* Validate all renderer input in the main process before writing to Supabase.

Forbidden IPC methods:

```text
db:query
db:insert
sql:execute
supabase:raw
```

Only create narrow import-tracking IPC methods.

## 6. Shared Import Tracking Types

Create:

```text
src/shared/types/importTracking.ts
```

Add renderer-safe types.

Recommended:

```ts
export type OfferSourceCreateInput = {
  sourceType: 'leaflet_pdf';
  supermarketId: string;
  cityId: string | null;
  regionId: string | null;
  title: string;
  fileUrl: string | null;
  validFrom: string;
  validTo: string;
  notes?: string | null;
};

export type ImportBatchCreateInput = {
  sourceId: string;
  supermarketId: string;
  cityId: string | null;
  regionId: string | null;
  fileName: string;
  fileUrl: string | null;
  fileType: 'pdf';
  offerStartDate: string;
  offerEndDate: string;
};

export type ImportRowInput = {
  rowNumber: number;
  rawData: unknown;
  normalizedData: unknown;
  status: 'valid' | 'warning' | 'error' | 'imported' | 'skipped';
};

export type ValidationErrorInput = {
  importRowLocalIndex?: number | null;
  importRowId?: string | null;
  offerId?: string | null;
  severity: 'error' | 'warning' | 'info';
  fieldName?: string | null;
  errorCode: string;
  message: string;
};

export type PersistImportTrackingInput = {
  metadata: {
    supermarketId: string;
    cityId: string | null;
    regionId: string | null;
    supermarketLabel?: string | null;
    locationLabel?: string | null;
    offerStartDate: string;
    offerEndDate: string;
    originalFileName: string;
    workspacePath: string;
    sourcePdfPath?: string | null;
    fileUrl?: string | null;
  };
  ocr: {
    totalExtractedItems: number;
    totalNormalizedRows: number;
    validRowCount: number;
    warningRowCount: number;
    errorRowCount: number;
    skippedRowCount: number;
    skippedPromotionalRowCount: number;
    normalizedRows: unknown[];
  };
  crops?: {
    results: unknown[];
    croppedRows: number;
    skippedRows: number;
    warningRows: number;
    errorRows: number;
  } | null;
};

export type PersistImportTrackingResult = {
  ok: boolean;
  sourceId?: string;
  importBatchId?: string;
  insertedImportRowCount?: number;
  insertedValidationErrorCount?: number;
  batchStatus?: 'uploaded' | 'parsed' | 'validated' | 'imported' | 'partially_imported' | 'failed' | 'cancelled';
  error?: {
    code: string;
    message: string;
  };
};
```

Adjust based on existing row types from previous chunks, but keep renderer-safe types only.

## 7. Offer Source Creation Rules

Create one `offer_sources` record per imported leaflet.

Recommended values:

```text
source_type = leaflet_pdf
supermarket_id = selected supermarket
city_id = selected city, if selected
region_id = selected region, if selected
title = generated title
source_url = null
file_url = null unless original PDF upload has already been implemented
valid_from = selected offer start date
valid_to = selected offer end date
notes = optional
```

Recommended title format:

```text
{supermarket_label} leaflet - {location_label} - {YYYY-MM-DD} to {YYYY-MM-DD}
```

If labels are unavailable, use IDs safely or fallback to file name.

Do not upload the original PDF in this chunk unless that already exists from a previous chunk. `file_url` may remain `null`.

## 8. Import Batch Creation Rules

Create one `import_batches` record after creating `offer_sources`.

Initial values:

```text
source_id = created offer source id
supermarket_id = selected supermarket
city_id = selected city, if selected
region_id = selected region, if selected
file_name = selected PDF file name
file_url = null unless source PDF upload exists
file_type = pdf
status = validated
total_rows = OCR normalized row count
valid_rows = valid count
warning_rows = warning count
error_rows = error count
imported_rows = 0
skipped_rows = skipped count
offer_start_date = selected start date
offer_end_date = selected end date
completed_at = null
```

Use DB-allowed statuses only:

```text
uploaded
parsed
validated
imported
partially_imported
failed
cancelled
```

For this chunk, because OCR and local cropping have already happened before persistence, use:

```text
status = validated
```

If there are zero normalized rows, use:

```text
status = failed
```

unless the implementation chooses `validated` with warnings. Document the choice.

## 9. Import Row Creation Rules

Create one `import_rows` record for every normalized OCR row that should be tracked.

Fields:

```text
import_batch_id
row_number
raw_data
normalized_data
status
created_offer_id = null
```

Status mapping from normalized OCR rows:

```text
normalized status valid   -> import_rows.status valid
normalized status warning -> import_rows.status warning
normalized status error   -> import_rows.status error
normalized status skipped -> import_rows.status skipped
```

Rules:

* Preserve raw OCR item JSON in `raw_data`.
* Preserve normalized row JSON in `normalized_data`.
* Include crop result metadata in `normalized_data` when available.
* Do not set `created_offer_id` yet.
* Do not create final offer records yet.
* Skipped promotional/banner rows may be saved as `skipped` for audit/debugging.

## 10. Validation Error Creation Rules

Create `validation_errors` records for every issue from normalized rows and crop results.

Fields:

```text
import_batch_id
import_row_id
offer_id = null
severity
field_name
error_code
message
```

Severity values:

```text
error
warning
info
```

Rules:

* Blocking row problems use `error`.
* Non-blocking row quality issues use `warning`.
* Skipped promotional/banner rows may use `info`.
* Duplicate errors are not implemented yet.
* Image crop failures should be saved if crop results exist.
* Missing bounding box should be saved if present in row issues.
* Do not create validation errors for rows with no issues.

## 11. Error Codes to Support

This chunk should persist existing issue codes from earlier chunks.

Common examples:

```text
MISSING_PRODUCT_NAME
MISSING_OFFER_PRICE
INVALID_OFFER_PRICE
INVALID_ORIGINAL_PRICE
ORIGINAL_PRICE_LESS_THAN_OFFER_PRICE
INVALID_PAGE_NUMBER
MISSING_BOUNDING_BOX
INVALID_BOUNDING_BOX
BOUNDING_BOX_TOO_SMALL
BOUNDING_BOX_TOO_LARGE
BOUNDING_BOX_OUT_OF_PAGE
BOUNDING_BOX_CLAMPED
IMAGE_CROP_FAILED
PAGE_IMAGE_NOT_FOUND
LOW_CONFIDENCE_EXTRACTION
PRICE_SUSPICIOUS
PACK_DATA_AMBIGUOUS
NON_PRODUCT_PROMOTIONAL_AREA
POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA
OCR_SCHEMA_VALIDATION_ERROR
```

Do not invent unrelated new codes unless needed.

## 12. Import Tracking Mapper

Create:

```text
src/main/db/importTrackingMappers.ts
```

Responsibilities:

* Convert import form metadata + OCR result + crop result into:

  * offer source payload
  * import batch payload
  * import row payloads
  * validation error payloads
* Ensure DB field names match actual schema.
* Ensure only allowed statuses are used.
* Ensure dates are `YYYY-MM-DD`.
* Ensure city or region exists.
* Ensure raw JSON is serializable.
* Merge crop metadata into normalized row data.

Important:

If actual DB column names differ slightly from expected docs, adapt to the SQL schema, not guesses.

## 13. Import Tracking Service

Create:

```text
src/main/db/importTrackingService.ts
```

Implement:

```ts
export async function persistImportTracking(
  input: PersistImportTrackingInput
): Promise<PersistImportTrackingResult>;
```

Responsibilities:

1. Validate input.
2. Create `offer_sources`.
3. Create `import_batches`.
4. Insert `import_rows`.
5. Insert `validation_errors`.
6. Update batch counts if needed.
7. Return IDs and counts.
8. Handle partial failures safely.

## 14. Transaction/Consistency Guidance

Supabase client operations may not be a real transaction unless using RPC.

For MVP:

* Insert `offer_sources`.
* Insert `import_batches`.
* Insert `import_rows`.
* Insert `validation_errors`.
* If a later step fails, return clear error and preserve whatever was inserted.
* If batch exists and row/error insertion fails, attempt to update batch status to `failed`.
* Do not delete inserted records automatically unless a safe rollback strategy is explicitly implemented.

Do not add database RPCs or migrations in this chunk.

## 15. Bulk Insert Guidance

For `import_rows` and `validation_errors`, use bulk inserts where practical.

If bulk insert fails:

* Return a safe error.
* Attempt to mark batch as `failed`.
* Do not crash the app.
* Do not leak secrets.

If there are many rows, consider batching inserts in chunks.

Recommended insert chunk size:

```text
100 rows
```

## 16. IPC Requirements

Create:

```text
src/main/ipc/importTrackingIpc.ts
```

Add narrow IPC handler:

```text
importTracking:persist
```

Input:

```ts
PersistImportTrackingInput
```

Output:

```ts
PersistImportTrackingResult
```

Do not expose generic database IPC.

Update:

```text
src/main/ipc/registerIpcHandlers.ts
```

to register the import tracking IPC.

## 17. Preload API Requirements

Update preload to expose:

```ts
window.wifranExtractor.importTracking = {
  persist: (
    input: PersistImportTrackingInput
  ) => Promise<PersistImportTrackingResult>
};
```

Do not expose raw `ipcRenderer`.

Do not expose Supabase client.

Do not expose service role key.

## 18. Renderer Hook

Create:

```text
src/renderer/hooks/useImportTracking.ts
```

Responsibilities:

* Persist import tracking data.
* Track saving state.
* Store result.
* Store error.
* Provide reset function.

Recommended return shape:

```ts
{
  saving: boolean;
  result: PersistImportTrackingResult | null;
  error: string | null;
  persist: (input: PersistImportTrackingInput) => Promise<void>;
  reset: () => void;
}
```

## 19. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

After OCR and optional local image cropping have completed, add a section:

```text
Save Import Tracking
```

This section should show:

```text
Selected supermarket
Selected location
Offer dates
Original file name
OCR row counts
Crop counts, if available
```

Add button:

```text
Save Import Tracking to Wifran DB
```

Enable only when:

```text
OCR pipeline result exists
form metadata is valid
Supabase config is ready
not currently saving
```

When clicked:

* Build `PersistImportTrackingInput`.
* Include OCR normalized rows.
* Include crop results if available.
* Call `window.wifranExtractor.importTracking.persist`.
* Show result:

  * source ID
  * import batch ID
  * inserted row count
  * inserted validation error count

Do not create final offers.

## 20. Results Page Integration

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Show import tracking persistence status if available:

```text
Offer source ID
Import batch ID
Import rows inserted
Validation errors inserted
Batch status
```

Rows should still show OCR/crop statuses.

No final offer IDs yet.

## 21. Logs Page Integration

Update logs with messages such as:

```text
Creating offer source.
Creating import batch.
Inserting import rows.
Inserting validation errors.
Import tracking saved.
Import tracking failed.
```

Do not log service role key.

Do not log full raw OCR JSON in UI logs unless debug mode intentionally supports it.

## 22. Validation Requirements

Validate before DB write:

```text
supermarketId exists
cityId or regionId exists
offerStartDate valid
offerEndDate valid
offerEndDate >= offerStartDate
originalFileName exists
OCR normalized rows array exists
row statuses are allowed
validation severities are allowed
```

If validation fails:

* Do not write anything.
* Return safe error.

## 23. Safe Error Handling

Handle:

```text
missing Supabase config
Supabase connection failure
offer_sources insert failure
import_batches insert failure
import_rows insert failure
validation_errors insert failure
invalid input
empty rows
schema mismatch
```

Return safe errors like:

```text
Failed to create import batch. Check Supabase configuration and table schema.
```

Do not expose:

```text
SUPABASE_SERVICE_ROLE_KEY
Authorization headers
raw SQL with secrets
```

## 24. README Update

Update README with:

* Import tracking persistence added.
* Tables written:

  * `offer_sources`
  * `import_batches`
  * `import_rows`
  * `validation_errors`
* No final offers are created yet.
* Supabase service role key remains main-process only.
* How to save import tracking after OCR/cropping.
* Troubleshooting common Supabase schema errors.

## 25. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose generic DB IPC.
* Do not upload files to Supabase Storage.
* Do not insert final `offers`.
* Do not create products, brands, or categories.
* Do not create product aliases.
* Do not implement duplicate detection yet.
* Do not publish offers.
* Do not add database migrations.
* Do not delete existing Wifran data.

## 26. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 27. Acceptance Criteria

This chunk is complete when:

* `offer_sources` can be created from import metadata.
* `import_batches` can be created and linked to the source.
* `import_rows` can be inserted with raw and normalized data.
* `validation_errors` can be inserted for row/crop issues.
* Batch counts are correct.
* Skipped promotional/banner rows are saved as skipped or intentionally omitted according to documented behavior.
* No final offer records are created.
* No products/brands/categories are created.
* Renderer can trigger persistence only through safe preload API.
* Renderer never receives service role key.
* Results page shows source/batch IDs and inserted counts.
* Errors are handled safely.
* TypeScript compiles.
* App still starts.

## 28. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* Which tables are written.
* How row statuses map to `import_rows`.
* How validation errors are generated.
* How Supabase service role key is protected.
* Any assumptions made about schema fields.
* Any issues or TODOs.

Keep the project runnable after this chunk.