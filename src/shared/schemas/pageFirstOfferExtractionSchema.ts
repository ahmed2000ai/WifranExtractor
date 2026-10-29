import { z } from 'zod';

export const pageFirstRegionHintSchema = z.enum([
  'top_left',
  'top',
  'top_right',
  'middle_left',
  'middle',
  'middle_right',
  'bottom_left',
  'bottom',
  'bottom_right',
  'unknown'
]);

export const pageFirstItemDomainSchema = z.enum([
  'grocery',
  'household',
  'personal_care',
  'electronics',
  'appliance',
  'other_non_grocery',
  'unknown'
]);

export const pageFirstPriceRoleSchema = z.enum([
  'current_offer_price',
  'original_old_price',
  'multi_buy_total_price',
  'loyalty_price',
  'ambiguous_price',
  'not_a_price'
]);

export const pageFirstSizeUnitSchema = z.enum([
  'liter',
  'milliliter',
  'kilogram',
  'gram',
  'piece',
  'dozen',
  'inch',
  'other'
]).nullable();

export const pageFirstPriceBasisSchema = z.enum([
  'each',
  'per_pack',
  'per_box',
  'per_bag',
  'per_kg',
  'per_2kg',
  'per_dozen',
  'bundle',
  'multi_buy',
  'unknown'
]);

export const pageFirstPromotionMechanicSchema = z.enum([
  'standard_price',
  'bogo',
  'bundle',
  'multi_buy',
  'loyalty_required',
  'selected_branches',
  'unknown'
]);

export const pageFirstConfidenceLevelSchema = z.enum(['high', 'medium', 'low']);

export const pageFirstPriceCandidateSchema = z.object({
  raw_text: z.string(),
  normalized_value: z.number().nullable(),
  currency: z.literal('SAR').nullable(),
  role: pageFirstPriceRoleSchema,
  is_crossed_out: z.boolean().nullable(),
  confidence: pageFirstConfidenceLevelSchema,
  evidence_text: z.string()
}).strict();

export const pageFirstExtractedOfferSchema = z.object({
  temporary_offer_id: z.string(),
  region_hint: pageFirstRegionHintSchema,
  product: z.object({
    title_ar: z.string().nullable(),
    title_en: z.string().nullable(),
    brand_text: z.string().nullable(),
    description_ar: z.string().nullable(),
    description_en: z.string().nullable(),
    item_domain: pageFirstItemDomainSchema,
    variant_names: z.array(z.string())
  }).strict(),
  price_candidates: z.array(pageFirstPriceCandidateSchema),
  selected_prices: z.object({
    offer_price: z.number().nullable(),
    original_price: z.number().nullable(),
    currency: z.literal('SAR').nullable(),
    offer_price_raw_text: z.string().nullable(),
    original_price_raw_text: z.string().nullable(),
    confidence: pageFirstConfidenceLevelSchema
  }).strict(),
  content: z.object({
    size_text: z.string().nullable(),
    each_size_value: z.number().nullable(),
    each_size_unit: pageFirstSizeUnitSchema,
    pack_quantity: z.number().nullable(),
    bundle_quantity: z.number().nullable(),
    total_content_value: z.number().nullable(),
    total_content_unit: pageFirstSizeUnitSchema
  }).strict(),
  price_basis: z.object({
    basis: pageFirstPriceBasisSchema,
    raw_text: z.string().nullable()
  }).strict(),
  promotion: z.object({
    mechanic: pageFirstPromotionMechanicSchema,
    raw_text: z.string().nullable(),
    condition_text: z.string().nullable()
  }).strict(),
  evidence: z.object({
    title_texts: z.array(z.string()),
    description_texts: z.array(z.string()),
    current_price_texts: z.array(z.string()),
    original_price_texts: z.array(z.string()),
    size_content_texts: z.array(z.string()),
    promotion_texts: z.array(z.string()),
    final_evidence_summary: z.string()
  }).strict(),
  confidence: z.object({
    overall: pageFirstConfidenceLevelSchema,
    product_identity: pageFirstConfidenceLevelSchema,
    current_price: pageFirstConfidenceLevelSchema,
    original_price: pageFirstConfidenceLevelSchema,
    size_content: pageFirstConfidenceLevelSchema,
    promotion: pageFirstConfidenceLevelSchema
  }).strict(),
  warnings: z.array(z.object({
    code: z.string(),
    message: z.string(),
    blocking: z.boolean()
  }).strict())
}).strict();

export const pageFirstUncertainRegionSchema = z.object({
  region_hint: pageFirstRegionHintSchema,
  reason: z.enum([
    'possible_unread_offer',
    'ambiguous_price',
    'ambiguous_product_group',
    'possible_shared_price',
    'low_visual_confidence',
    'other'
  ]),
  description: z.string()
}).strict();

export const pageFirstPageSummarySchema = z.object({
  independent_offer_count: z.number(),
  independent_current_price_anchor_count: z.number(),
  offers_with_original_price_count: z.number(),
  offers_with_size_or_content_count: z.number(),
  bundle_or_multi_buy_count: z.number(),
  low_confidence_offer_count: z.number(),
  final_completeness_check_performed: z.boolean()
}).strict();

export const pageFirstOfferExtractionSchema = z.object({
  schema_version: z.literal(1),
  page_number: z.number(),
  page_classification: z.enum([
    'offer_page',
    'cover',
    'advertisement',
    'terms',
    'blank',
    'mixed',
    'unknown'
  ]),
  offers: z.array(pageFirstExtractedOfferSchema),
  uncertain_regions: z.array(pageFirstUncertainRegionSchema),
  page_summary: pageFirstPageSummarySchema
}).strict();
