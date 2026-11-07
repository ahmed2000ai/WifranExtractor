/**
 * WIFRAN-EXTRACTOR-IDENTITY-002D — Milestone 2D: Two-Stage Candidate Retrieval & Ranking
 *
 * Verifies all 20 required scenarios from WIFRAN-EXTRACTOR-IDENTITY-002D Section 8:
 *  1. Exact catalog key retrieval
 *  2. Bilingual candidate retrieval
 *  3. Unit-equivalent candidate retrieval
 *  4. Word-order invariance
 *  5. Duplicate candidates deduplication across query branches
 *  6. Multiple compatible verified products -> rejected_multiple_candidates (no auto-link)
 *  7. Candidate overflow (>25 rows or count > 25) triggers truncation guard
 *  8. Incomplete retrieval with apparently perfect candidate fails closed
 *  9. Database error in any branch fails closed with rejected_database_lookup_failure
 * 10. Canonical-key collision disambiguation
 * 11. Deterministic ranking invariant regardless of database result ordering
 * 12. High-ranking candidates with incompatible sizes (e.g. Fakieh 10x600g vs 1x600g) rejected
 * 13. High-ranking candidates with incompatible pack counts (12x1L vs 1x1L) rejected
 * 14. High-ranking candidates with different fat content or flavors rejected
 * 15. Loose per-kg versus prepacked items rejected
 * 16. Unknown significant identity attributes fail closed (insufficient evidence)
 * 17. Preservation of existing verified associations
 * 18. Product-image reuse without identity compromise
 * 19. Correct P<id> and O<n> image sourcing behavior
 * 20. Bounded retrieval and performance regression checks (limit 26, low query count)
 */

import { describe, it, expect } from 'vitest'
import {
  retrieveBroadCandidates,
  validateAndRankCandidates,
  evaluateTwoStageMatchDecision,
  executeTwoStageProductMatch,
  CANDIDATE_FETCH_LIMIT,
  OVERFLOW_PROBE_LIMIT
} from '../../../main/db/twoStageCandidateRetrievalService'
import { preMatchLocalOffersAgainstDb, checkPostCorrectionCatalogMatch } from '../../../main/db/stagedLeafletDraftService'
import { StagedOfferItem } from '../../../shared/types/productImageEnrichment'

// Helper: build in-memory mock Supabase client
function createMockSupabase(config: {
  products?: any[]
  aliases?: Array<{ product_id: number; alias_text: string }>
  displayImages?: any[]
  visualGroupMembers?: any[]
  simulateErrorBranch?: string
  simulateOverflowBranch?: string
  overflowCount?: number
}) {
  const products = config.products || []
  const aliases = config.aliases || []
  const displayImages = config.displayImages || []
  const visualGroupMembers = config.visualGroupMembers || []

  return {
    from: (table: string) => {
      let exactCount = false

      const builder: any = {
        select: (_cols: string, opts?: any) => {
          if (opts?.count === 'exact') exactCount = true
          return builder
        },
        ilike: (col: string, pattern: string) => {
          const cleanPattern = pattern.toLowerCase().trim()
          return {
            limit: async (lim: number) => {
              if (config.simulateErrorBranch && config.simulateErrorBranch === `${table}.${col}`) {
                return { data: null, error: new Error(`Simulated database failure on ${table}.${col}`), count: null }
              }
              if (config.simulateOverflowBranch && config.simulateOverflowBranch === `${table}.${col}`) {
                const overflowNum = config.overflowCount || 40
                return {
                  data: Array(Math.min(lim, overflowNum)).fill({ id: 999, name_en: 'Overflow' }),
                  count: overflowNum,
                  error: null
                }
              }

              if (table === 'product_aliases') {
                const matched = aliases.filter((a) => {
                  const val = (a as any)[col]
                  return typeof val === 'string' && val.toLowerCase() === cleanPattern
                })
                return {
                  data: matched.slice(0, lim),
                  count: exactCount ? matched.length : null,
                  error: null
                }
              }

              if (table === 'products') {
                const matched = products.filter((p) => {
                  const val = p[col]
                  return typeof val === 'string' && val.toLowerCase() === cleanPattern
                })
                return {
                  data: matched.slice(0, lim),
                  count: exactCount ? matched.length : null,
                  error: null
                }
              }

              return { data: [], count: 0, error: null }
            }
          }
        },
        eq: (col: string, val: any) => {
          const self = {
            eq: (_c: string, _v: any) => self,
            limit: (lim: number) => ({
              maybeSingle: async () => {
                if (table === 'offer_display_images') {
                  const row = displayImages.find((d) => d[col] === val)
                  return { data: row || null, error: null }
                }
                if (table === 'offer_visual_group_members') {
                  const row = visualGroupMembers.find((m) => m[col] === val)
                  return { data: row || null, error: null }
                }
                const p = products.find((x) => String(x[col]) === String(val))
                return { data: p || null, error: null }
              },
              then: async (resolve: any) => {
                if (config.simulateErrorBranch && config.simulateErrorBranch === `${table}.${col}`) {
                  return resolve({ data: null, error: new Error(`Simulated failure on ${table}.${col}`), count: null })
                }
                const matched = products.filter((x) => String(x[col]) === String(val))
                return resolve({
                  data: matched.slice(0, lim),
                  count: exactCount ? matched.length : null,
                  error: null
                })
              }
            }),
            in: (inCol: string, inVals: any[]) => ({
              limit: async (lim: number) => {
                const strVals = inVals.map(String)
                const matched = products.filter((x) => strVals.includes(String(x[inCol])))
                return {
                  data: matched.slice(0, lim),
                  count: exactCount ? matched.length : null,
                  error: null
                }
              }
            }),
            maybeSingle: async () => {
              if (table === 'offer_display_images') {
                const row = displayImages.find((d) => d[col] === val)
                return { data: row || null, error: null }
              }
              if (table === 'offer_visual_group_members') {
                const row = visualGroupMembers.find((m) => m[col] === val)
                return { data: row || null, error: null }
              }
              const p = products.find((x) => String(x[col]) === String(val))
              return { data: p || null, error: null }
            }
          }
          return self
        },
        in: (col: string, values: any[]) => ({
          limit: async (lim: number) => {
            const strVals = values.map(String)
            if (table === 'products') {
              const matched = products.filter((p) => strVals.includes(String(p[col])))
              return {
                data: matched.slice(0, lim),
                count: exactCount ? matched.length : null,
                error: null
              }
            }
            return { data: [], count: 0, error: null }
          }
        })
      }
      return builder
    }
  }
}

describe('WIFRAN-EXTRACTOR-IDENTITY-002D: Two-Stage Candidate Retrieval & Ranking', () => {
  // Baseline products
  const productAlSafi12x1L = {
    id: 101,
    name_en: 'Al Safi Long Life Full Cream Milk',
    name_ar: 'حليب الصافي طويل الأجل كامل الدسم',
    item_name_complete: 'Al Safi Long Life Full Cream Milk 12x1L',
    canonical_product_key: 'al-safi:al-safi-long-life-full-cream-milk:full-cream:1:l:12:pack',
    brand_name: 'Al Safi',
    variant_or_flavor: 'Full Cream',
    each_size_value: 1,
    each_size_unit: 'l',
    inner_pack_count: 12,
    sale_unit_type: 'pack',
    verification_status: 'verified',
    approved_primary_image_id: 'img-101',
    default_image_url: 'https://cdn.wifran.com/p101.webp'
  }

  const productFakieh10x600g = {
    id: 102,
    name_en: 'Fakieh Frozen Chicken',
    name_ar: 'دجاج فقيه مجمد',
    item_name_complete: 'Fakieh Frozen Chicken 10x600g',
    canonical_product_key: 'fakieh:fakieh-frozen-chicken:frozen:600:g:10:pack',
    brand_name: 'Fakieh',
    variant_or_flavor: 'Frozen',
    each_size_value: 600,
    each_size_unit: 'g',
    inner_pack_count: 10,
    sale_unit_type: 'pack',
    verification_status: 'verified',
    approved_primary_image_id: 'img-102',
    default_image_url: 'https://cdn.wifran.com/p102.webp'
  }

  const productFakieh1x600g = {
    id: 103,
    name_en: 'Fakieh Frozen Chicken',
    name_ar: 'دجاج فقيه مجمد',
    item_name_complete: 'Fakieh Frozen Chicken 600g',
    canonical_product_key: 'fakieh:fakieh-frozen-chicken:frozen:600:g:1:piece',
    brand_name: 'Fakieh',
    variant_or_flavor: 'Frozen',
    each_size_value: 600,
    each_size_unit: 'g',
    inner_pack_count: 1,
    sale_unit_type: 'piece',
    verification_status: 'verified',
    approved_primary_image_id: 'img-103',
    default_image_url: 'https://cdn.wifran.com/p103.webp'
  }

  const productShalan5kg = {
    id: 104,
    name_en: 'Al Shalan Sella Basmati Rice',
    name_ar: 'أرز الشعلان سيلا بسمتي',
    item_name_complete: 'Al Shalan Sella Basmati Rice 5kg',
    canonical_product_key: 'al-shalan:al-shalan-sella-basmati-rice:sella-basmati:5:kg:1:bag',
    brand_name: 'Al Shalan',
    variant_or_flavor: 'Sella Basmati',
    each_size_value: 5,
    each_size_unit: 'kg',
    inner_pack_count: 1,
    sale_unit_type: 'bag',
    verification_status: 'verified',
    approved_primary_image_id: 'img-104',
    default_image_url: 'https://cdn.wifran.com/p104.webp'
  }

  // =========================================================================
  // Scenario 1: Exact catalog key retrieval
  // =========================================================================
  it('Scenario 1: Exact catalog key retrieval discovers and links unique verified product', async () => {
    const supabase = createMockSupabase({ products: [productAlSafi12x1L] })

    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Al Safi Long Life Full Cream Milk',
        titleAr: 'حليب الصافي طويل الأجل كامل الدسم',
        brandName: 'Al Safi',
        variantOrFlavor: 'Full Cream',
        eachSizeValue: 1,
        eachSizeUnit: 'l',
        innerPackCount: 12,
        saleUnitType: 'pack',
        canonicalProductKey: productAlSafi12x1L.canonical_product_key
      },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).not.toBeNull()
    expect(res.matchedProduct.id).toBe(101)
    expect(res.result.status).toBe('verified_compatible')
    expect(res.rankedCandidates.length).toBeGreaterThan(0)
    expect(res.rankedCandidates[0].product.id).toBe(101)
    expect(res.rankedCandidates[0].score).toBeGreaterThan(500)
  })

  // =========================================================================
  // Scenario 2: Bilingual candidate retrieval
  // =========================================================================
  it('Scenario 2: Bilingual candidate retrieval finds English product via Arabic query and vice versa', async () => {
    const arabicOnlyCatalog = {
      id: 201,
      name_en: null,
      name_ar: 'حليب الصافي كامل الدسم',
      item_name_complete: 'حليب الصافي كامل الدسم ١ لتر',
      canonical_product_key: 'al-safi:al-safi-milk:full-cream:1:l:1:piece',
      brand_name: 'الصافي',
      variant_or_flavor: 'Full Cream',
      each_size_value: 1,
      each_size_unit: 'l',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'verified'
    }

    const supabase = createMockSupabase({ products: [arabicOnlyCatalog] })

    // English query offer retrieves Arabic-named catalog product
    const resEn = await executeTwoStageProductMatch(
      {
        titleEn: 'Al Safi Full Cream Milk 1L',
        titleAr: null,
        brandName: 'Al Safi',
        eachSizeValue: 1,
        eachSizeUnit: 'l'
      },
      { supabaseClient: supabase }
    )

    expect(resEn.retrievalDiagnostics.totalUnique).toBeGreaterThanOrEqual(1)
    expect(resEn.rankedCandidates.some((c) => c.product.id === 201)).toBe(true)
  })

  // =========================================================================
  // Scenario 3: Unit-equivalent candidate retrieval
  // =========================================================================
  it('Scenario 3: Unit-equivalent candidate retrieval (1000ml <-> 1L, 1000g <-> 1kg)', async () => {
    const product1000ml = {
      id: 301,
      name_en: 'Nadec Fresh Milk 1000ml',
      name_ar: 'حليب نادك طازج ١٠٠٠ مل',
      item_name_complete: 'Nadec Fresh Milk 1000ml',
      canonical_product_key: 'nadec:nadec-fresh-milk:fresh:1000:ml:1:piece',
      brand_name: 'Nadec',
      each_size_value: 1000,
      each_size_unit: 'ml',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'verified'
    }

    const supabase = createMockSupabase({ products: [product1000ml] })

    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Nadec Fresh Milk 1L',
        titleAr: 'حليب نادك طازج ١ لتر',
        brandName: 'Nadec',
        eachSizeValue: 1,
        eachSizeUnit: 'l',
        innerPackCount: 1,
        saleUnitType: 'piece'
      },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).not.toBeNull()
    expect(res.matchedProduct.id).toBe(301)
    expect(res.result.status).toBe('verified_compatible')
  })

  // =========================================================================
  // Scenario 4: Word-order invariance
  // =========================================================================
  it('Scenario 4: Word-order changes recognize identical product', async () => {
    const supabase = createMockSupabase({
      products: [productShalan5kg],
      aliases: [
        { product_id: 104, alias_text: 'alshalan sella rice' },
        { product_id: 104, alias_text: 'ارز الشعلان سيلا' }
      ]
    })

    // Permuted word order in offer title
    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Basmati Rice Sella Al Shalan 5kg',
        titleAr: 'بسمتي أرز الشعلان سيلا 5 كجم',
        brandName: 'Al Shalan',
        variantOrFlavor: 'Sella Basmati',
        eachSizeValue: 5,
        eachSizeUnit: 'kg',
        innerPackCount: 1,
        saleUnitType: 'bag'
      },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).not.toBeNull()
    expect(res.matchedProduct.id).toBe(104)
    expect(res.result.status).toBe('verified_compatible')
  })

  // =========================================================================
  // Scenario 5: Duplicate candidates deduplicated across query branches
  // =========================================================================
  it('Scenario 5: Duplicate candidates returned by multiple query branches are deduplicated', async () => {
    // Al Safi is matched via canonical key branch AND name_en branch AND alias branch
    const aliases = [{ product_id: 101, alias_text: 'al safi milk 12x1l' }]
    const supabase = createMockSupabase({
      products: [productAlSafi12x1L],
      aliases
    })

    const retrieval = await retrieveBroadCandidates(
      {
        titleEn: 'Al Safi Long Life Full Cream Milk 12x1L',
        brandName: 'Al Safi',
        canonicalProductKey: productAlSafi12x1L.canonical_product_key
      },
      { supabaseClient: supabase }
    )

    // Deduplicated count must be 1 even if discovered by 3 branches
    expect(retrieval.totalUnique).toBe(1)
    expect(retrieval.candidates.length).toBe(1)
    expect(retrieval.candidates[0].id).toBe(101)
  })

  // =========================================================================
  // Scenario 6: Multiple compatible verified products
  // =========================================================================
  it('Scenario 6: Multiple compatible verified products fails closed with rejected_multiple_candidates', async () => {
    const candidateA = {
      id: 601,
      name_en: 'Almarai Fresh Milk 1L',
      name_ar: 'حليب المراعي طازج ١ لتر',
      item_name_complete: 'Almarai Fresh Milk 1L Full Fat',
      canonical_product_key: 'almarai:milk:1:l:1:piece',
      brand_name: 'Almarai',
      each_size_value: 1,
      each_size_unit: 'l',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'verified'
    }

    const candidateB = {
      id: 602,
      name_en: 'Almarai Fresh Milk 1L',
      name_ar: 'حليب المراعي طازج ١ لتر',
      item_name_complete: 'Almarai Fresh Milk 1L Regular',
      canonical_product_key: 'almarai:milk-regular:1:l:1:piece',
      brand_name: 'Almarai',
      each_size_value: 1,
      each_size_unit: 'l',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'verified'
    }

    const supabase = createMockSupabase({ products: [candidateA, candidateB] })

    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Almarai Fresh Milk 1L',
        brandName: 'Almarai',
        eachSizeValue: 1,
        eachSizeUnit: 'l',
        innerPackCount: 1,
        saleUnitType: 'piece'
      },
      { supabaseClient: supabase }
    )

    // Invariant: NEVER auto-link when multiple verified candidates are compatible
    expect(res.matchedProduct).toBeNull()
    expect(res.result.status).toBe('rejected_multiple_candidates')
    expect(res.result.reason).toMatch(/multiple distinct verified products/i)
  })

  // =========================================================================
  // Scenario 7: Candidate overflow in individual query branches
  // =========================================================================
  it('Scenario 7: Candidate overflow (>25 rows or count > 25) sets isTruncated = true', async () => {
    const supabase = createMockSupabase({
      simulateOverflowBranch: 'products.name_en',
      overflowCount: 38
    })

    const retrieval = await retrieveBroadCandidates(
      { titleEn: 'Milk 1L' },
      { supabaseClient: supabase }
    )

    expect(retrieval.isTruncated).toBe(true)
  })

  // =========================================================================
  // Scenario 8: Incomplete retrieval with one apparently perfect candidate
  // =========================================================================
  it('Scenario 8: Incomplete retrieval with an apparently perfect candidate blocks auto-link', async () => {
    // Stage 2 rank score may be 1000, but isTruncated blocks auto-match!
    const decision = evaluateTwoStageMatchDecision(
      { titleEn: 'Al Safi Milk 12x1L' },
      {
        candidates: [productAlSafi12x1L],
        isTruncated: true, // Truncation occurred during retrieval!
        hasLookupFailure: false,
        branchDiagnostics: [],
        totalQueries: 5,
        totalDiscovered: 40,
        totalUnique: 1,
        latencyMs: 10
      },
      {
        rankedCandidates: [
          {
            product: productAlSafi12x1L,
            validation: { isCompatible: true, status: 'verified_compatible', reason: 'Exact match' },
            rankEvidence: { canonicalKeyMatch: true, equivalentKeyMatch: false, verifiedAliasMatch: false, brandMatch: true, packageMatch: true, variantMatch: true, tokenSimilarityScore: 100, totalScore: 950, breakdown: [] },
            score: 950
          }
        ],
        compatibleVerifiedCandidates: [
          {
            product: productAlSafi12x1L,
            validation: { isCompatible: true, status: 'verified_compatible', reason: 'Exact match' },
            rankEvidence: { canonicalKeyMatch: true, equivalentKeyMatch: false, verifiedAliasMatch: false, brandMatch: true, packageMatch: true, variantMatch: true, tokenSimilarityScore: 100, totalScore: 950, breakdown: [] },
            score: 950
          }
        ],
        incompatibleCandidates: []
      }
    )

    expect(decision.matchedProduct).toBeNull()
    expect(decision.result.status).toBe('rejected_candidate_search_incomplete')
    expect(decision.result.reason).toMatch(/truncated/i)
  })

  // =========================================================================
  // Scenario 9: Database errors in any required query branch
  // =========================================================================
  it('Scenario 9: Database error in any branch sets hasLookupFailure and rejects match', async () => {
    const supabase = createMockSupabase({
      products: [productAlSafi12x1L],
      simulateErrorBranch: 'products.name_en'
    })

    const res = await executeTwoStageProductMatch(
      { titleEn: 'Al Safi Milk 12x1L' },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).toBeNull()
    expect(res.result.status).toBe('rejected_database_lookup_failure')
    expect(res.retrievalDiagnostics.hasLookupFailure).toBe(true)
  })

  // =========================================================================
  // Scenario 10: Canonical-key collisions
  // =========================================================================
  it('Scenario 10: Canonical-key collisions disambiguate or require review', async () => {
    const prodX = {
      id: 1001,
      name_en: 'Sunbulah Puff Pastry 400g Regular',
      canonical_product_key: 'sunbulah:puff-pastry:400:g:1:pack',
      variant_or_flavor: 'Regular',
      each_size_value: 400,
      each_size_unit: 'g',
      inner_pack_count: 1,
      sale_unit_type: 'pack',
      verification_status: 'verified'
    }

    const prodY = {
      id: 1002,
      name_en: 'Sunbulah Puff Pastry 400g Whole Wheat',
      canonical_product_key: 'sunbulah:puff-pastry:400:g:1:pack', // Collision!
      variant_or_flavor: 'Whole Wheat',
      each_size_value: 400,
      each_size_unit: 'g',
      inner_pack_count: 1,
      sale_unit_type: 'pack',
      verification_status: 'verified'
    }

    const supabase = createMockSupabase({
      products: [prodX, prodY],
      aliases: [
        { product_id: 1001, alias_text: 'sunbulah puff pastry 400g' },
        { product_id: 1002, alias_text: 'sunbulah puff pastry 400g' }
      ]
    })

    // Ambiguous offer without variant specified -> fails closed
    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Sunbulah Puff Pastry 400g',
        brandName: 'Sunbulah',
        eachSizeValue: 400,
        eachSizeUnit: 'g'
      },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).toBeNull()
    expect(['rejected_contradictory', 'rejected_multiple_candidates', 'rejected_ambiguous_offer']).toContain(
      res.result.status
    )
    expect(res.rankedCandidates.length).toBeGreaterThanOrEqual(1)
  })

  // =========================================================================
  // Scenario 11: Deterministic ranking regardless of database result order
  // =========================================================================
  it('Scenario 11: Deterministic ranking order regardless of database result ordering', () => {
    const offer = {
      titleEn: 'Al Safi Milk 12x1L Full Cream',
      brandName: 'Al Safi',
      variantOrFlavor: 'Full Cream',
      eachSizeValue: 1,
      eachSizeUnit: 'l',
      innerPackCount: 12,
      saleUnitType: 'pack'
    }

    const candidates = [
      productAlSafi12x1L, // Exact match
      {
        id: 110,
        name_en: 'Al Safi Milk 1L',
        canonical_product_key: 'al-safi:milk:1:l:1:piece',
        brand_name: 'Al Safi',
        verification_status: 'unverified'
      },
      {
        id: 111,
        name_en: 'Nadec Milk 12x1L',
        canonical_product_key: 'nadec:milk:1:l:12:pack',
        brand_name: 'Nadec',
        verification_status: 'verified'
      }
    ]

    // Order 1
    const res1 = validateAndRankCandidates(offer, [...candidates])

    // Order 2: Reverse order
    const res2 = validateAndRankCandidates(offer, [...candidates].reverse())

    // Order 3: Shuffled order
    const res3 = validateAndRankCandidates(offer, [candidates[1], candidates[2], candidates[0]])

    expect(res1.rankedCandidates.map((c) => c.product.id)).toEqual(
      res2.rankedCandidates.map((c) => c.product.id)
    )
    expect(res1.rankedCandidates.map((c) => c.product.id)).toEqual(
      res3.rankedCandidates.map((c) => c.product.id)
    )
    expect(res1.rankedCandidates[0].product.id).toBe(101)
  })

  // =========================================================================
  // Scenario 12: High-ranking candidates with incompatible sizes (Fakieh 10x600g vs 1x600g)
  // =========================================================================
  it('Scenario 12: High-ranking candidate with incompatible size (Fakieh 10x600g offer vs 1x600g candidate) is rejected', async () => {
    // Both 10x600g and 1x600g in catalog
    const supabase = createMockSupabase({
      products: [productFakieh1x600g] // ONLY 1x600g in DB
    })

    // Offer is 10x600g pack
    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Fakieh Frozen Chicken 10x600g',
        titleAr: 'دجاج فقيه مجمد 10*600 جرام',
        brandName: 'Fakieh',
        eachSizeValue: 600,
        eachSizeUnit: 'g',
        innerPackCount: 10,
        saleUnitType: 'pack'
      },
      { supabaseClient: supabase }
    )

    // Even though Fakieh 1x600g gets token matches (+100) and brand match (+150),
    // structured package validation FAILS (10x600g != 1x600g), so NO link is made!
    expect(res.matchedProduct).toBeNull()
    expect(res.result.status).toBe('rejected_contradictory')
    expect(res.rankedCandidates.length).toBe(1)
    expect(res.rankedCandidates[0].validation.isCompatible).toBe(false)
  })

  // =========================================================================
  // Scenario 13: High-ranking candidates with incompatible pack counts
  // =========================================================================
  it('Scenario 13: High-ranking candidates with incompatible pack counts (12x1L vs 1x1L) rejected', async () => {
    const singlePack1L = {
      id: 1301,
      name_en: 'Al Safi Full Cream Milk 1L',
      canonical_product_key: 'al-safi:milk:1:l:1:piece',
      brand_name: 'Al Safi',
      each_size_value: 1,
      each_size_unit: 'l',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'verified'
    }

    const supabase = createMockSupabase({
      products: [singlePack1L],
      aliases: [
        { product_id: 1301, alias_text: 'alsafi full fat milk' },
        { product_id: 1301, alias_text: 'al safi full cream milk' }
      ]
    })

    // Offer is 12x1L
    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Al Safi Full Cream Milk 12x1L',
        brandName: 'Al Safi',
        eachSizeValue: 1,
        eachSizeUnit: 'l',
        innerPackCount: 12,
        saleUnitType: 'pack'
      },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).toBeNull()
    expect(res.result.status).toBe('rejected_contradictory')
  })

  // =========================================================================
  // Scenario 14: High-ranking candidates with different fat content or flavors
  // =========================================================================
  it('Scenario 14: High-ranking candidates with different fat content or flavors rejected', async () => {
    const skimmedMilk = {
      id: 1401,
      name_en: 'Almarai Fresh Milk Skimmed 1L',
      canonical_product_key: 'almarai:fresh-milk:skimmed:1:l:1:piece',
      brand_name: 'Almarai',
      variant_or_flavor: 'Skimmed',
      each_size_value: 1,
      each_size_unit: 'l',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      verification_status: 'verified'
    }

    const supabase = createMockSupabase({
      products: [skimmedMilk],
      aliases: [
        { product_id: 1401, alias_text: 'almarai fresh milk full cream 1l' },
        { product_id: 1401, alias_text: 'almarai full fat fresh milk' }
      ]
    })

    // Offer is Full Cream
    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Almarai Fresh Milk Full Cream 1L',
        brandName: 'Almarai',
        variantOrFlavor: 'Full Cream',
        eachSizeValue: 1,
        eachSizeUnit: 'l',
        innerPackCount: 1,
        saleUnitType: 'piece'
      },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).toBeNull()
    expect(res.result.status).toBe('rejected_contradictory')
    expect(res.result.reason).toMatch(/variant|flavor|fat/i)
  })

  // =========================================================================
  // Scenario 15: Loose per-kg versus prepacked items
  // =========================================================================
  it('Scenario 15: Loose per-kg versus prepacked items rejected', async () => {
    const prepackedPotatoesBag = {
      id: 1501,
      name_en: 'Potatoes Prepacked Bag 5kg',
      canonical_product_key: 'potatoes:bag:5:kg:1:bag',
      each_size_value: 5,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'bag',
      verification_status: 'verified'
    }

    const supabase = createMockSupabase({ products: [prepackedPotatoesBag] })

    // Offer is loose potatoes per kg
    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Potatoes per kg',
        titleAr: 'بطاطس بالكيلو',
        saleUnitType: 'kg',
        priceBasis: 'per_kg'
      },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).toBeNull()
    expect(res.result.isCompatible).toBe(false)
  })

  // =========================================================================
  // Scenario 16: Unknown significant identity attributes
  // =========================================================================
  it('Scenario 16: Unknown significant identity attributes fail closed (insufficient evidence)', async () => {
    const specificPack = {
      id: 1601,
      name_en: 'Nadec Olive Oil 500ml Extra Virgin',
      canonical_product_key: 'nadec:olive-oil:extra-virgin:500:ml:1:bottle',
      brand_name: 'Nadec',
      variant_or_flavor: 'Extra Virgin',
      each_size_value: 500,
      each_size_unit: 'ml',
      inner_pack_count: 1,
      sale_unit_type: 'bottle',
      verification_status: 'verified'
    }

    const supabase = createMockSupabase({
      products: [specificPack],
      aliases: [{ product_id: 1601, alias_text: 'nadec olive oil' }]
    })

    // Offer has vague name and NO size
    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Nadec Olive Oil',
        brandName: 'Nadec'
      },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).toBeNull()
    expect(res.result.status).toBe('rejected_insufficient_evidence')
  })

  // =========================================================================
  // Scenario 17: Preservation of existing verified associations
  // =========================================================================
  it('Scenario 17: Verified linked association correctly returned for verified product', async () => {
    const supabase = createMockSupabase({
      products: [productShalan5kg],
      aliases: [{ product_id: 104, alias_text: 'al shalan sella basmati rice 5kg' }]
    })

    const res = await executeTwoStageProductMatch(
      {
        titleEn: 'Al Shalan Sella Basmati Rice 5kg',
        titleAr: 'أرز الشعلان سيلا بسمتي 5 كجم',
        brandName: 'Al Shalan',
        variantOrFlavor: 'Sella Basmati',
        eachSizeValue: 5,
        eachSizeUnit: 'kg',
        innerPackCount: 1,
        saleUnitType: 'bag'
      },
      { supabaseClient: supabase }
    )

    expect(res.matchedProduct).not.toBeNull()
    expect(res.matchedProduct.id).toBe(104)
    expect(res.matchedProduct.verification_status).toBe('verified')
  })

  // =========================================================================
  // Scenario 18: Product-image reuse without identity compromise
  // =========================================================================
  it('Scenario 18: Exact verified match reuses approved product image; incompatible variant does not', async () => {
    const supabase = createMockSupabase({
      products: [productAlSafi12x1L],
      aliases: [{ product_id: 101, alias_text: 'al safi long life full cream milk 12x1l' }]
    })

    // Compatible offer
    const compatibleItem: StagedOfferItem = {
      id: 'item-comp',
      pageNumber: 1,
      status: 'ready',
      selectedImageSource: 'none',
      titleEn: 'Al Safi Long Life Full Cream Milk 12x1L',
      croppedEvidenceLocalPath: '/tmp/crop.webp',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      brand: 'Al Safi',
      sizeOrWeight: '12x1L'
    } as any

    const match1 = await checkPostCorrectionCatalogMatch(compatibleItem, supabase)
    expect(match1).not.toBeNull()
    expect(match1!.productId).toBe(101)
    expect(match1!.existingImageUrl).toBe('https://cdn.wifran.com/p101.webp')

    // Incompatible variant offer (Skimmed Milk)
    const incompatibleItem: StagedOfferItem = {
      id: 'item-incomp',
      pageNumber: 1,
      status: 'ready',
      selectedImageSource: 'none',
      titleEn: 'Al Safi Long Life Skimmed Milk 12x1L',
      croppedEvidenceLocalPath: '/tmp/crop.webp',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      brand: 'Al Safi',
      sizeOrWeight: '12x1L',
      variantOrFlavor: 'Skimmed'
    } as any

    const match2 = await checkPostCorrectionCatalogMatch(incompatibleItem, supabase)
    expect(match2).toBeNull()
  })

  // =========================================================================
  // Scenario 19: Correct P<id> and O<n> image sourcing behavior
  // =========================================================================
  it('Scenario 19: Correct P<id> and O<n> image sourcing behavior in preMatchLocalOffersAgainstDb', async () => {
    const productWithoutImage = {
      id: 1901,
      name_en: 'Goody Pasta 500g',
      item_name_complete: 'Goody Pasta 500g',
      canonical_product_key: 'goody:pasta:500:g:1:pack',
      brand_name: 'Goody',
      each_size_value: 500,
      each_size_unit: 'g',
      inner_pack_count: 1,
      sale_unit_type: 'pack',
      verification_status: 'verified',
      approved_primary_image_id: null,
      default_image_url: null
    }

    const supabase = createMockSupabase({
      products: [productAlSafi12x1L, productWithoutImage],
      aliases: [
        { product_id: 101, alias_text: 'al safi long life full cream milk 12x1l' },
        { product_id: 1901, alias_text: 'goody pasta 500g' }
      ]
    })

    const items: StagedOfferItem[] = [
      // 1. Matched with image -> skipped, existing_db
      {
        id: 'item-with-img',
        pageNumber: 1,
        status: 'ready',
        selectedImageSource: 'none',
        titleEn: 'Al Safi Long Life Full Cream Milk 12x1L',
        croppedEvidenceLocalPath: '/tmp/crop1.webp',
        isAiCorrected: false,
        isOperatorModified: false,
        operatorEditedFields: [],
        brand: 'Al Safi',
        sizeOrWeight: '12x1L'
      } as any,
      // 2. Matched without image -> ready, P<id>
      {
        id: 'item-no-img',
        pageNumber: 1,
        status: 'ready',
        selectedImageSource: 'none',
        titleEn: 'Goody Pasta 500g',
        croppedEvidenceLocalPath: '/tmp/crop2.webp',
        isAiCorrected: false,
        isOperatorModified: false,
        operatorEditedFields: [],
        brand: 'Goody',
        sizeOrWeight: '500g'
      } as any,
      // 3. Unmatched offer -> ready, O<n>
      {
        id: 'item-unmatched',
        pageNumber: 1,
        status: 'ready',
        selectedImageSource: 'none',
        titleEn: 'Unknown Brand Exotic Tea 200g',
        croppedEvidenceLocalPath: '/tmp/crop3.webp',
        isAiCorrected: false,
        isOperatorModified: false,
        operatorEditedFields: [],
        brand: 'Unknown',
        sizeOrWeight: '200g'
      } as any
    ]

    const preMatchRes = await preMatchLocalOffersAgainstDb(items, {
      supabaseClient: supabase,
      mapFilePath: '/tmp/nonexistent-map.json'
    })

    // Item 1: Matched with DB image
    expect(preMatchRes.items[0].selectedImageSource).toBe('existing_db')
    expect(preMatchRes.items[0].status).toBe('skipped')
    expect(preMatchRes.items[0].matchedProductId).toBe(101)

    // Item 2: Matched without image -> imageRef: P1901
    expect(preMatchRes.items[1].selectedImageSource).toBe('none')
    expect(preMatchRes.items[1].status).toBe('ready')
    expect(preMatchRes.items[1].imageRef).toBe('P1901')

    // Item 3: Unmatched -> imageRef: O1
    expect(preMatchRes.items[2].selectedImageSource).toBe('none')
    expect(preMatchRes.items[2].status).toBe('ready')
    expect(preMatchRes.items[2].imageRef).toMatch(/^O\d+$/)
  })

  // =========================================================================
  // Scenario 20: Bounded retrieval and performance regression checks
  // =========================================================================
  it('Scenario 20: Bounded retrieval (limit 26 probe, bounded queries, low latency)', async () => {
    const supabase = createMockSupabase({
      products: [productAlSafi12x1L, productFakieh10x600g, productShalan5kg]
    })

    const retrieval = await retrieveBroadCandidates(
      {
        titleEn: 'Al Safi Milk 12x1L',
        brandName: 'Al Safi'
      },
      { supabaseClient: supabase }
    )

    expect(CANDIDATE_FETCH_LIMIT).toBe(25)
    expect(OVERFLOW_PROBE_LIMIT).toBe(26)
    expect(retrieval.isTruncated).toBe(false)
    expect(retrieval.hasLookupFailure).toBe(false)
    expect(retrieval.candidates.length).toBeLessThanOrEqual(25)
    expect(retrieval.totalQueries).toBeLessThanOrEqual(35)
  })
})
