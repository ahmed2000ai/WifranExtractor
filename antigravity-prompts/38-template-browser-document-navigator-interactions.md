# Antigravity Prompt Chunk 38: Template Browser Document-Navigator UI and Interactions

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 38. Prompt Chunks 28 to 37 should already have implemented the manual crop editor, persistent crop layout templates, template browser pane, multi-box movement, compact UI, and fit-page zoom.

This chunk improves the Template Browser pane so it behaves like a compact document/page navigator rather than a large card gallery.

The current template pane has too much spacing between templates and uses too much vertical space. The operator wants a dense, scrollable template navigator similar to a PDF page thumbnail sidebar.

## 1. Read These Files First

Before coding, read the current template browser and crop editor files.

Read files similar to:

```text
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/components/manual-crop/ManualCropToolbar.tsx
src/renderer/components/manual-crop/ManualCropCanvas.tsx
src/renderer/components/manual-crop/templates/CropTemplateBrowser.tsx
src/renderer/components/manual-crop/templates/CropTemplateCard.tsx
src/renderer/components/manual-crop/templates/CropTemplateThumbnail.tsx
src/renderer/components/manual-crop/templates/SaveCropTemplateDialog.tsx
src/renderer/components/manual-crop/templates/TemplateManageMenu.tsx
src/renderer/hooks/useCropLayoutTemplates.ts
src/renderer/hooks/useManualCropLayout.ts
src/shared/types/cropLayoutTemplate.ts
src/main/templates/cropLayoutTemplateService.ts
src/main/ipc/cropLayoutTemplateIpc.ts
src/preload/index.ts
src/shared/types/preload.ts
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Adapt paths if the current project structure differs.

## 2. Main Goal

Change the Template Browser pane into a compact document-navigator style list.

Implement:

```text
dense template list
small page-like thumbnail previews
minimal gaps between templates
single-click template selection
double-click template apply
Delete/Backspace key deletes selected template after confirmation
right-click context menu on templates
clear selected template when appropriate
focus-aware Delete behavior so it does not conflict with crop-box deletion
```

The template pane should look and feel closer to a PDF page thumbnail navigator.

## 3. Visual Design Goal

The Template Browser should not look like large separated cards.

It should look like a compact vertical navigator:

```text
Templates
[Search templates...]

[thumbnail]  Othaim 4x4 Standard
             16 boxes • updated Jun 13

[thumbnail]  Othaim right column
             14 boxes • updated Jun 13

[thumbnail]  Othaim snacks page
             12 boxes • updated Jun 12
```

The pane should show many templates at once without large empty gaps.

## 4. Template Entry Layout

Replace the large card layout with a compact row/list item layout.

Each template entry should include:

```text
small thumbnail preview
template name
box count
updated date or last used date
optional short notes if space allows
```

Recommended row layout:

```text
[small thumbnail]  Template Name
                   16 boxes • updated 2026-06-13
```

Rules:

```text
Template rows should be compact.
Spacing between rows should be small.
Avoid large blank spaces between templates.
Avoid big action buttons taking vertical space.
Use hover/focus/selected styling instead of oversized cards.
```

Recommended approximate sizes:

```text
thumbnail width: 72px to 110px
thumbnail height: based on source page aspect ratio
row vertical padding: 6px to 10px
gap between template entries: 4px to 8px
```

The exact values may be adapted to the existing UI style.

## 5. Template Thumbnail Style

The thumbnail should look like a miniature page preview.

It should:

```text
draw a white or light page rectangle
draw included crop boxes as thin outlines
preserve the template source page aspect ratio
fit inside a small thumbnail area
use minimal padding
```

Do not require a real leaflet screenshot.

Generate thumbnail from template coordinates.

If currently generated thumbnails are too large, reduce them.

If thumbnails are currently creating large vertical gaps, fix the CSS/layout so the row height is driven by the compact thumbnail size, not by large card spacing.

## 6. Scrollable Pane

The Template Browser must be vertically scrollable.

Rules:

```text
Template pane has fixed/available height inside the editor.
Template list scrolls vertically.
Template rows do not overflow outside the pane.
Search/header stays visible if practical.
No large gaps between entries.
```

If the right side panel has tabs, the Templates tab content should scroll internally.

## 7. Single-Click Select Template

When the operator single-clicks a template entry:

```text
the template becomes selected
the selected template row is highlighted
keyboard focus moves to the template browser/list
selectedTemplateId is stored in component state
```

Only one template needs to be selected at a time.

Selected state should be visually clear.

Suggested selected styling:

```text
subtle blue background or border
clear focus outline
thumbnail border highlight
```

Do not apply the template on single click.

Single click only selects.

## 8. Double-Click Applies Template Immediately

When the operator double-clicks a template entry:

```text
apply that template to the current page immediately
do not show a confirmation dialog
take the normal undo snapshot
replace current page boxes with the template boxes
place boxes using exact saved coordinates
select all applied boxes automatically
mark crops stale
save current page layout
update template lastUsedAt
```

This should behave the same as the existing Apply Template button/action, but triggered by double-click.

No confirmation prompt.

After applying, show a compact status message if the app has a status/toast system:

```text
Applied template: Othaim 4x4 Standard
Selected boxes: 16
```

## 9. Apply Button Should Be Secondary or Removed

Because double-click is now the fast apply action, large Apply buttons should not dominate the template pane.

Choose one of these approaches:

### Preferred

Remove always-visible large Apply buttons from each template row.

Use:

```text
single click = select
double click = apply
right-click menu = apply / rename / duplicate / delete
```

### Acceptable

Show a very small Apply action only on hover or only for the selected template.

Do not use large full-width Apply buttons that create vertical gaps.

## 10. Delete Key for Selected Template

When a template is selected in the Template Browser and the Template Browser has focus, pressing:

```text
Delete
Backspace
```

should ask for confirmation before deleting the selected template.

Confirmation message:

```text
Delete template “{template name}”?

This permanently deletes the saved template.
It will not affect the current page layout.

[Delete Template] [Cancel]
```

If confirmed:

```text
delete template from permanent template storage
remove it from template browser
clear selectedTemplateId
do not change current page boxes
do not delete crop boxes
```

This must use the existing template delete service.

## 11. Keyboard Focus Priority Rules

The crop canvas also uses Delete/Backspace to delete selected crop boxes. Avoid conflicts.

Implement clear focus priority rules:

```text
If focus is inside input, textarea, select, contenteditable, or search field:
  Delete/Backspace behaves normally for text editing.

Else if template browser/list is focused and selectedTemplateId exists:
  Delete/Backspace opens delete-template confirmation.

Else if crop canvas is focused and crop boxes are selected:
  Delete/Backspace deletes selected crop boxes.

Else:
  do nothing.
```

If both crop boxes and a template are selected, the active focused area decides what Delete means.

Clicking a template entry should focus the template browser/list.

Clicking the crop canvas should focus the crop canvas.

## 12. Right-Click Context Menu on Template Entries

Add right-click context menu for template entries.

Menu items:

```text
Apply Template
Rename Template
Duplicate Template
Delete Template
```

Behavior:

```text
Right-clicking a template also selects that template.
Apply Template applies immediately, no confirmation.
Rename opens rename/edit dialog.
Duplicate creates a copy.
Delete asks confirmation.
```

The context menu should be compact.

Do not use large visible action buttons for every template row.

## 13. Template Selection State

Maintain selection state in the template browser.

Required state:

```text
selectedTemplateId
templateBrowserHasFocus or equivalent focus tracking
```

Behavior:

```text
single-click template sets selectedTemplateId
right-click template sets selectedTemplateId
double-click template sets selectedTemplateId and applies
deleting selected template clears selectedTemplateId
search filtering should preserve selection if selected template remains visible
if selected template is filtered out, selection may remain internally but should not show a visible row
```

If the selected template is deleted, clear selection.

## 14. Search Field Behavior

The search field should remain at the top of the template pane.

Rules:

```text
Typing in search should not trigger crop editor shortcuts.
Delete/Backspace in search should edit text, not delete selected template.
Ctrl/Cmd+A in search should select text, not crop boxes or templates.
Esc in search may clear search or blur, depending on existing UX.
```

## 15. Template Row States

Template rows should have visual states:

```text
normal
hovered
selected
focused
applying/loading if applicable
```

If applying a template is asynchronous, show a short loading state on that row or disable repeated clicks until apply completes.

## 16. Dense CSS Requirements

Update CSS/classes so the template browser is compact.

Avoid:

```text
large card margins
large vertical gaps
full-width bulky buttons
oversized thumbnails
unnecessary card shadows
large blank metadata areas
```

Prefer:

```text
thin borders
compact padding
small thumbnail
small metadata text
selected highlight
hover highlight
```

The Template Browser pane should visually resemble a navigator/sidebar, not a dashboard card grid.

## 17. Interaction With Existing Template Apply Behavior

Do not break existing template behavior from Chunk 36.

Double-click and context-menu apply must still:

```text
take undo snapshot
replace current page boxes
use exact saved coordinates
select all applied boxes automatically
mark crops stale
save layout
update lastUsedAt
show dimension mismatch warning if applicable
```

## 18. Interaction With Fit-Page UI

This chunk should not break the compact UI and Fit Page behavior from Chunk 37.

The Template Browser should:

```text
stay inside the right pane
not overlay the canvas
not force the canvas to scroll unnecessarily
not create large vertical spacing
not break right-pane show/hide
```

If hiding/showing the template pane changes available canvas size, existing Fit Page recalculation should still work.

## 19. Accessibility

Template rows should be keyboard/focus accessible.

At minimum:

```text
template row has role/button or listitem with proper tabIndex
aria-selected reflects selected state if using listbox pattern
Enter may apply selected template if easy
Delete/Backspace deletes selected template with confirmation when focused
title/aria-labels for context menu and actions
```

Optional:

```text
Arrow Up/Down moves selected template in the list
Enter applies selected template
```

Do not block the chunk on optional keyboard navigation beyond Delete/Backspace, but implement if straightforward.

## 20. Error Handling

Handle:

```text
template apply failure
template delete failure
template not found
selected template deleted while filtered/searching
context menu action on missing template
focus conflict between template pane and canvas
```

Use clear error messages.

Suggested error codes if the app uses them:

```text
CROP_TEMPLATE_APPLY_FAILED
CROP_TEMPLATE_DELETE_FAILED
CROP_TEMPLATE_NOT_FOUND
CROP_TEMPLATE_SELECTION_INVALID
```

## 21. Tests / Smoke Checks

Add tests or smoke checks for:

```text
Template Browser renders compact dense rows.
Template entries do not have large vertical gaps.
Thumbnail preview is small and page-like.
Single click selects a template.
Single click does not apply template.
Selected template row is visually highlighted.
Double-click applies template immediately.
Double-click apply does not show confirmation.
After double-click apply, all applied boxes are selected.
Delete key with template browser focused shows delete confirmation.
Confirming Delete removes selected template.
Canceling Delete keeps selected template.
Deleting selected template does not affect current page boxes.
Backspace behaves same as Delete for selected template.
Delete in search input edits text and does not delete template.
Delete on crop canvas still deletes selected crop boxes.
Focus decides whether Delete affects template or crop boxes.
Right-click template selects it.
Right-click menu has Apply Template, Rename Template, Duplicate Template, Delete Template.
Right-click Apply applies template.
Right-click Delete asks confirmation.
Search filtering preserves compact layout.
Template pane remains scrollable.
Fit Page/editor layout is not broken by template browser changes.
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If any script does not exist, document that clearly and do not invent success.

## 22. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document the updated Template Browser behavior:

```text
Template Browser now works like a document/page navigator.
Templates are shown in a compact scrollable list.
Single-click selects a template.
Double-click applies a template immediately.
Delete/Backspace deletes the selected template only after confirmation.
Right-click opens template actions.
The Delete key affects templates only when the template pane is focused.
The Delete key still deletes crop boxes when the crop canvas is focused.
```

Add example:

```text
Example: apply a template quickly

1. Open the Templates pane.
2. Double-click the desired template.
3. The template is applied to the current page immediately.
4. All applied boxes are selected automatically.
5. Drag or use arrow keys to align the layout.
```

Add example:

```text
Example: delete a saved template

1. Single-click the template to select it.
2. Press Delete.
3. Confirm “Delete Template”.
4. The template is removed permanently.
5. The current page layout is not changed.
```

## 23. Security Rules

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
* Only use the existing safe template IPC/service for template actions.

## 24. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 25. Acceptance Criteria

This chunk is complete when:

* Template Browser uses a compact document-navigator layout.
* Large gaps between templates are removed.
* Template thumbnails are small and page-like.
* Template pane is vertically scrollable.
* Single-click selects a template.
* Single-click does not apply a template.
* Selected template is visibly highlighted.
* Double-click applies template immediately with no confirmation.
* Double-click apply preserves existing template apply behavior.
* All applied boxes are selected after double-click apply.
* Delete/Backspace on selected template asks for deletion confirmation.
* Confirmed deletion removes the template permanently.
* Canceled deletion leaves the template unchanged.
* Deleting a template does not affect current page boxes.
* Right-click template context menu exists.
* Right-click menu includes Apply, Rename, Duplicate, Delete.
* Focus priority prevents Delete key conflicts between templates and crop boxes.
* Delete/Backspace in search/input fields behaves normally.
* Template Browser remains compatible with compact UI and Fit Page layout.
* Documentation is updated.
* TypeScript compiles.
* App still starts.

## 26. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How the Template Browser layout changed.
* How single-click selection works.
* How double-click apply works.
* How Delete/Backspace template deletion works.
* How focus priority avoids conflict with crop-box deletion.
* How right-click template menu works.
* How template thumbnails were made more compact.
* How to test the feature.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.