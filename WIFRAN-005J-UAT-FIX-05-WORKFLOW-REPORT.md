# WIFRAN-005J-UAT-FIX-05 Workflow & Lulu Validity Date Resolution Report

**Date:** 2026-11-15  
**Scope:** Streamlined 5-Step Operator Workflow, Hybrid V3 Default, Lulu Printed Validity Date Normalization, Multi-City Geographic Preservation, and Post-Extraction Metadata Discovery  
**Verification Constraint:** Strictly offline (`0` live Gemini API calls, `0` live extractions, `0` Supabase writes/migrations). Existing UAT artifacts under `Extracts/` were preserved untouched.

---

## 1. Root Causes Diagnosed

### A. Lulu Printed Validity Dates Rendering Blank (`lulu-hypermarket-63800343-jeddah.pdf`, Page 3 of 85)
1. **Malformed Vision `start_date` Commentary:** Cached/model responses returned commentary concatenated directly onto the ISO date (e.g., `start_date: "2026-11-11Date validation: 2026-11-11 to 2026-11-17"`, `end_date: null`), causing plain ISO checks to fail and `<input type="date">` fields to render blank.
2. **Ordinal & Space/Pipe Date Range Regex Gap:** `validityDateParser.ts` did not handle English ordinal suffixes (`st`, `nd`, `rd`, `th`) or space/pipe-separated day pairs without dashes in formats such as `11th 17th NOVEMBER 2026` and `11th | 17th | NOVEMBER 2026`, nor equivalent Arabic/bilingual forms.
3. **Single-Day Exception Confusion (`ONE DAY ONLY`):** Single-day promo banners (`ONE DAY ONLY 11 Nov`) needed to be captured as exceptions (`SINGLE_DAY_OFFER_EXCEPTION` / `conflictingValidity`) rather than silently overwriting the full leaflet date window (`2026-11-11` to `2026-11-17`).
4. **Multi-City Geographic Scope Collapse:** Header banners listing multiple cities (`JEDDAH - MAKKAH - YANBU - TABUK - KHAMIS MUSHAITH - TAIF - MADINAH`) previously risked collapsing to a single city or guessing `national`.
5. **Retailer Banner Campaign Title Leak & Legacy Date Strings:** Unsanitized manifest/metadata values or retailer-name banners (`LULU HYPERMARKET`) could leak into `leafletTitle` or unnormalized `offerStartDate` / `offerEndDate`.

### B. Pre-Extraction Metadata Gate & Deferred Quarantine Leak
1. **Blocking Pre-Extraction Verification (`METADATA_VERIFICATION_REQUIRED`):** `startBatchExtraction` in `BatchOrchestrationService` and `BatchProgressDashboard.tsx` previously blocked extraction until every leaflet's metadata was verified upfront, adding manual friction and extra metadata-only Vision steps.
2. **Stale Deferred Metadata Quarantine Codes:** Running Hybrid V3 extraction *before* Step 3 metadata verification caused `adaptV3DecompositionToOfflineMatching` (`v3MatchingInputAdapter.ts`) to emit leaflet-level errors (`MISSING_SUPERMARKET_PROVENANCE`, `MISSING_CRITICAL_OFFER_DATES`, `INVALID_LOCATION_SCOPE`), which `hybridV3BatchProcessor.ts` persisted statically inside `staged-draft.json` (`blockingErrors`). Even after the operator verified metadata in Step 3, `getUnifiedBatchOffers()` still forwarded those stale codes, triggering `OFFER_QUARANTINED_CRITICAL_FACTS (EXPLICIT_BLOCKING_ERRORS)` at Step 5 preflight.

---

## 2. Implemented Changes

### Date Normalization, Sanitization & Multi-City Preservation
- [validityDateParser.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/validityDateParser.ts): Exported `extractStrictIsoDate`, `normalizeValidityRange`, and `detectSingleDayOfferException`; updated `detectDateException`, `tryParseSingleDate`, and `tryParseMonthNameRange` to normalize ordinal/space/pipe/dash English & Arabic/bilingual ranges, surface explicit `normalizationError` text instead of synthetic/filename dates when ambiguous, and preserve `ONE DAY ONLY` / `ليوم واحد فقط` exceptions separately.
- [metadataTypes.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/metadataTypes.ts) & [batchExtraction.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/batchExtraction.ts): Added `normalizationError` on `ValidityCandidate`, plus `validityNormalizationError`, `detectedCities`, `geographicNotice`, and `'hybrid_extraction'` evidence method on `LeafletMetadataScope`.
- [targetedMetadataVisionService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/targetedMetadataVisionService.ts): Added `analyzeExplicitGeographicScope` (retaining `detectedCities`, `geographicNotice`, and `locationScope: null` rather than guessing `national` or a single city), and updated `processModelResponse` and disk-cache reads in `executeTargetedVision` to re-run `normalizeValidityRange` cleanly on legacy cached `rawResponse` payloads (`$0` cache recovery).

### Streamlined Post-Extraction Metadata Discovery & Pipeline Safety
- [hybridExtractionV3.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/hybridExtractionV3.ts) & [hybridWorkflowOrchestrator.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/hybrid/hybridWorkflowOrchestrator.ts): Added optional `rawPageMetadata` (`validityStartDate`, `validityEndDate`, `pageCurrency`, `ignoredBanners`) on `HybridPageRunResult` from decoded page extraction output.
- [hybridV3BatchProcessor.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/hybridV3BatchProcessor.ts): Added `annotateSingleDayOfferException` (tagging affected offers with `SINGLE_DAY_OFFER_EXCEPTION` and `promoNotes` notice) and excluded deferred leaflet-level metadata codes (`MISSING_SUPERMARKET_PROVENANCE`, `MISSING_CRITICAL_OFFER_DATES`, `MISSING_OR_INVALID_VALIDITY_DATES`, `INVALID_LOCATION_SCOPE`) from static item-level `blockingErrors` / `quarantineReasons`.
- [batchOrchestrationService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/batchOrchestrationService.ts):
  - Switched `createBatch` default `extractionPipelineMode` to `'hybrid_v3'` while preserving `'legacy_rev1'` backward compatibility.
  - Removed pre-extraction `METADATA_VERIFICATION_REQUIRED` blocker in `startBatchExtraction` (while keeping explicit authorization and cost/budget guards).
  - Added `sanitizeLeafletMetadataFields` across manifest load, discovery, Vision results, metadata updates, and unified preview.
  - Added `discoverDraftMetadataAfterExtraction` to synthesize draft metadata from offline inspection, Hybrid V3 `rawPageMetadata` / `ignoredBanners` (`$0`), and cached Vision results, preventing retailer-name banners from overwriting `leafletTitle`.
  - Updated `getUnifiedBatchOffers` to dynamically prune deferred leaflet-level `MISSING_SUPERMARKET_PROVENANCE`, `MISSING_CRITICAL_OFFER_DATES`, `MISSING_OR_INVALID_VALIDITY_DATES`, and `INVALID_LOCATION_SCOPE` codes once resolved by verified leaflet metadata.
- [catalogPublicationService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/catalogPublicationService.ts): Enforced strict `/^\d{4}-\d{2}-\d{2}$/` (`startDate <= endDate`) validation (`INVALID_VALIDITY_DATES`) alongside `UNVERIFIED_LEAFLET_METADATA`, `MISSING_RETAILER_OR_SCOPE_METADATA`, and `PRODUCTION_PUBLICATION_BLOCKED` gates in `assessPublicationPreflight`.

### 5-Step Operator UI & Hybrid V3 Default
- [BatchWorkflowStepper.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/BatchWorkflowStepper.tsx): Added shared 5-step indicator (`1. Batch Setup` → `2. Extraction Progress` → `3. Review & Verify` → `4. Product Reconciliation` → `5. Publication`).
- [ImportPage.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx) & [MultiPdfSelector.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/MultiPdfSelector.tsx): Set `hybrid_v3` (`Hybrid V3 (Default)`) as the default pipeline and moved `Standard Rev1 (Legacy / Advanced)` to secondary placement without auto-starting paid API calls.
- [BatchProgressDashboard.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/BatchProgressDashboard.tsx): Integrated `BatchWorkflowStepper`, removed the pre-extraction metadata blocker on `▶ Start Extraction (Hybrid V3)`, kept explicit API authorization required, and displayed `geographicNotice` and `validityNormalizationError` in the metadata modal.
- [UnifiedBatchPreview.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/UnifiedBatchPreview.tsx): Added Step 3A per-leaflet Metadata Review & Independent Verification panel (Retailer, Title, Currency, Dates, Geographic Scope, multi-city notice, field evidence, normalization error, `Save & Verify Metadata`) and `⚠ ONE DAY ONLY Exception` offer badge.
- [ProductMatchingReview.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/ProductMatchingReview.tsx): Added Step 4/5 stepper and publication guard when any offer has `metadataVerified === false`.

---

## 3. Offline Build & Test Verification Results

Executed cleanly after the final edit (`npm run build` + `npx vitest run ...`):
- **Typecheck & Bundle (`npm run build`):** `tsc --noEmit -p tsconfig.node.json`, `tsc --noEmit -p tsconfig.web.json`, and `electron-vite build` passed with **0 errors**.
- **Vitest Offline Suite (`8` test files, `44` tests total — `44 passed`, `0 failed`, `0 skipped`):**
  1. `src/main/batch/__tests__/uatWorkflowFix05.test.ts` — **4 passed**:
     - Test 1: Lulu validity formats (ordinals, spaces, pipes, dashes, Arabic/bilingual) & explicit error on unparseable dates.
     - Test 2: `$0` cached Vision recovery on malformed Lulu `start_date` (`"2026-11-11Date validation: ..."` -> `2026-11-11` / `2026-11-17`) and multi-city preservation.
     - Test 3: End-to-end `Hybrid V3` default batch creation, extraction without pre-verified metadata, post-extraction draft discovery, `ONE DAY ONLY` (`SINGLE_DAY_OFFER_EXCEPTION`) flagging, unverified/multi-city Step 5 block, `PRODUCTION_UI` permanent block, and clean `DEVELOPMENT_TEST` preflight pass after Step 3 metadata verification.
     - Test 4: `legacy_rev1` manifest backward compatibility + load-time malformed date sanitization.
  2. `src/renderer/src/components/batch/__tests__/batchWorkflow005jFix05.test.tsx` — **3 passed**: `Hybrid V3 (Default)` vs `Standard Rev1 (Legacy / Advanced)`, no auto-start extraction, Step 3 Review & Verify editor, multi-city alert, `ONE DAY ONLY` badge, and Step 4/5 verification gate.
  3. `src/main/batch/__tests__/uatUnblock005j.test.ts` — **6 passed**.
  4. `src/renderer/src/components/batch/__tests__/batchUi005j.test.tsx` — **2 passed**.
  5. `src/renderer/src/components/batch/__tests__/batchMetadataAndCostUat005jFix02.test.tsx` — **2 passed**.
  6. `src/main/metadata/__tests__/automaticMetadataDiscoveryUat005jFix03.test.ts` — **6 passed**.
  7. `src/main/metadata/__tests__/pdfCoverMetadataExtractor.test.ts` — **1 passed**.
  8. `src/main/metadata/__tests__/leafletMetadataPublicationSafety.test.ts` — **20 passed**.

---

## 4. Remaining Limitations / Notes

- **Multi-City Publication Mapping:** When a leaflet banner lists multiple cities (`Jeddah, Makkah, Yanbu, ...`), the app preserves `detectedCities` and leaves `locationScope: null` intentionally rather than silently picking one city or marking it `national`. In Step 3, the operator must choose an explicit target scope (`City`, `Region`, or `National`) before `DEVELOPMENT_TEST` publication preflight can pass.
- **Production Database Lock:** `PRODUCTION_UI` publication remains strictly fail-closed (`PRODUCTION_PUBLICATION_BLOCKED`), pending canonical Migration 009 and explicit owner authorization.
- **Live Operator UAT Pending:** Automated checks verified everything offline against fixtures and mock providers; live single-page Lulu UAT (`$`) remains for operator execution below.

---

## 5. Instructions to Repeat Single-Page Lulu UAT (`lulu-hypermarket-63800343-jeddah.pdf`)

1. Launch the app (`npm run dev` or built Electron app) and open **Batch Import**.
2. Confirm **Hybrid V3 (Default)** is pre-selected in **1. Batch Setup** (`Standard Rev1 (Legacy / Advanced)` stays collapsed/unselected).
3. Upload `lulu-hypermarket-63800343-jeddah.pdf` (`85` pages), set **Specific Pages** to `3`, and click **Continue to Authorize & Extract**.
4. In **2. Extraction Progress**, confirm **Start Extraction (Hybrid V3)** is clickable *without* verifying metadata first; review the page-3 cost estimate, grant explicit live authorization, and run extraction.
5. Proceed to **3. Review & Verify**:
   - Confirm discovered draft metadata populates **Retailer** (`LuLu Hypermarket`), **Title** (`11.11 DEALS`), **Start Date** (`2026-11-11`), **End Date** (`2026-11-17`), and **Currency** (`SAR`) inside the date pickers (not blank).
   - Confirm the **Multi-City Notice** lists detected cities (`Jeddah, Makkah, ...`) without auto-selecting `national`, and any `ONE DAY ONLY` offers carry the **`⚠ ONE DAY ONLY Exception`** badge without overwriting `2026-11-11`–`2026-11-17`.
   - Select the target geographic scope (`Jeddah` / region / national as desired) and click **Save & Verify Metadata**.
6. Proceed to **4. Product Reconciliation** (`DEVELOPMENT_TEST` catalog matching), review matches, and confirm **5. Publication** unlocks cleanly for `DEVELOPMENT_TEST` while `PRODUCTION_UI` stays blocked.
