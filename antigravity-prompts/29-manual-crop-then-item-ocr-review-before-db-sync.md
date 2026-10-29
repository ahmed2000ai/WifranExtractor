# Antigravity Prompt Chunk 29: Manual Crop, Item OCR, Review Summary, Then DB Sync

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 29. Prompt Chunk 28 should already have added the Manual Grid Crop Layout Editor.

This chunk changes the operator workflow so the app does not update Wifran DB immediately after OCR/cropping. Instead, the app must:

```text
1. Open the manual grid crop editor first.
2. Let the operator finish crop boxes for all leaflet pages.
3. Let the operator click Proceed.
4. Generate local item crop images.
5. OCR each generated item image.
6. Show a complete review summary with local file paths.
7. Only update the DB after the operator clicks Proceed to Update DB.
```

The highest priorities are:

```text
operator review before DB updates
no DB writes before review approval
accurate item crops
clean item-level OCR JSON
visible local file paths for review
rate-limit-safe Mistral OCR calls
```

## 1. Read These Files First

Before coding, read:

```text
src/shared/types/manualCrop.ts
src/shared/utils/manualCropGeometry.ts
src/shared/utils/manualCropOrdering.ts
src/main/image/manualCropService.ts
src/main/ipc/manualCropIpc.ts
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/hooks/useManualCropLayout.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/ocrRateLimitQueue.ts
src/main/ocr/minimalOcrPromptBuilder.ts
src/shared/schemas/minimalOcrSchema.ts
src/main/db/offerSyncService.ts
src/main/db/offerSyncMapper.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Also read:

```text
project-knowledge/wifran_docs/external-offer-ingestion-tool.md
project-knowledge/wifran_docs/offer-images-bucket.md
project-knowledge/wifran_docs/production-env-verification.md
```

Use existing project naming and structure where possible.

## 2. Goal of This Chunk

Implement a new pre-DB review workflow:

```text
Manual Crop Layouts Completed
→ Generate Local Item Crops
→ OCR Each Item Crop
→ Build Review Summary
→ Operator Reviews Local Files and Extracted Data
→ Operator Clicks Proceed to Update DB
→ DB Sync Runs
```

This chunk must ensure:

```text
no DB writes happen during crop generation
no DB writes happen during item OCR
no DB writes happen before the review summary is shown
operator explicitly starts DB update after reviewing the summary
```

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/reviewWorkflow.ts
src/shared/types/itemOcr.ts
src/shared/schemas/itemOcrSchema.ts
src/main/ocr/itemImageOcrPromptBuilder.ts
src/main/ocr/itemImageOcrService.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/ipc/reviewWorkflowIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useCropAndItemOcrWorkflow.ts
src/renderer/components/review/PreDbReviewSummary.tsx
src/renderer/components/review/ReviewItemTable.tsx
src/renderer/components/review/ReviewItemDetailsPanel.tsx
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
README.md
```

Adapt paths if the current project structure differs.

## 4. Updated Operator Workflow

Update Import page workflow to this order:

```text
1. Select PDF.
2. Select supermarket and trusted coverage context.
3. Set default manual crop grid rows/columns.
4. Preprocess/render PDF pages.
5. Open Manual Grid Crop Editor.
6. Finish crop layouts for all pages.
7. Click Proceed to Crop + OCR.
8. App generates local item images and OCRs them.
9. App shows Pre-DB Review Summary.
10. Operator reviews extracted items, local image paths, errors, and counts.
11. Operator clicks Proceed to Update DB.
12. App uploads images and writes offers to Wifran DB.
```

Do not allow DB sync before step 11.

## 5. Manual Crop Editor Completion Gate

The Manual Crop Editor should provide a clear completion action:

```text
Mark Page Complete
```

and a final action:

```text
Proceed to Crop + OCR
```

Before enabling `Proceed to Crop + OCR`, validate:

```text
at least one page layout exists
every rendered page has a saved manual crop layout
every page has at least one included crop box
all included crop boxes are within page bounds
all included crop boxes are large enough to crop
item numbers are present and unique per page
```

If not complete, show:

```text
Page 12 has no saved crop layout.
Page 34 has no included boxes.
Page 36 has duplicate item numbers.
```

## 6. Producer/Consumer Crop + OCR Workflow

Create:

```text
src/main/workflow/cropAndItemOcrWorkflow.ts
```

Implement:

```ts
export async function runCropAndItemOcrWorkflow(
  input: CropAndItemOcrWorkflowInput,
  onProgress?: (event: CropAndItemOcrProgressEvent) => void
): Promise<CropAndItemOcrWorkflowResult>;
```

The workflow should act like this:

```text
1. Validate all manual page layouts.
2. Start local crop generation.
3. As each crop image is created, enqueue it for OCR.
4. Continue cropping the next items/pages while OCR queue works.
5. OCR queue processes one item image at a time.
6. Wait at least OCR_ITEM_MIN_REQUEST_INTERVAL_MS between OCR calls.
7. Respect Retry-After if Mistral returns 429.
8. Continue if one item OCR fails.
9. When crop generation and all OCR tasks finish, write a local review package.
10. Return a review result to the renderer.
```

Important:

```text
OCR cannot process an item image before that crop image exists.
So implement a producer/consumer queue: cropper produces image jobs, OCR consumes image jobs.
```

Do not run concurrent Mistral calls.

## 7. Environment Defaults

Update `.env.example` and config defaults:

```env
MISTRAL_OCR_MODEL=mistral-ocr-2512

OCR_ITEM_MIN_REQUEST_INTERVAL_MS=1100
OCR_ITEM_MAX_CONCURRENT_REQUESTS=1
OCR_ITEM_MAX_RETRIES=5
OCR_ITEM_REQUEST_TIMEOUT_MS=120000
OCR_ITEM_RATE_LIMIT_MODE=free_tier_safe

ITEM_OCR_OUTPUT_SCHEMA=minimal_item
ITEM_OCR_SAVE_RAW_RESPONSE=false
```

Rules:

```text
OCR_ITEM_MAX_CONCURRENT_REQUESTS must always be 1 in free_tier_safe mode.
OCR_ITEM_MIN_REQUEST_INTERVAL_MS must be at least 1000.
Default to 1100ms to stay slightly above 1 request per second.
If token budget throttling from OCR_RATE_LIMIT_QUEUE exists, reuse it.
If rate limits still happen, respect Retry-After and continue.
```

Note:

```text
The operator requested 1 second delay between OCR calls.
Use 1100ms as the practical default to stay safely above a strict 1 request/second limit.
```

## 8. Item OCR JSON Schema

Create:

```text
src/shared/types/itemOcr.ts
src/shared/schemas/itemOcrSchema.ts
```

Each item image OCR response must use this strict schema:

```json
{
  "item_number": "001",
  "name_ar": "string or null",
  "name_en": "string or null",
  "description_ar": "string or null",
  "description_en": "string or null",
  "offer_price": 0,
  "original_price": 0,
  "size": {
    "value": 0,
    "unit": "string or null",
    "text": "string or null"
  },
  "pack_quantity": 1,
  "bundle_quantity": null,
  "special_offer": "string or null"
}
```

Rules:

```text
No page_number inside item OCR JSON because page number comes from the crop job metadata.
No bounding boxes.
No coordinates.
No brand fields.
No category fields.
No confidence.
No warnings.
No errors.
No source object.
No DB metadata.
No image metadata inside OCR JSON.
No extra keys.
```

Use `null` for unknown values.

Do not invent missing values.

## 9. Item OCR Metadata Stored Outside OCR JSON

The app should store metadata outside the strict OCR JSON.

For each review item, store:

```ts
{
  pageNumber: number;
  itemNumber: string;
  localImagePath: string;
  cropBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  ocr: ItemOcrJson | null;
  ocrStatus: 'pending' | 'running' | 'completed' | 'failed';
  ocrError?: {
    code: string;
    message: string;
  } | null;
}
```

This keeps the Mistral JSON clean while still allowing the review summary to show page number, file path, and crop details.

## 10. Item Image OCR Prompt

Create:

```text
src/main/ocr/itemImageOcrPromptBuilder.ts
```

The prompt must tell Mistral:

```text
You are reading one cropped supermarket offer item image.

Return only valid JSON matching the exact schema.

Do not include markdown.
Do not include prose.
Do not include comments.
Do not include any extra keys.

Extract only:
- item_number
- Arabic name
- English name
- Arabic description if visible
- English description if visible
- current offer price
- original/old price if visible
- size value/unit/raw text
- pack_quantity
- bundle_quantity
- special_offer

Do not return:
- page number
- bounding boxes
- coordinates
- brand/category
- confidence
- warnings
- source metadata
- image metadata

The item_number is provided by the app. Use it exactly.

Many Saudi leaflet prices are stylized:
24 99 means 24.99.
13 99 means 13.99.
٢٤ ٩٩ means 24.99.

Extract multi-piece and bundle information:
8x135g means pack_quantity=8, size.value=135, size.unit="g", size.text="8x135g".
30PCS means pack_quantity=30 and size.text="30PCS".
1+1 means bundle_quantity=2 and special_offer="1+1".
1+2 means bundle_quantity=3 and special_offer="1+2".
2+1 means bundle_quantity=3 and special_offer="2+1".
6+1 means bundle_quantity=7 and special_offer="6+1".

If a condition such as Per Pack, Per Box, Per Bag, Per Kg, Selected Branches Only, or Loyalty Required is visible, put it in special_offer.

Use null for unknown values.
Do not invent missing values.
```

## 11. Crop Output Local Paths

For each generated item crop, write local files inside the import workspace.

Recommended structure:

```text
workspace/
  manual-crops/
    page-001/
      page-001-item-001.webp
      page-001-item-002.webp
    page-002/
      page-002-item-001.webp
```

The review summary must include these local paths.

Do not upload to Supabase during this workflow.

## 12. Local Review Package

After both crop and OCR finish, write a local review package:

```text
workspace/
  review/
    pre-db-review-summary.json
    pre-db-review-items.json
```

`pre-db-review-summary.json` schema:

```json
{
  "total_pages": 0,
  "total_crops": 0,
  "total_ocr_completed": 0,
  "total_ocr_failed": 0,
  "pages": [
    {
      "page_number": 1,
      "crop_count": 0,
      "ocr_completed": 0,
      "ocr_failed": 0
    }
  ]
}
```

`pre-db-review-items.json` schema:

```json
{
  "items": [
    {
      "page_number": 1,
      "item_number": "001",
      "local_image_path": "workspace/manual-crops/page-001/page-001-item-001.webp",
      "crop_box": {
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 100
      },
      "ocr_status": "completed",
      "ocr": {
        "item_number": "001",
        "name_ar": "string or null",
        "name_en": "string or null",
        "description_ar": "string or null",
        "description_en": "string or null",
        "offer_price": 0,
        "original_price": null,
        "size": {
          "value": null,
          "unit": null,
          "text": null
        },
        "pack_quantity": null,
        "bundle_quantity": null,
        "special_offer": null
      },
      "ocr_error": null
    }
  ]
}
```

The local review package is for operator inspection and troubleshooting.

## 13. Progress Events

Create progress events for the workflow.

Stages:

```text
started
validating_layouts
cropping_started
crop_completed
crop_failed
ocr_queued
ocr_started
ocr_waiting_rate_limit
ocr_completed
ocr_failed
writing_review_package
completed
partially_completed
failed
```

Each progress event should include:

```ts
{
  stage: string;
  message: string;
  pageNumber?: number;
  itemNumber?: string;
  currentCrop?: number;
  totalCrops?: number;
  currentOcr?: number;
  totalOcr?: number;
  localImagePath?: string;
  waitMs?: number;
}
```

Show progress in the UI.

## 14. Review Summary UI

Create:

```text
src/renderer/components/review/PreDbReviewSummary.tsx
src/renderer/components/review/ReviewItemTable.tsx
src/renderer/components/review/ReviewItemDetailsPanel.tsx
```

The review summary should show:

```text
total pages
total generated crop images
total OCR completed
total OCR failed
per-page crop count
per-page OCR item count
local review summary file path
local review items file path
local crop folder path
```

The item table should show:

```text
page number
item number
local image path
thumbnail preview if safe
name_ar
name_en
offer_price
original_price
size.text
pack_quantity
bundle_quantity
special_offer
OCR status
OCR error if any
```

The details panel should show:

```text
larger crop preview
local image path
crop coordinates
strict OCR JSON
```

## 15. Proceed to Update DB Button

After the review summary is generated, show a button:

```text
Proceed to Update DB
```

Enable it only when:

```text
review summary exists
at least one OCR item completed
required import context is valid
Supabase config is ready
not currently syncing
```

Before the operator clicks this button:

```text
do not upload images
do not insert offers
do not update offers
do not write import_rows
do not write validation_errors
do not update import_batches
```

After the operator clicks this button, call the existing DB sync flow, adapted to consume the reviewed items and local crop image paths.

## 16. DB Sync Input From Review Items

Update final sync input builder so it can consume:

```text
pre-db review items
local image paths
item OCR JSON
trusted operator-selected supermarket/coverage/dates
```

Map review item fields into existing offer payload fields:

```text
title_ar <- ocr.name_ar
title_en <- ocr.name_en
description_ar <- ocr.description_ar
description_en <- ocr.description_en
offer_price <- ocr.offer_price
original_price <- ocr.original_price
pack_size_value <- ocr.size.value
pack_size_unit <- ocr.size.unit
pack_quantity <- ocr.pack_quantity
quantity/special condition notes <- ocr.special_offer
localImagePath <- local_image_path
source_page_number <- page_number
source_item_number <- item_number
```

Do not use Mistral bounding boxes.

Use manual crop coordinates only for local crop metadata.

## 17. Handling OCR Failures

If an item crop OCR fails:

```text
keep the local crop image
include it in the review table
mark OCR status = failed
allow operator to review the image path manually
do not include it in DB sync unless the operator later edits/adds required fields
```

If inline editing already exists, allow editing. If not, document manual editing as future enhancement.

For now, DB sync should skip OCR-failed items.

## 18. Handling Crop Failures

If a crop fails:

```text
record the failure in the review summary
do not enqueue OCR for that item
continue remaining items
show failure in UI
```

Do not stop the whole leaflet because one crop fails.

## 19. Matching Counts

After workflow completion, show count checks:

```text
manual included boxes count
generated crop image count
OCR completed count
OCR failed count
items eligible for DB sync
items skipped from DB sync
```

If counts differ, show warnings:

```text
Page 36 has 14 crop boxes, 13 OCR completed, 1 OCR failed.
Review before updating DB.
```

## 20. Logs Page

Update logs with messages:

```text
Manual crop + item OCR workflow started.
Cropping page 36 item 001.
Generated local crop: ...
Waiting 1.1s before next Mistral OCR request.
OCR completed for page 36 item 001.
OCR failed for page 36 item 009.
Review package written.
Ready for operator review before DB update.
```

Do not log API keys.

## 21. No DB Writes Before Review

Add explicit safeguards.

The crop + OCR workflow must not call:

```text
offerSyncService
importTrackingService
entityMatchingService
offerPreparationService
Supabase insert/update/upsert
Supabase Storage upload
```

until the operator clicks:

```text
Proceed to Update DB
```

If the current code automatically moves to DB sync after OCR, disable that behavior.

## 22. Optional Inline Editing

If easy and safe, add simple inline editing in the review table for:

```text
name_ar
name_en
offer_price
original_price
size.text
pack_quantity
bundle_quantity
special_offer
```

If not implemented in this chunk, document as future improvement.

Do not block this chunk on inline editing.

## 23. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic filesystem IPC.
* Do not expose generic DB IPC.
* Do not upload images before review approval.
* Do not write to DB before review approval.
* Do not publish offers before review approval.
* Do not request Mistral bounding boxes.
* Do not rely on Mistral coordinates.
* Do not log secrets.
* Only write crop/review files inside the import workspace.

## 24. Tests / Smoke Checks

Add tests or smoke checks for:

```text
crop + OCR workflow validates layouts first
cropper can produce local image paths
OCR queue consumes generated crop paths sequentially
OCR queue enforces minimum delay
review summary file is written
review items file is written
review summary includes local crop paths
DB sync is not called before review approval
Proceed to Update DB builds sync input from review items
OCR-failed items are skipped from DB sync
crop-failed items are skipped from OCR and DB sync
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If a script does not exist, document it and do not invent success.

## 25. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document the new workflow:

```text
Manual crop editor opens before OCR.
Finish all page layouts first.
Click Proceed to Crop + OCR.
App generates local item crop images.
App OCRs each generated item image with delay between calls.
Review summary appears after crop and OCR complete.
Review summary includes local file paths.
Only click Proceed to Update DB after reviewing.
```

## 26. Acceptance Criteria

This chunk is complete when:

* Manual crop editor is the first post-render step.
* Operator can finish layouts for all pages.
* Proceed to Crop + OCR button exists.
* Crop generation starts only after operator proceeds.
* Item OCR starts only for generated crop images.
* OCR calls are sequential with at least 1 second delay.
* Crop and OCR workflow can overlap through producer/consumer queue.
* Review summary appears after crop and OCR finish.
* Review summary includes local crop folder path.
* Review summary includes local JSON file paths.
* Review item table includes local image path for each generated crop.
* No DB writes occur before review approval.
* Proceed to Update DB button exists after review summary.
* DB sync consumes reviewed OCR items and local image paths.
* OCR-failed items are visible but skipped from DB sync.
* Crop-failed items are visible but skipped from OCR and DB sync.
* TypeScript compiles.
* App still starts.

## 27. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 28. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* Updated operator workflow.
* How crop + OCR producer/consumer flow works.
* How OCR delay/rate limiting works.
* Where local crop images are saved.
* Where review JSON files are saved.
* What the review summary shows.
* How Proceed to Update DB works.
* How OCR/crop failures are handled.
* How to test the workflow.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.