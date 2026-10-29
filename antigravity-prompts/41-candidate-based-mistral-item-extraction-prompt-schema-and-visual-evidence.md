# Antigravity Prompt Chunk 41: Candidate-Based Mistral Item Extraction Prompt, Strict Schema, and Visual Evidence

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 41.

This chunk implements the first accuracy upgrade after Chunk 40’s inspection report.

Chunk 40 found that:

* current crop-level prompt file is `src/main/ocr/itemImageOcrPromptBuilder.ts`
* current schema handling is in `src/shared/schemas/itemOcrSchema.ts`
* the current crop prompt asks for final fields directly
* the current prompt does not ask for price candidates
* the current prompt does not ask for size candidates
* the current prompt does not ask for visual evidence
* the current prompt does not ask for confidence
* the current prompt does not ask for blocking/non-blocking warnings
* current Mistral integration uses `src/main/ocr/mistralOcrProvider.ts` and `src/main/ocr/itemImageOcrService.ts`
* current responses are parsed as JSON object format
* raw JSON is written to `json/` folders matching crop names

This chunk should update the **item image extraction prompt and strict schema only**.

Do not implement canonical normalization yet.

Do not implement style profile generation yet.

Do not implement the second validation call yet.

Do not implement deterministic sanity checks yet.

Do not implement comparison-safety logic yet.

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

Then inspect these existing files:

```text
src/main/ocr/itemImageOcrPromptBuilder.ts
src/shared/schemas/itemOcrSchema.ts
src/main/ocr/itemImageOcrService.ts
src/main/ocr/mistralOcrProvider.ts
src/shared/utils/ocrNormalization.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/ocr/ocrReturnedKeysRegistryService.ts
```

Adapt paths only if the actual project structure differs.

---

## 2. Goal

Replace the current narrow crop-level Mistral item extraction prompt with a candidate-based prompt that asks for:

```text
all visible price candidates
all visible size/content candidates
selected offer price
selected original price
price basis
promotion mechanic
classification evidence
visual evidence
confidence
blocking warnings
non-blocking warnings
raw attributes
```

Update the strict item OCR schema so the app can accept and validate this richer response.

The output from Mistral should no longer be only:

```text
item_number
name_ar
name_en
offer_price
original_price
size
pack_quantity
bundle_quantity
special_offer
```

The model should extract **evidence first**, then selected final fields.

---

## 3. Preserve Existing Working Behavior

Preserve the following:

```text
current crop generation
current crop filenames
current item_number assignment
current page number inference
current image-to-Mistral call mechanism
current Mistral API provider
current raw JSON saving path
current extraction package structure
current Supabase upload code
current DB upsert code
current publish status logic
```

Do not change from the existing Mistral Chat Completions/Vision flow in this chunk.

Do not switch models or endpoints in this chunk.

Chunk 40 reported that the current implementation uses `mistral-large-2512` via `https://api.mistral.ai/v1/chat/completions` for item crop vision extraction. Leave that mechanism alone for now.

This chunk is prompt/schema compatibility only.

---

## 4. Update `buildItemImageOcrPrompt(itemNumber: string)`

Update the current crop-level prompt builder in:

```text
src/main/ocr/itemImageOcrPromptBuilder.ts
```

The prompt must still include the existing dynamic item number:

```text
{itemNumber}
```

The prompt must explicitly tell the model:

```text
Return strict valid JSON only.
Do not return markdown.
Do not return prose.
Do not return comments.
Do not include keys outside the expected schema.
```

The prompt must explicitly prevent known mistakes:

```text
1.5L is size/content, not offer price.
730ml is size/content, not offer price.
10kg is size/content, not offer price.
8 × 135g is pack/content, not offer price.
30PCS is quantity/content, not offer price.
50 inch / 55 inch / 65 inch / 4K / HD / LED are product attributes, not offer prices.
Old/crossed-out/smaller price must not be selected as current offer price.
```

The prompt must instruct Mistral to extract:

```text
every visible price-like number as a price candidate
every visible size/content-like number as a size candidate
```

Then it should select the most likely current offer price and original price if visible.

---

## 5. Required New Prompt Text

Use this prompt text as the basis.

Keep existing project style if the prompt builder formats strings differently.

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

If the current prompt builder appends the schema after the instruction text, preserve that behavior.

---

## 6. Update Item OCR Schema

Update:

```text
src/shared/schemas/itemOcrSchema.ts
```

The schema must support the new candidate-based response.

If the project uses Zod, define Zod schemas for the following.

If it uses plain JSON schema for Mistral `response_format`, update that JSON schema too.

If it has both, keep them aligned.

---

## 7. Required Top-Level Response Shape

The new response shape should be:

```ts
{
  item_number: string;

  product_text: {
    title_ar: string | null;
    title_en: string | null;
    description_ar: string | null;
    description_en: string | null;
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
  };

  price_candidates: PriceCandidate[];

  size_candidates: SizeCandidate[];

  selected_prices: {
    offer_price: number | null;
    original_price: number | null;
    currency: 'SAR' | null;
    offer_price_source_raw_text: string | null;
    original_price_source_raw_text: string | null;
    selection_confidence: 'high' | 'medium' | 'low';
    selection_evidence: string | null;
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
    content_confidence: 'high' | 'medium' | 'low';
  };

  price_basis: {
    basis:
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
    raw_text: string | null;
    confidence: 'high' | 'medium' | 'low';
    evidence: string | null;
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
    raw_text: string | null;
    bundle_quantity: number | null;
    condition_text: string | null;
    confidence: 'high' | 'medium' | 'low';
    evidence: string | null;
  };

  classification_evidence: {
    why_offer_price: string | null;
    why_original_price: string | null;
    why_size_is_not_price: string | null;
    why_publish_decision: string | null;
  };

  confidence: {
    overall: 'high' | 'medium' | 'low';
    product_text: 'high' | 'medium' | 'low';
    offer_price: 'high' | 'medium' | 'low';
    original_price: 'high' | 'medium' | 'low';
    content: 'high' | 'medium' | 'low';
    promotion: 'high' | 'medium' | 'low';
  };

  warnings: {
    blocking: Array<{ code: string; message: string }>;
    non_blocking: Array<{ code: string; message: string }>;
  };

  model_recommendation: {
    publish_decision:
      | 'publish'
      | 'publish_but_exclude_from_comparison'
      | 'skip_or_quarantine';
    comparison_eligible: boolean;
    comparison_exclusion_reason: string | null;
  };

  raw_attributes: {
    additional_visible_fields: Record<string, unknown>;
  };
}
```

---

## 8. Price Candidate Shape

Add schema/type for:

```ts
type PriceCandidate = {
  raw_text: string;
  normalized_value: number | null;
  currency: 'SAR' | null;
  visual_role:
    | 'prominent_current_price'
    | 'crossed_out_old_price'
    | 'smaller_old_price'
    | 'price_label'
    | 'ambiguous'
    | 'not_a_price';
  classified_as:
    | 'offer_price'
    | 'original_price'
    | 'ambiguous_price'
    | 'not_a_price';
  confidence: 'high' | 'medium' | 'low';
  evidence: string | null;
  visual_evidence: {
    text_color: string | null;
    price_block_color: string | null;
    relative_size: 'largest' | 'large' | 'medium' | 'small' | 'unknown';
    is_crossed_out: boolean | null;
    near_currency_symbol: boolean | null;
    attached_unit: string | null;
    position_hint:
      | 'top-left'
      | 'top-right'
      | 'center'
      | 'bottom-left'
      | 'bottom-right'
      | 'unknown';
    inside_price_block: boolean | null;
  };
};
```

---

## 9. Size Candidate Shape

Add schema/type for:

```ts
type SizeCandidate = {
  raw_text: string;
  normalized_value: number | null;
  unit:
    | 'liter'
    | 'milliliter'
    | 'kilogram'
    | 'gram'
    | 'piece'
    | 'inch'
    | 'dozen'
    | 'other'
    | null;
  classified_as:
    | 'each_size'
    | 'total_size'
    | 'pack_quantity'
    | 'screen_size'
    | 'quantity'
    | 'ambiguous_size';
  confidence: 'high' | 'medium' | 'low';
  evidence: string | null;
  visual_evidence: {
    attached_unit: string | null;
    near_product_title_or_pack: boolean | null;
    inside_price_block: boolean | null;
    position_hint:
      | 'top-left'
      | 'top-right'
      | 'center'
      | 'bottom-left'
      | 'bottom-right'
      | 'unknown';
  };
};
```

---

## 10. Strictness Requirements

The new schema should be strict enough to prevent random top-level fields.

Rules:

```text
top-level object must be strict
known top-level keys only
candidate arrays must contain known objects only
enum fields must be enums
warnings must be arrays of { code, message }
raw_attributes.additional_visible_fields may allow arbitrary nested keys
```

Do not allow arbitrary extra top-level keys.

Do not allow the model to return freeform prose.

If current runtime validation strips extra keys, preserve that behavior.

If current validation rejects extra keys, preserve that behavior.

---

## 11. Backward Compatibility for Existing Saved JSON

The app already has old item JSON files saved in existing extraction packages.

Do not break loading old JSON files.

For this chunk, add schema support for the new format while preserving the ability for existing old JSON files to be read by current workflows.

Possible approaches:

```text
1. Create a union schema: legacy item OCR schema OR new candidate item OCR schema.
2. Keep the old schema exported under a legacy name and add a new candidate schema.
3. Add parsing helper that detects old vs new shape.
```

The normalizer will be upgraded in Chunk 42, so this chunk does not need to fully normalize old data.

But this chunk must not break existing package loading.

Required exported helpers if practical:

```ts
isCandidateItemOcrResponse(value): boolean
isLegacyItemOcrResponse(value): boolean
parseItemOcrResponse(value): CandidateOrLegacyItemOcrResponse
```

Use actual project style.

---

## 12. Current OCR Registry Compatibility

Chunk 40 found dynamic returned-key registry logic in:

```text
src/main/ocr/ocrReturnedKeysRegistryService.ts
```

Do not remove it.

Make sure the richer response does not break the returned-key registry.

If the registry currently tracks top-level keys only, it can continue doing so.

If it recursively tracks keys, make sure nested candidate fields do not cause crashes.

No major registry refactor in this chunk.

---

## 13. Raw JSON Saving Compatibility

Preserve raw JSON saving exactly as it currently works.

The item OCR workflow should still save the Mistral response to:

```text
json/page-XXX/{cropName}.json
```

Do not move files.

Do not rename crop JSON files.

Do not alter extraction package folder layout.

---

## 14. Minimal Adapter for Existing Downstream Code

Because downstream code may still expect fields like:

```text
name_ar
name_en
offer_price
original_price
size
pack_quantity
bundle_quantity
special_offer
```

this chunk should avoid breaking the pipeline before Chunk 42.

If needed, add a temporary compatibility adapter that derives legacy aliases from the new candidate response.

Example:

```ts
legacyCompatible.name_ar = product_text.title_ar;
legacyCompatible.name_en = product_text.title_en;
legacyCompatible.offer_price = selected_prices.offer_price;
legacyCompatible.original_price = selected_prices.original_price;
legacyCompatible.size = content.size_text;
legacyCompatible.pack_quantity = content.pack_quantity;
legacyCompatible.bundle_quantity = content.bundle_quantity;
legacyCompatible.special_offer = promotion.raw_text;
```

Important:

```text
Do not let this adapter become the final canonical normalizer.
Do not add advanced validation here.
This is only to keep the existing pipeline from crashing until Chunk 42.
```

If the current downstream code can already handle flexible raw JSON without crashing, do not add unnecessary adapter logic.

Document what you did.

---

## 15. Do Not Implement These Yet

Do not implement:

```text
canonicalOfferNormalizer
legacyOcrFieldMapper
styleProfileService
styleProfilePromptBuilder
styleAwareItemValidationService
deterministicOfferChecks
comparisonSafety
publishDecisionEngine
PrePublishPreview
accuracy-run-report.json
Supabase metadata mapping changes
```

Those belong to future chunks.

---

## 16. Logging / Debug Output

Add concise logging only if helpful.

The log should make it clear that candidate-based schema is active.

Example:

```text
Item OCR prompt mode: candidate_based_v1
```

Do not log secrets.

Do not log full image base64.

Do not log Mistral API keys.

---

## 17. Tests / Smoke Checks

Add or update tests where practical.

Focus only on prompt/schema.

Recommended tests:

```text
buildItemImageOcrPrompt includes itemNumber.
prompt mentions price_candidates.
prompt mentions size_candidates.
prompt mentions visual evidence.
prompt explicitly says 1.5L is not offer price.
prompt explicitly says 730ml is not offer price.
prompt explicitly says old/crossed-out price is not current offer price.
schema accepts a valid candidate-based response.
schema rejects random top-level keys.
schema supports null selected original price.
schema supports empty price_candidates and blocking warning for missing price.
legacy response still parses or is not broken.
```

If existing test setup is unclear, add a small test file following existing project conventions.

Do not run tests that call Mistral, Supabase, or external APIs.

---

## 18. Manual Smoke Test Instructions

After implementation, provide instructions for a safe local smoke test that does not call Mistral unless explicitly triggered by the operator.

Include:

```text
how to inspect generated prompt
how to run schema unit tests
how to verify old JSON files still parse/load
```

Do not run OCR on real data in this chunk.

---

## 19. Documentation Update

Update relevant docs if they exist:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Keep the documentation short.

Document:

```text
item OCR now asks for candidate-based extraction
raw response includes price_candidates and size_candidates
visual evidence is collected for later validation
this chunk does not yet enable style validation or comparison logic
```

Do not over-document future chunks as if already implemented.

---

## 20. Security Rules

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

## 21. Acceptance Criteria

This chunk is complete when:

* `src/main/ocr/itemImageOcrPromptBuilder.ts` is updated to candidate-based extraction.
* The prompt includes `{itemNumber}`.
* The prompt asks for all visible price candidates.
* The prompt asks for all visible size/content candidates.
* The prompt asks for selected offer price and selected original price.
* The prompt asks for price basis.
* The prompt asks for promotion mechanic.
* The prompt asks for classification evidence.
* The prompt asks for visual evidence including color, relative size, crossed-out state, SAR proximity, attached units, position, and price block context.
* The prompt asks for confidence.
* The prompt asks for blocking and non-blocking warnings.
* The prompt explicitly prevents `1.5L` / `730ml` / `10kg` / `8x135g` / `30PCS` / inch screen sizes from being treated as prices.
* The prompt explicitly prevents old/crossed-out price from being selected as current offer price.
* `src/shared/schemas/itemOcrSchema.ts` supports the new candidate-based shape.
* The schema is strict at the top level.
* Legacy saved JSON parsing/loading is not broken.
* Raw JSON saving remains unchanged.
* Current Mistral provider/API call mechanism remains unchanged.
* Supabase upload and DB upsert remain unchanged.
* No external OCR/API/DB operation was run.
* Tests or smoke checks for prompt/schema are added or updated where practical.
* App still typechecks.

---

## 22. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the prompt/schema changes needed for this chunk, keep the app runnable, then stop.

Do not implement future chunks in this step.

---

## 23. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text
files modified
files created
whether prompt was updated
whether schema was updated
how legacy compatibility was preserved
tests added/updated
commands run
commands skipped and why
any risks or TODOs
recommended next chunk
```

The recommended next chunk should be:

```text
42-canonical-offer-normalizer-and-legacy-field-mapper.md