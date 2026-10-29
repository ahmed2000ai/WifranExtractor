# Chunk 40 Current OCR Pipeline Inspection Report

## Executive Summary
This report summarizes the inspection of the existing OCR extraction pipeline in `wifran-offers-extractor` to prepare for the accuracy upgrade package. The tool currently handles manual crop definition, passes cropped images to Mistral for OCR extraction, performs minor normalization, and pushes results directly into Supabase Storage and DB. We identified gaps mainly around strict single-pass extraction causing accuracy issues, the absence of a proper human pre-publish approval gate, and missing deterministic comparison safety metadata.

## Current Project Structure Relevant to OCR and Publishing
- `src/main/ocr/`: Contains Mistral OCR integrations, prompts, rate-limit logic.
- `src/main/workflow/`: Contains pipeline logic (e.g. `cropAndItemOcrWorkflow.ts`).
- `src/main/extraction/`: Contains the manifest tracking for the extraction session.
- `src/main/storage/`: Contains Supabase image upload (`offerImageStorageService.ts`).
- `src/main/db/`: Contains offer DB syncing, normalization, duplicate checks, etc.
- `src/shared/schemas/` & `src/shared/utils/`: Contains JSON schemas and normalizers.
- `src/renderer/src/pages/`: Contains the UI (ImportPage, ResultsPage).

## Current Mistral Integration
- **File path**: `src/main/ocr/mistralOcrProvider.ts`, `src/main/ocr/itemImageOcrService.ts`
- **Model**: `mistral-large-2512` is used for Chat Completions (Vision), and `mistral-ocr-latest` for strict layout/document endpoint.
- **Provider logic**: `mistralOcrProvider.ts` calls `https://api.mistral.ai/v1/chat/completions`.
- **Parsing**: Responses are parsed as `json_object` format.
- **Retry Logic**: Explicit retry block catching 429 and `Retry-After` headers via backoff in `callPixtralVision` and the rate limit queue.

## Current Crop-Level Prompt
- **File path**: `src/main/ocr/itemImageOcrPromptBuilder.ts`
- **Function**: `buildItemImageOcrPrompt(itemNumber: string)`
- **Current Prompt Summary**: The current prompt explicitly tells the model to read a cropped image and return "only valid JSON matching the exact schema". It inserts `{itemNumber}` directly. It does NOT ask for candidates, visual evidence, or confidence. It forces the model to decide the final values directly (e.g., offer price vs original price), leading to known issues like mistaking sizes for prices (e.g. 1.5L becoming a price). It explicitly maps stylized Saudi numbers.

## Current EXPECTED JSON SCHEMA Handling
- **File path**: `src/shared/schemas/itemOcrSchema.ts`, `src/main/ocr/itemImageOcrPromptBuilder.ts`
- **Schema Source**: Returns a basic `json_schema` object for Mistral's response format. The strict schema definitions actually exist as Zod schemas (e.g., `ocrSchema.ts`).
- **Flexible Fields**: The current tool also has a registry logic (`ocrReturnedKeysRegistryService.ts`) to discover dynamically returned keys, meaning the schema is somewhat loosely enforced in the application code, but strict in validation.
- **Support for Upgrade**: It currently does NOT support `price_candidates`, `size_candidates`, `visual_evidence`, or `warnings`.

## Current Item OCR Workflow
- **File path**: `src/main/workflow/cropAndItemOcrWorkflow.ts`
- **Logic**: It spins up a producer/consumer queue. Crops are discovered from manual layouts (`manual-crop-layout.json`).
- **Pairing**: `jsonPath` is defined as `workspacePath/json/{pageDir}/{cropName}.json`. Crop images and JSON files are generated sequentially. The pipeline handles saving raw OCR json immediately.

## Current Mistral Rate-Limit Queue
- **File path**: `src/main/ocr/ocrRateLimitQueue.ts`
- **Class**: `OcrRateLimitQueue`
- **Logic**: Tracks TPM (Tokens Per Minute) and RPM (Requests Per Minute) with a sliding window. It handles `retry_after`.
- **Shared capability**: The queue is currently used for OCR requests, but could be shared. It exposes a generic `waitBeforeNextRequest` which makes it ideal to wrap into a global Mistral queue for all types of calls (extraction, style profile, validation).

## Current Extraction Package and Manifest Logic
- **File path**: `src/main/extraction/extractionManifestService.ts`
- **Structure**: Uses `Extracts/{leaflet_name}/` with subfolders for `crops/`, `json/`, `chunks/`, `pages/`, etc.
- **Manifest**: Tracks stages (e.g., `item_ocr`, `db_update`), total counts, validation warnings.
- **Completion**: `markExtractionCompleted` is called after OCR workflow finishes. However, DB updates run automatically if auto-run is enabled via `ImportPage`.

## Current JSON Output and Raw OCR Storage
- Raw JSON is successfully written to `json/` directory matching crop names. The app does not lose raw OCR payload prior to normalization.

## Current Normalization / Parsing
- **File path**: `src/shared/utils/ocrNormalization.ts`
- **Functions**: `normalizeOcrExtractionResponse`, `parsePrice`, `normalizePackUnit`.
- **Logic**: It handles parsing price fields and categorizing missing prices as warnings. It does rudimentary de-duplication based on Levenshtein distance.
- **Gap**: It is limited and missing safety classification (no size-as-price checks, no old-price checks, no legacy field mapper for the upgraded schema).

## Current Validation and Publish Gates
- **File path**: `src/main/db/offerPreparationService.ts`, `src/shared/utils/ocrNormalization.ts`
- **Logic**: A promotional area filter (`classifyPromotionalArea`) skips non-product areas. Errors are thrown for missing required fields (like `MISSING_OFFER_PRICE`).
- **Status Assignment**: Offers are assigned `published` or `needs_review` based on validation results, but there is no intermediary human gate enforcing visual review before Supabase sync.

## Current Comparison Metadata Support
- No structural DB or extraction support exists for `comparison_eligible`, `comparison_unit`, `comparison_unit_price`, or `comparison_exclusion_reason`. This represents a large gap.

## Current Supabase Storage Upload
- **File path**: `src/main/storage/offerImageStorageService.ts`, `src/main/storage/storagePathBuilder.ts`
- **Bucket/Path**: `offer-images/{supermarketSlug}/{coverageScope}/{locationSlug}/{leafletId}/{itemNumber}.{ext}`
- **Logic**: Upload happens right before DB sync inside the `offerSyncService`. Failure to upload can fallback to `needs_review` if configured.

## Current Supabase DB Upsert
- **File path**: `src/main/db/offerSyncService.ts`
- **Logic**: Upserts to `offers`, handles `import_rows`, and maps items via `mapPreparedPayloadToOffersInsert`. It processes duplicates by skipping them if an `importRowId` is already matched.
- **Immediate Sync**: `ImportPage.tsx` currently triggers the pipeline which cascades directly into DB sync if there are no blocking errors. This violates the Pre-Publish Preview gate requirement.

## Current Import Page Button Flow
- **File path**: `src/renderer/src/pages/ImportPage.tsx`
- **Logic**: Sequential buttons from "Select PDF" -> "Run Preprocessing" -> "Run OCR Pipeline". The automation cascades automatically. DB update happens automatically under `autoRun` if configured to do so. A "Proceed to DB Update" also exists in the `PreDbReviewSummary` component.

## Current Results / Review / Preview UI
- **File path**: `src/renderer/src/pages/ResultsPage.tsx`, `src/renderer/src/components/review/PreDbReviewSummary.tsx`
- **Logic**: There is a `ResultsPage` to view rows, and `PreDbReviewSummary` which lists extracted results. However, this is NOT a visual grid comparison of the crop vs extracted fields (Pre-Publish Preview). It currently acts as a dry review table.

## Current Reporting
- **File path**: Summaries are tracked in context and `flexible-item-ocr-summary.json`. `ResultsPage.tsx` visualizes total counts, warnings, errors, and skips.
- **Gap**: Missing `accuracy-run-report.json` and `pre-publish-preview-summary.json`.

## Current Tests and Fixtures
- Tests exist primarily in the `__tests__` directories of some modules but there are no specific regression fixtures for the known accuracy edge cases (like 1.5L vs 1.51 price, 8x135g vs offer price).

## Gap Analysis Against Accuracy Upgrade Package

| Upgrade Requirement | Current Support | Existing File(s) | Gap | Recommended Future Chunk |
|---|---|---|---|---|
| candidate-based extraction prompt | No | `itemImageOcrPromptBuilder.ts` | Prompt only extracts final fields, no candidates. | 41 |
| visual evidence fields | No | `itemOcrSchema.ts` | Not requested or parsed. | 41 |
| strict candidate schema | No | `itemOcrSchema.ts` | Uses flexible map rather than strict candidate properties. | 41 |
| legacy field mapper | No | N/A | Need mapper to merge old JSON output formats. | 42 |
| canonical offer normalizer | Partial | `ocrNormalization.ts` | Exists but very simple. Lacks complex price/size logic. | 42 |
| shared Mistral rate-limit queue | Partial | `ocrRateLimitQueue.ts` | Exists but tied mainly to OCR extraction. Needs global wrapper. | 43 |
| style profile generation | No | N/A | No layout-aware style analysis module. | 44 |
| style-aware validation call | No | N/A | No validation-specific Mistral prompt/call exists. | 45 |
| deterministic price/size checks | No | `offerPreparationService.ts` | Basic missing price checks. No size-as-price trap detection. | 46 |
| comparison-safety logic | No | N/A | No comparison fields generated or passed. | 47 |
| publish decision engine | Partial | `offerPreparationService.ts` | Assigns published/needs_review, lacks `publish_but_exclude_from_comparison`. | 47 |
| preview approval gate before DB upload | No | `ImportPage.tsx` | DB upload runs without explicit visual grid review. | 48 |
| Pre-Publish Preview grid | Partial | `PreDbReviewSummary.tsx` | Missing visual grid of images next to extracted data. | 48 |
| regression fixtures | No | N/A | No systematic testing for known failures. | 49 |
| accuracy-run-report.json | No | N/A | No dedicated accuracy report generated. | 49 |
| Supabase metadata preservation | Partial | `offerSyncMapper.ts` | Maps some fields but lacks new accuracy metadata. | 50 |

## Recommended Implementation Order for Chunks 41–50
The existing codebase structure supports the tentative plan very well. There are no major roadblocks.
1. **41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md**: Update the prompt and schema builder safely.
2. **42-canonical-offer-normalizer-and-legacy-field-mapper.md**: Refactor `ocrNormalization.ts`.
3. **43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md**: Upgrade `ocrRateLimitQueue.ts`.
4. **44-adaptive-style-profile-generation.md**: Add new module in `src/main/ocr/`.
5. **45-style-aware-validation-call-for-every-item.md**: Add new validation step before saving final row JSON.
6. **46-deterministic-price-size-and-publishing-sanity-checks.md**: Add checks into the normalizer/prep service.
7. **47-comparison-safety-and-publish-decision-engine.md**: Add new fields and update `offerPreparationService`.
8. **48-pre-publish-preview-and-human-publish-approval-gate.md**: Disconnect DB sync from extraction auto-run in `ImportPage` and implement new preview UI.
9. **49-accuracy-run-report-and-regression-fixtures.md**: Finalize manifest logging.
10. **50-supabase-metadata-mapping-for-extraction-quality.md**: Update DB mappers.

## Files That Should Be Preserved
- `src/main/image/manualCropService.ts` & `src/main/image/itemImageCropper.ts`
- `src/main/storage/offerImageStorageService.ts`
- `src/main/ocr/mistralOcrProvider.ts`
- `src/main/db/offerSyncService.ts`

## Files That Should Be Extended
- `src/main/ocr/itemImageOcrPromptBuilder.ts`
- `src/shared/schemas/itemOcrSchema.ts`
- `src/shared/utils/ocrNormalization.ts`
- `src/main/db/offerPreparationService.ts`
- `src/renderer/src/pages/ImportPage.tsx`
- `src/main/ocr/ocrRateLimitQueue.ts`

## Files That May Need New Modules
- New style profile generator (`styleProfileBuilder.ts` / `styleProfileProvider.ts`).
- New Pre-Publish Preview components (`PrePublishPreview.tsx`).
- New regression tests setup under `__tests__`.

## Risks and Open Questions
- **DB Sync Decoupling**: If `ImportPage.tsx` relies heavily on reactive hooks mapping pipeline states (e.g. `cropResult -> dbPersist`), breaking this apart for the Pre-Publish gate will require careful adjustment of the `PipelineContext` state machine to pause at `review_pending`.
- **Tokens/Costs**: Validating every item with a second Mistral call will double extraction time and TPM usage. The `ocrRateLimitQueue` will definitely be tested at scale.

## Final Notes
The existing architecture cleanly separates extraction from normalization and sync. We can inject the new layers (normalizer upgrade, validation call, comparison safety) immediately after OCR completion and before DB sync with minimal disruption.
