import { describe, it, expect } from 'vitest';
import { runDeterministicOfferChecks, applyDeterministicCheckResultToCanonicalOffer } from '../deterministicOfferChecks';
import type { CanonicalOffer } from '../../types/canonicalOffer';

function createMockCanonicalOffer(overrides: Partial<CanonicalOffer> = {}): CanonicalOffer {
  return {
    raw: {
      raw_extraction_json: {},
      raw_validation_json: {},
      raw_attributes: {}
    },
    source: {
      sourceItemNumber: '001',
      sourcePageNumber: 1,
      crop_path: 'page-001/item-001.jpg',
      json_path: 'page-001/item-001.json'
    },
    quality: {
      extraction_confidence: 'high',
      validation_confidence: 'high',
      blocking_errors: [],
      non_blocking_warnings: [],
      needs_human_review: false,
      human_review_reason: null
    },
    product: {
      title_en: 'Test Product',
      title_ar: null,
      brand_text: 'TestBrand',
      item_domain: 'grocery'
    },
    prices: {
      offer_price: 15.00,
      original_price: null,
      currency: 'SAR',
      price_basis: 'each',
      all_price_candidates: []
    },
    content: {
      size_text: null,
      unit: null,
      pack_quantity: 1,
      bundle_quantity: null,
      all_size_candidates: []
    },
    promotion: {
      mechanic: 'standard_price',
      special_offer: null,
      condition: null
    },
    image: {
      image_path: 'page-001/item-001.jpg',
      image_source_type: 'leaflet_crop'
    },
    style_validation: {
      validation_result: 'pass',
      style_profile_scope: 'none',
      visual_evidence: {},
      corrected_fields: {}
    },
    trusted_context: {
      supermarket_id: 'test_supermarket',
      leaflet_id: 'test_leaflet',
      location_scope: 'national',
      city_id: null,
      region_id: null,
      offer_start_date: null,
      offer_end_date: null
    },
    comparison: {
      comparison_eligible: true,
      comparison_exclusion_reason: null,
      comparison_confidence: null,
      unit_price: null,
      unit_price_measure: null
    },
    ...overrides
  } as CanonicalOffer;
}

describe('deterministicOfferChecks', () => {
  it('detects 1.5L misclassified as price', () => {
    const canonical = createMockCanonicalOffer();
    canonical.raw.raw_attributes['offer_price_raw_string'] = '1.5 L';
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'size_misclassified_as_price')).toBe(true);
  });

  it('detects 4K misclassified as price', () => {
    const canonical = createMockCanonicalOffer();
    canonical.raw.raw_attributes['offer_price_raw_string'] = '4K';
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'size_misclassified_as_price')).toBe(true);
  });

  it('detects offer price matching size value', () => {
    const canonical = createMockCanonicalOffer();
    canonical.prices.offer_price = 1.5;
    canonical.content.size_text = '1.5L';
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'offer_price_matches_size_value')).toBe(true);
  });

  it('detects original price misclassified as offer price', () => {
    const canonical = createMockCanonicalOffer();
    canonical.prices.offer_price = 25.00;
    canonical.prices.all_price_candidates = [
      { raw_text: '10', normalized_value: 10, currency: 'SAR', visual_role: 'prominent_current_price', classified_as: 'offer_price', confidence: 'high' } as any
    ];
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'original_price_misclassified_as_offer_price')).toBe(true);
  });

  it('detects missing offer price', () => {
    const canonical = createMockCanonicalOffer();
    canonical.prices.offer_price = null;
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'missing_offer_price')).toBe(true);
  });

  it('detects missing product title', () => {
    const canonical = createMockCanonicalOffer();
    canonical.product.title_en = null;
    canonical.product.title_ar = '';
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'missing_product_title')).toBe(true);
  });

  it('emits warning for missing original price', () => {
    const canonical = createMockCanonicalOffer();
    canonical.prices.original_price = null;
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.non_blocking_warnings.some(e => e.code === 'missing_original_price')).toBe(true);
    expect(result.has_blocking_errors).toBe(false);
  });

  it('creates comparison exclusion for non-grocery items', () => {
    const canonical = createMockCanonicalOffer();
    canonical.product.item_domain = 'electronics';
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.comparison_exclusions.some(e => e.code === 'non_grocery_item')).toBe(true);
  });

  it('detects missing city for city scope', () => {
    const canonical = createMockCanonicalOffer();
    canonical.trusted_context.location_scope = 'city';
    canonical.trusted_context.city_id = null;
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'missing_city_for_city_scope')).toBe(true);
  });

  it('detects missing region for region scope', () => {
    const canonical = createMockCanonicalOffer();
    canonical.trusted_context.location_scope = 'region';
    canonical.trusted_context.region_id = null;
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'missing_region_for_region_scope')).toBe(true);
  });

  it('detects invalid location scope (national with city)', () => {
    const canonical = createMockCanonicalOffer();
    canonical.trusted_context.location_scope = 'national';
    canonical.trusted_context.city_id = 'city-1';
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'invalid_location_scope')).toBe(true);
  });

  it('detects expired offer end date', () => {
    const canonical = createMockCanonicalOffer();
    canonical.trusted_context.offer_end_date = '2020-01-01';
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical, now: new Date('2024-01-01') });
    expect(result.blocking_errors.some(e => e.code === 'expired_offer_end_date')).toBe(true);
  });

  it('detects unsafe image path', () => {
    const canonical = createMockCanonicalOffer();
    canonical.image.image_path = '../../etc/passwd';
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    expect(result.blocking_errors.some(e => e.code === 'unsafe_image_path')).toBe(true);
  });

  it('applies results correctly without duplicating', () => {
    const canonical = createMockCanonicalOffer();
    const result = runDeterministicOfferChecks({ canonicalOffer: canonical });
    // Add dummy error
    result.blocking_errors.push({ code: 'test_err', severity: 'blocking', message: 'msg' });
    
    applyDeterministicCheckResultToCanonicalOffer(canonical, result);
    expect(canonical.quality.blocking_errors.some(e => e.code === 'test_err')).toBe(true);

    // Apply again to test duplication
    applyDeterministicCheckResultToCanonicalOffer(canonical, result);
    expect(canonical.quality.blocking_errors.filter(e => e.code === 'test_err').length).toBe(1);
  });
});
