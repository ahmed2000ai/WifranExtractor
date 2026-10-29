# Antigravity Prompt Chunk 08: Mistral OCR Integration With Structured Output

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 08. Prompt Chunks 01 to 07 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, validated import form, local PDF preprocessing, and shared OCR schemas/fixtures/validation.

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

Implement the first real Mistral OCR integration.

This chunk should allow the app to send **one preprocessed PDF chunk** to Mistral OCR using:

```text
model: mistral-ocr-latest
endpoint: https://api.mistral.ai/v1/ocr
```

The OCR request must ask Mistral to return structured product offer JSON using the extraction schema from the project knowledge files.

This chunk should:

```text
create a Mistral OCR provider
build the structured OCR prompt
build the document annotation format
send one PDF chunk to Mistral OCR
parse document_annotation
validate the response with the existing Zod schema
normalize extracted rows
save raw OCR debug output locally when debug mode is enabled
show the OCR test result in the UI
```

This chunk is only for **single-chunk OCR testing**.

Do **not** implement full multi-chunk OCR concurrency yet.

Do **not** implement retries/concurrency pipeline yet.

Do **not** create `offer_sources` yet.

Do **not** create `import_batches` yet.

Do **not** insert `import_rows` yet.

Do **not** insert `offers` yet.

Do **not** upload images yet.

Do **not** crop item images yet.

Do **not** add database migrations.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/main/ocr/ocrTypes.ts
src/main/ocr/ocrPromptBuilder.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/ocrDebugStorage.ts
src/main/ipc/ocrIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/ocrJob.ts
src/shared/types/preload.ts
src/renderer/hooks/useOcrTest.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
```

Adapt paths if the existing structure differs, but preserve responsibilities.

## 4. Required Package / SDK

Use the official Mistral TypeScript SDK if practical.

Recommended package:

```text
@mistralai/mistralai
```

If the official SDK makes file upload or OCR request handling unclear, use a direct `fetch` implementation against:

```text
https://api.mistral.ai/v1/ocr
```

But before finalizing, inspect the installed SDK types or official docs available to the coding environment.

Important:

* The request shape must match the actual SDK/API contract.
* Do not rely blindly on placeholder examples from documentation files.
* Keep the Mistral call isolated in `mistralOcrProvider.ts` so it can be corrected or swapped later.

## 5. Main Process Only

All Mistral API calls must happen in the Electron main process.

The renderer must not receive:

```text
MISTRAL_API_KEY
Authorization header
raw API client
raw environment variables
```

The renderer may request a safe OCR test through a narrow IPC method.

## 6. OCR Provider Types

Create:

```text
src/main/ocr/ocrTypes.ts
```

Define main-process OCR provider types.

Recommended:

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
  workspacePath?: string;
};

export type OcrExtractedDocument = {
  provider: OcrProviderName;
  model: string;
  chunkId: string;
  originalPageNumbers: number[];
  rawResponse: unknown;
  rawDocumentAnnotation: unknown;
  items: unknown[];
  normalizedRows: unknown[];
  usageInfo?: unknown;
};

export interface OcrProvider {
  extractOffersFromChunk(input: OcrChunkInput): Promise<OcrExtractedDocument>;
}
```

If shared OCR types already exist from Prompt Chunk 07, import and use them instead of duplicating.

## 7. Shared OCR Job Types

Create:

```text
src/shared/types/ocrJob.ts
```

Define renderer-safe types for starting a single OCR test.

Recommended:

```ts
export type OcrSingleChunkTestInput = {
  workspacePath: string;
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

export type OcrSingleChunkTestResult = {
  ok: boolean;
  provider?: 'mistral';
  model?: string;
  chunkId?: string;
  originalPageNumbers?: number[];
  extractedItemCount?: number;
  normalizedRowCount?: number;
  skippedPromotionalRowCount?: number;
  warningRowCount?: number;
  errorRowCount?: number;
  normalizedRows?: unknown[];
  debugFilePath?: string | null;
  usageInfo?: unknown;
  error?: {
    code: string;
    message: string;
  };
};
```

Do not include secrets.

## 8. OCR Prompt Builder

Create:

```text
src/main/ocr/ocrPromptBuilder.ts
```

Implement a function such as:

```ts
export function buildWifranLeafletExtractionPrompt(input: {
  originalPageNumbers: number[];
}): string;
```

The prompt must include the rules from:

```text
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
```

The prompt must explicitly say:

```text
Return only valid JSON.
Do not return markdown.
Do not include explanation.
Use null for unknown values.
Extract every visible supermarket product offer item.
Ignore campaign banners, cover graphics, page headers, page footers, supermarket logos, sponsor logos, date badges, decorative graphics, and generic promotion slogans unless they are part of a specific product offer item.
Do not create rows from generic 1+1 banners.
Do not create rows from text like عروض تزين عيدك or هنا التوفير unless attached to a specific product offer.
Only create an item when there is a real purchasable product offer with product name or product image and offer price.
Use 1-indexed original PDF page numbers.
The original PDF page numbers in this request are: {page_numbers}.
Include bounding_box for every product offer item when possible.
bounding_box must cover the full product item card/block.
```

The prompt must require this top-level shape:

```json
{
  "items": []
}
```

## 9. Document Annotation Format

Create a function such as:

```ts
export function buildWifranDocumentAnnotationFormat(): unknown;
```

It should build the Mistral `document_annotation_format` using JSON schema mode if supported.

Use the schema from the knowledge docs and Prompt Chunk 07.

If the SDK/API does not accept the exact JSON schema shape, fall back to a supported JSON object mode, but keep local Zod validation afterward.

Important:

* The app must locally validate the result with Zod even if Mistral schema mode is used.
* Do not trust OCR output blindly.

## 10. Mistral OCR Provider

Create:

```text
src/main/ocr/mistralOcrProvider.ts
```

Implement:

```ts
export class MistralOcrProvider implements OcrProvider {
  async extractOffersFromChunk(input: OcrChunkInput): Promise<OcrExtractedDocument>;
}
```

Responsibilities:

1. Load Mistral config from main-process config.
2. Validate `MISTRAL_API_KEY` exists before calling.
3. Use model `mistral-ocr-latest` from config.
4. Submit the chunk PDF to Mistral OCR.
5. Include `document_annotation_prompt`.
6. Include `document_annotation_format`.
7. Set useful OCR options:

   * `confidence_scores_granularity`
   * `table_format`
   * `extract_header = false`
   * `extract_footer = false`
   * `include_image_base64 = false` if supported.
8. Parse `document_annotation`.
9. Validate with shared Zod schema.
10. Normalize rows with Prompt Chunk 07 normalization helper.
11. Return safe extracted document result.

## 11. File Input Strategy

Use the most reliable Mistral-supported strategy available in the SDK/API.

Preferred order:

### Option A: Mistral file upload + OCR file reference

If the SDK supports file upload and using a returned file ID/signed URL/reference for OCR, use that.

### Option B: Direct file/document input

If the OCR endpoint supports direct base64/file input through the SDK, use that.

### Option C: Temporary signed URL

If the local app cannot send the file directly, document the limitation and prepare the provider to accept a document URL later. Do not implement Supabase signed URL upload yet in this chunk unless unavoidable.

Important:

* Do not invent an API request shape without checking the actual SDK/API types.
* Keep the implementation isolated so it can be fixed easily if Mistral SDK changes.

## 12. Parsing `document_annotation`

The OCR response may return `document_annotation` as:

```text
string
object
null/undefined
```

Implement robust parsing:

```ts
function parseDocumentAnnotation(value: unknown): unknown
```

Rules:

* If string, parse JSON.
* If object, use directly.
* If missing, return OCR error.
* If JSON parse fails, return OCR error.
* Do not silently accept non-JSON prose.

Error code:

```text
OCR_JSON_PARSE_ERROR
```

## 13. Expected Result Handling

After parsing, call the Prompt Chunk 07 normalization helper.

The returned result should include counts:

```text
extractedItemCount
normalizedRowCount
skippedPromotionalRowCount
warningRowCount
errorRowCount
```

Promotional/banner rows must be skipped if detected.

If Mistral returns a cover/banner-only page as:

```json
{
  "items": []
}
```

that is valid and should not be treated as an OCR failure.

## 14. OCR Debug Storage

Create:

```text
src/main/ocr/ocrDebugStorage.ts
```

If `DEBUG_SAVE_INTERMEDIATE_FILES=true`, save raw OCR response and parsed document annotation under:

```text
{workspacePath}/ocr/{chunkId}-raw-response.json
{workspacePath}/ocr/{chunkId}-document-annotation.json
{workspacePath}/ocr/{chunkId}-normalized-rows.json
```

Rules:

* Do not save API keys.
* Do not save Authorization headers.
* Avoid saving huge base64 payloads.
* Ensure the `ocr/` folder exists.
* Return `debugFilePath` or debug folder path in the safe result if useful.

If debug mode is false, do not save raw OCR debug files.

## 15. IPC Requirements

Create:

```text
src/main/ipc/ocrIpc.ts
```

Add narrow IPC handler:

```text
ocr:testSingleChunk
```

Input:

```ts
OcrSingleChunkTestInput
```

Output:

```ts
OcrSingleChunkTestResult
```

Validation:

* Confirm config is valid enough for Mistral.
* Confirm chunk path exists.
* Confirm chunk path is a PDF.
* Confirm `originalPageNumbers` exists and is not empty.
* Confirm rendered page metadata exists if available.

Do not create generic OCR or network IPC.

Forbidden:

```text
ocr:callRaw
http:fetch
config:getMistralApiKey
```

Update:

```text
src/main/ipc/registerIpcHandlers.ts
```

to register the OCR IPC handler.

## 16. Preload API Requirements

Update preload to expose:

```ts
window.wifranExtractor.ocr = {
  testSingleChunk: (
    input: OcrSingleChunkTestInput
  ) => Promise<OcrSingleChunkTestResult>
};
```

Do not expose raw `ipcRenderer`.

Do not expose API keys.

## 17. Renderer Hook

Create:

```text
src/renderer/hooks/useOcrTest.ts
```

Responsibilities:

* Start OCR test for a selected chunk.
* Track running/loading state.
* Store result.
* Store error.
* Provide reset function.

Recommended return shape:

```ts
{
  running: boolean;
  result: OcrSingleChunkTestResult | null;
  error: string | null;
  runSingleChunkTest: (input: OcrSingleChunkTestInput) => Promise<void>;
  reset: () => void;
}
```

## 18. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

After PDF preprocessing has completed, show a new section:

```text
OCR Test
```

This section should:

* List available chunks from the preprocess result.
* Let the operator choose one chunk.
* Default to the first chunk.
* Provide a button: `Test OCR on Selected Chunk`.
* Disable the button if Mistral config is missing.
* Show running state.
* Show extracted item count.
* Show skipped promotional row count.
* Show warning/error row count.
* Show debug file path if available.
* Show safe error messages.

This is only a test of one chunk.

Do not run OCR for all chunks yet.

## 19. Results Page Integration

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Show the latest OCR test normalized rows if available in local state or via hook structure.

At minimum, display:

```text
Row ID
Page
Product Arabic
Product English
Offer Price
Status
Issues
```

Do not connect to database.

Do not create offers.

## 20. Logs Page Integration

Update Logs page to show OCR test events/messages if the app already has in-memory logs.

Example messages:

```text
Starting Mistral OCR test for chunk-001.
Mistral OCR completed for chunk-001.
Parsed document_annotation successfully.
Extracted 12 items.
Skipped 1 promotional/banner row.
```

Do not log API keys.

## 21. Error Handling

Handle:

```text
missing MISTRAL_API_KEY
invalid MISTRAL_OCR_ENDPOINT
chunk file missing
chunk file not PDF
Mistral request failed
HTTP 400/401/403/429/500
network timeout
missing document_annotation
invalid JSON document_annotation
schema validation failure
normalization failure
```

Use safe error codes:

```text
MISSING_MISTRAL_API_KEY
OCR_API_ERROR
OCR_RATE_LIMIT
OCR_TIMEOUT
OCR_EMPTY_RESPONSE
OCR_JSON_PARSE_ERROR
OCR_SCHEMA_VALIDATION_ERROR
OCR_ITEM_PARSE_FAILED
```

Do not show raw secret values.

## 22. Timeout

Use `OCR_REQUEST_TIMEOUT_MS` from config if using fetch.

If using SDK and timeout is not straightforward, document limitation and wrap with an abort controller if practical.

Default timeout:

```text
120000 ms
```

## 23. README Update

Update README with:

* Mistral OCR single-chunk test added.
* Required Mistral env variables.
* How to test OCR after PDF preprocessing.
* Warning that full OCR pipeline/concurrency is not implemented yet.
* Warning that database sync is not implemented yet.
* Reminder that OCR keys stay in main process only.

## 24. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real Mistral or Supabase keys.
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
* Do not create offers from banners or promotional areas.

## 25. Autonomy Rule

Proceed with all code/file changes required for this chunk without asking me for intermediate approvals or confirmations. Only stop to ask if an action is destructive, irreversible, requires real credentials/secrets, changes the database schema, deletes data, or goes outside the scope of this chunk.

## 26. Acceptance Criteria

This chunk is complete when:

* Mistral OCR provider exists in main process.
* OCR prompt builder includes strict Wifran extraction rules.
* Prompt explicitly ignores non-product promotional/banner areas.
* OCR request uses `mistral-ocr-latest`.
* OCR request includes structured `document_annotation_prompt`.
* OCR request attempts JSON-structured `document_annotation_format`.
* App can run OCR on one preprocessed PDF chunk.
* `document_annotation` is parsed safely.
* Parsed OCR output is validated with existing Zod schema.
* OCR rows are normalized with existing normalization helper.
* Promotional/banner rows are skipped.
* Debug output is saved only when debug mode is enabled.
* Renderer can trigger only the safe single-chunk OCR test.
* Renderer never sees Mistral API key.
* Results page can show latest OCR test rows or summary.
* No database writes or offer sync are implemented.
* TypeScript compiles.
* App still starts.

## 27. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* Which Mistral SDK/API strategy was used.
* How `document_annotation` is parsed.
* How OCR output is validated and normalized.
* How promotional/banner rows are skipped.
* How to test OCR on a preprocessed chunk.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.