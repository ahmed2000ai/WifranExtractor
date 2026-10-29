# Wifran Offers Extractor

Internal desktop tool for extracting supermarket offers from PDF leaflets.

## Description

This application allows an internal operator to select a supermarket leaflet PDF, define offer metadata, and run a local extraction pipeline using Mistral OCR. It splits PDFs locally, crops item images, validates the extracted rows, and syncs the structured offer records directly to the Wifran database.

**Status**: Initial Project Skeleton.

## Development Setup

1. Copy `.env.example` to `.env.local` and fill in your real API keys and configuration.
   > **Note:** `.env.local` is ignored by git and must never be committed.

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

   You can verify your configuration is correct by opening the "Settings" tab in the app.

4. Build for production:
   ```bash
   npm run build
   ```

## Security Warning

- **DO NOT commit `.env.local` or any secrets to this repository.**
- This app is meant for internal operators only.
- Service role keys and OCR API keys remain strictly inside the Electron main process and are never exposed to the React renderer.

## Implementation Plan

This app is being built iteratively in prompt chunks:
1. **Prompt Chunk 01**: Project setup and architecture skeleton (Complete)
2. **Prompt Chunk 02**: Environment Config, Security Boundary, and `.env.example` (Complete)
3. **Prompt Chunk 03**: Electron UI Shell and Basic Navigation (Complete)
4. **Prompt Chunk 04**: Supabase Connection and Reference Data Loading (Complete)
5. **Prompt Chunk 05**: Import Form, PDF Selector, and Metadata Validation (Complete)
6. **Prompt Chunk 06**: Local PDF Splitting and Page Rendering (Complete)
7. **Prompt Chunk 07**: Shared OCR Schemas, Fixtures, and Validation (Complete)
8. **Prompt Chunk 08**: Mistral OCR Integration With Structured Output (Complete)
9. **Prompt Chunk 09**: Controlled OCR Pipeline, Retries, and Progress Events (Complete)
10. **Prompt Chunk 10**: Non-Product Promotional/Banner Filtering (Complete)
11. **Prompt Chunk 11**: Bounding Box Normalization and Local Image Cropping (Complete)
12. **Prompt Chunk 12**: Import Batch, Import Rows, and Validation Errors (Complete)
13. **Prompt Chunk 13**: Brand, Category, Product Matching and Creation (Complete)
14. **Prompt Chunk 14**: Duplicate Detection and Offer Payload Creation (Complete)
15. **Prompt Chunk 15**: Supabase Storage Upload and Offer Sync (Complete)
16. **Prompt Chunk 16-24**: Progress, Validation, Error Tracking, Direct Publish (Complete)
17. **Prompt Chunk 25**: Mistral Free-Tier Rate-Limit-Safe OCR Queue and Progress (Complete)
18. **Prompt Chunk 32**: Delete Box and Background Page Cropping on Navigation (Complete)
20. **Prompt Chunk 35**: Raw Flexible Item OCR and Key Discovery Registry (Complete)
21. **Prompt Chunk 36**: Persistent Crop Layout Templates and Multi-Box Movement (Complete)
22. **Prompt Chunk 37**: Manual Crop Editor Fit-Page View and Compact UI (Complete)
23. **Prompt Chunk 38**: Template Browser Document-Navigator UI and Interactions (Complete)

Currently available screens:
- **Import**: Full metadata form with live "Preprocess PDF" execution, Full OCR Pipeline execution, Local Image Cropping, Wifran DB Import Tracking, Entity Matching, Offer Payload Preparation, and Final Offer Sync. Includes a global **Progress Timeline**.
- **Results**: Review structured rows, validation statuses, entity matches, and final offer syncs safely.
- **Logs**: Filterable secure logging stream mapping exactly to background event boundaries (PDF, OCR, Cropping, Prep, Sync).
- **Settings**: Live validation status of your environment configuration + Pipeline safety constraints reminders.

### Interpreting Row Statuses
- **Imported / Published**: Payload successfully mapped to `offers` safely. Valid rows may bypass drafts and become live automatically based on configuration.
- **Needs Review**: Final payload failed data quality heuristics or non-blocking warnings and requires human validation.
- **Error**: Hard aborts or validation gates blocking execution.
---

## 📦 Packaging for Windows

To build the executable installer for internal distribution:
```bash
npm run dist:win
```
The resulting `.exe` will be located in the `release/` folder.

---

## 📚 Documentation

Detailed guides are split by role:

### Operator Docs (For users running the App)
- **[Operator Setup Guide](./docs/operator/operator-setup-guide.md)**: How to install and configure `.env.local`.
- **[Operator User Guide](./docs/operator/operator-user-guide.md)**: Full workflow from PDF import to DB Sync.
- **[Troubleshooting Guide](./docs/operator/troubleshooting-guide.md)**: How to fix OCR limits, missing bounds, or network errors.

### Developer Docs (For contributors maintaining the codebase)
- **[Developer Setup Guide](./docs/developer/developer-setup-guide.md)**: Architecture, tests, and boundaries.
- **[Security Notes 🚨](./docs/developer/security-notes.md)**: CRITICAL rules about exposing `process.env` and DB IPCs.
- **[Packaging Notes](./docs/developer/packaging-notes.md)**: How electron-builder exclusions work.
- **[Pre-Release Checklist](./docs/operator/release-checklist.md)**: Required tests before sharing an `.exe`.
- **[Manual E2E Test Checklist](./docs/testing/manual-e2e-test-checklist.md)**: Deep functional testing workflow.
- **[Sample PDF Testing Guide](./docs/testing/sample-pdf-testing-guide.md)**: Methodology for testing Mistral extraction limits.

---

## ⚠️ Known Limitations & API Cost Guidance
- The extraction quality heavily depends on Mistral's current model capabilities and PDF leaflet layout design.
- **OCR Chunking**: Do not pre-crop product cards before OCR. Leaflet layouts are too irregular. Use small OCR chunks instead.
- **Large Leaflet Safe Defaults**: The app is configured for recall-first extraction. Default `OCR_CHUNK_SIZE=1`, `OCR_MAX_CONCURRENT_REQUESTS=1`, `OCR_MAX_RETRIES=5`, and `OCR_REQUEST_TIMEOUT_MS=180000`. This is slower but safer for 100-page / 1000-item leaflets.
- **API Payload Cost**: The app requests `include_image_base64: false` and explicitly asks the OCR prompt *not* to return prose, summaries, or large markdown strings. This minimizes token output cost and latency.
- **Mistral Free Tier**: If using the free tier, set `OCR_RATE_LIMIT_MODE='free_tier_safe'` to automatically enforce a sequential queue and 60-second rolling token budget that respects the 50k TPM limit. The UI will pause and wait if limits are nearing.
- **Troubleshooting Missed Items**: If items are missed, ensure `OCR_CHUNK_SIZE=1` is set.
- The app stores intermediate files locally if `DEBUG_SAVE_INTERMEDIATE_FILES=true` is set.
- **Debug Cost**: Raw debug payloads automatically strip huge base64 strings to prevent your hard drive from filling up.
- All secrets are managed locally via `.env.local`. Ensure installers do not bundle API keys!

## 🔐 Credentials
The operator normally only needs to fill:
- `MISTRAL_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
All other settings have safe defaults. Use `OCR_RATE_LIMIT_MODE='free_tier_safe'` to safely process massive documents on free accounts. Do not increase `OCR_CHUNK_SIZE` until several real leaflets have been tested. Increase concurrency before increasing chunk size if speed is needed. If rate-limit errors occur, keep chunk size 1 and reduce concurrency to 1.

## Entity Matching (Brands, Categories, Products)
Extracted strings from Mistral are piped sequentially through advanced fuzzy validation and normalization checks.
- **Manual Crop Layout Editor**: Interactive canvas tool to quickly split grids and crop product images manually without relying on AI vision models. Includes smart "Generate Grid" which automatically calculates Rows and Columns defaults based on the selected box size and available page space. Leftover margins smaller than a full box are ignored in calculation.
- **Brand-Specific Crop Templates**: Saved layout templates are automatically tied to the active leaflet's supermarket brand (e.g., Panda vs. Othaim). The template browser automatically filters to show only relevant templates for the current brand. Legacy or unassigned templates appear at the bottom.
- **Global Keyboard Shortcut for Layout Cycling**: Inside the manual crop editor, pressing the `*` key (asterisk or NumpadMultiply) instantly applies the next available saved template for the active brand. Successive presses cycle deterministically through all matching templates, allowing extremely rapid layout application.
- **Minimal OCR Schema**: Support for lightweight JSON schema validation.
- **Categories**: Validated by Arabic/English name or slug. Creation defaults to `false` for stricter schema protection.
- **Products**: Correlated primarily utilizing the `product_aliases` registry. Failing that, falls back to direct Product Name/Brand ID matches. Optionally created with dynamic aliases pushed automatically.

*Note*: Final product attachments update `import_rows.normalized_data` safely, but actual final consumer `offers` remain strictly guarded against.

## Import Tracking Persistence
The tool syncs exact pipeline outputs mapping directly to Wifran's raw tracking tables. Data is safely ingested into `offer_sources`, `import_batches`, `import_rows`, and `validation_errors`. The implementation aggressively chunks Supabase inserts (max 100 rows per transaction) to evade network limitations safely. 
- Final mapped product associations and final `offers` are strictly prohibited during this phase. 
- Raw API payloads, normalization mappings, and precise cropping dimensions are safely baked into JSONB DB payloads bridging the tracking barrier.

## Mistral OCR Status
The full pipeline is actively orchestrating PDF chunks concurrently! `p-limit` handles exact concurrency limits (e.g. max 3 parallel threads) mapped to your Mistral settings, with deep exponential backoff retries handling rate limits securely. No API keys are leaked to the renderer. 

## Local Image Cropping
Bounding boxes generated by Mistral are strictly normalized, clamped to real rendered PDF dimensions, padded dynamically (default `8%`), and extracted natively utilizing `sharp` on the C++ level.
- Invalid boxes emit `BOUNDING_BOX_TOO_LARGE` or `BOUNDING_BOX_OUT_OF_PAGE`.
- Banners and promotional areas tagged `NON_PRODUCT_PROMOTIONAL_AREA` are cleanly skipped, saving execution time and local disk space.
- Outputs are saved as exact `.jpg` representations directly inside the workspace `/crops/` folder.
*Note*: Supabase Storage uploading is still disabled.

## OCR Normalization & Promotional Filtering
This application integrates powerful zero-dependency string heuristics to pre-validate JSON payloads representing Extracted Offers, completely avoiding the Supabase Database if the extracted offers don't meet high structural demands.
**Promotional Banner Filtering** has been strengthened:
- **Skipped:** Generic `1+1` banners, `May 27 - June 02` date badges, `Sponsored by Lurpak` headers, and `عروض تزين عيدك` (campaign slogans without product details) are securely filtered out.
- **Preserved:** Real product offers like `حليب هايل 1+1` (1+1 milk) are retained securely.
You can execute `npm run validate:fixtures` to test how the Zod normalization suite handles different Mistral anomalies and correctly triggers `NON_PRODUCT_PROMOTIONAL_AREA` skips on fake products.

## PDF Preprocessing Notes
The application currently uses `pdf-lib` for reading and splitting PDFs, and `pdf2pic` to render pages to high-quality `.png` images.
**System Requirements for Windows**: `pdf2pic` requires [GraphicsMagick](http://www.graphicsmagick.org/) and [Ghostscript](https://ghostscript.com/releases/gsdnld.html) to be installed locally and available in your System PATH to successfully render images. If missing, the preprocessing will fail on the "Rendering pages" step.

## Security Note
File selection utilizes a very narrow, strictly typed IPC call that invokes the native OS `dialog.showOpenDialog` and filters explicitly for `.pdf` files. No generic filesystem access is exposed to the React renderer, and no arbitrary file reading is allowed.

## Troubleshooting Reference Data
If the Import page dropdowns are empty or the Settings page shows errors:
1. Ensure your `.env.local` contains valid `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. Check your network connection.
3. Ensure the Wifran database actually contains active rows (`is_active = true`) in the `supermarkets`, `cities`, `regions`, etc., tables.
