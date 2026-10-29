# Antigravity Prompt Chunk 01: Project Setup and Architecture Skeleton

You are working inside the `wifran-offers-extractor` project.

This is a local Windows desktop application for Wifran. It will be used internally to extract supermarket offers from weekly PDF leaflets, send page chunks to Mistral OCR, crop item images locally, validate extracted rows, and sync clean offer records into the existing Wifran Supabase database.

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

Treat these files as the source of truth for this project.

## 2. Goal of This Prompt Chunk

Set up the initial Electron + React + TypeScript project architecture.

This chunk is only for the base project skeleton.

Do **not** implement OCR yet.

Do **not** implement Supabase sync yet.

Do **not** implement PDF splitting yet.

Do **not** implement image cropping yet.

Do **not** add database migrations.

Do **not** create or insert real Wifran offers.

The goal is to create a clean, secure, runnable foundation that later prompt chunks can build on.

## 3. Required Tech Stack

Use:

```text
Electron
React
TypeScript
Node.js
Vite or another modern Electron-compatible build setup
```

Use a structure that cleanly separates:

```text
Electron main process
Electron preload script
React renderer process
Shared types and schemas
```

## 4. Required Folder Structure

Create or organize the project with this structure:

```text
wifran-offers-extractor/
  project-knowledge/
  antigravity-prompts/
  src/
    main/
      config/
      db/
      storage/
      ocr/
      pdf/
      image/
      pipeline/
      ipc/
      logging/
    preload/
    renderer/
      components/
      pages/
      hooks/
      styles/
    shared/
      types/
      schemas/
      fixtures/
  package.json
  tsconfig.json
  README.md
```

It is okay to add build-tool-specific files if needed.

## 5. Electron Main Process Requirements

Create the Electron main process entry point.

The main process should:

* Create the main browser window.
* Load the renderer in development mode.
* Load the built renderer in production mode.
* Use a preload script.
* Use secure default settings.
* Avoid exposing Node.js APIs directly to the renderer.

Use secure `webPreferences`.

Recommended baseline:

```ts
webPreferences: {
  preload: path.join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false
}
```

Do not enable `nodeIntegration` in the renderer.

## 6. Preload Script Requirements

Create a preload script that exposes a minimal safe API through `contextBridge`.

For now, expose only a basic test API, such as:

```ts
window.wifranExtractor = {
  app: {
    getVersion: () => Promise<string>
  }
}
```

Do not expose:

```text
filesystem access
environment variables
Supabase keys
Mistral keys
generic IPC send/invoke
raw database functions
raw shell execution
```

The preload API should be intentionally narrow and safe.

## 7. Renderer Requirements

Create a basic React renderer app.

The initial UI should show:

```text
Wifran Offers Extractor
Internal desktop tool for extracting supermarket offers from PDF leaflets.
```

Add a simple placeholder layout with navigation or tabs for:

```text
Import
Results
Settings
Logs
```

For this chunk, these screens can be placeholders.

The UI does not need to be polished, but it should be usable and clearly structured.

## 8. Shared Types

Create an initial shared type file:

```text
src/shared/types/app.ts
```

Add basic placeholder types:

```ts
export type AppEnvironment = 'development' | 'production';

export type AppHealthStatus = {
  ok: boolean;
  appVersion: string;
  environment: AppEnvironment;
};
```

Do not define the full OCR/import schemas yet. Those will come later.

## 9. Logging Placeholder

Create a simple logging module placeholder:

```text
src/main/logging/logger.ts
```

It can export simple functions:

```ts
info(message: string, meta?: unknown): void
warn(message: string, meta?: unknown): void
error(message: string, meta?: unknown): void
debug(message: string, meta?: unknown): void
```

For now, console logging is acceptable.

Important:

* Add a TODO noting that future chunks must redact secrets before logging.
* Do not log environment variables or secrets.

## 10. IPC Placeholder

Create an IPC registration module:

```text
src/main/ipc/registerIpcHandlers.ts
```

For now, register only safe handlers such as:

```text
app:getVersion
app:getHealth
```

Do not create generic IPC methods.

Do not create methods like:

```text
ipc:sendRaw
fs:readFile
db:query
config:getSecrets
```

## 11. README Requirements

Create or update `README.md`.

The README should include:

* Project name.
* Short description.
* Development setup placeholder.
* Note that this is an internal Wifran ETL desktop tool.
* Note that secrets must not be committed.
* Note that implementation will happen through staged prompt chunks.
* Current status: project skeleton only.

Do not include real API keys.

## 12. Package Scripts

Add useful scripts in `package.json`, such as:

```json
{
  "scripts": {
    "dev": "...",
    "build": "...",
    "typecheck": "...",
    "lint": "..."
  }
}
```

If linting is not fully configured yet, either configure it properly or leave a clear TODO. Do not add broken scripts.

## 13. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode any Supabase keys.
* Do not hardcode any Mistral keys.
* Do not expose environment variables to the renderer.
* Do not expose Node.js APIs to the renderer.
* Do not add database migrations.
* Do not implement OCR calls.
* Do not implement Supabase calls.
* Do not process PDFs yet.
* Do not create offer records.
* Do not create generic IPC methods.

## 14. Acceptance Criteria

This chunk is complete when:

* The project has a clean Electron + React + TypeScript skeleton.
* The app can be started in development mode.
* The Electron window opens successfully.
* The renderer shows the Wifran Offers Extractor placeholder UI.
* The main/preload/renderer separation exists.
* The preload API exposes only safe placeholder functions.
* TypeScript compiles.
* The folder structure is ready for future modules.
* No secrets are present in source code.
* No OCR, Supabase, PDF, or image-processing implementation has been added yet.

## 15. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How to run the app.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.