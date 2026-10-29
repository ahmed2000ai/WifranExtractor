import { CanonicalOffer } from '../types/canonicalOffer';
import { PublishDecisionResult, PublishDecisionReason, FinalPublishDecision } from '../types/publishDecision';
import { ComparisonSafetyResult } from '../types/comparisonSafety';
import { selectDisplayUnitPriceBasis } from './displayUnitPriceBasis';

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

export function decidePublishAction(input: {
  canonicalOffer: CanonicalOffer;
  comparisonResult?: ComparisonSafetyResult | null;
}): PublishDecisionResult {
  const c = input.canonicalOffer;
  const comp = input.comparisonResult;

  const reasons: PublishDecisionReason[] = [];

  // Check blocking conditions
  if (c.quality.blocking_errors && c.quality.blocking_errors.length > 0) {
    for (const err of c.quality.blocking_errors) {
      reasons.push({ code: err.code, severity: 'blocking', message: err.message });
    }
  }

  const offerPrice = c.prices.offer_price;
  if (offerPrice === null || isNaN(offerPrice) || offerPrice <= 0) {
    reasons.push({ code: 'missing_offer_price', severity: 'blocking', message: 'Offer price is missing or invalid' });
  }

  if (isBlank(c.product.title_ar) && isBlank(c.product.title_en)) {
    reasons.push({ code: 'missing_product_title', severity: 'blocking', message: 'Product title is missing' });
  }

  // Determine decision
  const hasBlocking = reasons.some(r => r.severity === 'blocking');
  let decision: FinalPublishDecision = 'publish';
  let comparisonEligible = false;
  let comparisonExclusionReason: string | null = null;

  if (comp) {
    comparisonEligible = comp.comparison_eligible;
    comparisonExclusionReason = comp.comparison_exclusion_reason;
    if (!comparisonEligible && comparisonExclusionReason) {
      reasons.push({ code: comparisonExclusionReason, severity: 'comparison_exclusion', message: comparisonExclusionReason });
    }
  } else if (!c.comparison.comparison_eligible && c.comparison.comparison_exclusion_reason) {
    comparisonExclusionReason = c.comparison.comparison_exclusion_reason;
    reasons.push({ code: comparisonExclusionReason, severity: 'comparison_exclusion', message: comparisonExclusionReason });
  }

  if (hasBlocking) {
    decision = 'skip_or_quarantine';
  } else if (!comparisonEligible) {
    decision = 'publish_but_exclude_from_comparison';
  } else {
    decision = 'publish';
  }

  const result: PublishDecisionResult = {
    decision,
    display_safe: decision === 'publish' || decision === 'publish_but_exclude_from_comparison',
    comparison_safe: decision === 'publish',
    should_upload_image: decision === 'publish' || decision === 'publish_but_exclude_from_comparison',
    should_upsert_db: decision === 'publish' || decision === 'publish_but_exclude_from_comparison',
    status_for_db: decision === 'skip_or_quarantine' ? 'skipped' : 'published',
    comparison_eligible: comparisonEligible,
    comparison_exclusion_reason: comparisonExclusionReason,
    reasons,
  };

  return result;
}

export function applyPublishDecisionToCanonicalOffer(
  canonicalOffer: CanonicalOffer,
  decisionResult: PublishDecisionResult
): CanonicalOffer {
  const out = canonicalOffer;
  
  // Ensure objects exist
  if (!out.quality) out.quality = {} as any;
  if (!out.pre_publish) out.pre_publish = {} as any;

  out.quality.publish_decision = decisionResult.decision;
  
  if (decisionResult.decision === 'publish' || decisionResult.decision === 'publish_but_exclude_from_comparison') {
    out.pre_publish.preview_eligible = true;
    out.pre_publish.display_in_preview = true;
    out.pre_publish.preview_group = decisionResult.decision;
  } else {
    out.pre_publish.preview_eligible = false;
    out.pre_publish.display_in_preview = true;
    out.pre_publish.preview_group = decisionResult.decision;
  }

  // Evaluate display unit basis
  out.display = selectDisplayUnitPriceBasis({
    offerPrice: out.prices.offer_price,
    totalContentValue: out.content.total_content_value,
    totalContentUnit: out.content.total_content_unit,
    comparisonEligible: decisionResult.comparison_eligible,
    itemDomain: out.product.item_domain,
    categorySlug: out.product.category_hint,
    minDisplayUnitPriceSar: 0.50
  });

  return out;
}
