/**
 * Wifran Utilization Evaluator – Chunk 57
 *
 * Lightweight offline evaluator that simulates the key visibility rules
 * Wifran needs when consuming published offers. Does not need the full
 * Wifran app – it evaluates:
 *
 *   - appears_for_city  (based on location scope)
 *   - included_in_search
 *   - included_in_best_unit_price_ranking
 *   - excluded_from_comparison
 *   - display_size_text
 *   - display_unit_price_text
 *
 * No API calls. No Supabase. No Mistral.
 */

import type { CanonicalOffer } from '../types/canonicalOffer';
import type { PublishDecisionResult } from '../types/publishDecision';
import type { ComparisonSafetyResult } from '../types/comparisonSafety';
import type { WifranUtilizationResult } from '../types/accuracyHarness';

/**
 * Known test city IDs used by the harness fixtures.
 * In a real scenario these would come from DB reference data.
 */
const ALL_KNOWN_CITY_IDS = [
  'city-riyadh',
  'city-jeddah',
  'city-dammam',
  'city-mecca',
  'city-medina',
];

/**
 * Minimal region → cities mapping for offline evaluation.
 */
const REGION_TO_CITIES: Record<string, string[]> = {
  'region-central': ['city-riyadh'],
  'region-western': ['city-jeddah', 'city-mecca', 'city-medina'],
  'region-eastern': ['city-dammam'],
};

export function evaluateWifranUtilization(input: {
  canonicalOffer: CanonicalOffer;
  decisionResult: PublishDecisionResult;
  comparisonResult: ComparisonSafetyResult;
  userCityId?: string | null;
}): WifranUtilizationResult {
  const { canonicalOffer: c, decisionResult: d, comparisonResult: comp } = input;

  // Default: nothing visible
  const result: WifranUtilizationResult = {
    appears_for_city_ids: [],
    hidden_for_city_ids: [...ALL_KNOWN_CITY_IDS],
    included_in_search: false,
    included_in_best_unit_price_ranking: false,
    excluded_from_comparison: true,
    display_size_text_ar: null,
    display_unit_price_text: null,
  };

  // If decision is skip_or_quarantine → not visible at all
  if (d.decision === 'skip_or_quarantine') {
    return result;
  }

  // --- Location-based visibility ---
  const scope = c.trusted_context.location_scope;

  if (scope === 'national') {
    // National → appears for all cities
    result.appears_for_city_ids = [...ALL_KNOWN_CITY_IDS];
    result.hidden_for_city_ids = [];
  } else if (scope === 'region') {
    const regionId = c.trusted_context.region_id;
    if (regionId && REGION_TO_CITIES[regionId]) {
      result.appears_for_city_ids = [...REGION_TO_CITIES[regionId]];
      result.hidden_for_city_ids = ALL_KNOWN_CITY_IDS.filter(
        (cid) => !REGION_TO_CITIES[regionId].includes(cid)
      );
    }
  } else if (scope === 'city') {
    const cityId = c.trusted_context.city_id;
    if (cityId) {
      result.appears_for_city_ids = [cityId];
      result.hidden_for_city_ids = ALL_KNOWN_CITY_IDS.filter((cid) => cid !== cityId);
    }
  }

  // --- Search visibility ---
  // Offer appears in search if it was published (either variant)
  if (d.decision === 'publish' || d.decision === 'publish_but_exclude_from_comparison') {
    result.included_in_search = true;
  }

  // --- Comparison & ranking ---
  if (d.decision === 'publish' && comp.comparison_eligible) {
    result.included_in_best_unit_price_ranking = true;
    result.excluded_from_comparison = false;
  } else {
    result.included_in_best_unit_price_ranking = false;
    result.excluded_from_comparison = true;
  }

  // --- Display texts ---
  result.display_size_text_ar = c.content.size_text || null;

  if (comp.comparison_eligible && comp.comparison_unit_price !== null && comp.comparison_unit) {
    result.display_unit_price_text = `${comp.comparison_unit_price} SAR/${comp.comparison_unit}`;
  }

  return result;
}
