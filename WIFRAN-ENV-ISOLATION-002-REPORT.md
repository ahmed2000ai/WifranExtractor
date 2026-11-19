# WIFRAN-ENV-ISOLATION-002: Final Schema Parity and Legacy Script Safety Verification — Final Report

**Date:** 2026-11-12  
**Milestone:** `WIFRAN-ENV-ISOLATION-002`  
**Status:** **COMPLETE & VERIFIED**  
**Predecessors:** `WIFRAN-ENV-ISOLATION-001`, `WIFRAN-DB-RESET-001`  

---

## Executive Summary

This milestone resolves all remaining environment-isolation risks, investigates schema differences between production and development, establishes a comprehensive inventory and safety quarantine for all database-capable scripts, and proves fail-closed runtime safety.

### Milestone Final Verdicts

| Verification Category | Verdict | Description |
| :--- | :---: | :--- |
| **DEV SCHEMA COMPLETENESS** | **PASS** | All required tables, bigint product IDs, canonical keys, contract v2 columns, RLS, triggers, views, and buckets exist in DEV. |
| **HISTORICAL PRODUCTION PARITY** | **DIFFERENCES IDENTIFIED** | All 28 production base tables and 50 RLS policies exist in DEV. DEV contains +2 forward-looking tables (`product_alias_proposals`, `product_alias_audit_log`) and +5 RLS policies from Migration 009, plus 1 tracking table (`_applied_migrations`). |
| **LEGACY SCRIPT ISOLATION** | **PASS** | 58 historical production scripts quarantined with dual-authorization gates; dev utilities enforced with `DEVELOPMENT_TEST`. |
| **PRODUCTION ACCESS DURING MILESTONE** | **ZERO** | Zero production queries, zero mutations, zero migrations, zero storage uploads. |
| **READY FOR BULK EXTRACTION DEVELOPMENT** | **YES** | Development environment is completely isolated, pristine, verified, and safe for bulk extraction development. |

---

## 1. Investigation of Schema Discrepancies

### 1.1 Migration 002 (`002_migrate_identifiers_to_codes.sql`) Explanation
- **Historical Background:** Migration 002 was an early, destructive transition draft created when reference data tables (`supermarkets`, `cities`, `regions`) originally used UUID primary keys and needed to convert to 4-letter codes. To force the type change, it contained `TRUNCATE TABLE public.supermarkets CASCADE; TRUNCATE TABLE public.cities CASCADE; TRUNCATE TABLE public.regions CASCADE;`.
- **Intentionally Superseded:** Migration 002 was explicitly superseded by **Migration 006** (`006_wifran_07a_security_and_contract_reconciliation.sql`). Migration 006 safely closed findings `INT-F03` and `INT-F04` by introducing `public.legacy_id_crosswalk` (38 mapping rows) and reconciling foreign keys non-destructively without truncating live or seed data.
- **Explicit File Header Warning:** The file itself specifies its superseded status:
  ```sql
  -- DISPOSABLE CLEAN-INIT ONLY (DO NOT RUN ON POPULATED DATABASES) (INT-F03)
  -- WARNING: This script contains TRUNCATE TABLE ... CASCADE which destroys all
  -- live data! For upgrading populated databases, use:
  -- 006_wifran_07a_security_and_contract_reconciliation.sql
  ```
- **Ordering & Dependency Rule:** In `001_initial_schema.sql`, all reference ID columns were already defined as `text primary key`. In `001_seed_core_catalog.sql`, canonical UUIDs were inserted with standard codes (`PAND`, `CENT`, `RIYC`). Running `002` on a database populated with `001_seed_core_catalog.sql` would have wiped out all reference data. Omitting `002` from the development initialization was therefore **necessary, correct, and mandated by the migration specification**.

### 1.2 Table Count Discrepancy: 28 Production vs 31 Development
The historical prelaunch reset report recorded **28 public base tables** in production. The development database contains **31 public base tables**.

The three additional tables in development are:
1. `public.product_alias_proposals`: Defined in Migration 009 (`009_wifran_07j_product_alias_staging_and_audit.sql`) to isolate candidate aliases before operator review.
2. `public.product_alias_audit_log`: Defined in Migration 009 as an append-only audit trail for alias approvals and rejections.
3. `public._applied_migrations`: Created by `scripts/setup-dev-database.ts` to ensure migration execution is tracked and idempotent.

*Analysis:* Migration 009 was marked in the repository as an offline specification (`OFFLINE SPECIFICATION ONLY`) that had been validated in isolated PGlite tests but not yet applied to the production database prior to reset. Applying Migration 009 to development was intentional and forward-looking, ensuring the development environment supports Milestone 2E alias review features.

### 1.3 RLS Policy Discrepancy: 50 Production vs 55 Development
The historical production reset report verified **50 active RLS policies**. The development database has **55 active RLS policies**.

The 5 additional policies in development come entirely from Migration 009:
- On `public.product_alias_proposals` (3 policies):
  1. `Allow operators to view alias proposals` (`SELECT`)
  2. `Allow operators to insert alias proposals` (`INSERT`)
  3. `Allow operators to update non-approved alias proposals` (`UPDATE`)
- On `public.product_alias_audit_log` (2 policies):
  4. `Allow operators to view alias audit log` (`SELECT`)
  5. `Allow append-only insert to alias audit log` (`INSERT`)

**Mathematical Parity:**
$$\text{Production Baseline RLS (50)} + \text{Migration 009 RLS (5)} = \text{Development Total RLS (55)}$$

---

## 2. Development Schema Completeness Verification

Direct programmatic inspection of the development database (`gykrbpykjhpyrdrinkuk`) verified complete schema integrity:

- **Product Identity Architecture:**
  - `products.id` is `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`.
  - Immutable ID trigger `trg_prevent_product_id_update` enforced via `fn_prevent_product_id_update()`.
  - `canonical_product_key` unique constraint `uq_products_canonical_product_key` active.
  - Verification check constraint `chk_products_verification_status` active (`'candidate'`, `'verified'`, `'rejected'`).
  - Approved image foreign key `fk_products_approved_primary_image` referencing `public.product_images(id)`.
- **Offer Contract & Catalog Mapping:**
  - Location scope check constraints `chk_offer_location_scope` and `chk_offer_location_scope_rules` active.
  - Catalog match status check constraint `chk_offers_catalog_match_status` active.
  - Nullable inner pack count for weight-measured items `chk_offers_inner_pack_count` active.
  - Dynamic compound sub-offer structure (`compound_group_id`, `source_revision`, `semantic_checksum`).
- **Illustrative & Hybrid Display Images:**
  - `public.product_images` with role and approval check constraints and RLS active.
  - `public.offer_display_images` with active unique partial index `uq_offer_display_images_active` and RLS active.
  - `public.offer_visual_group_members` for compound visual binding.
- **Consumer Views:**
  - `public.v_consumer_offers` projects 98 columns, filters strictly to `o.status = 'published'`, and masks unlinked or candidate product IDs and private images to `NULL`.
- **Master Reference Data:**
  - `categories`: 13 rows
  - `cities`: 25 rows
  - `regions`: 5 rows
  - `supermarkets`: 13 rows (12 baseline + Noori Supermarket)
  - `supermarket_regions`: 12 rows
  - `units`: 9 rows
  - `legacy_id_crosswalk`: 38 rows
- **Storage Buckets:**
  - `product-images` (`public: true`, 10MB limit)
  - `offer-display-images` (`public: true`, 10MB limit)
  - `offer-images` (`public: false`, 10MB limit)
  - `tmp` (`public: false`, 10MB limit)

---

## 3. Comprehensive Database-Capable Script Inventory

An audit of all 65 database-capable scripts across the repository was conducted. Every script was classified and assigned explicit safety boundaries:

### Category A: Active Development Tooling (Guarded `DEVELOPMENT_TEST`)
These scripts are part of ongoing development and strictly connect to the development project (`gykrbpykjhpyrdrinkuk`):

| Script | Purpose | Target | Credential Source | Capabilities | Guard Method | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| [`setup-dev-database.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/scripts/setup-dev-database.ts) | Idempotent schema & bucket init | DEV | `DEV_` variables | DDL, DML, Storage | `createGuardedPgClient('DEVELOPMENT_TEST')` | **ACTIVE** |
| [`inspect-test-records.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/scripts/inspect-test-records.ts) | Inspect dev catalog tables | DEV | `DEV_` variables | Read-only | `createGuardedPgClient('DEVELOPMENT_TEST')` | **ACTIVE** |
| [`audit-dev-schema.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/scripts/audit-dev-schema.ts) | Audit dev tables, RLS, buckets | DEV | `DEV_` variables | Read-only | `createGuardedPgClient('DEVELOPMENT_TEST')` | **ACTIVE** |
| [`check-storage-buckets.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/scripts/check-storage-buckets.ts) | List dev storage buckets | DEV | `DEV_` variables | Read-only | `getGuardedSupabaseClient('DEVELOPMENT_TEST')` | **ACTIVE** |
| [`verify-consumer-offers-view.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/scripts/verify-consumer-offers-view.ts) | Verify dev consumer view | DEV | `DEV_` variables | Read-only | `getGuardedSupabaseClient('DEVELOPMENT_TEST')` | **ACTIVE** |

### Category B: Quarantined Historical Production Administration Scripts (58 Scripts)
These historical utilities previously connected to production (`swratbmclahjyekouned`). Each script now has a hard safety quarantine gate at line 1:
```typescript
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)
```
If executed as part of ordinary development or tests, the script terminates immediately before creating any database client, reading credentials, or opening a network connection.

| Script Name | Historical Purpose | Previous Target | Quarantine Status |
| :--- | :--- | :--- | :---: |
| `execute-prelaunch-reset.ts` | Test-data deletion for prelaunch reset | PRODUCTION | **QUARANTINED** |
| `create-prelaunch-backup.ts` | Pre-reset table and JSON backup | PRODUCTION | **QUARANTINED** |
| `backup-storage-objects.ts` | Pre-reset storage images download | PRODUCTION | **QUARANTINED** |
| `inspect-db-for-reset.ts` | Pre-reset table audit | PRODUCTION | **QUARANTINED** |
| `inspect-storage-for-reset.ts` | Pre-reset storage bucket audit | PRODUCTION | **QUARANTINED** |
| `verify-post-reset.ts` | Post-reset verification matrix | PRODUCTION | **QUARANTINED** |
| `test-db-reset-rollback.ts` | Rollback drill validation | PRODUCTION | **QUARANTINED** |
| `apply-migration-007.ts` | Migration 007 execution on production | PRODUCTION | **QUARANTINED** |
| `apply-migration-008.ts` | Migration 008 execution on production | PRODUCTION | **QUARANTINED** |
| `test-pg-connection.ts` | Initial role privilege granting | PRODUCTION | **QUARANTINED** |
| `mvp-001-production-audit.ts` | Initial MVP catalog inspection | PRODUCTION | **QUARANTINED** |
| `execute-catalog-003-promotion.ts` | Catalog 003 promotion execution | PRODUCTION | **QUARANTINED** |
| `execute-carrefour-canary.ts` | Carrefour canary live publish | PRODUCTION | **QUARANTINED** |
| `execute-live-canary.ts` | Noori canary live publish | PRODUCTION | **QUARANTINED** |
| `canary-page1-rehearsal.ts` | Canary page 1 live rehearsal | PRODUCTION | **QUARANTINED** |
| `run-step3-full-import.ts` | Step 3 live import execution | PRODUCTION | **QUARANTINED** |
| `prepare-noori-canary.ts` | Canary staged draft preparation | PRODUCTION | **QUARANTINED** |
| `prepare-carrefour-canary.ts` | Carrefour canary preparation | PRODUCTION | **QUARANTINED** |
| `preflight-canary-001n.ts` | Canary preflight inspection | PRODUCTION | **QUARANTINED** |
| `carrefour-preflight-002n.ts` | Carrefour preflight inspection | PRODUCTION | **QUARANTINED** |
| `catalog-003-preflight.ts` | Catalog 003 preflight inspection | PRODUCTION | **QUARANTINED** |
| `shadow-preflight-002f.ts` | Shadow evaluation preflight | PRODUCTION | **QUARANTINED** |
| `run-shadow-evaluation-002f.ts` | Shadow evaluation run | PRODUCTION | **QUARANTINED** |
| `run-live-pilot-alwafa.ts` | Live pilot execution on Al-Wafa | PRODUCTION | **QUARANTINED** |
| `reseed-alwafa-products-sequential.ts` | Al-Wafa product sequential reseed | PRODUCTION | **QUARANTINED** |
| `seed_reference_data.ts` | Legacy reference data seeder | PRODUCTION | **QUARANTINED** |
| `reconcile-alwafa-products.ts` | Product reconciliation script | PRODUCTION | **QUARANTINED** |
| `update-alwafa-products-evidence.ts` | Evidence updater for Al-Wafa | PRODUCTION | **QUARANTINED** |
| `fix-arabic-typos.ts` | Catalog typo correction | PRODUCTION | **QUARANTINED** |
| `find-pilot-grocery-candidates.ts` | Candidate search utility | PRODUCTION | **QUARANTINED** |
| `check-carrefour.ts` | Retailer check script | PRODUCTION | **QUARANTINED** |
| `verify-canary-conflicts.ts` | Conflict audit script | PRODUCTION | **QUARANTINED** |
| `verify-canary-post-publish.ts` | Post-publish verification | PRODUCTION | **QUARANTINED** |
| `verify-post-canary-002n.ts` | Canary 002N verification | PRODUCTION | **QUARANTINED** |
| `verify-post-catalog-003.ts` | Catalog 003 verification | PRODUCTION | **QUARANTINED** |
| `verify-export-repeatability.ts` | Repeatability verification | PRODUCTION | **QUARANTINED** |
| `verify-hybrid-export-repeatability.ts` | Hybrid repeatability check | PRODUCTION | **QUARANTINED** |
| `audit-alwafa-products.ts` | Al-Wafa catalog audit | PRODUCTION | **QUARANTINED** |
| `audit-product-id-schema.ts` | Product ID schema audit | PRODUCTION | **QUARANTINED** |
| `analyze-unresolved-candidates.ts` | Candidate analysis script | PRODUCTION | **QUARANTINED** |
| `inspect-11-offers.ts` | 11-offer inspection utility | PRODUCTION | **QUARANTINED** |
| `inspect-all-42.ts` | 42-offer inspection utility | PRODUCTION | **QUARANTINED** |
| `inspect-alwafa-single-prod.ts` | Single product audit | PRODUCTION | **QUARANTINED** |
| `inspect-alwafa-unresolved.ts` | Unresolved offer audit | PRODUCTION | **QUARANTINED** |
| `inspect-assortment-dist.ts` | Assortment distribution audit | PRODUCTION | **QUARANTINED** |
| `inspect-assortment-status.ts` | Assortment status audit | PRODUCTION | **QUARANTINED** |
| `inspect-col-default.ts` | Column default inspection | PRODUCTION | **QUARANTINED** |
| `inspect-db-schema.ts` | Schema inspection utility | PRODUCTION | **QUARANTINED** |
| `inspect-items-evidence.ts` | Item evidence inspection | PRODUCTION | **QUARANTINED** |
| `inspect-noori-exact.ts` | Noori exact offer inspection | PRODUCTION | **QUARANTINED** |
| `inspect-noori-exposure.ts` | Noori consumer exposure audit | PRODUCTION | **QUARANTINED** |
| `inspect-noori-production.ts` | Noori production audit | PRODUCTION | **QUARANTINED** |
| `inspect-production-safe.ts` | Production safe inspection | PRODUCTION | **QUARANTINED** |
| `inspect-products-pilot.ts` | Products pilot audit | PRODUCTION | **QUARANTINED** |
| `inspect-single-product.ts` | Single product inspection | PRODUCTION | **QUARANTINED** |
| `inspect-supermarkets.ts` | Supermarkets inspection | PRODUCTION | **QUARANTINED** |
| `inspect-typos.ts` | Typo inspection utility | PRODUCTION | **QUARANTINED** |
| `inspect-unresolved-all.ts` | Unresolved items audit | PRODUCTION | **QUARANTINED** |
| `inspect-unresolved-offers.ts` | Unresolved offers audit | PRODUCTION | **QUARANTINED** |

### Dual Authorization Required for Quarantined Scripts
To execute any quarantined script against production, an operator must provide:
1. Environment Variable: `WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1`
2. Command-Line Flag: `--allow-production-admin-operation`

Without both, execution halts immediately with a `[PRODUCTION_SAFETY_QUARANTINE]` exception.

---

## 4. Automated Safety Test Suite Results

The automated isolation test suite in [`src/main/db/__tests__/environmentIsolation.test.ts`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/src/main/db/__tests__/environmentIsolation.test.ts) was expanded to **14 tests** covering all safety gates:

| Test Identifier | Guard Property Tested | Result |
| :--- | :--- | :---: |
| **Test A** | Valid development settings resolve development project without fallback | **PASS** |
| **Test B** | Missing development credentials fail closed (zero fallback to production) | **PASS** |
| **Test C** | Production URL injected into test settings rejected before network access | **PASS** |
| **Test D** | Production credentials (key or password) injected into test settings rejected | **PASS** |
| **Test E** | Normal UI resolves production exclusively with zero database mutations | **PASS** |
| **Test F** | Normal UI cannot switch to development configuration | **PASS** |
| **Test G** | Development database schema and storage buckets verified | **PASS** |
| **Test H** | Development writes and cleanup are restricted to development | **PASS** |
| **Test I** | Normal UI database configuration targets production regardless of `NODE_ENV` | **PASS** |
| **Test J** | Migration and CLI target wrappers fail closed if targeting production | **PASS** |
| **Test K** | Direct PostgreSQL clients fail closed on invalid or leaked targets | **PASS** |
| **Test L** | Quarantined historical scripts fail closed without explicit dual authorization | **PASS** |
| **Test M** | Test-only credentials and raw secrets are never leaked to renderer configuration | **PASS** |
| **Test N** | Offline UAT mode strictly blocks remote database access in client factories | **PASS** |

**Execution Time:** `14 passed in 2.58s`.

---

## 5. Development Cleanliness Audit

Direct audit of development storage and tables confirmed a pristine state:

```
--- Catalog Table Row Counts ---
  - products                    : 0 rows
  - offers                      : 0 rows
  - product_images              : 0 rows
  - offer_display_images        : 0 rows
  - product_aliases             : 0 rows
  - product_alias_proposals     : 0 rows
  - product_alias_audit_log     : 0 rows

--- Master Reference Data Row Counts ---
  - categories                  : 13 rows
  - cities                      : 25 rows
  - regions                     : 5 rows
  - supermarkets                : 13 rows
  - supermarket_regions         : 12 rows
  - units                       : 9 rows
  - legacy_id_crosswalk         : 38 rows

--- Storage Objects Count ---
  - product-images           : 0 objects
  - offer-display-images     : 0 objects
  - offer-images             : 0 objects
  - tmp                      : 0 objects
```

---

## 6. TypeScript & Build Verification

- `npm run typecheck:node`: **PASS (0 errors)**
- `npm run typecheck:web`: **PASS (0 errors)**
- `npm run test:accuracy`: **PASS (12 files, 72 tests passed)**
- `npm run build`: **PASS** (SSR main, preload, and React renderer bundled cleanly with Vite 5.4.21).

---

## 7. Stop Condition Satisfied

In strict compliance with Section 6 of the authorization:
- All schema parity questions are fully investigated and documented.
- All 58 historical production scripts are quarantined with hard safety gates.
- All 14 runtime guard tests pass cleanly.
- **Zero production queries, mutations, or storage uploads occurred.**
- **Zero paid Gemini API calls were made.**
- **Zero Git commits, pushes, or resets were performed.**
- Execution is stopped and ready for owner review before initiating bulk extraction.

