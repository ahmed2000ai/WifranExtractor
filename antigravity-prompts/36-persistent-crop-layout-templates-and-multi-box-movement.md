# Antigravity Prompt Chunk 36: Persistent Crop Layout Templates and Multi-Box Movement

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 36. Prompt Chunks 28 to 35 should already have implemented the manual crop editor, streaming page rendering, next-page layout carryover, right-click grid/row/column generation, delete box, background page cropping, raw flexible item OCR, and OCR returned key discovery.

This chunk adds two related but separate manual crop editor improvements:

```text
1. Persistent crop layout templates that can be saved forever and reused on any leaflet page.
2. General multi-box selection and movement that works with any layout, whether or not it came from a template.
```

The goal is to make repeated leaflet layouts much faster to process.

## 1. Read These Files First

Before coding, read the current manual crop editor and related files.

Read files similar to:

```text
src/shared/types/manualCrop.ts
src/shared/utils/manualCropGeometry.ts
src/shared/utils/manualCropOrdering.ts
src/shared/utils/manualCropStructure.ts
src/shared/utils/manualCropTemplateGrid.ts
src/main/image/manualCropService.ts
src/main/workflow/backgroundPageCropQueue.ts
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

Adapt paths if the current project structure differs.

## 2. Main Goal

Implement:

```text
Save Template
Apply Template
Template Browser pane on the right
Manage Templates
Multi-box selection
Marquee drag-selection rectangle
Move selected boxes together
Select all boxes
Keyboard nudging for selected boxes
Optional numeric offset movement
```

These features must work inside the manual crop editor.

## 3. Important Concept: Templates Are Permanent

Templates must be saved outside any single import workspace.

They should survive:

```text
closing the app
opening the app later
processing a different leaflet
processing a leaflet from a different supermarket
```

Use app-level user data storage.

For Electron apps, prefer something like:

```text
app.getPath('userData')/crop-layout-templates/
```

or the project’s existing app-data location.

Do not store permanent templates only inside the current leaflet workspace.

## 4. Important Concept: Templates Use Exact Coordinates

When saving a template, store the current box layout using exact pixel coordinates:

```text
x
y
width
height
```

When applying the template to another page, place the boxes at the exact saved coordinates by default.

Do not normalize coordinates by default.

Do not automatically scale by default.

The user wants the template to appear exactly as it appeared on the original page where it was created.

Still store source page dimensions for reference and warning purposes:

```text
source_page_width
source_page_height
```

If the current target page dimensions differ from the template source dimensions, show a visible warning:

```text
This template was saved from a page with different dimensions. It will be applied using exact saved coordinates.
```

The operation may still proceed with exact coordinates.

Undo must be available.

## 5. Template Data Types

Create or update:

```text
src/shared/types/cropLayoutTemplate.ts
```

Recommended types:

```ts
export type CropLayoutTemplateBox = {
  id: string;
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

export type CropLayoutTemplateRow = {
  id: string;
  order: number;
  boxIds: string[];
};

export type CropLayoutTemplateColumn = {
  id: string;
  order: number;
  boxIds: string[];
};

export type CropLayoutTemplate = {
  templateId: string;
  name: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
  sourcePageWidth: number;
  sourcePageHeight: number;
  boxCount: number;
  boxes: CropLayoutTemplateBox[];
  rows: CropLayoutTemplateRow[];
  columns: CropLayoutTemplateColumn[];
};
```

If existing types are similar, adapt rather than duplicate.

## 6. Template Storage

Create a storage service for permanent templates.

Recommended file:

```text
src/main/templates/cropLayoutTemplateService.ts
```

Store templates in app-level user data.

Recommended structure:

```text
userData/
  crop-layout-templates/
    crop-layout-templates.json
```

The file may contain:

```json
{
  "templates": []
}
```

Required service functions:

```ts
export async function listCropLayoutTemplates(): Promise<CropLayoutTemplate[]>;

export async function saveCropLayoutTemplate(
  template: CropLayoutTemplate
): Promise<CropLayoutTemplate>;

export async function updateCropLayoutTemplate(
  templateId: string,
  patch: Partial<Pick<CropLayoutTemplate, 'name' | 'notes'>>
): Promise<CropLayoutTemplate>;

export async function deleteCropLayoutTemplate(
  templateId: string
): Promise<void>;

export async function duplicateCropLayoutTemplate(
  templateId: string,
  newName?: string
): Promise<CropLayoutTemplate>;
```

Rules:

```text
Use atomic writes.
Do not corrupt template storage if the app closes while saving.
Do not expose arbitrary filesystem access.
Validate template data before saving.
```

Atomic write pattern:

```text
write crop-layout-templates.json.tmp
rename to crop-layout-templates.json
```

## 7. Template IPC

Create or update narrow IPC handlers.

Recommended file:

```text
src/main/ipc/cropLayoutTemplateIpc.ts
```

Expose only these safe actions:

```text
cropTemplates:list
cropTemplates:save
cropTemplates:update
cropTemplates:delete
cropTemplates:duplicate
```

Do not expose generic filesystem IPC.

Update:

```text
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
```

Preload API shape example:

```ts
window.wifranExtractor.cropTemplates = {
  list: () => Promise<CropLayoutTemplate[]>,
  save: (input: SaveCropLayoutTemplateInput) => Promise<CropLayoutTemplate>,
  update: (templateId, patch) => Promise<CropLayoutTemplate>,
  delete: (templateId) => Promise<void>,
  duplicate: (templateId, newName?) => Promise<CropLayoutTemplate>
};
```

Do not expose raw `ipcRenderer`.

## 8. Save Template Behavior

Add a toolbar button in the manual crop editor:

```text
Save Template
```

When clicked:

```text
1. Open a small dialog.
2. Ask for Template name.
3. Allow optional notes.
4. Save the current page’s crop box layout as a permanent template.
5. Add it immediately to the Template Browser pane.
```

Dialog fields:

```text
Template name
Notes
Save
Cancel
```

Validation:

```text
Template name is required.
Current page must have at least one included box.
All included boxes must have valid coordinates.
Template must include row/column structure.
```

Saved template should include:

```text
box positions
box sizes
included/excluded state
row/column structure records
box ordering pattern
box count
source page width
source page height
created_at
updated_at
```

Do not save:

```text
current PDF filename
page number
OCR JSON paths
crop image paths
OCR results
DB sync status
page completion status
review status
```

## 9. Template Browser Pane

Add a right-side pane inside the manual crop editor:

```text
Template Browser
```

The pane should be visible while editing crop boxes.

It should be vertically scrollable because there may be many templates.

Recommended layout:

```text
Manual Crop Editor
---------------------------------------------------------
| Toolbar                                                |
---------------------------------------------------------
| Canvas / page image / crop boxes      | Template pane  |
|                                       | Search         |
|                                       | Template card  |
|                                       | Template card  |
|                                       | Template card  |
---------------------------------------------------------
```

The Template Browser should show each template as a card.

Each card should include:

```text
thumbnail preview
template name
box count
last used or updated date
optional notes
Apply button
small menu for Rename / Duplicate / Delete
```

## 10. Template Thumbnail Preview

Each template card must show a small thumbnail that visually represents the template layout.

Do not require a real leaflet screenshot.

Generate the thumbnail from the template’s saved coordinates.

Recommended behavior:

```text
draw a small blank page rectangle
draw each included box as a small rectangle
draw excluded boxes differently or hide them
preserve the template source page aspect ratio
```

This can be generated live in React using SVG.

Recommended component:

```text
src/renderer/components/manual-crop/templates/CropTemplateThumbnail.tsx
```

Thumbnail rules:

```text
Use sourcePageWidth/sourcePageHeight to scale boxes.
Keep it lightweight.
Do not store image files for thumbnails unless necessary.
```

## 11. Template Browser Search and Sorting

Because many templates may exist, add at least:

```text
Search templates by name/notes
Vertical scrolling
Recently used or updated templates near the top
```

Recommended sort order:

```text
lastUsedAt descending
then updatedAt descending
then name ascending
```

Filtering:

```text
Search text matches template name or notes.
```

## 12. One-Click Apply Template

Clicking Apply on a template card should apply it to the current page.

Behavior:

```text
1. Take an undo snapshot.
2. Replace current page boxes with the template boxes.
3. Place boxes using exact saved x/y/width/height coordinates.
4. Rebuild or copy row/column structure.
5. Renumber boxes for the current page.
6. Select all applied boxes automatically.
7. Mark current page crops as stale.
8. Save current page layout.
9. Update template lastUsedAt.
```

No heavy dialog.

Since applying a template is destructive, rely on undo for fast recovery.

If the target page dimensions differ from the source dimensions, show a visible non-blocking warning in the editor or template pane:

```text
Template dimensions differ from this page. Applied exact coordinates.
```

Do not automatically scale unless the operator explicitly chooses a future optional action.

## 13. Critical Template Apply Selection Rule

After a template is applied, all boxes created from that template must be selected automatically.

This is required so the operator can immediately align the layout on the target page.

Expected behavior:

```text
Click Apply on a template card
→ template boxes appear
→ all template boxes are selected
→ operator can immediately hold left-click on any selected box and drag
→ all selected boxes move together
```

Keyboard behavior after template apply:

```text
Arrow keys move all applied boxes by 1 px.
Shift + Arrow moves all applied boxes by 10 px.
Esc clears the selection.
Clicking empty canvas clears the selection.
```

Show a helpful status or hint after applying a template:

```text
Applied template: Othaim 4x4 Standard
Selected boxes: 16
Tip: drag or use arrow keys to align all boxes.
```

## 14. Manage Templates

Each template card should have a small menu with:

```text
Rename
Duplicate
Delete
```

Rename:

```text
Ask for new name and optional notes.
Update template.
```

Duplicate:

```text
Create a copy with a new templateId.
Default name: "{original name} copy".
```

Delete:

```text
Ask for confirmation because templates are permanent.
Delete template from permanent storage.
Remove from browser pane.
```

Do not delete current page boxes when deleting a template.

## 15. Template Apply and Next-Page Carryover

Applying a template creates a normal current page layout.

After applying a template, the existing “Next Page uses latest current page structure” behavior should still work.

Example:

```text
Apply template to page 5.
Adjust boxes slightly.
Click Next Page.
If page 6 has no saved layout, page 6 should receive the latest page 5 layout as its starting structure.
```

Do not treat template-applied layouts as special after application.

They are just page layouts.

## 16. General Multi-Box Selection

Implement multi-box selection as a general crop editor feature.

It must work for layouts created by:

```text
initial grid
Generate Grid From This Box
Generate Row From This Box
Generate Column From This Box
copied previous page layout
saved template
manual add/duplicate/split/merge
```

Selection behavior:

```text
click a box = select only that box
Shift + click = add/remove box from selection
Ctrl/Cmd + click = add/remove box from selection
Esc = clear selection
Ctrl/Cmd + A = select all included boxes
```

If the app already has selection logic, extend it.

If multi-select already exists, make sure it supports the movement behavior below.

## 17. Marquee Drag-Selection Rectangle

Implement standard marquee selection on the manual crop canvas, similar to Adobe Acrobat, Figma, PowerPoint, or image editors.

Behavior:

```text
left-click and hold on empty canvas area
move the mouse while holding
a selection rectangle appears
the rectangle resizes as the mouse moves
release the mouse button
all boxes fully inside the selection rectangle become selected
selection rectangle disappears
```

This selection box is temporary UI only. It should not become a crop box.

Rules:

```text
A drag starting on empty canvas starts marquee selection.
A drag starting on a selected box moves the selected boxes.
A drag starting on an unselected box selects that box and may move it.
A simple click on empty canvas without meaningful drag clears selection.
The selection rectangle disappears immediately after mouse release.
Only boxes fully contained inside the selection rectangle are selected.
Do not select boxes merely because they partially overlap the rectangle.
```

Use a small movement threshold to distinguish click from drag, for example:

```text
3 to 5 screen pixels
```

Coordinates must be converted correctly between screen/canvas coordinates and page image coordinates, including zoom/pan.

## 18. Marquee Selection With Modifier Keys

For the first implementation, basic marquee selection may replace the current selection.

Required behavior:

```text
drag-select empty canvas = replace current selection with boxes fully inside rectangle
```

If straightforward, support modifiers:

```text
Shift + drag-select = add contained boxes to current selection
Ctrl/Cmd + drag-select = toggle contained boxes in current selection
```

Do not block the chunk if modifier marquee selection is complex, but basic marquee selection is required.

## 19. Multi-Box Movement

When multiple boxes are selected:

```text
drag one selected box = move all selected boxes together
```

Moving selected boxes together should:

```text
preserve relative spacing
preserve box widths
preserve box heights
preserve item numbers
preserve row/column membership
preserve included/excluded state
only update x and y for selected boxes
```

This feature is not specific to templates.

It should work at any time in the manual crop editor.

## 20. Dragging Selected Boxes

Dragging behavior must be natural:

```text
If one selected box is dragged, move that box.
If multiple boxes are selected and the drag starts on any selected box, move all selected boxes.
If a template was just applied, all applied boxes are selected, so dragging any applied box moves the whole template layout.
```

When dragging multiple boxes:

```text
capture the initial mouse position
capture initial x/y for every selected box
apply deltaX/deltaY to every selected box during drag
do not change widths/heights
do not change row/column memberships
```

Take an undo snapshot before the drag movement begins, not on every mousemove.

Mark crops stale when movement is committed.

## 21. Keyboard Nudge Movement

Support keyboard nudging for selected boxes:

```text
Arrow keys = move selected boxes by 1 px
Shift + Arrow = move selected boxes by 10 px
```

Rules:

```text
Do not trigger arrow movement while typing in input, textarea, select, or editable field.
If no boxes are selected, arrow keys should not move anything.
If one box is selected, move one box.
If many boxes are selected, move all selected boxes.
Take undo snapshots sensibly.
```

Avoid creating an undo snapshot for every repeated keydown if possible. It is acceptable to group movement into a single history step if the current undo system supports that.

## 22. Select All and Clear Selection UI

Add toolbar buttons or menu actions:

```text
Select All Boxes
Clear Selection
```

Keyboard:

```text
Ctrl/Cmd + A = select all included boxes
Esc = clear selection
```

If Ctrl/Cmd+A is pressed while typing in an input, it should select text normally and not select boxes.

## 23. Numeric Offset Movement

Add a small optional movement control in the toolbar or side panel:

```text
Move selected boxes
X offset: [ 0 ]
Y offset: [ 0 ]
Apply
```

This is useful when all boxes need to move slightly after applying a template.

Behavior:

```text
1. Operator selects boxes, usually all boxes.
2. Enters X offset and Y offset.
3. Clicks Apply.
4. App moves all selected boxes by that offset.
```

Example:

```text
X offset = 8
Y offset = -12
```

Moves selected boxes 8 px right and 12 px up.

If this is too much UI for the first implementation, add it in a compact collapsible “Move selected” section.

## 24. Boundary Behavior

When moving selected boxes, do not silently resize or clamp boxes.

If any selected box ends up outside the page boundaries:

```text
allow the movement
show a visible warning:
"Some boxes are outside the page."
```

Final crop validation will catch invalid boxes before cropping.

This is simpler and preserves operator control.

## 25. Crop Stale Handling

Any template apply or multi-box movement should mark the current page’s crops as stale.

Actions that mark crops stale:

```text
Apply Template
Move selected boxes by drag
Move selected boxes by keyboard
Move selected boxes by numeric offset
Select all then move
Marquee select then move
```

This should integrate with the existing background crop behavior from Chunk 32.

When the operator leaves the page after applying/moving boxes, background cropping should regenerate crops using the latest box coordinates.

## 26. Undo Support

Undo is required for:

```text
Apply Template
Save Template does not need undo because it does not change the page
Delete Template does not affect current page layout
Multi-box drag movement
Keyboard nudge movement
Numeric offset movement
```

Before applying a template or moving selected boxes, take a layout history snapshot.

Ctrl/Cmd+Z should restore the previous page layout.

Undo should restore:

```text
box coordinates
box selection if practical
row/column structure
crop stale status if practical
```

At minimum, it must restore the previous box layout.

## 27. Row/Column Structure During Movement

Moving boxes together should not change row/column membership.

Do not rebuild row/column records only because boxes moved.

The structure remains valid because the same boxes still belong to the same rows/columns.

If existing validation requires row/column structure update after any coordinate change, keep the records consistent but do not change memberships unless a destructive operation occurs.

## 28. Template Apply and Row/Column Structure

When applying a template:

```text
copy template rows/columns
copy template box rowId/columnId memberships
generate new box ids for the current page if needed
renumber item numbers
validate structure
select all newly applied boxes
```

Do not reuse template box IDs if that would conflict with current page layout IDs.

Recommended:

```text
new page boxes get new unique ids
row/column ids can be regenerated
membership should map correctly
```

## 29. Template Browser UI Files

Create or update components similar to:

```text
src/renderer/components/manual-crop/templates/CropTemplateBrowser.tsx
src/renderer/components/manual-crop/templates/CropTemplateCard.tsx
src/renderer/components/manual-crop/templates/CropTemplateThumbnail.tsx
src/renderer/components/manual-crop/templates/SaveCropTemplateDialog.tsx
src/renderer/components/manual-crop/templates/TemplateManageMenu.tsx
```

Create or update hook:

```text
src/renderer/hooks/useCropLayoutTemplates.ts
```

Hook responsibilities:

```text
load templates
search/filter templates
save current layout as template
apply template to current page
rename template
duplicate template
delete template
track loading/error states
```

## 30. Manual Crop Editor Layout Update

Update:

```text
src/renderer/components/manual-crop/ManualCropEditor.tsx
```

The editor should include the Template Browser pane on the right.

The pane must be scrollable vertically.

Make sure the canvas remains usable and not squeezed too much.

If screen width is small, allow the template pane to collapse.

Recommended controls:

```text
Show/Hide Template Browser
```

Default: visible.

## 31. Status Indicators

Show useful information:

```text
Selected boxes: 12
Template applied: Othaim 4x4 Standard
Page crops: stale
```

In the Template Browser:

```text
Templates: 24
Search: [        ]
```

In each template card:

```text
thumbnail
name
16 boxes
updated date
Apply
```

When marquee selection is active, show the selection rectangle visually on the canvas.

## 32. Tests / Smoke Checks

Add tests or smoke checks for:

```text
Save Template stores current boxes with exact coordinates.
Save Template stores source page width/height.
Save Template does not store OCR/crop/DB metadata.
Template persists outside import workspace.
Template list loads after app restart or service reinitialization.
Template thumbnail renders box layout from coordinates.
Apply Template replaces current page boxes.
Apply Template places boxes at exact saved coordinates.
Apply Template marks crops stale.
Apply Template takes undo snapshot.
Apply Template selects all applied boxes automatically.
After Apply Template, dragging one applied box moves all applied boxes.
After Apply Template, Arrow keys nudge all applied boxes.
Undo after Apply Template restores previous boxes.
Apply Template updates lastUsedAt.
Rename Template updates name/notes.
Duplicate Template creates new template ID.
Delete Template removes template after confirmation.
Template Browser is vertically scrollable.
Template Browser search filters by name/notes.
Click box selects one box.
Shift/Ctrl/Cmd click toggles multi-selection.
Ctrl/Cmd+A selects all included boxes.
Esc clears selection.
Left-click and drag from empty canvas starts marquee selection.
Marquee selection rectangle appears while dragging.
Marquee selection rectangle disappears on mouse release.
Boxes fully inside marquee rectangle become selected.
Boxes partially overlapping marquee rectangle are not selected.
Clicking empty canvas without dragging clears selection.
Dragging one selected box moves all selected boxes.
Arrow keys nudge selected boxes by 1 px.
Shift+Arrow nudges by 10 px.
Numeric offset moves selected boxes by exact offset if implemented.
Moving selected boxes preserves relative spacing.
Moving selected boxes preserves width/height.
Moving selected boxes preserves row/column membership.
Moving selected boxes marks crops stale.
Boundary warning appears if boxes move outside page.
Delete/Backspace still deletes selected boxes after multi-select changes.
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If any script does not exist, document that clearly and do not invent success.

## 33. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
How to save the current crop layout as a permanent template.
Where templates are stored conceptually.
How to use the Template Browser pane.
How to apply a template with one click.
How template thumbnails work.
How to rename, duplicate, and delete templates.
How exact-coordinate template application works.
What happens if target page dimensions differ.
How all boxes are selected automatically after applying a template.
How to drag/nudge all template boxes immediately after applying.
How to select multiple boxes.
How to use marquee drag-selection.
How to select all boxes.
How to drag multiple boxes together.
How to nudge selected boxes with keyboard.
How to move selected boxes by numeric offset.
How template apply and movement mark crops stale.
```

Add example:

```text
Example: saving and reusing a layout

1. Adjust boxes on page 3 until they fit the repeated leaflet layout.
2. Click Save Template.
3. Name it "Othaim 3-column snacks page".
4. Move to another page with the same layout.
5. Click Apply on that template in the right Template Browser pane.
6. The boxes appear at the exact saved coordinates.
7. All applied boxes are selected automatically.
8. If the page is slightly shifted, drag any selected box or use arrow keys to move the entire layout.
9. Make any small individual adjustments.
```

Add example:

```text
Example: selecting boxes with a selection rectangle

1. Left-click and hold on empty canvas space.
2. Drag the mouse.
3. A temporary selection rectangle appears.
4. Release the mouse.
5. All boxes fully inside the rectangle become selected.
6. The selection rectangle disappears.
7. Drag any selected box to move the selected group.
```

Add example:

```text
Example: moving all boxes slightly

1. Click Ctrl/Cmd+A to select all boxes.
2. Press Shift+Right twice to move all boxes 20 px right.
3. Press Up five times to move all boxes 5 px up.
4. The relative layout stays the same.
5. Page crops become stale and will regenerate when leaving the page.
```

## 34. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose raw `ipcRenderer`.
* Do not expose generic filesystem IPC.
* Do not expose arbitrary template file paths to the renderer if not needed.
* Do not upload images in this chunk.
* Do not run OCR in this chunk.
* Do not write to Wifran DB in this chunk.
* Do not publish offers in this chunk.
* Store permanent templates only in the app’s user data/template storage area.
* Only modify current page crop layout data inside the import workspace.

## 35. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 36. Acceptance Criteria

This chunk is complete when:

* Save Template button exists in the manual crop editor.
* Current page layout can be saved as a permanent template.
* Templates persist outside the current import workspace.
* Template Browser pane appears on the right side of the editor.
* Template Browser is vertically scrollable.
* Template cards show thumbnail previews.
* Template cards show template name and box count.
* Template cards have one-click Apply.
* Applying a template replaces current page boxes using exact saved coordinates.
* Applying a template marks current page crops stale.
* Applying a template can be undone.
* Applying a template automatically selects all applied boxes.
* After applying a template, dragging any selected applied box moves all applied boxes together.
* After applying a template, Arrow keys nudge all applied boxes.
* Templates can be renamed.
* Templates can be duplicated.
* Templates can be deleted with confirmation.
* Multi-box selection works.
* Ctrl/Cmd+A selects all included boxes.
* Esc clears selection.
* Marquee drag-selection from empty canvas works.
* Marquee selection rectangle appears during drag.
* Marquee selection rectangle disappears after mouse release.
* Boxes fully inside the marquee selection rectangle become selected.
* Boxes only partially overlapping the marquee selection rectangle are not selected.
* Dragging selected boxes moves them together.
* Arrow-key nudging works for selected boxes.
* Shift+Arrow nudging works for selected boxes.
* Numeric offset movement works if implemented.
* Multi-box movement is available for all layouts, not only templates.
* Moving boxes marks page crops stale.
* Boundary warning appears if boxes are moved outside the page.
* Documentation is updated.
* TypeScript compiles.
* App still starts.

## 37. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How permanent template storage works.
* How Save Template works.
* How the Template Browser pane works.
* How template thumbnails are generated.
* How Apply Template works.
* How exact-coordinate placement works.
* How all boxes are selected after template apply.
* How immediate template alignment by drag/arrow keys works.
* How dimension mismatch is handled.
* How rename/duplicate/delete works.
* How multi-box selection works.
* How marquee drag-selection works.
* How multi-box movement works.
* How keyboard nudge works.
* How numeric offset movement works, if implemented.
* How crop stale state is handled.
* How to test the feature.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.