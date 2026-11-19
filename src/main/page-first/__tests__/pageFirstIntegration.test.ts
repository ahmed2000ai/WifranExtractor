import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PageOfferCanonicalMapper } from '../pageOfferCanonicalMapper';
import type { PageFirstExtractedOffer } from '../../../shared/types/pageFirstOfferExtraction';
import type { PageOfferEvidenceLink } from '../../../shared/types/pageOfferEvidenceLink';
import type { AutomaticOfferCrop } from '../../../shared/types/automaticOfferCrop';

describe('Page-First End-to-End Local Chain & Integration Tests (Sections 53 & 55)', () => {
  // Pinned reference dates & Date-only fake clock ensure timezone- and future-date determinism
  const activeOfferStartDate = '2026-10-10';
  const activeOfferEndDate = '2026-10-17';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Complete Local Chain: mock OCR -> annotation -> evidence link -> crops -> CanonicalOffer -> deterministic safety', () => {
    // 1. Mock Raw OCR & Annotation
    const mockOffer: PageFirstExtractedOffer = {
      temporary_offer_id: 'page1_off_01',
      region_hint: 'top_left',
      product: {
        title_ar: 'تونة قودي خفيفة 185 جرام',
        title_en: 'Goody Light Tuna 185g',
        brand_text: 'Goody',
        description_ar: null,
        description_en: null,
        item_domain: 'grocery',
        variant_names: []
      },
      price_candidates: [
        {
          raw_text: '7.95',
          normalized_value: 7.95,
          currency: 'SAR',
          role: 'current_offer_price',
          is_crossed_out: false,
          confidence: 'high',
          evidence_text: '7.95'
        },
        {
          raw_text: '11.50',
          normalized_value: 11.5,
          currency: 'SAR',
          role: 'original_old_price',
          is_crossed_out: true,
          confidence: 'high',
          evidence_text: '11.50'
        }
      ],
      selected_prices: {
        offer_price: 7.95,
        original_price: 11.5,
        currency: 'SAR',
        offer_price_raw_text: '7.95',
        original_price_raw_text: '11.50',
        confidence: 'high'
      },
      content: {
        size_text: '185g',
        each_size_value: 185,
        each_size_unit: 'gram',
        pack_quantity: 1,
        bundle_quantity: null,
        total_content_value: 185,
        total_content_unit: 'gram'
      },
      price_basis: { basis: 'each', raw_text: 'للحبة' },
      promotion: { mechanic: 'standard_price', raw_text: null, condition_text: null },
      evidence: {
        title_texts: ['تونة قودي خفيفة 185 جرام'],
        description_texts: [],
        current_price_texts: ['7.95'],
        original_price_texts: ['11.50'],
        size_content_texts: ['185g'],
        promotion_texts: [],
        final_evidence_summary: 'تونة قودي 7.95 بدلا من 11.50'
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

    const mockLink: PageOfferEvidenceLink = {
      temporary_offer_id: 'page1_off_01',
      linked_block_ids: ['b_title', 'b_price', 'b_oldprice'],
      title_block_ids: ['b_title'],
      description_block_ids: [],
      current_price_block_ids: ['b_price'],
      original_price_block_ids: ['b_oldprice'],
      size_content_block_ids: [],
      promotion_block_ids: [],
      current_price_anchor_block_id: 'b_price',
      confidence: 0.95,
      unmatched_evidence: [],
      warnings: []
    };

    const mockCrop: AutomaticOfferCrop = {
      page_number: 1,
      source_offer_key: 'test_p1_x100_y100_7.95',
      source_item_number: '001',
      bounds: { x: 50, y: 50, width: 300, height: 350 },
      included_block_ids: ['b_title', 'b_price'],
      included_image_region_ids: [],
      current_price_anchor_block_id: 'b_price',
      crop_confidence: 0.95,
      strategy: 'evidence_union',
      warnings: []
    };

    // 2. Map to CanonicalOffer
    const canonical = PageOfferCanonicalMapper.mapToCanonical({
      pageNumber: 1,
      itemNumber: '001',
      offer: mockOffer,
      link: mockLink,
      crop: mockCrop,
      trustedContext: {
        leafletId: 'test_leaflet_001',
        supermarketId: 'danube_01',
        supermarketSlug: 'danube',
        locationScope: 'national',
        cityId: null,
        regionId: null,
        offerStartDate: activeOfferStartDate,
        offerEndDate: activeOfferEndDate
      },
      rawMetadata: {
        isRetry: false,
        completenessStatus: 'pass'
      }
    });

    // 3. Verify Deterministic Safety Pipeline outputs
    expect(canonical.source.source_item_number).toBe('001');
    expect(canonical.prices.offer_price).toBe(7.95);
    expect(canonical.prices.original_price).toBe(11.5);
    expect(canonical.quality.publish_decision).toBe('publish');
    expect(canonical.comparison.comparison_eligible).toBe(true);
    expect(canonical.comparison.comparison_unit).toBe('kilogram');
    // Unit price for 185g @ 7.95 SAR -> (7.95 / 0.185) = ~42.97 SAR/kg
    expect(canonical.comparison.comparison_unit_price).toBeCloseTo(42.97, 1);
    expect(canonical.display?.show_display_unit_price).toBe(true);
    expect(canonical.quality.blocking_errors.length).toBe(0);
  });

  it('Unresolved Item quarantined: offer lacking anchor link is marked skip_or_quarantine', () => {
    const mockOfferWithoutAnchor: PageFirstExtractedOffer = {
      temporary_offer_id: 'unresolved_01',
      region_hint: 'middle',
      product: { title_ar: 'منتج غامض' } as any,
      price_candidates: [],
      selected_prices: { offer_price: 10 } as any,
      content: {} as any,
      price_basis: { basis: 'each', raw_text: null },
      promotion: { mechanic: 'standard_price', raw_text: null, condition_text: null },
      evidence: { title_texts: ['منتج غامض'], current_price_texts: [] } as any,
      confidence: { overall: 'low' } as any,
      warnings: []
    };

    const mockLinkNoAnchor: PageOfferEvidenceLink = {
      temporary_offer_id: 'unresolved_01',
      linked_block_ids: [],
      title_block_ids: [],
      description_block_ids: [],
      current_price_block_ids: [],
      original_price_block_ids: [],
      size_content_block_ids: [],
      promotion_block_ids: [],
      current_price_anchor_block_id: null, // Critical: no anchor block
      confidence: 0.2,
      unmatched_evidence: [],
      warnings: ['No price anchor block found']
    };

    const mockCrop: AutomaticOfferCrop = {
      page_number: 1,
      source_offer_key: 'unresolved_01',
      source_item_number: '002',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      included_block_ids: [],
      included_image_region_ids: [],
      current_price_anchor_block_id: '',
      crop_confidence: 0.3,
      strategy: 'exception_fallback',
      warnings: []
    };

    const canonical = PageOfferCanonicalMapper.mapToCanonical({
      pageNumber: 1,
      itemNumber: '002',
      offer: mockOfferWithoutAnchor,
      link: mockLinkNoAnchor,
      crop: mockCrop,
      trustedContext: {
        leafletId: 'test_leaflet_001',
        supermarketId: 'danube_01',
        supermarketSlug: 'danube',
        locationScope: 'national',
        cityId: null,
        regionId: null,
        offerStartDate: activeOfferStartDate,
        offerEndDate: activeOfferEndDate
      },
      rawMetadata: {
        isRetry: false,
        completenessStatus: 'unresolved'
      }
    });

    // Zero unsafe published price error guarantee:
    expect(canonical.quality.publish_decision).toBe('skip_or_quarantine');
    expect(canonical.quality.blocking_errors.some(e => e.code === 'MISSING_PRICE_ANCHOR_LINK')).toBe(true);
  });
});
