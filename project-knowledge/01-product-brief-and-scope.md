# Wifran Offers Extractor - Product Brief and Scope

## 1. Purpose of This Document

This document gives Antigravity the core product context for the Wifran Offers Extractor app.

The purpose is to make sure the development agent understands:

* What the app is.
* Who will use it.
* What problem it solves.
* What the app must do.
* What the app must not do.
* How it fits into the existing Wifran ecosystem.
* Which parts of the workflow happen locally.
* Which parts require cloud/API access.

This document should be read together with the PRD and the other files inside the `project-knowledge` folder.

## 2. Product Name

**Wifran Offers Extractor**

## 3. Product Type

Wifran Offers Extractor is a **local Windows desktop application**.

It is not a public web app.

It is not part of the customer-facing Wifran app.

It is an internal operations tool used to process supermarket weekly PDF leaflets and upload extracted offers into the Wifran database.

## 4. Parent Product Context

The parent product is **Wifran**.

Wifran is a Saudi grocery savings app/website that helps users discover supermarket offers and save money on groceries.

Branding:

* App name: `Wifran`
* Arabic tagline: `Ê›¯— √ﬂÀ— ›Ì „ﬁ«÷Ìﬂ ﬂ· √”»Ê⁄`
* English tagline: `Smarter grocery savings every week.`

The extractor app exists only to support Wifran by making offer ingestion faster, more structured, and less manual.

## 5. Main Problem

Supermarkets publish weekly offers as PDF leaflets.

These leaflets are usually:

* Visually dense.
* Multi-page.
* In Arabic, English, or mixed Arabic/English.
* Full of product images.
* Full of prices, discounts, pack sizes, and promotional text.
* Not structured as machine-readable data.

Wifran needs this data in its database as structured offer records.

Manual extraction is slow and error-prone. The extractor app should automate most of the work while still allowing review of problematic rows.

## 6. Primary User

The primary user is an internal Wifran operator or data-entry person.

The user will:

* Open the Windows app.
* Select a supermarket leaflet PDF from the local machine.
* Select the supermarket.
* Select the city and/or region.
* Select the offer start date.
* Select the offer end date.
* Start the extraction process.
* Review the result summary.
* Deal with rows that failed or need review.

The user is not assumed to be a developer.

The UI should be simple, practical, and clear.

## 7. Main Workflow

The app should follow this workflow:

1. User opens the desktop app.
2. User selects a local PDF leaflet.
3. User selects the supermarket.
4. User selects the city and/or region.
5. User selects the offer start date.
6. User selects the offer end date.
7. User starts the extraction.
8. App creates a new import batch.
9. App reads and validates the PDF locally.
10. App splits the PDF into pages or small chunks locally.
11. App renders each PDF page into a high-resolution image locally.
12. App sends each page or chunk to the OCR/AI provider.
13. OCR/AI provider returns strict structured JSON.
14. JSON includes extracted offer fields and bounding boxes.
15. App validates and normalizes the extracted rows.
16. App crops one image per offer item locally using bounding boxes.
17. App uploads cropped images to Wifran storage.
18. App inserts or updates records in the Wifran database.
19. App records import rows, validation errors, and audit logs.
20. App shows final import summary.

## 8. Local Processing Scope

The following operations must happen locally inside the desktop app:

* Reading the selected PDF.
* Validating the PDF file.
* Splitting the PDF into pages or chunks.
* Rendering PDF pages as images.
* Cropping item images from rendered page images.
* Temporary file management.
* Parsing OCR/AI JSON responses.
* Validating extracted rows.
* Normalizing extracted data before upload.
* Preparing database and storage payloads.

These local operations should not require external APIs.

## 9. Cloud/API Processing Scope

The following operations require cloud/API access:

* OCR/AI extraction.
* Uploading cropped item images to storage.
* Reading existing Wifran reference data such as supermarkets, cities, regions, categories, brands, and products.
* Inserting or updating Wifran database records.
* Creating import batches.
* Saving import rows.
* Saving validation errors.
* Saving audit logs if applicable.

## 10. OCR/AI Extraction Scope

The extractor should use an OCR/AI provider to extract structured offer data from leaflet pages.

The OCR/AI provider should receive small chunks, not the entire leaflet at once.

Recommended approach:

* Use 1 to 3 pages per OCR request.
* Use controlled concurrency.
* Default concurrent OCR requests: 3 or 4.
* Retry temporary failures.
* Handle rate limits gracefully.
* Store failed chunks and allow retry.

The OCR/AI output must be strict JSON.

The OCR/AI response should include:

* Product names.
* Brand names.
* Category names.
* Prices.
* Discount text.
* Pack size.
* Pack quantity.
* Unit information.
* Quantity limits.
* Loyalty requirement.
* Notes.
* Source page number.
* Bounding box for each item.
* Confidence score if available.

## 11. Image Cropping Scope

The app must create one cropped image per extracted offer item.

The intended workflow:

1. Render each PDF page into a high-resolution image.
2. Receive item bounding boxes from OCR/AI.
3. Match each bounding box to the correct page.
4. Convert bounding box coordinates if needed.
5. Crop the item image locally.
6. Save the cropped image temporarily.
7. Upload the image to storage.
8. Save the image URL in the final offer record.

If image cropping fails for a row, the row should not crash the entire import.

The row should be marked as failed or needing review.

## 12. Database Scope

The app must integrate with the existing Wifran database.

The main final destination is the `offers` table.

The app should also use supporting tables such as:

* `supermarkets`
* `cities`
* `regions`
* `supermarket_regions`
* `categories`
* `brands`
* `products`
* `product_aliases`
* `offer_sources`
* `import_batches`
* `import_rows`
* `validation_errors`
* `audit_logs`

The app should not blindly insert raw OCR output directly into `offers`.

Instead, the app should:

1. Save raw extraction data in import-related tables.
2. Validate each row.
3. Normalize references such as brand, category, and product.
4. Upload cropped image.
5. Insert or update the final offer record.
6. Link the import row to the created or updated offer.

## 13. Required User Inputs

The app must collect these fields before extraction:

### PDF File

Required.

The user must select a local PDF leaflet.

### Supermarket

Required.

The value should come from the Wifran database.

### City and/or Region

Required depending on the Wifran schema and available data.

The app must associate imported offers with the correct location.

### Offer Start Date

Required.

Default value: today.

### Offer End Date

Required.

Default value: 7 days from today.

## 14. Processing Settings

The app should support configurable processing settings.

These can be in a settings screen or advanced section.

Recommended settings:

* OCR provider.
* OCR model name.
* OCR API key.
* PDF chunk size.
* Max concurrent OCR requests.
* OCR retry count.
* Render DPI.
* Image output format.
* Storage bucket name.
* Whether to require review before final upload.
* Whether to save debug files locally.

## 15. MVP Feature Scope

The MVP must include:

* Windows desktop app shell.
* Simple usable UI.
* PDF file picker.
* Supermarket dropdown.
* City/region dropdown.
* Start/end date inputs.
* Settings screen.
* Supabase connection.
* Ability to load reference data from Wifran DB.
* Local PDF splitting.
* Local PDF page rendering.
* OCR/AI API integration.
* Controlled OCR concurrency.
* Strict JSON parsing and validation.
* Local image cropping.
* Storage upload.
* Database insert/upsert logic.
* Import batch tracking.
* Import row tracking.
* Validation error tracking.
* Results table.
* Processing log.
* Final import summary.

## 16. MVP Non-Scope

The MVP should not include:

* A polished consumer-grade UI.
* User registration.
* Public authentication flow unless specifically requested later.
* Supermarket website scraping.
* Automatic leaflet discovery.
* Scheduling or background imports.
* Multi-tenant SaaS features.
* Advanced manual product matching UI.
* Advanced image editing.
* Training a custom OCR model.
* Complex analytics dashboards.
* Changes to the main Wifran customer-facing app.

## 17. Review and Validation Scope

The MVP should show extracted rows and their status.

Rows should be marked clearly as:

* Valid.
* Uploaded.
* Failed.
* Duplicate.
* Needs review.

Rows should need review when:

* Product name is missing.
* Offer price is missing.
* OCR confidence is low.
* Bounding box is missing or invalid.
* Image crop failed.
* Brand matching is uncertain.
* Category matching is uncertain.
* Product matching is uncertain.
* Duplicate detection is uncertain.
* JSON parsing required repair.
* Any required database relationship is missing.

The first version does not need a full manual editing workflow, but it should make problematic rows visible.

## 18. Success Criteria

The app is successful when:

1. An internal operator can run it on Windows.
2. The operator can select a PDF and required metadata.
3. The app can process a multi-page supermarket leaflet.
4. The app can extract structured offer data.
5. The app can crop one image per offer item.
6. The app can upload item images to storage.
7. The app can create or update offer records in Wifran.
8. The app can track import batches and rows.
9. The app can show which rows succeeded and which failed.
10. The app avoids crashing the whole import because of individual row failures.

## 19. Reliability Principles

Antigravity must prioritize reliability over visual polish.

Important principles:

* Do not lose raw OCR output.
* Do not silently ignore failed rows.
* Do not upload invalid offers as if they were valid.
* Do not expose secrets in frontend renderer code.
* Do not process unlimited API calls at once.
* Do not assume OCR output is always valid JSON.
* Do not assume every extracted row has a valid bounding box.
* Do not assume extracted brand/product/category already exists.
* Do not create duplicate offers without checking.
* Do not block the whole import because of one failed item.

## 20. Recommended Technical Direction

Use:

* Electron for the Windows desktop app.
* React for UI.
* TypeScript for type safety.
* Node.js/Electron main process for local file, PDF, image, OCR, and privileged database operations.
* Supabase client for Wifran database and storage.
* Zod for validating OCR JSON and internal data structures.
* A local PDF library for splitting and/or loading PDFs.
* A local PDF rendering strategy for page images.
* A local image library for cropping item images.
* A concurrency limiter for OCR requests.

## 21. Repository Structure Guidance

The extractor should be developed as a separate project/repository from the main Wifran customer-facing app.

Recommended root folder:

```text
wifran-offers-extractor/
```

Recommended knowledge folder:

```text
wifran-offers-extractor/project-knowledge/
```

Recommended documentation files:

```text
00-prd-wifran-offers-extractor.md
01-product-brief-and-scope.md
02-wifran-db-schema-and-sync-rules.md
03-leaflet-extraction-rules.md
04-ocr-api-and-bounding-box-spec.md
05-processing-pipeline-and-error-handling.md
06-env-security-and-credentials.md
07-sample-extraction-json.md
08-antigravity-development-plan.md
```

## 22. Development Method

Development should happen through step-by-step prompt chunks.

Antigravity should not attempt to build the entire app in one pass.

Each prompt chunk should:

* Read the relevant `project-knowledge` files.
* Implement one focused part of the app.
* Preserve existing working code.
* Avoid rewriting unrelated files.
* Add clear error handling.
* Add or update documentation when relevant.
* Keep the app runnable after each step.

## 23. Final Product Principle

The Wifran Offers Extractor is an internal ETL tool.

Its job is not just to extract data.

Its job is to extract data, preserve traceability, validate quality, crop item images, and safely sync reliable offer records into Wifran.

Correctness, auditability, and safe database updates are more important than speed or UI polish.
