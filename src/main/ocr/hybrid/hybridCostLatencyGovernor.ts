/**
 * WIFRAN-EXTRACTOR-IDENTITY-005G (WP6-H)
 * Hybrid Cost, Latency & Request Governance.
 *
 * Reuses `calculateGeminiCost` from `geminiPricingTable.ts` and observed `005E`
 * Flex baselines without rigging crop-selection thresholds or bypassing P0 safety holds.
 */

import { calculateGeminiCost, type GeminiTokenUsageInput } from '../geminiPricingTable';
import {
  DEFAULT_HYBRID_BUDGET_POLICY,
  estimateBatchApiCost,
  type BatchApiCostEstimate
} from '../../../shared/utils/geminiPricingAndCostEstimator';
import type {
  CropSelectionPriority,
  HybridBudgetPolicy,
  HybridCostLatencyTelemetry
} from '../../../shared/types/hybridExtractionV3';

export { DEFAULT_HYBRID_BUDGET_POLICY, estimateBatchApiCost, type BatchApiCostEstimate };

export const PILOT_005E_TELEMETRY_BASELINE = {
  model: 'gemini-3.8-flash',
  thinkingLevel: 'MEDIUM',
  tier: 'flex' as const,
  meanPageCostUsd: 0.02115881,
  meanCropCostUsd: 0.00498866,
  meanPageLatencyMs: 60942.75,
  meanCropLatencyMs: 21689.17
} as const;

export interface BudgetCheckResult {
  allowed: boolean;
  reason: string | null;
}

export class HybridCostLatencyGovernor {
  private readonly policy: HybridBudgetPolicy;
  private readonly model: string;
  private readonly thinkingLevel: string;
  private readonly tier: 'flex' | 'standard';

  private pageRequests = 0;
  private cropRequests = 0;
  private pageContextRequests = 0;
  private p2AuditRequests = 0;
  private cacheHits = 0;
  private failedRequests = 0;
  private outcomeUnknownRequests = 0;

  private pageCostUsd = 0;
  private cropCostUsd = 0;
  private pageContextCostUsd = 0;
  private p2AuditCostUsd = 0;
  private jobCostUsd = 0;
  private jobRequests = 0;

  private pageLatencyMs = 0;
  private cropLatencyMs = 0;
  private pageContextLatencyMs = 0;
  private p2AuditLatencyMs = 0;

  private budgetExhausted = false;
  private budgetStopReason: string | null = null;

  constructor(options?: {
    policy?: Partial<HybridBudgetPolicy>;
    model?: string;
    thinkingLevel?: string;
    tier?: 'flex' | 'standard';
    initialJobSpendUsd?: number;
    initialJobRequests?: number;
  }) {
    this.policy = { ...DEFAULT_HYBRID_BUDGET_POLICY, ...(options?.policy || {}) };
    this.model = options?.model || PILOT_005E_TELEMETRY_BASELINE.model;
    this.thinkingLevel = options?.thinkingLevel || PILOT_005E_TELEMETRY_BASELINE.thinkingLevel;
    this.tier = options?.tier || PILOT_005E_TELEMETRY_BASELINE.tier;
    this.jobCostUsd = options?.initialJobSpendUsd ?? 0;
    this.jobRequests = options?.initialJobRequests ?? 0;
  }

  canDispatchCrop(options: {
    priority: CropSelectionPriority;
    remainingPendingP0Count: number;
    isCached?: boolean;
  }): BudgetCheckResult {
    // Cached results consume zero API requests or spend
    if (options.isCached) {
      return { allowed: true, reason: null };
    }

    if (options.priority === 'P2') {
      return { allowed: false, reason: 'P2_NO_CROP_NEEDED' };
    }

    if (options.priority === 'P1' && !this.policy.allowP1WhenBudgetAllows) {
      return { allowed: false, reason: 'P1_SKIPPED_POLICY' };
    }

    if (this.cropRequests >= this.policy.maxCropsPerPage) {
      this.markStopped(`MAX_CROPS_PER_PAGE_REACHED (${this.policy.maxCropsPerPage})`);
      return { allowed: false, reason: this.budgetStopReason };
    }

    if (this.jobRequests + 1 > this.policy.maxRequestsPerJob) {
      this.markStopped(`MAX_REQUESTS_PER_JOB_REACHED (${this.policy.maxRequestsPerJob})`);
      return { allowed: false, reason: this.budgetStopReason };
    }

    const estCost = PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd;
    const p0Reserve =
      options.priority === 'P1'
        ? options.remainingPendingP0Count * estCost
        : 0;

    const currentPageSpend =
      this.pageCostUsd + this.cropCostUsd + this.pageContextCostUsd + this.p2AuditCostUsd;
    if (currentPageSpend + estCost + p0Reserve > this.policy.maxSpendUsdPerPage) {
      const reason =
        options.priority === 'P1' && currentPageSpend + estCost <= this.policy.maxSpendUsdPerPage
          ? 'P0_PRIORITY_RESERVE_ONLY'
          : `PAGE_SPEND_CAP_REACHED (${currentPageSpend.toFixed(6)}/${this.policy.maxSpendUsdPerPage})`;
      if (reason.startsWith('PAGE_SPEND_CAP')) {
        this.markStopped(reason);
      }
      return { allowed: false, reason };
    }

    if (this.jobCostUsd + estCost + p0Reserve > this.policy.maxSpendUsdPerJob) {
      const reason =
        options.priority === 'P1' && this.jobCostUsd + estCost <= this.policy.maxSpendUsdPerJob
          ? 'P0_PRIORITY_RESERVE_ONLY'
          : `JOB_SPEND_CAP_REACHED (${this.jobCostUsd.toFixed(6)}/${this.policy.maxSpendUsdPerJob})`;
      if (reason.startsWith('JOB_SPEND_CAP')) {
        this.markStopped(reason);
      }
      return { allowed: false, reason };
    }

    const totalMs =
      this.pageLatencyMs + this.cropLatencyMs + this.pageContextLatencyMs + this.p2AuditLatencyMs;
    if (totalMs + PILOT_005E_TELEMETRY_BASELINE.meanCropLatencyMs > this.policy.maxPagePlusCropLatencyMs) {
      this.markStopped(`LATENCY_BUDGET_EXCEEDED (${totalMs}ms/${this.policy.maxPagePlusCropLatencyMs}ms)`);
      return { allowed: false, reason: this.budgetStopReason };
    }

    return { allowed: true, reason: null };
  }

  canDispatchP2Audit(isCached = false): BudgetCheckResult {
    if (!this.policy.enableIndependentP2Audit) {
      return { allowed: false, reason: 'P2_AUDIT_DISABLED' };
    }
    if (isCached) {
      return { allowed: true, reason: null };
    }
    if (this.jobRequests + 1 > this.policy.maxRequestsPerJob) {
      return { allowed: false, reason: `MAX_REQUESTS_PER_JOB_REACHED (${this.policy.maxRequestsPerJob})` };
    }
    const estCost = PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd;
    const currentPageSpend =
      this.pageCostUsd + this.cropCostUsd + this.pageContextCostUsd + this.p2AuditCostUsd;
    if (currentPageSpend + estCost > this.policy.maxSpendUsdPerPage) {
      return { allowed: false, reason: 'PAGE_SPEND_CAP_REACHED_BEFORE_P2_AUDIT' };
    }
    if (this.jobCostUsd + estCost > this.policy.maxSpendUsdPerJob) {
      return { allowed: false, reason: 'JOB_SPEND_CAP_REACHED_BEFORE_P2_AUDIT' };
    }
    return { allowed: true, reason: null };
  }

  canDispatchPageContext(isCached = false): BudgetCheckResult {
    if (isCached) return { allowed: true, reason: null };
    if (this.jobRequests + 1 > this.policy.maxRequestsPerJob) {
      this.markStopped(`MAX_REQUESTS_PER_JOB_REACHED (${this.policy.maxRequestsPerJob})`);
      return { allowed: false, reason: this.budgetStopReason };
    }
    const currentPageSpend =
      this.pageCostUsd + this.cropCostUsd + this.pageContextCostUsd + this.p2AuditCostUsd;
    if (currentPageSpend + PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd > this.policy.maxSpendUsdPerPage) {
      this.markStopped('PAGE_SPEND_CAP_REACHED_BEFORE_CONTEXT');
      return { allowed: false, reason: this.budgetStopReason };
    }
    if (this.jobCostUsd + PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd > this.policy.maxSpendUsdPerJob) {
      this.markStopped('JOB_SPEND_CAP_REACHED_BEFORE_CONTEXT');
      return { allowed: false, reason: this.budgetStopReason };
    }
    return { allowed: true, reason: null };
  }

  recordExecution(input: {
    kind: 'full_page' | 'card_crop' | 'page_context' | 'p2_audit';
    ok: boolean;
    outcomeUnknown?: boolean;
    fromCache?: boolean;
    durationMs: number;
    usage?: GeminiTokenUsageInput;
    costUsdOverride?: number;
  }): number {
    if (input.fromCache) {
      this.cacheHits++;
      return 0;
    }

    const cost =
      typeof input.costUsdOverride === 'number'
        ? input.costUsdOverride
        : input.usage
          ? calculateGeminiCost(input.usage, this.model, this.tier).totalCostUsd ??
            (input.kind === 'full_page'
              ? PILOT_005E_TELEMETRY_BASELINE.meanPageCostUsd
              : PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd)
          : input.kind === 'full_page'
            ? PILOT_005E_TELEMETRY_BASELINE.meanPageCostUsd
            : PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd;

    this.jobRequests++;
    this.jobCostUsd = Number((this.jobCostUsd + cost).toFixed(8));
    if (!input.ok) {
      this.failedRequests++;
    }
    if (input.outcomeUnknown) {
      this.outcomeUnknownRequests++;
    }

    if (input.kind === 'full_page') {
      this.pageRequests++;
      this.pageCostUsd = Number((this.pageCostUsd + cost).toFixed(8));
      this.pageLatencyMs += Math.max(0, input.durationMs);
    } else if (input.kind === 'page_context') {
      this.pageContextRequests++;
      this.pageContextCostUsd = Number((this.pageContextCostUsd + cost).toFixed(8));
      this.pageContextLatencyMs += Math.max(0, input.durationMs);
    } else if (input.kind === 'p2_audit') {
      this.p2AuditRequests++;
      this.p2AuditCostUsd = Number((this.p2AuditCostUsd + cost).toFixed(8));
      this.p2AuditLatencyMs += Math.max(0, input.durationMs);
    } else {
      this.cropRequests++;
      this.cropCostUsd = Number((this.cropCostUsd + cost).toFixed(8));
      this.cropLatencyMs += Math.max(0, input.durationMs);
    }

    return cost;
  }

  private markStopped(reason: string): void {
    this.budgetExhausted = true;
    if (!this.budgetStopReason) {
      this.budgetStopReason = reason;
    }
  }

  getTelemetry(): HybridCostLatencyTelemetry {
    const totalEstimatedCostUsd = Number(
      (
        this.pageCostUsd +
        this.cropCostUsd +
        this.pageContextCostUsd +
        this.p2AuditCostUsd
      ).toFixed(8)
    );
    const totalLatencyMs =
      this.pageLatencyMs +
      this.cropLatencyMs +
      this.pageContextLatencyMs +
      this.p2AuditLatencyMs;
    return {
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      tier: this.tier,
      pageRequests: this.pageRequests,
      cropRequests: this.cropRequests,
      pageContextRequests: this.pageContextRequests,
      p2AuditRequests: this.p2AuditRequests,
      cacheHits: this.cacheHits,
      failedRequests: this.failedRequests,
      outcomeUnknownRequests: this.outcomeUnknownRequests,
      totalEstimatedCostUsd,
      pageCostUsd: this.pageCostUsd,
      cropCostUsd: this.cropCostUsd,
      pageContextCostUsd: this.pageContextCostUsd,
      p2AuditCostUsd: this.p2AuditCostUsd,
      totalLatencyMs,
      pageLatencyMs: this.pageLatencyMs,
      cropLatencyMs: this.cropLatencyMs,
      budgetExhausted: this.budgetExhausted,
      budgetStopReason: this.budgetStopReason
    };
  }
}
