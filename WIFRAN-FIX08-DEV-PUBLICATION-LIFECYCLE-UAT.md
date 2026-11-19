# WIFRAN FIX-08 — DEV Publication Lifecycle UAT Report

**Target Database:** `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`)  
**Production Database (`swratbmclahjyekouned`):** Strictly out of scope (ZERO reads/writes)  
**Generated:** `2026-11-15T13:52:00Z`  
**Current Execution Gate:** **FINAL PRE-PUBLICATION UAT & SELECTIVE PUBLICATION READINESS PASSED — STOPPED & AWAITING OPERATOR AUTHORIZATION FOR FIRST LIVE DEV PUBLISH (Zero DEV Writes; Zero Paid Gemini Calls)**

---

## Summary Matrix

| Phase | Scope | Status | Live DEV Writes | Paid Gemini Calls |
|---|---|---|---|---|
| Phase 1 | Image storage routing audit, fix & offline verification | **PASSED** (7 files / 52 tests + typecheck clean) | None (0) | None (0) |
| Phase 2 | Read-only DEV UAT baseline & candidate leaflet selection | **PASSED** (`BEGIN TRANSACTION READ ONLY`) | None (0) | None (0) |
| Phase 3 | Initial Candidate A (Lulu Page 7) up to pre-publish review | **COMPLETED WITH FINDINGS** (3/3 non-grocery quarantined; historical index & image-approval gaps found) | None (0) | None (0) |
| Phase 3 Completion | Historical backfill, consumer image approval UX/backend, diagnostics fixes & Carrefour Page 23 Grocery UAT Prep | **PASSED** (offline suites + `npm run build` + `$0.00` renamed-PDF cache reuse + read-only DEV preflight) | None (0) | None (0) |
| Selective Publication & Final UAT | Offer-level eligibility, deferred preservation, anti-bypass revalidation, metadata revisions, scoped Undo, UI/build checks & Carrefour P23 Scenarios A–C | **PASSED** (`npm run build` exit 0 + 13 files / 109 tests passed + read-only DEV check) | None (0) | None (0) |
| Phase 4 | Controlled DEV publication & duplicate/journal/storage/image URL validation | **AWAITING OPERATOR AUTHORIZATION** | — | — |
| Phase 5 | Controlled DEV Undo Last Publish & DB/storage/view restoration | **AWAITING OPERATOR AUTHORIZATION** | — | — |
| Phase 6 | Post-UAT cleanup & final sign-off | **AWAITING OPERATOR AUTHORIZATION** | — | — |

---

## Phase 1 — Image Storage Routing Verification & Fix

### 1.1 Pipeline Trace & Bucket Architecture

The active 4-step UI publication flow invokes:
`ProductMatchingReview.tsx` (`window.wifranExtractor.matching.publishApproved`) -> `src/main/ipc/catalogMatchingIpc.ts` -> `CatalogPublicationService.publishApprovedCatalogBatch` (`src/main/db/catalogPublicationService.ts`).

Target storage buckets provisioned on `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`):

| Asset Class | Source Field (`UnifiedBatchOffer`) | Target Bucket | Bucket Visibility | DB Target | Consumer Visibility (`v_consumer_offers`) |
|---|---|---|---|---|---|
| Private leaflet evidence crops | `offerCardCropPath`, `productThumbCropPath` | `offer-images` | `false` (**private**) | `publication_storage_operations` only | **Never exposed** (`NULL` / `pending` if no public asset) |
| Approved consumer product image (Route P) | `consumerProductImagePath` | `product-images` | `true` (**public**) | `public.product_images`, `offers.thumbnail_url`, `publication_storage_operations` | Exposed via `v_consumer_offers.image_url` / `thumbnail_url` when `catalog_match_status = 'verified_linked'` |
| Approved consumer offer display image (Route O) | `consumerDisplayImagePath` | `offer-display-images` | `true` (**public**) | `public.offer_display_images`, `offers.image_url`, `publication_storage_operations` | Exposed via `v_consumer_offers.display_image_url` |
| Temporary scratch | — | `tmp` | `false` (**private**) | None | Never exposed |

### 1.2 Defect Identified Before Fix

1. `CatalogPublicationService.publishApprovedCatalogBatch` previously resolved `storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'offer-images'` and uploaded BOTH `offerCardCropPath` and `productThumbCropPath` into **`offer-images`** (`public: false`).
2. It then called `getPublicUrl('offer-images', ...)` and inserted those non-public `/storage/v1/object/public/offer-images/...` URLs into `public.offer_display_images`, `public.product_images`, `offers.image_url`, and `offers.thumbnail_url`.
3. There were no fail-closed checks blocking consumer image writes targeting private/wrong buckets or verifying bucket `public` visibility before commit.

### 1.3 Minimal Targeted Fixes Applied

- [`src/shared/types/batchExtraction.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/batchExtraction.ts): Added optional `consumerProductImagePath`, `consumerDisplayImagePath`, and `approvedConsumerImageRightsBasis` to `UnifiedBatchOffer`, reserving `offerCardCropPath` and `productThumbCropPath` exclusively for private leaflet evidence in `offer-images`.
- [`src/shared/types/catalogMatching.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/catalogMatching.ts): Added optional `buckets?: string[]` to `CatalogPublicationResult['storageSummary']`.
- [`src/main/storage/stagedStorageLifecycleService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/storage/stagedStorageLifecycleService.ts):
  - Added optional `getBucketVisibility(bucket)` on `StorageLifecycleAdapter` (`createGuardedStorageAdapter` reads `supabase.storage.getBucket(bucket).data.public`; `createInMemoryStorageAdapter` models `offer-images: false`, `tmp: false`, `product-images: true`, `offer-display-images: true` with override support).
  - Recorded `byteSize` and `contentType` on `StagedUploadOutcome`.
- [`src/main/db/catalogPublicationService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/catalogPublicationService.ts):
  - Separated staging and persistence into private evidence (`offer-images`) vs approved consumer assets (`product-images`, `offer-display-images`).
  - Added `validateEvidenceBucketRoutingOrThrow`, `validateConsumerBucketRoutingOrThrow`, `validateConsumerPublicUrlOrThrow`, preflight bucket checks, and staging-phase `try/catch` exclusive cleanup.
  - Private evidence crops are still uploaded to `offer-images` and logged in `publication_storage_operations` for Undo lifecycle tracking, while leaving `offers.image_url`, `offers.thumbnail_url`, `public.product_images`, and `public.offer_display_images` empty (`NULL`) unless approved consumer assets are provided.
  - Preserved the legacy mocked `uploadImageFn` test hook path strictly for tests where no `StorageLifecycleAdapter` is used (`hybridV3EndToEndIntegration005i.test.ts`).
- [`src/main/db/__tests__/publicationJournalAndUndo008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/publicationJournalAndUndo008.test.ts): Updated `TEST-F/G/H/I` to verify both private `offerCardCropPath` (`offer-images`, masked as `NULL` in `v_consumer_offers`) and `consumerDisplayImagePath` (`offer-display-images`, exposed in `v_consumer_offers`).
- [`src/main/db/__tests__/imageStorageRoutingPhase1.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/imageStorageRoutingPhase1.test.ts): Added 3 isolated PostgreSQL integration tests verifying all 8 Phase 1 requirements (three-way bucket routing, `v_consumer_offers` contract, `publication_storage_operations` fidelity, Undo shared-preservation & exclusive-cleanup across buckets, and fail-closed wrong-bucket/wrong-visibility guards).

### 1.4 Phase 1 Offline Verification Results

- **Command:** `npx vitest run src/main/db/__tests__/imageStorageRoutingPhase1.test.ts src/main/db/__tests__/publicationJournalAndUndo008.test.ts src/main/db/__tests__/preDeploymentVerification008.test.ts src/main/db/__tests__/environmentIsolation.test.ts src/main/batch/__tests__/wp2R1AcceptanceCorrections.test.ts src/main/batch/__tests__/wp2NonCatalogPublication005c.test.ts src/main/ocr/__tests__/hybridV3EndToEndIntegration005i.test.ts`
  - **Result:** **7 test files passed (7/7), 52 tests passed (52/52), 0 failed, 0 skipped.**
- **Command:** `npm run typecheck` (`typecheck:node` + `typecheck:web`)
  - **Result:** **Exited 0 (0 TypeScript errors).**
- **Live DEV storage mutations during Phase 1:** **None (0 uploads). `offer-images` visibility remains `public: false`.**

---

## Phase 2 — Read-Only DEV UAT Baseline (`gykrbpykjhpyrdrinkuk`)

Executed inside `BEGIN TRANSACTION READ ONLY` against `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`, DB `postgres`, User `postgres`, IPv6 `2406:da1a:82a:9d02:6b9d:71fd:3e7d:c660/128`).

### 2.1 Migration & Schema Parity

- **`_applied_migrations` count:** `10` (`001_initial_schema.sql` through `010_wifran_08_publication_journal_and_uniqueness.sql`, applied `2026-11-15T11:18:59.379Z`)
- **`public.check_wifran_schema_readiness()`:** All `10/10` boolean checks `true` (`has_migration_010_pub_ops`, `has_migration_010_journal_mutations`, `has_migration_010_duplicate_skips`, `has_migration_010_storage_ops`, `has_offers_source_unique_idx`, `has_offers_source_document_col`, `has_consumer_view_v_consumer_offers`, `has_migration_009_alias_proposals`, `has_migration_009_alias_audit`, `has_migration_009_approve_fn`).
- **`assessSchemaCompatibility('DEVELOPMENT_TEST')`:** `compatible: true` (`22/22` checks passed, `missingDependencies: []`, `blockingReasons: []`).

### 2.2 Baseline Database & Storage Counts

| Entity | Baseline Count | Notes |
|---|---:|---|
| `public.products` | `9` | IDs: `26612`, `27210`, `27803`, `27806`, `27809`, `27810`, `28401`, `28994`, `28997` (all verified baseline records; none modified) |
| `public.offers` | `4` | All Panda (`c2cc16c2-0001-4444-b000-c00000000001`); 3 `verified_linked` + 1 `unresolved` non-catalog; all have `image_url = NULL`, `thumbnail_url = NULL`, `last_publish_operation_id = NULL` |
| `public.product_images` | `0` | Clean |
| `public.offer_display_images` | `0` | Clean |
| `public.publication_operations` | `0` | Clean pre-UAT baseline |
| `public.publication_journal_mutations` | `0` | Clean |
| `public.publication_duplicate_skips` | `0` | Clean |
| `public.publication_storage_operations` | `0` | Clean |
| `public.v_consumer_offers` | `4` | Matches 4 baseline offers (`image_url = NULL`, `thumbnail_url = NULL`, `display_image_url = NULL`) |
| `public.supermarkets` | `13` | `noori`, `panda`, `othaim`, `lulu`, `danube`, `tamimi`, `carrefour`, `bin-dawood`, `alwafa`, `nesto`, `farm`, `manuel`, `raya` |

### 2.3 Baseline Offers Snapshot (to be preserved untouched)

| Offer ID | `source_offer_id` | Retailer | `product_id` | `offer_price` | Match Status | Dates |
|---|---|---|---|---:|---|---|
| `34d2cfc2-938d-4350-83aa-8e9181ae112c` | `doc_962d27694c7b562b:p001:is1_a:s01` | Panda | `27803` | `5.50` | `verified_linked` | `2026-10-31`..`2026-11-09` |
| `39704e54-d934-4f90-b1bc-f7ca3aeee641` | `leaflet_wp2:p001:it9_need_approval_1794737884333:s01` | Panda | `NULL` | `4.95` | `unresolved` | `2026-11-09`..`2026-11-19` |
| `4eac0fd1-29ee-4a3a-bec6-6425e20eff70` | `doc_962d27694c7b562b:p001:is5b_b:s01` | Panda | `28997` | `5.50` | `verified_linked` | `2026-10-31`..`2026-11-09` |
| `5933cab0-1452-408b-8d6f-2c05c775e0e9` | `doc_962d27694c7b562b:p001:is5_1:s01` | Panda | `27809` | `5.50` | `verified_linked` | `2026-10-31`..`2026-11-09` |

### 2.4 Baseline Storage Buckets Snapshot (`gykrbpykjhpyrdrinkuk`)

| Bucket | Exists | Public | Size Limit | Allowed MIME Types | Object Count |
|---|---|---|---:|---|---:|
| `product-images` | `true` | **`true`** | `10485760` (10 MB) | `image/jpeg`, `image/png`, `image/webp` | `0` |
| `offer-display-images` | `true` | **`true`** | `10485760` (10 MB) | `image/jpeg`, `image/png`, `image/webp` | `0` |
| `offer-images` | `true` | **`false`** | `10485760` (10 MB) | `null` | `0` |
| `tmp` | `true` | **`false`** | `10485760` (10 MB) | `null` | `0` |

### 2.5 Phase 3 Candidate Leaflet Recommendation

Note that all 4 baseline offers in DEV belong to `Panda`. Selecting a non-Panda retailer from `public.supermarkets` gives a clean zero-collision initial publication followed by a second duplicate/update pass:

1. **Candidate A (Recommended — Already Cached/Verified 1-Page Option or Fresh Re-run):**
   - **PDF:** `Leaflets/lulu-hypermarket-63800343-jeddah.pdf` — **Page 7** (only 1 page; prior local run in `Extracts/batches/batch-2026-11-15T00-28-06-16a1a2` extracted 3 offers for `LuLu Hypermarket` `c2cc16c2-0003-4444-b000-c00000000003`, validity `2026-11-11` to `2026-11-17`, recorded extraction cost `$0.008973`).
   - Selecting Page 7 (or Page 8 for a fresh 1-page Gemini test) targets a retailer with `0` existing DEV offers.
2. **Candidate B (Recommended Compact Multi-Page Fresh Option):**
   - **PDF:** `Leaflets/al-raya-248799794-jeddah.pdf` (`33,684,601` bytes, `20` pages, `Al Raya Markets` `c2cc16c2-0012-4444-b000-c00000000012`, `0` existing DEV offers) — select 1–2 pages in the UI.
3. **Not Recommended:** `Leaflets/dukan-849800259-jeddah.pdf` (`1.8 MB`, 1 page) is excluded because `dukan` is not seeded in `public.supermarkets` on DEV.

---

## Phase 3 — Batch Processing & Pre-Publication Review (Candidate A: Lulu Page 7)

Executed at `2026-11-15T11:56:14Z` against `Leaflets/lulu-hypermarket-63800343-jeddah.pdf` (`196,346,192` bytes, SHA-256 `f69ea50ec2b8ed557301da98397bd5ff033954481420f79c673d041754cf2c61`, `85` pages, **Page 7** selected) targeting `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`) using the 4-step batch backend pipeline (`BatchOrchestrationService` -> `CatalogMatchingOrchestrator` -> `summarizeBatchReviewTriage` / `CatalogPublicationService.assessPublicationPreflight`) with paid Gemini providers blocked (`geminiMatchingCalls = 0`, `$0.00` live spend) and all PG checks inside `BEGIN TRANSACTION READ ONLY`.

### 3.1 Extraction Reuse Findings (Requirements 1–3)

1. **Workspace-Level Cache Reuse SUCCEEDED (`$0.00`, `provenance: "cache"`):**
   - `BatchOrchestrationService.createBatch()` resolves `workspacePath` to `Extracts/<nameWithoutExt>` (`Extracts/lulu-hypermarket-63800343-jeddah`).
   - Because that workspace already contains `staged-draft.json` (matching `leafletHash` and `3` Page 7 items) plus `hybrid_v3_checkpoints/leaflet_v3_progress.json`, `BatchOrchestrationService.startBatchExtraction(..., { forceReextract: false })` logged `[BatchQueue] Cache hit for leaflet lulu-hypermarket-63800343-jeddah.pdf. Reusing existing extraction.` and completed with `totalCostUsd: 0` and zero Gemini calls (reusing the prior `batch-2026-11-15T00-28-06-16a1a2` extraction that originally cost `$0.008973`).
2. **Cross-Workspace History Index Currently Empty (`0` entries):**
   - `Extracts/.wifran-document-history.json` (`DocumentExtractionHistoryService`) currently holds `0` entries (`actualHistoryEntriesCount: 0`), so cross-workspace pre-extraction duplicate lookup does **not** detect Lulu Page 7.
   - Running `startBatchExtraction` in an empty/alternative workspace with paid Gemini blocked rendered Page 7 locally and then aborted with `GEMINI_BLOCKED_IN_PHASE3_UAT: Paid Gemini extraction call attempted`. Thus, reuse only succeeds at `$0.00` when using the existing `Extracts/lulu-hypermarket-63800343-jeddah` workspace (`forceReextract: false`).

### 3.2 Extracted Offers, DEV Catalog Matching & Quarantine Diagnosis (Requirement 4)

All `3` extracted Page 7 offers were evaluated against `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`) via `CatalogMatchingOrchestrator`:
- **Matching Preflight Estimate:** `3` unique identities across `3` brand groups (`Samsung`, `LG`, `Moulinex`); `approxGeminiRequests: 3`, estimated cost `$0.0016`–`$0.0033`.
- **DEV Matching Execution:** `$0.00` actual cost, **`0` Gemini requests dispatched**, `0` cache matches, `0` deterministic matches, `3` `unresolved` (`matchMethod: "deterministic"`, `confidence: "low"`), all `3` flagged with `MISSING_UNIT_SIZE` in `evaluateIdentitySufficiency`.
- **DEV `public.products` Check:** `0` existing Samsung, LG, Moulinex, TV, refrigerator, or food processor records exist in DEV `public.products` (still only the `9` Phase 2 baseline products).
- **DEV `public.supermarkets` Check:** `LuLu Hypermarket` exists and is active (`id = c2cc16c2-0003-4444-b000-c00000000003`, `slug = lulu`).

| `source_offer_id` | Derived `offers.source_offer_id` | Extracted Item | Price (`SAR`) | Category / Domain | DEV Matching Decision | Quarantine & Triage Reasons |
|---|---|---|---:|---|---|---|
| `leaflet-001_p007_001` | `doc_f69ea50ec2b8ed55:p007:ip007_001:s01` | Samsung 75" 4K Smart Mini LED TV (`UA75M70HAUXSA`) | `2899` (was `9999`) | `electronics` (`itemDomain` fallback `grocery`) | `unresolved` (`MISSING_UNIT_SIZE`) | `blocked` — `V3_PARENT_OFFER_QUARANTINED`, `FACT_OR_PROMO_CONFLICT`, `EXPLICIT_BLOCKING_ERRORS` |
| `leaflet-001_p007_002` | `doc_f69ea50ec2b8ed55:p007:ip007_002:s01` | LG Side By Side Refrigerator 17.9 cu.ft (`LS19GBBDI`) | `3499` (was `7499`) | `appliance` | `unresolved` (`MISSING_UNIT_SIZE`) | `blocked` — `V3_PARENT_OFFER_QUARANTINED`, `FACT_OR_PROMO_CONFLICT`, `NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE`, `EXPLICIT_BLOCKING_ERRORS` |
| `leaflet-001_p007_003` | `doc_f69ea50ec2b8ed55:p007:ip007_003:s01` | Moulinex Food Processor 800W (`FP247127`) | `189` (was `379`) | `appliance` | `unresolved` (`MISSING_UNIT_SIZE`) | `blocked` — `V3_PARENT_OFFER_QUARANTINED`, `FACT_OR_PROMO_CONFLICT`, `NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE`, `EXPLICIT_BLOCKING_ERRORS` |

**Why All 3 Page 7 Offers Were Quarantined:**
- In [`src/main/ocr/offerV3DecompositionEngine.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/offerV3DecompositionEngine.ts#L961-L982), `decomposeV3OfferCard` sets `parent_offer_retention_mode = 'quarantined_do_not_publish'` whenever `normalizedCard.non_grocery_specs.excluded_from_default_grocery_feed` is `true` — even when `conflict_codes` is empty (`[]`), emitting `"Blocked by conflict code(s): ."`.
- `BatchOrchestrationService.getUnifiedBatchOffers()` (`src/main/batch/batchOrchestrationService.ts`) then marks any `quarantined_do_not_publish` offer with `V3_PARENT_OFFER_QUARANTINED` and `FACT_OR_PROMO_CONFLICT` in both `quarantineReasons` and `blockingErrors`. Offers `002` and `003` additionally carry `NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE`.

### 3.3 Consolidated Operator Review & Preflight Reconciliation (Requirement 5)

- **Metadata State:** Discovered `supermarketId = c2cc16c2-0003-4444-b000-c00000000003`, `locationScope = "national"`, `offerStartDate = "2026-11-11"`, `offerEndDate = "2026-11-17"`, `currency = "SAR"`, `verified = false` -> `metadataStatus: "needs_review"` (`metadataAccepted: false`; operator must verify/accept metadata in Step 3 before any eligible offer can publish).
- **Consolidated UI Triage (`summarizeBatchReviewTriage`):** `total = 3`, `readyCount = 0`, `needsReviewCount = 0`, **`blockedCount = 3`**, `canBulkApprove = false` for all `3`.
- **Publication Preflight (`CatalogPublicationService.assessPublicationPreflight` on DEV `READ ONLY`):**
  - `schemaDependenciesMet: true` (`22/22` checks passed, Migration 009 & 010 present), `incompleteOrFailedRequestsCount: 0`.
  - `totalOffersToPublish: 3`, `existingProductMatchesCount: 0`, `newProductsToCreateCount: 0`, `unresolvedOffersCount: 3`, `approvedNonCatalogCount: 0`, `eligibleNonCatalogCount: 0`, **`quarantinedOffersCount: 3`**.
  - **Notable Preflight Nuance:** `preflight.ready` returns `true` with `blockingReasons: []` because `blockingReasons` only validates offers *targeted for publication*, and `reconciliationSummary` skips `outcome === 'quarantined'` offers (`totalEvaluated: 0`, `newCount: 0`, `alreadyPublishedCount: 0`, `updateCandidateCount: 0`, `duplicateConflictCount: 0`). Thus, publishing this page as-is would cleanly archive/skip all `3` quarantined offers and publish **`0` rows** to DEV.

### 3.4 Image Handling & Functional Gap Report (Requirement 6)

Verified local WebP crops on disk under `Extracts/lulu-hypermarket-63800343-jeddah/crops/page_7/`:

| `source_offer_id` | `imageSubjectScope` | `offer_card_crop.webp` (Private Evidence) | `product_thumb_crop.webp` (Product Crop) | `consumerProductImagePath` | `consumerDisplayImagePath` | `approvedConsumerImageRightsBasis` |
|---|---|---:|---:|---|---|---|
| `leaflet-001_p007_001` | `product_package` | Exists (`157,862` B) | Exists (`114,538` B) | `null` | `null` | `null` |
| `leaflet-001_p007_002` | `product_package` | Exists (`81,986` B) | Exists (`32,160` B) | `null` | `null` | `null` |
| `leaflet-001_p007_003` | `product_package` | Exists (`88,484` B) | Exists (`48,962` B) | `null` | `null` | `null` |

**Confirmed Functional Gap Before Publication:**
1. **`consumerProductImagePath`, `consumerDisplayImagePath`, and `approvedConsumerImageRightsBasis` are never populated** anywhere in the active 4-step pipeline (`BatchOrchestrationService.getUnifiedBatchOffers`, `CatalogMatchingOrchestrator`, `src/main/ipc/catalogMatchingIpc.ts`, or renderer components).
2. **Legacy vs. 4-Step UI Disparity:** The legacy single-leaflet [`StagedLeafletPreviewPanel.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/catalog/StagedLeafletPreviewPanel.tsx#L1631-L1636) provided an explicit operator action (`onImageSwap('product_thumb')`), whereas the 4-step batch UI ([`UnifiedBatchPreview.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/UnifiedBatchPreview.tsx#L1413-L1474) and [`ProductMatchingReview.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/ProductMatchingReview.tsx#L1592-L1655)) only previews `offer_card_crop.webp` and `product_thumb_crop.webp` read-only with **no operator control** to approve `product_thumb_crop.webp` (or set `approvedConsumerImageRightsBasis`) for consumer display (`product-images` public bucket).
3. **Consequence:** Under Phase 1's fail-closed security boundary (private evidence crops stay strictly in private `offer-images` and are never auto-exposed as public consumer images), even publishable 4-step batch offers currently publish with **`0` public consumer images** (`v_consumer_offers.image_url = NULL`, `thumbnail_url = NULL`, `display_image_url = NULL`) unless a crop-approval step/control populates `consumerProductImagePath` or `consumerDisplayImagePath`.

### 3.5 Exact Proposed Database & Storage Operations for Candidate A (Requirement 7)

If published in its current state to `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`):

| Target | Proposed Inserts | Proposed Updates | Skipped / Quarantined | Conflicts | Notes |
|---|---:|---:|---:|---:|---|
| `public.products` | `0` | `0` | — | `0` | `0` matches; `0` approved temporary products; DEV stays at `9` products |
| `public.offers` | `0` | `0` | `3` | `0` | All `3` Page 7 offers are `outcome: "quarantined"` (`isSafeForNonCatalogPublication: false`); DEV stays at `4` Panda offers |
| `public.product_images` / `public.offer_display_images` | `0` | `0` | `3` | `0` | No published offers and `consumerProductImagePath = null` / `consumerDisplayImagePath = null` |
| Storage: `offer-images` (`public: false`) | `0` | `0` | `3` | `0` | Evidence staging only uploads for offers passing into publication (`0` here) |
| Storage: `product-images` (`public: true`) | `0` | `0` | `3` | `0` | Functional gap: `consumerProductImagePath` is `null` |
| Storage: `offer-display-images` (`public: true`) | `0` | `0` | `3` | `0` | `consumerDisplayImagePath` is `null` |
| Publication Journal (`publication_operations` etc.) | — | — | — | — | Only `publication_operations` metadata / `status` would record `0` created if invoked |

---

## Phase 3 Completion — Historical Cache Backfill, Consumer Image Approval, Diagnostics & Grocery UAT Prep

### 3C.1 Workstreams Implemented

1. **Historical Extraction Cache Discoverability (`DocumentExtractionHistoryService` + Step 1 UI):**
   - Added non-destructive `backfillHistoricalExtractions()` and lazy one-time `ensureBackfilled()` in [`src/main/cache/documentExtractionHistoryService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/cache/documentExtractionHistoryService.ts), matching leaflets exclusively by verified PDF SHA-256 (supporting renamed identical PDFs cleanly while rejecting filename collisions with different PDF bytes).
   - Verifies `hybrid_v3_results/page_<n>.v3.json`, `staged-draft.json` items, and non-zero crop files on disk; reports incompatible Legacy Rev1 and incomplete/corrupt workspaces separately; prunes stale missing-path test entries; and deduplicates repeat runs without modifying original workspaces.
   - Fixed [`src/main/batch/hybridV3BatchProcessor.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/hybridV3BatchProcessor.ts) (`pageImagePath` initialization before historical hydration + safe cross-workspace crop copy) and unified the `batch:inspectDuplicates` IPC contract across [`src/main/ipc/batchExtractionIpc.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ipc/batchExtractionIpc.ts), [`src/preload/index.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/preload/index.ts), [`src/preload/index.d.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/preload/index.d.ts), and [`src/renderer/src/components/batch/MultiPdfSelector.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/MultiPdfSelector.tsx).
2. **Consumer Product Image Approval, Reuse & Undo Integrity:**
   - Added `consumerImageApprovals` manifest state, `applyConsumerProductImageDecision()`, same-batch sibling image inheritance, and automatic approval invalidation on catalog identity/link edits in [`src/main/batch/catalogMatchingOrchestrator.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/catalogMatchingOrchestrator.ts) and [`src/main/batch/batchOrchestrationService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/batchOrchestrationService.ts).
   - Enriched catalog candidates from approved `public.product_images` rows on both small-brand and large-brand paths in [`src/main/db/brandGroupingService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/brandGroupingService.ts).
   - Added fail-closed guards in [`src/main/db/catalogPublicationService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/catalogPublicationService.ts) blocking `offer_card_crop`, `rejected`, or `invalidated_identity_changed` images from `product-images`, plus journaled `products.default_image_url` updates with matching Undo restoration in [`src/main/db/publicationJournalAndUndoService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/publicationJournalAndUndoService.ts).
   - Exposed `matching:saveConsumerImageApproval` IPC and added Step 3 image-approval controls (side-by-side original page, private `offer_card_crop.webp`, generated `product_thumb_crop.webp`, catalog/proposed image, and status badges) in [`src/renderer/src/components/batch/UnifiedBatchPreview.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/UnifiedBatchPreview.tsx).
3. **Quarantine & Non-Grocery Diagnostics Fixes:**
   - Updated [`src/main/ocr/offerV3DecompositionEngine.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/offerV3DecompositionEngine.ts) so non-grocery exclusion, missing `promo_price`, and non-`SAR` currency produce explicit diagnostic reasons instead of `"Blocked by conflict code(s): ."`.
   - Updated [`src/main/db/productIdentityPolicy.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/productIdentityPolicy.ts) so non-grocery domains emit `NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE` without false grocery `MISSING_UNIT_SIZE` findings.
   - Added structured diagnostic classifications (`Ready to Publish`, `Non-Grocery Excluded`, `Extraction Conflict`, `Missing Identity`, `Manual Review Required`) in [`src/shared/utils/reviewTriageClassifier.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/reviewTriageClassifier.ts) and [`src/shared/utils/nonCatalogPublicationPolicy.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/nonCatalogPublicationPolicy.ts).

### 3C.2 Real `Extracts/` Backfill & Lulu Page 7 Diagnostic Recheck

- Backfilling `Extracts/` populated [`Extracts/.wifran-document-history.json`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/Extracts/.wifran-document-history.json) (`scannedWorkspaces: 38`, `scannedBatches: 9`, `originalsUntouched: true`) with **`2` verified Hybrid V3 page records** (`doc_f69ea50ec2b8ed55` Lulu Page 7; `doc_68ffdb75ca3b271e` Carrefour Page 23, `24` verified crops), classifying `9` legacy Rev1 reports as `skipped_incompatible` and `25` incomplete folders as `skipped_incomplete_or_corrupted`.
- Repeating backfill is idempotent (`indexedPagesCount: 0`).
- Re-evaluating Lulu Page 7's `3` `reconciledCards` (`electronics` / `appliance`) produced **`conflict_codes: []`**, explicit `"Non-grocery exclusion: domain '...' is excluded from the default consumer grocery feed."`, and no `MISSING_UNIT_SIZE` false positive.

### 3C.3 Grocery UAT Preparation: Carrefour Page 23 (`DEVELOPMENT_TEST` Read-Only Preflight)

- **Source PDF:** `Leaflets/carrefour-62800235-jeddah.pdf` (`doc_68ffdb75ca3b271e`, SHA-256 `68ffdb75ca3b271ee56838281310e566bd3886a49fe183ae3b11aee64ebf480e`, **Page 23**).
- **Pre-Extraction & Fresh-Batch Reuse:** Verified both original and renamed identical copies returned `classification: "exact_duplicate_full_reuse"`, `reusablePages: [23]`, `payablePages: []`, `estCostLow: 0`. Executing a brand-new scratch batch from the renamed copy hydrated all `12` offers at **`$0.00` cost (`geminiExtractCalls: 0`, `geminiMatchCalls: 0`)**.
- **DEV Baseline Verified (`BEGIN READ ONLY` on `gykrbpykjhpyrdrinkuk`):** `products = 9`, `offers = 4`, `product_images = 0`, `publication_operations = 0` (unchanged).
- **Step 3 Triage & Proposed Plan (`summarizeBatchReviewTriage` + `assessPublicationPreflight`):**
  - **`9` Clean Grocery Staples (`ready`, consumer image `approved_generated_crop`, `rightsBasis: operator_verified_leaflet_product_crop`):** `Al Safeer Maza Rice 10kg`, `G.Farms Egyptian Rice 5kg`, `Al Muhaidib Punjabi Rice 10kg`, `Al Aila White Basmati Rice 5kg`, `Rice King SP Sella Rice 10kg`, `Al Osra Fine Sugar 10kg`, `Halah Sunflower Oil 2.9L`, `Sunwhite Calrose Rice 5kg`, `Nadec Org Extra Virgin Olive Oil 1L` -> proposed `9` new `public.products`, `9` new `public.offers` (`totalEvaluated: 9, newCount: 9, alreadyPublishedCount: 0, updateCandidateCount: 0, duplicateConflictCount: 0`), `9` private evidence crops (`offer-images`), and `9` approved public crops (`product-images`).
  - **`3` Quarantined Extraction Conflicts (`blocked`, rejected in Step 3):** `Ditalini Rigati Large` (`INCOMPLETE_VISIBLE_ASSORTMENT`, `CURRENCY_UNVERIFIED_OR_CONFLICT`), `O-Lite Canola Oil 1.5L x2` (`EN_AR_WEIGHT_VOLUME_CONFLICT`, `PROMO_QTY_VS_MFG_PACK_CONFLICT`), `Barilla Sauce Bolognese` (`CURRENCY_UNVERIFIED_OR_CONFLICT`, `TEXT_VS_IMAGE_CONFLICT`) -> `quarantinedOffersCount: 3`, `unresolvedOffersCount: 3`, `0` DB/storage writes.
  - **Preflight Status:** `ready: true`, `blockingReasons: []`, `schemaDependenciesMet: true`.

### 3C.4 Verification Boundary (Automated vs Manual Operator GUI Checks)

- **Automated Verification:** TypeScript (`npm run typecheck`), Electron/Vite production build (`npm run build`), Vitest test suites (`phase3Completion008.test.ts` plus regression suites), and the read-only Node/tsx Carrefour Page 23 + Lulu Page 7 UAT harness ran without any live DEV DB writes, live storage uploads, or paid Gemini calls.
- **Manual Electron GUI Action Pending Operator Review:** Visually inspecting Carrefour Page 23 inside the live Electron Step 1 (`MultiPdfSelector`) and Step 3 (`UnifiedBatchPreview`) screens before issuing Phase 4 authorization to publish onto `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`).

---

## Phases 4–6 — Blocked / Awaiting Operator Direction

1. **Recommended Phase 4 Target (`DEVELOPMENT_TEST` only):** Authorize `Leaflets/carrefour-62800235-jeddah.pdf` Page 23 (`9` ready grocery staples + `3` deferred extraction conflicts) to exercise real DEV `products`, `offers`, `product_images`, `offer-images`/`product-images` uploads, `v_consumer_offers` checks, selective publish + fix/re-publish, duplicate re-run skipping/updates, and scoped Undo Last Publish.
2. **Current DEV Impact:** Zero live DEV DB mutations, zero storage uploads/deletions, and `$0.00` Gemini spend occurred across Phase 3 Completion and Final Pre-Publication Selective Publication UAT. Execution remains **STOPPED** before Phase 4.

---

## Final Pre-Publication UAT & Selective Publication Readiness

### 9.1 Offer-Level Eligibility & Selective Publication Policy

Implemented across [`src/shared/types/batchExtraction.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/types/batchExtraction.ts), [`src/shared/utils/reviewTriageClassifier.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/reviewTriageClassifier.ts), [`src/shared/utils/nonCatalogPublicationPolicy.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/nonCatalogPublicationPolicy.ts), [`src/shared/utils/offerRevalidation.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/offerRevalidation.ts), and [`src/main/db/catalogPublicationService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/catalogPublicationService.ts):

- **Four Explicit Offer Eligibility States (`OfferEligibilityStatus`):**
  - `ready` — Passed all deterministic validations, belongs to an accepted leaflet metadata scope (`operator_verified` or `auto_accepted`), has a verified catalog match, an `approved` temporary product group, or an explicitly `approved` safe non-catalog decision, and is not unchanged-`published`.
  - `needs_review` — Non-fatal incomplete items (unapproved temporary group, `unresolved` identity without non-catalog approval, unreviewed/incomplete leaflet metadata, or low-confidence match) deferred without blocking `ready` siblings.
  - `blocked` — Quarantined extraction conflicts (e.g., `EN_AR_WEIGHT_VOLUME_CONFLICT`, `INCOMPLETE_VISIBLE_ASSORTMENT`, `CURRENCY_UNVERIFIED_OR_CONFLICT`, `NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE`, `INVALID_OR_MISSING_OFFER_PRICE`, inverted dates), rejected operator decisions, or `CATALOG_ENVIRONMENT_MISMATCH`.
  - `published` — Already published with unchanged payload and `needsUpdateReview !== true`; automatically skipped (`alreadyPublishedOfferKeys`) in subsequent selective publishes.
- **Selective Publication Non-Interference & Fail-Closed Boundaries:**
  - `CatalogPublicationService.assessPublicationPreflight()` and `publishApprovedCatalogBatch()` partition batch offers into `eligibleOfferKeys`, `deferredOfferKeys` (with per-offer `deferredOfferReasons`), and `alreadyPublishedOfferKeys`.
  - Temporary product creation, image staging (`offer-images`, `product-images`, `offer-display-images`), DB reconciliation, and `offers` writes execute strictly for `eligibleOfferKeys`.
  - Batch-halting errors remain fail-closed when targeted offers have missing/invalid leaflet-wide metadata (`MISSING_SUPERMARKET_PROVENANCE`, `INVALID_VALIDITY_DATES`, `MISSING_CITY_ID`, `MISSING_REGION_ID`), `CATALOG_ENVIRONMENT_MISMATCH`, duplicate `source_offer_id`s, or when an operator explicitly marks a quarantined offer `approved`.

### 9.2 Deferred Offer Revalidation, Anti-Bypass Controls & Evidence Preservation

Implemented in [`src/shared/utils/offerRevalidation.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/offerRevalidation.ts) (`revalidateOfferItem`) and [`src/main/batch/batchOrchestrationService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/batchOrchestrationService.ts) (`updateBatchOfferFields`):

- Preserves original OCR snapshot (`originalOcr`, `originalConflictCodes`, `originalQuarantineReasons`, `originalV3RetentionMode`, `originalAssortmentStatus`) before applying any operator edit.
- Re-runs deterministic rules on every save/revalidation: Arabic numeral normalization, English vs. Arabic quantity/unit consistency (`detectEnArUnitVolumeConflict`), domain/grocery scope (`detectItemDomainFromTitle`), quantity semantics, positive pricing & `originalPrice >= promoPrice`, fragmented title checks (`isFragmentedOrInvalidTitle`), SAR currency verification, and assortment confirmation.
- **Anti-Bypass Guarantee:** Setting `confirmConflictResolution: true` alone cannot clear an unfixed EN-vs-AR mismatch, zero/negative price, inverted discount, missing unit size, non-SAR currency, or `visual_multiple_variants` assortment.
- Triggers `CatalogMatchingOrchestrator.rematchUpdatedOffer()` when identity fields change or when a previously quarantined item becomes valid.
- When an already-published offer is edited locally, sets `publicationState.needsUpdateReview = true` without mutating PostgreSQL until explicitly published with `enforceUpdateApproval`.

### 9.3 Persistent Batch Lifecycle, Metadata Revisions & Scoped Undo

- **Batch Persistence (`'partially_published'`):** [`src/main/ipc/catalogMatchingIpc.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ipc/catalogMatchingIpc.ts) invokes `recordSelectivePublicationOutcome()` on commit and `reconcileUndoPublicationOutcome()` after `undoLastPublish()` (looking up `batch_id` from `public.publication_operations` by `undoRes.targetOperationId`). Both `batch-manifest.json` (`publishedOffers`, `publicationOperations`, `status: 'partially_published'`) and per-item `staged-draft.json` `publicationState` survive close and reopen.
- **Leaflet Metadata Revisions & Rial Sign (`﷼`) Fix:** `updateLeafletMetadata()` maintains `metadataVersion` and append-only `metadataRevisions[]`, leaves unaffected sibling leaflets untouched, stores commit-time `leafletMetadataSnapshots` inside `public.publication_operations.preflight_summary`, and sets `needsUpdateReview = true` only on previously published offers from the edited leaflet when committed metadata keys change. Additionally resolved a real production parser bug in [`batchOrchestrationService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/batchOrchestrationService.ts) where printed `﷼` (`U+FDFC` / `U+20C1`) in `evidenceByField.currency.evidenceText` was rejected by `normalizeCurrencyToken()` as a non-SAR conflict even when `verified: true`.
- **4-Step UI Integration:** Updated [`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx) (`Partially Published` badge, `X published / Y remaining`, `Reopen Deferred & Publish`), [`UnifiedBatchPreview.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/UnifiedBatchPreview.tsx) (`Published` / `Blocked (Deferred)` triage pills, `currency` / `assortment_status` / `confirmConflictResolution` controls, `Save & Revalidate Corrections`), and [`ProductMatchingReview.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/ProductMatchingReview.tsx) (`Publish X Ready Offers — Y Deferred` CTA disabled when `Ready === 0` without approved updates/overrides, and 4-metric breakdown).

### 9.4 Offline Selective Publication & Carrefour Page 23 Simulation (`$0.00` Gemini Cost)

Executed against isolated PostgreSQL (`createIsolatedWifranPostgres` up to Migration `010`) and copied temp-dir Carrefour Page 23 artifacts (`batch-2026-11-14T23-30-47-2417b0`, originals untouched) in [`src/main/db/__tests__/selectivePublication008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/selectivePublication008.test.ts):

- **Scenarios 1–17 (Multi-Leaflet Selective Lifecycle):**
  - Partial publish committed `1` existing-catalog offer + `1` approved non-catalog offer (`2` offers) while cleanly deferring `1` unapproved blocked temporary offer and `1` excluded non-grocery offer (`0` unapproved temp products created, `1` public `product-images` upload, `0` deferred uploads).
  - Reopening in fresh service instances restored `manifest.status = 'partially_published'`, `2` published, `0` ready, `2` blocked; repeat publish staged `0` images and wrote `0` DB rows; metadata revision (`v1`) preserved prior commit snapshot (`2026-11-17`) and left unaffected leaflet unchanged; anti-bypass confirmation without unit fix kept `EN_AR_WEIGHT_VOLUME_CONFLICT`; fixing Arabic `١،٥ مل` -> `١،٥ لتر` cleared quarantines cleanly for Pub 2; scoped Undo rolled back only Pub 2 while preserving Pub 1; explicit `enforceUpdateApproval` skipped unapproved price updates and applied approved price updates (`54.99`); inverted leaflet dates (`2026-11-25`..`2026-11-10`) blocked affected leaflet offers cleanly.
- **Carrefour Page 23 Scenarios A / B / C:**
  - **Scenario A:** Classified **`9` Ready** clean grocery staples and **`3` Deferred/Blocked** (`003`, `006`, `011`), publishing all `9` offers (`9` products created in isolated PG) cleanly without touching blocked items.
  - **Scenario B:** Fixed blocked `006` (`O-Lite Canola Oil 1.5L X2`) — rejecting bypass-only confirmation, then fixing `١،٥ مل` -> `١،٥ لتر` (`quarantineReasons: []`, `v3RetentionMode: 'operator_resolved_single_sku'`), reaching **`10` Ready** total (`9` previously published, `1` newly Ready `006`, `2` Blocked `003`/`011`).
  - **Scenario C:** Reopened from disk with `originalOcrSnapshot.titleAr = 'أولايت زيت كانولا ١،٥ مل × ٢'` preserved, published **only `006`** (`10` offers in isolated PG), then ran scoped `undoLastPublish` rolling back **only `006`**, restoring `9` Scenario A offers intact.

### 9.5 Build, Regression Verification & Read-Only DEV Audit (Post-Final Edit)

| Check | Command | Observed Result |
|---|---|---|
| Full TypeScript + Bundle Build | `npm run build` (`typecheck:node` + `typecheck:web` + `electron-vite build`) | **Exited `0`** (`0` TS errors; main, preload & renderer bundles built) |
| Core, Selective & UI Regression Suites | `npx vitest run ...` across `11` suites (`selectivePublication008`, `selectiveUi008`, `uatFix08UiAndRecovery`, `uatWorkflowFix07`, `uatWorkflowFix06`, `uatUnblock005j`, `wp2NonCatalogPublication005c`, `phase3Completion008`, `publicationJournalAndUndo008`, `preDeploymentVerification008`, `imageStorageRoutingPhase1`) | **11/11 files passed, 50/50 tests passed, 0 failed, 0 skipped** |
| Catalog Matching & IPC Suites | `npx vitest run src/main/batch/__tests__/catalogMatching.test.ts src/main/ipc/__tests__/catalogMatchingIpcWp3.test.ts` | **2/2 files passed, 59/59 tests passed, 0 failed, 0 skipped** |
| Combined Automated Pass Total | `13` test files executed after final code edit | **109/109 tests passed, 0 failed, 0 skipped** |
| Read-Only DEV Baseline Check | `BEGIN TRANSACTION READ ONLY` against `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`) | **`products: 9`, `offers: 4`, `product_images: 0`, `offer_display_images: 0`, `publication_operations: 0`** |
| Live Paid API & Live DB Mutations | Gemini API / `DEVELOPMENT_TEST` / `PRODUCTION_UI` / Supabase Storage | **None (`$0.00` spent, `0` live mutations, `0` uploads)** |

**Gate Decision:** All selective publication, revalidation, metadata persistence, Undo isolation, UI, build, and read-only DEV checks passed. Execution is **STOPPED** awaiting explicit operator authorization to perform the first controlled live publication on `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`).

---

## 10. First Controlled DEV Publication UAT (Steps 1–4 Pre-Authorization Report)

Executed on **2026-11-15** via the live Electron desktop application (`WIFRAN_DEV_UAT_HARNESS=1`, target project **`DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`)**, production **`PRODUCTION_UI` (`swratbmclahjyekouned`)** strictly excluded) using [`Leaflets/carrefour-62800235-jeddah.pdf`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/Leaflets/carrefour-62800235-jeddah.pdf) — **Page 23** (Hybrid V3, historical cache reuse enabled).

### 10.1 Defects Found & Resolved During Live Electron UI Verification

Testing the actual Electron UI uncovered and resolved three real workflow/safety issues:

1. **Missing Header Environment Badge in Live Harness ([`registerIpcHandlers.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ipc/registerIpcHandlers.ts), [`App.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/App.tsx)):** `app:getHealth` previously resolved `PRODUCTION_UI` directly even when `WIFRAN_DEV_UAT_HARNESS=1` was active (diverging from `config:getStatus`), and [`App.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/App.tsx) only rendered the offline UAT pill. Unified `app:getHealth` to reuse `getSafeConfigStatus().databaseEnvironment` and rendered `⚠️ Database: DEVELOPMENT — TEST ONLY` (`dev-uat-harness-pill`) in the root header; synced DEV context defaults in [`ImportPage.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/pages/ImportPage.tsx) and [`ProductMatchingReview.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/ProductMatchingReview.tsx).
2. **Cache-Hit Metadata Preservation & Offline Discovery ([`batchOrchestrationService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/batchOrchestrationService.ts)):** When `startBatchExtraction` hit an existing `staged-draft.json`, it previously skipped `discoverDraftMetadataAfterExtraction` and overwrote `leaflet.metadata` without preserving `currency`, `locationSlug`, or `supermarketName`. Updated cache-hit handling to merge existing metadata, run `sanitizeLeafletMetadataFields()`, and execute disk-only metadata discovery (`hybridV3ExplicitLiveAuthorization: false`, `$0.00`).
3. **Verification After Edits:** `npm run build` exited `0`; targeted Vitest run across [`appOfflineUatIndicator.test.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/__tests__/appOfflineUatIndicator.test.tsx), [`selectiveUi008.test.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/__tests__/selectiveUi008.test.tsx), [`batchOrchestration.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/__tests__/batchOrchestration.test.ts), and [`selectivePublication008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/selectivePublication008.test.ts) passed **4/4 files, 22/22 tests, 0 failed, 0 skipped**.

### 10.2 Step 1 — Electron Batch Preparation & Baseline Review (`batch-2026-11-15T14-18-37-692853`)

- **Cache Reuse & Cost (`$0.0000`):** `batch:inspectDuplicates` classified Page `23` (`doc_68ffdb75ca3b271e`, SHA-256 `68ffdb75...f480e`) as `exact_duplicate_full_reuse` (`totalReusablePages: 1`, `totalPayablePages: 0`). `batch:start` reused `Extracts/carrefour-62800235-jeddah` (`provenance: 'cache'`) and disk Vision metadata cache (`visionCacheHit: true`, `visionCostUsd: 0`, `visionRequestsUsed: 0`).
- **Zero-Cost DEV Catalog Matching (`$0.0000`):** Auto-matching ran against `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk` — `9` unrelated test products currently in `public.products`) via `resolveLocalZeroCostItems` -> `verifyAbsenceInBrandCatalog` (`isExhaustivelyAbsent: true` for all `12` items), yielding `12` provisional new-product proposals (`t_batch2026111_001` .. `t_batch2026111_012`), `0` Gemini API calls, and **`$0.0000` actual API cost**.
- **Baseline Offer State in UI (No Simulated Approvals):**
  - Total extracted offers: **`12`**
  - Potentially Ready (valid grocery items awaiting operator group + consumer image approval in UI): **`9`** (`001`, `002`, `004`, `005`, `007`, `008`, `009`, `010`, `012`)
  - Blocked / Deferred (quarantined by extraction validation): **`3`**:
    - `leaflet-001_p023_003` (*Ditalini Rigati Large*, PEEP 400g): `INCOMPLETE_VISIBLE_ASSORTMENT`, `CURRENCY_UNVERIFIED_OR_CONFLICT`
    - `leaflet-001_p023_006` (*O-LITE CANOLA OIL 1.5L X2*, O-Lite `2x1.5l`): `EN_AR_WEIGHT_VOLUME_CONFLICT` (EN `1x1500` vs AR `1x1.5`), `PROMO_QTY_VS_MFG_PACK_CONFLICT`
    - `leaflet-001_p023_011` (*Barilla Sauce Bolognese*, Barilla 400g): `CURRENCY_UNVERIFIED_OR_CONFLICT`, `TEXT_VS_IMAGE_CONFLICT`
  - Step 4 UI currently displays **`Ready to Publish Now: 0`**, **`Deferred (Needs Review / Blocked): 12 (9 review · 3 blocked)`**, **`Blocked / Excluded: 3`**, with `Authorize Dev DB Write` unchecked and the publish button disabled until operator review and explicit authorization.

### 10.3 Step 2 — Metadata, Deferred Persistence & Bucket Routing Verification

| Verification Check | Observed Evidence |
|---|---|
| Retailer, dates, currency & scope | Retailer: **Carrefour** (`c2cc16c2-0006-4444-b000-c00000000006`); Validity: **`2026-11-11` → `2026-11-17`** (active on `2026-11-15`); Currency: **`SAR`** (`﷼` normalized); Scope: **`national`** (`National — Saudi Arabia (assumed)`); `metadataStatus: 'auto_accepted'`; `leafletTitle: null` (runaway repetitive string sanitized out). |
| Source leaflet & document identity | Linked to `doc_68ffdb75ca3b271e` (`carrefour-62800235-jeddah.pdf`, page `23`), stable deterministic `source_offer_id`s `doc_68ffdb75ca3b271e:p023:ip023_001:s01` .. `ip023_012:s01`. |
| Metadata revision persistence | Implemented via `BatchOrchestrationService.updateLeafletMetadata()` appending `metadataVersion` + `metadataRevisions[]` and flagging `needsUpdateReview = true` only on previously published offers from the edited leaflet. |
| Deferred offer evidence & validation retention | All `12` items retain local `offer_card_crop.webp` and `product_thumb_crop.webp` on disk (`12/12` verified), plus full `conflictCodes`, `blockingErrors`, and `deferredOfferReasons` for `003`, `006`, `011`. |
| Non-overwrite & duplicate protection | `publishApprovedCatalogBatch` iterates strictly over `eligibleOfferKeySet`, skips `deferredOfferKeySet`, runs per-offer `reconcileOffersAgainstDatabase`, and relies on `idx_offers_source_offer_id` uniqueness. |
| Storage bucket routing (`DEVELOPMENT_TEST`) | Verified live via `supabase.storage.listBuckets()`: `offer-images` (`public: false` — private evidence crops), `product-images` (`public: true` — approved consumer product thumbs), `offer-display-images` (`public: true`), `tmp` (`public: false`). Consumer images remain unapproved (`null`) unless explicitly approved by operator in UI. |

### 10.4 Step 3 — Read-Only Publication Preview (`DEVELOPMENT_TEST` `gykrbpykjhpyrdrinkuk`)

**Target Database Baseline Verified Untouched:** `products: 9`, `offers: 4`, `product_images: 0`, `offer_display_images: 0`, `publication_operations: 0`, `publication_journal_mutations: 0`.

1. **Current Unreviewed Baseline (Live UI `Preflight & Reconcile DB`):**
   - `ready: true`, `databaseContext: 'DEVELOPMENT_TEST'`
   - `Ready to Publish Now: 0`, `Deferred: 12` (`9` awaiting operator group/image approval + `3` quarantined), `DB Reconciliation: 0 new, 0 already published, 0 updates, 0 conflicts`.
2. **Projected Post-Operator-Approval Preview (In-Memory Read-Only `assessPublicationPreflight`, assuming operator approves the 9 clean items + product thumbs in UI and leaves `003`/`006`/`011` Blocked):**
   - **Ready Offers (`9` inserts):** `ip023_001` (*AL SAFEER MAZA RICE 10KG*), `ip023_002` (*G.FARMS EGYPTIAN RICE 5KG*), `ip023_004` (*AL MUHAIDIB PUNJABI RICE 10KG*), `ip023_005` (*AL AILA WHITE BASMATI RICE 5KG*), `ip023_007` (*RICE KING SP SELLA RICE 10KG*), `ip023_008` (*AL OSRA FINE SUGAR 10KG*), `ip023_009` (*HALAH SUNFLOWER OIL 2.9L*), `ip023_010` (*SUNWHITE CALROSE RICE 5KG*), `ip023_012` (*NADEC ORG EXTRA VIRGIN OLIVE OIL 1L*).
   - **Deferred / Blocked Offers (`3` skipped):** `ip023_003` (*Ditalini Rigati Large*), `ip023_006` (*O-LITE CANOLA OIL 1.5L X2*), `ip023_011` (*Barilla Sauce Bolognese*).
   - **Catalog Operations (`reconciliationSummary`):** `9` new `public.products` inserts (`t_batch2026111_001`, `_002`, `_004`, `_005`, `_007`, `_008`, `_009`, `_010`, `_012`), `9` new `public.offers` inserts (`classification: 'new'`), `0` duplicate skips, `0` updates, `0` conflicts.
   - **Storage Uploads (Predicted):** Up to `9` private evidence crops (`offer_card_crop.webp`) -> `offer-images` (`public: false`) + up to `9` operator-approved consumer product thumbs (`product_thumb_crop.webp`) -> `product-images` (`public: true`), `0` uploads for the `3` deferred items.
   - **Transaction Journal Scope:** `1` row in `public.publication_operations` (`environment_context: 'DEVELOPMENT_TEST'`, `target_project_ref: 'gykrbpykjhpyrdrinkuk'`, `batch_id: 'batch-2026-11-15T14-18-37-692853'`, `undo_eligible: true`, `leafletMetadataSnapshots` recorded) + `public.publication_journal_mutations` rows for all inserted `products`, `offers`, and `product_images` / storage objects.

**Step 4 Explicit Authorization Gate:** **STOPPED** at Step 4 in the live Electron window. No live DB writes, storage uploads, Undo operations, or paid Gemini calls have been executed. Awaiting operator inspection/approval of the candidate offers and product images in the UI, followed by explicit authorization to proceed with DEV publication (`Step 5`).


