# Wifran - Final Contract Fidelity Review Before Integration Freeze

**Document ID:** WIFRAN-07C  
**Version:** 0.1  
**Prepared:** 28 October 2026  
**Intended project location:** `Wifran/Docs/`  
**Audience:** Extractor/database team and Wifran consumer-app implementation team  
**Status:** Final integration fidelity check - **freeze pending a small final delta**

---

# 1. Executive conclusion

The WIFRAN-07B response package resolves the previously identified B-01 through B-10 issues in the SQL migrations, mapper logic, security controls, location handling, catalog IDs, media-state reconciliation, and revision-history access model.

The remaining concern is narrower:

> The new PostgreSQL verification suite does not insert the full `mapPreparedPayloadToOffersInsert()` result into `public.offers`.

Instead, the test manually enumerates a subset of mapper fields in its SQL `INSERT`.

As a result, the generated "actual PostgreSQL" DB rows, SQL view rows, and ConsumerOfferDTO fixtures lose several v2 facts that still exist correctly inside `contract_v2`.

This means the package currently proves:

```text
Extractor
  -> full mapper payload created
  -> selected subset manually inserted
  -> SQL view
  -> ConsumerOfferDTO
```

but not yet:

```text
Extractor
  -> full mapper payload
  -> full real DB insert
  -> SQL view
  -> ConsumerOfferDTO
```

The extractor contract itself does not need redesign. The final action is to make the freeze test exercise the real full insert contract and then preserve the app-critical semantics in the final consumer DTO.

---

# 2. What is now accepted

The following can be considered accepted and should not be reopened unless implementation evidence changes:

- `wifran.extractor.offer/2.0` as the producer contract version;
- deterministic `source_offer_id`;
- semantic revision/checksum design;
- commercial region/city registry;
- national / region / city scoping;
- nullable `inner_pack_count` for measured-weight goods;
- strict identity gating;
- assortment states;
- promotion vs eligibility separation;
- dual media roles;
- publication-only consumer view;
- sanitized contract projection;
- private revision snapshots with sanitized history RPC;
- media pending-state cleanup;
- non-destructive migration strategy;
- issue-report attribution controls.

The reported 76/76 test result is useful evidence. The issue below is about **what the PostgreSQL ingestion test actually persists and asserts**, not about whether those tests ran.

---

# 3. C-01 - PostgreSQL freeze test inserts only a subset of the mapper payload

**Severity:** Freeze blocker  
**Area:** End-to-end fidelity

`offerSyncMapper.ts` now correctly prepares rich relational fields including:

- `semantic_checksum`
- `contract_version`
- `derived_subcategory_slug`
- `commodity_tag`
- `item_domain`
- `product_attributes`
- `assortment_status`
- `known_options`
- `is_indivisible_sale_unit`
- `verified_non_member_price`
- `bonus_fulfillment`
- `loyalty_requirement`
- quantity-limit fields
- `image_subject_scope`
- `scoped_assessments`
- revision/supersession metadata
- `contract_v2`

However, `wifran07bPostgresFreezeVerification.test.ts` manually builds an `INSERT INTO public.offers (...)` containing only a subset of these fields.

The omitted fields fall back to database defaults or `NULL`.

Therefore the generated PostgreSQL artifacts are not a faithful materialization of the mapper payload.

## Required correction

The freeze test must persist **the complete mapper payload**, not a curated subset.

Preferred test architecture:

```text
canonical fixture
    ↓
buildContractV2FromCanonical()
    ↓
mapPreparedPayloadToOffersInsert()
    ↓
ONE production-equivalent insert helper
    ↓
public.offers
    ↓
v_consumer_offers
    ↓
mapSqlConsumerViewRowToConsumerDto()
```

The insert helper should:

1. obtain the real columns of `public.offers`;
2. reject any mapper key that has no matching DB column;
3. insert every mapped field that belongs to the table;
4. rely on DB defaults only for fields absent from the mapper;
5. avoid a separately maintained hand-written subset of columns.

If practical, reuse the same insert/upsert path used by `offerSyncService.ts`. Otherwise create one shared DB-payload insert helper used by both production sync tests and the freeze test.

---

# 4. Evidence of semantic loss in the supplied "actual PostgreSQL" artifacts

## 4.1 J1 - Dove Soap 5+1

The embedded `contract_v2` correctly contains:

```text
schema_version              = wifran.extractor.offer/2.0
semantic_checksum           = populated
assortment.status           = indicated_with_conflict
quantity.inner_count        = 6
promotion.mechanic          = bonus_pack
eligibility.loyalty         = required
capabilities                = populated
derived_subcategory         = bath_soap
```

But the generated stored DB row contains:

```text
contract_version            = null
semantic_checksum           = null
assortment_status           = unknown_composition
inner_pack_count            = null
promo_mechanic              = standard_price
loyalty_requirement         = unknown
scoped_assessments          = {}
derived_subcategory_slug    = null
product_attributes          = {}
```

The generated ConsumerOfferDTO consequently reports:

```text
inner_count                 = null
assortment_status           = unknown_composition
promotion_mechanic          = standard_price
capabilities                = {}
```

This is materially different from the v2 contract.

For example, Wifran could no longer determine from the DTO that the SAR 25 offer represents an indivisible 6-unit pack containing the "5+1" structure.

---

## 4.2 J2 - Mini Fan

The embedded contract correctly contains:

```text
derived_subcategory         = mini_fan
item domain                 = appliance
assortment                  = assortment_indicated
capabilities:
  unit_price_calculation    = blocked
  exact_product_comparison  = blocked
  automatic_list_fulfillment = needs_review
```

But the generated DB/view/DTO path falls back to:

```text
derived_subcategory_slug    = null
commodity_tag               = null
item_domain                 = grocery
assortment_status           = unknown_composition
scoped_assessments          = {}
ConsumerOfferDTO capabilities = {}
```

This would weaken product classification and could remove exactly the comparison restrictions that were added to protect the consumer app.

---

## 4.3 J3 - Ethiopian Fresh Mutton

The embedded contract correctly contains:

```text
derived_subcategory         = fresh_mutton
assortment                  = single_product
sale_unit                   = kg
inner_count                 = null
is_indivisible_sale_unit    = false
meat_species                = mutton
freshness                   = fresh
origin                      = ethiopian
cut_type                    = cuts
capabilities:
  exact_product_comparison  = needs_review
  automatic_list_fulfillment = conditional
```

But the generated stored DB row contains:

```text
derived_subcategory_slug    = null
product_attributes          = {}
assortment_status           = unknown_composition
is_indivisible_sale_unit    = true
scoped_assessments          = {}
contract_version            = null
semantic_checksum           = null
```

The `is_indivisible_sale_unit = true` value is especially important: the contract explicitly says the per-kilogram item is divisible.

This discrepancy is created by the partial test INSERT, not by the v2 contract builder.

---

# 5. C-02 - ConsumerOfferDTO must preserve app-critical uncertainty and quantity semantics

**Severity:** Freeze blocker for the consumer boundary  
**Area:** Consumer DTO contract

Even after C-01 is fixed, the final app DTO should not collapse important multi-state semantics.

The current consumer projection examples expose:

```text
is_loyalty_required: boolean
```

but the producer/view model can distinguish:

```text
required
unknown
```

For Wifran, `unknown` must not silently become equivalent to "no loyalty requirement".

Similarly, the contract explicitly carries:

```text
is_indivisible_sale_unit
```

because the app must distinguish sealed/whole sale units from divisible weight-based purchases.

The final consumer-facing DTO should therefore include at least:

```ts
quantity_semantics: {
  sale_unit: string;
  inner_count: number | null;
  is_indivisible_sale_unit: boolean;
  total_content_value: number | null;
  total_content_unit: string | null;
}

eligibility: {
  loyalty_requirement: 'required' | 'unknown' | 'not_required' | string;
  sales_channel: string;
  quantity_limit_value: number | null;
  quantity_limit_unit: string | null;
  quantity_limit_scope: string | null;
}

capabilities: {
  offer_display: ...;
  save_to_list: ...;
  selected_offer_subtotal: ...;
  unit_price_calculation: ...;
  exact_product_comparison: ...;
  automatic_list_fulfillment: ...;
}
```

A flat compatibility field such as:

```text
is_loyalty_required
```

may remain for rendering convenience, but it must not replace the source-of-truth requirement state.

For matching/search services, the app also needs access to:

- `derived_subcategory_slug`
- `commodity_tag`
- `item_domain`
- `product_attributes`
- `assortment_status`
- `exact_identity_status`
- `reason_codes`

These can be carried directly in `ConsumerOfferDTO` or exposed through a separate backend/internal offer model. The architecture must state which model the matching service uses.

---

# 6. C-03 - Add semantic parity assertions to the real-Postgres suite

After switching to a complete mapper insert, add assertions that prove the important fields survive every stage.

## J1 assertions

```text
DB contract_version            == wifran.extractor.offer/2.0
DB semantic_checksum           == contract checksum
DB inner_pack_count            == 6
DB assortment_status           == indicated_with_conflict
DB promo_mechanic              == bonus_pack
DB loyalty_requirement         == required
DB scoped_assessments          contains exact_product_comparison=conditional

DTO inner_count                == 6
DTO promotion_mechanic         == bonus_pack
DTO assortment_status          == indicated_with_conflict
DTO capabilities               not empty
```

## J2 assertions

```text
DB derived_subcategory_slug    == mini_fan
DB item_domain                 == appliance
DB assortment_status           == assortment_indicated
DB product_attributes.model.state == unknown
DB exact_product_comparison    == blocked

DTO item_domain                == appliance
DTO assortment_status          == assortment_indicated
DTO exact_product_comparison   == blocked
```

## J3 assertions

```text
DB derived_subcategory_slug    == fresh_mutton
DB assortment_status           == single_product
DB inner_pack_count            == null
DB is_indivisible_sale_unit    == false
DB product_attributes.origin   == ethiopian
DB exact_product_comparison    == needs_review
DB automatic_list_fulfillment  == conditional

DTO sale_unit                  == kg
DTO is_indivisible_sale_unit   == false
DTO derived_subcategory        == fresh_mutton
DTO capabilities               not empty
```

Also assert:

```text
DB contract_version is never null when contract_v2 is present
DB semantic_checksum matches contract_v2.record_metadata.semantic_checksum
DB scoped_assessments matches contract_v2.assessments.capabilities
```

for all three benchmark fixtures.

---

# 7. C-04 - Regenerate the nine benchmark artifacts only after C-01 through C-03 pass

Regenerate:

```text
J1:
  *.post-upload-db-row.json
  *.sql-consumer-view-row.json
  *.consumer-projection-dto.json

J2:
  same three files

J3:
  same three files
```

The regenerated files should show the same semantic facts at every appropriate layer.

They do not need to be byte-identical because:
- SQL numeric/date representation can differ;
- the SQL view can rename fields;
- the DTO can reshape fields.

But they must be **semantically equivalent**.

---

# 8. Supabase staging smoke test

`@electric-sql/pglite` is useful PostgreSQL execution evidence and is significantly stronger than regex-only SQL tests.

However, before production deployment, run one final smoke test on an actual Supabase staging project because Wifran also depends on:

- Supabase auth role behavior;
- PostgREST exposure of the view/RPC;
- storage URL handling;
- Supabase-specific grants/default privileges;
- RLS behavior through the real client stack.

This does not need to delay the logical contract freeze once C-01 through C-03 pass.

Treat it as a **pre-deployment gate**, not another data-contract redesign cycle.

---

# 9. Freeze decision

The integration boundary should be considered formally frozen when:

1. the PostgreSQL freeze test inserts the full mapper payload;
2. J1/J2/J3 retain their v2 semantics in relational columns;
3. the final ConsumerOfferDTO exposes the app-critical quantity and eligibility states;
4. semantic parity assertions pass for J1/J2/J3;
5. the nine synchronized artifacts are regenerated from that corrected path.

No further extractor-contract redesign is requested.

Once these points pass, Wifran can treat:

```text
wifran.extractor.offer/2.0
```

as the frozen producer boundary and proceed to WIFRAN-08 implementation planning.

---

# 10. Suggested message to the extraction/database team

Thank you for the WIFRAN-07B package. The B-01 through B-10 corrections are now in place and the PostgreSQL execution suite is a major improvement.

During the final artifact-level verification, we identified one remaining integration-fidelity issue: the PostgreSQL freeze test creates the full mapper payload but manually inserts only a subset of its fields into `public.offers`. As a result, the generated DB/view/DTO artifacts fall back to defaults for several v2 fields even though the embedded `contract_v2` contains the correct values.

Please review WIFRAN-07C. This is not another contract redesign request. The required change is to make the freeze suite persist the complete mapper payload through a production-equivalent insert path, add semantic parity assertions, and regenerate the nine J1/J2/J3 artifacts.

We also ask that the final ConsumerOfferDTO retain the explicit divisibility and eligibility states required by the Wifran app, rather than reducing them to inferred/boolean behavior.

Once these focused items pass, we can formally freeze the `wifran.extractor.offer/2.0` integration boundary.

---

# 11. Final principle

> A contract is frozen only when its meaning survives the entire integration path, not merely when the original JSON remains embedded somewhere inside the database row.
