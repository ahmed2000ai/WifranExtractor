import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import sharp from 'sharp';
import {
  buildMasterQualityPageExtractionSystemPrompt,
  buildLegacyPageExtractionSystemPrompt,
  buildRev1PageExtractionSystemPrompt,
  buildRev1DiagnosticRetryPrompt
} from '../geminiPromptBuilder';
import {
  getLeafletPageGenAiSchema,
  decodeLeafletPageExtraction,
  type LeafletPromptProfile,
  type LeafletSchemaProfile
} from '../../../shared/schemas/leafletPageExtractionSchema';
import {
  GeminiExtractionCacheService
} from '../geminiExtractionCacheService';
import { GeminiExtractionService } from '../geminiExtractionService';
import type { GeminiCacheEntry } from '../../../shared/types/geminiCacheTypes';

describe('WIFRAN-EXTRACTOR-GEMINI-OPT-004A: Master Quality Instructions & Cache Integrity', () => {
  let testTempDir: string;
  let testImagePath: string;
  let testImageBuffer: Buffer;

  beforeEach(async () => {
    testTempDir = join(
      tmpdir(),
      `wifran-opt004a-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    );
    mkdirSync(testTempDir, { recursive: true });

    testImagePath = join(testTempDir, 'test_page_sample.jpg');
    testImageBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .jpeg({ quality: 92 })
      .toBuffer();
    writeFileSync(testImagePath, testImageBuffer);
  });

  afterEach(() => {
    if (existsSync(testTempDir)) {
      rmSync(testTempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Master Quality System Prompt Rules & Construction
  // =========================================================================
  describe('1. Master Quality System Prompt Rules & Construction', () => {
    it('buildMasterQualityPageExtractionSystemPrompt contains all essential visual extraction guidelines', () => {
      const prompt = buildMasterQualityPageExtractionSystemPrompt();

      // Full page coverage
      expect(prompt).toContain('COMPLETE OFFER DETECTION & LAYOUT COVERAGE');
      expect(prompt).toContain('quadrant');
      expect(prompt).toContain('column');
      expect(prompt).toContain('tall vertical product cards');

      // Verbatim bilingual text preservation
      expect(prompt).toContain('EXACT ARABIC AND ENGLISH DESCRIPTIONS (ZERO TRANSLATION)');
      expect(prompt).toContain('NEVER translate English into standard Arabic');
      expect(prompt).toContain('Preserve all printed meaningful product qualifiers');

      // Brand vs Ingredient distinction
      expect(prompt).toContain('BRAND IDENTIFICATION RULES (MANUFACTURER VS INGREDIENT/STYLE)');
      expect(prompt).toContain('Snickers Cake');
      expect(prompt).toContain('factory-packaged confectionery product');

      // Compound cells and multi-brand / multi-variant offers
      expect(prompt).toContain('MULTI-PRICE / MULTI-TIER COMPOUND CELLS');
      expect(prompt).toContain('Multi-Brand Offers');
      expect(prompt).toContain('grp');
      expect(prompt).toContain('sharing a single title banner');

      // Strict price hierarchy
      expect(prompt).toContain('STRICT PRICE HIERARCHY & NUMERIC FORMATTING');
      expect(prompt).toContain('op MUST BE null. NEVER invent an original price');
      expect(prompt).toContain('Eastern Arabic-Indic');
      expect(prompt).toContain('Superscript Halalas');

      // Semantic physical quantity & canonical units
      expect(prompt).toContain('SEMANTIC PHYSICAL QUANTITY DECOMPOSITION');
      expect(prompt).toContain('pq');
      expect(prompt).toContain('ev');
      expect(prompt).toContain('eu');
      expect(prompt).toContain('Canonical Units (eu): Strictly normalize to "g", "kg", "ml", "l", "pcs", "roll", or "sheet"');
      expect(prompt).toContain('Egg trays: "30s", "24s", "30PCS", "٣٠ حبة", "طبق بيض ٣٠ حبة": pq = 1 (it is 1 tray), ev = 30, eu = "pcs"');
      expect(prompt).toContain('Do NOT invent sz: "1kg"');
      expect(prompt).toContain('Promotional Wordings vs Physical Pack Contents');
      expect(prompt).toContain('promotional sticker or coupon, it remains a single unit (pq = 1)');

      // Atomic 5 component 2D bounding boxes
      expect(prompt).toContain('ATOMIC COMPONENT 2D BOUNDING BOXES (b2d)');
      expect(prompt).toContain('g (product_graphic_box)');
      expect(prompt).toContain('p (promo_price_box)');
      expect(prompt).toContain('r (original_price_box)');
      expect(prompt).toContain('u (unit_and_size_badge_box)');
      expect(prompt).toContain('t (title_text_box)');

      // Clean compact output key enforcement without condition/discontinued-field leakage
      expect(prompt).toContain('COMPACT OUTPUT KEYS ONLY');
      expect(prompt).toContain('n, ar, en, b, m, grp, p, op, sz, ut, pq, ev, eu, u_sz, c, and b2d (g, p, t, r, u)');
      expect(prompt).not.toContain('is_loyalty_page');
      expect(prompt).not.toContain('promo_condition');
      expect(prompt).not.toContain('quantity_limit');
    });

    it('buildRev1PageExtractionSystemPrompt routes profiles correctly', () => {
      const masterPrompt = buildRev1PageExtractionSystemPrompt('master_quality');
      const optPrompt = buildRev1PageExtractionSystemPrompt('optimized');
      const legacyPrompt = buildRev1PageExtractionSystemPrompt('legacy');
      const defaultPrompt = buildRev1PageExtractionSystemPrompt();

      expect(masterPrompt).toContain('COMPLETE OFFER DETECTION & LAYOUT COVERAGE');
      expect(masterPrompt).toContain('BRAND IDENTIFICATION RULES (MANUFACTURER VS INGREDIENT/STYLE)');

      expect(optPrompt).toContain('Conform strictly to the supplied compact JSON schema');
      expect(optPrompt).toContain('ATOMIC COMPONENT 2D BOUNDING BOXES (b2d)');
      expect(legacyPrompt).toContain('You are an elite Retail Vision AI');
      expect(legacyPrompt).toContain('item_domain');

      // Default must be legacy for zero production regression
      expect(defaultPrompt).toEqual(legacyPrompt);
    });

    it('buildRev1DiagnosticRetryPrompt supports master_quality profile', () => {
      const retryMaster = buildRev1DiagnosticRetryPrompt(
        ['Missing price bounding box'],
        'master_quality'
      );
      expect(retryMaster).toContain('Stage 6 High-Precision Targeted Diagnostic Retry');
      expect(retryMaster).toContain('Missing price bounding box');
      expect(retryMaster).toContain('Provide tight 2D component coordinates [ymin, xmin, ymax, xmax] (0-1000) for g, p, t, r, and u');

      const retryLegacy = buildRev1DiagnosticRetryPrompt(
        ['Missing price bounding box'],
        'legacy'
      );
      expect(retryLegacy).toContain('product_graphic_box, promo_price_box');
    });
  });

  // =========================================================================
  // 2. Schema Profiles & Lossless Canonical Decoding
  // =========================================================================
  describe('2. Independent Schema Selection & Lossless Canonical Decoding', () => {
    it('getLeafletPageGenAiSchema returns correct schema structure for legacy and optimized profiles', () => {
      const legacySchema = getLeafletPageGenAiSchema('legacy') as any;
      const optSchema = getLeafletPageGenAiSchema('optimized') as any;

      // Legacy schema retains verbose top-level properties (excluding discontinued loyalty fields)
      expect(legacySchema.properties).toHaveProperty('offers');
      expect(legacySchema.properties).not.toHaveProperty('is_loyalty_page');
      expect(legacySchema.properties).toHaveProperty('validity_start_date');

      // Optimized schema eliminates redundant page metadata and has compact offer items
      expect(optSchema.properties).toHaveProperty('offers');
      expect(optSchema.properties).not.toHaveProperty('is_loyalty_page');
      const itemProperties = optSchema.properties.offers.items.properties;
      expect(itemProperties).toHaveProperty('ar');
      expect(itemProperties).toHaveProperty('en');
      expect(itemProperties).toHaveProperty('p');
      expect(itemProperties).toHaveProperty('b2d');
    });

    it('decodeLeafletPageExtraction correctly decodes compact Master Quality / Optimized responses', () => {
      const compactResponse = {
        offers: [
          {
            n: 1,
            ar: 'كيكة سنيكرز وسط',
            en: 'Snickers Cake Medium',
            b: null, // Unbranded in-house bakery cake flavored with Snickers
            m: false,
            grp: null,
            p: 29.95,
            op: 45.0,
            sz: 'Medium',
            ut: 'Per Piece / للحبة',
            pq: 1,
            ev: 1,
            eu: 'pcs',
            u_sz: true,
            c: 0.98,
            b2d: {
              g: [100, 150, 450, 480],
              p: [460, 160, 500, 260],
              r: [460, 270, 490, 350],
              u: [460, 360, 490, 440],
              t: [50, 150, 95, 480]
            }
          },
          {
            n: 2,
            ar: 'شوكولاتة سنيكرز ميني ٥٠٠ جم',
            en: 'Snickers Miniatures Chocolates 500g',
            b: 'Snickers', // Genuine packaged confectionery brand
            m: false,
            grp: null,
            p: 18.5,
            op: null,
            sz: '500g',
            ut: 'Each / للحبة',
            pq: 1,
            ev: 500,
            eu: 'g',
            u_sz: true,
            c: 0.99,
            b2d: {
              g: [550, 150, 850, 480],
              p: [860, 160, 900, 260],
              r: null,
              u: [860, 270, 890, 350],
              t: [510, 150, 545, 480]
            }
          }
        ]
      };

      const decoded = decodeLeafletPageExtraction(compactResponse);

      expect(decoded.offers).toHaveLength(2);

      // Offer 1: Bakery cake
      const offer1 = decoded.offers[0];
      expect(offer1.offer_number).toBe(1);
      expect(offer1.arabic_title).toBe('كيكة سنيكرز وسط');
      expect(offer1.english_title).toBe('Snickers Cake Medium');
      expect(offer1.brand).toBeNull();
      expect(offer1.promo_price).toBe(29.95);
      expect(offer1.original_price).toBe(45.0);
      expect(offer1.components.product_graphic_box).toEqual([100, 150, 450, 480]);
      expect(offer1.components.promo_price_box).toEqual([460, 160, 500, 260]);
      expect(offer1.components.original_price_box).toEqual([460, 270, 490, 350]);
      expect(offer1.components.unit_and_size_badge_box).toEqual([460, 360, 490, 440]);
      expect(offer1.components.title_text_box).toEqual([50, 150, 95, 480]);

      // Offer 2: Packaged confectionery
      const offer2 = decoded.offers[1];
      expect(offer2.offer_number).toBe(2);
      expect(offer2.english_title).toBe('Snickers Miniatures Chocolates 500g');
      expect(offer2.brand).toBe('Snickers');
      expect(offer2.promo_price).toBe(18.5);
      expect(offer2.original_price).toBeNull();
      expect(offer2.components.original_price_box).toBeNull();
    });

    it('decodeLeafletPageExtraction correctly preserves compound multi-variant cells and egg trays', () => {
      const compactCompound = {
        offers: [
          {
            n: 1,
            ar: 'طبق بيض طازج رحيمة ٣٠ حبة',
            en: 'Rahima Fresh Eggs 30 Pcs',
            b: 'Rahima',
            m: false,
            grp: null,
            p: 14.95,
            op: 19.5,
            sz: '30PCS',
            ut: 'Per Plate / للطبق',
            pq: 1, // 1 physical tray
            ev: 30, // 30 eggs inside
            eu: 'pcs',
            u_sz: true,
            c: 0.96,
            b2d: {
              g: [100, 100, 300, 300],
              p: [310, 100, 350, 180],
              r: [310, 190, 350, 250],
              u: [310, 260, 350, 300],
              t: [70, 100, 95, 300]
            }
          },
          {
            n: 2,
            ar: 'زبادي نادك طازج كامل / قليل الدسم ٢ كجم',
            en: 'Nadec Fresh Yoghurt Full / Low Fat 2kg',
            b: 'Nadec',
            m: true, // Multi-variant offer
            grp: 'nadec_yoghurt_group',
            p: 11.5,
            op: 15.0,
            sz: '2kg',
            ut: 'Each / للحبة',
            pq: 1,
            ev: 2,
            eu: 'kg',
            u_sz: true,
            c: 0.97,
            b2d: {
              g: [400, 100, 600, 300],
              p: [610, 100, 650, 180],
              r: [610, 190, 650, 250],
              u: [610, 260, 650, 300],
              t: [370, 100, 395, 300]
            }
          }
        ]
      };

      const decoded = decodeLeafletPageExtraction(compactCompound);
      expect(decoded.offers[0].pack_quantity).toBe(1);
      expect(decoded.offers[0].each_size_value).toBe(30);
      expect(decoded.offers[0].each_size_unit).toBe('pcs');

      expect(decoded.offers[1].is_multi_brand_or_variant).toBe(true);
      expect(decoded.offers[1].compound_group_id).toBe('nadec_yoghurt_group');
      expect(decoded.offers[1].each_size_value).toBe(2);
      expect(decoded.offers[1].each_size_unit).toBe('kg');
    });
  });

  // =========================================================================
  // 3. Deterministic Cache Invalidation & System Instruction Hashing
  // =========================================================================
  describe('3. Deterministic Local Cache Invalidation on Semantic Changes', () => {
    const cacheService = new GeminiExtractionCacheService();

    it('changing systemInstruction invalidates fingerprint and cache even if promptText is identical', () => {
      const promptText = 'Analyze this promotional supermarket leaflet page.';
      const legacyPrompt = buildLegacyPageExtractionSystemPrompt();
      const masterPrompt = buildMasterQualityPageExtractionSystemPrompt();

      const legacyFp = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        systemInstruction: legacyPrompt,
        promptText,
        promptProfile: 'legacy',
        schema: getLeafletPageGenAiSchema('legacy'),
        schemaProfile: 'legacy',
        thinkingConfig: { thinkingLevel: 'HIGH' },
        imageSettings: { format: 'jpeg', quality: 92 },
        serviceTier: 'standard'
      });

      const masterFp = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        systemInstruction: masterPrompt,
        promptText,
        promptProfile: 'master_quality',
        schema: getLeafletPageGenAiSchema('optimized'),
        schemaProfile: 'optimized',
        thinkingConfig: { thinkingLevel: 'HIGH' },
        imageSettings: { format: 'jpeg', quality: 92 },
        serviceTier: 'standard'
      });

      // Fingerprints must be distinct
      expect(legacyFp.fingerprint.systemInstructionSha256).not.toEqual(
        masterFp.fingerprint.systemInstructionSha256
      );
      expect(legacyFp.fingerprintHash).not.toEqual(masterFp.fingerprintHash);

      // Write legacy entry to cache file
      const cachePath = join(testTempDir, 'page_1_cache.json');
      const legacyEntry: GeminiCacheEntry = {
        cacheVersion: 1,
        fingerprint: legacyFp.fingerprint,
        fingerprintHash: legacyFp.fingerprintHash,
        cachedAt: new Date().toISOString(),
        usageReport: {
          pageNumber: 1,
          modelId: 'gemini-3.8-flash',
          requestedServiceTier: 'standard',
          actualServiceTier: 'standard',
          cacheHit: false,
          requestDurationMs: 1200,
          retriesCount: 0,
          usage: {
            promptTokenCount: 1500,
            candidatesTokenCount: 400,
            thoughtsTokenCount: 200,
            cachedContentTokenCount: 0,
            totalTokenCount: 2100,
            usageReported: true
          },
          cost: {
            currency: 'USD',
            modelId: 'gemini-3.8-flash',
            tier: 'standard',
            ratesApplied: {
              inputPerMillion: 0.75,
              outputPerMillion: 3.75,
              cachedInputPerMillion: 0.075
            },
            inputCostUsd: 0.001,
            outputCostUsd: 0.001,
            thinkingCostUsd: 0.0005,
            cachedInputCostUsd: 0,
            totalCostUsd: 0.0025,
            effectiveDate: '2026-11-07',
            isEstimate: true
          },
          fingerprintHash: legacyFp.fingerprintHash
        },
        rawResponse: { offers: [] },
        decodedExtraction: {
          page_number: 1,
          is_loyalty_page: false,
          loyalty_program_name: null,
          validity_start_date: null,
          validity_end_date: null,
          ignored_banners: [],
          offers: []
        }
      };

      cacheService.writeCacheEntryAtomic(cachePath, legacyEntry);

      // Verify reading with legacy fingerprint succeeds
      const hitLegacy = cacheService.readValidCacheEntry(cachePath, legacyFp.fingerprint);
      expect(hitLegacy).not.toBeNull();

      // Verify reading with master quality fingerprint FAILS (cache miss, no invalid reuse)
      const missMaster = cacheService.readValidCacheEntry(cachePath, masterFp.fingerprint);
      expect(missMaster).toBeNull();

      // Original cache file must still exist unharmed
      expect(existsSync(cachePath)).toBe(true);
    });

    it('changing thinkingLevel from HIGH to LOW invalidates cache fingerprint', () => {
      const systemInstruction = buildMasterQualityPageExtractionSystemPrompt();
      const promptText = 'Extract offers.';

      const highFp = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        systemInstruction,
        promptText,
        promptProfile: 'master_quality',
        schema: getLeafletPageGenAiSchema('optimized'),
        schemaProfile: 'optimized',
        thinkingConfig: { thinkingLevel: 'HIGH' }
      });

      const lowFp = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        systemInstruction,
        promptText,
        promptProfile: 'master_quality',
        schema: getLeafletPageGenAiSchema('optimized'),
        schemaProfile: 'optimized',
        thinkingConfig: { thinkingLevel: 'LOW' }
      });

      expect(highFp.fingerprintHash).not.toEqual(lowFp.fingerprintHash);

      const cachePath = join(testTempDir, 'page_thinking_cache.json');
      const entry: GeminiCacheEntry = {
        cacheVersion: 1,
        fingerprint: highFp.fingerprint,
        fingerprintHash: highFp.fingerprintHash,
        cachedAt: new Date().toISOString(),
        usageReport: {
          pageNumber: 1,
          modelId: 'gemini-3.8-flash',
          requestedServiceTier: 'standard',
          actualServiceTier: 'standard',
          cacheHit: false,
          requestDurationMs: 1000,
          retriesCount: 0,
          usage: {
            promptTokenCount: 1000,
            candidatesTokenCount: 200,
            thoughtsTokenCount: 50,
            cachedContentTokenCount: 0,
            totalTokenCount: 1250,
            usageReported: true
          },
          cost: {
            currency: 'USD',
            modelId: 'gemini-3.8-flash',
            tier: 'standard',
            ratesApplied: {
              inputPerMillion: 0.75,
              outputPerMillion: 3.75,
              cachedInputPerMillion: 0.075
            },
            inputCostUsd: 0.0005,
            outputCostUsd: 0.0005,
            thinkingCostUsd: 0.0001,
            cachedInputCostUsd: 0,
            totalCostUsd: 0.0011,
            effectiveDate: '2026-11-07',
            isEstimate: true
          },
          fingerprintHash: highFp.fingerprintHash
        },
        rawResponse: { offers: [] },
        decodedExtraction: {
          page_number: 1,
          is_loyalty_page: false,
          loyalty_program_name: null,
          validity_start_date: null,
          validity_end_date: null,
          ignored_banners: [],
          offers: []
        }
      };

      cacheService.writeCacheEntryAtomic(cachePath, entry);

      // Low thinking level must be a cache miss
      const readWithLow = cacheService.readValidCacheEntry(cachePath, lowFp.fingerprint);
      expect(readWithLow).toBeNull();
    });

    it('rejects corrupted or legacy historical caches lacking verifiable systemInstructionSha256', () => {
      const cachePath = join(testTempDir, 'historical_cache.json');

      const historicalEntry = {
        cacheVersion: 1,
        fingerprint: {
          imageSha256: 'some-image-hash',
          model: 'gemini-3.8-flash',
          promptSha256: 'some-prompt-hash',
          schemaSha256: 'some-schema-hash'
        },
        fingerprintHash: 'legacy-hash',
        cachedAt: new Date().toISOString(),
        rawResponse: { offers: [] },
        decodedExtraction: { offers: [] }
      };

      writeFileSync(cachePath, JSON.stringify(historicalEntry, null, 2));

      const queryFingerprint = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        systemInstruction: buildMasterQualityPageExtractionSystemPrompt(),
        promptText: 'Analyze page.',
        schema: getLeafletPageGenAiSchema('optimized'),
        thinkingConfig: { thinkingLevel: 'HIGH' }
      });

      const result = cacheService.readValidCacheEntry(cachePath, queryFingerprint.fingerprint);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // 4. Verbatim rawResponseText & Response Preservation in GeminiExtractionService
  // =========================================================================
  describe('4. Verbatim rawResponseText & Schema Profile Execution', () => {
    it('returns exact verbatim rawResponseText and parsed rawResponse on fresh extraction and on cache hit', async () => {
      const extractionService = new GeminiExtractionService();
      const mockRawJson = JSON.stringify({
        offers: [
          {
            n: 1,
            ar: 'حليب نادك طويل الأجل ١ لتر',
            en: 'Nadec UHT Milk 1L',
            b: 'Nadec',
            m: false,
            grp: null,
            p: 4.5,
            op: 6.0,
            sz: '1L',
            ut: 'Each / للحبة',
            pq: 1,
            ev: 1,
            eu: 'l',
            u_sz: true,
            c: 0.99,
            b2d: {
              g: [100, 100, 300, 300],
              p: [310, 100, 350, 180],
              r: [310, 190, 350, 250],
              u: [310, 260, 350, 300],
              t: [70, 100, 95, 300]
            }
          }
        ]
      });

      const options = {
        imagePath: testImagePath,
        pageNumber: 1,
        outputDir: testTempDir,
        promptProfile: 'master_quality' as LeafletPromptProfile,
        schemaProfile: 'optimized' as LeafletSchemaProfile,
        mockResponse: {
          text: mockRawJson,
          modelVersion: 'gemini-3.8-flash-test',
          usageMetadata: {
            promptTokenCount: 1200,
            candidatesTokenCount: 180,
            thoughtsTokenCount: 120,
            totalTokenCount: 1500
          }
        }
      };

      // 1. Fresh extraction
      const freshResult = await extractionService.extractLeafletPage(options);

      expect(freshResult.cacheHit).toBe(false);
      expect(freshResult.rawResponseText).toBe(mockRawJson);
      expect(freshResult.rawResponse).toBeDefined();
      expect((freshResult.rawResponse as any).offers).toHaveLength(1);
      expect(freshResult.offers).toHaveLength(1);
      expect(freshResult.offers[0].arabic_title).toBe('حليب نادك طويل الأجل ١ لتر');
      expect(freshResult.usageReport?.promptProfile).toBe('master_quality');
      expect(freshResult.usageReport?.schemaProfile).toBe('optimized');

      // 2. Cache hit extraction
      const cachedResult = await extractionService.extractLeafletPage(options);

      expect(cachedResult.cacheHit).toBe(true);
      expect(cachedResult.rawResponseText).toBe(mockRawJson);
      expect(cachedResult.rawResponse).toBeDefined();
      expect(cachedResult.offers).toHaveLength(1);
      expect(cachedResult.offers[0].english_title).toBe('Nadec UHT Milk 1L');
      expect(cachedResult.usageReport?.cacheHit).toBe(true);
      expect(cachedResult.usageReport?.cost.totalCostUsd).toBe(0);
    });

    it('defaults to legacy prompt and legacy schema when unspecified, preserving zero regression', async () => {
      const extractionService = new GeminiExtractionService();
      const mockLegacyJson = JSON.stringify({
        is_loyalty_page: false,
        loyalty_program_name: null,
        validity_start_date: null,
        validity_end_date: null,
        ignored_banners: [],
        offers: [
          {
            offer_number: 1,
            arabic_title: 'أرز بسمتي الشعلان ١٠ كجم',
            english_title: 'Al Shalan Basmati Rice 10kg',
            brand: 'Al Shalan',
            is_multi_brand_or_variant: false,
            promo_price: 69.95,
            original_price: 89.0,
            size_value: '10kg',
            unit_type: 'Per Bag / للكيس',
            pack_quantity: 1,
            each_size_value: 10,
            each_size_unit: 'kg',
            is_uniform_size_across_variants: true,
            promo_condition: null,
            confidence: 0.98,
            components: {
              product_graphic_box: [100, 100, 400, 400],
              promo_price_box: [410, 100, 450, 200],
              original_price_box: [410, 210, 450, 300],
              unit_and_size_badge_box: [410, 310, 450, 400],
              title_text_box: [50, 100, 90, 400]
            }
          }
        ]
      });

      const options = {
        imagePath: testImagePath,
        pageNumber: 2,
        outputDir: testTempDir,
        // No promptProfile or schemaProfile specified
        mockResponse: {
          text: mockLegacyJson,
          modelVersion: 'gemini-3.8-flash-test',
          usageMetadata: {
            promptTokenCount: 2200,
            candidatesTokenCount: 450,
            thoughtsTokenCount: 150,
            totalTokenCount: 2800
          }
        }
      };

      const result = await extractionService.extractLeafletPage(options);

      expect(result.usageReport?.promptProfile).toBe('legacy');
      expect(result.usageReport?.schemaProfile).toBe('legacy');
      expect(result.offers[0].brand).toBe('Al Shalan');
      expect(result.offers[0].promo_price).toBe(69.95);
    });

    it('safely handles operator cancellation without hanging or unhandled rejection', async () => {
      const extractionService = new GeminiExtractionService();
      const abortController = new AbortController();

      const options = {
        imagePath: testImagePath,
        pageNumber: 3,
        signal: abortController.signal,
        mockResponse: async () => {
          // Delay simulating network call
          await new Promise(r => setTimeout(r, 200));
          return { text: '{}' };
        }
      };

      // Abort immediately
      abortController.abort();

      await expect(extractionService.extractLeafletPage(options)).rejects.toThrow(
        'REQUEST_CANCELLED: Operation was cancelled by operator.'
      );
    });
  });
});
