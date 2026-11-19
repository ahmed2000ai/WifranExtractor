import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { BrandGroupingService } from '../../db/brandGroupingService'
import { TemporaryProductRegistry } from '../../db/temporaryProductRegistry'
import {
  evaluateIdentitySufficiency,
  resolveQuantityAndPromoSemantics
} from '../../db/productIdentityPolicy'
import type { UnifiedBatchOffer } from '../../../shared/types/batchExtraction'

function makeOffer(overrides: Partial<UnifiedBatchOffer> = {}): UnifiedBatchOffer {
  const id = overrides.sourceOfferId || 'offer_003a_test'
  const retailer = overrides.supermarketName || 'BinDawood'
  return {
    batchId: 'batch_003a_test',
    leafletId: overrides.leafletId || `leaflet_${retailer.toLowerCase()}`,
    sourceFileName: `${retailer.toLowerCase()}.pdf`,
    sourcePdfPath: `/tmp/${retailer.toLowerCase()}.pdf`,
    supermarketId: retailer.toLowerCase(),
    supermarketName: retailer,
    offerStartDate: '2026-06-03',
    offerEndDate: '2026-06-09',
    locationScope: 'national',
    locationLabel: null,
    cityId: null,
    regionId: null,
    sourceOfferId: id,
    canonicalSourceId: id,
    batchOfferKey: `${overrides.leafletId || retailer.toLowerCase()}::${id}`,
    sourcePage: 1,
    brand: 'Noor',
    brandEn: 'Noor',
    brandAr: 'نور',
    titleEn: 'Noor Canola Oil 1.5L',
    titleAr: 'نور زيت كانولا 1.5 لتر',
    variantOrFlavor: null,
    sale_unit_type: 'piece',
    sizeOrWeight: '1.5L',
    each_size_value: 1.5,
    each_size_unit: 'l',
    inner_pack_count: 1,
    total_content_value: null,
    total_content_unit: null,
    free_units_text: null,
    customer_limit: null,
    promo_condition_quantity: null,
    promotion_mechanic: null,
    bundle_quantity: null,
    promoPrice: 29.95,
    originalPrice: 42.95,
    discountPercent: 30,
    promoNotes: null,
    productThumbCropPath: null,
    offerCardCropPath: null,
    status: 'extracted',
    confidence: 'high',
    assortment_status: 'single_sku',
    matchingEvidence: null,
    ...overrides
  }
}

describe('WIFRAN-EXTRACTOR-CATALOG-MATCH-003A: Category C/D Policy, Large-Catalog Retrieval & Benchmark Dataset Integrity', () => {
  it('resolves canonical promotion.special_offer bare promo quantities ("2pcs", "3 pcs", "9 حبات") cleanly as single_unit_with_retail_promo', () => {
    const noor = makeOffer({
      sourceOfferId: 'BNDW_Test_p001_010',
      promo_condition_quantity: 2,
      promoNotes: '2pcs',
      canonical: { promotion: { special_offer: '2pcs' } }
    })
    const noorPkg = resolveQuantityAndPromoSemantics(noor)
    expect(noorPkg.packagingSemantics).toBe('single_unit_with_retail_promo')
    expect(noorPkg.manufacturerPackCount).toBe(1)
    expect(noorPkg.promoPurchaseQuantity).toBe(2)

    const qoot = makeOffer({
      sourceOfferId: 'noori_p001_007',
      brand: 'Qoot & Root',
      brandEn: 'Qoot & Root',
      titleEn: 'Qoot & Root Flour 1kg',
      titleAr: 'دقيق قوت اند روت ١ كجم',
      each_size_value: 1,
      each_size_unit: 'kg',
      sizeOrWeight: '1kg',
      promo_condition_quantity: 9,
      canonical: { promotion: { special_offer: '9 حبات' } }
    })
    const grouping = new BrandGroupingService()
    const qootAttrs = grouping.extractNormalizedAttributes(qoot)
    expect(qootAttrs.packagingSemantics).toBe('single_unit_with_retail_promo')
    expect(qootAttrs.manufacturerPackCount).toBe(1)
    expect(qootAttrs.promoPurchaseQuantity).toBe(9)
    expect(qootAttrs.isIdentitySufficient).toBe(true)
  })

  it('recovers manufacturer multipacks for lt, sheets, size-first >=4, and in-pack 7+3 Free while failing closed on ambiguous small size-first (<4)', () => {
    const grouping = new BrandGroupingService()

    // Case 1: Softy 10x130 Sheets with 7+3 Free in-pack bonus and null canonicalized unit
    const softy = makeOffer({
      sourceOfferId: 'noori_p001_009',
      brand: 'Softy',
      brandEn: 'Softy',
      brandAr: 'سوفتي',
      titleEn: 'Softy Facial Tissues Bag (7+3 Free) 10 x 130 Sheets',
      titleAr: 'مناديل سوفتي الوجه كيس (3+7مجاناً) 10×130 منديل',
      each_size_value: 130,
      each_size_unit: null,
      sizeOrWeight: '10x130 منديل',
      inner_pack_count: 10,
      promo_condition_quantity: null,
      promoNotes: '7+3 Free'
    })
    const softyAttrs = grouping.extractNormalizedAttributes(softy)
    expect(softyAttrs.eachSizeUnit).toBe('sheet')
    expect(softyAttrs.packagingSemantics).toBe('manufacturer_multipack')
    expect(softyAttrs.manufacturerPackCount).toBe(10)
    expect(softyAttrs.isIdentitySufficient).toBe(true)

    // Case 2: City Facial Tissue 10x150 (canonical unit previously stripped to null or 'other')
    const city = makeOffer({
      sourceOfferId: 'BNDW_Test_p004_008',
      brand: 'City',
      brandEn: 'City',
      brandAr: 'سيتي',
      titleEn: 'City Facial Tissue 10x150',
      titleAr: 'سيتي مناديل وجه ١٠×١٥٠',
      each_size_value: 150,
      each_size_unit: 'other',
      sizeOrWeight: '10x150',
      inner_pack_count: 10
    })
    const cityAttrs = grouping.extractNormalizedAttributes(city)
    expect(cityAttrs.eachSizeUnit).toBe('sheet')
    expect(cityAttrs.packagingSemantics).toBe('manufacturer_multipack')
    expect(cityAttrs.isIdentitySufficient).toBe(true)

    // Case 3: Size-first carton (4x1Lt and 40gm 12s) -> manufacturer_multipack
    const oil4x1Lt = resolveQuantityAndPromoSemantics(
      makeOffer({
        titleEn: 'Mazola Corn Oil 4x1Lt',
        titleAr: 'مازولا زيت ذرة 4×1 لتر',
        sizeOrWeight: '4x1Lt',
        each_size_value: 1,
        each_size_unit: 'l',
        inner_pack_count: 4
      })
    )
    expect(oil4x1Lt.packagingSemantics).toBe('manufacturer_multipack')
    expect(oil4x1Lt.manufacturerPackCount).toBe(4)

    const peanuts12s = resolveQuantityAndPromoSemantics(
      makeOffer({
        titleEn: 'Baja Salted Peanuts 40gm 12s',
        titleAr: 'باجة فول سوداني مملح 40 جم 12 حبة',
        sizeOrWeight: '40gm 12s',
        each_size_value: 40,
        each_size_unit: 'g',
        inner_pack_count: 12
      })
    )
    expect(peanuts12s.packagingSemantics).toBe('manufacturer_multipack')
    expect(peanuts12s.manufacturerPackCount).toBe(12)

    // Case 4: Ambiguous small size-first count (<4) with no promo text MUST fail closed
    const ambiguous2x = makeOffer({
      titleEn: 'Sample Spread 110gm x2',
      titleAr: 'عينة دهن 110 جم × 2',
      sizeOrWeight: '110gm x2',
      each_size_value: 110,
      each_size_unit: 'g',
      inner_pack_count: 2,
      promo_condition_quantity: null,
      promoNotes: null
    })
    const ambiguousAttrs = grouping.extractNormalizedAttributes(ambiguous2x)
    expect(ambiguousAttrs.packagingSemantics).toBe('ambiguous')
    expect(ambiguousAttrs.isIdentitySufficient).toBe(false)
    expect(ambiguousAttrs.insufficiencyCodes).toContain('PACKAGING_SEMANTICS_AMBIGUOUS')
  })

  it('distinguishes Arabic unit-price slash ("/ كيلو") from true multi-option slash titles', () => {
    const unitPriceOffer = makeOffer({
      brand: 'Unbranded',
      brandEn: 'Unbranded',
      titleEn: 'Fresh Local Onion / kg',
      titleAr: 'بصل طازج محلي / كيلو',
      each_size_value: 1,
      each_size_unit: 'kg',
      sizeOrWeight: '1 kg'
    })
    const grouping = new BrandGroupingService()
    const attrs = grouping.extractNormalizedAttributes(unitPriceOffer)
    expect(attrs.insufficiencyCodes).not.toContain('MULTI_OPTION_SLASH_TITLE')

    const multiOptionOffer = makeOffer({
      brand: 'Rani',
      brandEn: 'Rani',
      titleEn: 'Rani Juice Mango / Orange / Pineapple 240ml',
      titleAr: 'عصير راني مانجو / برتقال / أناناس 240 مل',
      each_size_value: 240,
      each_size_unit: 'ml',
      sizeOrWeight: '240ml'
    })
    const multiSuf = evaluateIdentitySufficiency(grouping.extractNormalizedAttributes(multiOptionOffer), multiOptionOffer)
    expect(multiSuf.isSufficient).toBe(false)
    expect(multiSuf.codes).toContain('MULTI_OPTION_SLASH_TITLE')
  })

  it('excludes brand words from secondary search and fails closed under saturated (>25) same-size catalogs while retrieving kg<->g equivalents', async () => {
    const grouping = new BrandGroupingService()

    // Build mock Supabase verifying query filters & fail-closed saturated 1000ml response
    const mockSearaRow = {
      id: '9001',
      name_ar: 'صدور دجاج طرية مجمدة سيارا 1.8 كجم',
      name_en: 'Seara Frozen Tender Chicken Breast 1.8Kg',
      brand_name: 'سيارا',
      variant_or_flavor: 'Tender Breast',
      each_size_value: 1800,
      each_size_unit: 'g',
      inner_pack_count: 1,
      default_image_url: null
    }

    const queriedTokens: string[] = []
    const mockSupabase: any = {
      from: () => {
        const state: any = { head: false, sizeFilter: null, orFilters: [] as string[] }
        const builder: any = {
          select: (_cols: string, opts?: any) => {
            if (opts?.head) state.head = true
            return builder
          },
          eq: () => builder,
          or: (clause: string) => {
            state.orFilters.push(clause)
            const m = clause.match(/name_en\.ilike\.%([^%]+)%/)
            if (m) queriedTokens.push(m[1])
            return builder
          },
          in: (_col: string, vals: number[]) => {
            state.sizeFilter = vals
            return builder
          },
          limit: () => {
            if (state.sizeFilter?.includes(1800)) {
              return Promise.resolve({ data: [mockSearaRow], error: null })
            }
            // Saturated Almarai 1000ml distractors that do NOT share Whey/Sparkling tokens
            if (state.orFilters.some((f: string) => f.includes('name_en.ilike'))) {
              return Promise.resolve({
                data: [
                  {
                    id: '7520',
                    name_ar: 'منتج المراعي تجريبي 1000 مل',
                    name_en: 'Almarai Stress Test Lactose Free Fermented Drink 1000ml #1',
                    brand_name: 'المراعي',
                    variant_or_flavor: 'StressVar_1',
                    each_size_value: 1000,
                    each_size_unit: 'ml',
                    inner_pack_count: 1,
                    default_image_url: null
                  }
                ],
                error: null
              })
            }
            return Promise.resolve({ data: [], error: null })
          },
          then: (resolve: any) => {
            if (state.head && state.sizeFilter) {
              return resolve({ count: 35, error: null })
            }
            if (state.head) {
              return resolve({ count: 138, error: null })
            }
            return resolve({ data: [], error: null })
          }
        }
        return builder
      }
    }

    // 1. Retrieval of 1.8kg vs 1800g DB row under large Seara catalog (>50)
    const searaOffer = makeOffer({
      brand: 'Seara',
      brandEn: 'Seara',
      brandAr: 'سيارا',
      titleEn: 'Seara Frozen Tender Chicken Breast 1.8Kg',
      titleAr: 'صدور دجاج سيارا 1.8 كجم',
      each_size_value: 1.8,
      each_size_unit: 'kg',
      sizeOrWeight: '1.8Kg'
    })
    const searaGroup = grouping.groupOffersByBrand([searaOffer])[0]
    const retrieval = await grouping.retrieveBrandCandidates(mockSupabase, searaGroup, 50)
    expect(retrieval.candidates.some((c) => c.id === '9001')).toBe(true)

    // 2. Saturated Almarai 1L bucket (>25 rows): brand tokens MUST NOT trigger Query 3A false match, and absence MUST fail closed!
    const almaraiOffer = makeOffer({
      brand: 'Almarai',
      brandEn: 'Almarai',
      brandAr: 'المراعي',
      titleEn: 'Almarai Sparkling Whey Beverage 1L',
      titleAr: 'مشروب مصل اللبن الغازي المراعي 1 لتر',
      each_size_value: 1,
      each_size_unit: 'l',
      sizeOrWeight: '1L'
    })
    const almaraiGroup = grouping.groupOffersByBrand([almaraiOffer])[0]
    ;(almaraiGroup as any).totalBrandProducts = 138
    almaraiGroup.candidates = []

    const absence = await grouping.verifyAbsenceInBrandCatalog(
      mockSupabase,
      almaraiGroup,
      almaraiGroup.uniqueIdentities[0]
    )
    expect(queriedTokens).not.toContain('almarai')
    expect(absence.foundCandidate).toBeNull()
    expect(absence.isExhaustivelyAbsent).toBe(false)
    expect(absence.coverage).toBe('partial')
  })

  it('prevents same-chunk "t1" collisions, reuses across retailers only when identical, resumes cleanly, and blocks conflicting offers', () => {
    const grouping = new BrandGroupingService()
    const reg = new TemporaryProductRegistry('003a_reg')
    const scoped = new Map<string, string>()

    const fakiehCarton = makeOffer({
      sourceOfferId: 'noori_f1',
      supermarketName: 'Noori',
      brand: 'Fakieh',
      brandEn: 'Fakieh',
      brandAr: 'فقيه',
      titleEn: 'Fakieh Frozen Chicken 10x1000g',
      titleAr: 'دجاج فقيه مجمد 10×1000 جم',
      each_size_value: 1000,
      each_size_unit: 'g',
      inner_pack_count: 10,
      sale_unit_type: 'carton',
      sizeOrWeight: '10x1000g'
    })
    const fakiehSingle = makeOffer({
      sourceOfferId: 'noori_f2',
      supermarketName: 'Noori',
      brand: 'Fakieh',
      brandEn: 'Fakieh',
      brandAr: 'فقيه',
      titleEn: 'Fakieh Frozen Chicken 1000g',
      titleAr: 'دجاج فقيه مجمد 1000 جم',
      each_size_value: 1000,
      each_size_unit: 'g',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      sizeOrWeight: '1000g'
    })

    const r1 = reg.reconcileTemporaryOffer({
      requestTempRef: 't1',
      requestScopedMap: scoped,
      attrs: grouping.extractNormalizedAttributes(fakiehCarton),
      sourceOffer: fakiehCarton
    })
    const r2 = reg.reconcileTemporaryOffer({
      requestTempRef: 't1',
      requestScopedMap: scoped,
      attrs: grouping.extractNormalizedAttributes(fakiehSingle),
      sourceOffer: fakiehSingle
    })
    expect(r1.temporaryId).not.toBe(r2.temporaryId)

    // Manifest resume across serialized groups
    const resumed = new TemporaryProductRegistry('003a_reg', reg.getGroups())
    const fakiehSingleOtherRetailer = makeOffer({
      ...fakiehSingle,
      sourceOfferId: 'panda_f2',
      supermarketName: 'Panda',
      batchOfferKey: 'leaflet_panda::panda_f2'
    })
    const rResume = resumed.reconcileTemporaryOffer({
      requestTempRef: 't1',
      requestScopedMap: new Map(),
      attrs: grouping.extractNormalizedAttributes(fakiehSingleOtherRetailer),
      sourceOffer: fakiehSingleOtherRetailer
    })
    expect(rResume.temporaryId).toBe(r2.temporaryId)
    expect(rResume.mergedWithExisting).toBe(true)

    // Conflicting 600g/700g assortment MUST be rejected from temporary creation
    const conflicting = makeOffer({
      sourceOfferId: 'Alwafa_Test_p001_007',
      brand: 'Fakieh',
      brandEn: 'Fakieh',
      brandAr: 'فقيه',
      titleEn: 'Fakieh Chicken 600gm',
      titleAr: 'فقيه دجاج ٧٠٠ جم',
      each_size_value: 600,
      each_size_unit: 'g',
      assortment_status: 'ambiguous_alternatives',
      matchingEvidence: {
        source_id: 'Alwafa_Test_p001_007',
        evidence_source: 'reviewer_annotation',
        assortment_status: 'ambiguous_alternatives',
        identity_resolution: 'requires_review',
        notes: '600g EN vs 700g AR conflict on crop',
        created_at: '2026-11-13T00:00:00Z',
        updated_at: '2026-11-13T00:00:00Z',
        reversible: true
      }
    })
    expect(() =>
      resumed.reconcileTemporaryOffer({
        requestTempRef: 't_bad',
        requestScopedMap: new Map(),
        attrs: grouping.extractNormalizedAttributes(conflicting),
        sourceOffer: conflicting
      })
    ).toThrow()
  })

  it('validates the crop-audited real_world_100_dataset_v2.json benchmark fixture integrity and deduplication counts', () => {
    const v2Path = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'real_world_100_dataset_v2.json')
    const v2 = JSON.parse(readFileSync(v2Path, 'utf8'))

    expect(v2.counts.totalExtractedOffers).toBe(106)
    expect(v2.counts.uniquePhysicalIdentities).toBe(105)
    expect(v2.counts.genuineRepeatedIdentities).toBe(1)
    expect(v2.counts.cropVerifiedCount).toBe(105)
    expect(v2.counts.provisionalNoCropCount).toBe(1)
    expect(v2.counts.trueSafeDecisionBreakdown).toEqual({
      existing: 21,
      temporary: 21,
      unresolved: 64
    })
    expect(v2.counts.overlayCorrectionsRequiredCount).toBe(6)
    expect(v2.items).toHaveLength(106)

    const overlayIds = v2.items
      .filter((x: any) => x.requiresEvidenceOverlayForTruth)
      .map((x: any) => x.canonicalSourceId)
      .sort()
    expect(overlayIds).toEqual([
      'Alwafa_Test_p001_007',
      'Alwafa_Test_p003_014',
      'Lulu_Test_p001_003',
      'Lulu_Test_p002_004',
      'noori-supermarket-229798534-jeddah_p001_006',
      'noori-supermarket-229798534-jeddah_p001_008'
    ])
  })
})

