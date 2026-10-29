# Antigravity Prompt Chunk 55: Controlled Real-Publish Rehearsal With Sandbox or Tiny Package

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 55.

Chunks 41–54 should already have completed, including:

```text id="pyvalk"
52-manual-qa-dry-run-with-copied-extraction-package.md
53-representative-page-style-profile-selection-before-crop-editor.md
54-safe-local-verification-of-representative-style-profile-flow.md
```

This chunk prepares the app for a **controlled real-publish rehearsal**.

Do not publish automatically.

Do not run real publish without explicit operator action.

Do not call Mistral.

Do not run OCR.

Do not bypass Pre-Publish Preview.

The goal is to make the first real publish safe, limited, auditable, and reversible.

---

## 1. Purpose

After dry-run QA and representative style-profile verification pass, the next step is a tightly controlled publish rehearsal.

The rehearsal should use one of these options:

```text id="qsdmp9"
Preferred: sandbox Supabase project
Alternative: tiny verified production package with 1–5 rows only
```

This chunk adds safety checks, UI warnings, reports, and rehearsal tooling so the operator cannot accidentally publish a large unverified extraction package.

---

## 2. Read These Files First

Read the master accuracy package:

```text id="pr7e6o"
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read previous verification reports if they exist:

```text id="tmwjfa"
wifran-offers-extractor/antigravity-reports/51-safe-local-verification-report.md
wifran-offers-extractor/antigravity-reports/52-manual-qa-dry-run-report.md
wifran-offers-extractor/antigravity-reports/54-representative-style-profile-flow-verification-report.md
```

Inspect these files:

```text id="rj02pu"
src/renderer/src/components/prepublish/
src/renderer/src/components/styleProfile/
src/renderer/src/pages/ImportPage.tsx
src/main/prepublish/
src/main/db/offerSyncService.ts
src/main/db/offerSyncMapper.ts
src/main/storage/offerImageStorageService.ts
src/main/extraction/extractionManifestService.ts
src/main/reporting/accuracyRunReportService.ts
src/shared/types/prePublishPreview.ts
src/shared/types/publishDecision.ts
src/shared/types/styleProfile.ts
```

Adapt paths if the actual project structure differs.

---

## 3. Goal

Add a controlled real-publish rehearsal mode with:

```text id="y09omm"
explicit rehearsal mode
hard row-count limit
required dry-run report
required Pre-Publish Preview approval
required style-profile selection state
required typed confirmation
optional sandbox/production target warning
real-publish rehearsal report
manual reconciliation checklist
```

The app should make it difficult to publish:

```text id="sc4l4y"
the wrong package
too many rows
without representative style-profile step being generated or skipped
without preview approval
without a clean dry-run
without explicit typed confirmation
without report generation
```

---

## 4. Non-Goals

Do not:

```text id="au24cg"
call Mistral
run OCR
change extraction prompts
add DB migrations
add Supabase columns
redesign DB sync
delete extraction folders
publish automatically
bypass Pre-Publish Preview
bypass dry-run safeguards
```

This is a publish-safety and rehearsal-readiness chunk.

---

## 5. Preserve Existing Working Behavior

Preserve:

```text id="vmd1i7"
current representative page style-profile flow
current Pre-Publish Preview
current Dry Run Publish
current approval gate
current eligible-row filtering
current Supabase upload implementation
current DB upsert implementation
current metadata mapper
current accuracy reports
current QA dry-run reports
current manifest loading behavior
```

Do not change core upload/upsert logic unless needed for safety gating or reporting.

---

## 6. Rehearsal Mode

Add support for a controlled mode named:

```text id="szil5d"
PUBLISH_REHEARSAL_MODE=true
```

or an equivalent internal app setting.

When rehearsal mode is active:

```text id="se9321"
real publish is allowed only after all rehearsal gates pass
row count must be under the configured limit
typed confirmation is required
a real-publish rehearsal report must be written
```

Default should be safe:

```text id="u5r60p"
PUBLISH_REHEARSAL_MODE=false
```

Do not modify `.env.local`.

Do not require the variable to exist.

---

## 7. Row Limit

Add a hard row limit for rehearsal.

Recommended config:

```text id="v1asup"
PUBLISH_REHEARSAL_MAX_ROWS=5
```

Default:

```text id="j7iv3e"
5
```

Rules:

```text id="p7vrcx"
eligible rows > max rows → block real rehearsal publish
eligible rows <= max rows → allow only if all other gates pass
```

The error should be clear:

```text id="y69ply"
Publish rehearsal blocked: eligible row count exceeds rehearsal limit.
```

Do not provide a force override in this chunk.

---

## 8. Required Gates Before Real Publish Rehearsal

Before a real publish can start in rehearsal mode, verify:

```text id="id6gnv"
extraction package loaded
manifest exists
extraction status completed
representative style-profile step is generated or explicitly skipped
Pre-Publish Preview opened
Pre-Publish Preview approved
latest dry-run report exists
latest dry-run report says zero Supabase uploads
latest dry-run report says zero Supabase DB writes
accuracy-run-report.json exists
pre-publish-preview-summary.json exists
eligible row count > 0
eligible row count <= PUBLISH_REHEARSAL_MAX_ROWS
no skip_or_quarantine rows are included in upload payload
no blocking-error rows are included in upload payload
Supabase config is available
typed confirmation matches required phrase
```

Do not rely only on renderer UI.

Enforce these gates in the main-process pre-publish approval/publish service before upload/upsert starts.

---

## 9. Style-Profile Gate

Because Chunk 53 added representative page style-profile selection, the rehearsal gate must check:

```text id="qouiy8"
style_profile_selection.status = generated
```

or:

```text id="sjyf21"
style_profile_selection.status = skipped
```

If status is missing for a new package, block rehearsal with:

```text id="h6uazo"
Publish rehearsal blocked: representative page style-profile step has not been completed or skipped.
```

Older packages that already reached completed extraction before Chunk 53 should not be blocked automatically, but they must show a warning:

```text id="vwksbv"
This package was created before representative page style-profile selection. Verify manually before rehearsal.
```

---

## 10. Typed Confirmation

Add a typed confirmation requirement.

Required phrase:

```text id="c9lcb1"
PUBLISH VERIFIED REHEARSAL
```

The confirmation dialog should show:

```text id="u2o61b"
You are about to run a controlled real publish rehearsal.

Eligible rows: 3
Skipped/quarantined rows: 2
Target: Supabase
Mode: Rehearsal

This may upload images and upsert offers.

Type PUBLISH VERIFIED REHEARSAL to continue.
```

If the typed phrase does not match exactly, block publish.

---

## 11. Sandbox / Production Target Warning

Detect whether the app appears to be pointing to production or sandbox if possible.

Do not expose secrets.

If Supabase URL or project label indicates production, show:

```text id="m7umvi"
Warning: this appears to be a production Supabase target. Use only a tiny verified package.
```

If sandbox cannot be detected reliably, show:

```text id="v0zurz"
Supabase target could not be classified. Verify manually before publishing.
```

Do not block solely because classification is unknown, but require typed confirmation.

---

## 12. UI Changes

In Pre-Publish Preview, when rehearsal mode is active, show:

```text id="9zj1cj"
Real Publish Rehearsal Mode
```

Show:

```text id="u32835"
Eligible rows
Max rehearsal rows
Dry-run report status
Accuracy report status
Representative style-profile status
Supabase target classification
```

Button label:

```text id="x3eckb"
Run Real Publish Rehearsal
```

Do not show this button if dry-run mode is still active.

If both dry-run and rehearsal mode are active, prefer dry-run and block real publish with:

```text id="kpwv1k"
Real publish rehearsal is blocked because dry-run mode is enabled.
```

---

## 13. Prevent Large Publish

If eligible rows exceed the rehearsal limit:

```text id="rtnct7"
disable real rehearsal publish button
show explanation
allow dry-run only
```

Do not allow partial selection in this chunk.

Do not add force publish.

---

## 14. Real-Publish Rehearsal Report

Write a report after any rehearsal publish attempt.

Recommended path:

```text id="m3onb3"
metadata/reports/real-publish-rehearsal-report.json
```

Recommended shape:

```json id="tcdhkl"
{
  "schema_version": 1,
  "created_at": "datetime",
  "mode": "rehearsal",
  "package_name": "string",
  "eligible_rows": 0,
  "max_rows_allowed": 5,
  "target_classification": "sandbox | production | unknown",
  "gates": {
    "manifest_completed": true,
    "style_profile_step_completed_or_skipped": true,
    "preview_opened": true,
    "preview_approved": true,
    "dry_run_report_exists": true,
    "dry_run_report_clean": true,
    "accuracy_report_exists": true,
    "preview_summary_exists": true,
    "row_limit_passed": true,
    "typed_confirmation_passed": true
  },
  "result": {
    "status": "not_started | running | completed | failed | partial",
    "image_upload_success_count": 0,
    "image_upload_failure_count": 0,
    "db_upsert_success_count": 0,
    "db_upsert_failure_count": 0,
    "error_message": null
  },
  "items": [
    {
      "source_page_number": 1,
      "source_item_number": "001",
      "publish_decision": "publish",
      "image_upload_status": "success",
      "db_upsert_status": "success",
      "external_image_id": "string"
    }
  ]
}
```

Update `accuracy-run-report.json` after rehearsal if practical.

---

## 15. Manifest Integration

Update `extraction_manifest.json` safely.

Add or update:

```json id="26ns26"
{
  "real_publish_rehearsal": {
    "status": "not_started",
    "started_at": null,
    "completed_at": null,
    "report_path": null,
    "eligible_rows": 0,
    "max_rows_allowed": 5,
    "target_classification": "unknown",
    "error_message": null
  }
}
```

Allowed statuses:

```text id="rt1yw2"
not_started
blocked
running
completed
failed
partial
```

Older manifests without this field must load safely.

---

## 16. Optional Tiny Package Helper

If safe and practical, add a helper that creates a tiny rehearsal package from an existing completed QA package.

Example:

```text id="b8z0ga"
npm run qa:create-tiny-package -- --source Extracts_QA/Othaim_week24_qa --limit 5
```

The helper should:

```text id="dc0dyw"
copy only selected crop/json/canonical/validation/report artifacts
preserve manifest safely
mark package as rehearsal_candidate
not call Mistral
not upload images
not write to DB
not delete source files
```

If risky, skip this helper and document manual package creation.

---

## 17. Reconciliation Checklist

Create a markdown checklist:

```text id="puahf2"
wifran-offers-extractor/antigravity-reports/55-controlled-real-publish-rehearsal-checklist.md
```

Include:

```text id="4kiklm"
dry-run report reviewed
accuracy report reviewed
representative style-profile status reviewed
row count under limit
preview manually reviewed
Supabase target confirmed
typed confirmation used
publish result checked
uploaded images checked
DB rows checked
public app checked if applicable
rollback notes
known risks
```

---

## 18. Rollback / Cleanup Notes

Document rollback expectations.

Do not implement destructive rollback automatically.

The checklist should explain:

```text id="wbu7z1"
which rows were upserted
which image paths were uploaded
which external_image_id values were used
how to identify rehearsal rows
what to delete manually if rollback is needed
```

Do not add automatic delete behavior in this chunk.

---

## 19. Tests

Add or update tests.

Recommended test files:

```text id="7yfr3s"
src/main/prepublish/__tests__/realPublishRehearsalGate.test.ts
src/renderer/src/components/prepublish/__tests__/RealPublishRehearsal.test.tsx
src/main/prepublish/__tests__/realPublishRehearsalReport.test.ts
```

Required tests:

```text id="ndggel"
rehearsal publish blocked if preview not opened
rehearsal publish blocked if preview not approved
rehearsal publish blocked if dry-run report missing
rehearsal publish blocked if dry-run report shows Supabase writes
rehearsal publish blocked if accuracy report missing
rehearsal publish blocked if preview summary missing
rehearsal publish blocked if style-profile step missing for new package
rehearsal publish allowed if style-profile status generated
rehearsal publish allowed if style-profile status skipped
older completed package without style-profile status shows warning but does not crash
rehearsal publish blocked if eligible rows exceed max
rehearsal publish blocked if typed confirmation is wrong
rehearsal publish allowed when all gates pass
dry-run mode blocks real rehearsal publish
skip_or_quarantine rows are excluded
blocking-error rows are excluded
rehearsal report is written after mocked publish
production target warning appears when target classification is production
unknown target warning appears when target cannot be classified
```

Do not call real Supabase in tests.

Mock image upload.

Mock DB upsert.

Do not call Mistral.

---

## 20. Commands

Safe commands allowed:

```bash id="3mtmz3"
npm run typecheck
npm test
npm run test:accuracy
npm run verify:accuracy
```

Only run commands that are known not to call Mistral or Supabase.

Do not run real publish.

Do not run OCR.

Do not upload images.

---

## 21. Documentation Update

Update relevant docs if they exist:

```text id="e31v04"
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/accuracy-verification.md
```

Document:

```text id="v41fpq"
how to use rehearsal mode
how to set the max row limit
why sandbox Supabase is preferred
why tiny production rehearsal must be limited
how typed confirmation works
where real-publish-rehearsal-report.json is saved
that rollback is manual
that representative style-profile step should be generated or explicitly skipped before rehearsal
```

---

## 22. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not add generic filesystem IPC.
* Do not call Mistral.
* Do not run OCR.
* Do not upload images during tests.
* Do not write to Supabase during tests.
* Do not publish automatically.
* Do not delete files in `Extracts/`.
* Do not delete uploaded images automatically.
* Do not add DB migrations.
* Do not add new DB columns.
* Do not log secrets or env values.

---

## 23. Acceptance Criteria

This chunk is complete when:

* Controlled real-publish rehearsal mode exists.
* Rehearsal row limit exists and defaults to 5.
* Real rehearsal publish requires Pre-Publish Preview approval.
* Real rehearsal publish requires a clean dry-run report.
* Real rehearsal publish requires accuracy and preview summary reports.
* Real rehearsal publish checks representative style-profile step status.
* Real rehearsal publish requires typed confirmation.
* Real rehearsal publish is blocked if dry-run mode is active.
* Real rehearsal publish is blocked if eligible rows exceed max.
* Skip/quarantine rows are excluded.
* Blocking-error rows are excluded.
* Supabase target warning is shown where possible.
* Rehearsal publish report is written.
* Rehearsal checklist markdown report is created.
* No automatic rollback/delete is added.
* No DB schema changes are made.
* No tests call Mistral.
* No tests call real Supabase.
* TypeScript compiles.
* The app remains runnable.

---

## 24. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the controlled real-publish rehearsal safety changes needed for this chunk, keep the app runnable, then stop.

Do not perform an actual real publish in this step.

---

## 25. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="eriosu"
files modified
files created
rehearsal mode behavior
row limit behavior
style-profile gate behavior
typed confirmation behavior
target warning behavior
rehearsal report path
checklist path
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

```text id="0nr3zv"
Run one sandbox rehearsal first. If sandbox is unavailable, run a tiny production rehearsal with 1–5 manually verified rows only.