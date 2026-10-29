import { describe, it, expect } from 'vitest';
import { evaluateComparisonSafety, applyComparisonSafetyToCanonicalOffer } from '../comparisonSafety';
import type { CanonicalOffer } from '../../types/canonicalOffer';

function createMockCanonicalOffer(overrides: Partial<CanonicalOffer> = {}): CanonicalOffer {
  return {
    raw: {
      raw_ocr_json: {},
      raw_validation_json: {},
      raw_ocr_text: null,
      raw_attributes: {}
    },
    source: {
      source_item_number: '001',
      source_page_number: 1,
      leaflet_id: null,
      external_image_id: null
    },
    quality: {
      extraction_confidence: 'high',
      validation_confidence: 'high',
      comparison_confidence: 'high',
      blocking_errors: [],
      non_blocking_warnings: [],
      publish_decision: 'publish'
    },
    product: {
      title_en: 'Test Product',
      title_ar: null,
      brand_text: 'TestBrand',
      category_hint: null,
      item_domain: 'grocery',
      description_ar: null,
      description_en: null
    },
    prices: {
      offer_price: 15.00,
      original_price: null,
      currency: 'SAR',
      discount_amount: null,
      discount_percentage: null,
      price_basis: 'each',
      price_condition_text: null,
      all_price_candidates: []
    },
    content: {
      size_text: null,
      pack_quantity: 1,
      bundle_quantity: null,
      each_size_value: null,
      each_size_unit: null,
      total_content_value: null,
      total_content_unit: null
    },
    promotion: {
      mechanic: 'standard_price',
      special_offer: null,
      condition_text: null,
      bundle_quantity: null
    },
    image: {
      image_bucket: null,
      image_path: 'page-001/item-001.jpg',
      image_url: null,
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
      location_scope: 'national',
      city_id: null,
      region_id: null,
      offer_start_date: null,
      offer_end_date: null
    },
    comparison: {
      comparison_eligible: false,
      comparison_unit: null,
      comparison_unit_price: null,
      comparison_confidence: 'low',
      comparison_exclusion_reason: null
    },
    pre_publish: {
      preview_eligible: false,
      preview_group: 'publish',
      display_in_preview: true
    },
    ...overrides
  } as CanonicalOffer;
}

describe('comparisonSafety', () => {
  it('handles 1.5L oil: offer 10 / 1.5L = 6.67 SAR/liter', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 10;
    c.content.size_text = '1.5 L';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(true);
    expect(result.comparison_unit).toBe('liter');
    expect(result.comparison_unit_price).toBe(6.67);
  });

  it('converts 1500ml to 1.5L', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 15;
    c.content.size_text = '1500ml';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(true);
    expect(result.comparison_unit).toBe('liter');
    expect(result.comparison_unit_price).toBe(10);
  });

  it('handles 730ml 1+1: offer 10 / 1.46L = 6.85 SAR/liter', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 10;
    c.content.size_text = '730ml';
    c.content.bundle_quantity = 2;
    c.promotion.mechanic = 'bogo';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(true);
    expect(result.comparison_unit).toBe('liter');
    expect(result.comparison_unit_price).toBe(6.85); // 10 / 1.46
  });

  it('handles 8x135g: total 1080g = 1.08kg', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 21.60;
    c.content.size_text = '135g';
    c.content.pack_quantity = 8;
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(true);
    expect(result.comparison_unit).toBe('kilogram');
    expect(result.comparison_unit_price).toBe(20); // 21.6 / 1.08
  });

  it('handles per_2kg basis: offer 15 / 2 = 7.5 SAR/kg', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 15;
    c.prices.price_basis = 'per_2kg';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(true);
    expect(result.comparison_unit).toBe('kilogram');
    expect(result.comparison_unit_price).toBe(7.5);
  });

  it('handles per_kg basis: offer 8 = 8 SAR/kg', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 8;
    c.prices.price_basis = 'per_kg';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(true);
    expect(result.comparison_unit).toBe('kilogram');
    expect(result.comparison_unit_price).toBe(8);
  });

  it('handles 30 pieces: offer 12 / 30 = 0.4 SAR/piece', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 12;
    c.content.size_text = '30 pcs';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(true);
    expect(result.comparison_unit).toBe('piece');
    expect(result.comparison_unit_price).toBe(0.4);
  });

  it('handles per_dozen basis: offer 18 / 12 = 1.5 SAR/piece', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 18;
    c.prices.price_basis = 'per_dozen';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(true);
    expect(result.comparison_unit).toBe('piece');
    expect(result.comparison_unit_price).toBe(1.5);
  });

  it('excludes electronics items', () => {
    const c = createMockCanonicalOffer();
    c.product.item_domain = 'electronics';
    c.prices.offer_price = 1000;
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('non_grocery_item');
  });

  it('excludes appliance items', () => {
    const c = createMockCanonicalOffer();
    c.product.item_domain = 'appliance';
    c.prices.offer_price = 1000;
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('non_grocery_item');
  });

  it('excludes missing offer price', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = null;
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('missing_offer_price');
  });

  it('excludes missing total content', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 10;
    c.content.size_text = null;
    c.prices.price_basis = 'each';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('missing_total_content');
  });

  it('excludes unclear bundle quantity', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 10;
    c.content.size_text = '1L';
    c.promotion.mechanic = 'bundle';
    c.content.bundle_quantity = null;
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('unclear_bundle_quantity');
  });

  it('excludes unsupported unit', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 10;
    c.content.size_text = '1 unknownunit';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('unsupported_comparison_unit');
  });

  it('excludes when blocking quality error exists', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 10;
    c.content.size_text = '1L';
    c.quality.blocking_errors.push({ code: 'test', message: 'test block' });
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('comparison_blocked_by_quality_error');
  });

  it('respects existing deterministic comparison exclusion reason', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = 10;
    c.content.size_text = '1L';
    c.comparison.comparison_eligible = false;
    c.comparison.comparison_exclusion_reason = 'unsupported_comparison_domain';
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('unsupported_comparison_domain');
  });

  it('applies result to canonical offer correctly', () => {
    const c = createMockCanonicalOffer();
    const result = evaluateComparisonSafety({ canonicalOffer: c });
    applyComparisonSafetyToCanonicalOffer(c, result);
    expect(c.comparison.comparison_eligible).toBe(false);
    expect(c.comparison.comparison_exclusion_reason).toBe('missing_total_content');
  });

  it('excludes electronics by title even if item_domain was initially set to grocery', () => {
    const c = createMockCanonicalOffer();
    c.product.title_en = 'Honor X8B Pad';
    c.product.title_ar = 'هونر اكس 8 بي';
    c.product.item_domain = 'grocery'; // simulating old buggy state
    c.content.size_text = '4G';
    c.prices.offer_price = 899;

    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('non_grocery_item');
  });

  it('excludes grocery item if computed unit price exceeds 2,000 SAR/kg or 2,000 SAR/L', () => {
    const c = createMockCanonicalOffer();
    c.product.title_en = 'Exotic Saffron Herb';
    c.product.title_ar = 'زعفران';
    c.product.item_domain = 'grocery';
    c.content.size_text = '1g';
    c.prices.offer_price = 2500; // 2500 SAR for 1g = 2,500,000 SAR/kg

    const result = evaluateComparisonSafety({ canonicalOffer: c });
    expect(result.comparison_eligible).toBe(false);
    expect(result.comparison_exclusion_reason).toBe('unreasonable_unit_price_threshold');
  });
});
