import { getSupabaseAdminClient } from './supabaseAdminClient'
import { normalizeArabicText, normalizeEnglishText, isMeaningfulText } from '../../shared/utils/textNormalization'
import { ensureSlugFallback } from '../../shared/utils/slugify'
import type { EntityMatchIssue } from '../../shared/types/entityMatching'

export async function matchOrCreateCategory(input: {
  categoryNameAr: string | null
  categoryNameEn: string | null
  autoCreate: boolean
}): Promise<{
  categoryId: string | null
  created: boolean
  issues: EntityMatchIssue[]
}> {
  const issues: EntityMatchIssue[] = []
  
  if (!isMeaningfulText(input.categoryNameAr) && !isMeaningfulText(input.categoryNameEn)) {
    issues.push({
      severity: 'warning',
      code: 'CATEGORY_MATCH_UNCERTAIN',
      fieldName: 'category_id',
      message: 'Category names are missing.'
    })
    return { categoryId: null, created: false, issues }
  }

  const supabase = getSupabaseAdminClient()
  const normAr = normalizeArabicText(input.categoryNameAr)
  const normEn = normalizeEnglishText(input.categoryNameEn)

  // 1. Try exact match
  if (normEn) {
    const { data } = await supabase
      .from('categories')
      .select('id')
      .ilike('name_en', normEn)
      .limit(1)
      .maybeSingle()
      
    if (data) return { categoryId: data.id, created: false, issues }
  }

  if (normAr) {
    const { data } = await supabase
      .from('categories')
      .select('id')
      .ilike('name_ar', normAr)
      .limit(1)
      .maybeSingle()
      
    if (data) return { categoryId: data.id, created: false, issues }
  }

  // 2. Try slug match
  const slug = ensureSlugFallback({
    preferred: input.categoryNameEn,
    fallback: input.categoryNameAr,
    prefix: 'cat'
  })

  if (slug && slug !== 'cat') {
    const { data } = await supabase
      .from('categories')
      .select('id')
      .eq('slug', slug)
      .limit(1)
      .maybeSingle()

    if (data) return { categoryId: data.id, created: false, issues }
  }

  // 3. Auto create
  if (!input.autoCreate) {
    issues.push({
      severity: 'warning',
      code: 'CATEGORY_CREATE_DISABLED',
      fieldName: 'category_id',
      message: 'No category matched and category auto-creation is disabled.'
    })
    return { categoryId: null, created: false, issues }
  }

  // Generate unique slug
  let uniqueSlug = slug
  let counter = 1
  while (true) {
    const { count } = await supabase.from('categories').select('*', { count: 'exact', head: true }).eq('slug', uniqueSlug)
    if (!count || count === 0) break
    uniqueSlug = `${slug}-${counter}`
    counter++
  }

  const { data: newCategory, error } = await supabase
    .from('categories')
    .insert({
      name_ar: input.categoryNameAr || null,
      name_en: input.categoryNameEn || null,
      slug: uniqueSlug,
      is_active: true
    })
    .select('id')
    .single()

  if (error || !newCategory) {
    issues.push({
      severity: 'error',
      code: 'CATEGORY_CREATE_FAILED',
      fieldName: 'category_id',
      message: `Failed to create category: ${error?.message}`
    })
    return { categoryId: null, created: false, issues }
  }

  return { categoryId: newCategory.id, created: true, issues }
}
