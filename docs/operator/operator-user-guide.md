# Operator User Guide

## Complete Workflow (Chunk 29 – Pre-DB Review)

Follow these steps for every leaflet you process:

1. **Open the app** and go to the **Settings** page to ensure your configurations are green and ready.
2. **Go to Import**: Click "New Import" on the sidebar.
3. **Select PDF**: Choose the downloaded PDF leaflet from your computer.
4. **Select Supermarket**: Choose the supermarket this leaflet belongs to.
5. **Select Location**: Pick the specific city/region (or "All locations").
6. **Set Dates**: Pick the valid From and valid To dates for the offers.

### Document Preprocess
1. Ensure all settings and configurations are valid.
2. Click **Step 1: Document Preprocess**.
3. **Progressive Rendering:** The app will validate and begin streaming page renders.
4. As soon as **Page 1** finishes rendering, the **Manual Crop Editor** will automatically open.
5. The remaining pages will continue rendering in the background while you work on Page 1.

### Step 1: Manual Grid Crop
1. As each page finishes rendering, you can adjust the layout.
2. Click the **✓ Mark Page Complete** button when you are satisfied with a page.
3. Click **Next Page** to move on. If the next page is still rendering in the background, you'll see a wait state.
4. Continue until all pages have saved, complete layouts.

### Step 2: Crop + OCR Items
1. After marking all pages complete, and ensuring the background render is finished, close the editor.
2. Click **Proceed to Crop + OCR**.: The app validates all layouts, then:
    - Generates local item crop images (e.g. `manual-crops/page-001/page-001-item-001.webp`).
    - OCRs each generated item image with at least 1.1s delay between calls.
    - Writes local raw JSON files next to the crop images in `workspace/manual-crops/` (e.g. `page-001-item-001.json`). These JSON files preserve the exact keys returned by the Mistral OCR API without canonicalization.
    - Updates `workspace/ocr_returned_keys.json` with keys that have useful values, along with their first seen values.
    - Updates `workspace/ocr_keys_without_values.json` with keys that appeared but only had empty or null values.
3. **Review Summary**: After crop and OCR complete, a review summary appears showing:
    - Total pages, crop images, OCR completed, OCR failed.
    - Path to the Returned Keys and Keys Without Values registries.
    - Full item table with names, prices, sizes, and a list of any other returned keys.
    - Optional inline editing for corrections.
4. **Click Proceed to Update DB**: Only after reviewing. The app uploads images and writes offers to Wifran.
5. **Wifran Admin**: Check your Wifran web admin for items that need manual review.

**Note**: The raw JSON extraction focuses on exact-key discovery. A future step outside of this pipeline will involve passing `ocr_returned_keys.json` to an LLM to group aliases and canonicalize fields. No classification is performed at this stage.

**Important**: No database writes occur before you click "Proceed to Update DB".

## Manual Crop Layout Editor
1. After Preprocessing, set your starting grid (e.g., 4 rows, 4 columns).
2. Click **Open Manual Crop Editor**.
3. **Fit-Page View**: The editor automatically opens with the full page centered on your screen, calculated to fit the available window space.
4. Use the compact toolbar to access Zoom controls (Fit Page, Fit Width), Undo/Redo, and Add Box.
5. Use the **Right Side Panel** to access either your saved **Templates** or the list of **Items** on the current page. You can hide the panel using the toolbar button to maximize canvas space.
6. Adjust borders and resize individual crop boxes.
7. Merge, split, or add boxes if items are missed.
8. Delete/Exclude any logos, headers, or empty spaces:
   - Select one or more boxes and press **Delete** or **Backspace**.
   - Or right-click a box and choose **Delete Box**.
9. **Context Menu Actions**: Right-click any box to see box-specific actions like **Generate Grid From This Box**, **Merge**, **Split**, or **Duplicate**.
10. **Page Actions**: Click the `⋯` Page Actions menu in the top right to access **Renumber Boxes**, **Save Layout**, or **Generate Crops**.
11. Click **✓ Mark Page Complete** to save layout for each page.
12. Click **Next Page** (or **Prev Page**). 
   - *The app will automatically save the layout and carry over your latest layout structure to the next page!*
   - *The app will also immediately start generating crop images for the page you just left in the background!* You can continue editing the next page without waiting.

### Template Grid Generation
To speed up manual crop adjustment, you can generate an entire grid, row, or column from a single correctly fitted box.

**Example 1: Generating a 3x3 section from a bottom-left box**
1. Adjust one crop box so it perfectly fits an item.
2. Right-click the box.
3. Click **Generate Grid From This Box...**
4. The Rows and Columns fields will automatically calculate how many same-size boxes can fit around your selected box, based on its size and position on the page. (Leftover margins smaller than a full box are ignored).
5. You can still manually change Rows and Columns if needed.
6. Click **Apply**.
7. The app keeps the selected box, removes other page boxes, and creates a same-size grid around it.
7. If the selected box is near the bottom-left corner, the app automatically grows the grid upward and to the right.
8. Press `Ctrl/Cmd+Z` to undo if the result is wrong.

**Example 2: Generating the large right-side column**
1. Adjust one large right-column crop box.
2. Right-click it.
3. Click **Generate Column From This Box...**
4. The Rows field defaults to the current number of boxes in that column. Change Rows if needed.
5. Click **Apply**.
6. The app replaces only that column with same-size stacked boxes and keeps the rest of the page unchanged.

### Template Browser (Document Navigator)
The Template Browser works like a PDF document thumbnail navigator, allowing you to rapidly scan and manage your saved layout templates.

- **Select Template:** Single-click any template row to select it. The row will be highlighted.
- **Apply Template:** Double-click a template to instantly apply it to the current page.
- **Context Menu:** Right-click a template to Rename, Duplicate, Delete, or Apply.
- **Keyboard Shortcut:** With a template selected and the Template pane focused, press `Delete` or `Backspace` to permanently delete the template (after confirmation).

**Example: apply a template quickly**
1. Open the Templates pane.
2. Double-click the desired template.
3. The template is applied to the current page immediately.
4. All applied boxes are selected automatically.
5. Drag or use arrow keys to align the layout.

**Example: delete a saved template**
1. Single-click the template to select it.
2. Press `Delete`.
3. Confirm "Delete Template".
4. The template is removed permanently.
5. The current page layout is not changed.

### Background Cropping & Next-Page Layout Carryover
When you click **Next Page** or **Prev Page**:
1. The app saves the current page layout.
2. **Background Cropping:** It immediately starts generating crop images for the current page in the background (saved to `workspace/manual-crops/page-PPP/`).
   - If you later return and edit the layout (e.g. deleting a box), the crops are marked **stale**.
   - When you leave the page again, the app will safely clear the old files and regenerate the fresh crops.
3. **Carryover:** It remembers the current page layout as the latest template.
4. If the target page is already rendered and has no saved layout, it creates one by copying the latest structure (scaling dimensions if the target page size differs).
5. If the target page is still rendering, it will wait and apply the template when it becomes ready.
6. **Protection**: If the target page *already* has a saved layout, it will load the saved layout and will **not** overwrite it.

### Proceed to Crop + OCR
Because cropping now happens in the background while you navigate pages, clicking **Proceed to Crop + OCR** is much faster!
The app will verify that all pages have fresh crops. It will only regenerate crops for pages that were marked **stale** or are missing images. Then, it proceeds directly to OCR using the fresh local files.

## Understanding Row Statuses

- **`valid`**: Clean extraction, ready for processing.
- **`warning`**: Extraction succeeded, but something is suspicious.
- **`error`**: Fatal extraction flaw. This row **will not** be converted to an offer.
- **`skipped`**: Filtered out because it is a promotional banner or non-product element.
- **`duplicate`**: The exact same product is already drafted for this supermarket.
- **`prepared`**: The Wifran payload is ready for upload.
- **`imported` / `published` / `needs_review_imported`**: Successfully synced to the database!

## Safeguards
- **No premature DB writes**: The app never writes to the database before the operator clicks "Proceed to Update DB".
- **Direct Publishing**: By default, fully valid rows sync as `published` and can become live immediately. Use `needs_review` fallback in `.env.local` for safer testing.
- **Strict Validation Gates**: Rows with blocking errors are **never** published.
- **Duplicate Prevention**: Duplicate rows in the same PDF are skipped by default.
- **OCR failures visible**: Failed OCR items appear in the review table but are skipped from DB sync.
- **Crop failures visible**: Failed crops are shown in the review but not sent to OCR.
 
 