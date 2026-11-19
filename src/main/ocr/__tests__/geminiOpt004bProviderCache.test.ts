import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import sharp from 'sharp';
import {
  buildMasterQualityPageExtractionSystemPrompt
} from '../geminiPromptBuilder';
import {
  GeminiProviderCacheService
} from '../geminiProviderCacheService';
import {
  calculateCacheStorageCost,
  evaluateProviderCacheEconomics,
  calculateGeminiCost
} from '../geminiPricingTable';
import { GeminiExtractionService } from '../geminiExtractionService';
import type { GeminiCacheEntry } from '../../../shared/types/geminiCacheTypes';

describe('WIFRAN-EXTRACTOR-GEMINI-OPT-004B: Provider Context Caching & Quality Safeguards', () => {
  let testTempDir: string;
  let testImagePath: string;
  let testImageBuffer: Buffer;
  let providerCacheService: GeminiProviderCacheService;

  beforeEach(async () => {
    testTempDir = join(
      tmpdir(),
      `wifran-opt004b-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
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

    providerCacheService = new GeminiProviderCacheService();
  });

  afterEach(() => {
    if (existsSync(testTempDir)) {
      rmSync(testTempDir, { recursive: true, force: true });
    }
    providerCacheService.clear();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Semantic Safeguards in Master Quality Prompt
  // =========================================================================
  describe('1. Master Quality Semantic Safeguards (Section 1.2)', () => {
    it('enforces brand evidence nuance without forcing brand: null when manufacturer is visible', () => {
      const prompt = buildMasterQualityPageExtractionSystemPrompt();

      // Unbranded bakery items with candy ingredients have b: null
      expect(prompt).toContain('Snickers Cake');
      expect(prompt).toContain('Nutella Croissant');
      expect(prompt).toContain('If no distinct manufacturer brand is established, b MUST BE null');

      // But avoids categorical forcing of null when credible manufacturer evidence is visible
      expect(prompt).toContain('avoid categorical rules that force b: null when credible manufacturer evidence is visible');
      expect(prompt).toContain('if a commercial packaged good is co-branded or officially licensed with a manufacturer logo visible, extract that credible manufacturer brand');
    });

    it('enforces verbatim fidelity for per-kilogram commodities without inventing sz: "1kg"', () => {
      const prompt = buildMasterQualityPageExtractionSystemPrompt();

      // Per-Kg items capture basis in ev=1, eu="kg" but NEVER invent printed sz
      expect(prompt).toContain('Do NOT invent sz: "1kg" if not printed on the leaflet!');
      expect(prompt).toContain('Verbatim fidelity rule: NEVER invent printed size text!');
      expect(prompt).toContain('If a per-kilogram produce item only prints "Per Kg / للكيلو" on the unit badge and has no distinct printed size label, set sz to null');
    });

    it('enforces independent product graphic boxes for compound offers with distinct images', () => {
      const prompt = buildMasterQualityPageExtractionSystemPrompt();

      expect(prompt).toContain('Compound Product Graphics (g)');
      expect(prompt).toContain('sibling offers must NOT automatically share a product graphic box when each offer has a different physical product image');
      expect(prompt).toContain('Assign the appropriate tight graphic region to each independently purchasable offer without clipping the product package or mixing adjacent products');
    });

    it('determines physical pack quantity from visual package evidence rather than blanket promo rules', () => {
      const prompt = buildMasterQualityPageExtractionSystemPrompt();

      expect(prompt).toContain('Promotional Wordings vs Physical Pack Contents');
      expect(prompt).toContain('Use visual package evidence to determine actual physical package quantity');
      expect(prompt).toContain('promotional sticker or coupon, it remains a single unit (pq = 1)');
      expect(prompt).toContain('physically shrink-wrapped or bundled 3 bottles together in one pack with promotional tape');
      expect(prompt).toContain('visual evidence proves it is physically a 3-pack (pq = 3');
    });
  });

  // =========================================================================
  // 2. Provider Caching Token Eligibility & Economics
  // =========================================================================
  describe('2. Provider Caching Eligibility & Economic Break-Even (Sections 2 & 4)', () => {
    it('identifies Master Quality instructions as INELIGIBLE for explicit context caching due to < 4,096 tokens', () => {
      const prompt = buildMasterQualityPageExtractionSystemPrompt();
      const tokenCount = providerCacheService.estimateTokenCount(prompt);

      // Estimated tokens (~2,600 to 3,100) are below 4,096
      expect(tokenCount).toBeLessThan(GeminiProviderCacheService.MINIMUM_CACHE_TOKENS_FLASH);
      expect(tokenCount).toBeGreaterThan(1500);

      const evaluation = providerCacheService.evaluateEligibility({
        model: 'gemini-3.8-flash',
        tier: 'standard',
        systemInstruction: prompt,
        expectedWorkloadPages: 20
      });

      expect(evaluation.isEligible).toBe(false);
      expect(evaluation.recommendation).toBe('skip_ineligible');
      expect(evaluation.skipReason).toContain('SHARED_TOKENS_BELOW_MINIMUM');
      expect(evaluation.minimumRequiredTokens).toBe(4096);
    });

    it('evaluates eligibility and break-even for a hypothetical qualifying shared context (>= 4,096 tokens)', () => {
      // Create a mock large instruction of 5,000 tokens
      const largeInstruction = 'Word '.repeat(4000); // ~5,000 tokens

      const evaluation = providerCacheService.evaluateEligibility({
        model: 'gemini-3.8-flash',
        tier: 'standard',
        systemInstruction: largeInstruction,
        expectedWorkloadPages: 10,
        ttlSeconds: 3600
      });

      expect(evaluation.isEligible).toBe(true);
      expect(evaluation.sharedTokenCount).toBeGreaterThanOrEqual(4096);

      // Break-even for Standard Tier 3.8 Flash (rate $0.75 non-cached vs $0.075 cached, $0.50/hr storage)
      // Numerator: $0.75 + $0.50 = $1.25 per M
      // Denominator: $0.75 - $0.075 = $0.675 per M
      // Break-even = ceil(1.25 / 0.675) = 2 requests
      expect(evaluation.breakEvenRequests).toBe(2);
      expect(evaluation.expectedRequests).toBe(10);
      expect(evaluation.recommendation).toBe('create_cache');
      expect(evaluation.netProjectedSavingsUsd).toBeGreaterThan(0);
    });

    it('evaluates break-even correctly for Flex Tier with date-aware pricing', () => {
      // Nov 7, 2026 Flex Rates ($0.375 non-cached, $0.0375 cached, $0.50/hr storage)
      // Numerator: $0.375 + $0.50 = $0.875 per M
      // Denominator: $0.375 - $0.0375 = $0.3375 per M
      // Break-even = ceil(0.875 / 0.3375) = 3 requests
      const flexEval2026 = evaluateProviderCacheEconomics({
        modelId: 'gemini-3.8-flash',
        tier: 'flex',
        sharedTokenCount: 5000,
        expectedRequests: 2, // Only 2 requests planned
        ttlSeconds: 3600,
        asOfDate: '2026-11-08'
      });

      expect(flexEval2026.isEligible).toBe(true);
      expect(flexEval2026.breakEvenRequests).toBe(3);
      // 2 requests < 3 break-even -> skip_uneconomic
      expect(flexEval2026.recommendation).toBe('skip_uneconomic');
      expect(flexEval2026.skipReason).toContain('UNECONOMIC_BREAK_EVEN');

      // Jan 1, 2027 Flex Rates ($0.75 non-cached, $0.075 cached, $0.50/hr storage)
      // Numerator: $0.75 + $0.50 = $1.25 per M
      // Denominator: $0.75 - $0.075 = $0.675 per M
      // Break-even = ceil(1.25 / 0.675) = 2 requests
      const flexEval2027 = evaluateProviderCacheEconomics({
        modelId: 'gemini-3.8-flash',
        tier: 'flex',
        sharedTokenCount: 5000,
        expectedRequests: 4,
        ttlSeconds: 3600,
        asOfDate: '2027-01-02'
      });

      expect(flexEval2027.breakEvenRequests).toBe(2);
      expect(flexEval2027.recommendation).toBe('create_cache');
    });

    it('calculates storage cost accurately across token quantities and TTL hours', () => {
      // 10,000 tokens for 2 hours at $0.50 per 1M token-hours:
      // (10,000 / 1,000,000) * 2 * $0.50 = $0.01 (1 cent)
      const cost = calculateCacheStorageCost(10000, 2, 'gemini-3.8-flash', '2026-11-08');
      expect(cost).toBeCloseTo(0.01, 6);
    });
  });

  // =========================================================================
  // 3. Provider Cache Lifecycle, Isolation & Deduplication
  // =========================================================================
  describe('3. Isolation, Deduplication & Lifecycle (Section 3)', () => {
    it('isolates cache keys across model, project, location, and instruction hash', () => {
      const key1 = providerCacheService.computeCacheKey({
        backend: 'vertex_ai',
        projectId: 'project-a',
        location: 'us-central1',
        model: 'gemini-3.8-flash',
        systemInstructionSha256: 'hash-1',
        promptProfile: 'master_quality',
        schemaProfile: 'optimized'
      });

      // Different project
      const key2 = providerCacheService.computeCacheKey({
        backend: 'vertex_ai',
        projectId: 'project-b',
        location: 'us-central1',
        model: 'gemini-3.8-flash',
        systemInstructionSha256: 'hash-1',
        promptProfile: 'master_quality',
        schemaProfile: 'optimized'
      });

      // Different system instruction hash
      const key3 = providerCacheService.computeCacheKey({
        backend: 'vertex_ai',
        projectId: 'project-a',
        location: 'us-central1',
        model: 'gemini-3.8-flash',
        systemInstructionSha256: 'hash-2',
        promptProfile: 'master_quality',
        schemaProfile: 'optimized'
      });

      expect(key1).not.toEqual(key2);
      expect(key1).not.toEqual(key3);
    });

    it('deduplicates concurrent creation requests for the identical cache key', async () => {
      const largeInstruction = 'Word '.repeat(4000);
      let createCallCount = 0;

      const mockClient = {
        caches: {
          create: vi.fn().mockImplementation(async () => {
            createCallCount++;
            await new Promise(r => setTimeout(r, 50));
            return {
              name: 'cachedContents/test-dedup-123',
              expireTime: new Date(Date.now() + 3600000).toISOString()
            };
          })
        }
      };

      const params = {
        mode: 'explicit' as const,
        backendContext: { backend: 'vertex_ai', projectId: 'test-p', location: 'global' },
        model: 'gemini-3.8-flash',
        systemInstruction: largeInstruction,
        systemInstructionSha256: 'sha-dedup-test',
        promptProfile: 'master_quality' as const,
        schemaProfile: 'optimized' as const,
        tier: 'standard' as const,
        mockClient,
        allowLiveCreation: true
      };

      // Launch 3 simultaneous resolutions
      const [res1, res2, res3] = await Promise.all([
        providerCacheService.resolveProviderCache(params),
        providerCacheService.resolveProviderCache(params),
        providerCacheService.resolveProviderCache(params)
      ]);

      expect(createCallCount).toBe(1);
      expect(res1.resourceName).toBe('cachedContents/test-dedup-123');
      expect(res2.resourceName).toBe('cachedContents/test-dedup-123');
      expect(res3.resourceName).toBe('cachedContents/test-dedup-123');
      expect(res1.omitsSystemInstruction).toBe(true);
    });

    it('rejects and purges expired provider caches', async () => {
      const largeInstruction = 'Word '.repeat(4000);

      const mockClient = {
        caches: {
          create: vi.fn().mockResolvedValue({
            name: 'cachedContents/will-expire',
            // Expired 10 seconds ago
            expireTime: new Date(Date.now() - 10000).toISOString()
          })
        }
      };

      const params = {
        mode: 'explicit' as const,
        backendContext: { backend: 'vertex_ai', projectId: 'test-p', location: 'global' },
        model: 'gemini-3.8-flash',
        systemInstruction: largeInstruction,
        systemInstructionSha256: 'sha-expire-test',
        promptProfile: 'master_quality' as const,
        schemaProfile: 'optimized' as const,
        tier: 'standard' as const,
        mockClient,
        allowLiveCreation: true
      };

      // 1. Initial creation
      const res1 = await providerCacheService.resolveProviderCache(params);
      expect(res1.status).toBe('active');

      // 2. Next resolution notices expiration, purges cache, and in offline mode fails gracefully
      const res2 = await providerCacheService.resolveProviderCache({
        ...params,
        allowLiveCreation: false,
        mockClient: null
      });

      expect(res2.status).toBe('failed');
      expect(res2.resourceName).toBeNull();
    });
  });

  // =========================================================================
  // 4. Token Accounting & Zero Double-Counting
  // =========================================================================
  describe('4. Token Accounting & Billing Rules (Section 5)', () => {
    it('correctly accounts for cached tokens within prompt tokens without double counting', () => {
      // Provider usageMetadata: promptTokenCount=5000, cachedContentTokenCount=3000
      // Non-cached prompt tokens = 5000 - 3000 = 2000
      const cost = calculateGeminiCost(
        {
          promptTokenCount: 5000,
          cachedContentTokenCount: 3000,
          candidatesTokenCount: 400,
          thoughtsTokenCount: 100,
          totalTokenCount: 5500
        },
        'gemini-3.8-flash',
        'standard',
        '2026-11-08'
      );

      // Non-cached: 2,000 * ($0.75 / 1M) = $0.0015
      // Cached: 3,000 * ($0.075 / 1M) = $0.000225
      // Output: 400 * ($3.75 / 1M) = $0.0015
      // Thinking: 100 * ($3.75 / 1M) = $0.000375
      // Total: 0.0015 + 0.000225 + 0.0015 + 0.000375 = $0.0036
      expect(cost.inputCostUsd).toBeCloseTo(0.0015, 6);
      expect(cost.cachedInputCostUsd).toBeCloseTo(0.000225, 6);
      expect(cost.outputCostUsd).toBeCloseTo(0.0015, 6);
      expect(cost.thinkingCostUsd).toBeCloseTo(0.000375, 6);
      expect(cost.totalCostUsd).toBeCloseTo(0.0036, 6);
    });

    it('caps cachedContentTokenCount to promptTokenCount to prevent negative uncached input', () => {
      // In case provider returns anomalous cached tokens > prompt tokens
      const cost = calculateGeminiCost(
        {
          promptTokenCount: 2000,
          cachedContentTokenCount: 2500, // Anomalous
          candidatesTokenCount: 100,
          thoughtsTokenCount: 0
        },
        'gemini-3.8-flash',
        'standard',
        '2026-11-08'
      );

      // Uncached prompt must be 0, not negative
      expect(cost.inputCostUsd).toBe(0);
      // Cached capped at 2,000 * ($0.075 / 1M) = $0.00015
      expect(cost.cachedInputCostUsd).toBeCloseTo(0.00015, 6);
    });
  });

  // =========================================================================
  // 5. Raw-Response Fidelity & Reconstruction Flagging
  // =========================================================================
  describe('5. Raw-Response Fidelity & Provenance (Section 1.3)', () => {
    it('preserves exact verbatim rawResponseText and sets rawResponseReconstructed: false for fresh and cache hits', async () => {
      const extractionService = new GeminiExtractionService();
      const mockRawJson = '{\n  "offers": [\n    {\n      "n": 1,\n      "ar": "حليب",\n      "en": "Milk",\n      "p": 5.0,\n      "b2d": { "g": [1,2,3,4], "p": [5,6,7,8], "t": [9,10,11,12] }\n    }\n  ]\n}';

      const options = {
        imagePath: testImagePath,
        pageNumber: 1,
        outputDir: testTempDir,
        promptProfile: 'master_quality' as const,
        schemaProfile: 'optimized' as const,
        mockResponse: {
          text: mockRawJson,
          modelVersion: 'gemini-3.8-flash',
          usageMetadata: { promptTokenCount: 1000, totalTokenCount: 1200 }
        }
      };

      // 1. Fresh Extraction
      const fresh = await extractionService.extractLeafletPage(options);
      expect(fresh.rawResponseText).toBe(mockRawJson);
      expect(fresh.rawResponseReconstructed).toBe(false);

      // 2. Cache Hit Extraction
      const cached = await extractionService.extractLeafletPage(options);
      expect(cached.cacheHit).toBe(true);
      expect(cached.rawResponseText).toBe(mockRawJson);
      expect(cached.rawResponseReconstructed).toBe(false);
    });

    it('explicitly marks historical cache entries lacking rawResponseText as rawResponseReconstructed: true', async () => {
      const cachePath = join(testTempDir, 'raw_extracted_page_2.json');

      const legacyFingerprint = {
        imageSha256: 'test-hash',
        model: 'gemini-3.8-flash',
        systemInstructionSha256: 'test-sha',
        promptSha256: 'p-sha',
        promptProfile: 'master_quality' as const,
        schemaSha256: 's-sha',
        schemaProfile: 'optimized' as const,
        thinkingConfig: { thinkingLevel: 'HIGH' },
        imageSettings: { format: 'jpeg', quality: 92 },
        serviceTier: 'standard' as const
      };

      // Write historical cache entry that lacks rawResponseText
      const historicalEntry: GeminiCacheEntry = {
        cacheVersion: 1,
        fingerprint: legacyFingerprint as any,
        fingerprintHash: 'hash-hist',
        cachedAt: new Date().toISOString(),
        usageReport: {
          pageNumber: 2,
          modelId: 'gemini-3.8-flash',
          requestedServiceTier: 'standard',
          actualServiceTier: 'standard',
          cacheHit: true,
          requestDurationMs: 500,
          retriesCount: 0,
          usage: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 0, cachedContentTokenCount: 0, totalTokenCount: 1200, usageReported: true },
          cost: { currency: 'USD', modelId: 'gemini-3.8-flash', tier: 'standard', ratesApplied: { inputPerMillion: 0.75, outputPerMillion: 3.75, cachedInputPerMillion: 0.075 }, inputCostUsd: 0, outputCostUsd: 0, thinkingCostUsd: 0, cachedInputCostUsd: 0, totalCostUsd: 0, effectiveDate: '2026-11-07', isEstimate: true },
          fingerprintHash: 'hash-hist'
        },
        rawResponse: { offers: [{ n: 1, ar: 'أرز', en: 'Rice', p: 10, b2d: { g: [1,2,3,4], p: [5,6,7,8], t: [9,10,11,12] } }] },
        // rawResponseText omitted!
        decodedExtraction: {
          page_number: 2,
          is_loyalty_page: false,
          loyalty_program_name: null,
          validity_start_date: null,
          validity_end_date: null,
          ignored_banners: [],
          offers: []
        }
      };

      writeFileSync(cachePath, JSON.stringify(historicalEntry, null, 2));

      // Mock cache read to hit historical entry
      const mockCacheService: any = {
        computeFingerprint: () => ({ fingerprint: legacyFingerprint, fingerprintHash: 'hash-hist' }),
        resolveCachePath: () => cachePath,
        readValidCacheEntry: () => historicalEntry
      };

      const customService = new GeminiExtractionService(mockCacheService);
      const res = await customService.extractLeafletPage({
        imagePath: testImagePath,
        pageNumber: 2,
        outputDir: testTempDir,
        promptProfile: 'master_quality',
        schemaProfile: 'optimized'
      });

      expect(res.cacheHit).toBe(true);
      expect(res.rawResponseReconstructed).toBe(true);
      expect(res.rawResponseText).toBe(JSON.stringify(historicalEntry.rawResponse));
    });
  });

  // =========================================================================
  // 6. Provider Cache Request Structure & Flex Preservation
  // =========================================================================
  describe('6. Request Structure & Flex Preservation (Section 3)', () => {
    it('omits systemInstruction and includes cachedContent when provider cache is active', async () => {
      let capturedConfig: any = null;

      const mockClient = {
        models: {
          generateContent: vi.fn().mockImplementation(async (req: any) => {
            capturedConfig = req.config;
            return {
              text: '{"offers": []}',
              usageMetadata: { promptTokenCount: 1500, cachedContentTokenCount: 1200, totalTokenCount: 1700 }
            };
          })
        }
      };

      const mockProviderCacheService: any = {
        resolveProviderCache: vi.fn().mockResolvedValue({
          mode: 'explicit',
          status: 'active',
          resourceName: 'projects/p/locations/g/cachedContents/active-cache-456',
          metadata: { resourceName: 'projects/p/locations/g/cachedContents/active-cache-456' },
          economicEvaluation: null,
          omitsSystemInstruction: true,
          skipReason: null
        }),
        invalidateCacheResource: vi.fn()
      };

      const service = new GeminiExtractionService(undefined, mockClient, mockProviderCacheService);

      const res = await service.extractLeafletPage({
        imagePath: testImagePath,
        pageNumber: 1,
        providerCacheMode: 'explicit',
        promptProfile: 'master_quality',
        schemaProfile: 'optimized'
      });

      expect(capturedConfig).toBeDefined();
      expect(capturedConfig.cachedContent).toBe('projects/p/locations/g/cachedContents/active-cache-456');
      expect(capturedConfig.systemInstruction).toBeUndefined();
      expect(capturedConfig.responseSchema).toBeDefined();
      expect(res.providerCacheHit).toBe(true);
      expect(res.providerCacheResource).toBe('projects/p/locations/g/cachedContents/active-cache-456');
    });

    it('NEVER silently changes Flex tier to Standard during provider cache usage or fallback', async () => {
      let capturedConfig: any = null;

      const mockClient = {
        vertexai: true,
        models: {
          generateContent: vi.fn().mockImplementation(async (req: any) => {
            capturedConfig = req.config;
            return {
              text: '{"offers": []}',
              usageMetadata: { promptTokenCount: 1000, totalTokenCount: 1200 }
            };
          })
        }
      };

      const service = new GeminiExtractionService(undefined, mockClient);

      await service.extractLeafletPage({
        imagePath: testImagePath,
        pageNumber: 1,
        executionMode: 'flex',
        providerCacheMode: 'none'
      });

      expect(capturedConfig.httpOptions?.headers['X-Vertex-AI-LLM-Shared-Request-Type']).toBe('flex');
      expect(capturedConfig.httpOptions?.headers['X-Vertex-AI-LLM-Request-Type']).toBe('shared');
    });
  });
});
