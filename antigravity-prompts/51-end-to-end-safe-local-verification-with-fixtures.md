# Antigravity Prompt Chunk 51: End-to-End Safe Local Verification With Fixtures

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 51.

Chunks 41–50 should already have completed:

```text id="vl6475"
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

This chunk performs a safe end-to-end verification pass using fixtures and mocks.

Do not call Mistral.

Do not upload images.

Do not write to Supabase.

Do not publish real offers.

Do not delete extraction folders.

The goal is to verify that the upgraded pipeline works together locally.

---

## 1. Read These Files First

Read the master accuracy package:

```text id="k8q1rj"
project-knowledge/wifran-extraction-tool-accuracy-upgrade-package.md
```

Read the Chunk 40 inspection report:

```text id="ad1oyq"
wifran-offers-extractor/antigravity-reports/40-current-ocr-pipeline-inspection-report.md
```

Read previous prompts and inspect their implementation results:

```text id="xup8rg"
wifran-offers-extractor/antigravity-prompts/41-candidate-based-mistral-item-extraction-prompt-schema-and-visual-evidence.md
wifran-offers-extractor/antigravity-prompts/42-canonical-offer-normalizer-and-legacy-field-mapper.md
wifran-offers-extractor/antigravity-prompts/43-shared-mistral-rate-limit-queue-for-extraction-style-and-validation.md
wifran-offers-extractor/antigravity-prompts/44-adaptive-style-profile-generation.md
wifran-offers-extractor/antigravity-prompts/45-style-aware-validation-call-for-every-item.md
wifran-offers-extractor/antigravity-prompts/46-deterministic-price-size-and-publishing-sanity-checks.md
wifran-offers-extractor/antigravity-prompts/47-comparison-safety-and-publish-decision-engine.md
wifran-offers-extractor/antigravity-prompts/48-pre-publish-preview-and-human-publish-approval-gate.md
wifran-offers-extractor/antigravity-prompts/49-accuracy-run-report-and-regression-fixtures.md
wifran-offers-extractor/antigravity-prompts/50-supabase-metadata-mapping-for-extraction-quality.md
```

Then inspect the implemented modules from Chunks 41–50.

---

## 2. Goal

Verify the full upgraded local pipeline using fixtures and mocked services.

The verified flow should be:

```text id="8l0o8r"
fixture raw OCR JSON
→ candidate/legacy schema parsing
→ canonical normalization
→ mocked style-aware validation result
→ deterministic checks
→ comparison safety
→ publish decision engine
→ pre-publish preview model
→ preview approval gate
→ mocked DB sync with eligible rows only
→ accuracy report
→ metadata mapping dry-run
```

This should prove:

```text id="52d5k1"
known OCR mistakes are blocked
valid rows become publishable
valid but non-comparable rows become publish_but_exclude_from_comparison
skipped/quarantined rows are visible in preview but never sent to DB sync
DB sync cannot run without Pre-Publish Preview approval
metadata mapping does not include unsupported DB keys
reports accurately summarize outcomes
```

---

## 3. Non-Goals

Do not:

```text id="oxkeim"
call Mistral
run real OCR
upload images
write to Supabase
publish real offers
delete extraction folders
create DB migrations
add Supabase columns
change the OCR prompt unless a test proves it is broken
change DB sync architecture
```

This is a verification and hardening chunk.

---

## 4. Preserve Existing Working Behavior

Preserve:

```text id="oupzga"
current crop generation
current crop filenames
current item number assignment
current Mistral provider
current shared Mistral queue
current raw JSON saving
current extraction package folder structure
current Supabase Storage upload implementation
current DB upsert implementation
current Pre-Publish Preview UI
current manifest loading behavior
```

Only add or adjust tests, fixtures, local verification helpers, and small fixes required for the upgraded pipeline to pass safe local verification.

---

## 5. Verification Areas

Verify these areas:

```text id="yqbdd2"
candidate-based item OCR schema
legacy OCR compatibility
canonical normalizer
legacy field mapper
style profile schema/prompt/service with mocked provider
style-aware validation schema/prompt/service with mocked provider
shared Mistral queue behavior using fake timers/mocks
deterministic checks
comparison safety
publish decision engine
pre-publish preview builder
preview approval DB gate
accuracy run report builder
Supabase metadata mapper dry-run
manifest backward compatibility
```

---

## 6. Fixture-Based End-to-End Tests

Add a fixture-driven test suite.

Recommended test file:

```text id="pwkn5k"
src/shared/__tests__/accuracyPipeline.e2e.fixture.test.ts
```

or use the project’s existing test convention.

The test should load fixture cases from:

```text id="91rmmt"
tests/fixtures/accuracy/
```

or the fixture folder created in Chunk 49.

Each fixture should go through:

```text id="k5r4fb"
raw_ocr_json
→ normalizeToCanonicalOffer
→ mocked validation result if fixture provides one
→ runDeterministicOfferChecks
→ evaluateComparisonSafety
→ decidePublishAction
→ apply results to canonical offer
```

Then assert expected outcomes.

---

## 7. Required Fixture Cases

Verify at least these cases:

### 7.1 1.5L oil not price

Input should include a size candidate such as:

```text id="2oyp6w"
1.5L
```

Expected:

```text id="9mrgar"
1.5L classified as size/content
offer_price must not be 1.5 or 1.51 from size evidence
if selected as offer_price, blocking error size_misclassified_as_price
decision = skip_or_quarantine when size is selected as price
```

### 7.2 730ml 1+1

Expected:

```text id="ga8lyy"
730ml classified as content
1+1 produces bundle_quantity = 2
if offer_price is clear, total content = 1.46L
comparison_unit = liter
comparison_unit_price calculated correctly
decision = publish if all display fields are clear
```

### 7.3 8 × 135g pack

Expected:

```text id="g7jt7y"
pack_quantity = 8
each_size_value = 135
each_size_unit = gram
total_content = 1080g or 1.08kg
comparison_unit = kilogram
comparison_unit_price calculated correctly
```

### 7.4 Watermelon per 2kg

Expected:

```text id="6sbha5"
price_basis = per_2kg
comparison_unit = kilogram
comparison_unit_price = offer_price / 2
decision = publish if title and offer price are clear
```

### 7.5 TV/electronics

Expected:

```text id="lziviy"
item_domain = electronics
screen_size is preserved in raw attributes or product attributes
screen size is not treated as price
comparison_eligible = false
comparison_exclusion_reason = non_grocery_item or unsupported_comparison_domain
decision = publish_but_exclude_from_comparison if title and price are clear
```

### 7.6 Old price as current price

Expected:

```text id="kbfwe6"
crossed-out/smaller/original price must not become offer_price
if selected as offer_price, blocking error original_price_misclassified_as_offer_price
decision = skip_or_quarantine
```

### 7.7 Valid comparable row

Expected:

```text id="89v4ce"
decision = publish
preview_eligible = true
comparison_eligible = true
status_for_db = published
```

### 7.8 Valid but non-comparable row

Expected:

```text id="7a6t8n"
decision = publish_but_exclude_from_comparison
preview_eligible = true
comparison_eligible = false
status_for_db = published
```

### 7.9 Blocking row

Expected:

```text id="bmgb7a"
decision = skip_or_quarantine
preview_eligible = false
display_in_preview = true
should_upsert_db = false
```

### 7.10 Missing title

Expected:

```text id="5309ri"
blocking error missing_product_title
decision = skip_or_quarantine
```

### 7.11 Missing offer price

Expected:

```text id="akzfda"
blocking error missing_offer_price
decision = skip_or_quarantine
```

---

## 8. Pre-Publish Preview Gate Tests

Add or update tests proving the DB gate works.

Required cases:

```text id="8j4pin"
extraction completed alone does not call DB sync
preview opened alone does not call DB sync
preview approval without confirmation does not call DB sync
confirmed Publish inside preview calls DB sync
DB sync receives only publish and publish_but_exclude_from_comparison rows
skip_or_quarantine rows are excluded from DB sync
blocking rows are excluded from DB sync
missing preview approval throws a clear error
old manifest without preview fields defaults to not_opened
approved manifest allows mocked DB sync
```

Mock the DB sync service.

Mock image upload.

Do not call real Supabase.

---

## 9. Accuracy Report Verification

Add or update tests proving `accuracy-run-report.json` is correct.

Required cases:

```text id="6rgz9j"
report counts total items
report counts publish rows
report counts publish_but_exclude rows
report counts skip_or_quarantine rows
report counts comparison_eligible rows
report counts comparison_excluded rows
report counts non_grocery rows
report aggregates blocking errors by code
report aggregates warnings by code
report aggregates comparison exclusions by code
report counts size_as_price_detections
report counts old_price_as_offer_price_detections
report includes preview status
report includes DB update status
report includes item-level decisions
```

Use fixture canonical items.

Do not require a real extraction run.

---

## 10. Supabase Metadata Mapper Dry-Run Tests

Add or update tests proving DB payload mapping is safe.

Required cases:

```text id="lvj73y"
publish row maps to supported DB payload
publish_but_exclude row maps to status=published
publish_but_exclude row maps comparison metadata only if supported
skip_or_quarantine row is filtered before mapper or marked non-upsertable
unsupported metadata keys are not included in DB payload
raw full OCR JSON is not blindly spread into DB payload
compact metadata is used if JSONB metadata is supported
large metadata is reduced to paths/references
image metadata maps supported fields
source_page_number/source_item_number/external_image_id map if supported
idempotency key remains stable
```

Mock schema capabilities if needed.

Do not connect to Supabase.

---

## 11. Shared Queue Verification

Add or update tests proving all Mistral call kinds share one queue.

Use fake timers/mocks.

Required cases:

```text id="rc0kuc"
item_extraction then item_validation enforces one global delay
item_validation then style_profile enforces one global delay
Retry-After blocks all call kinds globally
runWithMistralRateLimit propagates errors
completed counts by kind are recorded if telemetry exists
```

Do not call Mistral.

---

## 12. Optional Local Verification Script

If the project has a safe script pattern, add a local verification command.

Example:

```text id="ahe1c4"
npm run verify:accuracy
```

or:

```text id="yb31eu"
npm run test:accuracy
```

The script should only run fixture/mock tests.

It must not:

```text id="djkctt"
call Mistral
upload images
write to Supabase
publish offers
delete extraction folders
```

If adding a script is risky, skip it and document the test command.

---

## 13. Optional Existing Extraction Package Dry Check

If the project already supports loading a local extraction package safely, optionally add a dry-run command or test helper that can inspect a completed package without publishing.

It should:

```text id="x4cu3x"
load manifest
load raw/canonical/validation artifacts
build preview summary
build accuracy report
print local summary
```

It must not:

```text id="r5d4ub"
call Mistral
upload images
upsert DB rows
modify source artifacts except writing report output if explicitly requested
```

If this is too risky, skip it.

---

## 14. Fix Small Integration Issues Found by Tests

If tests reveal small wiring issues, fix them.

Examples of acceptable fixes:

```text id="1j5p8v"
a canonical field not being copied into preview model
a warning code not being counted in report
a comparison exclusion not being applied to canonical offer
a skipped row accidentally marked preview_eligible
a DB mapper receiving unsupported metadata key
a manifest default missing for older packages
```

Do not make broad architectural rewrites in this chunk.

If a big issue is found, document it as a follow-up instead of rewriting large systems.

---

## 15. Report File for This Chunk

Create a short verification report:

```text id="k6jyjc"
wifran-offers-extractor/antigravity-reports/51-safe-local-verification-report.md
```

Include:

```text id="r8n1jz"
tests added
fixtures verified
commands run
commands skipped
pass/fail summary
remaining risks
manual verification checklist
recommended next step
```

---

## 16. Manual Verification Checklist

Add a checklist to the report.

It should include:

```text id="uvoi92"
Run fixture tests
Run typecheck
Open app locally
Load a completed extraction package
Confirm Pre-Publish Preview opens
Confirm crop grid displays
Confirm FIELD_NAME/VALUE rows display
Confirm Publish button is disabled until eligible state
Confirm opening preview does not publish
Confirm skipped rows are visible but not eligible
Confirm mock/dry mode does not upload
Confirm no direct DB update button bypasses preview
```

Do not perform real DB publishing.

---

## 17. Documentation Update

Update relevant docs briefly if they exist:

```text id="z3uul6"
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/accuracy-verification.md
```

Document:

```text id="0jynkf"
how to run safe local accuracy verification
what fixture cases are covered
that tests do not call Mistral or Supabase
how to interpret the verification report
what still requires manual QA
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
* Do not upload images during tests.
* Do not run real Mistral calls during tests.
* Do not write to Wifran DB during tests.
* Do not publish real offers during this chunk.
* Do not delete files in `Extracts/`.
* Do not add DB migrations.
* Do not add new DB columns.
* Do not log secrets or env values.
* Do not store absolute local paths in public DB payload tests unless explicitly mocked.

---

## 19. Acceptance Criteria

This chunk is complete when:

* Fixture-based end-to-end accuracy tests exist.
* Known failure cases are covered:

  * 1.5L
  * 730ml 1+1
  * 8×135g
  * per 2kg
  * electronics
  * old price as current price
  * missing title
  * missing offer price
* Pre-Publish Preview gate tests exist.
* DB sync is proven blocked until preview approval.
* Mocked DB sync receives only eligible rows.
* Accuracy report tests exist.
* Supabase metadata mapper dry-run tests exist.
* Shared queue tests exist or are updated.
* No tests call real Mistral.
* No tests call real Supabase.
* No tests upload images.
* No tests publish offers.
* TypeScript compiles.
* The app remains runnable.
* Verification report is created at:

```text id="0n07zl"
wifran-offers-extractor/antigravity-reports/51-safe-local-verification-report.md
```

---

## 20. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the safe local verification changes needed for this chunk, keep the app runnable, then stop.

Do not implement future chunks in this step.

---

## 21. Final Response Required From Antigravity

After finishing, provide a concise final summary with:

```text id="2atrn4"
files modified
files created
fixtures added/verified
tests added/updated
verification report path
commands run
commands skipped and why
whether typecheck passed
whether tests passed
remaining risks
recommended next step
```

The recommended next step should be:

```text id="l92mrl"
Manual QA with a copied local extraction package, no real DB publish until visually confirmed.
```
