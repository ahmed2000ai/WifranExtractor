import type { UnifiedBatchOffer } from '../types/batchExtraction'
import type {
  MatchingProposal,
  MatchingRunManifest,
  OperatorDecisionStatus,
  ValidationIssue
} from '../types/catalogMatching'

export interface CrossRetailerOfferRow {
  batchOfferKey: string
  sourceOfferId: string
  leafletId: string
  supermarketName: string
  supermarketId: string | null
  titleEn: string
  titleAr: string
  promoPrice: number | null
  originalPrice: number | null
  currency: string | null
  offerStartDate: string | null
  offerEndDate: string | null
  locationScope: string | null
  locationLabel: string | null
  sourcePage: number
  sourceFileName: string
  offerCardCropPath: string | null
  productThumbCropPath: string | null
  originalPageImagePath: string | null
  operatorDecision: OperatorDecisionStatus
  confidence: 'high' | 'medium' | 'low'
  matchMethod: MatchingProposal['matchMethod']
  matchedDatabaseContext: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST' | null
  validationIssues: ValidationIssue[]
}

export interface CrossRetailerProductGroup {
  groupKey: string
  groupType: 'verified_catalog' | 'provisional_temporary'
  matchedProductId: string | null
  temporaryId: string | null
  matchedDatabaseContext: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST' | null
  productTitleEn: string
  productTitleAr: string
  brandName: string | null
  variantOrFlavor: string | null
  sizeLabel: string | null
  packCount: number | null
  operatorDecision: OperatorDecisionStatus
  retailerCount: number
  retailerRows: CrossRetailerOfferRow[]
}

export interface CrossRetailerGroupedViewModel {
  verifiedGroups: CrossRetailerProductGroup[]
  provisionalGroups: CrossRetailerProductGroup[]
  unresolvedRows: Array<{ offer: UnifiedBatchOffer | null; proposal: MatchingProposal }>
}

function buildRow(
  offer: UnifiedBatchOffer | undefined,
  proposal: MatchingProposal | undefined,
  manifest: MatchingRunManifest
): CrossRetailerOfferRow {
  const key = offer?.batchOfferKey || proposal?.batchOfferKey || ''
  return {
    batchOfferKey: key,
    sourceOfferId: offer?.sourceOfferId || proposal?.sourceOfferId || '',
    leafletId: offer?.leafletId || proposal?.leafletId || '',
    supermarketName: offer?.supermarketName || proposal?.supermarketName || 'Unknown Retailer',
    supermarketId: offer?.supermarketId || null,
    titleEn: offer?.titleEn || '',
    titleAr: offer?.titleAr || '',
    promoPrice: offer?.promoPrice ?? null,
    originalPrice: offer?.originalPrice ?? null,
    currency: offer?.currency ?? null,
    offerStartDate: offer?.offerStartDate ?? null,
    offerEndDate: offer?.offerEndDate ?? null,
    locationScope: offer?.locationScope ?? null,
    locationLabel: offer?.locationLabel ?? null,
    sourcePage: offer?.sourcePage ?? proposal?.sourcePage ?? 0,
    sourceFileName: offer?.sourceFileName || '',
    offerCardCropPath: offer?.offerCardCropPath ?? null,
    productThumbCropPath: offer?.productThumbCropPath ?? null,
    originalPageImagePath: offer?.originalPageImagePath ?? null,
    operatorDecision: proposal?.operatorDecision || 'proposed',
    confidence: proposal?.confidence || 'low',
    matchMethod: proposal?.matchMethod || 'deterministic',
    matchedDatabaseContext:
      proposal?.matchedDatabaseContext ?? manifest.matchingDatabaseContext ?? null,
    validationIssues: proposal?.validationIssues || []
  }
}

function countDistinctRetailers(rows: CrossRetailerOfferRow[]): number {
  const seen = new Set<string>()
  for (const r of rows) {
    seen.add((r.supermarketId || r.supermarketName || r.leafletId).toLowerCase())
  }
  return seen.size
}

/**
 * Groups matching results by verified catalog product ID and provisional temporary group ID,
 * keeping each retailer's offer price, dates, geographic scope, and evidence independent,
 * while isolating unresolved/ambiguous offers outside grouped identities.
 */
export function buildCrossRetailerGroups(
  offers: UnifiedBatchOffer[],
  manifest: MatchingRunManifest | null
): CrossRetailerGroupedViewModel {
  if (!manifest) {
    return { verifiedGroups: [], provisionalGroups: [], unresolvedRows: [] }
  }

  const offerByKey = new Map<string, UnifiedBatchOffer>()
  for (const o of offers) {
    offerByKey.set(o.batchOfferKey, o)
  }

  const verifiedBuckets = new Map<string, { firstProposal: MatchingProposal; rows: CrossRetailerOfferRow[] }>()
  const unresolvedRows: Array<{ offer: UnifiedBatchOffer | null; proposal: MatchingProposal }> = []

  for (const proposal of Object.values(manifest.proposals || {})) {
    const offer = offerByKey.get(proposal.batchOfferKey)
    if (proposal.decision === 'existing' && proposal.matchedProductId) {
      const bucket = verifiedBuckets.get(proposal.matchedProductId)
      const row = buildRow(offer, proposal, manifest)
      if (bucket) {
        bucket.rows.push(row)
      } else {
        verifiedBuckets.set(proposal.matchedProductId, {
          firstProposal: proposal,
          rows: [row]
        })
      }
    } else if (proposal.decision === 'unresolved') {
      unresolvedRows.push({ offer: offer || null, proposal })
    }
  }

  const verifiedGroups: CrossRetailerProductGroup[] = []
  for (const [productId, bucket] of verifiedBuckets.entries()) {
    const cand = bucket.firstProposal.matchedProduct
    const firstRow = bucket.rows[0]
    const firstOffer = offerByKey.get(firstRow.batchOfferKey)
    const sizeLabel =
      cand?.sizeValue != null && cand?.sizeUnit
        ? `${cand.sizeValue} ${cand.sizeUnit}`
        : firstOffer?.each_size_value != null && firstOffer?.each_size_unit
          ? `${firstOffer.each_size_value} ${firstOffer.each_size_unit}`
          : null

    const sortedRows = [...bucket.rows].sort((a, b) =>
      a.supermarketName.localeCompare(b.supermarketName) || a.sourcePage - b.sourcePage
    )

    const allApproved = sortedRows.every((r) => r.operatorDecision === 'approved')
    const allRejected = sortedRows.every((r) => r.operatorDecision === 'rejected')

    verifiedGroups.push({
      groupKey: `catalog:${productId}`,
      groupType: 'verified_catalog',
      matchedProductId: productId,
      temporaryId: null,
      matchedDatabaseContext:
        bucket.firstProposal.matchedDatabaseContext ?? manifest.matchingDatabaseContext ?? null,
      productTitleEn: cand?.nameEn || firstRow.titleEn || `Catalog #${productId}`,
      productTitleAr: cand?.nameAr || firstRow.titleAr || '',
      brandName: cand?.brand || firstOffer?.brandEn || firstOffer?.brand || null,
      variantOrFlavor: cand?.variant || firstOffer?.variantOrFlavor || null,
      sizeLabel,
      packCount: cand?.packCount ?? firstOffer?.inner_pack_count ?? 1,
      operatorDecision: allApproved ? 'approved' : allRejected ? 'rejected' : 'proposed',
      retailerCount: countDistinctRetailers(sortedRows),
      retailerRows: sortedRows
    })
  }

  verifiedGroups.sort((a, b) => b.retailerCount - a.retailerCount || a.productTitleEn.localeCompare(b.productTitleEn))

  const provisionalGroups: CrossRetailerProductGroup[] = []
  for (const grp of Object.values(manifest.temporaryProducts || {})) {
    const rows: CrossRetailerOfferRow[] = []
    for (const key of grp.sourceOfferKeys || []) {
      const offer = offerByKey.get(key)
      const proposal = manifest.proposals?.[key]
      rows.push(buildRow(offer, proposal, manifest))
    }
    if (rows.length === 0) continue
    const sortedRows = [...rows].sort((a, b) =>
      a.supermarketName.localeCompare(b.supermarketName) || a.sourcePage - b.sourcePage
    )
    const sizeLabel =
      grp.eachSizeValue != null && grp.eachSizeUnit
        ? `${grp.eachSizeValue} ${grp.eachSizeUnit}`
        : null

    provisionalGroups.push({
      groupKey: `temp:${grp.temporaryId}`,
      groupType: 'provisional_temporary',
      matchedProductId: null,
      temporaryId: grp.temporaryId,
      matchedDatabaseContext: manifest.matchingDatabaseContext ?? null,
      productTitleEn: grp.productNameEn || sortedRows[0].titleEn || grp.temporaryId,
      productTitleAr: grp.productNameAr || sortedRows[0].titleAr || '',
      brandName: grp.brandNameEn || grp.brandKey || null,
      variantOrFlavor: grp.variantOrFlavor || null,
      sizeLabel,
      packCount: grp.innerPackCount ?? 1,
      operatorDecision: grp.operatorDecision || 'proposed',
      retailerCount: countDistinctRetailers(sortedRows),
      retailerRows: sortedRows
    })
  }

  provisionalGroups.sort((a, b) => b.retailerCount - a.retailerCount || a.productTitleEn.localeCompare(b.productTitleEn))

  return {
    verifiedGroups,
    provisionalGroups,
    unresolvedRows
  }
}
