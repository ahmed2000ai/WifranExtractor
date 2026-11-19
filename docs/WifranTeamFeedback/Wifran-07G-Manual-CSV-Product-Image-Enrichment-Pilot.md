# Wifran — Minimal CSV Product-Image Enrichment Workflow

**Document ID:** WIFRAN-07G  
**Revision:** 1.1 — supersedes the earlier six-column AI-result proposal  
**Date:** 2026-10-31  
**Status:** Approved workflow design; implementation and source-rights approval pending  
**Owner:** Wifran Extraction App team  
**Preserve:** Frozen `wifran.extractor.offer/2.0` offer contract

---

## 1. Decision

For the initial release, use a **low-cost, manually operated CSV round trip**. The AI agent is used **only to find candidate direct image URLs**. It does not provide license assessments, source descriptions, confidence scores, GTIN mappings, approval states, or additional columns.

The Extraction App is responsible for exporting product descriptions, importing manually reviewed image URLs, verifying references, safely downloading approved images, deduplicating and uploading them into Supabase `product-images`, associating images with catalog products, and serving only approved images in Wifran's consumer-facing view/API.

Wifran itself only reads offers and approved catalog images, and displays a neutral placeholder where no approved image is available.

Leaflet crops remain private evidence in `offer-images`. Do not display them as consumer photos or expose their URLs/paths in the consumer-safe interface.

## 2. CSV export from the Extraction App

**Exactly two columns:**

```csv
Product_ID,item_name
"<existing products.id>","<complete product description including brand, variant, size, and pack>"
```

The values above are placeholders, not real database values.

### Rules

- `Product_ID` must be a **real, durable identifier of a verified catalog product**, corresponding to `products.id` (or the Extraction App's authoritative catalog product identifier mapped unambiguously to that row).
- `item_name` should be the best complete description available, including supported variant, flavor/scent, net weight/volume, multipack quantity and package type. Do not invent missing identity details.
- Export one row per **unique catalog product**, not one row per supermarket offer.
- Reuse the existing image if that product already has an approved primary image.
- Products already associated with an approved image should normally be excluded from subsequent exports.

### Important current prerequisite

Some existing offer records have `product_id = null`.

The Extraction App must create or resolve a legitimate catalog product and its stable ID **before** that product is exported.

Do not:

- Relabel `offers.id` as `Product_ID`.
- Fabricate a product match.
- Silently create an exact SKU out of an ambiguous offer.

For offers that cannot be mapped accurately to a product, leave their consumer image null/placeholder until separately resolved.

The AI must not be expected to manufacture the database identity.

## 3. CSV returned by the AI agent

**Exactly two columns and no extras:**

```csv
Product_ID,image_url
"<same existing products.id>","<direct HTTPS image URL or empty string>"
```

### Rules for AI research

1. Preserve each `Product_ID` exactly as supplied; never invent or change IDs.
2. Return one row per input product.
3. Return one direct HTTPS image URL pointing to the best candidate photograph for the **exact brand, variant, size and pack**.
4. Prefer product-focused images and trustworthy product/manufacturer sources.
5. If a candidate cannot be found confidently, or the product identity is ambiguous, return a blank `image_url`.
6. Do not substitute a misleading product size, flavor, pack, edition or model.
7. Do not use leaflet crops.
8. Output **CSV only**. No prose, other columns, product descriptions, confidence scores, license opinions, image downloads or embedded images.

### Copy-ready prompt for the web-enabled AI agent

> You will receive a 2-column CSV containing `Image_Ref,Item_Name` (or `Product_ID,item_name` for standalone catalog runs), where each row is either a verified catalog product (`P<id>`) or an offer visual reference (`O<n>` / `O<uuid>`).
>
> Process **only** the `P` and `O` product/offer rows for product-image sourcing. Leaflet metadata (supermarket, location scope, and offer validity dates) has already been confirmed in Stage 2 and must not be extracted or emitted.
>
> For each row, search the web for a clean standalone photograph (or truthful generic/illustrative image for `O` rows when applicable) matching the product description as precisely as possible, including brand, variant, size, package type and multipack count.
>
> Return **only** a CSV with exactly two columns in this order:
>
> `Image_Ref,image_url`
>
> Preserve every input `Image_Ref` unchanged, with exactly one row per input `P` or `O` row.
>
> Each `image_url` must be a direct HTTPS image URL, not a search-results URL or HTML webpage. When a product description contains an obvious OCR typo and you have evidence-backed correction alongside a direct HTTPS URL, you may format column 2 as `Corrected_Item_Name|https://...`.
>
> If a reliable product image cannot be found or the description is ambiguous, leave `image_url` blank (`""`).
>
> Do **not** inspect or request leaflet page URLs. Do **not** emit `FPTSP`, `LPTSP`, `SD`, `ED`, `SMN`, `REG`, `M_*`, explanations, license assessments, or additional columns.
>
> Never invent an image URL or product identifier.

## 4. Human review is mandatory before import

The AI's URL is a **candidate**, not approval for download, hosting or public display.

The operator manually checks:

- The image corresponds to the exact described product, or intentionally leaves the URL blank.
- Its use in Wifran is authorized under a relevant permission, provider arrangement or license covering the intended copying, storage and display.
- The URL works and points to an image, not another webpage or misleading alternative.

A publicly accessible image is not automatically reusable.

Remove unsuitable URLs or blank their cells.

Keep **the returned CSV at two columns**.

Any reviewer identity, approval evidence or rights restrictions should be recorded separately in the Extraction App's internal approval/audit records rather than requested from the AI.

The Extraction App import must require an explicit operator confirmation that the imported rows have passed this review.

**It must not automatically publish a raw AI-returned CSV.**

## 5. Extraction App import and Supabase upload

The Extraction App must provide a CSV import facility accepting:

`Product_ID,image_url`

Selecting the CSV must not automatically trigger downloading or uploading.

The operator must explicitly initiate the process by clicking:

**Upload Product Images to DB**

For each manually approved, nonblank `image_url`:

1. Resolve the `Product_ID` to an existing verified catalog product; reject unknown IDs and stale/ambiguous product associations.
2. Check for an existing approved image for that exact product; do not download/upload duplicates.
3. Safely fetch the image server-side using HTTPS with limits on size, type, redirects, timeouts, and public destinations; block private/internal network targets and invalid formats.
4. Hash/normalize the image and reuse an existing matching asset when appropriate.
5. Upload a single approved primary image for that catalog product into `product-images`, with optional separately managed alternative images later.
6. Record durable image reference and separately collected source/rights/approval audit information.
7. Link the product to the approved image in the database.
8. Let every offer referencing that product resolve to the same approved image.
9. **Do not copy the product URL onto each offer's private-evidence `image_url` field.**
10. Consumer-facing API/view must provide only the approved product image or `null`; never fall back to private leaflet crops or publish their paths.

### Import validation

The Extraction App should:

- Reject malformed CSV files.
- Validate that every Product_ID exists.
- Detect duplicate Product_ID rows.
- Identify conflicting URLs for the same product.
- Skip blank or invalid URLs.
- Prevent duplicate uploads and duplicate product-image associations.
- Allow safe, idempotent retries.
- Provide progress and a concise result summary.

### Upload result

The application should report:

- Images newly uploaded.
- Images already existing and reused.
- Rows skipped.
- Rows failed.
- Reasons for failures.

Reimporting the same approved CSV must not create duplicate images or database relationships.

## 6. Special cases

### Assorted Dove 125 g 5+1

Do not pretend that one arbitrary Dove fragrance photograph is an exact image of the whole assorted promotional bundle.

Resolve the exact product or leave blank.

### Mini fan, unspecified model

Do not use an arbitrary model photograph as an exact match.

### Fresh mutton per kg

A generic meat photo is not an exact branded SKU.

If a separately authorized *illustrative* image is desired, treat it as a distinct, explicitly labeled workflow; do not silently register it as an exact product.

### Product has no valid `product_id`

Not eligible for this product-level export until legitimate catalog resolution is completed.

Display a neutral placeholder in Wifran meanwhile.

## 7. Minimal pilot acceptance tests

- [ ] Export CSV is exactly `Product_ID,item_name`, with one row per unique mapped catalog product.
- [ ] Import CSV returned by AI is exactly `Product_ID,image_url`; missing images are blank.
- [ ] Product_ID remains unchanged and maps to an actual, stable catalog product.
- [ ] The Extraction App has no direct interface or integration with the AI agent.
- [ ] CSV transfer to and from the AI agent is performed manually by the operator.
- [ ] Upload does not start until the operator explicitly clicks **Upload Product Images to DB**.
- [ ] Manual review and authorization happen before any download/publication; raw AI CSV is not auto-approved.
- [ ] Wrong sizes, variants, uncertain assortments, broken URLs and unknown IDs are skipped rather than forced into exact matches.
- [ ] Shared product image is uploaded once and reused across matching offers.
- [ ] Approved image metadata, rights evidence and reviewer approval are recorded internally, without extra AI CSV columns.
- [ ] Private `offer-images` evidence is never used or exposed to consumers.
- [ ] Consumer view/API returns approved product image or null; Wifran itself is read-only for offer/product data.
- [ ] Frozen `wifran.extractor.offer/2.0` data contract and offer extraction workflow remain unchanged.

## 8. Request to Extraction App team

Please implement WIFRAN-07G Revision 1.1 as a minimal manual image-enrichment round trip.

The expected workflow is:

**Extraction App → Export CSV → Manual AI processing → Manual CSV import → Upload Product Images to DB → Supabase**

The Extraction App exports:

`Product_ID,item_name`

The external AI agent returns **only**:

`Product_ID,image_url`

The operator manually validates image exactness and usage permission, removes unsuitable URLs, and imports the approved CSV.

The Extraction App then downloads, deduplicates, uploads, and links one approved primary product image for reuse across offers.

Do not request additional fields from the AI.

Ensure every exported `Product_ID` is a genuine catalog product ID. Unresolved offers with null product IDs must not be mislabeled or auto-identified.

Keep leaflet crops private, consumer projections image-safe, and the frozen v2 offer contract unchanged.

Please provide a small pilot and concise results only.

---

**Non-negotiable distinction:** A minimal AI CSV is appropriate; it does **not** eliminate manual verification of product identity or rights before using images publicly.
