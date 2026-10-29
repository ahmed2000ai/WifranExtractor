# Antigravity Prompt Chunk 23: Align Wifran Location Scope, Image Contract, and Env Conventions

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 23. Prompt Chunks 01 to 22 should already have completed the extraction app, recall-first OCR settings, and Retry Only Failed OCR Chunks.

This chunk updates the existing extractor to match the latest Wifran-side schema, storage, environment, and ingestion contract files saved inside:

```text
project-knowledge/wifran_docs/
```

## 1. Read These Files First

Before coding, read all existing extractor knowledge files:

```text
project-knowledge/00-prd-wifran-offers-extractor.md
project-knowledge/01-product-brief-and-scope.md
project-knowledge/02-wifran-db-schema-and-sync-rules.md
project-knowledge/03-leaflet-extraction-rules.md
project-knowledge/04-ocr-api-and-bounding-box-spec.md
project-knowledge/05-processing-pipeline-and-error-handling.md
project-knowledge/06-env-security-and-credentials.md
project-knowledge/07-sample-extraction-json.md
project-knowledge/08-antigravity-development-plan.md
```

Then read all files inside:

```text
project-knowledge/wifran_docs/
```

Specifically read these files:

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

Treat `project-knowledge/wifran_docs/` as the latest Wifran-side source of truth for:

```text
database schema
offer location coverage
image storage
external ingestion contract
environment variable naming
production safety
```

If these files conflict with older extractor assumptions, prefer the `wifran_docs` files unless this prompt explicitly says otherwise.

Do not modify files inside `project-knowledge/` or `project-knowledge/wifran_docs/` unless this chunk explicitly instructs documentation updates there. Use them as reference material.

## 2. Goal of This Chunk

Align the extractor with Wifran’s latest production ingestion contract.

The extractor must now support:

```text
location_scope = national | region | city
city_id
region_id
offer-level coverage
brand-level supermarkets only
offer-images bucket
webp image output by default
Wifran-compatible image path format
leaflet_id
source_item_number
source_page_number
image_url
image_path
image_bucket
image_source_type
external_image_id
offer_source_id / offer_sources if schema supports it
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

This chunk must not change the final publishing behavior yet. Publishing behavior is handled in Chunk 24.

## 3. Important Architecture Correction

Do not create duplicate supermarket entities per city or region.

Correct model:

```text
One supermarket brand
Many offers
Each offer has city/region/national coverage
```

Incorrect model:

```text
Panda Riyadh
Panda Jeddah
Othaim Riyadh
Othaim Qassim
```

The extractor must resolve one brand-level `supermarket_id`, then apply coverage on each offer using:

```text
location_scope
city_id
region_id
```

Operator-selected coverage is trusted.

OCR-extracted or leaflet-visible location/supermarket/date text is untrusted and must not override the operator-selected context.

## 4. Required Files to Create or Update

Create or update files similar to:

```text
.env.example
src/main/config/env.ts
src/main/config/configStatus.ts
src/shared/types/importForm.ts
src/shared/types/referenceData.ts
src/shared/types/offerSync.ts
src/shared/types/offerPayload.ts
src/renderer/hooks/useImportForm.ts
src/renderer/pages/ImportPage.tsx
src/main/db/referenceDataService.ts
src/main/db/importTrackingMappers.ts
src/main/db/offerPayloadBuilder.ts
src/main/db/offerPreparationService.ts
src/main/db/offerSyncMapper.ts
src/main/db/offerSyncService.ts
src/main/storage/storagePathBuilder.ts
src/main/storage/offerImageStorageService.ts
src/shared/utils/slugify.ts
src/shared/utils/locationScopeValidation.ts
src/shared/utils/leafletId.ts
src/shared/utils/externalImageId.ts
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/security-notes.md
README.md
```

Adapt paths if the current project structure differs, but preserve the same responsibilities.

## 5. Environment Variable Alignment

Update the config loader so the only required operator-filled credentials are:

```env
MISTRAL_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Keep backward compatibility:

```text
SUPABASE_URL may still be accepted.
SUPABASE_ANON_KEY may still be accepted.
```

Mapping rules:

```text
Internal supabase.url:
  prefer SUPABASE_URL if present
  otherwise use NEXT_PUBLIC_SUPABASE_URL

Internal supabase.anonKey:
  prefer SUPABASE_ANON_KEY if present
  otherwise use NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` to renderer.

Do not expose `MISTRAL_API_KEY` to renderer.

Update `.env.example` so required credentials are clearly separated from safe defaults.

Recommended `.env.example` structure:

```env
# ============================================================
# Required credentials - operator must fill these
# ============================================================

MISTRAL_API_KEY=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ============================================================
# Safe defaults - usually do not change
# ============================================================

SUPABASE_STORAGE_BUCKET=offer-images

MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_OCR_ENDPOINT=https://api.mistral.ai/v1/ocr

OCR_CHUNK_SIZE=1
OCR_MAX_CONCURRENT_REQUESTS=1
OCR_MAX_RETRIES=5
OCR_RETRY_BASE_DELAY_MS=2000
OCR_REQUEST_TIMEOUT_MS=180000
OCR_CONFIDENCE_GRANULARITY=page
OCR_TABLE_FORMAT=markdown

PDF_RENDER_DPI=250
IMAGE_CROP_PADDING_PERCENT=8
IMAGE_OUTPUT_FORMAT=webp
IMAGE_OUTPUT_QUALITY=85

DEFAULT_OFFER_DURATION_DAYS=7
LOW_CONFIDENCE_THRESHOLD=0.75
DATA_QUALITY_NEEDS_REVIEW_THRESHOLD=70
SKIP_DUPLICATE_OFFERS=true
AUTO_CREATE_BRANDS=true
AUTO_CREATE_PRODUCTS=true
AUTO_CREATE_CATEGORIES=false
REQUIRE_IMAGE_FOR_DRAFT=false

DEBUG_SAVE_INTERMEDIATE_FILES=false
LOG_LEVEL=info

OCR_CONTINUE_ON_CHUNK_FAILURE=true
OCR_ALLOW_PARTIAL_IMPORT=true
OCR_RESPECT_RETRY_AFTER=true
OCR_MAX_ZERO_ITEM_CHUNKS_WARNING_THRESHOLD=5
```

Do not include real credentials.

## 6. Location Scope Form Update

Update the import form to use trusted operator-selected coverage context.

The operator must select:

```text
Supermarket
Coverage type:
  national
  region
  city
Region if coverage type = region
City if coverage type = city
Offer start date
Offer end date
```

Rules:

```text
national:
  location_scope = national
  city_id = null
  region_id = null

region:
  location_scope = region
  region_id required
  city_id = null

city:
  location_scope = city
  city_id required
  region_id optional, but should be derived from city when possible
```

Trusted operator context overrides anything detected from the leaflet.

OCR-extracted supermarket/date/location must not override operator-selected context.

## 7. Shared Types Update

Update import form and sync types to include:

```ts
locationScope: 'national' | 'region' | 'city';
cityId: string | null;
regionId: string | null;
coverageLabel: string;
locationSlug: string;
leafletId: string;
```

Update any older fields that assumed only city/region selection.

Do not remove backward compatibility unless needed.

## 8. Reference Data Loading Update

Update reference data loading so the app can support:

```text
supermarkets
cities
regions
supermarket_regions if available
```

The Import page should let the operator choose:

```text
National coverage
Region coverage from active regions
City coverage from active cities
```

If supermarket-region coverage exists and is reliable, use it to warn about unsupported combinations.

Do not block imports solely because a supermarket-region mapping is missing unless the schema or docs clearly require it.

## 9. Location Scope Validation Utility

Create:

```text
src/shared/utils/locationScopeValidation.ts
```

Implement:

```ts
export type LocationScope = 'national' | 'region' | 'city';

export function validateLocationScope(input: {
  locationScope: LocationScope;
  cityId: string | null;
  regionId: string | null;
}): {
  ok: boolean;
  errors: Array<{
    code: string;
    message: string;
  }>;
};
```

Required validation codes:

```text
INVALID_LOCATION_SCOPE
CITY_REQUIRED_FOR_CITY_SCOPE
REGION_REQUIRED_FOR_REGION_SCOPE
NATIONAL_SCOPE_MUST_NOT_HAVE_CITY_OR_REGION
REGION_SCOPE_MUST_NOT_HAVE_CITY
```

Use this validation before:

```text
PDF import start
import tracking persistence
offer payload preparation
offer sync
```

## 10. Leaflet ID Utility

Create:

```text
src/shared/utils/leafletId.ts
```

Implement:

```ts
export function buildLeafletId(input: {
  supermarketSlug: string;
  coverageScope: 'national' | 'region' | 'city';
  locationSlug: string;
  validTo: string;
}): string;
```

Recommended format:

```text
{supermarket_slug}-{coverage_scope}-{location_slug}-{valid_to}
```

Examples:

```text
panda-city-riyadh-2026-06-05
othaim-region-riyadh-region-2026-06-05
carrefour-national-saudi-arabia-2026-06-05
```

Rules:

```text
lowercase
URL/path safe
no spaces
avoid Arabic characters in storage paths when possible
fallback to ID or safe slugified value if slug missing
```

## 11. External Image ID Utility

Create:

```text
src/shared/utils/externalImageId.ts
```

Implement:

```ts
export function buildExternalImageId(input: {
  leafletId: string;
  sourceItemNumber: string;
}): string;
```

Recommended format:

```text
{leaflet_id}-{source_item_number}
```

Example:

```text
panda-city-riyadh-2026-06-05-001
```

This should be used for idempotency where the schema supports `external_image_id`.

## 12. Storage Path Contract Update

Update:

```text
src/main/storage/storagePathBuilder.ts
```

Replace any older path format such as:

```text
offers/{supermarket_slug}/{offer_start_date}/{batch_id}/page-{page}/item-{row}.jpg
```

with the Wifran contract format:

```text
{supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp
```

Examples:

```text
panda/city/riyadh/panda-city-riyadh-2026-06-05/001.webp
othaim/region/riyadh-region/othaim-region-riyadh-region-2026-06-05/001.webp
carrefour/national/saudi-arabia/carrefour-national-saudi-arabia-2026-06-05/001.webp
```

Default format must be:

```text
webp
```

The bucket must be:

```text
offer-images
```

Use `SUPABASE_STORAGE_BUCKET=offer-images` as safe default.

Do not include local absolute paths in storage paths.

Prevent path traversal.

## 13. Image Output Format Update

Update image cropping/upload defaults:

```env
IMAGE_OUTPUT_FORMAT=webp
IMAGE_OUTPUT_QUALITY=85
SUPABASE_STORAGE_BUCKET=offer-images
```

If local cropping currently outputs `jpg`, update it to output `webp` by default.

Still allow `jpg`, `jpeg`, and `png` if config explicitly sets them, but default to `webp`.

Recommended image constraints:

```text
600–1200 px wide where resizing is implemented
1–2 MB max where practical
preserve full offer visual
do not crop out price, product name, pack size, discount labels, loyalty labels, or promotion conditions
```

Do not use stock product images.

Use leaflet item crops only.

## 14. Offer Source / Leaflet Source Alignment

Inspect the actual schema in:

```text
project-knowledge/wifran_docs/001_initial_schema.sql
project-knowledge/wifran_docs/004_offer_image_ingestion_metadata.sql
```

If `offer_sources` exists, update import tracking and offer sync to create or reuse an offer source row with available fields such as:

```text
supermarket_id
location_scope
city_id
region_id
valid_from
valid_to
source_reference
source_url
leaflet_id
storage_prefix
image_count
```

Only use columns that exist in the actual schema.

If `offer_sources` does not exist, document this and continue using import batch metadata only.

Do not add migrations in this chunk unless the extractor repo already manages Wifran migrations and the missing columns are clearly required. Prefer adapting to the existing Wifran schema.

## 15. Offer Image Metadata Mapping

Update offer preparation/sync so final offer insert/update payloads include schema-supported image/source fields:

```text
image_url
image_path
image_bucket
image_source_type
source_page_number
source_item_number
source_reference
external_image_id
offer_source_id
```

Expected values:

```text
image_bucket = offer-images
image_source_type = leaflet_crop or external_tool depending on schema/contract
source_page_number = original leaflet page number
source_item_number = stable item number like 001
source_reference = leaflet/source reference if available
external_image_id = {leaflet_id}-{source_item_number}
offer_source_id = created/reused offer source id if available
```

Use exact column names from the SQL schema.

If a column does not exist, do not insert it.

## 16. Source Item Number Rules

Generate stable item numbers for extracted offer rows.

Recommended:

```text
001
002
003
...
```

Sort order should be deterministic:

```text
page_number ascending
y coordinate ascending
x coordinate ascending
row_id fallback
```

Attach `source_item_number` to:

```text
normalized data
crop metadata
storage path
offer payload
offer sync result
```

Do not use random item numbers.

## 17. Location Slug Rules

For storage path and leaflet ID:

```text
national:
  location_slug = saudi-arabia

region:
  location_slug = region slug, e.g. riyadh-region

city:
  location_slug = city slug, e.g. riyadh
```

If slug is missing, create a safe fallback from name or ID.

Do not use raw Arabic names in storage paths unless slugification handles them safely.

## 18. Duplicate / Idempotency Alignment

Update duplicate detection and final sync to prefer these idempotency keys when schema supports them:

```text
external_image_id
offer_source_id + source_item_number
leaflet_id + source_item_number
supermarket_id + location_scope + city_id/region_id + offer_end_date + product/title + pack fields
```

If `external_image_id` exists on `offers`, use it for exact rerun safety.

If not, continue using the existing duplicate detection fallback.

Do not create duplicate offers when the same leaflet is processed again.

## 19. Import Report Update

Update results/reporting to show:

```text
leaflet_id
location_scope
coverage label
storage prefix
source item numbers
image upload successes
image upload failures
offer source id if available
external image ids
```

Keep existing OCR/crop/sync row statuses.

## 20. Documentation Update

Update:

```text
README.md
docs/operator/operator-user-guide.md
docs/operator/troubleshooting-guide.md
docs/developer/security-notes.md
```

Document:

```text
supermarkets are brand-level
offers carry location_scope/city_id/region_id
trusted operator-selected coverage overrides OCR
offer-images bucket is used
webp is default image format
storage path format
leaflet_id format
external_image_id format
only four credentials are normally required
service role key stays main-process only
```

## 21. Tests / Smoke Checks

Update or add tests/smoke checks for:

```text
NEXT_PUBLIC_SUPABASE_URL maps correctly
NEXT_PUBLIC_SUPABASE_ANON_KEY maps correctly
location_scope validation
national scope rejects city/region
region scope requires region
city scope requires city
leaflet_id generation
external_image_id generation
storage path generation
webp default output
source_item_number deterministic generation
offer payload includes supported image metadata
unsupported columns are not inserted
duplicate detection uses external_image_id when available
```

Run:

```bash
npm run typecheck
npm run validate:fixtures
npm run test:smoke
npm run test
```

If one script does not exist, do not invent a passing result. Either add the script properly if appropriate or document that it is unavailable.

## 22. Security Rules for This Chunk

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
* Do not publish offers automatically in this chunk.
* Do not add database migrations unless the current extractor project explicitly manages Wifran migrations and the change is strictly required.
* Do not delete existing Wifran data.
* Do not modify customer user data.
* Do not create duplicate supermarket entities per city or region.
* Do not create offers from promotional/banner rows.
* Do not upload images outside the `offer-images` bucket.
* Do not store image binaries in Postgres.

## 23. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 24. Acceptance Criteria

This chunk is complete when:

* Import form supports `national`, `region`, and `city` coverage.
* Trusted operator-selected coverage is used for all imported offers.
* Supermarkets remain brand-level entities.
* `location_scope`, `city_id`, and `region_id` rules are validated.
* `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are supported.
* Storage bucket defaults to `offer-images`.
* Image output defaults to `webp`.
* Storage paths follow `{supermarket_slug}/{coverage_scope}/{location_slug}/{leaflet_id}/{item_number}.webp`.
* `leaflet_id` is generated deterministically.
* `source_item_number` is generated deterministically.
* `external_image_id` is generated where supported.
* Offer source/leaflet tracking is created or reused where schema supports it.
* Offer image metadata maps to actual supported schema columns.
* Duplicate detection/idempotency uses external/source item keys where possible.
* Results/report shows leaflet/source/image metadata.
* Documentation is updated.
* Tests or smoke checks cover the new behavior.
* TypeScript compiles.
* Existing fixture validation passes.
* App still starts.

## 25. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How location scope is represented.
* How import form changed.
* How leaflet_id is generated.
* How source_item_number is generated.
* How image storage paths changed.
* How image metadata maps to the DB.
* How env variables changed.
* How duplicate/idempotency behavior changed.
* Any schema assumptions.
* Any issues or TODOs.

Keep the project runnable after this chunk.