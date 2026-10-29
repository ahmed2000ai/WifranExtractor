# Antigravity Prompt Chunk 31: Box Template Grid Generation and Next-Page Layout Carryover

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 31. Prompt Chunks 28 to 30 should already have added the manual grid crop editor, pre-DB review workflow, and progressive page rendering.

This chunk improves the manual crop editor so the operator can quickly generate repeated same-size boxes from one correctly fitted box, and so the next page automatically loads using the latest box/grid structure from the current page.

The goal is to make manual crop adjustment much faster.

## 1. Read These Files First

Before coding, read the current manual crop editor implementation and related files.

Read files similar to:

```text
src/shared/types/manualCrop.ts
src/shared/utils/manualCropGeometry.ts
src/shared/utils/manualCropOrdering.ts
src/main/image/manualCropService.ts
src/main/ipc/manualCropIpc.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useManualCropLayout.ts
src/renderer/hooks/useStreamingPdfRender.ts
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/components/manual-crop/ManualCropToolbar.tsx
src/renderer/components/manual-crop/ManualCropCanvas.tsx
src/renderer/components/manual-crop/ManualCropBoxList.tsx
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Adapt paths if the current project structure differs.

## 2. Main Goal

Implement these manual crop editor features:

```text
1. Right-click a fitted box and generate a same-size full grid from it.
2. Right-click a fitted box and generate a same-size row from it.
3. Right-click a fitted box and generate a same-size column from it.
4. Maintain a live layout structure record for rows, columns, and box membership.
5. Use the live layout record for row/column counts instead of detecting row/column membership geometrically at click time.
6. When the operator clicks Next Page, load the next page using the latest box/grid structure from the current page if the next page has no saved layout yet.
```

This must be optimized for speed.

Do not add preview steps.

Do not ask the operator whether to replace or add.

Do not ask the operator where the selected box is located inside the new grid.

The app should infer placement automatically.

## 3. Right-Click Menu Actions

Add these right-click menu actions on each crop box:

```text
Generate Grid From This Box...
Generate Row From This Box...
Generate Column From This Box...
```

Keep existing actions such as delete, duplicate, merge, split, or exclude if they already exist.

## 4. Generate Grid From This Box

When the operator right-clicks a box and selects:

```text
Generate Grid From This Box...
```

Show a small dialog with only:

```text
Rows
Columns
Apply
Cancel
```

No preview.

No anchor-position choice.

No replace/add choice.

Recommended dialog copy:

```text
Generate same-size grid from selected box

Rows: [current page row count]
Columns: [current page column count]

This will replace all boxes on this page except the selected box.

[Apply] [Cancel]
```

Default values:

```text
Rows default = current page layout row count from the live layout structure record.
Columns default = current page layout column count from the live layout structure record.
```

On Apply:

```text
1. Take an undo snapshot.
2. Keep the selected box exactly as-is.
3. Remove every other box on the current page.
4. Use the selected box width and height as the template size.
5. Auto-calculate where the selected box belongs inside the requested grid based on page boundaries and available space.
6. Generate all remaining boxes with the exact same width and height as the selected box.
7. Rebuild the page row/column structure record.
8. Renumber included boxes.
9. Save the page layout.
```

The selected box must keep its exact coordinates and dimensions.

Do not stretch the generated grid to fill the page.

The generated grid does not need to fill the whole page.

It only needs to create same-size connected boxes around the selected box.

## 5. Generate Row From This Box

When the operator right-clicks a box and selects:

```text
Generate Row From This Box...
```

Show a small dialog with only:

```text
Columns
Apply
Cancel
```

No preview.

No replace/add choice.

Recommended dialog copy:

```text
Generate same-size row from selected box

Columns: [current number of boxes in this row]

This will replace the current row boxes, keeping the selected box.

[Apply] [Cancel]
```

Default value:

```text
Columns default = number of included boxes in the selected box’s current row from the live layout structure record.
```

Do not geometrically detect the current row at click time.

Use:

```text
selectedBox.rowId
layout.rows[selectedBox.rowId].boxIds
```

or the equivalent structure in the current codebase.

On Apply:

```text
1. Take an undo snapshot.
2. Keep the selected box exactly as-is.
3. Remove every other included box in the selected box’s current row.
4. Keep boxes in other rows unchanged.
5. Use the selected box width and height as the template size.
6. Auto-calculate where the selected box belongs inside the requested row based on page boundaries and available horizontal space.
7. Generate remaining same-size boxes in that row.
8. Update the row record.
9. Update affected column records.
10. Renumber included boxes.
11. Save the page layout.
```

This action must not destroy boxes outside the selected row.

## 6. Generate Column From This Box

When the operator right-clicks a box and selects:

```text
Generate Column From This Box...
```

Show a small dialog with only:

```text
Rows
Apply
Cancel
```

No preview.

No replace/add choice.

Recommended dialog copy:

```text
Generate same-size column from selected box

Rows: [current number of boxes in this column]

This will replace the current column boxes, keeping the selected box.

[Apply] [Cancel]
```

Default value:

```text
Rows default = number of included boxes in the selected box’s current column from the live layout structure record.
```

Do not geometrically detect the current column at click time.

Use:

```text
selectedBox.columnId
layout.columns[selectedBox.columnId].boxIds
```

or the equivalent structure in the current codebase.

On Apply:

```text
1. Take an undo snapshot.
2. Keep the selected box exactly as-is.
3. Remove every other included box in the selected box’s current column.
4. Keep boxes in other columns unchanged.
5. Use the selected box width and height as the template size.
6. Auto-calculate where the selected box belongs inside the requested column based on page boundaries and available vertical space.
7. Generate remaining same-size boxes in that column.
8. Update the column record.
9. Update affected row records.
10. Renumber included boxes.
11. Save the page layout.
```

This action must not destroy boxes outside the selected column.

## 7. Live Layout Structure Record

The editor must maintain a live row/column structure record for every page layout.

Update or extend:

```text
src/shared/types/manualCrop.ts
```

Add or adapt types similar to:

```ts
export type ManualCropRow = {
  id: string;
  order: number;
  boxIds: string[];
};

export type ManualCropColumn = {
  id: string;
  order: number;
  boxIds: string[];
};

export type ManualCropBox = {
  id: string;
  pageNumber: number;
  itemNumber: string;
  x: number;
  y: number;
  width: number;
  height: number;
  included: boolean;
  rowId: string;
  columnId: string;
  locked?: boolean;
  label?: string | null;
  createdFromGrid?: boolean;
};

export type ManualCropPageLayout = {
  pageNumber: number;
  pageImagePath: string;
  pageWidth: number;
  pageHeight: number;
  gridRows: number;
  gridColumns: number;
  rows: ManualCropRow[];
  columns: ManualCropColumn[];
  boxes: ManualCropBox[];
  pageComplete?: boolean;
  completedAt?: string | null;
  updatedAt: string;
};
```

If the existing project already has row/column fields, update them instead of duplicating.

The important requirement:

```text
Every included crop box must belong to exactly one row record and exactly one column record.
```

Excluded/deleted boxes may either remain assigned or be removed from row/column records, but counts used for defaults must count only included boxes.

## 8. Do Not Use Geometry Detection for Default Counts

For these dialog defaults, do not detect rows/columns by overlap.

Do not calculate “current row” by checking vertical overlap.

Do not calculate “current column” by checking horizontal overlap.

Use the live layout record.

Required defaults:

```text
Generate Grid From This Box:
Rows = layout.rows count
Columns = layout.columns count

Generate Row From This Box:
Columns = included box count in selectedBox.rowId

Generate Column From This Box:
Rows = included box count in selectedBox.columnId
```

The live layout record must always be updated whenever the layout changes.

## 9. Layout Record Updates

Update the row/column structure record after every relevant operation.

Operations include:

```text
initial grid creation
delete box
exclude box
restore box
add box
duplicate box
move box
resize box
merge boxes
split box
renumber boxes
Generate Grid From This Box
Generate Row From This Box
Generate Column From This Box
copy layout to next page
scale layout to another page size
```

Rules:

```text
When a box is deleted/excluded:
- remove it from included row/column counts.
- either remove its id from row/column boxIds or keep it but mark excluded and filter in count helpers.
- be consistent.

When a box is added:
- assign it to the current active row/column if the action implies one.
- if no current row/column exists, create a new row/column record.
- update row/column counts.

When a box is duplicated:
- assign the duplicated box to the same row or column depending on duplicate direction.
- Duplicate Right/Left should keep same row and create/use neighboring column.
- Duplicate Up/Down should keep same column and create/use neighboring row.

When boxes are merged:
- create one resulting box.
- assign it to the most appropriate surviving row/column based on the selected/primary box.
- remove merged-away box ids from row/column records.

When a box is split:
- create new boxes and assign them to row/column records based on split direction.
- horizontal split should create/update rows.
- vertical split should create/update columns.
```

The record should reflect the actual editor state at any given point in time.

## 10. Utility Functions to Add

Create or update:

```text
src/shared/utils/manualCropStructure.ts
```

Implement utility functions similar to:

```ts
export function getIncludedRowCount(layout: ManualCropPageLayout): number;

export function getIncludedColumnCount(layout: ManualCropPageLayout): number;

export function getIncludedBoxCountInRow(
  layout: ManualCropPageLayout,
  rowId: string
): number;

export function getIncludedBoxCountInColumn(
  layout: ManualCropPageLayout,
  columnId: string
): number;

export function rebuildLayoutStructureFromBoxes(
  layout: ManualCropPageLayout
): ManualCropPageLayout;

export function validateLayoutStructure(
  layout: ManualCropPageLayout
): {
  ok: boolean;
  errors: Array<{ code: string; message: string }>;
};

export function renumberIncludedBoxes(
  layout: ManualCropPageLayout
): ManualCropPageLayout;
```

Use existing naming if similar utilities already exist.

The `rebuildLayoutStructureFromBoxes` utility may be used after destructive operations, but default dialog counts must come from the maintained structure record, not from one-off click-time geometry detection.

## 11. Auto-Placement Algorithm for Full Grid

Create or update:

```text
src/shared/utils/manualCropTemplateGrid.ts
```

Implement:

```ts
export function generateGridFromTemplateBox(input: {
  layout: ManualCropPageLayout;
  selectedBoxId: string;
  rows: number;
  columns: number;
}): ManualCropPageLayout;
```

Algorithm:

```text
1. Find selected box.
2. Use selected box width and height as template size.
3. Try every possible anchor position inside the requested grid:
   anchorRowIndex = 0 to rows - 1
   anchorColumnIndex = 0 to columns - 1
4. For each candidate:
   gridStartX = selectedBox.x - anchorColumnIndex * selectedBox.width
   gridStartY = selectedBox.y - anchorRowIndex * selectedBox.height
   gridEndX = gridStartX + columns * selectedBox.width
   gridEndY = gridStartY + rows * selectedBox.height
5. Calculate overflow outside the page:
   overflowLeft = max(0, -gridStartX)
   overflowTop = max(0, -gridStartY)
   overflowRight = max(0, gridEndX - pageWidth)
   overflowBottom = max(0, gridEndY - pageHeight)
   totalOverflow = overflowLeft + overflowTop + overflowRight + overflowBottom
6. Prefer candidates with totalOverflow = 0.
7. If several candidates fit fully, choose the candidate that best matches available space around the selected box:
   - if there is no room left, selected box should be in the leftmost generated column.
   - if there is no room right, selected box should be in the rightmost generated column.
   - if there is no room above, selected box should be in the top generated row.
   - if there is no room below, selected box should be in the bottom generated row.
   - otherwise choose the candidate with the most balanced placement.
8. If no candidate fits fully, choose the candidate with the smallest totalOverflow.
9. Do not clamp boxes silently.
10. Generate the new rows x columns boxes.
11. Keep the selected box object and coordinates exactly as-is at the chosen anchor position.
12. Remove all other boxes from the page.
13. Rebuild rows and columns records.
14. Renumber included boxes.
```

Example:

```text
If the selected box is near the bottom-left corner and the operator enters rows=3, columns=3:
- the app should choose selected box as bottom-left anchor.
- it should generate two boxes above it.
- it should generate two more same-size columns to the right.
- total boxes should be 9.
```

## 12. Auto-Placement Algorithm for Row

Implement:

```ts
export function generateRowFromTemplateBox(input: {
  layout: ManualCropPageLayout;
  selectedBoxId: string;
  columns: number;
}): ManualCropPageLayout;
```

Algorithm:

```text
1. Find selected box.
2. Read selectedBox.rowId.
3. Remove other included boxes in that row only.
4. Keep boxes outside that row unchanged.
5. Try every possible anchor column position:
   anchorColumnIndex = 0 to columns - 1
6. For each candidate:
   rowStartX = selectedBox.x - anchorColumnIndex * selectedBox.width
   rowEndX = rowStartX + columns * selectedBox.width
7. Calculate horizontal overflow:
   overflowLeft = max(0, -rowStartX)
   overflowRight = max(0, rowEndX - pageWidth)
   totalOverflow = overflowLeft + overflowRight
8. Prefer candidates with totalOverflow = 0.
9. If several fit, choose based on available horizontal space:
   - if no room left, selected box should be leftmost.
   - if no room right, selected box should be rightmost.
   - otherwise choose balanced placement.
10. If none fit, choose smallest overflow.
11. Generate same-size boxes in the row.
12. Keep selected box exact.
13. Update the selected row record.
14. Update affected column records.
15. Renumber included boxes.
```

Do not change the selected box y/height.

Do not modify boxes outside the selected row.

## 13. Auto-Placement Algorithm for Column

Implement:

```ts
export function generateColumnFromTemplateBox(input: {
  layout: ManualCropPageLayout;
  selectedBoxId: string;
  rows: number;
}): ManualCropPageLayout;
```

Algorithm:

```text
1. Find selected box.
2. Read selectedBox.columnId.
3. Remove other included boxes in that column only.
4. Keep boxes outside that column unchanged.
5. Try every possible anchor row position:
   anchorRowIndex = 0 to rows - 1
6. For each candidate:
   columnStartY = selectedBox.y - anchorRowIndex * selectedBox.height
   columnEndY = columnStartY + rows * selectedBox.height
7. Calculate vertical overflow:
   overflowTop = max(0, -columnStartY)
   overflowBottom = max(0, columnEndY - pageHeight)
   totalOverflow = overflowTop + overflowBottom
8. Prefer candidates with totalOverflow = 0.
9. If several fit, choose based on available vertical space:
   - if no room above, selected box should be topmost.
   - if no room below, selected box should be bottommost.
   - otherwise choose balanced placement.
10. If none fit, choose smallest overflow.
11. Generate same-size boxes in the column.
12. Keep selected box exact.
13. Update the selected column record.
14. Update affected row records.
15. Renumber included boxes.
```

Do not change the selected box x/width.

Do not modify boxes outside the selected column.

## 14. Undo Is Required

Because these actions apply immediately with no preview, undo support is required.

Before applying any of these actions:

```text
Generate Grid From This Box
Generate Row From This Box
Generate Column From This Box
```

take a layout history snapshot.

After applying, `Ctrl/Cmd+Z` must restore the previous layout.

If undo support already exists, integrate with it.

If undo support is missing or incomplete, add minimal layout history support for this editor.

## 15. Dialog Validation

Validate inputs:

```text
Rows must be an integer from 1 to 20.
Columns must be an integer from 1 to 20.
Generate Grid requires both rows and columns.
Generate Row requires columns.
Generate Column requires rows.
Selected box must exist.
Selected box must be included.
Selected box width and height must be above minimum crop size.
```

If generated boxes would go outside the page:

```text
Allow the operation but show a non-blocking warning after applying:
"Some generated boxes extend outside the page. Adjust the selected box size or undo and try again."
```

Do not silently clamp generated boxes during generation.

The existing crop validation can later catch out-of-page boxes before final crop.

## 16. Box Numbering After Generation

After each generation action:

```text
Renumber included boxes automatically.
```

Use the current visual ordering method already used by the app.

Preferred default:

```text
top-to-bottom, then left-to-right
```

Item numbers should be:

```text
001
002
003
...
```

The selected box may receive a new item number after renumbering. That is acceptable.

## 17. Next Page Uses Latest Current Page Structure

Update the manual crop editor page navigation behavior.

When the operator clicks:

```text
Next Page
```

the app should:

```text
1. Save the current page layout.
2. Remember the current page layout as the latest template.
3. Navigate to the next page.
4. If the next page is already rendered:
   - if it already has a saved layout, load that saved layout.
   - if it does not have a saved layout, create it by copying the latest current page structure.
5. If the next page is not rendered yet:
   - show the waiting screen.
   - when the next page finishes rendering, create/load layout using the same rules.
```

This is now the default behavior.

Do not ask the operator.

Do not use a fresh default `4 x 4` grid for page 2 if page 1 has a latest edited structure and page 2 has no saved layout.

## 18. What to Copy to the Next Page

When copying the current page layout to the next page, copy the structure and crop boxes:

```text
box count
box x/y/width/height
included/excluded state
row/column records
box row/column membership
grid/row/column structure
box labels if useful
locked state if useful
```

Reset page-specific data:

```text
pageNumber
pageImagePath
pageWidth
pageHeight
pageComplete
completedAt
crop output paths
OCR results
review status
DB sync status
```

Then renumber boxes for the new page.

If page dimensions are identical:

```text
copy coordinates exactly.
```

If page dimensions differ:

```text
scale x, y, width, and height proportionally.
```

Scaling:

```text
scaleX = nextPageWidth / currentPageWidth
scaleY = nextPageHeight / currentPageHeight

newX = oldX * scaleX
newY = oldY * scaleY
newWidth = oldWidth * scaleX
newHeight = oldHeight * scaleY
```

Also scale row/column boundary data if such data exists.

## 19. Never Overwrite Existing Next Page Layout

Important rule:

```text
If the next page already has a saved manual crop layout, load it.
Do not overwrite it with the current page template.
```

Example:

```text
The operator edits page 2.
Then goes back to page 1.
Then clicks Next Page again.
The app must load the saved page 2 layout, not replace it with page 1.
```

This prevents accidental loss of work.

## 20. Waiting for Next Page Render

This chunk must work with the streaming page render workflow from Chunk 30.

When the operator clicks Next Page and the next page is not rendered yet:

```text
show:
"Page 2 is still rendering. Please wait..."

continue showing render progress.

when page 2 becomes available:
- if page 2 has saved layout, load it.
- else copy latest current page structure to page 2.
```

Do not block the background renderer.

Do not block editing on already-rendered pages.

## 21. Layout Save Behavior

After any of these actions, save the page layout:

```text
Generate Grid From This Box
Generate Row From This Box
Generate Column From This Box
Next Page
Previous Page
Mark Page Complete
Proceed to Crop + OCR
```

Use existing local workspace persistence.

Do not save to Supabase.

## 22. UI Requirements

Update the manual crop UI:

```text
Right-click context menu includes the three generation actions.
Generation dialogs are small and fast.
No preview appears.
The Apply button immediately changes the layout.
The toolbar/status area shows row/column structure counts.
The box list reflects updated item numbers after generation.
Next Page uses latest structure automatically.
```

Optional but useful status text:

```text
Rows: 3 | Columns: 4 | Boxes: 12
```

For row/column generation dialogs:

```text
Generate Row From This Box:
Columns field should already be filled with the live row box count.

Generate Column From This Box:
Rows field should already be filled with the live column box count.
```

## 23. Error Handling

Use clear errors where relevant:

```text
MANUAL_CROP_SELECTED_BOX_NOT_FOUND
MANUAL_CROP_SELECTED_BOX_EXCLUDED
MANUAL_CROP_INVALID_GRID_SIZE
MANUAL_CROP_INVALID_TEMPLATE_BOX
MANUAL_CROP_STRUCTURE_INVALID
MANUAL_CROP_NEXT_PAGE_NOT_RENDERED
MANUAL_CROP_TEMPLATE_COPY_FAILED
```

Avoid generic “unknown error” where possible.

## 24. Tests / Smoke Checks

Add tests or smoke checks for:

```text
Generate Grid From This Box keeps selected box exact.
Generate Grid From This Box removes all other boxes.
Generate Grid From This Box creates rows x columns boxes.
Generate Grid From This Box chooses bottom-left anchor when selected box is near bottom-left.
Generate Row From This Box keeps boxes outside selected row unchanged.
Generate Row From This Box defaults columns from live row record.
Generate Row From This Box updates row and column records.
Generate Column From This Box keeps boxes outside selected column unchanged.
Generate Column From This Box defaults rows from live column record.
Generate Column From This Box updates row and column records.
No dialog uses geometry detection for default counts.
Deleting a box updates row/column counts.
Adding a box updates row/column counts.
Renumbering updates item numbers.
Next Page copies latest current page structure when no saved layout exists.
Next Page does not overwrite an existing saved layout.
Next Page waits if target page is not rendered and applies template when it becomes ready.
Scaled template coordinates work when page dimensions differ.
Undo restores layout before generation action.
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If any script does not exist, document that clearly and do not invent success.

## 25. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document these workflows:

```text
How to right-click a fitted box and generate a full grid from it.
How to generate only the current row from a box.
How to generate only the current column from a box.
How default row/column values are calculated from the live layout record.
How undo works after a generation action.
How Next Page copies the latest current page structure.
How the app handles a next page that is still rendering.
How existing saved next-page layouts are protected from overwrite.
```

Add an example:

```text
Example: generating a 3x3 section from a bottom-left box

1. Adjust one crop box so it perfectly fits an item.
2. Right-click the box.
3. Click Generate Grid From This Box.
4. Enter Rows = 3, Columns = 3.
5. Click Apply.
6. The app keeps the selected box, removes other page boxes, and creates a 3x3 same-size grid around it.
7. If the selected box is near the bottom-left corner, the app grows the grid upward and to the right.
8. Press Ctrl/Cmd+Z if the result is wrong.
```

Add another example:

```text
Example: generating the large right-side column

1. Adjust one large right-column crop box.
2. Right-click it.
3. Click Generate Column From This Box.
4. The Rows field defaults to the current number of boxes in that column.
5. Change Rows if needed.
6. Click Apply.
7. The app replaces only that column with same-size stacked boxes and keeps the rest of the page unchanged.
```

## 26. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose generic filesystem IPC.
* Do not upload images in this chunk.
* Do not run OCR in this chunk.
* Do not write to DB in this chunk.
* Do not publish offers in this chunk.
* Only modify local manual crop layout data inside the import workspace.

## 27. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 28. Acceptance Criteria

This chunk is complete when:

* Right-click menu has Generate Grid From This Box.
* Right-click menu has Generate Row From This Box.
* Right-click menu has Generate Column From This Box.
* Generate Grid dialog has only Rows, Columns, Apply, Cancel.
* Generate Row dialog has only Columns, Apply, Cancel.
* Generate Column dialog has only Rows, Apply, Cancel.
* No preview is shown.
* No replace/add option is shown.
* No anchor-position option is shown.
* Full grid generation removes all page boxes except the selected box before generating the new boxes.
* Row generation replaces only the selected row.
* Column generation replaces only the selected column.
* The selected box coordinates and dimensions remain exact.
* Generated boxes use the selected box width and height.
* Auto-placement chooses a sensible anchor based on available page space.
* Dialog default counts come from the live layout structure record.
* The live layout structure record updates after layout operations.
* Undo restores the layout before generation.
* Next Page uses the latest current page structure when the next page has no saved layout.
* Next Page does not overwrite existing saved page layouts.
* Next Page waits properly if the target page is not rendered yet.
* Documentation explains the feature.
* TypeScript compiles.
* App still starts.

## 29. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How the live row/column structure record works.
* How Generate Grid From This Box works.
* How Generate Row From This Box works.
* How Generate Column From This Box works.
* How default row/column values are chosen.
* How auto-placement works.
* How undo works.
* How Next Page copies the latest current page structure.
* How existing next-page layouts are protected.
* How to test the feature.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.