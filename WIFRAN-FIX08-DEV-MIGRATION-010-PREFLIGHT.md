# WIFRAN FIX-08 — DEV Pre-Migration Readiness Audit (`gykrbpykjhpyrdrinkuk`)

**Date:** 2026-11-15T13:59Z (UTC: `2026-11-15T07:58:59Z`)  
**Target Supabase Project:** `gykrbpykjhpyrdrinkuk` (`DEVELOPMENT_TEST`)  
**Migration Audited:** [`010_wifran_08_publication_journal_and_uniqueness.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql)  
**Audit Execution Mode:** Strictly **read-only** (`BEGIN TRANSACTION READ ONLY;` + `ROLLBACK;` on `pg`, plus read-only `storage.listBuckets()` / `storage.from().list()` via `getGuardedSupabaseClient('DEVELOPMENT_TEST')`). Zero live writes, deletions, cleanup, schema alterations, Migration `010` runs, Gemini calls, or publish/Undo invocations occurred.

---

## Final Verdict

**`READY FOR DEV MIGRATION`**

No blocking schema, uniqueness, type, trigger, permission, or data conflicts exist in `gykrbpykjhpyrdrinkuk`.

---

## 1. Connected Project Identity Verification

Verified via [`resolveDatabaseConfig`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/databaseEnvironmentResolver.ts#L75-L219) and a live PostgreSQL read-only session:

| Property | Live Verified Value |
| --- | --- |
| Guarded Context | `DEVELOPMENT_TEST` (`isValidated: true`) |
| Supabase Project Ref | `gykrbpykjhpyrdrinkuk` |
| REST URL | `https://gykrbpykjhpyrdrinkuk.supabase.co` |
| DB Host / Port / Database / User | `db.gykrbpykjhpyrdrinkuk.supabase.co` / `5432` / `postgres` / `postgres` |
| PostgreSQL Engine Version | `PostgreSQL 17.11 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit` |
| Session Transaction Mode | `transaction_read_only = on` |
| Configured Default Storage Bucket | `offer-images` |

---

## 2. Schema & Migration History Audit (Migration `009` Prerequisites)

### 2.1 Applied Migration History (`public._applied_migrations`)
`gykrbpykjhpyrdrinkuk` tracks applied SQL migrations in `public._applied_migrations (id text, applied_at timestamptz)`. Exactly **9 rows** are present (all applied `2026-11-11T23:31:20.248Z`–`21.096Z`):
1. `001_initial_schema.sql`
2. `001_seed_core_catalog.sql`
3. `003_offer_location_scope.sql`
4. `004_offer_image_ingestion_metadata.sql`
5. `005_wifran_v2_offer_contract.sql`
6. `006_wifran_07a_security_and_contract_reconciliation.sql`
7. `007_wifran_07g_07h_catalog_resolution_and_product_images.sql`
8. `008_wifran_07j_consumer_view_disputed_identity_masking.sql`
9. `009_wifran_07j_product_alias_staging_and_audit.sql`

*(No `supabase_migrations.schema_migrations` table exists; `auth.schema_migrations`, `realtime.schema_migrations`, and `storage.migrations` are Supabase internal schemas.)*

### 2.2 Live Prerequisite & Migration `010` Object State
Verified via direct `information_schema` inspection and [`assessSchemaCompatibility`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/schemaCompatibilityService.ts):
- **Migration `009` Prerequisites (`hasMigration009: true`):**
  - `public.product_aliases` — present (`0` rows)
  - `public.product_alias_proposals` — present
  - `public.product_alias_audit_log` — present
  - `public.approve_product_alias_atomic(p_proposal_id uuid, p_reviewer_id text, p_reviewer_role text, p_reason text, p_signature_verified boolean)` — present (`SECURITY DEFINER`, `search_path=pg_catalog, public`)
  - Supporting core tables present: `supermarkets`, `products`, `offers`, `product_images` (`0` rows), `offer_display_images` (`0` rows), `offer_status_history` (`0` rows), `offer_revision_snapshots` (`0` rows), `v_consumer_offers`.
- **Migration `010` Objects (`hasMigration010: false`):**
  - Missing (expected pre-migration): `publication_operations`, `publication_journal_mutations`, `publication_duplicate_skips`, `publication_storage_operations`, `offers.source_document_id`, `offers.source_pdf_sha256`, `offers.source_page_hash`, `offers.source_offer_anchor`, `offers.last_publish_operation_id`, `capture_indirect_publication_mutation()`, `check_wifran_schema_readiness()`.

---

## 3. Existing `public.offers.source_offer_id` & Duplicate Record Counts

### 3.1 Column, Constraint & Index Inspection
- **`public.offers.source_offer_id`:** `data_type = text`, `is_nullable = YES`, `column_default = null`.
- **Existing Unique Index Already Present:**  
  `idx_offers_source_offer_id`: `CREATE UNIQUE INDEX idx_offers_source_offer_id ON public.offers USING btree (source_offer_id) WHERE (source_offer_id IS NOT NULL)`  
  Migration `010` guards this via `IF NOT EXISTS (... indexdef ILIKE '%UNIQUE%source_offer_id%')` and will cleanly skip recreation.
- **Related `public.offers` PK/FK Column Types:**
  - `id`: `uuid` (matches `publication_storage_operations.linked_offer_id uuid`)
  - `product_id`: `bigint` (matches `public.products.id bigint` and `publication_storage_operations.linked_product_id bigint`)
  - `supermarket_id`, `city_id`, `region_id`: `text`
- **All 31 existing indexes & 20 constraints on `public.offers`:** None conflict with the 5 new columns or 2 additional indexes (`idx_offers_source_document_id`, `idx_offers_secondary_dedup`).

### 3.2 Live Row & Duplicate Counts
| Metric / Query Check | Observed DEV Count | Blocking? |
| --- | --- | --- |
| `public.products` total rows | `9` | No |
| `public.offers` total rows | `4` *(all `status = 'published'`)* | No |
| `offers` with `source_offer_id IS NULL` | `0` | No |
| `offers` with `source_offer_id IS NOT NULL` | `4` *(4 distinct values)* | No |
| `offers` with blank/whitespace `source_offer_id` | `0` | No |
| **Duplicate non-null `source_offer_id` groups (`HAVING count(*) > 1`)** | **`0`** | **No violations** |
| **Secondary logical duplicate groups (`product_id IS NOT NULL`, `status IN ('published','approved')`)** | **`0`** | **No violations** |
| **Secondary non-catalog duplicate groups (`product_id IS NULL`, matching normalized title + retailer + dates + scope)** | **`0`** | **No violations** |
| Orphaned `offers.product_id` (missing `public.products` parent) | `0` | No |
| `product_aliases` rows | `0` | No |
| `product_images` / `offer_display_images` / `offer_status_history` / `offer_revision_snapshots` rows | `0` / `0` / `0` / `0` | No |

*(Existing 4 `public.offers` rows are prior smoke/WP2 test records under Panda `c2cc16c2-0001-4444-b000-c00000000001` with distinct `source_offer_id`s: 3 catalog-linked offers ending `2026-11-10` and 1 unresolved offer `leaflet_wp2:p001:it9_need_approval_1794737884333:s01` valid `2026-11-10`..`2026-11-20`.)*

---

## 4. Compatibility with Products, Offers, Aliases, Triggers & `v_consumer_offers`

- **`v_consumer_offers`:** Depends on `offers`, `supermarkets`, `categories`, `cities`, `regions`, `brands`, `product_images`, and `offer_display_images`; queried cleanly by `get_consumer_offers_for_shopping_date(date, text, text)`. Migration `010` does **not** alter, drop, or recreate `v_consumer_offers` or any existing columns it selects; all 5 new `public.offers` columns append cleanly at the end of `public.offers`.
- **Triggers on `offers`, `offer_status_history`, `offer_revision_snapshots`:**
  - `public.offers` currently has only `update_offers_updated_at` (`BEFORE UPDATE`).
  - `offer_status_history` and `offer_revision_snapshots` both exist, both have primary key column `id` of type `uuid` (compatible with `v_post->>'id'` in `capture_indirect_publication_mutation()`), and currently have `0` existing triggers or rows.
- **No Unintentional Data Mutation/Invalidation:** Migration `010` contains **zero** `UPDATE`, `DELETE`, `TRUNCATE`, `DROP TABLE`, or `DROP VIEW` statements; all `ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS` columns are nullable with `NULL` default, causing zero table rewrites and zero invalidation of existing rows or `v_consumer_offers`.

---

## 5. Functions, Naming, Signatures, Permissions & RLS Check

- **Function Naming Collisions:** Zero existing functions named `capture_indirect_publication_mutation` or `check_wifran_schema_readiness` in `public`. `approve_product_alias_atomic` matches Migration `009` signature cleanly.
- **RLS Baseline Compatibility:** Every existing table in `public` (`31` base tables) has `rls_enabled = true`. Core write tables (`offers`, `offer_status_history`, `offer_revision_snapshots`, `product_alias_proposals`, `product_alias_audit_log`) grant `ALL` to `service_role` and deny direct writes from `anon`/`authenticated`.
- **Migration `010` Security Contract:** Enables RLS on all 4 new journal/storage tables, runs `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT ALL ... TO service_role`, and locks both functions (`SECURITY DEFINER SET search_path = public, pg_temp`) with `EXECUTE` revoked from `PUBLIC, anon, authenticated` and granted to `service_role` on `check_wifran_schema_readiness()`. Matches `gykrbpykjhpyrdrinkuk` role model cleanly.

---

## 6. Storage Buckets & Image Staging / Undo Cleanup Check

Read-only inspection of `gykrbpykjhpyrdrinkuk` Storage (`listBuckets()` + root `list()`):

| Bucket ID / Name | `public` | Size Limit | Allowed MIME Types | Top-Level Objects |
| --- | --- | --- | --- | --- |
| `product-images` | `true` | `10485760` (10 MB) | `image/jpeg`, `image/png`, `image/webp` | `0` |
| `offer-display-images` | `true` | `10485760` (10 MB) | `image/jpeg`, `image/png`, `image/webp` | `0` |
| `offer-images` | `false` | `10485760` (10 MB) | `null` | `0` |
| `tmp` | `false` | `10485760` (10 MB) | `null` | `0` |

- `storage.objects` currently has `0` RLS policies (`[]`); therefore `service_role` (used by [`createGuardedStorageAdapter`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/storage/stagedStorageLifecycleService.ts#L39-L80)) can upload staged objects and delete exclusive orphaned objects during Undo cleanup, while public consumer image delivery works via `product-images` and `offer-display-images` (`public: true`).

---

## 7. Blocking & Non-Blocking Warnings + Non-Transactional / Locking Analysis

### Blocking Warnings
- **None.**

### Non-Blocking Warnings
1. **`_applied_migrations` tracking parity:** `010_wifran_08_publication_journal_and_uniqueness.sql` does not insert a tracking row into `public._applied_migrations`. Controlled rollout should record `'010_wifran_08_publication_journal_and_uniqueness.sql'` after applying `010` so `_applied_migrations` stays aligned with `001`–`009`.
2. **Transactability & Lock Behavior:** Migration `010` wraps everything inside `BEGIN; ... COMMIT;` and has **no non-transactional statements** (no `CONCURRENTLY`, no out-of-transaction `ALTER TYPE`). On DEV (`4` rows in `offers`), `ACCESS EXCLUSIVE` (`ALTER TABLE public.offers`) and `SHARE` (`CREATE INDEX ...`) complete in milliseconds; when later planning PROD deployment on a larger/active `offers` table, prefer executing during a low-write window or splitting `idx_offers_source_document_id` / `idx_offers_secondary_dedup` with `CREATE INDEX CONCURRENTLY`.
3. **Default Storage Bucket (`offer-images` private vs `offer-display-images`/`product-images` public):** `resolveDatabaseConfig('DEVELOPMENT_TEST')` and [`publishApprovedCatalogBatch`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/catalogPublicationService.ts#L483) default `storageBucket` to `'offer-images'` (`public: false`), whereas [`sanitizePublicConsumerImageUrl`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/shared/utils/nonCatalogPublicationPolicy.ts#L241) strips private `offer-images` URLs and only passes through `/storage/v1/object/public/(product-images|offer-display-images)/...`. Verify the target bucket override (`storageBucket` / bucket policy) when testing live consumer image rendering in DEV after Migration `010`.
4. **No Schema Remediation Required:** `0` duplicate `source_offer_id` rows and `0` secondary duplicates exist; no row cleanup is needed prior to `010`. *(Optional housekeeping only: 4 legacy test rows currently exist in `public.offers` and 9 test rows in `public.products`; do not delete unless separately doing a controlled DEV test-data reset.)*

---

## 8. Backup, Rollback & Exact Ordered Application Instructions

### 8.1 Pre-Apply Backup & Rollback Plan
1. **Backup:** Export / snapshot `gykrbpykjhpyrdrinkuk` (`pg_dump` schema + `public` data) before applying Migration `010`.
2. **Rollback Plan (Additive Only):** Because Migration `010` drops or mutates zero pre-existing columns/data, rollback (if ever required before `010` writes begin) consists solely of dropping the 2 new triggers (`trg_wifran_journal_offer_status_history`, `trg_wifran_journal_offer_revision_snapshots`), 2 functions (`check_wifran_schema_readiness()`, `capture_indirect_publication_mutation()`), 4 tables (`publication_storage_operations`, `publication_duplicate_skips`, `publication_journal_mutations`, `publication_operations`), 2 new indexes (`idx_offers_secondary_dedup`, `idx_offers_source_document_id`), and 5 new `public.offers` columns (`ALTER TABLE public.offers DROP COLUMN IF EXISTS ...`), keeping pre-existing `idx_offers_source_offer_id` intact.

### 8.2 Exact Ordered Instructions to Apply Migration `010` to DEV (`gykrbpykjhpyrdrinkuk`)
1. Verify environment variables resolve strictly to `gykrbpykjhpyrdrinkuk` (never PROD `swratbmclahjyekouned`).
2. Take a pre-migration backup/snapshot of `gykrbpykjhpyrdrinkuk`.
3. Apply [`project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql) verbatim inside its single transaction (`BEGIN; ... COMMIT;`) as the `postgres` superuser on `db.gykrbpykjhpyrdrinkuk.supabase.co:5432`.
4. Record migration tracking entry (maintaining `001`–`009` parity):
   ```sql
   INSERT INTO public._applied_migrations (id, applied_at)
   VALUES ('010_wifran_08_publication_journal_and_uniqueness.sql', now())
   ON CONFLICT (id) DO NOTHING;
   ```
5. Execute all post-migration verification queries in Section 9 and confirm `assessSchemaCompatibility({ context: 'DEVELOPMENT_TEST' })` returns `compatible: true`.

---

## 9. Post-Migration Verification Queries

Run in `gykrbpykjhpyrdrinkuk` immediately after applying Migration `010`:

```sql
-- 1. Confirm full Migration 009 + 010 readiness JSONB report (all 10 flags must be true)
SELECT public.check_wifran_schema_readiness();

-- 2. Confirm all 4 new journal/storage tables exist and have RLS enabled
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'publication_operations',
    'publication_journal_mutations',
    'publication_duplicate_skips',
    'publication_storage_operations'
  )
ORDER BY c.relname;

-- 3. Confirm PUBLIC / anon / authenticated cannot access new journal tables directly
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'publication_operations',
    'publication_journal_mutations',
    'publication_duplicate_skips',
    'publication_storage_operations'
  )
ORDER BY table_name, grantee, privilege_type;

-- 4. Confirm the 5 additive columns and 2 new indexes on public.offers
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'offers'
  AND column_name IN (
    'source_document_id',
    'source_pdf_sha256',
    'source_page_hash',
    'source_offer_anchor',
    'last_publish_operation_id'
  )
ORDER BY column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'offers'
  AND indexname IN (
    'idx_offers_source_offer_id',
    'idx_offers_source_document_id',
    'idx_offers_secondary_dedup'
  )
ORDER BY indexname;

-- 5. Confirm indirect capture triggers attached to history/snapshot tables
SELECT event_object_table, trigger_name, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE 'trg_wifran_journal_%'
ORDER BY event_object_table;

-- 6. Confirm pre-existing data & v_consumer_offers remain intact
SELECT count(*)::int AS products_count FROM public.products;
SELECT count(*)::int AS offers_count FROM public.offers;
SELECT count(*)::int AS consumer_view_count FROM public.v_consumer_offers;
```
