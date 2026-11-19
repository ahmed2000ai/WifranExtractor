/**
 * WIFRAN-EXTRACTOR-IDENTITY-005G (WP6)
 * Shared Contracts for Hybrid Page-First Extraction, Selective Crop Verification,
 * Evidence Reconciliation, and Cost/Latency Governance.
 *
 * Strictly additive and disabled by default (`enabledByDefault: false`).
 * Never alters normal app extraction flows or frozen 2.0 contracts.
 */

import type {
  OfferContractV3Record,
  V3ConflictCode,
  V3DecompositionResult,
  V3ItemDomain
} from './extractorContractV3';
import type { OfferPublicationAssessment } from './catalogMatching';

export interface HybridExtractionFeatureFlags {
  enabledByDefault: false;
  enableHybridOrchestration: boolean;
  requireExplicitAuthorization: true;
  allowDatabaseWrites: false;
}

export const HYBRID_EXTRACTION_DEFAULT_FLAGS: HybridExtractionFeatureFlags = {
  enabledByDefault: false,
  enableHybridOrchestration: false,
  requireExplicitAuthorization: true,
  allowDatabaseWrites: false
} as const;

export type HybridExecutionContext = 'normal_app' | 'isolated_hybrid_workflow';

/**
 * Gemini normalized [ymin, xmin, ymax, xmax] bounding box in 0..1000 space.
 */
export type NormalizedBox2D = [number, number, number, number];

export interface V3RawComponentBoxes {
  product_graphic_box?: NormalizedBox2D | null;
  promo_price_box?: NormalizedBox2D | null;
  original_price_box?: NormalizedBox2D | null;
  title_text_box?: NormalizedBox2D | null;
  unit_and_size_badge_box?: NormalizedBox2D | null;
}

export interface PixelBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropSelectionPriority = 'P0' | 'P1' | 'P2';

export type CropSelectionTriggerCode =
  | 'CONFLICT_FLAGGED'
  | 'PRICE_ROLE_OR_PROMO_ANOMALY'
  | 'LOW_CONFIDENCE_OR_UNCERTAIN_PRICE'
  | 'UNSPLIT_AMBIGUOUS_ASSORTMENT_WITH_SKU'
  | 'COMPOUND_MULTI_TIER_OR_UNPAIRED_WEIGHT'
  | 'MISSING_CRITICAL_IDENTITY_ATTRIBUTES'
  | 'INVALID_OR_LOW_QUALITY_BBOX'
  | 'UNVERIFIED_PACKAGING_EVIDENCE_FOR_IDENTITY'
  | 'DENSE_OR_SMALL_PACKAGING_TEXT'
  | 'MEDIUM_CONFIDENCE_VERIFICATION'
  | 'MISSING_ORIGINAL_PRICE_WITH_BADGE_BOX'
  | 'CUSTOMER_LIMIT_OR_LOYALTY_UNCERTAINTY'
  | 'ASSORTMENT_SUB_ITEM_ENRICHMENT'
  | 'PACKAGED_BEVERAGE_PCS_AMBIGUITY'
  | 'INDEPENDENT_P2_QUALITY_AUDIT'
  | 'NO_VERIFICATION_NEEDED';

export interface IndependentP2AuditMetadata {
  selectedForAudit: boolean;
  stratum: string;
  samplingRate: number;
  seed: string;
  reason: string;
}

export interface CardCropSelectionDecision {
  sourceOfferId: string;
  offerNumber: number;
  priority: CropSelectionPriority;
  needsCrop: boolean;
  requiresCropVerificationForCatalogMatch: boolean;
  hasIndependentPackagingEvidence: boolean;
  triggerCodes: CropSelectionTriggerCode[];
  reasons: string[];
  impactDimensions: {
    identityImpact: boolean;
    priceOrQuantityImpact: boolean;
    eligibilityOrLoyaltyImpact: boolean;
    completenessOrAssortmentImpact: boolean;
    geometryOrImageTextImpact: boolean;
  };
  missRiskAuditNotes: string[];
  knownLimitationNote?: string | null;
  p2Audit?: IndependentP2AuditMetadata;
}

export type PageContextTriggerCode =
  | 'PAGE_WIDE_LOYALTY_SUSPECTED_OR_MISSING'
  | 'PAGE_WIDE_EXCLUSIONS_SUSPECTED'
  | 'PAGE_WIDE_REGIONAL_SCOPE_SUSPECTED'
  | 'PAGE_WIDE_CUSTOMER_LIMIT_SUSPECTED'
  | 'MISSING_PAGE_VALIDITY_DATES'
  | 'MISSING_OR_CONFLICTING_PAGE_CURRENCY'
  | 'PROMO_TERMS_HEADER_FOOTER_CROP_REQUIRED';

export interface PageContextVerificationNeed {
  needsPageContextVerification: boolean;
  triggerCodes: PageContextTriggerCode[];
  reasons: string[];
  recommendedRegions: Array<{
    regionKind: 'page_header' | 'page_footer' | 'full_page_context';
    normalizedBox: NormalizedBox2D;
  }>;
}

export interface PageContextVerificationEvidence {
  verified: boolean;
  is_loyalty_page: boolean;
  loyalty_program_name: string | null;
  applies_to_all_page_offers: boolean;
  explicit_scope_evidence: string | null;
  scope_proof_quote?: string | null;
  validity_start_date: string | null;
  validity_end_date: string | null;
  page_currency: string | null;
  page_wide_customer_limit_pcs: number | null;
  page_wide_exclusions?: string[];
  regional_scope?: string | null;
  exception_offer_numbers: number[];
  sourceRegionKind: 'page_header' | 'page_footer' | 'full_page_context';
  rawCropSha256?: string | null;
}

export interface CropLineageMetadata {
  cropId: string;
  parentSourceOfferId: string;
  regionKind: 'offer_card' | 'compound_card_full' | 'page_header' | 'page_footer';
  expectedLeafletId?: string | null;
  expectedPageNumber?: number | null;
  expectedOfferNumber?: number | null;
  manifestSlotId?: string | null;
  sourcePageImagePath: string;
  sourcePageWidth: number;
  sourcePageHeight: number;
  rawUnionNormalizedBox: NormalizedBox2D | null;
  paddedNormalizedBox: NormalizedBox2D | null;
  pixelBox: PixelBoundingBox | null;
  paddingRatio: number;
  cropImagePath: string | null;
  cropSha256: string | null;
  rawResponseArchivePath?: string | null;
  rawResponseSha256?: string | null;
  lineageVerified?: boolean;
  lineageRejectionReason?: string | null;
  geometryValid: boolean;
  geometryIssues: string[];
}

export type FieldReconciliationOutcome =
  | 'confirmed'
  | 'corrected'
  | 'enriched'
  | 'conflict_unresolved'
  | 'requires_operator_review'
  | 'quarantined';

export interface FieldReconciliationEntry {
  field: string;
  outcome: FieldReconciliationOutcome;
  pageValue: unknown;
  cropValue: unknown;
  finalValue: unknown;
  rationale: string;
}

/**
 * Unambiguous vision-evidence status (never conflated with verified catalog product matching).
 */
export type ReconciledCardOverallStatus =
  | 'evidence_confirmed_single_sku'
  | 'evidence_confirmed_multi_sku'
  | 'evidence_confirmed_compound_tiers'
  | 'retained_non_catalog_review'
  | 'quarantined_conflict'
  | 'held_unverified_p0_budget_or_failure'
  | 'unverified_page_only_p2';

export type LegacyWp6CardStatusAlias =
  | 'verified_single_sku'
  | 'verified_decomposed_multi_sku'
  | 'verified_compound_tiers'
  | 'retained_non_catalog_review'
  | 'quarantined_conflict'
  | 'held_unverified_p0_budget_or_failure'
  | 'unverified_page_only_p2';

export const LEGACY_WP6_STATUS_ALIAS_MAP: Record<
  ReconciledCardOverallStatus,
  LegacyWp6CardStatusAlias
> = {
  evidence_confirmed_single_sku: 'verified_single_sku',
  evidence_confirmed_multi_sku: 'verified_decomposed_multi_sku',
  evidence_confirmed_compound_tiers: 'verified_compound_tiers',
  retained_non_catalog_review: 'retained_non_catalog_review',
  quarantined_conflict: 'quarantined_conflict',
  held_unverified_p0_budget_or_failure: 'held_unverified_p0_budget_or_failure',
  unverified_page_only_p2: 'unverified_page_only_p2'
};

export function mapHybridStatusToLegacyWp6Alias(
  status: ReconciledCardOverallStatus
): LegacyWp6CardStatusAlias {
  return LEGACY_WP6_STATUS_ALIAS_MAP[status];
}

export type VisionVerificationStatus =
  | 'vision_evidence_confirmed_single_sku'
  | 'vision_evidence_confirmed_multi_sku'
  | 'vision_evidence_confirmed_compound_tiers'
  | 'vision_retained_non_catalog_review'
  | 'vision_quarantined_conflict'
  | 'vision_held_unverified_p0'
  | 'vision_unverified_page_only_p2';

export type CatalogVerificationStatus =
  | 'not_run_offline'
  | 'crop_verification_required_before_catalog_match'
  | 'candidate_ready_unmatched_pending_catalog_match'
  | 'blocked_conflict_or_incomplete';

export interface ReconciledV3CardResult {
  sourceOfferId: string;
  parentSourceOfferId: string;
  offerNumber: number;
  selectionDecision: CardCropSelectionDecision;
  cropExecuted: boolean;
  cropStatus:
    | 'not_needed'
    | 'executed'
    | 'cache_hit'
    | 'skipped_budget'
    | 'missing_offline_archive'
    | 'failed'
    | 'invalid_geometry'
    | 'invalid_lineage';
  cropLineage: CropLineageMetadata | null;
  overallStatus: ReconciledCardOverallStatus;
  legacyOverallStatusAlias: LegacyWp6CardStatusAlias;
  visionVerificationStatus: VisionVerificationStatus;
  catalogVerificationStatus: CatalogVerificationStatus;
  requiresCropVerificationForCatalogMatch: boolean;
  reconciledCard: OfferContractV3Record;
  fieldDecisions: FieldReconciliationEntry[];
  decomposition: V3DecompositionResult;
  publicationAssessment: OfferPublicationAssessment;
  matchingAdapterSummary: {
    matchableChildrenCount: number;
    singleSkuMatchEligible: boolean;
    unresolvedChildrenCount: number;
    candidateKeys: string[];
    isolatedIdentityTokens: string[];
  };
  tierCompletenessUnresolved: boolean;
  notes: string[];
}

export interface HybridBudgetPolicy {
  maxCropsPerPage: number;
  maxSpendUsdPerJob: number;
  maxSpendUsdPerPage: number;
  maxRequestsPerJob: number;
  maxPagePlusCropLatencyMs: number;
  allowP1WhenBudgetAllows: boolean;
  failClosedOnUnverifiedP0: boolean;
  enableIndependentP2Audit?: boolean;
  p2AuditSampleRate?: number;
  p2AuditSeed?: string;
}

export interface HybridCostLatencyTelemetry {
  model: string;
  thinkingLevel: string;
  tier: 'flex' | 'standard';
  pageRequests: number;
  cropRequests: number;
  pageContextRequests: number;
  p2AuditRequests: number;
  cacheHits: number;
  failedRequests: number;
  outcomeUnknownRequests: number;
  totalEstimatedCostUsd: number;
  pageCostUsd: number;
  cropCostUsd: number;
  pageContextCostUsd: number;
  p2AuditCostUsd: number;
  totalLatencyMs: number;
  pageLatencyMs: number;
  cropLatencyMs: number;
  budgetExhausted: boolean;
  budgetStopReason: string | null;
}

export interface HybridCheckpointState {
  checkpointVersion: 'wifran.v3.hybrid.checkpoint/1.0';
  runId: string;
  leafletId: string;
  pageNumber: number;
  stage: 'init' | 'page_failed' | 'page_done' | 'page_context_done' | 'crops_in_progress' | 'completed';
  completedPageKey: string | null;
  pageContextDone: boolean;
  completedCropKeys: string[];
  failedCropKeys: string[];
  cumulativeCostUsd: number;
  cumulativeRequests: number;
  failedAttemptsCount?: number;
  lastError?: string | null;
  lastFinishReason?: string | null;
  updatedAt: string;
}

export interface HybridExtractionRequestPayload {
  requestKind: 'full_page' | 'card_crop' | 'page_context';
  cacheKey: string;
  leafletId: string;
  pageNumber: number;
  retailer: string;
  sourceOfferId?: string;
  regionKind?: 'offer_card' | 'page_header' | 'page_footer';
  imagePath: string;
  pixelBox?: PixelBoundingBox | null;
  promptText: string;
  requestPurpose?: string;
  retryOfRequestId?: string | null;
  recoveryParentRequestId?: string | null;
}

export interface HybridExtractionProviderResponse {
  ok: boolean;
  requestId?: string;
  rawText?: string;
  parsedJson?: unknown;
  errorCode?: string;
  errorMessage?: string;
  outcomeUnknown?: boolean;
  finishReason?: string | null;
  model?: string;
  thinkingLevel?: string;
  tier?: 'flex' | 'standard';
  actualTier?: string | null;
  apiProvider?: 'vertex_ai' | 'gemini_developer' | 'mock';
  promptVersion?: string;
  schemaVersion?: string;
  promptSha256?: string;
  schemaSha256?: string;
  rawArchivePath?: string | null;
  fromCache?: boolean;
  durationMs: number;
  usageReported?: boolean;
  rawUsageMetadata?: Record<string, unknown> | null;
  usage?: {
    promptTokenCount?: number | null;
    candidatesTokenCount?: number | null;
    thoughtsTokenCount?: number | null;
    cachedContentTokenCount?: number | null;
    totalTokenCount?: number | null;
  };
  costUsdOverride?: number;
}

export interface HybridExtractionProvider {
  providerId: string;
  isOfflineOrMock: boolean;
  extractPage(req: HybridExtractionRequestPayload): Promise<HybridExtractionProviderResponse>;
  extractCardCrop(req: HybridExtractionRequestPayload): Promise<HybridExtractionProviderResponse>;
  verifyPageContext?(req: HybridExtractionRequestPayload): Promise<{
    ok: boolean;
    evidence?: PageContextVerificationEvidence;
    rawResponse?: HybridExtractionProviderResponse;
    errorMessage?: string;
  }>;
}

export interface HybridP2AuditSummary {
  enabled: boolean;
  eligibleP2Count: number;
  selectedAuditCount: number;
  executedAuditCount: number;
  selectedSourceOfferIds: string[];
  auditEstimatedCostUsd: number;
  findings: Array<{
    sourceOfferId: string;
    stratumKey: string;
    pageVsCropAgreed: boolean;
    newlyDetectedRisks: string[];
  }>;
}

export interface HybridPageRunResult {
  ok: boolean;
  abortedReason: string | null;
  featureEnabled: boolean;
  databaseWritesEnabled: false;
  leafletId: string;
  pageNumber: number;
  retailer: string;
  totalSourceCards: number;
  p0FlaggedCount: number;
  p1FlaggedCount: number;
  p2NoCropCount: number;
  flaggedForCropRatePercent: number;
  cropsExecutedCount: number;
  cropsCacheHitCount: number;
  cropsSkippedBudgetCount: number;
  cropsFailedOrInvalidCount: number;
  pageContextVerificationNeed: PageContextVerificationNeed;
  pageContextApplied: PageContextVerificationEvidence | null;
  p2AuditSummary: HybridP2AuditSummary;
  reconciledCards: ReconciledV3CardResult[];
  componentBoxesBySourceOfferId?: Record<string, V3RawComponentBoxes>;
  rawPageMetadata?: {
    validityStartDate?: string | null;
    validityEndDate?: string | null;
    pageCurrency?: string | null;
    ignoredBanners?: string[];
  };
  telemetry: HybridCostLatencyTelemetry;
  checkpoint: HybridCheckpointState;
  ledgerEntries?: import('./costAccounting').GeminiUsageLedgerEntry[];
  recoveryApplied?: {
    triggered: boolean;
    reason: string | null;
    regionsProcessed: number;
    recoveredOffersCount: number;
  } | null;
  summary: {
    verifiedSingleSkuCards: number;
    verifiedDecomposedParents: number;
    verifiedDecomposedChildren: number;
    verifiedMatchableChildren: number;
    compoundTierCardsEmitted: number;
    nonCatalogReviewCards: number;
    quarantinedCards: number;
    heldUnverifiedP0Cards: number;
    consumerEligibleCards: number;
    excludedNonGroceryCards: number;
  };
}

export type HybridItemDomainFilter = V3ItemDomain;
export type HybridConflictCode = V3ConflictCode;
