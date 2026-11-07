# WIFRAN-07J - Hybrid Product and Offer Visual Enrichment

**Status:** Proposed addendum to WIFRAN-07G/07H; not implemented or approved in the extractor yet.
**Owner:** Extraction App team for data/export/import/catalog media; operator for manual AI exchange and image/rights review.
**Scope:** Extend the Step 1 CSV so both verified catalog products and unresolved offers can receive appropriate consumer visuals. Keep the frozen `wifran.extractor.offer/2.0` producer contract intact.

## 1. Why this change is necessary

The extractor reports 42 historical offers: 8 are linked to verified catalog products and 34 remain unresolved because they are assortments, loose commodities, or generic/unspecified goods. Excluding those 34 from the image workflow would leave most offer cards with placeholders. The solution is to allow *offer-level illustrative assets* without inventing exact product identities.

**Key clarification:** `offers.product_id` is nullable; `offers.id` is the stable offer primary key, which was a UUID in the original schema. Verify that it remains a stable, non-null identifier after all migrations. An unresolved offer must **not** acquire a fake `products.id` solely for image enrichment.

## 2. Two visual identity classes

| Reference | Data target | Visual meaning | Storage/association |
| --- | --- | --- | --- |
| `P<products.id>` (e.g., `P1`) | Verified catalog product | Actual photograph of the exact approved product, brand, variant, size, and retail pack | Existing `product-images` / `product_images`; reusable across linked offers |
| `O<offers.id>` (e.g., `O<offer-uuid>`) | Offer with `product_id = null` | Approved generic/representative photo or original AI-generated illustration; **not** an exact product claim | Consumer-safe offer illustration asset and offer-image association; do not populate `product_id` |

`P` and `O` are external CSV/image-workflow reference prefixes only. They are **not** literal database primary-key values. Never change product IDs or offer IDs simply to add the prefix.

## 3. Unified Step 1 export

Use exactly two columns:

```csv
Image_Ref,item_name
"P1","Al Falah White Eggs Small 30-piece tray"
"O<existing-offer-uuid>","Fresh Ethiopian mutton, sold by kg; generic illustrative image only"
"O<another-existing-offer-uuid>","Taj Al-Hind OR Taj Mahal basmati rice 5 kg; multiple alternatives; generic rice illustration only"
```

These example offer references are placeholders, not real database IDs.

Rules:

1. Export each *eligible verified catalog product* once, excluding those with an approved primary product photo unless explicitly refreshed.
2. Export unresolved offers eligible for approved illustrative visuals; do not silently drop them merely because `product_id` is null.
3. Preserve exact slash/choice, assortment, commodity and generic nature in the `item_name`; never convert 'A or B' into one SKU or invent missing model/brand/packaging data.
4. Exclude already approved offer visuals from the export unless replacement is explicitly requested.
5. Sort references deterministically and do not modify database rows when exporting.
6. Reduce redundant AI work by grouping offers that can truthfully reuse the **same generic illustration**, without merging the offers themselves. If a canonical `O...` reference is exported for a group, persist a deterministic, reviewable mapping to the other offer IDs. Do not group products with materially different visual subjects.
7. Provide separate counts: published offers, linked-to-product offers, unresolved offers, P references exported, O references exported, reuse/grouping exclusions, and unresolved image-eligibility exceptions.
8. A historical-data verification export must not accidentally filter out the test data solely because its offer validity dates have passed.

## 4. Manual external AI step

The Extraction App never calls the AI agent. The operator manually transfers the CSV to the agent and manually brings back results.

For **P** references, the agent **searches the web** for the exact standalone product photo. It must not synthesize a fake photograph of a named, verified product package. If no exact photo is available, leave the image URL blank.

For **O** references, prefer a small library of reusable, truthful generic visuals. The operator may commission original AI-generated images (or find appropriately licensed generic photography) for commodities, generic merchandise, and assorted/choice offers. Do **not** generate fictional branded packages, logos, unsupported models or individual options presented as the complete offer.

Examples:
- Fresh mutton by kg: unbranded, non-specific mutton illustration/photo, clearly illustrative; not a photo of claimed actual inventory.
- Taj Al-Hind OR Taj Mahal rice: generic basmati rice visual, **not** a fabricated branded 5 kg packshot.
- Unknown hand mixer 260W: generic mixer icon/illustration, not a supposedly exact model photo.
- Multiple assorted products: generic category graphic or explicitly labeled multi-choice visual, not an unverified option presented as the exact item.

**Rights and truthfulness checks remain manual.** A publicly discoverable photo is not necessarily licensed for copying/display. Generated images must be reviewed for inaccurate trademarks, pack claims, and the image service's commercial-use terms.

## 5. Step 2 return packaging (two-column CSV plus optional image files)

The AI's CSV remains **exactly two columns**:

```csv
Image_Ref,image_url
"P1","https://example.org/approved-candidate.jpg"
"O<existing-offer-uuid>",""
```

- A nonblank `image_url` means a candidate direct HTTPS image address, suitable for manual review and subsequent safe downloading if approved.
- When the AI *generates* an `O` illustration, it produces an actual PNG/WebP file named after the full reference, e.g., `O<existing-offer-uuid>.png`. These files are delivered separately (individual files or a ZIP) alongside the two-column CSV, with the corresponding `image_url` cell left blank.
- An image file is **not** an image URL. Do not invent URLs for files that are not yet hosted.
- A missing URL and missing image file means no result; do not silently assign another image.
- If the agent or operator cannot package named files, manual renaming before import is acceptable. The Extraction App must never assume direct AI connectivity.

This preserves two-column, low-token agent output while adding an optional file attachment for real generated images. In the initial phase, it is also acceptable to do only the Step 1 export first and defer URL/file import changes until the manual AI step is complete.

## 6. Database and Supabase design

**Keep the two media classes separate.**

For exact products:
- Preserve `products` -> `product_images` -> public `product-images` storage.
- Do not write photos into `offers.image_url` or other leaflet evidence fields.

For offer visuals:
- Add a dedicated offer-level consumer media association, e.g., `public.offer_display_images` keyed by `offers.id` and referring to an approved reusable media asset. Do not use `public.product_images.product_id` or create fake catalog products.
- Store consumer-safe illustrative images in a clearly distinct public storage location (prefer a dedicated `offer-display-images` bucket, or a strongly separated illustration prefix in the existing public consumer-media bucket). **Never** use the private `offer-images` leaflet-evidence bucket for consumer illustrations.
- Track asset hash, storage location, illustration category, approval/source-rights provenance and association status; ensure only one active selected illustrative image per offer and allow the same approved asset to serve multiple offers.
- Preserve full offer facts, `offers.product_id = null` where unresolved, catalog match statuses and the untouched frozen producer `contract_v2` assessments.
- Re-syncing an offer must not wipe previously approved offer image associations. Use stable IDs and idempotent updates.
- A later approved exact product photo should take precedence over an illustrative offer visual if the offer is subsequently linked to a verified product; preserve prior records for audit if needed.

**Consumer-safe projection** should resolve:

1. Approved exact product image when the offer is linked to a verified product with a licensed primary image.
2. Otherwise, approved illustrative offer image if available.
3. Otherwise, a neutral Wifran placeholder.

Expose at least `display_image_url` and `display_image_kind` (`exact_product` or `illustrative`, otherwise null). The consumer app shows an **Illustrative image** label whenever an offer illustration is used. No private leaflet URLs or storage paths may be exposed, including nested payloads.

## 7. Deduplication and cost controls

- **Product identity:** Do not merge unlike brands, sizes, variants or packs; do not treat offer illustrations as proof of SKU identity.
- **CSV:** One P row per eligible verified product. One O request per needed distinct *visual subject* where multiple offers can safely share a generic illustration, with an explicit mapping to all participating offer IDs.
- **Manual agent:** Reuse a small generic image library across suitable O offers rather than generate a new image every week or for every retailer.
- **Storage:** Deduplicate content by hash; reuse the same object for multiple offer assignments where appropriate. Avoid duplicate downloads/uploads.
- **Consumer:** Preserve each supermarket's offer record, prices, dates and conditions. Image deduplication must never collapse legitimately distinct offers.
- **Resilience:** Re-importing a CSV/ZIP must be idempotent, and missing images must not prevent publication of truthful offer facts.

## 8. Technical compatibility check for existing migration 007

The team reports `products.id` was changed from UUID to bigint. The original database schema also contained `product_id` references in `product_aliases`, `watched_items` and `shopping_list_items`, not only in `offers`. Before considering that migration production-safe, audit **all** database foreign keys, application types, APIs and fixtures referencing product IDs, and test migration from a populated database as well as a clean install. Passing offer/contract test suites alone is not a complete dependency audit.

PostgreSQL `IDENTITY` provides automatic sequence allocation, but a `GENERATED BY DEFAULT` column may permit explicit supplied IDs; sequence allocation alone does not guarantee that deleted IDs can never be reused under all administrative actions. Keep key immutability, primary-key uniqueness and controlled inserts as actual safeguards.

## 9. Acceptance and phasing

**Now: Step 1 only.** Ask for a revised two-column `Image_Ref,item_name` CSV, a breakdown of P/O counts, the excluded/grouped/reuse counts, and a clear explanation of any O group-to-offer mappings. Confirm all refs resolve to a real catalog product or offer; confirm all descriptions preserve ambiguity accurately. **Do not yet build a new AI connector or run the image upload pipeline.**

**Next: Step 2 manual.** The operator passes the file to the AI, reviews URLs and optional generated illustration files, checks permission/truthfulness, and returns them to the extractor.

**Then: Step 3.** Implement/verify optional O-file import alongside the existing URL import and the `Upload Product Images to DB` button. Keep exact product images and offer-level illustrations separately traceable, approved and reusable. Validate projection and an anonymous-client request; confirm leaflet evidence remains inaccessible.

**Decision boundary:** An image must improve the user's understanding without claiming an unverified exact product identity. A neutral placeholder remains the fallback when no safe illustration exists.
