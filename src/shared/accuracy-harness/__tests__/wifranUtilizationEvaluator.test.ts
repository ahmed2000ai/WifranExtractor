/**
 * Wifran Utilization Evaluator Tests – Chunk 57
 *
 * Tests offline utilization evaluation rules.
 * No Mistral. No Supabase. No network.
 */

import { describe, it, expect } from 'vitest';
import { evaluateWifranUtilization } from '../wifranUtilizationEvaluator';
import type { CanonicalOffer } from '../../types/canonicalOffer';
import type { PublishDecisionResult } from '../../types/publishDecision';
import type { ComparisonSafetyResult } from '../../types/comparisonSafety';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCanonical(overrides: Partial<{
  location_scope: string;
  city_id: string | null;
  region_id: string | null;
  size_text: string | null;
}>): CanonicalOffer {
  return {
    source: { leaflet_id: null, source_page_number: 1, source_item_number: '001', external_image_id: null },
    trusted_context: {
      supermarket_id: 'sm-test',
      location_scope: (overrides.location_scope ?? 'national') as any,
      city_id: overrides.city_id ?? null,
      region_id: overrides.region_id ?? null,
      offer_start_date: '2026-06-01',
      offer_end_date: '2026-12-31',
    },
    product: { title_ar: 'منتج', title_en: 'Product', brand_text: null, category_hint: null, item_domain: 'grocery', description_ar: null, description_en: null },
    prices: { offer_price: 10, original_price: 15, currency: 'SAR', discount_amount: 5, discount_percentage: 33, price_basis: 'each', price_condition_text: null, all_price_candidates: [] },
    content: { size_text: overrides.size_text ?? '1L', pack_quantity: null, bundle_quantity: null, each_size_value: null, each_size_unit: null, total_content_value: null, total_content_unit: null },
    promotion: { mechanic: 'standard_price', special_offer: null, condition_text: null, bundle_quantity: null },
    comparison: { comparison_eligible: false, comparison_unit: null, comparison_unit_price: null, comparison_confidence: 'low', comparison_exclusion_reason: null },
    image: { image_bucket: null, image_path: null, image_url: null, image_source_type: null },
    quality: { publish_decision: 'publish', extraction_confidence: 'high', validation_confidence: 'high', comparison_confidence: 'high', blocking_errors: [], non_blocking_warnings: [] },
    style_validation: { validation_result: 'pass', visual_evidence: {}, corrected_fields: {}, style_profile_scope: 'none' },
    pre_publish: { preview_eligible: true, preview_group: 'publish', display_in_preview: true },
    display: {
      show_display_unit_price: false,
      display_unit_price: null,
      display_unit_basis_value: null,
      display_unit_basis_unit: null,
      display_unit_family: null,
      display_unit_price_label_ar: null,
      display_unit_price_label_en: null,
      below_min_display_price_threshold: false,
      min_display_unit_price_sar: 0.50,
      hidden_reason: null,
    },
    raw: { raw_ocr_json: {}, raw_validation_json: null, raw_ocr_text: null, raw_attributes: {} },
  };
}

function makeDecision(decision: 'publish' | 'publish_but_exclude_from_comparison' | 'skip_or_quarantine'): PublishDecisionResult {
  return {
    decision,
    display_safe: decision !== 'skip_or_quarantine',
    comparison_safe: decision === 'publish',
    should_upload_image: decision !== 'skip_or_quarantine',
    should_upsert_db: decision !== 'skip_or_quarantine',
    status_for_db: decision === 'skip_or_quarantine' ? 'skipped' : 'published',
    comparison_eligible: decision === 'publish',
    comparison_exclusion_reason: decision === 'publish' ? null : 'excluded',
    reasons: [],
  };
}

function makeComparison(eligible: boolean): ComparisonSafetyResult {
  return {
    comparison_eligible: eligible,
    comparison_unit: eligible ? 'liter' : null,
    comparison_unit_price: eligible ? 10 : null,
    comparison_confidence: 'high',
    comparison_exclusion_reason: eligible ? null : 'missing_total_content',
    evidence: {
      offer_price: 10,
      price_basis: 'each',
      size_text: '1L',
      pack_quantity: null,
      bundle_quantity: null,
      each_size_value: null,
      each_size_unit: null,
      total_content_value: null,
      total_content_unit: null,
      item_domain: 'grocery',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Wifran Utilization Evaluator', () => {
  it('national offer appears for all cities', () => {
    const result = evaluateWifranUtilization({
      canonicalOffer: makeCanonical({ location_scope: 'national' }),
      decisionResult: makeDecision('publish'),
      comparisonResult: makeComparison(true),
    });
    expect(result.appears_for_city_ids.length).toBeGreaterThanOrEqual(5);
    expect(result.hidden_for_city_ids.length).toBe(0);
    expect(result.included_in_search).toBe(true);
    expect(result.included_in_best_unit_price_ranking).toBe(true);
    expect(result.excluded_from_comparison).toBe(false);
  });

  it('city offer appears only for matching city', () => {
    const result = evaluateWifranUtilization({
      canonicalOffer: makeCanonical({ location_scope: 'city', city_id: 'city-riyadh' }),
      decisionResult: makeDecision('publish'),
      comparisonResult: makeComparison(true),
    });
    expect(result.appears_for_city_ids).toEqual(['city-riyadh']);
    expect(result.hidden_for_city_ids).toContain('city-jeddah');
    expect(result.hidden_for_city_ids).toContain('city-dammam');
  });

  it('region offer appears for cities in that region', () => {
    const result = evaluateWifranUtilization({
      canonicalOffer: makeCanonical({ location_scope: 'region', region_id: 'region-western' }),
      decisionResult: makeDecision('publish'),
      comparisonResult: makeComparison(true),
    });
    expect(result.appears_for_city_ids).toContain('city-jeddah');
    expect(result.appears_for_city_ids).toContain('city-mecca');
    expect(result.hidden_for_city_ids).toContain('city-riyadh');
    expect(result.hidden_for_city_ids).toContain('city-dammam');
  });

  it('skip_or_quarantine is not visible anywhere', () => {
    const result = evaluateWifranUtilization({
      canonicalOffer: makeCanonical({ location_scope: 'national' }),
      decisionResult: makeDecision('skip_or_quarantine'),
      comparisonResult: makeComparison(false),
    });
    expect(result.appears_for_city_ids).toEqual([]);
    expect(result.included_in_search).toBe(false);
    expect(result.included_in_best_unit_price_ranking).toBe(false);
    expect(result.excluded_from_comparison).toBe(true);
  });

  it('publish_but_exclude appears in search but not in ranking', () => {
    const result = evaluateWifranUtilization({
      canonicalOffer: makeCanonical({ location_scope: 'national' }),
      decisionResult: makeDecision('publish_but_exclude_from_comparison'),
      comparisonResult: makeComparison(false),
    });
    expect(result.included_in_search).toBe(true);
    expect(result.included_in_best_unit_price_ranking).toBe(false);
    expect(result.excluded_from_comparison).toBe(true);
  });

  it('includes display_unit_price_text when comparison eligible', () => {
    const result = evaluateWifranUtilization({
      canonicalOffer: makeCanonical({}),
      decisionResult: makeDecision('publish'),
      comparisonResult: makeComparison(true),
    });
    expect(result.display_unit_price_text).toBe('10 SAR/liter');
  });

  it('display_unit_price_text is null when not comparison eligible', () => {
    const result = evaluateWifranUtilization({
      canonicalOffer: makeCanonical({}),
      decisionResult: makeDecision('publish_but_exclude_from_comparison'),
      comparisonResult: makeComparison(false),
    });
    expect(result.display_unit_price_text).toBeNull();
  });

  it('display_size_text_ar comes from canonical size_text', () => {
    const result = evaluateWifranUtilization({
      canonicalOffer: makeCanonical({ size_text: '2.5kg' }),
      decisionResult: makeDecision('publish'),
      comparisonResult: makeComparison(true),
    });
    expect(result.display_size_text_ar).toBe('2.5kg');
  });
});
