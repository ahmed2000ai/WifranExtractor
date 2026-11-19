/**
 * Source Identity & Duplicate Prevention Utilities
 * Milestone: WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08 (ID-01..03, DUP-01, DUP-02)
 */

export interface PreExtractionCompatibilityProfile {
  pipelineMode: 'hybrid_v3' | 'legacy_rev1'
  modelId: string
  promptVersion: string
  schemaVersion: string
  coordinateSpace?: 'norm_0_1000' | 'pixel_space'
}

export const CURRENT_HYBRID_COMPATIBILITY_PROFILE: PreExtractionCompatibilityProfile = {
  pipelineMode: 'hybrid_v3',
  modelId: 'gemini-3.8-flash',
  promptVersion: 'hybrid-v3.2',
  schemaVersion: 'wifran.v3.1',
  coordinateSpace: 'norm_0_1000'
}

function fnv1a64Hex(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b1
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 ^= ch
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= ch + (i & 0xff)
    h2 = Math.imul(h2, 0x85ebca6b)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

/**
 * Normalizes a leaflet filename for DUP-01A duplicate filename detection
 * (path-stripped, lowercase, whitespace/underscore collapsed, copy suffixes ignored optionally).
 */
export function normalizeFileNameForDuplicateCheck(fileNameOrPath: string): {
  exactBaseLower: string
  normalizedStem: string
} {
  const base = (fileNameOrPath || '').split(/[\\/]/).pop()?.trim() || ''
  const exactBaseLower = base.toLowerCase()
  let stem = exactBaseLower.replace(/\.pdf$/i, '')
  let prev = ''
  while (stem !== prev) {
    prev = stem
    stem = stem
      .replace(/\s*\(\d+\)\s*$/i, '')
      .replace(/(?:[-_\s]+(?:copy|duplicate|v\d+))+$/i, '')
      .trim()
  }
  const normalizedStem = stem
    .replace(/[\s_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return { exactBaseLower, normalizedStem }
}

/**
 * Derives canonical document ID `doc_<16hex>` anchored on PDF SHA-256 content fingerprint.
 */
export function computeDocumentIdFromFingerprint(
  fileFingerprint?: string | null,
  fallbackFileName?: string | null
): string {
  const fp = (fileFingerprint || '').trim()
  if (fp && fp.toLowerCase() !== 'unknown' && fp.toLowerCase() !== 'null') {
    if (/^[a-f0-9]{16,}$/i.test(fp)) {
      return `doc_${fp.toLowerCase().slice(0, 16)}`
    }
    return `doc_${fnv1a64Hex(fp)}`
  }
  const base = normalizeFileNameForDuplicateCheck(fallbackFileName || '').exactBaseLower
  if (base) {
    return `doc_${fnv1a64Hex(base)}`
  }
  return 'doc_unidentified'
}

export function normalizeTextForAnchor(text?: string | null): string {
  if (!text) return ''
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function quantizeNormalizedBbox(
  bbox?: readonly number[] | null,
  gridBuckets = 10
): string | null {
  if (!Array.isArray(bbox) || bbox.length < 4) return null
  const vals = bbox.slice(0, 4).map((v) => Number(v))
  if (vals.some((v) => !Number.isFinite(v))) return null
  const maxVal = Math.max(...vals.map((v) => Math.abs(v)))
  // Support 0..1 and 0..1000 normalized boxes cleanly
  const scale = maxVal <= 1.05 ? gridBuckets : gridBuckets / 1000
  return vals
    .map((v) => Math.max(0, Math.min(gridBuckets, Math.round(v * scale))))
    .join(',')
}

/**
 * Computes a stable, array-index-independent semantic+spatial anchor for an offer card on a page.
 * Ensures re-extracting the same leaflet yields consistent identity even if OCR returns cards in another order.
 */
export function computeOfferAnchorSignature(params: {
  sourcePage?: number | null
  supermarketId?: string | null
  titleEn?: string | null
  titleAr?: string | null
  brand?: string | null
  promoPrice?: number | null
  originalPrice?: number | null
  sizeOrWeight?: string | null
  bboxNorm?: readonly number[] | null
  fallbackRawId?: string | null
}): string {
  const titleAnchor =
    normalizeTextForAnchor(params.titleEn) || normalizeTextForAnchor(params.titleAr) || ''
  const brandAnchor = normalizeTextForAnchor(params.brand)
  const sizeAnchor = normalizeTextForAnchor(params.sizeOrWeight)
  const priceAnchor =
    typeof params.promoPrice === 'number' && Number.isFinite(params.promoPrice)
      ? params.promoPrice.toFixed(2)
      : 'np'
  const origAnchor =
    typeof params.originalPrice === 'number' && Number.isFinite(params.originalPrice)
      ? params.originalPrice.toFixed(2)
      : 'no'
  const bboxAnchor = quantizeNormalizedBbox(params.bboxNorm) || 'nb'
  const pageAnchor = String(Math.max(1, Number(params.sourcePage) || 1))
  const retailerAnchor = (params.supermarketId || '').trim().toLowerCase() || 'nr'

  const semanticPayload = [
    retailerAnchor,
    `p${pageAnchor}`,
    brandAnchor,
    titleAnchor,
    sizeAnchor,
    priceAnchor,
    origAnchor,
    bboxAnchor
  ].join('|')

  if (titleAnchor || bboxAnchor !== 'nb') {
    return `anc_${fnv1a64Hex(semanticPayload).slice(0, 12)}`
  }
  return `anc_${fnv1a64Hex(`${pageAnchor}|${params.fallbackRawId || ''}`).slice(0, 12)}`
}

export function isArtifactProfileCompatible(
  recorded: Partial<PreExtractionCompatibilityProfile> | null | undefined,
  current: PreExtractionCompatibilityProfile = CURRENT_HYBRID_COMPATIBILITY_PROFILE
): { compatible: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (!recorded) {
    return { compatible: false, reasons: ['Missing extraction profile metadata.'] }
  }
  if (recorded.pipelineMode && recorded.pipelineMode !== current.pipelineMode) {
    reasons.push(`Pipeline changed (${recorded.pipelineMode} != ${current.pipelineMode}).`)
  }
  if (recorded.modelId && recorded.modelId !== current.modelId) {
    reasons.push(`Model changed (${recorded.modelId} != ${current.modelId}).`)
  }
  if (recorded.promptVersion && recorded.promptVersion !== current.promptVersion) {
    reasons.push(`Prompt version changed (${recorded.promptVersion} != ${current.promptVersion}).`)
  }
  if (recorded.schemaVersion && recorded.schemaVersion !== current.schemaVersion) {
    reasons.push(`Schema version changed (${recorded.schemaVersion} != ${current.schemaVersion}).`)
  }
  if (
    recorded.coordinateSpace &&
    current.coordinateSpace &&
    recorded.coordinateSpace !== current.coordinateSpace
  ) {
    reasons.push(`Coordinate space changed (${recorded.coordinateSpace} != ${current.coordinateSpace}).`)
  }
  return { compatible: reasons.length === 0, reasons }
}
