import { describe, it, expect } from 'vitest';
import { EvidenceLinkerService } from '../evidenceLinkerService';
import { PageCompletenessValidator } from '../pageCompletenessValidator';
import { AutomaticOfferCropService } from '../automaticOfferCropService';
import type { NormalizedOcrBlock } from '../../../shared/types/normalizedOcrBlock';
import type { PageFirstExtractedOffer } from '../../../shared/types/pageFirstOfferExtraction';

describe('Page-First Synthetic Page Fixtures (Chunk 68 Section 52)', () => {
  const PAGE_WIDTH = 1200;
  const PAGE_HEIGHT = 1600;

  // 1. Regular 4-column grid fixture (4 columns x 3 rows = 12 offers)
  it('Fixture 1: Regular 4-column grid produces clean partition and 0 uncovered anchors', () => {
    const cols = 4;
    const rows = 3;
    const offers: PageFirstExtractedOffer[] = [];
    const blocks: NormalizedOcrBlock[] = [];

    let count = 0;
    const colW = PAGE_WIDTH / cols;
    const rowH = PAGE_HEIGHT / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        count++;
        const id = `grid_${count}`;
        const x = c * colW + 20;
        const y = r * rowH + 20;
        const price = (count * 5).toFixed(2);

        offers.push({
          temporary_offer_id: id,
          region_hint: 'unknown',
          product: {
            title_ar: `منتج شبكة ${count}`,
            title_en: `Grid Product ${count}`,
            brand_text: 'Brand',
            description_ar: null,
            description_en: null,
            item_domain: 'grocery',
            variant_names: []
          },
          price_candidates: [],
          selected_prices: {
            offer_price: parseFloat(price),
            original_price: null,
            currency: 'SAR',
            offer_price_raw_text: price,
            original_price_raw_text: null,
            confidence: 'high'
          },
          content: {
            size_text: '1kg',
            each_size_value: 1,
            each_size_unit: 'kilogram',
            pack_quantity: 1,
            bundle_quantity: null,
            total_content_value: 1,
            total_content_unit: 'kilogram'
          },
          price_basis: { basis: 'each', raw_text: null },
          promotion: { mechanic: 'standard_price', raw_text: null, condition_text: null },
          evidence: {
            title_texts: [`منتج شبكة ${count}`],
            description_texts: [],
            current_price_texts: [price],
            original_price_texts: [],
            size_content_texts: ['1kg'],
            promotion_texts: [],
            final_evidence_summary: `منتج شبكة ${count} ${price}`
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
        });

        // Title block
        blocks.push({
          block_id: `blk_title_${count}`,
          page_number: 1,
          block_type: 'text',
          text: `منتج شبكة ${count}`,
          normalized_text: `منتج شبكة ${count}`,
          confidence: 0.95,
          bounds: { x, y, width: 180, height: 25 },
          source_dimensions: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          rendered_page_bounds: { x, y, width: 180, height: 25 }
        });

        // Price block
        blocks.push({
          block_id: `blk_price_${count}`,
          page_number: 1,
          block_type: 'text',
          text: price,
          normalized_text: price,
          confidence: 0.98,
          bounds: { x: x + 10, y: y + 80, width: 60, height: 35 },
          source_dimensions: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          rendered_page_bounds: { x: x + 10, y: y + 80, width: 60, height: 35 }
        });
      }
    }

    const links = offers.map(o => EvidenceLinkerService.linkEvidence(o, blocks));
    expect(links.filter(l => l.current_price_anchor_block_id !== null).length).toBe(12);

    const completeness = PageCompletenessValidator.validate({
      pageNumber: 1,
      pageExtraction: {
        schema_version: 1,
        page_number: 1,
        page_classification: 'offer_page',
        offers,
        uncertain_regions: [],
        page_summary: {
          independent_offer_count: 12,
          independent_current_price_anchor_count: 12
        } as any
      },
      links,
      blocks
    });

    expect(completeness.status).toBe('pass');
    expect(completeness.uncovered_current_price_anchor_block_ids.length).toBe(0);

    const crops = AutomaticOfferCropService.constructCrops({
      pageNumber: 1,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      pdfBaseName: 'grid-test',
      offers,
      evidenceLinks: links,
      ocrBlocks: blocks
    });

    expect(crops.length).toBe(12);
  });

  // 2. Large center hero offer with two side offers on each side (5 offers total)
  it('Fixture 2: Center hero offer with 2 side offers on each side', () => {
    const offers: PageFirstExtractedOffer[] = [
      // Left side offers
      { temporary_offer_id: 'left_1', region_hint: 'top_left', product: { title_ar: 'جانب أيسر 1' } as any, selected_prices: { offer_price: 10 } as any, evidence: { title_texts: ['جانب أيسر 1'], current_price_texts: ['10'] } as any } as any,
      { temporary_offer_id: 'left_2', region_hint: 'bottom_left', product: { title_ar: 'جانب أيسر 2' } as any, selected_prices: { offer_price: 15 } as any, evidence: { title_texts: ['جانب أيسر 2'], current_price_texts: ['15'] } as any } as any,
      // Large center hero
      { temporary_offer_id: 'hero_center', region_hint: 'middle', product: { title_ar: 'البطل الرئيسي الكبير' } as any, selected_prices: { offer_price: 99 } as any, evidence: { title_texts: ['البطل الرئيسي الكبير'], current_price_texts: ['99'] } as any } as any,
      // Right side offers
      { temporary_offer_id: 'right_1', region_hint: 'top_right', product: { title_ar: 'جانب أيمن 1' } as any, selected_prices: { offer_price: 12 } as any, evidence: { title_texts: ['جانب أيمن 1'], current_price_texts: ['12'] } as any } as any,
      { temporary_offer_id: 'right_2', region_hint: 'bottom_right', product: { title_ar: 'جانب أيمن 2' } as any, selected_prices: { offer_price: 18 } as any, evidence: { title_texts: ['جانب أيمن 2'], current_price_texts: ['18'] } as any } as any
    ];

    const blocks: NormalizedOcrBlock[] = [
      { block_id: 'b_left1_p', page_number: 1, block_type: 'text', text: '10', normalized_text: '10', confidence: 0.95, bounds: { x: 50, y: 200, width: 50, height: 30 }, source_dimensions: { width: 1200, height: 1600 }, rendered_page_bounds: { x: 50, y: 200, width: 50, height: 30 } },
      { block_id: 'b_left2_p', page_number: 1, block_type: 'text', text: '15', normalized_text: '15', confidence: 0.95, bounds: { x: 50, y: 900, width: 50, height: 30 }, source_dimensions: { width: 1200, height: 1600 }, rendered_page_bounds: { x: 50, y: 900, width: 50, height: 30 } },
      { block_id: 'b_hero_t', page_number: 1, block_type: 'text', text: 'البطل الرئيسي الكبير', normalized_text: 'البطل الرئيسي الكبير', confidence: 0.99, bounds: { x: 450, y: 520, width: 300, height: 40 }, source_dimensions: { width: 1200, height: 1600 }, rendered_page_bounds: { x: 450, y: 520, width: 300, height: 40 } },
      { block_id: 'b_hero_p', page_number: 1, block_type: 'text', text: '99', normalized_text: '99', confidence: 0.99, bounds: { x: 550, y: 600, width: 100, height: 60 }, source_dimensions: { width: 1200, height: 1600 }, rendered_page_bounds: { x: 550, y: 600, width: 100, height: 60 } },
      { block_id: 'b_right1_p', page_number: 1, block_type: 'text', text: '12', normalized_text: '12', confidence: 0.95, bounds: { x: 1000, y: 200, width: 50, height: 30 }, source_dimensions: { width: 1200, height: 1600 }, rendered_page_bounds: { x: 1000, y: 200, width: 50, height: 30 } },
      { block_id: 'b_right2_p', page_number: 1, block_type: 'text', text: '18', normalized_text: '18', confidence: 0.95, bounds: { x: 1000, y: 900, width: 50, height: 30 }, source_dimensions: { width: 1200, height: 1600 }, rendered_page_bounds: { x: 1000, y: 900, width: 50, height: 30 } }
    ];

    const links = offers.map(o => EvidenceLinkerService.linkEvidence(o, blocks));
    const heroLink = links.find(l => l.temporary_offer_id === 'hero_center');
    expect(heroLink?.current_price_anchor_block_id).toBe('b_hero_p');

    const crops = AutomaticOfferCropService.constructCrops({
      pageNumber: 1,
      pageWidth: 1200,
      pageHeight: 1600,
      pdfBaseName: 'hero-test',
      offers,
      evidenceLinks: links,
      ocrBlocks: blocks
    });

    expect(crops.length).toBe(5);
    const heroCrop = crops.find(c => c.current_price_anchor_block_id === 'b_hero_p')!;
    expect(heroCrop.bounds.width).toBeGreaterThan(200);
  });

  // 3. Known Manual Benchmark: 13-offer mixed page
  it('Fixture 3 (Critical Section 52): 13-offer mixed page verifies 13 offers, 13 anchors, 13 links, 13 crops, 0 uncovered anchors, 0 multi-anchor crops', () => {
    const mixedOffers: PageFirstExtractedOffer[] = [];
    const mixedBlocks: NormalizedOcrBlock[] = [];

    // Distinct coordinates and prices for 13 offers
    const positions = [
      { x: 50, y: 50, price: 9.95 },
      { x: 450, y: 50, price: 14.50 },
      { x: 850, y: 50, price: 22.00 },
      { x: 50, y: 400, price: 5.75 },
      { x: 450, y: 400, price: 33.00 },
      { x: 850, y: 400, price: 19.99 },
      { x: 50, y: 750, price: 8.50 },
      { x: 450, y: 750, price: 45.00 },
      { x: 850, y: 750, price: 11.25 },
      { x: 50, y: 1100, price: 6.95 },
      { x: 450, y: 1100, price: 28.50 },
      { x: 850, y: 1100, price: 16.00 },
      { x: 450, y: 1400, price: 99.00 } // bottom center 13th offer
    ];

    expect(positions.length).toBe(13);

    for (let i = 0; i < 13; i++) {
      const idx = i + 1;
      const pos = positions[i];
      const pStr = pos.price.toFixed(2);

      mixedOffers.push({
        temporary_offer_id: `mixed_offer_${idx}`,
        region_hint: 'unknown',
        product: {
          title_ar: `عرض متنوع رقم ${idx}`,
          title_en: `Mixed Offer ${idx}`,
          brand_text: `Brand ${idx}`,
          description_ar: null,
          description_en: null,
          item_domain: 'grocery',
          variant_names: []
        },
        price_candidates: [],
        selected_prices: {
          offer_price: pos.price,
          original_price: null,
          currency: 'SAR',
          offer_price_raw_text: pStr,
          original_price_raw_text: null,
          confidence: 'high'
        },
        content: {
          size_text: '500g',
          each_size_value: 500,
          each_size_unit: 'gram',
          pack_quantity: 1,
          bundle_quantity: null,
          total_content_value: 500,
          total_content_unit: 'gram'
        },
        price_basis: { basis: 'each', raw_text: null },
        promotion: { mechanic: 'standard_price', raw_text: null, condition_text: null },
        evidence: {
          title_texts: [`عرض متنوع رقم ${idx}`],
          description_texts: [],
          current_price_texts: [pStr],
          original_price_texts: [],
          size_content_texts: ['500g'],
          promotion_texts: [],
          final_evidence_summary: `عرض ${idx} ${pStr}`
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
      });

      // Price block
      mixedBlocks.push({
        block_id: `blk_mixed_p_${idx}`,
        page_number: 1,
        block_type: 'text',
        text: pStr,
        normalized_text: pStr,
        confidence: 0.98,
        bounds: { x: pos.x, y: pos.y + 40, width: 70, height: 35 },
        source_dimensions: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        rendered_page_bounds: { x: pos.x, y: pos.y + 40, width: 70, height: 35 }
      });

      // Title block
      mixedBlocks.push({
        block_id: `blk_mixed_t_${idx}`,
        page_number: 1,
        block_type: 'text',
        text: `عرض متنوع رقم ${idx}`,
        normalized_text: `عرض متنوع رقم ${idx}`,
        confidence: 0.95,
        bounds: { x: pos.x, y: pos.y, width: 200, height: 30 },
        source_dimensions: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        rendered_page_bounds: { x: pos.x, y: pos.y, width: 200, height: 30 }
      });
    }

    // Step 1: Link Evidence
    const links = mixedOffers.map(o => EvidenceLinkerService.linkEvidence(o, mixedBlocks));

    // Verify 13 structured offers & 13 links
    expect(mixedOffers.length).toBe(13);
    expect(links.length).toBe(13);

    // Verify all 13 have unique anchor blocks
    const anchorIds = links.map(l => l.current_price_anchor_block_id).filter(Boolean);
    expect(anchorIds.length).toBe(13);
    const uniqueAnchorIds = new Set(anchorIds);
    expect(uniqueAnchorIds.size).toBe(13);

    // Step 2: Validate Completeness
    const completeness = PageCompletenessValidator.validate({
      pageNumber: 1,
      pageExtraction: {
        schema_version: 1,
        page_number: 1,
        page_classification: 'offer_page',
        offers: mixedOffers,
        uncertain_regions: [],
        page_summary: {
          independent_offer_count: 13,
          independent_current_price_anchor_count: 13
        } as any
      },
      links,
      blocks: mixedBlocks
    });

    expect(completeness.status).toBe('pass');
    expect(completeness.uncovered_current_price_anchor_block_ids.length).toBe(0);
    expect(completeness.duplicate_anchor_assignments.length).toBe(0);

    // Step 3: Generate Automatic Crops
    const crops = AutomaticOfferCropService.constructCrops({
      pageNumber: 1,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      pdfBaseName: 'mixed-13-page',
      offers: mixedOffers,
      evidenceLinks: links,
      ocrBlocks: mixedBlocks
    });

    // Verify 13 generated crops
    expect(crops.length).toBe(13);

    // Verify 0 multi-anchor crops: Each crop must only enclose its own price anchor!
    for (const crop of crops) {
      const ownAnchor = mixedBlocks.find(b => b.block_id === crop.current_price_anchor_block_id)!;
      expect(crop.bounds.x).toBeLessThanOrEqual(ownAnchor.bounds.x);
      expect(crop.bounds.x + crop.bounds.width).toBeGreaterThanOrEqual(ownAnchor.bounds.x + ownAnchor.bounds.width);

      // Other anchors must NOT be inside this crop
      for (const otherAnchor of mixedBlocks.filter(b => b.block_id.startsWith('blk_mixed_p_') && b.block_id !== crop.current_price_anchor_block_id)) {
        const otherCenter = {
          x: otherAnchor.bounds.x + otherAnchor.bounds.width / 2,
          y: otherAnchor.bounds.y + otherAnchor.bounds.height / 2
        };
        const inside =
          otherCenter.x >= crop.bounds.x &&
          otherCenter.x <= crop.bounds.x + crop.bounds.width &&
          otherCenter.y >= crop.bounds.y &&
          otherCenter.y <= crop.bounds.y + crop.bounds.height;
        expect(inside).toBe(false);
      }
    }
  });

  // 4. Bundle offer with one shared price
  it('Fixture 4: Bundle offer with one shared price produces 1 offer and 1 anchor', () => {
    const bundleOffer: PageFirstExtractedOffer = {
      temporary_offer_id: 'bundle_01',
      region_hint: 'middle',
      product: {
        title_ar: 'حزمة توفير: زيت + أرز + سكر',
        title_en: 'Saver Bundle: Oil + Rice + Sugar',
        brand_text: null,
        description_ar: null,
        description_en: null,
        item_domain: 'grocery',
        variant_names: ['زيت 1.5 لتر', 'أرز 5 كجم', 'سكر 2 كجم']
      },
      price_candidates: [],
      selected_prices: {
        offer_price: 49.95,
        original_price: 75.0,
        currency: 'SAR',
        offer_price_raw_text: '49.95',
        original_price_raw_text: '75.00',
        confidence: 'high'
      },
      content: {
        size_text: 'حزمة 3 قطع',
        each_size_value: null,
        each_size_unit: null,
        pack_quantity: 3,
        bundle_quantity: 3,
        total_content_value: null,
        total_content_unit: null
      },
      price_basis: { basis: 'bundle', raw_text: 'للحزمة' },
      promotion: { mechanic: 'bundle', raw_text: 'عرض خاص', condition_text: null },
      evidence: {
        title_texts: ['حزمة توفير: زيت + أرز + سكر'],
        description_texts: [],
        current_price_texts: ['49.95'],
        original_price_texts: ['75.00'],
        size_content_texts: ['حزمة 3 قطع'],
        promotion_texts: ['عرض خاص'],
        final_evidence_summary: 'حزمة توفير 49.95'
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

    const blocks: NormalizedOcrBlock[] = [
      {
        block_id: 'b_bundle_p',
        page_number: 1,
        block_type: 'text',
        text: '49.95',
        normalized_text: '49.95',
        confidence: 0.98,
        bounds: { x: 300, y: 400, width: 80, height: 40 },
        source_dimensions: { width: 800, height: 1000 },
        rendered_page_bounds: { x: 300, y: 400, width: 80, height: 40 }
      }
    ];

    const link = EvidenceLinkerService.linkEvidence(bundleOffer, blocks);
    expect(link.current_price_anchor_block_id).toBe('b_bundle_p');
    expect(bundleOffer.product.variant_names.length).toBe(3);
  });

  // 5. Blank page fixture
  it('Fixture 5: Blank page returns 0 offers and passes completeness check without retrying', () => {
    const completeness = PageCompletenessValidator.validate({
      pageNumber: 1,
      pageExtraction: {
        schema_version: 1,
        page_number: 1,
        page_classification: 'blank',
        offers: [],
        uncertain_regions: [],
        page_summary: {
          independent_offer_count: 0,
          independent_current_price_anchor_count: 0
        } as any
      },
      links: [],
      blocks: []
    });

    expect(completeness.status).toBe('pass');
    expect(completeness.structured_offer_count).toBe(0);
    expect(completeness.uncovered_current_price_anchor_block_ids.length).toBe(0);
  });

  // 6. Advertisement-only page fixture
  it('Fixture 6: Advertisement-only page returns 0 offers and passes cleanly', () => {
    const completeness = PageCompletenessValidator.validate({
      pageNumber: 1,
      pageExtraction: {
        schema_version: 1,
        page_number: 1,
        page_classification: 'advertisement',
        offers: [],
        uncertain_regions: [],
        page_summary: {
          independent_offer_count: 0,
          independent_current_price_anchor_count: 0
        } as any
      },
      links: [],
      blocks: [
        {
          block_id: 'b_ad_text',
          page_number: 1,
          block_type: 'text',
          text: 'حمل تطبيقنا الآن واستمتع بالعروض',
          normalized_text: 'حمل تطبيقنا الآن واستمتع بالعروض',
          confidence: 0.95,
          bounds: { x: 100, y: 100, width: 600, height: 200 },
          source_dimensions: { width: 800, height: 1200 },
          rendered_page_bounds: { x: 100, y: 100, width: 600, height: 200 }
        }
      ]
    });

    expect(completeness.status).toBe('pass');
    expect(completeness.uncovered_current_price_anchor_block_ids.length).toBe(0);
  });
});
