import { describe, it, expect } from 'vitest';
import { leafletStyleProfileModelSchema, buildStyleProfileJsonSchema } from '../styleProfileSchema';

describe('styleProfileSchema', () => {
  it('accepts a valid profile', () => {
    const validProfile = {
      confidence: 'high',
      offer_price_patterns: [
        {
          description: 'Large red text in a yellow box',
          color_notes: 'Red',
          price_block_color: 'Yellow',
          relative_size: 'largest',
          position_notes: 'bottom right',
          sar_symbol_notes: 'near the number',
          examples: ['15.00'],
          confidence: 'high'
        }
      ],
      original_price_patterns: [],
      size_patterns: [],
      promotion_patterns: [],
      condition_patterns: [],
      non_price_attribute_patterns: [],
      warnings: [],
      notes: []
    };

    const parsed = leafletStyleProfileModelSchema.parse(validProfile);
    expect(parsed.confidence).toBe('high');
    expect(parsed.offer_price_patterns[0].relative_size).toBe('largest');
  });

  it('rejects random top-level keys', () => {
    const invalidProfile = {
      confidence: 'high',
      offer_price_patterns: [],
      original_price_patterns: [],
      size_patterns: [],
      promotion_patterns: [],
      condition_patterns: [],
      non_price_attribute_patterns: [],
      warnings: [],
      notes: [],
      extra_random_key: 'should fail'
    };

    expect(() => {
      leafletStyleProfileModelSchema.parse(invalidProfile);
    }).toThrow();
  });

  it('builds a valid JSON schema', () => {
    const schema = buildStyleProfileJsonSchema();
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('confidence');
    expect(schema.additionalProperties).toBe(false);
  });
});
