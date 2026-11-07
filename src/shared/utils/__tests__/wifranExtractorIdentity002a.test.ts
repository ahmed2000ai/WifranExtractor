/**
 * WIFRAN-EXTRACTOR-IDENTITY-002A — Milestone 2A: Safe Deterministic Unit Equivalence Test Suite
 *
 * Validates deterministic measurement-unit normalization, physical dimension safety,
 * multipack count enforcement, attribute conflict overrides, truncation fail-closed behavior,
 * and multi-candidate ambiguity protection.
 */

import { describe, it, expect, vi } from 'vitest'

const { mockSupabase, updateCalls } = vi.hoisted(() => {
  const updateCalls: any[] = []
  const mockOffer = {
    id: 'offer-equiv-001',
    title_en: 'Al Safi Long Life Full Cream Milk 1000ml',
    title_ar: 'حليب الصافي طويل الأجل 1000 مل',
    status: 'published',
    sale_unit_type: 'each',
    each_size_value: 1000,
    each_size_unit: 'ml',
    inner_pack_count: 1,
    brand_name: 'Al Safi',
    brand_candidate_text: 'Al Safi',
    catalog_match_status: 'unresolved',
    product_id: null,
    contract_v2: {
      product_facts: {
        brand_assertion: { value: 'Al Safi' },
        variant_or_flavor: 'Full Cream',
        fat_content: 'full_cream',
        exact_identity_status: 'verified_exact'
      }
    }
  }

  const mockVerifiedProduct = {
    id: 1,
    canonical_product_key: 'al-safi:al-safi-long-life-full-cream-milk-1000ml:full-cream:1l:1xeach',
    item_name_complete: 'Al Safi Long Life Full Cream Milk 1L',
    verification_status: 'verified',
    brand_name: 'Al Safi',
    variant_or_flavor: 'Full Cream',
    each_size_value: 1,
    each_size_unit: 'l',
    inner_pack_count: 1,
    sale_unit_type: 'each'
  }

  const mockSupabase: any = {
    from: (table: string) => {
      if (table === 'offers') {
        const queryObj: any = {
          data: [mockOffer],
          error: null,
          eq: () => queryObj,
          in: () => queryObj
        }
        return {
          select: () => queryObj,
          update: (payload: any) => ({
            eq: (field: string, val: any) => {
              updateCalls.push({ payload, field, val })
              return Promise.resolve({ data: null, error: null })
            }
          })
        }
      }
      if (table === 'products') {
        const prodQuery: any = {
          data: [mockVerifiedProduct],
          error: null,
          eq: () => prodQuery
        }
        return {
          select: () => prodQuery
        }
      }
      if (table === 'brands') {
        return {
          select: () => Promise.resolve({ data: [{ id: 'brand-1', name_en: 'Al Safi', name_ar: 'الصافي' }] })
        }
      }
      return {}
    }
  }

  return { mockSupabase, updateCalls }
})

vi.mock('../../../main/db/supabaseAdminClient', () => ({
  getSupabaseAdminClient: () => mockSupabase
}))

import {
  normalizeMeasurement,
  areMeasurementsEquivalent,
  getMeasurementDimension,
  convertMeasurement,
  getEquivalentMeasurements,
  generateEquivalentTitleVariants,
  getEquivalentCanonicalKeys
} from '../unitEquivalence'
import {
  validateProductIdentityCompatibility,
  selectSingleCompatibleVerifiedProduct
} from '../../../main/db/productIdentityCompatibilityValidator'
import {
  analyzeOfferCatalogCandidates
} from '../../../main/db/productCatalogResolutionService'

describe('WIFRAN-EXTRACTOR-IDENTITY-002A: Unit Equivalence Core Engine', () => {
  describe('Requirement 1: Exact Volume Equivalences', () => {
    it('accurately normalizes and equates 1L and 1000ml', () => {
      const norm1 = normalizeMeasurement(1, 'L')
      expect(norm1?.baseValue).toBe(1000)
      expect(norm1?.dimension).toBe('volume')
      expect(getMeasurementDimension('L')).toBe('volume')
      expect(convertMeasurement(1, 'l', 'ml')).toBe(1000)

      const res = areMeasurementsEquivalent(1, 'L', 1000, 'ml')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
      expect(res.reason).toContain('mathematically equivalent (1000ml)')
    })

    it('accurately normalizes and equates 0.5L and 500ml', () => {
      const res = areMeasurementsEquivalent(0.5, 'l', 500, 'ml')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('accurately normalizes and equates 0.25L and 250ml', () => {
      const res = areMeasurementsEquivalent(0.25, 'liter', 250, 'ml')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('accurately normalizes and equates 0.33L and 330ml', () => {
      const res = areMeasurementsEquivalent(0.33, 'L', 330, 'ml')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('accurately normalizes and equates 1.5L and 1500ml', () => {
      const res = areMeasurementsEquivalent(1.5, 'ltr', 1500, 'milliliters')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('accurately normalizes and equates 10cl and 100ml', () => {
      const res = areMeasurementsEquivalent(10, 'cl', 100, 'ml')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })
  })

  describe('Requirement 2: Exact Mass / Weight Equivalences', () => {
    it('accurately normalizes and equates 1kg and 1000g', () => {
      const equivs = getEquivalentMeasurements(1, 'kg')
      expect(equivs).toEqual(
        expect.arrayContaining([{ value: 1000, unit: 'g', canonicalUnit: 'g' }])
      )

      const res = areMeasurementsEquivalent(1, 'kg', 1000, 'g')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
      expect(res.reason).toContain('mathematically equivalent (1000g)')
    })

    it('accurately normalizes and equates 0.5kg and 500g', () => {
      const res = areMeasurementsEquivalent(0.5, 'kilogram', 500, 'grams')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('accurately normalizes and equates 0.25kg and 250g', () => {
      const res = areMeasurementsEquivalent(0.25, 'kg', 250, 'g')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('accurately normalizes and equates 0.6kg and 600g', () => {
      const res = areMeasurementsEquivalent(0.6, 'kg', 600, 'g')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('accurately normalizes and equates 0.45kg and 450g', () => {
      const res = areMeasurementsEquivalent(0.45, 'kg', 450, 'gm')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('accurately normalizes and equates 1g and 1000mg', () => {
      const res = areMeasurementsEquivalent(1, 'g', 1000, 'mg')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })
  })

  describe('Requirement 3: Arabic Unit & Numerals Equivalences', () => {
    it('equates Arabic numeral and unit "١ لتر" with "1000 مل"', () => {
      const res = areMeasurementsEquivalent('١', 'لتر', 1000, 'مل')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('equates Arabic numeral and unit "٠٫٥ لتر" with "500 ml"', () => {
      const res = areMeasurementsEquivalent('٠٫٥', 'لتر', 500, 'ml')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('equates Arabic numeral and unit "١ كجم" with "1000 جم"', () => {
      const res = areMeasurementsEquivalent('١', 'كجم', '١٠٠٠', 'جم')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('equates "١ كيلو" with "1000 غرام"', () => {
      const res = areMeasurementsEquivalent('١', 'كيلو', 1000, 'غرام')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('equates Arabic count "١٠ حبات" with "10 pcs"', () => {
      const res = areMeasurementsEquivalent('١٠', 'حبات', 10, 'pcs')
      expect(res.isEquivalent).toBe(true)
      expect(res.isDimensionCompatible).toBe(true)
    })
  })

  describe('Requirement 4: Strict Physical Dimension Separation', () => {
    it('strictly rejects mass vs volume equivalence (1kg != 1L)', () => {
      const res = areMeasurementsEquivalent(1, 'kg', 1, 'l')
      expect(res.isEquivalent).toBe(false)
      expect(res.isDimensionCompatible).toBe(false)
      expect(res.reason).toContain('Incompatible measurement dimensions: offer=mass (1kg) vs product=volume (1l)')
    })

    it('strictly rejects 500g vs 500ml', () => {
      const res = areMeasurementsEquivalent(500, 'g', 500, 'ml')
      expect(res.isEquivalent).toBe(false)
      expect(res.isDimensionCompatible).toBe(false)
    })

    it('strictly rejects count vs mass (10 pcs != 10kg)', () => {
      const res = areMeasurementsEquivalent(10, 'pcs', 10, 'kg')
      expect(res.isEquivalent).toBe(false)
      expect(res.isDimensionCompatible).toBe(false)
    })

    it('strictly rejects rolls vs sheets (10 rolls != 10 sheets)', () => {
      const res = areMeasurementsEquivalent(10, 'roll', 10, 'sheet')
      expect(res.isEquivalent).toBe(false)
      expect(res.isDimensionCompatible).toBe(false)
    })
  })

  describe('Requirement 5: Real Quantity Mismatches (Within Same Dimension)', () => {
    it('strictly rejects 245ml vs 250ml', () => {
      const res = areMeasurementsEquivalent(245, 'ml', 250, 'ml')
      expect(res.isEquivalent).toBe(false)
      expect(res.isDimensionCompatible).toBe(true)
      expect(res.reason).toContain('Measurement quantity mismatch: offer=245ml (245ml) vs product=250ml (250ml)')
    })

    it('strictly rejects 450g vs 500g', () => {
      const res = areMeasurementsEquivalent(450, 'g', 500, 'g')
      expect(res.isEquivalent).toBe(false)
      expect(res.isDimensionCompatible).toBe(true)
    })

    it('strictly rejects 0.9kg vs 1000g', () => {
      const res = areMeasurementsEquivalent(0.9, 'kg', 1000, 'g')
      expect(res.isEquivalent).toBe(false)
      expect(res.isDimensionCompatible).toBe(true)
    })
  })

  describe('Requirement 6: Fail-Closed on Invalid, Unrecognized, or Missing Measurements', () => {
    it('fails closed when unit is unrecognized (500 xyz vs 500g)', () => {
      const res = areMeasurementsEquivalent(500, 'xyz', 500, 'g')
      expect(res.isEquivalent).toBe(false)
      expect(res.reason).toContain('Unrecognized or unsupported measurement unit')
    })

    it('fails closed when value is null or undefined', () => {
      const res = areMeasurementsEquivalent(null, 'g', 500, 'g')
      expect(res.isEquivalent).toBe(false)
      expect(res.reason).toContain('Missing or invalid measurement')
    })

    it('fails closed when value is zero or negative', () => {
      const res = areMeasurementsEquivalent(0, 'ml', 100, 'ml')
      expect(res.isEquivalent).toBe(false)
      const resNeg = areMeasurementsEquivalent(-500, 'g', 500, 'g')
      expect(resNeg.isEquivalent).toBe(false)
    })
  })

  describe('Requirement 7: Title Variant Generation & Canonical Key Equivalence', () => {
    it('generates bidirectional equivalent title variants for 1L <-> 1000ml', () => {
      const variantsL = generateEquivalentTitleVariants('Al Safi Long Life Full Cream Milk 1L')
      expect(variantsL).toContain('Al Safi Long Life Full Cream Milk 1000ml')
      expect(variantsL).toContain('Al Safi Long Life Full Cream Milk 1000 ml')

      const variantsMl = generateEquivalentTitleVariants('Al Safi Long Life Full Cream Milk 1000ml')
      expect(variantsMl).toContain('Al Safi Long Life Full Cream Milk 1l')
      expect(variantsMl).toContain('Al Safi Long Life Full Cream Milk 1 l')
    })

    it('generates equivalent title variants for mass 1kg <-> 1000g', () => {
      const variantsKg = generateEquivalentTitleVariants('Al Shalan Basmati Rice 1kg')
      expect(variantsKg).toContain('Al Shalan Basmati Rice 1000g')
      expect(variantsKg).toContain('Al Shalan Basmati Rice 1000 g')

      const variantsG = generateEquivalentTitleVariants('Al Shalan Basmati Rice 1000g')
      expect(variantsG).toContain('Al Shalan Basmati Rice 1kg')
      expect(variantsG).toContain('Al Shalan Basmati Rice 1 kg')
    })

    it('generates equivalent canonical product keys for map lookups', () => {
      const keys = getEquivalentCanonicalKeys('alsafi:milk:std:1000ml:1xeach')
      expect(keys).toContain('alsafi:milk:std:1l:1xeach')

      const keysFromL = getEquivalentCanonicalKeys('nadec:milk:full-fat:1l:4xpack')
      expect(keysFromL).toContain('nadec:milk:full-fat:1000ml:4xpack')
    })
  })
})

describe('WIFRAN-EXTRACTOR-IDENTITY-002A: Integration with Product Compatibility Validator', () => {
  const baseVerifiedProduct = {
    id: 1,
    name_en: 'Al Safi Long Life Full Cream Milk 1L',
    name_ar: 'حليب الصافي كامل الدسم طويل الأجل ١ لتر',
    brand_name: 'Al Safi',
    variant_or_flavor: 'Full Cream',
    each_size_value: 1,
    each_size_unit: 'l',
    inner_pack_count: 1,
    sale_unit_type: 'each',
    verification_status: 'verified',
    canonical_product_key: 'alsafi:al-safi-long-life-full-cream-milk-1l:full-cream:1l:1xeach'
  }

  describe('Requirement 8: Equivalent Units Are Accepted When All Other Facts Match', () => {
    it('accepts offer with 1000ml matching catalog product with 1L', () => {
      const offer = {
        title_en: 'Al Safi Long Life Full Cream Milk 1000ml',
        title_ar: 'حليب الصافي كامل الدسم طويل الأجل 1000 مل',
        brand_name: 'Al Safi',
        each_size_value: 1000,
        each_size_unit: 'ml',
        inner_pack_count: 1,
        sale_unit_type: 'each',
        contract_v2: {
          product_facts: {
            brand_assertion: { value: 'Al Safi' },
            variant_or_flavor: 'Full Cream',
            fat_content: 'full_cream',
            exact_identity_status: 'verified_exact'
          }
        }
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(true)
      expect(res.status).toBe('verified_compatible')
    })

    it('accepts offer with 1kg matching catalog product with 1000g', () => {
      const chickenProduct = {
        id: 5,
        name_en: 'Fakieh Frozen Chicken 1000g',
        name_ar: 'دجاج فقيه مجمد 1000 جم',
        brand_name: 'Fakieh',
        variant_or_flavor: 'Frozen',
        each_size_value: 1000,
        each_size_unit: 'g',
        inner_pack_count: 1,
        sale_unit_type: 'each',
        verification_status: 'verified',
        canonical_product_key: 'fakieh:fakieh-frozen-chicken-1000g:frozen:1000g:1xeach'
      }

      const offer = {
        title_en: 'Fakieh Frozen Chicken 1kg',
        title_ar: 'دجاج فقيه مجمد 1 كجم',
        brand_name: 'Fakieh',
        each_size_value: 1,
        each_size_unit: 'kg',
        inner_pack_count: 1,
        sale_unit_type: 'each',
        contract_v2: {
          product_facts: {
            brand_assertion: { value: 'Fakieh' },
            variant_or_flavor: 'Frozen',
            exact_identity_status: 'verified_exact'
          }
        }
      }

      const res = validateProductIdentityCompatibility(offer, chickenProduct)
      expect(res.isCompatible).toBe(true)
      expect(res.status).toBe('verified_compatible')
    })
  })

  describe('Requirement 9: Multipack Distinctions Are Strictly Protected', () => {
    it('strictly rejects multipack 4 x 250ml vs single 1 x 1L SKU', () => {
      const offer = {
        title_en: 'Al Safi Long Life Full Cream Milk 4x250ml',
        brand_name: 'Al Safi',
        each_size_value: 250,
        each_size_unit: 'ml',
        inner_pack_count: 4,
        sale_unit_type: 'pack',
        contract_v2: {
          product_facts: {
            brand_assertion: { value: 'Al Safi' },
            variant_or_flavor: 'Full Cream',
            fat_content: 'full_cream'
          }
        }
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      // Both pack count AND individual package size reject the false match
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Package size mismatch'),
          expect.stringContaining('Pack quantity mismatch: offer=4 vs product=1')
        ])
      )
    })

    it('strictly rejects carton 12 x 1L vs single 1 x 1L SKU', () => {
      const offer = {
        title_en: 'Al Safi Long Life Full Cream Milk 12x1L',
        brand_name: 'Al Safi',
        each_size_value: 1,
        each_size_unit: 'l',
        inner_pack_count: 12,
        sale_unit_type: 'carton',
        contract_v2: {
          product_facts: {
            brand_assertion: { value: 'Al Safi' },
            variant_or_flavor: 'Full Cream',
            fat_content: 'full_cream'
          }
        }
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Pack quantity mismatch: offer=12 vs product=1')
        ])
      )
    })

    it('strictly rejects 10 x 600g carton vs single 600g product (Phase 1N Canary Case)', () => {
      const singleProduct = {
        id: 5,
        name_en: 'Fakieh Frozen Chicken 600g',
        brand_name: 'Fakieh',
        each_size_value: 600,
        each_size_unit: 'g',
        inner_pack_count: 1,
        verification_status: 'verified'
      }

      const offer = {
        title_en: 'Fakieh Frozen Chicken 10x600g',
        brand_name: 'Fakieh',
        each_size_value: 600,
        each_size_unit: 'g',
        inner_pack_count: 10
      }

      const res = validateProductIdentityCompatibility(offer, singleProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Pack quantity mismatch: offer=10 vs product=1')
        ])
      )
    })
  })

  describe('Requirement 10: Attribute Invariants Cannot Be Overridden By Unit Equivalence', () => {
    it('rejects match when brands conflict despite equivalent units (Al Safi 1000ml vs Nadec 1L)', () => {
      const offer = {
        title_en: 'Nadec Long Life Full Cream Milk 1000ml',
        brand_name: 'Nadec',
        each_size_value: 1000,
        each_size_unit: 'ml',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Brand mismatch: offer=\'nadec\' vs product=\'al safi\'')
        ])
      )
    })

    it('rejects match when fat content conflicts despite equivalent units (Low Fat 1000ml vs Full Cream 1L)', () => {
      const offer = {
        title_en: 'Al Safi Long Life Low Fat Milk 1000ml',
        brand_name: 'Al Safi',
        each_size_value: 1000,
        each_size_unit: 'ml',
        inner_pack_count: 1,
        contract_v2: {
          product_facts: {
            brand_assertion: { value: 'Al Safi' },
            variant_or_flavor: 'Low Fat',
            fat_content: 'low_fat'
          }
        }
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Fat content mismatch: offer=\'low_fat\' vs product=\'full_fat\'')
        ])
      )
    })

    it('rejects match when cut/variant conflicts despite equivalent mass (Chicken Fillet 0.6kg vs Drumsticks 600g)', () => {
      const drumsticksProduct = {
        id: 7,
        name_en: 'Fakieh Fresh Chicken Drumsticks 600g',
        brand_name: 'Fakieh',
        variant_or_flavor: 'Drumsticks',
        each_size_value: 600,
        each_size_unit: 'g',
        inner_pack_count: 1,
        verification_status: 'verified'
      }

      const offer = {
        title_en: 'Fakieh Fresh Chicken Fillet 0.6kg',
        brand_name: 'Fakieh',
        each_size_value: 0.6,
        each_size_unit: 'kg',
        inner_pack_count: 1,
        contract_v2: {
          product_facts: {
            brand_assertion: { value: 'Fakieh' },
            variant_or_flavor: 'Fillet'
          }
        }
      }

      const res = validateProductIdentityCompatibility(offer, drumsticksProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Variant/flavor mismatch: offer=\'fillet\' vs product=\'drumstick\'')
        ])
      )
    })

    it('rejects match when candidate product is unverified despite equivalent units', () => {
      const unverifiedProduct = {
        ...baseVerifiedProduct,
        verification_status: 'unverified'
      }

      const offer = {
        title_en: 'Al Safi Long Life Full Cream Milk 1000ml',
        brand_name: 'Al Safi',
        each_size_value: 1000,
        each_size_unit: 'ml',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(offer, unverifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_insufficient_evidence')
      expect(res.reason).toContain('is unverified (status: \'unverified\'). Auto-match blocked.')
    })
  })

  describe('Requirement 11: Fail-Closed Ambiguity & System Guardrails', () => {
    it('rejects auto-match when multiple distinct verified products match equivalent unit', () => {
      const prodA = {
        ...baseVerifiedProduct,
        id: 1,
        name_en: 'Al Safi Long Life Full Cream Milk 1L',
        canonical_product_key: 'alsafi:al-safi-long-life-full-cream-milk-1l:full-cream:1l:1xeach'
      }
      const prodB = {
        ...baseVerifiedProduct,
        id: 2,
        name_en: 'Al Safi Fresh Full Cream Milk 1000ml',
        canonical_product_key: 'alsafi:al-safi-fresh-full-cream-milk-1000ml:full-cream:1000ml:1xeach'
      }

      const offer = {
        title_en: 'Al Safi Full Cream Milk 1000ml',
        brand_name: 'Al Safi',
        each_size_value: 1000,
        each_size_unit: 'ml',
        inner_pack_count: 1,
        contract_v2: {
          product_facts: {
            brand_assertion: { value: 'Al Safi' },
            variant_or_flavor: 'Full Cream',
            fat_content: 'full_cream'
          }
        }
      }

      const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
        offer,
        [prodA, prodB]
      )
      expect(matchedProduct).toBeNull()
      expect(result.status).toBe('rejected_multiple_candidates')
      expect(result.reason).toContain('Multiple distinct verified products (1, 2) matched offer')
    })

    it('fails closed when candidate search is truncated (> 25 candidates)', () => {
      const offer = {
        title_en: 'Al Safi Milk 1000ml',
        brand_name: 'Al Safi',
        each_size_value: 1000,
        each_size_unit: 'ml'
      }

      const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
        offer,
        [baseVerifiedProduct],
        { isTruncated: true }
      )
      expect(matchedProduct).toBeNull()
      expect(result.status).toBe('rejected_candidate_search_incomplete')
      expect(result.reason).toContain('Candidate search exceeded limit of 25 products')
    })

    it('fails closed when database lookup failure occurs during retrieval', () => {
      const offer = {
        title_en: 'Al Safi Milk 1000ml',
        brand_name: 'Al Safi',
        each_size_value: 1000,
        each_size_unit: 'ml'
      }

      const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
        offer,
        [baseVerifiedProduct],
        { hasLookupFailure: true }
      )
      expect(matchedProduct).toBeNull()
      expect(result.status).toBe('rejected_database_lookup_failure')
      expect(result.reason).toContain('Database lookup failure occurred')
    })
  })
})

describe('WIFRAN-EXTRACTOR-IDENTITY-002A: End-to-End Service Integration', () => {
  it('correctly auto-links 1000ml offer to verified 1L product in catalog resolution', async () => {
    updateCalls.length = 0
    const result = await analyzeOfferCatalogCandidates({ offerIds: ['offer-equiv-001'] })
    expect(result.autoLinkedCount).toBe(1)
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0].payload).toMatchObject({
      product_id: 1,
      catalog_match_status: 'verified_linked',
      catalog_verification_basis: 'verified_catalog_reuse'
    })
  })
})
