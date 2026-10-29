# Antigravity Prompt Chunk 15: Supabase Storage Upload and Offer Sync

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 15. Prompt Chunks 01 to 14 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, validated import form, local PDF preprocessing, OCR schemas/validation, Mistral OCR integration, controlled OCR pipeline, promotional/banner filtering, local image cropping, import tracking persistence, entity matching, duplicate detection, and final offer payload preparation.

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

Implement Supabase Storage upload and final offer sync.

This chunk should take prepared offer rows from Prompt Chunk 14, upload cropped item images when available, insert final records into the existing Wifran `offers` table, update related `import_rows`, save validation errors for sync problems, and update the import batch summary.

This is the first chunk that creates final Wifran offer records.

The implementation must be conservative and traceable.

This chunk should:

```text
upload cropped item images to Supabase Storage
attach uploaded image URLs to prepared offer payloads
insert valid final offer records into offers
insert warning rows as needs_review when allowed
skip duplicate rows
skip promotional/banner rows
skip rows with blocking errors
update import_rows.created_offer_id after successful offer insert
update import_rows.status to imported, skipped, warning, or error
save validation_errors for upload/sync failures
update import_batches final counts and status
show final sync results in the UI
```

Do **not** publish offers automatically.

Do **not** use `status = published`.

Do **not** delete existing Wifran data.

Do **not** add database migrations.

Do **not** change RLS policies.

Do **not** modify customer/user tables.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/offerSync.ts
src/main/storage/storagePathBuilder.ts
src/main/storage/offerImageStorageService.ts
src/main/db/offerSyncMapper.ts
src/main/db/offerSyncService.ts
src/main/ipc/offerSyncIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useOfferSync.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve these responsibilities.

## 4. Database and Storage Used in This Chunk

This chunk may write to:

```text
offers
import_rows
validation_errors
import_batches
```

This chunk may upload to:

```text
Supabase Storage bucket from SUPABASE_STORAGE_BUCKET
```

This chunk may read from:

```text
import_batches
import_rows
offers
supermarkets
```

This chunk must not write to:

```text
products
brands
categories
product_aliases
offer_sources except if absolutely necessary to attach file_url already created elsewhere
saved_offers
watched_items
shopping_lists
profiles
```

Products, brands, categories, and aliases should already have been handled in Prompt Chunk 13.

## 5. Supabase Security Requirements

All Supabase Storage and database writes must happen in the Electron main process.

Rules:

* Use the existing Supabase admin client in the main process.
* Use `SUPABASE_SERVICE_ROLE_KEY` only in the main process.
* Do not expose service role key to renderer.
* Do not expose Supabase client to renderer.
* Do not expose generic DB query IPC.
* Do not expose generic storage upload IPC.
* Validate renderer input before upload or insert.
* Do not create raw SQL execution methods.
* Do not log secrets.

Forbidden IPC methods:

```text
db:query
db:insert
sql:execute
supabase:raw
storage:uploadAnyFile
storage:deleteAnyFile
```

Only create narrow offer-sync IPC methods.

## 6. Shared Offer Sync Types

Create:

```text
src/shared/types/offerSync.ts
```

Add renderer-safe types.

Recommended:

```ts
export type OfferSyncInputRow = {
  importRowId?: string | null;
  rowNumber?: number | null;
  rowId: string;
  pageNumber: number;
  status: 'prepared' | 'needs_review' | 'duplicate' | 'error' | 'skipped';
  preparedPayload: unknown;
  normalizedData: unknown;
  localImagePath?: string | null;
  duplicateOfferId?: string | null;
  issues?: Array<{
    severity: 'info' | 'warning' | 'error';
    code: string;
    fieldName?: string | null;
    message: string;
  }>;
};

export type OfferSyncOptions = {
  requireImageForDraft: boolean;
  defaultOfferStatus: 'draft' | 'needs_review';
};

export type OfferSyncInput = {
  importBatchId?: string | null;
  sourceId?: string | null;
  supermarketId: string;
  supermarketSlug?: string | null;
  offerStartDate: string;
  offerEndDate: string;
  storageBucket: string;
  rows: OfferSyncInputRow[];
  options: OfferSyncOptions;
};

export type OfferSyncIssue = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  fieldName?: string | null;
  message: string;
};

export type OfferSyncRowResult = {
  rowId: string;
  importRowId?: string | null;
  rowNumber?: number | null;
  status:
    | 'imported'
    | 'needs_review_imported'
    | 'skipped'
    | 'duplicate'
    | 'error';
  createdOfferId: string | null;
  duplicateOfferId: string | null;
  imageUrl: string | null;
  storagePath: string | null;
  updatedPayload: unknown;
  issues: OfferSyncIssue[];
};

export type OfferSyncProgressStage =
  | 'started'
  | 'row_skipped'
  | 'image_uploading'
  | 'image_uploaded'
  | 'offer_inserting'
  | 'offer_inserted'
  | 'row_failed'
  | 'batch_updating'
  | 'completed'
  | 'partially_completed'
  | 'failed';

export type OfferSyncProgressEvent = {
  stage: OfferSyncProgressStage;
  message: string;
  rowId?: string;
  current?: number;
  total?: number;
  details?: Record<string, unknown>;
};

export type OfferSyncResult = {
  ok: boolean;
  status: 'imported' | 'partially_imported' | 'failed';
  totalRows: number;
  importedRows: number;
  needsReviewImportedRows: number;
  skippedRows: number;
  duplicateRows: number;
  errorRows: number;
  imageUploadedRows: number;
  imageFailedRows: number;
  results: OfferSyncRowResult[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error?: {
    code: string;
    message: string;
  };
};
```

Adjust based on existing prepared offer types if needed.

Do not include secrets.

## 7. Storage Path Builder

Create:

```text
src/main/storage/storagePathBuilder.ts
```

Implement:

```ts
export function buildOfferImageStoragePath(input: {
  supermarketSlug?: string | null;
  offerStartDate: string;
  importBatchId?: string | null;
  pageNumber: number;
  rowNumber?: number | null;
  rowId: string;
  extension: 'jpg' | 'png' | 'webp';
}): string;
```

Recommended path format:

```text
offers/{supermarket_slug}/{offer_start_date}/{import_batch_id}/page-{page_number}/item-{row_number-or-row-id}.{ext}
```

Example:

```text
offers/othaim/2025-05-27/batch-123/page-1/item-3.jpg
```

Rules:

* Sanitize all path parts.
* Use `unknown-supermarket` if slug is missing.
* Use `no-batch` if import batch ID is missing.
* Use stable deterministic paths so retries do not create random duplicates.
* Do not include local absolute paths.
* Do not include secrets.

## 8. Offer Image Storage Service

Create:

```text
src/main/storage/offerImageStorageService.ts
```

Implement:

```ts
export async function uploadOfferImage(input: {
  localImagePath: string;
  storageBucket: string;
  storagePath: string;
  contentType: string;
}): Promise<{
  imageUrl: string;
  storagePath: string;
}>;
```

Responsibilities:

1. Validate local image path exists.
2. Validate extension/content type.
3. Read file from local disk in main process.
4. Upload to Supabase Storage bucket.
5. Use deterministic storage path.
6. Upsert/overwrite only if intentional.
7. Return public URL or storage URL based on existing Wifran strategy.

MVP recommendation:

* Use public URL if the bucket is public and Wifran frontend expects public image URLs.
* If bucket is private, return the storage path or signed URL strategy used by Wifran.
* Do not assume private signed URLs are permanent.

If the app cannot determine whether the bucket is public, document the assumption in README and code comments.

## 9. Image Upload Rules

For each row:

* If local cropped image exists, upload it before inserting the offer.
* If image upload succeeds, set `offers.image_url`.
* If image upload fails and `requireImageForDraft = false`, insert the offer as `needs_review` with `image_url = null`.
* If image upload fails and `requireImageForDraft = true`, do not insert the offer and mark row error.
* If no local image exists, follow the same rule as upload failure.
* Do not upload images for duplicate/skipped/promotional/error rows.

Error codes:

```text
IMAGE_UPLOAD_FAILED
STORAGE_UPLOAD_FAILED
OFFER_IMAGE_MISSING
```

## 10. Offer Sync Mapper

Create:

```text
src/main/db/offerSyncMapper.ts
```

Implement:

```ts
export function mapPreparedPayloadToOffersInsert(input: {
  preparedPayload: unknown;
  imageUrl: string | null;
  sourceId: string | null;
}): {
  payload: Record<string, unknown> | null;
  issues: OfferSyncIssue[];
};
```

Responsibilities:

* Validate required fields for `offers`.
* Attach uploaded `image_url`.
* Attach `source_id` if available.
* Ensure status is only `draft` or `needs_review`.
* Ensure `offer_price > 0`.
* Ensure `city_id OR region_id`.
* Ensure `title_ar OR title_en`.
* Ensure `offer_end_date >= offer_start_date`.
* Remove fields not present in the actual `offers` table.
* Use actual schema field names from SQL files/project knowledge.

Do not use `published`.

Do not include unknown fields that would break insert.

## 11. Final Offer Insert Rules

Insert into `offers` only when minimum requirements are valid:

```text
supermarket_id
city_id OR region_id
title_ar OR title_en
offer_price > 0
offer_end_date
source_page_number
row is not duplicate
row is not skipped
row is not NON_PRODUCT_PROMOTIONAL_AREA
row has prepared payload
```

Recommended:

```text
product_id
category_id
brand_id
offer_start_date
source_id
image_url
data_quality_score
```

If recommended fields are missing:

* Insert as `needs_review` if DB constraints allow.
* Add validation warning.

Never insert as `published`.

## 12. Offer Sync Service

Create:

```text
src/main/db/offerSyncService.ts
```

Implement:

```ts
export async function syncPreparedOffers(
  input: OfferSyncInput,
  onProgress?: (event: OfferSyncProgressEvent) => void
): Promise<OfferSyncResult>;
```

Responsibilities:

1. Validate input.
2. Validate Supabase config.
3. Iterate rows safely.
4. Skip duplicate rows.
5. Skip promotional/skipped/error rows.
6. Upload local cropped image when available.
7. Adjust offer status to `needs_review` when image is missing or upload fails and allowed.
8. Insert into `offers`.
9. Update `import_rows.created_offer_id`.
10. Update `import_rows.status`.
11. Update `import_rows.normalized_data` with image URL, created offer ID, and sync result.
12. Insert `validation_errors` for upload/sync issues.
13. Continue if one row fails.
14. Update `import_batches` final counts and status.
15. Return row-level and batch-level summary.

## 13. Row Handling Rules

### Prepared row

If payload is valid:

* Upload image if available.
* Insert offer.
* Update import row:

  * `status = imported`
  * `created_offer_id = new offer ID`

If inserted as `needs_review`, still use `import_rows.status = imported` because an offer was created.

### Duplicate row

Do not insert offer.

Update import row if possible:

```text
status = skipped
created_offer_id = null
normalized_data.matched.duplicate_offer_id = existing offer ID
```

Save validation info:

```text
DUPLICATE_OFFER_DETECTED
```

### Skipped promotional/banner row

Do not upload image.

Do not insert offer.

Keep/update import row as:

```text
status = skipped
```

Save validation info if not already present:

```text
NON_PRODUCT_PROMOTIONAL_AREA
```

### Error row

Do not upload image.

Do not insert offer.

Update import row as:

```text
status = error
```

### Row with missing image

If image is required:

```text
status = error
do not insert offer
```

If image is not required:

```text
insert offer as needs_review
image_url = null
```

## 14. Batch Final Status Rules

At the end, update `import_batches`:

```text
imported_rows = number of offers created
skipped_rows = duplicate + skipped rows
error_rows = rows that failed sync or were blocking errors
warning_rows = rows inserted as needs_review or with warnings
total_rows = total input rows
completed_at = now
```

Status:

```text
imported
- all importable rows created offers, no row-level errors, no skipped duplicates

partially_imported
- at least one offer created and at least one row skipped/duplicate/error/warning

failed
- no offers created
```

Only use DB-allowed statuses:

```text
uploaded
parsed
validated
imported
partially_imported
failed
cancelled
```

## 15. Validation Error Persistence

For each row issue, insert into `validation_errors` when possible.

Examples:

```json
{
  "severity": "warning",
  "field_name": "image_url",
  "error_code": "OFFER_IMAGE_MISSING",
  "message": "No cropped image was available. Offer was created as needs_review."
}
```

```json
{
  "severity": "error",
  "field_name": null,
  "error_code": "OFFER_CREATE_FAILED",
  "message": "Failed to create offer record for this row."
}
```

Required sync-related codes:

```text
IMAGE_UPLOAD_FAILED
STORAGE_UPLOAD_FAILED
OFFER_IMAGE_MISSING
OFFER_CREATE_FAILED
OFFER_SYNC_FAILED
IMPORT_ROW_UPDATE_FAILED
IMPORT_BATCH_UPDATE_FAILED
DUPLICATE_OFFER_DETECTED
NON_PRODUCT_PROMOTIONAL_AREA
```

Do not insert duplicate validation errors if easy to prevent.

## 16. Idempotency and Retry Behavior

Use deterministic image storage paths so retries do not create random duplicate files.

Before inserting an offer, rely on duplicate detection already done in Prompt Chunk 14, but also perform a final lightweight duplicate check if practical.

If a row already has `created_offer_id` in `import_rows`, do not create a second offer for the same row.

Recommended behavior:

```text
If import_row.created_offer_id already exists:
  skip creating a new offer
  mark result as skipped or imported_existing
```

Do not delete existing offers.

Do not overwrite existing offers unless explicitly instructed.

## 17. IPC Requirements

Create:

```text
src/main/ipc/offerSyncIpc.ts
```

Add narrow IPC handler:

```text
offerSync:syncPreparedOffers
```

Input:

```ts
OfferSyncInput
```

Output:

```ts
OfferSyncResult
```

Progress event channel:

```text
offerSync:progress
```

Do not expose generic DB or storage IPC.

Update:

```text
src/main/ipc/registerIpcHandlers.ts
```

to register offer sync IPC.

## 18. Preload API Requirements

Update preload to expose:

```ts
window.wifranExtractor.offerSync = {
  syncPreparedOffers: (
    input: OfferSyncInput
  ) => Promise<OfferSyncResult>,

  onProgress: (
    callback: (event: OfferSyncProgressEvent) => void
  ) => () => void
};
```

Do not expose raw `ipcRenderer`.

Do not expose Supabase client.

Do not expose service role key.

## 19. Renderer Hook

Create:

```text
src/renderer/hooks/useOfferSync.ts
```

Responsibilities:

* Start final offer sync.
* Track running state.
* Track progress events.
* Store result.
* Store error.
* Provide reset function.

Recommended return shape:

```ts
{
  running: boolean;
  progressEvents: OfferSyncProgressEvent[];
  latestProgress: OfferSyncProgressEvent | null;
  result: OfferSyncResult | null;
  error: string | null;
  syncPreparedOffers: (input: OfferSyncInput) => Promise<void>;
  reset: () => void;
}
```

## 20. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

After offer preparation has completed, add a section:

```text
Sync Offers to Wifran
```

Show:

```text
Prepared rows
Needs review rows
Duplicate rows
Skipped rows
Rows with local cropped images
Storage bucket
Default offer status
Require image for draft
```

Add button:

```text
Sync Offers to Wifran DB
```

Enable only when:

```text
offer preparation has completed
prepared rows exist
Supabase config is ready
storage bucket is configured
not currently syncing
```

When clicked:

* Build `OfferSyncInput`.
* Include `importBatchId` and `sourceId` if available.
* Include selected supermarket and supermarket slug if available.
* Include offer dates.
* Include prepared rows and local image paths.
* Call `window.wifranExtractor.offerSync.syncPreparedOffers`.
* Show progress.
* Show final summary.

Make the UI clearly state:

```text
This will create draft/needs_review offers in Wifran.
```

Do not use `published`.

## 21. Results Page Integration

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Show sync columns:

```text
Sync Status
Created Offer ID
Image URL
Storage Path
Sync Issues
```

Add summary cards:

```text
Imported offers
Needs review offers
Skipped rows
Duplicate rows
Error rows
Images uploaded
Image upload failures
Final batch status
```

## 22. Logs Page Integration

Update logs with messages such as:

```text
Starting final offer sync.
Uploading image for row page-1-item-3.
Created offer for row page-1-item-3.
Skipped duplicate row page-2-item-5.
Offer sync completed: 110 imported, 8 skipped, 2 errors.
Updated import batch final status to partially_imported.
```

Do not log secrets.

Avoid logging huge payloads by default.

## 23. Error Handling

Handle:

```text
missing Supabase config
missing storage bucket
local image file missing
storage upload failure
storage public URL failure
invalid prepared payload
missing required offer field
offer insert failure
import row update failure
validation error insert failure
batch update failure
duplicate/skipped rows
```

One row failure must not stop all rows.

Return row-level errors.

## 24. README Update

Update README with:

* Supabase Storage image upload added.
* Final offer sync added.
* Offers are created as `draft` or `needs_review`.
* Offers are never auto-published.
* Import rows are updated with created offer IDs.
* Import batch final status is updated.
* How to run final sync after offer preparation.
* Troubleshooting storage bucket and schema errors.
* Reminder that service role key remains main-process only.

## 25. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose generic DB IPC.
* Do not expose generic storage IPC.
* Do not publish offers automatically.
* Do not use `status = published`.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not modify customer user data.
* Do not create offers from promotional/banner rows.
* Do not upload images for skipped promotional/banner rows.

## 26. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 27. Acceptance Criteria

This chunk is complete when:

* Offer image storage path builder exists.
* Cropped images can be uploaded to Supabase Storage.
* Uploaded image URL/path is attached to offer payload.
* Final offers can be inserted into `offers`.
* Inserted offers use only `draft` or `needs_review`.
* No offer is automatically published.
* Duplicate/skipped/promotional/error rows do not create offers.
* Missing image behavior follows `REQUIRE_IMAGE_FOR_DRAFT`.
* Import rows are updated with `created_offer_id`.
* Import rows are updated with final status.
* Validation errors are saved for sync/upload issues.
* Import batch summary and final status are updated.
* Renderer can start sync only through safe preload API.
* Renderer never receives service role key.
* Results UI shows created offer IDs and image URLs.
* TypeScript compiles.
* App still starts.

## 28. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How image upload works.
* How final offer sync works.
* How offer statuses are assigned.
* How skipped/duplicate/promotional rows are protected.
* Which tables are written.
* How import batch status is updated.
* Any assumptions made about storage bucket/public URL behavior.
* Any issues or TODOs.

Keep the project runnable after this chunk.