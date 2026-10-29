# Wifran - Final Consumer Projection Mapping Correction

**Document ID:** WIFRAN-07D  
**Version:** 0.1  
**Prepared:** 28 October 2026  
**Status:** One final micro-fix before integration freeze  
**Intended project location:** `Wifran/Docs/`

## Decision

The C-01 through C-04 work is accepted. The full mapper payload is now persisted and J1/J2/J3 preserve their important v2 semantics through:

`Mapper -> DB Row -> SQL View -> Consumer DTO`

Do **not** reopen SQL migrations, catalog IDs, offer-sync mapping, security, revision history, media handling, or the v2 producer contract.

One small consumer-projection defect remains.

## D-01 - Read the sanitized consumer contract from the correct SQL-view field

`public.v_consumer_offers` exposes the sanitized contract as:

`consumer_contract_v2`

but `mapSqlConsumerViewRowToConsumerDto()` currently reads:

`sqlViewRow.contract_v2`

The adapter should read:

```ts
const rawConsumerContract =
  sqlViewRow.consumer_contract_v2 ??
  sqlViewRow.contract_v2 ??
  {};

const contractV2 =
  typeof rawConsumerContract === 'string'
    ? JSON.parse(rawConsumerContract)
    : rawConsumerContract;
```

Keep the `contract_v2` fallback only for compatibility/testing.

This matters because some consumer-safe values may exist only inside the sanitized contract, such as `eligibility.sales_channel`.

## D-02 - Preserve reference-price semantics in ConsumerOfferDTO

The SQL view exposes:

- `source_reported_original_price`
- `verified_non_member_price`

The DTO currently looks for `sqlViewRow.original_price`, which the SQL view does not expose. Consequently J1, J2 and J3 currently produce `original_price: null` even though the SQL-view rows contain 42.99, 29.00 and 54.99 respectively.

The consumer boundary must keep these concepts separate.

Add/retain explicit DTO fields:

```ts
source_reported_original_price: string | null;
verified_non_member_price: string | null;
```

If `original_price` is retained for compatibility, populate it from `source_reported_original_price` and document that it is an advertised/source-reported reference price, **not** a verified non-member price.

Recommended mapping:

```ts
const sourceReportedOriginalPrice =
  sqlViewRow.source_reported_original_price != null
    ? String(sqlViewRow.source_reported_original_price)
    : contractV2?.price_terms?.source_reported_original_price != null
      ? String(contractV2.price_terms.source_reported_original_price)
      : null;

const verifiedNonMemberPrice =
  sqlViewRow.verified_non_member_price != null
    ? String(sqlViewRow.verified_non_member_price)
    : contractV2?.price_terms?.verified_current_non_member_price != null
      ? String(contractV2.price_terms.verified_current_non_member_price)
      : null;
```

Then expose both values in `ConsumerOfferDTO`.

## Required tests only

Add assertions that:

- J1 `source_reported_original_price == "42.99"`
- J2 `source_reported_original_price == "29.00"`
- J3 `source_reported_original_price == "54.99"`
- all three `verified_non_member_price == null`
- the adapter reads `consumer_contract_v2`
- a consumer-contract-only eligibility value such as `sales_channel = "online"` survives into `ConsumerOfferDTO.eligibility.sales_channel`

No new SQL/database migration tests are required for this correction.

## Return only

Please return only:

1. `extractorContractV2.ts` **if the DTO type changes**
2. `extractorContractV2Adapter.ts`
3. `wifran07bPostgresFreezeVerification.test.ts`
4. regenerated:
   - `J1-dove-soap.consumer-projection-dto.json`
   - `J2-mini-fan.consumer-projection-dto.json`
   - `J3-ethiopian-mutton.consumer-projection-dto.json`
5. one short line confirming the final test result

Do **not** resend SQL files, mapper files, DB-row fixtures, SQL-view fixtures, handoff documents, or unchanged files.

## Freeze rule

Once D-01 and D-02 pass, the `wifran.extractor.offer/2.0` extractor-to-Wifran boundary is approved for freeze.

No further extractor-side review is planned unless a later consumer-app integration test reveals a concrete defect.
