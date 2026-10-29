# Wifran DB Schema and Sync Rules

## 1. Purpose of This Document

This document explains how the Wifran Offers Extractor should understand and sync with the existing Wifran database.

Antigravity must use this document when implementing:

* Supabase connection logic.
* Reference data loading.
* Import batch creation.
* OCR result persistence.
* Product, brand, and category normalization.
* Offer insert/update logic.
* Image URL linking.
* Validation error tracking.
* Audit logging.

The extractor must not blindly insert raw OCR output into the final `offers` table. It must preserve raw extraction data, validate it, normalize it, and then sync valid rows safely.

## 2. Database Platform

Wifran uses **Supabase**.

The extractor app should connect to the same Supabase project used by Wifran.

The attached Wifran `.env.local` shows that the existing Wifran app uses these relevant Supabase-related environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ACCESS_TOKEN
```

For this extractor app, use extractor-specific names in `.env` / `.env.local`:

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=
```

Do not expose or hardcode any real secret values.

## 3. Security Rule for Supabase Keys

The extractor is an internal desktop ETL tool. It may need privileged access because it must insert/update offers, import batches, import rows, validation errors, products, brands, categories, and storage objects.

Important rules:

* Never hardcode Supabase keys in source code.
* Never commit `.env.local`.
* Provide `.env.example` only.
* Never expose `SUPABASE_SERVICE_ROLE_KEY` in the Electron renderer process.
* Any operation using the service role key must run in the Electron main process or another protected backend layer.
* The renderer should communicate with the main process through safe IPC methods.
* Do not pass service keys through UI state, browser storage, localStorage, or frontend logs.
* Avoid logging full Supabase request headers.
* Avoid logging secrets.

## 4. RLS Context

The Wifran database has Row Level Security enabled on important tables.

The RLS hardening migration defines:

* Public users can read only published offers.
* Admins can manage offers.
* Admins can manage import batches.
* Admins can manage import rows.
* Admins can manage validation errors.
* Admins can read audit logs.
* Audit log inserts are typically expected through privileged service role logic.

Because this extractor performs administrative ingestion, it should use either:

### Option A: Supabase service role key

This is simplest for the MVP.

Use the service role key only in the Electron main process.

### Option B: Admin login

The operator logs in as an admin user, and database operations are performed through normal Supabase auth with admin RLS permissions.

This is safer for long-term auditability but requires more authentication UI.

### Option C: Internal ingestion API

The desktop app sends extraction results to a secure backend API, and that backend performs privileged DB/storage operations.

This is best for production security but larger in scope.

## 5. MVP Decision

For the MVP, implement using:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
```

The app may also keep `SUPABASE_ANON_KEY` available for non-privileged reads if useful, but privileged writes must use the service role client in the main process.

Antigravity must keep all service-role operations outside the renderer.

## 6. Important Tables

The extractor must understand these Wifran tables:

```text
cities
regions
supermarkets
supermarket_regions
categories
brands
units
products
product_aliases
profiles
offer_sources
offers
offer_status_history
import_batches
import_rows
validation_errors
audit_logs
```

User-facing tables such as `saved_offers`, `watched_items`, `shopping_lists`, and `issue_reports` are not part of the extractor MVP except indirectly through the existing schema.

## 7. Core Reference Tables

### 7.1 `cities`

Stores supported cities.

Relevant fields:

```text
id
name_ar
name_en
slug
country_code
is_active
sort_order
```

Extractor usage:

* Load active cities for the location selector.
* Attach selected `city_id` to `offer_sources`, `import_batches`, and `offers` when the leaflet applies to a city.

### 7.2 `regions`

Stores broader geographic regions.

Relevant fields:

```text
id
name_ar
name_en
slug
is_active
```

Extractor usage:

* Load active regions for the location selector.
* Attach selected `region_id` to `offer_sources`, `import_batches`, and `offers` when the leaflet applies to a region.

### 7.3 `supermarkets`

Stores supermarket chains.

Relevant fields:

```text
id
name_ar
name_en
slug
logo_url
website_url
is_active
sort_order
notes
```

Extractor usage:

* Load active supermarkets for the supermarket selector.
* Attach selected `supermarket_id` to `offer_sources`, `import_batches`, and `offers`.

### 7.4 `supermarket_regions`

Maps supermarkets to cities and/or regions.

Relevant fields:

```text
id
supermarket_id
location_scope
location_slug
city_id
region_id
is_active
```

Important constraint:

```text
location_scope in ('national', 'region', 'city')
city_id is not null OR region_id is not null OR location_scope = 'national'
```

Extractor usage:

* Use this table to limit valid city/region choices for the selected supermarket.
* If the selected supermarket has known city/region coverage, only show active supported combinations.
* Do not allow the user to process a leaflet for an invalid supermarket/location combination unless explicitly allowed later.

## 8. Product Taxonomy Tables

### 8.1 `categories`

Stores product categories.

Relevant fields:

```text
id
parent_id
name_ar
name_en
slug
description_ar
description_en
icon_name
is_active
sort_order
requires_unit_price
default_unit_type
```

Extractor usage:

* Match OCR `category_name_ar` / `category_name_en` to an existing category.
* Reuse existing category when possible.
* If no confident match exists, either:

  * leave `category_id` null and mark row as `warning` / `needs_review`, or
  * create a new category only if this behavior is explicitly enabled in settings.

MVP recommendation:

* Do not automatically create new categories unless the confidence is high and the name is clean.
* Prefer marking uncertain categories for review.

### 8.2 `brands`

Stores product brands.

Relevant fields:

```text
id
name_ar
name_en
slug
is_active
```

Important constraint:

```text
name_ar is not null OR name_en is not null
```

Extractor usage:

* Match OCR `brand_name_ar` / `brand_name_en` to an existing brand.
* Reuse the brand when possible.
* Create a new brand if no match exists and at least one brand name is present.
* If brand is missing, keep `brand_id` null.

Brand creation rules:

* Do not invent missing brand names.
* Do not translate brand names creatively.
* Preserve Arabic brand names as extracted.
* Preserve English brand names as extracted.
* Generate a stable slug from the best available name.
* Before inserting a brand, check existing brands by slug, normalized Arabic name, normalized English name, and fuzzy match where appropriate.

### 8.3 `units`

Stores units.

Relevant fields:

```text
id
code
name_ar
name_en
symbol_ar
symbol_en
base_unit_code
conversion_to_base
is_active
sort_order
```

Extractor usage:

* Use as a reference for allowed units.
* OCR output may produce units as text such as `g`, `kg`, `ml`, `liter`, `piece`, `pack`, `box`, or Arabic equivalents.
* Normalize units before inserting offers.

Recommended normalized unit codes for extraction:

```text
g
kg
ml
l
piece
pack
box
carton
other
```

If the DB already contains different unit codes, map to the existing DB values.

### 8.4 `products`

Stores normalized products.

Relevant fields:

```text
id
category_id
brand_id
name_ar
name_en
slug
description_ar
description_en
default_image_url
default_pack_size_value
default_pack_size_unit
default_unit_type
is_normalized
is_active
```

Important constraint:

```text
name_ar is not null OR name_en is not null
```

Extractor usage:

* Try to match each extracted item to an existing product.
* If matched, use existing `product_id`.
* If not matched, create a new product when product name is present.
* Link product to matched/created brand and category when available.
* Set `is_normalized` to `false` for products created directly from OCR unless manually reviewed or high-confidence normalization is implemented.

Product creation rules:

* Do not create a product if both Arabic and English names are missing.
* Prefer Arabic name from leaflet when visible.
* Use English name when visible or when OCR has produced a reliable translation according to extraction rules.
* Do not over-normalize names in a way that loses important pack or variant details.
* If the leaflet item title includes both brand and product type, store a practical product name but preserve the full title in `offers.title_ar` / `offers.title_en`.

### 8.5 `product_aliases`

Stores alternate product names from leaflets and other sources.

Relevant fields:

```text
id
product_id
alias_text
language
source
```

Extractor usage:

* Use aliases to match messy leaflet product text to existing products.
* When a new product is created from OCR, create aliases for the raw extracted names.
* When an existing product is matched through OCR text, optionally add the raw OCR text as an alias if it is not already present.

Recommended alias source:

```text
wifran_offers_extractor
```

Recommended language values:

```text
ar
en
mixed
unknown
```

## 9. Offer Source Table

### `offer_sources`

Represents the source leaflet/document.

Relevant fields:

```text
id
source_type
supermarket_id
location_scope
location_slug
city_id
region_id
title
source_url
file_url
leaflet_id
valid_from
valid_to
notes
created_by
created_at
```

Extractor usage:

* Create one `offer_sources` record per imported leaflet PDF.
* Use `source_type = 'leaflet_pdf'`.
* Link to selected supermarket, city, and/or region.
* Use selected offer start/end dates as `valid_from` and `valid_to`.
* Store the PDF storage URL in `file_url` if the original PDF is uploaded.
* Store human-readable source title.

Recommended title format:

```text
{Supermarket Name} leaflet - {City/Region} - {YYYY-MM-DD} to {YYYY-MM-DD}
```

If the MVP does not upload the original PDF, `file_url` may be null.

## 10. Main Destination Table: `offers`

The final offer records go into `offers`.

Relevant fields:

```text
id

product_id
supermarket_id
location_scope
city_id
region_id
category_id
brand_id

title_ar
title_en

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
image_bucket
image_source_type
source_id
offer_source_id
source_page_number
source_item_number
source_reference
external_image_id

deal_score
deal_label
data_quality_score

is_loyalty_required
loyalty_notes_ar
loyalty_notes_en

quantity_limit
notes_ar
notes_en

created_by
updated_by
approved_by
published_at

created_at
updated_at
```

Important constraints:

```text
offer_price > 0
original_price is null OR original_price >= offer_price
offer_start_date is null OR offer_end_date >= offer_start_date
title_ar is not null OR title_en is not null
city_id is not null OR region_id is not null
status in ('draft', 'needs_review', 'approved', 'published', 'expired', 'rejected')
```

## 11. Offer Status Rules

For MVP imports, use these statuses:

```text
draft
needs_review
```

Recommended behavior:

* Valid rows may be inserted as `draft`.
* Rows with warnings or low confidence should be inserted as `needs_review` or should remain only in `import_rows` until reviewed.
* Do not automatically publish offers unless the user explicitly wants the extractor to publish directly.

Default MVP recommendation:

```text
Insert valid offers with status = 'draft'
Insert questionable offers with status = 'needs_review'
Do not use status = 'published' automatically
```

## 12. Import Tracking Tables

### 12.1 `import_batches`

Tracks each PDF import operation.

Relevant fields:

```text
id
uploaded_by
supermarket_id
location_scope
city_id
region_id
source_id
leaflet_id
file_name
file_url
file_type
status
total_rows
valid_rows
warning_rows
error_rows
imported_rows
skipped_rows
offer_start_date
offer_end_date
created_at
updated_at
completed_at
```

Allowed statuses:

```text
uploaded
parsed
validated
imported
partially_imported
failed
cancelled
```

Extractor status mapping:

```text
App status: pending              -> DB status: uploaded
App status: processing OCR        -> DB status: parsed
App status: validating            -> DB status: validated
App status: completed             -> DB status: imported
App status: partially completed   -> DB status: partially_imported
App status: failed                -> DB status: failed
App status: cancelled             -> DB status: cancelled
```

Batch creation rules:

* Create an `import_batches` record immediately after the user starts extraction.
* Set `file_name`, `file_type = 'pdf'`, selected supermarket/location, and selected offer dates.
* Link `source_id` after creating the `offer_sources` record.
* Update row counts after OCR and validation.
* Set `completed_at` when processing finishes.

### 12.2 `import_rows`

Tracks each extracted item row.

Relevant fields:

```text
id
import_batch_id
row_number
raw_data
normalized_data
status
created_offer_id
created_at
updated_at
```

Allowed statuses:

```text
valid
warning
error
imported
skipped
```

Extractor usage:

* Create one `import_rows` record per extracted offer item.
* Store full raw OCR item JSON in `raw_data`.
* Store normalized payload in `normalized_data`.
* Update `created_offer_id` after inserting the final offer.
* Use `status = 'valid'` when row passes validation but has not yet been imported.
* Use `status = 'warning'` when row can proceed but needs attention.
* Use `status = 'error'` when row cannot be imported.
* Use `status = 'imported'` after offer record is created.
* Use `status = 'skipped'` for duplicates or intentionally skipped rows.

### 12.3 `validation_errors`

Tracks validation problems.

Relevant fields:

```text
id
import_batch_id
import_row_id
offer_id
severity
field_name
error_code
message
created_at
```

Allowed severities:

```text
error
warning
info
```

Extractor usage:

* Save validation issues for rows and batches.
* Use `severity = 'error'` for blocking problems.
* Use `severity = 'warning'` for non-blocking quality issues.
* Use `severity = 'info'` for duplicate/skipped/informational notes.

Recommended error codes:

```text
PDF_READ_ERROR
PDF_SPLIT_ERROR
PAGE_RENDER_ERROR
OCR_API_ERROR
OCR_RATE_LIMIT
OCR_TIMEOUT
OCR_JSON_PARSE_ERROR
OCR_EMPTY_RESPONSE
MISSING_PRODUCT_NAME
MISSING_OFFER_PRICE
INVALID_OFFER_PRICE
INVALID_ORIGINAL_PRICE
INVALID_DATE_RANGE
INVALID_PACK_SIZE
INVALID_PACK_QUANTITY
UNKNOWN_UNIT
LOW_CONFIDENCE_EXTRACTION
MISSING_BOUNDING_BOX
INVALID_BOUNDING_BOX
IMAGE_CROP_FAILED
IMAGE_UPLOAD_FAILED
BRAND_MATCH_UNCERTAIN
CATEGORY_MATCH_UNCERTAIN
PRODUCT_MATCH_UNCERTAIN
DUPLICATE_OFFER_DETECTED
DB_INSERT_FAILED
DB_UPDATE_FAILED
STORAGE_UPLOAD_FAILED
```

## 13. Audit Logs

### `audit_logs`

Relevant fields:

```text
id
actor_id
action
entity_type
entity_id
metadata
created_at
```

Extractor usage:

* Log major import events where useful.
* Insert audit logs using service role logic.
* Do not log secrets.

Recommended actions:

```text
import_batch_created
ocr_started
ocr_completed
validation_completed
offer_created
offer_updated
offer_skipped_duplicate
import_batch_completed
import_batch_failed
```

Example metadata:

```json
{
  "source": "wifran_offers_extractor",
  "file_name": "weekly_leaflet.pdf",
  "supermarket_id": "...",
  "city_id": "...",
  "region_id": "...",
  "total_rows": 120,
  "imported_rows": 110,
  "warning_rows": 8,
  "error_rows": 2
}
```

## 14. OCR Field to DB Field Mapping

The OCR extractor should produce a normalized item object. Map it to Wifran DB as follows.

```text
OCR page_number
-> offers.source_page_number
-> import_rows.raw_data.page_number

OCR row_id
-> import_rows.raw_data.row_id
-> offers.source_reference, if useful

OCR product_name_ar
-> products.name_ar, if creating product
-> offers.title_ar

OCR product_name_en
-> products.name_en, if creating product
-> offers.title_en

OCR brand_name_ar
-> brands.name_ar

OCR brand_name_en
-> brands.name_en

OCR category_name_ar
-> categories.name_ar, for matching only

OCR category_name_en
-> categories.name_en, for matching only

OCR description_ar
-> products.description_ar, if creating product and appropriate
-> offers.notes_ar, if it is offer-specific

OCR description_en
-> products.description_en, if creating product and appropriate
-> offers.notes_en, if it is offer-specific

OCR offer_price
-> offers.offer_price

OCR original_price
-> offers.original_price

OCR discount_text
-> offers.source_reference or notes
-> may also be used to calculate discount_amount/discount_percentage when possible

OCR pack_size_value
-> offers.pack_size_value
-> products.default_pack_size_value, if creating product and stable

OCR pack_size_unit
-> offers.pack_size_unit
-> products.default_pack_size_unit, if creating product and stable

OCR pack_quantity
-> offers.pack_quantity

OCR unit_price
-> offers.unit_price, if calculated or extracted

OCR unit_price_unit
-> offers.unit_price_unit

OCR quantity_limit
-> offers.quantity_limit

OCR is_loyalty_required
-> offers.is_loyalty_required

OCR loyalty_notes_ar
-> offers.loyalty_notes_ar

OCR loyalty_notes_en
-> offers.loyalty_notes_en

OCR notes_ar
-> offers.notes_ar

OCR notes_en
-> offers.notes_en

OCR bounding_box
-> import_rows.raw_data.bounding_box
-> normalized_data.bounding_box
-> used to generate cropped image

Cropped image URL
-> offers.image_url

OCR confidence / calculated confidence
-> offers.data_quality_score
-> import_rows.normalized_data.confidence
```

## 15. Required Fields Before Creating an Offer

Do not create a final `offers` record unless these are valid:

```text
supermarket_id
city_id OR region_id
title_ar OR title_en
offer_price > 0
offer_end_date
```

Recommended additional required fields for high-quality rows:

```text
offer_start_date
source_id
source_page_number
image_url
```

If recommended fields are missing but core DB constraints pass, mark the offer as `needs_review`.

## 16. Price Rules

### 16.1 `offer_price`

Required.

Rules:

* Must be numeric.
* Must be greater than 0.
* Must be SAR amount.
* Remove currency symbols before parsing.
* Convert Arabic numerals if needed.
* Reject or flag impossible values.

### 16.2 `original_price`

Optional.

Rules:

* Must be numeric if present.
* Must be greater than or equal to `offer_price`.
* If OCR returns an original price lower than offer price, keep the row as warning/error depending on context.
* Do not invent original price.

### 16.3 `discount_amount`

Can be calculated when both `offer_price` and `original_price` are present:

```text
discount_amount = original_price - offer_price
```

### 16.4 `discount_percentage`

Can be calculated when both `offer_price` and `original_price` are present and `original_price > 0`:

```text
discount_percentage = ((original_price - offer_price) / original_price) * 100
```

Round according to app standards, preferably 2 decimal places.

## 17. Pack and Unit Rules

### 17.1 `pack_size_value`

Optional numeric field.

Examples:

```text
1800
400
1
10
```

### 17.2 `pack_size_unit`

Optional text field.

Examples:

```text
g
kg
ml
l
liter
piece
pack
box
carton
```

Normalize Arabic and English units.

Examples:

```text
جرام -> g
جم -> g
كيلو -> kg
كجم -> kg
مل -> ml
لتر -> l
حبة -> piece
قطعة -> piece
ربطة -> pack
كرتون -> carton
```

### 17.3 `pack_quantity`

Optional numeric field.

Default:

```text
1
```

Examples:

```text
1
2
6
10
```

For offers such as `1+1`, the final quantity may be interpreted as 2 if the leaflet clearly indicates two items.

For offers such as `2+2`, the final quantity may be interpreted as 4 if the leaflet clearly indicates four items.

Keep the raw discount text in `source_reference` or notes so the original deal wording is not lost.

### 17.4 `unit_price`

Optional.

If not extracted directly, calculate when possible.

Example formula:

```text
unit_price = offer_price / (pack_size_value * pack_quantity)
```

Only calculate when unit and quantity are meaningful.

Do not calculate if pack data is ambiguous.

## 18. Product Matching Rules

For each extracted row:

1. Normalize product Arabic and English names.
2. Check `product_aliases.alias_text`.
3. Check exact product name match.
4. Check product slug.
5. Check brand + product name combination.
6. Use fuzzy matching only as an aid, not as a silent automatic decision unless confidence is high.
7. If confident match exists, reuse product.
8. If no confident match exists and product name exists, create a new product.
9. If product name is missing, do not create product and mark row as error.

When creating a product:

* Set `category_id` if matched confidently.
* Set `brand_id` if matched or created.
* Set `name_ar` and/or `name_en`.
* Set `slug`.
* Set default pack fields if clear.
* Set `is_normalized = false`.
* Set `is_active = true`.

## 19. Brand Matching Rules

For each extracted row:

1. If both brand names are missing, leave `brand_id = null`.
2. Normalize Arabic and English names.
3. Try exact name match.
4. Try slug match.
5. Try fuzzy match.
6. If confident match exists, reuse brand.
7. If no match exists and at least one brand name exists, create brand.
8. If uncertain, create validation warning.

Do not invent a brand from the product name unless the OCR explicitly identified it or the app’s matching rules are highly confident.

## 20. Category Matching Rules

For each extracted row:

1. If category names are missing, leave `category_id = null` and create warning.
2. Try exact Arabic/English category match.
3. Try slug match.
4. Try fuzzy match.
5. If confident match exists, reuse category.
6. If no confident match exists, mark as warning or needs review.

MVP recommendation:

* Do not create new categories automatically by default.
* Category creation can be added later as an admin feature.

## 21. Duplicate Offer Detection

Before creating a new offer, search for likely duplicates.

Recommended duplicate criteria:

```text
same supermarket_id
same city_id OR same region_id
same product_id, if available
same title_ar/title_en if product_id is null
same offer_start_date
same offer_end_date
same offer_price
same pack_size_value
same pack_size_unit
same pack_quantity
```

If a duplicate is found:

* Do not create another offer by default.
* Mark import row as `skipped`.
* Add validation info with code `DUPLICATE_OFFER_DETECTED`.
* Optionally update existing offer only if update mode is explicitly enabled.

MVP recommendation:

```text
Default duplicate behavior = skip and report
```

## 22. Image URL Rules

Each valid offer should have a cropped item image when possible.

Storage upload should happen before creating or finalizing the offer record.

Recommended storage path format:

```text
offers/{supermarket_slug}/{offer_start_date}/{import_batch_id}/page-{page_number}/item-{row_number}.jpg
```

After upload:

```text
offers.image_url = uploaded image public URL or signed URL strategy used by Wifran
```

If image upload fails:

* Keep raw import row.
* Mark row as warning or error depending on whether image is required.
* Do not crash the entire batch.

MVP recommendation:

* Treat missing image as `warning` if all required offer data exists.
* Set offer status to `needs_review`.

## 23. Import Batch Lifecycle

Recommended lifecycle:

### Step 1: Create `offer_sources`

Create one source record:

```text
source_type = 'leaflet_pdf'
supermarket_id = selected supermarket
city_id = selected city, if selected
region_id = selected region, if selected
title = generated title
file_url = uploaded original PDF URL if available
valid_from = selected offer start date
valid_to = selected offer end date
```

### Step 2: Create `import_batches`

Create batch:

```text
source_id = created offer source
supermarket_id = selected supermarket
city_id = selected city, if selected
region_id = selected region, if selected
file_name = selected PDF file name
file_url = uploaded original PDF URL if available
file_type = 'pdf'
status = 'uploaded'
offer_start_date = selected start date
offer_end_date = selected end date
```

### Step 3: OCR and parse

After OCR parsing:

```text
status = 'parsed'
total_rows = number of extracted OCR items
```

### Step 4: Validate

After validation:

```text
status = 'validated'
valid_rows = count valid
warning_rows = count warning
error_rows = count error
```

### Step 5: Import

After DB/storage sync:

```text
status = 'imported' if all rows imported
status = 'partially_imported' if some rows imported and some failed/skipped
status = 'failed' if no rows imported due to fatal failure
imported_rows = count imported
skipped_rows = count skipped
completed_at = now
```

## 24. Import Row Lifecycle

For every extracted OCR item:

### Step 1: Save raw row

```text
import_batch_id
row_number
raw_data = full OCR item JSON
status = 'valid' or 'warning' or 'error'
```

### Step 2: Save normalized row

After normalization:

```text
normalized_data = normalized payload prepared for offer creation
```

### Step 3: Link created offer

After offer insert:

```text
created_offer_id = offer.id
status = 'imported'
```

### Step 4: Handle skipped duplicate

If duplicate:

```text
status = 'skipped'
created_offer_id = existing offer ID if useful in normalized_data
```

## 25. Data Quality Score

The `offers` table includes `data_quality_score`.

Suggested scale:

```text
0 to 100
```

Recommended scoring:

```text
+20 product title exists
+20 offer price valid
+10 original price valid or not required
+10 brand matched/created
+10 category matched
+10 pack data valid
+10 image cropped/uploaded
+10 OCR confidence acceptable
```

Rows below a threshold should become `needs_review`.

Suggested threshold:

```text
data_quality_score < 70 -> status = 'needs_review'
data_quality_score >= 70 -> status = 'draft'
```

This is a suggested MVP scoring system and can be adjusted.

## 26. Deal Score and Deal Label

The `offers` table includes:

```text
deal_score
deal_label
```

For MVP:

* These fields may be left null unless simple calculation is implemented.
* If original price exists, a simple discount-based deal score can be calculated.
* Do not block offer creation if deal score is missing.

Possible labels:

```text
good_deal
great_deal
limited_offer
unknown
```

Only use labels if Wifran frontend expects them.

## 27. Status History

The table `offer_status_history` exists.

For MVP:

* Status history insertion is optional.
* If implemented, insert a row when creating an offer with `draft` or `needs_review`.
* Insert another row if later approval/publishing is implemented.

## 28. Slug Generation Rules

For `brands`, `products`, and categories if ever created:

* Generate lowercase slugs.
* Remove unsafe punctuation.
* Normalize whitespace.
* Use English name if available.
* Otherwise transliterate or safely slugify Arabic text.
* Ensure uniqueness.
* If slug exists, append short suffix.

Do not let slug collision crash the whole import.

## 29. Normalized Data Shape for `import_rows.normalized_data`

Use a consistent JSON shape.

Example:

```json
{
  "source": {
    "page_number": 1,
    "row_id": "page-1-item-3",
    "source_reference": "1+1"
  },
  "matched": {
    "product_id": null,
    "brand_id": null,
    "category_id": null,
    "duplicate_offer_id": null
  },
  "offer": {
    "title_ar": "حليب هايل بودرة",
    "title_en": "Haley Milk Powder",
    "offer_price": 62.95,
    "original_price": 125.9,
    "discount_amount": 62.95,
    "discount_percentage": 50,
    "pack_size_value": 1800,
    "pack_size_unit": "g",
    "pack_quantity": 2,
    "unit_price": 0.0175,
    "unit_price_unit": "g",
    "quantity_limit": null,
    "is_loyalty_required": false,
    "notes_ar": "2 حبة",
    "notes_en": "2 PCS",
    "status": "draft",
    "data_quality_score": 90
  },
  "image": {
    "local_path": "temp/imports/.../item.jpg",
    "storage_path": "offers/...",
    "image_url": "https://..."
  },
  "bounding_box": {
    "x": 120,
    "y": 450,
    "width": 300,
    "height": 300
  },
  "warnings": [],
  "errors": []
}
```

## 30. Supabase Client Structure

Use two Supabase clients if needed:

### Public/anon client

For safe non-privileged reads if useful:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

### Admin/service client

For privileged import operations:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Rules:

* Service client must only exist in Electron main process or secure backend code.
* Renderer must call main process methods such as:

  * `loadSupermarkets`
  * `loadLocationsForSupermarket`
  * `createImportBatch`
  * `startExtraction`
  * `syncOffers`
* Renderer must never receive the service role key.

## 31. Required Reference Data Loading

On app startup or import screen load:

Load active:

```text
supermarkets
cities
regions
supermarket_regions
categories
brands
units
```

Recommended order:

1. Load supermarkets.
2. Load cities.
3. Load regions.
4. Load supermarket_regions.
5. Load categories.
6. Load brands.
7. Load units.

When the user selects a supermarket:

* Filter city/region choices using `supermarket_regions`.
* Only show active combinations.

## 32. Error Handling for DB Sync

Database errors must be captured and stored where possible.

If batch-level operation fails before batch creation:

* Show error in UI.
* Write local log.

If batch exists:

* Update `import_batches.status = 'failed'`.
* Insert `validation_errors` if applicable.
* Do not lose local raw OCR data.

If row-level operation fails:

* Mark the row as `error`.
* Insert `validation_errors`.
* Continue processing other rows.

Do not fail the entire import because one product, image, or offer insert fails.

## 33. What Antigravity Must Not Do

Antigravity must not:

* Change the existing Wifran schema unless explicitly instructed.
* Add migrations without being asked.
* Store secrets in frontend code.
* Insert raw OCR directly into `offers` without validation.
* Create published offers by default.
* Ignore `import_batches`, `import_rows`, and `validation_errors`.
* Skip duplicate detection.
* Assume every leaflet item has a product match.
* Assume every OCR row is valid.
* Assume city or region can be null for offers.
* Delete existing Wifran data.
* Modify user-facing tables such as saved offers or shopping lists.
* Expose service role key through renderer IPC.
* Log secret values.

## 34. MVP Sync Summary

For each leaflet import:

1. Load selected supermarket and location.
2. Create `offer_sources`.
3. Create `import_batches`.
4. Extract OCR items.
5. Create `import_rows` with raw OCR JSON.
6. Validate and normalize rows.
7. Match/create brands.
8. Match categories.
9. Match/create products.
10. Detect duplicates.
11. Crop/upload item image.
12. Insert `offers` as `draft` or `needs_review`.
13. Update `import_rows.created_offer_id`.
14. Insert `validation_errors` for warnings/errors.
15. Update batch row counts.
16. Mark batch as `imported`, `partially_imported`, or `failed`.
17. Show final summary to user.

## 35. Final Principle

The database sync layer must be conservative.

It is better to mark rows as warnings or needs review than to create incorrect offers.

The extractor is allowed to automate ingestion, but it must preserve traceability through import batches, import rows, validation errors, and source references.
