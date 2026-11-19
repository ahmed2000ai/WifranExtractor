import { describe, it, expect } from 'vitest'
import { BrandGroupingService } from '../../db/brandGroupingService'
import { TemporaryProductRegistry } from '../../db/temporaryProductRegistry'
import {
  evaluateIdentitySufficiency,
  resolveQuantityAndPromoSemantics
} from '../../db/productIdentityPolicy'
import type { UnifiedBatchOffer } from '../../../shared/types/batchExtraction'

function makeOffer(overrides: Partial<UnifiedBatchOffer> = {}): UnifiedBatchOffer {
  const id = overrides.sourceOfferId || 'wp1_test_offer'
  const retailer = overrides.supermarketName || 'Othaim'
  return {
    batchId: 'batch_wp1_test',
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
    brand: null,
    brandEn: null,
    brandAr: null,
    titleEn: 'Sample Item',
    titleAr: 'صنف تجريبي',
    variantOrFlavor: null,
    sale_unit_type: 'piece',
    sizeOrWeight: null,
    each_size_value: null,
    each_size_unit: null,
    inner_pack_count: 1,
    total_content_value: null,
    total_content_unit: null,
    free_units_text: null,
    customer_limit: null,
    promo_condition_quantity: null,
    promotion_mechanic: null,
    bundle_quantity: null,
    promoPrice: 10,
    originalPrice: 15,
    discountPercent: 33,
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

describe('WIFRAN-EXTRACTOR-IDENTITY-005A (WP1): Deterministic Normalizer & Product Identity Safety Fixes', () => {
  const grouping = new BrandGroupingService()

  describe('1. Conservative legacy Othaim brand recovery & Coca-Cola identity separation', () => {
    it('recovers Coca-Cola from title/aliases while keeping Original and Zero Calories 24x320ml strictly separate', () => {
      const cocaOriginal = makeOffer({
        sourceOfferId: 'othaim-week24_002_001',
        titleEn: 'Coca Cola Can',
        titleAr: 'كوكا كولا علب',
        each_size_value: 320,
        each_size_unit: 'ml',
        inner_pack_count: 24,
        sizeOrWeight: '24x320ml'
      })

      const cocaZero = makeOffer({
        sourceOfferId: 'othaim-week24_002_003',
        titleEn: 'Coca Cola Can',
        titleAr: 'كوكا كولا علب',
        variantOrFlavor: null,
        canonical: { variant: 'Zero Calories', pack_quantity: 24, unit_size: 320, unit: 'ml' },
        each_size_value: 320,
        each_size_unit: 'ml',
        inner_pack_count: 24,
        sizeOrWeight: '24x320ml'
      })

      const origAttrs = grouping.extractNormalizedAttributes(cocaOriginal)
      const zeroAttrs = grouping.extractNormalizedAttributes(cocaZero)

      expect(origAttrs.brandKey).toBe('coca_cola')
      expect(origAttrs.brandStatus).toBe('known')
      expect(origAttrs.isIdentitySufficient).toBe(true)

      expect(zeroAttrs.brandKey).toBe('coca_cola')
      expect(zeroAttrs.brandStatus).toBe('known')
      expect(zeroAttrs.variantOrFlavor).toBe('Zero Calories')
      expect(zeroAttrs.isIdentitySufficient).toBe(true)

      // Both BrandGroupingService deduplication and TemporaryProductRegistry MUST keep them separate
      const groups = grouping.groupOffersByBrand([cocaOriginal, cocaZero])
      expect(groups).toHaveLength(1)
      expect(groups[0].brandKey).toBe('coca_cola')
      expect(groups[0].uniqueIdentities).toHaveLength(2)

      const registry = new TemporaryProductRegistry('batch_coca_sep')
      const rOrig = registry.reconcileTemporaryOffer({
        requestTempRef: 't1',
        requestScopedMap: new Map(),
        attrs: origAttrs,
        sourceOffer: cocaOriginal
      })
      const rZero = registry.reconcileTemporaryOffer({
        requestTempRef: 't2',
        requestScopedMap: new Map(),
        attrs: zeroAttrs,
        sourceOffer: cocaZero
      })
      expect(rOrig.temporaryId).not.toBe(rZero.temporaryId)
      expect(rZero.mergedWithExisting).toBe(false)
      expect(
        registry.areIdentitiesEquivalent(origAttrs, registry.getGroup(rZero.temporaryId)!)
      ).toBe(false)
    })

    it('respects existing verified aliases including Arabic "كوكا كولا" and "كوكاكولا" without guessing arbitrary words', () => {
      expect(
        grouping.normalizeBrand({
          titleEn: 'Sparkling Beverage',
          titleAr: 'كوكا كولا علب'
        }).brandKey
      ).toBe('coca_cola')

      expect(
        grouping.normalizeBrand({
          titleEn: 'Classic Soda',
          titleAr: 'كوكاكولا زيرو'
        }).brandKey
      ).toBe('coca_cola')

      // Negative: unverified/arbitrary words MUST NOT be guessed as brands
      for (const arbitrary of [
        { titleEn: 'Onix QLED Smart TV', titleAr: 'شاشة سمارت' },
        { titleEn: 'Tomato / Kg', titleAr: 'طماطم / كيلو' },
        { titleEn: 'Hand Mixer 260W', titleAr: 'خلاط يدوي ٢٦٠ واط' },
        { titleEn: 'Fresh Local Onion / kg', titleAr: 'بصل طازج محلي / كيلو' }
      ]) {
        const res = grouping.normalizeBrand(arbitrary)
        expect(res.status === 'unknown' || res.status === 'unbranded').toBe(true)
        expect(res.brandKey).not.toBe('onix')
        expect(res.brandKey).not.toBe('hand')
      }
    })

    it('forces contradictory EN/AR or multi-brand evidence to remain unresolved', () => {
      const explicitConflict = makeOffer({
        brand: null,
        brandEn: 'Coca-Cola',
        brandAr: 'بيبسي',
        titleEn: 'Coca Cola Can 320ml',
        titleAr: 'بيبسي علب ٣٢٠ مل',
        each_size_value: 320,
        each_size_unit: 'ml',
        sizeOrWeight: '320ml'
      })
      const explicitConflictAttrs = grouping.extractNormalizedAttributes(explicitConflict)
      expect(explicitConflictAttrs.brandStatus).toBe('unknown')
      expect(explicitConflictAttrs.isIdentitySufficient).toBe(false)
      expect(explicitConflictAttrs.insufficiencyCodes).toContain('UNKNOWN_BRAND')

      const titleConflict = makeOffer({
        brand: null,
        titleEn: 'Coca Cola Can',
        titleAr: 'بيبسي علب',
        each_size_value: 320,
        each_size_unit: 'ml',
        sizeOrWeight: '320ml'
      })
      const titleConflictAttrs = grouping.extractNormalizedAttributes(titleConflict)
      expect(titleConflictAttrs.brandStatus).toBe('unknown')
      expect(titleConflictAttrs.isIdentitySufficient).toBe(false)

      const multiBrandSlash = makeOffer({
        titleEn: 'Protein Alyoum/Al Rawabi Alfailaq Eggs',
        titleAr: 'بيض بروتين اليوم/الروابي/الفيلق',
        each_size_value: 30,
        each_size_unit: 'pcs'
      })
      const multiSlashAttrs = grouping.extractNormalizedAttributes(multiBrandSlash)
      expect(multiSlashAttrs.brandStatus).toBe('unknown')
      expect(multiSlashAttrs.isIdentitySufficient).toBe(false)
    })

    it('keeps Othaim Sadia Nuggets raw pack=5 without multipack notation safely unresolved', () => {
      const sadiaRaw = makeOffer({
        sourceOfferId: 'othaim-week24_001_001',
        titleEn: 'Sadia Nuggets Chicken',
        titleAr: 'سادية ناجتس دجاج',
        each_size_value: 270,
        each_size_unit: 'g',
        inner_pack_count: 5,
        sizeOrWeight: '270g',
        promoNotes: 'Each',
        canonical: { price_condition: 'Each', pack_quantity: 5, unit_size: 270, unit: 'g' }
      })
      const attrs = grouping.extractNormalizedAttributes(sadiaRaw)
      expect(attrs.brandKey).toBe('sadia')
      expect(attrs.isIdentitySufficient).toBe(false)
      expect(attrs.insufficiencyCodes).toContain('PACKAGING_SEMANTICS_AMBIGUOUS')

      // Even if a downstream adapter formatted synthetic "5x270g", "Each" + pack=5 fails closed!
      const sadiaSynthetic5x = makeOffer({
        ...sadiaRaw,
        sizeOrWeight: '5x270g'
      })
      const attrsSynth = grouping.extractNormalizedAttributes(sadiaSynthetic5x)
      expect(attrsSynth.brandKey).toBe('sadia')
      expect(attrsSynth.isIdentitySufficient).toBe(false)
      expect(attrsSynth.insufficiencyCodes).toContain('PACKAGING_SEMANTICS_AMBIGUOUS')
    })

    it('keeps Coca-Cola 4 x 1 PCS unresolved when volume is not established, and refuses merging omitted variant with Original or Zero Calories', () => {
      const coca4x1Pcs = makeOffer({
        sourceOfferId: 'othaim-week24_002_004',
        titleEn: 'Coca Cola',
        titleAr: 'كوكا كولا بلاستيك',
        each_size_value: 1,
        each_size_unit: 'pcs',
        inner_pack_count: 4,
        sizeOrWeight: '4x1pcs'
      })
      const attrs4x1 = grouping.extractNormalizedAttributes(coca4x1Pcs)
      expect(attrs4x1.brandKey).toBe('coca_cola')
      expect(attrs4x1.manufacturerPackCount).toBe(4)
      expect(attrs4x1.isIdentitySufficient).toBe(false)
      expect(attrs4x1.insufficiencyCodes).toContain('MISSING_UNIT_SIZE')

      // Beverage with omitted variant MUST NOT assume Original OR merge with Zero Calories
      const cocaOmitted = grouping.extractNormalizedAttributes(
        makeOffer({
          sourceOfferId: 'coca_omitted_var',
          titleEn: 'Coca Cola Can',
          titleAr: 'كوكا كولا علب',
          variantOrFlavor: null,
          each_size_value: 320,
          each_size_unit: 'ml',
          inner_pack_count: 24,
          sizeOrWeight: '24x320ml'
        })
      )
      const cocaExplicitOriginal = grouping.extractNormalizedAttributes(
        makeOffer({
          sourceOfferId: 'coca_orig_var',
          titleEn: 'Coca Cola Can Original',
          titleAr: 'كوكا كولا علب أصلي',
          variantOrFlavor: 'Original',
          each_size_value: 320,
          each_size_unit: 'ml',
          inner_pack_count: 24,
          sizeOrWeight: '24x320ml'
        })
      )
      const cocaExplicitZero = grouping.extractNormalizedAttributes(
        makeOffer({
          sourceOfferId: 'coca_zero_var',
          titleEn: 'Coca Cola Can Zero Calories',
          titleAr: 'كوكا كولا علب زيرو كالوري',
          variantOrFlavor: null,
          each_size_value: 320,
          each_size_unit: 'ml',
          inner_pack_count: 24,
          sizeOrWeight: '24x320ml'
        })
      )

      const registry = new TemporaryProductRegistry('batch_coca_preflight')
      const gOmitted = registry.reconcileTemporaryOffer({
        requestTempRef: 't1',
        requestScopedMap: new Map(),
        attrs: cocaOmitted,
        sourceOffer: makeOffer({ sourceOfferId: 'coca_omitted_var' })
      })
      expect(registry.areIdentitiesEquivalent(cocaExplicitOriginal, registry.getGroup(gOmitted.temporaryId)!)).toBe(false)
      expect(registry.areIdentitiesEquivalent(cocaExplicitZero, registry.getGroup(gOmitted.temporaryId)!)).toBe(false)
      expect(registry.buildCanonicalIdentityFingerprint(cocaOmitted)).not.toBe(
        registry.buildCanonicalIdentityFingerprint(cocaExplicitOriginal)
      )
      expect(registry.buildCanonicalIdentityFingerprint(cocaOmitted)).not.toBe(
        registry.buildCanonicalIdentityFingerprint(cocaExplicitZero)
      )
    })
  })

  describe('2. Mixed Parts vs true assortment classification', () => {
    it('stops false-positive assortment blocking on Golden Chicken Mixed Parts (800g) and single-SKU mixes', () => {
      const mixedParts = makeOffer({
        sourceOfferId: 'Panda_Test_p003_013',
        supermarketName: 'Panda',
        brand: 'الفروج الذهبي',
        brandEn: 'الفروج الذهبي',
        titleEn: 'Golden Chicken Mixed Parts (800g)',
        titleAr: 'قطع دجاج الفروج الذهبي (۸۰۰ جرام)',
        each_size_value: 800,
        each_size_unit: 'g',
        sizeOrWeight: '800g'
      })
      const attrs = grouping.extractNormalizedAttributes(mixedParts)
      expect(attrs.brandKey).toBe('golden_chicken')
      expect(attrs.isAssortment).toBe(false)
      expect(attrs.insufficiencyCodes).not.toContain('TEXT_ASSORTMENT_KEYWORD')
      expect(attrs.isIdentitySufficient).toBe(true)

      const mixedVeg = makeOffer({
        brand: 'Sunbulah',
        brandEn: 'Sunbulah',
        titleEn: 'Sunbulah Mixed Vegetables 400g',
        titleAr: 'خضار السنبلة ٤٠٠ جم',
        each_size_value: 400,
        each_size_unit: 'g',
        sizeOrWeight: '400g'
      })
      expect(grouping.extractNormalizedAttributes(mixedVeg).isIdentitySufficient).toBe(true)
    })

    it('preserves assortment blocking for Assorted, Asstd, منوع, مشكل, and multi-flavor titles', () => {
      const cases = [
        { titleEn: 'Dove Soap 125g Asstd.', titleAr: 'صابون دوف ١٢٥ جم' },
        { titleEn: 'Almarai Treat 150g Assorted', titleAr: 'المراعي ١٥٠ جم' },
        { titleEn: 'Almarai Juice 1L', titleAr: 'عصير المراعي منوع ١ لتر' },
        { titleEn: 'Galaxy Sweets 200g', titleAr: 'جالكسي شوكولاتة مشكل ٢٠٠ جم' },
        { titleEn: 'Indomie Noodles Mixed Flavors 75g', titleAr: 'اندومي نودلز' },
        { titleEn: 'Rani Juice Mango / Orange 240ml', titleAr: 'عصير راني مانجو / برتقال' }
      ]
      for (const c of cases) {
        const res = evaluateIdentitySufficiency(
          { brandKey: 'dove', brandStatus: 'known', eachSizeValue: 125, eachSizeUnit: 'g', saleUnitType: 'piece' },
          makeOffer(c)
        )
        expect(res.isAssortment).toBe(true)
        expect(res.isSufficient).toBe(false)
      }
    })
  })

  describe('3. Temporary product fingerprint cleanup while preserving factory pack & variants', () => {
    it('strips promo/bonus/limit/loyalty noise from Softy and produces identical fingerprint across leaflets without altering metadata', () => {
      const softyWithPromo = makeOffer({
        sourceOfferId: 'noori_p001_009',
        supermarketName: 'Noori',
        brand: 'Softy',
        brandEn: 'Softy',
        brandAr: 'سوفتي',
        titleEn: 'Softy Facial Tissues Bag (7+3 Free) 10 x 130 Sheets Limit 2 Per Customer',
        titleAr: 'مناديل سوفتي الوجه كيس (3+7مجاناً) 10×130 منديل بطاقة الولاء',
        each_size_value: 130,
        each_size_unit: 'sheet',
        inner_pack_count: 10,
        sizeOrWeight: '10x130 Sheets',
        promoNotes: '7+3 Free',
        free_units_text: '3 Free',
        customer_limit: 2
      })

      const softyClean = makeOffer({
        sourceOfferId: 'panda_softy_clean',
        supermarketName: 'Panda',
        brand: 'Softy',
        brandEn: 'Softy',
        brandAr: 'سوفتي',
        titleEn: 'Softy Facial Tissues Bag 10 x 130 Sheets BUY 2 PCS 2 FOR',
        titleAr: 'مناديل سوفتي الوجه كيس 10×130 منديل',
        each_size_value: 130,
        each_size_unit: 'sheet',
        inner_pack_count: 10,
        sizeOrWeight: '10x130 Sheets',
        promoNotes: 'BUY 2 PCS',
        promo_condition_quantity: 2,
        promotion_mechanic: 'multi_buy'
      })

      // softyClean has "BUY 2 PCS" alongside 10x130 carton -> manufacturerPackCount stays 10
      const attrsA = grouping.extractNormalizedAttributes(softyWithPromo)
      const attrsB = grouping.extractNormalizedAttributes(softyClean)
      expect(attrsA.manufacturerPackCount).toBe(10)
      expect(attrsB.manufacturerPackCount).toBe(10)

      const registry = new TemporaryProductRegistry('batch_fp_clean')
      const fpA = registry.buildCanonicalIdentityFingerprint(attrsA)
      const fpB = registry.buildCanonicalIdentityFingerprint(attrsB)

      expect(fpA).toBe(fpB)
      expect(fpA).toContain('130sheet_x10')
      expect(fpA).not.toMatch(/3\+7|7\+3|free|limit|customer|loyalty|مجان|ولاء|buy/i)

      // Promo metadata on source offer remains untouched
      expect(softyWithPromo.promoNotes).toBe('7+3 Free')
      expect(softyWithPromo.free_units_text).toBe('3 Free')
      expect(softyWithPromo.customer_limit).toBe(2)

      // Reconcile merges identical SKUs across leaflets
      const recA = registry.reconcileTemporaryOffer({
        requestTempRef: 't1',
        requestScopedMap: new Map(),
        attrs: attrsA,
        sourceOffer: softyWithPromo
      })
      const recB = registry.reconcileTemporaryOffer({
        requestTempRef: 't2',
        requestScopedMap: new Map(),
        attrs: attrsB,
        sourceOffer: softyClean
      })
      expect(recB.temporaryId).toBe(recA.temporaryId)
      expect(recB.mergedWithExisting).toBe(true)

      // Negative: different pack count (6x130 vs 10x130), single unit, or Sugar Free variant MUST NOT merge
      const softy6Pack = makeOffer({
        sourceOfferId: 'softy_6pack',
        supermarketName: 'BinDawood',
        brand: 'Softy',
        brandEn: 'Softy',
        brandAr: 'سوفتي',
        titleEn: 'Softy Facial Tissues Bag 6 x 130 Sheets',
        titleAr: 'مناديل سوفتي الوجه كيس 6×130 منديل',
        each_size_value: 130,
        each_size_unit: 'sheet',
        inner_pack_count: 6,
        sizeOrWeight: '6x130 Sheets'
      })
      const rec6 = registry.reconcileTemporaryOffer({
        requestTempRef: 't3',
        requestScopedMap: new Map(),
        attrs: grouping.extractNormalizedAttributes(softy6Pack),
        sourceOffer: softy6Pack
      })
      expect(rec6.temporaryId).not.toBe(recA.temporaryId)

      const cocaRegular = grouping.extractNormalizedAttributes(
        makeOffer({
          titleEn: 'Coca-Cola Original Can 24x320ml Free Delivery',
          titleAr: 'كوكاكولا علب ٢٤×٣٢٠ مل',
          each_size_value: 320,
          each_size_unit: 'ml',
          inner_pack_count: 24,
          sizeOrWeight: '24x320ml'
        })
      )
      const cocaSugarFree = grouping.extractNormalizedAttributes(
        makeOffer({
          titleEn: 'Coca-Cola Sugar Free Can 24x320ml',
          titleAr: 'كوكاكولا بدون سكر علب ٢٤×٣٢٠ مل',
          each_size_value: 320,
          each_size_unit: 'ml',
          inner_pack_count: 24,
          sizeOrWeight: '24x320ml'
        })
      )
      expect(registry.buildCanonicalIdentityFingerprint(cocaRegular)).not.toBe(
        registry.buildCanonicalIdentityFingerprint(cocaSugarFree)
      )
    })

    it('preserves identity-defining "Free" attributes while still cleaning promotional "Free" across leaflets', () => {
      const registry = new TemporaryProductRegistry('batch_free_attrs')
      const pairs: Array<[string, string, string]> = [
        ['Sugar Free / Zero Sugar', 'Nestle Fitness Cereal Sugar Free 375g', 'Nestle Fitness Cereal 375g'],
        ['Gluten Free', 'Schar Corn Flakes Gluten Free 300g', 'Schar Corn Flakes 300g'],
        ['Lactose Free', 'Almarai Fresh Milk Lactose Free 1L', 'Almarai Fresh Milk 1L'],
        ['Fat Free', 'Nadec Long Life Milk Fat Free 1L', 'Nadec Long Life Milk 1L'],
        ['Caffeine Free', 'Nescafe Gold Instant Coffee Caffeine Free 200g', 'Nescafe Gold Instant Coffee 200g'],
        ['Fragrance Free', 'Dove Sensitive Bar Soap Fragrance Free 125g', 'Dove Sensitive Bar Soap 125g'],
        ['Free Range', 'Al Falah White Fresh Free Range Eggs 30pcs', 'Al Falah White Fresh Eggs 30pcs']
      ]

      for (const [label, specialTitle, standardTitle] of pairs) {
        const attrSpec = grouping.extractNormalizedAttributes(
          makeOffer({
            sourceOfferId: `spec_${label}`,
            brand: 'TestBrand',
            brandEn: 'TestBrand',
            titleEn: `${specialTitle} BUY 2 PCS Free Gift Limit 2 Per Customer`,
            titleAr: '',
            each_size_value: label === 'Free Range' ? 30 : 300,
            each_size_unit: label === 'Free Range' ? 'pcs' : 'g',
            inner_pack_count: 1,
            sizeOrWeight: label === 'Free Range' ? '30pcs' : '300g'
          })
        )
        const attrStd = grouping.extractNormalizedAttributes(
          makeOffer({
            sourceOfferId: `std_${label}`,
            brand: 'TestBrand',
            brandEn: 'TestBrand',
            titleEn: standardTitle,
            titleAr: '',
            each_size_value: label === 'Free Range' ? 30 : 300,
            each_size_unit: label === 'Free Range' ? 'pcs' : 'g',
            inner_pack_count: 1,
            sizeOrWeight: label === 'Free Range' ? '30pcs' : '300g'
          })
        )
        const recSpec = registry.reconcileTemporaryOffer({
          requestTempRef: 't_spec',
          requestScopedMap: new Map(),
          attrs: attrSpec,
          sourceOffer: makeOffer({ sourceOfferId: `spec_${label}` })
        })
        expect(
          registry.areIdentitiesEquivalent(attrStd, registry.getGroup(recSpec.temporaryId)!),
          `${label} should never merge with standard variant`
        ).toBe(false)
        expect(registry.buildCanonicalIdentityFingerprint(attrSpec)).not.toBe(
          registry.buildCanonicalIdentityFingerprint(attrStd)
        )
      }
    })
  })

  describe('4. 5+1 Free packaging safety correction', () => {
    it('fails closed (never inferring mfg_pack=6) when 5+1 Free lacks sealed multipack or checkout BXGY evidence', () => {
      const bare5Plus1WithPack6 = makeOffer({
        sourceOfferId: 'dove_5plus1_ambig',
        brand: 'Dove',
        brandEn: 'Dove',
        titleEn: 'Dove Beauty Bar White 125Gm 5+1 Free',
        titleAr: 'صابون دوف أبيض ١٢٥ جم ٥+١ مجانا',
        each_size_value: 125,
        each_size_unit: 'g',
        inner_pack_count: 6,
        sizeOrWeight: '125Gm 5+1 Free',
        quantity_semantics: 'manufacturer_multipack' // even raw extractor guessing multipack without 6x125g proof must fail closed!
      })
      const pkg = resolveQuantityAndPromoSemantics(bare5Plus1WithPack6)
      expect(pkg.packagingSemantics).toBe('ambiguous')
      expect(pkg.isPackagingAmbiguous).toBe(true)
      expect(pkg.manufacturerPackCount).toBe(1)

      const evalRes = evaluateIdentitySufficiency(
        grouping.extractNormalizedAttributes(bare5Plus1WithPack6),
        bare5Plus1WithPack6
      )
      expect(evalRes.isSufficient).toBe(false)
      expect(evalRes.codes).toContain('PACKAGING_SEMANTICS_AMBIGUOUS')
    })

    it('classifies confirmed 6x125g (5+1 Free) as factory 6-pack and explicit Buy 5 Get 1 Free as mfg_pack=1 + retail_promo', () => {
      const sealed6Pack = makeOffer({
        brand: 'Dove',
        brandEn: 'Dove',
        titleEn: 'Dove Beauty Bar White 6x125g (5+1 Free)',
        titleAr: 'صابون دوف أبيض ٦×١٢٥ جم (٥+١ مجانا)',
        each_size_value: 125,
        each_size_unit: 'g',
        inner_pack_count: 6,
        sizeOrWeight: '6x125g'
      })
      const sealedPkg = resolveQuantityAndPromoSemantics(sealed6Pack)
      expect(sealedPkg.packagingSemantics).toBe('manufacturer_multipack')
      expect(sealedPkg.manufacturerPackCount).toBe(6)
      expect(sealedPkg.isPackagingAmbiguous).toBe(false)

      const checkoutBxgy = makeOffer({
        brand: 'Dove',
        brandEn: 'Dove',
        titleEn: 'Dove Beauty Bar White 125g Buy 5 Get 1 Free',
        titleAr: 'صابون دوف أبيض ١٢٥ جم اشتري ٥ واحصل على ١ مجانا',
        each_size_value: 125,
        each_size_unit: 'g',
        inner_pack_count: 6,
        sizeOrWeight: '125g'
      })
      const bxgyPkg = resolveQuantityAndPromoSemantics(checkoutBxgy)
      expect(bxgyPkg.packagingSemantics).toBe('single_unit_with_retail_promo')
      expect(bxgyPkg.manufacturerPackCount).toBe(1)
      expect(bxgyPkg.promoPurchaseQuantity).toBe(5)
      expect(bxgyPkg.isPackagingAmbiguous).toBe(false)
    })

    it('keeps Alwafa_Test_p001_012 (Dove Soap 125Gm 5+1 Free Asstd.) blocked on both assortment and ambiguous packaging', () => {
      const doveAsstd = makeOffer({
        sourceOfferId: 'Alwafa_Test_p001_012',
        supermarketName: 'AlWafa',
        brand: 'Dove',
        brandEn: 'Dove',
        brandAr: 'دوف',
        titleEn: 'Dove Soap 125Gm 5+1 Free Asstd.',
        titleAr: 'صابون دوف للاستحمام ١٢٥ جرام ٥+١ مجانا منوع',
        each_size_value: 125,
        each_size_unit: 'g',
        inner_pack_count: 6,
        sizeOrWeight: '125Gm 5+1 Free'
      })
      const attrs = grouping.extractNormalizedAttributes(doveAsstd)
      expect(attrs.isAssortment).toBe(true)
      expect(attrs.packagingSemantics).toBe('ambiguous')
      expect(attrs.manufacturerPackCount).toBe(1)
      expect(attrs.isIdentitySufficient).toBe(false)
      expect(attrs.insufficiencyCodes).toContain('TEXT_ASSORTMENT_KEYWORD')
      expect(attrs.insufficiencyCodes).toContain('PACKAGING_SEMANTICS_AMBIGUOUS')
    })
  })
})
