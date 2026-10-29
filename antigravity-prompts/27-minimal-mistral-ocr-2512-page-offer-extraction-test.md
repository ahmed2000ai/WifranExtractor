# Antigravity Prompt Chunk 27: Minimal Mistral OCR 2512 Page Offer Extraction Test

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 27. Prompt Chunks 01 to 26 should already have implemented the full extraction app, Wifran DB/storage alignment, direct publish mode, free-tier-safe Mistral queue, retry failed chunks, and Othaim price-block fixes.

This chunk is a focused diagnostic test.

The goal is to test the raw Mistral OCR extraction quality using a minimal strict JSON schema, without image cropping, bounding boxes, DB writes, entity matching, offer preparation, or final sync.

## 1. Read These Files First

Before coding, read:

```text
src/main/config/env.ts
src/main/config/configStatus.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/ocrPromptBuilder.ts
src/main/ocr/ocrPipelineService.ts
src/main/ocr/ocrRetry.ts
src/main/ocr/ocrRateLimitQueue.ts
src/shared/types/ocrJob.ts
src/shared/types/ocr.ts
src/shared/schemas/ocrSchema.ts
src/shared/utils/ocrNormalization.ts
src/shared/utils/priceParsing.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Also read these latest Wifran-side references if they exist:

```text
project-knowledge/wifran_docs/external-offer-ingestion-tool.md
project-knowledge/wifran_docs/offer-images-bucket.md
project-knowledge/wifran_docs/production-env-verification.md
```

Also inspect the operator-provided test JSON if present:

```text
ocr-result-page-1.json
```

The current result contains too much data for this diagnostic test. The new test output must be much smaller and must follow the strict schema in this prompt.

## 2. Main Goal

Create a minimal Mistral OCR extraction test mode that:

```text
uses mistral-ocr-2512
does not use mistral-large-2512
does not request bounding boxes
does not request coordinates
does not crop images
does not run image cropping
does not run brand/category/product matching
does not run offer preparation
does not run offer sync
does not write to Supabase
does not include normalized wrapper fields
does not include source/status/warnings/errors/bounding_box objects
returns only the strict page-level JSON schema defined below
reports how many items were returned for each processed page
```

This is a diagnostic OCR-only test to evaluate whether `mistral-ocr-2512` can reliably extract item offers with minimal output.

## 3. Required Model

Force this test mode to use:

```env
MISTRAL_OCR_MODEL=mistral-ocr-2512
```

Do not use:

```text
mistral-large-2512
```

If `mistral-large-2512` is currently hardcoded anywhere for OCR, remove that hardcoding and use the configured OCR model.

If there is a general LLM model config elsewhere, do not confuse it with OCR.

OCR extraction must use `mistral-ocr-2512`.

## 4. Required Test Mode

Implement one of these, choosing the option that best fits the current app structure.

### Preferred option: script

Create a script such as:

```text
scripts/testMinimalMistralOcr.ts
```

Add package script:

```json
{
  "scripts": {
    "test:ocr:minimal": "tsx scripts/testMinimalMistralOcr.ts"
  }
}
```

The script should accept:

```text
PDF path
optional page range
optional output directory
```

Example usage:

```bash
npm run test:ocr:minimal -- --pdf "./Offers/sample.pdf" --pages "1-3" --out "./ocr-test-output"
```

### Alternative option: app UI test button

If a script is difficult, add a clearly separated UI action:

```text
Run Minimal OCR Test
```

This action must not affect the normal full extraction flow.

It must output JSON files and a page item-count summary.

Do not remove the normal app pipeline.

## 5. Strict Output Schema

The output must be exactly this shape for each page:

```json
{
  "page_number": 1,
  "item_count": 0,
  "items": [
    {
      "item_number": "001",
      "name_ar": "string or null",
      "name_en": "string or null",
      "description_ar": "string or null",
      "description_en": "string or null",
      "offer_price": 0,
      "original_price": 0,
      "size": {
        "value": 0,
        "unit": "string or null",
        "text": "string or null"
      },
      "pack_quantity": 1,
      "bundle_quantity": null,
      "special_offer": "string or null"
    }
  ]
}
```

Rules:

```text
page_number appears once at the top level only.
page_number must not appear inside any item.
item_count must equal items.length.
Each item must include item_number.
item_number must be stable and sequential within the page: "001", "002", "003", etc.
Do not include row_id if item_number exists.
No extra top-level keys.
No extra item keys.
No bounding_box.
No coordinates.
No source object.
No original object.
No offer object.
No status.
No skip_reason.
No warnings.
No errors.
No confidence.
No brand.
No category.
No product_id.
No image_id.
No image_url.
No crop metadata.
No DB metadata.
```

Use `null` when a text value is unknown or not visible.

Use `null` for `original_price` if no original/old price is visible.

Use `null` for `size.value`, `size.unit`, and `size.text` if size is not visible.

Use `null` for `pack_quantity` if the number of pieces/units in the visible pack is not visible and cannot be safely inferred.

Use `null` for `bundle_quantity` if there is no visible bundle/multi-buy offer such as `1+1`, `1+2`, `2+1`, `6+1`, or similar.

Use `null` for `special_offer` if no special condition is visible.

`offer_price` should be a number when visible. If the OCR cannot find a visible offer price for a product block, use `null` and keep the item only when the product block is clearly visible and the missing price is useful for diagnostics.

Do not invent prices.

Do not invent quantities.

## 6. Quantity and Bundle Field Meanings

The schema intentionally separates size, pack quantity, bundle quantity, and special offer text.

Use these meanings exactly:

```text
size
- The size of one unit or the visible package-size text.
- Examples: 1.5L, 135g, 10kg, 600g, 90x80cm.
- Use size.text to preserve the exact visible size text.

pack_quantity
- How many units/pieces are included in the visible pack.
- Examples:
  8x135g -> pack_quantity = 8
  2x500g -> pack_quantity = 2
  30PCS -> pack_quantity = 30
  6+1 FREE on a pack -> pack_quantity = 7 when it clearly means total included pieces
  3 bottles shown as a pack -> pack_quantity = 3 if clear

bundle_quantity
- The total number of items included in a bundle promotion such as 1+1, 1+2, 2+1, 3+1, 6+1.
- Examples:
  1+1 -> bundle_quantity = 2
  1+2 -> bundle_quantity = 3
  2+1 -> bundle_quantity = 3
  3+1 -> bundle_quantity = 4
  6+1 -> bundle_quantity = 7

special_offer
- The exact visible promotion or condition text.
- Examples:
  1+1
  1+2 Free
  2+1 Free
  6+1 Free
  Per Pack
  Per Box
  Per Bag
  Per Kg
  Selected Branches Only
  Loyalty Required
  Arabic equivalents such as ⁄—÷ Œ«’, ··Õ»…, ··ﬂÌ”, ··ﬂÌ·Ê, ··ÿ»ﬁ
```

Do not hide bundle information only inside `special_offer`.

Always fill `pack_quantity` and/or `bundle_quantity` when visible or clearly inferable from text such as:

```text
1+1
1+2
2+1
6+1 FREE
8x135g
2x500g
30PCS
2x1.8L
10x1100g
```

If uncertain, keep the raw visible text in `special_offer` and set uncertain numeric fields to `null`.

## 7. Multi-Page Output

When multiple pages are tested, write one JSON file per page.

Recommended filenames:

```text
page-001-minimal-ocr.json
page-002-minimal-ocr.json
page-003-minimal-ocr.json
```

Each file must use the exact single-page schema above.

Also write a summary file:

```text
minimal-ocr-summary.json
```

Summary schema:

```json
{
  "model": "mistral-ocr-2512",
  "total_pages": 0,
  "total_items": 0,
  "pages": [
    {
      "page_number": 1,
      "item_count": 0,
      "output_file": "page-001-minimal-ocr.json"
    }
  ]
}
```

No extra fields.

At the end of the Antigravity run, print a plain text summary:

```text
Minimal OCR test completed.
Model: mistral-ocr-2512
Page 1: 13 items
Page 2: 15 items
Page 3: 12 items
Total: 40 items
Output folder: ./ocr-test-output
```

## 8. Prompt for Mistral OCR

Update or create a separate prompt builder for this diagnostic mode, such as:

```text
src/main/ocr/minimalOcrPromptBuilder.ts
```

Do not reuse the full extraction prompt if it asks for bounding boxes, brand/category, confidence, or metadata.

The prompt must say:

```text
You are extracting supermarket leaflet product offers.

Return only valid JSON matching the exact schema.

Do not include markdown.
Do not include prose.
Do not include explanations.
Do not include comments.
Do not include any keys not present in the schema.

Extract every visible product offer item on this page.

For each item, extract only:
- item_number
- Arabic name
- English name
- Arabic description, if available
- English description, if available
- current offer price
- original/old price, if visible
- size including value, unit, and raw text
- pack_quantity
- bundle_quantity
- special offer condition such as 2+1, 1+1, 1+2, 6+1, bundle deal, per kg, per pack, per box, per bag, loyalty-only, selected branches only, or other visible condition.

Do not extract:
- bounding boxes
- coordinates
- brand fields
- category fields
- confidence
- warnings
- source metadata
- image metadata
- SKU-only rows
- logo/header/footer text
- campaign banners
- page titles
- date badges
- standalone old prices
- standalone discount badges
- standalone unit labels
- standalone branch notes

A valid item is a product offer block with a product name or clear product visual and a visible offer price.

Associate the current price with the nearest product block.

Many Saudi leaflet prices are stylized:
- 24 99 means 24.99
- 13 99 means 13.99
- 24 99 means 24.99
- large number plus small cents is a decimal price.

Use null for unknown optional values.

Do not invent missing values.

Do not invent prices.

Do not invent quantities.

The page number must appear once at the top level only.
Do not include page_number inside item objects.
item_count must equal the number of items.
item_number must be sequential: "001", "002", "003".
```

## 9. Exact JSON Schema to Give Mistral

The Mistral prompt must include this exact schema:

```json
{
  "page_number": 1,
  "item_count": 2,
  "items": [
    {
      "item_number": "001",
      "name_ar": "√—“ √»Ê ﬂ«” „“… Â‰œÌ »”„ Ì",
      "name_en": "Abu Kass Mazza Basmati Rice",
      "description_ar": null,
      "description_en": null,
      "offer_price": 29.99,
      "original_price": 48.25,
      "size": {
        "value": 5,
        "unit": "kg",
        "text": "5kg"
      },
      "pack_quantity": 1,
      "bundle_quantity": null,
      "special_offer": "Per Bag"
    },
    {
      "item_number": "002",
      "name_ar": "“Ì  Â«·Ì √Ê·Ì‰",
      "name_en": "Haley Olein Oil",
      "description_ar": null,
      "description_en": null,
      "offer_price": 31.99,
      "original_price": 47.97,
      "size": {
        "value": 1.5,
        "unit": "L",
        "text": "1.5L"
      },
      "pack_quantity": 3,
      "bundle_quantity": 3,
      "special_offer": "1+2"
    }
  ]
}
```

The actual response must be valid JSON only.

## 10. Example Quantity Handling

The prompt must include examples like these so Mistral understands exactly what to do.

### Example 1: pack quantity from size text

Visible text:

```text
8x135g
```

Expected fields:

```json
{
  "size": {
    "value": 135,
    "unit": "g",
    "text": "8x135g"
  },
  "pack_quantity": 8,
  "bundle_quantity": null,
  "special_offer": "Per Pack"
}
```

### Example 2: bundle quantity from 1+1

Visible text:

```text
1+1
```

Expected fields:

```json
{
  "pack_quantity": 2,
  "bundle_quantity": 2,
  "special_offer": "1+1"
}
```

### Example 3: bundle quantity from 1+2

Visible text:

```text
1+2
```

Expected fields:

```json
{
  "pack_quantity": 3,
  "bundle_quantity": 3,
  "special_offer": "1+2"
}
```

### Example 4: pieces count

Visible text:

```text
30PCS
```

Expected fields:

```json
{
  "size": {
    "value": 30,
    "unit": "pcs",
    "text": "30PCS"
  },
  "pack_quantity": 30,
  "bundle_quantity": null,
  "special_offer": "Per Plate"
}
```

### Example 5: per kg offer

Visible text:

```text
Per Kg
```

Expected fields:

```json
{
  "size": {
    "value": null,
    "unit": "kg",
    "text": "Per Kg"
  },
  "pack_quantity": null,
  "bundle_quantity": null,
  "special_offer": "Per Kg"
}
```

## 11. Validation of Mistral Response

Create or update a validator for this minimal schema.

Recommended file:

```text
src/shared/schemas/minimalOcrSchema.ts
```

Validation rules:

```text
Top-level object only.
page_number required.
item_count required.
items required array.
item_count must equal items.length.
Every item must have item_number.
item_number must be string.
No page_number inside item.
No extra keys at top level.
No extra keys inside item.
No extra keys inside size.
Allowed item keys only:
  item_number
  name_ar
  name_en
  description_ar
  description_en
  offer_price
  original_price
  size
  pack_quantity
  bundle_quantity
  special_offer
Allowed size keys only:
  value
  unit
  text
offer_price must be number or null.
original_price must be number or null.
size.value must be number or null.
size.unit must be string or null.
size.text must be string or null.
pack_quantity must be number or null.
bundle_quantity must be number or null.
special_offer must be string or null.
name_ar or name_en should exist for a normal item.
```

If Mistral returns extra fields, do not silently keep them.

Either:

```text
strictly reject the response and print validation error
```

or:

```text
strip extra fields and record that stripping occurred in the test log
```

Preferred for this diagnostic test:

```text
strictly reject extra fields
```

because we need to test whether the prompt/schema is being followed.

## 12. No Cropping / No Coordinates

For this diagnostic test:

```text
Do not request bounding boxes from Mistral.
Do not request coordinates from Mistral.
Do not run local image cropping.
Do not call imageCroppingService.
Do not call boundingBoxValidator.
Do not create crop output files.
Do not include image paths.
Do not include image URLs.
```

This test should only evaluate text/offer extraction quality.

## 13. No Downstream Pipeline

For this diagnostic test, do not run:

```text
OCR normalization wrapper
promotional filtering
image cropping
import tracking persistence
entity matching
offer preparation
offer sync
Supabase Storage upload
Supabase DB insert/update
```

This test should call Mistral and save the minimal JSON result only.

## 14. Rate-Limit Safety

Use the existing free-tier-safe settings:

```text
OCR_CHUNK_SIZE=1
OCR_MAX_CONCURRENT_REQUESTS=1
OCR_MIN_REQUEST_INTERVAL_MS=5000
OCR_RATE_LIMIT_MODE=free_tier_safe
```

Process one page at a time.

Do not run concurrent Mistral calls.

If multiple pages are tested, show progress:

```text
Processing page 1 of 10...
Waiting before next Mistral OCR request...
Processing page 2 of 10...
```

## 15. Output Count Reporting

After the test completes, Antigravity must report:

```text
how many items were returned for each page
total item count across tested pages
which output JSON file was written for each page
whether schema validation passed
whether any page failed
```

Example final summary:

```text
Minimal OCR 2512 test completed.

Page item counts:
- Page 1: 13 items
- Page 2: 15 items
- Page 3: 12 items

Total items: 40
Model used: mistral-ocr-2512
Schema validation: passed
Output folder: ./ocr-test-output

No cropping, coordinates, DB writes, image upload, or sync were performed.
```

## 16. Compare Against Current Bloated Output

The current page-1 JSON output contains many fields that are not allowed in this diagnostic test, such as:

```text
source
original
status
skip_reason
offer
bounding_box
warnings
errors
brand_name_ar
brand_name_en
category_name_ar
category_name_en
confidence
```

The new minimal test output must not include those fields.

This is intentional.

The purpose is to test whether Mistral can return concise, accurate offer data before the app adds normalization and downstream processing.

## 17. Files to Avoid Modifying

Do not modify final sync logic unless absolutely necessary.

Do not modify Supabase DB writes.

Do not modify offer publishing behavior.

Do not modify image cropping behavior for the normal pipeline.

Do not remove the normal full extraction flow.

This chunk should add a minimal test path, not replace the production pipeline.

## 18. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not log Mistral API key.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose raw Mistral client to renderer.
* Do not run Supabase writes.
* Do not upload images.
* Do not publish offers.
* Do not request coordinates.
* Do not crop images.
* Do not include extra JSON fields.
* Do not invent missing prices.
* Do not invent missing sizes.
* Do not invent missing pack quantities.
* Do not invent missing bundle quantities.

## 19. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 20. Acceptance Criteria

This chunk is complete when:

* Minimal OCR test mode exists.
* Test mode uses `mistral-ocr-2512`.
* Test mode does not use `mistral-large-2512`.
* Test mode does not request bounding boxes or coordinates.
* Test mode does not run image cropping.
* Test mode does not run DB writes or sync.
* Mistral prompt includes the strict minimal schema.
* Mistral prompt explicitly explains `pack_quantity`, `bundle_quantity`, and `special_offer`.
* Mistral response is validated strictly.
* Output JSON has page_number once at top level.
* Output JSON has item_count at top level.
* Output JSON has items array.
* Items have item_number.
* Items include pack_quantity.
* Items include bundle_quantity.
* Items do not have page_number.
* No extra fields are included.
* One JSON file is written per page.
* Summary JSON is written.
* Antigravity reports item count per page after the test.
* Existing app still starts.
* TypeScript compiles.

## 21. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* Exact command to run the minimal OCR test.
* Confirmed OCR model used.
* Output folder.
* Item count per page.
* Total item count.
* Whether schema validation passed.
* Whether any page failed.
* Confirm that no cropping, coordinates, DB writes, image upload, or sync were performed.
* Confirm how pack_quantity, bundle_quantity, and special_offer are extracted.

Keep the project runnable after this chunk.