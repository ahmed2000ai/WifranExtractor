# Antigravity Prompt Chunk 37: Manual Crop Editor Fit-Page View and Compact UI

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 37. Prompt Chunks 28 to 36 should already have implemented the manual crop editor, streaming page rendering, next-page layout carryover, grid/row/column generation, delete box, background page cropping, raw flexible item OCR, OCR key discovery, persistent crop layout templates, and multi-box movement.

This chunk improves the Manual Crop Editor UI so the leaflet page is the main focus.

The current editor uses too much vertical and horizontal space for full text buttons and side panels. The goal is to make the page fit on screen when the app is maximized, avoid unnecessary scrolling, and move less-frequent actions into contextual menus, the template pane, or a compact page actions menu.

## 1. Read These Files First

Before coding, read the current manual crop editor and UI files.

Read files similar to:

```text
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/components/manual-crop/ManualCropToolbar.tsx
src/renderer/components/manual-crop/ManualCropCanvas.tsx
src/renderer/components/manual-crop/ManualCropBoxList.tsx
src/renderer/components/manual-crop/ManualCropThumbnailPreview.tsx
src/renderer/components/manual-crop/templates/CropTemplateBrowser.tsx
src/renderer/components/manual-crop/templates/CropTemplateCard.tsx
src/renderer/components/manual-crop/templates/CropTemplateThumbnail.tsx
src/renderer/components/manual-crop/templates/SaveCropTemplateDialog.tsx
src/renderer/hooks/useManualCropLayout.ts
src/renderer/hooks/useStreamingPdfRender.ts
src/shared/types/manualCrop.ts
src/shared/types/cropLayoutTemplate.ts
src/shared/utils/manualCropGeometry.ts
src/renderer/pages/ImportPage.tsx
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Adapt paths if the current project structure differs.

## 2. Main Goal

Redesign the Manual Crop Editor UI so:

```text
the full leaflet page fits in the visible editor area by default
the page is centered and visible without vertical scrolling when the app is maximized
the top controls are compact
the toolbar is a single compact row
most toolbar buttons are icon-only with hover tooltips
box-specific actions move mostly to the right-click context menu
template actions live inside the template pane
items and templates share a cleaner right-side panel
the editor feels like a real canvas editing tool
```

Do not remove existing functionality.

Reorganize the UI so existing features are still available but take less space.

## 3. Fit Page Zoom Mode

Add a default zoom mode:

```text
Fit Page
```

When the Manual Crop Editor opens a page, it should automatically calculate the zoom level required to fit the full rendered leaflet page inside the visible canvas area.

The page should be just small enough to fit the available editor space.

It should not be unnecessarily tiny.

The calculation should account for:

```text
available window size
compact header height
compact toolbar height
status bar height if present
right-side pane width if visible
canvas padding/margins
page image width
page image height
```

Formula concept:

```text
availableCanvasWidth = editorWidth - rightPaneWidth - horizontalPadding
availableCanvasHeight = editorHeight - headerHeight - toolbarHeight - statusBarHeight - verticalPadding

fitZoom = min(
  availableCanvasWidth / pageImageWidth,
  availableCanvasHeight / pageImageHeight
)

fitZoom = fitZoom * 0.96
```

The `0.96` is a safety margin so the page is not flush against the edges.

Clamp zoom to safe values:

```text
minZoom = 5%
maxZoom = 200% or current app max
```

If the calculated fit zoom is too small to be usable, still fit the page but allow the operator to zoom in manually.

## 4. Zoom Modes

Support these zoom modes:

```text
Fit Page
Fit Width
Manual Zoom
```

Default:

```text
Fit Page
```

Behavior:

```text
When a page first opens, use Fit Page.
When the app window is resized while in Fit Page mode, recalculate fit zoom.
When the right pane is shown/hidden while in Fit Page mode, recalculate fit zoom.
When the operator clicks Zoom In or Zoom Out, switch to Manual Zoom.
When the operator clicks Fit Page, return to Fit Page mode and recalculate.
When the operator clicks Fit Width, switch to Fit Width mode and recalculate width-based zoom.
```

Fit Width calculation:

```text
fitWidthZoom = availableCanvasWidth / pageImageWidth
fitWidthZoom = fitWidthZoom * 0.96
```

Manual Zoom should preserve existing zoom behavior.

## 5. No Vertical Scroll by Default

In maximized mode, the full page should be visible without scrolling when using Fit Page.

The canvas should center the page both horizontally and vertically when possible.

The page image area should not require vertical scrolling unless:

```text
the operator manually zooms in
the app window is too small
the right pane takes too much space and the user refuses to hide it
```

If manual zoom exceeds available area, scrolling/panning is acceptable.

But initial/default page view must fit the full page.

## 6. Compact Header Layout

Replace the current large header/navigation layout with a compact header row.

Recommended header:

```text
Manual Crop Editor | ← Prev | Page 2 of 54 | Next → | Rendering: 44 / 54 ready | Close
```

Rules:

```text
Use one compact row.
Keep page navigation visible.
Keep rendering status visible but small.
Close button remains visible.
Avoid large vertical spacing.
```

If there is not enough horizontal space, allow the rendering status to shorten:

```text
Rendering: 44/54
```

## 7. Compact Single-Row Toolbar

Convert the toolbar to a single compact row.

The toolbar should use mostly icon-only buttons with hover tooltips.

The current full-text buttons take too much space.

Required toolbar actions to keep visible as compact icons:

```text
Fit Page
Fit Width
Zoom Out
Current Zoom Display
Zoom In
Undo
Redo
Add Box
Select All
Clear Selection
Save Template
Mark Page Complete
More / Page Actions
```

The current zoom display can be text, for example:

```text
20%
```

Use tooltips for every icon-only button.

Example tooltips:

```text
Fit Page
Fit Width
Zoom Out
Zoom In
Undo
Redo
Add Box
Select All Boxes
Clear Selection
Save Current Layout as Template
Mark Page Complete
Page Actions
```

The toolbar must remain one compact row at normal desktop widths.

Avoid wrapping into two rows unless the window is very narrow.

## 8. Move Box-Specific Actions to Context Menu

Move box-specific actions mostly out of the top toolbar.

These actions should primarily live in the crop box right-click menu:

```text
Generate Grid From This Box...
Generate Row From This Box...
Generate Column From This Box...
Delete Box
Exclude Box
Include Box
Merge Selected Boxes
Split Horizontal
Split Vertical
Duplicate Box Right
Duplicate Box Left
Duplicate Box Up
Duplicate Box Down
```

If some of these already exist in context menu, keep them there.

If they also remain in the toolbar, they must be icon-only and not consume much space.

Preferred behavior:

```text
Top toolbar = frequent global actions.
Right-click menu = box-specific actions.
```

## 9. Page Actions Menu

Move less frequent page-level actions into a compact menu:

```text
⋯ Page Actions
```

The Page Actions menu should contain:

```text
Save Layout
Renumber Boxes
Generate Crops
Delete Page
```

Optional if already supported:

```text
Copy Layout to Next Page
Apply Current Layout to Remaining Pages
Rebuild Crop Status
```

Rules:

```text
Delete Page should remain visually dangerous/red inside the menu.
Generate Crops remains available but does not need a large top-level button.
Save Layout remains available but does not need a large top-level button.
Renumber All remains available but does not need a large top-level button.
```

## 10. Template Controls Belong in the Template Pane

Move or duplicate template-specific actions into the right template pane.

The Template Browser pane should include:

```text
Templates title
Search templates input
Save Current Layout as Template button
Template cards
```

The top toolbar may keep a compact Save Template icon, but template management should primarily live in the template pane.

The right pane should be the main place for:

```text
Save Template
Apply Template
Rename Template
Duplicate Template
Delete Template
Search Templates
```

## 11. Right-Side Panel Redesign

The screenshot shows the Items panel and Templates panel competing for space.

Change the right side into a cleaner panel.

Use one of these designs:

### Preferred: tabbed right pane

```text
[Templates] [Items]
```

Only one tab is visible at a time.

Default tab:

```text
Templates
```

because the new workflow often uses templates.

The Items tab should show:

```text
item count
box list
box dimensions
selected box info
crop status if useful
```

The Templates tab should show:

```text
search
save template
scrollable template cards
```

### Acceptable alternative: collapsible panes

```text
Templates
Items
```

Both can collapse/expand.

Default:

```text
Templates expanded
Items collapsed or compact
```

The right panel must be vertically scrollable where needed.

It must not cover or overlay the canvas unless intentionally collapsed/expanded.

## 12. Right Pane Width

Set a reasonable right pane width.

Recommended:

```text
280px to 340px
```

It should not be so wide that the page canvas becomes too small.

Allow show/hide:

```text
Show Templates
Hide Templates
```

or:

```text
Show Side Panel
Hide Side Panel
```

When the right pane is hidden or shown and zoom mode is Fit Page, recalculate zoom.

## 13. Canvas Layout

The main canvas area should:

```text
use remaining space after header, toolbar, and right pane
center the page image
respect zoom/pan
show the full page in Fit Page mode
avoid unnecessary vertical scroll
avoid being overlapped by the right pane
```

The canvas should not be pushed below by a large toolbar.

Use CSS layout such as:

```text
height: 100vh
display: grid or flex column
header: auto
toolbar: auto
main: 1fr minmax(0)
status: auto
```

The central canvas container must have:

```text
min-height: 0
overflow: hidden or auto depending on zoom mode
```

Fit Page mode should avoid scrollbars where possible.

## 14. Bottom Status Bar

If a bottom status bar exists, keep it slim.

It can show compact status like:

```text
Rendering: 44 / 54 ready. You can edit while remaining pages render.
Crops: Not Started
Selected boxes: 14
```

Do not let the status bar consume large vertical space.

If the status text is long, truncate or wrap minimally.

## 15. Icons and Tooltips

Use the existing UI/icon library if available.

If no icon library exists, use compact text symbols as fallback.

Examples:

```text
Fit Page: ⛶ or [Fit]
Fit Width: ↔
Zoom Out: −
Zoom In: +
Undo: ↶
Redo: ↷
Add Box: ＋□
Select All: ⧉
Clear: ✕
Save Template: ☆ or 💾
Mark Complete: ✓
Page Actions: ⋯
```

Every icon-only button must have:

```text
aria-label
title tooltip or tooltip component
```

Accessibility is important.

## 16. Button Grouping

Group toolbar controls visually:

```text
Zoom group:
Fit Page | Fit Width | − | 20% | +

History group:
Undo | Redo

Box group:
Add Box | Select All | Clear

Workflow group:
Save Template | Mark Complete | Page Actions
```

Use separators or spacing but keep the row compact.

## 17. Remove Duplicate Large Buttons

Remove or replace large full-text toolbar buttons such as:

```text
Zoom Out
Zoom In
Undo
Redo
+ Add Box
Merge
Split Horiz
Split Vert
To 3 Stacked
Select All
Clear
Exclude
Include
Renumber All
Delete Page
Save Template
Mark Page Complete
Save Layout
Generate Crops
```

Do not remove the actions.

Only change where/how they are accessed.

## 18. Keep Keyboard Shortcuts Working

Keep or ensure keyboard shortcuts:

```text
Ctrl/Cmd+Z = Undo
Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z = Redo
Ctrl/Cmd+A = Select all boxes when not typing
Esc = Clear selection
Delete/Backspace = Delete selected boxes
Arrow keys = Nudge selected boxes
Shift+Arrow = Nudge selected boxes by larger step
```

The compact UI should not break keyboard-driven editing.

## 19. Fit Page Recalculation Triggers

Recalculate Fit Page zoom when:

```text
page image loads
current page changes
window is resized
right pane is shown/hidden
right pane width changes
header/toolbar height changes
rendered page dimensions become available
```

Use `ResizeObserver` if appropriate.

Avoid infinite loops.

Avoid jittery zoom recalculations while dragging boxes.

Do not recalculate Fit Page while the operator is actively dragging/moving boxes unless necessary.

## 20. Interaction With Manual Zoom

If operator clicks Zoom In or Zoom Out:

```text
zoomMode = manual
```

Manual mode should not auto-fit on resize.

If operator clicks Fit Page:

```text
zoomMode = fit_page
```

If operator clicks Fit Width:

```text
zoomMode = fit_width
```

Show current mode if useful:

```text
Fit Page active
Fit Width active
Manual 35%
```

## 21. Interaction With Templates

The Template Browser must remain useful but not dominate the canvas.

Required:

```text
Template pane is scrollable vertically.
Template thumbnails remain small.
Apply Template remains one click.
Save Current Layout as Template exists inside the pane.
Search templates remains visible.
```

After applying a template:

```text
all applied boxes remain selected
the operator can immediately drag/nudge them
Fit Page zoom should remain active unless applying template changes zoom unexpectedly
```

Applying a template must not cause the page to jump/scroll unexpectedly.

## 22. Interaction With Items List

The Items list should still be available, but not always consume prime space.

If using tabs:

```text
Templates tab default
Items tab available
```

If using collapsible panes:

```text
Items can be collapsed by default
```

The Items list should show compact rows.

Avoid very large item rows.

The item dimensions can be smaller text.

## 23. Visual Density

Use a compact visual density for the editor.

Recommended:

```text
toolbar height around 36–44px
header height around 36–44px
right pane cards compact
minimal vertical padding
```

Avoid excessive margins.

The canvas should get the majority of available screen height.

## 24. Prevent Overlay Problems

In the screenshot, the Template Browser appears visually over darkened content while a Save Template dialog is open.

Make sure modals/dialogs behave correctly:

```text
Save Template dialog should appear centered or clearly placed.
Modal overlay should not make the rest of the editor unusable in an accidental way.
Template pane should not overlay the canvas unless intentionally designed.
Right pane should be part of layout, not floating over boxes.
```

If a modal is open, it should be clear and easy to close.

## 25. Tests / Smoke Checks

Add tests or smoke checks for:

```text
Manual Crop Editor opens in Fit Page mode by default.
Full page is visible in Fit Page mode with no vertical scroll in maximized window.
Fit Page zoom is recalculated on window resize.
Fit Page zoom is recalculated when right pane is hidden/shown.
Zoom In switches to Manual Zoom.
Zoom Out switches to Manual Zoom.
Fit Page button returns to Fit Page mode.
Fit Width button works.
Toolbar renders as one compact row.
Icon-only buttons have accessible labels/tooltips.
Page Actions menu contains Save Layout, Renumber Boxes, Generate Crops, Delete Page.
Box-specific actions are available in right-click menu.
Template pane contains Save Current Layout as Template.
Template pane is vertically scrollable.
Templates and Items are organized as tabs or collapsible panes.
Right pane does not overlay the canvas.
Canvas centers the page in Fit Page mode.
Keyboard shortcuts still work.
Applying a template does not break Fit Page view.
Dragging/nudging selected boxes still works after UI refactor.
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If any script does not exist, document that clearly and do not invent success.

## 26. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
The Manual Crop Editor now opens in Fit Page mode.
The whole leaflet page should fit on screen when maximized.
Zoom modes: Fit Page, Fit Width, Manual.
Most toolbar controls are icon-only with hover tooltips.
Box actions are mostly in the right-click menu.
Page actions are in the Page Actions menu.
Template actions are in the Template Browser pane.
Templates and Items are organized in the right-side panel.
How to hide/show the right panel.
What to do if the page appears too small or too large.
```

Add operator guidance:

```text
Recommended workflow:
1. Open the manual crop editor.
2. The page appears fitted to the window.
3. Use the compact toolbar for zoom, undo/redo, add box, select all, and page completion.
4. Use right-click on boxes for box-specific actions.
5. Use the right Template Browser pane to apply or save templates.
6. Hide the right pane if you need more canvas space.
7. Use Fit Page to return to full-page view.
```

## 27. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose raw `ipcRenderer`.
* Do not expose generic filesystem IPC.
* Do not upload images in this chunk.
* Do not run OCR in this chunk.
* Do not write to Wifran DB in this chunk.
* Do not publish offers in this chunk.
* This chunk is UI/layout only.

## 28. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 29. Acceptance Criteria

This chunk is complete when:

* Manual Crop Editor opens in Fit Page mode by default.
* In maximized window, the full page is visible without needing to scroll vertically, unless the operator manually zooms in.
* Fit Page calculates zoom from available canvas width/height.
* Fit Width mode exists.
* Manual Zoom mode still works.
* Zoom recalculates on resize and right-pane show/hide when in Fit Page/Fit Width mode.
* Header is compact.
* Toolbar is a single compact row.
* Main toolbar buttons are icon-only or compact with tooltips.
* Box-specific actions are available in right-click menu.
* Less frequent page actions are moved to a Page Actions menu.
* Template-specific actions live in the Template Browser pane.
* Right side panel uses tabs or collapsible panes for Templates and Items.
* Template pane is vertically scrollable.
* Canvas is not overlapped by the right pane.
* Page is centered in the canvas.
* Keyboard shortcuts still work.
* Existing template apply, multi-box selection, marquee selection, and movement still work.
* Documentation is updated.
* TypeScript compiles.
* App still starts.

## 30. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How Fit Page zoom is calculated.
* How Fit Width works.
* How Manual Zoom works.
* How resize/right-pane changes affect zoom.
* How the compact header is structured.
* How the compact toolbar is structured.
* Which actions stayed in the toolbar.
* Which actions moved to context menu.
* Which actions moved to Page Actions.
* How the Template Browser pane changed.
* How the Items panel is accessed.
* How to test the maximized-window full-page view.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.