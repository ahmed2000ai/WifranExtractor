# Antigravity Prompt Chunk 59: Reconcile Harnesses After Page-Level Style Profile Migration

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 59.

Important context:

Chunks 57 and 58 were executed before Chunk 56.

Chunk 56 replaces the representative-page / leaflet-level style profile concept with page-level style profiling.

This chunk reconciles the offline accuracy harness and automatic runtime accuracy harness with the new page-level style profile architecture.

Do not publish offers.

Do not upload images.

Do not write to Supabase.

Do not call real Mistral during tests.

---

## 1. Read These Files First

Inspect the implementation results from:

```text
56-replace-representative-style-profile-with-page-level-profiling.md
57-offline-extraction-and-wifran-utilization-accuracy-harness.md
58-automatic-runtime-accuracy-harness-and-self-improving-quality-gate.md
```

Then inspect:

```text
src/shared/accuracy-harness/
src/shared/utils/runtimeAccuracyHarness.ts
src/main/accuracy/
src/main/reporting/
src/main/ocr/styleProfileService.ts
src/main/ocr/styleAwareItemValidationService.ts
src/main/ocr/styleAwareValidationPromptBuilder.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/extraction/extractionManifestService.ts
src/main/prepublish/
src/renderer/src/components/prepublish/
tests/fixtures/
```

Adapt paths if the actual project structure differs.

---

## 2. Goal

Remove any stale dependency on:

```text
representative pages
selected representative pages
leaflet-level style profile from 2–3 pages
leaflet-style-profile-selection.json
style_profile_selection gate
```

and replace it with:

```text
page-level style profile per page
metadata/style-profiles/page-001-style-profile.json
page_style_profiles manifest status
page-level style profile quality metrics
```

---

## 3. Required Behavior

The final architecture must be:

```text
page-level style profile is the primary style context
runtime harness checks page-level profile status
offline harness fixtures may include page_style_profile
publish gates check page_style_profiles, not representative selection
Pre-Publish Preview shows page profile status, not representative-page status
reports reference page_style_profiles
```

Validation priority must be:

```text
1. crop-specific visual evidence
2. page-level style profile
3. general Saudi leaflet heuristics
4. if unclear, do not approve publishing
```

---

## 4. Offline Harness Reconciliation

Update the offline harness from Chunk 57.

Fixture input should use:

```text
page_style_profile
```

not:

```text
leaflet_style_profile
representative_style_profile
selected_page_profile
```

If old fixture fields exist, support them only as backward-compatible deprecated aliases.

Preferred fixture shape:

```json
{
  "inputs": {
    "raw_mistral_response": {},
    "style_validation_response": {},
    "page_style_profile": {}
  }
}
```

Update harness runner so it passes page profile context into validation-related evaluation.

Update fixture docs.

---

## 5. Runtime Harness Reconciliation

Update runtime harness from Chunk 58.

It should inspect:

```text
manifest.page_style_profiles
```

not:

```text
manifest.style_profile_selection
```

Runtime harness input should include:

```text
pageStyleProfileStatus.mode
pageStyleProfileStatus.totalPagesWithCrops
pageStyleProfileStatus.completedPages
pageStyleProfileStatus.failedPages
pageStyleProfileStatus.missingPages
pageStyleProfileStatus.failures
```

Remove or deprecate representative-page summary fields.

Runtime gate should flag:

```text
missing page profile for page with publishable rows
failed page profile for page with publishable rows
page profile disabled while publishable rows exist
```

as warnings or review conditions depending severity.

---

## 6. Publish Gate Reconciliation

Update dry-run and real-rehearsal gates.

Remove gate:

```text
representative style-profile step is generated or skipped
```

Replace with:

```text
if PAGE_STYLE_PROFILE_MODE=all_pages:
  page_style_profiles.status must be completed or completed_with_warnings
  missing/failed pages with publishable rows must be shown in runtime harness report

if PAGE_STYLE_PROFILE_MODE=disabled:
  allow only with warning
```

Do not block older completed packages automatically, but show a warning.

---

## 7. Report Reconciliation

Update report services so these files include page-level profile status:

```text
accuracy-run-report.json
runtime-accuracy-harness-report.json
qa-dry-run-publish-report.json
real-publish-rehearsal-report.json
pre-publish-preview-summary.json if applicable
```

Required fields:

```text
page_style_profile_mode
page_style_profiles_status
page_style_profiles_completed_pages
page_style_profiles_failed_pages
page_style_profiles_missing_pages
page_style_profile_errors_by_page
```

Remove or mark deprecated:

```text
selected_style_profile_pages
leaflet_style_profile_generated
leaflet_style_profile_path
style_profile_selection_status
```

---

## 8. Pre-Publish Preview Reconciliation

Update preview summary to show:

```text
Page Style Profiles: completed / completed with warnings / missing / disabled
Completed pages
Failed pages
Missing pages
```

Remove UI text about:

```text
representative pages
selected style profile pages
leaflet-level representative profile
```

---

## 9. Tests to Update

Update or add tests for:

```text
offline harness accepts page_style_profile
offline harness no longer requires representative profile
runtime harness checks page_style_profiles status
runtime harness flags missing page profiles for publishable rows
dry-run gate does not require representative selection
real rehearsal gate does not require representative selection
reports include page profile status
Pre-Publish Preview shows page profile status
old manifests without page_style_profiles load safely
deprecated representative fields do not crash older packages
```

Do not call real Mistral.

Do not call Supabase.

---

## 10. Commands to Run

Run:

```bash
npm run typecheck
npm test
npm run harness:accuracy
```

Also run targeted tests if available:

```bash
npx vitest run src/shared/accuracy-harness src/main/accuracy src/main/prepublish src/main/reporting
```

Skip any command that may call Mistral or Supabase.

---

## 11. Acceptance Criteria

This chunk is complete when:

* Chunks 57/58 harnesses are aligned with page-level style profiling.
* No required runtime path depends on representative page selection.
* Offline harness uses `page_style_profile`.
* Runtime harness evaluates `page_style_profiles`.
* Dry-run and rehearsal gates check page profile status, not representative selection.
* Reports include page-level style profile status.
* Pre-Publish Preview shows page-level profile status.
* Older manifests still load safely.
* Tests pass.
* TypeScript compiles.
* `npm run harness:accuracy` passes.
* No real Mistral or Supabase calls are run.

---

## 12. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the reconciliation changes needed after late Chunk 56 execution, keep the app runnable, then stop.

Do not perform real OCR, real Mistral calls, Supabase upload, DB writes, or real publishing.

---

## 13. Final Response Required From Antigravity

After finishing, provide:

```text
files modified
files created
representative-profile references removed
page-level profile fields added
offline harness reconciliation summary
runtime harness reconciliation summary
publish gate reconciliation summary
report/UI reconciliation summary
tests added/updated
commands run
commands skipped and why
whether typecheck passed
whether tests passed
whether harness passed
confirmation no real Mistral/Supabase calls were run
remaining risks
recommended next step
```

The recommended next step should be:

```text
Run QA dry-run on a copied completed package only after typecheck, tests, and npm run harness:accuracy pass.