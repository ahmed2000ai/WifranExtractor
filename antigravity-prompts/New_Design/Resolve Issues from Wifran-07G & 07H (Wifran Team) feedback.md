Read both:
- `docs/WifranTeamFeedback/Wifran-07G-Manual-CSV-Product-Image-Enrichment-Pilot.md` (`WIFRAN-07G` Rev 1.1)
- `docs/WifranTeamFeedback/Wifran-07H-Catalog-Resolution-and-Migration-007-Review.md` (`WIFRAN-07H`)

Implement the complete review-assisted Catalog Product Resolution workflow, Additive Migration `007`, and Manual CSV Product-Image Enrichment pipeline while strictly obeying every guardrail in `WIFRAN-07G` and `WIFRAN-07H` and keeping the frozen `wifran.extractor.offer/2.0` contract untouched.

Execute the following 6 tasks in order:

====================================================================
1. CREATE & APPLY MIGRATION `007_wifran_07g_07h_catalog_resolution_and_product_images.sql`
====================================================================
Inspect `project-knowledge/wifran_docs/001_initial_schema.sql` through `006_wifran_07a_security_and_contract_reconciliation.sql`, then create `project-knowledge/wifran_docs/007_wifran_07g_07h_catalog_resolution_and_product_images.sql` and apply it to our live `WifranV2` Supabase database AND PGlite test suite:

1. **Extend `public.products` with Identity Fingerprint & Verification Provenance (`WIFRAN-07H §2 & §4`):**
   - Add additive columns (`IF NOT EXISTS`) to `public.products`:
     * `canonical_product_key text UNIQUE` (deterministic fingerprint of brand + normalized title + variant/flavor + each_size_value + each_size_unit + inner_pack_count + sale_unit_type)
     * `item_name_complete text` (complete human-readable description including brand, variant/flavor, net weight/volume, pack quantity, and package type for the CSV `item_name` column)
     * `brand_name text`
     * `variant_or_flavor text`
     * `each_size_value numeric`
     * `each_size_unit text`
     * `inner_pack_count integer`
     * `sale_unit_type text`
     * `gtin text` (nullable; preferred when available)
     * `verification_status text NOT NULL DEFAULT 'verified' CHECK (verification_status IN ('candidate', 'verified', 'rejected'))`
     * `verification_basis text NOT NULL DEFAULT 'operator_verified_pack_identity'` (e.g. `'operator_verified_pack_identity'`, `'gtin_verified'`, `'verified_catalog_reuse'`)
     * `verified_by text`
     * `verified_at timestamptz`
     * `approved_primary_image_id uuid`

2. **Add Separate Catalog-Resolution Provenance Columns to `public.offers` (`WIFRAN-07H §3`):**
   - Do NOT overwrite `offers.exact_identity_status` or `contract_v2.product_facts.exact_identity_status` (keep original extractor assertions intact!).
   - Add additive columns to `public.offers` (`IF NOT EXISTS`):
     * `catalog_candidate_key text`
     * `catalog_match_status text NOT NULL DEFAULT 'unresolved' CHECK (catalog_match_status IN ('unresolved', 'candidate_pending_review', 'verified_linked', 'excluded_ambiguous', 'conflict_needs_review'))`
     * `catalog_verification_basis text`
     * `catalog_verified_by text`
     * `catalog_verified_at timestamptz`

3. **Create `public.product_images` Table & Configure `product-images` Storage Bucket (`WIFRAN-07G §6.B-C`, `WIFRAN-07H §4`):**
   - Create table `public.product_images`:
     * `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
     * `product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE`
     * `role text NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'alternate'))`
     * `storage_bucket text NOT NULL DEFAULT 'product-images'`
     * `storage_object_path text NOT NULL`
     * `public_url text NOT NULL`
     * `mime_type text NOT NULL`
     * `byte_size integer NOT NULL`
     * `content_sha256 text NOT NULL`
     * `source_url text NOT NULL`
     * `normalized_source_url text NOT NULL`
     * `approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'withdrawn'))`
     * `rights_basis text NOT NULL DEFAULT 'operator_manual_verified'`
     * `reviewed_by text NOT NULL DEFAULT 'operator'`
     * `reviewed_at timestamptz NOT NULL DEFAULT now()`
     * `created_at timestamptz NOT NULL DEFAULT now()`
     * `updated_at timestamptz NOT NULL DEFAULT now()`
   - Enforce one active approved primary image per product:
     `CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_active_primary ON public.product_images (product_id) WHERE role = 'primary' AND approval_status = 'approved';`
   - Index `content_sha256` and `normalized_source_url`.
   - Enable RLS on `public.product_images`: grant `SELECT` to `anon, authenticated` where `approval_status = 'approved'`, and `ALL` to `service_role`.
   - Ensure Supabase Storage bucket `product-images` exists with `public = true` (read-only public access for approved catalog images; write restricted to `service_role`), and confirm `offer-images` remains `public = false` (Private).

4. **Update `public.v_consumer_offers` & `public.get_consumer_offers_for_shopping_date` to Strip All Private Leaflet Evidence (`WIFRAN-07G §6.E`, `WIFRAN-07H §4`):**
   - Update `public.build_sanitized_consumer_contract_v2(p_contract jsonb, p_approved_product_image_url text DEFAULT NULL)` (and keep the 1-arg overload calling the 2-arg version with `NULL` so existing callers never break):
     * Inside the returned `consumer_contract_v2.assets.offer_card` and `consumer_contract_v2.assets.product_thumbnail`, strip ALL private `offer-images` URLs and storage paths (`storage_bucket: CASE WHEN p_approved_product_image_url IS NOT NULL THEN 'product-images' ELSE null END`, `storage_object_path: null`, `local_path_internal: null`, `delivery_url: p_approved_product_image_url`, `upload_state: CASE WHEN p_approved_product_image_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END`).
   - Recreate `public.v_consumer_offers` and `public.get_consumer_offers_for_shopping_date` preserving every existing column name and `WIFRAN-07D` price/loyalty semantics while joining `public.product_images pi ON pi.product_id = o.product_id AND pi.role = 'primary' AND pi.approval_status = 'approved' AND o.catalog_match_status = 'verified_linked'`:
     * `image_url`: `pi.public_url` (`NULL` when no approved product image is linked — NEVER fall back to `o.image_url`!)
     * `thumbnail_url`: `pi.public_url` (`NULL` when no approved product image is linked — NEVER fall back to `o.thumbnail_url`!)
     * `storage_path`: `pi.storage_object_path` (`NULL` when no approved product image is linked)
     * `thumbnail_storage_path`: `pi.storage_object_path` (`NULL` when no approved product image is linked)
     * `consumer_contract_v2`: `public.build_sanitized_consumer_contract_v2(o.contract_v2, pi.public_url)`

====================================================================
2. IMPLEMENT REVIEW-ASSISTED CATALOG PRODUCT RESOLUTION & RE-SYNC PROTECTION (`src/main/db/productCatalogResolutionService.ts` & `offerSyncService.ts`)
====================================================================
1. **Candidate Grouping vs. Operator Verification (`WIFRAN-07H §2`):**
   - Create `src/main/db/productCatalogResolutionService.ts`:
     * `analyzeOfferCatalogCandidates()`:
       - Inspects published offers in `public.offers`.
       - Automatically classifies ambiguous/ineligible offers as `excluded_ambiguous` (leaving `product_id = null`):
         a) Assortments (`assortment_status IN ('assortment_indicated', 'indicated_with_conflict', 'unknown_composition')`, e.g., assorted Dove 5+1 or assorted Mini Fan).
         b) Loose measured-weight unbranded commodities (`sale_unit_type = 'kg'` with `inner_pack_count IS NULL` and `brand_state != 'confirmed'`, e.g., Fresh Ethiopian Mutton per kg).
         c) Generic/unbranded appliances or items lacking concrete size/pack/model identity.
       - For single-product packaged goods with clear identity attributes (`assortment_status = 'single_product'`, concrete title, size/weight/volume or pack count):
         a) Computes deterministic `canonical_product_key` and complete `item_name_complete` (combining brand, English & Arabic title, variant/flavor, net weight/volume, and multipack count — WITHOUT conflating retailer-specific promo pricing with SKU identity).
         b) If a **verified** row in `public.products` with that exact `canonical_product_key` already exists and has no conflicting attributes, automatically links the offer (`product_id = existingProduct.id`, `catalog_match_status = 'verified_linked'`, `catalog_verification_basis = 'verified_catalog_reuse'`).
         c) Otherwise marks the offer `catalog_match_status = 'candidate_pending_review'` with `catalog_candidate_key = canonical_product_key` and returns the grouped candidates for operator review (showing offer titles, brand, size, pack, and private leaflet evidence paths for operator inspection).
     * `approveCatalogProductCandidates({ candidateKeys, verifiedBy, verificationBasis, gtinMap })`:
       - Requires explicit operator approval (`operatorConfirmedIdentity === true`).
       - Creates/upserts verified rows in `public.products` (`verification_status = 'verified'`) and links all matching candidate offers (`offers.product_id = product.id`, `offers.catalog_match_status = 'verified_linked'`, `catalog_verified_by = verifiedBy`, `catalog_verified_at = now()`).
       - Does NOT modify `offers.exact_identity_status`, `offers.contract_v2`, `offers.semantic_checksum`, or `offers.source_revision` (`WIFRAN-07H §3`)!

2. **Preserve Verified `product_id` Links Across Offer Re-Syncs (`WIFRAN-07H §3`):**
   - Update `src/main/db/offerSyncService.ts` (and `insertFullMappedOfferIntoPostgres` in our test suite):
     * Before upserting an offer on `source_offer_id`, check if the existing DB row already has a non-null `product_id` and `catalog_match_status = 'verified_linked'`.
     * When re-syncing/updating an offer whose incoming mapper payload has `product_id = null`:
       - If the product's core identity facts (title, brand, size, unit, inner_pack_count, assortment_status) have NOT contradicted the linked product, **preserve** the existing `product_id`, `catalog_match_status`, `catalog_verification_basis`, `catalog_verified_by`, and `catalog_verified_at`!
       - If a genuine conflicting change occurred in the re-synced offer, keep `product_id` or flag `catalog_match_status = 'conflict_needs_review'` rather than silently wiping out catalog history.

====================================================================
3. IMPLEMENT MANUAL CSV EXPORT, IMPORT VALIDATION & DEDUPLICATED IMAGE UPLOAD (`src/main/db/productImageEnrichmentService.ts`)
====================================================================
Implement `src/main/db/productImageEnrichmentService.ts` (with ZERO AI agent integration):

1. **`exportProductsForImageSearch()`:**
   - Queries `public.products` where `verification_status = 'verified'` AND no active approved primary image exists in `public.product_images` (unless replacement is explicitly requested).
   - Generates a strict 2-column CSV:
     ```csv
     Product_ID,item_name
     ```
   - One row per unique `products.id`. Never exports `offers.id` or unverified candidates.

2. **`validateProductImageCsvImport(csvContent)`:**
   - Accepts strictly 2 columns: `Product_ID,image_url`. Rejects extra columns or malformed headers.
   - Performs zero network requests during validation/preview.
   - Validates each `Product_ID` exists in `public.products` (`verification_status = 'verified'`), detects duplicate `Product_ID` rows in the CSV, detects conflicting URLs for the same `Product_ID`, skips blank `image_url` rows, and identifies products that already have an approved image.

3. **`uploadApprovedProductImagesToDb({ csvContent, operatorConfirmedReview, reviewedBy, rightsBasis })`:**
   - Throws an error unless `operatorConfirmedReview === true`.
   - Triggered ONLY when the operator clicks **Upload Product Images to DB**.
   - For each valid non-blank row:
     * If the product already has an approved primary image in `public.product_images`, reuses it without downloading (`reused++`).
     * Validates HTTPS URL and blocks private/internal IPs & hosts (SSRF guard), enforces timeout/redirect/size limits, and validates image magic bytes (`image/jpeg`, `image/png`, `image/webp`).
     * Computes `SHA-256` (`content_sha256`) of the image bytes.
     * Checks if `public.product_images` already has an asset with the same `content_sha256` (or normalized URL for the same product); reuses the existing storage object if identical bytes already exist for that product, while preventing indiscriminate linking of the same image across distinct product variants (`WIFRAN-07H §5`).
     * Uploads once to `product-images` bucket (`catalog/${productId}/${contentSha256.slice(0, 16)}.${ext}`), records internal approval/rights provenance in `public.product_images`, and updates `public.products.approved_primary_image_id`.
     * Never writes to `public.offers.image_url`.
   - Returns `{ newlyUploaded, reused, skipped, failed, failures }`.

====================================================================
4. WIRE IPC & ELECTRON UI (`ImportPage.tsx` & `preload/index.ts`)
====================================================================
Add the IPC handlers and UI panel in the Electron App supporting:
1. **Catalog Product Resolution Review Panel:**
   - "Analyze Offer Candidates" -> shows breakdown of Total Offers, Verified Linked Products, Candidate Groups Pending Review, and Excluded/Unresolved Offers, with an "Approve Selected Candidate Groups" button.
2. **CSV Image Enrichment Panel:**
   - **"Export Products for Image Search"** button -> downloads `Product_ID,item_name` CSV.
   - **"Import Product Image CSV"** selector -> previews validation counts without downloading.
   - Mandatory operator checkbox confirming manual match review and image-use permission verification.
   - **"Upload Product Images to DB"** button -> executes upload and displays `{ newlyUploaded, reused, skipped, failed }`.

====================================================================
5. EXECUTE REAL-DB TESTS & LIVE `WifranV2` PILOT (`WIFRAN-07H §6`)
====================================================================
1. Create `src/shared/utils/__tests__/wifran07g07hProductImageWorkflow.test.ts` (using PGlite PostgreSQL 16) testing all `WIFRAN-07G §7` & `WIFRAN-07H §6` requirements:
   - Candidate grouping does NOT auto-verify; operator approval creates verified `products` rows and sets `offers.product_id`.
   - Multi-offer reuse: 2+ supermarket offers for the same verified product share 1 `products.id` and resolve the same 1 approved `product_images` URL.
   - Re-sync regression test (`WIFRAN-07H §3`): re-syncing an offer with `prep.product_id = null` preserves its verified `offers.product_id` link and keeps `contract_v2` untouched!
   - Assorted Dove 5+1 (`J1`), Mini Fan (`J2`), and Fresh Mutton per kg (`J3`) remain `product_id = null` (`excluded_ambiguous`).
   - CSV export (`Product_ID,item_name`), CSV import validation (`Product_ID,image_url`), operator confirmation gate, SHA-256 deduplication, and idempotent re-import.
   - `anon` and `authenticated` queries on `public.v_consumer_offers` and `get_consumer_offers_for_shopping_date` return the approved `product-images` URL for linked offers, `null` for unlinked offers, ZERO private `offer-images` paths/URLs anywhere (including inside `consumer_contract_v2.assets`), and preserve `WIFRAN-07D