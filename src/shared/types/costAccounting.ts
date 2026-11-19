/**
 * Persistent Gemini API Usage & Cost Accounting Types
 * Covers B1 full-page extraction, B2 selective crop analysis, AI catalog matching,
 * metadata discovery, recovery attempts, retries, cancellations, and failures.
 */

export type GeminiUsageStageCategory =
  | 'b1_full_page'
  | 'b2_selective_crop'
  | 'catalog_matching'
  | 'metadata_discovery'
  | 'other_gemini';

export type GeminiUsageOutcome =
  | 'success'
  | 'failed'
  | 'truncated_max_tokens'
  | 'cancelled'
  | 'outcome_unknown'
  | 'cache_hit';

export type GeminiUsageStatus =
  | 'measured'
  | 'unavailable_unknown'
  | 'cache_hit_zero';

export interface GeminiUsageLedgerEntry {
  requestId: string;
  batchId: string;
  runId: string;
  leafletId: string;
  pageNumber?: number | null;
  sourceOfferId?: string | null;
  sourceAnchor?: string | null;
  stageCategory: GeminiUsageStageCategory;
  requestPurpose: string;
  modelId: string;
  modelVersion?: string | null;
  apiProvider: 'vertex_ai' | 'gemini_developer' | 'mock' | 'cache';
  requestedTier: 'flex' | 'standard' | 'batch';
  actualTier?: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: GeminiUsageOutcome;
  finishReason?: string | null;
  promptTokens: number;
  responseTokens: number;
  thinkingTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  pricingEffectiveDate: string | null;
  ratesApplied: {
    inputPerMillion: number;
    outputPerMillion: number;
    thinkingPerMillion: number;
    cachedInputPerMillion: number;
  } | null;
  usageStatus: GeminiUsageStatus;
  /**
   * Calculated locally in USD from provider-reported token counts and versioned rates
   * (`null` when `usageStatus === 'unavailable_unknown'`).
   * Not an independently confirmed Google billing invoice figure.
   */
  measuredCostUsd: number | null;
  cacheHit: boolean;
  retryOfRequestId?: string | null;
  recoveryParentRequestId?: string | null;
  errorMessage?: string | null;
  rawUsageMetadata?: Record<string, unknown> | null;
}

export interface GeminiCostCategoryBreakdown {
  b1_full_page: number;
  b2_selective_crop: number;
  catalog_matching: number;
  metadata_discovery: number;
  other_gemini: number;
}

export interface PerLeafletCostSummary {
  leafletId: string;
  fileName: string;
  pagesAttempted: number;
  pagesCompleted: number;
  offersExtracted: number;
  apiCallsCount: number;
  failedOrRetriedCallsCount: number;
  unknownCostCallsCount: number;
  measuredCostUsd: number;
  priorSessionsCostUsd: number;
  latestSessionCostUsd: number;
  categoryBreakdown: GeminiCostCategoryBreakdown;
}

export interface PerPageCostSummary {
  leafletId: string;
  pageNumber: number;
  completed: boolean;
  offersExtracted: number;
  apiCallsCount: number;
  failedOrRetriedCallsCount: number;
  unknownCostCallsCount: number;
  measuredCostUsd: number;
  b1CostUsd: number;
  b2CostUsd: number;
  recoveryCostUsd: number;
  otherCostUsd: number;
}

export interface PerOfferCostAllocation {
  batchOfferKey: string;
  sourceOfferId: string;
  leafletId: string;
  pageNumber: number;
  allocatedPageCostUsd: number;
  directOfferCostUsd: number;
  totalAllocatedCostUsd: number;
}

export interface BatchExtractionCostSummary {
  schemaVersion: 'wifran.gemini_cost_summary/1.0';
  batchId: string;
  latestRunId: string | null;
  totalMeasuredCostUsd: number;
  categoryBreakdown: GeminiCostCategoryBreakdown;
  /**
   * Informational drill-down for failed/retried/recovery invocations.
   * Already included inside the mutually exclusive `categoryBreakdown` totals above;
   * NEVER added a second time to `totalMeasuredCostUsd`.
   */
  failedAndRetriedInformational: {
    callsCount: number;
    measuredCostUsd: number;
    unknownCostCallsCount: number;
  };
  pagesAttempted: number;
  pagesCompleted: number;
  offersExtracted: number;
  totalApiCalls: number;
  cacheHitCallsCount: number;
  failedOrRetriedApiCalls: number;
  unknownCostRequestsCount: number;
  hasUnconfirmedCosts: boolean;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalThinkingTokens: number;
  totalCachedInputTokens: number;
  avgCostPerExtractedOfferUsd: number | null;
  avgCostPerCompletedPageUsd: number | null;
  priorSessionsCostUsd: number;
  latestSessionCostUsd: number;
  maxAuthorizedSpendingUsd: number | null;
  unallocatedSharedOrFailedCostUsd: number;
  perLeaflet: PerLeafletCostSummary[];
  perPage: PerPageCostSummary[];
  perOfferAllocations?: PerOfferCostAllocation[];
  measurementNote: string;
  updatedAt: string;
}
