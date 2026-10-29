# Troubleshooting Guide

## Manual Crop Issues

**Problem**: Manual crop output says 0 boxes cropped.
**Fix**: You must ensure the boxes are marked as "Included". Excluded or deleted boxes are not cropped. Select the boxes and click "Include".

**Problem**: "Generate Grid From This Box" shows an unexpected number of Rows or Columns.
**Fix**: The app auto-calculates the default Rows and Columns based on the selected box's dimensions and the available page space. Leftover margins smaller than one full box are ignored. If the calculated defaults are wrong, you can simply type in the correct numbers manually before clicking Apply. Note that "Generate Row" and "Generate Column" behave differently; they use the current layout's row/column box counts as their defaults.

**Problem**: The manual crop item count and the OCR item count differ on the Results page.
**Fix**: This means you cropped (for example) 14 images, but the AI found 15 text items. Review the AI's output in the JSON to see if it hallucinated an item, or if you missed a box in the Manual Crop Editor. You can add a box or merge boxes to match.

**Problem**: "Proceed to Crop + OCR" button shows layout validation errors.
**Fix**: Ensure all rendered pages have saved crop layouts with at least one included box. Open the Manual Crop Editor, save layouts for each page, and renumber boxes.

**Problem**: The page appears too small or too large in the Manual Crop Editor.
**Fix**: The editor defaults to "Fit Page" mode to show the entire page. If it looks too small, you can hide the Right Side Panel using the "Hide Panel" toolbar button to give the canvas more space, or simply click the "Zoom In" button (+) to switch to manual zoom. If the page appears too large and you have to scroll vertically, click the "Fit Page" button (⛶) in the top left of the toolbar to recalculate the fit.

**Problem**: OCR is very slow during Crop + OCR.
**Fix**: This is by design. Each item image is OCR'd with at least 1.1 seconds delay between calls to stay within free-tier limits. A 38-item leaflet will take ~42 seconds of OCR time plus crop generation time.

**Problem**: Some items show "OCR Failed" in the review summary.
**Fix**: Check the error details by clicking the item row. Common causes: Mistral rate limit exhaustion, image too small, or network errors. The local crop image is preserved — you can inspect it at the shown file path. Failed items are automatically excluded from DB sync.

**Problem**: The "Proceed to Update DB" button is disabled.
**Fix**: Ensure you have at least one successfully OCR'd item, a supermarket and location selected, and valid Supabase credentials configured.

This guide helps you resolve common errors encountered while using the Offers Extractor.

---

## 1. Configuration & Startup

### Settings page shows config errors
- **What it means**: The app cannot read your `.env.local` file or keys are empty.
- **Likely cause**: The file is named `env.local.txt` instead of `.env.local`, or it's in the wrong folder.
- **Safe next step**: Ensure `.env.local` is next to the `.exe` file. Restart the app.

### Reference Data missing
- **What it means**: Supermarkets or cities are empty dropdowns.
- **Likely cause**: Your Supabase URL or Service Role Key is incorrect.
- **Safe next step**: Check your `.env.local` for extra spaces around `SUPABASE_SERVICE_ROLE_KEY`.

---

## 2. PDF Processing

### PDF cannot be opened
- **What it means**: The app rejects the file before preprocessing.
- **Likely cause**: The file is password protected, corrupt, or not a PDF.
- **Safe next step**: Open the PDF in Chrome or Edge to verify it's readable.

## 3. Preprocessing and Rendering Errors

### "Page X Failed to Render" in Manual Crop Editor
**Symptoms**: A page shows "Failed to Render" inside the manual crop editor while background rendering.
**Causes**: The PDF page is corrupt or Ghostscript/GraphicsMagick timed out.
**Resolution**:
- If it's a blank or unimportant page, you can skip it by not marking it complete and forcing the pipeline (not recommended), or recreate the PDF.
- If it's a critical page, cancel the run and retry.

### "Validation failed: Unable to read PDF"
**Symptoms**: Preprocessing fails immediately.
- **What it means**: Ghostscript/Sharp failed to rasterize the PDF.
- **Likely cause**: The PDF has zero pages or extremely complex vectorized graphics.
- **Safe next step**: Flatten the PDF (Print to PDF) and try again.

---

## 3. OCR & Extraction

### OCR Extracts Zero Rows
- **What it means**: Mistral could not find any products.
- **Likely cause**: The leaflet might just be promotional covers, or the text is illegible.
- **Safe next step**: Verify the leaflet pages visually. 

### OCR Timeout or Rate Limit (HTTP 429)
- **What it means**: You sent too many pages to Mistral too quickly.
- **Likely cause**: You exceeded the Mistral Free-Tier limits (50k tokens per minute / 1 request per second).
- **Safe next step**: Ensure `OCR_RATE_LIMIT_MODE='free_tier_safe'` is set in your `.env.local` file. This automatically limits concurrency to 1 and enforces token budgeting to respect the 50k TPM limit. The app will automatically wait and retry if it receives a 429 response.

---

## 4. Promotional Filtering

### A real product was skipped
- **What it means**: A row was incorrectly flagged as a banner.
- **Likely cause**: The product lacked a price and had generic text like "Mega Offer".
- **Safe next step**: For now, this requires manual extraction via the Wifran web admin.

### Large Leaflet Is Slow
The app uses safe default limits (`OCR_CHUNK_SIZE=1`, `OCR_MAX_CONCURRENT_REQUESTS=1`) designed for dense 100+ page leaflets. 
- Try `OCR_MAX_CONCURRENT_REQUESTS=2` only after confirming no rate-limit errors.
- Do not increase `OCR_CHUNK_SIZE` unless accuracy has been verified on smaller test pages.

## Rate Limit Errors & Free-Tier Mode
If you are using Mistral's Free Tier, rate limit errors (HTTP 429) can occur. To avoid this:
- Set `OCR_RATE_LIMIT_MODE='free_tier_safe'` in `.env.local`. This mode restricts concurrency to 1 and manages token budgets automatically.
- Keep `OCR_CHUNK_SIZE=1`.
- Keep `OCR_MAX_RETRIES=5`.
- The app will automatically respect `Retry-After` headers and pause the pipeline visually when limits are hit. You will see an amber "Waiting..." progress bar.

## Timeouts on Dense Pages
If chunks take longer than 3 minutes:
- `OCR_REQUEST_TIMEOUT_MS` defaults to 180000 (3 minutes). For very massive pages, you can raise this up to `300000` (5 minutes) in `.env.local`.

## Some Pages Return Zero Items
If some pages are missing items:
- Use `OCR_CHUNK_SIZE=1`.
- Use `PDF_RENDER_DPI=250` or `300`.
- Keep full-page OCR.
- Do not pre-crop product cards before OCR.

## One Chunk Failed But the Rest Completed
The app will return a "Partially Completed" status and display a list of failed chunks.
**New Feature:** You can now click the **"Retry Only Failed OCR Chunks"** button directly in the UI. 
- The app will securely retry only the missing pages.
- It will merge the recovered rows into your pipeline without duplicating the successful ones.
- **Important:** If you have already run downstream stages (Cropping, Match Entities), the retry button will be disabled to prevent data corruption. Reload the page to clear downstream stages if you need to retry OCR chunks first.

## How to Rerun With Safer Settings
1. Open `.env.local`.
2. Ensure `OCR_RATE_LIMIT_MODE='free_tier_safe'`, `OCR_CHUNK_SIZE=1`, and `OCR_MAX_CONCURRENT_REQUESTS=1`.
3. Save the file and restart the Wifran app.
4. Try extracting the PDF again.

### A banner was extracted as a product
- **What it means**: The system thought "Happy New Year!" was a product.
- **Likely cause**: The banner had a price-like number or was structured like a product.
- **Safe next step**: If published, simply delete or deactivate it in the Wifran web admin later.

---

## 5. Syncing to Database

### Image upload failed
- **What it means**: The cropped item picture could not be saved.
- **Likely cause**: `SUPABASE_STORAGE_BUCKET` is incorrect, or internet dropped.
- **Safe next step**: Ensure the bucket `offers-images` exists in your Supabase project.

### Offer Insert Failed
- **What it means**: Row data was rejected by the database.
- **Likely cause**: A data mismatch (e.g. text too long, price negative).
- **Safe next step**: Check the Logs page for the exact error message. The row will just be skipped; other valid rows will still save.
