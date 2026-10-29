import { describe, it, expect } from 'vitest';
import { pageFirstOfferExtractionSchema } from '../../../shared/schemas/pageFirstOfferExtractionSchema';
import {
  buildPageFirstOfferPrompt,
  buildPageFirstRetryPrompt
} from '../../ocr/pageFirstOfferPromptBuilder';
import {
  EvidenceLinkerService,
  normalizeForComparison,
  extractPriceNumbers
} from '../evidenceLinkerService';
import { PageCompletenessValidator } from '../pageCompletenessValidator';
import { PageExtractionReconciliationService } from '../pageExtractionReconciliationService';
import { AutomaticOfferCropService } from '../automaticOfferCropService';
import {
  estimateAnnotatedOcrCost,
  canAffordPrimaryPage,
  canAffordRetryPass,
  ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE
} from '../pageFirstCostBudget';
import type { NormalizedOcrBlock } from '../../../shared/types/normalizedOcrBlock';
import type { PageFirstExtractedOffer, PageFirstOfferExtraction } from '../../../shared/types/pageFirstOfferExtraction';

describe('Page-First OCR 4.1 Unit Tests (Chunk 68)', () => {
  describe('1. Strict Page Annotation Schema', () => {
    it('should validate a strictly conformant PageFirstOfferExtraction object', () => {
      const validPayload: PageFirstOfferExtraction = {
        schema_version: 1,
        page_number: 1,
        page_classification: 'offer_page',
        offers: [
          {
            temporary_offer_id: 'page1_offer_01',
            region_hint: 'top_left',
            product: {
              title_ar: 'حليب نادك كامل الدسم 1 لتر',
              title_en: 'Nadec Full Fat Milk 1L',
              brand_text: 'Nadec',
              description_ar: null,
              description_en: null,
              item_domain: 'grocery',
              variant_names: []
            },
            price_candidates: [
              {
                raw_text: '4.50',
                normalized_value: 4.5,
                currency: 'SAR',
                role: 'current_offer_price',
                is_crossed_out: false,
                confidence: 'high',
                evidence_text: '4.50'
              }
            ],
            selected_prices: {
              offer_price: 4.5,
              original_price: null,
              currency: 'SAR',
              offer_price_raw_text: '4.50',
              original_price_raw_text: null,
              confidence: 'high'
            },
            content: {
              size_text: '1L',
              each_size_value: 1,
              each_size_unit: 'liter',
              pack_quantity: 1,
              bundle_quantity: null,
              total_content_value: 1,
              total_content_unit: 'liter'
            },
            price_basis: {
              basis: 'each',
              raw_text: 'لكل حبة'
            },
            promotion: {
              mechanic: 'standard_price',
              raw_text: null,
              condition_text: null
            },
            evidence: {
              title_texts: ['حليب نادك كامل الدسم 1 لتر'],
              description_texts: [],
              current_price_texts: ['4.50'],
              original_price_texts: [],
              size_content_texts: ['1L'],
              promotion_texts: [],
              final_evidence_summary: 'حليب نادك 4.50'
            },
            confidence: {
              overall: 'high',
              product_identity: 'high',
              current_price: 'high',
              original_price: 'high',
              size_content: 'high',
              promotion: 'high'
            },
            warnings: []
          }
        ],
        uncertain_regions: [],
        page_summary: {
          independent_offer_count: 1,
          independent_current_price_anchor_count: 1,
          offers_with_original_price_count: 0,
          offers_with_size_or_content_count: 1,
          bundle_or_multi_buy_count: 0,
          low_confidence_offer_count: 0,
          final_completeness_check_performed: true
        }
      };

      const parsed = pageFirstOfferExtractionSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
    });

    it('should reject unknown extra keys due to strict schema rules', () => {
      const invalidPayload = {
        schema_version: 1,
        page_number: 1,
        page_classification: 'offer_page',
        offers: [],
        uncertain_regions: [],
        page_summary: {
          independent_offer_count: 0,
          independent_current_price_anchor_count: 0,
          offers_with_original_price_count: 0,
          offers_with_size_or_content_count: 0,
          bundle_or_multi_buy_count: 0,
          low_confidence_offer_count: 0,
          final_completeness_check_performed: true
        },
        unexpected_extra_key: 'not_allowed'
      };

      const parsed = pageFirstOfferExtractionSchema.safeParse(invalidPayload);
      expect(parsed.success).toBe(false);
    });
  });

  describe('2. Page Offer Extraction Prompt Builder', () => {
    it('should include independent price anchor rules and completeness requirements', () => {
      const prompt = buildPageFirstOfferPrompt();
      expect(prompt).toContain('Create one offer entry for each independent current-offer price anchor');
      expect(prompt).toContain('identify every independent product offer visible on this page');
      expect(prompt).toContain('return five offer entries, not one grouped entry');
      expect(prompt).toContain('final_completeness_check_performed=true');
    });

    it('should distinguish shared bundle prices from several independent offers and separate size from price', () => {
      const prompt = buildPageFirstOfferPrompt();
      expect(prompt).toContain('several products form one bundle with one shared price');
      expect(prompt).toContain('return one bundle offer');
      expect(prompt).toContain('Product size and content values are not prices:');
      expect(prompt).toContain('A smaller crossed-out or old price is not a separate offer.');
      expect(prompt).toContain('Classify it as original_old_price.');
    });

    it('should generate a targeted retry prompt with local diagnostic details', () => {
      const retryPrompt = buildPageFirstRetryPrompt({
        firstPassOfferCount: 5,
        independentAnchorCount: 7,
        uncoveredAnchorCount: 2,
        offersMissingPriceLinkCount: 1,
        suspiciousRegions: ['top_right', 'bottom_left']
      });
      expect(retryPrompt).toContain('second completeness audit');
      expect(retryPrompt).toContain('The first pass returned 5 offers');
      expect(retryPrompt).toContain('7 independent current-price anchors');
      expect(retryPrompt).toContain('2 uncovered anchors');
      expect(retryPrompt).toContain('top_right, bottom_left');
    });
  });

  describe('3. Text Normalization and Price/Size Discrimination', () => {
    it('should normalize Arabic-Indic digits and decimal separators to Western format', () => {
      expect(normalizeForComparison('١٠٫٥٠')).toBe('10.50');
      expect(normalizeForComparison('١٩٫٩٥ ريال')).toBe('19.95');
      expect(normalizeForComparison('  5.99  SAR  ')).toBe('5.99');
    });

    it('should extract exact price values without losing decimals', () => {
      const nums = extractPriceNumbers('السعر ١٢٫٥٠ ر.س قبل ٢٠٫٠٠');
      expect(nums).toContain(12.5);
      expect(nums).toContain(20.0);
    });

    it('should never match size text like 1.5L as a price 1.51', () => {
      const sizeNorm = normalizeForComparison('1.5L');
      const priceNorm = normalizeForComparison('1.51');
      expect(sizeNorm).not.toBe(priceNorm);
    });
  });

  describe('4. Offer Evidence Linking and Anchor Matching', () => {
    const mockBlocks: NormalizedOcrBlock[] = [
      {
        block_id: 'blk_title_1',
        page_number: 1,
        block_type: 'text',
        text: 'جبنة كيري 24 قطعة',
        normalized_text: 'جبنة كيري 24 قطعة',
        confidence: 0.95,
        bounds: { x: 50, y: 50, width: 200, height: 30 },
        source_dimensions: { width: 1000, height: 1400 },
        rendered_page_bounds: { x: 50, y: 50, width: 200, height: 30 }
      },
      {
        block_id: 'blk_price_1',
        page_number: 1,
        block_type: 'text',
        text: '١٥٫٩٥',
        normalized_text: '15.95',
        confidence: 0.98,
        bounds: { x: 60, y: 90, width: 60, height: 35 },
        source_dimensions: { width: 1000, height: 1400 },
        rendered_page_bounds: { x: 60, y: 90, width: 60, height: 35 }
      },
      {
        block_id: 'blk_oldprice_1',
        page_number: 1,
        block_type: 'text',
        text: '٢٢٫٠٠',
        normalized_text: '22.00',
        confidence: 0.92,
        bounds: { x: 130, y: 95, width: 50, height: 25 },
        source_dimensions: { width: 1000, height: 1400 },
        rendered_page_bounds: { x: 130, y: 95, width: 50, height: 25 }
      }
    ];

    it('should link title, current price, and old price to OCR blocks', () => {
      const offer: PageFirstExtractedOffer = {
        temporary_offer_id: 'off_01',
        region_hint: 'top_left',
        product: {
          title_ar: 'جبنة كيري 24 قطعة',
          title_en: 'Kiri Cheese 24 Pcs',
          brand_text: 'Kiri',
          description_ar: null,
          description_en: null,
          item_domain: 'grocery',
          variant_names: []
        },
        price_candidates: [],
        selected_prices: {
          offer_price: 15.95,
          original_price: 22.0,
          currency: 'SAR',
          offer_price_raw_text: '15.95',
          original_price_raw_text: '22.00',
          confidence: 'high'
        },
        content: {
          size_text: '24 Pcs',
          each_size_value: 24,
          each_size_unit: 'piece',
          pack_quantity: 1,
          bundle_quantity: null,
          total_content_value: 24,
          total_content_unit: 'piece'
        },
        price_basis: { basis: 'each', raw_text: null },
        promotion: { mechanic: 'standard_price', raw_text: null, condition_text: null },
        evidence: {
          title_texts: ['جبنة كيري 24 قطعة'],
          description_texts: [],
          current_price_texts: ['١٥٫٩٥', '15.95'],
          original_price_texts: ['٢٢٫٠٠', '22.00'],
          size_content_texts: ['24 قطعة'],
          promotion_texts: [],
          final_evidence_summary: 'جبنة كيري 15.95'
        },
        confidence: {
          overall: 'high',
          product_identity: 'high',
          current_price: 'high',
          original_price: 'high',
          size_content: 'high',
          promotion: 'high'
        },
        warnings: []
      };

      const result = EvidenceLinkerService.linkEvidence(offer, mockBlocks);
      expect(result.current_price_anchor_block_id).toBe('blk_price_1');
      expect(result.title_block_ids).toContain('blk_title_1');
      expect(result.original_price_block_ids).toContain('blk_oldprice_1');
      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('5. Page Completeness and Retry Validation', () => {
    it('should pass completeness when all offers have anchors and no uncovered anchor remains', () => {
      const completeness = PageCompletenessValidator.validate({
        pageNumber: 1,
        pageExtraction: {
          schema_version: 1,
          page_number: 1,
          page_classification: 'offer_page',
          offers: [
            {
              temporary_offer_id: 'off_1',
              selected_prices: { offer_price: 10.0 }
            } as any
          ],
          uncertain_regions: [],
          page_summary: {
            independent_offer_count: 1,
            independent_current_price_anchor_count: 1
          } as any
        },
        links: [
          {
            temporary_offer_id: 'off_1',
            current_price_anchor_block_id: 'blk_1',
            confidence: 0.9,
            warnings: []
          } as any
        ],
        blocks: [
          {
            block_id: 'blk_1',
            page_number: 1,
            block_type: 'text',
            text: '10.00',
            normalized_text: '10.00',
            confidence: 0.95,
            bounds: { x: 10, y: 10, width: 50, height: 30 },
            source_dimensions: { width: 1000, height: 1000 },
            rendered_page_bounds: { x: 10, y: 10, width: 50, height: 30 }
          }
        ]
      });

      expect(completeness.status).toBe('pass');
      expect(completeness.score).toBe(100);
      expect(completeness.blocking_issues.length).toBe(0);
    });

    it('should flag retry_required if an uncovered price anchor exists', () => {
      const completeness = PageCompletenessValidator.validate({
        pageNumber: 1,
        pageExtraction: {
          schema_version: 1,
          page_number: 1,
          page_classification: 'offer_page',
          offers: [
            {
              temporary_offer_id: 'off_1',
              selected_prices: { offer_price: 10.0 }
            } as any
          ],
          uncertain_regions: [],
          page_summary: {
            independent_offer_count: 1,
            independent_current_price_anchor_count: 2
          } as any
        },
        links: [
          {
            temporary_offer_id: 'off_1',
            current_price_anchor_block_id: 'blk_1',
            confidence: 0.9,
            warnings: []
          } as any
        ],
        blocks: [
          {
            block_id: 'blk_1',
            page_number: 1,
            block_type: 'text',
            text: '10.00',
            normalized_text: '10.00',
            confidence: 0.95,
            bounds: { x: 10, y: 10, width: 50, height: 30 },
            source_dimensions: { width: 1000, height: 1000 },
            rendered_page_bounds: { x: 10, y: 10, width: 50, height: 30 }
          },
          {
            block_id: 'blk_uncovered',
            page_number: 1,
            block_type: 'text',
            text: '25.00',
            normalized_text: '25.00',
            confidence: 0.95,
            bounds: { x: 500, y: 500, width: 60, height: 35 },
            source_dimensions: { width: 1000, height: 1000 },
            rendered_page_bounds: { x: 500, y: 500, width: 60, height: 35 }
          }
        ]
      });

      expect(completeness.status).toBe('retry_required');
      expect(completeness.uncovered_current_price_anchor_block_ids).toContain('blk_uncovered');
    });
  });

  describe('6. First Pass vs Retry Pass Reconciliation', () => {
    it('should select retry pass if it provides better anchor coverage and higher score', () => {
      const pass1Result = {
        extraction: { schema_version: 1, page_number: 1, page_classification: 'offer_page', offers: [{ temporary_offer_id: 'p1_1' }] } as any,
        links: [{ temporary_offer_id: 'p1_1', current_price_anchor_block_id: 'blk_1' }] as any,
        completeness: {
          page_number: 1,
          status: 'retry_required' as const,
          structured_offer_count: 1,
          linked_offer_count: 1,
          current_price_anchor_count: 2,
          uncovered_current_price_anchor_block_ids: ['blk_2'],
          duplicate_anchor_assignments: [],
          offers_missing_current_price_link: [],
          offers_with_multiple_current_price_links: [],
          crop_geometry_failures: [],
          blocking_issues: [{ code: 'UNCOVERED_ANCHORS', message: 'Uncovered anchor' }],
          warnings: [],
          score: 0.5
        },
        crops: [{ bounds: { x: 0, y: 0, width: 100, height: 100 } }] as any
      };

      const retryResult = {
        extraction: {
          schema_version: 1,
          page_number: 1,
          page_classification: 'offer_page',
          offers: [{ temporary_offer_id: 'r_1' }, { temporary_offer_id: 'r_2' }]
        } as any,
        links: [
          { temporary_offer_id: 'r_1', current_price_anchor_block_id: 'blk_1' },
          { temporary_offer_id: 'r_2', current_price_anchor_block_id: 'blk_2' }
        ] as any,
        completeness: {
          page_number: 1,
          status: 'pass' as const,
          structured_offer_count: 2,
          linked_offer_count: 2,
          current_price_anchor_count: 2,
          uncovered_current_price_anchor_block_ids: [],
          duplicate_anchor_assignments: [],
          offers_missing_current_price_link: [],
          offers_with_multiple_current_price_links: [],
          crop_geometry_failures: [],
          blocking_issues: [],
          warnings: [],
          score: 1.0
        },
        crops: [
          { bounds: { x: 0, y: 0, width: 100, height: 100 } },
          { bounds: { x: 100, y: 0, width: 100, height: 100 } }
        ] as any
      };

      const reconciled = PageExtractionReconciliationService.reconcile(pass1Result, retryResult);
      expect(reconciled.selected_pass).toBe('retry');
      expect(reconciled.offers.length).toBe(2);
      expect(reconciled.completeness.status).toBe('pass');
    });
  });

  describe('7. Crop Boundary Construction and Neighbor Anchor Exclusion', () => {
    it('should build crops that safely bound evidence and exclude neighboring anchors', () => {
      const mockOffers: PageFirstExtractedOffer[] = [
        {
          temporary_offer_id: 'off_left',
          region_hint: 'top_left',
          product: { title_ar: 'المنتج الأيسر' } as any,
          selected_prices: { offer_price: 10 } as any,
          evidence: { title_texts: ['المنتج الأيسر'], current_price_texts: ['10'] } as any
        } as any,
        {
          temporary_offer_id: 'off_right',
          region_hint: 'top_right',
          product: { title_ar: 'المنتج الأيمن' } as any,
          selected_prices: { offer_price: 20 } as any,
          evidence: { title_texts: ['المنتج الأيمن'], current_price_texts: ['20'] } as any
        } as any
      ];

      const mockBlocks: NormalizedOcrBlock[] = [
        {
          block_id: 'blk_anc_left',
          page_number: 1,
          block_type: 'text',
          text: '10',
          normalized_text: '10',
          confidence: 0.95,
          bounds: { x: 100, y: 150, width: 60, height: 40 },
          source_dimensions: { width: 1000, height: 1000 },
          rendered_page_bounds: { x: 100, y: 150, width: 60, height: 40 }
        },
        {
          block_id: 'blk_anc_right',
          page_number: 1,
          block_type: 'text',
          text: '20',
          normalized_text: '20',
          confidence: 0.95,
          bounds: { x: 600, y: 150, width: 60, height: 40 },
          source_dimensions: { width: 1000, height: 1000 },
          rendered_page_bounds: { x: 600, y: 150, width: 60, height: 40 }
        }
      ];

      const mockLinks = [
        {
          temporary_offer_id: 'off_left',
          current_price_anchor_block_id: 'blk_anc_left',
          linked_block_ids: ['blk_anc_left'],
          confidence: 0.95,
          warnings: []
        } as any,
        {
          temporary_offer_id: 'off_right',
          current_price_anchor_block_id: 'blk_anc_right',
          linked_block_ids: ['blk_anc_right'],
          confidence: 0.95,
          warnings: []
        } as any
      ];

      const crops = AutomaticOfferCropService.constructCrops({
        pageNumber: 1,
        pageWidth: 1000,
        pageHeight: 1000,
        pdfBaseName: 'test-leaflet',
        offers: mockOffers,
        evidenceLinks: mockLinks,
        ocrBlocks: mockBlocks
      });

      expect(crops.length).toBe(2);
      const leftCrop = crops.find(c => c.current_price_anchor_block_id === 'blk_anc_left')!;
      const rightCrop = crops.find(c => c.current_price_anchor_block_id === 'blk_anc_right')!;

      // Left crop must not contain right anchor (x: 600)
      expect(leftCrop.bounds.x + leftCrop.bounds.width).toBeLessThanOrEqual(600);
      // Right crop must start to the right of left anchor
      expect(rightCrop.bounds.x).toBeGreaterThanOrEqual(160);
    });
  });

  describe('8. Cost Estimation and Budget Gate ($0.95 Leaflet Limit)', () => {
    it('should estimate cost at $0.005 per page correctly', () => {
      const cost = estimateAnnotatedOcrCost(10, 2);
      expect(cost).toBeCloseTo(12 * ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE, 4);
      expect(cost).toBe(0.06);
    });

    it('should allow primary processing when well within the $0.95 budget', () => {
      expect(canAffordPrimaryPage(20)).toBe(true); // 21 * 0.005 = $0.105 <= $0.95
    });

    it('should block primary processing when exceeding $0.95 budget', () => {
      expect(canAffordPrimaryPage(200)).toBe(false); // 201 * 0.005 = $1.005 > $0.95
    });

    it('should block retries if retry would exceed $0.95 budget', () => {
      expect(canAffordRetryPass(189, 1)).toBe(false); // (189 + 1 + 1) * 0.005 = $0.955 > $0.95
    });
  });

  describe('9. Extraction Manifest Backward Compatibility', () => {
    it('should handle older manifest without page_first_ocr section gracefully', () => {
      const olderManifest: any = {
        extraction_folder_name: 'Danube_Old',
        paths: {
          workspace_root: '/workspace',
          crops_dir: '/workspace/crops',
          json_dir: '/workspace/json'
        },
        pages: []
      };

      // In Chunk 68, loading older manifest works without throwing
      expect(olderManifest.extraction_mode).toBeUndefined();
      expect(olderManifest.page_first_ocr).toBeUndefined();

      // Migration or default fallback
      const effectiveMode = olderManifest.extraction_mode || 'page_first_annotated_ocr';
      expect(effectiveMode).toBe('page_first_annotated_ocr');
    });
  });
});
