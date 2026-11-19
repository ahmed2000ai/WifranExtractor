/**
 * Safe Extraction of Item-Matched Raw Attributes
 *
 * Real canonical JSON files store raw page-level arrays (`raw_extraction_json`)
 * or single-offer objects (`raw_offer_extraction`). This helper resolves ONLY
 * the entry matching the specific canonical offer to avoid cross-item bleed.
 */

export function findMatchingRawExtractionEntry(canonical: any): Record<string, any> | null {
  if (!canonical || typeof canonical !== 'object') return null

  const rawAttrs = canonical.raw?.raw_attributes || canonical.raw_attributes || null
  if (!rawAttrs || typeof rawAttrs !== 'object') return null

  if (rawAttrs.raw_offer_extraction && typeof rawAttrs.raw_offer_extraction === 'object') {
    return rawAttrs.raw_offer_extraction as Record<string, any>
  }

  const rawArr = rawAttrs.raw_extraction_json
  if (!Array.isArray(rawArr) || rawArr.length === 0) return null

  const titleEn = String(
    canonical.product?.title_en ||
      canonical.product?.product_name_en ||
      canonical.titleEn ||
      ''
  )
    .trim()
    .toLowerCase()
  const titleAr = String(
    canonical.product?.title_ar ||
      canonical.product?.product_name_ar ||
      canonical.titleAr ||
      ''
  ).trim()

  const exactTitleMatch = rawArr.find((entry: any) => {
    if (!entry || typeof entry !== 'object') return false
    const entryEn = String(entry.english_title || entry.title_en || '').trim().toLowerCase()
    const entryAr = String(entry.arabic_title || entry.title_ar || '').trim()
    return (titleEn.length > 0 && entryEn === titleEn) || (titleAr.length > 0 && entryAr === titleAr)
  })
  if (exactTitleMatch) return exactTitleMatch as Record<string, any>

  if (rawArr.length === 1) {
    return rawArr[0] as Record<string, any>
  }

  const itemNum = Number(canonical.source?.source_item_number ?? canonical.sourceOfferId)
  if (Number.isFinite(itemNum)) {
    const byOfferNum = rawArr.find((entry: any) => entry && Number(entry.offer_number) === itemNum)
    if (byOfferNum) return byOfferNum as Record<string, any>
  }

  return null
}

