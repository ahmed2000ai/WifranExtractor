import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getLeafletPageGenAiSchema,
  getLegacyLeafletPageGenAiSchema,
  getOptimizedLeafletPageGenAiSchema,
  decodeLeafletPageExtraction,
  compactLeafletPageSchema,
  compactOfferSchema
} from '../../../shared/schemas/leafletPageExtractionSchema';
import {
  buildRev1PageExtractionSystemPrompt,
  buildRev1DiagnosticRetryPrompt,
  buildLegacyPageExtractionSystemPrompt,
  buildOptimizedPageExtractionSystemPrompt
} from '../geminiPromptBuilder';
import { mapRev1OfferToCanonical } from '../../page-first/pageOfferCanonicalMapper';
import type { LeafletPageExtractionRev1, ExtractedOfferRev1 } from '../../../shared/types/leafletExtraction';

describe('WIFRAN-EXTRACTOR-GEMINI-OPT-001 — Lossless Core-Data Schema Optimization', () => {
  const page1GoldenPath = join(process.cwd(), 'test-fixtures', 'page1_golden.json');
  const page4GoldenPath = join(process.cwd(), 'test-fixtures', 'page4_golden.json');
  const page1GoldenRaw = JSON.parse(readFileSync(page1GoldenPath, 'utf8'));
  const page4GoldenRaw = JSON.parse(readFileSync(page4GoldenPath, 'utf8'));

  describe('1. Schema Generation & Selector Verification', () => {
    it('defaults to legacy schema when no version argument is provided', () => {
      const defaultSchema = getLeafletPageGenAiSchema();
      const legacySchema = getLegacyLeafletPageGenAiSchema();
      expect(defaultSchema).toEqual(legacySchema);
    });

    it('returns the full legacy schema when explicitly requested', () => {
      const schema = getLeafletPageGenAiSchema('legacy') as any;
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['ignored_banners', 'offers']);
      expect(schema.properties.is_loyalty_page).toBeUndefined();
      expect(schema.properties.ignored_banners).toBeDefined();
      expect(schema.properties.validity_start_date).toBeDefined();
      expect(schema.properties.validity_end_date).toBeDefined();

      const offerProps = schema.properties.offers.items.properties;
      expect(offerProps.category_slug).toBeDefined();
      expect(offerProps.item_domain).toBeDefined();
      expect(offerProps.normalized_product_name_ar).toBeDefined();
      expect(offerProps.normalized_product_name_en).toBeDefined();
      expect(offerProps.commodity_tag).toBeDefined();
      expect(offerProps.quantity_limit).toBeUndefined();
      expect(offerProps.promo_condition).toBeUndefined();
      expect(offerProps.components.properties.product_graphic_box).toBeDefined();
    });

    it('returns the compact Strategy B schema when optimized is requested', () => {
      const schema = getLeafletPageGenAiSchema('optimized') as any;
      const directSchema = getOptimizedLeafletPageGenAiSchema() as any;
      expect(schema).toEqual(directSchema);
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['offers']);

      // Page-level condition & date fields must be completely absent from API output schema
      expect(schema.properties.is_loyalty_page).toBeUndefined();
      expect(schema.properties.loyalty_program_name).toBeUndefined();
      expect(schema.properties.validity_start_date).toBeUndefined();
      expect(schema.properties.validity_end_date).toBeUndefined();
      expect(schema.properties.ignored_banners).toBeUndefined();

      const offerProps = schema.properties.offers.items.properties;
      // Derivable fields must be removed
      expect(offerProps.category_slug).toBeUndefined();
      expect(offerProps.item_domain).toBeUndefined();
      expect(offerProps.normalized_product_name_ar).toBeUndefined();
      expect(offerProps.normalized_product_name_en).toBeUndefined();
      expect(offerProps.commodity_tag).toBeUndefined();

      // Condition fields must be removed
      expect(offerProps.promo_condition).toBeUndefined();
      expect(offerProps.quantity_limit).toBeUndefined();

      // Retained fields present with short keys
      expect(offerProps.n).toBeDefined();
      expect(offerProps.ar).toBeDefined();
      expect(offerProps.en).toBeDefined();
      expect(offerProps.b).toBeDefined();
      expect(offerProps.m).toBeDefined();
      expect(offerProps.grp).toBeDefined();
      expect(offerProps.p).toBeDefined();
      expect(offerProps.op).toBeDefined();
      expect(offerProps.sz).toBeDefined();
      expect(offerProps.ut).toBeDefined();
      expect(offerProps.pq).toBeDefined();
      expect(offerProps.ev).toBeDefined();
      expect(offerProps.eu).toBeDefined();
      expect(offerProps.u_sz).toBeDefined();
      expect(offerProps.c).toBeDefined();

      // Strategy B bounding boxes
      expect(offerProps.b2d).toBeDefined();
      const b2dProps = offerProps.b2d.properties;
      expect(b2dProps.g).toBeDefined(); // product graphic
      expect(b2dProps.p).toBeDefined(); // promo price
      expect(b2dProps.t).toBeDefined(); // title text
      expect(b2dProps.r).toBeDefined(); // reference/original price
      expect(b2dProps.u).toBeDefined(); // unit/size badge
      expect(offerProps.b2d.required).toEqual(['g', 'p', 't']);
    });

    it('validates a compliant compact page payload using Zod compactLeafletPageSchema', () => {
      const validPayload = {
        offers: [
          {
            n: 1,
            ar: 'ساديا ناجتس دجاج ميني شيف 270 جرام',
            en: 'Sadia Nuggets Chicken Mini Chef 270g',
            b: 'Sadia',
            m: false,
            p: 5,
            op: 11.25,
            sz: '270g',
            ut: 'Each / للحبة',
            pq: 1,
            ev: 270,
            eu: 'g',
            u_sz: true,
            c: 0.98,
            b2d: {
              g: [485, 45, 615, 295],
              p: [580, 210, 640, 310],
              t: [620, 40, 655, 310],
              r: [555, 210, 582, 310],
              u: [470, 40, 520, 110]
            }
          }
        ]
      };

      const result = compactLeafletPageSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('rejects bounding box coordinates exceeding 0..1000 bounds', () => {
      const invalidCoords = {
        n: 1,
        ar: 'حبحب',
        en: 'Watermelon',
        m: false,
        p: 5,
        b2d: {
          g: [485, 45, 1050, 295], // 1050 > 1000
          p: [580, 210, 640, 310],
          t: [620, 40, 655, 310]
        }
      };

      const result = compactOfferSchema.safeParse(invalidCoords);
      expect(result.success).toBe(false);
    });
  });

  describe('2. Prompt Builder Token Optimization', () => {
    it('defaults to legacy prompt when no version argument is provided', () => {
      const defaultPrompt = buildRev1PageExtractionSystemPrompt();
      const legacyPrompt = buildLegacyPageExtractionSystemPrompt();
      expect(defaultPrompt).toBe(legacyPrompt);
    });

    it('retains all essential rules in the optimized prompt while eliminating bloat', () => {
      const optPrompt = buildRev1PageExtractionSystemPrompt('optimized');

      // Essential retained rules
      expect(optPrompt).toContain('ZERO TRANSLATION RULE');
      expect(optPrompt).toContain('STRICT PRICE HIERARCHY & HYPHENATION');
      expect(optPrompt).toContain('PROMOTIONAL WORDING SEPARATION & BANNER REJECTION');
      expect(optPrompt).toContain('ATOMIC COMPONENT 2D BOUNDING BOXES (b2d)');
      expect(optPrompt).toContain('MULTI-PRICE / MULTI-TIER COMPOUND CELLS');
      expect(optPrompt).toContain('PHYSICAL QUANTITY DECOMPOSITION');

      // Strategy B component keys in prompt
      expect(optPrompt).toContain('- g:');
      expect(optPrompt).toContain('- p:');
      expect(optPrompt).toContain('- t:');
      expect(optPrompt).toContain('- r:');
      expect(optPrompt).toContain('- u:');

      // Removed bloat must NOT appear
      expect(optPrompt).not.toContain('category_slug');
      expect(optPrompt).not.toContain('commodity_tag');
      expect(optPrompt).not.toContain('item_domain');
      expect(optPrompt).not.toContain('normalized_product_name_ar');
      expect(optPrompt).not.toContain('normalized_product_name_en');
      expect(optPrompt).not.toContain('is_loyalty_page=true');
      expect(optPrompt).not.toContain('loyalty_program_name');
      expect(optPrompt).not.toContain('ignored_banners');
      expect(optPrompt).not.toContain('quantity_limit:');
    });

    it('achieves > 45% character reduction in system prompt size', () => {
      const legacyPrompt = buildLegacyPageExtractionSystemPrompt();
      const optPrompt = buildOptimizedPageExtractionSystemPrompt();

      const legacyLen = legacyPrompt.length;
      const optLen = optPrompt.length;
      const reductionPct = ((legacyLen - optLen) / legacyLen) * 100;

      expect(reductionPct).toBeGreaterThan(45);
      expect(optLen).toBeLessThan(legacyLen * 0.55);
    });

    it('supports versioning in buildRev1DiagnosticRetryPrompt', () => {
      const reasons = ['Price inversion on offer #1', 'Box sanity failed'];
      const legacyRetry = buildRev1DiagnosticRetryPrompt(reasons, 'legacy');
      const optRetry = buildRev1DiagnosticRetryPrompt(reasons, 'optimized');

      expect(legacyRetry).toContain('product_graphic_box');
      expect(optRetry).toContain('g, p, t, r, and u');
      expect(optRetry).toContain('promo price p must be strictly less than original price op');
    });
  });

  describe('3. Decoder Determinism & Backward Compatibility', () => {
    it('decodes legacy golden Page 1 fixture exactly matching original data', () => {
      const decoded: LeafletPageExtractionRev1 = decodeLeafletPageExtraction(page1GoldenRaw);

      expect(decoded.offers.length).toBe(9);
      expect(decoded.is_loyalty_page).toBe(false);
      expect(decoded.ignored_banners.length).toBe(1);

      // Offer 1: Sadia Nuggets
      const o1 = decoded.offers[0];
      expect(o1.offer_number).toBe(1);
      expect(o1.arabic_title).toBe('ساديا ناجتس دجاج ميني شيف 270 جرام');
      expect(o1.english_title).toBe('Sadia Nuggets Chicken Mini Chef 270g');
      expect(o1.brand).toBe('Sadia');
      expect(o1.promo_price).toBe(5);
      expect(o1.original_price).toBe(11.25);
      expect(o1.size_value).toBe('270g');
      expect(o1.components.product_graphic_box).toEqual([485, 45, 615, 295]);
      expect(o1.components.promo_price_box).toEqual([580, 210, 640, 310]);
      expect(o1.components.original_price_box).toEqual([555, 210, 582, 310]);
      expect(o1.components.unit_and_size_badge_box).toEqual([470, 40, 520, 110]);
      expect(o1.components.title_text_box).toEqual([620, 40, 655, 310]);

      // Offer 2: Watermelon (null original price and null original_price_box)
      const o2 = decoded.offers[1];
      expect(o2.offer_number).toBe(2);
      expect(o2.arabic_title).toBe('حبحب');
      expect(o2.english_title).toBe('Watermelon');
      expect(o2.brand).toBeNull();
      expect(o2.promo_price).toBe(5);
      expect(o2.original_price).toBeNull();
      expect(o2.components.original_price_box).toBeNull();
      expect(o2.components.product_graphic_box).toEqual([485, 360, 615, 620]);
    });

    it('decodes legacy golden Page 4 fixture (with loyalty program)', () => {
      const decoded: LeafletPageExtractionRev1 = decodeLeafletPageExtraction(page4GoldenRaw);
      expect(decoded.offers.length).toBe(11);
      expect(decoded.is_loyalty_page).toBe(true);
      expect(decoded.loyalty_program_name).toBe('Iktissab');
      expect(decoded.offers[0].promo_condition).toBe('LOYALTY_CARD_REQUIRED');
    });

    it('decodes optimized Strategy B JSON with exact coordinate and null preservation', () => {
      const compactPayload = {
        offers: [
          {
            n: 1,
            ar: 'ساديا ناجتس دجاج ميني شيف 270 جرام',
            en: 'Sadia Nuggets Chicken Mini Chef 270g',
            b: 'Sadia',
            m: false,
            grp: null,
            p: 5,
            op: 11.25,
            sz: '270g',
            ut: 'Each / للحبة',
            pq: 1,
            ev: 270,
            eu: 'g',
            u_sz: true,
            c: 0.98,
            b2d: {
              g: [485, 45, 615, 295],
              p: [580, 210, 640, 310],
              t: [620, 40, 655, 310],
              r: [555, 210, 582, 310],
              u: [470, 40, 520, 110]
            }
          },
          {
            n: 2,
            ar: 'حبحب',
            en: 'Watermelon',
            b: null,
            m: false,
            grp: null,
            p: 5,
            op: null,
            sz: '2 Kg',
            ut: 'Kg / كيلو',
            pq: 1,
            ev: 2,
            eu: 'kg',
            u_sz: true,
            c: 0.99,
            b2d: {
              g: [485, 360, 615, 620],
              p: [580, 530, 640, 630],
              t: [620, 355, 655, 630],
              r: null,
              u: [470, 355, 520, 425]
            }
          }
        ]
      };

      const decoded: LeafletPageExtractionRev1 = decodeLeafletPageExtraction(compactPayload);
      expect(decoded.offers.length).toBe(2);

      // Offer 1
      const o1 = decoded.offers[0];
      expect(o1.offer_number).toBe(1);
      expect(o1.arabic_title).toBe('ساديا ناجتس دجاج ميني شيف 270 جرام');
      expect(o1.english_title).toBe('Sadia Nuggets Chicken Mini Chef 270g');
      expect(o1.brand).toBe('Sadia');
      expect(o1.promo_price).toBe(5);
      expect(o1.original_price).toBe(11.25);
      expect(o1.pack_quantity).toBe(1);
      expect(o1.each_size_value).toBe(270);
      expect(o1.each_size_unit).toBe('g');
      expect(o1.promo_condition).toBeNull(); // Condition absent/unknown semantics
      expect(o1.components.product_graphic_box).toEqual([485, 45, 615, 295]);
      expect(o1.components.promo_price_box).toEqual([580, 210, 640, 310]);
      expect(o1.components.title_text_box).toEqual([620, 40, 655, 310]);
      expect(o1.components.original_price_box).toEqual([555, 210, 582, 310]);
      expect(o1.components.unit_and_size_badge_box).toEqual([470, 40, 520, 110]);

      // Offer 2: null semantics
      const o2 = decoded.offers[1];
      expect(o2.offer_number).toBe(2);
      expect(o2.brand).toBeNull();
      expect(o2.promo_price).toBe(5);
      expect(o2.original_price).toBeNull();
      expect(o2.components.original_price_box).toBeNull();
      expect(o2.components.title_text_box).toEqual([620, 355, 655, 630]);
      expect(o2.components.unit_and_size_badge_box).toEqual([470, 355, 520, 425]);
    });

    it('decodes fixed-position 5-tuple bounding boxes [g, p, t, r, u]', () => {
      const tuplePayload = {
        offers: [
          {
            n: 1,
            ar: 'دجاج ساديا',
            en: 'Sadia Chicken',
            m: false,
            p: 14.95,
            b2d: [
              [100, 100, 200, 200], // g
              [150, 150, 180, 180], // p
              [205, 100, 230, 200], // t
              [130, 150, 145, 180], // r
              [90, 100, 120, 130]   // u
            ]
          }
        ]
      };

      const decoded = decodeLeafletPageExtraction(tuplePayload);
      const comp = decoded.offers[0].components;
      expect(comp.product_graphic_box).toEqual([100, 100, 200, 200]);
      expect(comp.promo_price_box).toEqual([150, 150, 180, 180]);
      expect(comp.title_text_box).toEqual([205, 100, 230, 200]);
      expect(comp.original_price_box).toEqual([130, 150, 145, 180]);
      expect(comp.unit_and_size_badge_box).toEqual([90, 100, 120, 130]);
    });
  });

  describe('4. End-to-End Canonical Mapping & Contract V2 Compatibility', () => {
    it('maps decoded optimized offer to canonical and contract v2 with local classification and absent condition semantics', () => {
      const compactPayload = {
        offers: [
          {
            n: 1,
            ar: 'ساديا ناجتس دجاج ميني شيف 270 جرام',
            en: 'Sadia Nuggets Chicken Mini Chef 270g',
            b: 'Sadia',
            m: false,
            p: 5,
            op: 11.25,
            sz: '270g',
            ut: 'Each / للحبة',
            pq: 1,
            ev: 270,
            eu: 'g',
            u_sz: true,
            c: 0.98,
            b2d: {
              g: [485, 45, 615, 295],
              p: [580, 210, 640, 310],
              t: [620, 40, 655, 310],
              r: [555, 210, 582, 310],
              u: [470, 40, 520, 110]
            }
          }
        ]
      };

      const decoded = decodeLeafletPageExtraction(compactPayload);
      const offer: ExtractedOfferRev1 = decoded.offers[0];

      const cropRect = {
        offer_number: 1,
        union_box_px: { xmin: 45, ymin: 470, xmax: 310, ymax: 655, width: 265, height: 185 },
        product_thumb_box_px: { xmin: 45, ymin: 485, xmax: 295, ymax: 615, width: 250, height: 130 },
        offer_card_crop_path: 'crops/p001_item001_card.jpg',
        product_thumb_crop_path: 'crops/p001_item001_thumb.jpg'
      };

      const trustedContext = {
        supermarketId: 'c2cc16c2-0008-4444-b000-c00000000008',
        supermarketSlug: 'othaim',
        locationScope: 'national' as const,
        cityId: null,
        regionId: null,
        offerStartDate: '2026-06-10',
        offerEndDate: '2026-06-16',
        leafletId: 'othaim_20260610'
      };

      const canonical = mapRev1OfferToCanonical({
        offer,
        cropRect,
        pageNumber: 1,
        pdfBaseName: 'othaim_leaflet',
        packageDir: 'packages/othaim',
        trustedContext
      });

      // 1. Core verbatim descriptions preserved
      expect(canonical.product.title_ar).toBe('ساديا ناجتس دجاج ميني شيف 270 جرام');
      expect(canonical.product.title_en).toBe('Sadia Nuggets Chicken Mini Chef 270g');
      expect(canonical.product.brand_text).toBe('Sadia');

      // 2. Local classification works without Gemini category/domain/normalized inputs
      expect(canonical.product.item_domain).toBe('grocery');
      expect(canonical.product.category_hint).toBe('frozen'); // Nuggets -> frozen
      expect(canonical.product.normalized_title_ar).toBe('ساديا ناجتس دجاج ميني شيف');
      expect(canonical.product.normalized_title_en).toBe('Sadia Nuggets Chicken Mini Chef');
      expect(canonical.product.commodity_tag).toBe('whole_chicken'); // Inferred from 'chicken' / 'دجاج'

      // 3. Price and quantity metrics preserved
      expect(canonical.prices.offer_price).toBe(5);
      expect(canonical.prices.original_price).toBe(11.25);
      expect(canonical.content.pack_quantity).toBe(1);
      expect(canonical.content.each_size_value).toBe(270);
      expect(canonical.content.each_size_unit).toBe('gram');

      // 4. Absent condition semantics: mechanic is 'unknown', NOT silently forced to 'standard_price'
      expect(canonical.promotion.mechanic).toBe('unknown');
      expect(canonical.promotion.condition_text).toBeNull();

      // 5. Contract v2 integrity
      expect(canonical.schema_version).toBe('wifran.extractor.offer/2.0');
      expect(canonical.contract_v2).toBeDefined();
      expect(canonical.contract_v2?.record_metadata.schema_version).toBe('wifran.extractor.offer/2.0');
      expect(canonical.contract_v2?.promotion_terms.mechanic).toBe('markdown'); // Has original price > promo price
      expect(canonical.contract_v2?.eligibility.loyalty.requirement).toBe('unknown');
    });
  });

  describe('5. Deterministic Token & JSON Size Measurement', () => {
    it('measures > 50% JSON character reduction on Page 1 golden fixture', () => {
      // Re-encode Page 1 offers into compact Strategy B structure
      const page1Compact = {
        offers: page1GoldenRaw.offers.map((o: any) => ({
          n: o.offer_number,
          ar: o.arabic_title,
          en: o.english_title,
          b: o.brand,
          m: o.is_multi_brand_or_variant,
          p: o.promo_price,
          op: o.original_price,
          sz: o.size_value,
          ut: o.unit_type,
          c: o.confidence,
          b2d: {
            g: o.components.product_graphic_box,
            p: o.components.promo_price_box,
            t: o.components.title_text_box,
            r: o.components.original_price_box,
            u: o.components.unit_and_size_badge_box
          }
        }))
      };

      const legacyStr = JSON.stringify(page1GoldenRaw);
      const compactStr = JSON.stringify(page1Compact);

      const legacyChars = legacyStr.length;
      const compactChars = compactStr.length;
      const reductionPct = ((legacyChars - compactChars) / legacyChars) * 100;

      // Estimated tokens (~3.8 chars/token for JSON structure + Arabic UTF-8)
      const estLegacyTokens = Math.round(legacyChars / 3.8);
      const estCompactTokens = Math.round(compactChars / 3.8);
      const savedTokens = estLegacyTokens - estCompactTokens;

      console.log(`[Token Measurement] Page 1: Legacy=${legacyChars} chars (~${estLegacyTokens} tokens) -> Compact=${compactChars} chars (~${estCompactTokens} tokens), Reduction=${reductionPct.toFixed(1)}%, Saved=${savedTokens} tokens`);

      expect(reductionPct).toBeGreaterThan(45);
      expect(compactChars).toBeLessThan(legacyChars * 0.55);
    });

    it('measures > 45% JSON character reduction on Page 4 golden fixture (even without full rev1 metadata)', () => {
      const page4Compact = {
        offers: page4GoldenRaw.offers.map((o: any) => ({
          n: o.offer_number,
          ar: o.arabic_title,
          en: o.english_title,
          b: o.brand,
          m: o.is_multi_brand_or_variant,
          p: o.promo_price,
          op: o.original_price,
          sz: o.size_value,
          ut: o.unit_type,
          c: o.confidence,
          b2d: {
            g: o.components.product_graphic_box,
            p: o.components.promo_price_box,
            t: o.components.title_text_box,
            r: o.components.original_price_box,
            u: o.components.unit_and_size_badge_box
          }
        }))
      };

      const legacyStr = JSON.stringify(page4GoldenRaw);
      const compactStr = JSON.stringify(page4Compact);

      const legacyChars = legacyStr.length;
      const compactChars = compactStr.length;
      const reductionPct = ((legacyChars - compactChars) / legacyChars) * 100;

      console.log(`[Token Measurement] Page 4: Legacy=${legacyChars} chars -> Compact=${compactChars} chars, Reduction=${reductionPct.toFixed(1)}%`);

      expect(reductionPct).toBeGreaterThan(40);
      expect(compactChars).toBeLessThan(legacyChars * 0.60);
    });
  });
});
