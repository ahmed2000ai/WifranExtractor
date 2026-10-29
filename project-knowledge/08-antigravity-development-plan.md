# Antigravity Development Plan

## 1. Purpose of This Document

This document defines how Antigravity should build the Wifran Offers Extractor app step by step.

Antigravity must read this document before starting implementation.

The goal is to avoid asking Antigravity to build the whole app in one large prompt. Instead, development should happen through controlled, focused prompt chunks.

Each prompt chunk should:

* Read the relevant `project-knowledge` files.
* Implement one focused part of the app.
* Keep the app runnable.
* Avoid rewriting unrelated working code.
* Add or update types, tests, and documentation where useful.
* Respect the security and database rules.
* Preserve traceability and error handling.

## 2. Project Name

```text
wifran-offers-extractor
```

## 3. Project Type

Local Windows desktop app.

Preferred stack:

```text
Electron
React
TypeScript
Node.js
Supabase
Mistral OCR
Zod
Local PDF processing
Local image processing
```

## 4. Development Philosophy

Build incrementally.

Do not generate a huge app in one attempt.

Do not skip foundations such as:

* Environment validation.
* Safe Electron main/renderer boundary.
* Typed data models.
* Zod validation.
* Import pipeline structure.
* Error handling.
* Logging.
* Test fixtures.

Correctness, traceability, and safe database writes are more important than UI polish.

## 5. Required Knowledge Files

Before coding, Antigravity must read:

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

Antigravity must treat these files as source-of-truth context.

## 6. Existing External Context

The app must connect to:

```text
Supabase database used by Wifran
Supabase Storage bucket for offer item images
Mistral OCR API
```

Mistral model:

```text
mistral-ocr-latest
```

Mistral OCR endpoint:

```text
https://api.mistral.ai/v1/ocr
```

The app must use the Wifran DB schema already defined in the SQL migrations.

Antigravity must not create new DB migrations unless explicitly instructed.

## 7. Development Sequence Overview

Recommended prompt chunks:

```text
Prompt Chunk 01: Project setup and architecture skeleton
Prompt Chunk 02: Environment config, security boundary, and .env.example
Prompt Chunk 03: Electron UI shell and basic navigation
Prompt Chunk 04: Supabase connection and reference data loading
Prompt Chunk 05: Import form, PDF selector, and metadata validation
Prompt Chunk 06: Local PDF splitting and page rendering
Prompt Chunk 07: Shared OCR schemas, fixtures, and validation
Prompt Chunk 08: Mistral OCR integration with structured output
Prompt Chunk 09: Controlled OCR pipeline, retries, and progress events
Prompt Chunk 10: Non-product promotional/banner filtering
Prompt Chunk 11: Bounding box normalization and local image cropping
Prompt Chunk 12: Import batch, import rows, and validation errors
Prompt Chunk 13: Brand/category/product matching and creation
Prompt Chunk 14: Duplicate detection and offer payload creation
Prompt Chunk 15: Supabase Storage upload and offer sync
Prompt Chunk 16: Results UI, row statuses, logs, and summaries
Prompt Chunk 17: End-to-end testing with fixtures and sample PDFs
Prompt Chunk 18: Windows packaging and operator README
```

The exact order can be adjusted if implementation requires it, but Antigravity should not jump directly to OCR/database sync without the foundation.

## 8. Prompt Chunk 01: Project Setup and Architecture Skeleton

Goal:

Create the initial Electron + React + TypeScript project structure.

Tasks:

* Initialize project.
* Configure TypeScript.
* Configure Electron main process.
* Configure React renderer.
* Configure preload script.
* Configure safe IPC pattern.
* Create folder structure.
* Add base scripts for dev/build.
* Add README placeholder.
* Ensure app opens a basic window.

Recommended folders:

```text
src/
  main/
    config/
    db/
    storage/
    ocr/
    pdf/
    image/
    pipeline/
    ipc/
    logging/
  renderer/
    components/
    pages/
    hooks/
    styles/
  preload/
  shared/
    types/
    schemas/
    fixtures/
```

Acceptance criteria:

* App runs locally.
* Electron window opens.
* Renderer displays basic app title.
* TypeScript compiles.
* No secrets are added.
* No database or OCR calls yet.

## 9. Prompt Chunk 02: Environment Config, Security Boundary, and `.env.example`

Goal:

Implement secure configuration loading and validation.

Tasks:

* Create `.env.example`.
* Update `.gitignore`.
* Create typed config loader.
* Validate required variables.
* Redact secrets in logs.
* Expose safe config status to renderer.
* Ensure secrets remain in Electron main process only.

Required variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
MISTRAL_API_KEY
MISTRAL_OCR_MODEL
MISTRAL_OCR_ENDPOINT
```

Acceptance criteria:

* Missing required config produces safe readable errors.
* Renderer can see only configured/missing status, not values.
* No secret can be accessed from renderer.
* `.env.local` is ignored by git.
* `.env.example` contains placeholders only.

## 10. Prompt Chunk 03: Electron UI Shell and Basic Navigation

Goal:

Build a usable app shell.

Minimum screens:

```text
Import screen
Results screen
Settings/status screen
Logs panel or simple log area
```

Tasks:

* Create layout.
* Add simple navigation.
* Add status cards.
* Add settings status display.
* Add placeholder import form.
* Add placeholder results table.

Acceptance criteria:

* UI is usable.
* UI does not need polished design.
* No secrets displayed.
* Navigation works.

## 11. Prompt Chunk 04: Supabase Connection and Reference Data Loading

Goal:

Connect to Wifran Supabase and load reference data.

Tasks:

* Create Supabase admin client in main process.
* Add service functions for reading:

  * supermarkets
  * cities
  * regions
  * supermarket_regions
  * categories
  * brands
  * units
* Add IPC methods for renderer to load safe reference data.
* Populate supermarket/location dropdowns.

Acceptance criteria:

* App loads active supermarkets.
* App loads cities/regions.
* App filters locations by selected supermarket when possible.
* Service role key remains in main process.
* Errors are handled and shown safely.

## 12. Prompt Chunk 05: Import Form, PDF Selector, and Metadata Validation

Goal:

Implement the operator’s main input flow.

Tasks:

* Add PDF file picker using Electron dialog.
* Show selected PDF file name.
* Validate `.pdf` extension.
* Add supermarket dropdown.
* Add city/region selection.
* Add start date default = today.
* Add end date default = today + `DEFAULT_OFFER_DURATION_DAYS`.
* Add pre-import validation.
* Disable start button when invalid.

Acceptance criteria:

* User can select PDF.
* User can select supermarket/location/dates.
* Invalid input is clearly shown.
* Start extraction does not yet need full pipeline.
* No arbitrary file read IPC exists.

## 13. Prompt Chunk 06: Local PDF Splitting and Page Rendering

Goal:

Implement local PDF pre-processing.

Tasks:

* Read selected PDF in main process.
* Validate PDF can be opened.
* Get page count.
* Split PDF into chunks based on `OCR_CHUNK_SIZE`.
* Preserve original page numbers.
* Render pages to images.
* Store rendered page dimensions.
* Create import workspace structure.
* Emit progress events.

Acceptance criteria:

* Works with a sample PDF.
* Produces chunk PDFs.
* Produces rendered page images.
* Stores metadata for original page numbers.
* Handles PDF read/split/render errors.
* Does not call OCR yet.

## 14. Prompt Chunk 07: Shared OCR Schemas, Fixtures, and Validation

Goal:

Implement the core validation layer before OCR integration.

Tasks:

* Create shared TypeScript types for OCR items.
* Create Zod schema for OCR output.
* Add fixtures from `07-sample-extraction-json.md`.
* Validate:

  * valid rows
  * empty response
  * missing price
  * missing product name
  * missing bounding box
  * invalid original price
  * banner/promotional bad row
* Add normalization helpers:

  * empty string to null
  * Arabic numerals to Western digits
  * price parsing
  * unit normalization
  * confidence validation

Acceptance criteria:

* Fixtures validate as expected.
* Bad rows become warnings/errors/skipped.
* No database sync yet.
* No OCR API calls yet.

## 15. Prompt Chunk 08: Mistral OCR Integration With Structured Output

Goal:

Call Mistral OCR for one PDF chunk.

Tasks:

* Add Mistral OCR client in main process.
* Use `MISTRAL_API_KEY`.
* Use model `mistral-ocr-latest`.
* Use endpoint `https://api.mistral.ai/v1/ocr`.
* Build `document_annotation_prompt`.
* Build `document_annotation_format`.
* Send a single chunk.
* Parse `document_annotation`.
* Validate response with Zod.
* Preserve raw response in debug mode.

Acceptance criteria:

* One chunk can be sent to Mistral.
* Structured JSON is parsed.
* Invalid JSON is handled.
* No secrets are exposed.
* OCR prompt tells model to ignore non-product banners.

## 16. Prompt Chunk 09: Controlled OCR Pipeline, Retries, and Progress Events

Goal:

Run OCR across all chunks safely.

Tasks:

* Add concurrency limiter.
* Default max concurrent OCR requests = 3.
* Add retry logic with exponential backoff.
* Respect 429 retry behavior if available.
* Add timeout handling.
* Track chunk success/failure.
* Emit progress events.
* Continue if one chunk fails.

Acceptance criteria:

* Multiple chunks process with controlled concurrency.
* No unbounded `Promise.all`.
* Failed chunks are shown.
* OCR errors are categorized.
* Successful chunks still proceed.

## 17. Prompt Chunk 10: Non-Product Promotional/Banner Filtering

Goal:

Prevent fake offers from banners, covers, logos, and campaign slogans.

Tasks:

* Implement classifier/helper for non-product promotional rows.
* Detect:

  * campaign slogans
  * generic `1+1` without product
  * date badge only
  * supermarket logo only
  * sponsor logo only
  * large banner boxes with no product
* Add error code `NON_PRODUCT_PROMOTIONAL_AREA`.
* Mark such rows as `skipped`.
* Do not crop images for them.
* Do not create products/brands/offers for them.
* Add tests using sample banner fixture.

Acceptance criteria:

* Banner example is skipped.
* Product `1+1` offer is not skipped.
* Cover-only pages with `{ items: [] }` are accepted.
* Skipped rows are counted and visible.

## 18. Prompt Chunk 11: Bounding Box Normalization and Local Image Cropping

Goal:

Crop one image per valid product offer row.

Tasks:

* Normalize bounding box formats.
* Validate boxes against page dimensions.
* Clamp small out-of-bound boxes.
* Add padding.
* Crop local rendered page image.
* Save crop to workspace.
* Skip cropping for skipped/banner rows.
* Handle missing/invalid boxes.

Acceptance criteria:

* Valid boxes produce cropped images.
* Missing boxes create warning.
* Invalid boxes create warning/error.
* Crops are not created for promotional rows.
* Cropped image paths are stored in normalized data.

## 19. Prompt Chunk 12: Import Batch, Import Rows, and Validation Errors

Goal:

Persist import tracking data.

Tasks:

* Create `offer_sources`.
* Create `import_batches`.
* Insert `import_rows`.
* Insert `validation_errors`.
* Update batch status/counts.
* Store raw and normalized JSON.
* Link page numbers and row numbers.

Acceptance criteria:

* Each import has a batch.
* Each extracted row has an import row unless intentionally omitted by settings.
* Validation errors are saved.
* Batch counts are accurate.
* Failed rows do not disappear.

## 20. Prompt Chunk 13: Brand/Category/Product Matching and Creation

Goal:

Normalize extracted rows into product references.

Tasks:

* Match brands by Arabic/English name and slug.
* Create brand if allowed and needed.
* Match categories.
* Do not auto-create categories by default.
* Match products by alias, name, slug, and brand/name combo.
* Create product if allowed and needed.
* Create product aliases for OCR names.
* Avoid product creation for skipped rows.

Acceptance criteria:

* Existing brands/products reused.
* New brands/products created only when allowed.
* Categories are matched but not blindly created.
* Uncertain matches create warnings.
* Skipped banner rows create nothing.

## 21. Prompt Chunk 14: Duplicate Detection and Offer Payload Creation

Goal:

Prepare safe final offer payloads.

Tasks:

* Build offer payload from normalized row and selected import metadata.
* Calculate discount amount/percentage when possible.
* Calculate unit price when safe.
* Calculate data quality score.
* Set status `draft` or `needs_review`.
* Detect duplicate offers.
* Skip duplicates by default.
* Do not publish offers automatically.

Acceptance criteria:

* Valid rows produce offer payload.
* Warning rows produce `needs_review`.
* Duplicates are skipped.
* Promotional rows are not converted to payloads.
* No offer is `published` by default.

## 22. Prompt Chunk 15: Supabase Storage Upload and Offer Sync

Goal:

Upload cropped images and create final offers.

Tasks:

* Upload cropped item images to Supabase Storage.
* Use stable storage paths.
* Save image URLs.
* Insert final `offers`.
* Update `import_rows.created_offer_id`.
* Continue if one row fails.
* Update batch final status.

Acceptance criteria:

* Images upload successfully.
* Offers are created for valid rows.
* Missing image creates `needs_review` if allowed.
* Row failures do not stop entire batch.
* Batch summary is accurate.

## 23. Prompt Chunk 16: Results UI, Row Statuses, Logs, and Summaries

Goal:

Show the operator what happened.

Tasks:

* Results table.
* Row status chips.
* Imported/skipped/error/warning counts.
* Skipped promotional count.
* Failed chunk list.
* Image previews.
* Error/warning messages.
* Processing log panel.
* Final summary.

Acceptance criteria:

* Operator can see what succeeded.
* Operator can see what failed.
* Operator can see skipped promotional rows.
* Operator can identify rows needing review.

## 24. Prompt Chunk 17: End-to-End Testing With Fixtures and Sample PDFs

Goal:

Make the app reliable.

Tasks:

* Add tests for schemas.
* Add tests for normalization.
* Add tests for promotional filtering.
* Add tests for bounding box normalization.
* Add tests for offer payload creation.
* Add tests for duplicate detection if practical.
* Add manual test checklist for real PDFs.

Acceptance criteria:

* Fixtures pass.
* Banner rows are skipped.
* Product rows are accepted.
* Missing price/product rows fail as expected.
* App can process a small real PDF end to end.

## 25. Prompt Chunk 18: Windows Packaging and Operator README

Goal:

Prepare for internal use.

Tasks:

* Configure Windows packaging.
* Ensure secrets are not bundled.
* Add operator setup instructions.
* Add `.env.local` setup instructions.
* Add troubleshooting guide.
* Add known limitations.
* Add security reminders.
* Add developer README.

Acceptance criteria:

* App can be packaged or run reliably.
* Operator knows how to configure it.
* Secrets are not packaged into the executable.
* Documentation is clear.

## 26. General Prompt Rules for Antigravity

Every prompt chunk should tell Antigravity:

```text
Read the project-knowledge files first.
Implement only the requested chunk.
Do not rewrite unrelated working code.
Keep the app runnable.
Preserve TypeScript types.
Add error handling.
Do not expose secrets.
Do not add migrations unless requested.
Do not create published offers by default.
Do not create offers from campaign banners or non-product promotional areas.
```

## 27. Recommended Prompt Header Template

Use this header at the start of every Antigravity prompt chunk:

```markdown
# Antigravity Prompt Chunk XX: [Title]

You are working inside the `wifran-offers-extractor` project.

Before coding, read these files:

- `project-knowledge/00-prd-wifran-offers-extractor.md`
- `project-knowledge/01-product-brief-and-scope.md`
- `project-knowledge/02-wifran-db-schema-and-sync-rules.md`
- `project-knowledge/03-leaflet-extraction-rules.md`
- `project-knowledge/04-ocr-api-and-bounding-box-spec.md`
- `project-knowledge/05-processing-pipeline-and-error-handling.md`
- `project-knowledge/06-env-security-and-credentials.md`
- `project-knowledge/07-sample-extraction-json.md`
- `project-knowledge/08-antigravity-development-plan.md`

Follow these rules:

- Implement only this chunk.
- Do not rewrite unrelated working files.
- Keep the app runnable after this chunk.
- Do not expose secrets in renderer code.
- Do not hardcode API keys.
- Do not add database migrations unless explicitly instructed.
- Do not insert/publish real offers unless this chunk explicitly asks for sync logic.
- Do not create offers from banners, cover pages, logos, date badges, or generic campaign slogans.
```

## 28. Definition of Done for Every Chunk

Each chunk is done only when:

```text
TypeScript compiles.
App still starts.
No secrets are exposed.
New code follows the main/renderer boundary.
Errors are handled clearly.
Relevant types are added or updated.
Relevant tests/fixtures are added where appropriate.
README or comments are updated if needed.
```

## 29. What Antigravity Must Never Do

Antigravity must never:

* Commit `.env.local`.
* Hardcode Supabase keys.
* Hardcode Mistral keys.
* Expose service role key to renderer.
* Expose Mistral key to renderer.
* Build a generic SQL execution UI.
* Drop or modify Wifran DB tables.
* Add migrations without permission.
* Delete Wifran data.
* Publish offers automatically by default.
* Create offers from non-product promotional banners.
* Ignore import tracking tables.
* Skip validation.
* Use unlimited OCR concurrency.
* Send whole large leaflets to OCR by default.
* Treat OCR output as trusted without Zod validation.

## 30. Final Development Principle

Build the app like a careful ETL system, not a quick OCR demo.

The extractor must:

```text
Read PDFs locally.
Extract product offer data through Mistral OCR.
Ignore non-product promotional areas.
Validate and normalize data.
Crop item images locally.
Track every row.
Sync safe records into Wifran.
Show clear results to the operator.
```

A slower but traceable import is better than a fast import that creates wrong Wifran offers.