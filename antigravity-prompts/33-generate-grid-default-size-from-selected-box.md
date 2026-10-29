# Antigravity Prompt Chunk 33: Generate Grid Defaults From Selected Box Size

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 33. Chunk 32 has already been run.

This chunk updates one specific behavior from the manual crop editor:

```text
Generate Grid From This Box...
```

The default `Rows` and `Columns` values should no longer come from the live layout row/column record.

Instead, the app should calculate the default row/column count from:

```text
selected box width
selected box height
selected box x/y position
page width
page height
available space around the selected box
```

The goal is that after the operator manually fits one crop box, the app can estimate how many same-size boxes can fit around it.

## 1. Read These Files First

Before coding, read files similar to:

```text
src/shared/types/manualCrop.ts
src/shared/utils/manualCropStructure.ts
src/shared/utils/manualCropTemplateGrid.ts
src/shared/utils/manualCropGeometry.ts
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/components/manual-crop/ManualCropCanvas.tsx
src/renderer/components/manual-crop/ManualCropToolbar.tsx
src/renderer/hooks/useManualCropLayout.ts
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
README.md
```

Adapt paths if the current project structure differs.

## 2. Required Behavior Change

Update only this dialog:

```text
Generate Grid From This Box...
```

Current behavior from Chunk 31/32 may be:

```text
Rows default = current page layout row count
Columns default = current page layout column count
```

Change it to:

```text
Rows default = calculated from selected box height and available page height
Columns default = calculated from selected box width and available page width
```

Do not change these behaviors:

```text
Generate Row From This Box...
Columns default = live selected row box count

Generate Column From This Box...
Rows default = live selected column box count
```

The live layout record is still required for row/column generation.

## 3. Calculation Concept

For full-grid generation, use the selected box as a same-size template.

Calculate how many boxes of that size can fit:

```text
to the left of the selected box
to the right of the selected box
above the selected box
below the selected box
```

Then:

```text
defaultColumns = boxesLeft + 1 + boxesRight
defaultRows = boxesAbove + 1 + boxesBelow
```

This naturally deducts leftover margins because any leftover space smaller than a full box is not counted.

## 4. Required Utility Function

Create or update:

```text
src/shared/utils/manualCropTemplateGrid.ts
```

Add a function similar to:

```ts
export function calculateDefaultGridSizeFromTemplateBox(input: {
  pageWidth: number;
  pageHeight: number;
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  minRows?: number;
  maxRows?: number;
  minColumns?: number;
  maxColumns?: number;
}): {
  rows: number;
  columns: number;
  boxesLeft: number;
  boxesRight: number;
  boxesAbove: number;
  boxesBelow: number;
  leftoverMargins: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
};
```

Algorithm:

```text
1. Validate pageWidth/pageHeight/boxWidth/boxHeight.
2. Calculate available spaces:
   leftSpace = boxX
   rightSpace = pageWidth - (boxX + boxWidth)
   topSpace = boxY
   bottomSpace = pageHeight - (boxY + boxHeight)

3. Calculate how many full same-size boxes fit in each direction:
   boxesLeft = floor(leftSpace / boxWidth)
   boxesRight = floor(rightSpace / boxWidth)
   boxesAbove = floor(topSpace / boxHeight)
   boxesBelow = floor(bottomSpace / boxHeight)

4. Calculate:
   columns = boxesLeft + 1 + boxesRight
   rows = boxesAbove + 1 + boxesBelow

5. Clamp:
   rows = min(max(rows, 1), 20)
   columns = min(max(columns, 1), 20)

6. Return rows and columns.
```

Also calculate leftover margins:

```text
leftoverLeft = leftSpace - boxesLeft * boxWidth
leftoverRight = rightSpace - boxesRight * boxWidth
leftoverTop = topSpace - boxesAbove * boxHeight
leftoverBottom = bottomSpace - boxesBelow * boxHeight
```

These margins are useful for logging/debugging but do not need to be shown in the UI unless helpful.

## 5. Margin Deduction Requirement

When estimating rows/columns, the app must not blindly divide the full page width/height by the selected box size.

It must account for the selected box position and leftover margins.

Example:

```text
page width = 1200
selected box x = 80
selected box width = 250

leftSpace = 80
boxesLeft = floor(80 / 250) = 0

rightSpace = 1200 - 80 - 250 = 870
boxesRight = floor(870 / 250) = 3

defaultColumns = 0 + 1 + 3 = 4
```

The 80 px left margin is deducted naturally.

Example bottom-left case:

```text
selected box is near bottom-left
boxesLeft = 0
boxesBelow = 0
boxesRight = 2
boxesAbove = 2

defaultColumns = 3
defaultRows = 3
```

So the dialog opens as:

```text
Rows: 3
Columns: 3
```

## 6. UI Dialog Update

When the operator right-clicks a box and selects:

```text
Generate Grid From This Box...
```

Open the dialog with:

```text
Rows: [calculated default rows]
Columns: [calculated default columns]
Apply
Cancel
```

No preview.

No anchor selector.

No replace/add option.

The operator may still manually edit the values before clicking Apply.

## 7. Auto-Placement Still Applies

Do not remove the existing auto-placement algorithm.

After the operator clicks Apply, the existing generation logic should still:

```text
try all possible selected-box anchor positions
choose the best placement based on page boundaries and overflow
keep the selected box exact
remove all other page boxes
generate same-size boxes
renumber boxes
save layout
```

This chunk only changes the default values shown in the dialog.

## 8. Row/Column Generation Must Stay Unchanged

Keep this behavior:

```text
Generate Row From This Box...
Columns default = number of included boxes in selectedBox.rowId from live layout record
```

Keep this behavior:

```text
Generate Column From This Box...
Rows default = number of included boxes in selectedBox.columnId from live layout record
```

Do not replace those with geometric calculation.

## 9. Validation

Keep existing validation:

```text
Rows must be integer 1 to 20.
Columns must be integer 1 to 20.
Selected box must exist.
Selected box must be included.
Selected box width and height must be valid.
```

If calculation fails, fallback safely:

```text
Rows = current layout row count if available, otherwise 1
Columns = current layout column count if available, otherwise 1
```

Log a clear warning, but do not crash the editor.

## 10. Tests / Smoke Checks

Add tests or smoke checks for:

```text
Generate Grid default columns are calculated from selected box width and page width.
Generate Grid default rows are calculated from selected box height and page height.
Leftover margins smaller than one box are deducted and do not increase count.
Bottom-left selected box produces grid defaults that grow upward/rightward.
Top-left selected box produces defaults that grow downward/rightward.
Right-edge selected box deducts right leftover margin.
Generate Row defaults still use live row record.
Generate Column defaults still use live column record.
Manual override of Rows/Columns still works.
Invalid selected box falls back safely.
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If any script does not exist, document it clearly and do not invent success.

## 11. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
Generate Grid From This Box now auto-fills Rows and Columns based on selected box size and available page space.
The calculation ignores leftover margins smaller than one full box.
The operator can still manually edit Rows and Columns before applying.
Generate Row and Generate Column still use the live layout row/column counts.
```

## 12. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not upload images in this chunk.
* Do not run OCR in this chunk.
* Do not write to DB in this chunk.
* Do not publish offers in this chunk.

## 13. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 14. Acceptance Criteria

This chunk is complete when:

* Generate Grid From This Box dialog defaults Rows from selected box height/page height.
* Generate Grid From This Box dialog defaults Columns from selected box width/page width.
* Leftover margins smaller than a full selected box are deducted automatically.
* Generate Grid no longer uses live layout row/column counts for its default values.
* Generate Row still uses live selected row count.
* Generate Column still uses live selected column count.
* Operator can manually override calculated rows/columns.
* Existing auto-placement still works.
* Existing Delete/background crop behavior from Chunk 32 still works.
* Documentation is updated.
* TypeScript compiles.
* App still starts.

## 15. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How Generate Grid default Rows/Columns are now calculated.
* How leftover margins are deducted.
* Confirmation that Generate Row and Generate Column defaults still use the live layout record.
* How to test the feature.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.