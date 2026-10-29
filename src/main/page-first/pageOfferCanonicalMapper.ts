import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { PageFirstExtractedOffer } from '../../shared/types/pageFirstOfferExtraction';
import type { AutomaticOfferCrop } from '../../shared/types/automaticOfferCrop';
import type { PageOfferEvidenceLink } from '../../shared/types/pageOfferEvidenceLink';
import type { CanonicalOffer, CanonicalPriceCandidate, CanonicalQualityIssue } from '../../shared/types/canonicalOffer';
import { runDeterministicOfferChecks } from '../../shared/utils/deterministicOfferChecks';
import { evaluateComparisonSafety } from '../../shared/utils/comparisonSafety';
import { decidePublishAction, applyPublishDecisionToCanonicalOffer } from '../../shared/utils/publishDecisionEngine';
import { calculateDiscountAmount, calculateDiscountPercentage } from '../../shared/utils/priceParsing';
import { parseAndNormalizeQuantity, toCanonicalOfferUnit, detectItemDomainFromTitle } from '../../shared/utils/priceAndUnitNormalizer';
import { buildContractV2FromCanonical, buildSourceOfferId } from '../../shared/utils/extractorContractV2Adapter';
export { buildSourceOfferId };

export type TrustedLeafletContext = {
  supermarketId: string | null;
  supermarketSlug?: string | null;
  locationScope: 'national' | 'region' | 'city' | null;
  cityId: string | null;
  regionId: string | null;
  offerStartDate: string | null;
  offerEndDate: string | null;
  leafletId: string | null;
};

export type MapPageOfferToCanonicalInput = {
  offer: PageFirstExtractedOffer;
  crop: AutomaticOfferCrop;
  link: PageOfferEvidenceLink;
  cropFilePath: string | null;
  pageNumber: number;
  pdfBaseName: string;
  packageDir: string;
  trustedContext: TrustedLeafletContext;
  itemNumberOverride?: string;
  rawMetadata?: {
    rawOcrJson?: any;
    rawAnnotationJson?: any;
    completenessStatus?: string;
    isRetry?: boolean;
  };
};

export function mapPageOfferToCanonical(input: MapPageOfferToCanonicalInput): CanonicalOffer {
  const {
    offer,
    crop,
    link,
    cropFilePath,
    pageNumber,
    pdfBaseName,
    packageDir,
    trustedContext,
    itemNumberOverride,
    rawMetadata = {}
  } = input;

  const itemNumber = itemNumberOverride || crop.source_item_number;
  const pagePadded = String(pageNumber).padStart(3, '0');

  // Convert price candidates
  const allPriceCandidates: CanonicalPriceCandidate[] = (offer.price_candidates || []).map(pc => ({
    raw_text: pc.raw_text,
    normalized_value: pc.normalized_value,
    currency: pc.currency,
    visual_role: pc.role,
    classified_as: pc.role === 'current_offer_price' ? 'offer_price' : pc.role === 'original_old_price' ? 'original_price' : 'not_a_price',
    confidence: pc.confidence,
    evidence: pc.evidence_text,
    visual_evidence: {}
  }));

  const offerPrice = offer.selected_prices?.offer_price ?? null;
  const originalPrice = offer.selected_prices?.original_price ?? null;

  const discountAmount = calculateDiscountAmount(originalPrice, offerPrice);
  const discountPercentage = calculateDiscountPercentage(originalPrice, offerPrice);

  const initialBlocking: CanonicalQualityIssue[] = [];
  const initialWarnings: CanonicalQualityIssue[] = [];

  // Carry over schema warnings from model extraction
  for (const w of offer.warnings || []) {
    if (w.blocking) {
      initialBlocking.push({ code: w.code, message: w.message, severity: 'error' });
    } else {
      initialWarnings.push({ code: w.code, message: w.message, severity: 'warning' });
    }
  }

  // Carry over crop warnings
  for (const cw of crop.warnings || []) {
    initialWarnings.push({ code: 'CROP_WARNING', message: cw, severity: 'warning' });
  }

  // Carry over link warnings
  for (const lw of link.warnings || []) {
    initialWarnings.push({ code: 'EVIDENCE_LINK_WARNING', message: lw, severity: 'warning' });
  }

  // Critical gate: if no anchor block is linked
  if (!link.current_price_anchor_block_id) {
    initialBlocking.push({
      code: 'MISSING_PRICE_ANCHOR_LINK',
      message: 'Offer has no linked current-price anchor block',
      severity: 'error'
    });
  }

  const pageQtyNorm = parseAndNormalizeQuantity({
    size_text: offer.content?.size_text,
    title_en: offer.product?.title_en,
    title_ar: offer.product?.title_ar,
    ai_pack_quantity: offer.content?.pack_quantity,
    ai_each_size_value: offer.content?.each_size_value,
    ai_each_size_unit: offer.content?.each_size_unit,
    offer_price: offerPrice,
    price_basis: offer.price_basis?.basis
  });

  // Build canonical offer structure
  const canonical: CanonicalOffer = {
    source: {
      leaflet_id: trustedContext.leafletId,
      source_page_number: pageNumber,
      source_item_number: itemNumber,
      external_image_id: null,
      crop_path: cropFilePath ? cropFilePath.replace(/\\/g, '/') : null,
      json_path: null
    },

    trusted_context: {
      supermarket_id: trustedContext.supermarketId,
      supermarket_slug: trustedContext.supermarketSlug,
      location_scope: trustedContext.locationScope,
      city_id: trustedContext.cityId,
      region_id: trustedContext.regionId,
      offer_start_date: trustedContext.offerStartDate,
      offer_end_date: trustedContext.offerEndDate
    },

    product: {
      title_ar: offer.product?.title_ar ?? null,
      title_en: offer.product?.title_en ?? null,
      brand_text: offer.product?.brand_text ?? null,
      category_hint: null,
      item_domain: offer.product?.item_domain ?? 'unknown',
      description_ar: offer.product?.description_ar ?? null,
      description_en: offer.product?.description_en ?? null
    },

    prices: {
      offer_price: offerPrice,
      original_price: originalPrice,
      currency: offer.selected_prices?.currency ?? 'SAR',
      discount_amount: discountAmount,
      discount_percentage: discountPercentage,
      price_basis: offer.price_basis?.basis ?? 'unknown',
      price_condition_text: offer.price_basis?.raw_text ?? null,
      all_price_candidates: allPriceCandidates
    },

    content: {
      size_text: pageQtyNorm.raw_size_text || offer.content?.size_text || null,
      pack_quantity: pageQtyNorm.pack_quantity || offer.content?.pack_quantity || 1,
      bundle_quantity: offer.content?.bundle_quantity ?? null,
      each_size_value: pageQtyNorm.each_size_value ?? offer.content?.each_size_value ?? null,
      each_size_unit: (pageQtyNorm.each_size_unit ? toCanonicalOfferUnit(pageQtyNorm.each_size_unit) : (offer.content?.each_size_unit === 'inch' ? 'other' : offer.content?.each_size_unit)) ?? null,
      total_content_value: pageQtyNorm.total_content_value ?? offer.content?.total_content_value ?? null,
      total_content_unit: (pageQtyNorm.total_content_unit ? toCanonicalOfferUnit(pageQtyNorm.total_content_unit) : (offer.content?.total_content_unit === 'inch' ? 'other' : offer.content?.total_content_unit)) ?? null
    },

    promotion: {
      mechanic: offer.promotion?.mechanic ?? 'standard_price',
      special_offer: offer.promotion?.raw_text ?? null,
      condition_text: offer.promotion?.condition_text ?? null,
      bundle_quantity: offer.content?.bundle_quantity ?? null
    },

    comparison: {
      comparison_eligible: false,
      comparison_unit: null,
      comparison_unit_price: null,
      comparison_confidence: 'low',
      comparison_exclusion_reason: null
    },

    image: {
      image_bucket: null,
      image_path: cropFilePath ? cropFilePath.replace(/\\/g, '/') : null,
      image_url: null,
      image_source_type: 'leaflet_crop'
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
      hidden_reason: 'comparison_not_eligible'
    },

    quality: {
      publish_decision: 'skip_or_quarantine',
      extraction_confidence: offer.confidence?.overall ?? 'medium',
      validation_confidence: 'not_run',
      comparison_confidence: 'low',
      blocking_errors: initialBlocking,
      non_blocking_warnings: initialWarnings
    },

    style_validation: {
      validation_result: 'pass',
      visual_evidence: {
        evidence: offer.evidence,
        source_pass: rawMetadata.isRetry ? 'retry' : 'primary'
      },
      corrected_fields: {},
      style_profile_scope: 'page'
    },

    pre_publish: {
      preview_eligible: false,
      preview_group: 'skip_or_quarantine',
      display_in_preview: true
    },

    raw: {
      raw_ocr_json: rawMetadata.rawOcrJson || {},
      raw_validation_json: null,
      raw_ocr_text: offer.evidence?.final_evidence_summary || null,
      raw_attributes: {
        page_first: {
          temporary_offer_id: offer.temporary_offer_id,
          source_offer_key: crop.source_offer_key,
          region_hint: offer.region_hint,
          linked_block_ids: link.linked_block_ids,
          current_price_anchor_block_id: link.current_price_anchor_block_id,
          crop_bounds: crop.bounds,
          crop_confidence: crop.crop_confidence,
          crop_strategy: crop.strategy,
          evidence_link_confidence: link.confidence,
          unmatched_evidence: link.unmatched_evidence,
          is_retry: Boolean(rawMetadata.isRetry),
          completeness_status: rawMetadata.completenessStatus || 'pass'
        }
      }
    }
  };

  // Run deterministic safety checks
  const deterministicResult = runDeterministicOfferChecks({ canonicalOffer: canonical });
  for (const b of deterministicResult.blocking_errors) {
    if (!canonical.quality.blocking_errors.some(e => e.code === b.code)) {
      canonical.quality.blocking_errors.push({ code: b.code, message: b.message, severity: 'error' });
    }
  }
  for (const w of deterministicResult.non_blocking_warnings) {
    if (!canonical.quality.non_blocking_warnings.some(e => e.code === w.code)) {
      canonical.quality.non_blocking_warnings.push({ code: w.code, message: w.message, severity: 'warning' });
    }
  }

  // Run comparison safety checks
  const comparisonResult = evaluateComparisonSafety({ canonicalOffer: canonical });
  canonical.comparison = {
    comparison_eligible: comparisonResult.comparison_eligible,
    comparison_unit: comparisonResult.comparison_unit,
    comparison_unit_price: comparisonResult.comparison_unit_price,
    comparison_confidence: comparisonResult.comparison_confidence,
    comparison_exclusion_reason: comparisonResult.comparison_exclusion_reason
  };

  // Run publish decision engine
  const decisionResult = decidePublishAction({
    canonicalOffer: canonical,
    comparisonResult
  });

  // Synchronize quality.comparison_confidence with comparison.comparison_confidence
  canonical.quality.comparison_confidence = comparisonResult.comparison_confidence;

  applyPublishDecisionToCanonicalOffer(canonical, decisionResult);

  // Attach contract_v2 and schema_version per WIFRAN-04
  canonical.schema_version = 'wifran.extractor.offer/2.0';
  canonical.contract_v2 = buildContractV2FromCanonical(canonical, { isFreshExtraction: true });

  // Write item JSON to package
  const jsonDir = join(packageDir, 'json', `page-${pagePadded}`);
  mkdirSync(jsonDir, { recursive: true });
  const jsonFileName = `${pdfBaseName}_${pagePadded}_${itemNumber}.json`;
  const jsonFilePath = join(jsonDir, jsonFileName);
  canonical.source.json_path = jsonFilePath.replace(/\\/g, '/');

  try {
    writeFileSync(jsonFilePath, JSON.stringify(canonical, null, 2), 'utf8');
  } catch (err: any) {
    console.error(`[pageOfferCanonicalMapper] Failed to write item JSON ${jsonFileName}:`, err);
  }

  return canonical;
}

export const PageOfferCanonicalMapper = {
  mapToCanonical: (input: {
    pageNumber: number;
    itemNumber: string;
    offer: PageFirstExtractedOffer;
    link: PageOfferEvidenceLink;
    crop: AutomaticOfferCrop;
    trustedContext: TrustedLeafletContext;
    rawMetadata?: {
      rawOcrJson?: any;
      rawAnnotation?: any;
      isRetry?: boolean;
      completenessStatus?: string;
    };
    pdfBaseName?: string;
    packageDir?: string;
    cropFilePath?: string | null;
  }): CanonicalOffer => {
    return mapPageOfferToCanonical({
      offer: input.offer,
      crop: input.crop,
      link: input.link,
      cropFilePath: input.cropFilePath ?? input.crop.bounds ? `crops/page-${String(input.pageNumber).padStart(3, '0')}/${input.pdfBaseName || 'leaflet'}_${String(input.pageNumber).padStart(3, '0')}_${input.itemNumber}.webp` : null,
      pageNumber: input.pageNumber,
      pdfBaseName: input.pdfBaseName || 'test',
      packageDir: input.packageDir || '.',
      trustedContext: input.trustedContext,
      itemNumberOverride: input.itemNumber,
      rawMetadata: input.rawMetadata
    });
  }
};

import type { CategorySlugRev1, ExtractedOfferRev1, NormalizedBox2D } from '../../shared/types/leafletExtraction';

export const CANONICAL_WIFRAN_CATEGORIES: CategorySlugRev1[] = [
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
];

export function inferCategorySlug(
  offer: Partial<ExtractedOfferRev1>,
  resolvedDomain?: string
): CategorySlugRev1 {
  if (offer.category_slug && CANONICAL_WIFRAN_CATEGORIES.includes(offer.category_slug)) {
    return offer.category_slug;
  }

  if (resolvedDomain && ['electronics', 'appliance', 'other_non_grocery'].includes(resolvedDomain)) {
    return 'non-grocery';
  }

  const text = `${offer.english_title || ''} ${offer.arabic_title || ''}`.toLowerCase();

  // 1. Eggs
  if (/\b(egg|eggs)\b/i.test(text) || /بيض/.test(text)) {
    return 'eggs';
  }

  // 2. Baby
  if (
    /\b(diaper|diapers|pampers|baby|infant)\b/i.test(text) ||
    /(بامبرز|حفاض|حفاضات|أطفال|اطفال)/.test(text)
  ) {
    return 'baby';
  }

  // 3. Cleaning
  if (
    /\b(detergent|washing|ariel|tide|persil|fairy|finish|bleach|downy|softener|tissue|tissues|trash|napkin)\b/i.test(text) ||
    /(تايد|اريال|برسيل|فيري|كلوركس|داوني|غسيل|مناديل|نفايات|سائل غسيل|صابون صحون|مطهر)/.test(text)
  ) {
    return 'cleaning';
  }

  // 4. Personal Care
  if (
    /\b(shampoo|soap|dove|lux|dettol|nivea|pantene|colgate|crest|toothpaste|deodorant|shower|lotion|conditioner|sanitary)\b/i.test(text) ||
    /(شامبو|صابون|دوف|لوكس|ديتول|نيفيا|بانتين|كولجيت|معجون أسنان|معجون اسنان|مزيل عرق|لوشن|بلسم|فوط)/.test(text)
  ) {
    return 'personal-care';
  }

  // 5. Coffee & Tea
  if (
    /\b(coffee|tea|teabags|nescafe|rabea|lipton|al-wazah|creamer|espresso|cappuccino)\b/i.test(text) ||
    /(قهوة|شاي|نسكافيه|ربيع|ليبتون|كابتشينو|اسبريسو)/.test(text)
  ) {
    return 'coffee-tea';
  }

  // 6. Beverages
  if (
    /\b(water|mineral|juice|pepsi|coca|cola|7up|sprite|mirinda|fanta|syrup|soda|beer|malt|barbican|energy drink)\b/i.test(text) ||
    /(مياه|موية|ماء|عصير|بيبسي|كوكاكولا|سفن اب|ميرندا|فانتا|شراب|باربيكان|مشروب)/.test(text)
  ) {
    return 'beverages';
  }

  // 7. Frozen (French fries, nuggets, burgers, shawarma, ice cream)
  if (
    /\b(ice cream|icecream|fries|french fries|nugget|nuggets|burger|burgers|shawarma)\b/i.test(text) ||
    /(آيس كريم|ايس كريم|برجر|ناجتس|بطاطس مقلية|شاورما)/.test(text)
  ) {
    return 'frozen';
  }

  // 8. Meat & Chicken
  if (
    /\b(chicken|poultry|beef|veal|meat|mutton|lamb|camel|fish|salmon|shrimp|prawn|seafood)\b/i.test(text) ||
    /(دجاج|لحم|عجل|غنم|بقر|سمك|سلمون|جمبري|روبيان|فيليه دجاج)/.test(text)
  ) {
    return 'meat-chicken';
  }

  // 9. Dairy
  if (
    /\b(milk|laban|yogurt|yoghurt|cheese|butter|cream|qishta|cheddar|mozzarella|puck|almarai|nadec|kiri)\b/i.test(text) ||
    /(حليب|لبن|زبادي|جبن|جبنة|زبدة|قشطة|شيدر|موزاريلا|بوك|المراعي|نادك|كيري)/.test(text)
  ) {
    return 'dairy';
  }

  // 10. Snacks
  if (
    /\b(chips|chip|crisps|lays|doritos|pringles|biscuit|biscuits|cookie|cookies|cake|cakes|chocolate|chocolates|candy|wafer|wafers|crackers)\b/i.test(text) ||
    /(شيبس|بطاطس|ليز|دوريتوس|برينجلز|بسكويت|كوكيز|كيك|شوكولاتة|شوكولاته|كاندي|ويفر|مقرمشات)/.test(text)
  ) {
    return 'snacks';
  }

  // 11. Canned Food
  if (
    /\b(canned|tuna|paste|beans|foul|luncheon|olive|olives|pickle|pickles|mayonnaise|mayo|ketchup|sauce|honey|jam)\b/i.test(text) ||
    /(تونة|تونه|معجون طماطم|فول|فاصوليا|لانشون|زيتون|مخلل|مايونيز|كاتشب|صلصة|عسل|مربى)/.test(text)
  ) {
    return 'canned-food';
  }

  // 12. Staples
  if (
    /\b(rice|basmati|pasta|spaghetti|macaroni|noodles|flour|sugar|oil|sunflower|canola|corn oil|ghee|oats|bread|bun|buns|tomato|tomatoes|cucumber|potato|potatoes|onion|onions|garlic|fruit|vegetable|dates|nuts)\b/i.test(text) ||
    /(ارز|أرز|بسمتي|مكرونة|معكرونة|شعيرية|نودلز|دقيق|طحين|سكر|زيت|سمن|شوفان|خبز|صامولي|طماطم|خيار|بطاطا|بصل|ثوم|فواكه|خضار|تمر|تمور|مكسرات)/.test(text)
  ) {
    return 'staples';
  }

  return resolvedDomain === 'grocery' ? 'staples' : 'non-grocery';
}

export function inferNormalizedTitlesAndCommodityTag(
  offer: ExtractedOfferRev1,
  categorySlug: CategorySlugRev1
): {
  normalized_title_ar: string;
  normalized_title_en: string;
  commodity_tag: string;
} {
  let normAr = offer.normalized_product_name_ar?.trim();
  if (!normAr) {
    normAr = (offer.arabic_title || '')
      .replace(/[٠-٩0-9]+(\s*[,.]\s*[٠-٩0-9]+)?\s*[×xX*]\s*[٠-٩0-9]+(\s*[,.]\s*[٠-٩0-9]+)?\s*(جرام|جم|كجم|كيلو|مل|لتر|ل|حبة|حبات|كيس)?/gu, '')
      .replace(/[٠-٩0-9]+(\s*[,.]\s*[٠-٩0-9]+)?\s*(جرام|جم|كجم|كيلو|مل|لتر|ل|حبة|حبات|كيس|علبة|علب|قطع|قطعة)/gu, '')
      .replace(/\s*[\/\\]\s*(كيلو|كيس|حبة|علبة)/gu, '')
      .replace(/[٠-٩0-9]+\s*\+\s*[٠-٩0-9]+(\s*(مجاناً|مجانا|مجاني))?/gu, '')
      .replace(/(عرض خاص|مجاناً|مجانا|مجاني|منوع|منوعة|متنوع|متنوعة|مشكل)\.?/gu, '')
      .replace(/[\s.,،]+$/gu, '')
      .replace(/^[\s.,،]+/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  let normEn = offer.normalized_product_name_en?.trim();
  if (!normEn) {
    normEn = (offer.english_title || '')
      .replace(/\b\d+(\.\d+)?\s*[xX*]\s*\d+(\.\d+)?\s*(gm|gms|g|kg|ml|l|ltr|pcs|teabags)?\b/gi, '')
      .replace(/\b\d+(\.\d+)?\s*(gm|gms|g|kg|ml|l|ltr|pcs|teabags|bag|box|pack)\b/gi, '')
      .replace(/\s*[\/\\]\s*(kg|bag|pc|pack|box)\b/gi, '')
      .replace(/\b\d+\s*\+\s*\d+(\s*free)?\b/gi, '')
      .replace(/\b(special offer|free|assorted|varieties|asstd)\.?/gi, '')
      .replace(/[\s.,]+$/g, '')
      .replace(/^[\s.,]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!normAr) normAr = offer.arabic_title;
  if (!normEn) normEn = offer.english_title;

  let tag = offer.commodity_tag?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!tag) {
    const text = `${offer.english_title || ''} ${offer.arabic_title || ''}`.toLowerCase();
    if (/\b(chicken breast|fillet)\b/i.test(text) || /(فيليه دجاج|صدور دجاج)/.test(text)) tag = 'chicken_breast';
    else if (/\bchicken\b/i.test(text) || /دجاج/.test(text)) tag = 'whole_chicken';
    else if (/\bveal\b/i.test(text) || /(عجل|لحم عجل)/.test(text)) tag = 'veal_meat';
    else if (/\bbeef\b/i.test(text) || /(بقر|لحم بقر)/.test(text)) tag = 'beef_meat';
    else if (/\b(salmon|fish)\b/i.test(text) || /(سمك|سلمون)/.test(text)) tag = 'fresh_fish';
    else if (/\boil\b/i.test(text) || /زيت/.test(text)) tag = 'cooking_oil';
    else if (/\bmilk\b/i.test(text) || /حليب/.test(text)) tag = 'uht_milk';
    else if (/\begg|eggs\b/i.test(text) || /بيض/.test(text)) tag = 'white_eggs';
    else if (/\btomato\b/i.test(text) || /طماطم/.test(text)) tag = 'fresh_vegetable';
    else if (/\bcucumber\b/i.test(text) || /خيار/.test(text)) tag = 'fresh_vegetable';
    else if (/\bgarlic\b/i.test(text) || /ثوم/.test(text)) tag = 'fresh_vegetable';
    else if (/\btea|teabags\b/i.test(text) || /شاي/.test(text)) tag = 'tea';
    else if (/\bcoffee|nescafe\b/i.test(text) || /(قهوة|نسكافيه)/.test(text)) tag = 'coffee';
    else if (/\bice cream\b/i.test(text) || /آيس كريم/.test(text)) tag = 'ice_cream';
    else if (/\bchips|crisps|lays\b/i.test(text) || /شيبس/.test(text)) tag = 'potato_chips';
    else if (/\btissue|tissues\b/i.test(text) || /مناديل/.test(text)) tag = 'facial_tissue';
    else if (/\bdetergent\b/i.test(text) || /(غسيل|مسحوق)/.test(text)) tag = 'laundry_detergent';
    else if (/\bfairy|dishwashing\b/i.test(text) || /فيري/.test(text)) tag = 'dishwashing_liquid';
    else if (/\bsoap\b/i.test(text) || /صابون/.test(text)) tag = 'bath_soap';
    else if (/\bshampoo\b/i.test(text) || /شامبو/.test(text)) tag = 'shampoo';
    else if (/\bwater\b/i.test(text) || /مياه/.test(text)) tag = 'drinking_water';
    else if (/\btuna\b/i.test(text) || /تونة/.test(text)) tag = 'canned_tuna';
    else if (/\brice|basmati\b/i.test(text) || /أرز|ارز/.test(text)) tag = 'basmati_rice';
    else if (/\btv|qled|qned|oled\b/i.test(text) || /تلفزيون/.test(text)) tag = 'smart_tv';
    else if (/\b(iphone|galaxy|phone|spark)\b/i.test(text) || /(جوال|آيفون)/.test(text)) tag = 'smartphone';
    else if (/\b(pad|tablet)\b/i.test(text) || /تابلت/.test(text)) tag = 'tablet';
    else if (/\b(airpods|earbuds|headphones)\b/i.test(text) || /سماعة/.test(text)) tag = 'earbuds';
    else tag = `${categorySlug.replace('-', '_')}_item`;
  }

  return {
    normalized_title_ar: normAr,
    normalized_title_en: normEn,
    commodity_tag: tag
  };
}

function extractSpecialOfferTag(offer: ExtractedOfferRev1): string | null {
  const combined = `${offer.english_title || ''} ${offer.arabic_title || ''} ${offer.unit_type || ''} ${offer.size_value || ''}`;
  const bonusMatch = combined.match(/\b\d+\s*\+\s*\d+(\s*(free|مجانا))?\b/i) || combined.match(/[٠-٩]+\s*\+\s*[٠-٩]+(\s*مجانا)?/);
  if (bonusMatch) return bonusMatch[0].trim();

  const pcsMatch = combined.match(/\b\d+\s*pcs\b/i) || combined.match(/[0-9٠-٩]+\s*(حبة|حبات|حبه|علب|علبة|ربطة)/);
  if (pcsMatch) return pcsMatch[0].trim();

  if (offer.unit_type && /^(2pcs|3pcs|4pcs|5pcs|6pcs|\d+pcs)$/i.test(offer.unit_type.trim())) {
    return offer.unit_type.trim();
  }

  return null;
}

export type MapRev1OfferToCanonicalInput = {
  offer: ExtractedOfferRev1;
  cropRect: import('../../shared/types/leafletExtraction').OfferCropRectangles;
  pageNumber: number;
  pdfBaseName: string;
  packageDir: string;
  trustedContext: TrustedLeafletContext;
  rawMetadata?: {
    rawExtractionJson?: any;
    rawOfferExtraction?: any;
    auditResult?: any;
    retryExecuted?: boolean;
  };
};

export function mapRev1OfferToCanonical(input: MapRev1OfferToCanonicalInput): CanonicalOffer {
  const { offer, cropRect, pageNumber, pdfBaseName, packageDir: _packageDir, trustedContext, rawMetadata } = input;
  const itemNumber = String(offer.offer_number).padStart(3, '0');
  const pagePadded = String(pageNumber).padStart(3, '0');

  const discountAmount = calculateDiscountAmount(offer.original_price, offer.promo_price);
  const discountPercentage = calculateDiscountPercentage(offer.original_price, offer.promo_price);

  const priceBasis = (
    offer.unit_type?.toLowerCase().includes('kg') ? 'per_kg' :
    offer.unit_type?.toLowerCase().includes('pack') ? 'per_pack' :
    offer.unit_type?.toLowerCase().includes('box') ? 'per_box' :
    offer.unit_type?.toLowerCase().includes('bag') ? 'per_bag' : 'each'
  ) as any;

  const resolvedDomain = detectItemDomainFromTitle(
    offer.english_title,
    offer.arabic_title,
    offer.item_domain
  );

  const quantityNorm = parseAndNormalizeQuantity({
    size_text: offer.size_value,
    title_en: offer.english_title,
    title_ar: offer.arabic_title,
    item_domain: resolvedDomain,
    unit_type: offer.unit_type,
    ai_pack_quantity: offer.pack_quantity,
    ai_each_size_value: offer.each_size_value,
    ai_each_size_unit: offer.each_size_unit,
    is_uniform_size_across_variants: offer.is_uniform_size_across_variants,
    offer_price: offer.promo_price,
    price_basis: priceBasis
  });

  const resolvedCategorySlug = inferCategorySlug(offer, resolvedDomain);
  const normalizedInfo = inferNormalizedTitlesAndCommodityTag(offer, resolvedCategorySlug);
  const specialOfferTag = extractSpecialOfferTag(offer);

  const conditionText = offer.promo_condition === 'LOYALTY_CARD_REQUIRED'
    ? (offer.quantity_limit ? `Loyalty Card Required - ${offer.quantity_limit}` : 'Loyalty Card Required')
    : (offer.quantity_limit || null);

  // Compute spatial prominence metrics on 0..1000 scale
  const comp = offer.components;
  const boxes: NormalizedBox2D[] = [];
  if (comp.product_graphic_box) boxes.push(comp.product_graphic_box);
  if (comp.promo_price_box) boxes.push(comp.promo_price_box);
  if (comp.original_price_box) boxes.push(comp.original_price_box);
  if (comp.unit_and_size_badge_box) boxes.push(comp.unit_and_size_badge_box);
  if (comp.title_text_box) boxes.push(comp.title_text_box);

  let yminNorm = 0;
  let xminNorm = 0;
  let ymaxNorm = 1000;
  let xmaxNorm = 1000;

  if (boxes.length > 0) {
    yminNorm = Math.max(0, Math.min(...boxes.map(b => b[0])));
    xminNorm = Math.max(0, Math.min(...boxes.map(b => b[1])));
    ymaxNorm = Math.min(1000, Math.max(...boxes.map(b => b[2])));
    xmaxNorm = Math.min(1000, Math.max(...boxes.map(b => b[3])));

    if (!comp.title_text_box && (offer.arabic_title || offer.english_title)) {
      const height = ymaxNorm - yminNorm;
      ymaxNorm = Math.min(1000, ymaxNorm + Math.round(height * 0.08));
    }
  }

  const pageAreaSharePct = Number((((xmaxNorm - xminNorm) * (ymaxNorm - yminNorm)) / 10000).toFixed(2));
  const isFrontPage = pageNumber === 1;
  const isHeroOffer = isFrontPage || pageAreaSharePct >= 12.0;

  const canonical: CanonicalOffer = {
    source: {
      leaflet_id: trustedContext.leafletId || 'default_leaflet',
      source_page_number: pageNumber,
      source_item_number: itemNumber,
      external_image_id: `${pdfBaseName}_p${pagePadded}_${itemNumber}`,
      crop_path: cropRect.offer_card_crop_path || null,
      thumbnail_path: cropRect.product_thumb_crop_path || null,
      page_area_share_pct: pageAreaSharePct,
      json_path: ''
    },
    trusted_context: {
      supermarket_id: trustedContext.supermarketId,
      supermarket_slug: trustedContext.supermarketSlug,
      location_scope: trustedContext.locationScope,
      city_id: trustedContext.cityId,
      region_id: trustedContext.regionId,
      offer_start_date: trustedContext.offerStartDate,
      offer_end_date: trustedContext.offerEndDate
    },
    product: {
      title_ar: offer.arabic_title,
      title_en: offer.english_title,
      normalized_title_ar: normalizedInfo.normalized_title_ar,
      normalized_title_en: normalizedInfo.normalized_title_en,
      commodity_tag: normalizedInfo.commodity_tag,
      brand_text: offer.brand,
      category_hint: resolvedCategorySlug,
      item_domain: resolvedDomain,
      description_ar: null,
      description_en: null
    },
    prices: {
      offer_price: offer.promo_price,
      original_price: offer.original_price,
      currency: 'SAR',
      discount_amount: discountAmount,
      discount_percentage: discountPercentage,
      price_basis: priceBasis,
      price_condition_text: null,
      all_price_candidates: [
        {
          raw_text: String(offer.promo_price),
          normalized_value: offer.promo_price,
          currency: 'SAR',
          visual_role: 'current_offer_price',
          classified_as: 'offer_price',
          confidence: 'high',
          evidence: String(offer.promo_price),
          visual_evidence: {}
        }
      ]
    },
    content: {
      size_text: quantityNorm.raw_size_text || offer.size_value,
      pack_quantity: quantityNorm.pack_quantity,
      bundle_quantity: null,
      each_size_value: quantityNorm.each_size_value,
      each_size_unit: toCanonicalOfferUnit(quantityNorm.each_size_unit),
      total_content_value: quantityNorm.total_content_value,
      total_content_unit: toCanonicalOfferUnit(quantityNorm.total_content_unit)
    },
    promotion: {
      mechanic:
        offer.promo_condition === 'LOYALTY_CARD_REQUIRED'
          ? 'loyalty_required'
          : offer.promo_condition === 'MULTI_BUY'
            ? 'multi_buy'
            : 'standard_price',
      special_offer: specialOfferTag,
      condition_text: conditionText,
      quantity_limit: offer.quantity_limit || null,
      bundle_quantity: null
    },
    comparison: {
      comparison_eligible: false,
      comparison_unit: null,
      comparison_unit_price: null,
      comparison_confidence: 'low',
      comparison_exclusion_reason: null
    },
    image: {
      image_bucket: null,
      image_path: cropRect.offer_card_crop_path
        ? cropRect.offer_card_crop_path.replace(/\\/g, '/')
        : null,
      image_url: null,
      thumbnail_path: cropRect.product_thumb_crop_path
        ? cropRect.product_thumb_crop_path.replace(/\\/g, '/')
        : null,
      thumbnail_url: null,
      image_source_type: 'leaflet_crop'
    },
    display: {
      show_display_unit_price: quantityNorm.comparison_eligible && quantityNorm.standardized_unit_price !== null,
      display_unit_price: quantityNorm.standardized_unit_price,
      display_unit_basis_value: 1,
      display_unit_basis_unit: (quantityNorm.standardized_unit === 'kilogram' ? 'kg' : quantityNorm.standardized_unit === 'liter' ? 'l' : quantityNorm.standardized_unit === 'piece' ? 'piece' : null),
      display_unit_family: (quantityNorm.standardized_unit === 'kilogram' ? 'mass' : quantityNorm.standardized_unit === 'liter' ? 'volume' : quantityNorm.standardized_unit === 'piece' ? 'count' : null),
      display_unit_price_label_ar: quantityNorm.standardized_unit_price ? `${quantityNorm.standardized_unit_price} ر.س / ${quantityNorm.standardized_unit === 'kilogram' ? 'كجم' : quantityNorm.standardized_unit === 'liter' ? 'لتر' : 'حبة'}` : null,
      display_unit_price_label_en: quantityNorm.standardized_unit_price ? `${quantityNorm.standardized_unit_price} SAR / ${quantityNorm.standardized_unit === 'kilogram' ? 'kg' : quantityNorm.standardized_unit === 'liter' ? 'L' : 'pc'}` : null,
      below_min_display_price_threshold: false,
      min_display_unit_price_sar: 0.5,
      hidden_reason: quantityNorm.comparison_eligible ? null : 'comparison_not_eligible'
    },
    quality: {
      publish_decision: 'publish',
      extraction_confidence: offer.confidence >= 0.9 ? 'high' : 'medium',
      validation_confidence: 'high',
      comparison_confidence: 'medium',
      blocking_errors: [],
      non_blocking_warnings: []
    },
    style_validation: {
      validation_result: 'pass',
      visual_evidence: {},
      corrected_fields: {},
      style_profile_scope: 'page'
    },
    pre_publish: {
      preview_eligible: true,
      preview_group: 'publish',
      display_in_preview: true
    },
    raw: {
      raw_ocr_json: {},
      raw_validation_json: null,
      raw_ocr_text: null,
      raw_attributes: {
        raw_offer_extraction: offer,
        spatial_prominence: {
          page_area_share_pct: pageAreaSharePct,
          is_front_page: isFrontPage,
          is_hero_offer: isHeroOffer,
          normalized_union_box: [yminNorm, xminNorm, ymaxNorm, xmaxNorm]
        },
        completeness_status: 'complete',
        evidence_linking_status: 'linked',
        is_retry_pass: rawMetadata?.retryExecuted || false,
        page_first: {
          current_price_anchor_block_id: `rev1_price_anchor_p${pagePadded}_${itemNumber}`,
          evidence_link_confidence: 1.0,
          completeness_status: 'pass',
          crop_confidence: offer.confidence,
          is_retry: rawMetadata?.retryExecuted || false
        }
      }
    }
  };

  const comparisonResult = evaluateComparisonSafety({ canonicalOffer: canonical });
  canonical.comparison = {
    comparison_eligible: comparisonResult.comparison_eligible,
    comparison_unit: comparisonResult.comparison_unit,
    comparison_unit_price: comparisonResult.comparison_unit_price,
    comparison_confidence: comparisonResult.comparison_confidence,
    comparison_exclusion_reason: comparisonResult.comparison_exclusion_reason
  };

  const decision = decidePublishAction({
    canonicalOffer: canonical,
    comparisonResult
  });

  // Synchronize quality.comparison_confidence with comparison.comparison_confidence
  canonical.quality.comparison_confidence = comparisonResult.comparison_confidence;

  applyPublishDecisionToCanonicalOffer(canonical, decision);

  // Attach contract_v2 and schema_version per WIFRAN-04
  canonical.schema_version = 'wifran.extractor.offer/2.0';
  canonical.contract_v2 = buildContractV2FromCanonical(canonical, { isFreshExtraction: true });

  return canonical;
}
