# Antigravity Prompt Chunk 45: Style-Aware Validation Call for Every Item

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 45.

Chunks 41–44 should already have completed:

```text id="c1iccv"
41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
42-canonical-offer-normalizer-and-legacy-field-mapper.md
43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md
44-adaptive-style-profile-generation.md
```

This chunk adds a second Mistral call for each extracted item crop.

The second call is a **style-aware validation call**.

It validates whether the first extraction and canonical normalized draft are visually correct.

This chunk does **not** implement deterministic price/size checks yet.

This chunk does **not** implement comparison-safety calculations yet.

This chunk does **not** implement the final publish decision engine yet.

This chunk does **not** implement Pre-Publish Preview yet.

This chunk does **not** change Supabase upload or DB upsert yet.

---

## 1. Read These Files First

Read the master accuracy package:

```text id="zp47c4"
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read the Chunk 40 inspection report:

```text id="c78o2v"
wifran-offers-extractor/antigravity-reports/40-current-ocr-pipeline-inspection-report.md
```

Read previous prompts and inspect their implementation results:

```text id="okktzq"
wifran-offers-extractor/antigravity-prompts/41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
wifran-offers-extractor/antigravity-prompts/42-canonical-offer-normalizer-and-legacy-field-mapper.md
wifran-offers-extractor/antigravity-prompts/43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md
wifran-offers-extractor/antigravity-prompts/44-adaptive-style-profile-generation.md
```

Then inspect these project files:

```text id="e34ka4"
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/itemImageOcrService.ts
src/main/ocr/itemImageOcrPromptBuilder.ts
src/main/ocr/styleProfileService.ts
src/main/ocr/styleProfilePromptBuilder.ts
src/main/ocr/mistralRateLimitQueue.ts
src/main/ocr/ocrRateLimitQueue.ts
src/shared/types/canonicalOffer.ts
src/shared/types/styleProfile.ts
src/shared/schemas/styleProfileSchema.ts
src/shared/schemas/itemOcrSchema.ts
src/shared/utils/canonicalOfferNormalizer.ts
src/shared/utils/ocrNormalization.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/extraction/extractionManifestService.ts
src/renderer/src/pages/ImportPage.tsx
```

Adapt paths if the actual project structure differs.

---

## 2. Goal

Add a style-aware validation layer after item extraction and canonical normalization.

For each item crop, the validation call receives:

```text id="j8mjqc"
1. the cropped item image
2. the raw extraction JSON from the first Mistral call
3. the canonical normalized draft from Chunk 42
4. the temporary page/leaflet style profile from Chunk 44, if available
```

The validation call should answer:

```text id="78pun5"
Is the selected current offer price visually correct?
Is the selected original/old price visually correct?
Was a size/content value mistaken for a price?
Was an old/crossed-out price mistaken for the current offer price?
Is the pack size/content correct?
Is pack_quantity correct?
Is bundle_quantity correct?
Is price_basis correct?
Is promotion mechanic correct?
Is the item safe to publish?
Is the item safe for unit-price comparison?
```

The output should be saved as a validation artifact and merged into the canonical object as validation metadata.

---

## 3. Important Safety Principle

The validation call is not a replacement for deterministic checks.

The validation call is a visual reviewer.

Future Chunk 46 will add deterministic checks.

Future Chunk 47 will add comparison-safety and final publish decision logic.

For this chunk:

```text id="fqkc43"
preserve validation output
preserve corrected fields
preserve warnings/errors
preserve visual evidence
do not make final DB publish decisions yet
```

---

## 4. Preserve Existing Working Behavior

Preserve:

```text id="irgiv6"
current crop generation
current crop filenames
current item number assignment
current candidate-based extraction prompt
current item OCR schema
current canonical normalizer
current style profile generator
current shared Mistral queue
current raw JSON saving
current extraction package folder structure
current Supabase upload code
current DB upsert code
current Import page behavior unless minimal progress labels are needed
```

Do not switch Mistral models.

Do not switch endpoints.

Do not alter Supabase code.

Do not upload images.

Do not write to DB.

---

## 5. Files to Create

Recommended new files:

```text id="nnc3xf"
src/shared/types/styleAwareValidation.ts
src/shared/schemas/styleAwareValidationSchema.ts
src/main/ocr/styleAwareValidationPromptBuilder.ts
src/main/ocr/styleAwareItemValidationService.ts
```

Optional helper if useful:

```text id="lylh9e"
src/main/ocr/styleAwareValidationArtifactService.ts
```

Optional tests:

```text id="ka1b38"
src/main/ocr/__tests__/styleAwareValidationPromptBuilder.test.ts
src/shared/schemas/__tests__/styleAwareValidationSchema.test.ts
src/main/ocr/__tests__/styleAwareItemValidationService.test.ts
```

Use the project’s existing conventions.

---

## 6. Style-Aware Validation Type

Create a type.

Recommended type name:

```ts id="xytsrr"
StyleAwareValidationResult
```

Recommended shape:

```ts id="mqlamx"
export type StyleAwareValidationResult = {
  schema_version: 1;

  validation_id: string;

  leaflet_id: string | null;

  source_page_number: number | null;

  source_item_number: string;

  crop_path: string | null;

  created_at: string;

  model: string | null;

  validation_result: 'pass' | 'fail' | 'corrected';

  corrected_fields: {
    offer_price: number | null;
    original_price: number | null;
    size_text: string | null;
    pack_quantity: number | null;
    bundle_quantity: number | null;
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
      | 'unknown'
      | null;
    promotion_mechanic:
      | 'standard_price'
      | 'bogo'
      | 'bundle'
      | 'multi_buy'
      | 'loyalty_required'
      | 'selected_branches'
      | 'unknown'
      | null;
  };

  blocking_errors: Array<{
    code: string;
    message: string;
  }>;

  non_blocking_warnings: Array<{
    code: string;
    message: string;
  }>;

  comparison: {
    comparison_eligible: boolean | null;
    comparison_exclusion_reason: string | null;
    comparison_confidence: 'high' | 'medium' | 'low';
  };

  visual_evidence: {
    offer_price: {
      explanation: string | null;
      text_color: string | null;
      price_block_color: string | null;
      relative_size: 'largest' | 'large' | 'medium' | 'small' | 'unknown' | null;
      is_crossed_out: boolean | null;
      near_currency_symbol: boolean | null;
      position_hint: string | null;
    };
    original_price: {
      explanation: string | null;
      is_crossed_out: boolean | null;
      relative_size: string | null;
      position_hint: string | null;
    };
    size: {
      explanation: string | null;
      attached_unit: string | null;
      near_product_title_or_pack: boolean | null;
    };
    promotion: {
      explanation: string | null;
    };
  };

  publish_decision:
    | 'publish'
    | 'publish_but_exclude_from_comparison'
    | 'skip_or_quarantine';

  confidence: 'high' | 'medium' | 'low';

  raw_model_response: Record<string, unknown> | null;
};
```

Adjust field names only if needed for existing project conventions.

---

## 7. Strict Validation Schema

Create:

```text id="ipvkd8"
src/shared/schemas/styleAwareValidationSchema.ts
```

If the project uses Zod, create a strict Zod schema.

If the Mistral provider uses JSON schema response format, also create a JSON schema equivalent.

Requirements:

```text id="mx0j4p"
strict top-level object
known fields only
nullable fields allowed where specified
arrays may be empty
enum values enforced
blocking_errors and non_blocking_warnings are arrays of { code, message }
raw_model_response may be added after parsing, not necessarily expected from model
```

Do not allow arbitrary top-level fields.

---

## 8. Style-Aware Validation Prompt Builder

Create:

```text id="p1v2pc"
src/main/ocr/styleAwareValidationPromptBuilder.ts
```

Recommended function:

```ts id="wkw1rm"
export function buildStyleAwareValidationPrompt(input: {
  leafletId?: string | null;
  sourcePageNumber?: number | null;
  sourceItemNumber: string;
  rawExtractionJson: Record<string, unknown>;
  canonicalDraft: Record<string, unknown>;
  styleProfile?: Record<string, unknown> | null;
}): string
```

Use this prompt as the basis:

```text id="bfv7ps"
You are validating a cropped item image from a Saudi supermarket promotion leaflet.

You will receive:
1. The cropped item image.
2. The raw extraction JSON from a previous OCR/model call.
3. A canonical normalized draft created by the app.
4. A temporary page/leaflet style profile, if available.

Your job is to verify the normalized draft against the image.

Return strict valid JSON only.
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

Known traps:
- 1.5L is size/content, not an offer price.
- 730ml is size/content, not an offer price.
- 10kg is size/content, not an offer price.
- 8×135g is pack/content, not an offer price.
- 30PCS is quantity/content, not an offer price.
- 50 inch, 55 inch, 65 inch, 4K, HD, LED are product attributes, not prices.
- Old/crossed-out/smaller prices must not be used as the current offer price.

Return the validation result using the expected schema.
```

The prompt must include serialized raw extraction JSON, canonical draft, and style profile in a compact readable way.

Do not include image base64 in logs.

---

## 9. Style-Aware Validation Service

Create:

```text id="p2wy81"
src/main/ocr/styleAwareItemValidationService.ts
```

Recommended responsibilities:

```text id="jd9c1s"
load crop image
build validation prompt
include raw extraction JSON
include canonical draft
include style profile if found
call Mistral through shared queue
parse response
validate schema
add metadata
save validation artifact
return StyleAwareValidationResult
```

Recommended function:

```ts id="d5may0"
export async function validateItemWithStyleAwareness(input: {
  leafletId?: string | null;
  sourcePageNumber?: number | null;
  sourceItemNumber: string;
  cropPath: string;
  rawExtractionJson: Record<string, unknown>;
  canonicalDraft: Record<string, unknown>;
  styleProfile?: Record<string, unknown> | null;
  extractionPackagePath: string;
}): Promise<StyleAwareValidationResult>
```

---

## 10. Use Shared Mistral Queue

All validation calls must use the shared queue from Chunk 43.

Use metadata like:

```ts id="p9hqfs"
{
  kind: 'item_validation',
  label: 'Item style-aware validation',
  pageNumber: sourcePageNumber,
  itemNumber: sourceItemNumber
}
```

Do not create a separate queue.

Do not bypass the queue.

Do not run validation calls concurrently outside the queue.

The queue delay must apply between extraction, style profile, and validation calls.

---

## 11. Mistral Provider Use

Reuse the existing Mistral provider/API mechanism where practical.

Do not create a separate Mistral client with separate API key loading.

Do not switch endpoint or model.

If the current provider only exposes item extraction helpers, add a generic JSON vision helper if needed.

Do not duplicate secret loading.

Do not log image base64.

Do not log the full request body containing image data.

---

## 12. Validation Artifact Paths

Save validation output inside the extraction package.

Recommended paths:

```text id="rddvtp"
json/page-001/{cropName}.validation.json
```

or:

```text id="t69arm"
metadata/validation/page-001/{cropName}.validation.json
```

Preferred:

```text id="qgfn80"
metadata/validation/page-001/{cropName}.validation.json
```

Reason:

```text id="vmful7"
raw extraction JSON remains clean in json/
validation artifacts are clearly separate
future preview/reporting can load validation metadata
```

Do not overwrite raw OCR JSON.

Do not rename crop files.

Do not rename page files.

---

## 13. Canonical Object Integration

Update the canonical object after validation.

The validation result should populate:

```text id="2vgpt4"
canonical.style_validation.validation_result
canonical.style_validation.visual_evidence
canonical.style_validation.corrected_fields
canonical.style_validation.style_profile_scope
canonical.raw.raw_validation_json
canonical.quality.validation_confidence
```

Also merge model-provided validation warnings/errors into:

```text id="jm4gcz"
canonical.quality.blocking_errors
canonical.quality.non_blocking_warnings
```

Important:

```text id="hd775d"
Do not yet run deterministic checks.
Do not yet calculate final comparison_unit_price.
Do not yet implement the final publishDecisionEngine.
```

If validation returns corrected fields, store them in `style_validation.corrected_fields`.

Do not silently overwrite canonical core fields unless the current project architecture clearly supports corrected-field application.

If you do apply corrected fields in this chunk, document exactly which fields are overwritten and why.

Safer default:

```text id="aew14m"
store corrected_fields separately
do not overwrite canonical.prices/content/promotion until Chunk 46 or 47
```

---

## 14. Workflow Integration

Integrate validation after raw extraction and canonical normalization.

Preferred flow:

```text id="25i1bz"
crop image
→ item extraction call
→ save raw extraction JSON
→ normalize to canonical offer
→ load page style profile if available
→ style-aware validation call
→ save validation JSON
→ attach validation metadata to canonical object
→ continue existing workflow
```

Important:

* Do not break existing extraction runs if style profiles do not exist.
* If no style profile exists, validation should still run with `styleProfile = null`.
* The validation prompt should say style profile is unavailable.
* Missing style profile should not crash validation.

---

## 15. Validation Defaults

The master spec requires validation for every item initially.

Add config support:

```text id="aem8v4"
VALIDATE_EVERY_ITEM=true
```

If the project already has a config system, use it.

If not, implement a safe local config helper with default true.

Also support disabling for emergency/debug:

```text id="dku3gi"
VALIDATE_EVERY_ITEM=false
```

When disabled:

```text id="5xg0b5"
skip validation calls
set canonical.style_validation.validation_result = not_run
do not fail extraction
log that validation was skipped by config
```

Do not modify `.env.local`.

Do not require the variable to exist.

---

## 16. Progress Events

If the extraction workflow already emits progress, add validation progress if safe.

Recommended labels:

```text id="zczr8b"
Validation: item 001 / 159
Validation queued
Validation running
Validation saved
Validation failed
```

If the UI wiring is risky, add backend progress/logging only and document TODO for UI.

Do not overbuild UI in this chunk.

---

## 17. Failure Handling

Validation failure should be recorded.

If validation call fails for an item:

```text id="gkbmlr"
save a validation failure artifact if possible
mark canonical.style_validation.validation_result = fail
add blocking error code = style_validation_failed
continue processing other items if existing workflow supports per-item failures
```

Do not create fake pass results.

Do not silently ignore validation failures.

Do not crash the whole run unless the existing workflow treats item-level failures as fatal.

The final decision logic will be improved later.

---

## 18. Manifest Integration

If manifest schema supports flexible stage metadata, add:

```json id="gbvq1n"
{
  "stages": {
    "item_validation": {
      "status": "not_started",
      "total": 0,
      "completed": 0,
      "failed": 0,
      "started_at": null,
      "completed_at": null
    }
  },
  "paths": {
    "validation_dir": "metadata/validation"
  }
}
```

Do not break existing manifest loading.

If manifest schema is strict and risky to change, save artifacts and document manifest integration as TODO.

---

## 19. Do Not Change DB Behavior Yet

Do not change:

```text id="g41epr"
offerImageStorageService
storagePathBuilder
offerSyncService
offerSyncMapper
offerPreparationService DB insert/upsert behavior
Supabase client
DB status mapping
```

This chunk may add validation metadata to canonical objects, but it must not change final Supabase behavior yet.

Pre-Publish Preview and DB gating come in Chunk 48.

---

## 20. Tests

Add or update tests focused on validation prompt/schema/service.

Recommended tests:

```text id="rv3pfp"
buildStyleAwareValidationPrompt includes raw extraction JSON
buildStyleAwareValidationPrompt includes canonical draft
buildStyleAwareValidationPrompt includes style profile when provided
buildStyleAwareValidationPrompt handles null style profile
prompt says crop evidence beats style profile
prompt says 1.5L/730ml are not prices
prompt says old/crossed-out price is not current price
styleAwareValidationSchema accepts valid pass result
styleAwareValidationSchema accepts valid corrected result
styleAwareValidationSchema accepts valid fail result
styleAwareValidationSchema rejects random top-level keys
validation service uses shared queue kind item_validation
validation service saves validation artifact with mocked provider
validation failure records style_validation_failed
VALIDATE_EVERY_ITEM=false skips call and marks not_run
```

Use mocks/fake providers.

Do not call real Mistral.

Do not call Supabase.

---

## 21. Documentation Update

Update relevant docs briefly if they exist:

```text id="p7ebtc"
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text id="yu6pd5"
the tool now supports style-aware validation calls
validation runs after extraction and canonical normalization
validation uses crop image, raw extraction JSON, canonical draft, and style profile if available
validation output is saved separately from raw OCR JSON
all validation calls use the shared Mistral rate-limit queue
VALIDATE_EVERY_ITEM defaults to true
this chunk does not yet add deterministic checks, comparison safety, or Pre-Publish Preview
```

Do not claim final publish safety is complete yet.

---

## 22. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not add generic filesystem IPC.
* Do not upload images to Supabase.
* Do not run real Mistral calls during tests.
* Do not write to Wifran DB.
* Do not publish offers.
* Do not delete files in `Extracts/`.
* Do not change Supabase upload or DB sync.
* Do not log full image base64 payloads.
* Do not log full request bodies containing images.
* Do not log secrets or env values.

---

## 23. Acceptance Criteria

This chunk is complete when:

* `StyleAwareValidationResult` or equivalent type exists.
* A strict style-aware validation schema exists.
* A style-aware validation prompt builder exists.
* The prompt includes raw extraction JSON.
* The prompt includes canonical draft.
* The prompt includes style profile when available.
* The prompt handles missing style profile safely.
* The prompt explicitly says crop evidence beats style profile.
* The prompt explicitly checks current offer price, original price, size, pack quantity, bundle quantity, price basis, and promotion mechanic.
* The prompt explicitly warns against 1.5L/730ml/10kg/8x135g/30PCS/inch/4K/HD/LED being prices.
* A style-aware validation service exists.
* Validation calls use the shared Mistral queue with `kind: 'item_validation'`.
* Validation artifacts are saved without overwriting raw OCR JSON.
* Canonical objects can store validation result, visual evidence, corrected fields, and raw validation JSON.
* Validation can run even when no style profile exists.
* `VALIDATE_EVERY_ITEM` defaults to true or the project’s equivalent config clearly enables validation by default.
* There is a way to disable validation for emergency/debug without code edits.
* Current Supabase upload and DB upsert are unchanged.
* No Pre-Publish Preview is added yet.
* No deterministic check gate is added yet.
* No comparison-safety logic is added yet.
* No real OCR/API/DB operation is run during tests.
* Tests are added or updated where practical.
* TypeScript compiles.

---

## 24. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the style-aware validation changes needed for this chunk, keep the app runnable, then stop.

Do not implement future chunks in this step.

---

## 25. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="l798tf"
files modified
files created
validation type/schema added
validation prompt builder added
validation service added
where validation artifacts are saved
how style profiles are loaded or handled when missing
how shared queue is used
whether validation runs by default
how validation can be disabled
how canonical validation metadata is stored
tests added/updated
commands run
commands skipped and why
risks or TODOs
recommended next chunk
```

The recommended next chunk should be:

```text id="twj9vp"
46-deterministic-price-size-and-publishing-sanity-checks.md