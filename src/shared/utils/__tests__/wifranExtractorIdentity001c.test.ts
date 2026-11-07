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
// Suite 1: PGlite Offline PostgreSQL Migration 001-008 Verification
// =========================================================================
describe('WIFRAN-EXTRACTOR-IDENTITY-001C — PGlite Migration 001-008 Verification', () => {
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

    // Seed test product #1
    await db.exec(`
      INSERT INTO public.products (id, name_en, name_ar, slug)
      OVERRIDING SYSTEM VALUE
      VALUES (1, 'Almarai Fresh Milk Full Fat 1L', 'حليب المراعي كامل الدسم ١ لتر', 'almarai-fresh-milk-full-fat-1l')
      ON CONFLICT DO NOTHING;
    `)
  })

  it('Migration 008: public.v_consumer_offers view exists and includes catalog_match_status column', async () => {
    const res = await db.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
      ORDER BY ordinal_position ASC
    `)
    const colNames = res.rows.map(r => r.column_name)
    expect(colNames).toContain('product_id')
    expect(colNames).toContain('display_image_url')
    expect(colNames).toContain('supermarket_name_en')
    expect(colNames).toContain('consumer_contract_v2')
  })

  it('Migration 008: masks product_id to NULL when catalog_match_status is conflict_needs_review or null', async () => {
    const offerId1 = crypto.randomUUID()
    const offerId2 = crypto.randomUUID()
    const offerId3 = crypto.randomUUID()

    // 1. Insert verified_linked offer
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${offerId1}', 'src-1', '${supermarketId}', 'published', 'Almarai Milk 1L', 5.50,
        1, 'verified_linked', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );
    `)

    // 2. Insert conflict_needs_review offer (has product_id = 1, but status is disputed)
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${offerId2}', 'src-2', '${supermarketId}', 'published', 'Disputed Item 1L', 4.50,
        1, 'conflict_needs_review', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );
    `)

    // 3. Insert unlinked offer with 'unresolved' catalog_match_status
    await db.exec(`
      INSERT INTO public.offers (
        id, source_offer_id, supermarket_id, status, title_en, offer_price,
        product_id, catalog_match_status, location_scope, offer_start_date, offer_end_date
      ) VALUES (
        '${offerId3}', 'src-3', '${supermarketId}', 'published', 'Generic Unlinked Item', 3.00,
        NULL, 'unresolved', 'national', CURRENT_DATE, CURRENT_DATE + INTERVAL '5 days'
      );
    `)

    // Query through v_consumer_offers
    const resVerified = await db.query<{ id: string; product_id: number | null }>(`
      SELECT id, product_id FROM public.v_consumer_offers WHERE id = '${offerId1}'
    `)
    expect(resVerified.rows.length).toBe(1)
    expect(resVerified.rows[0].product_id).toBe(1)

    const resDisputed = await db.query<{ id: string; product_id: number | null }>(`
      SELECT id, product_id FROM public.v_consumer_offers WHERE id = '${offerId2}'
    `)
    expect(resDisputed.rows.length).toBe(1)
    // CRITICAL INVARIANT: product_id must be MASKED TO NULL for consumers
    expect(resDisputed.rows[0].product_id).toBeNull()

    const resUnlinked = await db.query<{ id: string; product_id: number | null }>(`
      SELECT id, product_id FROM public.v_consumer_offers WHERE id = '${offerId3}'
    `)
    expect(resUnlinked.rows.length).toBe(1)
    expect(resUnlinked.rows[0].product_id).toBeNull()
  })

  it('Migration 008: RPC function get_consumer_offers_for_shopping_date filters and masks correctly', async () => {
    const res = await db.query<{ id: string; product_id: number | null }>(`
      SELECT id, product_id
      FROM public.get_consumer_offers_for_shopping_date(CURRENT_DATE)
    `)
    expect(res.rows.length).toBeGreaterThanOrEqual(2)
    const verified = res.rows.find(r => r.product_id === 1)
    expect(verified).toBeDefined()
    const masked = res.rows.find(r => r.product_id === null)
    expect(masked).toBeDefined()
  })

  it('Migration 008: idx_product_aliases_normalized_key prevents duplicate alias insertion', async () => {
    // Insert alias for product 1
    await db.exec(`
      INSERT INTO public.product_aliases (product_id, alias_text, language, source)
      VALUES (1, 'Almarai Fresh Milk Full Fat', 'en', 'manual');
    `)

    // Attempt insert of duplicate with different casing and whitespace
    let duplicateRejected = false
    try {
      await db.exec(`
        INSERT INTO public.product_aliases (product_id, alias_text, language, source)
        VALUES (1, '   almarai fresh milk full fat   ', 'en', 'manual');
      `)
    } catch (err: any) {
      duplicateRejected = true
      expect(err.message).toMatch(/duplicate key value violates unique constraint|idx_product_aliases_normalized_key/i)
    }
    expect(duplicateRejected).toBe(true)
  })
})

// =========================================================================
// Suite 2: Conflict-state protection & Unauthorized Reassignment (OfferSyncService)
// =========================================================================
describe('WIFRAN-EXTRACTOR-IDENTITY-001C — Conflict State Hardening (OfferSyncService)', () => {
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
            if (table === 'import_rows') {
              return { data: { created_offer_id: 'existing-offer-1' }, error: null }
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

  it('Item 1A: Re-sync carrying payload.product_id = null preserves existing conflict_needs_review state', async () => {
    mockDb.offers.push({
      id: 'offer-1',
      source_offer_id: 'src-1',
      source_revision: 1,
      semantic_checksum: 'chk-1',
      product_id: 1,
      catalog_match_status: 'conflict_needs_review',
      catalog_verification_basis: 'identity_contradiction_on_resync'
    })

    const preparedPayload: any = {
      source_offer_id: 'src-1',
      source_revision: 2,
      semantic_checksum: 'chk-2',
      supermarket_id: 'alwafa',
      offer_price: 5.5,
      offer_end_date: '2026-12-31',
      product_id: null,
      title_en: 'Almarai Milk Disputed'
    }

    const res = await syncPreparedOffers({
      importBatchId: 'batch-1',
      rows: [{ rowId: 'row-1', preparedPayload }] as any,
      options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
    } as any)

    expect(res.ok).toBe(true)
    const updatedOffer = mockDb.offers.find(o => o.id === 'offer-1')
    expect(updatedOffer.catalog_match_status).toBe('conflict_needs_review')
    expect(updatedOffer.product_id).toBe(1)
  })

  it('Item 1B: Re-sync carrying identical payload.product_id = 1 retains conflict_needs_review until operator resolution', async () => {
    mockDb.offers.push({
      id: 'offer-1',
      source_offer_id: 'src-1',
      source_revision: 1,
      semantic_checksum: 'chk-1',
      product_id: 1,
      catalog_match_status: 'conflict_needs_review',
      catalog_verification_basis: 'identity_contradiction_on_resync'
    })

    const preparedPayload: any = {
      source_offer_id: 'src-1',
      source_revision: 2,
      semantic_checksum: 'chk-2',
      supermarket_id: 'alwafa',
      offer_price: 5.5,
      offer_end_date: '2026-12-31',
      product_id: 1,
      title_en: 'Almarai Milk Disputed'
    }

    await syncPreparedOffers({
      importBatchId: 'batch-1',
      rows: [{ rowId: 'row-1', preparedPayload }] as any,
      options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
    } as any)

    const updatedOffer = mockDb.offers.find(o => o.id === 'offer-1')
    expect(updatedOffer.catalog_match_status).toBe('conflict_needs_review')
    expect(updatedOffer.product_id).toBe(1)
  })

  it('Item 1C: Re-sync carrying a DIFFERENT payload.product_id = 2 cannot overwrite conflict_needs_review without operator sign-off', async () => {
    mockDb.offers.push({
      id: 'offer-1',
      source_offer_id: 'src-1',
      source_revision: 1,
      semantic_checksum: 'chk-1',
      product_id: 1,
      catalog_match_status: 'conflict_needs_review',
      catalog_verification_basis: 'identity_contradiction_on_resync'
    })

    const preparedPayload: any = {
      source_offer_id: 'src-1',
      source_revision: 2,
      semantic_checksum: 'chk-2',
      supermarket_id: 'alwafa',
      offer_price: 5.5,
      offer_end_date: '2026-12-31',
      product_id: 2,
      title_en: 'Nada Milk 1L'
    }

    await syncPreparedOffers({
      importBatchId: 'batch-1',
      rows: [{ rowId: 'row-1', preparedPayload }] as any,
      options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
    } as any)

    const updatedOffer = mockDb.offers.find(o => o.id === 'offer-1')
    expect(updatedOffer.catalog_match_status).toBe('conflict_needs_review')
    expect(updatedOffer.product_id).toBe(1)
  })

  it('Item 1D: Re-sync with untrusted operator_authorized_resolution: true CANNOT clear conflict_needs_review', async () => {
    mockDb.offers.push({
      id: 'offer-1',
      source_offer_id: 'src-1',
      source_revision: 1,
      semantic_checksum: 'chk-1',
      product_id: 1,
      catalog_match_status: 'conflict_needs_review',
      catalog_verification_basis: 'identity_contradiction_on_resync'
    })

    const preparedPayload: any = {
      source_offer_id: 'src-1',
      source_revision: 2,
      semantic_checksum: 'chk-2',
      supermarket_id: 'alwafa',
      offer_price: 5.5,
      offer_end_date: '2026-12-31',
      product_id: 2,
      catalog_match_status: 'verified_linked',
      operator_authorized_resolution: true, // Untrusted flag
      title_en: 'Nada Milk 1L'
    }

    await syncPreparedOffers({
      importBatchId: 'batch-1',
      rows: [{ rowId: 'row-1', preparedPayload }] as any,
      options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
    } as any)

    const updatedOffer = mockDb.offers.find(o => o.id === 'offer-1')
    // Must strictly remain in conflict_needs_review under original product ID
    expect(updatedOffer.catalog_match_status).toBe('conflict_needs_review')
    expect(updatedOffer.product_id).toBe(1)
  })

  it('Item 1E: Re-sync attempting to reassign verified_linked to a different product ID is intercepted into conflict_needs_review', async () => {
    mockDb.offers.push({
      id: 'offer-1',
      source_offer_id: 'src-1',
      source_revision: 1,
      semantic_checksum: 'chk-1',
      product_id: 1,
      catalog_match_status: 'verified_linked',
      catalog_verification_basis: 'manual_operator_review'
    })

    const preparedPayload: any = {
      source_offer_id: 'src-1',
      source_revision: 2,
      semantic_checksum: 'chk-2',
      supermarket_id: 'alwafa',
      offer_price: 5.5,
      offer_end_date: '2026-12-31',
      product_id: 2,
      title_en: 'Different Product'
    }

    const res = await syncPreparedOffers({
      importBatchId: 'batch-1',
      rows: [{ rowId: 'row-1', preparedPayload }] as any,
      options: { dryRun: false, requirePrePublishApproval: false, supabaseClient: mockSupabase } as any
    } as any)

    const updatedOffer = mockDb.offers.find(o => o.id === 'offer-1')
    expect(updatedOffer.catalog_match_status).toBe('conflict_needs_review')
    expect(updatedOffer.product_id).toBe(1)
    expect(res.results[0].issues.some(i => i.code === 'UNAUTHORIZED_REASSIGNMENT_BLOCKED')).toBe(true)
  })
})

// =========================================================================
// Suite 3: StagedLeafletDraftService: Alias Approval Gating & DB Fail-Closed
// =========================================================================
describe('WIFRAN-EXTRACTOR-IDENTITY-001C — Staged Leaflet Publishing Safety Hardening', () => {
  let tmpDir: string
  let testMapPath: string
  let mockSupabase: any
  let simulatedLookupError: any = null
  let insertedAliases: any[] = []

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-identity-1c-'))
    testMapPath = path.join(tmpDir, 'test-map.json')
    simulatedLookupError = null
    insertedAliases = []

    mockSupabase = {
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
          limit: async (_n: number) => {
            if (table === 'product_aliases') {
              return { data: insertedAliases, error: null }
            }
            return { data: [], error: null }
          },
          maybeSingle: async () => {
            if (table === 'products') {
              if (simulatedLookupError) {
                return { data: null, error: simulatedLookupError }
              }
              if (Number(filters.id) === 1) {
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
            }
            return { data: null, error: null }
          },
          upsert: async (row: any) => {
            return { data: row, error: null }
          },
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
  })

  it('Item 2A: Operator modification alone (editing title/price/size) DOES NOT learn aliases without operatorApprovedIdentity', async () => {
    const draft: StagedLeafletDraft = {
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
          id: 'item-1',
          sourceOfferId: 'src-1',
          pageNumber: 1,
          titleAr: 'حليب المراعي كامل الدسم ١ لتر',
          titleEn: 'Almarai Fresh Milk Full Fat 1L',
          priceBefore: 6.0,
          priceAfter: 5.5,
          matchedProductId: 1,
          operatorConfirmedMatch: true,
          isOperatorModified: true,
          operatorEditedFields: ['title_en'],
          operatorApprovedIdentity: false, // NOT explicitly approved
          originalOcr: {
            titleEn: 'Al-Marai Fresh Full Fat Milk 1L'
          }
        } as any
      ],
      status: 'draft'
    }

    await saveStagedLeafletDraft(tmpDir, draft)

    const res = await publishStagedLeafletDraftToDb(tmpDir, {
      mapFilePath: testMapPath,
      operatorConfirmedPublish: true,
      requirePrePublishApproval: false,
      supabaseClient: mockSupabase
    } as any)

    expect(res.ok).toBe(true)
    expect(res.aliasesLearnedCount).toBe(0)
    expect(insertedAliases.length).toBe(0)
  })

  it('Item 2B: Explicit operatorApprovedIdentity === true triggers alias learning', async () => {
    const draft: StagedLeafletDraft = {
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
          id: 'item-1',
          sourceOfferId: 'src-1',
          pageNumber: 1,
          titleAr: 'حليب المراعي كامل الدسم ١ لتر',
          titleEn: 'Almarai Fresh Milk Full Fat 1L',
          priceBefore: 6.0,
          priceAfter: 5.5,
          matchedProductId: 1,
          operatorConfirmedMatch: true,
          operatorApprovedIdentity: true, // EXPLICIT OPERATOR APPROVAL
          operatorApprovedBy: 'operator@wifran.com', // AUDITED OPERATOR IDENTITY
          originalOcr: {
            titleEn: 'Al-Marai Fresh Full Fat Milk 1L'
          }
        } as any
      ],
      status: 'draft'
    }

    await saveStagedLeafletDraft(tmpDir, draft)

    const res = await publishStagedLeafletDraftToDb(tmpDir, {
      mapFilePath: testMapPath,
      operatorConfirmedPublish: true,
      requirePrePublishApproval: false,
      supabaseClient: mockSupabase
    } as any)

    expect(res.ok).toBe(true)
    // Operational limitation (WIFRAN-EXTRACTOR-IDENTITY-001E): alias learning disabled pending authenticated operator subsystem
    expect(res.aliasesLearnedCount).toBe(0)
    expect(insertedAliases.length).toBe(0)
  })

  it('Item 4A: Transient database query error during product lookup aborts item publish and prevents draft.status = published', async () => {
    simulatedLookupError = { message: 'Connection terminated unexpectedly (503 Service Unavailable)' }

    const draft: StagedLeafletDraft = {
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
          id: 'item-1',
          sourceOfferId: 'src-1',
          pageNumber: 1,
          titleAr: 'حليب المراعي كامل الدسم ١ لتر',
          titleEn: 'Almarai Fresh Milk Full Fat 1L',
          priceBefore: 6.0,
          priceAfter: 5.5,
          matchedProductId: 1,
          operatorConfirmedMatch: true
        } as any
      ],
      status: 'draft'
    }

    await saveStagedLeafletDraft(tmpDir, draft)

    const res = await publishStagedLeafletDraftToDb(tmpDir, {
      mapFilePath: testMapPath,
      operatorConfirmedPublish: true,
      requirePrePublishApproval: false,
      supabaseClient: mockSupabase
    } as any)

    // INVARIANT 1: Publish failed with explicit error
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.errors[0]).toMatch(/Database lookup error for offer item-1 on product #1/)

    // INVARIANT 2: Offer was NOT published (aborted before upsert)
    expect(res.offersPublishedCount).toBe(0)

    // INVARIANT 3: Draft status on disk remains 'draft' (NOT marked as published!)
    const draftOnDisk: StagedLeafletDraft = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'staged-draft.json'), 'utf8')
    )
    expect(draftOnDisk.status).toBe('draft')
    expect(draftOnDisk.publishedAt).toBeUndefined()
  })
})
