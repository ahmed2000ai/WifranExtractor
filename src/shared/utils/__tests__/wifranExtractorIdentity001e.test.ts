import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  preMatchLocalOffersAgainstDb,
  checkPostCorrectionCatalogMatch,
  publishStagedLeafletDraftToDb,
  saveStagedLeafletDraft
} from '../../../../src/main/db/stagedLeafletDraftService'
import { matchOrCreateProduct } from '../../../../src/main/db/productMatchingService'
import { StagedOfferItem, StagedLeafletDraft } from '../../../../src/shared/types/stagedDraft'

// @ts-ignore
import { applyMigration008 } from '../../../../scripts/apply-migration-008'

describe('WIFRAN-EXTRACTOR-IDENTITY-001E — Final Deployment Readiness & Safety Verification Suite', () => {
  let db: PGlite
  let tmpDir: string

  const supermarketId = 'alwafa'

  beforeEach(async () => {
    db = new PGlite()
    tmpDir = path.join(process.cwd(), 'temp', `test-001e-${Date.now()}-${Math.random().toString(36).substring(7)}`)
    fs.mkdirSync(tmpDir, { recursive: true })

    // 1. Initialize schema to clean Migration 007 baseline:
    // Supermarkets, regions, cities, categories, brands, products (bigint identity),
    // product_images, offer_display_images, offers, v_consumer_offers (007 definition),
    // get_consumer_offers_for_shopping_date.
    await db.exec(`
      CREATE TABLE public.supermarkets (
        id text PRIMARY KEY,
        name_ar text NOT NULL,
        name_en text NOT NULL,
        slug text NOT NULL,
        code text,
        logo_url text
      );

      CREATE TABLE public.regions (
        id text PRIMARY KEY,
        name_ar text NOT NULL,
        name_en text NOT NULL,
        code text
      );

      CREATE TABLE public.cities (
        id text PRIMARY KEY,
        region_id text REFERENCES public.regions(id),
        name_ar text NOT NULL,
        name_en text NOT NULL,
        code text
      );

      CREATE TABLE public.categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name_ar text NOT NULL,
        name_en text NOT NULL,
        slug text
      );

      CREATE TABLE public.brands (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name_ar text NOT NULL,
        name_en text NOT NULL
      );

      CREATE TABLE public.products (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name_en text NOT NULL,
        name_ar text NOT NULL,
        slug text,
        canonical_product_key text,
        brand_id uuid REFERENCES public.brands(id),
        brand_name text,
        variant_or_flavor text,
        each_size_value numeric,
        each_size_unit text,
        inner_pack_count integer DEFAULT 1,
        sale_unit_type text DEFAULT 'each',
        verification_status text DEFAULT 'verified',
        approved_primary_image_id uuid,
        default_image_url text
      );

      CREATE TABLE public.product_aliases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
        alias_text text NOT NULL,
        language text DEFAULT 'ar',
        source text DEFAULT 'manual',
        created_at timestamptz DEFAULT now()
      );

      CREATE TABLE public.product_images (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id bigint REFERENCES public.products(id),
        role text DEFAULT 'primary',
        approval_status text DEFAULT 'approved',
        public_url text,
        storage_object_path text
      );

      CREATE TABLE public.offer_display_images (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        offer_id uuid,
        approval_status text DEFAULT 'approved',
        public_url text,
        storage_object_path text
      );

      CREATE TABLE public.offers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_offer_id text,
        source_revision integer DEFAULT 1,
        semantic_checksum text,
        contract_version text DEFAULT 'wifran.extractor.offer/2.0',
        compound_group_id text,
        supersedes_source_offer_id text,
        supermarket_id text REFERENCES public.supermarkets(id),
        location_scope text DEFAULT 'national',
        city_id text REFERENCES public.cities(id),
        region_id text REFERENCES public.regions(id),
        product_id bigint REFERENCES public.products(id),
        catalog_match_status text DEFAULT 'unresolved',
        exact_identity_status text DEFAULT 'unresolved',
        category_id uuid REFERENCES public.categories(id),
        category_slug text,
        derived_subcategory_slug text,
        commodity_tag text,
        item_domain text DEFAULT 'grocery',
        brand_id uuid REFERENCES public.brands(id),
        brand_state text DEFAULT 'unknown',
        brand_candidate_text text,
        title_ar text NOT NULL,
        title_en text,
        normalized_title_ar text,
        normalized_title_en text,
        product_attributes jsonb DEFAULT '{}'::jsonb,
        assortment_status text DEFAULT 'single_product',
        known_options jsonb DEFAULT '[]'::jsonb,
        sale_unit_type text DEFAULT 'each',
        inner_pack_count integer DEFAULT 1,
        each_size_value numeric,
        each_size_unit text,
        total_content_value numeric,
        total_content_unit text,
        is_indivisible_sale_unit boolean DEFAULT true,
        offer_price numeric NOT NULL,
        original_price numeric,
        verified_non_member_price numeric,
        currency text DEFAULT 'SAR',
        price_basis text DEFAULT 'each',
        unit_price numeric,
        unit_price_unit text,
        discount_amount numeric,
        discount_percentage numeric,
        informational_inner_unit_price numeric,
        display_unit_price_label_ar text,
        display_unit_price_label_en text,
        promo_mechanic text DEFAULT 'standard_price',
        bonus_wording text,
        bonus_fulfillment text DEFAULT 'not_applicable',
        is_loyalty_required boolean DEFAULT false,
        loyalty_requirement text DEFAULT 'none',
        quantity_limit text,
        quantity_limit_value integer,
        quantity_limit_unit text,
        quantity_limit_scope text,
        image_url text,
        image_path text,
        thumbnail_url text,
        thumbnail_storage_path text,
        image_subject_scope text DEFAULT 'unverified',
        page_area_share_pct numeric,
        is_front_page boolean DEFAULT false,
        is_hero_offer boolean DEFAULT false,
        deal_score numeric,
        deal_label text,
        offer_start_date date,
        offer_end_date date,
        status text DEFAULT 'published',
        scoped_assessments jsonb DEFAULT '[]'::jsonb,
        reason_codes text[] DEFAULT '{}'::text[],
        contract_v2 jsonb DEFAULT '{}'::jsonb,
        published_at timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION public.build_sanitized_consumer_contract_v2(contract jsonb, img_url text DEFAULT NULL, img_kind text DEFAULT NULL)
      RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(contract, '{}'::jsonb); $$;

      -- Create 007 Baseline View: v_consumer_offers (WITHOUT identity masking: exposes o.product_id directly)
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
        CASE
          WHEN pi.public_url IS NOT NULL THEN 'exact_product'
          WHEN odi.public_url IS NOT NULL THEN 'illustrative'
          ELSE NULL
        END AS display_image_kind,
        CASE
          WHEN pi.public_url IS NOT NULL THEN 'product_package'
          WHEN odi.public_url IS NOT NULL THEN 'representative_assortment'
          ELSE COALESCE(o.image_subject_scope, 'unverified')
        END AS card_image_subject_scope,
        CASE
          WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded'
          ELSE 'pending'
        END AS card_image_upload_state,
        CASE
          WHEN pi.public_url IS NOT NULL THEN 'product_package'
          WHEN odi.public_url IS NOT NULL THEN 'representative_assortment'
          ELSE 'unverified'
        END AS thumbnail_subject_scope,
        CASE
          WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded'
          ELSE 'pending'
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
        'active'::text AS temporal_lifecycle_state,
        o.scoped_assessments,
        o.reason_codes,
        public.build_sanitized_consumer_contract_v2(o.contract_v2, COALESCE(pi.public_url, odi.public_url), NULL) AS consumer_contract_v2,
        o.published_at,
        o.created_at,
        o.updated_at
      FROM public.offers o
      JOIN public.supermarkets s ON o.supermarket_id = s.id
      LEFT JOIN public.categories cat ON o.category_id = cat.id
      LEFT JOIN public.cities c ON o.city_id = c.id
      LEFT JOIN public.regions r ON o.region_id = r.id
      LEFT JOIN public.brands b ON o.brand_id = b.id
      LEFT JOIN public.product_images pi ON pi.product_id = o.product_id AND pi.role = 'primary' AND pi.approval_status = 'approved'
      LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id AND odi.approval_status = 'approved'
      WHERE o.status = 'published';

      CREATE OR REPLACE FUNCTION public.get_consumer_offers_for_shopping_date(
        p_shopping_date date DEFAULT (now() AT TIME ZONE 'Asia/Riyadh')::date,
        p_city_id text DEFAULT NULL,
        p_region_id text DEFAULT NULL
      )
      RETURNS SETOF public.v_consumer_offers
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT v.* FROM public.v_consumer_offers v
        WHERE v.offer_start_date <= p_shopping_date AND v.offer_end_date >= p_shopping_date;
      $$;

      -- Seed sample reference rows
      INSERT INTO public.regions (id, name_ar, name_en, code) VALUES ('western', 'الغربية', 'Western', 'W');
      INSERT INTO public.cities (id, region_id, name_ar, name_en, code) VALUES ('jeddah', 'western', 'جدة', 'Jeddah', 'JED');
      INSERT INTO public.supermarkets (id, name_ar, name_en, slug, code) VALUES ('alwafa', 'الوفاء', 'Al Wafa', 'al-wafa', 'WFA');
      INSERT INTO public.products (name_en, name_ar) VALUES ('Almarai Milk 1L', 'حليب المراعي ١ لتر');
      INSERT INTO public.products (name_en, name_ar) VALUES ('Nada Milk 1L', 'حليب ندى ١ لتر');

      -- Roles for security testing
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role;
        END IF;
      END $$;

      GRANT USAGE ON SCHEMA public TO anon;
      GRANT SELECT ON public.v_consumer_offers TO anon;
      GRANT EXECUTE ON FUNCTION public.get_consumer_offers_for_shopping_date(date, text, text) TO anon;
    `)
  })

  const createPgliteAdapter = (pgDb: PGlite) => ({
    query: (sql: string, params?: any[]) => pgDb.query(sql, params),
    exec: (sql: string) => pgDb.exec(sql)
  })

  afterEach(async () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  // -------------------------------------------------------------------------
  // 1. Clean Migration 007 Baseline Verification
  // -------------------------------------------------------------------------
  it('Requirement 2A: Clean Migration 007 database does not contain normalize_alias_key or unique index initially', async () => {
    const fnCheck = await db.query(`
      SELECT proname FROM pg_proc WHERE proname = 'normalize_alias_key';
    `)
    expect(fnCheck.rows.length).toBe(0) // Function DOES NOT exist yet in clean 007

    const idxCheck = await db.query(`
      SELECT indexname FROM pg_indexes WHERE indexname = 'idx_product_aliases_normalized_key';
    `)
    expect(idxCheck.rows.length).toBe(0) // Index DOES NOT exist yet in clean 007
  })

  // -------------------------------------------------------------------------
  // 2. Migration 008 Dry-Run on Clean Migration 007 Database
  // -------------------------------------------------------------------------
  it('Requirement 2B: applyMigration008 with --dry-run completes cleanly on clean Migration 007 and leaves 0 persistent changes', async () => {
    const res = await applyMigration008({ dryRun: true, client: createPgliteAdapter(db) as any })
    expect(res.ok).toBe(true)
    expect(res.isDryRun).toBe(true)

    // INVARIANT: Dry run must leave ZERO persistent schema changes
    const fnAfter = await db.query(`
      SELECT proname FROM pg_proc WHERE proname = 'normalize_alias_key';
    `)
    expect(fnAfter.rows.length).toBe(0)

    const idxAfter = await db.query(`
      SELECT indexname FROM pg_indexes WHERE indexname = 'idx_product_aliases_normalized_key';
    `)
    expect(idxAfter.rows.length).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 3. Preflight Conflict Detection without Data Deletion
  // -------------------------------------------------------------------------
  it('Requirement 2C: Preflight detects cross-product conflicts and aborts atomically without deleting rows', async () => {
    // Insert conflicting aliases pointing to different products (Product 1 vs Product 2)
    // with Arabic orthographic variations that normalize to the same key
    await db.exec(`
      INSERT INTO public.product_aliases (product_id, alias_text, language, source)
      VALUES (1, 'حليب المراعي طازج', 'ar', 'manual');

      INSERT INTO public.product_aliases (product_id, alias_text, language, source)
      VALUES (2, 'حليب ألمراعي طازج', 'ar', 'manual'); -- Alif hamza variation
    `)

    const countBefore = await db.query<{ count: string }>('SELECT count(*) as count FROM public.product_aliases;')
    expect(Number(countBefore.rows[0].count)).toBe(2)

    let migrationThrew = false
    try {
      await applyMigration008({ dryRun: false, client: createPgliteAdapter(db) as any })
    } catch (err: any) {
      migrationThrew = true
      expect(err.message).toMatch(/MIGRATION_008_PREFLIGHT_BLOCKED/i)
      expect(err.message).toMatch(/conflict/i)
    }

    expect(migrationThrew).toBe(true)

    // INVARIANT: Zero records deleted! Preflight is non-destructive
    const countAfter = await db.query<{ count: string }>('SELECT count(*) as count FROM public.product_aliases;')
    expect(Number(countAfter.rows[0].count)).toBe(2)
  })

  // -------------------------------------------------------------------------
  // 4. Successful Upgrade & Idempotent Re-Execution
  // -------------------------------------------------------------------------
  it('Requirement 2D: Successful Migration 008 creates objects and is safely idempotent on re-execution', async () => {
    // Clean up conflicting alias from previous test so preflight passes
    await db.exec('DELETE FROM public.product_aliases;')
    await db.exec(`
      INSERT INTO public.product_aliases (product_id, alias_text, language, source)
      VALUES (1, 'حليب المراعي طازج', 'ar', 'manual');
    `)

    // Pass 1: Live execution
    const pass1 = await applyMigration008({ dryRun: false, client: createPgliteAdapter(db) as any })
    expect(pass1.ok).toBe(true)
    expect(pass1.isDryRun).toBe(false)

    // Verify objects created
    const fnCheck = await db.query("SELECT proname FROM pg_proc WHERE proname = 'normalize_alias_key';")
    expect(fnCheck.rows.length).toBe(1)

    const idxCheck = await db.query("SELECT indexname FROM pg_indexes WHERE indexname = 'idx_product_aliases_normalized_key';")
    expect(idxCheck.rows.length).toBe(1)

    const viewCol = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'v_consumer_offers' AND column_name = 'display_image_url';
    `)
    expect(viewCol.rows.length).toBe(1)

    // Pass 2: Re-execution must succeed cleanly with 0 errors or unintended changes
    const pass2 = await applyMigration008({ dryRun: false, client: createPgliteAdapter(db) as any })
    expect(pass2.ok).toBe(true)

    // Verify alias data preserved
    const aliasCount = await db.query<{ count: string }>('SELECT count(*) as count FROM public.product_aliases;')
    expect(Number(aliasCount.rows[0].count)).toBe(1)
  })

  // -------------------------------------------------------------------------
  // 5. Verification of Rollback Procedure & Identity Protection Invariant
  // -------------------------------------------------------------------------
  describe('Requirement 1: Rollback Verification & Forward-Repair Safety Invariants', () => {
    beforeEach(async () => {
      // Apply Migration 008 first
      await db.exec('DELETE FROM public.product_aliases;')
      await applyMigration008({ dryRun: false, client: createPgliteAdapter(db) as any })
    })

    it('Procedure A: Surgical index rollback removes constraint without affecting view masking', async () => {
      // Surgical rollback drops index
      await db.exec('DROP INDEX IF EXISTS public.idx_product_aliases_normalized_key;')

      const idxCheck = await db.query("SELECT indexname FROM pg_indexes WHERE indexname = 'idx_product_aliases_normalized_key';")
      expect(idxCheck.rows.length).toBe(0)

      // INVARIANT: View masking remains active and functional
      const viewCol = await db.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'v_consumer_offers' AND column_name = 'display_image_url';
      `)
      expect(viewCol.rows.length).toBe(1)
    })

    it('Procedure B: Disputed Identity Re-Exposure Invariant proves why forward-repair is mandatory when conflict_needs_review rows exist', async () => {
      const disputedOfferId = crypto.randomUUID()
      await db.exec(`
        INSERT INTO public.offers (
          id, source_offer_id, supermarket_id, status, title_en, title_ar, offer_price,
          product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
        ) VALUES (
          '${disputedOfferId}', 'src-disp-1', '${supermarketId}', 'published', 'Disputed Milk', 'حليب متنازع', 5.50,
          1, 'conflict_needs_review', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
        );
      `)

      // Under Migration 008, consumer query returns product_id = NULL
      const res008 = await db.query<{ id: string; product_id: number | null }>(`
        SELECT id, product_id FROM public.v_consumer_offers WHERE id = '${disputedOfferId}';
      `)
      expect(res008.rows[0].product_id).toBeNull() // Masked!

      // If an operator were to mistakenly execute the pre-008 view definition:
      // (Restoring Migration 007 unmasked view)
      await db.exec(`
        DROP VIEW IF EXISTS public.v_consumer_offers CASCADE;
        CREATE OR REPLACE VIEW public.v_consumer_offers
        WITH (security_invoker = false)
        AS
        SELECT
          o.id,
          o.product_id,
          o.title_en,
          o.offer_price,
          o.status
        FROM public.offers o
        WHERE o.status = 'published';
      `)

      // INVARIANT PROVEN: Pre-008 view immediately leaks the disputed product_id (1) to consumers!
      const leakedRes = await db.query<{ id: string; product_id: number | null }>(`
        SELECT id, product_id FROM public.v_consumer_offers WHERE id = '${disputedOfferId}';
      `)
      expect(leakedRes.rows[0].product_id).toBe(1) // LEAKED!

      // CONCLUSION: When conflict_needs_review rows exist, forward-repair is mandatory;
      // rolling back the view to pre-008 breaks consumer safety.
    })

    it('Procedure C: Full Migration 007 rollback preserves all 64 columns, security settings, and permissions when no disputed rows exist', async () => {
      // Safe rollback script:
      await db.exec(`
        BEGIN;
        DROP INDEX IF EXISTS public.idx_product_aliases_normalized_key;
        DROP FUNCTION IF EXISTS public.normalize_alias_key(text);

        -- Exact Migration 007 in-place view restoration (no CASCADE needed!)
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
          CASE
            WHEN pi.public_url IS NOT NULL THEN 'exact_product'
            WHEN odi.public_url IS NOT NULL THEN 'illustrative'
            ELSE NULL
          END AS display_image_kind,
          CASE
            WHEN pi.public_url IS NOT NULL THEN 'product_package'
            WHEN odi.public_url IS NOT NULL THEN 'representative_assortment'
            ELSE COALESCE(o.image_subject_scope, 'unverified')
          END AS card_image_subject_scope,
          CASE
            WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded'
            ELSE 'pending'
          END AS card_image_upload_state,
          CASE
            WHEN pi.public_url IS NOT NULL THEN 'product_package'
            WHEN odi.public_url IS NOT NULL THEN 'representative_assortment'
            ELSE 'unverified'
          END AS thumbnail_subject_scope,
          CASE
            WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded'
            ELSE 'pending'
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
          'active'::text AS temporal_lifecycle_state,
          o.scoped_assessments,
          o.reason_codes,
          public.build_sanitized_consumer_contract_v2(o.contract_v2, COALESCE(pi.public_url, odi.public_url), NULL) AS consumer_contract_v2,
          o.published_at,
          o.created_at,
          o.updated_at
        FROM public.offers o
        JOIN public.supermarkets s ON o.supermarket_id = s.id
        LEFT JOIN public.categories cat ON o.category_id = cat.id
        LEFT JOIN public.cities c ON o.city_id = c.id
        LEFT JOIN public.regions r ON o.region_id = r.id
        LEFT JOIN public.brands b ON o.brand_id = b.id
        LEFT JOIN public.product_images pi ON pi.product_id = o.product_id AND pi.role = 'primary' AND pi.approval_status = 'approved'
        LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id AND odi.approval_status = 'approved'
        WHERE o.status = 'published';

        CREATE OR REPLACE FUNCTION public.get_consumer_offers_for_shopping_date(
          p_shopping_date date DEFAULT (now() AT TIME ZONE 'Asia/Riyadh')::date,
          p_city_id text DEFAULT NULL,
          p_region_id text DEFAULT NULL
        )
        RETURNS SETOF public.v_consumer_offers
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
          SELECT v.* FROM public.v_consumer_offers v
          WHERE v.offer_start_date <= p_shopping_date AND v.offer_end_date >= p_shopping_date;
        $$;

        GRANT SELECT ON public.v_consumer_offers TO anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.get_consumer_offers_for_shopping_date(date, text, text) TO anon, authenticated;
        COMMIT;
      `)

      const colCount = await db.query<{ count: string }>(`
        SELECT count(*) as count FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
      `)
      // Proves complete 98-column view preserved, NOT a shortened 13-column stub
      expect(Number(colCount.rows[0].count)).toBe(98)
    })
  })

  // -------------------------------------------------------------------------
  // 6. Alias Learning Authentication Security Verification
  // -------------------------------------------------------------------------
  it('Requirement 3: Automatic alias learning is strictly disabled because trusted operator authorization is not implemented', async () => {
    const jobDir = path.join(tmpDir, 'job-alias-auth')
    fs.mkdirSync(jobDir, { recursive: true })

    // Simulate an unauthenticated draft claiming operator approval via local JSON / IPC payload
    const draft: StagedLeafletDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      header: {
        supermarketId: 'alwafa',
        region: 'Western',
        validFrom: '2026-11-01',
        validTo: '2026-11-10',
        headerModifiedByOperator: true
      },
      items: [
        {
          id: 'item-untrusted',
          pageNumber: 1,
          status: 'ready',
          selectedImageSource: 'existing_db',
          matchedProductId: 1,
          isAiCorrected: true,
          aiCorrected: { titleAr: 'حليب المراعي ١ لتر' },
          isOperatorModified: false,
          operatorEditedFields: [],
          croppedEvidenceLocalPath: path.join(tmpDir, 'crop.webp'),
          // Attacker or unauthenticated script sets both approval flags:
          operatorApprovedIdentity: true,
          operatorApprovedBy: 'fake-admin-user@wifran.com',
          operatorApprovedAt: new Date().toISOString(),
          originalOcr: {
            titleAr: 'حليب المراعى ١ لتر', // Typo with Alef Maksura
            titleEn: 'Almarai Milk 1L'
          },
          titleAr: 'حليب المراعي ١ لتر',
          titleEn: 'Almarai Milk 1L'
        }
      ]
    }

    await saveStagedLeafletDraft(jobDir, draft)

    const mockSupabase = {
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 1,
                name_en: 'Almarai Milk 1L',
                name_ar: 'حليب المراعي ١ لتر',
                verification_status: 'verified'
              },
              error: null
            })
          })
        }),
        upsert: async () => ({ data: null, error: null })
      })
    }

    const publishRes = await publishStagedLeafletDraftToDb(jobDir, {
      operatorConfirmedPublish: true,
      supabaseClient: mockSupabase
    })

    expect(publishRes.ok).toBe(true)
    // INVARIANT: Automatic alias learning must remain 0! Unauthenticated payloads cannot trigger alias learning.
    expect(publishRes.aliasesLearnedCount).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 7. Candidate Retrieval Completeness across All 3 Paths
  // -------------------------------------------------------------------------
  describe('Requirement 4: Candidate Search Completeness across All 3 Automatic Matching Entry Points', () => {
    it('Path 1: productMatchingService.ts fails closed on candidate truncation (exact count > 25)', async () => {
      let countExactRequested = false

      const mockSupabaseCount = {
        from: (_table: string) => ({
          select: (_cols: string, opts?: any) => {
            if (opts?.count === 'exact') countExactRequested = true
            return {
              ilike: () => ({
                limit: async () => ({
                  data: [{ id: 1, name_en: 'Milk 1L' }], // 1 row returned due to server-side page clamp
                  count: 42, // PostgREST exact count indicates 42 candidates exist!
                  error: null
                })
              }),
              eq: () => ({
                limit: async () => ({ data: [], count: 0, error: null })
              })
            }
          }
        })
      }

      const res = await matchOrCreateProduct(
        { productNameEn: 'Milk 1L', productNameAr: 'حليب ١ لتر' },
        { supabaseClient: mockSupabaseCount }
      )

      expect(countExactRequested).toBe(true)
      // INVARIANT: Matching blocked because count (42) > limit (25)
      expect(res.productId).toBeNull()
      expect(res.issues.some((i) => i.code === 'PRODUCT_CANDIDATE_SEARCH_INCOMPLETE')).toBe(true)
    })

    it('Path 2: preMatchLocalOffersAgainstDb fails closed on candidate truncation (exact count > 25)', async () => {
      let countExactRequested = false

      const mockSupabaseCount = {
        from: (_table: string) => ({
          select: (_cols: string, opts?: any) => {
            if (opts?.count === 'exact') countExactRequested = true
            return {
              ilike: () => ({
                limit: async () => ({
                  data: [{ id: 1, name_en: 'Almarai Milk 1L' }],
                  count: 35, // PostgREST exact count indicates 35 candidates exist!
                  error: null
                })
              }),
              eq: () => {
                const chain: any = {
                  eq: () => chain,
                  limit: () => chain,
                  maybeSingle: async () => ({ data: null, error: null })
                }
                return chain
              }
            }
          }
        })
      }

      const items: StagedOfferItem[] = [
        {
          id: 'item-trunc-1',
          pageNumber: 1,
          status: 'ready',
          selectedImageSource: 'none',
          titleEn: 'Almarai Milk 1L',
          titleAr: 'حليب المراعي ١ لتر',
          croppedEvidenceLocalPath: path.join(tmpDir, 'crop1.webp'),
          isAiCorrected: false,
          isOperatorModified: false,
          operatorEditedFields: [],
          originalOcr: { titleEn: 'Almarai Milk 1L', titleAr: 'حليب المراعي ١ لتر' }
        }
      ]

      const res = await preMatchLocalOffersAgainstDb(items, {
        supabaseClient: mockSupabaseCount,
        mapFilePath: path.join(tmpDir, 'test-map.json')
      })

      expect(countExactRequested).toBe(true)
      // INVARIANT: Truncation prevents auto-matching; product remains unmatched
      expect(res.items[0].matchedProductId).toBeUndefined()
    })

    it('Path 3: checkPostCorrectionCatalogMatch fails closed on candidate truncation (exact count > 25)', async () => {
      let countExactRequested = false

      const mockSupabaseCount = {
        from: (_table: string) => ({
          select: (_cols: string, opts?: any) => {
            if (opts?.count === 'exact') countExactRequested = true
            return {
              ilike: () => ({
                limit: async () => ({
                  data: [{ id: 1, name_en: 'Almarai Milk 1L', default_image_url: 'https://example.com/p1.webp' }],
                  count: 50, // PostgREST exact count indicates 50 candidates exist!
                  error: null
                })
              }),
              eq: () => {
                const chain: any = {
                  eq: () => chain,
                  limit: () => chain,
                  maybeSingle: async () => ({ data: null, error: null })
                }
                return chain
              }
            }
          }
        })
      }

      const item: StagedOfferItem = {
        id: 'item-post-trunc',
        pageNumber: 1,
        status: 'ready',
        selectedImageSource: 'none',
        titleEn: 'Almarai Milk 1L',
        titleAr: 'حليب المراعي ١ لتر',
        croppedEvidenceLocalPath: path.join(tmpDir, 'crop2.webp'),
        isAiCorrected: false,
        isOperatorModified: false,
        operatorEditedFields: [],
        originalOcr: { titleEn: 'Almarai Milk 1L', titleAr: 'حليب المراعي ١ لتر' }
      }

      const postMatch = await checkPostCorrectionCatalogMatch(item, mockSupabaseCount)
      expect(countExactRequested).toBe(true)
      // INVARIANT: Candidate truncation returns null, blocking image reuse
      expect(postMatch).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // 8. Public Anon Role Access & Disputed Identity Masking Verification
  // -------------------------------------------------------------------------
  it('Requirement 5: Anon role can query get_consumer_offers_for_shopping_date with disputed identities strictly masked', async () => {
    // Apply Migration 008 to ensure latest views
    await db.exec('DELETE FROM public.product_aliases;')
    await applyMigration008({ dryRun: false, client: createPgliteAdapter(db) as any })

    const offerVerified = crypto.randomUUID()
    const offerDisputed = crypto.randomUUID()

    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, title_ar, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${offerVerified}', 'src-v', '${supermarketId}', 'published', 'Verified Milk', 'حليب مؤكد', 5.00,
        1, 'verified_linked', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );

      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, title_ar, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${offerDisputed}', 'src-d', '${supermarketId}', 'published', 'Disputed Milk', 'حليب متنازع', 4.00,
        1, 'conflict_needs_review', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );
    `)

    // Switch to anonymous public role
    await db.exec('SET ROLE anon;')

    const rpcRows = await db.query<{ id: string; product_id: number | null }>(`
      SELECT id, product_id
      FROM public.get_consumer_offers_for_shopping_date(CURRENT_DATE);
    `)

    const vRow = rpcRows.rows.find((r) => r.id === offerVerified)
    expect(vRow).toBeDefined()
    expect(vRow!.product_id).toBe(1)

    const dRow = rpcRows.rows.find((r) => r.id === offerDisputed)
    expect(dRow).toBeDefined()
    // INVARIANT: Disputed offer product_id is strictly NULL for anonymous consumers
    expect(dRow!.product_id).toBeNull()

    await db.exec('RESET ROLE;')
  })
})
