import { z } from 'zod'

export const minimalOcrItemSchema = z.object({
  item_number: z.string(),
  name_ar: z.string().nullable(),
  name_en: z.string().nullable(),
  description_ar: z.string().nullable(),
  description_en: z.string().nullable(),
  offer_price: z.number().nullable(),
  original_price: z.number().nullable(),
  size: z.object({
    value: z.number().nullable(),
    unit: z.string().nullable(),
    text: z.string().nullable(),
  }).strict(),
  pack_quantity: z.number().nullable(),
  bundle_quantity: z.number().nullable(),
  special_offer: z.string().nullable(),
}).strict()

export const minimalOcrResponseSchema = z.object({
  page_number: z.number(),
  item_count: z.number(),
  items: z.array(minimalOcrItemSchema)
}).strict()
