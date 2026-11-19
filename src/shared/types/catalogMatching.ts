/**
 * WIFRAN CATALOG MATCHING TYPES
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001
 * Intelligent Catalog Matching — Brand Grouping, Gemini MEDIUM, Flex PayGo,
 * Dynamic Batching, Persistent Caching, Minimal JSON and Temporary Product IDs.
 */

export type BrandMatchStatus = 'known' | 'unbranded' | 'unknown' | 'multi_brand'

export type MatchDecisionType = 'existing' | 'temporary' | 'unresolved'

export type MatchMethod =
  | 'persistent_cache'
  | 'deterministic'
  | 'gemini_medium'
  | 'manual_operator'

export type OperatorDecisionStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'relinked'
  | 'merged'
  | 'split'

export type PublicationOutcome = 'catalog_linked' | 'approved_non_catalog' | 'quarantined'

export type NonCatalogEligibilityCategory =
  | 'loose_produce'
  | 'meat_seafood_by_weight'
  | 'in_house_bakery'
  | 'unsplit_assortment'
  | 'valid_grocery_unresolved_sku'

export interface NonCatalogOfferApproval {
  batchOfferKey: string
  decision: 'approved' | 'rejected'
  category?: NonCatalogEligibilityCategory | null
  operatorNotes?: string
  updatedAt: string
}

export interface OfferPublicationAssessment {
  batchOfferKey: string
  outcome: PublicationOutcome
  isEligibleForNonCatalogPublication: boolean
  isSafeForNonCatalogPublication: boolean
  category: NonCatalogEligibilityCategory | null
  itemDomain: 'grocery' | 'household' | 'personal_care' | 'electronics' | 'appliance' | 'other_non_grocery'
  catalogMatchStatus:
    | 'verified_linked'
    | 'candidate_pending_review'
    | 'unresolved'
    | 'excluded_ambiguous'
    | 'conflict_needs_review'
  exactIdentityStatus: 'verified_sku' | 'unresolved'
  assortmentStatus: 'single_sku' | 'multiple_variants' | 'ambiguous_alternatives' | 'unknown_composition'
  comparisonDisabled: boolean
  unresolvedReason: string | null
  quarantineReasons: string[]
  correctionReasons: string[]
  perUnitPricing: {
    unitPrice: number | null
    unitPriceUnit: string | null
    basisEstablished: boolean
  }
}

export interface MatchingEvidenceAnnotation {
  source_id: string
  assortment_status: 'single_sku' | 'multiple_variants' | 'ambiguous_alternatives'
  evidence_source:
    | 'operator_verified_card'
    | 'canonical_extraction'
    | 'title_or_metadata'
    | 'reviewer_annotation'
  identity_resolution: 'eligible' | 'requires_review'
  sub_product_refs?: string[]
  quantity_semantics?: 'manufacturer_multipack' | 'retail_promo_quantity' | 'checkout_multibuy' | 'ambiguous'
  manufacturer_pack_count?: number
  promo_purchase_quantity?: number
  notes?: string
  reviewer_id?: string | null
  created_at: string
  updated_at: string
  reversible: boolean
}

export type PackagingSemantics =
  | 'single_unit_retail'
  | 'single_unit_with_retail_promo'
  | 'manufacturer_multipack'
  | 'ambiguous'

export interface NormalizedIdentityAttributes {
  brandKey: string
  brandNameAr: string | null
  brandNameEn: string | null
  brandStatus: BrandMatchStatus
  productNameAr: string
  productNameEn: string
  variantOrFlavor: string | null
  fatContent: string | null
  eachSizeValue: number | null
  eachSizeUnit: string | null
  innerPackCount: number | null
  saleUnitType: string | null
  productForm: string | null
  commodityType?: string | null
  manufacturerPackCount?: number | null
  promoPurchaseQuantity?: number | null
  promotionMechanic?: string | null
  packagingSemantics?: PackagingSemantics
  assortmentStatus?: string | null
  isAssortment?: boolean
  isIdentitySufficient?: boolean
  insufficiencyReasons?: string[]
  insufficiencyCodes?: string[]
  evidenceAnnotation?: MatchingEvidenceAnnotation | null
}

export interface CompactCatalogCandidate {
  id: string
  brand: string
  nameAr: string
  nameEn: string
  variant: string | null
  sizeValue: number | null
  sizeUnit: string | null
  packCount: number | null
  imageUrl?: string | null
}

/**
 * Minimal Gemini Matching Output Contract:
 * Exact schema required by Gemini 3.8 Flash.
 */
export interface GeminiMinimalMatchItem {
  source_id: string
  product_id: string | null
}

export interface GeminiMinimalMatchingResponse {
  matches: GeminiMinimalMatchItem[]
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
}

export interface MatchingProposal {
  batchOfferKey: string
  sourceOfferId: string
  sourcePage: number
  leafletId: string
  supermarketName: string | null
  decision: MatchDecisionType
  matchedProductId: string | null
  matchedDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
  matchedProduct?: CompactCatalogCandidate | null
  temporaryId: string | null
  confidence: 'high' | 'medium' | 'low'
  matchMethod: MatchMethod
  validationIssues: ValidationIssue[]
  rawModelSourceId?: string | null
  evidenceAnnotation?: MatchingEvidenceAnnotation | null
  operatorDecision: OperatorDecisionStatus
  operatorNotes?: string
  updatedAt: string
}

export interface TemporaryProductGroup {
  temporaryId: string // e.g. "t_batch123_001"
  canonicalFingerprint?: string
  brandKey: string
  brandNameAr: string | null
  brandNameEn: string | null
  productNameAr: string
  productNameEn: string
  variantOrFlavor: string | null
  fatContent: string | null
  eachSizeValue: number | null
  eachSizeUnit: string | null
  innerPackCount: number | null
  saleUnitType: string | null
  productForm: string | null
  sourceOfferKeys: string[]
  retailers: string[]
  sampleThumbCropPath: string | null
  operatorDecision: OperatorDecisionStatus
  linkedPermanentProductId?: string | null
  validationWarnings: string[]
  createdAt: string
  updatedAt: string
}

export interface BrandGroupSummary {
  brandKey: string
  brandNameAr: string | null
  brandNameEn: string | null
  brandStatus: BrandMatchStatus
  totalOffers: number
  uniqueIdentitiesCount: number
  candidateCount: number
  matchedExistingCount: number
  temporaryGroupCount: number
  unresolvedCount: number
  totalCatalogProductsInBrand?: number
  retrievalCompleteness?: 'complete' | 'partial' | 'shortlist_ranked' | 'fallback_used' | 'inconclusive' | 'insufficient'
  fallbackActions?: string[]
}

export interface MatchingTotals {
  totalExtractedOffers: number
  uniqueIdentitiesCount: number
  cacheMatchesCount: number
  deterministicMatchesCount: number
  geminiEvaluatedCount: number
  proposedExistingCount: number
  proposedTemporaryCount: number
  unresolvedCount: number
  validationWarningsCount: number
  actualCostUsd: number
  estimatedCostUsd: number
  geminiRequestsCount: number
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  completedRequestsCount?: number
  failedRequestsCount?: number
  uncertainRequestsCount?: number
  cancelledRequestsCount?: number
  pendingRequestsCount?: number
}

export interface MatchingPreflightEstimate {
  totalOffers: number
  unresolvedUniqueIdentities: number
  brandGroupCount: number
  approxGeminiRequests: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedThinkingTokens?: number
  estimatedCostUsd: {
    min: number
    max: number
  }
  executionTier: 'flex' | 'standard'
  model: string
  thinkingLevel: 'MEDIUM'
  modelLocation?: 'global'
  budgetCapDisclaimer?: string
}

export type RequestExecutionStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'outcome_unknown'

export type MatchingRunPhase =
  | 'Preparing candidates'
  | 'Waiting for Gemini / Flex processing'
  | 'Validating response'
  | 'Saving checkpoint'
  | 'Completed'
  | 'Failed'
  | 'Paused'
  | 'Cancelled'

export type MatchingRunStatus =
  | 'idle'
  | 'estimating'
  | 'running'
  | 'paused'
  | 'completed'
  | 'completed_with_warnings'
  | 'completed_with_failures'
  | 'stopped_budget_cap'
  | 'failed'
  | 'cancelled'

export interface MatchingUsageMetadataSnapshot {
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  cachedTokens: number
  totalTokens: number
  metadataMissing: boolean
}

export interface MatchingRequestError {
  code: string
  message: string
  isSystemic: boolean
  isUncertainOutcome: boolean
  httpStatus?: number | null
}

export interface MatchingRequestAttempt {
  attemptNumber: number
  runId: string
  startedAt: string
  finishedAt?: string | null
  executionStatus: Exclude<RequestExecutionStatus, 'pending' | 'in_progress'>
  errorCode?: string | null
  errorMessage?: string | null
  httpStatus?: number | null
  isUncertainOutcome?: boolean
  latencyMs?: number | null
  usageMetadata?: MatchingUsageMetadataSnapshot | null
  observedCostUsd: number
  uncertainBillingWarning?: string | null
}

export interface MatchingRequestRecord {
  requestKey: string
  batchId: string
  runId: string
  brandKey: string
  brandName: string
  chunkIndex: number
  totalChunksInBrand: number
  chunkSize: number
  identityKeys: string[]
  sourceOfferKeys: string[]
  sourceIds: string[]
  requestConfig: {
    model: string
    thinkingLevel: 'MEDIUM'
    executionTier: 'flex'
    location: 'global'
    timeoutMs: number
  }
  executionStatus: RequestExecutionStatus
  attemptCount: number
  attempts: MatchingRequestAttempt[]
  startedAt: string | null
  finishedAt: string | null
  error: MatchingRequestError | null
  usageMetadata: MatchingUsageMetadataSnapshot | null
  estimatedCostUsd: number
  responseArtifactRef: string | null
  validated: boolean
  validationDiagnostics?: string[]
  uncertainBillingWarning?: string | null
}

export interface MatchingRunHistoryEntry {
  runId: string
  mode: 'full' | 'resume' | 'retry_failed_only'
  startedAt: string
  finishedAt?: string | null
  status: MatchingRunStatus
  approvedMaxBudgetUsd: number | null
  operatorAuthorizedRetry?: boolean
  stopReason?: string | null
}

export interface MatchingProgressEvent {
  batchId: string
  runId?: string
  statusText: string
  percent: number
  phase?: MatchingRunPhase
  totalRequests?: number
  completedRequests?: number
  failedRequests?: number
  uncertainRequests?: number
  cancelledRequests?: number
  pendingRequests?: number
  currentBrand?: string | null
  currentRequestKey?: string | null
  currentChunkIndex?: number | null
  totalChunksInBrand?: number | null
  currentRequestElapsedMs?: number
  totalElapsedMs?: number
  cumulativeObservedCostUsd?: number
  approvedMaxBudgetUsd?: number | null
  remainingEstimatedBudgetUsd?: number | null
  estimatedNextRequestCostUsd?: number | null
  pauseRequested?: boolean
  cancelRequested?: boolean
}

export interface RetryFailedPreflightSummary {
  eligibleCount: number
  failedCount: number
  uncertainCount: number
  cancelledCount: number
  completedExcludedCount: number
  estimatedRetryInputTokens: number
  estimatedRetryOutputTokens: number
  estimatedRetryThinkingTokens: number
  estimatedRetryCostUsd: {
    min: number
    max: number
  }
  hasUncertainPreviousAttempts: boolean
  uncertainBillingWarning: string | null
  failedRequests: Array<{
    requestKey: string
    brandKey: string
    brandName: string
    chunkIndex: number
    itemCount: number
    executionStatus: RequestExecutionStatus
    errorCode: string | null
    errorMessage: string | null
    attemptCount: number
    uncertainBillingWarning: string | null
  }>
}

export interface ChunkSizeBenchmarkEntry {
  chunkSize: number
  requestCount: number
  itemCount: number
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  actualCostUsd: number
  costPerIdentityUsd: number
  avgThinkingTokensPerItem: number
}

export type ConsumerProductImageApprovalStatus =
  | 'unreviewed'
  | 'approved_generated_crop'
  | 'reuse_existing_catalog_image'
  | 'rejected'
  | 'invalidated_identity_changed'

export interface ConsumerProductImageApproval {
  batchOfferKey: string
  status: ConsumerProductImageApprovalStatus
  sourceType: 'product_thumb_crop' | 'existing_catalog_image' | null
  approvedLocalPath: string | null
  existingCatalogImageUrl?: string | null
  approvedForProductKey: string
  approvedForProductLabel?: string | null
  rightsBasis: string | null
  verifiedBy?: string | null
  verifiedAt?: string | null
  invalidationReason?: string | null
  updatedAt: string
}

export interface MatchingRunManifest {
  schemaVersion: '1.0'
  batchId: string
  runId: string
  matchingDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
  createdAt: string
  updatedAt: string
  status: MatchingRunStatus
  model: string
  thinkingLevel: 'MEDIUM'
  executionMode: 'flex'
  totals: MatchingTotals
  proposals: Record<string, MatchingProposal>
  temporaryProducts: Record<string, TemporaryProductGroup>
  nonCatalogApprovals?: Record<string, NonCatalogOfferApproval>
  consumerImageApprovals?: Record<string, ConsumerProductImageApproval>
  brandSummaries: Record<string, BrandGroupSummary>
  benchmarkMetrics?: Record<number, ChunkSizeBenchmarkEntry>
  requests?: Record<string, MatchingRequestRecord>
  requestOrder?: string[]
  runHistory?: MatchingRunHistoryEntry[]
  approvedMaxBudgetUsd?: number | null
  totalElapsedMs?: number
  stoppedReason?: string | null
  lastRecoveryNotes?: string[]
  error?: string | null
}

export interface PersistentVerifiedMatchRecord {
  identityFingerprint: string
  brandKey: string
  productNameNorm: string
  sizeValue: number | null
  sizeUnit: string | null
  packCount: number | null
  variantOrFlavor: string | null
  fatContent: string | null
  approvedProductId: string
  verifiedAt: string
  verifiedBy: string
  environment: 'production' | 'development'
  catalogVersion?: string
}

export interface CatalogPublicationPreflightResult {
  ready: boolean
  databaseContext: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
  totalOffersToPublish: number
  readyOffersToPublishCount?: number
  deferredOffersCount?: number
  alreadyPublishedOffersCount?: number
  eligibleOfferKeys?: string[]
  deferredOfferKeys?: string[]
  alreadyPublishedOfferKeys?: string[]
  deferredOfferReasons?: Record<string, string[]>
  existingProductMatchesCount: number
  newProductsToCreateCount: number
  unresolvedOffersCount: number
  approvedNonCatalogCount?: number
  eligibleNonCatalogCount?: number
  quarantinedOffersCount?: number
  nonCatalogAssessmentByOffer?: Record<string, OfferPublicationAssessment>
  incompleteOrFailedRequestsCount?: number
  missingAttributesCount: number
  schemaDependenciesMet: boolean
  schemaWarnings: string[]
  blockingReasons: string[]
  schemaReport?: Record<string, unknown>
  reconciliationSummary?: {
    checkedAt: string
    totalEvaluated: number
    newCount: number
    alreadyPublishedCount: number
    updateCandidateCount: number
    duplicateConflictCount: number
    entries: Array<{
      batchOfferKey: string
      sourceOfferId: string
      classification: 'new' | 'already_published' | 'update_candidate' | 'duplicate_conflict'
      existingOfferId: string | null
      existingSourceOfferId: string | null
      reason: string
      fieldDiffs: Array<{ field: string; before: unknown; after: unknown }>
    }>
  } | null
}

export interface CatalogPublicationResult {
  success: boolean
  databaseContext: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
  publishOperationId?: string | null
  idempotencyKey?: string | null
  idempotentReplay?: boolean
  noop?: boolean
  createdProductsCount: number
  reusedProductsCount?: number
  publishedOffersCount: number
  insertedOffersCount?: number
  updatedOffersCount?: number
  unchangedNoopCount?: number
  skippedDuplicatesCount?: number
  conflictsCount?: number
  publishedNonCatalogOffersCount?: number
  upgradedFromNonCatalogCount?: number
  quarantinedOffersCount?: number
  skippedUnapprovedNonCatalogCount?: number
  createdProductMap: Record<string, string> // temporaryId -> permanent bigint string
  publishedOfferIds: string[]
  publishedBatchOfferKeys?: string[]
  deferredBatchOfferKeys?: string[]
  alreadyPublishedBatchOfferKeys?: string[]
  sourceOfferIdByKey?: Record<string, string>
  publishedOfferIdByKey?: Record<string, string>
  productIdByKey?: Record<string, string | null>
  storageSummary?: {
    uploaded: number
    reused: number
    bucket: string
    buckets?: string[]
  }
  reconciliationSummary?: CatalogPublicationPreflightResult['reconciliationSummary']
  errors?: string[]
}
