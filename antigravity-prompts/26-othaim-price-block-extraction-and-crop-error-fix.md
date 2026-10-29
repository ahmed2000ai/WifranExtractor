# Antigravity Prompt Chunk 26: Othaim Price Block Extraction and Crop Error Fix

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 26. Prompt Chunks 01 to 25 should already have completed the extractor app, Wifran contract alignment, direct publish mode, retry failed OCR chunks, and Mistral free-tier-safe OCR queue.

This chunk fixes a real extraction accuracy problem observed on Othaim page 52.

## 1. Read These Files First

Before coding, read:

```text
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/wifran_docs/20-offer-location-scope-and-coverage-rules.md
project-knowledge/wifran_docs/offer-images-bucket.md
src/main/ocr/ocrPromptBuilder.ts
src/main/ocr/mistralOcrProvider.ts
src/shared/types/ocr.ts
src/shared/schemas/ocrSchema.ts
src/shared/utils/priceParsing.ts
src/shared/utils/ocrNormalization.ts
src/shared/utils/promotionalFilter.ts
src/main/image/imageCroppingService.ts
src/main/image/boundingBoxValidator.ts
src/main/db/offerPayloadBuilder.ts
scripts/validateFixtures.ts
src/renderer/pages/ResultsPage.tsx
```

Also inspect any local sample/debug files for page 52 if present, especially:

```text
chunk-052-pages-052-052.pdf
```

If this sample file is not already in the repository, create a documented fixture placeholder and add instructions for testing with the operator-provided page 52 PDF manually.

## 2. Problem to Fix

The app currently extracts many rows as errors because it sees product names but fails to extract or associate offer prices.

Observed UI issues:

```text
OCR_ERROR: Missing or invalid offer price
OCR_WARNING: Uncertain product block association, missing price or title
CROP_FAILED: Unknown crop error
```

On Othaim page 52, the current offer prices are visible, but they appear as stylized price blocks, for example:

```text
24 99
13 99
11 99
49 99
24 99
32 99
26 99
12 99
9 99
10 99
14 99
11 99
20 99
12 99
5 99
```

These should normalize to:

```text
24.99
13.99
11.99
49.99
24.99
32.99
26.99
12.99
9.99
10.99
14.99
11.99
20.99
12.99
5.99
```

## 3. Goal of This Chunk

Improve extraction and validation so that dense Othaim-style leaflet pages produce valid item rows instead of missing-price errors.

This chunk must:

```text
strengthen the OCR prompt for stylized price blocks
support raw price text fields
parse split visual prices
add page-52-style regression fixtures
avoid cropping rows with blocking OCR errors
make crop errors more specific
show clearer row issues in the UI
```

Do not change publishing defaults in this chunk.

Do not weaken blocking validation.

Do not publish rows with missing or uncertain offer prices.

## 4. Required Files to Create or Update

Create or update files similar to:

```text
src/main/ocr/ocrPromptBuilder.ts
src/shared/types/ocr.ts
src/shared/schemas/ocrSchema.ts
src/shared/utils/priceParsing.ts
src/shared/utils/ocrNormalization.ts
src/shared/utils/promotionalFilter.ts
src/main/image/imageCroppingService.ts
src/main/image/boundingBoxValidator.ts
src/shared/fixtures/othaim-page-52-response.json
src/shared/fixtures/othaim-price-format-edge-cases.json
scripts/validateFixtures.ts
src/renderer/pages/ResultsPage.tsx
docs/testing/sample-pdf-testing-guide.md
README.md
```

Adapt paths if the current project structure differs.

## 5. OCR Schema Update: Add Raw Price Text

Update OCR types and schema to allow these optional fields:

```ts
raw_offer_price_text: string | null;
raw_original_price_text: string | null;
```

If the schema already has equivalent fields, reuse them.

Rules:

```text
raw_offer_price_text should store the visible current price exactly as OCR saw it.
raw_original_price_text should store the visible old/original price exactly as OCR saw it.
offer_price should still be numeric when possible.
original_price should still be numeric when possible.
If Mistral is uncertain about numeric conversion, it should populate raw_offer_price_text instead of dropping the price entirely.
```

Default missing raw fields to `null`.

Do not require these fields for older fixtures.

## 6. OCR Prompt Update for Othaim-Style Price Blocks

Update `src/main/ocr/ocrPromptBuilder.ts`.

Add strong instructions:

```text
Many Saudi leaflet prices are visual price blocks, not normal text.
A current offer price may appear as a large number plus small cents, such as 24 99, 13 99, 11 99, or 49 99.
Convert these to decimal prices: 24.99, 13.99, 11.99, 49.99.
The large green/white price box near a product is usually the current offer price.
The smaller crossed or nearby price is usually the original_price.
Do not ignore large price blocks just because they are stylized.
For every product-offer block, try hard to associate:
product image + product name + current price + old price + pack size + unit label + discount badge.
If the numeric current price is visible but hard to parse, put the visible text in raw_offer_price_text.
Do not return offer_price = null when a visible current price is clearly attached to the product block.
Only return offer_price = null when there is truly no visible current offer price.
```

Add examples in the prompt:

```json
{
  "product_name_en": "DAC Disinfectant Rose",
  "raw_offer_price_text": "24 99",
  "offer_price": 24.99,
  "raw_original_price_text": "29.99",
  "original_price": 29.99
}
```

```json
{
  "product_name_en": "Rex Table Cover 6 Rolls",
  "raw_offer_price_text": "9 99",
  "offer_price": 9.99,
  "raw_original_price_text": "19.99",
  "original_price": 19.99
}
```

Keep existing instructions:

```text
Return only valid JSON.
No markdown.
No prose.
Do not create rows from standalone prices, old prices, discount badges, SKU codes, branch notes, or unit notes.
Extract product-offer blocks, not isolated text regions.
```

## 7. Price Parser Update

Update:

```text
src/shared/utils/priceParsing.ts
```

Improve `parsePrice` so it supports:

```text
24 99 -> 24.99
24-99 -> 24.99
24ـ99 -> 24.99
24٫99 -> 24.99
24,99 -> 24.99
SAR 24 99 -> 24.99
ر.س 24 99 -> 24.99
٢٤ ٩٩ -> 24.99
```

Rules:

```text
Only treat two-part numbers as decimal prices when the second part is exactly 2 digits.
Do not convert SKU/item codes into prices.
Do not parse long numbers such as 60425175 as prices.
Do not parse pack sizes such as 90x80cm as prices.
Do not parse 3x37.5gm as prices.
Do not parse 2x300ml as prices.
```

Add helper if useful:

```ts
export function parseVisualPriceText(value: unknown): number | null;
```

## 8. OCR Normalization Price Repair

Update:

```text
src/shared/utils/ocrNormalization.ts
```

If `offer_price` is null but `raw_offer_price_text` exists:

```text
Try parseVisualPriceText(raw_offer_price_text).
If valid, set offer_price to parsed value.
Add warning code PRICE_REPAIRED_FROM_RAW_TEXT.
```

If `original_price` is null but `raw_original_price_text` exists:

```text
Try parseVisualPriceText(raw_original_price_text).
If valid, set original_price to parsed value.
Add warning code ORIGINAL_PRICE_REPAIRED_FROM_RAW_TEXT.
```

Add validation codes:

```text
PRICE_REPAIRED_FROM_RAW_TEXT
ORIGINAL_PRICE_REPAIRED_FROM_RAW_TEXT
VISUAL_PRICE_PARSE_FAILED
```

If neither numeric nor raw price can be parsed, keep the existing blocking error:

```text
MISSING_OFFER_PRICE
```

Do not invent prices.

## 9. Product Block Association for Page 52

Ensure the prompt and normalizer preserve these items as separate valid product-offer rows when present:

```text
DAC Disinfectant Rose
Med Disinfectant Pine
U-Do Rose Disinfectant
Dettol Floor Cleaner
Glade Air Freshener Rose
Raid Insect Odorless Off 15%
Harpic Power Plus Toilet Cleaner
Maog Aluminum Foil + Cling Film
Rex Table Cover 6 Rolls
Maog Gold Sponge Scourer or Maog Stainless
Rex Aluminum Foil
Camel Table Covers Roll
Sanita Club Garbage Bag
Shiraa Trash Bags
Rex Garbage Bag 30Gallons
```

Do not merge neighboring products.

Do not create rows for:

```text
Home care header
Othaim logo
Or/أو badge alone
Per Pack badge alone
Each badge alone
3L + 2L Free badge alone
2+1 Free badge alone
SKU-like numbers alone
```

## 10. Fixture: Othaim Page 52 Response

Create:

```text
src/shared/fixtures/othaim-page-52-response.json
```

This fixture should model the expected structured OCR output for page 52.

Include at least these rows:

```text
DAC Disinfectant Rose -> 24.99, original 29.99
Med Disinfectant Pine -> 13.99, original 19.99
U-Do Rose Disinfectant -> 11.99, original 24.99
Dettol Floor Cleaner -> 49.99, original 72.50
Glade Air Freshener Rose -> 24.99, original 34.99
Raid Insect Odorless Off 15% -> 24.99, original 32.99
Harpic Power Plus Toilet Cleaner -> 13.99, original 26.99
Maog Aluminum Foil + Cling Film -> 12.99, original 17.99
Rex Table Cover 6 Rolls -> 9.99, original 19.99
Maog Gold Sponge Scourer or Maog Stainless -> 10.99, original 14.50
Rex Aluminum Foil -> 14.99, original 29.99
Camel Table Covers Roll -> 11.99, original 20.99
Sanita Club Garbage Bag -> 20.99, original 27.75
Shiraa Trash Bags -> 12.99, original 20.99
Rex Garbage Bag 30Gallons -> 5.99, original 14.99
```

Use approximate bounding boxes if exact values are not available.

Use `raw_offer_price_text` with split formats like `"24 99"`.

Use `raw_original_price_text` where visible.

## 11. Fixture: Price Format Edge Cases

Create:

```text
src/shared/fixtures/othaim-price-format-edge-cases.json
```

Include:

```text
24 99 -> 24.99
24-99 -> 24.99
٢٤ ٩٩ -> 24.99
60425175 -> not price
90x80cm -> not price
3x37.5gm -> not price
2x300ml -> not price
Or/أو -> not price
Per Pack -> not price
```

## 12. Fixture Validation Update

Update:

```text
scripts/validateFixtures.ts
```

Add assertions:

```text
Othaim page 52 fixture produces at least 15 normalized rows.
All 15 expected product rows have valid offer_price.
No expected product row is skipped.
No expected product row is marked error for missing price.
Visual split prices are parsed correctly.
SKU-like numbers are not parsed as prices.
Pack-size expressions are not parsed as prices.
Standalone badges are not parsed as product rows.
```

Run:

```bash
npm run validate:fixtures
```

## 13. Crop Gating Fix

Update:

```text
src/main/image/imageCroppingService.ts
```

Rows with blocking OCR errors should not be cropped by default.

Rules:

```text
If row.status = error:
  do not crop
  return crop status = skipped
  issue code = ROW_HAS_BLOCKING_OCR_ERRORS

If row.status = skipped:
  do not crop

If row.status = warning or valid:
  crop only if bounding_box exists and is valid
```

Add validation code:

```text
ROW_HAS_BLOCKING_OCR_ERRORS
```

This prevents repeated misleading errors like:

```text
CROP_FAILED: Unknown crop error
```

when the real problem is the row was not eligible for cropping.

## 14. Crop Error Specificity

Update crop error handling so it returns specific issue codes:

```text
PAGE_IMAGE_NOT_FOUND
MISSING_BOUNDING_BOX
INVALID_BOUNDING_BOX
BOUNDING_BOX_TOO_SMALL
BOUNDING_BOX_TOO_LARGE
BOUNDING_BOX_OUT_OF_PAGE
IMAGE_CROP_FAILED
ROW_HAS_BLOCKING_OCR_ERRORS
NON_PRODUCT_PROMOTIONAL_AREA
```

Do not use generic:

```text
Unknown crop error
```

unless the exception truly cannot be classified.

When an unknown exception occurs, include a safe message without stack traces or secrets.

## 15. Results UI Improvements

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

or relevant components so row issues are grouped by stage:

```text
OCR issues
Crop issues
Matching issues
Sync issues
```

For rows with missing price, show:

```text
Missing offer price. The OCR did not associate a visible price with this product block.
```

For repaired price, show:

```text
Price repaired from visual OCR text.
```

For skipped crop due to row error, show:

```text
Image crop skipped because the OCR row has blocking validation errors.
```

This will make debugging easier than a long mixed list of repeated errors.

## 16. Manual Test With Page 52 PDF

Add or update docs:

```text
docs/testing/sample-pdf-testing-guide.md
```

Add a test:

```text
Othaim Page 52 Home Care Test
```

Manual expected result:

```text
Run OCR on chunk-052-pages-052-052.pdf.
Expected product rows: at least 15.
Expected missing-price errors: 0 for the 15 visible product rows.
Expected promotional skipped rows: header/logo/badge-only rows only, if extracted.
Expected crop failures: 0 for rows with valid bounding boxes.
Rows with blocking OCR errors should not attempt crop.
```

## 17. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose service role key to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic network IPC.
* Do not invent prices.
* Do not publish rows with missing or invalid offer prices.
* Do not create offers from price-only, SKU-only, badge-only, branch-note-only, or unit-note-only rows.
* Do not crop rows with blocking OCR errors.
* Do not log secrets.

## 18. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 19. Acceptance Criteria

This chunk is complete when:

* OCR schema supports `raw_offer_price_text`.
* OCR schema supports `raw_original_price_text`.
* Prompt explicitly handles stylized Saudi split price blocks.
* Price parser supports `24 99`, `24-99`, and Arabic numeral equivalents.
* Price parser does not parse SKU codes or pack sizes as prices.
* Normalization repairs missing numeric prices from raw visual price text.
* Othaim page 52 fixture exists.
* Price edge-case fixture exists.
* Fixture validation proves the 15 expected page 52 items have valid prices.
* Rows with blocking OCR errors are not cropped.
* Crop errors are specific, not generic `Unknown crop error`.
* Results UI groups issues by stage or shows clearer messages.
* Documentation includes Othaim page 52 manual test.
* TypeScript compiles.
* Existing fixture validation passes.
* App still starts.

## 20. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How visual prices are parsed.
* How raw price text is used.
* How page 52 regression fixture works.
* How crop gating changed.
* How UI issue messages changed.
* How to test with page 52.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.