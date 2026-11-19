import type {
  GeminiJobUsageSummary,
  GeminiPageUsageReport,
  GeminiProviderCacheEconomicEvaluation
} from './geminiCacheTypes';
import {
  GEMINI_MODEL_PRICING_SCHEDULES,
  getModelPricing,
  calculateGeminiCost,
  type ModelPricingTier,
  type ModelPricingSchedule,
  type GeminiTokenUsageInput
} from '../../shared/utils/geminiPricingAndCostEstimator';

export {
  GEMINI_MODEL_PRICING_SCHEDULES,
  getModelPricing,
  calculateGeminiCost,
  type ModelPricingTier,
  type ModelPricingSchedule,
  type GeminiTokenUsageInput
};

/**
 * Aggregates individual page extraction usage reports into a job-level summary.
 */
export function aggregateJobUsage(
  pageReports: GeminiPageUsageReport[],
  totalPages: number = pageReports.length
): GeminiJobUsageSummary {
  const summary: GeminiJobUsageSummary = {
    totalPages,
    processedPages: pageReports.length,
    apiCallsCount: 0,
    cacheHitsCount: 0,
    retriesCount: 0,
    totalPromptTokens: 0,
    totalCandidatesTokens: 0,
    totalThoughtsTokens: 0,
    totalCachedTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    serviceTiersUsed: {
      standard: 0,
      flex: 0
    },
    pageReports
  };

  for (const report of pageReports) {
    if (report.cacheHit) {
      summary.cacheHitsCount++;
    } else {
      summary.apiCallsCount++;
    }
    summary.retriesCount += report.retriesCount || 0;
    summary.totalPromptTokens += report.usage?.promptTokenCount || 0;
    summary.totalCandidatesTokens += report.usage?.candidatesTokenCount || 0;
    summary.totalThoughtsTokens += report.usage?.thoughtsTokenCount || 0;
    summary.totalCachedTokens += report.usage?.cachedContentTokenCount || 0;
    summary.totalTokens += report.usage?.totalTokenCount || 0;
    summary.totalCostUsd = Number((summary.totalCostUsd + (report.cost?.totalCostUsd || 0)).toFixed(8));
    if (report.actualServiceTier === 'flex') {
      summary.serviceTiersUsed.flex++;
    } else {
      summary.serviceTiersUsed.standard++;
    }
  }

  return summary;
}

/**
 * Calculates provider context cache storage costs for a given token count and duration.
 */
export function calculateCacheStorageCost(
  tokenCount: number,
  ttlHours: number,
  modelId: string = 'gemini-3.8-flash',
  asOfDate?: string
): number {
  const pricing = getModelPricing(modelId, 'standard', asOfDate);
  const rate = pricing.cacheStoragePerMillionPerHour ?? 1.00;
  return (Math.max(0, tokenCount) / 1_000_000) * Math.max(0, ttlHours) * rate;
}

/**
 * Auditable economic break-even evaluation for Google Provider Context Caching.
 * Determines whether the upfront creation and ongoing storage cost of an explicit context cache
 * will be amortized and yield net positive savings across expected subsequent queries.
 */
export function evaluateProviderCacheEconomics(params: {
  modelId: string;
  tier: 'standard' | 'flex';
  sharedTokenCount: number;
  expectedRequests: number;
  ttlSeconds?: number;
  asOfDate?: string;
  minimumTokens?: number;
}): GeminiProviderCacheEconomicEvaluation {
  const {
    modelId,
    tier,
    sharedTokenCount,
    expectedRequests,
    ttlSeconds = 3600,
    asOfDate,
    minimumTokens = 4096
  } = params;

  const rates = getModelPricing(modelId, tier, asOfDate);
  const ttlHours = Math.max(0.25, ttlSeconds / 3600);
  const storageRate = rates.cacheStoragePerMillionPerHour ?? 1.00;

  const storageCostUsd = (sharedTokenCount / 1_000_000) * ttlHours * storageRate;
  const creationInputCostUsd = (sharedTokenCount / 1_000_000) * rates.inputPerMillion;
  const totalInvestmentUsd = creationInputCostUsd + storageCostUsd;

  const nonCachedPerToken = rates.inputPerMillion / 1_000_000;
  const cachedPerToken = rates.cachedInputPerMillion / 1_000_000;
  const netSavingsPerRequestUsd = sharedTokenCount * (nonCachedPerToken - cachedPerToken);

  const breakEvenRequests =
    netSavingsPerRequestUsd > 0
      ? Math.ceil(totalInvestmentUsd / netSavingsPerRequestUsd)
      : Infinity;

  const isEligible = sharedTokenCount >= minimumTokens;
  const netProjectedSavingsUsd =
    expectedRequests * netSavingsPerRequestUsd - totalInvestmentUsd;

  let recommendation: 'skip_ineligible' | 'skip_uneconomic' | 'create_cache';
  let skipReason: string | null = null;

  if (!isEligible) {
    recommendation = 'skip_ineligible';
    skipReason = `SHARED_TOKENS_BELOW_MINIMUM: Shared context has ${sharedTokenCount} tokens, which is below the minimum threshold of ${minimumTokens} tokens required for Google context caching.`;
  } else if (expectedRequests < breakEvenRequests || netProjectedSavingsUsd <= 0) {
    recommendation = 'skip_uneconomic';
    skipReason = `UNECONOMIC_BREAK_EVEN: Break-even requires ${breakEvenRequests} requests to amortize creation ($${creationInputCostUsd.toFixed(4)}) and storage ($${storageCostUsd.toFixed(4)}), but only ${expectedRequests} requests are expected (projected net loss: $${Math.abs(netProjectedSavingsUsd).toFixed(4)}).`;
  } else {
    recommendation = 'create_cache';
  }

  return {
    modelId,
    asOfDate: rates.effectiveDate,
    tier,
    sharedTokenCount,
    minimumRequiredTokens: minimumTokens,
    isEligible,
    ttlSeconds,
    storageCostPerMillionPerHour: storageRate,
    storageCostUsd,
    creationInputCostUsd,
    nonCachedInputCostPerMillion: rates.inputPerMillion,
    cachedInputCostPerMillion: rates.cachedInputPerMillion,
    netSavingsPerRequestUsd,
    breakEvenRequests,
    expectedRequests,
    netProjectedSavingsUsd,
    recommendation,
    skipReason
  };
}
