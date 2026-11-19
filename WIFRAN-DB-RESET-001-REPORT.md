# WIFRAN-DB-RESET-001 REPORT
## Prelaunch Test Data Removal — Establish Clean Production-Quality Catalog

**Milestone:** `WIFRAN-DB-RESET-001`  
**Target Environment:** Wifran Supabase Database (`postgres` on `swratbmclahjyekouned.supabase.co`)  
**Execution Timestamp:** 2026-11-11T22:41:12Z  
**Status:** COMPLETE & FULLY VERIFIED  

---

## 1. Executive Summary

In accordance with owner authorization for milestone `WIFRAN-DB-RESET-001`, all prelaunch test products, offers, image mappings, and dependent records have been completely and safely removed from the Wifran Supabase database.

The database catalog is now in a pristine, production-ready state with:
- **0 Products**
- **0 Offers**
- **0 Product Images**
- **0 Offer Display Images**
- **0 Test Aliases or Dependent Records**

All master reference data (supermarkets, categories, cities, regions, commercial units, and region crosswalks), database schemas, foreign-key constraints, triggers, and Row Level Security (RLS) policies remain 100% intact and functional.

---

## 2. Target Project Confirmation & Safety Preflight

Before initiating any mutation, the database target was strictly verified:

| Parameter | Confirmed Target Value | Status |
|---|---|:---:|
| **Supabase Project Ref** | `swratbmclahjyekouned` | **MATCH** |
| **Supabase URL** | `https://swratbmclahjyekouned.supabase.co` | **MATCH** |
| **Database Host** | `db.swratbmclahjyekouned.supabase.co:5432` | **MATCH** |
| **Database Name / User** | `postgres` / `postgres` | **MATCH** |
| **Active RLS Policies** | 50 policies verified active | **INTACT** |
| **Schema Migration State** | Up to date (Migrations 001–009) | **INTACT** |

---

## 3. Pre-Reset Audit & Before Row Counts

An exhaustive audit of all 28 public base tables was performed prior to deletion:

| Table Name | Before Count | Classification | Reset Action |
|---|---:|---|---|
| `offers` | **93** | Test Offer Records | **Backed up & Deleted** |
| `offer_display_images` | **31** | Consumer Display Image Mappings | **Backed up & Deleted** |
| `products` | **11** | Test Catalog Products | **Backed up & Deleted** |
| `product_images` | **7** | Catalog Image Mappings | **Backed up & Deleted** |
| `product_aliases` | **0** | Product Aliases | Confirmed 0 |
| `offer_revision_snapshots` | **0** | Offer Snapshots | Confirmed 0 |
| `offer_status_history` | **0** | Status History | Confirmed 0 |
| `offer_visual_group_members` | **0** | Compound Groups | Confirmed 0 |
| `saved_offers` | **0** | Consumer Saved Offers | Confirmed 0 |
| `watched_items` | **0** | Watched Items | Confirmed 0 |
| `shopping_list_items` | **0** | Shopping List Items | Confirmed 0 |
| `shopping_lists` | **0** | Shopping Lists | Confirmed 0 |
| `issue_reports` | **0** | Issue Reports | Confirmed 0 |
| `import_rows` | **0** | Import Rows | Confirmed 0 |
| `import_batches` | **0** | Import Batches | Confirmed 0 |
| `validation_errors` | **0** | Validation Errors | Confirmed 0 |
| `offer_sources` | **0** | Offer Sources | Confirmed 0 |
| `app_events` | **0** | App Events | Confirmed 0 |
| `audit_logs` | **0** | Audit Logs | Confirmed 0 |
| `profiles` | **0** | User Profiles | Confirmed 0 |
| `brands` | **0** | Brand Master | Confirmed 0 |
| `categories` | **13** | Category Master Data | **PRESERVED** |
| `cities` | **25** | City Master Data | **PRESERVED** |
| `regions` | **5** | Commercial Region Master Data | **PRESERVED** |
| `supermarkets` | **13** | Retailer Master Data | **PRESERVED** |
| `supermarket_regions` | **12** | Supermarket Region Mappings | **PRESERVED** |
| `units` | **9** | Measurement Units Master | **PRESERVED** |
| `legacy_id_crosswalk` | **38** | Region/City Migration Crosswalk | **PRESERVED** |

---

## 4. Recoverable Pre-Reset Backup

A complete, transaction-safe recoverable backup of all records was created and verified with SHA-256 integrity hashes prior to executing the reset:

- **Backup Location:**  
  `F:\Work\AI Projects\wifran-offers-extractor\backups\db-prelaunch-reset-2026-11-11T22-38-45-937Z\`
- **Backup Manifest:**  
  [`backup-manifest.json`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/backups/db-prelaunch-reset-2026-11-11T22-38-45-937Z/backup-manifest.json)
- **Exported Datasets:**
  - `offers.json` (93 records, SHA-256: `32260ada2c8d...`)
  - `offer_display_images.json` (31 records, SHA-256: `e46ebdc2aabb...`)
  - `products.json` (11 records, SHA-256: `742c993de362...`)
  - `product_images.json` (7 records, SHA-256: `4e45d5a874df...`)
  - 12 empty table manifests (0 rows each)
- **Self-Contained SQL Replay Script:**  
  [`restore_test_data.sql`](file:///f:/Work/AI%20Projects/wifran-offers-extractor/backups/db-prelaunch-reset-2026-11-11T22-38-45-937Z/restore_test_data.sql) (755.6 KB, dependency-ordered `INSERT` statements with transaction wrapping)
- **Storage Object Backups:**  
  All 38 test image files were downloaded and preserved locally under:  
  `backups\db-prelaunch-reset-2026-11-11T22-38-45-937Z\storage-backup\`
- **Verification Status:** **PASS** (100% hash match verified on disk).

---

## 5. Dependency-Aware Execution Sequence

To preserve foreign-key integrity without using destructive or uncontrolled `CASCADE` truncates, the deletion was executed within a single ACID transaction block (`BEGIN ... COMMIT`) following strict dependency order:

1. **Delete Dependent Offer Child Records:**  
   Removed `offer_display_images` (31 rows). Verified 0 rows in other offer children (`offer_revision_snapshots`, `offer_status_history`, `offer_visual_group_members`, `saved_offers`, `shopping_list_items`, `issue_reports`, `import_rows`, `validation_errors`).
2. **Delete Test Offers:**  
   Removed `offers` (93 rows).
3. **Break Circular Product Image FK:**  
   Executed `UPDATE public.products SET approved_primary_image_id = NULL WHERE approved_primary_image_id IS NOT NULL;` (7 rows updated).
4. **Delete Dependent Product Child Records:**  
   Removed `product_images` (7 rows). Verified 0 rows in other product children (`product_aliases`, `watched_items`, `shopping_list_items`, `product_alias_proposals`).
5. **Delete Test Products:**  
   Removed `products` (11 rows).
6. **Pre-Commit Referential Audit:**  
   Verified `SELECT COUNT(*) = 0` across all 5 mutated tables and confirmed all reference counts $\ge$ baseline.
7. **Commit Transaction:**  
   Executed `COMMIT;`.

---

## 6. Supabase Storage Cleanup

Supabase Storage cleanup targeted only objects exclusively belonging to the removed test records:

- **Bucket `product-images`:**  
  Removed 7 test catalog images under `catalog/` (`061aef01...`, `7dcdeac6...`, `d41c7184...`, `daa208f0...`, `dccc2511...`, `e1d8c96f...`, `f358d98b...`).  
  *Remaining objects in bucket:* **0**.
- **Bucket `offer-display-images`:**  
  Removed 31 test consumer display images under `offers/`.  
  *Remaining objects in bucket:* **0**.
- **Buckets Preserved Unchanged:**  
  `offer-images` (raw leaflet crops and PDFs preserved), `tmp` (temporary render bucket preserved).  
  *No storage buckets were modified or deleted.*

---

## 7. Post-Reset Verification Matrix

A comprehensive programmatic verification was executed against the live Supabase project post-reset:

| Verification Category | Target Requirement | Measured Result | Status |
|---|---|---|:---:|
| **Offers Table** | Exactly 0 records | `0 rows` | **PASS** |
| **Products Table** | Exactly 0 records | `0 rows` | **PASS** |
| **Product Images Table** | Exactly 0 records | `0 rows` | **PASS** |
| **Offer Display Images Table** | Exactly 0 records | `0 rows` | **PASS** |
| **Product Aliases Table** | Exactly 0 records | `0 rows` | **PASS** |
| **Orphaned Offer Display Images** | 0 orphans | `0 orphans` | **PASS** |
| **Orphaned Product Images** | 0 orphans | `0 orphans` | **PASS** |
| **Orphaned Product Aliases** | 0 orphans | `0 orphans` | **PASS** |
| **Orphaned Offers** | 0 orphans | `0 orphans` | **PASS** |
| **Supermarket Master Data** | Retain $\ge 13$ retailers | `13 rows` | **PASS** |
| **Category Master Data** | Retain $\ge 13$ categories | `13 rows` | **PASS** |
| **City Master Data** | Retain $\ge 25$ cities | `25 rows` | **PASS** |
| **Region Master Data** | Retain $\ge 5$ commercial regions | `5 rows` | **PASS** |
| **Unit Master Data** | Retain $\ge 9$ measurement units | `9 rows` | **PASS** |
| **Supermarket Regions** | Retain $\ge 12$ region links | `12 rows` | **PASS** |
| **Legacy ID Crosswalk** | Retain $\ge 38$ crosswalk links | `38 rows` | **PASS** |
| **Row Level Security (RLS)** | All 50 policies active | `50 policies active` | **PASS** |
| **Supabase JS API Query: Supermarkets** | Successful read via REST | `13 returned` | **PASS** |
| **Supabase JS API Query: Categories** | Successful read via REST | `13 returned` | **PASS** |
| **Supabase JS API Query: Cities** | Successful read via REST | `25 returned` | **PASS** |
| **Supabase JS API Query: Products** | Successful read via REST | `0 returned` | **PASS** |
| **Supabase JS API Query: Offers** | Successful read via REST | `0 returned` | **PASS** |
| **Storage: product-images/catalog** | 0 remaining files | `0 files` | **PASS** |
| **Storage: offer-display-images/offers** | 0 remaining files | `0 files` | **PASS** |

---

## 8. Protection of Offline Test Fixtures

All local development workspaces, benchmark baselines, PDF files, and test fixtures remain completely preserved on disk:
- `Extracts/noori-supermarket-229798534-jeddah/` (canonical JSONs, dual crops, manifests preserved)
- `test-fixtures/` (golden verified references intact)
- Automated Vitest test suites (e.g. `oneClickPreviewThumbnails.test.ts`, `prePublishQuantityPresentation.test.ts`) continue to pass 100% offline without live database dependency.
- **Enforcement:** No legacy test fixtures were republished to the reset database.

---

## 9. New Data Integrity Policy (Post-Reset)

In accordance with Section 7 of the milestone specification:
1. **Real Data Standard:** All future published offers will be treated as real consumer offer data.
2. **Permanent Catalog Validation:** Permanent catalog products require validated product identity and operator approval.
3. **AI Recommendations as Proposals:** Gemini matching suggestions are proposals, not automated verification evidence.
4. **Temporary Reference Isolation:** Temporary `t` references remain batch-local and are never inserted as permanent database IDs.
5. **Database-Generated Product IDs:** New verified products receive sequential database-generated IDs upon insertion.
6. **Strict Image Isolation:** Product thumbnail crops from private leaflets are never automatically published as public catalog images.
7. **Offline Safeguards:** Development and testing must use local fixtures, mocked DB services, or isolated test environments.

---

## 10. Final Readiness Confirmation

- **Schema Integrity:** No database tables, columns, constraints, triggers, or RLS policies were modified or dropped.
- **Master Reference Integrity:** Supermarkets, categories, cities, regions, and units remain intact.
- **Catalog State:** Database contains **zero test products and offers**.
- **Ingestion Readiness:** The Wifran Supabase database is completely clean, healthy, and ready for real catalog ingestion.

