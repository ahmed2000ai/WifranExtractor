# Antigravity Prompt Chunk 16: Results UI, Row Statuses, Logs, and Summaries

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 16. Prompt Chunks 01 to 15 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, validated import form, local PDF preprocessing, OCR schemas/validation, Mistral OCR integration, controlled OCR pipeline, promotional/banner filtering, local image cropping, import tracking persistence, entity matching, duplicate detection, offer payload preparation, Supabase Storage upload, and final offer sync.

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

Polish and complete the operator-facing results, row-status, logs, and summary experience.

By this point, the app should already be able to run the full ETL flow:

```text
select PDF
validate metadata
preprocess PDF
run OCR
filter promotional/banner rows
crop item images
save import tracking
match entities
prepare offer payloads
upload images
sync offers
```

This chunk should make the UI clearly show what happened at every stage.

It should help the operator answer:

```text
Which rows were imported?
Which rows need review?
Which rows failed?
Which rows were skipped as duplicates?
Which rows were skipped as promotional/banner content?
Which chunks failed OCR?
Which images failed to crop or upload?
Which final offers were created?
What is the final batch status?
Where are the logs?
```

Do **not** add database migrations.

Do **not** publish offers automatically.

Do **not** change sync logic in a risky way unless needed for display integration.

Do **not** delete existing Wifran data.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/pipelineSummary.ts
src/shared/utils/pipelineSummaryBuilder.ts
src/renderer/components/SummaryCard.tsx
src/renderer/components/StatusBadge.tsx
src/renderer/components/IssueList.tsx
src/renderer/components/ResultsTable.tsx
src/renderer/components/RowDetailsPanel.tsx
src/renderer/components/ProgressTimeline.tsx
src/renderer/components/LogPanel.tsx
src/renderer/hooks/usePipelineSummary.ts
src/renderer/hooks/usePipelineLogs.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
src/renderer/pages/SettingsPage.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve these responsibilities.

## 4. UI Principle

The app is an internal ETL tool.

Prioritize:

```text
clarity
traceability
operator confidence
safe error visibility
easy troubleshooting
```

Do not prioritize visual polish over correctness.

Avoid hiding warnings/errors.

Avoid showing raw secrets.

Avoid showing huge raw JSON by default.

## 5. Pipeline Summary Type

Create:

```text
src/shared/types/pipelineSummary.ts
```

Define renderer-safe summary types.

Recommended:

```ts
export type PipelineStageStatus =
  | 'not_started'
  | 'running'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'skipped';

export type PipelineStageSummary = {
  key:
    | 'metadata'
    | 'pdf_preprocess'
    | 'ocr'
    | 'promotional_filtering'
    | 'image_cropping'
    | 'import_tracking'
    | 'entity_matching'
    | 'offer_preparation'
    | 'offer_sync';
  label: string;
  status: PipelineStageStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  message?: string | null;
  counts?: Record<string, number>;
};

export type PipelineRowIssue = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  fieldName?: string | null;
  message: string;
};

export type PipelineResultRow = {
  rowId: string;
  rowNumber?: number | null;
  pageNumber?: number | null;

  productNameAr?: string | null;
  productNameEn?: string | null;
  offerPrice?: number | null;

  rowStatus:
    | 'valid'
    | 'warning'
    | 'error'
    | 'skipped'
    | 'matched'
    | 'prepared'
    | 'needs_review'
    | 'duplicate'
    | 'imported'
    | 'needs_review_imported';

  skipReason?: string | null;

  productId?: string | null;
  brandId?: string | null;
  categoryId?: string | null;

  duplicateOfferId?: string | null;
  createdOfferId?: string | null;

  localImagePath?: string | null;
  imageUrl?: string | null;
  storagePath?: string | null;

  dataQualityScore?: number | null;
  preparedOfferStatus?: 'draft' | 'needs_review' | null;

  issues: PipelineRowIssue[];
};

export type PipelineSummary = {
  stages: PipelineStageSummary[];
  rows: PipelineResultRow[];
  counts: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    errorRows: number;
    skippedRows: number;
    skippedPromotionalRows: number;
    duplicateRows: number;
    preparedRows: number;
    importedRows: number;
    needsReviewImportedRows: number;
    imageUploadedRows: number;
    imageFailedRows: number;
    failedChunks: number;
  };
  finalStatus:
    | 'not_started'
    | 'ready'
    | 'completed'
    | 'partially_completed'
    | 'failed';
};
```

Adjust if existing types already cover this.

Do not include secrets.

## 6. Pipeline Summary Builder

Create:

```text
src/shared/utils/pipelineSummaryBuilder.ts
```

Implement a pure renderer-safe function:

```ts
export function buildPipelineSummary(input: {
  formState?: unknown;
  pdfPreprocessResult?: unknown;
  ocrPipelineResult?: unknown;
  imageCroppingResult?: unknown;
  importTrackingResult?: unknown;
  entityMatchingResult?: unknown;
  offerPreparationResult?: unknown;
  offerSyncResult?: unknown;
}): PipelineSummary;
```

Responsibilities:

* Merge stage results into one coherent summary.
* Merge row-level data from OCR, cropping, entity matching, offer preparation, and offer sync.
* Preserve row IDs across stages.
* Count statuses.
* Count promotional skipped rows.
* Count duplicates.
* Count imported rows.
* Count errors and warnings.
* Surface created offer IDs.
* Surface image URLs and storage paths.
* Surface issues from all stages.

Rules:

* Do not crash if a stage has not run yet.
* Do not assume every row exists in every stage.
* Prefer latest-stage status when available.
* Preserve earlier issues even after later stages run.
* Keep skipped promotional rows visible in the results.

## 7. Summary Cards

Create or improve:

```text
src/renderer/components/SummaryCard.tsx
```

Show key metrics:

```text
Total rows
Imported offers
Needs review offers
Warning rows
Error rows
Skipped rows
Skipped promotional rows
Duplicate rows
Images uploaded
Image failures
Failed OCR chunks
```

Use status-aware styling, but keep it simple.

## 8. Status Badge

Create or improve:

```text
src/renderer/components/StatusBadge.tsx
```

Support statuses:

```text
not_started
running
completed
partially_completed
failed
valid
warning
error
skipped
matched
prepared
needs_review
duplicate
imported
needs_review_imported
draft
```

Display clear labels.

Examples:

```text
Imported
Needs Review
Skipped
Duplicate
Promotional
Error
Warning
Prepared
```

## 9. Issue List Component

Create:

```text
src/renderer/components/IssueList.tsx
```

It should display row or stage issues.

Props:

```ts
type IssueListProps = {
  issues: Array<{
    severity: 'info' | 'warning' | 'error';
    code: string;
    fieldName?: string | null;
    message: string;
  }>;
  compact?: boolean;
};
```

Display:

```text
severity
code
field name if available
message
```

Do not show stack traces or secrets.

## 10. Results Table

Create or improve:

```text
src/renderer/components/ResultsTable.tsx
```

The results table should show one row per extracted OCR item or tracked import row.

Minimum columns:

```text
Row
Page
Product
Price
Status
Offer Status
Data Quality
Product ID
Created Offer ID
Duplicate Offer ID
Image
Issues
```

Rules:

* Promotional/banner skipped rows must remain visible.
* Duplicate rows must be clearly marked.
* Error rows must be clearly marked.
* Imported rows must show created offer ID.
* Needs-review imported rows must show created offer ID and needs-review status.
* Rows with image URLs should show a link or small preview if safe.
* Rows with local image paths should show the path, but do not create unsafe arbitrary file access.

If local image previews are not already safely supported, do not force them in this chunk.

## 11. Row Details Panel

Create:

```text
src/renderer/components/RowDetailsPanel.tsx
```

When an operator selects a row, show detailed information.

Recommended sections:

```text
Basic Info
OCR Data
Normalized Data
Crop Result
Matched Entities
Prepared Offer Payload
Sync Result
Issues
```

Show JSON in collapsible/preformatted blocks only for row-specific safe data.

Do not show secrets.

Do not show massive raw OCR responses by default.

## 12. Progress Timeline

Create:

```text
src/renderer/components/ProgressTimeline.tsx
```

Show the pipeline stages in order:

```text
Metadata
PDF Preprocess
OCR
Promotional Filtering
Image Cropping
Import Tracking
Entity Matching
Offer Preparation
Offer Sync
```

For each stage, show:

```text
status
duration if available
key counts
message
```

This should help the operator understand how far the import got.

## 13. Log Panel

Create or improve:

```text
src/renderer/components/LogPanel.tsx
```

The log panel should combine in-memory progress events from:

```text
PDF preprocessing
OCR pipeline
image cropping
import tracking
entity matching
offer preparation
offer sync
```

Minimum log entry shape:

```ts
export type UiLogEntry = {
  timestamp: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  source:
    | 'app'
    | 'pdf'
    | 'ocr'
    | 'image'
    | 'import_tracking'
    | 'entity_matching'
    | 'offer_preparation'
    | 'offer_sync';
  message: string;
  details?: Record<string, unknown>;
};
```

Rules:

* Do not log secrets.
* Do not log raw API keys.
* Do not log full Authorization headers.
* Do not log huge base64 payloads.
* Keep logs readable.
* Allow clearing in-memory logs.

Persistent log files may remain a future enhancement if not already implemented.

## 14. usePipelineSummary Hook

Create:

```text
src/renderer/hooks/usePipelineSummary.ts
```

This hook should consume the existing stage results from app state and return `PipelineSummary`.

If the app currently stores stage results locally in `ImportPage`, either:

* Lift shared state to a parent component, or
* Use a simple React context for pipeline state.

Do not introduce a heavy state management library unless already used.

Recommended:

```text
src/renderer/hooks/usePipelineState.ts
or
src/renderer/context/PipelineContext.tsx
```

Only add this if needed to share results between Import, Results, and Logs pages.

## 15. usePipelineLogs Hook

Create:

```text
src/renderer/hooks/usePipelineLogs.ts
```

Responsibilities:

* Append log entries from progress events.
* Deduplicate repeated events if needed.
* Keep logs in memory.
* Provide clear logs function.
* Provide filtered logs by level/source if easy.

Do not write logs to disk in renderer.

## 16. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

Add a compact pipeline progress section showing:

```text
Current stage
Latest progress message
Stage timeline
Next recommended action
```

Examples of next action messages:

```text
Select a PDF to begin.
Run PDF preprocessing.
Run OCR on all chunks.
Crop item images locally.
Save import tracking.
Match products and brands.
Prepare offer payloads.
Sync offers to Wifran.
Import completed.
Import completed with warnings.
Import failed. Review errors below.
```

The Import page should not be overloaded with all row details. It should focus on next actions and stage summaries.

## 17. Results Page Integration

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Make this the main operator review page.

It should include:

```text
Final summary cards
Pipeline timeline
Results table
Row details panel
Issue filters
Status filters
```

Recommended filters:

```text
All
Imported
Needs Review
Warnings
Errors
Skipped
Duplicates
Promotional
```

Search/filter by:

```text
product name
row ID
page number
created offer ID
```

Keep it simple if time is limited.

## 18. Logs Page Integration

Update:

```text
src/renderer/pages/LogsPage.tsx
```

Show:

```text
In-memory logs
Filter by source
Filter by level
Clear logs button
Latest errors/warnings summary
```

Do not show secrets.

## 19. Settings Page Integration

Update:

```text
src/renderer/pages/SettingsPage.tsx
```

Keep config readiness display.

Add a small status/reminder section:

```text
Secrets are loaded only in the Electron main process.
Offers are created as draft or needs_review only.
Promotional/banner rows are skipped.
No offers are auto-published.
```

Do not display secret values.

## 20. Empty States

Add clear empty states:

### Results page before any import

```text
No import results yet. Start by selecting a PDF on the Import page.
```

### Logs page before events

```text
No logs yet. Logs will appear while preprocessing, OCR, cropping, and sync run.
```

### No errors

```text
No errors found.
```

### No warnings

```text
No warnings found.
```

## 21. Export/Copy Summary

Add a simple “Copy Summary” button if practical.

It should copy a text summary such as:

```text
Wifran Offers Extractor Summary
Batch: ...
Imported: ...
Needs Review: ...
Skipped: ...
Errors: ...
Promotional skipped: ...
Duplicates: ...
```

Do not include secrets.

Do not include huge raw JSON.

This is optional but useful.

## 22. Error Presentation

Errors should be shown in three levels:

```text
Stage-level error
Row-level error
Issue-level details
```

Avoid scary raw stack traces in the UI.

Use codes and readable messages.

Example:

```text
OFFER_CREATE_FAILED
Failed to create offer record for this row.
```

## 23. README Update

Update README with:

* Results UI completed.
* Row status meanings.
* Summary counts explained.
* Logs page explained.
* Troubleshooting workflow:

  * OCR failed
  * Rows skipped as promotional
  * Duplicate detected
  * Image upload failed
  * Offer insert failed
* Reminder that offers are created only as draft/needs_review.
* Reminder that no secrets are shown in renderer.

## 24. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic IPC.
* Do not publish offers automatically.
* Do not use `status = published`.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not modify customer user data.
* Do not create offers from promotional/banner rows.
* Do not show secrets in logs, row details, summaries, or copied summaries.

## 25. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 26. Acceptance Criteria

This chunk is complete when:

* Pipeline summary type exists.
* Pipeline summary builder merges all stage outputs safely.
* Summary cards show key counts.
* Progress timeline shows all stages.
* Results table shows row-level status and sync outcome.
* Promotional/banner skipped rows are visible and counted.
* Duplicate rows are visible and counted.
* Imported rows show created offer IDs.
* Needs-review imported rows are distinct from clean imported rows.
* Row details panel shows safe row-specific data.
* Logs page shows in-memory progress logs.
* Logs and summaries do not show secrets.
* Results page has useful empty states.
* README explains row statuses and troubleshooting.
* TypeScript compiles.
* App still starts.

## 27. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How pipeline summary is built.
* How row statuses are displayed.
* How logs are collected/displayed.
* How promotional, duplicate, warning, and error rows appear.
* Any assumptions made about app state sharing.
* Any issues or TODOs.

Keep the project runnable after this chunk.