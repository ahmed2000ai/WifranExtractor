# WIFRAN-EXTRACTOR-IMPORT-PAGES-001 — REVISED Report
## PDF Page Selection With Strict Selected-Page Processing Scope

**Date:** 2026-11-09  
**Mode:** Offline Verification Only (`WIFRAN_OFFLINE_UAT=1` & mocked providers — zero live Gemini, Mistral, or Supabase network requests/mutations)  
**Contract Integrity:** `buildMasterQualityPageExtractionSystemPrompt()`, `getLeafletPageGenAiSchema('optimized')`, and `wifran.extractor.offer/2.0` unchanged (SHA-256 baseline verified).

---

## Executive Summary

Implemented end-to-end configurable PDF page selection (**All pages** by default, or **Specific pages** such as `1-5, 8, 12-14`) across the Wifran Offers Extractor Import workflow with strict selected-page scope enforcement across **both** product-offer extraction **and** leaflet-level metadata discovery.

When **Specific pages** mode is active:
- Only selected PDF pages are split into chunks, rendered to disk, scanned locally or via AI for retailer/validity metadata, passed into Page-First / Rev1 extraction, cropped, staged, synced, and uploaded.
- Unconfirmed filename supermarket/date inference is suppressed in Specific mode so metadata discovery strictly reflects the selected pages (with explicit manual fallback indicators and editable inputs when metadata lies on unselected pages).
- Real 1-based original PDF page numbers (`source_page_number`, crop folder `page-NNN`, canonical filenames `page-NNN-MMM.canonical.json`, and `external_image_id`) are preserved end to end regardless of non-contiguous subsets (e.g., `2, 5` or `1, 6`).
- Partial re-extractions and partial publications preserve prior selected/unselected page artifacts on disk and execute **zero** destructive `.delete()` operations against Supabase.

---

## 1. Files Changed

### New Implementation & Test Files
| File Path | Role |
|---|---|
| [pageRangeParser.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/pageRangeParser.ts) | Deterministic 1-based inclusive page-range parser, validator, list formatter ([`formatPageList`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/pageRangeParser.ts#L18-L20)), compact range formatter ([`formatPageRanges`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/pageRangeParser.ts#L25-L43)), and [`parsePageSelection`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/pageRangeParser.ts#L59-L222). |
| [pageRangeParser.test.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/__tests__/pageRangeParser.test.ts) | 22 offline unit tests for [`parsePageSelection`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/__tests__/pageRangeParser.test.ts), duplicate/sort normalization, reversed/out-of-bounds/zero/malformed rejection. |
| [importPageSelectionScope.test.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/importPageSelectionScope.test.ts) | 20 offline integration, negative isolation, cache, extraction, partial-publish, freeze-hash, and UAT Scenario A/B tests. |
| [importPageSelectionUi.test.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx) | 5 jsdom hook/component/page UI tests covering [`useImportForm`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/hooks/useImportForm.ts), [`ImportPage`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx), and [`LeafletMetadataConfirmationCard`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/metadata/LeafletMetadataConfirmationCard.tsx). |

### Modified Shared Contracts & Types
| File Path | Summary of Changes |
|---|---|
| [importForm.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/importForm.ts) | Added `pageCount` and `contentFingerprint` to `SelectedPdfFile`; added `PageSelectionMode`, `PageSelectionState`, `ImportFormState['pageSelection']`, and `'pageSelection'` validation field. |
| [pdfPreprocess.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/pdfPreprocess.ts) | Added `selectedPages`, `selectionMode` to `StreamingPdfRenderInput`; added `totalDocumentPages`, `selectedPages`, `selectionMode` to `StreamingPdfRenderState`. |
| [extractionManifest.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/extractionManifest.ts) | Added [`ProcessingSelectionManifest`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/extractionManifest.ts#L44-L51) (`pdfFingerprint`, `totalDocumentPages`, `selectionMode`, `selectedPages`, `processingStatus`, `coverage`) and `processing_scope`. |
| [pageFirstPipeline.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/pageFirstPipeline.ts) | Added optional `pages?: number[]` parameter for scoped `processLeaflet` and `resume` calls. |
| [leafletMetadata.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/leafletMetadata.ts) & [metadataTypes.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/metadataTypes.ts) | Added `selectionMode` and `selectedPages` on `LeafletScanCoverage` and `DiscoverMetadataInput`. |

### Modified Main-Process, Preload & Renderer Files
| File Path | Summary of Changes |
|---|---|
| [fileDialogIpc.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ipc/fileDialogIpc.ts) | `file:selectPdf` computes `pageCount` via [`validatePdfFile`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/pdf/pdfValidator.ts) and SHA-256 `contentFingerprint`; added `pdf:getPageCount` IPC handler. |
| [pdfSplitter.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/pdf/pdfSplitter.ts) | Scopes [`splitPdfIntoChunks`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/pdf/pdfSplitter.ts#L6-L63) strictly to `selectedPages`, preserves `originalPageNumbers` / chunk filenames, and creates `outputChunksDir` if missing. |
| [streamingPdfRenderService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/pdf/streamingPdfRenderService.ts) | Validates `selectedPages` fail-closed, splits/renders strictly selected pages, writes `processing_selection` & `processing_scope` into manifest/metadata, and ensures `chunks/` exists when reusing an explicit workspace path. |
| [extractionManifestService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/extraction/extractionManifestService.ts) | Persists `processing_selection` and `processing_scope` in [`createInitialExtractionManifest`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/extraction/extractionManifestService.ts#L8-L90). |
| [pageFirstPipelineService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/pageFirstPipelineService.ts) | Derives strict `targetPages` from `input.pages` or `manifest.processing_selection.selectedPages`, skips unselected `page-state.json` entries on resume, restricts crop rebuild to selected pages, and preserves partial coverage metadata. |
| [pageFirstIpc.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ipc/pageFirstIpc.ts) | Forwards `pages` in `pageFirst:processLeaflet`, `pageFirst:resume`, `pageFirst:rebuildCropsFromOcr`, and validates selected scope in `pageFirst:processPage` / `quickTestPage`. |
| [leafletMetadataService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts) | Filters `pagesText` and OCR `_blocks.json` files to `selectedPages`, blocks filename retailer/validity inference in Specific mode, isolates unconfirmed cache reuse by scope, and restricts AI candidate pages to `selectedPages`. |
| [stagedLeafletDraftService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts) | Blocks filename supermarket inference when `manifest.processing_selection.selectionMode === 'specific'`; scopes [`uploadLeafletBoundaryPagesForMetadata`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L512-L530) and [`publishStagedLeafletDraftToDb`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L1967-L1991) to selected pages without deletion. |
| [offerSyncService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/offerSyncService.ts) | Scopes [`syncApprovedOffers`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/offerSyncService.ts#L846-L865) canonical loading to `selectedPages` when Specific mode is active. |
| [prePublishApprovalService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/prepublish/prePublishApprovalService.ts) | Preserves existing on-disk `.canonical.json` offers from unselected/other pages when updating [`buildPrePublishSummary`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/prepublish/prePublishApprovalService.ts#L78-L94) with in-memory newly extracted offers. |
| [index.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/preload/index.ts) & [index.d.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/preload/index.d.ts) | Exposed `pdf.getPageCount`, scoped `metadata.discover` / `renderStreaming` / `pageFirst` types cleanly to renderer. |
| [useImportForm.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/hooks/useImportForm.ts) | Added `pageSelection` state, [`setPageSelectionMode`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/hooks/useImportForm.ts), [`setSpecificPageSelection`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/hooks/useImportForm.ts#L150-L161), [`restorePageSelection`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/hooks/useImportForm.ts), reset on PDF switch, and validation gating on `canStart`. |
| [ImportPage.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx) | Rendered PDF page count & **Pages to extract** UI, suppressed filename retailer/dates prior to confirmation in Specific mode, debounced scoped `metadata:discover`, constrained test/quick-test page selectors to `selectableTestPages`, and restored selection from [`PreviousExtractionsView`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L533-L593). |
| [LeafletMetadataConfirmationCard.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/metadata/LeafletMetadataConfirmationCard.tsx) | Scoped scan coverage counts/notices (`N of M selected pages inspected`), constrained AI Scan Candidate Page dropdown to `selectedPages`, displayed explicit `"Manual selection required"` / `"Manual entry required"` indicators and `"Previously Confirmed (Cached)"` provenance badge. |

---

## 2. Page-Range Parser Behavior

[`parsePageSelection`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/pageRangeParser.ts#L59-L222) deterministically parses user strings against `totalPages`:

| Input | Document Pages | Result (`ok`, `pages`, `normalizedString` / error) |
|---|---|---|
| `"1-5, 8, 12-14"` | 14 | `ok: true`, `[1, 2, 3, 4, 5, 8, 12, 13, 14]`, `"1, 2, 3, 4, 5, 8, 12, 13, 14"` |
| `" 8 , 2 - 4 , 3 "` | 10 | `ok: true`, `[2, 3, 4, 8]`, deduplicated and sorted ascending |
| `"5-5"` | 6 | `ok: true`, `[5]` |
| `""` / whitespace | 6 | `ok: false` — empty selection rejected |
| `"0"`, `"0-3"`, `"-2"` | 6 | `ok: false` — zero / negative numbers rejected |
| `"5-2"` | 6 | `ok: false` — reversed range rejected |
| `"1-9"` | 6 | `ok: false` — out-of-bounds page rejected (`exceeds document total`) |
| `"1, , 3"` / `"1, a"` | 6 | `ok: false` — malformed / empty comma token rejected |

Verified by **22/22** unit tests in [`pageRangeParser.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/__tests__/pageRangeParser.test.ts).

---

## 3. UI Integration

- **PDF Summary & Page Selection ([`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L651-L695)):** Selecting a PDF immediately displays total pages (populated by [`file:selectPdf`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ipc/fileDialogIpc.ts#L37-L48)) and renders the **Pages to extract** section defaulting to **All pages** (`N pages`). Switching to **Specific pages** reveals `#specific-pages-input` (placeholder `1-5, 8, 12-14`), live `M pages selected: ...` normalized feedback, inline validation errors, and disables **Start Extraction** (`!canStart`) whenever Specific mode has empty or invalid input.
- **Form Hook & Filename Guard ([`useImportForm.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/hooks/useImportForm.ts#L163-L284), [`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L307-L327)):** Switching PDFs resets `pageSelection` back to **All pages** and clears prior supermarket/dates. In **Specific pages** mode before confirmation, unconfirmed filename guesses are withheld from [`getTrustedContext()`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L307-L327) and [`startStreamingRender(...)`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L1803-L1817).
- **Test Controls & AI Candidate Dropdown ([`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L940-L1065), [`LeafletMetadataConfirmationCard.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/metadata/LeafletMetadataConfirmationCard.tsx#L588-L624)):** `#test-page-selector`, `#quick-test-page-input`, **Test Current Page**, and **Quick Test** are constrained strictly to `selectableTestPages`. The metadata card displays selected-page scan coverage and constrains its AI **Scan Candidate Page** dropdown strictly to `scanCoverage.selectedPages`.

---

## 4. Proof That Metadata Discovery Respects Selected Pages

1. **Local Text & OCR Scan Filtering:** [`LeafletMetadataService.discoverMetadata`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts#L222-L230) filters `effectivePagesText` to `selectedPages` before scanning for retailers or dates, and [`discoverMetadataFromPackage`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts#L1204-L1239) reads `_blocks.json` OCR files only for `selectedPages`.
2. **Filename Inference Blocked in Specific Mode:** In [`discoverMetadata`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts#L321-L336) and [`initializeStagedDraftFromPackage`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L146-L232), filename retailer and validity inference is blocked (`!isSpecificScope`) when Specific mode is active. A file named `CARR-RYDH-011126.pdf` with selected pages `[2, 3]` containing zero retailer/date text resolves both `retailer` and `validity` as `null`.
3. **Targeted AI Candidate Restriction:** [`discoverMetadata`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts#L353-L376) intersects `input.candidatePages` with `selectedSet`. Passing `candidatePages: [6]` when `selectedPages: [2, 3]` yields **0** AI vision calls (`visionPagesInspected: []`, ledger attempts `0`).
4. **Negative Real-PDF Proof (`importPageSelectionScope.test.ts`):**
   - *Pass 1 (`1-3` on 6-page PDF with Panda on p.1, validity on p.6):* Discovers Panda (`sourcePage: 1`), `validity: null`, `scanCoverage.analyzedPages = [1, 2, 3]`, zero evidence from `[4, 5, 6]`.
   - *Pass 2 (`1, 6` on 6-page PDF):* Discovers Panda on p.1 and validity `2026-12-01..2026-12-15` (`sourcePage: 6`), zero evidence/inspections on `[2, 3, 4, 5]`.

---

## 5. Proof That Product Extraction Respects Selected Pages

1. **Streaming Render & Chunk Splitting:** [`renderPdfPagesStreaming`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/pdf/streamingPdfRenderService.ts#L95-L218) fails closed on empty/out-of-bounds `selectedPages`, passes `pagesToRender` into [`splitPdfIntoChunks`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/pdf/pdfSplitter.ts#L6-L63), and invokes the renderer **only** for `pagesToRender`. Test 13 proved selecting `[2, 5]` out of 6 pages renders only `[2, 5]`, creates 2 chunks with `originalPageNumbers` `[[2], [5]]`, and writes zero files for `[1, 3, 4, 6]`.
2. **Page-First Pipeline & Original Page Identity:** [`PageFirstPipelineService.runPipeline`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/pageFirstPipelineService.ts#L120-L128) restricts extraction, OCR/AI page processing, crop generation (`crops/page-002/`, `crops/page-005/`), canonical outputs (`page-002-001.canonical.json`, `page-005-001.canonical.json`), `source.source_page_number`, and `external_image_id` (`..._p002_...`, `..._p005_...`) strictly to the real original PDF page numbers.
3. **Scoped Resume & Crop Rebuild:** `runPipeline` skips already-completed selected pages (e.g., p.2) and out-of-scope unresolved pages (e.g., p.4), retrying only incomplete selected pages (p.5). `rebuildCropsFromExistingOcr` scopes crop regeneration strictly to `[2, 5]`.

---

## 6. Manual Fallback for Missing Supermarket & Dates

- When automatic discovery within selected pages finds `retailer === null` and/or `validity === null` (e.g., pages `1-3` where dates are only on Page 6), [`LeafletMetadataConfirmationCard`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/metadata/LeafletMetadataConfirmationCard.tsx) renders explicit `"Manual selection required"` and/or `"Manual entry required"` indicators, states that all selected pages were analyzed (`isComplete: true` relative to `selectedPages`), and leaves supermarket dropdown and date inputs editable.
- Saving via `confirmMetadata(...)` records `discoveryMethod: 'operator_manual'`, marks `operatorConfirmed: true`, writes durable + workspace confirmation JSONs, and passes `validatePublishReadiness(...)`.

---

## 7. Workspace & Cache Behavior

- **Workspace Manifest Scope:** [`createInitialExtractionManifest`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/extraction/extractionManifestService.ts#L40-L44) and `renderPdfPagesStreaming` record `processing_selection` (`pdfFingerprint`, `totalDocumentPages`, `selectionMode`, `selectedPages`, `processingStatus`, `coverage`) and `processing_scope`.
- **Cache Isolation ([`leafletMetadataService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts#L146-L171)):**
  - Unconfirmed discovery results are reused **only** when `cached.scanCoverage.selectedPages` matches the newly requested `selectedPages` scope (`[1, 2]` cache does not satisfy `[1, 3]`, which re-discovers within `[1, 3]`).
  - Operator-confirmed records (durable by `pdfFingerprint`) take precedence across subsequent page-subset runs and surface the `"Previously Confirmed (Cached)"` badge on the card and propagate `metadata:confirmed` to `ImportPage`.
- **Previous Extractions Restore ([`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L533-L593)):** Selecting an existing folder from [`PreviousExtractionsView`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/extraction/PreviousExtractionsView.tsx) restores `totalDocumentPages` and invokes `restorePageSelection(...)` + `streamingPdfRender.state` with the saved `selectionMode` and `selectedPages`.

---

## 8. Partial-Publication Safeguards

- **Pre-Publish Summary Preservation ([`prePublishApprovalService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/prepublish/prePublishApprovalService.ts#L78-L94)):** [`buildPrePublishSummary`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/prepublish/prePublishApprovalService.ts#L78-L94) merges newly extracted `inMemoryCanonicalOffers` (e.g., page 2) with existing `.canonical.json` offers from non-covered pages already on disk (e.g., page 1) instead of discarding prior pages.
- **Scoped Publish & Zero Deletions:** [`publishStagedLeafletDraftToDb`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L1967-L1991), [`uploadLeafletBoundaryPagesForMetadata`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L512-L530), and [`syncApprovedOffers`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/offerSyncService.ts#L846-L865) filter strictly to `selectedPages` in Specific mode. Test 26 proved zero `.delete()` calls were issued on Supabase tables (`leaflets`, `offers`, `offer_sources`, etc.), while only page 2/5 offers and boundary pages `[2, 5]` were published/uploaded.
- **Page-Specific Exceptions Preserved (Test 27):** Page 2's exception (`2026-12-02`–`2026-12-03`) applies exclusively to Page 2 offers, while Page 5 offers inherit leaflet-level dates (`2026-12-01`–`2026-12-15`) and unselected-page exceptions never fire or block publishing.

---

## 9. Offline Test Results (Executed on Final Code State)

All commands below ran strictly **after** the final edit with offline guards/mocks (`zero` live API/DB requests):

| Command | Scope | Observed Result |
|---|---|---|
| `npm run typecheck` | Node (`tsconfig.node.json`) + Web (`tsconfig.web.json`) TypeScript check | **Passed** (exit code `0`, 0 errors) |
| `npx vitest run src/shared/utils/__tests__/pageRangeParser.test.ts src/main/metadata/__tests__/importPageSelectionScope.test.ts src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx` | All new page-selection parser, backend scope/negative/UAT, and UI/jsdom suites | **3 / 3 files passed, 47 / 47 tests passed** |
| `npx vitest run src/main/metadata/__tests__` | Full metadata test suite (discovery, integration, security, UAT, page selection) | **9 / 9 files passed, 146 / 146 tests passed** |
| `npx vitest run src/main/ocr/__tests__ src/main/extraction/__tests__/extractionPackageService.test.ts src/main/prepublish/__tests__ src/main/db/__tests__/offerSyncEligibility.test.ts src/shared/utils/__tests__/wifran07jPhase1StagedDraft.test.ts src/shared/utils/__tests__/wifran07jPhase4AtomicPublish.test.ts src/renderer/src/components/extraction/__tests__/PreviousExtractionsView.test.tsx` | OCR schema/cache/flex, extraction package, prepublish, sync eligibility, 07J draft/publish, PreviousExtractions UI | **19 / 19 files passed, 135 / 135 tests passed** |
| `npx vitest run src/main/page-first/__tests__` | Page-First pipeline tests | **5 passed, 2 pre-existing unrelated failures (52 passed, 2 failed out of 54 tests)** — *disclosed below* |
| `npm run validate:fixtures` | 11 OCR fixture contract validations | **11 / 11 passed, 0 failed** |
| `npm run test:smoke` | Local smoke & ML dataset/acceptance verifier checks | **Passed** (exit code `0`) |
| `npx tsx scripts/calculate_baseline_hashes.ts` | Frozen Master Quality prompt & optimized schema integrity check | **Passed**: `prompts.master_quality` (`12295` chars, `c5736fa321c9ad8b3c42ebea2d11efc228bca8f4c6d4db02d4c43bb96a03a5c8`), `schemas.optimized` (`2361` chars, `27d0daaeba7450df20c748a11d20258053ea8fdd6263c5863e927c1806c5cecf`) |

**Transparent Pre-Existing Failure Disclosure (`src/main/page-first/__tests__`):**
The 2 failures in `src/main/page-first/__tests__` pre-date this milestone and are unrelated to page selection:
1. `pageFirstIntegration.test.ts:136` — fixture validity date `2026-10-22` is now in the past relative to system clock (`2026-11-09`), causing `deterministicOfferChecks` to quarantine the stale offer (`'skip_or_quarantine'` vs `'publish'`).
2. `pageFirstTestCurrentPage.test.ts:238` — expects a `'linking'` progress event stage that `PageFirstPipelineService` no longer emits separately from `'ocr'`.

---

## 10. Remaining Limitations

1. **Simulated Rasterization in Vitest:** `importPageSelectionScope.test.ts` exercises real `pdf-lib` PDF generation/splitting (`splitPdfIntoChunks`), real SHA-256 fingerprinting, and real `renderPdfPagesStreaming` control flow using an injected `_customPageRenderer` PNG generator rather than live external Ghostscript / GraphicsMagick (`pdf2pic`) binaries.
2. **Renderer Mock IPC in jsdom:** `importPageSelectionUi.test.tsx` tests real React hooks, `ImportPage`, and `LeafletMetadataConfirmationCard` DOM interactions against a mocked `window.wifranExtractor` preload API rather than an interactive desktop Electron window click-through. Live Electron verification is covered in the UAT checklist below.

---

## 11. Executable Operator UAT Checklist (`WIFRAN_OFFLINE_UAT=1`)

Launch the desktop app in strict offline isolation (blocks all Gemini, Mistral, and Supabase network calls; stores UAT workspaces in `workspaces_uat/` and UAT cache/ledger in `temp/uat_metadata_cache/`):

```powershell
npm run dev:uat-offline
```

**Test Fixture PDF:** [`test-fixtures/uat_cases/case_b_interior_dates/Danube-Biweekly-Nov2026.pdf`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/test-fixtures/uat_cases/case_b_interior_dates/Danube-Biweekly-Nov2026.pdf) *(6 pages: Danube brand on Page 1; scanned/interior validity dates `2026-11-10`–`2026-11-20` on Page 6)*.

### Scenario A — Subset `1-3` (Missing Dates Outside Scope + Manual Entry Fallback)
1. Click **Select PDF File...** and pick `Danube-Biweekly-Nov2026.pdf`.
   - **Verify:** File summary shows `(..., 6 pages)` and **Pages to extract** defaults to **All pages (6 pages)**.
2. Select **Specific pages**, enter `1-9` then clear to verify **Start Extraction** is disabled on out-of-bounds/empty input and inline error displays.
3. Enter `1-3`.
   - **Verify:** Displays `3 pages selected: 1, 2, 3`.
   - **Verify:** Before confirmation, supermarket dropdown is not leaked by filename heuristics if unconfirmed; metadata discovery reports **Danube** (`Page 1`) and validity shows **`Manual entry required`** (`3 of 3 selected pages inspected`). Page 6 is NOT in AI Scan dropdown (`[1, 2, 3]` only).
4. Enter validity dates manually (`2026-11-10` to `2026-11-20`), select scope (e.g., `National`), and click **Confirm Metadata**.
   - **Verify:** Card updates to `Confirmed` (`operator_manual` if manually entered).
5. Click **Start Extraction** (note: in offline UAT mode live rasterizer renders locally without AI/OCR API calls, or inspect generated `workspaces_uat/Danube-Biweekly-Nov2026/extraction_manifest.json` & `pages/`):
   - **Verify:** `pages/` contains ONLY `page.1.*`–`page.3.*` (no `page.4.*`–`page.6.*`), `#test-page-selector` lists only Pages `1, 2, 3`, and `extraction_manifest.json` contains `processing_selection.selectionMode: "specific"`, `selectedPages: [1, 2, 3]`, `totalDocumentPages: 6`, `coverage: "partial"`.

### Scenario B — Non-Contiguous Subset `1, 6` (Targeted AI Mock Scan on Page 6 + Preserved Page Numbers)
1. Reset or clear UAT cache (`temp/uat_metadata_cache/`) if testing fresh discovery without Scenario A's confirmed cache, re-select `Danube-Biweekly-Nov2026.pdf`, choose **Specific pages**, and enter `1, 6`.
   - **Verify:** Displays `2 pages selected: 1, 6`. Pages `2–5` are never listed in scan coverage or AI **Scan Candidate Page** dropdown (`[1, 6]` only).
2. Click **Scan Page** for **Page 6**.
   - **Verify:** Mock targeted AI inspects ONLY Page 6 (no network request made; `uat_vision_ledger.json` logs `pageNumber: 6`), resolving `2026-11-10` to `2026-11-20` (`sourcePage: 6`) alongside Danube on Page 1.
3. Click **Confirm Metadata** and run extraction / inspect workspace:
   - **Verify:** `chunks/` and `pages/` contain only Pages `1` and `6` (never `2, 3, 4, 5`).
   - **Verify:** `#test-page-selector` offers only `Page 1` and `Page 6`, and canonical offers preserve `source_page_number: 1` and `source_page_number: 6` (never renumbered to `2`).
4. Click **Open Existing Extraction Folder...** -> select the workspace and verify **Pages to extract** restores `Specific pages` (`1, 6`).
