/**
 * Shared Leaflet Metadata types for both main and renderer processes.
 */

export interface PageExceptionResolution {
  pageNumber: number;
  resolution: 'applied' | 'exempt' | 'quarantined';
  startDate?: string | null;
  endDate?: string | null;
  reason?: string;
  scope?: 'page_wide' | 'specific_offers' | 'category';
  affectedOfferIds?: string[];
  categoryHint?: string;
  operatorConfirmedMatches?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface VisionBudgetStatus {
  attemptsUsed: number;
  authorizedAllowance: number;
  remainingAttempts: number;
  budgetExhausted: boolean;
  canExtend: boolean;
  hardCeiling: number;
}


