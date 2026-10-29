-- =========================================================================
-- Wifran Database Migration: 005_wifran_v2_offer_contract.sql
-- Description: Additive upgrade for wifran.extractor.offer/2.0 contract
-- Non-destructive: preserves all existing 001-004 schema, tables, and rows
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Add v2 Contract Columns to public.offers
-- -------------------------------------------------------------------------

-- 1.1 Durable Identity, Revisions & Integrity
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS source_offer_id text,
  ADD COLUMN IF NOT EXISTS source_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS semantic_checksum text,
  ADD COLUMN IF NOT EXISTS contract_version text,
  ADD COLUMN IF NOT EXISTS compound_group_id text,
  ADD COLUMN IF NOT EXISTS supersedes_source_offer_id text;

-- 1.2 Product Facts & Domain Taxonomy
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS exact_identity_status text NOT NULL DEFAULT 'unresolved',
  ADD COLUMN IF NOT EXISTS category_slug text,
  ADD COLUMN IF NOT EXISTS derived_subcategory_slug text,
  ADD COLUMN IF NOT EXISTS commodity_tag text,
  ADD COLUMN IF NOT EXISTS item_domain text NOT NULL DEFAULT 'grocery',
  ADD COLUMN IF NOT EXISTS brand_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS brand_candidate_text text,
  ADD COLUMN IF NOT EXISTS normalized_title_ar text,
  ADD COLUMN IF NOT EXISTS normalized_title_en text,
  ADD COLUMN IF NOT EXISTS product_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 1.3 Assortment & Quantity Semantics (inner_pack_count is nullable for measured items INT-F05)
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS assortment_status text NOT NULL DEFAULT 'unknown_composition',
  ADD COLUMN IF NOT EXISTS known_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sale_unit_type text NOT NULL DEFAULT 'pack',
  ADD COLUMN IF NOT EXISTS inner_pack_count integer,
  ADD COLUMN IF NOT EXISTS each_size_value numeric(12,4),
  ADD COLUMN IF NOT EXISTS each_size_unit text,
  ADD COLUMN IF NOT EXISTS total_content_value numeric(12,4),
  ADD COLUMN IF NOT EXISTS total_content_unit text,
  ADD COLUMN IF NOT EXISTS is_indivisible_sale_unit boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_offers_inner_pack_count') THEN
    ALTER TABLE public.offers ADD CONSTRAINT chk_offers_inner_pack_count CHECK (inner_pack_count IS NULL OR inner_pack_count > 0);
  END IF;
END $$;

-- 1.4 Price Terms, Promotion Separation & Eligibility
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SAR',
  ADD COLUMN IF NOT EXISTS price_basis text NOT NULL DEFAULT 'each',
  ADD COLUMN IF NOT EXISTS verified_non_member_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS promo_mechanic text NOT NULL DEFAULT 'standard_price',
  ADD COLUMN IF NOT EXISTS bonus_wording text,
  ADD COLUMN IF NOT EXISTS bonus_fulfillment text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS loyalty_requirement text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS quantity_limit_value integer,
  ADD COLUMN IF NOT EXISTS quantity_limit_unit text,
  ADD COLUMN IF NOT EXISTS quantity_limit_scope text;

-- 1.5 Media, Thumbnails, Prominence & Spatial Evidence
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS informational_inner_unit_price numeric(14,6),
  ADD COLUMN IF NOT EXISTS display_unit_price_label_ar text,
  ADD COLUMN IF NOT EXISTS display_unit_price_label_en text,
  ADD COLUMN IF NOT EXISTS thumbnail_storage_path text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS image_subject_scope text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS page_area_share_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS is_front_page boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_hero_offer boolean NOT NULL DEFAULT false;

-- 1.6 Scoped Assessments, Reason Codes & Full v2 Contract JSONB
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS scoped_assessments jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reason_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contract_v2 jsonb;

-- -------------------------------------------------------------------------
-- 2. Indexes for High-Performance Queries & Idempotent Upserts
-- -------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_source_offer_id 
  ON public.offers(source_offer_id) 
  WHERE source_offer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offers_semantic_checksum 
  ON public.offers(semantic_checksum);

CREATE INDEX IF NOT EXISTS idx_offers_compound_group_id 
  ON public.offers(compound_group_id) 
  WHERE compound_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offers_exact_identity_status 
  ON public.offers(exact_identity_status);

CREATE INDEX IF NOT EXISTS idx_offers_assortment_status 
  ON public.offers(assortment_status);

CREATE INDEX IF NOT EXISTS idx_offers_commodity_tag 
  ON public.offers(commodity_tag);

CREATE INDEX IF NOT EXISTS idx_offers_category_slug 
  ON public.offers(category_slug);

CREATE INDEX IF NOT EXISTS idx_offers_thumbnail_storage_path 
  ON public.offers(thumbnail_storage_path);

-- -------------------------------------------------------------------------
-- 2.5 Prerequisite Helper: Recursive Consumer Contract Sanitizer (B-01, B-09)
-- -------------------------------------------------------------------------
-- Defined here so migration 005 is 100% self-contained when applied in 001..006 order.

CREATE OR REPLACE FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_assets jsonb;
  v_card jsonb;
  v_thumb jsonb;
  v_clean_card jsonb;
  v_clean_thumb jsonb;
  v_card_storage_path text;
  v_thumb_storage_path text;
  v_assessments jsonb;
  v_reason_codes jsonb;
  v_is_uploaded boolean;
BEGIN
  IF p_contract_v2 IS NULL THEN
    RETURN NULL;
  END IF;

  v_assets := p_contract_v2->'assets';
  v_card := COALESCE(v_assets->'offer_card', '{}'::jsonb);
  v_thumb := COALESCE(v_assets->'product_thumbnail', '{}'::jsonb);

  -- Sanitize storage_object_path: strip Windows or local paths to null
  v_card_storage_path := v_card->>'storage_object_path';
  IF v_card_storage_path ~* '^[A-Za-z]:[\\/]|\\\\' THEN
    v_card_storage_path := NULL;
  END IF;

  v_thumb_storage_path := v_thumb->>'storage_object_path';
  IF v_thumb_storage_path ~* '^[A-Za-z]:[\\/]|\\\\' THEN
    v_thumb_storage_path := NULL;
  END IF;

  -- Build clean assets with local_path_internal strictly omitted
  v_clean_card := jsonb_build_object(
    'storage_bucket', v_card->'storage_bucket',
    'storage_object_path', to_jsonb(v_card_storage_path),
    'subject_scope', COALESCE(v_card->'subject_scope', '"unverified"'::jsonb),
    'upload_state', COALESCE(v_card->'upload_state', '"pending"'::jsonb)
  );
  IF v_card ? 'delivery_url' THEN
    v_clean_card := v_clean_card || jsonb_build_object('delivery_url', v_card->'delivery_url');
  END IF;

  v_clean_thumb := jsonb_build_object(
    'storage_bucket', v_thumb->'storage_bucket',
    'storage_object_path', to_jsonb(v_thumb_storage_path),
    'subject_scope', COALESCE(v_thumb->'subject_scope', '"unverified"'::jsonb),
    'upload_state', COALESCE(v_thumb->'upload_state', '"pending"'::jsonb)
  );
  IF v_thumb ? 'delivery_url' THEN
    v_clean_thumb := v_clean_thumb || jsonb_build_object('delivery_url', v_thumb->'delivery_url');
  END IF;

  -- B-09 / MEDIA-01: Strip MEDIA_UPLOAD_PENDING if assets are uploaded
  v_assessments := COALESCE(p_contract_v2->'assessments', '{}'::jsonb);
  v_reason_codes := v_assessments->'reason_codes';
  v_is_uploaded := (v_clean_card->>'upload_state' = 'uploaded' OR v_card_storage_path IS NOT NULL OR v_card ? 'delivery_url');
  IF v_is_uploaded AND v_reason_codes IS NOT NULL AND jsonb_typeof(v_reason_codes) = 'array' THEN
    v_reason_codes := v_reason_codes - 'MEDIA_UPLOAD_PENDING';
    v_assessments := jsonb_set(v_assessments, '{reason_codes}', v_reason_codes);
  END IF;

  RETURN jsonb_build_object(
    'record_metadata', jsonb_build_object(
      'schema_version', p_contract_v2->'record_metadata'->'schema_version',
      'source_offer_id', p_contract_v2->'record_metadata'->'source_offer_id',
      'source_revision', p_contract_v2->'record_metadata'->'source_revision',
      'semantic_checksum', p_contract_v2->'record_metadata'->'semantic_checksum',
      'producer_model', p_contract_v2->'record_metadata'->'producer_model',
      'supersedes_source_offer_id', p_contract_v2->'record_metadata'->'supersedes_source_offer_id',
      'compound_group_id', p_contract_v2->'record_metadata'->'compound_group_id'
    ),
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
$$;

-- -------------------------------------------------------------------------
-- 3. Public-Safe Consumer View: v_consumer_offers
-- -------------------------------------------------------------------------
-- Exposes consumer-needed fields and dynamically evaluates temporal lifecycle
-- in Asia/Riyadh calendar dates. Filtered strictly to published offers (INT-F01).

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
  s.logo_url AS supermarket_logo_url,
  o.location_scope,
  o.city_id,
  c.name_ar AS city_name_ar,
  c.name_en AS city_name_en,
  o.region_id,
  r.name_ar AS region_name_ar,
  r.name_en AS region_name_en,

  -- Product Facts & Taxonomy
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

  -- Media & Visual Evidence (Safe Supabase Storage paths & URLs only)
  o.image_url,
  CASE
    WHEN o.image_path ~* '^[A-Za-z]:[\\/]|\\\\' THEN NULL
    ELSE o.image_path
  END AS storage_path,
  o.thumbnail_url,
  CASE
    WHEN o.thumbnail_storage_path ~* '^[A-Za-z]:[\\/]|\\\\' THEN NULL
    ELSE o.thumbnail_storage_path
  END AS thumbnail_storage_path,

  -- Scopes and Upload States
  COALESCE(o.contract_v2->'assets'->'offer_card'->>'subject_scope', o.image_subject_scope) AS card_image_subject_scope,
  COALESCE(
    o.contract_v2->'assets'->'offer_card'->>'upload_state',
    CASE WHEN o.image_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END
  ) AS card_image_upload_state,
  COALESCE(o.contract_v2->'assets'->'product_thumbnail'->>'subject_scope', o.image_subject_scope) AS thumbnail_subject_scope,
  COALESCE(
    o.contract_v2->'assets'->'product_thumbnail'->>'upload_state',
    CASE WHEN o.thumbnail_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END
  ) AS thumbnail_upload_state,

  -- Spatial & Prominence
  o.page_area_share_pct,
  o.is_front_page,
  o.is_hero_offer,
  o.deal_score,
  o.deal_label,

  -- Temporal Lifecycle Evaluation (Asia/Riyadh timezone)
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

  -- Capabilities & Reason Codes
  o.scoped_assessments,
  CASE
    WHEN o.image_url IS NOT NULL OR o.thumbnail_url IS NOT NULL OR o.image_path IS NOT NULL OR o.thumbnail_storage_path IS NOT NULL
    THEN array_remove(o.reason_codes, 'MEDIA_UPLOAD_PENDING')
    ELSE o.reason_codes
  END AS reason_codes,
  public.build_sanitized_consumer_contract_v2(o.contract_v2) AS consumer_contract_v2,

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
WHERE o.status = 'published';

-- Grant permissions for authenticated and anon users
GRANT SELECT ON public.v_consumer_offers TO anon, authenticated;
