import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import crypto from 'crypto'
import {
  publishStagedLeafletDraftToDb,
  saveStagedLeafletDraft
} from '../../../main/db/productImageEnrichmentService'
import {
  loadOfferRefMap,
  saveOfferRefMap,
  assignShortOfferRef
} from '../../../main/db/offerImageRefMapper'
import type { StagedLeafletDraft, StagedOfferItem } from '../../../shared/types/productImageEnrichment'

// Valid WebP 1x1 image buffer
const sampleWebpBuffer = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
  0x0e, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe,
  0x07, 0x00
])

describe('WIFRAN-07J Phase 4: Atomic Single-Publish Pipeline & Alias Learning', () => {
  let tmpDir: string
  let testMapPath: string

  let mockDb: {
    leaflets: any[]
    offers: any[]
    products: Map<number, any>
    product_aliases: any[]
    product_images: any[]
    offer_display_images: any[]
    offer_visual_group_members: any[]
  }

  let storageUploads: Array<{ bucket: string; path: string; buffer: Buffer }>

  let mockSupabase: any

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-phase4-test-'))
    testMapPath = path.join(tmpDir, 'test-offer-map.json')
    storageUploads = []

    mockDb = {
      leaflets: [],
      offers: [],
      products: new Map(),
      product_aliases: [],
      product_images: [],
      offer_display_images: [],
      offer_visual_group_members: []
    }

    // Seed P1: Already-imaged product
    mockDb.products.set(1, {
      id: 1,
      name_en: 'Almarai Fresh Milk 1L',
      name_ar: 'حليب المراعي طازج ١ لتر',
      approved_primary_image_id: 'img-p1',
      default_image_url: 'https://example.com/p1.webp'
    })

    // Seed P6: Target product for post-correction alias learning
    mockDb.products.set(6, {
      id: 6,
      name_en: "L'Oreal Elvive Shampoo 400ml",
      name_ar: 'لوريال الفيف شامبو ٤٠٠ مل',
      approved_primary_image_id: null,
      default_image_url: null
    })

    // Initialize mock Supabase client
    mockSupabase = {
      from: vi.fn((table: string) => {
        let filters: any[] = []
        let updatePayload: any = null

        const queryObj: any = {
          select: vi.fn(() => queryObj),
          eq: vi.fn((col: string, val: any) => {
            filters.push({ col, op: 'eq', val })
            return queryObj
          }),
          limit: vi.fn(() => queryObj),
          maybeSingle: vi.fn(async () => {
            const { data } = await queryObj
            return { data: data && data.length > 0 ? data[0] : null, error: null }
          }),
          single: vi.fn(async () => {
            const { data } = await queryObj
            return { data: data && data.length > 0 ? data[0] : null, error: null }
          }),
          upsert: vi.fn(async (payload: any) => {
            const records = Array.isArray(payload) ? payload : [payload]
            for (const r of records) {
              if (table === 'leaflets') mockDb.leaflets.push({ ...r })
              if (table === 'offers') mockDb.offers.push({ ...r })
              if (table === 'offer_display_images') mockDb.offer_display_images.push({ ...r })
              if (table === 'offer_visual_group_members') mockDb.offer_visual_group_members.push({ ...r })
            }
            return { data: payload, error: null }
          }),
          insert: vi.fn((payload: any) => {
            const record = { id: crypto.randomUUID(), ...payload }
            if (table === 'product_aliases') mockDb.product_aliases.push(record)
            if (table === 'product_images') mockDb.product_images.push(record)
            if (table === 'offer_display_images') mockDb.offer_display_images.push(record)
            if (table === 'offers') mockDb.offers.push(record)

            const chainObj: any = {
              select: vi.fn(() => chainObj),
              single: vi.fn(async () => ({ data: record, error: null })),
              maybeSingle: vi.fn(async () => ({ data: record, error: null })),
              then: (resolve: any) => resolve({ data: record, error: null })
            }
            return chainObj
          }),
          update: vi.fn((payload: any) => {
            updatePayload = payload
            return queryObj
          }),
          then: (resolve: any) => {
            if (updatePayload) {
              if (table === 'products') {
                const idFilter = filters.find((f) => f.col === 'id')
                if (idFilter && mockDb.products.has(idFilter.val)) {
                  const existing = mockDb.products.get(idFilter.val)
                  Object.assign(existing, updatePayload)
                }
              }
              if (table === 'product_images') {
                const idFilter = filters.find((f) => f.col === 'id')
                const img = mockDb.product_images.find((i) => i.id === idFilter?.val)
                if (img) Object.assign(img, updatePayload)
              }
              if (table === 'offer_display_images') {
                const idFilter = filters.find((f) => f.col === 'id')
                const img = mockDb.offer_display_images.find((i) => i.id === idFilter?.val)
                if (img) Object.assign(img, updatePayload)
              }
              return resolve({ data: updatePayload, error: null })
            }

            let records: any[] = []
            if (table === 'products') records = Array.from(mockDb.products.values())
            if (table === 'product_aliases') records = [...mockDb.product_aliases]
            if (table === 'product_images') records = [...mockDb.product_images]
            if (table === 'offer_display_images') records = [...mockDb.offer_display_images]
            if (table === 'offers') records = [...mockDb.offers]
            if (table === 'offer_visual_group_members') records = [...mockDb.offer_visual_group_members]

            const filtered = records.filter((r) => {
              for (const f of filters) {
                if (f.op === 'eq' && r[f.col] !== f.val) return false
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
            storageUploads.push({ bucket, path: objPath, buffer })
            return { data: { path: objPath }, error: null }
          }),
          getPublicUrl: vi.fn((objPath: string) => ({
            data: { publicUrl: `https://example.com/storage/${bucket}/${objPath}` }
          }))
        }))
      }
    }
  })

  // --------------------------------------------------------------------------
  // TEST 1: Pre-Publish Validation Gate
  // --------------------------------------------------------------------------
  it('enforces operator authorization gate and validates leaflet header metadata', async () => {
    const draft: StagedLeafletDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir: tmpDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      header: {
        supermarketId: null, // missing
        region: 'Western',
        validFrom: '2026-11-10',
        validTo: '2026-11-05', // invalid: validTo < validFrom
        headerModifiedByOperator: false
      },
      items: []
    }
    await saveStagedLeafletDraft(tmpDir, draft)

    // 1. Without operator confirmation
    const gateRes = await publishStagedLeafletDraftToDb(tmpDir, {
      operatorConfirmedPublish: false,
      supabaseClient: mockSupabase
    })
    expect(gateRes.ok).toBe(false)
    expect(gateRes.errors[0]).toContain('Operator confirmation required')

    // 2. With operator confirmation but invalid header
    const headerRes = await publishStagedLeafletDraftToDb(tmpDir, {
      operatorConfirmedPublish: true,
      supabaseClient: mockSupabase
    })
    expect(headerRes.ok).toBe(false)
    expect(headerRes.errors.some((e) => e.includes('Supermarket ID is required'))).toBe(true)
    expect(headerRes.errors.some((e) => e.includes('Valid To must be greater than or equal to Valid From'))).toBe(true)
  })

  // --------------------------------------------------------------------------
  // TEST 2: End-to-end atomic publish with Route P, Route O, alias learning, and short ref purge
  // --------------------------------------------------------------------------
  it('executes atomic single-publish, routes images, learns aliases on typos, and purges short ref IDs', async () => {
    // Write sample crop files into local tmpDir
    const cropsDir = path.join(tmpDir, 'crops')
    const candidatesDir = path.join(tmpDir, 'staged-candidate-images')
    await fs.promises.mkdir(cropsDir, { recursive: true })
    await fs.promises.mkdir(candidatesDir, { recursive: true })

    const cropPath1 = path.join(cropsDir, 'crop-item1.webp')
    const cropPath2 = path.join(cropsDir, 'crop-item2.webp')
    const cropPath3 = path.join(cropsDir, 'crop-item3.webp')
    await fs.promises.writeFile(cropPath1, sampleWebpBuffer)
    await fs.promises.writeFile(cropPath2, sampleWebpBuffer)
    await fs.promises.writeFile(cropPath3, sampleWebpBuffer)

    const candidateImgPath2 = path.join(candidatesDir, 'candidate-loreal.webp')
    const candidateImgPath3 = path.join(candidatesDir, 'candidate-lamp.webp')
    await fs.promises.writeFile(candidateImgPath2, sampleWebpBuffer)
    await fs.promises.writeFile(candidateImgPath3, sampleWebpBuffer)

    // Setup initial short-id map with O1
    const initialMap = await loadOfferRefMap(testMapPath)
    assignShortOfferRef('offer-generic-lamp', initialMap) // maps 'O1' <-> 'offer-generic-lamp'
    await saveOfferRefMap(initialMap, testMapPath)
    expect(initialMap.shortToUuid['O1']).toBe('offer-generic-lamp')
    expect(initialMap.nextSeq).toBe(2)

    // Construct 3 staged offer items:
    // a) Already-imaged DB product (P1) using existing_db
    const itemA: StagedOfferItem = {
      id: 'd1111111-1111-1111-1111-111111111111',
      sourceOfferId: 'd1111111-1111-1111-1111-111111111111',
      pageNumber: 1,
      croppedEvidenceLocalPath: cropPath1,
      matchedProductId: 1,
      existingDbImageUrl: 'https://example.com/p1.webp',
      selectedImageSource: 'existing_db',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Almarai Milk 1L',
        titleAr: 'حليب المراعي ١ لتر',
        priceBefore: 10,
        priceAfter: 8
      },
      titleEn: 'Almarai Milk 1L',
      titleAr: 'حليب المراعي ١ لتر',
      priceBefore: 10,
      priceAfter: 8
    }

    // b) Post-correction matched product (P6) with OCR typo correction
    const itemB: StagedOfferItem = {
      id: 'd2222222-2222-2222-2222-222222222222',
      sourceOfferId: 'd2222222-2222-2222-2222-222222222222',
      pageNumber: 1,
      croppedEvidenceLocalPath: cropPath2,
      candidateImageLocalPath: candidateImgPath2,
      selectedImageSource: 'candidate',
      postCorrectionDbMatch: {
        productId: 6,
        existingImageUrl: '',
        productTitleEn: "L'Oreal Elvive Shampoo 400ml"
      },
      isAiCorrected: true,
      aiCorrected: {
        titleAr: 'لوريال الفيف شامبو ٤٠٠ مل'
      },
      isOperatorModified: false,
      operatorApprovedIdentity: true,
      operatorApprovedProductId: 6,
      operatorApprovedBy: 'operator-reviewer',
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Royal Shampoo',
        titleAr: 'رويال شامبو', // typo from OCR
        priceBefore: 25,
        priceAfter: 18
      },
      titleEn: "L'Oreal Elvive Shampoo 400ml",
      titleAr: 'لوريال الفيف شامبو ٤٠٠ مل',
      priceBefore: 25,
      priceAfter: 18
    }

    // c) Net-new generic uncatalogued offer (O1) with candidate image & visual group member
    const itemC: StagedOfferItem = {
      id: 'offer-generic-lamp',
      sourceOfferId: 'offer-generic-lamp',
      imageRef: 'O1',
      pageNumber: 2,
      croppedEvidenceLocalPath: cropPath3,
      candidateImageLocalPath: candidateImgPath3,
      selectedImageSource: 'candidate',
      visualGroupMemberIds: ['offer-generic-lamp-2'],
      matchedVisualSubjectKey: 'generic:desk_lamp',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Desk Lamp LED',
        titleAr: 'مصباح مكتبي',
        priceBefore: 50,
        priceAfter: 35
      },
      titleEn: 'Desk Lamp LED',
      titleAr: 'مصباح مكتبي',
      priceBefore: 50,
      priceAfter: 35
    }

    const draft: StagedLeafletDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir: tmpDir,
      leafletHash: 'alwafa-western-2026-11-01',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      header: {
        supermarketId: 'alwafa',
        region: 'Western',
        validFrom: '2026-11-01',
        validTo: '2026-11-07',
        firstPagePublicUrl: 'https://example.com/p1.webp',
        lastPagePublicUrl: 'https://example.com/pn.webp',
        headerModifiedByOperator: false
      },
      items: [itemA, itemB, itemC]
    }
    await saveStagedLeafletDraft(tmpDir, draft)

    // Execute atomic DB publish
    const publishRes = await publishStagedLeafletDraftToDb(tmpDir, {
      operatorConfirmedPublish: true,
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })

    // Assert summary metrics
    expect(publishRes.ok).toBe(true)
    expect(publishRes.errors).toHaveLength(0)
    expect(publishRes.leafletId).toBe('alwafa-western-2026-11-01')
    expect(publishRes.offersPublishedCount).toBe(3)
    expect(publishRes.productImagesUploadedCount).toBe(1) // Item B candidate -> Route P
    expect(publishRes.offerDisplayImagesUploadedCount).toBe(1) // Item C candidate -> Route O
    expect(publishRes.reusedExistingDbImagesCount).toBe(1) // Item A existing_db
    expect(publishRes.aliasesLearnedCount).toBe(0) // Operational limitation (WIFRAN-EXTRACTOR-IDENTITY-001E): alias learning disabled pending authenticated operator subsystem
    expect(publishRes.purgedShortRefsCount).toBe(1) // Item C 'O1' purged

    // Assert database mutations:
    // 1. Leaflet upserted
    expect(mockDb.leaflets.length).toBe(1)
    expect(mockDb.leaflets[0].supermarket_id).toBe('alwafa')

    // 2. Offers upserted
    expect(mockDb.offers.length).toBe(3)
    const offerB = mockDb.offers.find((o) => o.title_en === "L'Oreal Elvive Shampoo 400ml")
    expect(offerB).toBeDefined()
    expect(offerB.product_id).toBe(6)

    // 3. Product image uploaded and linked to P6
    expect(mockDb.product_images.length).toBe(1)
    expect(mockDb.product_images[0].product_id).toBe(6)
    expect(mockDb.product_images[0].role).toBe('primary')
    expect(mockDb.products.get(6)?.approved_primary_image_id).toBe(mockDb.product_images[0].id)

    // 4. Operational limitation (WIFRAN-EXTRACTOR-IDENTITY-001E): alias learning strictly disabled pending authenticated operator subsystem
    const learnedAlias = mockDb.product_aliases.find((a) => a.alias_text === 'رويال شامبو')
    expect(learnedAlias).toBeUndefined()

    // 5. Offer display image uploaded for Item C and group member propagated
    expect(mockDb.offer_display_images.length).toBe(1)
    expect(mockDb.offer_display_images[0].visual_subject_key).toBe('generic:desk_lamp')
    expect(mockDb.offer_visual_group_members.length).toBe(1)
    expect(mockDb.offer_visual_group_members[0].member_offer_id).toBe('offer-generic-lamp-2')

    // 6. Evidence crops uploaded to offer-images bucket
    const cropUploads = storageUploads.filter((u) => u.bucket === 'offer-images')
    expect(cropUploads.length).toBe(3)

    // 7. Short-ID map purged & reset to nextSeq = 1
    const finalMap = await loadOfferRefMap(testMapPath)
    expect(finalMap.shortToUuid['O1']).toBeUndefined()
    expect(Object.keys(finalMap.shortToUuid).length).toBe(0)
    expect(finalMap.nextSeq).toBe(1)

    // 8. Staged draft status marked as published
    const finalDraft = await fs.promises.readFile(path.join(tmpDir, 'staged-draft.json'), 'utf8')
    const parsedDraft = JSON.parse(finalDraft)
    expect(parsedDraft.status).toBe('published')
    expect(parsedDraft.publishedAt).toBeDefined()
  })
})
