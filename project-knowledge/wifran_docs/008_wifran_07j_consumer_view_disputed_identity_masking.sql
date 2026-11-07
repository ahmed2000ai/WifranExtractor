-- =========================================================================
-- Migration 008: WIFRAN-07J Consumer View Disputed Identity Masking
-- File: project-knowledge/wifran_docs/008_wifran_07j_consumer_view_disputed_identity_masking.sql
--
-- Objective:
-- Harden public.v_consumer_offers to prevent consumer exposure of disputed or
-- unverified product identities (WIFRAN-EXTRACTOR-IDENTITY-001F).
--
-- Key Safety & Architecture Invariants (001F):
-- 1. ELIMINATES DROP VIEW ... CASCADE: Uses in-place CREATE OR REPLACE VIEW
--    preserving all 98 columns, names, types, and ordering from Migration 007.
--    Prevents destruction of dependent functions and objects.
-- 2. PRIVATE-IMAGE ISOLATION: Preserves Migration 007 hybrid visual resolution
--    (COALESCE(pi.public_url, odi.public_url) as image_url, thumbnail_url,
--    display_image_url, and display_image_kind). Offers with unverified or
--    disputed product identities project NULL for product visuals, NEVER raw
--    leaflet crop URLs, Windows local paths, or private bucket references.
-- 3. IDENTITY MASKING: Product ID is exposed ONLY when catalog_match_status = 'verified_linked'.
--    Disputed ('conflict_needs_review'), candidate, or unresolved identities
--    are strictly masked to NULL.
-- 4. CANONICAL ALIAS NORMALIZATION & NON-DESTRUCTIVE UNIQUENESS:
--    Provides IMMUTABLE public.normalize_alias_key(text) and safe unique index
--    idx_product_aliases_normalized_key, with non-destructive preflight diagnostics.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Canonical Alias Normalization Function
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_alias_key(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_res text;
BEGIN
  IF p_text IS NULL THEN
    RETURN NULL;
  END IF;

  v_res := trim(lower(p_text));
  -- Strip tatweel / kashida (U+0640)
  v_res := regexp_replace(v_res, 'ـ', '', 'g');
  -- Strip Arabic diacritics / tashkeel (fatha, damma, kasra, sukun, shadda, tanween: U+064B-U+065F, U+0670)
  v_res := regexp_replace(v_res, '[\u064B-\u065F\u0670]', '', 'g');
  -- Normalize Alef with hamza / madda to plain Alef
  v_res := regexp_replace(v_res, '[أإآ]', 'ا', 'g');
  -- Normalize Alef Maksura to Yeh
  v_res := regexp_replace(v_res, 'ى', 'ي', 'g');
  -- Normalize Teh Marbuta to Heh
  v_res := regexp_replace(v_res, 'ة', 'ه', 'g');
  -- Collapse multiple whitespace characters into single space
  v_res := regexp_replace(v_res, '\s+', ' ', 'g');
  v_res := trim(v_res);

  IF length(v_res) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_alias_key(text) TO anon, authenticated, service_role;

-- -------------------------------------------------------------------------
-- 2. Non-Destructive Preflight Check: Fail-Safe Detection of Conflicts & Duplicates
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_conflict_count integer;
  v_duplicate_count integer;
  v_conflict_sample text;
  v_duplicate_sample text;
BEGIN
  -- 1. Check for conflicting mappings: SAME normalized alias text pointing to DIFFERENT products
  SELECT count(*), string_agg(format('"%s" (Products: %s)', norm_text, prods), '; ')
  INTO v_conflict_count, v_conflict_sample
  FROM (
    SELECT public.normalize_alias_key(alias_text) AS norm_text,
           string_agg(DISTINCT product_id::text, ', ' ORDER BY product_id::text) AS prods
    FROM public.product_aliases
    WHERE alias_text IS NOT NULL AND length(trim(alias_text)) > 0
    GROUP BY public.normalize_alias_key(alias_text)
    HAVING count(DISTINCT product_id) > 1
    LIMIT 10
  ) conflicts;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION_008_BLOCKED: Conflicting product aliases detected across DIFFERENT products (% conflicts found). Sample: %. Manual operator review required before uniqueness can be enforced.',
      v_conflict_count, v_conflict_sample;
  END IF;

  -- 2. Check for duplicate mappings pointing to the SAME product
  SELECT count(*), string_agg(format('"%s" (Product: %s, Count: %s)', norm_text, prod_id, dup_count), '; ')
  INTO v_duplicate_count, v_duplicate_sample
  FROM (
    SELECT public.normalize_alias_key(alias_text) AS norm_text,
           min(product_id::text) AS prod_id,
           count(*) AS dup_count
    FROM public.product_aliases
    WHERE alias_text IS NOT NULL AND length(trim(alias_text)) > 0
    GROUP BY public.normalize_alias_key(alias_text)
    HAVING count(*) > 1
    LIMIT 10
  ) dups;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION_008_BLOCKED: Duplicate aliases detected for the SAME product (% duplicates found). Sample: %. Manual operator review required before uniqueness can be enforced.',
      v_duplicate_count, v_duplicate_sample;
  END IF;
END $$;

-- Enforce database-level uniqueness across Arabic, English, and orthographic variations
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_aliases_normalized_key
  ON public.product_aliases (public.normalize_alias_key(alias_text));

-- -------------------------------------------------------------------------
-- 3. In-Place Update of public.v_consumer_offers (Preserving Full 98 Columns & Image Isolation)
-- -------------------------------------------------------------------------
-- NOTE: Uses CREATE OR REPLACE VIEW without DROP VIEW ... CASCADE.
-- Column order, names, and data types match Migration 007 exactly (98 columns).
-- Column 23 (product_id) is masked to NULL unless catalog_match_status = 'verified_linked'.

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
  -- WIFRAN-EXTRACTOR-IDENTITY-001F: Disputed / unverified identities masked to NULL for consumer safety
  CASE
    WHEN o.catalog_match_status = 'verified_linked' THEN o.product_id
    ELSE NULL
  END AS product_id,
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
-- 4. Role Permissions
-- -------------------------------------------------------------------------
GRANT SELECT ON public.v_consumer_offers TO anon, authenticated;

-- -------------------------------------------------------------------------
-- 5. Parameterized Planned Shopping Date Function
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

GRANT EXECUTE ON FUNCTION public.get_consumer_offers_for_shopping_date(date, text, text) TO anon, authenticated;
