# Antigravity Prompt Chunk 43: Shared Mistral Rate-Limit Queue for Extraction, Style, and Validation

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 43.

Chunks 41 and 42 should already have completed:

```text id="lncox6"
41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
42-canonical-offer-normalizer-and-legacy-field-mapper.md
```

This chunk upgrades the current Mistral/OCR rate-limit queue so all present and future Mistral calls go through one shared global queue.

This chunk does **not** add style-profile generation yet.

This chunk does **not** add the style-aware validation call yet.

This chunk does **not** change the crop-level extraction prompt.

This chunk does **not** change the canonical normalizer.

This chunk does **not** implement deterministic checks.

This chunk does **not** implement comparison safety.

This chunk does **not** implement Pre-Publish Preview.

This chunk does **not** change Supabase upload or DB upsert.

---

## 1. Read These Files First

Read the master accuracy package:

```text id="mqbgvi"
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read the Chunk 40 inspection report:

```text id="q5mzii"
wifran-offers-extractor/antigravity-reports/40-current-ocr-pipeline-inspection-report.md
```

Read the previous Antigravity prompts and inspect their implementation results:

```text id="zqiap6"
wifran-offers-extractor/antigravity-prompts/41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
wifran-offers-extractor/antigravity-prompts/42-canonical-offer-normalizer-and-legacy-field-mapper.md
```

Then inspect these project files:

```text id="y1scz3"
src/main/ocr/ocrRateLimitQueue.ts
src/main/ocr/mistralOcrProvider.ts
src/main/ocr/itemImageOcrService.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/ocr/itemImageOcrPromptBuilder.ts
src/main/ocr/ocrProgressTypes.ts
src/main/ipc/
src/preload/
src/renderer/src/pages/ImportPage.tsx
src/renderer/src/components/
```

Adapt paths only if the actual project structure differs.

---

## 2. Context From Chunk 40

Chunk 40 found that:

```text id="nurr1z"
src/main/ocr/ocrRateLimitQueue.ts
```

currently contains:

```text id="udnazt"
OcrRateLimitQueue
```

and that the queue already tracks:

```text id="ijv87y"
TPM
RPM
sliding windows
retry_after
429 handling
```

Chunk 40 also found the current queue is mostly used for OCR extraction, but could be shared for:

```text id="xrcy36"
item extraction calls
future style-profile calls
future style-aware validation calls
```

This chunk should extend or wrap the existing queue into a shared Mistral request queue.

Do not blindly replace working rate-limit logic.

---

## 3. Goal

The goal is to make sure every Mistral API call in the app goes through one shared global queue.

This is required because future chunks will add:

```text id="fgsu4r"
style profile Mistral calls
style-aware item validation Mistral calls
```

If those future calls use separate queues, the app may exceed Mistral free-tier limits.

The target behavior is:

```text id="v78y6s"
request 1: item extraction
wait required delay
request 2: item validation
wait required delay
request 3: style profile
wait required delay
request 4: item extraction
```

The delay must apply between every Mistral request, regardless of request type.

---

## 4. Preserve Existing Working Behavior

Preserve:

```text id="sn0q71"
current crop generation
current crop filenames
current item number assignment
current candidate-based prompt from Chunk 41
current item OCR schema from Chunk 41
current canonical normalizer from Chunk 42
current Mistral provider/API call mechanism
current raw JSON saving
current extraction package folder structure
current Supabase upload code
current DB upsert code
current publish status logic
current Import page behavior
```

Do not change from the current Mistral Chat Completions/Vision flow in this chunk.

Do not switch models.

Do not switch endpoints.

Do not add new Mistral call types beyond the queue plumbing.

---

## 5. Required Queue Design

Create or refactor toward a shared queue module.

Preferred approach:

```text id="so2n39"
extend src/main/ocr/ocrRateLimitQueue.ts
```

or create a wrapper:

```text id="ynvwz7"
src/main/ocr/mistralRateLimitQueue.ts
```

that reuses the existing `OcrRateLimitQueue`.

The final design should expose one shared singleton queue instance for the main process.

Recommended exports:

```ts id="wscnrm"
export type MistralRequestKind =
  | 'item_extraction'
  | 'style_profile'
  | 'item_validation'
  | 'document_ocr'
  | 'other';

export type MistralQueuedRequestMetadata = {
  kind: MistralRequestKind;
  label?: string;
  pageNumber?: number | null;
  itemNumber?: string | null;
  estimatedTokens?: number | null;
};

export async function runWithMistralRateLimit<T>(
  metadata: MistralQueuedRequestMetadata,
  fn: () => Promise<T>
): Promise<T>;
```

If the existing project style prefers classes, this is also acceptable:

```ts id="18q1qb"
export class MistralRateLimitQueue {
  enqueue<T>(
    metadata: MistralQueuedRequestMetadata,
    fn: () => Promise<T>
  ): Promise<T>;
}
```

But there must be one shared instance used by all Mistral calls.

Recommended shared instance export:

```ts id="6fwoyo"
export const sharedMistralRateLimitQueue = new MistralRateLimitQueue(...);
```

or a function:

```ts id="d3f19y"
export function getSharedMistralRateLimitQueue(): MistralRateLimitQueue;
```

---

## 6. Queue Configuration

The queue must support these config values.

Recommended environment/config names:

```text id="ujdm06"
MISTRAL_MAX_CONCURRENT_REQUESTS
MISTRAL_MIN_REQUEST_INTERVAL_MS
MISTRAL_TPM_LIMIT
MISTRAL_RPM_LIMIT
MISTRAL_RATE_MODE
```

Defaults:

```text id="m6lu3q"
MISTRAL_MAX_CONCURRENT_REQUESTS=1
MISTRAL_MIN_REQUEST_INTERVAL_MS=1100
MISTRAL_RATE_MODE=free_tier_safe
```

Safer manual override:

```text id="thuxjt"
MISTRAL_MIN_REQUEST_INTERVAL_MS=5000
```

Important:

* Do not require these env vars to exist.
* If missing, use safe defaults.
* Do not print env values that may include secrets.
* Do not modify `.env.local`.
* Do not add real credentials.

If the project already has equivalent config names, reuse them instead of introducing duplicate names.

---

## 7. Required Behavior

The shared queue must enforce:

```text id="yysmpk"
maxConcurrent = 1 by default
minimum delay between every Mistral request
sliding RPM tracking if already supported
sliding TPM tracking if already supported
Retry-After respect
429 retry/backoff
safe retry for transient 5xx where existing behavior already supports it
progress metadata by request kind
queue wait time tracking
```

The minimum delay must be global.

Example:

```text id="u2bt87"
item_extraction call finishes at 10:00:00.000
item_validation call must not start before 10:00:01.100
style_profile call must not start before 10:00:02.200
```

If `MISTRAL_MIN_REQUEST_INTERVAL_MS=5000`, then every call type waits 5 seconds between starts.

---

## 8. Current Extraction Must Use the Shared Queue

Update the current item image OCR path so it uses the shared queue.

Likely files:

```text id="wlv83z"
src/main/ocr/itemImageOcrService.ts
src/main/ocr/mistralOcrProvider.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
```

The item extraction call should be queued with metadata like:

```ts id="pnct2v"
{
  kind: 'item_extraction',
  label: 'Item image OCR',
  pageNumber,
  itemNumber,
  estimatedTokens
}
```

Do not change request payload.

Do not change response parsing.

Do not change the model.

Do not change prompt content.

Only route the request through the shared queue if it is not already.

---

## 9. Future Call-Type Readiness

Even though style-profile and validation calls do not exist yet, the queue should be ready for them.

Add types/metadata only.

Do not implement actual style-profile calls.

Do not implement actual validation calls.

Add comments or documentation showing that future chunks should call:

```ts id="xhtgmb"
runWithMistralRateLimit(
  { kind: 'style_profile', pageNumber },
  () => callMistral(...)
);
```

and:

```ts id="u3b2ng"
runWithMistralRateLimit(
  { kind: 'item_validation', pageNumber, itemNumber },
  () => callMistral(...)
);
```

---

## 10. Progress and Telemetry

If the app already has progress events for OCR, extend them carefully.

The queue should be able to expose or emit:

```text id="hhg7bw"
queued request count
running request count
completed request count by kind
failed request count by kind
current wait reason
next eligible request time
last Retry-After wait
total queue wait time
ETA if already supported
```

Do not overbuild UI in this chunk.

Renderer UI changes are optional and should be minimal.

If progress events are easy to extend without breaking UI, add fields like:

```ts id="m795yy"
mistralQueue?: {
  queued: number;
  running: number;
  completedByKind: Record<string, number>;
  failedByKind: Record<string, number>;
  waitingMs: number;
  waitReason: 'min_interval' | 'rpm_limit' | 'tpm_limit' | 'retry_after' | 'none';
}
```

If UI wiring is risky, keep the progress data in the main-process queue and document it for future chunks.

---

## 11. Retry-After Handling

Respect `Retry-After` from Mistral 429 responses.

The queue/provider must:

```text id="zwc2hl"
parse Retry-After seconds or date if present
wait at least that duration before next Mistral request
apply the delay globally to all call types
record wait reason as retry_after if progress telemetry exists
retry safely according to existing retry limits
```

Do not remove existing retry behavior.

Do not create infinite retry loops.

---

## 12. Error Handling

The queue should preserve existing errors and add context.

For example:

```text id="brmfrv"
Mistral request failed after retries
kind=item_extraction
page=3
item=007
```

Do not swallow errors.

Do not turn failed OCR into fake successful JSON.

Downstream failure handling should remain as it currently works.

---

## 13. Avoid Multiple Queue Instances

Search for all current constructions of:

```text id="xdqq0e"
new OcrRateLimitQueue
new MistralRateLimitQueue
```

Ensure the app does not create one independent queue per item or per request.

If the current workflow creates one queue per extraction run, that may be acceptable only if no other Mistral calls can run concurrently outside the extraction run.

Preferred final state:

```text id="6ceavq"
one shared main-process queue instance for all Mistral calls
```

Future chunks must be able to reuse it.

---

## 14. Do Not Run External Calls

Do not run Mistral OCR.

Do not run style profile calls.

Do not run validation calls.

Do not run Supabase upload.

Do not run DB sync.

Unit tests for the queue are allowed if they use fake promises and fake timers.

---

## 15. Tests

Add or update tests for the queue.

Recommended test file:

```text id="s7jrjm"
src/main/ocr/__tests__/mistralRateLimitQueue.test.ts
```

or use the existing test folder convention.

Test cases:

```text id="wc5kn4"
queue runs one request at a time by default
queue enforces min delay between item_extraction and item_validation kinds
queue enforces min delay between item_validation and style_profile kinds
queue records completed counts by kind if telemetry exists
queue respects Retry-After globally
queue does not create independent timing per request kind
runWithMistralRateLimit returns the function result
runWithMistralRateLimit propagates thrown errors
existing item extraction can call through the shared queue
```

Use fake timers or dependency injection where practical.

Do not write tests that call Mistral.

Do not write tests that call Supabase.

---

## 16. Documentation Update

Update relevant docs briefly if they exist:

```text id="wqnb86"
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text id="dktevu"
All Mistral calls now share one global rate-limit queue.
The delay applies between item extraction, future style-profile calls, and future validation calls.
Default max concurrency is 1.
MISTRAL_MIN_REQUEST_INTERVAL_MS can be increased for safer free-tier operation.
This chunk does not yet add style-profile or validation calls.
```

Do not claim future chunks are implemented.

---

## 17. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not add generic filesystem IPC.
* Do not upload images.
* Do not run Mistral OCR.
* Do not write to Wifran DB.
* Do not publish offers.
* Do not delete files in `Extracts/`.
* Do not change Supabase upload or DB sync.
* Do not log full image base64 payloads.
* Do not log API request bodies that may contain image data.

---

## 18. Acceptance Criteria

This chunk is complete when:

* There is one shared Mistral rate-limit queue available to all Mistral call sites.
* Current item extraction calls use the shared queue.
* Future call kinds are represented:

  * `item_extraction`
  * `style_profile`
  * `item_validation`
  * `document_ocr`
  * `other`
* The queue enforces max concurrency 1 by default.
* The queue enforces a global minimum delay between every Mistral request.
* The queue can use `MISTRAL_MIN_REQUEST_INTERVAL_MS` or existing equivalent config.
* The queue respects `Retry-After` globally.
* The queue preserves existing 429/backoff behavior.
* The queue preserves existing OCR error propagation.
* The queue does not change the Mistral model, endpoint, prompt, or request payload.
* The queue does not change raw JSON saving.
* The queue does not change Supabase upload or DB upsert.
* Tests are added or updated where practical.
* No real OCR/API/DB operation is run.
* TypeScript compiles.

---

## 19. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the shared Mistral queue changes needed for this chunk, keep the app runnable, then stop.

Do not implement future chunks in this step.

---

## 20. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="aj3s9s"
files modified
files created
shared queue design
how current item extraction now uses the shared queue
how future style-profile and validation calls should use the queue
config/defaults used
Retry-After behavior
tests added/updated
commands run
commands skipped and why
risks or TODOs
recommended next chunk
```

The recommended next chunk should be:

```text id="yus9lr"
44-adaptive-style-profile-generation.md
```
