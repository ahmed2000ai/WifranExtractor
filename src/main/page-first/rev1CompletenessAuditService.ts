import type {
  LeafletPageExtractionRev1,
  Stage5AuditResult,
  Stage5AuditIssue,
  NormalizedBox2D
} from '../../shared/types/leafletExtraction';
import {
  computeOfferUnionAndThumbBoxes,
  computeBoxIoU,
  areCompoundSiblings
} from './spatialUnionAndClampingService';

/**
 * Stage 5 Spatial & Price Completeness Audit for rev1.
 * Audits:
 * 1. Price Inversions (promo_price must be < original_price if original_price is present).
 * 2. Box sanity (width >= 40, height >= 40 on 1000x1000 scale, and IoU < 0.15 between any two distinct offers).
 * 3. Offer completeness (non-empty title, promo_price > 0, size_value or unit_type populated).
 * 4. Generates suspect regions for Stage 6 retry if issues are found.
 */
export function runStage5CompletenessAudit(
  pageExtraction: LeafletPageExtractionRev1,
  nativeWidth: number = 1000,
  nativeHeight: number = 1000
): Stage5AuditResult {
  const issues: Stage5AuditIssue[] = [];
  const suspectRegions: NormalizedBox2D[] = [];
  const offers = pageExtraction.offers;

  if (offers.length === 0) {
    issues.push({
      code: 'MISSED_PRICE_ANCHOR',
      message: 'Zero offers extracted on page.',
      severity: 'error'
    });
    return {
      passed: false,
      page_confidence: 0,
      issues,
      total_offers: 0,
      unresolved_retries: 0,
      suspect_regions: [[0, 0, 1000, 1000]]
    };
  }

  // Precompute boxes for IoU checks
  const cropRects = computeOfferUnionAndThumbBoxes(offers, nativeWidth, nativeHeight);

  // 1. Audit each individual offer
  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    const rect = cropRects[i];

    // Check title completeness
    if (!offer.arabic_title.trim() && !offer.english_title.trim()) {
      issues.push({
        code: 'EMPTY_TITLE',
        offer_number: offer.offer_number,
        message: `Offer #${offer.offer_number} has empty bilingual titles.`,
        severity: 'error',
        suspect_box_2d: offer.components.promo_price_box
      });
      suspectRegions.push(offer.components.promo_price_box);
    }

    // Check price validity
    if (offer.promo_price <= 0 || isNaN(offer.promo_price)) {
      issues.push({
        code: 'INVALID_PRICE',
        offer_number: offer.offer_number,
        message: `Offer #${offer.offer_number} has invalid promo_price (${offer.promo_price}).`,
        severity: 'error',
        suspect_box_2d: offer.components.promo_price_box
      });
      suspectRegions.push(offer.components.promo_price_box);
    }

    // Check Price Inversion
    if (offer.original_price !== null) {
      if (offer.promo_price >= offer.original_price) {
        issues.push({
          code: 'PRICE_INVERSION',
          offer_number: offer.offer_number,
          message: `Offer #${offer.offer_number} price inversion: promo_price (${offer.promo_price}) >= original_price (${offer.original_price}).`,
          severity: 'error',
          suspect_box_2d: offer.components.promo_price_box
        });
        suspectRegions.push(offer.components.promo_price_box);
      }
    }

    // Check Bounding Box sanity (scaled to 1000x1000 normalized grid)
    const normW = Math.round((rect.union_box_px.width / nativeWidth) * 1000);
    const normH = Math.round((rect.union_box_px.height / nativeHeight) * 1000);
    if (normW < 40 || normH < 40) {
      issues.push({
        code: 'BBOX_SANITY_FAILED',
        offer_number: offer.offer_number,
        message: `Offer #${offer.offer_number} bounding box sanity failed: width=${normW}, height=${normH} (min 40).`,
        severity: 'error',
        suspect_box_2d: offer.components.promo_price_box
      });
      suspectRegions.push(offer.components.promo_price_box);
    }

    // Size / unit badge check (warning if missing on grocery)
    if (!offer.size_value && !offer.unit_type) {
      issues.push({
        code: 'MISSING_SIZE_OR_UNIT',
        offer_number: offer.offer_number,
        message: `Offer #${offer.offer_number} has neither size_value nor unit_type populated.`,
        severity: 'warning'
      });
    }
  }

  // 2. Check pairwise bounding box collisions (IoU < 0.15)
  for (let i = 0; i < cropRects.length; i++) {
    for (let j = i + 1; j < cropRects.length; j++) {
      // Skip compound siblings (they intentionally share the full compound cell)
      if (areCompoundSiblings(offers[i], offers[j])) {
        continue;
      }

      const iou = computeBoxIoU(cropRects[i].union_box_px, cropRects[j].union_box_px);
      if (iou >= 0.15) {
        const offA = offers[i].offer_number;
        const offB = offers[j].offer_number;
        issues.push({
          code: 'IOU_COLLISION',
          offer_number: offA,
          message: `Offers #${offA} and #${offB} have severe bounding box collision (IoU = ${iou.toFixed(3)} >= 0.15).`,
          severity: 'error',
          suspect_box_2d: offers[i].components.promo_price_box
        });
        suspectRegions.push(offers[i].components.promo_price_box);
      }
    }
  }

  const hasErrors = issues.some(iss => iss.severity === 'error');
  const avgOfferConf = offers.reduce((sum, o) => sum + (o.confidence || 0), 0) / offers.length;
  const pageConfidence = hasErrors ? Math.min(avgOfferConf, 0.7) : avgOfferConf;

  return {
    passed: !hasErrors,
    page_confidence: pageConfidence,
    issues,
    total_offers: offers.length,
    unresolved_retries: 0,
    suspect_regions: suspectRegions
  };
}
