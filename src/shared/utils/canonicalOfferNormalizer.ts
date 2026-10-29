import { CanonicalOffer, CanonicalPriceCandidate } from '../types/canonicalOffer'
import { isCandidateItemOcrResponse, CandidateItemOcrResponse } from '../schemas/itemOcrSchema'
import { parsePrice, calculateDiscountAmount, calculateDiscountPercentage } from './priceParsing'
import { normalizePackUnit } from './unitNormalization'
import { mapLegacyOcrFieldsToCanonical } from './legacyOcrFieldMapper'

function createDefaultCanonicalOffer(sourceItemNumber: string, originalJson: any): CanonicalOffer {
  return {
    source: {
      leaflet_id: null,
      source_page_number: null,
      source_item_number: sourceItemNumber,
      external_image_id: null,
    },
    trusted_context: {
      supermarket_id: null,
      location_scope: null,
      city_id: null,
      region_id: null,
      offer_start_date: null,
      offer_end_date: null,
    },
    product: {
      title_ar: null,
      title_en: null,
      brand_text: null,
      category_hint: null,
      item_domain: 'unknown',
      description_ar: null,
      description_en: null,
    },
    prices: {
      offer_price: null,
      original_price: null,
      currency: null,
      discount_amount: null,
      discount_percentage: null,
      price_basis: 'unknown',
      price_condition_text: null,
      all_price_candidates: [],
    },
    content: {
      size_text: null,
      pack_quantity: null,
      bundle_quantity: null,
      each_size_value: null,
      each_size_unit: null,
      total_content_value: null,
      total_content_unit: null,
    },
    promotion: {
      mechanic: 'unknown',
      special_offer: null,
      condition_text: null,
      bundle_quantity: null,
    },
    comparison: {
      comparison_eligible: false,
      comparison_unit: null,
      comparison_unit_price: null,
      comparison_confidence: 'low',
      comparison_exclusion_reason: null,
    },
    image: {
      image_bucket: null,
      image_path: null,
      image_url: null,
      image_source_type: null,
    },
    display: {
      show_display_unit_price: false,
      display_unit_price: null,
      display_unit_basis_value: null,
      display_unit_basis_unit: null,
      display_unit_family: null,
      display_unit_price_label_ar: null,
      display_unit_price_label_en: null,
      below_min_display_price_threshold: false,
      min_display_unit_price_sar: 0.50,
      hidden_reason: 'comparison_not_eligible',
    },
    quality: {
      publish_decision: 'skip_or_quarantine',
      extraction_confidence: 'low',
      validation_confidence: 'not_run',
      comparison_confidence: 'low',
      blocking_errors: [],
      non_blocking_warnings: [],
    },
    style_validation: {
      validation_result: 'not_run',
      visual_evidence: {},
      corrected_fields: {},
      style_profile_scope: 'none',
    },
    pre_publish: {
      preview_eligible: false,
      preview_group: 'skip_or_quarantine',
      display_in_preview: true,
    },
    raw: {
      raw_ocr_json: originalJson || {},
      raw_validation_json: null,
      raw_ocr_text: null,
      raw_attributes: {},
    },
  }
}

export function normalizeCandidateItemOcrResponse(
  parsed: CandidateItemOcrResponse,
  canonical: CanonicalOffer
): void {
  // Product Text
  canonical.product.title_ar = parsed.product_text?.title_ar || null
  canonical.product.title_en = parsed.product_text?.title_en || null
  canonical.product.description_ar = parsed.product_text?.description_ar || null
  canonical.product.description_en = parsed.product_text?.description_en || null
  canonical.product.brand_text = parsed.product_text?.brand_text || null
  canonical.product.category_hint = parsed.product_text?.category_hint || null
  if (parsed.product_text?.item_domain) {
    canonical.product.item_domain = parsed.product_text.item_domain as any
  }

  // Price Candidates
  if (Array.isArray(parsed.price_candidates)) {
    canonical.prices.all_price_candidates = parsed.price_candidates as CanonicalPriceCandidate[]
  }

  // Selected Prices
  canonical.prices.offer_price = parsePrice(parsed.selected_prices?.offer_price)
  canonical.prices.original_price = parsePrice(parsed.selected_prices?.original_price)
  canonical.prices.currency = parsed.selected_prices?.currency || (canonical.prices.offer_price ? 'SAR' : null)
  canonical.prices.discount_amount = calculateDiscountAmount(canonical.prices.offer_price, canonical.prices.original_price)
  canonical.prices.discount_percentage = calculateDiscountPercentage(canonical.prices.offer_price, canonical.prices.original_price)
  
  if (parsed.selected_prices?.offer_price_source_raw_text) {
    canonical.raw.raw_attributes.offer_price_source_raw_text = parsed.selected_prices.offer_price_source_raw_text
  }
  if (parsed.selected_prices?.original_price_source_raw_text) {
    canonical.raw.raw_attributes.original_price_source_raw_text = parsed.selected_prices.original_price_source_raw_text
  }

  // Size Candidates
  if (Array.isArray(parsed.size_candidates)) {
    canonical.raw.raw_attributes.size_candidates = parsed.size_candidates
  }

  // Content
  if (parsed.content) {
    canonical.content.size_text = parsed.content.size_text || null
    canonical.content.pack_quantity = parsePrice(parsed.content.pack_quantity) || null
    canonical.content.bundle_quantity = parsePrice(parsed.content.bundle_quantity) || null
    canonical.content.each_size_value = parsePrice(parsed.content.each_size_value) || null
    canonical.content.each_size_unit = normalizePackUnit(parsed.content.each_size_unit as string) as any
    canonical.content.total_content_value = parsePrice(parsed.content.total_content_value) || null
    canonical.content.total_content_unit = normalizePackUnit(parsed.content.total_content_unit as string) as any
  }

  // Price Basis
  if (parsed.price_basis) {
    canonical.prices.price_basis = (parsed.price_basis.basis as any) || 'unknown'
    canonical.prices.price_condition_text = parsed.price_basis.raw_text || null
  }

  // Promotion
  if (parsed.promotion) {
    canonical.promotion.mechanic = (parsed.promotion.mechanic as any) || 'unknown'
    canonical.promotion.special_offer = parsed.promotion.raw_text || null
    canonical.promotion.condition_text = parsed.promotion.condition_text || null
    canonical.promotion.bundle_quantity = parsePrice(parsed.promotion.bundle_quantity) || null
    if (canonical.promotion.bundle_quantity && !canonical.content.bundle_quantity) {
      canonical.content.bundle_quantity = canonical.promotion.bundle_quantity
    }
  }

  // Quality & Warnings
  if (parsed.confidence?.overall) {
    canonical.quality.extraction_confidence = parsed.confidence.overall as any
  }
  if (parsed.warnings?.blocking) {
    canonical.quality.blocking_errors.push(...parsed.warnings.blocking)
  }
  if (parsed.warnings?.non_blocking) {
    canonical.quality.non_blocking_warnings.push(...parsed.warnings.non_blocking)
  }

  // Preserved Raw Attributes
  if (parsed.raw_attributes?.additional_visible_fields) {
    canonical.raw.raw_attributes = {
      ...canonical.raw.raw_attributes,
      ...parsed.raw_attributes.additional_visible_fields
    }
  }
}

export function normalizeToCanonicalOffer(input: {
  rawOcrJson: unknown;
  source: {
    leafletId?: string | null;
    sourcePageNumber?: number | null;
    sourceItemNumber: string;
    externalImageId?: string | null;
    cropPath?: string | null;
    jsonPath?: string | null;
  };
  trustedContext?: {
    supermarketId?: string | null;
    supermarketSlug?: string | null;
    locationScope?: 'national' | 'region' | 'city' | null;
    cityId?: string | null;
    regionId?: string | null;
    offerStartDate?: string | null;
    offerEndDate?: string | null;
  };
  image?: {
    imageBucket?: string | null;
    imagePath?: string | null;
    imageUrl?: string | null;
    imageSourceType?: string | null;
  };
}): CanonicalOffer {
  
  const canonical = createDefaultCanonicalOffer(input.source.sourceItemNumber, input.rawOcrJson)
  
  // Fill metadata
  canonical.source.leaflet_id = input.source.leafletId || null
  canonical.source.source_page_number = input.source.sourcePageNumber || null
  canonical.source.external_image_id = input.source.externalImageId || null
  canonical.source.crop_path = input.source.cropPath || null
  canonical.source.json_path = input.source.jsonPath || null

  if (input.trustedContext) {
    canonical.trusted_context.supermarket_id = input.trustedContext.supermarketId || null
    canonical.trusted_context.supermarket_slug = input.trustedContext.supermarketSlug || null
    canonical.trusted_context.location_scope = input.trustedContext.locationScope || null
    canonical.trusted_context.city_id = input.trustedContext.cityId || null
    canonical.trusted_context.region_id = input.trustedContext.regionId || null
    canonical.trusted_context.offer_start_date = input.trustedContext.offerStartDate || null
    canonical.trusted_context.offer_end_date = input.trustedContext.offerEndDate || null
  }

  if (input.image) {
    canonical.image.image_bucket = input.image.imageBucket || null
    canonical.image.image_path = input.image.imagePath || null
    canonical.image.image_url = input.image.imageUrl || null
    canonical.image.image_source_type = input.image.imageSourceType || null
  }

  if (typeof input.rawOcrJson === 'object' && input.rawOcrJson !== null) {
    if (isCandidateItemOcrResponse(input.rawOcrJson)) {
      normalizeCandidateItemOcrResponse(input.rawOcrJson as CandidateItemOcrResponse, canonical)
    } else {
      mapLegacyOcrFieldsToCanonical(input.rawOcrJson as Record<string, unknown>, canonical)
    }
  } else {
    canonical.quality.blocking_errors.push({
      code: 'INVALID_OCR_JSON',
      message: 'OCR response is not a valid JSON object',
      severity: 'error'
    })
  }

  // Basic missing price check mapped to canonical (if no blocking error already caught it)
  if (canonical.prices.offer_price === null) {
    canonical.quality.blocking_errors.push({
      code: 'MISSING_OFFER_PRICE',
      message: 'Could not read offer price from image',
      severity: 'error',
      field_name: 'offer_price'
    })
  }

  // Publish Decision
  if (canonical.quality.blocking_errors.length > 0 || !canonical.product.title_ar) {
    canonical.quality.publish_decision = 'skip_or_quarantine'
  } else {
    // We defer advanced decision making to later chunks.
    canonical.quality.publish_decision = 'skip_or_quarantine'
  }

  return canonical
}
