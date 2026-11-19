export type NormalizedBox2D = [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0..1000

export type AtomicOfferComponents = {
  product_graphic_box: NormalizedBox2D;
  promo_price_box: NormalizedBox2D;
  original_price_box: NormalizedBox2D | null;
  unit_and_size_badge_box: NormalizedBox2D | null;
  title_text_box: NormalizedBox2D | null;
};

export type PromoCondition = 'STANDARD' | 'LOYALTY_CARD_REQUIRED' | 'MULTI_BUY' | 'UNKNOWN';

export type CanonicalExtractionUnit = 'g' | 'kg' | 'ml' | 'l' | 'pcs' | 'roll' | 'sheet';

export type ItemDomainRev1 =
  | 'grocery'
  | 'electronics'
  | 'appliance'
  | 'health_beauty'
  | 'household'
  | 'other_non_grocery';

export type CategorySlugRev1 =
  | 'staples'
  | 'dairy'
  | 'eggs'
  | 'meat-chicken'
  | 'frozen'
  | 'baby'
  | 'cleaning'
  | 'personal-care'
  | 'beverages'
  | 'coffee-tea'
  | 'snacks'
  | 'canned-food'
  | 'non-grocery';

export type ExtractedOfferRev1 = {
  offer_number: number;
  arabic_title: string;
  english_title: string;
  brand: string | null;
  is_multi_brand_or_variant: boolean;
  compound_group_id?: string | null;
  item_domain?: ItemDomainRev1;
  category_slug?: CategorySlugRev1 | null;
  normalized_product_name_ar?: string | null;
  normalized_product_name_en?: string | null;
  commodity_tag?: string | null;
  quantity_limit?: string | null;
  size_value: string | null;
  unit_type: string | null;
  pack_quantity?: number | null;
  each_size_value?: number | null;
  each_size_unit?: CanonicalExtractionUnit | null;
  is_uniform_size_across_variants?: boolean;
  promo_price: number;
  original_price: number | null;
  promo_condition?: PromoCondition | null;
  confidence: number;
  components: AtomicOfferComponents;
};

export type LeafletPageMetadataRev1 = {
  is_loyalty_page: boolean;
  loyalty_program_name: string | null;
  validity_start_date: string | null;
  validity_end_date: string | null;
  ignored_banners: string[];
};

export type LeafletPageExtractionRev1 = LeafletPageMetadataRev1 & {
  page_number?: number;
  offers: ExtractedOfferRev1[];
};

export type PixelBoundingBox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  width: number;
  height: number;
};

export type OfferCropRectangles = {
  offer_number: number;
  union_box_px: PixelBoundingBox;
  product_thumb_box_px: PixelBoundingBox;
  offer_card_crop_path?: string;
  product_thumb_crop_path?: string;
};

export type Stage5AuditIssue = {
  code:
    | 'PRICE_INVERSION'
    | 'MISSED_PRICE_ANCHOR'
    | 'BBOX_SANITY_FAILED'
    | 'IOU_COLLISION'
    | 'EMPTY_TITLE'
    | 'INVALID_PRICE'
    | 'MISSING_SIZE_OR_UNIT';
  offer_number?: number;
  message: string;
  severity: 'error' | 'warning';
  suspect_box_2d?: NormalizedBox2D;
};

export type Stage5AuditResult = {
  passed: boolean;
  page_confidence: number;
  issues: Stage5AuditIssue[];
  total_offers: number;
  unresolved_retries: number;
  suspect_regions: NormalizedBox2D[];
};
