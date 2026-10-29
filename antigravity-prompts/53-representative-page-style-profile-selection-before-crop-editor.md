# Antigravity Prompt Chunk 53: Representative Page Style Profile Selection Before Crop Editor

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 53.

Chunks 41–52 should already have completed:

```text
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
52-manual-qa-dry-run-with-copied-extraction-package.md
```

This chunk adds a new operator step **before the manual crop editor opens**.

After the PDF pages are rendered, the operator should select **2–3 representative rendered pages** for leaflet-level style profiling.

The selected pages are sent to Mistral once as a small style-profiling batch so the extractor can understand the leaflet’s visual styling before item-level crop extraction and validation.

This chunk extends the Chunk 44 style-profile system.

This chunk does **not** run item crop OCR.

This chunk does **not** run DB sync.

This chunk does **not** upload images.

This chunk does **not** publish offers.

---

## 1. Why This Chunk Exists

The current architecture supports style profiles, but the operator needs a better flow:

```text
PDF selected
→ pages rendered
→ operator selects 2–3 representative pages for leaflet-level style profile
→ Mistral generates leaflet-level style profile
→ crop editor opens
→ crop boxes created/edited
→ item crop OCR
→ style-aware validation uses crop evidence + page profile + leaflet profile
```

This improves accuracy because the model sees the leaflet’s recurring visual conventions before individual crop validation.

Examples of visual conventions:

```text
current offer price style
old/crossed-out price style
size/content style
promotion labels
price block colors
SAR symbol placement
large/small price digit conventions
multi-buy badges
branch/condition labels
```

---

## 2. Read These Files First

Read the master accuracy package:

```text
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read the existing reports if present:

```text
wifran-offers-extractor/antigravity-reports/51-safe-local-verification-report.md
wifran-offers-extractor/antigravity-reports/52-manual-qa-dry-run-report.md
```

Read the relevant previous prompts:

```text
wifran-offers-extractor/antigravity-prompts/44-adaptive-style-profile-generation.md
wifran-offers-extractor/antigravity-prompts/45-style-aware-validation-call-for-every-item.md
wifran-offers-extractor/antigravity-prompts/48-pre-publish-preview-and-human-publish-approval-gate.md
wifran-offers-extractor/antigravity-prompts/52-manual-qa-dry-run-with-copied-extraction-package.md
```

Then inspect the current implementation, especially:

```text
src/renderer/src/pages/ImportPage.tsx
src/renderer/src/components/
src/renderer/src/components/prepublish/
src/main/workflow/cropAndItemOcrWorkflow.ts
src/main/image/manualCropService.ts
src/main/image/itemImageCropper.ts
src/main/pdf/
src/main/ocr/styleProfileService.ts
src/main/ocr/styleProfilePromptBuilder.ts
src/main/ocr/styleAwareItemValidationService.ts
src/main/ocr/styleAwareValidationPromptBuilder.ts
src/main/ocr/mistralRateLimitQueue.ts
src/main/ocr/ocrRateLimitQueue.ts
src/main/extraction/extractionManifestService.ts
src/shared/types/styleProfile.ts
src/shared/schemas/styleProfileSchema.ts
src/shared/types/canonicalOffer.ts
src/main/ipc/
src/preload/
```

Adapt paths if the actual project structure differs.

---

## 3. Goal

Add a new workflow step between page rendering and crop editing:

```text
1. Render PDF pages.
2. Show a page-selection screen with thumbnails of rendered pages.
3. Operator selects 2–3 representative pages.
4. Operator clicks Generate Leaflet Style Profile.
5. App sends selected rendered pages to Mistral through the shared queue.
6. App saves leaflet-level style profile artifact.
7. App writes selected page metadata to manifest.
8. App opens the manual crop editor.
```

The crop editor should not open automatically before this step unless the operator explicitly skips style profiling.

---

## 4. UX Requirements

After preprocessing/page rendering completes, show a new screen or panel:

```text
Step: Select Representative Pages for Style Profiling
```

The screen should display rendered page thumbnails in a grid.

Each page card should show:

```text
page thumbnail
page number
selection checkbox
optional “Representative” badge when selected
```

The operator should be able to select:

```text
minimum: 2 pages
recommended: 3 pages
maximum: 3 pages
```

If the PDF has fewer than 3 pages:

```text
allow selecting all available pages
minimum becomes 1 if the leaflet only has 1 page
```

Buttons:

```text
Generate Leaflet Style Profile
Skip Style Profile
Back
Continue to Crop Editor
```

Button behavior:

```text
Generate Leaflet Style Profile:
  enabled only when valid page count is selected

Skip Style Profile:
  asks for confirmation and continues to crop editor with no leaflet-level profile

Continue to Crop Editor:
  enabled after style profile is generated or skipped
```

---

## 5. Suggested Default Selection

When the screen opens, suggest 3 pages automatically if possible:

```text
first offer-heavy page
middle offer-heavy page
last offer-heavy page
```

If the app cannot detect offer-heavy pages, use:

```text
page 1
middle page
last page
```

The operator must still be able to change the selection.

If the selected page count is invalid, show:

```text
Select 2–3 representative pages for style profiling.
```

For one-page PDFs, show:

```text
This leaflet has only one page. One representative page is enough.
```

---

## 6. New UI Components

Create components using existing UI conventions.

Recommended files:

```text
src/renderer/src/components/styleProfile/RepresentativePageSelection.tsx
src/renderer/src/components/styleProfile/RepresentativePageCard.tsx
src/renderer/src/components/styleProfile/StyleProfileSelectionSummary.tsx
```

Or, if the project prefers pages:

```text
src/renderer/src/pages/RepresentativeStyleProfilePage.tsx
```

The UI must be compact and practical because some leaflets have many pages.

Requirements:

```text
thumbnail grid
page number labels
multi-select
selection count
clear visual selected state
progress indicator during style profile generation
error banner if generation fails
success banner when profile saved
```

Do not overbuild.

---

## 7. Workflow Integration

Modify the preprocessing/crop-editor flow.

Current desired flow:

```text
Select PDF
→ Run Preprocessing / Render Pages
→ Representative Page Selection
→ Generate or Skip Leaflet Style Profile
→ Manual Crop Editor
→ Crop/OCR
```

Do not break existing streaming render behavior.

If current system opens crop editor as soon as page 1 is rendered, change it so:

```text
page rendering can still happen progressively/background
but crop editor waits until:
  style profile generated
  or style profile explicitly skipped
```

If pages are still rendering, the page-selection screen should show:

```text
rendered pages available now
loading indicators for pages still rendering
```

The operator should not generate the leaflet profile until selected pages are rendered.

---

## 8. Leaflet-Level Style Profile Generation

Extend the existing style profile service from Chunk 44.

Add or complete a function like:

```ts
export async function generateLeafletStyleProfileFromSelectedPages(input: {
  leafletId?: string | null;
  selectedPageNumbers: number[];
  pageImagePaths: string[];
  extractionPackagePath: string;
}): Promise<LeafletStyleProfile>
```

Requirements:

```text
Use selected rendered page images.
Build one leaflet-level prompt.
Call Mistral through shared queue.
Save a single leaflet-level style profile artifact.
Return the profile.
```

The queue metadata must be:

```ts
{
  kind: 'style_profile',
  label: 'Leaflet style profile from representative pages',
  pageNumber: null
}
```

Do not create a separate queue.

Do not bypass the shared queue.

---

## 9. Mistral Input Strategy

Use the selected 2–3 rendered page images in one style-profile call if the existing provider supports multi-image vision messages.

If the current provider does not support multi-image messages, implement the safest available option:

### Preferred

```text
One Mistral call with 2–3 selected page images.
```

### Fallback

```text
One Mistral call per selected page through the shared queue,
then merge page-level style summaries into a leaflet-level profile.
```

If using fallback, save both:

```text
page-level profiles
merged leaflet-level profile
```

Do not send the entire leaflet.

Do not send every page.

Do not send selected style pages with every item crop.

The style profile should be generated once per leaflet/package.

---

## 10. Leaflet Style Profile Prompt

Extend the existing style profile prompt builder.

Add a function like:

```ts
export function buildLeafletStyleProfilePrompt(input: {
  leafletId?: string | null;
  selectedPageNumbers: number[];
}): string
```

The prompt should say:

```text
You are analyzing 2–3 representative pages from the same Saudi supermarket leaflet.

Your task is to infer temporary leaflet-level visual style guidance.

Do not extract final item data.

Do not create permanent supermarket rules.

Identify the recurring style patterns for:
- current offer prices
- old/original/crossed-out prices
- size/content values
- pack and bundle indicators
- promotion badges
- condition labels
- non-price product attributes

Use evidence from all selected pages.

If the selected pages use mixed styles, report the differences.

Return strict valid JSON only.
```

The prompt must explicitly warn:

```text
1.5L, 730ml, 10kg, 8×135g, 30PCS, inch sizes, 4K, HD, LED are not prices.
```

The output should use the existing `LeafletStyleProfile` schema.

Set:

```text
scope = leaflet
page_number = null
selected_page_numbers = [ ... ]
```

If the existing type does not include `selected_page_numbers`, add it.

---

## 11. Style Profile Artifact Paths

Save the leaflet-level profile here:

```text
metadata/style-profiles/leaflet-style-profile.json
```

Also save the selected page metadata:

```text
metadata/style-profiles/leaflet-style-profile-selection.json
```

Recommended selection metadata:

```json
{
  "schema_version": 1,
  "created_at": "datetime",
  "leaflet_id": "string or null",
  "selected_page_numbers": [1, 12, 24],
  "selected_page_image_paths": [
    "pages/page-001.webp",
    "pages/page-012.webp",
    "pages/page-024.webp"
  ],
  "status": "generated | skipped | failed",
  "profile_path": "metadata/style-profiles/leaflet-style-profile.json",
  "error_message": null
}
```

Do not overwrite item OCR JSON.

Do not overwrite validation JSON.

Do not rename page images.

---

## 12. Manifest Integration

Update `extraction_manifest.json` safely.

Add:

```json
{
  "style_profile_selection": {
    "status": "not_started",
    "selected_page_numbers": [],
    "profile_path": null,
    "selection_path": null,
    "started_at": null,
    "completed_at": null,
    "skipped_at": null,
    "error_message": null
  }
}
```

Allowed statuses:

```text
not_started
selected
generating
generated
skipped
failed
```

Older manifests without this field must load safely.

When style profile is generated:

```text
status = generated
selected_page_numbers = selected pages
profile_path = metadata/style-profiles/leaflet-style-profile.json
selection_path = metadata/style-profiles/leaflet-style-profile-selection.json
completed_at = now
```

When skipped:

```text
status = skipped
skipped_at = now
selected_page_numbers = []
profile_path = null
```

---

## 13. Crop Editor Gate

The crop editor should open only when:

```text
style_profile_selection.status = generated
```

or:

```text
style_profile_selection.status = skipped
```

or an older package is loaded that has already passed crop editing/OCR stages.

Do not block old completed packages from loading.

Rules:

```text
New package after rendering:
  require generated or skipped before crop editor.

Existing package with crop layout already created:
  allow opening crop editor, but show warning if leaflet style profile is missing.

Existing completed extraction:
  do not force style profile selection retroactively.
```

---

## 14. Style-Aware Validation Must Use Leaflet Profile

Update Chunk 45 validation integration so item validation can receive:

```text
crop-specific evidence
page-level style profile if available
leaflet-level style profile if available
```

The validation prompt input should include both:

```ts
{
  pageStyleProfile,
  leafletStyleProfile
}
```

If the current function only accepts one `styleProfile`, extend it safely.

Priority must be documented in the prompt:

```text
1. Crop-specific visual evidence
2. Page-level style profile
3. Leaflet-level style profile from representative pages
4. General Saudi leaflet heuristics
5. If unclear, do not approve publishing
```

If no leaflet profile exists because the operator skipped, validation should still run with `leafletStyleProfile = null`.

---

## 15. Accuracy Report Integration

Update reporting from Chunk 49 to include:

```text
style_profile_selection_status
selected_style_profile_pages
leaflet_style_profile_generated
leaflet_style_profile_path
style_profile_generation_error
```

Update `accuracy-run-report.json` with these fields where practical.

Also include in the Chunk 52 QA dry-run report if relevant.

---

## 16. Dry Run / QA Integration

In QA/dry-run mode from Chunk 52:

```text
do not call Mistral automatically
do not generate a new profile automatically
load existing leaflet-style-profile.json if present
show whether style profile exists
show selected page numbers if present
```

If the QA package lacks a leaflet-level profile:

```text
show warning:
"Leaflet-level style profile is missing. This package may have been created before representative page profiling."
```

Do not block QA preview.

---

## 17. IPC / Preload

If Electron IPC is needed, add narrow actions only.

Recommended actions:

```text
styleProfileSelection:listRenderedPages
styleProfileSelection:generateLeafletProfile
styleProfileSelection:skip
styleProfileSelection:getStatus
```

Rules:

```text
validate package path
only read rendered page images from known package folders
do not expose arbitrary filesystem access
do not expose raw ipcRenderer
do not log image base64
do not log secrets
```

---

## 18. Error Handling

If selected page images are missing:

```text
show clear error
do not call Mistral
let operator choose different pages
```

If Mistral style profile generation fails:

```text
status = failed
write error_message to manifest/selection artifact
show retry option
allow Skip Style Profile with confirmation
```

If the output schema fails validation:

```text
status = failed
save raw failure details if safe
show schema validation error
allow retry or skip
```

Do not crash the app.

---

## 19. Tests

Add or update tests.

Recommended test files:

```text
src/main/ocr/__tests__/leafletStyleProfileService.test.ts
src/main/ocr/__tests__/styleProfilePromptBuilder.leaflet.test.ts
src/renderer/src/components/styleProfile/__tests__/RepresentativePageSelection.test.tsx
src/main/extraction/__tests__/styleProfileSelectionManifest.test.ts
src/main/ocr/__tests__/styleAwareValidationWithLeafletProfile.test.ts
```

Required test cases:

```text
default selection chooses first/middle/last page when possible
valid selection accepts 2 pages
valid selection accepts 3 pages
invalid selection rejects 0 pages
invalid selection rejects 1 page for multi-page leaflet
invalid selection rejects more than 3 pages
one-page leaflet allows 1 page
Generate button disabled until valid selection
Skip requires confirmation
crop editor blocked before generated/skipped status for new package
crop editor allowed after generated status
crop editor allowed after skipped status
leaflet profile prompt includes selected page numbers
leaflet profile prompt says do not extract final item data
leaflet profile prompt warns size/content values are not prices
leaflet profile service uses shared queue kind style_profile
leaflet profile artifact path is metadata/style-profiles/leaflet-style-profile.json
manifest stores selected_page_numbers
older manifests without style_profile_selection load safely
style-aware validation prompt includes leafletStyleProfile when available
style-aware validation handles null leafletStyleProfile
QA dry-run does not auto-call Mistral
```

Do not call real Mistral in tests.

Do not call Supabase.

Mock Mistral provider.

Mock filesystem where practical.

---

## 20. Documentation Update

Update relevant docs if they exist:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/accuracy-verification.md
```

Document:

```text
after page rendering, operator selects 2–3 representative pages
style profile is generated before crop editor
selected pages should represent the leaflet’s common price/style patterns
style profile helps validation but does not override crop-specific evidence
operator can skip style profiling with confirmation
style profile artifacts are saved under metadata/style-profiles/
```

---

## 21. Security Rules

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
* Do not call real Mistral during tests.
* Do not call real Supabase during tests.
* Do not add DB migrations.
* Do not add new DB columns.

---

## 22. Acceptance Criteria

This chunk is complete when:

* A representative page selection step exists before the crop editor for new packages.
* Rendered page thumbnails are shown for selection.
* Operator can select 2–3 representative pages.
* One-page PDFs allow one selected page.
* Suggested default selection is first/middle/last where possible.
* Leaflet-level style profile can be generated from selected pages.
* Style profile generation uses the shared Mistral queue with `kind: 'style_profile'`.
* Leaflet-level style profile is saved to:

```text
metadata/style-profiles/leaflet-style-profile.json
```

* Selection metadata is saved to:

```text
metadata/style-profiles/leaflet-style-profile-selection.json
```

* Manifest stores style profile selection status and selected page numbers.
* Crop editor is gated until style profile is generated or skipped for new packages.
* Operator can skip style profiling with confirmation.
* Style-aware validation can use both page-level and leaflet-level style profiles.
* Missing leaflet profile does not crash validation.
* QA/dry-run mode does not auto-call Mistral.
* Accuracy report includes style profile selection metadata.
* Older packages/manifests still load safely.
* Tests are added or updated where practical.
* TypeScript compiles.
* No real Supabase operations are run during tests.
* No real Mistral calls are run during tests.

---

## 23. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the representative page selection and leaflet-level style profile changes needed for this chunk, keep the app runnable, then stop.

Do not perform a real extraction, real Mistral call, or real DB publish during tests.

---

## 24. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text
files modified
files created
new representative page selection flow
how crop editor gating works
how leaflet-level style profile is generated
where artifacts are saved
manifest fields added
how validation now uses page and leaflet style profiles
QA/dry-run behavior
tests added/updated
commands run
commands skipped and why
whether typecheck passed
whether tests passed
confirmation that no real Supabase calls were run
remaining risks
recommended next step
```

The recommended next step should be:

```text
Run a safe local test with one copied extraction package: render pages, select 2–3 representative pages, generate leaflet style profile, then open crop editor.