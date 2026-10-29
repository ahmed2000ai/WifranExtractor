import { getSupabaseAdminClient } from './supabaseAdminClient'
import { normalizeArabicText, normalizeEnglishText, isMeaningfulText } from '../../shared/utils/textNormalization'
import { ensureSlugFallback } from '../../shared/utils/slugify'
import type { EntityMatchIssue } from '../../shared/types/entityMatching'

export async function matchOrCreateProduct(input: {
  productNameAr: string | null
  productNameEn: string | null
  descriptionAr?: string | null
  descriptionEn?: string | null
  brandId: string | null
  categoryId: string | null
  packSizeValue?: number | null
  packSizeUnit?: string | null
  autoCreate: boolean
  contractV2?: any
  assortmentStatus?: string | null
  exactIdentityStatus?: string | null
}): Promise<{
  productId: string | null
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

  const supabase = getSupabaseAdminClient()
  const normAr = normalizeArabicText(input.productNameAr)
  const normEn = normalizeEnglishText(input.productNameEn)

  // 1. Try alias match first
  if (normAr) {
    const { data } = await supabase
      .from('product_aliases')
      .select('product_id')
      .ilike('alias_text', normAr)
      .limit(1)
      .maybeSingle()
    if (data?.product_id) return { productId: data.product_id, created: false, issues }
  }

  if (normEn) {
    const { data } = await supabase
      .from('product_aliases')
      .select('product_id')
      .ilike('alias_text', normEn)
      .limit(1)
      .maybeSingle()
    if (data?.product_id) return { productId: data.product_id, created: false, issues }
  }

  // 2. Exact name match
  if (normEn) {
    const { data } = await supabase
      .from('products')
      .select('id')
      .ilike('name_en', normEn)
      .limit(1)
      .maybeSingle()
    if (data) return { productId: data.id, created: false, issues }
  }

  if (normAr) {
    const { data } = await supabase
      .from('products')
      .select('id')
      .ilike('name_ar', normAr)
      .limit(1)
      .maybeSingle()
    if (data) return { productId: data.id, created: false, issues }
  }

  // 3. Slug match
  const slug = ensureSlugFallback({
    preferred: input.productNameEn,
    fallback: input.productNameAr,
    prefix: 'product'
  })

  if (slug && slug !== 'product') {
    const { data } = await supabase
      .from('products')
      .select('id')
      .eq('slug', slug)
      .limit(1)
      .maybeSingle()
    if (data) return { productId: data.id, created: false, issues }
  }

  // 4. Match by brand + name
  if (input.brandId && (normAr || normEn)) {
    let query = supabase.from('products').select('id').eq('brand_id', input.brandId)
    if (normAr) query = query.ilike('name_ar', normAr)
    else query = query.ilike('name_en', normEn!)

    const { data } = await query.limit(1).maybeSingle()
    if (data) return { productId: data.id, created: false, issues }
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
  let uniqueSlug = slug
  let counter = 1
  while (true) {
    const { count } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('slug', uniqueSlug)
    if (!count || count === 0) break
    uniqueSlug = `${slug}-${counter}`
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
