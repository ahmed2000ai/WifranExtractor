import { z } from 'zod'

export const ocrBoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})

export const ocrExtractedItemSchema = z.object({
  row_id: z.string().default(() => Math.random().toString(36).substring(2, 9)),
  page_number: z.number().int().positive().default(1),

  product_name_ar: z.string().nullable().default(null),
  product_name_en: z.string().nullable().default(null),

  brand_name_ar: z.string().nullable().default(null),
  brand_name_en: z.string().nullable().default(null),

  category_name_ar: z.string().nullable().default(null),
  category_name_en: z.string().nullable().default(null),

  description_ar: z.string().nullable().default(null),
  description_en: z.string().nullable().default(null),

  offer_price: z.union([z.number(), z.string()]).nullable().default(null),
  original_price: z.union([z.number(), z.string()]).nullable().default(null),
  discount_text: z.string().nullable().default(null),

  pack_size_value: z.union([z.number(), z.string()]).nullable().default(null),
  pack_size_unit: z.string().nullable().default(null),
  pack_quantity: z.union([z.number(), z.string()]).nullable().default(null),

  notes_ar: z.string().nullable().default(null),
  notes_en: z.string().nullable().default(null),
  image_id: z.string().nullable().default(null),

  bounding_box: ocrBoundingBoxSchema.nullable().default(null),

  confidence: z.number().min(0).max(1).nullable().default(null),
  warnings: z.array(z.string()).default([])
}).passthrough()

export const ocrExtractionResponseSchema = z.object({
  items: z.array(ocrExtractedItemSchema).default([])
})
