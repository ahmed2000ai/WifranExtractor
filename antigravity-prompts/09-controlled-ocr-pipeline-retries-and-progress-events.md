# Antigravity Prompt Chunk 09: Controlled OCR Pipeline, Retries, and Progress Events

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 09. Prompt Chunks 01 to 08 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, validated import form, local PDF preprocessing, shared OCR schemas/fixtures/validation, and a single-chunk Mistral OCR test.

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

Implement the full OCR processing layer across all preprocessed PDF chunks.

This chunk should expand the single-chunk OCR test into a controlled multi-chunk OCR pipeline that can:

```text
run OCR across all PDF chunks
limit concurrent OCR requests
retry transient OCR/network failures
track chunk-level progress
track chunk-level success/failure
continue when one chunk fails
aggregate normalized rows
count valid, warning, error, and skipped rows
emit progress events to renderer
show OCR pipeline results in the UI
```

This chunk must not sync anything to the Wifran database yet.

Do **not** create `offer_sources` yet.

Do **not** create `import_batches` yet.

Do **not** insert `import_rows` yet.

Do **not** insert `offers` yet.

Do **not** upload images yet.

Do **not** crop item images yet.

Do **not** implement brand/category/product matching yet.

Do **not** add database migrations.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/main/ocr/ocrPipelineTypes.ts
src/main/ocr/ocrRetry.ts
src/main/ocr/ocrConcurrency.ts
src/main/ocr/ocrPipelineService.ts
src/main/ocr/ocrDebugStorage.ts
src/main/ipc/ocrIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/ocrJob.ts
src/shared/types/preload.ts
src/renderer/hooks/useOcrPipeline.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve these responsibilities.

## 4. Required Package

Use a concurrency limiter.

Recommended package:

```text
p-limit
```

If not already installed, install it.

Do not use unbounded `Promise.all()` for all chunks.

## 5. Main Process Only

All OCR pipeline execution must happen in the Electron main process.

The renderer must not receive:

```text
MISTRAL_API_KEY
Authorization header
raw Mistral client
raw environment variables
```

The renderer may request OCR processing through a narrow IPC method.

## 6. OCR Pipeline Shared Types

Update:

```text
src/shared/types/ocrJob.ts
```

Add renderer-safe OCR pipeline types.

Recommended:

```ts
export type OcrPipelineInput = {
  workspacePath: string;
  chunks: Array<{
    chunkId: string;
    chunkIndex: number;
    chunkPdfPath: string;
    originalPageNumbers: number[];
    firstOriginalPageNumber: number;
    lastOriginalPageNumber: number;
  }>;
  renderedPages: Array<{
    pageNumber: number;
    imagePath: string;
    width: number;
    height: number;
    dpi: number;
  }>;
};

export type OcrPipelineProgressStage =
  | 'started'
  | 'chunk_queued'
  | 'chunk_started'
  | 'chunk_retrying'
  | 'chunk_completed'
  | 'chunk_failed'
  | 'normalizing'
  | 'completed'
  | 'partially_completed'
  | 'failed';

export type OcrPipelineProgressEvent = {
  stage: OcrPipelineProgressStage;
  message: string;
  chunkId?: string;
  current?: number;
  total?: number;
  details?: Record<string, unknown>;
};

export type OcrChunkRunStatus =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed';

export type OcrChunkRunSummary = {
  chunkId: string;
  chunkIndex: number;
  originalPageNumbers: number[];
  status: OcrChunkRunStatus;
  attempts: number;
  durationMs?: number;
  extractedItemCount: number;
  normalizedRowCount: number;
  skippedPromotionalRowCount: number;
  warningRowCount: number;
  errorRowCount: number;
  debugFilePath?: string | null;
  error?: {
    code: string;
    message: string;
  };
};

export type OcrPipelineResult = {
  ok: boolean;
  status: 'completed' | 'partially_completed' | 'failed';
  provider: 'mistral';
  model: string;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  totalExtractedItems: number;
  totalNormalizedRows: number;
  validRowCount: number;
  warningRowCount: number;
  errorRowCount: number;
  skippedRowCount: number;
  skippedPromotionalRowCount: number;
  chunks: OcrChunkRunSummary[];
  normalizedRows: unknown[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error?: {
    code: string;
    message: string;
  };
};
```

Do not include secrets in these types.

## 7. OCR Pipeline Main Types

Create:

```text
src/main/ocr/ocrPipelineTypes.ts
```

This can import renderer-safe shared types and add main-process-only helper types if needed.

Do not duplicate shared types unless necessary.

## 8. Retry Utility

Create:

```text
src/main/ocr/ocrRetry.ts
```

Implement retry helper functions.

Required behavior:

### Retryable errors

Retry these:

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
temporary network error
```

### Non-retryable errors

Do not retry these:

```text
HTTP 400
HTTP 401
HTTP 403
invalid API key
missing API key
invalid request schema
unsupported file format
invalid chunk path
```

### Backoff

Use exponential backoff:

```text
delay = OCR_RETRY_BASE_DELAY_MS * 2^(attempt - 1)
```

Add jitter.

For HTTP `429`, respect `Retry-After` header if available.

Default values should come from config:

```text
OCR_MAX_RETRIES=3
OCR_RETRY_BASE_DELAY_MS=1000
OCR_REQUEST_TIMEOUT_MS=120000
```

Recommended exported functions:

```ts
export function isRetryableOcrError(error: unknown): boolean;

export function getRetryDelayMs(input: {
  attempt: number;
  baseDelayMs: number;
  retryAfterMs?: number | null;
}): number;

export async function runWithOcrRetry<T>(input: {
  operation: () => Promise<T>;
  maxRetries: number;
  baseDelayMs: number;
  onRetry?: (event: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
}): Promise<{
  result: T;
  attempts: number;
}>;
```

## 9. Concurrency Utility

Create:

```text
src/main/ocr/ocrConcurrency.ts
```

Use `p-limit` or equivalent.

Default:

```text
OCR_MAX_CONCURRENT_REQUESTS=3
```

Allowed range:

```text
1 to 4
```

Clamp invalid config or fail validation according to the existing config rules.

Do not use unbounded concurrency.

## 10. OCR Pipeline Service

Create:

```text
src/main/ocr/ocrPipelineService.ts
```

Implement:

```ts
export async function runOcrPipeline(
  input: OcrPipelineInput,
  onProgress?: (event: OcrPipelineProgressEvent) => void
): Promise<OcrPipelineResult>;
```

Responsibilities:

1. Validate Mistral config.
2. Validate input workspace path.
3. Validate chunks array.
4. Validate chunk PDF paths.
5. Validate original page numbers.
6. Validate rendered page metadata.
7. Create Mistral OCR provider.
8. Run OCR for chunks with controlled concurrency.
9. Retry transient failures.
10. Save debug outputs when configured.
11. Aggregate normalized rows.
12. Count statuses.
13. Build chunk summaries.
14. Return a full `OcrPipelineResult`.
15. Emit safe progress events.

## 11. Chunk Processing Rules

For each chunk:

1. Mark as queued.
2. Mark as started.
3. Call existing `MistralOcrProvider.extractOffersFromChunk`.
4. Normalize rows using existing normalization.
5. Count:

   * extracted items
   * normalized rows
   * skipped promotional rows
   * warning rows
   * error rows
6. Save debug files if enabled.
7. Mark completed.
8. If failed after retries, mark failed and continue other chunks.

Important:

* One failed chunk should not fail the whole OCR pipeline if other chunks succeed.
* If all chunks fail, pipeline status should be `failed`.
* If some chunks fail and some succeed, pipeline status should be `partially_completed`.
* If all chunks succeed, pipeline status should be `completed`.

## 12. Promotional/Banner Row Handling

The OCR normalization from Prompt Chunk 07 should already classify promotional/banner rows.

The pipeline must aggregate these counts:

```text
skippedPromotionalRowCount
skippedRowCount
```

Rules:

* Do not treat skipped promotional rows as OCR failures.
* Do not crop images for skipped promotional rows.
* Do not sync skipped promotional rows later.
* Do not create products/brands/offers for skipped promotional rows later.
* Count them visibly in the result summary.

## 13. Cover/Banner-Only Pages

If a chunk returns:

```json
{
  "items": []
}
```

This can be valid.

Rules:

* Treat as completed OCR chunk with zero rows.
* Do not mark chunk failed only because it extracted zero items.
* In the final summary, zero-row chunks should be visible.
* If every chunk returns zero rows, pipeline may still complete technically, but show warning:

  * `OCR_EMPTY_RESPONSE`
  * `No product offer items were found.`

## 14. Error Codes

Use consistent error codes.

Required OCR/pipeline error codes:

```text
MISSING_MISTRAL_API_KEY
OCR_API_ERROR
OCR_RATE_LIMIT
OCR_TIMEOUT
OCR_EMPTY_RESPONSE
OCR_JSON_PARSE_ERROR
OCR_SCHEMA_VALIDATION_ERROR
OCR_ITEM_PARSE_FAILED
OCR_CHUNK_FAILED
OCR_PIPELINE_FAILED
OCR_ALL_CHUNKS_FAILED
```

Do not include raw stack traces in renderer results.

## 15. Progress Events

Emit progress events during the pipeline.

Examples:

```ts
onProgress?.({
  stage: 'started',
  message: 'Starting OCR pipeline.',
  current: 0,
  total: chunks.length
});

onProgress?.({
  stage: 'chunk_started',
  chunkId: 'chunk-001',
  message: 'Running OCR for chunk-001.',
  current: 1,
  total: chunks.length
});

onProgress?.({
  stage: 'chunk_retrying',
  chunkId: 'chunk-001',
  message: 'Retrying OCR for chunk-001 after temporary error.',
  details: { attempt: 2, delayMs: 2000 }
});

onProgress?.({
  stage: 'chunk_completed',
  chunkId: 'chunk-001',
  message: 'OCR completed for chunk-001.',
  current: 1,
  total: chunks.length
});

onProgress?.({
  stage: 'partially_completed',
  message: 'OCR completed with some failed chunks.',
  current: completedChunks,
  total: chunks.length
});
```

Do not include secrets in `details`.

## 16. IPC Requirements

Update:

```text
src/main/ipc/ocrIpc.ts
```

Add narrow IPC handler:

```text
ocr:runPipeline
```

Input:

```ts
OcrPipelineInput
```

Output:

```ts
OcrPipelineResult
```

Add progress event channel:

```text
ocr:pipeline-progress
```

Renderer should subscribe through preload.

Do not expose generic IPC.

Forbidden handlers:

```text
ocr:callRaw
http:fetch
config:getMistralApiKey
network:request
```

## 17. Preload API Requirements

Update preload to expose:

```ts
window.wifranExtractor.ocr = {
  testSingleChunk: (
    input: OcrSingleChunkTestInput
  ) => Promise<OcrSingleChunkTestResult>,

  runPipeline: (
    input: OcrPipelineInput
  ) => Promise<OcrPipelineResult>,

  onPipelineProgress: (
    callback: (event: OcrPipelineProgressEvent) => void
  ) => () => void
};
```

Preserve the existing single-chunk test API.

Do not expose `ipcRenderer`.

Do not expose API keys.

## 18. Renderer Hook

Create:

```text
src/renderer/hooks/useOcrPipeline.ts
```

Responsibilities:

* Start the OCR pipeline.
* Track running state.
* Track progress events.
* Store latest progress.
* Store result.
* Store error.
* Provide reset function.

Recommended return shape:

```ts
{
  running: boolean;
  progressEvents: OcrPipelineProgressEvent[];
  latestProgress: OcrPipelineProgressEvent | null;
  result: OcrPipelineResult | null;
  error: string | null;
  runPipeline: (input: OcrPipelineInput) => Promise<void>;
  reset: () => void;
}
```

## 19. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

After PDF preprocessing is completed, add a section:

```text
Run OCR
```

This section should:

* Show total chunks.
* Show total rendered pages.
* Show configured max concurrent OCR requests.
* Show configured retry count.
* Show a button: `Run OCR on All Chunks`.
* Disable the button if Mistral config is missing.
* Disable the button while OCR is running.
* Show progress.
* Show chunk-level status.
* Show final OCR summary.

The OCR pipeline input should come from the preprocess result:

```text
workspacePath
chunks
renderedPages
```

Do not start DB sync.

Do not start image cropping.

## 20. Results Page Integration

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Show OCR pipeline result rows if available.

Minimum columns:

```text
Row ID
Page
Product AR
Product EN
Offer Price
Status
Issues
```

Also show summary cards:

```text
Total normalized rows
Valid rows
Warning rows
Error rows
Skipped rows
Skipped promotional rows
Failed chunks
```

No database IDs yet.

No image previews yet.

## 21. Logs Page Integration

Update Logs page to display OCR pipeline progress events.

Example messages:

```text
Starting OCR pipeline.
Running OCR for chunk-001.
Retrying OCR for chunk-002 after temporary error.
OCR completed for chunk-003.
OCR pipeline partially completed.
```

Do not log keys.

## 22. Cancellation

Full cancellation can be implemented later.

For this chunk:

* It is acceptable to not implement cancellation.
* If cancellation is already easy with AbortController, you may add it.
* If not implemented, add TODO.

Do not leave half-implemented cancellation that breaks the pipeline.

## 23. README Update

Update README with:

* OCR pipeline added.
* Controlled concurrency added.
* Retry behavior added.
* How to run OCR after PDF preprocessing.
* Database sync is still not implemented.
* Image cropping is still not implemented.
* Secrets remain in main process only.

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
* Do not use unlimited OCR concurrency.

## 25. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.
## 26. Acceptance Criteria

This chunk is complete when:

* OCR pipeline service exists.
* OCR runs across all preprocessed chunks.
* OCR requests are concurrency-limited.
* OCR transient failures are retried.
* 429/rate-limit behavior is handled safely.
* One failed chunk does not stop all other chunks.
* Pipeline result aggregates all normalized rows.
* Promotional/banner rows are counted as skipped.
* Cover/banner-only chunks with zero rows do not automatically fail.
* Progress events are emitted to renderer.
* Import page can run OCR on all chunks after preprocessing.
* Results page shows OCR pipeline summary and rows.
* Logs page shows OCR pipeline progress.
* Renderer never sees Mistral API key.
* No database writes or offer sync are implemented.
* No image cropping is implemented.
* TypeScript compiles.
* App still starts.

## 27. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How concurrency is implemented.
* How retry behavior works.
* How failed chunks are handled.
* How progress events work.
* How promotional/banner rows are counted.
* How to run OCR across all chunks.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.