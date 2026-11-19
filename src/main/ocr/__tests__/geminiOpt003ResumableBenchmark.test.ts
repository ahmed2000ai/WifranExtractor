import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  PersistedBenchmarkRunner,
  VERIFIED_BENCHMARK_PAGES,
  UNVERIFIED_PAGES_AUDIT,
  PersistedBenchmarkRecord
} from '../resumableBenchmarkRunner';
import { GeminiExtractionService } from '../geminiExtractionService';

describe('WIFRAN-GEMINI-OPT-003 — Resumable Benchmark & Vertex AI Flex Audit', () => {
  const testBaseDir = join(process.cwd(), 'temp/test_benchmark_recovery');

  beforeEach(() => {
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true, force: true });
    }
    mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  describe('1. Dataset Provenance & Panda P4 Audit', () => {
    it('confirms PANDA-P4 was unextracted and has 0 canonical ground-truth files', () => {
      const pandaManifestPath = join(process.cwd(), 'Extracts/PAND-JEDC-150726/manifest.json');
      expect(existsSync(pandaManifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(pandaManifestPath, 'utf8'));
      expect(manifest.counts.json_files).toBe(0);
      expect(manifest.counts.crop_images).toBe(0);

      const jsonDir = join(process.cwd(), 'Extracts/PAND-JEDC-150726/json');
      expect(existsSync(jsonDir)).toBe(true);

      const pandaSpec = UNVERIFIED_PAGES_AUDIT.find(p => p.id === 'PANDA-P4');
      expect(pandaSpec).toBeDefined();
      expect(pandaSpec?.hasVerifiedGroundTruth).toBe(false);
    });

    it('identifies exactly 15 verified ground truth pages across 5 retailers with 168 offers', () => {
      expect(VERIFIED_BENCHMARK_PAGES.length).toBe(15);
      const totalExpected = VERIFIED_BENCHMARK_PAGES.reduce((acc, p) => acc + p.expectedOfferCount, 0);
      expect(totalExpected).toBe(168);

      // Verify retailers represented
      const retailers = new Set(VERIFIED_BENCHMARK_PAGES.map(p => p.retailer));
      expect(retailers.has('Othaim')).toBe(true);
      expect(retailers.has('Alwafa')).toBe(true);
      expect(retailers.has('BinDawood')).toBe(true);
      expect(retailers.has('Lulu')).toBe(true);
      expect(retailers.has('Panda')).toBe(true);

      // Verify that every single verified page image exists on disk
      for (const page of VERIFIED_BENCHMARK_PAGES) {
        const fullImgPath = join(process.cwd(), page.imagePath);
        expect(existsSync(fullImgPath), `Image must exist: ${page.imagePath}`).toBe(true);
      }
    });
  });

  describe('2. Vertex AI Flex Routing & Header Isolation', () => {
    it('sets official X-Vertex-AI-LLM headers for Vertex Flex requests without body serviceTier', async () => {
      let capturedConfig: any = null;

      const mockClient = {
        vertexai: true,
        models: {
          generateContent: vi.fn().mockImplementation(async (params: any) => {
            capturedConfig = params.config;
            return {
              text: JSON.stringify({
                offers: [
                  {
                    offer_number: 1,
                    arabic_title: 'تونة قودي',
                    english_title: 'Goody Tuna',
                    promo_price: 7.95,
                    original_price: 11.5,
                    size_value: '185g',
                    components: {
                      product_graphic_box: [100, 100, 400, 400],
                      promo_price_box: [450, 100, 500, 250],
                      title_text_box: [520, 100, 600, 400],
                      original_price_box: null,
                      unit_and_size_badge_box: null
                    }
                  }
                ]
              }),
              usageMetadata: {
                promptTokenCount: 2200,
                candidatesTokenCount: 350,
                thoughtsTokenCount: 1500,
                totalTokenCount: 4050,
                trafficType: 'ON_DEMAND_FLEX'
              }
            };
          })
        }
      };

      const service = new GeminiExtractionService(undefined, mockClient as any);
      const imgPath = join(process.cwd(), 'test-fixtures/page1_small.png');

      const res = await service.extractLeafletPage({
        imagePath: imgPath,
        pageNumber: 1,
        executionMode: 'flex',
        forceReextract: true
      });

      expect(mockClient.models.generateContent).toHaveBeenCalledTimes(1);
      // Verify Vertex Flex routing
      expect(capturedConfig.serviceTier).toBeUndefined(); // MUST NOT have body serviceTier
      expect(capturedConfig.httpOptions?.headers).toBeDefined();
      expect(capturedConfig.httpOptions.headers['X-Vertex-AI-LLM-Request-Type']).toBe('shared');
      expect(capturedConfig.httpOptions.headers['X-Vertex-AI-LLM-Shared-Request-Type']).toBe('flex');

      // Verify trafficType verification in report
      expect(res.usageReport?.actualServiceTier).toBe('flex');
    });

    it('does NOT set Flex headers for Vertex Standard requests (zero header leakage)', async () => {
      let capturedConfig: any = null;

      const mockClient = {
        vertexai: true,
        models: {
          generateContent: vi.fn().mockImplementation(async (params: any) => {
            capturedConfig = params.config;
            return {
              text: JSON.stringify({ offers: [] }),
              usageMetadata: {
                promptTokenCount: 2200,
                candidatesTokenCount: 200,
                thoughtsTokenCount: 1000,
                trafficType: 'ON_DEMAND_STANDARD'
              }
            };
          })
        }
      };

      const service = new GeminiExtractionService(undefined, mockClient as any);
      const imgPath = join(process.cwd(), 'test-fixtures/page1_small.png');

      const res = await service.extractLeafletPage({
        imagePath: imgPath,
        pageNumber: 1,
        executionMode: 'standard',
        forceReextract: true
      });

      expect(mockClient.models.generateContent).toHaveBeenCalledTimes(1);
      expect(capturedConfig.serviceTier).toBeUndefined();
      expect(capturedConfig.httpOptions?.headers).toBeUndefined();
      expect(res.usageReport?.actualServiceTier).toBe('standard');
    });

    it('never routes gemini-4-argon or diagnostic retries through Flex on Vertex AI', async () => {
      let capturedConfig: any = null;

      const mockClient = {
        vertexai: true,
        models: {
          generateContent: vi.fn().mockImplementation(async (params: any) => {
            capturedConfig = params.config;
            return {
              text: JSON.stringify({ offers: [] }),
              usageMetadata: {
                promptTokenCount: 3000,
                candidatesTokenCount: 500,
                thoughtsTokenCount: 2000,
                trafficType: 'ON_DEMAND_STANDARD'
              }
            };
          })
        }
      };

      const service = new GeminiExtractionService(undefined, mockClient as any);
      const imgPath = join(process.cwd(), 'test-fixtures/page1_small.png');

      await service.extractLeafletPage({
        imagePath: imgPath,
        pageNumber: 1,
        overrideModel: 'gemini-4-argon',
        executionMode: 'flex', // Explicitly requested flex on argon
        isDiagnosticRetry: true,
        failureReasons: ['MISSING_PRICES'],
        forceReextract: true
      });

      // Must be forced to standard headers (no flex shared headers)
      expect(capturedConfig.httpOptions?.headers).toBeUndefined();
    });
  });

  describe('3. Durable Benchmark Persistence & Simulation of Interruption', () => {
    it('atomically persists each record and ledger entry immediately on completion', () => {
      const runner = new PersistedBenchmarkRunner(testBaseDir);

      const fakeRecord: PersistedBenchmarkRecord = {
        pageId: 'TEST-P1',
        retailer: 'Othaim',
        imagePath: 'test-fixtures/page1_small.png',
        imageSha256: 'abc123sha256',
        backend: 'vertex',
        model: 'gemini-3.8-flash',
        schemaVersion: 'optimized',
        promptVersion: 'optimized',
        configType: 'opt_standard',
        requestedServiceTier: 'standard',
        actualTrafficType: 'ON_DEMAND_STANDARD',
        thinkingConfig: { thinkingLevel: 'HIGH' },
        rawResponseText: '{"offers":[]}',
        decodedCanonicalOffers: [],
        usageMetadata: { promptTokenCount: 2200 },
        promptTokens: 2200,
        candidatesTokens: 500,
        thoughtsTokens: 1200,
        totalTokens: 3900,
        requestDurationMs: 45000,
        costUsd: 0.025,
        benchmarkCompletionStatus: 'completed',
        savedAt: new Date().toISOString()
      };

      runner.atomicallySaveRecord(fakeRecord);
      runner.recordLedgerEntry({
        pageId: fakeRecord.pageId,
        configType: fakeRecord.configType,
        backend: fakeRecord.backend,
        model: fakeRecord.model,
        status: 'success',
        trafficType: fakeRecord.actualTrafficType,
        promptTokens: fakeRecord.promptTokens,
        candidatesTokens: fakeRecord.candidatesTokens,
        thoughtsTokens: fakeRecord.thoughtsTokens,
        totalTokens: fakeRecord.totalTokens,
        costUsd: fakeRecord.costUsd
      });

      const recordPath = runner.getRecordPath('TEST-P1', 'opt_standard');
      expect(existsSync(recordPath)).toBe(true);

      const loaded = runner.getExistingRecord('TEST-P1', 'opt_standard');
      expect(loaded).toBeDefined();
      expect(loaded?.pageId).toBe('TEST-P1');
      expect(loaded?.benchmarkCompletionStatus).toBe('reused_from_disk');

      const stats = runner.getStats();
      expect(stats.attemptCount).toBe(1);
      expect(stats.totalSpendUsd).toBeCloseTo(0.025, 4);
    });

    it('proves completed calls survive process termination and are reused without duplicate calls', () => {
      // Step A: First runner process runs 2 calls, then gets interrupted
      const runner1 = new PersistedBenchmarkRunner(testBaseDir);

      const pages = ['PAGE-A', 'PAGE-B', 'PAGE-C'];
      let apiInvocations = 0;

      // Simulate executing 2 calls then aborting
      for (let i = 0; i < 2; i++) {
        const pageId = pages[i];
        apiInvocations++;
        const rec: PersistedBenchmarkRecord = {
          pageId,
          retailer: 'Othaim',
          imagePath: 'test-fixtures/page1_small.png',
          imageSha256: `hash_${pageId}`,
          backend: 'vertex',
          model: 'gemini-3.8-flash',
          schemaVersion: 'optimized',
          promptVersion: 'optimized',
          configType: 'opt_standard',
          requestedServiceTier: 'standard',
          actualTrafficType: 'ON_DEMAND_STANDARD',
          thinkingConfig: { thinkingLevel: 'HIGH' },
          rawResponseText: '{"offers":[]}',
          decodedCanonicalOffers: [],
          usageMetadata: { promptTokenCount: 2200 },
          promptTokens: 2200,
          candidatesTokens: 500,
          thoughtsTokens: 1000,
          totalTokens: 3700,
          requestDurationMs: 40000,
          costUsd: 0.02,
          benchmarkCompletionStatus: 'completed',
          savedAt: new Date().toISOString()
        };
        runner1.atomicallySaveRecord(rec);
        runner1.recordLedgerEntry({
          pageId,
          configType: 'opt_standard',
          backend: 'vertex',
          model: 'gemini-3.8-flash',
          status: 'success',
          costUsd: 0.02
        });
      }

      expect(apiInvocations).toBe(2);
      expect(runner1.getStats().attemptCount).toBe(2);

      // Simulate termination - runner1 instance discarded

      // Step B: Resumed runner instance starts
      const runner2 = new PersistedBenchmarkRunner(testBaseDir);
      expect(runner2.getStats().attemptCount).toBe(2);
      expect(runner2.getStats().totalSpendUsd).toBeCloseTo(0.04, 4);

      // Execute full batch of 3 pages with resume logic
      for (const pageId of pages) {
        const existing = runner2.getExistingRecord(pageId, 'opt_standard');
        if (existing) {
          // Reused! No API invocation
          continue;
        }

        // Only missing pages invoke API
        apiInvocations++;
        const rec: PersistedBenchmarkRecord = {
          pageId,
          retailer: 'Othaim',
          imagePath: 'test-fixtures/page1_small.png',
          imageSha256: `hash_${pageId}`,
          backend: 'vertex',
          model: 'gemini-3.8-flash',
          schemaVersion: 'optimized',
          promptVersion: 'optimized',
          configType: 'opt_standard',
          requestedServiceTier: 'standard',
          actualTrafficType: 'ON_DEMAND_STANDARD',
          thinkingConfig: { thinkingLevel: 'HIGH' },
          rawResponseText: '{"offers":[]}',
          decodedCanonicalOffers: [],
          usageMetadata: { promptTokenCount: 2200 },
          promptTokens: 2200,
          candidatesTokens: 500,
          thoughtsTokens: 1000,
          totalTokens: 3700,
          requestDurationMs: 40000,
          costUsd: 0.02,
          benchmarkCompletionStatus: 'completed',
          savedAt: new Date().toISOString()
        };
        runner2.atomicallySaveRecord(rec);
        runner2.recordLedgerEntry({
          pageId,
          configType: 'opt_standard',
          backend: 'vertex',
          model: 'gemini-3.8-flash',
          status: 'success',
          costUsd: 0.02
        });
      }

      // Total invocations across both runs must be exactly 3 (2 from run 1 + 1 from run 2)
      expect(apiInvocations).toBe(3);
      expect(runner2.getStats().attemptCount).toBe(3);
      expect(runner2.getStats().totalSpendUsd).toBeCloseTo(0.06, 4);

      // Verify all 3 records exist on disk
      for (const pageId of pages) {
        expect(existsSync(runner2.getRecordPath(pageId, 'opt_standard'))).toBe(true);
      }
    });
  });
});
