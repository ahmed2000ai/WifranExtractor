# Antigravity Prompt Chunk 39: Extraction Package Manifest, Load/Resume, and DB Update Gate

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 39. Prompt Chunks 28 to 38 should already have implemented the manual crop editor, streaming page rendering, crop layout templates, compact editor UI, background crop generation, flexible item OCR, and key discovery files.

This chunk adds a proper **Extraction Package Manifest** system so the app can:

```text
1. Save every leaflet extraction into a reusable folder under Extracts/.
2. Track whether an extraction is completed, incomplete, paused, failed, or in progress.
3. Reopen an existing extraction folder later.
4. Resume incomplete extractions from where they stopped.
5. Enable Update Database only when a completed extraction package is loaded.
6. Disable Start Extraction and show “Extraction Completed” when a completed package is loaded.
```

The goal is to safely separate:

```text
extraction work
```

from:

```text
database upload/update
```

A folder must not be considered ready for DB upload unless the extraction manifest explicitly says it is completed and the package validates successfully.

---

## 1. Read These Files First

Before coding, read files similar to:

```text
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/components/manual-crop/ManualCropEditor.tsx
src/renderer/hooks/useManualCropLayout.ts
src/renderer/hooks/useStreamingPdfRender.ts
src/renderer/hooks/useCropAndItemOcrWorkflow.ts
src/main/pdf/pdfPreprocessingService.ts
src/main/pdf/streamingPdfRenderService.ts
src/main/image/manualCropService.ts
src/main/workflow/backgroundPageCropQueue.ts
src/main/workflow/flexibleItemOcrDiscoveryQueue.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/ocr/ocrReturnedKeysDiscoveryService.ts
src/main/db/offerSyncService.ts
src/main/db/offerSyncMapper.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/shared/types/manualCrop.ts
src/shared/types/reviewWorkflow.ts
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Also inspect any existing extraction folder/output management code, especially anything that creates:

```text
Extracts/
pages/
crops/
json/
chunks/
metadata/
logs/
manual-crop-layout.json
flexible-item-ocr-summary.json
ocr_returned_keys.json
ocr_keys_without_values.json
```

Adapt paths if the current project structure differs.

---

## 2. Existing Extraction Folder Structure

The app already creates or should support folders like:

```text
Extracts/
  Othaim_week24/
    chunks/
    crops/
      page-001/
      page-002/
    flexible-item-ocr-summary.json
    json/
      page-001/
      page-002/
    logs/
    manual-crop-layout.json
    metadata/
      pdf-preprocess-metadata.json
    ocr_keys_without_values.json
    ocr_returned_keys.json
    Othaim_week24.pdf
    pages/
      page.1.png
      page.2.png
    source/
```

Do not break this structure.

This chunk adds a required root manifest file:

```text
Extracts/Othaim_week24/extraction_manifest.json
```

New extractions must create this manifest from the start.

Existing folders without the manifest must be loadable in recovery mode.

---

## 3. Main Concept

Each extraction folder is an **Extraction Package**.

The package is complete only when:

```text
extraction_manifest.json exists
and extraction_manifest.json has extraction_status = "completed"
and the package validation passes
```

The app must not enable Update Database based only on the existence of crops or JSON files.

The manifest is the source of truth.

---

## 4. Required Status Values

Use these extraction status values:

```text
not_started
in_progress
paused
completed
failed
```

Meaning:

```text
not_started
- Manifest exists but extraction has not begun.

in_progress
- Extraction is currently running or has partial stage output.

paused
- Extraction was stopped or app closed before completion but can continue.

completed
- Extraction finished successfully and local package validation passed.

failed
- Extraction encountered an unrecovered error.
```

Important rule:

```text
Update Database button is enabled only when extraction_status = completed and validation passes.
```

---

## 5. Required Button Behavior

Update the Import Leaflet page buttons.

### No extraction loaded

```text
Start Extraction = enabled only after required form fields are valid
Update Database = disabled
```

### New extraction currently running

```text
Start Extraction = "Extraction In Progress..." and disabled
Update Database = disabled
```

### Existing incomplete extraction loaded

If manifest exists but status is not completed:

```text
Start Extraction = "Continue Extraction"
Start Extraction = enabled
Update Database = disabled
```

If folder has no manifest and was recovered:

```text
Start Extraction = "Continue Extraction"
Start Extraction = enabled
Update Database = disabled
```

### Existing completed extraction loaded

If manifest says completed and validation passes:

```text
Start Extraction = "Extraction Completed"
Start Extraction = disabled
Update Database = enabled only if required metadata and Supabase config are valid
```

### New extraction finishes

When a new extraction fully completes:

```text
write extraction_status = completed
Start Extraction changes to "Extraction Completed"
Start Extraction becomes disabled
Update Database becomes enabled only if metadata and Supabase config are valid
```

---

## 6. Required Manifest File

Create:

```text
src/shared/types/extractionManifest.ts
```

Recommended type:

```ts
export type ExtractionStatus =
  | 'not_started'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'failed';

export type ExtractionStageStatus =
  | 'not_started'
  | 'in_progress'
  | 'partial'
  | 'completed'
  | 'failed'
  | 'skipped';

export type ExtractionManifest = {
  schema_version: 1;

  extraction_status: ExtractionStatus;
  db_update_status: 'not_started' | 'in_progress' | 'completed' | 'failed';

  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  recovered_from_existing_folder?: boolean;

  extraction_folder_name: string;
  extraction_folder_path?: string;

  pdf_file_name: string;
  pdf_base_name: string;
  page_count?: number | null;

  processing_scope: {
    mode: 'all_pages' | 'selected_pages';
    pages: number[];
  };

  supermarket: {
    id?: string | null;
    name?: string | null;
    slug?: string | null;
  };

  location: {
    location_scope?: 'national' | 'region' | 'city' | null;
    city_id?: string | null;
    region_id?: string | null;
    display_name?: string | null;
  };

  offer_dates: {
    valid_from?: string | null;
    valid_to?: string | null;
  };

  stages: {
    pdf_copy: ExtractionStageStatus;
    page_rendering: ExtractionStageStatus;
    manual_crop: ExtractionStageStatus;
    crop_generation: ExtractionStageStatus;
    item_ocr: ExtractionStageStatus;
    key_discovery: ExtractionStageStatus;
    review_package: ExtractionStageStatus;
    db_update: ExtractionStageStatus;
  };

  counts: {
    pages_rendered: number;
    chunks: number;
    crop_images: number;
    json_files: number;
    matched_crop_json_pairs: number;
    orphan_crop_images: number;
    orphan_json_files: number;
    keys_with_values: number;
    keys_without_values: number;
  };

  paths: {
    pdf: string;
    chunks_dir: string;
    pages_dir: string;
    crops_dir: string;
    json_dir: string;
    logs_dir: string;
    metadata_dir: string;
    manual_crop_layout: string;
    flexible_item_ocr_summary: string;
    ocr_returned_keys: string;
    ocr_keys_without_values: string;
  };

  validation: {
    package_valid: boolean;
    db_update_eligible: boolean;
    checked_at: string;
    warnings: Array<{
      code: string;
      message: string;
    }>;
    errors: Array<{
      code: string;
      message: string;
    }>;
  };
};
```

Use existing naming conventions if the project already has similar types.

---

## 7. Manifest Location

Every extraction package must have:

```text
{extractionRoot}/extraction_manifest.json
```

Example:

```text
Extracts/Othaim_week24/extraction_manifest.json
```

The manifest path should be stable.

Do not store it only in `metadata/`.

---

## 8. Create Manifest at Start of New Extraction

When starting a new extraction:

```text
1. Create Extracts/{pdf_base_name}/
2. If folder already exists for a new extraction, clear its contents only after the operator intentionally starts a new extraction.
3. Copy the PDF into the package root.
4. Create extraction_manifest.json immediately.
5. Set extraction_status = in_progress.
6. Set stages based on what has started.
```

Initial manifest example:

```json
{
  "schema_version": 1,
  "extraction_status": "in_progress",
  "db_update_status": "not_started",
  "created_at": "2026-06-14T04:20:00.000Z",
  "updated_at": "2026-06-14T04:20:00.000Z",
  "started_at": "2026-06-14T04:20:00.000Z",
  "completed_at": null,
  "extraction_folder_name": "Othaim_week24",
  "pdf_file_name": "Othaim_week24.pdf",
  "pdf_base_name": "othaim-week24",
  "processing_scope": {
    "mode": "all_pages",
    "pages": []
  },
  "stages": {
    "pdf_copy": "completed",
    "page_rendering": "not_started",
    "manual_crop": "not_started",
    "crop_generation": "not_started",
    "item_ocr": "not_started",
    "key_discovery": "not_started",
    "review_package": "not_started",
    "db_update": "not_started"
  },
  "counts": {
    "pages_rendered": 0,
    "chunks": 0,
    "crop_images": 0,
    "json_files": 0,
    "matched_crop_json_pairs": 0,
    "orphan_crop_images": 0,
    "orphan_json_files": 0,
    "keys_with_values": 0,
    "keys_without_values": 0
  },
  "paths": {
    "pdf": "Othaim_week24.pdf",
    "chunks_dir": "chunks",
    "pages_dir": "pages",
    "crops_dir": "crops",
    "json_dir": "json",
    "logs_dir": "logs",
    "metadata_dir": "metadata",
    "manual_crop_layout": "manual-crop-layout.json",
    "flexible_item_ocr_summary": "flexible-item-ocr-summary.json",
    "ocr_returned_keys": "ocr_returned_keys.json",
    "ocr_keys_without_values": "ocr_keys_without_values.json"
  },
  "validation": {
    "package_valid": false,
    "db_update_eligible": false,
    "checked_at": "2026-06-14T04:20:00.000Z",
    "warnings": [],
    "errors": []
  }
}
```

Populate supermarket, location, and offer dates from the import form.

---

## 9. Update Manifest Throughout Extraction

Update the manifest after each stage:

```text
PDF copied
page rendering starts/completes
manual crop layouts saved
crop generation starts/completes
item OCR starts/completes
OCR key discovery files updated
review package generated
extraction completes
DB update starts/completes/fails
```

Use atomic writes.

Do not corrupt the manifest if the app closes.

Atomic write pattern:

```text
write extraction_manifest.json.tmp
rename to extraction_manifest.json
```

---

## 10. Completion Criteria

Set:

```text
extraction_status = completed
```

only after all required local extraction stages are done and package validation passes.

Required local completion checks:

```text
PDF exists in package root
pages directory exists
manual-crop-layout.json exists
crops directory exists
json directory exists
ocr_returned_keys.json exists
ocr_keys_without_values.json exists
flexible-item-ocr-summary.json exists
at least one crop image exists
at least one item JSON exists
matched crop+JSON pairs > 0
no blocking package validation errors
```

If processing scope is all pages, also check all intended pages have completed or intentionally skipped status.

If processing scope is selected pages, completion can be valid for only those selected pages.

The manifest must explicitly store the scope.

Do not mark as completed merely because some files exist.

---

## 11. Package Validation Rules

Create a package validator.

Recommended file:

```text
src/main/extraction/extractionPackageValidator.ts
```

Validation should check:

```text
manifest exists
PDF exists
pages folder exists
crops folder exists
json folder exists
manual-crop-layout.json exists
ocr_returned_keys.json exists
ocr_keys_without_values.json exists
flexible-item-ocr-summary.json exists
crop images can be discovered
JSON files can be discovered
crop/JSON pairs can be matched by base filename
matched pairs > 0 for DB eligibility
orphan crop images are counted
orphan JSON files are counted
required metadata is present for DB update
```

Pairing rule:

```text
A DB-eligible item must have:
- crop image file
- item JSON file with the same base name
```

Example eligible pair:

```text
crops/page-001/othaim-week24_001_001.webp
json/page-001/othaim-week24_001_001.json
```

Example orphan JSON:

```text
json/page-006/othaim-week24_006_001.json
```

if no matching:

```text
crops/page-006/othaim-week24_006_001.webp
```

Then it is not DB-eligible.

Use crop files as the source of truth for image upload.

Do not upload orphan JSON files.

---

## 12. Existing Folders Without Manifest

Add support for folders like the existing:

```text
Extracts/Othaim_week24
```

that do not yet have `extraction_manifest.json`.

When the operator opens such a folder:

```text
1. Do not delete anything.
2. Scan the folder.
3. Create extraction_manifest.json in recovery mode.
4. Set recovered_from_existing_folder = true.
5. Set extraction_status = paused or in_progress, not completed.
6. Set Start Extraction button to "Continue Extraction".
7. Keep Update Database disabled.
8. Show warnings about missing manifest and any orphan files.
```

Important:

```text
A recovered folder without an existing completed manifest must not be DB-update eligible automatically.
```

The operator must continue/complete extraction so the app can write `extraction_status = completed`.

---

## 13. Open Existing Extraction Folder

Add a UI action near PDF selection:

```text
Open Existing Extraction Folder...
```

or:

```text
Load Existing Extraction Folder...
```

When clicked:

```text
1. Let the user select a folder.
2. Load extraction_manifest.json if present.
3. If not present, run recovery scan and create manifest.
4. Validate the package.
5. Populate the import form from manifest where possible.
6. Populate package status/counts/warnings in the UI.
7. Set button states according to manifest status.
```

Selecting an existing folder must never clear/delete its contents.

---

## 14. Load Completed Extraction Folder

When a folder has:

```text
extraction_manifest.json
extraction_status = completed
```

and validation passes:

```text
Start Extraction button label = "Extraction Completed"
Start Extraction button disabled
Update Database button enabled if metadata and Supabase config are valid
```

Populate left-side form with:

```text
PDF file
supermarket
location
offer dates
package path
counts
warnings if any
```

The extraction package should be usable after closing and reopening the app.

---

## 15. Load Incomplete Extraction Folder

When a folder has no manifest, or manifest has:

```text
extraction_status != completed
```

then:

```text
Start Extraction button label = "Continue Extraction"
Start Extraction button enabled
Update Database button disabled
```

When the operator clicks Continue Extraction:

```text
resume from the next incomplete stage
```

Resume behavior can be basic but must be useful.

Recommended logic:

```text
if pages are missing or page_rendering not completed:
  resume streaming page render

else if manual_crop not completed:
  open manual crop editor at first incomplete/unreviewed page

else if crop_generation not completed:
  resume/generate missing crops

else if item_ocr not completed:
  resume OCR for missing crop JSONs

else if review_package not completed:
  rebuild review package

else:
  validate and mark completed if valid
```

If exact stage resume is complex, implement a safe `Continue Extraction` flow that:

```text
validates files
opens manual crop editor
allows operator to continue pages/crops/OCR
does not lose existing work
```

Do not restart from scratch unless explicitly requested.

---

## 16. Start New Extraction Behavior

For a new PDF extraction:

```text
Start Extraction
```

should create or recreate the package folder.

If the target package folder already exists:

```text
warn the operator that starting a new extraction will clear the existing folder
```

But if the operator chooses:

```text
Open Existing Extraction Folder
```

then never clear it.

Clear existing folder only for intentional new extraction, not for loading/resuming.

---

## 17. Update Database Gate

The DB Update button must always be disabled unless:

```text
a package is loaded
manifest exists
manifest.extraction_status = completed
manifest.validation.package_valid = true
manifest.validation.db_update_eligible = true
required import metadata is valid
Supabase configuration is ready
there is at least one matched crop+JSON pair
not currently updating DB
```

If any condition is missing, keep DB Update disabled.

Show a helpful reason:

```text
Complete extraction before updating database.
```

or:

```text
This extraction has orphan JSON files and no completed manifest.
```

or:

```text
Select supermarket/location/dates before updating database.
```

Do not allow DB update from partial extraction folders.

---

## 18. DB Sync Uses Loaded Package

When `Update Database` is clicked for a completed package:

```text
use the loaded package folder
use matched crop+JSON pairs
use manifest metadata
upload crop images
map item JSON values according to current DB sync logic
write/update Wifran DB
update manifest db_update_status
```

Do not rerun extraction.

Do not rerender pages.

Do not recrop images.

Do not rerun OCR.

Use existing final sync flow, adapted to consume the package.

---

## 19. UI Package Summary

On the Import page, after loading an existing package, show a compact package summary:

```text
Extraction Package: Othaim_week24
Status: Completed / Paused / In Progress / Failed
PDF: Othaim_week24.pdf
Pages rendered: 54
Crop images: 19
Item JSON files: 30
Matched crop+JSON pairs: 19
Orphan JSON files: 11
DB update: Not Started
```

Warnings should be visible but not overwhelming.

Example warning:

```text
json/page-006 contains 11 JSON files with no matching crop images. These will not be uploaded.
```

---

## 20. Pipeline Progress Panel Update

Update the progress panel to reflect the new workflow.

Recommended stages:

```text
1. Form Metadata
2. PDF Package
3. Page Rendering
4. Manual Crop Layout
5. Crop Images
6. Item OCR JSON
7. Key Discovery
8. Review Package
9. Database Update
```

When a completed package is loaded:

```text
Form Metadata: Completed
PDF Package: Completed
Page Rendering: Completed
Manual Crop Layout: Completed
Crop Images: Completed
Item OCR JSON: Completed
Key Discovery: Completed
Review Package: Completed
Database Update: Not Started
```

When incomplete:

```text
Continue Extraction
```

should reflect the first incomplete stage.

---

## 21. Completed Indicator

Use the manifest as the primary completed indicator:

```text
extraction_manifest.json
extraction_status = completed
```

Do not rely only on a marker file.

Optional: create a small marker file after successful completion:

```text
.extraction-completed
```

But if implemented, it is secondary only.

Primary truth remains:

```text
extraction_manifest.json
```

If marker and manifest disagree, manifest wins and show a warning.

---

## 22. Recovery Scan for Current Existing Folder Structure

The recovery scanner must support the currently observed structure:

```text
chunks/
crops/page-001/*.webp
json/page-001/*.json
logs/
manual-crop-layout.json
metadata/pdf-preprocess-metadata.json
ocr_keys_without_values.json
ocr_returned_keys.json
Othaim_week24.pdf
pages/page.1.png
source/
flexible-item-ocr-summary.json
```

It should count:

```text
chunks = 54
rendered pages = 54
crop images = count all .webp under crops/
json files = count all .json under json/
matched pairs = same base name under corresponding crops/page-XXX and json/page-XXX
orphan crop images = crop without JSON
orphan JSON files = JSON without crop
keys with values = entries in ocr_returned_keys.json
keys without values = entries in ocr_keys_without_values.json
```

Page filename sorting must handle:

```text
page.1.png
page.2.png
page.10.png
```

numerically, not lexicographically.

---

## 23. Path Handling

Use robust path handling for Windows.

Support paths like:

```text
F:\Work\AI Projects\wifran-offers-extractor\Extracts\Othaim_week24
```

Do not assume POSIX separators.

Use Node `path` utilities.

Store manifest paths as relative paths inside the package when possible.

Example:

```text
pages_dir: "pages"
crops_dir: "crops"
json_dir: "json"
```

Absolute package root may be tracked in app state but should not be required inside the manifest unless helpful.

---

## 24. Manifest Service

Create:

```text
src/main/extraction/extractionManifestService.ts
```

Implement functions similar to:

```ts
export async function createInitialExtractionManifest(input): Promise<ExtractionManifest>;

export async function loadExtractionManifest(packagePath: string): Promise<ExtractionManifest | null>;

export async function saveExtractionManifest(packagePath: string, manifest: ExtractionManifest): Promise<void>;

export async function updateExtractionManifest(packagePath: string, patch: Partial<ExtractionManifest>): Promise<ExtractionManifest>;

export async function markExtractionCompleted(packagePath: string): Promise<ExtractionManifest>;

export async function markExtractionPaused(packagePath: string): Promise<ExtractionManifest>;

export async function recoverManifestFromExistingFolder(packagePath: string): Promise<ExtractionManifest>;
```

Use atomic writes.

---

## 25. Extraction Package Service

Create:

```text
src/main/extraction/extractionPackageService.ts
```

Implement:

```ts
export async function openExtractionPackage(packagePath: string): Promise<{
  manifest: ExtractionManifest;
  validation: ExtractionPackageValidationResult;
  mode: 'loaded_completed' | 'loaded_incomplete' | 'recovered';
}>;

export async function validateExtractionPackage(packagePath: string): Promise<ExtractionPackageValidationResult>;

export async function scanExtractionPackageFiles(packagePath: string): Promise<ExtractionPackageScanResult>;

export async function getDbEligibleItemsFromPackage(packagePath: string): Promise<DbEligiblePackageItem[]>;
```

`DbEligiblePackageItem` should include:

```ts
{
  pageNumber: number;
  itemNumber: string;
  cropPath: string;
  jsonPath: string;
  jsonData: Record<string, unknown>;
}
```

Only include matched crop+JSON pairs.

---

## 26. IPC and Preload

Add narrow IPC handlers.

Recommended file:

```text
src/main/ipc/extractionPackageIpc.ts
```

Expose:

```text
extractionPackage:openFolderDialog
extractionPackage:open
extractionPackage:validate
extractionPackage:continue
extractionPackage:getDbEligibleItems
```

Update:

```text
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
```

Preload example:

```ts
window.wifranExtractor.extractionPackage = {
  openFolderDialog: () => Promise<string | null>,
  open: (packagePath: string) => Promise<OpenExtractionPackageResult>,
  validate: (packagePath: string) => Promise<ExtractionPackageValidationResult>,
  continueExtraction: (packagePath: string) => Promise<ContinueExtractionResult>,
  getDbEligibleItems: (packagePath: string) => Promise<DbEligiblePackageItem[]>
};
```

Do not expose arbitrary filesystem operations.

---

## 27. Import Page UI Changes

Update `ImportPage.tsx`.

Add near PDF selection:

```text
Select PDF File...
Open Existing Extraction Folder...
```

When existing folder is opened:

```text
populate loaded package state
show package summary
populate form metadata from manifest if available
set Start button label based on manifest status
set Update Database enabled/disabled based on completion gate
```

Button labels:

```text
Start Extraction
Continue Extraction
Extraction In Progress...
Extraction Completed
```

Disable Update Database unless completed gate passes.

---

## 28. Metadata Editing for Loaded Packages

If a loaded package is missing required metadata:

```text
supermarket
location
offer dates
```

allow the operator to fill those fields in the form.

When they save/continue/attempt DB update:

```text
update manifest metadata
revalidate DB eligibility
```

A completed package with missing metadata should show:

```text
Extraction Completed
```

but DB Update remains disabled until metadata is completed.

---

## 29. Completion After Continue Extraction

When the operator clicks Continue Extraction and the remaining required stages finish:

```text
validate package
write manifest extraction_status = completed
set completed_at
set stage statuses to completed
set Start button = Extraction Completed
disable Start button
enable Update Database if metadata and Supabase config are valid
```

---

## 30. App Exit / Crash Handling

If the app closes while extraction is in progress:

```text
manifest should remain in_progress or paused
```

On next open/load:

```text
Start button = Continue Extraction
Update Database = disabled
```

If possible, mark as paused when the app exits cleanly during extraction.

Do not mark completed unless completion validation passes.

---

## 31. Error Handling

Use clear error codes:

```text
EXTRACTION_MANIFEST_MISSING
EXTRACTION_MANIFEST_INVALID
EXTRACTION_PACKAGE_RECOVERED
EXTRACTION_PACKAGE_VALIDATION_FAILED
EXTRACTION_PACKAGE_PDF_MISSING
EXTRACTION_PACKAGE_PAGES_MISSING
EXTRACTION_PACKAGE_CROPS_MISSING
EXTRACTION_PACKAGE_JSON_MISSING
EXTRACTION_PACKAGE_NO_MATCHED_ITEMS
EXTRACTION_PACKAGE_ORPHAN_JSON_FILES
EXTRACTION_PACKAGE_ORPHAN_CROP_FILES
EXTRACTION_PACKAGE_METADATA_INCOMPLETE
EXTRACTION_PACKAGE_NOT_COMPLETED
EXTRACTION_PACKAGE_DB_UPDATE_NOT_ELIGIBLE
EXTRACTION_PACKAGE_CONTINUE_FAILED
```

Show readable messages in the UI.

---

## 32. Tests / Smoke Checks

Add tests or smoke checks for:

```text
New extraction creates extraction_manifest.json immediately.
Manifest is updated after stage completion.
Completed extraction writes extraction_status = completed.
Completed extraction disables Start Extraction and shows Extraction Completed.
Update Database is disabled when no package is loaded.
Update Database is disabled for missing manifest folders.
Update Database is disabled for extraction_status != completed.
Update Database is enabled only for completed valid package with metadata and matched items.
Open Existing Extraction Folder never deletes folder contents.
Folder without manifest is recovered and marked not completed.
Recovered folder shows Continue Extraction.
Recovered folder keeps Update Database disabled.
Folder with completed manifest shows Extraction Completed.
Completed loaded package populates form metadata.
Incomplete loaded package shows Continue Extraction.
Continue Extraction resumes without deleting existing pages/crops/json.
Package validator counts pages, crops, JSON, matched pairs, orphan JSON.
Orphan JSON files are not DB eligible.
DB eligible items require matching crop and JSON base names.
Windows paths are handled correctly.
page.10.png sorting is numeric.
Manifest writes are atomic.
DB update uses loaded package and does not rerun extraction.
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If any script does not exist, document that clearly and do not invent success.

---

## 33. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text
The Extracts folder package structure.
What extraction_manifest.json is.
How completion status works.
How to open an existing extraction folder.
How recovered folders work.
Why DB Update is disabled until extraction_status = completed.
How Continue Extraction works.
How Update Database uses matched crop+JSON pairs.
How orphan JSON/crop files are handled.
```

Add example:

```text
Example: open a completed extraction later

1. Open the app.
2. Click Open Existing Extraction Folder.
3. Select Extracts/Othaim_week24.
4. The app reads extraction_manifest.json.
5. If extraction_status is completed, Start Extraction shows Extraction Completed.
6. Update Database becomes available if metadata and Supabase config are valid.
7. Click Update Database to upload matched crop+JSON items.
```

Add example:

```text
Example: recover an older folder without manifest

1. Click Open Existing Extraction Folder.
2. Select Extracts/Othaim_week24.
3. The app scans pages, crops, JSON, key files, and metadata.
4. The app creates extraction_manifest.json with recovered_from_existing_folder = true.
5. Start Extraction shows Continue Extraction.
6. Update Database remains disabled.
7. Continue extraction until the app validates and marks the package completed.
```

---

## 34. Security Rules

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase service role key to renderer.
* Do not expose raw `ipcRenderer`.
* Do not expose generic filesystem IPC.
* Do not delete an existing extraction folder when the user opens it for loading/resume.
* Only clear an existing extraction folder when the user intentionally starts a new extraction and confirms overwrite.
* Do not run OCR or DB update merely by opening a package.
* Do not upload images unless the operator clicks Update Database and the package is completed/eligible.
* Do not write to Wifran DB unless the completed package gate passes.

---

## 35. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

---

## 36. Acceptance Criteria

This chunk is complete when:

* New extractions create `extraction_manifest.json`.
* Manifest tracks extraction status, stage statuses, counts, paths, metadata, validation, and DB update status.
* Existing folders can be opened from the Import page.
* Existing folders without manifest are recovered but not marked completed.
* Completed packages are recognized only by manifest `extraction_status = completed`.
* Start Extraction shows `Extraction Completed` and is disabled for completed packages.
* Start Extraction shows `Continue Extraction` for incomplete/recovered packages.
* Update Database is always disabled unless a completed valid package is loaded.
* Update Database uses matched crop+JSON pairs from the loaded package.
* Orphan JSON files are excluded from DB eligibility.
* Opening an existing package never deletes its contents.
* Continuing extraction does not delete existing work.
* Package summary and warnings are shown in UI.
* Metadata can be populated from manifest or filled by operator.
* Documentation is updated.
* TypeScript compiles.
* App still starts.

---

## 37. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How `extraction_manifest.json` works.
* How new extractions create and update the manifest.
* How completed status is set.
* How existing folders are loaded.
* How recovery mode works for folders without manifests.
* How Start Extraction / Continue Extraction / Extraction Completed labels work.
* How Update Database gating works.
* How matched crop+JSON pairs are detected.
* How orphan files are handled.
* How to test with `Extracts/Othaim_week24`.
* Any assumptions made.
* Any issues or TODOs.

Keep the project runnable after this chunk.