/**
 * WIFRAN-EXTRACTOR-IDENTITY-005D (WP4 Stage 1)
 * Versioned Additive V3 Extraction Schema (`wifran.extractor.card/3.0`)
 *
 * Strictly separate from frozen `leafletPageExtractionSchema.ts` (`legacy`, `optimized`, `compact_v1`).
 * Does NOT alter frozen schemas or activate V3 extraction in production.
 */

import { z } from 'zod';
import { normalizedBox2DSchema } from './leafletPageExtractionSchema';
import type { OfferContractV3Record } from '../types/extractorContractV3';
import { stripUnexpectedCurrencyFromModelResponse } from '../utils/geminiResponseSanitizer';

export const V3_EXTRACTION_SCHEMA_VERSION = 'wifran.extractor.card/3.0' as const;
export const V3_CROP_SCHEMA_VERSION = 'wifran.extractor.crop/3.0' as const;
export const V3_EXTRACTION_PROFILE_ID = 'extraction_v3' as const;

export const v3CanonicalOrExtendedUnitSchema = z.enum([
  'g',
  'kg',
  'ml',
  'l',
  'pcs',
  'roll',
  'sheet',
  'cm',
  'inch',
  'gb',
  'tb'
]);

export const v3AssortmentStatusSchema = z.enum([
  'confirmed_single_sku',
  'explicit_assortment',
  'visual_multiple_variants',
  'unknown_insufficient_evidence'
]);

export const v3AssortmentEvidenceSourceSchema = z.enum([
  'assorted_badge',
  'multi_pack_image',
  'slash_title',
  'choice_or_separator',
  'sku_code_list',
  'swatch_icons',
  'operator_verified',
  'printed_leaflet_text',
  'insufficient_evidence'
]);

export const v3PriceBasisSchema = z.enum([
  'each',
  'per_kg',
  'buy_n',
  'per_pack',
  'shared_assortment',
  'unknown'
]);

export const v3SaleBasisSchema = z.enum([
  'single_unit',
  'sealed_multipack',
  'factory_bonus_pack',
  'multi_buy_checkout',
  'buy_x_get_y_checkout',
  'weighed_per_kg',
  'piece_or_tray',
  'unknown'
]);

export const v3EvidenceTypeSchema = z.enum([
  'printed_leaflet_text',
  'printed_package_label',
  'visible_variant_label',
  'manufacturer_packaging_marking',
  'printed_retailer_sku_code',
  'en_ar_text_agreement',
  'conflicting_text_descriptions',
  'source_card_shared_caption',
  'verified_operator_correction'
]);

export const v3ConflictCodeSchema = z.enum([
  'EN_AR_WEIGHT_VOLUME_CONFLICT',
  'EN_AR_PACK_COUNT_CONFLICT',
  'TEXT_VS_IMAGE_CONFLICT',
  'PRICE_ROLE_AMBIGUOUS',
  'CURRENCY_UNVERIFIED_OR_CONFLICT',
  'PROMO_QTY_VS_MFG_PACK_CONFLICT',
  'COMPOUND_SHARED_CAPTION_CONFLICT',
  'UNLABELED_SWATCH_OR_BOTTLE_VARIANTS',
  'INCOMPLETE_VISIBLE_ASSORTMENT',
  'RETAILER_SKU_WITHOUT_VARIANT_NAMES',
  'WEIGHT_RANGE_UNPAIRED',
  'MISSING_CRITICAL_IDENTITY_ATTRIBUTES'
]);

export const v3ItemDomainSchema = z.enum([
  'grocery',
  'household',
  'personal_care',
  'fresh_loose',
  'bakery_inhouse',
  'electronics',
  'appliance',
  'textiles_home',
  'other_non_grocery'
]);

export const v3OperatorCorrectionSchema = z.object({
  corrected_value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  corrected_by: z.string().min(1),
  corrected_at: z.string().min(1),
  rationale: z.string().min(1),
  reversible: z.boolean()
});

export const v3EvidenceEntrySchema = z.object({
  evidence_id: z.string().min(1),
  target_field: z.string().min(1),
  evidence_type: v3EvidenceTypeSchema,
  extracted_value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  original_source_evidence: z.string().nullable(),
  normalized_value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  confidence: z.enum(['high', 'medium', 'low', 'uncertain']),
  uncertainty_reason: z.string().nullable().optional(),
  source_ref_internal: z.string().nullable().optional(),
  operator_correction: v3OperatorCorrectionSchema.nullable().optional()
});

export const v3SubItemSchema = z
  .object({
    sub_item_ref: z.string().min(1),
    brand_en: z.string().nullable(),
    brand_ar: z.string().nullable(),
    product_name_en: z.string().nullable(),
    product_name_ar: z.string().nullable(),
    variant_or_flavor: z.string().nullable(),
    product_form: z.string().nullable(),
    each_size_value: z.number().positive().nullable(),
    each_size_unit: v3CanonicalOrExtendedUnitSchema.nullable(),
    // Explicitly nullable — never defaulted to 1 when unknown
    manufacturer_pack_count: z.number().int().positive().nullable(),
    retailer_checkout_multibuy_qty: z.number().int().positive().nullable().optional(),
    printed_retailer_sku_code: z.string().nullable(),
    is_retailer_sku_only_not_gtin: z.literal(true).default(true),
    independent_promo_price: z.number().positive().nullable().optional(),
    independent_original_price: z.number().positive().nullable().optional(),
    evidence_refs: z.array(z.string()),
    unknown_attributes: z.array(z.string()),
    conflict_attributes: z.array(z.string()),
    safe_for_catalog_matching: z.boolean()
  })
  .refine(
    (s) => Boolean((s.product_name_en && s.product_name_en.trim()) || (s.product_name_ar && s.product_name_ar.trim())),
    {
      message: 'Sub-item must provide either product_name_en or product_name_ar (Arabic-only is valid).'
    }
  );

export const v3AssortmentAssessmentSchema = z.object({
  status: v3AssortmentStatusSchema,
  visible_variant_count: z.number().int().nonnegative().nullable(),
  identifiable_sub_item_count: z.number().int().nonnegative(),
  assortment_evidence: z.array(v3AssortmentEvidenceSourceSchema),
  is_enumerated_list_complete: z.boolean(),
  all_options_linkable: z.boolean()
});

export const v3QuantityPriceTierSchema = z.object({
  quantity: z.number().positive(),
  unit_or_basis: z.string().min(1),
  price: z.number().positive(),
  currency: z.string().nullable(),
  basis: z.enum(['standard', 'loyalty', 'member'])
});

export const v3QuantityAndPromoSchema = z.object({
  sale_basis: v3SaleBasisSchema,
  each_size_value: z.number().positive().nullable(),
  each_size_unit: v3CanonicalOrExtendedUnitSchema.nullable(),
  // Strictly nullable — never defaulted to 1 when unknown
  manufacturer_pack_count: z.number().int().positive().nullable(),
  retailer_checkout_multibuy_qty: z.number().int().positive().nullable(),
  factory_bonus_paid_qty: z.number().int().positive().nullable(),
  factory_bonus_free_qty: z.number().int().positive().nullable(),
  customer_limit_pcs: z.number().int().positive().nullable(),
  shared_promotional_price: z.number().positive().nullable(),
  quantity_price_tiers: z.array(v3QuantityPriceTierSchema),
  is_per_weight_pricing: z.boolean(),
  loyalty_required: z.boolean(),
  loyalty_program_name: z.string().nullable()
});

export const v3PriceIntegritySchema = z.object({
  promo_price: z.number().positive().nullable(),
  original_price: z.number().positive().nullable(),
  currency: z.string().nullable(),
  currency_evidence: z.string().nullable(),
  price_basis: v3PriceBasisSchema,
  price_role_confidence: z.enum(['high', 'medium', 'low', 'conflicting']),
  promo_conditions: z.string().nullable(),
  price_conflict_flags: z.array(v3ConflictCodeSchema)
});

export const v3NonGrocerySpecsSchema = z.object({
  domain: v3ItemDomainSchema,
  electronics_model_number: z.string().nullable().optional(),
  screen_size_inches: z.number().positive().nullable().optional(),
  storage_capacity: z.string().nullable().optional(),
  connectivity_variant: z.string().nullable().optional(),
  textile_dimensions: z.string().nullable().optional(),
  bakery_measurement: z.string().nullable().optional(),
  display_size_text: z.string().nullable().optional(),
  excluded_from_default_grocery_feed: z.boolean()
});

export const v3CompoundCardContextSchema = z.object({
  compound_group_id: z.string().nullable(),
  card_shared_caption_en: z.string().nullable(),
  card_shared_caption_ar: z.string().nullable(),
  has_multiple_price_badges_in_card: z.boolean(),
  has_different_packaging_across_entries: z.boolean(),
  inherited_caption_attributes_requiring_override: z.array(z.string())
});

export const offerContractV3RecordSchema = z
  .object({
    schema_version: z.literal(V3_EXTRACTION_SCHEMA_VERSION),
    source_card: z.object({
      leaflet_id: z.string().min(1),
      page_number: z.number().int().positive(),
      source_offer_id: z.string().min(1),
      source_evidence_ref_internal: z.string().nullable(),
      retailer_id: z.string().nullable(),
      retailer_name: z.string().nullable(),
      offer_start_date: z.string().nullable(),
      offer_end_date: z.string().nullable(),
      location_scope: z.enum(['national', 'region', 'city']).nullable(),
      city_id: z.string().nullable(),
      region_id: z.string().nullable(),
      raw_text: z
        .object({
          title_ar: z.string().nullable(),
          title_en: z.string().nullable(),
          size_text: z.string().nullable(),
          promo_badge_text: z.string().nullable(),
          price_text_candidates: z.array(z.string())
        })
        .refine(
          (rt) => Boolean((rt.title_ar && rt.title_ar.trim()) || (rt.title_en && rt.title_en.trim())),
          {
            message: 'Source card raw_text must provide Arabic or English text (Arabic-only is valid).'
          }
        )
    }),
    pricing: v3PriceIntegritySchema,
    assortment: v3AssortmentAssessmentSchema,
    sub_items: z.array(v3SubItemSchema),
    quantity_and_promo: v3QuantityAndPromoSchema,
    non_grocery_specs: v3NonGrocerySpecsSchema,
    compound_card_context: v3CompoundCardContextSchema.nullable().optional(),
    category_evidence: z
      .object({
        commodity_tag: z.string().nullable().optional(),
        category_hint: z.string().nullable().optional()
      })
      .nullable()
      .optional(),
    extraction_confidence: z.enum(['high', 'medium', 'low']),
    evidence_conflicts: z.array(v3ConflictCodeSchema),
    evidence_ledger: z.array(v3EvidenceEntrySchema),
    printed_retailer_sku_codes: z.array(z.string())
  })
  .superRefine((val, ctx) => {
    // Safety invariant: when confirmed_single_sku with visible_variant_count > 1, reject contradiction
    if (
      val.assortment.status === 'confirmed_single_sku' &&
      val.assortment.visible_variant_count !== null &&
      val.assortment.visible_variant_count > 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assortment', 'status'],
        message: 'assortment.status cannot be confirmed_single_sku when visible_variant_count > 1.'
      });
    }
  });

export const v3PageExtractionCardSchema = z.object({
  offer_number: z.number().int().positive(),
  arabic_title: z.string().nullable(),
  english_title: z.string().nullable(),
  brand: z.string().nullable(),
  size_text: z.string().nullable().optional(),
  promo_badge_text: z.string().nullable().optional(),
  assortment_status: v3AssortmentStatusSchema,
  visible_variant_count: z.number().int().nonnegative().nullable(),
  assortment_evidence: z.array(z.string()),
  is_enumerated_list_complete: z.boolean(),
  compound_group_id: z.string().nullable(),
  shared_caption_text: z.string().nullable(),
  item_domain: v3ItemDomainSchema,
  category_slug: z.string().nullable(),
  promo_price: z.number().positive().nullable(),
  original_price: z.number().positive().nullable(),
  currency: z.string().nullable().optional().default(null),
  currency_evidence: z.string().nullable().optional().default(null),
  price_basis: v3PriceBasisSchema,
  price_role_confidence: z.enum(['high', 'medium', 'low', 'conflicting']).optional(),
  sale_basis: v3SaleBasisSchema.optional(),
  is_per_weight_pricing: z.boolean().optional(),
  promo_conditions: z.string().nullable().optional().default(null),
  each_size_value: z.number().positive().nullable(),
  each_size_unit: v3CanonicalOrExtendedUnitSchema.nullable(),
  manufacturer_pack_count: z.number().int().positive().nullable(),
  retailer_checkout_multibuy_qty: z.number().int().positive().nullable(),
  factory_bonus_paid_qty: z.number().int().positive().nullable(),
  factory_bonus_free_qty: z.number().int().positive().nullable(),
  customer_limit_pcs: z.number().int().positive().nullable().optional().default(null),
  loyalty_required: z.boolean().optional().default(false),
  printed_retailer_sku_codes: z.array(z.string()),
  sub_items: z.array(
    z.object({
      sub_item_ref: z.string(),
      brand_en: z.string().nullable(),
      brand_ar: z.string().nullable(),
      product_name_en: z.string().nullable(),
      product_name_ar: z.string().nullable(),
      variant_or_flavor: z.string().nullable(),
      each_size_value: z.number().positive().nullable(),
      each_size_unit: v3CanonicalOrExtendedUnitSchema.nullable(),
      manufacturer_pack_count: z.number().int().positive().nullable(),
      retailer_checkout_multibuy_qty: z.number().int().positive().nullable().optional(),
      printed_retailer_sku_code: z.string().nullable(),
      independent_promo_price: z.number().positive().nullable().optional(),
      independent_original_price: z.number().positive().nullable().optional()
    })
  ),
  non_grocery_specs: z
    .object({
      electronics_model_number: z.string().nullable().optional(),
      screen_size_inches: z.number().positive().nullable().optional(),
      storage_capacity: z.string().nullable().optional(),
      connectivity_variant: z.string().nullable().optional(),
      textile_dimensions: z.string().nullable().optional(),
      bakery_measurement: z.string().nullable().optional(),
      display_size_text: z.string().nullable().optional()
    })
    .nullable(),
  evidence_conflicts: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  components: z.object({
    product_graphic_box: normalizedBox2DSchema,
    promo_price_box: normalizedBox2DSchema,
    original_price_box: normalizedBox2DSchema.nullable(),
    unit_and_size_badge_box: normalizedBox2DSchema.nullable(),
    title_text_box: normalizedBox2DSchema.nullable()
  })
});

export const leafletPageExtractionV3Schema = z.object({
  schema_version: z.literal(V3_EXTRACTION_SCHEMA_VERSION).default(V3_EXTRACTION_SCHEMA_VERSION),
  is_loyalty_page: z.boolean().optional().default(false),
  loyalty_program_name: z.string().nullable().optional().default(null),
  validity_start_date: z.string().nullable(),
  validity_end_date: z.string().nullable(),
  page_currency: z.string().nullable().optional().default(null),
  ignored_banners: z.array(z.string()),
  offers: z.array(v3PageExtractionCardSchema)
});

export type LeafletPageExtractionV3Zod = z.infer<typeof leafletPageExtractionV3Schema>;

/**
 * Parses and validates an additive `OfferContractV3Record`.
 * Explicitly preserves Arabic-only cards and nullable unknown `manufacturer_pack_count`.
 */
export function parseOfferContractV3Record(input: unknown): OfferContractV3Record {
  return offerContractV3RecordSchema.parse(input) as OfferContractV3Record;
}

/**
 * Separate versioned Gemini GenAI `responseSchema` for future V3 opt-in profile.
 * NOT invoked in production or default extraction paths in Milestone 005D.
 */
export function getV3LeafletPageGenAiSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      validity_start_date: { type: 'string', nullable: true },
      validity_end_date: { type: 'string', nullable: true },
      ignored_banners: { type: 'array', items: { type: 'string' } },
      offers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            offer_number: { type: 'integer' },
            arabic_title: { type: 'string', nullable: true },
            english_title: { type: 'string', nullable: true },
            brand: { type: 'string', nullable: true },
            size_text: { type: 'string', nullable: true },
            promo_badge_text: { type: 'string', nullable: true },
            assortment_status: {
              type: 'string',
              enum: [
                'confirmed_single_sku',
                'explicit_assortment',
                'visual_multiple_variants',
                'unknown_insufficient_evidence'
              ]
            },
            visible_variant_count: { type: 'integer', nullable: true },
            assortment_evidence: { type: 'array', items: { type: 'string' } },
            is_enumerated_list_complete: { type: 'boolean' },
            compound_group_id: { type: 'string', nullable: true },
            shared_caption_text: { type: 'string', nullable: true },
            item_domain: {
              type: 'string',
              enum: [
                'grocery',
                'household',
                'personal_care',
                'fresh_loose',
                'bakery_inhouse',
                'electronics',
                'appliance',
                'textiles_home',
                'other_non_grocery'
              ]
            },
            category_slug: { type: 'string', nullable: true },
            promo_price: { type: 'number', nullable: true },
            original_price: { type: 'number', nullable: true },
            price_basis: {
              type: 'string',
              enum: ['each', 'per_kg', 'buy_n', 'per_pack', 'shared_assortment', 'unknown']
            },
            price_role_confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low', 'conflicting']
            },
            sale_basis: {
              type: 'string',
              enum: [
                'single_unit',
                'sealed_multipack',
                'factory_bonus_pack',
                'multi_buy_checkout',
                'buy_x_get_y_checkout',
                'weighed_per_kg',
                'piece_or_tray',
                'unknown'
              ]
            },
            is_per_weight_pricing: { type: 'boolean' },
            each_size_value: { type: 'number', nullable: true },
            each_size_unit: {
              type: 'string',
              enum: ['g', 'kg', 'ml', 'l', 'pcs', 'roll', 'sheet', 'cm', 'inch', 'gb', 'tb'],
              nullable: true
            },
            manufacturer_pack_count: { type: 'integer', nullable: true },
            retailer_checkout_multibuy_qty: { type: 'integer', nullable: true },
            factory_bonus_paid_qty: { type: 'integer', nullable: true },
            factory_bonus_free_qty: { type: 'integer', nullable: true },
            printed_retailer_sku_codes: { type: 'array', items: { type: 'string' } },
            sub_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sub_item_ref: { type: 'string' },
                  brand_en: { type: 'string', nullable: true },
                  brand_ar: { type: 'string', nullable: true },
                  product_name_en: { type: 'string', nullable: true },
                  product_name_ar: { type: 'string', nullable: true },
                  variant_or_flavor: { type: 'string', nullable: true },
                  each_size_value: { type: 'number', nullable: true },
                  each_size_unit: {
                    type: 'string',
                    enum: ['g', 'kg', 'ml', 'l', 'pcs', 'roll', 'sheet', 'cm', 'inch', 'gb', 'tb'],
                    nullable: true
                  },
                  manufacturer_pack_count: { type: 'integer', nullable: true },
                  retailer_checkout_multibuy_qty: { type: 'integer', nullable: true },
                  printed_retailer_sku_code: { type: 'string', nullable: true },
                  independent_promo_price: { type: 'number', nullable: true },
                  independent_original_price: { type: 'number', nullable: true }
                },
                required: [
                  'sub_item_ref',
                  'brand_en',
                  'brand_ar',
                  'product_name_en',
                  'product_name_ar',
                  'variant_or_flavor',
                  'each_size_value',
                  'each_size_unit',
                  'manufacturer_pack_count',
                  'retailer_checkout_multibuy_qty',
                  'printed_retailer_sku_code',
                  'independent_promo_price',
                  'independent_original_price'
                ]
              }
            },
            non_grocery_specs: {
              type: 'object',
              nullable: true,
              properties: {
                electronics_model_number: { type: 'string', nullable: true },
                screen_size_inches: { type: 'number', nullable: true },
                storage_capacity: { type: 'string', nullable: true },
                connectivity_variant: { type: 'string', nullable: true },
                textile_dimensions: { type: 'string', nullable: true },
                bakery_measurement: { type: 'string', nullable: true },
                display_size_text: { type: 'string', nullable: true }
              }
            },
            evidence_conflicts: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number' },
            components: {
              type: 'object',
              properties: {
                product_graphic_box: { type: 'array', items: { type: 'integer' } },
                promo_price_box: { type: 'array', items: { type: 'integer' } },
                original_price_box: { type: 'array', items: { type: 'integer' }, nullable: true },
                unit_and_size_badge_box: { type: 'array', items: { type: 'integer' }, nullable: true },
                title_text_box: { type: 'array', items: { type: 'integer' }, nullable: true }
              },
              required: [
                'product_graphic_box',
                'promo_price_box',
                'original_price_box',
                'unit_and_size_badge_box',
                'title_text_box'
              ]
            }
          },
          required: [
            'offer_number',
            'arabic_title',
            'english_title',
            'brand',
            'size_text',
            'promo_badge_text',
            'assortment_status',
            'visible_variant_count',
            'assortment_evidence',
            'is_enumerated_list_complete',
            'compound_group_id',
            'shared_caption_text',
            'item_domain',
            'category_slug',
            'promo_price',
            'original_price',
            'price_basis',
            'price_role_confidence',
            'sale_basis',
            'is_per_weight_pricing',
            'each_size_value',
            'each_size_unit',
            'manufacturer_pack_count',
            'retailer_checkout_multibuy_qty',
            'factory_bonus_paid_qty',
            'factory_bonus_free_qty',
            'printed_retailer_sku_codes',
            'sub_items',
            'non_grocery_specs',
            'evidence_conflicts',
            'confidence',
            'components'
          ]
        }
      }
    },
    required: [
      'validity_start_date',
      'validity_end_date',
      'ignored_banners',
      'offers'
    ]
  };
}

/**
 * Compact crop-specific GenAI `responseSchema` (`wifran.extractor.crop/3.0`).
 * Omits whole-page header/footer/loyalty/date/banner wrapper keys while preserving
 * all offer-level identity, packaging, pricing, independent price-tier, conflict,
 * and normalized bounding-box fields. Adapts losslessly into `wifran.extractor.card/3.0`.
 */
export function getV3CardCropGenAiSchema(): Record<string, unknown> {
  const fullSchema = getV3LeafletPageGenAiSchema() as {
    properties: Record<string, unknown>;
  };
  return {
    type: 'object',
    properties: {
      offers: fullSchema.properties.offers
    },
    required: ['offers']
  };
}

/**
 * Adapts a compact `wifran.extractor.crop/3.0` response payload into
 * `wifran.extractor.card/3.0` page-compatible shape before Zod validation/decoding.
 */
export function adaptV3CropExtractionToV3PagePayload(rawInput: unknown): Record<string, unknown> {
  if (!rawInput || typeof rawInput !== 'object') {
    return {
      is_loyalty_page: false,
      loyalty_program_name: null,
      validity_start_date: null,
      validity_end_date: null,
      page_currency: null,
      ignored_banners: [],
      offers: []
    };
  }
  const root = rawInput as Record<string, unknown>;
  const rawOffers = Array.isArray(root.offers) ? root.offers : [];

  return {
    is_loyalty_page: false,
    loyalty_program_name: null,
    validity_start_date: root.validity_start_date ?? null,
    validity_end_date: root.validity_end_date ?? null,
    page_currency: null,
    ignored_banners: Array.isArray(root.ignored_banners) ? root.ignored_banners : [],
    offers: rawOffers
  };
}

export interface V3PageDecodeContext {
  leafletId: string;
  pageNumber: number;
  sourceOfferIdPrefix: string;
  explicitSingleOfferId?: string | null;
  retailerId?: string | null;
  retailerName?: string | null;
  sourceEvidenceRefInternal?: string | null;
  locationScope?: 'national' | 'region' | 'city' | null;
  cityId?: string | null;
  regionId?: string | null;
  tolerateOmittedNullableFields?: boolean;
}

export interface V3DecodedPageResult {
  schemaValid: boolean;
  schemaErrors: string[];
  rawExtraction: LeafletPageExtractionV3Zod;
  cards: OfferContractV3Record[];
}

function normalizeEvidenceConfidence(conf: number): 'high' | 'medium' | 'low' {
  if (conf >= 0.8) return 'high';
  if (conf >= 0.5) return 'medium';
  return 'low';
}

function mapRawAssortmentEvidenceList(
  rawList: string[]
): OfferContractV3Record['assortment']['assortment_evidence'] {
  const mapped = new Set<OfferContractV3Record['assortment']['assortment_evidence'][number]>();
  for (const item of rawList || []) {
    const parsedDirect = v3AssortmentEvidenceSourceSchema.safeParse(item);
    if (parsedDirect.success) {
      mapped.add(parsedDirect.data);
      continue;
    }
    const lower = String(item).toLowerCase();
    if (/assorted|متنوع/.test(lower)) mapped.add('assorted_badge');
    else if (/swatch|color|colour|لون/.test(lower)) mapped.add('swatch_icons');
    else if (/sku|code/.test(lower)) mapped.add('sku_code_list');
    else if (/slash|\//.test(lower)) mapped.add('slash_title');
    else if (/choice|separator|\bor\b|أو/.test(lower)) mapped.add('choice_or_separator');
    else if (/pack|tub|bottle|can|bag|image|photo|visual/.test(lower)) mapped.add('multi_pack_image');
    else if (/insufficient/.test(lower)) mapped.add('insufficient_evidence');
    else mapped.add('printed_leaflet_text');
  }
  return Array.from(mapped);
}

function mapRawConflictCodes(rawList: string[]): OfferContractV3Record['evidence_conflicts'] {
  const mapped = new Set<OfferContractV3Record['evidence_conflicts'][number]>();
  for (const code of rawList || []) {
    if (code === 'CURRENCY_UNVERIFIED_OR_CONFLICT') {
      continue;
    }
    const parsed = v3ConflictCodeSchema.safeParse(code);
    if (parsed.success) {
      mapped.add(parsed.data);
    }
  }
  return Array.from(mapped);
}

function hasAnyCompoundPriceTierOnSubItems(
  subItems: LeafletPageExtractionV3Zod['offers'][number]['sub_items'],
  cardPromoPrice?: number | null
): boolean {
  const nonNullPrices = subItems
    .map((s) => s.independent_promo_price)
    .filter((p): p is number => p !== null && p !== undefined);
  if (nonNullPrices.length === 0) return false;
  // Single sub-item merely echoing card promo_price is NOT a compound tier
  if (subItems.length <= 1) {
    return (
      cardPromoPrice != null &&
      nonNullPrices.some((p) => Math.abs(p - cardPromoPrice) > 0.01)
    );
  }
  const distinctPrices = new Set(nonNullPrices.map((p) => Number(p.toFixed(2))));
  return (
    distinctPrices.size > 1 ||
    (cardPromoPrice != null && nonNullPrices.some((p) => Math.abs(p - cardPromoPrice) > 0.01)) ||
    nonNullPrices.length < subItems.length
  );
}

function normalizeRawV3OmittedNullables(rawInput: unknown): unknown {
  if (!rawInput || typeof rawInput !== 'object') return rawInput;
  const root = rawInput as Record<string, any>;
  return {
    ...root,
    loyalty_program_name: root.loyalty_program_name ?? null,
    validity_start_date: root.validity_start_date ?? null,
    validity_end_date: root.validity_end_date ?? null,
    page_currency: root.page_currency ?? null,
    ignored_banners: Array.isArray(root.ignored_banners) ? root.ignored_banners : [],
    offers: Array.isArray(root.offers)
      ? root.offers.map((o: Record<string, any>) => ({
          ...o,
          arabic_title: o.arabic_title ?? null,
          english_title: o.english_title ?? null,
          brand: o.brand ?? null,
          size_text: o.size_text ?? null,
          promo_badge_text: o.promo_badge_text ?? null,
          visible_variant_count: o.visible_variant_count ?? null,
          assortment_evidence: Array.isArray(o.assortment_evidence) ? o.assortment_evidence : [],
          compound_group_id: o.compound_group_id ?? null,
          shared_caption_text: o.shared_caption_text ?? null,
          category_slug: o.category_slug ?? null,
          promo_price: o.promo_price ?? null,
          original_price: o.original_price ?? null,
          currency: o.currency ?? null,
          currency_evidence: o.currency_evidence ?? null,
          promo_conditions: o.promo_conditions ?? null,
          each_size_value: o.each_size_value ?? null,
          each_size_unit: o.each_size_unit ?? null,
          manufacturer_pack_count: o.manufacturer_pack_count ?? null,
          retailer_checkout_multibuy_qty: o.retailer_checkout_multibuy_qty ?? null,
          factory_bonus_paid_qty: o.factory_bonus_paid_qty ?? null,
          factory_bonus_free_qty: o.factory_bonus_free_qty ?? null,
          customer_limit_pcs: o.customer_limit_pcs ?? null,
          non_grocery_specs: o.non_grocery_specs ?? null,
          sub_items: Array.isArray(o.sub_items)
            ? o.sub_items.map((s: Record<string, any>) => ({
                ...s,
                brand_en: s.brand_en ?? null,
                brand_ar: s.brand_ar ?? null,
                product_name_en: s.product_name_en ?? null,
                product_name_ar: s.product_name_ar ?? null,
                variant_or_flavor: s.variant_or_flavor ?? null,
                each_size_value: s.each_size_value ?? null,
                each_size_unit: s.each_size_unit ?? null,
                manufacturer_pack_count: s.manufacturer_pack_count ?? null,
                retailer_checkout_multibuy_qty: s.retailer_checkout_multibuy_qty ?? null,
                printed_retailer_sku_code: s.printed_retailer_sku_code ?? null,
                independent_promo_price: s.independent_promo_price ?? null,
                independent_original_price: s.independent_original_price ?? null
              }))
            : [],
          components: o.components
            ? {
                ...o.components,
                original_price_box: o.components.original_price_box ?? null,
                unit_and_size_badge_box: o.components.unit_and_size_badge_box ?? null,
                title_text_box: o.components.title_text_box ?? null
              }
            : o.components
        }))
      : root.offers
  };
}

/**
 * Deterministically bridges raw `wifran.extractor.card/3.0` page/crop JSON responses
 * into `OfferContractV3Record[]` without mutating or inventing evidence.
 */
export function decodeV3PageExtractionToOfferCards(
  rawInput: unknown,
  context: V3PageDecodeContext
): V3DecodedPageResult {
  const { sanitized: currencyFreeInput } = stripUnexpectedCurrencyFromModelResponse(rawInput);
  const inputForParse = context.tolerateOmittedNullableFields
    ? normalizeRawV3OmittedNullables(currencyFreeInput)
    : currencyFreeInput;
  const parsedResult = leafletPageExtractionV3Schema.safeParse(inputForParse);
  if (!parsedResult.success) {
    const errors = parsedResult.error.issues.map(
      (iss) => `${iss.path.join('.') || '<root>'}: ${iss.message}`
    );
    return {
      schemaValid: false,
      schemaErrors: errors,
      rawExtraction: (typeof currencyFreeInput === 'object' && currencyFreeInput !== null
        ? currencyFreeInput
        : {
            schema_version: V3_EXTRACTION_SCHEMA_VERSION,
            is_loyalty_page: false,
            loyalty_program_name: null,
            validity_start_date: null,
            validity_end_date: null,
            page_currency: null,
            ignored_banners: [],
            offers: []
          }) as LeafletPageExtractionV3Zod,
      cards: []
    };
  }

  const page = parsedResult.data;
  const cards: OfferContractV3Record[] = [];

  for (let idx = 0; idx < page.offers.length; idx++) {
    const rawCard = page.offers[idx];
    const sourceOfferId =
      page.offers.length === 1 && context.explicitSingleOfferId
        ? context.explicitSingleOfferId
        : `${context.sourceOfferIdPrefix}_${String(rawCard.offer_number || idx + 1).padStart(3, '0')}`;

    const isExcludedDomain =
      rawCard.item_domain === 'electronics' ||
      rawCard.item_domain === 'appliance' ||
      rawCard.item_domain === 'textiles_home' ||
      rawCard.item_domain === 'other_non_grocery';

    // Fixed internal application currency (Saudi Arabia MVP — never read from Gemini output)
    const resolvedCurrency = 'SAR';
    const resolvedPriceBasis = rawCard.price_basis;
    const resolvedSaleBasis =
      rawCard.sale_basis ||
      (rawCard.is_per_weight_pricing || resolvedPriceBasis === 'per_kg'
        ? 'weighed_per_kg'
        : rawCard.factory_bonus_paid_qty && rawCard.factory_bonus_free_qty
          ? 'factory_bonus_pack'
          : rawCard.retailer_checkout_multibuy_qty
            ? 'multi_buy_checkout'
            : (rawCard.manufacturer_pack_count ?? 0) > 1
              ? 'sealed_multipack'
              : rawCard.manufacturer_pack_count === 1
                ? 'single_unit'
                : 'unknown');

    const cardConf = normalizeEvidenceConfidence(rawCard.confidence);
    const ledger: OfferContractV3Record['evidence_ledger'] = [];

    if (rawCard.promo_badge_text) {
      ledger.push({
        evidence_id: `ev_${sourceOfferId}_promo_badge`,
        target_field:
          rawCard.factory_bonus_paid_qty && rawCard.factory_bonus_free_qty
            ? 'quantity_and_promo.factory_bonus_paid_qty'
            : 'quantity_and_promo',
        evidence_type: 'printed_leaflet_text',
        extracted_value: rawCard.promo_badge_text,
        original_source_evidence: rawCard.promo_badge_text,
        normalized_value: rawCard.promo_badge_text,
        confidence: cardConf,
        source_ref_internal: context.sourceEvidenceRefInternal ?? null,
        operator_correction: null
      });
    }

    if (rawCard.size_text) {
      ledger.push({
        evidence_id: `ev_${sourceOfferId}_size`,
        target_field: 'quantity_and_promo.each_size_value',
        evidence_type: 'printed_leaflet_text',
        extracted_value: rawCard.size_text,
        original_source_evidence: rawCard.size_text,
        normalized_value: rawCard.each_size_value,
        confidence: cardConf,
        source_ref_internal: context.sourceEvidenceRefInternal ?? null,
        operator_correction: null
      });
    }

    const isCompoundCard = Boolean(
      rawCard.compound_group_id ||
        rawCard.shared_caption_text ||
        hasAnyCompoundPriceTierOnSubItems(rawCard.sub_items, rawCard.promo_price)
    );

    const rawCardHasEnglishTitle = Boolean(rawCard.english_title && rawCard.english_title.trim());
    const cardEnglishGroundingText = [
      rawCard.english_title,
      rawCard.shared_caption_text,
      rawCard.size_text,
      rawCard.promo_badge_text,
      rawCard.brand
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const mappedSubItems: OfferContractV3Record['sub_items'] = rawCard.sub_items.map((sub, sIdx) => {
      const resolvedBrandEn = sub.brand_en ?? rawCard.brand ?? null;
      const resolvedBrandAr = sub.brand_ar ?? null;
      const rawSubNameEn = sub.product_name_en?.trim() || null;
      const subNameAr = sub.product_name_ar ?? null;
      const isUngroundedArabicOnlyTranslation =
        !rawCardHasEnglishTitle &&
        Boolean(subNameAr && subNameAr.trim()) &&
        Boolean(rawSubNameEn) &&
        !cardEnglishGroundingText.includes(rawSubNameEn!.toLowerCase());
      const subNameEn = isUngroundedArabicOnlyTranslation ? null : rawSubNameEn;
      const hasOwnName = Boolean((subNameEn && subNameEn.trim()) || (subNameAr && subNameAr.trim()));

      // Inherit size/pack/multibuy onto non-compound sub-item ONLY if card extracted it cleanly and sub left it null
      const resolvedEachVal = sub.each_size_value ?? (!isCompoundCard ? rawCard.each_size_value : null);
      const resolvedEachUnit = sub.each_size_unit ?? (!isCompoundCard ? rawCard.each_size_unit : null);
      const resolvedPackCount =
        sub.manufacturer_pack_count ?? (!isCompoundCard ? rawCard.manufacturer_pack_count : null);
      const resolvedCheckoutMultibuyQty =
        sub.retailer_checkout_multibuy_qty ??
        (!isCompoundCard ? rawCard.retailer_checkout_multibuy_qty : null);

      const unknownAttrs: string[] = [];
      if (!hasOwnName) unknownAttrs.push('product_name');
      if (!resolvedBrandEn && !resolvedBrandAr) unknownAttrs.push('brand');
      if (resolvedEachVal === null || !resolvedEachUnit) unknownAttrs.push('each_size');
      if (resolvedPackCount === null) unknownAttrs.push('manufacturer_pack_count');

      const hasMultiBrand =
        new Set(rawCard.sub_items.map((x) => (x.brand_en || x.brand_ar || '').trim().toLowerCase()).filter(Boolean))
          .size > 1;
      const hasIndependentPriceTier =
        sub.independent_promo_price !== null && sub.independent_promo_price !== undefined;

      const isDistinguishable =
        rawCard.assortment_status === 'confirmed_single_sku' ||
        Boolean(sub.variant_or_flavor && sub.variant_or_flavor.trim()) ||
        hasMultiBrand ||
        hasIndependentPriceTier ||
        rawCard.sub_items.length === 1;

      if (!isDistinguishable && rawCard.sub_items.length > 1) {
        unknownAttrs.push('variant_or_flavor');
      }

      const safeForCatalogMatching =
        unknownAttrs.length === 0 &&
        mapRawConflictCodes(rawCard.evidence_conflicts).length === 0 &&
        hasOwnName;

      return {
        sub_item_ref: sub.sub_item_ref || `s${String(sIdx + 1).padStart(2, '0')}`,
        brand_en: resolvedBrandEn,
        brand_ar: resolvedBrandAr,
        product_name_en: subNameEn,
        product_name_ar: subNameAr,
        variant_or_flavor: sub.variant_or_flavor ?? null,
        product_form: null,
        each_size_value: resolvedEachVal ?? null,
        each_size_unit: resolvedEachUnit ?? null,
        manufacturer_pack_count: resolvedPackCount ?? null,
        retailer_checkout_multibuy_qty: resolvedCheckoutMultibuyQty ?? null,
        printed_retailer_sku_code: sub.printed_retailer_sku_code ?? null,
        is_retailer_sku_only_not_gtin: true,
        independent_promo_price: sub.independent_promo_price ?? null,
        independent_original_price: sub.independent_original_price ?? null,
        evidence_refs: ledger.map((e) => e.evidence_id),
        unknown_attributes: unknownAttrs,
        conflict_attributes: [],
        safe_for_catalog_matching: safeForCatalogMatching
      };
    });

    const priceTextCands = [
      rawCard.promo_price != null ? String(rawCard.promo_price) : '',
      rawCard.original_price != null ? String(rawCard.original_price) : ''
    ].filter(Boolean);

    const record: OfferContractV3Record = {
      schema_version: V3_EXTRACTION_SCHEMA_VERSION,
      source_card: {
        leaflet_id: context.leafletId,
        page_number: context.pageNumber,
        source_offer_id: sourceOfferId,
        source_evidence_ref_internal: context.sourceEvidenceRefInternal ?? null,
        retailer_id: context.retailerId ?? null,
        retailer_name: context.retailerName ?? null,
        offer_start_date: page.validity_start_date ?? null,
        offer_end_date: page.validity_end_date ?? null,
        location_scope: context.locationScope ?? null,
        city_id: context.cityId ?? null,
        region_id: context.regionId ?? null,
        raw_text: {
          title_ar: rawCard.arabic_title,
          title_en: rawCard.english_title,
          size_text: rawCard.size_text ?? null,
          promo_badge_text: rawCard.promo_badge_text ?? null,
          price_text_candidates: priceTextCands
        }
      },
      pricing: {
        promo_price: rawCard.promo_price,
        original_price: rawCard.original_price,
        currency: resolvedCurrency,
        currency_evidence: 'fixed_sar_internal',
        price_basis: resolvedPriceBasis,
        price_role_confidence: rawCard.price_role_confidence || 'high',
        promo_conditions:
          typeof rawCard.promo_conditions === 'string' && rawCard.promo_conditions.trim()
            ? rawCard.promo_conditions.trim()
            : null,
        price_conflict_flags: mapRawConflictCodes(rawCard.evidence_conflicts).filter(
          (c) => c === 'PRICE_ROLE_AMBIGUOUS'
        )
      },
      assortment: {
        status: rawCard.assortment_status,
        visible_variant_count: rawCard.visible_variant_count,
        identifiable_sub_item_count: mappedSubItems.length,
        assortment_evidence: mapRawAssortmentEvidenceList(rawCard.assortment_evidence),
        is_enumerated_list_complete: rawCard.is_enumerated_list_complete,
        all_options_linkable:
          rawCard.is_enumerated_list_complete &&
          mappedSubItems.length > 0 &&
          mappedSubItems.every((s) => s.safe_for_catalog_matching)
      },
      sub_items: mappedSubItems,
      quantity_and_promo: {
        sale_basis: resolvedSaleBasis,
        each_size_value: rawCard.each_size_value,
        each_size_unit: rawCard.each_size_unit,
        manufacturer_pack_count: rawCard.manufacturer_pack_count,
        retailer_checkout_multibuy_qty: rawCard.retailer_checkout_multibuy_qty,
        factory_bonus_paid_qty: rawCard.factory_bonus_paid_qty,
        factory_bonus_free_qty: rawCard.factory_bonus_free_qty,
        customer_limit_pcs: null,
        shared_promotional_price: rawCard.promo_price,
        quantity_price_tiers: [],
        is_per_weight_pricing: Boolean(
          rawCard.is_per_weight_pricing || resolvedPriceBasis === 'per_kg'
        ),
        loyalty_required: false,
        loyalty_program_name: null
      },
      non_grocery_specs: {
        domain: rawCard.item_domain,
        electronics_model_number: rawCard.non_grocery_specs?.electronics_model_number ?? null,
        screen_size_inches: rawCard.non_grocery_specs?.screen_size_inches ?? null,
        storage_capacity: rawCard.non_grocery_specs?.storage_capacity ?? null,
        connectivity_variant: rawCard.non_grocery_specs?.connectivity_variant ?? null,
        textile_dimensions: rawCard.non_grocery_specs?.textile_dimensions ?? null,
        bakery_measurement: rawCard.non_grocery_specs?.bakery_measurement ?? null,
        display_size_text: rawCard.non_grocery_specs?.display_size_text ?? null,
        excluded_from_default_grocery_feed: isExcludedDomain
      },
      category_evidence: rawCard.category_slug
        ? {
            commodity_tag: rawCard.category_slug,
            category_hint: rawCard.item_domain
          }
        : null,
      compound_card_context: isCompoundCard
        ? {
            compound_group_id: rawCard.compound_group_id,
            card_shared_caption_en: rawCard.shared_caption_text,
            card_shared_caption_ar: rawCard.shared_caption_text,
            has_multiple_price_badges_in_card: Boolean(
              rawCard.compound_group_id ||
                hasAnyCompoundPriceTierOnSubItems(rawCard.sub_items, rawCard.promo_price)
            ),
            has_different_packaging_across_entries:
              rawCard.sub_items.length > 1 &&
              (new Set(
                rawCard.sub_items.map(
                  (s) => `${s.each_size_value ?? ''}:${s.each_size_unit ?? ''}:${s.manufacturer_pack_count ?? ''}`
                )
              ).size > 1 ||
                Boolean(rawCard.compound_group_id)),
            inherited_caption_attributes_requiring_override: []
          }
        : null,
      extraction_confidence: cardConf,
      evidence_conflicts: mapRawConflictCodes(rawCard.evidence_conflicts),
      evidence_ledger: ledger,
      printed_retailer_sku_codes: rawCard.printed_retailer_sku_codes
    };

    cards.push(record);
  }

  return {
    schemaValid: true,
    schemaErrors: [],
    rawExtraction: page,
    cards
  };
}

