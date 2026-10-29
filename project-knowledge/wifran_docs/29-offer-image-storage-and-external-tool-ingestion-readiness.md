# Antigravity Chunk 29 — Offer Image Storage and External Tool Ingestion Readiness

## Execution Mode

Do not stop after preparing a plan.

First inspect the current Wifran schema, Supabase Storage docs/config, offer image fields, offer source/import tables, admin offer UI, public offer cards, offer detail pages, and project knowledge.

Then implement the required changes fully.

Run:

```bash
npm run lint
npm run build
````

Stop only after implementation, documentation, and testing summary are complete.

---

## Objective

Prepare Wifran to receive weekly offer data and one cropped item image per offer from an external data-ingestion tool.

The external tool will:

* access Wifran’s Supabase database using secure server-side credentials
* upload one image per offer item
* insert/update weekly offer data
* include a unique image filename referencing leaflet and item number
* optionally create/associate an offer source/import batch

Wifran must be ready to:

1. Store offer item image references.
2. Display those images in public offer cards.
3. Display those images in offer detail pages.
4. Fall back gracefully when images are missing/broken.
5. Track source metadata such as leaflet ID, page number, and item number.
6. Document the expected external tool contract.
7. Document where the external tool should upload images.
8. Keep admin/manual/AI import workflows compatible.

---

## Product Context

Wifran is a Saudi grocery savings app.

Offers may now have images cropped directly from the weekly supermarket leaflet.

These images are not generic product images. They are offer-item leaflet crops, similar to:

```text
A rice offer crop with product image, Arabic/English name, pack size, old price, offer price.
A Dettol sanitizer offer crop with 1+1 label, product image, prices, and pack details.
```

These images are highly useful because they preserve the original offer visual and increase user trust.

---

## Core Architecture Decision

Use Supabase Storage for offer item images.

Do not store image binary data in Postgres.

Store image files in a Supabase Storage bucket:

```text
offer-images
```

Store image references on offer/source rows.

Preferred storage path format:

```text
{supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp
```

Examples:

```text
panda/city/riyadh/panda-riyadh-2026-06-05/001.webp
panda/city/riyadh/panda-riyadh-2026-06-05/002.webp
othaim/region/riyadh-region/othaim-riyadh-region-2026-06-05/001.webp
carrefour/national/saudi-arabia/carrefour-national-2026-06-05/001.webp
```

The bucket should be public-read because these are public offer images.

Upload/write access must remain restricted to the external tool, admin/server actions, or service role.

---

## Do Not Implement

Do not implement:

```text
in-app OCR
in-app leaflet image extraction
external tool itself
branch-level availability
notifications
monetization
native app
price history
receipt scanning
```

This chunk prepares Wifran to receive and display external-tool images.

---

# Part 1 — Storage Bucket Documentation

Create or update:

```text
docs/storage/offer-images-bucket.md
```

Document:

```text
Bucket name: offer-images
Public read: yes
Allowed file types: image/webp, image/jpeg, image/png
Recommended format: webp
Recommended max image size: 1–2 MB
Recommended dimensions: 600–1200px wide
Recommended crop: item offer crop from leaflet
Upload access: service role / trusted server-side tool only
```

Explain why public read is acceptable:

```text
Offer item images are public leaflet/offer images displayed to users.
```

Explain that upload/delete must not be public.

---

# Part 2 — External Tool Contract Documentation

Create:

```text
docs/integrations/external-offer-ingestion-tool.md
```

Document the expected external tool contract.

The tool should upload images to:

```text
Supabase Storage bucket: offer-images
Path:
{supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp
```

The tool should insert/update offers with:

```text
supermarket_id
location_scope
city_id
region_id
offer_source_id or import_batch_id
title_ar
title_en
brand_id
category_id
product_id
offer_price
original_price
discount_amount
discount_percentage
pack_size_value
pack_size_unit
pack_quantity
unit_price
unit_price_unit
offer_start_date
offer_end_date
status
image_url
image_path
image_source_type
source_page_number
source_item_number
source_reference
```

Recommended default status:

```text
needs_review
```

until the ingestion tool is trusted.

Document that the tool must not expose `SUPABASE_SERVICE_ROLE_KEY`.

---

# Part 3 — Database Schema Review and Migration

Inspect current `offers` and `offer_sources` schema.

If the following fields already exist, reuse them:

```text
offers.image_url
offers.source_page_number
offers.source_reference
offer_sources
```

If missing, create a new additive migration, next available number, for example:

```text
database/migrations/004_offer_image_ingestion_metadata.sql
```

Add safe nullable fields as needed:

```text
offers.image_url text
offers.image_path text
offers.image_bucket text default 'offer-images'
offers.image_source_type text
offers.source_page_number integer
offers.source_item_number text
offers.external_image_id text
offers.ingestion_source text
```

If `offer_sources` exists, consider adding:

```text
offer_sources.leaflet_id text
offer_sources.source_url text
offer_sources.storage_prefix text
offer_sources.image_count integer
```

Use nullable fields where possible to avoid breaking existing data.

Add indexes where useful:

```text
offers.offer_source_id
offers.image_path
offers.external_image_id
offer_sources.leaflet_id
```

Do not make image fields required, because some offers may not have images.

Update `database/migrations/001_initial_schema.sql` for future clean installs if needed, but still create the additive migration for the existing Supabase database.

---

# Part 4 — Image URL Helper

Create or update:

```text
lib/images/offer-images.ts
```

Suggested exports:

```ts
export const OFFER_IMAGES_BUCKET = "offer-images";

export function buildOfferImagePath(input: {
  supermarketSlug: string;
  coverageScope: "national" | "region" | "city";
  locationSlug: string;
  leafletId: string;
  itemNumber: string | number;
  extension?: "webp" | "jpg" | "jpeg" | "png";
}): string;

export function buildOfferImagePublicUrl(input: {
  supabaseUrl: string;
  bucket?: string;
  path: string;
}): string;

export function getOfferImageAlt(input: {
  titleAr?: string | null;
  titleEn?: string | null;
  supermarketName?: string | null;
  locale: "ar" | "en";
}): string;
```

Requirements:

* Path output should be URL-safe.
* Slugs should be lowercase.
* No spaces.
* Item number should be zero-padded where practical.
* Do not expose secret keys.
* Public URL builder must use only public Supabase project URL.

---

# Part 5 — Public Offer Card Image Display

Update:

```text
components/public/OfferCard.tsx
```

Requirements:

* Use `offer.image_url` if available.
* Show the actual offer crop image clearly.
* Use proper `alt` text.
* Avoid broken image icons.
* If image fails, fallback to category placeholder.
* Image area should work for leaflet crop aspect ratios.
* Do not overly crop important price/product info if the image already contains both.
* Use `object-contain` or a design that preserves the whole crop.
* Keep card visually polished.
* Do not make the card too tall.

Important: leaflet offer crops often include text and prices inside the image. Use `object-contain`, not aggressive `object-cover`, unless a specific container is designed to preserve readability.

---

# Part 6 — Offer Detail Image Display

Update:

```text
components/public/OfferDetail.tsx
```

Requirements:

* Show larger offer crop image.
* Preserve full image visibility.
* Use `object-contain`.
* Provide fallback placeholder.
* Show source/leaflet metadata where available:

  * supermarket
  * leaflet/source reference
  * page number
  * item number
* Keep price and structured data visible separately, not only inside the image.

---

# Part 7 — Admin Offer Image Visibility

Update admin offer/review pages where practical:

```text
app/admin/offers/page.tsx
app/admin/review/page.tsx
app/admin/offers/[id]/edit/page.tsx
components/admin/OfferForm.tsx
components/admin/ImportPreviewTable.tsx
components/admin/AiJsonPreviewTable.tsx
```

Requirements:

* Show image thumbnail if `image_url` exists.
* Admin can see image path/source metadata if available.
* Admin can manually paste/replace `image_url` if the offer form already supports image fields.
* Do not build a full image editor.

---

# Part 8 — Import Compatibility

Ensure existing import flows can accept image fields:

```text
CSV import
AI JSON import
manual admin offer creation
external DB insertion
```

Accept fields:

```text
image_url
image_path
image_bucket
image_source_type
source_page_number
source_item_number
external_image_id
```

For AI JSON import, keep existing candidate image URL validation, but also allow trusted external-tool image URLs from Supabase Storage.

For CSV import, document accepted columns.

Do not require images for import.

---

# Part 9 — Image Fallbacks

Ensure fallback hierarchy:

```text
1. offer.image_url if valid and loads
2. product/category placeholder image
3. generic grocery placeholder
```

No broken image icons should be visible.

---

# Part 10 — Security and Key Handling

Document:

* external tool must use service role key only server-side
* never expose service role key in browser/app UI
* external tool should not run from public frontend
* bucket is public-read but not public-write
* images are public offer assets
* delete/overwrite should require service role or admin-only operation

If RLS/storage policies are present, document or update them as needed.

Do not loosen database RLS for public writes.

---

# Part 11 — External Tool Recommended Workflow

In documentation, define this workflow:

```text
1. Generate leaflet_id:
   {supermarket_slug}-{coverage_scope}-{location_slug}-{valid_to}

2. For each extracted item:
   - crop offer image
   - optimize to webp
   - name as 001.webp, 002.webp, etc.
   - upload to offer-images bucket path:
     {supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp

3. Get public image URL.

4. Create/find offer_source row:
   supermarket_id
   location_scope
   city_id/region_id
   valid_to
   source_reference
   leaflet_id
   storage_prefix

5. Insert offers:
   status = needs_review
   image_url
   image_path
   image_bucket = offer-images
   source_page_number
   source_item_number
   external_image_id
   offer_source_id

6. Admin reviews and publishes in Wifran.
```

---

# Part 12 — Example Payload

Add an example in docs:

```json
{
  "leaflet_id": "panda-city-riyadh-2026-06-05",
  "supermarket_slug": "panda",
  "coverage_scope": "city",
  "location_slug": "riyadh",
  "valid_to": "2026-06-05",
  "items": [
    {
      "source_item_number": "001",
      "source_page_number": 1,
      "title_ar": "أرز أبو كاس مزة هندي بسمتي ١٠ كجم",
      "title_en": "Abu Kass Indian Mazza Basmati Rice 10kg",
      "offer_price": 59.99,
      "original_price": 91.99,
      "pack_size_value": 10,
      "pack_size_unit": "kg",
      "image_path": "panda/city/riyadh/panda-city-riyadh-2026-06-05/001.webp",
      "image_url": "https://PROJECT.supabase.co/storage/v1/object/public/offer-images/panda/city/riyadh/panda-city-riyadh-2026-06-05/001.webp"
    }
  ]
}
```

---

# Part 13 — Documentation Update

Update README with links to:

```text
docs/storage/offer-images-bucket.md
docs/integrations/external-offer-ingestion-tool.md
```

---

# Part 14 — Testing

Run:

```bash
npm run lint
npm run build
```

Manual QA:

1. Add an offer with `image_url` pointing to a valid image.
2. Confirm offer card displays the image clearly.
3. Confirm offer detail displays larger image clearly.
4. Confirm image uses `object-contain` and does not crop important text.
5. Confirm missing image falls back to category placeholder.
6. Confirm broken image falls back gracefully.
7. Confirm admin review table shows thumbnail if available.
8. Confirm public pages still work.
9. Confirm active-offer and location filtering still work.
10. Confirm no service role key is exposed.

---

## Acceptance Criteria

This chunk is complete when:

* Wifran supports offer item image URLs from external ingestion.
* Supabase Storage bucket strategy is documented.
* External tool upload path contract is documented.
* Offer image metadata fields exist or are confirmed existing.
* New additive migration exists if needed.
* Offer cards display real offer item images.
* Offer detail displays real offer item images.
* Fallbacks work for missing/broken images.
* Import/manual/admin flows can handle image fields.
* External tool contract documentation exists.
* README links to the docs.
* `npm run lint` passes.
* `npm run build` passes.