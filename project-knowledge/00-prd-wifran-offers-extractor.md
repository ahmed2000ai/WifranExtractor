# PRD: Wifran Offers Extractor

## 1. Product Name

**Wifran Offers Extractor**

## 2. Product Summary

Wifran Offers Extractor is a local Windows desktop application used internally to extract supermarket offers from weekly PDF leaflets and upload the structured offer data into the Wifran database.

The app allows an internal operator to select a supermarket leaflet PDF, choose the relevant supermarket and location metadata, define the offer validity dates, run OCR/AI extraction, crop individual item images from the leaflet, validate the extracted data, and sync the final offers into Wifran.

The app is not customer-facing. It is an internal operations tool designed to make weekly offer ingestion faster, more consistent, and less manual.

## 3. Background and Problem

Wifran depends on accurate supermarket offer data. Supermarket offers are usually published as weekly PDF leaflets. These leaflets are visually dense and contain many offer items with mixed Arabic and English text, prices, pack sizes, discount labels, and product images.

Manually entering these offers is slow and error-prone. The existing discussion established that OCR/AI can extract structured offer data from leaflet pages, but the extraction must be done carefully:

* The PDF should be processed in pages or small chunks, not as one large document.
* OCR/AI output must follow a strict JSON schema.
* Bounding boxes are needed so the app can crop one image per offer item.
* PDF splitting and image cropping should happen locally without API calls.
* API calls should be throttled to avoid rate limits.
* Extracted rows should be validated before upload.
* Import batches, rows, and validation errors should be tracked.

The goal is to build a reliable local extractor that turns a weekly supermarket leaflet into usable Wifran offer records with item images.

## 4. Target User

The primary user is an internal Wifran data-entry or operations person.

The user is expected to:

* Have access to supermarket weekly PDF leaflets.
* Know which supermarket the leaflet belongs to.
* Know which city or region the leaflet applies to.
* Know or confirm the offer start and end dates.
* Review extraction results when needed.
* Run the upload process after validation.

The user is not expected to be technical. The UI should be simple and usable.

## 5. Primary Goals

The app should:

1. Let the operator select a supermarket leaflet PDF.
2. Let the operator select supermarket, city, region, start date, and end date.
3. Split the PDF locally into pages or small chunks.
4. Render PDF pages into high-quality images locally.
5. Send page chunks to an OCR/AI extraction provider.
6. Receive structured JSON offer data.
7. Receive or derive bounding boxes for each offer item.
8. Crop one image per offer item locally.
9. Validate and normalize extracted data.
10. Upload item images to storage.
11. Insert or update offer data in the Wifran database.
12. Track the whole import using import batch, import row, validation error, and audit records.
13. Show a final summary of successful, failed, duplicate, and low-confidence rows.

## 6. Non-Goals

The first version should not attempt to:

* Build a polished commercial UI.
* Support mobile devices.
* Support macOS or Linux packaging.
* Replace the Wifran customer-facing app.
* Automatically scrape supermarket websites.
* Automatically discover new leaflets online.
* Guarantee perfect extraction without human review.
* Train a custom OCR model.
* Build a complex approval workflow unless required by the existing database schema.
* Edit the original Wifran web app codebase.

The app should be a separate local utility focused on extraction and syncing.

## 7. Recommended App Type

The app should be built as a local Windows desktop app.

Preferred stack:

* Electron
* React
* TypeScript
* Node.js backend logic inside Electron main process
* Supabase client for database/storage operations
* Local PDF and image processing libraries

The UI can be simple. Reliability and correct data handling are more important than design quality.

## 8. High-Level User Flow

1. Operator opens the Wifran Offers Extractor app.
2. Operator selects a PDF leaflet from local disk.
3. Operator selects the supermarket.
4. Operator selects the city and/or region.
5. Operator selects offer start date.
6. Operator selects offer end date.
7. Operator clicks “Start Extraction”.
8. App creates an import batch.
9. App validates the PDF and selected metadata.
10. App splits the PDF locally.
11. App renders each page as an image locally.
12. App sends page chunks to OCR/AI provider with controlled concurrency.
13. App parses the OCR/AI JSON responses.
14. App validates the extracted rows.
15. App crops item images using bounding boxes.
16. App normalizes brands, products, categories, prices, and pack data.
17. App uploads cropped images to storage.
18. App inserts or updates Wifran database records.
19. App records import rows, warnings, validation errors, and audit logs.
20. Operator sees final results and can identify rows that need manual review.

## 9. Required Input Fields

The main screen must include:

### PDF Input

* PDF file picker
* Display selected file name
* Display number of pages after loading
* Display validation errors if the PDF cannot be read

### Supermarket Selection

* Dropdown loaded from Wifran database
* Required field

### Location Selection

Depending on Wifran schema availability:

* City dropdown
* Region dropdown
* Or city + region combination based on existing supermarket coverage

At minimum, the app must be able to attach each offer to the correct supermarket and location.

### Offer Dates

* Start date
* End date

Defaults:

* Start date: today
* End date: 7 days from today

### Optional Processing Settings

These can be placed in a settings screen or advanced section:

* OCR provider
* OCR model name
* Chunk size
* Max concurrent OCR requests
* Retry count
* Render DPI
* Image output format
* Whether to require review before upload

## 10. Required Output

For every valid extracted offer, the app should produce:

* Product name in Arabic if available
* Product name in English if available
* Brand name in Arabic if available
* Brand name in English if available
* Category name in Arabic if available
* Category name in English if available
* Description in Arabic if available
* Description in English if available
* Offer price
* Original price if available
* Discount text if available
* Pack size value
* Pack size unit
* Pack quantity
* Unit price if calculated or available
* Unit price unit
* Quantity limit if available
* Loyalty requirement if available
* Notes in Arabic if available
* Notes in English if available
* Source PDF page number
* Source reference
* Cropped item image
* Extraction confidence
* Validation status
* Error or warning details if applicable

## 11. Database Integration Requirements

The app must integrate with the existing Wifran database structure.

The app should use the following conceptual data model:

* `supermarkets` identify the supermarket.
* `cities`, `regions`, and `supermarket_regions` identify location coverage.
* `categories` classify products.
* `brands` identify product brands.
* `products` store normalized product records.
* `product_aliases` help match extracted leaflet names to existing products.
* `offer_sources` identify the source PDF or leaflet.
* `offers` store the final published or draft offer records.
* `import_batches` track each PDF import operation.
* `import_rows` track each extracted item row.
* `validation_errors` track issues found during extraction, normalization, cropping, or upload.
* `audit_logs` track important operations.

The app must not blindly insert everything without validation. It should create or update related records carefully.

## 12. Import Batch Requirements

Every extraction run should create an import batch.

The import batch should track:

* Selected supermarket
* Selected city and/or region
* Source PDF file name
* Offer start date
* Offer end date
* Processing status
* Number of pages
* Number of extracted rows
* Number of successful rows
* Number of failed rows
* Number of rows needing review
* Start timestamp
* End timestamp
* Error summary if failed

## 13. Import Row Requirements

Every extracted offer item should have an import row.

Each import row should store:

* Import batch ID
* Source page number
* Raw OCR JSON
* Normalized JSON
* Validation status
* Linked product ID if matched or created
* Linked offer ID if uploaded
* Cropped image path or URL
* Confidence score if available
* Error or warning summary

This makes the extraction process auditable and debuggable.

## 14. Validation Requirements

The app should validate extracted rows before uploading final offers.

Required validations:

* Offer price must exist and be numeric.
* Product name must exist in Arabic or English.
* Supermarket must be selected.
* City and/or region must be selected.
* Offer start date must be valid.
* Offer end date must be valid and not earlier than start date.
* Page number must exist.
* Cropped image should exist unless image cropping failed.
* Pack size value should be numeric when present.
* Pack quantity should be numeric when present.
* Boolean fields should be valid booleans.
* Prices should not be negative.
* Extremely suspicious prices should be flagged for review.
* Rows with missing required values should not be uploaded as final published offers without review.

## 15. OCR/AI Extraction Requirements

The OCR/AI provider should be called on small page chunks, not the whole leaflet at once.

Reasons:

* Avoid output token limits.
* Reduce skipped items.
* Reduce mismatched prices and product names.
* Reduce hallucination.
* Improve retry behavior.
* Make failed chunks easier to rerun.

The app should support controlled concurrency.

Default recommendation:

* Chunk size: 1 to 3 pages
* Concurrent OCR requests: 3 or 4
* Retry failed temporary errors
* Handle rate limit errors gracefully

The OCR prompt must require strict JSON output.

## 16. Bounding Box and Image Cropping Requirements

The app needs one image per offer item.

Expected workflow:

1. Render each PDF page into a high-resolution image locally.
2. Ask OCR/AI to return bounding box coordinates for each item.
3. Convert coordinates if needed so they match the rendered page image.
4. Crop each item image locally.
5. Save each cropped item image using a stable file naming convention.
6. Upload the cropped image to storage.
7. Save the final public or storage URL in the offer record.

Bounding boxes must be associated with the correct page number.

If a bounding box is missing or invalid:

* Mark the row as needing review.
* Do not crash the entire import.
* Allow other valid rows to continue.

## 17. Local Processing Requirements

The following should happen locally without API calls:

* Reading the selected PDF.
* Splitting the PDF into pages or chunks.
* Rendering pages into images.
* Cropping item images.
* Temporary file management.
* JSON validation.
* Data normalization.
* Preparing upload payloads.

Only OCR/AI extraction and cloud database/storage sync require network calls.

## 18. Storage Requirements

The app should upload cropped item images to the configured Wifran storage bucket.

Image upload requirements:

* Use stable file names.
* Avoid collisions between imports.
* Include import batch ID or timestamp in path.
* Include page number and row ID in path when possible.
* Store image URL in the offer record.
* Track image upload failures in validation errors.

Suggested path format:

```text
offers/{supermarket_slug}/{YYYY-MM-DD}/{import_batch_id}/page-{page_number}/item-{row_id}.jpg
```

## 19. Duplicate Handling Requirements

The app should avoid creating duplicate offers when possible.

Potential duplicate criteria:

* Same supermarket
* Same city and/or region
* Same product
* Same offer start date
* Same offer end date
* Same offer price
* Same pack size
* Same pack quantity

If a likely duplicate is found:

* Either update the existing offer or mark the row as duplicate depending on the final sync rules.
* Record the duplicate decision in import rows or validation errors.
* Do not silently create duplicate records.

## 20. Review Requirements

The first version should support at least a basic review experience.

Rows should be marked as needing review when:

* Confidence is low.
* Price is missing.
* Product name is missing.
* Brand/category matching is uncertain.
* Bounding box is missing.
* Image crop failed.
* Duplicate detection is uncertain.
* JSON parsing required repair.
* OCR output is incomplete.

The UI can show a simple table of extracted rows with statuses.

Full manual editing can be added later, but the first version should at least make problematic rows visible.

## 21. Status Requirements

The app should use clear statuses for batches and rows.

Recommended batch statuses:

* `pending`
* `processing`
* `ocr_completed`
* `validating`
* `uploading`
* `completed`
* `partially_completed`
* `failed`

Recommended row statuses:

* `pending`
* `extracted`
* `valid`
* `needs_review`
* `uploaded`
* `duplicate`
* `failed`

## 22. Error Handling Requirements

The app should handle errors gracefully.

Error types to track:

* PDF read error
* PDF split error
* Page render error
* OCR API error
* OCR rate limit error
* OCR timeout
* OCR JSON parse error
* Missing required field
* Price parse error
* Invalid pack size
* Missing bounding box
* Image crop failure
* Storage upload failure
* Database insert failure
* Duplicate offer detected
* Low-confidence extraction

The app should not fail the whole import because of one bad row unless the failure is global.

## 23. Security Requirements

The app may require privileged access to Wifran database and storage.

Security rules:

* Do not hardcode secrets in source code.
* Do not commit `.env` files.
* Provide `.env.example`.
* Keep service role or admin credentials out of the renderer process.
* Use Electron main process or a secure backend layer for privileged operations.
* Assume the app is for trusted internal operators only.
* Avoid exposing Supabase service role key in browser-visible code.
* Log errors without leaking secrets.

A later architecture decision is required:

* Option A: local app uses Supabase service role key from local environment/config.
* Option B: local app authenticates an admin user and calls secure backend endpoints.
* Option C: local app connects only to an internal ingestion API.

For MVP development, Option A may be acceptable for local internal use, but it must be implemented carefully.

## 24. Performance Requirements

The app should be able to process a large weekly leaflet without freezing the UI.

Target:

* Support PDFs of at least 100 pages.
* Support visually dense leaflet pages.
* Use background processing where possible.
* Show progress to the operator.
* Use controlled concurrency for API calls.
* Allow failed chunks to be retried.
* Avoid loading unnecessarily huge image data in the UI.

## 25. User Interface Requirements

The UI should be simple and practical.

Minimum screens:

### Main Import Screen

* PDF selector
* Supermarket selector
* City/region selector
* Start date
* End date
* Start extraction button
* Progress indicator
* Processing log

### Results Screen

* Extracted rows table
* Row status
* Product name
* Price
* Page number
* Image preview if available
* Error/warning summary
* Upload status

### Settings Screen

* Supabase URL
* Supabase key/config method
* OCR API key
* OCR provider/model
* Chunk size
* Max concurrent requests
* Render DPI
* Storage bucket name

## 26. Logging Requirements

The app should keep logs useful for debugging.

Logs should include:

* App start
* Selected PDF
* Selected metadata
* Batch creation
* PDF splitting progress
* Page rendering progress
* OCR request start/end
* OCR failures
* JSON validation failures
* Image crop failures
* Upload failures
* Final import summary

Logs should not include API keys or service credentials.

## 27. Success Criteria

The MVP is successful when:

1. The app can run on Windows.
2. The operator can select a PDF leaflet and metadata.
3. The app can split/render the PDF locally.
4. The app can send page chunks to OCR/AI provider.
5. The app can receive strict structured JSON.
6. The app can crop item images locally using bounding boxes.
7. The app can validate extracted rows.
8. The app can upload item images to storage.
9. The app can insert or update offers in Wifran database.
10. The app can track import batches, rows, and validation errors.
11. The app can show a clear summary of completed, failed, duplicate, and review-needed rows.
12. The app can be packaged as a Windows executable or run reliably in local development mode.

## 28. MVP Scope

The first version should include:

* Electron desktop shell
* Basic React UI
* PDF file picker
* Supermarket/city/region/date form
* Local PDF splitting
* Local page rendering
* OCR API integration
* Controlled concurrency
* JSON schema validation
* Local image cropping
* Supabase database connection
* Supabase storage upload
* Import batch tracking
* Import row tracking
* Validation error tracking
* Results table
* Basic settings screen
* `.env.example`
* Developer README

## 29. Future Enhancements

Possible future improvements:

* Manual row editing before upload
* Side-by-side page preview and extracted item list
* Bounding box visual overlay
* Product matching suggestions
* Brand/category management UI
* Retry only failed pages
* Multiple OCR provider support
* Automatic leaflet download from supermarket websites
* Admin authentication instead of local service key
* Ingestion backend API
* Advanced duplicate resolution
* Better deal scoring and quality scoring
* Scheduled weekly import workflow

## 30. Development Approach for Antigravity

Development must happen step-by-step using prompt chunks.

Antigravity should not attempt to build the whole app in one response.

Each prompt chunk should focus on one layer only:

1. Project setup
2. Desktop UI shell
3. Settings and environment config
4. Supabase connection
5. PDF splitting and rendering
6. OCR integration
7. JSON validation
8. Image cropping
9. Database normalization and sync
10. Import tracking
11. Review/results UI
12. Packaging and documentation

Each step should preserve existing working code and avoid rewriting unrelated parts of the app.

## 31. Key Principle

The app should prioritize correctness, traceability, and safe database updates over speed or visual polish.

A slightly slower import that produces reliable, auditable offer records is better than a fast import that creates incorrect Wifran data.
