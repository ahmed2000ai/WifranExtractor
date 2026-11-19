import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  detectPackageConfigurationContext,
  validateCatalogMatchingWithPackageSafeguards,
  validateImageSafetyWithPackageSafeguards
} from '../packageQuantitySafeguards'
import { parseAndNormalizeQuantity } from '../priceAndUnitNormalizer'
import { checkImageFilePackageConflict } from '../../../main/db/catalogPublicationService'
import { validateProductIdentityCompatibility } from '../../../main/db/productIdentityCompatibilityValidator'

describe('WIFRAN — Package Safeguards End-to-End Integration Check', () => {
  // Paths to real stored fixtures
  const page18FixturePath = path.resolve(
    __dirname,
    '../../../../Extracts/alnokhbah-markets-1/hybrid_v3_results/page_18.v3.json'
  )
  const page1FixturePath = path.resolve(
    __dirname,
    '../../../../Extracts/alnokhbah-markets-1/hybrid_v3_results/page_1.v3.json'
  )

  let page18Fixture: any
  let page1Fixture: any

  beforeAll(() => {
    if (fs.existsSync(page18FixturePath)) {
      page18Fixture = JSON.parse(fs.readFileSync(page18FixturePath, 'utf8'))
    }
    if (fs.existsSync(page1FixturePath)) {
      page1Fixture = JSON.parse(fs.readFileSync(page1FixturePath, 'utf8'))
    }
  })

  // =========================================================================
  // 1. Trace real stored fixtures for standalone 5 kg and 10 kg products
  // =========================================================================
  describe('1. Real Stored Fixtures: Standalone 5 kg and 10 kg Products', () => {
    it('processes real Al Nokhbah Page 18 Abu Kiyaan 10 kg standalone card cleanly', () => {
      expect(page18Fixture).toBeDefined()
      const card001 = page18Fixture.pageResult.reconciledCards.find(
        (c: any) => c.sourceOfferId === 'leaflet-001_p018_001'
      )
      expect(card001).toBeDefined()

      const rawText = card001.reconciledCard.source_card.raw_text
      expect(rawText.title_en).toBe('ABU KIYAAN WHITE CLASSIC BIRYANI RICE 10 KG')
      expect(rawText.size_text).toBe('10 KG')

      // Normalize through canonical normalization pipeline
      const norm = parseAndNormalizeQuantity({
        title_en: rawText.title_en,
        title_ar: rawText.title_ar,
        size_text: rawText.size_text,
        offer_price: card001.reconciledCard.pricing.promo_price
      })

      expect(norm.each_size_value).toBe(10)
      expect(norm.each_size_unit).toBe('kg')
      expect(norm.pack_quantity).toBe(1)
      expect(norm.total_content_value).toBe(10)
      expect(norm.total_content_unit).toBe('kg')
      expect(norm.standardized_total_value).toBe(10)
      expect(norm.standardized_unit).toBe('kilogram')
      expect(norm.comparison_eligible).toBe(true)
      expect(norm.exclusion_reason).toBeNull()

      // Context safeguard analysis
      const context = detectPackageConfigurationContext({
        titleEn: rawText.title_en,
        titleAr: rawText.title_ar,
        sizeText: rawText.size_text,
        eachSizeValue: norm.each_size_value,
        eachSizeUnit: norm.each_size_unit,
        innerPackCount: norm.pack_quantity
      })

      expect(context.configurationKind).toBe('standalone_package_variant')
      expect(context.physicalPackage.nominalSizeValue).toBe(10)
      expect(context.physicalPackage.nominalSizeUnit).toBe('kg')
      expect(context.physicalPackage.packCount).toBe(1)
      expect(context.physicalPackage.saleUnitType).toBe('piece')
      expect(context.catalogMatchingPolicy.targetMatchMode).toBe('exact_standalone_sku')
    })

    it('processes real Al Nokhbah Page 18 5 kg tier 1 and 10 kg tier 2 cards without conflation', () => {
      const tier1Card = page18Fixture.pageResult.reconciledCards.find(
        (c: any) => c.sourceOfferId === 'leaflet-001_p018_010__tier_1'
      )
      const tier2Card = page18Fixture.pageResult.reconciledCards.find(
        (c: any) => c.sourceOfferId === 'leaflet-001_p018_010__tier_2'
      )

      expect(tier1Card).toBeDefined()
      expect(tier2Card).toBeDefined()

      // Tier 1: 5 kg
      const qty1 = tier1Card.reconciledCard.quantity_and_promo
      const context1 = detectPackageConfigurationContext({
        titleEn: 'Al Walimah Style Sella Basmati Rice 5kg',
        tableHeading: 'SIZE',
        rowLabel: '5 KG',
        eachSizeValue: qty1.each_size_value ?? 5,
        eachSizeUnit: qty1.each_size_unit ?? 'kg',
        innerPackCount: qty1.manufacturer_pack_count ?? 1
      })

      expect(context1.configurationKind).toBe('standalone_package_variant')
      expect(context1.physicalPackage.nominalSizeValue).toBe(5)
      expect(context1.physicalPackage.nominalSizeUnit).toBe('kg')
      expect(context1.physicalPackage.packCount).toBe(1)
      expect(context1.physicalPackage.saleUnitType).toBe('piece')

      // Tier 2: 10 kg
      const qty2 = tier2Card.reconciledCard.quantity_and_promo
      const context2 = detectPackageConfigurationContext({
        titleEn: 'Al Walimah Style Sella Basmati Rice 10kg',
        tableHeading: 'SIZE',
        rowLabel: '10 KG',
        eachSizeValue: qty2.each_size_value ?? 10,
        eachSizeUnit: qty2.each_size_unit ?? 'kg',
        innerPackCount: qty2.manufacturer_pack_count ?? 1
      })

      expect(context2.configurationKind).toBe('standalone_package_variant')
      expect(context2.physicalPackage.nominalSizeValue).toBe(10)
      expect(context2.physicalPackage.nominalSizeUnit).toBe('kg')
      expect(context2.physicalPackage.packCount).toBe(1)
      expect(context2.physicalPackage.saleUnitType).toBe('piece')

      // Catalog Matching: 10 kg tier 2 strictly rejected against 5 kg product #36 (Al Walimah 5 kg)
      const catalogProd36 = {
        id: 36,
        name_en: 'AL WALIMAH Rice Long Grain White Basmathi 5 kg',
        brand_name: 'Al Walimah',
        each_size_value: 5,
        each_size_unit: 'kg',
        inner_pack_count: 1,
        verification_status: 'verified'
      }
      const matchAgainst36 = validateCatalogMatchingWithPackageSafeguards(
        {
          titleEn: 'Al Walimah Style Sella Basmati Rice 10kg',
          each_size_value: 10,
          each_size_unit: 'kg',
          inner_pack_count: 1
        },
        catalogProd36
      )
      expect(matchAgainst36.isCompatible).toBe(false)
      expect(matchAgainst36.status).toBe('rejected_contradictory')
    })
  })

  // =========================================================================
  // 2. Real Stored Fixtures: Assortments & Multi-variant Cards
  // =========================================================================
  describe('2. Real Stored Fixtures: Assortments and Multi-variants', () => {
    it('processes real Al Nokhbah Page 1 Sadia 700g/750g and blocks exact catalog lock-in', () => {
      expect(page1Fixture).toBeDefined()
      const sadiaCard = page1Fixture.pageResult.reconciledCards.find(
        (c: any) => c.reconciledCard.source_card.raw_text.title_en?.includes('SADIA BROASTED CHICKEN')
      )
      expect(sadiaCard).toBeDefined()

      const raw = sadiaCard.reconciledCard.source_card.raw_text
      expect(raw.title_en).toBe('SADIA BROASTED CHICKEN 700G/ 750G')

      // Canonical normalization marks variable range non-comparable
      const norm = parseAndNormalizeQuantity({
        title_en: raw.title_en,
        title_ar: raw.title_ar,
        size_text: '700G/ 750G',
        is_uniform_size_across_variants: false
      })

      expect(norm.comparison_eligible).toBe(false)
      expect(norm.exclusion_reason).toBe('variable_weight_range')

      // Package context safeguard
      const context = detectPackageConfigurationContext({
        titleEn: raw.title_en,
        titleAr: raw.title_ar,
        sizeText: '700G/ 750G',
        assortmentStatus: 'multiple_variants'
      })

      expect(context.configurationKind).toBe('ambiguous_unconfirmed')
      expect(context.catalogMatchingPolicy.allowAutomaticDirectMatch).toBe(false)
      expect(context.catalogMatchingPolicy.enforceCandidateStatus).toBe(true)

      // Catalog matching rejection
      const exactCandidate = {
        id: 99,
        name_en: 'Sadia Broasted Chicken 700g',
        each_size_value: 700,
        each_size_unit: 'g',
        inner_pack_count: 1,
        verification_status: 'verified'
      }
      const match = validateCatalogMatchingWithPackageSafeguards(
        {
          title_en: raw.title_en,
          size_text: '700G/ 750G',
          assortment_status: 'multiple_variants'
        },
        exactCandidate
      )
      expect(match.isCompatible).toBe(false)
      expect(match.status).toBe('rejected_ambiguous_offer')
      expect(match.enforceCandidateStatus).toBe(true)
    })
  })

  // =========================================================================
  // 3. Promotional Bundles (2 x 5 kg) and Product Verification Safety
  // =========================================================================
  describe('3. Promotional Bundles (2 x 5 kg) and Product Verification Safety', () => {
    // Al Walimah 5 kg corresponds to Product #36 (verified)
    const verifiedProduct36 = {
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

    // Al Walimah 10 kg corresponds to Product #37 (candidate)
    const candidateProduct37 = {
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

    // Al Bayt 5 kg corresponds to Product #19 (candidate)
    const candidateProduct19 = {
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

    it('processes 2 x 5 kg bundle into bundle semantics without altering catalog product verification status', () => {
      // 1. Canonical quantity normalization
      const norm = parseAndNormalizeQuantity({
        title_en: 'Al Walimah Rice Long Grain White Basmathi 2 x 5 kg',
        title_ar: 'أرز بسمتي أبيض طويل الحبة الوليمة 2 × 5 كجم',
        offer_price: 79.95
      })

      expect(norm.each_size_value).toBe(5)
      expect(norm.each_size_unit).toBe('kg')
      expect(norm.pack_quantity).toBe(2)
      expect(norm.total_content_value).toBe(10)
      expect(norm.total_content_unit).toBe('kg')
      expect(norm.standardized_total_value).toBe(10)
      expect(norm.standardized_unit).toBe('kilogram')
      expect(norm.comparison_eligible).toBe(true)
      expect(norm.standardized_unit_price).toBe(8.00) // 79.95 / 10 = ~8.00 SAR/kg

      // 2. Package context analysis
      const context = detectPackageConfigurationContext({
        titleEn: 'Al Walimah Rice Long Grain White Basmathi 2 x 5 kg',
        titleAr: 'أرز بسمتي أبيض طويل الحبة الوليمة 2 × 5 كجم',
        eachSizeValue: norm.each_size_value,
        eachSizeUnit: norm.each_size_unit,
        innerPackCount: norm.pack_quantity
      })

      expect(context.configurationKind).toBe('multipack_bundle')
      expect(context.physicalPackage.nominalSizeValue).toBe(5)
      expect(context.physicalPackage.nominalSizeUnit).toBe('kg')
      expect(context.physicalPackage.packCount).toBe(2)
      expect(context.physicalPackage.totalContentValue).toBe(10)
      expect(context.physicalPackage.saleUnitType).toBe('bundle')
      expect(context.catalogMatchingPolicy.targetMatchMode).toBe('bundle_referencing_underlying_sku')
      expect(context.catalogMatchingPolicy.preventFictionalSkuCreation).toBe(true)

      // 3. Catalog matching with verified catalog product #36
      const initialVerificationStatus = verifiedProduct36.verification_status
      const match = validateCatalogMatchingWithPackageSafeguards(
        {
          title_en: 'Al Walimah Rice Long Grain White Basmathi 2 x 5 kg',
          title_ar: 'أرز بسمتي أبيض طويل الحبة الوليمة 2 × 5 كجم',
          each_size_value: norm.each_size_value,
          each_size_unit: norm.each_size_unit,
          inner_pack_count: norm.pack_quantity
        },
        verifiedProduct36
      )

      expect(match.isCompatible).toBe(true)
      expect(match.status).toBe('bundle_underlying_compatible')
      expect(match.enforceCandidateStatus).toBe(true)

      // CRITICAL INVARIANT: The underlying verified product's status MUST NOT be mutated!
      expect(verifiedProduct36.verification_status).toBe(initialVerificationStatus)
      expect(verifiedProduct36.verification_status).toBe('verified')
    })

    it('strictly distinguishes offer-level catalog_match_status from products.verification_status (candidate products #19 and #37 cannot become verified merely through offer linking)', () => {
      // Offer linking to Candidate Product #19 (Al Bayt 5 kg)
      const offerFor19 = {
        title_en: 'Al Bayt Creamy Sella Long Grain Basmati Rice 5 kg',
        title_ar: 'أرز بسمتي سيلا كريمي طويل الحبة البيت 5 كجم',
        each_size_value: 5,
        each_size_unit: 'kg',
        inner_pack_count: 1
      }
      const match19 = validateCatalogMatchingWithPackageSafeguards(offerFor19, candidateProduct19)
      expect(match19.isCompatible).toBe(true)

      // Offer match status reflects linkage confidence, but candidateProduct19.verification_status remains strictly 'candidate'
      expect(candidateProduct19.verification_status).toBe('candidate')

      // Offer linking to Candidate Product #37 (Al Walimah 10 kg)
      const offerFor37 = {
        title_en: 'AL WALIMAH Rice Long Grain White Basmathi 10 kg',
        title_ar: 'أرز بسمتي أبيض طويل الحبة الوليمة 10 كجم',
        each_size_value: 10,
        each_size_unit: 'kg',
        inner_pack_count: 1
      }
      const match37 = validateCatalogMatchingWithPackageSafeguards(offerFor37, candidateProduct37)
      expect(match37.isCompatible).toBe(true)

      // Candidate product #37 CANNOT become verified merely by linking an offer to it
      expect(candidateProduct37.verification_status).toBe('candidate')
      expect(candidateProduct37.verification_status).not.toBe('verified')
    })

    it('strictly rejects synthetic Al Safwa bundle matching Al Bayt product #19 or Al Walimah product #36 due to brand contradiction', () => {
      const syntheticAlSafwaBundle = {
        titleEn: 'Al Safwa Indian Basmati Rice 2 x 5 kg',
        titleAr: 'أرز بسمتي هندي الصفوة 2 × 5 كجم',
        brand: 'Al Safwa',
        eachSizeValue: 5,
        eachSizeUnit: 'kg',
        innerPackCount: 2,
        saleUnitType: 'bundle'
      }

      // 1. Rejects Al Walimah Product #36 (brand mismatch: Al Safwa vs Al Walimah)
      const resAgainst36 = validateProductIdentityCompatibility(syntheticAlSafwaBundle, verifiedProduct36)
      expect(resAgainst36.isCompatible).toBe(false)
      expect(resAgainst36.conflicts?.some((c) => c.toLowerCase().includes('brand'))).toBe(true)

      // 2. Rejects Al Bayt Product #19 (candidate gate blocks auto-match, and brand mismatch contradicts)
      const resAgainst19 = validateProductIdentityCompatibility(syntheticAlSafwaBundle, candidateProduct19)
      expect(resAgainst19.isCompatible).toBe(false)
      expect(resAgainst19.status).toBe('rejected_insufficient_evidence')

      const resAgainst19Verified = validateProductIdentityCompatibility(syntheticAlSafwaBundle, {
        ...candidateProduct19,
        verification_status: 'verified'
      })
      expect(resAgainst19Verified.isCompatible).toBe(false)
      expect(resAgainst19Verified.conflicts?.some((c) => c.toLowerCase().includes('brand'))).toBe(true)
    })
  })

  // =========================================================================
  // 4. Customer Purchase Limit vs Pack Count Safeguard
  // =========================================================================
  describe('4. Customer Purchase Limit vs Pack Count Safeguards', () => {
    it('isolates Arabic purchase limit (حد أقصى 2 حبة لكل عميل) from physical pack count in parseAndNormalizeQuantity', () => {
      // Upstream OCR may pass ai_pack_quantity = 2 due to naive "2 حبة" token extraction
      const norm = parseAndNormalizeQuantity({
        title_ar: 'أرز بسمتي الشعلان 10 كجم - حد أقصى 2 حبة لكل عميل',
        title_en: 'Al Shalan Basmati Rice 10kg - Max 2 pcs per customer',
        ai_pack_quantity: 2,
        offer_price: 69.95
      })

      // Safeguard MUST enforce pack_quantity = 1, NOT 2!
      expect(norm.pack_quantity).toBe(1)
      expect(norm.each_size_value).toBe(10)
      expect(norm.each_size_unit).toBe('kg')
      expect(norm.total_content_value).toBe(10) // 1 * 10 = 10, NOT 20!
      expect(norm.standardized_total_value).toBe(10)
      expect(norm.comparison_eligible).toBe(true)
      expect(norm.standardized_unit_price).toBe(7.00) // 69.95 / 10 = ~7.00 SAR/kg
    })

    it('isolates English purchase limit (Max 2 pcs per customer)', () => {
      const norm = parseAndNormalizeQuantity({
        title_en: 'Abu Kass Basmati Rice 10kg',
        condition_text: 'Max 2 pcs per customer',
        ai_pack_quantity: 2,
        offer_price: 75.00
      })

      expect(norm.pack_quantity).toBe(1)
      expect(norm.each_size_value).toBe(10)
      expect(norm.total_content_value).toBe(10)
    })
  })

  // =========================================================================
  // 5. Image Safety: Packaging Label Conflict Caught Before Publication
  // =========================================================================
  describe('5. Image Safety: Packaging Label Conflict Enforcement', () => {
    it('catches and blocks 5KG printed packaging graphic from being published for a 10 kg offer', () => {
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
      expect(decision.reason).toContain('Mismatched image blocked from both catalog and consumer display')
    })

    it('permits matching packaging artwork (10KG printed bag for 10 kg offer)', () => {
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
  })

  // =========================================================================
  // 6. Actual Publication Path: Image Safety & Package Checks in catalogPublicationService
  // =========================================================================
  describe('6. Actual Publication Path: Image Safety & Package Checks in catalogPublicationService', () => {
    const tempDirsToClean: string[] = []

    function createTempImageFixture(metaContent: Record<string, any>): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-pub-img-safe-'))
      tempDirsToClean.push(dir)
      const imagePath = path.join(dir, 'tier_2_crop.webp')
      fs.writeFileSync(imagePath, Buffer.from('fake-webp-bytes'))
      const metaPath = path.join(dir, 'derived_tier_crop_meta.json')
      fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2), 'utf8')
      return imagePath
    }

    afterAll(() => {
      for (const d of tempDirsToClean) {
        try {
          fs.rmSync(d, { recursive: true, force: true })
        } catch {
          // ignore cleanup errors on Windows
        }
      }
    })

    it('blocks publication staging when derived tier metadata reveals a visible package weight conflict (5KG sack on 10 kg offer)', () => {
      const conflictedImagePath = createTempImageFixture({
        visiblePackageWeightLabel: '5KG',
        visiblePackageSizeConflict: true,
        requiresReplacementImage: true,
        confirmationBlockedReason: 'Visible packaging weight (5KG) contradicts advertised offer size (10 kg)'
      })

      // Evaluated in the publication route via checkImageFilePackageConflict
      const conflictResult = checkImageFilePackageConflict(
        conflictedImagePath,
        10,
        'kg',
        1
      )

      expect(conflictResult.blocked).toBe(true)
      expect(conflictResult.reason).toContain('Visible packaging weight (5KG) contradicts advertised offer size')
    })

    it('permits publication staging when derived tier metadata matches advertised size (10KG sack on 10 kg offer)', () => {
      const matchingImagePath = createTempImageFixture({
        visiblePackageWeightLabel: '10kg',
        visiblePackageSizeConflict: false,
        requiresReplacementImage: false
      })

      const conflictResult = checkImageFilePackageConflict(
        matchingImagePath,
        10,
        'kg',
        1
      )

      expect(conflictResult.blocked).toBe(false)
      expect(conflictResult.reason).toBeUndefined()
    })

    it('enforces failsafe blocking when replacement image is explicitly required or file is flagged conflicted', () => {
      const flaggedImagePath = createTempImageFixture({
        requiresReplacementImage: true,
        confirmationBlockedReason: 'Operator requested replacement'
      })

      const conflictResult = checkImageFilePackageConflict(
        flaggedImagePath,
        10,
        'kg',
        1
      )

      expect(conflictResult.blocked).toBe(true)
      expect(conflictResult.reason).toContain('Operator requested replacement')
    })

    it('handles image paths safely when no metadata file exists', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-no-meta-'))
      tempDirsToClean.push(dir)
      const plainImagePath = path.join(dir, 'plain_crop.webp')
      fs.writeFileSync(plainImagePath, Buffer.from('plain-bytes'))

      const conflictResult = checkImageFilePackageConflict(
        plainImagePath,
        10,
        'kg',
        1
      )

      expect(conflictResult.blocked).toBe(false)
    })
  })
})
