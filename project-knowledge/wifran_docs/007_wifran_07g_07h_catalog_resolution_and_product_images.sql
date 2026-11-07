-- =========================================================================
-- Wifran Database Migration: 007_wifran_07g_07h_catalog_resolution_and_product_images.sql
-- =========================================================================
-- Document References:
-- - WIFRAN-07G Rev 1.1: Minimal CSV Product-Image Enrichment Workflow
-- - WIFRAN-07H: Catalog Product Resolution & Migration 007 Review
-- - WIFRAN-07J: Hybrid Product and Offer Visual Enrichment
--
-- Safety & Compatibility Guarantees:
-- 1. Sequential integer bigint product_id (starting at 1) with GENERATED ALWAYS AS IDENTITY
--    and BEFORE UPDATE immutability trigger to strictly prevent manual ID assignment/reuse.
-- 2. Preserves frozen wifran.extractor.offer/2.0 contract and original extraction-v2
--    assertions (exact_identity_status).
-- 3. Dedicated public.product_images table for verified, licensed catalog images.
-- 4. Dedicated public.offer_display_images table for approved illustrative offer visuals.
-- 5. Dedicated public.offer_visual_group_members table for deterministic visual-subject deduplication.
-- 6. product-images and offer-display-images storage buckets are public (read-only for consumers),
--    while offer-images bucket remains private (evidence only).
-- 7. Hardened public.v_consumer_offers and public.get_consumer_offers_for_shopping_date:
--    - Projects display_image_url and display_image_kind ('exact_product' | 'illustrative' | null).
--    - Replaces private leaflet crop URLs with approved catalog/offer visual URLs.
--    - Offers without verified images project NULL (never private crops!).
--    - build_sanitized_consumer_contract_v2 recursively scrubs private storage paths
--      from assets.offer_card and assets.product_thumbnail.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. Drop Dependent Views & Functions for Clean Type Alterations
-- -------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_consumer_offers CASCADE;
DROP FUNCTION IF EXISTS public.get_consumer_offers_for_shopping_date(date, text, text);
DROP FUNCTION IF EXISTS public.build_sanitized_consumer_contract_v2(jsonb);
DROP FUNCTION IF EXISTS public.build_sanitized_consumer_contract_v2(jsonb, text);
DROP FUNCTION IF EXISTS public.build_sanitized_consumer_contract_v2(jsonb, text, text);

-- -------------------------------------------------------------------------
-- 1. Convert public.products.id & Foreign Keys to Sequential Bigint (ALWAYS IDENTITY)
-- -------------------------------------------------------------------------
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_product_id_fkey;
ALTER TABLE public.product_aliases DROP CONSTRAINT IF EXISTS product_aliases_product_id_fkey;
ALTER TABLE public.watched_items DROP CONSTRAINT IF EXISTS watched_items_product_id_fkey;
ALTER TABLE public.shopping_list_items DROP CONSTRAINT IF EXISTS shopping_list_items_product_id_fkey;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS fk_products_approved_primary_image;
DROP TABLE IF EXISTS public.product_images CASCADE;
DROP TABLE IF EXISTS public.offer_display_images CASCADE;
DROP TABLE IF EXISTS public.offer_visual_group_members CASCADE;

DO $$
BEGIN
  -- Convert offers.product_id to bigint if it is currently uuid
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'product_id' AND data_type = 'uuid'
  ) THEN
    UPDATE public.offers SET product_id = NULL;
    ALTER TABLE public.offers ALTER COLUMN product_id TYPE bigint USING NULL;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'product_id'
  ) THEN
    ALTER TABLE public.offers ADD COLUMN product_id bigint;
  END IF;

  -- Convert product_aliases.product_id if uuid
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'product_aliases' AND column_name = 'product_id' AND data_type = 'uuid'
  ) THEN
    UPDATE public.product_aliases SET product_id = NULL;
    ALTER TABLE public.product_aliases ALTER COLUMN product_id TYPE bigint USING NULL;
  END IF;

  -- Convert watched_items.product_id if uuid
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'watched_items' AND column_name = 'product_id' AND data_type = 'uuid'
  ) THEN
    UPDATE public.watched_items SET product_id = NULL;
    ALTER TABLE public.watched_items ALTER COLUMN product_id TYPE bigint USING NULL;
  END IF;

  -- Convert shopping_list_items.product_id if uuid
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'shopping_list_items' AND column_name = 'product_id' AND data_type = 'uuid'
  ) THEN
    UPDATE public.shopping_list_items SET product_id = NULL;
    ALTER TABLE public.shopping_list_items ALTER COLUMN product_id TYPE bigint USING NULL;
  END IF;

  -- Convert products.id to identity bigint if uuid
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    DELETE FROM public.products;
    ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_pkey CASCADE;
    ALTER TABLE public.products DROP COLUMN id CASCADE;
    ALTER TABLE public.products ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'id' AND identity_generation = 'BY DEFAULT'
  ) THEN
    ALTER TABLE public.products ALTER COLUMN id SET GENERATED ALWAYS;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1.1 Product ID Immutability Trigger (WIFRAN-07J §8)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prevent_product_id_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'products.id is immutable and cannot be updated (current: %, attempted: %)', OLD.id, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_product_id_update ON public.products;
CREATE TRIGGER trg_prevent_product_id_update
BEFORE UPDATE OF id ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.fn_prevent_product_id_update();

-- -------------------------------------------------------------------------
-- 2. Extend public.products with Identity Fingerprint & Verification Provenance
-- -------------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS canonical_product_key text,
  ADD COLUMN IF NOT EXISTS item_name_complete text,
  ADD COLUMN IF NOT EXISTS brand_name text,
  ADD COLUMN IF NOT EXISTS variant_or_flavor text,
  ADD COLUMN IF NOT EXISTS each_size_value numeric,
  ADD COLUMN IF NOT EXISTS each_size_unit text,
  ADD COLUMN IF NOT EXISTS inner_pack_count integer,
  ADD COLUMN IF NOT EXISTS sale_unit_type text,
  ADD COLUMN IF NOT EXISTS gtin text,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS verification_basis text NOT NULL DEFAULT 'operator_verified_pack_identity',
  ADD COLUMN IF NOT EXISTS verified_by text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_primary_image_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_verification_status'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT chk_products_verification_status
      CHECK (verification_status IN ('candidate', 'verified', 'rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_products_canonical_product_key'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT uq_products_canonical_product_key
      UNIQUE (canonical_product_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_canonical_key ON public.products (canonical_product_key);
CREATE INDEX IF NOT EXISTS idx_products_verification_status ON public.products (verification_status);

-- Connect foreign keys back to public.products(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'offers_product_id_fkey'
  ) THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT offers_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_aliases') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_aliases_product_id_fkey') THEN
      ALTER TABLE public.product_aliases
        ADD CONSTRAINT product_aliases_product_id_fkey
        FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'watched_items') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watched_items_product_id_fkey') THEN
      ALTER TABLE public.watched_items
        ADD CONSTRAINT watched_items_product_id_fkey
        FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'shopping_list_items') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shopping_list_items_product_id_fkey') THEN
      ALTER TABLE public.shopping_list_items
        ADD CONSTRAINT shopping_list_items_product_id_fkey
        FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 3. Add Catalog-Resolution Provenance Columns to public.offers
-- -------------------------------------------------------------------------
-- Preserves original extractor assertions (exact_identity_status) intact.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS catalog_candidate_key text,
  ADD COLUMN IF NOT EXISTS catalog_match_status text NOT NULL DEFAULT 'unresolved',
  ADD COLUMN IF NOT EXISTS catalog_verification_basis text,
  ADD COLUMN IF NOT EXISTS catalog_verified_by text,
  ADD COLUMN IF NOT EXISTS catalog_verified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_offers_catalog_match_status'
  ) THEN
    ALTER TABLE public.offers
      ADD CONSTRAINT chk_offers_catalog_match_status
      CHECK (catalog_match_status IN (
        'unresolved',
        'candidate_pending_review',
        'verified_linked',
        'excluded_ambiguous',
        'conflict_needs_review'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_offers_product_id ON public.offers (product_id);
CREATE INDEX IF NOT EXISTS idx_offers_catalog_match_status ON public.offers (catalog_match_status);
CREATE INDEX IF NOT EXISTS idx_offers_catalog_candidate_key ON public.offers (catalog_candidate_key);

-- -------------------------------------------------------------------------
-- 4. Create public.product_images Table (product_id bigint) & Configure Bucket
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'alternate')),
  storage_bucket text NOT NULL DEFAULT 'product-images',
  storage_object_path text NOT NULL,
  public_url text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  content_sha256 text NOT NULL,
  source_url text NOT NULL,
  normalized_source_url text NOT NULL,
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  rights_basis text NOT NULL DEFAULT 'operator_manual_verified',
  reviewed_by text NOT NULL DEFAULT 'operator',
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Exactly one active approved primary image per product
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_active_primary
  ON public.product_images (product_id)
  WHERE role = 'primary' AND approval_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_product_images_sha256 ON public.product_images (content_sha256);
CREATE INDEX IF NOT EXISTS idx_product_images_norm_url ON public.product_images (normalized_source_url);
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON public.product_images (product_id);

-- Connect approved_primary_image_id FK on public.products
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_approved_primary_image'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT fk_products_approved_primary_image
      FOREIGN KEY (approved_primary_image_id) REFERENCES public.product_images(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Enable RLS on public.product_images
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to approved product images" ON public.product_images;
CREATE POLICY "Allow public read access to approved product images"
  ON public.product_images FOR SELECT
  USING (approval_status = 'approved');

DROP POLICY IF EXISTS "Allow service_role full access to product_images" ON public.product_images;
CREATE POLICY "Allow service_role full access to product_images"
  ON public.product_images FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Ensure public storage bucket product-images exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('product-images', 'product-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = true;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 4.1 Create public.offer_display_images Table (WIFRAN-07J §6)
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.offer_display_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'offer-display-images',
  storage_object_path text NOT NULL,
  public_url text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  content_sha256 text NOT NULL,
  source_kind text NOT NULL DEFAULT 'generated_illustration' CHECK (source_kind IN ('generated_illustration', 'generic_library', 'licensed_stock')),
  source_url text,
  normalized_source_url text,
  visual_subject_key text NOT NULL,
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  rights_basis text NOT NULL DEFAULT 'operator_manual_verified',
  reviewed_by text NOT NULL DEFAULT 'operator',
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Exactly one active approved illustrative image per offer
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_display_images_active
  ON public.offer_display_images (offer_id)
  WHERE approval_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_offer_display_images_subject ON public.offer_display_images (visual_subject_key);
CREATE INDEX IF NOT EXISTS idx_offer_display_images_sha256 ON public.offer_display_images (content_sha256);
CREATE INDEX IF NOT EXISTS idx_offer_display_images_offer_id ON public.offer_display_images (offer_id);

ALTER TABLE public.offer_display_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to approved offer display images" ON public.offer_display_images;
CREATE POLICY "Allow public read access to approved offer display images"
  ON public.offer_display_images FOR SELECT
  USING (approval_status = 'approved');

DROP POLICY IF EXISTS "Allow service_role full access to offer_display_images" ON public.offer_display_images;
CREATE POLICY "Allow service_role full access to offer_display_images"
  ON public.offer_display_images FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Ensure public storage bucket offer-display-images exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('offer-display-images', 'offer-display-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = true;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 4.2 Create public.offer_visual_group_members Table (WIFRAN-07J §3.6)
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.offer_visual_group_members (
  representative_offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  member_offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  visual_subject_key text NOT NULL,
  visual_subject_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (representative_offer_id, member_offer_id)
);

CREATE INDEX IF NOT EXISTS idx_visual_group_members_rep ON public.offer_visual_group_members (representative_offer_id);
CREATE INDEX IF NOT EXISTS idx_visual_group_members_mem ON public.offer_visual_group_members (member_offer_id);
CREATE INDEX IF NOT EXISTS idx_visual_group_members_subj ON public.offer_visual_group_members (visual_subject_key);

ALTER TABLE public.offer_visual_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to offer_visual_group_members" ON public.offer_visual_group_members;
CREATE POLICY "Allow public read access to offer_visual_group_members"
  ON public.offer_visual_group_members FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow service_role full access to offer_visual_group_members" ON public.offer_visual_group_members;
CREATE POLICY "Allow service_role full access to offer_visual_group_members"
  ON public.offer_visual_group_members FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -------------------------------------------------------------------------
-- 5. Update Sanitized Consumer Contract Function (Strip Private Evidence)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.build_sanitized_consumer_contract_v2(
  p_contract_v2 jsonb,
  p_approved_product_image_url text DEFAULT NULL,
  p_subject_scope text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_assets jsonb;
  v_clean_card jsonb;
  v_clean_thumb jsonb;
  v_scope text := COALESCE(p_subject_scope, CASE WHEN p_approved_product_image_url IS NOT NULL THEN 'product_package' ELSE 'unverified' END);
BEGIN
  IF p_contract_v2 IS NULL THEN
    RETURN NULL;
  END IF;

  v_assets := p_contract_v2->'assets';

  -- WIFRAN-07G §6.E, WIFRAN-07H §4, WIFRAN-07J §6: Strip all private offer-images crop paths and delivery URLs.
  -- Only populate delivery_url with the approved catalog product image or approved illustrative offer visual.
  v_clean_card := jsonb_build_object(
    'storage_bucket', CASE WHEN p_approved_product_image_url IS NOT NULL THEN 'product-images' ELSE NULL END,
    'storage_object_path', NULL,
    'delivery_url', p_approved_product_image_url,
    'subject_scope', v_scope,
    'upload_state', CASE WHEN p_approved_product_image_url IS NOT NULL THEN 'uploaded' ELSE COALESCE(v_assets->'offer_card'->>'upload_state', 'pending') END
  );

  v_clean_thumb := jsonb_build_object(
    'storage_bucket', CASE WHEN p_approved_product_image_url IS NOT NULL THEN 'product-images' ELSE NULL END,
    'storage_object_path', NULL,
    'delivery_url', p_approved_product_image_url,
    'subject_scope', v_scope,
    'upload_state', CASE WHEN p_approved_product_image_url IS NOT NULL THEN 'uploaded' ELSE COALESCE(v_assets->'product_thumbnail'->>'upload_state', 'pending') END
  );

  DECLARE
    v_assessments jsonb := COALESCE(p_contract_v2->'assessments', '{}'::jsonb);
    v_reason_codes jsonb := v_assessments->'reason_codes';
    v_has_image boolean := (p_approved_product_image_url IS NOT NULL);
  BEGIN
    IF v_has_image AND v_reason_codes IS NOT NULL AND jsonb_typeof(v_reason_codes) = 'array' THEN
      v_reason_codes := v_reason_codes - 'MEDIA_UPLOAD_PENDING';
      v_assessments := jsonb_set(v_assessments, '{reason_codes}', v_reason_codes);
    END IF;

    RETURN jsonb_build_object(
      'record_metadata', p_contract_v2->'record_metadata',
      'product_facts', p_contract_v2->'product_facts',
      'assortment', p_contract_v2->'assortment',
      'quantity_semantics', p_contract_v2->'quantity_semantics',
      'price_terms', p_contract_v2->'price_terms',
      'promotion_terms', p_contract_v2->'promotion_terms',
      'eligibility', p_contract_v2->'eligibility',
      'assessments', v_assessments,
      'assets', jsonb_build_object(
        'offer_card', v_clean_card,
        'product_thumbnail', v_clean_thumb
      )
    );
  END;
END;
$$;

-- Overloads for backward compatibility
CREATE OR REPLACE FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb, p_approved_product_image_url text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.build_sanitized_consumer_contract_v2(p_contract_v2, p_approved_product_image_url, NULL);
$$;

CREATE OR REPLACE FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.build_sanitized_consumer_contract_v2(p_contract_v2, NULL, NULL);
$$;

-- -------------------------------------------------------------------------
-- 6. Recreate Hardened public.v_consumer_offers (Hybrid Product & Offer Visuals)
-- -------------------------------------------------------------------------
-- WIFRAN-07J §6: Resolves exact product photo first, then approved illustrative offer visual,
-- otherwise neutral placeholder. Exposes display_image_url and display_image_kind.

DROP VIEW IF EXISTS public.v_consumer_offers CASCADE;

CREATE OR REPLACE VIEW public.v_consumer_offers
WITH (security_invoker = false)
AS
SELECT
  o.id,
  o.source_offer_id,
  o.source_revision,
  o.semantic_checksum,
  o.contract_version,
  o.compound_group_id,
  o.supersedes_source_offer_id,

  -- Supermarket & Geography Registry
  o.supermarket_id,
  s.name_ar AS supermarket_name_ar,
  s.name_en AS supermarket_name_en,
  s.slug AS supermarket_slug,
  s.code AS supermarket_code,
  s.logo_url AS supermarket_logo_url,
  o.location_scope,
  o.city_id,
  c.name_ar AS city_name_ar,
  c.name_en AS city_name_en,
  c.code AS city_code,
  o.region_id,
  r.name_ar AS region_name_ar,
  r.name_en AS region_name_en,
  r.code AS region_code,

  -- Product Facts & Taxonomy (product_id is bigint)
  o.product_id,
  o.exact_identity_status,
  o.category_id,
  cat.name_ar AS category_name_ar,
  cat.name_en AS category_name_en,
  COALESCE(o.category_slug, cat.slug) AS category_slug,
  o.derived_subcategory_slug,
  o.commodity_tag,
  o.item_domain,
  o.brand_id,
  b.name_ar AS brand_name_ar,
  b.name_en AS brand_name_en,
  o.brand_state,
  o.brand_candidate_text,
  o.title_ar,
  o.title_en,
  o.normalized_title_ar,
  o.normalized_title_en,
  o.product_attributes,

  -- Assortment & Quantity Semantics
  o.assortment_status,
  o.known_options,
  o.sale_unit_type,
  o.inner_pack_count,
  o.each_size_value,
  o.each_size_unit,
  o.total_content_value,
  o.total_content_unit,
  o.is_indivisible_sale_unit,

  -- Pricing, Promotions & Unit Math
  o.offer_price,
  o.original_price AS source_reported_original_price,
  o.verified_non_member_price,
  COALESCE(o.currency, 'SAR') AS currency,
  o.price_basis,
  o.unit_price,
  o.unit_price_unit,
  o.discount_amount,
  o.discount_percentage,
  o.informational_inner_unit_price,
  o.display_unit_price_label_ar,
  o.display_unit_price_label_en,
  o.promo_mechanic,
  o.bonus_wording,
  o.bonus_fulfillment,

  -- Eligibility & Limits
  o.is_loyalty_required,
  o.loyalty_requirement,
  o.quantity_limit,
  o.quantity_limit_value,
  o.quantity_limit_unit,
  o.quantity_limit_scope,

  -- Media & Visual Evidence (WIFRAN-07J §6: Approved Exact Product Photo or Approved Illustrative Offer Visual)
  COALESCE(pi.public_url, odi.public_url) AS image_url,
  COALESCE(pi.storage_object_path, odi.storage_object_path) AS storage_path,
  COALESCE(pi.public_url, odi.public_url) AS thumbnail_url,
  COALESCE(pi.storage_object_path, odi.storage_object_path) AS thumbnail_storage_path,

  -- Explicit Display Image Provenance (WIFRAN-07J §6)
  COALESCE(pi.public_url, odi.public_url) AS display_image_url,
  CASE
    WHEN pi.public_url IS NOT NULL THEN 'exact_product'
    WHEN odi.public_url IS NOT NULL THEN 'illustrative'
    ELSE NULL
  END AS display_image_kind,

  -- Role-specific Subject Scopes and Upload States
  CASE
    WHEN pi.public_url IS NOT NULL THEN 'product_package'
    WHEN odi.public_url IS NOT NULL THEN 'representative_assortment'
    ELSE COALESCE(o.image_subject_scope, 'unverified')
  END AS card_image_subject_scope,
  CASE
    WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded'
    ELSE COALESCE(o.contract_v2->'assets'->'offer_card'->>'upload_state', CASE WHEN o.image_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END)
  END AS card_image_upload_state,
  CASE
    WHEN pi.public_url IS NOT NULL THEN 'product_package'
    WHEN odi.public_url IS NOT NULL THEN 'representative_assortment'
    ELSE 'unverified'
  END AS thumbnail_subject_scope,
  CASE
    WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded'
    ELSE COALESCE(o.contract_v2->'assets'->'product_thumbnail'->>'upload_state', CASE WHEN o.thumbnail_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END)
  END AS thumbnail_upload_state,

  -- Spatial & Prominence
  o.page_area_share_pct,
  o.is_front_page,
  o.is_hero_offer,
  o.deal_score,
  o.deal_label,

  -- Temporal Validity (Dates & Evaluation in Asia/Riyadh timezone)
  o.offer_start_date,
  o.offer_end_date,
  o.offer_start_date AS valid_from,
  o.offer_end_date AS valid_to,
  'published'::text AS publication_status,
  CASE
    WHEN o.offer_start_date IS NOT NULL AND (now() AT TIME ZONE 'Asia/Riyadh')::date < o.offer_start_date THEN 'upcoming'
    WHEN (now() AT TIME ZONE 'Asia/Riyadh')::date > o.offer_end_date THEN 'expired'
    ELSE 'active'
  END AS temporal_lifecycle_state,

  -- Assessments & Reason Codes
  o.scoped_assessments,
  CASE
    WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN array_remove(o.reason_codes, 'MEDIA_UPLOAD_PENDING')
    ELSE o.reason_codes
  END AS reason_codes,

  -- Sanitized v2 Contract JSONB (contains only approved image URL; 0 private crop paths)
  public.build_sanitized_consumer_contract_v2(
    o.contract_v2,
    COALESCE(pi.public_url, odi.public_url),
    CASE WHEN pi.public_url IS NOT NULL THEN 'product_package' WHEN odi.public_url IS NOT NULL THEN 'representative_assortment' ELSE NULL END
  ) AS consumer_contract_v2,

  -- Timestamps
  o.published_at,
  o.created_at,
  o.updated_at

FROM public.offers o
JOIN public.supermarkets s ON o.supermarket_id = s.id
LEFT JOIN public.categories cat ON o.category_id = cat.id
LEFT JOIN public.cities c ON o.city_id = c.id
LEFT JOIN public.regions r ON o.region_id = r.id
LEFT JOIN public.brands b ON o.brand_id = b.id
LEFT JOIN public.product_images pi ON pi.product_id = o.product_id
  AND pi.role = 'primary'
  AND pi.approval_status = 'approved'
  AND o.catalog_match_status = 'verified_linked'
LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id
  AND odi.approval_status = 'approved'
WHERE o.status = 'published';

-- -------------------------------------------------------------------------
-- 7. Recreate Shopping Date & Geographic Access Function
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_consumer_offers_for_shopping_date(
  p_shopping_date date DEFAULT (now() AT TIME ZONE 'Asia/Riyadh')::date,
  p_city_id text DEFAULT NULL,
  p_region_id text DEFAULT NULL
)
RETURNS SETOF public.v_consumer_offers
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.*
  FROM public.v_consumer_offers v
  WHERE v.offer_start_date <= p_shopping_date
    AND v.offer_end_date >= p_shopping_date
    AND (
      v.location_scope = 'national'
      OR (p_city_id IS NOT NULL AND v.city_id = p_city_id)
      OR (p_region_id IS NOT NULL AND v.region_id = p_region_id)
      OR (
        p_city_id IS NOT NULL AND v.region_id = (
          SELECT c.region_id FROM public.cities c WHERE c.id = p_city_id LIMIT 1
        )
      )
    )
  ORDER BY v.deal_score DESC NULLS LAST, v.offer_price ASC;
$$;

-- -------------------------------------------------------------------------
-- 8. Grants and Permissions (WIFRAN-07G §6.B, WIFRAN-07H §4, WIFRAN-07J §6)
-- -------------------------------------------------------------------------
GRANT ALL ON public.products TO service_role;
GRANT SELECT ON public.products TO anon, authenticated;

GRANT ALL ON public.product_images TO service_role;
GRANT SELECT ON public.product_images TO anon, authenticated;

GRANT ALL ON public.offer_display_images TO service_role;
GRANT SELECT ON public.offer_display_images TO anon, authenticated;

GRANT ALL ON public.offer_visual_group_members TO service_role;
GRANT SELECT ON public.offer_visual_group_members TO anon, authenticated;

GRANT ALL ON public.v_consumer_offers TO service_role;
GRANT SELECT ON public.v_consumer_offers TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_consumer_offers_for_shopping_date(date, text, text) TO anon, authenticated;

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- =========================================================================
-- End of Migration 007_wifran_07g_07h_catalog_resolution_and_product_images.sql
-- =========================================================================
