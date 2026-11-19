import type { GeminiCostCalculation } from '../types/geminiCacheTypes';
import type { HybridBudgetPolicy } from '../types/hybridExtractionV3';
import type { ExtractionPipelineMode } from '../types/batchExtraction';

export type ModelPricingTier = {
  effectiveDate: string;
  inputPerMillion: number;
  outputPerMillion: number;
  thinkingPerMillion: number;
  cachedInputPerMillion: number;
  cacheStoragePerMillionPerHour?: number;
};

export type ModelPricingSchedule = {
  modelId: string;
  schedules: {
    effectiveDate: string;
    standard: ModelPricingTier;
    flex: ModelPricingTier;
  }[];
};

export type GeminiTokenUsageInput = {
  promptTokenCount?: number | null;
  candidatesTokenCount?: number | null;
  thoughtsTokenCount?: number | null;
  thinkingTokenCount?: number | null;
  cachedContentTokenCount?: number | null;
  totalTokenCount?: number | null;
};

/**
 * Official Versioned Gemini Developer API Pricing Schedules.
 * Rates are expressed in USD per 1,000,000 tokens.
 * Source: https://ai.google.dev/gemini-api/docs/pricing
 */
export const GEMINI_MODEL_PRICING_SCHEDULES: Record<string, ModelPricingSchedule> = {
  'gemini-3.8-flash': {
    modelId: 'gemini-3.8-flash',
    schedules: [
      {
        effectiveDate: '2026-11-07',
        standard: {
          effectiveDate: '2026-11-07',
          inputPerMillion: 0.75,
          outputPerMillion: 3.75,
          thinkingPerMillion: 3.75,
          cachedInputPerMillion: 0.075,
          cacheStoragePerMillionPerHour: 0.50
        },
        flex: {
          effectiveDate: '2026-11-07',
          inputPerMillion: 0.375,
          outputPerMillion: 1.875,
          thinkingPerMillion: 1.875,
          cachedInputPerMillion: 0.0375,
          cacheStoragePerMillionPerHour: 0.50
        }
      },
      {
        effectiveDate: '2027-01-01',
        standard: {
          effectiveDate: '2027-01-01',
          inputPerMillion: 1.50,
          outputPerMillion: 7.50,
          thinkingPerMillion: 7.50,
          cachedInputPerMillion: 0.15,
          cacheStoragePerMillionPerHour: 0.50
        },
        flex: {
          effectiveDate: '2027-01-01',
          inputPerMillion: 0.75,
          outputPerMillion: 3.75,
          thinkingPerMillion: 3.75,
          cachedInputPerMillion: 0.075,
          cacheStoragePerMillionPerHour: 0.50
        }
      }
    ]
  },
  'gemini-4-argon': {
    modelId: 'gemini-4-argon',
    schedules: [
      {
        effectiveDate: '2026-11-07',
        standard: {
          effectiveDate: '2026-11-07',
          inputPerMillion: 1.25,
          outputPerMillion: 5.00,
          thinkingPerMillion: 5.00,
          cachedInputPerMillion: 0.3125,
          cacheStoragePerMillionPerHour: 4.50
        },
        flex: {
          effectiveDate: '2026-11-07',
          inputPerMillion: 0.625,
          outputPerMillion: 2.50,
          thinkingPerMillion: 2.50,
          cachedInputPerMillion: 0.15625,
          cacheStoragePerMillionPerHour: 4.50
        }
      }
    ]
  }
};

export const B1_BASELINE_COST_PER_OFFER_USD = 0.002;
export const COMPLETE_PLANNING_ALLOWANCE_LOW_PER_OFFER_USD = 0.004;
export const COMPLETE_PLANNING_ALLOWANCE_HIGH_PER_OFFER_USD = 0.006;
export const DEFAULT_EXPECTED_OFFERS_PER_PAGE = 16;

export const DEFAULT_HYBRID_BUDGET_POLICY: HybridBudgetPolicy = {
  maxCropsPerPage: 10,
  maxSpendUsdPerJob: 1.50,
  maxSpendUsdPerPage: 0.25,
  maxRequestsPerJob: 30,
  maxPagePlusCropLatencyMs: 360_000,
  allowP1WhenBudgetAllows: true,
  failClosedOnUnverifiedP0: true,
  enableIndependentP2Audit: false,
  p2AuditSampleRate: 0.2,
  p2AuditSeed: 'wp7_p2_audit_v1'
};

/**
 * Live pilot telemetry token baselines (Stage B1 full page & Stage B2 extraction_v3_crop_r1 mean),
 * preserving input, visible output, and thinking tokens so estimates recompute dynamically via
 * `calculateGeminiCost` for any selected model and service tier (`flex` vs `standard`).
 */
export const HYBRID_V3_LIVE_PILOT_TOKEN_PROFILES = {
  fullPage: {
    promptTokenCount: 5998,
    candidatesTokenCount: 9545,
    thoughtsTokenCount: 1786
  } satisfies GeminiTokenUsageInput,
  verificationCrop: {
    promptTokenCount: 4474,
    candidatesTokenCount: 1520.25,
    thoughtsTokenCount: 979.5
  } satisfies GeminiTokenUsageInput,
  legacyRev1FullPageLow: {
    promptTokenCount: 3200,
    candidatesTokenCount: 1800,
    thoughtsTokenCount: 0
  } satisfies GeminiTokenUsageInput,
  legacyRev1FullPageHigh: {
    promptTokenCount: 5200,
    candidatesTokenCount: 4200,
    thoughtsTokenCount: 1000
  } satisfies GeminiTokenUsageInput
} as const;

export function getModelPricing(
  modelId: string,
  tier: 'standard' | 'flex' = 'standard',
  asOfDate?: string
): ModelPricingTier {
  const normalized = modelId.toLowerCase();
  const scheduleConfig =
    GEMINI_MODEL_PRICING_SCHEDULES[normalized] ||
    (normalized.includes('pro') || normalized.includes('argon')
      ? GEMINI_MODEL_PRICING_SCHEDULES['gemini-4-argon']
      : GEMINI_MODEL_PRICING_SCHEDULES['gemini-3.8-flash']);

  const targetDate = asOfDate || new Date().toISOString().slice(0, 10);

  const applicableSchedules = [...scheduleConfig.schedules]
    .filter((s) => s.effectiveDate <= targetDate)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

  const activeSchedule = applicableSchedules[0] || scheduleConfig.schedules[0];
  return tier === 'flex' ? activeSchedule.flex : activeSchedule.standard;
}

export function calculateGeminiCost(
  usage: GeminiTokenUsageInput,
  modelId: string,
  tier: 'standard' | 'flex',
  asOfDate?: string
): GeminiCostCalculation {
  const rates = getModelPricing(modelId, tier, asOfDate);

  if (usage.promptTokenCount === undefined || usage.promptTokenCount === null) {
    return {
      currency: 'USD',
      effectiveDate: rates.effectiveDate,
      modelId,
      tier,
      ratesApplied: {
        inputPerMillion: rates.inputPerMillion,
        outputPerMillion: rates.outputPerMillion,
        cachedInputPerMillion: rates.cachedInputPerMillion
      },
      inputCostUsd: 0,
      outputCostUsd: 0,
      thinkingCostUsd: 0,
      cachedInputCostUsd: 0,
      totalCostUsd: 0,
      isEstimate: true,
      metadataMissing: true
    };
  }

  const rawPrompt = Math.max(0, usage.promptTokenCount);
  const cachedPrompt = Math.min(rawPrompt, Math.max(0, usage.cachedContentTokenCount || 0));
  const uncachedPrompt = Math.max(0, rawPrompt - cachedPrompt);

  const rawCandidatesTokens = Math.max(0, usage.candidatesTokenCount || 0);
  const thoughtsTokens = Math.max(0, usage.thoughtsTokenCount ?? usage.thinkingTokenCount ?? 0);

  let visibleOutputTokens = rawCandidatesTokens;
  if (
    typeof usage.totalTokenCount === 'number' &&
    usage.totalTokenCount > 0 &&
    thoughtsTokens > 0 &&
    rawCandidatesTokens >= thoughtsTokens &&
    usage.totalTokenCount === rawPrompt + rawCandidatesTokens
  ) {
    visibleOutputTokens = Math.max(0, rawCandidatesTokens - thoughtsTokens);
  }

  const inputCostUsd = Number(((uncachedPrompt / 1_000_000) * rates.inputPerMillion).toFixed(8));
  const cachedInputCostUsd = Number(((cachedPrompt / 1_000_000) * rates.cachedInputPerMillion).toFixed(8));
  const outputCostUsd = Number(((visibleOutputTokens / 1_000_000) * rates.outputPerMillion).toFixed(8));
  const thinkingCostUsd = Number(((thoughtsTokens / 1_000_000) * rates.thinkingPerMillion).toFixed(8));

  const totalCostUsd = Number(
    (inputCostUsd + cachedInputCostUsd + outputCostUsd + thinkingCostUsd).toFixed(8)
  );

  return {
    currency: 'USD',
    effectiveDate: rates.effectiveDate,
    modelId,
    tier,
    ratesApplied: {
      inputPerMillion: rates.inputPerMillion,
      outputPerMillion: rates.outputPerMillion,
      cachedInputPerMillion: rates.cachedInputPerMillion
    },
    inputCostUsd,
    outputCostUsd,
    thinkingCostUsd,
    cachedInputCostUsd,
    totalCostUsd,
    isEstimate: true,
    metadataMissing: false
  };
}

export interface BatchApiCostEstimate {
  pipelineMode: ExtractionPipelineMode;
  modelId: string;
  tier: 'flex' | 'standard';
  targetPageCount: number;
  fullPageUnitCostUsd: number;
  cropUnitCostUsd: number;
  expectedCropsPerPageLow: number;
  expectedCropsPerPageMid: number;
  expectedCropsPerPageHigh: number;
  estimatedFullPageLowUsd: number;
  estimatedFullPageHighUsd: number;
  estimatedCropLowUsd: number;
  estimatedCropHighUsd: number;
  estimatedMatchingLowUsd: number;
  estimatedMatchingHighUsd: number;
  totalEstimatedLowUsd: number;
  totalEstimatedHighUsd: number;
  maxAuthorizedTotalCapUsd: number;
  estimatedLowUsd: number;
  estimatedMidUsd: number;
  estimatedHighUsd: number;
  maxAuthorizedCapUsd: number;
  governorPerPageCapUsd: number;
  governorPerJobCapUsd: number;
  includesOutputAndThinkingTokens: boolean;
  expectedOffersPerPage: number;
  b1BaselinePerOfferUsd: number;
  expectedNormalCostPerOfferLowUsd: number;
  expectedNormalCostPerOfferHighUsd: number;
  expectedNormalLowUsd: number;
  expectedNormalHighUsd: number;
}

/**
 * Computes a pre-extraction API cost estimate for a batch using `calculateGeminiCost`
 * and `DEFAULT_HYBRID_BUDGET_POLICY`, scaling by actual selected target pages, model,
 * service tier (`flex` vs `standard`), date schedule (including Jan 2027), full-page calls,
 * expected offer density, and worst-case authorized ceiling.
 */
export function estimateBatchApiCost(params: {
  targetPageCount: number;
  extractionPipelineMode?: ExtractionPipelineMode;
  modelId?: string;
  tier?: 'flex' | 'standard';
  budgetPolicy?: Partial<HybridBudgetPolicy>;
  asOfDate?: string;
  expectedOffersPerPage?: number;
}): BatchApiCostEstimate {
  const targetPageCount = Math.max(0, Math.floor(params.targetPageCount || 0));
  const pipelineMode: ExtractionPipelineMode = params.extractionPipelineMode || 'legacy_rev1';
  const modelId = params.modelId || 'gemini-3.8-flash';
  const tier: 'flex' | 'standard' = params.tier || 'flex';
  const policy: HybridBudgetPolicy = {
    ...DEFAULT_HYBRID_BUDGET_POLICY,
    ...(params.budgetPolicy || {})
  };
  const pricingDate = params.asOfDate || new Date().toISOString().slice(0, 10);
  const expectedOffersPerPage = Math.max(1, Math.round(params.expectedOffersPerPage ?? DEFAULT_EXPECTED_OFFERS_PER_PAGE));

  const baselineFlexRates = getModelPricing('gemini-3.8-flash', 'flex', '2026-11-16');
  const activeRates = getModelPricing(modelId, tier, pricingDate);
  const outputRateScale =
    baselineFlexRates.outputPerMillion > 0
      ? activeRates.outputPerMillion / baselineFlexRates.outputPerMillion
      : 1;
  const b1BaselinePerOfferUsd = Number((B1_BASELINE_COST_PER_OFFER_USD * outputRateScale).toFixed(6));
  const expectedNormalCostPerOfferLowUsd = Number(
    (COMPLETE_PLANNING_ALLOWANCE_LOW_PER_OFFER_USD * outputRateScale).toFixed(6)
  );
  const expectedNormalCostPerOfferHighUsd = Number(
    (COMPLETE_PLANNING_ALLOWANCE_HIGH_PER_OFFER_USD * outputRateScale).toFixed(6)
  );
  const expectedNormalLowUsd = Number(
    (targetPageCount * expectedOffersPerPage * expectedNormalCostPerOfferLowUsd).toFixed(4)
  );
  const expectedNormalHighUsd = Number(
    (targetPageCount * expectedOffersPerPage * expectedNormalCostPerOfferHighUsd).toFixed(4)
  );

  if (pipelineMode === 'hybrid_v3') {
    const fullPageCalc = calculateGeminiCost(
      HYBRID_V3_LIVE_PILOT_TOKEN_PROFILES.fullPage,
      modelId,
      tier,
      pricingDate
    );
    const cropCalc = calculateGeminiCost(
      HYBRID_V3_LIVE_PILOT_TOKEN_PROFILES.verificationCrop,
      modelId,
      tier,
      pricingDate
    );

    // Routine Hybrid V3 architecture is B1-first: 1 full-page Gemini request per page,
    // and 0 automatic B2 crop-analysis requests.
    const expectedCropsPerPageLow = 0;
    const expectedCropsPerPageMid = 0;
    const expectedCropsPerPageHigh = 0;

    const perPageCapUsd = policy.maxSpendUsdPerPage;
    const perPageLow = Math.min(
      perPageCapUsd,
      fullPageCalc.totalCostUsd + expectedCropsPerPageLow * cropCalc.totalCostUsd
    );
    const perPageMid = Math.min(
      perPageCapUsd,
      fullPageCalc.totalCostUsd + expectedCropsPerPageMid * cropCalc.totalCostUsd
    );
    const perPageHigh = Math.min(
      perPageCapUsd,
      fullPageCalc.totalCostUsd + expectedCropsPerPageHigh * cropCalc.totalCostUsd
    );

    const estimatedLowUsd = Number((targetPageCount * perPageLow).toFixed(4));
    const estimatedMidUsd = Number((targetPageCount * perPageMid).toFixed(4));
    const estimatedHighUsd = Number((targetPageCount * perPageHigh).toFixed(4));
    const maxAuthorizedCapUsd = Number((targetPageCount * perPageCapUsd).toFixed(4));

    // Itemized component breakdown for unified batch setup display
    const estimatedFullPageLowUsd = Number((targetPageCount * fullPageCalc.totalCostUsd).toFixed(4));
    const estimatedFullPageHighUsd = estimatedFullPageLowUsd;
    const estimatedCropLowUsd = Number((targetPageCount * expectedCropsPerPageLow * cropCalc.totalCostUsd).toFixed(4));
    const estimatedCropHighUsd = Number((targetPageCount * expectedCropsPerPageHigh * cropCalc.totalCostUsd).toFixed(4));

    const matchingUnitLow = calculateGeminiCost(
      { promptTokenCount: 1500, candidatesTokenCount: 120, thoughtsTokenCount: 250, cachedContentTokenCount: 0 },
      modelId,
      tier,
      pricingDate
    );
    const matchingUnitHigh = calculateGeminiCost(
      { promptTokenCount: 2200, candidatesTokenCount: 250, thoughtsTokenCount: 512, cachedContentTokenCount: 0 },
      modelId,
      tier,
      pricingDate
    );
    const matchingRequestsLow = targetPageCount > 0 ? Math.max(1, Math.ceil(targetPageCount * 0.5)) : 0;
    const matchingRequestsHigh = targetPageCount > 0 ? Math.max(1, Math.ceil(targetPageCount * 1.5)) : 0;
    const estimatedMatchingLowUsd = Number((matchingRequestsLow * matchingUnitLow.totalCostUsd).toFixed(4));
    const estimatedMatchingHighUsd = Number((matchingRequestsHigh * matchingUnitHigh.totalCostUsd).toFixed(4));

    const totalEstimatedLowUsd = Number((estimatedLowUsd + estimatedMatchingLowUsd).toFixed(4));
    const totalEstimatedHighUsd = Number((estimatedHighUsd + estimatedMatchingHighUsd).toFixed(4));
    const maxAuthorizedTotalCapUsd = Number(
      Math.max(maxAuthorizedCapUsd + estimatedMatchingHighUsd * 1.5, totalEstimatedHighUsd * 1.25).toFixed(4)
    );

    return {
      pipelineMode,
      modelId,
      tier,
      targetPageCount,
      fullPageUnitCostUsd: Number(fullPageCalc.totalCostUsd.toFixed(6)),
      cropUnitCostUsd: Number(cropCalc.totalCostUsd.toFixed(6)),
      expectedCropsPerPageLow,
      expectedCropsPerPageMid,
      expectedCropsPerPageHigh,
      estimatedFullPageLowUsd,
      estimatedFullPageHighUsd,
      estimatedCropLowUsd,
      estimatedCropHighUsd,
      estimatedMatchingLowUsd,
      estimatedMatchingHighUsd,
      totalEstimatedLowUsd,
      totalEstimatedHighUsd,
      maxAuthorizedTotalCapUsd,
      estimatedLowUsd,
      estimatedMidUsd,
      estimatedHighUsd,
      maxAuthorizedCapUsd,
      governorPerPageCapUsd: policy.maxSpendUsdPerPage,
      governorPerJobCapUsd: policy.maxSpendUsdPerJob,
      includesOutputAndThinkingTokens: true,
      expectedOffersPerPage,
      b1BaselinePerOfferUsd,
      expectedNormalCostPerOfferLowUsd,
      expectedNormalCostPerOfferHighUsd,
      expectedNormalLowUsd,
      expectedNormalHighUsd
    };
  }

  // Standard / Legacy Rev1 baseline (full-page extraction only, no selective crops)
  const rev1Low = calculateGeminiCost(
    HYBRID_V3_LIVE_PILOT_TOKEN_PROFILES.legacyRev1FullPageLow,
    modelId,
    tier,
    pricingDate
  );
  const rev1High = calculateGeminiCost(
    HYBRID_V3_LIVE_PILOT_TOKEN_PROFILES.legacyRev1FullPageHigh,
    modelId,
    tier,
    pricingDate
  );

  const estimatedLowUsd = Number((targetPageCount * rev1Low.totalCostUsd).toFixed(4));
  const estimatedHighUsd = Number((targetPageCount * rev1High.totalCostUsd).toFixed(4));
  const estimatedMidUsd = Number((((estimatedLowUsd + estimatedHighUsd) / 2)).toFixed(4));

  const matchingRev1High = calculateGeminiCost(
    { promptTokenCount: 2200, candidatesTokenCount: 250, thoughtsTokenCount: 512, cachedContentTokenCount: 0 },
    modelId,
    tier,
    pricingDate
  );
  const matchingReqs = targetPageCount > 0 ? Math.max(1, Math.ceil(targetPageCount * 1.25)) : 0;
  const estimatedMatchingLowUsd = 0;
  const estimatedMatchingHighUsd = Number((matchingReqs * matchingRev1High.totalCostUsd).toFixed(4));

  return {
    pipelineMode,
    modelId,
    tier,
    targetPageCount,
    fullPageUnitCostUsd: Number(rev1High.totalCostUsd.toFixed(6)),
    cropUnitCostUsd: 0,
    expectedCropsPerPageLow: 0,
    expectedCropsPerPageMid: 0,
    expectedCropsPerPageHigh: 0,
    estimatedFullPageLowUsd: estimatedLowUsd,
    estimatedFullPageHighUsd: estimatedHighUsd,
    estimatedCropLowUsd: 0,
    estimatedCropHighUsd: 0,
    estimatedMatchingLowUsd,
    estimatedMatchingHighUsd,
    totalEstimatedLowUsd: Number((estimatedLowUsd + estimatedMatchingLowUsd).toFixed(4)),
    totalEstimatedHighUsd: Number((estimatedHighUsd + estimatedMatchingHighUsd).toFixed(4)),
    maxAuthorizedTotalCapUsd: Number((estimatedHighUsd + estimatedMatchingHighUsd * 1.5).toFixed(4)),
    estimatedLowUsd,
    estimatedMidUsd,
    estimatedHighUsd,
    maxAuthorizedCapUsd: estimatedHighUsd,
    governorPerPageCapUsd: Number(rev1High.totalCostUsd.toFixed(4)),
    governorPerJobCapUsd: estimatedHighUsd,
    includesOutputAndThinkingTokens: true,
    expectedOffersPerPage,
    b1BaselinePerOfferUsd,
    expectedNormalCostPerOfferLowUsd,
    expectedNormalCostPerOfferHighUsd,
    expectedNormalLowUsd: estimatedLowUsd,
    expectedNormalHighUsd: estimatedHighUsd
  };
}

export const DEFAULT_METADATA_VISION_BUDGET_CAP_USD = 0.025;

export interface MetadataVisionCostEstimate {
  modelId: string;
  tier: 'flex' | 'standard';
  targetImageCount: number;
  unitCallCostUsd: number;
  estimatedLowUsd: number;
  estimatedHighUsd: number;
  maxAuthorizedCapUsd: number;
  includesOutputAndThinkingTokens: boolean;
}

/**
 * Estimates targeted Tier-B metadata Vision cost (cover + optional selected header/footer strip)
 * completely separate from product extraction budgets.
 */
export function estimateMetadataVisionCost(params: {
  targetImageCount?: number;
  modelId?: string;
  tier?: 'flex' | 'standard';
  asOfDate?: string;
}): MetadataVisionCostEstimate {
  const targetImageCount = Math.max(1, Math.min(2, Math.floor(params.targetImageCount ?? 2)));
  const modelId = params.modelId || 'gemini-3.8-flash';
  const tier: 'flex' | 'standard' = params.tier || 'flex';
  const pricingDate = params.asOfDate || '2026-11-14';

  const unitCall = calculateGeminiCost(
    {
      promptTokenCount: 1500,
      candidatesTokenCount: 350,
      thoughtsTokenCount: 512,
      cachedContentTokenCount: 0
    },
    modelId,
    tier,
    pricingDate
  );

  const unitCost = Number(unitCall.totalCostUsd.toFixed(6));
  const estimatedLowUsd = Number(unitCall.totalCostUsd.toFixed(4));
  const estimatedHighUsd = Number((targetImageCount * unitCall.totalCostUsd).toFixed(4));

  return {
    modelId,
    tier,
    targetImageCount,
    unitCallCostUsd: unitCost,
    estimatedLowUsd,
    estimatedHighUsd,
    maxAuthorizedCapUsd: DEFAULT_METADATA_VISION_BUDGET_CAP_USD,
    includesOutputAndThinkingTokens: true
  };
}
