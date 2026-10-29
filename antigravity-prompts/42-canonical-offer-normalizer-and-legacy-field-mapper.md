# Antigravity Prompt Chunk 42: Canonical Offer Normalizer and Legacy Field Mapper

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 42.

Chunk 41 should already have upgraded the item image Mistral extraction prompt and item OCR schema to support candidate-based extraction with:

```text
price_candidates
size_candidates
selected_prices
visual_evidence
confidence
warnings
raw_attributes
```

This chunk adds the canonical normalization layer and legacy field mapper.

Do not implement style-profile generation yet.

Do not implement the second Mistral validation call yet.

Do not implement deterministic sanity checks yet.

Do not implement comparison-safety calculations yet.

Do not implement the final publish decision engine yet.

Do not implement Pre-Publish Preview yet.

Do not change Supabase upload or DB upsert yet.

---

## 1. Read These Files First

Read the master accuracy package:

```text
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read the Chunk 40 inspection report:

```text
wifran-offers-extractor/antigravity-reports/40-current-ocr-pipeline-inspection-report.md
```

Read the Chunk 41 prompt and inspect its implementation results:

```text
wifran-offers-extractor/antigravity-prompts/41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
```

Then inspect existing project files, especially:

```text
src/shared/schemas/itemOcrSchema.ts
src/shared/utils/ocrNormalization.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/db/offerPreparationService.ts
src/main/db/offerSyncService.ts
src/main/db/offerSyncMapper.ts
src/main/ocr/ocrReturnedKeysRegistryService.ts
src/shared/types/manualCrop.ts
src/shared/types/reviewWorkflow.ts
```

Adapt paths if the actual project structure differs.

---

## 2. Goal

Add a canonical normalization layer that converts both old legacy OCR JSON and new candidate-based OCR JSON into one stable internal object.

The canonical object must separate:

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
comparison placeholder metadata
quality/warnings/errors
image metadata
raw OCR JSON
raw attributes
```

This layer should preserve old working behavior while preparing the pipeline for future chunks.

The immediate goal is not to make final publish decisions.

The immediate goal is to ensure the app has one normalized internal representation that future chunks can validate, compare, preview, and publish safely.

---

## 3. Preserve Existing Working Behavior

Preserve:

```text
current crop generation
current crop filenames
current item_number assignment
current raw JSON saving
current extraction package folder structure
current Mistral provider/API flow
current Supabase image upload
current DB upsert logic
current publish status behavior
current Import page button behavior
current Results page behavior
```

Do not make this chunk change whether rows are published or skipped.

Do not block rows in this chunk except where existing code already blocks them.

Do not add new DB columns or migrations.

---

## 4. Current Context From Chunk 40

Chunk 40 found:

```text
src/shared/utils/ocrNormalization.ts
```

currently contains:

```text
normalizeOcrExtractionResponse
parsePrice
normalizePackUnit
```

It also found the current normalization is limited and lacks:

```text
candidate-based normalization
legacy field mapping
complex price/size separation
raw OCR preservation strategy
old-price/current-price distinction
comparison metadata structure
```

This chunk should upgrade or wrap that module rather than blindly replacing it.

---

## 5. Files to Create or Extend

Prefer creating new shared types and utilities while keeping existing exports compatible.

Recommended new files:

```text
src/shared/types/canonicalOffer.ts
src/shared/utils/legacyOcrFieldMapper.ts
src/shared/utils/canonicalOfferNormalizer.ts
```

Recommended existing file to extend carefully:

```text
src/shared/utils/ocrNormalization.ts
```

If the current project style prefers fewer files, it is acceptable to place these in existing shared utils, but the final code should still have clear separation between:

```text
legacy field mapping
canonical object construction
existing compatibility normalization
```

---

## 6. Canonical Offer Type

Create a canonical offer type.

Recommended type name:

```ts
CanonicalOffer
```

Recommended supporting types:

```ts
CanonicalConfidence
CanonicalPublishDecision
CanonicalItemDomain
CanonicalPriceBasis
CanonicalPromotionMechanic
CanonicalComparisonMetadata
CanonicalQualityIssue
CanonicalPriceCandidate
CanonicalSizeCandidate
CanonicalRawPayload
```

Use existing project type conventions.

The canonical object should have this shape conceptually:

```ts
export type CanonicalOffer = {
  source: {
    leaflet_id: string | null;
    source_page_number: number | null;
    source_item_number: string;
    external_image_id: string | null;
    crop_path?: string | null;
    json_path?: string | null;
  };

  trusted_context: {
    supermarket_id: string | null;
    supermarket_slug?: string | null;
    location_scope: 'national' | 'region' | 'city' | null;
    city_id: string | null;
    region_id: string | null;
    offer_start_date: string | null;
    offer_end_date: string | null;
  };

  product: {
    title_ar: string | null;
    title_en: string | null;
    brand_text: string | null;
    category_hint: string | null;
    item_domain:
      | 'grocery'
      | 'household'
      | 'personal_care'
      | 'electronics'
      | 'appliance'
      | 'other_non_grocery'
      | 'unknown';
    description_ar: string | null;
    description_en: string | null;
  };

  prices: {
    offer_price: number | null;
    original_price: number | null;
    currency: 'SAR' | null;
    discount_amount: number | null;
    discount_percentage: number | null;
    price_basis:
      | 'each'
      | 'per_pack'
      | 'per_box'
      | 'per_bag'
      | 'per_kg'
      | 'per_2kg'
      | 'per_dozen'
      | 'bundle'
      | 'multi_buy'
      | 'unknown';
    price_condition_text: string | null;
    all_price_candidates: CanonicalPriceCandidate[];
  };

  content: {
    size_text: string | null;
    pack_quantity: number | null;
    bundle_quantity: number | null;
    each_size_value: number | null;
    each_size_unit:
      | 'liter'
      | 'milliliter'
      | 'kilogram'
      | 'gram'
      | 'piece'
      | 'inch'
      | 'dozen'
      | 'other'
      | null;
    total_content_value: number | null;
    total_content_unit:
      | 'liter'
      | 'milliliter'
      | 'kilogram'
      | 'gram'
      | 'piece'
      | 'dozen'
      | 'other'
      | null;
  };

  promotion: {
    mechanic:
      | 'standard_price'
      | 'bogo'
      | 'bundle'
      | 'multi_buy'
      | 'loyalty_required'
      | 'selected_branches'
      | 'unknown';
    special_offer: string | null;
    condition_text: string | null;
    bundle_quantity: number | null;
  };

  comparison: {
    comparison_eligible: boolean;
    comparison_unit: string | null;
    comparison_unit_price: number | null;
    comparison_confidence: 'high' | 'medium' | 'low';
    comparison_exclusion_reason: string | null;
  };

  image: {
    image_bucket: string | null;
    image_path: string | null;
    image_url: string | null;
    image_source_type: 'leaflet_crop' | string | null;
  };

  quality: {
    publish_decision:
      | 'publish'
      | 'publish_but_exclude_from_comparison'
      | 'skip_or_quarantine';
    extraction_confidence: 'high' | 'medium' | 'low';
    validation_confidence: 'high' | 'medium' | 'low' | 'not_run';
    comparison_confidence: 'high' | 'medium' | 'low';
    blocking_errors: CanonicalQualityIssue[];
    non_blocking_warnings: CanonicalQualityIssue[];
  };

  style_validation: {
    validation_result: 'not_run' | 'pass' | 'fail' | 'corrected';
    visual_evidence: Record<string, unknown>;
    corrected_fields: Record<string, unknown>;
    style_profile_scope: 'page' | 'leaflet' | 'none';
  };

  pre_publish: {
    preview_eligible: boolean;
    preview_group:
      | 'publish'
      | 'publish_but_exclude_from_comparison'
      | 'skip_or_quarantine';
    display_in_preview: boolean;
  };

  raw: {
    raw_ocr_json: Record<string, unknown>;
    raw_validation_json: Record<string, unknown> | null;
    raw_ocr_text: string | null;
    raw_attributes: Record<string, unknown>;
  };
};
```

This type can be adjusted to match existing TypeScript style.

---

## 7. Candidate Type Mapping

Map new candidate-based OCR fields from Chunk 41.

### Price candidates

Input path:

```text
price_candidates[]
```

Map to:

```text
canonical.prices.all_price_candidates[]
```

Keep fields such as:

```text
raw_text
normalized_value
currency
visual_role
classified_as
confidence
evidence
visual_evidence
```

Do not discard visual evidence.

If the model returns visual evidence with partial fields, preserve what exists.

### Size candidates

Input path:

```text
size_candidates[]
```

Map to:

```text
canonical.raw.raw_attributes.size_candidates
```

and also use selected content fields to populate:

```text
canonical.content
```

Do not yet run blocking size-as-price logic in this chunk.

That belongs to Chunk 46.

### Selected prices

Input path:

```text
selected_prices.offer_price
selected_prices.original_price
```

Map to:

```text
canonical.prices.offer_price
canonical.prices.original_price
```

Use existing `parsePrice` if necessary.

Keep `offer_price_source_raw_text` and `original_price_source_raw_text` in raw attributes or candidate evidence.

### Product text

Input path:

```text
product_text.title_ar
product_text.title_en
product_text.description_ar
product_text.description_en
product_text.brand_text
product_text.category_hint
product_text.item_domain
```

Map to:

```text
canonical.product
```

### Price basis

Input path:

```text
price_basis.basis
price_basis.raw_text
```

Map to:

```text
canonical.prices.price_basis
canonical.prices.price_condition_text
```

### Promotion

Input path:

```text
promotion.mechanic
promotion.raw_text
promotion.bundle_quantity
promotion.condition_text
```

Map to:

```text
canonical.promotion
canonical.content.bundle_quantity if stronger than content.bundle_quantity
```

### Confidence

Input path:

```text
confidence.overall
confidence.offer_price
confidence.content
```

Map to:

```text
canonical.quality.extraction_confidence
canonical.quality.comparison_confidence placeholder if needed
```

### Warnings

Input path:

```text
warnings.blocking
warnings.non_blocking
```

Map to:

```text
canonical.quality.blocking_errors
canonical.quality.non_blocking_warnings
```

Important: this chunk only preserves model warnings. It does not yet add deterministic checks.

---

## 8. Legacy Field Mapper

Create a legacy mapper that can read older OCR JSON structures.

Recommended file:

```text
src/shared/utils/legacyOcrFieldMapper.ts
```

It must support fields such as:

```text
name_ar
name_en
arabic_name
english_name
title_ar
title_en
description_ar
description_en
offer_price
current_price
sale_price
price
original_price
old_price
was_price
size
unit_size
unit_type
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
category
```

Mapping rules:

```text
name_ar / arabic_name / title_ar → product.title_ar
name_en / english_name / title_en → product.title_en
description_ar → product.description_ar
description_en → product.description_en
brand → product.brand_text
category / category_hint → product.category_hint

offer_price / current_price / sale_price / price → prices.offer_price
original_price / old_price / was_price → prices.original_price

size / unit_size / pack_size → content.size_text
unit_type → content.each_size_unit if safely mappable
pack_quantity → content.pack_quantity
bundle_quantity → content.bundle_quantity
special_offer → promotion.special_offer
price_condition → promotion.condition_text

screen_size / resolution / features / variant → raw.raw_attributes
```

For legacy price fields, create synthetic price candidates:

```text
offer_price/current_price/sale_price/price → classified_as = offer_price
original_price/old_price/was_price → classified_as = original_price
```

Confidence for synthetic candidates should be:

```text
medium
```

unless the old response has a confidence field.

Do not pretend legacy values have visual evidence.

For synthetic candidates:

```text
visual_evidence.relative_size = unknown
visual_evidence.position_hint = unknown
visual_evidence.is_crossed_out = null
```

---

## 9. Unknown Field Preservation

Every raw OCR response must be preserved completely.

Set:

```text
canonical.raw.raw_ocr_json = originalParsedResponse
```

Unknown fields should also be copied into:

```text
canonical.raw.raw_attributes
```

Do not drop fields such as:

```text
variant
features
streaming_services
screen_size
resolution
country_of_origin
storage_condition
notes
```

This is important for future debugging and category-specific logic.

---

## 10. Candidate vs Legacy Detection

Add helper functions where appropriate:

```ts
isCandidateItemOcrResponse(value): boolean
isLegacyItemOcrResponse(value): boolean
normalizeCandidateItemOcrResponse(...)
normalizeLegacyItemOcrResponse(...)
normalizeAnyItemOcrResponse(...)
```

Use actual project conventions.

Detection should be simple and robust:

```text
candidate response if it has price_candidates or selected_prices or product_text
legacy response if it has old fields like offer_price/name_ar/name_en/current_price
```

If a response has both, prefer candidate fields and preserve legacy extras in raw attributes.

---

## 11. Canonical Normalizer Function

Create a main function.

Recommended signature:

```ts
export function normalizeToCanonicalOffer(input: {
  rawOcrJson: unknown;
  source: {
    leafletId?: string | null;
    sourcePageNumber?: number | null;
    sourceItemNumber: string;
    externalImageId?: string | null;
    cropPath?: string | null;
    jsonPath?: string | null;
  };
  trustedContext?: {
    supermarketId?: string | null;
    supermarketSlug?: string | null;
    locationScope?: 'national' | 'region' | 'city' | null;
    cityId?: string | null;
    regionId?: string | null;
    offerStartDate?: string | null;
    offerEndDate?: string | null;
  };
  image?: {
    imageBucket?: string | null;
    imagePath?: string | null;
    imageUrl?: string | null;
    imageSourceType?: string | null;
  };
}): CanonicalOffer
```

Adapt signature if existing code has a better input object.

The function should:

```text
1. Parse/validate the OCR response shape using current schema helpers.
2. Detect candidate vs legacy response.
3. Map fields into CanonicalOffer.
4. Preserve raw OCR JSON.
5. Preserve unknown fields.
6. Add only basic model-provided warnings.
7. Fill safe defaults.
8. Return canonical object.
```

Do not call Mistral.

Do not access Supabase.

Do not write files unless existing workflow requires saving a derived artifact.

---

## 12. Defaults

Use safe defaults:

```text
item_domain = unknown
currency = SAR if price exists and currency missing
price_basis = unknown
promotion.mechanic = unknown
comparison.comparison_eligible = false
comparison.comparison_exclusion_reason = not_evaluated
quality.publish_decision = skip_or_quarantine by default until future decision engine
style_validation.validation_result = not_run
pre_publish.preview_eligible = false by default
pre_publish.display_in_preview = true
```

Important:

Do not make final publish decisions in this chunk.

If existing downstream code requires publish-like behavior, provide a compatibility adapter without changing final semantics.

---

## 13. Compatibility With Existing Downstream Code

The existing pipeline may still expect normalized legacy fields.

Keep existing exports from:

```text
src/shared/utils/ocrNormalization.ts
```

working.

If existing code calls:

```ts
normalizeOcrExtractionResponse(...)
```

do not break that function.

Instead, internally it may call the new canonical normalizer and then map back to the existing shape expected by current DB preparation code.

Example compatibility mapping:

```text
canonical.product.title_ar → existing name_ar/title_ar
canonical.product.title_en → existing name_en/title_en
canonical.prices.offer_price → existing offer_price
canonical.prices.original_price → existing original_price
canonical.content.size_text → existing size
canonical.content.pack_quantity → existing pack_quantity
canonical.content.bundle_quantity → existing bundle_quantity
canonical.promotion.special_offer/raw_text → existing special_offer
```

Document clearly that this compatibility mapping is temporary until later chunks update the DB preparation pipeline to consume CanonicalOffer directly.

Do not break current DB sync.

---

## 14. Optional Canonical Artifact Saving

If it is straightforward and does not disrupt the pipeline, save a normalized canonical JSON artifact next to the raw OCR JSON.

Suggested path:

```text
json/page-XXX/{cropName}.canonical.json
```

However, do not do this if it risks breaking existing folder assumptions.

If you add canonical artifact saving:

```text
do not replace the raw JSON
do not rename existing JSON files
do not make downstream code depend on the canonical file yet
```

If not implemented, document that canonical artifacts will be added later.

---

## 15. Do Not Implement Advanced Checks Yet

Do not add deterministic validation such as:

```text
size_misclassified_as_price
offer_price_matches_size_value
original_price_misclassified_as_offer_price
ambiguous_offer_price
comparison_eligible calculation
unit price calculation
final publish decision
```

These belong to future chunks.

It is okay to preserve model-provided warnings from the candidate response.

It is okay to carry legacy missing-price warnings if they already existed.

But do not introduce the full deterministic gate yet.

---

## 16. Tests

Add or update tests focused on normalization only.

Recommended test file names:

```text
src/shared/utils/__tests__/canonicalOfferNormalizer.test.ts
src/shared/utils/__tests__/legacyOcrFieldMapper.test.ts
```

Use existing test conventions.

Test cases:

```text
candidate response maps product_text into canonical.product
candidate response maps selected_prices into canonical.prices
candidate response preserves price_candidates with visual_evidence
candidate response preserves size_candidates in raw attributes or canonical support structure
candidate response maps warnings into quality blocking/non-blocking arrays
legacy response with name_ar/name_en/offer_price maps correctly
legacy response with current_price maps to offer_price
legacy response with old_price maps to original_price
legacy response with screen_size/features preserves unknown fields in raw_attributes
raw OCR JSON is preserved exactly
unknown top-level fields are preserved
defaults are safe when fields are missing
existing normalizeOcrExtractionResponse export still works
```

Do not add tests that call Mistral or Supabase.

---

## 17. Manual Smoke Test Instructions

After implementation, provide instructions to safely verify:

```text
a new candidate-shaped JSON can be normalized
an old legacy JSON can still be normalized
raw JSON files are not overwritten
existing pipeline still typechecks
existing downstream code can still read normalized values
```

Do not run OCR on real data in this chunk.

Do not run DB sync.

---

## 18. Documentation Update

Update relevant docs briefly if they exist:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
the app now has a canonical internal offer object
new OCR responses and old saved OCR responses are both supported
raw OCR JSON is preserved
unknown OCR fields are preserved in raw attributes
this chunk does not yet add style validation, deterministic checks, comparison logic, or Pre-Publish Preview
```

Do not claim future chunks are implemented.

---

## 19. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not add generic filesystem IPC.
* Do not upload images.
* Do not run Mistral OCR.
* Do not write to Wifran DB.
* Do not publish offers.
* Do not delete files in `Extracts/`.
* Do not change Supabase upload or DB sync.

---

## 20. Acceptance Criteria

This chunk is complete when:

* `CanonicalOffer` and related types exist.
* Candidate-based OCR JSON can be normalized into `CanonicalOffer`.
* Legacy OCR JSON can be normalized into `CanonicalOffer`.
* Existing saved old JSON files are not broken.
* Unknown fields are preserved in `raw.raw_attributes`.
* Full raw OCR JSON is preserved in `raw.raw_ocr_json`.
* Price candidates are preserved with visual evidence.
* Size candidates are preserved.
* Selected offer/original prices map correctly.
* Product text maps correctly.
* Price basis maps correctly.
* Promotion mechanic maps correctly.
* Model-provided warnings map into canonical quality fields.
* Existing `normalizeOcrExtractionResponse` behavior remains compatible for downstream code.
* Current crop OCR workflow still saves raw JSON as before.
* Current Supabase upload and DB upsert are unchanged.
* No deterministic validation gate is added yet.
* No comparison-safety logic is added yet.
* No style validation call is added yet.
* Tests for candidate and legacy normalization are added or updated where practical.
* TypeScript compiles.

---

## 21. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the normalizer and legacy mapper changes needed for this chunk, keep the app runnable, then stop.

Do not implement future chunks in this step.

---

## 22. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text
files modified
files created
canonical types added
normalizer functions added
legacy mapping behavior
how raw/unknown fields are preserved
how existing downstream compatibility was maintained
tests added/updated
commands run
commands skipped and why
risks or TODOs
recommended next chunk
```

The recommended next chunk should be:

```text
43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md