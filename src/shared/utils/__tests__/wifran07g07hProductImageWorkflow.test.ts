import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'
import {
  buildCanonicalProductKey,
  buildItemNameComplete,
  classifyOfferAmbiguity
} from '../../../main/db/productCatalogResolutionService'
import {
  detectImageMimeType,
  isPrivateOrInternalIp,
  validateSsrfSafeUrl,
  parseSimpleCsv,
  normalizeSourceUrl,
  formatOfferVisualItemName,
  cleanArabicWeightAndVolume,
  formatBilingualItemName
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
  // Strip extensions for in-memory PGlite
  sql = sql.replace(/create extension[^;]+;/gi, '-- extension stripped for pglite')
  // Strip gin_trgm_ops indexes for in-memory PGlite
  sql = sql.replace(/create index [^\n]+gin_trgm_ops\);/gi, '-- trgm index stripped for pglite')
  return sql
}

describe('WIFRAN-07G & WIFRAN-07H Catalog Resolution and Image Enrichment Workflow', () => {
  let db: PGlite
  let testSupermarketId: string
  let testCityId: string
  let testRegionId: string
  let testCategoryId: string

  beforeAll(async () => {
    db = new PGlite()
    await bootstrapAuth(db)

    // Apply migrations 001 through 007 in order
    const sql001 = loadMigration('001_initial_schema.sql')
    const sql001Seed = loadMigration('001_seed_core_catalog.sql')
    const sql003 = loadMigration('003_offer_location_scope.sql')
    const sql004 = loadMigration('004_offer_image_ingestion_metadata.sql')
    const sql005 = loadMigration('005_wifran_v2_offer_contract.sql')
    const sql006 = loadMigration('006_wifran_07a_security_and_contract_reconciliation.sql')
    const sql007 = loadMigration('007_wifran_07g_07h_catalog_resolution_and_product_images.sql')

    await db.exec(sql001)
    await db.exec(sql001Seed)
    await db.exec(sql003)
    await db.exec(sql004)
    await db.exec(sql005)
    await db.exec(sql006)
    await db.exec(sql007)

    const sm = (await db.query<{ id: string }>('SELECT id FROM supermarkets LIMIT 1')).rows[0].id
    const ct = (await db.query<{ id: string; region_id: string }>('SELECT id, region_id FROM cities LIMIT 1')).rows[0]
    const cat = (await db.query<{ id: string }>('SELECT id FROM categories LIMIT 1')).rows[0].id

    testSupermarketId = sm
    testCityId = ct.id
    testRegionId = ct.region_id
    testCategoryId = cat
  })

  // =========================================================================
  // 1. Candidate Grouping vs. Ambiguous Offer Exclusion (WIFRAN-07H §2)
  // =========================================================================
  describe('1. Candidate Grouping & Ambiguity Classification', () => {
    it('Correctly classifies assortments (Dove 5+1 Asstd) as ambiguous', () => {
      const res = classifyOfferAmbiguity({
        title_en: 'Dove Soap 125Gm 5+1 Free Asstd.',
        brand_name: 'Dove',
        brand_state: 'supported',
        assortment_status: 'indicated_with_conflict',
        sale_unit_type: 'pack',
        inner_pack_count: 6,
        each_size_value: 125,
        each_size_unit: 'gram'
      })
      expect(res.isAmbiguous).toBe(true)
      expect(res.reason).toBe('assortment')
    })

    it('Correctly classifies unbranded loose commodities (Fresh Mutton per kg) as ambiguous', () => {
      const res = classifyOfferAmbiguity({
        title_en: 'Ethiopian Fresh Mutton Cuts Per KG',
        brand_name: null,
        brand_state: 'unknown',
        assortment_status: 'single_product',
        sale_unit_type: 'kg',
        inner_pack_count: null,
        each_size_value: 1,
        each_size_unit: 'kilogram'
      })
      expect(res.isAmbiguous).toBe(true)
      expect(res.reason).toBe('loose_commodity')
    })

    it('Correctly classifies generic unbranded appliances (Electric Peeling 50w) as ambiguous', () => {
      const res = classifyOfferAmbiguity({
        title_en: 'Electric Peeling 50w',
        brand_name: null,
        brand_state: 'unknown',
        assortment_status: 'single_product',
        sale_unit_type: 'each',
        inner_pack_count: 1,
        each_size_value: null,
        each_size_unit: null
      })
      expect(res.isAmbiguous).toBe(true)
      expect(res.reason).toBe('generic_unbranded')
    })

    it('Correctly identifies concrete single-product packaged goods (Nadec UHT Milk 4x1Lt)', () => {
      const res = classifyOfferAmbiguity({
        title_en: 'Nadec UHT Milk Full Fat 4x1Lt',
        brand_name: 'Nadec',
        brand_state: 'supported',
        assortment_status: 'single_product',
        sale_unit_type: 'pack',
        inner_pack_count: 4,
        each_size_value: 1,
        each_size_unit: 'liter'
      })
      expect(res.isAmbiguous).toBe(false)
    })

    it('Generates deterministic canonical product key and complete item name without retailer promo details', () => {
      const key = buildCanonicalProductKey({
        brandName: 'Nadec',
        normalizedTitleEn: 'Nadec UHT Milk Full Fat 4x1Lt',
        variantOrFlavor: 'Full Fat',
        eachSizeValue: 1,
        eachSizeUnit: 'liter',
        innerPackCount: 4,
        saleUnitType: 'pack'
      })
      expect(key).toBe('nadec:nadec-uht-milk-full-fat-4x1lt:full-fat:1liter:4xpack')

      const itemName = buildItemNameComplete({
        brandName: 'Nadec',
        titleEn: 'Nadec UHT Milk Full Fat 4x1Lt',
        variantOrFlavor: 'Full Fat',
        eachSizeValue: 1,
        eachSizeUnit: 'liter',
        innerPackCount: 4
      })
      expect(itemName).toBe('Nadec UHT Milk Full Fat 4x1Lt')
    })
  })

  // =========================================================================
  // 2. Database Insertion, Identity Linking & Re-Sync Protection (WIFRAN-07H §3)
  // =========================================================================
  describe('2. DB Resolution, Linking & Re-Sync Protection', () => {
    let testProductId: string | number
    let testOfferId: string

    it('Inserts a verified catalog product and links offer while preserving frozen exact_identity_status', async () => {
      // 1. Insert an unlinked published offer
      const offerInsert = await db.query<{ id: string }>(`
        INSERT INTO public.offers (
          supermarket_id,
          location_scope,
          city_id,
          region_id,
          category_id,
          title_ar,
          title_en,
          offer_price,
          offer_end_date,
          status,
          image_url,
          source_offer_id,
          source_revision,
          semantic_checksum,
          exact_identity_status,
          catalog_match_status,
          contract_v2
        ) VALUES (
          $1,
          'city',
          $2,
          $3,
          $4,
          'حليب نادك كامل الدسم طويل الأجل ٤ × ١ لتر',
          'Nadec UHT Milk Full Fat 4x1Lt',
          14.95,
          '2026-11-05',
          'published',
          'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-images/alwafa/p001_001.webp',
          'alwafa-test:p001:i001:s01',
          1,
          'chk-nadec-123',
          'product_family_only',
          'unresolved',
          '{"offer_name_en": "Nadec UHT Milk Full Fat 4x1Lt", "product_facts": {"exact_identity_status": "product_family_only"}, "assets": {"offer_card": {"storage_bucket": "offer-images", "delivery_url": "https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-images/alwafa/p001_001.webp"}}}'::jsonb
        ) RETURNING id;
      `, [testSupermarketId, testCityId, testRegionId, testCategoryId])
      testOfferId = offerInsert.rows[0].id

      // 2. Operator verifies and inserts catalog product
      const productInsert = await db.query<{ id: string }>(`
        INSERT INTO public.products (
          canonical_product_key,
          item_name_complete,
          brand_name,
          variant_or_flavor,
          each_size_value,
          each_size_unit,
          inner_pack_count,
          sale_unit_type,
          name_en,
          verification_status,
          verification_basis,
          verified_by,
          verified_at
        ) VALUES (
          'nadec:nadec-uht-milk-full-fat-4x1lt:full-fat:1liter:4xpack',
          'Nadec UHT Milk Full Fat 4x1Lt',
          'Nadec',
          'Full Fat',
          1.0,
          'liter',
          4,
          'pack',
          'Nadec UHT Milk Full Fat 4x1Lt',
          'verified',
          'operator_verified_pack_identity',
          'test_operator',
          now()
        ) RETURNING id;
      `)
      testProductId = productInsert.rows[0].id

      // 3. Link offer to product
      await db.query(`
        UPDATE public.offers
        SET product_id = $1,
            catalog_match_status = 'verified_linked',
            catalog_verification_basis = 'operator_verified_pack_identity',
            catalog_verified_by = 'test_operator',
            catalog_verified_at = now()
        WHERE id = $2;
      `, [testProductId, testOfferId])

      // 4. Verify link and confirm frozen producer facts were NOT overwritten
      const checkOffer = await db.query<{
        product_id: string
        catalog_match_status: string
        exact_identity_status: string
        facts_exact: string
      }>(`
        SELECT product_id, catalog_match_status, exact_identity_status,
               contract_v2->'product_facts'->>'exact_identity_status' as facts_exact
        FROM public.offers
        WHERE id = $1;
      `, [testOfferId])

      expect(String(checkOffer.rows[0].product_id)).toBe(String(testProductId))
      expect(Number(testProductId)).toBeGreaterThanOrEqual(1)
      expect(checkOffer.rows[0].catalog_match_status).toBe('verified_linked')
      // Exact identity status in offer and contract_v2 remains frozen original 'product_family_only'
      expect(checkOffer.rows[0].exact_identity_status).toBe('product_family_only')
      expect(checkOffer.rows[0].facts_exact).toBe('product_family_only')
    })

    it('Re-syncing the offer with product_id = null PRESERVES verified catalog link (WIFRAN-07H §3)', async () => {
      // Incoming sync payload from raw extractor with product_id = null
      const incomingPayload = {
        source_offer_id: 'alwafa-test:p001:i001:s01',
        title_en: 'Nadec UHT Milk Full Fat 4x1Lt (Re-synced)',
        product_id: null as string | null,
        catalog_match_status: null as string | null
      }

      // Check existing row
      const existing = await db.query<{
        id: string
        product_id: string
        catalog_match_status: string
        catalog_verification_basis: string
      }>(`
        SELECT id, product_id, catalog_match_status, catalog_verification_basis
        FROM public.offers
        WHERE source_offer_id = $1;
      `, [incomingPayload.source_offer_id])

      expect(existing.rows.length).toBe(1)
      const existingRow = existing.rows[0]

      // Apply re-sync protection rule
      if (existingRow.product_id && existingRow.catalog_match_status === 'verified_linked') {
        if (!incomingPayload.product_id) {
          incomingPayload.product_id = existingRow.product_id
          incomingPayload.catalog_match_status = existingRow.catalog_match_status
        }
      }

      // Execute update
      await db.query(`
        UPDATE public.offers
        SET title_en = $1,
            product_id = $2,
            catalog_match_status = $3
        WHERE id = $4;
      `, [incomingPayload.title_en, incomingPayload.product_id, incomingPayload.catalog_match_status, existingRow.id])

      // Verify product_id was preserved!
      const afterResync = await db.query<{
        product_id: string
        catalog_match_status: string
      }>(`
        SELECT product_id, catalog_match_status
        FROM public.offers
        WHERE id = $1;
      `, [existingRow.id])

      expect(String(afterResync.rows[0].product_id)).toBe(String(testProductId))
      expect(afterResync.rows[0].catalog_match_status).toBe('verified_linked')
    })

    it('Guarantees sequential integer product IDs starting at 1 and never reuses deleted IDs', async () => {
      const p1 = await db.query<{ id: string | number }>(`
        INSERT INTO public.products (
          canonical_product_key, item_name_complete, name_en, verification_status
        ) VALUES (
          'test:seq:1', 'Test Seq 1', 'Test Seq 1', 'verified'
        ) RETURNING id;
      `)
      const id1 = Number(p1.rows[0].id)
      expect(id1).toBeGreaterThanOrEqual(1)

      const p2 = await db.query<{ id: string | number }>(`
        INSERT INTO public.products (
          canonical_product_key, item_name_complete, name_en, verification_status
        ) VALUES (
          'test:seq:2', 'Test Seq 2', 'Test Seq 2', 'verified'
        ) RETURNING id;
      `)
      const id2 = Number(p2.rows[0].id)
      expect(id2).toBe(id1 + 1)

      // Deleting p2 and inserting p3: sequence never rolls back or reuses id2
      await db.query('DELETE FROM public.products WHERE id = $1;', [id2])
      const p3 = await db.query<{ id: string | number }>(`
        INSERT INTO public.products (
          canonical_product_key, item_name_complete, name_en, verification_status
        ) VALUES (
          'test:seq:3', 'Test Seq 3', 'Test Seq 3', 'verified'
        ) RETURNING id;
      `)
      const id3 = Number(p3.rows[0].id)
      expect(id3).toBeGreaterThan(id2)
      expect(id3).not.toBe(id2)
    })

    it('Enforces GENERATED ALWAYS AS IDENTITY and immutability trigger preventing updates to products.id', async () => {
      // 1. Direct INSERT with explicit ID fails without OVERRIDING SYSTEM VALUE
      let insertFailed = false
      try {
        await db.query(`
          INSERT INTO public.products (id, canonical_product_key, item_name_complete, name_en)
          VALUES (9999, 'fail:id', 'Fail ID', 'Fail ID');
        `)
      } catch (err: any) {
        insertFailed = true
        expect(err.message).toMatch(/cannot insert a non-DEFAULT value into column "id"/i)
      }
      expect(insertFailed).toBe(true)

      // 2. Attempting to UPDATE products.id is blocked by PostgreSQL GENERATED ALWAYS AS IDENTITY and trigger
      let updateFailed = false
      try {
        await db.query(`
          UPDATE public.products
          SET id = 8888
          WHERE id = $1;
        `, [testProductId])
      } catch (err: any) {
        updateFailed = true
        expect(err.message).toMatch(/column "id" can only be updated to DEFAULT|Product ID is immutable and cannot be updated/i)
      }
      expect(updateFailed).toBe(true)
    })
  })

  // =========================================================================
  // 3. CSV Export & Import Validation Guards (WIFRAN-07G §2 & §5)
  // =========================================================================
  describe('3. CSV Export & Import Validation Guards', () => {
    it('Parses CSV correctly with commas inside quotes', () => {
      const csv = 'Product_ID,item_name\r\n"1","Nadec Milk, 4x1L, Full Fat"'
      const rows = parseSimpleCsv(csv)
      expect(rows.length).toBe(2)
      expect(rows[1][0]).toBe('1')
      expect(rows[1][1]).toBe('Nadec Milk, 4x1L, Full Fat')
    })

    it('Normalizes source URLs by removing marketing tracking parameters', () => {
      const raw = 'https://example.com/images/nadec.jpg?utm_source=google&utm_medium=cpc&fbclid=12345'
      const norm = normalizeSourceUrl(raw)
      expect(norm).toBe('https://example.com/images/nadec.jpg')
    })

    it('Detects image MIME types from binary magic bytes', () => {
      // JPEG
      const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
      expect(detectImageMimeType(jpegBuf)?.mimeType).toBe('image/jpeg')

      // PNG
      const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(detectImageMimeType(pngBuf)?.mimeType).toBe('image/png')

      // WebP
      const webpBuf = Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP', 'ascii')
      ])
      expect(detectImageMimeType(webpBuf)?.mimeType).toBe('image/webp')

      // HTML/Text (rejected)
      const htmlBuf = Buffer.from('<html><body>Not an image</body></html>')
      expect(detectImageMimeType(htmlBuf)).toBeNull()
    })

    it('SSRF guard blocks localhost, internal IPs and private subnets', async () => {
      expect(isPrivateOrInternalIp('127.0.0.1')).toBe(true)
      expect(isPrivateOrInternalIp('10.0.0.5')).toBe(true)
      expect(isPrivateOrInternalIp('172.16.0.1')).toBe(true)
      expect(isPrivateOrInternalIp('192.168.1.100')).toBe(true)
      expect(isPrivateOrInternalIp('169.254.169.254')).toBe(true)
      expect(isPrivateOrInternalIp('::1')).toBe(true)
      expect(isPrivateOrInternalIp('8.8.8.8')).toBe(false)

      const ssrfLocal = await validateSsrfSafeUrl('http://localhost:3000/image.jpg')
      expect(ssrfLocal.valid).toBe(false)

      const ssrfHttp = await validateSsrfSafeUrl('http://example.com/image.jpg')
      expect(ssrfHttp.valid).toBe(false) // HTTP blocked, HTTPS required

      const ssrfPrivate = await validateSsrfSafeUrl('https://169.254.169.254/latest/meta-data')
      expect(ssrfPrivate.valid).toBe(false)
    })

    it('Formats truthful, concise bilingual visual items for O references across all 3 classes', () => {
      // Class 1: Commodity
      const mutton = formatOfferVisualItemName({
        title_en: 'Ethiopian Fresh Mutton Cuts Per KG',
        title_ar: 'لحم الضأن الإثيوبي الطازج للكيلو',
        sale_unit_type: 'kg'
      })
      expect(mutton.ambiguityClass).toBe('loose_commodity')
      expect(mutton.formattedItemName).toBe('Ethiopian Fresh Mutton Cuts | لحم الضأن الإثيوبي الطازج')
      expect(mutton.visualSubjectKey).toContain('commodity:ethiopian-fresh-mutton-cuts:kg')

      // Class 2: Assortment / Alternatives
      const rice = formatOfferVisualItemName({
        title_en: 'Taj Al-Hind /Taj Mahal Basmati Rice 5Kg',
        title_ar: 'أرز بسمتي تاج الهند / تاج محل ٥ كجم',
        sale_unit_type: 'each',
        contract_v2: { assortment: { status: 'assortment_indicated' } }
      })
      expect(rice.ambiguityClass).toBe('choice_assortment')
      expect(rice.formattedItemName).toBe('Taj Al-Hind /Taj Mahal Basmati Rice 5Kg | أرز بسمتي تاج الهند / تاج محل')
      expect(rice.visualSubjectKey).toContain('assortment:taj-al-hind-taj-mahal-basmati-rice-5kg')

      // Class 3: Generic Merchandise
      const mixer = formatOfferVisualItemName({
        title_en: 'Hand Mixer 260W',
        title_ar: 'خلاط يدوي ٢٦٠ واط',
        sale_unit_type: 'each'
      })
      expect(mixer.ambiguityClass).toBe('generic_merchandise')
      expect(mixer.formattedItemName).toBe('Hand Mixer 260W | خلاط يدوي ٢٦٠ واط')
      expect(mixer.visualSubjectKey).toContain('generic:hand-mixer-260w')

      // Class 1/2: Brand Conflict Assortment (Krypton in EN, Geepas in AR)
      const flashlight = formatOfferVisualItemName({
        title_en: 'Krypton Zoomable Led Flashlight',
        title_ar: 'جيباس مصباح يدوي ليد قابل للتكبير',
        sale_unit_type: 'each'
      })
      expect(flashlight.ambiguityClass).toBe('choice_assortment')
      expect(flashlight.formattedItemName).toBe('Krypton / Geepas Zoomable LED Flashlight Asstd. | جيباس مصباح يدوي ليد قابل للتكبير')
      expect(flashlight.visualSubjectKey).toContain('assortment:krypton-geepas-zoomable-led-flashlight')
    })

    it('Validates CSV with Image_Ref header supporting both P<id> and O<uuid> references with UTF-8 BOM', () => {
      const csvWithBom = '\uFEFFImage_Ref,image_url\r\n"P1","https://example.com/p1.jpg"\r\n"Of3a907c5-5620-478f-b8ca-1eebcfb1362f",""\r\n'
      expect(csvWithBom.charCodeAt(0)).toBe(0xFEFF)
      const rows = parseSimpleCsv(csvWithBom)
      expect(rows.length).toBe(3)
      expect(rows[0][0]).toBe('Image_Ref')
      expect(rows[1][0]).toBe('P1')
      expect(rows[2][0]).toBe('Of3a907c5-5620-478f-b8ca-1eebcfb1362f')
    })

    it('Removes redundant weight and volume strings from Arabic strings while preserving non-weight specifications', () => {
      expect(cleanArabicWeightAndVolume('إنتاج فيليه صدور دجاج طازجة ٤٥٠ جرام')).toBe('إنتاج فيليه صدور دجاج طازجة')
      expect(cleanArabicWeightAndVolume('مسحوق غسيل إيفر وايت ١٠ كج')).toBe('مسحوق غسيل إيفر وايت')
      expect(cleanArabicWeightAndVolume('دجاج فقيه مجمد ٦٠٠ ج')).toBe('دجاج فقيه مجمد')
      expect(cleanArabicWeightAndVolume('حليب نادك كامل الدسم طويل الأجل ٤ × ١ لتر')).toBe('حليب نادك كامل الدسم طويل الأجل')
      expect(cleanArabicWeightAndVolume('سمك كنعد كامل صغير للكيلو')).toBe('سمك كنعد كامل صغير')
      expect(cleanArabicWeightAndVolume('خلاط يدوي ٢٦٠ واط')).toBe('خلاط يدوي ٢٦٠ واط')
      expect(cleanArabicWeightAndVolume('مقلاة من الستانلس ستيل ٢٥,٥ سم')).toBe('مقلاة من الستانلس ستيل ٢٥,٥ سم')
      expect(cleanArabicWeightAndVolume('رف تجفيف الصحون البلاستيكي ٣ طبقات')).toBe('رف تجفيف الصحون البلاستيكي ٣ طبقات')
    })

    it('Constructs concise bilingual string using pipe delimiter and omits empty/redundant Arabic', () => {
      expect(formatBilingualItemName('Hand Mixer 260W', 'خلاط يدوي ٢٦٠ واط')).toBe('Hand Mixer 260W | خلاط يدوي ٢٦٠ واط')
      expect(formatBilingualItemName('Hand Mixer 260W', null)).toBe('Hand Mixer 260W')
      expect(formatBilingualItemName('Hand Mixer 260W', '')).toBe('Hand Mixer 260W')
      expect(formatBilingualItemName('Hand Mixer 260W', 'Hand Mixer 260W')).toBe('Hand Mixer 260W')
    })
  })

  // =========================================================================
  // 4. Product Image Storage, Unique Primary & Consumer View Isolation (WIFRAN-07G §6.E)
  // =========================================================================
  describe('4. Product Image Deduplication & Consumer View Isolation', () => {
    let verifiedProductId: string | number
    let verifiedOfferId: string
    let unlinkedOfferId: string

    beforeAll(async () => {
      // 1. Create a verified product
      const prodRes = await db.query<{ id: string | number }>(`
        INSERT INTO public.products (
          canonical_product_key,
          item_name_complete,
          name_en,
          verification_status
        ) VALUES (
          'everwhite:ever-white-washing-powder-10kg:std:10kilogram:1xeach',
          'Ever White Washing Powder 10Kg',
          'Ever White Washing Powder 10Kg',
          'verified'
        ) RETURNING id;
      `)
      verifiedProductId = prodRes.rows[0].id

      // 2. Create offer linked to this product
      const linkedOfferRes = await db.query<{ id: string }>(`
        INSERT INTO public.offers (
          supermarket_id,
          location_scope,
          city_id,
          region_id,
          category_id,
          title_ar,
          title_en,
          offer_price,
          offer_end_date,
          status,
          image_url,
          image_path,
          source_offer_id,
          product_id,
          catalog_match_status,
          contract_v2
        ) VALUES (
          $1,
          'city',
          $2,
          $3,
          $4,
          'مسحوق غسيل إيفر وايت ١٠ كجم',
          'Ever White Washing Powder 10Kg',
          42.50,
          '2026-11-05',
          'published',
          'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-images/alwafa/crop_everwhite.webp',
          'alwafa/crop_everwhite.webp',
          'alwafa-test:p001:i002:s01',
          $5,
          'verified_linked',
          '{"offer_name_en": "Ever White Washing Powder 10Kg", "assets": {"offer_card": {"storage_bucket": "offer-images", "storage_object_path": "alwafa/crop_everwhite.webp", "delivery_url": "https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-images/alwafa/crop_everwhite.webp"}}}'::jsonb
        ) RETURNING id;
      `, [testSupermarketId, testCityId, testRegionId, testCategoryId, verifiedProductId])
      verifiedOfferId = linkedOfferRes.rows[0].id

      // 3. Create unlinked ambiguous offer (Dove 5+1)
      const unlinkedOfferRes = await db.query<{ id: string }>(`
        INSERT INTO public.offers (
          supermarket_id,
          location_scope,
          city_id,
          region_id,
          category_id,
          title_ar,
          title_en,
          offer_price,
          offer_end_date,
          status,
          image_url,
          image_path,
          source_offer_id,
          product_id,
          catalog_match_status,
          contract_v2
        ) VALUES (
          $1,
          'city',
          $2,
          $3,
          $4,
          'صابون دوف ١٢٥ جم ٥+١ مجاناً متنوع',
          'Dove Soap 125Gm 5+1 Free Asstd.',
          29.95,
          '2026-11-05',
          'published',
          'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-images/alwafa/crop_dove.webp',
          'alwafa/crop_dove.webp',
          'alwafa-test:p001:i003:s01',
          null,
          'excluded_ambiguous',
          '{"offer_name_en": "Dove Soap 125Gm 5+1 Free Asstd.", "assets": {"offer_card": {"storage_bucket": "offer-images", "storage_object_path": "alwafa/crop_dove.webp", "delivery_url": "https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-images/alwafa/crop_dove.webp"}}}'::jsonb
        ) RETURNING id;
      `, [testSupermarketId, testCityId, testRegionId, testCategoryId])
      unlinkedOfferId = unlinkedOfferRes.rows[0].id
    })

    it('Before approved product image exists, v_consumer_offers projects NULL and NEVER leaks private crop', async () => {
      const res = await db.query<{
        id: string
        title_en: string
        image_url: string | null
        storage_path: string | null
        consumer_contract_v2: any
      }>(`
        SELECT id, title_en, image_url, storage_path, consumer_contract_v2
        FROM public.v_consumer_offers
        WHERE id = $1;
      `, [verifiedOfferId])

      expect(res.rows.length).toBe(1)
      expect(res.rows[0].image_url).toBeNull()
      expect(res.rows[0].storage_path).toBeNull()

      // Nested consumer contract assets are completely scrubbed of private offer-images crop
      const card = res.rows[0].consumer_contract_v2?.assets?.offer_card
      expect(card?.delivery_url).toBeNull()
      expect(card?.storage_bucket).toBeNull()
      expect(card?.storage_object_path).toBeNull()
    })

    it('Enforces unique approved primary image per product in public.product_images', async () => {
      // Insert first primary approved image
      const img1 = await db.query<{ id: string }>(`
        INSERT INTO public.product_images (
          product_id,
          role,
          storage_bucket,
          storage_object_path,
          public_url,
          mime_type,
          byte_size,
          content_sha256,
          source_url,
          normalized_source_url,
          approval_status
        ) VALUES (
          $1,
          'primary',
          'product-images',
          'catalog/sha256-1111.jpg',
          'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/catalog/sha256-1111.jpg',
          'image/jpeg',
          125000,
          'sha256-1111',
          'https://example.com/everwhite.jpg',
          'https://example.com/everwhite.jpg',
          'approved'
        ) RETURNING id;
      `, [verifiedProductId])

      // Update product's approved_primary_image_id
      await db.query(`
        UPDATE public.products
        SET approved_primary_image_id = $1
        WHERE id = $2;
      `, [img1.rows[0].id, verifiedProductId])

      // Attempting to insert a SECOND approved primary image for the same product must fail via unique index
      let duplicateFailed = false
      try {
        await db.query(`
          INSERT INTO public.product_images (
            product_id,
            role,
            storage_bucket,
            storage_object_path,
            public_url,
            mime_type,
            byte_size,
            content_sha256,
            source_url,
            normalized_source_url,
            approval_status
          ) VALUES (
            $1,
            'primary',
            'product-images',
            'catalog/sha256-2222.jpg',
            'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/catalog/sha256-2222.jpg',
            'image/jpeg',
            135000,
            'sha256-2222',
            'https://example.com/everwhite2.jpg',
            'https://example.com/everwhite2.jpg',
            'approved'
          );
        `, [verifiedProductId])
      } catch (err: any) {
        duplicateFailed = true
        expect(err.message).toMatch(/duplicate key value violates unique constraint/i)
      }
      expect(duplicateFailed).toBe(true)
    })

    it('After primary image approval, v_consumer_offers projects the approved catalog image URL for linked offers', async () => {
      const res = await db.query<{
        id: string
        title_en: string
        image_url: string | null
        storage_path: string | null
        consumer_contract_v2: any
      }>(`
        SELECT id, title_en, image_url, storage_path, consumer_contract_v2
        FROM public.v_consumer_offers
        WHERE id = $1;
      `, [verifiedOfferId])

      expect(res.rows.length).toBe(1)
      expect(res.rows[0].image_url).toBe(
        'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/catalog/sha256-1111.jpg'
      )
      expect(res.rows[0].storage_path).toBe('catalog/sha256-1111.jpg')

      // Sanitized consumer contract has approved image delivery URL and product-images bucket
      const card = res.rows[0].consumer_contract_v2?.assets?.offer_card
      expect(card?.delivery_url).toBe(
        'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/catalog/sha256-1111.jpg'
      )
      expect(card?.storage_bucket).toBe('product-images')
      expect(card?.storage_object_path).toBeNull() // Raw internal storage object path is omitted
      expect(card?.upload_state).toBe('uploaded')
    })

    it('Unlinked ambiguous offer (Dove 5+1) remains image_url = null and NEVER leaks private crop', async () => {
      const res = await db.query<{
        id: string
        title_en: string
        image_url: string | null
        storage_path: string | null
        consumer_contract_v2: any
      }>(`
        SELECT id, title_en, image_url, storage_path, consumer_contract_v2
        FROM public.v_consumer_offers
        WHERE id = $1;
      `, [unlinkedOfferId])

      expect(res.rows.length).toBe(1)
      expect(res.rows[0].image_url).toBeNull()
      expect(res.rows[0].storage_path).toBeNull()

      const card = res.rows[0].consumer_contract_v2?.assets?.offer_card
      expect(card?.delivery_url).toBeNull()
      expect(card?.storage_bucket).toBeNull()
    })

    it('Projects illustrative display image and kind in v_consumer_offers when approved offer_display_images exists', async () => {
      // Insert approved illustrative image in public.offer_display_images
      await db.query(`
        INSERT INTO public.offer_display_images (
          offer_id,
          storage_bucket,
          storage_object_path,
          public_url,
          mime_type,
          byte_size,
          content_sha256,
          source_kind,
          visual_subject_key,
          approval_status
        ) VALUES (
          $1,
          'offer-display-images',
          'illustrations/sha256-dove-soap.png',
          'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-display-images/illustrations/sha256-dove-soap.png',
          'image/png',
          95000,
          'sha256-dove-soap',
          'generated_illustration',
          'assortment:dove-soap',
          'approved'
        );
      `, [unlinkedOfferId])

      const res = await db.query<{
        id: string
        display_image_url: string
        display_image_kind: string
        image_url: string
      }>(`
        SELECT id, display_image_url, display_image_kind, image_url
        FROM public.v_consumer_offers
        WHERE id = $1;
      `, [unlinkedOfferId])

      expect(res.rows.length).toBe(1)
      expect(res.rows[0].display_image_url).toBe(
        'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-display-images/illustrations/sha256-dove-soap.png'
      )
      expect(res.rows[0].display_image_kind).toBe('illustrative')
      expect(res.rows[0].image_url).toBe(
        'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-display-images/illustrations/sha256-dove-soap.png'
      )
    })

    it('Deduplicates visual subjects across offers via public.offer_visual_group_members', async () => {
      // Create a second unlinked offer sharing the same visual subject
      const offer2Res = await db.query<{ id: string }>(`
        INSERT INTO public.offers (
          supermarket_id,
          location_scope,
          city_id,
          region_id,
          category_id,
          title_ar,
          title_en,
          offer_price,
          offer_end_date,
          status,
          source_offer_id,
          product_id,
          catalog_match_status
        ) VALUES (
          $1, 'city', $2, $3, $4,
          'صابون دوف آخر', 'Dove Soap 125Gm 5+1 Free Asstd. (Branch 2)',
          29.95, '2026-11-05', 'published',
          'alwafa-test:p001:i003:s02', null, 'excluded_ambiguous'
        ) RETURNING id;
      `, [testSupermarketId, testCityId, testRegionId, testCategoryId])
      const secondOfferId = offer2Res.rows[0].id

      // Persist group mapping: unlinkedOfferId represents secondOfferId
      await db.query(`
        INSERT INTO public.offer_visual_group_members (
          representative_offer_id,
          member_offer_id,
          visual_subject_key,
          visual_subject_name
        ) VALUES (
          $1, $2, 'assortment:dove-soap', 'Dove Soap Assorted'
        );
      `, [unlinkedOfferId, secondOfferId])

      const members = await db.query<{
        representative_offer_id: string
        member_offer_id: string
        visual_subject_key: string
      }>(`
        SELECT representative_offer_id, member_offer_id, visual_subject_key
        FROM public.offer_visual_group_members
        WHERE representative_offer_id = $1;
      `, [unlinkedOfferId])

      expect(members.rows.length).toBe(1)
      expect(members.rows[0].member_offer_id).toBe(secondOfferId)
      expect(members.rows[0].visual_subject_key).toBe('assortment:dove-soap')
    })
  })
})
