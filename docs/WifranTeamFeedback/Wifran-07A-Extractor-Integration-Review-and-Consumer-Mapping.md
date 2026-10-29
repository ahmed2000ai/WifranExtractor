# Wifran - Extractor Integration Review and Consumer Mapping

**Document ID:** WIFRAN-07A  
**Version:** 0.1 - package review and integration acceptance addendum  
**Prepared:** 28 October 2026  
**Intended location:** `Wifran/Docs/`  
**Audience:** Product owner, extractor team, database maintainer, consumer-app implementation agent, and test agent.  
**Status:** Source-grounded static review. Mapping and controlled development can proceed; direct public database access and automatic exact matching are not accepted as production-ready by this review.  
**Companion:** [WIFRAN-07 - App Architecture, Database and API Contracts](Wifran-07-App-Architecture-Database-and-API-Contracts.md).

> **Decision:** Retain Wifran's architecture and user experience. Reuse the delivered offer database through an adapter, but first reconcile the supplied registry/migration contradictions and harden the public access boundary. Producer capability labels are inputs to consumer validation, not permission to skip it.

## Reading guide

- Sections 1-3: What was inspected, what improved, and the prioritized findings.
- Sections 4-8: Required security, registry, contract, quantity, and lifecycle corrections.
- Sections 9-12: Concrete consumer mapping, application database extensions, and UI implications.
- Sections 13-16: Team handoff, staging acceptance tests, actual checks performed, and next steps.
- Appendices: Read-only inspection queries, forwardable work request, and source references.

## 1. Review basis and limitations

The owner supplied an integration package from `wifran-offers-extractor` and asked for review and mapping to the consumer architecture. This document compares that package with D07 and the earlier requirements. It does not assume the attachments are an exact dump of a deployed database.

### 1.1 Package inventory

| Ref | Supplied artifact | Role |
|---|---|---|
| P01 | `EXTRACTOR_TO_WIFRAN_HANDOFF.md` | Claimed contract, registry, view, and consumer rules |
| P02 | `EXTRACTOR_CONTRACT_UPGRADE_REPORT.md` | Reported implementation and engineering test results |
| P03 | `001_initial_schema(3).sql` | Base tables, relationships, policies, views, and privileges |
| P04 | `001_seed_core_catalog(2).sql` | SQL seed registry and units |
| P05 | `002_migrate_identifiers_to_codes.sql` | Historical identifier migration with destructive statements |
| P06 | `003_offer_location_scope(2).sql` | National/region/city applicability rules |
| P07 | `004_offer_image_ingestion_metadata(2).sql` | Source and image ingestion fields |
| P08 | `005_wifran_v2_offer_contract.sql` | Additive v2 columns, indexes, and consumer view |
| J1V2 | `J1-dove-soap.v2.json` | Remapped assorted soap, pack price, loyalty and bonus wording |
| J2V2 | `J2-mini-fan.v2.json` | Remapped assorted fan, unresolved brand/model, comparison restriction |
| J3V2 | `page-002-002.canonical.json` | Fresh Ethiopian mutton, measured-weight pricing |

The prior D07 architecture and unchanged original J1/J2 files were also available. File suffixes such as `(3)` and `(2)` are attachment filenames, not evidence of database migration versions.

### 1.2 Evidence categories

**Observed:** Contents of supplied SQL, Markdown, and JSON; local JSON parsing; sample-to-seed identifier comparisons; exact-decimal arithmetic; original fixture byte checksums.

**Reported by the team:** Type checking, 32 passing contract tests, smoke tests, runtime seeding, guarded entity matching, revision synchronization, path sanitization, and image uploading. These claims are recorded in P02, but their source modules and executable test suite were not included for independent execution here.

**Not verified:** Live PostgreSQL version, deployed migrations/grants/view ownership, Data API configuration, runtime registry contents, uploader behavior, post-upload rows, storage policies, source images, OCR truth, query performance, or production access.

**Recommendations:** Consumer mapping rules, proposed corrections, acceptance gates, app-owned extensions, and new test cases below. Do not treat these recommendations as changes already applied.

No SQL was executed, no production connection was made, and no original document, sample, or migration was modified. Official PostgreSQL/Supabase documentation was consulted only to verify database security semantics; it does not verify this project's deployment. See T01-T05.

### 1.3 Document authority

D01-D06A retain product and visual authority. D07 remains the main architecture. D07A fills in actual supplied paths and exposes discrepancies; it does not silently approve every claim in the handoff or close open product decisions.

Use supplied code/SQL to establish what an artifact actually declares, documents to establish intended meaning, and staging evidence to establish runtime behavior. Preserve disagreements rather than guessing which attachment reflects production.

**WIFRAN-08 remains the next numbered implementation-and-tests document.** This review is an architecture companion, not a replacement or renumbering of that plan.

## 2. What the upgrade already makes concrete

All three supplied v2 JSON files parse and contain the ten advertised contract sections. They retain bilingual titles and legacy fields while adding identity, assortment, quantity, price-role, eligibility, assessment, and asset structures. [J1V2/J2V2/J3V2: `schema_version`, `contract_v2`]

Useful improvements include:

| Improvement | Evidence and consumer use |
|---|---|
| Page-scoped source identity | Three samples have distinct IDs; page 1 item 012 and page 3 item 012 do not collide in this set |
| Explicit unresolved identity | All three retain `exact_identity_status = unresolved` and null verified product IDs; no fabricated SKU is necessary for browsing |
| Assortment handling | Soap preserves its flag conflict; fan retains an unenumerated assortment |
| Separate price roles | Decimal offer/reference prices; no invented current non-member price |
| Pack semantics | Soap retains six units and the already-included bonus; fan is priced each |
| Measured-weight semantics | Mutton uses `sale_unit = kg`, `inner_count = null`, and divisibility rather than a fictional one-kilogram pack |
| Eligibility coverage | Unknown loyalty is distinguished from an explicit required membership; channel uncertainty remains visible |
| Two image roles | Card and thumbnail assets are distinct, with pending upload state |
| Physical relational boundary | P08 identifies the actual `public.offers` extension and `public.v_consumer_offers` view |

This is enough to build typed adapters and fixture-driven screens now. It is not yet sufficient to approve an anonymous public read boundary or trust every capability flag.

**Master catalog terminology:** The delivered registry concerns configured supermarkets, cities, regions, categories, and units. It does not establish a complete verified product/SKU catalog, all Saudi retailers, nationwide current offer coverage, or stock availability. The JSON's null verified product IDs remain legitimate.

## 3. Integration decision and issue register

### 3.1 Work allowed to proceed

Proceed with local schema/adapter development, product cards, measured-weight input, generic needs, safe candidate previews, list persistence design, and responsive/Arabic UI tests using labeled fixtures. Preserve the source records and the reported completed extractor work.

Do not enable direct browser reads from the current view, unqualified exact-match automation, or a replay of the full attached migration chain on a populated database.

### 3.2 Findings and ownership

| ID | Finding | Gate / priority | Main owner |
|---|---|---|---|
| INT-F01 | Consumer view has no publication predicate, no declared invoker option, and anonymous grants | P0: before public exposure | Database maintainer |
| INT-F02 | Base profile self-update plus broad privileges allows privilege-escalation conditions in the supplied schema | P0: before user accounts/public access | Database/security maintainer |
| INT-F03 | Historical migration 002 truncates reference tables with CASCADE | P0: before any deployment/replay procedure | Database maintainer |
| INT-F04 | Handoff/sample location IDs and region taxonomy disagree with seed SQL | P1: before real location ingestion/filtering | Extractor + registry maintainer |
| INT-F05 | Nullable measured-item count conflicts with SQL NOT NULL; defaults can falsely label legacy rows | P1: before full v2 persistence | Extractor + database maintainer |
| INT-F06 | Exact/automatic capabilities are supported despite unresolved identity in the mutton sample | P1: before automatic matching/comparison | Extractor + consumer rules owner |
| INT-F07 | View passes complete contract JSON; samples contain nested workstation paths | P0 for public data; post-upload leak not proven | Database + uploader + API owner |
| INT-F08 | Handoff, sample, and flat-view contract differ in paths and available semantics | P1: before binding production validators | Extractor + app adapter owner |
| INT-F09 | Product-domain attributes and category mapping need refinements | P1 for affected matching; discovery can continue | Normalizer/catalog + app owner |
| INT-F10 | Uploaded public media references are not demonstrated by these pre-upload samples | Acceptance evidence gap, not proof of upload failure | Uploader/storage owner |
| INT-F11 | Revision counters do not demonstrate retained snapshots, source remap reconciliation, or sub-offer splitting | P1: before durable selections and sync | Extractor/importer + app owner |
| INT-F12 | Today-based lifecycle, base RLS dates, and planned-shopping-date semantics need one access policy | P1: before production date filtering | Database + app API owner |

P0 means a release/deployment blocker for the stated path, not evidence that the system has already been exploited. P1 means the affected integration/automation needs resolution; it should not prevent unrelated fixture-based app work.

## 4. Public access and privilege hardening

### 4.1 INT-F01: the consumer view is not proven public-safe

P08 creates `public.v_consumer_offers` with a plain `CREATE OR REPLACE VIEW`, joins catalog tables, and grants `SELECT` to `anon` and `authenticated`. It has no `WHERE o.status = 'published'` predicate and no declared `security_invoker` option. It exposes ingestion status and computes a date-only temporal label, but computation is not filtering. [P08: consumer-view definition and final grants]

P01/P02 recommend filtering only `temporal_lifecycle_state = 'active'`. A draft, rejected, or needs-review row can have active dates. Such a client filter is not a publication authorization rule.

PostgreSQL ordinarily checks underlying view relations using the view owner's permissions/policies. With a privileged owner, table RLS must not be assumed to protect view readers. `security_invoker` changes that behavior on supporting versions; its use also requires the caller's necessary base-relation permissions. [T01, T02]

**Required outcome:** Public access cannot reveal unpublished, rejected, suppressed, or private/internal data, whether a caller uses the intended app route, the Data API, an old view, or another granted interface.

Recommended first integration path, retaining D07:

```text
Extractor-managed offers and internal contract data
    -> restricted, verified database read interface
    -> Wifran API: publication/date/geography checks + allowlisted DTO
    -> responsive consumer UI
```

This is not a second offer database or a second extraction pipeline. It is a small verified boundary over the existing source of truth.

**An API wrapper alone is not the fix.** Existing anonymous/authenticated database routes and grants must also be restricted so that the wrapper cannot be bypassed.

The database team must choose and test a coherent strategy:

| Strategy | Requirements |
|---|---|
| Restricted server interface, recommended initial path | No ordinary-client access to internal view/base payloads; least-privilege server reads; explicit publication and context rules; public API serializes only allowed fields |
| Direct public view, only after hardening | Explicit safe fields and publication predicates; tested view owner/invoker behavior; adequate but limited base grants where invoker is used; RLS aligned with date policy; no raw payload path available elsewhere |

Do not add `security_invoker = true` and consider the task complete. It does not redact JSON, define publication rules, remove old grants, or repair the profile role issue.

Audit `public_active_offers` from P03 as well: it selects `*` from offers. Do not assume a previously created wildcard view includes every later-added column, but do inspect its actual definition and privileges. Base-table access can expose newly added fields independently of that view. [P03: public views and grants]

### 4.2 INT-F02: protect roles from profile self-service

The supplied schema places administrative authority in `profiles.role`. `public.is_admin()` trusts that value. The same file allows a user to update their own profile row, grants all table privileges to ordinary client roles, and does not show a column-level restriction or protective trigger for role changes. [P03: profiles, is_admin, profile policies, section 10]

**Static conclusion:** A user with an existing profile can satisfy the shown own-row policy while attempting to change a security-sensitive role. The supplied definitions do not prevent that change. Additional deployed protections may exist, but they were not supplied.

Remediation must protect at least `role`, security/activation fields, and any future membership/ownership authority. Use explicit editable-column grants or a narrow validated profile command; keep role administration on a separately authorized path. Adding the same `id = auth.uid()` WITH CHECK alone does not protect a different column such as `role`. Table-wide UPDATE grants must not remain as a bypass to column restrictions. [T03]

Also audit these base-schema surfaces:

- `GRANT ALL ON ALL TABLES/ROUTINES/SEQUENCES` and default grants to `anon`/`authenticated`.
- Public source/history reads that can include notes, actor identifiers, or administrative context.
- Unrestricted issue/event insertion, including fields for user IDs, admin notes, status, and resolution. Public reporting should not grant authority over those fields.
- Every existing SECURITY DEFINER routine, owner, search path, execute grant, and callable API path.

RLS and object privileges solve different problems. Whole-table operations such as TRUNCATE are not controlled by row policies; do not leave broad privileges on the assumption that RLS covers every operation. This is a SQL privilege risk, not a claim that the ordinary REST interface exposes a generic TRUNCATE endpoint. [T04, T05]

Correct creator-specific default privileges as well as current grants so future consumer tables are not automatically overexposed. Do this through an audited migration, not a blanket production command copied from this review.

### 4.3 INT-F07: distinguish private evidence from public facts

The P08 view returns the complete `o.contract_v2` and passes through `image_path` as `storage_path`. It performs no recursive JSON sanitization. All three supplied contracts contain workstation paths in both:

```text
contract_v2.assets.<role>.local_path_internal
contract_v2.assets.<role>.storage_object_path
```

The team reports a sanitizing sync mapper, but that code and a post-upload row were not supplied. The SQL itself therefore does not prove the handoff's assertion that the view strips internal paths. [P02: offerSyncMapper; P08: media/contract columns; J1V2/J2V2/J3V2: assets]

**Required split:** Retain a private full contract/evidence payload; expose a separately validated compact DTO. Omit the entire internal JSON from anonymous reads, or replace it with a documented, constructed allowlist. Do not rely on deleting one known key while passing every future key through.

Public output can retain supported product attributes, composition, purchase semantics, conditions/coverage, safe reason codes, validity, and verified asset delivery information. It must not retain raw source paths, arbitrary nested local paths, internal diagnostics, private notes, or model payloads.

A storage-object field must contain a genuine object key or null, not a Windows path disguised by the field name. Validate bucket/key and URL origin through the asset adapter. Do not fetch arbitrary local files or URLs supplied in untrusted metadata.

## 5. Registry and migration reconciliation

### 5.1 INT-F03: migration 002 is not a safe general upgrade step

P05 explicitly contains:

```sql
TRUNCATE TABLE public.supermarkets CASCADE;
TRUNCATE TABLE public.cities CASCADE;
TRUNCATE TABLE public.regions CASCADE;
```

It drops several foreign keys first, changes identifier types, and then restores constraints. Depending on installed dependencies and data, replay can remove dependent data or leave references that cannot be reattached. It is not a non-destructive reconciliation migration. [P05: steps 1-7]

P08 itself is additive, but that does not make the entire attached sequence safe to rerun. Do not execute 001-005 blindly, and do not rerun 002 on an existing populated database.

Deliver two documented paths: a clean disposable initialization and an upgrade from the actual deployed migration state. Use a non-destructive ID crosswalk/backfill where needed, with backups, dry runs, constraint validation and rollback planning. Existing migrations should not be rewritten retroactively if already deployed; add an appropriately numbered corrective migration after checking both repositories' migration history.

### 5.2 INT-F04: concrete registry disagreements

| Entity | Handoff and v2 samples | Supplied seed SQL |
|---|---|---|
| Jeddah ID | `a6f7b140-0002-4444-a000-000000000002` | `a6f7b140-0002-4c28-98e3-c28dd6fb4fb4` |
| Regions | Five broad regions including `western` | Thirteen named administrative-style region records, including `makkah-region` |
| Sample region ID | `b144b6c8-2222-4444-b000-000000000002` | Not present in the seed's region IDs |
| City/retailer/region ID SQL types | Described as deterministic UUID identities and codes | Base schema stores these IDs as `text`; migration 002 also targets text |
| Four-letter codes | Documented external codes | No dedicated code columns appear in the supplied core table definitions |

Local inspection found 25 city rows, 13 region rows, 12 supermarket rows, 13 category rows, and 9 unit rows in the supplied seed. The three samples' supermarket IDs exist there; their city and region IDs do not. This is an attachment-level mismatch, not proof of what the runtime `ensureCoreCatalogSeeded()` has actually populated. [P01: registry; P03: core tables; P04: city/region inserts; sample trusted_context]

An upsert using `ON CONFLICT (slug) DO UPDATE` without updating ID can preserve an existing ID rather than force the documented one. Matching counts alone do not prove ID synchronization.

**Required resolution:** Publish one versioned authoritative registry and a non-destructive crosswalk from any existing IDs/codes. Do not silently replace the runtime registry with the seed or vice versa. The crosswalk must cover all dependent tables, not just offers.

A five-region commercial taxonomy is not automatically the same taxonomy as thirteen administrative regions. Choose explicit semantics and provide the city-to-region/coverage mapping. Do not equate `western` to one administrative region solely because both have a similar numeric prefix.

P03 cities have no direct region FK. P04 `supermarket_regions` seeds retailer mappings to Riyadh; that is not a complete, retailer-independent city-to-region authority. Supply the mapping needed to decide whether a region-scoped promotion applies to Jeddah or another selected city.

The app should load registry values and treat identifiers as opaque strings. Do not hardcode the listed UUIDs, derive geography from ID prefixes, or use display names as foreign keys. Four-letter codes and slugs are aliases only under a maintained mapping.

### 5.3 Source-offer identity is a different namespace

`source_offer_id` is a deterministic **text key**, not a UUID. `public.offers.id` is the database row UUID. Registry IDs are another namespace, even when their string values look like UUIDs. Keep all three meanings explicit.

The page component avoids the demonstrated same-item-number/different-page collision. It does not prove universal zero collisions. P01/P02's generator ends with a fixed `s01`; support for multiple sub-offers inside one cell, re-crops, or re-numbered exports still needs demonstrated behavior. Leaflet-ID uniqueness and producer scope also need a stated invariant. [P01: record_metadata; P02: buildSourceOfferId; P08: unique partial index]

The new J1/J2 outputs deliberately remap the old Tamimi/national context to Alwafa/Jeddah. That changes `leaflet_id` and `source_offer_id`. If old records were already ingested, a simple new-ID upsert can leave both versions visible. Require an audited correction/supersession mapping, not automatic deletion or a guessed title merge.

## 6. Contract corrections and consumer safety

### 6.1 INT-F05: preserve nullable counts and genuine unknowns

J3V2 correctly emits:

```json
{
  "sale_unit": "kg",
  "inner_count": null,
  "per_inner_content": {"value": 1, "unit": "kilogram"},
  "total_content": {"value": 1, "unit": "kilogram"},
  "is_indivisible_sale_unit": false
}
```

P08 declares `inner_pack_count integer NOT NULL DEFAULT 1`. Directly persisting the sample's null conflicts with that declaration. Replacing null with one avoids a database error but changes a measured-weight record into an invented discrete inner count. The sync mapper was not supplied, so this review does not assert which behavior currently occurs.

Recommended correction: allow null for an unknown/not-applicable inner count and validate positive integers when a count is supplied. Preserve measured-versus-countable semantics. If an existing mapper uses a sentinel, document and replace it without presenting that sentinel as a product fact.

P08 also gives every affected legacy row default values including the v2 version label, `sale_unit_type = pack`, `price_basis = each`, and inner count one. A version string supplied by a migration is not evidence that the row has a valid v2 payload. Keep a completeness/version-validation gate; treat null/malformed/mismatched `contract_v2` as legacy or incomplete, not upgraded truth.

Add runtime and appropriate database checks for positive source revisions, valid states, finite money/quantities, JSON shapes and quantity/price-basis relationships. Do not retroactively guess missing values just to pass a constraint.

### 6.2 INT-F06: capability support does not establish exact identity

J3V2 contains:

```text
product_facts.exact_identity_status       unresolved
product_facts.verified_product_id         null
assortment.status                        single_product
assessments.capabilities.exact_product_comparison      supported
assessments.capabilities.automatic_list_fulfillment    supported
assessments.confidence.identity_confidence             high
```

`Single_product` means the offer is not represented as an assortment. It does not establish equivalence to another store's exact product. Arithmetic readiness is also not fulfillment of a particular user's request.

Request a corrected definition or downgrade of the identity-dependent source capabilities. Preserve producer flags for diagnostics; compute effective consumer capabilities from identity evidence, needed attributes, user intent, quantity, applicable dates/location, eligibility, and approval.

A useful effective rule is:

```text
Effective permission = source structural readiness
                       AND consumer semantic prerequisites
                       AND runtime context/eligibility
                       AND any necessary user approval
```

This is logical conjunction, not a numeric confidence score. A source `supported` flag cannot override a contradiction. A source `blocked` legacy restriction cannot be silently re-enabled by the UI. Unknown and conditional assessments require named prerequisites.

The fan and soap also carry high identity-confidence labels while exact identity remains unresolved. Confidence may have an intended narrower scope, but that scope must be defined; do not display it as measured exact-match reliability.

### 6.3 Commodity matching must not require invented barcodes

Loose meat and produce do not need a fictional retail SKU to be useful. Permit source-backed commodity descriptions and user-approved selections. Cross-store comparisons can use an explicit comparable-specification policy or approved alternatives when the necessary properties are known; do not relabel them as verified identical SKUs.

For the mutton example, titles mention mutton, fresh, Ethiopian, and cuts. The v2 attribute dictionary does not structurally capture those distinctions. Recommend domain-relevant properties for species/product type, freshness, origin, and cut description **only where supported by the source text**. The exact cut, bone status, quality grade, and availability remain unestablished.

Do not add an OCR/model call per user to rediscover those reusable facts. Promote supported existing text during normalization with provenance. Until then, title-based retrieval may suggest the offer, but a required property needs a validated interpretation rather than an assumption.

A named-brand requirement is not necessary for a generic commodity request. Conversely, null brand is not evidence that any meat request is satisfied. A request for beef, frozen meat, a different origin, or a specific unconfirmed cut must remain distinguishable.

### 6.4 INT-F08: freeze the actual schema, not a mixture of names

| Concept | Handoff describes | Sample/SQL shows | Integration action |
|---|---|---|---|
| Capability container | `assessments.structural_capabilities` | JSON uses `assessments.capabilities`; SQL uses `scoped_assessments` | Supply final machine-readable schema and actual post-upload mapping; do not invent a silent universal fallback |
| Asset card scope | `offer_card.subject_scope = offer_card` | Sample uses `exact_product` or `representative_assortment` | Separate asset role from subject scope; freeze enums |
| Quantity count | Integer inner count | Measured sample legitimately uses null; SQL is NOT NULL | Correct nullable semantics across all layers |
| Conditions | Loyalty and limits summarized | Samples additionally use coverage and channel; flat view omits some of these | Expose safe structured eligibility explicitly, not only a boolean |
| Money | SAR decimal strings in contract | SQL numeric price and labels; no flat currency column in view | Validate contract currency or an explicit SAR-only contract invariant; serialize decimal text |
| Product linkage | Nullable verified product identity | SQL `product_id` plus unresolved status | Existing FK alone must not prove verified identity |

P02 lists TypeScript type and mapper modules, but the actual TypeScript definitions, JSON Schema, and mapper code are not in the package. They are needed to bind production validators and establish flat-column/JSON parity.

At minimum compare `source_offer_id`, revision, price/basis, quantity/count, assortment, attributes, loyalty, capability reasons, and asset state across canonical JSON -> uploader payload -> stored row -> view -> API DTO. A discrepancy creates a traced integration error, not arbitrary flat-field or JSON-field precedence.

New compatible enum/field changes need a documented version policy. Unsupported major versions or unrecognized required semantics must fail the affected operation conservatively.

### 6.5 INT-F09: unknown is not not-applicable

J2V2 marks model, power and dimensions `not_applicable`. For a mini fan these can be meaningful specifications even when absent from the leaflet. The safe state is unknown unless a specific property is genuinely inapplicable. This does not justify inventing any values. [J2V2: product_facts.attributes]

Use sparse domain-relevant attributes instead of forcing the same eight keys onto all categories. Avoid treating not-applicable as a positive match to a user who specifically requests that property.

The seed's thirteen categories have no explicit fruit/vegetable category. D01/D06A's Fresh navigation cannot be treated as a literal existing database category. Deliver a taxonomy mapping for fresh produce and broader display groups. This is a routing/mapping gap, not proof that the extractor cannot recognize produce. Do not classify all fresh food as meat or invent a canonical slug in production.

The units seed maps `pack` to a piece-based conversion of one. A pack is a purchase container; that registry factor must not be used as a universal one-pack-equals-one-inner-item conversion. Soap's six bars come from its offer-specific contents. Category default units are suggestions, not dimensional authority. [P04: unit seeds]

## 7. Measured-weight sample: expected Wifran behavior

### 7.1 What the supplied sample establishes

| Field | Value |
|---|---|
| Source reference | `alwafa-city-jeddah-2026-10-20:p002:i002:s01` |
| Title | Ethiopian Fresh Mutton Cuts Per KG |
| Advertised price | SAR 45.00 per kilogram |
| Source reference price | SAR 54.99; original-price evidence completeness is false |
| Sale unit | Kilogram; divisible |
| Inner count | Null, not one discrete piece |
| Exact identity | Unresolved; no verified product ID/GTIN |
| Assortment | Single-product record; not proof of exact cross-store equivalence |
| Eligibility | No loyalty restriction stated in inspected source; loyalty requirement/channel remain unknown |
| Dates | 14-20 October 2026 inclusive under the supplied date convention |
| Media | Two pre-upload assets; delivery URLs/buckets not supplied |

All supplied sample offers have ended by the review date, **28 October 2026**. New/remapped export does not mean newly valid promotion. Freeze 16 October 2026 for applicable-date fixture scenarios; preserve the original source dates.

### 7.2 Pricing illustration, not a current checkout promise

| Requested weight | Calculation at the source rate | Estimated amount |
|---|---|---:|
| 500 g | 0.5 kg x SAR 45.00/kg | SAR 22.50 |
| 750 g | 0.75 kg x SAR 45.00/kg | SAR 33.75 |
| 1.5 kg | 1.5 kg x SAR 45.00/kg | SAR 67.50 |
| 2 kg | 2 kg x SAR 45.00/kg | SAR 90.00 |

The rate also equals SAR 4.50/100 g. These amounts were checked with decimal arithmetic. They assume the advertised rate applies to the chosen purchase and historical test context; final weighed quantity, availability, and applicable retailer terms are not verified here.

**UI behavior:** Show SAR 45.00/kg prominently, not SAR 45.00 for a fabricated pack. Ask for/edit weight in kg/g, allow supported fractional quantities, and label the amount as an estimate. Never show zero item counts or force integer kilograms because a pack control was reused.

**Matching behavior:** A user asking for 1.5 kg fresh Ethiopian mutton can see a relevant candidate with supported textual evidence and an editable choice. It must not receive a blanket verified-SKU badge merely from `single_product`. A request for a specific unconfirmed cut needs that missing fact resolved or an explicitly approved alternative.

**Image behavior:** A non-assorted image may illustrate the offer without establishing a canonical exact SKU. Do not derive identity from the asset's `exact_product` label.

**Reference-price behavior:** Keep SAR 54.99 in its declared source-reference role. The incomplete evidence flag should follow the validation/display policy; it is not proof that the number is wrong. Never call it a verified current non-member price or report its difference as realized household savings.

## 8. Lifecycle, images, and revisions

### 8.1 INT-F12: evaluate the chosen shopping date

P08's `temporal_lifecycle_state` evaluates today's Riyadh date. That is useful for today's discovery, but does not answer whether an offer applies on a user-selected future shopping date. P03's public offer RLS uses session `current_date`, which may differ around timezone boundaries unless configured consistently.

The consumer query must separate:

```text
Publication/disposition allowed?
Selected geography/channel applicable?
Date interval includes the requested shopping date?
Required eligibility satisfied or explicitly conditional?
Requested operation supported?
```

Do not use only `temporal_lifecycle_state = active`. A published upcoming offer may be relevant to a future shopping date. An active-today offer may end before that date. Date changes invalidate previous comparisons.

Align view, RLS/API, historical public-link behavior, and planned-date queries. Enabling invoker security while retaining today-only base RLS can unintentionally hide future or expired-public-preview records. Resolve that policy deliberately; never bypass RLS with a broad service key solely to work around an unexplained missing result.

Compute status at read/use time with cache expiry at the applicable Riyadh date boundary, and revalidate on plan approval. Do not mutate sample dates to make demos look current.

### 8.2 INT-F10: accept asset delivery with a post-upload test

Local paths and pending URLs are valid in a pre-upload export. No evidence here shows the uploader failing. The gap is that no stored public row/object response was supplied to validate image delivery and sanitization.

Require one real uploaded card and thumbnail pair, their durable bucket/object identity, independent role/subject scope, and an actual consumer-safe response. Public clients may receive approved delivery URLs rather than internal storage plumbing. Keep private/raw records separate.

Check missing thumbnail, delayed upload, retry/deduplication, replaced content under the same offer, expired signed URL, unapproved origins, and pending or failed assets. The UI uses a placeholder without inventing a photograph or dropping the need.

### 8.3 INT-F11: revisions and status history are not the same thing

P08 stores current `source_revision` and `semantic_checksum`; P03 has `offer_status_history`. Neither supplied SQL artifact defines immutable semantic offer-revision snapshots. Status transitions alone do not preserve a previous price, pack, eligibility, or title.

The team may maintain history elsewhere, but that is not demonstrated. D07 requires a retained approved snapshot or a reliable revision reference. Agree one owner for history and avoid parallel conflicting revision stores.

Required scenarios: unchanged replay is a no-op; later correction updates the same logical offer; older input cannot overwrite newer content; same ID/revision with different content is a conflict; upload retries do not create new semantic revisions; asset delivery state has a defined invalidation mechanism; old selections remain explainable; authoritative withdrawal is distinguishable from a missing row in a partial upload.

P03 status values do not include withdrawn/superseded. Map those concepts to an explicit implemented disposition/suppression mechanism rather than write invalid enum values. A historical product correction that changes retailer/source ID requires reconciliation as described in section 5.3.

## 9. Concrete integration map for WIFRAN-07

This is the initial source-to-consumer mapping supported by the files. It is not a claim that the sync mapper already performs every conversion correctly. The implementation agent should turn it into D07's `APP_INTEGRATION_MAP.md`, recording actual code paths and staging evidence without creating a second independently maintained specification.

### 9.1 Known physical entities: reuse, do not duplicate

| Actual supplied entity | D07 conceptual role | Integration decision |
|---|---|---|
| `public.supermarkets` | Retailer registry | Reuse after ID/crosswalk verification; load names/aliases dynamically |
| `public.cities`, `public.regions`, `public.supermarket_regions` | Geographic applicability | Reuse with an authoritative coverage taxonomy and city-region mapping; current retailer mapping is not sufficient alone |
| `public.categories`, `public.units` | Classification and dimensional normalization | Reuse supported values; add an explicit UI category mapping and prevent generic pack conversion |
| `public.brands`, `public.products`, `public.product_aliases` | Supported catalog references and search | Reuse conservatively; nullable product link is valid; `is_normalized` is not proof of verified exact identity |
| `public.offer_sources` | Internal source provenance | Preserve internally; expose only approved public source fields |
| `public.offers` plus P08 columns | Current offer records | Source of truth remains extractor/importer-owned; app reads through a validated boundary |
| `public.v_consumer_offers` | Candidate read projection | Reuse intent/schema where useful, but harden access and payload before public use |
| `public.offer_status_history` | Workflow-status audit | Not a substitute for immutable semantic revision snapshots |
| `public.import_batches`, `public.import_rows`, `public.validation_errors` | Extractor ingestion/review | Keep as internal extraction artifacts; do not reuse as private consumer AI drafts |
| `public.profiles` | Consumer profile | Reuse after role/grant hardening; select auth/bootstrap details through approved policy |
| `public.shopping_lists`, `public.shopping_list_items` | Existing simple list storage | Map and extend carefully; not yet the full household/need/selection model |
| `public.saved_offers`, `public.watched_items` | Saved references and explicit follows | Do not treat a follow as a purchase or automatically activate future target-price features |
| `public.issue_reports`, `public.app_events`, `public.audit_logs` | Reports/operational data | Reuse with restricted DTOs, insertion controls, privacy and access testing |

### 9.2 Field map: IDs, product facts and scope

| JSON source | Stored/view field in supplied SQL | Proposed app interpretation / validation |
|---|---|---|
| Not supplied by pre-upload sample | `offers.id` / view `id` | Stable database offer reference; never substitute source text for a UUID FK |
| `record_metadata.source_offer_id` | `source_offer_id` | Exact opaque producer key; preserve page/item/sub-item semantics |
| `record_metadata.source_revision` | `source_revision` | Positive source revision; serialize to D07 revision format; detect conflicting parity |
| `record_metadata.semantic_checksum` | `semantic_checksum` | Semantic change/integrity reference; not logical identity or proof of a valid record |
| `schema_version` / metadata version | `contract_version` | Runtime-valid contract version; default database label alone is insufficient |
| Raw compound group / producer metadata where supplied | `compound_group_id` | Parent visual grouping; does not identify each priced option or sub-offer |
| `trusted_context.supermarket_id` | `supermarket_id` + joined names/slug/logo | Resolve through actual registry; do not hardcode handoff IDs |
| `trusted_context.location_scope/city_id/region_id` | Same fields + joined names | National/region/city semantics; reject missing referenced IDs instead of dropping scope |
| `product.title_ar/title_en` | `title_ar/title_en` | Preserve supported source-facing descriptions; language fallback is display only |
| `product.normalized_title_ar/en` | `normalized_title_ar/en` | Search inputs, not unique SKU keys |
| `product_facts.exact_identity_status` | `exact_identity_status` | Identity evidence state, independent of assortment and source confidence |
| `product_facts.verified_product_id` | `product_id` when validated by mapper | Verify actual linkage; no fabricated product row required |
| `product_facts.brand_assertion` | `brand_state`, `brand_candidate_text`, joined brand fields | Separate confirmed assertion from a candidate; verify mapping to `brand_id` |
| `product_facts.attributes` | `product_attributes` | Typed facts with state/provenance; matching uses shared vocabulary and hard constraints |
| `product.category_hint` | `category_slug` / category FK | Versioned taxonomy mapping; compare explicit slug and FK for drift |
| `product.commodity_tag` / derived subtype | `commodity_tag`, `derived_subcategory_slug`, `item_domain` | Search/classification hints; neither category nor domain proves equivalence |
| `assortment.status/known_options` | `assortment_status`, `known_options` | Options, bundles and unresolved groups remain distinguishable |

### 9.3 Field map: quantity, prices, eligibility and media

| JSON source | Stored/view field | App rule |
|---|---|---|
| `quantity_semantics.sale_unit` | `sale_unit_type` | Sale-unit enum; `kg` activates measured-weight behavior, not a pack count |
| `quantity_semantics.inner_count` | `inner_pack_count` | Preserve null for measured/unknown cases; requires SQL correction or an equally explicit representation |
| `per_inner_content.value/unit` | `each_size_value/unit` | Source denominator; validate dimensions and applicability |
| `total_content.value/unit` | `total_content_value/unit` | Quantity supplied by the declared sale unit; avoid double multiplication |
| `is_indivisible_sale_unit` | Same name | Enforce whole sale units only where true; no hidden change of user quantity |
| `price_terms.source_reported_offer_price` | `offer_price` | Exact decimal amount tied to price basis and terms |
| `price_terms.currency` | No standalone currency projected | Verify SAR-only invariant or expose currency explicitly; never silently reinterpret another currency |
| `price_terms.source_reported_price_basis` | `price_basis` | Validate consistency with quantity semantics; define allowed pairs |
| `source_reported_original_price` | View `source_reported_original_price` from `original_price` | Reference price only; not actual savings or non-member fallback |
| `verified_current_non_member_price` | `verified_non_member_price` | Use only when separately supported; null remains null |
| Derived informational inner rate | `informational_inner_unit_price` | Comparison information only, not a purchasable fractional-pack charge |
| Derived numeric unit rates | Base `unit_price/unit_price_unit` not selected by P08 view | Derive through shared numeric logic or expose validated numeric rate/basis; do not parse formatted labels for math |
| `promotion_terms.mechanic/bonus_wording/bonus_fulfillment` | `promo_mechanic`, `bonus_wording`, `bonus_fulfillment` | Display terms; execute only modeled and evidenced rules |
| Bonus included flag / executable rule | Only nested contract in supplied view | Carry through a safe structured projection when needed; never double-count bonus |
| `eligibility.loyalty.requirement` | `loyalty_requirement` and legacy boolean | Typed state is central; conflicts restrict affected pricing until resolved |
| Loyalty program and restriction coverage | Nested contract only | Expose safe program/coverage state; do not invent retailer program names |
| `eligibility.sales_channel` | Nested contract only | Preserve unknown channel; do not assume online and in-store prices agree |
| `eligibility.quantity_limit` | `quantity_limit_value/unit/scope` plus legacy text | Preserve unknown scope; define fractional-weight limits if needed instead of truncating |
| `assessments.capabilities` | `scoped_assessments` | Actual mapper shape must be confirmed; treat as structural input, not final client permission |
| `assessments.reason_codes` | `reason_codes` | Stable, scoped reasons; do not infer final publication or user eligibility from an empty array |
| `assets.offer_card` | `image_url`, `storage_path`, internal bucket data | Detail-view asset after verified upload; reject local paths in public projection |
| `assets.product_thumbnail` | `thumbnail_url`, `thumbnail_storage_path` | Compact card/list asset after upload; preserve representative scope |
| Per-asset subject/upload state | One flat scope plus nested contract | Keep role-specific state/scope in DTO; a single flat field must not erase differences |
| `trusted_context` dates | `offer_start_date/end_date`, computed lifecycle | Inclusive source dates; today's label distinct from chosen-date applicability |
| Extractor publication quality | Actual DB `status` / view `ingestion_status` | Publication is an authorized workflow result, not inferred from JSON confidence |

Only explicitly allowed safe semantic fields should survive removal of the full contract. Redaction must not remove the coverage, quantity or promotion information the matching engine actually needs.

### 9.4 Illustrative adapter preview for the new sample

This is a proposed **fixture review object**, not a live API response or database insert. Null database ID and unknown publication deliberately represent missing post-upload evidence. D07's production OfferRef still requires an actual persisted identity.

```json
{
  "adapter_preview_version": "wifran.integration-review/1",
  "fixture_only": true,
  "database_offer_id": null,
  "source_offer_id": "alwafa-city-jeddah-2026-10-20:p002:i002:s01",
  "source_revision": "1",
  "title_en": "Ethiopian Fresh Mutton Cuts Per KG",
  "publication_state": "not_verified_from_database",
  "identity": {
    "status": "unresolved",
    "verified_product_id": null,
    "assortment_status": "single_product"
  },
  "quantity": {
    "mode": "measured_weight",
    "sale_unit": "kg",
    "inner_count": null,
    "indivisible": false
  },
  "price": {
    "amount": "45.00",
    "currency": "SAR",
    "basis": {"value": "1", "unit": "kg"},
    "reference_amount": "54.99",
    "verified_non_member_amount": null
  },
  "eligibility": {
    "loyalty_requirement": "unknown",
    "restriction_coverage": "not_stated_in_inspected_source",
    "sales_channel": "unknown"
  },
  "validity": {
    "start_date": "2026-10-14",
    "end_date": "2026-10-20",
    "timezone": "Asia/Riyadh",
    "evaluated_date": "2026-10-28",
    "temporal_state": "expired"
  },
  "media": {
    "offer_card": {"delivery_url": null, "state": "pending"},
    "product_thumbnail": {"delivery_url": null, "state": "pending"}
  },
  "review": {
    "exact_comparison_readiness": "needs_review",
    "automatic_fulfillment_readiness": "needs_review",
    "current_pricing_allowed": false,
    "reasons": [
      "SOURCE_CAPABILITY_IDENTITY_CONFLICT",
      "REGISTRY_RECONCILIATION_REQUIRED",
      "POST_UPLOAD_RECORD_NOT_VERIFIED",
      "OFFER_EXPIRED"
    ]
  }
}
```

New review reason names here are proposed app/adapter codes, not claimed extractor enum values. The original producer flags remain in the private source record; the preview does not rewrite them. Server-generated delivery URLs and actual database IDs must be populated from verified persisted data, never from the LLM.

### 9.5 Query rules

Use explicit selected columns and bounded pagination. Query with the intended geographic scope, not only `city_id = selected_city`, because national and applicable region promotions can also qualify.

Conceptually:

```text
publicly permitted publication/disposition
AND (national OR matching city OR an explicitly mapped applicable region)
AND source date interval includes requested shopping date
AND allowed retailer/channel context
AND no source suppression/conflict that blocks the requested operation
```

Parameterized implementation and authorization belong server-side. A user's selected city/date is context, not permission to read unpublished records. Public discovery can include honestly labeled conditional offers; a private shopper-specific eligibility evaluation remains separate.

Use trusted server/current-date computation for current claims. A client-adjusted date cannot convert an expired offer into a current published recommendation. Historical tests and authorized historical previews are separate contexts.

## 10. Map the existing list tables to the consumer database model

### 10.1 What already exists and can be reused

P03 provides personal `shopping_lists` and simple `shopping_list_items`, plus profiles, saved offers and watched items. These are useful starting points. They do not implement household spaces, conditional selections, parsed intent, plan approvals or revision-safe sync.

| Existing field/structure | Limitation against D02/D07 | Required treatment |
|---|---|---|
| `shopping_lists.user_id` | Single-user owner, not household membership | Add/map a space and membership model without implicitly sharing personal lists |
| `shopping_lists.city_id` | No shopping date/store/eligibility revision | Add explicit list context and revision handling |
| `shopping_list_items.custom_name` | Can preserve unmatched text | Retain as a need label; add typed intent/constraints/original provenance as needed |
| Item `offer_id/product_id` | Selection and need are conflated | Separate the stable need from its selected offer and approval snapshot |
| Item `quantity numeric NOT NULL DEFAULT 1` | Cannot distinguish unknown requested quantity from accepted UI default | Preserve legacy values with provenance; new intent supports explicit unknowns and dimensional structure |
| Item `is_checked` | Only checklist progress | Do not migrate it as verified purchase/payment; add trip outcomes separately |
| Unique `(shopping_list_id, offer_id)` index | Prevents separate needs referencing the same offer | Review when introducing selections/allocations; do not merge different intents to satisfy the index |
| `updated_at` | Not a no-loss sync cursor or conflict protocol | Add app-owned revisions/change feed/command receipts per D07 |
| Offer FK `ON DELETE SET NULL` | Preserves item, loses the original reference details | Retain approved minimal selection snapshot/revision history as specified |

Do not assume every old stored quantity of one was an explicit user request. Do not turn every old checked item into a purchased item. Preserve existing ownership and visibility during migration.

### 10.2 Consumer-owned additions remain consumer work

D07's spaces/membership, needs/selections, drafts, comparisons, plans, trips, commands, change feed and local IndexedDB model remain necessary. Reuse current tables where semantically suitable, or perform an explicit migration into a new app-owned structure. Avoid two simultaneous independent list databases or automatic dual writes without a migration plan.

A consumer AI import draft is private user data, not an extractor `import_rows.raw_data` record. Do not mix the two because both features contain the word import.

At the boundary, choose one source of truth per field and one owner per migration. The consumer app must not edit upstream prices to make matching easier. Source corrections follow the existing audited extraction/review process.

### 10.3 No changes required to the overall app direction

Keep the four destinations, broad audience, Arabic/English and responsive layouts, guest usefulness, pasted-list preview, shared-list journey, one-/two-store planning scope, and offline checklist. Continue to use D06A rather than copying screenshot mistakes.

The actual package reinforces, rather than invalidates, the separation of needs, offers, product identity, selections and trips already present in D07.

## 11. Concrete screen behavior changes/refinements

| D06 surface | Binding/refinement from this package |
|---|---|
| S03/S06 Offers/detail | Use actual rate basis; condition and assortment badges; current publication/date/geography policy; never show an active draft just because dates match |
| S07 Purchase quantity | Measured kg/g input for J3; count/pack controls for J1/J2; nullable inner counts never become one invented unit |
| S08 My List | Need persists without verified product ID; selected rate estimate can exist without exact cross-store equivalence |
| S11/S12 Import review | Preserve known user constraints; relevant generic/commodity offer differs from verified exact SKU; source capability conflict becomes a review state |
| S14 Eligibility | Use actual required/unknown/not-stated state; do not invent a loyalty program from the retailer name |
| S15-S17 Comparison | Include only source-backed compatible quantities and terms for the chosen date; producer `supported` is insufficient alone |
| S20 Shopping | Final weight may differ; checklist stays useful without stock or checkout guarantees |
| S23 Public preview | No private paths/contract diagnostics; consistent publication/expiry policy; historical offer explicitly ended |
| Desktop list panel | Same underlying needs/selections as mobile; no new cart/database introduced by this mapping |

The handoff's instruction to label every non-single composition Assorted needs a scoped UI interpretation: an actual mixed bundle is not necessarily a choice of variants. Use the documented composition and evidence, not one universal badge. Likewise, a handoff example naming a particular loyalty scheme is not evidence that the scheme applies to an unknown program ID. [P01: sections 5.2-5.3; D03/D06]

## 12. Scoped amendments to WIFRAN-07

| D07 area | What D07A now establishes | What remains pending |
|---|---|---|
| Section 4 integration map | Actual supplied tables, view and JSON paths identified | Deployed schema/roles, post-upload rows and executable mapper acceptance |
| Section 5 receiving ownership | Existing extractor/uploader should remain upstream owner | History/withdrawal/remap behavior and parity tests |
| Sections 6-7 domain/database | Registry ID type and existing list schema now known from SQL | Authoritative location mapping and consumer migrations |
| Section 8 authorization | Concrete base-profile and view risks identified | Hardened grants/policies/view strategy tested as real client roles |
| Sections 9-11 matching/pricing | New divisible per-kg fixture and capability conflict documented | Corrected producer semantics, eligibility policy and commodity attributes |
| Section 16 media/caching | Card/thumbnail fields and today-based lifecycle identified | Real asset delivery, sanitized projection and planned-date boundary tests |
| Section 20 tests | INT cases below extend ARCH/APP/UX coverage | Executed staging results |

Read D07 together with this addendum. Earlier files remain unchanged. Do not overwrite their user-control rules merely because an upstream handoff offers a shorter implementation shortcut.

## 13. Corrective work package and team handoff

### 13.1 Extractor/database team's bounded follow-up

1. **Freeze authoritative artifacts:** Supply final type definitions/JSON Schema, sync-mapper mapping, code revision, schema version, and the actual supported migration/seed order. Resolve `capabilities` versus `structural_capabilities` and asset-role enums.
2. **Harden public access:** Correct publication filtering, view ownership/invoker or restricted-access design, all exposure paths and full-contract redaction. Repair profile role edits and broad current/default privileges. Do not report a frontend-only filter as a security fix.
3. **Reconcile registries safely:** Align seed/runtime IDs and geographic semantics, expose city-to-region mapping and code aliases, and replace any destructive upgrade path. Preserve existing dependent records.
4. **Fix contract/SQL semantics:** Preserve nullable measured-item counts, avoid factual defaults for unconverted rows, and align duplicated flat/JSON values. Correct identity-dependent capability flags and confidence scope.
5. **Provide actual post-upload evidence:** One persisted row and safe consumer response for each of J1/J2/J3, including real asset state and no local-path leakage. Retain source dates and mark these as historical fixtures.
6. **Demonstrate lifecycle/revision acceptance:** Replays, out-of-order updates, conflict handling, retained selected snapshots or available history, remapped source identity and sub-offer generation.

These are targeted integration corrections and missing evidence, not a request to rebuild extraction or change the OCR provider.

### 13.2 Consumer-app team's work in parallel

Implement the versioned adapter with strict unknown/conflict handling, reusable offer cards, kg/g and fixed-pack quantity modules, generic needs, provisional references and safe import previews. Write adversarial fixture tests against the uncorrected package so fixes are verifiable.

Continue architecture/prototype work without production credentials. Do not create a complete alternate product catalog, publish malformed rows, or silently coerce the mutton count to one.

### 13.3 Required return artifacts

| Artifact | What counts as acceptance evidence |
|---|---|
| Corrective migration(s) | Reviewed non-destructive upgrade, correct ordering and rollback; not automatic production execution |
| Authoritative registry + crosswalk | Actual IDs/codes/taxonomy, version, city-region membership, clean-install and upgrade checks |
| Runtime schema/types | Actual JSON paths/enums/nullability and generated validator agreement |
| Post-upload examples | Internal persisted record plus separately sanitized public response, with matching source revision |
| Role/security report | Anonymous and ordinary-user tests through actual intended access paths; no draft reads, role escalation or raw internals |
| Replay/revision report | No-op replay, correction, outdated revision, conflicting revision, source remap and history behavior |
| Coverage map | EX-01-EX-48 and new INT cases mapped to executed commands/results, with skips and remaining ownership |

A 32-test suite can legitimately cover 48 requirement IDs. Test-count difference alone is not a defect. The acceptance gap is that executable code, SQL-role tests, migrations run, and coverage mapping were not supplied for independent verification.

## 14. Integration acceptance matrix

All cases below are **tests to execute**, not claims that they passed. Use disposable/staging data and controlled roles. Do not perform destructive or privilege-change tests on production accounts.

| ID | Scenario | Required observable result |
|---|---|---|
| INT-01 | Anonymous view/API read with active-dated draft, needs-review and rejected offers | Only approved public records visible; date activity cannot bypass publication |
| INT-02 | Ordinary authenticated user queries view/base/old views directly | No raw contract/local paths/private diagnostics through alternate granted routes |
| INT-03 | Inspect actual view owner/options and role behavior | Access strategy documented and enforced, not inferred from the name public-safe |
| INT-04 | Ordinary user edits permitted profile fields and attempts protected-role changes | Normal settings work; role/security authority cannot be self-elevated |
| INT-05 | New table/function created under migration owner | Default grants do not overexpose it; least-privilege tests cover creator-specific defaults |
| INT-06 | Clean disposable database initialization | Registry, schema, FK validation and intended fixture ingestion succeed in documented order |
| INT-07 | Upgrade populated database | Existing offers/lists/history preserved; migration 002 truncate path is not replayed |
| INT-08 | Seed twice against existing rows | Idempotence preserves intended IDs; slug conflicts cannot silently retain an incompatible registry |
| INT-09 | Compare sample registry IDs with actual rows | Jeddah and region resolve through approved crosswalk; no orphaned or dropped location |
| INT-10 | National, region and city offers for one selected city | Correct include/exclude behavior using explicit city-region taxonomy |
| INT-11 | Mutton round trip JSON -> DB -> projection -> API | Inner count stays null; kg remains divisible; no fabricated pack or count |
| INT-12 | Legacy row receives P08 default columns but no valid contract | Not misclassified as validated v2 or exact-price-ready |
| INT-13 | Flat columns conflict with nested price/revision/loyalty values | Inconsistency traced and quarantined for affected pricing, not silently resolved by convenience |
| INT-14 | Handoff capability path differs from sample path | Contract validator follows agreed schema; missing container never means all capabilities allowed |
| INT-15 | J3 unresolved identity with exact/automatic flags supported | Effective app gates withhold unsupported exact equivalence; source inconsistency visible internally |
| INT-16 | Generic fresh-mutton need with user-selected compatible offer | Useful estimate/reference possible without creating a fabricated SKU |
| INT-17 | Beef, frozen, different-origin or specific-cut need | Explicit incompatibility/unknown handled; no title/category-only exact match |
| INT-18 | Fan model absent and marked not-applicable | Domain-aware correction/unknown handling; no invented model/power |
| INT-19 | Soap request for two bars against six-bar pack | Full SAR 25 pack scenario and surplus require approval; never fractional-pack checkout pricing |
| INT-20 | Two accepted soap packs under supported historical terms | SAR 50, twelve bars; no seventh-unit bonus or SAR 25.02 charge |
| INT-21 | Mutton 500 g, 750 g, 1.5 kg, 2 kg | SAR 22.50, 33.75, 67.50, 90.00 estimates at the supplied rate; no integer-kg rounding |
| INT-22 | Unknown conditions and required loyalty | Approved policy separates advertised/conditional/eligible totals; no invented program or non-member price |
| INT-23 | Date 16 October versus 28 October 2026 | Fixture date interval applies historically; expired now; original dates unchanged |
| INT-24 | Riyadh midnight boundary versus session timezone | View/API/RLS/cache behavior agrees with the intended calendar convention |
| INT-25 | Future shopping date with an upcoming promotion | Correct date eligibility independent of active-today label; unpublished data still inaccessible |
| INT-26 | Real card/thumbnail uploaded successfully | Correct role/scope and serving behavior; safe bucket/key/URL; no workstation paths recursively |
| INT-27 | Missing/pending/failed/signed-expired media | Honest placeholder/retry; product need remains; no invented URL |
| INT-28 | Same source/revision/checksum replay | One logical offer and no semantic revision increment |
| INT-29 | Newer, older, or equal-but-different revision arrives | Newer accepted with history; older does not win; conflict detected |
| INT-30 | Alwafa correction replaces previously ingested Tamimi/national fixture | Audited identity reconciliation; no duplicate active promotion or unexplained lost list reference |
| INT-31 | Two sub-offers in one page/cell; recrop/reorder | Distinct persistent source identities or explicit reconciliation; fixed s01 cannot overwrite both |
| INT-32 | Approved plan references old price then source is corrected | Old snapshot explainable; current selection stale/revalidated; need not deleted |
| INT-33 | Unsupported full contract version or corrupted JSON row | Affected record isolated; valid browsing/manual lists remain usable |
| INT-34 | Existing personal lists migrate to app-owned need/selection model | Ownership/data preserved; quantity defaults and checked flags not reinterpreted as explicit intent/payment |
| INT-35 | Same offer used by separate needs | No forced semantic merge or duplicate promotion benefit; costing allocations remain explicit |
| INT-36 | Arabic/English phone/tablet/desktop display of J3 | Readable per-kg rate and fractional quantity; no pack UI or unsupported savings/stock labels |

Add representative new food variants and promotion cases beyond these three fixtures. Neither local JSON consistency nor these expected calculations establish >95% OCR or matching accuracy.

## 15. What was actually checked for this review

A local Python inspection parsed the JSON, compared registry values by exact ID, inspected SQL text, and used `Decimal` for calculations. It did not execute migrations or reproduce the team's test suite.

| Check | Actual result |
|---|---|
| Parse the three new JSON files | All three parsed |
| Ten top-level v2 sections | Present in all three |
| Source IDs across supplied samples | Three distinct strings |
| Seed row counts | 25 cities, 13 regions, 12 supermarkets, 13 categories, 9 units |
| Sample retailer IDs versus supplied seed | Present for all three |
| Sample city/region IDs versus supplied seed | Absent for all three; mismatch reported |
| Legacy offer price versus v2 decimal price | Agrees in all three |
| Nested local path locations in v2 | Four Windows-path string locations per sample; two local fields and two purported object-path fields |
| P08 view definition | No WHERE clause; no declared security_invoker option; selects whole contract JSON |
| P08 inner count | Declared integer NOT NULL DEFAULT 1 |
| P03 permissions/profile policy | Broad grants and own-row profile update found |
| P05 destructive statements | Three TRUNCATE ... CASCADE statements found |
| Expiry on 28 October 2026 | All three ended on 20 October 2026 |
| Exact decimal scenario calculations | Mutton weight examples and soap pack/rate checks agree with supplied values |
| Original J1/J2 checksums | Match the immutable baseline hashes reported by the team |

The unchanged original fixtures hash to:

```text
page-001-012.canonical.json
ec8aee31e219a579149b587c096480b55916edec01fb0b74c47a7c7befee9618

page-003-012.canonical.json
0a3e79b029e686be1d42304c8c4e5e40aca995f29f2091f1d9d8df71e4663ee4
```

These checks substantiate the file-grounded findings, not deployed security, visual evidence, source truth, or UI performance. The attached v2 shadow files are intentionally different from the immutable legacy fixtures.

## 16. Next step and completion boundary

**Next action:** Return the bounded correction/evidence package to the extractor/database maintainers while starting the app's safe adapter and fixture-based thin slice. After P0 access issues and affected P1 mappings are resolved, execute the staging acceptance matrix and finalize the receiving interface.

Then prepare WIFRAN-08 with the actual migration sequence, adapter ownership, safe DTO, corrected fixture set and explicit gates. Do not instruct the coding agent to run every supplied SQL file or expose the view merely because the engineering report says completed.

An acceptable first integrated slice is:

```text
Hardened database read + verified stored offer revision
    -> compact safe API DTO
    -> responsive rate/pack-aware offer card
    -> manually entered or pasted need
    -> validated candidate or useful uncertainty
    -> deliberate selection on the ordinary list
    -> revised/expired offer handled without losing the need
```

**Overall conclusion:** The upgrade is valuable and provides a much stronger implementation basis. The next work is integration hardening and mapping, not a consumer-product redesign. Preserve the useful new contract while closing the specific gaps that could expose private data, misroute offers, or turn a generic promotion into a falsely exact shopping recommendation.

---

## Appendix A - Read-only staging inspection queries

These are proposed diagnostics for the authorized database maintainer. They were **not executed here**. Run against an approved staging environment with appropriate inspection privileges; results can be shared without credentials or private household rows. Catalog visibility can vary with role, so an empty permission query is not automatically proof of absence.

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT current_setting('server_version') AS postgres_version,
       current_setting('TimeZone') AS session_timezone,
       (now() AT TIME ZONE 'Asia/Riyadh')::date AS riyadh_today;

SELECT n.nspname AS schema_name,
       c.relname,
       pg_get_userbyid(c.relowner) AS owner_name,
       c.reloptions,
       c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('v_consumer_offers', 'public_active_offers',
                    'offers', 'profiles');

SELECT pg_get_viewdef(to_regclass('public.v_consumer_offers'), true)
       AS consumer_view_definition;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('offers', 'profiles', 'shopping_lists',
                    'shopping_list_items', 'offer_sources',
                    'offer_status_history', 'issue_reports');

SELECT table_schema, table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

SELECT table_name, column_name, is_nullable, column_default, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'offers' AND column_name IN
      ('inner_pack_count', 'contract_version', 'contract_v2',
       'source_offer_id', 'source_revision', 'sale_unit_type', 'price_basis'))
    OR (table_name IN ('cities', 'regions', 'supermarkets') AND column_name = 'id')
  )
ORDER BY table_name, column_name;

SELECT id, slug, name_en FROM public.cities ORDER BY slug;
SELECT id, slug, name_en FROM public.regions ORDER BY slug;
SELECT id, slug, name_en FROM public.supermarkets ORDER BY slug;
SELECT id, slug, name_en FROM public.categories ORDER BY slug;

ROLLBACK;
```

Also inspect effective column grants, role memberships, creator-specific default ACLs, exposed schemas, storage policies and API behavior using the team's approved tooling. Database-owner queries alone do not demonstrate anonymous or ordinary-user isolation; run role-specific tests separately. Do not send service keys, passwords, auth tokens, full private rows or unredacted logs in the handoff.

## Appendix B - Forwardable message to the extractor/database team

> Thank you for the v2 package. Consumer mapping can proceed, but please close these integration items before we approve direct frontend access:
>
> 1. Harden `v_consumer_offers` and every alternate read path: enforce publication visibility, document/test owner versus invoker behavior, and remove raw `contract_v2`/nested workstation paths from public output. Fix base profile-role self-update and broad current/default grants.
> 2. Reconcile the handoff/runtime registry with the attached seed. Jeddah IDs differ, and the handoff's five-region taxonomy differs from the seed's thirteen regions. Provide one authoritative registry/crosswalk and city-region mapping. Do not replay migration 002's TRUNCATE operations on an existing database.
> 3. Preserve the measured mutton sample's `inner_count = null`; `inner_pack_count NOT NULL DEFAULT 1` currently conflicts with that meaning. Prevent legacy defaults from being treated as verified v2 facts.
> 4. Resolve `exact_identity_status = unresolved` alongside supported exact comparison/automatic fulfillment, and clarify confidence scopes. Supply the final schema and actual `assessments.capabilities` -> `scoped_assessments` mapping.
> 5. Provide post-upload persisted and sanitized consumer examples, including working card/thumbnail references and field parity. Current samples are pre-upload and remain historical offers.
> 6. Demonstrate revision history or retained approved snapshots, replay/out-of-order/conflict handling, source-context remapping and multiple sub-offers. Include executed database-role and migration tests, not only adapter unit tests.
>
> Keep this scoped to contract/integration hardening. Do not rebuild the consumer app or change the OCR provider. Record implemented/tested, pending downstream work, and unsupported semantics separately. Consumer UI and adapter work can continue against labeled fixtures meanwhile.

## Appendix C - Source references

### Supplied project sources

P01-P08 and J1V2-J3V2 are identified by exact filenames in section 1.1. References in the body point to named sections, SQL objects, and JSON paths so the document remains usable outside this chat. These files have not been copied into a guessed local folder; place the integration package in a known project location and record its actual path during implementation.

Existing architecture: [WIFRAN-07](Wifran-07-App-Architecture-Database-and-API-Contracts.md). Related behavior: [WIFRAN-02](Wifran-02-AI-Shopping-List-Import-and-Product-Matching.md), [WIFRAN-03](Wifran-03-Extractor-Data-Contract-Review-and-Design-Updates.md), [WIFRAN-04](Wifran-04-Extractor-Implementation-Brief-and-Data-Contract-Upgrade.md), [WIFRAN-06](Wifran-06-Screen-Specifications-and-User-Flows.md), and [WIFRAN-06A](Wifran-06A-Visual-Design-System-and-Screenshot-Reference-Guide.md).

### Official technical verification

Consulted 28 October 2026. These explain platform behavior, not the actual deployment; verify installed PostgreSQL version and configured roles.

- **T01 - PostgreSQL, CREATE VIEW:** Owner permissions, invoker behavior and underlying-table access. https://www.postgresql.org/docs/current/sql-createview.html
- **T02 - Supabase, Views:** View security and invoker configuration. https://supabase.com/docs/guides/database/views
- **T03 - Supabase, Column Level Security:** Table grants versus column grants; column-only restrictions must not be bypassed by table-wide UPDATE. https://supabase.com/docs/guides/database/postgres/column-level-security
- **T04 - PostgreSQL, Row Security Policies:** Scope of RLS and operations outside row filtering. https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- **T05 - PostgreSQL, GRANT:** Relation privileges and ALL grants. https://www.postgresql.org/docs/current/sql-grant.html

## Change record

| Version | Change |
|---|---|
| 0.1 | Reviews the supplied integration package, identifies twelve scoped integration findings, maps existing records to D07, adds measured-weight expectations, provides 36 staging acceptance cases and a forwardable correction request. No production or original-file changes performed. |
