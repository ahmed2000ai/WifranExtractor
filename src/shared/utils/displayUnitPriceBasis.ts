import { DisplayUnitPriceResult } from '../types/displayUnitPrice';

export function selectDisplayUnitPriceBasis(input: {
  offerPrice: number | null | undefined;
  totalContentValue: number | null | undefined;
  totalContentUnit: string | null | undefined;
  comparisonEligible: boolean;
  itemDomain?: string | null;
  categorySlug?: string | null;
  minDisplayUnitPriceSar?: number;
}): DisplayUnitPriceResult {
  const minThreshold = input.minDisplayUnitPriceSar ?? 0.50;

  const result: DisplayUnitPriceResult = {
    show_display_unit_price: false,
    display_unit_price: null,
    display_unit_basis_value: null,
    display_unit_basis_unit: null,
    display_unit_family: null,
    display_unit_price_label_ar: null,
    display_unit_price_label_en: null,
    below_min_display_price_threshold: false,
    min_display_unit_price_sar: minThreshold,
    hidden_reason: null,
  };

  if (!input.comparisonEligible) {
    result.hidden_reason = 'comparison_not_eligible';
    return result;
  }

  if (input.offerPrice == null || input.offerPrice <= 0 || isNaN(input.offerPrice)) {
    result.hidden_reason = 'missing_offer_price';
    return result;
  }

  if (input.totalContentValue == null || input.totalContentValue <= 0 || isNaN(input.totalContentValue)) {
    result.hidden_reason = 'missing_total_content';
    return result;
  }

  // Check domain (hide for electronics/appliance/other_non_grocery if strict)
  if (input.itemDomain && ['electronics', 'appliance', 'other_non_grocery'].includes(input.itemDomain)) {
    result.hidden_reason = 'non_grocery_item';
    return result;
  }

  // Normalize total content unit
  const rawUnit = (input.totalContentUnit || '').toLowerCase().trim();
  let family: 'mass' | 'volume' | 'count' | null = null;
  let baseQuantity = 0; // standard smallest unit (g, ml, piece)

  if (['g', 'gram', 'grams'].includes(rawUnit)) {
    family = 'mass';
    baseQuantity = input.totalContentValue;
  } else if (['kg', 'kilogram', 'kilograms'].includes(rawUnit)) {
    family = 'mass';
    baseQuantity = input.totalContentValue * 1000;
  } else if (['ml', 'milliliter', 'milliliters'].includes(rawUnit)) {
    family = 'volume';
    baseQuantity = input.totalContentValue;
  } else if (['l', 'liter', 'liters'].includes(rawUnit)) {
    family = 'volume';
    baseQuantity = input.totalContentValue * 1000;
  } else if (['piece', 'pieces', 'pc', 'pcs'].includes(rawUnit)) {
    family = 'count';
    baseQuantity = input.totalContentValue;
  } else {
    result.hidden_reason = 'unsupported_unit';
    return result;
  }

  if (baseQuantity <= 0) {
    result.hidden_reason = 'unsafe_conversion';
    return result;
  }

  // Candidates (smallest to largest)
  let candidates: Array<{ value: number; unit: DisplayUnitPriceResult['display_unit_basis_unit']; baseEquiv: number }> = [];

  if (family === 'mass') {
    candidates = [
      { value: 1, unit: 'g', baseEquiv: 1 },
      { value: 10, unit: 'g', baseEquiv: 10 },
      { value: 100, unit: 'g', baseEquiv: 100 },
      { value: 1, unit: 'kg', baseEquiv: 1000 },
    ];
  } else if (family === 'volume') {
    candidates = [
      { value: 1, unit: 'ml', baseEquiv: 1 },
      { value: 10, unit: 'ml', baseEquiv: 10 },
      { value: 100, unit: 'ml', baseEquiv: 100 },
      { value: 1, unit: 'l', baseEquiv: 1000 },
    ];
  } else if (family === 'count') {
    candidates = [
      { value: 1, unit: 'piece', baseEquiv: 1 },
      { value: 10, unit: 'pieces', baseEquiv: 10 },
      { value: 100, unit: 'pieces', baseEquiv: 100 },
    ];
  }

  let chosenCandidate = candidates[candidates.length - 1]; // fallback to largest
  let chosenPrice = 0;
  let satisfiesThreshold = false;

  for (const candidate of candidates) {
    const candidatePrice = (input.offerPrice * candidate.baseEquiv) / baseQuantity;
    if (candidatePrice >= minThreshold) {
      chosenCandidate = candidate;
      chosenPrice = candidatePrice;
      satisfiesThreshold = true;
      break;
    }
  }

  // If none satisfied threshold, use the largest one evaluated in the loop fallback
  if (!satisfiesThreshold) {
    chosenPrice = (input.offerPrice * chosenCandidate.baseEquiv) / baseQuantity;
  }

  const roundedPrice = Math.round(chosenPrice * 100) / 100;

  result.show_display_unit_price = true;
  result.display_unit_price = roundedPrice;
  result.display_unit_price_unrounded = chosenPrice;
  result.display_unit_basis_value = chosenCandidate.value;
  result.display_unit_basis_unit = chosenCandidate.unit;
  result.display_unit_family = family;
  result.below_min_display_price_threshold = !satisfiesThreshold;

  // Format labels
  const priceStr = roundedPrice.toFixed(2);
  const isPieceSingle = (chosenCandidate.unit === 'piece' && chosenCandidate.value === 1);
  const displayUnitEn = isPieceSingle ? 'piece' : `${chosenCandidate.value}${chosenCandidate.unit === 'pieces' ? ' pieces' : chosenCandidate.unit}`;
  
  // Arabic mapping
  const arUnitMap: Record<string, string> = {
    'g': 'جم',
    'kg': 'كجم',
    'ml': 'مل',
    'l': 'لتر',
    'piece': 'قطعة',
    'pieces': 'قطع'
  };
  const unitArBase = arUnitMap[chosenCandidate.unit as string] || chosenCandidate.unit;
  const displayUnitAr = isPieceSingle ? unitArBase : `${chosenCandidate.value} ${unitArBase}`;

  result.display_unit_price_label_en = `SAR ${priceStr} / ${displayUnitEn}`;
  result.display_unit_price_label_ar = `${priceStr} ر.س / ${displayUnitAr}`;

  return result;
}
