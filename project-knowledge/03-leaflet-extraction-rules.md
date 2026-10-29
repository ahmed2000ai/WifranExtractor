# Wifran Leaflet Extraction Rules

## 1. Purpose of This Document

This document defines the rules for extracting supermarket offer data from weekly PDF leaflets for Wifran.

Antigravity must use this document when implementing:

* OCR prompt construction.
* OCR response parsing.
* JSON schema validation.
* Offer field normalization.
* Price parsing.
* Pack-size parsing.
* Arabic/English text handling.
* Bounding-box extraction.
* Item image cropping preparation.
* Row confidence and review logic.
* Filtering out non-product promotional areas.

The goal is to turn messy supermarket leaflet pages into structured, reliable Wifran offer data.

## 2. Source Document Type

The source input is a supermarket weekly PDF leaflet.

Leaflets may contain:

* Arabic text.
* English text.
* Mixed Arabic and English text.
* Product images.
* Promotional labels.
* Multiple products per page.
* Multiple prices per page.
* Pack offers such as `1+1`, `2+2`, bundles, cartons, boxes, and multipacks.
* Page headers.
* Page footers.
* Campaign banners.
* Cover pages.
* Decorative graphics.
* Supermarket logos.
* Sponsor logos.
* Date badges.
* Irregular grids where item locations are not predictable.

The extractor must not assume that every leaflet has a clean table layout.

## 3. Extraction Strategy

The extractor should not send the entire PDF leaflet to OCR/AI in one request.

Recommended strategy:

```text
1. Split the PDF locally into pages or small chunks.
2. Render pages locally into images.
3. Send each page or small chunk to the OCR/AI provider.
4. Ask OCR/AI to return strict JSON only.
5. Include bounding boxes for every detected product offer item.
6. Validate the JSON locally.
7. Remove or skip non-product promotional/banner rows.
8. Normalize each extracted row before database sync.
```

Recommended OCR chunk size:

```text
1 to 3 pages per OCR request
```

Recommended default:

```text
2 pages per OCR request
```

Recommended concurrency:

```text
3 or 4 concurrent OCR requests
```

The exact values should be configurable.

## 4. OCR Provider

The default OCR provider is:

```text
Mistral OCR
```

Default model:

```text
mistral-ocr-latest
```

The OCR provider must be instructed to extract supermarket offer items into the strict JSON schema defined in this document.

The app should be designed so another provider can be added later, but the MVP should focus on Mistral OCR.

## 5. Golden Rule

The OCR/AI model must not be allowed to freely summarize the page.

It must extract only product-level offer items as structured records.

The output must be valid JSON.

No markdown.

No explanation.

No prose.

No comments.

No text outside the JSON object.

## 6. Product Offer vs Non-Product Promotional Area

This rule is critical.

Supermarket leaflets often contain large campaign areas such as cover graphics, page banners, date badges, supermarket branding, sponsor logos, and generic discount slogans.

These areas are not Wifran offer records.

The OCR/AI extractor must focus only on actual product offer items and ignore non-product promotional areas.

## 7. Areas the OCR Must Ignore

The OCR must ignore:

* Leaflet cover pages that do not contain specific product offers.
* Campaign banners.
* Page headers.
* Page footers.
* Supermarket logos.
* Sponsor logos.
* Decorative balloons, backgrounds, shapes, celebration graphics, or seasonal artwork.
* General campaign slogans.
* Date badges.
* Generic discount slogans when not attached to a specific product.
* Large promotional graphics that do not contain a specific purchasable product.
* Decorative text such as campaign titles.
* General text such as “offers”, “savings”, “festival”, or “celebration” when it is not a product offer.

Examples of text/areas to ignore when they are not attached to a real product offer:

```text
1+1 عروض تزين عيدك
عروض تزين عيدك
هنا التوفير
May 27 - June 02
Supermarket logo
Sponsored by Lurpak
Decorative balloons
Cover page celebration graphics
Campaign title only
Date badge only
```

If a page contains only these areas and no individual product offers, the OCR response must be:

```json
{
  "items": []
}
```

## 8. What Counts as a Valid Product Offer Item

A valid product offer item should normally include most of the following:

* A specific product or product group.
* A visible product name.
* A visible product image or recognizable product package.
* An offer price.
* Optional original price.
* Optional pack size.
* Optional pack quantity.
* Optional brand.
* Optional discount text.
* Optional notes.

The item should represent something Wifran can store as an `offers` record.

## 9. What Does Not Count as a Product Offer Item

Do not create an item row from:

* A campaign slogan only.
* A generic `1+1` or discount graphic with no product.
* A supermarket logo.
* A sponsor logo.
* A date range badge.
* A page title.
* A decorative graphic.
* A cover page banner.
* A section header with no product.
* A brand sponsorship area that does not show a specific product offer.
* A promotional message without product name and offer price.

Invalid example:

```json
{
  "product_name_ar": "عروض تزين عيدك",
  "offer_price": 1,
  "discount_text": "1+1"
}
```

This is invalid because it is a campaign/banner extraction, not a product offer.

## 10. Required Top-Level OCR Output Shape

Every OCR response should be normalized into this shape:

```json
{
  "items": []
}
```

The `items` array contains one object per supermarket product offer item detected in the page or chunk.

If no product offer items are found, return:

```json
{
  "items": []
}
```

Do not return `null` for the top-level object.

## 11. Required Item Schema

Each extracted item must follow this schema:

```json
{
  "row_id": "string",
  "page_number": 1,
  "product_name_ar": "string or null",
  "product_name_en": "string or null",
  "brand_name_ar": "string or null",
  "brand_name_en": "string or null",
  "category_name_ar": "string or null",
  "category_name_en": "string or null",
  "description_ar": "string or null",
  "description_en": "string or null",
  "offer_price": 0,
  "original_price": 0,
  "discount_text": "string or null",
  "pack_size_value": 0,
  "pack_size_unit": "string or null",
  "pack_quantity": 1,
  "unit_price": 0,
  "unit_price_unit": "string or null",
  "quantity_limit": "string or null",
  "is_loyalty_required": false,
  "loyalty_notes_ar": "string or null",
  "loyalty_notes_en": "string or null",
  "notes_ar": "string or null",
  "notes_en": "string or null",
  "bounding_box": {
    "x": 0,
    "y": 0,
    "width": 0,
    "height": 0
  },
  "confidence": 0,
  "warnings": []
}
```

## 12. Field Definitions

### 12.1 `row_id`

A temporary unique row identifier inside the OCR response.

Rules:

* Required.
* Must be unique within the OCR response.
* Prefer stable format:

```text
page-{page_number}-item-{item_number}
```

Example:

```text
page-3-item-7
```

If OCR provides no row ID, the app should generate one locally after parsing.

### 12.2 `page_number`

The human-visible page number in the original PDF.

Rules:

* Required.
* Must be 1-indexed.
* Page 1 in the PDF should be `page_number = 1`.
* Do not use 0-indexed page numbers in stored extraction data.
* If the OCR API uses 0-indexed pages internally, convert to 1-indexed before saving.
* If a PDF is split into chunks, preserve the original PDF page number, not the chunk-local page number.

### 12.3 `product_name_ar`

The Arabic product name.

Rules:

* Use visible Arabic text from the leaflet when available.
* Preserve the Arabic spelling as much as possible.
* Do not invent Arabic names.
* Do not use campaign slogans as product names.
* Do not translate from English into Arabic unless explicitly configured later.
* If no Arabic product name is visible, return `null`.

Examples:

```text
حليب هايل بودرة
معجون طماطم ندى
هايل مكرونة
ساديا دجاج
العثيم سكر
```

### 12.4 `product_name_en`

The English product name.

Rules:

* Use visible English text from the leaflet when available.
* If the leaflet only has Arabic, OCR may provide a simple literal English translation only if the OCR prompt explicitly requests it.
* Do not create creative marketing names.
* Do not guess missing English names.
* Do not use campaign slogans as product names.
* If not visible and not confidently translated, return `null`.

Examples:

```text
Haley Milk Powder
Nada Tomato Paste
Haley Macaroni
Sadia Chicken
Othaim Sugar
```

### 12.5 `brand_name_ar`

Arabic brand name.

Rules:

* Extract only if visible or clearly inferable from the product name.
* Do not invent.
* Preserve Arabic spelling.
* Do not treat a supermarket logo or campaign sponsor logo as the product brand unless it clearly belongs to the product item.
* Return `null` if missing.

Examples:

```text
هايل
ندى
ساديا
العثيم
كيري
```

### 12.6 `brand_name_en`

English brand name.

Rules:

* Extract only if visible or clearly known from the product label.
* Do not guess obscure brands.
* Do not over-translate.
* Do not treat a sponsor logo in a page banner as the brand for every item.
* Return `null` if missing.

Examples:

```text
Haley
Nada
Sadia
Othaim
Kiri
```

### 12.7 `category_name_ar`

Arabic category.

Rules:

* Use a practical Wifran category if visible or confidently inferred.
* Keep category broad enough for app filtering.
* Return `null` if uncertain.
* Do not create a category from a campaign title.

Examples:

```text
المواد الغذائية الأساسية
الأغذية المعلبة
المجمدات
الألبان
العناية المنزلية
```

### 12.8 `category_name_en`

English category.

Rules:

* Use a practical Wifran category.
* Return `null` if uncertain.
* Do not create a category from a campaign title.

Examples:

```text
Staples
Canned Food
Frozen
Dairy
Household
```

### 12.9 `description_ar`

Arabic product description or variant.

Rules:

* Use this for variant details, flavor, count, or subtype when distinct from the product name.
* Do not duplicate the full product name.
* Do not use generic campaign slogans here.
* Return `null` if not available.

Examples:

```text
24 قطعة
بالليمون
مركز
```

### 12.10 `description_en`

English description or variant.

Examples:

```text
24 Portions
Lemon
Concentrated
```

### 12.11 `offer_price`

The current discounted offer price.

Rules:

* Required for valid offers.
* Must be numeric.
* Must be greater than 0.
* Must be in SAR.
* Remove currency symbols.
* Convert Arabic numerals to Western digits.
* If the offer price is missing or unreadable, return `null` and add warning/error.
* Do not guess prices.
* Do not convert a generic `1+1` banner into `offer_price = 1`.

Examples:

```text
62.95
11.50
9.75
154.99
31.95
```

### 12.12 `original_price`

The old price, crossed-out price, regular price, or before-discount price.

Rules:

* Optional.
* Numeric if present.
* Must be greater than or equal to `offer_price`.
* Return `null` if not shown.
* Do not calculate original price from `1+1` unless the leaflet clearly displays it.
* Do not invent original price.

Examples:

```text
125.90
23.00
19.50
185.00
39.95
```

### 12.13 `discount_text`

The raw promotional discount text for a specific item.

Rules:

* Preserve labels such as `1+1`, `2+2`, percentage labels, bundle text, or special deal labels when attached to a product offer.
* Keep the original meaning.
* Return `null` if not present.
* Do not create a product offer row from discount text alone.
* A generic page banner that says `1+1` should be ignored unless attached to a specific product.

Examples:

```text
1+1
2+2
Buy 1 Get 1
Special Offer
```

### 12.14 `pack_size_value`

The numeric size of one pack or item.

Rules:

* Optional but important.
* Numeric only.
* Do not include the unit here.
* Return `null` if unclear.

Examples:

```text
1800
135
400
1000
10
432
1
5
```

### 12.15 `pack_size_unit`

The unit for `pack_size_value`.

Rules:

* Normalize to a simple unit code when possible.
* Return `null` if unclear.

Allowed recommended values:

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
bag
other
```

Preferred normalization:

```text
liter -> l
litre -> l
LTR -> l
كيلو -> kg
كجم -> kg
جرام -> g
جم -> g
مل -> ml
لتر -> l
حبة -> piece
قطعة -> piece
كيس -> bag
كرتون -> carton
ربطة -> pack
```

The database sync layer may further map these to existing Wifran unit records.

### 12.16 `pack_quantity`

The number of pieces/packs/items included in the offer.

Rules:

* Required in normalized data.
* Default to `1` if not visible and not a bundle.
* Must be numeric.
* For multipacks, use the total number of units included when clear.
* For `1+1`, use `2` when the offer clearly means two product items.
* For `2+2`, use `4` when the offer clearly means four product items.
* Do not set `pack_quantity = 2` just because a page banner says `1+1` without a product.
* For cartons, use the number of pieces in the carton if visible; otherwise keep `1` and use notes.

Examples:

```text
1
2
4
6
8
10
```

### 12.17 `unit_price`

The price per normalized unit.

Rules:

* Optional.
* Use if visible on the leaflet.
* If not visible, app may calculate it later when pack data is clear.
* OCR should return `null` if it is not shown.
* Do not guess.

### 12.18 `unit_price_unit`

The unit used for unit price calculation.

Examples:

```text
g
kg
ml
l
piece
```

Return `null` if not applicable.

### 12.19 `quantity_limit`

Any purchase limit.

Rules:

* Optional.
* Preserve exact text when visible.
* Can be Arabic or English.
* Return `null` if not shown.

Examples:

```text
Limit 2 per customer
الحد الأقصى 2
```

### 12.20 `is_loyalty_required`

Whether the offer requires loyalty card/app/membership.

Rules:

* Boolean.
* Default to `false`.
* Set to `true` only if leaflet clearly indicates loyalty requirement.
* Do not infer loyalty requirement from supermarket brand alone.

### 12.21 `loyalty_notes_ar`

Arabic details about loyalty requirement.

Return `null` if not applicable.

### 12.22 `loyalty_notes_en`

English details about loyalty requirement.

Return `null` if not applicable.

### 12.23 `notes_ar`

Arabic notes relevant to the product offer.

Examples:

```text
2 حبة
4 ربطات
للكرتون
للكيس
للحبة
للربطة
```

Do not use campaign slogans as notes unless they apply directly to the product offer.

### 12.24 `notes_en`

English notes relevant to the product offer.

Examples:

```text
2 PCS
4 Packs
Per Box
Per Bag
Each
Per Pack
```

### 12.25 `bounding_box`

The visual location of the offer item on the rendered page image.

Required for image cropping when possible.

Expected shape:

```json
{
  "x": 120,
  "y": 450,
  "width": 300,
  "height": 300
}
```

Rules:

* Coordinates must refer to the full product offer item area, including product image, product name, price, and deal label where possible.
* Coordinates should not crop only the text.
* Coordinates should not crop only the product image.
* Coordinates should not crop only a page banner.
* Coordinates must be tied to the correct `page_number`.
* Coordinates should be relative to the rendered page image used for cropping.
* If the OCR provider returns normalized coordinates, the app must convert them to pixel coordinates before cropping.
* If the bounding box is uncertain, return best estimate and add a warning.
* If bounding box is missing, return `null` and mark the row as needing review.

### 12.26 `confidence`

A numeric confidence score for the extracted row.

Rules:

* Range: `0` to `1`.
* Use `1` for very confident.
* Use `0` for no confidence.
* If OCR provider does not provide confidence, calculate an app-level confidence later.
* Low confidence rows should need review.

Suggested threshold:

```text
confidence < 0.75 -> needs review
```

## Product Offer Block Association Rules

Extract complete product-offer blocks, not isolated text regions.
A valid row should represent one purchasable product offer.
A current price is valid only when it can be associated with a nearby product image and/or product name.
A product name is valid only when it can be associated with a nearby current offer price.
Old prices must not become separate rows.
Discount badges such as 1+1, 1+2, 2+2, Or/أو must not become separate rows.
SKU/item codes must not become product rows.
Branch notes such as Selected Branches only must not become product rows.
Per-unit labels such as Per Kg, Per Bag, Per Plate, للكيلو, للكيس, للطبق are attributes of the related product, not separate rows.
If price is above the image and product name is below the image, combine them into one product offer row.
If several neighboring products are close together, do not merge them unless the leaflet clearly presents them as variants of the same offer.

## Edge Cases and Parsing Heuristics

### 12.27 `warnings`

An array of warning codes or warning messages.

Examples:

```json
[
  "LOW_CONFIDENCE_PRICE",
  "BOUNDING_BOX_UNCERTAIN",
  "CATEGORY_INFERRED"
]
```

If no warnings:

```json
[]
```

## 13. Required Fields for Valid OCR Item

For an OCR item to be considered valid enough for offer creation, it must have:

```text
page_number
product_name_ar OR product_name_en
offer_price
```

For high-quality import, it should also have:

```text
bounding_box
pack_quantity
confidence
```

Rows missing recommended fields may still be saved to `import_rows`, but should be marked `warning`, `error`, or `needs_review`.

## 14. Non-Product Promotional Row Detection

After OCR extraction, the app should detect and reject rows that look like promotional/banner-only content.

A row should be classified as `NON_PRODUCT_PROMOTIONAL_AREA` when most of the following are true:

* Product name looks like a campaign slogan.
* Product name contains words such as “offers”, “savings”, “festival”, “عيد”, “عروض”, “توفير”, but has no real product.
* No valid price exists.
* No product image/package is represented.
* The bounding box covers a large banner/header/cover area.
* The row contains only date text.
* The row contains only supermarket or sponsor branding.
* The row contains generic `1+1` text without a product.

Recommended handling:

```text
If non-product promotional area is detected:
  Save it only as an import row if useful for debugging.
  Mark status = skipped or error.
  Do not create a product.
  Do not create a brand.
  Do not create an offer.
  Add validation error code NON_PRODUCT_PROMOTIONAL_AREA.
```

## 15. Arabic and English Handling Rules

### 15.1 Preserve Visible Text

If Arabic text is visible, preserve it.

If English text is visible, preserve it.

Do not replace visible leaflet text with a translation unless the field is specifically intended to hold a translated value.

### 15.2 Do Not Over-Translate Brands

Brand names should not be creatively translated.

Examples:

```text
كيري -> Kiri
نادك -> NADEC
ساديا -> Sadia
```

Do not translate brand names into meanings.

### 15.3 Product Name Translation

If a product name is visible only in Arabic, English translation can be useful, but it must be literal and conservative.

Example:

```text
حليب بودرة -> Milk Powder
معجون طماطم -> Tomato Paste
```

Do not add marketing language.

### 15.4 Mixed Language Items

Some leaflet items may show Arabic and English together.

Use the best visible text for each field.

If the same item has both Arabic and English product names, fill both.

If only one language exists, fill one and return `null` for the other unless reliable translation is explicitly enabled.

## 16. Price Parsing Rules

### 16.1 Supported Price Formats

The extractor should handle:

```text
62.95
62,95
SAR 62.95
ر.س 62.95
٦٢٫٩٥
62
```

Normalize all to decimal numbers.

### 16.2 Arabic Numeral Conversion

Convert Arabic-Indic digits:

```text
٠ -> 0
١ -> 1
٢ -> 2
٣ -> 3
٤ -> 4
٥ -> 5
٦ -> 6
٧ -> 7
٨ -> 8
٩ -> 9
```

Also support Eastern Arabic numerals if encountered.

### 16.3 Decimal Separators

Normalize Arabic decimal separator:

```text
٫ -> .
```

Normalize comma decimal separator when context is clear:

```text
62,95 -> 62.95
```

### 16.4 Price Validation

Invalid price examples:

```text
0
-5
abc
unknown
```

Suspicious price examples:

```text
99999
0.01
```

Suspicious prices should be marked for review, not silently accepted.

## 17. Discount and Bundle Parsing Rules

### 17.1 `1+1`

If a product offer says `1+1`, interpret as promotional text and preserve it in `discount_text`.

If the product unit and quantity are clear, set:

```text
pack_quantity = 2
```

Do not automatically double `pack_size_value`.

Example:

```text
1+1, 1800 g milk powder
pack_size_value = 1800
pack_size_unit = g
pack_quantity = 2
discount_text = 1+1
```

Important:

```text
A page banner that says 1+1 without a product must be ignored.
```

### 17.2 `2+2`

If a product offer says `2+2`, preserve it in `discount_text`.

If clear, set:

```text
pack_quantity = 4
```

### 17.3 Multipacks

Examples:

```text
6 pcs
10 pieces
4 packs
24 portions
```

Use the count as `pack_quantity` when it represents the number of included pieces.

Use `description_ar` / `description_en` or notes when the count describes portions rather than separate sale units.

### 17.4 Cartons and Boxes

If the item is sold per carton or box:

* Use `notes_ar` / `notes_en` to preserve this.
* Use `pack_quantity` only if the number of pieces inside the carton is visible.
* Use `pack_size_unit = carton` or `box` only if the offer unit itself is carton/box and no better unit exists.

## 18. Category Rules

The extractor should assign practical categories that align with Wifran.

Recommended category examples:

```text
Staples
Canned Food
Frozen
Dairy
Beverages
Snacks
Bakery
Meat
Poultry
Seafood
Fruits & Vegetables
Household
Personal Care
Baby Care
Pet Care
Other
```

Arabic examples:

```text
المواد الغذائية الأساسية
الأغذية المعلبة
المجمدات
الألبان
المشروبات
الوجبات الخفيفة
المخبوزات
اللحوم
الدواجن
المأكولات البحرية
الفواكه والخضروات
العناية المنزلية
العناية الشخصية
العناية بالطفل
العناية بالحيوانات
أخرى
```

Rules:

* Use visible leaflet section headers when available.
* If category is inferred, add warning `CATEGORY_INFERRED`.
* If uncertain, use `null` or `Other` depending on implementation settings.
* The database sync layer should match these to existing `categories`.
* Do not classify a campaign header as a product category.

## 19. Item Boundary Rules

The OCR/AI extraction must treat a complete product offer block as one item.

A complete product offer block usually includes:

* Product image.
* Product name.
* Brand name.
* Price.
* Pack size or quantity.
* Discount text.
* Notes.

Do not split one product into multiple records just because text appears in multiple places.

Do not merge two different products into one record just because they are visually close.

Do not create an item from a header, footer, campaign banner, logo, date badge, or generic promotional phrase.

If one price applies to multiple variants of the same product:

* Create one item if the leaflet clearly treats them as one offer.
* Use description/notes to list variants.
* If variants are materially different products, create separate items.

## 20. Bounding Box Rules for Cropped Item Images

The bounding box should capture the full product offer item card/block.

Good bounding box includes:

```text
product image
product name
brand
price
pack info
discount label
```

Bad bounding box examples:

```text
only the price
only the image
only product title
too much of neighboring products
a campaign banner
a supermarket logo
a date badge
a cover page graphic
```

The app should apply safe padding around bounding boxes before cropping.

Recommended padding:

```text
5% to 10% of bounding box width/height
```

Do not allow padding to exceed page image boundaries.

## 21. OCR Prompt Output Contract

The OCR prompt should tell the model:

```text
Return only valid JSON.
Do not return markdown.
Do not include explanation.
Do not include comments.
Use null for unknown values.
Do not guess missing prices.
Do not invent brands.
Preserve Arabic text exactly when visible.
Extract all product offer items, including small items.
Ignore campaign banners, cover graphics, page headers, page footers, supermarket logos, sponsor logos, date badges, decorative graphics, and generic promotion slogans unless they are part of a specific product offer item.
Include page_number for every item.
Include bounding_box for every product offer item when possible.
Use 1-indexed page numbers.
Use numeric values for prices and quantities.
```

## 22. Handling Incomplete or Unclear Items

If an item is partially readable:

* Extract what is visible.
* Use `null` for unknown fields.
* Add a warning.
* Lower confidence.

If price is missing:

* Save as import row.
* Mark as error or needs review.
* Do not create final offer.

If product name is missing:

* Save as import row.
* Mark as error or needs review.
* Do not create final offer.

If bounding box is missing:

* Save as import row.
* Mark as warning or needs review.
* Continue if core data is valid.

If the row is only a campaign/banner area:

* Mark as skipped or error.
* Add `NON_PRODUCT_PROMOTIONAL_AREA`.
* Do not create final offer.

## 23. Duplicate Text and Repeated Offers

Leaflets may repeat the same product on different pages or sections.

Do not remove duplicates during OCR extraction.

The OCR stage should extract all visible product offer items.

Duplicate detection belongs to the database sync layer.

## 24. Confidence and Review Rules

Rows should need review when:

```text
confidence < 0.75
offer_price is missing
product name is missing
bounding_box is missing
bounding_box is very small or invalid
original_price < offer_price
pack data is inconsistent
category is inferred with low confidence
brand is uncertain
OCR output required JSON repair
price is suspiciously high or low
row may be non-product promotional area
```

## 25. Recommended Warning Codes

Use these warning codes where possible:

```text
LOW_CONFIDENCE_EXTRACTION
LOW_CONFIDENCE_PRICE
LOW_CONFIDENCE_PRODUCT_NAME
LOW_CONFIDENCE_BRAND
LOW_CONFIDENCE_CATEGORY
CATEGORY_INFERRED
BRAND_INFERRED
MISSING_ORIGINAL_PRICE
MISSING_PACK_SIZE
MISSING_BOUNDING_BOX
BOUNDING_BOX_UNCERTAIN
BOUNDING_BOX_TOO_SMALL
BOUNDING_BOX_OUT_OF_PAGE
PRICE_SUSPICIOUS
ORIGINAL_PRICE_LESS_THAN_OFFER_PRICE
PACK_DATA_AMBIGUOUS
LOYALTY_REQUIREMENT_UNCLEAR
MULTIPLE_VARIANTS_ONE_PRICE
POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA
```

## 26. Recommended Error Codes

Use these error codes where possible:

```text
MISSING_PRODUCT_NAME
MISSING_OFFER_PRICE
INVALID_OFFER_PRICE
INVALID_ORIGINAL_PRICE
INVALID_PAGE_NUMBER
INVALID_JSON
INVALID_BOUNDING_BOX
IMAGE_CROP_FAILED
OCR_EMPTY_RESPONSE
OCR_ITEM_PARSE_FAILED
NON_PRODUCT_PROMOTIONAL_AREA
```

## 27. Example Extracted Items

### Example 1

```json
{
  "row_id": "page-1-item-1",
  "page_number": 1,
  "product_name_ar": "حليب هايل بودرة",
  "product_name_en": "Haley Milk Powder",
  "brand_name_ar": "هايل",
  "brand_name_en": "Haley",
  "category_name_ar": "المواد الغذائية الأساسية",
  "category_name_en": "Staples",
  "description_ar": null,
  "description_en": null,
  "offer_price": 62.95,
  "original_price": 125.9,
  "discount_text": "1+1",
  "pack_size_value": 1800,
  "pack_size_unit": "g",
  "pack_quantity": 2,
  "unit_price": null,
  "unit_price_unit": "g",
  "quantity_limit": null,
  "is_loyalty_required": false,
  "loyalty_notes_ar": null,
  "loyalty_notes_en": null,
  "notes_ar": "2 حبة",
  "notes_en": "2 PCS",
  "bounding_box": {
    "x": 120,
    "y": 450,
    "width": 300,
    "height": 300
  },
  "confidence": 0.92,
  "warnings": []
}
```

### Example 2

```json
{
  "row_id": "page-1-item-2",
  "page_number": 1,
  "product_name_ar": "معجون طماطم ندى",
  "product_name_en": "Nada Tomato Paste",
  "brand_name_ar": "ندى",
  "brand_name_en": "Nada",
  "category_name_ar": "الأغذية المعلبة",
  "category_name_en": "Canned Food",
  "description_ar": null,
  "description_en": null,
  "offer_price": 11.5,
  "original_price": 23,
  "discount_text": "2+2",
  "pack_size_value": 135,
  "pack_size_unit": "g",
  "pack_quantity": 4,
  "unit_price": null,
  "unit_price_unit": "g",
  "quantity_limit": null,
  "is_loyalty_required": false,
  "loyalty_notes_ar": null,
  "loyalty_notes_en": null,
  "notes_ar": "4 ربطات",
  "notes_en": "4 Packs",
  "bounding_box": {
    "x": 430,
    "y": 450,
    "width": 300,
    "height": 300
  },
  "confidence": 0.9,
  "warnings": []
}
```

### Example 3

```json
{
  "row_id": "page-2-item-4",
  "page_number": 2,
  "product_name_ar": "ساديا دجاج",
  "product_name_en": "Sadia Chicken",
  "brand_name_ar": "ساديا",
  "brand_name_en": "Sadia",
  "category_name_ar": "المجمدات",
  "category_name_en": "Frozen",
  "description_ar": null,
  "description_en": null,
  "offer_price": 154.99,
  "original_price": 185,
  "discount_text": null,
  "pack_size_value": 1000,
  "pack_size_unit": "g",
  "pack_quantity": 10,
  "unit_price": null,
  "unit_price_unit": "g",
  "quantity_limit": null,
  "is_loyalty_required": false,
  "loyalty_notes_ar": null,
  "loyalty_notes_en": null,
  "notes_ar": "للكرتون",
  "notes_en": "Per Box",
  "bounding_box": {
    "x": 80,
    "y": 900,
    "width": 350,
    "height": 320
  },
  "confidence": 0.88,
  "warnings": []
}
```

## 28. Example Ignored Page/Banner

If a page or page area contains only:

```text
1+1 عروض تزين عيدك
هنا التوفير
May 27 - June 02
Supermarket logo
Decorative balloons
Sponsor logo
```

and does not contain any specific product offer, the OCR must return:

```json
{
  "items": []
}
```

The app must not create a product, brand, category, or offer from this.

## 29. Local Normalization After OCR

After receiving OCR output, the app should normalize each row locally.

Local normalization should:

* Convert prices to numbers.
* Convert Arabic numerals to Western digits.
* Normalize units.
* Ensure `pack_quantity` is numeric.
* Convert missing optional fields to `null`.
* Ensure `warnings` is an array.
* Ensure `confidence` is in range `0` to `1`.
* Ensure page numbers are 1-indexed.
* Check bounding boxes.
* Detect non-product promotional/banner rows.
* Add app-level warnings/errors.
* Prepare `normalized_data` for `import_rows`.

## 30. Do Not Let OCR Make Database Decisions

OCR should not decide:

* Final product ID.
* Final brand ID.
* Final category ID.
* Whether to create a product.
* Whether to create a brand.
* Whether to skip a duplicate offer.
* Whether to publish an offer.
* Whether to update an existing offer.

OCR only extracts structured data from the leaflet.

Database matching and sync happen later in the app.

## 31. What Antigravity Must Not Do

Antigravity must not:

* Build a free-form OCR summarizer.
* Accept non-JSON OCR output as final data.
* Ignore Arabic text.
* Translate brand names creatively.
* Guess prices.
* Guess missing products.
* Create offer rows from page banners or campaign graphics.
* Treat generic `1+1` graphics as product offers.
* Merge unrelated offers.
* Drop small product items because they are visually less prominent.
* Process the whole PDF in one request by default.
* Assume bounding boxes are always present.
* Use 0-indexed page numbers in stored data.
* Treat OCR output as trusted without validation.
* Insert invalid rows directly into `offers`.

## 32. Final Principle

Extraction quality is more important than speed.

The extractor should preserve raw data, flag uncertainty, ignore non-product promotional areas, and avoid creating incorrect offers.

When uncertain, mark the row for review instead of guessing.