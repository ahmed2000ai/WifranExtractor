/**
 * Accuracy evaluation and comparison logic for Wifran Offers Extractor benchmarks.
 * Uses spatial bipartite matching on product_graphic_box IoU (falling back to text similarity)
 * to robustly match corresponding offers across extractions before computing field equivalence.
 */

export interface BoundingBoxIoUs {
  productGraphic: number;
  promoPrice: number;
  title: number;
  originalPrice: number | null;
  unitBadge: number | null;
}

export interface OfferComparisonResult {
  offerIndex: number;
  matchedLegacyIndex: number;
  matchedGtIndex: number | null;
  arabicTitleMatch: boolean;
  englishTitleMatch: boolean;
  promoPriceMatch: boolean;
  originalPriceMatch: boolean;
  sizeValueMatch: boolean;
  packQuantityMatch: boolean;
  legacyOffer: any;
  optOffer: any;
  gtOffer?: any;
  ious: BoundingBoxIoUs;
  notes: string[];
}

export interface PageAccuracyReport {
  pageId: string;
  retailer: string;
  expectedOfferCount: number;
  legacyOfferCount: number;
  optOfferCount: number;
  offerCountMatch: boolean;
  comparisons: OfferComparisonResult[];
  meanGraphicIoU: number;
  meanPromoPriceIoU: number;
  meanTitleIoU: number;
  meanOriginalPriceIoU: number | null;
  meanUnitBadgeIoU: number | null;
  hasRegressions: boolean;
  regressionDetails: string[];
}

export function computeIoU(b1?: number[] | null, b2?: number[] | null): number {
  if (!b1 || !b2 || b1.length !== 4 || b2.length !== 4) return 0;
  const [y1min, x1min, y1max, x1max] = b1;
  const [y2min, x2min, y2max, x2max] = b2;
  const yInterMin = Math.max(y1min, y2min);
  const xInterMin = Math.max(x1min, x2min);
  const yInterMax = Math.min(y1max, y2max);
  const xInterMax = Math.min(x1max, x2max);
  if (yInterMax <= yInterMin || xInterMax <= xInterMin) return 0;
  const interArea = (yInterMax - yInterMin) * (xInterMax - xInterMin);
  const area1 = (y1max - y1min) * (x1max - x1min);
  const area2 = (y2max - y2min) * (x2max - x2min);
  const unionArea = area1 + area2 - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Normalizes text for comparison (strips extra spaces, diacritics, lowercase).
 */
export function normalizeText(s?: string | null): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic diacritics
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finds best bipartite matching between two sets of offers based on spatial overlap
 * and title similarity.
 */
export function matchOffersBipartite(
  sourceOffers: any[],
  targetOffers: any[]
): Array<{ sourceIdx: number; targetIdx: number; score: number }> {
  const matches: Array<{ sourceIdx: number; targetIdx: number; score: number }> = [];
  const usedTargetIndices = new Set<number>();

  for (let sIdx = 0; sIdx < sourceOffers.length; sIdx++) {
    const s = sourceOffers[sIdx];
    let bestTIdx = -1;
    let bestScore = -1;

    for (let tIdx = 0; tIdx < targetOffers.length; tIdx++) {
      if (usedTargetIndices.has(tIdx)) continue;
      const t = targetOffers[tIdx];

      // 1. Spatial IoU on product graphic box
      const gIoU = computeIoU(s.components?.product_graphic_box, t.components?.product_graphic_box);

      // 2. Text similarity bonus
      const sAr = normalizeText(s.arabic_title);
      const tAr = normalizeText(t.arabic_title);
      const textMatch = sAr && tAr && (sAr === tAr || sAr.includes(tAr) || tAr.includes(sAr)) ? 0.3 : 0;

      // 3. Price match bonus
      const priceMatch = s.promo_price === t.promo_price ? 0.2 : 0;

      const score = gIoU * 0.7 + textMatch + priceMatch;
      if (score > bestScore) {
        bestScore = score;
        bestTIdx = tIdx;
      }
    }

    if (bestTIdx !== -1) {
      usedTargetIndices.add(bestTIdx);
      matches.push({ sourceIdx: sIdx, targetIdx: bestTIdx, score: bestScore });
    }
  }

  return matches;
}

/**
 * Evaluates accuracy and equivalence between Legacy, Optimized, and optional Ground Truth.
 */
export function evaluatePageAccuracy(
  pageId: string,
  retailer: string,
  legacyOffers: any[],
  optOffers: any[],
  gtOffers?: any[]
): PageAccuracyReport {
  const regressionDetails: string[] = [];
  const comparisons: OfferComparisonResult[] = [];

  const legacyCount = legacyOffers.length;
  const optCount = optOffers.length;
  const expectedCount = gtOffers ? gtOffers.length : legacyCount;

  if (optCount !== legacyCount) {
    regressionDetails.push(
      `Offer count mismatch: Legacy extracted ${legacyCount} offers, Optimized extracted ${optCount} offers.`
    );
  }

  // Match Optimized offers to Legacy offers spatially
  const optToLegacyMatches = matchOffersBipartite(optOffers, legacyOffers);

  let sumGIoU = 0;
  let sumPIoU = 0;
  let sumTIoU = 0;
  let sumOPIoU = 0;
  let countOPIoU = 0;
  let sumUBIoU = 0;
  let countUBIoU = 0;

  for (const match of optToLegacyMatches) {
    const opt = optOffers[match.sourceIdx];
    const leg = legacyOffers[match.targetIdx];
    const gt = gtOffers ? gtOffers[match.sourceIdx] : undefined;

    const notes: string[] = [];

    // Titles
    const arNormLeg = normalizeText(leg.arabic_title);
    const arNormOpt = normalizeText(opt.arabic_title);
    const arMatch = arNormLeg === arNormOpt || arNormLeg.includes(arNormOpt) || arNormOpt.includes(arNormLeg);
    if (!arMatch) {
      notes.push(`Arabic title divergence: "${leg.arabic_title}" vs "${opt.arabic_title}"`);
    }

    const enNormLeg = normalizeText(leg.english_title);
    const enNormOpt = normalizeText(opt.english_title);
    const enMatch = enNormLeg === enNormOpt || enNormLeg.includes(enNormOpt) || enNormOpt.includes(enNormLeg);
    if (!enMatch) {
      notes.push(`English title divergence: "${leg.english_title}" vs "${opt.english_title}"`);
    }

    // Prices
    const promoMatch = leg.promo_price === opt.promo_price;
    if (!promoMatch) {
      regressionDetails.push(
        `Offer (Opt ${match.sourceIdx + 1} -> Leg ${match.targetIdx + 1}) Promo Price mismatch: Legacy=${leg.promo_price}, Opt=${opt.promo_price}`
      );
    }

    const origMatch =
      leg.original_price === opt.original_price ||
      (leg.original_price == null && opt.original_price == null);
    if (!origMatch) {
      regressionDetails.push(
        `Offer (Opt ${match.sourceIdx + 1} -> Leg ${match.targetIdx + 1}) Original Price mismatch: Legacy=${leg.original_price}, Opt=${opt.original_price}`
      );
    }

    // Size and Pack
    const sizeMatch = normalizeText(leg.size_value) === normalizeText(opt.size_value);
    const packMatch = leg.pack_quantity === opt.pack_quantity || (!leg.pack_quantity && opt.pack_quantity === 1);

    // IoU calculations
    const gIoU = computeIoU(leg.components?.product_graphic_box, opt.components?.product_graphic_box);
    const pIoU = computeIoU(leg.components?.promo_price_box, opt.components?.promo_price_box);
    const tIoU = computeIoU(leg.components?.title_text_box, opt.components?.title_text_box);

    sumGIoU += gIoU;
    sumPIoU += pIoU;
    sumTIoU += tIoU;

    let opIoU: number | null = null;
    if (leg.components?.original_price_box && opt.components?.original_price_box) {
      opIoU = computeIoU(leg.components.original_price_box, opt.components.original_price_box);
      sumOPIoU += opIoU;
      countOPIoU++;
    }

    let ubIoU: number | null = null;
    if (leg.components?.unit_and_size_badge_box && opt.components?.unit_and_size_badge_box) {
      ubIoU = computeIoU(leg.components.unit_and_size_badge_box, opt.components.unit_and_size_badge_box);
      sumUBIoU += ubIoU;
      countUBIoU++;
    }

    // Graphic box regression threshold: graphic IoU < 0.5 is severe misalignment
    if (gIoU < 0.5) {
      regressionDetails.push(
        `Offer (Opt ${match.sourceIdx + 1} -> Leg ${match.targetIdx + 1}) Product Graphic Box severe misalignment: IoU ${(gIoU * 100).toFixed(1)}%`
      );
    }

    comparisons.push({
      offerIndex: match.sourceIdx + 1,
      matchedLegacyIndex: match.targetIdx + 1,
      matchedGtIndex: gt ? match.sourceIdx + 1 : null,
      arabicTitleMatch: arMatch,
      englishTitleMatch: enMatch,
      promoPriceMatch: promoMatch,
      originalPriceMatch: origMatch,
      sizeValueMatch: sizeMatch,
      packQuantityMatch: packMatch,
      legacyOffer: leg,
      optOffer: opt,
      gtOffer: gt,
      ious: {
        productGraphic: gIoU,
        promoPrice: pIoU,
        title: tIoU,
        originalPrice: opIoU,
        unitBadge: ubIoU
      },
      notes
    });
  }

  const denom = optToLegacyMatches.length || 1;
  const meanGIoU = sumGIoU / denom;
  const meanPIoU = sumPIoU / denom;
  const meanTIoU = sumTIoU / denom;
  const meanOPIoU = countOPIoU > 0 ? sumOPIoU / countOPIoU : null;
  const meanUBIoU = countUBIoU > 0 ? sumUBIoU / countUBIoU : null;

  return {
    pageId,
    retailer,
    expectedOfferCount: expectedCount,
    legacyOfferCount: legacyCount,
    optOfferCount: optCount,
    offerCountMatch: legacyCount === optCount,
    comparisons,
    meanGraphicIoU: meanGIoU,
    meanPromoPriceIoU: meanPIoU,
    meanTitleIoU: meanTIoU,
    meanOriginalPriceIoU: meanOPIoU,
    meanUnitBadgeIoU: meanUBIoU,
    hasRegressions: regressionDetails.length > 0,
    regressionDetails
  };
}


