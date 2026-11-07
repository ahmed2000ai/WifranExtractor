import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import fs from 'fs'
import {
  validateProductImageCsvImport,
  uploadApprovedProductImagesToDb,
  exportProductsForImageSearch,
  loadOfferRefMap,
  saveOfferRefMap,
  pruneStaleOfferRefs
} from '../../../main/db/productImageEnrichmentService'
import { getSupabaseAdminClient } from '../../../main/db/supabaseAdminClient'

// In-memory test store to simulate Supabase DB & Storage
interface MockDb {
  products: Map<number, any>
  offers: Map<string, any>
  product_images: any[]
  offer_display_images: any[]
  offer_visual_group_members: any[]
  storage: {
    'product-images': Map<string, { buffer: Buffer; contentType: string }>
    'offer-display-images': Map<string, { buffer: Buffer; contentType: string }>
  }
}

let mockDb: MockDb

function resetMockDb() {
  mockDb = {
    products: new Map([
      [
        1,
        {
          id: 1,
          canonical_product_key: 'nadec:uht-milk-4x1l',
          item_name_complete: 'Nadec UHT Milk Full Fat 4x1Lt',
          verification_status: 'verified',
          approved_primary_image_id: null,
          default_image_url: null
        }
      ],
      [
        2,
        {
          id: 2,
          canonical_product_key: 'everwhite:washing-powder-10kg',
          item_name_complete: 'Ever White Washing Powder 10Kg',
          verification_status: 'verified',
          approved_primary_image_id: 'img-existing-2',
          default_image_url: 'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/catalog/existing.jpg'
        }
      ],
      [
        3,
        {
          id: 3,
          canonical_product_key: 'unverified:item-3',
          item_name_complete: 'Unverified Product 3',
          verification_status: 'candidate',
          approved_primary_image_id: null,
          default_image_url: null
        }
      ]
    ]),
    offers: new Map([
      [
        '00000000-0000-0000-0000-000000000001',
        {
          id: '00000000-0000-0000-0000-000000000001',
          source_offer_id: 'alwafa:dove-soap-rep',
          title_en: 'Dove Soap 125Gm 5+1 Free Asstd.',
          title_ar: 'صابون دوف ١٢٥ جم ٥+١ مجاناً منوع',
          sale_unit_type: 'pack',
          product_id: null,
          contract_v2: { assortment: { status: 'assortment_indicated' } }
        }
      ],
      [
        '00000000-0000-0000-0000-000000000002',
        {
          id: '00000000-0000-0000-0000-000000000002',
          source_offer_id: 'alwafa:dove-soap-member',
          title_en: 'Dove Soap 125Gm White',
          title_ar: 'صابون دوف ١٢٥ جم أبيض',
          sale_unit_type: 'pack',
          product_id: null,
          contract_v2: { assortment: { status: 'assortment_indicated' } }
        }
      ],
      [
        '00000000-0000-0000-0000-000000000003',
        {
          id: '00000000-0000-0000-0000-000000000003',
          source_offer_id: 'alwafa:linked-offer',
          title_en: 'Nadec Milk Linked',
          title_ar: 'حليب نادك مربوط',
          sale_unit_type: 'pack',
          product_id: 1, // Already linked to catalog product!
          contract_v2: {}
        }
      ]
    ]),
    product_images: [],
    offer_display_images: [],
    offer_visual_group_members: [
      {
        representative_offer_id: '00000000-0000-0000-0000-000000000001',
        member_offer_id: '00000000-0000-0000-0000-000000000002',
        visual_subject_key: 'assortment:dove-soap',
        visual_subject_name: 'Dove Soap Assorted'
      }
    ],
    storage: {
      'product-images': new Map(),
      'offer-display-images': new Map()
    }
  }
}

// Mock supabaseAdminClient
vi.mock('../../../main/db/supabaseAdminClient', () => {
  return {
    getSupabaseAdminClient: () => ({
      from: (table: string) => {
        let currentData: any[] = []
        if (table === 'products') {
          currentData = Array.from(mockDb.products.values())
        } else if (table === 'offers') {
          currentData = Array.from(mockDb.offers.values())
        } else if (table === 'product_images') {
          currentData = mockDb.product_images
        } else if (table === 'offer_display_images') {
          currentData = mockDb.offer_display_images
        } else if (table === 'offer_visual_group_members') {
          currentData = mockDb.offer_visual_group_members
        }

        const queryBuilder: any = {
          _table: table,
          _data: currentData,
          select: (_cols?: string) => queryBuilder,
          in: (col: string, vals: any[]) => {
            queryBuilder._data = queryBuilder._data.filter((r: any) => vals.includes(r[col]))
            return queryBuilder
          },
          eq: (col: string, val: any) => {
            queryBuilder._data = queryBuilder._data.filter((r: any) => r[col] === val)
            return queryBuilder
          },
          is: (col: string, val: any) => {
            queryBuilder._data = queryBuilder._data.filter((r: any) => r[col] === val)
            return queryBuilder
          },
          ilike: (col: string, pattern: string) => {
            const cleanPattern = pattern.replace(/%/g, '').toLowerCase()
            queryBuilder._data = queryBuilder._data.filter((r: any) =>
              String(r[col] || '').toLowerCase().includes(cleanPattern)
            )
            return queryBuilder
          },
          order: (_col: string, _opts?: any) => queryBuilder,
          limit: (n: number) => {
            queryBuilder._data = queryBuilder._data.slice(0, n)
            return queryBuilder
          },
          single: async () => {
            const row = queryBuilder._data[0]
            if (!row) return { data: null, error: new Error('Not found') }
            return { data: row, error: null }
          },
          then: (resolve: any) => {
            resolve({ data: queryBuilder._data, error: null })
          },
          insert: (data: any) => {
            const toInsert = Array.isArray(data) ? data : [data]
            const inserted = toInsert.map((d: any) => ({
              id: d.id || `gen-id-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              ...d
            }))
            if (table === 'product_images') {
              mockDb.product_images.push(...inserted)
            } else if (table === 'offer_display_images') {
              mockDb.offer_display_images.push(...inserted)
            } else if (table === 'offer_visual_group_members') {
              mockDb.offer_visual_group_members.push(...inserted)
            }
            return {
              data: inserted.length === 1 ? inserted[0] : inserted,
              error: null,
              select: (_c?: string) => ({
                single: async () => ({ data: inserted[0], error: null }),
                then: (resolve: any) => resolve({ data: inserted, error: null })
              }),
              then: (resolve: any) => resolve({ data: inserted, error: null })
            }
          },
          upsert: (data: any) => {
            return queryBuilder.insert(data)
          },
          update: (updates: any) => ({
            eq: async (col: string, val: any) => {
              if (table === 'products') {
                const prod = mockDb.products.get(Number(val))
                if (prod) Object.assign(prod, updates)
              } else if (table === 'product_images') {
                for (const row of mockDb.product_images) {
                  if (row[col] === val) Object.assign(row, updates)
                }
              } else if (table === 'offer_display_images') {
                for (const row of mockDb.offer_display_images) {
                  if (row[col] === val) Object.assign(row, updates)
                }
              }
              return { data: [], error: null }
            }
          })
        }
        return queryBuilder
      },
      storage: {
        from: (bucket: 'product-images' | 'offer-display-images') => ({
          upload: async (path: string, buffer: Buffer, opts: any) => {
            mockDb.storage[bucket].set(path, { buffer, contentType: opts.contentType })
            return { data: { path }, error: null }
          },
          getPublicUrl: (path: string) => ({
            data: {
              publicUrl: `https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/${bucket}/${path}`
            }
          })
        })
      }
    })
  }
})

// Sample valid WebP image buffer (RIFF...WEBP)
const validWebpBuffer = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
  Buffer.from([0x18, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00])
])

// Sample valid PNG image buffer
const validPngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
])

describe('WIFRAN-07J Step 3 Manual Product Image Importer', () => {
  beforeEach(() => {
    resetMockDb()
    vi.restoreAllMocks()
  })

  // =========================================================================
  // 1. Unified Format & Read-Only Validation Preview
  // =========================================================================
  describe('1. Unified Format & Read-Only Validation Preview', () => {
    it('Accepts both Image_Ref,image_url and Product_ID,image_url headers', async () => {
      const csv1 = 'Image_Ref,image_url\r\n"P1","https://example.com/p1.webp"'
      const v1 = await validateProductImageCsvImport(csv1)
      expect(v1.ok).toBe(true)
      expect(v1.rows.length).toBe(1)
      expect(v1.rows[0].targetKind).toBe('product')
      expect(v1.rows[0].productId).toBe('1')

      const csv2 = 'Product_ID,image_url\r\n"1","https://example.com/p1.webp"'
      const v2 = await validateProductImageCsvImport(csv2)
      expect(v2.ok).toBe(true)
      expect(v2.rows.length).toBe(1)
      expect(v2.rows[0].targetKind).toBe('product')
    })

    it('Strictly separates P<id> (exact product) and O<uuid> (illustrative offer) references', async () => {
      const csv = `Image_Ref,image_url
"P1","https://example.com/product1.webp"
"O00000000-0000-0000-0000-000000000001","https://example.com/dove.webp"
"P2",""
`
      const summary = await validateProductImageCsvImport(csv)
      expect(summary.totalRows).toBe(3)
      expect(summary.errorCount).toBe(0)
      expect(summary.ok).toBe(true)

      const pRow = summary.rows[0]
      expect(pRow.targetKind).toBe('product')
      expect(pRow.productId).toBe('1')
      expect(pRow.productName).toBe('Nadec UHT Milk Full Fat 4x1Lt')
      expect(pRow.status).toBe('valid')

      const oRow = summary.rows[1]
      expect(oRow.targetKind).toBe('offer')
      expect(oRow.offerId).toBe('00000000-0000-0000-0000-000000000001')
      expect(oRow.visualSubjectKey).toBeDefined()
      expect(oRow.status).toBe('valid')

      const p2Row = summary.rows[2]
      expect(p2Row.targetKind).toBe('product')
      // P2 already has an approved primary image in mockDb and has blank URL
      expect(p2Row.status).toBe('already_has_image')
    })

    it('Rejects unknown products, non-positive integer IDs, and unverified products', async () => {
      const csv = `Image_Ref,image_url
"P999","https://example.com/missing.webp"
"Pxyz","https://example.com/nan.webp"
"P3","https://example.com/unverified.webp"
`
      const summary = await validateProductImageCsvImport(csv)
      expect(summary.ok).toBe(false)
      expect(summary.errorCount).toBe(3)
      expect(summary.rows[0].status).toBe('unknown_product')
      expect(summary.rows[0].issueMessage).toContain('does not exist')
      expect(summary.rows[1].status).toBe('unknown_product')
      expect(summary.rows[1].issueMessage).toContain('positive integer')
      expect(summary.rows[2].status).toBe('unknown_product')
      expect(summary.rows[2].issueMessage).toContain('not a verified catalog product')
    })

    it('Rejects unknown offers or offers linked to verified products (must use P<id>)', async () => {
      const csv = `Image_Ref,image_url
"O99999999-9999-9999-9999-999999999999","https://example.com/missing-offer.webp"
"O00000000-0000-0000-0000-000000000003","https://example.com/linked.webp"
`
      const summary = await validateProductImageCsvImport(csv)
      expect(summary.ok).toBe(false)
      expect(summary.errorCount).toBe(2)
      expect(summary.rows[0].status).toBe('unknown_product')
      expect(summary.rows[0].issueMessage).toContain('does not exist')
      expect(summary.rows[1].status).toBe('unknown_product')
      expect(summary.rows[1].issueMessage).toContain('linked to a verified catalog product; use P1 instead')
    })

    it('Rejects duplicate references in CSV and invalid URLs', async () => {
      const csv = `Image_Ref,image_url
"P1","https://example.com/img1.webp"
"P1","https://example.com/img1_dup.webp"
"O00000000-0000-0000-0000-000000000001","http://insecure.com/insecure.webp"
"O00000000-0000-0000-0000-000000000002","not-a-url"
`
      const summary = await validateProductImageCsvImport(csv)
      expect(summary.ok).toBe(false)
      expect(summary.rows[1].status).toBe('duplicate_product')
      expect(summary.rows[2].status).toBe('invalid_url')
      expect(summary.rows[2].issueMessage).toContain('HTTPS')
      expect(summary.rows[3].status).toBe('invalid_url')
    })

    it('Guarantees ZERO network operations during validation preview', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const csv = 'Image_Ref,image_url\r\n"P1","https://example.com/preview-only.webp"'
      await validateProductImageCsvImport(csv)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // 2. Batch Upload Loop, Routing & Deduplication
  // =========================================================================
  describe('2. Batch Upload Loop, Routing & Deduplication', () => {
    it('Requires operator review confirmation before processing', async () => {
      const csv = 'Image_Ref,image_url\r\n"P1","https://example.com/p1.webp"'
      await expect(
        uploadApprovedProductImagesToDb({
          csvContent: csv,
          operatorConfirmedReview: false
        })
      ).rejects.toThrow(/Operator review confirmation is required/)
    })

    it('Routes P references to product-images bucket, product_images table, and updates products.approved_primary_image_id', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(validWebpBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/webp' }
        })
      )

      const csv = 'Image_Ref,image_url\r\n"P1","https://example.com/nadec.webp"'
      const res = await uploadApprovedProductImagesToDb({
        csvContent: csv,
        operatorConfirmedReview: true,
        reviewedBy: 'operator_ahmed'
      })

      expect(res.totalRows).toBe(1)
      expect(res.uploadedCount).toBe(1)
      expect(res.success).toBe(1)
      expect(res.errors).toBe(0)
      expect(res.skipped).toBe(0)

      // Storage bucket check
      const expectedSha = crypto.createHash('sha256').update(validWebpBuffer).digest('hex')
      const expectedPath = `catalog/${expectedSha}.webp`
      expect(mockDb.storage['product-images'].has(expectedPath)).toBe(true)

      // product_images table check
      expect(mockDb.product_images.length).toBe(1)
      const dbImg = mockDb.product_images[0]
      expect(dbImg.product_id).toBe(1)
      expect(dbImg.storage_bucket).toBe('product-images')
      expect(dbImg.content_sha256).toBe(expectedSha)
      expect(dbImg.approval_status).toBe('approved')
      expect(dbImg.reviewed_by).toBe('operator_ahmed')

      // products table check
      const prod = mockDb.products.get(1)
      expect(prod.approved_primary_image_id).toBe(dbImg.id)
      expect(prod.default_image_url).toContain(expectedPath)
    })

    it('Routes O references to offer-display-images bucket and propagates to group members in offer_visual_group_members', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(validPngBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        })
      )

      const repOfferId = '00000000-0000-0000-0000-000000000001'
      const memberOfferId = '00000000-0000-0000-0000-000000000002'

      const csv = `Image_Ref,image_url\r\n"O${repOfferId}","https://example.com/dove-assorted.png"`
      const res = await uploadApprovedProductImagesToDb({
        csvContent: csv,
        operatorConfirmedReview: true
      })

      expect(res.uploadedCount).toBe(1)
      expect(res.success).toBe(1)

      const expectedSha = crypto.createHash('sha256').update(validPngBuffer).digest('hex')
      const expectedPath = `offers/${expectedSha}.png`
      expect(mockDb.storage['offer-display-images'].has(expectedPath)).toBe(true)

      // Both representative and member offer received the approved display image!
      expect(mockDb.offer_display_images.length).toBe(2)
      const repImg = mockDb.offer_display_images.find((r) => r.offer_id === repOfferId)
      const memImg = mockDb.offer_display_images.find((r) => r.offer_id === memberOfferId)

      expect(repImg).toBeDefined()
      expect(repImg.storage_bucket).toBe('offer-display-images')
      expect(repImg.content_sha256).toBe(expectedSha)
      expect(repImg.visual_subject_key).toBeDefined()

      expect(memImg).toBeDefined()
      expect(memImg.storage_bucket).toBe('offer-display-images')
      expect(memImg.content_sha256).toBe(expectedSha)
      expect(memImg.visual_subject_key).toBeDefined()
    })

    it('Gracefully skips upload when the exact image hash is already associated with that product or offer (Idempotency)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(validWebpBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/webp' }
        })
      )

      const expectedSha = crypto.createHash('sha256').update(validWebpBuffer).digest('hex')

      // Pre-seed an approved image for Product 1 with this exact hash
      mockDb.product_images.push({
        id: 'existing-p1-img',
        product_id: 1,
        role: 'primary',
        storage_bucket: 'product-images',
        storage_object_path: `catalog/${expectedSha}.webp`,
        public_url: `https://example.com/catalog/${expectedSha}.webp`,
        content_sha256: expectedSha,
        approval_status: 'approved'
      })
      mockDb.products.get(1).approved_primary_image_id = 'existing-p1-img'

      const csv = 'Image_Ref,image_url\r\n"P1","https://example.com/re-import-same.webp"'
      const res = await uploadApprovedProductImagesToDb({
        csvContent: csv,
        operatorConfirmedReview: true
      })

      expect(res.uploadedCount).toBe(0)
      expect(res.skippedCount).toBe(1)
      expect(res.results[0].status).toBe('skipped')
      expect(res.results[0].error).toContain('already associated with product')
    })

    it('Reuses storage objects without uploading duplicate bytes when the same image is provided for multiple references', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        new Response(validPngBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        })
      )

      // Offer 1 upload (first time)
      const repOfferId = '00000000-0000-0000-0000-000000000001'
      const csv1 = `Image_Ref,image_url\r\n"O${repOfferId}","https://example.com/same-visual.png"`
      const res1 = await uploadApprovedProductImagesToDb({
        csvContent: csv1,
        operatorConfirmedReview: true
      })
      expect(res1.uploadedCount).toBe(1)
      expect(res1.reusedCount).toBe(0)

      // Add a third unlinked offer that shares this visual
      mockDb.offers.set('00000000-0000-0000-0000-000000000099', {
        id: '00000000-0000-0000-0000-000000000099',
        source_offer_id: 'alwafa:another-soap',
        title_en: 'Another Soap Item',
        title_ar: 'صابون آخر',
        sale_unit_type: 'pack',
        product_id: null,
        contract_v2: {}
      })

      // Offer 99 upload with the same image content
      const csv2 = `Image_Ref,image_url\r\n"O00000000-0000-0000-0000-000000000099","https://example.com/same-visual.png"`
      const res2 = await uploadApprovedProductImagesToDb({
        csvContent: csv2,
        operatorConfirmedReview: true
      })

      expect(res2.uploadedCount).toBe(0)
      expect(res2.reusedCount).toBe(1)
      expect(res2.success).toBe(1)
      expect(res2.results[0].status).toBe('reused')
    })
  })

  // =========================================================================
  // 3. Graceful Failure & Summary Reporting
  // =========================================================================
  describe('3. Graceful Failure & Summary Reporting', () => {
    it('Handles image download failure (404) gracefully without aborting the batch and returns summary', async () => {
      // First call fails (404), second succeeds
      let callCount = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return new Response('Not found', { status: 404, statusText: 'Not Found' })
        }
        return new Response(validWebpBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/webp' }
        })
      })

      const csv = `Image_Ref,image_url
"P1","https://example.com/broken-404.webp"
"O00000000-0000-0000-0000-000000000001","https://example.com/valid-offer.webp"
`
      const res = await uploadApprovedProductImagesToDb({
        csvContent: csv,
        operatorConfirmedReview: true
      })

      expect(res.totalRows).toBe(2)
      expect(res.failedCount).toBe(1)
      expect(res.uploadedCount).toBe(1)
      expect(res.success).toBe(1)
      expect(res.errors).toBe(1)
      expect(res.skipped).toBe(0)

      expect(res.results[0].status).toBe('failed')
      expect(res.results[0].error).toContain('404')

      expect(res.results[1].status).toBe('uploaded')
    })

    it('Rejects invalid magic bytes (HTML instead of image) gracefully without aborting batch', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('<html><body>Fake Image</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        })
      )

      const csv = 'Image_Ref,image_url\r\n"P1","https://example.com/fake-image.webp"'
      const res = await uploadApprovedProductImagesToDb({
        csvContent: csv,
        operatorConfirmedReview: true
      })

      expect(res.failedCount).toBe(1)
      expect(res.errors).toBe(1)
      expect(res.results[0].status).toBe('failed')
      expect(res.results[0].error).toMatch(/magic bytes/i)
    })

    it('Guarantees ZERO LLM or Gemini API calls exist in the import pipeline (100% deterministic local logic)', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const servicePath = path.resolve(process.cwd(), 'src/main/db/productImageEnrichmentService.ts')
      const serviceCode = fs.readFileSync(servicePath, 'utf8')

      // Assert service contains 0 Gemini/LLM imports or network calls
      expect(serviceCode).not.toContain('@google/generative-ai')
      expect(serviceCode).not.toContain('generativelanguage.googleapis.com')
      expect(serviceCode).not.toContain('GoogleGenerativeAI')
      expect(serviceCode).not.toContain('generateContent')
    })
  })

  // =========================================================================
  // 4. Local Short-ID Translation & Self-Cleaning Lifecycle (WIFRAN-07J Short-ID)
  // =========================================================================
  describe('4. Local Short-ID Translation & Self-Cleaning Lifecycle (WIFRAN-07J Short-ID)', () => {
    let testMapPath: string

    beforeEach(() => {
      testMapPath = path.join(os.tmpdir(), `test-offer-ref-map-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`)
      if (fs.existsSync(testMapPath)) {
        fs.unlinkSync(testMapPath)
      }
      // Add independent offer 4
      mockDb.offers.set('00000000-0000-0000-0000-000000000004', {
        id: '00000000-0000-0000-0000-000000000004',
        source_offer_id: 'alwafa:flashlight',
        title_en: 'Krypton LED Flashlight',
        title_ar: 'مصباح يدوي كريبتون',
        sale_unit_type: 'each',
        product_id: null,
        contract_v2: {}
      })
    })

    it('Step 1 exports O1, O2 short references instead of UUIDs, preserving P1, P2 references', async () => {
      // Mock exactly two uncatalogued offers
      mockDb.offers.clear()
      mockDb.offers.set('00000000-0000-0000-0000-000000000001', {
        id: '00000000-0000-0000-0000-000000000001',
        source_offer_id: 'alwafa:dove-soap',
        title_en: 'Dove Soap 125g',
        title_ar: 'صابون دوف',
        sale_unit_type: 'pack',
        product_id: null,
        contract_v2: {}
      })
      mockDb.offers.set('00000000-0000-0000-0000-000000000004', {
        id: '00000000-0000-0000-0000-000000000004',
        source_offer_id: 'alwafa:flashlight',
        title_en: 'Krypton LED Flashlight',
        title_ar: 'مصباح يدوي كريبتون',
        sale_unit_type: 'each',
        product_id: null,
        contract_v2: {}
      })

      const exportRes = await exportProductsForImageSearch({
        includeUnresolvedOffers: true,
        persistVisualGroups: false,
        mapFilePath: testMapPath
      })

      // Check P rows preserved
      const pRow = exportRes.rows.find((r) => r.kind === 'product')
      expect(pRow).toBeDefined()
      expect(pRow?.imageRef).toBe('P1')

      // Check O rows use short sequential references O1, O2
      const oRows = exportRes.rows.filter((r) => r.kind === 'offer')
      expect(oRows.length).toBe(2)
      expect(oRows[0].imageRef).toBe('O1')
      expect(oRows[1].imageRef).toBe('O2')

      // Verify underlying offer UUIDs are preserved on the objects
      expect(oRows[0].offerId).toBe('00000000-0000-0000-0000-000000000001')
      expect(oRows[1].offerId).toBe('00000000-0000-0000-0000-000000000004')

      // Check CSV content has O1 and O2 without any 36-char UUIDs in the ref column
      expect(exportRes.csvContent).toContain('"O1",')
      expect(exportRes.csvContent).toContain('"O2",')
      expect(exportRes.csvContent).not.toContain('O00000000-0000-0000-0000-000000000001')

      // Inspect persisted map on disk
      const map = await loadOfferRefMap(testMapPath)
      expect(map.nextSeq).toBe(3)
      expect(map.shortToUuid['O1']).toBe('00000000-0000-0000-0000-000000000001')
      expect(map.shortToUuid['O2']).toBe('00000000-0000-0000-0000-000000000004')
      expect(map.uuidToShort['00000000-0000-0000-0000-000000000001']).toBe('O1')
      expect(map.uuidToShort['00000000-0000-0000-0000-000000000004']).toBe('O2')
    })

    it('Step 3 resolves O1, O2 to underlying UUIDs during validation and upload', async () => {
      // Seed map with O1 and O2 pointing to two distinct offers
      const map = {
        nextSeq: 3,
        shortToUuid: {
          O1: '00000000-0000-0000-0000-000000000001',
          O2: '00000000-0000-0000-0000-000000000004'
        },
        uuidToShort: {
          '00000000-0000-0000-0000-000000000001': 'O1',
          '00000000-0000-0000-0000-000000000004': 'O2'
        }
      }
      await saveOfferRefMap(map, testMapPath)

      // CSV with short references
      const csv = `Image_Ref,image_url
"O1","https://example.com/soap-1.webp"
"O2","https://example.com/flashlight.webp"
`
      // 1. Validation resolves O1, O2 to exact UUIDs
      const val = await validateProductImageCsvImport(csv, { mapFilePath: testMapPath })
      expect(val.ok).toBe(true)
      expect(val.validRowsCount).toBe(2)
      expect(val.rows[0].imageRef).toBe('O1')
      expect(val.rows[0].offerId).toBe('00000000-0000-0000-0000-000000000001')
      expect(val.rows[1].imageRef).toBe('O2')
      expect(val.rows[1].offerId).toBe('00000000-0000-0000-0000-000000000004')

      // Mock image fetch with distinct image buffers
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const u = String(url)
        const buf = u.includes('flashlight') ? validPngBuffer : validWebpBuffer
        const mime = u.includes('flashlight') ? 'image/png' : 'image/webp'
        return new Response(buf, {
          status: 200,
          headers: { 'Content-Type': mime }
        })
      })

      // 2. Upload executes and associates images using underlying UUIDs
      const uploadRes = await uploadApprovedProductImagesToDb({
        csvContent: csv,
        operatorConfirmedReview: true,
        mapFilePath: testMapPath
      })

      expect(uploadRes.uploadedCount).toBe(2)
      expect(uploadRes.failedCount).toBe(0)
      expect(uploadRes.success).toBe(2)

      // Check DB records were inserted with underlying UUIDs
      const insertedOffers = mockDb.offer_display_images.map((img) => img.offer_id)
      expect(insertedOffers).toContain('00000000-0000-0000-0000-000000000001')
      expect(insertedOffers).toContain('00000000-0000-0000-0000-000000000004')
    })

    it('Completed O items are automatically purged from the local map, and nextSeq resets to 1', async () => {
      // Seed map with O1 and O2
      const map = {
        nextSeq: 3,
        shortToUuid: {
          O1: '00000000-0000-0000-0000-000000000001',
          O2: '00000000-0000-0000-0000-000000000004'
        },
        uuidToShort: {
          '00000000-0000-0000-0000-000000000001': 'O1',
          '00000000-0000-0000-0000-000000000004': 'O2'
        }
      }
      await saveOfferRefMap(map, testMapPath)

      const csv = `Image_Ref,image_url
"O1","https://example.com/soap-1.webp"
"O2","https://example.com/flashlight.webp"
`
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(validWebpBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/webp' }
        })
      })

      await uploadApprovedProductImagesToDb({
        csvContent: csv,
        operatorConfirmedReview: true,
        mapFilePath: testMapPath
      })

      // Map should now be completely purged and reset
      const cleanedMap = await loadOfferRefMap(testMapPath)
      expect(Object.keys(cleanedMap.shortToUuid).length).toBe(0)
      expect(Object.keys(cleanedMap.uuidToShort).length).toBe(0)
      expect(cleanedMap.nextSeq).toBe(1)
    })

    it('Failed items remain mapped for retry while completed items are purged', async () => {
      // Seed map with O1 and O2
      const map = {
        nextSeq: 3,
        shortToUuid: {
          O1: '00000000-0000-0000-0000-000000000001',
          O2: '00000000-0000-0000-0000-000000000004'
        },
        uuidToShort: {
          '00000000-0000-0000-0000-000000000001': 'O1',
          '00000000-0000-0000-0000-000000000004': 'O2'
        }
      }
      await saveOfferRefMap(map, testMapPath)

      const csv = `Image_Ref,image_url
"O1","https://example.com/successful.webp"
"O2","https://example.com/fails-404.webp"
`
      let callCount = 0
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // O1 succeeds
          return new Response(validWebpBuffer, {
            status: 200,
            headers: { 'Content-Type': 'image/webp' }
          })
        }
        // O2 fails
        return new Response('Not Found', { status: 404, statusText: 'Not Found' })
      })

      const uploadRes = await uploadApprovedProductImagesToDb({
        csvContent: csv,
        operatorConfirmedReview: true,
        mapFilePath: testMapPath
      })

      expect(uploadRes.uploadedCount).toBe(1)
      expect(uploadRes.failedCount).toBe(1)

      // Map should have purged O1, but retained O2 for retry
      const mapAfterFailure = await loadOfferRefMap(testMapPath)
      expect(mapAfterFailure.shortToUuid['O1']).toBeUndefined()
      expect(mapAfterFailure.shortToUuid['O2']).toBe('00000000-0000-0000-0000-000000000004')
      expect(mapAfterFailure.uuidToShort['00000000-0000-0000-0000-000000000004']).toBe('O2')

      // Now simulate operator fixing O2 URL and re-running Step 3
      const retryCsv = `Image_Ref,image_url
"O2","https://example.com/fixed-url.png"
`
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(validPngBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        })
      )

      const retryRes = await uploadApprovedProductImagesToDb({
        csvContent: retryCsv,
        operatorConfirmedReview: true,
        mapFilePath: testMapPath
      })

      expect(retryRes.uploadedCount).toBe(1)
      expect(retryRes.failedCount).toBe(0)

      // Now all items completed -> map completely clean and nextSeq reset to 1
      const finalMap = await loadOfferRefMap(testMapPath)
      expect(Object.keys(finalMap.shortToUuid).length).toBe(0)
      expect(finalMap.nextSeq).toBe(1)
    })

    it('Rejects unmapped or expired short references gracefully with clear error', async () => {
      // Map is empty
      const emptyMap = { nextSeq: 1, shortToUuid: {}, uuidToShort: {} }
      await saveOfferRefMap(emptyMap, testMapPath)

      const csv = `Image_Ref,image_url
"O99","https://example.com/some-image.webp"
`
      const val = await validateProductImageCsvImport(csv, { mapFilePath: testMapPath })
      expect(val.ok).toBe(false)
      expect(val.errorCount).toBe(1)
      expect(val.rows[0].status).toBe('unknown_product')
      expect(val.rows[0].issueMessage).toContain("Unmapped or expired short offer reference 'O99'")
      expect(val.errors[0]).toContain("Unmapped or expired short offer reference 'O99'")
    })

    it('Step 1 pruning: removes stale entries whose offers already have approved images or are linked to products', async () => {
      // Prepare 3 mapped offers
      const map = {
        nextSeq: 4,
        shortToUuid: {
          O1: '00000000-0000-0000-0000-000000000001', // will have approved image
          O2: '00000000-0000-0000-0000-000000000003', // linked to product 1
          O3: '00000000-0000-0000-0000-000000000002'  // still unresolved, no image
        },
        uuidToShort: {
          '00000000-0000-0000-0000-000000000001': 'O1',
          '00000000-0000-0000-0000-000000000003': 'O2',
          '00000000-0000-0000-0000-000000000002': 'O3'
        }
      }

      // Add approved image for offer 1
      mockDb.offer_display_images.push({
        offer_id: '00000000-0000-0000-0000-000000000001',
        approval_status: 'approved'
      })

      // Offer 3 is already linked to product 1 in mockDb

      const supabase = getSupabaseAdminClient()
      const pruned = await pruneStaleOfferRefs(map, supabase as any)

      expect(pruned).toBe(2)
      // O1 and O2 pruned
      expect(map.shortToUuid['O1']).toBeUndefined()
      expect(map.shortToUuid['O2']).toBeUndefined()
      // O3 remains
      expect(map.shortToUuid['O3']).toBe('00000000-0000-0000-0000-000000000002')
      expect(map.uuidToShort['00000000-0000-0000-0000-000000000002']).toBe('O3')
    })
  })
})
