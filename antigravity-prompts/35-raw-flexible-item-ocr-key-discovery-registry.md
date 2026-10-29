# Antigravity Prompt Chunk 35: Raw Flexible Item OCR and Key Discovery Registry

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 35. Prompt Chunk 34 may have introduced flexible item OCR with canonical key replacement and alias handling.

This chunk changes that plan.

The new plan is:

```text
Do not canonicalize item JSON keys.
Do not replace aliases.
Do not classify aliases.
Do not create canonical_key groups during item OCR.
Save each item JSON exactly as returned by the OCR API, after only basic JSON validation/formatting.
Collect exact returned keys separately in a discovery registry.
```

The purpose is to observe what Mistral naturally returns across many item images. After the leaflet has finished processing, the app will later send the key registry to an LLM so aliases can be grouped and canonical keys can be proposed using real example values.

## 1. Read These Files First

Before coding, read files similar to:

```text
src/main/workflow/flexibleItemOcrDiscoveryQueue.ts
src/main/ocr/flexibleItemOcrPromptBuilder.ts
src/main/ocr/itemImageOcrService.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/ocrRateLimitQueue.ts
src/main/ocr/ocrReturnedKeysRegistryService.ts
src/shared/utils/ocrKeyCanonicalization.ts
src/main/workflow/backgroundPageCropQueue.ts
src/main/image/manualCropService.ts
src/shared/types/itemOcr.ts
src/shared/types/reviewWorkflow.ts
src/renderer/components/review/PreDbReviewSummary.tsx
src/renderer/components/review/ReviewItemTable.tsx
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Adapt paths if the current project structure differs.

## 2. Main Goal

Replace the canonical-key registry behavior from Chunk 34 with a raw key discovery workflow.

The new workflow:

```text
1. Background cropping generates an item image.
2. The item image is enqueued for flexible OCR.
3. Mistral returns a flexible JSON object.
4. The app validates that the response is a JSON object.
5. The app saves the returned JSON as-is next to the image.
6. The app scans the exact keys in that JSON.
7. The app stores each exact key once in ocr_returned_keys.json, along with the first non-empty/non-null value seen for that key.
8. If a key appears only with empty/null values across the whole process, store it in ocr_keys_without_values.json.
```

Do not group aliases during this chunk.

Do not replace key names in item JSON files.

Do not rewrite Mistral’s returned keys.

## 3. Per-Item JSON Files Must Be Raw API Output

For each item image:

```text
workspace/manual-crops/page-036/othaim-offers_036_014.webp
```

write the OCR JSON file:

```text
workspace/manual-crops/page-036/othaim-offers_036_014.json
```

The saved JSON should preserve the keys exactly as returned by Mistral.

Example Mistral response:

```json
{
  "sale_price": "15.99",
  "old_price": "22.50",
  "english_name": "Kellogg's Corn Flakes",
  "pack_size": "500g"
}
```

Saved item JSON must be exactly that object, formatted as JSON:

```json
{
  "sale_price": "15.99",
  "old_price": "22.50",
  "english_name": "Kellogg's Corn Flakes",
  "pack_size": "500g"
}
```

Do not save it as:

```json
{
  "offer_price": "15.99",
  "original_price": "22.50",
  "product_name_en": "Kellogg's Corn Flakes",
  "size": "500g"
}
```

because canonicalization is no longer allowed at this stage.

## 4. What Is Allowed to Change in Item JSON

Only these changes are allowed before saving item JSON:

```text
parse/validate the OCR response as JSON
ensure top-level output is a JSON object
pretty-format JSON for readability
remove wrapper markdown/code fences if Mistral accidentally returns them
```

Do not:

```text
rename keys
normalize keys
canonicalize keys
replace aliases
remove valid OCR keys
add missing keys
add metadata fields
add confidence/warnings/errors
add page number
add file name
add image path
add box number
add supermarket name
add leaflet dates
```

The item JSON file is an observation artifact and must reflect what the API returned.

## 5. OCR Prompt Update

Update the flexible item OCR prompt so it still asks for useful sparse JSON, but without enforcing canonical key names.

Recommended prompt file:

```text
src/main/ocr/flexibleItemOcrPromptBuilder.ts
```

The prompt should say:

```text
You are reading one cropped item image from a supermarket promotion flyer.

Return only a minimal JSON object.

Only include keys for information visibly present in this item image.

Do not include markdown.
Do not include prose.
Do not include comments.
Do not include explanation text.
Do not include null fields.
Do not include empty fields.
Do not include metadata.

Do not include:
- supermarket name
- PDF filename
- page number
- box number
- image path
- leaflet date
- city
- region
- crop coordinates
- confidence
- warnings
- errors
- model name
- API metadata

Use clear, concise JSON keys.
Snake_case keys are preferred, but do not force a fixed schema.

Return any useful product or offer fields visible in the image, such as:
- Arabic product name
- English product name
- description
- offer price
- original price
- currency
- size
- unit
- pack quantity
- bundle quantity
- special offer
- price condition
- flavor
- variant
- country of origin
- storage condition
- any other visibly useful item/offer attribute

Do not invent values.

Return valid JSON object only.
```

The prompt may recommend snake_case, but the app must not enforce or rename keys after receiving the JSON.

## 6. Remove or Disable Canonicalization

Disable any behavior introduced in Chunk 34 that does these things:

```text
normalizes returned OCR keys before saving item JSON
maps aliases to canonical keys
replaces alias keys in item JSON
creates canonical_key / aliases_seen groups
stores aliases_seen
treats same-meaning keys as duplicates
uses seeded alias maps
```

Files such as these may need to be removed, simplified, or no longer used by this workflow:

```text
src/shared/utils/ocrKeyCanonicalization.ts
src/main/ocr/ocrReturnedKeysRegistryService.ts
```

Do not delete files if they are referenced elsewhere and deletion would break the app. Instead, refactor or bypass the canonicalization path for this workflow.

The new registry is exact-key discovery only.

## 7. OCR Returned Keys Registry

Create this file at the beginning of the OCR discovery process:

```text
workspace/ocr_returned_keys.json
```

This file stores only exact keys that have at least one non-empty/non-null value.

Recommended schema:

```json
{
  "keys": [
    {
      "key": "sale_price",
      "first_value": "15.99",
      "first_seen_in_file": "manual-crops/page-036/othaim-offers_036_014.json",
      "value_type": "string"
    },
    {
      "key": "pack_quantity",
      "first_value": 3,
      "first_seen_in_file": "manual-crops/page-010/othaim-offers_010_002.json",
      "value_type": "number"
    }
  ]
}
```

Rules:

```text
Exact duplicate keys are not repeated.
Do not group aliases.
Do not create canonical_key.
Do not create aliases_seen.
Do not normalize key names.
Do not treat sale_price and offer_price as the same key.
Do not treat old_price and original_price as the same key.
Store exactly the key name returned by the OCR item JSON.
```

If Mistral returns both:

```text
sale_price
offer_price
```

then both should appear as separate entries in `ocr_returned_keys.json`, as long as each has a non-empty/non-null value.

## 8. Keys Without Values File

Create a second file:

```text
workspace/ocr_keys_without_values.json
```

This file stores exact keys that appeared during OCR, but never had a useful non-empty/non-null value.

Recommended schema:

```json
{
  "keys": [
    {
      "key": "promotion_note",
      "first_seen_in_file": "manual-crops/page-036/othaim-offers_036_014.json",
      "empty_values_seen": 3
    }
  ]
}
```

Rules:

```text
A key should only appear here if it was seen but never had a useful value.
A key must not exist in both ocr_returned_keys.json and ocr_keys_without_values.json.
If a key first appears empty/null and later appears with a useful value, move it to ocr_returned_keys.json and remove it from ocr_keys_without_values.json.
```

## 9. What Counts as Empty or No Value

Treat these values as empty/no value for the key registry:

```text
null
undefined
empty string
string with only whitespace
empty array []
empty object {}
```

Also treat these common text placeholders as empty:

```text
"N/A"
"n/a"
"NA"
"na"
"none"
"None"
"NONE"
"null"
"Null"
"NULL"
"unknown"
"Unknown"
"UNKNOWN"
"not visible"
"not available"
"not shown"
"غير متوفر"
"غير واضح"
"غير مذكور"
```

Do not remove these values from the per-item JSON file if Mistral returned them.

This empty-value logic only affects whether the key goes into:

```text
ocr_returned_keys.json
```

or:

```text
ocr_keys_without_values.json
```

## 10. Registry Update Algorithm

After saving each item JSON, scan its top-level keys.

For each exact key/value pair:

```text
1. If value is non-empty/non-null:
   - if key is not already in ocr_returned_keys.json:
     add key with first_value, first_seen_in_file, and value_type.
   - if key already exists in ocr_returned_keys.json:
     do nothing.
   - if key exists in ocr_keys_without_values.json:
     remove it from ocr_keys_without_values.json.

2. If value is empty/null:
   - if key already exists in ocr_returned_keys.json:
     do nothing.
   - if key does not exist in ocr_returned_keys.json:
     add/update it in ocr_keys_without_values.json.
     increment empty_values_seen.
```

Final invariant:

```text
ocr_returned_keys.json contains only keys with at least one useful example value.
ocr_keys_without_values.json contains only keys that appeared but never had a useful value.
No exact key appears in both files.
No exact key is repeated inside either file.
```

## 11. Nested JSON Handling

If Mistral returns nested objects, preserve them exactly in the item JSON.

For the key registry, track top-level keys by default.

Example item JSON:

```json
{
  "product": {
    "name_en": "Corn Flakes",
    "size": "500g"
  },
  "price": {
    "sale": "15.99",
    "old": "23.50"
  }
}
```

The saved item JSON remains exactly as returned.

The registry should store:

```json
{
  "keys": [
    {
      "key": "product",
      "first_value": {
        "name_en": "Corn Flakes",
        "size": "500g"
      },
      "first_seen_in_file": "manual-crops/page-036/othaim-offers_036_014.json",
      "value_type": "object"
    },
    {
      "key": "price",
      "first_value": {
        "sale": "15.99",
        "old": "23.50"
      },
      "first_seen_in_file": "manual-crops/page-036/othaim-offers_036_014.json",
      "value_type": "object"
    }
  ]
}
```

Do not flatten nested keys in this chunk unless the existing app already does so and changing it would be disruptive.

The goal is exact-key discovery from returned JSON.

## 12. Registry Writer Must Be Single and Atomic

Because OCR runs concurrently with cropping, multiple OCR completions may happen while page crops continue.

Implement a single safe registry writer.

Recommended file:

```text
src/main/ocr/ocrReturnedKeysDiscoveryService.ts
```

or adapt the existing registry service.

Rules:

```text
Only one registry update can write at a time.
Load current ocr_returned_keys.json and ocr_keys_without_values.json.
Apply exact-key update rules.
Write to temporary files first.
Rename temporary files atomically.
Do not corrupt registry files if the app closes or one OCR job fails.
```

Atomic write pattern:

```text
write ocr_returned_keys.json.tmp
rename to ocr_returned_keys.json

write ocr_keys_without_values.json.tmp
rename to ocr_keys_without_values.json
```

## 13. Registry Initialization

At the beginning of the flexible OCR discovery process:

```text
1. Ensure workspace exists.
2. Ensure ocr_returned_keys.json exists.
3. Ensure ocr_keys_without_values.json exists.
4. If either file exists, load it and continue.
5. If either file is missing, create it with an empty keys array.
```

Initial files:

```json
{
  "keys": []
}
```

Do not seed canonical keys or aliases.

Do not seed known mappings.

This is discovery, not classification.

## 14. Registry Validation

Validate both registry files.

For `ocr_returned_keys.json`:

```text
top-level object has keys array
each entry has key string
each entry has first_value
each entry has first_seen_in_file string
each entry has value_type string
no duplicate exact keys
no empty-value entries
```

For `ocr_keys_without_values.json`:

```text
top-level object has keys array
each entry has key string
each entry has first_seen_in_file string
each entry has empty_values_seen number
no duplicate exact keys
no key appears in ocr_returned_keys.json
```

If validation fails, repair safely where possible. If repair is not safe, log a clear error and continue processing item JSON files, but do not write corrupt registry output.

## 15. OCR Discovery Summary Metadata

Create or update a separate metadata file:

```text
workspace/flexible-item-ocr-summary.json
```

Recommended shape:

```json
{
  "total_images": 0,
  "ocr_completed": 0,
  "ocr_failed": 0,
  "json_files_written": 0,
  "returned_keys_registry_path": "workspace/ocr_returned_keys.json",
  "keys_without_values_path": "workspace/ocr_keys_without_values.json",
  "items": [
    {
      "image_path": "workspace/manual-crops/page-036/othaim-offers_036_014.webp",
      "json_path": "workspace/manual-crops/page-036/othaim-offers_036_014.json",
      "status": "completed",
      "keys_returned": ["sale_price", "old_price", "english_name", "pack_size"],
      "new_keys_with_values_added": ["sale_price", "old_price"],
      "new_keys_without_values_added": [],
      "error": null
    }
  ]
}
```

This metadata may include paths, OCR status, and key discovery changes.

Do not put this metadata inside per-item JSON.

## 16. Progress Events

Emit progress events to the renderer.

Stages:

```text
flexible_item_ocr_queued
flexible_item_ocr_started
flexible_item_ocr_waiting_rate_limit
flexible_item_ocr_completed
flexible_item_ocr_failed
flexible_item_json_written
ocr_returned_keys_updated
ocr_keys_without_values_updated
```

Each event should include:

```ts
{
  stage: string;
  message: string;
  imagePath?: string;
  jsonPath?: string;
  queuePending?: number;
  completed?: number;
  failed?: number;
  waitMs?: number;
  keysReturned?: string[];
}
```

Do not log API keys.

## 17. Integration With Background Cropping

Keep the behavior from the previous plan:

```text
As each crop image is generated, enqueue that image path for flexible item OCR discovery.
Do not wait for the whole page to finish cropping.
Do not wait for all pages.
Start OCR discovery after the first image is generated.
Cropping and OCR run concurrently.
OCR API calls are still sequential and rate-limit-safe.
```

Do not change the crop image filename behavior:

```text
{pdf_base_name}_{PPP}_{BBB}.webp
```

Each JSON file should use the same base name:

```text
{pdf_base_name}_{PPP}_{BBB}.json
```

## 18. Handling Regenerated/Stale Crops

If a page layout changes and crops are regenerated:

```text
1. Existing item OCR JSON files for that page are stale.
2. New crop images are enqueued for OCR again.
3. Same-name JSON files are overwritten with the latest raw OCR response.
4. ocr_returned_keys.json and ocr_keys_without_values.json are updated based on new OCR results.
```

Important:

```text
Do not remove keys from ocr_returned_keys.json just because one stale file changed.
```

The key registry is a discovery artifact for the whole process. It records keys seen during the run.

If old crop files and JSON files are deleted because box count changed, the registry does not need to forget historical keys from earlier in the same run unless implementing a full registry rebuild is easy and safe.

Preferred simple behavior:

```text
Registry only grows during a run.
Stale files are overwritten/deleted, but discovered keys remain.
```

Document this behavior.

## 19. Optional End-of-Run Registry Rebuild

If easy and safe, add an optional utility:

```text
Rebuild OCR Key Registry From Item JSON Files
```

This utility should:

```text
scan all current item JSON files
rebuild ocr_returned_keys.json
rebuild ocr_keys_without_values.json
```

This would remove keys from stale/deleted files.

Do not block this chunk on this optional utility.

## 20. UI Requirements

Update the UI to show flexible OCR discovery progress.

Examples:

```text
Flexible item OCR: 8 completed, 2 failed, 14 pending
Latest JSON: othaim-weekly-offers_036_014.json
Returned keys with values: 18
Keys without values: 3
```

In review tables, show:

```text
local image path
local raw JSON path
OCR status
keys returned
whether new registry keys were added
```

Do not show alias/canonical grouping, because that no longer happens here.

## 21. Later LLM Alias Grouping Is Out of Scope

Do not implement the LLM alias grouping step in this chunk unless it already exists and only needs wiring.

For now, just prepare the data:

```text
ocr_returned_keys.json
ocr_keys_without_values.json
```

Later, the operator will send `ocr_returned_keys.json` to an LLM to group aliases and propose canonical keys.

Documentation should explain this future step.

## 22. Relationship to DB Sync

This raw flexible item OCR discovery is not the final DB sync schema.

Do not write these raw flexible JSON files directly to Wifran DB in this chunk.

Do not change DB schema in this chunk.

Do not upload images in this chunk unless an existing later operator-approved sync step already does so.

For now:

```text
Raw flexible OCR discovery = local learning/review artifact.
DB sync = remains controlled by existing review/sync flow.
```

## 23. Error Handling

Handle:

```text
image file missing
Mistral request failure
Mistral invalid JSON
Mistral returns array instead of object
JSON write failure
registry read failure
registry validation failure
registry write failure
rate limit
timeout
empty/no-value keys
stale regenerated crops
```

Use clear error codes:

```text
RAW_ITEM_OCR_IMAGE_MISSING
RAW_ITEM_OCR_REQUEST_FAILED
RAW_ITEM_OCR_INVALID_JSON
RAW_ITEM_OCR_NON_OBJECT_JSON
RAW_ITEM_OCR_JSON_WRITE_FAILED
RAW_ITEM_OCR_REGISTRY_READ_FAILED
RAW_ITEM_OCR_REGISTRY_INVALID
RAW_ITEM_OCR_REGISTRY_WRITE_FAILED
RAW_ITEM_OCR_RATE_LIMITED
RAW_ITEM_OCR_TIMEOUT
RAW_ITEM_OCR_KEYS_WITHOUT_VALUES_WRITE_FAILED
```

Continue processing other images if one fails.

## 24. Tests / Smoke Checks

Add tests or smoke checks for:

```text
item image enqueue starts after first crop image is generated
OCR queue processes images sequentially
OCR delay is at least OCR_ITEM_MIN_REQUEST_INTERVAL_MS
item JSON is written next to the image
item JSON filename matches image base filename with .json extension
item JSON preserves returned key names exactly
item JSON does not canonicalize sale_price to offer_price
item JSON does not canonicalize old_price to original_price
item JSON does not canonicalize english_name to product_name_en
ocr_returned_keys.json is created with empty keys array at process start
ocr_keys_without_values.json is created with empty keys array at process start
non-empty key is added to ocr_returned_keys.json with first_value
duplicate exact key is not repeated
second non-empty value for existing key does not replace first_value
empty/null key is added to ocr_keys_without_values.json if no useful value exists yet
key moves from ocr_keys_without_values.json to ocr_returned_keys.json when later useful value appears
key does not exist in both registry files
empty/no-value placeholders are handled
registry writes are atomic
raw item JSON does not include app metadata
summary file includes json paths and returned keys
stale regenerated crop overwrites same-name JSON
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If any script does not exist, document it clearly and do not invent success.

## 25. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
Raw flexible item OCR starts after crop images are generated.
Each crop image gets a same-name JSON file.
The JSON file preserves the OCR API returned keys exactly.
The app does not classify aliases at this stage.
The app does not canonicalize keys at this stage.
ocr_returned_keys.json stores exact keys with their first useful value.
ocr_keys_without_values.json stores keys that appeared but never had useful values.
The key registry files are local learning artifacts.
After processing leaflets, ocr_returned_keys.json can be sent to an LLM to group aliases and propose canonical keys.
```

Add example:

```text
Image:
othaim-weekly-offers_036_014.webp

Mistral returns:
{
  "sale_price": "15.99",
  "old_price": "22.50",
  "english_name": "Kellogg's Corn Flakes",
  "pack_size": "500g"
}

Saved item JSON:
othaim-weekly-offers_036_014.json

{
  "sale_price": "15.99",
  "old_price": "22.50",
  "english_name": "Kellogg's Corn Flakes",
  "pack_size": "500g"
}

ocr_returned_keys.json:
{
  "keys": [
    {
      "key": "sale_price",
      "first_value": "15.99",
      "first_seen_in_file": "manual-crops/page-036/othaim-weekly-offers_036_014.json",
      "value_type": "string"
    },
    {
      "key": "old_price",
      "first_value": "22.50",
      "first_seen_in_file": "manual-crops/page-036/othaim-weekly-offers_036_014.json",
      "value_type": "string"
    }
  ]
}
```

Add example for empty keys:

```text
If Mistral returns:
{
  "promotion_note": null
}

and promotion_note never appears later with a useful value, then it goes to:

ocr_keys_without_values.json

{
  "keys": [
    {
      "key": "promotion_note",
      "first_seen_in_file": "manual-crops/page-036/othaim-weekly-offers_036_014.json",
      "empty_values_seen": 1
    }
  ]
}
```

## 26. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose raw `ipcRenderer`.
* Do not expose generic filesystem IPC.
* Do not log API keys.
* Do not write to Wifran DB in this chunk.
* Do not publish offers in this chunk.
* Do not upload images in this chunk unless an existing later operator-approved sync step does so.
* Only write item OCR JSON and registry files inside the import workspace.

## 27. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 28. Acceptance Criteria

This chunk is complete when:

* Flexible item OCR discovery saves item JSON exactly as returned by the API.
* Item JSON keys are not renamed.
* Item JSON keys are not canonicalized.
* Aliases are not classified.
* No canonical_key or aliases_seen registry is used in this workflow.
* `ocr_returned_keys.json` is created at process start.
* `ocr_keys_without_values.json` is created at process start.
* `ocr_returned_keys.json` stores exact keys with first useful values.
* Exact duplicate keys are not repeated in `ocr_returned_keys.json`.
* The first useful value for a key is preserved and not overwritten by later values.
* Keys with only empty/null values go to `ocr_keys_without_values.json`.
* A key moves from `ocr_keys_without_values.json` to `ocr_returned_keys.json` if a useful value appears later.
* No key appears in both registry files.
* Registry writes are single-writer and atomic.
* UI/review summary shows raw JSON paths and returned key counts.
* No DB writes occur in this chunk.
* Documentation is updated.
* TypeScript compiles.
* App still starts.

## 29. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How raw flexible item OCR works.
* How item image paths map to JSON paths.
* Confirmation that item JSON keys are preserved exactly.
* How `ocr_returned_keys.json` works.
* How `ocr_keys_without_values.json` works.
* What counts as empty/no value.
* How key movement from no-value file to returned-keys file works.
* How concurrent OCR updates are protected.
* How to test the feature.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.