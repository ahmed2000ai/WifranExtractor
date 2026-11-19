import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  uploadLeafletBoundaryPagesForMetadata,
  preMatchLocalOffersAgainstDb,
  exportStagedLeafletForStep2,
  loadStagedLeafletDraft,
  saveStagedLeafletDraft,
  exportProductsForImageSearch,
  initializeStagedDraftFromPackage,
  parseLeafletFilenameMetadata
} from '../../../main/db/productImageEnrichmentService'
import type { StagedLeafletDraft, StagedOfferItem } from '../../../shared/types/productImageEnrichment'

// Realistic 1x1 PNG and WebP buffers
const validPngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
])

describe('WIFRAN-07J Phase 1: Local Staging, Boundary Page Upload, Read-Only Pre-Match & 6-Col CSV', () => {
  let tmpDir: string
  let testMapPath: string

  // Mock Database Store
  let mockDb: {
    products: Map<number, any>
    product_aliases: any[]
    offer_display_images: any[]
    offer_visual_group_members: any[]
    supermarkets: any[]
    regions: any[]
    storage: Record<string, Map<string, Buffer>>
  }

  let mockSupabase: any

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-phase1-test-'))
    testMapPath = path.join(tmpDir, 'test-offer-map.json')

    mockDb = {
      products: new Map(),
      product_aliases: [],
      offer_display_images: [],
      offer_visual_group_members: [],
      supermarkets: [
        { id: 'alwafa', name_en: 'Hyper Alwafa', name_ar: 'هايبر الوفاء', slug: 'alwafa' },
        { id: 'panda', name_en: 'Panda', name_ar: 'بنده', slug: 'panda' }
      ],
      regions: [
        { id: 'jeddah', name_en: 'Jeddah', name_ar: 'جدة', slug: 'jeddah' },
        { id: 'western-region', name_en: 'Western Region', name_ar: 'المنطقة الغربية', slug: 'western-region' }
      ],
      storage: {
        'offer-display-images': new Map(),
        'product-images': new Map(),
        'tmp': new Map()
      }
    }

    // Seed mock database
    // Product 1: WITH approved image
    mockDb.products.set(1, {
      id: 1,
      name_en: 'Almarai Fresh Milk Full Fat 1L',
      name_ar: 'حليب المراعي طازج كامل الدسم ١ لتر',
      slug: 'almarai-fresh-milk-1l',
      approved_primary_image_id: 'img-p1',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/almarai-1l.webp',
      verification_status: 'verified'
    })

    // Product 2: WITHOUT image
    mockDb.products.set(2, {
      id: 2,
      name_en: 'Nadec Fresh Milk 1L',
      name_ar: 'حليب نادك طازج ١ لتر',
      slug: 'nadec-fresh-milk-1l',
      approved_primary_image_id: null,
      default_image_url: null,
      verification_status: 'verified'
    })

    // Alias for Product 1
    mockDb.product_aliases.push({
      product_id: 1,
      alias_text: 'almarai milk 1l'
    })

    // Approved illustrative image for visual subject 'commodity:persian-cucumber:kg'
    mockDb.offer_display_images.push({
      id: 'img-cucumbers',
      offer_id: 'offer-cuc-rep',
      visual_subject_key: 'commodity:persian-cucumber:kg',
      approval_status: 'approved',
      public_url: 'https://storage.wifran.com/offer-display-images/offers/persian-cucumber.webp'
    })

    // Supabase Client Mock
    mockSupabase = {
      from: vi.fn((table: string) => {
        let filters: any[] = []

        const queryObj: any = {
          select: vi.fn(() => {
            return queryObj
          }),
          eq: vi.fn((col: string, val: any) => {
            filters.push({ col, op: 'eq', val })
            return queryObj
          }),
          ilike: vi.fn((col: string, val: any) => {
            filters.push({ col, op: 'ilike', val })
            return queryObj
          }),
          is: vi.fn((col: string, val: any) => {
            filters.push({ col, op: 'is', val })
            return queryObj
          }),
          in: vi.fn((col: string, val: any[]) => {
            filters.push({ col, op: 'in', val })
            return queryObj
          }),
          order: vi.fn(() => queryObj),
          limit: vi.fn(() => queryObj),
          maybeSingle: vi.fn(async () => {
            const { data } = await queryObj
            return { data: data && data.length > 0 ? data[0] : null, error: null }
          }),
          insert: vi.fn((rows: any | any[]) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            if (table === 'supermarkets') {
              mockDb.supermarkets = [...(mockDb.supermarkets || []), ...arr]
            } else if (table === 'regions') {
              mockDb.regions = [...(mockDb.regions || []), ...arr]
            }
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: arr[0], error: null })),
                maybeSingle: vi.fn(async () => ({ data: arr[0], error: null }))
              }))
            }
          }),
          then: (resolve: any) => {
            let records: any[] = []
            if (table === 'products') {
              records = Array.from(mockDb.products.values())
            } else if (table === 'product_aliases') {
              records = [...mockDb.product_aliases]
            } else if (table === 'offer_display_images') {
              records = [...mockDb.offer_display_images]
            } else if (table === 'offer_visual_group_members') {
              records = [...mockDb.offer_visual_group_members]
            } else if (table === 'supermarkets') {
              records = [...(mockDb.supermarkets || [])]
            } else if (table === 'regions') {
              records = [...(mockDb.regions || [])]
            }

            // Apply filters
            let filtered = records.filter((r) => {
              for (const f of filters) {
                if (f.op === 'eq' && r[f.col] !== f.val) return false
                if (f.op === 'ilike') {
                  const target = String(r[f.col] || '').toLowerCase()
                  const pattern = String(f.val || '').replace(/%/g, '').toLowerCase()
                  if (!target.includes(pattern)) return false
                }
                if (f.op === 'is') {
                  if (f.val === null && r[f.col] !== null && r[f.col] !== undefined) return false
                }
                if (f.op === 'in') {
                  if (!f.val.includes(r[f.col])) return false
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
        from: vi.fn((bucket: string) => ({
          upload: vi.fn(async (objPath: string, buffer: Buffer) => {
            if (!mockDb.storage[bucket]) {
              mockDb.storage[bucket] = new Map()
            }
            mockDb.storage[bucket].set(objPath, buffer)
            return { data: { path: objPath }, error: null }
          }),
          getPublicUrl: vi.fn((objPath: string) => ({
            data: { publicUrl: `https://storage.wifran.com/${bucket}/${objPath}` }
          }))
        }))
      }
    }
  })

  describe('1. Local Boundary Page Preview Resolution (Zero Public tmp Uploads)', () => {
    it('Locates boundary pages locally without uploading to tmp bucket and persists local preview paths to staged-draft.json', async () => {
      // Create pages directory with 3 pages
      const pagesDir = path.join(tmpDir, 'pages')
      fs.mkdirSync(pagesDir, { recursive: true })
      fs.writeFileSync(path.join(pagesDir, 'page-001.png'), validPngBuffer)
      fs.writeFileSync(path.join(pagesDir, 'page-002.png'), validPngBuffer)
      fs.writeFileSync(path.join(pagesDir, 'page-003.png'), validPngBuffer)

      const result = await uploadLeafletBoundaryPagesForMetadata(
        tmpDir,
        'hash-test-leaflet-123',
        undefined,
        { supabaseClient: mockSupabase }
      )

      expect(result.firstPagePublicUrl).toBeNull()
      expect(result.lastPagePublicUrl).toBeNull()
      expect(result.firstPageTmpPath).toBeNull()
      expect(result.lastPageTmpPath).toBeNull()
      expect(result.firstPageLocalPath).toContain('page-001.png')
      expect(result.lastPageLocalPath).toContain('page-003.png')
      expect(result.firstPageNumber).toBe(1)
      expect(result.lastPageNumber).toBe(3)
      expect(result.localPreviewPages).toHaveLength(3)

      // Verify zero uploads in storage mock 'tmp' bucket
      expect(mockDb.storage['tmp'].size).toBe(0)

      // Verify draft saved to disk with local preview fields and null public URLs
      const draft = await loadStagedLeafletDraft(tmpDir)
      expect(draft).not.toBeNull()
      expect(draft?.header.firstPagePublicUrl).toBeNull()
      expect(draft?.header.lastPagePublicUrl).toBeNull()
      expect(draft?.header.firstPageTmpPath).toBeNull()
      expect(draft?.header.lastPageTmpPath).toBeNull()
      expect(draft?.header.firstPageLocalPath).toContain('page-001.png')
      expect(draft?.header.lastPageLocalPath).toContain('page-003.png')
    })

    it('Handles single-page leaflets gracefully with identical local first and last preview path', async () => {
      const pagesDir = path.join(tmpDir, 'pages')
      fs.mkdirSync(pagesDir, { recursive: true })
      fs.writeFileSync(path.join(pagesDir, 'page-001.png'), validPngBuffer)

      const result = await uploadLeafletBoundaryPagesForMetadata(
        tmpDir,
        'single-page-hash',
        undefined,
        { supabaseClient: mockSupabase }
      )

      expect(result.firstPagePublicUrl).toBeNull()
      expect(result.lastPagePublicUrl).toBeNull()
      expect(result.firstPageTmpPath).toBeNull()
      expect(result.lastPageTmpPath).toBeNull()
      expect(result.firstPageLocalPath).toBe(result.lastPageLocalPath)
      expect(result.firstPageLocalPath).toContain('page-001.png')
      expect(mockDb.storage['tmp'].size).toBe(0)
    })

    it('Selects specified local metadataPageNumber without uploading to tmp bucket and emits zero FPTSP/LPTSP in Step 1 CSV', async () => {
      const leafletDir = path.join(tmpDir, 'leaflet-single-meta')
      const pagesDir = path.join(leafletDir, 'pages')
      fs.mkdirSync(pagesDir, { recursive: true })
      fs.writeFileSync(path.join(pagesDir, 'page-001.png'), validPngBuffer)
      fs.writeFileSync(path.join(pagesDir, 'page-002.png'), validPngBuffer)
      fs.writeFileSync(path.join(pagesDir, 'page-003.png'), validPngBuffer)

      const uploadSpy = vi.fn(async (objPath: string, buffer: Buffer) => {
        if (!mockDb.storage['tmp']) {
          mockDb.storage['tmp'] = new Map()
        }
        mockDb.storage['tmp'].set(objPath, buffer)
        return { data: { path: objPath }, error: null }
      })

      const customSupabase = {
        ...mockSupabase,
        storage: {
          from: vi.fn((bucket: string) => ({
            upload: uploadSpy,
            getPublicUrl: vi.fn((objPath: string) => ({
              data: { publicUrl: `https://storage.wifran.com/${bucket}/${objPath}` }
            }))
          }))
        }
      }

      // Test A: Pass metadataPageNumber: 2
      const result = await uploadLeafletBoundaryPagesForMetadata(
        leafletDir,
        'hash-3page-leaflet',
        undefined,
        {
          supabaseClient: customSupabase,
          metadataPageNumber: 2
        }
      )

      // Zero storage uploads made
      expect(uploadSpy).toHaveBeenCalledTimes(0)
      expect(mockDb.storage['tmp'].size).toBe(0)

      expect(result.firstPagePublicUrl).toBeNull()
      expect(result.lastPagePublicUrl).toBeNull()
      expect(result.firstPageTmpPath).toBeNull()
      expect(result.lastPageTmpPath).toBeNull()
      expect(result.firstPageLocalPath).toContain('page-002.png')
      expect(result.firstPageNumber).toBe(2)
      expect(result.lastPageLocalPath).toBeNull()

      // Add a sample staged item to test Step 1 CSV export emits P/O only
      const draft = await loadStagedLeafletDraft(leafletDir)
      expect(draft).not.toBeNull()
      draft!.items = [
        {
          id: 'item-test-1',
          originalOcr: { titleEn: 'Sample Item 1', titleAr: 'عنصر تجريبي' },
          isAiCorrected: false,
          operatorEditedFields: [],
          isOperatorModified: false,
          croppedEvidenceLocalPath: '/crops/c1.webp',
          selectedImageSource: 'none'
        }
      ]
      await saveStagedLeafletDraft(leafletDir, draft!)

      const exportRes = await exportStagedLeafletForStep2(leafletDir, {
        supabaseClient: customSupabase,
        mapFilePath: testMapPath
      })

      const lines = exportRes.csvContent.replace('\uFEFF', '').split('\r\n')
      expect(lines[0]).toBe('Image_Ref,Item_Name')
      expect(exportRes.csvContent).not.toContain('FPTSP')
      expect(exportRes.csvContent).not.toContain('LPTSP')
      expect(exportRes.metadataRowsCount).toBe(0)
      expect(lines).toHaveLength(2)

      // Test B: Leaving metadataPageNumber undefined resolves pages 1 and 3 locally with 0 uploads
      const defaultLeafletDir = path.join(tmpDir, 'leaflet-default-meta')
      const defaultPagesDir = path.join(defaultLeafletDir, 'pages')
      fs.mkdirSync(defaultPagesDir, { recursive: true })
      fs.writeFileSync(path.join(defaultPagesDir, 'page-001.png'), validPngBuffer)
      fs.writeFileSync(path.join(defaultPagesDir, 'page-002.png'), validPngBuffer)
      fs.writeFileSync(path.join(defaultPagesDir, 'page-003.png'), validPngBuffer)

      const defaultResult = await uploadLeafletBoundaryPagesForMetadata(
        defaultLeafletDir,
        'hash-default-leaflet',
        undefined,
        {
          supabaseClient: customSupabase
        }
      )

      expect(uploadSpy).toHaveBeenCalledTimes(0)
      expect(defaultResult.firstPagePublicUrl).toBeNull()
      expect(defaultResult.lastPagePublicUrl).toBeNull()
      expect(defaultResult.firstPageLocalPath).toContain('page-001.png')
      expect(defaultResult.lastPageLocalPath).toContain('page-003.png')

      const defaultDraft = await loadStagedLeafletDraft(defaultLeafletDir)
      defaultDraft!.items = [
        {
          id: 'item-test-2',
          originalOcr: { titleEn: 'Sample Item 2', titleAr: 'عنصر تجريبي ٢' },
          isAiCorrected: false,
          operatorEditedFields: [],
          isOperatorModified: false,
          croppedEvidenceLocalPath: '/crops/c2.webp',
          selectedImageSource: 'none'
        }
      ]
      await saveStagedLeafletDraft(defaultLeafletDir, defaultDraft!)

      const defaultExportRes = await exportStagedLeafletForStep2(defaultLeafletDir, {
        supabaseClient: customSupabase,
        mapFilePath: testMapPath
      })

      expect(defaultExportRes.csvContent).not.toContain('FPTSP')
      expect(defaultExportRes.csvContent).not.toContain('LPTSP')
      expect(defaultExportRes.metadataRowsCount).toBe(0)
    })
  })

  describe('2. Read-Only DB Pre-Matching', () => {
    it('Case A: Excludes offer matched to Product WITH existing image from Step 1 export', async () => {
      const items: StagedOfferItem[] = [
        {
          id: 'offer-p1-match',
          originalOcr: {
            titleEn: 'Almarai Fresh Milk Full Fat 1L',
            titleAr: 'حليب المراعي طازج كامل الدسم ١ لتر',
            brand: 'Almarai'
          },
          titleEn: 'Almarai Fresh Milk Full Fat 1L',
          titleAr: 'حليب المراعي طازج كامل الدسم ١ لتر',
          isAiCorrected: false,
          operatorEditedFields: [],
          isOperatorModified: false,
          croppedEvidenceLocalPath: '/crops/p1.webp',
          selectedImageSource: 'none'
        }
      ]

      const res = await preMatchLocalOffersAgainstDb(items, {
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.matchedWithExistingDbImageCount).toBe(1)
      expect(res.exportableCount).toBe(0)
      expect(items[0].matchedProductId).toBe(1)
      expect(items[0].existingDbImageUrl).toBe('https://storage.wifran.com/product-images/catalog/almarai-1l.webp')
      expect(items[0].selectedImageSource).toBe('existing_db')
      expect(items[0].imageRef).toBeUndefined()
    })

    it('Case B: Includes offer matched to Product WITHOUT image as P<id>', async () => {
      const items: StagedOfferItem[] = [
        {
          id: 'offer-p2-match',
          originalOcr: {
            titleEn: 'Nadec Fresh Milk 1L',
            titleAr: 'حليب نادك طازج ١ لتر',
            brand: 'Nadec'
          },
          isAiCorrected: false,
          operatorEditedFields: [],
          isOperatorModified: false,
          croppedEvidenceLocalPath: '/crops/p2.webp',
          selectedImageSource: 'none'
        }
      ]

      const res = await preMatchLocalOffersAgainstDb(items, {
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.matchedProductWithoutImageCount).toBe(1)
      expect(res.exportableCount).toBe(1)
      expect(items[0].matchedProductId).toBe(2)
      expect(items[0].existingDbImageUrl).toBeNull()
      expect(items[0].imageRef).toBe('P2')
      expect(items[0].selectedImageSource).toBe('none')
    })

    it('Case C1: Excludes unmatched offer if approved illustrative image exists in DB for visual subject', async () => {
      const items: StagedOfferItem[] = [
        {
          id: 'offer-cucumber-unmatched',
          originalOcr: {
            titleEn: 'Persian Cucumber per kg',
            titleAr: 'خيار بلدي بالكيلو'
          },
          isAiCorrected: false,
          operatorEditedFields: [],
          isOperatorModified: false,
          croppedEvidenceLocalPath: '/crops/cucumber.webp',
          selectedImageSource: 'none'
        }
      ]

      const res = await preMatchLocalOffersAgainstDb(items, {
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.unmatchedWithExistingDbImageCount).toBe(1)
      expect(res.exportableCount).toBe(0)
      expect(items[0].matchedProductId).toBeUndefined()
      expect(items[0].matchedVisualSubjectKey).toBe('commodity:persian-cucumber:kg')
      expect(items[0].existingDbImageUrl).toBe('https://storage.wifran.com/offer-display-images/offers/persian-cucumber.webp')
      expect(items[0].selectedImageSource).toBe('existing_db')
    })

    it('Case C2: Assigns short O<n> reference to net-new unmatched offer without DB image', async () => {
      const items: StagedOfferItem[] = [
        {
          id: 'offer-new-torch',
          originalOcr: {
            titleEn: 'Krypton Heavy Duty Flashlight',
            titleAr: 'كربتون كشاف قوي'
          },
          isAiCorrected: false,
          operatorEditedFields: [],
          isOperatorModified: false,
          croppedEvidenceLocalPath: '/crops/torch.webp',
          selectedImageSource: 'none'
        }
      ]

      const res = await preMatchLocalOffersAgainstDb(items, {
        supabaseClient: mockSupabase,
        mapFilePath: testMapPath
      })

      expect(res.unmatchedOfferCount).toBe(1)
      expect(res.exportableCount).toBe(1)
      expect(items[0].imageRef).toBe('O1')
      expect(items[0].selectedImageSource).toBe('none')
    })
  })

  describe('3. Product/Offer-Only Step 1 CSV Export (No Boundary or Metadata Rows)', () => {
    it('Exports strictly 2-column CSV with UTF-8 BOM and net-new P and O rows only', async () => {
      const draft: StagedLeafletDraft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir: tmpDir,
        leafletHash: 'leaflet-abc-456',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: {
          firstPagePublicUrl: null,
          lastPagePublicUrl: null,
          firstPageTmpPath: null,
          lastPageTmpPath: null,
          supermarketId: 'alwafa',
          region: 'Jeddah',
          validFrom: '2026-11-01',
          validTo: '2026-11-07',
          headerModifiedByOperator: false
        },
        items: [
          // Item 1: Product 1 (Already has image -> should be skipped)
          {
            id: 'item-1',
            matchedProductId: 1,
            existingDbImageUrl: 'https://storage.wifran.com/product-images/catalog/almarai-1l.webp',
            selectedImageSource: 'existing_db',
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/1.webp',
            originalOcr: {
              titleEn: 'Almarai Fresh Milk 1L',
              titleAr: 'حليب المراعي ١ لتر',
              brand: 'Almarai',
              sizeOrWeight: '1L'
            }
          },
          // Item 2: Product 2 (No image -> should be exported as P2)
          {
            id: 'item-2',
            matchedProductId: 2,
            existingDbImageUrl: null,
            selectedImageSource: 'none',
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/2.webp',
            originalOcr: {
              titleEn: 'Nadec Fresh Milk 1L',
              titleAr: 'حليب نادك طازج ١ لتر',
              brand: 'Nadec',
              sizeOrWeight: '1L'
            }
          },
          // Item 3: Unmatched Strawberry 250g (Representative -> should be O1)
          {
            id: 'item-3-strawb-rep',
            matchedProductId: null,
            existingDbImageUrl: null,
            selectedImageSource: 'none',
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/3.webp',
            originalOcr: {
              titleEn: 'Fresh Strawberries 250g',
              titleAr: 'فراولة طازجة ٢٥٠ جم',
              brand: '',
              sizeOrWeight: '250g'
            }
          },
          // Item 4: Unmatched Strawberry 250g member (Same visual subject -> should be consolidated under O1)
          {
            id: 'item-4-strawb-mem',
            matchedProductId: null,
            existingDbImageUrl: null,
            selectedImageSource: 'none',
            isAiCorrected: false,
            operatorEditedFields: [],
            isOperatorModified: false,
            croppedEvidenceLocalPath: '/crops/4.webp',
            originalOcr: {
              titleEn: 'Fresh Strawberries 250g',
              titleAr: 'فراولة طازجة ٢٥٠ جم',
              brand: '',
              sizeOrWeight: '250g'
            }
          }
        ]
      }

      await saveStagedLeafletDraft(tmpDir, draft)

      const exportRes = await exportStagedLeafletForStep2(tmpDir, {
        mapFilePath: testMapPath,
        supabaseClient: mockSupabase
      })

      // Check UTF-8 BOM
      expect(exportRes.csvContent.startsWith('\uFEFF')).toBe(true)

      const lines = exportRes.csvContent.replace('\uFEFF', '').split('\r\n')
      expect(lines[0]).toBe('Image_Ref,Item_Name')
      expect(lines).toHaveLength(3)

      // Verify row counts:
      // Item 1 is skipped (already has image in DB)
      // Item 2 is P2
      // Item 3 is O1 (representative)
      // Item 4 is consolidated under O1
      expect(exportRes.exportableCount).toBe(2)
      expect(exportRes.skippedAlreadyImagedCount).toBe(1)
      expect(exportRes.pCount).toBe(1)
      expect(exportRes.oCount).toBe(1)
      expect(exportRes.metadataRowsCount).toBe(0)

      // Verify P2 row: compact combined item name
      expect(lines[1]).toBe('"P2","Nadec Fresh Milk 1L | حليب نادك طازج"')

      // Verify O1 row: compact combined item name
      expect(lines[2]).toBe('"O1","Fresh Strawberries 250g | فراولة طازجة"')

      // Verify zero boundary/metadata rows emitted
      expect(exportRes.csvContent).not.toContain('FPTSP')
      expect(exportRes.csvContent).not.toContain('LPTSP')
      expect(exportRes.csvContent).not.toContain('SMN')
      expect(exportRes.csvContent).not.toContain('REG')
      expect(exportRes.csvContent).not.toContain('SD,')
      expect(exportRes.csvContent).not.toContain('ED,')

      // Verify draft links between representative and member
      const updatedDraft = await loadStagedLeafletDraft(tmpDir)
      const repItem = updatedDraft?.items.find((i) => i.id === 'item-3-strawb-rep')
      const memItem = updatedDraft?.items.find((i) => i.id === 'item-4-strawb-mem')

      expect(repItem?.isRepresentative).toBe(true)
      expect(repItem?.imageRef).toBe('O1')
      expect(repItem?.visualGroupMemberIds).toContain('item-4-strawb-mem')

      expect(memItem?.isRepresentative).toBe(false)
      expect(memItem?.representativeOfferId).toBe('item-3-strawb-rep')
      expect(memItem?.imageRef).toBe('O1')
    })
  })

  describe('4. Legacy 2-Column CSV Backward Compatibility', () => {
    it('Preserves legacy exportProductsForImageSearch functionality for existing tests', async () => {
      // exportProductsForImageSearch queries supabase.from('products') and supabase.from('offers')
      const res = await exportProductsForImageSearch({
        includeUnresolvedOffers: false,
        mapFilePath: testMapPath
      })

      expect(res.csvContent.startsWith('\uFEFF')).toBe(true)
      const lines = res.csvContent.replace('\uFEFF', '').split('\r\n')
      expect(lines[0]).toBe('Image_Ref,item_name')
    })
  })

  describe('5. Filename Metadata Parsing & Staged Draft Header Auto-Population', () => {
    it('Accurately parses SupermarketName, LeafletNo, and Region from various hyphenated PDF filenames', () => {
      const parsed1 = parseLeafletFilenameMetadata('Al-Wafa-Hypermarket-12-Jeddah.pdf')
      expect(parsed1.rawSupermarketName).toBe('Al Wafa Hypermarket')
      expect(parsed1.leafletNumber).toBe('12')
      expect(parsed1.rawRegionName).toBe('Jeddah')

      const parsed2 = parseLeafletFilenameMetadata('Hyper-Panda-102-Western-Region.pdf')
      expect(parsed2.rawSupermarketName).toBe('Hyper Panda')
      expect(parsed2.leafletNumber).toBe('102')
      expect(parsed2.rawRegionName).toBe('Western Region')

      const parsed3 = parseLeafletFilenameMetadata('Al-Wafa-04-Jeddah.pdf')
      expect(parsed3.rawSupermarketName).toBe('Al Wafa')
      expect(parsed3.leafletNumber).toBe('04')
      expect(parsed3.rawRegionName).toBe('Jeddah')

      // Windows/Unix full path support
      const parsedPath = parseLeafletFilenameMetadata('C:\\Downloads\\Leaflets\\Hyper-Panda-42-Riyadh.pdf')
      expect(parsedPath.rawSupermarketName).toBe('Hyper Panda')
      expect(parsedPath.leafletNumber).toBe('42')
      expect(parsedPath.rawRegionName).toBe('Riyadh')

      // Non-matching fallback
      const nonMatching = parseLeafletFilenameMetadata('just_a_random_leaflet.pdf')
      expect(nonMatching.rawSupermarketName).toBeNull()
      expect(nonMatching.leafletNumber).toBeNull()
      expect(nonMatching.rawRegionName).toBeNull()
    })

    it('Pre-populates supermarketId and region in staged-draft.json during draft initialization from PDF filename', async () => {
      // Create a test page so boundary upload succeeds
      const pagesDir = path.join(tmpDir, 'pages')
      fs.mkdirSync(pagesDir, { recursive: true })
      fs.writeFileSync(path.join(pagesDir, 'page-001.png'), validPngBuffer)

      const draft = await initializeStagedDraftFromPackage(tmpDir, {
        pdfFileName: 'Al-Wafa-04-Jeddah.pdf',
        supabaseClient: mockSupabase
      })

      expect(draft.header.supermarketId).toBe('alwafa')
      expect(draft.header.region).toBe('Jeddah')

      // Verify persisted on disk
      const saved = await loadStagedLeafletDraft(tmpDir)
      expect(saved?.header.supermarketId).toBe('alwafa')
      expect(saved?.header.region).toBe('Jeddah')
    })
  })
})
