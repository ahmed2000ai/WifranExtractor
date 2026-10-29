export type PageFirstRegionHint =
  | 'top_left'
  | 'top'
  | 'top_right'
  | 'middle_left'
  | 'middle'
  | 'middle_right'
  | 'bottom_left'
  | 'bottom'
  | 'bottom_right'
  | 'unknown';

export type PageFirstItemDomain =
  | 'grocery'
  | 'household'
  | 'personal_care'
  | 'electronics'
  | 'appliance'
  | 'other_non_grocery'
  | 'unknown';

export type PageFirstPriceRole =
  | 'current_offer_price'
  | 'original_old_price'
  | 'multi_buy_total_price'
  | 'loyalty_price'
  | 'ambiguous_price'
  | 'not_a_price';

export type PageFirstSizeUnit =
  | 'liter'
  | 'milliliter'
  | 'kilogram'
  | 'gram'
  | 'piece'
  | 'dozen'
  | 'inch'
  | 'other'
  | null;

export type PageFirstPriceBasis =
  | 'each'
  | 'per_pack'
  | 'per_box'
  | 'per_bag'
  | 'per_kg'
  | 'per_2kg'
  | 'per_dozen'
  | 'bundle'
  | 'multi_buy'
  | 'unknown';

export type PageFirstPromotionMechanic =
  | 'standard_price'
  | 'bogo'
  | 'bundle'
  | 'multi_buy'
  | 'loyalty_required'
  | 'selected_branches'
  | 'unknown';

export type PageFirstConfidenceLevel = 'high' | 'medium' | 'low';

export type PageFirstPriceCandidate = {
  raw_text: string;
  normalized_value: number | null;
  currency: 'SAR' | null;
  role: PageFirstPriceRole;
  is_crossed_out: boolean | null;
  confidence: PageFirstConfidenceLevel;
  evidence_text: string;
};

export type PageFirstExtractedOffer = {
  temporary_offer_id: string;

  region_hint: PageFirstRegionHint;

  product: {
    title_ar: string | null;
    title_en: string | null;
    brand_text: string | null;
    description_ar: string | null;
    description_en: string | null;
    item_domain: PageFirstItemDomain;
    variant_names: string[];
  };

  price_candidates: PageFirstPriceCandidate[];

  selected_prices: {
    offer_price: number | null;
    original_price: number | null;
    currency: 'SAR' | null;
    offer_price_raw_text: string | null;
    original_price_raw_text: string | null;
    confidence: PageFirstConfidenceLevel;
  };

  content: {
    size_text: string | null;
    each_size_value: number | null;
    each_size_unit: PageFirstSizeUnit;
    pack_quantity: number | null;
    bundle_quantity: number | null;
    total_content_value: number | null;
    total_content_unit: PageFirstSizeUnit;
  };

  price_basis: {
    basis: PageFirstPriceBasis;
    raw_text: string | null;
  };

  promotion: {
    mechanic: PageFirstPromotionMechanic;
    raw_text: string | null;
    condition_text: string | null;
  };

  evidence: {
    title_texts: string[];
    description_texts: string[];
    current_price_texts: string[];
    original_price_texts: string[];
    size_content_texts: string[];
    promotion_texts: string[];
    final_evidence_summary: string;
  };

  confidence: {
    overall: PageFirstConfidenceLevel;
    product_identity: PageFirstConfidenceLevel;
    current_price: PageFirstConfidenceLevel;
    original_price: PageFirstConfidenceLevel;
    size_content: PageFirstConfidenceLevel;
    promotion: PageFirstConfidenceLevel;
  };

  warnings: Array<{
    code: string;
    message: string;
    blocking: boolean;
  }>;
};

export type PageFirstUncertainRegion = {
  region_hint: PageFirstRegionHint;
  reason:
    | 'possible_unread_offer'
    | 'ambiguous_price'
    | 'ambiguous_product_group'
    | 'possible_shared_price'
    | 'low_visual_confidence'
    | 'other';
  description: string;
};

export type PageFirstPageSummary = {
  independent_offer_count: number;
  independent_current_price_anchor_count: number;
  offers_with_original_price_count: number;
  offers_with_size_or_content_count: number;
  bundle_or_multi_buy_count: number;
  low_confidence_offer_count: number;
  final_completeness_check_performed: boolean;
};

export type PageFirstOfferExtraction = {
  schema_version: 1;

  page_number: number;

  page_classification:
    | 'offer_page'
    | 'cover'
    | 'advertisement'
    | 'terms'
    | 'blank'
    | 'mixed'
    | 'unknown';

  offers: PageFirstExtractedOffer[];

  uncertain_regions: PageFirstUncertainRegion[];

  page_summary: PageFirstPageSummary;
};
