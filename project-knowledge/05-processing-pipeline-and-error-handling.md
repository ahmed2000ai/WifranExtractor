# Processing Pipeline and Error Handling

## 1. Purpose of This Document

This document defines the end-to-end processing pipeline for Wifran Offers Extractor.

Antigravity must use this document when implementing:

* Import workflow orchestration.
* PDF validation.
* PDF splitting.
* Page rendering.
* OCR execution.
* OCR result validation.
* Non-product promotional area filtering.
* Item image cropping.
* Supabase storage upload.
* Database sync.
* Import batch status updates.
* Import row status updates.
* Validation error recording.
* Progress reporting.
* Retry and failure handling.

The goal is to make the extractor reliable, auditable, and safe. One failed item or page must not destroy the whole import.

## 2. Pipeline Summary

The complete import pipeline is:

```text
1. Validate app configuration
2. Validate user input
3. Create source record
4. Create import batch
5. Prepare local workspace
6. Read and validate PDF
7. Split PDF into chunks
8. Render PDF pages to images
9. Run OCR with controlled concurrency
10. Parse OCR responses
11. Validate extracted item JSON
12. Detect and filter non-product promotional/banner rows
13. Save raw import rows
14. Normalize extracted rows
15. Match or create brands
16. Match categories
17. Match or create products
18. Detect duplicate offers
19. Crop item images locally
20. Upload cropped item images
21. Create final offer records
22. Update import rows
23. Save validation errors
24. Update import batch summary
25. Show final result to operator
```

## 3. Core Design Principle

The app must preserve traceability.

For every extracted item, the app should keep:

* The original PDF file name.
* The import batch ID.
* The original page number.
* The raw OCR item JSON.
* The normalized row JSON.
* Any validation warnings/errors.
* Whether the row was skipped as a non-product promotional area.
* The cropped image path or URL if available.
* The created offer ID if synced.
* The final row status.

Do not silently discard rows.

## 4. Batch-Level Statuses

The Wifran database supports these `import_batches.status` values:

```text
uploaded
parsed
validated
imported
partially_imported
failed
cancelled
```

The app may use more detailed internal statuses in memory/UI, but when writing to DB, map them to the allowed database statuses.

Recommended mapping:

```text
UI/internal pending               -> uploaded
UI/internal reading_pdf           -> uploaded
UI/internal splitting_pdf         -> uploaded
UI/internal rendering_pages       -> uploaded
UI/internal running_ocr           -> parsed
UI/internal parsing_ocr           -> parsed
UI/internal validating_rows       -> validated
UI/internal normalizing_rows      -> validated
UI/internal uploading_images      -> validated
UI/internal syncing_offers        -> imported / partially_imported / failed
UI/internal completed             -> imported
UI/internal partially_completed   -> partially_imported
UI/internal failed                -> failed
UI/internal cancelled             -> cancelled
```

## 5. Row-Level Statuses

The Wifran database supports these `import_rows.status` values:

```text
valid
warning
error
imported
skipped
```

Recommended usage:

```text
valid
- Row has passed validation and is ready to sync.

warning
- Row has usable data but has non-blocking issues.
- Example: missing image, uncertain category, low confidence, missing original price.

error
- Row has blocking problems and cannot become an offer.
- Example: missing product name, missing offer price, invalid offer price.

imported
- Row successfully created or updated an offer.

skipped
- Row intentionally skipped.
- Example: duplicate offer, user skipped, unsupported item, non-product promotional area.
```

## 6. Pipeline Stage 1: Validate App Configuration

Before processing any PDF, validate required configuration.

Required for MVP:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
MISTRAL_API_KEY
MISTRAL_OCR_MODEL
MISTRAL_OCR_ENDPOINT
```

Optional with defaults:

```text
OCR_CHUNK_SIZE
OCR_MAX_CONCURRENT_REQUESTS
OCR_MAX_RETRIES
OCR_RETRY_BASE_DELAY_MS
OCR_REQUEST_TIMEOUT_MS
PDF_RENDER_DPI
IMAGE_CROP_PADDING_PERCENT
DEBUG_SAVE_INTERMEDIATE_FILES
```

If required configuration is missing:

* Do not start import.
* Show clear error to user.
* Do not create import batch.
* Do not call OCR.
* Do not call Supabase sync.

Example user-facing message:

```text
MISTRAL_API_KEY is missing. Add it in .env.local or the app settings before starting extraction.
```

## 7. Pipeline Stage 2: Validate User Input

Required user inputs:

```text
PDF file
supermarket_id
city_id OR region_id
offer_start_date
offer_end_date
```

Validation rules:

```text
PDF file must exist.
PDF file must have .pdf extension.
PDF file must be readable.
supermarket_id must exist in Wifran DB.
city_id or region_id must be selected.
offer_start_date must be a valid date.
offer_end_date must be a valid date.
offer_end_date must be same as or after offer_start_date.
```

Defaults:

```text
offer_start_date = today
offer_end_date = today + 7 days
```

If validation fails:

* Do not create import batch.
* Show validation message in UI.

## 8. Pipeline Stage 3: Create Offer Source

Create one `offer_sources` record for the selected PDF leaflet.

Recommended values:

```text
source_type = leaflet_pdf
supermarket_id = selected supermarket
city_id = selected city, if selected
region_id = selected region, if selected
title = generated title
valid_from = selected start date
valid_to = selected end date
file_url = null initially unless original PDF upload is implemented
notes = optional
```

Recommended title format:

```text
{supermarket_name} leaflet - {location_name} - {YYYY-MM-DD} to {YYYY-MM-DD}
```

If creating `offer_sources` fails:

* Do not continue to import.
* Show DB error.
* No batch exists yet unless batch creation happens first.

## 9. Pipeline Stage 4: Create Import Batch

Create one `import_batches` record after user starts extraction.

Recommended initial values:

```text
source_id = created offer source id
supermarket_id = selected supermarket
city_id = selected city, if selected
region_id = selected region, if selected
file_name = selected PDF file name
file_url = null initially unless original PDF upload is implemented
file_type = pdf
status = uploaded
total_rows = 0
valid_rows = 0
warning_rows = 0
error_rows = 0
imported_rows = 0
skipped_rows = 0
offer_start_date = selected start date
offer_end_date = selected end date
```

If batch creation fails:

* Stop the process.
* Show clear error.
* Do not run OCR.

## 10. Pipeline Stage 5: Prepare Local Workspace

Create a temporary local workspace for this import.

Recommended path pattern:

```text
{appData}/wifran-offers-extractor/imports/{import_batch_id}/
```

Subfolders:

```text
source/
chunks/
pages/
crops/
ocr/
logs/
```

Example:

```text
imports/{batch_id}/source/original.pdf
imports/{batch_id}/chunks/chunk-001-pages-001-002.pdf
imports/{batch_id}/pages/page-001.png
imports/{batch_id}/crops/page-001-item-001.jpg
imports/{batch_id}/ocr/chunk-001-response.json
imports/{batch_id}/logs/import.log
```

Rules:

* Do not store secrets in workspace files.
* Save intermediate files only when needed.
* If debug mode is disabled, clean temporary files after successful import.
* If import fails, keep enough files for debugging or allow user to export logs.

## 11. Pipeline Stage 6: Read and Validate PDF

The app should read the selected PDF locally.

Validation:

```text
Can open PDF.
Page count > 0.
Page count is reasonable.
File size is within configured limits.
PDF is not encrypted/password-protected, unless support is added.
```

Recommended file-size/page-count behavior:

```text
If PDF > configured size limit, warn user.
If PDF > 100 pages, allow but warn.
If PDF cannot be read, fail batch.
```

Error code:

```text
PDF_READ_ERROR
```

If the import batch already exists:

* Set batch status to `failed`.
* Save validation error with `PDF_READ_ERROR`.

## 12. Pipeline Stage 7: Split PDF into Chunks

Split PDF locally into chunks.

Default:

```text
OCR_CHUNK_SIZE = 2 pages
```

Allowed:

```text
1 to 3 pages
```

For each chunk, create metadata:

```ts
type PdfChunk = {
  chunkId: string;
  chunkPdfPath: string;
  originalPageNumbers: number[];
  firstOriginalPageNumber: number;
  lastOriginalPageNumber: number;
};
```

Example:

```json
{
  "chunkId": "chunk-001",
  "chunkPdfPath": "chunks/chunk-001-pages-001-002.pdf",
  "originalPageNumbers": [1, 2],
  "firstOriginalPageNumber": 1,
  "lastOriginalPageNumber": 2
}
```

Failure behavior:

* If the entire split fails, fail batch with `PDF_SPLIT_ERROR`.
* If one chunk fails, fail that chunk and continue only if other chunks are valid.

## 13. Pipeline Stage 8: Render PDF Pages to Images

Render every original PDF page into a high-resolution image locally.

Default render DPI:

```text
PDF_RENDER_DPI = 200 or 300
```

MVP recommendation:

```text
PDF_RENDER_DPI = 200
```

Render output:

```text
pages/page-001.png
pages/page-002.png
```

For every rendered page, store metadata:

```ts
type RenderedPage = {
  pageNumber: number;
  imagePath: string;
  width: number;
  height: number;
  dpi: number;
};
```

This metadata is required for:

* Bounding box validation.
* Coordinate conversion.
* Cropping.
* Debugging.

Failure behavior:

* If a page cannot be rendered, record `PAGE_RENDER_ERROR`.
* Continue if possible.
* OCR can still run on PDF chunks, but item image cropping will fail for that page.
* Rows from pages without rendered images should be marked warning or error depending on whether image is required.

## 14. Pipeline Stage 9: Run OCR With Controlled Concurrency

Run OCR on chunks using the Mistral provider.

Rules:

```text
Do not call OCR for the whole PDF at once by default.
Do not use unlimited Promise.all.
Use controlled concurrency.
Default max concurrent OCR requests = 3.
Retry transient errors.
Preserve chunk-level failures.
Tell OCR to ignore non-product promotional areas.
```

Retryable errors:

```text
HTTP 408
HTTP 409
HTTP 425
HTTP 429
HTTP 500
HTTP 502
HTTP 503
HTTP 504
network timeout
connection reset
```

Non-retryable errors:

```text
HTTP 400
HTTP 401
HTTP 403
invalid request schema
invalid API key
unsupported file format
```

If some chunks fail after retries:

* Continue processing successful chunks.
* Mark batch as partially failed or partially completed.
* Show failed chunks in UI.
* Allow future retry if implemented.

Error codes:

```text
OCR_API_ERROR
OCR_RATE_LIMIT
OCR_TIMEOUT
OCR_EMPTY_RESPONSE
```

## 15. Pipeline Stage 10: Parse OCR Responses

For every OCR response:

1. Save raw OCR response to local debug file if configured.
2. Extract `document_annotation`.
3. Parse `document_annotation` as JSON.
4. Normalize to `{ items: [] }`.
5. Attach chunk metadata if needed.
6. Validate with local schema.

If JSON parsing fails:

* Retry OCR request once with stricter prompt if retry budget remains.
* If still invalid, mark chunk failed.
* Record `OCR_JSON_PARSE_ERROR`.
* Do not fabricate rows.

## 16. Pipeline Stage 11: Validate Extracted Item JSON

Validate each item using Zod or equivalent.

Validate:

```text
row_id exists or can be generated
page_number is valid and 1-indexed
product_name_ar OR product_name_en exists
offer_price exists and > 0
original_price is null OR original_price >= offer_price
pack_quantity is null or > 0
confidence is null or between 0 and 1
warnings is array
bounding_box is valid if present
row is not a non-product promotional area
```

Rows can become:

```text
valid
warning
error
skipped
```

Blocking errors:

```text
MISSING_PRODUCT_NAME
MISSING_OFFER_PRICE
INVALID_OFFER_PRICE
INVALID_PAGE_NUMBER
INVALID_JSON
```

Non-blocking warnings:

```text
MISSING_ORIGINAL_PRICE
MISSING_PACK_SIZE
MISSING_BOUNDING_BOX
LOW_CONFIDENCE_EXTRACTION
CATEGORY_INFERRED
PACK_DATA_AMBIGUOUS
POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA
```

Skipped/error rows:

```text
NON_PRODUCT_PROMOTIONAL_AREA
```

## 17. Pipeline Stage 12: Detect and Filter Non-Product Promotional Rows

This stage is required.

Some OCR results may incorrectly extract page banners, cover graphics, supermarket logos, sponsor logos, date badges, or generic campaign text as offer rows.

The app must detect and prevent these from becoming Wifran offers.

A row should be classified as non-product promotional content when most of these are true:

```text
Product name is a campaign slogan rather than a product.
Text includes generic phrases such as عروض, توفير, عيد, festival, savings, offers.
No real product name exists.
No valid offer price exists.
No product package/image is represented.
Bounding box covers a page header, footer, cover, or large banner.
Row contains only a date range.
Row contains only supermarket or sponsor branding.
Row contains only generic 1+1 text without a product.
```

Examples to ignore:

```text
1+1 عروض تزين عيدك
عروض تزين عيدك
هنا التوفير
May 27 - June 02
Supermarket logo
Sponsored by Lurpak
Decorative balloons
Cover page celebration graphics
```

Handling:

```text
If row is clearly non-product promotional:
  status = skipped
  error_code = NON_PRODUCT_PROMOTIONAL_AREA
  do not create product
  do not create brand
  do not create category
  do not crop item image
  do not upload image
  do not create offer
```

The row may still be saved to `import_rows` for audit/debugging.

## 18. Pipeline Stage 13: Save Raw Import Rows

Create one `import_rows` record for every extracted item, including skipped promotional rows if useful for traceability.

Fields:

```text
import_batch_id
row_number
raw_data
normalized_data
status
created_offer_id = null
```

Initial status mapping:

```text
valid item with no warnings              -> valid
valid item with warnings                 -> warning
blocking invalid item                    -> error
non-product promotional/banner item      -> skipped
```

Rules:

* Preserve the full OCR item in `raw_data`.
* Do not lose rows with errors.
* Save validation errors separately in `validation_errors`.
* Do not save obvious promotional/banner rows if settings disable debug/audit storage for skipped rows.

## 19. Pipeline Stage 14: Normalize Extracted Rows

For every non-skipped row:

* Convert Arabic numerals to Western digits.
* Normalize price values.
* Normalize units.
* Normalize pack quantity.
* Normalize booleans.
* Normalize empty strings to null.
* Calculate discount amount if possible.
* Calculate discount percentage if possible.
* Calculate unit price if possible and safe.
* Normalize bounding boxes.
* Re-check non-product promotional row detection.
* Add warnings/errors.

The output should be stored in `import_rows.normalized_data`.

## 20. Pipeline Stage 15: Match or Create Brand

For every importable row:

1. If brand names are missing, keep `brand_id = null`.
2. Try exact brand match.
3. Try slug match.
4. Try normalized name match.
5. Try fuzzy match only if implemented safely.
6. If confident match exists, reuse brand.
7. If no match and brand name exists, create brand.
8. If uncertain, continue with warning.

Important:

* Do not create brands for skipped promotional/banner rows.
* Do not treat a sponsor logo or supermarket logo as the brand for an item unless it is clearly part of the product offer.

Error/warning codes:

```text
BRAND_MATCH_UNCERTAIN
BRAND_CREATE_FAILED
```

Brand failure should usually not block offer creation unless the database requires it.

## 21. Pipeline Stage 16: Match Category

For every importable row:

1. If category missing, keep `category_id = null` and add warning.
2. Try exact category match.
3. Try slug match.
4. Try normalized name match.
5. If confident match exists, reuse category.
6. If no confident match, keep null and add warning.

MVP rule:

```text
Do not create categories automatically by default.
```

Important:

* Do not create categories from campaign banners or page titles.

Warning code:

```text
CATEGORY_MATCH_UNCERTAIN
```

## 22. Pipeline Stage 17: Match or Create Product

For every importable row:

1. Try matching by product aliases.
2. Try exact product name match.
3. Try slug match.
4. Try brand + product name match.
5. If confident match exists, reuse product.
6. If no confident match and product name exists, create new product.
7. Set `is_normalized = false` for OCR-created products.
8. Add raw extracted name as alias.

Important:

* Do not create products for non-product promotional/banner rows.
* Do not create a product named after a campaign slogan.

Blocking error:

```text
PRODUCT_CREATE_FAILED
```

Warning:

```text
PRODUCT_MATCH_UNCERTAIN
```

If product cannot be created, do not create offer.

## 23. Pipeline Stage 18: Detect Duplicate Offers

Before creating an offer, check for duplicates.

Default duplicate criteria:

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

If duplicate found:

* Mark import row as `skipped`.
* Do not create new offer by default.
* Save validation info with `DUPLICATE_OFFER_DETECTED`.
* Continue with other rows.

MVP default:

```text
skip duplicates and report them
```

## 24. Pipeline Stage 19: Crop Item Images Locally

For rows with valid bounding boxes:

1. Confirm row is not skipped.
2. Confirm row is not a non-product promotional area.
3. Find rendered page image by `page_number`.
4. Validate bounding box against page dimensions.
5. Apply crop padding.
6. Clamp crop area to page boundaries.
7. Crop image locally.
8. Save cropped file to workspace.

Recommended crop format:

```text
jpg
```

Recommended crop quality:

```text
80 to 90
```

Recommended local path:

```text
crops/page-{page_number}-item-{row_number}.jpg
```

If crop fails:

* Add `IMAGE_CROP_FAILED`.
* Mark row warning or error depending on image requirement.
* Continue with other rows.

MVP recommendation:

```text
Missing image = warning
Offer can still be created as needs_review if core data is valid
```

Do not crop page banners or cover graphics as offer images.

## 25. Pipeline Stage 20: Upload Cropped Images

Upload cropped image to Supabase Storage.

Recommended storage path:

```text
offers/{supermarket_slug}/{offer_start_date}/{import_batch_id}/page-{page_number}/item-{row_number}.jpg
```

After upload:

* Get public URL or storage URL based on Wifran strategy.
* Save to normalized data.
* Use as `offers.image_url`.

If upload fails:

* Add `IMAGE_UPLOAD_FAILED` or `STORAGE_UPLOAD_FAILED`.
* Mark row warning or error.
* Continue.

Do not retry forever.

Do not upload images for skipped promotional/banner rows.

## 26. Pipeline Stage 21: Create Final Offer Records

Create offer records for rows that pass minimum requirements.

Minimum requirements:

```text
supermarket_id
city_id OR region_id
title_ar OR title_en
offer_price > 0
offer_end_date
row is not NON_PRODUCT_PROMOTIONAL_AREA
```

Recommended values:

```text
product_id
supermarket_id
city_id
region_id
category_id
brand_id
title_ar
title_en
offer_price
original_price
discount_amount
discount_percentage
pack_size_value
pack_size_unit
pack_quantity
unit_price
unit_price_unit
offer_start_date
offer_end_date
status
image_url
source_id
source_page_number
source_reference
data_quality_score
is_loyalty_required
loyalty_notes_ar
loyalty_notes_en
quantity_limit
notes_ar
notes_en
```

Default offer status:

```text
draft
```

Use `needs_review` when:

```text
data_quality_score < threshold
row has warnings
image missing
bounding box missing
low confidence
category/product/brand uncertain
```

MVP rule:

```text
Do not automatically publish offers.
```

## 27. Pipeline Stage 22: Update Import Rows

After offer creation:

```text
import_rows.status = imported
import_rows.created_offer_id = created offer id
import_rows.normalized_data = final normalized data including IDs and image URL
```

For skipped duplicate:

```text
import_rows.status = skipped
normalized_data.matched.duplicate_offer_id = existing offer id
```

For skipped non-product promotional area:

```text
import_rows.status = skipped
normalized_data.skip_reason = NON_PRODUCT_PROMOTIONAL_AREA
created_offer_id = null
```

For failed row:

```text
import_rows.status = error
```

For warning row not imported:

```text
import_rows.status = warning
```

## 28. Pipeline Stage 23: Save Validation Errors

For every warning/error/skipped reason, create `validation_errors`.

Fields:

```text
import_batch_id
import_row_id
offer_id
severity
field_name
error_code
message
```

Severity:

```text
error
warning
info
```

Rules:

* Blocking validation failures use `error`.
* Non-blocking quality issues use `warning`.
* Duplicate/skipped notes can use `info`.
* `NON_PRODUCT_PROMOTIONAL_AREA` can use `info` or `warning` depending on whether it was confidently detected.
* Messages should be user-readable.
* Do not include secrets.

## 29. Pipeline Stage 24: Update Import Batch Summary

At the end, update counts:

```text
total_rows
valid_rows
warning_rows
error_rows
imported_rows
skipped_rows
completed_at
status
```

Status logic:

```text
If imported_rows > 0 and error_rows = 0 and skipped_rows = 0:
  status = imported

If imported_rows > 0 and there are errors/skipped rows:
  status = partially_imported

If imported_rows = 0 and total_rows > 0:
  status = failed

If OCR found zero product offer rows because the PDF/page was only cover/banner pages:
  status = failed or parsed with warning, depending on implementation

If OCR found zero rows from a page that is clearly a cover/banner-only page:
  do not treat that page alone as fatal
```

Show final summary to operator.

## 30. Pipeline Stage 25: Final Results UI

The final UI should show:

```text
Batch ID
Source file
Supermarket
Location
Offer dates
Total rows
Imported rows
Warning rows
Error rows
Skipped rows
Skipped promotional/banner rows
Failed chunks
Processing duration
```

The results table should show:

```text
Row number
Page number
Product name
Offer price
Status
Image preview if available
Warnings/errors summary
Created offer ID if imported
Skip reason if skipped
```

## 31. Cancellation Behavior

The app should support cancellation if practical.

If user cancels before OCR starts:

* Mark batch `cancelled`.
* Clean workspace if safe.

If user cancels during OCR:

* Stop queueing new OCR requests.
* Let in-flight requests finish or abort if supported.
* Mark batch `cancelled` or `partially_imported` depending on completed work.

If user cancels during DB sync:

* Finish current row safely if possible.
* Stop subsequent rows.
* Mark batch `partially_imported` or `cancelled`.

Never leave the UI pretending the batch completed if it was cancelled.

## 32. Progress Events

The main process should emit progress events to renderer.

Recommended event shape:

```ts
type ImportProgressEvent = {
  batchId: string;
  stage:
    | 'config_validation'
    | 'input_validation'
    | 'source_created'
    | 'batch_created'
    | 'pdf_reading'
    | 'pdf_splitting'
    | 'page_rendering'
    | 'ocr_running'
    | 'ocr_parsing'
    | 'row_validation'
    | 'promotional_filtering'
    | 'image_cropping'
    | 'image_uploading'
    | 'db_sync'
    | 'completed'
    | 'failed'
    | 'cancelled';
  message: string;
  current?: number;
  total?: number;
  details?: unknown;
};
```

Do not include secrets in `details`.

## 33. Error Code Catalog

Use these error codes consistently.

### PDF Errors

```text
PDF_READ_ERROR
PDF_SPLIT_ERROR
PDF_PASSWORD_PROTECTED
PDF_PAGE_COUNT_ZERO
PDF_TOO_LARGE
PAGE_RENDER_ERROR
```

### OCR Errors

```text
OCR_API_ERROR
OCR_RATE_LIMIT
OCR_TIMEOUT
OCR_EMPTY_RESPONSE
OCR_JSON_PARSE_ERROR
OCR_SCHEMA_VALIDATION_ERROR
OCR_ITEM_PARSE_FAILED
OCR_CHUNK_FAILED
```

### Extraction Data Errors

```text
MISSING_PRODUCT_NAME
MISSING_OFFER_PRICE
INVALID_OFFER_PRICE
INVALID_ORIGINAL_PRICE
ORIGINAL_PRICE_LESS_THAN_OFFER_PRICE
INVALID_PAGE_NUMBER
INVALID_PACK_SIZE
INVALID_PACK_QUANTITY
UNKNOWN_UNIT
LOW_CONFIDENCE_EXTRACTION
PRICE_SUSPICIOUS
PACK_DATA_AMBIGUOUS
NON_PRODUCT_PROMOTIONAL_AREA
POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA
```

### Bounding Box and Image Errors

```text
MISSING_BOUNDING_BOX
INVALID_BOUNDING_BOX
BOUNDING_BOX_TOO_SMALL
BOUNDING_BOX_TOO_LARGE
BOUNDING_BOX_OUT_OF_PAGE
BOUNDING_BOX_CLAMPED
IMAGE_CROP_FAILED
IMAGE_UPLOAD_FAILED
STORAGE_UPLOAD_FAILED
```

### Matching and Sync Errors

```text
BRAND_MATCH_UNCERTAIN
BRAND_CREATE_FAILED
CATEGORY_MATCH_UNCERTAIN
PRODUCT_MATCH_UNCERTAIN
PRODUCT_CREATE_FAILED
DUPLICATE_OFFER_DETECTED
OFFER_CREATE_FAILED
OFFER_UPDATE_FAILED
IMPORT_ROW_CREATE_FAILED
IMPORT_BATCH_UPDATE_FAILED
VALIDATION_ERROR_INSERT_FAILED
DB_INSERT_FAILED
DB_UPDATE_FAILED
```

### Config and Security Errors

```text
MISSING_SUPABASE_URL
MISSING_SUPABASE_SERVICE_ROLE_KEY
MISSING_SUPABASE_STORAGE_BUCKET
MISSING_MISTRAL_API_KEY
INVALID_ENV_CONFIG
SECRET_EXPOSED_TO_RENDERER
```

## 34. Fatal vs Non-Fatal Errors

### Fatal Errors

Stop the entire import:

```text
Missing required configuration
Invalid Supabase credentials
Invalid Mistral API key
Cannot create import batch
Cannot read PDF at all
PDF has zero pages
All OCR chunks fail
Database unavailable for final sync
```

### Non-Fatal Errors

Continue processing other rows/chunks:

```text
One OCR chunk fails
One row has missing price
One row has invalid bounding box
One image crop fails
One image upload fails
One product cannot be matched
One duplicate offer is found
One row is skipped as non-product promotional area
One offer insert fails
One page is cover/banner-only
```

## 35. Retry Policy Summary

Retry:

```text
Temporary OCR/network errors
Storage upload network errors
Transient Supabase network errors
```

Do not retry automatically:

```text
Invalid API key
Invalid request schema
Missing required field
Invalid price
Invalid date range
Duplicate offer
Product name missing
Non-product promotional area
```

Use limited retries only.

Default:

```text
max retries = 3
```

## 36. Local Logging

The app should maintain a local log per import.

Recommended file:

```text
imports/{batch_id}/logs/import.log
```

Log:

```text
timestamps
batch id
stage transitions
selected file name
page count
chunk count
OCR attempt summaries
number of extracted rows
number of skipped promotional/banner rows
validation summary
crop summary
upload summary
DB sync summary
final status
```

Do not log:

```text
MISTRAL_API_KEY
SUPABASE_SERVICE_ROLE_KEY
Authorization headers
signed URLs
large base64 payloads
```

## 37. Debug Files

If debug mode is enabled, save:

```text
PDF chunks
rendered page images
raw OCR responses
parsed OCR JSON
normalized rows JSON
cropped item images
promotional/banner skipped rows JSON
```

If debug mode is disabled:

* Keep only required temporary files while processing.
* Clean up after successful import.
* Keep logs and error summaries.

## 38. Idempotency Rules

The app should avoid duplicate writes if a step is retried.

Recommendations:

* Use import batch ID in storage paths.
* Check duplicate offers before insert.
* Store row numbers and row IDs.
* Do not create multiple import rows for the same OCR item if retrying the same stage.
* If retrying DB sync, reuse existing `import_rows`.
* If an image was already uploaded, reuse or overwrite same storage path intentionally.
* Do not retry non-product promotional/banner rows as product offers.

## 39. Data Safety Rules

Antigravity must not:

* Delete existing Wifran offers.
* Delete existing products.
* Delete existing brands.
* Delete existing categories.
* Publish offers automatically.
* Modify customer user data.
* Modify saved offers, watched items, or shopping lists.
* Run destructive migrations.
* Drop tables.
* Truncate tables.
* Store secrets in logs.
* Expose service role key in renderer.
* Create offers from campaign banners, cover pages, date badges, or slogans.

## 40. Minimum MVP Error Handling

For MVP, Antigravity must implement at least:

```text
configuration validation
input validation
PDF read errors
OCR request errors
OCR JSON parse errors
row validation errors
non-product promotional area filtering
bounding box validation
image crop errors
image upload errors
database insert errors
batch status updates
final summary
```

Do not postpone all error handling to future work.

## 41. Testing Scenarios

Antigravity should test the pipeline with these scenarios:

```text
Missing Mistral API key
Missing Supabase service role key
Invalid PDF path
Non-PDF file selected
PDF with one page
PDF with many pages
PDF page that is only a cover/banner
OCR returns empty items
OCR returns invalid JSON
OCR returns row missing price
OCR returns row missing product name
OCR returns invalid bounding box
OCR returns fake row from campaign slogan
OCR returns fake row from generic 1+1 banner
Image crop fails
Storage upload fails
Duplicate offer found
One row fails while others succeed
All rows fail
Import completes successfully
```

## 42. Final Principle

The extractor is an ETL application.

ETL means:

```text
Extract
Transform
Load
```

For Wifran, that means:

```text
Extract product offer data from supermarket leaflet PDFs.
Transform messy OCR data into validated Wifran offer records.
Filter out non-product promotional/banner content.
Load safe, traceable, auditable offers into Supabase.
```

The app must never prioritize speed over correctness and traceability.