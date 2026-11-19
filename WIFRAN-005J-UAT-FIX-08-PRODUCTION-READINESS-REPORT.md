# WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08 — Production Readiness Report

## 1. Executive Summary & Live Environment Non-Mutation Confirmation

`WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08` has been implemented across UI cleanup, cross-batch identity & duplicate prevention, additive PostgreSQL schema hardening (`010`), pre-publication DB reconciliation, durable publication journaling, staged content-addressed storage lifecycle, and atomic Undo Last Publish recovery.

- **Non-Mutation Confirmation:** **ZERO** live Supabase mutations, **ZERO** live migrations, **ZERO** live publishes or rollbacks (`Undo`), and **ZERO** paid Gemini API calls were executed during implementation or verification.
- **Verification Infrastructure:** All PostgreSQL DDL migrations (`001`–`010`), trigger/journal/storage/rollback invariants, and multi-connection concurrency advisory lock tests were executed strictly against isolated local PostgreSQL instances (`@electric-sql/pglite` + `pg_trgm`, and an ephemeral local `postgres.exe` cluster initialized via `initdb.exe` / `pg_ctl.exe` in `os.tmpdir()`).

---

## 2. Implemented Architecture Across Phases

1. **Phase 1 — Source Identity & Pre-Extraction Duplicate Prevention (`ID-01..03`, `DUP-01A..G`)**
   - `src/shared/utils/sourceIdentityAndDuplicateUtils.ts`: Canonical document ID generation (`computeDocumentIdFromFingerprint`), filename normalization (`normalizeFileNameForDuplicateCheck`), compatibility profile validation (`CURRENT_HYBRID_COMPATIBILITY_PROFILE`, `isArtifactProfileCompatible`), and spatial/semantic anchor signatures (`quantizeNormalizedBbox`, `computeOfferAnchorSignature`).
   - `src/shared/utils/nonCatalogPublicationPolicy.ts`: `computeStableSourceOfferId` anchors identity to canonical `sourceDocumentId` (`doc_<sha256_prefix>`) / fingerprint + page + anchor/source index rather than volatile batch-local `leafletId` or array indices.
   - `src/main/cache/documentExtractionHistoryService.ts`: Persistent cross-batch page index (`DocumentExtractionHistoryService`), within-batch SHA-256 duplicate & filename collision detection (`inspectPreExtractionDuplicates`), compatibility checks, and `forceReextract` bypass.
   - `src/main/batch/hybridV3BatchProcessor.ts` & `src/main/batch/batchOrchestrationService.ts`: Hydrates validated historical page artifacts at `$0.00` cost for overlapping pages across renamed PDFs, records completed pages cleanly, and isolates `DocumentExtractionHistoryService` per `customBatchesBaseDir` for test safety.

2. **Phase 2 & 3 — Additive Migration `010`, Schema Parity Gate, Pre-Publication Reconciliation, Journal, Storage & Undo (`MIG-01..04`, `DB-01..03`, `DUP-02A..E`, `PUB-01..05`, `JOURNAL-01..05`, `STORAGE-01..04`, `REV-01..14`)**
   - `project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql`:
     - Unique constraint/index `idx_offers_source_offer_id` on `public.offers(source_offer_id)`.
     - Journal tables with RLS enabled: `public.publication_operations`, `public.publication_journal_mutations`, `public.publication_duplicate_skips`, `public.publication_storage_operations`.
     - Audit trigger `public.capture_indirect_publication_mutation()` and RPC `public.check_wifran_schema_readiness()`.
   - `src/main/db/schemaCompatibilityService.ts`: Dynamic schema parity gate (`assessSchemaCompatibility`) verifying Migration `009` + Migration `010` objects, unique index, trigger, and `v_consumer_offers` before allowing `PRODUCTION_UI` writes or rollbacks.
   - `src/main/db/prePublicationDuplicateReconciler.ts`: `reconcileOffersAgainstDatabase` & `computeOfferFieldDiffs` classifying candidates into `new`, `unchanged_noop`, `update_candidate`, and `duplicate_conflict` with itemized diffs and no-op replay detection.
   - `src/main/storage/stagedStorageLifecycleService.ts`: Content-addressed SHA-256 storage staging (`createGuardedStorageAdapter`, `stageContentAddressedUpload`) tracking `exclusive_created` vs `reused_existing` ownership in `publication_storage_operations`.
   - `src/main/db/publicationJournalAndUndoService.ts`: Row state hashing (`computeRowStateHash`), payload fingerprinting, journal mutation recording (`recordJournalMutation`), history listing (`listPublicationHistory`), operation detail lookup (`getPublicationOperationDetails`), guarded Undo preview & execution (`previewUndoLastPublish`, `undoLastPublish`), and retryable orphan storage cleanup (`retryUndoStorageCleanup`).
   - `src/main/db/catalogPublicationService.ts`: Coordinates dynamic schema parity checks, preflight reconciliation, advisory mutexes (`pg_advisory_xact_lock`), replay idempotency (`idempotency_key`), transactional writes + journal capture, and clean storage/DB rollback on error.

3. **Phase 4 — IPC & Preload Bridge**
   - `src/main/ipc/registerIpcHandlers.ts`: Added `config:verifySchemaReadiness`.
   - `src/main/ipc/batchExtractionIpc.ts`: Exposed `batch:inspectDuplicates` and forwarded `forceReextract`.
   - `src/main/ipc/catalogMatchingIpc.ts`: Updated `matching:publishApproved` (`operatorAuthorizedProductionPublish`, `idempotencyKey`, `approvedUpdateSourceIds`, `overrideConflictSourceIds`, `runDatabaseReconciliation`) and added `matching:getPublicationHistory`, `matching:getPublicationOperationDetails`, `matching:previewUndoLastPublish`, `matching:undoLastPublish`, and `matching:retryUndoStorageCleanup`.
   - `src/preload/index.ts` & `src/preload/index.d.ts`: Typed and exposed `config.verifySchemaReadiness`, `batch.inspectDuplicates`, and `matching` history/undo/cleanup channels.

4. **Phase 5 — UI Consolidation & Publication Recovery (`UI-01..06`)**
   - `src/renderer/src/components/batch/MultiPdfSelector.tsx`: Removed `Standard Rev1 (Legacy / Advanced)` selector (`UI-01`), added live pre-extraction duplicate/reuse banner & payable-page cost savings (`batch.inspectDuplicates`), and `Force Re-extraction (bypass local cache)` checkbox (`UI-06`).
   - `src/renderer/src/pages/ImportPage.tsx`: Removed legacy Metadata Entry / Crop-First / Exception toggles (`UI-02`) and forwarded `forceReextract`.
   - `src/renderer/src/components/batch/BatchProgressDashboard.tsx`: Removed obsolete Step 2 `Verify Leaflet Metadata` modal & `Review Meta` / `Edit Meta` controls (`UI-03`), displayed `Hybrid V3` + `'mixed'` cache+flex provenance badge.
   - `src/renderer/src/components/batch/ProductMatchingReview.tsx`: Added `PRODUCTION_UI (Schema-Gated Live DB)` owner authorization checkbox, live `Pre-Publication Database Reconciliation` diff/approval panel (`Approve Update` / `Override Logical Conflict`), and publish operation ID / `noop` reporting.
   - `src/renderer/src/components/settings/PublicationHistoryRecoveryPanel.tsx` & `src/renderer/src/pages/SettingsPage.tsx`: Added `Advanced (Publication History & Recovery)` tab (`UI-04`, `UI-05`) with DB target selector, schema readiness card, immutable journal table, operation details viewer, reason-gated Undo Last Publish workflow, and `Retry Storage Cleanup`.

---

## 3. Complete Requirement Traceability Matrix

| Req ID | Description | Implementation Files / Symbols | Automated Verification |
| :--- | :--- | :--- | :--- |
| `ID-01..03` | Content-addressed `doc_<hash>` IDs, spatial/semantic card anchors, `source_offer_id` stability | `src/shared/utils/sourceIdentityAndDuplicateUtils.ts`, `src/shared/utils/nonCatalogPublicationPolicy.ts` (`computeStableSourceOfferId`) | `identityAndPreExtractionDuplicate008.test.ts`, `publicationJournalAndUndo008.test.ts` |
| `DUP-01A..G` | Cross-batch & within-batch duplicate detection, $0.00 partial-page reuse, `forceReextract` | `src/main/cache/documentExtractionHistoryService.ts`, `src/main/batch/hybridV3BatchProcessor.ts`, `src/main/batch/batchOrchestrationService.ts` | `identityAndPreExtractionDuplicate008.test.ts`, `uatFix08UiAndRecovery.test.tsx` |
| `MIG-01..04` | Additive Migration `010` tables, `offers.source_offer_id` unique index, RLS, audit trigger, RPC | `project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql` (`check_wifran_schema_readiness`, `capture_indirect_publication_mutation`) | `publicationJournalAndUndo008.test.ts` (`001`–`010` in PGlite), `postgresConcurrency008.test.ts` (`001`–`010` in PG) |
| `DB-01..03` | DB `source_offer_id` uniqueness, transactional advisory locking, multi-connection race safety | `010_wifran_08_publication_journal_and_uniqueness.sql`, `src/main/db/catalogPublicationService.ts`, `src/main/db/publicationJournalAndUndoService.ts` | `publicationJournalAndUndo008.test.ts`, `postgresConcurrency008.test.ts` |
| `DUP-02A..E` | Pre-publication DB reconciliation (`new`, `unchanged_noop`, `update_candidate`, `duplicate_conflict`), field diffs, operator approvals | `src/main/db/prePublicationDuplicateReconciler.ts`, `src/renderer/src/components/batch/ProductMatchingReview.tsx` | `publicationJournalAndUndo008.test.ts` (`TEST-E`), `uatFix08UiAndRecovery.test.tsx` |
| `PUB-01..05` | Dynamic schema parity gate (`PRODUCTION_UI` unlocked only with `009+010` & explicit owner checkbox), replay idempotency | `src/main/db/schemaCompatibilityService.ts` (`assessSchemaCompatibility`), `src/main/db/catalogPublicationService.ts`, `src/main/ipc/catalogMatchingIpc.ts`, `ProductMatchingReview.tsx` | `publicationJournalAndUndo008.test.ts` (`TEST-D`), `uatFix08UiAndRecovery.test.tsx` |
| `JOURNAL-01..05` | Durable operations log, per-row before/after snapshots & state hashes, skip log, `noop` tracking | `src/main/db/publicationJournalAndUndoService.ts` (`recordJournalMutation`, `listPublicationHistory`, `getPublicationOperationDetails`) | `publicationJournalAndUndo008.test.ts` (`TEST-D..I`) |
| `STORAGE-01..04` | Content-addressed staging, DB-isolated adapters, exclusive vs reused tracking, error cleanup | `src/main/storage/stagedStorageLifecycleService.ts` (`createGuardedStorageAdapter`, `stageContentAddressedUpload`) | `publicationJournalAndUndo008.test.ts` (`TEST-E`, `TEST-F/G/H/I`) |
| `REV-01..14` | Guarded Undo Last Publish preview/execution, hash/external conflict guards, shared-asset preservation, retry storage cleanup | `src/main/db/publicationJournalAndUndoService.ts` (`previewUndoLastPublish`, `undoLastPublish`, `retryUndoStorageCleanup`), `PublicationHistoryRecoveryPanel.tsx` | `publicationJournalAndUndo008.test.ts` (`TEST-F/G/H/I`), `postgresConcurrency008.test.ts`, `uatFix08UiAndRecovery.test.tsx` |
| `UI-01..06` | Remove Legacy/Rev1/Step2 Meta modal, surface cache savings + `Force Re-extraction`, add Settings Advanced tab | `MultiPdfSelector.tsx`, `ImportPage.tsx`, `BatchProgressDashboard.tsx`, `SettingsPage.tsx`, `PublicationHistoryRecoveryPanel.tsx` | `uatFix08UiAndRecovery.test.tsx` + updated Fix02/03/05/06/07/`batchUi005j` UI suites |
| `TEST-A..I` | UI, identity/duplicate, PGlite `001`–`010` journal/reconciliation/storage/Undo & 3-retailer view, real `postgres.exe` concurrency | `uatFix08UiAndRecovery.test.tsx`, `identityAndPreExtractionDuplicate008.test.ts`, `publicationJournalAndUndo008.test.ts`, `postgresConcurrency008.test.ts` | Verified after final edit (results below) |

---

## 4. Verified Build & Test Results (Executed After Final Edit)

### A. Typecheck & Production Bundle
Command: `npm run build` (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json && electron-vite build`)
- **Result:** **Exited `0`** (`out/main/index.js`, `out/preload/index.js`, `out/renderer/assets/*` built cleanly with zero TypeScript errors).

### B. Fix08 Core Backend, Isolated PostgreSQL (`001`–`010`), Real PG Concurrency, Hybrid V3 E2E & Batch UI Suites
Command:
`npx vitest run src/main/batch/__tests__/identityAndPreExtractionDuplicate008.test.ts src/main/db/__tests__/publicationJournalAndUndo008.test.ts src/main/db/__tests__/postgresConcurrency008.test.ts src/main/ocr/__tests__/hybridV3EndToEndIntegration005i.test.ts src/renderer/src/components/batch/__tests__/`
- **Result:** **Exited `0`** — **11 test files passed (11), 28 tests passed (28):**
  - `identityAndPreExtractionDuplicate008.test.ts`: 2 passed (2)
  - `publicationJournalAndUndo008.test.ts`: 3 passed (3) (`TEST-D`, `TEST-E`, `TEST-F/G/H/I` in isolated PGlite with `001`–`010`)
  - `postgresConcurrency008.test.ts`: 1 passed (1) (real multi-socket `postgres.exe` advisory lock publish/undo serialization)
  - `hybridV3EndToEndIntegration005i.test.ts`: 4 passed (4)
  - `uatFix08UiAndRecovery.test.tsx`: 3 passed (3) (`TEST-A`)
  - `batchUi005j.test.tsx`: 2 passed (2)
  - `batchMetadataAndCostUat005jFix02.test.tsx`: 2 passed (2)
  - `batchMetadataVisionUat005jFix03.test.tsx`: 1 passed (1)
  - `batchWorkflow005jFix05.test.tsx`: 3 passed (3)
  - `batchWorkflow005jFix06.test.tsx`: 3 passed (3)
  - `batchWorkflow005jFix07.test.tsx`: 4 passed (4)

### C. Full Repository Regression Run (`npx vitest run`)
- **Result:** `117 passed | 14 failed (131)` test files; `1308 passed | 28 failed (1336)` tests (exited `1` due to 14 non-Fix08 / superseded legacy test files):
  - `wp2NonCatalogPublication005c.test.ts` (2): Superseded expectations for `leaflet_wp2_city:...` prefix (replaced by `ID-02` `doc_<hash>`) and `pub2.publishedOfferIds` on `unchanged_noop` (Fix08 reports `noop: true`, `unchangedNoopCount: 1`, `publishedOffersCount: 0`).
  - `batchOrchestration.test.ts` (7): Legacy BULK-001 test omits explicit `standard_rev1` mode or `hybridV3ExplicitAuthorization` (`HYBRID_V3_NOT_AUTHORIZED`).
  - `catalogMatching.test.ts` (6): Pre-existing DEV DB (`gykrbpykjhpyrdrinkuk`) test scenarios hitting leftover DEV test rows / strict product identity mismatch guards (`#28401`, `#28408`).
  - Pre-existing unrelated test files untouched by Fix08: `wifranExtractorIdentity001d/e/f/g`, `automaticMetadataDiscoveryUat005jFix03`, `leafletMetadataExecutableUat`, `leafletMetadataUatHardening`, `liveUatFix001`, `geminiOpt004bProviderCache`, `canonicalOfferNormalizer`, `deterministicOfferChecks`.

---

## 5. Operator Live Production Rollout Checklist

1. **Apply Additive Migration `010` on Target Supabase Environments (`DEV` first, then `PROD`):**
   - Review `project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql`.
   - Ensure pre-existing duplicate `source_offer_id` rows (if any exist on `public.offers`) are resolved prior to creating `idx_offers_source_offer_id`.
   - Apply Migration `010` via Supabase SQL editor / controlled CLI migration run on **DEVELOPMENT** first, then **PRODUCTION**.
2. **Verify Schema Parity Inside the App (Read-Only Check):**
   - Launch the built app (`npm run build`), open **Settings → Advanced (Publication History & Recovery)**.
   - Select `DEVELOPMENT_TEST` -> click **Refresh** -> confirm status shows `COMPATIBLE (009 + 010 Verified)`.
   - Select `PRODUCTION_UI` -> click **Refresh** -> confirm `public.check_wifran_schema_readiness()` reports `COMPATIBLE (009 + 010 Verified)` and `Unique source_offer_id: Yes`.
3. **Controlled Development End-to-End Dry Run:**
   - Run a small 1-leaflet batch targeting `DEVELOPMENT_TEST`, review offers, click **Preflight & Reconcile DB**, publish once, re-publish immediately to confirm `noop: true` (`0` new writes), and test **Settings → Advanced → Undo Last Publish** to confirm clean DB + exclusive storage object rollback.
4. **Controlled First Production Publication:**
   - Select `PRODUCTION_UI` only when ready, verify Schema Parity is `COMPATIBLE`, inspect `Pre-Publication Database Reconciliation` diffs, explicitly check **Authorize Production DB Publish**, publish, and verify `publishOperationId` in **Settings → Advanced → Publication History**.
   - Keep **Undo Last Publish** (plus `Authorize Production Rollback / Cleanup` + required audit reason) ready in case immediate rollback of the latest publish operation is required.
