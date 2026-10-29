# Wifran External Extraction Tool — Accuracy, Validation, and Publishing Architecture

## Purpose

This document explains the changes required in the external Wifran offer extraction and ingestion tool so it can produce highly accurate, trustworthy weekly offer data that Wifran can rely on.

The tool will process supermarket leaflet pages/crops, extract structured offer data, crop one image per offer item, upload images to Supabase Storage, and insert/update offers in Wifran’s database.

Because the tool is expected to publish valid offers directly, the extraction pipeline must be designed to prevent wrong prices, wrong units, wrong pack sizes, incorrect comparisons, and misleading recommendations.

---

## 1. Executive Summary

The extraction tool should not treat OCR/model JSON as final truth.

The correct architecture is:

```text
leaflet/crop image
→ raw OCR/model extraction
→ canonical normalization
→ adaptive style-aware validation
→ deterministic sanity checks
→ comparison-safety calculation
→ publish decision
→ Supabase Storage upload
→ Supabase database upsert
```

The most important change is to separate:

```text
display/publishing correctness
```

from:

```text
comparison/recommendation correctness
```

An offer can be safe to display publicly but unsafe to use for unit-price comparison or “best deal” ranking.

Recommended final publishing decision states:

```text
publish
publish_but_exclude_from_comparison
skip_or_quarantine
```

---

## 2. Problems Observed From Current Samples

The sample cropped leaflet images and corresponding OCR JSON outputs reveal several issues that must be handled systematically.

### 2.1 OCR/model output is not standardized

Different items produce different fields. Some JSON objects include fields such as:

```text
offer_price
current_price
price_condition
unit_size
unit_type
variant
features
streaming_services
screen_size
resolution
brand
```

This means the tool must not depend on one fixed set of output keys from the model.

Required response:

```text
Store raw OCR/model JSON.
Normalize it into Wifran’s canonical schema.
Preserve unknown fields under raw_attributes or extraction_metadata.
```

---

### 2.2 Product size can be misclassified as offer price

Example issue:

```text
1.5L may be misread as 1.51 offer_price.
```

This is a critical failure because it would publish a wrong price.

Required response:

```text
Numbers attached to L, liter, ml, kg, g, pcs, inch, etc. must be treated as size candidates first, not price candidates.
```

---

### 2.3 Old/original price can be misclassified as offer price

Example issue:

```text
A crop may show old price 21.99 and current promo price 10.
The OCR output may assign 21.99 to offer_price.
```

Required response:

```text
The model must extract all price candidates and classify them.
The tool must validate that offer_price is the actual current promotional price, not the old/crossed-out price.
```

---

### 2.4 Leaflets use complex price basis

Prices may be:

```text
each
per pack
per box
per bag
per kg
per 2kg
per dozen
bundle price
1+1
2+1
multi-buy
```

The tool must distinguish:

```text
what the price applies to
```

from:

```text
what the product contains
```

Example:

```text
Watermelon priced per 2kg:
offer_price applies to 2kg, not one unit.

Pack with 8 pieces × 135g:
offer_price applies to one pack containing 8 × 135g.
```

---

### 2.5 Product content and comparison unit are separate concepts

For Wifran’s recommendations, the tool must derive comparison-safe unit prices only when it understands the item content.

Example:

```text
8 × 135g = 1080g = 1.08kg
unit price = offer_price / 1.08kg
```

Example:

```text
730ml with 1+1 = 2 × 730ml = 1460ml = 1.46L
unit price = offer_price / 1.46L
```

If content is unclear, the offer may still be shown, but should be excluded from unit-price comparison.

---

### 2.6 Non-grocery items appear in supermarket leaflets

The samples include TVs and electronics. These can have useful fields such as:

```text
screen size
resolution
features
streaming services
```

But they should not use grocery unit-price comparison logic.

Required response:

```text
Classify item domain:
- grocery
- household
- personal_care
- electronics
- appliance
- other_non_grocery
```

For MVP, Wifran may either:

```text
exclude non-grocery items from public publishing
```

or:

```text
publish them as non-grocery but exclude them from grocery recommendations/comparisons
```

The tool must not force electronics into grocery comparison logic.

---

## 3. Core Principles

### Principle 1 — OCR output is raw evidence, not final data

The extraction model output should be stored as raw evidence.

It should then be normalized, validated, and checked before the tool decides whether the row is publishable.

---

### Principle 2 — Use a canonical offer model

The tool must convert inconsistent OCR/model JSON into a stable canonical internal format.

The Wifran database should receive only clean, validated fields.

Raw OCR/model fields should be stored in metadata for traceability.

---

### Principle 3 — Use adaptive style inference, not fixed supermarket style

Do not hardcode leaflet style rules such as:

```text
Othaim always puts offer price in this exact position.
```

Supermarket leaflet designs may change weekly and may vary across pages.

Instead, build a temporary style profile per leaflet/page at runtime.

---

### Principle 4 — Crop-specific evidence beats style profile

A style profile is guidance, not law.

If the page-level style profile suggests one thing but the crop image clearly shows another, the crop evidence wins.

---

### Principle 5 — Direct publishing requires strict gates

Because the tool will publish valid rows directly, it must reject/skip rows with blocking uncertainty.

Do not publish a row if the offer price, title, location coverage, expiry date, or price role is ambiguous.

---

### Principle 6 — Display safety and comparison safety are different

A row can be safe to publish but unsafe for comparisons.

Example:

```text
Offer title and price are clear, but pack size is unclear.
```

This can be displayed publicly, but should not be used for:

```text
best unit price
lowest price per kg/liter
best deal recommendation
```

---

## 4. Recommended End-to-End Pipeline

### Stage 1 — Trusted context input

The operator/tool provides trusted context:

```text
supermarket
coverage_scope: national / region / city
city or region when applicable
valid_to
optional valid_from
source_reference
source_url if available
```

This trusted context overrides anything extracted from the leaflet.

---

### Stage 2 — Page and crop preparation

For each leaflet:

```text
PDF → page images
page image → offer block detection
offer block → cropped image
each crop → stable source_item_number
```

Each crop should preserve:

```text
product image
Arabic/English text
prices
pack size
promo labels
conditions
```

---

### Stage 3 — Adaptive leaflet/page style profile

Before extracting final item data, infer a temporary style profile for the current leaflet/page.

The profile should describe:

```text
how offer prices are visually displayed
how original prices are visually displayed
how sizes are displayed
how promotion mechanics are displayed
where conditions usually appear
```

This profile is only valid for the current leaflet/page.

Recommended JSON:

```json
{
  "style_profile_scope": "this_leaflet_or_page_only",
  "confidence": "medium",
  "offer_price_patterns": [
    "largest number in green price block",
    "large red number near SAR symbol"
  ],
  "original_price_patterns": [
    "smaller crossed-out number near offer price"
  ],
  "size_patterns": [
    "number near L/ml/kg/g/pcs/inch unit",
    "number near product title or package badge"
  ],
  "promotion_patterns": [
    "1+1",
    "Each / للحبة",
    "Per Pack / للكيس",
    "Per Kg / للكيلو"
  ],
  "notes": [
    "Do not assume this profile applies to other leaflets."
  ]
}
```

---

### Stage 4 — Evidence-first item extraction

For each crop, ask the model to extract:

```text
all visible price candidates
all visible size/content candidates
all visible promo/condition text
all visible product names/descriptions
```

The model should not return only final `offer_price`.

It should return candidates and classifications.

---

### Stage 5 — Style-aware validation call

After initial extraction, run a second model call with:

```text
crop image
raw extraction JSON
canonical normalized draft
current leaflet/page style profile
```

Ask the model to verify:

```text
Is the selected offer_price visually correct?
Is original_price visually correct?
Was any size mistaken for price?
Was old price mistaken for offer price?
Is pack size correct?
Is promotion mechanic correct?
Should this row be published?
Should this row be excluded from comparison?
```

The validation call should return:

```json
{
  "validation_result": "pass | fail | corrected",
  "corrected_fields": {},
  "blocking_errors": [],
  "non_blocking_warnings": [],
  "visual_evidence": {
    "offer_price": "why this is the offer price",
    "original_price": "why this is the original price",
    "size": "why this is size/content"
  },
  "publish_decision": "publish | publish_but_exclude_from_comparison | skip_or_quarantine"
}
```

---

### Stage 6 — Deterministic sanity checks

The tool should then run code-based validation rules.

This step is mandatory.

Do not rely only on the model.

Examples:

```text
If offer_price is attached to L/ml/kg/g/pcs/inch → block.
If offer_price equals or nearly equals a size value → block.
If offer_price is suspiciously low for the category and another price candidate is larger/prominent → block or validate.
If original_price < offer_price → warning/block unless promo logic explains it.
If 1+1 is visible but bundle_quantity is missing → warning/block depending on confidence.
If price_basis is per_kg/per_2kg but comparison metadata is missing → exclude from comparison.
If category is electronics, do not apply grocery unit-price logic.
```

---

### Stage 7 — Comparison-safety calculation

Calculate comparison metadata only when safe.

Required fields:

```text
comparison_eligible
comparison_unit
comparison_unit_price
comparison_confidence
comparison_exclusion_reason
```

Possible values:

```json
{
  "comparison_eligible": true,
  "comparison_unit": "liter",
  "comparison_unit_price": 6.67,
  "comparison_confidence": "high",
  "comparison_exclusion_reason": null
}
```

or:

```json
{
  "comparison_eligible": false,
  "comparison_unit": null,
  "comparison_unit_price": null,
  "comparison_confidence": "low",
  "comparison_exclusion_reason": "unclear_pack_size"
}
```

---

### Stage 8 — Publish decision

The tool decides one of:

```text
publish
publish_but_exclude_from_comparison
skip_or_quarantine
```

Valid rows should be inserted/updated with:

```text
status = published
```

Rows with blocking errors should not be published.

---

### Stage 9 — Image upload

Upload cropped item image to:

```text
offer-images/{supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp
```

Store:

```text
image_bucket = offer-images
image_path
image_url
image_source_type = leaflet_crop
source_page_number
source_item_number
external_image_id
```

---

### Stage 10 — Database upsert

Create/reuse:

```text
offer_source / leaflet source
```

Then upsert offer rows.

Use idempotency key such as:

```text
{leaflet_id}-{source_item_number}
```

Do not create duplicates on rerun.

---

### Stage 11 — Import report

Output a report:

```text
total crops processed
published count
updated count
published_but_excluded_from_comparison count
skipped/quarantined count
blocking errors
warnings
image upload failures
duplicate detections
model validation failures
```

---

## 5. Canonical Internal Offer Model

The tool should normalize all extractions into a canonical object before DB write.

Recommended model:

```json
{
  "source": {
    "leaflet_id": "othaim-city-riyadh-2026-06-05",
    "source_page_number": 1,
    "source_item_number": "004",
    "external_image_id": "othaim-city-riyadh-2026-06-05-004"
  },
  "trusted_context": {
    "supermarket_id": "uuid",
    "location_scope": "city",
    "city_id": "uuid",
    "region_id": null,
    "offer_start_date": null,
    "offer_end_date": "2026-06-05"
  },
  "product": {
    "title_ar": "زيت هالي نخيل",
    "title_en": "Haley Olein Oil",
    "brand_text": "Haley",
    "category_hint": "Staples",
    "item_domain": "grocery",
    "description_ar": null,
    "description_en": null
  },
  "prices": {
    "offer_price": 10,
    "original_price": 15.99,
    "currency": "SAR",
    "discount_amount": 5.99,
    "discount_percentage": 37.46,
    "price_basis": "each",
    "price_condition_text": "Each",
    "all_price_candidates": [
      {
        "raw_text": "10",
        "normalized_value": 10,
        "classified_as": "offer_price",
        "confidence": "high",
        "evidence": "Large promo price in price block"
      },
      {
        "raw_text": "15.99",
        "normalized_value": 15.99,
        "classified_as": "original_price",
        "confidence": "high",
        "evidence": "Smaller old price near the offer price"
      }
    ]
  },
  "content": {
    "size_text": "1.5L",
    "pack_quantity": 1,
    "bundle_quantity": null,
    "each_size_value": 1.5,
    "each_size_unit": "liter",
    "total_content_value": 1.5,
    "total_content_unit": "liter"
  },
  "promotion": {
    "mechanic": "standard_price",
    "special_offer": null,
    "condition_text": "Each"
  },
  "comparison": {
    "comparison_eligible": true,
    "comparison_unit": "liter",
    "comparison_unit_price": 6.67,
    "comparison_confidence": "high",
    "comparison_exclusion_reason": null
  },
  "image": {
    "image_bucket": "offer-images",
    "image_path": "othaim/city/riyadh/othaim-city-riyadh-2026-06-05/004.webp",
    "image_url": "https://PROJECT.supabase.co/storage/v1/object/public/offer-images/othaim/city/riyadh/othaim-city-riyadh-2026-06-05/004.webp",
    "image_source_type": "leaflet_crop"
  },
  "quality": {
    "publish_decision": "publish",
    "extraction_confidence": "high",
    "comparison_confidence": "high",
    "blocking_errors": [],
    "non_blocking_warnings": []
  },
  "raw": {
    "raw_ocr_json": {},
    "raw_ocr_text": null,
    "raw_attributes": {}
  }
}
```

---

## 6. Price Role Classification Rules

The tool should classify numeric values as:

```text
offer_price
original_price
size
pack_quantity
screen_size
promotion_text
quantity_limit
unknown
```

### Offer price signals

Usually:

```text
largest price-like number
near SAR symbol
inside prominent price block
in bold/red/green price style
not attached to size unit
```

### Original price signals

Usually:

```text
smaller price-like number
crossed out
near offer price
old price visual position
```

### Size/content signals

Usually:

```text
attached to L, liter, ml, kg, g, pcs, inch
near product name or package details
not near SAR symbol
```

Important rule:

```text
1.5L, 730ml, 10kg, 50", 65", 8x135g, 30PCS are not prices.
```

---

## 7. Price Basis Rules

The tool must capture the basis of the price.

Allowed examples:

```text
each
per_pack
per_box
per_bag
per_kg
per_2kg
per_dozen
bundle
multi_buy
unknown
```

Examples:

```text
Per Pack → price_basis = per_pack
Per 2kg → price_basis = per_2kg
Each → price_basis = each
1+1 → promotion.mechanic = bogo, bundle_quantity = 2
```

This is required for accurate unit-price comparison.

---

## 8. Promotion Mechanic Rules

Recommended values:

```text
standard_price
bogo
bundle
multi_buy
loyalty_required
selected_branches
unknown
```

Examples:

```text
1+1 → bogo, bundle_quantity=2
1+2 → bundle, bundle_quantity=3
2+1 → bundle, bundle_quantity=3
6+1 → bundle, bundle_quantity=7
2 for 10 → multi_buy
Selected Branches Only → selected_branches
Loyalty Required → loyalty_required
```

---

## 9. Unit Price and Comparison Rules

The tool should calculate unit price only when the required data is clear.

### Examples

#### Oil 1.5L

```text
offer_price = 10
total_content = 1.5 liter
comparison_unit_price = 10 / 1.5 = 6.67 SAR/liter
```

#### Fairy 730ml 1+1

```text
offer_price = 10
bundle_quantity = 2
each_size = 730 ml
total_content = 1460 ml = 1.46 liter
comparison_unit_price = 10 / 1.46 = 6.85 SAR/liter
```

#### 8 × 135g pack

```text
offer_price = X
pack_quantity = 8
each_size = 135 g
total_content = 1080 g = 1.08 kg
comparison_unit_price = X / 1.08
```

#### Watermelon per 2kg

```text
offer_price = X
price_basis = per_2kg
comparison_unit_price = X / 2 kg
```

---

## 10. Publish and Recommendation Safety

Because the tool publishes valid offers directly:

### Publish gate

A row may be published only if:

```text
trusted supermarket resolved
trusted coverage valid
city/region valid when required
offer_end_date valid
offer_price confidently identified
title exists
storage path safe
no duplicate conflict
blocking_errors is empty
```

### Comparison gate

A published row may be used in comparisons only if:

```text
comparison_eligible = true
comparison_confidence in high/medium
comparison_unit exists
comparison_unit_price exists
product/category is comparable
```

Do not use uncertain rows in:

```text
best unit price
best deal
recommendation ranking
```

---

## 11. Blocking Errors

Examples of blocking errors:

```text
missing_offer_price
ambiguous_offer_price
size_misclassified_as_price
original_price_misclassified_as_offer_price
missing_product_title
invalid_location_scope
missing_city_for_city_scope
missing_region_for_region_scope
expired_offer_end_date
unresolved_supermarket
unsafe_image_path
database_upsert_failed
```

Rows with blocking errors should not be published.

---

## 12. Non-Blocking Warnings

Examples:

```text
missing_original_price
missing_brand
unclear_pack_size
missing_image_but_image_optional
low_confidence_category
comparison_not_safe
non_grocery_item
```

Rows with non-blocking warnings may still be published if the core fields are valid.

But they may be excluded from comparison.

---

## 13. Non-Grocery Policy

The tool should classify non-grocery items.

Recommended policy:

```text
grocery and household essentials → publish if valid
electronics/appliances/non-grocery → either quarantine or publish in non-grocery category only if Wifran supports it
```

Non-grocery items should not use grocery unit-price comparisons.

If Wifran is currently grocery-first, the safest default is:

```text
non-grocery items → skip_or_quarantine unless configured to publish
```

---

## 14. Model Prompting Changes

The current prompt to Mistral is too narrow if the tool publishes directly.

Update the extraction prompt so Mistral returns:

```text
all visible price candidates
all visible size/content candidates
selected offer price
selected original price
price basis
promotion mechanic
classification evidence
confidence
blocking warnings
non-blocking warnings
raw attributes
```

Do not forbid warnings or confidence.

Do not only ask for final `offer_price`.

The tool should request evidence like:

```text
why this number is the offer price
why this number is the original price
why this value is size/content
```

---

## 15. Style-Aware Extraction Without Fixed Style

The tool should use style awareness, but not hardcode styles permanently.

Use adaptive runtime style profiles.

Process:

```text
current leaflet/page
→ infer temporary style profile
→ use it during extraction
→ validate each crop against it
→ discard or store profile as metadata
```

Do not assume that a supermarket’s style remains the same every week.

Do not assume all pages in a leaflet share the same style.

Priority order:

```text
crop-specific visual evidence
page-level style profile
leaflet-level style profile
general Saudi leaflet heuristics
if still unclear, do not publish
```

---

## 16. Style-Aware Validation Call

For each item, run a second validation call when possible.

Input:

```text
cropped image
raw extraction JSON
normalized canonical draft
temporary style profile
```

Output:

```text
pass/fail/corrected
corrected offer price
corrected original price
corrected size/content
blocking errors
warnings
visual evidence
publish decision
comparison decision
```

This validation call should specifically check:

```text
Was a size mistaken for a price?
Was old price mistaken for offer price?
Is the prominent current promo price captured?
Is the pack size correct?
Is the promotion mechanic correct?
```

---

## 17. Deterministic Validation Examples

Implement code-based checks such as:

```text
if offer_price candidate is attached to L/ml/kg/g/pcs/inch → block
if offer_price equals or nearly equals a size candidate → block
if offer_price < 2 and another clear price candidate exists → block/verify
if original_price < offer_price → warning/block unless explained
if 1+1 visible but bundle_quantity missing → warning/block
if category is electronics → exclude from grocery comparisons
if comparison_unit_price cannot be calculated safely → comparison_eligible=false
```

These checks should run after model extraction and model validation.

---

## 18. Database and Metadata Recommendation

If Wifran’s current DB supports only basic offer fields, the tool should still store raw extraction metadata somewhere.

Recommended options:

### Option A — existing metadata field

If a JSONB metadata field exists, store:

```text
raw_ocr_json
normalized_payload
field_confidences
blocking_errors
warnings
comparison_metadata
promo_metadata
style_profile_id
```

### Option B — separate metadata table

If not available, recommend adding a future table:

```text
offer_extraction_metadata
- offer_id
- raw_ocr_json
- normalized_payload
- field_confidences
- extraction_warnings
- comparison_metadata
- promo_metadata
- source_image_path
- created_at
```

This is important for debugging and improving the extraction pipeline.

---

## 19. Required Tool Report

Every run should output:

```text
leaflet_id
supermarket
coverage scope
valid_to
total crops
published count
updated count
publish_but_exclude_from_comparison count
skipped/quarantined count
price ambiguity count
image upload success count
image upload failure count
non-grocery skipped/published count
duplicate rows detected
warnings by code
errors by code
```

This lets you monitor quality without manually inspecting every row.

---

## 20. Acceptance Criteria

The tool update is successful when:

```text
Mistral no longer returns only final offer_price without candidates.
The tool stores raw OCR/model JSON.
The tool normalizes into a canonical structure.
The tool runs style-aware validation.
The tool runs deterministic sanity checks.
The tool blocks size-as-price mistakes.
The tool distinguishes original price from offer price.
The tool handles per kg/per 2kg/per pack/per dozen.
The tool handles 1+1 and bundle offers.
The tool calculates comparison metadata only when safe.
The tool can publish valid rows directly.
The tool does not publish rows with blocking errors.
The tool excludes uncertain rows from comparisons.
The tool uploads offer crop images to Supabase Storage.
The tool upserts offers idempotently.
The tool produces a detailed quality report.
```

---

## Final Recommendation

Use this policy:

```text
1. Publish valid offers directly.
2. Display valid but non-comparable offers, but exclude them from unit-price rankings.
3. Skip or quarantine rows with critical uncertainty.
4. Store raw OCR and metadata for traceability.
5. Use adaptive style inference per leaflet/page.
6. Use a style-aware validation call per item or at least per risky item.
7. Use deterministic checks to catch common model mistakes.
8. Keep grocery and non-grocery recommendation logic separate.
```

This gives Wifran high automation while protecting price accuracy, unit-price accuracy, and user trust.
