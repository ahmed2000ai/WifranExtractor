import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { GeminiExtractionService } from './geminiExtractionService';
import { evaluatePageAccuracy, PageAccuracyReport } from './accuracyEvaluator';

interface BenchmarkPage {
  id: string;
  retailer: string;
  pageNum: number;
  imagePath: string;
  gtFolder: string;
  expectedOfferCount: number;
}

const STAGE_B1_PAGES: BenchmarkPage[] = [
  { id: 'ALWAFA-P1', retailer: 'Alwafa', pageNum: 1, imagePath: 'Extracts/Alwafa_Test/pages/page.1.png', gtFolder: 'Extracts/Alwafa_Test', expectedOfferCount: 13 },
  { id: 'ALWAFA-P2', retailer: 'Alwafa', pageNum: 2, imagePath: 'Extracts/Alwafa_Test/pages/page.2.png', gtFolder: 'Extracts/Alwafa_Test', expectedOfferCount: 13 },
  { id: 'ALWAFA-P3', retailer: 'Alwafa', pageNum: 3, imagePath: 'Extracts/Alwafa_Test/pages/page.3.png', gtFolder: 'Extracts/Alwafa_Test', expectedOfferCount: 16 },
  { id: 'BNDW-P1', retailer: 'BinDawood', pageNum: 1, imagePath: 'Extracts/BNDW_Test/pages/page.1.png', gtFolder: 'Extracts/BNDW_Test', expectedOfferCount: 14 },
  { id: 'BNDW-P2', retailer: 'BinDawood', pageNum: 2, imagePath: 'Extracts/BNDW_Test/pages/page.2.png', gtFolder: 'Extracts/BNDW_Test', expectedOfferCount: 7 },
  { id: 'BNDW-P3', retailer: 'BinDawood', pageNum: 3, imagePath: 'Extracts/BNDW_Test/pages/page.3.png', gtFolder: 'Extracts/BNDW_Test', expectedOfferCount: 12 },
  { id: 'BNDW-P4', retailer: 'BinDawood', pageNum: 4, imagePath: 'Extracts/BNDW_Test/pages/page.4.png', gtFolder: 'Extracts/BNDW_Test', expectedOfferCount: 12 }
];

const MAX_NEW_ATTEMPTS = 40;
const MAX_NEW_SPEND_USD = 1.50;
const PROJECT_CEILING_USD = 5.00;
const INITIAL_HISTORICAL_SPEND_USD = 1.721410; // Prior to Canary 52/53

function loadLedger(): any[] {
  const ledgerPath = join(process.cwd(), 'temp/benchmark_ledger.json');
  if (existsSync(ledgerPath)) {
    return JSON.parse(readFileSync(ledgerPath, 'utf8'));
  }
  return [];
}

function saveLedger(ledger: any[]) {
  const ledgerPath = join(process.cwd(), 'temp/benchmark_ledger.json');
  const tmp = `${ledgerPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  renameSync(tmp, ledgerPath);
}

function loadGroundTruthOffers(gtFolder: string, pageNum: number): any[] {
  const pad = String(pageNum).padStart(3, '0');
  const jsonDir = join(process.cwd(), gtFolder, 'json');
  const files = readdirSync(jsonDir)
    .filter(f => f.startsWith(`page-${pad}-`) && f.endsWith('.canonical.json'))
    .sort();

  return files.map(f => {
    const raw = JSON.parse(readFileSync(join(jsonDir, f), 'utf8'));
    return raw.raw?.raw_attributes?.raw_offer_extraction || raw;
  });
}

function computeImageSha256(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

export async function runStageB1Benchmark() {
  console.log('================================================================================');
  console.log('WIFRAN-GEMINI-OPT-003: STAGE B1 LIVE BENCHMARK EXECUTION');
  console.log('Target: 7 Fully Annotated Pages (Alwafa 1-3, BinDawood 1-4) — 87 Offers');
  console.log('================================================================================\n');

  const ledger = loadLedger();
  const priorAttempts = ledger.filter(e => e.attemptNumber < 52);
  const newAttempts = ledger.filter(e => e.attemptNumber >= 52);
  const currentNewSpend = newAttempts.reduce((acc, e) => acc + (e.costUsd || 0), 0);
  const currentTotalSpend = ledger.reduce((acc, e) => acc + (e.costUsd || 0), 0);

  console.log(`Initial Ledger State:`);
  console.log(`- Total attempts logged: ${ledger.length}`);
  console.log(`- Prior historical attempts: ${priorAttempts.length} (Spend: $${INITIAL_HISTORICAL_SPEND_USD.toFixed(6)})`);
  console.log(`- New authorization attempts used: ${newAttempts.length} / ${MAX_NEW_ATTEMPTS}`);
  console.log(`- New authorization spend used: $${currentNewSpend.toFixed(6)} / $${MAX_NEW_SPEND_USD.toFixed(2)}`);
  console.log(`- Cumulative project spend: $${currentTotalSpend.toFixed(6)} / $${PROJECT_CEILING_USD.toFixed(2)}\n`);

  const geminiService = new GeminiExtractionService();
  const runsDir = join(process.cwd(), 'temp/benchmark_runs');

  const pageReports: PageAccuracyReport[] = [];

  for (const page of STAGE_B1_PAGES) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`Processing Page: ${page.id} (${page.retailer} Page ${page.pageNum})`);
    console.log(`Image: ${page.imagePath} | Expected Offers: ${page.expectedOfferCount}`);
    console.log(`--------------------------------------------------------------------------------`);

    const imageSha256 = computeImageSha256(page.imagePath);
    const gtOffers = loadGroundTruthOffers(page.gtFolder, page.pageNum);

    // 1. Legacy Standard
    const legacyRecordPath = join(runsDir, `${page.id}__legacy_standard.json`);
    let legacyRecord: any;

    if (existsSync(legacyRecordPath)) {
      console.log(`[Cache Hit] Legacy Standard record already exists on disk for ${page.id}. Reusing.`);
      legacyRecord = JSON.parse(readFileSync(legacyRecordPath, 'utf8'));
    } else {
      // Check limits before executing
      const updatedLedger = loadLedger();
      const currentNewCalls = updatedLedger.filter(e => e.attemptNumber >= 52).length;
      const currentSpend = updatedLedger.reduce((acc, e) => acc + (e.costUsd || 0), 0);
      const newSpend = updatedLedger.filter(e => e.attemptNumber >= 52).reduce((acc, e) => acc + (e.costUsd || 0), 0);

      if (currentNewCalls >= MAX_NEW_ATTEMPTS) {
        throw new Error(`ABORT: New request allowance reached (${currentNewCalls}/${MAX_NEW_ATTEMPTS}). Halting.`);
      }
      if (newSpend >= MAX_NEW_SPEND_USD) {
        throw new Error(`ABORT: New spending cap reached ($${newSpend.toFixed(6)}/$${MAX_NEW_SPEND_USD}). Halting.`);
      }
      if (currentSpend >= PROJECT_CEILING_USD) {
        throw new Error(`ABORT: Project ceiling reached ($${currentSpend.toFixed(6)}/$${PROJECT_CEILING_USD}). Halting.`);
      }

      console.log(`[API Call] Executing Legacy Standard for ${page.id}...`);
      const startTime = Date.now();
      const extraction = await geminiService.extractLeafletPage({
        imagePath: page.imagePath,
        pageNumber: page.pageNum,
        schemaVersion: 'legacy',
        executionMode: 'standard',
        forceReextract: true
      });
      const durationMs = Date.now() - startTime;

      const promptTokens = extraction.usageReport?.usage.promptTokenCount || 0;
      const candidatesTokens = extraction.usageReport?.usage.candidatesTokenCount || 0;
      const thoughtsTokens = extraction.usageReport?.usage.thoughtsTokenCount || 0;
      const totalTokens = extraction.usageReport?.usage.totalTokenCount || (promptTokens + candidatesTokens + thoughtsTokens);
      const trafficType = extraction.usageReport?.actualServiceTier === 'flex' ? 'ON_DEMAND_FLEX' : 'ON_DEMAND';

      // Official Gemini pricing: input $0.75 / 1M, output (candidates + thoughts) $3.75 / 1M
      const costUsd = Number(((promptTokens / 1_000_000 * 0.75) + ((candidatesTokens + thoughtsTokens) / 1_000_000 * 3.75)).toFixed(6));

      legacyRecord = {
        pageId: page.id,
        retailer: page.retailer,
        imagePath: page.imagePath,
        imageSha256,
        backend: 'vertex',
        model: 'gemini-3.8-flash',
        schemaVersion: 'legacy',
        promptVersion: 'legacy',
        configType: 'legacy_standard',
        requestedServiceTier: 'standard',
        actualTrafficType: trafficType,
        thinkingConfig: { thinkingLevel: 'HIGH' },
        rawResponseText: '',
        decodedCanonicalOffers: extraction.offers,
        usageMetadata: extraction.usageReport?.usage,
        promptTokens,
        candidatesTokens,
        thoughtsTokens,
        totalTokens,
        requestDurationMs: durationMs,
        costUsd,
        benchmarkCompletionStatus: 'completed',
        savedAt: new Date().toISOString()
      };

      // Atomic save
      const tmpPath = `${legacyRecordPath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(legacyRecord, null, 2), 'utf8');
      renameSync(tmpPath, legacyRecordPath);

      // Record to ledger
      const attemptNum = updatedLedger.length + 1;
      const ledgerEntry = {
        attemptNumber: attemptNum,
        timestamp: new Date().toISOString(),
        pageId: page.id,
        configType: 'legacy_standard',
        backend: 'vertex',
        model: 'gemini-3.8-flash',
        status: 'success',
        trafficType,
        promptTokens,
        candidatesTokens,
        thoughtsTokens,
        totalTokens,
        costUsd,
        recordFile: legacyRecordPath
      };
      updatedLedger.push(ledgerEntry);
      saveLedger(updatedLedger);

      console.log(`[Success] Legacy Standard completed: ${extraction.offers.length} offers | Duration: ${(durationMs / 1000).toFixed(1)}s | Tokens: in=${promptTokens}, out=${candidatesTokens}, th=${thoughtsTokens} | Cost: $${costUsd.toFixed(6)}`);
    }

    // 2. Optimized Standard
    const optRecordPath = join(runsDir, `${page.id}__opt_standard.json`);
    let optRecord: any;

    if (existsSync(optRecordPath)) {
      console.log(`[Cache Hit] Optimized Standard record already exists on disk for ${page.id}. Reusing.`);
      optRecord = JSON.parse(readFileSync(optRecordPath, 'utf8'));
    } else {
      // Check limits before executing
      const updatedLedger = loadLedger();
      const currentNewCalls = updatedLedger.filter(e => e.attemptNumber >= 52).length;
      const currentSpend = updatedLedger.reduce((acc, e) => acc + (e.costUsd || 0), 0);
      const newSpend = updatedLedger.filter(e => e.attemptNumber >= 52).reduce((acc, e) => acc + (e.costUsd || 0), 0);

      if (currentNewCalls >= MAX_NEW_ATTEMPTS) {
        throw new Error(`ABORT: New request allowance reached (${currentNewCalls}/${MAX_NEW_ATTEMPTS}). Halting.`);
      }
      if (newSpend >= MAX_NEW_SPEND_USD) {
        throw new Error(`ABORT: New spending cap reached ($${newSpend.toFixed(6)}/$${MAX_NEW_SPEND_USD}). Halting.`);
      }
      if (currentSpend >= PROJECT_CEILING_USD) {
        throw new Error(`ABORT: Project ceiling reached ($${currentSpend.toFixed(6)}/$${PROJECT_CEILING_USD}). Halting.`);
      }

      console.log(`[API Call] Executing Optimized Standard for ${page.id}...`);
      const startTime = Date.now();
      const extraction = await geminiService.extractLeafletPage({
        imagePath: page.imagePath,
        pageNumber: page.pageNum,
        schemaVersion: 'optimized',
        executionMode: 'standard',
        forceReextract: true
      });
      const durationMs = Date.now() - startTime;

      const promptTokens = extraction.usageReport?.usage.promptTokenCount || 0;
      const candidatesTokens = extraction.usageReport?.usage.candidatesTokenCount || 0;
      const thoughtsTokens = extraction.usageReport?.usage.thoughtsTokenCount || 0;
      const totalTokens = extraction.usageReport?.usage.totalTokenCount || (promptTokens + candidatesTokens + thoughtsTokens);
      const trafficType = extraction.usageReport?.actualServiceTier === 'flex' ? 'ON_DEMAND_FLEX' : 'ON_DEMAND';

      // Official Gemini pricing: input $0.75 / 1M, output (candidates + thoughts) $3.75 / 1M
      const costUsd = Number(((promptTokens / 1_000_000 * 0.75) + ((candidatesTokens + thoughtsTokens) / 1_000_000 * 3.75)).toFixed(6));

      optRecord = {
        pageId: page.id,
        retailer: page.retailer,
        imagePath: page.imagePath,
        imageSha256,
        backend: 'vertex',
        model: 'gemini-3.8-flash',
        schemaVersion: 'optimized',
        promptVersion: 'optimized',
        configType: 'opt_standard',
        requestedServiceTier: 'standard',
        actualTrafficType: trafficType,
        thinkingConfig: { thinkingLevel: 'HIGH' },
        rawResponseText: '',
        decodedCanonicalOffers: extraction.offers,
        usageMetadata: extraction.usageReport?.usage,
        promptTokens,
        candidatesTokens,
        thoughtsTokens,
        totalTokens,
        requestDurationMs: durationMs,
        costUsd,
        benchmarkCompletionStatus: 'completed',
        savedAt: new Date().toISOString()
      };

      // Atomic save
      const tmpPath = `${optRecordPath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(optRecord, null, 2), 'utf8');
      renameSync(tmpPath, optRecordPath);

      // Record to ledger
      const attemptNum = updatedLedger.length + 1;
      const ledgerEntry = {
        attemptNumber: attemptNum,
        timestamp: new Date().toISOString(),
        pageId: page.id,
        configType: 'opt_standard',
        backend: 'vertex',
        model: 'gemini-3.8-flash',
        status: 'success',
        trafficType,
        promptTokens,
        candidatesTokens,
        thoughtsTokens,
        totalTokens,
        costUsd,
        recordFile: optRecordPath
      };
      updatedLedger.push(ledgerEntry);
      saveLedger(updatedLedger);

      console.log(`[Success] Optimized Standard completed: ${extraction.offers.length} offers | Duration: ${(durationMs / 1000).toFixed(1)}s | Tokens: in=${promptTokens}, out=${candidatesTokens}, th=${thoughtsTokens} | Cost: $${costUsd.toFixed(6)}`);
    }

    // 3. Evaluate Accuracy & Zero Regression Invariant
    const accuracyReport = evaluatePageAccuracy(
      page.id,
      page.retailer,
      legacyRecord.decodedCanonicalOffers,
      optRecord.decodedCanonicalOffers,
      gtOffers
    );
    pageReports.push(accuracyReport);

    console.log(`\n[Accuracy Evaluation for ${page.id}]`);
    console.log(`- Ground Truth Offers: ${gtOffers.length} | Legacy Offers: ${legacyRecord.decodedCanonicalOffers.length} | Opt Offers: ${optRecord.decodedCanonicalOffers.length}`);
    console.log(`- Mean Graphic IoU: ${(accuracyReport.meanGraphicIoU * 100).toFixed(1)}%`);
    console.log(`- Mean Promo Price IoU: ${(accuracyReport.meanPromoPriceIoU * 100).toFixed(1)}%`);
    console.log(`- Mean Title IoU: ${(accuracyReport.meanTitleIoU * 100).toFixed(1)}%`);
    if (accuracyReport.meanOriginalPriceIoU !== null) {
      console.log(`- Mean Original Price IoU: ${(accuracyReport.meanOriginalPriceIoU * 100).toFixed(1)}%`);
    }
    if (accuracyReport.meanUnitBadgeIoU !== null) {
      console.log(`- Mean Unit Badge IoU: ${(accuracyReport.meanUnitBadgeIoU * 100).toFixed(1)}%`);
    }
    console.log(`- Regressions Detected: ${accuracyReport.hasRegressions ? 'YES (HALTING)' : 'ZERO'}`);

    if (accuracyReport.hasRegressions) {
      console.error(`\nCRITICAL REGRESSION DETECTED ON ${page.id}:`);
      accuracyReport.regressionDetails.forEach(d => console.error(`  - ${d}`));
      throw new Error(`Stopping benchmark: Regression detected on ${page.id}. Invariant violated.`);
    }

    // Savings for this page
    const promptDeltaPct = ((optRecord.promptTokens - legacyRecord.promptTokens) / legacyRecord.promptTokens * 100).toFixed(1);
    const candDeltaPct = ((optRecord.candidatesTokens - legacyRecord.candidatesTokens) / legacyRecord.candidatesTokens * 100).toFixed(1);
    const totalDeltaPct = ((optRecord.totalTokens - legacyRecord.totalTokens) / legacyRecord.totalTokens * 100).toFixed(1);
    const costDeltaPct = ((optRecord.costUsd - legacyRecord.costUsd) / legacyRecord.costUsd * 100).toFixed(1);
    console.log(`[Savings on ${page.id}] Prompt: ${promptDeltaPct}% | Candidates: ${candDeltaPct}% | Total: ${totalDeltaPct}% | Cost: ${costDeltaPct}%\n`);
  }

  // Summary
  console.log('================================================================================');
  console.log('STAGE B1 BENCHMARK COMPLETED SUCCESSFULLY — ZERO OBSERVED REGRESSIONS');
  console.log('================================================================================');
  const finalLedger = loadLedger();
  const finalNewAttempts = finalLedger.filter(e => e.attemptNumber >= 52);
  const finalNewSpend = finalNewAttempts.reduce((acc, e) => acc + (e.costUsd || 0), 0);
  const finalTotalSpend = finalLedger.reduce((acc, e) => acc + (e.costUsd || 0), 0);
  console.log(`Attempts Used: ${finalNewAttempts.length} / ${MAX_NEW_ATTEMPTS} (Remaining: ${MAX_NEW_ATTEMPTS - finalNewAttempts.length})`);
  console.log(`New Spend: $${finalNewSpend.toFixed(6)} / $${MAX_NEW_SPEND_USD.toFixed(2)} (Remaining: $${(MAX_NEW_SPEND_USD - finalNewSpend).toFixed(6)})`);
  console.log(`Total Spend: $${finalTotalSpend.toFixed(6)} / $${PROJECT_CEILING_USD.toFixed(2)}`);

  return pageReports;
}

if (process.argv[1]?.endsWith('executeStageB1Benchmark.ts') || process.argv[1]?.endsWith('executeStageB1Benchmark.js')) {
  runStageB1Benchmark().catch(err => {
    console.error('Execution failed:', err);
    process.exit(1);
  });
}

