# Antigravity Prompt Chunk 04: Supabase Connection and Reference Data Loading

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 04. Prompt Chunks 01, 02, and 03 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, and basic UI shell.

## 1. Read These Files First

Before coding, read all files inside:

```text
project-knowledge/
```

Specifically read:

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

Treat these files as the source of truth.

## 2. Goal of This Prompt Chunk

Implement Supabase connection logic and load Wifran reference data needed by the import form.

This chunk should connect to the existing Wifran Supabase database and load safe reference data such as supermarkets, cities, regions, supermarket-region coverage, categories, brands, and units.

Do **not** implement offer import/sync yet.

Do **not** create `offer_sources` yet.

Do **not** create `import_batches` yet.

Do **not** insert `import_rows` yet.

Do **not** insert `offers` yet.

Do **not** implement OCR yet.

Do **not** implement PDF selection yet.

Do **not** implement PDF splitting/rendering yet.

Do **not** implement image cropping yet.

Do **not** add database migrations.

## 3. Supabase Security Requirements

The app uses Supabase for Wifran data.

The existing config from earlier chunks should include:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
```

For this chunk:

* Create Supabase client code only in the Electron main process.
* Use `SUPABASE_SERVICE_ROLE_KEY` only in the main process.
* Do not expose the service role key to the renderer.
* Do not expose the Supabase admin client to the renderer.
* Do not expose generic database query IPC.
* Renderer may request safe reference data only through narrow IPC handlers.

The renderer must never directly import Supabase client code.

## 4. Required Files to Create or Update

Create or update files similar to:

```text
src/main/db/supabaseAdminClient.ts
src/main/db/referenceDataService.ts
src/main/ipc/referenceDataIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/shared/types/referenceData.ts
src/preload/index.ts
src/renderer/hooks/useReferenceData.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/SettingsPage.tsx
README.md
```

Adapt paths if the existing structure differs, but preserve responsibilities.

## 5. Install Required Package

If not already installed, install:

```text
@supabase/supabase-js
```

Use the current stable version available in the project environment.

Do not install unnecessary database packages.

## 6. Main-Process Supabase Admin Client

Create:

```text
src/main/db/supabaseAdminClient.ts
```

Responsibilities:

* Read validated config from the main-process config loader.
* Create a Supabase client using:

  * `SUPABASE_URL`
  * `SUPABASE_SERVICE_ROLE_KEY`
* Export a function such as:

```ts
export function getSupabaseAdminClient(): SupabaseClient;
```

Rules:

* The service role key must never be returned through IPC.
* Do not log the service role key.
* Do not expose this client to renderer code.
* Do not create a generic SQL execution helper.
* Use this admin client only through specific service functions.

## 7. Shared Reference Data Types

Create:

```text
src/shared/types/referenceData.ts
```

Add renderer-safe types.

Recommended types:

```ts
export type SupermarketReference = {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  slug: string | null;
  logo_url: string | null;
  is_active: boolean;
  sort_order: number | null;
};

export type CityReference = {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  slug: string | null;
  country_code: string | null;
  is_active: boolean;
  sort_order: number | null;
};

export type RegionReference = {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  slug: string | null;
  is_active: boolean;
};

export type SupermarketRegionReference = {
  id: string;
  supermarket_id: string;
  city_id: string | null;
  region_id: string | null;
  is_active: boolean;
};

export type CategoryReference = {
  id: string;
  parent_id: string | null;
  name_ar: string | null;
  name_en: string | null;
  slug: string | null;
  is_active: boolean;
  sort_order: number | null;
  requires_unit_price?: boolean | null;
  default_unit_type?: string | null;
};

export type BrandReference = {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  slug: string | null;
  is_active: boolean;
};

export type UnitReference = {
  id: string;
  code: string;
  name_ar: string | null;
  name_en: string | null;
  symbol_ar: string | null;
  symbol_en: string | null;
  base_unit_code: string | null;
  conversion_to_base: number | null;
  is_active: boolean;
  sort_order: number | null;
};

export type ReferenceDataBundle = {
  supermarkets: SupermarketReference[];
  cities: CityReference[];
  regions: RegionReference[];
  supermarketRegions: SupermarketRegionReference[];
  categories: CategoryReference[];
  brands: BrandReference[];
  units: UnitReference[];
};

export type ReferenceDataLoadResult = {
  ok: boolean;
  data?: ReferenceDataBundle;
  error?: string;
};
```

Adjust nullable fields if TypeScript/Supabase inference requires it, but keep renderer-safe fields only.

## 8. Reference Data Service

Create:

```text
src/main/db/referenceDataService.ts
```

Implement functions:

```ts
export async function loadSupermarkets(): Promise<SupermarketReference[]>;
export async function loadCities(): Promise<CityReference[]>;
export async function loadRegions(): Promise<RegionReference[]>;
export async function loadSupermarketRegions(): Promise<SupermarketRegionReference[]>;
export async function loadCategories(): Promise<CategoryReference[]>;
export async function loadBrands(): Promise<BrandReference[]>;
export async function loadUnits(): Promise<UnitReference[]>;
export async function loadReferenceDataBundle(): Promise<ReferenceDataBundle>;
```

## 9. Database Tables to Read

Read from these Wifran tables:

```text
supermarkets
cities
regions
supermarket_regions
categories
brands
units
```

Use the schema described in:

```text
project-knowledge/02-wifran-db-schema-and-sync-rules.md
```

Only fetch fields needed for reference data.

## 10. Filtering Rules

For MVP, load only active records where applicable:

```text
is_active = true
```

Tables:

```text
supermarkets
cities
regions
supermarket_regions
categories
brands
units
```

If any table does not have `is_active` due to schema mismatch, handle gracefully and document the assumption.

Order records where applicable:

```text
sort_order ascending
name_en ascending
name_ar ascending
```

Do not fail the whole app if one optional reference table is empty, but do show a clear error if required tables fail.

Required for import form:

```text
supermarkets
cities OR regions
supermarket_regions
```

Important supporting data:

```text
categories
brands
units
```

## 11. Error Handling Rules

If Supabase config is missing:

* Do not attempt DB calls.
* Return safe error message.
* Do not expose keys.

If Supabase request fails:

* Return safe error message.
* Log safe details only.
* Do not log service role key.
* Do not crash renderer.

Example safe error:

```text
Failed to load supermarkets from Wifran database. Check Supabase configuration and network connection.
```

Do not show raw secrets or authorization headers.

## 12. Reference Data IPC

Create:

```text
src/main/ipc/referenceDataIpc.ts
```

Register narrow IPC handlers:

```text
reference:loadAll
reference:loadSupermarkets
reference:loadLocationsForSupermarket
```

Recommended behavior:

### `reference:loadAll`

Returns `ReferenceDataLoadResult`.

### `reference:loadSupermarkets`

Returns active supermarkets only.

### `reference:loadLocationsForSupermarket`

Input:

```ts
{
  supermarketId: string;
}
```

Returns cities/regions supported by that supermarket using `supermarket_regions`.

Do not create generic handlers such as:

```text
db:query
db:select
sql:execute
```

Update:

```text
src/main/ipc/registerIpcHandlers.ts
```

so it registers the new reference-data IPC handlers.

## 13. Preload API Update

Update:

```text
src/preload/index.ts
```

Expose safe reference APIs:

```ts
window.wifranExtractor.reference = {
  loadAll: () => Promise<ReferenceDataLoadResult>,
  loadSupermarkets: () => Promise<ReferenceDataLoadResult>,
  loadLocationsForSupermarket: (supermarketId: string) => Promise<ReferenceDataLoadResult>
};
```

Adapt return types if you split result types.

Do not expose generic IPC.

Do not expose Supabase client.

Do not expose environment variables.

Update renderer/global TypeScript declarations accordingly.

## 14. Renderer Hook

Create:

```text
src/renderer/hooks/useReferenceData.ts
```

This hook should:

* Call `window.wifranExtractor.reference.loadAll()`.
* Track loading state.
* Track error state.
* Store reference data.
* Provide a reload function.
* Avoid throwing uncaught exceptions.

Recommended return shape:

```ts
{
  data: ReferenceDataBundle | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}
```

## 15. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

Replace placeholder dropdowns with real reference-data-driven dropdowns:

### Supermarket Dropdown

* Loaded from `referenceData.supermarkets`.
* Show `name_en`, `name_ar`, or slug fallback.
* Required field.
* Show loading/error/empty states.

### Location Dropdown

Use `supermarket_regions` to filter valid locations after a supermarket is selected.

The app should support:

* City options.
* Region options.
* Both if available.

Location option display examples:

```text
City: Riyadh / الرياض
Region: Central Region / المنطقة الوسطى
```

The selected location should preserve:

```ts
{
  cityId: string | null;
  regionId: string | null;
}
```

Rules:

* Require at least one of cityId or regionId before import can later start.
* If selected supermarket has no mapped locations, show clear warning.
* Do not let user select invalid supermarket/location pair if mappings exist.

### Category/Brand/Unit Data

Do not yet expose category/brand/unit UI unless useful for debugging.

For now, just load them and show counts in a small reference-data status panel.

## 16. Settings Page Integration

Update Settings page to show reference data connection status:

```text
Supermarkets loaded: count
Cities loaded: count
Regions loaded: count
Supermarket-region mappings loaded: count
Categories loaded: count
Brands loaded: count
Units loaded: count
```

Show errors safely.

Do not show secrets.

## 17. Loading and Empty States

The Import page should show:

* Loading state while fetching reference data.
* Error state if DB loading fails.
* Empty state if no active supermarkets found.
* Empty state if selected supermarket has no city/region coverage.

Do not crash if arrays are empty.

## 18. Validation Added in This Chunk

The Import page should now validate:

```text
supermarket selected
city or region selected
```

Keep PDF selection as a placeholder until the next chunk.

Do not start extraction yet.

## 19. README Update

Update README with:

* Supabase reference data loading added.
* Required Supabase env variables.
* Reference tables used.
* How to troubleshoot missing/empty dropdowns.
* Reminder that no offer import/sync exists yet.

## 20. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real Supabase keys.
* Do not expose service role key to renderer.
* Do not expose Supabase client to renderer.
* Do not expose generic DB query IPC.
* Do not add database migrations.
* Do not write to any database table.
* Do not insert or update offers.
* Do not create brands/products/categories.
* Do not implement OCR.
* Do not implement PDF processing.
* Do not implement image cropping.
* Do not create offers from banners or promotional areas.

This chunk is read-only from the database.

## 21. Acceptance Criteria

This chunk is complete when:

* Supabase admin client exists in main process only.
* Reference data service can load active supermarkets, cities, regions, supermarket_regions, categories, brands, and units.
* Safe IPC exposes only reference-data methods.
* Preload exposes safe reference API only.
* Renderer can load and display supermarket dropdown.
* Renderer can filter and display location options based on selected supermarket.
* Settings or Import page shows reference-data counts.
* Errors are handled safely.
* Service role key is not exposed to renderer.
* No database writes are implemented.
* TypeScript compiles.
* App still starts.

## 22. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* Which reference tables are loaded.
* How supermarket/location filtering works.
* How the service role key is protected.
* Any assumptions made about schema fields.
* Any issues or TODOs.

Keep the project runnable after this chunk.