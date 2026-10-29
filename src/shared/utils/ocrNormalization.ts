import { z } from 'zod'
import { VALIDATION_CODES } from '../schemas/validationCodes'
import { ocrExtractionResponseSchema } from '../schemas/ocrSchema'
import type { 
  OcrExtractionResponse, 
  OcrExtractedItem, 
  NormalizedOcrRow, 
  NormalizedOcrRowIssue, 
  NormalizedOcrRowStatus 
} from '../types/ocr'
import { classifyPromotionalArea } from './promotionalFilter'
import { normalizeToCanonicalOffer } from './canonicalOfferNormalizer'

/**
 * Calculates the Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      )
    }
  }

  return matrix[a.length][b.length]
}

/**
 * Returns true if the two strings are highly similar based on length and Levenshtein distance.
 */
function isHighlySimilar(str1: string | null | undefined, str2: string | null | undefined): boolean {
  if (!str1 || !str2) return false
  if (str1 === str2) return true
  
  const s1 = str1.trim().toLowerCase()
  const s2 = str2.trim().toLowerCase()
  if (s1 === s2) return true

  // Substring check for longer words (e.g., "Froot Loops" inside "Kelloggs Froot Loops")
  if (s1.length > 5 && s2.length > 5) {
    if (s1.includes(s2) || s2.includes(s1)) return true
  }

  const dist = levenshtein(s1, s2)
  const maxLength = Math.max(s1.length, s2.length)
  
  // Allow ~25% error (e.g. 2 typos in an 8 char string)
  const threshold = Math.max(1, Math.floor(maxLength * 0.25))
  return dist <= threshold
}

export function normalizeOcrExtractionResponse(response: unknown): {
  ok: boolean
  items: OcrExtractedItem[]
  rows: NormalizedOcrRow[]
  errors: NormalizedOcrRowIssue[]
} {
  try {
    const parsedResponse = ocrExtractionResponseSchema.parse(response) as OcrExtractionResponse
    const rows: NormalizedOcrRow[] = []

    for (const item of parsedResponse.items) {
      // 1. Call the new canonical normalizer
      const canonical = normalizeToCanonicalOffer({
        rawOcrJson: item,
        source: {
          sourceItemNumber: item.row_id,
          sourcePageNumber: item.page_number
        }
      })

      // 2. Map CanonicalOffer back to NormalizedOcrRow for downstream DB prep code
      const warnings: NormalizedOcrRowIssue[] = []
      const errors: NormalizedOcrRowIssue[] = []
      let status: NormalizedOcrRowStatus = 'valid'
      let skipReason: string | null = null

      // Carry over model blocking errors as our own blocking errors
      if (canonical.quality.blocking_errors.length > 0) {
        status = 'error'
        errors.push(...canonical.quality.blocking_errors.map(e => ({
          severity: 'error' as const,
          code: e.code,
          message: e.message,
          field_name: e.field_name
        })))
      }

      // Carry over model warnings
      if (canonical.quality.non_blocking_warnings.length > 0) {
        if (status !== 'error') status = 'warning'
        warnings.push(...canonical.quality.non_blocking_warnings.map(w => ({
          severity: 'warning' as const,
          code: w.code,
          message: w.message,
          field_name: w.field_name
        })))
      }

      // Re-apply promotional area filter for legacy compatibility
      const promoDecision = classifyPromotionalArea(item)
      if (promoDecision.isNonProductPromotionalArea) {
        status = 'skipped'
        skipReason = promoDecision.reasonCode || VALIDATION_CODES.NON_PRODUCT_PROMOTIONAL_AREA
        warnings.push({
          severity: 'info',
          code: promoDecision.reasonCode || VALIDATION_CODES.NON_PRODUCT_PROMOTIONAL_AREA,
          message: promoDecision.reasons.join(', ') || 'Non-product promotional area'
        })
      } else if (promoDecision.reasonCode === VALIDATION_CODES.POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA) {
        warnings.push({
          severity: 'warning',
          code: VALIDATION_CODES.POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA,
          message: promoDecision.reasons.join(', ')
        })
      }

      const hasNameOrDesc = !!(canonical.product.title_ar || canonical.product.title_en || canonical.product.description_ar || canonical.product.description_en)
      const hasPrice = canonical.prices.offer_price !== null

      if (!hasNameOrDesc && !hasPrice && status !== 'skipped') {
        continue // Truly empty item — skip entirely
      }

      // Quality score (simplified based on canonical fields)
      let score = 0
      if (canonical.product.title_ar || canonical.product.title_en) score += 20
      if (canonical.prices.offer_price !== null && canonical.prices.offer_price > 0) score += 20
      if (canonical.prices.original_price !== null) score += 10
      if (canonical.product.brand_text) score += 10
      if (canonical.product.category_hint) score += 10
      if (canonical.content.size_text) score += 10
      if (item.bounding_box) score += 10

      const normalizedRow: NormalizedOcrRow = {
        source: {
          page_number: Math.max(1, item.page_number || 1),
          row_id: item.row_id,
          source_reference: (item as any).source_reference || null
        },
        original: item, // Keep the original for bounding boxes
        status,
        skip_reason: skipReason,
        offer: status === 'skipped' ? null : {
          title_ar: canonical.product.title_ar,
          title_en: canonical.product.title_en,
          offer_price: canonical.prices.offer_price,
          original_price: canonical.prices.original_price,
          discount_amount: canonical.prices.discount_amount,
          discount_percentage: canonical.prices.discount_percentage,
          pack_size_value: canonical.content.each_size_value,
          pack_size_unit: canonical.content.each_size_unit,
          pack_quantity: canonical.content.pack_quantity,
          notes_ar: canonical.product.description_ar || null,
          notes_en: canonical.product.description_en || null,
          data_quality_score: Math.min(100, score)
        },
        bounding_box: item.bounding_box || null,
        warnings,
        errors
      }

      rows.push(normalizedRow)
    }

    // Final Deduplication Pass:
    const uniqueRows: NormalizedOcrRow[] = []
    for (const row of rows) {
      if (row.status === 'skipped' || !row.offer) {
        uniqueRows.push(row)
        continue
      }
      
      const isDuplicate = uniqueRows.some(existing => {
        if (existing.status === 'skipped' || !existing.offer) return false
        if (existing.source.page_number !== row.source.page_number) return false
        
        if (existing.offer?.offer_price !== row.offer?.offer_price) return false
        
        const hasArMatch = isHighlySimilar(existing.offer?.title_ar, row.offer?.title_ar)
        const hasEnMatch = isHighlySimilar(existing.offer?.title_en, row.offer?.title_en)
        
        return hasArMatch || hasEnMatch
      })

      if (!isDuplicate) {
        uniqueRows.push(row)
      } else {
        console.log(`[Normalization] Dropped identical duplicate: ${row.offer?.title_ar || row.offer?.title_en} (${row.offer?.offer_price})`)
      }
    }

    return {
      ok: true,
      items: parsedResponse.items,
      rows: uniqueRows,
      errors: []
    }
  } catch (err: any) {
    let message = err.message
    if (err instanceof z.ZodError) {
      message = err.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
    }
    return {
      ok: false,
      items: [],
      rows: [],
      errors: [{ severity: 'error', code: VALIDATION_CODES.INVALID_JSON, message: `Failed to parse OCR response: ${message}` }]
    }
  }
}
