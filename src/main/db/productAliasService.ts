import { getSupabaseAdminClient } from './supabaseAdminClient'
import { normalizeArabicText, normalizeEnglishText } from '../../shared/utils/textNormalization'
import type { EntityMatchIssue } from '../../shared/types/entityMatching'

export async function ensureProductAliases(
  input: {
    productId: string | number
    aliases: Array<{
      aliasText: string
      language: 'ar' | 'en' | 'mixed' | 'unknown'
      source: string
    }>
  },
  options?: { supabaseClient?: any }
): Promise<{
  createdCount: number
  issues: EntityMatchIssue[]
}> {
  const issues: EntityMatchIssue[] = []
  let createdCount = 0

  if (!input.aliases || input.aliases.length === 0) {
    return { createdCount, issues }
  }

  const supabase = options?.supabaseClient || getSupabaseAdminClient()

  for (const alias of input.aliases) {
    const text = alias.aliasText.trim()
    if (!text) continue

    const isArabic = alias.language === 'ar' || /[\u0600-\u06FF]/.test(text)
    const normText = isArabic ? normalizeArabicText(text) : normalizeEnglishText(text)

    // Build variants to check for existing aliases: raw text and normalized form
    const variants = Array.from(new Set([text, normText].filter(Boolean))) as string[]

    let existing: { id: string; product_id: string | number; alias_text?: string } | null = null

    // Check each variant to catch exact and orthographic variations (e.g. أ/إ/آ vs ا, ة vs ه)
    for (const v of variants) {
      let query = supabase.from('product_aliases').select('id, product_id, alias_text')
      if (typeof query.ilike === 'function') {
        query = query.ilike('alias_text', v)
      } else {
        query = query.eq('alias_text', v)
      }
      const { data } = await query.limit(26)
      if (data && data.length > 0) {
        existing = data[0]
        break
      }
    }

    // Also check all candidate aliases if not found yet (client-side normalization check for orthographic collisions)
    if (!existing) {
      const { data: allAliases } = await supabase.from('product_aliases').select('id, product_id, alias_text').limit(100)
      if (allAliases && allAliases.length > 0) {
        for (const a of allAliases) {
          const aText = a.alias_text || ''
          const aNorm = isArabic ? normalizeArabicText(aText) : normalizeEnglishText(aText)
          if (aNorm && normText && aNorm === normText) {
            existing = a
            break
          }
        }
      }
    }

    if (existing) {
      if (String(existing.product_id) === String(input.productId)) {
        continue // Already assigned to this product
      } else {
        issues.push({
          severity: 'warning',
          code: 'PRODUCT_ALIAS_CONFLICT',
          fieldName: 'product_id',
          message: `Alias "${text}" already points to different product ID ${existing.product_id}. Skipped to prevent alias conflict.`
        })
        continue // Block conflicting alias creation
      }
    }

    // Insert new
    const { error } = await supabase
      .from('product_aliases')
      .insert({
        product_id: input.productId,
        alias_text: text,
        language: alias.language,
        source: alias.source
      })

    if (error) {
      issues.push({
        severity: 'warning',
        code: 'PRODUCT_ALIAS_CREATE_FAILED',
        fieldName: 'product_id',
        message: `Failed to create alias "${text}": ${error.message}`
      })
    } else {
      createdCount++
    }
  }

  return { createdCount, issues }
}
