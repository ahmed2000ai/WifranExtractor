# Antigravity Prompt Chunk 56: Replace Representative Page Style Profile With Per-Page Style Profiling

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 56.

Chunks 41–55 should already have completed or partially completed, including:

```text id="azsqak"
53-representative-page-style-profile-selection-before-crop-editor.md
54-safe-local-verification-of-representative-style-profile-flow.md
55-controlled-real-publish-rehearsal-with-sandbox-or-tiny-package.md
```

This chunk supersedes the representative-page selection concept from Chunks 53 and 54.

The new decision is:

```text id="bnzafb"
Remove the representative pages concept.
Remove the representative page selection screen.
Do not require the operator to choose 2–3 pages.
Generate a page-level style profile for every rendered leaflet page.
Use each page’s own style profile when validating item crops from that page.
```

The user is willing to accept the extra Mistral API calls because accuracy is more important than cost or speed.

This chunk must not publish offers.

This chunk must not write to Supabase.

This chunk must not upload images.

This chunk must not call Mistral during automated tests.

---

## 1. Why This Change Is Needed

The Othaim leaflet can use different styling on different pages.

Examples:

```text id="03d700"
Page 1: red/green offer styling with large red prices and green labels.
Page 2: Coca-Cola red-background campaign page with green price boxes.
Page 3: yellow Best Offers layout with large red prices.
Page 4: gold/brown Iktisab layout with gold price blocks.
```

A leaflet-level profile from 2–3 pages can become too broad or misleading.

A page-level profile for each page is more accurate because item crops on that page should be interpreted using that page’s own visual conventions.

---

## 2. Read These Files First

Read previous style/profile prompts and reports:

```text id="m5imcu"
wifran-offers-extractor/antigravity-prompts/44-adaptive-style-profile-generation.md
wifran-offers-extractor/antigravity-prompts/45-style-aware-validation-call-for-every-item.md
wifran-offers-extractor/antigravity-prompts/53-representative-page-style-profile-selection-before-crop-editor.md
wifran-offers-extractor/antigravity-prompts/54-safe-local-verification-of-representative-style-profile-flow.md
wifran-offers-extractor/antigravity-reports/54-representative-style-profile-flow-verification-report.md
```

Then inspect current implementation:

```text id="khxcoz"
src/renderer/src/components/styleProfile/
src/renderer/src/pages/ImportPage.tsx
src/main/ocr/styleProfileService.ts
src/main/ocr/styleProfilePromptBuilder.ts
src/main/ocr/styleAwareItemValidationService.ts
src/main/ocr/styleAwareValidationPromptBuilder.ts
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/pdf/
src/main/extraction/extractionManifestService.ts
src/main/reporting/accuracyRunReportService.ts
src/main/prepublish/
src/main/ipc/
src/preload/
src/shared/types/styleProfile.ts
src/shared/schemas/styleProfileSchema.ts
```

Adapt paths if the actual project structure differs.

---

## 3. Goal

Replace the workflow with:

```text id="u9lj50"
Select PDF
→ render pages
→ open crop editor normally
→ before item OCR/validation for each page:
     generate or load page-level style profile for that page
→ process that page’s item crops using:
     crop-specific evidence
     page-level style profile
     general Saudi leaflet heuristics
```

The required profile priority is now:

```text id="59bgu7"
1. Crop-specific visual evidence
2. Page-level style profile for the crop’s source page
3. General Saudi leaflet heuristics
4. If unclear, do not approve publishing
```

Remove leaflet-level representative-page fallback from the main logic.

---

## 4. Non-Goals

Do not:

```text id="ioe7cp"
add representative page selection
require manual page selection
create leaflet-level profile from selected pages
call Mistral during tests
run item OCR during tests
upload images
write to Supabase
publish offers
add DB migrations
add DB columns
delete extraction folders
```

---

## 5. Remove / Disable Representative Page Selection UI

Remove or disable the UI added for representative page selection.

Likely files:

```text id="ezdnxx"
src/renderer/src/components/styleProfile/RepresentativePageSelection.tsx
src/renderer/src/components/styleProfile/RepresentativePageCard.tsx
src/renderer/src/components/styleProfile/StyleProfileSelectionSummary.tsx
src/renderer/src/pages/RepresentativeStyleProfilePage.tsx
```

If these files exist and are no longer used, remove them or leave them unused only if deletion is risky.

Remove buttons such as:

```text id="zvlp6b"
Generate Leaflet Style Profile
Skip Style Profile
Select Representative Pages
```

Remove the workflow gate that blocks the crop editor until representative pages are generated or skipped.

The crop editor should not be blocked by representative page selection anymore.

---

## 6. Page-Level Style Profile Mode

Add or standardize config:

```text id="6u4pc4"
PAGE_STYLE_PROFILE_MODE=all_pages
```

Supported values:

```text id="tbxq7z"
all_pages
disabled
```

Default:

```text id="u3fwiv"
all_pages
```

Meaning:

```text id="kgxazl"
all_pages:
  generate/load one style profile per rendered page before processing that page’s item crops

disabled:
  skip page-level style profiling and let validation rely on crop-specific evidence and heuristics
```

Do not require the env var to exist.

Do not modify `.env.local`.

---

## 7. Page-Level Style Profile Artifacts

For each rendered page, save:

```text id="mo2k5v"
metadata/style-profiles/page-001-style-profile.json
metadata/style-profiles/page-002-style-profile.json
metadata/style-profiles/page-003-style-profile.json
```

The profile must have:

```text id="wb362y"
scope = page
page_number = actual page number
source_image_path = rendered page image path
```

Do not write or require:

```text id="mi9bn2"
metadata/style-profiles/leaflet-style-profile.json
metadata/style-profiles/leaflet-style-profile-selection.json
```

If these old artifacts exist from previous experiments, leave them alone but do not depend on them.

---

## 8. Page-Level Style Profile Service

Update or create service functions.

Recommended function:

```ts id="nzq509"
export async function generatePageStyleProfile(input: {
  leafletId?: string | null;
  pageNumber: number;
  pageImagePath: string;
  extractionPackagePath: string;
  forceRegenerate?: boolean;
}): Promise<LeafletStyleProfile>
```

Add helper:

```ts id="czbk3t"
export async function loadOrGeneratePageStyleProfile(input: {
  leafletId?: string | null;
  pageNumber: number;
  pageImagePath: string;
  extractionPackagePath: string;
  forceRegenerate?: boolean;
}): Promise<LeafletStyleProfile | null>
```

Behavior:

```text id="zerxtd"
if PAGE_STYLE_PROFILE_MODE=disabled:
  return null

if page profile JSON already exists and forceRegenerate is false:
  load and validate it

otherwise:
  call Mistral through shared queue
  save page profile JSON
  return profile
```

The Mistral queue metadata must be:

```ts id="a0hoax"
{
  kind: 'style_profile',
  label: 'Page style profile',
  pageNumber
}
```

Do not bypass the shared queue.

---

## 9. Page-Level Style Profile Prompt

Use the existing style profile schema, but the prompt should be page-specific.

The prompt should say:

```text id="ns6h0o"
You are analyzing one rendered page from a Saudi supermarket leaflet.

Your task is to infer temporary visual style guidance for this page only.

Do not extract final item data.
Do not create permanent supermarket rules.
Do not infer rules for other pages.

Identify the page’s visual patterns for:
- current offer prices
- old/original/crossed-out prices
- size/content values
- pack and bundle indicators
- promotion badges
- condition labels
- non-price product attributes

Use visual evidence from this page only.

Return strict valid JSON only.
```

The prompt must explicitly warn:

```text id="glr0ff"
1.5L, 730ml, 10kg, 8×135g, 30PCS, inch sizes, 4K, HD, LED are not prices.
```

The output must conform to the existing `LeafletStyleProfile` schema.

Set:

```text id="fhs7i9"
scope = page
page_number = current page number
```

---

## 10. Workflow Integration

Integrate page profiling into the item OCR/validation workflow.

Preferred page-level flow:

```text id="wq2215"
for each page with item crops:
  load or generate page-XXX-style-profile.json
  for each crop on that page:
    run item extraction
    normalize to canonical
    run style-aware validation with pageStyleProfile
```

Do not generate page profiles for pages with no item crops unless the current architecture makes this simpler.

If crop boxes are known only after manual crop editing, generate page profiles after crop layout exists and before OCR starts.

If the workflow processes crops sequentially by page, generate/load the page profile once per page and reuse it for all crops on that page.

If the workflow processes crops globally, group by page first or cache page profiles so each page is profiled only once.

---

## 11. UI Behavior

Remove representative selection step from the UI.

The crop editor should open after page rendering without requiring style-profile selection.

When OCR/extraction begins, show progress such as:

```text id="u9hntq"
Generating page style profile 1 / 54
Page style profile saved: page 001
Using cached page style profile: page 002
Page style profile failed: page 003
```

If a page-level style profile fails:

```text id="oe76fp"
record failure
continue with validation using no page profile if allowed by config
show warning in logs/report
```

Do not crash the whole run unless existing fatal-error handling requires it.

---

## 12. Style-Aware Validation Input

Update style-aware validation so it receives:

```ts id="2z1d9u"
{
  pageStyleProfile: LeafletStyleProfile | null
}
```

Remove required dependency on:

```text id="yqtpwn"
leafletStyleProfile
representative style profile
selected pages profile
```

The validation prompt must include this priority:

```text id="e31d47"
1. Crop-specific visual evidence
2. Page-level style profile for this page
3. General Saudi leaflet heuristics
4. If unclear, do not approve publishing
```

If `pageStyleProfile` is null, the prompt should say:

```text id="ju6vgk"
No page-level style profile is available. Use crop-specific evidence and general Saudi leaflet heuristics. If unclear, do not approve publishing.
```

---

## 13. Manifest Changes

Deprecate or ignore old representative fields.

If these fields exist:

```text id="0gi3ug"
style_profile_selection
selected_page_numbers
leaflet_style_profile_path
```

do not rely on them for new packages.

Add or update manifest section:

```json id="7du9qi"
{
  "page_style_profiles": {
    "mode": "all_pages",
    "status": "not_started",
    "total_pages": 0,
    "completed_pages": 0,
    "failed_pages": 0,
    "started_at": null,
    "completed_at": null,
    "profile_dir": "metadata/style-profiles",
    "failures": []
  }
}
```

Allowed statuses:

```text id="gtvgg9"
not_started
running
completed
completed_with_warnings
failed
disabled
```

Older manifests without this field must load safely.

---

## 14. Rehearsal Gate Update

Chunk 55 added a rehearsal gate that may require:

```text id="uu2wzv"
representative style-profile step is generated or skipped
```

Replace that gate.

New rehearsal gate:

```text id="q7pfl3"
If PAGE_STYLE_PROFILE_MODE=all_pages:
  page_style_profiles.status must be completed or completed_with_warnings
  OR package must be an older completed package and operator accepts warning

If PAGE_STYLE_PROFILE_MODE=disabled:
  allow rehearsal but show warning that page-level style profiling was disabled
```

Do not require representative style-profile status anymore.

Remove wording about:

```text id="r6sayu"
representative pages
selected pages
leaflet-level representative profile
```

from rehearsal UI and reports.

---

## 15. Dry-Run / QA Update

Update dry-run reports to include:

```text id="yfxe7z"
page_style_profile_mode
page_style_profiles_status
page_style_profiles_completed_pages
page_style_profiles_failed_pages
page_style_profiles_missing_pages
```

If a QA package lacks page-level style profiles, show warning:

```text id="m164ve"
Page-level style profiles are missing. This package may have been created before page-level profiling was enabled.
```

Do not auto-call Mistral in QA/dry-run mode unless the operator starts extraction/OCR intentionally.

---

## 16. Accuracy Report Update

Update `accuracy-run-report.json` with:

```text id="f8zsxd"
page_style_profile_mode
page_style_profiles_status
page_style_profiles_completed_pages
page_style_profiles_failed_pages
page_style_profiles_missing_pages
page_style_profile_errors_by_page
```

Remove or deprecate representative-page report fields if they were added.

If old report fields remain for backward compatibility, mark them as deprecated.

---

## 17. Tests

Add or update tests.

Recommended files:

```text id="qa56lr"
src/main/ocr/__tests__/pageStyleProfileService.test.ts
src/main/ocr/__tests__/styleProfilePromptBuilder.page.test.ts
src/main/ocr/__tests__/styleAwareValidationWithPageProfile.test.ts
src/main/workflow/__tests__/pageStyleProfileWorkflow.test.ts
src/main/extraction/__tests__/pageStyleProfilesManifest.test.ts
src/main/prepublish/__tests__/realPublishRehearsalGate.test.ts
src/main/reporting/__tests__/accuracyRunReportService.test.ts
```

Required test cases:

```text id="5m72ab"
representative page selection is no longer required for crop editor
representative page selection gate is removed
page profile prompt says one rendered page only
page profile prompt says do not extract final item data
page profile prompt warns size/content values are not prices
page profile service uses shared queue kind style_profile
page profile artifact path is metadata/style-profiles/page-001-style-profile.json
existing page profile is loaded from cache without calling Mistral
forceRegenerate calls Mistral again
PAGE_STYLE_PROFILE_MODE=disabled skips generation
workflow generates one page profile per page with crops
workflow reuses one page profile for all crops on the same page
style-aware validation receives pageStyleProfile
style-aware validation handles null pageStyleProfile
manifest tracks completed/failed page profiles
older manifests without page_style_profiles load safely
dry-run report includes page style profile status
accuracy report includes page style profile status
real publish rehearsal gate no longer requires representative selected pages
real publish rehearsal gate checks page_style_profiles status where applicable
QA/dry-run mode does not auto-call Mistral
```

Do not call real Mistral in tests.

Do not call Supabase.

Mock Mistral provider.

Mock filesystem where practical.

---

## 18. Documentation Update

Update relevant docs:

```text id="1zma2n"
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/accuracy-verification.md
```

Replace any representative-page instructions with:

```text id="73tuw8"
The app now generates a page-level style profile for every page that has item crops.
This page profile is used to validate item crops from that page.
The operator no longer needs to select representative pages.
The page-level profile helps handle leaflets where price label colors and layouts change by page.
```

Document config:

```text id="wvi9zb"
PAGE_STYLE_PROFILE_MODE=all_pages
PAGE_STYLE_PROFILE_MODE=disabled
```

---

## 19. Security Rules

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

## 20. Acceptance Criteria

This chunk is complete when:

* Representative page selection is removed or disabled.
* Crop editor is no longer gated by representative page selection.
* Page-level style profiling is the default.
* `PAGE_STYLE_PROFILE_MODE=all_pages` is supported and defaulted.
* Page-level style profile is generated once per page with item crops.
* Page-level style profiles are cached and reused.
* Page-level profile artifacts are saved as:

```text id="7mezix"
metadata/style-profiles/page-001-style-profile.json
```

* Style-aware validation uses page-level style profile.
* Style-aware validation works if page profile is missing or disabled.
* Manifest tracks page-level style profile status.
* Dry-run and accuracy reports include page-level style profile status.
* Real publish rehearsal gate no longer requires representative selected pages.
* Real publish rehearsal gate checks page-level profile status where applicable.
* Older packages still load safely.
* Tests are added or updated.
* TypeScript compiles.
* The app remains runnable.
* No tests call real Mistral.
* No tests call Supabase.

---

## 21. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the page-level style profiling replacement changes needed for this chunk, keep the app runnable, then stop.

Do not perform a real Mistral call, real OCR run, real Supabase upload, or real DB publish during automated tests.

---

## 22. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="0w42iy"
files modified
files created
representative page selection removed/disabled
page-level style profiling behavior
config/defaults
artifact paths
manifest fields
workflow changes
validation changes
dry-run/report changes
rehearsal gate changes
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

```text id="jasdut"
Run a safe local QA extraction on a copied package with PAGE_STYLE_PROFILE_MODE=all_pages, verify page style profile artifacts are created, then run Dry Run Publish only.