/**
 * WIFRAN-EXTRACTOR-IDENTITY-002C — Milestone 2C: Pack-Size & Variant Disambiguation
 *
 * Validates:
 * 1. 4D quantity representation (sale_unit_type, inner_pack_count, individual_unit_content, total_package_content).
 * 2. Deterministic package configuration comparison (1x1000ml = 1x1L, 4x0.5L = 4x500ml, 10x0.6kg = 10x600g).
 * 3. Strict rejection of pack & size contradictions (4x250ml != 1x1L, 10x600g != 1x600g, 12x1L != 1x12L, 6x330ml != 6x250ml).
 * 4. Protection against promotional quantity mechanics ("Buy 2 Get 1 Free", "3 for SAR 10" != pack count 3).
 * 5. Explicit distinction between loose commodities (per kg) and prepacked retail SKUs.
 * 6. Random-weight vs fixed-weight package disambiguation.
 * 7. Variant compatibility: Full Fat vs Low Fat vs Skimmed, Fresh vs UHT, Frozen vs Chilled, Sella vs Plain Basmati, cuts, flavors, sugar.
 * 8. Image reuse safety: exact verified match inherits approved image; incompatible variant rejects image reuse.
 */

import { describe, it, expect } from 'vitest'
import {
  extractStructuredQuantityConfig,
  comparePackageConfigurations
} from '../../../main/db/variantDisambiguationService'
import {
  validateProductIdentityCompatibility,
  selectSingleCompatibleVerifiedProduct
} from '../../../main/db/productIdentityCompatibilityValidator'

describe('WIFRAN-EXTRACTOR-IDENTITY-002C: Pack-Size & Variant Disambiguation', () => {
  // =========================================================================
  // 1. 4D Quantity Representation & Equivalence
  // =========================================================================
  describe('Capability 1: 4D Structured Quantity Representation', () => {
    it('correctly parses 4 independent dimensions from structured offer input', () => {
      const offer = {
        title_en: 'Al Safi Milk 4x1L',
        sale_unit_type: 'pack',
        inner_pack_count: 4,
        each_size_value: 1,
        each_size_unit: 'l'
      }

      const config = extractStructuredQuantityConfig(offer)
      expect(config.saleUnitType).toBe('pack')
      expect(config.innerPackCount).toBe(4)
      expect(config.individualUnitContent).toMatchObject({
        value: 1,
        unit: 'l',
        dimension: 'volume',
        baseValue: 1000,
        baseUnit: 'ml'
      })
      expect(config.totalPackageContent).toMatchObject({
        totalBaseValue: 4000,
        totalBaseUnit: 'ml',
        provenance: 'computed'
      })
    })

    it('supports exact mathematically equivalent package configurations in different units (1x1000ml = 1x1L)', () => {
      const offerA = {
        title_en: 'Nadec Milk 1000ml',
        inner_pack_count: 1,
        each_size_value: 1000,
        each_size_unit: 'ml'
      }
      const prodA = {
        name_en: 'Nadec Milk 1L',
        inner_pack_count: 1,
        each_size_value: 1,
        each_size_unit: 'l'
      }

      const configOffer = extractStructuredQuantityConfig(offerA)
      const configProd = extractStructuredQuantityConfig(prodA)
      const res = comparePackageConfigurations(configOffer, configProd)

      expect(res.isCompatible).toBe(true)
      expect(res.status).toBe('verified_compatible')
      expect(res.conflicts).toHaveLength(0)
    })

    it('supports multipack unit equivalence (4 x 0.5L = 4 x 500ml)', () => {
      const offer = {
        title_en: 'Almarai Milk 4x0.5L',
        inner_pack_count: 4,
        each_size_value: 0.5,
        each_size_unit: 'l'
      }
      const prod = {
        name_en: 'Almarai Milk 4x500ml',
        inner_pack_count: 4,
        each_size_value: 500,
        each_size_unit: 'ml'
      }

      const res = comparePackageConfigurations(
        extractStructuredQuantityConfig(offer),
        extractStructuredQuantityConfig(prod)
      )
      expect(res.isCompatible).toBe(true)
      expect(res.status).toBe('verified_compatible')
    })

    it('supports mass unit equivalence (10 x 0.6kg = 10 x 600g)', () => {
      const offer = {
        title_en: 'Fakieh Frozen Chicken 10x0.6kg',
        inner_pack_count: 10,
        each_size_value: 0.6,
        each_size_unit: 'kg'
      }
      const prod = {
        name_en: 'Fakieh Frozen Chicken 10x600g',
        inner_pack_count: 10,
        each_size_value: 600,
        each_size_unit: 'g'
      }

      const res = comparePackageConfigurations(
        extractStructuredQuantityConfig(offer),
        extractStructuredQuantityConfig(prod)
      )
      expect(res.isCompatible).toBe(true)
      expect(res.status).toBe('verified_compatible')
    })

    it('supports bilingual Arabic and English quantity expressions (١٠ × ٦٠٠ جم = 10 x 600g)', () => {
      const offerAr = {
        title_ar: 'دجاج فقيه مجمد ١٠ × ٦٠٠ جم',
        size_text: '١٠ × ٦٠٠ جم'
      }
      const prodEn = {
        name_en: 'Fakieh Frozen Chicken 10x600g',
        inner_pack_count: 10,
        each_size_value: 600,
        each_size_unit: 'g'
      }

      const res = comparePackageConfigurations(
        extractStructuredQuantityConfig(offerAr),
        extractStructuredQuantityConfig(prodEn)
      )
      expect(res.isCompatible).toBe(true)
      expect(res.status).toBe('verified_compatible')
    })
  })

  // =========================================================================
  // 2. Strict Rejection of Pack-Count & Configuration Contradictions
  // =========================================================================
  describe('Capability 2: Strict Rejection of Configuration Contradictions', () => {
    it('strictly rejects matching total volume with conflicting pack structure (4 x 250ml vs 1 x 1L)', () => {
      const offer4x250 = {
        title_en: 'Nadec Milk 4x250ml',
        inner_pack_count: 4,
        each_size_value: 250,
        each_size_unit: 'ml',
        sale_unit_type: 'pack'
      }
      const prod1L = {
        id: 1,
        name_en: 'Nadec Milk 1L',
        brand_name: 'Nadec',
        inner_pack_count: 1,
        each_size_value: 1,
        each_size_unit: 'l',
        verification_status: 'verified'
      }

      const res = validateProductIdentityCompatibility(offer4x250, prod1L)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Pack quantity mismatch: offer=4 vs product=1'),
          expect.stringContaining('Package size mismatch')
        ])
      )
    })

    it('strictly rejects matching total mass with conflicting pack structure (2 x 500g vs 1 x 1kg)', () => {
      const offer2x500 = {
        title_en: 'Lurpak Butter 2x500g',
        inner_pack_count: 2,
        each_size_value: 500,
        each_size_unit: 'g',
        sale_unit_type: 'pack'
      }
      const prod1kg = {
        name_en: 'Lurpak Butter 1kg',
        inner_pack_count: 1,
        each_size_value: 1,
        each_size_unit: 'kg',
        sale_unit_type: 'each'
      }

      const res = comparePackageConfigurations(
        extractStructuredQuantityConfig(offer2x500),
        extractStructuredQuantityConfig(prod1kg)
      )
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Pack quantity mismatch: offer=2 vs product=1'),
          expect.stringContaining('Package size mismatch')
        ])
      )
    })

    it('strictly rejects 12 x 1L carton case vs 1 x 12L bulk container', () => {
      const offer12x1L = {
        title_en: 'Al Safi Milk 12x1L',
        inner_pack_count: 12,
        each_size_value: 1,
        each_size_unit: 'l',
        sale_unit_type: 'pack'
      }
      const prod12L = {
        name_en: 'Al Safi Milk 12L Dispenser',
        inner_pack_count: 1,
        each_size_value: 12,
        each_size_unit: 'l',
        sale_unit_type: 'each'
      }

      const res = comparePackageConfigurations(
        extractStructuredQuantityConfig(offer12x1L),
        extractStructuredQuantityConfig(prod12L)
      )
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Pack quantity mismatch: offer=12 vs product=1'),
          expect.stringContaining('Package size mismatch')
        ])
      )
    })

    it('strictly rejects Fakieh 10 x 600g case against 1 x 600g single chicken (Noori Canary Invariant)', () => {
      const canaryOffer10x600 = {
        title_en: 'Fakieh Frozen Chicken 10x600g',
        title_ar: 'دجاج فقيه مجمد ١٠ × ٦٠٠ جم',
        brand: 'Fakieh',
        inner_pack_count: 10,
        each_size_value: 600,
        each_size_unit: 'g',
        sale_unit_type: 'pack'
      }
      const singleProduct1x600 = {
        id: 'fakieh-single-600',
        name_en: 'Fakieh Frozen Chicken 600g',
        name_ar: 'دجاج فقيه مجمد ٦٠٠ جم',
        brand_name: 'Fakieh',
        inner_pack_count: 1,
        each_size_value: 600,
        each_size_unit: 'g',
        sale_unit_type: 'each',
        verification_status: 'verified'
      }

      const res = validateProductIdentityCompatibility(canaryOffer10x600, singleProduct1x600)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Pack quantity mismatch: offer=10 vs product=1')
        ])
      )
    })

    it('strictly rejects same pack count but different unit size (6 x 330ml vs 6 x 250ml)', () => {
      const offer6x330 = {
        title_en: 'Pepsi Can 6x330ml',
        inner_pack_count: 6,
        each_size_value: 330,
        each_size_unit: 'ml'
      }
      const prod6x250 = {
        name_en: 'Pepsi Can 6x250ml',
        inner_pack_count: 6,
        each_size_value: 250,
        each_size_unit: 'ml'
      }

      const res = comparePackageConfigurations(
        extractStructuredQuantityConfig(offer6x330),
        extractStructuredQuantityConfig(prod6x250)
      )
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Package size mismatch')
        ])
      )
    })
  })

  // =========================================================================
  // 3. Promotional Mechanics Protection
  // =========================================================================
  describe('Capability 3: Promotional Mechanics Protection', () => {
    it('does not interpret "Buy 2 Get 1 Free" promotional mechanic as physical pack_quantity = 3', () => {
      const promoOffer = {
        title_en: 'Nadec Milk Full Fat 1L (Buy 2 Get 1 Free)',
        title_ar: 'حليب نادك كامل الدسم ١ لتر (اشتري ٢ واحصل على ١ مجانا)',
        size_text: '1L',
        sale_unit_type: 'each'
      }

      const config = extractStructuredQuantityConfig(promoOffer)
      // Must maintain innerPackCount = 1 for the underlying SKU rather than mutating to 3
      expect(config.innerPackCount).toBe(1)
      expect(config.individualUnitContent?.baseValue).toBe(1000)
      expect(config.individualUnitContent?.baseUnit).toBe('ml')
    })

    it('does not interpret "3 for SAR 10" multi-save deal as physical multipack', () => {
      const multiSaveOffer = {
        title_en: 'Indomie Curry Noodles 75g (3 for SAR 10)',
        size_text: '75g',
        sale_unit_type: 'each'
      }

      const config = extractStructuredQuantityConfig(multiSaveOffer)
      expect(config.innerPackCount).toBe(1)
      expect(config.individualUnitContent?.baseValue).toBe(75)
    })

    it('does not interpret "BUY 2 PCS" or "2 Pc Per Customer" multi-buy promotion as physical pack_quantity = 2', () => {
      const fakiehPromoOffer = {
        title_en: 'Fakieh Frozen Chicken 600Gm (BUY 2 PCS)',
        title_ar: 'دجاج فقيه مجمد ٦٠٠ ج (فقط 2 حبة لكل عميل)',
        size_text: '600Gm',
        sale_unit_type: 'each'
      }

      const config = extractStructuredQuantityConfig(fakiehPromoOffer)
      expect(config.innerPackCount).toBe(1)
      expect(config.individualUnitContent?.baseValue).toBe(600)
      expect(config.individualUnitContent?.baseUnit).toBe('g')
    })
  })

  // =========================================================================
  // 4. Loose Commodities vs Prepacked Products
  // =========================================================================
  describe('Capability 4: Loose Commodities vs Prepacked SKUs', () => {
    it('strictly rejects matching loose per-kg bananas to prepacked 1kg banana SKU', () => {
      // 1. Branded loose produce per kg vs branded prepacked 1kg retail SKU: contradictory package configuration
      const brandedLooseBananaOffer = {
        title_en: 'Chiquita Fresh Banana per kg',
        title_ar: 'موز تشيكيتا طازج بالكيلو',
        brand: 'Chiquita',
        brand_name: 'Chiquita',
        brand_state: 'confirmed',
        sale_unit_type: 'kg',
        price_basis: 'per_kg'
      }
      const prepackedBananaProduct = {
        id: 'prod-banana-bag',
        brand: 'Chiquita',
        brand_name: 'Chiquita',
        name_en: 'Chiquita Bananas 1kg Bag',
        name_ar: 'كيس موز تشيكيتا ١ كجم',
        sale_unit_type: 'each',
        inner_pack_count: 1,
        each_size_value: 1,
        each_size_unit: 'kg',
        verification_status: 'verified'
      }

      const res = validateProductIdentityCompatibility(brandedLooseBananaOffer, prepackedBananaProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Sale unit mismatch: loose per-kg commodity cannot match prepacked retail product SKU')
        ])
      )

      // 2. Unbranded loose produce per kg: rejected as ambiguous offer
      const unbrandedLooseOffer = {
        title_en: 'Fresh Yellow Bananas per kg',
        title_ar: 'موز أصفر طازج بالكيلو',
        sale_unit_type: 'kg',
        price_basis: 'per_kg'
      }
      const unbrandedRes = validateProductIdentityCompatibility(unbrandedLooseOffer, prepackedBananaProduct)
      expect(unbrandedRes.isCompatible).toBe(false)
      expect(unbrandedRes.status).toBe('rejected_ambiguous_offer')
    })

    it('strictly rejects random-weight butchery offer against fixed-weight packaged tray', () => {
      // 1. Branded random-weight meat vs fixed-weight prepack: contradictory packaging
      const randomWeightVeal = {
        title_en: 'Tanmiah Fresh Veal with Bone per kg',
        title_ar: 'عجل تنمية طازج بالعظم بالكيلو',
        brand: 'Tanmiah',
        brand_name: 'Tanmiah',
        brand_state: 'confirmed',
        sale_unit_type: 'kg',
        price_basis: 'per_kg'
      }
      const fixedWeightVealProduct = {
        id: 'prod-veal-fixed-500g',
        brand: 'Tanmiah',
        brand_name: 'Tanmiah',
        name_en: 'Tanmiah Fresh Veal with Bone 500g Tray',
        name_ar: 'عجل تنمية طازج بالعظم طبق ٥٠٠ جم',
        sale_unit_type: 'each',
        inner_pack_count: 1,
        each_size_value: 500,
        each_size_unit: 'g',
        verification_status: 'verified'
      }

      const res = validateProductIdentityCompatibility(randomWeightVeal, fixedWeightVealProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Sale unit mismatch: loose per-kg commodity cannot match prepacked retail product SKU')
        ])
      )

      // 2. Unbranded random-weight meat: rejected as ambiguous offer
      const unbrandedVeal = {
        title_en: 'Fresh Local Veal with Bone per kg',
        title_ar: 'عجل بلدي طازج بالعظم بالكيلو',
        sale_unit_type: 'kg',
        price_basis: 'per_kg'
      }
      const unbrandedRes = validateProductIdentityCompatibility(unbrandedVeal, fixedWeightVealProduct)
      expect(unbrandedRes.isCompatible).toBe(false)
      expect(unbrandedRes.status).toBe('rejected_ambiguous_offer')
    })

    it('strictly rejects assorted bundle from auto-linking to single-flavor catalog SKU', () => {
      const assortedBundleOffer = {
        title_en: 'Magnum Ice Cream Asstd 100ml',
        title_ar: 'آيس كريم ماجنوم منوع ١٠٠ مل',
        assortment_status: 'assortment_indicated',
        sale_unit_type: 'each',
        each_size_value: 100,
        each_size_unit: 'ml'
      }
      const singleAlmondProduct = {
        id: 'prod-magnum-almond',
        name_en: 'Magnum Almond Ice Cream 100ml',
        variant_or_flavor: 'Almond',
        inner_pack_count: 1,
        each_size_value: 100,
        each_size_unit: 'ml',
        verification_status: 'verified'
      }

      const res = validateProductIdentityCompatibility(assortedBundleOffer, singleAlmondProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_ambiguous_offer')
    })
  })

  // =========================================================================
  // 5. Product Variant Disambiguation
  // =========================================================================
  describe('Capability 5: Product Variant Disambiguation', () => {
    it('strictly rejects Zero Sugar offer against Regular / Original product', () => {
      const zeroSugarOffer = {
        title_en: 'Coca Cola Zero Sugar 330ml',
        brand: 'Coca Cola',
        inner_pack_count: 1,
        each_size_value: 330,
        each_size_unit: 'ml'
      }
      const regularCokeProduct = {
        id: 'coke-regular',
        name_en: 'Coca Cola Original Taste 330ml',
        brand_name: 'Coca Cola',
        inner_pack_count: 1,
        each_size_value: 330,
        each_size_unit: 'ml',
        verification_status: 'verified'
      }

      const res = validateProductIdentityCompatibility(zeroSugarOffer, regularCokeProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Sugar formulation mismatch')
        ])
      )
    })

    it('strictly rejects Whole Chicken against Chicken Drumsticks or Wings', () => {
      const wholeChickenOffer = {
        title_en: 'Fakieh Fresh Whole Chicken 1kg',
        title_ar: 'دجاج فقيه طازج كامل ١ كجم',
        brand: 'Fakieh',
        inner_pack_count: 1,
        each_size_value: 1,
        each_size_unit: 'kg'
      }
      const drumsticksProduct = {
        id: 'fakieh-drumsticks',
        name_en: 'Fakieh Fresh Chicken Drumsticks 1kg',
        name_ar: 'سيقان دجاج فقيه طازجة ١ كجم',
        brand_name: 'Fakieh',
        inner_pack_count: 1,
        each_size_value: 1,
        each_size_unit: 'kg',
        verification_status: 'verified'
      }

      const res = validateProductIdentityCompatibility(wholeChickenOffer, drumsticksProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Cut/part mismatch')
        ])
      )
    })

    it('strictly rejects Plain Base Milk against Flavored Milk (Strawberry)', () => {
      // 1. Plain base milk offer omitting flavor against Strawberry candidate product: insufficient evidence
      const plainMilkOffer = {
        title_en: 'Almarai Milk 1L',
        brand: 'Almarai',
        inner_pack_count: 1,
        each_size_value: 1,
        each_size_unit: 'l'
      }
      const strawberryMilkProduct = {
        id: 'almarai-strawberry',
        name_en: 'Almarai Strawberry Milk 1L',
        brand_name: 'Almarai',
        variant_or_flavor: 'strawberry',
        inner_pack_count: 1,
        each_size_value: 1,
        each_size_unit: 'l',
        verification_status: 'verified'
      }

      const res = validateProductIdentityCompatibility(plainMilkOffer, strawberryMilkProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_insufficient_evidence')
      expect(res.reason).toContain('lacks flavor specification')

      // 2. Conflicting flavor (Chocolate vs Strawberry): contradictory
      const chocolateMilkOffer = {
        title_en: 'Almarai Chocolate Milk 1L',
        brand: 'Almarai',
        variant_or_flavor: 'chocolate',
        inner_pack_count: 1,
        each_size_value: 1,
        each_size_unit: 'l'
      }
      const chocRes = validateProductIdentityCompatibility(chocolateMilkOffer, strawberryMilkProduct)
      expect(chocRes.isCompatible).toBe(false)
      expect(chocRes.status).toBe('rejected_contradictory')
      expect(chocRes.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Variant/flavor mismatch')
        ])
      )
    })
  })

  // =========================================================================
  // 6. Image Reuse Safety & Step 1 CSV Routing
  // =========================================================================
  describe('Capability 6: Product Image Reuse Safety', () => {
    const verifiedCatalogProduct = {
      id: 501,
      name_en: 'Al Safi Milk Full Fat 1L',
      brand_name: 'Al Safi',
      inner_pack_count: 1,
      each_size_value: 1,
      each_size_unit: 'l',
      verification_status: 'verified',
      approved_primary_image_id: 'img-alsafi-1l',
      default_image_url: 'https://storage.wifran.com/product-images/catalog/alsafi-1l.webp'
    }

    it('approves image reuse for an exact verified package match (1x1L)', () => {
      const exactOffer = {
        title_en: 'Al Safi Full Fat Milk 1000ml',
        brand_name: 'Al Safi',
        inner_pack_count: 1,
        each_size_value: 1000,
        each_size_unit: 'ml'
      }

      const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
        exactOffer,
        [verifiedCatalogProduct]
      )

      expect(matchedProduct).toBeDefined()
      expect(matchedProduct.id).toBe(501)
      expect(result.status).toBe('verified_compatible')
      // Demonstrates eligibility for existing_db image reuse
      expect(matchedProduct.default_image_url).toBe('https://storage.wifran.com/product-images/catalog/alsafi-1l.webp')
    })

    it('strictly rejects image reuse for an incompatible package variant (4 x 1L multipack)', () => {
      const multipackOffer = {
        title_en: 'Al Safi Full Fat Milk 4x1L',
        brand_name: 'Al Safi',
        inner_pack_count: 4,
        each_size_value: 1,
        each_size_unit: 'l',
        sale_unit_type: 'pack'
      }

      const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
        multipackOffer,
        [verifiedCatalogProduct]
      )

      // Must NOT match 1L single product, preventing consumer image contamination
      expect(matchedProduct).toBeNull()
      expect(result.isCompatible).toBe(false)
      expect(result.status).toBe('rejected_contradictory')
      expect(result.reason).toContain('Pack quantity mismatch: offer=4 vs product=1')
    })
  })

  // =========================================================================
  // 7. Promotion Semantics & Physical SKU Disambiguation (Milestone 2H)
  // =========================================================================
  describe('Capability 7: Promotional Purchase Mechanics vs Physical SKU Packaging (Milestone 2H)', () => {
    const fakiehCatalogProduct = {
      id: 10,
      name_en: 'Fakieh Frozen Chicken 600g',
      name_ar: 'دجاج فقيه مجمد ٦٠٠ جرام',
      item_name_complete: 'Fakieh Frozen Chicken 600g دجاج فقيه مجمد ٦٠٠ جرام',
      brand_name: 'Fakieh',
      inner_pack_count: 1,
      each_size_value: 600,
      each_size_unit: 'g',
      sale_unit_type: 'each',
      verification_status: 'verified'
    }

    it('correctly separates promotional multi-buy purchase condition (BUY 2 PCS) from single physical SKU (600Gm)', () => {
      // Simulating upstream raw offer where AI populated pack_quantity: 2 from "BUY 2 PCS" banner
      const fakiehPromoOffer = {
        title_en: 'Fakieh Frozen Chicken 600Gm',
        title_ar: 'دجاج فقيه مجمد ٦٠٠ ج',
        size_text: '600Gm',
        brand: 'Fakieh',
        condition_text: '2 Pc Per Customer On Promotion Price',
        promotion_mechanic: 'multi_buy',
        ai_pack_quantity: 2,
        inner_pack_count: 2 // simulated upstream artifact
      }

      const config = extractStructuredQuantityConfig(fakiehPromoOffer)

      // Physical SKU inner pack count must remain 1 (single 600g chicken)
      expect(config.innerPackCount).toBe(1)
      expect(config.individualUnitContent).toMatchObject({
        value: 600,
        unit: 'g',
        dimension: 'mass',
        baseValue: 600,
        baseUnit: 'g'
      })
      expect(config.totalPackageContent?.totalBaseValue).toBe(600)

      // Must be verified compatible with 1x600g catalog product
      const compat = validateProductIdentityCompatibility(fakiehPromoOffer, fakiehCatalogProduct)
      expect(compat.isCompatible).toBe(true)
      expect(compat.status).toBe('verified_compatible')
    })

    it('preserves physical pack count on genuine manufacturer multipacks (10x600g / 2x500g)', () => {
      const genuineMultipack = {
        title_en: 'Fakieh Frozen Chicken 10 x 600g',
        title_ar: 'دجاج فقيه مجمد 10 × 600 جرام',
        size_text: '10x600g',
        brand: 'Fakieh',
        condition_text: 'Special Promotional Pack',
        promotion_mechanic: 'standard_price'
      }

      const config = extractStructuredQuantityConfig(genuineMultipack)
      expect(config.innerPackCount).toBe(10)
      expect(config.individualUnitContent?.value).toBe(600)
      expect(config.totalPackageContent?.totalBaseValue).toBe(6000)

      // Contradicts single 600g product
      const compat = validateProductIdentityCompatibility(genuineMultipack, fakiehCatalogProduct)
      expect(compat.isCompatible).toBe(false)
      expect(compat.status).toBe('rejected_contradictory')
      expect(compat.reason).toContain('Pack quantity mismatch: offer=10 vs product=1')
    })

    it('parses quantity semantics in mapRev1OfferToCanonical ensuring bundle_quantity is populated without corrupting pack_quantity', async () => {
      const { mapRev1OfferToCanonical } = await import('../../../main/page-first/pageOfferCanonicalMapper')

      const rawOffer = {
        offer_number: 7,
        english_title: 'Fakieh Frozen Chicken 600Gm',
        arabic_title: 'دجاج فقيه مجمد ٦٠٠ ج',
        brand: 'Fakieh',
        size_value: '600Gm',
        pack_quantity: 2, // AI extraction extracted 2 from "BUY 2 PCS"
        promo_price: 15.0,
        original_price: 21.99,
        promo_condition: 'MULTI_BUY',
        quantity_limit: '2 Pc Per Customer On Promotion Price',
        confidence: 0.95,
        components: {
          promo_price_box: [100, 100, 200, 200] as [number, number, number, number]
        }
      }

      const canonical = mapRev1OfferToCanonical({
        offer: rawOffer as any,
        cropRect: {} as any,
        pageNumber: 1,
        pdfBaseName: 'alwafa_test',
        packageDir: '.',
        trustedContext: {
          leafletId: 'leaflet-alwafa-001',
          supermarketId: 'super-001',
          supermarketSlug: 'alwafa',
          locationScope: 'city',
          cityId: 'city-001',
          regionId: 'reg-001',
          offerStartDate: '2026-11-01',
          offerEndDate: '2026-11-10'
        }
      })

      // Canonical content reflects physical unit content with commercial deal total
      expect(canonical.content.pack_quantity).toBe(1)
      expect(canonical.content.each_size_value).toBe(600)
      expect(canonical.content.each_size_unit).toBe('gram')
      expect(canonical.content.total_content_value).toBe(1200) // 2 x 600g commercial bundle transaction

      // Commercial bundle condition must be captured in bundle_quantity
      expect(canonical.content.bundle_quantity).toBe(2)
      expect(canonical.promotion.bundle_quantity).toBe(2)
      expect(canonical.promotion.mechanic).toBe('multi_buy')

      // Contract V2 must declare indivisible single unit
      expect(canonical.contract_v2?.quantity_semantics.sale_unit).toBe('each')
      expect(canonical.contract_v2?.quantity_semantics.inner_count).toBe(1)
    })
  })
})
