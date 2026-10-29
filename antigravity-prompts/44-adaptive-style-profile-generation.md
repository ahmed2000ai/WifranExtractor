# Antigravity Prompt Chunk 44: Adaptive Leaflet/Page Style Profile Generation

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 44.

Chunks 41, 42, and 43 should already have completed:

```text id="j6jwd7"
41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
42-canonical-offer-normalizer-and-legacy-field-mapper.md
43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md
```

This chunk adds adaptive leaflet/page style profile generation.

The style profile is temporary guidance for the current leaflet or page.

It helps future validation distinguish:

```text id="dof42x"
current offer prices
old/original/crossed-out prices
sizes/content values
promotion labels
condition labels
```

using visual cues such as:

```text id="3k8c4o"
color
price block color
relative font size
crossed-out state
position
SAR symbol proximity
unit attachment
layout context
```

This chunk does **not** add the style-aware item validation call yet.

This chunk does **not** change final publish decisions.

This chunk does **not** add deterministic price/size checks.

This chunk does **not** add comparison-safety logic.

This chunk does **not** add Pre-Publish Preview.

This chunk does **not** change Supabase upload or DB upsert.

---

## 1. Read These Files First

Read the master accuracy package:

```text id="aooytb"
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read the Chunk 40 inspection report:

```text id="ev96ek"
wifran-offers-extractor/antigravity-reports/40-current-ocr-pipeline-inspection-report.md
```

Read previous prompts and inspect their implementation results:

```text id="4io9jk"
wifran-offers-extractor/antigravity-prompts/41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
wifran-offers-extractor/antigravity-prompts/42-canonical-offer-normalizer-and-legacy-field-mapper.md
wifran-offers-extractor/antigravity-prompts/43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md
```

Then inspect these project files:

```text id="meev84"
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/itemImageOcrService.ts
src/main/ocr/ocrRateLimitQueue.ts
src/main/ocr/mistralRateLimitQueue.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/extraction/extractionManifestService.ts
src/main/pdf/
src/main/image/
src/shared/schemas/itemOcrSchema.ts
src/shared/types/canonicalOffer.ts
src/renderer/src/pages/ImportPage.tsx
```

Adapt paths if the actual project structure differs.

---

## 2. Goal

Create a style-profile generation layer that analyzes rendered leaflet page images or representative crop/page images and produces a temporary style profile.

The style profile should describe how the current leaflet/page visually represents:

```text id="9wykxl"
current offer prices
old/original prices
sizes/content
promotions
conditions
non-price product attributes
```

This profile will be used in Chunk 45 by the style-aware item validation call.

For now, this chunk should only:

```text id="cd3n3s"
generate style profiles
save style profile artifacts
expose style profile loading helpers
route Mistral calls through the shared queue from Chunk 43
update manifest/report metadata where safe
```

Do not yet apply style profiles to block or approve offers.

---

## 3. Important Principle

The style profile is guidance only.

Do not hardcode permanent supermarket rules.

Do not store style rules as permanent Othaim/Panda/Carrefour logic.

The priority order for future validation must be:

```text id="tspflw"
1. crop-specific visual evidence
2. page-level style profile
3. leaflet-level style profile
4. general Saudi leaflet heuristics
5. if unclear, do not publish
```

This chunk should document that priority, but it should not yet enforce publish decisions.

---

## 4. Preserve Existing Working Behavior

Preserve:

```text id="nn6xee"
current crop generation
current crop filenames
current item number assignment
current candidate-based item prompt
current item OCR schema
current canonical normalizer
current shared Mistral queue
current raw JSON saving
current extraction package folder structure
current Supabase upload code
current DB upsert code
current publish status logic
current Import page behavior unless minimal progress labeling is needed
```

Do not change item extraction behavior in this chunk unless needed to optionally load style profile artifacts later.

Do not run DB sync.

Do not upload images.

---

## 5. Files to Create

Recommended new files:

```text id="657pzc"
src/shared/types/styleProfile.ts
src/shared/schemas/styleProfileSchema.ts
src/main/ocr/styleProfilePromptBuilder.ts
src/main/ocr/styleProfileService.ts
```

Optional helper file if project style prefers:

```text id="5l7q6w"
src/main/ocr/styleProfileArtifactService.ts
```

Optional tests:

```text id="3tyy83"
src/main/ocr/__tests__/styleProfilePromptBuilder.test.ts
src/shared/schemas/__tests__/styleProfileSchema.test.ts
```

Use the existing project’s conventions for test locations and exports.

---

## 6. Style Profile Type

Create a style profile type.

Recommended type name:

```ts id="tz9fcc"
LeafletStyleProfile
```

Recommended shape:

```ts id="8grle5"
export type LeafletStyleProfile = {
  schema_version: 1;

  profile_id: string;

  leaflet_id: string | null;

  scope: 'leaflet' | 'page';

  page_number: number | null;

  source_image_path: string | null;

  created_at: string;

  model: string | null;

  confidence: 'high' | 'medium' | 'low';

  offer_price_patterns: Array<{
    description: string;
    color_notes: string | null;
    price_block_color: string | null;
    relative_size: 'largest' | 'large' | 'medium' | 'small' | 'mixed' | 'unknown';
    position_notes: string | null;
    sar_symbol_notes: string | null;
    examples: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;

  original_price_patterns: Array<{
    description: string;
    color_notes: string | null;
    relative_size: 'largest' | 'large' | 'medium' | 'small' | 'mixed' | 'unknown';
    crossed_out_notes: string | null;
    position_notes: string | null;
    examples: string[];
    confidence: 'high' | 'medium' | 'low';
  }>;

  size_patterns: Array<{
    description: string;
    unit_examples: string[];
    position_notes: string | null;
    near_product_text_notes: string | null;
    inside_price_block_notes: string | null;
    confidence: 'high' | 'medium' | 'low';
  }>;

  promotion_patterns: Array<{
    description: string;
    examples: string[];
    position_notes: string | null;
    visual_notes: string | null;
    confidence: 'high' | 'medium' | 'low';
  }>;

  condition_patterns: Array<{
    description: string;
    examples: string[];
    position_notes: string | null;
    confidence: 'high' | 'medium' | 'low';
  }>;

  non_price_attribute_patterns: Array<{
    description: string;
    examples: string[];
    attribute_type:
      | 'screen_size'
      | 'resolution'
      | 'pack_quantity'
      | 'product_feature'
      | 'other';
    confidence: 'high' | 'medium' | 'low';
  }>;

  warnings: Array<{
    code: string;
    message: string;
  }>;

  notes: string[];

  raw_model_response: Record<string, unknown> | null;
};
```

Adjust field names only if needed to match existing project conventions.

---

## 7. Style Profile Schema

Create or update a strict schema for style profile responses.

If the project uses Zod, create:

```ts id="qeybs1"
leafletStyleProfileSchema
```

If the Mistral provider uses JSON schema response format, also create a JSON schema equivalent.

The schema should be strict at the top level.

Allow arrays to be empty.

Allow nullable string fields.

Do not allow arbitrary top-level keys except `raw_model_response` after parsing if needed.

---

## 8. Style Profile Prompt Builder

Create:

```text id="j236g5"
src/main/ocr/styleProfilePromptBuilder.ts
```

Recommended function:

```ts id="q2g6n7"
export function buildStyleProfilePrompt(input: {
  leafletId?: string | null;
  scope: 'leaflet' | 'page';
  pageNumber?: number | null;
}): string
```

Use this prompt as the basis:

```text id="3zj8eh"
You are analyzing a supermarket promotion leaflet page to infer temporary visual style guidance.

Return strict valid JSON only.
Do not return markdown.
Do not return prose.
Do not include keys outside the expected schema.

Do not extract final item data.
Do not create permanent supermarket rules.
This style profile applies only to this leaflet/page.

Your task is to identify visual patterns that help distinguish:
- current offer prices
- old/original/crossed-out prices
- product sizes/content values
- promotion mechanics
- condition labels
- non-price product attributes

Look for:
- text color
- price block color
- relative font size
- crossed-out text
- proximity to SAR symbol
- proximity to product title/package
- position on the crop/page
- whether values appear inside price blocks or descriptive text areas
- whether values are attached to L/ml/kg/g/pcs/inch
- whether values are screen sizes or product attributes

Important safety rules:
- 1.5L, 730ml, 10kg, 8×135g, and 30PCS are size/content/quantity indicators, not prices.
- 50 inch, 55 inch, 65 inch, 4K, HD, LED are product attributes, not prices.
- Old/crossed-out prices should be visually distinguished from current offer prices.
- If the page contains mixed visual styles, report that clearly.
- If you are uncertain, use low confidence.

Return a style profile only.
Do not decide whether any specific crop should be published.
Do not return final product offers.
```

If the provider requires the schema to be appended after the prompt, preserve the project’s current schema style.

---

## 9. Style Profile Service

Create:

```text id="i46t4j"
src/main/ocr/styleProfileService.ts
```

Recommended responsibilities:

```text id="slnkeg"
load page image
build prompt
call Mistral through shared queue
parse response
validate schema
add metadata
save profile artifact
return LeafletStyleProfile
```

Recommended function:

```ts id="xuai8c"
export async function generatePageStyleProfile(input: {
  leafletId?: string | null;
  pageNumber: number;
  pageImagePath: string;
  extractionPackagePath: string;
}): Promise<LeafletStyleProfile>
```

Optional function:

```ts id="i5qtym"
export async function generateLeafletStyleProfile(input: {
  leafletId?: string | null;
  samplePageImagePaths: string[];
  extractionPackagePath: string;
}): Promise<LeafletStyleProfile>
```

If leaflet-level profile requires image composition and that is too much for this chunk, skip leaflet-level generation and implement page-level profiles first.

Document the limitation.

---

## 10. Use Shared Mistral Queue

All style profile calls must go through the shared queue from Chunk 43.

Use metadata like:

```ts id="3o15ld"
{
  kind: 'style_profile',
  label: 'Page style profile',
  pageNumber
}
```

Do not create a separate queue.

Do not bypass the queue.

Do not run style profile calls concurrently outside the queue.

---

## 11. Mistral Provider Use

Reuse existing Mistral provider/API mechanism where practical.

Do not create a new unrelated Mistral client.

Do not switch endpoints or models in this chunk unless the existing provider already supports the needed vision call.

If the existing `mistralOcrProvider.ts` only exposes item-specific functions, add a generic safe internal helper for vision JSON calls only if needed.

Do not duplicate API key loading.

Do not log secrets.

Do not log image base64.

---

## 12. Profile Artifact Paths

Save style profiles inside the extraction package.

Recommended paths:

```text id="kq4j7x"
metadata/style-profiles/page-001-style-profile.json
metadata/style-profiles/page-002-style-profile.json
metadata/style-profiles/leaflet-style-profile.json
```

If the `metadata/style-profiles/` folder does not exist, create it.

Do not overwrite raw OCR JSON files.

Do not rename crop files.

Do not rename page files.

---

## 13. Manifest Integration

If `extraction_manifest.json` already has a flexible stages or metadata section, add style profile status safely.

Recommended manifest fields if compatible:

```json id="k42yu1"
{
  "stages": {
    "style_profile": {
      "status": "not_started",
      "total": 0,
      "completed": 0,
      "failed": 0,
      "started_at": null,
      "completed_at": null
    }
  },
  "paths": {
    "style_profiles_dir": "metadata/style-profiles"
  }
}
```

Do not break existing manifest loading.

If manifest schema is strict and risky to change now, save artifacts only and document manifest integration as a TODO.

---

## 14. When Style Profiles Should Run

Preferred future flow:

```text id="gdegpm"
pages rendered
→ generate page style profiles
→ item crop OCR
→ item validation uses page style profile
```

However, this chunk should not disrupt current extraction.

Choose one safe integration option:

### Option A: Add service and tests only

Implement style profile generation service but do not automatically run it in the workflow yet.

This is safest if workflow changes are risky.

### Option B: Add optional disabled-by-default generation

Add config:

```text id="j2iuvt"
ENABLE_STYLE_PROFILE_GENERATION=false
```

When false, current workflow is unchanged.

When true, generate page profiles after page rendering and before item validation/future validation.

Since validation does not exist yet, this option should only save artifacts.

Do not enable by default if it may surprise the operator with extra Mistral calls.

Recommended for this chunk:

```text id="l7x3xr"
Implement Option A or Option B with disabled-by-default behavior.
```

Do not silently double API usage.

---

## 15. Progress Events

If style profile generation is integrated into workflow, emit progress events.

Recommended labels:

```text id="ff3xau"
Style profile: page 1 / 54
Style profile queued
Style profile running
Style profile saved
Style profile failed
```

If not integrated yet, skip UI progress.

Do not overbuild UI in this chunk.

---

## 16. Failure Handling

Style profile generation failure should not crash the whole app by default.

If style profile generation is optional:

```text id="jt2o5h"
log warning
write failure metadata if practical
continue existing OCR workflow
```

If a future chunk makes validation depend on profiles, that future chunk can decide whether missing profiles should block validation.

For this chunk:

```text id="qgnfiv"
style profile failure should not publish or block offers
style profile failure should be reported clearly
```

---

## 17. Do Not Implement These Yet

Do not implement:

```text id="4ymwfs"
style-aware item validation call
deterministicOfferChecks
comparisonSafety
publishDecisionEngine
PrePublishPreview
DB gating changes
Supabase metadata mapping changes
```

This chunk only creates the style profile capability.

---

## 18. Tests

Add or update tests focused on style profile generation.

Recommended tests:

```text id="5lhw0k"
buildStyleProfilePrompt includes strict JSON instruction
buildStyleProfilePrompt says do not extract final item data
buildStyleProfilePrompt mentions offer price style
buildStyleProfilePrompt mentions original/crossed-out price style
buildStyleProfilePrompt mentions size/content style
buildStyleProfilePrompt mentions color and price block color
buildStyleProfilePrompt explicitly says 1.5L/730ml are not prices
styleProfileSchema accepts a valid profile
styleProfileSchema rejects random top-level keys
styleProfile artifact path builder creates metadata/style-profiles/page-001-style-profile.json
styleProfileService uses shared queue metadata kind style_profile with mocked provider
```

Use mocks/fake providers.

Do not call real Mistral.

Do not call Supabase.

---

## 19. Documentation Update

Update relevant docs briefly if they exist:

```text id="y8b761"
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text id="kb9hc7"
the tool now has style profile generation capability
style profiles are temporary per leaflet/page
style profiles are saved under metadata/style-profiles
style profiles are guidance only, not permanent supermarket rules
style profile generation is disabled by default if implemented as optional
this chunk does not yet validate or block offers using style profiles
```

Do not claim style-aware validation is implemented.

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
* Do not run real Mistral calls during development/tests.
* Do not write to Wifran DB.
* Do not publish offers.
* Do not delete files in `Extracts/`.
* Do not change Supabase upload or DB sync.
* Do not log full image base64 payloads.
* Do not log full Mistral request bodies containing images.

---

## 21. Acceptance Criteria

This chunk is complete when:

* `LeafletStyleProfile` or equivalent type exists.
* A strict style profile schema exists.
* A style profile prompt builder exists.
* The prompt explicitly asks for visual style guidance only.
* The prompt explicitly says not to extract final item data.
* The prompt covers offer price, original price, size/content, promotions, conditions, and non-price attributes.
* The prompt includes color, price block color, relative size, crossed-out state, SAR proximity, attached units, and position.
* The prompt explicitly says 1.5L, 730ml, 10kg, 8x135g, 30PCS, inch sizes, 4K/HD/LED are not prices.
* A style profile service exists or is scaffolded.
* Style profile calls use the shared Mistral queue with `kind: 'style_profile'`.
* Style profiles can be saved under `metadata/style-profiles/`.
* Style profile generation is not enabled by surprise if it would add extra API calls.
* Existing item OCR still works as before.
* Existing Supabase upload and DB upsert are unchanged.
* No style-aware item validation call is added yet.
* No deterministic publish gate is added yet.
* No real OCR/API/DB operation is run.
* Tests are added or updated where practical.
* TypeScript compiles.

---

## 22. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the style profile generation/scaffolding changes needed for this chunk, keep the app runnable, then stop.

Do not implement future chunks in this step.

---

## 23. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="7u2wwr"
files modified
files created
style profile type/schema added
style profile prompt builder added
style profile service/scaffold added
whether generation is automatic or disabled by default
where style profile artifacts are saved
how shared queue is used
tests added/updated
commands run
commands skipped and why
risks or TODOs
recommended next chunk
```

The recommended next chunk should be:

```text id="odnvrh"
45-style-aware-validation-call-for-every-item.md