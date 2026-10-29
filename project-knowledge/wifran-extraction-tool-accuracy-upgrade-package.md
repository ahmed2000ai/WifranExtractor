# Wifran Extraction Tool Accuracy Upgrade Package

## Purpose

This document is the master upgrade specification for the existing external Wifran extraction and ingestion tool.

The goal is to improve extraction accuracy, reduce price/size mistakes, protect direct publishing, and make the ingestion pipeline safer without rebuilding the tool from scratch.

This document should be saved as:

```text
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Use this as the source document for focused Antigravity implementation chunks.

Do not paste this entire document into Antigravity as one huge implementation request unless you intentionally want a broad refactor. This should be implemented in controlled chunks.

---

# 1. Existing-System Assumptions

The Wifran external extraction tool already exists.

It currently:

* processes supermarket leaflet PDF/page/crop images
* sends cropped offer item images to Mistral
* receives JSON extraction output
* saves one crop image per item offer
* saves JSON output per crop
* uploads offer crop images to Wifran Supabase Storage
* inserts/updates offer data in Wifran’s Supabase database
* supports direct-publish workflow for valid rows
* stores extraction artifacts under package folders such as `Extracts/{leaflet_name}/`
* supports or is being upgraded to support `extraction_manifest.json`

This document is not a greenfield architecture.

The correct developer mindset is:

```text
inspect existing modules
preserve what works
upgrade accuracy layers around the current pipeline
replace only unsafe or too-narrow logic
avoid rewriting working crop, upload, and DB modules unless necessary
```

---

# 2. Current Known Accuracy Problem

The current Mistral extraction prompt is too narrow if it asks only for final fields such as:

```text
item_number
Arabic name
English name
offer price
original price
size
pack_quantity
bundle_quantity
special_offer
```

That approach is unsafe because supermarket leaflet crops contain visually mixed information:

* current offer price
* old/original/crossed-out price
* product size
* pack quantity
* per-pack / per-kg / per-2kg / per-dozen conditions
* 1+1, 1+2, 2+1, 6+1 bundle labels
* branch restrictions
* loyalty conditions
* non-grocery product attributes such as screen size

Known failures include:

```text
1.5L being misread as 1.51 offer_price
730ml being treated as offer_price
old price being used as current offer_price
TV screen size being treated as a price
pack quantity being confused with price
```

Because the tool can publish to Wifran, model output must not be treated as final truth.

---

# 3. Updated Target Architecture

The upgraded architecture should be:

```text
existing crop image
→ Mistral extraction call with candidate + visual evidence output
→ raw OCR JSON saved
→ canonical normalization
→ adaptive leaflet/page style profile
→ Mistral validation call using image + raw JSON + normalized draft + style profile
→ deterministic sanity checks
→ comparison-safety calculation
→ publish decision
→ extraction package marked completed
→ Pre-Publish Preview
→ user visually reviews crop images + extracted data
→ user clicks Publish
→ existing Supabase image upload
→ existing Supabase DB upsert
→ improved run report
```

The most important conceptual split is:

```text
display/publishing safety
```

versus:

```text
comparison/recommendation safety
```

An offer can be safe to display publicly but unsafe for unit-price comparisons or “best deal” recommendations.

Final row decisions must be:

```text
publish
publish_but_exclude_from_comparison
skip_or_quarantine
```

Rows whose final decision is `publish` or `publish_but_exclude_from_comparison` are eligible for the Pre-Publish Preview.

Rows with `skip_or_quarantine` must not be uploaded to Wifran DB.

Valid published rows should still use:

```text
status = published
```

But DB upload must happen only after the user clicks the final `Publish` button inside the Pre-Publish Preview.

---

# 4. Non-Negotiable Safety Policies

## 4.1 OCR output is raw evidence, not final data

Mistral output must be stored as raw evidence.

It must then pass through:

```text
normalization
style-aware validation
deterministic sanity checks
comparison-safety calculation
publish decision engine
pre-publish preview
human publish approval
```

## 4.2 Direct publishing remains, but the final DB action is user-triggered

Do not turn the workflow into mandatory manual data entry.

The external tool is still expected to publish valid offers directly.

However, valid means the row passed:

```text
candidate extraction
canonical normalization
style-aware validation
deterministic validation
comparison-safety classification
publishing decision gates
pre-publish visual review
explicit user Publish action
```

The user is not required to edit every item manually.

The user must visually review the extracted crops and fields in the Pre-Publish Preview, then explicitly click `Publish`.

## 4.3 No automatic DB upload after extraction

After extraction completes, the app must not immediately upload to Supabase DB.

Instead:

```text
Extraction Completed
→ Pre-Publish Preview enabled
→ user opens preview
→ user reviews
→ user clicks Publish
→ DB upload/upsert starts
```

## 4.4 Style/color is a guardrail, not absolute truth

Leaflet styling, colors, relative font size, crossed-out prices, price block colors, and layout position should be used as validation evidence.

But style should not be permanently hardcoded by supermarket.

Priority order:

```text
1. crop-specific visual evidence
2. page-level style profile
3. leaflet-level style profile
4. general Saudi leaflet heuristics
5. if unclear, do not publish
```

## 4.5 Validation call is mandatory at first

Because the tool can publish valid offers, run a second Mistral validation call for every item initially.

Later, after the system proves reliable, a config can allow validating only risky rows.

Default:

```text
VALIDATE_EVERY_ITEM=true
```

## 4.6 All Mistral calls must share one global queue

Extraction calls, style-profile calls, and validation calls must use the same global Mistral rate-limit queue.

The delay applies between every Mistral request, regardless of request type.

Example sequence:

```text
crop 001 extraction call
wait required delay
crop 001 validation call
wait required delay
crop 002 extraction call
wait required delay
crop 002 validation call
wait required delay
```

or:

```text
all extraction calls sequentially
then all validation calls sequentially
```

Both are acceptable if they use one shared queue.

Default settings:

```text
MISTRAL_MAX_CONCURRENT_REQUESTS=1
MISTRAL_MIN_REQUEST_INTERVAL_MS=1100
```

Safer free-tier setting:

```text
MISTRAL_MIN_REQUEST_INTERVAL_MS=5000
```

The queue must respect:

```text
Retry-After headers
429 responses
5xx retry behavior
rolling request timing
ETA/progress reporting
```

---

# 5. Existing-System Inspection Tasks

Before coding, developers must inspect the existing codebase.

Do not rewrite modules blindly.

Inspect the current implementation for:

## 5.1 Folder/module structure

Find modules responsible for:

```text
PDF selection
extraction package/folder creation
page rendering
manual crop layout
crop image generation
Mistral request queue
Mistral prompt builder
Mistral response parser
item JSON saving
OCR key discovery
normalization/parsing
validation
Supabase Storage upload
Supabase DB upsert
publish status decision
pre-publish preview or results preview if already present
run reports
error handling
```

## 5.2 Current Mistral prompt builder

Search for files such as:

```text
src/main/ocr/flexibleItemOcrPromptBuilder.ts
src/main/ocr/itemImageOcrPromptBuilder.ts
src/main/ocr/ocrPromptBuilder.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/mistralClient.ts
```

Find the exact prompt currently sent to Mistral.

Replace narrow final-field extraction with the candidate-based extraction prompt in this document.

## 5.3 Current strict JSON schema

Find where the app appends:

```text
EXPECTED JSON SCHEMA:
```

Update that schema to allow candidate-based fields while staying strict.

Do not remove strict JSON validation.

## 5.4 Current crop/image generation

Preserve:

```text
current item_number assignment
current crop image generation
current image output naming
current crop folder structure
current manual crop layout
```

Do not change working crop behavior unless it blocks this upgrade.

## 5.5 Current fallback full-page/page extraction

If the tool already has any page-level extraction or page OCR, reuse it for style-profile generation if practical.

If not, add a focused style-profile call.

## 5.6 Current parser/normalizer

Inspect any modules that parse prices, sizes, Arabic/English fields, or Mistral JSON.

Extend or wrap them into the canonical normalization layer.

## 5.7 Current Supabase upload/upsert logic

Preserve:

```text
Supabase client/security setup
Storage upload
offer-images bucket
image path convention
offer source / leaflet source creation
idempotency keys
DB upsert
direct-publish behavior for valid rows
```

Only adapt the payload and metadata.

## 5.8 Current reporting/logging

Extend existing reports rather than replacing them.

Reports should include accuracy, validation, comparison-safety, preview, and final publishing outcomes.

---

# 6. Incremental Upgrade Strategy

Do this in phases.

## Phase 1: Inspect and map current OCR pipeline

Goal:

```text
identify the exact current prompt, schema, parser, queue, JSON save location, DB mapper, publishing gate, and preview/results UI
```

Change:

```text
minimal or none
```

Output:

```text
developer notes showing where each current module lives
```

## Phase 2: Add candidate-based extraction prompt and schema

Change:

```text
replace narrow Mistral crop prompt
update strict schema
save richer raw OCR JSON
```

Keep untouched:

```text
crop generation
Mistral API client
Supabase upload
DB upsert
```

## Phase 3: Add canonical normalization layer

Change:

```text
raw OCR JSON → canonical offer object
legacy fields supported
unknown fields preserved
```

Keep untouched:

```text
raw JSON saving
image upload
DB upsert
```

## Phase 4: Add deterministic sanity checks

Change:

```text
price/size checks
old-price/current-price checks
metadata/context checks
comparison exclusion checks
```

Keep untouched:

```text
Mistral API call mechanism
Supabase infrastructure
```

## Phase 5: Add adaptive leaflet/page style profile

Change:

```text
runtime style profile per page/leaflet
style profile prompt
style profile artifact saved in extraction package
```

Keep untouched:

```text
manual template/crop system
DB sync
```

## Phase 6: Add style-aware validation call

Change:

```text
second Mistral call per item
validation prompt
validation schema
corrected field handling
```

Keep untouched:

```text
crop generation
first extraction call mechanism
Supabase upload
```

## Phase 7: Add comparison-safety logic

Change:

```text
comparison_eligible
comparison_unit
comparison_unit_price
comparison_confidence
comparison_exclusion_reason
```

Keep untouched:

```text
public display publishing
```

## Phase 8: Improve publish decision engine

Change:

```text
publish
publish_but_exclude_from_comparison
skip_or_quarantine
```

Keep:

```text
status = published for valid rows
```

## Phase 9: Add Pre-Publish Preview and human approval gate

Change:

```text
add Pre-Publish Preview button/window
show grid of crop images and extracted canonical fields
show final row decision, warnings, errors, and comparison status
publish only after user clicks Publish inside preview
```

Keep untouched:

```text
existing extraction flow
existing Supabase upload/upsert logic
```

## Phase 10: Improve reporting and regression tests

Change:

```text
accuracy-run-report.json
pre-publish-preview-summary.json
warning/error counts
fixtures for known problem cases
```

---

# 7. Updated Crop-Level Mistral Extraction Prompt

Use this as the replacement for the existing narrow crop-level prompt.

```text
You are reading one cropped item image from a Saudi supermarket promotion leaflet.

The app has already assigned this crop the item number:

{itemNumber}

Return strict valid JSON only.
Do not return markdown.
Do not return prose.
Do not return comments.
Do not include keys outside the expected schema.

Your task is not only to pick final fields.
Your task is to extract visual evidence.

The image may contain:
- current offer price
- old/original/crossed-out price
- product name in Arabic and/or English
- product description
- product size/content such as 1.5L, 730ml, 10kg, 8 × 135g, 30PCS
- pack quantity
- bundle/promotion labels such as 1+1, 1+2, 2+1, 6+1, 2 for 10
- price basis such as each, per pack, per box, per bag, per kg, per 2kg, per dozen
- branch restrictions
- loyalty conditions
- non-grocery attributes such as screen size, resolution, features, streaming services

Important safety rules:
- 1.5L is a size/content value, not an offer price.
- 730ml is a size/content value, not an offer price.
- 10kg is a size/content value, not an offer price.
- 8 × 135g is pack/content information, not an offer price.
- 30PCS is quantity/content information, not an offer price.
- 50 inch, 55 inch, 65 inch, 4K, HD, LED are product attributes, not offer prices.
- A crossed-out, smaller, or old price must not be selected as the current offer price.
- If both a prominent current price and an old price are visible, classify both separately.
- If a number is attached to L/ml/kg/g/pcs/inch, classify it as size/content/screen_size unless there is clear visual evidence it is a price.
- If a price is visually ambiguous, do not guess. Return a blocking warning.

Extract every visible price-like number as a price candidate.
Extract every visible size/content-like number as a size candidate.
Then select the most likely current offer price and original price, if visible.

For each price candidate, include:
- raw visible text
- normalized numeric value
- currency if visible
- visual role
- selected classification
- confidence
- visual evidence

For each size/content candidate, include:
- raw visible text
- normalized value if possible
- unit
- classification
- confidence
- visual evidence

Visual evidence must include any visible clues such as:
- color of the number/text if obvious
- price block color if obvious
- whether the number is large/prominent
- whether the number is crossed out
- whether it is near a SAR symbol
- whether it is attached to L/ml/kg/g/pcs/inch
- whether it is near product title/package text
- approximate position such as top-left, bottom-right, center
- whether it appears inside a price block or product description area

Classify item_domain as one of:
- grocery
- household
- personal_care
- electronics
- appliance
- other_non_grocery
- unknown

Return confidence values as:
- high
- medium
- low

Allowed publish decisions:
- publish
- publish_but_exclude_from_comparison
- skip_or_quarantine

Use publish only if the current offer price and product title are clear.
Use publish_but_exclude_from_comparison if the item is safe to display but pack size, comparison unit, category, or content is uncertain.
Use skip_or_quarantine if the current offer price is missing, ambiguous, likely a size, likely the old price, or the product title is missing.

Return JSON using the expected schema.
```

---

# 8. Updated Extraction Strict JSON Schema

The current tool appends:

```text
EXPECTED JSON SCHEMA:
```

Keep that behavior.

Replace the narrow schema with this strict schema shape.

```json
{
  "item_number": "001",
  "product_text": {
    "title_ar": "string or null",
    "title_en": "string or null",
    "description_ar": "string or null",
    "description_en": "string or null",
    "brand_text": "string or null",
    "category_hint": "string or null",
    "item_domain": "grocery | household | personal_care | electronics | appliance | other_non_grocery | unknown"
  },
  "price_candidates": [
    {
      "raw_text": "string",
      "normalized_value": 0,
      "currency": "SAR | null",
      "visual_role": "prominent_current_price | crossed_out_old_price | smaller_old_price | price_label | ambiguous | not_a_price",
      "classified_as": "offer_price | original_price | ambiguous_price | not_a_price",
      "confidence": "high | medium | low",
      "evidence": "string",
      "visual_evidence": {
        "text_color": "string or null",
        "price_block_color": "string or null",
        "relative_size": "largest | large | medium | small | unknown",
        "is_crossed_out": true,
        "near_currency_symbol": true,
        "attached_unit": "string or null",
        "position_hint": "top-left | top-right | center | bottom-left | bottom-right | unknown",
        "inside_price_block": true
      }
    }
  ],
  "size_candidates": [
    {
      "raw_text": "string",
      "normalized_value": 0,
      "unit": "liter | milliliter | kilogram | gram | piece | inch | dozen | other | null",
      "classified_as": "each_size | total_size | pack_quantity | screen_size | quantity | ambiguous_size",
      "confidence": "high | medium | low",
      "evidence": "string",
      "visual_evidence": {
        "attached_unit": "string or null",
        "near_product_title_or_pack": true,
        "inside_price_block": false,
        "position_hint": "top-left | top-right | center | bottom-left | bottom-right | unknown"
      }
    }
  ],
  "selected_prices": {
    "offer_price": 0,
    "original_price": 0,
    "currency": "SAR",
    "offer_price_source_raw_text": "string or null",
    "original_price_source_raw_text": "string or null",
    "selection_confidence": "high | medium | low",
    "selection_evidence": "string"
  },
  "content": {
    "size_text": "string or null",
    "pack_quantity": 0,
    "bundle_quantity": 0,
    "each_size_value": 0,
    "each_size_unit": "liter | milliliter | kilogram | gram | piece | inch | dozen | other | null",
    "total_content_value": 0,
    "total_content_unit": "liter | milliliter | kilogram | gram | piece | dozen | other | null",
    "content_confidence": "high | medium | low"
  },
  "price_basis": {
    "basis": "each | per_pack | per_box | per_bag | per_kg | per_2kg | per_dozen | bundle | multi_buy | unknown",
    "raw_text": "string or null",
    "confidence": "high | medium | low",
    "evidence": "string"
  },
  "promotion": {
    "mechanic": "standard_price | bogo | bundle | multi_buy | loyalty_required | selected_branches | unknown",
    "raw_text": "string or null",
    "bundle_quantity": 0,
    "condition_text": "string or null",
    "confidence": "high | medium | low",
    "evidence": "string"
  },
  "classification_evidence": {
    "why_offer_price": "string or null",
    "why_original_price": "string or null",
    "why_size_is_not_price": "string or null",
    "why_publish_decision": "string"
  },
  "confidence": {
    "overall": "high | medium | low",
    "product_text": "high | medium | low",
    "offer_price": "high | medium | low",
    "original_price": "high | medium | low",
    "content": "high | medium | low",
    "promotion": "high | medium | low"
  },
  "warnings": {
    "blocking": [
      {
        "code": "string",
        "message": "string"
      }
    ],
    "non_blocking": [
      {
        "code": "string",
        "message": "string"
      }
    ]
  },
  "model_recommendation": {
    "publish_decision": "publish | publish_but_exclude_from_comparison | skip_or_quarantine",
    "comparison_eligible": true,
    "comparison_exclusion_reason": "string or null"
  },
  "raw_attributes": {
    "additional_visible_fields": {}
  }
}
```

Implementation note:

* Keep the top-level schema strict.
* Do not allow arbitrary top-level keys.
* Allow `raw_attributes.additional_visible_fields` to preserve unusual fields.
* Support nullable values if the existing schema system requires `null` instead of missing keys.
* Keep legacy parser compatibility for existing JSON files.

---

# 9. Canonical Normalization Layer

Add or upgrade a canonical normalization layer.

Recommended files:

```text
src/shared/types/canonicalOffer.ts
src/shared/utils/canonicalOfferNormalizer.ts
src/shared/utils/legacyOcrFieldMapper.ts
```

The canonical object should separate:

```text
source metadata
trusted context
product text
price candidates
selected offer/original price
size/content
pack quantity
bundle quantity
price basis
promotion mechanic
comparison metadata
quality/warnings/errors
image metadata
raw OCR JSON
raw attributes
```

## Canonical object shape

```json
{
  "source": {
    "leaflet_id": "string",
    "source_page_number": 1,
    "source_item_number": "001",
    "external_image_id": "string"
  },
  "trusted_context": {
    "supermarket_id": "uuid-or-null",
    "location_scope": "national | region | city",
    "city_id": "uuid-or-null",
    "region_id": "uuid-or-null",
    "offer_start_date": "date-or-null",
    "offer_end_date": "date"
  },
  "product": {
    "title_ar": "string-or-null",
    "title_en": "string-or-null",
    "brand_text": "string-or-null",
    "category_hint": "string-or-null",
    "item_domain": "grocery | household | personal_care | electronics | appliance | other_non_grocery | unknown",
    "description_ar": "string-or-null",
    "description_en": "string-or-null"
  },
  "prices": {
    "offer_price": 0,
    "original_price": 0,
    "currency": "SAR",
    "discount_amount": 0,
    "discount_percentage": 0,
    "price_basis": "each | per_pack | per_box | per_bag | per_kg | per_2kg | per_dozen | bundle | multi_buy | unknown",
    "price_condition_text": "string-or-null",
    "all_price_candidates": []
  },
  "content": {
    "size_text": "string-or-null",
    "pack_quantity": 1,
    "bundle_quantity": null,
    "each_size_value": null,
    "each_size_unit": null,
    "total_content_value": null,
    "total_content_unit": null
  },
  "promotion": {
    "mechanic": "standard_price | bogo | bundle | multi_buy | loyalty_required | selected_branches | unknown",
    "special_offer": "string-or-null",
    "condition_text": "string-or-null"
  },
  "comparison": {
    "comparison_eligible": false,
    "comparison_unit": null,
    "comparison_unit_price": null,
    "comparison_confidence": "low",
    "comparison_exclusion_reason": "not_evaluated"
  },
  "image": {
    "image_bucket": "offer-images",
    "image_path": "string-or-null",
    "image_url": "string-or-null",
    "image_source_type": "leaflet_crop"
  },
  "quality": {
    "publish_decision": "skip_or_quarantine",
    "extraction_confidence": "low",
    "validation_confidence": "low",
    "comparison_confidence": "low",
    "blocking_errors": [],
    "non_blocking_warnings": []
  },
  "style_validation": {
    "validation_result": "not_run | pass | fail | corrected",
    "visual_evidence": {},
    "corrected_fields": {},
    "style_profile_scope": "page | leaflet | none"
  },
  "pre_publish": {
    "preview_eligible": false,
    "preview_group": "publish | publish_but_exclude_from_comparison | skip_or_quarantine",
    "display_in_preview": true
  },
  "raw": {
    "raw_ocr_json": {},
    "raw_validation_json": {},
    "raw_ocr_text": null,
    "raw_attributes": {}
  }
}
```

## Legacy field support

The normalizer must support existing/legacy fields such as:

```text
name_ar
name_en
arabic_name
english_name
description_ar
description_en
offer_price
current_price
sale_price
price
original_price
old_price
was_price
unit_size
unit_type
size
pack_size
pack_quantity
bundle_quantity
special_offer
price_condition
variant
features
screen_size
resolution
brand
```

Do not discard unknown fields.

Preserve:

```text
full original Mistral JSON in raw.raw_ocr_json
unknown fields in raw.raw_attributes
```

---

# 10. Adaptive Leaflet/Page Style Profile

Add adaptive style profiles as temporary runtime guidance.

Do not hardcode permanent supermarket rules.

Recommended files:

```text
src/main/ocr/styleProfileService.ts
src/main/ocr/styleProfilePromptBuilder.ts
src/shared/types/styleProfile.ts
```

## Style profile purpose

The style profile should identify visual conventions in the current leaflet/page:

```text
offer price style
original price style
size/content style
promotion label style
condition label style
color conventions
relative size conventions
crossed-out price patterns
price block colors
confidence
```

## Style profile object

```json
{
  "style_profile_scope": "leaflet | page",
  "page_number": 1,
  "confidence": "high | medium | low",
  "offer_price_patterns": [
    {
      "description": "large white digits inside green rounded price blocks",
      "color_notes": "white text on green block",
      "relative_size": "largest price-like number",
      "confidence": "medium"
    }
  ],
  "original_price_patterns": [
    {
      "description": "smaller crossed-out number near current price",
      "color_notes": "dark or red small text",
      "confidence": "medium"
    }
  ],
  "size_patterns": [
    {
      "description": "numbers attached to L/ml/kg/g/pcs near product title or package",
      "examples": ["1.5L", "730ml", "8x135g"],
      "confidence": "high"
    }
  ],
  "promotion_patterns": [
    {
      "description": "1+1 / 2+1 labels near pack image or price block",
      "confidence": "medium"
    }
  ],
  "condition_patterns": [
    {
      "description": "each/per pack/per kg/per 2kg labels near price",
      "confidence": "medium"
    }
  ],
  "warnings": [],
  "notes": [
    "This profile applies only to the current leaflet/page.",
    "Crop-specific evidence overrides this profile."
  ]
}
```

## Style profile prompt

```text
You are analyzing a supermarket leaflet page or leaflet sample to infer temporary visual style guidance.

Return strict JSON only.
Do not extract final item data.
Do not create permanent supermarket rules.
This style profile applies only to this leaflet/page.

Identify:
- how current offer prices are visually displayed
- how old/original prices are visually displayed
- how sizes/content are displayed
- how promotion mechanics are displayed
- how condition labels are displayed
- any color or layout patterns that help avoid confusing sizes with prices
- any color or layout patterns that help avoid confusing old prices with current offer prices

Look for:
- text color
- price block color
- relative font size
- crossed-out text
- proximity to SAR symbol
- proximity to product title/package
- position on the crop/page
- whether values appear inside price blocks or descriptive text areas

Return confidence as high, medium, or low.
If the page contains mixed styles, say so.
```

## Use rules

Style profile is guidance only.

Priority:

```text
crop-specific evidence
page-level style profile
leaflet-level style profile
general Saudi leaflet heuristics
if unclear, do not publish
```

---

# 11. Style-Aware Validation Call

Add a second Mistral validation call after extraction and normalization.

This is mandatory at first because direct publishing is enabled.

Recommended files:

```text
src/main/ocr/styleAwareItemValidationService.ts
src/main/ocr/styleAwareValidationPromptBuilder.ts
src/shared/types/styleAwareValidation.ts
```

## Validation call input

Each validation call receives:

```text
cropped image
raw extraction JSON
canonical normalized draft
temporary page/leaflet style profile
```

## Validation prompt

```text
You are validating a cropped item image from a Saudi supermarket promotion leaflet.

You will receive:
1. The cropped item image.
2. The raw extraction JSON from a previous OCR/model call.
3. A canonical normalized draft created by the app.
4. A temporary page/leaflet style profile.

Your job is to verify the normalized draft against the image.

Return strict JSON only.
Do not return markdown.
Do not return prose.
Do not include keys outside the expected schema.

Check these questions:
- Is the selected current offer price visually correct?
- Is the selected original/old price visually correct?
- Was a size/content value mistaken for a price?
- Was an old/crossed-out price mistaken for the current offer price?
- Is the pack size/content correct?
- Is pack_quantity correct?
- Is bundle_quantity correct?
- Is price_basis correct?
- Is promotion mechanic correct?
- Is the item safe to publish?
- Is the item safe for unit-price comparison?

Use visual evidence:
- text color
- price block color
- relative size
- crossed-out state
- proximity to SAR symbol
- attached units such as L/ml/kg/g/pcs/inch
- location in the crop
- whether the value is inside a price block
- whether the value is near product/package text

Important:
- Crop-specific visual evidence beats the style profile.
- The style profile is guidance only.
- If unclear, do not approve publishing.
- If safe to display but unsafe for comparison, use publish_but_exclude_from_comparison.
- If the current offer price is ambiguous, missing, likely a size, or likely the old price, use skip_or_quarantine.
- Do not approve a row only because the first extraction looked plausible.
```

## Validation response schema

```json
{
  "validation_result": "pass | fail | corrected",
  "corrected_fields": {
    "offer_price": 0,
    "original_price": 0,
    "size_text": "string or null",
    "pack_quantity": 0,
    "bundle_quantity": 0,
    "price_basis": "each | per_pack | per_box | per_bag | per_kg | per_2kg | per_dozen | bundle | multi_buy | unknown",
    "promotion_mechanic": "standard_price | bogo | bundle | multi_buy | loyalty_required | selected_branches | unknown"
  },
  "blocking_errors": [
    {
      "code": "string",
      "message": "string"
    }
  ],
  "non_blocking_warnings": [
    {
      "code": "string",
      "message": "string"
    }
  ],
  "comparison": {
    "comparison_eligible": true,
    "comparison_exclusion_reason": "string or null",
    "comparison_confidence": "high | medium | low"
  },
  "visual_evidence": {
    "offer_price": {
      "explanation": "string",
      "text_color": "string or null",
      "price_block_color": "string or null",
      "relative_size": "largest | large | medium | small | unknown",
      "is_crossed_out": false,
      "near_currency_symbol": true,
      "position_hint": "string"
    },
    "original_price": {
      "explanation": "string",
      "is_crossed_out": true,
      "relative_size": "string",
      "position_hint": "string"
    },
    "size": {
      "explanation": "string",
      "attached_unit": "string or null",
      "near_product_title_or_pack": true
    },
    "promotion": {
      "explanation": "string"
    }
  },
  "publish_decision": "publish | publish_but_exclude_from_comparison | skip_or_quarantine",
  "confidence": "high | medium | low"
}
```

## When to run validation

Initial default:

```text
Run validation for every item.
```

Later optional optimization:

```text
Run validation only for risky items.
```

Risky item examples:

```text
low or medium extraction confidence
multiple price candidates
size candidate resembles selected price
old price candidate near selected offer price
1+1 or multi-buy exists
price_basis is not each
pack quantity unclear
electronics/non-grocery
comparison calculation uncertain
```

---

# 12. Shared Mistral Rate-Limit Queue

All Mistral calls must use one shared queue.

Recommended file:

```text
src/main/ocr/mistralRateLimitQueue.ts
```

The queue must handle:

```text
item extraction calls
style profile calls
style-aware validation calls
retries
Retry-After
progress events
ETA calculation
```

Default behavior:

```text
maxConcurrent = 1
minRequestIntervalMs = 1100
```

Safer free-tier behavior:

```text
maxConcurrent = 1
minRequestIntervalMs = 5000
```

The delay must apply between every Mistral request, not only between same-type requests.

Example:

```text
request 1: item extraction
wait
request 2: item validation
wait
request 3: style profile
wait
request 4: item extraction
```

Progress should show separate counts:

```text
Extraction: 12 / 100
Validation: 11 / 100
Style profiles: 2 / 54
Queue wait: 1.1s
ETA: 23m
```

---

# 13. Deterministic Sanity Checks

Add deterministic validation after normalization and style-aware validation.

Recommended file:

```text
src/shared/utils/deterministicOfferChecks.ts
```

## Blocking errors

Rows with these errors must not be published:

| Rule                                                          | Error code                                    |
| ------------------------------------------------------------- | --------------------------------------------- |
| number attached to L/ml/kg/g/pcs/inch selected as offer price | `size_misclassified_as_price`                 |
| offer_price equals or closely resembles size value            | `offer_price_matches_size_value`              |
| offer_price is not present in price candidates                | `offer_price_not_in_price_candidates`         |
| offer_price is present only as size candidate                 | `offer_price_is_size_candidate`               |
| old/crossed-out/original price selected as current price      | `original_price_misclassified_as_offer_price` |
| offer price missing                                           | `missing_offer_price`                         |
| offer price ambiguous                                         | `ambiguous_offer_price`                       |
| product title missing                                         | `missing_product_title`                       |
| unresolved supermarket                                        | `unresolved_supermarket`                      |
| invalid location scope                                        | `invalid_location_scope`                      |
| missing city for city scope                                   | `missing_city_for_city_scope`                 |
| missing region for region scope                               | `missing_region_for_region_scope`             |
| expired/invalid offer end date                                | `invalid_offer_end_date`                      |
| unsafe image path                                             | `unsafe_image_path`                           |
| unresolved duplicate conflict                                 | `duplicate_conflict_unresolved`               |

## Non-blocking warnings

Rows may still publish with these warnings:

| Rule                                                  | Warning code                             |
| ----------------------------------------------------- | ---------------------------------------- |
| original price missing but offer price clear          | `missing_original_price`                 |
| brand missing                                         | `missing_brand`                          |
| category uncertain                                    | `low_confidence_category`                |
| promotion mechanic uncertain but price/title clear    | `unclear_promotion_mechanic`             |
| style profile confidence low but crop evidence strong | `low_confidence_style_profile`           |
| validation corrected non-critical field               | `validation_corrected_noncritical_field` |

## Comparison exclusions

Rows may publish but must be excluded from comparison for:

| Rule                                        | Exclusion code                   |
| ------------------------------------------- | -------------------------------- |
| pack size unclear                           | `unclear_pack_size`              |
| total content unclear                       | `unclear_total_content`          |
| price basis unclear                         | `unclear_price_basis`            |
| non-grocery item                            | `non_grocery_item`               |
| electronics/appliance                       | `unsupported_comparison_domain`  |
| unsupported unit                            | `unsupported_comparison_unit`    |
| per_kg/per_2kg basis but calculation unsafe | `unsafe_price_basis_calculation` |
| bundle quantity unclear                     | `unclear_bundle_quantity`        |

## Pattern rules

Treat these as size/content/product attributes, not prices:

```text
1.5L
1.5 L
730ml
730 ml
10kg
10 kg
8x135g
8 × 135g
30PCS
30 pcs
50"
55 inch
65 inch
4K
HD
LED
```

If selected as offer price, block.

---

# 14. Comparison-Safety Logic

Recommended file:

```text
src/shared/utils/comparisonSafety.ts
```

The output must include:

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

## Examples

### 1.5L oil

```text
offer_price = 10
total_content = 1.5 liter
comparison_unit_price = 10 / 1.5 = 6.67 SAR/liter
```

### 730ml 1+1 dishwashing liquid

```text
offer_price = 10
each_size = 730ml
bundle_quantity = 2
total_content = 1460ml = 1.46L
comparison_unit_price = 10 / 1.46 = 6.85 SAR/liter
```

### 8 × 135g pack

```text
pack_quantity = 8
each_size = 135g
total_content = 1080g = 1.08kg
comparison_unit_price = offer_price / 1.08kg
```

### Watermelon per 2kg

```text
price_basis = per_2kg
comparison_unit_price = offer_price / 2kg
```

### 30 pieces

```text
comparison_unit = piece
comparison_unit_price = offer_price / 30
```

Only do this if the category is safe to compare by piece.

### Per dozen

```text
comparison_unit = piece
comparison_unit_price = offer_price / 12
```

### TV/electronics

```text
comparison_eligible = false
comparison_exclusion_reason = non_grocery_item
```

---

# 15. Publishing Decision Engine

Recommended file:

```text
src/shared/utils/publishDecisionEngine.ts
```

The decision engine receives:

```text
canonical normalized offer
style validation result
deterministic sanity check result
comparison safety result
trusted context
image/storage safety result
duplicate/idempotency result
```

## Decision states

```text
publish
publish_but_exclude_from_comparison
skip_or_quarantine
```

## Publish

Use when:

```text
no blocking errors
offer_price clear
title exists
trusted supermarket resolved
location coverage valid
offer date valid
image path safe
duplicate/idempotency safe
comparison eligible or intentionally not required
```

DB row after final user approval:

```text
status = published
```

## Publish but exclude from comparison

Use when:

```text
display fields are safe
offer_price clear
title exists
no blocking errors
but comparison is unsafe or unsupported
```

DB row after final user approval:

```text
status = published
comparison_eligible = false
comparison_exclusion_reason = relevant code
```

If DB does not support comparison fields, preserve this in metadata/report and ensure any comparison export excludes the row.

## Skip or quarantine

Use when:

```text
blocking_errors.length > 0
offer_price missing/ambiguous
price likely size
price likely old price
title missing
trusted context invalid
image path unsafe
```

Do not publish.

If current DB supports a review/quarantine row, use existing behavior. Otherwise keep it local in reports.

---

# 16. Pre-Publish Preview and Human Approval Gate

Add a mandatory Pre-Publish Preview step before any Supabase DB upload/upsert.

This does not replace validation.

It is the final human visual approval gate.

## 16.1 Updated UI flow

After extraction completes:

```text
Start Extraction button → "Extraction Completed" and disabled
Pre-Publish Preview button → enabled
Publish/Update Database action → available only inside Pre-Publish Preview
```

Recommended main-page buttons:

```text
Start Extraction
Pre-Publish Preview
```

The old `Update Database` button should be renamed, hidden, disabled, or replaced so the user cannot upload directly from the main import page.

The dangerous final DB action should only appear inside the Pre-Publish Preview window as:

```text
Publish to Wifran DB
```

## 16.2 Preview window purpose

When the user clicks:

```text
Pre-Publish Preview
```

open a window/modal/page that displays all extracted item crops and their normalized extracted data.

The goal is for the user to visually compare:

```text
cropped image
```

against:

```text
extracted normalized fields
```

before publishing.

## 16.3 Preview grid layout

Display a grid of item cards.

Each card should contain:

```text
cropped image
final decision badge
confidence badge
warning/error count
FIELD_NAME / VALUE table
optional expandable details
```

Recommended card layout:

```text
[ cropped offer image ]

Decision: Publish / Publish but Exclude / Skip
Confidence: High / Medium / Low
Warnings: 2
Errors: 0

FIELD_NAME                 VALUE
title_ar                   ...
title_en                   ...
offer_price                10
original_price             15.99
size_text                  1.5L
pack_quantity              1
bundle_quantity            -
price_basis                each
promotion_mechanic          standard_price
comparison_eligible         true
comparison_unit_price       6.67 SAR/liter
comparison_exclusion        -
```

The table should show canonical normalized fields, not only raw Mistral fields.

## 16.4 Fields to display

At minimum, each item card table should include:

```text
source_page_number
source_item_number
title_ar
title_en
brand_text
item_domain
offer_price
original_price
currency
size_text
pack_quantity
bundle_quantity
each_size_value
each_size_unit
total_content_value
total_content_unit
price_basis
promotion_mechanic
condition_text
comparison_eligible
comparison_unit
comparison_unit_price
comparison_exclusion_reason
publish_decision
blocking_errors
non_blocking_warnings
```

Use concise values.

Large JSON should be hidden behind expandable details.

## 16.5 Expandable details

Each item card may include expandable sections:

```text
Raw OCR JSON
Validation JSON
Visual Evidence
Price Candidates
Size Candidates
Warnings and Errors
Comparison Details
```

Do not show everything expanded by default.

## 16.6 Preview filters/tabs

Add filters or tabs:

```text
All
Will Publish
Will Publish but Excluded from Comparison
Skipped / Quarantined
Warnings
Blocking Errors
Non-Grocery
```

Recommended counts:

```text
All (159)
Will Publish (134)
Excluded from Comparison (18)
Skipped (7)
Warnings (22)
Errors (7)
```

## 16.7 Preview summary header

At the top of the preview window show:

```text
Leaflet: Othaim_week24
Supermarket: Othaim
Coverage: City / Riyadh
Offer dates: 2026-06-10 to 2026-06-16

Will publish: 134
Will publish but exclude from comparison: 18
Skipped/quarantined: 7
Warnings: 22
Blocking errors: 7
```

## 16.8 Publish button behavior

Inside the Pre-Publish Preview, show:

```text
Publish to Wifran DB
```

When clicked, show a confirmation dialog:

```text
Ready to publish to Wifran DB:

Will publish: 134
Will publish but exclude from comparison: 18
Skipped/quarantined: 7

Only publishable rows will be uploaded.
Skipped/quarantined rows will not be uploaded.

Proceed?

[Publish] [Cancel]
```

On confirmation:

```text
upload images for publishable rows
upsert DB rows for publishable rows
do not upload skip_or_quarantine rows
write DB update status to manifest/report
```

## 16.9 No editing in first version

The first version should be read-only.

Do not add inline editing yet.

Reason:

```text
editing requires audit trail
dirty state management
revalidation
JSON rewriting
manual override handling
extra DB payload logic
```

First version:

```text
review only
filter
inspect
publish
cancel/close
```

Future version may add:

```text
edit field
exclude item
force quarantine
revalidate item
manual override audit log
```

## 16.10 Pre-Publish Preview manifest state

Update `extraction_manifest.json` with preview state.

Recommended fields:

```json
{
  "pre_publish_preview": {
    "status": "not_opened",
    "opened_at": null,
    "approved_at": null,
    "approved_by": null,
    "summary": {
      "publish_count": 0,
      "publish_but_exclude_from_comparison_count": 0,
      "skip_or_quarantine_count": 0,
      "warning_count": 0,
      "blocking_error_count": 0
    }
  },
  "db_update_status": "not_started"
}
```

Allowed preview statuses:

```text
not_opened
opened
approved
```

DB update must only start when the user clicks `Publish` inside the preview.

Implementation can either:

```text
set pre_publish_preview.status = approved immediately before DB upload
```

or:

```text
treat the Publish click itself as approval and then update the manifest
```

## 16.11 Preview package artifact

Write a local preview summary file:

```text
pre-publish-preview-summary.json
```

Recommended content:

```json
{
  "leaflet_id": "string",
  "created_at": "datetime",
  "counts": {
    "total_items": 0,
    "publish": 0,
    "publish_but_exclude_from_comparison": 0,
    "skip_or_quarantine": 0,
    "warnings": 0,
    "blocking_errors": 0
  },
  "items": [
    {
      "source_page_number": 1,
      "source_item_number": "001",
      "crop_path": "crops/page-001/item.webp",
      "json_path": "json/page-001/item.json",
      "publish_decision": "publish",
      "comparison_eligible": true,
      "fields": {
        "title_ar": "string",
        "title_en": "string",
        "offer_price": 0
      },
      "warnings": [],
      "errors": []
    }
  ]
}
```

This summary should be generated from the final canonical objects after validation and deterministic checks.

## 16.12 DB gate update

The final DB upload gate becomes:

```text
package loaded
manifest exists
manifest.extraction_status = completed
validation package passes
pre-publish preview can be generated
user clicks Publish inside preview
required metadata is valid
Supabase config is ready
there is at least one publishable matched crop+JSON pair
not currently publishing
```

The app must not allow DB upload merely because extraction is completed.

Extraction completion enables preview.

Preview approval enables final publish.

---

# 17. Integration With Existing Supabase Flow

Do not redesign Supabase ingestion from scratch.

Preserve:

```text
existing Supabase client setup
existing service-role security
existing Storage upload logic
existing offer_source/leaflet source logic
existing DB upsert logic
existing idempotency key
existing direct-publish behavior for valid rows
```

Add the new decision engine and Pre-Publish Preview before the existing DB mapper:

```text
raw extraction JSON
→ canonicalOffer
→ validation
→ deterministic checks
→ comparison decision
→ publish decision
→ Pre-Publish Preview
→ user clicks Publish
→ existing offerSyncMapper
→ existing Supabase upload/upsert
```

## Metadata storage

Store where supported:

```text
raw_ocr_json
raw_validation_json
normalized_payload
field_confidences
blocking_errors
non_blocking_warnings
comparison_metadata
promotion_metadata
style_profile_reference
visual_evidence
publish_decision
pre_publish_preview_status
```

Priority:

1. Existing JSONB metadata/extraction field if present.
2. Local extraction package report files if DB lacks fields.
3. Small future DB migration only if necessary.

Do not block the accuracy upgrade waiting for DB schema changes.

## Image upload

Preserve path convention:

```text
offer-images/{supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp
```

Store supported image metadata:

```text
image_bucket
image_path
image_url
image_source_type = leaflet_crop
source_page_number
source_item_number
external_image_id
offer_source_id if supported
```

## Idempotency

Keep stable keys such as:

```text
{leaflet_id}-{source_item_number}
```

Reruns must update existing offers, not create duplicates.

---

# 18. Run Report Improvements

Add or extend report output.

Recommended file:

```text
accuracy-run-report.json
```

Include:

```json
{
  "leaflet_id": "string",
  "supermarket": "string",
  "coverage_scope": "city | region | national",
  "valid_to": "date",
  "total_crops": 0,
  "extraction_calls": 0,
  "validation_calls": 0,
  "style_profile_calls": 0,
  "published_count": 0,
  "updated_count": 0,
  "publish_but_exclude_from_comparison_count": 0,
  "skipped_or_quarantined_count": 0,
  "price_ambiguity_count": 0,
  "size_as_price_detections": 0,
  "old_price_as_offer_price_detections": 0,
  "image_upload_success_count": 0,
  "image_upload_failure_count": 0,
  "style_validation_failures": 0,
  "style_validation_corrections": 0,
  "comparison_exclusions": 0,
  "non_grocery_rows": 0,
  "pre_publish_preview_opened": true,
  "pre_publish_approved": true,
  "pre_publish_approved_at": "datetime or null",
  "warnings_by_code": {},
  "errors_by_code": {},
  "items": [
    {
      "source_page_number": 1,
      "source_item_number": "001",
      "image_path": "string",
      "json_path": "string",
      "publish_decision": "publish",
      "comparison_eligible": true,
      "comparison_exclusion_reason": null,
      "blocking_errors": [],
      "non_blocking_warnings": []
    }
  ]
}
```

Report must include:

```text
published count
updated count
publish_but_exclude_from_comparison count
skipped/quarantined count
price ambiguity count
size-as-price detections
old-price-as-offer-price detections
image upload success/failure count
style validation failures
style validation corrections
comparison exclusions
non-grocery rows
pre-publish preview opened/approved status
warnings by code
errors by code
Mistral call counts
rate-limit wait time if available
```

---

# 19. Regression Tests and Fixtures

Add fixtures/tests for these cases.

## Required cases

### 1.5L oil must not become 1.51 offer price

Expected:

```text
1.5L classified as size/content
offer_price not 1.51
if model selects 1.51, deterministic check blocks
```

### 730ml Fairy 1+1 must not treat old price as offer price

Expected:

```text
730ml classified as size
1+1 promotion mechanic detected
bundle_quantity = 2
old price classified separately
current offer price selected correctly
comparison total content = 1.46L if offer price clear
```

### 8 × 135g pack

Expected:

```text
pack_quantity = 8
each_size_value = 135
each_size_unit = gram
total_content = 1080g = 1.08kg
comparison calculation correct
```

### Watermelon per 2kg

Expected:

```text
price_basis = per_2kg
comparison_unit = kilogram
comparison_unit_price = offer_price / 2
```

### TV/electronics

Expected:

```text
item_domain = electronics
screen_size preserved
screen_size not treated as price
comparison_eligible = false
comparison_exclusion_reason = non_grocery_item
```

### Old price must not become offer price

Expected:

```text
crossed-out/smaller price classified as original_price
if selected as offer_price, deterministic check blocks
```

### Style/color guardrail

Expected:

```text
large white digits in green price block can support offer_price
small crossed-out number can support original_price
size near product title with L/ml/kg/g/pcs does not become offer_price
style profile guides validation but crop evidence wins
```

### Same leaflet rerun must not duplicate offers

Expected:

```text
same leaflet_id + source_item_number updates existing offer
no duplicates
```

### Valid rows are preview eligible

Expected:

```text
publish_decision = publish
pre_publish.preview_eligible = true
```

### Valid rows publish only after preview publish click

Expected:

```text
extraction completed alone does not trigger DB upload
opening preview alone does not trigger DB upload
clicking Publish in preview triggers DB upload
```

### Blocking-error rows are not published

Expected:

```text
no DB upsert for blocking rows
or quarantine only if existing flow supports it
```

### Uncertain pack-size rows

Expected:

```text
status = published after preview approval
publish_decision = publish_but_exclude_from_comparison
comparison_eligible = false
comparison_exclusion_reason = unclear_pack_size
```

### Preview grid renders item image and FIELD_NAME/VALUE table

Expected:

```text
each crop image appears
canonical fields appear underneath in FIELD_NAME/VALUE rows
filters show correct counts
Publish button publishes only eligible rows
```

## Test levels

Add:

```text
unit tests for normalizer
unit tests for deterministic checks
unit tests for comparison-safety calculator
unit tests for publish decision engine
unit tests for preview summary builder
integration tests for extraction → validation → decision → preview
fixtures for raw Mistral JSON examples
smoke test for completed extraction package
rate-limit queue test verifying extraction and validation calls share one queue
preview publish test verifying no DB upload before user approval
```

---

# 20. Recommended Implementation Chunks

Do not implement this package as one huge change.

Recommended chunks:

```text
40-inspect-current-ocr-pipeline-and-map-upgrade-points.md
41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
42-canonical-offer-normalizer-and-legacy-field-mapper.md
43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md
44-adaptive-style-profile-generation.md
45-style-aware-validation-call-for-every-item.md
46-deterministic-price-size-and-publishing-sanity-checks.md
47-comparison-safety-and-publish-decision-engine.md
48-pre-publish-preview-and-human-publish-approval-gate.md
49-accuracy-run-report-and-regression-fixtures.md
50-supabase-metadata-mapping-for-extraction-quality.md
```

Chunk 40 should inspect first and report actual current modules before any major implementation.

---

# 21. Developer Implementation Prompt

Use this prompt for AI coding agents after saving this document.

```text
You are upgrading an existing Wifran external extraction and ingestion tool.

This is not a greenfield build.

The existing tool already:
- processes supermarket leaflet images/crops
- sends cropped item images to Mistral
- receives JSON extraction output
- saves item crop images
- uploads images to Wifran Supabase Storage
- inserts/updates offers in Wifran’s Supabase database
- supports direct publishing for valid rows

Your task is to improve extraction accuracy and publishing safety without rebuilding working modules.

Read and inspect the existing code first.

Do not rewrite working modules blindly.
Do not replace the crop editor, crop generation, Mistral API client, Supabase client, image upload, or DB upsert flow unless inspection proves they must change.

Goal:
Upgrade the existing pipeline from narrow final-field OCR extraction to an evidence-first, candidate-based, validated pipeline:

existing crop image
→ improved Mistral extraction prompt with candidates and visual evidence
→ raw OCR JSON saved
→ canonical normalizer
→ adaptive leaflet/page style profile
→ style-aware Mistral validation call
→ deterministic sanity checks
→ comparison-safety decision
→ publish / publish-but-exclude / skip
→ Pre-Publish Preview
→ user clicks Publish
→ existing Supabase image upload and DB update

Important:
Use leaflet styling/coloring as an additional validation guardrail.
Use visual evidence such as color, price block color, relative size, crossed-out state, SAR symbol proximity, attached units, and position.
Do not hardcode permanent supermarket styles.
Crop-specific evidence beats style profile.

Important:
Run a second validation call to Mistral after extraction.
Initially validate every item because direct publishing is enabled.
The validation call receives the image, raw extraction JSON, normalized draft, and temporary style profile.
The validation call confirms or corrects offer price, original price, size, pack quantity, bundle quantity, price basis, and promotion mechanic.
If uncertain, do not publish.

Important:
All Mistral calls must use the same global rate-limit queue:
- extraction calls
- style profile calls
- validation calls

The delay applies between every Mistral request.
Default max concurrency is 1.
Respect Retry-After and 429 responses.
Show progress and ETA for extraction and validation calls.

Important:
Do not upload to Wifran DB immediately after extraction completes.
After extraction completes, enable Pre-Publish Preview.
The Pre-Publish Preview must show a grid of all cropped item images.
Under each image, show a FIELD_NAME / VALUE table of the canonical extracted data.
The user must visually review the preview and click Publish inside the preview window.
Only then should the tool upload images and upsert DB rows.
The main import page should not allow direct DB upload without preview approval.

Implementation steps:

1. Inspect existing modules:
- current Mistral prompt builder
- current strict JSON schema appended to Mistral prompt
- current Mistral API call mechanism
- current Mistral rate-limit queue
- current item JSON saving
- current crop/image generation logic
- current normalizer/parser
- current Supabase Storage upload logic
- current DB upsert logic
- current status/direct-publish logic
- current reporting/logging
- current preview/results UI if any
- current error handling

2. Replace narrow Mistral crop prompt:
New prompt must ask for:
- all visible price candidates
- all visible size/content candidates
- selected offer price
- selected original price
- price basis
- promotion mechanic
- classification evidence
- visual evidence
- confidence
- blocking warnings
- non-blocking warnings
- raw attributes

It must explicitly prevent:
- 1.5L becoming 1.51 offer_price
- 730ml becoming offer_price
- old/crossed-out price becoming current offer price
- screen size/inch values becoming prices

3. Update strict JSON schema:
Allow:
- product_text
- price_candidates
- price_candidates[].visual_evidence
- size_candidates
- size_candidates[].visual_evidence
- selected_prices
- content
- price_basis
- promotion
- classification_evidence
- confidence
- warnings
- model_recommendation
- raw_attributes

Keep top-level schema strict.

4. Add canonical normalization:
Map candidate-based and legacy Mistral responses into a stable canonical offer object.
Support legacy fields such as:
current_price, offer_price, sale_price, old_price, unit_size, unit_type, variant, features, screen_size, resolution, brand.
Preserve unknown fields in raw.raw_attributes.
Preserve full original response in raw.raw_ocr_json.

5. Add adaptive style profile:
Create temporary leaflet/page profile.
Infer:
- offer price style
- original price style
- size/content style
- promotion labels
- condition labels
- color/position/relative-size patterns
- confidence

Do not hardcode supermarket styles.

6. Add style-aware validation call:
Run after extraction and normalization.
Input:
- cropped image
- raw extraction JSON
- canonical normalized draft
- temporary style profile

Output:
- validation_result
- corrected_fields
- blocking_errors
- non_blocking_warnings
- visual_evidence
- publish_decision
- comparison decision

Initially run this validation for every item.

7. Add deterministic sanity checks:
Block:
- offer_price attached to L/ml/kg/g/pcs/inch
- offer_price equal/similar to size value
- offer_price not present in price candidates
- offer_price is old/crossed-out price
- missing/ambiguous offer price
- missing product title
- invalid location coverage
- invalid expiry date
- unsafe image path

Exclude from comparison:
- unclear pack size
- unclear total content
- unclear price basis
- non-grocery/electronics/appliance
- unsupported unit
- unsafe per_kg/per_2kg calculation

8. Add comparison-safety logic:
Calculate:
- comparison_eligible
- comparison_unit
- comparison_unit_price
- comparison_confidence
- comparison_exclusion_reason

Handle:
- 1.5L oil
- 730ml 1+1
- 8 × 135g pack
- watermelon per 2kg
- 30 pieces
- per dozen
- TV/electronics

9. Add final publishing decision engine:
Final decisions:
- publish
- publish_but_exclude_from_comparison
- skip_or_quarantine

Valid rows should still eventually be written to Wifran as:
status = published

Rows with blocking errors must not be published.

10. Add Pre-Publish Preview:
After extraction completes, the user must click Pre-Publish Preview.
Open a window/modal/page showing a grid of all crop images.
Under each image, show FIELD_NAME / VALUE rows from the canonical normalized data.
Show decision, confidence, warnings, errors, and comparison status.
Add filters:
All, Will Publish, Publish but Excluded from Comparison, Skipped/Quarantined, Warnings, Blocking Errors, Non-Grocery.
Add a Publish to Wifran DB button inside the preview.
Clicking Publish shows a confirmation summary.
Only after confirmation should Supabase image upload and DB upsert begin.
Do not allow DB upload from the main page without preview approval.
First version should be read-only; do not add field editing yet.

11. Preserve existing Supabase flow:
Do not redesign Supabase upload/DB integration from scratch.
Keep existing Storage upload and DB upsert where possible.
Only adapt the input payload from the canonical object and decision engine.
Store metadata where available.
If DB schema lacks metadata columns, keep full metadata in local run artifacts.

12. Improve reporting:
Add:
- published count
- updated count
- publish_but_exclude_from_comparison count
- skipped/quarantined count
- price ambiguity count
- size-as-price detections
- old-price-as-offer-price detections
- image upload success/failure count
- style validation failures
- style validation corrections
- comparison exclusions
- non-grocery rows
- pre-publish preview opened/approved status
- warnings by code
- errors by code
- extraction call count
- validation call count
- queue/rate-limit wait summary if available

13. Add regression tests:
- 1.5L oil must not become 1.51 offer_price
- 730ml Fairy 1+1 must not treat old price as offer price
- 8 × 135g pack calculates total content correctly
- watermelon per 2kg calculates comparison correctly
- TV/electronics excluded from grocery unit-price comparison
- old price must not become offer price
- style/color evidence helps validate offer/current/original price roles
- same leaflet rerun does not duplicate offers
- valid rows are preview eligible
- extraction completion alone does not upload to DB
- opening preview alone does not upload to DB
- clicking Publish inside preview uploads eligible rows
- blocking-error rows are not published
- uncertain pack-size rows are published but excluded from comparison
- extraction and validation calls share the same Mistral rate-limit queue

Acceptance criteria:
- Mistral no longer returns only final offer_price without candidates.
- Raw OCR/model JSON is stored.
- Visual evidence is extracted and used.
- Canonical normalization exists.
- Adaptive style profile exists.
- Style-aware validation call exists.
- Validation call runs for every item by default.
- All Mistral calls share one rate-limit queue.
- Deterministic sanity checks block common failures.
- Size-as-price mistakes are blocked.
- Old-price/current-price confusion is blocked.
- Per kg/per 2kg/per pack/per dozen are handled.
- 1+1 and bundle offers are handled.
- Comparison metadata is calculated only when safe.
- Valid rows become preview eligible.
- Pre-Publish Preview shows crop images and FIELD_NAME/VALUE tables.
- DB upload does not happen until user clicks Publish inside preview.
- Valid rows publish with status = published after preview approval.
- Blocking-error rows are not published.
- Uncertain rows are excluded from comparisons.
- Existing Supabase upload/upsert still works.
- Reruns remain idempotent.
- Detailed quality report is generated.

Proceed incrementally.
Keep the app runnable after every major change.
Do not remove working behavior unless it is unsafe.
```

---

# 22. Acceptance Criteria for the Full Upgrade

The full upgrade is complete when:

```text
Mistral extraction returns candidates, not only final offer_price.
Mistral extraction returns visual evidence.
The tool stores raw OCR/model JSON.
The tool normalizes into a canonical structure.
The tool infers temporary leaflet/page style profiles.
The tool uses style/color/layout as validation guardrails.
The tool runs a second style-aware validation call.
The validation call runs for every item by default.
All Mistral calls share one rate-limit queue.
The tool runs deterministic sanity checks.
The tool blocks 1.5L → 1.51 price mistakes.
The tool blocks 730ml → offer_price mistakes.
The tool blocks old-price-as-current-price mistakes.
The tool handles per kg/per 2kg/per pack/per dozen.
The tool handles 1+1 and bundle offers.
The tool calculates comparison metadata only when safe.
The tool marks valid rows as preview eligible.
The tool requires Pre-Publish Preview before DB upload.
The Pre-Publish Preview shows every crop image with extracted FIELD_NAME/VALUE rows.
The user must click Publish inside the preview before DB upload starts.
The tool publishes valid rows with status = published only after preview approval.
The tool does not publish rows with blocking errors.
The tool excludes uncertain rows from comparisons.
The tool preserves existing Supabase upload/upsert flow.
The tool remains idempotent on reruns.
The tool produces detailed quality reports.
The tool includes regression tests for known failure cases.
```

---

# 23. Final Recommendation

Use this policy:

```text
1. Extract evidence, not just final fields.
2. Preserve raw OCR and validation metadata for traceability.
3. Use adaptive style inference per leaflet/page.
4. Use crop-specific visual evidence as the strongest evidence.
5. Run a style-aware validation call for every item initially.
6. Use deterministic checks to catch common model mistakes.
7. Publish valid offers only after Pre-Publish Preview approval.
8. Display valid but non-comparable offers, but exclude them from unit-price rankings.
9. Skip or quarantine rows with critical uncertainty.
10. Keep all Mistral calls behind one shared rate-limit queue.
11. Keep grocery and non-grocery recommendation logic separate.
12. Preserve existing Supabase upload/upsert behavior unless it is unsafe.