# Antigravity Prompt Chunk 28: Manual Grid Crop Layout Editor

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 28. Prompt Chunks 01 to 27 should already have implemented the full extractor app, Wifran DB/storage alignment, direct publish mode, free-tier-safe Mistral queue, retry failed chunks, Othaim price-block fixes, and a minimal Mistral OCR 2512 diagnostic test.

This chunk adds a manual-assisted crop layout editor.

The goal is to let the operator quickly split each rendered leaflet page into one crop box per product offer item, without relying on Mistral coordinates.

## 1. Read These Files First

Before coding, read:

```text
src/main/pdf/pdfPreprocessingService.ts
src/main/image/imageCroppingService.ts
src/main/image/boundingBoxValidator.ts
src/main/storage/storagePathBuilder.ts
src/shared/types/ocrJob.ts
src/shared/types/offerSync.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/hooks/useOcrPipeline.ts
src/renderer/hooks/useOfferSync.ts
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Also read:

```text
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/wifran_docs/offer-images-bucket.md
project-knowledge/wifran_docs/external-offer-ingestion-tool.md
```

Use the current project structure and naming where possible.

## 2. Goal of This Chunk

Implement a manual crop layout editor that:

```text
renders one leaflet page at a time
starts with an equal grid such as 4 x 4
lets the operator adjust grid borders
lets the operator adjust individual item boxes
lets the operator delete unnecessary boxes
lets the operator add missed boxes
lets the operator merge boxes into larger item crops
lets the operator split boxes
lets the operator apply/copy layouts between pages
uses the final box coordinates to crop one image per item
does not require Mistral bounding boxes
does not request coordinates from Mistral
does not depend on AI for item image cropping
```

The editor must be optimized for speed and low manual effort.

## 3. Product Context

Some supermarket leaflet pages have layouts like:

```text
normal grid items on the left and middle
larger stacked cards on the right
headers and logos at the top
footer/date text at the bottom
some items spanning more vertical space than others
some products with prices, names, and badges inside one visual block
```

Example page behavior:

```text
Default 4 x 4 grid creates 16 boxes.
Operator deletes header/footer/empty boxes.
Operator merges right-column boxes into 3 large item boxes.
Operator adjusts borders so each box includes product image, name, offer price, old price, size, and special condition.
Final output for the page may be 14 item crops.
```

The editor must support this.

## 4. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/manualCrop.ts
src/shared/utils/manualCropGeometry.ts
src/shared/utils/manualCropOrdering.ts
src/main/image/manualCropService.ts
src/main/ipc/manualCropIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/components/manual-crop/ManualCropToolbar.tsx
src/renderer/components/manual-crop/ManualCropCanvas.tsx
src/renderer/components/manual-crop/ManualCropBoxList.tsx
src/renderer/components/manual-crop/ManualCropThumbnailPreview.tsx
src/renderer/hooks/useManualCropLayout.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
README.md
```

Adapt paths if the current project structure differs.

## 5. Default Grid Input

At the first import step where the operator selects the PDF, add crop layout settings:

```text
Default crop grid rows
Default crop grid columns
```

Defaults:

```text
rows = 4
columns = 4
```

Allowed ranges:

```text
rows: 1 to 10
columns: 1 to 10
```

Show help text:

```text
This only creates the starting crop boxes. You can adjust, merge, delete, or add boxes on each page.
```

These values should be stored in the import/session state.

## 6. Manual Crop Data Types

Create:

```text
src/shared/types/manualCrop.ts
```

Recommended types:

```ts
export type ManualCropBox = {
  id: string;
  pageNumber: number;
  itemNumber: string;
  x: number;
  y: number;
  width: number;
  height: number;
  included: boolean;
  locked?: boolean;
  label?: string | null;
  linkedRowIndex?: number | null;
  linkedColumnIndex?: number | null;
  createdFromGrid?: boolean;
};

export type ManualCropPageLayout = {
  pageNumber: number;
  pageImagePath: string;
  pageWidth: number;
  pageHeight: number;
  gridRows: number;
  gridColumns: number;
  rowLines: number[];
  columnLines: number[];
  boxes: ManualCropBox[];
  updatedAt: string;
};

export type ManualCropSession = {
  importBatchId?: string | null;
  pdfPath?: string | null;
  defaultGridRows: number;
  defaultGridColumns: number;
  pageLayouts: ManualCropPageLayout[];
};

export type ManualCropResult = {
  ok: boolean;
  pageNumber: number;
  totalBoxes: number;
  includedBoxes: number;
  skippedBoxes: number;
  croppedImages: Array<{
    itemNumber: string;
    pageNumber: number;
    cropPath: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  error?: {
    code: string;
    message: string;
  };
};
```

Use pixel coordinates relative to the rendered page image.

Do not store screen/display coordinates as final crop coordinates.

## 7. Initial Grid Generation

Create utility:

```text
src/shared/utils/manualCropGeometry.ts
```

Implement:

```ts
export function createInitialGridLayout(input: {
  pageNumber: number;
  pageImagePath: string;
  pageWidth: number;
  pageHeight: number;
  rows: number;
  columns: number;
  topMargin?: number;
  bottomMargin?: number;
  leftMargin?: number;
  rightMargin?: number;
}): ManualCropPageLayout;
```

The initial grid should:

```text
split the page into equal boxes
create row and column boundary lines
assign sequential item numbers
default every box to included = true
support optional page margins
```

Item ordering:

```text
top-to-bottom
left-to-right
```

For Arabic/Riyadh supermarket leaflets, keep visual order left-to-right for item numbering unless a setting is later added.

## 8. Editable Box Behavior

The editor must allow:

```text
drag entire box
drag left/right/top/bottom edges
drag corners
resize one box only
select multiple boxes
delete selected boxes
restore deleted boxes
add new box
duplicate selected box
merge selected boxes
split selected box horizontally
split selected box vertically
```

Deleted boxes should remain in layout history as:

```text
included = false
```

or be removed from the included list, but the operator must be able to undo.

## 9. Row and Column Border Adjustment

The editor must support fast whole-row and whole-column adjustment.

Implement visible draggable row/column guide lines:

```text
vertical column lines
horizontal row lines
```

When the operator drags a column border:

```text
all boxes linked to that column boundary should update
neighboring boxes should resize accordingly
boxes manually detached from grid should not be unexpectedly distorted
```

When the operator drags a row border:

```text
all boxes linked to that row boundary should update
neighboring boxes should resize accordingly
boxes manually detached from grid should not be unexpectedly distorted
```

Add a way to detach a box from grid linkage after manual fine-tuning:

```text
Detach from grid
```

Detached boxes still crop normally but no longer move with row/column guide changes.

## 10. Right Column / Large Card Support

The editor must handle pages where one column contains fewer, taller cards.

Add efficient tools:

```text
Merge selected boxes
Convert selected column to N stacked boxes
Convert selected row to N boxes
```

For the attached page-style layout, the operator should be able to:

```text
select the right column
choose Convert selected column to 3 stacked boxes
adjust the three boxes manually
```

This supports cases where the right side has 3 large product cards while the rest of the page has smaller grid items.

## 11. Header/Footer Cleanup

The operator must be able to quickly exclude non-item areas:

```text
page header
supermarket logo
category title
date/footer text
empty spaces
```

Add toolbar actions:

```text
Delete selected boxes
Mark selected as excluded
Exclude top row
Exclude bottom row
```

Do not crop excluded boxes.

## 12. Zoom, Pan, and Precision

The editor must support:

```text
zoom in
zoom out
fit to screen
pan
show page image at high enough resolution
snap to grid on/off
fine adjustment with arrow keys
shift + arrow for larger movement
```

Keyboard shortcuts:

```text
Delete / Backspace = delete selected boxes
Ctrl/Cmd+Z = undo
Ctrl/Cmd+Y = redo
Arrow keys = nudge selected box by 1 px
Shift+Arrow = nudge by 10 px
M = merge selected boxes
A = add box
S = split selected box
```

Do not block normal text input fields with shortcuts.

## 13. Box Numbering and Reordering

Each included box must have a stable `itemNumber`.

Recommended format:

```text
001
002
003
...
```

Provide a button:

```text
Renumber Included Boxes
```

Renumbering should sort boxes by:

```text
pageNumber
y
x
```

After deleting/adding/merging boxes, the operator can renumber so final crops have clean item numbers.

Show item numbers visibly on the boxes.

## 14. Thumbnails and Preview

Add a side panel that shows:

```text
included box count
excluded box count
thumbnail preview for each included crop
item number
page number
box dimensions
```

Before final crop, allow the operator to click:

```text
Preview Crops
```

This should show what the final item images will look like without uploading or syncing.

## 15. Apply Layout to Other Pages

Add tools:

```text
Copy layout from previous page
Apply current layout to next page
Apply current layout to selected pages
Apply current layout to all remaining pages
```

When applying a layout to another page:

```text
scale coordinates if page dimensions differ
preserve included/excluded state
preserve merged boxes
preserve detached boxes
renumber for the target page
```

Add a warning:

```text
Review each page after applying a copied layout because leaflet layouts may differ.
```

## 16. Per-Page Workflow

Update Import page workflow:

```text
1. Select PDF and import context.
2. Set default grid rows/columns.
3. Preprocess/render PDF pages.
4. Open Manual Crop Editor.
5. For each page:
   - adjust boxes
   - delete/merge/add as needed
   - preview crops
   - save page layout
6. Generate crops for selected pages or all pages.
7. Continue to OCR text extraction and later offer matching/sync.
```

The operator should be able to crop images before or after text-only OCR, but the crop coordinates must not depend on Mistral.

## 17. Crop Generation

Create or update:

```text
src/main/image/manualCropService.ts
```

Add function:

```ts
export async function cropManualPageLayout(input: {
  layout: ManualCropPageLayout;
  outputDir: string;
  imageFormat: 'webp' | 'jpg' | 'jpeg' | 'png';
  quality: number;
}): Promise<ManualCropResult>;
```

Rules:

```text
crop only included boxes
clamp boxes to page boundaries
reject boxes smaller than a safe minimum
write one image per included box
default output format = webp
preserve full selected visual region
do not crop excluded boxes
```

Recommended output filename:

```text
page-{page_number}-item-{item_number}.webp
```

Example:

```text
page-036-item-001.webp
page-036-item-002.webp
```

## 18. Matching Crops to OCR Items

The manual crop item numbers should align with the minimal OCR test item numbers when possible.

Use:

```text
page_number
item_number
```

as the matching key between:

```text
manual crop image
minimal OCR item JSON
later normalized offer row
```

Do not depend on coordinates from Mistral.

If OCR item count and manual crop count differ, show a warning:

```text
Page 36 has 14 manual crop boxes but 13 OCR items. Review item numbering before sync.
```

Do not block the operator automatically, but mark the page as needing review.

## 19. IPC Requirements

Create:

```text
src/main/ipc/manualCropIpc.ts
```

Expose narrow IPC methods:

```text
manualCrop:saveLayout
manualCrop:loadLayout
manualCrop:cropPage
manualCrop:cropAllPages
manualCrop:previewCrop
```

Do not expose generic filesystem IPC.

Do not expose arbitrary image operations.

All file writes should stay inside the import workspace/output directory.

## 20. Preload API Requirements

Update preload safely:

```ts
window.wifranExtractor.manualCrop = {
  saveLayout: (...) => Promise<...>,
  loadLayout: (...) => Promise<...>,
  cropPage: (...) => Promise<ManualCropResult>,
  cropAllPages: (...) => Promise<...>,
  previewCrop: (...) => Promise<...>
};
```

Do not expose raw `ipcRenderer`.

Do not expose arbitrary filesystem access.

## 21. Results Page Integration

Update Results page so crop outputs display:

```text
manual crop image path
page number
item number
crop status
crop preview thumbnail
matched OCR item if available
```

If manual crop count and OCR item count differ for a page, show:

```text
Manual crop / OCR item count mismatch
```

## 22. Persistence

Store manual crop layouts in the local import workspace.

Recommended file:

```text
manual-crop-layout.json
```

or one file per page:

```text
manual-crop-page-036.json
```

Do not store layouts in Supabase unless later required.

The operator should be able to close/reopen the app and continue adjusting layouts if the workspace still exists.

## 23. Error Handling

Handle:

```text
page image missing
invalid box coordinates
box outside page
box too small
output directory missing
image crop failure
manual layout JSON invalid
crop preview failure
```

Use clear error codes:

```text
MANUAL_CROP_PAGE_IMAGE_MISSING
MANUAL_CROP_INVALID_BOX
MANUAL_CROP_BOX_TOO_SMALL
MANUAL_CROP_OUTPUT_FAILED
MANUAL_CROP_LAYOUT_INVALID
MANUAL_CROP_PREVIEW_FAILED
```

Avoid generic “unknown error” when possible.

## 24. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
how to set default grid rows/columns
how to adjust row and column borders
how to adjust individual boxes
how to merge/delete/add boxes
how to handle right-column large cards
how to preview crops
how to generate final item images
how to match manual crops with OCR item numbers
what to do when crop count and OCR item count differ
```

Add an example:

```text
For a page with 4x4 starting grid but 3 large cards on the right:
1. Start with 4 rows x 4 columns.
2. Select right column boxes.
3. Convert selected column to 3 stacked boxes.
4. Adjust each large box to include image, name, price, and condition.
5. Delete header/footer boxes.
6. Renumber included boxes.
7. Preview crops.
8. Generate crops.
```

## 25. Tests / Smoke Checks

Add tests for:

```text
initial grid creates rows x columns boxes
box coordinates are within page bounds
delete/exclude box reduces included count
merge selected boxes creates one combined box
split box creates two boxes
renumbering creates 001, 002, 003 order
manual crop output filenames are stable
copy layout scales to another page size
manual crop count mismatch warning works
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If a script does not exist, document it clearly and do not invent success.

## 26. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose arbitrary filesystem access.
* Do not expose generic IPC.
* Do not upload images in this chunk unless the existing later sync step is explicitly run by the operator.
* Do not publish offers in this chunk.
* Do not modify DB sync behavior.
* Do not rely on Mistral coordinates.
* Do not request coordinates from Mistral for this manual crop workflow.
* Only crop inside the selected page image.
* Only write crop outputs inside the import workspace.

## 27. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 28. Acceptance Criteria

This chunk is complete when:

* PDF selection step includes default grid rows/columns.
* Manual Crop Editor exists.
* Page image is displayed with editable crop boxes.
* Initial grid creates equal boxes.
* Operator can adjust row and column borders.
* Operator can adjust individual boxes.
* Operator can delete/exclude boxes.
* Operator can add boxes.
* Operator can merge boxes.
* Operator can split boxes.
* Operator can convert a selected column to N stacked boxes.
* Operator can zoom/pan/nudge boxes.
* Operator can renumber included boxes.
* Operator can preview crops.
* Operator can generate one crop image per included box.
* Right-column large card layouts are supported.
* Manual crop layouts are persisted locally.
* Manual crop item numbers can be matched to OCR item numbers.
* Mismatch warnings appear when crop count and OCR count differ.
* Documentation explains the workflow.
* TypeScript compiles.
* Existing app still starts.

## 29. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How the manual crop editor works.
* How initial grid generation works.
* How row/column adjustments work.
* How individual box editing works.
* How merge/split/delete/add work.
* How right-column large cards are handled.
* How crops are generated.
* How manual crops match OCR items.
* How to test the feature.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.