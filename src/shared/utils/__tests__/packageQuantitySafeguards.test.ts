import { describe, it, expect } from 'vitest'
import {
  detectPackageConfigurationContext,
  analyzeTableHeading,
  validateImageSafetyWithPackageSafeguards,
  validateCatalogMatchingWithPackageSafeguards
} from '../packageQuantitySafeguards'
import { validateProductIdentityCompatibility } from '../../../main/db/productIdentityCompatibilityValidator'

describe('Package Size and Multipack Safeguards', () => {
  describe('1. Package Variant vs Multipack Detection', () => {
    it('detects standalone 5 kg and 10 kg package variants cleanly', () => {
      const offer5kg = detectPackageConfigurationContext({
        titleEn: 'Al Walimah Style Sella Basmati Rice 5kg',
        titleAr: 'أرز بسمتي سيلا الوليمة ستايل 5 كجم',
        eachSizeValue: 5,
        eachSizeUnit: 'kg',
        innerPackCount: 1
      })

      expect(offer5kg.configurationKind).toBe('standalone_package_variant')
      expect(offer5kg.physicalPackage.nominalSizeValue).toBe(5)
      expect(offer5kg.physicalPackage.nominalSizeUnit).toBe('kg')
      expect(offer5kg.physicalPackage.packCount).toBe(1)
      expect(offer5kg.physicalPackage.isMultipack).toBe(false)
      expect(offer5kg.physicalPackage.saleUnitType).toBe('piece')

      const offer10kg = detectPackageConfigurationContext({
        titleEn: 'Al Walimah Style Sella Basmati Rice 10kg',
        titleAr: 'أرز بسمتي سيلا الوليمة ستايل 10 كجم',
        eachSizeValue: 10,
        eachSizeUnit: 'kg',
        innerPackCount: 1
      })

      expect(offer10kg.configurationKind).toBe('standalone_package_variant')
      expect(offer10kg.physicalPackage.nominalSizeValue).toBe(10)
      expect(offer10kg.physicalPackage.nominalSizeUnit).toBe('kg')
      expect(offer10kg.physicalPackage.packCount).toBe(1)
      expect(offer10kg.physicalPackage.isMultipack).toBe(false)
      expect(offer10kg.physicalPackage.saleUnitType).toBe('piece')
    })

    it('detects two 5 kg packages sold together as a multipack bundle', () => {
      const bundleEn = detectPackageConfigurationContext({
        titleEn: 'Al Safwa Indian Basmati Rice 2 x 5 kg',
        titleAr: 'أرز بسمتي هندي الصفوة 2 × 5 كجم'
      })

      expect(bundleEn.configurationKind).toBe('multipack_bundle')
      expect(bundleEn.physicalPackage.nominalSizeValue).toBe(5)
      expect(bundleEn.physicalPackage.nominalSizeUnit).toBe('kg')
      expect(bundleEn.physicalPackage.packCount).toBe(2)
      expect(bundleEn.physicalPackage.isMultipack).toBe(true)
      expect(bundleEn.physicalPackage.totalContentValue).toBe(10)
      expect(bundleEn.physicalPackage.totalContentUnit).toBe('kg')
      expect(bundleEn.physicalPackage.saleUnitType).toBe('bundle')
      expect(bundleEn.catalogMatchingPolicy.targetMatchMode).toBe('bundle_referencing_underlying_sku')
      expect(bundleEn.catalogMatchingPolicy.preventFictionalSkuCreation).toBe(true)
    })

    it('detects Arabic bundle wording (ربطة 2 كيس × 5 كجم)', () => {
      const bundleAr = detectPackageConfigurationContext({
        titleAr: 'ربطة 2 كيس × 5 كجم أرز الشعلان'
      })

      expect(bundleAr.configurationKind).toBe('multipack_bundle')
      expect(bundleAr.physicalPackage.nominalSizeValue).toBe(5)
      expect(bundleAr.physicalPackage.nominalSizeUnit).toBe('kg')
      expect(bundleAr.physicalPackage.packCount).toBe(2)
      expect(bundleAr.physicalPackage.isMultipack).toBe(true)
    })

    it('detects multi-buy promo conditions and distinguishes them from multipacks', () => {
      const buy2get1 = detectPackageConfigurationContext({
        titleEn: 'Lurpak Butter 100g',
        promoNotes: 'Buy 2 Get 1 Free',
        eachSizeValue: 100,
        eachSizeUnit: 'g'
      })

      expect(buy2get1.configurationKind).toBe('conditional_quantity_discount')
      expect(buy2get1.promotionalCondition.isMultiBuyPricing).toBe(true)
      expect(buy2get1.promotionalCondition.multiBuyRequiredQuantity).toBe(2)
      expect(buy2get1.physicalPackage.packCount).toBe(1)
      expect(buy2get1.physicalPackage.isMultipack).toBe(false)

      const multiPrice = detectPackageConfigurationContext({
        titleAr: 'تونة قودي 185 جم - 2 حبات بسعر 15 ريال',
        eachSizeValue: 185,
        eachSizeUnit: 'g'
      })

      expect(multiPrice.configurationKind).toBe('conditional_quantity_discount')
      expect(multiPrice.promotionalCondition.isMultiBuyPricing).toBe(true)
      expect(multiPrice.promotionalCondition.multiBuyRequiredQuantity).toBe(2)
    })

    it('isolates customer purchase limits from physical pack counts', () => {
      const limitAr = detectPackageConfigurationContext({
        titleAr: 'أرز بسمتي الشعلان 10 كجم - حد أقصى 2 حبة لكل عميل',
        eachSizeValue: 10,
        eachSizeUnit: 'kg',
        innerPackCount: 2 // simulated naive extractor output
      })

      expect(limitAr.promotionalCondition.hasCustomerPurchaseLimit).toBe(true)
      expect(limitAr.promotionalCondition.customerLimitPcs).toBe(2)
      // Safeguard must correct pack count from 2 back to 1!
      expect(limitAr.physicalPackage.packCount).toBe(1)
      expect(limitAr.physicalPackage.isMultipack).toBe(false)
      expect(limitAr.physicalPackage.nominalSizeValue).toBe(10)
      expect(limitAr.physicalPackage.nominalSizeUnit).toBe('kg')

      const limitEn = detectPackageConfigurationContext({
        titleEn: 'Sunwhite Calrose Rice 5kg - Max 2 pcs per customer',
        conditionText: 'Limit 2 per customer',
        eachSizeValue: 5,
        eachSizeUnit: 'kg'
      })

      expect(limitEn.promotionalCondition.hasCustomerPurchaseLimit).toBe(true)
      expect(limitEn.promotionalCondition.customerLimitPcs).toBe(2)
      expect(limitEn.physicalPackage.packCount).toBe(1)
    })

    it('cross-examines table headings and row labels without making blind assumptions', () => {
      // Case A: Table heading "SIZE" but row says "2 PCS" -> corrected to quantity condition
      const tableA = analyzeTableHeading('SIZE', '2 PCS')
      expect(tableA.headingType).toBe('quantity_condition')

      // Case B: Table heading "QTY" but row says "10 KG" -> corrected to size variant
      const tableB = analyzeTableHeading('QTY', '10 KG')
      expect(tableB.headingType).toBe('size_variant')

      // Case C: Table heading "الحجم" and row says "10 كجم" -> confirmed size variant
      const tableC = analyzeTableHeading('الحجم', '10 كجم')
      expect(tableC.headingType).toBe('size_variant')

      // Case D: Table heading "الكمية" and row says "3 حبات" -> confirmed quantity condition
      const tableD = analyzeTableHeading('الكمية', '3 حبات')
      expect(tableD.headingType).toBe('quantity_condition')
    })

    it('classifies multi-variant assortments as ambiguous_unconfirmed to prevent accidental SKU lock-in', () => {
      const assortment = detectPackageConfigurationContext({
        titleEn: 'Sadia Frozen Chicken Griller 700g / 750g Assorted',
        titleAr: 'دجاج ساديا مجمد 700 جم / 750 جم مشكل',
        assortmentStatus: 'multiple_variants'
      })

      expect(assortment.configurationKind).toBe('ambiguous_unconfirmed')
      expect(assortment.catalogMatchingPolicy.allowAutomaticDirectMatch).toBe(false)
      expect(assortment.catalogMatchingPolicy.enforceCandidateStatus).toBe(true)
    })
  })

  describe('2. Catalog Matching Protection', () => {
    // Al Walimah 5 kg corresponds to Product #36, NOT Product #19
    const catalogProduct36 = {
      id: 36,
      name_en: 'AL WALIMAH Rice Long Grain White Basmathi 5 kg',
      name_ar: 'أرز بسمتي أبيض طويل الحبة الوليمة 5 كجم',
      brand_name: 'Al Walimah',
      each_size_value: 5,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'verified'
    }

    const catalogProduct37 = {
      id: 37,
      name_en: 'AL WALIMAH Rice Long Grain White Basmathi 10 kg',
      name_ar: 'أرز بسمتي أبيض طويل الحبة الوليمة 10 كجم',
      brand_name: 'Al Walimah',
      each_size_value: 10,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'candidate'
    }

    // Al Bayt Creamy Sella 5 kg corresponds to Product #19 (candidate)
    const catalogProduct19 = {
      id: 19,
      name_en: 'Al Bayt Creamy Sella Long Grain Basmati Rice 5 kg',
      name_ar: 'أرز بسمتي سيلا كريمي طويل الحبة البيت 5 كجم',
      brand_name: 'Al Bayt',
      each_size_value: 5,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'candidate'
    }

    // Al Bayt Creamy Sella 10 kg corresponds to Product #38 (candidate)
    const catalogProduct38 = {
      id: 38,
      name_en: 'Al Bayt Creamy Sella Long Grain Basmati Rice 10 kg',
      name_ar: 'أرز بسمتي سيلا كريمي طويل الحبة البيت 10 كجم',
      brand_name: 'Al Bayt',
      each_size_value: 10,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'candidate'
    }

    it('strictly rejects matching a 10 kg offer to a 5 kg catalog product', () => {
      const offer10kg = {
        title_en: 'Al Walimah Style Sella Basmati Rice 10kg',
        title_ar: 'أرز بسمتي سيلا الوليمة ستايل 10 كجم',
        each_size_value: 10,
        each_size_unit: 'kg',
        inner_pack_count: 1
      }

      const match5kg = validateCatalogMatchingWithPackageSafeguards(offer10kg, catalogProduct36)
      expect(match5kg.isCompatible).toBe(false)
      expect(match5kg.status).toBe('rejected_contradictory')
      expect(match5kg.reason).toContain('Package size contradiction')

      const match10kg = validateCatalogMatchingWithPackageSafeguards(offer10kg, catalogProduct37)
      expect(match10kg.isCompatible).toBe(true)
      expect(match10kg.status).toBe('verified_compatible')
    })

    it('strictly rejects matching a 5 kg offer to a 10 kg catalog product', () => {
      const offer5kg = {
        title_en: 'Al Walimah Style Sella Basmati Rice 5kg',
        title_ar: 'أرز بسمتي سيلا الوليمة ستايل 5 كجم',
        each_size_value: 5,
        each_size_unit: 'kg',
        inner_pack_count: 1
      }

      const match10kg = validateCatalogMatchingWithPackageSafeguards(offer5kg, catalogProduct37)
      expect(match10kg.isCompatible).toBe(false)
      expect(match10kg.status).toBe('rejected_contradictory')

      const match5kg = validateCatalogMatchingWithPackageSafeguards(offer5kg, catalogProduct36)
      expect(match5kg.isCompatible).toBe(true)
      expect(match5kg.status).toBe('verified_compatible')
    })

    it('allows a multipack bundle (2 x 5 kg) to reference underlying 5 kg product without inventing fictional 10 kg SKU', () => {
      const bundleOffer = {
        title_en: 'Al Walimah Style Sella Basmati Rice 2 x 5 kg',
        title_ar: 'أرز بسمتي سيلا الوليمة ستايل 2 × 5 كجم',
        each_size_value: 5,
        each_size_unit: 'kg',
        inner_pack_count: 2
      }

      // 1. Matches underlying 5 kg product safely as bundle_underlying_compatible
      const matchUnderlying = validateCatalogMatchingWithPackageSafeguards(bundleOffer, catalogProduct36)
      expect(matchUnderlying.isCompatible).toBe(true)
      expect(matchUnderlying.status).toBe('bundle_underlying_compatible')
      expect(matchUnderlying.enforceCandidateStatus).toBe(true)

      // 2. Strictly REJECTS matching against standalone 10 kg single-bag product!
      const matchFictional10kg = validateCatalogMatchingWithPackageSafeguards(bundleOffer, catalogProduct37)
      expect(matchFictional10kg.isCompatible).toBe(false)
      expect(matchFictional10kg.status).toBe('rejected_contradictory')
    })

    it('strictly rejects synthetic Al Safwa bundle matching Al Bayt product #19 or Al Walimah product #36 due to brand contradiction', () => {
      const alSafwaBundleOffer = {
        titleEn: 'Al Safwa Indian Basmati Rice 2 x 5 kg',
        titleAr: 'أرز بسمتي هندي الصفوة 2 × 5 كجم',
        brand: 'Al Safwa',
        eachSizeValue: 5,
        eachSizeUnit: 'kg',
        innerPackCount: 2,
        saleUnitType: 'bundle'
      }

      // 1. Rejects Al Walimah Product #36 (brand mismatch: Al Safwa vs Al Walimah)
      const resAgainst36 = validateProductIdentityCompatibility(alSafwaBundleOffer, catalogProduct36)
      expect(resAgainst36.isCompatible).toBe(false)
      expect(resAgainst36.conflicts?.some((c) => c.toLowerCase().includes('brand'))).toBe(true)

      // 2. Rejects Al Bayt Product #19 (candidate gate blocks auto-match)
      const resAgainst19 = validateProductIdentityCompatibility(alSafwaBundleOffer, catalogProduct19)
      expect(resAgainst19.isCompatible).toBe(false)
      expect(resAgainst19.status).toBe('rejected_insufficient_evidence')
      expect(resAgainst19.reason).toContain("status: 'candidate'")

      // 3. When checked against verified Al Bayt identity, brand contradiction is strictly flagged
      const resAgainst19Verified = validateProductIdentityCompatibility(alSafwaBundleOffer, {
        ...catalogProduct19,
        verification_status: 'verified'
      })
      expect(resAgainst19Verified.isCompatible).toBe(false)
      expect(resAgainst19Verified.conflicts?.some((c) => c.toLowerCase().includes('brand'))).toBe(true)

      // 4. Rejects Al Bayt Product #38 10 kg (candidate gate blocks auto-match)
      const resAgainst38 = validateProductIdentityCompatibility(alSafwaBundleOffer, catalogProduct38)
      expect(resAgainst38.isCompatible).toBe(false)
      expect(resAgainst38.status).toBe('rejected_insufficient_evidence')
    })

    it('allows purchase limit offers to match 1-piece catalog product cleanly without pack-count penalty', () => {
      const offerWithLimit = {
        title_en: 'Al Walimah Style Sella Basmati Rice 10kg',
        condition_text: 'حد أقصى 2 حبة لكل عميل (Max 2 pcs per customer)',
        each_size_value: 10,
        each_size_unit: 'kg',
        inner_pack_count: 1
      }

      const match = validateCatalogMatchingWithPackageSafeguards(offerWithLimit, catalogProduct37)
      expect(match.isCompatible).toBe(true)
      expect(match.status).toBe('verified_compatible')
    })

    it('blocks automatic matching for ambiguous or assorted offers', () => {
      const assortedOffer = {
        title_en: 'Sadia Frozen Chicken Griller 700g / 750g Assorted',
        assortment_status: 'multiple_variants',
        each_size_value: 700,
        each_size_unit: 'g'
      }

      const match = validateCatalogMatchingWithPackageSafeguards(assortedOffer, {
        id: 50,
        name_en: 'Sadia Frozen Chicken Griller 700g',
        each_size_value: 700,
        each_size_unit: 'g',
        inner_pack_count: 1
      })

      expect(match.isCompatible).toBe(false)
      expect(match.status).toBe('rejected_ambiguous_offer')
      expect(match.enforceCandidateStatus).toBe(true)
    })

    it('integrates cleanly into validateProductIdentityCompatibility validator', () => {
      const offer10kg = {
        titleEn: 'AL WALIMAH Rice Long Grain White Basmathi 10 kg',
        titleAr: 'أرز بسمتي أبيض طويل الحبة الوليمة 10 كجم',
        brand: 'Al Walimah',
        eachSizeValue: 10,
        eachSizeUnit: 'kg',
        innerPackCount: 1,
        saleUnitType: 'piece'
      }

      // Rejects 5 kg product #36
      const res5kg = validateProductIdentityCompatibility(offer10kg, catalogProduct36)
      expect(res5kg.isCompatible).toBe(false)
      expect(res5kg.conflicts?.some((c) => c.includes('size') || c.includes('Size') || c.includes('Package'))).toBe(true)

      // When Product #37 has verification_status = 'candidate', auto-match is blocked by candidate gate
      const res10kgCandidate = validateProductIdentityCompatibility(offer10kg, catalogProduct37)
      expect(res10kgCandidate.isCompatible).toBe(false)
      expect(res10kgCandidate.status).toBe('rejected_insufficient_evidence')
      expect(res10kgCandidate.reason).toContain("status: 'candidate'")

      // Accepts 10 kg product when verified
      const res10kg = validateProductIdentityCompatibility(offer10kg, {
        ...catalogProduct37,
        verification_status: 'verified'
      })
      expect(res10kg.isCompatible).toBe(true)
    })
  })

  describe('3. Image Safety Safeguards', () => {
    it('blocks mismatched packaging artwork (5KG printed bag on 10 kg offer) from catalog and consumer display', () => {
      const decision = validateImageSafetyWithPackageSafeguards({
        printedLabel: '5KG',
        advertisedSizeValue: 10,
        advertisedSizeUnit: 'kg',
        advertisedPackCount: 1
      })

      expect(decision.hasConflict).toBe(true)
      expect(decision.isSafeForCatalog).toBe(false)
      expect(decision.isSafeForConsumerDisplay).toBe(false)
      expect(decision.allowIllustrativeWithApproval).toBe(false)
      expect(decision.classification).toBe('blocked_mismatch')
      expect(decision.reason).toContain('conflicts with advertised offer size')
    })

    it('approves matching packaging artwork (10KG printed bag on 10 kg offer)', () => {
      const decision = validateImageSafetyWithPackageSafeguards({
        printedLabel: '10kg',
        advertisedSizeValue: 10,
        advertisedSizeUnit: 'kg',
        advertisedPackCount: 1
      })

      expect(decision.hasConflict).toBe(false)
      expect(decision.isSafeForCatalog).toBe(true)
      expect(decision.isSafeForConsumerDisplay).toBe(true)
      expect(decision.classification).toBe('exact_product')
    })

    it('handles packaging artwork without printed weight label safely (e.g. Al Walimah 10kg sack)', () => {
      // Case 1: Without operator approval -> blocked from catalog and consumer display
      const unapproved = validateImageSafetyWithPackageSafeguards({
        hasNoPrintedLabelOnPackaging: true,
        advertisedSizeValue: 10,
        advertisedSizeUnit: 'kg',
        isOperatorApprovedIllustrative: false
      })

      expect(unapproved.isSafeForCatalog).toBe(false)
      expect(unapproved.isSafeForConsumerDisplay).toBe(false)
      expect(unapproved.allowIllustrativeWithApproval).toBe(true)
      expect(unapproved.classification).toBe('illustrative')

      // Case 2: With operator approval -> allowed for consumer display as illustrative, NOT catalog photography
      const approved = validateImageSafetyWithPackageSafeguards({
        hasNoPrintedLabelOnPackaging: true,
        advertisedSizeValue: 10,
        advertisedSizeUnit: 'kg',
        isOperatorApprovedIllustrative: true
      })

      expect(approved.isSafeForCatalog).toBe(false)
      expect(approved.isSafeForConsumerDisplay).toBe(true)
      expect(approved.classification).toBe('illustrative')
    })
  })
})
