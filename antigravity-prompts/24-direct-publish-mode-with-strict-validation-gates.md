# Antigravity Prompt Chunk 24: Direct Publish Mode With Strict Validation Gates

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 24. Prompt Chunk 23 should already have aligned the extractor with Wifran’s latest location-scope, image storage, leaflet source, and environment conventions.

This chunk updates the final offer status workflow.

Earlier chunks intentionally created offers as `draft` or `needs_review` for safety. The latest product/business requirement for this external trusted ingestion tool is that valid imported rows should default to:

```text
status = published
```

This chunk implements direct publishing, but only after strict validation gates pass.

## 1. Read These Files First

Before coding, read these extractor project files:

```text
project-knowledge/02-wifran-db-schema-and-sync-rules.md
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/06-env-security-and-credentials.md
```

Then read all files inside:

```text
project-knowledge/wifran_docs/
```

Specifically read:

```text
project-knowledge/wifran_docs/00-master-ai-product-planning-prompt.md
project-knowledge/wifran_docs/001_initial_schema.sql
project-knowledge/wifran_docs/001_seed_core_catalog.sql
project-knowledge/wifran_docs/002_seed_beta_demo_data.sql
project-knowledge/wifran_docs/003_offer_location_scope.sql
project-knowledge/wifran_docs/004_offer_image_ingestion_metadata.sql
project-knowledge/wifran_docs/20-offer-location-scope-and-coverage-rules.md
project-knowledge/wifran_docs/28-offer-location-scope-city-region-national.md
project-knowledge/wifran_docs/29-offer-image-storage-and-external-tool-ingestion-readiness.md
project-knowledge/wifran_docs/external-offer-ingestion-tool.md
project-knowledge/wifran_docs/offer-images-bucket.md
project-knowledge/wifran_docs/production-env-verification.md
```

Also inspect the current implementation files:

```text
src/main/config/env.ts
src/main/db/offerPayloadBuilder.ts
src/main/db/offerPreparationService.ts
src/main/db/offerSyncMapper.ts
src/main/db/offerSyncService.ts
src/main/db/duplicateOfferService.ts
src/shared/types/offerPayload.ts
src/shared/types/offerSync.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/SettingsPage.tsx
src/renderer/pages/ResultsPage.tsx
```

Important conflict note:

```text
Some older docs may recommend needs_review until the tool is proven reliable.
For this chunk, implement configurable direct publish mode because the current business requirement is valid rows default to published.
Keep needs_review as a safer configurable fallback for testing/staging.
```

Do not modify files inside `project-knowledge/` or `project-knowledge/wifran_docs/` unless this prompt explicitly asks to update documentation there. Use them as reference material.

## 2. Goal of This Chunk

Implement configurable import status behavior with:

```env
IMPORT_DEFAULT_STATUS=published
```

Valid rows should become live in Wifran immediately after successful ingestion, subject to Wifran’s normal active-offer rules:

```text
status = published
offer_start_date <= today OR offer_start_date is null
offer_end_date >= today
location matches selected/default city or region
```

Rows with blocking validation errors must never be published.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
.env.example
src/main/config/env.ts
src/main/config/configStatus.ts
src/shared/types/offerPayload.ts
src/shared/types/offerSync.ts
src/shared/schemas/validationCodes.ts
src/shared/utils/publishValidation.ts
src/main/db/offerPayloadBuilder.ts
src/main/db/offerPreparationService.ts
src/main/db/offerSyncMapper.ts
src/main/db/offerSyncService.ts
src/main/db/duplicateOfferService.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/SettingsPage.tsx
src/renderer/pages/ResultsPage.tsx
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/security-notes.md
README.md
```

Adapt paths if the current project structure differs.

## 4. Configuration Update

Add or update config:

```env
IMPORT_DEFAULT_STATUS=published
ALLOW_NEEDS_REVIEW_FALLBACK=true
PUBLISH_WARNINGS_ALLOWED=true
```

Default values:

```text
IMPORT_DEFAULT_STATUS=published
ALLOW_NEEDS_REVIEW_FALLBACK=true
PUBLISH_WARNINGS_ALLOWED=true
```

Allowed `IMPORT_DEFAULT_STATUS` values:

```text
published
needs_review
```

Do not keep `draft` as the default import status for this external ingestion tool.

If existing code uses `DEFAULT_OFFER_STATUS`, keep backward compatibility but map it carefully:

```text
IMPORT_DEFAULT_STATUS takes precedence.
DEFAULT_OFFER_STATUS is deprecated for final sync.
If DEFAULT_OFFER_STATUS exists and IMPORT_DEFAULT_STATUS is missing, use DEFAULT_OFFER_STATUS only if valid.
If DEFAULT_OFFER_STATUS=draft and IMPORT_DEFAULT_STATUS is missing, warn and map to needs_review, not published.
```

Renderer config status should show:

```text
Import default status: published / needs_review
Needs-review fallback: enabled / disabled
Warnings allowed for publishing: yes / no
```

Update `.env.example` to include:

```env
IMPORT_DEFAULT_STATUS=published
ALLOW_NEEDS_REVIEW_FALLBACK=true
PUBLISH_WARNINGS_ALLOWED=true
```

## 5. Publishing Validation Utility

Create:

```text
src/shared/utils/publishValidation.ts
```

Implement:

```ts
export type PublishValidationInput = {
  supermarketId: string | null;
  locationScope: 'national' | 'region' | 'city' | null;
  cityId: string | null;
  regionId: string | null;
  offerStartDate: string | null;
  offerEndDate: string | null;
  titleAr: string | null;
  titleEn: string | null;
  offerPrice: number | null;
  imagePath?: string | null;
  imageUrl?: string | null;
  storagePath?: string | null;
  rowStatus?: string | null;
  skipReason?: string | null;
  duplicateOfferId?: string | null;
};

export function validateCanPublishOffer(input: PublishValidationInput): {
  canPublish: boolean;
  blockingErrors: Array<{
    code: string;
    fieldName?: string | null;
    message: string;
  }>;
  warnings: Array<{
    code: string;
    fieldName?: string | null;
    message: string;
  }>;
};
```

The function must be pure and safe for shared use.

## 6. Required Publishing Gates

A row can be inserted or updated with:

```text
status = published
```

only if all required gates pass:

```text
supermarket_id resolved
location_scope is valid: national / region / city
national scope has no city_id or region_id
region scope has region_id and no city_id
city scope has city_id
offer_end_date is valid
offer_end_date is not expired
offer_start_date is valid or null
offer_price is valid and greater than 0
title_ar or title_en exists
row is not skipped
row is not duplicate
row is not NON_PRODUCT_PROMOTIONAL_AREA
row is not isolated price / old price / badge / SKU / branch note / unit note fragment
storage path is safe if image is present
database insert/upsert succeeds
```

If any gate fails:

```text
Do not publish.
```

## 7. Blocking Error Codes

Add or confirm these codes:

```text
UNRESOLVED_SUPERMARKET
INVALID_LOCATION_SCOPE
CITY_REQUIRED_FOR_CITY_SCOPE
REGION_REQUIRED_FOR_REGION_SCOPE
INVALID_LOCATION_SCOPE_COMBINATION
EXPIRED_OFFER_END_DATE
INVALID_OFFER_END_DATE
INVALID_OFFER_START_DATE
MISSING_VALID_OFFER_PRICE
MISSING_TITLE
UNSAFE_IMAGE_PATH
DATABASE_INSERT_FAILED
DUPLICATE_OFFER_DETECTED
NON_PRODUCT_PROMOTIONAL_AREA
ISOLATED_PRICE_WITHOUT_PRODUCT
OLD_PRICE_ONLY_ROW
DISCOUNT_BADGE_ONLY_ROW
SKU_ONLY_ROW
BRANCH_NOTE_ONLY_ROW
UNIT_NOTE_ONLY_ROW
```

Rows with these errors must not be published.

## 8. Non-Blocking Warning Codes

Rows may still be published if only these warnings exist and core gates pass:

```text
MISSING_ORIGINAL_PRICE
MISSING_BRAND
MISSING_PRODUCT_REFERENCE
MISSING_PRODUCT_ID
MISSING_CATEGORY_IF_NOT_REQUIRED
LOW_CONFIDENCE_PACK_SIZE
CATEGORY_MAPPED_TO_FALLBACK
IMAGE_UPLOAD_FAILED_WHEN_IMAGE_OPTIONAL
OFFER_IMAGE_MISSING_WHEN_IMAGE_OPTIONAL
LOW_CONFIDENCE_EXTRACTION
PACK_DATA_AMBIGUOUS
PRODUCT_BLOCK_ASSOCIATION_UNCERTAIN
```

If `PUBLISH_WARNINGS_ALLOWED=false`, rows with warnings should be inserted as `needs_review`, not `published`.

## 9. Needs-Review Fallback

If `ALLOW_NEEDS_REVIEW_FALLBACK=true`, rows that fail non-core optional quality checks may be inserted as:

```text
status = needs_review
```

Rows with true blocking errors must be skipped/rejected, not inserted.

Default behavior:

```text
Valid rows with no blocking errors -> published
Rows with non-blocking warnings -> published if PUBLISH_WARNINGS_ALLOWED=true
Rows with non-blocking warnings -> needs_review if PUBLISH_WARNINGS_ALLOWED=false
Rows with blocking errors -> skipped/rejected
Optional severe fallback -> needs_review only if it does not violate DB constraints and is explicitly safe
```

Never publish blocking-error rows.

## 10. Offer Payload Type Update

Update `PreparedOfferPayload` and sync payload types to allow:

```text
published
needs_review
```

Remove assumptions that final sync only allows:

```text
draft
needs_review
```

Do not use `draft` for final external ingestion unless the actual schema requires it and the Wifran docs confirm it.

## 11. Offer Preparation Update

Update:

```text
src/main/db/offerPayloadBuilder.ts
src/main/db/offerPreparationService.ts
```

Rules:

```text
Build payload candidates.
Run publish validation.
Assign desired final status based on config.
Attach blocking errors and warnings.
Do not prepare publishable payload for skipped/promotional/duplicate/error rows.
```

Status assignment:

```text
If IMPORT_DEFAULT_STATUS=published and publish gates pass:
  payload.status = published

If IMPORT_DEFAULT_STATUS=needs_review and minimum DB insert gates pass:
  payload.status = needs_review

If publish gates fail but fallback to needs_review is allowed and DB minimum gates pass:
  payload.status = needs_review

If blocking errors fail DB minimum gates:
  no payload
  row status = error or skipped
```

## 12. Offer Sync Update

Update:

```text
src/main/db/offerSyncMapper.ts
src/main/db/offerSyncService.ts
```

Rules:

```text
Insert/update valid payloads into offers.
Use status from prepared payload.
Allow published and needs_review.
Never convert blocking-error rows to published.
Never insert promotional/banner rows.
Never insert isolated price/SKU/badge/note rows.
Never insert duplicate rows as new offers.
```

If duplicate matching finds an existing offer:

```text
Update existing offer safely if idempotency key matches same leaflet/source item.
Otherwise skip as duplicate.
```

When updating an existing valid offer from the same external ID:

```text
Keep or set status according to IMPORT_DEFAULT_STATUS.
If current mode is published and gates pass, status may become published.
```

## 13. Active Offer Protection

Do not weaken Wifran’s active offer logic.

The extractor should only write status, dates, and location correctly.

It must not modify public query logic.

A valid published offer becomes public only if Wifran’s existing public rules match:

```text
status = published
date active
location matches selected/default location
```

## 14. UI Updates

Update Import page final sync section.

Clearly display:

```text
Import default status: published
Rows eligible for publishing
Rows with warnings that will still publish
Rows that will be needs_review
Rows blocked from publishing
Duplicate rows
Promotional/skipped rows
```

Before final sync, show a clear operator notice:

```text
Valid rows will be created or updated as published and may become live in Wifran immediately after sync.
```

This is an operator-facing UI notice, not a developer approval step.

Do not ask for intermediate approvals during implementation.

## 15. Results Page Update

Update Results page summary cards:

```text
Published offers
Needs review offers
Skipped blocking-error rows
Updated existing offers
Duplicate skipped rows
Rows with warnings
Image upload failures
```

Update row table to show:

```text
Final status: published / needs_review / skipped / error / duplicate
Blocking errors
Warnings
Created or updated offer ID
```

## 16. Import Report Update

Update final sync result/report to include:

```text
publishedRows
needsReviewRows
updatedRows
skippedRows
blockingErrorRows
warningRows
duplicateRows
imageUploadSuccesses
imageUploadFailures
```

If existing result types use different field names, add backward-compatible fields or map clearly.

## 17. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/security-notes.md
```

Document:

```text
Valid rows default to published.
Published rows may become live immediately.
Blocking-error rows are never published.
Rows with warnings may publish if PUBLISH_WARNINGS_ALLOWED=true.
needs_review fallback is available when configured.
Operator should review import report after sync.
```

Add this warning:

```text
Use IMPORT_DEFAULT_STATUS=needs_review for early testing/staging.
Use IMPORT_DEFAULT_STATUS=published only after real leaflet QA confirms extraction quality.
```

Even though default is published, document the safer testing option.

## 18. Tests / Smoke Checks

Update tests/smoke checks for:

```text
IMPORT_DEFAULT_STATUS defaults to published
published is accepted as final status
draft is not the final default
valid row with all gates passes -> published
valid row with non-blocking warning -> published when PUBLISH_WARNINGS_ALLOWED=true
valid row with non-blocking warning -> needs_review when PUBLISH_WARNINGS_ALLOWED=false
missing price -> not published
missing title -> not published
expired offer_end_date -> not published
invalid location_scope -> not published
city scope without city_id -> not published
region scope without region_id -> not published
national scope with city_id/region_id -> not published
promotional row -> not published
duplicate row -> not inserted as new published offer
isolated price/SKU/badge/note row -> not published
image missing optional -> published or needs_review according to config
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If one script does not exist, do not invent a passing result. Either add the script properly if appropriate or document that it is unavailable.

## 19. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not include real keys in docs.
* Do not expose secrets in renderer.
* Do not expose service role key to renderer.
* Do not expose Mistral API key to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose raw Mistral client to renderer.
* Do not expose generic IPC.
* Do not add database migrations unless explicitly required by current codebase workflow.
* Do not delete existing Wifran data.
* Do not modify customer user data.
* Do not publish rows with blocking errors.
* Do not publish promotional/banner rows.
* Do not publish isolated price, old price, discount badge, SKU-only, branch-note-only, or unit-note-only rows.
* Do not bypass location-scope validation.
* Do not weaken public active-offer filtering.

## 20. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 21. Acceptance Criteria

This chunk is complete when:

* `IMPORT_DEFAULT_STATUS=published` is supported and defaulted.
* `needs_review` fallback is supported.
* `published` and `needs_review` are the only final ingestion statuses unless schema requires otherwise.
* Strict publishing gates exist.
* Rows with blocking errors are not published.
* Rows with non-blocking warnings can publish when configured.
* Valid rows can be inserted/updated as `published`.
* UI clearly shows which rows will publish.
* Results page shows published/needs-review/skipped/error counts.
* Final import report includes published/updated/skipped/error counts.
* Documentation explains direct publishing and validation gates.
* Tests or smoke checks cover status and publishing validation behavior.
* TypeScript compiles.
* Existing fixture validation passes.
* App still starts.

## 22. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How `IMPORT_DEFAULT_STATUS` works.
* How publishing gates work.
* Which errors block publishing.
* Which warnings can still publish.
* How needs-review fallback works.
* How UI/reporting changed.
* Any schema assumptions.
* Any issues or TODOs.

Keep the project runnable after this chunk.