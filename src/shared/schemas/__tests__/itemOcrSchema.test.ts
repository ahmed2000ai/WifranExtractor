import { describe, it, expect } from 'vitest'
import {
  isCandidateItemOcrResponse,
  isLegacyItemOcrResponse,
  parseItemOcrResponse
} from '../itemOcrSchema'

describe('itemOcrSchema', () => {
  it('accepts a valid candidate-based response', () => {
    const validCandidate = {
      item_number: "ITEM-123",
      product_text: {
        title_ar: "حليب",
        title_en: "Milk",
        description_ar: null,
        description_en: null,
        brand_text: "Brand",
        category_hint: null,
        item_domain: "grocery"
      },
      price_candidates: [
        {
          raw_text: "15.00",
          normalized_value: 15,
          currency: "SAR",
          visual_role: "prominent_current_price",
          classified_as: "offer_price",
          confidence: "high",
          evidence: "Big text",
          visual_evidence: {
            text_color: "red",
            price_block_color: "yellow",
            relative_size: "largest",
            is_crossed_out: false,
            near_currency_symbol: true,
            attached_unit: null,
            position_hint: "bottom-left",
            inside_price_block: true
          }
        }
      ],
      size_candidates: [],
      selected_prices: {
        offer_price: 15,
        original_price: null,
        currency: "SAR",
        offer_price_source_raw_text: "15.00",
        original_price_source_raw_text: null,
        selection_confidence: "high",
        selection_evidence: null
      },
      content: {
        size_text: "1L",
        pack_quantity: 1,
        bundle_quantity: null,
        each_size_value: 1,
        each_size_unit: "liter",
        total_content_value: 1,
        total_content_unit: "liter",
        content_confidence: "high"
      },
      price_basis: {
        basis: "each",
        raw_text: null,
        confidence: "high",
        evidence: null
      },
      promotion: {
        mechanic: "standard_price",
        raw_text: null,
        bundle_quantity: null,
        condition_text: null,
        confidence: "high",
        evidence: null
      },
      classification_evidence: {
        why_offer_price: null,
        why_original_price: null,
        why_size_is_not_price: null,
        why_publish_decision: null
      },
      confidence: {
        overall: "high",
        product_text: "high",
        offer_price: "high",
        original_price: "high",
        content: "high",
        promotion: "high"
      },
      warnings: {
        blocking: [],
        non_blocking: []
      },
      model_recommendation: {
        publish_decision: "publish",
        comparison_eligible: true,
        comparison_exclusion_reason: null
      },
      raw_attributes: {
        additional_visible_fields: {}
      }
    }

    expect(isCandidateItemOcrResponse(validCandidate)).toBe(true)
    expect(isLegacyItemOcrResponse(validCandidate)).toBe(false)
  })

  it('rejects random top-level keys', () => {
    const invalidCandidate = {
      item_number: "ITEM-123",
      invalid_extra_key: "test",
      product_text: {
        title_ar: "حليب",
        title_en: "Milk",
        description_ar: null,
        description_en: null,
        brand_text: "Brand",
        category_hint: null,
        item_domain: "grocery"
      },
      price_candidates: [],
      size_candidates: [],
      selected_prices: {
        offer_price: 15,
        original_price: null,
        currency: "SAR",
        offer_price_source_raw_text: "15.00",
        original_price_source_raw_text: null,
        selection_confidence: "high",
        selection_evidence: null
      },
      content: {
        size_text: "1L",
        pack_quantity: 1,
        bundle_quantity: null,
        each_size_value: 1,
        each_size_unit: "liter",
        total_content_value: 1,
        total_content_unit: "liter",
        content_confidence: "high"
      },
      price_basis: {
        basis: "each",
        raw_text: null,
        confidence: "high",
        evidence: null
      },
      promotion: {
        mechanic: "standard_price",
        raw_text: null,
        bundle_quantity: null,
        condition_text: null,
        confidence: "high",
        evidence: null
      },
      classification_evidence: {
        why_offer_price: null,
        why_original_price: null,
        why_size_is_not_price: null,
        why_publish_decision: null
      },
      confidence: {
        overall: "high",
        product_text: "high",
        offer_price: "high",
        original_price: "high",
        content: "high",
        promotion: "high"
      },
      warnings: {
        blocking: [],
        non_blocking: []
      },
      model_recommendation: {
        publish_decision: "publish",
        comparison_eligible: true,
        comparison_exclusion_reason: null
      },
      raw_attributes: {
        additional_visible_fields: {}
      }
    }

    expect(isCandidateItemOcrResponse(invalidCandidate)).toBe(false)
    expect(isLegacyItemOcrResponse(invalidCandidate)).toBe(true)
  })

  it('legacy response still parses', () => {
    const legacy = {
      name_ar: "حليب",
      offer_price: 15
    }

    expect(isLegacyItemOcrResponse(legacy)).toBe(true)
    const parsed = parseItemOcrResponse(legacy)
    expect(parsed).toEqual(legacy)
  })
})
