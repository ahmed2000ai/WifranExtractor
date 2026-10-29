import type { PageFirstExtractedOffer, PageFirstRegionHint } from '../../shared/types/pageFirstOfferExtraction';
import type { NormalizedOcrBlock } from '../../shared/types/normalizedOcrBlock';
import type { PageOfferEvidenceLink } from '../../shared/types/pageOfferEvidenceLink';

/**
 * Text normalization strictly for matching.
 * Converts Arabic-Indic digits, decimal separators, whitespace, diacritics, currencies.
 * Keeps original text untouched.
 */
export function normalizeTextForMatching(text: string | null | undefined): string {
  if (!text) return '';

  let s = text.trim();

  // Remove Arabic diacritics (tashkeel)
  s = s.replace(/[\u064B-\u065F\u0670]/g, '');

  // Normalize Arabic letters (alif with hamza, ta marbuta, etc.)
  s = s.replace(/[إأآٱ]/g, 'ا');
  s = s.replace(/ة/g, 'ه');
  s = s.replace(/ى/g, 'ي');

  // Convert Arabic-Indic digits to Western digits
  const arabicIndicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  for (let i = 0; i < 10; i++) {
    s = s.replace(new RegExp(arabicIndicDigits[i], 'g'), String(i));
  }

  // Convert Arabic decimal separator (٫) to period (.)
  s = s.replace(/٫/g, '.');

  // Normalize common currency symbols/words
  s = s.replace(/(?:^|\s)(?:SAR|SR|ريال|رس|ر\.س)(?:\s|$)/gi, ' ');
  s = s.replace(/ريال|رس|ر\.س/g, ' ');

  // Normalize multiple spaces and punctuation
  s = s.replace(/[،,]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  return s.toLowerCase();
}

/**
 * Normalizes price string into a comparable numeric representation string.
 * Strict check: does not strip attached units like L, ml, kg!
 */
export function normalizePriceForMatching(priceText: string | null | undefined): string | null {
  if (!priceText) return null;

  // Check if string has size unit attached (e.g. 1.5L, 730ml) -> NOT a pure price!
  if (/\b\d+(\.\d+)?\s*(l|ml|liter|liters|kg|g|gm|pcs|piece|inch)\b/i.test(priceText)) {
    return null;
  }

  const norm = normalizeTextForMatching(priceText);
  // Match number with optional decimals
  const match = norm.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;

  return num.toFixed(2);
}

export function isPriceAnchorCandidate(text: string | null | undefined): boolean {
  if (!text) return false;
  if (/\b\d+(\.\d+)?\s*(l|ml|liter|liters|kg|g|gm|pcs|piece|inch)\b/i.test(text)) {
    return false;
  }
  const norm = normalizeTextForMatching(text);
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length > 2) return false;
  return words.some(w => /^\d+(?:\.\d{1,2})?$/.test(w));
}

/**
 * Checks if a block bounds loosely agree with region_hint
 */
export function doesBlockMatchRegionHint(
  blockBounds: { x: number; y: number; width: number; height: number },
  pageBounds: { width: number; height: number },
  regionHint: PageFirstRegionHint
): boolean {
  if (regionHint === 'unknown') return true;

  const cx = blockBounds.x + blockBounds.width / 2;
  const cy = blockBounds.y + blockBounds.height / 2;

  const isLeft = cx < pageBounds.width * 0.45;
  const isRight = cx > pageBounds.width * 0.55;
  const isMidX = !isLeft && !isRight;

  const isTop = cy < pageBounds.height * 0.38;
  const isBottom = cy > pageBounds.height * 0.65;
  const isMidY = !isTop && !isBottom;

  switch (regionHint) {
    case 'top_left': return isTop && isLeft;
    case 'top': return isTop;
    case 'top_right': return isTop && isRight;
    case 'middle_left': return isMidY && isLeft;
    case 'middle': return isMidY && isMidX;
    case 'middle_right': return isMidY && isRight;
    case 'bottom_left': return isBottom && isLeft;
    case 'bottom': return isBottom;
    case 'bottom_right': return isBottom && isRight;
    default: return true;
  }
}

/**
 * Calculates center distance between two bounding boxes
 */
export function getBoundsCenterDistance(
  b1: { x: number; y: number; width: number; height: number },
  b2: { x: number; y: number; width: number; height: number }
): number {
  const c1x = b1.x + b1.width / 2;
  const c1y = b1.y + b1.height / 2;
  const c2x = b2.x + b2.width / 2;
  const c2y = b2.y + b2.height / 2;
  return Math.hypot(c1x - c2x, c1y - c2y);
}

export type EvidenceLinkOptions = {
  pageDimensions: { width: number; height: number };
};

export function linkOfferEvidenceToBlocks(
  offers: PageFirstExtractedOffer[],
  blocks: NormalizedOcrBlock[],
  options: EvidenceLinkOptions
): PageOfferEvidenceLink[] {
  const results: PageOfferEvidenceLink[] = [];
  const textBlocks = blocks.filter(b => b.block_type !== 'image');

  // Pre-normalize all block texts
  const blockMeta = textBlocks.map(b => ({
    block: b,
    normText: normalizeTextForMatching(b.text),
    priceNorm: normalizePriceForMatching(b.text)
  }));

  // Track assigned anchor blocks to prevent multi-offer collisions
  const assignedAnchorIds = new Set<string>();

  for (const offer of offers) {
    const linkedBlockIds = new Set<string>();
    const titleBlockIds = new Set<string>();
    const descBlockIds = new Set<string>();
    const currentPriceBlockIds = new Set<string>();
    const originalPriceBlockIds = new Set<string>();
    const sizeBlockIds = new Set<string>();
    const promoBlockIds = new Set<string>();

    const unmatchedEvidence: Array<{ field: string; evidence_text: string }> = [];
    const warnings: string[] = [];

    // 1. Current Price Linking (STRICTEST)
    let currentPriceAnchorId: string | null = null;
    const targetPriceVal = offer.selected_prices.offer_price;
    const targetPriceNorm = targetPriceVal !== null ? targetPriceVal.toFixed(2) : null;
    const currentPriceTexts = offer.evidence.current_price_texts || [];

    if (targetPriceNorm !== null) {
      // Find candidate price blocks
      const priceCandidates: Array<{
        block: NormalizedOcrBlock;
        score: number;
      }> = [];

      for (const item of blockMeta) {
        if (!item.block.rendered_page_bounds) continue;
        let score = 0;

        // Exact numeric price match
        if (item.priceNorm === targetPriceNorm) {
          score += 50;
        }

        // Exact or substring match in evidence text
        for (const pt of currentPriceTexts) {
          const normPt = normalizeTextForMatching(pt);
          if (item.normText.includes(normPt) || normPt.includes(item.normText)) {
            score += 30;
          }
        }

        // Region hint bonus
        if (doesBlockMatchRegionHint(item.block.rendered_page_bounds, options.pageDimensions, offer.region_hint)) {
          score += 15;
        }

        // Penalize if already assigned to another offer
        if (assignedAnchorIds.has(item.block.block_id)) {
          score -= 40;
        }

        if (score >= 45) {
          priceCandidates.push({ block: item.block, score });
        }
      }

      priceCandidates.sort((a, b) => b.score - a.score);

      if (priceCandidates.length > 0) {
        const bestAnchor = priceCandidates[0].block;
        currentPriceAnchorId = bestAnchor.block_id;
        currentPriceBlockIds.add(bestAnchor.block_id);
        linkedBlockIds.add(bestAnchor.block_id);
        assignedAnchorIds.add(bestAnchor.block_id);
      } else {
        warnings.push(`No confident OCR block link found for current price ${targetPriceVal}`);
        unmatchedEvidence.push({
          field: 'current_price',
          evidence_text: offer.selected_prices.offer_price_raw_text || String(targetPriceVal)
        });
      }
    } else {
      warnings.push('Offer has no selected current offer price');
    }

    const anchorBlock = blocks.find(b => b.block_id === currentPriceAnchorId);
    const anchorCenter = anchorBlock?.rendered_page_bounds;

    // Helper for proximity-weighted evidence matching
    const matchEvidenceList = (
      evidenceTexts: string[],
      field: string,
      targetSet: Set<string>,
      maxDist = 600
    ) => {
      for (const ev of evidenceTexts) {
        if (!ev || ev.trim() === '') continue;
        const normEv = normalizeTextForMatching(ev);
        let found = false;

        const candidates: Array<{ block: NormalizedOcrBlock; dist: number }> = [];

        for (const item of blockMeta) {
          if (item.normText.length === 0) continue;
          if (item.normText.includes(normEv) || normEv.includes(item.normText)) {
            const dist = anchorCenter
              ? getBoundsCenterDistance(item.block.rendered_page_bounds, anchorCenter)
              : 0;
            if (!anchorCenter || dist <= maxDist) {
              candidates.push({ block: item.block, dist });
            }
          }
        }

        candidates.sort((a, b) => a.dist - b.dist);

        if (candidates.length > 0) {
          found = true;
          for (const cand of candidates.slice(0, 3)) {
            targetSet.add(cand.block.block_id);
            linkedBlockIds.add(cand.block.block_id);
          }
        }

        if (!found) {
          unmatchedEvidence.push({ field, evidence_text: ev });
        }
      }
    };

    // 2. Original Price Linking
    const origPriceVal = offer.selected_prices?.original_price;
    const origPriceNorm = origPriceVal != null ? origPriceVal.toFixed(2) : null;
    const origPriceTexts = offer.evidence?.original_price_texts || [];

    if (origPriceNorm !== null) {
      for (const item of blockMeta) {
        if (item.block.block_id === currentPriceAnchorId) continue;
        if (item.priceNorm === origPriceNorm) {
          const dist = anchorCenter ? getBoundsCenterDistance(item.block.rendered_page_bounds, anchorCenter) : 0;
          if (!anchorCenter || dist <= 500) {
            originalPriceBlockIds.add(item.block.block_id);
            linkedBlockIds.add(item.block.block_id);
          }
        }
      }
    }
    matchEvidenceList(origPriceTexts, 'original_price', originalPriceBlockIds, 500);

    // 3. Title & Description Linking
    matchEvidenceList(offer.evidence.title_texts || [], 'title', titleBlockIds, 700);
    matchEvidenceList(offer.evidence.description_texts || [], 'description', descBlockIds, 700);

    // 4. Size & Content Linking
    matchEvidenceList(offer.evidence.size_content_texts || [], 'size_content', sizeBlockIds, 600);

    // 5. Promotion Linking
    matchEvidenceList(offer.evidence.promotion_texts || [], 'promotion', promoBlockIds, 600);

    // Compute evidence link confidence score (0 to 1)
    let confidence = 0.5;
    if (currentPriceAnchorId) confidence += 0.3;
    if (titleBlockIds.size > 0) confidence += 0.2;
    if (unmatchedEvidence.length > 0) {
      confidence = Math.max(0.1, confidence - (unmatchedEvidence.length * 0.05));
    }

    results.push({
      temporary_offer_id: offer.temporary_offer_id,
      linked_block_ids: Array.from(linkedBlockIds),
      title_block_ids: Array.from(titleBlockIds),
      description_block_ids: Array.from(descBlockIds),
      current_price_block_ids: Array.from(currentPriceBlockIds),
      original_price_block_ids: Array.from(originalPriceBlockIds),
      size_content_block_ids: Array.from(sizeBlockIds),
      promotion_block_ids: Array.from(promoBlockIds),
      current_price_anchor_block_id: currentPriceAnchorId,
      confidence: Math.round(confidence * 100) / 100,
      unmatched_evidence: unmatchedEvidence,
      warnings
    });
  }

  return results;
}

export { normalizeTextForMatching as normalizeForComparison };

export function extractPriceNumbers(text: string): number[] {
  const norm = normalizeTextForMatching(text);
  const matches = norm.match(/\d+(?:\.\d+)?/g);
  if (!matches) return [];
  return matches.map(m => parseFloat(m)).filter(n => !isNaN(n));
}

export const EvidenceLinkerService = {
  linkEvidence: (
    offer: PageFirstExtractedOffer,
    blocks: NormalizedOcrBlock[],
    options?: EvidenceLinkOptions
  ): PageOfferEvidenceLink => {
    return linkOfferEvidenceToBlocks([offer], blocks, options || { pageDimensions: { width: 1000, height: 1400 } })[0];
  },
  linkOffers: linkOfferEvidenceToBlocks
};
