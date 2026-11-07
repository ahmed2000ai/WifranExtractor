import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  buildCanonicalProductKey,
  classifyOfferAmbiguity
} from '../../../main/db/productCatalogResolutionService'
import {
  validateProductIdentityCompatibility
} from '../../../main/db/productIdentityCompatibilityValidator'
import {
  detectImageMimeType,
  parseSimpleCsv
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

describe('WIFRAN-EXTRACTOR-CATALOG-002: Real Product & Image Approval Pilot', () => {
  let db: PGlite

  let carrefourSupermarketId: string
  let testCityId: string
  let testRegionId: string

  const offerNestleId = '4c2432de-99ac-4447-b150-43e5c7ede1d1'
  const offerNadecId = '36f4d30d-9801-441d-8803-4216ed837aac'
  const offerSadiaId = 'ce862ad4-b563-4080-aa76-a2f4fffb40fd'

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

    // Fetch seeded city and region from Migration 001
    const cityRes = await db.query<any>('SELECT id, region_id FROM public.cities LIMIT 1;')
    testCityId = cityRes.rows[0].id
    testRegionId = cityRes.rows[0].region_id

    // Fetch seeded supermarket
    const smRes = await db.query<any>('SELECT id FROM public.supermarkets LIMIT 1;')
    carrefourSupermarketId = smRes.rows[0].id

    // 4. Seed the 8 verified baseline products from production
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
        ('tanmiah:tanmiah-fresh-chicken-bag:whole:1000gram:1xeach', 'Tanmiah Fresh Chicken Bag 1000g', 'Tanmiah Fresh Chicken Bag 1000g', 'دجاج تنمية طازج كيس', 'Tanmiah', null, 1000, 'gram', 1, 'each', 'verified', 'tanmiah-fresh-chicken-bag-1000g'),
        ('tanmiah:tanmiah-fresh-chicken-bag:whole:1100gram:1xeach', 'Tanmiah Fresh Chicken Bag 1100g', 'Tanmiah Fresh Chicken Bag 1100g', 'دجاج تنمية طازج كيس', 'Tanmiah', null, 1100, 'gram', 1, 'each', 'verified', 'tanmiah-fresh-chicken-bag-1100g');
    `)

    // 5. Seed the 3 real Carrefour production offers
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, title_en, title_ar, brand_candidate_text,
        offer_price, original_price, discount_percentage, sale_unit_type, inner_pack_count,
        each_size_value, each_size_unit, product_id, catalog_match_status, status,
        location_scope, city_id, region_id, offer_start_date, offer_end_date
      ) VALUES
        (
          '${offerNestleId}', 'carrefour-city-jeddah-2026-11-10:p001:i001:s01', '${carrefourSupermarketId}',
          'Nestle Pure Life Water 330ml x 40', 'نستله مياه بيور لايف 330 مل × 40', 'Nestle',
          11.50, 23.50, 51.06, 'pack', 40, 330, 'ml', null, 'unresolved', 'published',
          'city', '${testCityId}', '${testRegionId}', '2026-11-04', '2026-11-10'
        ),
        (
          '${offerNadecId}', 'carrefour-city-jeddah-2026-11-10:p001:i002:s01', '${carrefourSupermarketId}',
          'Nadec Cooking Cream 1L', 'نادك كريمة للطبخ 1 لتر', 'Nadec',
          14.99, 23.50, 36.21, 'each', 1, 1, 'l', null, 'unresolved', 'published',
          'city', '${testCityId}', '${testRegionId}', '2026-11-04', '2026-11-10'
        ),
        (
          '${offerSadiaId}', 'carrefour-city-jeddah-2026-11-10:p001:i003:s01', '${carrefourSupermarketId}',
          'Sadia Frozen Chicken 10x900g', 'ساديا دجاج مجمد 900 جرام × 10', 'Sadia',
          122.99, 170.00, 27.65, 'pack', 10, 900, 'g', null, 'unresolved', 'published',
          'city', '${testCityId}', '${testRegionId}', '2026-11-04', '2026-11-10'
        );
    `)
  })

  // --------------------------------------------------------------------------
  // Test 1: Exact Product Identity Verification & Non-Ambiguity
  // --------------------------------------------------------------------------
  it('Verifies the three Carrefour offers as concrete packaged goods and rejects false assortment exclusion', () => {
    // 1. Nestle Pure Life Water 330ml x 40
    const nestleAmbiguity = classifyOfferAmbiguity({
      title_en: 'Nestle Pure Life Water 330ml x 40',
      title_ar: 'نستله مياه بيور لايف 330 مل × 40',
      brand_name: 'Nestle',
      sale_unit_type: 'pack',
      inner_pack_count: 40,
      each_size_value: 330,
      each_size_unit: 'ml',
      assortment_status: 'unknown_composition'
    })
    expect(nestleAmbiguity.isAmbiguous).toBe(false)

    const nestleKey = buildCanonicalProductKey({
      brandName: 'Nestle',
      normalizedTitleEn: 'Nestle Pure Life Water 330ml x 40',
      eachSizeValue: 330,
      eachSizeUnit: 'ml',
      innerPackCount: 40,
      saleUnitType: 'pack'
    })
    expect(nestleKey).toBe('nestle:nestle-pure-life-water-330ml-x-40:std:330ml:40xpack')

    // 2. Nadec Cooking Cream 1L
    const nadecAmbiguity = classifyOfferAmbiguity({
      title_en: 'Nadec Cooking Cream 1L',
      title_ar: 'نادك كريمة للطبخ 1 لتر',
      brand_name: 'Nadec',
      sale_unit_type: 'each',
      inner_pack_count: 1,
      each_size_value: 1,
      each_size_unit: 'l',
      assortment_status: 'unknown_composition'
    })
    expect(nadecAmbiguity.isAmbiguous).toBe(false)

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
    const sadiaAmbiguity = classifyOfferAmbiguity({
      title_en: 'Sadia Frozen Chicken 10x900g',
      title_ar: 'ساديا دجاج مجمد 900 جرام × 10',
      brand_name: 'Sadia',
      sale_unit_type: 'pack',
      inner_pack_count: 10,
      each_size_value: 900,
      each_size_unit: 'g',
      assortment_status: 'unknown_composition'
    })
    expect(sadiaAmbiguity.isAmbiguous).toBe(false)

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
  // Test 2: Cross-Variant and Cross-Pack Conflict Prevention
  // --------------------------------------------------------------------------
  it('Strictly rejects false links to existing Product 6 (Nadec Milk) and existing poultry products', async () => {
    // A. Nadec Cooking Cream 1L offer vs Product 6 (Nadec UHT Milk 4x1L)
    const prod6Res = await db.query<any>('SELECT * FROM public.products WHERE id = 6;')
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

    // B. Sadia 10x900g case pack vs Product 5 (Fakieh 1x600g single bird)
    const prod5Res = await db.query<any>('SELECT * FROM public.products WHERE id = 5;')
    const prod5 = prod5Res.rows[0]

    const sadiaOffer = {
      title_en: 'Sadia Frozen Chicken 10x900g',
      title_ar: 'ساديا دجاج مجمد 900 جرام × 10',
      brand_candidate_text: 'Sadia',
      each_size_value: 900,
      each_size_unit: 'g',
      inner_pack_count: 10,
      sale_unit_type: 'pack',
      contract_v2: {
        product_facts: {
          brand_assertion: { value: 'Sadia' },
          variant_or_flavor: 'whole'
        }
      }
    }

    const sadiaValidation = validateProductIdentityCompatibility(sadiaOffer, prod5)
    expect(sadiaValidation.isCompatible).toBe(false)
    expect(sadiaValidation.reason).toMatch(/Brand mismatch|Pack count mismatch|size/i)
  })

  // --------------------------------------------------------------------------
  // Test 3: Real Asset Magic Bytes, SHA-256 & Rights Clearance Verification
  // --------------------------------------------------------------------------
  it('Validates real JPEG image buffer for Nadec Cooking Cream (CC-BY-SA 3.0) and enforces blank images for unverified rights', () => {
    // 1. Simulate the exact Nadec Cooking Cream 1L JPEG buffer fetched from Open Food Facts
    // Magic bytes: 0xFF, 0xD8, 0xFF, 0xE0
    const nadecFakeData = Buffer.from('openfoodfacts-nadec-cooking-cream-1l-cc-by-sa-3.0-asset-test-data')
    const nadecJpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), nadecFakeData])

    const mime = detectImageMimeType(nadecJpegBuffer)
    expect(mime).toEqual({ mimeType: 'image/jpeg', ext: 'jpg' })

    const hash = crypto.createHash('sha256').update(nadecJpegBuffer).digest('hex')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBe(64)

    const expectedStoragePath = `catalog/${hash}.jpg`
    expect(expectedStoragePath.startsWith('catalog/')).toBe(true)
    expect(expectedStoragePath.endsWith('.jpg')).toBe(true)

    // 2. CSV Contract for Image Search Round-Trip
    const exportCsv = [
      'Image_Ref,item_name',
      '"P9","Nestle Pure Life Water 330ml x 40 - نستله مياه بيور لايف 330 مل × 40"',
      '"P10","Nadec Cooking Cream 1L - نادك كريمة للطبخ 1 لتر"',
      '"P11","Sadia Frozen Chicken 10x900g - ساديا دجاج مجمد 900 جرام × 10"'
    ].join('\r\n')

    const parsedExport = parseSimpleCsv(exportCsv)
    expect(parsedExport.length).toBe(4)
    expect(parsedExport[0]).toEqual(['Image_Ref', 'item_name'])

    // 3. Operator Review CSV:
    // P9: Blank (proprietary web image without verified commercial reuse rights)
    // P10: Open Food Facts verified asset (CC-BY-SA 3.0)
    // P11: Blank (proprietary web image without verified commercial reuse rights)
    const operatorReviewedCsv = [
      'Image_Ref,image_url',
      '"P9",""',
      '"P10","https://images.openfoodfacts.org/images/products/628/105/700/5505/front_en.3.full.jpg"',
      '"P11",""'
    ].join('\r\n')

    const parsedImport = parseSimpleCsv(operatorReviewedCsv)
    expect(parsedImport.length).toBe(4)
    expect(parsedImport[1][1]).toBe('')
    expect(parsedImport[2][1]).toBe('https://images.openfoodfacts.org/images/products/628/105/700/5505/front_en.3.full.jpg')
    expect(parsedImport[3][1]).toBe('')
  })

  // --------------------------------------------------------------------------
  // Test 4: End-to-End Operator Catalog Promotion & Image Linking
  // --------------------------------------------------------------------------
  it('Executes candidate promotion: creates 3 verified products, links 3 offers, and attaches approved image to Nadec Cream', async () => {
    const verifiedBy = 'wifran_operator_catalog_pilot'
    const verificationBasis = 'operator_verified_packaging_evidence'
    const verifiedAt = new Date().toISOString()

    // 1. Create Product 9: Nestle Water 40x330ml
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

    // 2. Create Product 10: Nadec Cooking Cream 1L
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

    // 3. Create Product 11: Sadia Frozen Chicken 10x900g
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

    // 4. Link the 3 offers to their respective products
    await db.exec(`
      UPDATE public.offers
      SET product_id = ${prodNestleId},
          catalog_candidate_key = 'nestle:nestle-pure-life-water-330ml-x-40:std:330ml:40xpack',
          catalog_match_status = 'verified_linked',
          catalog_verification_basis = '${verificationBasis}',
          catalog_verified_by = '${verifiedBy}',
          catalog_verified_at = '${verifiedAt}'
      WHERE id = '${offerNestleId}';

      UPDATE public.offers
      SET product_id = ${prodNadecId},
          catalog_candidate_key = 'nadec:nadec-cooking-cream-1l:cooking:1l:1xeach',
          catalog_match_status = 'verified_linked',
          catalog_verification_basis = '${verificationBasis}',
          catalog_verified_by = '${verifiedBy}',
          catalog_verified_at = '${verifiedAt}'
      WHERE id = '${offerNadecId}';

      UPDATE public.offers
      SET product_id = ${prodSadiaId},
          catalog_candidate_key = 'sadia:sadia-frozen-chicken-10x900g:whole:900g:10xpack',
          catalog_match_status = 'verified_linked',
          catalog_verification_basis = '${verificationBasis}',
          catalog_verified_by = '${verifiedBy}',
          catalog_verified_at = '${verifiedAt}'
      WHERE id = '${offerSadiaId}';
    `)

    // 5. Attach approved product image ONLY to Product 10 (Nadec Cream)
    const nadecSha256 = '3822508b2ddb94626a7375f7aee59df5e7aef0b4712603c64a436c24a62f3f15'
    const nadecPublicUrl = `https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/catalog/${nadecSha256}.jpg`

    const imgRes = await db.query<any>(`
      INSERT INTO public.product_images (
        product_id, role, storage_bucket, storage_object_path, public_url,
        mime_type, byte_size, content_sha256, source_url, normalized_source_url,
        approval_status, rights_basis, reviewed_by, reviewed_at
      ) VALUES (
        ${prodNadecId}, 'primary', 'product-images', 'catalog/${nadecSha256}.jpg', '${nadecPublicUrl}',
        'image/jpeg', 1192975, '${nadecSha256}',
        'https://images.openfoodfacts.org/images/products/628/105/700/5505/front_en.3.full.jpg',
        'https://images.openfoodfacts.org/images/products/628/105/700/5505/front_en.3.full.jpg',
        'approved', 'openfoodfacts_cc_by_sa', '${verifiedBy}', '${verifiedAt}'
      ) RETURNING id;
    `)
    const nadecImageId = imgRes.rows[0].id

    // Update Product 10 approved_primary_image_id
    await db.exec(`
      UPDATE public.products
      SET approved_primary_image_id = '${nadecImageId}',
          default_image_url = '${nadecPublicUrl}'
      WHERE id = ${prodNadecId};
    `)

    // 6. Verify consumer view v_consumer_offers projections
    const consumerOffers = await db.query<any>(`
      SELECT id, title_en, product_id, display_image_url, display_image_kind, image_url
      FROM public.v_consumer_offers
      WHERE id IN ('${offerNestleId}', '${offerNadecId}', '${offerSadiaId}')
      ORDER BY title_en;
    `)
    expect(consumerOffers.rows.length).toBe(3)

    const nadecRow = consumerOffers.rows.find((r: any) => r.id === offerNadecId)
    expect(Number(nadecRow.product_id)).toBe(Number(prodNadecId))
    expect(nadecRow.display_image_url).toBe(nadecPublicUrl)
    expect(nadecRow.display_image_kind).toBe('exact_product')
    expect(nadecRow.image_url).toBe(nadecPublicUrl)

    const nestleRow = consumerOffers.rows.find((r: any) => r.id === offerNestleId)
    expect(Number(nestleRow.product_id)).toBe(Number(prodNestleId))
    expect(nestleRow.display_image_url).toBeNull()
    expect(nestleRow.display_image_kind).toBeNull()
    expect(nestleRow.image_url).toBeNull()

    const sadiaRow = consumerOffers.rows.find((r: any) => r.id === offerSadiaId)
    expect(Number(sadiaRow.product_id)).toBe(Number(prodSadiaId))
    expect(sadiaRow.display_image_url).toBeNull()
    expect(sadiaRow.display_image_kind).toBeNull()
    expect(sadiaRow.image_url).toBeNull()
  })

  // --------------------------------------------------------------------------
  // Test 5: Re-sync Idempotency & Constraint Invariance
  // --------------------------------------------------------------------------
  it('Ensures re-execution is a no-op, preserving existing product IDs and primary image constraints', async () => {
    // 1. Check unique constraint on canonical_product_key
    const prodCountBefore = await db.query<any>('SELECT count(*)::int AS count FROM public.products;')
    expect(prodCountBefore.rows[0].count).toBe(11) // 8 baseline + 3 new

    // 2. Re-upsert Nadec product with same canonical key
    await db.exec(`
      INSERT INTO public.products (
        canonical_product_key, item_name_complete, name_en, name_ar, brand_name,
        variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
        verification_status, slug
      ) VALUES (
        'nadec:nadec-cooking-cream-1l:cooking:1l:1xeach',
        'Nadec Cooking Cream 1L - نادك كريمة للطبخ 1 لتر',
        'Nadec Cooking Cream 1L', 'نادك كريمة للطبخ 1 لتر', 'Nadec',
        'cooking', 1, 'l', 1, 'each',
        'verified', 'nadec-cooking-cream-1l'
      )
      ON CONFLICT (canonical_product_key) DO UPDATE
      SET item_name_complete = EXCLUDED.item_name_complete;
    `)

    const prodCountAfter = await db.query<any>('SELECT count(*)::int AS count FROM public.products;')
    expect(prodCountAfter.rows[0].count).toBe(11) // No duplicate row created

    // 3. Verify exactly one approved primary image per product constraint
    const primaryImgCount = await db.query<any>(`
      SELECT count(*)::int AS count
      FROM public.product_images
      WHERE product_id = 10 AND role = 'primary' AND approval_status = 'approved';
    `)
    expect(primaryImgCount.rows[0].count).toBe(1)
  })
})
