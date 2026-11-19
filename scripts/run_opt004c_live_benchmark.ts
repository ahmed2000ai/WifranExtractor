import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  GeminiExtractionService,
  type GeminiExtractionResult
} from '../src/main/ocr/geminiExtractionService';
import {
  isVertexAiConfigured,
  getGeminiClient
} from '../src/main/ocr/geminiClient';
import {
  buildRev1PageExtractionSystemPrompt,
  buildLegacyPageExtractionSystemPrompt,
  buildOptimizedPageExtractionSystemPrompt
} from '../src/main/ocr/geminiPromptBuilder';
import {
  getLeafletPageGenAiSchema,
  type LeafletPromptProfile,
  type LeafletSchemaProfile
} from '../src/shared/schemas/leafletPageExtractionSchema';
import {
  renderVisualCropsForPage,
  computeUnionBox,
  type RenderResult
} from './render_visual_crops';

const cwd = process.cwd();

// --- STRICT AUTHORIZATION CEILINGS ---
const MAX_AUTHORIZED_ATTEMPTS = 6;
const MAX_AUTHORIZED_SPEND_USD = 0.45;
const HISTORICAL_ATTEMPTS = 51;
const HISTORICAL_SPEND_USD = 1.721410;

// Frozen SHA-256 Hashes from Baseline
const FROZEN_HASHES = {
  legacyPrompt: 'e54ee263bcc8f54e49c22dc002673d60fbd75d2d8e83e45258943e76c3b93c9e',
  optimizedPrompt: '0817c6cfc61f12a3498521f7e147ad7cf0b15748e90bd76eb0c5b66601703d49',
  masterQualityPrompt: 'c5736fa321c9ad8b3c42ebea2d11efc228bca8f4c6d4db02d4c43bb96a03a5c8',
  legacySchema: 'a126c35cd49763af95f3c2c5f5fc1bf498d0fa4828b1022dbf76746747533d9e',
  optimizedSchema: '27d0daaeba7450df20c748a11d20258053ea8fdd6263c5863e927c1806c5cecf'
};

interface BenchmarkPageDef {
  id: 'GOLDEN-P1' | 'BNDW-P2' | 'ALWAFA-P1';
  pageNum: number;
  imagePath: string;
  expectedSha256: string;
  expectedOfferCount: number;
  referencePath: string;
}

const BENCHMARK_PAGES: BenchmarkPageDef[] = [
  {
    id: 'GOLDEN-P1',
    pageNum: 1,
    imagePath: 'test-fixtures/page1_small.png',
    expectedSha256: 'c46a81f6d1b46a58a53ffb001bb459874930bcdaa22239c38002cf13920f251c',
    expectedOfferCount: 9,
    referencePath: 'test-fixtures/page1_golden_verified_reference.json'
  },
  {
    id: 'BNDW-P2',
    pageNum: 2,
    imagePath: 'Extracts/BNDW_Test/pages/page.2.png',
    expectedSha256: '732548b53a3f90ef5e2a9f53a44e14444b86add88e8590dc12028fceb9b7404d',
    expectedOfferCount: 7,
    referencePath: 'Extracts/BNDW_Test/json'
  },
  {
    id: 'ALWAFA-P1',
    pageNum: 1,
    imagePath: 'Extracts/Alwafa_Test/pages/page.1.png',
    expectedSha256: 'ed1dd77d9fa998708013776912e2956f8086fb9f8945351d993a1380e84fe4ae',
    expectedOfferCount: 13,
    referencePath: 'Extracts/Alwafa_Test/json'
  }
];

interface BenchmarkStage {
  pageId: 'GOLDEN-P1' | 'BNDW-P2' | 'ALWAFA-P1';
  thinkingLevel: 'HIGH' | 'MEDIUM';
  stageName: string;
}

const ALL_ORDERED_STAGES: BenchmarkStage[] = [
  { pageId: 'GOLDEN-P1', thinkingLevel: 'HIGH', stageName: 'Stage A1: Othaim Canary (Master Quality + HIGH)' },
  { pageId: 'GOLDEN-P1', thinkingLevel: 'MEDIUM', stageName: 'Stage A2: Othaim Canary (Master Quality + MEDIUM)' },
  { pageId: 'BNDW-P2', thinkingLevel: 'HIGH', stageName: 'Stage B1: BinDawood Bakery (Master Quality + HIGH)' },
  { pageId: 'BNDW-P2', thinkingLevel: 'MEDIUM', stageName: 'Stage B2: BinDawood Bakery (Master Quality + MEDIUM)' },
  { pageId: 'ALWAFA-P1', thinkingLevel: 'HIGH', stageName: 'Stage C1: Alwafa Dense Grid (Master Quality + HIGH)' },
  { pageId: 'ALWAFA-P1', thinkingLevel: 'MEDIUM', stageName: 'Stage C2: Alwafa Dense Grid (Master Quality + MEDIUM)' }
];

export interface Opt004cLedgerEntry {
  attemptIndex: number; // 1..6
  globalAttemptNumber: number; // 52..57
  timestamp: string;
  stageName: string;
  pageId: string;
  promptProfile: 'master_quality';
  schemaProfile: 'optimized';
  thinkingLevel: 'HIGH' | 'MEDIUM';
  serviceTier: 'standard';
  backend: 'vertex_ai';
  model: 'gemini-3.8-flash';
  status: 'SUCCESS' | 'FAILED';
  promptTokens?: number;
  candidatesTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  thinkingCostUsd?: number;
  totalCostUsd?: number;
  requestDurationMs?: number;
  offersExtracted?: number;
  error?: string;
  artifactPath?: string;
}

export function computeIoU(b1: number[] | null | undefined, b2: number[] | null | undefined): number {
  if (!b1 || !b2 || b1.length !== 4 || b2.length !== 4) return 0;
  const [y1min, x1min, y1max, x1max] = b1;
  const [y2min, x2min, y2max, x2max] = b2;

  const yInterMin = Math.max(y1min, y2min);
  const xInterMin = Math.max(x1min, x2min);
  const yInterMax = Math.min(y1max, y2max);
  const xInterMax = Math.min(x1max, x2max);

  if (yInterMax <= yInterMin || xInterMax <= xInterMin) return 0;

  const interArea = (yInterMax - yInterMin) * (xInterMax - xInterMin);
  const area1 = (y1max - y1min) * (x1max - x1min);
  const area2 = (y2max - y2min) * (x2max - x2min);
  const unionArea = area1 + area2 - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

export function loadVerifiedGroundTruth(pageDef: BenchmarkPageDef): any[] {
  if (pageDef.referencePath.endsWith('.json')) {
    const raw = JSON.parse(readFileSync(join(cwd, pageDef.referencePath), 'utf8'));
    return raw.offers || raw;
  }
  const dir = join(cwd, pageDef.referencePath);
  const prefix = `page-${String(pageDef.pageNum).padStart(3, '0')}-`;
  const files = existsSync(dir)
    ? require('fs')
        .readdirSync(dir)
        .filter((f: string) => f.startsWith(prefix) && f.endsWith('.canonical.json'))
        .sort()
    : [];

  return files.map((f: string) => {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const rawExtraction = data.raw?.raw_attributes?.raw_offer_extraction || {};
    return {
      offer_number: parseInt(data.source?.source_item_number || '1', 10),
      arabic_title: data.product?.title_ar || rawExtraction.arabic_title || '',
      english_title: data.product?.title_en || rawExtraction.english_title || '',
      brand: data.product?.brand_text ?? rawExtraction.brand ?? null,
      promo_price: data.prices?.offer_price ?? rawExtraction.promo_price,
      original_price: data.prices?.original_price ?? rawExtraction.original_price ?? null,
      size_value: data.content?.size_text || rawExtraction.size_value,
      pack_quantity: data.content?.pack_quantity || 1,
      components: rawExtraction.components || {}
    };
  });
}

async function runOpt004cLiveBenchmark() {
  console.log('======================================================================');
  console.log('WIFRAN-EXTRACTOR-GEMINI-OPT-004C — CONTROLLED LIVE ACCEPTANCE BENCHMARK');
  console.log('======================================================================\n');

  const outDir = join(cwd, 'temp/benchmark_runs/OPT-004C');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const ledgerPath = join(outDir, 'request_ledger.json');
  let ledger: Opt004cLedgerEntry[] = [];
  if (existsSync(ledgerPath)) {
    try {
      ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    } catch {
      ledger = [];
    }
  }

  function persistLedger() {
    const tmp = `${ledgerPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
    renameSync(tmp, ledgerPath);
  }

  // -------------------------------------------------------------------
  // 1. MANDATORY OFFLINE PREFLIGHT & INTEGRITY AUDIT
  // -------------------------------------------------------------------
  console.log('--- Step 1: Pre-Flight Safety & Hash Integrity Audit ---');

  if (!isVertexAiConfigured()) {
    throw new Error('FATAL: Vertex AI backend is NOT configured. Gemini Developer API fallback is not permitted.');
  }
  console.log('[OK] Vertex AI backend confirmed active with service account.');

  // Verify Prompt & Schema SHA-256 Hashes
  const pLegacy = buildLegacyPageExtractionSystemPrompt();
  const pOpt = buildOptimizedPageExtractionSystemPrompt();
  const pMq = buildRev1PageExtractionSystemPrompt('master_quality');
  const sLegacy = JSON.stringify(getLeafletPageGenAiSchema('legacy'));
  const sOpt = JSON.stringify(getLeafletPageGenAiSchema('optimized'));

  const h = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

  const liveHashes = {
    legacyPrompt: h(pLegacy),
    optimizedPrompt: h(pOpt),
    masterQualityPrompt: h(pMq),
    legacySchema: h(sLegacy),
    optimizedSchema: h(sOpt)
  };

  for (const [k, expected] of Object.entries(FROZEN_HASHES)) {
    const actual = (liveHashes as any)[k];
    if (actual !== expected) {
      throw new Error(`FATAL: Hash mismatch for ${k}! Expected ${expected}, got ${actual}`);
    }
  }
  console.log('[OK] All 5 system instruction and JSON schema hashes match frozen baselines exactly.');

  // Verify Target Source Images
  for (const p of BENCHMARK_PAGES) {
    const fullPath = join(cwd, p.imagePath);
    if (!existsSync(fullPath)) {
      throw new Error(`FATAL: Source image not found for ${p.id} at ${fullPath}`);
    }
    const buf = readFileSync(fullPath);
    const hash = createHash('sha256').update(buf).digest('hex');
    if (hash !== p.expectedSha256) {
      throw new Error(`FATAL: Image hash mismatch for ${p.id}! Expected ${p.expectedSha256}, got ${hash}`);
    }
    console.log(`[OK] Source image verified for ${p.id} (${buf.length} bytes, SHA-256: ${hash.substring(0, 16)}...)`);
  }

  // Check cumulative spending & attempt limits from ledger
  let currentAttempts = ledger.length;
  let currentSpendUsd = ledger.reduce((sum, e) => sum + (e.totalCostUsd || 0), 0);

  console.log(`[Status] Existing OPT-004C attempts recorded: ${currentAttempts}/${MAX_AUTHORIZED_ATTEMPTS}`);
  console.log(`[Status] Existing OPT-004C spending recorded: $${currentSpendUsd.toFixed(6)} / $${MAX_AUTHORIZED_SPEND_USD}\n`);

  if (currentAttempts >= MAX_AUTHORIZED_ATTEMPTS) {
    console.log('[Notice] Maximum 6 authorized attempts already reached. Proceeding to reporting.');
    return;
  }

  const extractionService = new GeminiExtractionService();

  // Determine which stages still need to be executed
  // Check on-disk completion of each stage
  const pendingStages: BenchmarkStage[] = [];
  for (const stage of ALL_ORDERED_STAGES) {
    const stageSuffix = stage.thinkingLevel.toLowerCase();
    const artifactFilename = `${stage.pageId}__mq_${stageSuffix}.json`;
    const artifactPath = join(outDir, artifactFilename);
    if (!existsSync(artifactPath)) {
      pendingStages.push(stage);
    } else {
      console.log(`[Skip] ${stage.stageName} already completed on disk at ${artifactFilename}`);
    }
  }

  console.log(`\nPending stages to execute: ${pendingStages.length}`);
  console.log(`Remaining attempts budget: ${MAX_AUTHORIZED_ATTEMPTS - currentAttempts} attempts\n`);

  // -------------------------------------------------------------------
  // 2. CONTROLLED STAGE EXECUTION (STRICTLY CAPPED AT MAX 6 ATTEMPTS)
  // -------------------------------------------------------------------
  for (const stage of pendingStages) {
    const pageDef = BENCHMARK_PAGES.find(p => p.id === stage.pageId)!;
    const stageSuffix = stage.thinkingLevel.toLowerCase();
    const artifactFilename = `${stage.pageId}__mq_${stageSuffix}.json`;
    const artifactPath = join(outDir, artifactFilename);

    console.log('----------------------------------------------------------------------');
    console.log(`Executing Attempt ${currentAttempts + 1}/${MAX_AUTHORIZED_ATTEMPTS}: ${stage.stageName}`);
    console.log(`Page: ${stage.pageId} | Thinking: ${stage.thinkingLevel} | Schema: compact (optimized)`);
    console.log('----------------------------------------------------------------------');

    // Strict Spending and Attempt Guards
    if (currentAttempts >= MAX_AUTHORIZED_ATTEMPTS) {
      console.warn(`[GUARD STOP] Attempt limit reached (${currentAttempts}/${MAX_AUTHORIZED_ATTEMPTS}). Halting live execution.`);
      break;
    }

    const estimatedNextCost = 0.015; // Conservative estimated cost per call
    if (currentSpendUsd + estimatedNextCost > MAX_AUTHORIZED_SPEND_USD) {
      console.warn(`[GUARD STOP] Estimated spend ($${(currentSpendUsd + estimatedNextCost).toFixed(6)}) would breach ceiling ($${MAX_AUTHORIZED_SPEND_USD}). Halting.`);
      break;
    }

    // Pacing Pause to prevent Vertex AI per-minute burst rate limits (429)
    console.log('[Pacing] Waiting 15 seconds to respect Vertex AI quota rate limits...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    const startTime = Date.now();
    let extractionResult: GeminiExtractionResult | null = null;
    let stageError: any = null;

    try {
      extractionResult = await extractionService.extractLeafletPage({
        imagePath: join(cwd, pageDef.imagePath),
        pageNumber: pageDef.pageNum,
        overrideModel: 'gemini-3.8-flash',
        executionMode: 'standard',
        promptProfile: 'master_quality',
        schemaProfile: 'optimized',
        thinkingLevel: stage.thinkingLevel,
        providerCacheMode: 'none',
        forceReextract: true,
        maxRetries: 0
      });
    } catch (err: any) {
      stageError = err;
      console.error(`[EXECUTION ERROR] Call failed: ${err.message}`);
    }

    const durationMs = Date.now() - startTime;
    currentAttempts++;

    if (stageError || !extractionResult) {
      const failedEntry: Opt004cLedgerEntry = {
        attemptIndex: currentAttempts,
        globalAttemptNumber: HISTORICAL_ATTEMPTS + currentAttempts,
        timestamp: new Date().toISOString(),
        stageName: stage.stageName,
        pageId: stage.pageId,
        promptProfile: 'master_quality',
        schemaProfile: 'optimized',
        thinkingLevel: stage.thinkingLevel,
        serviceTier: 'standard',
        backend: 'vertex_ai',
        model: 'gemini-3.8-flash',
        status: 'FAILED',
        requestDurationMs: durationMs,
        error: stageError?.message || 'Unknown extraction failure'
      };
      ledger.push(failedEntry);
      persistLedger();
      console.error(`Attempt ${currentAttempts} recorded as FAILED in ledger. Halting benchmark due to execution error.`);
      break;
    }

    // Call Succeeded: Process Tokens, Cost and Artifacts
    const usage = extractionResult.usageReport?.usage;
    const cost = extractionResult.usageReport?.cost;
    const promptTokens = usage?.promptTokenCount ?? 0;
    const candidatesTokens = usage?.candidatesTokenCount ?? 0;
    const thoughtsTokens = usage?.thoughtsTokenCount ?? 0;
    const totalTokens = usage?.totalTokenCount ?? 0;
    const callCostUsd = cost?.totalCostUsd ?? 0;
    currentSpendUsd += callCostUsd;

    const offers = extractionResult.offers || [];
    console.log(`[SUCCESS] Extracted ${offers.length} offers in ${durationMs}ms`);
    console.log(`[Usage] Prompt: ${promptTokens} | Candidates: ${candidatesTokens} | Thoughts: ${thoughtsTokens} | Total: ${totalTokens}`);
    console.log(`[Cost] Call: $${callCostUsd.toFixed(6)} | Cumulative OPT-004C: $${currentSpendUsd.toFixed(6)}`);

    // Render Visual Crops and Annotated Overlay
    const cropsSubdir = join(outDir, 'crops', `${stage.pageId}__mq_${stageSuffix}`);
    console.log(`[Rendering] Generating component visual crops in ${cropsSubdir}...`);
    const cropResult = await renderVisualCropsForPage(
      join(cwd, pageDef.imagePath),
      offers,
      cropsSubdir,
      'offer'
    );
    console.log(`[Rendering] Visual crops generated with ${cropResult.allFlags.length} boundary flags.`);

    // Persist Atomic Record
    const atomicRecord = {
      milestone: 'OPT-004C',
      pageId: stage.pageId,
      stageName: stage.stageName,
      imagePath: pageDef.imagePath,
      imageSha256: pageDef.expectedSha256,
      backend: 'vertex_ai',
      model: 'gemini-3.8-flash',
      promptProfile: 'master_quality',
      schemaProfile: 'optimized',
      thinkingLevel: stage.thinkingLevel,
      serviceTier: 'standard',
      actualTrafficType: (extractionResult.usageReport as any)?.actualServiceTier || 'standard',
      requestDurationMs: durationMs,
      savedAt: new Date().toISOString(),
      rawResponseText: extractionResult.rawResponseText,
      decodedCanonicalOffers: offers,
      usageMetadata: {
        promptTokenCount: promptTokens,
        candidatesTokenCount: candidatesTokens,
        thoughtsTokenCount: thoughtsTokens,
        totalTokenCount: totalTokens
      },
      promptTokens,
      candidatesTokens,
      thoughtsTokens,
      totalTokens,
      costUsd: callCostUsd,
      costBreakdown: cost,
      cropResult: {
        cropsDir: cropsSubdir,
        annotatedImage: cropResult.annotatedPageImagePath,
        boundaryFlags: cropResult.allFlags
      }
    };

    writeFileSync(artifactPath, JSON.stringify(atomicRecord, null, 2), 'utf8');

    // Also write raw_response.json and decoded_extraction.json in the stage folder
    writeFileSync(join(cropsSubdir, 'raw_response.json'), extractionResult.rawResponseText || '{}', 'utf8');
    writeFileSync(join(cropsSubdir, 'decoded_extraction.json'), JSON.stringify(offers, null, 2), 'utf8');

    // Update Ledger
    const successEntry: Opt004cLedgerEntry = {
      attemptIndex: currentAttempts,
      globalAttemptNumber: HISTORICAL_ATTEMPTS + currentAttempts,
      timestamp: new Date().toISOString(),
      stageName: stage.stageName,
      pageId: stage.pageId,
      promptProfile: 'master_quality',
      schemaProfile: 'optimized',
      thinkingLevel: stage.thinkingLevel,
      serviceTier: 'standard',
      backend: 'vertex_ai',
      model: 'gemini-3.8-flash',
      status: 'SUCCESS',
      promptTokens,
      candidatesTokens,
      thoughtsTokens,
      totalTokens,
      inputCostUsd: cost?.inputCostUsd,
      outputCostUsd: cost?.outputCostUsd,
      thinkingCostUsd: cost?.thinkingCostUsd,
      totalCostUsd: callCostUsd,
      requestDurationMs: durationMs,
      offersExtracted: offers.length,
      artifactPath
    };
    ledger.push(successEntry);
    persistLedger();

    // -------------------------------------------------------------------
    // CHECKPOINT EVALUATION AT END OF STAGE PAIR
    // -------------------------------------------------------------------
    if (stage.pageId === 'GOLDEN-P1' && stage.thinkingLevel === 'MEDIUM') {
      console.log('\n--- Checkpoint Stage A: Othaim Canary Validation ---');
      const groundTruth = loadVerifiedGroundTruth(pageDef);
      console.log(`Expected offers: ${groundTruth.length} | Extracted: ${offers.length}`);
      const fairyOffer = offers.find(o =>
        (o.arabic_title?.includes('فيري') || o.english_title?.toLowerCase().includes('fairy')) &&
        o.promo_price === 10
      );
      if (!fairyOffer) {
        console.warn('[CHECKPOINT WARNING] Offer 6 (Fairy Dishwashing Liquid @ 10 SAR) not matched!');
      } else {
        console.log(`[CHECKPOINT PASS] Verified Offer 6 (Fairy Dishwashing Liquid @ 10 SAR, orig: ${fairyOffer.original_price}).`);
      }
    } else if (stage.pageId === 'BNDW-P2' && stage.thinkingLevel === 'MEDIUM') {
      console.log('\n--- Checkpoint Stage B: BinDawood Bakery Validation ---');
      const snickersCake = offers.find(o =>
        o.arabic_title?.includes('سنيكرز') || o.english_title?.toLowerCase().includes('snickers')
      );
      if (snickersCake) {
        console.log(`Snickers Cake brand extracted: "${snickersCake.brand}"`);
        if (snickersCake.brand === null) {
          console.log('[CHECKPOINT PASS] Snickers Cake brand correctly identified as null (flavor ingredient)!');
        } else {
          console.warn(`[CHECKPOINT NOTE] Snickers Cake brand extracted as "${snickersCake.brand}".`);
        }
      }
    } else if (stage.pageId === 'ALWAFA-P1') {
      console.log(`\n--- Checkpoint Stage C (${stage.thinkingLevel}): Alwafa Dense Grid ---`);
      console.log(`Extracted offers: ${offers.length} / 13 expected.`);
    }

    console.log('\n');
  }

  console.log('======================================================================');
  console.log('LIVE BENCHMARK EXECUTION COMPLETE');
  console.log(`Total New Attempts: ${currentAttempts}/${MAX_AUTHORIZED_ATTEMPTS}`);
  console.log(`Total New Spending: $${currentSpendUsd.toFixed(6)} / $${MAX_AUTHORIZED_SPEND_USD}`);
  console.log('======================================================================\n');
}

runOpt004cLiveBenchmark().catch(err => {
  console.error('Benchmark runner failed:', err);
  process.exit(1);
});
