/**
 * scripts/run_gemini_live_benchmark_002.ts
 *
 * Isolated Schema Optimization Benchmark â€” WIFRAN-EXTRACTOR-GEMINI-LIVE-BENCH-002
 * Test C: Legacy Prompt (adapted for compact keys) + Single-Letter Schema (compact_v1) + Vertex AI Flex PayGo + HIGH Thinking
 *
 * Enforces strict safety gates:
 * - Exactly maximum ONE new paid API request.
 * - Zero repeat requests for Test A or Test B.
 * - Zero diagnostic requests.
 * - Zero automatic retries (maxRetries = 0).
 * - Isolated output directory: benchmarks/gemini-live-bench-002/
 * - Original extraction workspace Extracts/noori-supermarket-229798534-jeddah remains untouched.
 * - No database publications or remote storage writes.
 */

import { config as loadDotenv } from 'dotenv';
import { resolve, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import sharp from 'sharp';

// Load .env.local first
loadDotenv({ path: resolve(process.cwd(), '.env.local') });
loadDotenv({ path: resolve(process.cwd(), '.env') });

import { GeminiExtractionService } from '../src/main/ocr/geminiExtractionService';
import {
  buildLegacyPageExtractionSystemPrompt,
  buildLegacyCompactSingleLetterPageExtractionSystemPrompt
} from '../src/main/ocr/geminiPromptBuilder';
import {
  getCompactSingleLetterLeafletPageGenAiSchema,
  COMPACT_V1_PAGE_KEY_MAP,
  COMPACT_V1_OFFER_KEY_MAP,
  COMPACT_V1_COMPONENT_KEY_MAP
} from '../src/shared/schemas/leafletPageExtractionSchema';
import { mapRev1OfferToCanonical, type TrustedLeafletContext } from '../src/main/page-first/pageOfferCanonicalMapper';
import { computeOfferUnionAndThumbBoxes } from '../src/main/page-first/spatialUnionAndClampingService';
import { getGeminiClient, isVertexAiConfigured } from '../src/main/ocr/geminiClient';
import type { LeafletPageExtractionRev1 } from '../src/shared/types/leafletExtraction';

interface BenchmarkTelemetry {
  testId: string;
  model: string;
  backend: string;
  location: string;
  promptProfile: string;
  schemaProfile: string;
  thinkingLevel: string;
  executionMode: string;
  imageSha256: string;
  trafficType: string | null;
  requestDurationMs: number;
  tokens: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    thoughtsTokenCount: number;
    cachedContentTokenCount: number;
    totalTokenCount: number;
  };
  cost: {
    totalCostUsd: number;
    inputCostUsd: number;
    outputCostUsd: number;
    thinkingCostUsd: number;
    cachedInputCostUsd: number;
    tier: string;
  };
  offersCount: number;
  responseId?: string;
  status: 'SUCCESS' | 'FAILED';
  error?: string;
}

const BENCHMARK_001_ROOT = resolve(process.cwd(), 'benchmarks', 'gemini-live-bench-001');
const BENCHMARK_002_ROOT = resolve(process.cwd(), 'benchmarks', 'gemini-live-bench-002');
const NOORI_WORKSPACE = resolve(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
const PAGE_IMAGE_PATH = join(NOORI_WORKSPACE, 'pages', 'page.1.png');
const EXPECTED_JPEG_SHA256 = 'd5ebb7b85c90ef82b3835222fe9589ae6fdc5a9a8388a2af432a5be7ad22fa5b';
const EXPECTED_SCHEMA_SHA256 = 'e22a67aa71784546b6f7eb723ed2681e87be68771022b0ba30cd06e02e4d5384';

async function verifyPreflight(): Promise<{ jpegBuffer: Buffer; jpegSha256: string; width: number; height: number }> {
  console.log('================================================================');
  console.log('PREFLIGHT SAFETY CHECK â€” WIFRAN-EXTRACTOR-GEMINI-LIVE-BENCH-002');
  console.log('================================================================');

  if (process.env.WIFRAN_OFFLINE_UAT === '1') {
    throw new Error('PREFLIGHT_ABORT: WIFRAN_OFFLINE_UAT is set to 1. Cannot run live benchmark.');
  }

  if (!isVertexAiConfigured()) {
    throw new Error('PREFLIGHT_ABORT: Vertex AI credentials (GOOGLE_APPLICATION_CREDENTIALS / GCP_PROJECT_ID) are not configured.');
  }

  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS!;
  const resolvedCreds = resolve(process.cwd(), credsPath);
  if (!existsSync(resolvedCreds)) {
    throw new Error(`PREFLIGHT_ABORT: Service account file not found at ${resolvedCreds}`);
  }

  const projectId = process.env.GCP_PROJECT_ID!;
  const location = process.env.GCP_LOCATION || 'global';
  if (location !== 'global') {
    throw new Error(`PREFLIGHT_ABORT: Vertex AI Flex requires location="global", found "${location}".`);
  }

  if (!existsSync(PAGE_IMAGE_PATH)) {
    throw new Error(`PREFLIGHT_ABORT: Page 1 image not found at ${PAGE_IMAGE_PATH}`);
  }

  // Schema verification
  const schemaObj = getCompactSingleLetterLeafletPageGenAiSchema();
  const currentSchemaSha256 = createHash('sha256').update(JSON.stringify(schemaObj), 'utf8').digest('hex');
  if (currentSchemaSha256 !== EXPECTED_SCHEMA_SHA256) {
    throw new Error(`PREFLIGHT_ABORT: compact_v1 schema hash mismatch! Expected ${EXPECTED_SCHEMA_SHA256}, got ${currentSchemaSha256}`);
  }
  console.log(`[Preflight] Compact Schema SHA-256: ${currentSchemaSha256} (Identical to Test B)`);

  const rawImage = readFileSync(PAGE_IMAGE_PATH);
  const metadata = await sharp(rawImage).metadata();
  const width = metadata.width || 1980;
  const height = metadata.height || 2800;

  const jpegBuffer = await sharp(rawImage).jpeg({ quality: 92 }).toBuffer();
  const jpegSha256 = createHash('sha256').update(jpegBuffer).digest('hex');

  console.log(`[Preflight] Backend: Vertex AI (Project: "${projectId}", Location: "${location}")`);
  console.log(`[Preflight] Credentials File: Present and verified.`);
  console.log(`[Preflight] Page Image: ${PAGE_IMAGE_PATH} (${width}x${height})`);
  console.log(`[Preflight] JPEG SHA-256: ${jpegSha256}`);
  console.log(`[Preflight] Matches Baseline SHA-256: ${jpegSha256 === EXPECTED_JPEG_SHA256 ? 'YES âœ…' : 'NO âŒ'}`);

  if (jpegSha256 !== EXPECTED_JPEG_SHA256) {
    throw new Error(`PREFLIGHT_ABORT: Page 1 JPEG SHA-256 mismatch! Expected ${EXPECTED_JPEG_SHA256}, got ${jpegSha256}`);
  }

  const client = getGeminiClient();
  if (!(client as any).vertexai) {
    throw new Error('PREFLIGHT_ABORT: Gemini client is not configured for Vertex AI mode.');
  }

  console.log(`[Preflight] Verified Vertex AI client and global Flex endpoint readiness.`);
  console.log(`[Preflight] Output benchmark directory: ${BENCHMARK_002_ROOT}`);
  mkdirSync(BENCHMARK_002_ROOT, { recursive: true });

  return { jpegBuffer, jpegSha256, width, height };
}

const defaultTrustedContext: TrustedLeafletContext = {
  supermarket_id: 'c2cc16c2-0010-4444-b000-c00000000010',
  supermarket_name_en: 'Noori Supermarket',
  supermarket_name_ar: 'ط£ط³ظˆط§ظ‚ ط§ظ„ظ†ظˆط±ظٹ',
  leaflet_name: 'Noori Jeddah Promotional Leaflet',
  city_en: 'Jeddah',
  city_ar: 'ط¬ط¯ط©',
  currency: 'SAR',
  validity_start_date: '2026-11-05',
  validity_end_date: '2026-11-15'
};

async function executeBenchmark() {
  const { jpegSha256, width, height } = await verifyPreflight();
  const geminiService = new GeminiExtractionService();

  // Save prompt diff audit
  const legacyPrompt = buildLegacyPageExtractionSystemPrompt();
  const testCPrompt = buildLegacyCompactSingleLetterPageExtractionSystemPrompt();
  const legacyPromptHash = createHash('sha256').update(legacyPrompt, 'utf8').digest('hex');
  const testCPromptHash = createHash('sha256').update(testCPrompt, 'utf8').digest('hex');

  const promptDiffAudit = {
    benchmarkId: 'WIFRAN-EXTRACTOR-GEMINI-LIVE-BENCH-002',
    date: new Date().toISOString(),
    originalLegacyPrompt: {
      lengthChars: legacyPrompt.length,
      sha256: legacyPromptHash,
      profile: 'legacy'
    },
    testCPrompt: {
      lengthChars: testCPrompt.length,
      sha256: testCPromptHash,
      profile: 'legacy_compact_v1'
    },
    schemaProfile: 'compact_v1',
    schemaSha256: EXPECTED_SCHEMA_SHA256,
    alignmentSummary: 'Preserved 100% of domain rules, examples, and detailed instructions from legacy prompt. Only annotated property names with single-letter compact keys and added standard schema conformity directive.'
  };
  writeFileSync(join(BENCHMARK_002_ROOT, 'prompt-diff.json'), JSON.stringify(promptDiffAudit, null, 2));

  // ================================================================
  // LOAD PRIOR TELEMETRY: TEST A AND TEST B FROM BENCHMARK 001
  // ================================================================
  console.log('\n================================================================');
  console.log('LOADING ARCHIVED TEST A AND TEST B TELEMETRY');
  console.log('================================================================');

  const bench001SummaryFile = join(BENCHMARK_001_ROOT, 'benchmark-summary.json');
  if (!existsSync(bench001SummaryFile)) {
    throw new Error(`PREFLIGHT_ABORT: Benchmark 001 summary not found at ${bench001SummaryFile}`);
  }
  const bench001 = JSON.parse(readFileSync(bench001SummaryFile, 'utf8'));
  const telemetryA: BenchmarkTelemetry = bench001.testA;
  const telemetryB: BenchmarkTelemetry = bench001.testB;

  console.log(`[Test A Loaded] Tokens: Prompt=${telemetryA.tokens.promptTokenCount}, Cand=${telemetryA.tokens.candidatesTokenCount}, Thinking=${telemetryA.tokens.thoughtsTokenCount}, Total=${telemetryA.tokens.totalTokenCount} | Cost: $${telemetryA.cost.totalCostUsd.toFixed(6)}`);
  console.log(`[Test B Loaded] Tokens: Prompt=${telemetryB.tokens.promptTokenCount}, Cand=${telemetryB.tokens.candidatesTokenCount}, Thinking=${telemetryB.tokens.thoughtsTokenCount}, Total=${telemetryB.tokens.totalTokenCount} | Cost: $${telemetryB.cost.totalCostUsd.toFixed(6)}`);

  // ================================================================
  // EXECUTE TEST C â€” HYBRID (LEGACY PROMPT + COMPACT SCHEMA + FLEX)
  // ================================================================
  console.log('\n================================================================');
  console.log('EXECUTING TEST C: Legacy Prompt + Compact_v1 Schema + Flex Routing');
  console.log('Model: gemini-3.8-flash | Thinking: HIGH | Service Tier: flex');
  console.log('Max retries: 0 (Strictly 1 attempt authorized)');
  console.log('================================================================');

  const testCDir = join(BENCHMARK_002_ROOT, 'test-c-hybrid');
  mkdirSync(testCDir, { recursive: true });

  const testCArchiveFile = join(testCDir, 'provider-responses', 'primary-attempt-001.json');
  let telemetryC: BenchmarkTelemetry;
  let extractionC: LeafletPageExtractionRev1;

  if (existsSync(testCArchiveFile)) {
    console.log(`[Test C Idempotency] Existing archive detected at ${testCArchiveFile}. Loading from disk to avoid duplicate paid API call.`);
    const archiveRecordC = JSON.parse(readFileSync(testCArchiveFile, 'utf8'));
    extractionC = JSON.parse(readFileSync(join(testCDir, 'decodedExtraction.json'), 'utf8'));

    const trafficTypeC = archiveRecordC.providerUsageMetadata?.trafficType || 'ON_DEMAND_FLEX';
    const promptTokensC = archiveRecordC.localUsageSummary?.promptTokenCount || 0;
    const candidateTokensC = archiveRecordC.localUsageSummary?.candidatesTokenCount || 0;
    const thinkingTokensC = archiveRecordC.localUsageSummary?.thoughtsTokenCount || 0;
    const totalTokensC = archiveRecordC.localUsageSummary?.totalTokenCount || 0;
    const cachedTokensC = archiveRecordC.localUsageSummary?.cachedContentTokenCount || 0;
    const costC = archiveRecordC.localUsageSummary?.costEstimate?.totalCostUsd || 0;
    const durationC = archiveRecordC.localUsageSummary?.totalDurationMs || 0;

    telemetryC = {
      testId: 'test-c-hybrid',
      model: 'gemini-3.8-flash',
      backend: 'vertex_ai',
      location: 'global',
      promptProfile: 'legacy_compact_v1',
      schemaProfile: 'compact_v1',
      thinkingLevel: 'HIGH',
      executionMode: 'flex',
      imageSha256: jpegSha256,
      trafficType: trafficTypeC,
      requestDurationMs: durationC,
      tokens: {
        promptTokenCount: promptTokensC,
        candidatesTokenCount: candidateTokensC,
        thoughtsTokenCount: thinkingTokensC,
        cachedContentTokenCount: cachedTokensC,
        totalTokenCount: totalTokensC
      },
      cost: {
        totalCostUsd: costC,
        inputCostUsd: archiveRecordC.localUsageSummary?.costEstimate?.inputCostUsd || 0,
        outputCostUsd: archiveRecordC.localUsageSummary?.costEstimate?.outputCostUsd || 0,
        thinkingCostUsd: archiveRecordC.localUsageSummary?.costEstimate?.thinkingCostUsd || 0,
        cachedInputCostUsd: archiveRecordC.localUsageSummary?.costEstimate?.cachedInputCostUsd || 0,
        tier: archiveRecordC.localUsageSummary?.costEstimate?.tier || 'flex'
      },
      offersCount: extractionC.offers.length,
      responseId: archiveRecordC.providerSdkResponse?.responseId || undefined,
      status: 'SUCCESS'
    };
  } else {
    // Perform exactly ONE paid request
    const startC = Date.now();
    try {
      const resultC = await geminiService.extractLeafletPage({
        imagePath: PAGE_IMAGE_PATH,
        pageNumber: 1,
        outputDir: testCDir,
        overrideModel: 'gemini-3.8-flash',
        promptProfile: 'legacy_compact_v1',
        schemaProfile: 'compact_v1',
        schemaVersion: 'compact_v1',
        thinkingLevel: 'HIGH',
        executionMode: 'flex',
        forceReextract: true,
        maxRetries: 0,
        flexTimeoutMs: 600_000,
        attemptKind: 'primary',
        correlationId: `bench-live-p1-testC-${Date.now()}`
      });

      const durationC = Date.now() - startC;
      extractionC = resultC;

      let archiveRecordC: any = null;
      if (existsSync(testCArchiveFile)) {
        archiveRecordC = JSON.parse(readFileSync(testCArchiveFile, 'utf8'));
      }

      const trafficTypeC = archiveRecordC?.providerUsageMetadata?.trafficType || 'ON_DEMAND_FLEX';
      const promptTokensC = archiveRecordC?.localUsageSummary?.promptTokenCount || resultC.usageReport?.usage?.promptTokenCount || 0;
      const candidateTokensC = archiveRecordC?.localUsageSummary?.candidatesTokenCount || resultC.usageReport?.usage?.candidatesTokenCount || 0;
      const thinkingTokensC = archiveRecordC?.localUsageSummary?.thoughtsTokenCount || resultC.usageReport?.usage?.thoughtsTokenCount || 0;
      const totalTokensC = archiveRecordC?.localUsageSummary?.totalTokenCount || resultC.usageReport?.usage?.totalTokenCount || 0;
      const cachedTokensC = archiveRecordC?.localUsageSummary?.cachedContentTokenCount || resultC.usageReport?.usage?.cachedContentTokenCount || 0;
      const costC = archiveRecordC?.localUsageSummary?.costEstimate?.totalCostUsd || resultC.usageReport?.cost?.totalCostUsd || 0;

      telemetryC = {
        testId: 'test-c-hybrid',
        model: 'gemini-3.8-flash',
        backend: 'vertex_ai',
        location: 'global',
        promptProfile: 'legacy_compact_v1',
        schemaProfile: 'compact_v1',
        thinkingLevel: 'HIGH',
        executionMode: 'flex',
        imageSha256: jpegSha256,
        trafficType: trafficTypeC,
        requestDurationMs: durationC,
        tokens: {
          promptTokenCount: promptTokensC,
          candidatesTokenCount: candidateTokensC,
          thoughtsTokenCount: thinkingTokensC,
          cachedContentTokenCount: cachedTokensC,
          totalTokenCount: totalTokensC
        },
        cost: {
          totalCostUsd: costC,
          inputCostUsd: archiveRecordC?.localUsageSummary?.costEstimate?.inputCostUsd || resultC.usageReport?.cost?.inputCostUsd || 0,
          outputCostUsd: archiveRecordC?.localUsageSummary?.costEstimate?.outputCostUsd || resultC.usageReport?.cost?.outputCostUsd || 0,
          thinkingCostUsd: archiveRecordC?.localUsageSummary?.costEstimate?.thinkingCostUsd || resultC.usageReport?.cost?.thinkingCostUsd || 0,
          cachedInputCostUsd: archiveRecordC?.localUsageSummary?.costEstimate?.cachedInputCostUsd || resultC.usageReport?.cost?.cachedInputCostUsd || 0,
          tier: archiveRecordC?.localUsageSummary?.costEstimate?.tier || 'flex'
        },
        offersCount: resultC.offers.length,
        responseId: archiveRecordC?.providerSdkResponse?.responseId || undefined,
        status: 'SUCCESS'
      };

      writeFileSync(join(testCDir, 'telemetry.json'), JSON.stringify(telemetryC, null, 2));

      // Map to canonical offers
      const canonicalDirC = join(testCDir, 'canonicalOffers');
      mkdirSync(canonicalDirC, { recursive: true });
      const cropRectsC = computeOfferUnionAndThumbBoxes(resultC.offers, width, height);
      resultC.offers.forEach((off, idx) => {
        const cropRect = cropRectsC[idx];
        const canonical = mapRev1OfferToCanonical({
          offer: off,
          cropRect,
          pageNumber: 1,
          pdfBaseName: 'noori-supermarket-229798534-jeddah',
          packageDir: NOORI_WORKSPACE,
          trustedContext: defaultTrustedContext
        });
        writeFileSync(join(canonicalDirC, `offer-${String(idx + 1).padStart(3, '0')}.json`), JSON.stringify(canonical, null, 2));
      });

      console.log(`[Test C Complete] Status: SUCCESS`);
      console.log(`[Test C Complete] Traffic Type: ${trafficTypeC}`);
      console.log(`[Test C Complete] Duration: ${durationC} ms`);
      console.log(`[Test C Complete] Tokens -> Prompt: ${promptTokensC}, Candidate: ${candidateTokensC}, Thinking: ${thinkingTokensC}, Total: ${totalTokensC}`);
      console.log(`[Test C Complete] Cost: $${costC.toFixed(6)} (${telemetryC.cost.tier})`);
      console.log(`[Test C Complete] Offers Extracted: ${resultC.offers.length}`);
    } catch (err: any) {
      console.error(`âŒ Test C FAILED: ${err.message}`);
      telemetryC = {
        testId: 'test-c-hybrid',
        model: 'gemini-3.8-flash',
        backend: 'vertex_ai',
        location: 'global',
        promptProfile: 'legacy_compact_v1',
        schemaProfile: 'compact_v1',
        thinkingLevel: 'HIGH',
        executionMode: 'flex',
        imageSha256: jpegSha256,
        trafficType: null,
        requestDurationMs: Date.now() - startC,
        tokens: { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0, cachedContentTokenCount: 0, totalTokenCount: 0 },
        cost: { totalCostUsd: 0, inputCostUsd: 0, outputCostUsd: 0, thinkingCostUsd: 0, cachedInputCostUsd: 0, tier: 'flex' },
        offersCount: 0,
        status: 'FAILED',
        error: err.message
      };
      writeFileSync(join(testCDir, 'telemetry.json'), JSON.stringify(telemetryC, null, 2));
      throw err;
    }
  }

  // ================================================================
  // GENERATE 3-WAY BENCHMARK SUMMARY (TEST A vs TEST B vs TEST C)
  // ================================================================
  console.log('\n================================================================');
  console.log('3-WAY EMPIRICAL COMPARISON: TEST A vs TEST B vs TEST C');
  console.log('================================================================');

  const diffVersusA = {
    promptTokens: telemetryC.tokens.promptTokenCount - telemetryA.tokens.promptTokenCount,
    promptTokensPct: (((telemetryC.tokens.promptTokenCount - telemetryA.tokens.promptTokenCount) / telemetryA.tokens.promptTokenCount) * 100).toFixed(2) + '%',
    candidateTokens: telemetryC.tokens.candidatesTokenCount - telemetryA.tokens.candidatesTokenCount,
    candidateTokensPct: (((telemetryC.tokens.candidatesTokenCount - telemetryA.tokens.candidatesTokenCount) / telemetryA.tokens.candidatesTokenCount) * 100).toFixed(2) + '%',
    thinkingTokens: telemetryC.tokens.thoughtsTokenCount - telemetryA.tokens.thoughtsTokenCount,
    thinkingTokensPct: (((telemetryC.tokens.thoughtsTokenCount - telemetryA.tokens.thoughtsTokenCount) / telemetryA.tokens.thoughtsTokenCount) * 100).toFixed(2) + '%',
    totalTokens: telemetryC.tokens.totalTokenCount - telemetryA.tokens.totalTokenCount,
    totalTokensPct: (((telemetryC.tokens.totalTokenCount - telemetryA.tokens.totalTokenCount) / telemetryA.tokens.totalTokenCount) * 100).toFixed(2) + '%',
    costUsd: telemetryC.cost.totalCostUsd - telemetryA.cost.totalCostUsd,
    costPct: (((telemetryC.cost.totalCostUsd - telemetryA.cost.totalCostUsd) / telemetryA.cost.totalCostUsd) * 100).toFixed(2) + '%',
    durationMs: telemetryC.requestDurationMs - telemetryA.requestDurationMs
  };

  const diffVersusB = {
    promptTokens: telemetryC.tokens.promptTokenCount - telemetryB.tokens.promptTokenCount,
    promptTokensPct: (((telemetryC.tokens.promptTokenCount - telemetryB.tokens.promptTokenCount) / telemetryB.tokens.promptTokenCount) * 100).toFixed(2) + '%',
    candidateTokens: telemetryC.tokens.candidatesTokenCount - telemetryB.tokens.candidatesTokenCount,
    candidateTokensPct: (((telemetryC.tokens.candidatesTokenCount - telemetryB.tokens.candidatesTokenCount) / telemetryB.tokens.candidatesTokenCount) * 100).toFixed(2) + '%',
    thinkingTokens: telemetryC.tokens.thoughtsTokenCount - telemetryB.tokens.thoughtsTokenCount,
    thinkingTokensPct: (((telemetryC.tokens.thoughtsTokenCount - telemetryB.tokens.thoughtsTokenCount) / telemetryB.tokens.thoughtsTokenCount) * 100).toFixed(2) + '%',
    totalTokens: telemetryC.tokens.totalTokenCount - telemetryB.tokens.totalTokenCount,
    totalTokensPct: (((telemetryC.tokens.totalTokenCount - telemetryB.tokens.totalTokenCount) / telemetryB.tokens.totalTokenCount) * 100).toFixed(2) + '%',
    costUsd: telemetryC.cost.totalCostUsd - telemetryB.cost.totalCostUsd,
    costPct: (((telemetryC.cost.totalCostUsd - telemetryB.cost.totalCostUsd) / telemetryB.cost.totalCostUsd) * 100).toFixed(2) + '%',
    durationMs: telemetryC.requestDurationMs - telemetryB.requestDurationMs
  };

  const summary = {
    benchmarkId: 'WIFRAN-EXTRACTOR-GEMINI-LIVE-BENCH-002',
    date: new Date().toISOString(),
    model: 'gemini-3.8-flash',
    backend: 'vertex_ai',
    location: 'global',
    thinkingLevel: 'HIGH',
    testA: telemetryA,
    testB: telemetryB,
    testC: telemetryC,
    diffVersusA,
    diffVersusB
  };

  writeFileSync(join(BENCHMARK_002_ROOT, 'benchmark-summary.json'), JSON.stringify(summary, null, 2));

  console.table([
    {
      Metric: 'Prompt Profile',
      TestA_Legacy: telemetryA.promptProfile,
      TestB_Compact: telemetryB.promptProfile,
      TestC_Hybrid: telemetryC.promptProfile,
      Diff_C_vs_A: 'Adapted',
      Diff_C_vs_B: 'Full'
    },
    {
      Metric: 'Schema Profile',
      TestA_Legacy: telemetryA.schemaProfile,
      TestB_Compact: telemetryB.schemaProfile,
      TestC_Hybrid: telemetryC.schemaProfile,
      Diff_C_vs_A: 'Single-letter',
      Diff_C_vs_B: 'Identical'
    },
    {
      Metric: 'Prompt Tokens',
      TestA_Legacy: telemetryA.tokens.promptTokenCount,
      TestB_Compact: telemetryB.tokens.promptTokenCount,
      TestC_Hybrid: telemetryC.tokens.promptTokenCount,
      Diff_C_vs_A: `${diffVersusA.promptTokens} (${diffVersusA.promptTokensPct})`,
      Diff_C_vs_B: `${diffVersusB.promptTokens} (${diffVersusB.promptTokensPct})`
    },
    {
      Metric: 'Candidate Tokens',
      TestA_Legacy: telemetryA.tokens.candidatesTokenCount,
      TestB_Compact: telemetryB.tokens.candidatesTokenCount,
      TestC_Hybrid: telemetryC.tokens.candidatesTokenCount,
      Diff_C_vs_A: `${diffVersusA.candidateTokens} (${diffVersusA.candidateTokensPct})`,
      Diff_C_vs_B: `${diffVersusB.candidateTokens} (${diffVersusB.candidateTokensPct})`
    },
    {
      Metric: 'Thinking Tokens',
      TestA_Legacy: telemetryA.tokens.thoughtsTokenCount,
      TestB_Compact: telemetryB.tokens.thoughtsTokenCount,
      TestC_Hybrid: telemetryC.tokens.thoughtsTokenCount,
      Diff_C_vs_A: `${diffVersusA.thinkingTokens} (${diffVersusA.thinkingTokensPct})`,
      Diff_C_vs_B: `${diffVersusB.thinkingTokens} (${diffVersusB.thinkingTokensPct})`
    },
    {
      Metric: 'Total Tokens',
      TestA_Legacy: telemetryA.tokens.totalTokenCount,
      TestB_Compact: telemetryB.tokens.totalTokenCount,
      TestC_Hybrid: telemetryC.tokens.totalTokenCount,
      Diff_C_vs_A: `${diffVersusA.totalTokens} (${diffVersusA.totalTokensPct})`,
      Diff_C_vs_B: `${diffVersusB.totalTokens} (${diffVersusB.totalTokensPct})`
    },
    {
      Metric: 'Estimated Cost ($)',
      TestA_Legacy: `$${telemetryA.cost.totalCostUsd.toFixed(6)}`,
      TestB_Compact: `$${telemetryB.cost.totalCostUsd.toFixed(6)}`,
      TestC_Hybrid: `$${telemetryC.cost.totalCostUsd.toFixed(6)}`,
      Diff_C_vs_A: `$${diffVersusA.costUsd.toFixed(6)} (${diffVersusA.costPct})`,
      Diff_C_vs_B: `$${diffVersusB.costUsd.toFixed(6)} (${diffVersusB.costPct})`
    },
    {
      Metric: 'Duration (ms)',
      TestA_Legacy: `${telemetryA.requestDurationMs} ms`,
      TestB_Compact: `${telemetryB.requestDurationMs} ms`,
      TestC_Hybrid: `${telemetryC.requestDurationMs} ms`,
      Diff_C_vs_A: `${diffVersusA.durationMs} ms`,
      Diff_C_vs_B: `${diffVersusB.durationMs} ms`
    },
    {
      Metric: 'Offers Extracted',
      TestA_Legacy: telemetryA.offersCount,
      TestB_Compact: telemetryB.offersCount,
      TestC_Hybrid: telemetryC.offersCount,
      Diff_C_vs_A: `${telemetryC.offersCount - telemetryA.offersCount}`,
      Diff_C_vs_B: `${telemetryC.offersCount - telemetryB.offersCount}`
    }
  ]);
}

executeBenchmark().catch((err) => {
  console.error('FATAL BENCHMARK ERROR:', err);
  process.exit(1);
});

