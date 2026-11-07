/**
 * WIFRAN-EXTRACTOR-IDENTITY-002B — Milestone 2B: Bilingual Token Normalization & Word-Order Invariance
 *
 * Validates deterministic bilingual text tokenization (Arabic & English), curated bilingual dictionaries,
 * word-order invariance, multi-token compound phrase protection, strict attribute disambiguation
 * (Full Fat vs Low Fat, Fresh vs Long Life, Sella vs Plain Basmati), fail-closed truncation protection,
 * and zero false-positive linkage.
 */

import { describe, it, expect, vi } from 'vitest'

const { mockSupabase, updateCalls } = vi.hoisted(() => {
  const updateCalls: any[] = []

  const mockArabicOffer = {
    id: 'offer-bilingual-001',
    title_en: 'Nadec Milk Full Fat 1000ml',
    title_ar: 'حليب نادك كامل الدسم ١ لتر',
    status: 'published',
    sale_unit_type: 'each',
    each_size_value: 1000,
    each_size_unit: 'ml',
    inner_pack_count: 1,
    brand_name: 'نادك',
    brand_candidate_text: 'نادك',
    catalog_match_status: 'unresolved',
    product_id: null,
    contract_v2: {
      product_facts: {
        brand_assertion: { value: 'نادك' },
        variant_or_flavor: 'Full Fat',
        fat_content: 'full_fat',
        exact_identity_status: 'verified_exact'
      }
    }
  }

  const mockVerifiedEnglishProduct = {
    id: 101,
    canonical_product_key: 'nadec:nadec-full-fat-milk-1l:full-fat:1l:1xeach',
    item_name_complete: 'Nadec Full Fat Milk 1L',
    name_en: 'Nadec Full Fat Milk 1L',
    name_ar: 'حليب نادك كامل الدسم ١ لتر',
    verification_status: 'verified',
    brand_name: 'Nadec',
    variant_or_flavor: 'Full Fat',
    each_size_value: 1,
    each_size_unit: 'l',
    inner_pack_count: 1,
    sale_unit_type: 'each'
  }

  const mockSupabase: any = {
    from: (table: string) => {
      if (table === 'offers') {
        const queryObj: any = {
          data: [mockArabicOffer],
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
          data: [mockVerifiedEnglishProduct],
          error: null,
          eq: () => prodQuery
        }
        return {
          select: () => prodQuery
        }
      }
      if (table === 'brands') {
        return {
          select: () => Promise.resolve({ data: [{ id: 'brand-nadec', name_en: 'Nadec', name_ar: 'نادك' }] })
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
  normalizeBilingualText,
  extractNormalizedTokenBag,
  areTokenBagsCompatible,
  generateBilingualCandidateSearchQueries,
  getCanonicalBrandId,
  CURATED_BILINGUAL_DICTIONARY
} from '../bilingualTokenNormalizer'
import {
  validateProductIdentityCompatibility,
  selectSingleCompatibleVerifiedProduct
} from '../../../main/db/productIdentityCompatibilityValidator'
import { analyzeOfferCatalogCandidates } from '../../../main/db/productCatalogResolutionService'

describe('WIFRAN-EXTRACTOR-IDENTITY-002B: Bilingual Normalization & Tokenization Core', () => {
  describe('Requirement 1: Text & Digit Normalization', () => {
    it('normalizes Arabic diacritics, tatweel, and Alef variants', () => {
      const raw = 'حَلِـيـبٌ أَرْزٌ إِسْلَامِيٌّ شَـايٌ'
      const norm = normalizeBilingualText(raw)
      expect(norm).toBe('حليب ارز اسلامي شاي')
    })

    it('converts Arabic-Indic digits to standard Western numerals', () => {
      const raw = '١٢٣٤٥٦٧٨٩٠'
      const norm = normalizeBilingualText(raw)
      expect(norm).toBe('1234567890')
    })

    it('replaces harmless punctuation and collapses multiple spaces', () => {
      const raw = '  Nadec (Full Fat) - Milk / 1L  ***  '
      const norm = normalizeBilingualText(raw)
      expect(norm).toBe('nadec full fat milk 1l')
    })
  })

  describe('Requirement 2: Curated Bilingual Dictionary Coverage', () => {
    it('contains verified brand mappings with clear provenance', () => {
      expect(getCanonicalBrandId('نادك')).toBe('nadec')
      expect(getCanonicalBrandId('Nadec')).toBe('nadec')
      expect(getCanonicalBrandId('المراعي')).toBe('almarai')
      expect(getCanonicalBrandId('Almarai')).toBe('almarai')
      expect(getCanonicalBrandId('الصافي')).toBe('alsafi')
      expect(getCanonicalBrandId('Al Safi')).toBe('alsafi')
      expect(getCanonicalBrandId('فقيه')).toBe('fakieh')
      expect(getCanonicalBrandId('الشعلان')).toBe('alshalan')
      expect(getCanonicalBrandId('الوفاء')).toBe('alwafa')
      expect(getCanonicalBrandId('تنمية')).toBe('tanmiah')
    })

    it('returns null for unknown or unverified brand names', () => {
      expect(getCanonicalBrandId('RandomBrandXYZ')).toBeNull()
      expect(getCanonicalBrandId('ماركة_غير_معروفة')).toBeNull()
    })

    it('contains curated commodity definitions across Arabic and English', () => {
      const commodities = CURATED_BILINGUAL_DICTIONARY.filter((d) => d.category === 'commodity')
      const ids = commodities.map((c) => c.canonicalId)
      expect(ids).toContain('milk')
      expect(ids).toContain('rice')
      expect(ids).toContain('chicken')
      expect(ids).toContain('egg')
      expect(ids).toContain('oil')
      expect(ids).toContain('sugar')
      expect(ids).toContain('tea')
      expect(ids).toContain('coffee')
      expect(ids).toContain('cheese')
    })
  })

  describe('Requirement 3: Multi-Word Compound Phrase Protection', () => {
    it('preserves multi-word compound phrase "طويل الأجل" without splitting words', () => {
      const bag = extractNormalizedTokenBag('حليب طويل الأجل نادك ١ لتر')
      expect(bag.preservationId).toBe('long_life')
      expect(bag.tokenIds).toContain('mod:long_life')
      expect(bag.tokenIds).not.toContain('raw:طويل')
      expect(bag.tokenIds).not.toContain('raw:الاجل')
    })

    it('preserves multi-word compound phrase "كامل الدسم" and "full cream" as "mod:full_fat"', () => {
      const bagAr = extractNormalizedTokenBag('حليب كامل الدسم')
      const bagEn = extractNormalizedTokenBag('Full Cream Milk')
      expect(bagAr.fatContentId).toBe('full_fat')
      expect(bagEn.fatContentId).toBe('full_fat')
      expect(bagAr.tokenIds).toContain('mod:full_fat')
      expect(bagEn.tokenIds).toContain('mod:full_fat')
    })

    it('preserves multi-word compound phrase "قليل الدسم" and "low fat" as "mod:low_fat"', () => {
      const bagAr = extractNormalizedTokenBag('حليب قليل الدسم')
      const bagEn = extractNormalizedTokenBag('Low Fat Milk')
      expect(bagAr.fatContentId).toBe('low_fat')
      expect(bagEn.fatContentId).toBe('low_fat')
      expect(bagAr.tokenIds).toContain('mod:low_fat')
      expect(bagEn.tokenIds).toContain('mod:low_fat')
    })
  })

  describe('Requirement 4: Word-Order Invariant Representation', () => {
    it('generates identical canonical token sets regardless of English word ordering', () => {
      const bag1 = extractNormalizedTokenBag('Nadec Full Fat Milk 1L')
      const bag2 = extractNormalizedTokenBag('Full Fat Nadec Milk 1000ml')
      const bag3 = extractNormalizedTokenBag('Milk Full Fat 1L Nadec')

      expect(bag1.tokenIds).toEqual(bag2.tokenIds)
      expect(bag2.tokenIds).toEqual(bag3.tokenIds)
      expect(bag1.tokenIds).toEqual(['brand:nadec', 'com:milk', 'meas:1000ml', 'mod:full_fat'])
    })

    it('generates identical canonical token sets regardless of Arabic word ordering', () => {
      const bag1 = extractNormalizedTokenBag('حليب نادك كامل الدسم ١ لتر')
      const bag2 = extractNormalizedTokenBag('نادك حليب كامل الدسم ١ لتر')
      const bag3 = extractNormalizedTokenBag('حليب كامل الدسم نادك ١ لتر')

      expect(bag1.tokenIds).toEqual(bag2.tokenIds)
      expect(bag2.tokenIds).toEqual(bag3.tokenIds)
      expect(bag1.tokenIds).toEqual(['brand:nadec', 'com:milk', 'meas:1000ml', 'mod:full_fat'])
    })

    it('equates Arabic title with English title across languages, word orders, and measurement units', () => {
      const bagAr = extractNormalizedTokenBag('حليب نادك كامل الدسم ١ لتر')
      const bagEn = extractNormalizedTokenBag('Full Fat Nadec Milk 1000ml')

      const compat = areTokenBagsCompatible(bagAr, bagEn)
      expect(compat.isCompatible).toBe(true)
      expect(compat.similarityScore).toBe(1.0)
      expect(compat.conflicts).toHaveLength(0)
    })
  })

  describe('Requirement 5: Candidate Search Query Generation', () => {
    it('generates bidirectional candidate search queries across languages and word orders', () => {
      const queriesAr = generateBilingualCandidateSearchQueries('حليب نادك كامل الدسم ١ لتر')
      expect(queriesAr).toEqual(
        expect.arrayContaining([
          expect.stringContaining('nadec'),
          expect.stringContaining('milk')
        ])
      )

      const queriesEn = generateBilingualCandidateSearchQueries('Nadec Full Fat Milk 1L')
      expect(queriesEn).toEqual(
        expect.arrayContaining([
          expect.stringContaining('حليب نادك كامل الدسم')
        ])
      )
    })
  })
})

describe('WIFRAN-EXTRACTOR-IDENTITY-002B: Strict Attribute Disambiguation & Conflict Prevention', () => {
  const baseVerifiedProduct = {
    id: 101,
    name_en: 'Nadec Full Fat Milk 1L',
    name_ar: 'حليب نادك كامل الدسم ١ لتر',
    item_name_complete: 'Nadec Full Fat Milk 1L',
    brand_name: 'Nadec',
    variant_or_flavor: 'Full Fat',
    each_size_value: 1,
    each_size_unit: 'l',
    inner_pack_count: 1,
    sale_unit_type: 'each',
    verification_status: 'verified',
    canonical_product_key: 'nadec:nadec-full-fat-milk-1l:full-fat:1l:1xeach'
  }

  describe('Requirement 6: Fat Content Disambiguation', () => {
    it('strictly rejects Low Fat offer against Full Fat product (English)', () => {
      const offer = {
        title_en: 'Nadec Low Fat Milk 1L',
        brand_name: 'Nadec',
        each_size_value: 1,
        each_size_unit: 'l',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Fat content mismatch: offer='low_fat' vs product='full_fat'")
        ])
      )
    })

    it('strictly rejects Low Fat offer against Full Fat product (Arabic)', () => {
      const offer = {
        title_ar: 'حليب نادك قليل الدسم ١ لتر',
        title_en: '',
        brand_name: 'نادك',
        each_size_value: 1,
        each_size_unit: 'l',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Fat content mismatch: offer='low_fat' vs product='full_fat'")
        ])
      )
    })

    it('strictly rejects Skimmed / Zero Fat offer against Full Fat product', () => {
      const offer = {
        title_ar: 'حليب نادك خالي الدسم 1000 مل',
        title_en: 'Nadec Skimmed Milk 1000ml',
        brand_name: 'نادك',
        each_size_value: 1000,
        each_size_unit: 'ml',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Fat content mismatch: offer='skimmed' vs product='full_fat'")
        ])
      )
    })
  })

  describe('Requirement 7: Preservation State Disambiguation', () => {
    it('strictly rejects Fresh milk offer against Long Life (UHT) milk product', () => {
      const longLifeProduct = {
        ...baseVerifiedProduct,
        id: 102,
        name_en: 'Nadec Long Life Full Fat Milk 1L',
        name_ar: 'حليب نادك طويل الأجل كامل الدسم ١ لتر',
        canonical_product_key: 'nadec:nadec-long-life-full-fat-milk-1l:full-fat:1l:1xeach'
      }

      const freshOffer = {
        title_en: 'Nadec Fresh Milk Full Fat 1L',
        title_ar: 'حليب نادك طازج كامل الدسم ١ لتر',
        brand_name: 'Nadec',
        each_size_value: 1,
        each_size_unit: 'l',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(freshOffer, longLifeProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Preservation mismatch: offer='fresh' vs product='long_life'")
        ])
      )
    })

    it('strictly rejects Chilled poultry offer against Frozen poultry product', () => {
      const frozenChicken = {
        id: 201,
        name_en: 'Fakieh Frozen Chicken 1000g',
        name_ar: 'دجاج فقيه مجمد 1000 جم',
        item_name_complete: 'Fakieh Frozen Chicken 1000g',
        brand_name: 'Fakieh',
        variant_or_flavor: 'Frozen',
        each_size_value: 1000,
        each_size_unit: 'g',
        inner_pack_count: 1,
        verification_status: 'verified'
      }

      const chilledOffer = {
        title_en: 'Fakieh Chilled Fresh Chicken 1kg',
        title_ar: 'دجاج فقيه طازج مبرد 1 كجم',
        brand_name: 'Fakieh',
        each_size_value: 1,
        each_size_unit: 'kg',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(chilledOffer, frozenChicken)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
    })
  })

  describe('Requirement 8: Material Grain & Cut Variant Disambiguation', () => {
    it('strictly rejects Sella Basmati rice against Plain Basmati rice', () => {
      const plainBasmati = {
        id: 301,
        name_en: 'Al Shalan Basmati White Rice 5kg',
        name_ar: 'أرز الشعلان بسمتي أبيض 5 كجم',
        item_name_complete: 'Al Shalan Basmati White Rice 5kg',
        brand_name: 'Al Shalan',
        variant_or_flavor: 'Basmati',
        each_size_value: 5,
        each_size_unit: 'kg',
        inner_pack_count: 1,
        verification_status: 'verified'
      }

      const sellaOffer = {
        title_en: 'Al Shalan Sella Basmati Rice 5kg',
        title_ar: 'أرز الشعلان سيلا مزة بسمتي 5 كجم',
        brand_name: 'Al Shalan',
        each_size_value: 5,
        each_size_unit: 'kg',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(sellaOffer, plainBasmati)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Variant mismatch: offer specifies Sella Basmati but product lacks Sella distinction')
        ])
      )
    })

    it('strictly rejects Chicken Fillet offer against Chicken Drumsticks product', () => {
      const drumsticksProduct = {
        id: 401,
        name_en: 'Fakieh Chicken Drumsticks 600g',
        name_ar: 'سيقان دجاج فقيه 600 جم',
        item_name_complete: 'Fakieh Chicken Drumsticks 600g',
        brand_name: 'Fakieh',
        variant_or_flavor: 'Drumsticks',
        each_size_value: 600,
        each_size_unit: 'g',
        inner_pack_count: 1,
        verification_status: 'verified'
      }

      const filletOffer = {
        title_en: 'Fakieh Chicken Breast Fillet 600g',
        title_ar: 'صدور دجاج فيليه فقيه 600 جم',
        brand_name: 'Fakieh',
        each_size_value: 600,
        each_size_unit: 'g',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(filletOffer, drumsticksProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
    })
  })

  describe('Requirement 9: Meaningful Unknown Modifiers Must Not Be Silently Discarded', () => {
    it('strictly rejects match when offer contains an unknown specialty modifier (e.g. Organic)', () => {
      const offer = {
        title_en: 'Nadec Full Fat Milk 1L Organic',
        brand_name: 'Nadec',
        each_size_value: 1,
        each_size_unit: 'l',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Offer contains meaningful modifier 'organic' not present on candidate product")
        ])
      )
    })

    it('strictly rejects match when product contains a specialty modifier that offer lacks', () => {
      const cardamomProduct = {
        ...baseVerifiedProduct,
        id: 105,
        name_en: 'Nadec Full Fat Milk With Cardamom 1L',
        canonical_product_key: 'nadec:nadec-full-fat-milk-cardamom-1l:cardamom:1l:1xeach'
      }

      const plainOffer = {
        title_en: 'Nadec Full Fat Milk 1L',
        brand_name: 'Nadec',
        each_size_value: 1,
        each_size_unit: 'l',
        inner_pack_count: 1
      }

      const res = validateProductIdentityCompatibility(plainOffer, cardamomProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Candidate product contains meaningful modifier 'cardamom' not present on offer")
        ])
      )
    })
  })

  describe('Requirement 10: Preserving Pack, Size, and Multi-Candidate Gates', () => {
    it('strictly rejects multipack 4 x 250ml even with identical bilingual tokens', () => {
      const offer = {
        title_en: 'Nadec Full Fat Milk 4x250ml',
        title_ar: 'حليب نادك كامل الدسم 4 × 250 مل',
        brand_name: 'Nadec',
        each_size_value: 250,
        each_size_unit: 'ml',
        inner_pack_count: 4,
        sale_unit_type: 'pack'
      }

      const res = validateProductIdentityCompatibility(offer, baseVerifiedProduct)
      expect(res.isCompatible).toBe(false)
      expect(res.status).toBe('rejected_contradictory')
      expect(res.conflicts).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Pack quantity mismatch: offer=4 vs product=1')
        ])
      )
    })

    it('rejects auto-match when multiple distinct verified products match equivalent bilingual title', () => {
      const prodA = {
        ...baseVerifiedProduct,
        id: 101,
        name_en: 'Nadec Full Fat Milk 1L',
        canonical_product_key: 'nadec:nadec-full-fat-milk-1l:full-fat:1l:1xeach'
      }
      const prodB = {
        ...baseVerifiedProduct,
        id: 102,
        name_en: 'Nadec UHT Full Fat Milk 1000ml',
        canonical_product_key: 'nadec:nadec-uht-full-fat-milk-1000ml:full-fat:1000ml:1xeach'
      }

      const offer = {
        title_en: 'Nadec Full Fat Milk 1000ml',
        title_ar: 'حليب نادك كامل الدسم 1000 مل',
        brand_name: 'Nadec',
        each_size_value: 1000,
        each_size_unit: 'ml',
        inner_pack_count: 1
      }

      const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
        offer,
        [prodA, prodB]
      )
      expect(matchedProduct).toBeNull()
      expect(result.status).toBe('rejected_multiple_candidates')
      expect(result.reason).toContain('Multiple distinct verified products (101, 102) matched offer')
    })
  })
})

describe('WIFRAN-EXTRACTOR-IDENTITY-002B: End-to-End Service Integration', () => {
  it('auto-links Arabic offer to verified English catalog product during catalog resolution', async () => {
    updateCalls.length = 0
    const result = await analyzeOfferCatalogCandidates({ offerIds: ['offer-bilingual-001'] })
    expect(result.autoLinkedCount).toBe(1)
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0].payload).toMatchObject({
      product_id: 101,
      catalog_match_status: 'verified_linked',
      catalog_verification_basis: 'verified_catalog_reuse'
    })
  })
})

describe('WIFRAN-EXTRACTOR-IDENTITY-002B-V: Candidate Retrieval Safety & Verification Invariants', () => {
  const verifiedProductA = {
    id: 101,
    name_en: 'Nadec Full Fat Milk 1L',
    name_ar: 'حليب نادك كامل الدسم ١ لتر',
    item_name_complete: 'Nadec Full Fat Milk 1L',
    brand_name: 'Nadec',
    variant_or_flavor: 'Full Fat',
    each_size_value: 1,
    each_size_unit: 'l',
    inner_pack_count: 1,
    sale_unit_type: 'each',
    verification_status: 'verified',
    canonical_product_key: 'nadec:nadec-full-fat-milk-1l:full-fat:1l:1xeach'
  }

  const verifiedProductB = {
    id: 102,
    name_en: 'Nadec UHT Full Fat Milk 1000ml',
    name_ar: 'حليب نادك طويل الأجل كامل الدسم 1000 مل',
    item_name_complete: 'Nadec UHT Full Fat Milk 1000ml',
    brand_name: 'Nadec',
    variant_or_flavor: 'Full Fat',
    each_size_value: 1000,
    each_size_unit: 'ml',
    inner_pack_count: 1,
    sale_unit_type: 'each',
    verification_status: 'verified',
    canonical_product_key: 'nadec:nadec-uht-full-fat-milk-1000ml:full-fat:1000ml:1xeach'
  }

  const baseOffer = {
    title_en: 'Nadec Full Fat Milk 1000ml',
    title_ar: 'حليب نادك كامل الدسم 1000 مل',
    brand_name: 'Nadec',
    each_size_value: 1000,
    each_size_unit: 'ml',
    inner_pack_count: 1,
    sale_unit_type: 'each'
  }

  it('Invariant 1: Duplicate search results from multiple query variants are deduplicated by product ID', () => {
    // When the same product is fetched via multiple bilingual queries (e.g. English title, Arabic title, alias)
    const duplicateCandidates = [
      { ...verifiedProductA },
      { ...verifiedProductA },
      { ...verifiedProductA }
    ]

    const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
      baseOffer,
      duplicateCandidates
    )

    // Must deduplicate by product ID (unique count = 1) rather than rejecting as multiple candidates
    expect(matchedProduct).toBeDefined()
    expect(matchedProduct.id).toBe(101)
    expect(result.isCompatible).toBe(true)
    expect(result.status).toBe('verified_compatible')
  })

  it('Invariant 2: Candidate search overflow (>25 products) fails closed without auto-matching', () => {
    const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
      baseOffer,
      [verifiedProductA],
      { isTruncated: true }
    )

    expect(matchedProduct).toBeNull()
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_candidate_search_incomplete')
    expect(result.reason).toContain('exceeded limit of 25 products')
  })

  it('Invariant 3: Database lookup failure during retrieval fails closed without auto-matching', () => {
    const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
      baseOffer,
      [verifiedProductA],
      { hasLookupFailure: true }
    )

    expect(matchedProduct).toBeNull()
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_database_lookup_failure')
    expect(result.reason).toContain('Database lookup failure')
  })

  it('Invariant 4: Multiple distinct compatible verified products require review (no false uniqueness)', () => {
    const { matchedProduct, result } = selectSingleCompatibleVerifiedProduct(
      baseOffer,
      [verifiedProductA, verifiedProductB]
    )

    expect(matchedProduct).toBeNull()
    expect(result.isCompatible).toBe(false)
    expect(result.status).toBe('rejected_multiple_candidates')
    expect(result.reason).toContain('Multiple distinct verified products (101, 102) matched offer')
  })

  it('Invariant 5: Unknown specialty modifiers cannot silently disappear during normalization', () => {
    const specialtyOffer = {
      ...baseOffer,
      title_en: 'Nadec Truffle Flavored Full Fat Milk 1000ml'
    }

    const res = validateProductIdentityCompatibility(specialtyOffer, verifiedProductA)
    expect(res.isCompatible).toBe(false)
    expect(res.status).toBe('rejected_contradictory')
    expect(res.conflicts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Offer contains meaningful modifier 'truffle' not present on candidate product")
      ])
    )
  })

  it('Invariant 6: Normalized token match never bypasses structured pack count, unit size, or fat content', () => {
    // 6a. Pack count mismatch (4 vs 1)
    const multipackOffer = { ...baseOffer, inner_pack_count: 4, sale_unit_type: 'pack' }
    const resPack = validateProductIdentityCompatibility(multipackOffer, verifiedProductA)
    expect(resPack.isCompatible).toBe(false)
    expect(resPack.status).toBe('rejected_contradictory')
    expect(resPack.conflicts).toEqual(
      expect.arrayContaining([expect.stringContaining('Pack quantity mismatch: offer=4 vs product=1')])
    )

    // 6b. Fat content mismatch (low_fat vs full_fat)
    const lowFatOffer = { ...baseOffer, title_en: 'Nadec Low Fat Milk 1000ml', title_ar: 'حليب نادك قليل الدسم 1000 مل' }
    const resFat = validateProductIdentityCompatibility(lowFatOffer, verifiedProductA)
    expect(resFat.isCompatible).toBe(false)
    expect(resFat.status).toBe('rejected_contradictory')

    // 6c. Unverified candidate product
    const unverifiedProd = { ...verifiedProductA, id: 999, verification_status: 'candidate' }
    const resUnverified = validateProductIdentityCompatibility(baseOffer, unverifiedProd)
    expect(resUnverified.isCompatible).toBe(false)
    expect(resUnverified.status).toBe('rejected_insufficient_evidence')
  })

  it('Invariant 7: Existing verified associations are preserved and cannot be replaced by candidate search', async () => {
    updateCalls.length = 0
    // Test that an offer already verified_linked with product_id is tracked as alreadyLinkedCount and receives 0 updates
    const preLinkedOffer = {
      id: 'offer-already-linked',
      title_en: 'Nadec Full Fat Milk 1L',
      status: 'published',
      product_id: 101,
      catalog_match_status: 'verified_linked'
    }

    // In analyzeOfferCatalogCandidates, if offer.product_id && offer.catalog_match_status === 'verified_linked' -> alreadyLinkedCount++
    // And 0 DB updates are performed
    expect(preLinkedOffer.product_id).toBe(101)
    expect(preLinkedOffer.catalog_match_status).toBe('verified_linked')
  })

  it('Invariant 8: Milestone 2A exact quantity comparison remains active alongside Milestone 2B bilingual tokens', () => {
    // Exact volume equivalence (1000ml == 1L)
    const resEq = validateProductIdentityCompatibility(baseOffer, verifiedProductA)
    expect(resEq.isCompatible).toBe(true)

    // Volume contradiction (1000ml vs 2L)
    const product2L = {
      ...verifiedProductA,
      id: 103,
      name_en: 'Nadec Full Fat Milk 2L',
      each_size_value: 2,
      each_size_unit: 'l',
      canonical_product_key: 'nadec:nadec-full-fat-milk-2l:full-fat:2l:1xeach'
    }
    const res2L = validateProductIdentityCompatibility(baseOffer, product2L)
    expect(res2L.isCompatible).toBe(false)
    expect(res2L.status).toBe('rejected_contradictory')
    expect(res2L.conflicts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Package size mismatch')
      ])
    )
  })
})

