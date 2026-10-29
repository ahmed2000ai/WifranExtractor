import { getSupabaseAdminClient } from './supabaseAdminClient'
import { normalizeArabicText, normalizeEnglishText, isMeaningfulText } from '../../shared/utils/textNormalization'
import { ensureSlugFallback } from '../../shared/utils/slugify'
import type { EntityMatchIssue } from '../../shared/types/entityMatching'

export async function matchOrCreateBrand(input: {
  brandNameAr: string | null
  brandNameEn: string | null
  autoCreate: boolean
  brandState?: 'supported' | 'unknown' | 'conflicting'
  candidateUnverified?: string | null
  contractV2?: any
}): Promise<{
  brandId: string | null
  created: boolean
  issues: EntityMatchIssue[]
}> {
  const issues: EntityMatchIssue[] = []
  
  // WIFRAN-04 §5, §6: Only match or auto-create a brand when brand is supported
  const brandState = input.contractV2?.product_facts?.brand_assertion?.state || input.brandState
  const candidateUnverified = input.contractV2?.product_facts?.brand_assertion?.candidate_unverified || input.candidateUnverified

  if (brandState && brandState !== 'supported') {
    issues.push({
      severity: 'info',
      code: 'BRAND_NOT_SUPPORTED',
      fieldName: 'brand_id',
      message: `Brand state is '${brandState}'; match and creation bypassed.`
    })
    return { brandId: null, created: false, issues }
  }

  if (candidateUnverified && (!brandState || brandState !== 'supported')) {
    issues.push({
      severity: 'info',
      code: 'BRAND_UNVERIFIED_CANDIDATE',
      fieldName: 'brand_id',
      message: 'Candidate brand text is unverified; auto-creation blocked.'
    })
    return { brandId: null, created: false, issues }
  }

  if (!isMeaningfulText(input.brandNameAr) && !isMeaningfulText(input.brandNameEn)) {
    return { brandId: null, created: false, issues }
  }

  const supabase = getSupabaseAdminClient()
  const normAr = normalizeArabicText(input.brandNameAr)
  const normEn = normalizeEnglishText(input.brandNameEn)

  // 1. Try exact match
  if (normEn) {
    const { data } = await supabase
      .from('brands')
      .select('id')
      .ilike('name_en', normEn)
      .limit(1)
      .maybeSingle()
      
    if (data) return { brandId: data.id, created: false, issues }
  }

  if (normAr) {
    const { data } = await supabase
      .from('brands')
      .select('id')
      .ilike('name_ar', normAr)
      .limit(1)
      .maybeSingle()
      
    if (data) return { brandId: data.id, created: false, issues }
  }

  // 2. Try slug match
  const slug = ensureSlugFallback({
    preferred: input.brandNameEn,
    fallback: input.brandNameAr,
    prefix: 'brand'
  })

  if (slug && slug !== 'brand') {
    const { data } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', slug)
      .limit(1)
      .maybeSingle()

    if (data) return { brandId: data.id, created: false, issues }
  }

  // 3. Auto create
  if (!input.autoCreate) {
    issues.push({
      severity: 'warning',
      code: 'BRAND_MATCH_UNCERTAIN',
      fieldName: 'brand_id',
      message: 'No brand matched and auto-create is disabled.'
    })
    return { brandId: null, created: false, issues }
  }

  // Generate unique slug
  let uniqueSlug = slug
  let counter = 1
  while (true) {
    const { count } = await supabase.from('brands').select('*', { count: 'exact', head: true }).eq('slug', uniqueSlug)
    if (!count || count === 0) break
    uniqueSlug = `${slug}-${counter}`
    counter++
  }

  const { data: newBrand, error } = await supabase
    .from('brands')
    .insert({
      name_ar: input.brandNameAr || null,
      name_en: input.brandNameEn || null,
      slug: uniqueSlug,
      is_active: true
    })
    .select('id')
    .single()

  if (error || !newBrand) {
    issues.push({
      severity: 'error',
      code: 'BRAND_CREATE_FAILED',
      fieldName: 'brand_id',
      message: `Failed to create brand: ${error?.message}`
    })
    return { brandId: null, created: false, issues }
  }

  return { brandId: newBrand.id, created: true, issues }
}
