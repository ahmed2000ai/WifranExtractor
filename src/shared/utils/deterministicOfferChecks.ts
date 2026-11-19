import type { CanonicalOffer } from '../types/canonicalOffer';
import type { DeterministicOfferCheckResult } from '../types/deterministicOfferChecks';

const SIZE_TRAP_REGEX = /^(1\.5\s*L|1\.51\s*L|730\s*ml|10\s*kg|8\s*[x×]\s*135\s*g|30\s*pcs|50\s*inch|55\s*inch|65\s*inch|50"|55"|65"|4k|hd|led|uhd|fhd)$/i;
const UNIT_TRAP_REGEX = /(l|liter|litre|ml|kg|g|gram|pcs|piece|pieces|inch|")/i;

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

function normalizeNumber(val: number | null | undefined): number | null {
  if (val == null || isNaN(val)) return null;
  return Number(val.toFixed(2));
}

export function runDeterministicOfferChecks(input: {
  canonicalOffer: CanonicalOffer;
  now?: Date;
}): DeterministicOfferCheckResult {
  const result: DeterministicOfferCheckResult = {
    blocking_errors: [],
    non_blocking_warnings: [],
    comparison_exclusions: [],
    has_blocking_errors: false,
    has_warnings: false,
    has_comparison_exclusions: false,
  };

  const c = input.canonicalOffer;
  const now = input.now || new Date();

  // Helper
  const addBlock = (code: string, message: string) => {
    result.blocking_errors.push({ code, severity: 'blocking', message });
    result.has_blocking_errors = true;
  };
  const addWarn = (code: string, message: string) => {
    result.non_blocking_warnings.push({ code, severity: 'warning', message });
    result.has_warnings = true;
  };
  const addExclusion = (code: string, message: string) => {
    result.comparison_exclusions.push({ code, severity: 'comparison_exclusion', message });
    result.has_comparison_exclusions = true;
  };

  // --- 1. Missing or Ambiguous Offer Price ---
  const offerPrice = c.prices.offer_price;
  if (offerPrice === null || offerPrice === undefined || isNaN(offerPrice) || offerPrice <= 0) {
    addBlock('missing_offer_price', 'Offer price is missing, zero, or negative');
  }

  const rawOfferStr = c.raw.raw_attributes['offer_price_raw_string'] as string | undefined;

  // Ambiguous Offer Price
  if (c.style_validation?.validation_result === 'fail') {
    // Basic ambiguity propagation from model output
    const errs = c.quality.blocking_errors.map(e => e.message.toLowerCase());
    if (errs.some(e => e.includes('ambiguous'))) {
      addBlock('ambiguous_offer_price', 'Style validation or model reported ambiguous offer price');
    }
  }

  // --- 2. Price/Size Trap Detection ---
  if (rawOfferStr && SIZE_TRAP_REGEX.test(rawOfferStr.trim())) {
    addBlock('size_misclassified_as_price', `Offer price raw text matches size pattern: ${rawOfferStr}`);
  }

  // Check candidates for size traps
  const allPriceCands = c.prices.all_price_candidates || [];
  const selectedCand = allPriceCands.find(pc => normalizeNumber(pc.normalized_value) === normalizeNumber(offerPrice));

  if (selectedCand && selectedCand.raw_text) {
    if (UNIT_TRAP_REGEX.test(selectedCand.raw_text)) {
      addBlock('size_misclassified_as_price', `Selected offer price candidate contains unit: ${selectedCand.raw_text}`);
    }
  }

  // Also check if offer price matches size value exactly
  const sizeText = c.content.size_text;
  if (sizeText && offerPrice !== null) {
    const sizeValMatch = sizeText.match(/([\d\.]+)/);
    if (sizeValMatch) {
      const sizeNum = parseFloat(sizeValMatch[1]);
      if (normalizeNumber(sizeNum) === normalizeNumber(offerPrice)) {
        addBlock('offer_price_matches_size_value', `Offer price ${offerPrice} matches numerical size value ${sizeNum} from ${sizeText}`);
      }
    }
  }

  // --- 3. Old Price / Current Price Confusion ---
  if (selectedCand) {
    if (selectedCand.classified_as === 'original_price' || selectedCand.visual_role.includes('old_price')) {
      addBlock('original_price_misclassified_as_offer_price', 'Selected offer price comes from a candidate classified as original_price or old_price');
    }
  }

  // If there are price candidates, and offer price is not among them
  if (allPriceCands.length > 0 && offerPrice !== null && !selectedCand) {
    // Only warn since legacy JSON might not have populated candidates correctly
    addWarn('offer_price_not_in_price_candidates', `Offer price ${offerPrice} is not found in the price candidates array`);
  }

  // --- 4. Product Title Check ---
  if (isBlank(c.product.title_ar) && isBlank(c.product.title_en)) {
    addBlock('missing_product_title', 'Product title is missing in both Arabic and English');
  }

  // --- 5. Trusted Context Checks ---
  // Only evaluate location scopes if a context is somewhat populated
  if (c.trusted_context.location_scope) {
    const scope = c.trusted_context.location_scope;
    if (scope === 'national' && (c.trusted_context.city_id || c.trusted_context.region_id)) {
      addBlock('invalid_location_scope', 'National scope should not have city or region');
    }
    if (scope === 'region' && !c.trusted_context.region_id) {
      addBlock('missing_region_for_region_scope', 'Region ID is missing for region scope');
    }
    if (scope === 'city' && !c.trusted_context.city_id) {
      addBlock('missing_city_for_city_scope', 'City ID is missing for city scope');
    }
  }

  if (c.trusted_context.offer_end_date) {
    const rawEnd = c.trusted_context.offer_end_date.trim();
    const end = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd)
      ? new Date(`${rawEnd}T23:59:59.999Z`)
      : new Date(rawEnd);
    if (isNaN(end.getTime())) {
      addBlock('invalid_offer_end_date', 'Offer end date is unparsable');
    } else if (end < now) {
      addBlock('expired_offer_end_date', `Offer end date ${c.trusted_context.offer_end_date} is in the past`);
    }
  }

  // --- 6. Image Path Safety Checks ---
  const imagePath = c.image.image_path;
  if (imagePath) {
    if (imagePath.includes('..') || imagePath.startsWith('/') || imagePath.includes('\\') || imagePath.includes('\\0')) {
      addBlock('unsafe_image_path', 'Image path contains unsafe traversal characters');
    }
  }

  // --- 7. Warning Checks ---
  if (!c.prices.original_price) {
    addWarn('missing_original_price', 'Original price is missing');
  }
  if (isBlank(c.product.brand_text)) {
    addWarn('missing_brand', 'Brand text is missing');
  }
  if (c.product.item_domain === 'unknown' || c.quality.extraction_confidence === 'low') {
    addWarn('low_confidence_category', 'Category or item domain has low confidence');
  }
  if (c.promotion.mechanic === 'unknown' && !isBlank(c.promotion.special_offer)) {
    addWarn('unclear_promotion_mechanic', 'Promotion mechanic is unknown despite having promotional text');
  }

  // --- 8. Comparison Exclusion Checks ---
  if (['electronics', 'appliance', 'other_non_grocery'].includes(c.product.item_domain)) {
    addExclusion('non_grocery_item', `Comparison not supported for domain: ${c.product.item_domain}`);
  }
  if (isBlank(c.content.size_text)) {
    addExclusion('unclear_total_content', 'Missing size text needed for comparison');
  }
  if (['bogo', 'bundle', 'multi_buy'].includes(c.promotion.mechanic) && !c.content.bundle_quantity) {
    addExclusion('unclear_bundle_quantity', 'Bundle/multi-buy mechanic requires a bundle quantity');
  }
  if (c.prices.price_basis === 'unknown') {
    addExclusion('unclear_price_basis', 'Unknown price basis prevents comparison');
  }

  return result;
}

export function applyDeterministicCheckResultToCanonicalOffer(
  canonicalOffer: CanonicalOffer,
  checkResult: DeterministicOfferCheckResult
): CanonicalOffer {
  
  // Clone to avoid mutating original deeply if possible, but for simplicity mutating directly here as we just created it
  const out = canonicalOffer;

  const existBlockCodes = new Set(out.quality.blocking_errors.map(e => e.code));
  for (const err of checkResult.blocking_errors) {
    if (!existBlockCodes.has(err.code)) {
      out.quality.blocking_errors.push({
        code: err.code,
        message: err.message,
        severity: 'error'
      });
      existBlockCodes.add(err.code);
    }
  }

  const existWarnCodes = new Set(out.quality.non_blocking_warnings.map(e => e.code));
  for (const warn of checkResult.non_blocking_warnings) {
    if (!existWarnCodes.has(warn.code)) {
      out.quality.non_blocking_warnings.push({
        code: warn.code,
        message: warn.message,
        severity: 'warning'
      });
      existWarnCodes.add(warn.code);
    }
  }

  if (checkResult.comparison_exclusions.length > 0) {
    out.comparison.comparison_eligible = false;
    out.comparison.comparison_exclusion_reason = checkResult.comparison_exclusions.map(e => e.message).join('; ');
  }

  return out;
}
