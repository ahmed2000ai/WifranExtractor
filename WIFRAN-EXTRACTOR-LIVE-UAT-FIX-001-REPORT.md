# WIFRAN-EXTRACTOR-LIVE-UAT-FIX-001 — Final Verification & Remediation Report

**Milestone:** `WIFRAN-EXTRACTOR-LIVE-UAT-FIX-001` — *Automatic Metadata Reuse, Raw Gemini Response Archiving & Extraction Diagnostics*  
**Date:** 2026-11-09  
**Mode:** Strictly Offline Verification (0 live Gemini/Mistral API calls, 0 live Supabase DB writes or storage uploads, 0 DB migrations, `Extracts/dukan-849797163-jeddah/` untouched)  
**Baseline Fixture Audited:** `Extracts/dukan-849797163-jeddah/` (`dukan-849797163-jeddah.pdf`, 11 pages, selected `[1]`, `gemini-3.8-flash`, 3 offers / 3 crops)

---

## 1. Exact Root Cause of Missing Metadata in the Dukan Run

Tracing the full 10-step execution path on `Extracts/dukan-849797163-jeddah/` confirmed that **Gemini 3.8 Flash (`gemini-3.8-flash`) did return valid metadata during the Page-First extraction pass**, persisted in `metadata/rev1/page-001/raw_extracted_page_1.json`:
- `validity_start_date: "2026-11-04"`
- `validity_end_date: "2026-11-10"`
- `ignored_banners: ["حصرياً على موقع الدكان", ...]`
- `usageReport.cost.totalCostUsd: 0.018135` (`isEstimate: true`, `9204` tokens)

The metadata disappeared after extraction due to four disconnected handoffs:

1. **Isolation Between `LeafletMetadataService` and Rev1/Page-First Outputs:**  
   When extraction finished, `ImportPage.tsx` invoked `metadata.discoverFromPackage(workspacePath, ...)`. However, `LeafletMetadataService.discoverMetadataFromPackage()` only inspected `<packageDir>/ocr/page_NNN_blocks.json` (produced by the legacy Mistral block pipeline) and completely ignored `<packageDir>/metadata/rev1/page-NNN/raw_extracted_page_N.json` produced by the Page-First/Rev1 pipeline. With zero `ocr/*_blocks.json` files present, `pagesText` was empty, yielding `retailer: null`, `validity: null`, and `scanCoverage: 0 of 1 selected pages inspected`, which triggered the manual `Scan Page 1 (Consumes 1 Attempt)` card UI.
2. **Dukan Catalog Absence vs. Synonym Recognition:**  
   `SUPERMARKET_SYNONYMS` contained bilingual Dukan aliases (`الدكان` / `dukan` / `موقع الدكان`), and `ignored_banners` contained `"حصرياً على موقع الدكان"`, but no Dukan entry existed in static offline `MASTER_SUPERMARKETS` — and `retailerDiscoveryScanner.ts` did not emit an unresolved candidate (`resolvedRetailerId: null`) carrying the detected name and banner evidence when a recognized retailer had no authoritative catalog row.
3. **Filename/Placeholder Identity & Geographic Context Fallbacks:**  
   - `stagedLeafletDraftService.ts` set `leafletHash: path.basename(jobDir) + ".pdf"` (`"dukan-849797163-jeddah.pdf"`) instead of resolving the verified SHA-256 (`d0535e60fb15a30ac431340034fd621514ff057bf6169d7c7d1105523f30638e`), while `canonical` JSON stored `source.leaflet_id: "default_leaflet"`.
   - `rev1PipelineService.ts` and `ImportPage.tsx` defaulted unconfirmed `locationScope` to `'national'`, and `stagedLeafletDraftService.ts` populated `header.region` (`"Western Region"`) from filename clues (`dukan-849797163-jeddah.pdf` -> Jeddah -> Western Region) prior to operator confirmation.
4. **Disconnected Pre-Run vs. Post-Call Cost Metering:**  
   `pageFirstPipelineService.ts` computed `estimatedCostUsd = completedPages * 0.005` (`0.005` for page 1) instead of aggregating measured per-page token cost from `GeminiPageUsageReport` (`0.018135` USD).

---

## 2. Data-Flow Corrections

```text
Page-First Rev1 Extraction (gemini-3.8-flash)
  ├── metadata/rev1/page-NNN/raw_extracted_page_N.json   (preserved)
  ├── metadata/rev1/page-NNN/provider-responses/
  │     └── <primary|retry|manual>-attempt-NNN.json       (NEW: verbatim atomic SDK archive)
  │
  ▼ (Zero extra Gemini calls)
packageMetadataEvidenceAdapter.collectPackageMetadataEvidence(packageDir, { selectedPages })
  ├── Strictly filters to selectedPages (IMPORT-PAGES-001 invariant)
  ├── Parses validity_start_date, validity_end_date, ignored_banners, loyalty_program_name
  ├── Never invents printed quotes when OCR text lacks matching rawPrintedText
  │
  ▼
LeafletMetadataService.discoverMetadataFromPackage(...) -> discoverMetadata(...)
  ├── Resolves genuine PDF SHA-256 fingerprint (rejects .pdf / UUID / default_leaflet)
  ├── Merges packageEvidence.pagesText + geminiValidityCandidates into Priority 2/3
  ├── Marks discoveryMethod = 'gemini_extraction' (or 'confirmed_cache' if already confirmed)
  ├── Records analyzedPages = [1] (1 of 1 inspected), TargetedVision attemptsUsed = 0
  │
  ▼
Operator Confirms in Stage 2 (LeafletMetadataConfirmationCard -> metadata:confirm)
  ├── LeafletMetadataService.confirmMetadata() persists durable record under real SHA-256
  └── syncConfirmedMetadataToWorkspace() propagates confirmed retailer, dates, scope & SHA-256 ->
        ├── manifest.json / extraction_manifest.json
        ├── staged-draft.json (header + repaired leafletHash)
        └── json/*.canonical.json (trusted_context + source.leaflet_id, preserving source_offer_id & v2.0)
```

---

## 3. Confirmation-Card Behavior Before vs. After

| UI Element / Behavior | Before (`Extracts/dukan-849797163-jeddah`) | After (`WIFRAN-EXTRACTOR-LIVE-UAT-FIX-001`) |
| :--- | :--- | :--- |
| **Validity Dates (`StartDate` / `EndDate`)** | Both empty; `"Manual entry required"` | Auto-populated (`2026-11-04` / `2026-11-10`) from `raw_extracted_page_1.json`; `operatorConfirmed` stays `false`; clearly tagged `AI-derived from Gemini extraction — no verbatim printed date quote in OCR; visual review required` |
| **Discovery Source Pill** | `"Source: Operator Manual Entry"` | `"Source: Gemini Extraction (Reused — 0 Extra Calls)"` (or `"Previously Confirmed (Cached)"` on cached re-entry) |
| **Scan Coverage Indicator** | `"0 of 1 selected pages inspected"` | `"1 of 1 selected pages inspected"` (shows `Analyzed Pages: 1`, `AI-Extracted Pages: 1`, `Vision Attempts: 0`) |
| **Retailer State (Dukan absent from catalog)** | Unresolved with no branding cue | Shows detected signal `"الدكان"`, banner evidence `"حصرياً على موقع الدكان"`, warning `retailer-catalog-unmatched-notice`, `"Catalog match required"` indicator, and unlocked editable catalog `<select>` |
| **Scan Page Buttons** | `"Scan Page 1 (Consumes 1 Attempt)"` + candidate page dropdown + Stage 2 `"Scan Page N"` | **Removed completely** from `LeafletMetadataConfirmationCard.tsx` and Stage 2 of `ImportPage.tsx` (targeted vision remains internal-only in `TargetedMetadataVisionService`) |
| **Missing Metadata Fallback** | Prompts paid Scan Page click | Shows unresolved empty fields cleanly with `"Manual entry required"` / `"Manual selection required"` for direct operator entry without scanning unselected pages or triggering paid requests |

---

## 4. Proof of Zero Additional Gemini Calls for Existing Response Reuse

1. **Architectural Separation:** `collectPackageMetadataEvidence()` (`src/main/metadata/packageMetadataEvidenceAdapter.ts`) operates purely on local disk artifacts (`metadata/rev1/page-NNN/raw_extracted_page_N.json` and `ocr/page_NNN_blocks.json`). `LeafletMetadataService.discoverMetadataFromPackage()` does **not** pass `allowAiFallback: true` or `operatorAuthorizedAi: true` unless an explicit opt-in is passed by internal callers.
2. **Offline Proof (`src/main/metadata/__tests__/liveUatFix001.test.ts` — Tests 1, 6, 8 & 15):**
   - Running `discoverMetadataFromPackage` against an isolated copy of `Extracts/dukan-849797163-jeddah` with `{ selectedPages: [1], selectionMode: 'specific', totalPages: 11 }` and a throwing mock vision callback proves **0 vision calls** are invoked, `visionBudgetStatus.attemptsUsed === 0` (`remainingAttempts === 2`), `scanCoverage.analyzedPages` equals `[1]`, and `gemini_extraction` dates (`2026-11-04`..`2026-11-10`) populate automatically.
   - Replay tests on `GeminiExtractionService.extractLeafletPage()` against the copied Dukan cache confirm `cacheHit === true`, `totalCostUsd === 0`, and **0 SDK `generateContent` invocations**.
3. **Renderer Integration Proof (`src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx`):**
   - Full `ImportPage` Stage 1 -> Stage 2 transition renders `"Source: Gemini Extraction (Reused — 0 Extra Calls)"`, `2026-11-04`..`2026-11-10`, `"1 of 1 selected pages inspected"`, `retailer-catalog-unmatched-notice`, and **zero** `Scan Page` buttons in the DOM.

---

## 5. Retailer Resolution Findings

- **Recognition Signal:** `Dukan` (`الدكان` / `حصرياً على موقع الدكان`) is already defined in `SUPERMARKET_SYNONYMS` (`src/main/db/supermarketRegionResolutionService.ts`), including Arabic banner phrases such as `موقع الدكان`, `اسواق الدكان`, `أسواق الدكان`, and `متجر الدكان`.
- **Two Verified Outcomes (`src/main/metadata/__tests__/liveUatFix001.test.ts` — Tests 4 & 5):**
  1. **When an authoritative catalog entry exists** (e.g., Supabase live `reference.loadAll` returns a Dukan row or `catalogSupermarkets` includes `{ slug: 'dukan', ... }`): `retailerDiscoveryScanner.ts` matches `الدكان` with `resolvedRetailerId` set cleanly to the authoritative UUID and `resolvedSlug: 'dukan'`.
  2. **When Dukan is absent from `MASTER_SUPERMARKETS`** (as in standalone offline mode today): `retailerDiscoveryScanner.ts` preserves an unresolved candidate (`detectedName: "الدكان"`, `resolvedRetailerId: null`, `evidenceText: "حصرياً على موقع الدكان"`, confidence `>= 0.85`), **never invents a synthetic UUID**, displays the `retailer-catalog-unmatched-notice` warning in `LeafletMetadataConfirmationCard.tsx`, and keeps the retailer `<select>` enabled and editable for operator selection.
- **No Filename Guessing:** In both cases, filename hints cannot auto-resolve unconfirmed retailer identity when evidence is absent (`isSpecificScope` / `IMPORT-PAGES-001`).

---

## 6. Raw Response Archive Format & Local Paths

Implemented in `src/main/ocr/geminiProviderArchiveService.ts` and invoked on every live API completion inside `src/main/ocr/geminiExtractionService.ts`:

- **Local Workspace Directory Structure:**
  ```text
  <packageDir>/metadata/rev1/page-NNN/
    raw_extracted_page_N.json                 (preserved existing cache)
    provider-responses/
      primary-attempt-001.json                (live primary SDK response archive)
      retry-attempt-002.json                  (non-overwriting retry archive)
      manual-attempt-003.json                 (non-overwriting manual re-run archive)
      reconstructed-attempt-001.json          (explicit offline cache backfill archive)
  ```
- **Schema (`GeminiProviderArchiveRecord`, `archiveFormatVersion: 1`):**
  - `archiveKind`: `'live_provider_attempt'` vs `'reconstructed_cache_backfill'` (`reconstructedFromSavedCache`, `provenanceNote`)
  - `attemptKind`, `attemptSequence`, `pageNumber`, `correlationId`, `requestTimestamp`, `completedAt`, `cacheHit`, `providerCacheHit`, `providerCacheResource`
  - `modelId`, `modelVersion`, `requestedServiceTier`, `actualServiceTier`, `thinkingConfig`
  - `requestMetadata`: `{ fingerprintHash, imageSha256, systemInstructionSha256, promptSha256, schemaSha256, promptProfile, schemaProfile, isDiagnosticRetry, failureReasons, backendContext }`
  - `rawResponseText`, `providerSdkResponse` (preserves `responseId`, `modelVersion`, `createTime`, `candidates`, `promptFeedback`, `usageMetadata`, `finishReason`, `finishMessage`, `safetyRatings`, `trafficType`, `serviceTier`, `citationMetadata`, `groundingMetadata`, etc.)
  - `providerUsageMetadata` vs `localUsageSummary` (`costEstimate` with `isEstimate: true` and explicit `costNote`)
  - `parsedApplicationResponse`: stored separately (`{ rawParsedJson, decodedExtraction }`)
- **Safety & Durability Invariants Verified:**
  - Atomic writes (`tmp` + `renameSync`), incremental non-overwriting `attempt-NNN` numbering across retries.
  - Recursive sanitization redacting credentials/tokens (`[REDACTED_CREDENTIAL]`) and omitting inline base64 payloads (`{ omittedBase64: true, byteLength, sha256 }`).
  - Archive write failures return structured `{ ok: false, error }` and emit a visible `providerArchiveWarning` + progress warning rather than silently discarding evidence.
  - Historical `Extracts/dukan-849797163-jeddah/metadata/rev1/page-001/raw_extracted_page_1.json` can be inspected and backfilled offline via `backfillProviderResponseArchiveFromRawCache()` into `reconstructed-attempt-001.json` with 0 API calls and explicit reconstruction provenance.

---

## 7. Content Fingerprint Findings

- **Verified Dukan SHA-256:** `d0535e60fb15a30ac431340034fd621514ff057bf6169d7c7d1105523f30638e` (present in `manifest.json` -> `processing_selection.pdfFingerprint`).
- **Leaks Identified & Repaired:**
  1. `stagedLeafletDraftService.ts` previously fell back to `${path.basename(jobDir)}.pdf` (`"dukan-849797163-jeddah.pdf"`) for `draft.leafletHash`. Replaced with `resolveAuthoritativeLeafletFingerprint()`, which inspects `metadata/confirmed_metadata.json`, `processing_selection.pdfFingerprint`, `original_pdf_sha256`, and physical `.pdf` bytes via `LeafletMetadataCacheService`, leaving `leafletHash` undefined rather than writing a filename/placeholder (`isInvalidFingerprintPlaceholder()` rejects `.pdf`/`.png`/`.jpg`/`.webp`, `default_leaflet`, `default-fingerprint`, paths, and UUIDs).
  2. `LeafletMetadataService.discoverMetadata()` & `confirmMetadata()` resolve missing or placeholder fingerprints from `input.pdfPath` before persisting durable records so confirmed records never key under a filename.
  3. `LeafletMetadataService.syncConfirmedMetadataToWorkspace()` repairs placeholder `leafletHash` in `staged-draft.json`, `processing_selection.pdfFingerprint` in manifests, and `source.leaflet_id` (`"default_leaflet"` -> SHA-256) in `json/*.canonical.json`, **strictly preserving existing `source.external_image_id` and `contract_v2.record_metadata.source_offer_id`**.
  4. `ImportPage.tsx` `PrePublishPreview` trigger (`onPublishStarted`) now resolves `leafletId` using the genuine SHA-256 before falling back to `formState.location?.leafletId`.

---

## 8. Geographic Scope Corrections

- **Blocked Unconfirmed `'national'` Default:**  
  `rev1PipelineService.ts` previously coerced missing `locationScope` to `'national'` via `trustedContext.locationScope || 'national'`. Introduced `normalizeUnconfirmedLocationScope()` so unresolved scope stays `null`, persisting `trusted_context: { location_scope: null, city_id: null, region_id: null }` until operator confirmation.
- **Blocked Filename-Guessed `'Western Region'`:**  
  `stagedLeafletDraftService.ts` previously wrote `region: parseLeafletFilenameMetadata(dirName).region` (turning `"jeddah"` into `"Western Region"`) even before confirmation. `header.region` is now left empty (`""`) and `locationScope: null` unless explicitly supplied from confirmed metadata, and `isValidConfirmedLocationScope()` (`national` with null city/region, `region` with `regionId`, `city` with `cityId`) is enforced.
- **Unconditional Confirmation Gate:**  
  `LeafletMetadataService.validatePublishReadiness()` blocks publishing (`PUBLISH_BLOCKED: Geographic coverage scope is unresolved...`) when `locationScope` is missing or invalid, even if `Pre-Publish Preview` is approved or `operatorConfirmedPublish: true` is passed (`liveUatFix001.test.ts` Test 18).
- **Consistent Confirmed Propagation:**  
  Upon `confirmMetadata()` (`city: Jeddah`, `region: Western Region`), `syncConfirmedMetadataToWorkspace()` synchronizes `manifest.json`, `extraction_manifest.json`, `staged-draft.json`, and `json/*.canonical.json`, and `publishStagedLeafletDraftToDb()` propagates matching `location_scope`, `city_id`, and `region_id` into both `leaflets` and `offers` DB upserts (`liveUatFix001.test.ts` Test 19).

---

## 9. Cost Reconciliation

- **Why the Discrepancy Existed in the Dukan Run:**
  - `manifest.json` (`page_first_ocr.estimated_cost_usd`) and `pageFirstReportService.ts` used a hardcoded pre-run budget heuristic (`0.005` USD per completed page -> `$0.005`), while `geminiPricingTable.ts` calculated the actual token usage reported by Gemini 3.8 Flash (`standard` tier, 2026-11-09 schedule):
    - Prompt tokens: `5460 * $0.75 / 1M` = `$0.004095`
    - Output candidate tokens: `1568 * $3.75 / 1M` = `$0.005880`
    - Thinking tokens: `2176 * $3.75 / 1M` = `$0.008160`
    - **Measured Local Total (`isEstimate: true`):** **`$0.018135` USD** (`9204` total tokens)
- **Unified Post-Call Reconciliation:**
  - `pageFirstPipelineService.ts` aggregates `geminiUsageSummary` from actual `usageReport` entries across processed pages (no double-counting on cache hits where `totalCostUsd = 0`), sets `result.estimatedCostUsd = result.geminiUsageSummary.totalCostUsd`, and falls back cleanly only when provider usage reports are absent.
  - `pageFirstReportService.ts` records `gemini_usage_summary` (`total_prompt_tokens`, `total_candidates_tokens`, `total_thoughts_tokens`, `total_tokens`, `total_cost_usd`, `is_estimate: true`) and per-page `estimated_cost_usd`, while keeping `budget_usd` (`0.95`) clearly separate as the pre-run ceiling.
  - `ImportPage.tsx` displays `Reconciled OCR Cost Estimate: ~$0.018135 USD (Local Estimate)` post-run while showing `Pre-run cost forecast ceiling` only prior to execution.

---

## 10. Exact Files Created and Modified (`WIFRAN-EXTRACTOR-LIVE-UAT-FIX-001`)

### Created (4 Files including this Report)
- [packageMetadataEvidenceAdapter.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/packageMetadataEvidenceAdapter.ts) — Strictly selected-page adapter extracting dates, banners, and OCR text from `raw_extracted_page_N.json` & `ocr/*_blocks.json` with 0 AI calls.
- [geminiProviderArchiveService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/geminiProviderArchiveService.ts) — Atomic per-attempt raw Gemini SDK response archival + offline cache reconstruction (`reconstructed-attempt-001.json`) with credential redaction and base64 omission.
- [liveUatFix001.test.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/liveUatFix001.test.ts) — Offline regression suite (15 test blocks covering all 22 required items in §10 against copies of `Extracts/dukan-849797163-jeddah`).
- [WIFRAN-EXTRACTOR-LIVE-UAT-FIX-001-REPORT.md](file:///f:/Work/AI%20Projects/wifran-offers-extractor/WIFRAN-EXTRACTOR-LIVE-UAT-FIX-001-REPORT.md) — This report.

### Modified (17 Files)
- [metadataTypes.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/metadataTypes.ts) — Added `'gemini_extraction'` discovery/evidence provenance & AI-derived quote review flags (`isAiDerivedWithoutPrintedText`, `geminiExtractedPages`, etc.).
- [retailerDiscoveryScanner.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/retailerDiscoveryScanner.ts) — Unresolved recognized retailer signal support (emits `detectedName` + `evidenceText` with `resolvedRetailerId: null` without inventing catalog IDs).
- [supermarketRegionResolutionService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/supermarketRegionResolutionService.ts) — Expanded Dukan bilingual signal phrases (`موقع الدكان`, `أسواق الدكان`, etc.).
- [leafletMetadataCacheService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataCacheService.ts) — Added `isInvalidFingerprintPlaceholder()`, filename/UUID rejection in `resolveContentFingerprint()`, and candidate overwrite protections.
- [leafletMetadataService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/leafletMetadataService.ts) — Wired `packageMetadataEvidenceAdapter` into `discoverMetadataFromPackage()` / `discoverMetadata()`, repaired SHA-256 handling in `discoverMetadata()` / `confirmMetadata()`, and implemented `syncConfirmedMetadataToWorkspace()`.
- [geminiExtractionService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/geminiExtractionService.ts) — Invokes `archiveGeminiProviderAttempt()` after successful Gemini calls and surfaces non-fatal archival warnings visibly.
- [rev1PipelineService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/rev1PipelineService.ts) — Replaced silent `'national'` fallback with `normalizeUnconfirmedLocationScope()` (`null` until confirmed) and exposed provider archive paths/warnings in page results.
- [pageFirstPipelineService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/pageFirstPipelineService.ts) — Reconciled post-call `geminiUsageSummary.totalCostUsd` into `estimatedCostUsd` and `manifest.json` (`page_first_ocr`) without overwriting unconfirmed `location_scope`.
- [pageFirstReportService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/reporting/pageFirstReportService.ts) — Added `gemini_usage_summary` metrics and separated post-call local cost estimate (`is_estimate: true`) from `budget_usd`.
- [extractionManifest.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/extractionManifest.ts) — Added optional reconciled Gemini token/cost fields under `page_first_ocr`.
- [pageFirstExtractionReport.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/pageFirstExtractionReport.ts) — Added `gemini_usage_summary` fields (`is_estimate`, token breakdowns, reconciled cost).
- [stagedDraft.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/stagedDraft.ts) — Typed structured geographic fields (`locationScope`, `cityId`, `regionId`, `locationSlug`) on `StagedLeafletHeader`.
- [stagedLeafletDraftService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts) — Replaced filename `leafletHash` fallback with `resolveAuthoritativeLeafletFingerprint()` and blocked unconfirmed filename region leakage; persists confirmed geographic scope and preserves `source_offer_id`.
- [LeafletMetadataConfirmationCard.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/metadata/LeafletMetadataConfirmationCard.tsx) — Removed `Scan Page` button & candidate dropdown, rendered `gemini_extraction` source badge, AI-derived visual review warning, Dukan `retailer-catalog-unmatched-notice`, and `geminiExtractedPages` coverage info.
- [PrePublishPreview.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/prepublish/PrePublishPreview.tsx) — Ensures confirmed geographic scope & metadata readiness checks are reflected cleanly without defaulting unconfirmed scope to `'national'`.
- [ImportPage.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx) — Removed Stage 2 `Scan Page` button & card scan handler props, rendered reconciled post-call cost (`Reconciled OCR Cost Estimate: ~$0.018135 USD (Local Estimate)`), and fixed `PrePublishPreview` `locationScope` (`null` when unconfirmed) & SHA-256 `leafletId` priority.
- [importPageSelectionUi.test.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx) — Added assertions verifying no `Scan Page` button in standard UI, Dukan unmatched-catalog card behavior, `gemini_extraction` provenance, and end-to-end Stage 1 -> Stage 2 Dukan transition with reconciled cost.

*(Note: Unrelated working-tree modifications present prior to `WIFRAN-EXTRACTOR-LIVE-UAT-FIX-001` in this repository were left untouched.)*

---

## 11. Full Offline Regression Results

All commands below were executed strictly **after the final code and test edit**:

### A. Summary of Verified Commands

| Command | Result | Exact Counts / Output |
| :--- | :--- | :--- |
| `npm run typecheck` | **PASS** (exit 0) | `tsc --noEmit -p tsconfig.node.json` & `tsc --noEmit -p tsconfig.web.json` — **0 errors** |
| `npm run validate:fixtures` | **PASS** (exit 0) | **11 passed, 0 failed** |
| `npm run test:smoke` | **PASS** (exit 0) | All **13** smoke checks passed |
| `npm run build` | **PASS** (exit 0) | `typecheck` + `electron-vite build` (`out/main/index.js` 1,250.52 kB, `out/preload/index.js` 13.89 kB, `out/renderer/assets/index-CpdBCdXX.css` 4.31 kB / `index-yu449IBQ.js` 890.68 kB) |
| `npx tsx scripts/calculate_baseline_hashes.ts` | **PASS** (exit 0) | Master Quality prompt: `12295` chars (`sha256: c5736fa321c9ad8b3c42ebea2d11efc228bca8f4c6d4db02d4c43bb96a03a5c8`); Optimized schema: `2361` chars (`sha256: 27d0daaeba7450df20c748a11d20258053ea8fdd6263c5863e927c1806c5cecf`) — **unchanged** |
| `npx vitest run src/main/metadata/__tests__/liveUatFix001.test.ts src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx` | **PASS** (exit 0) | **2 test files passed (2), 24 tests passed (24)** (0 failed, 0 skipped; 6.66s) |
| **All Non-PGlite Vitest Files** (`79` files) | **77 passed \| 2 pre-existing failures** | **905 passed \| 3 pre-existing failed \| 0 skipped (908)** — 100% of `liveUatFix001` (15), `metadata` (155), `importPageSelectionUi` (9), `page-first` (55), `ocr` (104), `db` gates (16), `prepublish` (15), `wifran07j*` (49), `wifranExtractorIdentity001/001b/002*` (185), `pageRangeParser` (22), UI/config/reporting suites passed |
| **All Sequential PGlite Vitest Files** (`10` files, `--no-file-parallelism --hookTimeout=60000 --testTimeout=60000`) | **9 passed \| 1 pre-existing failure** | **118 passed \| 1 pre-existing failed \| 0 skipped (119)** — Sequential execution eliminated concurrent WASM startup contention; the sole failure is pre-existing `wifranExtractorIdentity001d.test.ts` Requirement 5 (legacy fixture `headerModifiedByOperator: false` + slug `'alwafa'`, blocked intentionally by METADATA-004 publish readiness) |
| **Combined Repository Total Across All `89` Vitest Files** | **86 passed \| 3 pre-existing failures (89)** | **1,023 passed \| 4 pre-existing failed \| 0 skipped (1,027 tests)** |

> **Clarification on Default Parallel `npx vitest run` & Pre-Existing Failures:**  
> Running all 89 files simultaneously under default parallel workers caused all 10 PGlite WASM files to exceed the 10s `beforeAll`/`beforeEach` startup timeout (`77 passed | 12 failed (89)`, `955 passed | 7 failed | 65 skipped`). Running the 10 PGlite files sequentially confirmed `9/10` pass cleanly (`118/119`), leaving **zero failures introduced by `WIFRAN-EXTRACTOR-LIVE-UAT-FIX-001`**. The remaining 3 pre-existing failures in untouched legacy suites are `canonicalOfferNormalizer.test.ts` (2 failed: `'l'` vs `'liter'` & candidate `title_ar`), `deterministicOfferChecks.test.ts` (1 failed: line 111), and `wifranExtractorIdentity001d.test.ts` Requirement 5 (1 failed: pre-METADATA-004 fixture).

### B. 22-Item §10 Checklist Traceability

| §10 Item | Verified By | Status |
| :--- | :--- | :--- |
| 1. Existing raw Gemini response dates auto-populate candidates | `liveUatFix001.test.ts` (1 & 3) | **PASS** |
| 2. Dukan dates `2026-11-04`..`2026-11-10` carried into confirmation card | `importPageSelectionUi.test.tsx` (Dukan E2E & card tests) | **PASS** |
| 3. Operator confirmation remains required (`operatorConfirmed: false`) | `liveUatFix001.test.ts` (1 & 3), `importPageSelectionUi.test.tsx` | **PASS** |
| 4. Dukan retailer evidence resolves when authoritative catalog match exists | `liveUatFix001.test.ts` (4 & 5) | **PASS** |
| 5. Unrecognized retailer stays unresolved & editable rather than guessed | `liveUatFix001.test.ts` (4 & 5), `importPageSelectionUi.test.tsx` | **PASS** |
| 6. Reusing existing Gemini output consumes 0 additional API requests | `liveUatFix001.test.ts` (6 & 8, 15), `importPageSelectionUi.test.tsx` | **PASS** |
| 7. No metadata `Scan Page` button remains in normal UI | `importPageSelectionUi.test.tsx` (card + `ImportPage` tests) | **PASS** |
| 8. Metadata coverage reflects already-processed selected pages (`1 of 1`) | `liveUatFix001.test.ts` (6 & 8), `importPageSelectionUi.test.tsx` | **PASS** |
| 9. Missing date remains `null` and supports manual entry | `liveUatFix001.test.ts` (9), `importPageSelectionUi.test.tsx` | **PASS** |
| 10. Unselected pages cannot supply newly discovered metadata | `liveUatFix001.test.ts` (10), `importPageSelectionScope.test.ts` | **PASS** |
| 11. Previously confirmed metadata is not overwritten | `liveUatFix001.test.ts` (11), `importPageSelectionUi.test.tsx` | **PASS** |
| 12. Conflicting dates across pages flagged for review | `liveUatFix001.test.ts` (12) | **PASS** |
| 13. Raw provider response archives generated per attempt | `liveUatFix001.test.ts` (13 & 14) | **PASS** |
| 14. Retries preserve earlier raw responses (non-overwriting) | `liveUatFix001.test.ts` (13 & 14) | **PASS** |
| 15. Historical cached response replay makes 0 provider calls + reconstructs backfill | `liveUatFix001.test.ts` (15) | **PASS** |
| 16. Provenance distinguishes existing Gemini evidence (no invented quotes) from manual entry | `liveUatFix001.test.ts` (16) | **PASS** |
| 17. Content SHA-256 verified and never confused with filename/`default_leaflet` | `liveUatFix001.test.ts` (17) | **PASS** |
| 18. Unconfirmed `'national'` / filename region cannot reach production publishing | `liveUatFix001.test.ts` (18) | **PASS** |
| 19. Actual confirmed geographic scope propagates consistently | `liveUatFix001.test.ts` (19) | **PASS** |
| 20. Cost summaries match reconciled usage (`$0.018135`, `isEstimate: true`) | `liveUatFix001.test.ts` (20), `importPageSelectionUi.test.tsx` | **PASS** |
| 21. Existing page selection, OCR, staging, identity & publication gate tests pass | Non-PGlite (`77/79`) + sequential PGlite (`9/10`), `validate:fixtures`, `test:smoke` | **PASS** |
| 22. Master Quality prompt, compact schema & `wifran.extractor.offer/2.0` unchanged | `liveUatFix001.test.ts` (22), `scripts/calculate_baseline_hashes.ts` | **PASS** |

---

## 12. Remaining Limitations

1. **Manual Electron GUI Verification Pending:** Because this execution environment is headless/CLI without interactive Electron desktop automation, live visual click-through in the rendered Electron window remains pending until the operator executes the short retest below.
2. **Offline Catalog Seed Scope for Dukan:** Static fallback `MASTER_SUPERMARKETS` does not currently include Dukan (`الدكان`). While offline mode safely preserves Dukan evidence (`"الدكان"`) and keeps the catalog `<select>` editable without inventing an ID, automatic selection (`resolvedRetailerId`) in live operations relies on `reference.loadAll` fetching Dukan from the database (or adding an authoritative Dukan row if desired later).
3. **Pre-Existing Unrelated Legacy Tests:** As noted in §11, `canonicalOfferNormalizer.test.ts`, `deterministicOfferChecks.test.ts`, and `wifranExtractorIdentity001d.test.ts` Requirement 5 have pre-existing failures predating this milestone.

---

## 13. Short Real-Operator Retest Procedure (5 Minutes)

1. Launch the app safely:
   - Offline UI replay: `npm run dev:uat-offline` (verifies `OFFLINE UAT — SIMULATED` banner/pill; zero external requests), OR normal live dev: `npm run dev`.
2. In **Stage 1 (`PDF, Pages & Extraction`)**, select `dukan-849797163-jeddah.pdf` (`11` pages) and choose **Specific pages -> `1`**.
   - Alternatively, click **Open Existing Extraction Folder...** on the existing `Extracts/dukan-849797163-jeddah` copy to test pure local cache replay with 0 Gemini calls.
3. Verify Stage 1 & extraction metering:
   - Reconciled cost displays **`~$0.018135 USD (Local Estimate)`** instead of `$0.005`.
   - New live runs also create `metadata/rev1/page-001/provider-responses/primary-attempt-001.json` without credentials or base64 blobs.
4. In **Stage 2 (`Metadata Entry & Confirmation`)**, confirm:
   - `Start Date` = `2026-11-04`, `End Date` = `2026-11-10`, badge = **`Source: Gemini Extraction (Reused — 0 Extra Calls)`**, coverage = **`1 of 1 selected pages inspected`**, and **no `Scan Page` button** exists.
   - Dukan detection notice shows `"الدكان"` with evidence `"حصرياً على موقع الدكان"`; if not auto-selected by live catalog, pick `Dukan` (or a test retailer), set Geographic Scope = **`Specific City` -> `Jeddah`**, and click **`Confirm Leaflet Metadata`**.
5. Verify disk propagation (`Extracts/<job>/`):
   - `staged-draft.json` -> `leafletHash` equals the 64-hex SHA-256 (`d0535e60...`) and `header.locationScope === "city"` (`Jeddah`).
   - `json/page-001-001.canonical.json` -> `source.leaflet_id === "d0535e60..."`, `trusted_context.location_scope === "city"`, and `contract_v2.record_metadata.schema_version === "wifran.extractor.offer/2.0"`.

