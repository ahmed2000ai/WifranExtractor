import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

vi.mock('dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns/promises')>()
  return {
    ...actual,
    resolve: vi.fn(async () => ['93.184.216.34'])
  }
})

import {
  initializeStagedDraftFromPackage,
  uploadLeafletBoundaryPagesForMetadata,
  resolveLocalLeafletPreviewPages,
  exportStagedLeafletForStep2,
  importStep2CsvIntoStagedDraft,
  loadStagedLeafletDraft,
  saveStagedLeafletDraft,
  updateStagedLeafletHeader,
  publishStagedLeafletDraftToDb
} from '../../../main/db/stagedLeafletDraftService'
import {
  validateProductImageCsvImport,
  uploadApprovedProductImagesToDb
} from '../../../main/db/productImageEnrichmentService'
import {
  setSupabaseAdminClient,
  resetSupabaseAdminClient
} from '../../../main/db/supabaseAdminClient'
import { MASTER_SUPERMARKETS } from '../../../main/db/referenceDataService'
import { getLeafletMetadataService } from '../../../main/metadata/leafletMetadataService'
import { saveOfferRefMap, setCustomOfferRefMapPath } from '../../../main/db/offerImageRefMapper'
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

interface MockDbState {
  leaflets: any[]
  offers: Map<string, any>
  products: Map<number, any>
  product_aliases: any[]
  product_images: any[]
  offer_display_images: any[]
  offer_visual_group_members: any[]
  storageUploads: Array<{ bucket: string; path: string; buffer: Buffer }>
  removedStoragePaths: Array<{ bucket: string; paths: string[] }>
  publicUrlCalls: Array<{ bucket: string; path: string }>
}

function makeItem(overrides: Partial<StagedOfferItem> & { id: string }): StagedOfferItem {
  return {
    sourceOfferId: overrides.id,
    pageNumber: 1,
    croppedEvidenceLocalPath: '',
    selectedImageSource: 'none',
    isAiCorrected: false,
    isOperatorModified: false,
    operatorEditedFields: [],
    originalOcr: {
      titleEn: overrides.titleEn ?? 'Sample Item',
      titleAr: overrides.titleAr ?? 'منتج تجريبي',
      brand: overrides.brand ?? null,
      sizeOrWeight: overrides.sizeOrWeight ?? null
    },
    titleEn: overrides.titleEn ?? 'Sample Item',
    titleAr: overrides.titleAr ?? 'منتج تجريبي',
    brand: overrides.brand ?? null,
    sizeOrWeight: overrides.sizeOrWeight ?? null,
    status: 'ready',
    ...overrides
  }
}

function makeDraft(jobDir: string, overrides?: Partial<StagedLeafletDraft>): StagedLeafletDraft {
  return {
    schemaVersion: 'wifran.staged.draft/1.0',
    jobDir,
    leafletHash: overrides?.leafletHash ?? crypto.createHash('sha256').update(jobDir).digest('hex'),
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    header: {
      supermarketId: null,
      region: null,
      locationScope: null,
      validFrom: null,
      validTo: null,
      headerModifiedByOperator: false,
      ...(overrides?.header || {})
    },
    items: overrides?.items ?? []
  }
}

function createMockSupabase(db: MockDbState): any {
  return {
    from: vi.fn((table: string) => {
      const filters: Array<{ op: 'eq' | 'in' | 'is' | 'ilike'; col: string; val: any }> = []
      let maxRows: number | null = null

      const getTableRows = (): any[] => {
        if (table === 'products') return Array.from(db.products.values())
        if (table === 'offers') return Array.from(db.offers.values())
        if (table === 'product_aliases') return [...db.product_aliases]
        if (table === 'product_images') return [...db.product_images]
        if (table === 'offer_display_images') return [...db.offer_display_images]
        if (table === 'offer_visual_group_members') return [...db.offer_visual_group_members]
        if (table === 'leaflets') return [...db.leaflets]
        return []
      }

      const applyFilters = (rows: any[]): any[] => {
        let filtered = rows.filter((row) => {
          for (const f of filters) {
            if (f.op === 'eq' && row[f.col] !== f.val) return false
            if (f.op === 'is' && row[f.col] !== f.val) return false
            if (f.op === 'in' && (!Array.isArray(f.val) || !f.val.includes(row[f.col]))) return false
            if (f.op === 'ilike') {
              const target = String(row[f.col] || '').toLowerCase()
              const pattern = String(f.val || '').replace(/%/g, '').toLowerCase()
              if (!target.includes(pattern)) return false
            }
          }
          return true
        })
        if (maxRows != null) {
          filtered = filtered.slice(0, maxRows)
        }
        return filtered
      }

      const queryObj: any = {
        select: vi.fn(() => queryObj),
        eq: vi.fn((col: string, val: any) => {
          filters.push({ op: 'eq', col, val })
          return queryObj
        }),
        in: vi.fn((col: string, val: any[]) => {
          filters.push({ op: 'in', col, val })
          return queryObj
        }),
        is: vi.fn((col: string, val: any) => {
          filters.push({ op: 'is', col, val })
          return queryObj
        }),
        ilike: vi.fn((col: string, val: any) => {
          filters.push({ op: 'ilike', col, val })
          return queryObj
        }),
        order: vi.fn(() => queryObj),
        limit: vi.fn((n: number) => {
          maxRows = n
          return queryObj
        }),
        maybeSingle: vi.fn(async () => {
          const rows = applyFilters(getTableRows())
          return { data: rows[0] ?? null, error: null }
        }),
        single: vi.fn(async () => {
          const rows = applyFilters(getTableRows())
          return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'Not found' } }
        }),
        insert: vi.fn((payload: any) => {
          const items = Array.isArray(payload) ? payload : [payload]
          const inserted = items.map((item) => ({
            id: item.id || crypto.randomUUID(),
            ...item
          }))
          if (table === 'product_images') db.product_images.push(...inserted)
          if (table === 'offer_display_images') db.offer_display_images.push(...inserted)
          if (table === 'offer_visual_group_members') db.offer_visual_group_members.push(...inserted)
          if (table === 'offers') {
            for (const o of inserted) db.offers.set(o.id, o)
          }
          if (table === 'leaflets') db.leaflets.push(...inserted)

          const chain: any = {
            select: vi.fn(() => chain),
            single: vi.fn(async () => ({ data: inserted[0], error: null })),
            maybeSingle: vi.fn(async () => ({ data: inserted[0] ?? null, error: null })),
            then: (resolve: any) => resolve({ data: inserted.length === 1 ? inserted[0] : inserted, error: null })
          }
          return chain
        }),
        upsert: vi.fn((payload: any) => {
          const items = Array.isArray(payload) ? payload : [payload]
          for (const rec of items) {
            if (table === 'leaflets') db.leaflets.push({ ...rec })
            if (table === 'offers') db.offers.set(rec.id, { ...rec })
            if (table === 'offer_display_images') db.offer_display_images.push({ id: rec.id || crypto.randomUUID(), ...rec })
            if (table === 'offer_visual_group_members') db.offer_visual_group_members.push({ ...rec })
          }
          const chain: any = {
            catch: () => chain,
            then: (resolve: any) => resolve({ data: payload, error: null })
          }
          return chain
        }),
        update: vi.fn((updates: any) => {
          const updFilters: Array<{ col: string; val: any }> = []
          const updChain: any = {
            eq: vi.fn((col: string, val: any) => {
              updFilters.push({ col, val })
              return updChain
            }),
            then: (resolve: any) => {
              const targetRows = getTableRows()
              for (const row of targetRows) {
                if (updFilters.every((f) => row[f.col] === f.val)) {
                  Object.assign(row, updates)
                  if (table === 'products') db.products.set(Number(row.id), row)
                  if (table === 'offers') db.offers.set(row.id, row)
                }
              }
              resolve({ data: [], error: null })
            }
          }
          return updChain
        }),
        then: (resolve: any) => {
          const rows = applyFilters(getTableRows())
          resolve({ data: rows, count: rows.length, error: null })
        }
      }
      return queryObj
    }),
    storage: {
      from: vi.fn((bucket: string) => ({
        upload: vi.fn(async (storagePath: string, buffer: Buffer) => {
          db.storageUploads.push({ bucket, path: storagePath, buffer })
          return { data: { path: storagePath }, error: null }
        }),
        getPublicUrl: vi.fn((storagePath: string) => {
          db.publicUrlCalls.push({ bucket, path: storagePath })
          return {
            data: {
              publicUrl: `https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/${bucket}/${storagePath}`
            }
          }
        }),
        remove: vi.fn(async (paths: string[]) => {
          db.removedStoragePaths.push({ bucket, paths })
          return { data: paths, error: null }
        })
      }))
    }
  }
}

describe('WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001 Offline Suite', () => {
  let tmpDir: string
  let testMapPath: string
  let mockDb: MockDbState
  let mockSupabase: any
  let fetchSpy: ReturnType<typeof vi.spyOn>
  const registeredFingerprints = new Set<string>()
  let originalOfflineEnv: string | undefined

  beforeEach(async () => {
    originalOfflineEnv = process.env.WIFRAN_OFFLINE_UAT
    delete process.env.WIFRAN_OFFLINE_UAT

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-csv001-test-'))
    testMapPath = path.join(tmpDir, 'offer-image-ref-map.json')
    setCustomOfferRefMapPath(testMapPath)

    mockDb = {
      leaflets: [],
      offers: new Map(),
      products: new Map([
        [
          1,
          {
            id: 1,
            canonical_product_key: 'nadec:fresh-milk-1l',
            name_en: 'Nadec Fresh Milk 1L',
            name_ar: 'حليب نادك طازج ١ لتر',
            item_name_complete: 'Nadec Fresh Milk 1L',
            brand_name: 'Nadec',
            each_size_value: 1,
            each_size_unit: 'liter',
            inner_pack_count: 1,
            sale_unit_type: 'each',
            verification_status: 'verified',
            approved_primary_image_id: null,
            default_image_url: null
          }
        ],
        [
          6,
          {
            id: 6,
            canonical_product_key: 'loreal:elvive-shampoo-400ml',
            name_en: "L'Oreal Elvive Shampoo 400ml",
            name_ar: 'لوريال الفيف شامبو ٤٠٠ مل',
            item_name_complete: "L'Oreal Elvive Shampoo 400ml",
            slug: 'l-oreal-elvive-shampoo-400ml',
            brand_name: "L'Oreal",
            each_size_value: 400,
            each_size_unit: 'ml',
            inner_pack_count: 1,
            sale_unit_type: 'each',
            verification_status: 'verified',
            approved_primary_image_id: 'img-loreal-6',
            default_image_url: 'https://storage.wifran.com/product-images/catalog/loreal-400ml.webp'
          }
        ]
      ]),
      product_aliases: [
        { product_id: 6, alias_text: 'لوريال شامبو ٤٠٠ مل' },
        { product_id: 6, alias_text: 'لوريال الفيف شامبو' }
      ],
      product_images: [],
      offer_display_images: [],
      offer_visual_group_members: [],
      storageUploads: [],
      removedStoragePaths: [],
      publicUrlCalls: []
    }

    mockSupabase = createMockSupabase(mockDb)
    setSupabaseAdminClient(mockSupabase)

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input)
      if (url.endsWith('.png')) {
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

  afterEach(async () => {
    setCustomOfferRefMapPath(null)
    vi.restoreAllMocks()
    resetSupabaseAdminClient()
    const metadataService = getLeafletMetadataService()
    for (const fp of registeredFingerprints) {
      metadataService.getCache().invalidate(fp)
    }
    registeredFingerprints.clear()

    if (originalOfflineEnv !== undefined) {
      process.env.WIFRAN_OFFLINE_UAT = originalOfflineEnv
    } else {
      delete process.env.WIFRAN_OFFLINE_UAT
    }

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  })

  it('1. Step 1 export emits strictly Image_Ref,Item_Name with valid P/O rows, UTF-8 BOM, CRLF, and quote escaping', async () => {
    const draft = makeDraft(tmpDir, {
      items: [
        makeItem({
          id: 'offer-p12',
          matchedProductId: 12,
          imageRef: 'P12',
          titleEn: 'Nadec "Fresh" Milk 1L',
          titleAr: 'حليب نادك ١ لتر'
        }),
        makeItem({
          id: '11111111-1111-4444-8888-111111111111',
          imageRef: 'O3',
          titleEn: 'Czech 55-inch QLED 4K Smart TV',
          titleAr: 'تلفزيون تشيك الذكي ٥٥ بوصة',
          brand: 'CHiQ',
          sizeOrWeight: '55 Inch'
        }),
        makeItem({
          id: 'offer-existing',
          matchedProductId: 6,
          selectedImageSource: 'existing_db',
          existingDbImageUrl: 'https://example.com/loreal.webp',
          status: 'skipped',
          imageRef: undefined
        })
      ]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    const res = await exportStagedLeafletForStep2(tmpDir, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(res.csvContent.startsWith('\uFEFF')).toBe(true)
    expect(res.csvContent).toContain('\r\n')
    expect(res.pCount).toBe(1)
    expect(res.oCount).toBe(1)
    expect(res.exportableCount).toBe(2)
    expect(res.skippedAlreadyImagedCount).toBe(1)
    expect(res.metadataRowsCount).toBe(0)

    const lines = res.csvContent.slice(1).split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('Image_Ref,Item_Name')
    expect(lines[1]).toBe('"P12","Nadec ""Fresh"" Milk 1L | حليب نادك"')
    expect(lines[2]).toBe('"O3","CHiQ Czech 55-inch QLED 4K Smart TV 55 Inch | تلفزيون تشيك الذكي ٥٥ بوصة"')
  })

  it('2. Step 1 export never emits FPTSP or LPTSP even when local or legacy boundary fields exist', async () => {
    const pagesDir = path.join(tmpDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    const page1 = path.join(pagesDir, 'page-001.png')
    const page2 = path.join(pagesDir, 'page-002.png')
    fs.writeFileSync(page1, validPngBuffer)
    fs.writeFileSync(page2, validPngBuffer)

    const draft = makeDraft(tmpDir, {
      header: {
        supermarketId: null,
        region: null,
        validFrom: null,
        validTo: null,
        firstPageLocalPath: page1,
        lastPageLocalPath: page2,
        firstPageNumber: 1,
        lastPageNumber: 2,
        localPreviewPages: [
          { pageNumber: 1, imagePath: page1 },
          { pageNumber: 2, imagePath: page2 }
        ],
        firstPagePublicUrl: 'https://example.com/legacy_first.png',
        lastPagePublicUrl: 'https://example.com/legacy_last.png',
        headerModifiedByOperator: false
      },
      items: [makeItem({ id: 'offer-boundary-test', imageRef: 'O1', titleEn: 'Saudi Rice 5Kg', titleAr: 'أرز سعودي' })]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    const res = await exportStagedLeafletForStep2(tmpDir, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(res.metadataRowsCount).toBe(0)
    expect(res.csvContent).not.toMatch(/FPTSP|LPTSP|M_PAGE_FIRST|M_PAGE_LAST/)
    expect(res.csvContent.slice(1).split('\r\n')).toHaveLength(2)
  })

  it('3. Step 1 export never emits SD, ED, SMN, REG, or M_* metadata rows even when Stage 2 header is populated', async () => {
    const danube = MASTER_SUPERMARKETS.find((s) => s.slug === 'danube')!
    const draft = makeDraft(tmpDir, {
      header: {
        supermarketId: danube.id,
        region: 'Jeddah',
        locationScope: 'city',
        validFrom: '2026-11-04',
        validTo: '2026-11-10',
        headerModifiedByOperator: true
      },
      items: [makeItem({ id: 'offer-meta-row-check', imageRef: 'O7', titleEn: 'Olive Oil 500ml', titleAr: 'زيت زيتون' })]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    const res = await exportStagedLeafletForStep2(tmpDir, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(res.metadataRowsCount).toBe(0)
    for (const forbidden of ['SD', 'ED', 'SMN', 'REG', 'M_SUPERMARKET_ID', 'M_REGION', 'M_VALID_FROM', 'M_VALID_TO']) {
      expect(res.csvContent).not.toContain(`"${forbidden}"`)
      expect(res.csvContent).not.toContain(`${forbidden},`)
    }
    expect(res.rows.map((r) => r.imageRef)).toEqual(['O7'])
  })

  it('4. Real dukan-849797163-jeddah O51 reproduction preserves O51 without renumbering, consolidates members, omits FPTSP/LPTSP, and re-imports cleanly', async () => {
    const realDraftPath = path.resolve(process.cwd(), 'Extracts/dukan-849797163-jeddah/staged-draft.json')
    const realMapPath = path.resolve(process.cwd(), 'exports/offer-image-ref-map.json')
    const realDraft = JSON.parse(fs.readFileSync(realDraftPath, 'utf8')) as StagedLeafletDraft
    const realMap = JSON.parse(fs.readFileSync(realMapPath, 'utf8'))

    const clonedDraft: StagedLeafletDraft = {
      ...realDraft,
      jobDir: tmpDir
    }
    const clonedMapPath = path.join(tmpDir, 'cloned-map.json')
    const emptyMapPath = path.join(tmpDir, 'empty-map.json')
    await saveStagedLeafletDraft(tmpDir, clonedDraft)
    await fs.promises.writeFile(clonedMapPath, JSON.stringify(realMap, null, 2), 'utf8')

    // Export with real map AND verify against an empty map (O51 must still not renumber to O1)
    const resClonedMap = await exportStagedLeafletForStep2(tmpDir, {
      mapFilePath: clonedMapPath,
      supabaseClient: mockSupabase
    })
    const resEmptyMap = await exportStagedLeafletForStep2(tmpDir, {
      mapFilePath: emptyMapPath,
      supabaseClient: mockSupabase
    })

    const expectedName =
      'CHiQ Czech 55-inch QLED 4K Smart TV 55 Inch | تلفزيون تشيك الذكي ٥٥ بوصة كيو إل إي دي بدقة ٤K'

    for (const res of [resClonedMap, resEmptyMap]) {
      expect(res.metadataRowsCount).toBe(0)
      expect(res.oCount).toBe(1)
      expect(res.exportableCount).toBe(1)
      expect(res.csvContent).not.toContain('FPTSP')
      expect(res.csvContent).not.toContain('LPTSP')
      const lines = res.csvContent.slice(1).split('\r\n')
      expect(lines).toEqual(['Image_Ref,Item_Name', `"O51","${expectedName}"`])
    }

    // Re-importing O51 propagates candidate image cleanly to both _p009_001 and _p009_002
    const importRes = await importStep2CsvIntoStagedDraft(
      tmpDir,
      `Image_Ref,image_url\nO51,https://example.com/chiq-55-qled.webp\n`,
      { mapFilePath: emptyMapPath, supabaseClient: mockSupabase }
    )

    expect(importRes.errors).toEqual([])
    expect(importRes.matchedOffersCount).toBe(2)
    expect(importRes.candidateImagesDownloadedCount).toBe(1)

    const reloaded = await loadStagedLeafletDraft(tmpDir, { skipAutoInit: true })
    expect(reloaded?.items).toHaveLength(2)
    for (const item of reloaded!.items) {
      expect(item.imageRef).toBe('O51')
      expect(item.candidateImageUrl).toBe('https://example.com/chiq-55-qled.webp')
      expect(item.candidateImageLocalPath).toBeTruthy()
      expect(fs.existsSync(item.candidateImageLocalPath!)).toBe(true)
      expect(item.selectedImageSource).toBe('candidate')
    }
  })

  it('5. Zero Supabase tmp bucket uploads occur during package init, boundary preview setup, or Step 1 export', async () => {
    const pagesDir = path.join(tmpDir, 'pages')
    const metaDir = path.join(tmpDir, 'metadata', 'rev1', 'page-001', 'crops', 'offer-001')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.mkdirSync(metaDir, { recursive: true })

    fs.writeFileSync(path.join(pagesDir, 'page-001.png'), validPngBuffer)
    fs.writeFileSync(path.join(pagesDir, 'page-002.png'), validPngBuffer)
    const cropPath = path.join(metaDir, 'offer_card_crop.webp')
    fs.writeFileSync(cropPath, validWebpBuffer)
    fs.writeFileSync(
      path.join(metaDir, 'extracted.json'),
      JSON.stringify({
        offer_id: 'pkg-offer-1',
        product: { title_en: 'Almarai Laban 2L', title_ar: 'لبن المراعي ٢ لتر' }
      }),
      'utf8'
    )

    const fp = crypto.createHash('sha256').update('pkg-zero-tmp').digest('hex')
    fs.writeFileSync(
      path.join(tmpDir, 'extraction_manifest.json'),
      JSON.stringify({
        schema_version: 'wifran.extraction.manifest/1.0',
        pdf_file_name: 'test-leaflet.pdf',
        processing_selection: {
          selectionMode: 'all',
          selectedPages: [1, 2],
          totalPages: 2,
          pdfFingerprint: fp
        },
        pages: [
          {
            page_number: 1,
            image_path: path.join(pagesDir, 'page-001.png'),
            offers: [{ offer_id: 'pkg-offer-1', crop_path: cropPath, extracted_json_path: path.join(metaDir, 'extracted.json') }]
          }
        ]
      }),
      'utf8'
    )

    const draft = await initializeStagedDraftFromPackage(tmpDir, {
      supabaseClient: mockSupabase,
      leafletHash: fp
    })
    const previewRes = await uploadLeafletBoundaryPagesForMetadata(tmpDir, fp, {
      metadataPageNumber: 1
    })
    const exportRes = await exportStagedLeafletForStep2(tmpDir, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(mockDb.storageUploads).toHaveLength(0)
    expect(mockDb.publicUrlCalls).toHaveLength(0)
    expect(draft.header.firstPagePublicUrl).toBeNull()
    expect(draft.header.lastPagePublicUrl).toBeNull()
    expect(draft.header.firstPageTmpPath).toBeNull()
    expect(draft.header.lastPageTmpPath).toBeNull()
    expect(previewRes.firstPagePublicUrl).toBeNull()
    expect(previewRes.lastPagePublicUrl).toBeNull()
    expect(previewRes.firstPageTmpPath).toBeNull()
    expect(previewRes.lastPageTmpPath).toBeNull()
    expect(exportRes.metadataRowsCount).toBe(0)
  })

  it('6. Local page preview resolution works offline and enforces selected-page scope fail-closed', async () => {
    const pagesDir = path.join(tmpDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    for (const p of [1, 2, 3, 4]) {
      fs.writeFileSync(path.join(pagesDir, `page-00${p}.png`), validPngBuffer)
    }

    fs.writeFileSync(
      path.join(tmpDir, 'extraction_manifest.json'),
      JSON.stringify({
        schema_version: 'wifran.extraction.manifest/1.0',
        pdf_file_name: 'scoped-leaflet.pdf',
        processing_selection: {
          selectionMode: 'specific',
          selectedPages: [2, 3],
          totalPages: 4
        },
        pages: []
      }),
      'utf8'
    )

    const scoped = await resolveLocalLeafletPreviewPages(tmpDir)
    expect(scoped.firstPageNumber).toBe(2)
    expect(scoped.lastPageNumber).toBe(3)
    expect(scoped.firstPageLocalPath).toContain('page-002.png')
    expect(scoped.lastPageLocalPath).toContain('page-003.png')
    expect(scoped.localPreviewPages.map((p) => p.pageNumber)).toEqual([2, 3])

    await expect(
      resolveLocalLeafletPreviewPages(tmpDir, { metadataPageNumber: 1 })
    ).rejects.toThrow(/outside selected pages scope/i)

    await expect(
      uploadLeafletBoundaryPagesForMetadata(tmpDir, 'scope-fp', { metadataPageNumber: 4 })
    ).rejects.toThrow(/outside selected pages scope/i)
  })

  it('7. Corrected_Item_Name|https_image_url applies AI correction, preserves originalOcr, downloads candidate, and triggers postCorrectionDbMatch', async () => {
    const draft = makeDraft(tmpDir, {
      items: [
        makeItem({
          id: 'offer-ocr-typo',
          imageRef: 'O1',
          originalOcr: {
            titleEn: 'Loral Shmpo 400ml',
            titleAr: 'لورال شامبو ٤٠٠ مل',
            brand: null,
            sizeOrWeight: '400ml'
          },
          titleEn: 'Loral Shmpo 400ml',
          titleAr: 'لورال شامبو ٤٠٠ مل',
          sizeOrWeight: '400ml'
        })
      ]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    const csv = `Image_Ref,image_url
O1,"L'Oreal Elvive Shampoo 400ml | لوريال الفيف شامبو ٤٠٠ مل|https://example.com/loreal-elvive-400ml.webp"
`
    const res = await importStep2CsvIntoStagedDraft(tmpDir, csv, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(res.errors).toEqual([])
    expect(res.aiCorrectedCount).toBe(1)
    expect(res.postCorrectionDbMatchCount).toBe(1)
    expect(res.candidateImagesDownloadedCount).toBe(1)

    const updated = await loadStagedLeafletDraft(tmpDir, { skipAutoInit: true })
    const item = updated!.items[0]
    expect(item.originalOcr?.titleEn).toBe('Loral Shmpo 400ml')
    expect(item.originalOcr?.titleAr).toBe('لورال شامبو ٤٠٠ مل')
    expect(item.titleEn).toBe("L'Oreal Elvive Shampoo 400ml")
    expect(item.titleAr).toBe('لوريال الفيف شامبو ٤٠٠ مل')
    expect(item.isAiCorrected).toBe(true)
    expect(item.postCorrectionDbMatch?.productId).toBe(6)
    expect(item.existingDbImageUrl).toBe('https://storage.wifran.com/product-images/catalog/loreal-400ml.webp')
    expect(item.selectedImageSource).toBe('existing_db')
    expect(item.candidateImageLocalPath).toBeTruthy()
    expect(fs.existsSync(item.candidateImageLocalPath!)).toBe(true)
  })

  it('8. Blank image URL (O1, and Corrected_Item_Name|) is accepted cleanly as unresolved with zero errors and zero fetch calls', async () => {
    const draft = makeDraft(tmpDir, {
      header: {
        supermarketId: MASTER_SUPERMARKETS[0].id,
        region: 'National',
        validFrom: '2026-11-04',
        validTo: '2026-11-10',
        headerModifiedByOperator: true
      },
      items: [
        makeItem({ id: 'offer-blank-1', imageRef: 'O1', titleEn: 'Item Blank One' }),
        makeItem({ id: 'offer-blank-2', imageRef: 'O2', titleEn: 'Ocr Typo Two' })
      ]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    const csv = `Image_Ref,image_url
O1,
O2,Corrected Dairy Product|
`
    const res = await importStep2CsvIntoStagedDraft(tmpDir, csv, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(res.errors).toEqual([])
    expect(res.matchedOffersCount).toBe(2)
    expect(res.aiCorrectedCount).toBe(1)
    expect(res.candidateImagesDownloadedCount).toBe(0)
    expect(res.candidateImagesFailedCount).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()

    const reloaded = await loadStagedLeafletDraft(tmpDir, { skipAutoInit: true })
    expect(reloaded!.items[0].selectedImageSource).toBe('none')
    expect(reloaded!.items[1].titleEn).toBe('Corrected Dairy Product')
    expect(reloaded!.items[1].isAiCorrected).toBe(true)
    expect(reloaded!.items[1].selectedImageSource).toBe('none')
  })

  it('9. Legacy FPTSP/LPTSP/SD/ED/SMN/REG/M_* rows are ignored safely without fetching page URLs, mutating header, or deleting tmp assets', async () => {
    const stagedOfferUuid = '22222222-2222-4444-8888-222222222222'
    mockDb.offers.set(stagedOfferUuid, {
      id: stagedOfferUuid,
      source_offer_id: 'legacy-test-offer',
      title_en: 'Sunwhite Rice 5Kg',
      title_ar: 'أرز صن وايت ٥ كجم',
      sale_unit_type: 'pack',
      product_id: null,
      contract_v2: {}
    })

    const draft = makeDraft(tmpDir, {
      header: {
        supermarketId: null,
        region: null,
        validFrom: null,
        validTo: null,
        firstPagePublicUrl: 'https://example.com/tmp/old_first.png',
        firstPageTmpPath: 'old_first.png',
        headerModifiedByOperator: false
      },
      items: [makeItem({ id: 'legacy-staged-1', imageRef: 'O1', titleEn: 'Olive Oil 1L' })]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    const legacyStagedCsv = `Image_Ref,image_url
O1,https://example.com/olive-oil.webp
FPTSP,https://example.com/tmp/old_first.png
LPTSP,https://example.com/tmp/old_last.png
SD,2026-11-01
ED,2026-11-07
SMN,Panda
REG,Riyadh
M_PAGE_FIRST,https://example.com/tmp/p1.png
M_PAGE_LAST,https://example.com/tmp/p2.png
M_SUPERMARKET_ID,panda
M_REGION,riyadh
M_VALID_FROM,2026-11-01
M_VALID_TO,2026-11-07
`
    const stagedRes = await importStep2CsvIntoStagedDraft(tmpDir, legacyStagedCsv, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(stagedRes.errors).toEqual([])
    expect(stagedRes.ignoredLegacyRowsCount).toBe(12)
    expect(stagedRes.candidateImagesDownloadedCount).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mockDb.removedStoragePaths).toEqual([])

    const reloaded = await loadStagedLeafletDraft(tmpDir, { skipAutoInit: true })
    expect(reloaded?.header.supermarketId).toBeNull()
    expect(reloaded?.header.validFrom).toBeNull()
    expect(reloaded?.header.firstPageTmpPath).toBe('old_first.png')

    // Also test Direct Step 3 Validator & Uploader
    fetchSpy.mockClear()
    const directCsv = `Image_Ref,image_url
P1,https://example.com/nadec-milk.png
O${stagedOfferUuid},https://example.com/sunwhite.webp
FPTSP,https://example.com/tmp/first.png
LPTSP,https://example.com/tmp/last.png
SD,2026-11-01
ED,2026-11-07
SMN,Panda
REG,Jeddah
M_REGION,Jeddah
`
    const validation = await validateProductImageCsvImport(directCsv, { mapFilePath: testMapPath })
    expect(validation.ok).toBe(true)
    expect(validation.ignoredLegacyRowsCount).toBe(7)
    expect(validation.validRowsCount).toBe(2)
    expect(validation.warnings).toHaveLength(7)
    expect(validation.rows.filter((r) => r.status === 'legacy_ignored')).toHaveLength(7)

    const uploadRes = await uploadApprovedProductImagesToDb({
      csvContent: directCsv,
      operatorConfirmedReview: true,
      mapFilePath: testMapPath
    })
    expect(uploadRes.failedCount).toBe(0)
    expect(uploadRes.uploadedCount).toBe(2)
    expect(uploadRes.skippedCount).toBe(7)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('10. Step 3 CSV without SD or ED succeeds cleanly when Stage 2 header metadata is complete', async () => {
    const danube = MASTER_SUPERMARKETS.find((s) => s.slug === 'danube')!
    const draft = makeDraft(tmpDir, {
      header: {
        supermarketId: danube.id,
        region: 'National',
        locationScope: 'national',
        validFrom: '2026-11-04',
        validTo: '2026-11-10',
        headerModifiedByOperator: true
      },
      items: [makeItem({ id: 'offer-no-sded', imageRef: 'O1', titleEn: 'Dates 1Kg' })]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    const res = await importStep2CsvIntoStagedDraft(
      tmpDir,
      `Image_Ref,image_url\nO1,https://example.com/dates.webp\n`,
      { mapFilePath: testMapPath, supabaseClient: mockSupabase }
    )

    expect(res.errors).toEqual([])
    expect(res.missingMetadata).toBe(false)
    expect(res.missingFields).toEqual([])
    expect(res.requiresOperatorMetadataConfirmation).toBe(false)
    expect(res.ignoredLegacyRowsCount).toBe(0)
    expect(res.candidateImagesDownloadedCount).toBe(1)
  })

  it('11. Step 3 CSV cannot overwrite Stage 2 header, item validity dates, or confirmed_metadata.json on disk', async () => {
    const danube = MASTER_SUPERMARKETS.find((s) => s.slug === 'danube')!
    const fp11 = crypto.createHash('sha256').update('fp-immutable-11').digest('hex')
    registeredFingerprints.add(fp11)

    const draft = makeDraft(tmpDir, {
      leafletHash: fp11,
      header: {
        supermarketId: danube.id,
        region: 'National',
        locationScope: 'national',
        validFrom: '2026-11-04',
        validTo: '2026-11-10',
        headerModifiedByOperator: true
      },
      items: [
        makeItem({
          id: 'offer-immutable-dates',
          imageRef: 'O1',
          titleEn: 'Nescafe Gold 200g',
          validFrom: '2026-11-04',
          validTo: '2026-11-10'
        } as any)
      ]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    const metadataService = getLeafletMetadataService()
    metadataService.confirmMetadata({
      leafletFingerprint: fp11,
      supermarketId: danube.id,
      startDate: '2026-11-04',
      endDate: '2026-11-10',
      locationScope: 'national',
      workspacePath: tmpDir
    })

    const confirmedPath = path.join(tmpDir, 'metadata', 'confirmed_metadata.json')
    const confirmedBefore = fs.readFileSync(confirmedPath, 'utf8')

    const conflictingCsv = `Image_Ref,image_url
O1,https://example.com/nescafe.webp
SMN,Panda
REG,Riyadh
SD,2099-01-01
ED,2099-01-31
M_SUPERMARKET_ID,panda
M_REGION,Riyadh
M_VALID_FROM,2099-01-01
M_VALID_TO,2099-01-31
`
    const res = await importStep2CsvIntoStagedDraft(tmpDir, conflictingCsv, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(res.errors).toEqual([])
    expect(res.ignoredLegacyRowsCount).toBe(8)

    const reloaded = await loadStagedLeafletDraft(tmpDir, { skipAutoInit: true })
    expect(reloaded!.header.supermarketId).toBe(danube.id)
    expect(reloaded!.header.region).toBe('National')
    expect(reloaded!.header.validFrom).toBe('2026-11-04')
    expect(reloaded!.header.validTo).toBe('2026-11-10')
    expect((reloaded!.items[0] as any).validFrom).toBe('2026-11-04')
    expect((reloaded!.items[0] as any).validTo).toBe('2026-11-10')

    const confirmedAfter = fs.readFileSync(confirmedPath, 'utf8')
    expect(confirmedAfter).toBe(confirmedBefore)

    const readiness = metadataService.validatePublishReadiness({
      workspacePath: tmpDir,
      leafletFingerprint: fp11,
      expectedSupermarketId: danube.id,
      expectedValidityFrom: '2026-11-04',
      expectedValidityTo: '2026-11-10',
      locationScope: 'national'
    })
    expect(readiness.ok).toBe(true)
  })

  it('12. Rejects unknown, duplicate, conflicting, and unsupported image references across staged & direct importers', async () => {
    const uuid1 = '33333333-3333-4444-8888-333333333333'
    const draft = makeDraft(tmpDir, {
      header: {
        supermarketId: MASTER_SUPERMARKETS[0].id,
        region: 'National',
        validFrom: '2026-11-04',
        validTo: '2026-11-10',
        headerModifiedByOperator: true
      },
      items: [makeItem({ id: uuid1, imageRef: 'O51', titleEn: 'CHiQ TV 55' })]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    await saveOfferRefMap(
      {
        nextSeq: 52,
        shortToUuid: { O51: uuid1 },
        uuidToShort: { [uuid1]: 'O51' }
      },
      testMapPath
    )

    const stagedCsv = `Image_Ref,image_url
O51,https://example.com/first.webp
o51,https://example.com/dup-case.webp
O${uuid1},https://example.com/conflict-uuid.webp
P9999,https://example.com/unknown-prod.webp
O999,https://example.com/unknown-offer.webp
BADREF,https://example.com/badref.webp
`
    const stagedRes = await importStep2CsvIntoStagedDraft(tmpDir, stagedCsv, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(stagedRes.errors).toHaveLength(5)
    expect(stagedRes.errors.join('\n')).toMatch(/Duplicate|Conflicting/)
    expect(stagedRes.errors.join('\n')).toMatch(/Unknown or unmatched.*P9999/)
    expect(stagedRes.errors.join('\n')).toMatch(/Unknown or unmatched.*O999/)
    expect(stagedRes.errors.join('\n')).toMatch(/Unsupported or invalid.*BADREF/)
    expect(stagedRes.candidateImagesDownloadedCount).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Direct Step 3 validator checks
    const directValidation = await validateProductImageCsvImport(
      `Image_Ref,image_url
P1,https://example.com/a.webp
p1,https://example.com/a-dup.webp
P9999,https://example.com/unknown.webp
O999,https://example.com/unknown-o.webp
`,
      { mapFilePath: testMapPath }
    )
    expect(directValidation.ok).toBe(false)
    expect(directValidation.errorCount).toBe(3)
    expect(directValidation.errors.join('\n')).toMatch(/Duplicate reference/)
    expect(directValidation.errors.join('\n')).toMatch(/Product '9999' does not exist/)
    expect(directValidation.errors.join('\n')).toMatch(/O999/)
  })

  it('13. Rejects invalid, accidental-date, non-HTTPS, and SSRF localhost URLs cleanly', async () => {
    const draft = makeDraft(tmpDir, {
      header: {
        supermarketId: MASTER_SUPERMARKETS[0].id,
        region: 'National',
        validFrom: '2026-11-04',
        validTo: '2026-11-10',
        headerModifiedByOperator: true
      },
      items: [
        makeItem({ id: 'offer-url-1', imageRef: 'O1', titleEn: 'Item 1' }),
        makeItem({ id: 'offer-url-2', imageRef: 'O2', titleEn: 'Item 2' }),
        makeItem({ id: 'offer-url-3', imageRef: 'O3', titleEn: 'Item 3' }),
        makeItem({ id: 'offer-url-4', imageRef: 'O4', titleEn: 'Item 4' })
      ]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    const badUrlCsv = `Image_Ref,image_url
O1,2026-11-04
O2,http://example.com/insecure.webp
O3,not-a-valid-url
`
    const res = await importStep2CsvIntoStagedDraft(tmpDir, badUrlCsv, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })

    expect(res.errors).toHaveLength(3)
    expect(res.errors[0]).toContain('Invalid image URL format')
    expect(res.errors[1]).toContain('must use HTTPS protocol')
    expect(res.errors[2]).toContain('Invalid image URL format')
    expect(res.candidateImagesFailedCount).toBe(3)
    expect(fetchSpy).not.toHaveBeenCalled()

    // Test SSRF local IP block on O4
    const ssrfRes = await importStep2CsvIntoStagedDraft(
      tmpDir,
      `Image_Ref,image_url\nO4,https://127.0.0.1/internal.png\n`,
      { mapFilePath: testMapPath, supabaseClient: mockSupabase }
    )
    expect(ssrfRes.candidateImagesFailedCount).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    const reloaded = await loadStagedLeafletDraft(tmpDir, { skipAutoInit: true })
    expect(reloaded!.items.find((i) => i.imageRef === 'O4')?.candidateDownloadError).toMatch(/SSRF guard blocked/i)
  })

  it('14. Preserves product-images / offer-display-images routing, approval/rights gates, and product identity contradiction blocking', async () => {
    const repOfferUuid = '44444444-4444-4444-8888-444444444444'
    const memberOfferUuid = '55555555-5555-4444-8888-555555555555'

    mockDb.offers.set(repOfferUuid, {
      id: repOfferUuid,
      source_offer_id: 'route-o-rep',
      title_en: 'Tide Washing Powder 5Kg',
      title_ar: 'مسحوق غسيل تايد ٥ كجم',
      sale_unit_type: 'pack',
      product_id: null,
      contract_v2: {}
    })
    mockDb.offer_visual_group_members.push({
      representative_offer_id: repOfferUuid,
      member_offer_id: memberOfferUuid,
      visual_subject_key: 'generic:tide-washing-powder-5kg',
      visual_subject_name: 'Tide Washing Powder 5Kg'
    })

    const csv = `Image_Ref,image_url
P1,https://example.com/nadec-p1.png
O${repOfferUuid},https://example.com/tide-o1.webp
`
    await expect(
      uploadApprovedProductImagesToDb({
        csvContent: csv,
        operatorConfirmedReview: false,
        mapFilePath: testMapPath
      })
    ).rejects.toThrow(/Operator review confirmation is required/i)

    const uploadRes = await uploadApprovedProductImagesToDb({
      csvContent: csv,
      operatorConfirmedReview: true,
      reviewedBy: 'qa-lead',
      rightsBasis: 'manufacturer_website',
      mapFilePath: testMapPath
    })
    expect(uploadRes.uploadedCount).toBe(2)
    expect(mockDb.storageUploads.some((u) => u.bucket === 'product-images')).toBe(true)
    expect(mockDb.storageUploads.some((u) => u.bucket === 'offer-display-images')).toBe(true)
    expect(mockDb.products.get(1)?.approved_primary_image_id).toBeTruthy()
    expect(mockDb.offer_display_images.filter((i) => i.offer_id === repOfferUuid)).toHaveLength(1)
    expect(mockDb.offer_display_images.filter((i) => i.offer_id === memberOfferUuid)).toHaveLength(1)
    expect(mockDb.product_images[0].rights_basis).toBe('manufacturer_website')

    // Now test publish gate & identity contradiction blocking
    const danube = MASTER_SUPERMARKETS.find((s) => s.slug === 'danube')!
    const fp14 = crypto.createHash('sha256').update('fp-identity-gate-14').digest('hex')
    registeredFingerprints.add(fp14)

    const candidateLocal = path.join(tmpDir, 'dove.webp')
    fs.writeFileSync(candidateLocal, validWebpBuffer)

    const draft = makeDraft(tmpDir, {
      leafletHash: fp14,
      header: {
        supermarketId: danube.id,
        region: 'National',
        locationScope: 'national',
        validFrom: '2026-11-04',
        validTo: '2026-11-10',
        headerModifiedByOperator: true
      },
      items: [
        makeItem({
          id: '66666666-6666-4444-8888-666666666666',
          sourceOfferId: 'contradict-dove',
          imageRef: 'O8',
          titleEn: 'Dove Body Wash 500ml',
          titleAr: 'غسول جسم دوف ٥٠٠ مل',
          brand: 'Dove',
          sizeOrWeight: '500ml',
          matchedProductId: 1, // Contradicts Nadec Fresh Milk 1L!
          operatorApprovedIdentity: true,
          operatorApprovedProductId: 1,
          selectedImageSource: 'candidate',
          candidateImageLocalPath: candidateLocal,
          candidateImageUrl: 'https://example.com/dove.webp'
        })
      ]
    })
    await saveStagedLeafletDraft(tmpDir, draft)

    getLeafletMetadataService().confirmMetadata({
      leafletFingerprint: fp14,
      supermarketId: danube.id,
      startDate: '2026-11-04',
      endDate: '2026-11-10',
      locationScope: 'national',
      workspacePath: tmpDir
    })

    const unconfirmedPub = await publishStagedLeafletDraftToDb(tmpDir, {
      operatorConfirmedPublish: false,
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })
    expect(unconfirmedPub.ok).toBe(false)
    expect(unconfirmedPub.errors[0]).toContain('Operator confirmation required')

    const pubRes = await publishStagedLeafletDraftToDb(tmpDir, {
      operatorConfirmedPublish: true,
      reviewedBy: 'qa-lead',
      rightsBasis: 'operator_manual_verified',
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })
    // Identity contradiction error reported, and offer product_id forced to null
    expect(pubRes.errors.some((e) => e.includes('contradicted linked product #1'))).toBe(true)
    const publishedOffer = mockDb.offers.get('66666666-6666-4444-8888-666666666666')
    expect(publishedOffer.product_id).toBeNull()
    expect(publishedOffer.catalog_match_status).toBe('unresolved')
  })

  it('15. Stage 2 metadata gate blocks publishing when confirmed_metadata.json is missing (even with legacy CSV metadata) and succeeds once Stage 2 confirmMetadata runs', async () => {
    const danube = MASTER_SUPERMARKETS.find((s) => s.slug === 'danube')!
    const fp15 = crypto.createHash('sha256').update('fp-publish-gate-15').digest('hex')
    registeredFingerprints.add(fp15)

    const unconfirmedDraft = makeDraft(tmpDir, {
      leafletHash: fp15,
      header: {
        supermarketId: null,
        region: null,
        locationScope: null,
        validFrom: null,
        validTo: null,
        headerModifiedByOperator: false
      },
      items: [
        makeItem({
          id: '77777777-7777-4444-8888-777777777777',
          sourceOfferId: 'gate-15-offer',
          imageRef: 'O1',
          titleEn: 'Almarai Yogurt 170g',
          titleAr: 'زبادي المراعي ١٧٠ جم'
        })
      ]
    })
    await saveStagedLeafletDraft(tmpDir, unconfirmedDraft)

    const legacyCsv = `Image_Ref,image_url
O1,https://example.com/yogurt.webp
SMN,Danube
REG,National
SD,2026-11-04
ED,2026-11-10
`
    const importRes = await importStep2CsvIntoStagedDraft(tmpDir, legacyCsv, {
      mapFilePath: testMapPath,
      supabaseClient: mockSupabase
    })
    expect(importRes.errors).toEqual([])
    expect(importRes.missingMetadata).toBe(true)
    expect(importRes.requiresOperatorMetadataConfirmation).toBe(true)

    const blockedPub = await publishStagedLeafletDraftToDb(tmpDir, {
      operatorConfirmedPublish: true,
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })
    expect(blockedPub.ok).toBe(false)
    expect(blockedPub.errors.join(' ')).toMatch(/Header validation failed/i)

    const metadataService = getLeafletMetadataService()
    const directReadiness = metadataService.validatePublishReadiness({
      workspacePath: tmpDir,
      leafletFingerprint: fp15
    })
    expect(directReadiness.ok).toBe(false)
    expect(directReadiness.error).toContain('PUBLISH_BLOCKED')

    // Now operator confirms Stage 2 metadata & syncs staged draft header cleanly
    metadataService.confirmMetadata({
      leafletFingerprint: fp15,
      supermarketId: danube.id,
      startDate: '2026-11-04',
      endDate: '2026-11-10',
      locationScope: 'national',
      workspacePath: tmpDir
    })
    await updateStagedLeafletHeader(tmpDir, {
      supermarketId: danube.id,
      region: 'National',
      locationScope: 'national',
      validFrom: '2026-11-04',
      validTo: '2026-11-10'
    })

    const okPub = await publishStagedLeafletDraftToDb(tmpDir, {
      operatorConfirmedPublish: true,
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })
    expect(okPub.ok).toBe(true)
    expect(okPub.errors).toEqual([])
    expect(okPub.offersPublishedCount).toBe(1)
    expect(okPub.offerDisplayImagesUploadedCount).toBe(1)
    expect(mockDb.removedStoragePaths).toEqual([])
  })
})
