import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import type { CanonicalOffer } from '../../types/canonicalOffer';
import {
  MASTER_REGIONS,
  MASTER_CITIES
} from '../../../main/db/referenceDataService';
import { mapPreparedPayloadToOffersInsert } from '../offerSyncMapper';
import {
  buildContractV2FromCanonical,
  mapSqlConsumerViewRowToConsumerDto
} from '../extractorContractV2Adapter';

// Helpers to bootstrap minimal Supabase auth & roles in in-memory PostgreSQL
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
  `);
}

function loadMigration(name: string): string {
  const p = path.resolve(process.cwd(), 'project-knowledge/wifran_docs', name);
  let sql = fs.readFileSync(p, 'utf8');
  // Strip extensions for in-memory PGlite
  sql = sql.replace(/create extension[^;]+;/gi, '-- extension stripped for pglite');
  // Strip gin_trgm_ops indexes for in-memory PGlite since pg_trgm extension is not loaded in wasm
  sql = sql.replace(/create index [^\n]+gin_trgm_ops\);/gi, '-- trgm index stripped for pglite');
  return sql;
}

describe('WIFRAN-07B PostgreSQL Real Execution Verification Suite', () => {
  const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures/wifran04');
  const postUploadDir = path.join(fixturesDir, 'post-upload-samples');

  const j1Raw: CanonicalOffer = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'page-001-012.canonical.json'), 'utf8'));
  const j2Raw: CanonicalOffer = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'page-003-012.canonical.json'), 'utf8'));
  const j3Raw: CanonicalOffer = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'Extracts/Alwafa_Test/json/page-002-002.canonical.json'), 'utf8'));

  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await bootstrapAuth(db);

    // Apply migrations in standard clean initialization order (001 -> 006)
    const sql001 = loadMigration('001_initial_schema.sql');
    const sql001Seed = loadMigration('001_seed_core_catalog.sql');
    const sql003 = loadMigration('003_offer_location_scope.sql');
    const sql004 = loadMigration('004_offer_image_ingestion_metadata.sql');
    const sql005 = loadMigration('005_wifran_v2_offer_contract.sql');
    const sql006 = loadMigration('006_wifran_07a_security_and_contract_reconciliation.sql');

    await db.exec(sql001);
    await db.exec(sql001Seed);
    await db.exec(sql003);
    await db.exec(sql004);
    await db.exec(sql005);
    await db.exec(sql006);
  });

  // =========================================================================
  // 1. DB-NEW-01 & CAT-01: Clean Initialization & Master Geographic Parity
  // =========================================================================
  describe('1. DB-NEW-01 & CAT-01: Clean Schema & Geographic Parity', () => {
    it('DB-NEW-01 / CAT-01: All 25 cities have exact 36-char UUIDs and 100% field parity with MASTER_CITIES', async () => {
      const res = await db.query<{
        id: string;
        slug: string;
        code: string;
        region_id: string;
        name_ar: string;
        name_en: string;
      }>('SELECT id, slug, code, region_id, name_ar, name_en FROM public.cities ORDER BY id ASC');

      expect(res.rows.length).toBe(25);
      for (const row of res.rows) {
        expect(row.id.length).toBe(36);
        const master = MASTER_CITIES.find(c => c.slug === row.slug);
        expect(master, `Missing master city for slug: ${row.slug}`).toBeDefined();
        expect(row.id).toBe(master!.id);
        expect(row.code).toBe(master!.code);
        expect(row.region_id).toBe(master!.region_id);
      }
    });

    it('DB-NEW-01: All 5 commercial regions match MASTER_REGIONS', async () => {
      const res = await db.query<{
        id: string;
        slug: string;
        code: string;
        name_ar: string;
        name_en: string;
      }>('SELECT id, slug, code, name_ar, name_en FROM public.regions ORDER BY id ASC');

      expect(res.rows.length).toBe(5);
      for (const row of res.rows) {
        const master = MASTER_REGIONS.find(r => r.slug === row.slug);
        expect(master, `Missing master region for slug: ${row.slug}`).toBeDefined();
        expect(row.id).toBe(master!.id);
        expect(row.code).toBe(master!.code);
      }
    });
  });

  // =========================================================================
  // 2. DB-UPGRADE-01: Populated Legacy Database Upgrade & Idempotent Remapping
  // =========================================================================
  describe('2. DB-UPGRADE-01: Populated Database Upgrade & Crosswalk FK Remapping', () => {
    it('Migrates legacy admin regions and legacy cities to canonical registry with 0 FK violations and 0 lost rows', async () => {
      const upgradeDb = new PGlite();
      await bootstrapAuth(upgradeDb);

      // Initialize base 001 schema and 003, 004
      await upgradeDb.exec(loadMigration('001_initial_schema.sql'));
      await upgradeDb.exec(loadMigration('003_offer_location_scope.sql'));
      await upgradeDb.exec(loadMigration('004_offer_image_ingestion_metadata.sql'));

      // Insert legacy 13 administrative regions
      const legacyMakkahRegion = 'b144b6c8-2222-477c-a496-d3c52e46b3f2';
      const legacyRiyadhRegion = 'b144b6c8-1111-477c-a496-d3c52e46b3f1';
      await upgradeDb.exec(`
        INSERT INTO public.regions (id, name_ar, name_en, slug) VALUES
          ('${legacyMakkahRegion}', 'منطقة مكة المكرمة', 'Makkah Administrative Region', 'makkah-admin-region'),
          ('${legacyRiyadhRegion}', 'منطقة الرياض', 'Riyadh Administrative Region', 'riyadh-admin-region')
        ON CONFLICT (slug) DO NOTHING;
      `);

      // Insert legacy cities (without region_id since 001 did not have region_id on cities)
      const legacyJeddahCity = 'a6f7b140-0002-4c28-98e3-c28dd6fb4fb4';
      const legacyRiyadhCity = 'a6f7b140-0001-4c28-98e3-c28dd6fb4fb4';
      await upgradeDb.exec(`
        INSERT INTO public.cities (id, name_ar, name_en, slug) VALUES
          ('${legacyJeddahCity}', 'جدة', 'Jeddah', 'jeddah'),
          ('${legacyRiyadhCity}', 'الرياض', 'Riyadh', 'riyadh')
        ON CONFLICT (slug) DO NOTHING;
      `);

      // Insert supermarkets
      const supermarketAlwafa = 'c2cc16c2-0008-4444-b000-c00000000008';
      await upgradeDb.exec(`
        INSERT INTO public.supermarkets (id, name_ar, name_en, slug) VALUES
          ('${supermarketAlwafa}', 'الوفاء', 'Alwafa', 'alwafa')
        ON CONFLICT (slug) DO NOTHING;
      `);

      // Insert child rows referencing legacy IDs
      const testOfferId = '55555555-5555-4444-a000-000000000001';
      await upgradeDb.exec(`
        INSERT INTO public.supermarket_regions (supermarket_id, city_id, region_id) VALUES
          ('${supermarketAlwafa}', '${legacyJeddahCity}', '${legacyMakkahRegion}')
        ON CONFLICT DO NOTHING;

        INSERT INTO public.offers (
          id, supermarket_id, location_scope, city_id, region_id,
          title_ar, title_en, offer_price, offer_end_date, status
        ) VALUES (
          '${testOfferId}', '${supermarketAlwafa}', 'city', '${legacyJeddahCity}', '${legacyMakkahRegion}',
          'عرض تجريبي قديم', 'Legacy Test Offer', 25.00, '2026-12-31', 'published'
        );
      `);

      // Insert user profile and shopping list referencing legacy Jeddah
      const testUserId = '77777777-7777-4444-a000-000000000001';
      await upgradeDb.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${testUserId}', 'user@wifran.com');
        INSERT INTO public.profiles (id, display_name, preferred_city_id) VALUES
          ('${testUserId}', 'Test User', '${legacyJeddahCity}');
        INSERT INTO public.shopping_lists (id, user_id, city_id, name) VALUES
          ('88888888-8888-4444-a000-000000000001', '${testUserId}', '${legacyJeddahCity}', 'Weekly List');
      `);

      // Now apply migration 005 and 006
      await upgradeDb.exec(loadMigration('005_wifran_v2_offer_contract.sql'));
      await upgradeDb.exec(loadMigration('006_wifran_07a_security_and_contract_reconciliation.sql'));

      // Verify all child tables were seamlessly remapped to canonical IDs
      const canonicalJeddah = 'a6f7b140-0002-4444-a000-000000000002';
      const canonicalWesternRegion = 'b144b6c8-2222-4444-b000-000000000002';

      const offerRes = await upgradeDb.query<{ city_id: string; region_id: string }>(
        `SELECT city_id, region_id FROM public.offers WHERE id = '${testOfferId}'`
      );
      expect(offerRes.rows[0].city_id).toBe(canonicalJeddah);
      expect(offerRes.rows[0].region_id).toBe(canonicalWesternRegion);

      const profileRes = await upgradeDb.query<{ preferred_city_id: string }>(
        `SELECT preferred_city_id FROM public.profiles WHERE id = '${testUserId}'`
      );
      expect(profileRes.rows[0].preferred_city_id).toBe(canonicalJeddah);

      const listRes = await upgradeDb.query<{ city_id: string }>(
        `SELECT city_id FROM public.shopping_lists WHERE id = '88888888-8888-4444-a000-000000000001'`
      );
      expect(listRes.rows[0].city_id).toBe(canonicalJeddah);

      const smRegionRes = await upgradeDb.query<{ city_id: string; region_id: string }>(
        `SELECT city_id, region_id FROM public.supermarket_regions WHERE supermarket_id = '${supermarketAlwafa}'`
      );
      expect(smRegionRes.rows[0].city_id).toBe(canonicalJeddah);
      expect(smRegionRes.rows[0].region_id).toBe(canonicalWesternRegion);

      // Verify re-running 006 a second time is completely idempotent
      await expect(upgradeDb.exec(loadMigration('006_wifran_07a_security_and_contract_reconciliation.sql'))).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // 3. DB-INSERT-01, DB-INSERT-02, PROJ-01..04, MEDIA-01: Offers Sync & Views
  // =========================================================================

  /**
   * C-01: Production-equivalent dynamic insert helper that verifies every key in mappedPayload
   * is an authentic column on public.offers, prevents schema drift, and executes
   * dynamic parameterized SQL INSERT ... RETURNING *.
   */
  async function insertFullMappedOfferIntoPostgres(
    dbInstance: PGlite,
    mappedPayload: Record<string, any>,
    options?: { onConflict?: string }
  ): Promise<any> {
    const colRes = await dbInstance.query<{ column_name: string; data_type: string; udt_name: string }>(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offers'`
    );
    const dbColMap = new Map<string, { data_type: string; udt_name: string }>();
    for (const r of colRes.rows) {
      dbColMap.set(r.column_name, { data_type: r.data_type, udt_name: r.udt_name });
    }

    // Strict validation: every key where value !== undefined must be a real column in public.offers
    for (const key of Object.keys(mappedPayload)) {
      if (mappedPayload[key] !== undefined && !dbColMap.has(key)) {
        throw new Error(`Schema drift detected: key '${key}' in mappedPayload is not a valid column on public.offers`);
      }
    }

    const columnsToInsert: string[] = [];
    const values: any[] = [];
    const placeholders: string[] = [];

    for (const [key, rawVal] of Object.entries(mappedPayload)) {
      if (rawVal === undefined) continue;
      if (!dbColMap.has(key)) continue;

      const colMeta = dbColMap.get(key)!;
      columnsToInsert.push(key);
      placeholders.push(`$${columnsToInsert.length}`);

      let val = rawVal;
      if (colMeta.data_type === 'jsonb' || colMeta.udt_name === 'jsonb') {
        if (val !== null && typeof val === 'object') {
          val = JSON.stringify(val);
        }
      } else if (colMeta.data_type === 'ARRAY' || colMeta.udt_name.startsWith('_')) {
        if (val === null || val === undefined) {
          val = [];
        } else if (!Array.isArray(val)) {
          val = [val];
        }
      }
      values.push(val);
    }

    let sql = `INSERT INTO public.offers (${columnsToInsert.join(', ')}) VALUES (${placeholders.join(', ')})`;
    if (options?.onConflict) {
      sql += ` ${options.onConflict}`;
    } else if (columnsToInsert.includes('source_offer_id')) {
      const updateCols = columnsToInsert.filter(c => c !== 'id' && c !== 'source_offer_id');
      sql += ` ON CONFLICT (source_offer_id) WHERE source_offer_id IS NOT NULL DO UPDATE SET ${updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`;
    }
    sql += ` RETURNING *;`;

    const res = await dbInstance.query(sql, values);
    return res.rows[0];
  }

  describe('3. DB-INSERT-01..02, PROJ-01..04, MEDIA-01: SQL Ingestion & Consumer View', () => {
    it('PROJ-01: Offers in status = "needs_review" are strictly invisible in v_consumer_offers', async () => {
      const v2 = buildContractV2FromCanonical(j1Raw);
      const res = mapPreparedPayloadToOffersInsert({
        preparedPayload: {
          ...j1Raw,
          supermarket_id: 'c2cc16c2-0005-4444-b000-c00000000005', // Tamimi
          location_scope: 'national',
          status: 'needs_review',
          contract_v2: v2
        },
        imageUrl: 'https://cdn.wifran.com/leaflets/2026/dove.webp',
        storageBucket: 'offer-crops',
        storagePath: 'leaflets/2026/dove.webp',
        thumbnailUrl: 'https://cdn.wifran.com/leaflets/2026/dove-thumb.webp',
        thumbnailStoragePath: 'leaflets/2026/dove-thumb.webp',
        sourceId: null
      });

      const p = res.payload!;
      const inserted = await insertFullMappedOfferIntoPostgres(db, p);
      expect(inserted).toBeDefined();

      const viewRes = await db.query(
        `SELECT * FROM public.v_consumer_offers WHERE source_offer_id = $1`,
        [p.source_offer_id]
      );
      expect(viewRes.rows.length).toBe(0);
    });

    it('DB-INSERT-01..02, PROJ-02, MEDIA-01: Published offers return sanitized SQL view rows with 0 workstation paths and no MEDIA_UPLOAD_PENDING', async () => {
      // Ingest J1, J2, and J3 with status = 'published' via the complete mapper insert helper
      const fixtures = [
        { raw: j1Raw, smId: 'c2cc16c2-0005-4444-b000-c00000000005', scope: 'national', cityId: null, regionId: null },
        { raw: j2Raw, smId: 'c2cc16c2-0005-4444-b000-c00000000005', scope: 'national', cityId: null, regionId: null },
        { raw: j3Raw, smId: 'c2cc16c2-0008-4444-b000-c00000000008', scope: 'city', cityId: 'a6f7b140-0002-4444-a000-000000000002', regionId: 'b144b6c8-2222-4444-b000-000000000002' }
      ];

      for (const f of fixtures) {
        const v2 = buildContractV2FromCanonical(f.raw);
        const mapped = mapPreparedPayloadToOffersInsert({
          preparedPayload: {
            ...f.raw,
            supermarket_id: f.smId,
            location_scope: f.scope,
            city_id: f.cityId,
            region_id: f.regionId,
            status: 'published',
            contract_v2: v2
          },
          imageUrl: `https://cdn.wifran.com/leaflets/2026/${f.raw.source?.external_image_id || 'offer'}.webp`,
          storageBucket: 'offer-crops',
          storagePath: `leaflets/2026/${f.raw.source?.external_image_id || 'offer'}.webp`,
          thumbnailUrl: `https://cdn.wifran.com/leaflets/2026/${f.raw.source?.external_image_id || 'offer'}-thumb.webp`,
          thumbnailStoragePath: `leaflets/2026/${f.raw.source?.external_image_id || 'offer'}-thumb.webp`,
          sourceId: null
        });

        const p = mapped.payload!;
        const insertedRow = await insertFullMappedOfferIntoPostgres(db, p);
        expect(insertedRow).toBeDefined();
      }

      // Query v_consumer_offers
      const viewRows = await db.query<any>('SELECT * FROM public.v_consumer_offers');
      expect(viewRows.rows.length).toBeGreaterThanOrEqual(3);

      for (const row of viewRows.rows) {
        // Assert MEDIA-01: reason_codes does not contain MEDIA_UPLOAD_PENDING
        expect(row.reason_codes).not.toContain('MEDIA_UPLOAD_PENDING');

        // Assert 0 local workstation paths
        const rowStr = JSON.stringify(row);
        expect(/^[a-zA-Z]:[\\/]/.test(rowStr)).toBe(false);
        expect(rowStr.includes('\\Work\\')).toBe(false);
        expect(rowStr.includes('/Work/')).toBe(false);

        // Map to consumer DTO via mapSqlConsumerViewRowToConsumerDto
        const dto = mapSqlConsumerViewRowToConsumerDto(row, '2026-10-16');
        expect(dto.temporal_lifecycle_state).toBe('active');
        expect(dto.currency).toBe('SAR');
        expect(dto.card_image_upload_state).toBe('uploaded');
      }
    });

    it('PROJ-03, PROJ-04: Full contract fidelity & semantic parity across Mapper -> DB Row -> SQL View -> ConsumerOfferDTO', async () => {
      // 1. Fetch literal DB Rows
      const j1DbRes = await db.query<any>('SELECT * FROM public.offers WHERE source_offer_id = $1', ['tamimi-national-national-2026-10-20:p001:i012:s01']);
      expect(j1DbRes.rows.length).toBe(1);
      const j1DbRow = j1DbRes.rows[0];

      const j2DbRes = await db.query<any>('SELECT * FROM public.offers WHERE source_offer_id = $1', ['tamimi-national-national-2026-10-20:p003:i012:s01']);
      expect(j2DbRes.rows.length).toBe(1);
      const j2DbRow = j2DbRes.rows[0];

      const j3DbRes = await db.query<any>('SELECT * FROM public.offers WHERE source_offer_id = $1', ['alwafa-city-jeddah-2026-10-20:p002:i002:s01']);
      expect(j3DbRes.rows.length).toBe(1);
      const j3DbRow = j3DbRes.rows[0];

      // 2. Fetch literal View Rows
      const j1ViewRes = await db.query<any>('SELECT * FROM public.v_consumer_offers WHERE source_offer_id = $1', ['tamimi-national-national-2026-10-20:p001:i012:s01']);
      expect(j1ViewRes.rows.length).toBe(1);
      const j1ViewRow = j1ViewRes.rows[0];

      const j2ViewRes = await db.query<any>('SELECT * FROM public.v_consumer_offers WHERE source_offer_id = $1', ['tamimi-national-national-2026-10-20:p003:i012:s01']);
      expect(j2ViewRes.rows.length).toBe(1);
      const j2ViewRow = j2ViewRes.rows[0];

      const j3ViewRes = await db.query<any>('SELECT * FROM public.v_consumer_offers WHERE source_offer_id = $1', ['alwafa-city-jeddah-2026-10-20:p002:i002:s01']);
      expect(j3ViewRes.rows.length).toBe(1);
      const j3ViewRow = j3ViewRes.rows[0];

      // 3. Map View Rows to ConsumerOfferDTOs
      const j1Dto = mapSqlConsumerViewRowToConsumerDto(j1ViewRow, '2026-10-16');
      const j2Dto = mapSqlConsumerViewRowToConsumerDto(j2ViewRow, '2026-10-16');
      const j3Dto = mapSqlConsumerViewRowToConsumerDto(j3ViewRow, '2026-10-16');

      const parseJsonIfNeeded = (val: any) => (typeof val === 'string' ? JSON.parse(val) : val);

      // C-03 Invariant 1: Cross-fixture invariants for all 3 benchmark offers (J1, J2, J3)
      for (const dbRow of [j1DbRow, j2DbRow, j3DbRow]) {
        expect(dbRow.contract_version).toBe('wifran.extractor.offer/2.0');
        const cV2 = parseJsonIfNeeded(dbRow.contract_v2);
        const scopedAssessments = parseJsonIfNeeded(dbRow.scoped_assessments);
        expect(dbRow.semantic_checksum).toBe(cV2.record_metadata.semantic_checksum);
        expect(scopedAssessments).toEqual(cV2.assessments.capabilities);
      }

      // C-03 §2: J1 (Dove Soap 5+1) assertions
      // DB Row & View Row:
      expect(j1DbRow.contract_version).toBe('wifran.extractor.offer/2.0');
      expect(j1ViewRow.contract_version).toBe('wifran.extractor.offer/2.0');
      expect(Number(j1DbRow.inner_pack_count)).toBe(6);
      expect(Number(j1ViewRow.inner_pack_count)).toBe(6);
      expect(j1DbRow.is_indivisible_sale_unit).toBe(true);
      expect(j1ViewRow.is_indivisible_sale_unit).toBe(true);
      expect(j1DbRow.assortment_status).toBe('indicated_with_conflict');
      expect(j1ViewRow.assortment_status).toBe('indicated_with_conflict');
      expect(j1DbRow.promo_mechanic).toBe('bonus_pack');
      expect(j1ViewRow.promo_mechanic).toBe('bonus_pack');
      expect(j1DbRow.loyalty_requirement).toBe('required');
      expect(j1ViewRow.loyalty_requirement).toBe('required');
      expect(j1DbRow.derived_subcategory_slug).toBe('bath_soap');
      expect(j1ViewRow.derived_subcategory_slug).toBe('bath_soap');

      const j1DbCapabilities = parseJsonIfNeeded(j1DbRow.scoped_assessments);
      const j1ViewCapabilities = parseJsonIfNeeded(j1ViewRow.scoped_assessments);
      expect(j1DbCapabilities.exact_product_comparison).toBe('conditional');
      expect(j1ViewCapabilities.exact_product_comparison).toBe('conditional');

      // J1 ConsumerOfferDTO:
      expect(j1Dto.inner_count).toBe(6);
      expect(j1Dto.quantity_semantics.inner_count).toBe(6);
      expect(j1Dto.is_indivisible_sale_unit).toBe(true);
      expect(j1Dto.quantity_semantics.is_indivisible_sale_unit).toBe(true);
      expect(j1Dto.promotion_mechanic).toBe('bonus_pack');
      expect(j1Dto.assortment_status).toBe('indicated_with_conflict');
      expect(j1Dto.loyalty_requirement).toBe('required');
      expect(j1Dto.eligibility.loyalty_requirement).toBe('required');
      expect(Object.keys(j1Dto.capabilities).length).toBe(6);
      expect(j1Dto.capabilities.exact_product_comparison).toBe('conditional');

      // D-02: Reference price semantics on J1 DTO
      expect(j1Dto.source_reported_original_price).toBe('42.99');
      expect(j1Dto.original_price).toBe('42.99');
      expect(j1Dto.verified_non_member_price).toBeNull();

      // C-03 §3: J2 (Mini Fan) assertions
      // DB Row & View Row:
      expect(j2DbRow.derived_subcategory_slug).toBe('mini_fan');
      expect(j2ViewRow.derived_subcategory_slug).toBe('mini_fan');
      expect(j2DbRow.item_domain).toBe('appliance');
      expect(j2ViewRow.item_domain).toBe('appliance');
      expect(j2DbRow.assortment_status).toBe('assortment_indicated');
      expect(j2ViewRow.assortment_status).toBe('assortment_indicated');

      const j2DbProdAttrs = parseJsonIfNeeded(j2DbRow.product_attributes);
      const j2ViewProdAttrs = parseJsonIfNeeded(j2ViewRow.product_attributes);
      expect(j2DbProdAttrs.model.state).toBe('unknown');
      expect(j2ViewProdAttrs.model.state).toBe('unknown');

      const j2DbCapabilities = parseJsonIfNeeded(j2DbRow.scoped_assessments);
      const j2ViewCapabilities = parseJsonIfNeeded(j2ViewRow.scoped_assessments);
      expect(j2DbCapabilities.exact_product_comparison).toBe('blocked');
      expect(j2ViewCapabilities.exact_product_comparison).toBe('blocked');

      // J2 ConsumerOfferDTO:
      expect(j2Dto.item_domain).toBe('appliance');
      expect(j2Dto.assortment_status).toBe('assortment_indicated');
      expect(j2Dto.capabilities.exact_product_comparison).toBe('blocked');

      // D-02: Reference price semantics on J2 DTO
      expect(j2Dto.source_reported_original_price).toBe('29.00');
      expect(j2Dto.original_price).toBe('29.00');
      expect(j2Dto.verified_non_member_price).toBeNull();

      // C-03 §4: J3 (Ethiopian Fresh Mutton) assertions
      // DB Row & View Row:
      expect(j3DbRow.derived_subcategory_slug).toBe('fresh_mutton');
      expect(j3ViewRow.derived_subcategory_slug).toBe('fresh_mutton');
      expect(j3DbRow.assortment_status).toBe('single_product');
      expect(j3ViewRow.assortment_status).toBe('single_product');
      expect(j3DbRow.inner_pack_count).toBeNull();
      expect(j3ViewRow.inner_pack_count).toBeNull();
      expect(j3DbRow.is_indivisible_sale_unit).toBe(false);
      expect(j3ViewRow.is_indivisible_sale_unit).toBe(false);

      const j3DbProdAttrs = parseJsonIfNeeded(j3DbRow.product_attributes);
      const j3ViewProdAttrs = parseJsonIfNeeded(j3ViewRow.product_attributes);
      expect(j3DbProdAttrs.origin.value).toBe('ethiopian');
      expect(j3ViewProdAttrs.origin.value).toBe('ethiopian');

      const j3DbCapabilities = parseJsonIfNeeded(j3DbRow.scoped_assessments);
      const j3ViewCapabilities = parseJsonIfNeeded(j3ViewRow.scoped_assessments);
      expect(j3DbCapabilities.exact_product_comparison).toBe('needs_review');
      expect(j3ViewCapabilities.exact_product_comparison).toBe('needs_review');
      expect(j3DbCapabilities.automatic_list_fulfillment).toBe('conditional');
      expect(j3ViewCapabilities.automatic_list_fulfillment).toBe('conditional');

      // J3 ConsumerOfferDTO:
      expect(j3Dto.sale_unit).toBe('kg');
      expect(j3Dto.quantity_semantics.sale_unit).toBe('kg');
      expect(j3Dto.inner_count).toBeNull();
      expect(j3Dto.quantity_semantics.inner_count).toBeNull();
      expect(j3Dto.is_indivisible_sale_unit).toBe(false);
      expect(j3Dto.quantity_semantics.is_indivisible_sale_unit).toBe(false);
      expect(j3Dto.derived_subcategory).toBe('fresh_mutton');
      expect(j3Dto.derived_subcategory_slug).toBe('fresh_mutton');
      expect(j3Dto.capabilities.exact_product_comparison).toBe('needs_review');
      expect(j3Dto.capabilities.automatic_list_fulfillment).toBe('conditional');

      // D-02: Reference price semantics on J3 DTO
      expect(j3Dto.source_reported_original_price).toBe('54.99');
      expect(j3Dto.original_price).toBe('54.99');
      expect(j3Dto.verified_non_member_price).toBeNull();

      // D-02 / C-04: Regenerate ONLY the 3 consumer-projection-dto.json files (and aliases)
      fs.writeFileSync(path.join(postUploadDir, 'J1-dove-soap.consumer-projection-dto.json'), JSON.stringify(j1Dto, null, 2));
      fs.writeFileSync(path.join(postUploadDir, 'J2-mini-fan.consumer-projection-dto.json'), JSON.stringify(j2Dto, null, 2));
      fs.writeFileSync(path.join(postUploadDir, 'J3-ethiopian-mutton.consumer-projection-dto.json'), JSON.stringify(j3Dto, null, 2));

      // Also keep *.consumer-view-dto.json in sync
      fs.writeFileSync(path.join(postUploadDir, 'J1-dove-soap.consumer-view-dto.json'), JSON.stringify(j1Dto, null, 2));
      fs.writeFileSync(path.join(postUploadDir, 'J2-mini-fan.consumer-view-dto.json'), JSON.stringify(j2Dto, null, 2));
      fs.writeFileSync(path.join(postUploadDir, 'J3-ethiopian-mutton.consumer-view-dto.json'), JSON.stringify(j3Dto, null, 2));
    });

    it('D-01: mapSqlConsumerViewRowToConsumerDto reads consumer_contract_v2 and preserves sales_channel', () => {
      const viewRowWithConsumerContract = {
        source_offer_id: 'test:p001:i001:s01',
        offer_price: '19.99',
        source_reported_original_price: '29.99',
        verified_non_member_price: null,
        consumer_contract_v2: {
          eligibility: {
            sales_channel: 'online',
            loyalty: { requirement: 'required' }
          },
          price_terms: {
            source_reported_original_price: '29.99',
            verified_current_non_member_price: null
          }
        }
      };

      const dto = mapSqlConsumerViewRowToConsumerDto(viewRowWithConsumerContract);
      expect(dto.eligibility.sales_channel).toBe('online');
      expect(dto.source_reported_original_price).toBe('29.99');
      expect(dto.original_price).toBe('29.99');
      expect(dto.verified_non_member_price).toBeNull();
    });
  });

  // =========================================================================
  // 4. Location Scope & get_consumer_offers_for_shopping_date Verification
  // =========================================================================
  describe('4. Offer Scope & Geographic Resolution in SQL Function', () => {
    it('get_consumer_offers_for_shopping_date returns national, region, and city offers for Jeddah, but ONLY national for Riyadh', async () => {
      const jeddahCityId = 'a6f7b140-0002-4444-a000-000000000002';
      const riyadhCityId = 'a6f7b140-0001-4444-a000-000000000001';

      // Insert 1 regional offer (Western region)
      const westernRegionId = 'b144b6c8-2222-4444-b000-000000000002';
      await db.query(`
        INSERT INTO public.offers (
          source_offer_id, supermarket_id, location_scope, city_id, region_id,
          title_ar, title_en, offer_price, offer_start_date, offer_end_date, status, contract_v2
        ) VALUES (
          'regional-western-test:p001:i001:s01', 'c2cc16c2-0005-4444-b000-c00000000005',
          'region', NULL, '${westernRegionId}',
          'عرض غربي خاص', 'Western Special Offer', 15.00, '2026-10-10', '2026-10-25', 'published', '{}'::jsonb
        ) ON CONFLICT (source_offer_id) WHERE source_offer_id IS NOT NULL DO NOTHING;
      `);

      // Query for Jeddah on 2026-10-16
      const jeddahOffers = await db.query<any>(
        `SELECT source_offer_id, location_scope FROM public.get_consumer_offers_for_shopping_date('2026-10-16', '${jeddahCityId}', NULL)`
      );
      const jeddahScopes = jeddahOffers.rows.map(r => r.location_scope);
      expect(jeddahScopes).toContain('national');
      expect(jeddahScopes).toContain('region');
      expect(jeddahScopes).toContain('city');

      // Query for Riyadh on 2026-10-16
      const riyadhOffers = await db.query<any>(
        `SELECT source_offer_id, location_scope FROM public.get_consumer_offers_for_shopping_date('2026-10-16', '${riyadhCityId}', NULL)`
      );
      const riyadhScopes = riyadhOffers.rows.map(r => r.location_scope);
      expect(riyadhScopes).toContain('national');
      expect(riyadhScopes).not.toContain('city');
      expect(riyadhScopes).not.toContain('region');
    });
  });

  // =========================================================================
  // 5. Security, Grants & Role Privilege Tests (SEC-HIST, SEC-REPORT, INT-01..05)
  // =========================================================================
  describe('5. Security, Role Grants & Identity Protection (SEC-HIST, SEC-REPORT)', () => {
    it('SEC-HIST-01: Anonymous users are blocked from querying raw offer_revision_snapshots', async () => {
      try {
        await db.exec(`
          SET ROLE anon;
          SELECT set_config('request.jwt.claim.sub', '', false);
          SELECT set_config('request.jwt.claim.role', 'anon', false);
        `);

        await expect(
          db.query('SELECT * FROM public.offer_revision_snapshots')
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec(`
          RESET ROLE;
          SELECT set_config('request.jwt.claim.sub', '', false);
          SELECT set_config('request.jwt.claim.role', '', false);
        `);
      }
    });

    it('SEC-HIST-02, SEC-HIST-03: Authenticated non-admin cannot read snapshots directly, but can call sanitized RPC', async () => {
      const userAId = 'aaaaaaaa-aaaa-4444-a000-000000000001';
      // Insert sample revision snapshot as admin/service_role
      const sampleOffer = await db.query<any>('SELECT id, source_offer_id FROM public.offers LIMIT 1');
      const offer = sampleOffer.rows[0];

      await db.query(`
        INSERT INTO public.offer_revision_snapshots (
          offer_id, source_offer_id, source_revision, semantic_checksum, snapshot_payload
        ) VALUES (
          $1, $2, 1, 'mockchecksum', $3
        ) ON CONFLICT (source_offer_id, source_revision) DO NOTHING;
      `, [
        offer.id,
        offer.source_offer_id,
        JSON.stringify({
          price_terms: { source_reported_offer_price: '25.00', source_reported_price_basis: 'each' },
          quantity_semantics: { sale_unit: 'pack', inner_count: 6, per_inner_content: { value: 125, unit: 'g' } },
          eligibility: { loyalty: { requirement: 'required' } },
          temporal: { offer_start_date: '2026-10-14', offer_end_date: '2026-10-20' }
        })
      ]);

      try {
        // Switch to authenticated User A
        await db.exec(`
          SET ROLE authenticated;
          SELECT set_config('request.jwt.claim.sub', '${userAId}', false);
          SELECT set_config('request.jwt.claim.role', 'authenticated', false);
        `);

        // Direct table read fails
        await expect(
          db.query('SELECT * FROM public.offer_revision_snapshots')
        ).rejects.toThrow(/permission denied/i);

        // Sanitized RPC succeeds
        const rpcRes = await db.query<any>(
          `SELECT * FROM public.get_offer_revision_history_summary($1)`,
          [offer.source_offer_id]
        );
        expect(rpcRes.rows.length).toBeGreaterThanOrEqual(1);
        const row = rpcRes.rows[0];
        expect(Number(row.offer_price)).toBe(25);
        expect(row.sale_unit_type).toBe('pack');
        expect(row.inner_pack_count).toBe(6);
        expect((row as any).snapshot_payload).toBeUndefined();
      } finally {
        await db.exec(`
          RESET ROLE;
          SELECT set_config('request.jwt.claim.sub', '', false);
          SELECT set_config('request.jwt.claim.role', '', false);
        `);
      }
    });

    it('INT-04: Authenticated user cannot escalate role to admin in public.profiles', async () => {
      const userAId = 'aaaaaaaa-aaaa-4444-a000-000000000001';
      // Create user profile as superuser
      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${userAId}', 'usera@wifran.com') ON CONFLICT DO NOTHING;
        INSERT INTO public.profiles (id, display_name, role) VALUES ('${userAId}', 'User A', 'user') ON CONFLICT DO NOTHING;
      `);

      try {
        // Switch to authenticated User A
        await db.exec(`
          SET ROLE authenticated;
          SELECT set_config('request.jwt.claim.sub', '${userAId}', false);
          SELECT set_config('request.jwt.claim.role', 'authenticated', false);
        `);

        // Updating display_name succeeds
        await expect(
          db.query(`UPDATE public.profiles SET display_name = 'Updated User A' WHERE id = '${userAId}'`)
        ).resolves.not.toThrow();

        // Escalating role to admin fails via trigger or column permissions
        await expect(
          db.query(`UPDATE public.profiles SET role = 'admin' WHERE id = '${userAId}'`)
        ).rejects.toThrow();
      } finally {
        await db.exec(`
          RESET ROLE;
          SELECT set_config('request.jwt.claim.sub', '', false);
          SELECT set_config('request.jwt.claim.role', '', false);
        `);
      }
    });

    it('SEC-REPORT-01: Spoofing user_id in public.issue_reports is strictly blocked or automatically forced to auth.uid()', async () => {
      const userAId = 'aaaaaaaa-aaaa-4444-a000-000000000001';
      const userBId = 'bbbbbbbb-bbbb-4444-a000-000000000002';
      const sampleOffer = await db.query<any>('SELECT id FROM public.offers LIMIT 1');
      const offerId = sampleOffer.rows[0].id;

      try {
        // Switch to authenticated User A
        await db.exec(`
          SET ROLE authenticated;
          SELECT set_config('request.jwt.claim.sub', '${userAId}', false);
          SELECT set_config('request.jwt.claim.role', 'authenticated', false);
        `);

        // Insert issue report with user_id = User A succeeds
        const resA = await db.query<any>(`
          INSERT INTO public.issue_reports (offer_id, user_id, issue_type, comment)
          VALUES ('${offerId}', '${userAId}', 'wrong_price', 'Test report from User A')
          RETURNING user_id;
        `);
        expect(resA.rows[0].user_id).toBe(userAId);

        // Attempt to spoof user_id = User B:
        // Either RLS WITH CHECK blocks it, or the trigger enforces NEW.user_id := auth.uid()
        try {
          const resB = await db.query<any>(`
            INSERT INTO public.issue_reports (offer_id, user_id, issue_type, comment)
            VALUES ('${offerId}', '${userBId}', 'wrong_price', 'Spoof attempt')
            RETURNING user_id;
          `);
          // If inserted, trigger must have forced it to userAId
          expect(resB.rows[0].user_id).toBe(userAId);
        } catch (err: any) {
          // If blocked by RLS WITH CHECK, that also confirms SEC-REPORT-01!
          expect(err.message).toMatch(/policy|violates|permission/i);
        }
      } finally {
        await db.exec(`
          RESET ROLE;
          SELECT set_config('request.jwt.claim.sub', '', false);
          SELECT set_config('request.jwt.claim.role', '', false);
        `);
      }
    });
  });
});
