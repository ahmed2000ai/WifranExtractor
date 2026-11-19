# WIFRAN-EXTRACTOR-ONE-CLICK-PREVIEW-001 REPORT
## One-Click Leaflet Extraction With Automatic Local Product Thumbnails

**Milestone:** `WIFRAN-EXTRACTOR-ONE-CLICK-PREVIEW-001`  
**Predecessor Milestone:** `WIFRAN-EXTRACTOR-FINAL-INTEGRATION-001` (Complete)  
**Status:** COMPLETE & FULLY VERIFIED  
**Date:** 2026-11-11  

---

## 1. Executive Summary

The **Wifran Offers Extractor** workflow has been successfully upgraded to deliver a seamless **One-Click Pre-Publish Preview** experience:

$$\text{Import PDF} \longrightarrow \text{Click Extract} \longrightarrow \text{Auto-Crop \& Extract} \longrightarrow \text{Immediate Image-Populated Pre-Publish Preview}$$

Previously, although the extraction pipeline automatically sliced high-quality product-focused thumbnail crops (`product_thumb_crop.webp`) alongside full offer evidence crops (`offer_card_crop.webp`), the pre-publish UI and staging draft ignored the product thumbnail. Consequently, the preview was blocked or rendered with missing image placeholders until the operator performed a manual 3-step CSV sourcing workflow (Step 1 CSV export $\to$ external search agent $\to$ Step 3 CSV re-import).

This milestone eliminates that friction. All extracted offers now immediately populate the pre-publish preview and staging cards using the private local product thumbnails generated during page extraction, while keeping the external CSV sourcing workflow available as an optional path strictly for sourcing public consumer images.

---

## 2. Architectural Boundary & Data Isolation

A strict boundary is maintained between **internal evidence/preview** and **public consumer publication**:

| Concept | Asset Used | Public DB / Storage Action | Consumer API Exposure |
|---|---|---|---|
| **Local Evidence Image** | `offer_card_crop.webp` | Retained privately on disk only | Never uploaded to public buckets or exposed in consumer payloads |
| **Internal Preview Image** | `product_thumb_crop.webp` | Retained privately on disk only (`local-file://` protocol) | Never automatically promoted to `display_image_url`; mapped as NULL on publish |
| **Public Consumer Image** | Approved catalog or sourced candidate image | Uploaded / linked via public Supabase storage only after explicit operator approval | Rendered in consumer apps |
| **Verified Catalog Product** | Established canonical product identity | Preserved independently of image availability | Matches catalog ID (`P#...`) without requiring an image |

> [!IMPORTANT]
> **Zero Public Evidence Leakage Guarantee:**  
> When `selectedImageSource === 'product_thumb'`, `publishStagedLeafletDraftToDb` guarantees that `display_image_url` is `NULL`. Local filesystem paths (e.g. `C:\...` or `F:\...`) and private leaflet crops are never sent to consumer APIs or uploaded into public Supabase buckets.

---

## 3. Implementation Details

### 3.1. Type Definitions & Contract Upgrades
- **`DbEligiblePackageItem`** ([extractionManifest.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/extractionManifest.ts)): Added `thumbnailPath?: string | null` to expose `product_thumb_crop.webp` alongside `cropPath`.
- **`StagedOfferItem` & `OriginalOcrSnapshot`** ([stagedDraft.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/stagedDraft.ts)): Added `productThumbLocalPath?: string | null` and added `'product_thumb'` to the `selectedImageSource` union.
- **`PrePublishPreviewItem`** ([prePublishPreview.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/prePublishPreview.ts)): Added `thumbnail_path?: string | null` and `catalog_image_url?: string | null`.

### 3.2. Extraction & Staging Services
- **`getDbEligibleItemsFromPackage`** ([extractionPackageService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/extraction/extractionPackageService.ts)):
  Resolves `resolvedThumbPath` from `canonical.source.thumbnail_path`, `canonical.image.thumbnail_path`, or disk sibling (`product_thumb_crop.webp`) next to `cropPath`.
- **`buildStagedItemsFromEligible` & `initializeStagedDraftFromPackage`** ([stagedLeafletDraftService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts)):
  Sets `productThumbLocalPath` and defaults `selectedImageSource` to `'product_thumb'` (unless an approved DB image is matched). Backfills and reconciles existing drafts on reload.
- **`replaceStagedOfferConsumerImage`** ([stagedLeafletDraftService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/stagedLeafletDraftService.ts)):
  Added support for `mode: 'product_thumb'`, enabling the operator to revert an item back to its local thumbnail crop at any time.
- **`buildPrePublishSummary`** ([prePublishApprovalService.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/prepublish/prePublishApprovalService.ts)):
  Resolves `thumbnail_path` for each offer and populates `catalog_image_url` from canonical catalog links.

### 3.3. User Interface Enhancements
- **Pre-Publish Preview (`PrePublishPreview.tsx`)** ([PrePublishPreview.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/prepublish/PrePublishPreview.tsx)):
  - **Internal Preview Banner:** Displays a discreet notice: `ℹ️ Leaflet crop — internal preview only. Not approved for consumer publication.`
  - **Primary Image:** Defaults card image to `thumbnail_path` (`product_thumb_crop.webp`) via Electron's secure `local-file://` protocol.
  - **View Mode Switcher:** Provides one-click toggles on each card:
    - `📦 Product Thumbnail` (default internal view)
    - `🔍 Inspect Evidence` (full `offer_card_crop.webp` including promotional text and pricing anchors)
    - `🖼️ Catalog Image` (when matched to an existing catalog image)
  - **Fallback Placeholder:** If a product thumbnail crop is corrupt or missing, renders a clean internal placeholder directing the user to inspect the source evidence crop without crashing.
  - **Catalog Identity Badge:** Distinguishes verified products (`Catalog: Verified (P#...)`) from unresolved offers (`Catalog: Unresolved Offer (O)`).
- **Staging Preview Panel (`StagedLeafletPreviewPanel.tsx`)** ([StagedLeafletPreviewPanel.tsx](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/StagedLeafletPreviewPanel.tsx)):
  - Updated `getRawDisplayImagePath` to return `productThumbLocalPath` when `selectedImageSource === 'product_thumb'`.
  - Updated issue filter and badge counts: offers with local thumbnails are not counted as `Display Image Failed / Missing`.
  - Added watermark badge `📦 Product Thumbnail` and quick action button `📦 Use Local Thumbnail`.
  - Clarified 3-Step CSV header: `ℹ️ Local product thumbnails are active for internal preview. (Optional: Use CSV export/import below to source high-res external images for public consumer publication).`

---

## 4. Test Verification Matrix

A dedicated regression test suite was implemented in [oneClickPreviewThumbnails.test.ts](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/page-first/__tests__/oneClickPreviewThumbnails.test.ts) covering all 8 verification scenarios against the real Noori supermarket extraction baseline:

| Test | Target Verification | Result | Details |
|---|---|:---:|---|
| **Test A** | Fazco Fine Sugar (Offer 005) | **PASS** | Product thumbnail resolved (`product_thumb_crop.webp`), SAR 16.50 promo / SAR 25.00 orig, 5 kg, bilingual titles intact, full evidence crop (`offer_card_crop.webp`) accessible. |
| **Test B** | Qoot & Root Flour (Offer 007) | **PASS** | 9-pack quantity semantics (`9 × 1 كيلو`, 9 bags, 1kg each, 9kg total, SAR 9.99 promo) completely preserved alongside thumbnail resolution. |
| **Test C** | Fakieh Chicken (Offers 002 & 003) | **PASS** | 10-pack carton (Offer 002, SAR 141) and single bag (Offer 003, SAR 15.5) correctly segregated, sharing source crop bounding boxes. |
| **Test D** | Softy Tissues (Offer 009) | **PASS** | 7+3 Free promotional pack (10-pack, SAR 13.99 promo / SAR 23.95 orig) resolved with local product thumbnail. |
| **Test E** | Noori Full-Page Preview (10 Offers) | **PASS** | All 10 offers load with valid local thumbnails and crops from disk; complete preview generated with zero CSV operations or external network calls. |
| **Test F** | Public Data Isolation | **PASS** | Verified that `selectedImageSource: 'product_thumb'` leaves `display_image_url` NULL on database publish; private filesystem paths never leak into public schemas. |
| **Test G** | App Restart / Reopening | **PASS** | Staged drafts reloaded from disk (`loadStagedLeafletDraft`) retain all thumbnail paths; `toRenderableImageSrc` converts paths to `local-file://get?path=...` across reloads. |
| **Test H** | Missing Thumbnail Fallback | **PASS** | If `product_thumb_crop.webp` is absent, summary gracefully sets `thumbnail_path: null`, renders internal placeholder, and keeps full offer evidence accessible for inspection. |

### Test Suite Execution Output
```
 ✓ src/main/page-first/__tests__/oneClickPreviewThumbnails.test.ts (8 tests) 122ms
 ✓ src/main/page-first/__tests__/prePublishQuantityPresentation.test.ts (4 tests) 50ms
 ✓ src/renderer/src/components/catalog/__tests__/StagedLeafletPreviewPanel.test.tsx (11 tests) 2635ms
 ✓ src/renderer/src/pages/__tests__/importPageSelectionUi.test.tsx (16 tests) 3928ms

Test Files  4 passed (4)
     Tests  39 passed (39)
```

---

## 5. Safeguards & Policy Compliance Audit

| Requirement / Constraint | Verification Result |
|---|:---:|
| **Zero Billable Gemini API Calls** | **VERIFIED** — Strictly offline execution using existing disk packages and test fixtures. |
| **Model & Inference Configuration** | **PRESERVED** — `gemini-3.8-flash`, `HIGH` thinking, `legacy` prompt, `legacy` schema, `flex` mode, `global` endpoint, zero silent fallback. |
| **Frozen Canonical Offer Contract** | **PRESERVED** — `wifran.extractor.offer/2.0` schema unmodified. |
| **CSV Image Enrichment Infrastructure** | **PRESERVED** — All 3-step CSV services and components remain operational for optional high-resolution external image sourcing. |
| **TypeScript Typecheck** | **PASS** — Both `typecheck:node` and `typecheck:web` pass with 0 errors. |
| **Production Build** | **PASS** — `npm run build` succeeds cleanly in 3.33s. |
| **Zero Supabase DB Mutations** | **VERIFIED** — No live database inserts, updates, or deletions executed. |
| **Zero Git Commits / Resets** | **VERIFIED** — Working tree preserved without unauthorized commits or branch changes. |

---

## 6. Summary of Changed Files

- `src/shared/types/extractionManifest.ts` — Added `thumbnailPath?: string | null` to `DbEligiblePackageItem`
- `src/shared/types/stagedDraft.ts` — Added `productThumbLocalPath?: string | null` and `'product_thumb'` to `selectedImageSource`
- `src/shared/types/prePublishPreview.ts` — Added `thumbnail_path?: string | null` and `catalog_image_url?: string | null`
- `src/shared/utils/renderableImageUtils.ts` — Shared utility converting local paths to `local-file://` URLs
- `src/main/extraction/extractionPackageService.ts` — Resolves dual crop paths (`cropPath` & `thumbnailPath`)
- `src/main/db/stagedLeafletDraftService.ts` — Implemented thumbnail resolution, draft reconciliation, and `'product_thumb'` image mode
- `src/main/prepublish/prePublishApprovalService.ts` — Populates `thumbnail_path` and `catalog_image_url` in pre-publish summary
- `src/renderer/src/components/prepublish/PrePublishPreview.tsx` — View mode switcher (`📦 Thumbnail`, `🔍 Evidence`, `🖼️ Catalog`), internal preview notice, fallback handling
- `src/renderer/src/components/catalog/StagedLeafletPreviewPanel.tsx` — Product thumbnail display, filter counts, and watermark badges
- `src/main/page-first/__tests__/oneClickPreviewThumbnails.test.ts` — New 8-test regression suite

