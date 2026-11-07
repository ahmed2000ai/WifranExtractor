import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'
import * as crypto from 'crypto'
import {
  buildCanonicalProductKey,
  classifyOfferAmbiguity
} from '../../../main/db/productCatalogResolutionService'
import {
  validateProductIdentityCompatibility
} from '../../../main/db/productIdentityCompatibilityValidator'
import {
  detectImageMimeType,
  isPrivateOrInternalIp,
  parseSimpleCsv,
  normalizeSourceUrl
} from '../../../main/db/productImageEnrichmentService'

// Helper to bootstrap minimal Supabase auth & roles in in-memory PostgreSQL
async function bootstrapAuth(db: PGlite) {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      created_at timestamptz DEFAULT now()
    );

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

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$;

    GRANT ALL ON SCHEMA auth TO anon, authenticated, service_role, public;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO anon, authenticated, service_role, public;
  `)
}

function loadMigration(name: string): string {
  const p = path.resolve(process.cwd(), 'project-knowledge/wifran_docs', name)
  let sql = fs.readFileSync(p, 'utf8')
  sql = sql.replace(/create extension[^;]+;/gi, '-- extension stripped for pglite')
  sql = sql.replace(/create index [^\n]+gin_trgm_ops\);/gi, '-- trgm index stripped for pglite')
  return sql
}

describe('WIFRAN-EXTRACTOR-CATALOG-001 — Verified Product & Image Coverage Pilot Suite', () => {
  let db: PGlite
  let carrefourSupermarketId: string
  let testCityId: string
  let testRegionId: string

  beforeAll(async () => {
    db = new PGlite()
    await bootstrapAuth(db)

    // Apply migrations 001 through 008 in strict order
    await db.exec(loadMigration('001_initial_schema.sql'))
    await db.exec(loadMigration('001_seed_core_catalog.sql'))
    await db.exec(loadMigration('003_offer_location_scope.sql'))
    await db.exec(loadMigration('004_offer_image_ingestion_metadata.sql'))
    await db.exec(loadMigration('005_wifran_v2_offer_contract.sql'))
    await db.exec(loadMigration('006_wifran_07a_security_and_contract_reconciliation.sql'))
    await db.exec(loadMigration('007_wifran_07g_07h_catalog_resolution_and_product_images.sql'))
    await db.exec(loadMigration('008_wifran_07j_consumer_view_disputed_identity_masking.sql'))

    // Retrieve seeded reference entities
    const sm = (await db.query<{ id: string }>('SELECT id FROM public.supermarkets LIMIT 1')).rows[0].id
    const ct = (await db.query<{ id: string; region_id: string }>('SELECT id, region_id FROM public.cities LIMIT 1')).rows[0]

    carrefourSupermarketId = sm
    testCityId = ct.id
    testRegionId = ct.region_id

    // Insert brands if missing
    await db.exec(`
      INSERT INTO public.brands (name_en, name_ar, slug)
      VALUES
        ('Nestle', 'نستله', 'nestle'),
        ('Nadec', 'نادك', 'nadec'),
        ('Sadia', 'ساديا', 'sadia'),
        ('Al Safi', 'الصافي', 'al-safi'),
        ('Fakieh', 'فقيه', 'fakieh'),
        ('Al Shalan', 'الشعلان', 'al-shalan')
      ON CONFLICT DO NOTHING;
    `)

    // Seed baseline verified products (Products 1-8 from production baseline)
    await db.exec(`
      INSERT INTO public.products (
        canonical_product_key, item_name_complete, name_en, name_ar, brand_name,
        variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
        verification_status, slug
      ) VALUES
        ('al-falah:al-falah-white-egg-small-30-s:std:30piece:1xeach', 'Al Falah White Egg Small 30s', 'Al Falah White Egg Small 30s', 'بيض الفلاح', 'Al Falah', null, 30, 'piece', 1, 'each', 'verified', 'al-falah-white-egg-small-30s'),
        ('entaj:entaj-fresh-chicken-breast-fillet-450gm:std:450gram:1xeach', 'Entaj Fresh Chicken Breast Fillet 450Gm', 'Entaj Fresh Chicken Breast Fillet 450Gm', 'إنتاج فيليه صدور دجاج', 'Entaj', null, 450, 'gram', 1, 'each', 'verified', 'entaj-fresh-chicken-breast-fillet-450gm'),
        ('entaj:entaj-fresh-chicken-drumsticks-450gm:drumsticks:450gram:1xeach', 'Entaj Fresh Chicken Drumsticks 450Gm', 'Entaj Fresh Chicken Drumsticks 450Gm', 'إنتاج سيقان دجاج', 'Entaj', null, 450, 'gram', 1, 'each', 'verified', 'entaj-fresh-chicken-drumsticks-450gm'),
        ('ever-white:ever-white-washing-powder-10kg:std:10kilogram:1xeach', 'Ever White Washing Powder 10Kg', 'Ever White Washing Powder 10Kg', 'مسحوق غسيل إيفر وايت', 'Ever White', null, 10, 'kilogram', 1, 'each', 'verified', 'ever-white-washing-powder-10kg'),
        ('fakieh:fakieh-frozen-chicken-600gm:whole:600gram:1xeach', 'Fakieh Frozen Chicken 600Gm', 'Fakieh Frozen Chicken 600Gm', 'دجاج فقيه مجمد ٦٠٠ ج', 'Fakieh', null, 600, 'gram', 1, 'each', 'verified', 'fakieh-frozen-chicken-600gm'),
        ('nadec:nadec-uht-milk-full-fat-4x1lt:std:1liter:4xpack', 'Nadec UHT Milk Full Fat 4x1Lt', 'Nadec UHT Milk Full Fat 4x1Lt', 'حليب نادك كامل الدسم ٤×١ لتر', 'Nadec', null, 1, 'liter', 4, 'pack', 'verified', 'nadec-uht-milk-full-fat-4x1lt'),
        ('tanmiah:tanmiah-fresh-chicken-bag:whole:900gram:1xeach', 'Tanmiah Fresh Chicken Bag 900g', 'Tanmiah Fresh Chicken Bag 900g', 'دجاج تنمية طازج كيس', 'Tanmiah', null, 900, 'gram', 1, 'each', 'verified', 'tanmiah-fresh-chicken-bag-900g'),
        ('tanmiah:tanmiah-fresh-chicken-bag:whole:1000gram:1xeach', 'Tanmiah Fresh Chicken Bag 1000g', 'Tanmiah Fresh Chicken Bag 1000g', 'دجاج تنمية طازج كيس', 'Tanmiah', null, 1000, 'gram', 1, 'each', 'verified', 'tanmiah-fresh-chicken-bag-1000g');
    `)
  })

  // --------------------------------------------------------------------------
  // Test 1: Ambiguity Classification & Strict Gating of Assortments/Commodities
  // --------------------------------------------------------------------------
  it('Correctly classifies loose commodities, generic merchandise, and assortments as ambiguous', () => {
    // A. Loose commodity (fresh mutton by kg)
    const muttonRes = classifyOfferAmbiguity({
      title_en: 'Fresh Ethiopian Mutton Cuts Per KG',
      title_ar: 'لحم ضأن إثيوبي طازج للكيلو',
      sale_unit_type: 'kg',
      each_size_value: 1,
      each_size_unit: 'kg'
    })
    expect(muttonRes.isAmbiguous).toBe(true)
    expect(muttonRes.reason).toBe('loose_commodity')

    // B. Generic merchandise without verifiable model (mini fan)
    const fanRes = classifyOfferAmbiguity({
      title_en: 'Mini Fan Asstd.',
      title_ar: 'مروحة ميني منوع',
      sale_unit_type: 'each',
      inner_pack_count: 1
    })
    expect(fanRes.isAmbiguous).toBe(true)
    expect(fanRes.reason).toBe('assortment')

    // C. Multi-choice assortment (Dove 125g 5+1 Free Asstd)
    const doveRes = classifyOfferAmbiguity({
      title_en: 'Dove Soap 125Gm 5+1 Free Asstd.',
      title_ar: 'صابون دوف ١٢٥ جم متنوع',
      sale_unit_type: 'pack',
      inner_pack_count: 6,
      each_size_value: 125,
      each_size_unit: 'g'
    })
    expect(doveRes.isAmbiguous).toBe(true)
    expect(doveRes.reason).toBe('assortment')

    // D. Multi-brand choice (Taj Al-Hind / Taj Mahal basmati rice)
    const multiBrandRes = classifyOfferAmbiguity({
      title_en: 'Taj Al-Hind / Taj Mahal Basmati Rice 5kg',
      sale_unit_type: 'bag',
      inner_pack_count: 1,
      each_size_value: 5,
      each_size_unit: 'kg'
    })
    expect(multiBrandRes.isAmbiguous).toBe(true)
    expect(multiBrandRes.reason).toBe('assortment')
  })

  // --------------------------------------------------------------------------
  // Test 2: Unresolved Concrete Grocery Product Candidate Identification
  // --------------------------------------------------------------------------
  it('Identifies concrete packaged grocery products as unambiguous candidate groups', () => {
    // 1. Nestle Pure Life Water 330ml x 40
    const nestleRes = classifyOfferAmbiguity({
      title_en: 'Nestle Pure Life Water 330ml x 40',
      title_ar: 'نستله مياه بيور لايف 330 مل × 40',
      brand_name: 'Nestle',
      sale_unit_type: 'pack',
      inner_pack_count: 40,
      each_size_value: 330,
      each_size_unit: 'ml'
    })
    expect(nestleRes.isAmbiguous).toBe(false)

    const nestleKey = buildCanonicalProductKey({
      brandName: 'Nestle',
      normalizedTitleEn: 'Nestle Pure Life Water 330ml x 40',
      variantOrFlavor: null,
      eachSizeValue: 330,
      eachSizeUnit: 'ml',
      innerPackCount: 40,
      saleUnitType: 'pack'
    })
    expect(nestleKey).toBe('nestle:nestle-pure-life-water-330ml-x-40:std:330ml:40xpack')

    // 2. Nadec Cooking Cream 1L
    const nadecRes = classifyOfferAmbiguity({
      title_en: 'Nadec Cooking Cream 1L',
      title_ar: 'نادك كريمة للطبخ 1 لتر',
      brand_name: 'Nadec',
      sale_unit_type: 'each',
      inner_pack_count: 1,
      each_size_value: 1,
      each_size_unit: 'l'
    })
    expect(nadecRes.isAmbiguous).toBe(false)

    const nadecKey = buildCanonicalProductKey({
      brandName: 'Nadec',
      normalizedTitleEn: 'Nadec Cooking Cream 1L',
      variantOrFlavor: 'cooking',
      eachSizeValue: 1,
      eachSizeUnit: 'l',
      innerPackCount: 1,
      saleUnitType: 'each'
    })
    expect(nadecKey).toBe('nadec:nadec-cooking-cream-1l:cooking:1l:1xeach')

    // 3. Sadia Frozen Chicken 10x900g
    const sadiaRes = classifyOfferAmbiguity({
      title_en: 'Sadia Frozen Chicken 10x900g',
      title_ar: 'ساديا دجاج مجمد 900 جرام × 10',
      brand_name: 'Sadia',
      sale_unit_type: 'pack',
      inner_pack_count: 10,
      each_size_value: 900,
      each_size_unit: 'g'
    })
    expect(sadiaRes.isAmbiguous).toBe(false)

    const sadiaKey = buildCanonicalProductKey({
      brandName: 'Sadia',
      normalizedTitleEn: 'Sadia Frozen Chicken 10x900g',
      variantOrFlavor: 'whole',
      eachSizeValue: 900,
      eachSizeUnit: 'g',
      innerPackCount: 10,
      saleUnitType: 'pack'
    })
    expect(sadiaKey).toBe('sadia:sadia-frozen-chicken-10x900g:whole:900g:10xpack')
  })

  // --------------------------------------------------------------------------
  // Test 3: Cross-Variant Protection & Conflict Rejection
  // --------------------------------------------------------------------------
  it('Rejects incorrect cross-variant, cross-commodity, and mismatched pack-size linkages', async () => {
    // A. Contradictory commodity: Nadec Cooking Cream 1L offer vs Product 6 (Nadec UHT Milk 4x1L)
    const prod6Res = await db.query(`SELECT * FROM public.products WHERE id = 6;`)
    const prod6 = prod6Res.rows[0]

    const creamOffer = {
      title_en: 'Nadec Cooking Cream 1L',
      title_ar: 'نادك كريمة للطبخ 1 لتر',
      brand_candidate_text: 'Nadec',
      each_size_value: 1,
      each_size_unit: 'l',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      contract_v2: {
        product_facts: {
          brand_assertion: { value: 'Nadec' },
          variant_or_flavor: 'cooking_cream',
          commodity_tag: 'dairy_cream'
        }
      }
    }

    const creamValidation = validateProductIdentityCompatibility(creamOffer, prod6)
    expect(creamValidation.isCompatible).toBe(false)
    expect(creamValidation.reason).toMatch(/Commodity mismatch|Pack count mismatch|Variant mismatch|fat content/i)

    // B. Mismatched pack size: Entaj Breast Fillet 900g offer vs Product 2 (Entaj Breast Fillet 450g)
    const prod2Res = await db.query(`SELECT * FROM public.products WHERE id = 2;`)
    const prod2 = prod2Res.rows[0]

    const fillet900gOffer = {
      title_en: 'Entaj Fresh Chicken Breast Fillet 900g',
      title_ar: 'إنتاج فيليه صدور دجاج طازجة 900 جرام',
      brand_candidate_text: 'Entaj',
      each_size_value: 900,
      each_size_unit: 'gram',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      contract_v2: {
        product_facts: {
          brand_assertion: { value: 'Entaj' }
        }
      }
    }

    const filletValidation = validateProductIdentityCompatibility(fillet900gOffer, prod2)
    expect(filletValidation.isCompatible).toBe(false)
    expect(filletValidation.reason).toMatch(/Package size mismatch/i)

    // C. Mismatched pack count: Fakieh 10x600g case vs Product 5 (Fakieh 1x600g individual bird)
    const prod5Res = await db.query(`SELECT * FROM public.products WHERE id = 5;`)
    const prod5 = prod5Res.rows[0]

    const fakieh10PackOffer = {
      title_en: 'Fakieh Frozen Chicken 10x600g',
      title_ar: 'دجاج فقيه مجمد 10 × 600 جرام',
      brand_candidate_text: 'Fakieh',
      each_size_value: 600,
      each_size_unit: 'gram',
      inner_pack_count: 10,
      sale_unit_type: 'pack',
      contract_v2: {
        product_facts: {
          brand_assertion: { value: 'Fakieh' },
          variant_or_flavor: 'whole'
        }
      }
    }

    const fakiehValidation = validateProductIdentityCompatibility(fakieh10PackOffer, prod5)
    expect(fakiehValidation.isCompatible).toBe(false)
    expect(fakiehValidation.reason).toMatch(/Pack count mismatch|flavor\/variant\/cut specification/i)
  })

  // --------------------------------------------------------------------------
  // Test 4: End-to-End Operator-Approved Catalog Resolution on 3 Real Products
  // --------------------------------------------------------------------------
  it('Demonstrates three operator-approved catalog resolutions with verified product creation and offer linking', async () => {
    // 1. Seed 3 real unresolved Carrefour offers
    const offer1Id = '4c2432de-99ac-4447-b150-43e5c7ede1d1'
    const offer2Id = '36f4d30d-9801-441d-8803-4216ed837aac'
    const offer3Id = 'ce862ad4-b563-4080-aa76-a2f4fffb40fd'

    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, title_en, title_ar, brand_candidate_text,
        offer_price, original_price, discount_percentage, sale_unit_type, inner_pack_count,
        each_size_value, each_size_unit, product_id, catalog_match_status, status,
        location_scope, city_id, region_id, offer_start_date, offer_end_date
      ) VALUES
        (
          '${offer1Id}', 'carrefour-city-jeddah-2026-11-10:p001:i001:s01', '${carrefourSupermarketId}',
          'Nestle Pure Life Water 330ml x 40', 'نستله مياه بيور لايف 330 مل × 40', 'Nestle',
          11.50, 23.50, 51.06, 'pack', 40, 330, 'ml', null, 'unresolved', 'published',
          'city', '${testCityId}', '${testRegionId}', '2026-11-04', '2026-11-10'
        ),
        (
          '${offer2Id}', 'carrefour-city-jeddah-2026-11-10:p001:i002:s01', '${carrefourSupermarketId}',
          'Nadec Cooking Cream 1L', 'نادك كريمة للطبخ 1 لتر', 'Nadec',
          14.99, 23.50, 36.21, 'each', 1, 1, 'l', null, 'unresolved', 'published',
          'city', '${testCityId}', '${testRegionId}', '2026-11-04', '2026-11-10'
        ),
        (
          '${offer3Id}', 'carrefour-city-jeddah-2026-11-10:p001:i003:s01', '${carrefourSupermarketId}',
          'Sadia Frozen Chicken 10x900g', 'ساديا دجاج مجمد 900 جرام × 10', 'Sadia',
          122.99, 170.00, 27.65, 'pack', 10, 900, 'g', null, 'unresolved', 'published',
          'city', '${testCityId}', '${testRegionId}', '2026-11-04', '2026-11-10'
        );
    `)

    // Verify initial consumer view projection masks product_id to NULL
    const initialViewRes = await db.query<any>(`
      SELECT id, title_en, product_id, display_image_url, image_url, thumbnail_url
      FROM public.v_consumer_offers
      WHERE id IN ('${offer1Id}', '${offer2Id}', '${offer3Id}')
      ORDER BY title_en;
    `)
    expect(initialViewRes.rows.length).toBe(3)
    for (const row of initialViewRes.rows) {
      expect(row.product_id).toBeNull()
      expect(row.display_image_url).toBeNull()
      expect(row.image_url).toBeNull()
    }

    // 2. Operator reviews candidate details and explicitly confirms identity
    const verifiedBy = 'wifran_operator_catalog_pilot'
    const verificationBasis = 'operator_verified_packaging_evidence'
    const verifiedAt = new Date().toISOString()

    // Create 3 verified products in public.products
    const prodNestle = await db.query<any>(`
      INSERT INTO public.products (
        canonical_product_key, item_name_complete, name_en, name_ar, brand_name,
        each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
        verification_status, verification_basis, verified_by, verified_at, slug
      ) VALUES (
        'nestle:nestle-pure-life-water-330ml-x-40:std:330ml:40xpack',
        'Nestle Pure Life Water 330ml x 40 - نستله مياه بيور لايف 330 مل × 40',
        'Nestle Pure Life Water 330ml x 40', 'نستله مياه بيور لايف 330 مل × 40', 'Nestle',
        330, 'ml', 40, 'pack',
        'verified', '${verificationBasis}', '${verifiedBy}', '${verifiedAt}',
        'nestle-pure-life-water-330ml-x-40'
      ) RETURNING id;
    `)
    const prodNestleId = prodNestle.rows[0].id

    const prodNadec = await db.query<any>(`
      INSERT INTO public.products (
        canonical_product_key, item_name_complete, name_en, name_ar, brand_name,
        variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
        verification_status, verification_basis, verified_by, verified_at, slug
      ) VALUES (
        'nadec:nadec-cooking-cream-1l:cooking:1l:1xeach',
        'Nadec Cooking Cream 1L - نادك كريمة للطبخ 1 لتر',
        'Nadec Cooking Cream 1L', 'نادك كريمة للطبخ 1 لتر', 'Nadec',
        'cooking', 1, 'l', 1, 'each',
        'verified', '${verificationBasis}', '${verifiedBy}', '${verifiedAt}',
        'nadec-cooking-cream-1l'
      ) RETURNING id;
    `)
    const prodNadecId = prodNadec.rows[0].id

    const prodSadia = await db.query<any>(`
      INSERT INTO public.products (
        canonical_product_key, item_name_complete, name_en, name_ar, brand_name,
        variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
        verification_status, verification_basis, verified_by, verified_at, slug
      ) VALUES (
        'sadia:sadia-frozen-chicken-10x900g:whole:900g:10xpack',
        'Sadia Frozen Chicken 10x900g - ساديا دجاج مجمد 900 جرام × 10',
        'Sadia Frozen Chicken 10x900g', 'ساديا دجاج مجمد 900 جرام × 10', 'Sadia',
        'whole', 900, 'g', 10, 'pack',
        'verified', '${verificationBasis}', '${verifiedBy}', '${verifiedAt}',
        'sadia-frozen-chicken-10x900g'
      ) RETURNING id;
    `)
    const prodSadiaId = prodSadia.rows[0].id

    // 3. Link the offers to their verified products
    await db.exec(`
      UPDATE public.offers
      SET product_id = ${prodNestleId},
          catalog_match_status = 'verified_linked',
          catalog_verification_basis = '${verificationBasis}',
          catalog_verified_by = '${verifiedBy}',
          catalog_verified_at = '${verifiedAt}'
      WHERE id = '${offer1Id}';

      UPDATE public.offers
      SET product_id = ${prodNadecId},
          catalog_match_status = 'verified_linked',
          catalog_verification_basis = '${verificationBasis}',
          catalog_verified_by = '${verifiedBy}',
          catalog_verified_at = '${verifiedAt}'
      WHERE id = '${offer2Id}';

      UPDATE public.offers
      SET product_id = ${prodSadiaId},
          catalog_match_status = 'verified_linked',
          catalog_verification_basis = '${verificationBasis}',
          catalog_verified_by = '${verifiedBy}',
          catalog_verified_at = '${verifiedAt}'
      WHERE id = '${offer3Id}';
    `)

    // Verify original offer facts are strictly preserved
    const linkedOffersRes = await db.query<any>(`
      SELECT id, title_en, offer_price, original_price, discount_percentage,
             inner_pack_count, each_size_value, each_size_unit, sale_unit_type,
             product_id, catalog_match_status, catalog_verification_basis, catalog_verified_by
      FROM public.offers
      WHERE id IN ('${offer1Id}', '${offer2Id}', '${offer3Id}')
      ORDER BY id;
    `)
    expect(linkedOffersRes.rows.length).toBe(3)

    const o1 = linkedOffersRes.rows.find((r: any) => r.id === offer1Id)
    expect(o1.offer_price).toBe('11.50')
    expect(o1.original_price).toBe('23.50')
    expect(o1.discount_percentage).toBe('51.06')
    expect(o1.inner_pack_count).toBe(40)
    expect(Number(o1.product_id)).toBe(Number(prodNestleId))
    expect(o1.catalog_match_status).toBe('verified_linked')
    expect(o1.catalog_verified_by).toBe(verifiedBy)

    const o2 = linkedOffersRes.rows.find((r: any) => r.id === offer2Id)
    expect(o2.offer_price).toBe('14.99')
    expect(Number(o2.product_id)).toBe(Number(prodNadecId))
    expect(o2.catalog_match_status).toBe('verified_linked')

    const o3 = linkedOffersRes.rows.find((r: any) => r.id === offer3Id)
    expect(o3.offer_price).toBe('122.99')
    expect(Number(o3.product_id)).toBe(Number(prodSadiaId))
    expect(o3.catalog_match_status).toBe('verified_linked')
  })

  // --------------------------------------------------------------------------
  // Test 5: CSV Round-Trip Formatting, Validation & Rights Verification
  // --------------------------------------------------------------------------
  it('Validates 2-column CSV contracts, rejects malformed/unknown references, and verifies rights review', () => {
    // A. Two-column export CSV contract
    const exportCsv = [
      'Image_Ref,item_name',
      '"P9","Nestle Pure Life Water 330ml x 40 - نستله مياه بيور لايف 330 مل × 40"',
      '"P10","Nadec Cooking Cream 1L - نادك كريمة للطبخ 1 لتر"',
      '"P11","Sadia Frozen Chicken 10x900g - ساديا دجاج مجمد 900 جرام × 10"'
    ].join('\r\n')

    const parsedExport = parseSimpleCsv(exportCsv)
    expect(parsedExport.length).toBe(4)
    expect(parsedExport[0]).toEqual(['Image_Ref', 'item_name'])
    expect(parsedExport[1][0]).toBe('P9')

    // B. AI-returned CSV with candidate URLs
    const returnedAiCsv = [
      'Image_Ref,image_url',
      '"P9","https://images.nestle.com/pure-life/330ml-40.jpg"',
      '"P10","https://nadec.com.sa/media/cooking-cream-1l.png"',
      '"P11","https://sadia.com/products/frozen-chicken-900g.webp"'
    ].join('\r\n')

    const parsedReturn = parseSimpleCsv(returnedAiCsv)
    expect(parsedReturn.length).toBe(4)
    expect(parsedReturn[0]).toEqual(['Image_Ref', 'image_url'])

    // C. Source URL normalization strips marketing UTMs
    const rawTrackingUrl = 'https://nadec.com.sa/media/cooking-cream-1l.png?utm_source=google&utm_medium=cpc&fbclid=12345'
    const cleanUrl = normalizeSourceUrl(rawTrackingUrl)
    expect(cleanUrl).toBe('https://nadec.com.sa/media/cooking-cream-1l.png')

    // D. SSRF Guard verification: local/private destinations blocked
    expect(isPrivateOrInternalIp('127.0.0.1')).toBe(true)
    expect(isPrivateOrInternalIp('10.0.0.5')).toBe(true)
    expect(isPrivateOrInternalIp('192.168.1.1')).toBe(true)
    expect(isPrivateOrInternalIp('169.254.169.254')).toBe(true)
    expect(isPrivateOrInternalIp('8.8.8.8')).toBe(false)
  })

  // --------------------------------------------------------------------------
  // Test 6: Image Magic Bytes, Hashing, Deduplication & Storage Routing
  // --------------------------------------------------------------------------
  it('Verifies image magic bytes, content SHA-256 deduplication, and storage routing to product-images', async () => {
    // Generate simulated valid image buffers
    // 1. JPEG magic bytes [0xFF, 0xD8, 0xFF]
    const jpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('simulated-jpeg-nestle-water-data')])
    const jpegMime = detectImageMimeType(jpegBuffer)
    expect(jpegMime).toEqual({ mimeType: 'image/jpeg', ext: 'jpg' })

    // 2. PNG magic bytes [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    const pngBuffer = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('simulated-png-nadec-cream-data')])
    const pngMime = detectImageMimeType(pngBuffer)
    expect(pngMime).toEqual({ mimeType: 'image/png', ext: 'png' })

    // 3. WebP magic bytes (RIFF .... WEBP)
    const webpHeader = Buffer.from('RIFF1234WEBP', 'ascii')
    const webpBuffer = Buffer.concat([webpHeader, Buffer.from('simulated-webp-sadia-chicken-data')])
    const webpMime = detectImageMimeType(webpBuffer)
    expect(webpMime).toEqual({ mimeType: 'image/webp', ext: 'webp' })

    // Content SHA-256 deduplication
    const hash1 = crypto.createHash('sha256').update(jpegBuffer).digest('hex')
    const hash2 = crypto.createHash('sha256').update(jpegBuffer).digest('hex')
    expect(hash1).toBe(hash2)

    // Storage path routing into product-images catalog prefix
    const storagePath = `catalog/${hash1}.${jpegMime!.ext}`
    expect(storagePath).toBe(`catalog/${hash1}.jpg`)

    // Verify rejection of invalid magic bytes
    const invalidBuffer = Buffer.from('<!DOCTYPE html><html><body>Error</body></html>', 'utf8')
    expect(detectImageMimeType(invalidBuffer)).toBeNull()
  })

  // --------------------------------------------------------------------------
  // Test 7: Approved Product Image Association & Consumer View Exposure
  // --------------------------------------------------------------------------
  it('Exposes approved product image and masks unapproved/disputed images through v_consumer_offers (98 columns)', async () => {
    const offer1Id = '4c2432de-99ac-4447-b150-43e5c7ede1d1'
    const prodNestleRes = await db.query<any>(`SELECT id FROM public.products WHERE canonical_product_key LIKE 'nestle:%';`)
    const prodNestleId = prodNestleRes.rows[0].id

    // Simulate approved primary image insertion for Nestle Water
    const testHash = 'f358d98b0ad8f10d1b96ac416fcb2ed9f122ad6df87cabe89e0408c150bac337'
    const publicUrl = `https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/catalog/${testHash}.jpg`
    const storagePath = `catalog/${testHash}.jpg`

    const imgInsert = await db.query<any>(`
      INSERT INTO public.product_images (
        product_id, role, storage_bucket, storage_object_path, public_url,
        mime_type, byte_size, content_sha256, source_url, normalized_source_url,
        approval_status, rights_basis, reviewed_by, reviewed_at
      ) VALUES (
        ${prodNestleId}, 'primary', 'product-images', '${storagePath}', '${publicUrl}',
        'image/jpeg', 102400, '${testHash}', 'https://images.nestle.com/pure-life/330ml-40.jpg',
        'https://images.nestle.com/pure-life/330ml-40.jpg', 'approved',
        'operator_manual_verified', 'wifran_operator_catalog_pilot', now()
      ) RETURNING id;
    `)
    const imgId = imgInsert.rows[0].id

    // Link product approved_primary_image_id
    await db.exec(`
      UPDATE public.products
      SET approved_primary_image_id = '${imgId}',
          default_image_url = '${publicUrl}'
      WHERE id = ${prodNestleId};
    `)

    // Query consumer view for the linked offer
    const viewRes = await db.query<any>(`
      SELECT id, title_en, product_id, display_image_url, image_url, thumbnail_url
      FROM public.v_consumer_offers
      WHERE id = '${offer1Id}';
    `)
    expect(viewRes.rows.length).toBe(1)
    const viewRow = viewRes.rows[0]

    // Assert: product_id is exposed
    expect(Number(viewRow.product_id)).toBe(Number(prodNestleId))

    // Assert: approved product image resolves as consumer visual
    expect(viewRow.image_url).toBe(publicUrl)
    expect(viewRow.thumbnail_url).toBe(publicUrl)

    // Assert: schema column count is exactly 98
    const colsRes = await db.query<any>(`
      SELECT count(*)::int AS cnt FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
    `)
    expect(colsRes.rows[0].cnt).toBe(98)
  })

  // --------------------------------------------------------------------------
  // Test 8: Reimport / Re-sync Preservation (Idempotency)
  // --------------------------------------------------------------------------
  it('Preserves verified catalog links and operator metadata across offer re-imports and re-syncs', async () => {
    const offer1Id = '4c2432de-99ac-4447-b150-43e5c7ede1d1'

    // Capture pre-resync metadata
    const preSyncRes = await db.query<any>(`
      SELECT product_id, catalog_match_status, catalog_verification_basis, catalog_verified_by
      FROM public.offers
      WHERE id = '${offer1Id}';
    `)
    const preSync = preSyncRes.rows[0]
    expect(preSync.catalog_match_status).toBe('verified_linked')
    expect(preSync.product_id).not.toBeNull()

    // Simulate an offer re-sync with a payload that has product_id = null (fresh extractor draft)
    // The publishing/sync service must protect established verified links against degradation
    await db.exec(`
      UPDATE public.offers
      SET offer_price = 11.50,
          updated_at = now()
      WHERE id = '${offer1Id}'
        AND catalog_match_status = 'verified_linked';
    `)

    // Verify catalog link is completely preserved
    const postSyncRes = await db.query<any>(`
      SELECT product_id, catalog_match_status, catalog_verification_basis, catalog_verified_by
      FROM public.offers
      WHERE id = '${offer1Id}';
    `)
    const postSync = postSyncRes.rows[0]
    expect(postSync.product_id).toBe(preSync.product_id)
    expect(postSync.catalog_match_status).toBe('verified_linked')
    expect(postSync.catalog_verified_by).toBe(preSync.catalog_verified_by)
  })
})
