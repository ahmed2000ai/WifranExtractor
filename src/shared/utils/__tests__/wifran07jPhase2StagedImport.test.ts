import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  importStep2CsvIntoStagedDraft,
  updateStagedLeafletHeader,
  updateStagedOfferField,
  revertStagedOfferField,
  replaceStagedOfferConsumerImage,
  loadStagedLeafletDraft,
  saveStagedLeafletDraft,
  resolveOrCreateSupermarket,
  resolveOrCreateRegion
} from '../../../main/db/productImageEnrichmentService'
import type { StagedLeafletDraft, StagedOfferItem } from '../../../shared/types/productImageEnrichment'

const validPngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
])

const validWebpBuffer = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
  0x0e, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe,
  0x07, 0x00
])

describe('WIFRAN-07J Phase 2: Ingest Step 2 CSV, AI Corrections, DB Re-Match, Local Download & Inline Edits', () => {
  let tmpDir: string
  let testMapPath: string

  let mockDb: {
    products: Map<number, any>
    product_aliases: any[]
    offer_display_images: any[]
    supermarkets: any[]
    regions: any[]
    removedTmpPaths: string[]
  }

  let mockSupabase: any

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-phase2-test-'))
    testMapPath = path.join(tmpDir, 'test-offer-map.json')

    mockDb = {
      products: new Map(),
      product_aliases: [],
      offer_display_images: [],
      supermarkets: [
        {
          id: 'c2cc16c2-0001-4444-b000-c00000000001',
          slug: 'panda',
          name_en: 'Panda',
          name_ar: 'بنده'
        }
      ],
      regions: [
        {
          id: 'b144b6c8-2222-4444-b000-000000000002',
          slug: 'western',
          name_en: 'Western Region',
          name_ar: 'المنطقة الغربية'
        },
        {
          id: 'a6f7b140-0002-4444-a000-000000000002',
          slug: 'jeddah',
          name_en: 'Jeddah',
          name_ar: 'جدة'
        }
      ],
      removedTmpPaths: []
    }

    // Seed mock verified products
    // P6: L'Oreal shampoo (Target for post-correction typo fix)
    mockDb.products.set(6, {
      id: 6,
      name_en: "L'Oreal Elvive Shampoo 400ml",
      name_ar: 'لوريال الفيف شامبو ٤٠٠ مل',
      slug: 'loreal-elvive-shampoo-400ml',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/loreal-400ml.webp',
      approved_primary_image_id: 'img-p6',
      verification_status: 'verified'
    })

    // Alias for P6
    mockDb.product_aliases.push({
      product_id: 6,
      alias_text: 'لوريال شامبو ٤٠٠ مل'
    })

    mockSupabase = {
      from: vi.fn((table: string) => {
        let filters: any[] = []

        const queryObj: any = {
          select: vi.fn(() => queryObj),
          eq: vi.fn((col: string, val: any) => {
            filters.push({ col, op: 'eq', val })
            return queryObj
          }),
          ilike: vi.fn((col: string, val: any) => {
            filters.push({ col, op: 'ilike', val })
            return queryObj
          }),
          limit: vi.fn(() => queryObj),
          maybeSingle: vi.fn(async () => {
            const { data } = await queryObj
            return { data: data && data.length > 0 ? data[0] : null, error: null }
          }),
          insert: vi.fn(async (payload: any) => {
            const records = Array.isArray(payload) ? payload : [payload]
            for (const r of records) {
              const rec = { ...r, id: r.id || crypto.randomUUID() }
              if (table === 'supermarkets') mockDb.supermarkets.push(rec)
              if (table === 'regions') mockDb.regions.push(rec)
            }
            return { data: records, error: null }
          }),
          upsert: vi.fn(async (payload: any) => {
            const records = Array.isArray(payload) ? payload : [payload]
            for (const r of records) {
              const rec = { ...r, id: r.id || crypto.randomUUID() }
              if (table === 'supermarkets') {
                const idx = mockDb.supermarkets.findIndex((s) => s.slug === rec.slug || s.id === rec.id)
                if (idx !== -1) mockDb.supermarkets[idx] = rec
                else mockDb.supermarkets.push(rec)
              }
              if (table === 'regions') {
                const idx = mockDb.regions.findIndex((s) => s.slug === rec.slug || s.id === rec.id)
                if (idx !== -1) mockDb.regions[idx] = rec
                else mockDb.regions.push(rec)
              }
            }
            return { data: records, error: null }
          }),
          then: (resolve: any) => {
            let records: any[] = []
            if (table === 'products') records = Array.from(mockDb.products.values())
            if (table === 'product_aliases') records = [...mockDb.product_aliases]
            if (table === 'supermarkets') records = [...mockDb.supermarkets]
            if (table === 'regions') records = [...mockDb.regions]

            const filtered = records.filter((r) => {
              for (const f of filters) {
                if (f.op === 'eq' && r[f.col] !== f.val) return false
                if (f.op === 'ilike') {
                  const target = String(r[f.col] || '').toLowerCase()
                  const pattern = String(f.val || '').replace(/%/g, '').toLowerCase()
                  if (!target.includes(pattern)) return false
                }
              }
              return true
            })

            resolve({ data: filtered, error: null })
          }
        }
        return queryObj
      }),
      storage: {
        from: vi.fn((_bucket: string) => ({
          remove: vi.fn(async (paths: string[]) => {
            mockDb.removedTmpPaths.push(...paths)
            return { data: paths, error: null }
          })
        }))
      }
    }

    // Mock fetch for image downloads
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const u = String(url)
      if (u.includes('not-found')) {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' })
      }
      if (u.includes('invalid-magic')) {
        return new Response('<html>Fake</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        })
      }
      if (u.endsWith('.png')) {
        return new Response(validPngBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        })
      }
      return new Response(validWebpBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/webp' }
      })
    })
  })

  describe('1. Step 2 CSV Ingestion, 2-Column Format & Deduplicated Resolution', () => {
    it('Cleanly ignores legacy FPTSP/LPTSP/SMN/REG/SD/ED rows, does not mutate header or delete tmp pages, and stages candidate image', async () => {
      const initialDraft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        leafletHash: 'hash-abc',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: {
          supermarketId: null,
          region: null,
          validFrom: null,
          validTo: null,
          firstPagePublicUrl: 'https://storage.wifran.com/tmp/hash-abc_first.png',
          lastPagePublicUrl: 'https://storage.wifran.com/tmp/hash-abc_last.png',
          firstPageTmpPath: 'hash-abc_first.png',
          lastPageTmpPath: 'hash-abc_last.png',
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'offer-item-1',
            imageRef: 'O1',
            originalOcr: { titleEn: 'Sample Item' },
            titleEn: 'Sample Item',
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/1.webp',
            selectedImageSource: 'none'
          }
        ]
      }
      await saveStagedLeafletDraft(tmpDir, initialDraft)

      // Legacy 2-column CSV containing deprecated boundary/metadata rows
      const csv = `Image_Ref,image_url
O1,https://example.com/candidate-item.png
FPTSP,https://storage.wifran.com/tmp/hash-abc_first.png
LPTSP,https://storage.wifran.com/tmp/hash-abc_last.png
SMN,Hyper Panda
REG,Jeddah City
SD,2026-11-01
ED,2026-11-07
`
      const res = await importStep2CsvIntoStagedDraft(tmpDir, csv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      expect(res.errors).toEqual([])
      expect(res.ignoredLegacyRowsCount).toBe(6)
      expect(res.metadataUpdated).toEqual({})

      // Candidate image downloaded
      expect(res.candidateImagesDownloadedCount).toBe(1)
      const draft = await loadStagedLeafletDraft(tmpDir)
      // Header metadata untouched by legacy CSV rows (Stage 2 remains authoritative)
      expect(draft?.header.supermarketId).toBeNull()
      expect(draft?.header.region).toBeNull()
      expect(draft?.header.validFrom).toBeNull()
      expect(draft?.header.validTo).toBeNull()
      expect((draft?.items[0] as any).validFrom).toBeUndefined()
      expect((draft?.items[0] as any).validTo).toBeUndefined()

      // Historical 'tmp' paths are NOT automatically deleted
      expect(mockDb.removedTmpPaths).toEqual([])
      expect(draft?.header.firstPageTmpPath).toBe('hash-abc_first.png')
      expect(draft?.header.lastPageTmpPath).toBe('hash-abc_last.png')
    })

    it('Detects incomplete Stage 2 header metadata even when legacy CSV supplies REG/ED, while staging candidate images cleanly', async () => {
      const initialDraft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        leafletHash: 'hash-missing-meta',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: {
          supermarketId: null,
          region: null,
          validFrom: null,
          validTo: null,
          headerModifiedByOperator: false
        },
        items: [
          {
            id: 'offer-missing-meta-1',
            imageRef: 'O1',
            originalOcr: { titleEn: 'Missing Meta Shampoo' },
            titleEn: 'Missing Meta Shampoo',
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/shampoo.webp',
            selectedImageSource: 'none'
          }
        ]
      }
      await saveStagedLeafletDraft(tmpDir, initialDraft)

      // Legacy CSV containing REG and ED (must be ignored safely without mutating header)
      const csv = `Image_Ref,image_url
O1,https://example.com/shampoo-candidate.png
REG,Jeddah
ED,2026-11-20
`
      const res = await importStep2CsvIntoStagedDraft(tmpDir, csv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      expect(res.errors).toEqual([])
      expect(res.ignoredLegacyRowsCount).toBe(2)

      // Metadata completeness checks reflect Stage 2 draft.header (not legacy CSV rows)
      expect(res.missingMetadata).toBe(true)
      expect(res.missingFields).toEqual(expect.arrayContaining(['supermarket', 'region', 'validFrom', 'validTo']))
      expect(res.requiresOperatorMetadataConfirmation).toBe(true)
      expect(res.validationWarnings).toBeDefined()
      expect(res.validationWarnings?.some((w) => w.includes('Supermarket'))).toBe(true)
      expect(res.validationWarnings?.some((w) => w.includes('Start Date'))).toBe(true)
      expect(res.validationWarnings?.some((w) => w.includes('Legacy metadata/boundary row'))).toBe(true)

      // Still successfully downloaded and staged the candidate image
      expect(res.candidateImagesDownloadedCount).toBe(1)
      const updatedDraft = await loadStagedLeafletDraft(tmpDir)
      expect(updatedDraft?.items[0].candidateImageUrl).toBe('https://example.com/shampoo-candidate.png')
      expect(updatedDraft?.items[0].selectedImageSource).toBe('candidate')
      expect(updatedDraft?.header.region).toBeNull()
      expect(updatedDraft?.header.validTo).toBeNull()
    })

    it('Resolves slight variations in SMN (Hyper Panda, أسواق بنده, Panda Supermarket) to identical existing supermarket without creating duplicates', async () => {
      const res1 = await resolveOrCreateSupermarket('Hyper Panda', { supabaseClient: mockSupabase })
      const res2 = await resolveOrCreateSupermarket('أسواق بنده', { supabaseClient: mockSupabase })
      const res3 = await resolveOrCreateSupermarket('Panda Supermarket', { supabaseClient: mockSupabase })

      expect(res1.id).toBe('c2cc16c2-0001-4444-b000-c00000000001')
      expect(res2.id).toBe('c2cc16c2-0001-4444-b000-c00000000001')
      expect(res3.id).toBe('c2cc16c2-0001-4444-b000-c00000000001')
      expect(res1.isNew).toBe(false)
      expect(res2.isNew).toBe(false)
      expect(res3.isNew).toBe(false)

      // Ensure no duplicate supermarkets were inserted into DB
      const pandaRecords = mockDb.supermarkets.filter((s) => s.slug === 'panda')
      expect(pandaRecords).toHaveLength(1)
    })

    it('Resolves slight variations in REG (Jeddah City, مدينة جدة) to identical existing region without creating duplicates', async () => {
      const res1 = await resolveOrCreateRegion('Jeddah City', { supabaseClient: mockSupabase })
      const res2 = await resolveOrCreateRegion('مدينة جدة', { supabaseClient: mockSupabase })

      expect(res1.id).toBe('a6f7b140-0002-4444-a000-000000000002')
      expect(res2.id).toBe('a6f7b140-0002-4444-a000-000000000002')
      expect(res1.isNew).toBe(false)
      expect(res2.isNew).toBe(false)

      const jeddahRecords = mockDb.regions.filter((r) => r.slug === 'jeddah')
      expect(jeddahRecords).toHaveLength(1)
    })

    it('Genuinely brand-new supermarket and region creates a single clean DB record and reuses on variation', async () => {
      const sm1 = await resolveOrCreateSupermarket('Al Ahlam Hypermarket', { supabaseClient: mockSupabase })
      expect(sm1.isNew).toBe(true)
      expect(sm1.slug).toBe('al-ahlam')

      // Second call with Arabic variation resolves to the same record
      const sm2 = await resolveOrCreateSupermarket('سوق الأحلام', { supabaseClient: mockSupabase })
      expect(sm2.id).toBe(sm1.id)
      expect(sm2.isNew).toBe(false)

      const reg1 = await resolveOrCreateRegion('Neom Province', { supabaseClient: mockSupabase })
      expect(reg1.isNew).toBe(true)
      expect(reg1.slug).toBe('neom')

      const reg2 = await resolveOrCreateRegion('منطقة نيوم', { supabaseClient: mockSupabase })
      expect(reg2.id).toBe(reg1.id)
      expect(reg2.isNew).toBe(false)
    })

    it('Applies AI text corrections from pipe-separated column 2 ("Corrected Title|https://...") and re-matches catalog', async () => {
      const item: StagedOfferItem = {
        id: 'offer-typo-shampoo',
        imageRef: 'O1',
        originalOcr: {
          titleEn: 'Loreal Shampoo',
          titleAr: 'رويال شامبو' // Typo: رويال instead of لوريال
        },
        titleEn: 'Loreal Shampoo',
        titleAr: 'رويال شامبو',
        isAiCorrected: false,
        operatorEditedFields: [],
        isOperatorModified: false,
        croppedEvidenceLocalPath: '/crops/shampoo.webp',
        selectedImageSource: 'none'
      }

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: { headerModifiedByOperator: false },
        items: [item]
      }
      await saveStagedLeafletDraft(tmpDir, draft)

      // Col 2 contains pipe: "Corrected Title EN | Corrected Title AR | https://..."
      const csv = `Image_Ref,image_url
O1,"L'Oreal Elvive Shampoo 400ml | لوريال الفيف شامبو ٤٠٠ مل|https://example.com/loreal-correct.png"
`
      const res = await importStep2CsvIntoStagedDraft(tmpDir, csv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      expect(res.aiCorrectedCount).toBe(1)
      expect(res.postCorrectionDbMatchCount).toBe(1)

      const updatedDraft = await loadStagedLeafletDraft(tmpDir)
      const updatedItem = updatedDraft?.items[0]
      expect(updatedItem?.isAiCorrected).toBe(true)
      expect(updatedItem?.titleAr).toBe('لوريال الفيف شامبو ٤٠٠ مل')
      expect(updatedItem?.postCorrectionDbMatch?.productId).toBe(6)
      expect(updatedItem?.selectedImageSource).toBe('existing_db')
    })

    it('Ignores legacy M_ metadata and M_PAGE_* rows safely without mutating header or fetching page URLs', async () => {
      const initialDraft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        leafletHash: 'hash-abc',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: {
          supermarketId: null,
          region: null,
          validFrom: null,
          validTo: null,
          firstPagePublicUrl: 'https://storage.wifran.com/first.png',
          lastPagePublicUrl: 'https://storage.wifran.com/last.png',
          headerModifiedByOperator: false
        },
        items: []
      }
      await saveStagedLeafletDraft(tmpDir, initialDraft)

      // CSV with legacy M_ metadata values in different columns
      const csv = `Image_Ref,Title_EN,Title_AR,Brand,Size_Or_Weight,image_url
M_PAGE_FIRST,,,,"https://storage.wifran.com/first.png"
M_PAGE_LAST,,,,"https://storage.wifran.com/last.png"
M_SUPERMARKET_ID,"alwafa",,,,
M_REGION,,,,,"Western"
M_VALID_FROM,"2026-11-01",,,,
M_VALID_TO,,,,,"2026-11-07"
`
      const res = await importStep2CsvIntoStagedDraft(tmpDir, csv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      expect(res.errors).toEqual([])
      expect(res.ignoredLegacyRowsCount).toBe(6)
      expect(res.candidateImagesDownloadedCount).toBe(0)
      expect(res.metadataUpdated).toEqual({})

      const draft = await loadStagedLeafletDraft(tmpDir)
      expect(draft?.header.supermarketId).toBeNull()
      expect(draft?.header.region).toBeNull()
      expect(draft?.header.validFrom).toBeNull()
      expect(draft?.header.validTo).toBeNull()
      // Page URLs must remain unchanged
      expect(draft?.header.firstPagePublicUrl).toBe('https://storage.wifran.com/first.png')
    })
  })

  describe('2. AI Text Corrections & Operator Lock', () => {
    it('Detects text corrections, updates working fields, and preserves originalOcr snapshot', async () => {
      const item: StagedOfferItem = {
        id: 'offer-1',
        imageRef: 'O1',
        originalOcr: {
          titleEn: 'Krypton Flashlight',
          titleAr: 'كربتون كشاف',
          brand: 'Krypton',
          sizeOrWeight: ''
        },
        titleEn: 'Krypton Flashlight',
        titleAr: 'كربتون كشاف',
        brand: 'Krypton',
        sizeOrWeight: '',
        isAiCorrected: false,
        operatorEditedFields: [],
        isOperatorModified: false,
        croppedEvidenceLocalPath: '/crops/torch.webp',
        selectedImageSource: 'none'
      }

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: { headerModifiedByOperator: false },
        items: [item]
      }
      await saveStagedLeafletDraft(tmpDir, draft)

      const csv = `Image_Ref,Title_EN,Title_AR,Brand,Size_Or_Weight,image_url
"O1","Krypton Zoomable LED Flashlight","كربتون كشاف ليد قابل للتكبير","Krypton","1 Pc","https://example.com/torch.png"
`
      const res = await importStep2CsvIntoStagedDraft(tmpDir, csv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      expect(res.aiCorrectedCount).toBe(1)
      const updatedDraft = await loadStagedLeafletDraft(tmpDir)
      const itm = updatedDraft?.items[0]!

      expect(itm.isAiCorrected).toBe(true)
      expect(itm.aiCorrected?.titleEn).toBe('Krypton Zoomable LED Flashlight')
      expect(itm.titleEn).toBe('Krypton Zoomable LED Flashlight')
      expect(itm.titleAr).toBe('كربتون كشاف ليد قابل للتكبير')
      expect(itm.sizeOrWeight).toBe('1 Pc')

      // originalOcr remains intact!
      expect(itm.originalOcr.titleEn).toBe('Krypton Flashlight')
    })

    it('Respects operatorEditedFields and does not overwrite operator-modified fields with AI suggestions', async () => {
      const item: StagedOfferItem = {
        id: 'offer-locked',
        imageRef: 'O1',
        originalOcr: {
          titleEn: 'Original English',
          titleAr: 'العنوان الأصلي'
        },
        titleEn: 'Operator Locked Title',
        titleAr: 'العنوان الأصلي',
        isAiCorrected: false,
        operatorEditedFields: ['titleEn'],
        isOperatorModified: true,
        croppedEvidenceLocalPath: '/crops/1.webp',
        selectedImageSource: 'none'
      }

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: { headerModifiedByOperator: false },
        items: [item]
      }
      await saveStagedLeafletDraft(tmpDir, draft)

      const csv = `Image_Ref,Title_EN,Title_AR,Brand,Size_Or_Weight,image_url
"O1","AI Proposed English Title","العنوان المقترح من الذكاء","Brand","1L",""
`
      await importStep2CsvIntoStagedDraft(tmpDir, csv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      const updatedDraft = await loadStagedLeafletDraft(tmpDir)
      const itm = updatedDraft?.items[0]!

      // Operator title was protected!
      expect(itm.titleEn).toBe('Operator Locked Title')
      // AI title stored in aiCorrected snapshot
      expect(itm.aiCorrected?.titleEn).toBe('AI Proposed English Title')
      // Non-locked fields updated
      expect(itm.titleAr).toBe('العنوان المقترح من الذكاء')
    })
  })

  describe('3. Post-Correction Read-Only DB Re-Match (Typo Resolution)', () => {
    it('Detects when corrected text newly matches a verified DB product with an existing image, staging candidate image for preview', async () => {
      // Offer initially had typo "رويال" (Royal) instead of "لوريال" (L'Oreal) -> unmatched (O1)
      const item: StagedOfferItem = {
        id: 'offer-loreal',
        imageRef: 'O1',
        originalOcr: {
          titleEn: 'Royal Elvive Shampoo 400ml',
          titleAr: 'رويال الفيف شامبو ٤٠٠ مل',
          brand: 'Royal',
          sizeOrWeight: '400ml'
        },
        titleEn: 'Royal Elvive Shampoo 400ml',
        titleAr: 'رويال الفيف شامبو ٤٠٠ مل',
        brand: 'Royal',
        sizeOrWeight: '400ml',
        isAiCorrected: false,
        operatorEditedFields: [],
        isOperatorModified: false,
        croppedEvidenceLocalPath: '/crops/loreal.webp',
        selectedImageSource: 'none'
      }

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: { headerModifiedByOperator: false },
        items: [item]
      }
      await saveStagedLeafletDraft(tmpDir, draft)

      // Step 2 fixes the spelling to "لوريال الفيف شامبو ٤٠٠ مل"
      const csv = `Image_Ref,Title_EN,Title_AR,Brand,Size_Or_Weight,image_url
"O1","L'Oreal Elvive Shampoo 400ml","لوريال الفيف شامبو ٤٠٠ مل","L'Oreal","400ml","https://example.com/loreal.webp"
`
      const res = await importStep2CsvIntoStagedDraft(tmpDir, csv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      expect(res.postCorrectionDbMatchCount).toBe(1)
      expect(res.candidateImagesDownloadedCount).toBe(1)

      const updatedDraft = await loadStagedLeafletDraft(tmpDir)
      const itm = updatedDraft?.items[0]!

      // Matched DB product 6
      expect(itm.postCorrectionDbMatch).toBeDefined()
      expect(itm.postCorrectionDbMatch?.productId).toBe(6)
      expect(itm.postCorrectionDbMatch?.existingImageUrl).toBe('https://storage.wifran.com/product-images/catalog/loreal-400ml.webp')

      // Selected source defaults to existing_db, but candidate image is also staged locally for 1-click preview
      expect(itm.selectedImageSource).toBe('existing_db')
      expect(itm.existingDbImageUrl).toBe('https://storage.wifran.com/product-images/catalog/loreal-400ml.webp')
      expect(itm.candidateImageLocalPath).toBeDefined()
      expect(fs.existsSync(itm.candidateImageLocalPath!)).toBe(true)
    })
  })

  describe('4. Candidate Image Local Download & Error Capture', () => {
    it('Saves image to staged-candidate-images, deduplicates across batch, and captures download errors gracefully', async () => {
      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: { headerModifiedByOperator: false },
        items: [
          {
            id: 'item-good-1',
            imageRef: 'O1',
            originalOcr: { titleEn: 'Good 1' },
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/1.webp',
            selectedImageSource: 'none'
          },
          {
            id: 'item-good-2',
            imageRef: 'O2',
            originalOcr: { titleEn: 'Good 2' },
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/2.webp',
            selectedImageSource: 'none'
          },
          {
            id: 'item-bad-404',
            imageRef: 'O3',
            originalOcr: { titleEn: 'Bad 404' },
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/3.webp',
            selectedImageSource: 'none'
          }
        ]
      }
      await saveStagedLeafletDraft(tmpDir, draft)

      // Rows O1 and O2 share the exact same image URL -> deduplicated in-memory!
      // Row O3 points to 404 URL -> captures error without crashing
      const csv = `Image_Ref,Title_EN,Title_AR,Brand,Size_Or_Weight,image_url
"O1","Good 1","","","","https://example.com/torch.png"
"O2","Good 2","","","","https://example.com/torch.png"
"O3","Bad 404","","","","https://example.com/not-found.jpg"
`
      const res = await importStep2CsvIntoStagedDraft(tmpDir, csv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      expect(res.candidateImagesDownloadedCount).toBe(1)
      expect(res.candidateImagesReusedCount).toBe(1)
      expect(res.candidateImagesFailedCount).toBe(1)

      const updatedDraft = await loadStagedLeafletDraft(tmpDir)
      const itm1 = updatedDraft?.items.find((i) => i.id === 'item-good-1')!
      const itm2 = updatedDraft?.items.find((i) => i.id === 'item-good-2')!
      const itm3 = updatedDraft?.items.find((i) => i.id === 'item-bad-404')!

      // Items 1 & 2 share downloaded binary
      expect(itm1.candidateImageLocalPath).toBe(itm2.candidateImageLocalPath)
      expect(fs.existsSync(itm1.candidateImageLocalPath!)).toBe(true)
      expect(itm1.selectedImageSource).toBe('candidate')

      // Item 3 captures error
      expect(itm3.candidateDownloadError).toContain('HTTP fetch failed: 404')
      expect(itm3.selectedImageSource).toBe('none')
    })
  })

  describe('5. Operator Inline Edit, Revert & Image Replacement Services', () => {
    it('Recalculates discount percentage automatically when priceBefore or priceAfter changes', async () => {
      const item: StagedOfferItem = {
        id: 'offer-price',
        originalOcr: {
          titleEn: 'Item',
          priceBefore: 20,
          priceAfter: 15,
          discountPercent: 25
        },
        priceBefore: 20,
        priceAfter: 15,
        discountPercent: 25,
        isAiCorrected: false,
        operatorEditedFields: [],
        isOperatorModified: false,
        croppedEvidenceLocalPath: '/crops/p.webp',
        selectedImageSource: 'none'
      }

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: { headerModifiedByOperator: false },
        items: [item]
      }
      await saveStagedLeafletDraft(tmpDir, draft)

      // Operator updates priceBefore to 30, priceAfter to 15 -> (30 - 15) / 30 = 50% discount
      const updatedDraft = await updateStagedOfferField(tmpDir, 'offer-price', {
        priceBefore: 30
      })

      const itm = updatedDraft.items[0]
      expect(itm.priceBefore).toBe(30)
      expect(itm.discountPercent).toBe(50)
      expect(itm.operatorEditedFields).toContain('priceBefore')
      expect(itm.isOperatorModified).toBe(true)
    })

    it('Reverts specific fields back to aiCorrected or originalOcr snapshot', async () => {
      const item: StagedOfferItem = {
        id: 'offer-revert',
        originalOcr: {
          titleEn: 'Original Title',
          brand: 'Original Brand'
        },
        aiCorrected: {
          titleEn: 'AI Title'
        },
        isAiCorrected: true,
        titleEn: 'Operator Edited Title',
        brand: 'Operator Edited Brand',
        operatorEditedFields: ['titleEn', 'brand'],
        isOperatorModified: true,
        croppedEvidenceLocalPath: '/crops/r.webp',
        selectedImageSource: 'none'
      }

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: { headerModifiedByOperator: false },
        items: [item]
      }
      await saveStagedLeafletDraft(tmpDir, draft)

      // Revert titleEn -> reverts to aiCorrected ('AI Title')
      await revertStagedOfferField(tmpDir, 'offer-revert', 'titleEn')
      let loaded = await loadStagedLeafletDraft(tmpDir)
      expect(loaded?.items[0].titleEn).toBe('AI Title')
      expect(loaded?.items[0].operatorEditedFields).toEqual(['brand'])
      expect(loaded?.items[0].isOperatorModified).toBe(true)

      // Revert brand -> reverts to originalOcr ('Original Brand')
      await revertStagedOfferField(tmpDir, 'offer-revert', 'brand')
      loaded = await loadStagedLeafletDraft(tmpDir)
      expect(loaded?.items[0].brand).toBe('Original Brand')
      expect(loaded?.items[0].operatorEditedFields).toEqual([])
      expect(loaded?.items[0].isOperatorModified).toBe(false)
    })

    it('Replaces consumer image with custom local file or URL', async () => {
      // Create a local custom image
      const customImgPath = path.join(tmpDir, 'custom.png')
      fs.writeFileSync(customImgPath, validPngBuffer)

      const item: StagedOfferItem = {
        id: 'offer-img-swap',
        originalOcr: { titleEn: 'Swap' },
        isAiCorrected: false,
        operatorEditedFields: [],
        isOperatorModified: false,
        croppedEvidenceLocalPath: '/crops/s.webp',
        selectedImageSource: 'none'
      }

      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: { headerModifiedByOperator: false },
        items: [item]
      }
      await saveStagedLeafletDraft(tmpDir, draft)

      const updated = await replaceStagedOfferConsumerImage(tmpDir, 'offer-img-swap', {
        mode: 'custom_local',
        localFilePath: customImgPath
      })

      const itm = updated.items[0]
      expect(itm.selectedImageSource).toBe('custom_local')
      expect(itm.customImageLocalPath).toBeDefined()
      expect(fs.existsSync(itm.customImageLocalPath!)).toBe(true)
      expect(itm.operatorEditedFields).toContain('consumerImage')
      expect(itm.isOperatorModified).toBe(true)
    })

    it('Updates leaflet header and sets headerModifiedByOperator = true', async () => {
      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: {
          supermarketId: null,
          region: null,
          headerModifiedByOperator: false
        },
        items: []
      }
      await saveStagedLeafletDraft(tmpDir, draft)

      const updated = await updateStagedLeafletHeader(tmpDir, {
        supermarketId: 'danube',
        region: 'Riyadh'
      })

      expect(updated.header.supermarketId).toBe('danube')
      expect(updated.header.region).toBe('Riyadh')
      expect(updated.header.headerModifiedByOperator).toBe(true)
    })

    it('Preserves Stage 2 metadata when legacy SD/ED rows appear, does not delete historical tmp pages, and returns requiresOperatorMetadataConfirmation = false when Stage 2 header is already complete', async () => {
      const initialDraft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        leafletHash: 'Al-Wafa-04-Jeddah.pdf',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: {
          supermarketId: 'alwafa',
          region: 'Jeddah',
          validFrom: '2026-11-01',
          validTo: '2026-11-07',
          firstPagePublicUrl: 'https://storage.wifran.com/tmp/alwafa_first.png',
          lastPagePublicUrl: 'https://storage.wifran.com/tmp/alwafa_last.png',
          firstPageTmpPath: 'alwafa_first.png',
          lastPageTmpPath: 'alwafa_last.png',
          headerModifiedByOperator: true
        },
        items: [
          {
            id: 'offer-item-1',
            imageRef: 'O1',
            originalOcr: { titleEn: 'Olive Oil 500ml', titleAr: 'زيت زيتون ٥٠٠ مل' },
            titleEn: 'Olive Oil 500ml',
            titleAr: 'زيت زيتون ٥٠٠ مل',
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/1.webp',
            selectedImageSource: 'none'
          }
        ]
      }
      await saveStagedLeafletDraft(tmpDir, initialDraft)

      // Legacy Step 2 CSV with different SD/ED must NOT overwrite Stage 2 confirmed header
      const legacyCsv = `Image_Ref,image_url
O1,https://example.com/olive-oil.png
SD,2026-11-05
ED,2026-11-12
`

      const res = await importStep2CsvIntoStagedDraft(tmpDir, legacyCsv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      expect(res.errors).toEqual([])
      expect(res.ignoredLegacyRowsCount).toBe(2)
      expect(res.draft.header.supermarketId).toBe('alwafa')
      expect(res.draft.header.region).toBe('Jeddah')
      expect(res.draft.header.validFrom).toBe('2026-11-01')
      expect(res.draft.header.validTo).toBe('2026-11-07')
      expect(res.requiresOperatorMetadataConfirmation).toBe(false)
      expect(res.missingMetadata).toBe(false)
      expect(res.missingFields).toEqual([])
      expect(res.validationWarnings).toHaveLength(2)

      // Historical tmp pages must NOT be auto-deleted
      expect(mockDb.removedTmpPaths).toEqual([])

      const updatedDraft = await loadStagedLeafletDraft(tmpDir)
      expect(updatedDraft?.header.validFrom).toBe('2026-11-01')
      expect(updatedDraft?.header.validTo).toBe('2026-11-07')
      expect(updatedDraft?.header.firstPageTmpPath).toBe('alwafa_first.png')
      expect(updatedDraft?.header.lastPageTmpPath).toBe('alwafa_last.png')

      // Modern P/O-only Step 3 CSV without SD/ED succeeds cleanly with zero warnings
      const modernCsv = `Image_Ref,image_url
O1,https://example.com/olive-oil.png
`
      const modernRes = await importStep2CsvIntoStagedDraft(tmpDir, modernCsv, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })
      expect(modernRes.errors).toEqual([])
      expect(modernRes.ignoredLegacyRowsCount).toBe(0)
      expect(modernRes.missingMetadata).toBe(false)
      expect(modernRes.missingFields).toEqual([])
      expect(modernRes.validationWarnings).toEqual([])
      expect(modernRes.requiresOperatorMetadataConfirmation).toBe(false)
    })
  })
})
