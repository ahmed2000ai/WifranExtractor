# OCR API and Bounding Box Spec

## 1. Purpose of This Document

This document defines how Wifran Offers Extractor should connect to the OCR provider and how it should handle bounding boxes for item image cropping.

Antigravity must use this document when implementing:

* OCR API configuration.
* Mistral OCR client.
* OCR request construction.
* OCR structured extraction prompt.
* OCR response parsing.
* Bounding-box extraction.
* Coordinate conversion.
* OCR retry and concurrency handling.
* Filtering non-product promotional/banner areas.
* Local image cropping preparation.

The MVP OCR provider is Mistral OCR using `mistral-ocr-latest`.

## 2. OCR Provider

Default provider:

```text
Mistral OCR
```

Default model:

```text
mistral-ocr-latest
```

API endpoint:

```text
POST https://api.mistral.ai/v1/ocr
```

Authentication:

```text
Authorization: Bearer {MISTRAL_API_KEY}
```

Content type:

```text
Content-Type: application/json
```

## 3. Environment Variables

The extractor app should use these OCR-related environment variables:

```text
MISTRAL_API_KEY=
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_OCR_ENDPOINT=https://api.mistral.ai/v1/ocr
OCR_CHUNK_SIZE=2
OCR_MAX_CONCURRENT_REQUESTS=3
OCR_MAX_RETRIES=3
OCR_RETRY_BASE_DELAY_MS=1000
OCR_REQUEST_TIMEOUT_MS=120000
OCR_CONFIDENCE_GRANULARITY=page
OCR_TABLE_FORMAT=markdown
```

Rules:

* Do not hardcode `MISTRAL_API_KEY`.
* Do not commit `.env.local`.
* Provide `.env.example`.
* Do not expose `MISTRAL_API_KEY` in the Electron renderer process.
* OCR calls should run from the Electron main process or a protected backend layer.
* The renderer should trigger OCR through safe IPC calls.

## 4. Mistral OCR Request Fields

The Mistral OCR endpoint accepts a JSON body.

Important request fields for this project:

```text
model
document
pages
document_annotation_prompt
document_annotation_format
bbox_annotation_format
confidence_scores_granularity
include_image_base64
image_limit
image_min_size
table_format
extract_header
extract_footer
```

The implementation does not need to use every field immediately, but it must understand the fields that matter for Wifran.

## 5. Required MVP Request Fields

For the MVP, the OCR request should include at minimum:

```json
{
  "model": "mistral-ocr-latest",
  "document": {},
  "document_annotation_prompt": "...",
  "document_annotation_format": {
    "type": "json_schema",
    "json_schema": {}
  },
  "confidence_scores_granularity": "page",
  "table_format": "markdown",
  "extract_header": false,
  "extract_footer": false
}
```

The exact `document` object depends on how Antigravity implements file handling.

Antigravity must verify the exact TypeScript SDK syntax during implementation.

## 6. Document Input Strategies

Mistral OCR supports document input through document/file chunks, document URLs, or image URLs.

For Wifran Offers Extractor, use one of these approaches.

## 6.1 OCR Request Cost Optimization
Mistral API costs are controlled by:
- **`include_image_base64: false`**: Never ask Mistral to echo back images to the renderer.
- **Prompt rules**: We explicitly tell Mistral "Do not return markdown. Do not include page summaries. Do not include prose."
- **Chunk Sizing**: We default to `OCR_CHUNK_SIZE=2` to ensure fewer roundtrips without hitting length limits. For highly dense pages, `OCR_CHUNK_SIZE=1` is recommended.
- **Debug Redaction**: We strip large response strings over 50,000 characters (unless they are the `document_annotation` JSON) to keep local debug JSONs clean and performant.

## The Strategy: File or Uploaded File Reference

The app should split the selected PDF locally into page chunks.

Each chunk should be submitted to OCR as a file/document input or an uploaded file reference supported by the official Mistral SDK.

Conceptual request:

```json
{
  "model": "mistral-ocr-latest",
  "document": {
    "type": "file",
    "file_name": "leaflet-page-001.pdf",
    "content": "base64-or-file-reference"
  }
}
```

Important:

* The exact SDK shape may differ.
* Antigravity must check the installed `@mistralai/mistralai` SDK types during implementation.
* Do not assume the placeholder above is final SDK syntax.
* The final implementation must match the official Mistral SDK/API contract.

## 6.2 Alternative Strategy: Temporary Document URL

The app may upload each PDF chunk to temporary private storage, generate a short-lived signed URL, and submit it as a document URL.

Conceptual request:

```json
{
  "model": "mistral-ocr-latest",
  "document": {
    "type": "document_url",
    "documentUrl": "https://signed-url-to-pdf-chunk"
  }
}
```

Use this only if direct file input is difficult in the local Electron environment.

If using signed URLs:

* URLs must be short-lived.
* Do not make source PDFs public permanently.
* Delete temporary chunks when no longer needed.
* Do not log signed URLs.

## 6.3 Alternative Strategy: Rendered Page Image URL

The app may render each page into an image and send image URLs.

Conceptual request:

```json
{
  "model": "mistral-ocr-latest",
  "document": {
    "type": "image_url",
    "image_url": {
      "url": "https://signed-url-to-page-image"
    }
  }
}
```

Use this only if PDF chunk input is unreliable.

If image input is used:

* Render pages at a consistent DPI.
* Store page image dimensions.
* Make sure bounding boxes refer to the same rendered image dimensions used for cropping.

## 7. Page Number Handling

Mistral’s `pages` parameter starts from `0`.

Wifran extraction data must use 1-indexed page numbers.

Rules:

```text
Mistral page index 0 -> Wifran page_number 1
Mistral page index 1 -> Wifran page_number 2
Mistral page index 2 -> Wifran page_number 3
```

When splitting PDFs into physical chunks, be extra careful:

```text
Original PDF page 17 may become page index 0 inside chunk file.
The app must preserve original_page_number = 17.
The OCR prompt must be told the original page number range for the chunk.
The normalized result must store original 1-indexed PDF page numbers, not chunk-local page numbers.
```

## 8. Chunk Metadata

Every OCR request must carry local metadata outside the API body.

Recommended internal object:

```ts
type OcrChunk = {
  chunkId: string;
  sourcePdfPath: string;
  chunkPdfPath: string;
  originalPageNumbers: number[];
  firstOriginalPageNumber: number;
  lastOriginalPageNumber: number;
  renderedPageImages: Array<{
    originalPageNumber: number;
    imagePath: string;
    width: number;
    height: number;
    dpi: number;
  }>;
};
```

This metadata is required to:

* Convert chunk-local pages to original PDF pages.
* Match OCR items to rendered page images.
* Crop correct images.
* Save correct `source_page_number` in Wifran.
* Debug OCR failures.

## 9. Structured Output Requirement

The OCR result must be converted into this final top-level shape:

```json
{
  "items": []
}
```

Every item must follow the extraction schema defined in:

```text
project-knowledge/03-leaflet-extraction-rules.md
```

The OCR prompt must require strict JSON.

No markdown.

No prose.

No explanation.

No comments.

No trailing text outside JSON.

## 10. Non-Product Promotional Area Requirement

The OCR must ignore non-product promotional areas.

The OCR must not create product offer rows from:

* Campaign banners.
* Cover graphics.
* Page headers.
* Page footers.
* Supermarket logos.
* Sponsor logos.
* Date badges.
* Decorative balloons or seasonal graphics.
* Generic promotion slogans.
* Generic `1+1` graphics when not attached to a product.
* Text such as `عروض تزين عيدك` or `هنا التوفير` when not attached to a product.
* Page-level date ranges such as `May 27 - June 02`.

A valid row must represent a specific purchasable product offer.

If a page or region contains only campaign/banner content and no product offers, OCR should return:

```json
{
  "items": []
}
```

## 11. `document_annotation_prompt`

Use `document_annotation_prompt` to instruct Mistral to extract offer items from the leaflet.

The prompt must include:

```text
You are extracting supermarket weekly offer items for Wifran.
Return only valid JSON.
Extract every visible product offer item.
Use the exact JSON schema.
Use null for unknown fields.
Do not guess missing prices.
Do not invent brands.
Preserve Arabic text.
Use 1-indexed original PDF page numbers.
Include bounding boxes for item cards.
Bounding boxes must include product image, name, price, and deal label where possible.
Ignore campaign banners, cover graphics, page headers, page footers, supermarket logos, sponsor logos, date badges, decorative graphics, and generic promotion slogans unless they are part of a specific product offer item.
```

The prompt must also include chunk context:

```text
This OCR request contains original PDF page numbers: {page_numbers}.
If the API page index differs from the original PDF page number, use the original PDF page numbers listed above.
```

## 12. Recommended OCR Prompt Template

Use a prompt similar to this:

```text
You are extracting structured supermarket offer data for Wifran, a Saudi grocery savings app.

Return only valid JSON. Do not return markdown, explanation, comments, or text outside JSON.

The document/page chunk contains original PDF page numbers: {{ORIGINAL_PAGE_NUMBERS}}.

Extract every visible supermarket product offer item. Include small items and items near page edges.

Each item must represent one complete product offer block/card, not only a price, only an image, or only a promotion slogan.

Ignore all non-product promotional areas, including:
- campaign banners
- cover graphics
- page headers
- page footers
- supermarket logos
- sponsor logos
- date badges
- decorative balloons or seasonal graphics
- generic promotion slogans
- generic 1+1 graphics when not attached to a specific product
- text such as "عروض تزين عيدك" or "هنا التوفير" when not attached to a specific product
- page date ranges such as "May 27 - June 02"

Only create an item when there is a real purchasable product offer with a product name or product image and an offer price.

For each item, return:
- row_id
- page_number
- product_name_ar
- product_name_en
- brand_name_ar
- brand_name_en
- category_name_ar
- category_name_en
- description_ar
- description_en
- offer_price
- original_price
- discount_text
- pack_size_value
- pack_size_unit
- pack_quantity
- unit_price
- unit_price_unit
- quantity_limit
- is_loyalty_required
- loyalty_notes_ar
- loyalty_notes_en
- notes_ar
- notes_en
- bounding_box
- confidence
- warnings

Rules:
- Use null for unknown optional values.
- Do not guess missing prices.
- Do not invent brands.
- Preserve visible Arabic text exactly as much as possible.
- Preserve visible English text when available.
- Prices must be numeric SAR values.
- Use 1-indexed original PDF page numbers.
- bounding_box must describe the full product item card/block on the rendered page.
- bounding_box must include x, y, width, and height.
- confidence must be between 0 and 1.
- warnings must be an array.

Return this exact top-level shape:
{
  "items": []
}
```

## 13. `document_annotation_format`

Use JSON schema mode if supported by the SDK.

Recommended conceptual format:

```json
{
  "type": "json_schema",
  "json_schema": {
    "name": "wifran_leaflet_offer_items",
    "schema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["items"],
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "row_id",
              "page_number",
              "product_name_ar",
              "product_name_en",
              "brand_name_ar",
              "brand_name_en",
              "category_name_ar",
              "category_name_en",
              "description_ar",
              "description_en",
              "offer_price",
              "original_price",
              "discount_text",
              "pack_size_value",
              "pack_size_unit",
              "pack_quantity",
              "unit_price",
              "unit_price_unit",
              "quantity_limit",
              "is_loyalty_required",
              "loyalty_notes_ar",
              "loyalty_notes_en",
              "notes_ar",
              "notes_en",
              "bounding_box",
              "confidence",
              "warnings"
            ],
            "properties": {
              "row_id": { "type": "string" },
              "page_number": { "type": "integer" },
              "product_name_ar": { "type": ["string", "null"] },
              "product_name_en": { "type": ["string", "null"] },
              "brand_name_ar": { "type": ["string", "null"] },
              "brand_name_en": { "type": ["string", "null"] },
              "category_name_ar": { "type": ["string", "null"] },
              "category_name_en": { "type": ["string", "null"] },
              "description_ar": { "type": ["string", "null"] },
              "description_en": { "type": ["string", "null"] },
              "offer_price": { "type": ["number", "null"] },
              "original_price": { "type": ["number", "null"] },
              "discount_text": { "type": ["string", "null"] },
              "pack_size_value": { "type": ["number", "null"] },
              "pack_size_unit": { "type": ["string", "null"] },
              "pack_quantity": { "type": ["number", "null"] },
              "unit_price": { "type": ["number", "null"] },
              "unit_price_unit": { "type": ["string", "null"] },
              "quantity_limit": { "type": ["string", "null"] },
              "is_loyalty_required": { "type": "boolean" },
              "loyalty_notes_ar": { "type": ["string", "null"] },
              "loyalty_notes_en": { "type": ["string", "null"] },
              "notes_ar": { "type": ["string", "null"] },
              "notes_en": { "type": ["string", "null"] },
              "bounding_box": {
                "type": ["object", "null"],
                "required": ["x", "y", "width", "height"],
                "properties": {
                  "x": { "type": "number" },
                  "y": { "type": "number" },
                  "width": { "type": "number" },
                  "height": { "type": "number" }
                },
                "additionalProperties": false
              },
              "confidence": { "type": ["number", "null"] },
              "warnings": {
                "type": "array",
                "items": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

Antigravity must verify the exact SDK syntax for `document_annotation_format` during implementation.

If JSON schema mode is difficult, use:

```json
{
  "type": "json_object"
}
```

Then validate the result locally with Zod.

## 14. `bbox_annotation_format`

Mistral OCR exposes `bbox_annotation_format`, which can request structured bounding-box annotation output.

For Wifran, bounding boxes are required for item image cropping.

MVP approach:

* First request bounding boxes as part of the item JSON inside `document_annotation`.
* If Mistral SDK/API supports separate `bbox_annotation_format` for richer region output, use it as an enhancement.
* Always normalize final bounding boxes into the Wifran item schema:

```json
{
  "x": 120,
  "y": 450,
  "width": 300,
  "height": 300
}
```

Important:

* The app must validate bounding boxes locally.
* The app must not assume every OCR bounding box is valid.
* The app must not crash when bounding boxes are missing.
* Missing or invalid bounding boxes should mark rows as `needs_review` or `warning`.
* Bounding boxes for non-product banners must not be cropped as offer images.

## 15. Expected OCR Response Fields

A successful Mistral OCR response can include:

```text
model
pages
document_annotation
usage_info
```

The `pages` array can include page OCR information such as:

```text
index
markdown
images
dimensions
```

The `dimensions` object may include:

```text
dpi
height
width
```

The app should preserve useful response data in debug logs or import rows where appropriate.

## 16. Parsing `document_annotation`

Mistral returns `document_annotation` as a formatted response, commonly a JSON string when structured output is requested.

The app must:

1. Confirm `document_annotation` exists.
2. Parse it as JSON if it is a string.
3. Validate it against the local Zod schema.
4. Normalize the result into `{ items: [] }`.
5. Add chunk metadata such as original page numbers if missing.
6. Remove or mark non-product promotional rows.
7. Save raw response and parsed item JSON in `import_rows.raw_data`.

If parsing fails:

* Record `OCR_JSON_PARSE_ERROR`.
* Save raw `document_annotation` locally.
* Mark the chunk as failed.
* Allow retry.

## 17. Using Page Markdown

The Mistral response also includes page-level markdown OCR text.

The app may store markdown for debugging.

Do not use page markdown as final extraction data unless:

* `document_annotation` failed, and
* a fallback extraction path is explicitly implemented.

MVP recommendation:

* Use `document_annotation` as the source of structured items.
* Store page markdown only for debugging and troubleshooting.

## 18. Confidence Scores

Mistral supports `confidence_scores_granularity` values such as:

```text
word
page
```

Recommended MVP:

```text
confidence_scores_granularity = page
```

Reason:

* Smaller payload than word-level confidence.
* Enough to detect low-quality pages/chunks.

Future enhancement:

```text
confidence_scores_granularity = word
```

Use word confidence only if needed for detailed validation, because it may produce larger responses.

## 19. Header and Footer Extraction

Set:

```json
{
  "extract_header": false,
  "extract_footer": false
}
```

Reason:

* Supermarket leaflets may have headers and footers unrelated to individual offers.
* The extractor’s job is item-level product offers, not generic document metadata.
* Headers and footers may contain campaign slogans that should not become offers.

If later a supermarket leaflet uses header/footer dates or campaign names, this can be revisited.

## 20. Table Format

Set:

```json
{
  "table_format": "markdown"
}
```

Reason:

* Markdown is easier to inspect and debug if Mistral detects table-like structures.
* The final extraction should still come from `document_annotation`, not table markdown.

## 21. Image Extraction Fields

Mistral OCR can return extracted images from pages, and response image objects may include coordinates such as top-left and bottom-right values.

For Wifran MVP:

```json
{
  "include_image_base64": false
}
```

Reason:

* Wifran does local page rendering and local item cropping.
* The app does not need Mistral to return base64 images.
* Avoid bloated OCR responses.
* Avoid unnecessary network payload.

Recommended:

```text
include_image_base64 = false
image_limit = null
image_min_size = null
```

The app should rely on its own rendered page images and OCR product item bounding boxes.

## 22. Bounding Box Coordinate Standard

The final normalized bounding boxes must use pixel coordinates relative to the locally rendered page image.

Final Wifran shape:

```json
{
  "x": 120,
  "y": 450,
  "width": 300,
  "height": 300
}
```

Coordinate origin:

```text
top-left corner of rendered page image
```

Axes:

```text
x increases to the right
y increases downward
```

Units:

```text
pixels
```

## 23. Coordinate Conversion Rules

OCR may return bounding boxes in different forms.

The app must normalize all supported forms into `x`, `y`, `width`, `height`.

## 23.1 Already Pixel-Based

Input:

```json
{
  "x": 120,
  "y": 450,
  "width": 300,
  "height": 300
}
```

Output:

```json
{
  "x": 120,
  "y": 450,
  "width": 300,
  "height": 300
}
```

## 23.2 Top-Left and Bottom-Right

Input:

```json
{
  "top_left_x": 120,
  "top_left_y": 450,
  "bottom_right_x": 420,
  "bottom_right_y": 750
}
```

Output:

```json
{
  "x": 120,
  "y": 450,
  "width": 300,
  "height": 300
}
```

Formula:

```text
width = bottom_right_x - top_left_x
height = bottom_right_y - top_left_y
```

## 23.3 Normalized Coordinates

Input:

```json
{
  "x": 0.1,
  "y": 0.2,
  "width": 0.25,
  "height": 0.15
}
```

If page image is:

```text
width = 2000 px
height = 3000 px
```

Output:

```json
{
  "x": 200,
  "y": 600,
  "width": 500,
  "height": 450
}
```

Formula:

```text
x_px = x * page_width
y_px = y * page_height
width_px = width * page_width
height_px = height * page_height
```

## 23.4 Polygon Coordinates

Input:

```json
{
  "polygon": [
    { "x": 120, "y": 450 },
    { "x": 420, "y": 450 },
    { "x": 420, "y": 750 },
    { "x": 120, "y": 750 }
  ]
}
```

Output:

```json
{
  "x": 120,
  "y": 450,
  "width": 300,
  "height": 300
}
```

Formula:

```text
x = min(all x values)
y = min(all y values)
width = max(all x values) - min(all x values)
height = max(all y values) - min(all y values)
```

## 24. Bounding Box Validation

Every normalized bounding box must be validated against the rendered page dimensions.

A valid bounding box must satisfy:

```text
x >= 0
y >= 0
width > 0
height > 0
x + width <= page_width
y + height <= page_height
```

If a box is slightly out of bounds, clamp it to the page boundaries and add warning:

```text
BOUNDING_BOX_CLAMPED
```

If a box is impossible or too small, mark invalid.

Recommended too-small threshold:

```text
width < 40 px OR height < 40 px
```

Warning/error:

```text
BOUNDING_BOX_TOO_SMALL
```

If a box covers nearly the whole page, mark warning:

```text
BOUNDING_BOX_TOO_LARGE
```

Suggested threshold:

```text
box_area > 70% of page_area
```

Very large boxes are often campaign banners, cover pages, or page-wide promotional headers. Such rows must also be checked for `NON_PRODUCT_PROMOTIONAL_AREA`.

## 25. Cropping Padding

Before cropping, add safe padding.

Recommended:

```text
5% to 10% of bounding box width and height
```

Default:

```text
8%
```

Formula:

```text
pad_x = width * 0.08
pad_y = height * 0.08
```

Clamp final crop area to page boundaries.

Do not allow padding to include too much neighboring content.

Do not crop images for rows classified as non-product promotional areas.

## 26. OCR Chunking Rules

Do not send the whole leaflet in one OCR request by default.

Default:

```text
OCR_CHUNK_SIZE=2
```

Allowed range:

```text
1 to 3 pages
```

Why:

* Avoid output truncation.
* Improve focus on each page.
* Reduce skipped product items.
* Make retries easier.
* Avoid mixing prices/items across distant pages.
* Reduce chance of campaign banners being treated as products.

For very dense leaflets, use 1 page per request.

For light leaflets, 2 or 3 pages may be acceptable.

## 27. OCR Concurrency Rules

Use controlled concurrency.

Default:

```text
OCR_MAX_CONCURRENT_REQUESTS=3
```

Allowed practical range:

```text
1 to 4
```

Do not use unbounded `Promise.all()` across all chunks.

Use a limiter such as:

```text
p-limit
```

Behavior:

* Start up to configured concurrent requests.
* Queue remaining chunks.
* Retry transient failures.
* Stop only on fatal global errors such as missing API key.

## 28. Retry Rules

Retry temporary errors.

Retryable errors:

```text
HTTP 408
HTTP 409
HTTP 425
HTTP 429
HTTP 500
HTTP 502
HTTP 503
HTTP 504
network timeout
connection reset
```

Do not retry:

```text
HTTP 400
HTTP 401
HTTP 403
invalid API key
invalid request schema
unsupported file format
```

Default:

```text
OCR_MAX_RETRIES=3
OCR_RETRY_BASE_DELAY_MS=1000
```

Use exponential backoff:

```text
delay = baseDelayMs * 2^(attempt - 1)
```

Add jitter.

Example:

```text
attempt 1 -> about 1000 ms
attempt 2 -> about 2000 ms
attempt 3 -> about 4000 ms
```

For HTTP 429, respect `Retry-After` header if present.

## 29. Timeout Rules

Default OCR timeout:

```text
OCR_REQUEST_TIMEOUT_MS=120000
```

If a request times out:

* Mark chunk attempt as failed.
* Retry if attempts remain.
* If all attempts fail, mark chunk failed.
* Continue with other chunks if possible.

## 30. OCR Result Storage

For each OCR chunk, preserve:

```text
chunk_id
original_page_numbers
request started timestamp
request completed timestamp
model
raw response
document_annotation raw string
parsed JSON
page markdown, if useful
usage_info
errors
```

Raw OCR responses should be saved locally during processing and/or in `import_rows.raw_data`.

Do not store secrets.

## 31. OCR Usage Info

The Mistral OCR response includes `usage_info`.

The app should capture it for logs if available.

Useful fields may include:

```text
pages_processed
doc_size_bytes
```

Exact fields depend on Mistral response.

Use this for:

* Debugging.
* Cost estimation.
* Import summary.
* Future analytics.

Do not let missing usage info fail the import.

## 32. OCR Client Interface

Antigravity should implement a provider abstraction.

Recommended TypeScript interface:

```ts
export type OcrProviderName = 'mistral';

export type OcrChunkInput = {
  chunkId: string;
  chunkPdfPath: string;
  originalPageNumbers: number[];
  renderedPages: Array<{
    pageNumber: number;
    imagePath: string;
    width: number;
    height: number;
    dpi: number;
  }>;
};

export type OcrExtractedDocument = {
  provider: OcrProviderName;
  model: string;
  chunkId: string;
  originalPageNumbers: number[];
  rawResponse: unknown;
  items: OcrExtractedItem[];
  usageInfo?: unknown;
};

export interface OcrProvider {
  extractOffersFromChunk(input: OcrChunkInput): Promise<OcrExtractedDocument>;
}
```

This allows adding Gemini or Google Document AI later without rewriting the rest of the pipeline.

## 33. Local Validation After OCR

Even if JSON schema mode is used, the app must validate OCR output locally.

Use Zod or equivalent.

Validate:

```text
top-level object
items array
field types
page_number
price values
pack_quantity
confidence range
warnings array
bounding_box shape
non-product promotional area detection
```

Do not trust OCR output blindly.

## 34. JSON Repair Policy

The first version should not rely heavily on JSON repair.

Preferred:

* Use Mistral JSON schema mode.
* If parsing fails, retry the OCR request once with a stricter prompt.
* If still invalid, mark chunk as failed.

Optional future enhancement:

* Safe JSON repair for common minor formatting issues.
* Record warning `OCR_JSON_REPAIRED`.

Do not silently repair heavily broken JSON and treat it as reliable.

## 35. Fallback Strategy

If `document_annotation` is missing or invalid:

1. Retry the OCR request.
2. If retry fails, save chunk failure.
3. Show failed chunk in UI.
4. Allow user to retry the chunk later.
5. Do not fabricate items from page markdown unless a specific fallback extractor is implemented.

## 36. Logging Rules

Log:

```text
OCR request started
OCR request completed
chunk_id
original_page_numbers
duration_ms
attempt_number
retry_delay
HTTP status if available
number of extracted items
number of skipped non-product promotional rows
parse success/failure
validation warnings/errors
```

Do not log:

```text
MISTRAL_API_KEY
full Authorization header
signed document URLs
large base64 file payloads
large raw response bodies in console
```

Raw responses may be saved to controlled local debug files if debug mode is enabled.

## 37. Renderer/Main Process Boundary

OCR must run in the Electron main process or protected backend layer.

Renderer responsibilities:

* Display selected PDF.
* Display progress.
* Request start extraction.
* Show results.

Main process responsibilities:

* Read environment variables.
* Hold `MISTRAL_API_KEY`.
* Split PDF.
* Call Mistral OCR.
* Parse and validate response.
* Filter non-product promotional rows.
* Return safe progress/results to renderer.

Renderer must never receive the API key.

## 38. Expected Failure Modes

The OCR layer must handle:

```text
missing MISTRAL_API_KEY
invalid MISTRAL_API_KEY
network unavailable
API timeout
rate limit
invalid file/chunk
unsupported document format
empty OCR response
invalid document_annotation JSON
schema mismatch
missing bounding boxes
wrong page numbers
duplicated row IDs
too many items causing response truncation
campaign banner extracted as fake product
```

Each failure should produce a clear internal error code and user-readable message.

## 39. User-Facing OCR Error Messages

Examples:

```text
OCR API key is missing. Add MISTRAL_API_KEY in settings or .env.local.
Mistral rejected the request. Check the OCR model and request format.
OCR request timed out for pages 5-6. You can retry this chunk.
OCR response for pages 7-8 was not valid JSON.
OCR completed, but some rows are missing item image boxes and need review.
Some page banners were ignored because they are not product offers.
```

## 40. MVP Implementation Notes

Antigravity should implement the OCR module incrementally:

1. Create OCR provider interface.
2. Create Mistral OCR provider.
3. Load Mistral config from environment/settings.
4. Add one test call using a single PDF chunk.
5. Parse `document_annotation`.
6. Validate parsed JSON with Zod.
7. Add non-product promotional row detection.
8. Add controlled concurrency.
9. Add retry handling.
10. Add chunk-level progress events.
11. Connect OCR result to import rows.

Do not build database sync before OCR output validation exists.

## 41. What Antigravity Must Not Do

Antigravity must not:

* Hardcode the Mistral API key.
* Expose the Mistral API key in renderer code.
* Send the entire 72-page leaflet in one OCR request by default.
* Use unlimited concurrent OCR calls.
* Trust OCR JSON without local validation.
* Ignore non-product promotional/banner filtering.
* Create offers from campaign banners or cover graphics.
* Ignore Mistral page index versus original PDF page number.
* Assume bounding boxes are always pixel coordinates.
* Assume bounding boxes always match local rendered page dimensions.
* Use Mistral-returned image base64 as the primary item image source.
* Crash the whole import because one OCR chunk fails.
* Hide failed chunks from the operator.
* Log secrets or signed URLs.

## 42. Final Principle

Mistral OCR is responsible for reading leaflet pages and producing structured extraction data.

The Wifran Offers Extractor is responsible for controlling chunking, preserving original page numbers, validating OCR output, filtering non-product promotional areas, normalizing bounding boxes, cropping product item images locally, and safely syncing valid records into Wifran.
