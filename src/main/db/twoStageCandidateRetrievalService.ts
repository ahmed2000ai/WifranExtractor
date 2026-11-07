/**
 * Two-Stage Candidate Retrieval and Ranking Service
 * Milestone 2D: WIFRAN-EXTRACTOR-IDENTITY-002D
 *
 * Implements deterministic, bounded, two-stage catalog candidate retrieval and ranking:
 * - Stage 1 (Broad Retrieval): Multi-branch indexed discovery (exact canonical keys, verified aliases,
 *   bilingual/unit-equivalent names, slugs, brand filters, 4D package signals) with strict limit-26 overflow detection.
 * - Stage 2 (Strict Verification & Ranking): Full identity compatibility evaluation (Milestones 1 + 2A + 2B + 2C)
 *   combined with explainable, deterministic evidence-based scoring and tie-breaking.
 * - Match-Decision Rules: Strict fail-closed semantics for overflow, lookup errors, multi-candidate ambiguity,
 *   and unresolved identities.
 */

import { getSupabaseAdminClient } from './supabaseAdminClient'
import {
  normalizeArabicText,
  normalizeEnglishText,
  isMeaningfulText
} from '../../shared/utils/textNormalization'
import { ensureSlugFallback } from '../../shared/utils/slugify'
import {
  generateEquivalentTitleVariants,
  getEquivalentCanonicalKeys
} from '../../shared/utils/unitEquivalence'
import {
  generateBilingualCandidateSearchQueries,
  getCanonicalBrandId,
  extractNormalizedTokenBag,
  areTokenBagsCompatible
} from '../../shared/utils/bilingualTokenNormalizer'
import {
  extractStructuredQuantityConfig,
  comparePackageConfigurations,
  extractStructuredVariantFacts,
  compareProductVariants
} from './variantDisambiguationService'
import {
  validateProductIdentityCompatibility,
  classifyOfferAmbiguity,
  IdentityCompatibilityResult
} from './productIdentityCompatibilityValidator'
import { buildCanonicalProductKey } from './productCatalogResolutionService'

export function cleanBaseQueryTerm(text: string): string | null {
  if (!text) return null
  const cleaned = text
    .replace(/\b\d+\s*[xX*×]\s*\d+\s*(?:kg|g|gm|l|ltr|ml|cl|oz|lb|pcs|pack|كجم|جم|مل|لتر|جرام)?\b/gi, '')
    .replace(/\b\d+([.,]\d+)?\s*(?:kg|g|gm|l|ltr|ml|cl|oz|lb|pcs|pack|كجم|جم|مل|لتر|جرام)\b/gi, '')
    .replace(/\b\d+\b/g, '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length >= 3 ? cleaned : null
}

export const CANDIDATE_FETCH_LIMIT = 25
export const OVERFLOW_PROBE_LIMIT = CANDIDATE_FETCH_LIMIT + 1 // 26

export const PRODUCT_COLUMNS =
  'id, name_en, name_ar, slug, item_name_complete, canonical_product_key, brand_id, brand_name, variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type, verification_status, approved_primary_image_id, default_image_url'

export interface OfferCandidateSearchInput {
  titleEn?: string | null
  titleAr?: string | null
  brand?: string | null
  brandName?: string | null
  brandId?: string | null
  brandCandidateText?: string | null
  brandState?: string | null
  sizeOrWeight?: string | null
  eachSizeValue?: number | null
  eachSizeUnit?: string | null
  innerPackCount?: number | null
  saleUnitType?: string | null
  variantOrFlavor?: string | null
  canonicalProductKey?: string | null
  contractV2?: any
  assortmentStatus?: string | null
  exactIdentityStatus?: string | null
  itemDomain?: string | null
  priceBasis?: string | null
  productId?: string | number | null
  originalOcr?: any
}

export interface RetrievalBranchDiagnostic {
  branchName: string
  queryTerm?: string | null
  returnedRows: number
  totalCount?: number | null
  isTruncated: boolean
  error?: string
}

export interface CandidateRetrievalResult {
  candidates: any[]
  isTruncated: boolean
  hasLookupFailure: boolean
  branchDiagnostics: RetrievalBranchDiagnostic[]
  totalQueries: number
  totalDiscovered: number
  totalUnique: number
  latencyMs: number
}

export interface CandidateRankEvidence {
  canonicalKeyMatch: boolean
  equivalentKeyMatch: boolean
  verifiedAliasMatch: boolean
  brandMatch: boolean
  packageMatch: boolean
  variantMatch: boolean
  tokenSimilarityScore: number
  totalScore: number
  breakdown: string[]
}

export interface RankedCandidate {
  product: any
  validation: IdentityCompatibilityResult
  rankEvidence: CandidateRankEvidence
  score: number
}

export interface TwoStageMatchResult {
  matchedProduct: any | null
  result: IdentityCompatibilityResult
  rankedCandidates: RankedCandidate[]
  retrievalDiagnostics: {
    totalQueries: number
    totalDiscovered: number
    totalUnique: number
    isTruncated: boolean
    hasLookupFailure: boolean
    compatibleCount: number
    latencyMs: number
  }
}

/**
 * Stage 1: Broad Candidate Retrieval
 * Executes bounded, deterministic multi-branch queries against Supabase with strict overflow probe limits (limit 26).
 */
export async function retrieveBroadCandidates(
  offerInput: OfferCandidateSearchInput,
  options?: { supabaseClient?: any }
): Promise<CandidateRetrievalResult> {
  const startTime = Date.now()
  const supabase = options?.supabaseClient || getSupabaseAdminClient()
  const branchDiagnostics: RetrievalBranchDiagnostic[] = []

  const titleEn = (offerInput.titleEn || (offerInput as any).title_en || offerInput.contractV2?.product_facts?.name_en || '').trim()
  const titleAr = (offerInput.titleAr || (offerInput as any).title_ar || offerInput.contractV2?.product_facts?.name_ar || '').trim()

  if (!isMeaningfulText(titleEn) && !isMeaningfulText(titleAr)) {
    return {
      candidates: [],
      isTruncated: false,
      hasLookupFailure: false,
      branchDiagnostics: [],
      totalQueries: 0,
      totalDiscovered: 0,
      totalUnique: 0,
      latencyMs: Date.now() - startTime
    }
  }

  const normEn = normalizeEnglishText(titleEn)
  const normAr = normalizeArabicText(titleAr)

  const rawBrand =
    offerInput.brandName ||
    (offerInput as any).brand_name ||
    offerInput.brand ||
    offerInput.brandCandidateText ||
    offerInput.contractV2?.product_facts?.brand_assertion?.value ||
    null
  const canonicalBrand = rawBrand ? getCanonicalBrandId(rawBrand) || rawBrand : null

  const candidateProductsMap = new Map<string, any>()
  let isTruncated = false
  let hasLookupFailure = false
  let totalQueries = 0
  let totalDiscovered = 0

  // ---------------------------------------------------------------------------
  // Branch 1: Exact and Equivalent Canonical Product Keys
  // ---------------------------------------------------------------------------
  const structuredQty = extractStructuredQuantityConfig({
    title_en: titleEn,
    title_ar: titleAr,
    size_or_weight: offerInput.sizeOrWeight,
    each_size_value: offerInput.eachSizeValue,
    each_size_unit: offerInput.eachSizeUnit,
    inner_pack_count: offerInput.innerPackCount,
    sale_unit_type: offerInput.saleUnitType,
    contract_v2: offerInput.contractV2
  })

  const effectiveSizeValue = offerInput.eachSizeValue ?? structuredQty.individualUnitContent?.value ?? null
  const effectiveSizeUnit = offerInput.eachSizeUnit ?? structuredQty.individualUnitContent?.unit ?? null
  const effectivePackCount = offerInput.innerPackCount ?? structuredQty.innerPackCount ?? null
  const effectiveSaleUnit = offerInput.saleUnitType ?? structuredQty.saleUnitType ?? null

  const candidateKeys: string[] = []
  if (offerInput.canonicalProductKey) {
    candidateKeys.push(offerInput.canonicalProductKey)
  }
  const computedKey = buildCanonicalProductKey({
    brandName: canonicalBrand,
    normalizedTitleEn: normEn || 'unnamed',
    variantOrFlavor: offerInput.variantOrFlavor,
    eachSizeValue: effectiveSizeValue,
    eachSizeUnit: effectiveSizeUnit,
    innerPackCount: effectivePackCount,
    saleUnitType: effectiveSaleUnit
  })
  if (computedKey && !candidateKeys.includes(computedKey)) {
    candidateKeys.push(computedKey)
  }

  const allKeysToSearch = Array.from(
    new Set([
      ...candidateKeys,
      ...candidateKeys.flatMap((k) => getEquivalentCanonicalKeys(k))
    ])
  ).slice(0, 5) // Bounded search keys

  if (allKeysToSearch.length > 0 && !hasLookupFailure && !isTruncated) {
    try {
      const keySelect = supabase
        .from('products')
        .select(PRODUCT_COLUMNS, { count: 'exact' })

      if (typeof keySelect?.in === 'function') {
        totalQueries++
        const { data: keyRows, error: keyErr, count: keyCount } = await keySelect
          .in('canonical_product_key', allKeysToSearch)
          .limit(OVERFLOW_PROBE_LIMIT)

        if (keyErr) {
          hasLookupFailure = true
          branchDiagnostics.push({
            branchName: 'canonical_product_key',
            returnedRows: 0,
            isTruncated: false,
            error: keyErr.message
          })
        } else if (keyRows) {
          totalDiscovered += keyRows.length
          const branchTruncated =
            (keyCount != null && keyCount > CANDIDATE_FETCH_LIMIT) ||
            keyRows.length > CANDIDATE_FETCH_LIMIT
          if (branchTruncated) isTruncated = true

          branchDiagnostics.push({
            branchName: 'canonical_product_key',
            returnedRows: keyRows.length,
            totalCount: keyCount,
            isTruncated: branchTruncated
          })

          for (const p of keyRows) {
            candidateProductsMap.set(String(p.id), p)
          }
        }
      } else if (allKeysToSearch.length === 1 && typeof keySelect?.eq === 'function') {
        totalQueries++
        const { data: keyRows, error: keyErr, count: keyCount } = await keySelect
          .eq('canonical_product_key', allKeysToSearch[0])
          .limit(OVERFLOW_PROBE_LIMIT)

        if (keyErr) {
          hasLookupFailure = true
          branchDiagnostics.push({
            branchName: 'canonical_product_key',
            returnedRows: 0,
            isTruncated: false,
            error: keyErr.message
          })
        } else if (keyRows) {
          totalDiscovered += keyRows.length
          const branchTruncated =
            (keyCount != null && keyCount > CANDIDATE_FETCH_LIMIT) ||
            keyRows.length > CANDIDATE_FETCH_LIMIT
          if (branchTruncated) isTruncated = true

          branchDiagnostics.push({
            branchName: 'canonical_product_key',
            returnedRows: keyRows.length,
            totalCount: keyCount,
            isTruncated: branchTruncated
          })

          for (const p of keyRows) {
            candidateProductsMap.set(String(p.id), p)
          }
        }
      }
    } catch (e: any) {
      hasLookupFailure = true
      branchDiagnostics.push({
        branchName: 'canonical_product_key',
        returnedRows: 0,
        isTruncated: false,
        error: e?.message || String(e)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Build Bounded Search Terms (Bilingual 2B + Unit Equivalence 2A + Clean Base + Original OCR)
  // ---------------------------------------------------------------------------
  const cleanBaseEn = cleanBaseQueryTerm(titleEn)
  const cleanBaseAr = cleanBaseQueryTerm(titleAr)
  const ocrTitleEn = offerInput.originalOcr?.titleEn ? normalizeEnglishText(offerInput.originalOcr.titleEn) : null
  const ocrTitleAr = offerInput.originalOcr?.titleAr ? normalizeArabicText(offerInput.originalOcr.titleAr) : null

  const bilingualQueries = [
    ...(titleEn ? generateBilingualCandidateSearchQueries(titleEn) : []),
    ...(titleAr ? generateBilingualCandidateSearchQueries(titleAr) : []),
    ...(ocrTitleEn ? generateBilingualCandidateSearchQueries(ocrTitleEn) : [])
  ]

  const enSearchTerms = Array.from(
    new Set([
      normEn,
      ...(ocrTitleEn ? [ocrTitleEn] : []),
      ...(cleanBaseEn ? [normalizeEnglishText(cleanBaseEn)] : []),
      ...(normEn ? generateEquivalentTitleVariants(normEn) : []),
      ...bilingualQueries.filter((q) => !/[\u0600-\u06FF]/.test(q))
    ])
  )
    .filter((t) => t && isMeaningfulText(t))
    .slice(0, 8) // Strict bound: max 8 English terms

  const arSearchTerms = Array.from(
    new Set([
      normAr,
      ...(ocrTitleAr ? [ocrTitleAr] : []),
      ...(cleanBaseAr ? [normalizeArabicText(cleanBaseAr)] : []),
      ...(normAr ? generateEquivalentTitleVariants(normAr) : []),
      ...bilingualQueries.filter((q) => /[\u0600-\u06FF]/.test(q))
    ])
  )
    .filter((t) => t && isMeaningfulText(t))
    .slice(0, 8) // Strict bound: max 8 Arabic terms

  // ---------------------------------------------------------------------------
  // Branch 2: Verified Product Aliases Search
  // ---------------------------------------------------------------------------
  const aliasProductIds: Array<string | number> = []
  const aliasSearchTerms = [...arSearchTerms, ...enSearchTerms].slice(0, 8)

  for (const term of aliasSearchTerms) {
    if (hasLookupFailure || isTruncated) break
    totalQueries++
    try {
      const { data: aliasRows, error: aliasErr, count: aliasCount } = await supabase
        .from('product_aliases')
        .select('product_id', { count: 'exact' })
        .ilike('alias_text', term)
        .limit(OVERFLOW_PROBE_LIMIT)

      if (aliasErr) {
        hasLookupFailure = true
        branchDiagnostics.push({
          branchName: 'product_aliases',
          queryTerm: term,
          returnedRows: 0,
          isTruncated: false,
          error: aliasErr.message
        })
      } else if (aliasRows) {
        totalDiscovered += aliasRows.length
        const branchTruncated =
          (aliasCount != null && aliasCount > CANDIDATE_FETCH_LIMIT) ||
          aliasRows.length > CANDIDATE_FETCH_LIMIT
        if (branchTruncated) isTruncated = true

        branchDiagnostics.push({
          branchName: 'product_aliases',
          queryTerm: term,
          returnedRows: aliasRows.length,
          totalCount: aliasCount,
          isTruncated: branchTruncated
        })

        for (const a of aliasRows) {
          if (a.product_id != null) aliasProductIds.push(a.product_id)
        }
      }
    } catch (e: any) {
      hasLookupFailure = true
      branchDiagnostics.push({
        branchName: 'product_aliases',
        queryTerm: term,
        returnedRows: 0,
        isTruncated: false,
        error: e?.message || String(e)
      })
    }
  }

  // Fetch product rows for discovered alias IDs
  const uniqueAliasIds = Array.from(new Set(aliasProductIds)).slice(0, OVERFLOW_PROBE_LIMIT)
  if (uniqueAliasIds.length > 0 && !hasLookupFailure && !isTruncated) {
    for (const aId of uniqueAliasIds) {
      if (candidateProductsMap.size > CANDIDATE_FETCH_LIMIT) {
        isTruncated = true
        break
      }
      totalQueries++
      try {
        const pQuery = supabase
          .from('products')
          .select(PRODUCT_COLUMNS)
          .eq('id', aId)
        let pRes: any
        if (typeof pQuery?.maybeSingle === 'function') {
          pRes = await pQuery.maybeSingle()
        } else if (typeof pQuery?.limit === 'function') {
          pRes = await pQuery.limit(1)
        } else {
          pRes = await pQuery
        }
        const p = Array.isArray(pRes?.data) ? pRes.data[0] : pRes?.data
        const pErr = pRes?.error

        if (pErr) {
          hasLookupFailure = true
          branchDiagnostics.push({
            branchName: 'alias_product_lookup',
            queryTerm: String(aId),
            returnedRows: 0,
            isTruncated: false,
            error: pErr.message
          })
        } else if (p) {
          candidateProductsMap.set(String(p.id), p)
        }
      } catch (e: any) {
        hasLookupFailure = true
        branchDiagnostics.push({
          branchName: 'alias_product_lookup',
          queryTerm: String(aId),
          returnedRows: 0,
          isTruncated: false,
          error: e?.message || String(e)
        })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Branch 3: Product Name Search (`name_en`, `name_ar`)
  // ---------------------------------------------------------------------------
  for (const term of enSearchTerms) {
    if (hasLookupFailure || isTruncated) break
    totalQueries++
    try {
      const { data: prodsEn, error: prodsEnErr, count: prodsEnCount } = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS, { count: 'exact' })
        .ilike('name_en', term)
        .limit(OVERFLOW_PROBE_LIMIT)

      if (prodsEnErr) {
        hasLookupFailure = true
        branchDiagnostics.push({
          branchName: 'products_name_en',
          queryTerm: term,
          returnedRows: 0,
          isTruncated: false,
          error: prodsEnErr.message
        })
      } else if (prodsEn) {
        totalDiscovered += prodsEn.length
        const branchTruncated =
          (prodsEnCount != null && prodsEnCount > CANDIDATE_FETCH_LIMIT) ||
          prodsEn.length > CANDIDATE_FETCH_LIMIT
        if (branchTruncated) isTruncated = true

        branchDiagnostics.push({
          branchName: 'products_name_en',
          queryTerm: term,
          returnedRows: prodsEn.length,
          totalCount: prodsEnCount,
          isTruncated: branchTruncated
        })

        for (const p of prodsEn) {
          candidateProductsMap.set(String(p.id), p)
        }

        // Also query item_name_complete for full product title
        try {
          const { data: prodsComp, error: compErr, count: compCount } = await supabase
            .from('products')
            .select(PRODUCT_COLUMNS, { count: 'exact' })
            .ilike('item_name_complete', term)
            .limit(OVERFLOW_PROBE_LIMIT)

          if (!compErr && prodsComp) {
            totalDiscovered += prodsComp.length
            const compTruncated =
              (compCount != null && compCount > CANDIDATE_FETCH_LIMIT) ||
              prodsComp.length > CANDIDATE_FETCH_LIMIT
            if (compTruncated) isTruncated = true
            for (const p of prodsComp) {
              candidateProductsMap.set(String(p.id), p)
            }
          }
        } catch {
          // Graceful fallback if item_name_complete column not supported by client
        }
      }
    } catch (e: any) {
      hasLookupFailure = true
      branchDiagnostics.push({
        branchName: 'products_name_en',
        queryTerm: term,
        returnedRows: 0,
        isTruncated: false,
        error: e?.message || String(e)
      })
    }
  }

  for (const term of arSearchTerms) {
    if (hasLookupFailure || isTruncated) break
    totalQueries++
    try {
      const { data: prodsAr, error: prodsArErr, count: prodsArCount } = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS, { count: 'exact' })
        .ilike('name_ar', term)
        .limit(OVERFLOW_PROBE_LIMIT)

      if (prodsArErr) {
        hasLookupFailure = true
        branchDiagnostics.push({
          branchName: 'products_name_ar',
          queryTerm: term,
          returnedRows: 0,
          isTruncated: false,
          error: prodsArErr.message
        })
      } else if (prodsAr) {
        totalDiscovered += prodsAr.length
        const branchTruncated =
          (prodsArCount != null && prodsArCount > CANDIDATE_FETCH_LIMIT) ||
          prodsAr.length > CANDIDATE_FETCH_LIMIT
        if (branchTruncated) isTruncated = true

        branchDiagnostics.push({
          branchName: 'products_name_ar',
          queryTerm: term,
          returnedRows: prodsAr.length,
          totalCount: prodsArCount,
          isTruncated: branchTruncated
        })

        for (const p of prodsAr) {
          candidateProductsMap.set(String(p.id), p)
        }
      }
    } catch (e: any) {
      hasLookupFailure = true
      branchDiagnostics.push({
        branchName: 'products_name_ar',
        queryTerm: term,
        returnedRows: 0,
        isTruncated: false,
        error: e?.message || String(e)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Branch 4: Product Slug Search
  // ---------------------------------------------------------------------------
  const slugCandidates = new Set<string>()
  const baseSlug = ensureSlugFallback({
    preferred: titleEn,
    fallback: titleAr,
    prefix: 'product'
  })
  if (baseSlug && baseSlug !== 'product') slugCandidates.add(baseSlug)

  for (const term of enSearchTerms) {
    const vSlug = ensureSlugFallback({ preferred: term, fallback: null, prefix: 'product' })
    if (vSlug && vSlug !== 'product') slugCandidates.add(vSlug)
  }

  for (const s of slugCandidates) {
    if (hasLookupFailure || isTruncated) break
    totalQueries++
    try {
      const { data: prodsSlug, error: slugErr, count: prodsSlugCount } = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS, { count: 'exact' })
        .eq('slug', s)
        .limit(OVERFLOW_PROBE_LIMIT)

      if (slugErr) {
        hasLookupFailure = true
        branchDiagnostics.push({
          branchName: 'products_slug',
          queryTerm: s,
          returnedRows: 0,
          isTruncated: false,
          error: slugErr.message
        })
      } else if (prodsSlug) {
        totalDiscovered += prodsSlug.length
        const branchTruncated =
          (prodsSlugCount != null && prodsSlugCount > CANDIDATE_FETCH_LIMIT) ||
          prodsSlug.length > CANDIDATE_FETCH_LIMIT
        if (branchTruncated) isTruncated = true

        branchDiagnostics.push({
          branchName: 'products_slug',
          queryTerm: s,
          returnedRows: prodsSlug.length,
          totalCount: prodsSlugCount,
          isTruncated: branchTruncated
        })

        for (const p of prodsSlug) {
          candidateProductsMap.set(String(p.id), p)
        }
      }
    } catch (e: any) {
      hasLookupFailure = true
      branchDiagnostics.push({
        branchName: 'products_slug',
        queryTerm: s,
        returnedRows: 0,
        isTruncated: false,
        error: e?.message || String(e)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Branch 5: Brand-Aware Search
  // ---------------------------------------------------------------------------
  if (offerInput.brandId && !hasLookupFailure && !isTruncated) {
    for (const term of enSearchTerms.slice(0, 3)) {
      if (hasLookupFailure || isTruncated) break
      totalQueries++
      try {
        const { data: prodsBrand, error: brandErr, count: prodsBrandCount } = await supabase
          .from('products')
          .select(PRODUCT_COLUMNS, { count: 'exact' })
          .eq('brand_id', offerInput.brandId)
          .ilike('name_en', term)
          .limit(OVERFLOW_PROBE_LIMIT)

        if (brandErr) {
          hasLookupFailure = true
          branchDiagnostics.push({
            branchName: 'brand_aware_en',
            queryTerm: term,
            returnedRows: 0,
            isTruncated: false,
            error: brandErr.message
          })
        } else if (prodsBrand) {
          totalDiscovered += prodsBrand.length
          const branchTruncated =
            (prodsBrandCount != null && prodsBrandCount > CANDIDATE_FETCH_LIMIT) ||
            prodsBrand.length > CANDIDATE_FETCH_LIMIT
          if (branchTruncated) isTruncated = true

          branchDiagnostics.push({
            branchName: 'brand_aware_en',
            queryTerm: term,
            returnedRows: prodsBrand.length,
            totalCount: prodsBrandCount,
            isTruncated: branchTruncated
          })

          for (const p of prodsBrand) {
            candidateProductsMap.set(String(p.id), p)
          }
        }
      } catch (e: any) {
        hasLookupFailure = true
        branchDiagnostics.push({
          branchName: 'brand_aware_en',
          queryTerm: term,
          returnedRows: 0,
          isTruncated: false,
          error: e?.message || String(e)
        })
      }
    }

    for (const term of arSearchTerms.slice(0, 3)) {
      if (hasLookupFailure || isTruncated) break
      totalQueries++
      try {
        const { data: prodsBrand, error: brandErr, count: prodsBrandCount } = await supabase
          .from('products')
          .select(PRODUCT_COLUMNS, { count: 'exact' })
          .eq('brand_id', offerInput.brandId)
          .ilike('name_ar', term)
          .limit(OVERFLOW_PROBE_LIMIT)

        if (brandErr) {
          hasLookupFailure = true
          branchDiagnostics.push({
            branchName: 'brand_aware_ar',
            queryTerm: term,
            returnedRows: 0,
            isTruncated: false,
            error: brandErr.message
          })
        } else if (prodsBrand) {
          totalDiscovered += prodsBrand.length
          const branchTruncated =
            (prodsBrandCount != null && prodsBrandCount > CANDIDATE_FETCH_LIMIT) ||
            prodsBrand.length > CANDIDATE_FETCH_LIMIT
          if (branchTruncated) isTruncated = true

          branchDiagnostics.push({
            branchName: 'brand_aware_ar',
            queryTerm: term,
            returnedRows: prodsBrand.length,
            totalCount: prodsBrandCount,
            isTruncated: branchTruncated
          })

          for (const p of prodsBrand) {
            candidateProductsMap.set(String(p.id), p)
          }
        }
      } catch (e: any) {
        hasLookupFailure = true
        branchDiagnostics.push({
          branchName: 'brand_aware_ar',
          queryTerm: term,
          returnedRows: 0,
          isTruncated: false,
          error: e?.message || String(e)
        })
      }
    }
  }

  // Check cumulative deduplicated candidate count
  if (candidateProductsMap.size > CANDIDATE_FETCH_LIMIT) {
    isTruncated = true
  }

  return {
    candidates: Array.from(candidateProductsMap.values()),
    isTruncated,
    hasLookupFailure,
    branchDiagnostics,
    totalQueries,
    totalDiscovered,
    totalUnique: candidateProductsMap.size,
    latencyMs: Date.now() - startTime
  }
}

/**
 * Computes deterministic, explainable ranking evidence and score for a single candidate product.
 * Invariant: Score never overrides a failed compatibility validation.
 */
export function rankCandidateProduct(
  offerInput: OfferCandidateSearchInput,
  candidateProduct: any,
  validationResult: IdentityCompatibilityResult,
  options?: { discoveredViaAlias?: boolean }
): RankedCandidate {
  let score = 0
  const breakdown: string[] = []

  const titleEn = (offerInput.titleEn || offerInput.contractV2?.product_facts?.name_en || '').trim()
  const titleAr = (offerInput.titleAr || offerInput.contractV2?.product_facts?.name_ar || '').trim()
  const combinedOfferText = `${titleEn} ${titleAr}`.trim()

  const prodNameEn = (candidateProduct.name_en || candidateProduct.item_name_complete || '').trim()
  const prodNameAr = (candidateProduct.name_ar || '').trim()
  const combinedProdText = `${candidateProduct.item_name_complete || ''} ${prodNameEn} ${prodNameAr} ${candidateProduct.canonical_product_key || ''}`.trim()

  // 1. Canonical Product Key Match
  let canonicalKeyMatch = false
  let equivalentKeyMatch = false
  const computedKey = buildCanonicalProductKey({
    brandName: offerInput.brandName || offerInput.brandCandidateText,
    normalizedTitleEn: normalizeEnglishText(titleEn) || 'unnamed',
    variantOrFlavor: offerInput.variantOrFlavor,
    eachSizeValue: offerInput.eachSizeValue,
    eachSizeUnit: offerInput.eachSizeUnit,
    innerPackCount: offerInput.innerPackCount,
    saleUnitType: offerInput.saleUnitType
  })

  if (candidateProduct.canonical_product_key) {
    if (offerInput.canonicalProductKey && candidateProduct.canonical_product_key === offerInput.canonicalProductKey) {
      canonicalKeyMatch = true
      score += 300
      breakdown.push('Exact input canonical product key match (+300)')
    } else if (computedKey && candidateProduct.canonical_product_key === computedKey) {
      canonicalKeyMatch = true
      score += 300
      breakdown.push('Exact computed canonical product key match (+300)')
    } else if (computedKey) {
      const equiv = getEquivalentCanonicalKeys(computedKey)
      if (equiv.includes(candidateProduct.canonical_product_key)) {
        equivalentKeyMatch = true
        score += 250
        breakdown.push('Equivalent unit canonical product key match (+250)')
      }
    }
  }

  // 2. Verified Alias Match
  let verifiedAliasMatch = Boolean(options?.discoveredViaAlias)
  if (verifiedAliasMatch) {
    score += 200
    breakdown.push('Candidate matched via verified product alias (+200)')
  }

  // 3. Brand Match
  let brandMatch = false
  const rawBrand =
    offerInput.brandName ||
    offerInput.brand ||
    offerInput.brandCandidateText ||
    offerInput.contractV2?.product_facts?.brand_assertion?.value ||
    null
  const offerBrandId = rawBrand ? getCanonicalBrandId(rawBrand) || rawBrand.toLowerCase().replace(/[^a-z0-9]/g, '') : null
  const prodBrandId = candidateProduct.brand_name
    ? getCanonicalBrandId(candidateProduct.brand_name) || candidateProduct.brand_name.toLowerCase().replace(/[^a-z0-9]/g, '')
    : null

  if (offerBrandId && prodBrandId && offerBrandId === prodBrandId) {
    brandMatch = true
    score += 150
    breakdown.push(`Brand identity match: '${offerBrandId}' (+150)`)
  }

  // 4. Exact 4D Package Configuration Match (Milestone 2C)
  let packageMatch = false
  const offerConfig = extractStructuredQuantityConfig({
    ...offerInput,
    title_en: titleEn,
    title_ar: titleAr,
    sale_unit_type: offerInput.saleUnitType,
    inner_pack_count: offerInput.innerPackCount,
    each_size_value: offerInput.eachSizeValue,
    each_size_unit: offerInput.eachSizeUnit
  })
  const prodConfig = extractStructuredQuantityConfig(candidateProduct)
  const pkgRes = comparePackageConfigurations(offerConfig, prodConfig)
  if (pkgRes.isCompatible) {
    packageMatch = true
    score += 150
    breakdown.push('Exact 4D package configuration match (+150)')
  }

  // 5. Variant Attributes Match (Milestone 2C)
  let variantMatch = false
  const offerVar = extractStructuredVariantFacts({
    ...offerInput,
    title_en: titleEn,
    title_ar: titleAr,
    variant_or_flavor: offerInput.variantOrFlavor
  })
  const prodVar = extractStructuredVariantFacts(candidateProduct)
  const varRes = compareProductVariants(offerVar, prodVar)
  if (varRes.isCompatible) {
    variantMatch = true
    score += 100
    breakdown.push('Exact variant/cut/fat/preservation match (+100)')
  }

  // 6. Token Bag Similarity (Milestone 2B)
  const offerBag = extractNormalizedTokenBag(combinedOfferText)
  const prodBag = extractNormalizedTokenBag(combinedProdText)
  const tokenRes = areTokenBagsCompatible(offerBag, prodBag)
  const tokenBonus = Math.round(tokenRes.similarityScore * 100)
  score += tokenBonus
  breakdown.push(`Bilingual token Jaccard similarity: ${tokenRes.similarityScore} (+${tokenBonus})`)

  // 7. Verified Status Bonus
  if (candidateProduct.verification_status === 'verified') {
    score += 100
    breakdown.push('Verified catalog product bonus (+100)')
  }

  return {
    product: candidateProduct,
    validation: validationResult,
    rankEvidence: {
      canonicalKeyMatch,
      equivalentKeyMatch,
      verifiedAliasMatch,
      brandMatch,
      packageMatch,
      variantMatch,
      tokenSimilarityScore: tokenRes.similarityScore,
      totalScore: score,
      breakdown
    },
    score
  }
}

/**
 * Stage 2: Validates all candidates through structured compatibility validator and ranks them deterministically.
 */
export function validateAndRankCandidates(
  offerInput: OfferCandidateSearchInput,
  candidateProducts: any[],
  _options?: { isTruncated?: boolean; hasLookupFailure?: boolean }
): {
  rankedCandidates: RankedCandidate[]
  compatibleVerifiedCandidates: RankedCandidate[]
  incompatibleCandidates: RankedCandidate[]
} {
  const rankedCandidates: RankedCandidate[] = []

  for (const prod of candidateProducts) {
    const validation = validateProductIdentityCompatibility(offerInput, prod)
    const ranked = rankCandidateProduct(offerInput, prod, validation)
    rankedCandidates.push(ranked)
  }

  // Deterministic, stable ordering
  rankedCandidates.sort((a, b) => {
    // 1. Fully compatible verified candidates ALWAYS sort above incompatible ones
    const aComp = a.validation.isCompatible && a.product.verification_status === 'verified'
    const bComp = b.validation.isCompatible && b.product.verification_status === 'verified'
    if (aComp && !bComp) return -1
    if (!aComp && bComp) return 1

    // 2. Compatible unverified or warning candidates above contradictory ones
    if (a.validation.isCompatible && !b.validation.isCompatible) return -1
    if (!a.validation.isCompatible && b.validation.isCompatible) return 1

    // 3. Higher rank score first
    if (b.score !== a.score) return b.score - a.score

    // 4. Deterministic tie-breaker: ascending product ID using lossless BigInt comparison
    const idA = String(a.product.id)
    const idB = String(b.product.id)
    try {
      const bigA = BigInt(idA)
      const bigB = BigInt(idB)
      if (bigA < bigB) return -1
      if (bigA > bigB) return 1
      return 0
    } catch {
      return idA.localeCompare(idB, undefined, { numeric: true })
    }
  })

  const compatibleVerifiedCandidates = rankedCandidates.filter(
    (c) => c.validation.isCompatible && c.product.verification_status === 'verified'
  )
  const incompatibleCandidates = rankedCandidates.filter((c) => !c.validation.isCompatible)

  return {
    rankedCandidates,
    compatibleVerifiedCandidates,
    incompatibleCandidates
  }
}

/**
 * Evaluates the final match decision in strict adherence to Section 5 Match-Decision Rules.
 */
export function evaluateTwoStageMatchDecision(
  offerInput: OfferCandidateSearchInput,
  retrievalResult: CandidateRetrievalResult,
  rankedResult: {
    rankedCandidates: RankedCandidate[]
    compatibleVerifiedCandidates: RankedCandidate[]
    incompatibleCandidates: RankedCandidate[]
  }
): TwoStageMatchResult {
  const diagnostics = {
    totalQueries: retrievalResult.totalQueries,
    totalDiscovered: retrievalResult.totalDiscovered,
    totalUnique: retrievalResult.totalUnique,
    isTruncated: retrievalResult.isTruncated,
    hasLookupFailure: retrievalResult.hasLookupFailure,
    compatibleCount: rankedResult.compatibleVerifiedCandidates.length,
    latencyMs: retrievalResult.latencyMs
  }

  // Rule 1: Database Lookup Failure -> Fail Closed
  if (retrievalResult.hasLookupFailure) {
    return {
      matchedProduct: null,
      result: {
        isCompatible: false,
        status: 'rejected_database_lookup_failure',
        reason: 'Database lookup failure occurred during candidate retrieval. Auto-match blocked.'
      },
      rankedCandidates: rankedResult.rankedCandidates,
      retrievalDiagnostics: diagnostics
    }
  }

  // Rule 2: Incomplete / Truncated Candidate Retrieval -> Fail Closed
  if (retrievalResult.isTruncated) {
    return {
      matchedProduct: null,
      result: {
        isCompatible: false,
        status: 'rejected_candidate_search_incomplete',
        reason: 'Candidate search exceeded limit of 25 products (results truncated). Auto-match blocked.'
      },
      rankedCandidates: rankedResult.rankedCandidates,
      retrievalDiagnostics: diagnostics
    }
  }

  // Rule 3: Ambiguous Offer Gate (Assortment, Loose unbranded commodity)
  const ambiguity = classifyOfferAmbiguity({
    title_en: offerInput.titleEn || '',
    title_ar: offerInput.titleAr || undefined,
    brand_name: offerInput.brandName || offerInput.brandCandidateText || undefined,
    brand_state: offerInput.brandState || undefined,
    sale_unit_type: offerInput.saleUnitType || undefined,
    inner_pack_count: offerInput.innerPackCount,
    each_size_value: offerInput.eachSizeValue,
    each_size_unit: offerInput.eachSizeUnit || undefined,
    assortment_status: offerInput.assortmentStatus || undefined
  })
  if (ambiguity.isAmbiguous) {
    return {
      matchedProduct: null,
      result: {
        isCompatible: false,
        status: 'rejected_ambiguous_offer',
        reason: `Offer represents an ambiguous entity (${ambiguity.reason || 'assortment/commodity'}); catalog SKU assignment blocked.`
      },
      rankedCandidates: rankedResult.rankedCandidates,
      retrievalDiagnostics: diagnostics
    }
  }

  // Rule 4: No Candidates Discovered
  if (rankedResult.rankedCandidates.length === 0) {
    return {
      matchedProduct: null,
      result: {
        isCompatible: false,
        status: 'no_eligible_candidate',
        reason: 'No candidate products supplied or discovered for matching.'
      },
      rankedCandidates: [],
      retrievalDiagnostics: diagnostics
    }
  }

  // Rule 5: Zero Compatible Verified Candidates
  if (rankedResult.compatibleVerifiedCandidates.length === 0) {
    const rejectionReasons = rankedResult.incompatibleCandidates.map(
      (c) => `Product #${c.product.id}: ${c.validation.reason}`
    )
    const hasContradiction = rejectionReasons.some((r) => r.includes('Identity contradiction'))
    const hasAmbiguity = rejectionReasons.some((r) => r.includes('ambiguous entity'))

    return {
      matchedProduct: null,
      result: {
        isCompatible: false,
        status: hasContradiction
          ? 'rejected_contradictory'
          : hasAmbiguity
            ? 'rejected_ambiguous_offer'
            : 'rejected_insufficient_evidence',
        reason: rejectionReasons.join(' | ') || 'No compatible verified products found.'
      },
      rankedCandidates: rankedResult.rankedCandidates,
      retrievalDiagnostics: diagnostics
    }
  }

  // Rule 6: Unique Verified Compatible Candidate -> Auto-Link Permitted!
  const uniqueCompatibleIds = new Set(
    rankedResult.compatibleVerifiedCandidates.map((c) => String(c.product.id))
  )

  if (uniqueCompatibleIds.size === 1) {
    const winner = rankedResult.compatibleVerifiedCandidates[0]
    return {
      matchedProduct: winner.product,
      result: winner.validation,
      rankedCandidates: rankedResult.rankedCandidates,
      retrievalDiagnostics: diagnostics
    }
  }

  // Rule 7: Multiple Distinct Verified Compatible Candidates -> Require Operator Review
  // Invariant: Ranking order or score difference NEVER auto-links when multiple distinct products pass validation!
  return {
    matchedProduct: null,
    result: {
      isCompatible: false,
      status: 'rejected_multiple_candidates',
      reason: `Multiple distinct verified products (${Array.from(uniqueCompatibleIds).join(', ')}) matched offer. Manual review required.`
    },
    rankedCandidates: rankedResult.rankedCandidates,
    retrievalDiagnostics: diagnostics
  }
}

/**
 * Top-Level Two-Stage Product Matching Pipeline
 * Coordinates Stage 1 Retrieval, Stage 2 Validation/Ranking, and Deterministic Match Decision.
 */
export async function executeTwoStageProductMatch(
  offerInput: OfferCandidateSearchInput,
  options?: { supabaseClient?: any }
): Promise<TwoStageMatchResult> {
  // Stage 1: Retrieval
  const retrieval = await retrieveBroadCandidates(offerInput, options)

  // Stage 2: Validation & Ranking
  const validationAndRanking = validateAndRankCandidates(
    offerInput,
    retrieval.candidates,
    {
      isTruncated: retrieval.isTruncated,
      hasLookupFailure: retrieval.hasLookupFailure
    }
  )

  // Decision
  return evaluateTwoStageMatchDecision(offerInput, retrieval, validationAndRanking)
}
