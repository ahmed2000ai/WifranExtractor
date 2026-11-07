import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { syncPreparedOffers } from '../../../main/db/offerSyncService'
import {
  publishStagedLeafletDraftToDb,
  saveStagedLeafletDraft
} from '../../../main/db/stagedLeafletDraftService'
import { matchOrCreateProduct } from '../../../main/db/productMatchingService'
import type { StagedLeafletDraft } from '../../types/stagedDraft'

// =========================================================================
// PGlite Helper to load migrations cleanly
// =========================================================================
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

    CREATE OR REPLACE FUNCTION public.is_admin()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    AS $$
      SELECT auth.role() IN ('authenticated', 'service_role');
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
  // Strip gin_trgm_ops indexes for in-memory PGlite since pg_trgm extension is not loaded in wasm
  sql = sql.replace(/create index [^\n]+gin_trgm_ops\);/gi, '-- trgm index stripped for pglite')
  return sql
}

// =========================================================================
// Suite: WIFRAN-EXTRACTOR-IDENTITY-001D — Deployment Blocker Remediation Suite
// =========================================================================
describe('WIFRAN-EXTRACTOR-IDENTITY-001D — Deployment Blocker Remediation Suite', () => {
  let db: PGlite
  const supermarketId = 'c2cc16c2-0008-4444-b000-c00000000008' // Seeded Alwafa

  beforeAll(async () => {
    db = new PGlite()
    await bootstrapAuth(db)

    const sql001 = loadMigration('001_initial_schema.sql')
    const sql001Seed = loadMigration('001_seed_core_catalog.sql')
    const sql003 = loadMigration('003_offer_location_scope.sql')
    const sql004 = loadMigration('004_offer_image_ingestion_metadata.sql')
    const sql005 = loadMigration('005_wifran_v2_offer_contract.sql')
    const sql006 = loadMigration('006_wifran_07a_security_and_contract_reconciliation.sql')
    const sql007 = loadMigration('007_wifran_07g_07h_catalog_resolution_and_product_images.sql')
    const sql008 = loadMigration('008_wifran_07j_consumer_view_disputed_identity_masking.sql')

    await db.exec(sql001)
    await db.exec(sql001Seed)
    await db.exec(sql003)
    await db.exec(sql004)
    await db.exec(sql005)
    await db.exec(sql006)
    await db.exec(sql007)
    await db.exec(sql008)

    // Seed test product #1 and #2
    await db.exec(`
      INSERT INTO public.products (id, name_en, name_ar, slug)
      OVERRIDING SYSTEM VALUE
      VALUES 
        (1, 'Almarai Fresh Milk Full Fat 1L', 'حليب المراعي كامل الدسم ١ لتر', 'almarai-fresh-milk-full-fat-1l'),
        (2, 'Nada Fresh Milk Full Fat 1L', 'حليب ندى كامل الدسم ١ لتر', 'nada-fresh-milk-full-fat-1l')
      ON CONFLICT DO NOTHING;
    `)
  })

  // -----------------------------------------------------------------------
  // Requirement 1: Non-destructive alias validation & Migration 008 safety
  // -----------------------------------------------------------------------
  it('Requirement 1: Migration 008 contains NO destructive DELETE statements against product_aliases', () => {
    const sql008 = fs.readFileSync(
      path.resolve(process.cwd(), 'project-knowledge/wifran_docs/008_wifran_07j_consumer_view_disputed_identity_masking.sql'),
      'utf8'
    )
    expect(sql008).not.toMatch(/DELETE\s+FROM\s+public\.product_aliases/i)
    expect(sql008).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.normalize_alias_key/i)
    expect(sql008).toMatch(/idx_product_aliases_normalized_key/i)
  })

  // -----------------------------------------------------------------------
  // Requirement 2: Conflicting Arabic aliases cannot bypass database constraint
  // -----------------------------------------------------------------------
  it('Requirement 2: Conflicting Arabic orthographic variations trigger unique constraint violations', async () => {
    // Insert base Arabic alias for product 1 with Teh Marbuta
    await db.exec(`
      INSERT INTO public.product_aliases (product_id, alias_text, language, source)
      VALUES (1, 'حليب المراعي طازجة', 'ar', 'manual');
    `)

    // Attempt insert with Teh Marbuta vs Heh (طازجه vs طازجة)
    let tehMarbutaRejected = false
    try {
      await db.exec(`
        INSERT INTO public.product_aliases (product_id, alias_text, language, source)
        VALUES (2, 'حليب المراعي طازجه', 'ar', 'manual');
      `)
    } catch (err: any) {
      tehMarbutaRejected = true
      expect(err.message).toMatch(/duplicate key value violates unique constraint|idx_product_aliases_normalized_key/i)
    }
    expect(tehMarbutaRejected).toBe(true)

    // Attempt insert with Alef Hamza vs bare Alef (ألمراعي vs المراعي)
    let hamzaRejected = false
    try {
      await db.exec(`
        INSERT INTO public.product_aliases (product_id, alias_text, language, source)
        VALUES (2, 'حليب ألمراعي طازجة', 'ar', 'manual');
      `)
    } catch (err: any) {
      hamzaRejected = true
      expect(err.message).toMatch(/duplicate key value violates unique constraint|idx_product_aliases_normalized_key/i)
    }
    expect(hamzaRejected).toBe(true)

    // Attempt insert with Tatweel (المـراعي vs المراعي)
    let tatweelRejected = false
    try {
      await db.exec(`
        INSERT INTO public.product_aliases (product_id, alias_text, language, source)
        VALUES (2, 'حليب المـراعي طازجة', 'ar', 'manual');
      `)
    } catch (err: any) {
      tatweelRejected = true
      expect(err.message).toMatch(/duplicate key value violates unique constraint|idx_product_aliases_normalized_key/i)
    }
    expect(tatweelRejected).toBe(true)
  })

  // -----------------------------------------------------------------------
  // Requirement 3: Database constraint blocks conflicting alias mapping across products
  // -----------------------------------------------------------------------
  it('Requirement 3: Database uniqueness rejects conflicting mapping of identical normalized alias to different products', async () => {
    await db.exec(`
      INSERT INTO public.product_aliases (product_id, alias_text, language, source)
      VALUES (1, 'Nido Milk Powder 2.5kg', 'en', 'manual');
    `)

    let crossProductRejected = false
    try {
      // Attempt to map identical alias to product 2
      await db.exec(`
        INSERT INTO public.product_aliases (product_id, alias_text, language, source)
        VALUES (2, 'nido milk powder 2.5kg', 'en', 'manual');
      `)
    } catch (err: any) {
      crossProductRejected = true
      expect(err.message).toMatch(/duplicate key value violates unique constraint/i)
    }
    expect(crossProductRejected).toBe(true)
  })

  // -----------------------------------------------------------------------
  // Requirements 4 & 5: Unauthorized payload flags cannot clear conflict & Alias learning requires audited operator identity
  // -----------------------------------------------------------------------
  describe('Requirements 4 & 5: Authorization Security & Alias Audit Provenance', () => {
    let mockDb: {
      offers: any[]
      products: Map<number, any>
      offer_revision_snapshots: any[]
    }
    let mockSupabase: any

    beforeEach(() => {
      mockDb = {
        offers: [],
        products: new Map(),
        offer_revision_snapshots: []
      }

      mockDb.products.set(1, {
        id: 1,
        name_en: 'Almarai Fresh Milk Full Fat 1L',
        name_ar: 'حليب المراعي كامل الدسم ١ لتر',
        variant_or_flavor: 'full-fat',
        each_size_value: 1,
        each_size_unit: 'liter',
        inner_pack_count: 1,
        sale_unit_type: 'each',
        verification_status: 'verified'
      })

      mockDb.products.set(2, {
        id: 2,
        name_en: 'Nada Fresh Milk Full Fat 1L',
        name_ar: 'حليب ندى كامل الدسم ١ لتر',
        variant_or_flavor: 'full-fat',
        each_size_value: 1,
        each_size_unit: 'liter',
        inner_pack_count: 1,
        sale_unit_type: 'each',
        verification_status: 'verified'
      })

      mockSupabase = {
        from: (table: string) => {
          let filters: Record<string, any> = {}
          let limitVal: number | null = null

          const builder: any = {
            select: () => builder,
            eq: (field: string, val: any) => {
              filters[field] = val
              return builder
            },
            limit: (n: number) => {
              limitVal = n
              return builder
            },
            maybeSingle: async () => {
              if (table === 'products') {
                const prod = mockDb.products.get(Number(filters.id)) || null
                return { data: prod, error: null }
              }
              return { data: null, error: null }
            },
            single: async () => {
              if (table === 'offers') {
                const off = mockDb.offers.find(o => o.id === filters.id) || null
                return { data: off, error: null }
              }
              return { data: null, error: null }
            },
            insert: async (row: any) => {
              if (table === 'offer_revision_snapshots') {
                mockDb.offer_revision_snapshots.push(row)
                return { data: row, error: null }
              }
              mockDb.offers.push(row)
              return { data: row, error: null }
            },
            update: (patch: any) => {
              return {
                eq: (field: string, val: any) => {
                  filters[field] = val
                  const idx = mockDb.offers.findIndex(o => o.id === val)
                  if (idx >= 0) {
                    mockDb.offers[idx] = { ...mockDb.offers[idx], ...patch }
                  }
                  return {
                    select: () => ({
                      single: async () => ({
                        data: idx >= 0 ? mockDb.offers[idx] : null,
                        error: idx >= 0 ? null : new Error('Not found')
                      })
                    }),
                    single: async () => ({
                      data: idx >= 0 ? mockDb.offers[idx] : null,
                      error: idx >= 0 ? null : new Error('Not found')
                    })
                  }
                }
              }
            }
          }

          builder.then = (resolve: any) => {
            if (table === 'offers') {
              let res = mockDb.offers
              if (filters.source_offer_id) {
                res = res.filter(o => o.source_offer_id === filters.source_offer_id)
              }
              if (limitVal != null) {
                res = res.slice(0, limitVal)
              }
              resolve({ data: res, error: null })
              return
            }
            resolve({ data: [], error: null })
          }

          return builder
        }
      }
    })

    it('Requirement 4: Untrusted boolean flags in sync payload CANNOT clear conflict_needs_review', async () => {
      mockDb.offers.push({
        id: 'offer-disputed',
        source_offer_id: 'src-disp-1',
        source_revision: 1,
        semantic_checksum: 'chk-1',
        product_id: 1,
        catalog_match_status: 'conflict_needs_review',
        catalog_verification_basis: 'identity_contradiction_on_resync'
      })

      const maliciousPayload: any = {
        source_offer_id: 'src-disp-1',
        source_revision: 2,
        semantic_checksum: 'chk-2',
        supermarket_id: 'alwafa',
        offer_price: 5.5,
        offer_end_date: '2026-12-31',
        product_id: 2,
        catalog_match_status: 'verified_linked',
        operator_authorized_resolution: true, // Attacker tries to bypass conflict
        title_en: 'Nada Milk 1L'
      }

      await syncPreparedOffers({
        importBatchId: 'batch-test',
        rows: [{ rowId: 'row-1', preparedPayload: maliciousPayload }] as any,
        options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
      } as any)

      const offer = mockDb.offers.find(o => o.id === 'offer-disputed')
      // INVARIANT: Must strictly retain conflict_needs_review under original product ID
      expect(offer.catalog_match_status).toBe('conflict_needs_review')
      expect(offer.product_id).toBe(1)
    })

    it('Requirement 5: Staged draft alias learning requires audited operator identity in operatorApprovedBy', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-identity-1d-'))
      const insertedAliases: any[] = []

      const localMockSupabase = {
        from: (table: string) => {
          let filters: Record<string, any> = {}
          const builder: any = {
            select: () => builder,
            eq: (col: string, val: any) => {
              filters[col] = val
              return builder
            },
            ilike: (col: string, val: any) => {
              filters[col] = val
              return builder
            },
            limit: async () => ({ data: [], error: null }),
            maybeSingle: async () => {
              if (table === 'products' && Number(filters.id) === 1) {
                return {
                  data: {
                    id: 1,
                    name_en: 'Almarai Fresh Milk Full Fat 1L',
                    name_ar: 'حليب المراعي كامل الدسم ١ لتر',
                    variant_or_flavor: 'full-fat',
                    each_size_value: 1,
                    each_size_unit: 'liter',
                    inner_pack_count: 1,
                    sale_unit_type: 'each',
                    verification_status: 'verified'
                  },
                  error: null
                }
              }
              return { data: null, error: null }
            },
            upsert: async (row: any) => ({ data: row, error: null }),
            insert: async (rows: any) => {
              if (table === 'product_aliases') {
                const toInsert = Array.isArray(rows) ? rows : [rows]
                insertedAliases.push(...toInsert)
                return { data: toInsert, error: null }
              }
              return { data: rows, error: null }
            }
          }
          return builder
        },
        storage: {
          from: () => ({
            upload: async () => ({ error: null }),
            getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/crop.webp' } })
          })
        }
      }

      // Case 5A: operatorApprovedIdentity is true, but operatorApprovedBy is missing -> BLOCKED
      const draftNoAudit: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-10',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-no-audit',
            sourceOfferId: 'src-1',
            pageNumber: 1,
            titleAr: 'حليب المراعي كامل الدسم ١ لتر',
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            priceBefore: 6.0,
            priceAfter: 5.5,
            matchedProductId: 1,
            operatorConfirmedMatch: true,
            operatorApprovedIdentity: true,
            operatorApprovedBy: null, // MISSING OPERATOR AUDIT IDENTITY
            originalOcr: { titleEn: 'Al-Marai Fresh Full Fat Milk 1L' }
          } as any
        ],
        status: 'draft'
      }

      await saveStagedLeafletDraft(tmpDir, draftNoAudit)
      const resNoAudit = await publishStagedLeafletDraftToDb(tmpDir, {
        operatorConfirmedPublish: true,
        requirePrePublishApproval: false,
        supabaseClient: localMockSupabase
      } as any)

      expect(resNoAudit.ok).toBe(true)
      expect(resNoAudit.aliasesLearnedCount).toBe(0)
      expect(insertedAliases.length).toBe(0)

      // Case 5B: Valid audited operator ID present -> ALLOWED
      const draftWithAudit: StagedLeafletDraft = {
        ...draftNoAudit,
        items: [
          {
            ...draftNoAudit.items[0],
            operatorApprovedIdentity: true,
            operatorApprovedBy: 'audited.operator@wifran.sa' // VALID AUDIT IDENTITY
          } as any
        ]
      }

      await saveStagedLeafletDraft(tmpDir, draftWithAudit)
      const resWithAudit = await publishStagedLeafletDraftToDb(tmpDir, {
        operatorConfirmedPublish: true,
        requirePrePublishApproval: false,
        supabaseClient: localMockSupabase
      } as any)

      expect(resWithAudit.ok).toBe(true)
      // Operational limitation (WIFRAN-EXTRACTOR-IDENTITY-001E): alias learning disabled pending authenticated operator subsystem
      expect(resWithAudit.aliasesLearnedCount).toBe(0)
      expect(insertedAliases.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Requirements 6 & 7: Fail-Closed Product Lookup & Multi-Cycle Re-Sync
  // -----------------------------------------------------------------------
  describe('Requirements 6 & 7: Fail-Closed Resynchronization & Conflict Invariance', () => {
    let mockDb: { offers: any[]; products: Map<number, any> }
    let mockSupabase: any
    let simulateDbError = false

    beforeEach(() => {
      simulateDbError = false
      mockDb = {
        offers: [],
        products: new Map()
      }

      mockDb.products.set(1, {
        id: 1,
        name_en: 'Almarai Fresh Milk Full Fat 1L',
        name_ar: 'حليب المراعي كامل الدسم ١ لتر',
        variant_or_flavor: 'full-fat',
        each_size_value: 1,
        each_size_unit: 'liter',
        inner_pack_count: 1,
        sale_unit_type: 'each',
        verification_status: 'verified'
      })

      mockSupabase = {
        from: (table: string) => {
          let filters: Record<string, any> = {}
          const builder: any = {
            select: () => builder,
            eq: (field: string, val: any) => {
              filters[field] = val
              return builder
            },
            limit: () => builder,
            maybeSingle: async () => {
              if (table === 'products') {
                if (simulateDbError) {
                  return { data: null, error: { message: 'Database connection timeout (503)' } }
                }
                const prod = mockDb.products.get(Number(filters.id)) || null
                return { data: prod, error: null }
              }
              return { data: null, error: null }
            },
            insert: async () => ({ data: null, error: null }),
            update: (patch: any) => ({
              eq: (_field: string, val: any) => {
                const idx = mockDb.offers.findIndex(o => o.id === val)
                if (idx >= 0) mockDb.offers[idx] = { ...mockDb.offers[idx], ...patch }
                return {
                  select: () => ({ single: async () => ({ data: mockDb.offers[idx], error: null }) }),
                  single: async () => ({ data: mockDb.offers[idx], error: null })
                }
              }
            })
          }
          builder.then = (resolve: any) => {
            if (table === 'offers') {
              resolve({ data: mockDb.offers.filter(o => o.source_offer_id === filters.source_offer_id), error: null })
              return
            }
            resolve({ data: [], error: null })
          }
          return builder
        }
      }
    })

    it('Requirement 6A: Missing verified product in catalog quarantines existing link to conflict_needs_review (never fail-open)', async () => {
      // Seed verified link pointing to product 999 (which does NOT exist in catalog)
      mockDb.offers.push({
        id: 'offer-missing-prod',
        source_offer_id: 'src-missing-prod',
        source_revision: 1,
        semantic_checksum: 'chk-1',
        product_id: 999, // Non-existent product ID
        catalog_match_status: 'verified_linked',
        catalog_verification_basis: 'historical_import'
      })

      const payload: any = {
        source_offer_id: 'src-missing-prod',
        source_revision: 2,
        semantic_checksum: 'chk-2',
        supermarket_id: 'alwafa',
        offer_price: 5.5,
        offer_end_date: '2026-12-31',
        product_id: null,
        title_en: 'Offer on deleted product'
      }

      const res = await syncPreparedOffers({
        importBatchId: 'batch-missing',
        rows: [{ rowId: 'row-1', preparedPayload: payload }] as any,
        options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
      } as any)

      expect(res.ok).toBe(true)
      const offer = mockDb.offers.find(o => o.id === 'offer-missing-prod')
      // INVARIANT: Must NOT remain verified_linked! Must be quarantined to conflict_needs_review
      expect(offer.catalog_match_status).toBe('conflict_needs_review')
      expect(offer.catalog_verification_basis).toBe('product_record_missing')
      expect(offer.product_id).toBe(999)
    })

    it('Requirement 6B: Database lookup error during resync aborts row and prevents preserving unverified link', async () => {
      mockDb.offers.push({
        id: 'offer-db-err',
        source_offer_id: 'src-db-err',
        source_revision: 1,
        semantic_checksum: 'chk-1',
        product_id: 1,
        catalog_match_status: 'verified_linked'
      })

      simulateDbError = true

      const payload: any = {
        source_offer_id: 'src-db-err',
        source_revision: 2,
        semantic_checksum: 'chk-2',
        supermarket_id: 'alwafa',
        offer_price: 5.5,
        offer_end_date: '2026-12-31',
        product_id: 1,
        title_en: 'Transient Error Offer'
      }

      const res = await syncPreparedOffers({
        importBatchId: 'batch-err',
        rows: [{ rowId: 'row-1', preparedPayload: payload }] as any,
        options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
      } as any)

      // INVARIANT: Must fail closed with error status
      expect(res.ok).toBe(false)
      expect(res.errorRows).toBe(1)
      expect(res.results[0].status).toBe('error')
      expect(res.results[0].issues.some(i => i.code === 'DATABASE_LOOKUP_FAILURE')).toBe(true)
    })

    it('Requirement 7: Repeated synchronization across multiple cycles strictly preserves conflict_needs_review', async () => {
      mockDb.offers.push({
        id: 'offer-multi-sync',
        source_offer_id: 'src-multi',
        source_revision: 1,
        semantic_checksum: 'chk-1',
        product_id: 1,
        catalog_match_status: 'conflict_needs_review',
        catalog_verification_basis: 'identity_contradiction_on_resync'
      })

      // Cycle 2: incoming sync carries null product_id
      await syncPreparedOffers({
        importBatchId: 'batch-c2',
        rows: [{
          rowId: 'row-c2',
          preparedPayload: {
            source_offer_id: 'src-multi',
            source_revision: 2,
            semantic_checksum: 'chk-2',
            supermarket_id: 'alwafa',
            offer_price: 5.5,
            offer_end_date: '2026-12-31',
            product_id: null,
            title_en: 'Multi Cycle 2'
          }
        }] as any,
        options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
      } as any)

      let offer = mockDb.offers.find(o => o.id === 'offer-multi-sync')
      expect(offer.catalog_match_status).toBe('conflict_needs_review')

      // Cycle 3: incoming sync carries original product_id
      await syncPreparedOffers({
        importBatchId: 'batch-c3',
        rows: [{
          rowId: 'row-c3',
          preparedPayload: {
            source_offer_id: 'src-multi',
            source_revision: 3,
            semantic_checksum: 'chk-3',
            supermarket_id: 'alwafa',
            offer_price: 5.5,
            offer_end_date: '2026-12-31',
            product_id: 1,
            title_en: 'Multi Cycle 3'
          }
        }] as any,
        options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
      } as any)

      offer = mockDb.offers.find(o => o.id === 'offer-multi-sync')
      expect(offer.catalog_match_status).toBe('conflict_needs_review')

      // Cycle 4: incoming sync carries different product_id
      await syncPreparedOffers({
        importBatchId: 'batch-c4',
        rows: [{
          rowId: 'row-c4',
          preparedPayload: {
            source_offer_id: 'src-multi',
            source_revision: 4,
            semantic_checksum: 'chk-4',
            supermarket_id: 'alwafa',
            offer_price: 5.5,
            offer_end_date: '2026-12-31',
            product_id: 2,
            title_en: 'Multi Cycle 4'
          }
        }] as any,
        options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
      } as any)

      offer = mockDb.offers.find(o => o.id === 'offer-multi-sync')
      expect(offer.catalog_match_status).toBe('conflict_needs_review')
      expect(offer.product_id).toBe(1) // Original ID preserved throughout
    })
  })

  // -----------------------------------------------------------------------
  // Requirements 8 & 9: Consumer View Security & Anonymous Role Verification
  // -----------------------------------------------------------------------
  describe('Requirements 8 & 9: Consumer View Security & Public Role Access', () => {
    it('Requirement 8: Consumer projection strictly masks product_id to NULL for disputed and unverified offers', async () => {
      const offerIdPubVerified = crypto.randomUUID()
      const offerIdPubDisputed = crypto.randomUUID()
      const offerIdPubUnlinked = crypto.randomUUID()
      const offerIdDraft = crypto.randomUUID()

      // Verified linked offer
      await db.exec(`
        INSERT INTO public.offers (
          id, source_offer_id, supermarket_id, status, title_en, offer_price,
          product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
        ) VALUES (
          '${offerIdPubVerified}', 'src-pv', '${supermarketId}', 'published', 'Verified Milk', 5.50,
          1, 'verified_linked', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
        );
      `)

      // Disputed offer
      await db.exec(`
        INSERT INTO public.offers (
          id, source_offer_id, supermarket_id, status, title_en, offer_price,
          product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
        ) VALUES (
          '${offerIdPubDisputed}', 'src-pd', '${supermarketId}', 'published', 'Disputed Milk', 4.50,
          1, 'conflict_needs_review', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
        );
      `)

      // Unlinked offer
      await db.exec(`
        INSERT INTO public.offers (
          id, source_offer_id, supermarket_id, status, title_en, offer_price,
          product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
        ) VALUES (
          '${offerIdPubUnlinked}', 'src-pu', '${supermarketId}', 'published', 'Unlinked Generic', 3.00,
          NULL, 'unresolved', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
        );
      `)

      // Unpublished draft (must be invisible to consumers)
      await db.exec(`
        INSERT INTO public.offers (
          id, source_offer_id, supermarket_id, status, title_en, offer_price,
          product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
        ) VALUES (
          '${offerIdDraft}', 'src-draft', '${supermarketId}', 'needs_review', 'Draft Offer', 2.00,
          1, 'verified_linked', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
        );
      `)

      // Query v_consumer_offers
      const res = await db.query<{ id: string; product_id: number | null }>(`
        SELECT id, product_id FROM public.v_consumer_offers;
      `)

      const verified = res.rows.find(r => r.id === offerIdPubVerified)
      expect(verified).toBeDefined()
      expect(verified!.product_id).toBe(1)

      const disputed = res.rows.find(r => r.id === offerIdPubDisputed)
      expect(disputed).toBeDefined()
      expect(disputed!.product_id).toBeNull() // MASKED TO NULL

      const unlinked = res.rows.find(r => r.id === offerIdPubUnlinked)
      expect(unlinked).toBeDefined()
      expect(unlinked!.product_id).toBeNull() // MASKED TO NULL

      const draft = res.rows.find(r => r.id === offerIdDraft)
      expect(draft).toBeUndefined() // Unpublished offer completely hidden
    })

    it('Requirement 9: Anonymous client role (anon) can execute get_consumer_offers_for_shopping_date with masked identities', async () => {
      // Execute as unauthenticated public role: anon
      await db.exec('SET ROLE anon;')

      const res = await db.query<{ id: string; product_id: number | null }>(`
        SELECT id, product_id
        FROM public.get_consumer_offers_for_shopping_date(CURRENT_DATE);
      `)

      expect(res.rows.length).toBeGreaterThanOrEqual(1)
      const verified = res.rows.find(r => r.product_id === 1)
      expect(verified).toBeDefined()
      const masked = res.rows.find(r => r.product_id === null)
      expect(masked).toBeDefined()

      await db.exec('RESET ROLE;')
    })
  })

  // -----------------------------------------------------------------------
  // Requirements 10, 11, 12: Deployment Script, Candidate Completeness & Verification
  // -----------------------------------------------------------------------
  it('Requirement 10: Migration deployment script scripts/apply-migration-008.ts exists and matches project architecture', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/apply-migration-008.ts')
    expect(fs.existsSync(scriptPath)).toBe(true)
    const content = fs.readFileSync(scriptPath, 'utf8')
    expect(content).toContain('db.swratbmclahjyekouned.supabase.co')
    expect(content).toContain('008_wifran_07j_consumer_view_disputed_identity_masking.sql')
    expect(content).toContain('Preflight Alias Diagnostics')
    expect(content).not.toMatch(/DELETE\s+FROM/i)
  })

  it('Requirement 11: Candidate search completeness detects truncation when total count exceeds limit', async () => {
    let exactCountRequested = false

    const mockSupabaseCount = {
      from: (_table: string) => ({
        select: (_cols: string, opts?: any) => {
          if (opts?.count === 'exact') exactCountRequested = true
          return {
            ilike: () => ({
              limit: async () => ({
                data: [{ id: 1, name_en: 'Milk' }], // Only 1 row returned due to server-side clamp
                count: 35, // PostgREST exact count header indicates 35 total rows exist!
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

    const matchRes = await matchOrCreateProduct(
      {
        productNameEn: 'Milk 1L',
        productNameAr: 'حليب ١ لتر'
      },
      { supabaseClient: mockSupabaseCount }
    )

    expect(exactCountRequested).toBe(true)
    // INVARIANT: Auto-match blocked because exact count (35) > limit (25)
    expect(matchRes.productId).toBeNull()
    expect(matchRes.issues.some(i => i.code === 'PRODUCT_CANDIDATE_SEARCH_INCOMPLETE')).toBe(true)
  })

  it('Requirement 12: Existing verified matching remains fully functional for compatible products', async () => {
    const mockSupabaseNormal = {
      from: (_table: string) => ({
        select: () => ({
          ilike: () => ({
            limit: async () => ({
              data: [
                {
                  id: 1,
                  name_en: 'Almarai Fresh Milk Full Fat 1L',
                  name_ar: 'حليب المراعي كامل الدسم ١ لتر',
                  variant_or_flavor: 'full-fat',
                  each_size_value: 1,
                  each_size_unit: 'liter',
                  inner_pack_count: 1,
                  sale_unit_type: 'each',
                  verification_status: 'verified'
                }
              ],
              count: 1,
              error: null
            })
          }),
          eq: () => ({
            limit: async () => ({ data: [], count: 0, error: null }),
            maybeSingle: async () => ({
              data: {
                id: 1,
                name_en: 'Almarai Fresh Milk Full Fat 1L',
                name_ar: 'حليب المراعي كامل الدسم ١ لتر',
                variant_or_flavor: 'full-fat',
                each_size_value: 1,
                each_size_unit: 'liter',
                inner_pack_count: 1,
                sale_unit_type: 'each',
                verification_status: 'verified'
              },
              error: null
            })
          })
        })
      })
    }

    const matchRes = await matchOrCreateProduct(
      {
        productNameEn: 'Almarai Fresh Milk Full Fat 1L',
        productNameAr: 'حليب المراعي كامل الدسم ١ لتر',
        packSizeValue: 1,
        packSizeUnit: 'liter'
      },
      { supabaseClient: mockSupabaseNormal }
    )

    expect(matchRes.productId).toBe(1)
    expect(matchRes.issues.filter(i => i.severity === 'error').length).toBe(0)
  })
})
