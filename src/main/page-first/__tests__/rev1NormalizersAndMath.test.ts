import { describe, it, expect } from 'vitest';
import {
  normalizePriceValue,
  normalizeExtractedOffer
} from '../../../shared/utils/priceAndUnitNormalizer';
import {
  computeRawOfferUnionBox,
  clampNeighborBleed,
  computeBoxIoU,
  areCompoundSiblings,
  cropAndSaveOfferAssets
} from '../spatialUnionAndClampingService';
import { runStage5CompletenessAudit } from '../rev1CompletenessAuditService';
import {
  ActiveLearningExporter,
  convertBoxToYoloFormat,
  formatYoloLine
} from '../../ml/activeLearningExporter';
import type {
  ExtractedOfferRev1,
  LeafletPageExtractionRev1
} from '../../../shared/types/leafletExtraction';

describe('rev1 Deterministic Math & Normalizers Unit Tests', () => {
  describe('1. Price Normalization Rules', () => {
    it('should correctly normalize hyphenated prices to standard floats', () => {
      expect(normalizePriceValue('18-99')).toBe(18.99);
      expect(normalizePriceValue('16-99')).toBe(16.99);
      expect(normalizePriceValue('10-99')).toBe(10.99);
      expect(normalizePriceValue('6-99')).toBe(6.99);
      expect(normalizePriceValue('18–99')).toBe(18.99); // en-dash
      expect(normalizePriceValue('18—99')).toBe(18.99); // em-dash
    });

    it('should correctly normalize superscript/spaced halalas', () => {
      expect(normalizePriceValue('14 95')).toBe(14.95);
      expect(normalizePriceValue('5 00')).toBe(5.0);
    });

    it('should enforce original_price = null when original_price_box is null', () => {
      const offerWithoutSecondaryBox: ExtractedOfferRev1 = {
        offer_number: 2,
        arabic_title: 'حبحب',
        english_title: 'Watermelon',
        brand: null,
        is_multi_brand_or_variant: false,
        size_value: '2 Kg',
        unit_type: 'Kg / كيلو',
        promo_price: 5,
        original_price: 5,
        promo_condition: 'STANDARD',
        confidence: 0.99,
        components: {
          product_graphic_box: [485, 360, 615, 620],
          promo_price_box: [580, 530, 640, 630],
          original_price_box: null,
          unit_and_size_badge_box: [470, 355, 520, 425],
          title_text_box: [620, 355, 655, 630]
        }
      };

      const normalized = normalizeExtractedOffer(offerWithoutSecondaryBox);
      expect(normalized.original_price).toBeNull();
      expect(normalized.promo_price).toBe(5);
    });
  });

  describe('2. Mathematical Union Box & Layout Adaptation', () => {
    it('should calculate union box on top-left badge layout (Page 1 style)', () => {
      const page1Offer: ExtractedOfferRev1 = {
        offer_number: 1,
        arabic_title: 'ساديا دجاج',
        english_title: 'Sadia Chicken',
        brand: 'Sadia',
        is_multi_brand_or_variant: false,
        size_value: '270g',
        unit_type: 'Each',
        promo_price: 5,
        original_price: 11.25,
        promo_condition: 'STANDARD',
        confidence: 0.98,
        components: {
          product_graphic_box: [485, 45, 615, 295],
          promo_price_box: [580, 210, 640, 310],
          original_price_box: [555, 210, 582, 310],
          unit_and_size_badge_box: [470, 40, 520, 110],
          title_text_box: [620, 40, 655, 310]
        }
      };

      const box960 = computeRawOfferUnionBox(page1Offer, 960, 1280);
      expect(box960.ymin).toBe(Math.round((470 / 1000) * 1280));
      expect(box960.xmin).toBe(Math.round((40 / 1000) * 960));
      expect(box960.ymax).toBe(Math.round((655 / 1000) * 1280));
      expect(box960.xmax).toBe(Math.round((310 / 1000) * 960));

      const boxHighRes = computeRawOfferUnionBox(page1Offer, 4000, 5333);
      expect(boxHighRes.ymin).toBe(Math.round((470 / 1000) * 5333));
      expect(boxHighRes.xmin).toBe(Math.round((40 / 1000) * 4000));
      expect(boxHighRes.ymax).toBe(Math.round((655 / 1000) * 5333));
      expect(boxHighRes.xmax).toBe(Math.round((310 / 1000) * 4000));
    });

    it('should calculate union box on bottom-right badge layout (Page 4 style)', () => {
      const page4Offer: ExtractedOfferRev1 = {
        offer_number: 1,
        arabic_title: 'جبن المراعي',
        english_title: 'Almarai Cheese',
        brand: 'Almarai',
        is_multi_brand_or_variant: false,
        size_value: '400g',
        unit_type: 'Each',
        promo_price: 9.95,
        original_price: 14.5,
        promo_condition: 'LOYALTY_CARD_REQUIRED',
        confidence: 0.98,
        components: {
          product_graphic_box: [60, 45, 230, 460],
          promo_price_box: [190, 320, 255, 470],
          original_price_box: [165, 320, 192, 470],
          unit_and_size_badge_box: [130, 320, 165, 470],
          title_text_box: [235, 45, 275, 460]
        }
      };

      const box = computeRawOfferUnionBox(page4Offer, 1000, 1000);
      expect(box.ymin).toBe(60);
      expect(box.xmin).toBe(45);
      expect(box.ymax).toBe(275);
      expect(box.xmax).toBe(470);
    });
  });

  describe('3. Voronoi Neighbor-Bleed Clamping', () => {
    it('should clamp overlapping neighbor boxes along their Voronoi midpoint', () => {
      const offerLeft: ExtractedOfferRev1 = {
        offer_number: 1,
        arabic_title: 'منتج أ',
        english_title: 'Product A',
        brand: null,
        is_multi_brand_or_variant: false,
        size_value: '100g',
        unit_type: 'Each',
        promo_price: 5,
        original_price: null,
        promo_condition: 'STANDARD',
        confidence: 0.95,
        components: {
          product_graphic_box: [100, 50, 300, 240],
          promo_price_box: [250, 150, 300, 240],
          original_price_box: null,
          unit_and_size_badge_box: [100, 200, 150, 260],
          title_text_box: null
        }
      };

      const offerRight: ExtractedOfferRev1 = {
        offer_number: 2,
        arabic_title: 'منتج ب',
        english_title: 'Product B',
        brand: null,
        is_multi_brand_or_variant: false,
        size_value: '100g',
        unit_type: 'Each',
        promo_price: 5,
        original_price: null,
        promo_condition: 'STANDARD',
        confidence: 0.95,
        components: {
          product_graphic_box: [100, 260, 300, 450],
          promo_price_box: [250, 350, 300, 450],
          original_price_box: null,
          unit_and_size_badge_box: [100, 240, 150, 300],
          title_text_box: null
        }
      };

      const rawLeft = computeRawOfferUnionBox(offerLeft, 1000, 1000);
      const rawRight = computeRawOfferUnionBox(offerRight, 1000, 1000);
      expect(rawLeft.xmax).toBe(260);
      expect(rawRight.xmin).toBe(240);

      const clamped = clampNeighborBleed([offerLeft, offerRight], [rawLeft, rawRight], 1000, 1000);
      expect(clamped[0].xmax).toBe(clamped[1].xmin);
      expect(clamped[0].xmax).toBe(250);
      expect(clamped[1].xmin).toBe(250);
    });
  });

  describe('4. Stage 5 Completeness Audit', () => {
    it('should detect price inversions when promo_price >= original_price', () => {
      const invertedOffer: ExtractedOfferRev1 = {
        offer_number: 1,
        arabic_title: 'منتج مقلوب',
        english_title: 'Inverted Product',
        brand: null,
        is_multi_brand_or_variant: false,
        size_value: '1kg',
        unit_type: 'Each',
        promo_price: 25,
        original_price: 15,
        promo_condition: 'STANDARD',
        confidence: 0.9,
        components: {
          product_graphic_box: [100, 100, 300, 300],
          promo_price_box: [250, 200, 300, 300],
          original_price_box: [220, 200, 245, 300],
          unit_and_size_badge_box: null,
          title_text_box: [305, 100, 350, 300]
        }
      };

      const page: LeafletPageExtractionRev1 = {
        is_loyalty_page: false,
        loyalty_program_name: null,
        validity_start_date: null,
        validity_end_date: null,
        ignored_banners: [],
        offers: [invertedOffer]
      };

      const audit = runStage5CompletenessAudit(page, 1000, 1000);
      expect(audit.passed).toBe(false);
      expect(audit.issues.some(i => i.code === 'PRICE_INVERSION')).toBe(true);
    });

    it('should detect severe bounding box collisions when IoU >= 0.15', () => {
      const boxA = { xmin: 100, ymin: 100, xmax: 300, ymax: 300, width: 200, height: 200 };
      const boxB = { xmin: 120, ymin: 120, xmax: 320, ymax: 320, width: 200, height: 200 };
      const iou = computeBoxIoU(boxA, boxB);
      expect(iou).toBeGreaterThanOrEqual(0.15);
    });
  });

  describe('5. YOLO Normalized Coordinate Export', () => {
    it('should convert [ymin, xmin, ymax, xmax] 0-1000 into valid YOLO format', () => {
      const box2d: [number, number, number, number] = [485, 45, 615, 295];
      const yolo = convertBoxToYoloFormat(box2d, 0);

      expect(yolo.xCenter).toBeCloseTo(0.17, 4);
      expect(yolo.yCenter).toBeCloseTo(0.55, 4);
      expect(yolo.width).toBeCloseTo(0.25, 4);
      expect(yolo.height).toBeCloseTo(0.13, 4);

      const formatted = formatYoloLine(yolo);
      expect(formatted).toBe('0 0.170000 0.550000 0.250000 0.130000');
    });

    it('should strictly exclude original_price_box (class 2) when original_price is null', () => {
      const offerNoOrigPrice: ExtractedOfferRev1 = {
        offer_number: 1,
        arabic_title: 'حبحب',
        english_title: 'Watermelon',
        brand: null,
        is_multi_brand_or_variant: false,
        size_value: '2 Kg',
        unit_type: 'Kg',
        promo_price: 5,
        original_price: null,
        promo_condition: 'STANDARD',
        confidence: 0.99,
        components: {
          product_graphic_box: [100, 100, 300, 300],
          promo_price_box: [250, 200, 300, 300],
          original_price_box: [220, 200, 245, 300], // Box present but price is null
          unit_and_size_badge_box: [100, 100, 150, 150],
          title_text_box: [305, 100, 350, 300]
        }
      };

      // 1. In YOLO exporter
      const exporter = new ActiveLearningExporter();
      const lines = exporter.generateYoloAnnotations([offerNoOrigPrice]);

      // Should only have classes 0, 1, 3, 4 (4 lines total, NO class 2)
      expect(lines.length).toBe(4);
      expect(lines.some((l: string) => l.startsWith('2 '))).toBe(false);

      // 2. In Union Box calculation
      const union = computeRawOfferUnionBox(offerNoOrigPrice, 1000, 1000);
      // ymin should be from unit_and_size_badge_box / product_graphic (100)
      expect(union.ymin).toBe(100);
    });
  });

  describe('6. Compound Multi-Tier Sibling Clustering & Clamping Protection', () => {
    // Sibling offers modeled on Panda Page 2 (Seara chicken 134.99 and 44.99)
    const offerTopTier: ExtractedOfferRev1 = {
      offer_number: 2,
      arabic_title: 'دجاج مجمد سيارا (10 × 900 جرام)',
      english_title: 'Seara Frozen Chicken (10 x 900g)',
      brand: 'Seara',
      is_multi_brand_or_variant: false,
      compound_group_id: 'cell_seara',
      size_value: '10x900g',
      unit_type: 'كرتون',
      promo_price: 134.99,
      original_price: 179.99,
      promo_condition: 'STANDARD',
      confidence: 0.98,
      components: {
        product_graphic_box: [314, 360, 417, 503],
        promo_price_box: [313, 534, 353, 629],
        original_price_box: [299, 552, 316, 611],
        unit_and_size_badge_box: [288, 501, 321, 555],
        title_text_box: [421, 452, 449, 663]
      }
    };

    const offerBottomTier: ExtractedOfferRev1 = {
      offer_number: 3,
      arabic_title: 'دجاج مجمد سيارا (10 × 900 جرام)',
      english_title: 'Seara Frozen Chicken (10 x 900g)',
      brand: 'Seara',
      is_multi_brand_or_variant: false,
      compound_group_id: 'cell_seara',
      size_value: '3x900g',
      unit_type: 'حبات',
      promo_price: 44.99,
      original_price: 55.5,
      promo_condition: 'MULTI_BUY',
      confidence: 0.98,
      components: {
        product_graphic_box: [330, 360, 417, 452],
        promo_price_box: [383, 534, 418, 626],
        original_price_box: [366, 557, 382, 608],
        unit_and_size_badge_box: [358, 448, 396, 508],
        title_text_box: [421, 452, 449, 663] // Exactly identical shared title box
      }
    };

    it('should correctly identify compound siblings via compound_group_id or shared title box', () => {
      expect(areCompoundSiblings(offerTopTier, offerBottomTier)).toBe(true);

      // Even without compound_group_id, IoU of shared title box should trigger sibling match
      const copyA = { ...offerTopTier, compound_group_id: null };
      const copyB = { ...offerBottomTier, compound_group_id: null };
      expect(areCompoundSiblings(copyA, copyB)).toBe(true);
    });

    it('should assign the full compound cell union box to both siblings and NEVER slice them', () => {
      const rawA = computeRawOfferUnionBox(offerTopTier, 1000, 1000);
      const rawB = computeRawOfferUnionBox(offerBottomTier, 1000, 1000);

      const clamped = clampNeighborBleed([offerTopTier, offerBottomTier], [rawA, rawB], 1000, 1000);

      expect(clamped.length).toBe(2);
      // Both offers must receive the EXACT same full compound union box
      expect(clamped[0].ymin).toBe(clamped[1].ymin);
      expect(clamped[0].ymax).toBe(clamped[1].ymax);
      expect(clamped[0].xmin).toBe(clamped[1].xmin);
      expect(clamped[0].xmax).toBe(clamped[1].xmax);

      // Union box must span from the top-most component to bottom-most title
      // Top-most is unit_and_size_badge_box ymin = 288
      expect(clamped[0].ymin).toBeLessThanOrEqual(288);
      // Bottom-most is title_text_box ymax = 449
      expect(clamped[0].ymax).toBeGreaterThanOrEqual(449);
      // Right-most includes title_text_box xmax = 663
      expect(clamped[0].xmax).toBeGreaterThanOrEqual(663);
      // Left-most includes product_graphic_box xmin = 360
      expect(clamped[0].xmin).toBeLessThanOrEqual(360);
    });

    it('should skip pairwise collision in Stage 5 audit for compound siblings', () => {
      const page: LeafletPageExtractionRev1 = {
        is_loyalty_page: false,
        loyalty_program_name: null,
        validity_start_date: null,
        validity_end_date: null,
        ignored_banners: [],
        offers: [offerTopTier, offerBottomTier]
      };

      const audit = runStage5CompletenessAudit(page, 1000, 1000);
      // Must NOT fail due to IOU_COLLISION
      expect(audit.issues.some(i => i.code === 'IOU_COLLISION')).toBe(false);
      expect(audit.passed).toBe(true);
    });

    it('should apply defensive 8% ymax spatial fallback when title_text_box is omitted', () => {
      const offerWithoutTitleBox: ExtractedOfferRev1 = {
        offer_number: 1,
        arabic_title: 'دجاج مجمد ساديا',
        english_title: 'Sadia Whole Chicken',
        brand: 'Sadia',
        is_multi_brand_or_variant: false,
        size_value: '1000g',
        unit_type: null,
        promo_price: 14.99,
        original_price: 20,
        promo_condition: 'STANDARD',
        confidence: 0.99,
        components: {
          product_graphic_box: [378, 67, 471, 273],
          promo_price_box: [369, 33, 400, 166],
          original_price_box: [383, 122, 396, 162],
          unit_and_size_badge_box: [370, 122, 384, 162],
          title_text_box: null
        }
      };

      const box = computeRawOfferUnionBox(offerWithoutTitleBox, 1000, 1000);
      // Without fallback, ymax would be 471. With 8% height fallback, ymax should be > 471
      expect(box.ymax).toBeGreaterThan(471);
      const height = 471 - 369; // 102
      expect(box.ymax).toBe(471 + Math.round(height * 0.08));
    });

    it('should deduplicate compound cell crops on disk and have sibling offers reference the primary crop', async () => {
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      const { existsSync } = await import('fs');
      const testDir = join(tmpdir(), `test-crop-dedup-${Date.now()}`);

      // Create a 100x100 white test image buffer using sharp
      const sharp = (await import('sharp')).default;
      const testImgBuffer = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 255, g: 255, b: 255 }
        }
      }).png().toBuffer();

      const cropRects = [
        {
          offer_number: 1,
          union_box_px: { xmin: 10, ymin: 10, xmax: 100, ymax: 100, width: 90, height: 90 },
          product_thumb_box_px: { xmin: 20, ymin: 20, xmax: 80, ymax: 80, width: 60, height: 60 }
        },
        {
          offer_number: 2,
          // Exact same compound union box as offer 1 (sibling offer)
          union_box_px: { xmin: 10, ymin: 10, xmax: 100, ymax: 100, width: 90, height: 90 },
          product_thumb_box_px: { xmin: 20, ymin: 20, xmax: 80, ymax: 80, width: 60, height: 60 }
        }
      ];

      const saved = await cropAndSaveOfferAssets(testImgBuffer, cropRects as any, testDir, 200, 200);

      expect(saved.length).toBe(2);
      // Offer 1 wrote its files
      expect(saved[0].offer_card_crop_path).toContain('offer-001');
      expect(existsSync(saved[0].offer_card_crop_path!)).toBe(true);

      // Offer 2 reused Offer 1's files on disk (no duplicate offer-002 folder or file)
      expect(saved[1].offer_card_crop_path).toBe(saved[0].offer_card_crop_path);
      expect(saved[1].product_thumb_crop_path).toBe(saved[0].product_thumb_crop_path);
      const offer2Dir = join(testDir, 'offer-002');
      expect(existsSync(offer2Dir)).toBe(false);
    });
  });
});
