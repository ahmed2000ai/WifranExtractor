import { z } from 'zod'

export const LegacyItemOcrSchema = z.record(z.string(), z.unknown())

export const PriceCandidateSchema = z.object({
  raw_text: z.string(),
  normalized_value: z.number().nullable(),
  currency: z.enum(['SAR']).nullable(),
  visual_role: z.enum([
    'prominent_current_price',
    'crossed_out_old_price',
    'smaller_old_price',
    'price_label',
    'ambiguous',
    'not_a_price'
  ]),
  classified_as: z.enum([
    'offer_price',
    'original_price',
    'ambiguous_price',
    'not_a_price'
  ]),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.string().nullable(),
  visual_evidence: z.object({
    text_color: z.string().nullable(),
    price_block_color: z.string().nullable(),
    relative_size: z.enum(['largest', 'large', 'medium', 'small', 'unknown']),
    is_crossed_out: z.boolean().nullable(),
    near_currency_symbol: z.boolean().nullable(),
    attached_unit: z.string().nullable(),
    position_hint: z.enum(['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right', 'unknown']),
    inside_price_block: z.boolean().nullable()
  }).strict()
}).strict()

export const SizeCandidateSchema = z.object({
  raw_text: z.string(),
  normalized_value: z.number().nullable(),
  unit: z.enum(['liter', 'milliliter', 'kilogram', 'gram', 'piece', 'inch', 'dozen', 'other']).nullable(),
  classified_as: z.enum(['each_size', 'total_size', 'pack_quantity', 'screen_size', 'quantity', 'ambiguous_size']),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.string().nullable(),
  visual_evidence: z.object({
    attached_unit: z.string().nullable(),
    near_product_title_or_pack: z.boolean().nullable(),
    inside_price_block: z.boolean().nullable(),
    position_hint: z.enum(['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right', 'unknown'])
  }).strict()
}).strict()

export const CandidateItemOcrSchema = z.object({
  item_number: z.string(),
  product_text: z.object({
    title_ar: z.string().nullable(),
    title_en: z.string().nullable(),
    description_ar: z.string().nullable(),
    description_en: z.string().nullable(),
    brand_text: z.string().nullable(),
    category_hint: z.string().nullable(),
    item_domain: z.enum(['grocery', 'household', 'personal_care', 'electronics', 'appliance', 'other_non_grocery', 'unknown'])
  }).strict(),
  price_candidates: z.array(PriceCandidateSchema),
  size_candidates: z.array(SizeCandidateSchema),
  selected_prices: z.object({
    offer_price: z.number().nullable(),
    original_price: z.number().nullable(),
    currency: z.enum(['SAR']).nullable(),
    offer_price_source_raw_text: z.string().nullable(),
    original_price_source_raw_text: z.string().nullable(),
    selection_confidence: z.enum(['high', 'medium', 'low']),
    selection_evidence: z.string().nullable()
  }).strict(),
  content: z.object({
    size_text: z.string().nullable(),
    pack_quantity: z.number().nullable(),
    bundle_quantity: z.number().nullable(),
    each_size_value: z.number().nullable(),
    each_size_unit: z.enum(['liter', 'milliliter', 'kilogram', 'gram', 'piece', 'inch', 'dozen', 'other']).nullable(),
    total_content_value: z.number().nullable(),
    total_content_unit: z.enum(['liter', 'milliliter', 'kilogram', 'gram', 'piece', 'dozen', 'other']).nullable(),
    content_confidence: z.enum(['high', 'medium', 'low'])
  }).strict(),
  price_basis: z.object({
    basis: z.enum(['each', 'per_pack', 'per_box', 'per_bag', 'per_kg', 'per_2kg', 'per_dozen', 'bundle', 'multi_buy', 'unknown']),
    raw_text: z.string().nullable(),
    confidence: z.enum(['high', 'medium', 'low']),
    evidence: z.string().nullable()
  }).strict(),
  promotion: z.object({
    mechanic: z.enum(['standard_price', 'bogo', 'bundle', 'multi_buy', 'loyalty_required', 'selected_branches', 'unknown']),
    raw_text: z.string().nullable(),
    bundle_quantity: z.number().nullable(),
    condition_text: z.string().nullable(),
    confidence: z.enum(['high', 'medium', 'low']),
    evidence: z.string().nullable()
  }).strict(),
  classification_evidence: z.object({
    why_offer_price: z.string().nullable(),
    why_original_price: z.string().nullable(),
    why_size_is_not_price: z.string().nullable(),
    why_publish_decision: z.string().nullable()
  }).strict(),
  confidence: z.object({
    overall: z.enum(['high', 'medium', 'low']),
    product_text: z.enum(['high', 'medium', 'low']),
    offer_price: z.enum(['high', 'medium', 'low']),
    original_price: z.enum(['high', 'medium', 'low']),
    content: z.enum(['high', 'medium', 'low']),
    promotion: z.enum(['high', 'medium', 'low'])
  }).strict(),
  warnings: z.object({
    blocking: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    non_blocking: z.array(z.object({ code: z.string(), message: z.string() }).strict())
  }).strict(),
  model_recommendation: z.object({
    publish_decision: z.enum(['publish', 'publish_but_exclude_from_comparison', 'skip_or_quarantine']),
    comparison_eligible: z.boolean(),
    comparison_exclusion_reason: z.string().nullable()
  }).strict(),
  raw_attributes: z.object({
    additional_visible_fields: z.record(z.string(), z.unknown())
  }).strict()
}).strict()

export type CandidateItemOcrResponse = z.infer<typeof CandidateItemOcrSchema>
export type LegacyItemOcrResponse = Record<string, unknown>
export type CandidateOrLegacyItemOcrResponse = CandidateItemOcrResponse | LegacyItemOcrResponse

export function isCandidateItemOcrResponse(value: unknown): value is CandidateItemOcrResponse {
  return CandidateItemOcrSchema.safeParse(value).success
}

export function isLegacyItemOcrResponse(value: unknown): value is LegacyItemOcrResponse {
  if (isCandidateItemOcrResponse(value)) return false
  return LegacyItemOcrSchema.safeParse(value).success
}

export function parseItemOcrResponse(value: unknown): CandidateOrLegacyItemOcrResponse {
  const candidateResult = CandidateItemOcrSchema.safeParse(value)
  if (candidateResult.success) {
    return candidateResult.data
  }
  return value as LegacyItemOcrResponse
}

// Preserve export for downstream
export const itemOcrJsonSchema = LegacyItemOcrSchema

/**
 * JSON Schema for Mistral response_format. Used in the API call body.
 */
export function buildItemOcrJsonSchema(): unknown {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'candidate_item_ocr_extraction',
      strict: true,
      schema: {
        type: "object",
        properties: {
          item_number: { type: "string" },
          product_text: {
            type: "object",
            properties: {
              title_ar: { type: ["string", "null"] },
              title_en: { type: ["string", "null"] },
              description_ar: { type: ["string", "null"] },
              description_en: { type: ["string", "null"] },
              brand_text: { type: ["string", "null"] },
              category_hint: { type: ["string", "null"] },
              item_domain: { type: "string", enum: ["grocery", "household", "personal_care", "electronics", "appliance", "other_non_grocery", "unknown"] }
            },
            required: ["title_ar", "title_en", "description_ar", "description_en", "brand_text", "category_hint", "item_domain"],
            additionalProperties: false
          },
          price_candidates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                raw_text: { type: "string" },
                normalized_value: { type: ["number", "null"] },
                currency: { type: ["string", "null"], enum: ["SAR", null] },
                visual_role: { type: "string", enum: ["prominent_current_price", "crossed_out_old_price", "smaller_old_price", "price_label", "ambiguous", "not_a_price"] },
                classified_as: { type: "string", enum: ["offer_price", "original_price", "ambiguous_price", "not_a_price"] },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                evidence: { type: ["string", "null"] },
                visual_evidence: {
                  type: "object",
                  properties: {
                    text_color: { type: ["string", "null"] },
                    price_block_color: { type: ["string", "null"] },
                    relative_size: { type: "string", enum: ["largest", "large", "medium", "small", "unknown"] },
                    is_crossed_out: { type: ["boolean", "null"] },
                    near_currency_symbol: { type: ["boolean", "null"] },
                    attached_unit: { type: ["string", "null"] },
                    position_hint: { type: "string", enum: ["top-left", "top-right", "center", "bottom-left", "bottom-right", "unknown"] },
                    inside_price_block: { type: ["boolean", "null"] }
                  },
                  required: ["text_color", "price_block_color", "relative_size", "is_crossed_out", "near_currency_symbol", "attached_unit", "position_hint", "inside_price_block"],
                  additionalProperties: false
                }
              },
              required: ["raw_text", "normalized_value", "currency", "visual_role", "classified_as", "confidence", "evidence", "visual_evidence"],
              additionalProperties: false
            }
          },
          size_candidates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                raw_text: { type: "string" },
                normalized_value: { type: ["number", "null"] },
                unit: { type: ["string", "null"], enum: ["liter", "milliliter", "kilogram", "gram", "piece", "inch", "dozen", "other", null] },
                classified_as: { type: "string", enum: ["each_size", "total_size", "pack_quantity", "screen_size", "quantity", "ambiguous_size"] },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                evidence: { type: ["string", "null"] },
                visual_evidence: {
                  type: "object",
                  properties: {
                    attached_unit: { type: ["string", "null"] },
                    near_product_title_or_pack: { type: ["boolean", "null"] },
                    inside_price_block: { type: ["boolean", "null"] },
                    position_hint: { type: "string", enum: ["top-left", "top-right", "center", "bottom-left", "bottom-right", "unknown"] }
                  },
                  required: ["attached_unit", "near_product_title_or_pack", "inside_price_block", "position_hint"],
                  additionalProperties: false
                }
              },
              required: ["raw_text", "normalized_value", "unit", "classified_as", "confidence", "evidence", "visual_evidence"],
              additionalProperties: false
            }
          },
          selected_prices: {
            type: "object",
            properties: {
              offer_price: { type: ["number", "null"] },
              original_price: { type: ["number", "null"] },
              currency: { type: ["string", "null"], enum: ["SAR", null] },
              offer_price_source_raw_text: { type: ["string", "null"] },
              original_price_source_raw_text: { type: ["string", "null"] },
              selection_confidence: { type: "string", enum: ["high", "medium", "low"] },
              selection_evidence: { type: ["string", "null"] }
            },
            required: ["offer_price", "original_price", "currency", "offer_price_source_raw_text", "original_price_source_raw_text", "selection_confidence", "selection_evidence"],
            additionalProperties: false
          },
          content: {
            type: "object",
            properties: {
              size_text: { type: ["string", "null"] },
              pack_quantity: { type: ["number", "null"] },
              bundle_quantity: { type: ["number", "null"] },
              each_size_value: { type: ["number", "null"] },
              each_size_unit: { type: ["string", "null"], enum: ["liter", "milliliter", "kilogram", "gram", "piece", "inch", "dozen", "other", null] },
              total_content_value: { type: ["number", "null"] },
              total_content_unit: { type: ["string", "null"], enum: ["liter", "milliliter", "kilogram", "gram", "piece", "dozen", "other", null] },
              content_confidence: { type: "string", enum: ["high", "medium", "low"] }
            },
            required: ["size_text", "pack_quantity", "bundle_quantity", "each_size_value", "each_size_unit", "total_content_value", "total_content_unit", "content_confidence"],
            additionalProperties: false
          },
          price_basis: {
            type: "object",
            properties: {
              basis: { type: "string", enum: ["each", "per_pack", "per_box", "per_bag", "per_kg", "per_2kg", "per_dozen", "bundle", "multi_buy", "unknown"] },
              raw_text: { type: ["string", "null"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              evidence: { type: ["string", "null"] }
            },
            required: ["basis", "raw_text", "confidence", "evidence"],
            additionalProperties: false
          },
          promotion: {
            type: "object",
            properties: {
              mechanic: { type: "string", enum: ["standard_price", "bogo", "bundle", "multi_buy", "loyalty_required", "selected_branches", "unknown"] },
              raw_text: { type: ["string", "null"] },
              bundle_quantity: { type: ["number", "null"] },
              condition_text: { type: ["string", "null"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              evidence: { type: ["string", "null"] }
            },
            required: ["mechanic", "raw_text", "bundle_quantity", "condition_text", "confidence", "evidence"],
            additionalProperties: false
          },
          classification_evidence: {
            type: "object",
            properties: {
              why_offer_price: { type: ["string", "null"] },
              why_original_price: { type: ["string", "null"] },
              why_size_is_not_price: { type: ["string", "null"] },
              why_publish_decision: { type: ["string", "null"] }
            },
            required: ["why_offer_price", "why_original_price", "why_size_is_not_price", "why_publish_decision"],
            additionalProperties: false
          },
          confidence: {
            type: "object",
            properties: {
              overall: { type: "string", enum: ["high", "medium", "low"] },
              product_text: { type: "string", enum: ["high", "medium", "low"] },
              offer_price: { type: "string", enum: ["high", "medium", "low"] },
              original_price: { type: "string", enum: ["high", "medium", "low"] },
              content: { type: "string", enum: ["high", "medium", "low"] },
              promotion: { type: "string", enum: ["high", "medium", "low"] }
            },
            required: ["overall", "product_text", "offer_price", "original_price", "content", "promotion"],
            additionalProperties: false
          },
          warnings: {
            type: "object",
            properties: {
              blocking: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    message: { type: "string" }
                  },
                  required: ["code", "message"],
                  additionalProperties: false
                }
              },
              non_blocking: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    message: { type: "string" }
                  },
                  required: ["code", "message"],
                  additionalProperties: false
                }
              }
            },
            required: ["blocking", "non_blocking"],
            additionalProperties: false
          },
          model_recommendation: {
            type: "object",
            properties: {
              publish_decision: { type: "string", enum: ["publish", "publish_but_exclude_from_comparison", "skip_or_quarantine"] },
              comparison_eligible: { type: "boolean" },
              comparison_exclusion_reason: { type: ["string", "null"] }
            },
            required: ["publish_decision", "comparison_eligible", "comparison_exclusion_reason"],
            additionalProperties: false
          },
          raw_attributes: {
            type: "object",
            properties: {
              additional_visible_fields: { type: "object", additionalProperties: true }
            },
            required: ["additional_visible_fields"],
            additionalProperties: false
          }
        },
        required: [
          "item_number", "product_text", "price_candidates", "size_candidates",
          "selected_prices", "content", "price_basis", "promotion",
          "classification_evidence", "confidence", "warnings", "model_recommendation",
          "raw_attributes"
        ],
        additionalProperties: false
      }
    }
  }
}
