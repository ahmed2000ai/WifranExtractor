import { z } from 'zod';
import type {
  AtomicOfferComponents,
  ExtractedOfferRev1,
  LeafletPageExtractionRev1,
  NormalizedBox2D,
  PromoCondition
} from '../types/leafletExtraction';

export const COMPACT_SINGLE_LETTER_SCHEMA_VERSION = 'compact_v1' as const;
export const SUPPORTED_LEAFLET_SCHEMA_VERSIONS = ['legacy', 'optimized', 'compact_v1'] as const;

export type LeafletSchemaVersion = 'legacy' | 'optimized' | 'compact_v1';
export type LeafletPromptProfile = 'legacy' | 'optimized' | 'master_quality' | 'compact_v1' | 'legacy_compact_v1';
export type LeafletSchemaProfile = 'legacy' | 'optimized' | 'compact_v1';

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
  'MULTI_BUY',
  'UNKNOWN'
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
  promo_condition: promoConditionSchema.optional().nullable(),
  confidence: z.number().min(0).max(1),
  components: atomicOfferComponentsSchema
});

export const leafletPageExtractionSchema = z.object({
  is_loyalty_page: z.boolean().optional().default(false),
  loyalty_program_name: z.string().nullable().optional().default(null),
  validity_start_date: z.string().nullable().optional().default(null),
  validity_end_date: z.string().nullable().optional().default(null),
  ignored_banners: z.array(z.string()).optional().default([]),
  offers: z.array(extractedOfferRev1Schema)
});

export type LeafletPageExtractionZod = z.infer<typeof leafletPageExtractionSchema>;

// --- Strategy B: Compact Schema & Zod Validators ---

export const compactBoundingBoxesSchema = z.object({
  g: normalizedBox2DSchema,
  p: normalizedBox2DSchema,
  t: normalizedBox2DSchema.nullable(),
  r: normalizedBox2DSchema.nullable().optional(),
  u: normalizedBox2DSchema.nullable().optional()
});

export const compactOfferSchema = z.object({
  n: z.number().int().positive(),
  ar: z.string(),
  en: z.string(),
  b: z.string().nullable().optional(),
  m: z.boolean().optional().default(false),
  grp: z.string().nullable().optional(),
  p: z.number().positive(),
  op: z.number().positive().nullable().optional(),
  sz: z.string().nullable().optional(),
  ut: z.string().nullable().optional(),
  pq: z.number().int().positive().nullable().optional().default(1),
  ev: z.number().positive().nullable().optional(),
  eu: canonicalExtractionUnitSchema.optional(),
  u_sz: z.boolean().optional().default(true),
  c: z.number().min(0).max(1).optional().default(1.0),
  b2d: compactBoundingBoxesSchema
});

export const compactLeafletPageSchema = z.object({
  offers: z.array(compactOfferSchema)
});

export type CompactLeafletPageZod = z.infer<typeof compactLeafletPageSchema>;

/**
 * Returns JSON Schema definition compatible with @google/genai responseSchema (Legacy format)
 */
export function getLegacyLeafletPageGenAiSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
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
            'confidence',
            'components'
          ]
        }
      }
    },
    required: ['ignored_banners', 'offers']
  };
}

/**
 * Returns JSON Schema definition compatible with @google/genai responseSchema (Optimized Strategy B format)
 * Eliminates locally derivable fields, page-level condition metadata, and uses compact bounding box keys (g, p, t, r, u).
 */
export function getOptimizedLeafletPageGenAiSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      offers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer', description: 'Offer index on page (1-based integer)' },
            ar: { type: 'string', description: 'Verbatim printed Arabic product title and description' },
            en: { type: 'string', description: 'Verbatim printed English product title and description' },
            b: { type: 'string', nullable: true, description: 'Brand name or null' },
            m: { type: 'boolean', description: 'True if multiple brands/variants are grouped in this cell' },
            grp: {
              type: 'string',
              nullable: true,
              description: 'Shared compound cell group ID (e.g. cell_1) or null'
            },
            p: { type: 'number', description: 'Promotional primary offer price' },
            op: { type: 'number', nullable: true, description: 'Secondary/original crossed-out price or null' },
            sz: { type: 'string', nullable: true, description: 'Printed size text (e.g. 270g, 10x900g, 2 Kg) or null' },
            ut: { type: 'string', nullable: true, description: 'Printed unit badge (e.g. Each / للحبة, Kg / كيلو) or null' },
            pq: {
              type: 'integer',
              nullable: true,
              description: 'Physical pack quantity (default 1)'
            },
            ev: {
              type: 'number',
              nullable: true,
              description: 'Single item numeric size/weight/volume'
            },
            eu: {
              type: 'string',
              enum: ['g', 'kg', 'ml', 'l', 'pcs', 'roll', 'sheet'],
              nullable: true,
              description: 'Canonical unit for single item'
            },
            u_sz: {
              type: 'boolean',
              description: 'True if all variants share uniform package size'
            },
            c: { type: 'number', description: 'Extraction confidence score 0.0 to 1.0' },
            b2d: {
              type: 'object',
              properties: {
                g: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: '[ymin, xmin, ymax, xmax] product graphic box normalized 0..1000'
                },
                p: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: '[ymin, xmin, ymax, xmax] promo price box normalized 0..1000'
                },
                t: {
                  type: 'array',
                  items: { type: 'integer' },
                  nullable: true,
                  description: '[ymin, xmin, ymax, xmax] printed title text box normalized 0..1000'
                },
                r: {
                  type: 'array',
                  items: { type: 'integer' },
                  nullable: true,
                  description: '[ymin, xmin, ymax, xmax] original/reference price box normalized 0..1000 or null'
                },
                u: {
                  type: 'array',
                  items: { type: 'integer' },
                  nullable: true,
                  description: '[ymin, xmin, ymax, xmax] unit/size badge box normalized 0..1000 or null'
                }
              },
              required: ['g', 'p', 't']
            }
          },
          required: ['n', 'ar', 'en', 'm', 'p', 'c', 'b2d']
        }
      }
    },
    required: ['offers']
  };
}

// ============================================================================
// WIFRAN-EXTRACTOR-GEMINI-OPT-001: Single-Letter Lossless Schema (compact_v1)
// ============================================================================

/**
 * Explicit 1-character key dictionary for top-level page fields (`compact_v1`).
 */
export const COMPACT_V1_PAGE_KEY_MAP = {
  l: 'is_loyalty_page',
  p: 'loyalty_program_name',
  s: 'validity_start_date',
  e: 'validity_end_date',
  b: 'ignored_banners',
  o: 'offers'
} as const;

/**
 * Explicit 1-character key dictionary for offer-level fields (`compact_v1`, keys `a`..`w`).
 */
export const COMPACT_V1_OFFER_KEY_MAP = {
  a: 'offer_number',
  b: 'arabic_title',
  c: 'english_title',
  d: 'brand',
  e: 'is_multi_brand_or_variant',
  f: 'compound_group_id',
  g: 'item_domain',
  h: 'category_slug',
  i: 'normalized_product_name_ar',
  j: 'normalized_product_name_en',
  k: 'commodity_tag',
  l: 'quantity_limit',
  m: 'size_value',
  n: 'unit_type',
  o: 'pack_quantity',
  p: 'each_size_value',
  q: 'each_size_unit',
  r: 'is_uniform_size_across_variants',
  s: 'promo_price',
  t: 'original_price',
  u: 'promo_condition',
  v: 'confidence',
  w: 'components'
} as const;

/**
 * Explicit 1-character key dictionary for nested 2D bounding box components (`compact_v1`).
 */
export const COMPACT_V1_COMPONENT_KEY_MAP = {
  g: 'product_graphic_box',
  p: 'promo_price_box',
  r: 'original_price_box',
  u: 'unit_and_size_badge_box',
  t: 'title_text_box'
} as const;

export const compactSingleLetterComponentsSchema = z.object({
  g: normalizedBox2DSchema,
  p: normalizedBox2DSchema,
  r: normalizedBox2DSchema.nullable(),
  u: normalizedBox2DSchema.nullable(),
  t: normalizedBox2DSchema.nullable()
});

export const compactSingleLetterOfferSchema = z.object({
  a: z.number().int().positive(),
  b: z.string(),
  c: z.string(),
  d: z.string().nullable(),
  e: z.boolean(),
  f: z.string().nullable().optional().default(null),
  g: z.enum([
    'grocery',
    'electronics',
    'appliance',
    'health_beauty',
    'household',
    'other_non_grocery'
  ]).optional().default('grocery'),
  h: categorySlugRev1Schema.optional().default(null),
  i: z.string().nullable().optional().default(null),
  j: z.string().nullable().optional().default(null),
  k: z.string().nullable().optional().default(null),
  l: z.string().nullable().optional().default(null),
  m: z.string().nullable(),
  n: z.string().nullable(),
  o: z.number().int().positive(),
  p: z.number().positive().nullable(),
  q: canonicalExtractionUnitSchema,
  r: z.boolean(),
  s: z.number().positive(),
  t: z.number().positive().nullable(),
  u: promoConditionSchema.nullable().optional().default(null),
  v: z.number().min(0).max(1),
  w: compactSingleLetterComponentsSchema
});

export const compactSingleLetterLeafletPageSchema = z.object({
  l: z.boolean().optional().default(false),
  p: z.string().nullable().optional().default(null),
  s: z.string().nullable(),
  e: z.string().nullable(),
  b: z.array(z.string()),
  o: z.array(compactSingleLetterOfferSchema)
});

export type CompactSingleLetterComponentsV1 = z.infer<typeof compactSingleLetterComponentsSchema>;
export type CompactSingleLetterOfferV1 = z.infer<typeof compactSingleLetterOfferSchema>;
export type CompactSingleLetterLeafletPageV1 = z.infer<typeof compactSingleLetterLeafletPageSchema>;

/**
 * Returns the versioned single-letter JSON Schema (`compact_v1`) compatible with @google/genai responseSchema.
 * Every top-level, offer-level, and nested component key is strictly a 1-character lowercase ASCII letter (`a`–`z`),
 * preserving 100% of fields from the legacy schema with concise property descriptions.
 */
export function getCompactSingleLetterLeafletPageGenAiSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      s: { type: 'string', nullable: true, description: 'validity_start_date (YYYY-MM-DD)' },
      e: { type: 'string', nullable: true, description: 'validity_end_date (YYYY-MM-DD)' },
      b: {
        type: 'array',
        items: { type: 'string' },
        description: 'ignored_banners'
      },
      o: {
        type: 'array',
        description: 'offers',
        items: {
          type: 'object',
          properties: {
            a: { type: 'integer', description: 'offer_number (1-based)' },
            b: { type: 'string', description: 'arabic_title (verbatim)' },
            c: { type: 'string', description: 'english_title (verbatim)' },
            d: { type: 'string', nullable: true, description: 'brand (manufacturer or null)' },
            e: { type: 'boolean', description: 'is_multi_brand_or_variant' },
            f: { type: 'string', nullable: true, description: 'compound_group_id' },
            g: {
              type: 'string',
              enum: ['grocery', 'electronics', 'appliance', 'health_beauty', 'household', 'other_non_grocery'],
              description: 'item_domain'
            },
            h: {
              type: 'string',
              nullable: true,
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
              description: 'category_slug'
            },
            i: { type: 'string', nullable: true, description: 'normalized_product_name_ar' },
            j: { type: 'string', nullable: true, description: 'normalized_product_name_en' },
            k: { type: 'string', nullable: true, description: 'commodity_tag (snake_case)' },
            m: { type: 'string', nullable: true, description: 'size_value (printed size text)' },
            n: { type: 'string', nullable: true, description: 'unit_type (printed selling unit/pack badge)' },
            o: { type: 'integer', description: 'pack_quantity (included inner unit count for promo_price s)' },
            p: { type: 'number', nullable: true, description: 'each_size_value (numeric size of 1 inner unit)' },
            q: {
              type: 'string',
              nullable: true,
              enum: ['g', 'kg', 'ml', 'l', 'pcs', 'roll', 'sheet'],
              description: 'each_size_unit'
            },
            r: { type: 'boolean', description: 'is_uniform_size_across_variants' },
            s: { type: 'number', description: 'promo_price (active price)' },
            t: { type: 'number', nullable: true, description: 'original_price (strikethrough price > s, or null)' },
            v: { type: 'number', description: 'confidence (0..1)' },
            w: {
              type: 'object',
              description: 'components ([ymin, xmin, ymax, xmax] in 0..1000)',
              properties: {
                g: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: 'product_graphic_box'
                },
                p: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: 'promo_price_box'
                },
                r: {
                  type: 'array',
                  items: { type: 'integer' },
                  nullable: true,
                  description: 'original_price_box'
                },
                u: {
                  type: 'array',
                  items: { type: 'integer' },
                  nullable: true,
                  description: 'unit_and_size_badge_box'
                },
                t: {
                  type: 'array',
                  items: { type: 'integer' },
                  nullable: true,
                  description: 'title_text_box'
                }
              },
              required: ['g', 'p', 'r', 'u', 't']
            }
          },
          required: [
            'a',
            'b',
            'c',
            'd',
            'e',
            'f',
            'g',
            'h',
            'i',
            'j',
            'k',
            'm',
            'n',
            'o',
            'p',
            'q',
            'r',
            's',
            't',
            'v',
            'w'
          ]
        }
      }
    },
    required: ['s', 'e', 'b', 'o']
  };
}

/**
 * Deterministically encodes a full `LeafletPageExtractionRev1` object into the
 * versioned single-letter `compact_v1` wire format with zero information loss.
 */
export function encodeToCompactSingleLetterPageExtraction(
  extraction: LeafletPageExtractionRev1
): CompactSingleLetterLeafletPageV1 {
  return {
    l: Boolean(extraction.is_loyalty_page),
    p: extraction.loyalty_program_name ?? null,
    s: extraction.validity_start_date ?? null,
    e: extraction.validity_end_date ?? null,
    b: Array.isArray(extraction.ignored_banners) ? [...extraction.ignored_banners] : [],
    o: (extraction.offers || []).map((offer) => ({
      a: offer.offer_number,
      b: offer.arabic_title,
      c: offer.english_title,
      d: offer.brand ?? null,
      e: Boolean(offer.is_multi_brand_or_variant),
      f: offer.compound_group_id ?? null,
      g: offer.item_domain ?? 'grocery',
      h: offer.category_slug ?? null,
      i: offer.normalized_product_name_ar ?? null,
      j: offer.normalized_product_name_en ?? null,
      k: offer.commodity_tag ?? null,
      l: offer.quantity_limit ?? null,
      m: offer.size_value ?? null,
      n: offer.unit_type ?? null,
      o: offer.pack_quantity ?? 1,
      p: offer.each_size_value ?? null,
      q: offer.each_size_unit ?? null,
      r: offer.is_uniform_size_across_variants ?? true,
      s: offer.promo_price,
      t: offer.original_price ?? null,
      u: offer.promo_condition ?? null,
      v: offer.confidence,
      w: {
        g: [...offer.components.product_graphic_box] as NormalizedBox2D,
        p: [...offer.components.promo_price_box] as NormalizedBox2D,
        r: offer.components.original_price_box
          ? ([...offer.components.original_price_box] as NormalizedBox2D)
          : null,
        u: offer.components.unit_and_size_badge_box
          ? ([...offer.components.unit_and_size_badge_box] as NormalizedBox2D)
          : null,
        t: offer.components.title_text_box
          ? ([...offer.components.title_text_box] as NormalizedBox2D)
          : null
      }
    }))
  };
}

/**
 * Strictly validates and losslessly decodes a `compact_v1` single-letter Gemini response
 * into the internal `LeafletPageExtractionRev1` structure.
 * Fails closed if required fields are missing, types are invalid, or a legacy payload is supplied.
 */
export function decodeCompactSingleLetterPageExtraction(
  rawJson: unknown
): LeafletPageExtractionRev1 {
  if (!rawJson || typeof rawJson !== 'object' || Array.isArray(rawJson)) {
    throw new Error('DECODER_INVALID_PAYLOAD: Compact extraction response must be a JSON object.');
  }

  const obj = rawJson as Record<string, unknown>;
  if ('offers' in obj && !('o' in obj)) {
    throw new Error(
      'DECODER_SCHEMA_MISMATCH: Expected compact_v1 single-letter payload (key "o"), but received legacy/optimized payload with "offers".'
    );
  }

  const parsed = compactSingleLetterLeafletPageSchema.safeParse(rawJson);
  if (!parsed.success) {
    const issueSummary = parsed.error.issues
      .map((iss) => `${iss.path.join('.') || '<root>'}: ${iss.message}`)
      .join('; ');
    throw new Error(`DECODER_COMPACT_V1_VALIDATION_FAILED: ${issueSummary}`);
  }

  const data = parsed.data;
  const offers: ExtractedOfferRev1[] = data.o.map((item) => {
    if (!item.b.trim() && !item.c.trim()) {
      throw new Error(
        `DECODER_COMPACT_V1_EMPTY_TITLES: Offer #${item.a} has empty Arabic and English titles.`
      );
    }
    return {
      offer_number: item.a,
      arabic_title: item.b,
      english_title: item.c,
      brand: item.d ?? null,
      is_multi_brand_or_variant: item.e,
      compound_group_id: item.f ?? null,
      item_domain: item.g,
      category_slug: item.h ?? null,
      normalized_product_name_ar: item.i ?? null,
      normalized_product_name_en: item.j ?? null,
      commodity_tag: item.k ?? null,
      quantity_limit: item.l ?? null,
      size_value: item.m ?? null,
      unit_type: item.n ?? null,
      pack_quantity: item.o,
      each_size_value: item.p ?? null,
      each_size_unit: item.q ?? null,
      is_uniform_size_across_variants: item.r,
      promo_price: item.s,
      original_price: item.t ?? null,
      promo_condition: item.u ?? null,
      confidence: item.v,
      components: {
        product_graphic_box: item.w.g,
        promo_price_box: item.w.p,
        original_price_box: item.w.r ?? null,
        unit_and_size_badge_box: item.w.u ?? null,
        title_text_box: item.w.t ?? null
      }
    };
  });

  return {
    is_loyalty_page: data.l,
    loyalty_program_name: data.p ?? null,
    validity_start_date: data.s ?? null,
    validity_end_date: data.e ?? null,
    ignored_banners: data.b,
    offers
  };
}

/**
 * Returns JSON Schema definition compatible with @google/genai responseSchema.
 * Operational default is 'legacy' until final acceptance.
 * Supports independent schema selection ('legacy', 'optimized', or 'compact_v1').
 */
export function getLeafletPageGenAiSchema(
  versionOrProfile: LeafletSchemaProfile | LeafletSchemaVersion = 'legacy'
): Record<string, unknown> {
  if (versionOrProfile === 'compact_v1') {
    return getCompactSingleLetterLeafletPageGenAiSchema();
  }
  if (versionOrProfile === 'optimized') {
    return getOptimizedLeafletPageGenAiSchema();
  }
  if (versionOrProfile === 'legacy') {
    return getLegacyLeafletPageGenAiSchema();
  }
  throw new Error(`UNSUPPORTED_SCHEMA_VERSION: Unknown leaflet schema profile "${String(versionOrProfile)}".`);
}

/**
 * Universal Translation Adapter & Decoder at the Gemini API boundary.
 * Transparently accepts and reconstructs internal LeafletPageExtractionRev1 structures
 * from legacy, optimized (Strategy B), or compact_v1 (single-letter) payloads,
 * while failing closed on unknown schema versions, schema mismatches, missing required fields, or invalid types.
 */
export function decodeLeafletPageExtraction(
  rawJson: unknown,
  expectedSchemaVersion?: LeafletSchemaVersion | LeafletSchemaProfile | string
): LeafletPageExtractionRev1 {
  if (!rawJson || typeof rawJson !== 'object' || Array.isArray(rawJson)) {
    throw new Error('DECODER_INVALID_PAYLOAD: Raw extraction response is not a valid JSON object.');
  }

  if (
    expectedSchemaVersion !== undefined &&
    !SUPPORTED_LEAFLET_SCHEMA_VERSIONS.includes(expectedSchemaVersion as LeafletSchemaVersion)
  ) {
    throw new Error(
      `UNSUPPORTED_SCHEMA_VERSION: Cannot decode payload with unknown schema version "${expectedSchemaVersion}".`
    );
  }

  const obj = rawJson as Record<string, any>;

  // Explicit compact_v1 enforcement or unambiguous auto-detection (top-level 'o' array of single-letter offers)
  const isCompactV1Payload =
    Array.isArray(obj.o) &&
    !Array.isArray(obj.offers) &&
    ('l' in obj || 'b' in obj || obj.o.length === 0 || (obj.o[0] && 'a' in obj.o[0] && 'w' in obj.o[0]));

  if (expectedSchemaVersion === 'compact_v1' || (!expectedSchemaVersion && isCompactV1Payload)) {
    return decodeCompactSingleLetterPageExtraction(rawJson);
  }

  if (expectedSchemaVersion === 'legacy' && isCompactV1Payload) {
    throw new Error(
      'DECODER_SCHEMA_MISMATCH: Expected legacy payload with "offers", but received compact_v1 payload.'
    );
  }

  if (!Array.isArray(obj.offers) && !Array.isArray(obj.o)) {
    throw new Error('DECODER_MISSING_OFFERS_ARRAY: Payload must contain an offers array.');
  }

  const rawOffers: any[] = Array.isArray(obj.offers) ? obj.offers : obj.o;

  const decodedOffers: ExtractedOfferRev1[] = rawOffers.map((raw: any, index: number): ExtractedOfferRev1 => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`DECODER_INVALID_OFFER: Offer at index ${index} is not an object.`);
    }

    // 1. Decode atomic bounding box components (supports legacy components, Strategy B object {g,p,t,r,u}, compact_v1 w.{g,p,r,u,t}, or 5-tuple [g,p,t,r,u])
    let components: AtomicOfferComponents;

    if (raw.components && typeof raw.components === 'object') {
      components = {
        product_graphic_box: raw.components.product_graphic_box as NormalizedBox2D,
        promo_price_box: raw.components.promo_price_box as NormalizedBox2D,
        title_text_box: (raw.components.title_text_box ?? null) as NormalizedBox2D | null,
        original_price_box: (raw.components.original_price_box ?? null) as NormalizedBox2D | null,
        unit_and_size_badge_box: (raw.components.unit_and_size_badge_box ?? null) as NormalizedBox2D | null
      };
    } else if (raw.w && typeof raw.w === 'object' && !Array.isArray(raw.w)) {
      components = {
        product_graphic_box: raw.w.g as NormalizedBox2D,
        promo_price_box: raw.w.p as NormalizedBox2D,
        title_text_box: (raw.w.t ?? null) as NormalizedBox2D | null,
        original_price_box: (raw.w.r ?? null) as NormalizedBox2D | null,
        unit_and_size_badge_box: (raw.w.u ?? null) as NormalizedBox2D | null
      };
    } else if (raw.b2d && Array.isArray(raw.b2d)) {
      // Fixed-position 5-tuple [g, p, t, r, u]
      components = {
        product_graphic_box: raw.b2d[0] as NormalizedBox2D,
        promo_price_box: raw.b2d[1] as NormalizedBox2D,
        title_text_box: (raw.b2d[2] ?? null) as NormalizedBox2D | null,
        original_price_box: (raw.b2d[3] ?? null) as NormalizedBox2D | null,
        unit_and_size_badge_box: (raw.b2d[4] ?? null) as NormalizedBox2D | null
      };
    } else if (raw.b2d && typeof raw.b2d === 'object') {
      // Strategy B object { g, p, t, r, u }
      components = {
        product_graphic_box: (raw.b2d.g ?? raw.b2d.product_graphic_box) as NormalizedBox2D,
        promo_price_box: (raw.b2d.p ?? raw.b2d.promo_price_box) as NormalizedBox2D,
        title_text_box: (raw.b2d.t ?? raw.b2d.title_text_box ?? null) as NormalizedBox2D | null,
        original_price_box: (raw.b2d.r ?? raw.b2d.original_price_box ?? null) as NormalizedBox2D | null,
        unit_and_size_badge_box: (raw.b2d.u ?? raw.b2d.unit_and_size_badge_box ?? null) as NormalizedBox2D | null
      };
    } else if (raw.boxes && typeof raw.boxes === 'object') {
      components = {
        product_graphic_box: (raw.boxes.g ?? raw.boxes.product_graphic_box) as NormalizedBox2D,
        promo_price_box: (raw.boxes.p ?? raw.boxes.promo_price_box) as NormalizedBox2D,
        title_text_box: (raw.boxes.t ?? raw.boxes.title_text_box ?? null) as NormalizedBox2D | null,
        original_price_box: (raw.boxes.r ?? raw.boxes.original_price_box ?? null) as NormalizedBox2D | null,
        unit_and_size_badge_box: (raw.boxes.u ?? raw.boxes.unit_and_size_badge_box ?? null) as NormalizedBox2D | null
      };
    } else {
      throw new Error(`DECODER_MISSING_COMPONENTS: Offer at index ${index} lacks component bounding boxes.`);
    }

    const boxCheck = atomicOfferComponentsSchema.safeParse(components);
    if (!boxCheck.success) {
      throw new Error(
        `DECODER_INVALID_BOUNDING_BOX: Offer at index ${index} has invalid bounding box coordinates: ${boxCheck.error.issues.map(i => i.message).join('; ')}`
      );
    }

    // 2. Decode retained fields with full fidelity and null semantics
    const offerNumber = Number(raw.offer_number ?? raw.n ?? (index + 1));
    const arabicTitle = String(raw.arabic_title ?? raw.ar ?? '');
    const englishTitle = String(raw.english_title ?? raw.en ?? '');
    const brand = raw.brand !== undefined ? raw.brand : (raw.b !== undefined ? raw.b : null);
    const isMulti = Boolean(raw.is_multi_brand_or_variant ?? raw.m ?? false);
    const compoundGroupId = raw.compound_group_id !== undefined ? raw.compound_group_id : (raw.grp !== undefined ? raw.grp : null);

    const promoPrice = (raw.promo_price ?? raw.p) as number;
    const originalPrice = (raw.original_price !== undefined && raw.original_price !== null)
      ? raw.original_price
      : (raw.op !== undefined && raw.op !== null ? raw.op : null);

    const sizeValue = raw.size_value !== undefined ? raw.size_value : (raw.sz !== undefined ? raw.sz : null);
    const unitType = raw.unit_type !== undefined ? raw.unit_type : (raw.ut !== undefined ? raw.ut : null);

    const packQuantity = (raw.pack_quantity !== undefined && raw.pack_quantity !== null)
      ? Number(raw.pack_quantity)
      : (raw.pq !== undefined && raw.pq !== null ? Number(raw.pq) : 1);

    const eachSizeValue = (raw.each_size_value !== undefined && raw.each_size_value !== null)
      ? Number(raw.each_size_value)
      : (raw.ev !== undefined && raw.ev !== null ? Number(raw.ev) : null);

    const eachSizeUnit = raw.each_size_unit ?? raw.eu ?? null;

    const isUniform = raw.is_uniform_size_across_variants !== undefined
      ? Boolean(raw.is_uniform_size_across_variants)
      : (raw.u_sz !== undefined ? Boolean(raw.u_sz) : true);

    const confidence = Number(raw.confidence ?? raw.c ?? 1.0);

    // 4. Condition extraction: preserve legacy if provided, otherwise leave null (absent/unknown semantics)
    const promoCondition: PromoCondition | null = raw.promo_condition !== undefined ? raw.promo_condition : null;

    return {
      offer_number: offerNumber,
      arabic_title: arabicTitle,
      english_title: englishTitle,
      brand,
      is_multi_brand_or_variant: isMulti,
      compound_group_id: compoundGroupId,
      item_domain: raw.item_domain,
      category_slug: raw.category_slug ?? null,
      normalized_product_name_ar: raw.normalized_product_name_ar ?? null,
      normalized_product_name_en: raw.normalized_product_name_en ?? null,
      commodity_tag: raw.commodity_tag ?? null,
      quantity_limit: raw.quantity_limit ?? null,
      size_value: sizeValue,
      unit_type: unitType,
      pack_quantity: packQuantity,
      each_size_value: eachSizeValue,
      each_size_unit: eachSizeUnit,
      is_uniform_size_across_variants: isUniform,
      promo_price: promoPrice,
      original_price: originalPrice,
      promo_condition: promoCondition,
      confidence,
      components
    };
  });

  return {
    is_loyalty_page: Boolean(obj.is_loyalty_page ?? false),
    loyalty_program_name: obj.loyalty_program_name ?? null,
    validity_start_date: obj.validity_start_date ?? null,
    validity_end_date: obj.validity_end_date ?? null,
    ignored_banners: Array.isArray(obj.ignored_banners) ? obj.ignored_banners : [],
    offers: decodedOffers
  };
}
