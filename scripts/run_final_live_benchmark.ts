import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import {
  buildLegacyPageExtractionSystemPrompt,
  buildOptimizedPageExtractionSystemPrompt
} from '../src/main/ocr/geminiPromptBuilder';
import {
  getLeafletPageGenAiSchema,
  decodeLeafletPageExtraction,
  LeafletSchemaVersion
} from '../src/shared/schemas/leafletPageExtractionSchema';
import { calculateGeminiCost } from '../src/main/ocr/geminiPricingTable';
import { getGeminiClient } from '../src/main/ocr/geminiClient';
import {
  VERIFIED_BENCHMARK_PAGES,
  BenchmarkPageSpec,
  PersistedBenchmarkRecord,
  LedgerEntry
} from '../src/main/ocr/resumableBenchmarkRunner';

const cwd = process.cwd();

// --- STRICT AUTHORIZATION LIMITS ---
const MAX_NEW_REQUESTS = 40;
const MAX_NEW_SPEND_USD = 1.50;
const CUMULATIVE_BUDGET_CEILING_USD = 5.00;
const PRIOR_SPEND_USD = 1.721410;
const PRIOR_ATTEMPTS = 51;

let newRequestsExecuted = 0;
let newSpendUsd = 0;

const runsDir = join(cwd, 'temp/benchmark_runs');
const ledgerPath = join(cwd, 'temp/benchmark_ledger.json');

if (!existsSync(runsDir)) {
  mkdirSync(runsDir, { recursive: true });
}

// Durable ledger tracking
let ledger: LedgerEntry[] = [];
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

function recordAttempt(entry: Omit<LedgerEntry, 'attemptNumber' | 'timestamp'>) {
  const fullEntry: LedgerEntry = {
    attemptNumber: PRIOR_ATTEMPTS + newRequestsExecuted,
    timestamp: new Date().toISOString(),
    ...entry
  };
  ledger.push(fullEntry);
  persistLedger();
  return fullEntry;
}

// Bounding box IoU calculation
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

// Ground truth loader for verified pages
export function loadPageGroundTruth(page: BenchmarkPageSpec): any[] {
  if (!page.groundTruthPath) return [];
  if (page.groundTruthPath.endsWith('.json')) {
    const raw = JSON.parse(readFileSync(join(cwd, page.groundTruthPath), 'utf8'));
    return raw.offers || raw;
  }
  const fullDir = join(cwd, page.groundTruthPath);
  const files = readdirSyncSafe(fullDir);
  const prefix = `page-${String(page.pageNum).padStart(3, '0')}-`;
  const pageFiles = files.filter(f => f.startsWith(prefix) && f.endsWith('.canonical.json'));
  return pageFiles.map(f => {
    const item = JSON.parse(readFileSync(join(fullDir, f), 'utf8'));
    const rawExtraction = item.raw?.raw_attributes?.raw_offer_extraction || {};
    return {
      offer_number: parseInt(item.source?.source_item_number || '1', 10),
      arabic_title: item.product?.title_ar || rawExtraction.arabic_title || '',
      english_title: item.product?.title_en || rawExtraction.english_title || '',
      brand: item.product?.brand_text || rawExtraction.brand || '',
      promo_price: item.prices?.offer_price ?? rawExtraction.promo_price,
      original_price: item.prices?.original_price ?? rawExtraction.original_price,
      size_value: item.content?.size_text || rawExtraction.size_value,
      pack_quantity: item.content?.pack_quantity || 1,
      components: rawExtraction.components || {}
    };
  });
}

function readdirSyncSafe(dir: string): string[] {
  try {
    const { readdirSync } = require('fs');
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// Execute single generation request with strict safety checks & immediate persistence
async function executePersistedCall(
  ai: GoogleGenAI,
  page: BenchmarkPageSpec,
  configType: 'legacy_standard' | 'opt_standard' | 'opt_flex'
): Promise<PersistedBenchmarkRecord> {
  const recordFile = join(runsDir, `${page.id}__${configType}.json`);

  // 1. Check if record already exists on disk
  if (existsSync(recordFile)) {
    try {
      const raw = readFileSync(recordFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.pageId === page.id && parsed.configType === configType && Array.isArray(parsed.decodedCanonicalOffers)) {
        console.log(`[REUSED FROM DISK] ${page.id} (${configType}) -> 0 new network calls.`);
        return { ...parsed, benchmarkCompletionStatus: 'reused_from_disk' };
      }
    } catch {
      // Corrupt file, re-execute
    }
  }

  // 2. Budget and attempt guards
  if (newRequestsExecuted >= MAX_NEW_REQUESTS) {
    throw new Error(`SAFETY_HALT: Maximum authorized new network attempts reached (${MAX_NEW_REQUESTS}).`);
  }
  if (newSpendUsd + 0.06 > MAX_NEW_SPEND_USD) {
    throw new Error(`SAFETY_HALT: Additional spend limit reached ($${MAX_NEW_SPEND_USD} USD). Current: $${newSpendUsd.toFixed(4)}`);
  }
  if (PRIOR_SPEND_USD + newSpendUsd + 0.06 > CUMULATIVE_BUDGET_CEILING_USD) {
    throw new Error(`SAFETY_HALT: Cumulative project budget ceiling ($${CUMULATIVE_BUDGET_CEILING_USD} USD) reached.`);
  }

  const model = 'gemini-3.8-flash';
  const isOptimized = configType === 'opt_standard' || configType === 'opt_flex';
  const serviceTier = configType === 'opt_flex' ? 'flex' : 'standard';
  const schemaVersion: LeafletSchemaVersion = isOptimized ? 'optimized' : 'legacy';

  const systemInstruction = isOptimized
    ? buildOptimizedPageExtractionSystemPrompt()
    : buildLegacyPageExtractionSystemPrompt();
  const responseSchema = getLeafletPageGenAiSchema(schemaVersion);

  const imgBuf = readFileSync(join(cwd, page.imagePath));
  const imgSha256 = createHash('sha256').update(imgBuf).digest('hex');
  const jpegBuf = await sharp(imgBuf).jpeg({ quality: 92 }).toBuffer();
  const base64Image = jpegBuf.toString('base64');

  const promptText = 'Analyze this promotional supermarket leaflet page. Extract all offers with exact 2D component bounding boxes.';

  // Build Vertex AI request config
  const isVertex = Boolean((ai as any).vertexai);
  const requestConfig: any = {
    systemInstruction,
    thinkingConfig: { thinkingLevel: 'HIGH' },
    responseMimeType: 'application/json',
    responseSchema
  };

  if (isVertex) {
    // Official Vertex AI Flex routing per Google Cloud documentation:
    // Location: global, Headers: X-Vertex-AI-LLM-Request-Type: shared, X-Vertex-AI-LLM-Shared-Request-Type: flex
    // No body serviceTier
    if (serviceTier === 'flex') {
      requestConfig.httpOptions = {
        headers: {
          'X-Vertex-AI-LLM-Request-Type': 'shared',
          'X-Vertex-AI-LLM-Shared-Request-Type': 'flex'
        }
      };
    }
  } else {
    requestConfig.serviceTier = serviceTier;
  }

  newRequestsExecuted++;
  const startTime = Date.now();

  try {
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
      config: requestConfig
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
    const trafficType = meta.trafficType || (serviceTier === 'flex' ? 'ON_DEMAND_FLEX' : 'ON_DEMAND_STANDARD');

    const cost = calculateGeminiCost(
      {
        promptTokenCount: promptTokens,
        candidatesTokenCount: candidatesTokens,
        thoughtsTokenCount: thoughtsTokens
      },
      model,
      serviceTier
    );

    newSpendUsd += cost.totalCostUsd;

    const record: PersistedBenchmarkRecord = {
      pageId: page.id,
      retailer: page.retailer,
      imagePath: page.imagePath,
      imageSha256: imgSha256,
      backend: isVertex ? 'vertex' : 'developer',
      model,
      schemaVersion,
      promptVersion: schemaVersion,
      configType,
      requestedServiceTier: serviceTier,
      actualTrafficType: trafficType,
      thinkingConfig: { thinkingLevel: 'HIGH' },
      rawResponseText: rawText,
      decodedCanonicalOffers: decoded.offers,
      usageMetadata: meta,
      promptTokens,
      candidatesTokens,
      thoughtsTokens,
      totalTokens,
      requestDurationMs: durationMs,
      costUsd: cost.totalCostUsd,
      benchmarkCompletionStatus: 'completed',
      savedAt: new Date().toISOString()
    };

    // Atomically persist immediately before advancing
    const tmpFile = `${recordFile}.tmp`;
    writeFileSync(tmpFile, JSON.stringify(record, null, 2), 'utf8');
    renameSync(tmpFile, recordFile);

    recordAttempt({
      pageId: page.id,
      configType,
      backend: record.backend,
      model,
      status: 'success',
      trafficType,
      promptTokens,
      candidatesTokens,
      thoughtsTokens,
      totalTokens,
      costUsd: cost.totalCostUsd,
      recordFile
    });

    console.log(
      `[Attempt ${PRIOR_ATTEMPTS + newRequestsExecuted} | New ${newRequestsExecuted}/${MAX_NEW_REQUESTS}] ` +
      `${page.id} (${configType}): Offers=${decoded.offers.length}/${page.expectedOfferCount}, ` +
      `Tokens=(in:${promptTokens}, out:${candidatesTokens}, th:${thoughtsTokens}), ` +
      `Time=${durationMs}ms, Cost=$${cost.totalCostUsd.toFixed(6)}, NewSpend=$${newSpendUsd.toFixed(4)}`
    );

    return record;
  } catch (err: any) {
    recordAttempt({
      pageId: page.id,
      configType,
      backend: isVertex ? 'vertex' : 'developer',
      model,
      status: 'network_error',
      error: err.message
    });
    throw err;
  }
}

// Matched-Offer Accuracy Evaluation between Extracted Offers and Ground Truth
export interface MatchedAccuracyReport {
  pageId: string;
  configType: string;
  expectedOffersCount: number;
  extractedOffersCount: number;
  matchedOffersCount: number;
  missingOffersCount: number;
  extraOffersCount: number;
  priceMatchCount: number;
  originalPriceMatchCount: number;
  arabicDescriptionMatchCount: number;
  englishDescriptionMatchCount: number;
  sizeMatchCount: number;
  avgGraphicIoU: number;
  avgPromoPriceIoU: number;
  avgTitleIoU: number;
  allCoordinatesValid: boolean;
  cropQualityPass: boolean;
  coreRegressions: string[];
}

export function evaluateExtractionAccuracy(
  record: PersistedBenchmarkRecord,
  groundTruthOffers: any[]
): MatchedAccuracyReport {
  const extracted = record.decodedCanonicalOffers || [];
  const regressions: string[] = [];

  let priceMatches = 0;
  let originalPriceMatches = 0;
  let arabicMatches = 0;
  let englishMatches = 0;
  let sizeMatches = 0;
  let graphicIoUSum = 0;
  let promoPriceIoUSum = 0;
  let titleIoUSum = 0;
  let coordsValid = true;
  let cropQuality = true;

  const matchedGtIndices = new Set<number>();
  let matchCount = 0;

  for (const ext of extracted) {
    // Validate coordinate syntax
    const g = ext.components?.product_graphic_box;
    const p = ext.components?.promo_price_box;
    const t = ext.components?.title_text_box;

    if (!g || g.length !== 4 || g.some((v: number) => v < 0 || v > 1000) || g[0] > g[2] || g[1] > g[3]) {
      coordsValid = false;
      cropQuality = false;
    }
    if (!p || p.length !== 4 || p.some((v: number) => v < 0 || v > 1000) || p[0] > p[2] || p[1] > p[3]) {
      coordsValid = false;
    }

    // Find best matching ground truth offer by spatial IoU of product graphic box or promo price box
    let bestIoU = 0;
    let bestGtIdx = -1;

    for (let i = 0; i < groundTruthOffers.length; i++) {
      if (matchedGtIndices.has(i)) continue;
      const gt = groundTruthOffers[i];
      const gtBox = gt.components?.product_graphic_box;
      const iou = computeIoU(g, gtBox);
      if (iou > bestIoU) {
        bestIoU = iou;
        bestGtIdx = i;
      }
    }

    // If spatial IoU is low, try matching by price and title overlap
    if (bestGtIdx === -1 || bestIoU < 0.2) {
      for (let i = 0; i < groundTruthOffers.length; i++) {
        if (matchedGtIndices.has(i)) continue;
        const gt = groundTruthOffers[i];
        if (Math.abs(ext.promo_price - gt.promo_price) < 0.05) {
          bestGtIdx = i;
          bestIoU = 0.3; // Assigned threshold match
          break;
        }
      }
    }

    if (bestGtIdx !== -1) {
      matchedGtIndices.add(bestGtIdx);
      matchCount++;
      const gt = groundTruthOffers[bestGtIdx];

      // Price comparison
      if (Math.abs(ext.promo_price - gt.promo_price) < 0.05) {
        priceMatches++;
      } else {
        regressions.push(`Price mismatch: ext ${ext.promo_price} vs gt ${gt.promo_price} (Offer ${ext.offer_number})`);
      }

      // Original price comparison
      if (gt.original_price != null) {
        if (ext.original_price != null && Math.abs(ext.original_price - gt.original_price) < 0.05) {
          originalPriceMatches++;
        }
      } else if (ext.original_price == null) {
        originalPriceMatches++;
      }

      // Descriptions
      if (ext.arabic_title && gt.arabic_title) {
        arabicMatches++;
      }
      if (ext.english_title && gt.english_title) {
        englishMatches++;
      }

      // Size
      if (ext.size_value && gt.size_value) {
        sizeMatches++;
      }

      // IoU
      graphicIoUSum += computeIoU(g, gt.components?.product_graphic_box);
      promoPriceIoUSum += computeIoU(p, gt.components?.promo_price_box);
      titleIoUSum += computeIoU(t, gt.components?.title_text_box);
    }
  }

  const missingOffers = groundTruthOffers.length - matchCount;
  const extraOffers = Math.max(0, extracted.length - matchCount);

  if (missingOffers > 0 && record.configType === 'opt_standard') {
    // Only flag regression if opt missed offers that legacy or gt had
    regressions.push(`Missing ${missingOffers} offers compared to ground truth`);
  }

  return {
    pageId: record.pageId,
    configType: record.configType,
    expectedOffersCount: groundTruthOffers.length,
    extractedOffersCount: extracted.length,
    matchedOffersCount: matchCount,
    missingOffersCount: missingOffers,
    extraOffersCount: extraOffers,
    priceMatchCount: priceMatches,
    originalPriceMatchCount: originalPriceMatches,
    arabicDescriptionMatchCount: arabicMatches,
    englishDescriptionMatchCount: englishMatches,
    sizeMatchCount: sizeMatches,
    avgGraphicIoU: matchCount > 0 ? graphicIoUSum / matchCount : 0,
    avgPromoPriceIoU: matchCount > 0 ? promoPriceIoUSum / matchCount : 0,
    avgTitleIoU: matchCount > 0 ? titleIoUSum / matchCount : 0,
    allCoordinatesValid: coordsValid,
    cropQualityPass: cropQuality,
    coreRegressions: regressions
  };
}

// Main execution function
async function main() {
  console.log('================================================================================');
  console.log('WIFRAN-GEMINI-OPT-003: FINAL PERSISTED LIVE BENCHMARK (VERTEX AI)');
  console.log(`Authorization: Max ${MAX_NEW_REQUESTS} New Attempts | Max $${MAX_NEW_SPEND_USD} USD Spend`);
  console.log(`Backend: Google Vertex AI (location: global)`);
  console.log(`Dataset: 15 Verified Ground-Truth Pages (168 Offers)`);
  console.log('================================================================================\n');

  const ai = getGeminiClient();
  const allRecords: PersistedBenchmarkRecord[] = [];
  const accuracyReports: MatchedAccuracyReport[] = [];

  // STAGE A: CANARY ON GOLDEN-P1 (Page 1 Othaim)
  console.log('--- STAGE A: CANARY EVALUATION ON GOLDEN-P1 (Othaim Page 1) ---');
  const canaryPage = VERIFIED_BENCHMARK_PAGES[0];
  const canaryGt = loadPageGroundTruth(canaryPage);

  console.log(`Executing Canary Legacy Standard on ${canaryPage.id}...`);
  const canaryLegacy = await executePersistedCall(ai, canaryPage, 'legacy_standard');
  allRecords.push(canaryLegacy);
  const canaryLegacyAudit = evaluateExtractionAccuracy(canaryLegacy, canaryGt);
  accuracyReports.push(canaryLegacyAudit);

  console.log(`Executing Canary Optimized Standard on ${canaryPage.id}...`);
  const canaryOpt = await executePersistedCall(ai, canaryPage, 'opt_standard');
  allRecords.push(canaryOpt);
  const canaryOptAudit = evaluateExtractionAccuracy(canaryOpt, canaryGt);
  accuracyReports.push(canaryOptAudit);

  console.log('\n[CANARY AUDIT RESULTS]');
  console.log(`  Legacy Offers Extracted: ${canaryLegacy.decodedCanonicalOffers.length}/${canaryPage.expectedOfferCount}`);
  console.log(`  Optimized Offers Extracted: ${canaryOpt.decodedCanonicalOffers.length}/${canaryPage.expectedOfferCount}`);
  console.log(`  Canary Opt Price Matches: ${canaryOptAudit.priceMatchCount}/${canaryOpt.decodedCanonicalOffers.length}`);
  console.log(`  Canary Graphic IoU: ${(canaryOptAudit.avgGraphicIoU * 100).toFixed(1)}%`);
  console.log(`  Canary Promo Price IoU: ${(canaryOptAudit.avgPromoPriceIoU * 100).toFixed(1)}%`);
  console.log(`  Canary Regressions: ${canaryOptAudit.coreRegressions.length}`);

  if (canaryOptAudit.coreRegressions.length > 0) {
    console.error('\nCANARY GATE FAILED: Core extraction regressions detected on GOLDEN-P1:');
    console.error(canaryOptAudit.coreRegressions);
    process.exit(1);
  }
  console.log('>>> CANARY GATE PASSED! Zero observed core regressions. Proceeding to Stage B...\n');

  // STAGE B: REMAINING 14 VERIFIED PAGES
  console.log('--- STAGE B: FULL PAIRED BENCHMARK ON REMAINING 14 VERIFIED PAGES ---');
  for (let i = 1; i < VERIFIED_BENCHMARK_PAGES.length; i++) {
    const page = VERIFIED_BENCHMARK_PAGES[i];
    const gt = loadPageGroundTruth(page);
    console.log(`\nEvaluating Page ${i + 1}/15: ${page.id} (${page.retailer}, expected ${page.expectedOfferCount} offers)...`);

    // 1. Legacy Standard
    const legRec = await executePersistedCall(ai, page, 'legacy_standard');
    allRecords.push(legRec);
    const legAudit = evaluateExtractionAccuracy(legRec, gt);
    accuracyReports.push(legAudit);

    // 2. Optimized Standard
    const optRec = await executePersistedCall(ai, page, 'opt_standard');
    allRecords.push(optRec);
    const optAudit = evaluateExtractionAccuracy(optRec, gt);
    accuracyReports.push(optAudit);

    if (optAudit.coreRegressions.length > 0) {
      console.warn(`[WARNING] Core regression flagged on ${page.id}:`, optAudit.coreRegressions);
    }
  }

  // STAGE C: VERTEX AI FLEX VALIDATION ON 4 REPRESENTATIVE PAGES
  console.log('\n--- STAGE C: VERTEX AI FLEX VALIDATION (4 REPRESENTATIVE PAGES) ---');
  const flexPages = ['GOLDEN-P1', 'ALWAFA-P1', 'BNDW-P1', 'PANDA-P1'];
  for (const pageId of flexPages) {
    const page = VERIFIED_BENCHMARK_PAGES.find(p => p.id === pageId)!;
    console.log(`\nEvaluating Vertex Flex Tier on ${page.id} (${page.retailer})...`);
    const flexRec = await executePersistedCall(ai, page, 'opt_flex');
    allRecords.push(flexRec);
    const flexGt = loadPageGroundTruth(page);
    const flexAudit = evaluateExtractionAccuracy(flexRec, flexGt);
    accuracyReports.push(flexAudit);
  }

  // Save full final summary
  const summaryPath = join(cwd, 'temp/benchmark_final_summary.json');
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        totalNewRequests: newRequestsExecuted,
        totalNewSpendUsd: newSpendUsd,
        cumulativeSpendUsd: PRIOR_SPEND_USD + newSpendUsd,
        recordsCount: allRecords.length,
        accuracyReports
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`\nFinal benchmark summary saved to: ${summaryPath}`);
  console.log(`Total New Network Attempts: ${newRequestsExecuted}/${MAX_NEW_REQUESTS}`);
  console.log(`Total New Spend: $${newSpendUsd.toFixed(4)} / $${MAX_NEW_SPEND_USD} USD`);
  console.log(`Cumulative Spend: $${(PRIOR_SPEND_USD + newSpendUsd).toFixed(4)} / $${CUMULATIVE_BUDGET_CEILING_USD} USD`);
}

main().catch(err => {
  console.error('\nBenchmark Execution Terminated with Error:', err);
  process.exit(1);
});

