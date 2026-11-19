-- ============================================================================
-- Migration 011: WIFRAN MVP Candidate Consumer Visibility & Brand Fallback
-- ============================================================================
-- Purpose:
--   1. Align public.v_consumer_offers with the approved WIFRAN MVP consumer
--      visibility policy: auto-validated, independently publishable offers
--      linked to provisional `candidate` catalog products (`catalog_match_status =
--      'candidate_pending_review'`) and their approved generated product images
--      are visible to consumers while preserving provisional provenance:
--        - products.verification_status = 'candidate'
--        - offers.catalog_match_status = 'candidate_pending_review'
--        - offers.exact_identity_status = 'unresolved' (or existing value)
--   2. Preserve strict consumer masking for disputed, rejected, inactive, or
--      unresolved identities (`conflict_needs_review`, `unresolved`,
--      `excluded_ambiguous`, `products.verification_status = 'rejected'`,
--      `products.is_active = false`).
--   3. Expose safe catalog `products.brand_name` fallback in `brand_name_en`
--      and `brand_candidate_text` when `offers.brand_id` is NULL (never
--      fabricating `public.brands` UUID rows).
--   4. In-place `CREATE OR REPLACE VIEW` preserving exact 98-column signature,
--      column order, data types, and dependent RPC compatibility
--      (`public.get_consumer_offers_for_shopping_date`).
--
-- Safety:
--   - Transactional DDL with conservative timeouts.
--   - Zero DROP VIEW ... CASCADE.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

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
  -- Safe consumer visibility: expose product_id for verified_linked (active, non-rejected)
  -- and MVP auto-created candidate_pending_review (active candidate/verified) offers.
  -- Strictly mask conflict_needs_review, unresolved, excluded_ambiguous, rejected, and inactive products.
  CASE
    WHEN o.catalog_match_status = 'verified_linked'
      AND (
        p.id IS NULL
        OR (
          COALESCE(p.verification_status, 'verified') <> 'rejected'
          AND COALESCE(p.is_active, true) = true
        )
      )
    THEN o.product_id
    WHEN o.catalog_match_status = 'candidate_pending_review'
      AND o.product_id IS NOT NULL
      AND p.id IS NOT NULL
      AND p.verification_status IN ('verified', 'candidate')
      AND COALESCE(p.is_active, true) = true
    THEN o.product_id
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
  COALESCE(
    b.name_en,
    CASE
      WHEN (
        o.catalog_match_status = 'verified_linked'
        AND p.id IS NOT NULL
        AND COALESCE(p.verification_status, 'verified') <> 'rejected'
        AND COALESCE(p.is_active, true) = true
      )
      OR (
        o.catalog_match_status = 'candidate_pending_review'
        AND o.product_id IS NOT NULL
        AND p.id IS NOT NULL
        AND p.verification_status IN ('verified', 'candidate')
        AND COALESCE(p.is_active, true) = true
      )
      THEN NULLIF(btrim(p.brand_name), '')
      ELSE NULL
    END
  ) AS brand_name_en,
  o.brand_state,
  COALESCE(
    o.brand_candidate_text,
    CASE
      WHEN (
        o.catalog_match_status = 'verified_linked'
        AND p.id IS NOT NULL
        AND COALESCE(p.verification_status, 'verified') <> 'rejected'
        AND COALESCE(p.is_active, true) = true
      )
      OR (
        o.catalog_match_status = 'candidate_pending_review'
        AND o.product_id IS NOT NULL
        AND p.id IS NOT NULL
        AND p.verification_status IN ('verified', 'candidate')
        AND COALESCE(p.is_active, true) = true
      )
      THEN NULLIF(btrim(p.brand_name), '')
      ELSE NULL
    END
  ) AS brand_candidate_text,
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

  -- Media & Visual Evidence (Approved Exact Product Photo or Approved Illustrative Offer Visual)
  COALESCE(pi.public_url, odi.public_url) AS image_url,
  COALESCE(pi.storage_object_path, odi.storage_object_path) AS storage_path,
  COALESCE(pi.public_url, odi.public_url) AS thumbnail_url,
  COALESCE(pi.storage_object_path, odi.storage_object_path) AS thumbnail_storage_path,

  -- Explicit Display Image Provenance
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
LEFT JOIN public.products p ON p.id = o.product_id
LEFT JOIN public.product_images pi ON pi.product_id = o.product_id
  AND pi.role = 'primary'
  AND pi.approval_status = 'approved'
  AND (
    (
      o.catalog_match_status = 'verified_linked'
      AND (
        p.id IS NULL
        OR (
          COALESCE(p.verification_status, 'verified') <> 'rejected'
          AND COALESCE(p.is_active, true) = true
        )
      )
    )
    OR (
      o.catalog_match_status = 'candidate_pending_review'
      AND o.product_id IS NOT NULL
      AND p.id IS NOT NULL
      AND p.verification_status IN ('verified', 'candidate')
      AND COALESCE(p.is_active, true) = true
    )
  )
LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id
  AND odi.approval_status = 'approved'
WHERE o.status = 'published';

GRANT SELECT ON public.v_consumer_offers TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_consumer_offers_for_shopping_date(date, text, text) TO anon, authenticated;

COMMIT;
