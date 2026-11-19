import type {
  LeafletBatchItem,
  MetadataAcceptanceStatus,
  OfferEligibilityStatus,
  ReviewTriageCategory,
  UnifiedBatchOffer
} from '../types/batchExtraction'
import type {
  MatchingProposal,
  MatchingRunManifest,
  NonCatalogOfferApproval,
  OfferPublicationAssessment,
  TemporaryProductGroup
} from '../types/catalogMatching'
import { assessOfferPublicationOutcome } from './nonCatalogPublicationPolicy'

export type OfferDiagnosticKind =
  | 'ready'
  | 'published'
  | 'non_grocery_excluded'
  | 'extraction_conflict'
  | 'missing_identity'
  | 'manual_review_required'

export interface OfferReviewTriageResult {
  batchOfferKey: string
  category: ReviewTriageCategory
  eligibilityStatus: OfferEligibilityStatus
  isPublished: boolean
  diagnosticKind: OfferDiagnosticKind
  diagnosticLabel: string
  reasons: string[]
  blockingReasons: string[]
  reviewReasons: string[]
  technicalReasons?: string[]
  assessment: OfferPublicationAssessment
  metadataAccepted: boolean
  canBulkApprove: boolean
}

const CURRENCY_CONFLICT_CODE_REGEX = /^(?:CURRENCY_UNVERIFIED_OR_CONFLICT|CURRENCY_CONFLICT|UNSUPPORTED_OR_UNVERIFIED_CURRENCY)$/i

function buildOperatorFacingConflictMessages(params: {
  offer: UnifiedBatchOffer
  hardQuarantines: string[]
  conflictCodes: string[]
}): string[] {
  const { offer, hardQuarantines, conflictCodes } = params
  const allCodes = new Set([...hardQuarantines, ...conflictCodes])
  const titleCombined = `${offer.titleEn || ''} ${offer.titleAr || ''}`.toLowerCase()
  const isOilOrBottle = /\b(?:oil|bottle|canola|sunflower|olive)\b|زيت|زجاج|عبوة/.test(titleCombined)
  const isPasta = /\b(?:pasta|macaroni|spaghetti|ditalini|rigati|penne|fusilli)\b|مكرونة|معكرونة|ديتاليني/.test(titleCombined)

  const messages: string[] = []
  if (
    allCodes.has('EN_AR_WEIGHT_VOLUME_CONFLICT') ||
    allCodes.has('EN_AR_PACK_COUNT_CONFLICT') ||
    allCodes.has('PROMO_QTY_VS_MFG_PACK_CONFLICT')
  ) {
    messages.push(
      isOilOrBottle
        ? 'Quantity conflict detected. Verify the bottle size and number of bottles.'
        : 'Quantity conflict detected. Verify the unit size and pack quantity.'
    )
  }

  if (allCodes.has('INCOMPLETE_VISIBLE_ASSORTMENT') || allCodes.has('UNLABELED_SWATCH_OR_BOTTLE_VARIANTS')) {
    messages.push(
      isPasta
        ? 'Multiple pasta variants detected. Product identity requires review.'
        : 'Multiple product variants detected. Product identity requires review.'
    )
  }

  if (allCodes.has('TEXT_VS_IMAGE_CONFLICT')) {
    messages.push('Multiple product varieties detected. Verify the varieties before publishing.')
  }

  if (allCodes.has('PRICE_ROLE_AMBIGUOUS') || allCodes.has('INVALID_OR_MISSING_OFFER_PRICE') || allCodes.has('ORIGINAL_PRICE_LESS_THAN_OFFER_PRICE')) {
    messages.push('Price conflict detected. Verify the promotional and original prices.')
  }

  if (allCodes.has('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')) {
    messages.push('Non-grocery item excluded from default grocery consumer feed.')
  }

  if (messages.length === 0 && hardQuarantines.length > 0) {
    messages.push('Offer requires verification before publishing.')
  }

  return Array.from(new Set(messages))
}

export interface BatchReviewTriageSummary {
  total: number
  readyCount: number
  readyToPublishCount: number
  needsReviewCount: number
  blockedCount: number
  deferredCount: number
  publishedCount: number
  byOfferKey: Record<string, OfferReviewTriageResult>
}

/**
 * Checks that all mandatory retailer, geographic scope, and calendar validity fields exist.
 */
export function hasCompleteCoreLeafletMetadata(meta?: {
  supermarketId?: string | null
  locationScope?: string | null
  cityId?: string | null
  regionId?: string | null
  offerStartDate?: string | null
  offerEndDate?: string | null
} | null): boolean {
  if (!meta) return false
  return Boolean(
    meta.supermarketId &&
      meta.locationScope &&
      (meta.locationScope !== 'city' || meta.cityId) &&
      (meta.locationScope !== 'region' || meta.regionId) &&
      meta.offerStartDate &&
      meta.offerEndDate
  )
}

/**
 * Canonical leaflet-level metadata acceptance rule shared across Steps 2, 3, and batch backend.
 * Accepts both `'operator_verified'` and `'auto_accepted'` without requiring legacy `verified: true`.
 */
export function isLeafletMetadataAccepted(
  meta?: LeafletBatchItem['metadata'] | {
    metadataStatus?: MetadataAcceptanceStatus | null
    verified?: boolean
    supermarketId?: string | null
    offerStartDate?: string | null
    offerEndDate?: string | null
  } | null
): boolean {
  if (!meta) return false
  if (meta.metadataStatus === 'needs_review') return false
  const hasCoreFields = Boolean(meta.supermarketId && meta.offerStartDate && meta.offerEndDate)
  if (meta.metadataStatus === 'operator_verified' || meta.metadataStatus === 'auto_accepted') {
    return hasCoreFields
  }
  return meta.metadataStatus === undefined && Boolean(meta.verified && hasCoreFields)
}

/**
 * Canonical offer-level metadata acceptance rule shared across Steps 3, 4, and triage classification.
 */
export function isOfferMetadataAccepted(
  offer?: Partial<UnifiedBatchOffer> | null
): boolean {
  if (!offer) return false
  if (offer.metadataStatus === 'needs_review') return false
  if (offer.metadataStatus === 'operator_verified' || offer.metadataStatus === 'auto_accepted') {
    return hasCompleteCoreLeafletMetadata(offer)
  }
  return (
    offer.metadataStatus === undefined &&
    (offer.metadataVerified === true ||
      (offer.metadataVerified === undefined && hasCompleteCoreLeafletMetadata(offer)))
  )
}

export function classifyOfferReviewTriage(params: {
  offer: UnifiedBatchOffer
  proposal?: MatchingProposal | null
  temporaryProducts?: Record<string, TemporaryProductGroup>
  approval?: NonCatalogOfferApproval | null
  targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
}): OfferReviewTriageResult {
  const { offer, proposal, temporaryProducts, approval, targetDatabaseContext } = params
  const assessment = assessOfferPublicationOutcome({
    offer,
    proposal,
    temporaryProducts,
    approval
  })

  const blockingReasons: string[] = []
  const reviewReasons: string[] = []

  const metadataAccepted = isOfferMetadataAccepted(offer)

  if (!metadataAccepted) {
    reviewReasons.push('Leaflet metadata requires review (retailer, validity dates, or geographic scope).')
  } else {
    if (!offer.supermarketId || !offer.locationScope) {
      reviewReasons.push('Missing supermarket or geographic scope metadata.')
    } else if (offer.locationScope === 'city' && !offer.cityId) {
      reviewReasons.push('Missing verified city ID for city-scoped leaflet.')
    } else if (offer.locationScope === 'region' && !offer.regionId) {
      reviewReasons.push('Missing verified region ID for region-scoped leaflet.')
    }
    if (!offer.offerStartDate || !offer.offerEndDate) {
      reviewReasons.push('Missing offer validity start or end date.')
    }
  }

  // Inverted calendar dates cannot publish safely
  if (
    offer.offerStartDate &&
    offer.offerEndDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(offer.offerStartDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(offer.offerEndDate) &&
    offer.offerStartDate > offer.offerEndDate
  ) {
    blockingReasons.push(
      `Invalid validity dates: start date (${offer.offerStartDate}) is after end date (${offer.offerEndDate}).`
    )
  }

  // Critical safety quarantines (missing retailer/date/scope metadata stays in 'needs_review' so operators can resolve it in Step 3)
  const METADATA_REVIEW_ONLY_CODES = new Set([
    'MISSING_CRITICAL_OFFER_DATES',
    'MISSING_SUPERMARKET_PROVENANCE',
    'INVALID_LOCATION_SCOPE'
  ])
  const NON_BLOCKING_ASSORTMENT_CODES = new Set([
    'MULTIPLE_PRODUCT_VARIANTS_DETECTED',
    'INCOMPLETE_VISIBLE_ASSORTMENT',
    'WEIGHT_RANGE_UNPAIRED'
  ])
  const sanitizedConflictCodes = (Array.isArray(offer.conflictCodes) ? offer.conflictCodes : []).filter(
    (code) => !CURRENCY_CONFLICT_CODE_REGEX.test(String(code)) && !NON_BLOCKING_ASSORTMENT_CODES.has(String(code))
  )
  const rawOfferQuarantines = (Array.isArray(offer.quarantineReasons) ? offer.quarantineReasons : []).filter(
    (code) => !CURRENCY_CONFLICT_CODE_REGEX.test(String(code)) && !NON_BLOCKING_ASSORTMENT_CODES.has(String(code))
  )
  const combinedQuarantines = Array.from(
    new Set([
      ...rawOfferQuarantines,
      ...assessment.quarantineReasons.filter(
        (code) => !CURRENCY_CONFLICT_CODE_REGEX.test(String(code)) && !NON_BLOCKING_ASSORTMENT_CODES.has(String(code))
      )
    ])
  )
  const hardQuarantines = combinedQuarantines.filter((code) => !METADATA_REVIEW_ONLY_CODES.has(code))
  const metadataGapQuarantines = combinedQuarantines.filter((code) => METADATA_REVIEW_ONLY_CODES.has(code))
  const technicalReasons: string[] = []

  if (metadataGapQuarantines.length > 0 && reviewReasons.length === 0) {
    reviewReasons.push('Missing or unverified leaflet metadata (retailer, validity dates, or geographic scope).')
    technicalReasons.push(`Missing/unverified leaflet metadata (${metadataGapQuarantines.join(', ')}).`)
  }

  if (
    hardQuarantines.length > 0 &&
    (rawOfferQuarantines.some((c) => !METADATA_REVIEW_ONLY_CODES.has(c)) || !assessment.isSafeForNonCatalogPublication)
  ) {
    const operatorMessages = buildOperatorFacingConflictMessages({
      offer,
      hardQuarantines,
      conflictCodes: sanitizedConflictCodes
    })
    blockingReasons.push(...operatorMessages)
    technicalReasons.push(
      `Quarantined: ${hardQuarantines.join(', ')}${
        assessment.correctionReasons.length > 0 ? ` (${assessment.correctionReasons.join(' ')})` : ''
      }`
    )
  } else if (hardQuarantines.length > 0) {
    const operatorMessages = buildOperatorFacingConflictMessages({
      offer,
      hardQuarantines,
      conflictCodes: sanitizedConflictCodes
    })
    reviewReasons.push(...operatorMessages)
    technicalReasons.push(...assessment.correctionReasons)
  }

  // Explicit rejection blocks publication until reversed
  if (proposal?.operatorDecision === 'rejected' || approval?.decision === 'rejected') {
    blockingReasons.push('Rejected or quarantined by operator decision.')
  }

  // Environment mismatch guard
  if (
    targetDatabaseContext === 'DEVELOPMENT_TEST' &&
    proposal?.decision === 'existing' &&
    proposal.matchedDatabaseContext === 'PRODUCTION_UI'
  ) {
    blockingReasons.push(
      `Environment mismatch: matched against PRODUCTION_UI catalog (#${proposal.matchedProductId}) while targeting DEVELOPMENT_TEST.`
    )
  }

  // Proposal / identity state checks
  if (!proposal) {
    reviewReasons.push('Catalog matching has not run or no proposal exists yet.')
  } else if (proposal.decision === 'unresolved') {
    const isAutoApprovedAssortment =
      assessment.isSafeForNonCatalogPublication &&
      (assessment.category === 'unsplit_assortment' ||
        offer.assortment_status === 'visual_multiple_variants' ||
        offer.assortment_status === 'multiple_variants' ||
        offer.assortment_status === 'unsplit_assortment')
    if (!isAutoApprovedAssortment && approval?.decision !== 'approved') {
      reviewReasons.push(
        assessment.unresolvedReason || 'Unresolved catalog identity — inspect, edit, or approve non-catalog if safe.'
      )
    }
  } else if (proposal.decision === 'temporary') {
    const tempGroup = proposal.temporaryId ? temporaryProducts?.[proposal.temporaryId] : null
    if (!tempGroup) {
      blockingReasons.push(`Missing provisional product group (${proposal.temporaryId || 'none'}).`)
      technicalReasons.push(`Missing temporary product group (${proposal.temporaryId || 'none'}).`)
    } else if (tempGroup.operatorDecision === 'rejected') {
      blockingReasons.push('Provisional product was rejected by operator.')
      technicalReasons.push(`Provisional product group ${tempGroup.temporaryId} rejected.`)
    } else {
      const hasValidTempName = Boolean((tempGroup.productNameEn || tempGroup.productNameAr || '').trim())
      const isWeighted = String(offer.sale_unit_type || tempGroup.saleUnitType || '').toLowerCase() === 'kg'
      const hasValidTempSize =
        isWeighted ||
        (typeof tempGroup.eachSizeValue === 'number' &&
          Number.isFinite(tempGroup.eachSizeValue) &&
          tempGroup.eachSizeValue > 0 &&
          Boolean(tempGroup.eachSizeUnit))
      if (!hasValidTempName || !hasValidTempSize) {
        reviewReasons.push('Product identity or unit size requires review before publishing.')
        technicalReasons.push(`Temporary group ${tempGroup.temporaryId} has incomplete identity/specs.`)
      }
      // Valid unambiguous provisional ('temporary') products with complete identity & specs
      // default to Ready without mandatory manual confirmation.
    }
  } else if (proposal.decision === 'existing') {
    if (!proposal.matchedProductId) {
      reviewReasons.push('Existing match is missing catalog product ID.')
    } else if (proposal.confidence === 'low') {
      reviewReasons.push('Low-confidence catalog match requires confirmation.')
    }
    const warningIssues = (proposal.validationIssues || []).filter(
      (i) => i.severity === 'warning' || i.severity === 'error'
    )
    for (const issue of warningIssues) {
      if (issue.severity === 'error') {
        blockingReasons.push(`${issue.code}: ${issue.message}`)
      } else {
        reviewReasons.push(`${issue.code}: ${issue.message}`)
      }
    }
  }

  const isPublished =
    (offer.publicationState?.state === 'published' || offer.status === 'published') &&
    !offer.publicationState?.needsUpdateReview

  const category: ReviewTriageCategory =
    blockingReasons.length > 0
      ? 'blocked'
      : reviewReasons.length > 0
        ? 'needs_review'
        : 'ready'

  const eligibilityStatus: OfferEligibilityStatus = isPublished ? 'published' : category

  const canBulkApprove =
    !isPublished &&
    category === 'ready' &&
    blockingReasons.length === 0 &&
    combinedQuarantines.length === 0 &&
    proposal?.decision === 'existing' &&
    Boolean(proposal?.matchedProductId)

  const isNonGroceryExcluded =
    combinedQuarantines.includes('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE') ||
    (assessment.itemDomain !== 'grocery' &&
      assessment.itemDomain !== 'household' &&
      assessment.itemDomain !== 'personal_care')

  const hasExtractionConflicts =
    sanitizedConflictCodes.length > 0 ||
    hardQuarantines.some(
      (c) =>
        /CONFLICT|PRICE_ROLE_AMBIGUOUS|COMPOUND_TIER_INCOMPLETE|MISSING_OR_INVALID_PROMO_PRICE/i.test(
          c
        ) || (c === 'V3_PARENT_OFFER_QUARANTINED' && !isNonGroceryExcluded)
    )

  const hasMissingIdentity =
    !isNonGroceryExcluded &&
    (proposal?.decision === 'unresolved' ||
      proposal?.validationIssues?.some((i) =>
        /MISSING_|UNKNOWN_BRAND|UNBRANDED|IDENTITY/i.test(i.code)
      ) ||
      hardQuarantines.some((c) => /MISSING_UNIT_SIZE|MISSING_PRODUCT_IDENTITY|UNKNOWN_BRAND/i.test(c)))

  const diagnosticKind: OfferDiagnosticKind =
    isPublished
      ? 'published'
      : isNonGroceryExcluded
      ? 'non_grocery_excluded'
      : hasExtractionConflicts || blockingReasons.some((r) => /Invalid validity dates|Environment mismatch|Rejected/i.test(r))
      ? 'extraction_conflict'
      : hasMissingIdentity
      ? 'missing_identity'
      : category === 'ready'
      ? 'ready'
      : 'manual_review_required'

  const diagnosticLabelMap: Record<OfferDiagnosticKind, string> = {
    ready: 'Ready to Publish',
    published: 'Already Published',
    non_grocery_excluded: 'Non-Grocery Excluded',
    extraction_conflict: 'Extraction Conflict',
    missing_identity: 'Missing Product Identity',
    manual_review_required: 'Manual Review Required'
  }

  return {
    batchOfferKey: offer.batchOfferKey,
    category,
    eligibilityStatus,
    isPublished,
    diagnosticKind,
    diagnosticLabel: diagnosticLabelMap[diagnosticKind],
    reasons: blockingReasons.length > 0 ? blockingReasons : reviewReasons,
    blockingReasons,
    reviewReasons,
    technicalReasons: Array.from(new Set(technicalReasons)),
    assessment,
    metadataAccepted,
    canBulkApprove
  }
}

export function summarizeBatchReviewTriage(params: {
  offers: UnifiedBatchOffer[]
  manifest: MatchingRunManifest | null
  targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
}): BatchReviewTriageSummary {
  const byOfferKey: Record<string, OfferReviewTriageResult> = {}
  let readyCount = 0
  let needsReviewCount = 0
  let blockedCount = 0
  let publishedCount = 0

  for (const offer of params.offers) {
    const res = classifyOfferReviewTriage({
      offer,
      proposal: params.manifest?.proposals?.[offer.batchOfferKey] ?? null,
      temporaryProducts: params.manifest?.temporaryProducts,
      approval: params.manifest?.nonCatalogApprovals?.[offer.batchOfferKey] ?? null,
      targetDatabaseContext: params.targetDatabaseContext || params.manifest?.matchingDatabaseContext
    })
    byOfferKey[offer.batchOfferKey] = res
    if (res.isPublished) publishedCount++
    else if (res.category === 'ready') readyCount++
    else if (res.category === 'needs_review') needsReviewCount++
    else blockedCount++
  }

  return {
    total: params.offers.length,
    readyCount,
    readyToPublishCount: readyCount,
    needsReviewCount,
    blockedCount,
    deferredCount: needsReviewCount + blockedCount,
    publishedCount,
    byOfferKey
  }
}
