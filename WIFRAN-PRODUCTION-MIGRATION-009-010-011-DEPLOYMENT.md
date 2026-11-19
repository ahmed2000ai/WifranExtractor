# WIFRAN — Controlled Production Migration 009, 010 & 011 Report

**Verdict:** **`PRODUCTION SCHEMA READY — FIRST PUBLICATION UAT PENDING`**  
**Target Environment:** `PRODUCTION_UI` (`swratbmclahjyekouned`, `db.swratbmclahjyekouned.supabase.co:5432`)  
**Deployment Date (UTC):** `2026-11-16` (`07:17:05Z`–`07:17:18Z`)  
**Readiness Basis:** [`WIFRAN-MVP-PRODUCTION-READINESS-011.md`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/WIFRAN-MVP-PRODUCTION-READINESS-011.md)  
**Operational Scope Compliance:** Zero offers or products published, zero test rows inserted into `PRODUCTION`, zero Undo operations executed, zero Storage uploads or deletions, zero paid Gemini API calls, zero `DEVELOPMENT_TEST` changes.

---

## 1. Production Identity & Precondition Verification

| Check | Verified Value |
| --- | --- |
| Resolved Application Context | `PRODUCTION_UI` (`resolveDatabaseConfig('PRODUCTION_UI')`) |
| Supabase Project Ref | `swratbmclahjyekouned` |
| Database Hostname / Port | `db.swratbmclahjyekouned.supabase.co:5432` |
| Connected Server IP / Port | `2a05:d018:a0:6000:4314:d687:f352:b04b/128:5432` |
| Database / User | `postgres` / `postgres` |
| PostgreSQL Engine | `PostgreSQL 17.11 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit` |
| Pre-Migration Conflicting Ops / Locks | `activeNonIdleQueriesCount: 0`, `ddlLocksOnPublic: 0`, `appliedMigrationsExists: false` |

Baseline `001–008` signature verification prior to reconciliation confirmed all `28` `public` base tables with `rls_enabled = true`, `v_consumer_offers` with `98` columns, and all `003–008` schema artifacts (`chk_offer_location_scope_rules`, `thumbnail_storage_path`, `contract_v2`, `trg_prevent_profile_privilege_escalation`, `trg_enforce_issue_report_user_id`, `build_sanitized_consumer_contract_v2`, `get_consumer_offers_for_shopping_date`, `products.verification_status`, `product_images`, `offer_display_images`, `trg_prevent_product_id_update`, `normalize_alias_key`, `idx_product_aliases_normalized_key`, and `v_consumer_offers` disputed masking).

---

## 2. Backup & Isolated Restoration Evidence

| Item | Verified Result |
| --- | --- |
| Backup File | [`backups/prod-swratbmclahjyekouned-pre-migration-009-010-011-2026-11-15T23-16-35-578Z.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/backups/prod-swratbmclahjyekouned-pre-migration-009-010-011-2026-11-15T23-16-35-578Z.sql) |
| Dump Method | `pg_dump.exe` (`PostgreSQL 18.3`) `--schema=public --no-owner --format=plain --encoding=UTF8` (tables, data, functions, RLS, triggers, and `GRANT` statements preserved) |
| Created Timestamp (UTC) | `2026-11-15T23:16:46Z` |
| File Size / Lines | `139,761` bytes (`3,888` lines) |
| Revalidated SHA-256 | `9d0ff38ed76db208276274cd8037f16afc534bc692209f7eef376d264da7071f` |
| Isolated Restore Result | Restored into ephemeral local PostgreSQL `18.3` cluster (`restore_test`, `127.0.0.1:35444`) with Supabase stub roles, `auth` stubs, and `pg_trgm`: `psql.exe` exit `0`, `1` benign `schema "public" already exists` message, `0` unexpected errors, `0` row count mismatches across all `28` tables + `v_consumer_offers` (`98` cols) |
| Outside `--schema=public` Scope | Non-public schemas (`auth`, `extensions`, `graphql`, `graphql_public`, `realtime`, `storage`, `vault`) and Storage bucket binaries (`offer-images`: `178` objects / `7,350,986` bytes; `tmp`: `12` objects / `1,549,750` bytes) |

---

## 3. Isolated Rehearsal Summary (Phase 2)

Prior to live deployment, [`009_wifran_07j_product_alias_staging_and_audit.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/009_wifran_07j_product_alias_staging_and_audit.sql), [`010_wifran_08_publication_journal_and_uniqueness.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql), and [`011_wifran_mvp_candidate_consumer_visibility.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/011_wifran_mvp_candidate_consumer_visibility.sql) were rehearsed end-to-end on the restored local clone (`psql -v ON_ERROR_STOP=1` exit `0`), passing `check_wifran_schema_readiness()` (`10/10` `true`), `assessSchemaCompatibility({ context: 'PRODUCTION_UI' })` (`compatible: true`), `98`-column `v_consumer_offers` parity, and a rolled-back `ROLE anon` behavioral verification confirming:
- Active `candidate` + `candidate_pending_review` + approved primary `product_images` row (`REH-CAND-VISIBLE`) exposed `product_id`, public `/product-images/...` URL, `display_image_kind = 'exact_product'`, `brand_name_en = 'RehearsalBrand'` (`brand_id = null`), and `exact_identity_status = 'unresolved'`.
- `conflict_needs_review` (`REH-CONFLICT-MASKED`) and `verification_status = 'rejected'` (`REH-REJECTED-MASKED`) strictly masked `product_id`, `image_url`, `display_image_kind`, and `brand_name_en` to `NULL`.

---

## 4. Authorization Record

- **Operator Authorization:** Explicit written operator approval received on `2026-11-16` authorizing Phase 4 and Phase 5 (creation of `public._applied_migrations` with `001–008` reconciliation, controlled execution of Migrations `009`, `010`, and `011`, and read-only post-deployment verification against `PRODUCTION` `swratbmclahjyekouned`).

---

## 5. Actual Migration Execution Results (Phase 4)

All migration files matched their exact approved SHA-256 hashes immediately prior to execution:

| Step | Artifact / Operation | Bytes | SHA-256 Verified | Execution Result |
| --- | --- | --- | --- | --- |
| 1 | `_applied_migrations` creation + `001–008` baseline backfill (no DDL replay) | — | — | Committed (`8` baseline rows recorded) |
| 2 | [`009_wifran_07j_product_alias_staging_and_audit.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/009_wifran_07j_product_alias_staging_and_audit.sql) | `10,649` | `8c387b4c35e79e539d105f0af89de1db4b454f13e6b8410d068d70d2949b6263` | Committed via `psql -v ON_ERROR_STOP=1` (`8/8` verification flags `true`), then recorded |
| 3 | [`010_wifran_08_publication_journal_and_uniqueness.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql) | `14,258` | `74e6d600e50462e431d8ca0d83d08e23f0d4d7e3377e7a5312d84cc8d8cbea75` | Committed via `psql -v ON_ERROR_STOP=1` (`10/10` readiness keys `true`, `6` trigger event rows, RLS + service_role checks passed), then recorded |
| 4 | [`011_wifran_mvp_candidate_consumer_visibility.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/011_wifran_mvp_candidate_consumer_visibility.sql) | `10,028` | `7cbe5a962545c993d277560dcaf0d3db5382bde08e73383f061abd3c48faf5ce` | Committed via `psql -v ON_ERROR_STOP=1` (`98`-column 1:1 parity + MVP policy SQL confirmed), then recorded |

---

## 6. Final `public._applied_migrations` Registry State (`11` Rows)

| # | `id` | `applied_at` (UTC) |
| --- | --- | --- |
| 1 | `001_initial_schema.sql` | `2026-11-16T07:17:05.344Z` |
| 2 | `001_seed_core_catalog.sql` | `2026-11-16T07:17:05.344Z` |
| 3 | `003_offer_location_scope.sql` | `2026-11-16T07:17:05.344Z` |
| 4 | `004_offer_image_ingestion_metadata.sql` | `2026-11-16T07:17:05.344Z` |
| 5 | `005_wifran_v2_offer_contract.sql` | `2026-11-16T07:17:05.344Z` |
| 6 | `006_wifran_07a_security_and_contract_reconciliation.sql` | `2026-11-16T07:17:05.344Z` |
| 7 | `007_wifran_07g_07h_catalog_resolution_and_product_images.sql` | `2026-11-16T07:17:05.344Z` |
| 8 | `008_wifran_07j_consumer_view_disputed_identity_masking.sql` | `2026-11-16T07:17:05.344Z` |
| 9 | `009_wifran_07j_product_alias_staging_and_audit.sql` | `2026-11-16T07:17:08.328Z` |
| 10 | `010_wifran_08_publication_journal_and_uniqueness.sql` | `2026-11-16T07:17:12.179Z` |
| 11 | `011_wifran_mvp_candidate_consumer_visibility.sql` | `2026-11-16T07:17:13.786Z` |

---

## 7. Schema, Consumer-View & Compatibility Verification (Phase 5 — Read-Only)

- **Application Schema Compatibility ([`assessSchemaCompatibility`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/schemaCompatibilityService.ts#L85-L160)):**
  - `compatible: true`, `context: "PRODUCTION_UI"`, `projectRef: "swratbmclahjyekouned"`, `checkedAt: "2026-11-16T07:17:18.576Z"`.
  - `hasMigration009: true`, `hasMigration010: true`, `hasConsumerView: true`, `hasSourceOfferUniqueIndex: true`, `hasRequiredColumns: true`, `missingDependencies: []`, `blockingReasons: []`, `20/20` `details` flags `true`.
- **`public.check_wifran_schema_readiness()`:** All `10` keys returned `true`.
- **`public.offers` Provenance Columns Added/Verified:** `source_offer_id` (`text`), `source_document_id` (`text`), `source_pdf_sha256` (`text`), `source_page_hash` (`text`), `source_offer_anchor` (`text`), `last_publish_operation_id` (`uuid`), all nullable.
- **Uniqueness & Dedup Indexes on `public.offers`:**
  - `idx_offers_source_offer_id`: `CREATE UNIQUE INDEX idx_offers_source_offer_id ON public.offers USING btree (source_offer_id) WHERE (source_offer_id IS NOT NULL)`
  - `idx_offers_source_document_id`: `CREATE INDEX idx_offers_source_document_id ON public.offers USING btree (source_document_id) WHERE (source_document_id IS NOT NULL)`
  - `idx_offers_secondary_dedup`: `CREATE INDEX idx_offers_secondary_dedup ON public.offers USING btree (supermarket_id, product_id, offer_start_date, offer_end_date) WHERE (status = ANY (ARRAY['published'::text, 'approved'::text]))`
- **Audit Triggers (Undo/Journal):** `trg_wifran_journal_offer_status_history` and `trg_wifran_journal_offer_revision_snapshots` installed (`6` trigger event rows across `INSERT/UPDATE/DELETE`).
- **`public.v_consumer_offers` Contract & Policy (`98` Columns Preserved 1:1):** Verified directly on `PRODUCTION` via `pg_get_viewdef('public.v_consumer_offers'::regclass, true)` that:
  - Both `verified_linked` (active non-rejected) and `candidate_pending_review` (`o.product_id IS NOT NULL AND p.id IS NOT NULL AND p.verification_status IN ('verified', 'candidate') AND COALESCE(p.is_active, true) = true`) expose `product_id`, approved primary `product_images` (`pi.public_url`), and `NULLIF(btrim(p.brand_name), '')` fallback for `brand_name_en` / `brand_candidate_text` (keeping `brand_id` un-fabricated).
  - Disputed/unresolved/ambiguous/rejected/inactive product identities fall into `ELSE NULL`.
- **Consumer Read & RPC Verification on Live `PRODUCTION` (No Test Inserts):**
  - Read-only SQL under `SET LOCAL ROLE anon`: `SELECT count(*) FROM public.v_consumer_offers` -> `0` rows (succeeded); `SELECT count(*) FROM public.get_consumer_offers_for_shopping_date(CURRENT_DATE, NULL, NULL)` -> `0` rows (succeeded); `SELECT count(*) FROM public.publication_operations` -> denied (`true`).
  - Read-only PostgREST HTTP `anon` key check: `v_consumer_offers` select -> `0` rows (`viewQueryError: null`); `get_consumer_offers_for_shopping_date` RPC -> `0` rows (`rpcError: null`); `publication_operations` select -> blocked (`"permission denied for table publication_operations"`).

---

## 8. Production Before / After Row Counts & Storage Verification

### Baseline `public` Tables & View (`countDiffsOnBaseline28TablesPlusView: []`)

| Object | Before | After | Diff |
| --- | --- | --- | --- |
| `supermarkets` | `13` | `13` | `0` |
| `categories` | `13` | `13` | `0` |
| `regions` | `5` | `5` | `0` |
| `cities` | `25` | `25` | `0` |
| `units` | `9` | `9` | `0` |
| `supermarket_regions` | `12` | `12` | `0` |
| `legacy_id_crosswalk` | `38` | `38` | `0` |
| `offers` / `products` / `brands` / `product_aliases` / `product_images` / `offer_display_images` / `v_consumer_offers` | `0` each | `0` each | `0` |
| All other `15` pre-existing `public` tables | `0` each | `0` each | `0` |

### Newly Installed Migration `009` / `010` Tables

| Table | Post-Deploy Row Count |
| --- | --- |
| `product_alias_proposals` | `0` |
| `product_alias_audit_log` | `0` |
| `publication_operations` | `0` |
| `publication_journal_mutations` | `0` |
| `publication_duplicate_skips` | `0` |
| `publication_storage_operations` | `0` |

### Storage Buckets & Objects (Untouched)

| Bucket | `public` | Object Count Before | Object Count After | Total Bytes After |
| --- | --- | --- | --- | --- |
| `offer-images` | `false` | `178` | `178` | `7,350,986` |
| `tmp` | `false` | `12` | `12` | `1,549,750` |
| `product-images` | `true` | `0` | `0` | `0` |
| `offer-display-images` | `true` | `0` | `0` | `0` |

---

## 9. RLS & Least-Privilege Security Results

| Check | Result on `PRODUCTION` |
| --- | --- |
| RLS enabled on `product_alias_proposals`, `product_alias_audit_log`, `publication_operations`, `publication_journal_mutations`, `publication_duplicate_skips`, `publication_storage_operations` | `true` (`6/6`) |
| `anon` / `authenticated` `SELECT` on `v_consumer_offers` | `true` / `true` |
| `anon` / `authenticated` `EXECUTE` on `get_consumer_offers_for_shopping_date(date,text,text)` | `true` / `true` |
| `anon` / `authenticated` `SELECT` on `publication_operations` (plus `anon` on mutations/skips/storage_ops) | `false` (denied) |
| `service_role` `INSERT` across all `4` journal/storage tables | `true` (`4/4`) |
| `anon` `UPDATE` / `authenticated` `DELETE` on `product_alias_audit_log` | `false` / `false` (append-only enforced) |
| `anon` / `authenticated` / `service_role` `EXECUTE` on `approve_product_alias_atomic` | `false` / `true` / `true` |
| `anon` / `service_role` `EXECUTE` on `check_wifran_schema_readiness()` | `false` / `true` |

---

## 10. Operational Warnings & Pre-Publication Remaining Steps

1. **Legacy `offer-images` (`178` files) & `tmp` (`12` files):** Retained completely untouched in private Storage buckets; no cleanup or modification performed.
2. **Pre-existing `brands` Empty Catalog (`0` rows):** Auto-created MVP `candidate` products populate `products.brand_name` while `offers.brand_id` stays `NULL`; `v_consumer_offers` safely falls back to `p.brand_name` for `brand_name_en` and `brand_candidate_text` under Migration `011`.
3. **Remaining Steps Before First Real Production Publication:**
   - Obtain separate explicit operator authorization for the first live production publication UAT.
   - Launch the built Electron app in `PRODUCTION_UI` mode (`swratbmclahjyekouned`), run pre-publish reconciliation on the approved Carrefour Page 23 batch, confirm [`assessSchemaCompatibility`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/schemaCompatibilityService.ts) passes in the app UI, and execute operator-supervised selective publish + live `v_consumer_offers` readback.

---

**Verdict:** **`PRODUCTION SCHEMA READY — FIRST PUBLICATION UAT PENDING`**
