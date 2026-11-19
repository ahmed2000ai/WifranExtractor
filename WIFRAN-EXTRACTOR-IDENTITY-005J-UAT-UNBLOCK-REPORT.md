# WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-UNBLOCK-REPORT

**Milestone:** `WIFRAN-EXTRACTOR-IDENTITY-005J-FIX` — Targeted UAT Unblocking
**Repository:** `f:\Work\AI Projects\wifran-offers-extractor`
**Status:** Implemented and verified offline (`typecheck` exit 0; 8 offline Vitest suites / 86 tests passing; zero paid Gemini/Vertex calls; zero live database writes or migrations).

---

## 1. Modified & Added Files

| Layer | File | Summary of Changes |
|---|---|---|
| Shared Types | `src/shared/types/importForm.ts` | Extended `SelectedPdfFile` with `pageSelectionMode`, `pageSelectionInput`, `selectedPages`, `pageSelectionError` (`string \| null`). |
| Shared Types | `src/shared/types/batchExtraction.ts` | Added `PageSelectionMode`, `BatchApprovedScope`, `BatchManifest.approvedScope`, `LeafletBatchItem.pageSelectionMode/Input`, `UnifiedBatchOffer.sourceFileFingerprint`, and `BatchFilterOptions.sourcePage`. |
| Shared Types | `src/shared/types/catalogMatching.ts` | Added `MatchingRunManifest.matchingDatabaseContext` and `MatchingProposal.matchedDatabaseContext`. |
| Shared Utils | `src/shared/utils/pageRangeParser.ts` | Added `parseStrictBatchPageSelection(rawInput, totalPages)` rejecting empty, invalid, duplicate, and out-of-range page inputs. |
| Shared Utils | `src/shared/utils/nonCatalogPublicationPolicy.ts` | Updated `computeStableSourceOfferId` to anchor keys on `doc_<16hex>` FNV-1a/fingerprint document scopes instead of volatile batch-local `leaflet-001` IDs while honoring explicit `decomposedChildIndex`. |
| Shared Utils | `src/shared/utils/crossRetailerGrouping.ts` | Added `buildCrossRetailerGroups(offers, manifest)` producing `verifiedGroups`, `provisionalGroups`, and `unresolvedRows`. |
| Preload | `src/preload/index.d.ts` | Updated IPC type contracts for `batch.create`, `batch.start`, `batch.resume`, `matching.start`, and `matching.retryFailedOnly`. |
| Main / Metadata | `src/main/metadata/leafletMetadataService.ts` | Added `disableFilenameHints`, `pdfPath`, `sourceFileName`, and `allowCoverPageEvidence` to offline cover-page metadata discovery. |
| Main / IPC | `src/main/ipc/batchExtractionIpc.ts` | Forwarded per-PDF page-selection fields on `batch:create` and explicit Hybrid V3 / scope reauthorization flags on `batch:resume`. |
| Main / IPC | `src/main/ipc/catalogMatchingIpc.ts` | Added `targetDatabaseContext?: DatabaseContext` to `matching:start` and `matching:retryFailedOnly`, selecting `getGuardedSupabaseClient('DEVELOPMENT_TEST')` vs `getSupabaseAdminClient()`. |
| Main / Orchestration | `src/main/batch/batchOrchestrationService.ts` | Validated `pagesToProcess` strictly in `createBatch`; enforced `METADATA_VERIFICATION_REQUIRED` in `startBatchExtraction`; recorded `approvedScope`; passed `selectionMode: 'specific'` & `selectedPages` to `renderPdfPagesStreaming`; forwarded full PDF cover-page path offline in `applyPackageMetadataDiscovery`; enforced `HYBRID_V3_RESUME_AUTHORIZATION_REQUIRED` & `HYBRID_V3_SCOPE_EXPANSION_REAUTH_REQUIRED` in `resumeBatch`; exposed `sourceFileFingerprint` and `filters.sourcePage` in `getUnifiedBatchOffers`; added Windows transient `EPERM`/`EBUSY`/`EACCES` retry on `saveBatchManifestAtomic`. |
| Main / Matching | `src/main/batch/catalogMatchingOrchestrator.ts` | Added `databaseContext`, `devCacheService` (`new VerifiedMatchCacheService(undefined, 'development')`), and stamped `matchingDatabaseContext` / `matchedDatabaseContext` on deterministic, cache, and Gemini proposals. |
| Main / Publication | `src/main/db/catalogPublicationService.ts` | Added `DUPLICATE_SOURCE_OFFER_ID` and `CATALOG_ENVIRONMENT_MISMATCH` in `assessPublicationPreflight`; added `CATALOG_PRODUCT_IDENTITY_MISMATCH` guard when publishing matches whose effective DB context is missing or differs from the target publication context, while keeping `PRODUCTION_UI` blocked. |
| Renderer UI | `src/renderer/src/components/batch/MultiPdfSelector.tsx` | Added `evaluateSelectedFilePages` and per-PDF `Specific Pages` vs `All Pages` controls with inline validation, `"Pages Selected / Doc Total"`, and Hybrid V3 gated button label. |
| Renderer UI | `src/renderer/src/pages/ImportPage.tsx` | Updated Hybrid V3 batch flow to call `batch.create` + sequential offline `batch.discoverLeafletMetadata` and navigate to `BatchProgressDashboard` before paid extraction starts. |
| Renderer UI | `src/renderer/src/components/batch/BatchProgressDashboard.tsx` | Added pre-start Leaflet Metadata Verification panel, target scope/cost review, explicit unchecked Hybrid V3 + live API checkboxes, and interrupted Hybrid V3 Resume Authorization panel. |
| Renderer UI | `src/renderer/src/components/batch/UnifiedBatchPreview.tsx` | Added `Page:` (`selectedPageFilter`) filter dropdown and reset support. |
| Renderer UI | `src/renderer/src/components/batch/ProductMatchingReview.tsx` | Added Grouped Cross-Retailer View (`buildCrossRetailerGroups` + `renderCrossRetailerGroupCard`), independent per-retailer rows (`Retailer`, prices, dates, scope, page/source ID), Crop Evidence Inspection Modal (`inspectCropOffer`), `Catalog Matching Reference DB` selector, `allowExpiredForDevTest` toggle for `DEVELOPMENT_TEST`, and `CATALOG_ENVIRONMENT_MISMATCH` warning banner. |
| Tests | `src/main/batch/__tests__/uatUnblock005j.test.ts` | Added end-to-end offline regression coverage for multi-PDF page selection, offline discovery, metadata gate, selective rendering/extraction, resume safety, cross-retailer grouping, collision-resistant `source_offer_id`, and cross-DB publication safety. |
| Tests | `src/renderer/src/components/batch/__tests__/batchUi005j.test.tsx` | Added jsdom UI component tests for `MultiPdfSelector` per-PDF validation and `ProductMatchingReview` Grouped Cross-Retailer View, Crop Modal, and `CATALOG_ENVIRONMENT_MISMATCH` warning. |
| Tests | `src/main/ocr/__tests__/hybridV3EndToEndIntegration005i.test.ts` | Updated the Hybrid V3 cancellation/resume test to verify leaflet metadata before `startBatchExtraction` under the new mandatory `METADATA_VERIFICATION_REQUIRED` gate. |

---

## 2. Targeted Fixes by UAT Requirement

### 2.1 Independent Per-PDF Page Selection & Selective Rendering/Extraction
- `parseStrictBatchPageSelection(rawInput, totalPages)` rejects empty input, non-numeric tokens, zero/negative numbers, duplicate page numbers (including overlapping ranges such as `2-4, 3`), and out-of-bounds pages.
- `MultiPdfSelector.tsx` defaults Hybrid V3 files to `Specific Pages` with per-file `"Pages Selected / Doc Total"` summary and disables batch creation when any file has an invalid or empty selection.
- `batchOrchestrationService.createBatch` validates `pagesToProcess` fail-closed (`INVALID_PAGE_SELECTION`), computes `totals.totalPages` strictly from target pages (e.g., 6 pages across 3 PDFs rather than 30), and `startBatchExtraction` passes `selectionMode: 'specific'` and `selectedPages` to `renderPdfPagesStreaming` so unselected pages are neither rendered nor extracted.

### 2.2 Offline Cover-Page Metadata Discovery & Explicit Pre-Start Gates
- Hybrid V3 batch submission in `ImportPage.tsx` creates the batch (`batch:create`) and runs sequential offline `batch:discoverLeafletMetadata` on full PDF paths with `disableFilenameHints: true` and `allowCoverPageEvidence: true`, allowing cover-page date/retailer discovery even when page 1 is excluded from paid extraction.
- `startBatchExtraction` rejects Hybrid V3 execution with `METADATA_VERIFICATION_REQUIRED` unless every leaflet's metadata is verified.
- `BatchProgressDashboard.tsx` requires explicit unchecked operator confirmation for both Hybrid V3 activation and live API expenditure before invoking `batch:start`.

### 2.3 Resumption Safety & Scope Preservation
- `resumeBatch` rejects Hybrid V3 resumes without explicit `hybridV3ExplicitAuthorization` (`HYBRID_V3_RESUME_AUTHORIZATION_REQUIRED`), preserves each leaflet's `pagesToProcess`, never auto-flips `hybridV3LiveAuthorized` to `true`, and fails closed with `HYBRID_V3_SCOPE_EXPANSION_REAUTH_REQUIRED` if target pages expanded beyond `approvedScope.pagesByLeafletId` without `reauthorizeExpandedScope`.

### 2.4 Cross-Retailer Product Reconciliation, Grouped View & Crop Modal
- `buildCrossRetailerGroups(offers, manifest)` collapses matching offers across retailers under one verified catalog card (`Catalog #<id>`) or provisional group (`Provisional: <tempId>`), preserving each retailer's own promo price, original price, validity dates, geographic scope, source page, `sourceOfferId`, and crop paths while isolating unresolved/ambiguous items in Tab 3.
- `ProductMatchingReview.tsx` defaults to **Grouped Cross-Retailer View**, supports one-click `Approve All Offers` / `Reject All` as well as per-retailer decisions, renders a **View Crop** inspection modal displaying offer card and product thumbnail crops (`local-file://get?path=...`), and `UnifiedBatchPreview.tsx` provides a `Page:` (`sourcePage`) filter.

### 2.5 Collision-Resistant `source_offer_id`, Duplicate Preflight & Environment Identity Safety
- `computeStableSourceOfferId` anchors structured and legacy IDs on `doc_<16hex>` derived from `sourceFileFingerprint` (avoiding `leaflet-001` cross-batch collisions while preserving repeat-import idempotency and distinct `:sNN` multi-product children).
- `assessPublicationPreflight` blocks batches containing duplicate resolved `source_offer_id` entries (`DUPLICATE_SOURCE_OFFER_ID`) and blocks publishing `PRODUCTION_UI`-matched proposals into `DEVELOPMENT_TEST` (`CATALOG_ENVIRONMENT_MISMATCH`).
- `publishApprovedCatalogBatch` keeps `PRODUCTION_UI` writes strictly blocked and applies the `CATALOG_PRODUCT_IDENTITY_MISMATCH` guard when a match lacks matching-environment provenance (`effectiveMatchedContext !== context`), rolling back safely on mismatch.

---

## 3. Verification Results (Post-Final-Edit, Offline Only)

All checks below ran after the final code edit, with **zero live Gemini/Vertex API requests** and **zero live Supabase writes or migrations**.

1. **TypeScript Typecheck:**
   - Command: `npm run typecheck` (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`)
   - Result: **Exited with code 0** (0 errors across main, preload, shared, and renderer).

2. **Offline Vitest Regression & UI Suite (8 test files, 86 tests):**
   - Command: `npx vitest run src/main/batch/__tests__/uatUnblock005j.test.ts src/renderer/src/components/batch/__tests__/batchUi005j.test.tsx src/shared/utils/__tests__/pageRangeParser.test.ts src/main/batch/__tests__/batchOrchestration.test.ts src/main/ocr/__tests__/hybridV3EndToEndIntegration005i.test.ts src/main/db/__tests__/environmentIsolation.test.ts src/main/db/__tests__/prePublishApprovalDbGate.test.ts src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx`
   - Result: **8 passed test files, 86 passed tests (0 failed, 0 skipped)**:
     - `src/main/batch/__tests__/uatUnblock005j.test.ts` — 6 tests passed
     - `src/renderer/src/components/batch/__tests__/batchUi005j.test.tsx` — 2 tests passed
     - `src/shared/utils/__tests__/pageRangeParser.test.ts` — 22 tests passed
     - `src/main/batch/__tests__/batchOrchestration.test.ts` — 13 tests passed
     - `src/main/ocr/__tests__/hybridV3EndToEndIntegration005i.test.ts` — 4 tests passed
     - `src/main/db/__tests__/environmentIsolation.test.ts` — 14 tests passed
     - `src/main/db/__tests__/prePublishApprovalDbGate.test.ts` — 9 tests passed
     - `src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx` — 16 tests passed

3. **Default Safety Flags Confirmed Unchanged:**
   - `HYBRID_EXTRACTION_DEFAULT_FLAGS.enabledByDefault` remains `false` (verified by `hybridV3EndToEndIntegration005i.test.ts`).
   - Direct `PRODUCTION_UI` publication remains blocked fail-closed (verified by `environmentIsolation.test.ts` and `uatUnblock005j.test.ts`).
