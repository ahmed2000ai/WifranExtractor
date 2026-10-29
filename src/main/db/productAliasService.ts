import { getSupabaseAdminClient } from './supabaseAdminClient'
import type { EntityMatchIssue } from '../../shared/types/entityMatching'

export async function ensureProductAliases(input: {
  productId: string
  aliases: Array<{
    aliasText: string
    language: 'ar' | 'en' | 'mixed' | 'unknown'
    source: string
  }>
}): Promise<{
  createdCount: number
  issues: EntityMatchIssue[]
}> {
  const issues: EntityMatchIssue[] = []
  let createdCount = 0

  if (!input.aliases || input.aliases.length === 0) {
    return { createdCount, issues }
  }

  const supabase = getSupabaseAdminClient()

  for (const alias of input.aliases) {
    const text = alias.aliasText.trim()
    if (!text) continue

    // Check if exists
    const { data: existing } = await supabase
      .from('product_aliases')
      .select('id')
      .eq('product_id', input.productId)
      .eq('alias_text', text)
      .limit(1)
      .maybeSingle()

    if (existing) continue

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
