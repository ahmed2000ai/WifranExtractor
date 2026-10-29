import { describe, it, expect } from 'vitest'
import { normalizeToCanonicalOffer } from '../canonicalOfferNormalizer'

describe('canonicalOfferNormalizer', () => {
  it('normalizes a legacy response correctly', () => {
    const rawLegacy = {
      name_ar: 'حليب',
      name_en: 'Milk',
      offer_price: 15.5,
      old_price: 20,
      size: '1L',
      unit_type: 'liter',
      unknown_field_123: 'test'
    }

    const canonical = normalizeToCanonicalOffer({
      rawOcrJson: rawLegacy,
      source: { sourceItemNumber: '001' }
    })

    expect(canonical.product.title_ar).toBe('حليب')
    expect(canonical.product.title_en).toBe('Milk')
    expect(canonical.prices.offer_price).toBe(15.5)
    expect(canonical.prices.original_price).toBe(20)
    expect(canonical.content.size_text).toBe('1L')
    expect(canonical.content.each_size_unit).toBe('liter')
    
    // Check raw attributes preservation
    expect(canonical.raw.raw_attributes['unknown_field_123']).toBe('test')
    
    // Check synthetic price candidates
    const offerCandidate = canonical.prices.all_price_candidates.find(c => c.classified_as === 'offer_price')
    expect(offerCandidate).toBeDefined()
    expect(offerCandidate?.normalized_value).toBe(15.5)

    const origCandidate = canonical.prices.all_price_candidates.find(c => c.classified_as === 'original_price')
    expect(origCandidate).toBeDefined()
    expect(origCandidate?.normalized_value).toBe(20)
  })

  it('normalizes a candidate-based response correctly', () => {
    const rawCandidate = {
      product_text: {
        title_ar: 'عصير',
        title_en: 'Juice',
      },
      selected_prices: {
        offer_price: 10,
        original_price: null,
        currency: 'SAR',
        offer_price_source_raw_text: '10.00'
      },
      price_candidates: [
        {
          raw_text: '10.00',
          normalized_value: 10,
          currency: 'SAR',
          visual_role: 'prominent_current_price',
          classified_as: 'offer_price',
          confidence: 'high',
          evidence: 'Big text',
          visual_evidence: { relative_size: 'largest' }
        }
      ],
      size_candidates: [],
      content: {
        size_text: '500ml',
        each_size_value: 500,
        each_size_unit: 'milliliter'
      },
      warnings: {
        blocking: [{ code: 'TEST_ERR', message: 'Test error' }],
        non_blocking: [{ code: 'TEST_WARN', message: 'Test warning' }]
      },
      raw_attributes: {
        additional_visible_fields: { special_note: 'Promo' }
      }
    }

    const canonical = normalizeToCanonicalOffer({
      rawOcrJson: rawCandidate,
      source: { sourceItemNumber: '002' }
    })

    expect(canonical.product.title_ar).toBe('عصير')
    expect(canonical.prices.offer_price).toBe(10)
    expect(canonical.prices.original_price).toBeNull()
    expect(canonical.content.each_size_value).toBe(500)
    expect(canonical.content.each_size_unit).toBe('milliliter')

    // Check candidate preservation
    expect(canonical.prices.all_price_candidates.length).toBe(1)
    expect(canonical.prices.all_price_candidates[0].visual_evidence.relative_size).toBe('largest')

    // Check quality fields mapping
    expect(canonical.quality.blocking_errors.some(e => e.code === 'TEST_ERR')).toBe(true)
    expect(canonical.quality.non_blocking_warnings.some(w => w.code === 'TEST_WARN')).toBe(true)

    // Check raw attributes merging
    expect(canonical.raw.raw_attributes.special_note).toBe('Promo')
    expect(canonical.raw.raw_attributes.offer_price_source_raw_text).toBe('10.00')
  })
})
