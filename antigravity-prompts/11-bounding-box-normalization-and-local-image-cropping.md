# Antigravity Prompt Chunk 11: Bounding Box Normalization and Local Image Cropping

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 11. Prompt Chunks 01 to 10 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, validated import form, local PDF preprocessing, shared OCR schemas/fixtures/validation, Mistral OCR integration, controlled OCR pipeline, and strengthened non-product promotional/banner filtering.

## 1. Read These Files First

Before coding, read all files inside:

```text
project-knowledge/
```

Specifically read:

```text
project-knowledge/00-prd-wifran-offers-extractor.md
project-knowledge/01-product-brief-and-scope.md
project-knowledge/02-wifran-db-schema-and-sync-rules.md
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/06-env-security-and-credentials.md
project-knowledge/07-sample-extraction-json.md
project-knowledge/08-antigravity-development-plan.md
```

Treat these files as the source of truth.

## 2. Goal of This Prompt Chunk

Implement local item image cropping using OCR bounding boxes.

This chunk should take OCR pipeline normalized rows and rendered page images, then:

```text
normalize bounding boxes
validate bounding boxes against rendered page dimensions
apply safe padding
clamp crop areas to page boundaries
crop one local image per valid product offer row
skip image cropping for non-product promotional/banner rows
save cropped item images locally
attach crop metadata to normalized rows
show crop results in the UI
```

This chunk must run fully locally.

Do **not** upload cropped images to Supabase Storage yet.

Do **not** create `offer_sources` yet.

Do **not** create `import_batches` yet.

Do **not** insert `import_rows` yet.

Do **not** insert `offers` yet.

Do **not** implement brand/category/product matching yet.

Do **not** add database migrations.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/imageCropping.ts
src/shared/utils/boundingBoxNormalization.ts
src/main/image/imageCropTypes.ts
src/main/image/boundingBoxValidator.ts
src/main/image/itemImageCropper.ts
src/main/image/imageCroppingService.ts
src/main/ipc/imageCroppingIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useImageCropping.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve the same responsibilities.

## 4. Required Package

Use local image processing only.

Recommended package:

```text
sharp
```

If `sharp` is already installed, reuse it.

Do not use cloud image processing APIs.

Do not use OCR APIs in this chunk.

## 5. Main Process Only

All image cropping and local file writing must happen in the Electron main process.

The renderer must not get generic filesystem access.

The renderer may trigger cropping through a narrow IPC method.

Do not expose generic APIs such as:

```text
fs:readFile
fs:writeFile
image:cropAnyPath
image:processRaw
```

Use a specific cropping IPC method that accepts validated OCR pipeline output and rendered page metadata.

## 6. Shared Cropping Types

Create:

```text
src/shared/types/imageCropping.ts
```

Add renderer-safe types.

Recommended:

```ts
export type CropBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CropRenderedPage = {
  pageNumber: number;
  imagePath: string;
  width: number;
  height: number;
  dpi: number;
};

export type CropInputRow = {
  rowId: string;
  pageNumber: number;
  status: 'valid' | 'warning' | 'error' | 'skipped';
  skipReason?: string | null;
  productNameAr?: string | null;
  productNameEn?: string | null;
  offerPrice?: number | null;
  boundingBox: CropBoundingBox | null;
};

export type CropRowResultStatus =
  | 'cropped'
  | 'skipped'
  | 'warning'
  | 'error';

export type CropRowIssue = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
};

export type CropRowResult = {
  rowId: string;
  pageNumber: number;
  status: CropRowResultStatus;
  localImagePath: string | null;
  originalBoundingBox: CropBoundingBox | null;
  normalizedBoundingBox: CropBoundingBox | null;
  paddedBoundingBox: CropBoundingBox | null;
  issues: CropRowIssue[];
};

export type ImageCroppingInput = {
  workspacePath: string;
  renderedPages: CropRenderedPage[];
  rows: CropInputRow[];
  paddingPercent: number;
  outputFormat: 'jpg' | 'png' | 'webp';
  outputQuality: number;
};

export type ImageCroppingProgressStage =
  | 'started'
  | 'row_skipped'
  | 'row_cropping'
  | 'row_cropped'
  | 'row_failed'
  | 'completed'
  | 'failed';

export type ImageCroppingProgressEvent = {
  stage: ImageCroppingProgressStage;
  message: string;
  rowId?: string;
  current?: number;
  total?: number;
  details?: Record<string, unknown>;
};

export type ImageCroppingResult = {
  ok: boolean;
  workspacePath: string;
  totalRows: number;
  croppedRows: number;
  skippedRows: number;
  warningRows: number;
  errorRows: number;
  results: CropRowResult[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error?: {
    code: string;
    message: string;
  };
};
```

Do not include secrets.

## 7. Bounding Box Normalization Utility

Create:

```text
src/shared/utils/boundingBoxNormalization.ts
```

Implement utilities for normalizing supported bounding-box shapes.

The final normalized shape must be:

```ts
{
  x: number;
  y: number;
  width: number;
  height: number;
}
```

Support these input forms where practical:

### Already normalized pixel box

```json
{
  "x": 120,
  "y": 450,
  "width": 300,
  "height": 300
}
```

### Top-left and bottom-right

```json
{
  "top_left_x": 120,
  "top_left_y": 450,
  "bottom_right_x": 420,
  "bottom_right_y": 750
}
```

### Alternative camelCase

```json
{
  "topLeftX": 120,
  "topLeftY": 450,
  "bottomRightX": 420,
  "bottomRightY": 750
}
```

### Polygon

```json
{
  "polygon": [
    { "x": 120, "y": 450 },
    { "x": 420, "y": 450 },
    { "x": 420, "y": 750 },
    { "x": 120, "y": 750 }
  ]
}
```

### Normalized 0-to-1 coordinates

If the values are between `0` and `1`, convert them to pixels using page dimensions.

Example:

```text
x_px = x * page_width
y_px = y * page_height
width_px = width * page_width
height_px = height * page_height
```

Recommended functions:

```ts
export function normalizeBoundingBox(
  input: unknown,
  pageWidth: number,
  pageHeight: number
): CropBoundingBox | null;

export function isLikelyNormalizedBox(box: CropBoundingBox): boolean;
```

## 8. Bounding Box Validation

Create:

```text
src/main/image/boundingBoxValidator.ts
```

Implement validation against rendered page dimensions.

A valid final crop box must satisfy:

```text
x >= 0
y >= 0
width > 0
height > 0
x + width <= page_width
y + height <= page_height
```

If a box is slightly out of bounds, clamp it and add issue:

```text
BOUNDING_BOX_CLAMPED
```

If a box is impossible, too small, or too large, add issues.

Use these codes:

```text
MISSING_BOUNDING_BOX
INVALID_BOUNDING_BOX
BOUNDING_BOX_TOO_SMALL
BOUNDING_BOX_TOO_LARGE
BOUNDING_BOX_OUT_OF_PAGE
BOUNDING_BOX_CLAMPED
```

Recommended thresholds:

```text
width < 40 px OR height < 40 px -> BOUNDING_BOX_TOO_SMALL
box_area > 70% of page_area -> BOUNDING_BOX_TOO_LARGE
```

A very large bounding box should usually be a warning, not an automatic fatal error, unless it cannot be cropped safely.

## 9. Padding Rules

Before cropping, add safe padding.

Use config value:

```text
IMAGE_CROP_PADDING_PERCENT
```

Default:

```text
8
```

Allowed practical range:

```text
0 to 15
```

Formula:

```text
pad_x = width * (paddingPercent / 100)
pad_y = height * (paddingPercent / 100)
```

After padding, clamp to page boundaries.

Do not allow padding to create negative coordinates.

Do not allow padding to exceed page image dimensions.

## 10. Cropping Rules

Create:

```text
src/main/image/itemImageCropper.ts
```

Use `sharp` to crop.

Recommended function:

```ts
export async function cropItemImage(input: {
  pageImagePath: string;
  outputPath: string;
  cropBox: CropBoundingBox;
  outputFormat: 'jpg' | 'png' | 'webp';
  outputQuality: number;
}): Promise<void>;
```

Rules:

* Use integer pixel coordinates.
* Round `x`, `y`, `width`, and `height` safely.
* Ensure output directory exists.
* Use `.jpg` for default output.
* Default quality: `85`.
* Do not crop if width or height is invalid.
* Do not overwrite existing crop unless intentional and deterministic.
* Do not crop promotional/banner skipped rows.

## 11. Cropping Service

Create:

```text
src/main/image/imageCroppingService.ts
```

Implement:

```ts
export async function cropImagesForOcrRows(
  input: ImageCroppingInput,
  onProgress?: (event: ImageCroppingProgressEvent) => void
): Promise<ImageCroppingResult>;
```

Responsibilities:

1. Validate workspace path.
2. Create crops directory:

```text
{workspacePath}/crops/
```

3. Build map of rendered pages by `pageNumber`.
4. Iterate rows.
5. Skip rows with `status = skipped`.
6. Skip rows with `skipReason = NON_PRODUCT_PROMOTIONAL_AREA`.
7. Skip or warn rows with `status = error`.
8. Validate page exists.
9. Normalize bounding box.
10. Validate bounding box.
11. Apply padding.
12. Crop image locally.
13. Return row-level crop result.
14. Emit progress events.
15. Continue if one row fails.

Recommended output path:

```text
{workspacePath}/crops/page-{pageNumber}-item-{safeRowId}.jpg
```

Use safe row IDs for filenames.

Example:

```text
page-001-item-page-1-item-3.jpg
```

## 12. Handling Row Statuses

### `valid`

Attempt cropping if bounding box exists.

If crop succeeds:

```text
status = cropped
```

If crop fails:

```text
status = error
issue = IMAGE_CROP_FAILED
```

### `warning`

Attempt cropping if bounding box exists.

If crop succeeds:

```text
status = cropped
```

If bounding box missing:

```text
status = warning
issue = MISSING_BOUNDING_BOX
```

### `error`

Do not crop by default.

Return:

```text
status = skipped
issue = Row has blocking validation errors and was not cropped.
```

### `skipped`

Do not crop.

If skipped because promotional/banner:

```text
status = skipped
issue = NON_PRODUCT_PROMOTIONAL_AREA
```

## 13. Required Image Error Codes

Use these codes:

```text
MISSING_BOUNDING_BOX
INVALID_BOUNDING_BOX
BOUNDING_BOX_TOO_SMALL
BOUNDING_BOX_TOO_LARGE
BOUNDING_BOX_OUT_OF_PAGE
BOUNDING_BOX_CLAMPED
PAGE_IMAGE_NOT_FOUND
IMAGE_CROP_FAILED
NON_PRODUCT_PROMOTIONAL_AREA
```

Add them to the validation code catalog if missing.

## 14. IPC Requirements

Create:

```text
src/main/ipc/imageCroppingIpc.ts
```

Add narrow IPC handler:

```text
image:cropOcrRows
```

Input:

```ts
ImageCroppingInput
```

Output:

```ts
ImageCroppingResult
```

Progress event channel:

```text
image:crop-progress
```

Renderer should subscribe through preload.

Do not expose generic image or file APIs.

Forbidden handlers:

```text
image:cropAnyPath
fs:writeFile
fs:readFile
```

Update:

```text
src/main/ipc/registerIpcHandlers.ts
```

to register the image cropping IPC handler.

## 15. Preload API Requirements

Update preload to expose:

```ts
window.wifranExtractor.image = {
  cropOcrRows: (
    input: ImageCroppingInput
  ) => Promise<ImageCroppingResult>,

  onCropProgress: (
    callback: (event: ImageCroppingProgressEvent) => void
  ) => () => void
};
```

Do not expose raw `ipcRenderer`.

Do not expose generic filesystem APIs.

## 16. Renderer Hook

Create:

```text
src/renderer/hooks/useImageCropping.ts
```

Responsibilities:

* Start image cropping from OCR pipeline rows.
* Track running state.
* Track progress events.
* Store result.
* Store error.
* Provide reset function.

Recommended return shape:

```ts
{
  running: boolean;
  progressEvents: ImageCroppingProgressEvent[];
  latestProgress: ImageCroppingProgressEvent | null;
  result: ImageCroppingResult | null;
  error: string | null;
  cropRows: (input: ImageCroppingInput) => Promise<void>;
  reset: () => void;
}
```

## 17. Convert OCR Rows to Crop Rows

In renderer or shared helper, convert normalized OCR rows into `CropInputRow`.

Required mapping:

```text
rowId <- normalizedRow.source.row_id
pageNumber <- normalizedRow.source.page_number
status <- normalizedRow.status
skipReason <- normalizedRow.skip_reason
productNameAr <- normalizedRow.offer.title_ar if offer exists
productNameEn <- normalizedRow.offer.title_en if offer exists
offerPrice <- normalizedRow.offer.offer_price if offer exists
boundingBox <- normalizedRow.bounding_box
```

If `offer = null`, use original product names from `normalizedRow.original` where useful for display, but do not crop if status is skipped/error.

## 18. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

After OCR pipeline completes, add a section:

```text
Crop Item Images
```

This section should show:

```text
Total OCR rows
Rows eligible for cropping
Rows skipped
Rows with missing bounding boxes
Configured padding percent
Output format
Output quality
```

Add button:

```text
Crop Item Images Locally
```

Enable only when:

```text
OCR pipeline result exists
rendered pages exist
workspace path exists
not currently cropping
```

When clicked:

* Build `ImageCroppingInput`.
* Call `window.wifranExtractor.image.cropOcrRows`.
* Show progress.
* Show result summary.

Do not upload images yet.

## 19. Results Page Integration

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Show crop results if available.

Add columns or details:

```text
Crop Status
Local Image Path
Crop Issues
```

If possible, show a local image preview only if the current Electron security setup can safely display local files.

If displaying local files is non-trivial, do not force image preview yet. Instead show local path and status.

Do not expose generic file access to renderer just for previews.

## 20. Logs Page Integration

Update Logs page to show crop progress messages.

Examples:

```text
Starting image cropping for 120 rows.
Skipping page-1-banner-1 because it is non-product promotional content.
Cropping page-2-item-4.
Cropped page-2-item-4 successfully.
Image cropping completed: 110 cropped, 8 skipped, 2 errors.
```

Do not log secrets.

## 21. Metadata Output

Write a crop metadata file if debug/intermediate files are enabled.

Recommended path:

```text
{workspacePath}/metadata/image-cropping-result.json
```

Include:

```text
startedAt
completedAt
durationMs
totalRows
croppedRows
skippedRows
warningRows
errorRows
results
```

Do not include secrets.

## 22. Error Handling Requirements

Handle:

```text
workspace path missing
crops directory creation failure
rendered page missing
page image file missing
missing bounding box
invalid bounding box
box outside page
box too small
box too large
sharp crop failure
output write failure
promotional/banner row skipped
```

One row failure must not stop all cropping.

The result should include row-level errors.

## 23. README Update

Update README with:

* Local item image cropping added.
* Cropping uses OCR bounding boxes.
* Cropping runs locally.
* Cropped images are saved under workspace `crops/`.
* Supabase Storage upload is not implemented yet.
* Missing/invalid bounding boxes become warnings/errors.
* Promotional/banner rows are skipped and not cropped.

## 24. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` to renderer.
* Do not expose generic IPC.
* Do not expose generic filesystem APIs.
* Do not upload files to Supabase Storage.
* Do not add Supabase writes.
* Do not create import batches.
* Do not create offer sources.
* Do not insert import rows.
* Do not insert offers.
* Do not create products, brands, or categories.
* Do not add database migrations.
* Do not crop images for banners, logos, date badges, or campaign slogans.
* Do not treat local crop success as final offer import.

## 25. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 26. Acceptance Criteria

This chunk is complete when:

* Bounding box normalization utility exists.
* Bounding box validation exists.
* Padding and clamping are implemented.
* Local item image cropper exists using `sharp` or equivalent.
* Image cropping service processes OCR rows.
* Skipped promotional/banner rows are not cropped.
* Error rows are not cropped by default.
* Missing bounding boxes produce warnings.
* Invalid bounding boxes produce row-level errors.
* Cropped images are saved locally under workspace `crops/`.
* Crop metadata is saved when debug/intermediate files are enabled.
* Renderer can start cropping through safe preload API.
* Renderer receives crop progress events.
* Import page shows crop summary.
* Results page shows crop status/path/issues.
* No Supabase upload or offer sync is implemented.
* TypeScript compiles.
* App still starts.

## 27. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How bounding boxes are normalized.
* How padding and clamping work.
* How local image cropping works.
* Where cropped images are saved.
* How promotional/banner rows are skipped.
* How crop results appear in the UI.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.