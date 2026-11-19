import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import {
  buildLegacyPageExtractionSystemPrompt,
  buildOptimizedPageExtractionSystemPrompt
} from '../src/main/ocr/geminiPromptBuilder';
import {
  getLeafletPageGenAiSchema,
  decodeLeafletPageExtraction
} from '../src/shared/schemas/leafletPageExtractionSchema';
import { calculateGeminiCost } from '../src/main/ocr/geminiPricingTable';

const cwd = process.cwd();
const apiKey = 'AIzaSyCo5pcKmvuaifVQrakyXRv50hkiNbDpAm4';

interface BenchmarkPageSpec {
  id: string;
  retailer: string;
  pageNum: number;
  imagePath: string;
  expectedOfferCount: number;
}

const benchmarkPages: BenchmarkPageSpec[] = [
  { id: 'GOLDEN-P1', retailer: 'Othaim', pageNum: 1, imagePath: 'test-fixtures/page1_small.png', expectedOfferCount: 9 },
  { id: 'GOLDEN-P4', retailer: 'Othaim', pageNum: 4, imagePath: 'test-fixtures/page4_small.png', expectedOfferCount: 11 },
  { id: 'ALWAFA-P1', retailer: 'Alwafa', pageNum: 1, imagePath: 'Extracts/Alwafa_Test/pages/page.1.png', expectedOfferCount: 13 },
  { id: 'ALWAFA-P2', retailer: 'Alwafa', pageNum: 2, imagePath: 'Extracts/Alwafa_Test/pages/page.2.png', expectedOfferCount: 13 },
  { id: 'ALWAFA-P3', retailer: 'Alwafa', pageNum: 3, imagePath: 'Extracts/Alwafa_Test/pages/page.3.png', expectedOfferCount: 16 },
  { id: 'BNDW-P1', retailer: 'BinDawood', pageNum: 1, imagePath: 'Extracts/BNDW_Test/pages/page.1.png', expectedOfferCount: 14 },
  { id: 'BNDW-P2', retailer: 'BinDawood', pageNum: 2, imagePath: 'Extracts/BNDW_Test/pages/page.2.png', expectedOfferCount: 7 },
  { id: 'BNDW-P3', retailer: 'BinDawood', pageNum: 3, imagePath: 'Extracts/BNDW_Test/pages/page.3.png', expectedOfferCount: 12 },
  { id: 'BNDW-P4', retailer: 'BinDawood', pageNum: 4, imagePath: 'Extracts/BNDW_Test/pages/page.4.png', expectedOfferCount: 12 },
  { id: 'LULU-P1', retailer: 'Lulu', pageNum: 1, imagePath: 'Extracts/Lulu_Test/pages/page.1.png', expectedOfferCount: 4 },
  { id: 'LULU-P2', retailer: 'Lulu', pageNum: 2, imagePath: 'Extracts/Lulu_Test/pages/page.2.png', expectedOfferCount: 11 },
  { id: 'LULU-P3', retailer: 'Lulu', pageNum: 3, imagePath: 'Extracts/Lulu_Test/pages/page.3.png', expectedOfferCount: 11 },
  { id: 'PANDA-P1', retailer: 'Panda', pageNum: 1, imagePath: 'Extracts/Panda_Test/pages/page.1.png', expectedOfferCount: 8 },
  { id: 'PANDA-P2', retailer: 'Panda', pageNum: 2, imagePath: 'Extracts/Panda_Test/pages/page.2.png', expectedOfferCount: 12 },
  { id: 'PANDA-P3', retailer: 'Panda', pageNum: 3, imagePath: 'Extracts/Panda_Test/pages/page.3.png', expectedOfferCount: 15 },
  { id: 'PANDA-P4', retailer: 'Panda', pageNum: 4, imagePath: 'Extracts/PAND-JEDC-150726/pages/page.4.png', expectedOfferCount: 10 },
  { id: 'OTHM-P2', retailer: 'Othaim', pageNum: 2, imagePath: 'Extracts/Othaim_week24/pages/page.2.png', expectedOfferCount: 4 },
  { id: 'OTHM-P3', retailer: 'Othaim', pageNum: 3, imagePath: 'Extracts/Othaim_week24/pages/page.3.png', expectedOfferCount: 6 },
  { id: 'OTHM-P6', retailer: 'Othaim', pageNum: 6, imagePath: 'Extracts/Othaim_week24/pages/page.6.png', expectedOfferCount: 11 },
  { id: 'TAMI-P1', retailer: 'Tamimi', pageNum: 1, imagePath: 'Extracts/TAMI-JEDC-150726/pages/page.1.png', expectedOfferCount: 2 }
];

const flexPageIds = ['GOLDEN-P1', 'ALWAFA-P1', 'BNDW-P1', 'PANDA-P1'];

// Strict authorization limits
const MAX_REQUESTS = 50;
const MAX_SPEND_USD = 5.0;

let currentRequests = 3; // 3 prior exploratory/preflight requests
let currentSpendUsd = 0.0282; // Prior spend

export interface ExecutionRecord {
  pageId: string;
  retailer: string;
  configType: 'legacy_standard' | 'opt_standard' | 'opt_flex';
  durationMs: number;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  costUsd: number;
  offersExtracted: number;
  expectedOffers: number;
  decodedOffers: any[];
  rawText: string;
  accuracyAudit: {
    allCoordinatesValid: boolean;
    hasPrices: boolean;
    hasTitles: boolean;
  };
}

async function executeCall(
  ai: GoogleGenAI,
  page: BenchmarkPageSpec,
  configType: 'legacy_standard' | 'opt_standard' | 'opt_flex'
): Promise<ExecutionRecord> {
  if (currentRequests >= MAX_REQUESTS) {
    throw new Error(`SAFETY_HALT: Maximum authorized requests reached (${MAX_REQUESTS}).`);
  }
  if (currentSpendUsd + 0.05 >= MAX_SPEND_USD) {
    throw new Error(`SAFETY_HALT: Potential spend exceeds authorization limit ($${MAX_SPEND_USD} USD). Current: $${currentSpendUsd.toFixed(4)}`);
  }

  const model = 'gemini-3.8-flash';
  const isOptimized = configType === 'opt_standard' || configType === 'opt_flex';
  const serviceTier = configType === 'opt_flex' ? 'flex' : 'standard';
  const schemaVersion = isOptimized ? 'optimized' : 'legacy';

  const systemInstruction = isOptimized
    ? buildOptimizedPageExtractionSystemPrompt()
    : buildLegacyPageExtractionSystemPrompt();
  const responseSchema = getLeafletPageGenAiSchema(schemaVersion);

  const imgBuf = readFileSync(join(cwd, page.imagePath));
  const jpegBuf = await sharp(imgBuf).jpeg({ quality: 92 }).toBuffer();
  const base64Image = jpegBuf.toString('base64');

  const promptText = 'Analyze this promotional supermarket leaflet page. Extract all offers with exact 2D component bounding boxes.';

  const startTime = Date.now();
  currentRequests++;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: promptText }
        ]
      }
    ],
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: 'HIGH' },
      responseMimeType: 'application/json',
      responseSchema,
      serviceTier
    }
  });

  const durationMs = Date.now() - startTime;
  const rawText = typeof response === 'string' ? response : response?.text || JSON.stringify(response);
  const parsed = JSON.parse(rawText);
  const decoded = decodeLeafletPageExtraction(parsed);

  const meta = response.usageMetadata || {};
  const promptTokens = meta.promptTokenCount ?? 0;
  const candidatesTokens = meta.candidatesTokenCount ?? meta.responseTokenCount ?? 0;
  const thoughtsTokens = meta.thoughtsTokenCount ?? 0;
  const totalTokens = meta.totalTokenCount ?? (promptTokens + candidatesTokens + thoughtsTokens);

  const cost = calculateGeminiCost(
    {
      promptTokenCount: promptTokens,
      candidatesTokenCount: candidatesTokens,
      thoughtsTokenCount: thoughtsTokens
    },
    model,
    serviceTier
  );

  currentSpendUsd += cost.totalCostUsd;

  // Audit offer bounding boxes and prices
  let allCoordsValid = true;
  let allPricesValid = true;
  let allTitlesValid = true;

  for (const o of decoded.offers) {
    if (typeof o.promo_price !== 'number' || o.promo_price <= 0) allPricesValid = false;
    if (!o.arabic_title && !o.english_title) allTitlesValid = false;
    const g = o.components.product_graphic_box;
    const p = o.components.promo_price_box;
    if (!g || g.length !== 4 || g.some(v => v < 0 || v > 1000) || g[0] > g[2] || g[1] > g[3]) allCoordsValid = false;
    if (!p || p.length !== 4 || p.some(v => v < 0 || v > 1000) || p[0] > p[2] || p[1] > p[3]) allCoordsValid = false;
  }

  console.log(
    `[Request ${currentRequests}/${MAX_REQUESTS}] ${page.id} (${configType}): ` +
    `Offers=${decoded.offers.length}/${page.expectedOfferCount}, ` +
    `Tokens=(in:${promptTokens}, out:${candidatesTokens}, th:${thoughtsTokens}), ` +
    `Time=${durationMs}ms, Cost=$${cost.totalCostUsd.toFixed(6)}, CumulSpend=$${currentSpendUsd.toFixed(4)}`
  );

  return {
    pageId: page.id,
    retailer: page.retailer,
    configType,
    durationMs,
    promptTokens,
    candidatesTokens,
    thoughtsTokens,
    totalTokens,
    costUsd: cost.totalCostUsd,
    offersExtracted: decoded.offers.length,
    expectedOffers: page.expectedOfferCount,
    decodedOffers: decoded.offers,
    rawText,
    accuracyAudit: {
      allCoordinatesValid: allCoordsValid,
      hasPrices: allPricesValid,
      hasTitles: allTitlesValid
    }
  };
}

async function runLiveBenchmark() {
  console.log('=== STARTING CONTROLLED LIVE BENCHMARK (GEMINI 3.8 FLASH) ===');
  console.log(`Max Requests: ${MAX_REQUESTS} | Max Spend: $${MAX_SPEND_USD} USD\n`);

  const ai = new GoogleGenAI({ apiKey });
  const records: ExecutionRecord[] = [];

  // Pass 1: Paired Benchmark (Legacy Standard vs Optimized Standard on 20 pages)
  console.log('--- PHASE 1: Paired Legacy Standard vs Optimized Standard (20 pages, 40 calls) ---');
  for (let i = 0; i < benchmarkPages.length; i++) {
    const page = benchmarkPages[i];
    console.log(`\nEvaluating Page ${i + 1}/20: ${page.id} (${page.retailer})...`);

    // 1. Legacy Standard
    const legRec = await executeCall(ai, page, 'legacy_standard');
    records.push(legRec);

    // 2. Optimized Standard
    const optRec = await executeCall(ai, page, 'opt_standard');
    records.push(optRec);
  }

  // Pass 2: Flex Validation on 4 representative pages
  console.log('\n--- PHASE 2: Flex Validation on 4 Representative Pages ---');
  for (const pageId of flexPageIds) {
    const page = benchmarkPages.find(p => p.id === pageId)!;
    console.log(`\nEvaluating Flex Tier on ${page.id} (${page.retailer})...`);
    const flexRec = await executeCall(ai, page, 'opt_flex');
    records.push(flexRec);
  }

  // Save full results to disk
  const outputPath = join(cwd, 'temp/live_benchmark_results.json');
  writeFileSync(outputPath, JSON.stringify(records, null, 2), 'utf8');
  console.log(`\nRaw live benchmark results saved to: ${outputPath}`);

  // Compute aggregate statistics
  const legacyRecords = records.filter(r => r.configType === 'legacy_standard');
  const optRecords = records.filter(r => r.configType === 'opt_standard');
  const flexRecords = records.filter(r => r.configType === 'opt_flex');

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => sum(arr) / arr.length;

  console.log('\n=== AGGREGATE RESULTS SUMMARY ===');
  console.log(`Total Requests Made: ${currentRequests}`);
  console.log(`Total Spent: $${currentSpendUsd.toFixed(4)} USD`);

  console.log('\n1. Token & Latency Comparisons across 20 Paired Pages:');
  console.log(`   Legacy Standard:`);
  console.log(`     Avg Prompt Tokens:     ${Math.round(avg(legacyRecords.map(r => r.promptTokens)))}`);
  console.log(`     Avg Candidate Tokens:  ${Math.round(avg(legacyRecords.map(r => r.candidatesTokens)))}`);
  console.log(`     Avg Thoughts Tokens:   ${Math.round(avg(legacyRecords.map(r => r.thoughtsTokens)))}`);
  console.log(`     Avg Total Tokens:      ${Math.round(avg(legacyRecords.map(r => r.totalTokens)))}`);
  console.log(`     Avg Latency:           ${Math.round(avg(legacyRecords.map(r => r.durationMs)))}ms`);
  console.log(`     Total Cost (20 pg):    $${sum(legacyRecords.map(r => r.costUsd)).toFixed(4)} USD`);

  console.log(`   Optimized Standard:`);
  console.log(`     Avg Prompt Tokens:     ${Math.round(avg(optRecords.map(r => r.promptTokens)))}`);
  console.log(`     Avg Candidate Tokens:  ${Math.round(avg(optRecords.map(r => r.candidatesTokens)))}`);
  console.log(`     Avg Thoughts Tokens:   ${Math.round(avg(optRecords.map(r => r.thoughtsTokens)))}`);
  console.log(`     Avg Total Tokens:      ${Math.round(avg(optRecords.map(r => r.totalTokens)))}`);
  console.log(`     Avg Latency:           ${Math.round(avg(optRecords.map(r => r.durationMs)))}ms`);
  console.log(`     Total Cost (20 pg):    $${sum(optRecords.map(r => r.costUsd)).toFixed(4)} USD`);

  const candSavings = ((avg(legacyRecords.map(r => r.candidatesTokens)) - avg(optRecords.map(r => r.candidatesTokens))) / avg(legacyRecords.map(r => r.candidatesTokens))) * 100;
  const costSavings = ((sum(legacyRecords.map(r => r.costUsd)) - sum(optRecords.map(r => r.costUsd))) / sum(legacyRecords.map(r => r.costUsd))) * 100;
  console.log(`   Optimized Standard Savings: Candidate Tokens: ${candSavings.toFixed(1)}%, Cost: ${costSavings.toFixed(1)}%`);

  console.log('\n2. Economy Flex Validation (4 Pages):');
  console.log(`     Avg Latency:           ${Math.round(avg(flexRecords.map(r => r.durationMs)))}ms`);
  console.log(`     Total Cost (4 pg):     $${sum(flexRecords.map(r => r.costUsd)).toFixed(4)} USD`);
  console.log(`     Avg Cost / Page:       $${(sum(flexRecords.map(r => r.costUsd)) / 4).toFixed(6)} USD`);

  // Accuracy Comparison against reference offer counts
  console.log('\n3. Accuracy & Completeness Comparison:');
  let totalExpectedOffers = sum(benchmarkPages.map(p => p.expectedOfferCount));
  let totalLegacyExtracted = sum(legacyRecords.map(r => r.offersExtracted));
  let totalOptExtracted = sum(optRecords.map(r => r.offersExtracted));
  console.log(`   Total Target Ground-Truth Offers: ${totalExpectedOffers}`);
  console.log(`   Legacy Standard Extracted Offers: ${totalLegacyExtracted} (${((totalLegacyExtracted / totalExpectedOffers) * 100).toFixed(1)}%)`);
  console.log(`   Optimized Standard Extracted:     ${totalOptExtracted} (${((totalOptExtracted / totalExpectedOffers) * 100).toFixed(1)}%)`);
}

runLiveBenchmark().catch(err => {
  console.error('\nBenchmark Execution Error:', err);
  process.exit(1);
});
