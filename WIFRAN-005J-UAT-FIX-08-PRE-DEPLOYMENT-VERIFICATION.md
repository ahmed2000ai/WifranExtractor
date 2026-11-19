# WIFRAN-005J-UAT-FIX-08 — Pre-Deployment Verification & Regression Closure Report

**Date:** 2026-11-15  
**Scope:** Pre-deployment verification and full-suite regression closure for `WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08` prior to controlled Migration `010` execution.  
**Live Mutation Constraint Honored:** Zero live Supabase database mutations, migrations, publications, or Undo operations were executed against `gykrbpykjhpyrdrinkuk` (DEV) or `swratbmclahjyekouned` (PROD). Zero paid Gemini API calls were executed.

---

## Executive Verdicts

| Environment | Verdict | Rationale |
| --- | --- | --- |
| **DEV (`gykrbpykjhpyrdrinkuk`)** | **READY FOR CONTROLLED MIGRATION `010`** *(after read-only SQL pre-checks)* | All Fix-08 implementation regressions are fixed (`0` Fix-08 failures), Migration `010` SQL contracts audit cleanly against `001`–`009`, `npm run build` passes with exit code `0`, and isolated PGlite + local `postgres.exe` concurrency/lifecycle/recovery tests pass `100%`. Controlled deployment must first run the Section 3 read-only pre-migration queries on DEV. |
| **PROD (`swratbmclahjyekouned`)** | **NOT YET AUTHORIZED FOR PRODUCTION DEPLOYMENT** | Blocked pending: (1) controlled Migration `010` rollout and post-migration smoke verification in DEV first, (2) running the read-only pre-migration audit queries against PROD to confirm zero duplicate or incompatible `source_offer_id` / secondary rows, and (3) explicit owner authorization per environment safety gates. |

---

## 1. Full-Suite Regression Resolution & Classification

### 1.1 Baseline Before Closure (`npx vitest run`)
- **Test Files:** `117 passed | 14 failed (131)`
- **Tests:** `1308 passed | 28 failed (1336)` (+ 3 suite-level import failures = 31 failure blocks)

#### Exact Original 14 Failing Files & 28 Failed Tests (+ 3 Suite Import Failures)

| # | Test File | Original Failures | Classification | Root Cause & Resolution |
| --- | --- | --- | --- | --- |
| 1 | `src/main/batch/__tests__/wp2NonCatalogPublication005c.test.ts` | 2 tests (`T12`, `T14 & T15`) | **Cat 1 (Genuine Fix-08 Implementation Regressions)** + **Cat 3 (Shared DEV DB State)** + **Cat 2 (`T14/T15` superseded behavior)** | (1) `resolveStableDocumentScope` (`src/shared/utils/nonCatalogPublicationPolicy.ts`) fell back to raw `offer.sourceFileName`, colliding cross-retailer same-name filenames when `sourceDocumentId` was unset -> removed unsafe filename fallback. (2) `computePublishPayloadFingerprint` (`src/main/db/catalogPublicationService.ts`) omitted operator approval/decision fields (`operatorDecision`, `tempDecision`, `nonCatalogDecision`, `nonCatalogCategory`, `approveAllUpdates`, `approvedUpdateSourceIds`, `overrideConflictSourceIds`), causing stale `'noop'` idempotent replays -> added all approval fields to payload fingerprint. (3) Migrated test persistence from shared live DEV (`gykrbpykjhpyrdrinkuk`) to `createIsolatedWifranPostgres()` and asserted both same-key `idempotentReplay: true` and fresh-key `noop: true, unchangedNoopCount: 1`. **Now 12/12 passing.** |
| 2 | `src/main/batch/__tests__/batchOrchestration.test.ts` | 7 tests (`reuses existing verified extractions...`, `generates unique batch-scoped offer keys...`, `resolves product_thumb_crop.webp...`, `preserves brand information...`, `filters unified offers...`, `handles leaflet failure gracefully...`, `confirms all batch offers...`) | **Cat 2 (Intentionally Superseded Behavior)** | `005J-UAT-FIX-05` changed `createBatch()` default pipeline mode from legacy Rev1 to `'hybrid_v3'`. The 7 tests mock `staged-draft.json` fixtures built for legacy Rev1 without specifying `extractionPipelineMode: 'legacy_rev1'`. Added `extractionPipelineMode: 'legacy_rev1'` to those legacy fixture tests without altering production behavior. **Now 13/13 passing.** |
| 3 | `src/main/batch/__tests__/catalogMatching.test.ts` | 6 tests (`Scenario 1`, `Scenario 3`, `Scenario 5`, `Scenario 5B`, `Scenario 9`, `Scenario 9B` in Part 5) | **Cat 3 (Shared Live DEV DB Contamination)** + **Cat 1 (Fix-08 `promo_mechanic` / test assertions)** | (1) Part 5 mutated/queried shared live DEV `gykrbpykjhpyrdrinkuk` where residual offers/products triggered secondary dedup conflicts and shared `idempotencyKey` replays -> isolated Part 5 onto `createIsolatedWifranPostgres()` (`001`–`010`) and ephemeral local `postgres.exe` (`PG_BIN_DIR`) for `Scenario 5B` real multi-connection advisory lock race. (2) Fixed `promo_mechanic` check in `src/main/db/prePublicationDuplicateReconciler.ts` so distinct mechanics (`price_cut` vs `bundle_price` / `buy_n_get_m`) are not conflated into `duplicate_conflict`. (3) Supplied missing `matchingDatabaseContext: 'DEVELOPMENT_TEST'` (`Scenarios 3, 9`) and distinct `idempotencyKey` (`Scenario 7`). **Now 58/58 passing.** *(Note: Part 4's 4 Supabase PostgREST `brandGroupingService` query tests intentionally continue exercising seeded `BrandRegressionTest400` rows against DEV read/PostgREST client.)* |
| 4 | `src/shared/utils/__tests__/wifranExtractorIdentity001e.test.ts` | 1 suite import error | **Cat 4 (Unrelated Pre-Existing Defect)** | Pre-Fix08 `WIFRAN-ENV-ISOLATION-002` added top-level `assertProductionMaintenanceAuthorized(__filename)` in `scripts/apply-migration-008.ts`, throwing `[PRODUCTION_SAFETY_QUARANTINE]` upon Vitest module import. |
| 5 | `src/shared/utils/__tests__/wifranExtractorIdentity001f.test.ts` | 1 suite import error | **Cat 4 (Unrelated Pre-Existing Defect)** | Same top-level `scripts/apply-migration-008.ts` quarantine throw on Vitest import. |
| 6 | `src/shared/utils/__tests__/wifranExtractorIdentity001g.test.ts` | 1 suite import error | **Cat 4 (Unrelated Pre-Existing Defect)** | Same top-level `scripts/apply-migration-008.ts` quarantine throw on Vitest import. |
| 7 | `src/main/metadata/__tests__/automaticMetadataDiscoveryUat005jFix03.test.ts` | 1 timeout (`inspects actual local UAT PDFs offline...`) | **Cat 4 / CPU Contention Timeout** | Timed out at `45000ms` under parallel full-suite CPU load (+ Windows `EBUSY` temp cleanup error in `afterAll`). Verified **passes 6/6 (`25.63s`)** when executed standalone. |
| 8 | `src/shared/utils/__tests__/canonicalOfferNormalizer.test.ts` | 2 tests (`normalizes a legacy response correctly`, `normalizes a candidate-based response correctly`) | **Cat 4 (Unrelated Pre-Existing Defect)** | Pre-Fix08 (`git diff 52f74d0` shows untouched): `normalizePackUnit('liter')` maps to `'l'` (test expects `'liter'`), and candidate fixture omits `item_number` required by `CandidateItemOcrSchema`, falling back so `title_ar` is `null`. |
| 9 | `src/shared/utils/__tests__/deterministicOfferChecks.test.ts` | 1 test (`detects original price misclassified as offer price`) | **Cat 4 (Unrelated Pre-Existing Defect)** | Pre-Fix08 (`deterministicOfferChecks.ts` matches `all_price_candidates` only when `normalized_value === offerPrice`, leaving `selectedCand` undefined when candidate is original price `25 !== 10`). |
| 10 | `src/main/ocr/__tests__/geminiOpt004bProviderCache.test.ts` | 3 tests (`evaluates eligibility and break-even...`, `evaluates break-even correctly for Flex Tier...`, `calculates storage cost accurately...`) | **Cat 4 (Unrelated Pre-Existing Defect)** | Pre-Fix08 Nov-2026 Gemini pricing table uses Flex `$0.375/$0.0375/$1.875` and storage `$0.50` vs hardcoded `$0.50/$1.00` assertions (`0.01` vs `0.02`, break-even `2/3` vs `3/5`). |
| 11 | `src/main/metadata/__tests__/liveUatFix001.test.ts` | 2 tests (`13 & 14. Per-attempt raw Gemini provider archives...`, `20. Cost summaries...`) | **Cat 4 (Unrelated Pre-Existing Defect)** | Same pre-Fix08 Nov-2026 Flex rate (`$0.0090675` computed vs hardcoded `$0.018135` assertion). |
| 12 | `src/shared/utils/__tests__/wifranExtractorIdentity001d.test.ts` | 1 test (`Requirement 5: Staged draft alias learning...`) | **Cat 4 (Unrelated Pre-Existing Defect)** | Pre-Fix08 `WIFRAN-EXTRACTOR-METADATA-004` added unconditional `validatePublishReadiness()` inside `stagedLeafletDraftService.ts`, failing `resNoAudit.ok` when `tmpDir` lacks confirmed metadata. |
| 13 | `src/main/metadata/__tests__/leafletMetadataUatHardening.test.ts` | 1 test (`Scenario 7: Category matches require verified affected-offer operator confirmation...`) | **Cat 4 (Unrelated Pre-Existing Defect)** | Hardcoded fixture `weekendEndDate = '2026-11-09'` is before current system date (`2026-11-15`), triggering `expired_offer` -> `'skip_or_quarantine'`. |
| 14 | `src/main/metadata/__tests__/leafletMetadataExecutableUat.test.ts` | 2 tests (`4. Case C ... discovers general validity ...`, `Stage 2: maps specific offer p004_item009...`) | **Cat 4 (Unrelated Pre-Existing Defect)** | Pre-Fix08 metadata discovery returns `0` `pageExceptions` vs expected `1` on `case_c_mixed_page`, and `'2026-11-09'` triggers `expired_offer` -> `'skip_or_quarantine'` in Stage 2. |

### 1.2 Post-Fix Verification Results (After Final Code Edit)
1. **`npm run build` (`typecheck:node` + `typecheck:web` + `electron-vite build`):** **Exited `0`** (`out/main`, `out/preload`, `out/renderer` built cleanly).
2. **Targeted Fix-08 & Regression-Closure Suite (`7 files`):** **Passed `7/7` files, `93/93` tests (`51.53s`)**:
   - `src/main/batch/__tests__/identityAndPreExtractionDuplicate008.test.ts` — `2/2` passed
   - `src/main/batch/__tests__/wp2NonCatalogPublication005c.test.ts` — `12/12` passed
   - `src/main/batch/__tests__/batchOrchestration.test.ts` — `13/13` passed
   - `src/main/db/__tests__/publicationJournalAndUndo008.test.ts` — `3/3` passed
   - `src/main/db/__tests__/postgresConcurrency008.test.ts` — `1/1` passed *(real local `postgres.exe` TCP multi-connection advisory lock test)*
   - `src/main/db/__tests__/preDeploymentVerification008.test.ts` — `4/4` passed
   - `src/main/batch/__tests__/catalogMatching.test.ts` — `58/58` passed *(including Part 5 `Scenario 5B` real `postgres.exe` race)*
3. **Full Suite (`npx vitest run`):**
   - **Test Files:** `121 passed | 11 failed (132)` *(new `preDeploymentVerification008.test.ts` added, all 3 regression files resolved)*
   - **Tests:** `1327 passed | 13 failed (1340)` *(3 suite import failures + 13 test failures = 0 Fix-08 / workflow regressions; all remaining 11 failing files are pre-existing Category 4 items or the CPU-contention timeout in `automaticMetadataDiscoveryUat005jFix03.test.ts` which passes `6/6` in `25.63s` standalone).*

---

## 2. Source Identity & Duplicate Protection Verification

Verified by [`identityAndPreExtractionDuplicate008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/__tests__/identityAndPreExtractionDuplicate008.test.ts) (`2/2`) and [`preDeploymentVerification008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/preDeploymentVerification008.test.ts) (`SEC-2`):

1. **Same PDF under different filenames:** `computeDocumentIdFromFingerprint()` yields identical `documentId` (`doc_<sha256_prefix>`), and `DocumentExtractionHistoryService.inspectPreExtractionDuplicates()` classifies the renamed copy as `'exact_duplicate_full_reuse'` with `totalPayablePages = 0`.
2. **Same leaflet re-encoded or recompressed (distinct PDF SHA-256):** Pre-extraction binary SHA check does **not** suppress it (`'new_document'`, proving the system does not rely solely on PDF SHA-256). Instead, `reconcileOffersAgainstDatabase()` matches overlapping `(supermarket_id, location_scope, city_id/region_id, datesOverlap, pack/size, is_loyalty_required, promo_mechanic, product_id/title)` and blocks publication as `'duplicate_conflict'`. Uncertain identity fails closed as a conflict.
3. **Same source offer extracted in different batches:** Identical `source_document_id` + `sourceOfferAnchor` -> identical `source_offer_id` -> `CatalogPublicationService.publishApprovedCatalogBatch()` returns `{ noop: true, unchangedNoopCount: 1 }` with zero DB writes.
4. **Same source offer with changed OCR ordering or minor bounding-box variations:** `computeOfferAnchorSignature()` uses normalized semantic identity plus 10-bucket `quantizeNormalizedBbox()`, so changing array order (`item_7` vs `item_0`) and jittering normalized box coordinates within the bucket produces the identical `sourceOfferAnchor` and `source_offer_id`.
5. **Same source offer with corrected promotional price:** `reconcileOffersAgainstDatabase()` classifies as `'update_candidate'` with `offer_price` in `fieldDiffs`, blocks automatic overwrite when `enforceUpdateApproval: true`, and updates cleanly when approved via `approvedUpdateSourceIds`.
6. **Same product + retailer during a different offer week:** Distinct `offer_start_date..offer_end_date` (`2026-11-18..2026-11-24`) publishes alongside week `2026-11-11..2026-11-17` as a separate row.
7. **Legitimate distinct promotional tiers:** Offers sharing the same product, retailer, and week with distinct `is_loyalty_required` (`true` vs `false`) or distinct `promo_mechanic` (`price_cut` vs `loyalty_price` vs `buy_n_get_m`) publish cleanly as distinct rows (`conflictsCount = 0`).

---

## 3. Migration `010` Compatibility Audit & Read-Only Pre-Migration SQL Inspection Queries

### 3.1 Code & SQL Contract Audit ([`010_wifran_08_publication_journal_and_uniqueness.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql))
- **Contract parity (`001`–`009` + [`schemaCompatibilityService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/schemaCompatibilityService.ts)):**
  - `public.offers.source_offer_id` column is `text` (nullable for legacy rows), covered by conditional unique index `idx_offers_source_offer_id ON public.offers (source_offer_id) WHERE source_offer_id IS NOT NULL`.
  - Secondary deduplication index `idx_offers_secondary_dedup` is explicitly **non-unique** (used by `reconcileOffersAgainstDatabase()`, allowing legitimate distinct promo tiers/pack variants without constraint breakage).
  - `capture_indirect_publication_mutation()` trigger attaches safely to `offer_status_history` and `offer_revision_snapshots` with `MAX(sequence_no) + 1` serialized inside the transaction's single `active_publish_operation_id`.
  - Zero FK dependency on Migration `009` tables (`product_alias_proposals`, `product_alias_audit_log`), though `check_wifran_schema_readiness()` explicitly reports `009` + `010` readiness together and `assessSchemaCompatibility()` fails closed (`PRODUCTION_PUBLICATION_BLOCKED`) until both `009` and `010` objects exist.
  - RLS enabled across journal tables (`publication_operations`, `publication_journal_mutations`, `publication_storage_operations`) with `REVOKE ALL FROM PUBLIC, anon, authenticated`, `GRANT ... TO service_role`, and `SECURITY DEFINER SET search_path = public, pg_temp`.

### 3.2 Read-Only Pre-Migration Inspection Queries
All 6 read-only inspection queries below were executed and syntax/schema-verified inside [`preDeploymentVerification008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/preDeploymentVerification008.test.ts) (`SEC-3`) against both pre-010 (`001`–`009`) and post-010 (`001`–`010`) isolated PGlite schemas. Run these **read-only** against DEV before applying Migration `010`:

```sql
-- 1. Check for duplicate non-null source_offer_id values (MUST return 0 rows before idx_offers_source_offer_id creation)
SELECT source_offer_id, count(*)::int AS row_count
FROM public.offers
WHERE source_offer_id IS NOT NULL
GROUP BY source_offer_id
HAVING count(*) > 1;

-- 2. Inspect legacy rows with NULL source_offer_id (allowed by partial unique index, useful baseline audit)
SELECT count(*)::int AS null_source_offer_id_count
FROM public.offers
WHERE source_offer_id IS NULL;

-- 3. Detect pre-existing secondary duplicate groups on published offers
SELECT supermarket_id, product_id, offer_start_date, offer_end_date, location_scope, count(*)::int AS group_count
FROM public.offers
WHERE product_id IS NOT NULL AND status = 'published'
GROUP BY supermarket_id, product_id, offer_start_date, offer_end_date, location_scope
HAVING count(*) > 1;

-- 4. Verify offers.source_offer_id data type and existing indexes
SELECT c.data_type, i.indexname, i.indexdef
FROM information_schema.columns c
LEFT JOIN pg_indexes i
  ON i.schemaname = c.table_schema
 AND i.tablename = c.table_name
 AND i.indexdef ILIKE '%source_offer_id%'
WHERE c.table_schema = 'public'
  AND c.table_name = 'offers'
  AND c.column_name = 'source_offer_id';

-- 5. Verify v_consumer_offers definition before re-verification
SELECT viewname, definition
FROM pg_views
WHERE schemaname = 'public' AND viewname = 'v_consumer_offers';

-- 6. Verify Migration 009 dependency tables exist prior to Migration 010
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('product_alias_proposals', 'product_alias_audit_log', 'temp_product_staging')
ORDER BY tablename;
```

Post-migration readiness verification (after applying `010`):
```sql
SELECT public.check_wifran_schema_readiness();
```

---

## 4. Publish, No-Op, Update, and Undo Lifecycle Verification

Verified end-to-end against isolated PostgreSQL (`001`–`010`) + `createInMemoryStorageAdapter()` in [`preDeploymentVerification008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/preDeploymentVerification008.test.ts) (`SEC-4`) and [`publicationJournalAndUndo008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/publicationJournalAndUndo008.test.ts) (`TEST-D..TEST-I`):

1. **Multi-retailer initial publish (Op 1):** Catalog offer (`P_EXISTING` reused), new temporary product offer (`temp_lurpak_400` -> created `products` row), and approved non-catalog offer inserted cleanly.
2. **Direct SQL table & view assertions:** Confirmed `publication_operations`, `publication_journal_mutations` (`products` insert + 3 `offers` inserts), `publication_storage_operations` (`1 exclusive_created` + `reused_existing`), `offers`, `products`, and `v_consumer_offers` (exposes linked `product_id` for catalog offers, masks `product_id` as `NULL` for non-catalog offers).
3. **Price update (Op 2):** Approved `update_candidate` updates `offer_price` (`17.95 -> 15.95`); `publication_journal_mutations` records exact `pre_state.offer_price = 17.95` and `post_state.offer_price = 15.95`.
4. **Identical repeat (Op 3):** Fresh `idempotencyKey` classifies as strict `noop: true` with `0` rows written to `publication_journal_mutations`.
5. **Undo selector skips `noop` & reverts Op 2 cleanly:** `previewUndoLastPublish()` skips Op 3 and selects Op 2; `undoLastPublish()` restores `offer_price` to `17.95` while leaving all Op 1 offers untouched.
6. **External modification guardrail (`undo_blocked`):** Direct post-publish SQL mutation on an Op 1 row (`offer_price = 18.88`) causes `undoLastPublish()` to refuse cleanly with `status: 'undo_blocked'`.
7. **Full Op 1 Undo & shared asset preservation:** After restoring the external edit, `undoLastPublish()` removes Op 1 offers, deletes newly created temporary product, deletes the exclusive storage object (`exclusiveCrop`), and preserves pre-existing `P_EXISTING` and pre-existing `sharedCrop` (`storage.storedObjects.size === 1`).

---

## 5. Operational Recovery & Concurrency Verification

Verified in [`preDeploymentVerification008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/preDeploymentVerification008.test.ts) (`SEC-5`), [`publicationJournalAndUndo008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/publicationJournalAndUndo008.test.ts), [`postgresConcurrency008.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/postgresConcurrency008.test.ts), and [`catalogMatching.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/__tests__/catalogMatching.test.ts) (`Scenario 5B`):

| Recovery Scenario | Outcome | Test Evidence |
| --- | --- | --- |
| **Restart after successful publish** | **PASSED** — Fresh `CatalogPublicationService` instance queries committed `publication_operations`, details, and undo preview intact. | `SEC-5` (`preDeploymentVerification008.test.ts`) |
| **Timeout after DB commit before client ack** | **PASSED** — Replaying same `idempotencyKey` after simulated timeout/restart returns `idempotentReplay: true` with original `publishOperationId` and zero duplicate DB writes. | `SEC-5`, `TEST-D` |
| **Crash / FK failure during staging before DB commit** | **PASSED** — Transaction rolls back cleanly (`0` partial offers/products), and newly staged exclusive crop objects are deleted while prior storage objects remain intact. | `SEC-5`, `TEST-E` |
| **Failure after DB reversal before storage cleanup** | **PASSED** — Simulated 503 during storage deletion leaves DB completely reverted and records `status: 'undo_cleanup_pending'`, surviving service restart until `retryUndoStorageCleanup()` completes deletion (`status: 'undone'`). | `SEC-5`, `TEST-F/G/H/I` |
| **Repeated Undo invocation** | **PASSED** — Second `undoLastPublish()` call returns `alreadyUndone: true` idempotently without double-delete errors. | `SEC-5`, `TEST-F/G/H/I` |
| **Concurrent publish & Undo serialization** | **PASSED** — Two separate TCP connections on real local `postgres.exe` serialize cleanly via PostgreSQL transaction advisory locks (`wifran:publication_global_mutex`), yielding deterministic `1` offer / `1` product with zero races. | `postgresConcurrency008.test.ts`, `Scenario 5B` (`catalogMatching.test.ts`) |

---

## 6. Remaining Risks & Controlled DEV Migration Prerequisites

### Remaining Pre-Existing Risks (Non-Fix-08)
1. **11 pre-existing failing Vitest files (`3` import quarantine failures + `8` Category 4 suites, including `1` timeout under full CPU contention):** All stem from pre-Fix-08 commits (`scripts/apply-migration-008.ts` quarantine, Nov-2026 Gemini pricing updates, unit normalization `'l'` vs `'liter'`, `METADATA-004` gate vs `001d`, Case C fixture parser, and hardcoded `2026-11-09` expiry fixtures). None affect Fix-08 publication/journal/undo guarantees, though cleaning those legacy tests/fixtures should be queued separately.
2. **Re-encoded/recompressed PDF edge cases without catalog link:** Logical duplicate reconciliation reliably catches re-encoded duplicates (`duplicate_conflict`) when retailer, overlapping dates, scope, pack size, and product/title match; completely novel unlinked titles with altered PDF bytes and different phrasing would rely on operator review rather than deterministic auto-blocking.
3. **`catalogMatching.test.ts` Part 4 (`BrandRegressionTest400`):** Continues calling live DEV PostgREST read/test-fixture queries for `brandGroupingService`; do not run it against PROD contexts.

### Prerequisites Before Applying Migration `010` to DEV (`gykrbpykjhpyrdrinkuk`)
1. Take a clean database backup / snapshot of `gykrbpykjhpyrdrinkuk`.
2. Execute the **6 read-only pre-migration SQL inspection queries** (Section 3.2) against DEV and verify `0` duplicate non-null `source_offer_id` rows and confirm whether any legacy duplicate published rows require cleanup or archival.
3. Confirm Migration `009` objects exist (`product_alias_proposals`, `product_alias_audit_log`, `approve_product_alias_atomic`).
4. Apply [`010_wifran_08_publication_journal_and_uniqueness.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql) to DEV **only** under explicit owner authorization, then run `SELECT public.check_wifran_schema_readiness();` and a single controlled DEV publish -> no-op -> Undo smoke check before considering PROD deployment.
