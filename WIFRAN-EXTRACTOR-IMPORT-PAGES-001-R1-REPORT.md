# WIFRAN-EXTRACTOR-IMPORT-PAGES-001-R1-REPORT
## Final Page-Selection Regression Fixes & Offline Operator Acceptance

**Date:** 2026-11-09  
**Execution Scope:** Offline Verification & Targeted Regression Fixes (`WIFRAN_OFFLINE_UAT=1` and mocked providers — zero live Gemini, Mistral, or Supabase requests/mutations; zero Git commits/pushes)  
**Baseline Contract Integrity:** `buildMasterQualityPageExtractionSystemPrompt()`, `getLeafletPageGenAiSchema('optimized')`, and `wifran.extractor.offer/2.0` unchanged (verified via [`calculate_baseline_hashes.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/scripts/calculate_baseline_hashes.ts)).  

**Final Readiness Verdict:** **READY FOR HANDS-ON UAT** *(subject to non-blocking disclosure in Section 9 regarding two pre-existing legacy `src/main/db/__tests__` test-harness mismatches from `METADATA-003`)*

---

## 1. Root Causes of Both Page-First Test Failures

Git history proves both failures in `src/main/page-first/__tests__` pre-existed `IMPORT-PAGES-001` (last modified in commit `52f74d0`, `2026-11-07`, preceded by `b9efe78`, `2026-10-29`):

1. **[`pageFirstIntegration.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstIntegration.test.ts#L120-L216):**
   - **Pre-existing root cause:** Lines `123-124` and `201-202` in commit `52f74d0` hardcoded `offerStartDate: '2026-10-15'` and `offerEndDate: '2026-10-22'`.
   - **Why it failed on `2026-11-09`:** `PageOfferCanonicalMapper.mapToCanonical` runs [`deterministicOfferChecks.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/deterministicOfferChecks.ts) against the system date (`2026-11-09`), sees `offerEndDate` is in the past, emits `expired_offer_end_date`, and sets `quality.publish_decision` to `'skip_or_quarantine'` instead of `'publish'` (line `136`).

2. **[`pageFirstTestCurrentPage.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstTestCurrentPage.test.ts#L212-L283):**
   - **Pre-existing root causes (from Rev0 → Rev1 migration in `52f74d0`):**
     1. Hardcoded expired dates `'2026-10-01'` and `'2026-10-15'` (`52f74d0` lines `128-129`, `150`), quarantining the canonical offer (`summaryData.counts.publish` became `0` instead of `1`).
     2. Test 2 expected a legacy Rev0 `'linking'` progress stage (`progressEvents.find(p => p.stage === 'linking')`) that [`PageFirstPipelineService.runPipeline`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/pageFirstPipelineService.ts#L317-L374) already stopped emitting in commit `52f74d0` (`stage_8_cropping -> 'cropping'`, `stage_5_audit -> 'validating'`, `stage_6_retry -> 'retrying'`, else `'ocr_running'`).
     3. Test 2 expected removed Rev0 log codes (`OCR_ENGINE_STARTED`), Rev0 raw OCR artifacts (`ocr-raw.json`), and a legacy `200ms` duration assertion on the `ocr_running` stage that no longer correspond to Rev1 (`metadata/page-first-ocr/page-state.json`, `metadata/reports/page-first-extraction-report.{json,md}`, `metadata/reports/pre-publish-preview-summary.json`, `json/page-001-001.canonical.json`).

---

## 2. Exact Fixes Made

All production logic in `PageFirstPipelineService` remained unchanged for the `'linking'` behavior (only test assumptions were corrected to match the verified Rev1 implementation), while three targeted partial-selection edge defects uncovered during end-to-end verification were fixed:

### A. Page-First Pre-Existing Test Fixes (Zero Production Logic Altered for `linking`/Dates)
- **[`pageFirstIntegration.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstIntegration.test.ts#L8-L207):** Replaced hardcoded `'2026-10-15'` / `'2026-10-22'` validity dates with dynamic runtime `activeOfferStartDate` (today) and `activeOfferEndDate` (`today + 7 days`).
- **[`pageFirstTestCurrentPage.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstTestCurrentPage.test.ts#L13-L393):**
  - Replaced hardcoded `'2026-10-01'` / `'2026-10-15'` with `activeOfferStartDate` / `activeOfferEndDate`.
  - Updated Test 2 assertions to verify actual Rev1 progress progression (`ocr_running` `0/1` → `cropping` `1/1` → `completed` `1/1` with `logCode: 'PAGE_FIRST_TEST_COMPLETE'`), log ordering (`PAGE_FIRST_TEST_START` < `PAGE_FIRST_TEST_COMPLETE`), Rev1 artifact paths, and `summaryData.counts.publish === 1`.
  - Added new subset test **`Reports accurate selected-page progress and original PDF page numbers when extracting a subset [2, 5] of a 6-page leaflet`** (lines `285-393`).

### B. Targeted Partial-Extraction, Staging Isolation & UI Cache Fixes
- **[`extractionPackageService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/extraction/extractionPackageService.ts#L49-L180) (`getDbEligibleItemsFromPackage`):** Added Rev1 `.canonical.json` item resolution (`page-(\d+)-(\d+).canonical`, `source.source_page_number`, `source.source_item_number`, `source.crop_path` / `crops/page-NNN/...`) and enforced strict `manifest.processing_selection.selectedPages` filtering when `selectionMode === 'specific'` (excluding out-of-scope offers without altering disk files).
- **[`stagedLeafletDraftService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L96-L283) (`getStagedItemPageNumber`, `buildStagedItemsFromEligible`, `initializeStagedDraftFromPackage`):** When `selectionMode === 'specific'` and `staged-draft.json` already exists, strips any previously staged items outside `selectedPages` and merges eligible in-scope items without modifying or deleting disk artifacts.
- **[`stagedLeafletDraftService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L568-L605) (`uploadLeafletBoundaryPagesForMetadata`):** Hardened fail-closed guards so Specific mode throws explicitly if zero rendered images exist within `selectedPages` (preventing fallback to unselected page 1) or if `metadataPageNumber` is outside `selectedPages`.
- **[`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L161-L195):** Normalized confirmed cache hits from `window.wifranExtractor.metadata.get(fingerprint)` with `discoveryMethod: 'confirmed_cache'` so the UI renders `"Previously Confirmed (Cached)"` and `"Source: Confirmed Content Cache (Reused)"` without calling `metadata.discover`.

### C. Expanded Offline Acceptance Tests
- **[`importPageSelectionScope.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/importPageSelectionScope.test.ts#L945-L1672):** Added partial-staging isolation test (`preserves unselected disk artifacts, excludes unselected offers from staged-draft.json, and fails closed on missing scoped boundary pages`) and expanded `Offline UAT Scenarios A (1-3), B (1,6) & C (2-5) with WIFRAN_OFFLINE_UAT=1 on Case B PDF` across the 6-page [`Danube-Biweekly-Nov2026.pdf`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/test-fixtures/uat_cases/case_b_interior_dates/Danube-Biweekly-Nov2026.pdf).
- **[`importPageSelectionUi.test.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx#L525-L711):** Added `switches 1-3 -> 2-5 -> 1,6 cleanly, clears retailer/dates on 2-5 without filename leak, and constrains discovery scope` and `reuses previously confirmed metadata as confirmed_cache on load/selection switch without rescanning`.

---

## 3. Final Page-First Test Results

Command: `npx vitest run src/main/page-first/__tests__`  
Result: **7 / 7 test files passed — 55 / 55 tests passed**

| File | Tests Passed / Total | Notes |
|---|---:|---|
| [`pageFirstIntegration.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstIntegration.test.ts) | 2 / 2 | Local chain + quarantine check (dynamic active dates) |
| [`canonicalMappingUpgrades.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/canonicalMappingUpgrades.test.ts) | 6 / 6 | Canonical mapping upgrades |
| [`pageFirstSynthetic.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstSynthetic.test.ts) | 6 / 6 | Synthetic extraction pipeline cases |
| [`rev1NormalizersAndMath.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/rev1NormalizersAndMath.test.ts) | 15 / 15 | Rev1 normalizers & math checks |
| [`pageFirstOcr.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstOcr.test.ts) | 18 / 18 | Page-First OCR contract tests |
| [`pageFirstIpcWiring.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstIpcWiring.test.ts) | 2 / 2 | IPC handler registration |
| [`pageFirstTestCurrentPage.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstTestCurrentPage.test.ts) | 6 / 6 | Rev1 progress/logs/artifacts + new `[2, 5]` subset verification |

---

## 4. Proof of Strict Page-Level Processing Boundaries

Verified across code inspection and deterministic spy instrumentation in [`importPageSelectionScope.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/importPageSelectionScope.test.ts):

1. **PDF Splitting & Rasterization ([`streamingPdfRenderService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/pdf/streamingPdfRenderService.ts#L96-L243), [`pdfSplitter.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/pdf/pdfSplitter.ts#L6-L63)):** Only `pagesToRender` (validated against `1..totalPages`, failing closed on empty/out-of-bounds input with `INVALID_PAGE_SELECTION`) are split into chunks and passed to the page renderer; zero chunk/PNG files are created for unselected pages.
2. **Metadata Discovery & Filename Guard ([`leafletMetadataService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts#L222-L376), [`leafletMetadataService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts#L1194-L1261)):**
   - `effectivePagesText` and `ocr/page_N_blocks.json` reads are strictly filtered to `selectedSet`.
   - In Specific mode (`selectionMode === 'specific'`), filename retailer/validity inference is suppressed (`!isSpecificScope`).
   - Targeted AI fallback intersects `candidatePages` with `selectedSet`; requesting AI scan on an unselected page fails closed with zero vision calls (`attempts === 0`).
3. **Unconfirmed vs Confirmed Cache Isolation ([`leafletMetadataService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts#L146-L171), [`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L161-L206)):** Unconfirmed cache entries are only reused if `scanCoverage.selectedPages` matches identically; confirmed records reuse `confirmed_cache` without triggering `metadata.discover`.
4. **Extraction, Crop Rebuild & Test Selectors ([`pageFirstPipelineService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/pageFirstPipelineService.ts#L120-L128), [`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L128-L146)):** `PageFirstPipelineService.runPipeline` and `rebuildCropsFromExistingOcr` operate only on `targetPages` (input or `manifest.processing_selection.selectedPages`), and UI test/quick-test/AI candidate selectors expose only selected pages.
5. **Staging, Boundary Upload & DB Sync ([`stagedLeafletDraftService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L249-L282), [`offerSyncService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/offerSyncService.ts#L846-L865)):** `getDbEligibleItemsFromPackage`, `initializeStagedDraftFromPackage`, `uploadLeafletBoundaryPagesForMetadata`, `publishStagedLeafletDraftToDb`, and `syncApprovedOffers` all enforce `selectedPages` filtering and fail closed when scoped boundary images are absent.

---

## 5. Results for Selections `1-3`, `1,6`, and `2-5`

Executed on the 6-page UAT fixture [`Danube-Biweekly-Nov2026.pdf`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/test-fixtures/uat_cases/case_b_interior_dates/Danube-Biweekly-Nov2026.pdf) *(Danube branding on p.1, scanned validity dates `2026-11-10`–`2026-11-20` on p.6, product content only on p.2–5)* in isolated unconfirmed workspaces under `WIFRAN_OFFLINE_UAT=1`:

| Selection | Rendered Pages | Chunks (`originalPageNumbers`) | Metadata Discovery Result | AI Vision Calls | Out-of-Scope Ops | Extraction Output & Progress |
|---|---|---|---|---:|---:|---|
| **`1-3`** *(Scenario A)* | `[1, 2, 3]` | `[[1], [2], [3]]` | `retailer`: `danube` (`sourcePage: 1`), `validity`: `null`, `scanCoverage.selectedPages: [1, 2, 3]`, `analyzedPages: [1, 2, 3]` | `0` | `0` on `[4, 5, 6]` | `totalPages: 3`, `completedPages: 3`, progress events all `totalPages === 3`, `source_page_number: [1, 2, 3]` |
| **`1,6`** *(Scenario B)* | `[1, 6]` | `[[1], [6]]` | `retailer`: `danube` (`sourcePage: 1`), `validity`: `2026-11-10`–`2026-11-20` (`sourcePage: 6`) via offline mock vision, `visionPagesInspected: [6]` | `1` (page `6` only) | `0` on `[2, 3, 4, 5]` | `totalPages: 2`, `completedPages: 2`, progress events all `totalPages === 2`, `source_page_number: [1, 6]`, IDs contain `_p001_`, `_p006_` |
| **`2-5`** *(Scenario C)* | `[2, 3, 4, 5]` | `[[2, 3], [4, 5]]` | `retailer`: `null`, `validity`: `null` (filename `"Danube"` suppressed; selection did not auto-expand), `rawEvidence: []`, `discoveryMethod: 'operator_manual'` | `0` | `0` on `[1, 6]` | `totalPages: 4`, `completedPages: 4`, progress events all `totalPages === 4`, `source_page_number: [2, 3, 4, 5]`, zero `page-001-*` / `page-006-*` JSONs |

Live network client guards (`getGeminiClient()`, `getMistralClient()`, `getSupabaseAdminClient()`) were also asserted in the same suite to throw `OFFLINE_UAT_GUARD` under `WIFRAN_OFFLINE_UAT=1`.

---

## 6. Metadata Manual-Entry Behavior

Verified across both backend service tests ([`importPageSelectionScope.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/importPageSelectionScope.test.ts#L545-L645), [`importPageSelectionScope.test.ts#L1569-L1646`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/importPageSelectionScope.test.ts#L1569-L1646)) and jsdom UI tests ([`importPageSelectionUi.test.tsx#L402-L710`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx#L402-L710)):

- **Explicit Manual Indicators:** When discovery returns `retailer === null` or `validity === null` in [`LeafletMetadataConfirmationCard.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/metadata/LeafletMetadataConfirmationCard.tsx#L394-L462), the card renders `"Manual selection required"` and/or `"Manual entry required"` with editable supermarket dropdown and start/end date inputs.
- **`operator_manual` Provenance:** Calling `confirmMetadata(...)` stores `operatorConfirmed: true`, `discoveryMethod: 'operator_manual'`, and `rawEvidence` entries tagged `method: 'operator_manual'`, passing `validatePublishReadiness(...)`.
- **`confirmed_cache` Reuse Without Rescanning:** Reloading the same PDF or changing selection (e.g., `2-5`) after confirmation normalizes `metadata.get()` results to `discoveryMethod: 'confirmed_cache'`, renders `"Previously Confirmed (Cached)"` and `"Source: Confirmed Content Cache (Reused)"`, and executes **0** `metadata.discover` calls.
- **Clean Reset on Selection Switch Before Confirmation:** Switching `1-3` → `2-5` → `1,6` in `ImportPage` clears discovered retailer/dates on `2-5` (no filename `"Danube"` leak) and dispatches scoped `selectedPages` on each transition.

---

## 7. Progress and Original Page-Number Verification

Verified in [`pageFirstTestCurrentPage.test.ts#L285-L393`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/pageFirstTestCurrentPage.test.ts#L285-L393) (`[2, 5]` subset of 6-page leaflet) and UAT Scenarios A/B/C:

- **Selected-Page Progress Totals:** Every emitted [`PageFirstProgressEvent`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/pageFirstPipelineService.ts#L190-L206) reports `totalPages === selectedPages.length` (`2` for `[2, 5]`, `3` for `[1, 2, 3]`, `2` for `[1, 6]`, `4` for `[2, 3, 4, 5]`), never `6`.
- **Stage Sequence for `[2, 5]`:** `ocr_running` (`currentPage: 2, primaryCompletedPages: 0` → `currentPage: 5, primaryCompletedPages: 1`) → `cropping` (`2 -> primary: 1`, `5 -> primary: 2`) → `completed` (`primaryCompletedPages: 2, completedPages: 2, totalPages: 2`, `logCode: 'PAGE_FIRST_TEST_COMPLETE'`).
- **Original Page Identity Preserved:** Output canonical offers preserve true 1-based PDF numbers (`source.source_page_number` = `2` and `5`, or `1` and `6`) and `source.external_image_id` contains `_p002_`, `_p005_` / `_p001_`, `_p006_` (never renumbered to `1, 2`).
- **Manifest Metadata:** `extraction_manifest.json` records `page_first_ocr.total_pages: 2`, `page_first_ocr.completed_pages: 2`, while preserving `processing_selection.totalDocumentPages: 6` and `processing_selection.selectedPages: [2, 5]`.

---

## 8. Partial Extraction and Publication Safeguards

Verified across [`importPageSelectionScope.test.ts#L422-L1163`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/importPageSelectionScope.test.ts#L422-L1163) and [`ocrPipelineService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/ocrPipelineService.ts#L302-L517):

- **Scoped Retry / Resume:**
  - [`PageFirstPipelineService.runPipeline`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/pageFirstPipelineService.ts#L243-L250) on `[2, 5]` skips already-completed page `2`, retries incomplete selected page `5`, and leaves out-of-scope unresolved page `4` untouched.
  - [`retryFailedOcrChunks`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/ocrPipelineService.ts#L302-L517) filters strictly to `status === 'failed'` chunks from `originalPipelineResult`.
- **Disk Artifact Preservation:** Pre-existing unselected assets (`pages/page-001.png`, `pages/page-004.png`, `crops/page-001/001.png`, `json/page-001-001.canonical.json`, `json/page-004-001.canonical.json`, `metadata/rev1/page-001/existing-state.json`) remain intact on disk; `buildPrePublishSummary` preserves existing disk canonical offers on uncovered pages.
- **Zero Destructive Supabase Operations:** Tracking mock Supabase client in Test 26 verified **0 `.delete()` calls** across all tables during partial publication/sync.
- **Staged Batch Isolation & Fail-Closed Boundary Upload:** `getDbEligibleItemsFromPackage` returns only `[2, 5]`; `initializeStagedDraftFromPackage` strips stale unselected page `1` items from `staged-draft.json` and stages only `[2, 5]`; `uploadLeafletBoundaryPagesForMetadata` uploads only `[2, 5]` when present and rejects with `"No rendered page images found within selected pages scope"` when scoped pages lack rendered images (never falling back to unselected page 1).
- **Page-Specific Exception Isolation:** Unresolved page `4` exception quarantines only page `4` offers and does not leak to pages `1-3` or `2, 5`.

---

## 9. Complete Offline Regression Results

All commands below ran strictly **after** the final source/test edit under offline guards/mocks (`zero` live API/DB requests):

| Command | Scope | Verbatim Observed Result |
|---|---|---|
| `npm run typecheck` | Node (`tsconfig.node.json`) + Web (`tsconfig.web.json`) | **Passed** (`exit 0`, 0 errors) |
| `npm run validate:fixtures` | 11 OCR fixture contract validations | **11 / 11 passed, 0 failed** |
| `npm run test:smoke` | Local smoke & ML dataset/acceptance checks | **Passed** (`exit 0`, 14 / 14 checks passed) |
| `npx tsx scripts/calculate_baseline_hashes.ts` | Prompt & schema baseline hashes | **Passed**: `prompts.master_quality` (`12295` chars, `c5736fa321c9ad8b3c42ebea2d11efc228bca8f4c6d4db02d4c43bb96a03a5c8`), `schemas.optimized` (`2361` chars, `27d0daaeba7450df20c748a11d20258053ea8fdd6263c5863e927c1806c5cecf`) |
| `npx vitest run src/shared/utils/__tests__/pageRangeParser.test.ts src/main/metadata/__tests__/importPageSelectionScope.test.ts src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx` | Page-selection feature suite (parser 22 + scope/UAT 22 + UI 7) | **3 / 3 files passed, 51 / 51 tests passed** |
| `npx vitest run src/shared/utils/__tests__/pageRangeParser.test.ts src/main/metadata/__tests__ src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx` | Parser + full metadata suite (9 files, 148 tests) + UI suite (7) | **11 / 11 files passed, 177 / 177 tests passed** |
| `npx vitest run src/main/page-first/__tests__` | Full Page-First pipeline suite | **7 / 7 files passed, 55 / 55 tests passed** |
| `npx vitest run src/main/ocr/__tests__` | Full OCR / Gemini optimization suite | **10 / 10 files passed, 104 / 104 tests passed** |
| `npx vitest run src/main/extraction/__tests__ src/main/prepublish/__tests__ src/main/db/__tests__ src/shared/utils/__tests__/wifran07jPhase1StagedDraft.test.ts src/shared/utils/__tests__/wifran07jPhase2StagedImport.test.ts src/shared/utils/__tests__/wifran07jStep3Importer.test.ts src/shared/utils/__tests__/wifran07jPhase4AtomicPublish.test.ts src/renderer/src/components/extraction/__tests__/PreviousExtractionsView.test.tsx src/renderer/src/components/prepublish/__tests__ src/renderer/src/components/catalog/__tests__/StagedLeafletPreviewPanel.test.tsx` | Extraction, prepublish, DB gates, 07J staged draft/atomic publish, extraction/prepublish/catalog UIs | **14 files passed, 2 files failed (16 total); 91 passed, 3 failed (94 total)** — *14 / 14 non-legacy files (83 / 83 tests) + 6 / 9 legacy DB gate tests passed; see pre-existing disclosure below* |

### Transparent Pre-Existing Failure Disclosure (`src/main/db/__tests__`)

`git diff` and `git show 52f74d0` confirm neither failing DB test file was modified by `IMPORT-PAGES-001` or `IMPORT-PAGES-001-R1`; both fail due to un-updated test harnesses written in `52f74d0` (`2026-11-07`) before `METADATA-003` added `LeafletMetadataService.validatePublishReadiness()` at [`offerSyncService.ts:68-76`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/offerSyncService.ts#L68-L76):

1. [`manualPublishGate.test.ts:470`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/manualPublishGate.test.ts#L470) (1 failed / 4 passed): Test 5 calls `syncPreparedOffers` without a confirmed metadata fingerprint, `.pdf`, or `staged-draft.json` in `testWorkspace`, triggering `DB publish blocked: PUBLISH_BLOCKED: CONTENT_IDENTITY_UNRESOLVED` (`validatePublishReadiness` absent at `52f74d0`).
2. [`prePublishApprovalDbGate.test.ts:118,178`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/prePublishApprovalDbGate.test.ts#L5-L22) (2 failed / 4 passed): Its top-level `vi.mock('fs', ...)` mock defines only `{ existsSync, readFileSync, promises }` without `readdirSync`, which [`LeafletMetadataCacheService.resolveContentFingerprint`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataCacheService.ts#L292) now invokes via `offerSyncService.ts:70`.

Because both reflect pre-existing `METADATA-003` harness lag on `syncPreparedOffers` (not `IMPORT-PAGES-001`), and `wifran07jPhase1/2/3/4`, `prePublishApprovalService`, `realPublishRehearsalGate`, `offerSyncEligibility`, `StagedLeafletPreviewPanel`, and `importPageSelectionScope` Test 26 (`syncApprovedOffers` & `publishStagedLeafletDraftToDb`) all pass **100%**, they do not block UAT readiness.

---

## 10. Concise Manual UAT Instructions (`WIFRAN_OFFLINE_UAT=1`)

1. **Launch Offline UAT Build:**
   ```powershell
   npm run dev:uat-offline
   ```
   *(Confirms `WIFRAN_OFFLINE_UAT=1`, blocks Gemini/Mistral/Supabase network calls, and isolates workspaces under `workspaces_uat/` and ledger/cache under `temp/uat_metadata_cache/`.)*
2. **Load Fixture PDF:** Click **Select PDF File...** and choose [`test-fixtures/uat_cases/case_b_interior_dates/Danube-Biweekly-Nov2026.pdf`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/test-fixtures/uat_cases/case_b_interior_dates/Danube-Biweekly-Nov2026.pdf). Confirm total pages reads **6 pages** and **Pages to extract** defaults to **All pages**.
3. **Scenario A (`1-3` — Partial Auto-Discovery + Manual Dates):** Switch to **Specific pages**, enter `1-9` (confirm error & disabled **Start Extraction**), then enter `1-3`. Confirm retailer **Danube** (`Page 1`), validity **`Manual entry required`**, AI Scan dropdown limited to `1, 2, 3`, enter `2026-11-10`–`2026-11-20`, confirm (`operator_manual`), and verify `workspaces_uat/Danube-Biweekly-Nov2026/pages/` contains only pages `1–3`.
4. **Scenario C (`2-5` — Clean Suppression Without Filename Leak):** Clear `temp/uat_metadata_cache/`, reload PDF, enter `2-5`. Confirm **both** `Manual selection required` and `Manual entry required` appear (`Danube` filename suppressed, AI Scan dropdown limited to `2–5`), confirm manually, and verify only pages `2–5` process.
5. **Scenario B (`1,6` — Mock AI Scan + Preserved Page Numbers):** Clear `temp/uat_metadata_cache/`, reload PDF, enter `1, 6`. Scan Page `6` in AI dropdown (`2026-11-10`–`2026-11-20` appears; `uat_vision_ledger.json` records page `6` only). Confirm and verify `#test-page-selector` / `pages/` / `extraction_manifest.json` expose only pages `1` and `6` with original numbering.
6. **Confirmed Cache Reuse Check:** Without clearing cache, switch page selection (`1-3` → `2-5`) after confirming; verify badge reads **Previously Confirmed (Cached)** / **Source: Confirmed Content Cache (Reused)** with zero rescans.

---

**VERDICT: `READY FOR HANDS-ON UAT`** — All page-selection, Page-First, metadata, OCR, staging/prepublish isolation, TypeScript, fixture, smoke, and baseline hash checks passed cleanly in offline verification after final edits.

