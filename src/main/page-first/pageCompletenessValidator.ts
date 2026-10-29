import type { PageFirstOfferExtraction } from '../../shared/types/pageFirstOfferExtraction';
import type { NormalizedOcrBlock } from '../../shared/types/normalizedOcrBlock';
import type { PageOfferEvidenceLink } from '../../shared/types/pageOfferEvidenceLink';
import type { PageFirstCompletenessResult, PageFirstCompletenessStatus } from '../../shared/types/pageFirstCompleteness';
import { normalizePriceForMatching, isPriceAnchorCandidate } from './evidenceLinkerService';

export type CompletenessValidationOptions = {
  pageDimensions: { width: number; height: number };
  hasRetriedAlready?: boolean;
};

export function validatePageCompleteness(
  annotation: PageFirstOfferExtraction,
  blocks: NormalizedOcrBlock[],
  evidenceLinks: PageOfferEvidenceLink[],
  options: CompletenessValidationOptions
): PageFirstCompletenessResult {
  const blockingIssues: Array<{ code: string; message: string }> = [];
  const warnings: Array<{ code: string; message: string }> = [];

  const offers = annotation.offers || [];
  const structuredOfferCount = annotation.page_summary?.independent_offer_count ?? offers.length;
  const linkedOfferCount = evidenceLinks.length;

  // 1. Check offer count agreement
  if (structuredOfferCount !== offers.length) {
    warnings.push({
      code: 'OFFER_COUNT_SUMMARY_MISMATCH',
      message: `Declared summary offers (${structuredOfferCount}) does not match offer array length (${offers.length})`
    });
  }

  // 2. Build set of linked current-price anchors
  const anchorToOffersMap = new Map<string, string[]>();
  const offersMissingPriceLink: string[] = [];
  const offersWithMultiplePriceLinks: string[] = [];

  for (const link of evidenceLinks) {
    if (!link.current_price_anchor_block_id) {
      offersMissingPriceLink.push(link.temporary_offer_id);
    } else {
      const existing = anchorToOffersMap.get(link.current_price_anchor_block_id) || [];
      existing.push(link.temporary_offer_id);
      anchorToOffersMap.set(link.current_price_anchor_block_id, existing);
    }

    if (link.current_price_block_ids && link.current_price_block_ids.length > 1) {
      offersWithMultiplePriceLinks.push(link.temporary_offer_id);
    }
  }

  // Duplicate anchor assignments
  const duplicateAnchorAssignments: string[] = [];
  anchorToOffersMap.forEach((offerIds, anchorId) => {
    if (offerIds.length > 1) {
      duplicateAnchorAssignments.push(anchorId);
      blockingIssues.push({
        code: 'DUPLICATE_ANCHOR_ASSIGNMENT',
        message: `Current-price anchor block ${anchorId} is assigned to multiple offers: ${offerIds.join(', ')}`
      });
    }
  });

  if (offersMissingPriceLink.length > 0) {
    blockingIssues.push({
      code: 'OFFERS_MISSING_PRICE_ANCHOR',
      message: `${offersMissingPriceLink.length} offers lack a linked current-price anchor: ${offersMissingPriceLink.join(', ')}`
    });
  }

  // 3. Uncovered high-confidence price-like OCR blocks
  // Find all OCR blocks that look like prices
  const coveredAnchorIds = new Set(anchorToOffersMap.keys());
  const uncoveredCurrentPriceAnchorBlockIds: string[] = [];

  for (const blk of blocks) {
    if (blk.block_type === 'image') continue;
    if (!isPriceAnchorCandidate(blk.text)) continue;
    const priceNorm = normalizePriceForMatching(blk.text);
    if (priceNorm !== null) {
      const num = parseFloat(priceNorm);
      // Legitimate price candidate (not 0, not crazy)
      if (num > 0.5 && num < 10000) {
        if (!coveredAnchorIds.has(blk.block_id)) {
          // If confidence is medium/high or text clearly contains price role/currency
          const isHighConfidence = blk.confidence === null || blk.confidence > 0.75;
          const containsCurrency = /\b(SAR|SR|ريال|رس)\b/i.test(blk.text);
          if (isHighConfidence || containsCurrency) {
            uncoveredCurrentPriceAnchorBlockIds.push(blk.block_id);
          }
        }
      }
    }
  }

  if (uncoveredCurrentPriceAnchorBlockIds.length > 0) {
    warnings.push({
      code: 'UNCOVERED_PRICE_ANCHORS',
      message: `${uncoveredCurrentPriceAnchorBlockIds.length} price-like OCR blocks remain uncovered: ${uncoveredCurrentPriceAnchorBlockIds.join(', ')}`
    });
  }

  // 4. Offer Price vs Size/Content check
  for (const offer of offers) {
    const offerPrice = offer.selected_prices?.offer_price;
    const sizeVal = offer.content?.each_size_value ?? offer.content?.total_content_value;
    const sizeText = offer.content?.size_text;

    if (offerPrice !== null && sizeVal !== null && offerPrice === sizeVal) {
      blockingIssues.push({
        code: 'OFFER_PRICE_MATCHES_SIZE',
        message: `Offer ${offer.temporary_offer_id} price (${offerPrice}) exactly matches size value (${sizeVal})`
      });
    }

    if (offerPrice !== null && sizeText) {
      const numMatch = sizeText.match(/(\d+(?:\.\d+)?)/);
      if (numMatch && parseFloat(numMatch[1]) === offerPrice) {
        blockingIssues.push({
          code: 'OFFER_PRICE_MATCHES_SIZE_TEXT',
          message: `Offer ${offer.temporary_offer_id} price (${offerPrice}) matches number in size_text "${sizeText}"`
        });
      }
    }

    // 5. Old-price as current-price check
    const origPrice = offer.selected_prices?.original_price;
    if (offerPrice !== null && origPrice !== null && offerPrice > origPrice) {
      warnings.push({
        code: 'OFFER_PRICE_GREATER_THAN_ORIGINAL',
        message: `Offer ${offer.temporary_offer_id} current price (${offerPrice}) is greater than original price (${origPrice})`
      });
    }
  }

  // Calculate score (0 to 100)
  let score = 100;
  score -= blockingIssues.length * 25;
  score -= uncoveredCurrentPriceAnchorBlockIds.length * 10;
  score -= warnings.length * 5;
  score = Math.max(0, Math.min(100, score));

  // Determine Status
  let status: PageFirstCompletenessStatus = 'pass';
  const hasRetried = Boolean(options.hasRetriedAlready);

  const retryTriggered =
    uncoveredCurrentPriceAnchorBlockIds.length > 0 ||
    offersMissingPriceLink.length > 0 ||
    duplicateAnchorAssignments.length > 0 ||
    offersWithMultiplePriceLinks.length > 0 ||
    blockingIssues.length > 0;

  if (retryTriggered) {
    if (!hasRetried) {
      status = 'retry_required';
    } else {
      status = 'unresolved';
    }
  } else if (warnings.length > 0) {
    status = 'pass_with_warnings';
  } else {
    status = 'pass';
  }

  return {
    page_number: annotation.page_number,
    status,
    structured_offer_count: structuredOfferCount,
    linked_offer_count: linkedOfferCount,
    current_price_anchor_count: anchorToOffersMap.size,
    uncovered_current_price_anchor_block_ids: uncoveredCurrentPriceAnchorBlockIds,
    duplicate_anchor_assignments: duplicateAnchorAssignments,
    offers_missing_current_price_link: offersMissingPriceLink,
    offers_with_multiple_current_price_links: offersWithMultiplePriceLinks,
    crop_geometry_failures: [],
    blocking_issues: blockingIssues,
    warnings: warnings,
    score
  };
}

export const PageCompletenessValidator = {
  validate: (args: {
    pageNumber: number;
    pageExtraction: PageFirstOfferExtraction;
    links: PageOfferEvidenceLink[];
    blocks: NormalizedOcrBlock[];
    pageDimensions?: { width: number; height: number };
    hasRetriedAlready?: boolean;
  }): PageFirstCompletenessResult => {
    return validatePageCompleteness(
      args.pageExtraction,
      args.blocks,
      args.links,
      {
        pageDimensions: args.pageDimensions || { width: 1000, height: 1400 },
        hasRetriedAlready: args.hasRetriedAlready
      }
    );
  }
};

