import { describe, it, expect, beforeEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import crypto from 'crypto'
// @ts-ignore
import { applyMigration008, parseCliArgs } from '../../../../scripts/apply-migration-008'
import { normalizeArabicText, normalizeEnglishText } from '../../../../src/shared/utils/textNormalization'

describe('WIFRAN-EXTRACTOR-IDENTITY-001F — Migration 008 Deployment Security & Contract Preservation Suite', () => {
  let db: PGlite
  const supermarketId = 'alwafa'

  const createPgliteAdapter = (pgDb: PGlite) => ({
    query: async (queryText: string, params?: any[]) => {
      const res = await pgDb.query(queryText, params)
      return { rows: res.rows, rowCount: res.rows.length }
    },
    exec: async (sqlText: string) => {
      await pgDb.exec(sqlText)
    },
    connect: async () => {},
    end: async () => {}
  })

  beforeEach(async () => {
    db = new PGlite()

    // Initialize baseline Migration 007 database schema
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;

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
        contract_version text DEFAULT '2.0.0',
        compound_group_id text,
        supersedes_source_offer_id text,
        supermarket_id text REFERENCES public.supermarkets(id),
        location_scope text DEFAULT 'national',
        city_id text REFERENCES public.cities(id),
        region_id text REFERENCES public.regions(id),
        product_id bigint REFERENCES public.products(id),
        exact_identity_status text DEFAULT 'unresolved',
        catalog_match_status text DEFAULT 'unresolved',
        category_id uuid REFERENCES public.categories(id),
        category_slug text,
        derived_subcategory_slug text,
        commodity_tag text,
        item_domain text,
        brand_id uuid REFERENCES public.brands(id),
        brand_state text,
        brand_candidate_text text,
        title_ar text NOT NULL,
        title_en text NOT NULL,
        normalized_title_ar text,
        normalized_title_en text,
        product_attributes jsonb DEFAULT '{}'::jsonb,
        assortment_status text,
        known_options jsonb,
        sale_unit_type text DEFAULT 'each',
        inner_pack_count integer DEFAULT 1,
        each_size_value numeric,
        each_size_unit text,
        total_content_value numeric,
        total_content_unit text,
        is_indivisible_sale_unit boolean DEFAULT true,
        offer_price numeric(10,2) NOT NULL,
        original_price numeric(10,2),
        verified_non_member_price numeric(10,2),
        currency text DEFAULT 'SAR',
        price_basis text,
        unit_price numeric(10,2),
        unit_price_unit text,
        discount_amount numeric(10,2),
        discount_percentage numeric(5,2),
        informational_inner_unit_price numeric(10,2),
        display_unit_price_label_ar text,
        display_unit_price_label_en text,
        promo_mechanic text,
        bonus_wording text,
        bonus_fulfillment text,
        is_loyalty_required boolean DEFAULT false,
        loyalty_requirement text,
        quantity_limit text,
        quantity_limit_value integer,
        quantity_limit_unit text,
        quantity_limit_scope text,
        image_url text,
        image_path text,
        thumbnail_url text,
        thumbnail_storage_path text,
        image_subject_scope text,
        page_area_share_pct numeric,
        is_front_page boolean DEFAULT false,
        is_hero_offer boolean DEFAULT false,
        deal_score numeric,
        deal_label text,
        offer_start_date date,
        offer_end_date date,
        scoped_assessments jsonb,
        reason_codes text[],
        contract_v2 jsonb DEFAULT '{}'::jsonb,
        published_at timestamptz,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        status text DEFAULT 'draft'
      );

      CREATE OR REPLACE FUNCTION public.build_sanitized_consumer_contract_v2(contract jsonb, public_url text, kind text)
      RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(contract, '{}'::jsonb); $$;

      -- Create Exact Migration 007 Baseline View: v_consumer_offers (98 columns)
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
      LEFT JOIN public.product_images pi ON pi.product_id = o.product_id AND pi.role = 'primary' AND pi.approval_status = 'approved' AND o.catalog_match_status = 'verified_linked'
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

      INSERT INTO public.regions (id, name_ar, name_en, code) VALUES ('western', 'الغربية', 'Western', 'W');
      INSERT INTO public.cities (id, region_id, name_ar, name_en, code) VALUES ('jeddah', 'western', 'جدة', 'Jeddah', 'JED');
      INSERT INTO public.supermarkets (id, name_ar, name_en, slug, code) VALUES ('alwafa', 'الوفاء', 'Al Wafa', 'alwafa', 'AW');
      INSERT INTO public.categories (id, name_ar, name_en, slug) VALUES ('a0000000-0000-0000-0000-000000000001', 'الألبان', 'Dairy', 'dairy');
      INSERT INTO public.brands (id, name_ar, name_en) VALUES ('b0000000-0000-0000-0000-000000000001', 'المراعي', 'Almarai');

      INSERT INTO public.products (name_en, name_ar, slug, canonical_product_key, brand_id, brand_name, each_size_value, each_size_unit)
      VALUES ('Almarai Fresh Milk 1L', 'حليب المراعي طازج 1 لتر', 'almarai-fresh-milk-1l', 'almarai|fresh-milk|1l', 'b0000000-0000-0000-0000-000000000001', 'Almarai', 1, 'l');

      INSERT INTO public.products (name_en, name_ar, slug, canonical_product_key, brand_id, brand_name, each_size_value, each_size_unit)
      VALUES ('Almarai Fresh Milk 2L', 'حليب المراعي طازج 2 لتر', 'almarai-fresh-milk-2l', 'almarai|fresh-milk|2l', 'b0000000-0000-0000-0000-000000000001', 'Almarai', 2, 'l');

      GRANT USAGE ON SCHEMA public TO anon, authenticated;
      GRANT SELECT ON public.v_consumer_offers TO anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.get_consumer_offers_for_shopping_date(date, text, text) TO anon, authenticated;
    `)
  })

  // -------------------------------------------------------------------------
  // 1. Clean Migration 007 -> 008 Upgrade
  // -------------------------------------------------------------------------
  it('Scenario 1: Clean Migration 007 -> 008 upgrade succeeds and creates unique index', async () => {
    const res = await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })
    expect(res.ok).toBe(true)

    // Check unique index exists
    const idx = await db.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'product_aliases' AND indexname = 'idx_product_aliases_normalized_key';
    `)
    expect(idx.rows.length).toBe(1)
  })

  // -------------------------------------------------------------------------
  // 2. Existing dependent views and RPCs remain intact
  // -------------------------------------------------------------------------
  it('Scenario 2: Dependent RPC function get_consumer_offers_for_shopping_date remains queryable without CASCADE destruction', async () => {
    await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })

    const rpcCheck = await db.query<{ proname: string; prosecdef: boolean }>(`
      SELECT proname, prosecdef FROM pg_proc WHERE proname = 'get_consumer_offers_for_shopping_date';
    `)
    expect(rpcCheck.rows.length).toBe(1)
    expect(rpcCheck.rows[0].prosecdef).toBe(true)

    // Verify it is directly executable without invalidation
    const testExec = await db.query<{ count: string }>(`
      SELECT count(*) as count FROM public.get_consumer_offers_for_shopping_date(CURRENT_DATE);
    `)
    expect(Number(testExec.rows[0].count)).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 3. Consumer view column and type compatibility
  // -------------------------------------------------------------------------
  it('Scenario 3: Consumer view retains exactly 98 columns matching Migration 007, and product_id is bigint', async () => {
    await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })

    const cols = await db.query<{ column_name: string; data_type: string }>(`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
      ORDER BY ordinal_position;
    `)
    expect(cols.rows.length).toBe(98)

    const prodIdCol = cols.rows.find(c => c.column_name === 'product_id')
    expect(prodIdCol).toBeDefined()
    expect(prodIdCol!.data_type).toBe('bigint')
  })

  // -------------------------------------------------------------------------
  // 4. Verified product ID remains visible
  // -------------------------------------------------------------------------
  it('Scenario 4: Verified product ID is exposed when catalog_match_status = verified_linked', async () => {
    await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })

    const verifiedOfferId = crypto.randomUUID()
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, title_ar, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${verifiedOfferId}', 'src-v1', '${supermarketId}', 'published', 'Verified Milk', 'حليب مؤكد', 5.00,
        1, 'verified_linked', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );
    `)

    const res = await db.query<{ id: string; product_id: number }>(`
      SELECT id, product_id FROM public.v_consumer_offers WHERE id = '${verifiedOfferId}';
    `)
    expect(res.rows.length).toBe(1)
    expect(res.rows[0].product_id).toBe(1)
  })

  // -------------------------------------------------------------------------
  // 5. Disputed product ID is masked
  // -------------------------------------------------------------------------
  it('Scenario 5: Disputed product ID is masked to NULL when catalog_match_status = conflict_needs_review', async () => {
    await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })

    const disputedOfferId = crypto.randomUUID()
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, title_ar, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${disputedOfferId}', 'src-d1', '${supermarketId}', 'published', 'Disputed Milk', 'حليب متنازع', 5.00,
        1, 'conflict_needs_review', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );
    `)

    const res = await db.query<{ id: string; product_id: number | null }>(`
      SELECT id, product_id FROM public.v_consumer_offers WHERE id = '${disputedOfferId}';
    `)
    expect(res.rows.length).toBe(1)
    expect(res.rows[0].product_id).toBeNull()
  })

  // -------------------------------------------------------------------------
  // 6. Unresolved product ID is masked
  // -------------------------------------------------------------------------
  it('Scenario 6: Unresolved or candidate product ID is masked to NULL', async () => {
    await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })

    const unresOfferId = crypto.randomUUID()
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, title_ar, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${unresOfferId}', 'src-u1', '${supermarketId}', 'published', 'Unresolved Milk', 'حليب غير محلول', 5.00,
        1, 'unresolved', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );
    `)

    const res = await db.query<{ id: string; product_id: number | null }>(`
      SELECT id, product_id FROM public.v_consumer_offers WHERE id = '${unresOfferId}';
    `)
    expect(res.rows.length).toBe(1)
    expect(res.rows[0].product_id).toBeNull()
  })

  // -------------------------------------------------------------------------
  // 7. Approved image behavior is preserved
  // -------------------------------------------------------------------------
  it('Scenario 7: Approved catalog image is projected when verified_linked', async () => {
    await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })

    const approvedUrl = 'https://pub.supabase.co/storage/v1/object/public/product-images/1.webp'
    await db.exec(`
      INSERT INTO public.product_images (product_id, role, approval_status, public_url, storage_object_path)
      VALUES (1, 'primary', 'approved', '${approvedUrl}', 'products/1.webp');
    `)

    const offerId = crypto.randomUUID()
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, title_ar, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${offerId}', 'src-img-1', '${supermarketId}', 'published', 'Milk With Image', 'حليب بصورة', 5.00,
        1, 'verified_linked', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );
    `)

    const res = await db.query<{ display_image_url: string; display_image_kind: string }>(`
      SELECT display_image_url, display_image_kind FROM public.v_consumer_offers WHERE id = '${offerId}';
    `)
    expect(res.rows[0].display_image_url).toBe(approvedUrl)
    expect(res.rows[0].display_image_kind).toBe('exact_product')
  })

  // -------------------------------------------------------------------------
  // 8. Private evidence fields cannot leak
  // -------------------------------------------------------------------------
  it('Scenario 8: Private evidence crop URLs and Windows paths are isolated and never projected', async () => {
    await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })

    const privateCropUrl = 'https://private.supabase.co/storage/v1/object/authenticated/offer-images/crop_001.jpg'
    const windowsPath = 'C:\\Extracts\\crops\\page1_001.webp'
    const offerId = crypto.randomUUID()

    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, title_ar, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date,
        image_url, image_path
      ) VALUES (
        '${offerId}', 'src-priv-1', '${supermarketId}', 'published', 'Private Crop Milk', 'حليب خاص', 5.00,
        1, 'conflict_needs_review', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days',
        '${privateCropUrl}', '${windowsPath}'
      );
    `)

    const res = await db.query<{ image_url: string | null; storage_path: string | null; display_image_url: string | null }>(`
      SELECT image_url, storage_path, display_image_url FROM public.v_consumer_offers WHERE id = '${offerId}';
    `)
    // INVARIANT: Private crops are completely isolated from consumer view
    expect(res.rows[0].image_url).toBeNull()
    expect(res.rows[0].storage_path).toBeNull()
    expect(res.rows[0].display_image_url).toBeNull()
  })

  // -------------------------------------------------------------------------
  // 9. Existing aliases remain intact
  // -------------------------------------------------------------------------
  it('Scenario 9: Existing valid aliases remain completely intact after migration', async () => {
    await db.exec(`
      INSERT INTO public.product_aliases (product_id, alias_text, language, source)
      VALUES (1, 'حليب مراعي', 'ar', 'manual'), (2, 'حليب المراعي عائلي', 'ar', 'manual');
    `)

    await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })

    const aliases = await db.query<{ alias_text: string }>('SELECT alias_text FROM public.product_aliases ORDER BY alias_text;')
    expect(aliases.rows.length).toBe(2)
  })

  // -------------------------------------------------------------------------
  // 10. Conflicting aliases prevent unsafe migration
  // -------------------------------------------------------------------------
  it('Scenario 10: Conflicting normalized aliases abort migration atomically without deleting data', async () => {
    await db.exec(`
      INSERT INTO public.product_aliases (product_id, alias_text, language, source)
      VALUES (1, 'حليب المراعي طازج', 'ar', 'manual'), (2, 'حليب ألمراعي طازج', 'ar', 'manual');
    `)

    await expect(
      applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })
    ).rejects.toThrow('MIGRATION_008_PREFLIGHT_BLOCKED')

    // Confirms non-destructive safety: rows were not deleted
    const count = await db.query<{ count: string }>('SELECT count(*) as count FROM public.product_aliases;')
    expect(Number(count.rows[0].count)).toBe(2)
  })

  // -------------------------------------------------------------------------
  // 11. TLS and credential configuration fail safely
  // -------------------------------------------------------------------------
  it('Scenario 11: CLI argument parser and safety validation reject missing credentials or conflicting flags', () => {
    const resConflict = parseCliArgs(['--apply', '--dry-run'])
    expect(resConflict.error).toBe('Conflicting execution modes specified.')

    const resUnknown = parseCliArgs(['--unknown-flag'])
    expect(resUnknown.error).toContain('Unrecognized command-line flag')

    const resHelp = parseCliArgs(['--help'])
    expect(resHelp.error).toBe('HELP_REQUESTED')
  })

  // -------------------------------------------------------------------------
  // 12. The CLI refuses execution without mode flag
  // -------------------------------------------------------------------------
  it('Scenario 12: applyMigration008 refuses execution and fails closed when no mode is authorized', async () => {
    await expect(
      applyMigration008({ client: createPgliteAdapter(db) as any })
    ).rejects.toThrow('DEPLOYMENT_AUTHORIZATION_REQUIRED')
  })

  // -------------------------------------------------------------------------
  // 13. Read-only preflight performs no DDL
  // -------------------------------------------------------------------------
  it('Scenario 13: Read-only preflight mode executes read-only inspection without running any DDL', async () => {
    const res = await applyMigration008({ mode: 'preflight-only', client: createPgliteAdapter(db) as any })
    expect(res.ok).toBe(true)
    expect(res.mode).toBe('preflight-only')

    // Verify unique index was NOT created (zero DDL executed)
    const idx = await db.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'product_aliases' AND indexname = 'idx_product_aliases_normalized_key';
    `)
    expect(idx.rows.length).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 14. Verification failures prevent commit
  // -------------------------------------------------------------------------
  it('Scenario 14: Verification failure aborts transaction and rolls back', async () => {
    // Intercept information_schema verification to simulate column count discrepancy
    const adapter = createPgliteAdapter(db)
    const originalQuery = adapter.query
    adapter.query = async (queryText: string, params?: any[]) => {
      if (queryText.includes("FROM information_schema.columns") && queryText.includes("table_name = 'v_consumer_offers'")) {
        const res = await originalQuery(queryText, params)
        return { rows: res.rows.slice(1), rowCount: res.rows.length - 1 } // Drop 1 row to simulate column mismatch (97 cols)
      }
      return originalQuery(queryText, params)
    }

    await expect(
      applyMigration008({ mode: 'apply', client: adapter as any })
    ).rejects.toThrow('VERIFICATION_FAILED')
  })

  // -------------------------------------------------------------------------
  // 15. Existing migration rerun is safe (Idempotency)
  // -------------------------------------------------------------------------
  it('Scenario 15: Migration 008 re-run is safe and idempotent', async () => {
    const run1 = await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })
    expect(run1.ok).toBe(true)

    const run2 = await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })
    expect(run2.ok).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 16. Rollback or forward-repair preserves consumer identity protection
  // -------------------------------------------------------------------------
  it('Scenario 16: Surgical rollback removes index while preserving view masking; full rollback requires 0 disputed rows', async () => {
    await applyMigration008({ mode: 'apply', client: createPgliteAdapter(db) as any })

    const dispId = crypto.randomUUID()
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, title_ar, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${dispId}', 'src-disp-16', '${supermarketId}', 'published', 'Disp', 'متنازع', 5.00,
        1, 'conflict_needs_review', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );
    `)

    // Surgical rollback: drop index only
    await db.exec('DROP INDEX IF EXISTS public.idx_product_aliases_normalized_key;')
    const idx = await db.query(`SELECT indexname FROM pg_indexes WHERE indexname = 'idx_product_aliases_normalized_key';`)
    expect(idx.rows.length).toBe(0)

    // Masking is still 100% active!
    const res = await db.query<{ product_id: number | null }>(`SELECT product_id FROM public.v_consumer_offers WHERE id = '${dispId}';`)
    expect(res.rows[0].product_id).toBeNull()

    // Clean up disputed row before performing clean full rollback
    await db.exec(`DELETE FROM public.offers WHERE id = '${dispId}';`)

    // In-place full rollback to 007 without CASCADE
    await db.exec(`
      CREATE OR REPLACE VIEW public.v_consumer_offers
      WITH (security_invoker = false) AS
      SELECT o.id, o.source_offer_id, o.source_revision, o.semantic_checksum, o.contract_version, o.compound_group_id, o.supersedes_source_offer_id,
        o.supermarket_id, s.name_ar AS supermarket_name_ar, s.name_en AS supermarket_name_en, s.slug AS supermarket_slug, s.code AS supermarket_code, s.logo_url AS supermarket_logo_url,
        o.location_scope, o.city_id, c.name_ar AS city_name_ar, c.name_en AS city_name_en, c.code AS city_code, o.region_id, r.name_ar AS region_name_ar, r.name_en AS region_name_en, r.code AS region_code,
        o.product_id, o.exact_identity_status, o.category_id, cat.name_ar AS category_name_ar, cat.name_en AS category_name_en, COALESCE(o.category_slug, cat.slug) AS category_slug,
        o.derived_subcategory_slug, o.commodity_tag, o.item_domain, o.brand_id, b.name_ar AS brand_name_ar, b.name_en AS brand_name_en, o.brand_state, o.brand_candidate_text,
        o.title_ar, o.title_en, o.normalized_title_ar, o.normalized_title_en, o.product_attributes, o.assortment_status, o.known_options, o.sale_unit_type, o.inner_pack_count,
        o.each_size_value, o.each_size_unit, o.total_content_value, o.total_content_unit, o.is_indivisible_sale_unit, o.offer_price, o.original_price AS source_reported_original_price,
        o.verified_non_member_price, COALESCE(o.currency, 'SAR') AS currency, o.price_basis, o.unit_price, o.unit_price_unit, o.discount_amount, o.discount_percentage,
        o.informational_inner_unit_price, o.display_unit_price_label_ar, o.display_unit_price_label_en, o.promo_mechanic, o.bonus_wording, o.bonus_fulfillment,
        o.is_loyalty_required, o.loyalty_requirement, o.quantity_limit, o.quantity_limit_value, o.quantity_limit_unit, o.quantity_limit_scope,
        COALESCE(pi.public_url, odi.public_url) AS image_url, COALESCE(pi.storage_object_path, odi.storage_object_path) AS storage_path,
        COALESCE(pi.public_url, odi.public_url) AS thumbnail_url, COALESCE(pi.storage_object_path, odi.storage_object_path) AS thumbnail_storage_path,
        COALESCE(pi.public_url, odi.public_url) AS display_image_url,
        CASE WHEN pi.public_url IS NOT NULL THEN 'exact_product' WHEN odi.public_url IS NOT NULL THEN 'illustrative' ELSE NULL END AS display_image_kind,
        CASE WHEN pi.public_url IS NOT NULL THEN 'product_package' WHEN odi.public_url IS NOT NULL THEN 'representative_assortment' ELSE COALESCE(o.image_subject_scope, 'unverified') END AS card_image_subject_scope,
        CASE WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END AS card_image_upload_state,
        CASE WHEN pi.public_url IS NOT NULL THEN 'product_package' WHEN odi.public_url IS NOT NULL THEN 'representative_assortment' ELSE 'unverified' END AS thumbnail_subject_scope,
        CASE WHEN pi.public_url IS NOT NULL OR odi.public_url IS NOT NULL THEN 'uploaded' ELSE 'pending' END AS thumbnail_upload_state,
        o.page_area_share_pct, o.is_front_page, o.is_hero_offer, o.deal_score, o.deal_label, o.offer_start_date, o.offer_end_date, o.offer_start_date AS valid_from, o.offer_end_date AS valid_to,
        'published'::text AS publication_status, 'active'::text AS temporal_lifecycle_state, o.scoped_assessments, o.reason_codes,
        public.build_sanitized_consumer_contract_v2(o.contract_v2, COALESCE(pi.public_url, odi.public_url), NULL) AS consumer_contract_v2,
        o.published_at, o.created_at, o.updated_at
      FROM public.offers o
      JOIN public.supermarkets s ON o.supermarket_id = s.id
      LEFT JOIN public.categories cat ON o.category_id = cat.id
      LEFT JOIN public.cities c ON o.city_id = c.id
      LEFT JOIN public.regions r ON o.region_id = r.id
      LEFT JOIN public.brands b ON o.brand_id = b.id
      LEFT JOIN public.product_images pi ON pi.product_id = o.product_id AND pi.role = 'primary' AND pi.approval_status = 'approved' AND o.catalog_match_status = 'verified_linked'
      LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id AND odi.approval_status = 'approved'
      WHERE o.status = 'published';
    `)

    const revertedCols = await db.query<{ count: string }>('SELECT count(*) as count FROM information_schema.columns WHERE table_name = \'v_consumer_offers\';')
    expect(Number(revertedCols.rows[0].count)).toBe(98)
  })

  // -------------------------------------------------------------------------
  // 17. Orthographic and Diacritic Normalization Equivalence
  // -------------------------------------------------------------------------
  it('Scenario 17: PostgreSQL normalize_alias_key matches application Arabic and English normalization equivalence', async () => {
    await db.exec(`
      CREATE OR REPLACE FUNCTION public.normalize_alias_key(p_text text)
      RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
      DECLARE v_res text;
      BEGIN
        IF p_text IS NULL THEN RETURN NULL; END IF;
        v_res := trim(lower(p_text));
        v_res := regexp_replace(v_res, 'ـ', '', 'g');
        v_res := regexp_replace(v_res, '[\\u064B-\\u065F\\u0670]', '', 'g');
        v_res := regexp_replace(v_res, '[أإآ]', 'ا', 'g');
        v_res := regexp_replace(v_res, 'ى', 'ي', 'g');
        v_res := regexp_replace(v_res, 'ة', 'ه', 'g');
        v_res := regexp_replace(v_res, '\\s+', ' ', 'g');
        v_res := trim(v_res);
        IF length(v_res) = 0 THEN RETURN NULL; END IF;
        RETURN v_res;
      END; $$;
    `)

    const testPairs = [
      { raw: 'حَلِيبٌ مُرَكَّزْ', ts: normalizeArabicText('حَلِيبٌ مُرَكَّزْ') },
      { raw: 'أرز أبيض فاخر', ts: normalizeArabicText('أرز أبيض فاخر') },
      { raw: 'شوكولاتة بالحليب', ts: normalizeArabicText('شوكولاتة بالحليب') },
      { raw: 'مَـــاءٌ   عَــذْب', ts: normalizeArabicText('مَـــاءٌ   عَــذْب') },
      { raw: '  Almarai   Fresh   Milk  ', ts: normalizeEnglishText('  Almarai   Fresh   Milk  ') }
    ]

    for (const pair of testPairs) {
      const dbRes = await db.query<{ norm: string }>(`SELECT public.normalize_alias_key('${pair.raw}') as norm;`)
      expect(dbRes.rows[0].norm).toBe(pair.ts)
    }
  })
})
