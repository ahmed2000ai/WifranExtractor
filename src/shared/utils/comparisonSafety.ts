import { CanonicalOffer } from '../types/canonicalOffer';
import { ComparisonSafetyResult, ComparisonUnit } from '../types/comparisonSafety';
import { parseAndNormalizeQuantity, toCanonicalOfferUnit, detectItemDomainFromTitle } from './priceAndUnitNormalizer';

const DOMAIN_EXCLUSIONS = ['electronics', 'appliance', 'other_non_grocery'];

export function evaluateComparisonSafety(input: {
  canonicalOffer: CanonicalOffer;
}): ComparisonSafetyResult {
  const c = input.canonicalOffer;
  const offerPrice = c.prices.offer_price;
  const domain = c.product.item_domain;
  const priceBasis = c.prices.price_basis;

  const effectiveDomain = detectItemDomainFromTitle(
    c.product.title_en,
    c.product.title_ar,
    domain
  );

  const evidence = {
    offer_price: offerPrice,
    price_basis: priceBasis,
    size_text: c.content.size_text,
    pack_quantity: c.content.pack_quantity,
    bundle_quantity: c.content.bundle_quantity,
    each_size_value: c.content.each_size_value ?? null,
    each_size_unit: c.content.each_size_unit ?? null,
    total_content_value: c.content.total_content_value ?? null,
    total_content_unit: c.content.total_content_unit ?? null,
    item_domain: effectiveDomain,
  };

  const result: ComparisonSafetyResult = {
    comparison_eligible: false,
    comparison_unit: null,
    comparison_unit_price: null,
    comparison_confidence: 'low',
    comparison_exclusion_reason: null,
    evidence,
  };

  // 1. Check existing blocking quality errors
  if (c.quality.blocking_errors && c.quality.blocking_errors.length > 0) {
    result.comparison_exclusion_reason = 'comparison_blocked_by_quality_error';
    return result;
  }

  // 2. Check existing deterministic comparison exclusions
  if (!c.comparison.comparison_eligible && c.comparison.comparison_exclusion_reason) {
    result.comparison_exclusion_reason = c.comparison.comparison_exclusion_reason;
    return result;
  }

  // 3. Domain exclusions
  if (DOMAIN_EXCLUSIONS.includes(effectiveDomain)) {
    result.comparison_exclusion_reason = 'non_grocery_item';
    return result;
  }

  // 4. Missing offer price
  if (offerPrice === null || isNaN(offerPrice) || offerPrice <= 0) {
    result.comparison_exclusion_reason = 'missing_offer_price';
    return result;
  }

  // 5. Unclear bundle quantity on bundle/bogo mechanics
  if (['bogo', 'bundle'].includes(c.promotion.mechanic) && !c.content.bundle_quantity) {
    result.comparison_exclusion_reason = 'unclear_bundle_quantity';
    return result;
  }

  // 6. Use comprehensive deterministic bilingual multi-pack & unit parser
  const norm = parseAndNormalizeQuantity({
    size_text: c.content.size_text,
    title_en: c.product.title_en,
    title_ar: c.product.title_ar,
    item_domain: effectiveDomain,
    ai_pack_quantity: c.content.pack_quantity,
    ai_each_size_value: c.content.each_size_value,
    ai_each_size_unit: c.content.each_size_unit,
    offer_price: offerPrice,
    price_basis: priceBasis,
    bundle_quantity: c.content.bundle_quantity
  });

  evidence.each_size_value = norm.each_size_value;
  evidence.each_size_unit = toCanonicalOfferUnit(norm.each_size_unit);
  evidence.total_content_value = norm.standardized_total_value;
  evidence.total_content_unit = norm.standardized_unit;

  if (norm.comparison_eligible && norm.standardized_unit && norm.standardized_total_value && norm.standardized_total_value > 0) {
    // Sanity guard: if a grocery item's computed comparison_unit_price exceeds 2,000 SAR/kg or 2,000 SAR/L
    if (
      (norm.standardized_unit === 'kilogram' || norm.standardized_unit === 'liter') &&
      norm.standardized_unit_price !== null &&
      norm.standardized_unit_price > 2000
    ) {
      result.comparison_eligible = false;
      result.comparison_exclusion_reason = 'unreasonable_unit_price_threshold';
      return result;
    }

    result.comparison_eligible = true;
    result.comparison_unit = norm.standardized_unit as ComparisonUnit;
    result.comparison_unit_price = norm.standardized_unit_price;
    result.comparison_confidence = c.quality.extraction_confidence === 'high' ? 'high' : 'medium';
    result.comparison_exclusion_reason = null;
    return result;
  }

  result.comparison_eligible = false;
  result.comparison_exclusion_reason = norm.exclusion_reason || 'missing_total_content';
  return result;
}

export function applyComparisonSafetyToCanonicalOffer(
  canonicalOffer: CanonicalOffer,
  safetyResult: ComparisonSafetyResult
): CanonicalOffer {
  canonicalOffer.comparison = {
    comparison_eligible: safetyResult.comparison_eligible,
    comparison_unit: safetyResult.comparison_unit,
    comparison_unit_price: safetyResult.comparison_unit_price,
    comparison_confidence: safetyResult.comparison_confidence,
    comparison_exclusion_reason: safetyResult.comparison_exclusion_reason,
  };

  return canonicalOffer;
}
