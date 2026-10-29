import { describe, it, expect } from 'vitest';
import { styleAwareValidationModelSchema } from '../styleAwareValidationSchema';

describe('styleAwareValidationSchema', () => {
  it('accepts a valid pass result', () => {
    const validPass = {
      validation_result: 'pass',
      corrected_fields: {
        offer_price: 15.00,
        original_price: null,
        size_text: '1.5L',
        pack_quantity: 1,
        bundle_quantity: null,
        price_basis: 'each',
        promotion_mechanic: 'standard_price'
      },
      blocking_errors: [],
      non_blocking_warnings: [],
      comparison: {
        comparison_eligible: true,
        comparison_exclusion_reason: null,
        comparison_confidence: 'high'
      },
      visual_evidence: {
        offer_price: {
          explanation: 'Clear red text',
          text_color: 'Red',
          price_block_color: null,
          relative_size: 'largest',
          is_crossed_out: false,
          near_currency_symbol: true,
          position_hint: 'bottom right'
        },
        original_price: {
          explanation: null,
          is_crossed_out: null,
          relative_size: null,
          position_hint: null
        },
        size: {
          explanation: 'Near product',
          attached_unit: 'L',
          near_product_title_or_pack: true
        },
        promotion: {
          explanation: null
        }
      },
      publish_decision: 'publish',
      confidence: 'high'
    };

    const parsed = styleAwareValidationModelSchema.parse(validPass);
    expect(parsed.validation_result).toBe('pass');
    expect(parsed.confidence).toBe('high');
  });

  it('rejects random top-level keys', () => {
    const invalid = {
      validation_result: 'pass',
      corrected_fields: {
        offer_price: 15.00,
        original_price: null,
        size_text: '1.5L',
        pack_quantity: 1,
        bundle_quantity: null,
        price_basis: 'each',
        promotion_mechanic: 'standard_price'
      },
      blocking_errors: [],
      non_blocking_warnings: [],
      comparison: {
        comparison_eligible: true,
        comparison_exclusion_reason: null,
        comparison_confidence: 'high'
      },
      visual_evidence: {
        offer_price: {
          explanation: null,
          text_color: null,
          price_block_color: null,
          relative_size: 'unknown',
          is_crossed_out: false,
          near_currency_symbol: true,
          position_hint: null
        },
        original_price: {
          explanation: null,
          is_crossed_out: null,
          relative_size: null,
          position_hint: null
        },
        size: {
          explanation: null,
          attached_unit: null,
          near_product_title_or_pack: null
        },
        promotion: {
          explanation: null
        }
      },
      publish_decision: 'publish',
      confidence: 'high',
      random_invalid_key: true
    };

    expect(() => {
      styleAwareValidationModelSchema.parse(invalid);
    }).toThrow();
  });
});
