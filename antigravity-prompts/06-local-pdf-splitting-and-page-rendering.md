# Antigravity Prompt Chunk 06: Local PDF Splitting and Page Rendering

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 06. Prompt Chunks 01 to 05 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, and validated import form with PDF selection.

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

Implement local PDF preprocessing in the Electron main process.

This chunk should add the ability to:

```text
read the selected PDF locally
validate the PDF
get page count
create a local import workspace
copy the original PDF into the workspace
split the PDF into small chunk PDFs
preserve original 1-indexed page numbers
render each PDF page into a high-resolution image
store rendered page dimensions
emit progress events to the renderer
show preprocessing results in the UI
```

This chunk prepares the app for OCR, but it must not call Mistral OCR yet.

Do **not** implement OCR yet.

Do **not** upload anything to Supabase Storage yet.

Do **not** create `offer_sources` yet.

Do **not** create `import_batches` yet.

Do **not** insert `import_rows` yet.

Do **not** insert `offers` yet.

Do **not** crop item images yet.

Do **not** add database migrations.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/main/pdf/pdfTypes.ts
src/main/pdf/pdfWorkspace.ts
src/main/pdf/pdfValidator.ts
src/main/pdf/pdfSplitter.ts
src/main/pdf/pdfRenderer.ts
src/main/pdf/pdfPreprocessService.ts
src/main/ipc/pdfPreprocessIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/pdfPreprocess.ts
src/shared/types/preload.ts
src/renderer/hooks/usePdfPreprocess.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve the same responsibilities.

## 4. Required Packages

Use local libraries only.

Recommended:

```text
pdf-lib
sharp
```

For PDF page rendering, choose a practical Electron/Node-compatible approach. Options include:

```text
pdf-to-img
pdf-poppler
mupdf
pdfjs-dist with canvas support
another stable local renderer
```

Important:

* Prefer a solution that works on Windows.
* Avoid cloud APIs for PDF rendering.
* Avoid OCR libraries for this chunk.
* Keep implementation modular so the renderer can be swapped later if needed.

If a chosen renderer requires system dependencies, document them clearly in README.

## 5. Local Processing Only

This chunk must run entirely locally.

Allowed:

```text
read local PDF selected by the operator
copy PDF into local workspace
split PDF into chunk PDFs
render pages to local images
write local metadata JSON
emit progress events
```

Not allowed:

```text
Mistral OCR calls
Supabase writes
Supabase storage uploads
external PDF processing APIs
external image processing APIs
database migrations
offer creation
```

## 6. Main Process Only

All PDF reading, splitting, rendering, and local file writing must happen in the Electron main process.

The renderer must not get generic file system access.

The renderer may call a narrow IPC method that starts preprocessing for the PDF path selected earlier through the safe file dialog.

Do not expose generic IPC such as:

```text
fs:readFile
fs:writeFile
fs:listDirectory
pdf:processAnyPath
```

Use narrow validated IPC only.

## 7. Shared Types

Create:

```text
src/shared/types/pdfPreprocess.ts
```

Add types similar to:

```ts
export type PdfPreprocessInput = {
  pdfFilePath: string;
  originalFileName: string;
  chunkSize: number;
  renderDpi: number;
};

export type PdfPreprocessProgressStage =
  | 'workspace_created'
  | 'pdf_validating'
  | 'pdf_validated'
  | 'pdf_copying'
  | 'pdf_splitting'
  | 'page_rendering'
  | 'metadata_written'
  | 'completed'
  | 'failed';

export type PdfPreprocessProgressEvent = {
  stage: PdfPreprocessProgressStage;
  message: string;
  current?: number;
  total?: number;
  details?: Record<string, unknown>;
};

export type PdfChunkMetadata = {
  chunkId: string;
  chunkIndex: number;
  chunkPdfPath: string;
  originalPageNumbers: number[];
  firstOriginalPageNumber: number;
  lastOriginalPageNumber: number;
};

export type RenderedPageMetadata = {
  pageNumber: number;
  imagePath: string;
  width: number;
  height: number;
  dpi: number;
};

export type PdfPreprocessResult = {
  ok: boolean;
  workspaceId?: string;
  workspacePath?: string;
  sourcePdfPath?: string;
  originalFileName?: string;
  pageCount?: number;
  chunkSize?: number;
  chunks?: PdfChunkMetadata[];
  renderedPages?: RenderedPageMetadata[];
  metadataPath?: string;
  error?: {
    code: string;
    message: string;
  };
};
```

Do not expose secrets in any of these types.

## 8. Workspace Requirements

Create local import workspace under the app data folder, not inside the source repo.

Recommended path:

```text
{appData}/wifran-offers-extractor/imports/{workspaceId}/
```

Use Electron’s `app.getPath('userData')` or equivalent.

Recommended structure:

```text
imports/{workspaceId}/
  source/
    original.pdf
  chunks/
    chunk-001-pages-001-002.pdf
    chunk-002-pages-003-004.pdf
  pages/
    page-001.png
    page-002.png
  metadata/
    pdf-preprocess-metadata.json
  logs/
```

Rules:

* Do not write generated chunks/pages into `project-knowledge`.
* Do not write generated chunks/pages into `antigravity-prompts`.
* Do not write generated chunks/pages into the repo root by default.
* Ensure workspace paths are created safely.
* Use a unique workspace ID, such as timestamp plus random suffix.
* Use safe file names.

## 9. PDF Validation Requirements

Create:

```text
src/main/pdf/pdfValidator.ts
```

Validate:

```text
file path exists
file extension is .pdf
file size > 0
file can be opened by the PDF library
page count > 0
page count is reasonable
PDF is not password-protected, unless the chosen library provides readable handling
```

Recommended error codes:

```text
PDF_FILE_NOT_FOUND
PDF_EXTENSION_INVALID
PDF_FILE_EMPTY
PDF_READ_ERROR
PDF_PASSWORD_PROTECTED
PDF_PAGE_COUNT_ZERO
PDF_TOO_LARGE
```

If validation fails:

* Return `PdfPreprocessResult.ok = false`.
* Include safe error code/message.
* Do not crash main process.
* Do not expose full stack trace to renderer.

## 10. PDF Splitting Requirements

Create:

```text
src/main/pdf/pdfSplitter.ts
```

Use `pdf-lib` or equivalent.

Input:

```ts
{
  sourcePdfPath: string;
  outputChunksDir: string;
  chunkSize: number;
}
```

Rules:

* `chunkSize` must be between 1 and 3.
* Preserve original 1-indexed page numbers.
* Create chunk PDFs in `chunks/`.
* Each chunk metadata must include original page numbers.
* Do not use 0-indexed page numbers in external metadata.

Example for 5-page PDF and chunk size 2:

```json
[
  {
    "chunkId": "chunk-001",
    "chunkIndex": 1,
    "chunkPdfPath": ".../chunk-001-pages-001-002.pdf",
    "originalPageNumbers": [1, 2],
    "firstOriginalPageNumber": 1,
    "lastOriginalPageNumber": 2
  },
  {
    "chunkId": "chunk-002",
    "chunkIndex": 2,
    "chunkPdfPath": ".../chunk-002-pages-003-004.pdf",
    "originalPageNumbers": [3, 4],
    "firstOriginalPageNumber": 3,
    "lastOriginalPageNumber": 4
  },
  {
    "chunkId": "chunk-003",
    "chunkIndex": 3,
    "chunkPdfPath": ".../chunk-003-pages-005-005.pdf",
    "originalPageNumbers": [5],
    "firstOriginalPageNumber": 5,
    "lastOriginalPageNumber": 5
  }
]
```

## 11. Page Rendering Requirements

Create:

```text
src/main/pdf/pdfRenderer.ts
```

Render each original PDF page to an image.

Recommended output:

```text
pages/page-001.png
pages/page-002.png
```

Default DPI should come from config:

```text
PDF_RENDER_DPI=200
```

Rules:

* Render one image per original page.
* Preserve original 1-indexed page numbers.
* Store image width and height.
* Store DPI used.
* Use a consistent coordinate system:

  * origin at top-left
  * x increases right
  * y increases down
  * units in pixels
* This coordinate system must match future OCR bounding-box normalization and cropping.

If rendering a page fails:

* Record error.
* Continue if possible, unless all pages fail.
* Return warnings/details in result if partial rendering occurs.
* Do not call OCR.

## 12. Metadata File

After successful preprocessing, write:

```text
metadata/pdf-preprocess-metadata.json
```

Include:

```json
{
  "workspaceId": "import-...",
  "originalFileName": "weekly-leaflet.pdf",
  "sourcePdfPath": ".../source/original.pdf",
  "pageCount": 10,
  "chunkSize": 2,
  "renderDpi": 200,
  "chunks": [],
  "renderedPages": [],
  "createdAt": "ISO timestamp"
}
```

This file will be used by later OCR and cropping chunks.

## 13. Preprocess Service

Create:

```text
src/main/pdf/pdfPreprocessService.ts
```

This service should orchestrate:

```text
validate input
create workspace
copy original PDF
split PDF
render pages
write metadata
return result
emit progress
```

Recommended function:

```ts
export async function preprocessPdfForImport(
  input: PdfPreprocessInput,
  onProgress?: (event: PdfPreprocessProgressEvent) => void
): Promise<PdfPreprocessResult>;
```

Do not make this service depend on OCR, Supabase, or image cropping.

## 14. IPC Requirements

Create:

```text
src/main/ipc/pdfPreprocessIpc.ts
```

Add narrow IPC handlers:

```text
pdf:preprocess
```

Input should be `PdfPreprocessInput`.

Validation:

* Confirm `pdfFilePath` exists.
* Confirm extension `.pdf`.
* Clamp or reject invalid `chunkSize`.
* Clamp or reject invalid `renderDpi`.

Output should be `PdfPreprocessResult`.

Progress events:

Use an IPC event channel such as:

```text
pdf:preprocess-progress
```

The renderer should be able to subscribe through preload, not direct `ipcRenderer`.

Do not expose generic file operations.

## 15. Preload API Requirements

Update preload to expose:

```ts
window.wifranExtractor.pdf = {
  preprocess: (input: PdfPreprocessInput) => Promise<PdfPreprocessResult>,
  onPreprocessProgress: (
    callback: (event: PdfPreprocessProgressEvent) => void
  ) => () => void
};
```

The `onPreprocessProgress` function should return an unsubscribe function.

Do not expose raw `ipcRenderer`.

Do not expose arbitrary file access.

## 16. Renderer Hook

Create:

```text
src/renderer/hooks/usePdfPreprocess.ts
```

Responsibilities:

* Start preprocessing through preload.
* Track loading/running state.
* Track progress events.
* Store result.
* Store error.
* Provide a reset function.

Recommended return shape:

```ts
{
  running: boolean;
  progressEvents: PdfPreprocessProgressEvent[];
  latestProgress: PdfPreprocessProgressEvent | null;
  result: PdfPreprocessResult | null;
  error: string | null;
  startPreprocess: (input: PdfPreprocessInput) => Promise<void>;
  reset: () => void;
}
```

## 17. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

Add a “Preprocess PDF” or “Validate & Prepare PDF” button.

This button should be enabled only when:

```text
PDF file is selected
PDF file extension is valid
form metadata is valid enough
config values for OCR_CHUNK_SIZE and PDF_RENDER_DPI are available
```

When clicked:

* Call `pdf.preprocess`.
* Pass selected PDF path, original file name, chunk size, and render DPI.
* Show progress.
* Show result summary.

Result summary should include:

```text
workspace ID
page count
chunk count
rendered page count
workspace path
metadata path
```

The future “Start Extraction” button should still not run OCR yet.

## 18. Logs Page Integration

Update Logs page to display PDF preprocessing progress events, at least in-memory.

Example log messages:

```text
Workspace created.
Validating PDF.
PDF validated: 24 pages.
Splitting PDF into 12 chunks.
Rendered page 1 of 24.
PDF preprocessing completed.
```

No need for persistent log files yet unless already implemented.

## 19. Error Handling Requirements

Handle:

```text
missing selected PDF
invalid extension
file not found
empty file
PDF read error
password-protected PDF
page count zero
split failure
render failure
workspace creation failure
metadata write failure
```

Errors should be user-readable.

Do not expose stack traces in normal UI.

Log safe technical details in main process if useful.

## 20. Config Integration

Use safe config from earlier chunks.

Defaults:

```text
OCR_CHUNK_SIZE=2
PDF_RENDER_DPI=200
```

Validation:

```text
OCR_CHUNK_SIZE must be 1 to 3
PDF_RENDER_DPI should be 100 to 400
```

If config is missing, use safe defaults where appropriate, but show warning if the config status has errors.

## 21. Testing Guidance

Add minimal tests or internal checks if the project already has a test setup.

If no test setup exists yet, structure the code so these can be tested later:

```text
PDF validation
chunk metadata generation
workspace path creation
preprocess result shape
```

Do not introduce a large test framework unless already present.

## 22. README Update

Update README with:

* PDF preprocessing added.
* PDF splitting is local.
* Page rendering is local.
* No OCR calls yet.
* Output workspace location.
* Any renderer/system dependencies.
* How to troubleshoot PDF rendering on Windows if applicable.
* Current limitation: item extraction is not implemented yet.

## 23. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` to renderer.
* Do not expose generic IPC.
* Do not expose generic filesystem APIs.
* Do not let renderer read arbitrary files.
* Do not call Mistral OCR.
* Do not add Supabase writes.
* Do not upload files.
* Do not create import batches.
* Do not create offer sources.
* Do not insert offers.
* Do not create products, brands, or categories.
* Do not add database migrations.
* Do not create offers from banners or promotional areas.

## 24. Acceptance Criteria

This chunk is complete when:

* Main process can validate a selected PDF.
* Main process can get page count.
* Main process can create a local import workspace.
* Main process can copy the original PDF into workspace.
* Main process can split the PDF into chunk PDFs.
* Chunk metadata preserves original 1-indexed page numbers.
* Main process can render each PDF page into an image.
* Rendered page metadata includes width, height, DPI, and page number.
* Metadata JSON is written to workspace.
* Renderer can start preprocessing through safe preload API.
* Renderer receives progress events.
* Import page shows preprocessing result summary.
* Logs page shows preprocessing progress.
* No OCR/Supabase write/image cropping logic has been added.
* Renderer has no generic filesystem access.
* TypeScript compiles.
* App still starts.

## 25. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* Which PDF libraries were used.
* How workspace paths are created.
* How chunking preserves original page numbers.
* How page rendering works.
* Any Windows/system dependency notes.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.