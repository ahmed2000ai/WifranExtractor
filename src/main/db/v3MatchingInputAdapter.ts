/**
 * WIFRAN-EXTRACTOR-IDENTITY-005D (WP4 Stage 1)
 * Offline V3-to-Matching Adapter & WP2-R1 Consumer Publication Compatibility Bridge.
 *
 * Strictly offline. Never invokes paid Gemini calls, auto-verifies temporary products,
 * writes to DB, or exposes private V3 evidence/crops into frozen `wifran.extractor.offer/2.0`.
 */

import type { UnifiedBatchOffer } from '../../shared/types/batchExtraction';
import type {
  NonCatalogOfferApproval,
  NormalizedIdentityAttributes,
  OfferPublicationAssessment
} from '../../shared/types/catalogMatching';
import type {
  DecomposedSubItemCandidateV3,
  SubItemV3,
  V3DecompositionResult
} from '../../shared/types/extractorContractV3';
import {
  assessOfferPublicationOutcome,
  type TrustedStorageEnvironment,
  sanitizeConsumerContractV2Assets,
  sanitizePublicConsumerImageUrl
} from '../../shared/utils/nonCatalogPublicationPolicy';
import { BrandGroupingService } from './brandGroupingService';
import { evaluateIdentitySufficiency } from './productIdentityPolicy';
import { FACTUAL_PUBLICATION_CONFLICT_CODES } from '../ocr/offerV3DecompositionEngine';

export interface V3MatchableChildCandidate {
  parent_source_offer_id: string;
  sub_item_ref: string;
  candidate_key: string;
  decomposition_basis: DecomposedSubItemCandidateV3['decomposition_basis'];
  source_evidence_refs: string[];
  pricing_mode: DecomposedSubItemCandidateV3['pricing_mode'];
  offerInput: UnifiedBatchOffer;
  normalizedIdentity: NormalizedIdentityAttributes;
  deduplicationKey: string;
  retailerSkuCode: string | null;
  requiresOperatorApproval: true;
  autoVerifiedTemporaryProduct: false;
}

export interface V3UnresolvedChildCandidate {
  parent_source_offer_id: string;
  sub_item_ref: string;
  reasons: string[];
  rawSubItem?: SubItemV3;
}

export interface V3OfflineAdapterResult {
  parent_source_offer_id: string;
  matchableChildren: V3MatchableChildCandidate[];
  unresolvedChildren: V3UnresolvedChildCandidate[];
  parentOfferForPolicyCheck: UnifiedBatchOffer;
  parentPublicationAssessment: OfferPublicationAssessment;
  operatorReviewRequired: true;
  localStagingV3Summary: {
    schema_version: 'wifran.extractor.card/3.0';
    parent_source_offer_id: string;
    decomposed: boolean;
    retention_mode: V3DecompositionResult['parent_offer_retention_mode'];
    matchable_child_keys: string[];
    printed_retailer_sku_codes: string[];
    sanitized_public_image_url: string | null;
  };
}

function buildDeduplicationKeyForV3Child(
  attrs: NormalizedIdentityAttributes,
  child: DecomposedSubItemCandidateV3
): string {
  const variantPart = (attrs.variantOrFlavor || child.variant_or_flavor || 'base')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const sizePart = `${child.each_size_value}${child.each_size_unit}`;
  const packPart = `pk${child.manufacturer_pack_count}`;
  const sufficientSuffix = attrs.isIdentitySufficient ? '' : `:ambiguous:${child.candidate_key}`;
  return `${attrs.brandKey}::${variantPart}::${sizePart}::${packPart}::${child.parent_source_offer_id}${sufficientSuffix}`;
}

export function adaptV3DecompositionToOfflineMatching(
  decomposition: V3DecompositionResult,
  options?: {
    batchId?: string;
    candidatePublicImageUrl?: string | null;
    matchedProductId?: string | null;
    contractV2AssetsCandidate?: unknown;
    nonCatalogApproval?: NonCatalogOfferApproval | null;
    storageEnvironment?: TrustedStorageEnvironment;
    enforceNonExpiredForPublication?: boolean;
    publicationReferenceDateIso?: string | null;
    requireUnconditionalPriceForPublication?: boolean;
  }
): V3OfflineAdapterResult {
  const batchId = options?.batchId || 'v3_offline_stage1';
  const card = decomposition.normalized_card;
  const src = card.source_card;
  const grouping = new BrandGroupingService();

  const sanitizedPublicImageUrl = sanitizePublicConsumerImageUrl(
    options?.candidatePublicImageUrl ?? null,
    options?.storageEnvironment ?? 'AUTO'
  );
  const sanitizedContractV2Assets = options?.contractV2AssetsCandidate
    ? sanitizeConsumerContractV2Assets(options.contractV2AssetsCandidate, options?.storageEnvironment ?? 'AUTO')
    : undefined;

  const matchableChildren: V3MatchableChildCandidate[] = [];
  const unresolvedChildren: V3UnresolvedChildCandidate[] = [];

  for (const child of decomposition.children) {
    const titleEn = child.product_name_en || '';
    const titleAr = child.product_name_ar || '';
    const brandDisplay = child.brand_en || child.brand_ar || null;
    const isMultiPack = child.manufacturer_pack_count > 1;

    const offerInput: UnifiedBatchOffer = {
      batchOfferKey: `${batchId}:${src.leaflet_id}:p${src.page_number}:${child.candidate_key}`,
      batchId,
      leafletId: src.leaflet_id,
      sourceFileName: `${src.leaflet_id}.v3.json`,
      sourcePdfPath: '',
      sourcePage: src.page_number,
      sourceOfferId: child.candidate_key,
      canonicalSourceId: child.candidate_key,
      supermarketId: child.retailer_id,
      supermarketName: child.retailer_name,
      locationScope: child.location_scope,
      locationLabel: null,
      cityId: src.city_id,
      regionId: src.region_id,
      offerStartDate: child.offer_start_date,
      offerEndDate: child.offer_end_date,
      titleAr,
      titleEn,
      brand: brandDisplay,
      brandAr: child.brand_ar,
      brandEn: child.brand_en,
      variantOrFlavor: child.variant_or_flavor,
      promoPrice: child.parent_promo_price,
      originalPrice: child.parent_original_price,
      discountPercent: null,
      promoNotes: child.promo_conditions,
      sizeOrWeight:
        child.manufacturer_pack_count > 1
          ? `${child.manufacturer_pack_count}x${child.each_size_value}${child.each_size_unit}`
          : `${child.each_size_value}${child.each_size_unit}`,
      each_size_value: child.each_size_value,
      each_size_unit: child.each_size_unit,
      inner_pack_count: child.manufacturer_pack_count,
      sale_unit_type: isMultiPack ? 'pack' : 'piece',
      total_content_value: child.each_size_value * child.manufacturer_pack_count,
      total_content_unit: child.each_size_unit,
      free_units_text:
        card.quantity_and_promo.factory_bonus_paid_qty && card.quantity_and_promo.factory_bonus_free_qty
          ? `${card.quantity_and_promo.factory_bonus_paid_qty}+${card.quantity_and_promo.factory_bonus_free_qty} Free`
          : null,
      customer_limit: child.customer_limit_pcs,
      promo_condition_quantity: child.retailer_checkout_multibuy_qty,
      promotion_mechanic: child.retailer_checkout_multibuy_qty ? 'multi_buy' : 'standard_price',
      bundle_quantity: null,
      quantity_semantics:
        !isMultiPack && child.retailer_checkout_multibuy_qty && child.retailer_checkout_multibuy_qty >= 2
          ? 'checkout_multibuy'
          : isMultiPack
            ? 'manufacturer_multipack'
            : undefined,
      assortment_status: 'single_sku',
      matchingEvidence: null,
      // Keep private evidence strictly out of adapter public images
      productThumbCropPath: null,
      offerCardCropPath: null,
      status: 'extracted',
      confidence: card.extraction_confidence,
      canonical: {
        trusted_context: {
          supermarket_id: child.retailer_id,
          offer_start_date: child.offer_start_date,
          offer_end_date: child.offer_end_date,
          location_scope: child.location_scope,
          currency: child.currency
        },
        product: {
          variant_or_flavor: child.variant_or_flavor,
          item_domain: card.non_grocery_specs.domain,
          commodity_tag: card.category_evidence?.commodity_tag ?? null,
          category_hint: card.category_evidence?.category_hint ?? null
        },
        prices: {
          offer_price: child.parent_promo_price,
          original_price: child.parent_original_price,
          currency: child.currency
        },
        price_terms: {
          pricing_mode: child.pricing_mode,
          price_basis: card.pricing.price_basis,
          sale_basis: card.quantity_and_promo.sale_basis,
          loyalty_required: Boolean(card.quantity_and_promo.loyalty_required),
          loyalty_program_name: card.quantity_and_promo.loyalty_program_name ?? null,
          retailer_checkout_multibuy_qty: child.retailer_checkout_multibuy_qty,
          promo_conditions: child.promo_conditions ?? card.pricing.promo_conditions ?? null,
          price_role_confidence: card.pricing.price_role_confidence,
          is_conditional_price:
            Boolean(card.quantity_and_promo.loyalty_required) ||
            card.pricing.price_basis === 'buy_n' ||
            (child.retailer_checkout_multibuy_qty != null && child.retailer_checkout_multibuy_qty >= 2) ||
            card.pricing.price_role_confidence === 'low' ||
            card.pricing.price_basis === 'unknown',
          explicit_condition_verified:
            Boolean(card.quantity_and_promo.loyalty_program_name) ||
            Boolean(child.promo_conditions ?? card.pricing.promo_conditions) ||
            (Boolean(card.quantity_and_promo.loyalty_required) &&
              card.pricing.price_basis === 'buy_n' &&
              child.retailer_checkout_multibuy_qty != null &&
              child.retailer_checkout_multibuy_qty >= 2),
          currency: child.currency
        },
        ...(sanitizedContractV2Assets ? { contract_v2_assets_sanitized: sanitizedContractV2Assets } : {})
      }
    };

    const attrs = grouping.extractNormalizedAttributes(offerInput);
    const sufficiency = evaluateIdentitySufficiency(attrs, offerInput, null);

    if (sufficiency.isSufficient) {
      matchableChildren.push({
        parent_source_offer_id: child.parent_source_offer_id,
        sub_item_ref: child.sub_item_ref,
        candidate_key: child.candidate_key,
        decomposition_basis: child.decomposition_basis,
        source_evidence_refs: child.source_evidence_refs,
        pricing_mode: child.pricing_mode,
        offerInput,
        normalizedIdentity: attrs,
        deduplicationKey: buildDeduplicationKeyForV3Child(attrs, child),
        retailerSkuCode: child.printed_retailer_sku_code,
        requiresOperatorApproval: true,
        autoVerifiedTemporaryProduct: false
      });
    } else {
      unresolvedChildren.push({
        parent_source_offer_id: child.parent_source_offer_id,
        sub_item_ref: child.sub_item_ref,
        reasons: sufficiency.reasons.length > 0 ? sufficiency.reasons : ['Child failed identity sufficiency gate.']
      });
    }
  }

  for (const unres of decomposition.unresolved_sub_items) {
    unresolvedChildren.push({
      parent_source_offer_id: decomposition.parent_source_offer_id,
      sub_item_ref: unres.sub_item_ref,
      reasons:
        decomposition.rejection_reasons.length > 0
          ? decomposition.rejection_reasons
          : unres.unknown_attributes.length > 0
            ? [`Unknown attributes: ${unres.unknown_attributes.join(', ')}`]
            : ['Parent offer did not safely decompose.'],
      rawSubItem: unres
    });
  }

  // Build parent UnifiedBatchOffer strictly compatible with frozen WP2 / WP2-R1 publication policy
  const parentAssortmentPolicyStatus =
    card.assortment.status === 'confirmed_single_sku'
      ? 'single_sku'
      : card.assortment.status === 'explicit_assortment' || card.assortment.status === 'visual_multiple_variants'
        ? 'multiple_variants'
        : 'unknown_composition';

  const parentOfferForPolicyCheck: UnifiedBatchOffer = {
    batchOfferKey: `${batchId}:${src.leaflet_id}:p${src.page_number}:${src.source_offer_id}`,
    batchId,
    leafletId: src.leaflet_id,
    sourceFileName: `${src.leaflet_id}.v3.json`,
    sourcePdfPath: '',
    sourcePage: src.page_number,
    sourceOfferId: src.source_offer_id,
    canonicalSourceId: src.source_offer_id,
    supermarketId: src.retailer_id,
    supermarketName: src.retailer_name,
    locationScope: src.location_scope,
    locationLabel: null,
    cityId: src.city_id,
    regionId: src.region_id,
    offerStartDate: src.offer_start_date,
    offerEndDate: src.offer_end_date,
    titleAr: src.raw_text.title_ar || '',
    titleEn: src.raw_text.title_en || '',
    brand: card.sub_items[0]?.brand_en || card.sub_items[0]?.brand_ar || null,
    brandAr: card.sub_items[0]?.brand_ar || null,
    brandEn: card.sub_items[0]?.brand_en || null,
    promoPrice: card.pricing.promo_price,
    originalPrice: card.pricing.original_price,
    discountPercent: null,
    promoNotes: card.pricing.promo_conditions,
    sizeOrWeight: src.raw_text.size_text,
    each_size_value: card.quantity_and_promo.each_size_value,
    each_size_unit: card.quantity_and_promo.each_size_unit,
    inner_pack_count: card.quantity_and_promo.manufacturer_pack_count,
    sale_unit_type: card.quantity_and_promo.is_per_weight_pricing
      ? 'kg'
      : card.quantity_and_promo.manufacturer_pack_count && card.quantity_and_promo.manufacturer_pack_count > 1
        ? 'pack'
        : 'piece',
    total_content_value:
      card.quantity_and_promo.each_size_value && card.quantity_and_promo.manufacturer_pack_count
        ? card.quantity_and_promo.each_size_value * card.quantity_and_promo.manufacturer_pack_count
        : null,
    total_content_unit: card.quantity_and_promo.each_size_unit,
    free_units_text: null,
    customer_limit: card.quantity_and_promo.customer_limit_pcs,
    promo_condition_quantity: card.quantity_and_promo.retailer_checkout_multibuy_qty,
    promotion_mechanic: card.quantity_and_promo.retailer_checkout_multibuy_qty ? 'multi_buy' : 'standard_price',
    bundle_quantity: null,
    quantity_semantics:
      decomposition.conflict_codes.includes('PROMO_QTY_VS_MFG_PACK_CONFLICT') ||
      decomposition.conflict_codes.includes('COMPOUND_SHARED_CAPTION_CONFLICT')
        ? 'ambiguous'
        : card.quantity_and_promo.manufacturer_pack_count && card.quantity_and_promo.manufacturer_pack_count > 1
          ? 'manufacturer_multipack'
          : undefined,
    assortment_status: parentAssortmentPolicyStatus,
    matchingEvidence: null,
    productThumbCropPath: null,
    offerCardCropPath: null,
    status: 'extracted',
    confidence: card.extraction_confidence,
    canonical: {
      schema_version: card.schema_version,
      parent_offer_retention_mode: decomposition.parent_offer_retention_mode,
      trusted_context: {
        supermarket_id: src.retailer_id,
        offer_start_date: src.offer_start_date,
        offer_end_date: src.offer_end_date,
        location_scope: src.location_scope,
        currency: card.pricing.currency
      },
      product: {
        item_domain: card.non_grocery_specs.domain,
        commodity_tag: card.category_evidence?.commodity_tag ?? null,
        category_hint: card.category_evidence?.category_hint ?? null
      },
      prices: {
        offer_price: card.pricing.promo_price,
        original_price: card.pricing.original_price,
        currency: card.pricing.currency
      },
      price_terms: {
        price_basis: card.pricing.price_basis,
        sale_basis: card.quantity_and_promo.sale_basis,
        loyalty_required: Boolean(card.quantity_and_promo.loyalty_required),
        loyalty_program_name: card.quantity_and_promo.loyalty_program_name ?? null,
        retailer_checkout_multibuy_qty: card.quantity_and_promo.retailer_checkout_multibuy_qty ?? null,
        promo_conditions: card.pricing.promo_conditions ?? null,
        price_role_confidence: card.pricing.price_role_confidence,
        is_conditional_price:
          Boolean(card.quantity_and_promo.loyalty_required) ||
          card.pricing.price_basis === 'buy_n' ||
          (card.quantity_and_promo.retailer_checkout_multibuy_qty != null &&
            card.quantity_and_promo.retailer_checkout_multibuy_qty >= 2) ||
          card.pricing.price_role_confidence === 'low' ||
          card.pricing.price_basis === 'unknown',
        explicit_condition_verified:
          Boolean(card.quantity_and_promo.loyalty_program_name) ||
          Boolean(card.pricing.promo_conditions) ||
          (Boolean(card.quantity_and_promo.loyalty_required) &&
            card.pricing.price_basis === 'buy_n' &&
            card.quantity_and_promo.retailer_checkout_multibuy_qty != null &&
            card.quantity_and_promo.retailer_checkout_multibuy_qty >= 2),
        currency: card.pricing.currency
      }
    }
  };

  const factualConflictCodes = decomposition.conflict_codes.filter((code) =>
    FACTUAL_PUBLICATION_CONFLICT_CODES.has(code)
  );
  const parentQuarantinedByV3 =
    decomposition.parent_offer_retention_mode === 'quarantined_do_not_publish' ||
    factualConflictCodes.length > 0 ||
    decomposition.normalized_card.pricing.currency !== 'SAR' ||
    decomposition.normalized_card.non_grocery_specs.excluded_from_default_grocery_feed;

  if (parentQuarantinedByV3) {
    matchableChildren.length = 0;
  }

  const parentPublicationAssessment = assessOfferPublicationOutcome({
    offer: {
      ...parentOfferForPolicyCheck,
      currency: card.pricing.currency
    } as any,
    approval: options?.nonCatalogApproval ?? null,
    knownConflictFlags: [
      ...factualConflictCodes,
      ...(decomposition.conflict_codes.includes('PRICE_ROLE_AMBIGUOUS') ? ['PRICE_ROLE_AMBIGUOUS'] : []),
      ...(decomposition.parent_offer_retention_mode === 'quarantined_do_not_publish'
        ? ['V3_PARENT_OFFER_QUARANTINED']
        : [])
    ],
    enforceNonExpiredForPublication: options?.enforceNonExpiredForPublication,
    publicationReferenceDateIso: options?.publicationReferenceDateIso,
    requireUnconditionalPriceForPublication: options?.requireUnconditionalPriceForPublication
  });

  // Unbypassable V3 quarantine invariant: quarantined parents must NEVER become eligible/publishable
  if (parentQuarantinedByV3) {
    parentPublicationAssessment.outcome = 'quarantined';
    parentPublicationAssessment.catalogMatchStatus = 'conflict_needs_review';
    parentPublicationAssessment.isEligibleForNonCatalogPublication = false;
    parentPublicationAssessment.isSafeForNonCatalogPublication = false;
    parentPublicationAssessment.comparisonDisabled = true;
    const quarantineMarkers =
      factualConflictCodes.length > 0 ? factualConflictCodes : ['V3_PARENT_OFFER_QUARANTINED'];
    for (const code of quarantineMarkers) {
      if (!parentPublicationAssessment.quarantineReasons.includes(code)) {
        parentPublicationAssessment.quarantineReasons.push(code);
      }
    }
  }

  return {
    parent_source_offer_id: decomposition.parent_source_offer_id,
    matchableChildren,
    unresolvedChildren,
    parentOfferForPolicyCheck,
    parentPublicationAssessment,
    operatorReviewRequired: true,
    localStagingV3Summary: {
      schema_version: 'wifran.extractor.card/3.0',
      parent_source_offer_id: decomposition.parent_source_offer_id,
      decomposed: decomposition.decomposed,
      retention_mode: decomposition.parent_offer_retention_mode,
      matchable_child_keys: matchableChildren.map((c) => c.candidate_key),
      printed_retailer_sku_codes: card.printed_retailer_sku_codes,
      sanitized_public_image_url: sanitizedPublicImageUrl
    }
  };
}
