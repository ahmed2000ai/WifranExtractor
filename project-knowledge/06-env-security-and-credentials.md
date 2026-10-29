# Environment, Security, and Credentials

## 1. Purpose of This Document

This document defines how Wifran Offers Extractor should handle environment variables, credentials, secrets, privileged database access, OCR API keys, local configuration, and security boundaries.

Antigravity must use this document when implementing:

* `.env.example`
* `.env.local` loading
* Supabase client initialization
* Mistral OCR client initialization
* Electron main/renderer security boundary
* Settings screen
* Secret storage
* Logging
* Packaging
* Local development configuration
* Production/internal operator configuration

The extractor app is an internal ETL tool, but it must still handle credentials carefully.

## 2. Security Principle

Secrets must never be exposed in the Electron renderer process.

The renderer process is similar to frontend/browser code. It must not directly access:

```text
SUPABASE_SERVICE_ROLE_KEY
MISTRAL_API_KEY
SUPABASE_ACCESS_TOKEN
Authorization headers
Signed upload/download URLs unless specifically needed for display
```

Privileged operations must run in:

```text
Electron main process
or
a secure backend/internal ingestion API
```

For the MVP, privileged operations should run in the Electron main process.

## 3. Existing Wifran Environment Context

The existing Wifran app uses Supabase environment variables such as:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ACCESS_TOKEN
```

The extractor app should not directly copy the frontend naming style from the Wifran web app.

Because this is a desktop ETL utility, use extractor-specific variable names:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
MISTRAL_API_KEY
MISTRAL_OCR_MODEL
MISTRAL_OCR_ENDPOINT
```

Do not copy any actual secret values into documentation or committed files.

## 4. Required `.env.local` File

During development, the app should read configuration from:

```text
.env.local
```

This file must exist locally on the developer/operator machine but must never be committed to git.

Antigravity must add `.env.local` to `.gitignore`.

## 5. Required `.env.example` File

Antigravity must create a safe example file:

```text
.env.example
```

This file should contain placeholder values only.

Recommended content:

```env
# ============================================================
# Wifran Offers Extractor - Environment Example
# Copy this file to .env.local and fill in real values locally.
# Never commit .env.local.
# ============================================================

# ----------------------------
# Supabase
# ----------------------------
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_STORAGE_BUCKET=offer-images

# Optional if needed for schema/type generation or Supabase CLI workflows
SUPABASE_ACCESS_TOKEN=

# ----------------------------
# Mistral OCR
# ----------------------------
MISTRAL_API_KEY=your-mistral-api-key
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_OCR_ENDPOINT=https://api.mistral.ai/v1/ocr

# ----------------------------
# OCR Processing
# ----------------------------
OCR_CHUNK_SIZE=2
OCR_MAX_CONCURRENT_REQUESTS=3
OCR_MAX_RETRIES=3
OCR_RETRY_BASE_DELAY_MS=1000
OCR_REQUEST_TIMEOUT_MS=120000
OCR_CONFIDENCE_GRANULARITY=page
OCR_TABLE_FORMAT=markdown

# ----------------------------
# PDF and Image Processing
# ----------------------------
PDF_RENDER_DPI=200
IMAGE_CROP_PADDING_PERCENT=8
IMAGE_OUTPUT_FORMAT=jpg
IMAGE_OUTPUT_QUALITY=85

# ----------------------------
# Import Behavior
# ----------------------------
DEFAULT_OFFER_DURATION_DAYS=7
DEFAULT_OFFER_STATUS=draft
LOW_CONFIDENCE_THRESHOLD=0.75
DATA_QUALITY_NEEDS_REVIEW_THRESHOLD=70
SKIP_DUPLICATE_OFFERS=true
AUTO_CREATE_BRANDS=true
AUTO_CREATE_PRODUCTS=true
AUTO_CREATE_CATEGORIES=false
REQUIRE_IMAGE_FOR_DRAFT=false

# ----------------------------
# Debugging
# ----------------------------
DEBUG_SAVE_INTERMEDIATE_FILES=true
LOG_LEVEL=info
```

## 6. `.gitignore` Requirements

Antigravity must ensure `.gitignore` includes:

```gitignore
# Environment files
.env
.env.local
.env.*.local

# Logs
logs/
*.log

# Local import workspaces
imports/
tmp/
temp/

# Debug OCR/PDF/image output
debug/
ocr-debug/
pdf-debug/
image-debug/

# Build output
dist/
release/
out/

# Dependencies
node_modules/
```

Do not commit real credentials, local OCR outputs, raw PDFs, cropped images, or logs that may contain sensitive paths or data.

## 7. Required Environment Variables

### 7.1 `SUPABASE_URL`

Purpose:

```text
Base URL of the Wifran Supabase project.
```

Used by:

```text
Supabase client initialization
Reference data loading
Database sync
Storage upload
```

Required:

```text
yes
```

Example placeholder:

```text
https://your-project.supabase.co
```

### 7.2 `SUPABASE_SERVICE_ROLE_KEY`

Purpose:

```text
Privileged Supabase key used for administrative database and storage operations.
```

Used by:

```text
Electron main process only
Import batch creation
Offer source creation
Import row creation
Validation error creation
Brand/product creation
Offer creation
Storage upload
Audit logging
```

Required for MVP:

```text
yes
```

Security rules:

```text
Never expose to renderer.
Never log.
Never commit.
Never pass through UI state.
Never send to frontend components.
Never store in localStorage.
```

### 7.3 `SUPABASE_ANON_KEY`

Purpose:

```text
Optional non-privileged Supabase key.
```

Used by:

```text
Safe read-only operations if needed
Future auth-based workflows
```

Required for MVP:

```text
optional
```

MVP note:

The service role key is enough for internal privileged operations if all Supabase work is performed in the main process.

### 7.4 `SUPABASE_STORAGE_BUCKET`

Purpose:

```text
Name of the Supabase Storage bucket used for cropped offer item images.
```

Required:

```text
yes
```

Recommended value:

```text
offer-images
```

If the existing Wifran project already uses a different bucket name, use that existing bucket name.

### 7.5 `SUPABASE_ACCESS_TOKEN`

Purpose:

```text
Optional token for Supabase CLI or type generation workflows.
```

Required for app runtime:

```text
no
```

Security rules:

```text
Do not use in renderer.
Do not log.
Do not commit.
```

## 8. Mistral Environment Variables

### 8.1 `MISTRAL_API_KEY`

Purpose:

```text
API key used to call Mistral OCR.
```

Required:

```text
yes
```

Security rules:

```text
Never expose to renderer.
Never log.
Never commit.
Never pass through UI state.
Never store in localStorage.
Never include in error messages.
```

### 8.2 `MISTRAL_OCR_MODEL`

Purpose:

```text
Mistral OCR model name.
```

Required:

```text
yes
```

Default:

```text
mistral-ocr-latest
```

### 8.3 `MISTRAL_OCR_ENDPOINT`

Purpose:

```text
Mistral OCR API endpoint.
```

Required:

```text
yes
```

Default:

```text
https://api.mistral.ai/v1/ocr
```

## 9. OCR Processing Variables

### 9.1 `OCR_CHUNK_SIZE`

Purpose:

```text
Number of original PDF pages per OCR request.
```

Default:

```text
2
```

Allowed range:

```text
1 to 3
```

Notes:

* Use `1` for very dense leaflets.
* Use `2` as a safe default.
* Use `3` only if output remains reliable.

### 9.2 `OCR_MAX_CONCURRENT_REQUESTS`

Purpose:

```text
Maximum number of OCR requests running at the same time.
```

Default:

```text
3
```

Allowed practical range:

```text
1 to 4
```

Do not use unlimited concurrency.

### 9.3 `OCR_MAX_RETRIES`

Purpose:

```text
Maximum retry attempts for temporary OCR failures.
```

Default:

```text
3
```

### 9.4 `OCR_RETRY_BASE_DELAY_MS`

Purpose:

```text
Base delay for exponential backoff retry.
```

Default:

```text
1000
```

### 9.5 `OCR_REQUEST_TIMEOUT_MS`

Purpose:

```text
Timeout for each OCR request.
```

Default:

```text
120000
```

### 9.6 `OCR_CONFIDENCE_GRANULARITY`

Purpose:

```text
Mistral OCR confidence score granularity.
```

Default:

```text
page
```

Allowed values may include:

```text
page
word
```

Use page-level confidence for MVP.

### 9.7 `OCR_TABLE_FORMAT`

Purpose:

```text
Format for OCR table output if tables are detected.
```

Default:

```text
markdown
```

## 10. PDF and Image Variables

### 10.1 `PDF_RENDER_DPI`

Purpose:

```text
DPI used when rendering PDF pages into images for cropping.
```

Default:

```text
200
```

Allowed practical values:

```text
150
200
300
```

MVP recommendation:

```text
200
```

### 10.2 `IMAGE_CROP_PADDING_PERCENT`

Purpose:

```text
Padding added around OCR bounding boxes before cropping.
```

Default:

```text
8
```

Allowed practical range:

```text
0 to 15
```

### 10.3 `IMAGE_OUTPUT_FORMAT`

Purpose:

```text
Image format for cropped offer item images.
```

Default:

```text
jpg
```

Recommended:

```text
jpg
```

### 10.4 `IMAGE_OUTPUT_QUALITY`

Purpose:

```text
JPEG quality for cropped item images.
```

Default:

```text
85
```

Allowed practical range:

```text
75 to 95
```

## 11. Import Behavior Variables

### 11.1 `DEFAULT_OFFER_DURATION_DAYS`

Purpose:

```text
Default number of days between offer start date and end date.
```

Default:

```text
7
```

### 11.2 `DEFAULT_OFFER_STATUS`

Purpose:

```text
Default status for imported valid offers.
```

Default:

```text
draft
```

Allowed values should match Wifran DB constraints:

```text
draft
needs_review
approved
published
expired
rejected
```

MVP rule:

```text
Use draft by default.
Do not automatically publish offers.
```

### 11.3 `LOW_CONFIDENCE_THRESHOLD`

Purpose:

```text
Minimum acceptable OCR confidence before a row needs review.
```

Default:

```text
0.75
```

### 11.4 `DATA_QUALITY_NEEDS_REVIEW_THRESHOLD`

Purpose:

```text
Minimum data quality score needed to create draft instead of needs_review.
```

Default:

```text
70
```

Rows below this threshold should become:

```text
needs_review
```

### 11.5 `SKIP_DUPLICATE_OFFERS`

Purpose:

```text
Whether likely duplicate offers should be skipped instead of inserted.
```

Default:

```text
true
```

### 11.6 `AUTO_CREATE_BRANDS`

Purpose:

```text
Whether the app may create missing brands automatically.
```

Default:

```text
true
```

### 11.7 `AUTO_CREATE_PRODUCTS`

Purpose:

```text
Whether the app may create missing products automatically.
```

Default:

```text
true
```

### 11.8 `AUTO_CREATE_CATEGORIES`

Purpose:

```text
Whether the app may create missing categories automatically.
```

Default:

```text
false
```

MVP recommendation:

```text
Do not auto-create categories.
```

### 11.9 `REQUIRE_IMAGE_FOR_DRAFT`

Purpose:

```text
Whether a valid cropped image is required before an offer can be created as draft.
```

Default:

```text
false
```

Recommended behavior:

* If `false`, missing image creates `needs_review`.
* If `true`, missing image blocks offer creation or keeps row as warning/error.

## 12. Debug Variables

### 12.1 `DEBUG_SAVE_INTERMEDIATE_FILES`

Purpose:

```text
Whether to save PDF chunks, rendered pages, OCR responses, parsed JSON, normalized rows, and cropped images locally.
```

Default for development:

```text
true
```

Default for packaged/internal use:

```text
false
```

### 12.2 `LOG_LEVEL`

Purpose:

```text
Controls log verbosity.
```

Default:

```text
info
```

Allowed values:

```text
debug
info
warn
error
```

## 13. Environment Loading Rules

Antigravity should implement a config module.

Recommended file:

```text
src/main/config/env.ts
```

Responsibilities:

1. Load `.env.local` during development.
2. Read environment variables.
3. Apply safe defaults.
4. Validate required variables.
5. Validate numeric ranges.
6. Return typed config object.
7. Redact secrets when logging config.

Recommended TypeScript type:

```ts
export type AppConfig = {
  supabase: {
    url: string;
    anonKey?: string;
    serviceRoleKey: string;
    storageBucket: string;
  };
  mistral: {
    apiKey: string;
    ocrModel: string;
    ocrEndpoint: string;
  };
  ocr: {
    chunkSize: number;
    maxConcurrentRequests: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    requestTimeoutMs: number;
    confidenceGranularity: 'page' | 'word';
    tableFormat: 'markdown' | 'html' | 'text';
  };
  pdf: {
    renderDpi: number;
  };
  images: {
    cropPaddingPercent: number;
    outputFormat: 'jpg' | 'png' | 'webp';
    outputQuality: number;
  };
  importBehavior: {
    defaultOfferDurationDays: number;
    defaultOfferStatus: 'draft' | 'needs_review';
    lowConfidenceThreshold: number;
    dataQualityNeedsReviewThreshold: number;
    skipDuplicateOffers: boolean;
    autoCreateBrands: boolean;
    autoCreateProducts: boolean;
    autoCreateCategories: boolean;
    requireImageForDraft: boolean;
  };
  debug: {
    saveIntermediateFiles: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
};
```

## 14. Config Validation Rules

The app must validate configuration before starting extraction.

Required checks:

```text
SUPABASE_URL exists.
SUPABASE_URL is a valid URL.
SUPABASE_SERVICE_ROLE_KEY exists.
SUPABASE_STORAGE_BUCKET exists.
MISTRAL_API_KEY exists.
MISTRAL_OCR_MODEL exists.
MISTRAL_OCR_ENDPOINT exists.
MISTRAL_OCR_ENDPOINT is a valid URL.
OCR_CHUNK_SIZE is between 1 and 3.
OCR_MAX_CONCURRENT_REQUESTS is between 1 and 4.
OCR_MAX_RETRIES is between 0 and 5.
OCR_REQUEST_TIMEOUT_MS is reasonable.
PDF_RENDER_DPI is reasonable.
IMAGE_CROP_PADDING_PERCENT is between 0 and 15.
IMAGE_OUTPUT_QUALITY is between 1 and 100.
```

If validation fails:

* Do not start import.
* Show user-readable error.
* Do not create import batch.
* Do not call Mistral.
* Do not call Supabase.

## 15. Redacted Config Logging

The app may log non-secret config values for debugging.

Safe to log:

```text
SUPABASE_URL
SUPABASE_STORAGE_BUCKET
MISTRAL_OCR_MODEL
MISTRAL_OCR_ENDPOINT
OCR_CHUNK_SIZE
OCR_MAX_CONCURRENT_REQUESTS
PDF_RENDER_DPI
IMAGE_OUTPUT_FORMAT
LOG_LEVEL
```

Never log:

```text
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
SUPABASE_ACCESS_TOKEN
MISTRAL_API_KEY
Authorization headers
Signed URLs
```

If logging config, redact secrets:

```json
{
  "supabase": {
    "url": "https://your-project.supabase.co",
    "serviceRoleKey": "[REDACTED]",
    "storageBucket": "offer-images"
  },
  "mistral": {
    "apiKey": "[REDACTED]",
    "ocrModel": "mistral-ocr-latest"
  }
}
```

## 16. Electron Security Boundary

The app should be structured with a secure Electron architecture.

Recommended structure:

```text
src/
  main/
    config/
    services/
    ocr/
    db/
    storage/
    pipeline/
    ipc/
  renderer/
    components/
    pages/
    hooks/
  shared/
    types/
    schemas/
```

### Main Process Responsibilities

The main process may access:

```text
SUPABASE_SERVICE_ROLE_KEY
MISTRAL_API_KEY
Local file system
PDF files
Rendered page images
Cropped images
Supabase admin client
Mistral OCR client
```

The main process performs:

```text
PDF reading
PDF splitting
Page rendering
OCR calls
Image cropping
Storage upload
Database writes
Import orchestration
```

### Renderer Process Responsibilities

The renderer may access:

```text
Safe UI state
Selected file path returned from file dialog
Progress events
Extracted row summaries
Non-secret settings
```

The renderer must not access:

```text
SUPABASE_SERVICE_ROLE_KEY
MISTRAL_API_KEY
Raw Authorization headers
Full admin Supabase client
```

## 17. IPC Security Rules

Renderer should call main process through safe IPC methods.

Recommended IPC commands:

```text
app:getConfigStatus
app:selectPdfFile
reference:loadSupermarkets
reference:loadLocationsForSupermarket
import:start
import:cancel
import:getStatus
import:getRows
settings:getSafeSettings
settings:updateSafeSettings
```

Do not create IPC methods that return secrets.

Bad IPC examples:

```text
config:getSupabaseServiceRoleKey
config:getMistralApiKey
db:getAdminClient
```

These must not exist.

## 18. Safe Settings Screen

The app may include a Settings screen.

The Settings screen may show and edit non-secret settings:

```text
OCR_CHUNK_SIZE
OCR_MAX_CONCURRENT_REQUESTS
OCR_MAX_RETRIES
PDF_RENDER_DPI
IMAGE_CROP_PADDING_PERCENT
IMAGE_OUTPUT_QUALITY
DEFAULT_OFFER_DURATION_DAYS
LOW_CONFIDENCE_THRESHOLD
DEBUG_SAVE_INTERMEDIATE_FILES
LOG_LEVEL
```

For secret settings, the screen should not reveal existing values.

Acceptable behavior:

```text
Show whether MISTRAL_API_KEY is configured: Yes/No
Show whether SUPABASE_SERVICE_ROLE_KEY is configured: Yes/No
Allow user to paste a new key if implementing local secure storage
Never display the existing full key
```

MVP recommendation:

* Use `.env.local` for secrets.
* Settings screen can show configured/missing status.
* Do not implement editable secret storage unless specifically requested.

## 19. Secret Storage Options

There are three possible approaches.

## 19.1 MVP: `.env.local`

Use `.env.local` for local development and trusted internal usage.

Pros:

* Simple.
* Easy for Antigravity to implement.
* Works well for internal MVP.

Cons:

* Operator must manage local config securely.
* Secrets exist as plaintext on the machine.

Rules:

* Do not commit.
* Keep machine access restricted.
* Keep app for trusted staff only.

## 19.2 Better Internal Version: OS Keychain

Use secure local credential storage such as Windows Credential Manager through a library.

Pros:

* Safer than plaintext `.env.local`.
* Better for packaged app.

Cons:

* More implementation complexity.
* Requires secret setup UI.

Future enhancement.

## 19.3 Best Production Version: Internal Ingestion API

Desktop app authenticates operator and sends data to a secure backend ingestion API.

The backend holds service keys and performs DB/storage operations.

Pros:

* Best security.
* Centralized audit.
* Easier key rotation.

Cons:

* Requires backend API development.
* Larger scope.

Not MVP unless explicitly requested.

## 20. MVP Security Decision

For MVP, use:

```text
.env.local
Electron main process
Supabase service role key
Mistral API key
```

But enforce:

```text
No secrets in renderer.
No secrets in git.
No secrets in logs.
No secrets in IPC responses.
```

## 21. Supabase Client Rules

Create Supabase clients in main process only.

Recommended files:

```text
src/main/db/supabaseAdminClient.ts
src/main/db/supabasePublicClient.ts
```

### Admin Client

Uses:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Responsibilities:

```text
insert/update offer_sources
insert/update import_batches
insert/update import_rows
insert validation_errors
insert/update brands
insert/update products
insert offers
upload images to storage
insert audit_logs if implemented
```

### Public Client

Optional.

Uses:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

Responsibilities:

```text
safe read-only reference data if preferred
```

MVP can use admin client for all Supabase operations inside main process.

## 22. Mistral Client Rules

Create the Mistral client in main process only.

Recommended file:

```text
src/main/ocr/mistralClient.ts
```

Uses:

```text
MISTRAL_API_KEY
MISTRAL_OCR_MODEL
MISTRAL_OCR_ENDPOINT
```

Rules:

* Do not expose client to renderer.
* Do not log API key.
* Do not log full Authorization header.
* Use request timeout.
* Use retry logic.
* Use controlled concurrency.
* Capture usage info when available.

## 23. Original PDF Handling

The selected PDF may contain public supermarket offers, but still treat uploaded files carefully.

Rules:

* Do not upload original PDF unless needed.
* If original PDF is uploaded to storage, store it in a source/private path if possible.
* If public access is not required, keep it private.
* Do not log full local file paths unnecessarily.
* Clean temporary PDF chunks based on debug setting.

Recommended storage path if uploading original PDF:

```text
offer-sources/{supermarket_slug}/{offer_start_date}/{import_batch_id}/original.pdf
```

## 24. Cropped Image Storage Rules

Cropped item images are intended to be used by Wifran offers.

Recommended storage bucket:

```text
SUPABASE_STORAGE_BUCKET
```

Recommended path:

```text
offers/{supermarket_slug}/{offer_start_date}/{import_batch_id}/page-{page_number}/item-{row_number}.jpg
```

Rules:

* Use stable paths.
* Avoid collisions.
* Do not expose service role key during upload.
* Store final URL/path in `offers.image_url`.
* Store upload metadata in `import_rows.normalized_data`.

## 25. Local Workspace Security

Local import workspace may contain:

```text
source PDFs
PDF chunks
rendered page images
cropped item images
OCR responses
parsed JSON
logs
```

Rules:

* Store under app data folder, not source repo.
* Do not store in `project-knowledge`.
* Do not commit.
* Clean successful imports if debug mode is disabled.
* Keep failed import files only if needed for troubleshooting.
* Provide a way to clear old local imports later.

Recommended workspace:

```text
{appData}/wifran-offers-extractor/imports/{import_batch_id}/
```

## 26. Logging Security

Logs are necessary but must not leak secrets.

Do log:

```text
batch id
file name
page count
chunk count
stage
duration
row counts
error codes
HTTP status code
safe messages
```

Do not log:

```text
MISTRAL_API_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
SUPABASE_ACCESS_TOKEN
Authorization headers
signed URLs
full request payloads containing file base64
full local paths if not needed
```

## 27. Error Message Security

User-facing errors should be helpful but safe.

Good:

```text
Mistral API key is missing. Add MISTRAL_API_KEY to .env.local.
Supabase connection failed. Check SUPABASE_URL and service role key.
OCR request failed with HTTP 429. The app will retry after a short delay.
```

Bad:

```text
Mistral key sk-abc123 failed.
Authorization Bearer sk-abc123...
Supabase service role key eyJhbGci...
```

Never show the actual key value.

## 28. Packaging Security

When packaging the app as a Windows executable:

* Do not bundle `.env.local`.
* Do not hardcode secrets into the build.
* Provide a setup guide for placing `.env.local` or configuring secrets.
* Prefer external config file or secure credential storage for real internal use.
* Ensure packaged renderer still cannot access secrets.
* Disable developer tools by default in production build if practical.
* Do not expose Node integration to renderer unless necessary.
* Use context isolation.

Recommended Electron security settings:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  preload: path.join(__dirname, 'preload.js')
}
```

Use a preload script to expose safe IPC only.

## 29. Supabase RLS and Service Role

The Wifran DB uses RLS.

The service role key bypasses RLS.

Because of this:

* Treat service role key as highly sensitive.
* Only use it in trusted main process code.
* Do not let arbitrary renderer input become raw SQL or unsafe DB operations.
* Validate all payloads before database writes.
* Do not expose generic “execute SQL” IPC methods.
* Use specific service functions for specific operations.

Good service methods:

```text
createImportBatch
createOfferSource
insertImportRows
insertValidationError
upsertBrand
upsertProduct
createOffer
uploadOfferImage
```

Bad service methods:

```text
executeSqlFromRenderer
genericDbInsert
rawSupabaseQuery
```

## 30. Input Validation as Security

All renderer inputs must be validated in the main process.

Validate:

```text
selected file path
supermarket_id
city_id
region_id
offer_start_date
offer_end_date
settings values
```

Do not trust renderer data just because it came from the UI.

## 31. File Path Security

The app lets the operator select a PDF from disk.

Rules:

* Use Electron file dialog.
* Only allow `.pdf` selection.
* Confirm the file exists.
* Confirm the app can read it.
* Do not allow renderer to request arbitrary file reads through generic IPC.
* Main process should control file access.
* Do not implement generic “read any file path” IPC.

Good IPC:

```text
app:selectPdfFile
```

Bad IPC:

```text
fs:readFile(path)
```

## 32. Network Security

The app should make network calls only to expected services:

```text
Supabase project URL
Mistral OCR endpoint
Signed storage URLs if used
```

Do not send PDFs or OCR data to unknown endpoints.

## 33. Dependency Security

The app will likely use packages for:

```text
Electron
React
TypeScript
Supabase
Mistral SDK or fetch client
PDF splitting
PDF rendering
Image cropping
Concurrency limiting
Zod validation
Logging
```

Rules:

* Use reputable packages.
* Avoid abandoned packages where possible.
* Avoid packages that require unnecessary native/system permissions.
* Pin major versions where practical.
* Do not add random OCR or upload services.

## 34. Admin Authentication Decision

There are two possible operation modes:

## 34.1 MVP Mode: Local Trusted Operator

The app runs on a trusted machine with `.env.local`.

No login screen required.

Pros:

```text
Simpler
Faster to build
Works for internal MVP
```

Cons:

```text
Less user-level auditability
Secrets on local machine
```

## 34.2 Future Mode: Admin Login

Operator logs in with Wifran admin account.

Pros:

```text
Better auditability
No service role key in desktop app if paired with backend
```

Cons:

```text
Requires auth UI
Requires backend or RLS-aware operations
More complex
```

MVP recommendation:

```text
Use local trusted operator mode.
Do not build login screen unless explicitly requested.
```

## 35. Audit Requirements

Even in MVP local mode, record important actions where possible.

Recommended audit actions:

```text
import_batch_created
ocr_started
ocr_completed
validation_completed
offer_created
offer_skipped_duplicate
offer_skipped_non_product_promotional_area
import_batch_completed
import_batch_failed
```

Audit metadata must not contain secrets.

## 36. Secret Rotation

If a key is exposed:

1. Revoke/rotate the key in the provider dashboard.
2. Replace value in local `.env.local`.
3. Restart the app.
4. Check logs and repo history.
5. Remove leaked logs/files if needed.

The app should make this possible by not hardcoding secrets into source code.

## 37. Required Startup Checks

On startup or before extraction, show configuration readiness.

Example:

```text
Supabase URL: configured
Supabase service key: configured
Storage bucket: configured
Mistral API key: missing
OCR model: mistral-ocr-latest
```

Do not show actual key values.

## 38. Required Pre-Import Checks

Before starting an import, verify:

```text
Supabase config valid.
Mistral config valid.
Storage bucket configured.
Selected PDF valid.
Selected supermarket valid.
Selected location valid.
Date range valid.
Main process can create local workspace.
```

If any check fails, stop early with clear error.

## 39. What Antigravity Must Not Do

Antigravity must not:

* Commit `.env.local`.
* Print secrets in console logs.
* Show full API keys in UI.
* Expose service role key to renderer.
* Expose Mistral API key to renderer.
* Put keys in React components.
* Put keys in preload-exposed APIs.
* Store keys in localStorage.
* Hardcode keys in TypeScript files.
* Use `NEXT_PUBLIC_` names for secret variables.
* Create a generic raw SQL execution IPC.
* Upload PDFs or images to unknown services.
* Package real secrets into the Windows executable.
* Build a login screen unless explicitly instructed.
* Change Wifran RLS policies unless explicitly instructed.

## 40. MVP Implementation Checklist

Antigravity must implement:

```text
.env.example
.gitignore secret rules
typed config loader
config validation
safe config status for renderer
main-process Supabase admin client
main-process Mistral OCR client
secret redaction utility
safe IPC boundaries
no secrets in renderer
basic settings/status UI
pre-import config validation
safe logging
```

## 41. Final Principle

The Wifran Offers Extractor is allowed to be an internal privileged ETL tool, but it must be built as if mistakes can happen.

Keep secrets out of the renderer, out of logs, out of git, and out of packaged source code.

Use the Electron main process as the trusted boundary for the MVP.