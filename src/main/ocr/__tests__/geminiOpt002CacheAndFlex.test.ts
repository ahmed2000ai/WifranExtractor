import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  GeminiExtractionCacheService,
  sharedGeminiExtractionCacheService
} from '../geminiExtractionCacheService';
import {
  calculateGeminiCost,
  getModelPricing,
  aggregateJobUsage
} from '../geminiPricingTable';
import { GeminiExtractionService } from '../geminiExtractionService';
import type { GeminiPageUsageReport } from '../geminiCacheTypes';
import type { LeafletPageExtractionRev1 } from '../../../shared/types/leafletExtraction';
import sharp from 'sharp';

describe('WIFRAN-EXTRACTOR-GEMINI-OPT-002: Cache, Flex Inference & Actual Token Metering', () => {
  let testTempDir: string;
  let testImagePath: string;
  let testImageBuffer: Buffer;

  beforeEach(async () => {
    testTempDir = join(tmpdir(), `wifran-opt002-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(testTempDir, { recursive: true });

    testImagePath = join(testTempDir, 'test_page_1.jpg');
    // Generate valid 100x100 jpeg image
    testImageBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .jpeg()
      .toBuffer();
    writeFileSync(testImagePath, testImageBuffer);
  });

  afterEach(() => {
    if (existsSync(testTempDir)) {
      rmSync(testTempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  const sampleExtraction: LeafletPageExtractionRev1 = {
    is_loyalty_page: false,
    loyalty_program_name: null,
    validity_start_date: '2026-11-01',
    validity_end_date: '2026-11-07',
    ignored_banners: [],
    offers: [
      {
        offer_number: 1,
        original_price: 25.5,
        promo_price: 19.95,
        unit_type: 'pack',
        english_title: 'Nestle Pure Life 40x330ml',
        arabic_title: 'مياه نستله بيور لايف 40*330 مل',
        brand: 'Nestle',
        is_multi_brand_or_variant: false,
        item_domain: 'grocery',
        size_value: '40x330ml',
        pack_quantity: 40,
        each_size_value: 330,
        each_size_unit: 'ml',
        is_uniform_size_across_variants: true,
        promo_condition: null,
        quantity_limit: '2',
        confidence: 0.95,
        components: {
          product_graphic_box: [100, 100, 300, 300],
          promo_price_box: [100, 310, 200, 360],
          original_price_box: null,
          unit_and_size_badge_box: null,
          title_text_box: null
        }
      }
    ]
  };

  describe('1. Deterministic Local Gemini Cache & Fingerprinting', () => {
    it('produces identical fingerprints for identical inputs', () => {
      const res1 = sharedGeminiExtractionCacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Extract offers from this page',
        promptVersion: 'legacy',
        schema: { type: 'object' },
        schemaVersion: 'legacy',
        thinkingConfig: { thinkingLevel: 'high' }
      });

      const res2 = sharedGeminiExtractionCacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Extract offers from this page',
        promptVersion: 'legacy',
        schema: { type: 'object' },
        schemaVersion: 'legacy',
        thinkingConfig: { thinkingLevel: 'high' }
      });

      expect(res1.fingerprintHash).toBe(res2.fingerprintHash);
      expect(res1.fingerprint.imageSha256).toBe(res2.fingerprint.imageSha256);
      expect(res1.fingerprint.promptSha256).toBe(res2.fingerprint.promptSha256);
      expect(res1.fingerprint.schemaSha256).toBe(res2.fingerprint.schemaSha256);
    });

    it('invalidates fingerprint when image buffer changes', () => {
      const img1 = Buffer.from('page-1-image-bytes-original');
      const img2 = Buffer.from('page-1-image-bytes-different');
      const base = {
        model: 'gemini-3.8-flash',
        promptText: 'Extract offers',
        promptVersion: 'legacy' as const,
        schema: {},
        schemaVersion: 'legacy' as const,
        thinkingConfig: {}
      };

      const res1 = sharedGeminiExtractionCacheService.computeFingerprint({ ...base, imageBuffer: img1 });
      const res2 = sharedGeminiExtractionCacheService.computeFingerprint({ ...base, imageBuffer: img2 });

      expect(res1.fingerprintHash).not.toBe(res2.fingerprintHash);
      expect(res1.fingerprint.imageSha256).not.toBe(res2.fingerprint.imageSha256);
    });

    it('invalidates fingerprint when model changes', () => {
      const base = {
        imageBuffer: testImageBuffer,
        promptText: 'Extract offers',
        promptVersion: 'legacy' as const,
        schema: {},
        schemaVersion: 'legacy' as const,
        thinkingConfig: {}
      };

      const res1 = sharedGeminiExtractionCacheService.computeFingerprint({ ...base, model: 'gemini-3.8-flash' });
      const res2 = sharedGeminiExtractionCacheService.computeFingerprint({ ...base, model: 'gemini-4-argon' });

      expect(res1.fingerprintHash).not.toBe(res2.fingerprintHash);
      expect(res1.fingerprint.model).toBe('gemini-3.8-flash');
      expect(res2.fingerprint.model).toBe('gemini-4-argon');
    });

    it('invalidates fingerprint when prompt changes', () => {
      const base = {
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptVersion: 'legacy' as const,
        schema: {},
        schemaVersion: 'legacy' as const,
        thinkingConfig: {}
      };

      const res1 = sharedGeminiExtractionCacheService.computeFingerprint({ ...base, promptText: 'Prompt A' });
      const res2 = sharedGeminiExtractionCacheService.computeFingerprint({ ...base, promptText: 'Prompt B' });

      expect(res1.fingerprintHash).not.toBe(res2.fingerprintHash);
      expect(res1.fingerprint.promptSha256).not.toBe(res2.fingerprint.promptSha256);
    });

    it('invalidates fingerprint on diagnostic retry context', () => {
      const base = {
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Extract offers',
        promptVersion: 'legacy' as const,
        schema: {},
        schemaVersion: 'legacy' as const,
        thinkingConfig: {}
      };

      const resPrimary = sharedGeminiExtractionCacheService.computeFingerprint(base);
      const resRetry = sharedGeminiExtractionCacheService.computeFingerprint({
        ...base,
        isDiagnosticRetry: true,
        failureReasons: ['Audit flagged missing offers in quadrant 2']
      });

      expect(resPrimary.fingerprintHash).not.toBe(resRetry.fingerprintHash);
      expect(resRetry.fingerprint.isDiagnosticRetry).toBe(true);
    });

    it('atomically writes and safely reads valid cache entry', () => {
      const cacheService = new GeminiExtractionCacheService();
      const { fingerprint, fingerprintHash } = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Prompt',
        promptVersion: 'legacy',
        schema: {},
        schemaVersion: 'legacy',
        thinkingConfig: {}
      });

      const usageReport: GeminiPageUsageReport = {
        pageNumber: 1,
        modelId: 'gemini-3.8-flash',
        requestedServiceTier: 'standard',
        actualServiceTier: 'standard',
        cacheHit: false,
        requestDurationMs: 1250,
        retriesCount: 0,
        usage: {
          promptTokenCount: 1500,
          candidatesTokenCount: 600,
          thoughtsTokenCount: 200,
          cachedContentTokenCount: 0,
          totalTokenCount: 2300,
          usageReported: true
        },
        cost: {
          currency: 'USD',
          effectiveDate: '2026-11-07',
          modelId: 'gemini-3.8-flash',
          tier: 'standard',
          ratesApplied: {
            inputPerMillion: 0.75,
            outputPerMillion: 3.75,
            cachedInputPerMillion: 0.075
          },
          inputCostUsd: 0.001125,
          outputCostUsd: 0.00225,
          thinkingCostUsd: 0.00075,
          cachedInputCostUsd: 0,
          totalCostUsd: 0.004125,
          isEstimate: true
        },
        fingerprintHash
      };

      const cacheFilePath = join(testTempDir, 'raw_extracted_page_1.json');
      cacheService.writeCacheEntryAtomic(cacheFilePath, {
        cacheVersion: 1,
        fingerprint,
        fingerprintHash,
        cachedAt: new Date().toISOString(),
        usageReport,
        rawResponse: { raw: 'json' },
        decodedExtraction: sampleExtraction
      });

      expect(existsSync(cacheFilePath)).toBe(true);

      const hit = cacheService.readValidCacheEntry(cacheFilePath, fingerprint);
      expect(hit).not.toBeNull();
      expect(hit?.decodedExtraction.offers.length).toBe(1);
      expect(hit?.usageReport.cost.totalCostUsd).toBe(0.004125);
    });

    it('rejects corrupted or truncated JSON in cache file', () => {
      const cacheService = new GeminiExtractionCacheService();
      const cacheFilePath = join(testTempDir, 'raw_extracted_page_1.json');
      writeFileSync(cacheFilePath, '{ "truncated": true, "fingerprint": ', 'utf8');

      const { fingerprint } = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Prompt',
        promptVersion: 'legacy',
        schema: {},
        schemaVersion: 'legacy',
        thinkingConfig: {}
      });

      const hit = cacheService.readValidCacheEntry(cacheFilePath, fingerprint);
      expect(hit).toBeNull();
    });

    it('rejects cache file when fingerprint mismatches', () => {
      const cacheService = new GeminiExtractionCacheService();
      const { fingerprint, fingerprintHash } = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Prompt A',
        promptVersion: 'legacy',
        schema: {},
        schemaVersion: 'legacy',
        thinkingConfig: {}
      });

      const usageReport: GeminiPageUsageReport = {
        modelId: 'gemini-3.8-flash',
        requestedServiceTier: 'standard',
        actualServiceTier: 'standard',
        cacheHit: false,
        requestDurationMs: 500,
        retriesCount: 0,
        usage: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          thoughtsTokenCount: 0,
          cachedContentTokenCount: 0,
          totalTokenCount: 150,
          usageReported: true
        },
        cost: {
          currency: 'USD',
          effectiveDate: '2026-11-07',
          modelId: 'gemini-3.8-flash',
          tier: 'standard',
          ratesApplied: {
            inputPerMillion: 0.75,
            outputPerMillion: 3.75,
            cachedInputPerMillion: 0.075
          },
          inputCostUsd: 0.000075,
          outputCostUsd: 0.0001875,
          thinkingCostUsd: 0,
          cachedInputCostUsd: 0,
          totalCostUsd: 0.0002625,
          isEstimate: true
        },
        fingerprintHash
      };

      const cacheFilePath = join(testTempDir, 'raw_extracted_page_1.json');
      cacheService.writeCacheEntryAtomic(cacheFilePath, {
        cacheVersion: 1,
        fingerprint,
        fingerprintHash,
        cachedAt: new Date().toISOString(),
        usageReport,
        rawResponse: {},
        decodedExtraction: sampleExtraction
      });

      // Now query with different expected fingerprint (e.g. Prompt B)
      const { fingerprint: changedFingerprint } = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Prompt B - CHANGED',
        promptVersion: 'legacy',
        schema: {},
        schemaVersion: 'legacy',
        thinkingConfig: {}
      });

      const hit = cacheService.readValidCacheEntry(cacheFilePath, changedFingerprint);
      expect(hit).toBeNull();
    });

    it('rejects cache file when decodedExtraction has invalid or out-of-bounds coordinates', () => {
      const cacheService = new GeminiExtractionCacheService();
      const { fingerprint, fingerprintHash } = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Prompt',
        promptVersion: 'legacy',
        schema: {},
        schemaVersion: 'legacy',
        thinkingConfig: {}
      });

      const invalidExtraction: any = {
        is_loyalty_page: false,
        offers: [
          {
            offer_number: 1,
            promo_price: 10,
            english_title: 'Valid Title',
            arabic_title: 'عنوان صالح',
            components: {
              // Invalid: xmax is 1500 (> 1000)
              product_graphic_box: [100, 100, 300, 1500],
              promo_price_box: [100, 310, 200, 360]
            }
          }
        ]
      };

      const cacheFilePath = join(testTempDir, 'raw_extracted_page_invalid_coords.json');
      cacheService.writeCacheEntryAtomic(cacheFilePath, {
        cacheVersion: 1,
        fingerprint,
        fingerprintHash,
        cachedAt: new Date().toISOString(),
        usageReport: {} as any,
        rawResponse: {},
        decodedExtraction: invalidExtraction
      });

      const hit = cacheService.readValidCacheEntry(cacheFilePath, fingerprint);
      expect(hit).toBeNull();
    });

    it('rejects cache file when decodedExtraction has negative promo price', () => {
      const cacheService = new GeminiExtractionCacheService();
      const { fingerprint, fingerprintHash } = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Prompt',
        promptVersion: 'legacy',
        schema: {},
        schemaVersion: 'legacy',
        thinkingConfig: {}
      });

      const invalidExtraction: any = {
        is_loyalty_page: false,
        offers: [
          {
            offer_number: 1,
            promo_price: -5.0, // Invalid negative price
            english_title: 'Valid Title',
            components: {
              product_graphic_box: [100, 100, 300, 300],
              promo_price_box: [100, 310, 200, 360]
            }
          }
        ]
      };

      const cacheFilePath = join(testTempDir, 'raw_extracted_page_negative_price.json');
      cacheService.writeCacheEntryAtomic(cacheFilePath, {
        cacheVersion: 1,
        fingerprint,
        fingerprintHash,
        cachedAt: new Date().toISOString(),
        usageReport: {} as any,
        rawResponse: {},
        decodedExtraction: invalidExtraction
      });

      const hit = cacheService.readValidCacheEntry(cacheFilePath, fingerprint);
      expect(hit).toBeNull();
    });

    it('rejects cache file when decodedExtraction is missing titles', () => {
      const cacheService = new GeminiExtractionCacheService();
      const { fingerprint, fingerprintHash } = cacheService.computeFingerprint({
        imageBuffer: testImageBuffer,
        model: 'gemini-3.8-flash',
        promptText: 'Prompt',
        promptVersion: 'legacy',
        schema: {},
        schemaVersion: 'legacy',
        thinkingConfig: {}
      });

      const invalidExtraction: any = {
        is_loyalty_page: false,
        offers: [
          {
            offer_number: 1,
            promo_price: 10.0,
            english_title: '',
            arabic_title: '   ', // Empty titles
            components: {
              product_graphic_box: [100, 100, 300, 300],
              promo_price_box: [100, 310, 200, 360]
            }
          }
        ]
      };

      const cacheFilePath = join(testTempDir, 'raw_extracted_page_missing_titles.json');
      cacheService.writeCacheEntryAtomic(cacheFilePath, {
        cacheVersion: 1,
        fingerprint,
        fingerprintHash,
        cachedAt: new Date().toISOString(),
        usageReport: {} as any,
        rawResponse: {},
        decodedExtraction: invalidExtraction
      });

      const hit = cacheService.readValidCacheEntry(cacheFilePath, fingerprint);
      expect(hit).toBeNull();
    });

    it('readLegacyRawEvidence safely reads historical un-enveloped raw extraction JSON', () => {
      const cacheService = new GeminiExtractionCacheService();
      const legacyRawPath = join(testTempDir, 'legacy_raw_evidence.json');
      const legacyRawData = {
        offers: [
          {
            offer_number: 1,
            promo_price: 12.5,
            english_title: 'Historical Item',
            arabic_title: 'صنف تاريخي'
          }
        ]
      };
      writeFileSync(legacyRawPath, JSON.stringify(legacyRawData, null, 2), 'utf8');

      const evidence = cacheService.readLegacyRawEvidence(legacyRawPath);
      expect(evidence).not.toBeNull();
      expect(evidence.offers.length).toBe(1);
      expect(evidence.offers[0].english_title).toBe('Historical Item');
    });
  });

  describe('2. In-Flight Request Deduplication', () => {
    it('deduplicates simultaneous concurrent calls sharing the same fingerprint', async () => {
      const cacheService = new GeminiExtractionCacheService();
      let callCount = 0;

      const mockOperation = async () => {
        callCount++;
        await new Promise(r => setTimeout(r, 50));
        return { result: 'ok', counter: callCount };
      };

      // Fire 3 simultaneous concurrent promises for fingerprint "fp-hash-123"
      const [r1, r2, r3] = await Promise.all([
        cacheService.executeWithDeduplication('fp-hash-123', mockOperation),
        cacheService.executeWithDeduplication('fp-hash-123', mockOperation),
        cacheService.executeWithDeduplication('fp-hash-123', mockOperation)
      ]);

      // Exactly 1 underlying invocation
      expect(callCount).toBe(1);
      expect(r1).toEqual({ result: 'ok', counter: 1 });
      expect(r2).toEqual({ result: 'ok', counter: 1 });
      expect(r3).toEqual({ result: 'ok', counter: 1 });
    });
  });

  describe('3. Pricing Table and Token Cost Calculations', () => {
    it('provides correct published pricing rates for Gemini 3.8 Flash (Effective Nov 7, 2026)', () => {
      const standardRates = getModelPricing('gemini-3.8-flash', 'standard', '2026-11-07');
      const flexRates = getModelPricing('gemini-3.8-flash', 'flex', '2026-11-07');

      expect(standardRates.effectiveDate).toBe('2026-11-07');
      expect(standardRates.inputPerMillion).toBe(0.75);
      expect(standardRates.outputPerMillion).toBe(3.75);
      expect(standardRates.thinkingPerMillion).toBe(3.75);
      expect(standardRates.cachedInputPerMillion).toBe(0.075);

      // Flex is 50% discount
      expect(flexRates.effectiveDate).toBe('2026-11-07');
      expect(flexRates.inputPerMillion).toBe(0.375);
      expect(flexRates.outputPerMillion).toBe(1.875);
      expect(flexRates.thinkingPerMillion).toBe(1.875);
      expect(flexRates.cachedInputPerMillion).toBe(0.0375);
    });

    it('provides correct future pricing rates for Gemini 3.8 Flash (Beginning Jan 1, 2027)', () => {
      const standardRates = getModelPricing('gemini-3.8-flash', 'standard', '2027-01-01');
      const flexRates = getModelPricing('gemini-3.8-flash', 'flex', '2027-01-01');

      expect(standardRates.effectiveDate).toBe('2027-01-01');
      expect(standardRates.inputPerMillion).toBe(1.50);
      expect(standardRates.outputPerMillion).toBe(7.50);
      expect(standardRates.thinkingPerMillion).toBe(7.50);
      expect(standardRates.cachedInputPerMillion).toBe(0.15);

      expect(flexRates.effectiveDate).toBe('2027-01-01');
      expect(flexRates.inputPerMillion).toBe(0.75);
      expect(flexRates.outputPerMillion).toBe(3.75);
      expect(flexRates.thinkingPerMillion).toBe(3.75);
      expect(flexRates.cachedInputPerMillion).toBe(0.075);
    });

    it('calculates exact example from Mandatory Addendum (Standard $0.0045, Flex $0.00225)', () => {
      // Input: 1,500 uncached tokens, 600 candidate tokens, 300 thinking tokens, 0 cached tokens
      const standardCost = calculateGeminiCost(
        {
          promptTokenCount: 1500,
          cachedContentTokenCount: 0,
          candidatesTokenCount: 600,
          thoughtsTokenCount: 300
        },
        'gemini-3.8-flash',
        'standard',
        '2026-11-07'
      );

      // (1500 × 0.75 + 900 × 3.75) / 1,000,000 = (1125 + 3375) / 1,000,000 = 0.0045
      expect(standardCost.inputCostUsd).toBeCloseTo(0.001125, 6);
      expect(standardCost.outputCostUsd).toBeCloseTo(0.00225, 6);
      expect(standardCost.thinkingCostUsd).toBeCloseTo(0.001125, 6);
      expect(standardCost.totalCostUsd).toBeCloseTo(0.0045, 6);
      expect(standardCost.isEstimate).toBe(true);
      expect(standardCost.metadataMissing).toBe(false);

      const flexCost = calculateGeminiCost(
        {
          promptTokenCount: 1500,
          cachedContentTokenCount: 0,
          candidatesTokenCount: 600,
          thoughtsTokenCount: 300
        },
        'gemini-3.8-flash',
        'flex',
        '2026-11-07'
      );

      // (1500 × 0.375 + 900 × 1.875) / 1,000,000 = (562.5 + 1687.5) / 1,000,000 = 0.00225
      expect(flexCost.inputCostUsd).toBeCloseTo(0.0005625, 6);
      expect(flexCost.outputCostUsd).toBeCloseTo(0.001125, 6);
      expect(flexCost.thinkingCostUsd).toBeCloseTo(0.0005625, 6);
      expect(flexCost.totalCostUsd).toBeCloseTo(0.00225, 6);
    });

    it('correctly treats cachedContentTokenCount as a subset of promptTokenCount', () => {
      // 2000 total prompt tokens, 1000 of which are cached
      const cost = calculateGeminiCost(
        {
          promptTokenCount: 2000,
          cachedContentTokenCount: 1000,
          candidatesTokenCount: 1000,
          thoughtsTokenCount: 0
        },
        'gemini-3.8-flash',
        'standard',
        '2026-11-07'
      );

      // Uncached input: 1000 * 0.75 / 1M = 0.00075
      // Cached input:   1000 * 0.075 / 1M = 0.000075
      // Output:         1000 * 3.75 / 1M = 0.00375
      // Total: 0.00075 + 0.000075 + 0.00375 = 0.004575
      expect(cost.inputCostUsd).toBeCloseTo(0.00075, 6);
      expect(cost.cachedInputCostUsd).toBeCloseTo(0.000075, 6);
      expect(cost.outputCostUsd).toBeCloseTo(0.00375, 6);
      expect(cost.totalCostUsd).toBeCloseTo(0.004575, 6);
    });

    it('handles missing provider metadata safely without fabricating costs', () => {
      const missing = calculateGeminiCost(
        {},
        'gemini-3.8-flash',
        'standard',
        '2026-11-07'
      );

      expect(missing.metadataMissing).toBe(true);
      expect(missing.totalCostUsd).toBe(0);
      expect(missing.isEstimate).toBe(true);
    });

    it('aggregates multi-page job reports accurately into GeminiJobUsageSummary', () => {
      const page1: GeminiPageUsageReport = {
        pageNumber: 1,
        modelId: 'gemini-3.8-flash',
        requestedServiceTier: 'standard',
        actualServiceTier: 'standard',
        cacheHit: false,
        requestDurationMs: 1100,
        retriesCount: 0,
        usage: {
          promptTokenCount: 2000,
          candidatesTokenCount: 500,
          thoughtsTokenCount: 200,
          cachedContentTokenCount: 0,
          totalTokenCount: 2700,
          usageReported: true
        },
        cost: {
          currency: 'USD',
          effectiveDate: '2026-11-07',
          modelId: 'gemini-3.8-flash',
          tier: 'standard',
          ratesApplied: {
            inputPerMillion: 0.75,
            outputPerMillion: 3.75,
            cachedInputPerMillion: 0.075
          },
          inputCostUsd: 0.0015,
          outputCostUsd: 0.001875,
          thinkingCostUsd: 0.00075,
          cachedInputCostUsd: 0,
          totalCostUsd: 0.004125,
          isEstimate: true
        },
        fingerprintHash: 'hash-page-1'
      };

      const page2: GeminiPageUsageReport = {
        pageNumber: 2,
        modelId: 'gemini-3.8-flash',
        requestedServiceTier: 'standard',
        actualServiceTier: 'standard',
        cacheHit: true, // Cache hit!
        requestDurationMs: 5,
        retriesCount: 0,
        usage: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
          thoughtsTokenCount: 0,
          cachedContentTokenCount: 0,
          totalTokenCount: 0,
          usageReported: true
        },
        cost: {
          currency: 'USD',
          effectiveDate: '2026-11-07',
          modelId: 'gemini-3.8-flash',
          tier: 'standard',
          ratesApplied: {
            inputPerMillion: 0.75,
            outputPerMillion: 3.75,
            cachedInputPerMillion: 0.075
          },
          inputCostUsd: 0,
          outputCostUsd: 0,
          thinkingCostUsd: 0,
          cachedInputCostUsd: 0,
          totalCostUsd: 0,
          isEstimate: true
        },
        fingerprintHash: 'hash-page-2'
      };

      const summary = aggregateJobUsage([page1, page2], 2);

      expect(summary.totalPages).toBe(2);
      expect(summary.processedPages).toBe(2);
      expect(summary.apiCallsCount).toBe(1);
      expect(summary.cacheHitsCount).toBe(1);
      expect(summary.totalPromptTokens).toBe(2000);
      expect(summary.totalCandidatesTokens).toBe(500);
      expect(summary.totalThoughtsTokens).toBe(200);
      expect(summary.totalCostUsd).toBe(0.004125);
      expect(summary.serviceTiersUsed.standard).toBe(2);
    });
  });

  describe('4. Extraction Service Cache Hit & Re-extraction Integration', () => {
    it('returns cache hit with zero API cost when valid cache file exists', async () => {
      const service = new GeminiExtractionService();

      // First run: populate cache using mockResponse
      const firstRun = await service.extractLeafletPage({
        imagePath: testImagePath,
        outputDir: testTempDir,
        pageNumber: 1,
        schemaVersion: 'legacy',
        forceReextract: true,
        mockResponse: sampleExtraction
      });

      expect(firstRun.cacheHit).toBe(false);
      expect(firstRun.offers.length).toBe(1);

      // Second run: same inputs, forceReextract=false -> must hit cache
      const secondRun = await service.extractLeafletPage({
        imagePath: testImagePath,
        outputDir: testTempDir,
        pageNumber: 1,
        schemaVersion: 'legacy',
        forceReextract: false
      });

      expect(secondRun.cacheHit).toBe(true);
      expect(secondRun.usageReport?.cacheHit).toBe(true);
      expect(secondRun.usageReport?.cost.totalCostUsd).toBe(0);
      expect(secondRun.usageReport?.usage.totalTokenCount).toBe(0);
      expect(secondRun.offers.length).toBe(1);
    });

    it('bypasses cache when forceReextract is true', async () => {
      const service = new GeminiExtractionService();

      const mockFreshExtraction: LeafletPageExtractionRev1 = {
        is_loyalty_page: false,
        loyalty_program_name: null,
        validity_start_date: null,
        validity_end_date: null,
        ignored_banners: [],
        offers: [
          {
            offer_number: 99,
            original_price: null,
            promo_price: 15.0,
            unit_type: 'each',
            english_title: 'Fresh Re-extracted Item',
            arabic_title: 'صنف معاد استخراجه',
            brand: null,
            is_multi_brand_or_variant: false,
            item_domain: 'grocery',
            size_value: '1L',
            pack_quantity: 1,
            each_size_value: 1,
            each_size_unit: 'l',
            is_uniform_size_across_variants: undefined,
            promo_condition: null,
            quantity_limit: null,
            confidence: 0.95,
            components: {
              product_graphic_box: [10, 10, 50, 50],
              promo_price_box: [10, 55, 30, 70],
              original_price_box: null,
              unit_and_size_badge_box: null,
              title_text_box: null
            }
          }
        ]
      };

      const result = await service.extractLeafletPage({
        imagePath: testImagePath,
        outputDir: testTempDir,
        pageNumber: 1,
        schemaVersion: 'legacy',
        forceReextract: true,
        mockResponse: mockFreshExtraction
      });

      expect(result.cacheHit).toBe(false);
      expect(result.offers[0].offer_number).toBe(99);
      expect(result.offers[0].english_title).toBe('Fresh Re-extracted Item');
    });
  });

  describe('5. Flex Inference, Timeouts & Strict Fallback Safeguards', () => {
    it('sets serviceTier: "flex" on SDK call when executionMode is flex', async () => {
      let capturedConfig: any = null;
      const fakeAiClient: any = {
        models: {
          generateContent: vi.fn().mockImplementation(async (opts: any) => {
            capturedConfig = opts.config;
            return {
              text: JSON.stringify(sampleExtraction),
              usageMetadata: {
                promptTokenCount: 1000,
                candidatesTokenCount: 400,
                thoughtsTokenCount: 200,
                totalTokenCount: 1600
              }
            };
          })
        }
      };

      const service = new GeminiExtractionService(undefined, fakeAiClient);

      const result = await service.extractLeafletPage({
        imagePath: testImagePath,
        outputDir: testTempDir,
        pageNumber: 1,
        executionMode: 'flex',
        forceReextract: true
      });

      expect(capturedConfig.serviceTier).toBe('flex');
      expect(result.usageReport?.requestedServiceTier).toBe('flex');
      expect(result.usageReport?.actualServiceTier).toBe('flex');
      expect(result.usageReport?.cost.tier).toBe('flex');
    });

    it('sets serviceTier: "standard" on SDK call when executionMode is standard', async () => {
      let capturedConfig: any = null;
      const fakeAiClient: any = {
        models: {
          generateContent: vi.fn().mockImplementation(async (opts: any) => {
            capturedConfig = opts.config;
            return {
              text: JSON.stringify(sampleExtraction),
              usageMetadata: {
                promptTokenCount: 1000,
                candidatesTokenCount: 400,
                thoughtsTokenCount: 200,
                totalTokenCount: 1600
              }
            };
          })
        }
      };

      const service = new GeminiExtractionService(undefined, fakeAiClient);

      const result = await service.extractLeafletPage({
        imagePath: testImagePath,
        outputDir: testTempDir,
        pageNumber: 1,
        executionMode: 'standard',
        forceReextract: true
      });

      expect(capturedConfig.serviceTier).toBe('standard');
      expect(result.usageReport?.requestedServiceTier).toBe('standard');
      expect(result.usageReport?.actualServiceTier).toBe('standard');
    });

    it('NEVER silently falls back from Flex to Standard on timeout or failure', async () => {
      const fakeAiClient: any = {
        models: {
          generateContent: vi.fn().mockImplementation(async () => {
            const err: any = new Error('Flex tier capacity unavailable: 503 Service Unavailable');
            err.status = 503;
            throw err;
          })
        }
      };

      const service = new GeminiExtractionService(undefined, fakeAiClient);

      // With maxRetries=1 to fail quickly
      await expect(
        service.extractLeafletPage({
          imagePath: testImagePath,
          outputDir: testTempDir,
          pageNumber: 1,
          executionMode: 'flex',
          forceReextract: true,
          maxRetries: 1
        })
      ).rejects.toThrow(/Flex tier capacity unavailable|503/i);

      // Verify that generateContent was called with flex, never downgraded to standard
      for (const call of fakeAiClient.models.generateContent.mock.calls) {
        expect(call[0].config.serviceTier).toBe('flex');
      }
    });

    it('retries transient 429/503 errors with exponential backoff and tracks retriesCount', async () => {
      let callCount = 0;
      const fakeAiClient: any = {
        models: {
          generateContent: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount < 3) {
              const err: any = new Error('Resource exhausted (429 Rate limit exceeded)');
              err.status = 429;
              throw err;
            }
            return {
              text: JSON.stringify(sampleExtraction),
              usageMetadata: {
                promptTokenCount: 1000,
                candidatesTokenCount: 500,
                totalTokenCount: 1500
              }
            };
          })
        }
      };

      const service = new GeminiExtractionService(undefined, fakeAiClient);

      const progressEvents: string[] = [];
      const result = await service.extractLeafletPage({
        imagePath: testImagePath,
        outputDir: testTempDir,
        pageNumber: 1,
        executionMode: 'standard',
        forceReextract: true,
        maxRetries: 3,
        initialRetryDelayMs: 20,
        onProgress: (p) => progressEvents.push(`${p.state}:${p.attempt || 1}`)
      });

      expect(callCount).toBe(3);
      expect(result.usageReport?.retriesCount).toBe(2);
      expect(progressEvents.some(e => e.startsWith('retrying:'))).toBe(true);
      expect(result.offers.length).toBe(1);
    }, 10000);

    it('stops safely without retrying when provider Retry-After interval exceeds maxRetryWaitMs', async () => {
      let callCount = 0;
      const fakeAiClient: any = {
        models: {
          generateContent: vi.fn().mockImplementation(async () => {
            callCount++;
            const err: any = new Error('Resource exhausted: Please retry after 120 seconds');
            err.status = 429;
            throw err;
          })
        }
      };

      const service = new GeminiExtractionService(undefined, fakeAiClient);

      await expect(
        service.extractLeafletPage({
          imagePath: testImagePath,
          outputDir: testTempDir,
          pageNumber: 1,
          executionMode: 'standard',
          forceReextract: true,
          maxRetries: 3,
          maxRetryWaitMs: 30000 // 30s max wait deadline; 120s must trigger safe stop
        })
      ).rejects.toThrow(/RETRY_AFTER_EXCEEDED/i);

      // Must have stopped immediately after 1 attempt without retrying
      expect(callCount).toBe(1);
    });

    it('preserves condition omission semantics (omitted condition results in mechanic "unknown", never verified unconditional)', async () => {
      const { mapRev1OfferToCanonical } = await import('../../page-first/pageOfferCanonicalMapper');

      const extractedWithoutCondition = {
        offer_number: 1,
        promo_price: 10.0,
        original_price: 15.0,
        english_title: 'Unspecified Promo Item',
        arabic_title: 'صنف بدون شرط',
        brand: null,
        is_multi_brand_or_variant: false,
        size_value: '500g',
        unit_type: 'each',
        confidence: 0.95,
        promo_condition: null, // Condition omitted by optimized schema
        quantity_limit: null,
        components: {
          product_graphic_box: [100, 100, 300, 300] as [number, number, number, number],
          promo_price_box: [100, 310, 200, 360] as [number, number, number, number],
          original_price_box: null,
          unit_and_size_badge_box: null,
          title_text_box: null
        }
      };

      const canonical = mapRev1OfferToCanonical({
        offer: extractedWithoutCondition as any,
        cropRect: {
          offer_number: 1,
          union_box_px: { xmin: 0, ymin: 0, xmax: 100, ymax: 100, width: 100, height: 100 },
          product_thumb_box_px: { xmin: 0, ymin: 0, xmax: 100, ymax: 100, width: 100, height: 100 },
          offer_card_crop_path: undefined,
          product_thumb_crop_path: undefined
        },
        pageNumber: 1,
        pdfBaseName: 'test_leaflet',
        packageDir: testTempDir,
        trustedContext: {
          supermarketId: 'test-sm',
          supermarketSlug: 'carrefour',
          locationScope: 'national',
          cityId: null,
          regionId: null,
          offerStartDate: null,
          offerEndDate: null,
          leafletId: null
        }
      });

      // Crucial assertion: mechanic MUST be 'unknown', NOT 'standard_price' or 'unconditional'
      expect(canonical.promotion.mechanic).toBe('unknown');
      expect(canonical.promotion.condition_text).toBeNull();
    });
  });
});
