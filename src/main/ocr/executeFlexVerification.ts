import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { GeminiExtractionService } from './geminiExtractionService';

interface FlexBenchmarkPage {
  id: string;
  retailer: string;
  pageNum: number;
  imagePath: string;
}

const FLEX_VERIFICATION_PAGES: FlexBenchmarkPage[] = [
  { id: 'GOLDEN-P1', retailer: 'Othaim', pageNum: 1, imagePath: 'test-fixtures/page1_small.png' },
  { id: 'ALWAFA-P1', retailer: 'Alwafa', pageNum: 1, imagePath: 'Extracts/Alwafa_Test/pages/page.1.png' },
  { id: 'BNDW-P1', retailer: 'BinDawood', pageNum: 1, imagePath: 'Extracts/BNDW_Test/pages/page.1.png' },
  { id: 'BNDW-P2', retailer: 'BinDawood', pageNum: 2, imagePath: 'Extracts/BNDW_Test/pages/page.2.png' }
];

const MAX_NEW_ATTEMPTS = 40;
const MAX_NEW_SPEND_USD = 1.50;
const PROJECT_CEILING_USD = 5.00;

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

function computeImageSha256(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

export async function runFlexVerification() {
  console.log('================================================================================');
  console.log('WIFRAN-GEMINI-OPT-003: VERTEX AI FLEX INFERENCE VERIFICATION');
  console.log('Schema: Legacy (Retained Default) | Service Tier: Flex PayGo');
  console.log('Headers: X-Vertex-AI-LLM-Request-Type: shared, X-Vertex-AI-LLM-Shared-Request-Type: flex');
  console.log('Target: 4 Representative Pages (GOLDEN-P1, ALWAFA-P1, BNDW-P1, BNDW-P2)');
  console.log('================================================================================\n');

  const geminiService = new GeminiExtractionService();
  const runsDir = join(process.cwd(), 'temp/benchmark_runs');

  const results: any[] = [];

  for (const page of FLEX_VERIFICATION_PAGES) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`Executing Vertex Flex for ${page.id} (${page.retailer} Page ${page.pageNum})...`);
    console.log(`--------------------------------------------------------------------------------`);

    const recordPath = join(runsDir, `${page.id}__legacy_flex.json`);
    let record: any;

    if (existsSync(recordPath)) {
      console.log(`[Cache Hit] Legacy Flex record already exists on disk for ${page.id}. Reusing.`);
      record = JSON.parse(readFileSync(recordPath, 'utf8'));
    } else {
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

      const startTime = Date.now();
      const extraction = await geminiService.extractLeafletPage({
        imagePath: page.imagePath,
        pageNumber: page.pageNum,
        schemaVersion: 'legacy',
        executionMode: 'flex',
        forceReextract: true
      });
      const durationMs = Date.now() - startTime;

      const promptTokens = extraction.usageReport?.usage.promptTokenCount || 0;
      const candidatesTokens = extraction.usageReport?.usage.candidatesTokenCount || 0;
      const thoughtsTokens = extraction.usageReport?.usage.thoughtsTokenCount || 0;
      const totalTokens = extraction.usageReport?.usage.totalTokenCount || (promptTokens + candidatesTokens + thoughtsTokens);
      const trafficType = extraction.usageReport?.actualServiceTier === 'flex' ? 'ON_DEMAND_FLEX' : 'ON_DEMAND';

      // Flex Pricing: input $0.375 / 1M, output (candidates + thoughts) $1.875 / 1M
      const costUsd = Number(((promptTokens / 1_000_000 * 0.375) + ((candidatesTokens + thoughtsTokens) / 1_000_000 * 1.875)).toFixed(6));

      record = {
        pageId: page.id,
        retailer: page.retailer,
        imagePath: page.imagePath,
        imageSha256: computeImageSha256(page.imagePath),
        backend: 'vertex',
        model: 'gemini-3.8-flash',
        schemaVersion: 'legacy',
        promptVersion: 'legacy',
        configType: 'legacy_flex',
        requestedServiceTier: 'flex',
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
      const tmpPath = `${recordPath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
      renameSync(tmpPath, recordPath);

      // Record to ledger
      const attemptNum = updatedLedger.length + 1;
      const ledgerEntry = {
        attemptNumber: attemptNum,
        timestamp: new Date().toISOString(),
        pageId: page.id,
        configType: 'legacy_flex',
        backend: 'vertex',
        model: 'gemini-3.8-flash',
        status: 'success',
        trafficType,
        promptTokens,
        candidatesTokens,
        thoughtsTokens,
        totalTokens,
        costUsd,
        recordFile: recordPath
      };
      updatedLedger.push(ledgerEntry);
      saveLedger(updatedLedger);

      console.log(`[Success] Vertex Flex completed for ${page.id}: ${extraction.offers.length} offers | Duration: ${(durationMs / 1000).toFixed(1)}s | Traffic: ${trafficType} | Cost: $${costUsd.toFixed(6)}`);
    }

    results.push(record);

    // Verify Standard vs Flex comparison for this page
    const standardRecordPath = join(runsDir, `${page.id}__legacy_standard.json`);
    if (existsSync(standardRecordPath)) {
      const stdRecord = JSON.parse(readFileSync(standardRecordPath, 'utf8'));
      const costSavingsPct = ((record.costUsd - stdRecord.costUsd) / stdRecord.costUsd * 100).toFixed(1);
      console.log(`[Standard vs Flex Comparison for ${page.id}]`);
      console.log(`- Standard Cost: $${stdRecord.costUsd.toFixed(6)} vs Flex Cost: $${record.costUsd.toFixed(6)} (${costSavingsPct}% reduction)`);
      console.log(`- Standard Latency: ${(stdRecord.requestDurationMs / 1000).toFixed(1)}s vs Flex Latency: ${(record.requestDurationMs / 1000).toFixed(1)}s`);
      console.log(`- Standard Offers: ${stdRecord.decodedCanonicalOffers.length} vs Flex Offers: ${record.decodedCanonicalOffers.length}`);
    }
  }

  console.log('\n================================================================================');
  console.log('VERTEX AI FLEX VERIFICATION COMPLETED');
  console.log('================================================================================');
  const finalLedger = loadLedger();
  const finalNewAttempts = finalLedger.filter(e => e.attemptNumber >= 52);
  const finalNewSpend = finalNewAttempts.reduce((acc, e) => acc + (e.costUsd || 0), 0);
  const finalTotalSpend = finalLedger.reduce((acc, e) => acc + (e.costUsd || 0), 0);
  console.log(`Total Attempts Used: ${finalNewAttempts.length} / ${MAX_NEW_ATTEMPTS} (Remaining: ${MAX_NEW_ATTEMPTS - finalNewAttempts.length})`);
  console.log(`Total New Spend: $${finalNewSpend.toFixed(6)} / $${MAX_NEW_SPEND_USD.toFixed(2)} (Remaining: $${(MAX_NEW_SPEND_USD - finalNewSpend).toFixed(6)})`);
  console.log(`Cumulative Project Spend: $${finalTotalSpend.toFixed(6)} / $${PROJECT_CEILING_USD.toFixed(2)}`);

  return results;
}

if (process.argv[1]?.endsWith('executeFlexVerification.ts') || process.argv[1]?.endsWith('executeFlexVerification.js')) {
  runFlexVerification().catch(err => {
    console.error('Flex verification failed:', err);
    process.exit(1);
  });
}

