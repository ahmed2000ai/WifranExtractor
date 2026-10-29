# Manual End-to-End Testing Checklist

Use this checklist to perform manual validation of the Wifran Offers Extractor pipeline using real PDFs and environment credentials. 

> [!WARNING]
> Testing with real database sync must be careful. Use draft or needs_review only. Do not publish automatically. Use a test supermarket/location if available. Do not delete existing offers. Do not modify customers/users.

## 1. Setup
- [ ] Install dependencies (`npm install`).
- [ ] Create `.env.local` from `.env.example`.
- [ ] Add Supabase and Mistral credentials locally.
- [ ] Start app in development mode (`npm run dev`).
- [ ] Confirm settings page shows config ready (Green badges for Mistral, Supabase, and DB Connection).

## 2. Reference Data
- [ ] Open **Import** page.
- [ ] Confirm supermarkets load into the dropdown.
- [ ] Select a test supermarket.
- [ ] Confirm valid city/region options appear based on the chosen supermarket.

## 3. PDF Preprocessing
- [ ] Select a sample supermarket leaflet PDF.
- [ ] Validate file name and size appear correctly.
- [ ] Run **Preprocess PDF**.
- [ ] Confirm page count is accurate.
- [ ] Confirm chunk count is generated.
- [ ] Confirm rendered pages are logged.
- [ ] Confirm workspace path exists.

## 4. OCR
- [ ] Run **Single Chunk OCR Test** on the first chunk.
- [ ] Confirm product items are extracted successfully.
- [ ] Confirm cover/banner-only pages return zero items or skipped banner rows.
- [ ] Run **Full OCR Pipeline** on all chunks.
- [ ] Confirm failed chunks are visible if any.

## 5. Promotional Filtering
- [ ] Confirm generic campaign banners are skipped automatically.
- [ ] Confirm real product 1+1 offers are NOT skipped.
- [ ] Confirm skipped promotional count appears accurately in the global summary.

## 6. Image Cropping
- [ ] Run **Local Image Cropping**.
- [ ] Confirm valid rows create local cropped images successfully.
- [ ] Confirm missing bounding boxes generate warnings.
- [ ] Confirm promotional rows are NOT cropped.

## 7. Import Tracking
- [ ] Run **Save Import Tracking**.
- [ ] Confirm `offer_source` is created in Supabase.
- [ ] Confirm `import_batch` is created.
- [ ] Confirm `import_rows` are created.
- [ ] Confirm `validation_errors` are created for warnings/errors.

## 8. Entity Matching
- [ ] Run **Entity Matching**.
- [ ] Confirm brands/products are reused or created according to config.
- [ ] Confirm categories are matched but not auto-created by default.
- [ ] Confirm promotional rows create no brands/products.

## 9. Offer Preparation
- [ ] Prepare offer payloads.
- [ ] Confirm `draft` or `needs_review` status only is assigned.
- [ ] Confirm duplicate rows are detected if they exist in the target DB.
- [ ] Confirm NO `published` status is ever assigned.

## 10. Offer Sync
- [ ] Run **Final Sync**.
- [ ] Confirm images upload to Supabase Storage Bucket.
- [ ] Confirm offers are inserted into DB as `draft` or `needs_review`.
- [ ] Confirm `import_rows.created_offer_id` is updated.
- [ ] Confirm `import_batches` final status is updated to `completed` or `partially_completed`.
- [ ] Confirm duplicate/promotional/error rows are NOT inserted as offers.

## 11. Results Review
- [ ] Open **Results** page.
- [ ] Check imported count.
- [ ] Check needs review count.
- [ ] Check skipped promotional count.
- [ ] Check duplicate count.
- [ ] Open row details.
- [ ] Confirm created offer IDs appear and match the database records.
