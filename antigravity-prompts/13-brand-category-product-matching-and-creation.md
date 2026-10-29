# Antigravity Prompt Chunk 13: Brand, Category, Product Matching and Creation

You are working inside the `wifran-offers-extractor` project.

This is Prompt Chunk 13. Prompt Chunks 01 to 12 should already have created the Electron + React + TypeScript skeleton, secure environment/config handling, UI shell, Supabase read-only reference data loading, validated import form, local PDF preprocessing, OCR schemas/validation, Mistral OCR integration, controlled OCR pipeline, promotional/banner filtering, local image cropping, and import tracking persistence.

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

Implement database matching and safe creation for:

```text
brands
categories
products
product_aliases
```

This chunk should take normalized OCR rows and prepare product references for final offer creation later.

This chunk should:

```text
match existing brands
create missing brands when allowed
match existing categories
avoid creating categories by default
match existing products
create missing products when allowed
create product aliases for OCR names
attach matched IDs to normalized row data
save warnings/errors for uncertain matching
show matching results in the UI
```

This chunk must **not** create final `offers` records yet.

Do **not** upload images to Supabase Storage yet.

Do **not** implement duplicate offer detection yet.

Do **not** insert final offers yet.

Do **not** publish offers.

Do **not** add database migrations.

## 3. Required Files to Create or Update

Create or update files similar to:

```text
src/shared/types/entityMatching.ts
src/shared/utils/textNormalization.ts
src/shared/utils/slugify.ts
src/main/db/entityMatchingTypes.ts
src/main/db/brandMatchingService.ts
src/main/db/categoryMatchingService.ts
src/main/db/productMatchingService.ts
src/main/db/productAliasService.ts
src/main/db/entityMatchingService.ts
src/main/ipc/entityMatchingIpc.ts
src/main/ipc/registerIpcHandlers.ts
src/preload/index.ts
src/shared/types/preload.ts
src/renderer/hooks/useEntityMatching.ts
src/renderer/pages/ImportPage.tsx
src/renderer/pages/ResultsPage.tsx
src/renderer/pages/LogsPage.tsx
README.md
```

Adapt paths if the existing project structure differs, but preserve these responsibilities.

## 4. Database Tables Used in This Chunk

This chunk may read from:

```text
brands
categories
products
product_aliases
units
```

This chunk may write to:

```text
brands
products
product_aliases
validation_errors
import_rows
```

Only update `import_rows.normalized_data` and possibly `import_rows.status` when attaching matched IDs and matching warnings.

This chunk must not write to:

```text
offers
offer_sources
import_batches except optional count/status update if already needed
saved_offers
watched_items
shopping_lists
profiles
```

This chunk must not add migrations.

## 5. Supabase Security Requirements

All database reads and writes must happen in the Electron main process.

Rules:

* Use the existing Supabase admin client in the main process.
* Do not expose service role key to renderer.
* Do not expose Supabase client to renderer.
* Do not expose generic DB query IPC.
* Do not create raw SQL execution methods.
* Validate renderer input before database writes.

Forbidden IPC methods:

```text
db:query
db:insert
sql:execute
supabase:raw
```

Only create narrow entity-matching IPC methods.

## 6. Shared Matching Types

Create:

```text
src/shared/types/entityMatching.ts
```

Add renderer-safe types.

Recommended:

```ts
export type EntityMatchingInputRow = {
  importRowId?: string | null;
  rowNumber?: number | null;
  rowId: string;
  pageNumber: number;
  status: 'valid' | 'warning' | 'error' | 'skipped';
  skipReason?: string | null;
  rawData?: unknown;
  normalizedData: unknown;
};

export type EntityMatchingOptions = {
  autoCreateBrands: boolean;
  autoCreateProducts: boolean;
  autoCreateCategories: boolean;
};

export type EntityMatchIssue = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  fieldName?: string | null;
  message: string;
};

export type MatchedEntityIds = {
  brandId: string | null;
  categoryId: string | null;
  productId: string | null;
};

export type EntityMatchingRowResult = {
  rowId: string;
  importRowId?: string | null;
  rowNumber?: number | null;
  status: 'matched' | 'warning' | 'error' | 'skipped';
  matched: MatchedEntityIds;
  created: {
    brandCreated: boolean;
    productCreated: boolean;
    aliasCreated: boolean;
    categoryCreated: boolean;
  };
  updatedNormalizedData: unknown;
  issues: EntityMatchIssue[];
};

export type EntityMatchingInput = {
  importBatchId?: string | null;
  rows: EntityMatchingInputRow[];
  options: EntityMatchingOptions;
};

export type EntityMatchingResult = {
  ok: boolean;
  totalRows: number;
  matchedRows: number;
  warningRows: number;
  errorRows: number;
  skippedRows: number;
  brandsCreated: number;
  productsCreated: number;
  aliasesCreated: number;
  categoriesCreated: number;
  results: EntityMatchingRowResult[];
  error?: {
    code: string;
    message: string;
  };
};
```

Adjust based on existing normalized row types if needed.

## 7. Text Normalization Utility

Create:

```text
src/shared/utils/textNormalization.ts
```

Implement helpers:

```ts
export function normalizeArabicText(value: string | null | undefined): string | null;
export function normalizeEnglishText(value: string | null | undefined): string | null;
export function normalizeSearchText(value: string | null | undefined): string | null;
export function isMeaningfulText(value: string | null | undefined): boolean;
```

Normalization should:

```text
trim whitespace
collapse repeated spaces
lowercase English text
remove harmless punctuation for comparison
normalize Arabic letter variants where safe
remove tatweel
normalize Arabic/English numerals
return null for empty strings
```

Do not mutate original OCR text used for display. Use normalized text only for matching.

## 8. Slug Utility

Create:

```text
src/shared/utils/slugify.ts
```

Implement:

```ts
export function createSlug(input: string): string;
export function ensureSlugFallback(input: {
  preferred?: string | null;
  fallback?: string | null;
  prefix: string;
}): string;
```

Rules:

* Prefer English name if available.
* If no English name exists, use Arabic text safely.
* Lowercase.
* Replace whitespace with hyphens.
* Remove unsafe punctuation.
* Avoid empty slugs.
* Add fallback prefix if needed.

Uniqueness should be handled in DB service by checking existing slugs and appending a suffix if needed.

## 9. Matching Issue Codes

Add or confirm these validation codes:

```text
BRAND_MATCH_UNCERTAIN
BRAND_CREATE_FAILED
CATEGORY_MATCH_UNCERTAIN
CATEGORY_CREATE_DISABLED
CATEGORY_CREATE_FAILED
PRODUCT_MATCH_UNCERTAIN
PRODUCT_CREATE_FAILED
PRODUCT_ALIAS_CREATE_FAILED
PRODUCT_NAME_MISSING
ENTITY_MATCHING_SKIPPED_ROW
ENTITY_MATCHING_FAILED
```

Use existing severity rules:

```text
error
warning
info
```

## 10. Brand Matching Service

Create:

```text
src/main/db/brandMatchingService.ts
```

Implement logic:

```ts
export async function matchOrCreateBrand(input: {
  brandNameAr: string | null;
  brandNameEn: string | null;
  autoCreate: boolean;
}): Promise<{
  brandId: string | null;
  created: boolean;
  issues: EntityMatchIssue[];
}>;
```

Matching order:

```text
1. If both brand names are missing, return null with no error.
2. Normalize Arabic and English names.
3. Exact match by name_ar or name_en.
4. Slug match.
5. Optional simple fuzzy/contains match only if safe.
6. If confident match exists, reuse brand.
7. If no match and autoCreate = true, create brand.
8. If no match and autoCreate = false, return warning.
```

Brand creation rules:

```text
Do not invent brand names.
Do not create a brand for skipped promotional rows.
Create only if at least one brand name exists.
Generate unique slug.
Set is_active = true if field exists.
```

If creation fails, return `BRAND_CREATE_FAILED`.

## 11. Category Matching Service

Create:

```text
src/main/db/categoryMatchingService.ts
```

Implement:

```ts
export async function matchOrCreateCategory(input: {
  categoryNameAr: string | null;
  categoryNameEn: string | null;
  autoCreate: boolean;
}): Promise<{
  categoryId: string | null;
  created: boolean;
  issues: EntityMatchIssue[];
}>;
```

Matching order:

```text
1. If category names are missing, return null with warning CATEGORY_MATCH_UNCERTAIN.
2. Normalize Arabic and English names.
3. Exact match by name_ar or name_en.
4. Slug match.
5. Optional safe fuzzy match.
6. If confident match exists, reuse category.
7. If no match and autoCreate = false, return null with CATEGORY_CREATE_DISABLED or CATEGORY_MATCH_UNCERTAIN.
8. If no match and autoCreate = true, create category only if clean and safe.
```

MVP default:

```text
AUTO_CREATE_CATEGORIES=false
```

Do not create categories by default.

If category is missing or uncertain, the row can still proceed with warning unless DB constraints require a category.

## 12. Product Matching Service

Create:

```text
src/main/db/productMatchingService.ts
```

Implement:

```ts
export async function matchOrCreateProduct(input: {
  productNameAr: string | null;
  productNameEn: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  brandId: string | null;
  categoryId: string | null;
  packSizeValue?: number | null;
  packSizeUnit?: string | null;
  autoCreate: boolean;
}): Promise<{
  productId: string | null;
  created: boolean;
  issues: EntityMatchIssue[];
}>;
```

Matching order:

```text
1. If both product names are missing, return error PRODUCT_NAME_MISSING.
2. Normalize Arabic and English names.
3. Search product_aliases.alias_text.
4. Exact match products.name_ar or products.name_en.
5. Slug match.
6. Match by brand_id + product name if available.
7. Optional safe fuzzy match only if confidence is high.
8. If confident match exists, reuse product.
9. If no confident match and autoCreate = true, create product.
10. If no confident match and autoCreate = false, return error/warning according to whether final offer requires product_id.
```

Product creation rules:

```text
Do not create a product if both names are missing.
Do not create product for skipped promotional rows.
Set category_id when available.
Set brand_id when available.
Set name_ar/name_en from OCR.
Set slug.
Set default_pack_size_value and default_pack_size_unit if clear.
Set is_normalized = false.
Set is_active = true if field exists.
```

If creation fails, return `PRODUCT_CREATE_FAILED`.

## 13. Product Alias Service

Create:

```text
src/main/db/productAliasService.ts
```

Implement:

```ts
export async function ensureProductAliases(input: {
  productId: string;
  aliases: Array<{
    aliasText: string;
    language: 'ar' | 'en' | 'mixed' | 'unknown';
    source: string;
  }>;
}): Promise<{
  createdCount: number;
  issues: EntityMatchIssue[];
}>;
```

Rules:

* Add aliases for raw OCR product names when meaningful.
* Do not duplicate existing alias for same product.
* Use source:

```text
wifran_offers_extractor
```

Language rules:

```text
Arabic text -> ar
English text -> en
Mixed -> mixed
Unknown -> unknown
```

If alias creation fails, return warning `PRODUCT_ALIAS_CREATE_FAILED`.

Alias failure should not block the row if product exists.

## 14. Entity Matching Orchestration Service

Create:

```text
src/main/db/entityMatchingService.ts
```

Implement:

```ts
export async function matchEntitiesForRows(
  input: EntityMatchingInput
): Promise<EntityMatchingResult>;
```

Responsibilities:

1. Validate input.
2. Skip rows with `status = skipped`.
3. Skip rows with `skipReason = NON_PRODUCT_PROMOTIONAL_AREA`.
4. Skip or error rows with blocking OCR errors.
5. Extract product/brand/category fields from normalized row.
6. Match/create brand.
7. Match category.
8. Match/create product.
9. Ensure aliases.
10. Attach matched IDs to `normalizedData.matched`.
11. Add issues to normalized row.
12. Update `import_rows.normalized_data` if `importRowId` exists.
13. Insert `validation_errors` for new matching issues if `importBatchId` and `importRowId` exist.
14. Return row-level results.

Do not create offers.

## 15. Normalized Data Shape Update

Update normalized row data to include:

```json
{
  "matched": {
    "product_id": "uuid-or-null",
    "brand_id": "uuid-or-null",
    "category_id": "uuid-or-null",
    "duplicate_offer_id": null
  }
}
```

If `matched` object already exists, update it safely.

Do not remove existing OCR/crop metadata.

## 16. Import Row Update Rules

If `importRowId` exists:

* Update `import_rows.normalized_data` with matched IDs.
* If matching produced warnings but row was `valid`, update status to `warning`.
* If matching produced blocking product error, update status to `error`.
* Do not set `created_offer_id`.
* Do not mark row as `imported`.

If no `importRowId` exists:

* Return matching result in memory only.
* Do not fail just because import tracking was not persisted yet.

## 17. Validation Error Persistence

If `importBatchId` and `importRowId` exist:

Create `validation_errors` for matching issues.

Examples:

```json
{
  "severity": "warning",
  "field_name": "category_id",
  "error_code": "CATEGORY_MATCH_UNCERTAIN",
  "message": "No confident category match was found. Offer can proceed as needs_review later."
}
```

Do not insert duplicate validation errors if the same code/field already exists for the row, if this is easy to check.

## 18. IPC Requirements

Create:

```text
src/main/ipc/entityMatchingIpc.ts
```

Add narrow IPC handler:

```text
entityMatching:matchRows
```

Input:

```ts
EntityMatchingInput
```

Output:

```ts
EntityMatchingResult
```

Do not expose generic DB IPC.

Update:

```text
src/main/ipc/registerIpcHandlers.ts
```

to register entity matching IPC.

## 19. Preload API Requirements

Update preload to expose:

```ts
window.wifranExtractor.entityMatching = {
  matchRows: (
    input: EntityMatchingInput
  ) => Promise<EntityMatchingResult>
};
```

Do not expose raw `ipcRenderer`.

Do not expose Supabase client.

Do not expose service role key.

## 20. Renderer Hook

Create:

```text
src/renderer/hooks/useEntityMatching.ts
```

Responsibilities:

* Start matching.
* Track running state.
* Store result.
* Store error.
* Provide reset function.

Recommended return shape:

```ts
{
  running: boolean;
  result: EntityMatchingResult | null;
  error: string | null;
  matchRows: (input: EntityMatchingInput) => Promise<void>;
  reset: () => void;
}
```

## 21. Import Page Integration

Update:

```text
src/renderer/pages/ImportPage.tsx
```

After import tracking has been saved, add a section:

```text
Match Products, Brands, and Categories
```

Show:

```text
Rows ready for matching
Auto-create brands: true/false
Auto-create products: true/false
Auto-create categories: true/false
```

Use values from safe config status:

```text
AUTO_CREATE_BRANDS
AUTO_CREATE_PRODUCTS
AUTO_CREATE_CATEGORIES
```

Add button:

```text
Match Entities
```

Enable only when:

```text
import tracking has been saved OR OCR normalized rows exist
not currently matching
Supabase config is ready
```

When clicked:

* Build `EntityMatchingInput`.
* Prefer using `importRowId` values from persisted import rows if available.
* Include `importBatchId` if available.
* Include normalized OCR/crop rows.
* Call `window.wifranExtractor.entityMatching.matchRows`.
* Show result summary.

## 22. Results Page Integration

Update:

```text
src/renderer/pages/ResultsPage.tsx
```

Show matching columns:

```text
Brand ID
Category ID
Product ID
Created Brand?
Created Product?
Alias Created?
Matching Issues
```

Add summary cards:

```text
Matched rows
Matching warnings
Matching errors
Brands created
Products created
Aliases created
Categories created
```

No final offer IDs yet.

## 23. Logs Page Integration

Update logs with messages such as:

```text
Matching brands, categories, and products.
Created brand: ...
Created product: ...
Added product alias.
Category match uncertain for row page-3-item-2.
Entity matching completed.
```

Do not log secrets.

Avoid excessive logging for every row if there are many; summaries are enough.

## 24. Error Handling

Handle:

```text
missing Supabase config
invalid input rows
missing product name
brand lookup failure
brand create failure
category lookup failure
category create disabled
category create failure
product alias lookup failure
product lookup failure
product create failure
import row update failure
validation error insert failure
```

One row failure should not stop all rows.

Return row-level errors.

## 25. README Update

Update README with:

* Brand/category/product matching added.
* Brands/products may be auto-created based on config.
* Categories are not auto-created by default.
* Product aliases are created for OCR names.
* No final offers are created yet.
* Supabase service role key remains main-process only.
* How to run matching after import tracking.

## 26. Security Rules for This Chunk

You must follow these rules:

* Do not create `.env.local`.
* Do not hardcode real keys.
* Do not expose secrets in renderer.
* Do not expose `process.env` to renderer.
* Do not expose Supabase admin client to renderer.
* Do not expose generic DB IPC.
* Do not upload files to Supabase Storage.
* Do not insert final `offers`.
* Do not implement duplicate offer detection yet.
* Do not publish offers.
* Do not add database migrations.
* Do not delete existing Wifran data.
* Do not create products/brands/categories for promotional/banner rows.

## 27. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue. Make all code/file changes needed to complete the chunk, then stop only after the full chunk is finished and provide the final summary.

## 28. Acceptance Criteria

This chunk is complete when:

* Brand matching works by exact name and slug.
* Brand creation works when enabled and safe.
* Category matching works.
* Category creation is disabled by default.
* Product matching works by alias/name/slug where possible.
* Product creation works when enabled and safe.
* Product aliases are created for OCR names.
* Skipped promotional/banner rows are not matched or created.
* Matched IDs are attached to normalized row data.
* Import rows are updated when persisted row IDs are available.
* Matching issues are saved to validation_errors when possible.
* Results UI shows matching status and created counts.
* No final offers are created.
* No image upload is implemented.
* TypeScript compiles.
* App still starts.

## 29. After Finishing

At the end, summarize:

* Files created.
* Files modified.
* How brand matching works.
* How category matching works.
* How product matching works.
* How aliases are created.
* How skipped promotional rows are protected.
* Which tables are read/written.
* Any assumptions made about schema fields.
* Any issues or TODOs.

Keep the project runnable after this chunk.