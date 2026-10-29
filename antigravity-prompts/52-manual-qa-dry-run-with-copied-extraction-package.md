# Antigravity Prompt Chunk 52: Manual QA Dry Run With Copied Extraction Package

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 52.

Chunks 41–51 should already have completed:

```text id="avz7y6"
41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
42-canonical-offer-normalizer-and-legacy-field-mapper.md
43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md
44-adaptive-style-profile-generation.md
45-style-aware-validation-call-for-every-item.md
46-deterministic-price-size-and-publishing-sanity-checks.md
47-comparison-safety-and-publish-decision-engine.md
48-pre-publish-preview-and-human-publish-approval-gate.md
49-accuracy-run-report-and-regression-fixtures.md
50-supabase-metadata-mapping-for-extraction-quality.md
51-end-to-end-safe-local-verification-with-fixtures.md
```

This chunk prepares and performs a safe manual QA pass using a copied local extraction package.

The goal is to verify the real app UI and real package loading flow without accidentally calling Mistral, uploading images, or writing to Supabase.

Do not publish real offers in this chunk.

Do not call Mistral in this chunk.

Do not upload images in this chunk.

Do not write to Supabase in this chunk.

---

## 1. Purpose

Fixture tests are necessary but not enough.

This chunk verifies the upgraded workflow in the actual app UI:

```text id="cbmgny"
load existing extraction package
validate manifest/package state
open Pre-Publish Preview
render crop image grid
render FIELD_NAME / VALUE tables
show decisions, warnings, errors, comparison status
confirm skipped rows are visible but not eligible
confirm Publish is blocked unless approval rules pass
confirm dry-run publish does not write to Supabase
generate manual QA report
```

The safest manual QA package is a copied local extraction folder, not the original working package.

---

## 2. Read These Files First

Read the master accuracy package:

```text id="qlgwzc"
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read the Chunk 40 inspection report:

```text id="qnnz4x"
wifran-offers-extractor/antigravity-reports/40-current-ocr-pipeline-inspection-report.md
```

Read the Chunk 51 verification report if it exists:

```text id="yntcp4"
wifran-offers-extractor/antigravity-reports/51-safe-local-verification-report.md
```

Then inspect current implementations from Chunks 48–51, especially:

```text id="cbf8sr"
src/renderer/src/pages/ImportPage.tsx
src/renderer/src/components/prepublish/
src/main/prepublish/
src/main/extraction/extractionManifestService.ts
src/main/reporting/
src/main/db/offerSyncService.ts
src/main/db/offerSyncMapper.ts
src/main/storage/offerImageStorageService.ts
src/shared/types/prePublishPreview.ts
src/shared/types/accuracyRunReport.ts
```

Adapt paths if the actual project structure differs.

---

## 3. Goal

Add a safe QA workflow that supports:

```text id="ambreb"
copying an extraction package into a QA sandbox folder
loading the copied package in the app
opening Pre-Publish Preview
running a dry-run publish simulation
verifying eligible-row filtering
verifying report generation
verifying no real external side effects
writing a manual QA report
```

This chunk should make accidental real publish difficult during QA.

---

## 4. Non-Goals

Do not:

```text id="orwx5d"
call Mistral
run OCR
upload images to Supabase
upsert offers to Supabase
delete extraction folders
change production DB schema
add migrations
add Supabase columns
edit OCR prompt
rewrite the extraction pipeline
```

This is a QA/dry-run hardening chunk.

---

## 5. Preserve Existing Working Behavior

Preserve:

```text id="sce7ck"
current extraction package structure
current crop filenames
current JSON filenames
current canonical artifacts
current validation artifacts
current Pre-Publish Preview UI
current manifest behavior
current Supabase upload/upsert implementation
current accuracy report generation
```

Only add safe dry-run/manual QA support and small fixes needed for UI verification.

---

## 6. QA Sandbox Package Copy

Add or document a safe way to copy an existing extraction package to a QA-only location.

Recommended QA folder:

```text id="gm9rys"
Extracts_QA/
```

Example:

```text id="z50pmk"
Extracts/Othaim_week24
→ Extracts_QA/Othaim_week24_qa
```

Rules:

```text id="4c52qy"
Never delete the original package.
Never modify the original package during QA.
Use copied package for QA.
Mark copied package as qa_mode if manifest supports it.
```

If adding a helper script is practical, add:

```text id="zncd7d"
npm run qa:copy-extraction -- --source Extracts/Othaim_week24 --name Othaim_week24_qa
```

The helper must:

```text id="61y6cb"
copy files only
not call Mistral
not upload images
not write to DB
not delete source files
```

If adding a script is risky, document manual copy steps instead.

---

## 7. Dry-Run Publish Mode

Add or verify a dry-run publish mode.

Recommended config:

```text id="npwqcz"
PUBLISH_DRY_RUN=true
```

or an internal UI/dev toggle:

```text id="h465o2"
Dry Run Publish
```

Default for QA should be:

```text id="v7e0s0"
dry run enabled
```

Dry-run publish must:

```text id="3drfni"
build the same eligible rows that real publish would build
run the same payload mapping logic
run the same approval gate checks
skip skip_or_quarantine rows
produce a simulated publish result
write dry-run report artifacts
not call Supabase upload
not call Supabase DB upsert
not upload images
not mutate public DB state
```

Dry-run publish should clearly show:

```text id="0zvr9e"
DRY RUN — no data was uploaded to Supabase.
```

---

## 8. Hard Safety Gate Against Accidental DB Writes

During QA mode, real DB publish must be blocked unless explicitly disabled by the operator.

Add defense-in-depth:

```text id="nws1gk"
if package is qa_mode and dry_run is enabled:
  block real Supabase upload/upsert
```

If a user somehow clicks a real publish action while dry-run is enabled, throw:

```text id="4qmx75"
Publish blocked: QA dry-run mode is enabled. No Supabase writes were performed.
```

Do not rely only on the UI.

Enforce this in the main-process publish/approval service before upload/upsert starts.

---

## 9. Manual QA UI Requirements

When loading a QA package:

```text id="hztfjd"
show package name
show QA/dry-run badge
show extraction status
show preview status
show DB update status
```

In Pre-Publish Preview:

```text id="9zi8lt"
show DRY RUN badge if dry-run mode is active
show crop image grid
show FIELD_NAME / VALUE rows
show decision badges
show warning/error counts
show comparison eligibility
show skipped/quarantined rows
show Publish button as Dry Run Publish if dry-run mode is active
```

Button label in dry-run mode:

```text id="r0zuqr"
Dry Run Publish
```

Confirmation dialog in dry-run mode:

```text id="f8a02f"
Dry run publish simulation:

Will publish: 134
Will publish but exclude from comparison: 18
Skipped/quarantined: 7

No images will be uploaded.
No offers will be written to Supabase.

Proceed with dry run?

[Run Dry Publish] [Cancel]
```

---

## 10. Dry-Run Publish Result

Dry-run result should include:

```text id="s0cww3"
eligible row count
publish count
publish_but_exclude count
skip/quarantine count
would-upload image count
would-upsert offer count
filtered row count
sample payload count
unsupported metadata fields count
validation errors if any
```

Do not include secrets.

Do not include full service-role config.

Do not include raw image base64.

---

## 11. Dry-Run Report Artifact

Write a QA dry-run report:

```text id="2qathf"
metadata/reports/qa-dry-run-publish-report.json
```

Recommended shape:

```json id="cw51g5"
{
  "schema_version": 1,
  "created_at": "datetime",
  "qa_mode": true,
  "dry_run": true,
  "package_name": "Othaim_week24_qa",
  "source_package_name": "Othaim_week24",
  "counts": {
    "total_items": 0,
    "eligible_rows": 0,
    "publish": 0,
    "publish_but_exclude_from_comparison": 0,
    "skip_or_quarantine": 0,
    "would_upload_images": 0,
    "would_upsert_offers": 0,
    "filtered_rows": 0
  },
  "safety": {
    "mistral_calls_made": 0,
    "supabase_uploads_made": 0,
    "supabase_db_writes_made": 0,
    "real_publish_blocked": true
  },
  "items": [
    {
      "source_page_number": 1,
      "source_item_number": "001",
      "publish_decision": "publish",
      "preview_eligible": true,
      "would_upload_image": true,
      "would_upsert_db": true,
      "comparison_eligible": true,
      "comparison_exclusion_reason": null,
      "blocking_errors": [],
      "warnings": []
    }
  ]
}
```

---

## 12. Manual QA Report

Create a markdown QA report:

```text id="qgco7l"
wifran-offers-extractor/antigravity-reports/52-manual-qa-dry-run-report.md
```

Include:

```text id="tv3ljl"
QA package used
whether dry-run mode was enabled
whether preview opened
whether crop grid rendered
whether FIELD_NAME / VALUE rows rendered
whether filters worked
whether skipped rows were visible
whether skipped rows were excluded from publish payload
whether DB sync was blocked without approval
whether dry-run publish produced expected report
commands run
manual checks still required
risks/open issues
```

---

## 13. Manual QA Checklist

Add this checklist to the report:

```text id="qjbcrn"
[ ] App opens without errors
[ ] QA extraction package loads
[ ] Original extraction package remains untouched
[ ] Manifest loads
[ ] Extraction status is completed or clearly shows incomplete
[ ] Pre-Publish Preview button is enabled only for completed packages
[ ] Pre-Publish Preview opens
[ ] Crop image grid displays
[ ] Every visible card has FIELD_NAME / VALUE rows
[ ] Decision badges display
[ ] Comparison badges display
[ ] Warning/error counts display
[ ] All / Will Publish / Excluded / Skipped / Warnings / Errors / Non-Grocery filters work
[ ] Skipped/quarantined rows are visible
[ ] Skipped/quarantined rows are not eligible for publish
[ ] Opening preview does not publish
[ ] Dry Run Publish requires confirmation
[ ] Dry Run Publish does not call Supabase upload
[ ] Dry Run Publish does not call Supabase DB upsert
[ ] Dry-run report is generated
[ ] Accuracy report is generated/updated
[ ] No Mistral calls were made
[ ] No Supabase writes were made
[ ] No secrets were logged
```

---

## 14. Optional Mock Counters

If feasible, add counters or test hooks to prove:

```text id="o3d8n7"
Mistral calls made = 0
Supabase uploads made = 0
Supabase DB writes made = 0
```

In dry-run mode, expose these only in local QA logs/reports.

Do not expose secrets or raw payloads.

---

## 15. Tests

Add or update tests.

Recommended test files:

```text id="p4u5qi"
src/main/prepublish/__tests__/dryRunPublish.test.ts
src/main/prepublish/__tests__/qaPackageSafety.test.ts
src/renderer/src/components/prepublish/__tests__/PrePublishPreviewDryRun.test.tsx
```

Required tests:

```text id="8mxmk4"
QA dry-run publish does not call image upload
QA dry-run publish does not call DB upsert
QA dry-run publish returns would_upload/would_upsert counts
QA dry-run filters skip_or_quarantine rows
QA dry-run includes publish_but_exclude rows as eligible
QA package with dry_run blocks real publish
preview shows dry-run badge
preview button label changes to Dry Run Publish
opening preview does not call publish
dry-run confirmation required
qa-dry-run-publish-report.json is written
original package path is not modified by QA copy helper
```

Do not call real Mistral.

Do not call real Supabase.

Mock filesystem where practical.

---

## 16. Commands

Safe commands allowed:

```bash id="126eza"
npm run typecheck
npm test
npm run test:accuracy
npm run verify:accuracy
```

Only run commands that are confirmed not to call Mistral or Supabase.

If a command might call external services, skip it and explain why.

Do not run extraction.

Do not run real publish.

---

## 17. Documentation Update

Update relevant docs if they exist:

```text id="vuqf1x"
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/accuracy-verification.md
```

Document:

```text id="923yjc"
how to copy an extraction package for QA
how to enable dry-run publish mode
how to open Pre-Publish Preview safely
how to run dry-run publish
where qa-dry-run-publish-report.json is saved
that dry-run publish does not upload or write to DB
how to move from QA to real publish only after visual confirmation
```

---

## 18. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not add generic filesystem IPC.
* Do not call Mistral.
* Do not upload images.
* Do not write to Supabase.
* Do not publish real offers.
* Do not delete files in `Extracts/`.
* Do not modify original extraction package during QA.
* Do not add DB migrations.
* Do not add new DB columns.
* Do not log secrets or env values.
* Do not store unsafe absolute local paths in public DB payloads.

---

## 19. Acceptance Criteria

This chunk is complete when:

* There is a safe QA/dry-run workflow.
* A copied QA extraction package can be used without modifying the original.
* Dry-run mode prevents real Supabase upload/upsert.
* Pre-Publish Preview clearly shows dry-run mode.
* Dry Run Publish requires confirmation.
* Dry Run Publish produces would-upload/would-upsert counts.
* Dry Run Publish excludes skip_or_quarantine rows.
* Dry Run Publish includes publish and publish_but_exclude rows as eligible.
* A dry-run report is written to:

```text id="rms45q"
metadata/reports/qa-dry-run-publish-report.json
```

* A manual QA markdown report is created at:

```text id="bxn5zm"
wifran-offers-extractor/antigravity-reports/52-manual-qa-dry-run-report.md
```

* No real Mistral calls are made.
* No real Supabase uploads are made.
* No real DB writes are made.
* No extraction folders are deleted.
* Tests are added or updated where practical.
* TypeScript compiles.
* The app remains runnable.

---

## 20. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the manual QA dry-run hardening changes needed for this chunk, keep the app runnable, then stop.

Do not implement future chunks in this step.

---

## 21. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="4dc59z"
files modified
files created
QA/dry-run behavior added
dry-run report path
manual QA report path
tests added/updated
commands run
commands skipped and why
whether typecheck passed
whether tests passed
confirmation that no real Mistral/Supabase calls were run
remaining risks
recommended next step
```

The recommended next step should be:

```text id="7vpc2j"
Run manual QA in the app with a copied extraction package, then inspect the dry-run report before any real publish.