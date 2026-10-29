# Antigravity Prompt Chunk 05: Import Form, PDF Selector, and Metadata Validation

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 05. Prompt Chunks 01 to 04 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, and Supabase read-only reference data loading.

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

Implement the operator’s main import form, including:

```text
PDF file selection
selected file validation
supermarket selection validation
city/region selection validation
offer start date
offer end date
default date behavior
pre-import metadata validation
safe form state
clear UI feedback
```

This chunk should prepare the app for later PDF processing, but it should **not** split, render, OCR, crop, upload, or sync anything yet.

Do **not** implement OCR yet.

Do **not** implement PDF splitting/rendering yet.

Do **not** implement image cropping yet.

Do **not** create `offer_sources` yet.

Do **not** create `import_batches` yet.

Do **not** insert `import_rows` yet.

Do **not** insert `offers` yet.

Do **not** upload files to Supabase Storage yet.

Do **not** add database migrations.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/main/ipc/fileDialogIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/importForm.ts
src/shared/types/preload.ts
src/renderer/hooks/useImportForm.ts
src/renderer/pages/ImportPage.tsx
src/renderer/components/FormField.tsx
src/renderer/components/ValidationSummary.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve the same responsibilities.

## 4. File Dialog IPC Requirements

Create a narrow main-process IPC handler for selecting a PDF file.

Recommended handler:

```text
file:selectPdf
```

The handler should:

* Open the native Electron file dialog.
* Allow only PDF files.
* Return safe file metadata to the renderer.
* Not expose generic filesystem access.
* Not allow arbitrary file reads from renderer.
* Not return file contents.
* Not process the PDF yet.

Recommended return type:

```ts
export type SelectedPdfFile = {
  path: string;
  name: string;
  sizeBytes: number;
  extension: string;
};
```

Important:

The selected file path is needed later by the main process for processing. It is acceptable for the renderer to hold the selected path returned by the trusted file dialog, but the renderer must not be given a generic “read any path” API.

## 5. Forbidden IPC Methods

Do not create generic filesystem IPC methods such as:

```text
fs:readFile
fs:writeFile
fs:listDirectory
file:openAny
file:readRaw
```

Only create the narrow PDF selection method.

## 6. Preload API Update

Update preload to expose a safe file API:

```ts
window.wifranExtractor.files = {
  selectPdf: () => Promise<SelectedPdfFile | null>
};
```

Keep existing safe APIs:

```ts
window.wifranExtractor.app
window.wifranExtractor.config
window.wifranExtractor.reference
```

Do not expose `ipcRenderer`.

Do not expose Node filesystem APIs.

Do not expose secrets.

Update global declarations accordingly.

## 7. Shared Import Form Types

Create:

```text
src/shared/types/importForm.ts
```

Add types similar to:

```ts
export type SelectedPdfFile = {
  path: string;
  name: string;
  sizeBytes: number;
  extension: string;
};

export type SelectedImportLocation = {
  cityId: string | null;
  regionId: string | null;
  label: string;
};

export type ImportFormState = {
  pdfFile: SelectedPdfFile | null;
  supermarketId: string | null;
  location: SelectedImportLocation | null;
  offerStartDate: string;
  offerEndDate: string;
};

export type ImportFormValidationError = {
  field:
    | 'pdfFile'
    | 'supermarketId'
    | 'location'
    | 'offerStartDate'
    | 'offerEndDate'
    | 'form';
  code: string;
  message: string;
};

export type ImportFormValidationResult = {
  ok: boolean;
  errors: ImportFormValidationError[];
};
```

Use `YYYY-MM-DD` strings for dates in the renderer.

## 8. Default Date Behavior

The import form should default to:

```text
offerStartDate = today
offerEndDate = today + DEFAULT_OFFER_DURATION_DAYS
```

The default duration should come from the safe config status if available.

If config status is not available, use:

```text
7 days
```

Date rules:

* Use local date.
* Format as `YYYY-MM-DD`.
* End date must be the same as or after start date.
* Dates must be required.

## 9. Metadata Validation Rules

Implement form validation in renderer/shared code.

Required fields:

```text
PDF file
supermarket_id
city_id OR region_id
offer_start_date
offer_end_date
```

Validation rules:

```text
PDF file must be selected.
PDF extension must be .pdf.
PDF size must be greater than 0.
Supermarket must be selected.
Location must be selected.
Location must contain cityId or regionId.
Start date must be valid.
End date must be valid.
End date must be same as or after start date.
```

Recommended error codes:

```text
PDF_FILE_REQUIRED
PDF_EXTENSION_INVALID
PDF_FILE_EMPTY
SUPERMARKET_REQUIRED
LOCATION_REQUIRED
START_DATE_REQUIRED
END_DATE_REQUIRED
START_DATE_INVALID
END_DATE_INVALID
DATE_RANGE_INVALID
```

Do not start any import if validation fails.

## 10. Import Page Requirements

Update:

```text
src/renderer/pages/ImportPage.tsx
```

The page should now contain a working form with these sections:

## 10.1 PDF Leaflet Section

Show:

* Select PDF button.
* Selected file name.
* Selected file size.
* Validation error if missing or invalid.
* Helper text that only PDF leaflets are supported.

Button behavior:

* Calls `window.wifranExtractor.files.selectPdf()`.
* If user cancels, keep existing selection unchanged or set to null depending on current UX, but do not error.
* If selected file is invalid, show validation error.

## 10.2 Supermarket Section

Use reference data loaded in Prompt Chunk 04.

Show:

* Supermarket dropdown.
* Active supermarkets only.
* Display name should prefer English + Arabic where available.

Example label:

```text
Othaim / العثيم
```

Fallback order:

```text
name_en
name_ar
slug
id
```

When supermarket changes:

* Reset selected location if it no longer applies.
* Recompute valid city/region options.

## 10.3 Location Section

Use `supermarket_regions` to filter options for the selected supermarket.

Support both city and region mappings.

Location option shape:

```ts
{
  cityId: string | null;
  regionId: string | null;
  label: string;
}
```

Label examples:

```text
City: Riyadh / الرياض
Region: Central Region / المنطقة الوسطى
```

Rules:

* Require one selected location.
* If selected supermarket has no mapped locations, show warning.
* Do not allow invalid supermarket/location pair if mappings exist.
* If both city and region exist in a mapping, preserve both if the schema/data allows it.

## 10.4 Offer Dates Section

Show:

* Start date input.
* End date input.
* Defaults as described above.
* Validation if invalid.

Helper text:

```text
These dates will be applied to all offers extracted from this leaflet.
```

## 10.5 Processing Readiness Section

Show a summary card:

```text
PDF: selected/missing
Supermarket: selected/missing
Location: selected/missing
Dates: valid/invalid
Supabase config: ready/not ready
Mistral config: ready/not ready
```

The Start Extraction button should exist but remain disabled if:

* Form validation fails.
* Required config is missing.
* Reference data failed to load.

Since extraction is not implemented yet, clicking the button may show:

```text
Import pipeline will be implemented in later prompt chunks.
```

Do not start processing.

## 11. Validation Summary Component

Create a reusable component:

```text
src/renderer/components/ValidationSummary.tsx
```

It should accept validation errors and display them clearly.

Example props:

```ts
type ValidationSummaryProps = {
  errors: ImportFormValidationError[];
};
```

If no errors, it may render nothing or a success message.

## 12. Form Field Component

Optional but recommended:

```text
src/renderer/components/FormField.tsx
```

Use it for consistent labels, helper text, and error text.

Keep it simple.

## 13. Import Form Hook

Create:

```text
src/renderer/hooks/useImportForm.ts
```

Responsibilities:

* Initialize default dates.
* Store form state.
* Update PDF selection.
* Update supermarket selection.
* Update location selection.
* Update dates.
* Validate form.
* Return readiness state.

Recommended return shape:

```ts
{
  formState: ImportFormState;
  validation: ImportFormValidationResult;
  setSupermarketId: (id: string | null) => void;
  setLocation: (location: SelectedImportLocation | null) => void;
  setOfferStartDate: (date: string) => void;
  setOfferEndDate: (date: string) => void;
  selectPdf: () => Promise<void>;
  resetForm: () => void;
  canStart: boolean;
}
```

## 14. Safe Config Readiness

Use the safe config status from earlier chunks.

The import form should know whether required config is ready:

Required:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
MISTRAL_API_KEY
MISTRAL_OCR_MODEL
MISTRAL_OCR_ENDPOINT
```

The renderer must only see configured/missing status, not secret values.

If Mistral config is missing, Start Extraction should be disabled.

If Supabase config is missing, Start Extraction should be disabled.

## 15. No Processing Yet

This chunk must not:

* Read the PDF contents.
* Count PDF pages.
* Split PDF.
* Render PDF pages.
* Call Mistral.
* Call Supabase write operations.
* Upload images.
* Create import batch.
* Create offer source.
* Create offers.

It only prepares validated metadata for later chunks.

## 16. Error Handling Requirements

Handle:

* User cancels file dialog.
* File dialog fails.
* Selected file has non-PDF extension.
* Reference data loading failed.
* No supermarkets found.
* Selected supermarket has no valid location mappings.
* Invalid date range.
* Missing config readiness.

Do not crash renderer.

Do not show secrets.

## 17. README Update

Update README with:

* PDF selection added.
* Import metadata form added.
* Start extraction is still not implemented.
* Required fields listed.
* Date defaults described.
* Security note that file selection uses a narrow Electron file dialog IPC only.

## 18. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` to renderer.
* Do not expose generic IPC.
* Do not expose generic filesystem APIs.
* Do not read arbitrary files from renderer.
* Do not add OCR calls.
* Do not add Supabase writes.
* Do not implement PDF processing.
* Do not implement image cropping.
* Do not add database migrations.
* Do not create offer records.
* Do not create products, brands, or categories.
* Do not create offers from banners or promotional areas.

## 19. Acceptance Criteria

This chunk is complete when:

* The Import page has a working PDF file selection button.
* Only PDF files can be selected from the dialog.
* Selected PDF name and size are displayed.
* Supermarket dropdown uses loaded reference data.
* Location options are filtered by selected supermarket.
* Start/end dates default correctly.
* Form validation works.
* Validation errors are visible.
* Start Extraction button is present but does not run pipeline yet.
* Start Extraction is disabled when form/config/reference data is invalid.
* Preload exposes only a narrow file selection API.
* Renderer does not import main-process code.
* No secrets are displayed.
* TypeScript compiles.
* App still starts.

## 20. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How PDF selection works.
* How form validation works.
* How location filtering works.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.