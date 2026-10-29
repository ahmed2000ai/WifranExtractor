# Antigravity Prompt Chunk 25: Mistral Free-Tier Rate-Limit-Safe OCR Queue and Progress

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 25. Prompt Chunks 01 to 24 should already have completed the full extractor app, Wifran location/image contract alignment, direct publish mode with validation gates, recall-first OCR defaults, and Retry Only Failed OCR Chunks.

This chunk adapts the OCR pipeline for the operator’s current Mistral free-tier limits.

The operator will use:

```text
MISTRAL_OCR_MODEL=mistral-ocr-2512
```

The operator’s current Mistral limits are:

```text
Tokens per Minute: 50,000
Requests per Second: 1.00
```

The highest priority remains:

```text
Do not miss any valid product offer item.
```

Speed is secondary. The operator accepts waiting several minutes for one PDF if processing is reliable and visible.

## 1. Read These Files First

Before coding, read the existing extractor files:

```text
src/main/config/env.ts
src/main/config/configStatus.ts
src/main/ocr/ocrPipelineService.ts
src/main/ocr/ocrRetry.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/ocrPromptBuilder.ts
src/shared/types/ocrJob.ts
src/renderer/hooks/useOcrPipeline.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Also read:

```text
project-knowledge/wifran_docs/production-env-verification.md
project-knowledge/wifran_docs/external-offer-ingestion-tool.md
project-knowledge/wifran_docs/offer-images-bucket.md
```

Use the existing project structure and naming where possible.

## 2. Goal of This Chunk

Make the OCR pipeline safe for Mistral free-tier limits by adding:

```text
strict single-request OCR processing
no concurrent OCR calls
minimum delay between OCR requests
tokens-per-minute safety budget
rate-limit-aware waiting
page/chunk progress bar
estimated remaining time
clear rate-limit/waiting status messages
safe resume/retry behavior
lean OCR response settings
```

The app must process every page/chunk without exceeding the operator’s known limits as much as practical.

Important:

```text
No client can absolutely guarantee that Mistral will never return a rate-limit error, because account-side limits and token accounting are controlled by Mistral.
But the app must behave conservatively enough to strongly reduce rejected calls and recover safely when 429 responses occur.
```

## 3. Required Files to Create or Update

Create or update files similar to:

```text
.env.example
src/main/config/env.ts
src/main/config/configStatus.ts
src/main/ocr/ocrRateLimitQueue.ts
src/main/ocr/ocrRetry.ts
src/main/ocr/ocrPipelineService.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/ocrPromptBuilder.ts
src/shared/types/ocrJob.ts
src/renderer/hooks/useOcrPipeline.ts
src/renderer/components/OcrProgressBar.tsx
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Adapt paths if the project structure differs.

## 4. Environment Defaults for Mistral Free Tier

Update `.env.example` and config defaults.

Required operator credentials remain:

```env
MISTRAL_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Set these safe defaults:

```env
MISTRAL_OCR_MODEL=mistral-ocr-2512
MISTRAL_OCR_ENDPOINT=https://api.mistral.ai/v1/ocr

OCR_CHUNK_SIZE=1
OCR_MAX_CONCURRENT_REQUESTS=1
OCR_MAX_RETRIES=6
OCR_RETRY_BASE_DELAY_MS=3000
OCR_REQUEST_TIMEOUT_MS=240000

OCR_REQUESTS_PER_SECOND_LIMIT=1
OCR_MIN_REQUEST_INTERVAL_MS=5000
OCR_TOKENS_PER_MINUTE_LIMIT=50000
OCR_TPM_SAFETY_RATIO=0.75
OCR_ESTIMATED_TOKENS_PER_PAGE=3000
OCR_ESTIMATED_TOKENS_PER_DENSE_PAGE=5000
OCR_RATE_LIMIT_MODE=free_tier_safe

OCR_CONFIDENCE_GRANULARITY=page
OCR_TABLE_FORMAT=markdown
DEBUG_SAVE_INTERMEDIATE_FILES=false
```

Meaning:

```text
OCR_CHUNK_SIZE=1:
  One page/chunk per OCR request for maximum item recall.

OCR_MAX_CONCURRENT_REQUESTS=1:
  Never run concurrent OCR calls.

OCR_MIN_REQUEST_INTERVAL_MS=5000:
  Wait at least 5 seconds between OCR calls.
  This is stricter than 1 request per second and helps protect the 50k TPM budget.

OCR_TPM_SAFETY_RATIO=0.75:
  Use only 75% of the available TPM as a planning budget.
  50,000 × 0.75 = 37,500 safe estimated tokens per minute.

OCR_ESTIMATED_TOKENS_PER_PAGE=3000:
  Conservative planning estimate for normal pages.

OCR_ESTIMATED_TOKENS_PER_DENSE_PAGE=5000:
  Conservative planning estimate for dense pages.
```

## 5. Config Validation Rules

Update config validation:

```text
OCR_CHUNK_SIZE must default to 1.
OCR_MAX_CONCURRENT_REQUESTS must default to 1.
OCR_MAX_CONCURRENT_REQUESTS must not exceed 1 when OCR_RATE_LIMIT_MODE=free_tier_safe.
OCR_REQUESTS_PER_SECOND_LIMIT must default to 1.
OCR_MIN_REQUEST_INTERVAL_MS must be at least 1000.
For free_tier_safe mode, OCR_MIN_REQUEST_INTERVAL_MS should be at least 5000.
OCR_TOKENS_PER_MINUTE_LIMIT must default to 50000.
OCR_TPM_SAFETY_RATIO must be between 0.1 and 1.0.
OCR_ESTIMATED_TOKENS_PER_PAGE must be positive.
OCR_ESTIMATED_TOKENS_PER_DENSE_PAGE must be positive.
```

If the operator tries to set concurrency above 1 while `OCR_RATE_LIMIT_MODE=free_tier_safe`, do one of these:

```text
Preferred:
  clamp it to 1 and show a warning.

Alternative:
  fail config validation with a clear warning.
```

Recommended warning:

```text
Free-tier safe mode forces OCR_MAX_CONCURRENT_REQUESTS=1 to avoid exceeding Mistral request limits.
```

## 6. OCR Rate Limit Queue

Create:

```text
src/main/ocr/ocrRateLimitQueue.ts
```

Implement a small queue/throttle utility.

Recommended exports:

```ts
export type OcrRateLimitQueueConfig = {
  requestsPerSecondLimit: number;
  minRequestIntervalMs: number;
  tokensPerMinuteLimit: number;
  tpmSafetyRatio: number;
  estimatedTokensPerPage: number;
  estimatedTokensPerDensePage: number;
};

export type OcrRateLimitWaitInfo = {
  waitMs: number;
  reason: 'request_interval' | 'token_budget' | 'retry_after' | 'none';
  message: string;
};

export class OcrRateLimitQueue {
  constructor(config: OcrRateLimitQueueConfig);

  waitBeforeNextRequest(input: {
    chunkId: string;
    pageCount: number;
    dense?: boolean;
    retryAfterMs?: number | null;
    onWait?: (info: OcrRateLimitWaitInfo) => void;
  }): Promise<void>;

  recordUsage(input: {
    chunkId: string;
    estimatedTokens: number;
    actualTokens?: number | null;
  }): void;

  getSnapshot(): {
    usedTokensInCurrentWindow: number;
    safeTokensPerMinute: number;
    lastRequestAt: string | null;
  };
}
```

Implementation requirements:

```text
Always enforce minimum request interval.
Maintain an in-memory rolling 60-second token usage window.
Use actual usage tokens if Mistral returns them.
Fallback to estimated tokens when usage is unavailable.
If next estimated request would exceed safe TPM budget, wait until budget is available.
If Retry-After is supplied, respect it.
Add small jitter to avoid repeated collisions.
Do not run multiple requests in parallel.
```

## 7. OCR Pipeline Processing Rules

Update:

```text
src/main/ocr/ocrPipelineService.ts
```

Required behavior:

```text
Process chunks sequentially in free_tier_safe mode.
Do not use p-limit concurrency above 1 in free_tier_safe mode.
Before every OCR request, call OcrRateLimitQueue.waitBeforeNextRequest().
After every OCR response, call OcrRateLimitQueue.recordUsage().
If Mistral returns usage info, store it at chunk level.
If usage info is missing, store estimated usage.
If a request receives 429, respect Retry-After and retry.
Continue processing remaining chunks after a failed chunk.
Keep Retry Only Failed Chunks compatible with the same queue.
```

Do not increase `OCR_CHUNK_SIZE` to reduce request count.

Accuracy rule:

```text
Never increase chunk size or reduce page coverage to save API calls when item recall may be affected.
```

## 8. Mistral Provider Updates

Update:

```text
src/main/ocr/mistralOcrProvider.ts
```

Use:

```text
model: mistral-ocr-2512
```

from config.

Keep the request lean:

```text
include_image_base64 = false when supported
extract_header = false when supported
extract_footer = false when supported
structured document_annotation only
no prose summary
no markdown explanation
no full page text output as final extraction
```

If the Mistral SDK/API does not support one of these options, do not invent an invalid request shape. Add a code comment and keep local post-processing lean.

Capture usage info if available.

Possible usage fields may vary. Handle safely:

```text
usage
usage_info
token_usage
pages_processed
```

Do not assume a fixed shape unless the SDK type confirms it.

## 9. Prompt Output Size Control

Update:

```text
src/main/ocr/ocrPromptBuilder.ts
```

Ensure the prompt says:

```text
Return only valid JSON.
Return only the required fields.
Do not include markdown.
Do not include prose.
Do not include a page summary.
Do not include full OCR text.
Do not include duplicate extracted text outside item fields.
Do not include decorative/header/footer/banner text as rows.
Do not include standalone prices, old prices, discount badges, SKU codes, branch notes, or unit notes as rows.
Use null for unknown optional values.
Keep notes concise.
```

Do not remove fields needed for accuracy.

Required fields should remain:

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

Do not ask Mistral for full OCR word lists or base64 image data.

## 10. Progress Event Types

Update:

```text
src/shared/types/ocrJob.ts
```

Extend OCR progress events with rate-limit and page-progress fields.

Add fields like:

```ts
export type OcrPipelineProgressEvent = {
  stage:
    | 'started'
    | 'chunk_queued'
    | 'waiting_for_rate_limit'
    | 'chunk_started'
    | 'chunk_retrying'
    | 'chunk_completed'
    | 'chunk_failed'
    | 'normalizing'
    | 'completed'
    | 'partially_completed'
    | 'failed';

  message: string;
  chunkId?: string;
  current?: number;
  total?: number;

  pagesProcessed?: number;
  totalPages?: number;
  chunksProcessed?: number;
  totalChunks?: number;

  waitMs?: number;
  waitReason?: 'request_interval' | 'token_budget' | 'retry_after' | 'none';

  estimatedRemainingMs?: number | null;

  details?: Record<string, unknown>;
};
```

Preserve backward compatibility if existing fields differ.

## 11. Progress Bar UI

Create:

```text
src/renderer/components/OcrProgressBar.tsx
```

or update existing progress display.

The UI should show:

```text
Pages processed / total pages
Chunks processed / total chunks
Current chunk ID
Current stage
Progress percentage
Estimated remaining time
Rate-limit waiting message when applicable
Retry count if retrying
Failed chunks count
```

Example display:

```text
OCR progress: 37 / 100 pages processed
Current: chunk-038
Waiting 5s before next Mistral request to stay within free-tier limits.
Estimated remaining time: 5 min 15 sec
```

Use a real progress bar, not only text.

The progress bar should update during:

```text
normal OCR pipeline
Retry Only Failed OCR Chunks
rate-limit wait periods
retry backoff periods
```

## 12. Estimated Remaining Time

Add simple ETA calculation.

Recommended:

```text
averageMsPerCompletedChunk = elapsedMs / completedChunks
remainingChunks = totalChunks - completedChunks
estimatedRemainingMs = remainingChunks * averageMsPerCompletedChunk
```

If no chunks completed yet:

```text
estimatedRemainingMs = totalChunks * OCR_MIN_REQUEST_INTERVAL_MS
```

Display ETA as approximate.

Do not block processing if ETA cannot be calculated.

## 13. Logs Page Updates

Update Logs page to show rate-limit messages:

```text
Starting OCR pipeline in free-tier safe mode.
Processing chunk 1 of 100.
Waiting 5 seconds before next Mistral OCR request.
Token budget wait: waiting 23 seconds before next request.
Mistral rate limit reached. Respecting Retry-After: 30 seconds.
OCR completed: 100 pages processed, 0 failed chunks.
```

Do not log API keys.

Do not log raw authorization headers.

## 14. Results / Summary Updates

Update OCR result summary to include:

```text
OCR model
Rate-limit mode
Total pages
Total chunks
Completed chunks
Failed chunks
Total waits
Total wait time
Rate-limit retries
Estimated token usage
Actual token usage if available
```

Do not display huge raw usage payloads.

## 15. Retry Failed Chunks Compatibility

Update the Retry Only Failed Chunks logic from Chunk 22 so it also uses:

```text
OcrRateLimitQueue
OCR_MIN_REQUEST_INTERVAL_MS
OCR_TOKENS_PER_MINUTE_LIMIT
Retry-After handling
progress bar updates
```

Retrying failed chunks must not launch concurrent calls.

## 16. Failure Handling

Handle:

```text
429 rate limit
Retry-After header
timeout
network error
invalid JSON
schema validation error
one failed page/chunk
all chunks failed
```

Rules:

```text
429 should not immediately fail the chunk.
Retry with Retry-After or exponential backoff.
Only mark chunk failed after OCR_MAX_RETRIES is exhausted.
Continue remaining chunks.
Do not lose successful chunks.
Allow Retry Only Failed Chunks after pipeline finishes.
```

## 17. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Add section:

```text
Mistral Free-Tier Safe Mode
```

Document:

```text
Model: mistral-ocr-2512
Tokens per minute used for planning: 50,000
Requests per second limit: 1
Default OCR_CHUNK_SIZE=1
Default OCR_MAX_CONCURRENT_REQUESTS=1
Default OCR_MIN_REQUEST_INTERVAL_MS=5000
Default OCR_TPM_SAFETY_RATIO=0.75
Processing is intentionally slower to avoid rejected calls.
The app shows progress while waiting.
If rate limits still happen, the app respects Retry-After and retries.
```

Add guidance:

```text
Do not raise concurrency on the free tier.
Do not increase OCR_CHUNK_SIZE if accuracy matters.
If processing is too slow, first test with a small PDF before changing limits.
```

## 18. Tests / Smoke Checks

Update or add tests for:

```text
default model is mistral-ocr-2512
OCR_MAX_CONCURRENT_REQUESTS is 1 in free_tier_safe mode
OCR_MIN_REQUEST_INTERVAL_MS defaults to 5000
OCR_TOKENS_PER_MINUTE_LIMIT defaults to 50000
OCR_TPM_SAFETY_RATIO defaults to 0.75
rate-limit queue waits between requests
rate-limit queue waits when estimated token budget is exceeded
Retry-After wait overrides normal interval
progress events include pagesProcessed and totalPages
zero concurrency is impossible
concurrency above 1 is clamped or rejected in free_tier_safe mode
retry failed chunks uses same rate-limit queue
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If one script does not exist, document it clearly and do not invent success.

## 19. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not include real keys in docs.
* Do not expose Mistral API key to renderer.
* Do not expose service role key to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic network IPC.
* Do not reduce OCR page coverage to save API calls.
* Do not increase OCR_CHUNK_SIZE automatically.
* Do not run concurrent Mistral OCR calls in free_tier_safe mode.
* Do not log authorization headers.
* Do not log raw API keys.
* Do not publish offers from failed OCR chunks.

## 20. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 21. Acceptance Criteria

This chunk is complete when:

* `MISTRAL_OCR_MODEL` defaults to `mistral-ocr-2512`.
* `OCR_CHUNK_SIZE` remains 1.
* OCR concurrency is forced to 1 in free-tier safe mode.
* OCR requests are sequential.
* A minimum delay is enforced between Mistral OCR calls.
* A token-per-minute safety budget is implemented or conservatively simulated.
* 429 `Retry-After` is respected.
* Retry Only Failed Chunks uses the same throttling.
* OCR progress events include page/chunk counts.
* Import page shows a real OCR progress bar.
* UI shows rate-limit waiting messages.
* UI shows estimated remaining time.
* Logs show rate-limit wait/retry events.
* OCR summaries show pages/chunks processed and failed chunks.
* Prompt/request output remains lean.
* Tests or smoke checks cover the rate-limit-safe behavior.
* TypeScript compiles.
* Existing fixture validation passes.
* App still starts.

## 22. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* Final OCR defaults.
* How request throttling works.
* How token budget tracking works.
* How Retry-After is handled.
* How progress bar works.
* How Retry Failed Chunks is rate-limit-safe.
* Any assumptions about Mistral usage metadata.
* Any issues or TODOs.

Keep the project runnable after this chunk.