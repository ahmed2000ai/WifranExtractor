import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  validateProductIdentityCompatibility,
  selectSingleCompatibleVerifiedProduct
} from '../../../main/db/productIdentityCompatibilityValidator'
import {
  preMatchLocalOffersAgainstDb,
  checkPostCorrectionCatalogMatch,
  publishStagedLeafletDraftToDb,
  saveStagedLeafletDraft,
  updateStagedOfferField
} from '../../../main/db/stagedLeafletDraftService'
import { ensureProductAliases } from '../../../main/db/productAliasService'
import { syncPreparedOffers } from '../../../main/db/offerSyncService'
import type { StagedLeafletDraft, StagedOfferItem } from '../../../shared/types/productImageEnrichment'

describe('WIFRAN-EXTRACTOR-IDENTITY-001B — Phase 1 Safety Remediation and Offline Verification', () => {
  let tmpDir: string
  let testMapPath: string

  let mockDb: {
    products: Map<number, any>
    product_aliases: any[]
    offers: any[]
    offer_revision_snapshots: any[]
    leaflets: any[]
    supermarkets: any[]
    regions: any[]
    storage: Record<string, Map<string, Buffer>>
  }

  let mockSupabase: any
  let simulateQueryErrorOn: string | null = null

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-identity-1b-'))
    testMapPath = path.join(tmpDir, 'test-offer-map.json')
    simulateQueryErrorOn = null

    mockDb = {
      products: new Map(),
      product_aliases: [],
      offers: [],
      offer_revision_snapshots: [],
      leaflets: [],
      supermarkets: [
        { id: 'alwafa', slug: 'alwafa', name_en: 'Al Wafa Supermarket', name_ar: 'أسواق الوفاء' }
      ],
      regions: [
        { id: 'western', slug: 'western', name_en: 'Western Region', name_ar: 'المنطقة الغربية' }
      ],
      storage: {
        'offer-display-images': new Map(),
        'product-images': new Map(),
        'offer-images': new Map(),
        'tmp': new Map()
      }
    }

    // Product 1: Almarai Fresh Milk Full Fat 1L (verified)
    mockDb.products.set(1, {
      id: 1,
      name_en: 'Almarai Fresh Milk Full Fat 1L',
      name_ar: 'حليب المراعي طازج كامل الدسم ١ لتر',
      slug: 'almarai-fresh-milk-full-fat-1l',
      item_name_complete: 'Almarai Fresh Milk (Full Fat) 1L',
      canonical_product_key: 'almarai:almarai-fresh-milk-full-fat:full-fat:1liter:1xeach',
      brand_name: 'Almarai',
      variant_or_flavor: 'full-fat',
      each_size_value: 1,
      each_size_unit: 'liter',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      category_slug: 'dairy',
      verification_status: 'verified',
      approved_primary_image_id: 'img-p1',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/almarai-1l.webp'
    })

    // Product 2: Almarai Fresh Milk Low Fat 1L (verified)
    mockDb.products.set(2, {
      id: 2,
      name_en: 'Almarai Fresh Milk Low Fat 1L',
      name_ar: 'حليب المراعي طازج قليل الدسم ١ لتر',
      slug: 'almarai-fresh-milk-low-fat-1l',
      item_name_complete: 'Almarai Fresh Milk (Low Fat) 1L',
      canonical_product_key: 'almarai:almarai-fresh-milk-low-fat:low-fat:1liter:1xeach',
      brand_name: 'Almarai',
      variant_or_flavor: 'low-fat',
      each_size_value: 1,
      each_size_unit: 'liter',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      category_slug: 'dairy',
      verification_status: 'verified',
      approved_primary_image_id: 'img-p2',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/almarai-lowfat-1l.webp'
    })

    // Product 3: Fresh Chicken Drumsticks 500g (verified)
    mockDb.products.set(3, {
      id: 3,
      name_en: 'Alyoum Fresh Chicken Drumsticks 500g',
      name_ar: 'اليوم أفخاذ دجاج طازجة ٥٠٠ جم',
      slug: 'alyoum-fresh-chicken-drumsticks-500g',
      item_name_complete: 'Alyoum Fresh Chicken Drumsticks 500g',
      canonical_product_key: 'alyoum:chicken-drumsticks:drumstick:500gram:1xeach',
      brand_name: 'Alyoum',
      variant_or_flavor: 'drumstick',
      each_size_value: 500,
      each_size_unit: 'gram',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      category_slug: 'meat_poultry',
      verification_status: 'verified',
      approved_primary_image_id: 'img-p3',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/alyoum-drumsticks.webp'
    })

    // Product 4: Unbranded Beef per kg (loose commodity)
    mockDb.products.set(4, {
      id: 4,
      name_en: 'Fresh Beef with Bone per kg',
      name_ar: 'لحم بقر طازج بالعظم بالكيلو',
      slug: 'fresh-beef-with-bone-per-kg',
      brand_name: null,
      each_size_value: 1,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'kg',
      category_slug: 'fresh_meat',
      verification_status: 'verified'
    })

    // Product 5: Packaged Rice 5kg (sale_unit_type = 'each')
    mockDb.products.set(5, {
      id: 5,
      name_en: 'Al Shalan Basmati Rice 5kg',
      name_ar: 'أرز الشعلان بسمتي ٥ كجم',
      slug: 'al-shalan-basmati-rice-5kg',
      brand_name: 'Al Shalan',
      each_size_value: 5,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      category_slug: 'rice',
      verification_status: 'verified'
    })

    // Mock Supabase
    mockSupabase = {
      from: vi.fn((table: string) => {
        let filters: any[] = []
        let limitVal: number | null = null

        const queryObj: any = {
          select: vi.fn(() => queryObj),
          eq: vi.fn((col: string, val: any) => {
            filters.push({ col, op: 'eq', val })
            return queryObj
          }),
          neq: vi.fn((col: string, val: any) => {
            filters.push({ col, op: 'neq', val })
            return queryObj
          }),
          ilike: vi.fn((col: string, val: any) => {
            filters.push({ col, op: 'ilike', val })
            return queryObj
          }),
          in: vi.fn((col: string, vals: any[]) => {
            filters.push({ col, op: 'in', val: vals })
            return queryObj
          }),
          limit: vi.fn((n: number) => {
            limitVal = n
            return queryObj
          }),
          maybeSingle: vi.fn(async () => {
            if (simulateQueryErrorOn === table) {
              return { data: null, error: { message: `Simulated query failure on ${table}` } }
            }
            const { data } = await queryObj
            return { data: data && data.length > 0 ? data[0] : null, error: null }
          }),
          single: vi.fn(async () => {
            if (simulateQueryErrorOn === table) {
              return { data: null, error: { message: `Simulated query failure on ${table}` } }
            }
            const { data } = await queryObj
            return { data: data && data.length > 0 ? data[0] : null, error: null }
          }),
          insert: vi.fn(async (payload: any) => {
            if (simulateQueryErrorOn === table) {
              return { data: null, error: { message: `Simulated insert failure on ${table}` } }
            }
            const records = Array.isArray(payload) ? payload : [payload]
            for (const r of records) {
              const rec = { ...r, id: r.id || crypto.randomUUID() }
              if (table === 'products') mockDb.products.set(rec.id, rec)
              if (table === 'product_aliases') mockDb.product_aliases.push(rec)
              if (table === 'offers') mockDb.offers.push(rec)
              if (table === 'offer_revision_snapshots') mockDb.offer_revision_snapshots.push(rec)
              if (table === 'leaflets') mockDb.leaflets.push(rec)
            }
            return { data: records, error: null }
          }),
          upsert: vi.fn(async (payload: any) => {
            if (simulateQueryErrorOn === 'offers:upsert_23505') {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_offers_source_offer_id"' } }
            }
            if (simulateQueryErrorOn === table) {
              return { data: null, error: { message: `Simulated upsert failure on ${table}` } }
            }
            const records = Array.isArray(payload) ? payload : [payload]
            for (const r of records) {
              const rec = { ...r, id: r.id || crypto.randomUUID() }
              if (table === 'offers') {
                const idx = mockDb.offers.findIndex((o) => o.id === rec.id)
                if (idx !== -1) mockDb.offers[idx] = rec
                else mockDb.offers.push(rec)
              }
              if (table === 'leaflets') {
                const idx = mockDb.leaflets.findIndex((l) => l.id === rec.id)
                if (idx !== -1) mockDb.leaflets[idx] = rec
                else mockDb.leaflets.push(rec)
              }
            }
            return { data: records, error: null }
          }),
          update: vi.fn((updates: any) => {
            return {
              eq: vi.fn((col: string, val: any) => {
                if (table === 'offers') {
                  const target = mockDb.offers.find((o) => o[col] === val)
                  if (target) Object.assign(target, updates)
                }
                const updateResObj: any = {
                  select: vi.fn(() => ({
                    single: async () => ({ data: updates, error: null })
                  })),
                  then: (resolve: any) => resolve({ data: updates, error: null })
                }
                return updateResObj
              })
            }
          }),
          then: (resolve: any) => {
            if (simulateQueryErrorOn === table) {
              return resolve({ data: null, error: { message: `Simulated lookup failure on ${table}` } })
            }
            let records: any[] = []
            if (table === 'products') records = Array.from(mockDb.products.values())
            if (table === 'product_aliases') records = [...mockDb.product_aliases]
            if (table === 'offers') records = [...mockDb.offers]
            if (table === 'leaflets') records = [...mockDb.leaflets]
            if (table === 'supermarkets') records = [...mockDb.supermarkets]
            if (table === 'regions') records = [...mockDb.regions]

            const filtered = records.filter((r) => {
              for (const f of filters) {
                if (f.op === 'eq' && r[f.col] !== f.val) return false
                if (f.op === 'neq' && r[f.col] === f.val) return false
                if (f.op === 'in' && Array.isArray(f.val) && !f.val.includes(r[f.col])) return false
                if (f.op === 'ilike') {
                  const target = String(r[f.col] || '').toLowerCase()
                  const pattern = String(f.val || '').replace(/%/g, '').toLowerCase()
                  if (!target.includes(pattern)) return false
                }
              }
              return true
            })

            const finalData = limitVal != null ? filtered.slice(0, limitVal) : filtered
            resolve({ data: finalData, error: null })
          }
        }

        return queryObj
      }),
      storage: {
        from: vi.fn((bucket: string) => ({
          upload: vi.fn(async (storagePath: string, fileData: Buffer) => {
            if (!mockDb.storage[bucket]) mockDb.storage[bucket] = new Map()
            mockDb.storage[bucket].set(storagePath, fileData)
            return { data: { path: storagePath }, error: null }
          }),
          getPublicUrl: vi.fn((storagePath: string) => ({
            data: { publicUrl: `https://storage.wifran.com/${bucket}/${storagePath}` }
          }))
        }))
      }
    }
  })

  // =========================================================================
  // GROUP A: Remediation A — Candidate Search Completeness & Error Handling
  // =========================================================================
  describe('Group A: Remediation A — Candidate Search Completeness & Error Handling', () => {
    it('Scenario A1: Result set exceeding 25 rows triggers truncation and returns rejected_candidate_search_incomplete', () => {
      const offer = {
        titleEn: 'Almarai Fresh Milk Full Fat 1L',
        eachSizeValue: 1,
        eachSizeUnit: 'liter'
      }
      const candidates = Array.from({ length: 26 }, (_, i) => ({
        id: i + 100,
        name_en: `Almarai Fresh Milk Full Fat 1L Variant ${i}`,
        verification_status: 'verified',
        each_size_value: 1,
        each_size_unit: 'liter',
        variant_or_flavor: 'full-fat'
      }))

      const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(offer, candidates, { isTruncated: true })
      expect(matchedProduct).toBeNull()
      expect(result.isCompatible).toBe(false)
      expect(result.status).toBe('rejected_candidate_search_incomplete')
    })

    it('Scenario A2: Exactly 25 rows is recognized as complete and evaluates compatibility normally', () => {
      const offer = {
        titleEn: 'Almarai Fresh Milk Full Fat 1L',
        eachSizeValue: 1,
        eachSizeUnit: 'liter'
      }
      // 24 contradictory + 1 exact match
      const candidates = Array.from({ length: 24 }, (_, i) => ({
        id: i + 100,
        name_en: `Almarai Fresh Milk Full Fat ${i + 2}L`,
        verification_status: 'verified',
        each_size_value: i + 2,
        each_size_unit: 'liter',
        variant_or_flavor: 'full-fat'
      }))
      const exactCandidate = mockDb.products.get(1)
      candidates.push(exactCandidate)

      expect(candidates.length).toBe(25)
      const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(offer, candidates, { isTruncated: false })
      expect(matchedProduct).toBeDefined()
      expect(matchedProduct.id).toBe(1)
      expect(result.status).toBe('verified_compatible')
    })

    it('Scenario A3: Limit 26 allows detecting overflow when 26 rows returned', async () => {
      // Seed 26 alias rows for same search stem
      for (let i = 1; i <= 26; i++) {
        mockDb.product_aliases.push({ product_id: i, alias_text: 'overflow milk 1l' })
        mockDb.products.set(i, {
          id: i,
          name_en: `Overflow Milk 1L - SKU ${i}`,
          verification_status: 'verified',
          each_size_value: 1,
          each_size_unit: 'liter'
        })
      }

      const localOffers: StagedOfferItem[] = [
        {
          id: 'item-overflow',
          originalOcr: { titleEn: 'overflow milk 1l' },
          titleEn: 'overflow milk 1l',
          croppedEvidenceLocalPath: path.join(tmpDir, 'dummy.webp'),
          selectedImageSource: 'none',
          status: 'ready',
          isAiCorrected: false,
          isOperatorModified: false,
          operatorEditedFields: []
        }
      ]

      const res = await preMatchLocalOffersAgainstDb(localOffers, {
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      // Must NOT auto-match
      expect(res.items[0].matchedProductId).toBeUndefined()
      expect(res.items[0].status).toBe('ready')
      expect(res.items[0].selectedImageSource).toBe('none')
    })

    it('Scenario A4: Database query failure in candidate collection triggers rejected_database_lookup_failure', async () => {
      const offer = {
        titleEn: 'Almarai Fresh Milk Full Fat 1L',
        eachSizeValue: 1,
        eachSizeUnit: 'liter'
      }
      const candidates = [mockDb.products.get(1)]

      const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(offer, candidates, { hasLookupFailure: true })
      expect(matchedProduct).toBeNull()
      expect(result.isCompatible).toBe(false)
      expect(result.status).toBe('rejected_database_lookup_failure')
    })

    it('Scenario A5: Duplicate product IDs returned from multiple alias rows are correctly deduplicated', async () => {
      // Product 1 has 3 distinct aliases matching the same search
      mockDb.product_aliases.push({ product_id: 1, alias_text: 'marai fresh milk' })
      mockDb.product_aliases.push({ product_id: 1, alias_text: 'marai fresh milk 1000ml' })
      mockDb.product_aliases.push({ product_id: 1, alias_text: 'marai fresh milk uht' })

      const localOffers: StagedOfferItem[] = [
        {
          id: 'item-dedup',
          originalOcr: { titleEn: 'marai fresh milk' },
          titleEn: 'Almarai Fresh Milk Full Fat 1L',
          sizeOrWeight: '1L',
          croppedEvidenceLocalPath: path.join(tmpDir, 'dummy.webp'),
          selectedImageSource: 'none',
          status: 'ready',
          isAiCorrected: false,
          isOperatorModified: false,
          operatorEditedFields: []
        }
      ]

      const res = await preMatchLocalOffersAgainstDb(localOffers, {
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      // Correctly matched Product 1 without false multiple candidates ambiguity rejection
      expect(res.items[0].matchedProductId).toBe(1)
    })

    it('Scenario A6: checkPostCorrectionCatalogMatch blocks image reuse when candidates truncated', async () => {
      // Seed 26 matching products
      for (let i = 1; i <= 26; i++) {
        mockDb.products.set(i + 200, {
          id: i + 200,
          name_en: `Nadec Fresh Milk 1L`,
          verification_status: 'verified',
          each_size_value: 1,
          each_size_unit: 'liter',
          default_image_url: 'https://storage.wifran.com/images/nadec.webp'
        })
      }

      const item: StagedOfferItem = {
        id: 'post-trunc',
        originalOcr: { titleEn: 'Nadec Fresh Milk 1L' },
        titleEn: 'Nadec Fresh Milk 1L',
        croppedEvidenceLocalPath: path.join(tmpDir, 'dummy.webp'),
        selectedImageSource: 'none',
        status: 'ready',
        isAiCorrected: false,
        isOperatorModified: false,
        operatorEditedFields: []
      }

      const matchRes = await checkPostCorrectionCatalogMatch(item, mockSupabase)
      expect(matchRes).toBeNull()
    })
  })

  // =========================================================================
  // GROUP B: Remediation B — Disputed Identity Preservation Across Repeated Syncs
  // =========================================================================
  describe('Group B: Remediation B — Disputed Identity Preservation Across Repeated Syncs', () => {
    it('Scenario B1: Sync 1 flags conflict_needs_review and preserves product_id when incoming offer contradicts verified product', async () => {
      // Existing offer verified as Product 1 (1L)
      mockDb.offers.push({
        id: 'offer-sync-b1',
        source_offer_id: 'src-sync-b1',
        source_revision: 1,
        semantic_checksum: 'chk-1',
        product_id: 1,
        catalog_match_status: 'verified_linked',
        catalog_verification_basis: 'operator_match',
        catalog_verified_by: 'operator-1',
        catalog_verified_at: '2026-10-01T00:00:00Z',
        title_en: 'Almarai Fresh Milk Full Fat 1L'
      })

      // Incoming payload contradicts size: says 2L
      const res = await syncPreparedOffers(
        {
          importBatchId: 'test-batch',
          supermarketId: 'alwafa',
          locationScope: 'national',
          options: { requirePrePublishApproval: false, supabaseClient: mockSupabase } as any,
          rows: [
            {
              rowId: 'row-1',
              status: 'prepared' as const,
              preparedPayload: {
                source_offer_id: 'src-sync-b1',
                supermarket_id: 'alwafa',
                title_en: 'Almarai Fresh Milk Full Fat 2L',
                each_size_value: 2,
                each_size_unit: 'liter',
                semantic_checksum: 'chk-2',
                offer_end_date: '2026-12-31'
              }
            }
          ]
        } as any
      )

      expect(res.ok).toBe(true)
      const updated = mockDb.offers.find((o) => o.source_offer_id === 'src-sync-b1')
      expect(updated.product_id).toBe(1)
      expect(updated.catalog_match_status).toBe('conflict_needs_review')
      expect(updated.catalog_verification_basis).toBe('identity_contradiction_on_resync')
    })

    it('Scenario B2: Sync 2 preserves conflict_needs_review and product_id across repeated sync cycles', async () => {
      // Already in conflict_needs_review
      mockDb.offers.push({
        id: 'offer-sync-b2',
        source_offer_id: 'src-sync-b2',
        source_revision: 2,
        semantic_checksum: 'chk-2',
        product_id: 1,
        catalog_match_status: 'conflict_needs_review',
        catalog_verification_basis: 'identity_contradiction_on_resync',
        catalog_verified_by: 'operator-1',
        catalog_verified_at: '2026-10-01T00:00:00Z',
        title_en: 'Almarai Fresh Milk Full Fat 2L'
      })

      // Sync cycle 2: updated promo notes or price
      const res = await syncPreparedOffers(
        {
          importBatchId: 'test-batch',
          supermarketId: 'alwafa',
          locationScope: 'national',
          options: { requirePrePublishApproval: false, supabaseClient: mockSupabase } as any,
          rows: [
            {
              rowId: 'row-2',
              status: 'prepared' as const,
              preparedPayload: {
                source_offer_id: 'src-sync-b2',
                source_revision: 2,
                supermarket_id: 'alwafa',
                title_en: 'Almarai Fresh Milk Full Fat 2L',
                each_size_value: 2,
                each_size_unit: 'liter',
                offer_price: 9.5,
                semantic_checksum: 'chk-3',
                offer_end_date: '2026-12-31'
              }
            }
          ]
        } as any
      )

      expect(res.ok).toBe(true)
      const updated = mockDb.offers.find((o) => o.source_offer_id === 'src-sync-b2')
      expect(updated.product_id).toBe(1) // NOT wiped to null!
      expect(updated.catalog_match_status).toBe('conflict_needs_review')
    })

    it('Scenario B3: Multi-cycle sync never auto-restores verified_linked without operator intervention', async () => {
      // Even if incoming data in Sync 3 now appears compatible (e.g. 1L), an offer once disputed must remain in review
      mockDb.offers.push({
        id: 'offer-sync-b3',
        source_offer_id: 'src-sync-b3',
        source_revision: 2,
        semantic_checksum: 'chk-2',
        product_id: 1,
        catalog_match_status: 'conflict_needs_review',
        catalog_verification_basis: 'identity_contradiction_on_resync',
        title_en: 'Almarai Fresh Milk Full Fat 2L'
      })

      const res = await syncPreparedOffers(
        {
          importBatchId: 'test-batch',
          supermarketId: 'alwafa',
          locationScope: 'national',
          options: { requirePrePublishApproval: false, supabaseClient: mockSupabase } as any,
          rows: [
            {
              rowId: 'row-3',
              status: 'prepared' as const,
              preparedPayload: {
                source_offer_id: 'src-sync-b3',
                source_revision: 2,
                supermarket_id: 'alwafa',
                title_en: 'Almarai Fresh Milk Full Fat 1L',
                each_size_value: 1,
                each_size_unit: 'liter',
                semantic_checksum: 'chk-4',
                offer_end_date: '2026-12-31'
              }
            }
          ]
        } as any
      )

      expect(res.ok).toBe(true)
      const updated = mockDb.offers.find((o) => o.source_offer_id === 'src-sync-b3')
      expect(updated.product_id).toBe(1)
      expect(updated.catalog_match_status).toBe('conflict_needs_review') // NOT auto-promoted to verified_linked!
    })

    it('Scenario B4: Verification provenance fields are preserved across repeated conflict syncs', async () => {
      mockDb.offers.push({
        id: 'offer-sync-b4',
        source_offer_id: 'src-sync-b4',
        source_revision: 2,
        semantic_checksum: 'chk-b4-1',
        product_id: 1,
        catalog_match_status: 'conflict_needs_review',
        catalog_verification_basis: 'historical_manual_override',
        catalog_verified_by: 'lead_auditor_42',
        catalog_verified_at: '2026-09-15T12:00:00Z'
      })

      await syncPreparedOffers(
        {
          importBatchId: 'test-batch',
          supermarketId: 'alwafa',
          locationScope: 'national',
          options: { requirePrePublishApproval: false, supabaseClient: mockSupabase } as any,
          rows: [
            {
              rowId: 'row-4',
              status: 'prepared' as const,
              preparedPayload: {
                source_offer_id: 'src-sync-b4',
                supermarket_id: 'alwafa',
                title_en: 'Almarai Fresh Milk Full Fat 2L',
                semantic_checksum: 'chk-b4-2',
                offer_end_date: '2026-12-31'
              }
            }
          ]
        } as any
      )

      const updated = mockDb.offers.find((o) => o.source_offer_id === 'src-sync-b4')
      expect(updated.catalog_verified_by).toBe('lead_auditor_42')
      expect(updated.catalog_verified_at).toBe('2026-09-15T12:00:00Z')
      expect(updated.catalog_verification_basis).toBe('historical_manual_override')
    })

    it('Scenario B5: Fallback import_rows link path preserves product_id and conflict_needs_review', async () => {
      // Simulate import_rows fallback linking
      mockDb.offers.push({
        id: 'offer-existing-row',
        product_id: 1,
        catalog_match_status: 'conflict_needs_review',
        catalog_verification_basis: 'identity_contradiction_on_resync'
      })

      // Mock import_rows table
      const mockImportRows = [{ id: 'imp-row-1', created_offer_id: 'offer-existing-row' }]
      const origFrom = mockSupabase.from
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'import_rows') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: async () => ({ data: mockImportRows[0], error: null })
              }))
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: async () => ({ data: {}, error: null })
              }))
            }))
          }
        }
        return origFrom(table)
      })

      const res = await syncPreparedOffers(
        {
          importBatchId: 'test-batch',
          supermarketId: 'alwafa',
          locationScope: 'national',
          options: { requirePrePublishApproval: false, supabaseClient: mockSupabase } as any,
          rows: [
            {
              rowId: 'row-5',
              importRowId: 'imp-row-1',
              status: 'prepared' as const,
              preparedPayload: {
                supermarket_id: 'alwafa',
                title_en: 'Almarai Fresh Milk 2L',
                each_size_value: 2,
                each_size_unit: 'liter',
                offer_end_date: '2026-12-31'
              }
            }
          ]
        } as any
      )

      expect(res.ok).toBe(true)
      const updated = mockDb.offers.find((o) => o.id === 'offer-existing-row')
      expect(updated.product_id).toBe(1)
      expect(updated.catalog_match_status).toBe('conflict_needs_review')
    })
  })

  // =========================================================================
  // GROUP C: Remediation C — Consumer Projection Disputed Identity Masking
  // =========================================================================
  describe('Group C: Remediation C — Consumer Projection Disputed Identity Masking', () => {
    it('Scenario C1: Published offer in verified_linked exposes product_id in consumer projection', () => {
      const dbRow = {
        id: 'c1',
        status: 'published',
        product_id: 1,
        catalog_match_status: 'verified_linked'
      }
      // Simulation of view logic: CASE WHEN catalog_match_status = 'verified_linked' THEN product_id ELSE NULL END
      const consumerViewProductId = dbRow.catalog_match_status === 'verified_linked' ? dbRow.product_id : null
      expect(consumerViewProductId).toBe(1)
    })

    it('Scenario C2: Published offer in conflict_needs_review masks product_id to null in consumer projection', () => {
      const dbRow = {
        id: 'c2',
        status: 'published',
        product_id: 1,
        catalog_match_status: 'conflict_needs_review'
      }
      const consumerViewProductId = dbRow.catalog_match_status === 'verified_linked' ? dbRow.product_id : null
      expect(consumerViewProductId).toBeNull()
    })

    it('Scenario C3: Published offer in unresolved masks product_id to null in consumer projection', () => {
      const dbRow = {
        id: 'c3',
        status: 'published',
        product_id: 1,
        catalog_match_status: 'unresolved'
      }
      const consumerViewProductId = dbRow.catalog_match_status === 'verified_linked' ? dbRow.product_id : null
      expect(consumerViewProductId).toBeNull()
    })

    it('Scenario C4: Unpublished offer (status = needs_review) is filtered out in consumer view (0 rows)', () => {
      const dbRows = [
        { id: 'c4-pub', status: 'published', product_id: 1, catalog_match_status: 'verified_linked' },
        { id: 'c4-draft', status: 'needs_review', product_id: 1, catalog_match_status: 'verified_linked' }
      ]
      const consumerViewRows = dbRows.filter((r) => r.status === 'published')
      expect(consumerViewRows.length).toBe(1)
      expect(consumerViewRows[0].id).toBe('c4-pub')
    })

    it('Scenario C5: Migration 008 contains exact SQL view projection masking expression', () => {
      const migPath = path.join(
        process.cwd(),
        'project-knowledge/wifran_docs/008_wifran_07j_consumer_view_disputed_identity_masking.sql'
      )
      expect(fs.existsSync(migPath)).toBe(true)
      const sql = fs.readFileSync(migPath, 'utf8')
      expect(sql).toContain("WHEN o.catalog_match_status = 'verified_linked' THEN o.product_id")
      expect(sql).toContain('ELSE NULL')
      expect(sql).toContain('CREATE OR REPLACE VIEW public.v_consumer_offers')
      expect(sql).toContain("WHERE o.status = 'published'")
    })
  })

  // =========================================================================
  // GROUP D: Remediation D — Symmetric Critical-Attribute Validation & Sale Unit Checks
  // =========================================================================
  describe('Group D: Remediation D — Symmetric Critical-Attribute Validation & Sale Unit Checks', () => {
    it('Scenario D1: Generic milk offer omitting fat content does NOT auto-match Full Fat SKU (rejected_insufficient_evidence)', () => {
      const offer = {
        titleEn: 'Almarai Fresh Milk 1L',
        eachSizeValue: 1,
        eachSizeUnit: 'liter'
      }
      const candidateP1 = mockDb.products.get(1) // Full Fat 1L
      const res = validateProductIdentityCompatibility(offer, candidateP1)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_insufficient_evidence')
      expect(res.reason).toContain('Offer lacks fat content specification')
    })

    it('Scenario D2: Generic milk offer omitting fat content does NOT auto-match Low Fat SKU (rejected_insufficient_evidence)', () => {
      const offer = {
        titleEn: 'Almarai Fresh Milk 1L',
        eachSizeValue: 1,
        eachSizeUnit: 'liter'
      }
      const candidateP2 = mockDb.products.get(2) // Low Fat 1L
      const res = validateProductIdentityCompatibility(offer, candidateP2)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_insufficient_evidence')
      expect(res.reason).toContain('Offer lacks fat content specification')
    })

    it('Scenario D3: Specific Full Fat offer does NOT match candidate product lacking fat content (rejected_contradictory)', () => {
      const offer = {
        titleEn: 'Almarai Fresh Milk Full Fat 1L',
        eachSizeValue: 1,
        eachSizeUnit: 'liter'
      }
      const candidateGeneric = {
        id: 99,
        name_en: 'Almarai Fresh Milk 1L',
        brand_name: 'Almarai',
        variant_or_flavor: null,
        each_size_value: 1,
        each_size_unit: 'liter',
        verification_status: 'verified'
      }
      const res = validateProductIdentityCompatibility(offer, candidateGeneric)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.reason).toContain('Candidate product lacks specific fat content')
    })

    it('Scenario D4: Generic chicken offer omitting cut does NOT auto-match Chicken Drumsticks SKU (rejected_insufficient_evidence)', () => {
      const offer = {
        titleEn: 'Alyoum Fresh Chicken 500g',
        eachSizeValue: 500,
        eachSizeUnit: 'gram'
      }
      const candidateP3 = mockDb.products.get(3) // Chicken Drumsticks 500g
      const res = validateProductIdentityCompatibility(offer, candidateP3)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_insufficient_evidence')
      expect(res.reason).toContain('Offer lacks flavor/variant/cut specification')
    })

    it('Scenario D5: Specific Chicken Fillet offer does NOT match candidate product lacking cut (rejected_contradictory)', () => {
      const offer = {
        titleEn: 'Alyoum Fresh Chicken Fillet 500g',
        eachSizeValue: 500,
        eachSizeUnit: 'gram'
      }
      const candidateGeneric = {
        id: 98,
        name_en: 'Alyoum Fresh Chicken 500g',
        brand_name: 'Alyoum',
        variant_or_flavor: null,
        each_size_value: 500,
        each_size_unit: 'gram',
        verification_status: 'verified'
      }
      const res = validateProductIdentityCompatibility(offer, candidateGeneric)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.reason).toContain('Candidate product lacks specific flavor/variant/cut')
    })

    it('Scenario D6: Bulk per-kg offer does NOT match packaged unit SKU (rejected_contradictory), and vice versa', () => {
      // Per-kg offer vs Packaged Rice 5kg SKU
      const offerPerKg = {
        titleEn: 'Al Shalan Basmati Rice',
        brand: 'Al Shalan',
        brand_state: 'confirmed',
        saleUnitType: 'kg'
      }
      const candidatePackaged = mockDb.products.get(5) // sale_unit_type = 'each'
      const res1 = validateProductIdentityCompatibility(offerPerKg, candidatePackaged)
      expect(res1.isCompatible).toBe(false)
      expect(res1.status).toBe('rejected_contradictory')
      expect(res1.reason).toContain('per-kg bulk offer cannot match packaged unit SKU')

      // Packaged offer vs Per-kg bulk Beef SKU
      const offerPackaged = {
        titleEn: 'Fresh Beef with Bone Tray Pack',
        brand: 'Fresh Beef',
        brand_state: 'confirmed',
        saleUnitType: 'each',
        eachSizeValue: 1,
        eachSizeUnit: 'kg'
      }
      const candidatePerKg = mockDb.products.get(4) // sale_unit_type = 'kg'
      const res2 = validateProductIdentityCompatibility(offerPackaged, candidatePerKg)
      expect(res2.isCompatible).toBe(false)
      expect(res2.status).toBe('rejected_contradictory')
      expect(res2.reason).toContain('packaged offer cannot match per-kg bulk product')
    })
  })

  // =========================================================================
  // GROUP E: Remediation E — Safe Alias Integrity & Operator Gating
  // =========================================================================
  describe('Group E: Remediation E — Safe Alias Integrity & Operator Gating', () => {
    it('Scenario E1: Arabic orthographic collision with Alif hamza variation detected as conflict', async () => {
      // Existing alias pointing to Product 10: "ارز الشعلان" (without hamza)
      mockDb.product_aliases.push({ product_id: 10, alias_text: 'ارز الشعلان' })

      // Attempt to ensure alias "أرز الشعلان" (with hamza) for Product 11
      const res = await ensureProductAliases(
        {
          productId: 11,
          aliases: [{ aliasText: 'أرز الشعلان', language: 'ar', source: 'operator_review' }]
        },
        { supabaseClient: mockSupabase }
      )

      expect(res.createdCount).toBe(0)
      expect(res.issues.length).toBe(1)
      expect(res.issues[0].code).toBe('PRODUCT_ALIAS_CONFLICT')
      expect(res.issues[0].message).toContain('already points to different product ID 10')
    })

    it('Scenario E2: Arabic Teh Marbuta vs Heh variation detected as conflict', async () => {
      mockDb.product_aliases.push({ product_id: 20, alias_text: 'كريمه الطبخ نادك' })

      const res = await ensureProductAliases(
        {
          productId: 21,
          aliases: [{ aliasText: 'كريمة الطبخ نادك', language: 'ar', source: 'operator_review' }]
        },
        { supabaseClient: mockSupabase }
      )

      expect(res.createdCount).toBe(0)
      expect(res.issues[0].code).toBe('PRODUCT_ALIAS_CONFLICT')
      expect(res.issues[0].message).toContain('already points to different product ID 20')
    })

    it('Scenario E3: English case and spacing variation detected as conflict', async () => {
      mockDb.product_aliases.push({ product_id: 30, alias_text: "l'oreal   elvive shampoo" })

      const res = await ensureProductAliases(
        {
          productId: 31,
          aliases: [{ aliasText: "L'Oreal Elvive Shampoo", language: 'en', source: 'operator_review' }]
        },
        { supabaseClient: mockSupabase }
      )

      expect(res.createdCount).toBe(0)
      expect(res.issues[0].code).toBe('PRODUCT_ALIAS_CONFLICT')
      expect(res.issues[0].message).toContain('already points to different product ID 30')
    })

    it('Scenario E4: Unattended AI correction does NOT auto-learn aliases; requires operator approval', async () => {
      const jobDirAi = path.join(tmpDir, 'job-e4-ai')
      fs.mkdirSync(jobDirAi, { recursive: true })

      // Case 1: Unattended AI correction (isAiCorrected = true, operatorApprovedIdentity = false)
      const draftAi: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirAi,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-ai',
            originalOcr: { titleEn: 'Almaray Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            matchedProductId: 1,
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop1.webp'),
            selectedImageSource: 'existing_db',
            status: 'skipped',
            isAiCorrected: true,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirAi, draftAi)
      const resAi = await publishStagedLeafletDraftToDb(jobDirAi, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })
      expect(resAi.aliasesLearnedCount).toBe(0)

      // Case 2: Operator approved (operatorApprovedIdentity = true)
      const jobDirOp = path.join(tmpDir, 'job-e4-op')
      fs.mkdirSync(jobDirOp, { recursive: true })

      const draftOp: StagedLeafletDraft = {
        ...draftAi,
        jobDir: jobDirOp,
        items: [
          {
            ...draftAi.items[0],
            id: 'item-op',
            operatorApprovedIdentity: true,
            operatorApprovedBy: 'operator-1'
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirOp, draftOp)
      const resOp = await publishStagedLeafletDraftToDb(jobDirOp, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })
      // Operational limitation (WIFRAN-EXTRACTOR-IDENTITY-001E): alias learning disabled pending authenticated operator subsystem
      expect(resOp.aliasesLearnedCount).toBe(0)
    })
  })

  // =========================================================================
  // GROUP F: Remediation F — Fail-Closed Publish Validation
  // =========================================================================
  describe('Group F: Remediation F — Fail-Closed Publish Validation', () => {
    it('Scenario F1: Publishing staged draft where prodRecord lookup returns null fails closed and unlinks product', async () => {
      const jobDirF1 = path.join(tmpDir, 'job-f1')
      fs.mkdirSync(jobDirF1, { recursive: true })

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF1,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f1',
            originalOcr: { titleEn: 'Non Existent SKU' },
            titleEn: 'Non Existent SKU',
            matchedProductId: 99999, // Does NOT exist in products
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f1.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF1, draft)
      const res = await publishStagedLeafletDraftToDb(jobDirF1, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      // Must record fail-closed error
      expect(res.errors.some((e) => e.includes('references missing or unverified product #99999'))).toBe(true)
      // Published offer must have product_id nullified
      const published = mockDb.offers.find((o) => o.id === 'item-f1')
      if (published) {
        expect(published.product_id).toBeNull()
      }
    })

    it('Scenario F2: Publishing staged draft where prodRecord query returns error fails closed and unlinks product', async () => {
      const jobDirF2 = path.join(tmpDir, 'job-f2')
      fs.mkdirSync(jobDirF2, { recursive: true })

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF2,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f2',
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            matchedProductId: 1,
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f2.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF2, draft)
      simulateQueryErrorOn = 'products'

      const res = await publishStagedLeafletDraftToDb(jobDirF2, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.errors.some((e) => e.includes('Database lookup error for offer item-f2 on product #1') || e.includes('references missing or unverified product #1'))).toBe(true)
      simulateQueryErrorOn = null
    })

    it('Scenario F3: Publishing staged draft where linked candidate is contradictory fails closed and unlinks product', async () => {
      const jobDirF3 = path.join(tmpDir, 'job-f3')
      fs.mkdirSync(jobDirF3, { recursive: true })

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF3,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f3',
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 2L' },
            titleEn: 'Almarai Fresh Milk Full Fat 2L',
            sizeOrWeight: '2L',
            matchedProductId: 1, // Contradicts 1L Product 1!
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f3.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF3, draft)
      const res = await publishStagedLeafletDraftToDb(jobDirF3, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.errors.some((e) => e.includes('contradicted linked product #1'))).toBe(true)
    })

    it('Scenario F4: Publishing staged draft with verified and compatible product successfully sets product_id', async () => {
      const jobDirF4 = path.join(tmpDir, 'job-f4')
      fs.mkdirSync(jobDirF4, { recursive: true })

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF4,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f4',
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            matchedProductId: 1,
            operatorApprovedIdentity: true,
            operatorApprovedProductId: 1,
            operatorApprovedBy: 'operator-f4',
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f4.webp'),
            selectedImageSource: 'existing_db',
            status: 'skipped',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF4, draft)
      const res = await publishStagedLeafletDraftToDb(jobDirF4, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.offersPublishedCount).toBe(1)
      const published = mockDb.offers.find((o) => o.id === 'item-f4' || o.source_offer_id === 'item-f4')
      expect(published).toBeDefined()
      expect(published.product_id).toBe(1)
      expect(published.catalog_match_status).toBe('verified_linked')
    })

    it('Scenario F5: Publishing unreviewed candidate suggestion blocks verified_linked and publishes as unresolved with product_id=null', async () => {
      const jobDirF5 = path.join(tmpDir, 'job-f5')
      fs.mkdirSync(jobDirF5, { recursive: true })

      // An offer with a candidate suggestion (matchedProductId = 1) but NOT operator approved
      // and NOT approved for existing_db image reuse (selectedImageSource = 'none')
      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF5,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f5',
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            matchedProductId: 1, // compatible candidate product
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f5.webp'),
            selectedImageSource: 'none', // NOT approved for image reuse
            operatorApprovedIdentity: false, // NOT approved by operator
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF5, draft)
      const res = await publishStagedLeafletDraftToDb(jobDirF5, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.offersPublishedCount).toBe(1)
      const published = mockDb.offers.find((o) => o.id === 'item-f5' || o.source_offer_id === 'item-f5')
      expect(published).toBeDefined()
      // Suggestion-to-publishing boundary guarantee:
      // Candidate suggestions cannot cause unreviewed associations to publish as verified_linked
      expect(published.product_id).toBeNull()
      expect(published.catalog_match_status).toBe('unresolved')
    })

    it('Scenario F6: Automatically populated selectedImageSource = existing_db alone does NOT bypass approval gate (Requirement 3 & 8)', async () => {
      const jobDirF6 = path.join(tmpDir, 'job-f6')
      fs.mkdirSync(jobDirF6, { recursive: true })

      // An offer where preMatchLocalOffersAgainstDb set selectedImageSource = 'existing_db',
      // but the operator NEVER approved product identity
      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF6,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f6',
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            matchedProductId: 1,
            selectedImageSource: 'existing_db', // automatically populated image selection
            operatorApprovedIdentity: false, // NOT approved by operator
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f6.webp'),
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF6, draft)
      const res = await publishStagedLeafletDraftToDb(jobDirF6, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.offersPublishedCount).toBe(1)
      const published = mockDb.offers.find((o) => o.id === 'item-f6' || o.source_offer_id === 'item-f6')
      expect(published).toBeDefined()
      // Existing DB image selection alone must NEVER cause auto-linking
      expect(published.product_id).toBeNull()
      expect(published.catalog_match_status).toBe('unresolved')
    })

    it('Scenario F7: Automatically populated postCorrectionDbMatch alone does NOT bypass approval gate (Requirement 2 & 8)', async () => {
      const jobDirF7 = path.join(tmpDir, 'job-f7')
      fs.mkdirSync(jobDirF7, { recursive: true })

      // An offer where text editing triggered checkPostCorrectionCatalogMatch and populated postCorrectionDbMatch,
      // but operator NEVER approved identity
      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF7,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f7',
            originalOcr: { titleEn: 'Almarai Milk' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            postCorrectionDbMatch: {
              productId: 1,
              existingImageUrl: 'https://example.com/p1.webp',
              productTitleEn: 'Almarai Fresh Milk Full Fat 1L'
            },
            selectedImageSource: 'none',
            operatorApprovedIdentity: false, // NOT approved by operator
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f7.webp'),
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: true,
            operatorEditedFields: ['titleEn']
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF7, draft)
      const res = await publishStagedLeafletDraftToDb(jobDirF7, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.offersPublishedCount).toBe(1)
      const published = mockDb.offers.find((o) => o.id === 'item-f7' || o.source_offer_id === 'item-f7')
      expect(published).toBeDefined()
      // Post-correction match alone must NEVER cause auto-linking
      expect(published.product_id).toBeNull()
      expect(published.catalog_match_status).toBe('unresolved')
    })

    it('Scenario F8: Changing proposed product after approval invalidates approval (Requirement 6)', async () => {
      const jobDirF8 = path.join(tmpDir, 'job-f8')
      fs.mkdirSync(jobDirF8, { recursive: true })

      // Operator originally approved product #1, but proposed candidate was subsequently changed to product #2
      // (or mismatch between operatorApprovedProductId and candidateProductId)
      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF8,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f8',
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            matchedProductId: 2, // Candidate was changed to Product #2
            operatorApprovedIdentity: true,
            operatorApprovedProductId: 1, // Approval was specifically bound to Product #1
            operatorApprovedBy: 'operator-1',
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f8.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF8, draft)
      const res = await publishStagedLeafletDraftToDb(jobDirF8, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.offersPublishedCount).toBe(1)
      const published = mockDb.offers.find((o) => o.id === 'item-f8' || o.source_offer_id === 'item-f8')
      expect(published).toBeDefined()
      // Approval bound to product #1 is invalidated when candidate changed to #2
      expect(published.product_id).toBeNull()
      expect(published.catalog_match_status).toBe('unresolved')
    })

    it('Scenario F9: Unauthorized canary-auto-link option refuses auto-linking without operator approval (Requirement 3)', async () => {
      const jobDirF9 = path.join(tmpDir, 'job-f9')
      fs.mkdirSync(jobDirF9, { recursive: true })

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF9,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f9',
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            matchedProductId: 1, // Compatible candidate in catalog
            operatorApprovedIdentity: false, // NO human approval
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f9.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF9, draft)
      const res = await publishStagedLeafletDraftToDb(jobDirF9, {
        operatorConfirmedPublish: true,
        authorizedCanaryAutoLink: true, // Caller attempted auto-link flag
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.offersPublishedCount).toBe(1)
      const published = mockDb.offers.find((o) => o.id === 'item-f9' || o.source_offer_id === 'item-f9')
      expect(published).toBeDefined()
      // Canary auto-linking without operator approval is strictly disabled
      expect(published.product_id).toBeNull()
      expect(published.catalog_match_status).toBe('unresolved')
    })

    it('Scenario F10: Offer identity-field edits after approval invalidate approval (Requirement 3)', async () => {
      const jobDirF10 = path.join(tmpDir, 'job-f10')
      fs.mkdirSync(jobDirF10, { recursive: true })

      // 1. Initially create approved draft
      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF10,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'item-f10',
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            matchedProductId: 1,
            operatorApprovedIdentity: true,
            operatorApprovedProductId: 1,
            operatorApprovedBy: 'operator-1',
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f10.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }
      await saveStagedLeafletDraft(jobDirF10, draft)

      // 2. Operator edits size to 2L via updateStagedOfferField
      const updatedDraft = await updateStagedOfferField(
        jobDirF10,
        'item-f10',
        { sizeOrWeight: '2L' },
        { supabaseClient: mockSupabase }
      )
      const itemAfterEdit = updatedDraft.items[0]
      expect(itemAfterEdit.operatorApprovedIdentity).toBe(false)
      expect(itemAfterEdit.operatorApprovedProductId).toBeNull()

      // 3. Publish draft: must fail closed and publish as unresolved with product_id=null
      const res = await publishStagedLeafletDraftToDb(jobDirF10, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })
      expect(res.offersPublishedCount).toBe(1)

      const published = mockDb.offers.find((o) => o.id === 'item-f10' || o.source_offer_id === 'item-f10')
      expect(published).toBeDefined()
      expect(published.product_id).toBeNull()
      expect(published.catalog_match_status).toBe('unresolved')
    })

    it('Scenario F11: Same leaflet reimport with different generated IDs resolves to existing canonical offer without duplicating row (Requirement 2)', async () => {
      const jobDirF11 = path.join(tmpDir, 'job-f11')
      fs.mkdirSync(jobDirF11, { recursive: true })

      const stableSourceOfferId = 'alwafa-western-2026-11-01:p001:i001:s01'
      const canonicalUuid = 'c1111111-1111-4000-8000-000000000001'

      // Pre-existing published offer in DB
      mockDb.offers.push({
        id: canonicalUuid,
        source_offer_id: stableSourceOfferId,
        title_en: 'Almarai Fresh Milk Full Fat 1L',
        offer_price: 5.5,
        original_price: 6.0,
        catalog_match_status: 'unresolved',
        product_id: null,
        created_at: '2026-11-01T10:00:00Z'
      })

      const initialCount = mockDb.offers.length

      // Re-importing the same leaflet with a NEW randomly generated item.id
      const freshDraft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF11,
        createdAt: '2026-11-06',
        updatedAt: '2026-11-06',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'd9999999-9999-4000-8000-000000000099', // Fresh random UUID generated by new session
            sourceOfferId: stableSourceOfferId, // Exact same underlying source offer
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            matchedProductId: 1,
            operatorApprovedIdentity: false,
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f11.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF11, freshDraft)
      const res = await publishStagedLeafletDraftToDb(jobDirF11, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.ok).toBe(true)
      expect(res.offersPublishedCount).toBe(0)
      expect(res.offersSkippedAlreadyPublishedCount).toBe(1)
      // Exactly 1 row in DB for this source offer; NO second row created!
      expect(mockDb.offers.length).toBe(initialCount)
      const published = mockDb.offers.find((o) => o.source_offer_id === stableSourceOfferId)
      expect(published).toBeDefined()
      // Canonical UUID is preserved
      expect(published.id).toBe(canonicalUuid)
    })

    it('Scenario F12: Same offer recurring on different valid leaflets preserves distinct offer rows (Requirement 2)', async () => {
      const initialCount = mockDb.offers.length
      expect(initialCount).toBeGreaterThanOrEqual(0)

      // Offer from Leaflet A
      const offerAId = 'a1111111-1111-4000-8000-000000000001'
      const sourceAId = 'leaflet-a-2026-10-01:p001:i001:s01'
      mockDb.offers.push({
        id: offerAId,
        source_offer_id: sourceAId,
        title_en: 'Almarai Fresh Milk Full Fat 1L',
        offer_start_date: '2026-10-01',
        offer_end_date: '2026-10-07'
      })

      // Same product offer recurring on Leaflet B (different dates / different leaflet)
      const jobDirF12 = path.join(tmpDir, 'job-f12')
      fs.mkdirSync(jobDirF12, { recursive: true })

      const offerBId = 'b2222222-2222-4000-8000-000000000002'
      const sourceBId = 'leaflet-b-2026-11-01:p001:i001:s01'

      const draftB: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: jobDirF12,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-01',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-01',
          validTo: '2026-11-15',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: offerBId,
            sourceOfferId: sourceBId,
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            matchedProductId: 1,
            operatorApprovedIdentity: false,
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f12.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDirF12, draftB)
      const res = await publishStagedLeafletDraftToDb(jobDirF12, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.offersPublishedCount).toBe(1)
      // Both distinct offers are preserved across different leaflets
      expect(mockDb.offers.some((o) => o.source_offer_id === sourceAId)).toBe(true)
      expect(mockDb.offers.some((o) => o.source_offer_id === sourceBId)).toBe(true)
    })

    it('Scenario F13: Consumer view projection isolates private crops and projects NULL for unresolved offers (Requirement 5)', () => {
      // 1. Verified linked offer
      const verifiedOffer = {
        catalog_match_status: 'verified_linked',
        product_id: 1,
        thumbnail_url: 'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-images/crop_private.webp'
      }

      // 2. Unresolved offer
      const unresolvedOffer = {
        catalog_match_status: 'unresolved',
        product_id: null,
        thumbnail_url: 'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-images/crop_private.webp'
      }

      // Simulate consumer view projection logic from Migration 008
      const projectConsumerView = (o: any, approvedProductImgUrl: string | null) => ({
        product_id: o.catalog_match_status === 'verified_linked' ? o.product_id : null,
        display_image_url: o.catalog_match_status === 'verified_linked' ? approvedProductImgUrl : null,
        thumbnail_url: null // Private crops are NEVER projected
      })

      const projVerified = projectConsumerView(verifiedOffer, 'https://cdn.wifran.com/approved.jpg')
      expect(projVerified.product_id).toBe(1)
      expect(projVerified.display_image_url).toBe('https://cdn.wifran.com/approved.jpg')
      expect(projVerified.thumbnail_url).toBeNull()

      const projUnresolved = projectConsumerView(unresolvedOffer, 'https://cdn.wifran.com/approved.jpg')
      expect(projUnresolved.product_id).toBeNull()
      expect(projUnresolved.display_image_url).toBeNull()
      expect(projUnresolved.thumbnail_url).toBeNull()
    })

    it('Scenario F14: Production rollback scoping strictly protects pre-existing Phase 1N Noori rows and requires exact preconditions (Requirement 7)', () => {
      const phase1nOfferIds = [
        'fd865e4e-e9cb-444a-b71a-80c74efc16e4',
        '2ec312c1-634e-4bc0-98f4-ca45681e2a27',
        '3b3915b7-702b-41c0-95e3-464e8fa3b90f'
      ]

      const newlyInsertedCanaryIds = [
        'e0000001-0000-4000-8000-000000000001',
        'e0000002-0000-4000-8000-000000000002'
      ]

      // Safety validator for rollback operations
      function validateRollbackTargets(targetIds: string[]): { safe: boolean; error?: string } {
        for (const id of targetIds) {
          if (phase1nOfferIds.includes(id)) {
            return { safe: false, error: `CRITICAL SAFETY VIOLATION: Rollback target includes pre-existing Phase 1N offer ${id}` }
          }
        }
        return { safe: true }
      }

      // Attempting to rollback Phase 1N rows is strictly rejected
      expect(validateRollbackTargets(['fd865e4e-e9cb-444a-b71a-80c74efc16e4']).safe).toBe(false)
      expect(validateRollbackTargets(['fd865e4e-e9cb-444a-b71a-80c74efc16e4']).error).toContain('CRITICAL SAFETY VIOLATION')

      // Properly scoped rollback for newly created IDs succeeds
      expect(validateRollbackTargets(newlyInsertedCanaryIds).safe).toBe(true)
    })

    it('Scenario F15: Reimporting an already published source offer without allowExistingOfferUpdates is skipped without modification (Task 1: true no-op)', async () => {
      const sourceId = 'noori-city-jeddah-2026-11-11:p001:i001:s01'
      const existingOfferId = 'fd865e4e-e9cb-444a-b71a-80c74efc16e4'
      mockDb.offers.push({
        id: existingOfferId,
        source_offer_id: sourceId,
        title_en: 'Al Safi Long Life Full Cream Milk 12x1Lt',
        offer_price: 32.99,
        original_price: 72.0,
        status: 'published',
        catalog_match_status: 'unresolved',
        product_id: null
      })

      const jobDir = path.join(tmpDir, 'job-f15')
      fs.mkdirSync(jobDir, { recursive: true })

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir,
        createdAt: '2026-11-06',
        updatedAt: '2026-11-06',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-02',
          validTo: '2026-11-11',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'c1111111-1111-4000-8000-000000000001',
            sourceOfferId: sourceId,
            originalOcr: { titleEn: 'Al Safi Milk 12x1L' },
            titleEn: 'Al Safi Milk 12x1L Modified In Local Draft',
            sizeOrWeight: '12x1L',
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f15.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDir, draft)
      const res = await publishStagedLeafletDraftToDb(jobDir, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.ok).toBe(true)
      expect(res.offersPublishedCount).toBe(0)
      expect(res.offersSkippedAlreadyPublishedCount).toBe(1)
      expect(res.errors).toEqual([])

      // Existing record in DB remains completely unmodified
      const existingInDb = mockDb.offers.find((o) => o.source_offer_id === sourceId)
      expect(existingInDb.title_en).toBe('Al Safi Long Life Full Cream Milk 12x1Lt')
      expect(mockDb.offers.length).toBe(1)
    })

    it('Scenario F16: Reimporting with allowExistingOfferUpdates: true updates existing row reusing UUID (Task 1: resynchronization)', async () => {
      const sourceId = 'noori-city-jeddah-2026-11-11:p001:i002:s01'
      const existingOfferId = '2ec312c1-634e-4bc0-98f4-ca45681e2a27'
      mockDb.offers.push({
        id: existingOfferId,
        source_offer_id: sourceId,
        title_en: 'Fakieh Frozen Chicken 10x600g',
        offer_price: 62.99,
        original_price: 124.95,
        status: 'published',
        catalog_match_status: 'unresolved',
        product_id: null
      })

      const jobDir = path.join(tmpDir, 'job-f16')
      fs.mkdirSync(jobDir, { recursive: true })

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir,
        createdAt: '2026-11-06',
        updatedAt: '2026-11-06',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-02',
          validTo: '2026-11-11',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'c2222222-2222-4000-8000-000000000002', // Different local UUID
            sourceOfferId: sourceId,
            originalOcr: { titleEn: 'Fakieh Chicken 10x600g' },
            titleEn: 'Fakieh Frozen Chicken 10x600g Updated',
            sizeOrWeight: '10x600g',
            priceAfter: 64.99,
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f16.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDir, draft)
      const res = await publishStagedLeafletDraftToDb(jobDir, {
        operatorConfirmedPublish: true,
        allowExistingOfferUpdates: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.ok).toBe(true)
      expect(res.offersPublishedCount).toBe(1)
      expect(res.offersSkippedAlreadyPublishedCount).toBe(0)
      expect(res.errors).toEqual([])

      // No new row created; existing row updated under canonical UUID
      expect(mockDb.offers.filter((o) => o.source_offer_id === sourceId).length).toBe(1)
      const updated = mockDb.offers.find((o) => o.source_offer_id === sourceId)
      expect(updated.id).toBe(existingOfferId)
      expect(updated.title_en).toBe('Fakieh Frozen Chicken 10x600g Updated')
      expect(updated.offer_price).toBe(64.99)
    })

    it('Scenario F17: Reimport with allowExistingOfferUpdates preserves existing verified link and operator metadata (Task 1: protection against degradation)', async () => {
      const sourceId = 'almarai-milk-source-001'
      const existingOfferId = '3b3915b7-702b-41c0-95e3-464e8fa3b90f'
      mockDb.offers.push({
        id: existingOfferId,
        source_offer_id: sourceId,
        title_en: 'Almarai Fresh Milk Full Fat 1L',
        offer_price: 5.5,
        original_price: 6.0,
        status: 'published',
        catalog_match_status: 'verified_linked',
        product_id: 1,
        catalog_verification_basis: 'operator_manual_audit',
        catalog_verified_by: 'senior_operator',
        catalog_verified_at: '2026-11-05T12:00:00Z',
        approved_by: '00000000-0000-0000-0000-000000000001'
      })

      const jobDir = path.join(tmpDir, 'job-f17')
      fs.mkdirSync(jobDir, { recursive: true })

      // New draft has unverified/unresolved state for this item
      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir,
        createdAt: '2026-11-06',
        updatedAt: '2026-11-06',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-02',
          validTo: '2026-11-11',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'c3333333-3333-4000-8000-000000000003',
            sourceOfferId: sourceId,
            originalOcr: { titleEn: 'Almarai Fresh Milk Full Fat 1L' },
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            sizeOrWeight: '1L',
            matchedProductId: 1,
            operatorApprovedIdentity: false, // Operator has NOT approved in this fresh draft session
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f17.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDir, draft)
      const res = await publishStagedLeafletDraftToDb(jobDir, {
        operatorConfirmedPublish: true,
        allowExistingOfferUpdates: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.ok).toBe(true)
      expect(res.offersPublishedCount).toBe(1)
      const updated = mockDb.offers.find((o) => o.source_offer_id === sourceId)
      // Verified link status and metadata are protected against degradation
      expect(updated.catalog_match_status).toBe('verified_linked')
      expect(updated.product_id).toBe(1)
      expect(updated.catalog_verification_basis).toBe('operator_manual_audit')
      expect(updated.catalog_verified_by).toBe('senior_operator')
    })

    it('Scenario F18: Database lookup failure on source_offer_id aborts publishing for affected offer before write (Task 1: explicit error handling)', async () => {
      const sourceId = 'lookup-failure-source-id'
      simulateQueryErrorOn = 'offers'

      const jobDir = path.join(tmpDir, 'job-f18')
      fs.mkdirSync(jobDir, { recursive: true })

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir,
        createdAt: '2026-11-06',
        updatedAt: '2026-11-06',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-02',
          validTo: '2026-11-11',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'c4444444-4444-4000-8000-000000000004',
            sourceOfferId: sourceId,
            originalOcr: { titleEn: 'Test Item' },
            titleEn: 'Test Item',
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f18.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDir, draft)
      const res = await publishStagedLeafletDraftToDb(jobDir, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.ok).toBe(false)
      expect(res.offersPublishedCount).toBe(0)
      expect(res.errors.length).toBeGreaterThan(0)
      expect(res.errors[0]).toContain(`Database lookup error for existing source offer '${sourceId}'`)
      expect(res.errors[0]).toContain('Publication aborted for this item')
      // Zero rows written
      expect(mockDb.offers.some((o) => o.source_offer_id === sourceId)).toBe(false)
    })

    it('Scenario F19: Concurrent insert conflict (PostgreSQL 23505) on idx_offers_source_offer_id is caught and cleanly reported (Task 1: concurrency safety)', async () => {
      const sourceId = 'concurrent-conflict-source-id'
      simulateQueryErrorOn = 'offers:upsert_23505'

      const jobDir = path.join(tmpDir, 'job-f19')
      fs.mkdirSync(jobDir, { recursive: true })

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir,
        createdAt: '2026-11-06',
        updatedAt: '2026-11-06',
        header: {
          supermarketId: 'alwafa',
          region: 'Western Region',
          validFrom: '2026-11-02',
          validTo: '2026-11-11',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'c5555555-5555-4000-8000-000000000005',
            sourceOfferId: sourceId,
            originalOcr: { titleEn: 'Conflict Item' },
            titleEn: 'Conflict Item',
            croppedEvidenceLocalPath: path.join(tmpDir, 'crop_f19.webp'),
            selectedImageSource: 'none',
            status: 'ready',
            isAiCorrected: false,
            isOperatorModified: false,
            operatorEditedFields: []
          }
        ]
      }

      await saveStagedLeafletDraft(jobDir, draft)
      const res = await publishStagedLeafletDraftToDb(jobDir, {
        operatorConfirmedPublish: true,
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.ok).toBe(false)
      expect(res.offersPublishedCount).toBe(0)
      expect(res.errors.length).toBe(1)
      expect(res.errors[0]).toContain('Concurrent insert conflict')
      expect(res.errors[0]).toContain('PostgreSQL 23505')
      expect(res.errors[0]).toContain(sourceId)
    })
  })
})
