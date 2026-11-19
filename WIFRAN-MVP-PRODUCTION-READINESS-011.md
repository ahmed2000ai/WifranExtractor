# WIFRAN — MVP Pre-Production Corrections & Migration 011 Readiness Report

**Date:** 2026-11-16  
**Target Production Project:** `PRODUCTION` (`swratbmclahjyekouned`, host `db.swratbmclahjyekouned.supabase.co`)  
**Scope Constraint:** Zero live DB writes/migrations, zero Supabase Storage uploads, zero paid Gemini API calls, and zero modifications to `Extracts/` occurred during this task.  
**Status:** **`READY FOR CONTROLLED PRODUCTION MIGRATION AUTHORIZATION`**

---

## 1. Migration 011 & Approved MVP Consumer Visibility Policy

- **Migration File:** [`project-knowledge/wifran_docs/011_wifran_mvp_candidate_consumer_visibility.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/011_wifran_mvp_candidate_consumer_visibility.sql)
- **File Size:** `10,028` bytes
- **SHA-256:** `7cbe5a962545c993d277560dcaf0d3db5382bde08e73383f061abd3c48faf5ce`
- **Harness & Setup Registration:** Registered in [`isolatedPostgresHarness008.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/isolatedPostgresHarness008.ts) and [`setup-dev-database.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/scripts/setup-dev-database.ts).

### Design Summary

1. **In-Place Transactional View Update:** Uses `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'; CREATE OR REPLACE VIEW public.v_consumer_offers WITH (security_invoker = false) AS ... COMMIT;` with zero `DROP VIEW ... CASCADE`. Preserves the exact `98` columns, column order, data types, and compatibility with `public.get_consumer_offers_for_shopping_date(date, text, text)`, re-granting `SELECT`/`EXECUTE` to `anon, authenticated`.
2. **Candidate Consumer Visibility:** Exposes `product_id`, primary approved `product_images` (`pi.role = 'primary' AND pi.approval_status = 'approved'`), `image_url`, `thumbnail_url`, `display_image_url`, `display_image_kind = 'exact_product'`, `card_image_upload_state = 'uploaded'`, `thumbnail_upload_state = 'uploaded'`, and strips `'MEDIA_UPLOAD_PENDING'` from `reason_codes` for both:
   - `o.catalog_match_status = 'verified_linked'` (where `p.id IS NULL` or `COALESCE(p.verification_status, 'verified') <> 'rejected' AND COALESCE(p.is_active, true) = true`), and
   - `o.catalog_match_status = 'candidate_pending_review'` (where `o.product_id IS NOT NULL AND p.id IS NOT NULL AND p.verification_status IN ('verified', 'candidate') AND COALESCE(p.is_active, true) = true`).
3. **Provisional Provenance Preserved:** Leaves `products.verification_status = 'candidate'`, `offers.catalog_match_status = 'candidate_pending_review'`, and `offers.exact_identity_status = 'unresolved'` intact so provisional auto-created products remain distinguishable from manually verified SKUs (`verified_linked` / `verified_sku`).
4. **Strict Disputed / Rejected / Inactive Masking Retained:** Masks `product_id`, `image_url`, `display_image_kind`, and `brand_name_en` to `NULL` for `conflict_needs_review`, `unresolved`, `excluded_ambiguous`, `products.verification_status = 'rejected'`, and `products.is_active = false`.
5. **Safe Brand Fallback (`brand_name_en` / `brand_candidate_text`):** Because `CatalogPublicationService` writes `products.brand_name` while `offers.brand_id` and `offers.brand_candidate_text` remain `NULL` when `public.brands` has `0` rows (verified `0` rows in `PRODUCTION`), Migration 011 resolves `brand_name_en` and `brand_candidate_text` via `COALESCE` to `NULLIF(btrim(p.brand_name), '')` only when the offer-product link is consumer-visible, without fabricating `public.brands` UUID rows (`brand_id` remains `NULL`).

---

## 2. Isolated PostgreSQL Verification: Before (`001–010`) vs After (`001–011`)

Verified via [`migration011CandidateConsumerVisibility.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/migration011CandidateConsumerVisibility.test.ts) using an isolated temp copy of Carrefour Page 23 (`batch-2026-11-15T14-18-37-692853`, with `_006` corrected to `أولايت زيت كانولا ١،٥ لتر × ٢`, and `_001` marked `approved` to test mixed `verified_linked` + `candidate_pending_review`):

| Metric / DTO Field in `v_consumer_offers` | Before (`001–010`) | After (`001–011`) |
| --- | --- | --- |
| View column count (`v_consumer_offers`) | `98` | `98` |
| Published Carrefour Page 23 offers returned | `10` | `10` |
| Offers exposing non-null `product_id` | `1` (`verified_linked` only) | `10` (`1` verified + `9` candidate, `10` distinct `product_id`s) |
| Candidate offers with `image_url` / `display_image_url` | `0 / 9` (`NULL`) | `9 / 9` (`/product-images/products/sha256/...`) |
| Candidate offers `display_image_kind` / `card_image_upload_state` | `NULL` / `'pending'` | `'exact_product'` / `'uploaded'` |
| Candidate offers `brand_name_en` / `brand_candidate_text` | `NULL` | Populated from `products.brand_name` (`brand_id = NULL`) |
| Spot check `_006` (`O-LITE CANOLA OIL 1.5L X2`) | Masked (`product_id=NULL`, `image_url=NULL`) | `title_en='O-LITE CANOLA OIL 1.5L X2'`, `brand_name_en='O-Lite'`, `each_size_value=1.5`, `each_size_unit='l'`, `offer_price=36.99`, `currency='SAR'` |
| `exact_identity_status` distinction | Mixed (`1` `verified_sku`, `9` `unresolved`) | Preserved (`1` `verified_sku`, `9` `unresolved`) |
| `anon` RPC (`get_consumer_offers_for_shopping_date`) | Masked candidates | `10` rows returned (`product_id IS NOT NULL`, `display_image_kind = 'exact_product'`) |

Additional isolated checks in [`migration011CandidateConsumerVisibility.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/migration011CandidateConsumerVisibility.test.ts):
- **Masking Matrix:** `MASK-CONFLICT`, `MASK-UNRESOLVED`, `MASK-AMBIGUOUS`, `MASK-REJECTED-CAND`, `MASK-REJECTED-VERIFIED`, and `MASK-INACTIVE-CAND` all return `NULL` for `product_id`, `image_url`, `display_image_kind`, and `brand_name_en`, while `VISIBLE-CAND` exposes the approved image and `CandBrand`.
- **`consumer_contract_v2` Sanitization:** Remains `NULL` when `offers.contract_v2` is `NULL`; when JSONB is present, rewrites `offer_card.delivery_url` to the approved public `/product-images/...` URL with zero private `offer-images`, `Extracts`, `C:`, or `file://` path leakage.
- **Duplicate Prevention & Undo:** Re-publishing all `10` Carrefour offers skips `10` duplicates (`publishedOffersCount = 0`, `skippedDuplicatesCount = 10`). Running `undoLastPublish` deletes `exclusive_created` (`offer-images/offers/undo-exclusive-card.webp`) while preserving `reused_existing` (`product-images/products/shared-asset.webp`) and marks journal status `undone`.
- **`Extracts/` Integrity:** Verified SHA-256 of `batch-manifest.json` and `staged-draft.json` unchanged before and after tests.

---

## 3. Section 4 Fixes & Post-Edit Test Verification

1. **4.1 Deterministic Carrefour Page 23 Test Fixture ([`mvpSimplificationAndGeminiOpt.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/__tests__/mvpSimplificationAndGeminiOpt.test.ts)):** Explicitly resets `_006` inside the isolated temp `staged-draft.json` (`أولايت زيت كانولا ١،٥ مل × ٢`, `EN_AR_WEIGHT_VOLUME_CONFLICT`) before verifying the `9 Ready / 3 Deferred` -> fix `_006` -> `10 Ready / 2 Deferred` -> batch reload persistence -> publish & Undo workflow, never touching `Extracts/`.
2. **4.2 Canonical `auto_accepted` Metadata Handling ([`reviewTriageClassifier.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/reviewTriageClassifier.ts), [`UnifiedBatchPreview.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/UnifiedBatchPreview.tsx), [`ProductMatchingReview.tsx`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/renderer/src/components/batch/ProductMatchingReview.tsx), [`batchOrchestrationService.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/batch/batchOrchestrationService.ts)):** Exported `hasCompleteCoreLeafletMetadata`, `isLeafletMetadataAccepted`, and `isOfferMetadataAccepted` as the shared predicate across Step 3, Step 4, triage, and selective publication so `auto_accepted` status with complete core metadata is handled uniformly.
3. **4.3 Gemini Prompt Condition / Loyalty / Limit Token Cleanup:** Removed discontinued `promo_condition`, `loyalty`, and `quantity_limit` guidance/tokens from [`geminiPromptBuilder.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/geminiPromptBuilder.ts) (Master Quality system prompt length `11,845` chars, SHA-256 `c3d94b288b218ebafd260dff55960dae73988722560d1ca76f5cbd62ce71b6b7`), [`minimalOcrPromptBuilder.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/minimalOcrPromptBuilder.ts), [`pageFirstOfferPromptBuilder.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/pageFirstOfferPromptBuilder.ts), [`ocrPromptBuilder.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/ocrPromptBuilder.ts), and [`flexibleItemOcrPromptBuilder.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/flexibleItemOcrPromptBuilder.ts).
4. **4.4 Legacy Regression Reconciliations:**
   - [`geminiOpt004bProviderCache.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/ocr/__tests__/geminiOpt004bProviderCache.test.ts): Aligned context cache storage rate assertions to current `$0.50/M-hr` in `geminiPricingAndCostEstimator.ts` (`breakEvenRequests`: Standard `2`, Flex `2026` `3`, Flex `2027` `2`; 10k*2hr storage cost `$0.01`).
   - [`validityDateParser.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/validityDateParser.ts) & [`leafletMetadataExecutableUat.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/leafletMetadataExecutableUat.test.ts): Matched normalized Arabic `نهايه الاسبوع` after `ة`->`ه` normalization and pinned Stage 2 test clock (`2026-11-07T12:00:00Z`) around the `2026-11-07`..`2026-11-09` weekend fixture without relaxing expiry rules.
   - [`liveUatFix001.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/metadata/__tests__/liveUatFix001.test.ts): Updated expected default Flex Tier cost from `$0.018135` (legacy Standard) to `$0.0090675` (`mdReport` `$0.009067`).

### Post-Final-Edit Verification Results

- `npm run typecheck` (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`): **Passed** (exit code `0`)
- `npm run build` (`electron-vite build` main + preload + renderer): **Passed** (exit code `0`)
- Targeted Vitest Suite (`13` files, `132` tests — **Passed: 13 files / 132 tests, Failed: 0, Skipped: 0**):
  - `src/main/db/__tests__/migration011CandidateConsumerVisibility.test.ts`: `2` passed
  - `src/shared/utils/__tests__/wifranExtractorIdentity001iRegression.test.ts`: `2` passed
  - `src/main/batch/__tests__/mvpSimplificationAndGeminiOpt.test.ts`: `8` passed
  - `src/main/ocr/__tests__/geminiOpt004aMasterQuality.test.ts`: `12` passed
  - `src/main/ocr/__tests__/geminiOpt004bProviderCache.test.ts`: `17` passed
  - `src/main/metadata/__tests__/liveUatFix001.test.ts`: `20` passed
  - `src/main/metadata/__tests__/leafletMetadataExecutableUat.test.ts`: `16` passed
  - `src/main/metadata/__tests__/importPageSelectionScope.test.ts`: `24` passed
  - `src/main/page-first/__tests__/pageFirstOcr.test.ts`: `18` passed
  - `src/renderer/src/components/batch/__tests__/batchWorkflow005jFix06.test.tsx`: `3` passed
  - `src/renderer/src/components/batch/__tests__/selectiveUi008.test.tsx`: `3` passed
  - `src/main/db/__tests__/preDeploymentVerification008.test.ts`: `4` passed
  - `src/main/db/__tests__/publicationJournalAndUndo008.test.ts`: `3` passed
- *Explicit Exclusions / Unrun Suites:* `wifranExtractorIdentity001g.test.ts` fails on module import only because it imports `scripts/apply-migration-008.ts`, which intentionally triggers `[PRODUCTION_SAFETY_QUARANTINE]` (`databaseEnvironmentResolver.ts:317`); quarantine protections were intentionally left intact. Suites outside the 13 targeted files above were not executed.
- **Workspace Cleanliness:** `git status --short Extracts/` returned empty; `Get-Process *electron*` returned no running Electron processes.

---

## 4. Read-Only `PRODUCTION` (`swratbmclahjyekouned`) Preflight Inventory

Executed under `BEGIN READ ONLY` + `ROLLBACK` against `postgres@db.swratbmclahjyekouned.supabase.co` (`PostgreSQL 17.11 on x86_64-pc-linux-gnu`):

- **Schema Parity (`001–008` Present):**
  - All `28` `001–008` base tables exist with `rls_enabled = true`: `app_events`, `audit_logs`, `brands`, `categories`, `cities`, `import_batches`, `import_rows`, `issue_reports`, `legacy_id_crosswalk`, `offer_display_images`, `offer_revision_snapshots`, `offer_sources`, `offer_status_history`, `offer_visual_group_members`, `offers`, `product_aliases`, `product_images`, `products`, `profiles`, `regions`, `saved_offers`, `shopping_list_items`, `shopping_lists`, `supermarket_regions`, `supermarkets`, `units`, `validation_errors`, `watched_items`.
  - Seeded reference counts: `supermarkets: 13`, `categories: 13`, `regions: 5`, `cities: 25`.
  - Empty transactional/catalog tables: `products: 0`, `offers: 0`, `brands: 0`, `product_aliases: 0`, `product_images: 0`, `offer_display_images: 0`, `profiles: 0`.
  - `public.v_consumer_offers`: `98` columns present with `SELECT` grants for `anon, authenticated` (and full privileges for `service_role`).
  - `public.offers` indexes include unique partial index `idx_offers_source_offer_id` (`CREATE UNIQUE INDEX idx_offers_source_offer_id ON public.offers USING btree (source_offer_id) WHERE (source_offer_id IS NOT NULL)`).
  - Security & integrity triggers present (`trg_enforce_issue_report_user_id`, `trg_prevent_product_id_update`, `trg_prevent_profile_privilege_escalation`, plus `update_*_updated_at` triggers) alongside RLS policies and `build_sanitized_consumer_contract_v2` / `get_consumer_offers_for_shopping_date`.
- **Storage Buckets Verified:**
  - `offer-images` (`public: false`)
  - `tmp` (`public: false`)
  - `product-images` (`public: true`, `10485760` bytes limit, `image/jpeg`, `image/png`, `image/webp`)
  - `offer-display-images` (`public: true`, `10485760` bytes limit, `image/jpeg`, `image/png`, `image/webp`)
- **Missing Objects (`_applied_migrations` + Migrations `009`, `010`, `011`):**
  - `public._applied_migrations` does **not** exist yet (`false`).
  - `SchemaCompatibilityService` read-only check (`compatible: false`) reports missing:
    - Tables: `product_alias_proposals`, `product_alias_audit_log`, `publication_operations`, `publication_journal_mutations`, `publication_duplicate_skips`, `publication_storage_operations`
    - Columns on `public.offers`: `source_document_id`, `source_pdf_sha256`, `source_page_hash`, `source_offer_anchor`, `last_publish_operation_id`
    - Functions: `approve_product_alias_atomic`, `check_wifran_schema_readiness`
    - Consumer view update: `011_wifran_mvp_candidate_consumer_visibility.sql` (`v_consumer_offers` MVP candidate + brand fallback logic)

### Exact Pending Production Migration Checksums

| Order | Migration File | Bytes | SHA-256 |
| --- | --- | --- | --- |
| 1 | `project-knowledge/wifran_docs/009_wifran_07j_product_alias_staging_and_audit.sql` | `10,649` | `8c387b4c35e79e539d105f0af89de1db4b454f13e6b8410d068d70d2949b6263` |
| 2 | `project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql` | `14,258` | `74e6d600e50462e431d8ca0d83d08e23f0d4d7e3377e7a5312d84cc8d8cbea75` |
| 3 | `project-knowledge/wifran_docs/011_wifran_mvp_candidate_consumer_visibility.sql` | `10,028` | `7cbe5a962545c993d277560dcaf0d3db5382bde08e73383f061abd3c48faf5ce` |

---

## 5. Production `_applied_migrations` History Reconciliation SQL (`001–008`)

Because `PRODUCTION` (`swratbmclahjyekouned`) already has `001–008` applied cleanly without a `_applied_migrations` table, create and backfill the baseline records **without replaying DDL** inside a dedicated transaction before applying `009`, `010`, and `011` (matching `scripts/setup-dev-database.ts` baseline tracking IDs):

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public._applied_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public._applied_migrations (id) VALUES
  ('001_initial_schema.sql'),
  ('001_seed_core_catalog.sql'),
  ('003_offer_location_scope.sql'),
  ('004_offer_image_ingestion_metadata.sql'),
  ('005_wifran_v2_offer_contract.sql'),
  ('006_wifran_07a_security_and_contract_reconciliation.sql'),
  ('007_wifran_07g_07h_catalog_resolution_and_product_images.sql'),
  ('008_wifran_07j_consumer_view_disputed_identity_masking.sql')
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

*(Note: After executing each subsequent migration below, record `'009_wifran_07j_product_alias_staging_and_audit.sql'`, `'010_wifran_08_publication_journal_and_uniqueness.sql'`, and `'011_wifran_mvp_candidate_consumer_visibility.sql'` in `public._applied_migrations`.)*

---

## 6. Controlled Production Deployment Plan (`swratbmclahjyekouned`)

When explicit Production migration authorization is granted, execute in this exact sequence:

1. **Step 1 — Verify Target & Pre-Migration Backup:** Confirm target host is `db.swratbmclahjyekouned.supabase.co` (`PRODUCTION`), take a full pre-migration `pg_dump` snapshot (schema + data + roles/grants where permitted), and verify dump recoverability in an isolated restore check before any DDL.
2. **Step 2 — Verify Local Migration File Checksums:** Recompute SHA-256 on disk for `009`, `010`, and `011` and confirm exact match against Section 4 above (`8c387b...`, `74e6d6...`, `7cbe5a...`).
3. **Step 3 — Read-Only Sanity Confirm:** Re-run read-only preflight inspection on `swratbmclahjyekouned` confirming `0` unexpected writes, `98` columns on `v_consumer_offers`, and no `_applied_migrations` conflicts.
4. **Step 4 — Reconcile `_applied_migrations` (`001–008`):** Execute the baseline history reconciliation SQL from Section 5 (`001`–`008` only, zero DDL replay).
5. **Step 5 — Execute Migration 009 (`009_wifran_07j_product_alias_staging_and_audit.sql`):** Run transactionally, verify `product_alias_proposals`, `product_alias_audit_log`, and `approve_product_alias_atomic`, and record `009` in `public._applied_migrations`.
6. **Step 6 — Execute Migration 010 (`010_wifran_08_publication_journal_and_uniqueness.sql`):** Run transactionally, verify `publication_operations`, `publication_journal_mutations`, `publication_duplicate_skips`, `publication_storage_operations`, the 5 new `public.offers` columns, unique/idempotency constraints, and `check_wifran_schema_readiness`, then record `010` in `public._applied_migrations`.
7. **Step 7 — Execute Migration 011 (`011_wifran_mvp_candidate_consumer_visibility.sql`):** Run transactionally, verify `v_consumer_offers` remains `98` columns with candidate/brand fallback expressions and `anon, authenticated` grants intact, then record `011` in `public._applied_migrations`.
8. **Step 8 — Post-Migration Read-Only Parity Gate:** Execute `SchemaCompatibilityService` compatibility check (`PRODUCTION_UI`) and read-only SQL checks (`check_wifran_schema_readiness()`, RLS verification, `get_consumer_offers_for_shopping_date` execution, `_applied_migrations` listing `001`–`011`) to confirm `compatible: true` with `0` blocking reasons prior to authorizing live MVP publication.
