# Antigravity Prompt Chunk 10: Non-Product Promotional/Banner Filtering

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 10. Prompt Chunks 01 to 09 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, validated import form, local PDF preprocessing, shared OCR schemas/fixtures/validation, single-chunk Mistral OCR testing, and the controlled multi-chunk OCR pipeline.

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

Treat these files as the source of truth.

## 2. Goal of This Prompt Chunk

Strengthen and finalize the non-product promotional/banner filtering layer.

Earlier chunks should already have introduced basic promotional filtering. This chunk must make that filtering more reliable, testable, visible in the UI, and properly integrated into the OCR pipeline.

The app must avoid creating future Wifran offers from:

```text
campaign banners
cover graphics
page headers
page footers
supermarket logos
sponsor logos
date badges
decorative graphics
generic promotion slogans
generic 1+1 banners not attached to a real product
text such as عروض تزين عيدك or هنا التوفير when not attached to a product offer
```

A real product offer row should not be skipped just because it has a `1+1` or `2+2` deal. The filter must distinguish product-level offers from page-level promotional graphics.

Do **not** implement image cropping yet.

Do **not** implement Supabase writes yet.

Do **not** create `offer_sources` yet.

Do **not** create `import_batches` yet.

Do **not** insert `import_rows` yet.

Do **not** insert `offers` yet.

Do **not** upload images yet.

Do **not** implement brand/category/product matching yet.

Do **not** add database migrations.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/utils/promotionalFilter.ts
src/shared/utils/ocrNormalization.ts
src/shared/schemas/validationCodes.ts
src/shared/fixtures/promotional-banner-response.json
src/shared/fixtures/valid-ocr-response.json
src/shared/fixtures/promotional-filter-edge-cases.json
src/shared/fixtures/validateFixtures.ts
src/shared/types/ocr.ts
src/main/ocr/ocrPipelineService.ts
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve these responsibilities.

## 4. Filtering Philosophy

The promotional filter should be conservative but effective.

It should confidently skip obvious non-product content.

It should not skip valid product offers.

Use this rule:

```text
If the row clearly represents page-level/campaign-level promotional material, skip it.
If the row clearly represents a purchasable product offer, keep it.
If uncertain, keep the row but mark it with POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA warning and status warning.
```

Do not silently delete rows. If a row is skipped, it should still be visible in OCR results and counted as skipped unless debug/audit settings later disable storing skipped rows.

## 5. Required Filter Function

Update or create:

```text
src/shared/utils/promotionalFilter.ts
```

Implement these functions:

```ts
import type { OcrExtractedItem } from '../types/ocr';

export type PromotionalFilterDecision = {
  isNonProductPromotionalArea: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasonCode: string | null;
  reasons: string[];
};

export function classifyPromotionalArea(
  item: OcrExtractedItem
): PromotionalFilterDecision;

export function isLikelyNonProductPromotionalArea(
  item: OcrExtractedItem
): boolean;

export function getPromotionalAreaReason(
  item: OcrExtractedItem
): string | null;
```

If these functions already exist, refactor them to this behavior without breaking imports.

## 6. Required Reason Codes

Add or confirm these reason codes:

```text
NON_PRODUCT_PROMOTIONAL_AREA
POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA
PROMO_CAMPAIGN_SLOGAN_ONLY
PROMO_GENERIC_DISCOUNT_ONLY
PROMO_DATE_BADGE_ONLY
PROMO_LOGO_OR_SPONSOR_ONLY
PROMO_COVER_OR_HEADER_ONLY
PROMO_NO_PRODUCT_NAME_OR_PRICE
PROMO_BANNER_LIKE_BOUNDING_BOX
```

These may be exported from:

```text
src/shared/schemas/validationCodes.ts
```

## 7. Text Normalization for Filtering

The filter should normalize text before checking.

Combine relevant text fields:

```text
product_name_ar
product_name_en
description_ar
description_en
discount_text
notes_ar
notes_en
brand_name_ar
brand_name_en
```

Normalize by:

```text
lowercasing English text
trimming whitespace
collapsing repeated spaces
removing harmless punctuation for matching
converting Arabic numerals to Western digits
preserving Arabic words for keyword checks
```

Do not destroy the original OCR item. Only use normalized text internally for matching.

## 8. Promotional Keywords

The filter should recognize obvious campaign/promo words when they appear without a real product.

Arabic examples:

```text
عروض
توفير
وفر
عيد
العيد
تزين عيدك
هنا التوفير
تسوق
مهرجان
احتفال
خصومات
تخفيضات
عرض خاص
```

English examples:

```text
offers
savings
save
festival
eid
special offer
promotion
promo
deal
deals
valid from
valid until
may
june
sponsored by
```

Important:

These words alone do not automatically mean skip. For example, `Special Offer Tide Washing Powder` may still be a product offer.

Skip only when the row lacks enough product-specific evidence.

## 9. Strong Product Evidence

A row should usually be kept when it has strong product evidence, such as:

```text
valid product_name_ar or product_name_en that is not just a slogan
valid offer_price greater than 0
brand or category that appears product-related
pack size or pack quantity
unit such as g, kg, ml, l, piece, pack, carton
notes like per bag, per box, للحبة, للكيس, للربطة
bounding box that is item-card sized rather than full-width banner
```

Product examples that must be kept:

```text
حليب هايل بودرة with offer_price 62.95 and discount_text 1+1
معجون طماطم ندى with offer_price 11.50 and discount_text 2+2
مسحوق غسيل تايد with offer_price 51.95
Fairy Dishwash Liquid with offer_price 28.50
Sadia Chicken with offer_price 154.99
```

## 10. Strong Promotional Evidence

A row should be skipped when it has strong promotional evidence and weak product evidence.

Examples:

```text
product_name_ar = عروض تزين عيدك
product_name_en = Eid Offers
discount_text = 1+1
offer_price = 1
notes_ar = هنا التوفير
no pack size
no real product name
banner-like bounding box
```

Other skip cases:

```text
row contains only May 27 - June 02
row contains only supermarket logo or sponsor logo
row contains only Sponsored by Lurpak
row contains only campaign title and decorative text
row contains only a page-wide generic 1+1 graphic
```

## 11. Generic Discount Handling

The filter must distinguish these two cases.

### Case A: Real Product Offer

```json
{
  "product_name_ar": "حليب هايل بودرة",
  "offer_price": 62.95,
  "discount_text": "1+1",
  "pack_size_value": 1800,
  "pack_size_unit": "g",
  "pack_quantity": 2
}
```

Expected:

```text
status = valid or warning
not skipped
```

### Case B: Generic Banner

```json
{
  "product_name_ar": "عروض تزين عيدك",
  "offer_price": 1,
  "discount_text": "1+1",
  "pack_size_value": null,
  "pack_size_unit": null,
  "pack_quantity": 1
}
```

Expected:

```text
status = skipped
skip_reason = NON_PRODUCT_PROMOTIONAL_AREA
```

## 12. Date Badge Handling

Rows that contain only date ranges should be skipped.

Examples:

```text
May 27 - June 02
27 May - 02 June
٢٧ مايو - ٠٢ يونيو
valid from May 27
valid until June 02
```

Expected:

```text
status = skipped
skip_reason = NON_PRODUCT_PROMOTIONAL_AREA
reasonCode = PROMO_DATE_BADGE_ONLY
```

Do not skip a real product row only because notes include a validity date.

## 13. Logo/Sponsor Handling

Rows that contain only supermarket branding or sponsor branding should be skipped.

Examples:

```text
Othaim
العثيم
Sponsored by Lurpak
برعاية
```

But do not skip a product row only because the brand is `Lurpak`.

Example real product:

```text
Lurpak Butter
offer_price = 19.95
pack_size_value = 200
pack_size_unit = g
```

Expected:

```text
not skipped
```

## 14. Bounding Box Heuristics

If bounding box data is available, use it carefully.

Banner-like signs:

```text
very wide box relative to height
box near top of page
box covers large width of page
box covers very large area
```

But do not rely only on bounding box because some real product blocks may be large.

If page dimensions are not available in the shared utility, the utility can only apply simple ratio checks:

```text
width / height > 4 may indicate banner
height very small may indicate header/footer
```

If page dimensions are available later, pipeline can add stronger checks.

Bounding box alone should rarely cause automatic skip. It should support text-based evidence.

## 15. Integration With OCR Normalization

Update:

```text
src/shared/utils/ocrNormalization.ts
```

During normalization:

1. Classify each OCR item using `classifyPromotionalArea`.
2. If `isNonProductPromotionalArea = true` with high confidence:

   * set `status = skipped`
   * set `skip_reason = NON_PRODUCT_PROMOTIONAL_AREA`
   * set `offer = null`
   * add an issue:

     * severity = `info`
     * code = `NON_PRODUCT_PROMOTIONAL_AREA`
     * message = user-readable reason
3. If classification is medium/low confidence but not skipped:

   * add warning:

     * code = `POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA`
   * status should be `warning` unless there are blocking errors.
4. Ensure skipped promotional rows do not later get normalized offer payloads.

## 16. Pipeline Integration

Update:

```text
src/main/ocr/ocrPipelineService.ts
```

Ensure pipeline aggregation counts:

```text
skippedRowCount
skippedPromotionalRowCount
```

Rules:

* Skipped promotional rows should not count as errors.
* Skipped promotional rows should not fail the chunk.
* A chunk containing only skipped promotional rows can still complete.
* A chunk containing `{ items: [] }` can still complete.
* If all chunks return no product rows because they are cover/banner-only, show a clear warning but do not misclassify that as an API failure.

## 17. Fixtures

Update/create:

```text
src/shared/fixtures/promotional-banner-response.json
```

It should include a fake OCR row like:

```json
{
  "items": [
    {
      "row_id": "page-1-banner-1",
      "page_number": 1,
      "product_name_ar": "عروض تزين عيدك",
      "product_name_en": "Eid Offers",
      "brand_name_ar": "العثيم",
      "brand_name_en": "Othaim",
      "category_name_ar": null,
      "category_name_en": null,
      "description_ar": "1+1",
      "description_en": "1+1",
      "offer_price": 1,
      "original_price": null,
      "discount_text": "1+1",
      "pack_size_value": null,
      "pack_size_unit": null,
      "pack_quantity": 1,
      "unit_price": null,
      "unit_price_unit": null,
      "quantity_limit": null,
      "is_loyalty_required": false,
      "loyalty_notes_ar": null,
      "loyalty_notes_en": null,
      "notes_ar": "هنا التوفير",
      "notes_en": "Savings here",
      "bounding_box": {
        "x": 0,
        "y": 0,
        "width": 1200,
        "height": 300
      },
      "confidence": 0.55,
      "warnings": ["POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA"]
    }
  ]
}
```

Create an edge case fixture:

```text
src/shared/fixtures/promotional-filter-edge-cases.json
```

Include cases for:

```text
real product with 1+1 should not be skipped
real product with brand Lurpak should not be skipped
generic 1+1 banner should be skipped
date badge only should be skipped
sponsor logo only should be skipped
campaign slogan only should be skipped
ambiguous promo text with a price should become warning, not skipped
```

## 18. Fixture Validation Update

Update the fixture validation script/tests so they assert:

```text
promotional-banner-response -> skipped with NON_PRODUCT_PROMOTIONAL_AREA
valid product 1+1 -> not skipped
date-only row -> skipped
sponsor-only row -> skipped
Lurpak product row -> not skipped
ambiguous promo row -> warning with POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA
```

If the project does not have a test runner, update `npm run validate:fixtures` to print these assertions and exit non-zero on failure.

## 19. Results Page Integration

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Make skipped promotional rows visible.

For each row, show:

```text
status
skip reason if skipped
issues
```

Add or confirm summary cards:

```text
Skipped rows
Skipped promotional rows
```

Rows with `NON_PRODUCT_PROMOTIONAL_AREA` should be visually distinct but not treated as failed product rows.

## 20. Logs Page Integration

Update Logs page or OCR progress handling to include messages like:

```text
Skipped promotional/banner row page-1-banner-1.
Skipped 3 promotional/banner rows.
```

Do not over-log every skipped row if there are many; summary is enough.

## 21. README Update

Update README with:

* Promotional/banner filtering was strengthened.
* Examples of ignored content.
* Explanation that real product `1+1` offers are preserved.
* How to run fixture validation.
* Warning that database sync and image cropping are still not implemented.

## 22. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic IPC.
* Do not add Supabase writes.
* Do not upload files to Supabase Storage.
* Do not create import batches.
* Do not create offer sources.
* Do not insert import rows.
* Do not insert offers.
* Do not create products, brands, or categories.
* Do not add database migrations.
* Do not crop images yet.
* Do not use unlimited OCR concurrency.
* Do not create offers from banners, logos, date badges, or campaign slogans.

## 23. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 24. Acceptance Criteria

This chunk is complete when:

* Promotional filter returns structured decisions with reasons.
* Obvious campaign/banner rows are skipped.
* Generic `1+1` banners are skipped.
* Real product `1+1` offers are not skipped.
* Date-only rows are skipped.
* Sponsor/logo-only rows are skipped.
* Ambiguous promotional rows are warnings, not automatic skips.
* Normalization sets skipped promotional rows to:

  * `status = skipped`
  * `skip_reason = NON_PRODUCT_PROMOTIONAL_AREA`
  * `offer = null`
* OCR pipeline counts skipped promotional rows.
* Results UI displays skipped promotional rows and counts.
* Fixture validation covers promotional edge cases.
* TypeScript compiles.
* App still starts.
* No database writes, image cropping, or offer sync are implemented.

## 25. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How promotional filtering works.
* Which cases are skipped.
* Which cases are preserved.
* How fixture validation was updated.
* How skipped promotional rows appear in results.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.