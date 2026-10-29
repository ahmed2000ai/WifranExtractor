# Antigravity Prompt Chunk 32: Delete Box and Background Page Cropping on Navigation

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 32. Prompt Chunks 28 to 31 should already have added the manual crop editor, streaming page rendering, next-page layout carryover, and right-click grid/row/column generation from a fitted box.

This chunk adds two important workflow improvements:

```text
1. Add a right-click Delete action for crop boxes.
2. When the operator navigates away from a page, start cropping that page’s item images in the background using the current boxes.
```

The goal is to make manual cleanup fast and to start producing local item crop images while the operator continues editing later pages.

## 1. Read These Files First

Before coding, read the current manual crop editor and crop services.

Read files similar to:

```text
src/shared/types/manualCrop.ts
src/shared/utils/manualCropGeometry.ts
src/shared/utils/manualCropOrdering.ts
src/shared/utils/manualCropStructure.ts
src/shared/utils/manualCropTemplateGrid.ts
src/main/image/manualCropService.ts
src/main/ipc/manualCropIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useManualCropLayout.ts
src/renderer/hooks/useStreamingPdfRender.ts
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/components/manual-crop/ManualCropToolbar.tsx
src/renderer/components/manual-crop/ManualCropCanvas.tsx
src/renderer/components/manual-crop/ManualCropBoxList.tsx
src/renderer/components/manual-crop/ManualCropThumbnailPreview.tsx
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Also inspect any crop/review workflow files created in earlier chunks, such as:

```text
src/main/workflow/cropAndItemOcrWorkflow.ts
src/shared/types/reviewWorkflow.ts
src/shared/types/itemOcr.ts
src/renderer/components/review/PreDbReviewSummary.tsx
```

Adapt paths if the current project structure differs.

## 2. Main Goal

Implement:

```text
Right-click Delete Box
```

and background page cropping on navigation:

```text
Operator edits page N
→ clicks Next Page or Previous Page
→ app saves page N layout
→ app starts cropping page N in the background
→ app opens target page immediately if available
→ operator continues editing while crop generation runs
```

Cropping must use the current page’s boxes exactly as they exist when the operator leaves the page.

## 3. Right-Click Delete Box

Add this action to the crop box right-click menu:

```text
Delete Box
```

If the context menu is obviously box-specific, the label may simply be:

```text
Delete
```

Behavior:

```text
1. Take an undo snapshot.
2. Delete the selected box from the visible/current page layout.
3. Update the live row/column structure record.
4. Renumber remaining included boxes.
5. Mark page crops as stale because the layout changed.
6. Save the page layout.
```

No confirmation dialog.

Undo must restore the deleted box and the previous row/column structure.

## 4. Keyboard Delete Shortcut

Support:

```text
Delete
Backspace
```

When one or more boxes are selected, these keys should delete the selected boxes.

Rules:

```text
Do not trigger delete shortcut while the operator is typing in an input, textarea, select, or editable field.
If multiple box selection already exists, delete all selected boxes.
If only single selection exists, delete the active selected box.
Take one undo snapshot for the whole delete operation.
Update row/column structure once after the delete operation.
Renumber after delete.
Mark crops stale.
Save layout.
```

## 5. Delete and Row/Column Structure Record

The manual crop editor should already maintain a live row/column structure record from Chunk 31.

When a box is deleted:

```text
remove it from visible/included boxes
remove or deactivate its id in its row record
remove or deactivate its id in its column record
if a row has no included boxes left, remove or mark that row inactive
if a column has no included boxes left, remove or mark that column inactive
update row/column counts
renumber included boxes
validate layout structure
```

The live row/column record must reflect the actual layout immediately after deletion.

This is important because:

```text
Generate Row From This Box default Columns
```

and:

```text
Generate Column From This Box default Rows
```

must use the updated record.

## 6. Background Cropping on Page Navigation

When the operator leaves a page by clicking:

```text
Next Page
Previous Page
Go to Page
```

the app must:

```text
1. Save the current page layout.
2. Start background cropping for the page being left.
3. Navigate to the target page without waiting for cropping to finish.
```

Do not block navigation while cropping.

Do not block editing on the next page.

Cropping should run in the main process or existing safe worker/service, not synchronously in the renderer.

## 7. Cropping Must Use Current Page Boxes

For the page being cropped:

```text
crop exactly one image per included box
do not crop deleted boxes
do not crop excluded boxes
do not crop outside the selected box boundaries
do not expand the crop beyond the box
do not use Mistral coordinates
do not use OCR coordinates
do not infer additional crop regions
```

The generated image count must equal the number of included boxes on that page at crop start.

If count mismatch occurs, mark the page crop status as warning/error.

Example:

```text
Page 36 has 14 included boxes.
Background crop for page 36 must generate exactly 14 images.
```

## 8. Crop Image Filename Format

Generated crop files must use this naming pattern:

```text
{pdf_base_name}_{PPP}_{BBB}.webp
```

Where:

```text
pdf_base_name = original PDF filename without extension, sanitized for filesystem use
PPP = page number, zero-padded to 3 digits
BBB = box/item number, zero-padded to 3 digits
```

Examples:

```text
othaim-weekly-offers_001_001.webp
othaim-weekly-offers_001_002.webp
othaim-weekly-offers_036_014.webp
```

If the PDF filename is:

```text
Othaim Offers July.pdf
```

then sanitized base name should be something like:

```text
Othaim-Offers-July
```

or:

```text
othaim-offers-july
```

Use the app’s existing filename sanitization conventions if available.

Do not include unsafe characters in crop filenames.

## 9. Crop Output Folder

Save generated item images inside the local import workspace.

Recommended structure:

```text
workspace/
  manual-crops/
    page-001/
      {pdf_base_name}_001_001.webp
      {pdf_base_name}_001_002.webp
    page-002/
      {pdf_base_name}_002_001.webp
```

Use per-page folders.

If existing crop output folders already exist, adapt but preserve:

```text
local paths are visible for review
filenames follow {pdf_base_name}_{PPP}_{BBB}.webp
```

## 10. Crop Status Model

Extend manual crop/review types to track crop generation status per page.

Create or update types similar to:

```ts
export type ManualPageCropStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'ready'
  | 'stale'
  | 'failed'
  | 'warning';

export type ManualPageCropInfo = {
  pageNumber: number;
  status: ManualPageCropStatus;
  expectedCropCount: number;
  generatedCropCount: number;
  outputDir: string | null;
  cropFiles: Array<{
    pageNumber: number;
    itemNumber: string;
    boxId: string;
    localImagePath: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: {
    code: string;
    message: string;
  } | null;
  warning?: {
    code: string;
    message: string;
  } | null;
};
```

Store status in the local import workspace, or in the manual crop session state, whichever fits the current architecture.

## 11. Stale Crop Handling

If a page layout changes after crops were generated, mark that page crops as:

```text
stale
```

Actions that should mark page crops stale:

```text
move box
resize box
delete box
add box
duplicate box
merge boxes
split box
Generate Grid From This Box
Generate Row From This Box
Generate Column From This Box
renumber boxes if filenames/item numbers would change
restore from undo/redo if layout differs from crop state
```

When leaving a stale page, regenerate its crops.

Default behavior:

```text
overwrite the existing crop files for that page using the same filenames
update crop status to ready after successful regeneration
```

Before writing new crops for a page, safely clear or overwrite previous files in that page’s manual crop output folder.

Do not leave stale extra files that no longer correspond to current boxes.

## 12. Background Crop Queue

Create or update a background crop queue.

Recommended file:

```text
src/main/workflow/backgroundPageCropQueue.ts
```

or integrate into existing manual crop service.

Required behavior:

```text
enqueue page crop job
deduplicate jobs per page
if a page is already queued/running and layout changes, mark it needs rerun
process crop jobs sequentially by default
do not block renderer navigation
emit progress events
continue if one page crop fails
```

Sequential cropping is safer and simpler. Do not add unnecessary concurrency unless existing image processing is already safely concurrent.

## 13. Background Crop Progress Events

Emit progress events such as:

```text
manualCrop:pageCropQueued
manualCrop:pageCropStarted
manualCrop:itemCropCompleted
manualCrop:pageCropCompleted
manualCrop:pageCropFailed
manualCrop:pageCropWarning
manualCrop:pageCropStale
```

Or use the existing event naming conventions.

Each progress event should include:

```ts
{
  pageNumber: number;
  status: ManualPageCropStatus;
  expectedCropCount?: number;
  generatedCropCount?: number;
  currentItemNumber?: string;
  localImagePath?: string;
  outputDir?: string;
  message: string;
}
```

Expose these events to the renderer through preload safely.

Do not expose raw `ipcRenderer`.

## 14. Renderer UI Crop Status

Update the manual crop editor UI to show crop status.

Examples:

```text
Page 1 crops: 14 / 14 ready
Page 2 crops: not started
Page 3 crops: stale
Cropping in background: page 4, 8 / 14 images
```

The UI should not block page editing while cropping.

If cropping fails, show:

```text
Page 4 crop failed: [message]
```

If crop count mismatch occurs, show:

```text
Page 4 crop warning: expected 14 images, generated 13.
```

## 15. Navigation Behavior

Update these navigation actions:

```text
Next Page
Previous Page
Go to Page
```

When invoked:

```text
1. Persist current page layout.
2. If current page has at least one included box, enqueue background crop for current page.
3. Navigate to target page.
4. If target page is rendered, show it.
5. If target page is not rendered yet, show waiting state as implemented in streaming render workflow.
```

If the current page has zero included boxes:

```text
do not crop
mark crop status warning or not_started
show message: "Page N has no included boxes to crop."
```

## 16. Proceed to Crop + OCR Gate Update

Because crops now generate in the background while navigating, the final:

```text
Proceed to Crop + OCR
```

step should not blindly recrop everything unless necessary.

Before OCR starts, verify:

```text
all completed/manual-reviewed pages have fresh crop status ready
generated crop count equals included box count for each page
all expected crop files exist
```

If some page crops are missing or stale:

```text
regenerate only missing/stale pages
wait for those page crop jobs to finish
then proceed to OCR
```

Do not OCR stale or missing crop images.

## 17. OCR Workflow Integration

The item OCR workflow should consume the crop files generated by background page cropping.

Rules:

```text
Use existing fresh crop files when available.
Do not regenerate fresh crops unnecessarily.
If page crop status is stale/missing, regenerate before OCR.
OCR should only use local image paths from the latest crop status.
```

This keeps the final workflow fast.

## 18. Local Review Summary Must Include Crop Paths

Ensure the pre-DB review summary continues to include the local path of every generated crop file.

For every review item, include:

```text
page_number
item_number
local_image_path
crop_box
ocr_status
ocr result if completed
```

The `local_image_path` should point to the new filename pattern:

```text
{pdf_base_name}_{PPP}_{BBB}.webp
```

## 19. Crop Count Integrity

For each page crop job:

```text
expectedCropCount = number of included boxes at the time the crop job starts
generatedCropCount = number of successfully generated image files
```

After crop job completes:

```text
if generatedCropCount === expectedCropCount:
  status = ready

if generatedCropCount < expectedCropCount:
  status = warning or failed, depending on severity

if generatedCropCount > expectedCropCount:
  status = warning and investigate because this should not happen
```

A page should not be considered crop-ready unless:

```text
generatedCropCount === expectedCropCount
all crop files exist
```

## 20. Crop Boundaries

The crop operation must crop only the pixels inside each box:

```text
x
y
width
height
```

Do not add padding.

Do not crop surrounding area.

Do not use page margins.

Do not include full row/column unless the box includes it.

If a box extends outside the page:

```text
reject that specific crop with MANUAL_CROP_BOX_OUT_OF_PAGE
continue remaining boxes
mark page status warning or failed
```

Do not silently clamp unless the existing app explicitly supports safe clamping and logs it. Preferred behavior is strict rejection.

## 21. File Overwrite Rules

When regenerating crops for a page:

```text
clear the page's manual-crops/page-PPP folder first
write fresh crops
update crop status
```

This prevents old crop files from remaining after boxes are deleted.

Example:

```text
Page 1 originally had 16 boxes and generated 16 files.
Operator deletes 2 boxes.
Page is marked stale.
On next navigation away from page 1, clear page-001 crop folder.
Generate 14 files.
Status should be ready with 14 / 14.
```

## 22. Error Codes

Use clear errors:

```text
MANUAL_CROP_SELECTED_BOX_NOT_FOUND
MANUAL_CROP_BOX_DELETE_FAILED
MANUAL_CROP_PAGE_LAYOUT_MISSING
MANUAL_CROP_PAGE_IMAGE_MISSING
MANUAL_CROP_NO_INCLUDED_BOXES
MANUAL_CROP_BOX_OUT_OF_PAGE
MANUAL_CROP_BOX_TOO_SMALL
MANUAL_CROP_OUTPUT_DIR_FAILED
MANUAL_CROP_IMAGE_WRITE_FAILED
MANUAL_CROP_COUNT_MISMATCH
MANUAL_CROP_BACKGROUND_JOB_FAILED
```

Avoid generic “unknown crop error.”

## 23. Tests / Smoke Checks

Add tests or smoke checks for:

```text
Right-click Delete removes selected box.
Delete shortcut removes selected box.
Deleting multiple selected boxes works if multi-select exists.
Deleting a box updates row/column structure record.
Deleting a box renumbers remaining boxes.
Deleting a box marks crop status stale.
Next Page saves current layout.
Next Page enqueues background crop for current page.
Previous Page enqueues background crop for current page.
Go to Page enqueues background crop for current page.
Navigation does not wait for crop completion.
Crop output count equals included box count.
Deleted boxes are not cropped.
Excluded boxes are not cropped.
Crop filenames use {pdf_base_name}_{PPP}_{BBB}.webp.
Regenerating a stale page clears old extra files.
Proceed to Crop + OCR reuses fresh crop files.
Proceed to Crop + OCR regenerates only stale/missing page crops.
Review summary includes local crop image paths.
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If any script does not exist, document that clearly and do not invent success.

## 24. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
how to delete a box with right-click
how to delete selected boxes with Delete/Backspace
how background cropping starts when leaving a page
where generated crop files are saved
how crop filenames are built
how to know whether page crops are ready/stale/failed
what happens if a page layout changes after crops were generated
how Proceed to Crop + OCR reuses existing fresh crops
```

Add example:

```text
Example: page 36 has 14 crop boxes

1. Finish adjusting boxes on page 36.
2. Click Next Page.
3. The app saves page 36 layout.
4. The app starts cropping page 36 in the background.
5. It writes 14 files:
   - othaim-weekly-offers_036_001.webp
   - othaim-weekly-offers_036_002.webp
   - ...
   - othaim-weekly-offers_036_014.webp
6. You can continue editing page 37 while page 36 crops are generated.
7. If you return to page 36 and delete a box, the page crop status becomes stale.
8. When you leave page 36 again, the app regenerates page 36 with the new box count.
```

## 25. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose raw `ipcRenderer`.
* Do not expose generic filesystem IPC.
* Do not upload images in this chunk.
* Do not run OCR in this chunk unless an existing final OCR step is explicitly triggered by the operator.
* Do not write to DB in this chunk.
* Do not publish offers in this chunk.
* Only write crop images inside the import workspace.
* Only crop from the rendered page image selected by the current page layout.

## 26. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 27. Acceptance Criteria

This chunk is complete when:

* Crop box right-click menu includes Delete Box or Delete.
* Delete action removes the selected box immediately.
* Delete/Backspace key removes selected box or boxes.
* Delete takes an undo snapshot.
* Undo restores deleted boxes.
* Delete updates the live row/column structure record.
* Delete renumbers remaining boxes.
* Delete marks page crops stale.
* Next Page saves current page layout and starts background cropping for that page.
* Previous Page saves current page layout and starts background cropping for that page.
* Go to Page saves current page layout and starts background cropping for that page.
* Navigation does not wait for cropping to finish.
* Background cropping produces one image per included box.
* Deleted/excluded boxes are not cropped.
* Crop count equals included box count for crop-ready pages.
* Crop filenames follow `{pdf_base_name}_{PPP}_{BBB}.webp`.
* Crop files are saved locally in the import workspace.
* Stale page crops are regenerated and old extra files are removed.
* Proceed to Crop + OCR verifies fresh crop files before OCR.
* Review summary includes the local generated crop paths.
* Documentation explains the delete and background crop workflow.
* TypeScript compiles.
* App still starts.

## 28. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How right-click Delete works.
* How keyboard Delete/Backspace works.
* How row/column records update after deletion.
* How background cropping starts on page navigation.
* How crop filenames are generated.
* Where crop images are saved.
* How crop status is tracked.
* How stale crops are regenerated.
* How Proceed to Crop + OCR uses fresh crop files.
* How to test the workflow.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.