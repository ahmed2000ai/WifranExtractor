# Antigravity Prompt Chunk 20: OCR API Cost and Accuracy Optimization

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 20. Prompt Chunk 19 should already have strengthened product-offer block association for dense supermarket leaflet layouts.

This chunk specifically optimizes the OCR API usage for:

```text
1. Accuracy: do not miss valid product offer items.
2. Cost control: do not request, return, store, or process unnecessary OCR data.
```

## 1. Read These Files First

Before coding, read:

```text
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
src/main/ocr/ocrPromptBuilder.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/ocrPipelineService.ts
src/main/config/env.ts
src/shared/utils/ocrNormalization.ts
src/shared/fixtures/product-block-association-response.json
src/shared/fixtures/product-block-edge-cases.json
```

## 2. Goal

Improve OCR calls so the app extracts all valid product offers while minimizing unnecessary OCR response size and irrelevant data.

The app should not miss valid product offer blocks, but it should also avoid asking Mistral for:

```text
page summaries
markdown explanations
base64 images
decorative/header/footer text
irrelevant campaign/banner content
unneeded prose
large debug payloads unless debug mode is enabled
```

## 3. OCR Request Optimization Rules

Update the Mistral OCR request builder/provider so the request uses the leanest useful options.

Required behavior:

```text
Use document_annotation_prompt for structured extraction.
Use document_annotation_format JSON schema or JSON object mode.
Set include_image_base64 = false when supported.
Set extract_header = false when supported.
Set extract_footer = false when supported.
Use confidence_scores_granularity = page by default.
Use word confidence only when explicitly configured.
Use table_format = markdown only if required by Mistral/API; otherwise avoid relying on table output.
Do not request image extraction unless needed.
Do not request full prose summaries.
Do not ask OCR to return page markdown as final extraction data.
```

The final app should use `document_annotation` as the primary source of extracted offers.

## 4. Accuracy Optimization Rules

Keep high recall by default.

Do not pre-crop product cards before OCR in MVP because irregular leaflet layouts can cause missed items.

Default strategy:

```text
Render full page locally.
Send page or small PDF chunk to OCR.
Ask OCR to identify all product-offer blocks.
Use bounding boxes returned by OCR.
Crop locally after OCR.
```

Add or confirm logic:

```text
Use OCR_CHUNK_SIZE=1 for dense pages when configured.
Use OCR_CHUNK_SIZE=2 as default for normal leaflets.
Never send an entire long leaflet in one request by default.
If a chunk is dense or extraction quality is poor, allow operator/config to rerun with chunk size 1.
```

## 5. Prompt Output Minimization

Update `ocrPromptBuilder.ts` so the prompt says:

```text
Return only the required JSON fields.
Do not include page summaries.
Do not include markdown.
Do not include prose.
Do not include duplicate text outside item fields.
Do not include decorative/banner/header/footer text unless it is part of a product offer block.
Do not include SKU/item codes as separate rows; store them only in source_reference or notes when attached to a product.
Do not include standalone old prices, standalone badges, standalone branch notes, or standalone unit notes as rows.
```

## 6. OCR Schema Field Review

Review OCR schema fields and keep them useful but not bloated.

Required item fields should remain:

```text
row_id
page_number
product_name_ar
product_name_en
brand_name_ar
brand_name_en
category_name_ar
category_name_en
description_ar
description_en
offer_price
original_price
discount_text
pack_size_value
pack_size_unit
pack_quantity
unit_price
unit_price_unit
quantity_limit
is_loyalty_required
loyalty_notes_ar
loyalty_notes_en
notes_ar
notes_en
source_reference
bounding_box
confidence
warnings
```

Do not ask OCR to return:

```text
full page markdown
all raw text blocks
all detected images
decorative elements
full OCR word list
large base64 image data
long reasoning/explanations
```

## 7. Debug Payload Control

Update OCR debug storage so:

```text
Raw OCR responses are saved only when DEBUG_SAVE_INTERMEDIATE_FILES=true.
Large raw response fields are redacted or omitted if they contain base64 images.
Normalized rows are always small enough for import tracking.
Renderer logs show counts and summaries, not huge raw OCR responses.
```

Add a helper if needed:

```text
stripLargeOcrPayloadFields(response)
```

It should remove or redact:

```text
image_base64
base64
large image arrays
huge markdown fields if not needed
```

Do not remove `document_annotation`.

## 8. Chunk-Level Cost Controls

Update OCR pipeline logging/result summaries to show:

```text
chunks processed
pages processed
items extracted
skipped promotional rows
zero-item chunks
failed chunks
usage_info if Mistral returns it
```

If Mistral returns usage data such as pages processed or document size, store it in summary/debug metadata only, not in every row.

## 9. Optional Dense Page Guidance

Add config/documentation guidance:

```text
For dense leaflets, set OCR_CHUNK_SIZE=1.
For normal leaflets, use OCR_CHUNK_SIZE=2.
Avoid OCR_CHUNK_SIZE=3 unless pages are sparse and extraction remains accurate.
```

Do not auto-detect density unless already easy and safe.

## 10. Tests / Fixture Validation

Update fixture validation or smoke tests to assert:

```text
OCR prompt includes "Return only valid JSON".
OCR prompt includes product-offer block association rules.
OCR prompt includes no prose/no markdown instruction.
OCR prompt rejects standalone price/badge/SKU/note rows.
OCR request options disable image base64 when supported.
OCR request options disable header/footer extraction when supported.
Debug stripping removes base64-like large fields but keeps document_annotation.
```

## 11. Documentation Update

Update:

```text
project-knowledge/04-ocr-api-and-bounding-box-spec.md
docs/testing/sample-pdf-testing-guide.md
README.md
```

Document:

```text
How the app balances accuracy and API cost.
Why it OCRs full pages/small chunks instead of pre-cropping.
Recommended OCR_CHUNK_SIZE values.
What OCR data is intentionally not requested.
Why base64 images and prose summaries are disabled.
How to troubleshoot missed items: rerun with chunk size 1 and review OCR prompt/fixtures.
```

## 12. Security Rules

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic IPC.
* Do not publish offers automatically.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not create offers from promotional/banner rows.
* Do not create offers from isolated prices, old prices, discount badges, SKU codes, branch notes, or unit notes.

## 13. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 14. Acceptance Criteria

This chunk is complete when:

* OCR request options are lean and do not request unnecessary image/base64/prose/header/footer data.
* Prompt output is minimized to required JSON only.
* Product-offer block recall remains prioritized.
* Full-page/small-chunk OCR remains the default accuracy strategy.
* Dense leaflet guidance is documented.
* Debug storage avoids large unnecessary payloads unless explicitly enabled.
* Usage/cost-related metadata is summarized at chunk level.
* Tests or fixture validation check prompt/request cost controls.
* TypeScript compiles.
* Existing fixture validation passes.
* App still starts.