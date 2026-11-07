import { describe, it, expect, beforeEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'

describe('WIFRAN-EXTRACTOR-IDENTITY-001I — Disputed Identity RPC & View Regression Suite', () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()

    // 1. Initialize complete schema & roles
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
        storage_path text,
        thumbnail_url text,
        thumbnail_storage_path text,
        image_subject_scope text,
        page_area_share_pct numeric,
        is_front_page boolean DEFAULT false,
        is_hero_offer boolean DEFAULT false,
        deal_score numeric DEFAULT 0.5,
        deal_label text,
        offer_start_date date,
        offer_end_date date,
        status text DEFAULT 'draft',
        scoped_assessments jsonb DEFAULT '[]'::jsonb,
        reason_codes text[] DEFAULT '{}'::text[],
        contract_v2 jsonb DEFAULT '{}'::jsonb,
        published_at timestamptz,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION public.build_sanitized_consumer_contract_v2(
        p_raw jsonb,
        p_image_url text,
        p_subject_scope text
      )
      RETURNS jsonb
      LANGUAGE sql
      IMMUTABLE
      AS $$
        SELECT COALESCE(p_raw, '{}'::jsonb);
      $$;
    `)

    // 2. Apply Migration 008 DDL
    const migration008Path = path.resolve(__dirname, '../../../../project-knowledge/wifran_docs/008_wifran_07j_consumer_view_disputed_identity_masking.sql')
    const migrationSql = fs.readFileSync(migration008Path, 'utf8')
    await db.exec(migrationSql)

    // 3. Seed baseline referenced records
    await db.exec(`
      INSERT INTO public.supermarkets (id, name_ar, name_en, slug)
      VALUES ('danube', 'الدانوب', 'Danube', 'danube');

      INSERT INTO public.regions (id, name_ar, name_en, code)
      VALUES ('central', 'المنطقة الوسطى', 'Central', 'CENTRAL');

      INSERT INTO public.cities (id, region_id, name_ar, name_en, code)
      VALUES ('riyadh', 'central', 'الرياض', 'Riyadh', 'RUH');

      INSERT INTO public.categories (id, name_ar, name_en, slug)
      VALUES ('00000000-0000-0000-0000-000000000001', 'الألبان', 'Dairy', 'dairy');

      INSERT INTO public.brands (id, name_ar, name_en)
      VALUES ('00000000-0000-0000-0000-000000000002', 'المراعي', 'Almarai');

      -- Insert 2 verified products
      INSERT INTO public.products (name_en, name_ar, slug, canonical_product_key)
      OVERRIDING SYSTEM VALUE
      VALUES 
        ('Almarai Fresh Milk 2L', 'حليب المراعي طازج 2 لتر', 'almarai-fresh-milk-2l', 'almarai:milk:2l'),
        ('Almarai Low Fat Milk 2L', 'حليب المراعي قليل الدسم 2 لتر', 'almarai-low-fat-milk-2l', 'almarai:lowfat-milk:2l');
    `)
  })

  it('Regression Invariant: Disputed offer with non-null internal product_id exposes NULL in v_consumer_offers, while verified_linked exposes correct product_id', async () => {
    // Insert Offer 1: Disputed with non-null internal product_id = 1
    // Insert Offer 2: Verified with non-null internal product_id = 2
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, product_id, catalog_match_status,
        exact_identity_status, title_ar, title_en, offer_price,
        offer_start_date, offer_end_date, status
      )
      VALUES 
        (
          '11111111-1111-1111-1111-111111111111',
          'DISPUTED-001',
          'danube',
          1,
          'conflict_needs_review',
          'disputed',
          'عرض حليب متنازع عليه',
          'Disputed Milk Offer',
          12.50,
          (CURRENT_DATE - INTERVAL '1 day')::date,
          (CURRENT_DATE + INTERVAL '5 days')::date,
          'published'
        ),
        (
          '22222222-2222-2222-2222-222222222222',
          'VERIFIED-002',
          'danube',
          2,
          'verified_linked',
          'verified',
          'عرض حليب معتمد وموثق',
          'Verified Milk Offer',
          11.00,
          (CURRENT_DATE - INTERVAL '1 day')::date,
          (CURRENT_DATE + INTERVAL '5 days')::date,
          'published'
        );
    `)

    // Verify 1: Internal offers table retains non-null product_id for both
    const internalOffers = await db.query<any>(`
      SELECT id, source_offer_id, product_id, catalog_match_status 
      FROM public.offers 
      ORDER BY source_offer_id;
    `)
    expect(internalOffers.rows.length).toBe(2)
    expect(internalOffers.rows[0].product_id).toBe(1)
    expect(internalOffers.rows[0].catalog_match_status).toBe('conflict_needs_review')
    expect(internalOffers.rows[1].product_id).toBe(2)
    expect(internalOffers.rows[1].catalog_match_status).toBe('verified_linked')

    // Verify 2: View v_consumer_offers strictly masks disputed product_id to NULL
    const viewOffers = await db.query<any>(`
      SELECT id, source_offer_id, product_id
      FROM public.v_consumer_offers
      ORDER BY source_offer_id;
    `)
    expect(viewOffers.rows.length).toBe(2)

    // Offer 1 (disputed): MUST BE NULL
    const disputedViewOffer = viewOffers.rows.find((r: any) => r.source_offer_id === 'DISPUTED-001') as any
    expect(disputedViewOffer).toBeDefined()
    expect(disputedViewOffer.product_id).toBeNull()

    // Offer 2 (verified_linked): MUST EXPOSE 2
    const verifiedViewOffer = viewOffers.rows.find((r: any) => r.source_offer_id === 'VERIFIED-002') as any
    expect(verifiedViewOffer).toBeDefined()
    expect(Number(verifiedViewOffer.product_id)).toBe(2)

    // Verify 3: Shopping-Date RPC get_consumer_offers_for_shopping_date strictly masks disputed product_id to NULL
    const rpcOffers = await db.query<any>(`
      SELECT id, source_offer_id, product_id
      FROM public.get_consumer_offers_for_shopping_date(CURRENT_DATE);
    `)
    expect(rpcOffers.rows.length).toBe(2)

    const disputedRpcOffer = rpcOffers.rows.find((r: any) => r.source_offer_id === 'DISPUTED-001') as any
    expect(disputedRpcOffer).toBeDefined()
    expect(disputedRpcOffer.product_id).toBeNull()

    const verifiedRpcOffer = rpcOffers.rows.find((r: any) => r.source_offer_id === 'VERIFIED-002') as any
    expect(verifiedRpcOffer).toBeDefined()
    expect(Number(verifiedRpcOffer.product_id)).toBe(2)

    // Verify 4: Anon role execution through RPC strictly observes identical masking
    await db.exec(`SET ROLE anon;`)
    const anonRpcOffers = await db.query<any>(`
      SELECT id, source_offer_id, product_id
      FROM public.get_consumer_offers_for_shopping_date(CURRENT_DATE);
    `)
    expect(anonRpcOffers.rows.length).toBe(2)

    const anonDisputed = anonRpcOffers.rows.find((r: any) => r.source_offer_id === 'DISPUTED-001') as any
    expect(anonDisputed.product_id).toBeNull()

    const anonVerified = anonRpcOffers.rows.find((r: any) => r.source_offer_id === 'VERIFIED-002') as any
    expect(Number(anonVerified.product_id)).toBe(2)

    // Verify 5: Anon role querying v_consumer_offers directly
    const anonViewOffers = await db.query<any>(`
      SELECT id, source_offer_id, product_id
      FROM public.v_consumer_offers;
    `)
    const anonDisputedView = anonViewOffers.rows.find((r: any) => r.source_offer_id === 'DISPUTED-001') as any
    expect(anonDisputedView.product_id).toBeNull()

    const anonVerifiedView = anonViewOffers.rows.find((r: any) => r.source_offer_id === 'VERIFIED-002') as any
    expect(Number(anonVerifiedView.product_id)).toBe(2)

    await db.exec(`RESET ROLE;`)
  })

  it('Regression Invariant: All non-verified statuses (unresolved, candidate, conflict) with non-null internal product_id are masked to NULL in view and RPC', async () => {
    // Insert 4 offers:
    // 1. conflict_needs_review with product_id = 1 -> NULL
    // 2. candidate_attached with product_id = 2 -> NULL
    // 3. unresolved with product_id = 1 -> NULL
    // 4. verified_linked with product_id = 2 -> 2
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, product_id, catalog_match_status,
        exact_identity_status, title_ar, title_en, offer_price,
        offer_start_date, offer_end_date, status
      )
      VALUES 
        (
          gen_random_uuid(), 'STATUS-CONFLICT', 'danube', 1, 'conflict_needs_review',
          'disputed', 'متنازع', 'Conflict', 10.00,
          (CURRENT_DATE - INTERVAL '1 day')::date, (CURRENT_DATE + INTERVAL '5 days')::date, 'published'
        ),
        (
          gen_random_uuid(), 'STATUS-CANDIDATE', 'danube', 2, 'candidate_attached',
          'candidate', 'مرشح', 'Candidate', 10.00,
          (CURRENT_DATE - INTERVAL '1 day')::date, (CURRENT_DATE + INTERVAL '5 days')::date, 'published'
        ),
        (
          gen_random_uuid(), 'STATUS-UNRESOLVED', 'danube', 1, 'unresolved',
          'unresolved', 'غير محلول', 'Unresolved', 10.00,
          (CURRENT_DATE - INTERVAL '1 day')::date, (CURRENT_DATE + INTERVAL '5 days')::date, 'published'
        ),
        (
          gen_random_uuid(), 'STATUS-VERIFIED', 'danube', 2, 'verified_linked',
          'verified', 'موثق', 'Verified', 10.00,
          (CURRENT_DATE - INTERVAL '1 day')::date, (CURRENT_DATE + INTERVAL '5 days')::date, 'published'
        );
    `)

    // Query through v_consumer_offers
    const viewRows = await db.query<any>(`
      SELECT source_offer_id, product_id 
      FROM public.v_consumer_offers
      ORDER BY source_offer_id;
    `)
    expect(viewRows.rows.length).toBe(4)

    const viewConflict = viewRows.rows.find((r: any) => r.source_offer_id === 'STATUS-CONFLICT') as any
    const viewCandidate = viewRows.rows.find((r: any) => r.source_offer_id === 'STATUS-CANDIDATE') as any
    const viewUnresolved = viewRows.rows.find((r: any) => r.source_offer_id === 'STATUS-UNRESOLVED') as any
    const viewVerified = viewRows.rows.find((r: any) => r.source_offer_id === 'STATUS-VERIFIED') as any

    expect(viewConflict.product_id).toBeNull()
    expect(viewCandidate.product_id).toBeNull()
    expect(viewUnresolved.product_id).toBeNull()
    expect(Number(viewVerified.product_id)).toBe(2)

    // Query through get_consumer_offers_for_shopping_date RPC
    const rpcRows = await db.query<any>(`
      SELECT source_offer_id, product_id 
      FROM public.get_consumer_offers_for_shopping_date(CURRENT_DATE)
      ORDER BY source_offer_id;
    `)
    expect(rpcRows.rows.length).toBe(4)

    const rpcConflict = rpcRows.rows.find((r: any) => r.source_offer_id === 'STATUS-CONFLICT') as any
    const rpcCandidate = rpcRows.rows.find((r: any) => r.source_offer_id === 'STATUS-CANDIDATE') as any
    const rpcUnresolved = rpcRows.rows.find((r: any) => r.source_offer_id === 'STATUS-UNRESOLVED') as any
    const rpcVerified = rpcRows.rows.find((r: any) => r.source_offer_id === 'STATUS-VERIFIED') as any

    expect(rpcConflict.product_id).toBeNull()
    expect(rpcCandidate.product_id).toBeNull()
    expect(rpcUnresolved.product_id).toBeNull()
    expect(Number(rpcVerified.product_id)).toBe(2)
  })
})
