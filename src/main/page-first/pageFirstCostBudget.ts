export const ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE = 0.005;
export const LEAFLET_ANNOTATED_OCR_BUDGET_USD = 0.95;
export const MAX_SEMANTIC_RETRY_PASSES_PER_PAGE = 1;

export type PageFirstCostTracker = {
  primaryPageCalls: number;
  retryPageCalls: number;
  mistralPagesProcessed: number;
  estimatedPricePerPage: number;
  budgetUsd: number;
};

export function createCostTracker(budgetUsd = LEAFLET_ANNOTATED_OCR_BUDGET_USD): PageFirstCostTracker {
  return {
    primaryPageCalls: 0,
    retryPageCalls: 0,
    mistralPagesProcessed: 0,
    estimatedPricePerPage: ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE,
    budgetUsd
  };
}

export function calculateEstimatedCostUsd(tracker: PageFirstCostTracker): number {
  const totalCalls = tracker.primaryPageCalls + tracker.retryPageCalls;
  return Number((totalCalls * tracker.estimatedPricePerPage).toFixed(4));
}

export function checkPrimaryPassBudget(
  pageCount: number,
  pricePerPage = ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE,
  budgetUsd = LEAFLET_ANNOTATED_OCR_BUDGET_USD
): { allowed: boolean; projectedCostUsd: number; budgetUsd: number; reason?: string } {
  const projectedCostUsd = Number((pageCount * pricePerPage).toFixed(4));
  if (projectedCostUsd > budgetUsd) {
    return {
      allowed: false,
      projectedCostUsd,
      budgetUsd,
      reason: `Projected primary pass cost ($${projectedCostUsd.toFixed(2)}) exceeds leaflet budget ($${budgetUsd.toFixed(2)})`
    };
  }
  return { allowed: true, projectedCostUsd, budgetUsd };
}

export function canRunSemanticRetry(
  tracker: PageFirstCostTracker
): { allowed: boolean; nextProjectedCostUsd: number; reason?: string } {
  const nextCalls = tracker.primaryPageCalls + tracker.retryPageCalls + 1;
  const nextProjectedCostUsd = Number((nextCalls * tracker.estimatedPricePerPage).toFixed(4));

  if (nextProjectedCostUsd > tracker.budgetUsd) {
    return {
      allowed: false,
      nextProjectedCostUsd,
      reason: `Semantic retry would exceed budget ($${nextProjectedCostUsd.toFixed(2)} > $${tracker.budgetUsd.toFixed(2)})`
    };
  }

  return { allowed: true, nextProjectedCostUsd };
}

export function estimateAnnotatedOcrCost(
  primaryPages: number,
  retryPages: number = 0,
  pricePerPage = ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE
): number {
  return Number(((primaryPages + retryPages) * pricePerPage).toFixed(4));
}

export function canAffordPrimaryPage(
  currentPrimaryPages: number,
  budget = LEAFLET_ANNOTATED_OCR_BUDGET_USD
): boolean {
  return ((currentPrimaryPages + 1) * ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE) <= budget;
}

export function canAffordRetryPass(
  primaryPages: number,
  currentRetries: number,
  budget = LEAFLET_ANNOTATED_OCR_BUDGET_USD
): boolean {
  return ((primaryPages + currentRetries + 1) * ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE) <= budget;
}

