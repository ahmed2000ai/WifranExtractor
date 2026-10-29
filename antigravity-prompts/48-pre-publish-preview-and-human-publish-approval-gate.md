# Antigravity Prompt Chunk 48: Pre-Publish Preview and Human Publish Approval Gate

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 48.

Chunks 41–47 should already have completed:

```text id="jvgj02"
41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
42-canonical-offer-normalizer-and-legacy-field-mapper.md
43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md
44-adaptive-style-profile-generation.md
45-style-aware-validation-call-for-every-item.md
46-deterministic-price-size-and-publishing-sanity-checks.md
47-comparison-safety-and-publish-decision-engine.md
```

This chunk adds the mandatory **Pre-Publish Preview** and human approval gate.

After extraction completes, the app must not upload to Supabase DB automatically.

The user must click:

```text id="af4rdn"
Pre-Publish Preview
```

Then the app must open a preview window/modal/page showing a grid of all cropped item images.

Under each image, show a `FIELD_NAME / VALUE` table with the extracted canonical data for that crop.

Only after the user visually reviews the preview and clicks:

```text id="igxt86"
Publish to Wifran DB
```

should the app upload images and upsert DB rows.

---

## 1. Read These Files First

Read the master accuracy package:

```text id="lpxyew"
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read the Chunk 40 inspection report:

```text id="uvxlqq"
wifran-offers-extractor/antigravity-reports/40-current-ocr-pipeline-inspection-report.md
```

Read previous prompts and inspect their implementation results:

```text id="sgnshr"
wifran-offers-extractor/antigravity-prompts/41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
wifran-offers-extractor/antigravity-prompts/42-canonical-offer-normalizer-and-legacy-field-mapper.md
wifran-offers-extractor/antigravity-prompts/43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md
wifran-offers-extractor/antigravity-prompts/44-adaptive-style-profile-generation.md
wifran-offers-extractor/antigravity-prompts/45-style-aware-validation-call-for-every-item.md
wifran-offers-extractor/antigravity-prompts/46-deterministic-price-size-and-publishing-sanity-checks.md
wifran-offers-extractor/antigravity-prompts/47-comparison-safety-and-publish-decision-engine.md
```

Then inspect these files:

```text id="rt5apq"
src/renderer/src/pages/ImportPage.tsx
src/renderer/src/pages/ResultsPage.tsx
src/renderer/src/components/review/PreDbReviewSummary.tsx
src/renderer/src/components/
src/main/db/offerSyncService.ts
src/main/db/offerPreparationService.ts
src/main/db/offerSyncMapper.ts
src/main/storage/offerImageStorageService.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/extraction/extractionManifestService.ts
src/shared/types/canonicalOffer.ts
src/shared/utils/publishDecisionEngine.ts
src/shared/utils/comparisonSafety.ts
src/main/ipc/
src/preload/
```

Adapt paths if the actual project structure differs.

---

## 2. Context From Chunk 40

Chunk 40 found:

```text id="u5iud1"
ImportPage.tsx currently controls Select PDF → Run Preprocessing → Run OCR Pipeline.
DB update can cascade automatically through autoRun.
A Proceed to DB Update action exists in PreDbReviewSummary.
ResultsPage and PreDbReviewSummary exist but do not provide the required crop-image grid with FIELD_NAME / VALUE tables.
```

This chunk must fix that flow.

The old direct DB update path must no longer be available without preview approval.

---

## 3. Goal

Implement this required flow:

```text id="t8cgbw"
Extraction Completed
→ Pre-Publish Preview button enabled
→ user opens preview
→ preview displays all cropped item images with extracted data tables
→ user reviews visually
→ user clicks Publish to Wifran DB inside preview
→ confirmation dialog appears
→ user confirms
→ upload images and upsert eligible DB rows
→ write publish result to manifest/report
```

The app must not allow:

```text id="w8gax5"
Extraction Completed
→ automatic DB upload
```

or:

```text id="pwre8l"
Extraction Completed
→ direct DB update from main page without preview
```

---

## 4. Preserve Existing Working Behavior

Preserve:

```text id="pwzx4q"
current crop generation
current crop filenames
current item number assignment
current candidate-based extraction prompt
current item OCR schema
current canonical normalizer
current style profile generation
current style-aware validation call
current deterministic checks
current comparison safety
current publish decision engine
current shared Mistral queue
current raw JSON saving
current extraction package folder structure
current Supabase Storage upload implementation
current DB upsert implementation
```

Do not redesign Supabase upload.

Do not redesign DB upsert.

Do not add DB migrations.

Do not add new Supabase columns.

Do not change the offer image path convention.

This chunk changes **when** DB sync is allowed, not the core upload/upsert implementation.

---

## 5. Required Product Behavior

### 5.1 After extraction completes

When extraction finishes successfully and the manifest/package is valid:

```text id="mzdw47"
Start Extraction button → "Extraction Completed" and disabled
Pre-Publish Preview button → enabled
Direct Update Database button → hidden or disabled
```

The main page must not present a dangerous direct DB update button that bypasses preview.

If an existing component still has `Proceed to DB Update`, it must be changed so it opens the Pre-Publish Preview or is removed/disabled.

### 5.2 Loading an existing completed extraction

When the user loads an existing extraction folder:

```text id="issjjk"
if manifest.extraction_status = completed
and package validation passes
then Pre-Publish Preview button is enabled
```

DB publish still must not start until the user opens preview and clicks Publish.

### 5.3 Incomplete extraction

If extraction is incomplete:

```text id="w6z91l"
Pre-Publish Preview button disabled
Start button says Continue Extraction
Publish unavailable
```

### 5.4 Preview opened but Publish not clicked

Opening the preview is not approval.

The app must not upload anything merely because preview was opened.

### 5.5 Publish clicked

Only when the user clicks `Publish to Wifran DB` inside the preview and confirms should upload/upsert start.

---

## 6. New UI: Pre-Publish Preview

Create a new component/page/modal/window.

Recommended names:

```text id="fq5f6r"
src/renderer/src/components/prepublish/PrePublishPreview.tsx
src/renderer/src/components/prepublish/PrePublishItemCard.tsx
src/renderer/src/components/prepublish/PrePublishFieldTable.tsx
src/renderer/src/components/prepublish/PrePublishSummaryBar.tsx
src/renderer/src/components/prepublish/PrePublishFilters.tsx
```

or, if the project prefers pages:

```text id="wz8q6o"
src/renderer/src/pages/PrePublishPreviewPage.tsx
```

Use the existing UI framework/style conventions.

---

## 7. Preview Layout

The preview must display a grid of item cards.

Each card must show:

```text id="mv5rrz"
cropped image
final decision badge
comparison badge
confidence badge
warning/error count
FIELD_NAME / VALUE table
expandable details
```

Required visual structure:

```text id="hkjcbg"
[ cropped item image ]

Decision: Publish / Publish but Exclude / Skip
Confidence: High / Medium / Low
Comparison: Eligible / Excluded
Warnings: 2
Errors: 0

FIELD_NAME                         VALUE
source_page_number                  1
source_item_number                  001
title_ar                            ...
title_en                            ...
brand_text                          ...
item_domain                         grocery
offer_price                         10
original_price                      15.99
currency                            SAR
size_text                           1.5L
pack_quantity                       1
bundle_quantity                     -
each_size_value                     1.5
each_size_unit                      liter
total_content_value                 1.5
total_content_unit                  liter
price_basis                         each
promotion_mechanic                  standard_price
condition_text                      -
comparison_eligible                 true
comparison_unit                     liter
comparison_unit_price               6.67 SAR/liter
comparison_exclusion_reason         -
publish_decision                    publish
```

The field table must be under the image, not separate from it.

The user should be able to visually compare each crop against its extracted fields.

---

## 8. Fields to Display

At minimum, display these canonical fields:

```text id="p6kr5u"
source_page_number
source_item_number
title_ar
title_en
brand_text
category_hint
item_domain
offer_price
original_price
currency
size_text
pack_quantity
bundle_quantity
each_size_value
each_size_unit
total_content_value
total_content_unit
price_basis
promotion_mechanic
condition_text
comparison_eligible
comparison_unit
comparison_unit_price
comparison_exclusion_reason
publish_decision
blocking_errors
non_blocking_warnings
```

Use clean human-readable values.

For empty values, show:

```text id="rq16op"
—
```

Do not show giant raw JSON by default.

---

## 9. Expandable Details

Each card should include collapsed sections for:

```text id="b46ths"
Price Candidates
Size Candidates
Visual Evidence
Validation Result
Deterministic Warnings / Errors
Comparison Details
Raw OCR JSON
Validation JSON
```

These sections may be collapsed by default.

Do not make the first version an editor.

This preview is read-only.

---

## 10. Filters and Counts

Add filters/tabs at the top:

```text id="yjh21w"
All
Will Publish
Will Publish but Excluded from Comparison
Skipped / Quarantined
Warnings
Blocking Errors
Non-Grocery
```

Show counts:

```text id="bosm1c"
All (159)
Will Publish (134)
Excluded from Comparison (18)
Skipped (7)
Warnings (22)
Errors (7)
Non-Grocery (4)
```

Filtering must not change the publish payload incorrectly.

Publish should always use the full eligible set, not only currently visible filtered rows, unless a future version adds explicit row selection.

For this chunk:

```text id="yf97fc"
Publish all eligible rows
```

---

## 11. Preview Summary Header

At the top of the preview show:

```text id="rwud8b"
Leaflet: Othaim_week24
Supermarket: Othaim
Coverage: city / Riyadh
Offer dates: 2026-06-10 to 2026-06-16

Total items: 159
Will publish: 134
Will publish but exclude from comparison: 18
Skipped / quarantined: 7
Warnings: 22
Blocking errors: 7
```

Use real package/manifest/canonical data.

If some metadata is missing, show a warning banner instead of crashing.

---

## 12. Publish Button in Preview

The preview must contain the only final publish action:

```text id="vhu4go"
Publish to Wifran DB
```

Button rules:

Enabled only when:

```text id="3mduaq"
extraction package loaded
manifest exists
manifest.extraction_status = completed
package validation passes
there is at least one eligible row
not already publishing
Supabase config is ready according to existing checks
```

Disabled when:

```text id="b9sf4h"
no eligible publish rows
manifest missing
extraction incomplete
package validation failed
currently publishing
Supabase config unavailable
```

Rows eligible for DB upload:

```text id="pkt2k9"
publish
publish_but_exclude_from_comparison
```

Rows not eligible:

```text id="uzdw4v"
skip_or_quarantine
```

---

## 13. Confirmation Dialog

When user clicks `Publish to Wifran DB`, show confirmation:

```text id="eymqsj"
Ready to publish to Wifran DB:

Will publish: 134
Will publish but exclude from comparison: 18
Skipped/quarantined: 7

Only eligible rows will be uploaded.
Skipped/quarantined rows will not be uploaded.

Proceed?

[Publish] [Cancel]
```

Do not start DB upload before confirmation.

---

## 14. DB Publish Action

After confirmation:

```text id="kg30qi"
set pre_publish_preview.status = approved
set approved_at
start existing Supabase image upload and DB upsert flow
upload only eligible rows
skip skip_or_quarantine rows
write DB update status to manifest/report
show progress
show success/failure summary
```

Use the existing DB sync service.

Do not duplicate the entire DB sync logic.

Add a wrapper/service only if needed to pass eligible rows.

Recommended new service if needed:

```text id="008lwj"
src/main/prepublish/prePublishApprovalService.ts
```

or:

```text id="6xm0w1"
src/main/workflow/prePublishWorkflow.ts
```

Its responsibilities:

```text id="a6wdcf"
load completed package
load canonical/decision data
build preview model
record preview opened
record approval
call existing DB sync with eligible rows only
write summary artifacts
```

---

## 15. Main Page Button Changes

Update `ImportPage.tsx`.

Required changes:

```text id="imkppf"
Remove or disable direct Update Database action from main page.
Add Pre-Publish Preview button after extraction completion.
Pre-Publish Preview opens the preview UI.
Start Extraction remains disabled when completed.
Continue Extraction remains available for incomplete packages.
```

If `autoRun` currently cascades into DB sync, stop the cascade at review/preview pending.

Pipeline should end at:

```text id="x1ldwh"
extraction completed / preview pending
```

not:

```text id="lk1q4y"
db update completed
```

unless the user approved in preview.

---

## 16. Existing `PreDbReviewSummary`

Chunk 40 found:

```text id="36xm2v"
src/renderer/src/components/review/PreDbReviewSummary.tsx
```

It currently provides a dry review table and/or `Proceed to DB Update`.

Modify it so it no longer bypasses preview.

Acceptable options:

### Option A: Replace direct DB update button

Change:

```text id="rmy7q9"
Proceed to DB Update
```

to:

```text id="8vi8dl"
Open Pre-Publish Preview
```

### Option B: Remove direct action

Remove/disable the button and use the new main `Pre-Publish Preview` button.

### Option C: Reuse component inside preview

If useful, reuse parts of `PreDbReviewSummary` for summary counts, but it must not be the final publish gate unless it displays the crop image grid and field tables.

---

## 17. Preview Data Source

The preview should be built from final canonical/decision data.

Preferred source order:

```text id="c32j0b"
canonical artifacts if saved
in-memory canonical results if current extraction just completed
raw JSON + normalizer + validation/decision metadata if artifacts must be reconstructed
```

Do not use unvalidated raw OCR fields alone for preview.

Preview cards should reflect the final state after:

```text id="uvqzta"
candidate extraction
canonical normalization
style-aware validation
deterministic checks
comparison-safety evaluation
publish decision engine
```

---

## 18. Preview Item Model

Create a preview model type.

Recommended file:

```text id="em68bi"
src/shared/types/prePublishPreview.ts
```

Recommended shape:

```ts id="ln0a8r"
export type PrePublishPreviewItem = {
  source_page_number: number | null;
  source_item_number: string;
  crop_path: string;
  crop_image_url?: string | null;

  publish_decision:
    | 'publish'
    | 'publish_but_exclude_from_comparison'
    | 'skip_or_quarantine';

  preview_eligible: boolean;
  display_in_preview: boolean;

  confidence: 'high' | 'medium' | 'low' | 'not_run';

  comparison_eligible: boolean;
  comparison_exclusion_reason: string | null;

  fields: Array<{
    field_name: string;
    value: string | number | boolean | null;
  }>;

  blocking_errors: Array<{
    code: string;
    message: string;
  }>;

  non_blocking_warnings: Array<{
    code: string;
    message: string;
  }>;

  raw?: {
    canonical?: Record<string, unknown>;
    raw_ocr_json?: Record<string, unknown>;
    raw_validation_json?: Record<string, unknown> | null;
  };
};

export type PrePublishPreviewSummary = {
  leaflet_id: string | null;
  package_name: string;
  supermarket_name: string | null;
  coverage_scope: string | null;
  location_label: string | null;
  offer_start_date: string | null;
  offer_end_date: string | null;

  counts: {
    total_items: number;
    publish: number;
    publish_but_exclude_from_comparison: number;
    skip_or_quarantine: number;
    warnings: number;
    blocking_errors: number;
    non_grocery: number;
  };

  items: PrePublishPreviewItem[];
};
```

Adapt to existing type conventions.

---

## 19. IPC / Preload

If this is an Electron app, add narrow IPC/preload actions.

Do not expose raw `ipcRenderer`.

Do not add generic filesystem IPC.

Recommended actions:

```text id="v1h2sj"
prePublishPreview:load
prePublishPreview:markOpened
prePublishPreview:publishApproved
prePublishPreview:getStatus
```

or similar existing project naming.

Expected behavior:

```text id="2ejqtb"
load → returns preview summary and items
markOpened → writes manifest preview opened status
publishApproved → records approval and invokes existing DB sync for eligible rows
getStatus → returns current publish progress/status
```

All actions must validate inputs.

Only allow paths under known extraction package roots.

Do not accept arbitrary filesystem paths from renderer unless the existing project has safe folder selection handling.

---

## 20. Manifest Integration

Update `extraction_manifest.json` safely.

Add or update:

```json id="gl8uqf"
{
  "pre_publish_preview": {
    "status": "not_opened",
    "opened_at": null,
    "approved_at": null,
    "approved_by": null,
    "summary": {
      "publish_count": 0,
      "publish_but_exclude_from_comparison_count": 0,
      "skip_or_quarantine_count": 0,
      "warning_count": 0,
      "blocking_error_count": 0
    }
  },
  "db_update_status": "not_started"
}
```

Allowed preview statuses:

```text id="x7h5kg"
not_opened
opened
approved
```

When preview opens:

```text id="o635ld"
status = opened
opened_at = now
summary = current preview counts
```

When user confirms publish:

```text id="0cy5v6"
status = approved
approved_at = now
summary = final preview counts
db_update_status = running
```

After DB update:

```text id="ffz4gt"
db_update_status = completed
```

or:

```text id="a7y5ev"
db_update_status = failed
```

Preserve existing manifest fields.

Do not break loading older manifests without `pre_publish_preview`.

Older manifests should default to:

```text id="nhm897"
pre_publish_preview.status = not_opened
db_update_status = not_started
```

---

## 21. Preview Summary Artifact

Write a local preview summary file when preview is generated/opened:

```text id="fey62u"
pre-publish-preview-summary.json
```

Recommended location:

```text id="y0x1df"
metadata/pre-publish-preview-summary.json
```

or package root if existing reports are stored there.

Suggested content:

```json id="wto2zf"
{
  "leaflet_id": "string",
  "created_at": "datetime",
  "counts": {
    "total_items": 0,
    "publish": 0,
    "publish_but_exclude_from_comparison": 0,
    "skip_or_quarantine": 0,
    "warnings": 0,
    "blocking_errors": 0,
    "non_grocery": 0
  },
  "items": [
    {
      "source_page_number": 1,
      "source_item_number": "001",
      "crop_path": "crops/page-001/item.webp",
      "publish_decision": "publish",
      "comparison_eligible": true,
      "comparison_exclusion_reason": null,
      "fields": {
        "title_ar": "string",
        "title_en": "string",
        "offer_price": 0,
        "original_price": 0
      },
      "warnings": [],
      "errors": []
    }
  ]
}
```

Do not overwrite raw OCR JSON.

Do not overwrite validation artifacts.

---

## 22. DB Gate Rules

The final DB upload gate must require:

```text id="pgro2m"
package loaded
manifest exists
manifest.extraction_status = completed
package validation passes
preview summary can be generated
user clicked Publish inside preview
confirmation accepted
required metadata valid
Supabase config ready
at least one eligible row
not currently publishing
```

The DB upload gate must not accept:

```text id="dhcq2s"
extraction completed but preview not opened
preview opened but Publish not clicked
main page direct DB button
autoRun cascade without approval
skip_or_quarantine rows
```

---

## 23. Eligible Rows

Only these decisions are eligible for upload/upsert:

```text id="6uvyoa"
publish
publish_but_exclude_from_comparison
```

These must not upload/upsert:

```text id="fijdjh"
skip_or_quarantine
```

If the existing DB sync service expects all rows, filter before calling it.

If the existing sync service already filters invalid rows, still apply explicit filtering at the pre-publish approval layer.

---

## 24. First Version Is Read-Only

Do not implement editing in this chunk.

Do not add:

```text id="sw5mcb"
inline field editing
manual override
force publish
force quarantine
revalidate item button
row selection
partial publish selection
```

This first version is:

```text id="zkpiwq"
review
filter
inspect
publish all eligible rows
cancel/close
```

Manual editing can be a future chunk.

---

## 25. Error Handling

If preview cannot load:

```text id="o92kxe"
show clear error
do not publish
do not mark approved
```

If one crop image is missing:

```text id="zeqg76"
show broken/missing image placeholder
mark item warning
do not crash preview
```

If publish fails:

```text id="yivpsm"
show failure summary
write db_update_status = failed
preserve approval status
preserve error details
allow retry if existing DB sync supports idempotent retry
```

If some eligible rows succeed and some fail:

```text id="fjve1a"
show partial success summary
write counts
preserve per-row error details if existing sync supports it
```

---

## 26. Progress UI

During publish:

```text id="lcly3i"
disable Publish button
show progress
show current stage:
  preparing
  uploading images
  upserting offers
  writing report
  completed
  failed
```

Use existing progress events if available.

Do not overbuild if existing sync service already has progress reporting.

---

## 27. Tests

Add or update tests.

Recommended tests:

```text id="l0xl66"
src/shared/utils/__tests__/prePublishPreviewBuilder.test.ts
src/renderer/src/components/prepublish/__tests__/PrePublishPreview.test.tsx
src/main/prepublish/__tests__/prePublishApprovalService.test.ts
```

Adapt paths to existing conventions.

Required test cases:

```text id="p8e13o"
preview summary includes all items
preview summary counts publish rows
preview summary counts publish_but_exclude rows
preview summary counts skip_or_quarantine rows
preview item includes crop path
preview item includes FIELD_NAME / VALUE rows
skip_or_quarantine rows display in preview but are not eligible
publish rows are eligible
publish_but_exclude rows are eligible
opening preview marks manifest status opened
opening preview does not call DB sync
Publish button confirmation is required
confirmed publish calls DB sync only with eligible rows
main page extraction completed does not trigger DB sync
autoRun does not bypass preview
old manifest without pre_publish_preview loads safely
publish failure writes db_update_status failed
```

Do not write tests that call real Mistral.

Do not write tests that call real Supabase.

Mock DB sync.

Mock filesystem where practical.

---

## 28. Documentation Update

Update relevant docs briefly if they exist:

```text id="biwbxe"
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
```

Document:

```text id="yzgayu"
after extraction completes, user must open Pre-Publish Preview
the preview shows each crop image with FIELD_NAME / VALUE extracted data
Publish to Wifran DB exists only inside the preview
opening the preview does not publish
only clicking Publish and confirming starts DB upload/upsert
skipped/quarantined rows are visible but not uploaded
first version is read-only
```

Do not claim manual editing exists.

---

## 29. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not add generic filesystem IPC.
* Do not upload images during tests.
* Do not run real Mistral calls during tests.
* Do not write to Wifran DB during tests.
* Do not publish real offers during this chunk.
* Do not delete files in `Extracts/`.
* Do not add DB migrations.
* Do not add new DB columns.
* Do not log secrets or env values.
* Do not expose arbitrary filesystem paths to renderer.

---

## 30. Acceptance Criteria

This chunk is complete when:

* Extraction completion no longer automatically triggers DB upload/upsert.
* Main page no longer allows direct DB update without preview approval.
* A `Pre-Publish Preview` action exists after completed extraction.
* Completed loaded extraction packages can open Pre-Publish Preview.
* Incomplete packages cannot publish.
* Preview displays a grid of crop images.
* Under each image, preview displays FIELD_NAME / VALUE rows.
* Preview shows final publish decision per item.
* Preview shows warning/error counts per item.
* Preview shows comparison eligibility per item.
* Preview has filters/tabs for All, Will Publish, Publish but Excluded, Skipped, Warnings, Blocking Errors, Non-Grocery.
* Preview has a summary header with publish/exclude/skipped counts.
* Publish to Wifran DB button exists only inside preview.
* Opening preview does not upload or upsert anything.
* Publish requires confirmation.
* Confirmed publish uploads/upserts only eligible rows.
* `skip_or_quarantine` rows are not uploaded/upserted.
* Manifest tracks preview opened/approved status.
* Manifest tracks DB update status.
* `pre-publish-preview-summary.json` is generated.
* Old manifests without preview fields still load safely.
* Existing Supabase upload/upsert implementation is reused.
* No DB schema changes are made.
* No real OCR/API/DB operation is run during tests.
* Tests are added or updated where practical.
* TypeScript compiles.

---

## 31. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the Pre-Publish Preview and approval-gate changes needed for this chunk, keep the app runnable, then stop.

Do not implement future chunks in this step.

---

## 32. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

files modified
files created
preview UI components added
main page button flow changes
DB auto-run/direct-update changes
manifest fields added
preview summary artifact path
how eligible rows are selected
how Publish inside preview calls existing DB sync
tests added/updated
commands run
commands skipped and why
risks or TODOs
recommended next chunk
```

The recommended next chunk should be:

49-accuracy-run-report-and-regression-fixtures.md