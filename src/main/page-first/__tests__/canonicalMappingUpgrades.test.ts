import { describe, it, expect } from 'vitest';
import {
  inferCategorySlug,
  inferNormalizedTitlesAndCommodityTag,
  mapRev1OfferToCanonical,
  CANONICAL_WIFRAN_CATEGORIES
} from '../pageOfferCanonicalMapper';
import type { ExtractedOfferRev1, OfferCropRectangles } from '../../../shared/types/leafletExtraction';

describe('Rev1 Canonical Mapping Upgrades Unit Tests', () => {
  describe('1. Category Slug Classification & Fallback', () => {
    it('should correctly infer categories across all 12 canonical Wifran categories plus non-grocery', () => {
      expect(CANONICAL_WIFRAN_CATEGORIES.length).toBe(13);
      // Staples
      expect(inferCategorySlug({ english_title: 'Noor - Cannola Oil 1.5Ltr', arabic_title: 'نور - زيت كانولا' })).toBe('staples');
      expect(inferCategorySlug({ english_title: 'Tomato / Kg', arabic_title: 'طماطم / كيلو' })).toBe('staples');
      expect(inferCategorySlug({ english_title: 'Al Walimah Basmati Rice 10kg', arabic_title: 'ارز الوليمة بسمتي' })).toBe('staples');

      // Dairy
      expect(inferCategorySlug({ english_title: 'Al Marai - Evaporated Milk', arabic_title: 'المراعي - حليب مركز' })).toBe('dairy');
      expect(inferCategorySlug({ english_title: 'Nadec Greek Yogurt', arabic_title: 'نادك زبادي يوناني' })).toBe('dairy');

      // Eggs
      expect(inferCategorySlug({ english_title: 'Fresh White Eggs 30s', arabic_title: 'طبق بيض ابيض ٣٠ حبة' })).toBe('eggs');

      // Meat & Chicken
      expect(inferCategorySlug({ english_title: 'Sadia Whole Chicken 1000g', arabic_title: 'دجاج مجمد ساديا' })).toBe('meat-chicken');
      expect(inferCategorySlug({ english_title: 'Entaj Chicken Breast Fillet', arabic_title: 'إنتاج فيلية دجاج' })).toBe('meat-chicken');
      expect(inferCategorySlug({ english_title: 'Veal Meat With Bone / Kg', arabic_title: 'لحم عجل بالعظم' })).toBe('meat-chicken');
      expect(inferCategorySlug({ english_title: 'Salmon Fillet Fresh / Kg', arabic_title: 'سلمون فيليه طازج' })).toBe('meat-chicken');

      // Frozen
      expect(inferCategorySlug({ english_title: 'Nestle Mega Ice Cream 95ml', arabic_title: 'نستله ميجا آيس كريم' })).toBe('frozen');
      expect(inferCategorySlug({ english_title: 'Americana Chicken Nuggets', arabic_title: 'امريكانا ناجتس دجاج' })).toBe('frozen');

      // Baby
      expect(inferCategorySlug({ english_title: 'Pampers Diapers Jumbo Box', arabic_title: 'بامبرز حفاضات صندوق جامبو' })).toBe('baby');

      // Cleaning
      expect(inferCategorySlug({ english_title: 'Tide Automatic Detergent 5kg', arabic_title: 'تايد مسحوق غسيل اوتوماتيك' })).toBe('cleaning');
      expect(inferCategorySlug({ english_title: 'Fairy Dishwashing Liquid 1L', arabic_title: 'فيري سائل غسيل صحون' })).toBe('cleaning');

      // Personal Care
      expect(inferCategorySlug({ english_title: 'Dove Bathing Soap 125g', arabic_title: 'صابون دوف للاستحمام' })).toBe('personal-care');
      expect(inferCategorySlug({ english_title: 'Pantene Pro-V Shampoo 400ml', arabic_title: 'بانتين شامبو' })).toBe('personal-care');

      // Beverages
      expect(inferCategorySlug({ english_title: 'Aquafina Bottled Water 30x330ml', arabic_title: 'مياه اكوافينا' })).toBe('beverages');
      expect(inferCategorySlug({ english_title: 'Pepsi Cola Can 24x325ml', arabic_title: 'بيبسي كولا علب' })).toBe('beverages');

      // Coffee & Tea
      expect(inferCategorySlug({ english_title: 'Rabea Extra Strong 100 Teabags', arabic_title: 'ربيع - شاي الأقوى' })).toBe('coffee-tea');
      expect(inferCategorySlug({ english_title: 'Nescafe Classic Instant Coffee', arabic_title: 'نسكافيه قهوة سريعة التحضير' })).toBe('coffee-tea');

      // Snacks
      expect(inferCategorySlug({ english_title: "Lay's - Chips 110gm", arabic_title: 'ليز - شيبس' })).toBe('snacks');

      // Canned Food
      expect(inferCategorySlug({ english_title: 'Al Alali Canned Tuna in Oil 170g', arabic_title: 'العلالي تونة معلبة' })).toBe('canned-food');
      expect(inferCategorySlug({ english_title: 'Saudi Tomato Paste 8x135g', arabic_title: 'معجون طماطم السعودية' })).toBe('canned-food');

      // Non-grocery
      expect(inferCategorySlug({ english_title: 'Samsung QLED 4K Smart TV 55 Inch', arabic_title: 'سامسونج تلفزيون كيو لد' }, 'electronics')).toBe('non-grocery');
      expect(inferCategorySlug({ english_title: 'Apple iPhone 17 Pro Max 256GB', arabic_title: 'آيفون 17 برو ماكس' }, 'electronics')).toBe('non-grocery');
    });

    it('should respect valid category_slug if already provided by AI', () => {
      expect(inferCategorySlug({ category_slug: 'dairy' })).toBe('dairy');
      expect(inferCategorySlug({ category_slug: 'meat-chicken' })).toBe('meat-chicken');
    });
  });

  describe('2. Product Title Normalization & Commodity Tags', () => {
    it('should strip sizes and promotional words to create clean normalized titles', () => {
      const offer: ExtractedOfferRev1 = {
        offer_number: 1,
        arabic_title: 'دجاج مجمد ساديا ١٠×١٠٠٠جرام عرض خاص',
        english_title: 'Sadia Whole Chicken 10x1000gm Special Offer',
        brand: 'Sadia',
        is_multi_brand_or_variant: false,
        promo_price: 149.99,
        original_price: 194,
        promo_condition: 'STANDARD',
        confidence: 0.99,
        size_value: '10x1000g',
        unit_type: null,
        components: {
          product_graphic_box: [378, 67, 471, 273],
          promo_price_box: [322, 33, 370, 169],
          original_price_box: null,
          unit_and_size_badge_box: null,
          title_text_box: [475, 67, 505, 273]
        }
      };

      const result = inferNormalizedTitlesAndCommodityTag(offer, 'meat-chicken');
      expect(result.normalized_title_ar).toBe('دجاج مجمد ساديا');
      expect(result.normalized_title_en).toBe('Sadia Whole Chicken');
      expect(result.commodity_tag).toBe('whole_chicken');
    });

    it('should use AI provided normalized names and commodity tags when present', () => {
      const offer: ExtractedOfferRev1 = {
        offer_number: 1,
        arabic_title: 'صابون دوف ١٢٥ جم ٥+١ مجانا',
        english_title: 'Dove Soap 125g 5+1 Free',
        normalized_product_name_ar: 'صابون دوف للاستحمام',
        normalized_product_name_en: 'Dove Bathing Soap',
        commodity_tag: 'bath_soap',
        brand: 'Dove',
        is_multi_brand_or_variant: false,
        promo_price: 24.95,
        original_price: null,
        promo_condition: 'STANDARD',
        confidence: 0.99,
        size_value: '125g',
        unit_type: null,
        components: {
          product_graphic_box: [100, 100, 200, 200],
          promo_price_box: [120, 120, 150, 150],
          original_price_box: null,
          unit_and_size_badge_box: null,
          title_text_box: [210, 100, 240, 200]
        }
      };

      const result = inferNormalizedTitlesAndCommodityTag(offer, 'personal-care');
      expect(result.normalized_title_ar).toBe('صابون دوف للاستحمام');
      expect(result.normalized_title_en).toBe('Dove Bathing Soap');
      expect(result.commodity_tag).toBe('bath_soap');
    });
  });

  describe('3. Canonical Mapping: Dual Crops, Prominence & Bloat Removal', () => {
    it('should map thumbnail_path, calculate spatial_prominence, and embed only single-offer extraction', () => {
      const offer: ExtractedOfferRev1 = {
        offer_number: 1,
        arabic_title: 'دجاج مجمد ساديا ١٠×١٠٠٠جرام',
        english_title: 'Sadia Whole Chicken 10x1000gm',
        brand: 'Sadia',
        is_multi_brand_or_variant: false,
        promo_price: 149.99,
        original_price: 194,
        promo_condition: 'STANDARD',
        confidence: 0.99,
        size_value: '10x1000g',
        unit_type: 'Carton',
        quantity_limit: 'Max 2 per customer',
        components: {
          product_graphic_box: [378, 67, 471, 273],
          promo_price_box: [322, 33, 370, 169],
          original_price_box: [324, 118, 340, 160],
          unit_and_size_badge_box: [325, 34, 340, 93],
          title_text_box: [475, 67, 505, 273]
        }
      };

      const cropRect: OfferCropRectangles = {
        offer_number: 1,
        union_box_px: { xmin: 68, ymin: 941, xmax: 564, ymax: 1476, width: 496, height: 535 },
        product_thumb_box_px: { xmin: 138, ymin: 1105, xmax: 564, ymax: 1377, width: 426, height: 272 },
        offer_card_crop_path: 'C:/crops/offer-001/offer_card_crop.webp',
        product_thumb_crop_path: 'C:/crops/offer-001/product_thumb_crop.webp'
      };

      const canonical = mapRev1OfferToCanonical({
        offer,
        cropRect,
        pageNumber: 1,
        pdfBaseName: 'BNDW_Test',
        packageDir: 'C:/package',
        trustedContext: {
          leafletId: 'test-leaflet',
          supermarketId: 'sup-1',
          supermarketSlug: 'bin-dawood',
          locationScope: 'national',
          cityId: null,
          regionId: null,
          offerStartDate: '2026-10-14',
          offerEndDate: '2026-10-20'
        }
      });

      // Dual image crops exposed
      expect(canonical.source.thumbnail_path).toBe('C:/crops/offer-001/product_thumb_crop.webp');
      expect(canonical.image.thumbnail_path).toBe('C:/crops/offer-001/product_thumb_crop.webp');
      expect(canonical.source.crop_path).toBe('C:/crops/offer-001/offer_card_crop.webp');

      // Spatial prominence
      expect(canonical.source.page_area_share_pct).toBeGreaterThan(0);
      expect((canonical.raw.raw_attributes as any).spatial_prominence).toBeDefined();
      expect((canonical.raw.raw_attributes as any).spatial_prominence.is_front_page).toBe(true);
      expect((canonical.raw.raw_attributes as any).spatial_prominence.is_hero_offer).toBe(true);

      // Category hint & commodity tag
      expect(canonical.product.category_hint).toBe('meat-chicken');
      expect(canonical.product.commodity_tag).toBe('whole_chicken');
      expect(canonical.product.normalized_title_en).toBe('Sadia Whole Chicken');

      // Purchase limits
      expect(canonical.promotion.quantity_limit).toBe('Max 2 per customer');
      expect(canonical.promotion.condition_text).toBe('Max 2 per customer');

      // Bloat eliminated: raw_offer_extraction is the single offer object, not an array
      expect((canonical.raw.raw_attributes as any).raw_offer_extraction).toBeDefined();
      expect(Array.isArray((canonical.raw.raw_attributes as any).raw_offer_extraction)).toBe(false);
      expect((canonical.raw.raw_attributes as any).raw_offer_extraction.offer_number).toBe(1);
    });

    it('should preserve bonus pack mechanic in special_offer even on loyalty required offers', () => {
      const offer: ExtractedOfferRev1 = {
        offer_number: 3,
        arabic_title: 'نستله ميجا - آيس كريم ٩٥مل ٣ حبات',
        english_title: 'Nestle Mega - Ice Cream 95ml 3pcs',
        brand: 'Nestle',
        is_multi_brand_or_variant: false,
        promo_price: 9.99,
        original_price: 19.5,
        promo_condition: 'LOYALTY_CARD_REQUIRED',
        confidence: 0.98,
        size_value: '95ml',
        unit_type: '3pcs',
        components: {
          product_graphic_box: [346, 301, 467, 497],
          promo_price_box: [314, 270, 350, 417],
          original_price_box: [356, 271, 372, 319],
          unit_and_size_badge_box: [452, 281, 489, 337],
          title_text_box: [480, 326, 506, 498]
        }
      };

      const cropRect: OfferCropRectangles = {
        offer_number: 3,
        union_box_px: { xmin: 100, ymin: 100, xmax: 300, ymax: 300, width: 200, height: 200 },
        product_thumb_box_px: { xmin: 120, ymin: 120, xmax: 280, ymax: 280, width: 160, height: 160 }
      };

      const canonical = mapRev1OfferToCanonical({
        offer,
        cropRect,
        pageNumber: 2,
        pdfBaseName: 'BNDW_Test',
        packageDir: 'C:/package',
        trustedContext: {
          leafletId: 'test-leaflet',
          supermarketId: 'sup-1',
          supermarketSlug: 'bin-dawood',
          locationScope: 'national',
          cityId: null,
          regionId: null,
          offerStartDate: '2026-10-14',
          offerEndDate: '2026-10-20'
        }
      });

      expect(canonical.promotion.mechanic).toBe('loyalty_required');
      expect(canonical.promotion.condition_text).toBe('Loyalty Card Required');
      expect(canonical.promotion.special_offer).toBe('3pcs');
      expect(canonical.product.category_hint).toBe('frozen');
      expect(canonical.product.commodity_tag).toBe('ice_cream');
    });
  });
});
