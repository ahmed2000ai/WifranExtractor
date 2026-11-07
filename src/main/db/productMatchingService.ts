import { getSupabaseAdminClient } from './supabaseAdminClient'
import { isMeaningfulText } from '../../shared/utils/textNormalization'
import { ensureSlugFallback } from '../../shared/utils/slugify'
import type { EntityMatchIssue } from '../../shared/types/entityMatching'
import { executeTwoStageProductMatch } from './twoStageCandidateRetrievalService'

export async function matchOrCreateProduct(
  input: {
    productNameAr: string | null
    productNameEn: string | null
    descriptionAr?: string | null
    descriptionEn?: string | null
    brandId?: string | null
    categoryId?: string | null
    packSizeValue?: number | null
    packSizeUnit?: string | null
    autoCreate?: boolean
    contractV2?: any
    assortmentStatus?: string | null
    exactIdentityStatus?: string | null
  },
  options?: { supabaseClient?: any }
): Promise<{
  productId: string | number | null
  created: boolean
  issues: EntityMatchIssue[]
}> {
  const issues: EntityMatchIssue[] = []

  // WIFRAN-04 §5, §6: Never auto-create SKU for assortments or unverified identities
  const assortmentStatus =
    input.contractV2?.assortment?.status ||
    input.assortmentStatus ||
    null

  const exactIdentityStatus =
    input.contractV2?.product_facts?.exact_identity_status ||
    input.exactIdentityStatus ||
    null

  const isAssortment =
    assortmentStatus &&
    ['assortment_indicated', 'indicated_with_conflict', 'choice_among_options', 'unknown_composition'].includes(assortmentStatus)

  const isUnresolvedIdentity =
    exactIdentityStatus && exactIdentityStatus !== 'verified_exact'

  if (isAssortment || isUnresolvedIdentity) {
    issues.push({
      severity: 'info',
      code: 'PRODUCT_CREATION_BYPASSED_ASSORTMENT',
      fieldName: 'product_id',
      message: 'Offer is an assortment or unresolved exact identity; product creation bypassed.'
    })
    return { productId: null, created: false, issues }
  }

  if (!isMeaningfulText(input.productNameAr) && !isMeaningfulText(input.productNameEn)) {
    issues.push({
      severity: 'error',
      code: 'PRODUCT_NAME_MISSING',
      fieldName: 'product_id',
      message: 'Product names are missing or empty.'
    })
    return { productId: null, created: false, issues }
  }

  const supabase = options?.supabaseClient || getSupabaseAdminClient()

  // Execute Two-Stage Candidate Retrieval, Validation, and Deterministic Ranking
  const twoStageRes = await executeTwoStageProductMatch(
    {
      titleEn: input.productNameEn,
      titleAr: input.productNameAr,
      brandId: input.brandId,
      eachSizeValue: input.packSizeValue,
      eachSizeUnit: input.packSizeUnit,
      contractV2: input.contractV2,
      assortmentStatus: input.assortmentStatus,
      exactIdentityStatus: input.exactIdentityStatus
    },
    { supabaseClient: supabase }
  )

  if (twoStageRes.retrievalDiagnostics.hasLookupFailure) {
    issues.push({
      severity: 'error',
      code: 'PRODUCT_LOOKUP_FAILED',
      fieldName: 'product_id',
      message: 'Database query error during candidate retrieval. Auto-match blocked.'
    })
    return { productId: null, created: false, issues }
  }

  if (twoStageRes.retrievalDiagnostics.isTruncated) {
    issues.push({
      severity: 'warning',
      code: 'PRODUCT_CANDIDATE_SEARCH_INCOMPLETE',
      fieldName: 'product_id',
      message: 'Candidate search exceeded limit of 25 products (results truncated). Auto-match blocked.'
    })
    return { productId: null, created: false, issues }
  }

  if (twoStageRes.matchedProduct) {
    return { productId: twoStageRes.matchedProduct.id, created: false, issues }
  }

  if (
    twoStageRes.result.status !== 'verified_compatible' &&
    twoStageRes.result.status !== 'no_eligible_candidate'
  ) {
    issues.push({
      severity: 'info',
      code: 'PRODUCT_MATCH_REJECTED',
      fieldName: 'product_id',
      message: twoStageRes.result.reason
    })
  }

  // 5. Auto create
  if (!input.autoCreate) {
    issues.push({
      severity: 'error', // Product is required for valid offers
      code: 'PRODUCT_MATCH_UNCERTAIN',
      fieldName: 'product_id',
      message: 'No confident product match found and auto-create is disabled.'
    })
    return { productId: null, created: false, issues }
  }

  // Generate unique slug
  const baseSlug = ensureSlugFallback({
    preferred: input.productNameEn,
    fallback: input.productNameAr,
    prefix: 'product'
  })
  let uniqueSlug = baseSlug
  let counter = 1
  while (true) {
    const { count } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('slug', uniqueSlug)
    if (!count || count === 0) break
    uniqueSlug = `${baseSlug}-${counter}`
    counter++
  }

  const { data: newProduct, error } = await supabase
    .from('products')
    .insert({
      name_ar: input.productNameAr || null,
      name_en: input.productNameEn || null,
      description_ar: input.descriptionAr || null,
      description_en: input.descriptionEn || null,
      brand_id: input.brandId,
      category_id: input.categoryId,
      default_pack_size_value: input.packSizeValue || null,
      default_pack_size_unit: input.packSizeUnit || null,
      slug: uniqueSlug,
      is_normalized: false,
      is_active: true
    })
    .select('id')
    .single()

  if (error || !newProduct) {
    issues.push({
      severity: 'error',
      code: 'PRODUCT_CREATE_FAILED',
      fieldName: 'product_id',
      message: `Failed to create product: ${error?.message}`
    })
    return { productId: null, created: false, issues }
  }

  return { productId: newProduct.id, created: true, issues }
}
