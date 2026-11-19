# WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001 Implementation & Verification Report

**Milestone:** `WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001` — *Remove Redundant Leaflet Page Uploads and Metadata Rows From Image Sourcing*  
**Date:** 2026-11-10  
**Scope:** Stage 3 product/offer CSV export/import contract, boundary-page upload retirement, Stage 2 metadata ownership, legacy CSV compatibility, and operator documentation.

---

## 1. Executive Summary & Exact Step 1 CSV Diff

Stage 2 ([`LeafletMetadataService`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts) + `confirmed_metadata.json`) now discovers, normalizes, and locks leaflet-level metadata (supermarket, geographic scope/region, and offer validity dates) before Stage 3 image sourcing starts. Accordingly, the Stage 3 sourcing loop now handles **product (`P<id>`) and offer (`O<n>`) images ONLY**:

- Step 1 export ([`exportStagedLeafletForStep2`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L1346-L1519)) emits a strictly 2-column UTF-8 BOM (`\uFEFF`) + CRLF (`\r\n`) CSV with header `Image_Ref,Item_Name`, RFC-4180 quote escaping (`""`), bilingual descriptions (`English | Arabic`), verified products sorted ascending by numeric `P<id>` followed by consolidated representative uncatalogued offers sorted numerically by `O<n>`, `metadataRowsCount: 0`, and zero boundary (`FPTSP`, `LPTSP`, `M_PAGE_FIRST`, `M_PAGE_LAST`) or metadata (`SD`, `ED`, `SMN`, `REG`, `M_*`) rows.
- Step 3 import accepts `Image_Ref,image_url` (including optional `Corrected_Item_Name|https_image_url`, blank URLs as unresolved candidates, and legacy 6-column CSVs), preserves Stage 2 metadata as authoritative, and safely ignores any legacy boundary/metadata rows with operator warnings.

### Exact Real `dukan-849797163-jeddah` (`O51`) Step 1 CSV Diff

**Before (`WIFRAN-07J` legacy boundary export on `dukan-849797163-jeddah`):**
```csv
Image_Ref,Item_Name
"O51","CHiQ Czech 55-inch QLED 4K Smart TV 55 Inch | تلفزيون تشيك الذكي ٥٥ بوصة كيو إل إي دي بدقة ٤K"
"FPTSP","https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/tmp/dukan-849797163-jeddah.pdf_first.png"
"LPTSP","https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/tmp/dukan-849797163-jeddah.pdf_first.png"
```

**After (`WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001` — 2 lines, UTF-8 BOM + CRLF):**
```csv
Image_Ref,Item_Name
"O51","CHiQ Czech 55-inch QLED 4K Smart TV 55 Inch | تلفزيون تشيك الذكي ٥٥ بوصة كيو إل إي دي بدقة ٤K"
```

---

## 2. Public `tmp` Upload Removal & Historical Object Inventory

### Code Changes Made
- **Retired remote public `tmp` uploads:**
  - [`initializeStagedDraftFromPackage`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L480-L837) no longer uploads boundary pages to Supabase storage bucket `'tmp'`. It leaves `firstPagePublicUrl`, `lastPagePublicUrl`, `firstPageTmpPath`, and `lastPageTmpPath` as `null`.
  - [`uploadLeafletBoundaryPagesForMetadata`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L1044-L1134) is retained only as a zero-network backward-compatible wrapper around [`resolveLocalLeafletPreviewPages`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L935-L1036), returning `null` for all four public/`tmp` fields while populating local filesystem paths.
- **Local operator previews preserved fail-closed:**
  - [`resolveLocalLeafletPreviewPages`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L935-L1036) resolves local rendered page images from `pages/` (or `jobDir`) and strictly enforces `manifest.processing_selection` when `selectionMode === 'specific'`, throwing if a requested `metadataPageNumber` or available images fall outside the selected pages scope.
  - [`StagedLeafletPreviewPanel.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/StagedLeafletPreviewPanel.tsx#L873-L945) renders `Preview Page X (Local)` buttons that open a modal ([lines 1245–1315](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/StagedLeafletPreviewPanel.tsx#L1245-L1315)) using Electron's privileged `local-file://get?path=...` protocol via [`toRenderableImageSrc`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/StagedLeafletPreviewPanel.tsx#L29-L54).
  - [`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx#L2041-L2055) helper copy was updated to describe local boundary previews rather than `tmp` uploads.

### Shared Function & `src/` Audit
A full scan across `src/` confirmed **zero** remaining upload calls to `.from('tmp')`:
- [`cleanupLeafletBoundaryPagesFromTmpBucket`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L871-L894) remains exported for explicit caller use only and is never invoked automatically.
- [`publishStagedLeafletDraftToDb`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L3158) explicitly leaves any historical `tmp` objects untouched (no automatic remote storage deletion).
- Private leaflet crop storage (`offer-images`) and approved product/offer display storage (`product-images`, `offer-display-images`) are completely untouched by this change.

### Non-Destructive Historical `tmp` Object Inventory (Workspace Files)
Scanning `Extracts/`, `workspaces_uat/`, and `exports/` found one historical `tmp` object reference created prior to this milestone (**left untouched; not deleted automatically**):

| Artifact File | Referenced Bucket / Object Path | Historical Public URL | Recommendation |
| :--- | :--- | :--- | :--- |
| [`Extracts/dukan-849797163-jeddah/staged-draft.json`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/Extracts/dukan-849797163-jeddah/staged-draft.json#L12-L15) | `tmp` / `dukan-849797163-jeddah.pdf_first.png` | `https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/tmp/dukan-849797163-jeddah.pdf_first.png` | Optional manual deletion in Supabase Storage console after confirming no external test references it. |

Note: [`workspaces_uat/dukan-849797163-jeddah/staged-draft.json`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/workspaces_uat/dukan-849797163-jeddah/staged-draft.json#L12-L15) already stores `null` for `firstPagePublicUrl`, `lastPagePublicUrl`, `firstPageTmpPath`, and `lastPageTmpPath`.

---

## 3. Step 3 Input Contract & Validation Rules

Implemented in [`importStep2CsvIntoStagedDraft`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L1618-L2042) and [`validateProductImageCsvImport`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/productImageEnrichmentService.ts#L647-L981) / [`uploadApprovedProductImagesToDb`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/productImageEnrichmentService.ts#L986-L1577):

1. **Accepted Headers:**
   - Primary 2-column contract: `Image_Ref,image_url` (and `Product_ID,image_url` in direct enrichment).
   - Legacy 6-column staged format (`Image_Ref,Title_EN,Title_AR,Brand,Size_Or_Weight,image_url`) remains supported.
2. **Optional Evidence-Backed Correction Pipe Syntax:**
   - Supports `Corrected_Item_Name|https_image_url`, bilingual `Corrected Title EN | Corrected Title AR | https://...`, and `Corrected_Item_Name|` (correction without image URL).
   - Preserves `item.originalOcr` immutably, respects `item.operatorEditedFields` locks, records `item.aiCorrected`, and triggers [`checkPostCorrectionCatalogMatch`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L1529-L1561).
3. **Blank URL Handling:**
   - Rows such as `O51,` or `P12,` are accepted with zero errors and zero `fetch` calls as unresolved candidates (`blank_skipped` or `already_has_image` when approved DB media already exists).
4. **Strict Reference & Conflict Validation:**
   - Matches strictly against existing `P<id>` or `O<n>`/`O<uuid>` references (`parseImageRef` / draft & map lookup).
   - Rejects unknown/unmatched refs (`Row N: Unknown or unmatched image reference ...`).
   - Rejects unsupported/malformed refs (`Row N: Unsupported or invalid image reference ...`).
   - Rejects duplicate `Image_Ref` rows (case-insensitive, distinguishing identical vs URL-conflicting duplicates) and conflicting refs targeting the same entity/staged offer item (`seenTargetItemIds` in staged import; `entityKey` in direct validation).
5. **URL, Network & Media Safety Preserved:**
   - Rejects malformed URLs (including dates mistakenly placed in `image_url`) and non-HTTPS schemes (`http://`, `ftp://`, `javascript:`, `file://`).
   - Enforces SSRF IP/hostname checks (`validateSsrfSafeUrl`), 10-second abort timeout, 10 MB size ceiling, magic-byte validation (`JPEG`/`PNG`/`WebP`), and SHA-256 deduplication.
   - Preserves catalog/identity checks (`productIdentityCompatibility`, verified-product enforcement on `P<id>`), dual bucket routing (`product-images` for verified `P` products vs `offer-display-images` for uncatalogued `O` offers, keeping `offer-images` crops private), and explicit operator confirmation + `rightsBasis` gates before any remote upload or DB publish.

---

## 4. `O51` Investigation Result

Inspecting [`Extracts/dukan-849797163-jeddah/staged-draft.json`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/Extracts/dukan-849797163-jeddah/staged-draft.json#L23-L113) and [`exports/offer-image-ref-map.json`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/exports/offer-image-ref-map.json#L20-L43) established why `O51` appeared in the reported CSV and how Step 1 / Step 3 handle it cleanly:

1. **Origin of `O51`:** Two extracted Dukan page-9 TV offers (`dukan-849797163-jeddah_p009_001` at `priceBefore: 1499` and `dukan-849797163-jeddah_p009_002` at `priceBefore: 2099`, both titled `CHiQ Czech 55-inch QLED 4K Smart TV`) received sequential short IDs `O51` and `O52` in `exports/offer-image-ref-map.json` (`nextSeq: 53`).
2. **Visual Subject Consolidation:** Both items share `matchedVisualSubjectKey: "generic:czech-55-inch-qled-4k-smart-tv"`. During staged consolidation, `_p009_001` became the representative (`isRepresentative: true`, `visualGroupMemberIds: ["dukan-849797163-jeddah_p009_001", "dukan-849797163-jeddah_p009_002"]`, `imageRef: "O51"`) and `_p009_002` became its sibling member (`isRepresentative: false`, `representativeOfferId: "dukan-849797163-jeddah_p009_001"`, `imageRef: "O51"`). Consequently, Step 1 correctly emits **one** consolidated row `O51`.
3. **Preservation Without Renumbering:** [`preserveOrAssignShortOfferRef`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L1302-L1337) checks an item's existing `O<n>` reference before touching `assignShortOfferRef`. As verified by Test 4 in [`wifranImageSourcingCsv001.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/__tests__/wifranImageSourcingCsv001.test.ts#L495-L553), re-exporting `dukan-849797163-jeddah` preserves `"O51"` without renumbering and without bumping `nextSeq` beyond `53`, and re-importing `O51,https://...` populates both group members (`_p009_001` and `_p009_002`) while keeping distinct offer prices intact on publish.
4. **Fixture Hygiene Isolation:** Test suites in `wifranImageSourcingCsv001.test.ts` use [`setCustomOfferRefMapPath`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/offerImageRefMapper.ts#L17) (`tempDir/offer-image-ref-map.json`) in `beforeEach`/`afterEach`, ensuring test runs never mutate [`exports/offer-image-ref-map.json`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/exports/offer-image-ref-map.json) (`nextSeq: 53` and all existing Dukan/Panda mappings preserved).

---

## 5. Backward Compatibility With Legacy CSVs

Both import pipelines tolerate legacy sourcing CSVs without failing, fetching page URLs, mutating leaflet metadata, or deleting historical `tmp` objects:

- **Recognized Legacy Row Keys:** `FPTSP`, `LPTSP`, `M_PAGE_FIRST`, `M_PAGE_LAST`, `SD`, `ED`, `SMN`, `REG`, and any `M_*` prefix.
- **Staged Importer ([`importStep2CsvIntoStagedDraft`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L1705-L1716)):** Increments `ignoredLegacyRowsCount`, appends a clear operator notice to `validationWarnings` (`validationWarnings` surfaced in [`StagedLeafletPreviewPanel.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/StagedLeafletPreviewPanel.tsx#L793-L812) under `data-testid="import-warnings-banner"`), issues **zero** `fetch` calls for `FPTSP`/`LPTSP` URLs, leaves `draft.header` untouched, and does not delete any remote `tmp` assets.
- **Direct Importer ([`validateProductImageCsvImport`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/productImageEnrichmentService.ts#L789-L802) & [`uploadApprovedProductImagesToDb`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/productImageEnrichmentService.ts#L1026-L1041)):** Marks legacy rows with `status: 'legacy_ignored'`, populates `ignoredLegacyRowsCount` and `warnings` (displayed cleanly in [`ImageEnrichmentWorkflow.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/ImageEnrichmentWorkflow.tsx#L499-L512)), keeps `validation.ok === true` when all `P`/`O` rows are valid, and skips legacy rows safely during upload.

---

## 6. Stage 2 Metadata Ownership & Publish Safety

- **Single Source of Truth:** [`LeafletMetadataService`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts) (`confirmed_metadata.json`) + Stage 2 metadata UI own leaflet-level `supermarketId`, geographic scope (`national`/`region`/`city`), and offer validity dates (`validFrom` / `validTo`).
- **CSV Cannot Overwrite Leaflet Metadata:** [`importStep2CsvIntoStagedDraft`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L2001-L2038) never requires `SD`/`ED`, returns empty `metadataUpdated: {}`, never modifies `draft.header` or per-item `validFrom`/`validTo` from CSV rows, and sets `requiresOperatorMetadataConfirmation: true` (opening [`MetadataCompletionModal`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/MetadataCompletionModal.tsx)) **only** when existing draft header metadata is missing or invalid.
- **Fail-Closed Publish Gate:** [`publishStagedLeafletDraftToDb`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L2385-L2401) validates both draft header completeness and `metadataService.validatePublishReadiness(...)`, rejecting publication (`PUBLISH_BLOCKED`) whenever `confirmed_metadata.json` is absent, unconfirmed, or mismatched with header metadata — even if a legacy CSV supplied `SD`/`ED`/`SMN`/`REG`.

---

## 7. Updated Sourcing Agent Prompt & External Instructions Notice

Updated prompt documentation in:
- [`docs/WifranTeamFeedback/Wifran-07G-Manual-CSV-Product-Image-Enrichment-Pilot.md`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/docs/WifranTeamFeedback/Wifran-07G-Manual-CSV-Product-Image-Enrichment-Pilot.md#L77-L97)
- [`docs/WifranTeamFeedback/Wifran-07J-Hybrid-Product-and-Offer-Image-Enrichment.md`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/docs/WifranTeamFeedback/Wifran-07J-Hybrid-Product-and-Offer-Image-Enrichment.md#L80-L95)

> [!IMPORTANT]
> **Manual External Update Required:** Repository markdown docs have been updated, but any external ChatGPT Custom GPT, Project, or AI Skill instructions hosted outside this repository are **not** synced automatically. You must manually update your external image-sourcing agent/Custom GPT system instructions to stop inspecting leaflet page URLs and stop emitting `FPTSP`, `LPTSP`, `SD`, `ED`, `SMN`, `REG`, or `M_*` rows (return `Image_Ref,image_url` for `P`/`O` rows only).

---

## 8. Offline Verification Commands & Observed Results

All checks ran strictly offline using mocked Supabase clients, mocked DNS resolution (`93.184.216.34` with real `net.isIP`), and mocked `globalThis.fetch`:

1. **Target CSV / UI / Stage-3 Suite (run post-final code/test edit; `exports/offer-image-ref-map.json` stayed at `"nextSeq": 53`):**
   ```powershell
   npm run typecheck; npx vitest run src/shared/utils/__tests__/wifran07jPhase1StagedDraft.test.ts src/shared/utils/__tests__/wifran07jPhase2StagedImport.test.ts src/shared/utils/__tests__/wifran07jStep3Importer.test.ts src/shared/utils/__tests__/wifran07jPhase4AtomicPublish.test.ts src/shared/utils/__tests__/wifranImageSourcingCsv001.test.ts src/renderer/src/components/catalog/__tests__/MetadataCompletionModal.test.tsx src/renderer/src/components/catalog/__tests__/ImageEnrichmentWorkflow.test.tsx src/renderer/src/components/catalog/__tests__/StagedLeafletPreviewPanel.test.tsx src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx
   ```
   - `npm run typecheck` (`tsconfig.node.json` & `tsconfig.web.json`): **PASSED** (0 errors).
   - Vitest: **`9/9` test files, `99/99` tests PASSED** (`9.79s`):
     - `wifran07jPhase1StagedDraft.test.ts`: `11/11`
     - `wifran07jPhase2StagedImport.test.ts`: `16/16`
     - `wifran07jStep3Importer.test.ts`: `20/20`
     - `wifran07jPhase4AtomicPublish.test.ts`: `2/2`
     - `wifranImageSourcingCsv001.test.ts`: `15/15` (all 15 milestone-specific contract, `O51` reproduction, zero-`tmp`, legacy-ignore, SSRF/URL/ref-rejection, approval-gate, and `PUBLISH_BLOCKED` tests)
     - `MetadataCompletionModal.test.tsx`: `4/4`
     - `ImageEnrichmentWorkflow.test.tsx`: `5/5`
     - `StagedLeafletPreviewPanel.test.tsx`: `10/10`
     - `importPageSelectionUi.test.tsx`: `16/16`

2. **Isolated Stage 1/2 Scope & Live-UAT Regression Check:**
   ```powershell
   npx vitest run src/main/metadata/__tests__/liveUatFix001.test.ts src/main/metadata/__tests__/importPageSelectionScope.test.ts
   ```
   - Vitest: **`2/2` test files, `44/44` tests PASSED** (`3.39s`) (combined 11-suite coverage across prior run + isolated runs: **`11/11` files, `143/143` tests PASSED**).
   - Note: `importPageSelectionScope.test.ts` and `liveUatFix001.test.ts` invoke [`initializeStagedDraftFromPackage`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts#L480) without isolating `setCustomOfferRefMapPath`; [`exports/offer-image-ref-map.json`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/exports/offer-image-ref-map.json) was restored to `"nextSeq": 53` and verified unchanged after all subsequent runs.

3. **Final Production Build & Ref-Map Check (executed after all code/test edits):**
   ```powershell
   npm run build; Get-Content exports/offer-image-ref-map.json | Select-Object -First 4
   ```
   - `npm run build` (`typecheck` + `electron-vite build`): **PASSED** (exit code `0`; emitted `out/main/index.js`, `out/preload/index.js`, and `out/renderer/assets/index-BOqbPCQm.js`).
   - `exports/offer-image-ref-map.json`: confirmed `"nextSeq": 53`.

---

## 9. Modified & Added Files

### Source Files Modified (8)
- [`src/shared/types/stagedDraft.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/stagedDraft.ts) — added optional `ignoredLegacyRowsCount?: number` on `ImportStep2CsvResult`.
- [`src/shared/types/productImageEnrichment.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/productImageEnrichment.ts) — added `'legacy_ignored'` row status plus `ignoredLegacyRowsCount?: number` and `warnings?: string[]` on `CsvValidationSummary`.
- [`src/main/db/stagedLeafletDraftService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts) — retired remote `'tmp'` boundary uploads, added `resolveLocalLeafletPreviewPages`, simplified Step 1 export to `P`/`O` only via `preserveOrAssignShortOfferRef`, updated Step 3 CSV ingestion to enforce `P`/`O` refs while safely ignoring legacy rows and preserving Stage 2 metadata.
- [`src/main/db/productImageEnrichmentService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/productImageEnrichmentService.ts) — cleanly ignores legacy `FPTSP`/`LPTSP`/`SD`/`ED`/`SMN`/`REG`/`M_*` rows with `legacy_ignored` + warnings during validation and skipped-row handling during upload.
- [`src/renderer/src/components/catalog/StagedLeafletPreviewPanel.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/StagedLeafletPreviewPanel.tsx) — updated Stage 3 sourcing UI copy, added `import-warnings-banner`, replaced public URL links with local page preview modal (`Preview Page X (Local)` via `local-file://get?path=...`), and opens `MetadataCompletionModal` only on incomplete/invalid metadata.
- [`src/renderer/src/components/catalog/MetadataCompletionModal.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/MetadataCompletionModal.tsx) — updated metadata confirmation helper copy.
- [`src/renderer/src/components/catalog/ImageEnrichmentWorkflow.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/ImageEnrichmentWorkflow.tsx) — aligned CSV contract copy and surfaced non-blocking ignored-legacy-row notices + `legacy_ignored` row badge.
- [`src/renderer/src/pages/ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx) — updated metadata page input hint to reference local boundary previews instead of `tmp` uploads.

### Documentation Updated (2)
- [`docs/WifranTeamFeedback/Wifran-07G-Manual-CSV-Product-Image-Enrichment-Pilot.md`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/docs/WifranTeamFeedback/Wifran-07G-Manual-CSV-Product-Image-Enrichment-Pilot.md) — updated copy-ready AI sourcing agent prompt for `P`/`O` rows only.
- [`docs/WifranTeamFeedback/Wifran-07J-Hybrid-Product-and-Offer-Image-Enrichment.md`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/docs/WifranTeamFeedback/Wifran-07J-Hybrid-Product-and-Offer-Image-Enrichment.md) — added `WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001` addendum and simplified agent prompt.

### Tests Modified (5) & Added (1)
- Added: [`src/shared/utils/__tests__/wifranImageSourcingCsv001.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/__tests__/wifranImageSourcingCsv001.test.ts) (15 tests, isolated `setCustomOfferRefMapPath`).
- Modified: [`src/shared/utils/__tests__/wifran07jPhase1StagedDraft.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/__tests__/wifran07jPhase1StagedDraft.test.ts)
- Modified: [`src/shared/utils/__tests__/wifran07jPhase2StagedImport.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/__tests__/wifran07jPhase2StagedImport.test.ts)
- Modified: [`src/main/metadata/__tests__/importPageSelectionScope.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/importPageSelectionScope.test.ts)
- Modified: [`src/renderer/src/components/catalog/__tests__/MetadataCompletionModal.test.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/__tests__/MetadataCompletionModal.test.tsx)
- Modified: [`src/renderer/src/components/catalog/__tests__/StagedLeafletPreviewPanel.test.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/__tests__/StagedLeafletPreviewPanel.test.tsx)

### Report Added (1)
- Added: [`WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001-REPORT.md`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001-REPORT.md)

---

## 10. Live API & Storage Mutation Guarantee

- **Zero** live Gemini or Mistral AI API requests were issued anywhere during implementation or verification.
- **Zero** live Supabase database writes, storage uploads, or remote storage deletions (`tmp` or otherwise) were executed during implementation or verification.
- [`exports/offer-image-ref-map.json`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/exports/offer-image-ref-map.json) remains at its pre-task state (`"nextSeq": 53` with all existing entries intact), and no database migrations or edits to the frozen `wifran.extractor.offer/2.0` offer contract or OCR models were performed.

