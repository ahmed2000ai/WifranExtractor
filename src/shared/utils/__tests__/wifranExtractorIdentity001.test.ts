import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  classifyOfferAmbiguity,
  validateProductIdentityCompatibility,
  selectSingleCompatibleVerifiedProduct
} from '../../../main/db/productIdentityCompatibilityValidator'
import {
  preMatchLocalOffersAgainstDb,
  checkPostCorrectionCatalogMatch,
  publishStagedLeafletDraftToDb,
  saveStagedLeafletDraft
} from '../../../main/db/stagedLeafletDraftService'
import { ensureProductAliases } from '../../../main/db/productAliasService'
import { syncPreparedOffers } from '../../../main/db/offerSyncService'
import type { StagedLeafletDraft, StagedOfferItem } from '../../../shared/types/productImageEnrichment'

describe('WIFRAN-EXTRACTOR-IDENTITY-001 — Product Matching Safety and False-Match Prevention', () => {
  let tmpDir: string
  let testMapPath: string

  let mockDb: {
    products: Map<number, any>
    product_aliases: any[]
    offer_display_images: any[]
    offer_visual_group_members: any[]
    offers: any[]
    leaflets: any[]
    supermarkets: any[]
    regions: any[]
    storage: Record<string, Map<string, Buffer>>
  }

  let mockSupabase: any

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-identity-test-'))
    testMapPath = path.join(tmpDir, 'test-offer-map.json')

    mockDb = {
      products: new Map(),
      product_aliases: [],
      offer_display_images: [],
      offer_visual_group_members: [],
      offers: [],
      leaflets: [],
      supermarkets: [
        { id: 'alwafa', slug: 'alwafa', name_en: 'Al Wafa Supermarket', name_ar: 'أسواق الوفاء' },
        { id: 'panda', slug: 'panda', name_en: 'Hyper Panda', name_ar: 'هايبر بنده' }
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

    // Seed Verified Products
    // Product 1: Almarai Fresh Milk Full Fat 1L (with approved image)
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

    // Product 2: Almarai Fresh Milk Full Fat 2L
    mockDb.products.set(2, {
      id: 2,
      name_en: 'Almarai Fresh Milk Full Fat 2L',
      name_ar: 'حليب المراعي طازج كامل الدسم ٢ لتر',
      slug: 'almarai-fresh-milk-full-fat-2l',
      item_name_complete: 'Almarai Fresh Milk (Full Fat) 2L',
      canonical_product_key: 'almarai:almarai-fresh-milk-full-fat:full-fat:2liter:1xeach',
      brand_name: 'Almarai',
      variant_or_flavor: 'full-fat',
      each_size_value: 2,
      each_size_unit: 'liter',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      category_slug: 'dairy',
      verification_status: 'verified',
      approved_primary_image_id: 'img-p2',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/almarai-2l.webp'
    })

    // Product 3: Nadec UHT Milk Full Fat 1L
    mockDb.products.set(3, {
      id: 3,
      name_en: 'Nadec UHT Milk Full Fat 1L',
      name_ar: 'حليب نادك طويل الأجل كامل الدسم ١ لتر',
      slug: 'nadec-uht-milk-full-fat-1l',
      item_name_complete: 'Nadec UHT Milk (Full Fat) 1L',
      canonical_product_key: 'nadec:nadec-uht-milk-full-fat:full-fat:1liter:1xeach',
      brand_name: 'Nadec',
      variant_or_flavor: 'full-fat',
      each_size_value: 1,
      each_size_unit: 'liter',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      category_slug: 'dairy',
      verification_status: 'verified',
      approved_primary_image_id: null,
      default_image_url: null
    })

    // Product 4: Indomie Instant Noodles Beef 75g
    mockDb.products.set(4, {
      id: 4,
      name_en: 'Indomie Instant Noodles Beef 75g',
      name_ar: 'إندومي شعيرية سريعة التحضير نكهة البقر ٧٥ جم',
      slug: 'indomie-instant-noodles-beef-75g',
      item_name_complete: 'Indomie Instant Noodles (Beef) 75g',
      canonical_product_key: 'indomie:indomie-instant-noodles-beef:beef:75gram:1xeach',
      brand_name: 'Indomie',
      variant_or_flavor: 'beef',
      each_size_value: 75,
      each_size_unit: 'gram',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      category_slug: 'packaged_food',
      verification_status: 'verified',
      approved_primary_image_id: 'img-p4',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/indomie-beef.webp'
    })

    // Product 5: Almarai Fresh Milk Low Fat 1L
    mockDb.products.set(5, {
      id: 5,
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
      approved_primary_image_id: 'img-p5',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/almarai-lowfat-1l.webp'
    })

    // Product 6: L'Oreal Elvive Shampoo 400ml
    mockDb.products.set(6, {
      id: 6,
      name_en: "L'Oreal Elvive Shampoo 400ml",
      name_ar: 'لوريال الفيف شامبو ٤٠٠ مل',
      slug: 'loreal-elvive-shampoo-400ml',
      item_name_complete: "L'Oreal Elvive Shampoo 400ml",
      canonical_product_key: 'l-oreal:l-oreal-elvive-shampoo:std:400ml:1xeach',
      brand_name: "L'Oreal",
      variant_or_flavor: null,
      each_size_value: 400,
      each_size_unit: 'ml',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      category_slug: 'personal_care',
      verification_status: 'verified',
      approved_primary_image_id: 'img-p6',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/loreal-400ml.webp'
    })

    // Product 7: Dettol Floor Cleaner 250ml
    mockDb.products.set(7, {
      id: 7,
      name_en: 'Dettol Floor Cleaner 250ml',
      name_ar: 'منظف الأرضيات ديتول ٢٥٠ مل',
      slug: 'dettol-floor-cleaner-250ml',
      item_name_complete: 'Dettol Floor Cleaner 250ml',
      canonical_product_key: 'dettol:dettol-floor-cleaner:std:250ml:1xeach',
      brand_name: 'Dettol',
      variant_or_flavor: null,
      each_size_value: 250,
      each_size_unit: 'ml',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      category_slug: 'household_cleaning',
      verification_status: 'verified',
      approved_primary_image_id: 'img-p7',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/dettol-cleaner.webp'
    })

    // Product 10: Sunbulah Puff Pastry Square 400g
    mockDb.products.set(10, {
      id: 10,
      name_en: 'Sunbulah Puff Pastry Square 400g',
      name_ar: 'السنبلة رقائق بف بيستري مربعات ٤٠٠ جم',
      slug: 'sunbulah-puff-pastry-square-400g',
      brand_name: 'Sunbulah',
      each_size_value: 400,
      each_size_unit: 'gram',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      verification_status: 'verified',
      approved_primary_image_id: 'img-p10',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/sunbulah-400g.webp'
    })

    // Product 11: Sunbulah Puff Pastry Sheet 1kg
    mockDb.products.set(11, {
      id: 11,
      name_en: 'Sunbulah Puff Pastry Sheet 1kg',
      name_ar: 'السنبلة رقائق بف بيستري شيت ١ كجم',
      slug: 'sunbulah-puff-pastry-sheet-1kg',
      brand_name: 'Sunbulah',
      each_size_value: 1,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      verification_status: 'verified',
      approved_primary_image_id: 'img-p11',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/sunbulah-1kg.webp'
    })

    // Product 12: Unverified candidate product
    mockDb.products.set(12, {
      id: 12,
      name_en: 'Pending Review Soda 330ml',
      name_ar: 'صودا قيد المراجعة ٣٣٠ مل',
      slug: 'pending-review-soda-330ml',
      verification_status: 'candidate',
      approved_primary_image_id: null,
      default_image_url: null
    })

    // Seed Aliases
    mockDb.product_aliases.push({ product_id: 1, alias_text: 'almaray fresh milk 1l' })
    mockDb.product_aliases.push({ product_id: 1, alias_text: 'almarai milk 1l' })
    mockDb.product_aliases.push({ product_id: 1, alias_text: 'almarai fresh milk' })
    mockDb.product_aliases.push({ product_id: 10, alias_text: 'sunbulah puff pastry' })
    mockDb.product_aliases.push({ product_id: 11, alias_text: 'sunbulah puff pastry' })

    // Build mock Supabase client
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
            const { data } = await queryObj
            return { data: data && data.length > 0 ? data[0] : null, error: null }
          }),
          single: vi.fn(async () => {
            const { data } = await queryObj
            return { data: data && data.length > 0 ? data[0] : null, error: null }
          }),
          insert: vi.fn(async (payload: any) => {
            const records = Array.isArray(payload) ? payload : [payload]
            for (const r of records) {
              const rec = { ...r, id: r.id || crypto.randomUUID() }
              if (table === 'products') mockDb.products.set(rec.id, rec)
              if (table === 'product_aliases') mockDb.product_aliases.push(rec)
              if (table === 'offers') mockDb.offers.push(rec)
              if (table === 'leaflets') mockDb.leaflets.push(rec)
            }
            return { data: records, error: null }
          }),
          upsert: vi.fn(async (payload: any) => {
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
              if (table === 'product_aliases') {
                const idx = mockDb.product_aliases.findIndex((a) => a.alias_text === rec.alias_text)
                if (idx !== -1) mockDb.product_aliases[idx] = rec
                else mockDb.product_aliases.push(rec)
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
            let records: any[] = []
            if (table === 'products') records = Array.from(mockDb.products.values())
            if (table === 'product_aliases') records = [...mockDb.product_aliases]
            if (table === 'offer_display_images') records = [...mockDb.offer_display_images]
            if (table === 'offer_visual_group_members') records = [...mockDb.offer_visual_group_members]
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
          })),
          remove: vi.fn(async (paths: string[]) => {
            if (mockDb.storage[bucket]) {
              for (const p of paths) mockDb.storage[bucket].delete(p)
            }
            return { data: paths, error: null }
          })
        }))
      }
    }
  })

  // =========================================================================
  // Scenario 1: Exact same product, same name, compatible attributes -> auto-matches
  // =========================================================================
  it('Scenario 1: Exact same product with compatible attributes safely auto-matches', () => {
    const offer = {
      titleEn: 'Almarai Fresh Milk Full Fat 1L',
      titleAr: 'حليب المراعي طازج كامل الدسم ١ لتر',
      brand: 'Almarai',
      eachSizeValue: 1,
      eachSizeUnit: 'liter',
      innerPackCount: 1,
      saleUnitType: 'each'
    }
    const candidate = mockDb.products.get(1)
    const result = validateProductIdentityCompatibility(offer, candidate)
    expect(result.isCompatible).toBe(true)
    expect(result.status).toBe('verified_compatible')
  })

  // =========================================================================
  // Scenario 2: Same name/alias, different size (1L vs 2L) -> rejected
  // =========================================================================
  it('Scenario 2: Same name but conflicting package size (1L vs 2L) is rejected as contradictory', () => {
    const offer = {
      titleEn: 'Almarai Fresh Milk Full Fat 1L',
      eachSizeValue: 1,
      eachSizeUnit: 'liter'
    }
    const candidateP2 = mockDb.products.get(2) // 2L
    const result = validateProductIdentityCompatibility(offer, candidateP2)
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_contradictory')
    expect(result.reason).toContain('Package size mismatch')
  })

  // =========================================================================
  // Scenario 3: Same name/alias, different pack quantity (4x1L vs 1L) -> rejected
  // =========================================================================
  it('Scenario 3: Same name but conflicting pack count (4x1L vs 1L) is rejected as contradictory', () => {
    const offer = {
      titleEn: 'Nadec UHT Milk Full Fat 4x1L',
      eachSizeValue: 1,
      eachSizeUnit: 'liter',
      innerPackCount: 4
    }
    const candidateP3 = mockDb.products.get(3) // 1x1L
    const result = validateProductIdentityCompatibility(offer, candidateP3)
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_contradictory')
    expect(result.reason).toContain('Pack quantity mismatch')
  })

  // =========================================================================
  // Scenario 4: Same name/alias, different flavor/cut (Chicken Curry vs Beef) -> rejected
  // =========================================================================
  it('Scenario 4: Conflicting flavor variant (Chicken Curry vs Beef) is rejected as contradictory', () => {
    const offer = {
      titleEn: 'Indomie Instant Noodles Chicken Curry 75g',
      eachSizeValue: 75,
      eachSizeUnit: 'gram'
    }
    const candidateP4 = mockDb.products.get(4) // Beef 75g
    const result = validateProductIdentityCompatibility(offer, candidateP4)
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_contradictory')
    expect(result.reason).toContain('Variant/flavor mismatch')
  })

  // =========================================================================
  // Scenario 5: Same name/alias, different fat content (Full Fat vs Low Fat) -> rejected
  // =========================================================================
  it('Scenario 5: Conflicting fat content (Full Fat vs Low Fat) is rejected as contradictory', () => {
    const offer = {
      titleEn: 'Almarai Fresh Milk Full Fat 1L',
      eachSizeValue: 1,
      eachSizeUnit: 'liter'
    }
    const candidateP5 = mockDb.products.get(5) // Low Fat 1L
    const result = validateProductIdentityCompatibility(offer, candidateP5)
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_contradictory')
    expect(result.reason).toContain('Fat content mismatch')
  })

  // =========================================================================
  // Scenario 6: Same brand/name stem, different category (Hand Soap vs Floor Cleaner) -> rejected
  // =========================================================================
  it('Scenario 6: Same brand stem but conflicting category (personal_care vs household_cleaning) is rejected', () => {
    const offer = {
      titleEn: 'Dettol Antibacterial Hand Soap 250ml',
      categorySlug: 'personal_care',
      eachSizeValue: 250,
      eachSizeUnit: 'ml'
    }
    const candidateP7 = mockDb.products.get(7) // Dettol Floor Cleaner, household_cleaning
    const result = validateProductIdentityCompatibility(offer, candidateP7)
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_contradictory')
    expect(result.reason).toContain('Category mismatch')
  })

  // =========================================================================
  // Scenario 7: Alias matching correct product with compatible attributes -> auto-matches
  // =========================================================================
  it('Scenario 7: Alias match with fully compatible attributes auto-matches verified product', () => {
    const offer = {
      titleEn: 'Almaray Fresh Milk Full Fat 1L',
      eachSizeValue: 1,
      eachSizeUnit: 'liter'
    }
    const candidateP1 = mockDb.products.get(1)
    const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(offer, [candidateP1])
    expect(matchedProduct).toBeDefined()
    expect(matchedProduct.id).toBe(1)
    expect(result.status).toBe('verified_compatible')
  })

  // =========================================================================
  // Scenario 8: Alias matching product with incompatible attributes -> rejected
  // =========================================================================
  it('Scenario 8: Alias match with incompatible size (2L offer vs 1L product) is rejected', () => {
    const offer = {
      titleEn: 'Almarai Fresh Milk Full Fat 2L',
      eachSizeValue: 2,
      eachSizeUnit: 'liter'
    }
    const candidateP1 = mockDb.products.get(1) // 1L product pointed to by broad alias
    const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(offer, [candidateP1])
    expect(matchedProduct).toBeNull()
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_contradictory')
  })

  // =========================================================================
  // Scenario 9: Identical alias pointing to multiple products -> disambiguated or rejected
  // =========================================================================
  it('Scenario 9: Disambiguates multiple candidates by size, or rejects as ambiguous if size missing', () => {
    const candidates = [mockDb.products.get(10), mockDb.products.get(11)] // 400g vs 1kg

    // 9a. Offer specifies 400g -> successfully disambiguates to Product 10
    const offer400g = {
      titleEn: 'Sunbulah Puff Pastry 400g',
      eachSizeValue: 400,
      eachSizeUnit: 'gram'
    }
    const match400g = selectSingleCompatibleVerifiedProduct(offer400g, candidates)
    expect(match400g.matchedProduct).toBeDefined()
    expect(match400g.matchedProduct.id).toBe(10)

    // 9b. Offer omits size -> neither eliminated -> rejected as multiple candidates
    const offerNoSize = {
      titleEn: 'Sunbulah Puff Pastry'
    }
    const matchAmbiguous = selectSingleCompatibleVerifiedProduct(offerNoSize, candidates)
    expect(matchAmbiguous.matchedProduct).toBeNull()
    expect(matchAmbiguous.result.status).toBe('rejected_insufficient_evidence')
  })

  // =========================================================================
  // Scenario 10: Missing critical size on packaged product -> rejected_insufficient_evidence
  // =========================================================================
  it('Scenario 10: Packaged product missing critical size evidence rejects as insufficient_evidence', () => {
    const offerNoSize = {
      titleEn: "L'Oreal Elvive Shampoo", // No size specified
      brand: "L'Oreal"
    }
    const candidateP6 = mockDb.products.get(6) // 400ml product
    const result = validateProductIdentityCompatibility(offerNoSize, candidateP6)
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_insufficient_evidence')
    expect(result.reason).toContain('lacks package size')
  })

  // =========================================================================
  // Scenario 11: Assortment -> rejected_ambiguous_offer
  // =========================================================================
  it('Scenario 11: Assortment bundles and slash combinations reject as rejected_ambiguous_offer', () => {
    const offerAssortment = {
      titleEn: 'Dove Soap 125g 5+1 Free Asstd.',
      assortmentStatus: 'indicated_with_conflict'
    }
    const candidateP1 = mockDb.products.get(1)
    const result = validateProductIdentityCompatibility(offerAssortment, candidateP1)
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_ambiguous_offer')
    expect(result.reason).toContain('ambiguous entity')
  })

  // =========================================================================
  // Scenario 12: Generic merchandise or per-kg loose commodity -> remains unresolved
  // =========================================================================
  it('Scenario 12: Generic unbranded item or per-kg loose commodity remains unresolved (product_id = null)', () => {
    const looseBeef = {
      title_en: 'Fresh Australian Beef Cuts Per KG',
      sale_unit_type: 'kg'
    }
    const beefAmbiguity = classifyOfferAmbiguity(looseBeef)
    expect(beefAmbiguity.isAmbiguous).toBe(true)
    expect(beefAmbiguity.reason).toBe('loose_commodity')

    const genericPan = {
      title_en: 'Stainless Steel Fry Pan 24cm'
    }
    const panAmbiguity = classifyOfferAmbiguity(genericPan)
    expect(panAmbiguity.isAmbiguous).toBe(true)
    expect(panAmbiguity.reason).toBe('generic_unbranded')
  })

  // =========================================================================
  // Scenario 13: Existing verified product reused across retailers
  // =========================================================================
  it('Scenario 13: Verified product is reused across different supermarket retailers', async () => {
    const offerA: StagedOfferItem = {
      id: 'offer-retailer-panda',
      titleEn: 'Almarai Fresh Milk Full Fat 1L',
      titleAr: 'حليب المراعي طازج كامل الدسم ١ لتر',
      croppedEvidenceLocalPath: '/crops/p1.webp',
      selectedImageSource: 'none',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Almarai Fresh Milk Full Fat 1L',
        titleAr: 'حليب المراعي طازج كامل الدسم ١ لتر'
      }
    }
    const offerB: StagedOfferItem = {
      id: 'offer-retailer-alwafa',
      titleEn: 'Almarai Fresh Milk Full Fat 1L',
      titleAr: 'حليب المراعي طازج كامل الدسم ١ لتر',
      croppedEvidenceLocalPath: '/crops/p2.webp',
      selectedImageSource: 'none',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Almarai Fresh Milk Full Fat 1L',
        titleAr: 'حليب المراعي طازج كامل الدسم ١ لتر'
      }
    }

    const draftA: StagedLeafletDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir: tmpDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      header: { supermarketId: 'panda', headerModifiedByOperator: false },
      items: [offerA]
    }
    const draftB: StagedLeafletDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir: tmpDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      header: { supermarketId: 'alwafa', headerModifiedByOperator: false },
      items: [offerB]
    }

    await preMatchLocalOffersAgainstDb(draftA.items, {
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })
    await preMatchLocalOffersAgainstDb(draftB.items, {
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })

    expect(offerA.matchedProductId).toBe(1)
    expect(offerB.matchedProductId).toBe(1)
  })

  // =========================================================================
  // Scenario 14: Existing approved image reused -> selectedImageSource = 'existing_db', status = 'skipped'
  // =========================================================================
  it('Scenario 14: Existing approved catalog image marks selectedImageSource = existing_db and status = skipped', async () => {
    const offerItem: StagedOfferItem = {
      id: 'offer-almarai-imaged',
      titleEn: 'Almarai Fresh Milk Full Fat 1L',
      titleAr: 'حليب المراعي طازج كامل الدسم ١ لتر',
      croppedEvidenceLocalPath: '/crops/almarai.webp',
      selectedImageSource: 'none',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Almarai Fresh Milk Full Fat 1L',
        titleAr: 'حليب المراعي طازج كامل الدسم ١ لتر'
      }
    }
    const draft: StagedLeafletDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir: tmpDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      header: { supermarketId: 'alwafa', headerModifiedByOperator: false },
      items: [offerItem]
    }

    await preMatchLocalOffersAgainstDb(draft.items, {
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })
    expect(offerItem.matchedProductId).toBe(1)
    expect(offerItem.selectedImageSource).toBe('existing_db')
    expect(offerItem.status).toBe('skipped')
    expect(offerItem.imageRef).toBeUndefined()
  })

  // =========================================================================
  // Scenario 15: Ambiguous/incompatible candidate does NOT skip image sourcing -> gets O<n>, status = 'ready'
  // =========================================================================
  it('Scenario 15: Incompatible or unverified candidate is not assigned product_id and routes to O<n> with status = ready', async () => {
    // Offer has 2L, which is incompatible with Product 1 (1L) pointed to by broad alias
    const offerItem: StagedOfferItem = {
      id: 'offer-incompatible-size',
      titleEn: 'Almarai Fresh Milk 2L',
      titleAr: 'حليب المراعي طازج ٢ لتر',
      croppedEvidenceLocalPath: '/crops/almarai-2l.webp',
      selectedImageSource: 'none',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Almarai Fresh Milk 2L',
        titleAr: 'حليب المراعي طازج ٢ لتر'
      }
    }
    const draft: StagedLeafletDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir: tmpDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      header: { supermarketId: 'alwafa', headerModifiedByOperator: false },
      items: [offerItem]
    }

    // Product 2 has slug almarai-fresh-milk-full-fat-2l, while offer generates almarai-fresh-milk-2l
    // Candidate collected from alias "almarai fresh milk" is Product 1 (1L).
    // Product 1 will be rejected due to size contradiction (2L vs 1L).
    await preMatchLocalOffersAgainstDb(draft.items, {
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })
    expect(offerItem.matchedProductId).toBeUndefined()
    expect(offerItem.status).toBe('ready')
    expect(offerItem.imageRef).toMatch(/^O\d+$/)
    expect(offerItem.selectedImageSource).toBe('none')
  })

  // =========================================================================
  // Scenario 16: Corrected title triggering safe re-matching (checkPostCorrectionCatalogMatch)
  // =========================================================================
  it('Scenario 16: Corrected title safely re-matches verified product, but rejects if size contradicts', async () => {
    // 16a. Corrected to exact product match
    const itemCorrected: StagedOfferItem = {
      id: 'offer-typo-fix',
      titleEn: "L'Oreal Elvive Shampoo 400ml",
      titleAr: 'لوريال الفيف شامبو ٤٠٠ مل',
      croppedEvidenceLocalPath: '/crops/shampoo.webp',
      selectedImageSource: 'none',
      isAiCorrected: true,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Royal Shampoo',
        titleAr: 'رويال شامبو'
      }
    }
    const match = await checkPostCorrectionCatalogMatch(itemCorrected, mockSupabase)
    expect(match).not.toBeNull()
    expect(match?.productId).toBe(6)

    // 16b. Corrected with contradictory size (200ml vs 400ml)
    const itemContradictorySize: StagedOfferItem = {
      id: 'offer-typo-wrong-size',
      titleEn: "L'Oreal Elvive Shampoo 200ml",
      titleAr: 'لوريال الفيف شامبو ٢٠٠ مل',
      croppedEvidenceLocalPath: '/crops/shampoo2.webp',
      selectedImageSource: 'none',
      isAiCorrected: true,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Royal Shampoo',
        titleAr: 'رويال شامبو'
      }
    }
    const matchWrongSize = await checkPostCorrectionCatalogMatch(itemContradictorySize, mockSupabase)
    expect(matchWrongSize).toBeNull()
  })

  // =========================================================================
  // Scenario 17: Re-sync preservation when incoming product_id is null and attributes compatible
  // =========================================================================
  it('Scenario 17: Re-sync preserves existing verified product_id when incoming offer has product_id = null', async () => {
    const existingOfferId = 'c1111111-1111-1111-1111-111111111111'
    mockDb.offers.push({
      id: existingOfferId,
      source_offer_id: existingOfferId,
      supermarket_id: 'alwafa',
      title_en: 'Almarai Fresh Milk Full Fat 1L',
      title_ar: 'حليب المراعي طازج كامل الدسم ١ لتر',
      product_id: 1, // Verified linked product
      catalog_match_status: 'verified_linked',
      offer_price: 8.5
    })

    const incomingRow = {
      rowId: 'row-1',
      pageNumber: 1,
      status: 'prepared' as const,
      normalizedData: {} as any,
      preparedPayload: {
        source_offer_id: existingOfferId,
        supermarket_id: 'alwafa',
        title_en: 'Almarai Fresh Milk Full Fat 1L',
        title_ar: 'حليب المراعي طازج كامل الدسم ١ لتر',
        offer_end_date: '2026-11-07',
        product_id: null,
        offer_price: 8.5
      } as any,
      evidenceCropPath: '/dummy/crop.webp'
    }

    const syncRes = await syncPreparedOffers({
      importBatchId: 'test-batch',
      supermarketId: 'alwafa',
      locationScope: 'national',
      options: { requirePrePublishApproval: false, supabaseClient: mockSupabase } as any,
      rows: [incomingRow]
    } as any)

    expect(syncRes.ok).toBe(true)
    const synced = mockDb.offers.find((o) => o.id === existingOfferId)
    expect(synced.product_id).toBe(1) // Preserved
  })

  // =========================================================================
  // Scenario 18: Contradiction on re-sync -> flags conflict_needs_review
  // =========================================================================
  it('Scenario 18: Re-sync flags conflict_needs_review when incoming offer contradicts existing verified product', async () => {
    const existingOfferId = 'c2222222-2222-2222-2222-222222222222'
    mockDb.offers.push({
      id: existingOfferId,
      source_offer_id: existingOfferId,
      supermarket_id: 'alwafa',
      title_en: 'Almarai Fresh Milk Full Fat 1L',
      product_id: 1, // Linked to 1L product
      catalog_match_status: 'verified_linked',
      offer_price: 8.5
    })

    // Incoming flyer re-extracts the same offer ID with conflicting size 2L
    const incomingRow = {
      rowId: 'row-2',
      pageNumber: 1,
      status: 'prepared' as const,
      normalizedData: {} as any,
      preparedPayload: {
        source_offer_id: existingOfferId,
        supermarket_id: 'alwafa',
        title_en: 'Almarai Fresh Milk Full Fat 2L',
        offer_end_date: '2026-11-07',
        each_size_value: 2,
        each_size_unit: 'liter',
        product_id: null,
        offer_price: 15
      } as any,
      evidenceCropPath: '/dummy/crop.webp'
    }

    const syncRes = await syncPreparedOffers({
      importBatchId: 'test-batch',
      supermarketId: 'alwafa',
      locationScope: 'national',
      options: { requirePrePublishApproval: false, supabaseClient: mockSupabase } as any,
      rows: [incomingRow]
    } as any)

    expect(syncRes.ok).toBe(true)
    const updatedOffer = mockDb.offers.find((o) => o.id === existingOfferId)
    expect(updatedOffer.catalog_match_status).toBe('conflict_needs_review')
    expect(syncRes.results[0].issues.some((i) => i.code === 'IDENTITY_CONTRADICTION_ON_RESYNC')).toBe(true)
  })

  // =========================================================================
  // Scenario 19 & 20: No auto-creation of catalog products + Frozen contract v2 & projection compatibility
  // =========================================================================
  it('Scenario 19 & 20: Unmatched offers never auto-create catalog products, and published records conform to contract v2', async () => {
    const initialProductCount = mockDb.products.size

    const newOffer: StagedOfferItem = {
      id: 'offer-net-new-soda',
      titleEn: 'Brand New Super Soda 330ml',
      titleAr: 'سوبر صودا جديدة ٣٣٠ مل',
      croppedEvidenceLocalPath: '/crops/soda.webp',
      selectedImageSource: 'none',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn: 'Brand New Super Soda 330ml',
        titleAr: 'سوبر صودا جديدة ٣٣٠ مل'
      }
    }

    const draft: StagedLeafletDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir: tmpDir,
      leafletHash: 'hash-new-soda',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      header: {
        supermarketId: 'alwafa',
        region: 'Western Region',
        validFrom: '2026-11-01',
        validTo: '2026-11-07',
        headerModifiedByOperator: true
      },
      items: [newOffer]
    }

    // 19a. Pre-matching does NOT create a catalog product
    await preMatchLocalOffersAgainstDb(draft.items, {
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })
    expect(mockDb.products.size).toBe(initialProductCount)

    // 19b. Publishing does NOT create a catalog product
    await saveStagedLeafletDraft(tmpDir, draft)
    const pubRes = await publishStagedLeafletDraftToDb(tmpDir, {
      operatorConfirmedPublish: true,
      supabaseClient: mockSupabase,
      mapFilePath: testMapPath
    })
    expect(pubRes.ok).toBe(true)
    expect(mockDb.products.size).toBe(initialProductCount)

    // Scenario 20: Projection compatibility
    const publishedOffer = mockDb.offers.find((o) => o.id === 'offer-net-new-soda' || o.source_offer_id === 'offer-net-new-soda')
    expect(publishedOffer).toBeDefined()
    expect(publishedOffer.supermarket_id).toBe('alwafa')
    expect(publishedOffer.title_en).toBe('Brand New Super Soda 330ml')
    expect(publishedOffer.catalog_match_status).toBeDefined()
    expect(publishedOffer.offer_start_date).toBe('2026-11-01')
    expect(publishedOffer.offer_end_date).toBe('2026-11-07')

    // Simulate v_consumer_offers database projection view
    const consumerOfferRow = {
      id: publishedOffer.id,
      supermarket_id: publishedOffer.supermarket_id,
      product_id: publishedOffer.product_id || null,
      title_en: publishedOffer.title_en,
      title_ar: publishedOffer.title_ar,
      offer_price: publishedOffer.offer_price,
      is_catalog_linked: publishedOffer.product_id != null
    }

    expect(consumerOfferRow.supermarket_id).toBeTruthy()
    expect(consumerOfferRow.title_en).toBeTruthy()
    expect(consumerOfferRow.is_catalog_linked).toBe(false)
  })

  // =========================================================================
  // Bonus Scenario: Alias Contradiction Prevention
  // =========================================================================
  it('Bonus: ensureProductAliases prevents contradictory alias pollution', async () => {
    // In mockDb, alias 'almarai milk 1l' is already bound to Product 1
    const res = await ensureProductAliases(
      {
        productId: 2, // Attempt to bind same alias text to Product 2
        aliases: [
          {
            aliasText: 'almarai milk 1l',
            language: 'en',
            source: 'operator_correction'
          }
        ]
      },
      { supabaseClient: mockSupabase }
    )

    expect(res.createdCount).toBe(0)
    expect(res.issues.length).toBe(1)
    expect(res.issues[0].code).toBe('PRODUCT_ALIAS_CONFLICT')
    expect(res.issues[0].message).toContain('already points to different product ID')
  })
})
