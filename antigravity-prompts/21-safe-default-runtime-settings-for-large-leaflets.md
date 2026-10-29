# Antigravity Prompt Chunk 21: Safe Default Runtime Settings for Large Leaflets

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 21. Prompt Chunks 01 to 20 should already have completed the full extractor app, product-offer block association improvements, and OCR cost/accuracy optimization.

This chunk configures safe default runtime settings for large supermarket leaflets that may reach:

```text
100 pages
1000 product offer items
dense product grids
mixed Arabic/English offer blocks
```

The highest priority is:

```text
Do not miss any valid product offer item.
```

API cost and speed are secondary.

## 1. Read These Files First

Before coding, read:

```text
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/06-env-security-and-credentials.md
src/main/config/env.ts
src/main/config/configStatus.ts
.env.example
README.md
docs/operator/operator-setup-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/security-notes.md
src/main/ocr/ocrPipelineService.ts
src/main/ocr/ocrRetry.ts
src/main/ocr/mistralOcrProvider.ts
```

Treat these files as the source of truth.

## 2. Goal of This Chunk

Set safe default settings so the operator only needs to provide these real credentials:

```text
MISTRAL_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

All other runtime settings should have safe defaults in code and `.env.example`.

The app should be able to process very large leaflets without failing the whole import because of:

```text
rate limits
timeouts
one failed page/chunk
large OCR output
dense page layout
missing optional environment variables
```

The app must prefer slow, reliable processing over fast risky processing.

## 3. Required Files to Update

Update files similar to:

```text
.env.example
src/main/config/env.ts
src/main/config/configStatus.ts
src/main/ocr/ocrRetry.ts
src/main/ocr/ocrPipelineService.ts
src/main/ocr/mistralOcrProvider.ts
README.md
docs/operator/operator-setup-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/security-notes.md
```

Adapt paths if the existing project structure differs.

## 4. Required Operator-Provided Variables

After this chunk, the only variables the operator must manually fill should be:

```env
MISTRAL_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The config loader must support these Wifran-style Supabase names:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

For internal main-process use, map them safely to:

```text
SUPABASE_URL <- NEXT_PUBLIC_SUPABASE_URL
SUPABASE_ANON_KEY <- NEXT_PUBLIC_SUPABASE_ANON_KEY
```

If `SUPABASE_URL` is still supported, keep backward compatibility:

```text
Prefer SUPABASE_URL if present.
Otherwise use NEXT_PUBLIC_SUPABASE_URL.
```

Same for anon key:

```text
Prefer SUPABASE_ANON_KEY if present.
Otherwise use NEXT_PUBLIC_SUPABASE_ANON_KEY.
```

Do not expose the service role key to the renderer.

## 5. Safe Default Values

All of these should have defaults in `env.ts` and `.env.example`.

Use these defaults:

```env
# Supabase
SUPABASE_STORAGE_BUCKET=offer-images

# Mistral OCR
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_OCR_ENDPOINT=https://api.mistral.ai/v1/ocr

# Recall-first OCR processing
OCR_CHUNK_SIZE=1
OCR_MAX_CONCURRENT_REQUESTS=1
OCR_MAX_RETRIES=5
OCR_RETRY_BASE_DELAY_MS=2000
OCR_REQUEST_TIMEOUT_MS=180000
OCR_CONFIDENCE_GRANULARITY=page
OCR_TABLE_FORMAT=markdown

# PDF and image processing
PDF_RENDER_DPI=250
IMAGE_CROP_PADDING_PERCENT=8
IMAGE_OUTPUT_FORMAT=jpg
IMAGE_OUTPUT_QUALITY=85

# Import behavior
DEFAULT_OFFER_DURATION_DAYS=7
DEFAULT_OFFER_STATUS=draft
LOW_CONFIDENCE_THRESHOLD=0.75
DATA_QUALITY_NEEDS_REVIEW_THRESHOLD=70
SKIP_DUPLICATE_OFFERS=true
AUTO_CREATE_BRANDS=true
AUTO_CREATE_PRODUCTS=true
AUTO_CREATE_CATEGORIES=false
REQUIRE_IMAGE_FOR_DRAFT=false

# Debug/logging
DEBUG_SAVE_INTERMEDIATE_FILES=false
LOG_LEVEL=info

# Large leaflet safety
OCR_CONTINUE_ON_CHUNK_FAILURE=true
OCR_ALLOW_PARTIAL_IMPORT=true
OCR_RESPECT_RETRY_AFTER=true
OCR_MAX_ZERO_ITEM_CHUNKS_WARNING_THRESHOLD=5
```

## 6. Recall-First Defaults

The app must default to:

```text
OCR_CHUNK_SIZE=1
OCR_MAX_CONCURRENT_REQUESTS=1
PDF_RENDER_DPI=250
```

Reason:

```text
OCR_CHUNK_SIZE=1 reduces the chance that Mistral mixes items across pages or skips dense page content.
OCR_MAX_CONCURRENT_REQUESTS=1 minimizes rate-limit pressure.
PDF_RENDER_DPI=250 improves readability for dense product grids while avoiding excessive image size.
```

Do not increase chunk size or lower render DPI automatically to save cost.

If the operator later wants speed, they may manually change:

```env
OCR_MAX_CONCURRENT_REQUESTS=2
OCR_CHUNK_SIZE=2
```

But the default must favor recall and reliability.

## 7. Rate Limit and Retry Safety

Update OCR retry logic so HTTP `429` is handled carefully.

Required behavior:

```text
Respect Retry-After header when present.
Use exponential backoff when Retry-After is missing.
Use jitter to avoid repeated collision.
Retry up to OCR_MAX_RETRIES.
Do not fail the entire leaflet because one chunk hits a temporary rate limit.
Queue remaining chunks instead of launching more requests.
Show clear UI/log messages for rate-limit pauses.
```

For `429`, recommended behavior:

```text
If Retry-After exists:
  wait Retry-After plus small jitter.

If Retry-After does not exist:
  wait OCR_RETRY_BASE_DELAY_MS * 2^(attempt - 1) plus jitter.
```

Required log message example:

```text
Mistral rate limit reached for chunk-023. Waiting before retrying.
```

Do not log API keys.

## 8. Large Leaflet Processing Safety

Update OCR pipeline behavior for 100-page leaflets.

Rules:

```text
Process every chunk/page unless the user cancels.
Do not stop the whole OCR pipeline because one chunk fails.
Mark failed chunks clearly.
Allow retrying failed chunks later if retry UI already exists.
If retry UI does not exist, document it as a future improvement.
Continue processing successful chunks.
Return partially_completed if some chunks fail.
Return failed only if all chunks fail.
```

The pipeline must report:

```text
total pages
total chunks
completed chunks
failed chunks
zero-item chunks
rate-limit retries
timeout retries
total extracted rows
skipped promotional rows
```

## 9. Timeout Defaults

Set:

```env
OCR_REQUEST_TIMEOUT_MS=180000
```

Reason:

```text
Dense pages with many product offers may take longer.
A 3-minute timeout is safer than 2 minutes for large dense leaflets.
```

Allow max validation up to:

```text
300000 ms
```

Do not force lower timeout.

## 10. Debug Payload Defaults

Set:

```env
DEBUG_SAVE_INTERMEDIATE_FILES=false
```

Reason:

```text
100-page leaflets can produce large local debug files.
Disable by default for normal operation.
Allow enabling for troubleshooting.
```

Even when debug is false, still preserve:

```text
import batch summary
row statuses
validation errors
created offer IDs
failed chunk summaries
```

Do not store huge raw OCR responses by default.

## 11. `.env.example` Update

Update `.env.example` so it clearly shows only the required variables at the top.

Recommended structure:

```env
# ============================================================
# Required credentials - operator must fill these
# ============================================================

MISTRAL_API_KEY=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ============================================================
# Safe defaults - usually do not change
# ============================================================

SUPABASE_STORAGE_BUCKET=offer-images
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_OCR_ENDPOINT=https://api.mistral.ai/v1/ocr

OCR_CHUNK_SIZE=1
OCR_MAX_CONCURRENT_REQUESTS=1
OCR_MAX_RETRIES=5
OCR_RETRY_BASE_DELAY_MS=2000
OCR_REQUEST_TIMEOUT_MS=180000
OCR_CONFIDENCE_GRANULARITY=page
OCR_TABLE_FORMAT=markdown

PDF_RENDER_DPI=250
IMAGE_CROP_PADDING_PERCENT=8
IMAGE_OUTPUT_FORMAT=jpg
IMAGE_OUTPUT_QUALITY=85

DEFAULT_OFFER_DURATION_DAYS=7
DEFAULT_OFFER_STATUS=draft
LOW_CONFIDENCE_THRESHOLD=0.75
DATA_QUALITY_NEEDS_REVIEW_THRESHOLD=70
SKIP_DUPLICATE_OFFERS=true
AUTO_CREATE_BRANDS=true
AUTO_CREATE_PRODUCTS=true
AUTO_CREATE_CATEGORIES=false
REQUIRE_IMAGE_FOR_DRAFT=false

DEBUG_SAVE_INTERMEDIATE_FILES=false
LOG_LEVEL=info

OCR_CONTINUE_ON_CHUNK_FAILURE=true
OCR_ALLOW_PARTIAL_IMPORT=true
OCR_RESPECT_RETRY_AFTER=true
OCR_MAX_ZERO_ITEM_CHUNKS_WARNING_THRESHOLD=5
```

Do not include real values.

## 12. Config Validation Update

Update config validation:

Required:

```text
MISTRAL_API_KEY
NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Optional with defaults:

```text
SUPABASE_STORAGE_BUCKET
MISTRAL_OCR_MODEL
MISTRAL_OCR_ENDPOINT
OCR_CHUNK_SIZE
OCR_MAX_CONCURRENT_REQUESTS
OCR_MAX_RETRIES
OCR_RETRY_BASE_DELAY_MS
OCR_REQUEST_TIMEOUT_MS
OCR_CONFIDENCE_GRANULARITY
OCR_TABLE_FORMAT
PDF_RENDER_DPI
IMAGE_CROP_PADDING_PERCENT
IMAGE_OUTPUT_FORMAT
IMAGE_OUTPUT_QUALITY
DEFAULT_OFFER_DURATION_DAYS
DEFAULT_OFFER_STATUS
LOW_CONFIDENCE_THRESHOLD
DATA_QUALITY_NEEDS_REVIEW_THRESHOLD
SKIP_DUPLICATE_OFFERS
AUTO_CREATE_BRANDS
AUTO_CREATE_PRODUCTS
AUTO_CREATE_CATEGORIES
REQUIRE_IMAGE_FOR_DRAFT
DEBUG_SAVE_INTERMEDIATE_FILES
LOG_LEVEL
OCR_CONTINUE_ON_CHUNK_FAILURE
OCR_ALLOW_PARTIAL_IMPORT
OCR_RESPECT_RETRY_AFTER
OCR_MAX_ZERO_ITEM_CHUNKS_WARNING_THRESHOLD
```

Renderer config status should show:

```text
required credentials configured/missing
safe default values being used
warnings if OCR_CHUNK_SIZE > 1
warnings if OCR_MAX_CONCURRENT_REQUESTS > 2
warnings if PDF_RENDER_DPI < 200
```

Warning examples:

```text
OCR_CHUNK_SIZE is greater than 1. Dense leaflets may miss items. Use 1 for highest recall.
OCR_MAX_CONCURRENT_REQUESTS is greater than 2. This may increase rate-limit errors.
PDF_RENDER_DPI is below 200. Dense pages may be less readable.
```

## 13. OCR Chunk Size Safety

Ensure the app never increases `OCR_CHUNK_SIZE` automatically.

Rules:

```text
Default = 1.
Allowed range = 1 to 3.
If value is invalid, fall back to 1.
If value is greater than 1, show warning.
```

Do not use chunk size 2 or 3 as default.

## 14. Concurrency Safety

Ensure the app never uses unlimited concurrency.

Rules:

```text
Default = 1.
Allowed range = 1 to 4.
If invalid, fall back to 1.
If greater than 2, show warning.
```

For first production use, recommend:

```env
OCR_MAX_CONCURRENT_REQUESTS=1
```

For faster processing after confirming Mistral limits:

```env
OCR_MAX_CONCURRENT_REQUESTS=2
```

Do not recommend 3 or 4 by default.

## 15. Documentation Update

Update README and operator docs.

Add a section:

```text
Large Leaflet Safe Defaults
```

Include:

```text
The app is configured for recall-first extraction.
Default OCR_CHUNK_SIZE=1.
Default OCR_MAX_CONCURRENT_REQUESTS=1.
Default OCR_MAX_RETRIES=5.
Default OCR_REQUEST_TIMEOUT_MS=180000.
This is slower but safer for 100-page / 1000-item leaflets.
```

Add:

```text
The operator normally only needs to fill:
MISTRAL_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Explain:

```text
All other settings have safe defaults.
Do not increase OCR_CHUNK_SIZE until several real leaflets have been tested.
Increase concurrency before increasing chunk size if speed is needed.
If rate-limit errors occur, keep chunk size 1 and reduce concurrency to 1.
```

## 16. Troubleshooting Update

Update troubleshooting guide.

Add sections:

```text
Large leaflet is slow
Rate limit errors
Timeouts on dense pages
Some pages return zero items
One chunk failed but the rest completed
How to rerun with safer settings
```

Recommended troubleshooting guidance:

```text
If items are missed:
  Use OCR_CHUNK_SIZE=1.
  Use PDF_RENDER_DPI=250 or 300.
  Keep full-page OCR.
  Do not pre-crop product cards before OCR.

If rate limits occur:
  Keep OCR_CHUNK_SIZE=1.
  Set OCR_MAX_CONCURRENT_REQUESTS=1.
  Keep OCR_MAX_RETRIES=5.
  Let the app respect Retry-After delays.

If processing is slow:
  Try OCR_MAX_CONCURRENT_REQUESTS=2 only after confirming no rate-limit errors.
  Do not increase OCR_CHUNK_SIZE unless accuracy has been verified.
```

## 17. Tests / Smoke Checks

Update smoke tests or config tests to assert:

```text
Default OCR_CHUNK_SIZE is 1.
Default OCR_MAX_CONCURRENT_REQUESTS is 1.
Default OCR_MAX_RETRIES is 5.
Default OCR_REQUEST_TIMEOUT_MS is 180000.
Default PDF_RENDER_DPI is 250.
Default DEBUG_SAVE_INTERMEDIATE_FILES is false.
NEXT_PUBLIC_SUPABASE_URL maps to internal Supabase URL.
NEXT_PUBLIC_SUPABASE_ANON_KEY maps to internal anon key.
Only required credentials are marked required.
Invalid OCR_CHUNK_SIZE falls back to 1 or validation error.
Invalid concurrency falls back to 1 or validation error.
Config status warns when chunk size > 1.
Config status warns when concurrency > 2.
```

## 18. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not include real keys in docs.
* Do not expose secrets in renderer.
* Do not expose service role key to renderer.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic IPC.
* Do not publish offers automatically.
* Do not use `status = published`.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not modify customer user data.
* Do not create offers from promotional/banner rows.
* Do not optimize speed in a way that increases missed-item risk.

## 19. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 20. Acceptance Criteria

This chunk is complete when:

* `.env.example` only requires the four operator-provided credentials.
* `NEXT_PUBLIC_SUPABASE_URL` is supported and mapped correctly.
* `NEXT_PUBLIC_SUPABASE_ANON_KEY` is supported and mapped correctly.
* All other settings have safe defaults.
* Default `OCR_CHUNK_SIZE=1`.
* Default `OCR_MAX_CONCURRENT_REQUESTS=1`.
* Default `OCR_MAX_RETRIES=5`.
* Default `OCR_REQUEST_TIMEOUT_MS=180000`.
* Default `PDF_RENDER_DPI=250`.
* Default `DEBUG_SAVE_INTERMEDIATE_FILES=false`.
* OCR retry logic respects `Retry-After` when present.
* OCR pipeline continues on individual chunk failures.
* Config status warns about risky speed settings.
* Large leaflet safe-default behavior is documented.
* Troubleshooting guide covers rate limits/timeouts/large leaflets.
* Tests or smoke checks cover the new defaults.
* TypeScript compiles.
* Existing fixture validation passes.
* App still starts.

## 21. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* Final required environment variables.
* Final default OCR settings.
* How Supabase env variable mapping works.
* How rate limits are handled.
* How large 100-page leaflets are protected from full-pipeline failure.
* How to change settings later if speed is needed.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.