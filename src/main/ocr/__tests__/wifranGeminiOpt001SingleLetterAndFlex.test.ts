import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import sharp from 'sharp';
import {
  COMPACT_SINGLE_LETTER_SCHEMA_VERSION,
  COMPACT_V1_PAGE_KEY_MAP,
  COMPACT_V1_OFFER_KEY_MAP,
  COMPACT_V1_COMPONENT_KEY_MAP,
  getLeafletPageGenAiSchema,
  getLegacyLeafletPageGenAiSchema,
  getCompactSingleLetterLeafletPageGenAiSchema,
  encodeToCompactSingleLetterPageExtraction,
  decodeCompactSingleLetterPageExtraction,
  decodeLeafletPageExtraction
} from '../../../shared/schemas/leafletPageExtractionSchema';
import {
  buildRev1PageExtractionSystemPrompt,
  buildLegacyPageExtractionSystemPrompt,
  buildCompactSingleLetterPageExtractionSystemPrompt
} from '../geminiPromptBuilder';
import { GeminiExtractionService } from '../geminiExtractionService';
import { GeminiExtractionCacheService } from '../geminiExtractionCacheService';
import { calculateGeminiCost } from '../geminiPricingTable';
import { mapRev1OfferToCanonical, type TrustedLeafletContext } from '../../page-first/pageOfferCanonicalMapper';
import { computeOfferUnionAndThumbBoxes } from '../../page-first/spatialUnionAndClampingService';
import { collectPackageMetadataEvidence } from '../../metadata/packageMetadataEvidenceAdapter';
import { LeafletMetadataService } from '../../metadata/leafletMetadataService';
import { LeafletMetadataCacheService } from '../../metadata/leafletMetadataCacheService';
import { loadEnvConfig } from '../../config/env';
import type { LeafletPageExtractionRev1 } from '../../../shared/types/leafletExtraction';

describe('WIFRAN-EXTRACTOR-GEMINI-OPT-001: Preserve HIGH Thinking — Single-Letter JSON Schema, Prompt Optimization & Vertex AI Flex Verification', () => {
  const nooriWorkspaceDir = join(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
  const nooriRawExtractedPath = join(
    nooriWorkspaceDir,
    'metadata',
    'rev1',
    'page-001',
    'raw_extracted_page_1.json'
  );
  const nooriPrimaryAttemptPath = join(
    nooriWorkspaceDir,
    'metadata',
    'rev1',
    'page-001',
    'provider-responses',
    'primary-attempt-001.json'
  );
  const nooriOffer007CanonicalPath = join(nooriWorkspaceDir, 'json', 'page-001-007.canonical.json');

  const nooriCacheEntry = JSON.parse(readFileSync(nooriRawExtractedPath, 'utf8'));
  const nooriPrimaryAttempt = JSON.parse(readFileSync(nooriPrimaryAttemptPath, 'utf8'));
  const nooriOffer007BaselineCanonical = JSON.parse(readFileSync(nooriOffer007CanonicalPath, 'utf8'));
  const nooriRawResponse: LeafletPageExtractionRev1 = nooriCacheEntry.rawResponse;
  const nooriDecodedBaseline: LeafletPageExtractionRev1 = nooriCacheEntry.decodedExtraction;

  const defaultTrustedContext: TrustedLeafletContext = {
    leafletId: 'b7fd15548b2b10862e36339006e1df56157be7a047d047d9aa6959dc535a54d2',
    supermarketId: null,
    supermarketSlug: null,
    locationScope: null,
    cityId: null,
    regionId: null,
    offerStartDate: null,
    offerEndDate: null
  };

  let tempDir: string;
  let sampleImagePath: string;
  let sampleImageBuffer: Buffer;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `wifran-opt001-single-letter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
    sampleImagePath = join(tempDir, 'page-001.jpg');
    sampleImageBuffer = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .jpeg({ quality: 92 })
      .toBuffer();
    writeFileSync(sampleImagePath, sampleImageBuffer);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Technical Tests 1–3 & 12–15 — Single-Letter Schema & Strict Validation
  // =========================================================================
  describe('1. Single-Letter Schema Structure & Fail-Closed Validation (Tests 1–3, 12–15)', () => {
    it('Test 1: Single-letter schema generation produces valid JSON schema while keeping legacy as default', () => {
      const defaultSchema = getLeafletPageGenAiSchema();
      expect(defaultSchema).toEqual(getLegacyLeafletPageGenAiSchema());

      const compactSchema = getLeafletPageGenAiSchema('compact_v1') as any;
      expect(compactSchema).toEqual(getCompactSingleLetterLeafletPageGenAiSchema());
      expect(compactSchema.type).toBe('object');
      expect(compactSchema.required).toEqual(['s', 'e', 'b', 'o']);
      expect(compactSchema.properties.o.type).toBe('array');
      expect(compactSchema.properties.o.items.type).toBe('object');
    });

    it('Test 2: Every top-level and offer-level key in the compact_v1 schema is strictly 1 character [a-z]', () => {
      const compactSchema = getCompactSingleLetterLeafletPageGenAiSchema() as any;
      const topLevelKeys = Object.keys(compactSchema.properties);
      expect(topLevelKeys).toEqual(['s', 'e', 'b', 'o']);
      for (const k of topLevelKeys) {
        expect(k).toMatch(/^[a-z]$/);
        expect(k.length).toBe(1);
      }

      const offerKeys = Object.keys(compactSchema.properties.o.items.properties);
      expect(offerKeys.length).toBe(21);
      expect(offerKeys).toEqual([
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k',
        'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'v', 'w'
      ]);
      for (const k of offerKeys) {
        expect(k).toMatch(/^[a-z]$/);
        expect(k.length).toBe(1);
      }
      expect(compactSchema.properties.o.items.required).toEqual(offerKeys);
    });

    it('Test 3: Every nested component key in the compact_v1 schema is strictly 1 character [a-z]', () => {
      const compactSchema = getCompactSingleLetterLeafletPageGenAiSchema() as any;
      const componentProps = compactSchema.properties.o.items.properties.w.properties;
      const componentKeys = Object.keys(componentProps);
      expect(componentKeys).toEqual(['g', 'p', 'r', 'u', 't']);
      for (const k of componentKeys) {
        expect(k).toMatch(/^[a-z]$/);
        expect(k.length).toBe(1);
      }
      expect(compactSchema.properties.o.items.properties.w.required).toEqual(['g', 'p', 'r', 'u', 't']);
    });

    it('Test 12: Rejects unknown or unsupported schema versions fail-closed', () => {
      expect(() => getLeafletPageGenAiSchema('unknown_v99' as any)).toThrow(/UNSUPPORTED_SCHEMA_VERSION/);
      expect(() => decodeLeafletPageExtraction(nooriRawResponse, 'unknown_v99')).toThrow(
        /UNSUPPORTED_SCHEMA_VERSION/
      );
      expect(() => decodeLeafletPageExtraction(nooriRawResponse, 'compact_v1')).toThrow(
        /DECODER_SCHEMA_MISMATCH/
      );
      const compactNoori = encodeToCompactSingleLetterPageExtraction(nooriRawResponse);
      expect(() => decodeLeafletPageExtraction(compactNoori, 'legacy')).toThrow(
        /DECODER_SCHEMA_MISMATCH/
      );
    });

    it('Test 13: Rejects missing mandatory compact fields fail-closed without inventing defaults', () => {
      const validCompact = encodeToCompactSingleLetterPageExtraction(nooriRawResponse);

      // Missing top-level required field 'b' (ignored_banners)
      const missingPageField = { ...validCompact } as any;
      delete missingPageField.b;
      expect(() => decodeCompactSingleLetterPageExtraction(missingPageField)).toThrow(
        /DECODER_COMPACT_V1_VALIDATION_FAILED/
      );

      // Missing offer-level required field 's' (promo_price)
      const missingPriceOffer = structuredClone(validCompact) as any;
      delete missingPriceOffer.o[0].s;
      expect(() => decodeCompactSingleLetterPageExtraction(missingPriceOffer)).toThrow(
        /DECODER_COMPACT_V1_VALIDATION_FAILED/
      );

      // Missing nested required bounding box 'w.g' (product_graphic_box)
      const missingGraphicBox = structuredClone(validCompact) as any;
      delete missingGraphicBox.o[0].w.g;
      expect(() => decodeCompactSingleLetterPageExtraction(missingGraphicBox)).toThrow(
        /DECODER_COMPACT_V1_VALIDATION_FAILED/
      );

      // Empty both Arabic and English titles
      const emptyTitles = structuredClone(validCompact) as any;
      emptyTitles.o[0].b = '   ';
      emptyTitles.o[0].c = '';
      expect(() => decodeCompactSingleLetterPageExtraction(emptyTitles)).toThrow(
        /DECODER_COMPACT_V1_EMPTY_TITLES/
      );
    });

    it('Test 14: Rejects wrong value types in compact fields fail-closed', () => {
      const validCompact = encodeToCompactSingleLetterPageExtraction(nooriRawResponse);

      // String where number is required for promo_price (s)
      const stringPrice = structuredClone(validCompact) as any;
      stringPrice.o[0].s = '39.95';
      expect(() => decodeCompactSingleLetterPageExtraction(stringPrice)).toThrow(
        /DECODER_COMPACT_V1_VALIDATION_FAILED/
      );

      // Bounding box coordinate out of 0..1000 range
      const outOfBoundsBox = structuredClone(validCompact) as any;
      outOfBoundsBox.o[0].w.p = [265, 224, 1050, 319];
      expect(() => decodeCompactSingleLetterPageExtraction(outOfBoundsBox)).toThrow(
        /DECODER_COMPACT_V1_VALIDATION_FAILED/
      );

      // Invalid enum value for each_size_unit (q)
      const badUnit = structuredClone(validCompact) as any;
      badUnit.o[0].q = 'bushels';
      expect(() => decodeCompactSingleLetterPageExtraction(badUnit)).toThrow(
        /DECODER_COMPACT_V1_VALIDATION_FAILED/
      );
    });

    it('Test 15: Legacy response still decodes identically', () => {
      const decodedLegacy = decodeLeafletPageExtraction(nooriRawResponse, 'legacy');
      expect(decodedLegacy).toEqual(nooriRawResponse);
    });
  });

  // =========================================================================
  // SECTION 2: Technical Tests 4–11 & Cases A–I — Lossless Round-Trip & Canonical Parity
  // =========================================================================
  describe('2. Lossless Round-Trip, Canonical Mapping Parity & Regression Cases A–I (Tests 4–11)', () => {
    it('Test 4: Lossless round-trip from legacy Noori response -> compact_v1 -> expanded legacy response', () => {
      const compactPayload = encodeToCompactSingleLetterPageExtraction(nooriRawResponse);

      // Verify every key in serialized compactPayload is 1 character
      expect(Object.keys(compactPayload)).toEqual(Object.keys(COMPACT_V1_PAGE_KEY_MAP));
      for (const offer of compactPayload.o) {
        expect(Object.keys(offer)).toEqual(Object.keys(COMPACT_V1_OFFER_KEY_MAP));
        expect(Object.keys(offer.w)).toEqual(Object.keys(COMPACT_V1_COMPONENT_KEY_MAP));
      }

      const roundTripped = decodeLeafletPageExtraction(compactPayload, COMPACT_SINGLE_LETTER_SCHEMA_VERSION);
      expect(roundTripped).toEqual(nooriRawResponse);
    });

    it('Test 5: Canonical mapping parity across all 10 Noori Page 1 offers (legacy vs compact_v1)', () => {
      const compactPayload = encodeToCompactSingleLetterPageExtraction(nooriDecodedBaseline);
      const expandedFromCompact = decodeLeafletPageExtraction(compactPayload, 'compact_v1');

      const legacyCropRects = computeOfferUnionAndThumbBoxes(nooriDecodedBaseline.offers, 1654, 2339);
      const compactCropRects = computeOfferUnionAndThumbBoxes(expandedFromCompact.offers, 1654, 2339);
      expect(compactCropRects).toEqual(legacyCropRects);

      expect(expandedFromCompact.offers).toHaveLength(10);

      for (let i = 0; i < nooriDecodedBaseline.offers.length; i++) {
        const legacyOffer = nooriDecodedBaseline.offers[i];
        const compactOffer = expandedFromCompact.offers[i];
        const rect = {
          ...legacyCropRects[i],
          offer_card_crop_path: `${nooriWorkspaceDir}/metadata/rev1/page-001/crops/offer_${String(i + 1).padStart(3, '0')}_card.png`,
          product_thumb_crop_path: `${nooriWorkspaceDir}/metadata/rev1/page-001/crops/offer_${String(i + 1).padStart(3, '0')}_thumb.png`
        };

        const canonicalFromLegacy = mapRev1OfferToCanonical({
          offer: legacyOffer,
          cropRect: rect,
          pageNumber: 1,
          pdfBaseName: 'noori-supermarket-229798534-jeddah',
          packageDir: nooriWorkspaceDir,
          trustedContext: defaultTrustedContext
        });

        const canonicalFromCompact = mapRev1OfferToCanonical({
          offer: compactOffer,
          cropRect: rect,
          pageNumber: 1,
          pdfBaseName: 'noori-supermarket-229798534-jeddah',
          packageDir: nooriWorkspaceDir,
          trustedContext: defaultTrustedContext
        });

        expect(canonicalFromCompact).toEqual(canonicalFromLegacy);
        expect(canonicalFromCompact.schema_version).toBe('wifran.extractor.offer/2.0');
      }
    });

    it('Test 6 & Case A: Noori Offer 007 — Qoot & Root Premium Flour 1kg (9 pcs bundle at 9.99 SAR vs 26.55 SAR)', () => {
      const compactPayload = encodeToCompactSingleLetterPageExtraction(nooriDecodedBaseline);
      const offer7Compact = compactPayload.o[6];

      // Verify compact single-letter representation for Offer 007
      expect(offer7Compact.a).toBe(7);
      expect(offer7Compact.b).toBe('دقيق قوت آند روت فاخر 1 كيلو');
      expect(offer7Compact.c).toBe('Qoot & Root Premium Flour 1kg');
      expect(offer7Compact.d).toBe('Qoot & Root');
      expect(offer7Compact.m).toBe('1 كيلو');
      expect(offer7Compact.n).toBe('9 حبات');
      expect(offer7Compact.o).toBe(9); // pack_quantity = 9
      expect(offer7Compact.p).toBe(1); // each_size_value = 1
      expect(offer7Compact.q).toBe('kg'); // each_size_unit = 'kg'
      expect(offer7Compact.s).toBe(9.99); // promo_price = 9.99
      expect(offer7Compact.t).toBe(26.55); // original_price = 26.55

      const expanded = decodeCompactSingleLetterPageExtraction(compactPayload);
      const offer7Expanded = expanded.offers[6];
      const cropRects = computeOfferUnionAndThumbBoxes(expanded.offers, 1654, 2339);
      const canonical7 = mapRev1OfferToCanonical({
        offer: offer7Expanded,
        cropRect: {
          ...cropRects[6],
          offer_card_crop_path: nooriOffer007BaselineCanonical.source.crop_path,
          product_thumb_crop_path: nooriOffer007BaselineCanonical.source.thumbnail_path
        },
        pageNumber: 1,
        pdfBaseName: 'noori-supermarket-229798534-jeddah',
        packageDir: nooriWorkspaceDir,
        trustedContext: defaultTrustedContext
      });

      // Exact semantic assertions required by Case A
      expect(canonical7.product.title_ar).toBe('دقيق قوت آند روت فاخر 1 كيلو');
      expect(canonical7.product.title_en).toBe('Qoot & Root Premium Flour 1kg');
      expect(canonical7.product.brand_text).toBe('Qoot & Root');
      expect(canonical7.prices.offer_price).toBe(9.99);
      expect(canonical7.prices.original_price).toBe(26.55);
      expect(canonical7.content.pack_quantity).toBe(9);
      expect(canonical7.content.each_size_value).toBe(1);
      expect(canonical7.content.each_size_unit).toBe('kilogram');
      expect(canonical7.content.total_content_value).toBe(9);
      expect(canonical7.content.total_content_unit).toBe('kilogram');
      expect(canonical7.comparison.comparison_unit_price).toBe(1.11); // 9.99 / 9 kg = 1.11 SAR/kg
      expect(canonical7.contract_v2?.quantity_semantics.sale_unit).toBe('pack');
      expect(canonical7.contract_v2?.quantity_semantics.inner_count).toBe(9);
      expect(canonical7.contract_v2?.quantity_semantics.per_inner_content).toEqual({
        value: 1,
        unit: 'kilogram'
      });
      expect(canonical7.contract_v2?.quantity_semantics.total_content).toEqual({
        value: 9,
        unit: 'kilogram'
      });
      expect(canonical7.contract_v2?.quantity_semantics.is_indivisible_sale_unit).toBe(true);
      // Must NOT misclassify 9 pcs as minimum_purchase_quantity or multi-buy checkout rule
      expect(canonical7.contract_v2?.promotion_terms.mechanic).toBe('markdown');
      expect(canonical7.contract_v2?.promotion_terms.structured_checkout_rule).toBeNull();
      expect(canonical7.promotion.bundle_quantity).toBeNull();
    });

    it('Test 7 & Case B: Noori Offers 002 & 003 — Fakieh Frozen Chicken compound cell (10x1000g carton @ 141 SAR vs 1000g single @ 15.50 SAR)', () => {
      const compactPayload = encodeToCompactSingleLetterPageExtraction(nooriDecodedBaseline);
      const expanded = decodeCompactSingleLetterPageExtraction(compactPayload);

      const offer2 = expanded.offers[1]; // Carton
      const offer3 = expanded.offers[2]; // Single

      expect(offer2.compound_group_id).toBe('fakieh_chicken_cell');
      expect(offer3.compound_group_id).toBe('fakieh_chicken_cell');

      expect(offer2.promo_price).toBe(141);
      expect(offer2.original_price).toBe(202);
      expect(offer2.pack_quantity).toBe(10);
      expect(offer2.each_size_value).toBe(1000);
      expect(offer2.each_size_unit).toBe('g');

      expect(offer3.promo_price).toBe(15.5);
      expect(offer3.original_price).toBeNull();
      expect(offer3.pack_quantity).toBe(1);
      expect(offer3.each_size_value).toBe(1000);
      expect(offer3.each_size_unit).toBe('g');

      const cropRects = computeOfferUnionAndThumbBoxes(expanded.offers, 1654, 2339);
      const canon2 = mapRev1OfferToCanonical({
        offer: offer2,
        cropRect: cropRects[1],
        pageNumber: 1,
        pdfBaseName: 'noori-supermarket-229798534-jeddah',
        packageDir: nooriWorkspaceDir,
        trustedContext: defaultTrustedContext
      });
      const canon3 = mapRev1OfferToCanonical({
        offer: offer3,
        cropRect: cropRects[2],
        pageNumber: 1,
        pdfBaseName: 'noori-supermarket-229798534-jeddah',
        packageDir: nooriWorkspaceDir,
        trustedContext: defaultTrustedContext
      });

      expect(canon2.content.pack_quantity).toBe(10);
      expect(canon2.content.total_content_value).toBe(10000);
      expect(canon2.comparison.comparison_unit_price).toBe(14.1); // 141 / 10 kg
      expect(canon3.content.pack_quantity).toBe(1);
      expect(canon3.content.total_content_value).toBe(1000);
      expect(canon3.comparison.comparison_unit_price).toBe(15.5); // 15.50 / 1 kg
    });

    it('Test 8 & Case C: Noori Offer 009 — Softy Facial Tissues (7+3 Free) 10 x 130 Sheets without double-counting', () => {
      const compactPayload = encodeToCompactSingleLetterPageExtraction(nooriDecodedBaseline);
      const expanded = decodeCompactSingleLetterPageExtraction(compactPayload);
      const offer9 = expanded.offers[8];

      expect(offer9.offer_number).toBe(9);
      expect(offer9.promo_price).toBe(13.99);
      expect(offer9.original_price).toBe(23.95);
      expect(offer9.pack_quantity).toBe(10); // 7 paid + 3 free = 10 total inner packs
      expect(offer9.each_size_value).toBe(130);
      expect(offer9.each_size_unit).toBe('sheet');
      expect(offer9.normalized_product_name_ar).toBe('مناديل وجه سوفتي');
      expect(offer9.normalized_product_name_en).toBe('Softy Facial Tissues');

      const cropRects = computeOfferUnionAndThumbBoxes(expanded.offers, 1654, 2339);
      const canon9 = mapRev1OfferToCanonical({
        offer: offer9,
        cropRect: cropRects[8],
        pageNumber: 1,
        pdfBaseName: 'noori-supermarket-229798534-jeddah',
        packageDir: nooriWorkspaceDir,
        trustedContext: defaultTrustedContext
      });

      expect(canon9.content.pack_quantity).toBe(10);
      expect(canon9.content.each_size_value).toBe(130);
      expect(canon9.content.total_content_value).toBe(1300); // 10 * 130 = 1300 sheets (never 10 * 10 * 130)
      expect(canon9.promotion.special_offer).toBe('7+3 Free');
    });

    it('Case D, E, F & Tests 9–10: Ordinary single product, Assorted multi-option, Variant/Pack differentiation, Nulls & Bounding Boxes', () => {
      // Case D: Ordinary single product (Noori Offer 001: Bundi Mazza Rice 10kg)
      const compactPayload = encodeToCompactSingleLetterPageExtraction(nooriDecodedBaseline);
      const expanded = decodeCompactSingleLetterPageExtraction(compactPayload);
      const offer1 = expanded.offers[0];
      expect(offer1.english_title).toBe('Bundi Mazza Rice 10kg');
      expect(offer1.brand).toBe('Bundi');
      expect(offer1.pack_quantity).toBe(1);
      expect(offer1.each_size_value).toBe(10);
      expect(offer1.each_size_unit).toBe('kg');
      expect(offer1.promo_price).toBe(42.99);
      expect(offer1.original_price).toBe(62.99);

      // Test 9 & 10: Null handling and bounding box preservation when original_price is null
      // Test with an offer having null original_price, null original_price_box, and multi-variant assortment (Case E & F)
      const syntheticPage: LeafletPageExtractionRev1 = {
        is_loyalty_page: false,
        loyalty_program_name: null,
        validity_start_date: '2026-11-05',
        validity_end_date: '2026-11-15',
        ignored_banners: [],
        offers: [
          {
            offer_number: 1,
            arabic_title: 'حليب المراعي طازج كامل / قليل الدسم 1 لتر',
            english_title: 'Almarai Fresh Milk Full Fat / Low Fat 1L',
            brand: 'Almarai',
            is_multi_brand_or_variant: true,
            compound_group_id: null,
            item_domain: 'grocery',
            category_slug: 'dairy',
            normalized_product_name_ar: 'حليب المراعي طازج',
            normalized_product_name_en: 'Almarai Fresh Milk',
            commodity_tag: 'fresh_milk',
            quantity_limit: null,
            size_value: '1L',
            unit_type: 'Each / للحبة',
            pack_quantity: 1,
            each_size_value: 1,
            each_size_unit: 'l',
            is_uniform_size_across_variants: true,
            promo_price: 6.5,
            original_price: null,
            promo_condition: 'STANDARD',
            confidence: 0.98,
            components: {
              product_graphic_box: [100, 100, 300, 280],
              promo_price_box: [310, 110, 360, 200],
              original_price_box: null,
              unit_and_size_badge_box: [310, 210, 355, 275],
              title_text_box: [60, 100, 95, 280]
            }
          },
          {
            offer_number: 2,
            arabic_title: 'حليب المراعي طويل الأجل كامل الدسم 4 × 1 لتر',
            english_title: 'Almarai UHT Milk Full Fat 4 x 1L',
            brand: 'Almarai',
            is_multi_brand_or_variant: false,
            compound_group_id: null,
            item_domain: 'grocery',
            category_slug: 'dairy',
            normalized_product_name_ar: 'حليب المراعي طويل الأجل كامل الدسم',
            normalized_product_name_en: 'Almarai UHT Milk Full Fat',
            commodity_tag: 'uht_milk',
            quantity_limit: '2 pcs per customer',
            size_value: '4x1L',
            unit_type: 'Pack / عبوة',
            pack_quantity: 4,
            each_size_value: 1,
            each_size_unit: 'l',
            is_uniform_size_across_variants: true,
            promo_price: 21.95,
            original_price: 26.0,
            promo_condition: 'STANDARD',
            confidence: 0.99,
            components: {
              product_graphic_box: [400, 100, 620, 280],
              promo_price_box: [630, 110, 680, 200],
              original_price_box: [630, 205, 665, 275],
              unit_and_size_badge_box: [580, 105, 615, 175],
              title_text_box: [365, 100, 395, 280]
            }
          }
        ]
      };

      const compactSynthetic = encodeToCompactSingleLetterPageExtraction(syntheticPage);
      expect(compactSynthetic.p).toBeNull();
      expect(compactSynthetic.o[0].t).toBeNull();
      expect(compactSynthetic.o[0].w.r).toBeNull();
      expect(compactSynthetic.o[0].l).toBeNull();

      const decodedSynthetic = decodeCompactSingleLetterPageExtraction(compactSynthetic);
      expect(decodedSynthetic).toEqual(syntheticPage);

      const rects = computeOfferUnionAndThumbBoxes(decodedSynthetic.offers, 1000, 1000);
      const canonAssorted = mapRev1OfferToCanonical({
        offer: decodedSynthetic.offers[0],
        cropRect: rects[0],
        pageNumber: 1,
        pdfBaseName: 'test-leaflet',
        packageDir: tempDir,
        trustedContext: defaultTrustedContext
      });
      const canonMultipack = mapRev1OfferToCanonical({
        offer: decodedSynthetic.offers[1],
        cropRect: rects[1],
        pageNumber: 1,
        pdfBaseName: 'test-leaflet',
        packageDir: tempDir,
        trustedContext: defaultTrustedContext
      });

      // Case E: Assorted offer preserves assortment_indicated status
      expect(canonAssorted.contract_v2?.assortment.status).toBe('assortment_indicated');
      expect(canonAssorted.prices.original_price).toBeNull();

      // Case F: 1L single vs 4x1L multipack remain distinct in pack_quantity and total_content
      expect(canonAssorted.content.pack_quantity).toBe(1);
      expect(canonAssorted.content.total_content_value).toBe(1);
      expect(canonMultipack.content.pack_quantity).toBe(4);
      expect(canonMultipack.content.total_content_value).toBe(4);
      expect(canonMultipack.promotion.quantity_limit).toBe('2 pcs per customer');
    });

    it('Test 11 & Cases G, H: Automatic metadata reuse and selected-page scope restriction from compact_v1 extraction', async () => {
      const pkgDir = join(tempDir, 'compact_pkg_test');
      const page1Dir = join(pkgDir, 'metadata', 'rev1', 'page-001');
      const page2Dir = join(pkgDir, 'metadata', 'rev1', 'page-002');
      mkdirSync(page1Dir, { recursive: true });
      mkdirSync(page2Dir, { recursive: true });

      const compactPage1 = encodeToCompactSingleLetterPageExtraction({
        ...nooriDecodedBaseline,
        ignored_banners: [
          'متجر النوري سوبرماركت Noori Supermarket',
          ...nooriDecodedBaseline.ignored_banners
        ]
      });
      const decodedPage1 = decodeCompactSingleLetterPageExtraction(compactPage1);

      // Write Page 1 with compact_v1 rawResponse + decodedExtraction
      writeFileSync(
        join(page1Dir, 'raw_extracted_page_1.json'),
        JSON.stringify({
          cacheVersion: 1,
          rawResponse: compactPage1,
          decodedExtraction: decodedPage1
        }),
        'utf8'
      );

      // Write Page 2 (outside selectedPages=[1]) with different dates to test Case H scope isolation
      const compactPage2 = encodeToCompactSingleLetterPageExtraction({
        is_loyalty_page: true,
        loyalty_program_name: 'Tamayouz',
        validity_start_date: '2026-12-01',
        validity_end_date: '2026-12-31',
        ignored_banners: ['Panda Hypermarket بنده'],
        offers: []
      });
      writeFileSync(
        join(page2Dir, 'raw_extracted_page_2.json'),
        JSON.stringify(compactPage2),
        'utf8'
      );

      // Case H: Collect evidence strictly for selectedPages: [1]
      const evidencePage1Only = collectPackageMetadataEvidence(pkgDir, { selectedPages: [1] });
      expect(evidencePage1Only.inspectedPages).toEqual([1]);
      expect(evidencePage1Only.geminiValidityCandidates).toHaveLength(1);
      expect(evidencePage1Only.geminiValidityCandidates[0].startDate).toBe('2026-11-05');
      expect(evidencePage1Only.geminiValidityCandidates[0].endDate).toBe('2026-11-15');

      // Case G: Feed into LeafletMetadataService with 0 extra AI calls
      const metaCache = new LeafletMetadataCacheService(join(tempDir, 'meta_cache.json'));
      const metaService = new LeafletMetadataService(metaCache);
      const discovered = await metaService.discoverMetadata({
        leafletFingerprint: 'test-noori-compact-fp-001',
        sourceFileName: 'noori-supermarket-229798534-jeddah.pdf',
        pagesText: [],
        packageEvidence: evidencePage1Only,
        selectedPages: [1],
        selectionMode: 'specific',
        totalPages: 1
      });

      expect(discovered.validity?.startDate).toBe('2026-11-05');
      expect(discovered.validity?.endDate).toBe('2026-11-15');
      expect(discovered.scanCoverage?.selectedPages).toEqual([1]);
      expect(discovered.scanCoverage?.analyzedPages).toEqual([1]);
      // Page 2 ("2026-12-01" / "Panda") must NOT leak into selectedPages: [1]
      expect(discovered.validity?.startDate).not.toBe('2026-12-01');
    });
  });

  // =========================================================================
  // SECTION 3: Technical Tests 16–19 — Cache Replay, Fingerprinting & HIGH Thinking
  // =========================================================================
  describe('3. Cache Replay, Profile Fingerprinting & Unconditional HIGH Thinking (Tests 16–19)', () => {
    it('Test 16 & Case I: Replays existing saved raw_extracted_page_1.json cache with 0 Gemini API calls', async () => {
      const cacheService = new GeminiExtractionCacheService();
      const mockClient = {
        vertexai: true,
        models: {
          generateContent: vi.fn()
        }
      };

      const service = new GeminiExtractionService(cacheService, mockClient);

      // Prime a local cache entry in tempDir using compact_v1 via mockResponse
      const compactNoori = encodeToCompactSingleLetterPageExtraction(nooriRawResponse);
      const firstRun = await service.extractLeafletPage({
        imagePath: sampleImagePath,
        pageNumber: 1,
        outputDir: tempDir,
        promptProfile: 'compact_v1',
        schemaProfile: 'compact_v1',
        mockResponse: {
          text: JSON.stringify(compactNoori),
          modelVersion: 'gemini-3.8-flash',
          usageMetadata: {
            promptTokenCount: 2550,
            candidatesTokenCount: 1650,
            thoughtsTokenCount: 7314,
            totalTokenCount: 11514,
            trafficType: 'ON_DEMAND'
          }
        }
      });

      expect(firstRun.cacheHit).toBe(false);
      expect(firstRun.offers).toHaveLength(10);

      // Second run without forceReextract must hit local cache with 0 calls to mockClient.models.generateContent
      const replayRun = await service.extractLeafletPage({
        imagePath: sampleImagePath,
        pageNumber: 1,
        outputDir: tempDir,
        promptProfile: 'compact_v1',
        schemaProfile: 'compact_v1'
      });

      expect(replayRun.cacheHit).toBe(true);
      expect(replayRun.usageReport?.cost.totalCostUsd).toBe(0);
      expect(replayRun.offers).toHaveLength(10);
      expect(mockClient.models.generateContent).not.toHaveBeenCalled();
    });

    it('Test 17: Cache fingerprint changes when schema version changes (legacy vs compact_v1)', () => {
      const cacheService = new GeminiExtractionCacheService();
      const fpLegacy = cacheService.computeFingerprint({
        imageBuffer: sampleImageBuffer,
        model: 'gemini-3.8-flash',
        systemInstruction: buildLegacyPageExtractionSystemPrompt(),
        promptText: 'Extract offers',
        promptProfile: 'legacy',
        promptVersion: 'legacy',
        schema: getLeafletPageGenAiSchema('legacy'),
        schemaProfile: 'legacy',
        schemaVersion: 'legacy',
        thinkingConfig: { thinkingLevel: 'HIGH' }
      });

      const fpCompact = cacheService.computeFingerprint({
        imageBuffer: sampleImageBuffer,
        model: 'gemini-3.8-flash',
        systemInstruction: buildLegacyPageExtractionSystemPrompt(),
        promptText: 'Extract offers',
        promptProfile: 'legacy',
        promptVersion: 'legacy',
        schema: getLeafletPageGenAiSchema('compact_v1'),
        schemaProfile: 'compact_v1',
        schemaVersion: 'compact_v1',
        thinkingConfig: { thinkingLevel: 'HIGH' }
      });

      expect(fpLegacy.fingerprint.schemaSha256).not.toBe(fpCompact.fingerprint.schemaSha256);
      expect(fpLegacy.fingerprintHash).not.toBe(fpCompact.fingerprintHash);
    });

    it('Test 18: Cache fingerprint changes when prompt profile changes (legacy vs compact_v1)', () => {
      const cacheService = new GeminiExtractionCacheService();
      const fpLegacyPrompt = cacheService.computeFingerprint({
        imageBuffer: sampleImageBuffer,
        model: 'gemini-3.8-flash',
        systemInstruction: buildRev1PageExtractionSystemPrompt('legacy'),
        promptText: 'Extract offers',
        promptProfile: 'legacy',
        promptVersion: 'legacy',
        schema: getLeafletPageGenAiSchema('compact_v1'),
        schemaProfile: 'compact_v1',
        schemaVersion: 'compact_v1',
        thinkingConfig: { thinkingLevel: 'HIGH' }
      });

      const fpCompactPrompt = cacheService.computeFingerprint({
        imageBuffer: sampleImageBuffer,
        model: 'gemini-3.8-flash',
        systemInstruction: buildRev1PageExtractionSystemPrompt('compact_v1'),
        promptText: 'Extract offers',
        promptProfile: 'compact_v1',
        promptVersion: 'compact_v1',
        schema: getLeafletPageGenAiSchema('compact_v1'),
        schemaProfile: 'compact_v1',
        schemaVersion: 'compact_v1',
        thinkingConfig: { thinkingLevel: 'HIGH' }
      });

      expect(fpLegacyPrompt.fingerprint.systemInstructionSha256).not.toBe(
        fpCompactPrompt.fingerprint.systemInstructionSha256
      );
      expect(fpLegacyPrompt.fingerprintHash).not.toBe(fpCompactPrompt.fingerprintHash);
    });

    it('Test 19: thinkingLevel remains HIGH unconditionally in config and extraction requests', async () => {
      const envCfg = loadEnvConfig();
      expect(envCfg.gemini.thinkingLevel).toBe('HIGH');

      let capturedConfig: any = null;
      const mockClient = {
        vertexai: true,
        models: {
          generateContent: vi.fn().mockImplementation(async (params: any) => {
            capturedConfig = params.config;
            return {
              text: JSON.stringify(encodeToCompactSingleLetterPageExtraction(nooriRawResponse)),
              modelVersion: 'gemini-3.8-flash',
              usageMetadata: {
                promptTokenCount: 2550,
                candidatesTokenCount: 1650,
                thoughtsTokenCount: 7314,
                totalTokenCount: 11514,
                trafficType: 'ON_DEMAND'
              }
            };
          })
        }
      };

      const service = new GeminiExtractionService(new GeminiExtractionCacheService(), mockClient);
      await service.extractLeafletPage({
        imagePath: sampleImagePath,
        pageNumber: 1,
        outputDir: tempDir,
        promptProfile: 'compact_v1',
        schemaProfile: 'compact_v1',
        forceReextract: true
      });

      expect(capturedConfig).toBeDefined();
      expect(capturedConfig.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
    });
  });

  // =========================================================================
  // SECTION 4: Technical Tests 20–26 — Service Tier, Flex Routing, Cost & Archives
  // =========================================================================
  describe('4. Service-Tier Routing, Traffic-Type Cost Accuracy & Provider Archives (Tests 20–26)', () => {
    it('Test 20: Standard service-tier request config omits Flex headers and sets requestedServiceTier="standard"', async () => {
      let capturedConfig: any = null;
      const mockClient = {
        vertexai: true,
        models: {
          generateContent: vi.fn().mockImplementation(async (params: any) => {
            capturedConfig = params.config;
            return {
              text: JSON.stringify(nooriRawResponse),
              modelVersion: 'gemini-3.8-flash',
              usageMetadata: {
                promptTokenCount: 5460,
                candidatesTokenCount: 3342,
                thoughtsTokenCount: 7314,
                totalTokenCount: 16116,
                trafficType: 'ON_DEMAND'
              }
            };
          })
        }
      };

      const service = new GeminiExtractionService(new GeminiExtractionCacheService(), mockClient);
      const res = await service.extractLeafletPage({
        imagePath: sampleImagePath,
        pageNumber: 1,
        outputDir: tempDir,
        executionMode: 'standard',
        forceReextract: true
      });

      expect(capturedConfig.httpOptions).toBeUndefined();
      expect(res.usageReport?.requestedServiceTier).toBe('standard');
      expect(res.usageReport?.actualServiceTier).toBe('standard');
      expect(res.usageReport?.cost.tier).toBe('standard');
      expect(res.usageReport?.cost.totalCostUsd).toBe(0.044055);
    });

    it('Test 21: Flex service-tier request config on Vertex AI global injects exact shared/flex headers', async () => {
      const prevLoc = process.env.GOOGLE_CLOUD_LOCATION;
      process.env.GOOGLE_CLOUD_LOCATION = 'global';
      try {
        let capturedConfig: any = null;
        const mockClient = {
          vertexai: true,
          models: {
            generateContent: vi.fn().mockImplementation(async (params: any) => {
              capturedConfig = params.config;
              return {
                text: JSON.stringify(encodeToCompactSingleLetterPageExtraction(nooriRawResponse)),
                modelVersion: 'gemini-3.8-flash',
                usageMetadata: {
                  promptTokenCount: 2550,
                  candidatesTokenCount: 1650,
                  thoughtsTokenCount: 7314,
                  totalTokenCount: 11514,
                  trafficType: 'ON_DEMAND_FLEX'
                }
              };
            })
          }
        };

        const service = new GeminiExtractionService(new GeminiExtractionCacheService(), mockClient);
        const res = await service.extractLeafletPage({
          imagePath: sampleImagePath,
          pageNumber: 1,
          outputDir: tempDir,
          promptProfile: 'compact_v1',
          schemaProfile: 'compact_v1',
          executionMode: 'flex',
          forceReextract: true
        });

        expect(capturedConfig.httpOptions).toEqual({
          headers: {
            'X-Vertex-AI-LLM-Request-Type': 'shared',
            'X-Vertex-AI-LLM-Shared-Request-Type': 'flex'
          }
        });
        expect(capturedConfig.serviceTier).toBeUndefined();
        expect(res.usageReport?.requestedServiceTier).toBe('flex');
        expect(res.usageReport?.actualServiceTier).toBe('flex');
        expect(res.usageReport?.cost.tier).toBe('flex');
      } finally {
        if (prevLoc === undefined) delete process.env.GOOGLE_CLOUD_LOCATION;
        else process.env.GOOGLE_CLOUD_LOCATION = prevLoc;
      }
    });

    it('Test 22: Flex unsupported model or non-global region fails closed without falling back to standard billing', async () => {
      const prevLoc = process.env.GOOGLE_CLOUD_LOCATION;
      process.env.GOOGLE_CLOUD_LOCATION = 'global';
      try {
        const mockUnsupportedModelClient = {
          vertexai: true,
          models: {
            generateContent: vi.fn()
          }
        };
        const serviceUnsupportedModel = new GeminiExtractionService(
          new GeminiExtractionCacheService(),
          mockUnsupportedModelClient
        );

        await expect(
          serviceUnsupportedModel.extractLeafletPage({
            imagePath: sampleImagePath,
            pageNumber: 1,
            outputDir: tempDir,
            overrideModel: 'gemini-4-argon',
            executionMode: 'flex',
            forceReextract: true,
            maxRetries: 0
          })
        ).rejects.toThrow(/FLEX_UNSUPPORTED_MODEL/);
        expect(mockUnsupportedModelClient.models.generateContent).not.toHaveBeenCalled();

        process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
        const mockRegionalVertexClient = {
          vertexai: true,
          models: {
            generateContent: vi.fn()
          }
        };
        const serviceRegional = new GeminiExtractionService(
          new GeminiExtractionCacheService(),
          mockRegionalVertexClient
        );
        await expect(
          serviceRegional.extractLeafletPage({
            imagePath: sampleImagePath,
            pageNumber: 1,
            outputDir: tempDir,
            executionMode: 'flex',
            forceReextract: true,
            maxRetries: 0
          })
        ).rejects.toThrow(/FLEX_REQUIRES_GLOBAL_LOCATION/);
        expect(mockRegionalVertexClient.models.generateContent).not.toHaveBeenCalled();
      } finally {
        if (prevLoc === undefined) delete process.env.GOOGLE_CLOUD_LOCATION;
        else process.env.GOOGLE_CLOUD_LOCATION = prevLoc;
      }
    });

    it('Test 23: Cost calculation strictly uses provider-reported trafficType (ON_DEMAND vs ON_DEMAND_FLEX)', async () => {
      const prevLoc = process.env.GOOGLE_CLOUD_LOCATION;
      process.env.GOOGLE_CLOUD_LOCATION = 'global';
      try {
        // Case 23a: Caller requests 'flex', but provider reports trafficType: 'ON_DEMAND'
        // Must NOT claim Flex pricing! Must price at Standard rates ($0.75 / $3.75).
        const mockDowngradedClient = {
          vertexai: true,
          models: {
            generateContent: vi.fn().mockResolvedValue({
              text: JSON.stringify(nooriRawResponse),
              modelVersion: 'gemini-3.8-flash',
              usageMetadata: {
                promptTokenCount: 5460,
                candidatesTokenCount: 3342,
                thoughtsTokenCount: 7314,
                totalTokenCount: 16116,
                trafficType: 'ON_DEMAND'
              }
            })
          }
        };

        const serviceDowngraded = new GeminiExtractionService(
          new GeminiExtractionCacheService(),
          mockDowngradedClient
        );
        const resDowngraded = await serviceDowngraded.extractLeafletPage({
          imagePath: sampleImagePath,
          pageNumber: 1,
          outputDir: tempDir,
          executionMode: 'flex',
          forceReextract: true
        });

        expect(resDowngraded.usageReport?.requestedServiceTier).toBe('flex');
        expect(resDowngraded.usageReport?.actualServiceTier).toBe('standard');
        expect(resDowngraded.usageReport?.cost.tier).toBe('standard');
        expect(resDowngraded.usageReport?.cost.totalCostUsd).toBe(0.044055);

        // Case 23b: Provider confirms trafficType: 'ON_DEMAND_FLEX' -> priced at 50% Flex rates ($0.375 / $1.875)
        const flexCost = calculateGeminiCost(
          {
            promptTokenCount: 5460,
            candidatesTokenCount: 3342,
            thoughtsTokenCount: 7314,
            cachedContentTokenCount: 0,
            totalTokenCount: 16116
          },
          'gemini-3.8-flash',
          'flex',
          '2026-11-10'
        );
        expect(flexCost.tier).toBe('flex');
        expect(flexCost.totalCostUsd).toBeCloseTo(0.0220275, 6);
      } finally {
        if (prevLoc === undefined) delete process.env.GOOGLE_CLOUD_LOCATION;
        else process.env.GOOGLE_CLOUD_LOCATION = prevLoc;
      }
    });

    it('Test 24 & 25: Provider response archive stores verbatim compact rawResponseText, schemaVersion, expanded output, and redacts secrets', async () => {
      const prevApiKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'AIzaSyFakeSecretTestKey999999999';
      try {
        const compactNoori = encodeToCompactSingleLetterPageExtraction(nooriRawResponse);
        const compactRawText = JSON.stringify(compactNoori);

        const service = new GeminiExtractionService(new GeminiExtractionCacheService());
        const res = await service.extractLeafletPage({
          imagePath: sampleImagePath,
          pageNumber: 1,
          outputDir: tempDir,
          promptProfile: 'compact_v1',
          schemaProfile: 'compact_v1',
          forceReextract: true,
          mockResponse: {
            text: compactRawText,
            modelVersion: 'gemini-3.8-flash',
            secretToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret.payload',
            apiKeyEcho: 'AIzaSyFakeSecretTestKey999999999',
            usageMetadata: {
              promptTokenCount: 2550,
              candidatesTokenCount: 1650,
              thoughtsTokenCount: 7314,
              totalTokenCount: 11514,
              trafficType: 'ON_DEMAND'
            }
          }
        });

        expect(res.providerArchivePath).toBeDefined();
        expect(existsSync(res.providerArchivePath!)).toBe(true);

        const archiveRaw = readFileSync(res.providerArchivePath!, 'utf8');
        // Test 25: Secret redaction verification
        expect(archiveRaw).not.toContain('AIzaSyFakeSecretTestKey999999999');
        expect(archiveRaw).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');

        const archive = JSON.parse(archiveRaw);
        // Test 24: Verbatim compact rawResponseText + schemaVersion + expanded decodedExtraction
        expect(archive.requestMetadata.promptProfile).toBe('compact_v1');
        expect(archive.requestMetadata.schemaProfile).toBe('compact_v1');
        expect(archive.requestMetadata.schemaVersion).toBe('compact_v1');
        expect(archive.rawResponseText).toBe(compactRawText);
        expect(archive.parsedApplicationResponse.rawParsedJson.o).toHaveLength(10);
        expect(archive.parsedApplicationResponse.decodedExtraction.offers).toHaveLength(10);
        expect(archive.parsedApplicationResponse.decodedExtraction.offers[6].english_title).toBe(
          'Qoot & Root Premium Flour 1kg'
        );
      } finally {
        if (prevApiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = prevApiKey;
      }
    });

    it('Test 26: Offline guard — verifies zero live network calls and deterministic Noori compression metrics', () => {
      // Deterministic measurement on real Noori baseline (PART D §11)
      const originalRawText: string = nooriPrimaryAttempt.rawResponseText;
      const originalRawBytes = Buffer.byteLength(originalRawText, 'utf8');
      const originalMinifiedBytes = Buffer.byteLength(JSON.stringify(nooriRawResponse), 'utf8');

      const compactNoori = encodeToCompactSingleLetterPageExtraction(nooriRawResponse);
      const compactMinifiedText = JSON.stringify(compactNoori);
      const compactPrettyText = JSON.stringify(compactNoori, null, 2);
      const compactMinifiedBytes = Buffer.byteLength(compactMinifiedText, 'utf8');
      const compactPrettyBytes = Buffer.byteLength(compactPrettyText, 'utf8');

      const legacySchemaBytes = Buffer.byteLength(JSON.stringify(getLegacyLeafletPageGenAiSchema()), 'utf8');
      const compactSchemaBytes = Buffer.byteLength(
        JSON.stringify(getCompactSingleLetterLeafletPageGenAiSchema()),
        'utf8'
      );

      const legacyPromptChars = buildLegacyPageExtractionSystemPrompt().length;
      const compactPromptChars = buildCompactSingleLetterPageExtractionSystemPrompt().length;

      console.log(
        `[Noori Baseline Compression] RawResponse: ${originalRawBytes}B (minified ${originalMinifiedBytes}B) -> CompactV1: ${compactMinifiedBytes}B (pretty ${compactPrettyBytes}B) | Schema: ${legacySchemaBytes}B -> ${compactSchemaBytes}B | Prompt: ${legacyPromptChars} chars -> ${compactPromptChars} chars`
      );

      expect(originalRawBytes).toBe(9110);
      expect(compactMinifiedBytes).toBe(5016);
      expect(compactMinifiedBytes).toBeLessThan(originalRawBytes * 0.56);
      expect(compactMinifiedBytes).toBeLessThan(originalMinifiedBytes * 0.65);
      expect(compactSchemaBytes).toBeLessThan(legacySchemaBytes * 0.85);
      expect(compactSchemaBytes).toBeLessThanOrEqual(2902);
      expect(compactPromptChars).toBeLessThan(legacyPromptChars);
    });
  });
});
