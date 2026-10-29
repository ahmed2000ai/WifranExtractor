# Wifran - Extractor Integration Freeze Verification and Remaining Blockers

**Document ID:** WIFRAN-07B  
**Version:** 0.1  
**Prepared:** 28 October 2026  
**Intended project location:** `Wifran/Docs/`  
**Audience:** Wifran product owner, extractor/database team, consumer-app implementation agent  
**Status:** Integration verification review - **NOT YET APPROVED FOR FINAL FREEZE**

---

# 1. Executive decision

The WIFRAN-07A response package is a substantial improvement and resolves most of the architectural concerns raised in WIFRAN-07A.

The following areas are now directionally correct and should be retained:

- strict `status = 'published'` filtering for the public consumer view;
- sanitized consumer contract projection rather than exposing raw `contract_v2`;
- tighter base-table grants and profile privilege protection;
- one authoritative commercial-region/city registry and a legacy crosswalk;
- nullable `inner_pack_count` for measured-weight goods;
- identity-gated comparison and automatic-fulfillment capabilities;
- domain-aware sparse attributes for appliances and fresh meat;
- dynamic sub-offer IDs and revision snapshots;
- separate offer-card and thumbnail assets;
- clean post-upload storage paths rather than workstation paths.

However, the integration boundary **should not be frozen yet**.

The supplied package still contains several implementation inconsistencies that can affect clean installation, populated-database migration, national offers, actual database inserts, public history exposure, and the definition of the consumer-facing DTO.

The remaining work is focused. It does **not** require redesigning the extractor or Wifran consumer application.

---

# 2. Verification scope

This review examined the supplied:

- `EXTRACTOR_TO_WIFRAN_HANDOFF.md`
- `EXTRACTOR_CONTRACT_UPGRADE_REPORT.md`
- `001_seed_core_catalog.sql`
- `002_migrate_identifiers_to_codes.sql`
- `005_wifran_v2_offer_contract.sql`
- `006_wifran_07a_security_and_contract_reconciliation.sql`
- `extractorContractV2.ts`
- `extractorContractV2Adapter.ts`
- `offerSyncMapper.ts`
- `wifran07aIntegrationAcceptance.test.ts`
- J1, J2 and J3 pre-upload v2 fixtures
- J1, J2 and J3 post-upload DB-row samples
- J1, J2 and J3 consumer DTO samples

The supplied engineering report states 32/32 WIFRAN-04 tests plus 28/28 WIFRAN-07A tests, for 60/60 total.

This review did **not** rerun the full repository test suite or execute the SQL against the team's Supabase instance. Static source review, JSON parsing, cross-file consistency checks, and contract-level checks were performed from the supplied package.

The final freeze therefore requires database-executed integration evidence, not only source-pattern assertions.

---

# 3. Findings that appear successfully resolved

## R-01 - Published-only consumer access

`v_consumer_offers` now contains:

```sql
WHERE o.status = 'published'
```

This is the correct baseline. Draft, `needs_review`, rejected and other non-published records must not appear through the public consumer view.

**Status:** Resolved in design/source.

## R-02 - Consumer contract sanitization

The SQL no longer returns raw `o.contract_v2` directly. It uses:

```sql
public.build_sanitized_consumer_contract_v2(o.contract_v2)
```

and the sanitizer builds an allowlisted consumer contract while removing `local_path_internal` and rejecting workstation-style storage paths.

**Status:** Resolved in design/source.

## R-03 - Base-table privilege hardening

Migration 006 revokes broad write privileges from `anon` and `authenticated`, narrows catalog access to `SELECT`, restricts profile-update columns, and adds a privilege-escalation trigger.

**Status:** Substantially resolved, subject to the historical-snapshot finding below.

## R-04 - Geography registry

The new registry consistently defines:

- 5 commercial leaflet regions;
- 25 cities;
- 4-letter codes;
- parent commercial region for every city;
- a legacy-to-canonical crosswalk.

**Status:** Correct direction, but one clean-seed inconsistency remains in Finding B-08.

## R-05 - Measured-weight semantics

J3 now correctly supports:

```text
sale_unit = kg
inner_count = null
is_indivisible_sale_unit = false
```

and the DB column is nullable.

**Status:** Resolved.

## R-06 - Identity gating

For unresolved identities, the new adapter no longer permits `exact_product_comparison = supported` or `automatic_list_fulfillment = supported`.

J3 correctly becomes:

```text
exact_product_comparison = needs_review
automatic_list_fulfillment = conditional
```

**Status:** Resolved.

## R-07 - Domain-aware attributes

J2 correctly treats unknown appliance properties such as model, wattage and dimensions as `unknown`, rather than `not_applicable`.

J3 now exposes useful source-derived attributes such as mutton, fresh, Ethiopian, cuts, and unknown bone status.

**Status:** Resolved.

---

# 4. Remaining freeze blockers

## B-01 - Migration 005 is not independently executable in a clean 001 -> 006 sequence

**Severity:** Critical  
**Area:** Clean installation / migration ordering

The updated `005_wifran_v2_offer_contract.sql` creates `v_consumer_offers` and calls:

```sql
public.build_sanitized_consumer_contract_v2(o.contract_v2)
```

But that function is created only later in migration 006.

Therefore, a clean database applying migrations in normal order:

```text
001 -> 002 -> 003 -> 004 -> 005 -> 006
```

can reach migration 005 before the sanitizer exists.

There is a second clean-schema problem: the 005/006 view references:

```sql
o.currency
```

but the supplied original `offers` schema does not define `currency`, and migration 005 does not add it.

### Required correction

Choose one clean migration strategy and test it from an empty database. For example:

**Option A - preferred**
- Add any required consumer-view prerequisite columns/functions before creating the view in 005.
- Let 006 alter/re-harden the same view.

**Option B**
- Do not create the hardened final view in 005.
- Create only the v2 columns in 005.
- Create the sanitizer and final consumer view in 006.

For Saudi-only v1, using a literal:

```sql
'SAR'::text AS currency
```

is also acceptable if a persisted `currency` column is not needed yet.

### Required test

`DB-NEW-01` - Start from an empty PostgreSQL/Supabase schema and execute the documented migration sequence in order without pre-existing helper functions or ad-hoc columns.

---

## B-02 - The populated-database remap order can fail on foreign keys

**Severity:** Critical  
**Area:** Non-destructive migration 006

Migration 006 claims to be safe on populated databases.

However, it first upserts canonical regions/cities using:

```sql
ON CONFLICT (slug) DO UPDATE SET
  id = excluded.id,
  ...
```

and only afterward remaps dependent tables from legacy IDs to canonical IDs.

The original foreign keys reference `cities(id)` and `regions(id)` without `ON UPDATE CASCADE`.

If a legacy city row such as Jeddah already exists and is referenced by offers, profiles, lists, sources or mappings, changing the parent primary-key value before updating those child rows can violate the existing foreign-key constraints.

### Required correction

Do not depend on updating the referenced parent primary key before child rows have been safely reconciled.

Use a tested migration sequence such as:

1. create/crosswalk canonical records without colliding with existing referenced slugs/IDs;
2. remap dependent rows transactionally;
3. reconcile/remove/rename legacy parent records;
4. recreate or validate uniqueness/foreign keys;
5. verify row counts and referential integrity.

If constraints must be temporarily changed, the migration must do so explicitly, transactionally, and with rollback/testing.

### Required test

`DB-UPGRADE-01` - Create a database with the legacy 13-region/old-city seed IDs and real dependent rows in:
- `offers`;
- `offer_sources`;
- `profiles`;
- `shopping_lists`;
- `supermarket_regions`.

Then execute migration 006 and prove:
- no FK error;
- no row loss;
- all references resolve to canonical IDs;
- the migration can be replayed safely.

A regex assertion that migration 006 contains no `TRUNCATE` is not sufficient evidence of a non-destructive populated upgrade.

---

## B-03 - `offer_revision_snapshots` should not be a public raw-history table

**Severity:** High  
**Area:** Security / historical data

Migration 006 creates:

```sql
public.offer_revision_snapshots
```

with:

```sql
snapshot_payload jsonb NOT NULL
```

and enables a policy:

```sql
CREATE POLICY "Allow public read offer revision snapshots"
FOR SELECT USING (true);
```

This is inconsistent with the architecture principle that ordinary clients receive sanitized public offer facts rather than unrestricted historical source snapshots.

There is an additional migration-order concern: the original schema granted broad default table privileges to `anon`/`authenticated`. Migration 006 creates `offer_revision_snapshots` before it changes the default privileges, and later only performs a generic revoke of write operations on all tables. That combination can leave `SELECT` available depending on the privileges already applied when the table was created.

### Required correction

Treat revision snapshots as internal/history data.

At minimum:

```sql
REVOKE ALL ON public.offer_revision_snapshots FROM anon, authenticated;
```

Remove the `USING (true)` public read policy.

If the consumer application needs historical offer explanations, expose a dedicated sanitized query/RPC/API that:
- returns only the historical fields required by the app;
- applies publication/suppression rules;
- never exposes raw/private/internal snapshot content.

### Required tests

- `SEC-HIST-01`: anon cannot `SELECT` the snapshot table directly.
- `SEC-HIST-02`: authenticated ordinary user cannot `SELECT` the snapshot table directly.
- `SEC-HIST-03`: the app's approved historical read path returns only sanitized fields.

---

## B-04 - National offers are rejected by `offerSyncMapper`

**Severity:** High  
**Area:** Offer ingestion

The mapper currently validates:

```ts
if (!prep.city_id && !prep.region_id)
  issues.push({ severity: 'error', code: 'MISSING_LOCATION', ... })
```

But a valid national offer intentionally has:

```text
location_scope = national
city_id = null
region_id = null
```

Therefore, the mapper can reject legitimate national promotions.

### Required correction

Validate geography by `location_scope`:

```text
national -> city_id null, region_id null
region   -> region_id required, city_id null
city     -> city_id required
```

Do not apply one unconditional "city or region required" rule.

### Required tests

- national offer;
- region offer;
- city offer;
- invalid national + city combination;
- invalid region without region_id;
- invalid city without city_id.

---

## B-05 - Mapper writes a field not present in the supplied offers schema

**Severity:** High  
**Area:** DB insert contract

`offerSyncMapper.ts` emits:

```ts
offer_source_id: prep.offer_source_id || input.sourceId || null
```

The supplied `public.offers` schema defines:

```text
source_id
```

but the provided migrations do not define `offer_source_id`.

If this payload is sent as a normal Supabase/PostgREST insert object, an unknown column can cause the insert to fail.

### Required correction

Either:

- remove `offer_source_id` from the DB insert payload and use the existing `source_id`; or
- intentionally add and document a new DB column, with a clear distinction from `source_id`.

Do not keep two names accidentally.

### Required test

`DB-INSERT-01` - Run the actual mapped payload for J1/J2/J3 against the migrated staging table, not just an in-memory mapper assertion.

---

## B-06 - Hard-coded zero UUID for `created_by` may violate the FK

**Severity:** High  
**Area:** DB insert contract / authorship

The mapper emits:

```ts
created_by: '00000000-0000-0000-0000-000000000000'
```

The original schema defines:

```sql
created_by uuid references public.profiles(id)
```

No supplied migration or seed demonstrates that a profile/auth user with the zero UUID exists.

If it does not exist, the insert can fail its foreign key.

### Required correction

Use one of these explicit approaches:

- `created_by = null` for system/extractor-created offers; or
- a real dedicated system principal whose identity is correctly created and documented; or
- separate `ingestion_actor` / service metadata that is not incorrectly represented as an end-user profile FK.

### Required test

`DB-INSERT-02` - Insert a real extractor-generated offer into staging and verify no authorship FK failure.

---

## B-07 - The supplied "consumer-view DTO" is not the output of the supplied SQL view

**Severity:** High  
**Area:** Contract authority / samples

The post-upload DB-row samples have:

```text
status = needs_review
```

while the SQL view requires:

```sql
WHERE o.status = 'published'
```

Such rows cannot be returned by the public SQL view in that state.

The files named `*.consumer-view-dto.json` are therefore not literal query results from `public.v_consumer_offers`.

There are also shape/value differences. For example, J1's DB-row sample has:

```text
is_loyalty_required = false
loyalty_requirement = required
normalized_title_en = null
```

while the J1 consumer DTO contains:

```text
is_loyalty_required = true
normalized_title_en = "Dove Soap 5+1 Asstd."
```

The DTO also uses application names such as `valid_from`, `valid_to`, `sale_unit`, `inner_count`, `assessments`, etc., whereas the SQL view exposes DB/view column names such as `offer_start_date`, `offer_end_date`, `sale_unit_type`, `inner_pack_count`, `scoped_assessments`, etc.

This is not inherently wrong. It means there are **two projections**:

1. SQL consumer view;
2. TypeScript/app consumer DTO.

They must not be presented as the same artifact.

### Required correction

Choose and document the boundary explicitly.

Recommended:

```text
v_consumer_offers
    -> Wifran backend/adapter
    -> ConsumerOfferDTO
    -> UI
```

Rename the sample files to something like:

```text
*.consumer-projection-dto.json
```

unless they are generated from an actual SQL query.

Also provide actual query-result fixtures from the hardened SQL view after:
1. inserting the sample;
2. publishing it;
3. querying it as `anon` and/or the intended consumer role.

### Required tests

- `PROJ-01`: DB row is `needs_review` -> public view returns zero rows.
- `PROJ-02`: same row published -> public view returns exactly one sanitized row.
- `PROJ-03`: map that SQL-view row into `ConsumerOfferDTO`.
- `PROJ-04`: DTO values can be traced to either SQL-view columns or deterministic adapter logic.

---

## B-08 - Clean seed IDs for cities 10-25 do not match the canonical registry

**Severity:** Medium/High  
**Area:** Master catalog consistency

The updated `001_seed_core_catalog.sql` uses correct canonical IDs for cities 1-9, but cities 10-25 have shorter final ID segments.

Example in the seed:

```text
a6f7b140-0010-4444-a000-00000000010
```

The canonical ID used by migration 006/crosswalk is:

```text
a6f7b140-0010-4444-a000-000000000010
```

Because the DB columns are text, the shorter value can still be stored. But it is a different identifier.

This breaks the stated guarantee that master identifiers are deterministic and consistent across clean installs, upgraded installations, fixtures and application code.

### Required correction

Correct cities 10-25 in `001_seed_core_catalog.sql` so they exactly match:
- migration 006;
- `MASTER_CITIES`;
- the handoff document;
- the crosswalk;
- consumer fixtures.

### Required test

`CAT-01` - Parse the seed registry and programmatic `MASTER_CITIES` registry and assert exact ID/code/slug/region parity for all 25 cities.

---

## B-09 - Upload-complete samples still advertise `MEDIA_UPLOAD_PENDING`

**Severity:** Medium  
**Area:** Reason-code lifecycle

The post-upload samples contain:
- valid public image URL;
- valid thumbnail URL;
- `upload_state = uploaded`;

but their consumer-visible `reason_codes` still include:

```text
MEDIA_UPLOAD_PENDING
```

That state is contradictory.

The reason code is created before upload because `canonical.image.image_url` is initially absent, but it is not reconciled when the upload succeeds.

### Required correction

Distinguish immutable extraction observations from current operational state.

Recommended:

- remove transient `MEDIA_UPLOAD_PENDING` from current consumer reason codes after successful upload; or
- keep it only in historical extraction diagnostics and expose a separate current media-state reason set.

The UI must not be told that media is both uploaded and pending.

### Required test

`MEDIA-01` - after successful card + thumbnail upload, current consumer DTO contains no `MEDIA_UPLOAD_PENDING`.

---

## B-10 - `issue_reports.user_id` can be caller-supplied

**Severity:** Medium  
**Area:** Data integrity / user attribution

Migration 006 grants public insert permission on:

```text
offer_id, user_id, issue_type, comment, reporter_email
```

but the insert policy only checks:

```text
status = 'open'
admin_notes IS NULL
```

It does not require the inserted `user_id` to equal `auth.uid()`.

This can allow an authenticated caller to submit a report attributed to a different user UUID if one is known.

### Required correction

Preferred:

- do not grant direct insert access to `user_id`;
- set user identity on the server/RPC from `auth.uid()`.

Alternative policy:

```text
authenticated: user_id = auth.uid()
anon: user_id IS NULL
```

Do not trust caller-supplied identity attribution.

### Required test

`SEC-REPORT-01` - authenticated user A cannot insert a report with user B's ID.

---

# 5. Test-suite gap

The supplied test suite is useful, but many of the security/migration assertions inspect source text rather than run the database behavior.

Examples include assertions that:
- the SQL text contains `WHERE o.status = 'published'`;
- a revoke statement exists;
- migration 006 does not contain `TRUNCATE`;
- a function name exists.

Those checks are valuable as regression guards, but they do not prove:
- a clean migration succeeds;
- a populated upgrade succeeds;
- FK remapping succeeds;
- actual RLS/grants behave as intended;
- the consumer view returns the supplied DTO;
- national offers can be inserted;
- snapshot history is private;
- the sync mapper payload matches the real table;
- out-of-order revision logic behaves correctly in the database/service.

The supplied acceptance source also does not contain explicitly named test cases for `INT-27`, `INT-29`, `INT-33`, `INT-34`, or `INT-35`.

This does not invalidate the 60 passing test cases reported by the team. It means **60 passing code-level tests are not yet equivalent to an executed staging integration sign-off**.

---

# 6. Required final freeze test pack

Before declaring the extractor-to-Wifran boundary frozen, run the following against an ephemeral/staging PostgreSQL/Supabase database.

## A. Clean initialization

1. Apply documented migrations from zero.
2. Seed catalog.
3. Assert all 25 city identifiers match the master registry.
4. Insert J1/J2/J3 through the real sync path.
5. Publish test records.
6. Query public consumer view.

## B. Populated upgrade

Start with legacy IDs and dependent data.

Run 005/006 upgrade and verify:
- zero row loss;
- zero FK violation;
- canonical references correct;
- replay is safe.

## C. Access tests

As `anon`:
- can read only published consumer offers;
- cannot read draft/needs-review offers;
- cannot directly read base offers;
- cannot directly read revision snapshots;
- cannot alter catalog/profile privilege fields.

As ordinary authenticated user:
- same public-offer restrictions;
- only own safe profile fields editable;
- cannot impersonate another issue-report user.

## D. Offer-scope tests

Sync one:
- national offer;
- region offer;
- city offer.

Verify each appears only in correct geographic planned-shopping queries.

## E. Projection consistency

For J1/J2/J3:

```text
canonical -> mapped insert -> actual DB row -> published SQL-view row -> ConsumerOfferDTO
```

Every consumer DTO field must have a documented origin or deterministic transformation.

## F. Revision tests

Execute, rather than merely inspect:
- identical replay;
- later semantic revision;
- older out-of-order revision;
- snapshot archival;
- superseded source ID.

## G. Media tests

After successful upload:
- both image assets resolve;
- no workstation path survives;
- no current `MEDIA_UPLOAD_PENDING` reason survives;
- subject scopes remain correct.

---

# 7. Freeze criteria

The extractor-to-Wifran boundary can be frozen when:

1. B-01 through B-10 are resolved or explicitly rejected with technical justification.
2. Clean-install migration executes successfully.
3. Populated legacy upgrade executes successfully.
4. A national offer syncs successfully.
5. J1/J2/J3 insert through the real DB path.
6. Actual published SQL-view outputs are supplied.
7. Public snapshot access is closed.
8. transient media reason codes are coherent.
9. master city IDs are identical across every registry.
10. the final staging integration test pack passes.

At that point, the following should be treated as frozen inputs to the Wifran consumer application:

- contract version;
- canonical registry identifiers;
- view/RPC schema;
- offer capability semantics;
- reason-code semantics;
- revision semantics;
- media roles;
- geographic rules;
- exact published sample fixtures.

---

# 8. Impact on Wifran consumer application

No product-design change is required.

WIFRAN-01 through WIFRAN-07 remain directionally valid.

The remaining issues affect **integration correctness**, not:
- navigation;
- visual design;
- smart-list concept;
- household model;
- comparison philosophy;
- list behavior;
- shopping mode.

The app team may continue building:
- responsive components;
- local list model;
- Smart List Import;
- candidate matching;
- offer cards using fixture adapters;
- unit/pack/weight controls;
- household/list interfaces.

However, production integration should not bind permanently to the SQL view/DTO contract until the final freeze corrections are complete.

---

# 9. Recommended response to the extractor/database team

Thank you for the WIFRAN-07A reconciliation package. The majority of the original findings are now addressed correctly, and the contract is much closer to being ready for final freeze.

During final cross-file verification, we identified a smaller set of remaining integration issues that are not currently covered by the supplied acceptance tests. These primarily concern clean migration ordering, populated-database FK remapping, national-offer syncing, DB insert field compatibility, historical snapshot permissions, and consistency between the SQL consumer view and the supplied consumer DTO fixtures.

Please review the attached **WIFRAN-07B - Extractor Integration Freeze Verification and Remaining Blockers** and address the listed B-01 through B-10 items.

The objective is not another redesign. Once these focused items and the database-executed freeze tests pass, we should be able to formally freeze the extractor-to-Wifran boundary and proceed with consumer-app implementation against it.

Please return:
- updated affected files only;
- actual clean-install and populated-upgrade execution results;
- actual SQL consumer-view outputs for the published J1/J2/J3 fixtures;
- national/region/city sync results;
- the final integration test report.

---

# 10. Final principle

> The boundary is ready to freeze only when the same offer can travel from extraction to real database insert to published consumer query without hidden assumptions, migration failures, stale states, or a second contradictory projection.
