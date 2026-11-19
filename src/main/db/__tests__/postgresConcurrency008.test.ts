import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { CatalogPublicationService } from '../catalogPublicationService'
import { VerifiedMatchCacheService } from '../verifiedMatchCacheService'
import { undoLastPublish } from '../publicationJournalAndUndoService'
import type { SqlQueryable } from '../schemaCompatibilityService'
import type { MatchingRunManifest } from '../../../shared/types/catalogMatching'
import type { UnifiedBatchOffer } from '../../../shared/types/batchExtraction'

const PG_BIN_DIR = 'C:\\Users\\AHMED\\AppData\\Local\\pgsql\\pgsql\\bin'

const MIGRATION_PATHS = [
  'project-knowledge/wifran_docs/001_initial_schema.sql',
  'project-knowledge/wifran_docs/001_seed_core_catalog.sql',
  'project-knowledge/wifran_docs/003_offer_location_scope.sql',
  'project-knowledge/wifran_docs/004_offer_image_ingestion_metadata.sql',
  'project-knowledge/wifran_docs/005_wifran_v2_offer_contract.sql',
  'project-knowledge/wifran_docs/006_wifran_07a_security_and_contract_reconciliation.sql',
  'project-knowledge/wifran_docs/007_wifran_07g_07h_catalog_resolution_and_product_images.sql',
  'project-knowledge/wifran_docs/008_wifran_07j_consumer_view_disputed_identity_masking.sql',
  'project-knowledge/wifran_docs/009_wifran_07j_product_alias_staging_and_audit.sql',
  'project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql'
]

const UUID_OTHAIM = 'c2cc16c2-0002-4444-b000-c00000000002'
const UUID_JEDDAH = 'a6f7b140-0002-4444-a000-000000000002'

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function asSqlQueryable(poolClient: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>; release?: () => void }): SqlQueryable {
  return {
    query: async <T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> => {
      const res = await poolClient.query(sql, params)
      return { rows: res.rows as T[] }
    }
  }
}

function buildRaceOffer(overrides?: Partial<UnifiedBatchOffer>): UnifiedBatchOffer {
  return {
    batchOfferKey: 'race-batch:l1:1:o01',
    batchId: 'race-batch',
    leafletId: 'leaflet-race-1',
    sourceDocumentId: 'doc_race_111122223333',
    sourceFileName: 'othaim-race.pdf',
    sourcePdfPath: '/tmp/othaim-race.pdf',
    sourceFileFingerprint: 'aaaa1111222233334444555566667777888899990000bbbbccccddddeeeeffff',
    sourcePage: 1,
    sourceOfferId: 'doc_race_111122223333:p001:i001:s01',
    sourceOfferAnchor: 'anc_race_001',
    supermarketId: UUID_OTHAIM,
    supermarketName: 'Othaim Markets',
    locationScope: 'city',
    locationLabel: 'Jeddah',
    cityId: UUID_JEDDAH,
    regionId: null,
    offerStartDate: '2026-11-11',
    offerEndDate: '2026-11-17',
    currency: 'SAR',
    metadataVerified: true,
    metadataStatus: 'operator_verified',
    titleAr: 'زيت زيتون الباشا 500 مل',
    titleEn: 'Al Basha Olive Oil 500ml',
    brand: 'Al Basha',
    brandAr: 'الباشا',
    brandEn: 'Al Basha',
    variantOrFlavor: 'Extra Virgin',
    promoPrice: 18.95,
    originalPrice: 27.5,
    discountPercent: 31,
    promoNotes: null,
    sizeOrWeight: '500ml',
    each_size_value: 500,
    each_size_unit: 'ml',
    inner_pack_count: 1,
    sale_unit_type: 'piece',
    total_content_value: 500,
    total_content_unit: 'ml',
    free_units_text: null,
    customer_limit: null,
    productThumbCropPath: null,
    offerCardCropPath: null,
    imageSubjectScope: 'product_package',
    status: 'ready_for_publication',
    confidence: 'high',
    ...overrides
  }
}

describe('WIFRAN-005J-UAT-FIX-08 Concurrency: Real Multi-Socket PostgreSQL Cluster', () => {
  it('DB-02 / DB-03 / REV-11: Advisory locks serialize concurrent multi-connection publish & undo races cleanly', async () => {
    const initdbExe = path.join(PG_BIN_DIR, 'initdb.exe')
    const pgCtlExe = path.join(PG_BIN_DIR, 'pg_ctl.exe')
    expect(fs.existsSync(initdbExe)).toBe(true)
    expect(fs.existsSync(pgCtlExe)).toBe(true)

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-pg-conc-'))
    const dataDir = path.join(rootDir, 'pgdata')
    const logFile = path.join(rootDir, 'postgres.log')
    const cacheTmp = path.join(rootDir, 'cache')
    fs.mkdirSync(cacheTmp, { recursive: true })

    const port = await getFreePort()
    let pool: Pool | null = null
    let started = false

    try {
      execFileSync(initdbExe, ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'], {
        stdio: 'ignore'
      })
      execFileSync(
        pgCtlExe,
        ['-D', dataDir, '-l', logFile, '-w', '-o', `-p ${port} -h 127.0.0.1`, 'start'],
        { stdio: 'ignore', timeout: 25000 }
      )
      started = true

      pool = new Pool({
        host: '127.0.0.1',
        port,
        user: 'postgres',
        database: 'postgres',
        max: 4
      })

      // Bootstrap Supabase stub schemas/roles then apply all 001..010 migrations cleanly
      await pool.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
        END $$;
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, created_at timestamptz DEFAULT now());
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
        CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
        CREATE SCHEMA IF NOT EXISTS storage;
        CREATE TABLE IF NOT EXISTS storage.buckets (
          id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
          file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
        );
      `)

      for (const relPath of MIGRATION_PATHS) {
        const sql = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8')
        await pool.query(sql)
      }

      const offer = buildRaceOffer()
      const mkTempManifest = (batchId: string): MatchingRunManifest => ({
        schemaVersion: '1.0',
        runId: `run_${batchId}`,
        batchId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        matchingDatabaseContext: 'PRODUCTION_UI',
        totals: {} as any,
        proposals: {
          [offer.batchOfferKey]: {
            batchOfferKey: offer.batchOfferKey,
            decision: 'temporary',
            temporaryId: 'temp_olive_race',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        },
        temporaryProducts: {
          temp_olive_race: {
            temporaryId: 'temp_olive_race',
            brandKey: 'al_basha',
            brandNameEn: 'Al Basha',
            brandNameAr: 'الباشا',
            productNameEn: 'Al Basha Olive Oil 500ml',
            productNameAr: 'زيت زيتون الباشا 500 مل',
            variantOrFlavor: 'Extra Virgin',
            eachSizeValue: 500,
            eachSizeUnit: 'ml',
            innerPackCount: 1,
            saleUnitType: 'piece',
            productForm: 'bottle',
            sourceOfferKeys: [offer.batchOfferKey],
            retailers: [UUID_OTHAIM],
            operatorDecision: 'approved'
          } as any
        },
        brandSummaries: {}
      })

      const pubService1 = new CatalogPublicationService(new VerifiedMatchCacheService(cacheTmp, 'production'))
      const pubService2 = new CatalogPublicationService(new VerifiedMatchCacheService(cacheTmp, 'production'))

      // 1. Two separate PostgreSQL socket connections racing to publish the SAME product + offer simultaneously
      const conn1 = await pool.connect()
      const conn2 = await pool.connect()
      try {
        const [r1, r2] = await Promise.all([
          pubService1.publishApprovedCatalogBatch({
            manifest: mkTempManifest('race-batch-A'),
            offers: [offer],
            context: 'PRODUCTION_UI',
            operatorId: 'worker-1',
            pgClient: asSqlQueryable(conn1),
            allowIsolatedTestDb: true,
            operatorAuthorizedProductionPublish: true,
            enableImageUpload: false,
            idempotencyKey: 'concurrent-race-key-1'
          }),
          pubService2.publishApprovedCatalogBatch({
            manifest: mkTempManifest('race-batch-B'),
            offers: [offer],
            context: 'PRODUCTION_UI',
            operatorId: 'worker-2',
            pgClient: asSqlQueryable(conn2),
            allowIsolatedTestDb: true,
            operatorAuthorizedProductionPublish: true,
            enableImageUpload: false,
            idempotencyKey: 'concurrent-race-key-2'
          })
        ])

        expect(r1.success).toBe(true)
        expect(r2.success).toBe(true)
        // Exactly ONE worker creates the product & inserts the offer; the second sees it cleanly as reused + already_published noop!
        expect(r1.createdProductsCount + r2.createdProductsCount).toBe(1)
        expect((r1.insertedOffersCount || 0) + (r2.insertedOffersCount || 0)).toBe(1)
        expect(r1.noop || r2.noop).toBe(true)

        const prodCount = await pool.query<{ c: string }>(`SELECT count(*)::text AS c FROM public.products`)
        const offerCount = await pool.query<{ c: string }>(`SELECT count(*)::text AS c FROM public.offers`)
        expect(Number(prodCount.rows[0].c)).toBe(1)
        expect(Number(offerCount.rows[0].c)).toBe(1)

        // 2. Race publish of offer #2 vs undoLastPublish of Op #1 across two simultaneous TCP connections (REV-11 global mutex)
        const offer2 = buildRaceOffer({
          batchOfferKey: 'race-batch-2:l1:2:o02',
          sourceOfferId: 'doc_race_222233334444:p001:i002:s01',
          sourceOfferAnchor: 'anc_race_002',
          titleEn: 'Al Basha Extra Honey 250g',
          titleAr: 'عسل الباشا 250 جم',
          each_size_value: 250,
          each_size_unit: 'g',
          total_content_value: 250,
          total_content_unit: 'g',
          promoPrice: 22.0,
          originalPrice: 30.0
        })
        const manifest2: MatchingRunManifest = {
          schemaVersion: '1.0',
          runId: 'run_race-batch-C',
          batchId: 'race-batch-C',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'completed',
          model: 'gemini-3.8-flash',
          thinkingLevel: 'MEDIUM',
          executionMode: 'flex',
          matchingDatabaseContext: 'PRODUCTION_UI',
          totals: {} as any,
          proposals: {
            [offer2.batchOfferKey]: {
              batchOfferKey: offer2.batchOfferKey,
              decision: 'unresolved',
              operatorDecision: 'approved',
              confidence: 'high'
            } as any
          },
          temporaryProducts: {},
          nonCatalogApprovals: {
            [offer2.batchOfferKey]: {
              batchOfferKey: offer2.batchOfferKey,
              decision: 'approved',
              category: 'loose_produce',
              updatedAt: new Date().toISOString()
            }
          },
          brandSummaries: {}
        }

        const [pub2Res, undoRes] = await Promise.all([
          pubService1.publishApprovedCatalogBatch({
            manifest: manifest2,
            offers: [offer2],
            context: 'PRODUCTION_UI',
            operatorId: 'worker-1',
            pgClient: asSqlQueryable(conn1),
            allowIsolatedTestDb: true,
            operatorAuthorizedProductionPublish: true,
            enableImageUpload: false,
            idempotencyKey: 'concurrent-race-key-3'
          }),
          undoLastPublish({
            client: asSqlQueryable(conn2),
            operatorId: 'worker-2',
            reason: 'Concurrent mutex verification'
          })
        ])

        expect(pub2Res.success).toBe(true)
        expect(undoRes.success).toBe(true)
        // Whichever acquired wifran:publication_global_mutex second executed deterministically after the first committed:
        // If pub2 ran first -> undo reverted pub2 (leaving 1 offer from Op1); if undo ran first -> undo reverted Op1 then pub2 inserted offer2 (leaving 1 offer).
        const offersAfterRace = await pool.query<{ c: string }>(`SELECT count(*)::text AS c FROM public.offers`)
        expect(Number(offersAfterRace.rows[0].c)).toBe(1)
      } finally {
        conn1.release()
        conn2.release()
      }
    } finally {
      if (pool) {
        await pool.end().catch(() => {})
      }
      if (started) {
        try {
          execFileSync(pgCtlExe, ['-D', dataDir, '-w', '-m', 'immediate', 'stop'], { stdio: 'pipe' })
        } catch {
          // ignore if already stopped
        }
      }
      try {
        fs.rmSync(rootDir, { recursive: true, force: true })
      } catch {
        // ignore Windows handle release timing
      }
    }
  }, 60000)
})
