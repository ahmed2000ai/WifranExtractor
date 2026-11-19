import { z } from 'zod';

export const styleAwareValidationModelSchema = z.object({
  validation_result: z.enum(['pass', 'fail', 'corrected']),
  
  corrected_fields: z.object({
    offer_price: z.number().nullable(),
    original_price: z.number().nullable(),
    size_text: z.string().nullable(),
    pack_quantity: z.number().nullable(),
    bundle_quantity: z.number().nullable(),
    price_basis: z.enum([
      'each', 'per_pack', 'per_box', 'per_bag', 'per_kg', 'per_2kg', 
      'per_dozen', 'bundle', 'multi_buy', 'unknown'
    ]).nullable(),
    promotion_mechanic: z.enum([
      'standard_price', 'bogo', 'bundle', 'multi_buy', 
      'loyalty_required', 'selected_branches', 'unknown'
    ]).nullable(),
  }),

  blocking_errors: z.array(z.object({
    code: z.string(),
    message: z.string()
  })).default([]),

  non_blocking_warnings: z.array(z.object({
    code: z.string(),
    message: z.string()
  })).default([]),

  comparison: z.object({
    comparison_eligible: z.boolean().nullable(),
    comparison_exclusion_reason: z.string().nullable(),
    comparison_confidence: z.enum(['high', 'medium', 'low']),
  }),

  visual_evidence: z.object({
    offer_price: z.object({
      explanation: z.string().nullable(),
      text_color: z.string().nullable(),
      price_block_color: z.string().nullable(),
      relative_size: z.enum(['largest', 'large', 'medium', 'small', 'unknown']).nullable(),
      is_crossed_out: z.boolean().nullable(),
      near_currency_symbol: z.boolean().nullable().optional().default(null),
      position_hint: z.string().nullable(),
    }),
    original_price: z.object({
      explanation: z.string().nullable(),
      is_crossed_out: z.boolean().nullable(),
      relative_size: z.string().nullable(),
      position_hint: z.string().nullable(),
    }),
    size: z.object({
      explanation: z.string().nullable(),
      attached_unit: z.string().nullable(),
      near_product_title_or_pack: z.boolean().nullable(),
    }),
    promotion: z.object({
      explanation: z.string().nullable(),
    }),
  }),

  publish_decision: z.enum([
    'publish',
    'publish_but_exclude_from_comparison',
    'skip_or_quarantine'
  ]),

  confidence: z.enum(['high', 'medium', 'low']),
}).strict(); // strict top level

export const buildStyleAwareValidationJsonSchema = () => {
  return {
    type: "object",
    properties: {
      validation_result: { type: "string", enum: ["pass", "fail", "corrected"] },
      corrected_fields: {
        type: "object",
        properties: {
          offer_price: { type: ["number", "null"] },
          original_price: { type: ["number", "null"] },
          size_text: { type: ["string", "null"] },
          pack_quantity: { type: ["number", "null"] },
          bundle_quantity: { type: ["number", "null"] },
          price_basis: { type: ["string", "null"], enum: ["each", "per_pack", "per_box", "per_bag", "per_kg", "per_2kg", "per_dozen", "bundle", "multi_buy", "unknown", null] },
          promotion_mechanic: { type: ["string", "null"], enum: ["standard_price", "bogo", "bundle", "multi_buy", "unknown", null] }
        },
        required: ["offer_price", "original_price", "size_text", "pack_quantity", "bundle_quantity", "price_basis", "promotion_mechanic"]
      },
      blocking_errors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: "string" },
            message: { type: "string" }
          },
          required: ["code", "message"]
        }
      },
      non_blocking_warnings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: "string" },
            message: { type: "string" }
          },
          required: ["code", "message"]
        }
      },
      comparison: {
        type: "object",
        properties: {
          comparison_eligible: { type: ["boolean", "null"] },
          comparison_exclusion_reason: { type: ["string", "null"] },
          comparison_confidence: { type: "string", enum: ["high", "medium", "low"] }
        },
        required: ["comparison_eligible", "comparison_exclusion_reason", "comparison_confidence"]
      },
      visual_evidence: {
        type: "object",
        properties: {
          offer_price: {
            type: "object",
            properties: {
              explanation: { type: ["string", "null"] },
              text_color: { type: ["string", "null"] },
              price_block_color: { type: ["string", "null"] },
              relative_size: { type: ["string", "null"], enum: ["largest", "large", "medium", "small", "unknown", null] },
              is_crossed_out: { type: ["boolean", "null"] },
              position_hint: { type: ["string", "null"] }
            },
            required: ["explanation", "text_color", "price_block_color", "relative_size", "is_crossed_out", "position_hint"]
          },
          original_price: {
            type: "object",
            properties: {
              explanation: { type: ["string", "null"] },
              is_crossed_out: { type: ["boolean", "null"] },
              relative_size: { type: ["string", "null"] },
              position_hint: { type: ["string", "null"] }
            },
            required: ["explanation", "is_crossed_out", "relative_size", "position_hint"]
          },
          size: {
            type: "object",
            properties: {
              explanation: { type: ["string", "null"] },
              attached_unit: { type: ["string", "null"] },
              near_product_title_or_pack: { type: ["boolean", "null"] }
            },
            required: ["explanation", "attached_unit", "near_product_title_or_pack"]
          },
          promotion: {
            type: "object",
            properties: {
              explanation: { type: ["string", "null"] }
            },
            required: ["explanation"]
          }
        },
        required: ["offer_price", "original_price", "size", "promotion"]
      },
      publish_decision: { type: "string", enum: ["publish", "publish_but_exclude_from_comparison", "skip_or_quarantine"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] }
    },
    required: [
      "validation_result",
      "corrected_fields",
      "blocking_errors",
      "non_blocking_warnings",
      "comparison",
      "visual_evidence",
      "publish_decision",
      "confidence"
    ],
    additionalProperties: false
  };
};
