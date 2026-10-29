# Antigravity Prompt Chunk 34: Flexible Item OCR Discovery With Canonical Key Registry

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 34. Prompt Chunks 28 to 33 should already have implemented the manual crop editor, streaming page rendering, next-page layout carryover, right-click grid/row/column generation, delete box, background page cropping on navigation, and improved Generate Grid defaults.

This chunk adds a new flexible item OCR discovery process that starts as soon as item crop images are generated.

The goal is to let Mistral OCR read each cropped item image and return a minimal flexible JSON object containing only data visible in that crop image. The app must then canonicalize all keys before saving the item JSON file, and maintain a global registry of all canonical keys and aliases seen.

## 1. Read These Files First

Before coding, read files similar to:

```text
src/shared/types/manualCrop.ts
src/shared/types/reviewWorkflow.ts
src/shared/types/itemOcr.ts
src/shared/schemas/itemOcrSchema.ts
src/main/image/manualCropService.ts
src/main/workflow/backgroundPageCropQueue.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/ocrRateLimitQueue.ts
src/main/ocr/itemImageOcrService.ts
src/main/ocr/itemImageOcrPromptBuilder.ts
src/main/ipc/manualCropIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/components/review/PreDbReviewSummary.tsx
src/renderer/components/review/ReviewItemTable.tsx
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Adapt paths if the current project structure differs.

## 2. Main Goal

Implement flexible item OCR discovery that works like this:

```text
1. Background page cropping generates an item image.
2. As soon as the first item image is generated, start a concurrent OCR discovery process.
3. OCR discovery sends each item image to Mistral OCR API.
4. Mistral returns a minimal flexible JSON object with visible item data only.
5. The app normalizes and canonicalizes all JSON keys.
6. The app saves the canonicalized item JSON next to the image using the same base filename and `.json` extension.
7. The app updates a global `ocr_returned_keys.json` registry with all canonical keys and aliases seen across all items/pages.
```

This process must run concurrently with ongoing page cropping and manual editing, but OCR API calls must remain sequential and rate-limit-safe.

## 3. Important Output Rule

Each cropped item image should produce one JSON file.

Example image:

```text
workspace/manual-crops/page-036/othaim-offers_036_014.webp
```

Expected JSON file:

```text
workspace/manual-crops/page-036/othaim-offers_036_014.json
```

The item JSON must contain only canonicalized key/value pairs extracted from the crop image.

It must not contain metadata.

Do not include:

```text
supermarket name
PDF filename
page number
box number
image path
leaflet dates
city
region
coverage
crop coordinates
OCR status
model name
confidence
warnings
errors
API metadata
import batch id
DB ids
```

Those fields may exist in separate review/workflow metadata, but not in the item JSON file.

## 4. Flexible Item JSON

The per-item OCR JSON is flexible and sparse.

Do not force the old strict schema.

Do not require fixed keys like `name_ar`, `name_en`, `offer_price`, etc.

Mistral may return any useful field that is visibly present in the item image.

Examples of allowed saved item JSON:

```json
{
  "product_name_en": "Kellogg's Corn Flakes",
  "offer_price": "15.99",
  "original_price": "23.50",
  "size": "500g"
}
```

```json
{
  "product_name_ar": "ماء نوفا",
  "product_name_en": "Nova Water",
  "offer_price": "0.99",
  "size": "330ml",
  "pack_quantity": "1"
}
```

```json
{
  "product_name_en": "Puck Cooking Cream",
  "offer_price": "9.99",
  "size": "500ml",
  "special_offer": "1+1"
}
```

Do not save empty/null fields in this flexible discovery JSON.

If a key has no visible value, omit it.

## 5. Mistral Prompt

Create or update a prompt builder for flexible item OCR discovery.

Recommended file:

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

Use clear snake_case keys.

Prefer these key names when applicable:
- product_name_ar
- product_name_en
- description_ar
- description_en
- offer_price
- original_price
- currency
- size
- unit
- pack_quantity
- bundle_quantity
- special_offer
- price_condition
- flavor
- variant
- country_of_origin
- storage_condition

If the image contains another useful visible product/offer attribute, include it using a concise snake_case key.

Do not invent values.

Return valid JSON object only.
```

## 6. OCR API Model and Rate Limits

Use the configured Mistral OCR model.

Default should remain:

```env
MISTRAL_OCR_MODEL=mistral-ocr-2512
```

Use one OCR request at a time.

Use a minimum delay between item OCR calls:

```env
OCR_ITEM_MIN_REQUEST_INTERVAL_MS=1100
OCR_ITEM_MAX_CONCURRENT_REQUESTS=1
OCR_ITEM_MAX_RETRIES=5
OCR_ITEM_REQUEST_TIMEOUT_MS=120000
```

Rules:

```text
Do not run concurrent Mistral OCR calls.
Respect 429 Retry-After headers.
Continue if one item OCR fails.
Do not block manual page editing while OCR runs.
```

## 7. OCR Discovery Queue

Create or update a background OCR discovery queue.

Recommended file:

```text
src/main/workflow/flexibleItemOcrDiscoveryQueue.ts
```

Behavior:

```text
1. As each crop image is generated, enqueue it for flexible OCR discovery.
2. Start OCR processing as soon as the first image is available.
3. Process OCR jobs sequentially.
4. Wait at least OCR_ITEM_MIN_REQUEST_INTERVAL_MS between OCR calls.
5. Save each canonicalized JSON file next to the image.
6. Update the global key registry through a single safe registry writer.
7. Emit progress events.
8. Continue if an item fails.
```

The queue must deduplicate jobs by local image path.

If an image is regenerated because page crops became stale, the OCR result for that image should be considered stale too and regenerated.

## 8. Item OCR Output Filename

For each item image:

```text
{pdf_base_name}_{PPP}_{BBB}.webp
```

write:

```text
{pdf_base_name}_{PPP}_{BBB}.json
```

in the same folder.

Examples:

```text
othaim-weekly-offers_001_001.webp
othaim-weekly-offers_001_001.json

othaim-weekly-offers_036_014.webp
othaim-weekly-offers_036_014.json
```

If the image is overwritten/regenerated, regenerate the JSON file too.

## 9. Global Key Registry File

At the beginning of the crop/OCR process, create this file in the import workspace:

```text
workspace/ocr_returned_keys.json
```

Use this registry structure:

```json
{
  "keys": [
    {
      "canonical_key": "offer_price",
      "aliases_seen": ["sale_price", "current_price", "promo_price", "price"]
    },
    {
      "canonical_key": "original_price",
      "aliases_seen": ["old_price", "was_price", "before_price"]
    },
    {
      "canonical_key": "product_name_en",
      "aliases_seen": ["english_name", "name_en", "product_en"]
    }
  ]
}
```

The registry must contain one entry per canonical key.

No duplicate canonical keys.

No duplicate aliases.

Aliases must not appear as separate canonical keys if they are already mapped to an existing canonical key.

## 10. Initial Canonical Key Registry

Seed the registry with known useful canonical keys and aliases.

Recommended initial registry:

```json
{
  "keys": [
    {
      "canonical_key": "product_name_ar",
      "aliases_seen": ["name_ar", "arabic_name", "product_ar", "arabic_product_name"]
    },
    {
      "canonical_key": "product_name_en",
      "aliases_seen": ["name_en", "english_name", "product_en", "english_product_name"]
    },
    {
      "canonical_key": "description_ar",
      "aliases_seen": ["arabic_description", "desc_ar"]
    },
    {
      "canonical_key": "description_en",
      "aliases_seen": ["english_description", "desc_en"]
    },
    {
      "canonical_key": "offer_price",
      "aliases_seen": ["price", "sale_price", "current_price", "promo_price", "promotion_price", "discounted_price"]
    },
    {
      "canonical_key": "original_price",
      "aliases_seen": ["old_price", "was_price", "before_price", "regular_price", "previous_price"]
    },
    {
      "canonical_key": "currency",
      "aliases_seen": ["currency_code"]
    },
    {
      "canonical_key": "size",
      "aliases_seen": ["pack_size", "package_size", "net_weight", "weight", "volume"]
    },
    {
      "canonical_key": "unit",
      "aliases_seen": ["measurement_unit"]
    },
    {
      "canonical_key": "pack_quantity",
      "aliases_seen": ["quantity", "qty", "pieces", "piece_count", "unit_count", "count"]
    },
    {
      "canonical_key": "bundle_quantity",
      "aliases_seen": ["bundle_count", "multi_buy_quantity", "total_bundle_quantity"]
    },
    {
      "canonical_key": "special_offer",
      "aliases_seen": ["promotion", "promo", "offer_condition", "deal", "deal_text", "buy_get", "bundle_deal"]
    },
    {
      "canonical_key": "price_condition",
      "aliases_seen": ["per_unit_condition", "price_unit", "per_pack", "per_kg", "per_box"]
    },
    {
      "canonical_key": "flavor",
      "aliases_seen": ["flavour", "taste"]
    },
    {
      "canonical_key": "variant",
      "aliases_seen": ["product_variant"]
    },
    {
      "canonical_key": "country_of_origin",
      "aliases_seen": ["origin", "made_in"]
    },
    {
      "canonical_key": "storage_condition",
      "aliases_seen": ["storage", "keep_condition"]
    }
  ]
}
```

If an existing `ocr_returned_keys.json` already exists, load it and merge with these seed entries without losing existing aliases.

## 11. Canonicalization Is Mandatory Before Saving Item JSON

This is the most important rule.

The saved per-item JSON files must never contain alias keys when those aliases map to a canonical key.

Flow:

```text
Mistral returns flexible JSON
→ normalize all keys to snake_case
→ map alias keys to canonical keys using ocr_returned_keys.json
→ resolve collisions
→ save canonicalized item JSON
→ update ocr_returned_keys.json
```

Example Mistral response:

```json
{
  "sale_price": "15.99",
  "old_price": "22.50",
  "english_name": "Kellogg's Corn Flakes",
  "pack_size": "500g"
}
```

Saved item JSON must be:

```json
{
  "offer_price": "15.99",
  "original_price": "22.50",
  "product_name_en": "Kellogg's Corn Flakes",
  "size": "500g"
}
```

Do not save:

```json
{
  "sale_price": "15.99"
}
```

if `sale_price` maps to `offer_price`.

## 12. Key Normalization

Before alias matching, normalize all returned keys.

Create or update:

```text
src/shared/utils/ocrKeyCanonicalization.ts
```

Implement functions similar to:

```ts
export function normalizeOcrKey(key: string): string;

export function canonicalizeOcrObjectKeys(input: {
  rawObject: Record<string, unknown>;
  registry: OcrReturnedKeysRegistry;
}): {
  canonicalObject: Record<string, unknown>;
  aliasesUsed: Array<{
    alias: string;
    canonicalKey: string;
  }>;
  newCanonicalKeys: string[];
  collisions: Array<{
    canonicalKey: string;
    keptValue: unknown;
    discardedValues: unknown[];
    sourceKeys: string[];
  }>;
};
```

Key normalization rules:

```text
trim spaces
convert camelCase to snake_case
convert kebab-case to snake_case
convert spaces to underscores
lowercase English keys
remove duplicate underscores
remove leading/trailing underscores
```

Examples:

```text
Sale Price → sale_price
salePrice → sale_price
sale-price → sale_price
sale price → sale_price
Current Price → current_price
```

Then alias matching maps:

```text
sale_price → offer_price
old_price → original_price
english_name → product_name_en
```

## 13. Collision Handling

If Mistral returns both a canonical key and alias key for the same meaning:

```json
{
  "offer_price": "15.99",
  "sale_price": "15.99"
}
```

Save only:

```json
{
  "offer_price": "15.99"
}
```

If values conflict:

```json
{
  "offer_price": "15.99",
  "sale_price": "16.99"
}
```

Keep the value from the direct canonical key if present.

Save:

```json
{
  "offer_price": "15.99"
}
```

Record the conflict outside the item JSON in workflow/review metadata or log.

Do not add warnings/errors inside the item JSON.

If no direct canonical key exists and multiple aliases map to the same canonical key, keep the first non-empty value and record the collision outside the item JSON.

## 14. Unknown New Keys

If Mistral returns a key that does not match any existing canonical key or alias:

```json
{
  "storage_condition": "Keep Frozen"
}
```

Then:

```text
1. Normalize it to snake_case.
2. Add it to the registry as a new canonical_key.
3. Save it in the item JSON using that normalized key.
```

Registry entry:

```json
{
  "canonical_key": "storage_condition",
  "aliases_seen": []
}
```

If later Mistral returns a synonym such as:

```text
storage
```

and the registry says `storage` is an alias of `storage_condition`, the saved item JSON must use:

```text
storage_condition
```

## 15. Same-Meaning Alias Deduplication

The app should prevent same-meaning duplicate keys in the registry.

At minimum, use the seeded alias list and any existing registry aliases.

If Mistral returns a key that is already listed as an alias of an existing canonical key, do not add it as a new canonical key.

Example:

```text
Mistral returns current_price
Registry has current_price as alias of offer_price
Saved item JSON uses offer_price
Registry remains one canonical offer_price entry
```

If Mistral returns a genuinely new key and the app cannot confidently map it to an existing canonical key, add it as a new canonical key.

Do not attempt unsafe semantic guessing beyond known aliases unless the code implements a clearly auditable mapping.

## 16. Registry Writer Must Be Single and Atomic

Because item OCR jobs run while cropping continues, multiple item OCR completions may try to update the registry.

Implement a single safe registry writer.

Recommended file:

```text
src/main/ocr/ocrReturnedKeysRegistryService.ts
```

Rules:

```text
Only one registry write at a time.
Load current registry.
Merge new canonical keys and aliases.
Remove duplicate aliases.
Ensure no alias exists as its own canonical key if it maps to another canonical key.
Write to temporary file first.
Rename temp file to ocr_returned_keys.json atomically.
```

Example atomic write:

```text
write ocr_returned_keys.json.tmp
rename to ocr_returned_keys.json
```

Do not let parallel writes corrupt the file.

## 17. Registry Validation

Create validation for `ocr_returned_keys.json`.

Rules:

```text
top-level object has keys array
each entry has canonical_key string
aliases_seen is array of strings
canonical_key values are unique
aliases_seen values are unique within an entry
aliases_seen values are normalized snake_case
canonical_key values are normalized snake_case
an alias must not appear as a canonical_key in another entry
```

If registry is invalid, repair if safe, otherwise recreate from seed registry and log a warning.

## 18. OCR Discovery Metadata

Keep metadata outside item JSON.

For review/debugging, maintain a separate metadata file such as:

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
  "keys_registry_path": "workspace/ocr_returned_keys.json",
  "items": [
    {
      "image_path": "workspace/manual-crops/page-036/othaim-offers_036_014.webp",
      "json_path": "workspace/manual-crops/page-036/othaim-offers_036_014.json",
      "status": "completed",
      "aliases_used": [
        {
          "alias": "sale_price",
          "canonical_key": "offer_price"
        }
      ],
      "new_keys_added": ["storage_condition"],
      "collisions": []
    }
  ]
}
```

This metadata may include image paths, status, aliases, and collisions.

Do not put this metadata inside per-item JSON.

## 19. Progress Events

Emit progress events to the renderer.

Stages:

```text
flexible_item_ocr_queued
flexible_item_ocr_started
flexible_item_ocr_waiting_rate_limit
flexible_item_ocr_completed
flexible_item_ocr_failed
flexible_item_json_written
flexible_item_keys_registry_updated
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
}
```

Do not log API keys.

## 20. Integration With Background Cropping

Update background page cropping from Chunk 32.

As each crop image is successfully generated:

```text
enqueue that image path for flexible item OCR discovery
```

Do not wait for the whole page to finish cropping.

Do not wait for all pages.

Start OCR discovery after the first image is generated.

Cropping and OCR should run concurrently, but OCR calls must be sequential.

## 21. Handling Regenerated/Stale Crops

If a page layout changes and crops are regenerated:

```text
1. Mark existing item OCR JSON files for that page as stale.
2. When new crop images are written, enqueue them for OCR again.
3. Overwrite the JSON files with newly canonicalized OCR results.
4. Update the registry with any new keys/aliases.
```

If old crop files are deleted because the box count changed, delete or ignore old JSON files that correspond to removed crop files.

Keep crop/image/JSON folders aligned.

## 22. UI Requirements

Update the UI to show flexible item OCR discovery progress.

Examples:

```text
Flexible item OCR: 8 completed, 2 failed, 14 pending
Latest JSON: othaim-weekly-offers_036_014.json
Keys discovered: 18
```

In review tables, show:

```text
local image path
local JSON path
OCR status
canonical JSON fields
aliases replaced
new keys added
collisions if any
```

The operator should be able to open or locate the JSON file path for review if existing app patterns support that.

## 23. Relationship to DB Sync

This flexible discovery process is not the final DB sync schema.

Do not write these flexible JSON files directly to Wifran DB in this chunk.

Do not change DB schema in this chunk.

Do not upload images in this chunk unless an existing later operator-approved sync step does so.

For now:

```text
Flexible item OCR discovery = local learning/review artifact
DB sync = remains controlled by the existing review/sync flow
```

Later, Wifran can use the discovered keys to improve mapping and data richness.

## 24. Error Handling

Handle:

```text
image file missing
Mistral request failure
Mistral invalid JSON
Mistral returns array instead of object
Mistral returns metadata keys
JSON write failure
registry read failure
registry validation failure
registry write failure
key collision
duplicate canonical key
alias conflicts
rate limit
timeout
```

Use clear error codes:

```text
FLEX_ITEM_OCR_IMAGE_MISSING
FLEX_ITEM_OCR_REQUEST_FAILED
FLEX_ITEM_OCR_INVALID_JSON
FLEX_ITEM_OCR_NON_OBJECT_JSON
FLEX_ITEM_OCR_JSON_WRITE_FAILED
FLEX_ITEM_OCR_REGISTRY_READ_FAILED
FLEX_ITEM_OCR_REGISTRY_INVALID
FLEX_ITEM_OCR_REGISTRY_WRITE_FAILED
FLEX_ITEM_OCR_KEY_COLLISION
FLEX_ITEM_OCR_RATE_LIMITED
FLEX_ITEM_OCR_TIMEOUT
```

Continue processing other images if one fails.

## 25. Tests / Smoke Checks

Add tests or smoke checks for:

```text
item image enqueue starts after first crop image is generated
OCR queue processes images sequentially
OCR delay is at least OCR_ITEM_MIN_REQUEST_INTERVAL_MS
item JSON is written next to the image
item JSON filename matches image base filename with .json extension
item JSON excludes metadata keys
item JSON omits null/empty fields
key normalization converts Sale Price / salePrice / sale-price / sale price to sale_price
alias sale_price maps to canonical offer_price
alias old_price maps to canonical original_price
alias english_name maps to canonical product_name_en
saved item JSON contains canonical keys only
saved item JSON never keeps known alias keys
unknown keys are added as new canonical keys
registry has no duplicate canonical keys
registry has no duplicate aliases
alias is not also saved as a separate canonical key
collision keeps direct canonical value when present
collisions are recorded outside item JSON
registry writes are atomic
stale regenerated crop causes JSON regeneration
old JSON files for removed crop files are removed or ignored
review summary shows image path and JSON path
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If any script does not exist, document it clearly and do not invent success.

## 26. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
Flexible item OCR discovery starts after crop images are generated.
Each crop image gets a same-name JSON file.
The JSON file contains only visible item key/value data.
Metadata is not included in item JSON.
ocr_returned_keys.json records canonical keys and aliases seen.
Known aliases are replaced with canonical keys before saving item JSON.
The registry prevents repeated same-meaning keys.
Flexible OCR discovery is local and does not write to DB.
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

Saved JSON:
othaim-weekly-offers_036_014.json

{
  "offer_price": "15.99",
  "original_price": "22.50",
  "product_name_en": "Kellogg's Corn Flakes",
  "size": "500g"
}

ocr_returned_keys.json records:
sale_price as alias of offer_price
old_price as alias of original_price
english_name as alias of product_name_en
pack_size as alias of size
```

## 27. Security Rules

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

## 28. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 29. Acceptance Criteria

This chunk is complete when:

* Flexible item OCR discovery queue exists.
* OCR discovery starts after the first crop image is generated.
* Cropping and OCR discovery can run concurrently.
* OCR calls are sequential and rate-limit-safe.
* Each crop image gets a same-base-name `.json` file.
* Per-item JSON files contain only visible extracted key/value data.
* Per-item JSON files do not contain metadata.
* Per-item JSON files omit null/empty keys.
* `ocr_returned_keys.json` is created at process start.
* `ocr_returned_keys.json` stores canonical keys and aliases_seen.
* Known aliases are replaced by canonical keys before saving item JSON.
* Saved item JSON files never contain known alias keys.
* Unknown keys become new canonical keys.
* Duplicate same-meaning keys are not repeated in the registry.
* Key collisions are handled and recorded outside item JSON.
* Registry writes are single-writer and atomic.
* Stale/regenerated crop images trigger OCR JSON regeneration.
* Review UI shows image path, JSON path, OCR status, aliases used, and new keys added.
* No DB writes occur in this chunk.
* Documentation is updated.
* TypeScript compiles.
* App still starts.

## 30. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How flexible item OCR discovery starts.
* How crop images map to JSON files.
* How the Mistral prompt works.
* How keys are normalized.
* How aliases are replaced with canonical keys.
* How `ocr_returned_keys.json` works.
* How registry writes are protected from concurrency issues.
* How stale/regenerated crops are handled.
* How to test the feature.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.