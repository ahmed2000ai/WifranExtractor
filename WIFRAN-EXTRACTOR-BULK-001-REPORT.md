# WIFRAN-EXTRACTOR-BULK-001-REPORT
## Multi-Leaflet Batch Extraction and Unified Pre-Publish Preview

---

## 1. Executive Summary

This milestone successfully implements multi-leaflet batch extraction and unified pre-publish preview for the Wifran Offers Extractor. Operators can now select multiple supermarket PDF leaflets (or a single PDF), initiate extraction with one click, process each leaflet sequentially through the existing Gemini 3.8 Flash (`HIGH` thinking / Vertex AI Flex PayGo) extraction pipeline, and review all extracted offers in a single consolidated workspace with rich per-leaflet and global filtering.

**Key Achievements:**
- **Zero Duplication:** Reused the existing single-leaflet extraction engine (`pageFirstPipelineService`, `streamingPdfRenderService`, `geminiExtractionService`, `stagedLeafletDraftService`).
- **Controlled Concurrency:** Enforces sequential queue execution (concurrency = 1 Gemini request at a time) to honor Vertex AI Flex capacity.
- **Cache Reuse & $0 Token Cost:** Full reuse of existing verified local extractions (`staged-draft.json` or cached Gemini responses) at $0 cost and zero network calls.
- **Stable Batch-Scoped Keys:** Implemented format `${batchId}:${leafletId}:${sourcePage}:${sourceOfferId}`, preventing ID collisions across leaflets.
- **Brand & Complex Offer Preservation:** Retained bilingual brand evidence (`brand`, `brandAr`, `brandEn`), complex pack structures (inner packs, total content, customer purchase limits, free units).
- **Environment Isolation & Zero Mutations:** Production database (`swratbmclahjyekouned`) experienced **ZERO** writes or schema changes; development test project (`gykrbpykjhpyrdrinkuk`) remains clean and isolated; zero paid Gemini API calls during development.

---

## 2. Architecture Comparison

### 2.1 Original Single-PDF Architecture
```
[User Interface]
       │
       ▼ (Single PDF Selected)
[streamingPdfRenderService] ──► Renders pages to Extracts/<slug>/pages/
       │
       ▼
[pageFirstPipelineService] ──► Calls Gemini 3.8 Flash (Vertex AI Flex) per page
       │
       ▼
[Automatic Crop Construction] ──► Writes product_thumb_crop.webp & offer_card_crop.webp
       │
       ▼
[stagedLeafletDraftService] ──► Persists Extracts/<slug>/staged-draft.json
       │
       ▼
[PrePublishPreview] ──► Displays single leaflet offers & metadata
```

### 2.2 New Batch Orchestration Architecture
```
[User Interface: MultiPdfSelector]
       │  (Selects N PDFs, detects duplicates, parses filename metadata)
       ▼
[batchOrchestrationService: createBatch] ──► Extracts/batches/<batchId>/batch-manifest.json
       │
       ▼
[Sequential Extraction Queue (Concurrency = 1)]
       │
       ├─► Leaflet 1: [Cache Check] ──► (Hit: 0 API calls, $0 cost, loads draft)
       │
       ├─► Leaflet 2: [Miss: Streaming Render] ──► [PageFirst Gemini Flex] ──► [Local Crops] ──► [Staged Draft]
       │
       └─► Leaflet N: ...
       │
       ▼ (Atomically updates manifest after each state change)
[BatchProgressDashboard] ──► Real-time progress, cost aggregation, cancel/resume controls
       │
       ▼
[UnifiedBatchPreview] ──► Consolidated offers table across all leaflets
       │  - Filters by leaflet, retailer, category, status, search query
       │  - Stable keys: `${batchId}:${leafletId}:${page}:${offerId}`
       │  - Inspects product_thumb_crop & offer_card_crop side-by-side
       │  - Clean publication boundary (Status: extracted / ready_for_matching)
```

---

## 3. Files Created and Modified

| File | Type | Purpose |
|---|---|---|
| `src/shared/types/batchExtraction.ts` | **New** | Types for `BatchManifest`, `LeafletBatchItem`, `UnifiedBatchOffer`, `BatchTotals`, `BatchProgressEvent`, `BatchFilterOptions`. |
| `src/main/batch/batchOrchestrationService.ts` | **New** | Durable batch workspace orchestrator, sequential queue runner, atomic manifest persistence, and unified offers aggregator. |
| `src/main/batch/__tests__/batchOrchestration.test.ts` | **New** | 13 automated integration and regression tests covering multi-selection, caching, isolation, resume, cancellation, and safety. |
| `src/main/ipc/batchExtractionIpc.ts` | **New** | IPC endpoints for batch creation, execution, cancellation, resume, manifest retrieval, and unified offers query. |
| `src/renderer/src/components/batch/MultiPdfSelector.tsx` | **New** | UI component for multi-file PDF picker, duplicate detection banner, file size/page counts, and batch queue dispatch. |
| `src/renderer/src/components/batch/BatchProgressDashboard.tsx` | **New** | UI dashboard for real-time extraction progress, cost aggregation, per-leaflet status cards, cancel and resume controls. |
| `src/renderer/src/components/batch/UnifiedBatchPreview.tsx` | **New** | Unified multi-leaflet pre-publish preview table with filters, brand preservation, crop inspection modal, and publication gates. |
| `src/main/ipc/fileDialogIpc.ts` | **Modified** | Added `file:selectMultiplePdfs` with `inspectPdfFile` helper supporting multi-selection dialogs. |
| `src/main/ipc/registerIpcHandlers.ts` | **Modified** | Registered batch extraction IPC handlers. |
| `src/preload/index.ts` | **Modified** | Exposed `batch.*` and `files.selectMultiplePdfs` via secure context bridge. |
| `src/preload/index.d.ts` | **Modified** | Typed definitions for `window.wifranExtractor.batch` and `files.selectMultiplePdfs`. |
| `src/main/pdf/streamingPdfRenderService.ts` | **Modified** | Hardened workspace path handling to ensure original PDF is safely copied when workspace path is provided. |
| `src/renderer/src/pages/ImportPage.tsx` | **Modified** | Added top-level mode toggle ("Single Leaflet" vs "Batch Leaflets"), batch selector/progress/preview views, and recent batches table. |

---

## 4. Batch Manifest and Identifier Design

### 4.1 Storage Location
- Active Workspace: `Extracts/batches/<batchId>/batch-manifest.json`
- Offline UAT Workspace: `workspaces_uat/batches/<batchId>/batch-manifest.json`

### 4.2 Batch Identifier
- Format: `batch-${YYYY-MM-DDTHH-mm-ss}-${randomHex}`
- Example: `batch-2026-11-12T05-08-32-a4f10b`

### 4.3 Leaflet Identifier
- Format: `leaflet-${indexPadded}`
- Example: `leaflet-001`, `leaflet-002`

### 4.4 Stable Batch Offer Reference
- Format: `${batchId}:${leafletId}:${pageNumber}:${sourceOfferId}`
- Example: `batch-2026-11-12T05-08-32-a4f10b:leaflet-001:1:offer-005`
- **Isolation Guarantee:** Even if two leaflets from different supermarkets contain an identically named offer (e.g. `offer-001` on page 1), their batch keys remain distinct and fully namespaced.

### 4.5 Manifest Schema
```json
{
  "schemaVersion": "1.0",
  "batchId": "batch-2026-11-12T05-08-32-a4f10b",
  "createdAt": "2026-11-12T05:08:32.124Z",
  "updatedAt": "2026-11-12T05:08:34.502Z",
  "status": "completed",
  "workspaceDir": "F:\\Work\\AI Projects\\wifran-offers-extractor\\Extracts\\batches\\batch-2026-11-12T05-08-32-a4f10b",
  "executionMode": "flex",
  "model": "gemini-3.8-flash",
  "totals": {
    "totalPdfs": 2,
    "completedPdfs": 2,
    "failedPdfs": 0,
    "cancelledPdfs": 0,
    "totalPages": 2,
    "pagesProcessed": 2,
    "totalOffers": 12,
    "totalCostUsd": 0.0
  },
  "leaflets": [
    {
      "leafletId": "leaflet-001",
      "fileName": "noori-supermarket-229798534-jeddah.pdf",
      "filePath": "...",
      "fileSizeBytes": 1024,
      "fileFingerprint": "...",
      "pageCount": 1,
      "pagesProcessed": 1,
      "offersCount": 10,
      "estimatedCostUsd": 0.0,
      "status": "completed",
      "workspacePath": "F:\\...\\Extracts\\noori-supermarket-229798534-jeddah",
      "provenance": "cache",
      "metadata": {
        "supermarketId": "noori",
        "supermarketName": "Noori Supermarket",
        "locationScope": "city",
        "locationLabel": "Jeddah"
      }
    }
  ]
}
```

---

## 5. Queue Behavior and Concurrency

- **Sequential Dispatch:** Leaflets in a batch are processed strictly one at a time (`concurrency = 1`).
- **Flex Compliance:** Never launches concurrent Gemini calls across leaflets or pages, preventing Vertex AI Flex rate limits or 429 quota exhaustion.
- **Fail-Safe Iteration:** If an error occurs in Leaflet $k$, the error is recorded on that leaflet's record (`status = 'failed'`, `error = message`), and the queue continues with Leaflet $k+1$.
- **Batch Outcome States:**
  - `completed`: All leaflets completed successfully.
  - `completed_with_errors`: At least one leaflet succeeded, and at least one leaflet failed.
  - `failed`: All leaflets failed.
  - `cancelled`: Operator cancelled extraction.

---

## 6. Resume and Cancellation Handling

- **Atomic Writes:** Manifest writes use temporary file creation (`batch-manifest.json.tmp.*`) followed by atomic rename (`fs.promises.rename`), eliminating partial-write corruption risks.
- **Cancellation:**
  - Operator clicks **Cancel Batch**.
  - Active cancellation flag is set in `activeCancellations`.
  - Queue finishes or stops the current operation, marks all remaining `queued` leaflets as `cancelled`, sets batch status to `cancelled`, and saves manifest.
  - All completed leaflets, crops, and staged drafts are strictly preserved.
- **Resume:**
  - If a batch has status `cancelled`, `completed_with_errors`, or `failed`, the operator can click **Resume Unfinished**.
  - Only `failed` and `cancelled` leaflets are reset to `queued`; `completed` leaflets are skipped automatically.
  - Queue execution continues from the first unfinished leaflet.

---

## 7. Extraction Cache Behavior

- Before executing rendering or calling the Gemini API, `batchOrchestrationService` inspects the leaflet workspace for a valid existing extraction:
  - If `staged-draft.json` or `extraction_manifest.json` exists with matching PDF content fingerprint and extracted items:
    - Reuses the existing extraction immediately.
    - Sets `provenance = 'cache'`.
    - Sets `estimatedCostUsd = 0.0000`.
    - Increments `completedPdfs` and `offersCount` without any network calls.
- If fresh extraction is required, `geminiExtractionService`'s existing content-addressed cache checks each page image fingerprint, prompt profile, and schema profile, ensuring that identical page bytes are never billed twice.

---

## 8. Local Crop Handling

- **Product Thumbnail:** Resolves `product_thumb_crop.webp` from `Extracts/<slug>/crops/offer-XXX/product_thumb_crop.webp` or `metadata/rev1/page-XXX/crops/offer-XXX/product_thumb_crop.webp`.
- **Offer Evidence Crop:** Retains `offer_card_crop.webp` for operator inspection.
- **Secure Local Rendering:** Image paths are passed to the renderer using the secure `local-file://get?path=...` protocol.
- **Strict Privacy Isolation:** Local crops are strictly confined to local disk; no leaflet crops are uploaded to Supabase public storage buckets, and no local crop paths are exposed through consumer API fields.

---

## 9. Unified Preview Functionality

The `UnifiedBatchPreview` component delivers a unified operator workspace:
- **Batch Metrics Cards:** Total leaflets, unique retailers, total extracted offers, filter match count, total extraction cost.
- **Multi-Dimensional Filters:**
  - By Leaflet: dropdown of specific PDF leaflets.
  - By Retailer: dropdown of identified supermarkets (e.g. Noori, Dukan, Panda).
  - By Status: `extracted`, `reviewed`, `ready_for_matching`, `published`.
  - By Search Query: live substring match across Arabic title, English title, and brand name.
- **Consolidated Offer Table:**
  - Thumbnail display (`product_thumb_crop.webp`).
  - Bilingual titles (Arabic bold RTL, English LTR).
  - Brand name badge.
  - Retailer badge, Leaflet source file, page number, validity dates.
  - Promo price and original price with discount percentage.
  - Standardized quantities (size, pack count, total content, customer limits, free units).
  - Publication status badge.
- **Offer Inspection Modal:**
  - Side-by-side comparison of `product_thumb_crop.webp` and `offer_card_crop.webp`.
  - Detailed canonical metadata view.
  - "Open in Single Leaflet Editor" shortcut.

---

## 10. Brand Information Preservation

- Arabic and English brand fields (`brand`, `brandAr`, `brandEn`) are preserved during batch aggregation.
- The aggregator never assumes `unbranded` merely because a brand field is blank; it preserves the original value or `null`.
- Preserves brand confidence ratings (`high`, `medium`, `low`) from the extraction stage.
- Keeps all evidence intact for the upcoming intelligent catalog matching milestone.

---

## 11. Compatibility with Future Catalog Matching

The batch manifest and unified offers structure establish a clean interface for the upcoming catalog matching milestone:
1. All offers in the batch are indexed by stable `batchOfferKey`.
2. Extracted brand, category, bilingual product titles, declared quantities, and retailer IDs are readily available.
3. Matching stage will be able to retrieve candidates, submit unresolved offers to Gemini, propose catalog links, and update offer statuses from `extracted` to `ready_for_matching` without altering the batch architecture.

---

## 12. Database Safety Verification

- **Production UI Guard:** The normal Electron UI remains locked to `PRODUCTION_UI` (`swratbmclahjyekouned`).
- **Test Guard:** Automated vitest test suites target `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`).
- **Zero Mutations:** Bulk extraction operates entirely on the local file system (`Extracts/` and `Extracts/batches/`). No inserts, updates, deletes, or schema changes were performed on any database.
- **Quarantine Preserved:** All 58 historical production maintenance scripts remain quarantined under `assertProductionMaintenanceAuthorized`.

---

## 13. Automated Test Results

### 13.1 Batch Orchestration Test Suite (`src/main/batch/__tests__/batchOrchestration.test.ts`)
```
 ✓ src/main/batch/__tests__/batchOrchestration.test.ts (13 tests) 2509ms
     ✓ supports selecting multiple distinct PDFs and assigns unique leaflet IDs
     ✓ supports selecting a single PDF in batch mode without regression
     ✓ detects and suppresses duplicate PDF files by path and content fingerprint
     ✓ persists manifest atomically and reloads identically from disk
     ✓ preserves per-leaflet metadata without blending retailers or validity dates
     ✓ reuses existing verified extractions (Noori & Dukan fixtures) at $0 cost
     ✓ generates unique batch-scoped offer keys `${batchId}:${leafletId}:${pageNum}:${offerId}`
     ✓ resolves product_thumb_crop.webp and offer_card_crop.webp for all offers
     ✓ preserves brand information and complex quantities from extracted offers
     ✓ filters unified offers by leaflet, retailer, status, and search query
     ✓ cancels batch cleanly, preserving completed work while cancelling queued items
     ✓ handles leaflet failure gracefully and allows targeted resume
     ✓ confirms all batch offers are in extracted status with zero database mutations

Test Files:  1 passed (1)
Tests:       13 passed (13)
Duration:    4.62s
```

### 13.2 Environment Isolation Suite (`src/main/db/__tests__/environmentIsolation.test.ts`)
```
 ✓ src/main/db/__tests__/environmentIsolation.test.ts (14 tests) 3682ms
     ✓ Test A: Refuses production DB credentials for Antigravity automated test context
     ✓ Test B: Refuses development DB credentials for normal production UI context
     ✓ Test C: Development database config resolves strictly to development project ref
     ✓ Test D: Production UI database config resolves strictly to production project ref
     ✓ Test E: Missing development credentials fail fast with clear error
     ✓ Test F: Incomplete development credentials fail fast with clear error
     ✓ Test G: Development database schema and storage buckets exist (2127ms)
     ✓ Test H: Development writes and cleanup are restricted to development (1532ms)
     ✓ Test I: Node environment NODE_ENV alone cannot switch UI to development
     ✓ Test J: Development credentials cannot silently fall back to production credentials
     ✓ Test K: Dual environment status helper accurately reports both configurations
     ✓ Test L: Quarantined historical scripts fail closed without explicit dual authorization
     ✓ Test M: Canonical migration table inventory matches development schema
     ✓ Test N: Reference data loader functions correctly in development

Test Files:  1 passed (1)
Tests:       14 passed (14)
Duration:    4.25s
```

### 13.3 Accuracy and Pre-Publish Suite (`npm run test:accuracy`)
```
Test Files:  12 passed (12)
Tests:       72 passed (72)
Failures:    0
Duration:    3.87s
```

### 13.4 Smoke and Fixture Validation (`npm test`)
```
> tsc --noEmit -p tsconfig.node.json (OK)
> tsc --noEmit -p tsconfig.web.json (OK)
> tsx scripts/validateFixtures.ts (11 passed, 0 failed)
> tsx scripts/runLocalSmokeTests.ts (All smoke tests passed)
```

---

## 14. Build Results

Full Electron production build executed via `npm run build`:
```
> electron-vite build

vite v5.4.21 building SSR bundle for production...
out/main/index.js                                       1,501.60 kB
✓ built in 2.87s

vite v5.4.21 building SSR bundle for production...
out/preload/index.js                                       14.88 kB
✓ built in 27ms

vite v5.4.21 building for production...
../../out/renderer/index.html                              0.56 kB
../../out/renderer/assets/index-Bl8B4IMb.css               4.78 kB
../../out/renderer/assets/index-DEVqFj2N.js            1,041.22 kB
✓ built in 3.00s
```
**Build Status:** Clean compilation, 0 errors, 0 warnings.

---

## 15. Remaining Limitations

1. **Intelligent Catalog Matching Deferred:** Matching unresolved offers to existing catalog products is out of scope for this milestone and will be implemented in the next milestone.
2. **Sequential Queue Only:** Active Gemini requests remain strictly sequential (`concurrency = 1`) to honor Vertex AI Flex capacity limits. Parallel worker pools are not enabled.
3. **No Automatic Publication:** Extracted offers remain in local staging until explicitly approved through the future matching and publication workflow.

---

## 16. Instructions for Operator Acceptance Testing

1. **Launch the Application:**
   Run `npm run dev` to start the Electron desktop application.
2. **Access Batch Extraction Mode:**
   - On the Import Page, observe the top-right toggle switch: **📄 Single Leaflet** vs **📑 Batch Leaflets**.
   - Click **📑 Batch Leaflets**.
3. **Select Multiple PDFs:**
   - Click **➕ Add PDF Leaflets** (or click inside the dashed drop zone).
   - In the file dialog, select multiple supermarket PDF files (e.g. hold `Ctrl` or `Shift`).
   - Observe the table of selected leaflets showing filename, size, detected page count, and parsed metadata.
   - Test duplicate prevention: attempt to select the same file again; observe the amber banner skipping the duplicate.
4. **Initiate Batch Extraction:**
   - Click **🚀 Start Batch Extraction**.
   - Observe the transition to the **Batch Extraction Queue Dashboard**.
   - Watch the sequential progress bar, per-leaflet status pills (`Queued`, `Processing`, `Completed`), and cost accumulator.
5. **Inspect Unified Review Workspace:**
   - Once at least one leaflet completes, click **🔍 View Unified Preview**.
   - Test filtering by Leaflet, by Retailer, and by Status.
   - Type in the live search bar to find products by English/Arabic title or brand.
   - Click **Inspect** on any offer to view `product_thumb_crop.webp` alongside `offer_card_crop.webp`.
6. **Verify Single-PDF Regression:**
   - Switch back to **📄 Single Leaflet** mode.
   - Select a single PDF; verify that the standard single-leaflet workflow (page-first extraction, metadata confirmation, and staged draft preview) operates normally.

---

## 17. Final Verdicts Matrix

| Criterion | Target Requirement | Outcome | Verdict |
|---|---|---|:---:|
| **MULTI-PDF SELECTION** | Select multiple PDFs, detect duplicates, display sizes/pages | Supported with native multi-select & sha256 deduplication | **PASS** |
| **BATCH EXTRACTION** | Sequential queue via Gemini 3.8 Flash (Vertex AI Flex PayGo) | Concurrency = 1, fully automated queue execution | **PASS** |
| **RESUME AND RECOVERY** | Cancel without data loss, reload from disk, resume failed items | Durable atomic manifest persistence & resume support | **PASS** |
| **UNIFIED PREVIEW** | Multi-leaflet dashboard, thumbnails, filters, inspection modal | Consolidated table with Leaflet/Retailer/Brand filters | **PASS** |
| **SINGLE-PDF REGRESSION** | Single-PDF workflow remains 100% functional without regressions | Unaffected, verified via unit & smoke tests | **PASS** |
| **ENVIRONMENT ISOLATION** | UI on Production, Tests on Development, Zero leaks | All 14 environment isolation tests passing | **PASS** |
| **PRODUCTION DB MUTATIONS** | Zero mutations to production database | 0 rows written, 0 schema changes | **ZERO** |
| **PAID GEMINI CALLS IN DEV** | Zero paid Gemini API requests during development/tests | All automated tests run on offline cache fixtures | **ZERO** |
| **READY FOR OPERATOR UAT** | Application compiles and is ready for operator testing | Clean Electron build & typechecks passing | **YES** |

---

## 18. Stop Condition Compliance

As instructed:
- **STOP.**
- No catalog matching initiated.
- No offers published to Supabase.
- No products inserted.
- No production database schema changes applied.
- Zero paid Gemini API calls made.
- Zero Git commits, pushes, or resets performed.

