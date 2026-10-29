import { z } from 'zod';

export const styleConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const relativeSizeSchema = z.enum(['largest', 'large', 'medium', 'small', 'mixed', 'unknown']);

export const offerPricePatternSchema = z.object({
  description: z.string(),
  color_notes: z.string().nullable().optional(),
  price_block_color: z.string().nullable().optional(),
  relative_size: relativeSizeSchema,
  position_notes: z.string().nullable().optional(),
  sar_symbol_notes: z.string().nullable().optional(),
  examples: z.array(z.string()),
  confidence: styleConfidenceSchema,
});

export const originalPricePatternSchema = z.object({
  description: z.string(),
  color_notes: z.string().nullable().optional(),
  relative_size: relativeSizeSchema,
  crossed_out_notes: z.string().nullable().optional(),
  position_notes: z.string().nullable().optional(),
  examples: z.array(z.string()),
  confidence: styleConfidenceSchema,
});

export const sizePatternSchema = z.object({
  description: z.string(),
  unit_examples: z.array(z.string()),
  position_notes: z.string().nullable().optional(),
  near_product_text_notes: z.string().nullable().optional(),
  inside_price_block_notes: z.string().nullable().optional(),
  confidence: styleConfidenceSchema,
});

export const promotionPatternSchema = z.object({
  description: z.string(),
  examples: z.array(z.string()),
  position_notes: z.string().nullable().optional(),
  visual_notes: z.string().nullable().optional(),
  confidence: styleConfidenceSchema,
});

export const conditionPatternSchema = z.object({
  description: z.string(),
  examples: z.array(z.string()),
  position_notes: z.string().nullable().optional(),
  confidence: styleConfidenceSchema,
});

export const nonPriceAttributePatternSchema = z.object({
  description: z.string(),
  examples: z.array(z.string()),
  attribute_type: z.enum(['screen_size', 'resolution', 'pack_quantity', 'product_feature', 'other']),
  confidence: styleConfidenceSchema,
});

export const styleWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const leafletStyleProfileModelSchema = z.object({
  confidence: styleConfidenceSchema,
  offer_price_patterns: z.array(offerPricePatternSchema).default([]),
  original_price_patterns: z.array(originalPricePatternSchema).default([]),
  size_patterns: z.array(sizePatternSchema).default([]),
  promotion_patterns: z.array(promotionPatternSchema).default([]),
  condition_patterns: z.array(conditionPatternSchema).default([]),
  non_price_attribute_patterns: z.array(nonPriceAttributePatternSchema).default([]),
  warnings: z.array(styleWarningSchema).default([]),
  notes: z.array(z.string()).default([]),
}).strict(); // Strict at the top level to reject arbitrary keys from Mistral

export const buildStyleProfileJsonSchema = () => {
  return {
    type: "object",
    properties: {
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      offer_price_patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            color_notes: { type: ["string", "null"] },
            price_block_color: { type: ["string", "null"] },
            relative_size: { type: "string", enum: ["largest", "large", "medium", "small", "mixed", "unknown"] },
            position_notes: { type: ["string", "null"] },
            sar_symbol_notes: { type: ["string", "null"] },
            examples: { type: "array", items: { type: "string" } },
            confidence: { type: "string", enum: ["high", "medium", "low"] }
          },
          required: ["description", "relative_size", "examples", "confidence"]
        }
      },
      original_price_patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            color_notes: { type: ["string", "null"] },
            relative_size: { type: "string", enum: ["largest", "large", "medium", "small", "mixed", "unknown"] },
            crossed_out_notes: { type: ["string", "null"] },
            position_notes: { type: ["string", "null"] },
            examples: { type: "array", items: { type: "string" } },
            confidence: { type: "string", enum: ["high", "medium", "low"] }
          },
          required: ["description", "relative_size", "examples", "confidence"]
        }
      },
      size_patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            unit_examples: { type: "array", items: { type: "string" } },
            position_notes: { type: ["string", "null"] },
            near_product_text_notes: { type: ["string", "null"] },
            inside_price_block_notes: { type: ["string", "null"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] }
          },
          required: ["description", "unit_examples", "confidence"]
        }
      },
      promotion_patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            examples: { type: "array", items: { type: "string" } },
            position_notes: { type: ["string", "null"] },
            visual_notes: { type: ["string", "null"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] }
          },
          required: ["description", "examples", "confidence"]
        }
      },
      condition_patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            examples: { type: "array", items: { type: "string" } },
            position_notes: { type: ["string", "null"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] }
          },
          required: ["description", "examples", "confidence"]
        }
      },
      non_price_attribute_patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            examples: { type: "array", items: { type: "string" } },
            attribute_type: { type: "string", enum: ["screen_size", "resolution", "pack_quantity", "product_feature", "other"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] }
          },
          required: ["description", "examples", "attribute_type", "confidence"]
        }
      },
      warnings: {
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
      notes: { type: "array", items: { type: "string" } }
    },
    required: [
      "confidence",
      "offer_price_patterns",
      "original_price_patterns",
      "size_patterns",
      "promotion_patterns",
      "condition_patterns",
      "non_price_attribute_patterns",
      "warnings",
      "notes"
    ],
    additionalProperties: false
  };
};
