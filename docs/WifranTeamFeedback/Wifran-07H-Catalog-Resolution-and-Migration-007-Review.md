# Wifran - Catalog Resolution and Migration 007 Review

**Document ID:** WIFRAN-07H  
**Date:** 2026-10-31  
**Status:** Internal review and recommended clarifications; not an approved extraction contract change  
**Related:** WIFRAN-07G Revision 1.1; frozen `wifran.extractor.offer/2.0`

## 1. Executive assessment

The Extraction App team's diagnosis is credible and the dependency is real. The team reports that all 42 published Alwafa_Test offers in WifranV2 currently have `product_id = null` and `exact_identity_status = 'unresolved'`. This is a team-reported database observation, **not independently re-queried in this review**. With a product-level CSV export requiring real `products.id`, zero products would currently qualify for export.

Approve the **direction** of (1) a minimal catalog-resolution workflow and (2) an additive migration 007 plus manual CSV image-enrichment pipeline, **subject to the guardrails below**.

## 2. Primary correction: candidate identity is not verified identity

A deterministic grouping key (brand + normalized name + variant + size + unit + pack count) is useful for proposing matches and duplicates. It does **not** by itself prove exact SKU identity. Do not automatically create `products` rows, link offers, and mark `offers.exact_identity_status = 'verified_exact'` solely from normalization or OCR text.

Minimum-cost workflow:
1. Normalize and group existing published offers into **candidate products** using known attributes.
2. Automatically reuse a previously **verified catalog product** only when its identity is demonstrably the same and no conflicting details exist.
3. Present new/ambiguous candidate groups for lightweight **operator review** using offer descriptions and private leaflet evidence; optionally record independent manufacturer/packaging identifiers where available.
4. After identity verification, create/reuse a stable `products.id`, record the verification provenance, and link only appropriate offers.
5. Leave unresolved, mixed, multi-choice, unbranded, and uncertain products with `product_id = null` and a consumer placeholder until genuinely resolved.

A GTIN is excellent evidence but not mandatory in every case; supported pack/variant identity can sometimes be verified through other authoritative evidence. **An AI-found image URL does not establish SKU identity or reuse rights.**

## 3. Preserve frozen producer facts and re-sync behavior

Do not silently overwrite the extraction-v2 source assertion (`contract_v2.product_facts.exact_identity_status`) or force `offers.exact_identity_status = 'verified_exact'` without reconciled provenance. A separate catalog-resolution verification status is safer where the original extractor assertion was `unresolved`. Consumer image eligibility should reflect approved catalog linkage and image rights, not inferred text similarity.

Important regression test: after the operator verifies and links `offers.product_id`, run the same offer through the extractor upload/update again. The previously shared mapper constructed `product_id` from `prep.product_id || null`. A new sync must **not erase approved catalog links** or revert their status accidentally. Any genuine conflicting new evidence must go to review rather than silently overriding established identity.

Catalog identity enrichment must not change original offer price, geography, promotions, assortment, quantities, offer source ID/revision or semantic checksum without the existing explicit revision rules.

## 4. Migration 007 must cover the product identity schema too

Inspect existing `public.products` before writing SQL. The previously shared initial schema has `id`, names, brand/category ID, `slug`, default size/unit, `default_image_url`, but no complete explicit identity fingerprint or verification provenance fields. The migration/service must support whatever is required for trustworthy brand/variant/size/pack resolution, auditable approval and safe deduplication, either through additive columns or normalized related tables.

Create or reuse appropriately structured image records (`product_images` with shared asset references if needed) and `product-images` storage. Store source URL, rights approval/permission evidence, hashes and primary-image association. A public-read image bucket is acceptable **only for approved, licensed product images**, with tightly restricted writes. Never expose the private `offer-images` evidence bucket.

For consumer-facing SQL views/RPCs, remove all private crop URLs and paths **including within nested** `consumer_contract_v2.assets` and direct public projections. Existing consumer columns and the WIFRAN-07D price/eligibility semantics must remain correct. Changing an existing PostgreSQL view to drop columns may require an explicitly staged replacement or a new versioned safe projection rather than a naïve `CREATE OR REPLACE VIEW`.

## 5. Deduplication and approval are separate responsibilities

- Catalog product dedup: only merge proven identical brand/variant/size/retail-pack identities; do not conflate retailer-specific promotional mechanics with manufacturer SKU identity.
- CSV export dedup: one `Product_ID,item_name` per verified product without a primary approved image.
- AI output: exactly `Product_ID,image_url`; no direct app-agent integration, extra AI fields or subscription requirement.
- Manual review: verify match and lawful copying/hosting/display; blank or remove unacceptable URLs. Keep operator approval evidence **internally**, not in the AI CSV.
- CSV import: reject unknown, stale, duplicate or conflicting `Product_ID`; do not begin network operations until explicit `Upload Product Images to DB` click.
- Image dedup: re-use existing approved product images, protect against repeated URLs and identical bytes, and hash downloaded content; avoid indiscriminately linking the same generic image across different product variants.
- Database dedup: one active approved primary image per verified product, reuse for all truly matching offers; preserve distinct offers, prices and dates.
- Repeated imports and re-syncs: idempotent; changes do not reset approved image links.

## 6. Required pilot and acceptance checks

Have the team report (a) 42 reported offers, (b) count of unique product candidates, (c) number verified and safely linked, and (d) number still unresolved. Do not imply that 42 offers equal 42 distinct products.

Demonstrate end-to-end with a **small verified subset**:
- candidate grouping, manual identity approval, product creation/reuse, and valid `offers.product_id`;
- export exactly `Product_ID,item_name` with unique products;
- manually imported exactly `Product_ID,image_url` with user-reviewed and licensed images;
- explicit upload button and correct `product-images` storage metadata;
- duplicate import and duplicate-offer reuse without duplicate products, images, links or storage objects;
- offer re-sync preserves approved product association;
- ambiguous assortments/commodities remain unresolved;
- anonymous and normal consumer queries see approved product image URL or `null`, but no private leaflet URLs/paths anywhere;
- existing v2 contract acceptance/regression tests and WIFRAN-07D price and loyalty semantics continue to pass.

**Decision:** Proceed with a narrowly scoped, review-assisted product-resolution step plus migration 007/manual CSV enrichment **after confirming these guardrails**. Do not approve an auto-verified exact identity solely from text normalization.

