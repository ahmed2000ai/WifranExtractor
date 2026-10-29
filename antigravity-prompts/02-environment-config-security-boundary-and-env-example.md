# Antigravity Prompt Chunk 02: Environment Config, Security Boundary, and `.env.example`

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 02. Prompt Chunk 01 should already have created the base Electron + React + TypeScript architecture skeleton.

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

Implement secure environment configuration loading and validation.

This chunk should create the foundation for safely handling:

```text
Supabase configuration
Supabase service role key
Supabase storage bucket
Mistral OCR API key
Mistral OCR model
Mistral OCR endpoint
OCR processing settings
PDF/image processing settings
Import behavior settings
Debug/logging settings
```

This chunk must also strengthen the Electron security boundary so secrets stay in the Electron main process and are never exposed to the renderer.

Do **not** implement OCR calls yet.

Do **not** implement Supabase database calls yet.

Do **not** implement PDF processing yet.

Do **not** implement image cropping yet.

Do **not** add database migrations.

Do **not** create or insert real Wifran offers.

## 3. Required Files to Create or Update

Create or update these files:

```text
.env.example
.gitignore
src/main/config/env.ts
src/main/config/redact.ts
src/main/config/configStatus.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/config.ts
src/renderer/pages/SettingsPage.tsx
README.md
```

Adapt paths if the existing project skeleton uses slightly different file names, but preserve the same responsibilities.

## 4. `.env.example` Requirements

Create a safe `.env.example` file.

It must contain placeholders only.

Use this content as the baseline:

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

Do not create `.env.local`.

Do not include real values.

## 5. `.gitignore` Requirements

Ensure `.gitignore` includes:

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

Do not remove useful existing ignore rules.

## 6. Shared Config Types

Create:

```text
src/shared/types/config.ts
```

Add safe shared types that can be used by both main and renderer.

Important: shared renderer-safe types must not include raw secret values.

Add types similar to:

```ts
export type ConfigKeyStatus = {
  configured: boolean;
  required: boolean;
};

export type SafeConfigStatus = {
  supabase: {
    url: ConfigKeyStatus;
    anonKey: ConfigKeyStatus;
    serviceRoleKey: ConfigKeyStatus;
    storageBucket: ConfigKeyStatus;
  };
  mistral: {
    apiKey: ConfigKeyStatus;
    ocrModel: ConfigKeyStatus;
    ocrEndpoint: ConfigKeyStatus;
  };
  ocr: {
    chunkSize: number;
    maxConcurrentRequests: number;
    maxRetries: number;
    requestTimeoutMs: number;
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
  validation: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
};
```

Also create a main-process-only config type in `src/main/config/env.ts` that includes actual secret values.

Do not export the full secret-bearing config type to renderer.

## 7. Environment Loader Requirements

Create:

```text
src/main/config/env.ts
```

This module should:

1. Load `.env.local` in development/local runtime.
2. Read environment variables.
3. Apply safe defaults.
4. Parse booleans and numbers.
5. Validate required variables.
6. Validate numeric ranges.
7. Return a typed config object for main-process services.
8. Provide a safe status object for the renderer.
9. Never log secrets.

Use `dotenv` if needed.

If `dotenv` is not installed, install it.

## 8. Required Main-Only `AppConfig` Type

Inside main config code, define or import a type similar to:

```ts
export type AppConfig = {
  supabase: {
    url: string;
    anonKey?: string;
    serviceRoleKey: string;
    storageBucket: string;
    accessToken?: string;
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

This type may contain secrets and must be used only in the main process.

## 9. Config Validation Rules

Validate:

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
OCR_REQUEST_TIMEOUT_MS is between 10000 and 300000.
PDF_RENDER_DPI is between 100 and 400.
IMAGE_CROP_PADDING_PERCENT is between 0 and 15.
IMAGE_OUTPUT_QUALITY is between 1 and 100.
LOW_CONFIDENCE_THRESHOLD is between 0 and 1.
DATA_QUALITY_NEEDS_REVIEW_THRESHOLD is between 0 and 100.
```

Validation should produce:

```text
errors for missing required config or invalid ranges
warnings for optional missing values such as SUPABASE_ANON_KEY
```

Do not throw immediately on module import unless that is already the project style. Prefer a function that returns validation status so the UI can display missing config clearly.

## 10. Secret Redaction Utility

Create:

```text
src/main/config/redact.ts
```

Implement helpers such as:

```ts
export function redactSecret(value: string | undefined | null): string;
export function redactConfigForLog(config: AppConfig): unknown;
```

Behavior:

```text
undefined/null/empty -> "[MISSING]"
non-empty secret -> "[REDACTED]"
```

For partial display, avoid showing key prefixes unless there is a strong reason. Simple `[REDACTED]` is preferred.

Use this utility anywhere config might be logged.

## 11. Safe Config Status

Create:

```text
src/main/config/configStatus.ts
```

Implement a function that converts main-only config and validation result into `SafeConfigStatus`.

The renderer may see:

```text
whether key is configured
whether key is required
safe numeric settings
safe boolean settings
validation errors/warnings
```

The renderer must never see:

```text
SUPABASE_SERVICE_ROLE_KEY
MISTRAL_API_KEY
SUPABASE_ANON_KEY actual value
SUPABASE_ACCESS_TOKEN
Authorization headers
```

## 12. IPC Requirements

Update:

```text
src/main/ipc/registerIpcHandlers.ts
```

Add safe IPC handlers:

```text
config:getStatus
```

This handler should return only `SafeConfigStatus`.

Keep existing safe app handlers from Prompt Chunk 01, such as:

```text
app:getVersion
app:getHealth
```

Do not add IPC methods that return secrets.

Forbidden IPC handlers:

```text
config:getSupabaseServiceRoleKey
config:getMistralApiKey
config:getRawEnv
db:query
fs:readFile
shell:execute
```

## 13. Preload API Requirements

Update the preload script to expose a safe API such as:

```ts
window.wifranExtractor = {
  app: {
    getVersion: () => Promise<string>,
    getHealth: () => Promise<AppHealthStatus>
  },
  config: {
    getStatus: () => Promise<SafeConfigStatus>
  }
};
```

Do not expose generic `ipcRenderer`.

Do not expose raw environment access.

Do not expose secrets.

Update TypeScript global declarations if the project has them.

## 14. Settings Page Requirements

Update or create:

```text
src/renderer/pages/SettingsPage.tsx
```

The Settings page should show configuration readiness.

It should display:

```text
Supabase URL: configured/missing
Supabase service role key: configured/missing
Supabase storage bucket: configured/missing
Mistral API key: configured/missing
Mistral OCR model: configured/missing
Mistral OCR endpoint: configured/missing
OCR chunk size
OCR max concurrent requests
PDF render DPI
Image output format
Debug intermediate files setting
Validation errors
Validation warnings
```

Do not display actual secret values.

For secret values, only show:

```text
Configured
Missing
Required
Optional
```

## 15. Renderer UI Safety

The renderer must not import main-process config files.

Forbidden in renderer:

```ts
import { getAppConfig } from '../../main/config/env';
```

Renderer should get safe config status only through preload IPC.

## 16. README Update

Update `README.md` with:

* How to copy `.env.example` to `.env.local`.
* Reminder that `.env.local` must never be committed.
* Required environment variables.
* Note that service role key and Mistral key stay in main process only.
* How to run config validation via the app.
* Current status: environment config and security boundary added.

Do not include real keys.

## 17. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets to renderer.
* Do not expose `process.env` to renderer.
* Do not expose generic IPC.
* Do not add OCR calls.
* Do not add Supabase database calls.
* Do not implement file/PDF processing.
* Do not add database migrations.
* Do not create offer records.
* Do not log raw secrets.

## 18. Acceptance Criteria

This chunk is complete when:

* `.env.example` exists with placeholders only.
* `.env.local` is ignored by git.
* Config loader reads environment values in the main process.
* Config validation works.
* Safe config status is available through IPC.
* Settings page shows configured/missing status without revealing secrets.
* Renderer cannot access raw config or secrets.
* TypeScript compiles.
* App still starts.
* Existing Prompt Chunk 01 functionality still works.
* No OCR/Supabase/PDF/image processing logic has been added yet.

## 19. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How config loading works.
* How the renderer gets safe config status.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.
