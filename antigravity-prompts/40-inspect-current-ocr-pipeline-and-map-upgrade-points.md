# Antigravity Prompt Chunk 40: Inspect Current OCR Pipeline and Map Accuracy Upgrade Points

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 40.

This is an **inspection and mapping chunk only**.

Do not implement the accuracy upgrade yet.

Do not replace prompts yet.

Do not change the Mistral schema yet.

Do not refactor Supabase upload or DB sync yet.

Do not add the Pre-Publish Preview yet.

Your task is to inspect the existing codebase and produce a precise implementation map for the next upgrade chunks.

The master spec has already been saved at:

```text
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read that file fully before inspecting the code.

---

## 1. Purpose

The Wifran extraction tool already exists and already performs crop OCR, JSON extraction, image generation, and DB sync.

We are not rebuilding it.

We need to upgrade it incrementally for better extraction accuracy, stronger validation, comparison safety, and a Pre-Publish Preview approval gate.

Before changing code, inspect the current architecture and identify exactly where each current behavior lives.

The output of this chunk should be a developer report that tells us:

```text
which files/modules exist now
what each one currently does
where the current Mistral prompt is built
where EXPECTED JSON SCHEMA is appended
where rate limiting is handled
where crop OCR runs
where item JSON is saved
where extraction manifests are created/updated
where DB sync is triggered
where Supabase image upload happens
where offer upsert happens
where publishing status is decided
where reports/results UI are built
what should be preserved
what should be upgraded later
```

---

## 2. Read These Files First

Read the master upgrade package first:

```text
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Then inspect the existing project files.

Start by looking for files similar to:

```text
src/main/ocr/
src/main/workflow/
src/main/image/
src/main/pdf/
src/main/db/
src/main/extraction/
src/main/ipc/
src/preload/
src/shared/
src/renderer/
src/renderer/pages/
src/renderer/components/
src/renderer/components/manual-crop/
src/renderer/components/results/
src/renderer/components/import/
docs/
README.md
```

Use actual discovered paths in your report.

Do not assume these paths exist. Inspect the repository and report the real paths.

---

## 3. Inspection Tasks

### 3.1 Find current Mistral OCR integration

Find the current Mistral API integration files.

Identify:

```text
Mistral client/provider file
OCR request function
model name configuration
endpoint configuration
API key loading
request payload format
response parsing
retry logic
error handling
logging
```

Report:

```text
file path
main exported functions/classes
what model is currently used
whether mistral-ocr-2512 is configured
where request payload is built
where image is passed to the API
where response JSON/text is parsed
```

Do not modify it yet.

---

### 3.2 Find the current crop-level Mistral prompt

Find the exact prompt currently sent to Mistral for each cropped item image.

Search for phrases such as:

```text
You are reading one cropped item image
Return only JSON
EXPECTED JSON SCHEMA
offer_price
original_price
pack_quantity
bundle_quantity
special_offer
raw_attributes
```

Report:

```text
file path
function name
exact current prompt or prompt template summary
dynamic variables inserted into prompt
whether itemNumber is included
whether page number is included
whether image path is included
whether prompt is fixed-schema or flexible-schema
```

Also answer:

```text
Does the prompt currently ask for candidates?
Does it ask for visual evidence?
Does it ask for confidence?
Does it ask for warnings?
Does it explicitly prevent 1.5L from becoming a price?
Does it explicitly prevent old price from becoming current price?
```

Do not change the prompt yet.

---

### 3.3 Find current EXPECTED JSON SCHEMA handling

Find where the tool appends or provides:

```text
EXPECTED JSON SCHEMA:
```

or equivalent structured schema instructions.

Report:

```text
file path
schema source
whether schema is hardcoded in prompt
whether schema is Zod/TypeScript/runtime validated
whether extra keys are allowed
whether current schema is narrow or flexible
current required fields
current optional fields
```

Also report whether the current schema supports:

```text
price_candidates
size_candidates
selected_prices
visual_evidence
confidence
warnings
raw_attributes
```

Do not update the schema yet.

---

### 3.4 Find current item OCR workflow

Find the workflow that processes crop images and sends them to Mistral.

Report:

```text
file path
queue/worker name
how crop files are discovered
how item numbers are assigned
how page numbers are inferred
whether OCR is run immediately after crop generation
whether OCR can resume missing JSON files
where JSON output is written
how failures are stored
```

Also report current crop/JSON pairing logic, especially whether it assumes:

```text
crops/page-001/item.webp
json/page-001/item.json
```

or another structure.

Do not change the workflow yet.

---

### 3.5 Find current Mistral rate-limit queue

Inspect current rate limiting.

Report:

```text
file path
class/function name
max concurrency
minimum delay between requests
whether extraction calls share one queue
whether Retry-After is respected
whether 429 is retried
whether ETA/progress is shown
whether different call types could share it later
```

Specifically answer:

```text
Can the existing queue support extraction calls, style-profile calls, and validation calls through one shared queue?
If yes, what changes would be needed later?
If no, what new shared queue should replace/wrap it?
```

Do not implement changes yet.

---

### 3.6 Find current extraction package/folder logic

Inspect current extraction folder handling.

Report how the app currently creates/uses:

```text
Extracts/
{leaflet_name}/
chunks/
pages/
crops/
json/
logs/
metadata/
source/
manual-crop-layout.json
flexible-item-ocr-summary.json
ocr_returned_keys.json
ocr_keys_without_values.json
extraction_manifest.json
```

Report:

```text
file path
how package folder name is derived
whether existing folders are cleared
whether opening existing extraction folders is supported
whether manifest is created
manifest schema if present
when extraction_status becomes completed
whether DB update is gated by manifest completion
```

Do not modify package logic yet.

---

### 3.7 Find current canonical parsing or normalization

Find any existing parsing/normalization modules.

Search for:

```text
normalize
normalizer
parsePrice
parseSize
offer_price
original_price
pack_quantity
bundle_quantity
canonical
raw_attributes
validation
```

Report:

```text
file path
what fields are normalized
whether legacy fields are supported
whether unknown OCR fields are preserved
whether raw OCR JSON is stored
whether price/size distinction is checked
whether old price/current price distinction is checked
```

Also state whether this module is suitable to extend into:

```text
canonicalOfferNormalizer
legacyOcrFieldMapper
deterministicOfferChecks
comparisonSafety
publishDecisionEngine
```

Do not implement these yet.

---

### 3.8 Find current deterministic validation / publish gates

Find all validation before publishing.

Report validation for:

```text
missing title
missing offer price
invalid price
invalid dates
expired offer
location scope
city/region/national coverage
unsafe image path
duplicate detection
non-product/promotional crop
old-price-only row
discount badge-only row
SKU-only row
```

Report:

```text
file path
function names
current blocking errors
current warnings
how validation result affects status
whether status=published is assigned directly
whether rows can become needs_review/skipped/error
```

Also report gaps relative to the upgrade package:

```text
no size-as-price detection
no old-price-as-current-price detection
no visual evidence validation
no comparison exclusion decision
```

Do not change validation yet.

---

### 3.9 Find current comparison/recommendation metadata handling

Inspect whether the tool or Wifran DB mapping currently supports:

```text
comparison_eligible
comparison_unit
comparison_unit_price
comparison_confidence
comparison_exclusion_reason
unit price
price per kg/liter/piece
```

Report:

```text
file path
fields currently mapped
whether DB schema supports comparison fields
whether metadata/jsonb field exists
whether comparison data is currently ignored
what should be added later
```

Do not add comparison logic yet.

---

### 3.10 Find current Supabase Storage upload

Inspect image upload logic.

Report:

```text
file path
bucket name
path format
image format
public URL creation
failure handling
whether upload happens before or after validation
whether upload is skipped for invalid rows
```

Confirm whether it uses:

```text
offer-images/{supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp
```

or another path.

Do not change upload logic yet.

---

### 3.11 Find current Supabase DB upsert logic

Inspect offer DB sync/upsert logic.

Report:

```text
file path
function name
tables touched
offer_sources handling
offer row mapping
idempotency key
duplicate detection
status assignment
published/needs_review/skipped behavior
metadata/jsonb fields if available
service role key usage
```

Confirm:

```text
whether valid rows are inserted/updated with status=published
whether invalid rows are skipped
whether DB update can currently run immediately after extraction
whether DB update is user-triggered
```

Do not change DB logic yet.

---

### 3.12 Find current Import page button flow

Inspect the UI around:

```text
Select PDF
Open Existing Extraction Folder
Start Extraction
Continue Extraction
Extraction Completed
Update Database
```

Report:

```text
file path
state variables
button labels
enable/disable rules
where extraction starts
where DB update starts
whether DB update requires manifest completed
whether a completed extraction can be loaded later
```

Also report what needs to change later for:

```text
Pre-Publish Preview button
removing/directly disabling Update Database from main page
Publish button only inside preview
```

Do not change UI yet.

---

### 3.13 Find current results/review/preview UI

Inspect whether there is already a results page or preview window.

Search for:

```text
ResultsPage
Review
Preview
Summary
ImportResult
OCR result
crop grid
item card
```

Report:

```text
file path
what it displays
whether it shows crop images
whether it shows extracted JSON/data
whether it can be reused for Pre-Publish Preview
whether it supports filters/tabs
whether it has publish action
```

Do not implement preview yet.

---

### 3.14 Find current reporting

Inspect report generation.

Report current artifacts:

```text
flexible-item-ocr-summary.json
accuracy-run-report.json
pre-publish-preview-summary.json
import summary
logs
error reports
manifest validation
```

Report:

```text
file path
what counts are currently reported
whether warnings/errors by code exist
whether image upload counts exist
whether publish/update/skipped counts exist
whether Mistral call counts exist
whether validation call counts exist
```

Do not implement report changes yet.

---

### 3.15 Find current tests and fixtures

Inspect tests.

Report:

```text
test framework
test commands
existing fixtures
OCR fixture tests
normalizer tests
DB sync tests
image upload tests
manual crop tests
extraction package tests
```

Also report missing tests needed for:

```text
1.5L must not become 1.51 price
730ml must not become price
old price must not become offer price
8x135g total content
1+1 bundle
per 2kg comparison
TV/electronics comparison exclusion
Pre-Publish Preview no DB upload before approval
shared Mistral rate-limit queue
```

Do not add tests yet unless they already exist and only need documentation.

---

## 4. Required Output Report

Create a markdown report file:

```text
wifran-offers-extractor/antigravity-reports/40-current-ocr-pipeline-inspection-report.md
```

If the `antigravity-reports` folder does not exist, create it.

The report must include these sections:

```text
# Chunk 40 Current OCR Pipeline Inspection Report

## Executive Summary

## Current Project Structure Relevant to OCR and Publishing

## Current Mistral Integration

## Current Crop-Level Prompt

## Current EXPECTED JSON SCHEMA Handling

## Current Item OCR Workflow

## Current Mistral Rate-Limit Queue

## Current Extraction Package and Manifest Logic

## Current JSON Output and Raw OCR Storage

## Current Normalization / Parsing

## Current Validation and Publish Gates

## Current Comparison Metadata Support

## Current Supabase Storage Upload

## Current Supabase DB Upsert

## Current Import Page Button Flow

## Current Results / Review / Preview UI

## Current Reporting

## Current Tests and Fixtures

## Gap Analysis Against Accuracy Upgrade Package

## Recommended Implementation Order for Chunks 41–50

## Files That Should Be Preserved

## Files That Should Be Extended

## Files That May Need New Modules

## Risks and Open Questions

## Final Notes
```

---

## 5. Gap Analysis Requirements

In the report, include a table like:

```text
Upgrade Requirement | Current Support | Existing File(s) | Gap | Recommended Future Chunk
```

Include at least these upgrade requirements:

```text
candidate-based extraction prompt
visual evidence fields
strict candidate schema
legacy field mapper
canonical offer normalizer
style profile generation
style-aware validation call
shared Mistral rate-limit queue
deterministic size-as-price checks
old-price-as-offer-price checks
comparison-safety logic
publish / publish_but_exclude / skip decision engine
Pre-Publish Preview grid
preview approval gate before DB upload
accuracy-run-report.json
pre-publish-preview-summary.json
regression fixtures
Supabase metadata preservation
```

---

## 6. Implementation Order Recommendation

Based on the real codebase, recommend the safest order for the next chunks.

Start from this tentative order, but adjust if the codebase suggests otherwise:

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
```

If the inspection shows a different safer order, explain why.

---

## 7. Very Important Constraints

This chunk is inspection-first.

You may make only minimal non-invasive changes needed to create the report folder/file.

Do not:

```text
replace Mistral prompt
change EXPECTED JSON SCHEMA
change OCR request payload
change crop generation
change item numbering
change extraction package folder structure
change manifest schema
change Supabase upload
change Supabase DB upsert
change publishing decisions
add validation call
add style profile call
add Pre-Publish Preview
change UI button behavior
run DB updates
run OCR on real user data
delete extraction folders
modify .env files
hardcode keys
```

Allowed:

```text
read files
search code
document findings
create antigravity-reports/40-current-ocr-pipeline-inspection-report.md
optionally create a small notes file only if needed
```

If you must run commands, only run safe read-only commands such as:

```bash
find
grep
rg
ls
npm run typecheck
npm run test -- --runInBand
```

Do not run extraction, OCR, or DB sync.

If a test command may call external APIs or Supabase, do not run it.

---

## 8. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not inspect or reveal secret values.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not expose raw `ipcRenderer`.
* Do not add generic filesystem IPC.
* Do not upload images.
* Do not run Mistral OCR.
* Do not write to Wifran DB.
* Do not publish offers.
* Do not delete files in `Extracts/`.

---

## 9. Acceptance Criteria

This chunk is complete when:

* `project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md` has been read.
* Current Mistral integration files are identified.
* Current crop-level prompt location is identified.
* Current strict schema handling is identified.
* Current item OCR workflow is mapped.
* Current Mistral queue/rate-limit behavior is mapped.
* Current extraction package/manifest logic is mapped.
* Current raw OCR JSON saving is mapped.
* Current normalization/parsing is mapped.
* Current validation/publish gates are mapped.
* Current comparison metadata support is mapped.
* Current Supabase upload is mapped.
* Current DB upsert is mapped.
* Current Import page button flow is mapped.
* Current preview/results UI is mapped.
* Current reporting is mapped.
* Current tests/fixtures are mapped.
* Gaps against the upgrade package are documented.
* Recommended implementation order for Chunks 41–50 is provided.
* No major implementation changes are made.
* No OCR/API/DB operations are run.
* The report file is created at:

```text
wifran-offers-extractor/antigravity-reports/40-current-ocr-pipeline-inspection-report.md
```

---

## 10. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Inspect the codebase, create the report, then stop.

Do not implement future chunks in this step.

---

## 11. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text
files created
files modified
whether the master upgrade package was found
key current files identified
biggest gaps found
recommended next chunk
commands run
any commands skipped and why
risks/open questions
```

Do not paste the entire report into chat unless asked.

Tell me the report file path.