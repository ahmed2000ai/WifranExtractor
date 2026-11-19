# WIFRAN FIX-08 — CONTROLLED DEV MIGRATION 010 DEPLOYMENT REPORT

**Verdict:** `DEV MIGRATION SUCCESSFUL — READY FOR PUBLICATION UAT`

**Deployment Timestamp (UTC):** `2026-11-15T11:18:59.379Z` (verification completed `2026-11-15T11:19:01.329Z`)  
**Target Environment:** `DEVELOPMENT_TEST` (`gykrbpykjhpyrdrinkuk`) ONLY  
**Production Environment (`swratbmclahjyekouned`):** Untouched — zero connections, zero reads, zero mutations.  
**Operational Scope Compliance:** Zero offers published, zero products created, zero Undo operations executed, zero Storage objects uploaded/deleted, zero paid Gemini API calls triggered, zero source files modified.

---

## 1. Confirmed Target Identity & Reviewed Migration Artifact

| Check | Verified Value |
| --- | --- |
| App Resolver Context | `DEVELOPMENT_TEST` (`resolveDatabaseConfig('DEVELOPMENT_TEST')`) |
| Supabase Project Ref | `gykrbpykjhpyrdrinkuk` |
| Database Host | `db.gykrbpykjhpyrdrinkuk.supabase.co` |
| Server IP / Port | `2406:da1a:82a:9d02:6b9d:71fd:3e7d:c660/128` (`postgres` / `postgres`) |
| PostgreSQL Engine | `PostgreSQL 17.11 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit` |
| Migration File Executed | `project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql` |
| Reviewed Migration SHA-256 | `74E6D600E50462E431D8CA0D83D08E23F0D4D7E3377E7A5312D84CC8D8CBEA75` (exact match verified pre-restore and pre-execution) |
| Preflight Report Reference | `WIFRAN-FIX08-DEV-MIGRATION-010-PREFLIGHT.md` |

---

## 2. Pre-Migration Backup & Isolated Restoration Verification (Condition 1)

Before any mutation touched `gykrbpykjhpyrdrinkuk`, the pre-migration `pg_dump` backup created with PostgreSQL `18.3` was cryptographically verified and tested for clean recoverability inside an ephemeral, completely isolated local PostgreSQL `18.3` cluster (`initdb.exe` + `pg_ctl.exe` on `127.0.0.1`).

| Backup / Recovery Check | Observed Result |
| --- | --- |
| Backup File | `backups/dev-gykrbpykjhpyrdrinkuk-pre-migration-010-2026-11-15T11-04-47-981Z.sql` |
| Backup Size | `141,966` bytes |
| Backup SHA-256 | `A1B83D7F9FC3BD2E01CBC22ACD254A907F39B3AB15426BC0C5E48EDB675F382B` |
| Isolated Restore Method | Ephemeral PG 18.3 cluster (`postgres` + `restore_test` DB with stub `auth` schema, Supabase roles, and `pg_trgm` in `public`), executing the unmodified backup file via PG 18.3 `psql.exe` |
| `psql.exe` Exit Status | `0` (`isolatedRestoreStatus: PASSED`) |
| Expected Benign Errors | `1` expected error on line 26 (`ERROR:  schema "public" already exists`) because `public` already held `pg_trgm` |
| Unexpected Restore Errors | `0` (`[]`) |
| Restored Baseline Row Counts | `_applied_migrations: 9`, `supermarkets: 13`, `cities: 25`, `regions: 5`, `products: 9`, `product_aliases: 0`, `offers: 4`, `v_consumer_offers: 4` |
| Dry-Run Migration `010` on Restored Clone | Executed cleanly; `public.check_wifran_schema_readiness()` returned `true` on all 10 flags; existing `offers` (`4`), `products` (`9`), and `v_consumer_offers` (`4`) preserved identically |

---

## 3. Migration Execution & `_applied_migrations` Reconciliation (Conditions 3–4)

- **Pre-execution DEV guard state:** `has_pub_ops: false`, `applied_count: 9`, `has_010_record: false`, `transaction_read_only: "off"`.
- **Execution:** Executed only `010_wifran_08_publication_journal_and_uniqueness.sql` verbatim using its built-in `BEGIN; ... COMMIT;` transactional wrapper (`ddlCommitted: true`).
- **History Recording:** Inserted `'010_wifran_08_publication_journal_and_uniqueness.sql'` into `public._applied_migrations` immediately after clean DDL commit (`historyRecorded: true`, `historyError: null`).

### Full `public._applied_migrations` Registry Post-Deployment (`10` Rows)

| # | Migration `id` | `applied_at` (UTC) |
| --- | --- | --- |
| 1 | `001_initial_schema.sql` | `2026-11-11T23:31:20.248Z` |
| 2 | `001_seed_core_catalog.sql` | `2026-11-11T23:31:20.355Z` |
| 3 | `003_offer_location_scope.sql` | `2026-11-11T23:31:20.461Z` |
| 4 | `004_offer_image_ingestion_metadata.sql` | `2026-11-11T23:31:20.567Z` |
| 5 | `005_wifran_v2_offer_contract.sql` | `2026-11-11T23:31:20.673Z` |
| 6 | `006_wifran_07a_security_and_contract_reconciliation.sql` | `2026-11-11T23:31:20.779Z` |
| 7 | `007_wifran_07g_07h_catalog_resolution_and_product_images.sql` | `2026-11-11T23:31:20.886Z` |
| 8 | `008_wifran_07j_consumer_view_disputed_identity_masking.sql` | `2026-11-11T23:31:20.990Z` |
| 9 | `009_wifran_07j_product_alias_staging_and_audit.sql` | `2026-11-11T23:31:21.096Z` |
| 10 | `010_wifran_08_publication_journal_and_uniqueness.sql` | `2026-11-15T11:18:59.379Z` |

---

## 4. Post-Migration Schema, Readiness, RLS, Permissions & Index Verification (Condition 5)

All post-migration database inspections ran inside a read-only transaction (`BEGIN TRANSACTION READ ONLY;`).

### 4.1 `public.check_wifran_schema_readiness()` Result

| Readiness Key | Value |
| --- | --- |
| `has_migration_009_alias_proposals` | `true` |
| `has_migration_009_alias_audit` | `true` |
| `has_migration_009_approve_fn` | `true` |
| `has_migration_010_pub_ops` | `true` |
| `has_migration_010_journal_mutations` | `true` |
| `has_migration_010_duplicate_skips` | `true` |
| `has_migration_010_storage_ops` | `true` |
| `has_offers_source_document_col` | `true` |
| `has_offers_source_unique_idx` | `true` |
| `has_consumer_view_v_consumer_offers` | `true` |

### 4.2 Journal & Storage Tables — RLS and Role Grants

| Table (`public.*`) | `relrowsecurity` | `anon` (`SELECT`/`INSERT`) | `authenticated` (`SELECT`/`INSERT`) | `service_role` (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) | RLS Policies (`pg_policies`) |
| --- | --- | --- | --- | --- | --- |
| `publication_operations` | `true` | `false` / `false` | `false` / `false` | `true` / `true` / `true` / `true` | `0` (service_role bypasses RLS; non-service roles have zero privileges and fail closed) |
| `publication_journal_mutations` | `true` | `false` / `false` | `false` / `false` | `true` / `true` / `true` / `true` | `0` |
| `publication_duplicate_skips` | `true` | `false` / `false` | `false` / `false` | `true` / `true` / `true` / `true` | `0` |
| `publication_storage_operations` | `true` | `false` / `false` | `false` / `false` | `true` / `true` / `true` / `true` | `0` |

`information_schema.role_table_grants` confirmed that only `postgres` and `service_role` hold privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `REFERENCES`, `TRIGGER`, `TRUNCATE`) across all four journal/storage tables; zero grants exist for `PUBLIC`, `anon`, or `authenticated`.

### 4.3 `public.offers` New Provenance/Journal Columns

| Column | Data Type | Nullable | Default |
| --- | --- | --- | --- |
| `source_offer_id` (existing prerequisite) | `text` | `YES` | `null` |
| `source_document_id` | `text` | `YES` | `null` |
| `source_pdf_sha256` | `text` | `YES` | `null` |
| `source_page_hash` | `text` | `YES` | `null` |
| `source_offer_anchor` | `text` | `YES` | `null` |
| `last_publish_operation_id` | `uuid` | `YES` | `null` |

### 4.4 `public.offers` Deduplication & Provenance Indexes

| Index Name | Unique | Valid / Ready / Live | Exact Definition (`pg_get_indexdef`) |
| --- | --- | --- | --- |
| `idx_offers_source_offer_id` | `true` | `true` / `true` / `true` | `CREATE UNIQUE INDEX idx_offers_source_offer_id ON public.offers USING btree (source_offer_id) WHERE (source_offer_id IS NOT NULL)` |
| `idx_offers_source_document_id` | `false` | `true` / `true` / `true` | `CREATE INDEX idx_offers_source_document_id ON public.offers USING btree (source_document_id) WHERE (source_document_id IS NOT NULL)` |
| `idx_offers_secondary_dedup` | `false` | `true` / `true` / `true` | `CREATE INDEX idx_offers_secondary_dedup ON public.offers USING btree (supermarket_id, product_id, offer_start_date, offer_end_date) WHERE (status = ANY (ARRAY['published'::text, 'approved'::text]))` |

### 4.5 Functions & Indirect Mutation Journal Triggers

| Function (`public.*`) | Signature / Returns | `SECURITY DEFINER` |
| --- | --- | --- |
| `approve_product_alias_atomic` | `(p_proposal_id uuid, p_reviewer_id text, p_reviewer_role text, p_reason text, p_signature_verified boolean)` -> `jsonb` | `true` |
| `capture_indirect_publication_mutation` | `()` -> `trigger` | `true` |
| `check_wifran_schema_readiness` | `()` -> `jsonb` | `true` |

| Trigger | Table | Enabled (`tgenabled`) | Definition |
| --- | --- | --- | --- |
| `trg_wifran_journal_offer_status_history` | `offer_status_history` | `O` (origin/local enabled) | `CREATE TRIGGER trg_wifran_journal_offer_status_history AFTER INSERT OR DELETE OR UPDATE ON public.offer_status_history FOR EACH ROW EXECUTE FUNCTION capture_indirect_publication_mutation()` |
| `trg_wifran_journal_offer_revision_snapshots` | `offer_revision_snapshots` | `O` (origin/local enabled) | `CREATE TRIGGER trg_wifran_journal_offer_revision_snapshots AFTER INSERT OR DELETE OR UPDATE ON public.offer_revision_snapshots FOR EACH ROW EXECUTE FUNCTION capture_indirect_publication_mutation()` |

---

## 5. Pre- vs Post-Migration Data & `v_consumer_offers` Integrity Check

All existing baseline counts and rows remained completely intact with zero modifications or invalidation.

| Table / View | Pre-Migration Count | Post-Migration Count | Delta |
| --- | --- | --- | --- |
| `public._applied_migrations` | `9` | `10` | `+1` (`010_wifran_08_publication_journal_and_uniqueness.sql`) |
| `public.supermarkets` | `13` | `13` | `0` |
| `public.cities` | `25` | `25` | `0` |
| `public.regions` | `5` | `5` | `0` |
| `public.products` | `9` | `9` | `0` |
| `public.product_aliases` | `0` | `0` | `0` |
| `public.product_alias_proposals` | `0` | `0` | `0` |
| `public.product_alias_audit_log` | `0` | `0` | `0` |
| `public.offers` | `4` | `4` | `0` |
| `public.product_images` | `0` | `0` | `0` |
| `public.offer_display_images` | `0` | `0` | `0` |
| `public.offer_status_history` | `0` | `0` | `0` |
| `public.offer_revision_snapshots` | `0` | `0` | `0` |
| `public.v_consumer_offers` | `4` | `4` | `0` |
| `public.publication_operations` | N/A | `0` | Created |
| `public.publication_journal_mutations` | N/A | `0` | Created |
| `public.publication_duplicate_skips` | N/A | `0` | Created |
| `public.publication_storage_operations` | N/A | `0` | Created |

### Existing `public.offers` & `public.v_consumer_offers` Row Verification

| `id` | `source_offer_id` | `status` | `offer_price` | `product_id` | `v_consumer_offers` `temporal_lifecycle_state` | New `010` Columns |
| --- | --- | --- | --- | --- | --- | --- |
| `34d2cfc2-938d-4350-83aa-8e9181ae112c` | `doc_962d27694c7b562b:p001:is1_a:s01` | `published` | `5.50` | `27803` | `expired` | `null` |
| `5933cab0-1452-408b-8d6f-2c05c775e0e9` | `doc_962d27694c7b562b:p001:is5_1:s01` | `published` | `5.50` | `27809` | `expired` | `null` |
| `4eac0fd1-29ee-4a3a-bec6-6425e20eff70` | `doc_962d27694c7b562b:p001:is5b_b:s01` | `published` | `5.50` | `28997` | `expired` | `null` |
| `39704e54-d934-4f90-b1bc-f7ca3aeee641` | `leaflet_wp2:p001:it9_need_approval_1794737884333:s01` | `published` | `4.95` | `null` | `active` (`NON_CATALOG_APPROVED`) | `null` |

---

## 6. App Schema Compatibility & Read-Only Storage Bucket Routing Check (Condition 6)

### 6.1 `assessSchemaCompatibility('DEVELOPMENT_TEST')` Result

- `compatible`: `true`
- `context`: `"DEVELOPMENT_TEST"`
- `projectRef`: `"gykrbpykjhpyrdrinkuk"`
- `hasMigration009`: `true`
- `hasMigration010`: `true`
- `hasConsumerView`: `true`
- `hasSourceOfferUniqueIndex`: `true`
- `hasRequiredColumns`: `true`
- `storageBucketsVerified`: `true` (`bucket:offer-images: true`)
- `missingDependencies`: `[]`
- `blockingReasons`: `[]`
- All `22` inspection entries in `details` (`11` tables, `6` `offers` columns, `1` unique index, `1` view, `2` functions, `1` required bucket) returned `true`.

### 6.2 Read-Only Storage Buckets & Publication Routing Inspection

Environment configuration (`.env.local` line 58): `SUPABASE_STORAGE_BUCKET=offer-images`.  
Read-only `supabase.storage.listBuckets()` on `gykrbpykjhpyrdrinkuk` returned:

| Bucket Name | `public` | `file_size_limit` | `allowed_mime_types` |
| --- | --- | --- | --- |
| `product-images` | `true` | `10485760` (`10 MB`) | `["image/jpeg", "image/png", "image/webp"]` |
| `offer-display-images` | `true` | `10485760` (`10 MB`) | `["image/jpeg", "image/png", "image/webp"]` |
| `offer-images` | `false` | `10485760` (`10 MB`) | `null` |
| `tmp` | `false` | `10485760` (`10 MB`) | `null` |

**Suitability note for first DEV publication UAT:**
- `offer-images` exists on `gykrbpykjhpyrdrinkuk` and satisfies `assessSchemaCompatibility` cleanly for service-role uploads, staging, and Undo cleanup (`publication_storage_operations`).
- Because `offer-images` currently has `public: false` (unlike `product-images` and `offer-display-images`, which are `public: true`), anonymous consumer-frontend image loads via unauthenticated `/storage/v1/object/public/offer-images/...` URLs will fail unless DEV publication UAT routes consumer images into a public bucket or updates `offer-images` visibility/signed-URL handling prior to consumer-UI image rendering checks. Schema & service-role staging readiness are unaffected and ready for controlled DEV publication UAT.

---

## 7. Final Conclusion

`DEV MIGRATION SUCCESSFUL — READY FOR PUBLICATION UAT`
