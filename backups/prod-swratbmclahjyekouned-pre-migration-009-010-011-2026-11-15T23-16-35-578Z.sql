--
-- PostgreSQL database dump
--

\restrict 3rZwfFWxDKUVcXXM1lgm7WTanLOekxLorPf1ckKh4LGUKbX8Od7hTOG9MbMw2A3

-- Dumped from database version 17.11
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: build_sanitized_consumer_contract_v2(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT public.build_sanitized_consumer_contract_v2(p_contract_v2, NULL, NULL);
$$;


--
-- Name: build_sanitized_consumer_contract_v2(jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb, p_approved_product_image_url text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT public.build_sanitized_consumer_contract_v2(p_contract_v2, p_approved_product_image_url, NULL);
$$;


--
-- Name: build_sanitized_consumer_contract_v2(jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb, p_approved_product_image_url text DEFAULT NULL::text, p_subject_scope text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
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


--
-- Name: enforce_issue_report_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_issue_report_user_id() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  ELSE
    NEW.user_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_prevent_product_id_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_prevent_product_id_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'products.id is immutable and cannot be updated (current: %, attempted: %)', OLD.id, NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name_ar text,
    name_en text,
    slug text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_brand_name CHECK (((name_ar IS NOT NULL) OR (name_en IS NOT NULL)))
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    name_ar text NOT NULL,
    name_en text NOT NULL,
    slug text NOT NULL,
    description_ar text,
    description_en text,
    icon_name text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0,
    requires_unit_price boolean DEFAULT false NOT NULL,
    default_unit_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cities (
    id text NOT NULL,
    name_ar text NOT NULL,
    name_en text NOT NULL,
    slug text NOT NULL,
    country_code text DEFAULT 'SA'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    code text,
    region_id text
);


--
-- Name: offer_display_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_display_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    offer_id uuid NOT NULL,
    storage_bucket text DEFAULT 'offer-display-images'::text NOT NULL,
    storage_object_path text NOT NULL,
    public_url text NOT NULL,
    mime_type text NOT NULL,
    byte_size integer NOT NULL,
    content_sha256 text NOT NULL,
    source_kind text DEFAULT 'generated_illustration'::text NOT NULL,
    source_url text,
    normalized_source_url text,
    visual_subject_key text NOT NULL,
    approval_status text DEFAULT 'approved'::text NOT NULL,
    rights_basis text DEFAULT 'operator_manual_verified'::text NOT NULL,
    reviewed_by text DEFAULT 'operator'::text NOT NULL,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT offer_display_images_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text]))),
    CONSTRAINT offer_display_images_source_kind_check CHECK ((source_kind = ANY (ARRAY['generated_illustration'::text, 'generic_library'::text, 'licensed_stock'::text])))
);


--
-- Name: offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id bigint,
    supermarket_id text NOT NULL,
    city_id text,
    region_id text,
    category_id uuid,
    brand_id uuid,
    title_ar text,
    title_en text,
    offer_price numeric(10,2) NOT NULL,
    original_price numeric(10,2),
    discount_amount numeric(10,2),
    discount_percentage numeric(5,2),
    pack_size_value numeric,
    pack_size_unit text,
    pack_quantity numeric DEFAULT 1,
    unit_price numeric(12,4),
    unit_price_unit text,
    offer_start_date date,
    offer_end_date date NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    image_url text,
    image_path text,
    image_bucket text DEFAULT 'offer-images'::text,
    image_source_type text,
    source_id uuid,
    source_page_number integer,
    source_item_number text,
    source_reference text,
    external_image_id text,
    ingestion_source text,
    location_scope text DEFAULT 'national'::text NOT NULL,
    deal_score numeric(6,2),
    deal_label text,
    data_quality_score numeric(5,2),
    is_loyalty_required boolean DEFAULT false NOT NULL,
    loyalty_notes_ar text,
    loyalty_notes_en text,
    quantity_limit text,
    notes_ar text,
    notes_en text,
    created_by uuid,
    updated_by uuid,
    approved_by uuid,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_offer_id text,
    source_revision integer DEFAULT 1 NOT NULL,
    semantic_checksum text,
    contract_version text,
    compound_group_id text,
    supersedes_source_offer_id text,
    exact_identity_status text DEFAULT 'unresolved'::text NOT NULL,
    category_slug text,
    derived_subcategory_slug text,
    commodity_tag text,
    item_domain text DEFAULT 'grocery'::text NOT NULL,
    brand_state text DEFAULT 'unknown'::text NOT NULL,
    brand_candidate_text text,
    normalized_title_ar text,
    normalized_title_en text,
    product_attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    assortment_status text DEFAULT 'unknown_composition'::text NOT NULL,
    known_options jsonb DEFAULT '[]'::jsonb NOT NULL,
    sale_unit_type text DEFAULT 'pack'::text NOT NULL,
    inner_pack_count integer,
    each_size_value numeric(12,4),
    each_size_unit text,
    total_content_value numeric(12,4),
    total_content_unit text,
    is_indivisible_sale_unit boolean DEFAULT true NOT NULL,
    currency text DEFAULT 'SAR'::text NOT NULL,
    price_basis text DEFAULT 'each'::text NOT NULL,
    verified_non_member_price numeric(10,2),
    promo_mechanic text DEFAULT 'standard_price'::text NOT NULL,
    bonus_wording text,
    bonus_fulfillment text DEFAULT 'not_applicable'::text NOT NULL,
    loyalty_requirement text DEFAULT 'unknown'::text NOT NULL,
    quantity_limit_value integer,
    quantity_limit_unit text,
    quantity_limit_scope text,
    informational_inner_unit_price numeric(14,6),
    display_unit_price_label_ar text,
    display_unit_price_label_en text,
    thumbnail_storage_path text,
    thumbnail_url text,
    image_subject_scope text DEFAULT 'unverified'::text NOT NULL,
    page_area_share_pct numeric(5,2),
    is_front_page boolean DEFAULT false NOT NULL,
    is_hero_offer boolean DEFAULT false NOT NULL,
    scoped_assessments jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    contract_v2 jsonb,
    catalog_candidate_key text,
    catalog_match_status text DEFAULT 'unresolved'::text NOT NULL,
    catalog_verification_basis text,
    catalog_verified_by text,
    catalog_verified_at timestamp with time zone,
    CONSTRAINT chk_offer_dates CHECK (((offer_start_date IS NULL) OR (offer_end_date >= offer_start_date))),
    CONSTRAINT chk_offer_location_scope CHECK ((location_scope = ANY (ARRAY['national'::text, 'region'::text, 'city'::text]))),
    CONSTRAINT chk_offer_location_scope_rules CHECK ((((location_scope = 'national'::text) AND (city_id IS NULL) AND (region_id IS NULL)) OR ((location_scope = 'region'::text) AND (region_id IS NOT NULL) AND (city_id IS NULL)) OR ((location_scope = 'city'::text) AND (city_id IS NOT NULL)))),
    CONSTRAINT chk_offer_price_positive CHECK ((offer_price > (0)::numeric)),
    CONSTRAINT chk_offer_status CHECK ((status = ANY (ARRAY['draft'::text, 'needs_review'::text, 'approved'::text, 'published'::text, 'expired'::text, 'rejected'::text]))),
    CONSTRAINT chk_offer_title CHECK (((title_ar IS NOT NULL) OR (title_en IS NOT NULL))),
    CONSTRAINT chk_offers_catalog_match_status CHECK ((catalog_match_status = ANY (ARRAY['unresolved'::text, 'candidate_pending_review'::text, 'verified_linked'::text, 'excluded_ambiguous'::text, 'conflict_needs_review'::text]))),
    CONSTRAINT chk_offers_inner_pack_count CHECK (((inner_pack_count IS NULL) OR (inner_pack_count > 0))),
    CONSTRAINT chk_original_price_ge CHECK (((original_price IS NULL) OR (original_price >= offer_price)))
);


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id bigint NOT NULL,
    role text DEFAULT 'primary'::text NOT NULL,
    storage_bucket text DEFAULT 'product-images'::text NOT NULL,
    storage_object_path text NOT NULL,
    public_url text NOT NULL,
    mime_type text NOT NULL,
    byte_size integer NOT NULL,
    content_sha256 text NOT NULL,
    source_url text NOT NULL,
    normalized_source_url text NOT NULL,
    approval_status text DEFAULT 'approved'::text NOT NULL,
    rights_basis text DEFAULT 'operator_manual_verified'::text NOT NULL,
    reviewed_by text DEFAULT 'operator'::text NOT NULL,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_images_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text]))),
    CONSTRAINT product_images_role_check CHECK ((role = ANY (ARRAY['primary'::text, 'alternate'::text])))
);


--
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    id text NOT NULL,
    name_ar text NOT NULL,
    name_en text NOT NULL,
    slug text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    code text
);


--
-- Name: supermarkets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supermarkets (
    id text NOT NULL,
    name_ar text NOT NULL,
    name_en text NOT NULL,
    slug text NOT NULL,
    logo_url text,
    website_url text,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    code text
);


--
-- Name: v_consumer_offers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_consumer_offers WITH (security_invoker='false') AS
 SELECT o.id,
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
            WHEN (o.catalog_match_status = 'verified_linked'::text) THEN o.product_id
            ELSE NULL::bigint
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
    COALESCE(o.currency, 'SAR'::text) AS currency,
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
        CASE
            WHEN (pi.public_url IS NOT NULL) THEN 'exact_product'::text
            WHEN (odi.public_url IS NOT NULL) THEN 'illustrative'::text
            ELSE NULL::text
        END AS display_image_kind,
        CASE
            WHEN (pi.public_url IS NOT NULL) THEN 'product_package'::text
            WHEN (odi.public_url IS NOT NULL) THEN 'representative_assortment'::text
            ELSE COALESCE(o.image_subject_scope, 'unverified'::text)
        END AS card_image_subject_scope,
        CASE
            WHEN ((pi.public_url IS NOT NULL) OR (odi.public_url IS NOT NULL)) THEN 'uploaded'::text
            ELSE COALESCE((((o.contract_v2 -> 'assets'::text) -> 'offer_card'::text) ->> 'upload_state'::text),
            CASE
                WHEN (o.image_url IS NOT NULL) THEN 'uploaded'::text
                ELSE 'pending'::text
            END)
        END AS card_image_upload_state,
        CASE
            WHEN (pi.public_url IS NOT NULL) THEN 'product_package'::text
            WHEN (odi.public_url IS NOT NULL) THEN 'representative_assortment'::text
            ELSE 'unverified'::text
        END AS thumbnail_subject_scope,
        CASE
            WHEN ((pi.public_url IS NOT NULL) OR (odi.public_url IS NOT NULL)) THEN 'uploaded'::text
            ELSE COALESCE((((o.contract_v2 -> 'assets'::text) -> 'product_thumbnail'::text) ->> 'upload_state'::text),
            CASE
                WHEN (o.thumbnail_url IS NOT NULL) THEN 'uploaded'::text
                ELSE 'pending'::text
            END)
        END AS thumbnail_upload_state,
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
            WHEN ((o.offer_start_date IS NOT NULL) AND (((now() AT TIME ZONE 'Asia/Riyadh'::text))::date < o.offer_start_date)) THEN 'upcoming'::text
            WHEN (((now() AT TIME ZONE 'Asia/Riyadh'::text))::date > o.offer_end_date) THEN 'expired'::text
            ELSE 'active'::text
        END AS temporal_lifecycle_state,
    o.scoped_assessments,
        CASE
            WHEN ((pi.public_url IS NOT NULL) OR (odi.public_url IS NOT NULL)) THEN array_remove(o.reason_codes, 'MEDIA_UPLOAD_PENDING'::text)
            ELSE o.reason_codes
        END AS reason_codes,
    public.build_sanitized_consumer_contract_v2(o.contract_v2, COALESCE(pi.public_url, odi.public_url),
        CASE
            WHEN (pi.public_url IS NOT NULL) THEN 'product_package'::text
            WHEN (odi.public_url IS NOT NULL) THEN 'representative_assortment'::text
            ELSE NULL::text
        END) AS consumer_contract_v2,
    o.published_at,
    o.created_at,
    o.updated_at
   FROM (((((((public.offers o
     JOIN public.supermarkets s ON ((o.supermarket_id = s.id)))
     LEFT JOIN public.categories cat ON ((o.category_id = cat.id)))
     LEFT JOIN public.cities c ON ((o.city_id = c.id)))
     LEFT JOIN public.regions r ON ((o.region_id = r.id)))
     LEFT JOIN public.brands b ON ((o.brand_id = b.id)))
     LEFT JOIN public.product_images pi ON (((pi.product_id = o.product_id) AND (pi.role = 'primary'::text) AND (pi.approval_status = 'approved'::text) AND (o.catalog_match_status = 'verified_linked'::text))))
     LEFT JOIN public.offer_display_images odi ON (((odi.offer_id = o.id) AND (odi.approval_status = 'approved'::text))))
  WHERE (o.status = 'published'::text);


--
-- Name: get_consumer_offers_for_shopping_date(date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_consumer_offers_for_shopping_date(p_shopping_date date DEFAULT ((now() AT TIME ZONE 'Asia/Riyadh'::text))::date, p_city_id text DEFAULT NULL::text, p_region_id text DEFAULT NULL::text) RETURNS SETOF public.v_consumer_offers
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: get_offer_revision_history_summary(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_offer_revision_history_summary(p_source_offer_id text) RETURNS TABLE(source_offer_id text, source_revision integer, offer_price numeric, price_basis text, sale_unit_type text, inner_pack_count integer, each_size_value numeric, each_size_unit text, loyalty_requirement text, offer_start_date date, offer_end_date date, superseded_by_revision integer, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.source_offer_id,
    s.source_revision,
    (s.snapshot_payload->'price_terms'->>'source_reported_offer_price')::numeric AS offer_price,
    s.snapshot_payload->'price_terms'->>'source_reported_price_basis' AS price_basis,
    s.snapshot_payload->'quantity_semantics'->>'sale_unit' AS sale_unit_type,
    (s.snapshot_payload->'quantity_semantics'->>'inner_count')::integer AS inner_pack_count,
    (s.snapshot_payload->'quantity_semantics'->'per_inner_content'->>'value')::numeric AS each_size_value,
    s.snapshot_payload->'quantity_semantics'->'per_inner_content'->>'unit' AS each_size_unit,
    s.snapshot_payload->'eligibility'->'loyalty'->>'requirement' AS loyalty_requirement,
    (s.snapshot_payload->'temporal'->>'offer_start_date')::date AS offer_start_date,
    (s.snapshot_payload->'temporal'->>'offer_end_date')::date AS offer_end_date,
    s.superseded_by_revision,
    s.created_at
  FROM public.offer_revision_snapshots s
  WHERE s.source_offer_id = p_source_offer_id
  ORDER BY s.source_revision ASC;
END;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'super_admin')
      and is_active = true
  );
$$;


--
-- Name: normalize_alias_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_alias_key(p_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
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


--
-- Name: prevent_profile_privilege_escalation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_profile_privilege_escalation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF (OLD.role IS DISTINCT FROM NEW.role OR OLD.is_active IS DISTINCT FROM NEW.is_active) THEN
    -- Only service_role or validated super_admin can change role / activation
    IF current_user <> 'service_role' AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Privilege escalation blocked: non-admin users cannot alter profile role or is_active.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: app_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    anonymous_id text,
    event_name text NOT NULL,
    properties jsonb,
    page_url text,
    locale text,
    city_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    uploaded_by uuid,
    supermarket_id text,
    location_scope text,
    city_id text,
    region_id text,
    source_id uuid,
    file_name text,
    file_url text,
    file_type text,
    status text DEFAULT 'uploaded'::text NOT NULL,
    total_rows integer DEFAULT 0,
    valid_rows integer DEFAULT 0,
    warning_rows integer DEFAULT 0,
    error_rows integer DEFAULT 0,
    imported_rows integer DEFAULT 0,
    skipped_rows integer DEFAULT 0,
    offer_start_date date,
    offer_end_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT chk_import_batch_location_scope CHECK (((location_scope = ANY (ARRAY['national'::text, 'region'::text, 'city'::text])) OR (location_scope IS NULL))),
    CONSTRAINT chk_import_batch_status CHECK ((status = ANY (ARRAY['uploaded'::text, 'parsed'::text, 'validated'::text, 'imported'::text, 'partially_imported'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: import_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid NOT NULL,
    row_number integer NOT NULL,
    raw_data jsonb NOT NULL,
    normalized_data jsonb,
    status text DEFAULT 'valid'::text NOT NULL,
    created_offer_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_import_row_status CHECK ((status = ANY (ARRAY['valid'::text, 'warning'::text, 'error'::text, 'imported'::text, 'skipped'::text])))
);


--
-- Name: issue_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issue_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    offer_id uuid NOT NULL,
    user_id uuid,
    issue_type text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    comment text,
    reporter_email text,
    admin_notes text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_issue_status CHECK ((status = ANY (ARRAY['open'::text, 'in_review'::text, 'resolved'::text, 'dismissed'::text, 'needs_follow_up'::text]))),
    CONSTRAINT chk_issue_type CHECK ((issue_type = ANY (ARRAY['wrong_price'::text, 'expired_offer'::text, 'wrong_product'::text, 'wrong_image'::text, 'wrong_supermarket'::text, 'wrong_pack_size'::text, 'duplicate_offer'::text, 'offer_unavailable'::text, 'other'::text])))
);


--
-- Name: legacy_id_crosswalk; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legacy_id_crosswalk (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    legacy_id text NOT NULL,
    canonical_id text NOT NULL,
    canonical_region_id text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: offer_revision_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_revision_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    offer_id uuid NOT NULL,
    source_offer_id text NOT NULL,
    source_revision integer NOT NULL,
    semantic_checksum text NOT NULL,
    snapshot_payload jsonb NOT NULL,
    superseded_by_revision integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: offer_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_type text NOT NULL,
    supermarket_id text,
    city_id text,
    region_id text,
    title text,
    source_url text,
    file_url text,
    leaflet_id text,
    storage_prefix text,
    image_count integer,
    valid_from date,
    valid_to date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: offer_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    offer_id uuid NOT NULL,
    old_status text,
    new_status text NOT NULL,
    changed_by uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: offer_visual_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offer_visual_group_members (
    representative_offer_id uuid NOT NULL,
    member_offer_id uuid NOT NULL,
    visual_subject_key text NOT NULL,
    visual_subject_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id bigint NOT NULL,
    alias_text text NOT NULL,
    language text,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    category_id uuid,
    brand_id uuid,
    name_ar text,
    name_en text,
    slug text,
    description_ar text,
    description_en text,
    default_image_url text,
    default_pack_size_value numeric,
    default_pack_size_unit text,
    default_unit_type text,
    is_normalized boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    canonical_product_key text,
    item_name_complete text,
    brand_name text,
    variant_or_flavor text,
    each_size_value numeric,
    each_size_unit text,
    inner_pack_count integer,
    sale_unit_type text,
    gtin text,
    verification_status text DEFAULT 'verified'::text NOT NULL,
    verification_basis text DEFAULT 'operator_verified_pack_identity'::text NOT NULL,
    verified_by text,
    verified_at timestamp with time zone,
    approved_primary_image_id uuid,
    id bigint NOT NULL,
    CONSTRAINT chk_product_name CHECK (((name_ar IS NOT NULL) OR (name_en IS NOT NULL))),
    CONSTRAINT chk_products_verification_status CHECK ((verification_status = ANY (ARRAY['candidate'::text, 'verified'::text, 'rejected'::text])))
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.products ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    display_name text,
    role text DEFAULT 'user'::text NOT NULL,
    preferred_language text DEFAULT 'ar'::text NOT NULL,
    preferred_city_id text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_preferred_language CHECK ((preferred_language = ANY (ARRAY['ar'::text, 'en'::text]))),
    CONSTRAINT chk_user_role CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text, 'super_admin'::text])))
);


--
-- Name: saved_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shopping_list_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopping_list_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shopping_list_id uuid NOT NULL,
    offer_id uuid,
    product_id bigint,
    custom_name text,
    quantity numeric DEFAULT 1 NOT NULL,
    is_checked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_list_item_target CHECK (((offer_id IS NOT NULL) OR (product_id IS NOT NULL) OR (custom_name IS NOT NULL)))
);


--
-- Name: shopping_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopping_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text DEFAULT 'My Shopping List'::text NOT NULL,
    city_id text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supermarket_regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supermarket_regions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supermarket_id text NOT NULL,
    city_id text,
    region_id text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_city_or_region CHECK (((city_id IS NOT NULL) OR (region_id IS NOT NULL)))
);


--
-- Name: units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name_ar text NOT NULL,
    name_en text NOT NULL,
    symbol_ar text,
    symbol_en text,
    base_unit_code text,
    conversion_to_base numeric,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0
);


--
-- Name: validation_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validation_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    import_batch_id uuid,
    import_row_id uuid,
    offer_id uuid,
    severity text NOT NULL,
    field_name text,
    error_code text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_error_severity CHECK ((severity = ANY (ARRAY['error'::text, 'warning'::text, 'info'::text])))
);


--
-- Name: watched_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watched_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    product_id bigint,
    category_id uuid,
    brand_id uuid,
    watch_text text,
    preferred_pack_size_value numeric,
    preferred_pack_size_unit text,
    target_price numeric(10,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_watched_item_target CHECK (((product_id IS NOT NULL) OR (category_id IS NOT NULL) OR (brand_id IS NOT NULL) OR (watch_text IS NOT NULL)))
);


--
-- Data for Name: app_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_events (id, user_id, anonymous_id, event_name, properties, page_url, locale, city_id, created_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: brands; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.brands (id, name_ar, name_en, slug, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.categories (id, parent_id, name_ar, name_en, slug, description_ar, description_en, icon_name, is_active, sort_order, requires_unit_price, default_unit_type, created_at, updated_at) FROM stdin;
d3dd37d3-0001-4444-9000-e00000000001	\N	الأساسيات	Staples	staples	\N	\N	rice	t	1	t	kg	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0002-4444-9000-e00000000002	\N	الألبان	Dairy	dairy	\N	\N	milk	t	2	t	liter	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0003-4444-9000-e00000000003	\N	البيض	Eggs	eggs	\N	\N	egg	t	3	t	piece	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0004-4444-9000-e00000000004	\N	اللحوم والدجاج	Meat & Chicken	meat-chicken	\N	\N	drumstick	t	4	t	kg	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0005-4444-9000-e00000000005	\N	المجمّدات	Frozen Food	frozen	\N	\N	ice-cream	t	5	t	kg	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0006-4444-9000-e00000000006	\N	الأطفال	Baby Products	baby	\N	\N	baby-carriage	t	6	t	diaper	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0007-4444-9000-e00000000007	\N	التنظيف	Cleaning Essentials	cleaning	\N	\N	trash	t	7	t	kg	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0008-4444-9000-e00000000008	\N	العناية الشخصية	Personal Care	personal-care	\N	\N	user	t	8	f	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0009-4444-9000-e00000000009	\N	المشروبات	Beverages	beverages	\N	\N	cup-soda	t	9	t	liter	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0010-4444-9000-e00000000010	\N	القهوة والشاي	Coffee & Tea	coffee-tea	\N	\N	coffee	t	10	t	kg	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0011-4444-9000-e00000000011	\N	الوجبات الخفيفة	Snacks	snacks	\N	\N	cookie	t	11	f	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0012-4444-9000-e00000000012	\N	المعلبات	Canned Food	canned-food	\N	\N	container	t	12	f	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
d3dd37d3-0013-4444-9000-e00000000013	\N	غير غذائية	Non-Grocery	non-grocery	\N	\N	package	t	13	f	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.166667+00
\.


--
-- Data for Name: cities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cities (id, name_ar, name_en, slug, country_code, is_active, sort_order, created_at, updated_at, code, region_id) FROM stdin;
a6f7b140-0009-4444-a000-000000000009	تبوك	Tabuk	tabuk	SA	t	9	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	TABC	b144b6c8-5555-4444-b000-000000000005
a6f7b140-0001-4444-a000-000000000001	الرياض	Riyadh	riyadh	SA	t	1	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	RIYC	b144b6c8-1111-4444-b000-000000000001
a6f7b140-0002-4444-a000-000000000002	جدة	Jeddah	jeddah	SA	t	2	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	JEDC	b144b6c8-2222-4444-b000-000000000002
a6f7b140-0003-4444-a000-000000000003	مكة المكرمة	Makkah	makkah	SA	t	3	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	MAKC	b144b6c8-2222-4444-b000-000000000002
a6f7b140-0004-4444-a000-000000000004	المدينة المنورة	Madinah	madinah	SA	t	4	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	MEDC	b144b6c8-2222-4444-b000-000000000002
a6f7b140-0005-4444-a000-000000000005	الدمام	Dammam	dammam	SA	t	5	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	DAMC	b144b6c8-3333-4444-b000-000000000003
a6f7b140-0006-4444-a000-000000000006	الخبر	Khobar	khobar	SA	t	6	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	KHBC	b144b6c8-3333-4444-b000-000000000003
a6f7b140-0007-4444-a000-000000000007	الظهران	Dhahran	dhahran	SA	t	7	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	DHAC	b144b6c8-3333-4444-b000-000000000003
a6f7b140-0008-4444-a000-000000000008	الطائف	Taif	taif	SA	t	8	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	TAIC	b144b6c8-2222-4444-b000-000000000002
a6f7b140-0012-4444-a000-000000000012	أبها	Abha	abha	SA	t	12	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	ABHC	b144b6c8-4444-4444-b000-000000000004
a6f7b140-0010-4444-a000-000000000010	بريدة	Buraydah	buraydah	SA	t	10	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	BURC	b144b6c8-1111-4444-b000-000000000001
a6f7b140-0011-4444-a000-000000000011	خميس مشيط	Khamis Mushait	khamis-mushait	SA	t	11	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	KHMC	b144b6c8-4444-4444-b000-000000000004
a6f7b140-0013-4444-a000-000000000013	حائل	Hail	hail	SA	t	13	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	HAIC	b144b6c8-1111-4444-b000-000000000001
a6f7b140-0014-4444-a000-000000000014	جازان	Jazan	jazan	SA	t	14	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	JAZC	b144b6c8-4444-4444-b000-000000000004
a6f7b140-0015-4444-a000-000000000015	نجران	Najran	najran	SA	t	15	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	NAJC	b144b6c8-4444-4444-b000-000000000004
a6f7b140-0016-4444-a000-000000000016	الباحة	Al Bahah	al-bahah	SA	t	16	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	BAHC	b144b6c8-4444-4444-b000-000000000004
a6f7b140-0017-4444-a000-000000000017	سكاكا	Sakaka	sakaka	SA	t	17	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	SKKC	b144b6c8-5555-4444-b000-000000000005
a6f7b140-0018-4444-a000-000000000018	عرعر	Arar	arar	SA	t	18	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	ARAC	b144b6c8-5555-4444-b000-000000000005
a6f7b140-0019-4444-a000-000000000019	الأحساء	Al Ahsa	al-ahsa	SA	t	19	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	AHSC	b144b6c8-3333-4444-b000-000000000003
a6f7b140-0020-4444-a000-000000000020	الجبيل	Jubail	jubail	SA	t	20	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	JUBC	b144b6c8-3333-4444-b000-000000000003
a6f7b140-0021-4444-a000-000000000021	ينبع	Yanbu	yanbu	SA	t	21	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	YANC	b144b6c8-2222-4444-b000-000000000002
a6f7b140-0022-4444-a000-000000000022	القطيف	Qatif	qatif	SA	t	22	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	QATC	b144b6c8-3333-4444-b000-000000000003
a6f7b140-0023-4444-a000-000000000023	عنيزة	Unaizah	unaizah	SA	t	23	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	UNZC	b144b6c8-1111-4444-b000-000000000001
a6f7b140-0024-4444-a000-000000000024	الخرج	Al Kharj	al-kharj	SA	t	24	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	KHRC	b144b6c8-1111-4444-b000-000000000001
a6f7b140-0025-4444-a000-000000000025	حفر الباطن	Hafar Al Batin	hafar-al-batin	SA	t	25	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:53.050915+00	HAFC	b144b6c8-3333-4444-b000-000000000003
\.


--
-- Data for Name: import_batches; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.import_batches (id, uploaded_by, supermarket_id, location_scope, city_id, region_id, source_id, file_name, file_url, file_type, status, total_rows, valid_rows, warning_rows, error_rows, imported_rows, skipped_rows, offer_start_date, offer_end_date, created_at, updated_at, completed_at) FROM stdin;
\.


--
-- Data for Name: import_rows; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.import_rows (id, import_batch_id, row_number, raw_data, normalized_data, status, created_offer_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: issue_reports; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.issue_reports (id, offer_id, user_id, issue_type, status, comment, reporter_email, admin_notes, resolved_by, resolved_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: legacy_id_crosswalk; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.legacy_id_crosswalk (id, entity_type, legacy_id, canonical_id, canonical_region_id, notes, created_at) FROM stdin;
8617fd6e-4be4-416f-8565-a949c9db28bf	region	b144b6c8-1111-477c-a496-d3c52e46b3f1	b144b6c8-1111-4444-b000-000000000001	b144b6c8-1111-4444-b000-000000000001	riyadh-region -> central	2026-10-29 10:56:42.178775+00
6a8d6bf5-36e3-4a1c-9ef6-adbfc8c8b721	region	b144b6c8-2222-477c-a496-d3c52e46b3f2	b144b6c8-2222-4444-b000-000000000002	b144b6c8-2222-4444-b000-000000000002	makkah-region -> western	2026-10-29 10:56:42.178775+00
73ad1ec3-861d-48fc-a5a2-3b8552a07d9d	region	b144b6c8-3333-477c-a496-d3c52e46b3f3	b144b6c8-3333-4444-b000-000000000003	b144b6c8-3333-4444-b000-000000000003	eastern-region -> eastern	2026-10-29 10:56:42.178775+00
51e93b13-aa98-4acf-9e2a-49a21d23d8ea	region	b144b6c8-4444-477c-a496-d3c52e46b3f4	b144b6c8-2222-4444-b000-000000000002	b144b6c8-2222-4444-b000-000000000002	madinah-region -> western	2026-10-29 10:56:42.178775+00
bdcadb0c-d66c-47d7-bed4-990def3d933f	region	b144b6c8-5555-477c-a496-d3c52e46b3f5	b144b6c8-1111-4444-b000-000000000001	b144b6c8-1111-4444-b000-000000000001	qassim-region -> central	2026-10-29 10:56:42.178775+00
8cb68a0a-3503-4ee1-9086-281534888906	region	b144b6c8-6666-477c-a496-d3c52e46b3f6	b144b6c8-4444-4444-b000-000000000004	b144b6c8-4444-4444-b000-000000000004	asir-region -> southern	2026-10-29 10:56:42.178775+00
2127f2eb-7366-4711-8c3a-653cec336e83	region	b144b6c8-7777-477c-a496-d3c52e46b3f7	b144b6c8-5555-4444-b000-000000000005	b144b6c8-5555-4444-b000-000000000005	tabuk-region -> northern	2026-10-29 10:56:42.178775+00
7de167e8-7227-471d-833e-619c69936c52	region	b144b6c8-8888-477c-a496-d3c52e46b3f8	b144b6c8-1111-4444-b000-000000000001	b144b6c8-1111-4444-b000-000000000001	hail-region -> central	2026-10-29 10:56:42.178775+00
406b07bc-67a3-4a57-a271-851248ed6d9f	region	b144b6c8-9999-477c-a496-d3c52e46b3f9	b144b6c8-5555-4444-b000-000000000005	b144b6c8-5555-4444-b000-000000000005	northern-borders-region -> northern	2026-10-29 10:56:42.178775+00
ee358b3d-93b7-42ec-8930-3a68009d1956	region	b144b6c8-aaaa-477c-a496-d3c52e46b3f0	b144b6c8-4444-4444-b000-000000000004	b144b6c8-4444-4444-b000-000000000004	jazan-region -> southern	2026-10-29 10:56:42.178775+00
b8061c1c-dd3b-49e0-a1ac-ecf1e58ada02	region	b144b6c8-bbbb-477c-a496-d3c52e46b3f1	b144b6c8-4444-4444-b000-000000000004	b144b6c8-4444-4444-b000-000000000004	najran-region -> southern	2026-10-29 10:56:42.178775+00
c7d5e8a2-0f8a-483c-b953-792f31e62c97	region	b144b6c8-cccc-477c-a496-d3c52e46b3f2	b144b6c8-4444-4444-b000-000000000004	b144b6c8-4444-4444-b000-000000000004	al-bahah-region -> southern	2026-10-29 10:56:42.178775+00
cdff9b3d-98f3-4f39-a89f-cec5aefa80d0	region	b144b6c8-dddd-477c-a496-d3c52e46b3f3	b144b6c8-5555-4444-b000-000000000005	b144b6c8-5555-4444-b000-000000000005	al-jouf-region -> northern	2026-10-29 10:56:42.178775+00
d2d01d80-b1d9-4b8b-83c3-6df03e02d0a4	city	a6f7b140-0001-4c28-98e3-c28dd6fb4fb4	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	riyadh	2026-10-29 10:56:42.178775+00
a8499945-e203-437d-98b1-1f3be1adc738	city	a6f7b140-0002-4c28-98e3-c28dd6fb4fb4	a6f7b140-0002-4444-a000-000000000002	b144b6c8-2222-4444-b000-000000000002	jeddah	2026-10-29 10:56:42.178775+00
52ecc830-4d60-4d65-944d-4aae86493533	city	a6f7b140-0003-4c28-98e3-c28dd6fb4fb4	a6f7b140-0003-4444-a000-000000000003	b144b6c8-2222-4444-b000-000000000002	makkah	2026-10-29 10:56:42.178775+00
972ea3ba-9df0-4d54-826a-53fb09b899ff	city	a6f7b140-0004-4c28-98e3-c28dd6fb4fb4	a6f7b140-0004-4444-a000-000000000004	b144b6c8-2222-4444-b000-000000000002	madinah	2026-10-29 10:56:42.178775+00
08657842-52d0-42e3-8044-cedea52b7b6c	city	a6f7b140-0005-4c28-98e3-c28dd6fb4fb4	a6f7b140-0005-4444-a000-000000000005	b144b6c8-3333-4444-b000-000000000003	dammam	2026-10-29 10:56:42.178775+00
f47aff0f-e846-42b2-bc70-7adc5331da0e	city	a6f7b140-0006-4c28-98e3-c28dd6fb4fb4	a6f7b140-0006-4444-a000-000000000006	b144b6c8-3333-4444-b000-000000000003	khobar	2026-10-29 10:56:42.178775+00
b09c2922-37e8-45cc-9645-3fbb8f8bd736	city	a6f7b140-0007-4c28-98e3-c28dd6fb4fb4	a6f7b140-0007-4444-a000-000000000007	b144b6c8-3333-4444-b000-000000000003	dhahran	2026-10-29 10:56:42.178775+00
c00e836a-e6cf-42a9-b515-481f045d6cab	city	a6f7b140-0008-4c28-98e3-c28dd6fb4fb4	a6f7b140-0008-4444-a000-000000000008	b144b6c8-2222-4444-b000-000000000002	taif	2026-10-29 10:56:42.178775+00
e7ae0247-1a9c-4ebc-941d-8489ce3ed762	city	a6f7b140-0009-4c28-98e3-c28dd6fb4fb4	a6f7b140-0009-4444-a000-000000000009	b144b6c8-5555-4444-b000-000000000005	tabuk	2026-10-29 10:56:42.178775+00
e53ec3be-1d0f-4a74-83d9-6b9c3bf24bab	city	a6f7b140-0010-4c28-98e3-c28dd6fb4fb4	a6f7b140-0010-4444-a000-000000000010	b144b6c8-1111-4444-b000-000000000001	buraydah	2026-10-29 10:56:42.178775+00
ae789af8-e32d-4b20-af4e-d7b52f951631	city	a6f7b140-0011-4c28-98e3-c28dd6fb4fb4	a6f7b140-0011-4444-a000-000000000011	b144b6c8-4444-4444-b000-000000000004	khamis-mushait	2026-10-29 10:56:42.178775+00
d2c02f93-29de-44b8-9802-7f092c4e58f1	city	a6f7b140-0012-4c28-98e3-c28dd6fb4fb4	a6f7b140-0012-4444-a000-000000000012	b144b6c8-4444-4444-b000-000000000004	abha	2026-10-29 10:56:42.178775+00
cf2cebd8-05d2-4ec3-98b6-cfa2c7fe7f1a	city	a6f7b140-0013-4c28-98e3-c28dd6fb4fb4	a6f7b140-0013-4444-a000-000000000013	b144b6c8-1111-4444-b000-000000000001	hail	2026-10-29 10:56:42.178775+00
a0d17c77-af40-46a0-9246-e745a4c6edc7	city	a6f7b140-0014-4c28-98e3-c28dd6fb4fb4	a6f7b140-0014-4444-a000-000000000014	b144b6c8-4444-4444-b000-000000000004	jazan	2026-10-29 10:56:42.178775+00
cca707af-ceb1-439c-94ee-5c3f96e4a27d	city	a6f7b140-0015-4c28-98e3-c28dd6fb4fb4	a6f7b140-0015-4444-a000-000000000015	b144b6c8-4444-4444-b000-000000000004	najran	2026-10-29 10:56:42.178775+00
db864ae6-e9aa-4d3a-a96e-f84957f84933	city	a6f7b140-0016-4c28-98e3-c28dd6fb4fb4	a6f7b140-0016-4444-a000-000000000016	b144b6c8-4444-4444-b000-000000000004	al-bahah	2026-10-29 10:56:42.178775+00
e040416e-3210-4fee-95e5-ede4e55c4e91	city	a6f7b140-0017-4c28-98e3-c28dd6fb4fb4	a6f7b140-0017-4444-a000-000000000017	b144b6c8-5555-4444-b000-000000000005	sakaka	2026-10-29 10:56:42.178775+00
2199fe78-ff38-4de7-af61-dd48f8db0120	city	a6f7b140-0018-4c28-98e3-c28dd6fb4fb4	a6f7b140-0018-4444-a000-000000000018	b144b6c8-5555-4444-b000-000000000005	arar	2026-10-29 10:56:42.178775+00
9dbc06ee-0167-4b66-9d80-de9c352e3fd0	city	a6f7b140-0019-4c28-98e3-c28dd6fb4fb4	a6f7b140-0019-4444-a000-000000000019	b144b6c8-3333-4444-b000-000000000003	al-ahsa	2026-10-29 10:56:42.178775+00
31e610bc-19cb-4074-82f7-9980f754b40a	city	a6f7b140-0020-4c28-98e3-c28dd6fb4fb4	a6f7b140-0020-4444-a000-000000000020	b144b6c8-3333-4444-b000-000000000003	jubail	2026-10-29 10:56:42.178775+00
ffc52786-1782-41c5-9279-5a4c1b78c0df	city	a6f7b140-0021-4c28-98e3-c28dd6fb4fb4	a6f7b140-0021-4444-a000-000000000021	b144b6c8-2222-4444-b000-000000000002	yanbu	2026-10-29 10:56:42.178775+00
ec3924ce-4f60-44c4-b5cc-cfd0be65ab48	city	a6f7b140-0022-4c28-98e3-c28dd6fb4fb4	a6f7b140-0022-4444-a000-000000000022	b144b6c8-3333-4444-b000-000000000003	qatif	2026-10-29 10:56:42.178775+00
71fb4570-17c0-41fe-be80-ed51380bd13c	city	a6f7b140-0023-4c28-98e3-c28dd6fb4fb4	a6f7b140-0023-4444-a000-000000000023	b144b6c8-1111-4444-b000-000000000001	unaizah	2026-10-29 10:56:42.178775+00
65201cc7-bd65-4eb6-9be4-91befe840ec7	city	a6f7b140-0024-4c28-98e3-c28dd6fb4fb4	a6f7b140-0024-4444-a000-000000000024	b144b6c8-1111-4444-b000-000000000001	al-kharj	2026-10-29 10:56:42.178775+00
f441dd4b-073a-4339-bc13-959b86f3d3d5	city	a6f7b140-0025-4c28-98e3-c28dd6fb4fb4	a6f7b140-0025-4444-a000-000000000025	b144b6c8-3333-4444-b000-000000000003	hafar-al-batin	2026-10-29 10:56:42.178775+00
\.


--
-- Data for Name: offer_display_images; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.offer_display_images (id, offer_id, storage_bucket, storage_object_path, public_url, mime_type, byte_size, content_sha256, source_kind, source_url, normalized_source_url, visual_subject_key, approval_status, rights_basis, reviewed_by, reviewed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: offer_revision_snapshots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.offer_revision_snapshots (id, offer_id, source_offer_id, source_revision, semantic_checksum, snapshot_payload, superseded_by_revision, created_at) FROM stdin;
\.


--
-- Data for Name: offer_sources; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.offer_sources (id, source_type, supermarket_id, city_id, region_id, title, source_url, file_url, leaflet_id, storage_prefix, image_count, valid_from, valid_to, notes, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: offer_status_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.offer_status_history (id, offer_id, old_status, new_status, changed_by, reason, created_at) FROM stdin;
\.


--
-- Data for Name: offer_visual_group_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.offer_visual_group_members (representative_offer_id, member_offer_id, visual_subject_key, visual_subject_name, created_at) FROM stdin;
\.


--
-- Data for Name: offers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.offers (id, product_id, supermarket_id, city_id, region_id, category_id, brand_id, title_ar, title_en, offer_price, original_price, discount_amount, discount_percentage, pack_size_value, pack_size_unit, pack_quantity, unit_price, unit_price_unit, offer_start_date, offer_end_date, status, image_url, image_path, image_bucket, image_source_type, source_id, source_page_number, source_item_number, source_reference, external_image_id, ingestion_source, location_scope, deal_score, deal_label, data_quality_score, is_loyalty_required, loyalty_notes_ar, loyalty_notes_en, quantity_limit, notes_ar, notes_en, created_by, updated_by, approved_by, published_at, created_at, updated_at, source_offer_id, source_revision, semantic_checksum, contract_version, compound_group_id, supersedes_source_offer_id, exact_identity_status, category_slug, derived_subcategory_slug, commodity_tag, item_domain, brand_state, brand_candidate_text, normalized_title_ar, normalized_title_en, product_attributes, assortment_status, known_options, sale_unit_type, inner_pack_count, each_size_value, each_size_unit, total_content_value, total_content_unit, is_indivisible_sale_unit, currency, price_basis, verified_non_member_price, promo_mechanic, bonus_wording, bonus_fulfillment, loyalty_requirement, quantity_limit_value, quantity_limit_unit, quantity_limit_scope, informational_inner_unit_price, display_unit_price_label_ar, display_unit_price_label_en, thumbnail_storage_path, thumbnail_url, image_subject_scope, page_area_share_pct, is_front_page, is_hero_offer, scoped_assessments, reason_codes, contract_v2, catalog_candidate_key, catalog_match_status, catalog_verification_basis, catalog_verified_by, catalog_verified_at) FROM stdin;
\.


--
-- Data for Name: product_aliases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.product_aliases (id, product_id, alias_text, language, source, created_at) FROM stdin;
\.


--
-- Data for Name: product_images; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.product_images (id, product_id, role, storage_bucket, storage_object_path, public_url, mime_type, byte_size, content_sha256, source_url, normalized_source_url, approval_status, rights_basis, reviewed_by, reviewed_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.products (category_id, brand_id, name_ar, name_en, slug, description_ar, description_en, default_image_url, default_pack_size_value, default_pack_size_unit, default_unit_type, is_normalized, is_active, created_at, updated_at, canonical_product_key, item_name_complete, brand_name, variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type, gtin, verification_status, verification_basis, verified_by, verified_at, approved_primary_image_id, id) FROM stdin;
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.profiles (id, email, display_name, role, preferred_language, preferred_city_id, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: regions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.regions (id, name_ar, name_en, slug, is_active, created_at, updated_at, code) FROM stdin;
b144b6c8-1111-4444-b000-000000000001	المنطقة الوسطى	Central Region	central	t	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.925508+00	CENT
b144b6c8-2222-4444-b000-000000000002	المنطقة الغربية	Western Region	western	t	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.925508+00	WEST
b144b6c8-3333-4444-b000-000000000003	المنطقة الشرقية	Eastern Region	eastern	t	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.925508+00	EAST
b144b6c8-4444-4444-b000-000000000004	المنطقة الجنوبية	Southern Region	southern	t	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.925508+00	SOUT
b144b6c8-5555-4444-b000-000000000005	المنطقة الشمالية	Northern Region	northern	t	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.925508+00	NORT
\.


--
-- Data for Name: saved_offers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.saved_offers (id, user_id, offer_id, created_at) FROM stdin;
\.


--
-- Data for Name: shopping_list_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.shopping_list_items (id, shopping_list_id, offer_id, product_id, custom_name, quantity, is_checked, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: shopping_lists; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.shopping_lists (id, user_id, name, city_id, is_default, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: supermarket_regions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.supermarket_regions (id, supermarket_id, city_id, region_id, is_active, created_at) FROM stdin;
a5ce5d1a-0e82-48b9-9938-55fceeae4e4d	c2cc16c2-0001-4444-b000-c00000000001	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
10f11c00-2690-438c-9140-24ee51e0569b	c2cc16c2-0002-4444-b000-c00000000002	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
2702e20b-6cba-449f-bf16-e54fac84670e	c2cc16c2-0003-4444-b000-c00000000003	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
75838dfe-9700-4d4b-933b-9ca7014b6c83	c2cc16c2-0004-4444-b000-c00000000004	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
f545233f-f913-4865-ad86-e26bdbf1b030	c2cc16c2-0005-4444-b000-c00000000005	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
f68bc4a6-0aed-4e3d-84a6-e6808deae245	c2cc16c2-0006-4444-b000-c00000000006	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
3406c19a-3e59-4b92-91bc-a8a6c50dcab9	c2cc16c2-0007-4444-b000-c00000000007	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
24dfda4f-12dd-4184-bf1a-54a2ae4ff7a6	c2cc16c2-0008-4444-b000-c00000000008	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
3b9cf115-566a-47e6-b52a-c3fb3e09b7a3	c2cc16c2-0009-4444-b000-c00000000009	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
00fbd3de-9db2-4a6f-a6c6-aa290dfb2d82	c2cc16c2-0010-4444-b000-c00000000010	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
8609ecc8-a1fe-41aa-a374-9f77c1bb1d52	c2cc16c2-0011-4444-b000-c00000000011	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
7307ca93-5956-4cfb-a84b-9502402b18f9	c2cc16c2-0012-4444-b000-c00000000012	a6f7b140-0001-4444-a000-000000000001	b144b6c8-1111-4444-b000-000000000001	t	2026-10-29 10:48:54.99896+00
\.


--
-- Data for Name: supermarkets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.supermarkets (id, name_ar, name_en, slug, logo_url, website_url, is_active, sort_order, notes, created_at, updated_at, code) FROM stdin;
2a01a099-ab36-4150-90fb-d63f3c18fa6c	أسواق نوري	Noori Supermarket	noori	\N	\N	t	0	\N	2026-11-06 10:20:08.682479+00	2026-11-06 10:20:08.682479+00	\N
c2cc16c2-0001-4444-b000-c00000000001	بنده	Panda	panda	/images/supermarkets/panda.png	https://www.panda.com.sa	t	1	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	PAND
c2cc16c2-0002-4444-b000-c00000000002	أسواق العثيم	Othaim Markets	othaim	/images/supermarkets/othaim.svg	https://www.othaimmarkets.com	t	2	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	OTHM
c2cc16c2-0003-4444-b000-c00000000003	لولو هايبر ماركت	LuLu Hypermarket	lulu	/images/supermarkets/lulu.svg	https://www.luluhypermarket.com	t	3	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	LULU
c2cc16c2-0004-4444-b000-c00000000004	الدانوب	Danube	danube	/images/supermarkets/danube.svg	https://danubeco.com	t	4	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	DANB
c2cc16c2-0009-4444-b000-c00000000009	نستو هايبرماركت	Nesto Hypermarket	nesto	/images/supermarkets/nesto.svg	https://nestogroup.com	t	9	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	NEST
c2cc16c2-0005-4444-b000-c00000000005	أسواق التميمي	Tamimi Markets	tamimi	/images/supermarkets/tamimi.svg	https://tamimimarkets.com	t	5	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	TAMM
c2cc16c2-0006-4444-b000-c00000000006	كارفور	Carrefour	carrefour	/images/supermarkets/carrefour.svg	https://www.carrefourksa.com	t	6	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	CARF
c2cc16c2-0007-4444-b000-c00000000007	بن داود	BinDawood	bin-dawood	/images/supermarkets/bin-dawood.svg	https://www.bindawood.com	t	7	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	BNDW
c2cc16c2-0008-4444-b000-c00000000008	هايبر الوفاء	Hyper Alwafa	alwafa	/images/supermarkets/alwafa.svg	https://hyperalwafa.com	t	8	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	ALWF
c2cc16c2-0010-4444-b000-c00000000010	أسواق المزرعة	Farm Superstores	farm	/images/supermarkets/farm.svg	https://farm.com.sa	t	10	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	FARM
c2cc16c2-0011-4444-b000-c00000000011	مانويل	Manuel Market	manuel	/images/supermarkets/manuel.svg	https://manuelmarket.com	t	11	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	MANU
c2cc16c2-0012-4444-b000-c00000000012	أسواق الراية	Al Raya Markets	raya	/images/supermarkets/raya.svg	https://alraya.com.sa	t	12	\N	2026-10-29 10:48:54.99896+00	2026-11-15 20:46:52.535786+00	RAYA
\.


--
-- Data for Name: units; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.units (id, code, name_ar, name_en, symbol_ar, symbol_en, base_unit_code, conversion_to_base, is_active, sort_order) FROM stdin;
e4ee48e4-0001-4444-a000-f00000000001	kg	كيلوجرام	Kilogram	كجم	kg	kg	1	t	1
e4ee48e4-0002-4444-a000-f00000000002	g	جرام	Gram	جم	g	kg	0.001	t	2
e4ee48e4-0003-4444-a000-f00000000003	liter	لتر	Liter	لتر	L	liter	1	t	3
e4ee48e4-0004-4444-a000-f00000000004	ml	ملليلتر	Milliliter	مل	ml	liter	0.001	t	4
e4ee48e4-0005-4444-a000-f00000000005	piece	حبة	Piece	حبة	pc	piece	1	t	5
e4ee48e4-0006-4444-a000-f00000000006	pack	عبوة	Pack	عبوة	pack	piece	1	t	6
e4ee48e4-0007-4444-a000-f00000000007	diaper	حفاضة	Diaper	حفاضة	diaper	piece	1	t	7
e4ee48e4-0008-4444-a000-f00000000008	wash	غسلة	Wash	غسلة	wash	piece	1	t	8
e4ee48e4-0009-4444-a000-f00000000009	capsule	كبسولة	Capsule	كبسولة	capsule	piece	1	t	9
\.


--
-- Data for Name: validation_errors; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.validation_errors (id, import_batch_id, import_row_id, offer_id, severity, field_name, error_code, message, created_at) FROM stdin;
\.


--
-- Data for Name: watched_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.watched_items (id, user_id, product_id, category_id, brand_id, watch_text, preferred_pack_size_value, preferred_pack_size_unit, target_price, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Name: products_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.products_id_seq', 11, true);


--
-- Name: app_events app_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- Name: brands brands_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_slug_key UNIQUE (slug);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);


--
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);


--
-- Name: cities cities_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_slug_key UNIQUE (slug);


--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);


--
-- Name: import_rows import_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_rows
    ADD CONSTRAINT import_rows_pkey PRIMARY KEY (id);


--
-- Name: issue_reports issue_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_reports
    ADD CONSTRAINT issue_reports_pkey PRIMARY KEY (id);


--
-- Name: legacy_id_crosswalk legacy_id_crosswalk_legacy_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_id_crosswalk
    ADD CONSTRAINT legacy_id_crosswalk_legacy_id_key UNIQUE (legacy_id);


--
-- Name: legacy_id_crosswalk legacy_id_crosswalk_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_id_crosswalk
    ADD CONSTRAINT legacy_id_crosswalk_pkey PRIMARY KEY (id);


--
-- Name: offer_display_images offer_display_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_display_images
    ADD CONSTRAINT offer_display_images_pkey PRIMARY KEY (id);


--
-- Name: offer_revision_snapshots offer_revision_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_revision_snapshots
    ADD CONSTRAINT offer_revision_snapshots_pkey PRIMARY KEY (id);


--
-- Name: offer_sources offer_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_sources
    ADD CONSTRAINT offer_sources_pkey PRIMARY KEY (id);


--
-- Name: offer_status_history offer_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_status_history
    ADD CONSTRAINT offer_status_history_pkey PRIMARY KEY (id);


--
-- Name: offer_visual_group_members offer_visual_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_visual_group_members
    ADD CONSTRAINT offer_visual_group_members_pkey PRIMARY KEY (representative_offer_id, member_offer_id);


--
-- Name: offers offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_pkey PRIMARY KEY (id);


--
-- Name: product_aliases product_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_aliases
    ADD CONSTRAINT product_aliases_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_slug_key UNIQUE (slug);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- Name: regions regions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_slug_key UNIQUE (slug);


--
-- Name: saved_offers saved_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_offers
    ADD CONSTRAINT saved_offers_pkey PRIMARY KEY (id);


--
-- Name: shopping_list_items shopping_list_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_list_items
    ADD CONSTRAINT shopping_list_items_pkey PRIMARY KEY (id);


--
-- Name: shopping_lists shopping_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_lists
    ADD CONSTRAINT shopping_lists_pkey PRIMARY KEY (id);


--
-- Name: supermarket_regions supermarket_regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supermarket_regions
    ADD CONSTRAINT supermarket_regions_pkey PRIMARY KEY (id);


--
-- Name: supermarkets supermarkets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supermarkets
    ADD CONSTRAINT supermarkets_pkey PRIMARY KEY (id);


--
-- Name: supermarkets supermarkets_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supermarkets
    ADD CONSTRAINT supermarkets_slug_key UNIQUE (slug);


--
-- Name: saved_offers unique_user_saved_offer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_offers
    ADD CONSTRAINT unique_user_saved_offer UNIQUE (user_id, offer_id);


--
-- Name: units units_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_code_key UNIQUE (code);


--
-- Name: units units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_pkey PRIMARY KEY (id);


--
-- Name: offer_revision_snapshots uq_offer_revision_source_rev; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_revision_snapshots
    ADD CONSTRAINT uq_offer_revision_source_rev UNIQUE (source_offer_id, source_revision);


--
-- Name: products uq_products_canonical_product_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT uq_products_canonical_product_key UNIQUE (canonical_product_key);


--
-- Name: validation_errors validation_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_errors
    ADD CONSTRAINT validation_errors_pkey PRIMARY KEY (id);


--
-- Name: watched_items watched_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watched_items
    ADD CONSTRAINT watched_items_pkey PRIMARY KEY (id);


--
-- Name: idx_brands_name_ar_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_name_ar_trgm ON public.brands USING gin (name_ar public.gin_trgm_ops);


--
-- Name: idx_brands_name_en_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_name_en_trgm ON public.brands USING gin (name_en public.gin_trgm_ops);


--
-- Name: idx_cities_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cities_code ON public.cities USING btree (code);


--
-- Name: idx_cities_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cities_region_id ON public.cities USING btree (region_id);


--
-- Name: idx_import_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batches_status ON public.import_batches USING btree (status);


--
-- Name: idx_import_rows_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_rows_batch_id ON public.import_rows USING btree (import_batch_id);


--
-- Name: idx_issue_reports_offer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issue_reports_offer_id ON public.issue_reports USING btree (offer_id);


--
-- Name: idx_issue_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issue_reports_status ON public.issue_reports USING btree (status);


--
-- Name: idx_offer_display_images_offer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offer_display_images_offer_id ON public.offer_display_images USING btree (offer_id);


--
-- Name: idx_offer_display_images_sha256; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offer_display_images_sha256 ON public.offer_display_images USING btree (content_sha256);


--
-- Name: idx_offer_display_images_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offer_display_images_subject ON public.offer_display_images USING btree (visual_subject_key);


--
-- Name: idx_offer_revision_snapshots_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offer_revision_snapshots_lookup ON public.offer_revision_snapshots USING btree (source_offer_id, source_revision);


--
-- Name: idx_offer_revision_snapshots_offer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offer_revision_snapshots_offer_id ON public.offer_revision_snapshots USING btree (offer_id);


--
-- Name: idx_offer_sources_leaflet_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offer_sources_leaflet_id ON public.offer_sources USING btree (leaflet_id);


--
-- Name: idx_offers_assortment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_assortment_status ON public.offers USING btree (assortment_status);


--
-- Name: idx_offers_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_brand_id ON public.offers USING btree (brand_id);


--
-- Name: idx_offers_catalog_candidate_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_catalog_candidate_key ON public.offers USING btree (catalog_candidate_key);


--
-- Name: idx_offers_catalog_match_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_catalog_match_status ON public.offers USING btree (catalog_match_status);


--
-- Name: idx_offers_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_category_id ON public.offers USING btree (category_id);


--
-- Name: idx_offers_category_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_category_slug ON public.offers USING btree (category_slug);


--
-- Name: idx_offers_city_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_city_id ON public.offers USING btree (city_id);


--
-- Name: idx_offers_commodity_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_commodity_tag ON public.offers USING btree (commodity_tag);


--
-- Name: idx_offers_compound_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_compound_group_id ON public.offers USING btree (compound_group_id) WHERE (compound_group_id IS NOT NULL);


--
-- Name: idx_offers_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_created_at ON public.offers USING btree (created_at);


--
-- Name: idx_offers_deal_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_deal_score ON public.offers USING btree (deal_score);


--
-- Name: idx_offers_exact_identity_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_exact_identity_status ON public.offers USING btree (exact_identity_status);


--
-- Name: idx_offers_external_image_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_external_image_id ON public.offers USING btree (external_image_id);


--
-- Name: idx_offers_image_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_image_path ON public.offers USING btree (image_path);


--
-- Name: idx_offers_location_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_location_scope ON public.offers USING btree (location_scope);


--
-- Name: idx_offers_offer_end_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_offer_end_date ON public.offers USING btree (offer_end_date);


--
-- Name: idx_offers_offer_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_offer_source_id ON public.offers USING btree (source_id);


--
-- Name: idx_offers_offer_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_offer_start_date ON public.offers USING btree (offer_start_date);


--
-- Name: idx_offers_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_product_id ON public.offers USING btree (product_id);


--
-- Name: idx_offers_public_location_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_public_location_active ON public.offers USING btree (status, offer_end_date, location_scope, city_id, region_id);


--
-- Name: idx_offers_region_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_region_id ON public.offers USING btree (region_id);


--
-- Name: idx_offers_semantic_checksum; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_semantic_checksum ON public.offers USING btree (semantic_checksum);


--
-- Name: idx_offers_source_offer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_offers_source_offer_id ON public.offers USING btree (source_offer_id) WHERE (source_offer_id IS NOT NULL);


--
-- Name: idx_offers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_status ON public.offers USING btree (status);


--
-- Name: idx_offers_supermarket_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_supermarket_id ON public.offers USING btree (supermarket_id);


--
-- Name: idx_offers_supersedes_source_offer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_supersedes_source_offer_id ON public.offers USING btree (supersedes_source_offer_id) WHERE (supersedes_source_offer_id IS NOT NULL);


--
-- Name: idx_offers_thumbnail_storage_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_thumbnail_storage_path ON public.offers USING btree (thumbnail_storage_path);


--
-- Name: idx_offers_title_ar_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_title_ar_trgm ON public.offers USING gin (title_ar public.gin_trgm_ops);


--
-- Name: idx_offers_title_en_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_title_en_trgm ON public.offers USING gin (title_en public.gin_trgm_ops);


--
-- Name: idx_offers_unit_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_unit_price ON public.offers USING btree (unit_price);


--
-- Name: idx_product_aliases_alias_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_aliases_alias_trgm ON public.product_aliases USING gin (alias_text public.gin_trgm_ops);


--
-- Name: idx_product_aliases_normalized_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_product_aliases_normalized_key ON public.product_aliases USING btree (public.normalize_alias_key(alias_text));


--
-- Name: idx_product_images_norm_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_images_norm_url ON public.product_images USING btree (normalized_source_url);


--
-- Name: idx_product_images_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_images_product_id ON public.product_images USING btree (product_id);


--
-- Name: idx_product_images_sha256; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_images_sha256 ON public.product_images USING btree (content_sha256);


--
-- Name: idx_products_canonical_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_canonical_key ON public.products USING btree (canonical_product_key);


--
-- Name: idx_products_name_ar_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_ar_trgm ON public.products USING gin (name_ar public.gin_trgm_ops);


--
-- Name: idx_products_name_en_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_en_trgm ON public.products USING gin (name_en public.gin_trgm_ops);


--
-- Name: idx_products_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_verification_status ON public.products USING btree (verification_status);


--
-- Name: idx_regions_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regions_code ON public.regions USING btree (code);


--
-- Name: idx_saved_offers_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_offers_user_id ON public.saved_offers USING btree (user_id);


--
-- Name: idx_shopping_list_items_list_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shopping_list_items_list_id ON public.shopping_list_items USING btree (shopping_list_id);


--
-- Name: idx_shopping_list_items_unique_offer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_shopping_list_items_unique_offer ON public.shopping_list_items USING btree (shopping_list_id, offer_id) WHERE (offer_id IS NOT NULL);


--
-- Name: idx_shopping_lists_user_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_shopping_lists_user_default ON public.shopping_lists USING btree (user_id) WHERE (is_default = true);


--
-- Name: idx_shopping_lists_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shopping_lists_user_id ON public.shopping_lists USING btree (user_id);


--
-- Name: idx_supermarkets_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supermarkets_code ON public.supermarkets USING btree (code);


--
-- Name: idx_validation_errors_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validation_errors_batch_id ON public.validation_errors USING btree (import_batch_id);


--
-- Name: idx_visual_group_members_mem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visual_group_members_mem ON public.offer_visual_group_members USING btree (member_offer_id);


--
-- Name: idx_visual_group_members_rep; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visual_group_members_rep ON public.offer_visual_group_members USING btree (representative_offer_id);


--
-- Name: idx_visual_group_members_subj; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_visual_group_members_subj ON public.offer_visual_group_members USING btree (visual_subject_key);


--
-- Name: idx_watched_items_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watched_items_user_id ON public.watched_items USING btree (user_id);


--
-- Name: unique_supermarket_city_region; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unique_supermarket_city_region ON public.supermarket_regions USING btree (supermarket_id, COALESCE(city_id, 'NONE'::text), COALESCE(region_id, 'NONE'::text));


--
-- Name: uq_offer_display_images_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_offer_display_images_active ON public.offer_display_images USING btree (offer_id) WHERE (approval_status = 'approved'::text);


--
-- Name: uq_product_images_active_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_product_images_active_primary ON public.product_images USING btree (product_id) WHERE ((role = 'primary'::text) AND (approval_status = 'approved'::text));


--
-- Name: issue_reports trg_enforce_issue_report_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_issue_report_user_id BEFORE INSERT ON public.issue_reports FOR EACH ROW EXECUTE FUNCTION public.enforce_issue_report_user_id();


--
-- Name: products trg_prevent_product_id_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_product_id_update BEFORE UPDATE OF id ON public.products FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_product_id_update();


--
-- Name: profiles trg_prevent_profile_privilege_escalation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_profile_privilege_escalation BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();


--
-- Name: brands update_brands_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_brands_updated_at BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: categories update_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: cities update_cities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_cities_updated_at BEFORE UPDATE ON public.cities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: import_batches update_import_batches_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_import_batches_updated_at BEFORE UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: import_rows update_import_rows_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_import_rows_updated_at BEFORE UPDATE ON public.import_rows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: issue_reports update_issue_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_issue_reports_updated_at BEFORE UPDATE ON public.issue_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: offers update_offers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_offers_updated_at BEFORE UPDATE ON public.offers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: regions update_regions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_regions_updated_at BEFORE UPDATE ON public.regions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: shopping_list_items update_shopping_list_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_shopping_list_items_updated_at BEFORE UPDATE ON public.shopping_list_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: shopping_lists update_shopping_lists_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_shopping_lists_updated_at BEFORE UPDATE ON public.shopping_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: supermarkets update_supermarkets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_supermarkets_updated_at BEFORE UPDATE ON public.supermarkets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: watched_items update_watched_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_watched_items_updated_at BEFORE UPDATE ON public.watched_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: app_events app_events_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: app_events app_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: cities fk_cities_region_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT fk_cities_region_id FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;


--
-- Name: products fk_products_approved_primary_image; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_products_approved_primary_image FOREIGN KEY (approved_primary_image_id) REFERENCES public.product_images(id) ON DELETE SET NULL;


--
-- Name: import_batches import_batches_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: import_batches import_batches_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;


--
-- Name: import_batches import_batches_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.offer_sources(id) ON DELETE SET NULL;


--
-- Name: import_batches import_batches_supermarket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_supermarket_id_fkey FOREIGN KEY (supermarket_id) REFERENCES public.supermarkets(id) ON DELETE SET NULL;


--
-- Name: import_batches import_batches_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: import_rows import_rows_created_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_rows
    ADD CONSTRAINT import_rows_created_offer_id_fkey FOREIGN KEY (created_offer_id) REFERENCES public.offers(id) ON DELETE SET NULL;


--
-- Name: import_rows import_rows_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_rows
    ADD CONSTRAINT import_rows_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;


--
-- Name: issue_reports issue_reports_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_reports
    ADD CONSTRAINT issue_reports_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON DELETE CASCADE;


--
-- Name: issue_reports issue_reports_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_reports
    ADD CONSTRAINT issue_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: issue_reports issue_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issue_reports
    ADD CONSTRAINT issue_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: offer_display_images offer_display_images_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_display_images
    ADD CONSTRAINT offer_display_images_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON DELETE CASCADE;


--
-- Name: offer_revision_snapshots offer_revision_snapshots_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_revision_snapshots
    ADD CONSTRAINT offer_revision_snapshots_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON DELETE CASCADE;


--
-- Name: offer_sources offer_sources_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_sources
    ADD CONSTRAINT offer_sources_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: offer_sources offer_sources_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_sources
    ADD CONSTRAINT offer_sources_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: offer_sources offer_sources_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_sources
    ADD CONSTRAINT offer_sources_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;


--
-- Name: offer_sources offer_sources_supermarket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_sources
    ADD CONSTRAINT offer_sources_supermarket_id_fkey FOREIGN KEY (supermarket_id) REFERENCES public.supermarkets(id) ON DELETE SET NULL;


--
-- Name: offer_status_history offer_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_status_history
    ADD CONSTRAINT offer_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: offer_status_history offer_status_history_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_status_history
    ADD CONSTRAINT offer_status_history_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON DELETE CASCADE;


--
-- Name: offer_visual_group_members offer_visual_group_members_member_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_visual_group_members
    ADD CONSTRAINT offer_visual_group_members_member_offer_id_fkey FOREIGN KEY (member_offer_id) REFERENCES public.offers(id) ON DELETE CASCADE;


--
-- Name: offer_visual_group_members offer_visual_group_members_representative_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offer_visual_group_members
    ADD CONSTRAINT offer_visual_group_members_representative_offer_id_fkey FOREIGN KEY (representative_offer_id) REFERENCES public.offers(id) ON DELETE CASCADE;


--
-- Name: offers offers_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: offers offers_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: offers offers_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: offers offers_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: offers offers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: offers offers_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: offers offers_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL;


--
-- Name: offers offers_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.offer_sources(id) ON DELETE SET NULL;


--
-- Name: offers offers_supermarket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_supermarket_id_fkey FOREIGN KEY (supermarket_id) REFERENCES public.supermarkets(id) ON DELETE CASCADE;


--
-- Name: offers offers_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: product_aliases product_aliases_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_aliases
    ADD CONSTRAINT product_aliases_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_preferred_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_preferred_city_id_fkey FOREIGN KEY (preferred_city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: saved_offers saved_offers_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_offers
    ADD CONSTRAINT saved_offers_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON DELETE CASCADE;


--
-- Name: saved_offers saved_offers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_offers
    ADD CONSTRAINT saved_offers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: shopping_list_items shopping_list_items_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_list_items
    ADD CONSTRAINT shopping_list_items_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON DELETE SET NULL;


--
-- Name: shopping_list_items shopping_list_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_list_items
    ADD CONSTRAINT shopping_list_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: shopping_list_items shopping_list_items_shopping_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_list_items
    ADD CONSTRAINT shopping_list_items_shopping_list_id_fkey FOREIGN KEY (shopping_list_id) REFERENCES public.shopping_lists(id) ON DELETE CASCADE;


--
-- Name: shopping_lists shopping_lists_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_lists
    ADD CONSTRAINT shopping_lists_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE SET NULL;


--
-- Name: shopping_lists shopping_lists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_lists
    ADD CONSTRAINT shopping_lists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: supermarket_regions supermarket_regions_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supermarket_regions
    ADD CONSTRAINT supermarket_regions_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE CASCADE;


--
-- Name: supermarket_regions supermarket_regions_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supermarket_regions
    ADD CONSTRAINT supermarket_regions_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE CASCADE;


--
-- Name: supermarket_regions supermarket_regions_supermarket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supermarket_regions
    ADD CONSTRAINT supermarket_regions_supermarket_id_fkey FOREIGN KEY (supermarket_id) REFERENCES public.supermarkets(id) ON DELETE CASCADE;


--
-- Name: validation_errors validation_errors_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_errors
    ADD CONSTRAINT validation_errors_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE CASCADE;


--
-- Name: validation_errors validation_errors_import_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_errors
    ADD CONSTRAINT validation_errors_import_row_id_fkey FOREIGN KEY (import_row_id) REFERENCES public.import_rows(id) ON DELETE CASCADE;


--
-- Name: validation_errors validation_errors_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_errors
    ADD CONSTRAINT validation_errors_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON DELETE CASCADE;


--
-- Name: watched_items watched_items_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watched_items
    ADD CONSTRAINT watched_items_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: watched_items watched_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watched_items
    ADD CONSTRAINT watched_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: watched_items watched_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watched_items
    ADD CONSTRAINT watched_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: watched_items watched_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watched_items
    ADD CONSTRAINT watched_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: offer_revision_snapshots Admin and service read snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin and service read snapshots" ON public.offer_revision_snapshots FOR SELECT TO authenticated, service_role USING (public.is_admin());


--
-- Name: audit_logs Allow admins access to audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins access to audit logs" ON public.audit_logs USING (public.is_admin());


--
-- Name: import_batches Allow admins access to import batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins access to import batches" ON public.import_batches USING (public.is_admin());


--
-- Name: import_rows Allow admins access to import rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins access to import rows" ON public.import_rows USING (public.is_admin());


--
-- Name: validation_errors Allow admins access to validation errors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins access to validation errors" ON public.validation_errors USING (public.is_admin());


--
-- Name: issue_reports Allow admins full access to issue reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins full access to issue reports" ON public.issue_reports USING (public.is_admin());


--
-- Name: offers Allow admins manage offers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins manage offers" ON public.offers USING (public.is_admin());


--
-- Name: app_events Allow admins select app events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins select app events" ON public.app_events FOR SELECT USING (public.is_admin());


--
-- Name: saved_offers Allow admins select saved offers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins select saved offers" ON public.saved_offers FOR SELECT USING (public.is_admin());


--
-- Name: shopping_lists Allow admins select shopping lists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins select shopping lists" ON public.shopping_lists FOR SELECT USING (public.is_admin());


--
-- Name: watched_items Allow admins select watched items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins select watched items" ON public.watched_items FOR SELECT USING (public.is_admin());


--
-- Name: profiles Allow admins to insert/delete profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to insert/delete profiles" ON public.profiles USING (public.is_admin());


--
-- Name: brands Allow admins to manage brands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage brands" ON public.brands USING (public.is_admin());


--
-- Name: categories Allow admins to manage categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage categories" ON public.categories USING (public.is_admin());


--
-- Name: cities Allow admins to manage cities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage cities" ON public.cities USING (public.is_admin());


--
-- Name: offer_status_history Allow admins to manage offer history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage offer history" ON public.offer_status_history USING (public.is_admin());


--
-- Name: offer_sources Allow admins to manage offer_sources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage offer_sources" ON public.offer_sources USING (public.is_admin());


--
-- Name: product_aliases Allow admins to manage product_aliases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage product_aliases" ON public.product_aliases USING (public.is_admin());


--
-- Name: products Allow admins to manage products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage products" ON public.products USING (public.is_admin());


--
-- Name: regions Allow admins to manage regions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage regions" ON public.regions USING (public.is_admin());


--
-- Name: supermarket_regions Allow admins to manage supermarket_regions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage supermarket_regions" ON public.supermarket_regions USING (public.is_admin());


--
-- Name: supermarkets Allow admins to manage supermarkets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage supermarkets" ON public.supermarkets USING (public.is_admin());


--
-- Name: units Allow admins to manage units; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admins to manage units" ON public.units USING (public.is_admin());


--
-- Name: issue_reports Allow authenticated and anon insert restricted issue reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow authenticated and anon insert restricted issue reports" ON public.issue_reports FOR INSERT TO authenticated, anon WITH CHECK (((status = 'open'::text) AND (admin_notes IS NULL) AND (resolved_by IS NULL) AND (resolved_at IS NULL) AND (((auth.uid() IS NULL) AND (user_id IS NULL)) OR ((auth.uid() IS NOT NULL) AND ((user_id IS NULL) OR (user_id = auth.uid()))))));


--
-- Name: app_events Allow public insert app events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public insert app events" ON public.app_events FOR INSERT WITH CHECK (true);


--
-- Name: offer_display_images Allow public read access to approved offer display images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to approved offer display images" ON public.offer_display_images FOR SELECT USING ((approval_status = 'approved'::text));


--
-- Name: product_images Allow public read access to approved product images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to approved product images" ON public.product_images FOR SELECT USING ((approval_status = 'approved'::text));


--
-- Name: brands Allow public read access to brands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to brands" ON public.brands FOR SELECT USING (true);


--
-- Name: categories Allow public read access to categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to categories" ON public.categories FOR SELECT USING (true);


--
-- Name: cities Allow public read access to cities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to cities" ON public.cities FOR SELECT USING (true);


--
-- Name: offer_sources Allow public read access to offer_sources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to offer_sources" ON public.offer_sources FOR SELECT USING (true);


--
-- Name: offer_visual_group_members Allow public read access to offer_visual_group_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to offer_visual_group_members" ON public.offer_visual_group_members FOR SELECT USING (true);


--
-- Name: product_aliases Allow public read access to product_aliases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to product_aliases" ON public.product_aliases FOR SELECT USING (true);


--
-- Name: products Allow public read access to products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to products" ON public.products FOR SELECT USING (true);


--
-- Name: regions Allow public read access to regions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to regions" ON public.regions FOR SELECT USING (true);


--
-- Name: supermarket_regions Allow public read access to supermarket_regions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to supermarket_regions" ON public.supermarket_regions FOR SELECT USING (true);


--
-- Name: supermarkets Allow public read access to supermarkets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to supermarkets" ON public.supermarkets FOR SELECT USING (true);


--
-- Name: units Allow public read access to units; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access to units" ON public.units FOR SELECT USING (true);


--
-- Name: offer_status_history Allow public read offer history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read offer history" ON public.offer_status_history FOR SELECT USING (true);


--
-- Name: offers Allow public select active published offers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public select active published offers" ON public.offers FOR SELECT USING (((status = 'published'::text) AND ((offer_start_date IS NULL) OR (offer_start_date <= CURRENT_DATE)) AND (offer_end_date >= CURRENT_DATE)));


--
-- Name: offer_display_images Allow service_role full access to offer_display_images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow service_role full access to offer_display_images" ON public.offer_display_images TO service_role USING (true) WITH CHECK (true);


--
-- Name: offer_visual_group_members Allow service_role full access to offer_visual_group_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow service_role full access to offer_visual_group_members" ON public.offer_visual_group_members TO service_role USING (true) WITH CHECK (true);


--
-- Name: product_images Allow service_role full access to product_images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow service_role full access to product_images" ON public.product_images TO service_role USING (true) WITH CHECK (true);


--
-- Name: profiles Allow users to edit own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow users to edit own profile" ON public.profiles FOR UPDATE USING ((id = auth.uid()));


--
-- Name: saved_offers Allow users to manage own saved offers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow users to manage own saved offers" ON public.saved_offers USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: shopping_list_items Allow users to manage own shopping list items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow users to manage own shopping list items" ON public.shopping_list_items USING ((EXISTS ( SELECT 1
   FROM public.shopping_lists
  WHERE ((shopping_lists.id = shopping_list_items.shopping_list_id) AND (shopping_lists.user_id = auth.uid())))));


--
-- Name: shopping_lists Allow users to manage own shopping lists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow users to manage own shopping lists" ON public.shopping_lists USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: watched_items Allow users to manage own watched items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow users to manage own watched items" ON public.watched_items USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: issue_reports Allow users to view own issue reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow users to view own issue reports" ON public.issue_reports FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: profiles Allow users to view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow users to view own profile" ON public.profiles FOR SELECT USING (((id = auth.uid()) OR public.is_admin()));


--
-- Name: app_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: brands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: cities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

--
-- Name: import_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: import_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: issue_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: legacy_id_crosswalk; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legacy_id_crosswalk ENABLE ROW LEVEL SECURITY;

--
-- Name: offer_display_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offer_display_images ENABLE ROW LEVEL SECURITY;

--
-- Name: offer_revision_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offer_revision_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: offer_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offer_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: offer_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offer_status_history ENABLE ROW LEVEL SECURITY;

--
-- Name: offer_visual_group_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offer_visual_group_members ENABLE ROW LEVEL SECURITY;

--
-- Name: offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

--
-- Name: product_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: product_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: regions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: shopping_list_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shopping_list_items ENABLE ROW LEVEL SECURITY;

--
-- Name: shopping_lists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: supermarket_regions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supermarket_regions ENABLE ROW LEVEL SECURITY;

--
-- Name: supermarkets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supermarkets ENABLE ROW LEVEL SECURITY;

--
-- Name: units; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

--
-- Name: validation_errors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.validation_errors ENABLE ROW LEVEL SECURITY;

--
-- Name: watched_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.watched_items ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION build_sanitized_consumer_contract_v2(p_contract_v2 jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb) TO service_role;


--
-- Name: FUNCTION build_sanitized_consumer_contract_v2(p_contract_v2 jsonb, p_approved_product_image_url text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb, p_approved_product_image_url text) TO service_role;


--
-- Name: FUNCTION build_sanitized_consumer_contract_v2(p_contract_v2 jsonb, p_approved_product_image_url text, p_subject_scope text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.build_sanitized_consumer_contract_v2(p_contract_v2 jsonb, p_approved_product_image_url text, p_subject_scope text) TO service_role;


--
-- Name: FUNCTION enforce_issue_report_user_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_issue_report_user_id() TO anon;
GRANT ALL ON FUNCTION public.enforce_issue_report_user_id() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_issue_report_user_id() TO service_role;


--
-- Name: FUNCTION fn_prevent_product_id_update(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_prevent_product_id_update() TO service_role;


--
-- Name: TABLE brands; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.brands TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.brands TO authenticated;
GRANT ALL ON TABLE public.brands TO service_role;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.categories TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.categories TO authenticated;
GRANT ALL ON TABLE public.categories TO service_role;


--
-- Name: TABLE cities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.cities TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.cities TO authenticated;
GRANT ALL ON TABLE public.cities TO service_role;


--
-- Name: TABLE offer_display_images; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.offer_display_images TO service_role;
GRANT SELECT ON TABLE public.offer_display_images TO anon;
GRANT SELECT ON TABLE public.offer_display_images TO authenticated;


--
-- Name: TABLE offers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.offers TO service_role;


--
-- Name: TABLE product_images; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.product_images TO service_role;
GRANT SELECT ON TABLE public.product_images TO anon;
GRANT SELECT ON TABLE public.product_images TO authenticated;


--
-- Name: TABLE regions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.regions TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.regions TO authenticated;
GRANT ALL ON TABLE public.regions TO service_role;


--
-- Name: TABLE supermarkets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.supermarkets TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.supermarkets TO authenticated;
GRANT ALL ON TABLE public.supermarkets TO service_role;


--
-- Name: TABLE v_consumer_offers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_consumer_offers TO service_role;
GRANT SELECT ON TABLE public.v_consumer_offers TO anon;
GRANT SELECT ON TABLE public.v_consumer_offers TO authenticated;


--
-- Name: FUNCTION get_consumer_offers_for_shopping_date(p_shopping_date date, p_city_id text, p_region_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_consumer_offers_for_shopping_date(p_shopping_date date, p_city_id text, p_region_id text) TO service_role;
GRANT ALL ON FUNCTION public.get_consumer_offers_for_shopping_date(p_shopping_date date, p_city_id text, p_region_id text) TO anon;
GRANT ALL ON FUNCTION public.get_consumer_offers_for_shopping_date(p_shopping_date date, p_city_id text, p_region_id text) TO authenticated;


--
-- Name: FUNCTION get_offer_revision_history_summary(p_source_offer_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_offer_revision_history_summary(p_source_offer_id text) TO anon;
GRANT ALL ON FUNCTION public.get_offer_revision_history_summary(p_source_offer_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_offer_revision_history_summary(p_source_offer_id text) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION normalize_alias_key(p_text text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalize_alias_key(p_text text) TO service_role;
GRANT ALL ON FUNCTION public.normalize_alias_key(p_text text) TO anon;
GRANT ALL ON FUNCTION public.normalize_alias_key(p_text text) TO authenticated;


--
-- Name: FUNCTION prevent_profile_privilege_escalation(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_profile_privilege_escalation() TO anon;
GRANT ALL ON FUNCTION public.prevent_profile_privilege_escalation() TO authenticated;
GRANT ALL ON FUNCTION public.prevent_profile_privilege_escalation() TO service_role;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: TABLE app_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.app_events TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.app_events TO authenticated;
GRANT ALL ON TABLE public.app_events TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE import_batches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.import_batches TO service_role;


--
-- Name: TABLE import_rows; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.import_rows TO service_role;


--
-- Name: TABLE issue_reports; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.issue_reports TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.issue_reports TO authenticated;
GRANT ALL ON TABLE public.issue_reports TO service_role;


--
-- Name: COLUMN issue_reports.offer_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(offer_id) ON TABLE public.issue_reports TO anon;
GRANT INSERT(offer_id) ON TABLE public.issue_reports TO authenticated;


--
-- Name: COLUMN issue_reports.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(user_id) ON TABLE public.issue_reports TO anon;
GRANT INSERT(user_id) ON TABLE public.issue_reports TO authenticated;


--
-- Name: COLUMN issue_reports.issue_type; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(issue_type) ON TABLE public.issue_reports TO anon;
GRANT INSERT(issue_type) ON TABLE public.issue_reports TO authenticated;


--
-- Name: COLUMN issue_reports.comment; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(comment) ON TABLE public.issue_reports TO anon;
GRANT INSERT(comment) ON TABLE public.issue_reports TO authenticated;


--
-- Name: COLUMN issue_reports.reporter_email; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(reporter_email) ON TABLE public.issue_reports TO anon;
GRANT INSERT(reporter_email) ON TABLE public.issue_reports TO authenticated;


--
-- Name: TABLE legacy_id_crosswalk; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.legacy_id_crosswalk TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.legacy_id_crosswalk TO authenticated;
GRANT ALL ON TABLE public.legacy_id_crosswalk TO service_role;


--
-- Name: TABLE offer_revision_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.offer_revision_snapshots TO service_role;


--
-- Name: TABLE offer_sources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.offer_sources TO service_role;


--
-- Name: TABLE offer_status_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.offer_status_history TO service_role;


--
-- Name: TABLE offer_visual_group_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.offer_visual_group_members TO service_role;
GRANT SELECT ON TABLE public.offer_visual_group_members TO anon;
GRANT SELECT ON TABLE public.offer_visual_group_members TO authenticated;


--
-- Name: TABLE product_aliases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.product_aliases TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.product_aliases TO authenticated;
GRANT ALL ON TABLE public.product_aliases TO service_role;


--
-- Name: TABLE products; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.products TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;


--
-- Name: SEQUENCE products_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.products_id_seq TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.profiles TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: COLUMN profiles.display_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(display_name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.preferred_language; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(preferred_language) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.preferred_city_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(preferred_city_id) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE saved_offers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.saved_offers TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.saved_offers TO authenticated;
GRANT ALL ON TABLE public.saved_offers TO service_role;


--
-- Name: TABLE shopping_list_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.shopping_list_items TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.shopping_list_items TO authenticated;
GRANT ALL ON TABLE public.shopping_list_items TO service_role;


--
-- Name: TABLE shopping_lists; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.shopping_lists TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.shopping_lists TO authenticated;
GRANT ALL ON TABLE public.shopping_lists TO service_role;


--
-- Name: TABLE supermarket_regions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.supermarket_regions TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.supermarket_regions TO authenticated;
GRANT ALL ON TABLE public.supermarket_regions TO service_role;


--
-- Name: TABLE units; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.units TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.units TO authenticated;
GRANT ALL ON TABLE public.units TO service_role;


--
-- Name: TABLE validation_errors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.validation_errors TO service_role;


--
-- Name: TABLE watched_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.watched_items TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.watched_items TO authenticated;
GRANT ALL ON TABLE public.watched_items TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 3rZwfFWxDKUVcXXM1lgm7WTanLOekxLorPf1ckKh4LGUKbX8Od7hTOG9MbMw2A3

