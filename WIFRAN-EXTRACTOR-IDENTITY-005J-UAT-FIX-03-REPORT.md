# WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-03 — Completion Report

## 1. Executive Summary

Resolved the leaflet metadata discovery failures observed on the Hybrid V3 multi-PDF UAT batch (`othaim-markets-72800415-jeddah.pdf` pages `[27, 41]`, `bin-dawood-222797436-jeddah.pdf` page `[24]`, and `hyper-panda-70800427-jeddah.pdf` pages `[7, 58]`) by implementing a strict three-tier metadata discovery pipeline without breaking the Fix-02 modal UI, per-PDF page-selection scope, or Hybrid V3 authorization gates:

- **Tier A — Free Offline Multi-Page Stream Inspection & Parser Fixes**: Stopped treating PDF `/Info` filename slugs (such as `"othaim-markets-72800415-jeddah"`, 30 chars) as embedded page text (`hasSearchableText`) or leakage into `leafletTitle`, expanded offline PDF stream inspection (`inspectPdfPagesOffline`) to inspect `[1, ...selectedPages]`, invalidated stale empty/filename-hint candidate caches, and updated `validityDateParser.ts` (`WEEKDAYS_MAP` prefix + bilingual adjacent-month support) so statements like `"Offers Valid From Wednesday 11 Nov To Tuesday 17 Nov 2026"` parse to `2026-11-11`..`2026-11-17`.
- **Tier B — Explicit Targeted AI Vision Metadata Discovery**: Wired `TargetedMetadataVisionService` (`gemini-3.8-flash` via Vertex AI Flex headers, `maxOutputTokens: 2048`, `thinkingConfig: { thinkingLevel: 'LOW' }`, 0 automatic retries) to inspect compressed cover (Page 1) and composite selected header/footer strips (top 30% + bottom 25% of interior selected pages bannered with exact PDF page numbers), with explicit operator checkbox authorization (`Discover with AI Vision`), separate cost estimator/cap (`estimateMetadataVisionCost`, `$0.025` max cap), SHA-256 disk response cache (`$0.0000` on cache hit), conflict detection across pages (`conflictingValidity`), per-field page provenance (`evidenceByField`), and strict filename/location anti-guessing rules.
- **Tier C — Operator Review & Confirmation**: Surfaced unresolved fields, page provenance badges, conflicting-date quick-apply choices, and manual editing inside `BatchProgressDashboard.tsx`. Automatically discovered values remain `Unverified` until the operator clicks `Save & Verify Metadata`.

**Guardrails preserved:** Zero live paid Gemini/Vertex API requests were executed during development or testing; zero live leaflet offer extractions, zero Supabase writes or migrations, and zero consumer/production publications occurred.

---

## 2. Root Cause Analysis (Observed on Real Local UAT Artifacts & Code)

1. **False `"Scanned cover page 1 embedded text (30 chars)"` & Filename Slug Leak**:
   - All inspected pages of `Leaflets/othaim-markets-72800415-jeddah.pdf` (61 pages; checked `[1, 27, 41, 61]`), `Leaflets/bin-dawood-222797436-jeddah.pdf` (102 pages; checked `[1, 24, 102]`), and `Leaflets/hyper-panda-70800427-jeddah.pdf` (111 pages; checked `[1, 7, 58, 111]`) are pure scanned raster PDFs (`0` `Tj`/`TJ` text operators).
   - `pdfCoverMetadataExtractor.ts` previously pushed `pdfDoc.getTitle()` (`"othaim-markets-72800415-jeddah"`) into `coverText` and set `hasSearchableText = true`; `leafletMetadataService.ts` also copied `coverInspection.pdfTitle` directly into `record.leafletTitle` (confirmed in `Extracts/batches/batch-2026-11-14T21-08-53-784c14/batch-manifest.json`).
2. **Selected Pages Omitted & Stale Empty Cache Reused**:
   - `batchOrchestrationService.ts` (`applyPackageMetadataDiscovery`) called `discoverMetadataFromPackage` without `selectedPages: leaflet.pagesToProcess`, so interior selected pages (`[27, 41]`, `[24]`, `[7, 58]`) were never inspected offline, and `discoverMetadata` could return stale unconfirmed cache entries (`analyzedPages: []`).
3. **Weekday Names Broke Validity Date Range Parsing**:
   - `validityDateParser.ts` defined `WEEKDAYS_MAP` without referencing it in `tryParseMonthNameRange`, `tryParseNumericDateRange`, or `tryParseSingleDate`, failing when `"Wednesday"` / `"Tuesday"` sat between `"From"` / `"To"` and day numbers (`"Offers Valid From Wednesday 11 Nov To Tuesday 17 Nov 2026"`).
4. **Tier B Vision Fallback Was Unwired**:
   - `TargetedMetadataVisionService.executeTargetedVision` previously handled only `mockResponse` / `mockResponsesByPage` and returned `'LIVE_CALL_DISABLED'` without an image preparation pipeline, Vertex AI Flex request path, response cache, `leaflet_title` / `currency` / `geographic_scope` / `source_page` schema fields, or UI button.

---

## 3. Code Changes Implemented

| File | Summary of Changes |
|---|---|
| `src/main/metadata/pdfCoverMetadataExtractor.ts` | Added `isLikelyFilenameSlug`, `inspectPdfPagesOffline` (content-stream-only extraction across `[1, ...selectedPages]` plus Form XObjects, never treating `/Info` slugs as page text), refactored `inspectPdfCoverPageOffline`, and added `prepareMetadataVisionImages` generating isolated `metadata/vision_cache/cover_p1.png` and stacked header (top 30%) + footer (bottom 25%) strips (`selected_headers_footers_<pages>.png`) without touching `<workspacePath>/pages/`. |
| `src/main/metadata/validityDateParser.ts` | Added `buildOptionalWeekdayPrefixRegex()`, bilingual adjacent month tolerance, Unicode dash support (`-`, `–`, `—`), and line-by-line scoring in `parseValidityDates` so weekday statements like `"Offers Valid From Wednesday 11 Nov To Tuesday 17 Nov 2026"` and Arabic/bilingual ranges parse deterministically. |
| `src/shared/utils/geminiPricingAndCostEstimator.ts` | Added `DEFAULT_METADATA_VISION_BUDGET_CAP_USD` (`$0.025`) and `estimateMetadataVisionCost` (~1,500 prompt / 350 output / 512 thinking tokens per image call on `gemini-3.8-flash` Flex), completely separate from 5-page Hybrid V3 extraction cost estimation. |
| `src/main/metadata/metadataTypes.ts`, `src/shared/types/batchExtraction.ts` | Added `MetadataFieldKey`, `MetadataFieldEvidenceSummary`, `MetadataValidityConflictSummary`, `evidenceByField`, `unresolvedFields`, `conflictingValidity`, `visionCostUsd`, `visionRequestsUsed`, `visionCacheHit`, `visionTargetPages`, and expanded `TargetedVisionMetadataResponse` with `source_page`, `leaflet_title`, `currency`, and `geographic_scope`. |
| `src/main/metadata/targetedMetadataVisionService.ts` | Expanded `TARGETED_METADATA_SYSTEM_INSTRUCTION` and `TARGETED_METADATA_RESPONSE_SCHEMA`; added Vertex AI Flex client execution (`getGeminiClient()` / injected `MinimalGenAiClient`, 0 retries, fail-closed on non-`STOP` `finishReason`, spend cap enforcement); added SHA-256 disk response cache (checked before ceiling check so cached re-scans cost `$0`); added supermarket synonym matching, explicit-only city/region matching (`MASTER_CITIES`/`MASTER_REGIONS`/`REGION_SYNONYMS`), slug filtering, and cross-page validity conflict detection. |
| `src/main/metadata/leafletMetadataService.ts` | Switched `discoverMetadataFromPackage` to `inspectPdfPagesOffline` across `[1, ...selectedPages]`, stripped filename-slug `pdfTitle` values, clarified raster status messaging, and prevented stale filename-pattern or empty cache reuse. |
| `src/main/batch/batchOrchestrationService.ts`, `src/main/ipc/batchExtractionIpc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts` | Passed `selectedPages: leaflet.pagesToProcess` in `applyPackageMetadataDiscovery`; computed `unresolvedFields` & `evidenceByField`; added `getMetadataVisionCostEstimate` and `discoverLeafletMetadataWithVision` (`explicitVisionAuthorization` gate); exposed both over IPC & `window.wifranExtractor.batch`. |
| `src/renderer/src/components/batch/BatchProgressDashboard.tsx` | Added Tier B **Targeted AI Vision Metadata Discovery** panel (estimated cost range, max cap, target pages `[1, ...selectedPages]`, authorization checkbox, `Discover with AI Vision` button), conflicting-validity selector buttons, per-field page provenance badges, filename-slug sanitization in the Title field, and explicit save gate (`Save & Verify Metadata`). |

---

## 4. Verification Results (Offline / Mocked Client + Real Local PDFs Read-Only)

> **Scope Clarification:** No live paid Gemini/Vertex API calls were executed. Visual LLM extraction behavior was verified offline via injected mock `MinimalGenAiClient` responses asserting exact Vertex AI Flex request configuration, budget caps, response caching, conflict detection, and failure handling. Real local UAT PDFs in `Leaflets/` were inspected offline for embedded stream text and isolated Ghostscript/Sharp vision image preparation only.

### Build & Typecheck (Post-Final-Edit)
- **`npm run build`** (`tsc --noEmit -p tsconfig.node.json`, `tsc --noEmit -p tsconfig.web.json`, `electron-vite build`): **Passed (exit code 0)**.
  - `out/main/index.js`: `2,002.78 kB`
  - `out/preload/index.js`: `16.62 kB`
  - `out/renderer/assets/index-BIFF5Bp-.css`: `53.69 kB`
  - `out/renderer/assets/index-BWn5xem8.js`: `1,255.45 kB`

### Target Verification Suites (`8 test files / 62 tests passed / 0 failed`)
Command:
```bash
npx vitest run src/main/metadata/__tests__/automaticMetadataDiscoveryUat005jFix03.test.ts src/renderer/src/components/batch/__tests__/batchMetadataVisionUat005jFix03.test.tsx src/renderer/src/components/batch/__tests__/batchMetadataAndCostUat005jFix02.test.tsx src/main/metadata/__tests__/pdfCoverMetadataExtractor.test.ts src/main/metadata/__tests__/leafletMetadataDiscovery.test.ts src/main/metadata/__tests__/leafletMetadataOperatorUAT.test.ts src/main/batch/__tests__/uatUnblock005j.test.ts src/renderer/src/components/batch/__tests__/batchUi005j.test.tsx
```

- **`automaticMetadataDiscoveryUat005jFix03.test.ts` (6 tests passed)**:
  - **Weekday / Bilingual Date Parsing & Slug Detection**: Confirmed `"Offers Valid From Wednesday 11 Nov To Tuesday 17 Nov 2026"`, `"تسري العروض من الأربعاء 11 إلى الثلاثاء 17 نوفمبر 2026"`, and `"11 نوفمبر NOV 2026 — 17 نوفمبر NOV 2026"` all resolve to `2026-11-11..2026-11-17`, and slug filenames are rejected.
  - **Test A (Othaim Pattern, Mocked `MinimalGenAiClient`)**: Ignored `/Info` slug (no `"30 chars"` false positive, `leafletTitle: null`), executed 2-call Flex `gemini-3.8-flash` Vision on `[1, 27, 41]`, resolved Othaim Markets + `"موسم العثيم"` + `2026-11-11..2026-11-17` (Page 41 provenance) + `"SAR"`, left `locationScope: null` (not guessed from `-jeddah`), kept `verified: false`, left `<workspace>/pages/` untouched, and served repeat scan from response cache (`0` calls, `visionCacheHit: true`, `$0`).
  - **Test B & C (BinDawood & Hyper Panda Patterns, Mocked `MinimalGenAiClient`)**: Resolved `BinDawood` and `Panda`, honored explicit printed `city` (`jeddah`) / `national` scope only when printed, and enforced `<= 2` Vision requests.
  - **Test D (Searchable Text PDF, Offline Only)**: Resolved `Othaim Markets` (Page 1) and `2026-11-11..2026-11-17` (Page 41) completely offline with 0 Vision calls while omitting slug titles.
  - **Test E, F, G (Safety Gates, Conflicts, Confirmation & Budget)**: Enforced `explicitVisionAuthorization: true`, failed closed on `finishReason: 'MAX_TOKENS'`, flagged Cover vs Interior conflicting dates in `conflictingValidity`, persisted `updateLeafletMetadata` across manifest reload, preserved `[5, 10]` scope, and verified `estimateMetadataVisionCost` (`$0.025` max cap).
  - **Real Local UAT PDF Offline Inspection**: Inspected `Leaflets/othaim-markets-72800415-jeddah.pdf`, `Leaflets/bin-dawood-222797436-jeddah.pdf`, and `Leaflets/hyper-panda-70800427-jeddah.pdf` offline — confirmed `hasSearchableText: false` and `pdfTitle: null`, and generated `cover_p1.png` + `selected_headers_footers_27_41.png` on Othaim into isolated temp `metadata/vision_cache/` without creating `<workspace>/pages/`.
- **`batchMetadataVisionUat005jFix03.test.tsx` (1 test passed)**: Verified UI strips stale filename slugs, disables `Discover with AI Vision` until checkbox authorization, renders page provenance (`Page 1 · AI Vision: "أسواق العثيم"`), displays conflicting validity picker (`Use Page 41: 2026-11-11 → 2026-11-17`), and persists operator-confirmed values via `Save & Verify Metadata`.
- **Regression Suites**: `pdfCoverMetadataExtractor.test.ts` (1 passed), `leafletMetadataDiscovery.test.ts` (24 passed), `leafletMetadataOperatorUAT.test.ts` (20 passed), `uatUnblock005j.test.ts` (6 passed), `batchUi005j.test.tsx` (2 passed), and `batchMetadataAndCostUat005jFix02.test.tsx` (2 passed).
- *Additional existing metadata suites checked separately*: `leafletMetadataIntegration.test.ts`, `leafletMetadataPublicationSafety.test.ts`, `leafletMetadataRealDocumentDiscovery.test.ts`, and `importPageSelectionScope.test.ts` (24 tests) all passed; two legacy pre-existing tests not modified by Fix-03 (`liveUatFix001.test.ts` legacy pricing assertions comparing `$0.0090675` vs `$0.018135`, and `leafletMetadataUatHardening.test.ts` Scenario 7 date-window fixture relative to system date `2026-11-15`) failed independently of these changes.
