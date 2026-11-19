/**
 * Pre-Publication Database Duplicate & Diff Reconciler
 * Milestone: WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08 (DUP-02A..E)
 *
 * Classifies approved batch offers against the live/isolated target PostgreSQL database into:
 * - new: Not present in target DB
 * - already_published: Exact match by source_offer_id with zero semantic diff -> strict no-op skip
 * - update_candidate: Same source_offer_id with changed commercial/product fields -> itemized diff
 * - duplicate_conflict: Distinct source_offer_id colliding logically with active published offer
 *   (same retailer + product/title + overlapping dates + scope + pack/variant/loyalty)
 */

import type { UnifiedBatchOffer } from '../../shared/types/batchExtraction'
import { computeStableSourceOfferId } from '../../shared/utils/nonCatalogPublicationPolicy'
import { normalizeTextForAnchor } from '../../shared/utils/sourceIdentityAndDuplicateUtils'
import type { SqlQueryable } from './schemaCompatibilityService'

export type PrePublicationOfferClassification =
  | 'new'
  | 'already_published'
  | 'update_candidate'
  | 'duplicate_conflict'

export interface OfferFieldDiff {
  field: string
  before: unknown
  after: unknown
}

export interface OfferReconciliationEntry {
  batchOfferKey: string
  sourceOfferId: string
  classification: PrePublicationOfferClassification
  existingOfferId: string | null
  existingSourceOfferId: string | null
  existingCatalogMatchStatus: string | null
  reason: string
  fieldDiffs: OfferFieldDiff[]
}

export interface PrePublicationReconciliationSummary {
  checkedAt: string
  totalEvaluated: number
  newCount: number
  alreadyPublishedCount: number
  updateCandidateCount: number
  duplicateConflictCount: number
  entries: OfferReconciliationEntry[]
  byBatchOfferKey: Record<string, OfferReconciliationEntry>
}

export interface CandidateOfferSnapshot {
  batchOfferKey: string
  sourceOfferId: string
  supermarketId: string
  cityId: string | null
  regionId: string | null
  locationScope: string
  productId: number | null
  titleAr: string
  titleEn: string
  offerStartDate: string | null
  offerEndDate: string | null
  offerPrice: number
  originalPrice: number | null
  unitPrice?: number | null
  unitPriceUnit?: string | null
  catalogMatchStatus: string
  saleUnitType: string | null
  innerPackCount: number | null
  eachSizeValue: number | null
  eachSizeUnit: string | null
  isLoyaltyRequired: boolean
  promoMechanic: string | null
  quantityLimitValue: number | null
}

function normVal(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(4).replace(/\.?0+$/, '') : ''
  return String(v).trim()
}

function normNumeric(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(4).replace(/\.?0+$/, '') : ''
}

function normDate(v: unknown): string {
  if (!v) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  return s.length >= 10 ? s.slice(0, 10) : s
}

function datesOverlap(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null
): boolean {
  const s1 = normDate(aStart) || '0000-01-01'
  const e1 = normDate(aEnd) || '9999-12-31'
  const s2 = normDate(bStart) || '0000-01-01'
  const e2 = normDate(bEnd) || '9999-12-31'
  return s1 <= e2 && s2 <= e1
}

export function computeOfferFieldDiffs(
  existingRow: Record<string, any>,
  candidate: CandidateOfferSnapshot
): OfferFieldDiff[] {
  const comparisons: Array<[string, unknown, unknown, boolean?]> = [
    ['supermarket_id', existingRow.supermarket_id, candidate.supermarketId],
    ['city_id', existingRow.city_id, candidate.cityId],
    ['region_id', existingRow.region_id, candidate.regionId],
    ['location_scope', existingRow.location_scope, candidate.locationScope],
    ['product_id', existingRow.product_id, candidate.productId, true],
    ['title_ar', existingRow.title_ar, candidate.titleAr],
    ['title_en', existingRow.title_en, candidate.titleEn],
    ['offer_start_date', normDate(existingRow._offer_start_date_txt ?? existingRow.offer_start_date), normDate(candidate.offerStartDate)],
    ['offer_end_date', normDate(existingRow._offer_end_date_txt ?? existingRow.offer_end_date), normDate(candidate.offerEndDate)],
    ['offer_price', existingRow.offer_price, candidate.offerPrice, true],
    ['original_price', existingRow.original_price, candidate.originalPrice, true],
    ['unit_price', existingRow.unit_price, candidate.unitPrice ?? null, true],
    ['unit_price_unit', existingRow.unit_price_unit, candidate.unitPriceUnit ?? null],
    ['catalog_match_status', existingRow.catalog_match_status, candidate.catalogMatchStatus],
    ['sale_unit_type', existingRow.sale_unit_type, candidate.saleUnitType],
    ['inner_pack_count', existingRow.inner_pack_count, candidate.innerPackCount, true],
    ['each_size_value', existingRow.each_size_value, candidate.eachSizeValue, true],
    ['each_size_unit', existingRow.each_size_unit, candidate.eachSizeUnit],
    ['is_loyalty_required', Boolean(existingRow.is_loyalty_required), Boolean(candidate.isLoyaltyRequired)],
    ['promo_mechanic', existingRow.promo_mechanic, candidate.promoMechanic],
    ['quantity_limit_value', existingRow.quantity_limit_value, candidate.quantityLimitValue, true]
  ]

  const diffs: OfferFieldDiff[] = []
  for (const [field, before, after, isNum] of comparisons) {
    const bNorm = isNum ? normNumeric(before) : normVal(before)
    const aNorm = isNum ? normNumeric(after) : normVal(after)
    if (bNorm !== aNorm) {
      diffs.push({ field, before: before ?? null, after: after ?? null })
    }
  }
  return diffs
}

export async function reconcileOffersAgainstDatabase(params: {
  client: SqlQueryable
  candidates: CandidateOfferSnapshot[]
}): Promise<PrePublicationReconciliationSummary> {
  const checkedAt = new Date().toISOString()
  const entries: OfferReconciliationEntry[] = []
  const byBatchOfferKey: Record<string, OfferReconciliationEntry> = {}

  if (params.candidates.length === 0) {
    return {
      checkedAt,
      totalEvaluated: 0,
      newCount: 0,
      alreadyPublishedCount: 0,
      updateCandidateCount: 0,
      duplicateConflictCount: 0,
      entries: [],
      byBatchOfferKey: {}
    }
  }

  const sourceIds = Array.from(new Set(params.candidates.map((c) => c.sourceOfferId).filter(Boolean)))
  const existingBySourceRes = await params.client.query<Record<string, any>>(
    `SELECT *, offer_start_date::text AS _offer_start_date_txt, offer_end_date::text AS _offer_end_date_txt
     FROM public.offers
     WHERE source_offer_id = ANY($1::text[])`,
    [sourceIds]
  )
  const existingBySourceId = new Map<string, Record<string, any>>()
  for (const row of existingBySourceRes.rows) {
    if (row.source_offer_id) {
      existingBySourceId.set(String(row.source_offer_id), row)
    }
  }

  // Secondary candidate pool: active published/approved offers for participating supermarkets
  const supermarketIds = Array.from(
    new Set(params.candidates.map((c) => c.supermarketId).filter(Boolean))
  )
  const secondaryRes =
    supermarketIds.length > 0
      ? await params.client.query<Record<string, any>>(
          `SELECT id, source_offer_id, supermarket_id, city_id, region_id, location_scope,
                  product_id, title_en, title_ar,
                  offer_start_date::text AS offer_start_date,
                  offer_end_date::text AS offer_end_date,
                  offer_price, inner_pack_count, each_size_value, each_size_unit,
                  is_loyalty_required, promo_mechanic, catalog_match_status
           FROM public.offers
           WHERE supermarket_id::text = ANY($1::text[])
             AND status IN ('published', 'approved')`,
          [supermarketIds]
        )
      : { rows: [] }

  let newCount = 0
  let alreadyPublishedCount = 0
  let updateCandidateCount = 0
  let duplicateConflictCount = 0

  for (const candidate of params.candidates) {
    const exactMatch = existingBySourceId.get(candidate.sourceOfferId)
    if (exactMatch) {
      const diffs = computeOfferFieldDiffs(exactMatch, candidate)
      // Preserve non-catalog protection: if existing is verified_linked and incoming lacks productId, treat as skip/already_published
      const protectedVerified =
        candidate.productId == null &&
        exactMatch.catalog_match_status === 'verified_linked' &&
        exactMatch.product_id != null

      if (diffs.length === 0 || protectedVerified) {
        const entry: OfferReconciliationEntry = {
          batchOfferKey: candidate.batchOfferKey,
          sourceOfferId: candidate.sourceOfferId,
          classification: 'already_published',
          existingOfferId: String(exactMatch.id),
          existingSourceOfferId: candidate.sourceOfferId,
          existingCatalogMatchStatus: exactMatch.catalog_match_status || null,
          reason: protectedVerified
            ? 'Already verified-linked in target database; protected from non-catalog downgrade.'
            : 'Identical source_offer_id and commercial/product attributes already published (no-op).',
          fieldDiffs: []
        }
        alreadyPublishedCount++
        entries.push(entry)
        byBatchOfferKey[candidate.batchOfferKey] = entry
      } else {
        const entry: OfferReconciliationEntry = {
          batchOfferKey: candidate.batchOfferKey,
          sourceOfferId: candidate.sourceOfferId,
          classification: 'update_candidate',
          existingOfferId: String(exactMatch.id),
          existingSourceOfferId: candidate.sourceOfferId,
          existingCatalogMatchStatus: exactMatch.catalog_match_status || null,
          reason: `Existing offer ${candidate.sourceOfferId} differs on ${diffs.map((d) => d.field).join(', ')}.`,
          fieldDiffs: diffs
        }
        updateCandidateCount++
        entries.push(entry)
        byBatchOfferKey[candidate.batchOfferKey] = entry
      }
      continue
    }

    // DUP-02D: Secondary logical conflict check across distinct source_offer_id
    const candTitleNorm = normalizeTextForAnchor(candidate.titleEn || candidate.titleAr)
    const logicalConflict = secondaryRes.rows.find((row) => {
      if (row.source_offer_id === candidate.sourceOfferId) return false
      if (row.supermarket_id !== candidate.supermarketId) return false
      if ((row.location_scope || '') !== (candidate.locationScope || '')) return false
      if ((row.city_id || '') !== (candidate.cityId || '')) return false
      if ((row.region_id || '') !== (candidate.regionId || '')) return false
      if (
        !datesOverlap(
          row.offer_start_date,
          row.offer_end_date,
          candidate.offerStartDate,
          candidate.offerEndDate
        )
      ) {
        return false
      }
      // Distinguish distinct pack configs, size, loyalty requirement, or promo mechanic
      if (normNumeric(row.inner_pack_count ?? 1) !== normNumeric(candidate.innerPackCount ?? 1)) return false
      if (normNumeric(row.each_size_value) !== normNumeric(candidate.eachSizeValue)) return false
      if ((row.each_size_unit || '').toLowerCase() !== (candidate.eachSizeUnit || '').toLowerCase()) return false
      if (Boolean(row.is_loyalty_required) !== Boolean(candidate.isLoyaltyRequired)) return false
      const normPromo = (v?: string | null) => (v || 'price_cut').toLowerCase().trim()
      if (normPromo(row.promo_mechanic) !== normPromo(candidate.promoMechanic)) return false

      if (candidate.productId != null && row.product_id != null) {
        return Number(row.product_id) === Number(candidate.productId)
      }
      const rowTitleNorm = normalizeTextForAnchor(row.title_en || row.title_ar)
      return candTitleNorm.length >= 4 && rowTitleNorm === candTitleNorm
    })

    if (logicalConflict) {
      const diffs = computeOfferFieldDiffs(logicalConflict, candidate)
      const entry: OfferReconciliationEntry = {
        batchOfferKey: candidate.batchOfferKey,
        sourceOfferId: candidate.sourceOfferId,
        classification: 'duplicate_conflict',
        existingOfferId: String(logicalConflict.id),
        existingSourceOfferId: logicalConflict.source_offer_id || null,
        existingCatalogMatchStatus: logicalConflict.catalog_match_status || null,
        reason: `Active offer already exists in target database for same retailer/item/validity/scope (${logicalConflict.source_offer_id || logicalConflict.id}).`,
        fieldDiffs: diffs
      }
      duplicateConflictCount++
      entries.push(entry)
      byBatchOfferKey[candidate.batchOfferKey] = entry
      continue
    }

    const entry: OfferReconciliationEntry = {
      batchOfferKey: candidate.batchOfferKey,
      sourceOfferId: candidate.sourceOfferId,
      classification: 'new',
      existingOfferId: null,
      existingSourceOfferId: null,
      existingCatalogMatchStatus: null,
      reason: 'New offer not yet present in target database.',
      fieldDiffs: []
    }
    newCount++
    entries.push(entry)
    byBatchOfferKey[candidate.batchOfferKey] = entry
  }

  return {
    checkedAt,
    totalEvaluated: params.candidates.length,
    newCount,
    alreadyPublishedCount,
    updateCandidateCount,
    duplicateConflictCount,
    entries,
    byBatchOfferKey
  }
}

export function buildCandidateSnapshotFromUnifiedOffer(
  offer: UnifiedBatchOffer,
  resolvedProductId: number | null,
  resolvedUnitPrice: { unitPrice: number | null; unitPriceUnit: string | null },
  catalogMatchStatus: string,
  extra?: {
    saleUnitType?: string | null
    innerPackCount?: number | null
    eachSizeValue?: number | null
    eachSizeUnit?: string | null
    isLoyaltyRequired?: boolean
    promoMechanic?: string | null
    quantityLimitValue?: number | null
  }
): CandidateOfferSnapshot {
  const sourceOfferId = computeStableSourceOfferId(offer)
  return {
    batchOfferKey: offer.batchOfferKey,
    sourceOfferId,
    supermarketId: offer.supermarketId || '',
    cityId: offer.cityId || null,
    regionId: offer.regionId || null,
    locationScope: offer.locationScope || 'national',
    productId: resolvedProductId,
    titleAr: offer.titleAr || offer.titleEn || '',
    titleEn: offer.titleEn || offer.titleAr || '',
    offerStartDate: offer.offerStartDate || null,
    offerEndDate: offer.offerEndDate || null,
    offerPrice: offer.promoPrice ?? 0,
    originalPrice: offer.originalPrice ?? null,
    unitPrice: resolvedUnitPrice.unitPrice ?? null,
    unitPriceUnit: resolvedUnitPrice.unitPriceUnit ?? null,
    catalogMatchStatus,
    saleUnitType: extra && 'saleUnitType' in extra ? (extra.saleUnitType ?? null) : (offer.sale_unit_type ?? null),
    innerPackCount: extra && 'innerPackCount' in extra ? (extra.innerPackCount ?? null) : (offer.inner_pack_count ?? null),
    eachSizeValue: extra && 'eachSizeValue' in extra ? (extra.eachSizeValue ?? null) : (offer.each_size_value ?? null),
    eachSizeUnit: extra && 'eachSizeUnit' in extra ? (extra.eachSizeUnit ?? null) : (offer.each_size_unit ?? null),
    isLoyaltyRequired: Boolean(extra?.isLoyaltyRequired),
    promoMechanic: extra && 'promoMechanic' in extra ? (extra.promoMechanic ?? null) : (offer.promotion_mechanic ?? null),
    quantityLimitValue: extra && 'quantityLimitValue' in extra ? (extra.quantityLimitValue ?? null) : (offer.customer_limit ?? null)
  }
}
