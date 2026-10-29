# Antigravity Prompt Chunk 22: Retry Failed OCR Chunks

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 22. Prompt Chunks 01 to 21 should already have completed the full extractor app, including recall-first OCR settings for large leaflets.

Chunk 21 identified an important TODO:

```text
The operator does not currently have a one-click button in the UI to "Retry Only Failed Chunks".
```

This chunk implements that feature.

The highest priority remains:

```text
Do not miss any valid product offer item on the leaflet.
```

## 1. Read These Files First

Before coding, read:

```text
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/06-env-security-and-credentials.md
src/main/ocr/ocrPipelineService.ts
src/main/ocr/ocrRetry.ts
src/main/ocr/mistralOcrProvider.ts
src/shared/types/ocrJob.ts
src/renderer/hooks/useOcrPipeline.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Treat these files as the source of truth.

## 2. Goal of This Chunk

Implement a one-click operator action:

```text
Retry Only Failed OCR Chunks
```

The app should allow an operator to retry only the OCR chunks/pages that failed during the OCR pipeline, then merge the successful retry results back into the existing OCR result without reprocessing the entire PDF.

This prevents missed items from failed pages and avoids unnecessary API calls for already-successful chunks.

## 3. Why This Matters

For large leaflets, such as:

```text
100 pages
100 chunks when OCR_CHUNK_SIZE=1
1000 product items
```

it is normal for one or a few OCR requests to fail because of:

```text
temporary rate limits
network timeout
transient Mistral API error
connection interruption
```

The app must not force the operator to:

```text
manually add missing products
rerun the entire OCR job
ignore failed pages
```

Instead, the operator must be able to retry only failed chunks safely.

## 4. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/ocrJob.ts
src/main/ocr/ocrPipelineService.ts
src/main/ipc/ocrIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useOcrPipeline.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
src/shared/utils/ocrPipelineMerge.ts
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
README.md
```

Adapt paths if the existing project structure differs.

## 5. Shared Types

Update:

```text
src/shared/types/ocrJob.ts
```

Add types similar to:

```ts
export type RetryFailedOcrChunksInput = {
  workspacePath: string;
  originalPipelineResult: OcrPipelineResult;
  renderedPages: Array<{
    pageNumber: number;
    imagePath: string;
    width: number;
    height: number;
    dpi: number;
  }>;
};

export type RetryFailedOcrChunksResult = {
  ok: boolean;
  retriedChunkCount: number;
  successfulRetryCount: number;
  failedRetryCount: number;
  mergedPipelineResult: OcrPipelineResult | null;
  retriedChunks: OcrChunkRunSummary[];
  error?: {
    code: string;
    message: string;
  };
};
```

If names differ in the existing code, adapt but preserve the same behavior.

## 6. Failed Chunk Detection

A chunk should be eligible for retry when its chunk summary has:

```text
status = failed
```

or an error code such as:

```text
OCR_CHUNK_FAILED
OCR_API_ERROR
OCR_RATE_LIMIT
OCR_TIMEOUT
OCR_EMPTY_RESPONSE
OCR_JSON_PARSE_ERROR
OCR_SCHEMA_VALIDATION_ERROR
```

Do not retry chunks that are already completed successfully.

Do not retry chunks that completed with zero items unless they are explicitly marked failed.

A zero-item completed chunk may be a cover/banner-only page and should not be treated as failed.

## 7. Retry Service Behavior

Update or extend:

```text
src/main/ocr/ocrPipelineService.ts
```

Add a function such as:

```ts
export async function retryFailedOcrChunks(
  input: RetryFailedOcrChunksInput,
  onProgress?: (event: OcrPipelineProgressEvent) => void
): Promise<RetryFailedOcrChunksResult>;
```

Responsibilities:

1. Validate original pipeline result exists.
2. Identify failed chunks only.
3. If no failed chunks exist, return a safe result:

   * `ok = true`
   * `retriedChunkCount = 0`
   * `mergedPipelineResult = originalPipelineResult`
4. Re-run OCR only for failed chunks.
5. Use the same Mistral OCR provider.
6. Use the same retry/backoff logic.
7. Respect `Retry-After`.
8. Use safe concurrency defaults from config.
9. Merge successful retry chunks into the original pipeline result.
10. Preserve still-failed chunks.
11. Recalculate summary counts.
12. Return the merged pipeline result.

## 8. Merge Rules

Create:

```text
src/shared/utils/ocrPipelineMerge.ts
```

Implement a merge helper such as:

```ts
export function mergeOcrRetryResult(input: {
  original: OcrPipelineResult;
  retryChunks: OcrChunkRunSummary[];
  retryNormalizedRows: unknown[];
}): OcrPipelineResult;
```

Rules:

```text
Replace failed chunk summaries with successful retry summaries when retry succeeds.
Keep failed chunk summaries if retry still fails.
Remove old rows from failed chunks before adding retry rows.
Keep rows from chunks that were already successful and were not retried.
Recalculate all counts.
Recalculate final status.
Preserve startedAt from original run.
Update completedAt and durationMs.
```

Final status rules:

```text
completed
- all chunks are completed

partially_completed
- at least one chunk completed and at least one chunk still failed

failed
- all chunks failed
```

## 9. Row Deduplication Rules

When merging retry rows:

```text
Use chunkId and row_id to avoid duplicate rows.
Do not duplicate rows from successful chunks.
Do not keep stale rows from a failed chunk if the retry succeeds.
If the same row_id appears twice within the same retried chunk, keep the latest normalized row and add warning if practical.
```

If chunkId is not currently stored on normalized rows, add it to normalized row metadata during OCR pipeline processing.

Do not break existing rows.

## 10. Progress Events

Emit progress events for retry.

Examples:

```ts
{
  stage: 'started',
  message: 'Retrying failed OCR chunks.',
  current: 0,
  total: failedChunks.length
}
```

```ts
{
  stage: 'chunk_started',
  chunkId: 'chunk-023',
  message: 'Retrying OCR for failed chunk-023.',
  current: 1,
  total: failedChunks.length
}
```

```ts
{
  stage: 'chunk_completed',
  chunkId: 'chunk-023',
  message: 'Retry succeeded for chunk-023.',
  current: 1,
  total: failedChunks.length
}
```

```ts
{
  stage: 'chunk_failed',
  chunkId: 'chunk-041',
  message: 'Retry failed for chunk-041.',
  current: 2,
  total: failedChunks.length
}
```

Do not include secrets in details.

## 11. IPC Requirements

Update:

```text
src/main/ipc/ocrIpc.ts
```

Add narrow IPC handler:

```text
ocr:retryFailedChunks
```

Input:

```ts
RetryFailedOcrChunksInput
```

Output:

```ts
RetryFailedOcrChunksResult
```

Use existing OCR progress channel or add:

```text
ocr:retry-progress
```

Do not expose generic OCR/network IPC.

Forbidden:

```text
ocr:callRaw
http:fetch
config:getMistralApiKey
network:request
```

## 12. Preload API Requirements

Update preload to expose:

```ts
window.wifranExtractor.ocr = {
  ...existingOcrApis,

  retryFailedChunks: (
    input: RetryFailedOcrChunksInput
  ) => Promise<RetryFailedOcrChunksResult>,

  onRetryProgress: (
    callback: (event: OcrPipelineProgressEvent) => void
  ) => () => void
};
```

Do not expose raw `ipcRenderer`.

Do not expose API keys.

## 13. Renderer Hook Update

Update:

```text
src/renderer/hooks/useOcrPipeline.ts
```

Add:

```ts
retryFailedChunks: (input: RetryFailedOcrChunksInput) => Promise<void>;
retryingFailedChunks: boolean;
retryResult: RetryFailedOcrChunksResult | null;
```

The hook should:

```text
track retry running state
track retry progress events
store retry result
replace current OCR pipeline result with mergedPipelineResult when retry completes
preserve previous results if retry fails completely
show safe errors
```

## 14. Import Page UI

Update:

```text
src/renderer/pages/ImportPage.tsx
```

After OCR pipeline completes with failed chunks, show:

```text
Failed OCR Chunks
```

Display:

```text
failed chunk count
failed chunk IDs
original page numbers for each failed chunk
error message/code for each failed chunk
```

Add button:

```text
Retry Only Failed OCR Chunks
```

Enable it only when:

```text
OCR pipeline result exists
failedChunks > 0
not currently running OCR
not currently retrying failed chunks
Mistral config is ready
workspace path exists
rendered pages exist
```

When clicked:

```text
retry only failed chunks
show progress
merge successful retry results
update OCR summary
update Results page data
```

If no failed chunks remain, show:

```text
All OCR chunks completed successfully.
```

## 15. Results Page UI

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Show retry status in the pipeline summary:

```text
Failed chunks before retry
Retried chunks
Successful retries
Still failed chunks
```

Rows from successful retries should appear like normal OCR rows.

Still-failed chunks should remain visible in stage issues.

## 16. Logs Page UI

Update logs with messages such as:

```text
Retrying 3 failed OCR chunks.
Retry succeeded for chunk-023.
Retry failed for chunk-041.
OCR retry completed: 2 succeeded, 1 still failed.
```

Do not log keys or raw authorization headers.

## 17. Import Tracking Safety

If import tracking has already been saved before retrying failed chunks, warn the operator that OCR retry should happen before later stages.

Recommended UI rule:

```text
Retry failed OCR chunks should be done before image cropping, import tracking, matching, offer preparation, and sync.
```

If later stages have already run, either:

```text
disable retry and tell operator to restart from OCR stage
```

or:

```text
allow retry but require downstream results to be reset
```

Choose the safer implementation.

Recommended safer behavior:

```text
If image cropping/import tracking/entity matching/offer preparation/offer sync already ran:
  Disable Retry Only Failed Chunks.
  Show message: Retry failed OCR chunks before continuing to downstream stages. To retry now, reset downstream results first.
```

If a reset-downstream action already exists, use it. If not, document as future improvement.

## 18. Documentation Update

Update:

```text
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
README.md
```

Document:

```text
How to retry failed OCR chunks.
When to use it.
Why it avoids re-running the full PDF.
What happens if some chunks still fail.
Why zero-item completed chunks are not automatically failed.
That retry should happen before cropping/import tracking/sync.
```

Troubleshooting guidance:

```text
If a few chunks fail:
  Click Retry Only Failed OCR Chunks.
  Keep OCR_CHUNK_SIZE=1.
  Keep OCR_MAX_CONCURRENT_REQUESTS=1.
  Let Retry-After delays complete.

If chunks still fail:
  Check Mistral account limits.
  Check network.
  Retry later.
  Review failed page manually if necessary.
```

## 19. Tests / Smoke Checks

Update smoke tests where practical.

Test:

```text
failed chunks are detected correctly
completed zero-item chunks are not treated as failed
retry result merges successful chunks
still-failed chunks remain failed
rows are not duplicated after merge
counts are recalculated
final status changes from partially_completed to completed when all retries succeed
```

## 20. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not include real keys in docs.
* Do not expose secrets in renderer.
* Do not expose service role key to renderer.
* Do not expose Mistral API key to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic IPC.
* Do not publish offers automatically.
* Do not use `status = published`.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not modify customer user data.
* Do not create offers from promotional/banner rows.
* Do not retry successful chunks unnecessarily.
* Do not duplicate rows when merging retry results.

## 21. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 22. Acceptance Criteria

This chunk is complete when:

* Failed OCR chunks can be detected from pipeline result.
* Zero-item successful chunks are not treated as failed.
* Operator has a one-click Retry Only Failed OCR Chunks action.
* Retry runs only failed chunks.
* Retry uses existing Mistral provider, retry, rate-limit, and backoff logic.
* Retry respects `Retry-After`.
* Successful retry chunks are merged into original OCR result.
* Still-failed chunks remain visible.
* Row counts are recalculated after merge.
* Duplicate rows are not created during merge.
* Results page reflects retry outcome.
* Logs page shows retry progress.
* Documentation explains retry behavior.
* Smoke tests or checks cover retry merge logic.
* TypeScript compiles.
* Existing fixture validation passes.
* App still starts.

## 23. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How failed chunks are detected.
* How retry works.
* How merge works.
* How the UI exposes retry.
* How zero-item chunks are handled.
* How downstream-stage safety is handled.
* How to test the feature.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.