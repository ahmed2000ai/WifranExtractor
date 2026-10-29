# Antigravity Prompt Chunk 54: Safe Local Verification of Representative Style Profile Flow

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 54.

Chunks 41–53 should already have completed, including:

```text id="9iw39v"
52-manual-qa-dry-run-with-copied-extraction-package.md
53-representative-page-style-profile-selection-before-crop-editor.md
```

This chunk verifies the new representative-page style profile workflow added in Chunk 53.

The goal is to prove that the new operator flow works safely before moving to controlled real-publish rehearsal.

This chunk should **not** publish offers.

This chunk should **not** write to Supabase.

This chunk should **not** upload images.

This chunk should **not** run item crop OCR.

This chunk should **not** run DB sync.

Real Mistral calls should remain disabled by default during automated tests. If a manual Mistral style-profile smoke test is prepared, it must be clearly optional and operator-triggered only.

---

## 1. Read These Files First

Read the previous prompt:

```text id="v70xmk"
wifran-offers-extractor/antigravity-prompts/53-representative-page-style-profile-selection-before-crop-editor.md
```

Read the previous verification reports if present:

```text id="3atq3t"
wifran-offers-extractor/antigravity-reports/51-safe-local-verification-report.md
wifran-offers-extractor/antigravity-reports/52-manual-qa-dry-run-report.md
```

Then inspect these areas:

```text id="gmc9i8"
src/renderer/src/components/styleProfile/
src/renderer/src/pages/ImportPage.tsx
src/main/ocr/styleProfileService.ts
src/main/ocr/styleProfilePromptBuilder.ts
src/main/ocr/styleAwareItemValidationService.ts
src/main/ocr/styleAwareValidationPromptBuilder.ts
src/main/extraction/extractionManifestService.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/pdf/
src/main/ipc/
src/preload/
src/shared/types/styleProfile.ts
src/shared/schemas/styleProfileSchema.ts
src/main/reporting/accuracyRunReportService.ts
```

Adapt paths if the actual project structure differs.

---

## 2. Goal

Verify the full new pre-crop-editor style profiling flow:

```text id="eg49si"
Select PDF
→ render pages
→ show representative page selection screen
→ select 2–3 rendered pages
→ generate or skip leaflet-level style profile
→ save selection metadata
→ update manifest
→ open crop editor only after generated/skipped
→ style-aware validation can later load leaflet-level profile
```

This chunk should add tests, mock verification, and a manual QA report.

---

## 3. Non-Goals

Do not:

```text id="x9s51v"
run item crop OCR
run full extraction
call real Mistral in automated tests
upload images to Supabase
write to Supabase DB
publish offers
change DB schema
add migrations
delete extraction folders
```

---

## 4. Required Automated Tests

Add or update tests for the representative page selection flow.

Recommended test files:

```text id="n39u8s"
src/renderer/src/components/styleProfile/__tests__/RepresentativePageSelection.test.tsx
src/main/ocr/__tests__/leafletStyleProfileService.test.ts
src/main/ocr/__tests__/styleProfilePromptBuilder.leaflet.test.ts
src/main/extraction/__tests__/styleProfileSelectionManifest.test.ts
src/main/ocr/__tests__/styleAwareValidationWithLeafletProfile.test.ts
```

Use the project’s actual test conventions.

Required test cases:

```text id="y9pu7h"
default selection chooses first/middle/last page when possible
valid selection accepts 2 pages
valid selection accepts 3 pages
invalid selection rejects 0 pages
invalid selection rejects 1 page for multi-page leaflets
invalid selection rejects more than 3 pages
one-page leaflet allows 1 page
Generate button disabled until valid selection
Skip requires confirmation
style profile generation uses shared queue kind style_profile
leaflet profile prompt includes selected page numbers
leaflet profile prompt says do not extract final item data
leaflet profile prompt warns size/content values are not prices
leaflet profile artifact path is metadata/style-profiles/leaflet-style-profile.json
selection metadata path is metadata/style-profiles/leaflet-style-profile-selection.json
manifest stores selected_page_numbers
manifest status becomes generated after successful mocked generation
manifest status becomes skipped after skip
manifest status becomes failed after mocked generation failure
older manifests without style_profile_selection load safely
crop editor blocked before generated/skipped status for new package
crop editor allowed after generated status
crop editor allowed after skipped status
existing completed packages are not retroactively blocked
style-aware validation prompt includes leafletStyleProfile when available
style-aware validation handles null leafletStyleProfile
QA/dry-run mode does not auto-call Mistral
```

Do not call real Mistral in these tests.

Mock the Mistral provider.

Mock filesystem where practical.

---

## 5. Mock Leaflet Style Profile Fixture

Create a small mock leaflet style profile fixture for tests.

Recommended path:

```text id="rxh9pe"
tests/fixtures/style-profiles/mock-leaflet-style-profile.json
```

or the project’s existing fixture folder.

The fixture should include:

```json id="lg5i8v"
{
  "schema_version": 1,
  "scope": "leaflet",
  "page_number": null,
  "selected_page_numbers": [1, 12, 24],
  "confidence": "medium",
  "offer_price_patterns": [],
  "original_price_patterns": [],
  "size_patterns": [],
  "promotion_patterns": [],
  "condition_patterns": [],
  "non_price_attribute_patterns": [],
  "warnings": [],
  "notes": ["Mock profile for tests only"],
  "raw_model_response": null
}
```

Adapt fields to the final schema.

---

## 6. Manual QA Report

Create a markdown report:

```text id="wy26tx"
wifran-offers-extractor/antigravity-reports/54-representative-style-profile-flow-verification-report.md
```

The report should include:

```text id="jx8i5h"
files inspected
tests added
commands run
commands skipped
mock verification results
manual verification checklist
risks/open issues
recommended next step
```

---

## 7. Manual Verification Checklist

Add this checklist to the report:

```text id="tv0417"
[ ] App opens without errors
[ ] Select PDF works
[ ] Pages render successfully
[ ] Representative page selection screen appears before crop editor
[ ] Rendered page thumbnails display
[ ] Default suggested pages are reasonable
[ ] Selecting 2 pages is allowed
[ ] Selecting 3 pages is allowed
[ ] Selecting more than 3 pages is blocked
[ ] Generate button is disabled until valid selection
[ ] Skip Style Profile asks for confirmation
[ ] Generated profile saves leaflet-style-profile.json
[ ] Selection metadata saves leaflet-style-profile-selection.json
[ ] Manifest records selected page numbers
[ ] Crop editor opens after generated profile
[ ] Crop editor opens after explicit skip
[ ] Existing completed packages still open
[ ] QA/dry-run mode does not auto-call Mistral
[ ] No Supabase upload occurs
[ ] No DB write occurs
```

Do not perform real publishing.

---

## 8. Optional Manual Mistral Smoke Test

Prepare documentation for an optional manual smoke test, but do not run it automatically.

The optional test is:

```text id="qowqro"
Use a copied QA package.
Render pages.
Select 2–3 representative pages.
Click Generate Leaflet Style Profile.
Confirm one Mistral style-profile call is made through the shared queue.
Confirm the profile artifact is saved.
Confirm crop editor opens.
```

Add this warning:

```text id="a6gqia"
This optional smoke test calls Mistral and consumes API quota. Do not run it as part of automated tests.
```

Do not call Mistral during automated verification.

---

## 9. Accuracy Report Integration Check

Verify that `accuracy-run-report.json` can include:

```text id="8dig5d"
style_profile_selection_status
selected_style_profile_pages
leaflet_style_profile_generated
leaflet_style_profile_path
style_profile_generation_error
```

If fields are missing, add them.

Do not change unrelated report behavior.

---

## 10. QA/Dry-Run Integration Check

Verify that Chunk 52 dry-run behavior still works after adding the representative page flow.

Required behavior:

```text id="9621tc"
QA/dry-run does not auto-call Mistral
QA package with leaflet-style-profile.json shows profile exists
QA package without leaflet-style-profile.json shows warning
QA preview remains available
Dry Run Publish remains safe
```

Add tests if practical.

---

## 11. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not add generic filesystem IPC.
* Do not upload images to Supabase.
* Do not write to Supabase.
* Do not publish offers.
* Do not delete extraction folders.
* Do not log image base64.
* Do not log Mistral request bodies containing images.
* Do not call real Mistral during automated tests.
* Do not call real Supabase during tests.
* Do not add DB migrations.
* Do not add new DB columns.

---

## 12. Commands

Safe commands allowed:

```bash id="js390u"
npm run typecheck
npm test
npm run test:accuracy
npm run verify:accuracy
```

Only run commands that are known not to call Mistral or Supabase.

If a command might call external services, skip it and explain why.

---

## 13. Acceptance Criteria

This chunk is complete when:

* Representative page selection tests exist.
* Leaflet style profile service tests exist with mocked Mistral.
* Manifest status tests exist.
* Crop editor gating tests exist.
* Style-aware validation can receive leaflet-level style profile.
* QA/dry-run mode does not auto-call Mistral.
* Accuracy report includes style-profile selection metadata.
* A mock leaflet style profile fixture exists.
* Verification report exists at:

```text id="5fx727"
wifran-offers-extractor/antigravity-reports/54-representative-style-profile-flow-verification-report.md
```

* No automated test calls real Mistral.
* No automated test calls Supabase.
* No upload or DB write occurs.
* TypeScript compiles.
* The app remains runnable.

---

## 14. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the verification, tests, fixtures, and small hardening fixes needed for this chunk, keep the app runnable, then stop.

Do not perform a real Mistral call, real extraction, or real DB publish during automated verification.

---

## 15. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="ij6z0p"
files modified
files created
tests added/updated
mock fixture path
verification report path
commands run
commands skipped and why
whether typecheck passed
whether tests passed
confirmation that no real Mistral/Supabase calls were run
remaining risks
recommended next step
```

The recommended next step should be:

Run one manual UI smoke test with a copied QA package: render pages, select 2–3 representative pages, generate the leaflet style profile, confirm crop editor opens, then stop before OCR/DB publish.