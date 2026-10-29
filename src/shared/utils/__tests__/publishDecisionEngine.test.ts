import { describe, it, expect } from 'vitest';
import { decidePublishAction, applyPublishDecisionToCanonicalOffer } from '../publishDecisionEngine';
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

describe('publishDecisionEngine', () => {
  it('decides skip_or_quarantine if blocking error exists', () => {
    const c = createMockCanonicalOffer();
    c.quality.blocking_errors.push({ code: 'test_err', message: 'test msg' });
    const result = decidePublishAction({ canonicalOffer: c });
    expect(result.decision).toBe('skip_or_quarantine');
    expect(result.display_safe).toBe(false);
    expect(result.should_upload_image).toBe(false);
  });

  it('decides skip_or_quarantine if offer price is missing', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = null;
    const result = decidePublishAction({ canonicalOffer: c });
    expect(result.decision).toBe('skip_or_quarantine');
    expect(result.display_safe).toBe(false);
  });

  it('decides skip_or_quarantine if title is missing', () => {
    const c = createMockCanonicalOffer();
    c.product.title_en = null;
    c.product.title_ar = '';
    const result = decidePublishAction({ canonicalOffer: c });
    expect(result.decision).toBe('skip_or_quarantine');
    expect(result.display_safe).toBe(false);
  });

  it('decides publish if row is valid and comparable', () => {
    const c = createMockCanonicalOffer();
    const compResult = {
      comparison_eligible: true,
      comparison_unit: 'liter' as const,
      comparison_unit_price: 10,
      comparison_confidence: 'high' as const,
      comparison_exclusion_reason: null,
      evidence: {
        offer_price: 10,
        price_basis: 'each',
        size_text: '1L',
        pack_quantity: 1,
        bundle_quantity: 1,
        each_size_value: 1,
        each_size_unit: 'liter',
        total_content_value: 1,
        total_content_unit: 'liter',
        item_domain: 'grocery'
      }
    };
    const result = decidePublishAction({ canonicalOffer: c, comparisonResult: compResult });
    expect(result.decision).toBe('publish');
    expect(result.display_safe).toBe(true);
    expect(result.comparison_safe).toBe(true);
    expect(result.status_for_db).toBe('published');
    expect(result.should_upload_image).toBe(true);
  });

  it('decides publish_but_exclude_from_comparison if row is valid but not comparable', () => {
    const c = createMockCanonicalOffer();
    const compResult = {
      comparison_eligible: false,
      comparison_unit: null,
      comparison_unit_price: null,
      comparison_confidence: 'low' as const,
      comparison_exclusion_reason: 'missing_total_content',
      evidence: {
        offer_price: 15,
        price_basis: 'each',
        size_text: null,
        pack_quantity: 1,
        bundle_quantity: null,
        each_size_value: null,
        each_size_unit: null,
        total_content_value: null,
        total_content_unit: null,
        item_domain: 'grocery'
      }
    };
    const result = decidePublishAction({ canonicalOffer: c, comparisonResult: compResult });
    expect(result.decision).toBe('publish_but_exclude_from_comparison');
    expect(result.display_safe).toBe(true);
    expect(result.comparison_safe).toBe(false);
    expect(result.status_for_db).toBe('published');
    expect(result.should_upload_image).toBe(true);
  });

  it('decides publish_but_exclude_from_comparison for non-grocery display-safe row', () => {
    const c = createMockCanonicalOffer();
    c.product.item_domain = 'electronics';
    const compResult = {
      comparison_eligible: false,
      comparison_unit: null,
      comparison_unit_price: null,
      comparison_confidence: 'low' as const,
      comparison_exclusion_reason: 'non_grocery_item',
      evidence: {
        offer_price: 15,
        price_basis: 'each',
        size_text: 'TV',
        pack_quantity: 1,
        bundle_quantity: null,
        each_size_value: null,
        each_size_unit: null,
        total_content_value: null,
        total_content_unit: null,
        item_domain: 'electronics'
      }
    };
    const result = decidePublishAction({ canonicalOffer: c, comparisonResult: compResult });
    expect(result.decision).toBe('publish_but_exclude_from_comparison');
    expect(result.display_safe).toBe(true);
    expect(result.comparison_safe).toBe(false);
  });

  it('updates canonical offer correctly for publish', () => {
    const c = createMockCanonicalOffer();
    const result = decidePublishAction({ canonicalOffer: c }); // Defaults to publish_but_exclude_from_comparison as compResult is null and canonical says eligible=false
    applyPublishDecisionToCanonicalOffer(c, result);
    expect(c.pre_publish.preview_eligible).toBe(true);
    expect(c.pre_publish.display_in_preview).toBe(true);
    expect(c.pre_publish.preview_group).toBe('publish_but_exclude_from_comparison');
    expect(c.quality.publish_decision).toBe('publish_but_exclude_from_comparison');
  });

  it('updates canonical offer correctly for skip_or_quarantine', () => {
    const c = createMockCanonicalOffer();
    c.prices.offer_price = null;
    const result = decidePublishAction({ canonicalOffer: c });
    applyPublishDecisionToCanonicalOffer(c, result);
    expect(c.pre_publish.preview_eligible).toBe(false);
    expect(c.pre_publish.display_in_preview).toBe(true);
    expect(c.pre_publish.preview_group).toBe('skip_or_quarantine');
    expect(c.quality.publish_decision).toBe('skip_or_quarantine');
  });
});
