# Antigravity Prompt Chunk 30: Streaming Page Render and Progressive Grid Editing

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 30. Prompt Chunks 01 to 29 should already have implemented the full extractor app, Mistral free-tier-safe OCR, manual grid crop editor, and pre-DB review workflow.

This chunk changes the PDF preprocessing/manual crop workflow so the operator can start editing page 1 immediately after page 1 finishes rendering, while the app continues rendering the remaining pages in the background.

## 1. Read These Files First

Before coding, read:

```text
src/main/pdf/pdfPreprocessingService.ts
src/main/ipc/pdfIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/shared/types/ocrJob.ts
src/shared/types/manualCrop.ts
src/renderer/hooks/usePdfPreprocessing.ts
src/renderer/hooks/useManualCropLayout.ts
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/components/manual-crop/ManualCropToolbar.tsx
src/renderer/components/manual-crop/ManualCropCanvas.tsx
src/renderer/pages/ImportPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Use the existing project structure and naming where possible.

## 2. Current Problem

The app currently waits until all PDF pages are rendered before opening the manual grid editor.

For large leaflets, this wastes operator time.

Desired behavior:

```text
1. Operator clicks Document Preprocess.
2. App starts rendering pages.
3. As soon as page 1 is rendered, the manual grid editor opens.
4. Operator starts adjusting page 1 boxes immediately.
5. App continues rendering page 2, page 3, page 4, etc. in the background.
6. When operator clicks Next Page:
   - if page 2 is ready, show page 2 immediately.
   - if page 2 is not ready, show a waiting state until page 2 finishes rendering.
7. Continue until all pages are edited.
```

## 3. Goal of This Chunk

Implement progressive/streaming PDF page rendering with manual crop editing.

The app must:

```text
render pages incrementally
emit an event when each page is ready
open the grid editor as soon as page 1 is ready
continue rendering remaining pages in the background
allow operator to edit already-rendered pages
show wait state for pages not yet rendered
show render progress
preserve saved manual crop layouts while rendering continues
support next/previous page navigation
avoid blocking the UI until all pages are rendered
```

Do not change OCR behavior in this chunk.

Do not run OCR in this chunk.

Do not crop item images in this chunk unless the operator later clicks the existing Proceed to Crop + OCR button.

Do not update the DB.

## 4. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/pdfPreprocess.ts
src/main/pdf/streamingPdfRenderService.ts
src/main/pdf/pdfPreprocessingService.ts
src/main/ipc/pdfIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useStreamingPdfRender.ts
src/renderer/hooks/useManualCropLayout.ts
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/components/manual-crop/ManualCropToolbar.tsx
src/renderer/pages/ImportPage.tsx
src/renderer/pages/LogsPage.tsx
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
README.md
```

Adapt paths if the current project structure differs.

## 5. Streaming Render Types

Create or update:

```text
src/shared/types/pdfPreprocess.ts
```

Add types similar to:

```ts
export type RenderedPageInfo = {
  pageNumber: number;
  imagePath: string;
  width: number;
  height: number;
  dpi: number;
  status: 'queued' | 'rendering' | 'rendered' | 'failed';
  error?: {
    code: string;
    message: string;
  } | null;
};

export type StreamingPdfRenderInput = {
  pdfPath: string;
  workspacePath: string;
  dpi: number;
  pageCount?: number | null;
};

export type StreamingPdfRenderProgressEvent = {
  stage:
    | 'started'
    | 'page_queued'
    | 'page_rendering'
    | 'page_rendered'
    | 'page_failed'
    | 'completed'
    | 'partially_completed'
    | 'failed';

  message: string;
  pageNumber?: number;
  renderedPages: number;
  failedPages: number;
  totalPages: number;
  page?: RenderedPageInfo;
};

export type StreamingPdfRenderState = {
  status:
    | 'not_started'
    | 'running'
    | 'completed'
    | 'partially_completed'
    | 'failed';

  totalPages: number;
  renderedPages: number;
  failedPages: number;
  pages: RenderedPageInfo[];
  firstPageReady: boolean;
  startedAt?: string | null;
  completedAt?: string | null;
};
```

Preserve backward compatibility with existing preprocessing result types where possible.

## 6. Main Process Streaming Render Service

Create:

```text
src/main/pdf/streamingPdfRenderService.ts
```

Implement a streaming renderer such as:

```ts
export async function renderPdfPagesStreaming(
  input: StreamingPdfRenderInput,
  onProgress?: (event: StreamingPdfRenderProgressEvent) => void
): Promise<StreamingPdfRenderState>;
```

Behavior:

```text
1. Determine total page count.
2. Emit started event.
3. Render pages sequentially or with very low safe concurrency.
4. After each page is rendered, immediately emit page_rendered event with page metadata.
5. Continue rendering remaining pages in the background.
6. If one page fails, mark it failed and continue remaining pages.
7. Return completed/partially_completed/failed final state.
```

Default rendering should be sequential unless existing renderer safely supports concurrency.

Important:

```text
Do not wait for all pages before emitting page 1.
```

## 7. IPC Progress Events

Update:

```text
src/main/ipc/pdfIpc.ts
```

Add or update narrow IPC handlers:

```text
pdf:renderStreaming
pdf:renderStreamingProgress
```

The renderer should be able to:

```text
start streaming render
receive page_rendered events
receive final completed event
```

Do not expose generic filesystem IPC.

Do not expose arbitrary PDF operations.

## 8. Preload API

Update preload to expose safe API:

```ts
window.wifranExtractor.pdf = {
  ...existingPdfApis,

  renderStreaming: (
    input: StreamingPdfRenderInput
  ) => Promise<StreamingPdfRenderState>,

  onRenderStreamingProgress: (
    callback: (event: StreamingPdfRenderProgressEvent) => void
  ) => () => void
};
```

Do not expose raw `ipcRenderer`.

## 9. Renderer Hook

Create:

```text
src/renderer/hooks/useStreamingPdfRender.ts
```

Responsibilities:

```text
start streaming PDF render
track render state
track pages as they become available
track rendered page count
track failed page count
store firstPageReady
store latest progress event
provide getPageStatus(pageNumber)
provide getRenderedPage(pageNumber)
provide reset
```

Recommended return shape:

```ts
{
  running: boolean;
  state: StreamingPdfRenderState | null;
  pages: RenderedPageInfo[];
  renderedPages: number;
  failedPages: number;
  totalPages: number;
  firstPageReady: boolean;
  latestEvent: StreamingPdfRenderProgressEvent | null;
  error: string | null;
  startRender: (input: StreamingPdfRenderInput) => Promise<void>;
  getPageStatus: (pageNumber: number) => RenderedPageInfo | null;
  getRenderedPage: (pageNumber: number) => RenderedPageInfo | null;
  reset: () => void;
}
```

## 10. Import Page Workflow Update

Update:

```text
src/renderer/pages/ImportPage.tsx
```

New behavior after clicking:

```text
Document Preprocess
```

The app should:

```text
start streaming page rendering
show render progress immediately
open Manual Grid Crop Editor as soon as page 1 is rendered
continue receiving rendered pages in background
```

Do not wait until all pages are rendered before opening the crop editor.

Show progress like:

```text
Rendering PDF pages: 1 / 100 ready
Page 2 rendering...
You can start editing page 1 while the remaining pages continue rendering.
```

## 11. Manual Crop Editor Progressive Page Loading

Update Manual Crop Editor so it can work with partially rendered page lists.

It must support these states:

### Page is ready

```text
Display page image.
Display or create initial grid layout.
Allow editing.
Allow Mark Page Complete.
Allow Next Page.
```

### Page is not ready yet

```text
Show waiting screen:
"Page 2 is still rendering. Please wait..."
Display render progress:
"1 / 100 pages ready"
Automatically load page 2 when it becomes ready.
```

### Page failed to render

```text
Show error screen:
"Page 2 failed to render."
Allow retry if a retry render function exists.
Otherwise allow skip page with warning.
```

## 12. Page Navigation Rules

Manual editor navigation:

```text
Previous Page
Next Page
Go to Page
```

When operator clicks `Next Page`:

```text
save current page layout
increment page number
if next page is rendered:
  load it
else:
  show waiting state until rendered
```

When operator clicks `Previous Page`:

```text
save current page layout
load previous rendered page/layout
```

If the operator jumps to a page that is not rendered:

```text
show waiting state for that page
```

## 13. Initial Grid Per Page

When a page becomes available:

```text
if layout already exists:
  load existing layout
else:
  create initial grid using selected default rows/columns
```

The operator’s default rows/columns from PDF selection should apply to every newly rendered page.

Do not overwrite saved manual layouts when page metadata updates.

## 14. Background Render Status in Editor

The Manual Crop Editor should show a compact status bar:

```text
Rendering pages: 12 / 100 ready
Failed: 0
Current page: 3
```

If all pages finish rendering:

```text
All pages rendered.
```

If some pages fail:

```text
98 / 100 pages rendered, 2 failed.
```

## 15. Page Completion Tracking

Manual crop layouts should track completion status per page:

```ts
pageComplete: boolean
completedAt?: string | null
```

Add or update `ManualCropPageLayout` if needed:

```ts
export type ManualCropPageLayout = {
  ...
  pageComplete?: boolean;
  completedAt?: string | null;
};
```

The editor should show:

```text
Page 1: Complete
Page 2: In progress
Page 3: Not started
Page 4: Waiting for render
```

## 16. Proceed to Crop + OCR Gate Update

The `Proceed to Crop + OCR` button should be enabled only when:

```text
all pages are rendered or intentionally skipped
all non-skipped rendered pages have saved layouts
all non-skipped rendered pages are marked complete
each complete page has at least one included box
no page is still rendering
no page is waiting unless skipped
```

If rendering is still in progress, show:

```text
Finish rendering and mark all pages complete before proceeding to Crop + OCR.
```

This keeps the workflow safe.

## 17. Do Not Block Editing While Rendering

The UI must remain responsive while background rendering continues.

Avoid synchronous/blocking renderer code.

Do not render all pages in the renderer process.

PDF rendering should stay in main process or existing safe worker process.

## 18. Logs Page Update

Update logs with messages:

```text
PDF streaming render started.
Page 1 rendered. Opening manual crop editor.
Page 2 rendered in background.
Page 3 failed to render.
All PDF pages rendered.
Operator marked page 1 complete.
Operator moved to page 2.
```

Do not log secrets.

## 19. Error Handling

Handle:

```text
PDF file missing
PDF page count failure
page render failure
page image missing
workspace path missing
streaming render cancellation if existing cancel flow exists
operator navigates to page not yet rendered
operator tries to proceed before all pages complete
```

Use clear error codes:

```text
PDF_STREAM_RENDER_FAILED
PDF_PAGE_RENDER_FAILED
PDF_PAGE_NOT_READY
PDF_PAGE_IMAGE_MISSING
MANUAL_CROP_PAGE_NOT_COMPLETE
MANUAL_CROP_RENDERING_NOT_FINISHED
```

## 20. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
Document Preprocess now renders pages progressively.
Manual crop editor opens after page 1 is ready.
Remaining pages render in the background.
Next Page loads immediately if ready.
If the next page is not ready, the app shows a waiting message.
Proceed to Crop + OCR is available only after rendering and manual page review are complete.
```

## 21. Tests / Smoke Checks

Add tests or smoke checks for:

```text
streaming renderer emits page_rendered after first page
manual editor opens when firstPageReady is true
next page shows ready page if rendered
next page shows waiting state if not rendered
new page creates initial grid once
existing layout is not overwritten
Proceed to Crop + OCR is disabled while pages are still rendering
Proceed to Crop + OCR is disabled if any page is not marked complete
failed rendered page is shown as failed
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If a script does not exist, document it and do not invent success.

## 22. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose generic filesystem IPC.
* Do not expose generic PDF filesystem access.
* Do not upload images in this chunk.
* Do not run OCR in this chunk.
* Do not write to DB in this chunk.
* Do not publish offers in this chunk.
* Only render the selected PDF into the import workspace.

## 23. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 24. Acceptance Criteria

This chunk is complete when:

* Document Preprocess starts streaming page render.
* Page 1 render completion is emitted immediately.
* Manual Crop Editor opens as soon as page 1 is ready.
* Remaining pages continue rendering in background.
* Render progress is visible while editing.
* Next Page opens immediately if rendered.
* Next Page shows wait state if not yet rendered.
* Waiting page automatically loads when render completes.
* Manual layouts are created per page only once.
* Existing manual layouts are not overwritten.
* Operator can mark pages complete.
* Proceed to Crop + OCR is blocked until all required pages are rendered and complete.
* Logs show streaming render progress.
* Documentation explains progressive rendering.
* TypeScript compiles.
* App still starts.

## 25. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How streaming rendering works.
* How page 1 opens immediately.
* How background rendering continues.
* How Next Page behaves when ready/not ready.
* How page completion is tracked.
* How Proceed to Crop + OCR is gated.
* How to test with a multi-page PDF.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.