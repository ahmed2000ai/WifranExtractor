# Antigravity Prompt Chunk 18: Windows Packaging and Operator README

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 18. Prompt Chunks 01 to 17 should already have created the full Wifran Offers Extractor application flow, testing scripts, fixture validation, and manual E2E testing documentation.

This chunk prepares the app for internal Windows use.

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

Also read:

```text
docs/testing/manual-e2e-test-checklist.md
docs/testing/sample-pdf-testing-guide.md
README.md
.env.example
package.json
```

Treat these files as the source of truth.

## 2. Goal of This Prompt Chunk

Prepare the Wifran Offers Extractor for internal Windows desktop use.

This chunk should add:

```text
Windows packaging configuration
operator setup guide
developer setup guide updates
production/internal-use security reminders
.env.local setup instructions
troubleshooting guide
known limitations
final pre-release checklist
safe build scripts
```

The packaged app must not include real credentials.

Do **not** hardcode secrets.

Do **not** bundle `.env.local`.

Do **not** publish offers automatically.

Do **not** add database migrations.

Do **not** delete existing Wifran data.

Do **not** modify customer/user tables.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
docs/operator/operator-setup-guide.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/operator/release-checklist.md
docs/developer/developer-setup-guide.md
docs/developer/security-notes.md
docs/developer/packaging-notes.md
README.md
package.json
.env.example
.gitignore
```

Also update packaging/build config files depending on the existing stack, such as:

```text
electron-builder.yml
electron-builder.json
electron.vite.config.ts
vite.config.ts
forge.config.ts
```

Use the packaging system already present in the project if one exists.

If no packaging system exists, add one appropriate for the current Electron stack.

## 4. Recommended Packaging Tool

Use the packaging tool that best fits the project’s existing setup.

Acceptable options:

```text
electron-builder
Electron Forge
existing Electron/Vite packaging setup
```

If the project already uses one, do not replace it without reason.

If no packaging setup exists, prefer `electron-builder` for Windows packaging unless the current stack strongly suggests another tool.

## 5. Windows Build Requirements

Add a Windows packaging script.

Recommended package scripts:

```json
{
  "scripts": {
    "dist:win": "...",
    "pack:win": "...",
    "build": "...",
    "typecheck": "...",
    "test": "..."
  }
}
```

Rules:

* Do not add broken scripts.
* Preserve existing scripts.
* Ensure `typecheck` and tests can still run.
* Build output should go to a predictable folder such as `release/` or `dist/`.
* Make sure build output folders are ignored by git.

## 6. Packaging Security Requirements

The packaged app must not include:

```text
.env.local
real Supabase keys
real Mistral keys
raw local import workspaces
debug OCR outputs
source PDFs
cropped item images
logs
```

Ensure `.gitignore` includes:

```gitignore
.env
.env.local
.env.*.local
imports/
tmp/
temp/
debug/
ocr-debug/
pdf-debug/
image-debug/
logs/
*.log
dist/
release/
out/
```

If packaging includes extra resources, explicitly exclude secrets and local workspaces.

## 7. Runtime Configuration for Packaged App

Document how internal operators should provide configuration.

MVP approach:

```text
Use a local .env.local file or documented external config location.
Do not bundle secrets into the executable.
```

If the existing app config loader only reads `.env.local` from the project root in development, update it so packaged builds can read a safe external configuration path.

Recommended packaged config search order:

```text
1. Environment variables already set in the OS/process.
2. .env.local next to the executable, if practical.
3. .env.local in the app userData/config folder, if implemented.
4. Development project-root .env.local only in development mode.
```

Document the exact final behavior.

Do not expose config values to the renderer.

Renderer may only see configured/missing status.

## 8. Operator Setup Guide

Create:

```text
docs/operator/operator-setup-guide.md
```

Include:

```text
Purpose of the app
Who should use it
Prerequisites
How to install/run the app
How to create .env.local from .env.example
Where to place .env.local for development
Where to place .env.local for packaged/internal use
Required Supabase settings
Required Mistral settings
How to check Settings page readiness
Security reminders
```

Required environment variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
MISTRAL_API_KEY
MISTRAL_OCR_MODEL
MISTRAL_OCR_ENDPOINT
```

Optional/useful variables:

```text
OCR_CHUNK_SIZE
OCR_MAX_CONCURRENT_REQUESTS
OCR_MAX_RETRIES
PDF_RENDER_DPI
IMAGE_CROP_PADDING_PERCENT
DEBUG_SAVE_INTERMEDIATE_FILES
```

Do not include real keys.

## 9. Operator User Guide

Create:

```text
docs/operator/operator-user-guide.md
```

Explain the full workflow:

```text
1. Open the app.
2. Confirm Settings page readiness.
3. Select PDF leaflet.
4. Select supermarket.
5. Select city/region.
6. Set offer start/end dates.
7. Preprocess PDF.
8. Run OCR.
9. Review skipped promotional/banner rows.
10. Crop item images.
11. Save import tracking.
12. Match products/brands/categories.
13. Prepare offers and check duplicates.
14. Sync offers to Wifran.
15. Review Results page.
16. Review created draft/needs_review offers in Wifran.
```

Explain statuses:

```text
valid
warning
error
skipped
duplicate
prepared
needs_review
imported
needs_review_imported
```

Explain that:

```text
Offers are created only as draft or needs_review.
Offers are never automatically published.
Promotional/banner rows are skipped.
Duplicate rows are skipped by default.
Rows with errors do not create offers.
```

## 10. Troubleshooting Guide

Create:

```text
docs/operator/troubleshooting-guide.md
```

Include common problems:

### Configuration

```text
Mistral API key missing
Supabase service role key missing
Storage bucket missing
Settings page shows config errors
```

### Reference Data

```text
Supermarkets do not load
Cities/regions do not appear
Selected supermarket has no mapped locations
```

### PDF Processing

```text
PDF cannot be opened
PDF is password protected
PDF has zero pages
Page rendering fails
PDF preprocessing creates no chunks
```

### OCR

```text
OCR request fails
Mistral returns invalid JSON
OCR extracts zero rows
OCR extracts banners as rows
OCR rate limit / HTTP 429
OCR timeout
```

### Promotional Filtering

```text
A banner was not skipped
A real product was incorrectly skipped
Generic 1+1 rows
Date badges
Sponsor logos
```

### Image Cropping

```text
Missing bounding box
Invalid bounding box
Cropped image missing
Crop includes neighboring items
```

### Database and Sync

```text
Import tracking failed
Brand/product matching failed
Duplicate detected
Image upload failed
Offer insert failed
Import batch final status is failed or partially_imported
```

For every problem, include:

```text
What it means
Likely cause
What to check
Safe next step
```

Do not include secrets in examples.

## 11. Release Checklist

Create:

```text
docs/operator/release-checklist.md
```

Include pre-release checks:

```text
npm install completes
npm run typecheck passes
npm run validate:fixtures passes
npm run test:smoke passes
npm run test passes if available
App starts in dev mode
Settings page shows safe config status
PDF preprocessing works on a small PDF
OCR works on one test chunk
OCR pipeline works on a small PDF
Promotional/banner filtering skips known examples
Image cropping works
Import tracking works
Entity matching works
Offer preparation works
Final sync creates draft/needs_review offers only
No offers are created as published
No secrets appear in renderer
No secrets appear in logs
Packaged Windows build starts
Packaged build can load config
```

Also include a manual approval step:

```text
Operator verifies created draft/needs_review offers in Wifran admin/app before publishing through normal Wifran process.
```

## 12. Developer Setup Guide

Create:

```text
docs/developer/developer-setup-guide.md
```

Include:

```text
Project overview
Install dependencies
Run dev app
Environment setup
Run typecheck
Run fixture validation
Run smoke tests
Run manual E2E checks
Project folder structure
Main/preload/renderer boundary
How to add future prompt chunks or changes safely
```

Explain that secrets must stay in main process.

## 13. Developer Security Notes

Create:

```text
docs/developer/security-notes.md
```

Include:

```text
Supabase service role key is highly sensitive
Mistral API key is sensitive
Renderer must never access secrets
Preload must expose only narrow safe APIs
No generic DB IPC
No generic file IPC
No generic storage IPC
No raw SQL execution IPC
No auto-publish
No destructive DB operations
No creating offers from promotional/banner rows
No logging Authorization headers
No committing .env.local
```

Include examples of forbidden code patterns:

```text
process.env.SUPABASE_SERVICE_ROLE_KEY in renderer
window.ipcRenderer = ipcRenderer
db:query
sql:execute
config:getMistralApiKey
config:getSupabaseServiceRoleKey
```

## 14. Packaging Notes

Create:

```text
docs/developer/packaging-notes.md
```

Include:

```text
Packaging tool used
Windows build command
Output folder
What is included
What is excluded
How config is loaded in packaged app
Known packaging limitations
Native dependency notes, especially PDF rendering and sharp
How to troubleshoot packaged app startup issues
```

If PDF rendering or `sharp` has Windows/native dependency notes, document them here.

## 15. README Update

Update main `README.md` so it becomes the entry point.

It should include:

```text
Project name
Short description
Current status
Quick start for development
How to configure .env.local
How to run tests
How to run dev app
How to build/package Windows app
Links to operator docs
Links to developer docs
Security warning
```

Do not duplicate all docs in README. Link to detailed docs.

## 16. Final `.env.example` Review

Review `.env.example`.

Ensure it includes all variables currently used by the app.

Ensure:

```text
No real values
Clear comments
Safe placeholders
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_OCR_ENDPOINT=https://api.mistral.ai/v1/ocr
DEFAULT_OFFER_STATUS=draft
AUTO_CREATE_CATEGORIES=false
DEBUG_SAVE_INTERMEDIATE_FILES clearly explained
```

## 17. Build-Time Secret Check

If practical, add a simple script or documentation step that checks:

```text
.env.local is not included in package
release build does not contain known placeholder real keys
renderer bundle does not contain SUPABASE_SERVICE_ROLE_KEY
renderer bundle does not contain MISTRAL_API_KEY
```

If adding an automated script is too much for this chunk, add this to the release checklist.

## 18. Production Defaults

For packaged/internal use, recommend safer defaults:

```text
DEBUG_SAVE_INTERMEDIATE_FILES=false
LOG_LEVEL=info
DEFAULT_OFFER_STATUS=draft
AUTO_CREATE_CATEGORIES=false
SKIP_DUPLICATE_OFFERS=true
REQUIRE_IMAGE_FOR_DRAFT=false
```

Document how operators can change them.

## 19. Known Limitations Section

Add known limitations in operator/developer docs:

```text
OCR quality depends on leaflet design and image clarity.
Very dense pages may need OCR_CHUNK_SIZE=1.
Some banners may still require manual review.
Some product/category matching may require cleanup.
The app creates draft/needs_review offers only.
Publishing should happen through normal Wifran review process.
No cloud backend ingestion API exists in MVP.
Secrets are stored locally in .env.local for MVP.
```

## 20. Final Verification Commands

Document final verification commands:

```bash
npm install
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
npm run dev
npm run dist:win
```

Adjust commands to actual scripts.

Do not document commands that do not exist.

## 21. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not include real keys in docs.
* Do not expose secrets in renderer.
* Do not expose `process.env` secrets to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic IPC.
* Do not publish offers automatically.
* Do not use `status = published`.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not modify customer user data.
* Do not create offers from promotional/banner rows.
* Do not bundle `.env.local` into the packaged app.
* Do not include local PDFs, OCR debug files, crops, logs, or import workspaces in packaged output.

## 22. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 23. Acceptance Criteria

This chunk is complete when:

* Windows packaging configuration exists or existing packaging is updated.
* Windows package/build scripts exist and are documented.
* `.env.local` is excluded from git and packaging.
* Operator setup guide exists.
* Operator user guide exists.
* Troubleshooting guide exists.
* Release checklist exists.
* Developer setup guide exists.
* Developer security notes exist.
* Packaging notes exist.
* README links to the new docs.
* `.env.example` is complete and safe.
* Packaged app config loading behavior is documented.
* Build/test commands are documented and accurate.
* No secrets are included in docs or source code.
* TypeScript compiles.
* App still starts.

## 24. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* Packaging tool/config used.
* Windows build commands.
* How packaged config loading works.
* Which operator docs were added.
* Which developer docs were added.
* How secrets are excluded.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.