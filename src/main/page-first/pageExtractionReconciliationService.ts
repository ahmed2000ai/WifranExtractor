import type { PageFirstOfferExtraction } from '../../shared/types/pageFirstOfferExtraction';
import type { PageOfferEvidenceLink } from '../../shared/types/pageOfferEvidenceLink';
import type { PageFirstCompletenessResult } from '../../shared/types/pageFirstCompleteness';
import { normalizeTextForMatching } from './evidenceLinkerService';

export type PageReconciliationInput = {
  firstPass: {
    annotation: PageFirstOfferExtraction;
    links: PageOfferEvidenceLink[];
    completeness: PageFirstCompletenessResult;
  };
  retryPass: {
    annotation: PageFirstOfferExtraction;
    links: PageOfferEvidenceLink[];
    completeness: PageFirstCompletenessResult;
  };
};

export type PageReconciliationResult = {
  chosenPass: 'first_pass' | 'retry_pass';
  status: 'resolved' | 'unresolved';
  annotation: PageFirstOfferExtraction;
  links: PageOfferEvidenceLink[];
  completeness: PageFirstCompletenessResult;
  reason: string;
  matchedOfferPairs: Array<{
    firstPassOfferId: string;
    retryPassOfferId: string;
    confidence: number;
  }>;
};

export function reconcileFirstAndRetryPass(
  input: PageReconciliationInput
): PageReconciliationResult {
  const { firstPass, retryPass } = input;

  // Match offers across passes
  const matchedOfferPairs: Array<{
    firstPassOfferId: string;
    retryPassOfferId: string;
    confidence: number;
  }> = [];

  const retryOffers = retryPass.annotation.offers || [];
  const firstOffers = firstPass.annotation.offers || [];

  for (const fOff of firstOffers) {
    const fPrice = fOff.selected_prices?.offer_price;
    const fTitle = normalizeTextForMatching(fOff.product?.title_ar || fOff.product?.title_en);

    for (const rOff of retryOffers) {
      const rPrice = rOff.selected_prices?.offer_price;
      const rTitle = normalizeTextForMatching(rOff.product?.title_ar || rOff.product?.title_en);

      let matchScore = 0;
      if (fPrice !== null && rPrice !== null && fPrice === rPrice) {
        matchScore += 50;
      }
      if (fTitle && rTitle && (fTitle.includes(rTitle) || rTitle.includes(fTitle))) {
        matchScore += 35;
      }
      if (fOff.region_hint === rOff.region_hint) {
        matchScore += 15;
      }

      if (matchScore >= 65) {
        matchedOfferPairs.push({
          firstPassOfferId: fOff.temporary_offer_id,
          retryPassOfferId: rOff.temporary_offer_id,
          confidence: matchScore / 100
        });
        break;
      }
    }
  }

  // Compare completeness scores & blocking issues
  const firstScore = firstPass.completeness.score;
  const retryScore = retryPass.completeness.score;

  const firstBlocking = firstPass.completeness.blocking_issues.length;
  const retryBlocking = retryPass.completeness.blocking_issues.length;

  const firstUncovered = firstPass.completeness.uncovered_current_price_anchor_block_ids.length;
  const retryUncovered = retryPass.completeness.uncovered_current_price_anchor_block_ids.length;

  let chosenPass: 'first_pass' | 'retry_pass' = 'retry_pass';
  let reason = '';

  // Retry pass is preferred if it has fewer blocking issues or better score
  if (retryBlocking < firstBlocking) {
    chosenPass = 'retry_pass';
    reason = `Retry pass resolved blocking issues (${retryBlocking} vs ${firstBlocking})`;
  } else if (firstBlocking < retryBlocking) {
    chosenPass = 'first_pass';
    reason = `First pass had fewer blocking issues (${firstBlocking} vs ${retryBlocking})`;
  } else if (retryUncovered < firstUncovered) {
    chosenPass = 'retry_pass';
    reason = `Retry pass uncovered fewer anchors (${retryUncovered} vs ${firstUncovered})`;
  } else if (firstUncovered < retryUncovered) {
    chosenPass = 'first_pass';
    reason = `First pass uncovered fewer anchors (${firstUncovered} vs ${retryUncovered})`;
  } else if (retryScore >= firstScore) {
    chosenPass = 'retry_pass';
    reason = `Retry pass had equal or better completeness score (${retryScore} vs ${firstScore})`;
  } else {
    chosenPass = 'first_pass';
    reason = `First pass had higher completeness score (${firstScore} vs ${retryScore})`;
  }

  const chosen = chosenPass === 'retry_pass' ? retryPass : firstPass;
  const isResolved = chosen.completeness.blocking_issues.length === 0;

  return {
    chosenPass,
    status: isResolved ? 'resolved' : 'unresolved',
    annotation: chosen.annotation,
    links: chosen.links,
    completeness: {
      ...chosen.completeness,
      status: isResolved
        ? (chosen.completeness.warnings.length > 0 ? 'pass_with_warnings' : 'pass')
        : 'unresolved'
    },
    reason,
    matchedOfferPairs
  };
}

export const PageExtractionReconciliationService = {
  reconcile: (
    pass1: { extraction: PageFirstOfferExtraction; links: PageOfferEvidenceLink[]; completeness: PageFirstCompletenessResult; crops?: any[] },
    retry: { extraction: PageFirstOfferExtraction; links: PageOfferEvidenceLink[]; completeness: PageFirstCompletenessResult; crops?: any[] }
  ) => {
    const res = reconcileFirstAndRetryPass({
      firstPass: {
        annotation: pass1.extraction,
        links: pass1.links,
        completeness: pass1.completeness
      },
      retryPass: {
        annotation: retry.extraction,
        links: retry.links,
        completeness: retry.completeness
      }
    });

    return {
      selected_pass: res.chosenPass === 'retry_pass' ? ('retry' as const) : ('primary' as const),
      status: res.status,
      offers: res.annotation.offers,
      annotation: res.annotation,
      links: res.links,
      completeness: res.completeness,
      reason: res.reason
    };
  }
};

