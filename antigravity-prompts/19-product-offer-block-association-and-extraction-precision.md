# Antigravity Prompt Chunk 19: Product Offer Block Association and Extraction Precision

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 19. Prompt Chunks 01 to 18 should already have completed the full Wifran Offers Extractor app, including OCR, promotional filtering, image cropping, import tracking, entity matching, offer preparation, final sync, testing, documentation, and Windows packaging.

This chunk is a focused enhancement based on real leaflet layout review.

## 1. Read These Files First

Before coding, read all files inside:

```text
project-knowledge/
```

Specifically read:

```text
project-knowledge/00-prd-wifran-offers-extractor.md
project-knowledge/01-product-brief-and-scope.md
project-knowledge/02-wifran-db-schema-and-sync-rules.md
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/06-env-security-and-credentials.md
project-knowledge/07-sample-extraction-json.md
project-knowledge/08-antigravity-development-plan.md
```

Also read the existing OCR prompt builder, OCR normalization, promotional filter, fixture validation, tests, and documentation.

Treat these files as the source of truth.

## 2. Goal of This Prompt Chunk

Improve extraction accuracy for real supermarket leaflet layouts where each offer appears as a **product offer block**.

The app must avoid two major problems:

```text
1. Missing valid product offers in dense leaflet grids.
2. Creating irrelevant/fake rows from standalone prices, discount badges, SKU numbers, branch notes, or visual labels.
```

The extractor must treat each valid offer as a complete visual block that may contain:

```text
product image/package
Arabic product name
English product name
current offer price
old/original price
pack size/unit
pack quantity
discount badge such as 1+1 or 1+2
unit note such as per kg, per bag, per plate
branch note such as Selected Branches only
SKU/item code
```

The OCR should extract the **product offer block as one row**, not each text or price region separately.

## 3. Real Leaflet Layouts This Chunk Must Handle

The implementation must handle layouts like these:

### Layout A: Clean product grid/card

Example item blocks:

```text
Haley Olein Oil
Abu Kass Indian Mazza Basmati Rice
Maraiena or Qarya Fresh Eggs
```

Characteristics:

```text
product image at top or center
product name below or beside image
large current offer price
small old price
pack size badge such as 1.5L, 10kg, 30PCS
discount badge such as 1+2 or Or/أو
```

### Layout B: Dense mixed grid

Example item blocks:

```text
Golden Fresh Chicken Fillet 900gm
Veal Meat / Kg
Salmon Fillet / Kg
Sadia Tender Chicken Breast 1kg
```

Characteristics:

```text
large price may be above product image
old price may be near current price
product image may be below price
product name may be at the bottom
SKU/item code may appear near the block
branch note may appear near a product
neighboring product blocks are very close
```

The OCR must not lose items just because their price, image, and name are separated vertically.

## 4. Required Files to Create or Update

Create or update files similar to:

```text
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
src/main/ocr/ocrPromptBuilder.ts
src/shared/types/ocr.ts
src/shared/schemas/ocrSchema.ts
src/shared/utils/ocrNormalization.ts
src/shared/utils/promotionalFilter.ts
src/shared/fixtures/product-block-association-response.json
src/shared/fixtures/product-block-edge-cases.json
scripts/validateFixtures.ts
docs/testing/sample-pdf-testing-guide.md
README.md
```

Adapt paths if the existing project structure differs, but preserve responsibilities.

## 5. Add Product Offer Block Association Rules to Knowledge Files

Update:

```text
project-knowledge/03-leaflet-extraction-rules.md
```

Add a new section titled:

```text
Product Offer Block Association Rules
```

Include these rules:

```text
Extract complete product-offer blocks, not isolated text regions.
A valid row should represent one purchasable product offer.
A current price is valid only when it can be associated with a nearby product image and/or product name.
A product name is valid only when it can be associated with a nearby current offer price.
Old prices must not become separate rows.
Discount badges such as 1+1, 1+2, 2+2, Or/أو must not become separate rows.
SKU/item codes must not become product rows.
Branch notes such as Selected Branches only must not become product rows.
Per-unit labels such as Per Kg, Per Bag, Per Plate, للكيلو, للكيس, للطبق are attributes of the related product, not separate rows.
If price is above the image and product name is below the image, combine them into one product offer row.
If several neighboring products are close together, do not merge them unless the leaflet clearly presents them as variants of the same offer.
```

## 6. Update OCR Prompt Rules

Update:

```text
src/main/ocr/ocrPromptBuilder.ts
```

Strengthen the Mistral OCR prompt.

The prompt must clearly say:

```text
Extract by product-offer block, not by isolated OCR text.
Each item must include the current price and the associated product name/image when visible.
Associate nearby price, old price, discount badge, product image, product name, pack size, and notes into one item row.
Do not create separate rows for prices alone, old prices alone, discount badges alone, SKU/item codes alone, branch notes alone, or Or/أو labels alone.
If a price is above a product image and the name is below the image, treat them as one product offer block.
If a discount badge such as 1+1 or 1+2 is attached to a product, store it in discount_text.
If a discount badge appears alone without a product, ignore it.
If an Or/أو badge connects alternative products in the same offer area, capture it in notes or discount_text; do not create an Or/أو row.
If a SKU/item code is visible, store it only in source_reference or notes, not as product name.
If a branch note such as Selected Branches only is visible, store it in notes, not as product name.
```

Make sure the prompt still says:

```text
Return only valid JSON.
No markdown.
No prose.
Use the exact top-level shape { "items": [] }.
Ignore campaign banners, cover graphics, page headers, page footers, supermarket logos, sponsor logos, date badges, decorative graphics, and generic promotion slogans unless they are part of a specific product offer item.
```

## 7. Add Optional Source Reference / OCR Code Support

If the current OCR schema already has `source_reference`, use it.

If not, add optional support for:

```ts
source_reference: string | null
```

or store the value under existing normalized source metadata.

Purpose:

```text
Capture SKU/item codes or leaflet item references such as 7092, 7093, 4534, 60425175 when useful.
```

Rules:

```text
SKU/item codes are optional.
SKU/item codes must not become product names.
SKU/item codes must not become offer rows.
If stored, put them in source_reference or notes.
```

Update these files as needed:

```text
src/shared/types/ocr.ts
src/shared/schemas/ocrSchema.ts
src/shared/utils/ocrNormalization.ts
src/shared/types/offerPayload.ts
src/main/db/offerPayloadBuilder.ts
```

Do not break existing fixtures. Default missing `source_reference` to `null`.

## 8. Strengthen Normalization Against Isolated Price Rows

Update OCR normalization so rows are marked error or skipped when they contain only:

```text
current price with no product name and no product image/block evidence
old price only
discount badge only
SKU/item code only
branch note only
unit note only
```

Add or confirm validation codes:

```text
ISOLATED_PRICE_WITHOUT_PRODUCT
OLD_PRICE_ONLY_ROW
DISCOUNT_BADGE_ONLY_ROW
SKU_ONLY_ROW
BRANCH_NOTE_ONLY_ROW
UNIT_NOTE_ONLY_ROW
PRODUCT_BLOCK_ASSOCIATION_UNCERTAIN
```

Recommended handling:

```text
Isolated current price only -> error or skipped, no offer payload.
Old price only -> skipped.
Discount badge only -> skipped.
SKU only -> skipped.
Branch note only -> skipped.
Unit note only -> skipped.
Uncertain association -> warning with PRODUCT_BLOCK_ASSOCIATION_UNCERTAIN.
```

Do not skip a real product row just because it has a large price, discount badge, SKU code, or branch note.

## 9. Improve Promotional Filter Without Hurting Real Product Offers

Update:

```text
src/shared/utils/promotionalFilter.ts
```

Make sure the filter distinguishes:

### Real product rows to keep

```text
Haley Olein Oil with 1+2 badge and current price
Abu Kass Basmati Rice with old price and current price
Fresh Eggs with Or/أو badge and current price
Golden Fresh Chicken Fillet 900gm with price above image
Veal Meat / Kg with per kg note
Salmon Fillet / Kg with Selected Branches only note
Sadia Tender Chicken Breast 1kg with old/current price
```

### Non-offer rows to skip

```text
1+2 badge alone
Or/أو badge alone
34.99 price alone
43.95 old price alone
7092 SKU code alone
Selected Branches only note alone
Per Kg note alone
campaign header alone
date badge alone
logo/sponsor alone
```

## 10. Add Fixtures for Product Block Association

Create:

```text
src/shared/fixtures/product-block-association-response.json
```

Include a fixture with valid rows representing the two leaflet layout types.

The fixture should include examples similar to:

```text
Haley Olein Oil
Abu Kass Indian Mazza Basmati Rice
Maraiena or Qarya Fresh Eggs
Golden Fresh Chicken Fillet 900gm
Veal Meat / Kg
Salmon Fillet / Kg
Sadia Tender Chicken Breast 1kg
```

Each valid row should include:

```text
product_name_ar and/or product_name_en
offer_price
original_price where applicable
pack_size_value and pack_size_unit where visible
pack_quantity where visible
discount_text where visible
notes_ar/notes_en where useful
source_reference where SKU/item code is visible
bounding_box
confidence
warnings
```

Create:

```text
src/shared/fixtures/product-block-edge-cases.json
```

Include edge cases:

```text
price-only row
old-price-only row
discount-badge-only row
SKU-only row
branch-note-only row
unit-note-only row
real product with price above image and name below image
real product with Or/أو badge
real product with Selected Branches only note
real product with per kg note
```

## 11. Update Fixture Validation

Update:

```text
scripts/validateFixtures.ts
```

Add assertions:

```text
Haley Olein Oil row is valid or warning, not skipped.
Abu Kass Rice row is valid or warning, not skipped.
Fresh Eggs row is valid or warning, not skipped.
Golden Fresh Chicken Fillet row is valid or warning, not skipped.
Veal Meat / Kg row is valid or warning, not skipped.
Salmon Fillet / Kg row is valid or warning, not skipped.
Sadia Chicken Breast row is valid or warning, not skipped.

Price-only row is not importable.
Old-price-only row is skipped.
Discount-badge-only row is skipped.
SKU-only row is skipped.
Branch-note-only row is skipped.
Unit-note-only row is skipped.

No row with status skipped/error should produce a prepared offer payload.
No row should use SKU/item code as product name.
No row should use Selected Branches only as product name.
No row should use Or/أو as product name.
```

Ensure:

```text
npm run validate:fixtures
```

still passes.

## 12. Update Offer Payload Builder Safeguards

Update:

```text
src/main/db/offerPayloadBuilder.ts
```

Ensure it refuses to create a payload when:

```text
title_ar/title_en is only a price
title_ar/title_en is only a SKU/item code
title_ar/title_en is only a branch note
title_ar/title_en is only a unit note
title_ar/title_en is only Or/أو
title_ar/title_en is only a discount badge
```

Add validation issue:

```text
MISSING_TITLE
or
PRODUCT_BLOCK_ASSOCIATION_UNCERTAIN
```

Do not create final payloads from isolated leaflet fragments.

## 13. Update Results UI Labels if Needed

Update Results page row issue display if needed so these new issue codes are readable:

```text
ISOLATED_PRICE_WITHOUT_PRODUCT
OLD_PRICE_ONLY_ROW
DISCOUNT_BADGE_ONLY_ROW
SKU_ONLY_ROW
BRANCH_NOTE_ONLY_ROW
UNIT_NOTE_ONLY_ROW
PRODUCT_BLOCK_ASSOCIATION_UNCERTAIN
```

Display them as understandable messages.

Examples:

```text
Skipped isolated price because it could not be associated with a product.
Skipped SKU-only row because item codes are not product offers.
Warning: product block association is uncertain and needs review.
```

## 14. Update Testing Docs

Update:

```text
docs/testing/sample-pdf-testing-guide.md
```

Add a section:

```text
Dense Product Grid Testing
```

Include checks:

```text
Verify every visible product item was extracted.
Verify large prices above product images were associated with the correct product names.
Verify old prices were not extracted as separate rows.
Verify discount badges were attached to products, not extracted separately.
Verify SKU/item codes were not used as product names.
Verify branch notes were saved as notes, not product names.
Verify per kg/per bag/per plate labels were saved as pack/unit/notes.
Verify neighboring products were not merged incorrectly.
```

Update README testing section if needed.

## 15. API Cost and Accuracy Guidance

Update documentation or comments to clarify:

```text
Do not pre-crop product cards before OCR in MVP because leaflet layouts are irregular and this can miss items.
Use small OCR chunks instead.
Use one page per OCR request for dense pages if extraction quality is poor.
Use two pages per OCR request for normal pages.
Do not request image base64 from Mistral OCR.
Do not request unnecessary prose summaries.
Use structured JSON only.
Keep local cropping after OCR, not before OCR.
```

This preserves recall while avoiding unnecessary API usage.

## 16. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` secrets to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic IPC.
* Do not publish offers automatically.
* Do not use `status = published`.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not modify customer user data.
* Do not create offers from promotional/banner rows.
* Do not create offers from isolated prices, old prices, discount badges, SKU codes, branch notes, or unit notes.

## 17. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 18. Acceptance Criteria

This chunk is complete when:

* Product offer block association rules are added to project knowledge.
* OCR prompt builder explicitly extracts complete product-offer blocks.
* OCR prompt prevents standalone price/badge/SKU/note rows.
* Optional source reference/SKU handling exists or is safely mapped into existing normalized metadata.
* OCR normalization detects isolated price-only, old-price-only, discount-badge-only, SKU-only, branch-note-only, and unit-note-only rows.
* Promotional filter keeps real product offers with 1+1/1+2/Or/أو/Selected Branches/per kg notes.
* Promotional filter skips standalone badges, notes, SKU codes, and price fragments.
* New fixtures for product block association and edge cases exist.
* Fixture validation covers product block association.
* Offer payload builder refuses isolated leaflet fragments.
* Results UI shows readable messages for new issue codes.
* Testing docs explain dense product grid testing.
* No database migrations are added.
* No offers are published automatically.
* TypeScript compiles.
* App still starts.
* `npm run validate:fixtures` passes.
* Existing tests/smoke tests still pass.

## 19. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How product offer block association was added.
* How OCR prompt was strengthened.
* How isolated price/badge/SKU/note rows are handled.
* How valid dense-grid product offers are protected from being skipped.
* Which fixtures/tests were added.
* How to run validation.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.