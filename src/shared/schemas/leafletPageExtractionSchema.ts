import { z } from 'zod';

export const normalizedBox2DSchema = z.tuple([
  z.number().int().min(0).max(1000),
  z.number().int().min(0).max(1000),
  z.number().int().min(0).max(1000),
  z.number().int().min(0).max(1000)
]);

export const atomicOfferComponentsSchema = z.object({
  product_graphic_box: normalizedBox2DSchema,
  promo_price_box: normalizedBox2DSchema,
  original_price_box: normalizedBox2DSchema.nullable(),
  unit_and_size_badge_box: normalizedBox2DSchema.nullable(),
  title_text_box: normalizedBox2DSchema.nullable()
});

export const promoConditionSchema = z.enum([
  'STANDARD',
  'LOYALTY_CARD_REQUIRED',
  'MULTI_BUY'
]);

export const canonicalExtractionUnitSchema = z.enum([
  'g',
  'kg',
  'ml',
  'l',
  'pcs',
  'roll',
  'sheet'
]).nullable();

export type CanonicalExtractionUnitZod = z.infer<typeof canonicalExtractionUnitSchema>;

export const itemDomainRev1Schema = z.enum([
  'grocery',
  'electronics',
  'appliance',
  'health_beauty',
  'household',
  'other_non_grocery'
]).optional().default('grocery');

export const categorySlugRev1Schema = z.enum([
  'staples',
  'dairy',
  'eggs',
  'meat-chicken',
  'frozen',
  'baby',
  'cleaning',
  'personal-care',
  'beverages',
  'coffee-tea',
  'snacks',
  'canned-food',
  'non-grocery'
]).nullable().optional();

export const extractedOfferRev1Schema = z.object({
  offer_number: z.number().int().positive(),
  arabic_title: z.string().min(1),
  english_title: z.string().min(1),
  brand: z.string().nullable(),
  is_multi_brand_or_variant: z.boolean(),
  compound_group_id: z.string().nullable().optional(),
  item_domain: itemDomainRev1Schema,
  category_slug: categorySlugRev1Schema,
  normalized_product_name_ar: z.string().nullable().optional(),
  normalized_product_name_en: z.string().nullable().optional(),
  commodity_tag: z.string().nullable().optional(),
  quantity_limit: z.string().nullable().optional(),
  size_value: z.string().nullable(),
  unit_type: z.string().nullable(),
  pack_quantity: z.number().int().positive().nullable().optional().default(1),
  each_size_value: z.number().positive().nullable().optional(),
  each_size_unit: canonicalExtractionUnitSchema.optional(),
  is_uniform_size_across_variants: z.boolean().optional().default(true),
  promo_price: z.number().positive(),
  original_price: z.number().positive().nullable(),
  promo_condition: promoConditionSchema,
  confidence: z.number().min(0).max(1),
  components: atomicOfferComponentsSchema
});

export const leafletPageExtractionSchema = z.object({
  is_loyalty_page: z.boolean(),
  loyalty_program_name: z.string().nullable(),
  validity_start_date: z.string().nullable(),
  validity_end_date: z.string().nullable(),
  ignored_banners: z.array(z.string()),
  offers: z.array(extractedOfferRev1Schema)
});

export type LeafletPageExtractionZod = z.infer<typeof leafletPageExtractionSchema>;

/**
 * Returns JSON Schema definition compatible with @google/genai responseSchema
 */
export function getLeafletPageGenAiSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      is_loyalty_page: { type: 'boolean' },
      loyalty_program_name: { type: 'string', nullable: true },
      validity_start_date: { type: 'string', nullable: true },
      validity_end_date: { type: 'string', nullable: true },
      ignored_banners: {
        type: 'array',
        items: { type: 'string' }
      },
      offers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            offer_number: { type: 'integer' },
            arabic_title: { type: 'string' },
            english_title: { type: 'string' },
            brand: { type: 'string', nullable: true },
            is_multi_brand_or_variant: { type: 'boolean' },
            compound_group_id: {
              type: 'string',
              nullable: true,
              description: 'Optional group ID if multiple offers share a compound product cell/title (e.g. cell_1)'
            },
            item_domain: {
              type: 'string',
              enum: ['grocery', 'electronics', 'appliance', 'health_beauty', 'household', 'other_non_grocery'],
              description: 'Item domain category: "grocery", "electronics", "appliance", "health_beauty", "household", or "other_non_grocery".'
            },
            category_slug: {
              type: 'string',
              enum: [
                'staples',
                'dairy',
                'eggs',
                'meat-chicken',
                'frozen',
                'baby',
                'cleaning',
                'personal-care',
                'beverages',
                'coffee-tea',
                'snacks',
                'canned-food',
                'non-grocery'
              ],
              description: 'Exact category: staples, dairy, eggs, meat-chicken, frozen, baby, cleaning, personal-care, beverages, coffee-tea, snacks, canned-food, non-grocery.'
            },
            normalized_product_name_ar: {
              type: 'string',
              description: 'Clean brand + core product name in Arabic, stripped of pack size, price, and promo words'
            },
            normalized_product_name_en: {
              type: 'string',
              description: 'Clean brand + core product name in English, stripped of size and promo words'
            },
            commodity_tag: {
              type: 'string',
              description: 'Lowercase snake_case generic grocery commodity tag (e.g. basmati_rice, cooking_oil, uht_milk, fresh_milk, white_eggs, whole_chicken, chicken_breast, laundry_detergent, dishwashing_liquid, facial_tissue, canned_tuna, instant_noodles, potato_chips, drinking_water, bath_soap, shampoo)'
            },
            quantity_limit: {
              type: 'string',
              nullable: true,
              description: 'Customer purchase limit badge if printed (e.g. "2 Offers only Per Customer", "Max 2 per customer", "٢ حبة لكل عميل")'
            },
            size_value: { type: 'string', nullable: true },
            unit_type: { type: 'string', nullable: true },
            pack_quantity: {
              type: 'integer',
              description: 'Number of individual items in the pack (default 1). E.g. for "10 x 900g" or "900gmx10", pack_quantity is 10. For "30s" / "30 eggs", pack_quantity is 1.'
            },
            each_size_value: {
              type: 'number',
              nullable: true,
              description: 'Numeric weight, volume, or count of a single unit. E.g. 900 for "900gmx10", 155 for "155gm x 2", 30 for "30s" / "30 PCS".'
            },
            each_size_unit: {
              type: 'string',
              enum: ['g', 'kg', 'ml', 'l', 'pcs', 'roll', 'sheet'],
              nullable: true,
              description: 'Canonical unit for each item: g, kg, ml, l, pcs, roll, or sheet.'
            },
            is_uniform_size_across_variants: {
              type: 'boolean',
              description: 'True if all items/variants share the same package weight/volume. False only if variants have significantly differing package sizes.'
            },
            promo_price: { type: 'number' },
            original_price: { type: 'number', nullable: true },
            promo_condition: {
              type: 'string',
              enum: ['STANDARD', 'LOYALTY_CARD_REQUIRED', 'MULTI_BUY']
            },
            confidence: { type: 'number' },
            components: {
              type: 'object',
              properties: {
                product_graphic_box: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: '[ymin, xmin, ymax, xmax] normalized 0-1000'
                },
                promo_price_box: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: '[ymin, xmin, ymax, xmax] normalized 0-1000'
                },
                original_price_box: {
                  type: 'array',
                  items: { type: 'integer' },
                  nullable: true,
                  description: '[ymin, xmin, ymax, xmax] normalized 0-1000'
                },
                unit_and_size_badge_box: {
                  type: 'array',
                  items: { type: 'integer' },
                  nullable: true,
                  description: '[ymin, xmin, ymax, xmax] normalized 0-1000'
                },
                title_text_box: {
                  type: 'array',
                  items: { type: 'integer' },
                  nullable: true,
                  description: '[ymin, xmin, ymax, xmax] normalized 0-1000'
                }
              },
              required: ['product_graphic_box', 'promo_price_box', 'title_text_box']
            }
          },
          required: [
            'offer_number',
            'arabic_title',
            'english_title',
            'is_multi_brand_or_variant',
            'promo_price',
            'promo_condition',
            'confidence',
            'components'
          ]
        }
      }
    },
    required: ['is_loyalty_page', 'ignored_banners', 'offers']
  };
}
