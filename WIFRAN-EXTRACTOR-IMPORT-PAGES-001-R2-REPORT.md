# WIFRAN-EXTRACTOR-IMPORT-PAGES-001-R2 — Publishing Test Reconciliation, IPC Gate Hardening & Non-Destructive Partial Staging Report

**Date:** 2026-11-09  
**Milestone:** `WIFRAN-EXTRACTOR-IMPORT-PAGES-001-R2`  
**Mode:** Strictly Offline (zero live Gemini/Mistral requests, zero live Supabase DB writes or storage uploads, zero DB migrations)  
**Outcome:** All targeted publishing gates, non-destructive partial staging, selected-page publication semantics, metadata/page-selection, Page-First, OCR, UI, typecheck, fixture validation, smoke, and baseline hash checks **PASSED** strictly after the final code edit.

---

## 1. Root Causes & Corrections for the Three Publishing Test Failures

None of the three pre-existing failures represented a defect in the METADATA-003/004 fail-closed gate itself; all three stemmed from outdated test harnesses authored prior to METADATA-003/004:

1. **`src/main/db/__tests__/manualPublishGate.test.ts` — Test 5 (`DB writes occur ONLY after explicit Publish approval...`)**
   - **Root cause:** The test setup created a synthetic workspace without an `original.pdf` or a `LeafletMetadataService.confirmMetadata(...)` record and passed a legacy non-catalog slug `'sm-panda'` with `leafletId: 'leaflet-123'`. Under the METADATA-003/004 fail-closed gate inside `syncPreparedOffers()`, `validatePublishReadiness()` properly rejected the unconfirmed publish attempt (`DB publish blocked: PUBLISH_BLOCKED...`).
   - **Correction:** Updated `src/main/db/__tests__/manualPublishGate.test.ts` to use an isolated `os.tmpdir()` workspace containing a real multi-page `original.pdf` generated via `pdf-lib` with computed SHA-256 fingerprint and the catalog Panda UUID (`c2cc16c2-0001-4444-b000-c00000000001`). Test 5 now explicitly proves in order:
     1. Zero DB writes before Pre-Publish Preview approval.
     2. Approved Pre-Publish Preview **without** metadata confirmation STILL throws `DB publish blocked: PUBLISH_BLOCKED` with `0` DB writes.
     3. Even after confirming the real PDF, a wrong/mismatched 64-hex `leafletId` (`'f'.repeat(64)`) STILL throws `DB publish blocked: PUBLISH_BLOCKED` with `0` DB writes.
     4. Only valid Pre-Publish approval + authoritative metadata confirmation permits `syncPreparedOffers()` to publish (`publishedRows === 1`).
     - Added cleanup in `afterAll()` to invalidate test fingerprints from metadata cache and delete temp directories.

2. **`src/main/db/__tests__/prePublishApprovalDbGate.test.ts` — Tests 4 & 6 (`proceeds if manifest exists...` & `blocks...` pre-publish/metadata gate interactions)**
   - **Root cause:**
     - The test previously installed a partial `vi.mock('fs', ...)` lacking `readdirSync` and `mkdirSync`, which broke `LeafletMetadataService` / `LeafletMetadataCacheService` when inspecting workspaces, and mocked an incorrect relative storage module path (`'../storage/offerImageStorageService'` instead of `'../../storage/offerImageStorageService'`).
     - The workspace fixtures (`\fake\package_1`, `\fake\package_4`, etc.) had no real `original.pdf` or confirmed metadata record, so after Pre-Publish Preview approval passed, `validatePublishReadiness()` blocked publication as designed.
   - **Correction:** Replaced the fragile `vi.mock('fs')` with real `os.tmpdir()` workspaces (`createGateWorkspace`) containing real `pdf-lib` PDFs, corrected the storage mock path to `'../../storage/offerImageStorageService'`, preserved full negative assertions (missing `extractionPackagePath`, missing manifest, unapproved preview, approved preview + unconfirmed metadata, mismatched 64-hex fingerprint, completed-manifest block, `forceRePublish` + unconfirmed metadata block, plus IPC sanitizer enforcement), and verified positive publication only when both Pre-Publish Preview approval and authoritative metadata confirmation succeed. Cleaned up fingerprints and temp dirs in `afterEach()`.

---

## 2. Mandatory Metadata Confirmation & IPC Bypass Hardening

### Fail-Closed Gate Behavior Verified
- **`syncPreparedOffers` (`src/main/db/offerSyncService.ts`)** resolves `selectedScopeSet` from `extraction_manifest.json` (`processing_selection`) and passes `{ workspacePath, expectedSupermarketId, leafletFingerprint }` to `LeafletMetadataService.validatePublishReadiness(...)` when `requirePrePublishApproval !== false`:
  - `input.leafletId` is validated as a 64-hex SHA-256 string (`input.leafletId && /^[0-9a-f]{64}$/i.test(input.leafletId) ? input.leafletId : undefined`), blocking wrong or mismatched fingerprints (`Cryptographic fingerprint mismatch`).
- **`syncApprovedOffers` (`src/main/db/offerSyncService.ts`)** and **`publishStagedLeafletDraftToDb` (`src/main/db/stagedLeafletDraftService.ts`)** unconditionally invoke `validatePublishReadiness(...)` before any Supabase write or image upload.
- Neither Pre-Publish Preview approval alone (`manifest.pre_publish_preview.status === 'approved'`) nor `forceRePublish: true` nor `operatorConfirmedPublish: true` can bypass unconfirmed or mismatched leaflet metadata.

### IPC Boundary Hardening
- **`src/main/ipc/offerSyncIpc.ts`** (`sanitizeOfferSyncIpcInput`, used by `offerSync:syncPreparedOffers`):
  - Strips any renderer-supplied `supabaseClient`.
  - Forces `options.requirePrePublishApproval = true` for all non-dry-run IPC calls (`isDryRun ? rawRequireApproval !== false : true`).
- **`src/main/ipc/productEnrichmentIpc.ts`**:
  - `sanitizePublishStagedDraftOptions` (applied to `productEnrichment:publish-staged-draft` and `catalog:publishStagedDraft`) strips both `supabaseClient` and `authorizedCanaryAutoLink`.
  - `stripUntrustedSupabaseClient` strips `supabaseClient` on `productEnrichment:import-step2-csv`, `catalog:importStep2Csv`, `productEnrichment:initialize-draft`, and `productEnrichment:export-step1-csv`.
- Verified by dedicated assertions in `src/main/db/__tests__/prePublishApprovalDbGate.test.ts` (line 227+).

---

## 3. Non-Destructive Partial Staging (`staged-draft-history.json`)

Implemented in `src/main/db/stagedLeafletDraftService.ts` and `src/shared/types/stagedDraft.ts`:

- **Companion History Persistence:** `saveStagedLeafletDraft()` syncs active draft items into `staged-draft-history.json` (`STAGED_DRAFT_HISTORY_FILENAME`), keyed stably by `sourceOfferId || id` (`getStagedItemKey`). Fallback item IDs built in `buildStagedItemsFromEligible()` are page-qualified (`offer-p00X-YYY`) to prevent collisions across partial runs.
- **Non-Destructive Narrowing & Editing:** When switching from full workspace (`pages 1–10`) to a partial selection (e.g., `Specific pages [3, 4]`), both `initializeStagedDraftFromPackage()` and `loadStagedLeafletDraft()` archive all existing `draft.items` into `staged-draft-history.json` *before* filtering `staged-draft.json` down to the active selected-page scope (`[3, 4]`).
- **Full Reopen Recovery:** When reopening with `All pages` (`selectionMode: 'all'`, `selectedScopeSet === null`), `mergeScopedItemsFromHistory()` recovers unselected items `[1–2, 5–10]` with all operator approvals (`operatorApprovedIdentity`, `operatorApprovedProductId`, `operatorApprovedBy`, `operatorApprovedAt`), manual edits (`titleEn`, `isOperatorModified`, `operatorEditedFields`), and custom image paths intact, while overlaying any edits made during `[3, 4]` on top.
- **Draft Lock Recovery:** When partial publication (`partialCoveragePublish: true`, `publishedPages: [3, 4]`) sets `draft.status = 'published'`, `resetPublishedStatusIfUnpublishedItemsPresent()` resets `draft.status` back to `'draft'` upon restoring unpublished items `[1–2, 5–10]` so `StagedLeafletPreviewPanel.tsx` does not remain permanently locked.

Verified end-to-end by integration test `"preserves full-workspace reviewed/approved offers [1-10] in history when running partial [3, 4] and recovers them cleanly on reopen"` in `src/main/metadata/__tests__/importPageSelectionScope.test.ts`.

---

## 4. Partial-Publishing Safety Semantics

Verified across all three publishing entry points in `src/main/metadata/__tests__/importPageSelectionScope.test.ts` (`"enforces selected-page semantics in staged publish, syncApprovedOffers, and syncPreparedOffers without deleting existing offers or uploading unselected images"`):

1. **`publishStagedLeafletDraftToDb` (`src/main/db/stagedLeafletDraftService.ts`):**
   - Resolves `selectedPublishScopeSet` from `extraction_manifest.json`.
   - Excludes offers outside selected pages (`selectedPublishScopeSet && (itemPage <= 0 || !selectedPublishScopeSet.has(itemPage))`, fail-closed when page number is missing/invalid).
   - Excludes quarantined items (`publishDecision === 'skip_or_quarantine'`, `quality.publish_decision === 'skip_or_quarantine'`, and exception-resolved quarantines).
   - Populates `source_page_number` on upserted offer records, performs zero storage uploads for out-of-scope or quarantined items, performs zero `.delete()` calls or updates against pre-existing offers on unselected pages, and records `partialCoveragePublish: true`, `publishedPages`, `publishedOfferKeys`, and `publishedPages` in `staged-draft-history.json`.

2. **`syncApprovedOffers` (`src/main/db/offerSyncService.ts`):**
   - Parses `pNum` (with page-qualified filename fallback `/^page-0*(\d+)-/i` / `/_0*(\d+)_/`) and skips any canonical offer outside `selectedScopeSet`.
   - Excludes `skip_or_quarantine` offers before image upload or DB write (`publishedRows = 2`, `skippedRows = 1`).
   - When `processing_selection.selectionMode === 'specific'` and `coverage === 'partial'`, updates manifest to `db_update_status = 'in_progress'` and `stages.db_update = 'partial'` rather than `'completed'`.

3. **`syncPreparedOffers` (`src/main/db/offerSyncService.ts`):**
   - Resolves `selectedScopeSet` from `extraction_manifest.json` even when direct callers include out-of-scope rows in `input.rows`.
   - Marks out-of-scope or unnumbered rows under `specific` scope as `skipped` (`OUT_OF_SELECTED_PAGE_SCOPE`) prior to any image upload or DB upsert/insert, keeping pre-existing published DB offers on unselected pages (`[1, 2, 5, 6]`) untouched with zero `.delete()` calls.

---

## 5. Exact Files Modified in R2

### Production Code
- `src/shared/types/stagedDraft.ts` — Added `partialCoveragePublish?: boolean` and `publishedPages?: number[]` to `StagedLeafletDraft`.
- `src/main/ipc/offerSyncIpc.ts` — Added and applied `sanitizeOfferSyncIpcInput`.
- `src/main/ipc/productEnrichmentIpc.ts` — Added and applied `sanitizePublishStagedDraftOptions` and `stripUntrustedSupabaseClient`.
- `src/main/db/offerSyncService.ts` — Selected-page scope enforcement in `syncPreparedOffers` and `syncApprovedOffers`, strict SHA-256 `leafletFingerprint` type narrowing, partial publish manifest status (`in_progress` / `partial`), and zero unselected uploads/deletes.
- `src/main/db/stagedLeafletDraftService.ts` — Added `staged-draft-history.json` companion persistence, non-destructive scoping/recovery helpers, status unlock on recovered unpublished items, fail-closed `itemPage` checks, `source_page_number` persistence, and `partialCoveragePublish`/`publishedPages` tracking.

### Test Code
- `src/main/db/__tests__/manualPublishGate.test.ts` — Upgraded Test 5 to real `os.tmpdir()` PDF workspace + catalog Panda ID + negative unconfirmed/wrong-fingerprint assertions + positive confirmed publish + cleanup.
- `src/main/db/__tests__/prePublishApprovalDbGate.test.ts` — Replaced brittle `fs` mock with `os.tmpdir()` workspaces, fixed storage mock path, added metadata gate + mismatched-fingerprint + IPC sanitizer tests + cleanup.
- `src/main/page-first/__tests__/pageFirstIntegration.test.ts` — Replaced runtime `new Date()` with fixed deterministic dates (`2026-10-10` / `2026-10-17`) and `vi.useFakeTimers({ toFake: ['Date'] })` (`2026-10-12T12:00:00.000Z`).
- `src/main/page-first/__tests__/pageFirstTestCurrentPage.test.ts` — Pinned deterministic dates, `Date`-only fake timers, and monotonic workspace IDs.
- `src/main/metadata/__tests__/importPageSelectionScope.test.ts` — Added 2 R2 integration tests covering non-destructive `[1..10] -> [3, 4] -> 'all'` recovery and selected-page publication safety across all 3 publish paths.

---

## 6. Post-Final-Edit Verification Results

All commands below were executed strictly **after the final code and test edits** with zero live AI calls and zero live Supabase mutations:

| Command | Result | Details |
| :--- | :--- | :--- |
| `npx vitest run src/shared/utils/__tests__/pageRangeParser.test.ts src/main/metadata/__tests__ src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx` | **PASS** (exit 0) | **11 test files passed (11), 179 tests passed (179)** (0 failed, 0 skipped; 16.38s) |
| `npx vitest run src/main/page-first/__tests__` | **PASS** (exit 0) | **7 test files passed (7), 55 tests passed (55)** (0 failed, 0 skipped; 3.70s) |
| `npx vitest run src/main/ocr/__tests__` | **PASS** (exit 0) | **10 test files passed (10), 104 tests passed (104)** (0 failed, 0 skipped; 4.68s) |
| `npx vitest run src/main/extraction/__tests__ src/main/prepublish/__tests__ src/main/db/__tests__ src/shared/utils/__tests__/wifran07jPhase1StagedDraft.test.ts src/shared/utils/__tests__/wifran07jPhase2StagedImport.test.ts src/shared/utils/__tests__/wifran07jStep3Importer.test.ts src/shared/utils/__tests__/wifran07jPhase4AtomicPublish.test.ts src/shared/utils/__tests__/wifranExtractorIdentity001.test.ts src/shared/utils/__tests__/wifranExtractorIdentity001b.test.ts src/renderer/src/components/extraction/__tests__/PreviousExtractionsView.test.tsx src/renderer/src/components/prepublish/__tests__ src/renderer/src/components/catalog/__tests__/StagedLeafletPreviewPanel.test.tsx` | **PASS** (exit 0) | **18 test files passed (18), 162 tests passed (162)** (0 failed, 0 skipped; 11.95s) |
| `npx vitest run --no-file-parallelism --hookTimeout=60000 --testTimeout=60000 src/shared/utils/__tests__/wifranExtractorIdentity001c.test.ts src/shared/utils/__tests__/wifranExtractorIdentity001d.test.ts src/shared/utils/__tests__/wifranExtractorIdentity001e.test.ts` | **PASS** (exit 0) | **3 test files passed (3), 37 tests passed (37)** (0 failed, 0 skipped; sequential run avoids parallel PGlite WASM startup contention; 41.14s) |
| `npm run typecheck` | **PASS** (exit 0) | `tsc --noEmit -p tsconfig.node.json` & `tsc --noEmit -p tsconfig.web.json` — 0 errors |
| `npm run validate:fixtures` | **PASS** (exit 0) | **11 passed, 0 failed** |
| `npm run test:smoke` | **PASS** (exit 0) | All local smoke checks passed |
| `npx tsx scripts/calculate_baseline_hashes.ts` | **PASS** (exit 0) | Master Quality prompt: `12295` chars (`sha256: c5736fa321c9ad8b3c42ebea2d11efc228bca8f4c6d4db02d4c43bb96a03a5c8`); Optimized schema: `2361` chars (`sha256: 27d0daaeba7450df20c748a11d20258053ea8fdd6263c5863e927c1806c5cecf`) — **unchanged** |

### Per-File Breakdown of All 49 Targeted Test Files (537/537 Passed)
- **Batch 1 (Page Selection, Metadata & Import UI — 11 files / 179 tests):**
  - `pageRangeParser.test.ts` (22), `importPageSelectionScope.test.ts` (24), `importPageSelectionUi.test.tsx` (7), `leafletMetadataDiscovery.test.ts` (24), `leafletMetadataIntegration.test.ts` (20), `leafletMetadataOperatorUAT.test.ts` (20), `leafletMetadataPublicationSafety.test.ts` (20), `leafletMetadataExecutableUat.test.ts` (16), `leafletMetadataCoverageAndSecurity.test.ts` (11), `leafletMetadataUatHardening.test.ts` (10), `leafletMetadataRealDocumentDiscovery.test.ts` (5).
- **Batch 2 (Page-First Pipeline — 7 files / 55 tests):**
  - `pageFirstOcr.test.ts` (18), `rev1NormalizersAndMath.test.ts` (15), `canonicalMappingUpgrades.test.ts` (6), `pageFirstSynthetic.test.ts` (6), `pageFirstTestCurrentPage.test.ts` (6), `pageFirstIntegration.test.ts` (2), `pageFirstIpcWiring.test.ts` (2).
- **Batch 3 (OCR & Prompt/Schema Invariants — 10 files / 104 tests):**
  - `geminiOpt002CacheAndFlex.test.ts` (27), `geminiOpt004bProviderCache.test.ts` (17), `geminiOpt001LosslessOptimization.test.ts` (16), `geminiOpt004aMasterQuality.test.ts` (12), `mistralRateLimitQueue.test.ts` (9), `geminiOpt003ResumableBenchmark.test.ts` (7), `styleProfilePromptBuilder.test.ts` (6), `styleAwareValidationPromptBuilder.test.ts` (5), `leafletStyleProfileService.test.ts` (3), `mistralRateLimitQueueBundle.test.ts` (2).
- **Batch 4A & 4B (Extraction, Pre-Publish, DB Gates, Staged Draft, Identity & Publishing UI — 21 files / 199 tests):**
  - `wifranExtractorIdentity001b.test.ts` (45), `wifranExtractorIdentity001.test.ts` (20), `wifran07jStep3Importer.test.ts` (20), `wifran07jPhase2StagedImport.test.ts` (16), `wifranExtractorIdentity001d.test.ts` (13), `wifranExtractorIdentity001c.test.ts` (12), `wifranExtractorIdentity001e.test.ts` (12), `wifran07jPhase1StagedDraft.test.ts` (11), `prePublishApprovalDbGate.test.ts` (9), `StagedLeafletPreviewPanel.test.tsx` (7), `realPublishRehearsalGate.test.ts` (6), `manualPublishGate.test.ts` (5), `PrePublishPreview.test.tsx` (5), `PreviousExtractionsView.test.tsx` (4), `RealPublishRehearsal.test.tsx` (4), `prePublishApprovalService.test.ts` (3), `offerSyncEligibility.test.ts` (2), `wifran07jPhase4AtomicPublish.test.ts` (2), `extractionPackageService.test.ts` (1), `dryRunPublish.test.ts` (1), `realPublishRehearsalReport.test.ts` (1).

> **Note on Additional Repository Suites Run Outside R2 Scope:** An exploratory run of the remaining 37 repository test files passed **35 files / 461 tests** and surfaced 3 pre-existing legacy unit-test assertion failures in untouched files (`src/shared/utils/__tests__/canonicalOfferNormalizer.test.ts` expecting `'liter'` vs normalized `'l'` and candidate `title_ar`, and `src/shared/utils/__tests__/deterministicOfferChecks.test.ts` line 111), all unrelated to page selection, metadata confirmation, or R2 publishing changes.

---

## 7. Remaining Scope / Non-Blockers

- **Offline-Only Verification:** Per milestone constraints, live Gemini/Mistral calls, live Electron GUI interactive launch/packaging (`npm run build`), and live Supabase staging/production writes were not executed. All DB, storage, and IPC tests used offline mocks and isolated `os.tmpdir()` workspaces.
- **Pre-Existing Workspace Artifacts:** Untracked scratch directories under `temp/` (`doc_test_*`, `int_test_*`, `test_meta_cache_*`) and legacy cache entries in `data/confirmed-leaflet-metadata/` created by pre-existing test suites remain untouched outside this milestone's temporary workspaces; all R2 tests self-clean their temp directories and cache keys.

