# WIFRAN-04 & WIFRAN-07A Contract Upgrade Engineering Report
**Specification**: `WIFRAN-03`, `WIFRAN-04` & `WIFRAN-07A` Data Contract Architecture  
**Schema Version**: `wifran.extractor.offer/2.0`  
**Database Upgrade**: Additive Migrations `005_wifran_v2_offer_contract.sql` & `006_wifran_07a_security_and_contract_reconciliation.sql`  
**Test Suites**:
- `src/shared/utils/__tests__/wifran04ContractUpgrade.test.ts` (32/32 Passed)
- `src/shared/utils/__tests__/wifran07aIntegrationAcceptance.test.ts` (33/33 Passed)
- `src/shared/utils/__tests__/wifran07bPostgresFreezeVerification.test.ts` (11/11 Passed - Real PostgreSQL 16)
- Total: 76/76 Integration & Acceptance Tests (100% Pass Rate)  
**Status**: Freeze Checklist Verified (WIFRAN-07B Ready)  

---

## 1. Overview & Objectives

This report documents the end-to-end implementation of the **Wifran Extractor Data Contract 2.0 Upgrade (`WIFRAN-04`)** and the comprehensive **Security, RLS & Contract Reconciliation (`WIFRAN-07A`)** addressing all findings `INT-F01` through `INT-F12`.

Key engineering achievements include:
1. **Hardened Security, RLS & Grants (`INT-F01`, `INT-F02`, `INT-F03`, `INT-F07`)**:
   - Revoked overbroad base table grants (`ALL`) from `anon` and `authenticated`.
   - Hardened `public.v_consumer_offers` with `WITH (security_invoker = false)` and `WHERE o.status = 'published'`, and dropped legacy `public_active_offers`.
   - Created recursive PostgreSQL sanitizer `build_sanitized_consumer_contract_v2()` stripping all local workstation paths (`^[A-Za-z]:[\\/]|\\\\`) to `NULL`.
   - Protected `profiles.role` from self-service escalation via trigger `prevent_profile_privilege_escalation()` and restricted column-level `UPDATE`.
   - Guarded `issue_reports` insertions with RLS check `status = 'open' AND admin_notes IS NULL`.
   - Revoked overbroad default privileges via `ALTER DEFAULT PRIVILEGES`.
2. **Authoritative Master Geography & Crosswalk (`INT-F04`, `INT-08`..`INT-10`)**:
   - Unified the 5 Commercial Leaflet Regions (`CENT`, `WEST`, `EAST`, `SOUT`, `NORT`) and 25 Authoritative Cities with 4-letter codes and parent `region_id`.
   - Created `public.legacy_id_crosswalk` safely remapping legacy seed UUIDs without destructive truncations.
   - Implemented `get_consumer_offers_for_shopping_date()` SQL RPC function for timezone-safe temporal and geographic queries.
3. **Quantity Semantics & Check Constraints (`INT-F05`, `INT-11`..`INT-13`)**:
   - Changed `inner_pack_count` on `public.offers` to be nullable with check constraint `CHECK (inner_pack_count IS NULL OR inner_pack_count > 0)`.
   - Prevented forced `inner_count: 1` on measured-weight items like fresh mutton (`J3`).
   - Cleaned up legacy `contract_version` defaults.
4. **Strict Identity Gating, Sparse Attributes & Commodities (`INT-F06`, `INT-F08`, `INT-F09`, `INT-14`..`INT-18`)**:
   - Strict capability gating: when `exact_identity_status !== 'verified_exact'`, `exact_product_comparison` is `needs_review` or `blocked` (never `supported`), `automatic_list_fulfillment` is `conditional` or `needs_review` (never `supported`), and `identity_confidence` cannot be `high`.
   - Domain-aware sparse attributes: `model`, `power_watts`, and `dimensions` are `'unknown'` (NOT `'not_applicable'`) on electronics (`J2` Mini Fan) when omitted from source text.
   - Domain attributes for fresh meat (`J3` Ethiopian Fresh Mutton Cuts): `meat_species`, `freshness`, `origin`, `cut_type`, `bone_status`, and derived subcategory `'fresh_mutton'`.
5. **Dynamic Sub-Offer IDs & Semantic Revision Snapshots (`INT-F11`, `INT-28`..`INT-32`)**:
   - Dynamic sub-offer index `:s01`, `:s02` generated via `buildSourceOfferId()` for compound offers.
   - Created `public.offer_revision_snapshots` table for immutable historical snapshots.
   - Synchronizer rules: identical `(source_offer_id, semantic_checksum)` is a strict no-op (`INT-28`), older incoming revisions rejected (`INT-29`), revision increment & historical snapshot archival (`INT-29`, `INT-32`).
6. **Post-Upload Database & Consumer View Samples (`INT-F10`, `INT-26`, `INT-36`)**:
   - Generated clean pre-upload fixtures and post-upload database row / consumer view DTO samples for `J1`, `J2`, and `J3` in `tests/fixtures/wifran04/post-upload-samples/`, proving zero local Windows path leaks.

---

## 2. Reconciliation Matrix: Findings `INT-F01` Through `INT-F12`

| Finding ID | Severity | Description | Resolution Implementation |
| :--- | :--- | :--- | :--- |
| **INT-F01** | High | Unfiltered view `v_consumer_offers` lacked `WHERE o.status = 'published'` | Added strict predicate `WHERE o.status = 'published'` in both `005` and `006`, preventing unapproved drafts from leaking. |
| **INT-F02** | Critical | Overbroad table grants to `anon`/`authenticated` and vulnerable `profiles.role` | Revoked `ALL` on base extraction tables; granted `SELECT` only on public reference tables; added `prevent_profile_privilege_escalation()` trigger and restricted profile column updates. |
| **INT-F03** | High | Migration `002` contained destructive `TRUNCATE` | Added disposable clean-init guard comment to `002`; implemented non-destructive `legacy_id_crosswalk` in `006`. |
| **INT-F04** | High | Conflicting Jeddah/region UUIDs between docs and SQL seeds; missing `region_id` on `cities` | Unified 5 commercial regions (`b144b6c8-1111-4444-b000-000000000001`..`0005`) and 25 cities with parent `region_id` across `001`, `006`, `referenceDataService.ts`, and handoff docs. |
| **INT-F05** | Medium | `inner_pack_count NOT NULL DEFAULT 1` broke measured weight items; fake `contract_version` on legacy rows | Dropped NOT NULL and default on `inner_pack_count`; added check constraint `CHECK (inner_pack_count IS NULL OR inner_pack_count > 0)`; set legacy `contract_version` to `null`. |
| **INT-F06** | Medium | Unresolved commodity `J3` had `supported` capabilities and `high` confidence | Gated capabilities in `extractorContractV2Adapter.ts`: unresolved identity sets comparison to `needs_review` and fulfillment to `conditional`, with confidence at most `medium`. |
| **INT-F07** | High | Internal Windows workstation paths (`F:\Work\...`) leaked into view and contract JSON | Created `build_sanitized_consumer_contract_v2()` SQL function stripping local paths to `NULL`; verified 100% path hygiene in post-upload samples. |
| **INT-F08** | Low | Naming discrepancy between `structural_capabilities` in docs vs `capabilities` in JSON | Standardized on `capabilities` and added TypeScript/JSON alias `structural_capabilities` for bidirectional compatibility. |
| **INT-F09** | Medium | `model`/`power_watts`/`dimensions` marked `not_applicable` on fan; generic meat commodity tags | Added domain-aware attribute rules in `extractorContractV2Adapter.ts`: electronics absent attributes are `unknown`; meat items derive specific tags (`fresh_mutton`) and meat attributes. |
| **INT-F10** | Low | Handoff lacked post-upload database row and consumer view samples | Generated post-upload samples for `J1`, `J2`, and `J3` in `tests/fixtures/wifran04/post-upload-samples/` with clean delivery URLs and storage paths. |
| **INT-F11** | High | Missing immutable revision snapshots and dynamic sub-offer IDs (`:s01`, `:s02`) | Created `offer_revision_snapshots` table; updated `buildSourceOfferId()` to support sub-offer indices; added `supersedes_source_offer_id` tracking and no-op replay logic. |
| **INT-F12** | Medium | Missing shopping date RPC resolving parent commercial region applicability | Created `get_consumer_offers_for_shopping_date()` SQL RPC resolving national, city, and parent region offers in `'Asia/Riyadh'` time. |

---

## 3. Integration Freeze Verification Matrix: Findings `B-01` Through `B-10`

The final integration freeze review (`Wifran-07B`) surfaced 10 additional requirements for production database safety, zero-downtime upgrades, and API parity:

| Finding ID | Domain | Issue Description | Resolution Implementation | Status |
| :--- | :--- | :--- | :--- | :--- |
| **B-01** | Migration | `005` created view calling `build_sanitized_consumer_contract_v2` and referenced `o.currency`, neither of which existed prior to `006`. | Added `currency` column and defined `build_sanitized_consumer_contract_v2` inside `005` before the view, making `005` 100% self-contained in a `001 -> 006` sequence. | **RESOLVED** |
| **B-02** | Migration | In `006`, upserting regions/cities with `id = excluded.id` before remapping child rows violated FK constraints on populated databases. | Implemented FK-safe transactional pattern: dynamically dropped FKs referencing `regions`/`cities`, upserted canonical registries, remapped all child tables via `legacy_id_crosswalk`, deduplicated `supermarket_regions`, deleted unreferenced legacy regions, and restored FKs. | **RESOLVED** |
| **B-03** | Security | `006` left `offer_revision_snapshots` open to public reads via `USING (true)`. | Dropped public read policy, revoked access from `anon`/`authenticated`, restricted access to admin/service role, and created sanitized RPC `get_offer_revision_history_summary`. | **RESOLVED** |
| **B-04** | Sync Mapper | `validateLocationScope` required `city_id` even when `location_scope = 'national'`. | Enforced location validation strictly by scope: `national` requires `city_id = null` and `region_id = null`; `region` requires `region_id` and `city_id = null`; `city` requires `city_id`. | **RESOLVED** |
| **B-05** | Sync Mapper | `mapPreparedOfferToDbInsert` returned nonexistent column `offer_source_id`. | Removed `offer_source_id` from insert object and mapped source ID to the actual `offers.source_id` column. | **RESOLVED** |
| **B-06** | Sync Mapper | `created_by` defaulted to hardcoded zero UUID, violating `created_by REFERENCES profiles(id)`. | Changed default to `null` for automated extractor syncs (`created_by: input.createdBy ?? null`). | **RESOLVED** |
| **B-07** | Projections | Sample post-upload files had `status: 'needs_review'` (invisible in consumer view) and lacked true SQL view row samples. | Fixed publication status, generated 3 synchronized artifacts per benchmark offer (`*.post-upload-db-row.json`, `*.sql-consumer-view-row.json`, `*.consumer-projection-dto.json`), and added `mapSqlConsumerViewRowToConsumerDto`. | **RESOLVED** |
| **B-08** | Seed Data | Cities 10–25 in `001_seed_core_catalog.sql` had 35-character UUIDs (missing 1 leading zero). | Corrected all 16 city UUIDs to 36-char canonical hex, achieving 100% byte-for-byte parity across `001`, `006`, and `MASTER_CITIES` (`CAT-01`). | **RESOLVED** |
| **B-09** | Reason Codes | Post-upload contracts still contained transient `MEDIA_UPLOAD_PENDING`. | Reconciled `contract_v2.assets` upon upload and stripped `MEDIA_UPLOAD_PENDING` from reason codes in TypeScript sync mapping and PostgreSQL view query. | **RESOLVED** |
| **B-10** | Security | Authenticated users could spoof arbitrary `user_id` values in `issue_reports`. | Added strict RLS `WITH CHECK` and trigger `enforce_issue_report_user_id` forcing `NEW.user_id := auth.uid()`. | **RESOLVED** |

---

## 4. Comprehensive Acceptance Test Matrix (`INT-01` .. `INT-36`)

All 36 integration scenarios defined in the Consumer App Team's review are verified in `src/shared/utils/__tests__/wifran07aIntegrationAcceptance.test.ts`:

| Scenario ID | Test Domain | Verified Behavior | Status |
| :--- | :--- | :--- | :--- |
| **INT-01** | Security | `v_consumer_offers` enforces `WHERE o.status = 'published'` in `005` and `006`. | **PASSED** |
| **INT-02** | Sanitization | `build_sanitized_consumer_contract_v2` strips all workstation paths matching `^[A-Za-z]:[\\/]`. | **PASSED** |
| **INT-03** | RLS / Grants | Declares `security_invoker = false`, revokes base table access, and grants `v_consumer_offers`. | **PASSED** |
| **INT-04** | Security | Trigger `prevent_profile_privilege_escalation` blocks non-admin updates to `role`/`is_active`. | **PASSED** |
| **INT-05** | Security | `ALTER DEFAULT PRIVILEGES` revokes broad table/routine permissions from public roles. | **PASSED** |
| **INT-06, INT-07** | Migration | `002` has clean-init warning header; `006` migrates non-destructively without `TRUNCATE`. | **PASSED** |
| **INT-08** | Registry | 5 commercial regions and 25 cities have deterministic UUIDs, codes, and parent `region_id`. | **PASSED** |
| **INT-09** | Crosswalk | Authoritative `legacy_id_crosswalk` resolves old seed UUIDs to canonical IDs. | **PASSED** |
| **INT-10** | Function | `get_consumer_offers_for_shopping_date` RPC resolves national, city, and regional scopes. | **PASSED** |
| **INT-11** | Quantities | Mutton `J3` maintains `inner_pack_count: null` and `sale_unit: 'kg'` without forced count 1. | **PASSED** |
| **INT-12** | Contract | Legacy rows without `contract_v2` maintain `contract_version = null`. | **PASSED** |
| **INT-13** | Schema | Check constraint `chk_offers_inner_pack_count` validates `inner_pack_count IS NULL OR inner_pack_count > 0`. | **PASSED** |
| **INT-14** | Contract | `assessments.capabilities` and `structural_capabilities` alias are identically defined. | **PASSED** |
| **INT-15** | Gating | `J3` unresolved identity gates comparison (`needs_review`), fulfillment (`conditional`), and confidence (`medium`/`low`). | **PASSED** |
| **INT-16, INT-17**| Commodity | `J3` extracts domain meat attributes (`mutton`, `fresh`, `ethiopian`, `cuts`) and `fresh_mutton` tag. | **PASSED** |
| **INT-18** | Attributes | `J2` Mini Fan absent `model`, `power_watts`, `dimensions` are marked `unknown`, NOT `not_applicable`. | **PASSED** |
| **INT-19** | Pricing Math | Requesting 2 bars from 6-pack indivisible unit requires 1 pack (SAR 25.00, 6 supplied, 4 surplus). | **PASSED** |
| **INT-20** | Pricing Math | Purchasing 12 bars requires 2 packs for SAR 50.00 with 0 surplus units. | **PASSED** |
| **INT-21** | Commodity Math | Mutton divisible pricing calculates correctly (0.5kg -> 22.50, 0.75kg -> 33.75, 1.5kg -> 67.50, 2kg -> 90.00). | **PASSED** |
| **INT-22** | Pricing Terms| Loyalty conditions mapped without inventing nonexistent non-member price. | **PASSED** |
| **INT-23, INT-24**| Temporal | Correctly evaluates active on 2026-10-16, expired on 2026-10-28, upcoming on 2026-10-01 in Asia/Riyadh. | **PASSED** |
| **INT-25** | RPC Query | Shopping date RPC verifies `offer_start_date <= p_shopping_date AND offer_end_date >= p_shopping_date`. | **PASSED** |
| **INT-26** | Sanitization | Post-upload sample files contain ZERO local Windows paths (`F:\`, `\Work\`) anywhere in JSON. | **PASSED** |
| **INT-27** | Sync Integration| End-to-end sync workflow validates location scope and maps prepared offers to clean DB rows. | **PASSED** |
| **INT-28** | Sync | Replaying identical `(source_offer_id, semantic_checksum)` is a strict no-op. | **PASSED** |
| **INT-29** | Sync | Older revision rejection and price correction snapshot archival to `offer_revision_snapshots`. | **PASSED** |
| **INT-30** | Metadata | Superseded Tamimi `source_offer_id` is recorded in `supersedes_source_offer_id`. | **PASSED** |
| **INT-31** | Metadata | Dynamic sub-offer index produces distinct identifiers for compound cells (`:s01`, `:s02`). | **PASSED** |
| **INT-32** | Schema | `offer_revision_snapshots` table schema supports immutable revision history. | **PASSED** |
| **INT-33** | Consumer Adapter| `toConsumerOfferProjection` produces valid `ConsumerOfferDTO` across all benchmark offers. | **PASSED** |
| **INT-34** | Consumer Adapter| Unit price calculation accurately reflects price basis and sale unit. | **PASSED** |
| **INT-35** | Validation | Prepared offer schema and database insert objects satisfy all relational constraints. | **PASSED** |
| **INT-36** | Projection | Consumer DTO provides SAR currency and unit price calculations for `J3`. | **PASSED** |

---

## 5. Real PostgreSQL In-Process Verification Matrix (`@electric-sql/pglite`)

Verified in `src/shared/utils/__tests__/wifran07bPostgresFreezeVerification.test.ts` against PostgreSQL 16:

| Test ID | Domain | Verification Description | Result |
| :--- | :--- | :--- | :--- |
| **DB-NEW-01** | Schema | Executes migrations `001` -> `006` cleanly on an empty database. | **PASSED** |
| **CAT-01** | Registry | Confirms all 25 cities have identical 36-char canonical UUIDs matching `MASTER_CITIES` byte-for-byte. | **PASSED** |
| **DB-UPGRADE-01** | Migration | Seeded with 13 legacy regions and old city IDs, updates dependent rows in `offers`, `offer_sources`, `profiles`, `shopping_lists`, `supermarket_regions` to canonical IDs without foreign key violation or data loss. Re-running `006` is a clean idempotent no-op. | **PASSED** |
| **DB-INSERT-01..02** | Data Ingestion | Successfully inserts mapped benchmark offers `J1`, `J2`, and `J3` into `public.offers`. | **PASSED** |
| **PROJ-01** | View Security | Proves `status = 'needs_review'` returns 0 rows in `public.v_consumer_offers`. | **PASSED** |
| **PROJ-02** | View Output | When `status = 'published'`, queries 3 sanitized rows from `public.v_consumer_offers` with 0 local workstation paths. | **PASSED** |
| **MEDIA-01** | Reason Codes | Confirms `MEDIA_UPLOAD_PENDING` is stripped when media is uploaded. | **PASSED** |
| **PROJ-03..04** | DTO Parity | Generates 3 synchronized artifacts per benchmark offer (`*.post-upload-db-row.json`, `*.sql-consumer-view-row.json`, `*.consumer-projection-dto.json`) with identical values. | **PASSED** |
| **SCOPE-01..02** | Location RPC | Queries `get_consumer_offers_for_shopping_date` for Jeddah (returns national, Western region, and Jeddah city offers) vs Riyadh (returns only national offer). | **PASSED** |
| **SEC-HIST-01..03** | RLS / Grants | Direct access to `offer_revision_snapshots` fails with `permission denied` for `anon` and `authenticated`; RPC `get_offer_revision_history_summary` succeeds with sanitized fields. | **PASSED** |
| **SEC-REPORT-01** | Data Integrity | Inserting into `issue_reports` with spoofed `user_id` is blocked or forced to `auth.uid()`. | **PASSED** |

---

## 6. Verification & Test Execution Results

```text
✓ npm run typecheck
  tsc --noEmit -p tsconfig.node.json -> 0 errors
  tsc --noEmit -p tsconfig.web.json  -> 0 errors

✓ npx vitest run
  - src/shared/utils/__tests__/wifran07bPostgresFreezeVerification.test.ts (11/11 passed)
  - src/shared/utils/__tests__/wifran07aIntegrationAcceptance.test.ts      (33/33 passed)
  - src/shared/utils/__tests__/wifran04ContractUpgrade.test.ts            (32/32 passed)
  Test Files: 3 passed (3)
  Tests:      76 passed (76)
  Duration:   ~1.8s

✓ npm test (Typecheck + Fixtures Validation + Smoke Regression Suite)
  typecheck:          passed (0 errors)
  validate:fixtures:  11 passed, 0 failed
  test:smoke:         14 passed, 0 failed
  Exit Code:          0 (Clean Pass)
```
