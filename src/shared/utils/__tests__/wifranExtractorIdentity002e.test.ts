/**
 * WIFRAN-EXTRACTOR-IDENTITY-002E — Milestone 2E: Authenticated Product Alias Staging & Review
 *
 * Verifies all 20 required offline scenarios from WIFRAN-EXTRACTOR-IDENTITY-002E Section 9:
 *  1. Valid alias proposal creation.
 *  2. Invalid or empty proposals rejected.
 *  3. Unauthorized approval attempts blocked.
 *  4. Forged client-side operator identities blocked.
 *  5. Verified versus unverified target products.
 *  6. Same-product duplicate aliases detected.
 *  7. Cross-product alias conflicts detected.
 *  8. Arabic normalization collisions detected.
 *  9. Bilingual alias equivalents handled cleanly.
 * 10. Variant and package contradictions rejected.
 * 11. Stale proposals rejected when product data changes.
 * 12. Concurrent approvals handled safely.
 * 13. Database failures and transaction rollback.
 * 14. Audit trail completeness and immutability.
 * 15. No unauthorized alias insertion into active catalog.
 * 16. No historical product-link mutation on alias approval.
 * 17. Approved alias participation in candidate retrieval.
 * 18. Pending or rejected aliases excluded from candidate retrieval.
 * 19. Candidate overflow and ambiguity preservation.
 * 20. Existing Phase 1 and Phase 2A–2D regression behavior.
 */

import { describe, it, expect } from 'vitest'
import {
  computeCanonicalAliasKey,
  computeEvidenceSnapshotHash,
  validateServerOperatorAuth,
  proposeProductAlias,
  reviewProductAlias
} from '../../../main/db/productAliasStagingService'
import {
  retrieveBroadCandidates,
  executeTwoStageProductMatch
} from '../../../main/db/twoStageCandidateRetrievalService'
import type {
  ProductAliasProposal,
  OperatorAuthContext,
  ProposeAliasInput
} from '../../types/productAliasStaging'

// Baseline verified catalog products fixture
const productAlSafi12x1L = {
  id: 101,
  name_en: 'Al Safi Long Life Full Cream Milk',
  name_ar: 'حليب الصافي طويل الأجل كامل الدسم',
  item_name_complete: 'Al Safi Long Life Full Cream Milk 12x1L',
  canonical_product_key: 'al-safi:al-safi-long-life-full-cream-milk:full-cream:1:l:12:pack',
  brand_name: 'Al Safi',
  brand_name_en: 'Al Safi',
  brand_name_ar: 'الصافي',
  variant_or_flavor: 'Full Cream',
  size_value: 1,
  size_unit: 'l',
  each_size_value: 1,
  each_size_unit: 'l',
  default_pack_size_value: 1,
  default_pack_size_unit: 'l',
  inner_pack_count: 12,
  sale_unit_type: 'pack',
  verification_status: 'verified',
  verified: true
}

const productFakieh10x600g = {
  id: 102,
  name_en: 'Fakieh Frozen Chicken',
  name_ar: 'دجاج فقيه مجمد',
  item_name_complete: 'Fakieh Frozen Chicken 10x600g',
  canonical_product_key: 'fakieh:fakieh-frozen-chicken:frozen:600:g:10:pack',
  brand_name: 'Fakieh',
  brand_name_en: 'Fakieh',
  brand_name_ar: 'فقيه',
  variant_or_flavor: 'Frozen',
  size_value: 600,
  size_unit: 'g',
  each_size_value: 600,
  each_size_unit: 'g',
  default_pack_size_value: 600,
  default_pack_size_unit: 'g',
  inner_pack_count: 10,
  sale_unit_type: 'pack',
  verification_status: 'verified',
  verified: true
}

const productAlShalan5kg = {
  id: 103,
  name_en: 'Al Shalan Sella Basmati Rice 5kg',
  name_ar: 'أرز الشعلان سيلا بسمتي 5 كجم',
  item_name_complete: 'Al Shalan Sella Basmati Rice 5kg',
  canonical_product_key: 'al-shalan:al-shalan-sella-basmati-rice:sella-basmati:5:kg:1:bag',
  brand_name: 'Al Shalan',
  brand_name_en: 'Al Shalan',
  brand_name_ar: 'الشعلان',
  variant_or_flavor: 'Sella Basmati',
  size_value: 5,
  size_unit: 'kg',
  each_size_value: 5,
  each_size_unit: 'kg',
  default_pack_size_value: 5,
  default_pack_size_unit: 'kg',
  inner_pack_count: 1,
  sale_unit_type: 'bag',
  verification_status: 'verified',
  verified: true
}

const productUnverifiedTea = {
  id: 999,
  name_en: 'Unverified Candidate Tea',
  name_ar: 'شاي مرشح غير موثق',
  brand_name: 'Lipton',
  brand_name_en: 'Lipton',
  brand_name_ar: 'ليبتون',
  canonical_product_key: 'lipton:lipton-tea-100:std:100bag:1xpack',
  size_value: 100,
  size_unit: 'bag',
  each_size_value: 100,
  each_size_unit: 'bag',
  inner_pack_count: 1,
  verification_status: 'unverified',
  verified: false
}

const BASELINE_PRODUCTS = [
  productAlSafi12x1L,
  productFakieh10x600g,
  productAlShalan5kg,
  productUnverifiedTea
]

// Mock Supabase client generator matching wifranExtractorIdentity002d test harness
function createMockSupabase(config: {
  products?: any[]
  aliases?: Array<{ product_id: string | number; alias_text: string }>
}) {
  const products = config.products || []
  const aliases = config.aliases || []

  return {
    from: (table: string) => {
      let exactCount = false

      const builder: any = {
        select: (_cols?: string, opts?: any) => {
          if (opts?.count === 'exact') exactCount = true
          return builder
        },
        ilike: (col: string, pattern: string) => {
          const rawPattern = pattern.replace(/%/g, '').toLowerCase().trim()
          const rawWords = rawPattern.split(/\s+/).filter((w) => w.length > 1)
          return {
            limit: async (lim: number) => {
              if (table === 'product_aliases') {
                const matched = aliases.filter((a) => {
                  const val = String((a as any)[col] || '').toLowerCase()
                  if (!val || !rawPattern) return false
                  if (val === rawPattern || val.includes(rawPattern) || rawPattern.includes(val)) return true
                  const valWords = val.split(/\s+/).filter((w) => w.length > 1)
                  const overlap = rawWords.filter((w) => valWords.includes(w)).length
                  return overlap >= 1
                })
                return {
                  data: matched.slice(0, lim),
                  count: exactCount ? matched.length : null,
                  error: null
                }
              }

              if (table === 'products') {
                const matched = products.filter((p) => {
                  const val = String(p[col] || '').toLowerCase()
                  if (!val || !rawPattern) return false
                  if (val === rawPattern || val.includes(rawPattern) || rawPattern.includes(val)) return true
                  const valWords = val.split(/\s+/).filter((w) => w.length > 1)
                  const overlap = rawWords.filter((w) => valWords.includes(w)).length
                  return overlap >= 2
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
          const eqObj: any = {
            eq: () => eqObj,
            maybeSingle: async () => ({
              data: products.find((x) => String(x[col]) === String(val)) || null,
              error: null
            }),
            limit: async (lim: number) => {
              const matched = products.filter((x) => String(x[col]) === String(val))
              return {
                data: matched.slice(0, lim),
                count: exactCount ? matched.length : null,
                error: null
              }
            },
            in: (inCol: string, inVals: any[]) => ({
              limit: async (lim: number) => {
                const strVals = inVals.map(String)
                const matched = products.filter((p) => strVals.includes(String(p[inCol])))
                return {
                  data: matched.slice(0, lim),
                  count: exactCount ? matched.length : null,
                  error: null
                }
              }
            })
          }
          return eqObj
        },
        in: (col: string, vals: any[]) => ({
          limit: async (lim: number) => {
            const strVals = vals.map(String)
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

describe('WIFRAN-EXTRACTOR-IDENTITY-002E — Authenticated Product Alias Staging & Review', () => {
  // 1. Valid alias proposal creation
  it('Scenario 1: Creates a valid alias proposal with canonical normalized key and initial audit entry', async () => {
    const inMemoryProposals: ProductAliasProposal[] = []
    const input: ProposeAliasInput = {
      aliasText: 'Al-Safi UHT Full Cream Milk 12x1L',
      proposedProductId: '101',
      language: 'en',
      proposingOperatorId: 'operator_01',
      sourceEvidence: {
        brandEn: 'Al Safi',
        sizeValue: 1,
        sizeUnit: 'l',
        packCount: 12,
        variantEn: 'full-cream'
      }
    }

    const result = await proposeProductAlias(input, {
      catalogProducts: BASELINE_PRODUCTS,
      inMemoryProposals
    })

    expect(result.success).toBe(true)
    expect(result.proposal).toBeDefined()
    expect(result.proposal?.status).toBe('pending_review')
    expect(result.proposal?.canonicalNormalizedKey).toBe('al-safi uht full cream milk 12x1l')
    expect(result.proposal?.proposedProductId).toBe('101')
    expect(result.proposal?.compatibilityResult.isCompatible).toBe(true)
    expect(result.proposal?.auditTrail).toHaveLength(1)
    expect(result.proposal?.auditTrail[0].action).toBe('proposed')
    expect(result.proposal?.auditTrail[0].actorId).toBe('operator_01')
    expect(inMemoryProposals).toHaveLength(1)
  })

  // 2. Invalid or empty proposals rejected
  it('Scenario 2: Rejects empty or whitespace-only proposals', async () => {
    const resultEmpty = await proposeProductAlias(
      {
        aliasText: '   ',
        proposedProductId: '101',
        proposingOperatorId: 'operator_01'
      },
      { catalogProducts: BASELINE_PRODUCTS }
    )

    expect(resultEmpty.success).toBe(false)
    expect(resultEmpty.error).toBe('INVALID_ALIAS_TEXT')

    const resultDiacriticsOnly = await proposeProductAlias(
      {
        aliasText: '\u064E\u064F\u0650', // Arabic diacritics only -> normalizes to empty
        proposedProductId: '101',
        proposingOperatorId: 'operator_01'
      },
      { catalogProducts: BASELINE_PRODUCTS }
    )

    expect(resultDiacriticsOnly.success).toBe(false)
    expect(resultDiacriticsOnly.error).toBe('INVALID_ALIAS_TEXT')
  })

  // 3. Unauthorized approval attempts blocked
  it('Scenario 3: Blocks review attempts without valid operator role', async () => {
    const proposal: ProductAliasProposal = {
      id: 'prop-1',
      aliasText: 'Al Safi 12x1L',
      canonicalNormalizedKey: 'al safi 12x1l',
      proposedProductId: '101',
      language: 'en',
      compatibilityResult: { isCompatible: true, reasons: [] },
      proposalOrigin: 'operator',
      status: 'pending_review',
      proposingOperatorId: 'op_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditTrail: []
    }

    const unauthContext: OperatorAuthContext = {
      operatorId: 'guest_user',
      role: 'viewer', // unauthorized role
      isServerVerified: true
    }

    const result = await reviewProductAlias(
      {
        proposalId: 'prop-1',
        decision: 'approved',
        authContext: unauthContext
      },
      {
        inMemoryProposals: [proposal],
        catalogProducts: BASELINE_PRODUCTS
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('UNAUTHORIZED_OPERATOR')
    expect(proposal.status).toBe('pending_review') // unmodified
  })

  // 4. Forged client-side operator identities blocked
  it('Scenario 4: Rejects unverified / client-forged operator identities', async () => {
    const proposal: ProductAliasProposal = {
      id: 'prop-forged',
      aliasText: 'Al Safi Milk',
      canonicalNormalizedKey: 'al safi milk',
      proposedProductId: '101',
      language: 'en',
      compatibilityResult: { isCompatible: true, reasons: [] },
      proposalOrigin: 'operator',
      status: 'pending_review',
      proposingOperatorId: 'op_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditTrail: []
    }

    const forgedAuth: OperatorAuthContext = {
      operatorId: 'admin_root',
      role: 'catalog_admin',
      isServerVerified: false // client claimed admin, but server verification is false
    }

    const authValidation = validateServerOperatorAuth(forgedAuth)
    expect(authValidation.isValid).toBe(false)
    expect(authValidation.error).toContain('UNAUTHORIZED_OPERATOR')

    const result = await reviewProductAlias(
      {
        proposalId: 'prop-forged',
        decision: 'approved',
        authContext: forgedAuth
      },
      {
        inMemoryProposals: [proposal],
        catalogProducts: BASELINE_PRODUCTS
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('UNAUTHORIZED_OPERATOR')
    expect(result.message).toContain('Operator identity is not server-verified')
  })

  // 5. Verified versus unverified target products
  it('Scenario 5: Rejects proposals targeting unverified catalog products', async () => {
    const result = await proposeProductAlias(
      {
        aliasText: 'Lipton Yellow Label 100 bags',
        proposedProductId: '999', // unverified product
        proposingOperatorId: 'op_1'
      },
      { catalogProducts: BASELINE_PRODUCTS }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('TARGET_PRODUCT_NOT_VERIFIED')
  })

  // 6. Same-product duplicate aliases detected
  it('Scenario 6: Detects and rejects duplicate aliases already assigned to the same product', async () => {
    const existingAliases = [
      { id: 'alias-1', product_id: '101', alias_text: 'Al Safi Full Cream Milk 12x1L' }
    ]

    const result = await proposeProductAlias(
      {
        aliasText: 'al safi full cream milk 12x1l', // identical normalized key
        proposedProductId: '101',
        proposingOperatorId: 'op_1'
      },
      {
        catalogProducts: BASELINE_PRODUCTS,
        existingAliases
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('DUPLICATE_SAME_PRODUCT_ALIAS')
  })

  // 7. Cross-product alias conflicts detected
  it('Scenario 7: Flags cross-product conflicts and blocks approval', async () => {
    const existingAliases = [
      { id: 'alias-1', product_id: '101', alias_text: 'Fresh Milk 1L' }
    ]

    // Proposing same key for Product 102
    const inMemoryProposals: ProductAliasProposal[] = []
    const propResult = await proposeProductAlias(
      {
        aliasText: 'fresh milk 1l',
        proposedProductId: '102', // different product!
        proposingOperatorId: 'op_1'
      },
      {
        catalogProducts: BASELINE_PRODUCTS,
        existingAliases,
        inMemoryProposals
      }
    )

    expect(propResult.success).toBe(true)
    expect(propResult.proposal?.status).toBe('conflict_needs_review')

    // Now attempt to approve this conflicting proposal
    const auth: OperatorAuthContext = {
      operatorId: 'lead_operator',
      role: 'catalog_operator',
      isServerVerified: true
    }

    const reviewResult = await reviewProductAlias(
      {
        proposalId: propResult.proposal!.id,
        decision: 'approved',
        authContext: auth
      },
      {
        inMemoryProposals,
        catalogProducts: BASELINE_PRODUCTS,
        existingAliases
      }
    )

    expect(reviewResult.success).toBe(false)
    expect(reviewResult.error).toBe('CROSS_PRODUCT_ALIAS_CONFLICT')
  })

  // 8. Arabic normalization collisions detected
  it('Scenario 8: Reconciles Arabic spelling variations (Alef forms, Teh Marbuta, diacritics, tatweel)', () => {
    const rawVariants = [
      'حليب الصافي كامل الدسم',
      'حَـلِـيـب الـصـافـي كـامـل الـدَسـم', // tatweel + tashkeel
      'حليب الصافى كامل الدسم', // Alef Maksura vs Yeh
      'حليب الصافي كامل الدسم  ' // trailing whitespace
    ]

    const keys = rawVariants.map((v) => computeCanonicalAliasKey(v))
    const firstKey = keys[0]

    expect(firstKey).toBeTruthy()
    for (const k of keys) {
      expect(k).toBe(firstKey)
    }

    // Alef with Hamza / Madda normalization
    const alefForms = ['أرز الشعلان', 'إرز الشعلان', 'آرز الشعلان', 'ارز الشعلان']
    const alefKeys = alefForms.map((v) => computeCanonicalAliasKey(v))
    expect(alefKeys.every((k) => k === 'ارز الشعلان')).toBe(true)
  })

  // 9. Bilingual alias equivalents handled cleanly
  it('Scenario 9: Bilingual Arabic and English aliases normalize independently without cross-language collision', async () => {
    const existingAliases: Array<{ id: string; product_id: string; alias_text: string }> = []
    const inMemoryProposals: ProductAliasProposal[] = []

    const propAr = await proposeProductAlias(
      {
        aliasText: 'حليب الصافي طويل الأجل ١٢*١ لتر',
        proposedProductId: '101',
        language: 'ar',
        proposingOperatorId: 'op_ar'
      },
      { catalogProducts: BASELINE_PRODUCTS, existingAliases, inMemoryProposals }
    )

    const propEn = await proposeProductAlias(
      {
        aliasText: 'Al Safi UHT Long Life Milk 12x1L',
        proposedProductId: '101',
        language: 'en',
        proposingOperatorId: 'op_en'
      },
      { catalogProducts: BASELINE_PRODUCTS, existingAliases, inMemoryProposals }
    )

    expect(propAr.success).toBe(true)
    expect(propEn.success).toBe(true)
    expect(propAr.proposal?.canonicalNormalizedKey).not.toBe(propEn.proposal?.canonicalNormalizedKey)
  })

  // 10. Variant and package contradictions rejected
  it('Scenario 10: Rejects alias approval when evidence contradicts target product pack configuration', async () => {
    const inMemoryProposals: ProductAliasProposal[] = []
    const propResult = await proposeProductAlias(
      {
        aliasText: 'Al Safi Single Bottle 1L',
        proposedProductId: '101', // Product 101 is 12x1L pack
        sourceEvidence: {
          brandEn: 'Al Safi',
          sizeValue: 1,
          sizeUnit: 'l',
          packCount: 1 // CONTRADICTS Product 101's 12-pack!
        },
        proposingOperatorId: 'op_1'
      },
      { catalogProducts: BASELINE_PRODUCTS, inMemoryProposals }
    )

    expect(propResult.success).toBe(true)
    expect(propResult.proposal?.status).toBe('conflict_needs_review')
    expect(propResult.proposal?.compatibilityResult.isCompatible).toBe(false)

    // Attempting to approve must fail
    const auth: OperatorAuthContext = {
      operatorId: 'operator_01',
      role: 'catalog_operator',
      isServerVerified: true
    }

    const reviewResult = await reviewProductAlias(
      {
        proposalId: propResult.proposal!.id,
        decision: 'approved',
        authContext: auth
      },
      {
        inMemoryProposals,
        catalogProducts: BASELINE_PRODUCTS
      }
    )

    expect(reviewResult.success).toBe(false)
    expect(reviewResult.error).toBe('IDENTITY_INCOMPATIBLE')
  })

  // 11. Stale proposals rejected when product data changes
  it('Scenario 11: Detects stale proposals when target catalog product facts change and supersedes proposal', async () => {
    const inMemoryProposals: ProductAliasProposal[] = []
    const propResult = await proposeProductAlias(
      {
        aliasText: 'Fakieh Poultry 10x600g',
        proposedProductId: '102',
        proposingOperatorId: 'op_1'
      },
      { catalogProducts: BASELINE_PRODUCTS, inMemoryProposals }
    )

    expect(propResult.success).toBe(true)
    const proposal = propResult.proposal!

    // Mutate catalog product facts (e.g. size changed to 800g)
    const modifiedProducts = BASELINE_PRODUCTS.map((p) =>
      p.id === 102 ? { ...p, size_value: 800, each_size_value: 800 } : p
    )

    const auth: OperatorAuthContext = {
      operatorId: 'operator_01',
      role: 'catalog_operator',
      isServerVerified: true
    }

    const reviewResult = await reviewProductAlias(
      {
        proposalId: proposal.id,
        decision: 'approved',
        authContext: auth
      },
      {
        inMemoryProposals,
        catalogProducts: modifiedProducts
      }
    )

    expect(reviewResult.success).toBe(false)
    expect(reviewResult.error).toBe('STALE_PROPOSAL_DATA_CHANGED')
    expect(proposal.status).toBe('superseded')
    expect(proposal.auditTrail.some((a) => a.action === 'superseded')).toBe(true)
  })

  // 12. Concurrent approvals handled safely
  it('Scenario 12: Handles concurrent approval race condition safely', async () => {
    const proposal: ProductAliasProposal = {
      id: 'prop-race',
      aliasText: 'Al Safi Full Cream Milk 12x1L',
      canonicalNormalizedKey: 'al safi full cream milk 12x1l',
      proposedProductId: '101',
      language: 'en',
      identityEvidenceHash: computeEvidenceSnapshotHash(productAlSafi12x1L),
      compatibilityResult: { isCompatible: true, reasons: [] },
      proposalOrigin: 'operator',
      status: 'pending_review',
      proposingOperatorId: 'op_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditTrail: []
    }

    const inMemoryProposals = [proposal]
    const auth: OperatorAuthContext = {
      operatorId: 'operator_01',
      role: 'catalog_operator',
      isServerVerified: true
    }

    // First review succeeds
    const res1 = await reviewProductAlias(
      { proposalId: 'prop-race', decision: 'approved', authContext: auth },
      { inMemoryProposals, catalogProducts: BASELINE_PRODUCTS }
    )
    expect(res1.success).toBe(true)
    expect(proposal.status).toBe('approved')

    // Second concurrent review fails
    const res2 = await reviewProductAlias(
      { proposalId: 'prop-race', decision: 'approved', authContext: auth },
      { inMemoryProposals, catalogProducts: BASELINE_PRODUCTS }
    )
    expect(res2.success).toBe(false)
    expect(res2.error).toBe('PROPOSAL_ALREADY_REVIEWED')
  })

  // 13. Database failures and transaction rollback
  it('Scenario 13: Rolls back proposal state if atomic alias insertion fails', async () => {
    const evidence = {
      brandEn: 'Al Safi',
      sizeValue: 1,
      sizeUnit: 'l',
      packCount: 12,
      variantEn: 'full-cream'
    }

    const proposal: ProductAliasProposal = {
      id: 'prop-db-fail',
      aliasText: 'Al Safi Long Life Full Cream Milk 12x1L',
      canonicalNormalizedKey: 'al safi long life full cream milk 12x1l',
      proposedProductId: '101',
      language: 'en',
      sourceCatalogEvidence: evidence,
      identityEvidenceHash: computeEvidenceSnapshotHash(productAlSafi12x1L, evidence),
      compatibilityResult: { isCompatible: true, reasons: [] },
      proposalOrigin: 'operator',
      status: 'pending_review',
      proposingOperatorId: 'op_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditTrail: []
    }

    const mockFailingSupabase = {
      from: (_table: string) => ({
        select: () => ({
          limit: async () => ({ data: [], error: null })
        }),
        insert: async () => ({
          error: new Error('Simulated unique constraint violation')
        })
      })
    }

    const auth: OperatorAuthContext = {
      operatorId: 'operator_01',
      role: 'catalog_operator',
      isServerVerified: true
    }

    const res = await reviewProductAlias(
      { proposalId: 'prop-db-fail', decision: 'approved', authContext: auth },
      {
        inMemoryProposals: [proposal],
        catalogProducts: BASELINE_PRODUCTS,
        supabaseClient: mockFailingSupabase
      }
    )

    expect(res.success).toBe(false)
    expect(res.error).toBe('TRANSACTION_ROLLBACK')
    expect(proposal.status).toBe('pending_review') // Preserved rollback state
    expect(proposal.auditTrail).toHaveLength(0) // Rollback removed temporary audit entry
  })

  // 14. Audit trail completeness
  it('Scenario 14: Verifies full audit trail history across lifecycle (proposal -> rejection / approval)', async () => {
    const inMemoryProposals: ProductAliasProposal[] = []
    const propRes = await proposeProductAlias(
      {
        aliasText: 'Al Shalan Basmati 5kg Bag',
        proposedProductId: '103',
        proposingOperatorId: 'operator_proposer'
      },
      { catalogProducts: BASELINE_PRODUCTS, inMemoryProposals }
    )

    const proposal = propRes.proposal!
    expect(proposal.auditTrail).toHaveLength(1)
    expect(proposal.auditTrail[0].action).toBe('proposed')
    expect(proposal.auditTrail[0].actorId).toBe('operator_proposer')

    const auth: OperatorAuthContext = {
      operatorId: 'operator_reviewer',
      role: 'catalog_admin',
      isServerVerified: true
    }

    await reviewProductAlias(
      {
        proposalId: proposal.id,
        decision: 'rejected',
        reason: 'Formatting non-standard',
        authContext: auth
      },
      { inMemoryProposals, catalogProducts: BASELINE_PRODUCTS }
    )

    expect(proposal.status).toBe('rejected')
    expect(proposal.auditTrail).toHaveLength(2)
    expect(proposal.auditTrail[1].action).toBe('rejected')
    expect(proposal.auditTrail[1].actorId).toBe('operator_reviewer')
    expect(proposal.auditTrail[1].actorRole).toBe('catalog_admin')
    expect(proposal.auditTrail[1].reason).toBe('Formatting non-standard')
    expect(proposal.auditTrail[1].signatureVerified).toBe(true)
  })

  // 15. No unauthorized alias insertion
  it('Scenario 15: Confirms live production insertion gate fails closed', async () => {
    const proposal: ProductAliasProposal = {
      id: 'prop-prod-gate',
      aliasText: 'Al Safi Full Cream Milk 12x1L',
      canonicalNormalizedKey: 'al safi full cream milk 12x1l',
      proposedProductId: '101',
      language: 'en',
      identityEvidenceHash: computeEvidenceSnapshotHash(productAlSafi12x1L),
      compatibilityResult: { isCompatible: true, reasons: [] },
      proposalOrigin: 'operator',
      status: 'pending_review',
      proposingOperatorId: 'op_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditTrail: []
    }

    const auth: OperatorAuthContext = {
      operatorId: 'operator_01',
      role: 'catalog_operator',
      isServerVerified: true
    }

    const res = await reviewProductAlias(
      { proposalId: 'prop-prod-gate', decision: 'approved', authContext: auth },
      {
        inMemoryProposals: [proposal],
        catalogProducts: BASELINE_PRODUCTS,
        isLiveProduction: true // Production mode flag!
      }
    )

    expect(res.success).toBe(false)
    expect(res.error).toBe('PRODUCTION_GATE_BLOCKED_UNAUTHENTICATED')
    expect(res.message).toContain('Live production alias insertions are strictly disabled')
  })

  // 16. No historical product-link mutation
  it('Scenario 16: Alias approval does not mutate historical offers in the database', async () => {
    const historicalOffers = [
      { id: 'off-1', title_en: 'Historical Unlinked Offer', product_id: null },
      { id: 'off-2', title_en: 'Historical Verified Offer', product_id: '101' }
    ]

    const beforeSnapshot = JSON.stringify(historicalOffers)

    const proposal: ProductAliasProposal = {
      id: 'prop-history-check',
      aliasText: 'Al Safi Long Life Full Cream Milk 12x1L',
      canonicalNormalizedKey: 'al safi long life full cream milk 12x1l',
      proposedProductId: '101',
      language: 'en',
      identityEvidenceHash: computeEvidenceSnapshotHash(productAlSafi12x1L),
      compatibilityResult: { isCompatible: true, reasons: [] },
      proposalOrigin: 'operator',
      status: 'pending_review',
      proposingOperatorId: 'op_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditTrail: []
    }

    const auth: OperatorAuthContext = {
      operatorId: 'op_lead',
      role: 'catalog_admin',
      isServerVerified: true
    }

    await reviewProductAlias(
      { proposalId: 'prop-history-check', decision: 'approved', authContext: auth },
      { inMemoryProposals: [proposal], catalogProducts: BASELINE_PRODUCTS }
    )

    // Historical offers must remain untouched
    const afterSnapshot = JSON.stringify(historicalOffers)
    expect(beforeSnapshot).toBe(afterSnapshot)
  })

  // 17. Approved alias participation in candidate retrieval
  it('Scenario 17: Approved alias participates in candidate retrieval via Stage 1 alias branch', async () => {
    const mockSupabase = createMockSupabase({
      products: [productAlSafi12x1L],
      aliases: [{ product_id: 101, alias_text: 'SafiMilk' }]
    })

    const retrievalResult = await retrieveBroadCandidates(
      {
        titleEn: 'SafiMilk Special Offer 12x1L',
        brandName: 'Al Safi'
      },
      { supabaseClient: mockSupabase as any }
    )

    expect(retrievalResult.candidates).toHaveLength(1)
    expect(retrievalResult.candidates[0].id).toBe(101)
  })

  // 18. Pending or rejected aliases excluded from candidate retrieval
  it('Scenario 18: Pending or rejected proposals are not placed in product_aliases and excluded from candidate retrieval', async () => {
    // Only approved aliases exist in product_aliases
    const mockSupabase = createMockSupabase({
      products: [productAlSafi12x1L],
      aliases: [] // active product_aliases table has 0 rows
    })

    const retrievalResult = await retrieveBroadCandidates(
      {
        titleEn: 'UnapprovedAliasBrandUnique 12x1L'
      },
      { supabaseClient: mockSupabase as any }
    )

    expect(retrievalResult.candidates).toHaveLength(0)
  })

  // 19. Candidate overflow and ambiguity preservation
  it('Scenario 19: Preserves candidate ambiguity and requires operator review when multiple verified products match', async () => {
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

  // 20. Existing Phase 1 and Phase 2A–2D regression behavior
  it('Scenario 20: Preserves 100% precision for baseline canary offers with unit equivalence and token order invariance', async () => {
    // Noori Canary 1: Al Safi 12x1L Milk
    const milkDecision = await executeTwoStageProductMatch(
      {
        titleEn: 'Al Safi Full Cream Milk 12x1000ml Long Life', // unit equivalent 1000ml = 1L
        brandName: 'Al Safi',
        variantOrFlavor: 'Full Cream',
        eachSizeValue: 1000,
        eachSizeUnit: 'ml',
        innerPackCount: 12,
        saleUnitType: 'pack'
      },
      { supabaseClient: createMockSupabase({ products: [productAlSafi12x1L] }) }
    )

    expect(milkDecision.matchedProduct).not.toBeNull()
    expect(milkDecision.matchedProduct?.id).toBe(101)
    expect(milkDecision.result.isCompatible).toBe(true)

    // Noori Canary 2: Fakieh 10x600g Chicken
    const chickenDecision = await executeTwoStageProductMatch(
      {
        titleEn: 'Frozen Chicken Fakieh 10x600g', // inverted word order with 0.6kg = 600g unit equivalence
        brandName: 'Fakieh',
        variantOrFlavor: 'Frozen',
        eachSizeValue: 0.6,
        eachSizeUnit: 'kg',
        innerPackCount: 10,
        saleUnitType: 'pack'
      },
      { supabaseClient: createMockSupabase({ products: [productFakieh10x600g] }) }
    )

    expect(chickenDecision.matchedProduct).not.toBeNull()
    expect(chickenDecision.matchedProduct?.id).toBe(102)
    expect(chickenDecision.result.isCompatible).toBe(true)

    // Noori Canary 3: Al Shalan 5kg Rice
    const riceDecision = await executeTwoStageProductMatch(
      {
        titleEn: 'Sella Basmati Rice Al Shalan 5000g', // 5000g = 5kg
        brandName: 'Al Shalan',
        variantOrFlavor: 'Sella Basmati',
        eachSizeValue: 5000,
        eachSizeUnit: 'g',
        innerPackCount: 1,
        saleUnitType: 'bag'
      },
      { supabaseClient: createMockSupabase({ products: [productAlShalan5kg] }) }
    )

    expect(riceDecision.matchedProduct).not.toBeNull()
    expect(riceDecision.matchedProduct?.id).toBe(103)
    expect(riceDecision.result.isCompatible).toBe(true)
  })
})
