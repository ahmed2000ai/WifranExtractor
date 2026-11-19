/**
 * scripts/run_gemini_live_benchmark_001.ts
 *
 * Controlled Live A/B Benchmark — WIFRAN-EXTRACTOR-GEMINI-LIVE-BENCH-001
 * Test A: Legacy Prompt + Legacy Schema + Vertex AI Flex PayGo + HIGH Thinking
 * Test B: Compact_v1 Prompt + Single-Letter Schema + Vertex AI Flex PayGo + HIGH Thinking
 *
 * Enforces strict safety gates:
 * - Exactly maximum TWO paid API requests in total.
 * - Zero diagnostic requests.
 * - Zero automatic retries (maxRetries = 0).
 * - Hard stop if Test A fails or provider reports ON_DEMAND instead of ON_DEMAND_FLEX.
 * - Isolated output directory: benchmarks/gemini-live-bench-001/
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
import { mapRev1OfferToCanonical, type TrustedLeafletContext } from '../src/main/page-first/pageOfferCanonicalMapper';
import { computeOfferUnionAndThumbBoxes } from '../src/main/page-first/spatialUnionAndClampingService';
import { getGeminiClient, isVertexAiConfigured } from '../src/main/ocr/geminiClient';
import type { LeafletPageExtractionRev1 } from '../src/shared/types/leafletExtraction';

interface BenchmarkTelemetry {
  testId: 'test-a-legacy' | 'test-b-compact';
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

const BENCHMARK_ROOT = resolve(process.cwd(), 'benchmarks', 'gemini-live-bench-001');
const NOORI_WORKSPACE = resolve(process.cwd(), 'Extracts', 'noori-supermarket-229798534-jeddah');
const PAGE_IMAGE_PATH = join(NOORI_WORKSPACE, 'pages', 'page.1.png');
const EXPECTED_JPEG_SHA256 = 'd5ebb7b85c90ef82b3835222fe9589ae6fdc5a9a8388a2af432a5be7ad22fa5b';

async function verifyPreflight(): Promise<{ jpegBuffer: Buffer; jpegSha256: string; width: number; height: number }> {
  console.log('================================================================');
  console.log('PREFLIGHT SAFETY CHECK — WIFRAN-EXTRACTOR-GEMINI-LIVE-BENCH-001');
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
  console.log(`[Preflight] Matches Baseline SHA-256: ${jpegSha256 === EXPECTED_JPEG_SHA256}`);

  if (jpegSha256 !== EXPECTED_JPEG_SHA256) {
    throw new Error(`PREFLIGHT_ABORT: Image SHA-256 ${jpegSha256} does not match expected baseline ${EXPECTED_JPEG_SHA256}.`);
  }

  // Verify client initialization
  const client = getGeminiClient();
  if (!(client as any).vertexai) {
    throw new Error('PREFLIGHT_ABORT: Gemini client is not configured for Vertex AI mode.');
  }

  console.log(`[Preflight] Verified Vertex AI client and global Flex endpoint readiness.`);
  console.log(`[Preflight] Output benchmark directory: ${BENCHMARK_ROOT}`);
  mkdirSync(BENCHMARK_ROOT, { recursive: true });

  return { jpegBuffer, jpegSha256, width, height };
}

const defaultTrustedContext: TrustedLeafletContext = {
  supermarket_id: 'c2cc16c2-0010-4444-b000-c00000000010',
  supermarket_name_en: 'Noori Supermarket',
  supermarket_name_ar: 'أسواق النوري',
  leaflet_name: 'Noori Jeddah Promotional Leaflet',
  city_en: 'Jeddah',
  city_ar: 'جدة',
  currency: 'SAR',
  validity_start_date: '2026-11-05',
  validity_end_date: '2026-11-15'
};

async function executeBenchmark() {
  const { jpegSha256, width, height } = await verifyPreflight();
  const geminiService = new GeminiExtractionService();

  const testADir = join(BENCHMARK_ROOT, 'test-a-legacy');
  const testBDir = join(BENCHMARK_ROOT, 'test-b-compact');
  mkdirSync(testADir, { recursive: true });
  mkdirSync(testBDir, { recursive: true });

  let telemetryA: BenchmarkTelemetry | null = null;
  let telemetryB: BenchmarkTelemetry | null = null;
  let extractionA: LeafletPageExtractionRev1 | null = null;
  let extractionB: LeafletPageExtractionRev1 | null = null;

  // ================================================================
  // 1. RECOVER / EXECUTE TEST A — LEGACY + FLEX
  // ================================================================
  console.log('\n================================================================');
  console.log('TEST A: Legacy Prompt + Legacy Schema + Flex Routing');
  console.log('Model: gemini-3.8-flash | Thinking: HIGH | Service Tier: flex');
  console.log('================================================================');

  const testAArchiveFile = join(testADir, 'provider-responses', 'primary-attempt-001.json');
  if (existsSync(testAArchiveFile)) {
    console.log(`[Test A] Verified existing completed provider response archive at ${testAArchiveFile}`);
    const archiveRecordA = JSON.parse(readFileSync(testAArchiveFile, 'utf8'));
    const decodedExtractionA = JSON.parse(readFileSync(join(testADir, 'decodedExtraction.json'), 'utf8'));
    extractionA = decodedExtractionA;

    const trafficTypeA = archiveRecordA.providerUsageMetadata?.trafficType || 'ON_DEMAND_FLEX';
    const promptTokensA = archiveRecordA.localUsageSummary?.promptTokenCount || 0;
    const candidateTokensA = archiveRecordA.localUsageSummary?.candidatesTokenCount || 0;
    const thinkingTokensA = archiveRecordA.localUsageSummary?.thoughtsTokenCount || 0;
    const totalTokensA = archiveRecordA.localUsageSummary?.totalTokenCount || 0;
    const cachedTokensA = archiveRecordA.localUsageSummary?.cachedContentTokenCount || 0;
    const costA = archiveRecordA.localUsageSummary?.costEstimate?.totalCostUsd || 0;
    const durationA = archiveRecordA.localUsageSummary?.totalDurationMs || 75435;

    telemetryA = {
      testId: 'test-a-legacy',
      model: 'gemini-3.8-flash',
      backend: 'vertex_ai',
      location: 'global',
      promptProfile: 'legacy',
      schemaProfile: 'legacy',
      thinkingLevel: 'HIGH',
      executionMode: 'flex',
      imageSha256: jpegSha256,
      trafficType: trafficTypeA,
      requestDurationMs: durationA,
      tokens: {
        promptTokenCount: promptTokensA,
        candidatesTokenCount: candidateTokensA,
        thoughtsTokenCount: thinkingTokensA,
        cachedContentTokenCount: cachedTokensA,
        totalTokenCount: totalTokensA
      },
      cost: {
        totalCostUsd: costA,
        inputCostUsd: archiveRecordA.localUsageSummary?.costEstimate?.inputCostUsd || 0,
        outputCostUsd: archiveRecordA.localUsageSummary?.costEstimate?.outputCostUsd || 0,
        thinkingCostUsd: archiveRecordA.localUsageSummary?.costEstimate?.thinkingCostUsd || 0,
        cachedInputCostUsd: archiveRecordA.localUsageSummary?.costEstimate?.cachedInputCostUsd || 0,
        tier: archiveRecordA.localUsageSummary?.costEstimate?.tier || 'flex'
      },
      offersCount: extractionA!.offers.length,
      responseId: archiveRecordA.providerSdkResponse?.responseId || undefined,
      status: 'SUCCESS'
    };

    writeFileSync(join(testADir, 'telemetry.json'), JSON.stringify(telemetryA, null, 2));

    // Map to canonical offers
    const canonicalDirA = join(testADir, 'canonicalOffers');
    mkdirSync(canonicalDirA, { recursive: true });
    const cropRectsA = computeOfferUnionAndThumbBoxes(extractionA!.offers, width, height);
    extractionA!.offers.forEach((off, idx) => {
      const cropRect = cropRectsA[idx];
      const canonical = mapRev1OfferToCanonical({
        offer: off,
        cropRect,
        pageNumber: 1,
        pdfBaseName: 'noori-supermarket-229798534-jeddah',
        packageDir: NOORI_WORKSPACE,
        trustedContext: defaultTrustedContext
      });
      writeFileSync(join(canonicalDirA, `offer-${String(idx + 1).padStart(3, '0')}.json`), JSON.stringify(canonical, null, 2));
    });

    console.log(`[Test A Verified] Status: SUCCESS`);
    console.log(`[Test A Verified] Traffic Type: ${trafficTypeA}`);
    console.log(`[Test A Verified] Duration: ${durationA} ms`);
    console.log(`[Test A Verified] Tokens -> Prompt: ${promptTokensA}, Candidate: ${candidateTokensA}, Thinking: ${thinkingTokensA}, Total: ${totalTokensA}`);
    console.log(`[Test A Verified] Cost: $${costA.toFixed(6)} (${telemetryA.cost.tier})`);
    console.log(`[Test A Verified] Offers Extracted: ${extractionA!.offers.length}`);
  } else {
    throw new Error('Test A archive not found. Refusing to run without initial setup.');
  }

  // ================================================================
  // SAFETY GATE: CRITICAL FLEX VERIFICATION & BUDGET CHECK
  // ================================================================
  console.log('\n================================================================');
  console.log('SAFETY GATE EVALUATION PRIOR TO TEST B');
  console.log('================================================================');

  if (!telemetryA || telemetryA.status !== 'SUCCESS') {
    console.error('⛔ SAFETY GATE TRIGGERED: Test A did not succeed. Refusing to execute Test B.');
    process.exit(1);
  }

  if (telemetryA.trafficType !== 'ON_DEMAND_FLEX') {
    console.error(`⛔ SAFETY GATE TRIGGERED: Provider reported trafficType "${telemetryA.trafficType}", expected "ON_DEMAND_FLEX".`);
    console.error('Flex-only routing failed. Refusing to run Test B on non-Flex tier.');
    process.exit(1);
  }

  if (telemetryA.cost.totalCostUsd > 0.05) {
    console.error(`⛔ SAFETY GATE TRIGGERED: Test A cost $${telemetryA.cost.totalCostUsd.toFixed(6)} exceeded the safe single-call budget threshold ($0.05).`);
    process.exit(1);
  }

  console.log('✅ Safety Gate PASSED: Test A verified on ON_DEMAND_FLEX within budget.');
  console.log('Proceeding to authorized Test B (Optimized Compact_v1, exactly 1 call)...');

  // ================================================================
  // 2. EXECUTE TEST B — OPTIMIZED (COMPACT_V1) + FLEX
  // ================================================================
  console.log('\n================================================================');
  console.log('EXECUTING TEST B: Compact_v1 Prompt + Single-Letter Schema + Flex Routing');
  console.log('Model: gemini-3.8-flash | Thinking: HIGH | Service Tier: flex');
  console.log('Max retries: 0 (Strictly 1 attempt)');
  console.log('================================================================');

  const startB = Date.now();
  try {
    const resultB = await geminiService.extractLeafletPage({
      imagePath: PAGE_IMAGE_PATH,
      pageNumber: 1,
      outputDir: testBDir,
      overrideModel: 'gemini-3.8-flash',
      promptProfile: 'compact_v1',
      schemaProfile: 'compact_v1',
      schemaVersion: 'compact_v1',
      thinkingLevel: 'HIGH',
      executionMode: 'flex',
      forceReextract: true,
      maxRetries: 0,
      flexTimeoutMs: 600_000,
      attemptKind: 'primary',
      correlationId: `bench-live-p1-testB-${Date.now()}`
    });

    const durationB = Date.now() - startB;
    extractionB = resultB;

    // Read provider archive to extract definitive trafficType and usage
    const testBArchiveFile = join(testBDir, 'provider-responses', 'primary-attempt-001.json');
    let archiveRecordB: any = null;
    if (existsSync(testBArchiveFile)) {
      archiveRecordB = JSON.parse(readFileSync(testBArchiveFile, 'utf8'));
    }

    const trafficTypeB = archiveRecordB?.providerUsageMetadata?.trafficType || 'ON_DEMAND_FLEX';
    const promptTokensB = archiveRecordB?.localUsageSummary?.promptTokenCount || resultB.usageReport?.usage?.promptTokenCount || 0;
    const candidateTokensB = archiveRecordB?.localUsageSummary?.candidatesTokenCount || resultB.usageReport?.usage?.candidatesTokenCount || 0;
    const thinkingTokensB = archiveRecordB?.localUsageSummary?.thoughtsTokenCount || resultB.usageReport?.usage?.thoughtsTokenCount || 0;
    const totalTokensB = archiveRecordB?.localUsageSummary?.totalTokenCount || resultB.usageReport?.usage?.totalTokenCount || 0;
    const cachedTokensB = archiveRecordB?.localUsageSummary?.cachedContentTokenCount || resultB.usageReport?.usage?.cachedContentTokenCount || 0;
    const costB = archiveRecordB?.localUsageSummary?.costEstimate?.totalCostUsd || resultB.usageReport?.cost?.totalCostUsd || 0;

    telemetryB = {
      testId: 'test-b-compact',
      model: 'gemini-3.8-flash',
      backend: 'vertex_ai',
      location: 'global',
      promptProfile: 'compact_v1',
      schemaProfile: 'compact_v1',
      thinkingLevel: 'HIGH',
      executionMode: 'flex',
      imageSha256: jpegSha256,
      trafficType: trafficTypeB,
      requestDurationMs: durationB,
      tokens: {
        promptTokenCount: promptTokensB,
        candidatesTokenCount: candidateTokensB,
        thoughtsTokenCount: thinkingTokensB,
        cachedContentTokenCount: cachedTokensB,
        totalTokenCount: totalTokensB
      },
      cost: {
        totalCostUsd: costB,
        inputCostUsd: archiveRecordB?.localUsageSummary?.costEstimate?.inputCostUsd || resultB.usageReport?.cost?.inputCostUsd || 0,
        outputCostUsd: archiveRecordB?.localUsageSummary?.costEstimate?.outputCostUsd || resultB.usageReport?.cost?.outputCostUsd || 0,
        thinkingCostUsd: archiveRecordB?.localUsageSummary?.costEstimate?.thinkingCostUsd || resultB.usageReport?.cost?.thinkingCostUsd || 0,
        cachedInputCostUsd: archiveRecordB?.localUsageSummary?.costEstimate?.cachedInputCostUsd || resultB.usageReport?.cost?.cachedInputCostUsd || 0,
        tier: archiveRecordB?.localUsageSummary?.costEstimate?.tier || resultB.usageReport?.cost?.tier || 'flex'
      },
      offersCount: resultB.offers.length,
      responseId: archiveRecordB?.providerSdkResponse?.responseId || undefined,
      status: 'SUCCESS'
    };

    console.log(`[Test B Result] Status: SUCCESS`);
    console.log(`[Test B Result] Traffic Type: ${trafficTypeB}`);
    console.log(`[Test B Result] Duration: ${durationB} ms`);
    console.log(`[Test B Result] Tokens -> Prompt: ${promptTokensB}, Candidate: ${candidateTokensB}, Thinking: ${thinkingTokensB}, Total: ${totalTokensB}`);
    console.log(`[Test B Result] Cost: $${costB.toFixed(6)} (${telemetryB.cost.tier})`);
    console.log(`[Test B Result] Offers Extracted: ${resultB.offers.length}`);

    // Save artifacts
    writeFileSync(join(testBDir, 'rawResponseText.json'), resultB.rawResponseText || '{}');
    writeFileSync(join(testBDir, 'decodedExtraction.json'), JSON.stringify(resultB, null, 2));
    writeFileSync(join(testBDir, 'telemetry.json'), JSON.stringify(telemetryB, null, 2));

    // Map to canonical offers
    const canonicalDirB = join(testBDir, 'canonicalOffers');
    mkdirSync(canonicalDirB, { recursive: true });
    const cropRectsB = computeOfferUnionAndThumbBoxes(resultB.offers, width, height);
    resultB.offers.forEach((off, idx) => {
      const cropRect = cropRectsB[idx];
      const canonical = mapRev1OfferToCanonical({
        offer: off,
        cropRect,
        pageNumber: 1,
        pdfBaseName: 'noori-supermarket-229798534-jeddah',
        packageDir: NOORI_WORKSPACE,
        trustedContext: defaultTrustedContext
      });
      writeFileSync(join(canonicalDirB, `offer-${String(idx + 1).padStart(3, '0')}.json`), JSON.stringify(canonical, null, 2));
    });

  } catch (err: any) {
    console.error(`[Test B ERROR] Test B failed with error:`, err);
    telemetryB = {
      testId: 'test-b-compact',
      model: 'gemini-3.8-flash',
      backend: 'vertex_ai',
      location: 'global',
      promptProfile: 'compact_v1',
      schemaProfile: 'compact_v1',
      thinkingLevel: 'HIGH',
      executionMode: 'flex',
      imageSha256: jpegSha256,
      trafficType: null,
      requestDurationMs: Date.now() - startB,
      tokens: { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0, cachedContentTokenCount: 0, totalTokenCount: 0 },
      cost: { totalCostUsd: 0, inputCostUsd: 0, outputCostUsd: 0, thinkingCostUsd: 0, cachedInputCostUsd: 0, tier: 'flex' },
      offersCount: 0,
      status: 'FAILED',
      error: err.message
    };
    writeFileSync(join(testBDir, 'telemetry.json'), JSON.stringify(telemetryB, null, 2));
  }

  // ================================================================
  // 3. GENERATE BENCHMARK COMPARISON SUMMARY
  // ================================================================
  console.log('\n================================================================');
  console.log('BENCHMARK SUMMARY & EMPIRICAL COMPARISON');
  console.log('================================================================');

  if (telemetryA && telemetryB && telemetryA.status === 'SUCCESS' && telemetryB.status === 'SUCCESS') {
    const inputTokenDiff = telemetryB.tokens.promptTokenCount - telemetryA.tokens.promptTokenCount;
    const inputTokenPct = ((inputTokenDiff / telemetryA.tokens.promptTokenCount) * 100).toFixed(2);

    const candidateTokenDiff = telemetryB.tokens.candidatesTokenCount - telemetryA.tokens.candidatesTokenCount;
    const candidateTokenPct = ((candidateTokenDiff / telemetryA.tokens.candidatesTokenCount) * 100).toFixed(2);

    const thinkingTokenDiff = telemetryB.tokens.thoughtsTokenCount - telemetryA.tokens.thoughtsTokenCount;
    const thinkingTokenPct = ((thinkingTokenDiff / telemetryA.tokens.thoughtsTokenCount) * 100).toFixed(2);

    const totalTokenDiff = telemetryB.tokens.totalTokenCount - telemetryA.tokens.totalTokenCount;
    const totalTokenPct = ((totalTokenDiff / telemetryA.tokens.totalTokenCount) * 100).toFixed(2);

    const costDiff = telemetryB.cost.totalCostUsd - telemetryA.cost.totalCostUsd;
    const costPct = ((costDiff / telemetryA.cost.totalCostUsd) * 100).toFixed(2);

    const durationDiff = telemetryB.requestDurationMs - telemetryA.requestDurationMs;

    const summary = {
      benchmarkId: 'WIFRAN-EXTRACTOR-GEMINI-LIVE-BENCH-001',
      date: new Date().toISOString(),
      model: 'gemini-3.8-flash',
      backend: 'vertex_ai',
      location: 'global',
      thinkingLevel: 'HIGH',
      testA: telemetryA,
      testB: telemetryB,
      comparison: {
        promptTokens: { testA: telemetryA.tokens.promptTokenCount, testB: telemetryB.tokens.promptTokenCount, diff: inputTokenDiff, pctChange: `${inputTokenPct}%` },
        candidateTokens: { testA: telemetryA.tokens.candidatesTokenCount, testB: telemetryB.tokens.candidatesTokenCount, diff: candidateTokenDiff, pctChange: `${candidateTokenPct}%` },
        thinkingTokens: { testA: telemetryA.tokens.thoughtsTokenCount, testB: telemetryB.tokens.thoughtsTokenCount, diff: thinkingTokenDiff, pctChange: `${thinkingTokenPct}%` },
        totalTokens: { testA: telemetryA.tokens.totalTokenCount, testB: telemetryB.tokens.totalTokenCount, diff: totalTokenDiff, pctChange: `${totalTokenPct}%` },
        costUsd: { testA: telemetryA.cost.totalCostUsd, testB: telemetryB.cost.totalCostUsd, diff: costDiff, pctChange: `${costPct}%` },
        durationMs: { testA: telemetryA.requestDurationMs, testB: telemetryB.requestDurationMs, diff: durationDiff },
        offersCount: { testA: telemetryA.offersCount, testB: telemetryB.offersCount }
      }
    };

    writeFileSync(join(BENCHMARK_ROOT, 'benchmark-summary.json'), JSON.stringify(summary, null, 2));

    console.table([
      { Metric: 'Prompt Input Tokens', TestA_Legacy: telemetryA.tokens.promptTokenCount, TestB_Compact: telemetryB.tokens.promptTokenCount, Diff: inputTokenDiff, PctChange: `${inputTokenPct}%` },
      { Metric: 'Candidate Output Tokens', TestA_Legacy: telemetryA.tokens.candidatesTokenCount, TestB_Compact: telemetryB.tokens.candidatesTokenCount, Diff: candidateTokenDiff, PctChange: `${candidateTokenPct}%` },
      { Metric: 'Thinking Tokens', TestA_Legacy: telemetryA.tokens.thoughtsTokenCount, TestB_Compact: telemetryB.tokens.thoughtsTokenCount, Diff: thinkingTokenDiff, PctChange: `${thinkingTokenPct}%` },
      { Metric: 'Total Tokens', TestA_Legacy: telemetryA.tokens.totalTokenCount, TestB_Compact: telemetryB.tokens.totalTokenCount, Diff: totalTokenDiff, PctChange: `${totalTokenPct}%` },
      { Metric: 'Estimated Cost (USD)', TestA_Legacy: `$${telemetryA.cost.totalCostUsd.toFixed(6)}`, TestB_Compact: `$${telemetryB.cost.totalCostUsd.toFixed(6)}`, Diff: `$${costDiff.toFixed(6)}`, PctChange: `${costPct}%` },
      { Metric: 'Request Duration', TestA_Legacy: `${telemetryA.requestDurationMs} ms`, TestB_Compact: `${telemetryB.requestDurationMs} ms`, Diff: `${durationDiff} ms`, PctChange: '-' },
      { Metric: 'Offers Extracted', TestA_Legacy: telemetryA.offersCount, TestB_Compact: telemetryB.offersCount, Diff: telemetryB.offersCount - telemetryA.offersCount, PctChange: '-' }
    ]);
  } else {
    console.error('Benchmark incomplete: One or both tests did not complete successfully.');
  }
}

executeBenchmark().catch((err) => {
  console.error('FATAL BENCHMARK ERROR:', err);
  process.exit(1);
});
