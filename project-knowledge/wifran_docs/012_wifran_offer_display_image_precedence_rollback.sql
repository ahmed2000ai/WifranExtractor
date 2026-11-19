-- ============================================================================
-- Migration 012 ROLLBACK: Restore Migration 011 Consumer View Precedence
-- ============================================================================
-- Reverts public.v_consumer_offers and build_sanitized_consumer_contract_v2
-- back to Migration 011 (`COALESCE(pi.public_url, odi.public_url)`).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 1. Guarded Rollback Precondition for offer_display_images source_kind Check
-- ----------------------------------------------------------------------------
-- If records using newly permitted source_kinds (e.g. promotional_leaflet_crop)
-- already exist, restoring the legacy 3-value constraint will fail closed to prevent
-- corrupting or deleting valid image records.
DO $$
DECLARE
  v_crop_count integer;
BEGIN
  SELECT count(*) INTO v_crop_count
  FROM public.offer_display_images
  WHERE source_kind NOT IN ('generated_illustration', 'generic_library', 'licensed_stock');

  IF v_crop_count > 0 THEN
    RAISE EXCEPTION 
      'ROLLBACK PRECONDITION BLOCKED: Found % records in public.offer_display_images with non-legacy source_kind (e.g. promotional_leaflet_crop). Restoring the legacy 3-value constraint would reject valid records or require lossy reclassification. Falsifying provenance or deleting valid records is strictly prohibited. Use 012_wifran_offer_display_image_view_only_rollback.sql to revert view precedence safely while preserving all records.',
      v_crop_count
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

ALTER TABLE public.offer_display_images
  DROP CONSTRAINT IF EXISTS offer_display_images_source_kind_check;

ALTER TABLE public.offer_display_images
  ADD CONSTRAINT offer_display_images_source_kind_check
  CHECK (source_kind IN (
    'generated_illustration',
    'generic_library',
    'licensed_stock'
  ));

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
  CASE
    WHEN o.catalog_match_status = 'verified_linked'
      AND (p.id IS NULL OR (COALESCE(p.verification_status, 'verified') <> 'rejected' AND COALESCE(p.is_active, true) = true))
    THEN o.product_id
    WHEN o.catalog_match_status = 'candidate_pending_review'
      AND o.product_id IS NOT NULL AND p.id IS NOT NULL
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
      WHEN (o.catalog_match_status = 'verified_linked' AND p.id IS NOT NULL AND COALESCE(p.verification_status, 'verified') <> 'rejected' AND COALESCE(p.is_active, true) = true)
        OR (o.catalog_match_status = 'candidate_pending_review' AND o.product_id IS NOT NULL AND p.id IS NOT NULL AND p.verification_status IN ('verified', 'candidate') AND COALESCE(p.is_active, true) = true)
      THEN NULLIF(btrim(p.brand_name), '')
      ELSE NULL
    END
  ) AS brand_name_en,
  o.brand_state,
  COALESCE(
    o.brand_candidate_text,
    CASE
      WHEN (o.catalog_match_status = 'verified_linked' AND p.id IS NOT NULL AND COALESCE(p.verification_status, 'verified') <> 'rejected' AND COALESCE(p.is_active, true) = true)
        OR (o.catalog_match_status = 'candidate_pending_review' AND o.product_id IS NOT NULL AND p.id IS NOT NULL AND p.verification_status IN ('verified', 'candidate') AND COALESCE(p.is_active, true) = true)
      THEN NULLIF(btrim(p.brand_name), '')
      ELSE NULL
    END
  ) AS brand_candidate_text,
  o.title_ar,
  o.title_en,
  o.normalized_title_ar,
  o.normalized_title_en,
  o.product_attributes,
  o.assortment_status,
  o.known_options,
  o.sale_unit_type,
  o.inner_pack_count,
  o.each_size_value,
  o.each_size_unit,
  o.total_content_value,
  o.total_content_unit,
  o.is_indivisible_sale_unit,
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
  o.is_loyalty_required,
  o.loyalty_requirement,
  o.quantity_limit,
  o.quantity_limit_value,
  o.quantity_limit_unit,
  o.quantity_limit_scope,
  COALESCE(pi.public_url, odi.public_url) AS image_url,
  COALESCE(pi.storage_object_path, odi.storage_object_path) AS storage_path,
  COALESCE(pi.public_url, odi.public_url) AS thumbnail_url,
  COALESCE(pi.storage_object_path, odi.storage_object_path) AS thumbnail_storage_path,
  COALESCE(pi.public_url, odi.public_url) AS display_image_url,
  CASE WHEN pi.public_url IS NOT NULL THEN 'exact_product' WHEN odi.public_url IS NOT NULL THEN 'illustrative' ELSE NULL END AS display_image_kind,
  CASE WHEN pi.public_url IS NOT NULL THEN 'product_package' WHEN odi.public_url IS NOT NULL THEN 'representative_assortment' ELSE COALESCE(o.image_subject_scope, 'unverified') END AS card_image_subject_scope,
  CASE WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded' ELSE COALESCE(o.contract_v2->'assets'->'offer_card'->>'upload_state', CASE WHEN o.image_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END) END AS card_image_upload_state,
  CASE WHEN pi.public_url IS NOT NULL THEN 'product_package' WHEN odi.public_url IS NOT NULL THEN 'representative_assortment' ELSE 'unverified' END AS thumbnail_subject_scope,
  CASE WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded' ELSE COALESCE(o.contract_v2->'assets'->'product_thumbnail'->>'upload_state', CASE WHEN o.thumbnail_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END) END AS thumbnail_upload_state,
  o.page_area_share_pct,
  o.is_front_page,
  o.is_hero_offer,
  o.deal_score,
  o.deal_label,
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
  o.scoped_assessments,
  CASE WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN array_remove(o.reason_codes, 'MEDIA_UPLOAD_PENDING') ELSE o.reason_codes END AS reason_codes,
  public.build_sanitized_consumer_contract_v2(
    o.contract_v2,
    COALESCE(pi.public_url, odi.public_url),
    CASE WHEN pi.public_url IS NOT NULL THEN 'product_package' WHEN odi.public_url IS NOT NULL THEN 'representative_assortment' ELSE NULL END
  ) AS consumer_contract_v2,
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
    (o.catalog_match_status = 'verified_linked' AND (p.id IS NULL OR (COALESCE(p.verification_status, 'verified') <> 'rejected' AND COALESCE(p.is_active, true) = true)))
    OR (o.catalog_match_status = 'candidate_pending_review' AND o.product_id IS NOT NULL AND p.id IS NOT NULL AND p.verification_status IN ('verified', 'candidate') AND COALESCE(p.is_active, true) = true)
  )
LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id
  AND odi.approval_status = 'approved'
WHERE o.status = 'published';

GRANT SELECT ON public.v_consumer_offers TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_consumer_offers_for_shopping_date(date, text, text) TO anon, authenticated;

COMMIT;
