/**
 * WIFRAN-EXTRACTOR-IDENTITY-005H-B1
 * Controlled Live Hybrid Smoke Test Runner (Stage B1 ONLY).
 *
 * Strictly enforces:
 * - Hard limit: max 4 live requests, max $0.05 USD (conservative pre-dispatch reserve)
 * - Model: gemini-3.8-flash | thinkingLevel: MEDIUM | tier: flex | location: global
 * - Concurrency: 1 | Automatic retries: 0 | Legacy fallback: disabled
 * - Zero Supabase reads/writes | Consumer publication: disabled | enabledByDefault: false preserved
 * - Sequential gated execution:
 *     --phase=preflight  (0 paid calls: verifies Vertex config, PNG asset, fingerprints, budget)
 *     --phase=req1       (1 paid call ONLY: B1-REQ-01 full_page, saves cache & ledger, STOPS)
 *     --phase=req2to4    (up to 3 paid calls: B1-REQ-02 header context, B1-REQ-03 Sun Top, B1-REQ-04 Pepsi)
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import sharp from 'sharp';
import { calculateGeminiCost } from '../src/main/ocr/geminiPricingTable';
import {
  V3_PROMPT_VERSION,
  getV3PromptAndSchemaFingerprints
} from '../src/main/ocr/geminiV3PromptBuilder';
import {
  HYBRID_LIVE_DEFAULT_MAX_OUTPUT_TOKENS,
  HYBRID_LIVE_DEFAULT_MODEL,
  HYBRID_LIVE_DEFAULT_THINKING_LEVEL,
  HYBRID_LIVE_DEFAULT_TIER,
  HYBRID_LIVE_DEFAULT_TIMEOUT_MS,
  createHybridGeminiLiveProvider,
  preflightHybridLiveProvider
} from '../src/main/ocr/hybrid/hybridGeminiLiveProvider';
import { HybridCostLatencyGovernor } from '../src/main/ocr/hybrid/hybridCostLatencyGovernor';
import {
  runHybridPageWorkflow,
  type HybridResponseCacheStore
} from '../src/main/ocr/hybrid/hybridWorkflowOrchestrator';
import {
  V3_EXTRACTION_SCHEMA_VERSION,
  decodeV3PageExtractionToOfferCards
} from '../src/shared/schemas/leafletPageExtractionV3Schema';
import type {
  HybridExtractionProvider,
  HybridExtractionProviderResponse,
  HybridExtractionRequestPayload,
  HybridPageRunResult,
  PixelBoundingBox
} from '../src/shared/types/hybridExtractionV3';

const REPO_ROOT = resolve(__dirname, '..');
const B1_DIR = join(REPO_ROOT, 'Extracts/pilot_v3_005h_b1');
const RAW_DIR = join(B1_DIR, 'raw');
const CROPS_DIR = join(B1_DIR, 'crops');
const CACHE_FILE = join(B1_DIR, 'cache.json');
const CHECKPOINT_FILE = join(B1_DIR, 'checkpoint.json');
const LEDGER_FILE = join(B1_DIR, 'b1_execution_ledger.json');
const RESULT_FILE = join(B1_DIR, 'b1_workflow_result.json');

const SOURCE_PAGE_REL = 'Extracts/Panda_Test/pages/page.2.png';
const SOURCE_PAGE_ABS = join(REPO_ROOT, SOURCE_PAGE_REL);
const LEAFLET_ID = 'panda-national-national-2026-10-20';
const PAGE_NUMBER = 2;
const RETAILER = 'Panda';
const RETAILER_ID = 'panda';

// Stage B1 hard limits from WIFRAN-EXTRACTOR-IDENTITY-005H-B1
const B1_HARD_CAP_REQUESTS = 4;
const B1_HARD_CAP_SPEND_USD = 0.05;

// Estimated baseline costs from 005H-R1 manifest
const ESTIMATED_COST_BY_REQ_ID: Record<string, number> = {
  'B1-REQ-01': 0.021159,
  'B1-REQ-02': 0.001706,
  'B1-REQ-03': 0.007468,
  'B1-REQ-04': 0.007468
};

// Conservative pre-dispatch reserve accounting for output/thinking-token variation
const CONSERVATIVE_RESERVE_BY_REQ_ID: Record<string, number> = {
  'B1-REQ-01': 0.0325, // bounded maxOutputTokens: 16384 (covers 005E max $0.0252 + headroom)
  'B1-REQ-02': 0.0045, // bounded maxOutputTokens: 2048 (header context schema)
  'B1-REQ-03': 0.0105, // bounded maxOutputTokens: 6144 (compound card crop)
  'B1-REQ-04': 0.0105  // bounded maxOutputTokens: 6144 (compound assortment crop)
};

export interface StageB1LedgerRecord {
  requestId: 'B1-REQ-01' | 'B1-REQ-02' | 'B1-REQ-03' | 'B1-REQ-04';
  requestKind: 'full_page' | 'page_context' | 'card_crop';
  sourceOfferId: string;
  sourceImagePath: string;
  sourceImageSha256: string;
  submittedImageWidthPx: number | null;
  submittedImageHeightPx: number | null;
  pixelBox: PixelBoundingBox | null;
  model: string;
  tier: string;
  thinkingLevel: string;
  maxOutputTokens: number;
  promptVersion: string;
  schemaVersion: string;
  promptSha256: string;
  schemaSha256: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  ok: boolean;
  outcomeUnknown: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  finishReason: string | null;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
  } | null;
  estimatedBaselineCostUsd: number;
  conservativeReserveUsd: number;
  actualOrConsumedCostUsd: number;
  costDeltaVsEstimateUsd: number;
  rawArchivePath: string | null;
}

export interface StageB1LedgerState {
  milestone: 'WIFRAN-EXTRACTOR-IDENTITY-005H-B1';
  hardCapRequests: number;
  hardCapSpendUsd: number;
  submittedRequestsCount: number;
  cumulativeConsumedCostUsd: number;
  haltedReason: string | null;
  records: StageB1LedgerRecord[];
}

function sha256File(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

class FileBackedHybridCacheStore implements HybridResponseCacheStore {
  private data: Record<string, HybridExtractionProviderResponse> = {};
  constructor(private readonly filePath: string) {
    if (existsSync(filePath)) {
      try {
        this.data = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch {
        this.data = {};
      }
    }
  }
  get(cacheKey: string): HybridExtractionProviderResponse | null {
    return this.data[cacheKey] || null;
  }
  set(cacheKey: string, response: HybridExtractionProviderResponse): void {
    this.data[cacheKey] = response;
    mkdirSync(B1_DIR, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }
}

function loadLedger(): StageB1LedgerState {
  if (existsSync(LEDGER_FILE)) {
    return JSON.parse(readFileSync(LEDGER_FILE, 'utf8')) as StageB1LedgerState;
  }
  return {
    milestone: 'WIFRAN-EXTRACTOR-IDENTITY-005H-B1',
    hardCapRequests: B1_HARD_CAP_REQUESTS,
    hardCapSpendUsd: B1_HARD_CAP_SPEND_USD,
    submittedRequestsCount: 0,
    cumulativeConsumedCostUsd: 0,
    haltedReason: null,
    records: []
  };
}

function saveLedger(state: StageB1LedgerState): void {
  mkdirSync(B1_DIR, { recursive: true });
  writeFileSync(LEDGER_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function boxesCloseOrOverlap(
  a: PixelBoundingBox | null | undefined,
  b: [number, number, number, number],
  pageW = 2067,
  pageH = 2923
): boolean {
  if (!a) return false;
  const [ymin, xmin, ymax, xmax] = b;
  const bx = (xmin / 1000) * pageW;
  const by = (ymin / 1000) * pageH;
  const bw = ((xmax - xmin) / 1000) * pageW;
  const bh = ((ymax - ymin) / 1000) * pageH;
  const xOverlap = Math.max(0, Math.min(a.x + a.width, bx + bw) - Math.max(a.x, bx));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, by + bh) - Math.max(a.y, by));
  const intersection = xOverlap * yOverlap;
  const refArea = Math.max(1, bw * bh);
  return intersection / refArea >= 0.45;
}

function createStageB1GuardedProvider(options: {
  phase: 'req1' | 'req2to4';
  verifiedSunTopOfferId: string;
  verifiedPepsiOfferId: string;
}): HybridExtractionProvider {
  const baseOptions = {
    executionContext: 'isolated_hybrid_workflow' as const,
    featureEnabled: true,
    explicitLiveAuthorization: true,
    model: HYBRID_LIVE_DEFAULT_MODEL,
    thinkingLevel: HYBRID_LIVE_DEFAULT_THINKING_LEVEL,
    tier: HYBRID_LIVE_DEFAULT_TIER,
    perRequestTimeoutMs: HYBRID_LIVE_DEFAULT_TIMEOUT_MS,
    archiveDir: RAW_DIR
  };

  // Separate bounded delegates to keep output-token limits tight per request kind
  const pageDelegate = createHybridGeminiLiveProvider({
    ...baseOptions,
    maxOutputTokens: HYBRID_LIVE_DEFAULT_MAX_OUTPUT_TOKENS // 16384
  });
  const contextDelegate = createHybridGeminiLiveProvider({
    ...baseOptions,
    maxOutputTokens: 2048
  });
  const cropDelegate = createHybridGeminiLiveProvider({
    ...baseOptions,
    maxOutputTokens: HYBRID_LIVE_DEFAULT_MAX_OUTPUT_TOKENS // 16384 (enforced floor for card crops)
  });

  const fingerprints = getV3PromptAndSchemaFingerprints();
  let inFlight = false;

  async function guardedExecute<T extends { ok: boolean }>(params: {
    requestId: 'B1-REQ-01' | 'B1-REQ-02' | 'B1-REQ-03' | 'B1-REQ-04';
    requestKind: 'full_page' | 'page_context' | 'card_crop';
    sourceOfferId: string;
    maxOutputTokens: number;
    imagePath: string;
    pixelBox: PixelBoundingBox | null;
    invoke: () => Promise<{
      rawResp: HybridExtractionProviderResponse;
      result: T;
    }>;
    onRejected: (code: string, message: string) => T;
  }): Promise<T> {
    if (inFlight) {
      return params.onRejected(
        'STAGE_B1_CONCURRENCY_VIOLATION',
        'Concurrency is strictly locked to 1; overlapping dispatch refused.'
      );
    }

    const ledger = loadLedger();
    if (ledger.haltedReason) {
      return params.onRejected('STAGE_B1_ALREADY_HALTED', ledger.haltedReason);
    }
    if (ledger.submittedRequestsCount + 1 > B1_HARD_CAP_REQUESTS) {
      ledger.haltedReason = `STAGE_B1_REQUEST_CAP_EXHAUSTED (${ledger.submittedRequestsCount}/${B1_HARD_CAP_REQUESTS})`;
      saveLedger(ledger);
      return params.onRejected('STAGE_B1_REQUEST_CAP_EXHAUSTED', ledger.haltedReason);
    }

    const estCost = ESTIMATED_COST_BY_REQ_ID[params.requestId];
    const reserveUsd = CONSERVATIVE_RESERVE_BY_REQ_ID[params.requestId];
    if (ledger.cumulativeConsumedCostUsd + reserveUsd > B1_HARD_CAP_SPEND_USD) {
      ledger.haltedReason = `STAGE_B1_CONSERVATIVE_SPEND_CAP_EXCEEDED: recorded=$${ledger.cumulativeConsumedCostUsd.toFixed(6)} + reserve=$${reserveUsd.toFixed(6)} > cap=$${B1_HARD_CAP_SPEND_USD.toFixed(6)} for ${params.requestId}`;
      saveLedger(ledger);
      return params.onRejected('STAGE_B1_SPEND_CAP_EXCEEDED', ledger.haltedReason);
    }

    if (!existsSync(params.imagePath)) {
      return params.onRejected(
        'STAGE_B1_IMAGE_MISSING',
        `Submitted image path missing: ${params.imagePath}`
      );
    }

    const imgMeta = await sharp(params.imagePath).metadata();
    const imgHash = sha256File(params.imagePath);
    const startedAt = new Date().toISOString();
    inFlight = true;

    let out: { rawResp: HybridExtractionProviderResponse; result: T };
    try {
      out = await params.invoke();
    } finally {
      inFlight = false;
    }

    const endedAt = new Date().toISOString();
    const rawResp = out.rawResp;
    const usage = rawResp.usage;

    let computedActualCost = 0;
    if (rawResp.outcomeUnknown) {
      computedActualCost = reserveUsd;
    } else if (usage) {
      computedActualCost = calculateGeminiCost(usage, HYBRID_LIVE_DEFAULT_MODEL, HYBRID_LIVE_DEFAULT_TIER).totalCostUsd;
    } else if (typeof rawResp.costUsdOverride === 'number') {
      computedActualCost = rawResp.costUsdOverride;
    }

    const record: StageB1LedgerRecord = {
      requestId: params.requestId,
      requestKind: params.requestKind,
      sourceOfferId: params.sourceOfferId,
      sourceImagePath: params.imagePath,
      sourceImageSha256: imgHash,
      submittedImageWidthPx: imgMeta.width ?? null,
      submittedImageHeightPx: imgMeta.height ?? null,
      pixelBox: params.pixelBox,
      model: HYBRID_LIVE_DEFAULT_MODEL,
      tier: HYBRID_LIVE_DEFAULT_TIER,
      thinkingLevel: HYBRID_LIVE_DEFAULT_THINKING_LEVEL,
      maxOutputTokens: params.maxOutputTokens,
      promptVersion: V3_PROMPT_VERSION,
      schemaVersion: V3_EXTRACTION_SCHEMA_VERSION,
      promptSha256: fingerprints.promptSha256,
      schemaSha256: fingerprints.schemaSha256,
      startedAt,
      endedAt,
      durationMs: rawResp.durationMs,
      ok: rawResp.ok,
      outcomeUnknown: Boolean(rawResp.outcomeUnknown),
      errorCode: rawResp.errorCode ?? null,
      errorMessage: rawResp.errorMessage ?? null,
      finishReason: rawResp.finishReason ?? null,
      tokenUsage: usage
        ? {
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount ?? 0,
            thinkingTokens: usage.thoughtsTokenCount ?? 0,
            cachedInputTokens: usage.cachedContentTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0
          }
        : null,
      estimatedBaselineCostUsd: estCost,
      conservativeReserveUsd: reserveUsd,
      actualOrConsumedCostUsd: Number(computedActualCost.toFixed(8)),
      costDeltaVsEstimateUsd: Number((computedActualCost - estCost).toFixed(8)),
      rawArchivePath: rawResp.rawArchivePath ?? null
    };

    const refreshed = loadLedger();
    refreshed.submittedRequestsCount += 1;
    refreshed.cumulativeConsumedCostUsd = Number(
      (refreshed.cumulativeConsumedCostUsd + computedActualCost).toFixed(8)
    );
    refreshed.records.push(record);
    if (!rawResp.ok) {
      refreshed.haltedReason = `STAGE_B1_REQUEST_FAILED (${params.requestId}: ${rawResp.errorCode || rawResp.errorMessage})`;
    }
    saveLedger(refreshed);

    return out.result;
  }

  return {
    providerId: `stage_b1_guarded_${pageDelegate.providerId}`,
    isOfflineOrMock: false,
    async extractPage(req: HybridExtractionRequestPayload) {
      if (options.phase !== 'req1') {
        return {
          ok: false,
          errorCode: 'STAGE_B1_FULL_PAGE_CACHE_REQUIRED_IN_PHASE2',
          errorMessage: 'Phase req2to4 must hit cached B1-REQ-01 rather than dispatching a duplicate live full_page call.',
          durationMs: 0,
          costUsdOverride: 0
        };
      }
      if (req.leafletId !== LEAFLET_ID || req.pageNumber !== PAGE_NUMBER) {
        return {
          ok: false,
          errorCode: 'STAGE_B1_ALLOWLIST_REJECTED',
          errorMessage: `Only ${LEAFLET_ID} p${PAGE_NUMBER} is allowlisted for B1-REQ-01.`,
          durationMs: 0,
          costUsdOverride: 0
        };
      }
      return guardedExecute({
        requestId: 'B1-REQ-01',
        requestKind: 'full_page',
        sourceOfferId: `${LEAFLET_ID}_p002_full_page`,
        maxOutputTokens: HYBRID_LIVE_DEFAULT_MAX_OUTPUT_TOKENS,
        imagePath: req.imagePath,
        pixelBox: null,
        invoke: async () => {
          const r = await pageDelegate.extractPage(req);
          return { rawResp: r, result: r };
        },
        onRejected: (errorCode, errorMessage) => ({
          ok: false,
          errorCode,
          errorMessage,
          durationMs: 0,
          costUsdOverride: 0
        })
      });
    },
    ...(options.phase === 'req2to4'
      ? {
          async verifyPageContext(req: HybridExtractionRequestPayload) {
            if (req.leafletId !== LEAFLET_ID || req.pageNumber !== PAGE_NUMBER || req.regionKind !== 'page_header') {
              return {
                ok: false,
                errorMessage: `STAGE_B1_ALLOWLIST_REJECTED: Only Panda p2 page_header [0,0,210,1000] is allowlisted for B1-REQ-02.`
              };
            }
            if (!boxesCloseOrOverlap(req.pixelBox, [0, 0, 210, 1000])) {
              return {
                ok: false,
                errorMessage: `STAGE_B1_GEOMETRY_REJECTED: B1-REQ-02 pixelBox ${JSON.stringify(req.pixelBox)} does not match approved header [0,0,210,1000].`
              };
            }
            return guardedExecute({
              requestId: 'B1-REQ-02',
              requestKind: 'page_context',
              sourceOfferId: 'pilot_page_01_panda_p002_header_footer',
              maxOutputTokens: 2048,
              imagePath: req.imagePath,
              pixelBox: req.pixelBox ?? null,
              invoke: async () => {
                const res = await contextDelegate.verifyPageContext!(req);
                const rawResp: HybridExtractionProviderResponse = res.rawResponse || {
                  ok: res.ok,
                  errorMessage: res.errorMessage,
                  durationMs: 0
                };
                return { rawResp, result: res };
              },
              onRejected: (code, msg) => ({
                ok: false,
                errorMessage: `${code}: ${msg}`,
                rawResponse: { ok: false, errorCode: code, errorMessage: msg, durationMs: 0, costUsdOverride: 0 }
              })
            });
          }
        }
      : {}),
    async extractCardCrop(req: HybridExtractionRequestPayload) {
      if (options.phase !== 'req2to4') {
        return {
          ok: false,
          errorCode: 'STAGE_B1_PHASE1_CROPS_BLOCKED',
          errorMessage: 'Phase req1 executes B1-REQ-01 ONLY.',
          durationMs: 0,
          costUsdOverride: 0
        };
      }
      let requestId: 'B1-REQ-03' | 'B1-REQ-04' | null = null;
      if (req.sourceOfferId === options.verifiedSunTopOfferId) {
        if (!boxesCloseOrOverlap(req.pixelBox, [684, 41, 915, 345])) {
          return {
            ok: false,
            errorCode: 'STAGE_B1_GEOMETRY_MISMATCH',
            errorMessage: `Sun Top crop pixelBox ${JSON.stringify(req.pixelBox)} does not align with R3C1 [684,41,915,345].`,
            durationMs: 0,
            costUsdOverride: 0
          };
        }
        requestId = 'B1-REQ-03';
      } else if (req.sourceOfferId === options.verifiedPepsiOfferId) {
        if (!boxesCloseOrOverlap(req.pixelBox, [456, 38, 683, 345])) {
          return {
            ok: false,
            errorCode: 'STAGE_B1_GEOMETRY_MISMATCH',
            errorMessage: `Pepsi crop pixelBox ${JSON.stringify(req.pixelBox)} does not align with R2C1 [456,38,683,345].`,
            durationMs: 0,
            costUsdOverride: 0
          };
        }
        requestId = 'B1-REQ-04';
      } else {
        return {
          ok: false,
          errorCode: 'STAGE_B1_ALLOWLIST_REJECTED',
          errorMessage: `Offer ${req.sourceOfferId} is not in Stage B1 allowlist (${options.verifiedSunTopOfferId}, ${options.verifiedPepsiOfferId}).`,
          durationMs: 0,
          costUsdOverride: 0
        };
      }

      return guardedExecute({
        requestId,
        requestKind: 'card_crop',
        sourceOfferId: req.sourceOfferId || 'unknown',
        maxOutputTokens: HYBRID_LIVE_DEFAULT_MAX_OUTPUT_TOKENS,
        imagePath: req.imagePath,
        pixelBox: req.pixelBox ?? null,
        invoke: async () => {
          const r = await cropDelegate.extractCardCrop(req);
          return { rawResp: r, result: r };
        },
        onRejected: (errorCode, errorMessage) => ({
          ok: false,
          errorCode,
          errorMessage,
          durationMs: 0,
          costUsdOverride: 0
        })
      });
    }
  };
}

async function runPreflight() {
  const pre = preflightHybridLiveProvider({
    executionContext: 'isolated_hybrid_workflow',
    featureEnabled: true,
    explicitLiveAuthorization: true
  });
  const imgExists = existsSync(SOURCE_PAGE_ABS);
  const imgMeta = imgExists ? await sharp(SOURCE_PAGE_ABS).metadata() : null;
  const imgSha = imgExists ? sha256File(SOURCE_PAGE_ABS) : null;
  const fps = getV3PromptAndSchemaFingerprints();
  console.log(
    JSON.stringify(
      {
        mode: 'STAGE_B1_PREFLIGHT_ZERO_CALLS',
        providerPreflight: pre,
        sourceImage: {
          path: SOURCE_PAGE_REL,
          exists: imgExists,
          width: imgMeta?.width ?? null,
          height: imgMeta?.height ?? null,
          sha256: imgSha
        },
        promptAndSchema: fps,
        limits: {
          hardCapRequests: B1_HARD_CAP_REQUESTS,
          hardCapSpendUsd: B1_HARD_CAP_SPEND_USD,
          conservativeReserves: CONSERVATIVE_RESERVE_BY_REQ_ID
        }
      },
      null,
      2
    )
  );
  if (!pre.ok || !imgExists) process.exit(1);
}

async function runReq1() {
  const cacheStore = new FileBackedHybridCacheStore(CACHE_FILE);
  const provider = createStageB1GuardedProvider({
    phase: 'req1',
    verifiedSunTopOfferId: '',
    verifiedPepsiOfferId: ''
  });
  const governor = new HybridCostLatencyGovernor({
    policy: {
      maxRequestsPerJob: B1_HARD_CAP_REQUESTS,
      maxSpendUsdPerJob: B1_HARD_CAP_SPEND_USD,
      maxSpendUsdPerPage: B1_HARD_CAP_SPEND_USD,
      maxCropsPerPage: 2,
      allowP1WhenBudgetAllows: false,
      failClosedOnUnverifiedP0: true,
      enableIndependentP2Audit: false
    }
  });

  const res = await runHybridPageWorkflow({
    executionContext: 'isolated_hybrid_workflow',
    explicitAuthorization: true,
    featureEnabled: true,
    runId: '005h_b1_smoke_req1',
    leafletId: LEAFLET_ID,
    pageNumber: PAGE_NUMBER,
    retailer: RETAILER,
    retailerId: RETAILER_ID,
    locationScope: 'national',
    pageAssetPath: SOURCE_PAGE_ABS,
    pageImagePath: SOURCE_PAGE_ABS,
    cropOutputDir: CROPS_DIR,
    checkpointPath: CHECKPOINT_FILE,
    governor,
    provider,
    cacheStore,
    allowedCropSourceOfferIds: [],
    forceAllowlistedPageContext: false
  });

  const ledger = loadLedger();
  const req1Record = ledger.records.find((r) => r.requestId === 'B1-REQ-01');
  const cardsSummary = res.reconciledCards.map((c) => ({
    sourceOfferId: c.sourceOfferId,
    titleAr: c.reconciledCard.source_card.raw_text.title_ar,
    titleEn: c.reconciledCard.source_card.raw_text.title_en,
    promoPrice: c.reconciledCard.pricing.promo_price,
    originalPrice: c.reconciledCard.pricing.original_price,
    priority: c.selectionDecision.priority,
    triggers: c.selectionDecision.triggerCodes,
    isCompound: Boolean(c.reconciledCard.compound_card_context?.has_multiple_price_badges_in_card),
    isAssorted: c.reconciledCard.assortment.status !== 'confirmed_single_sku',
    conflicts: c.reconciledCard.evidence_conflicts
  }));

  // Also print raw decoded offer_number + bounding boxes from cache for visual inspection
  let rawOffersBoxes: any[] = [];
  if (req1Record?.rawArchivePath && existsSync(req1Record.rawArchivePath)) {
    const rawArchive = JSON.parse(readFileSync(req1Record.rawArchivePath, 'utf8'));
    const offers = rawArchive?.parsedResponse?.offers || [];
    rawOffersBoxes = offers.map((o: any) => {
      const comps = o.components || {};
      const boxes = [
        comps.product_graphic_box,
        comps.promo_price_box,
        comps.original_price_box,
        comps.title_text_box,
        comps.unit_and_size_badge_box
      ].filter((b: any) => Array.isArray(b) && b.length === 4);
      const union =
        boxes.length > 0
          ? [
              Math.min(...boxes.map((b: number[]) => b[0])),
              Math.min(...boxes.map((b: number[]) => b[1])),
              Math.max(...boxes.map((b: number[]) => b[2])),
              Math.max(...boxes.map((b: number[]) => b[3]))
            ]
          : null;
      return {
        offerNumber: o.offer_number,
        titleAr: o.arabic_title,
        titleEn: o.english_title,
        promoPrice: o.promo_price,
        originalPrice: o.original_price,
        unionBox: union,
        subItemsCount: Array.isArray(o.sub_items) ? o.sub_items.length : 0,
        compoundTiersCount: Array.isArray(o.compound_tiers) ? o.compound_tiers.length : 0
      };
    });
  }

  writeFileSync(
    join(B1_DIR, 'req1_inspection.json'),
    JSON.stringify(
      {
        workflowOk: res.ok,
        abortedReason: res.abortedReason,
        req1Record,
        pageContextVerificationNeed: res.pageContextVerificationNeed,
        rawOffersBoxes,
        cardsSummary
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        phase: 'req1',
        workflowOk: res.ok,
        abortedReason: res.abortedReason,
        finishReason: req1Record?.finishReason,
        durationMs: req1Record?.durationMs,
        actualCostUsd: req1Record?.actualOrConsumedCostUsd,
        tokenUsage: req1Record?.tokenUsage,
        pageContextVerificationNeed: res.pageContextVerificationNeed,
        rawOffersCount: rawOffersBoxes.length,
        rawOffersBoxes
      },
      null,
      2
    )
  );
  if (!res.ok) process.exit(1);
}

async function runReq2To4(sunTopOfferId: string, pepsiOfferId: string) {
  const ledger = loadLedger();
  const req1Record = ledger.records.find((r) => r.requestId === 'B1-REQ-01');
  if (!req1Record || !req1Record.ok) {
    throw new Error('Cannot execute req2to4 before B1-REQ-01 passes.');
  }

  const cacheStore = new FileBackedHybridCacheStore(CACHE_FILE);
  const provider = createStageB1GuardedProvider({
    phase: 'req2to4',
    verifiedSunTopOfferId: sunTopOfferId,
    verifiedPepsiOfferId: pepsiOfferId
  });

  const governor = new HybridCostLatencyGovernor({
    initialJobRequests: ledger.submittedRequestsCount,
    initialJobSpendUsd: ledger.cumulativeConsumedCostUsd,
    policy: {
      maxRequestsPerJob: B1_HARD_CAP_REQUESTS,
      maxSpendUsdPerJob: B1_HARD_CAP_SPEND_USD,
      maxSpendUsdPerPage: B1_HARD_CAP_SPEND_USD,
      maxCropsPerPage: 2,
      allowP1WhenBudgetAllows: false,
      failClosedOnUnverifiedP0: true,
      enableIndependentP2Audit: false
    }
  });

  const res: HybridPageRunResult = await runHybridPageWorkflow({
    executionContext: 'isolated_hybrid_workflow',
    explicitAuthorization: true,
    featureEnabled: true,
    runId: '005h_b1_smoke_full',
    leafletId: LEAFLET_ID,
    pageNumber: PAGE_NUMBER,
    retailer: RETAILER,
    retailerId: RETAILER_ID,
    locationScope: 'national',
    pageAssetPath: SOURCE_PAGE_ABS,
    pageImagePath: SOURCE_PAGE_ABS,
    cropOutputDir: CROPS_DIR,
    checkpointPath: CHECKPOINT_FILE,
    governor,
    provider,
    cacheStore,
    budgetPolicy: {
      maxRequestsPerJob: B1_HARD_CAP_REQUESTS,
      maxSpendUsdPerJob: B1_HARD_CAP_SPEND_USD,
      maxSpendUsdPerPage: B1_HARD_CAP_SPEND_USD,
      maxCropsPerPage: 2,
      allowP1WhenBudgetAllows: false,
      failClosedOnUnverifiedP0: true,
      enableIndependentP2Audit: false
    },
    allowedCropSourceOfferIds: [sunTopOfferId, pepsiOfferId],
    forceAllowlistedPageContext: true
  });

  writeFileSync(RESULT_FILE, JSON.stringify(res, null, 2), 'utf8');
  const finalLedger = loadLedger();

  console.log(
    JSON.stringify(
      {
        phase: 'req2to4',
        workflowOk: res.ok,
        totalSourceCards: res.totalSourceCards,
        p0FlaggedCount: res.p0FlaggedCount,
        p1FlaggedCount: res.p1FlaggedCount,
        p2NoCropCount: res.p2NoCropCount,
        cropsExecutedCount: res.cropsExecutedCount,
        cropsSkippedBudgetCount: res.cropsSkippedBudgetCount,
        pageContextApplied: res.pageContextApplied,
        summary: res.summary,
        ledgerSummary: {
          submittedRequestsCount: finalLedger.submittedRequestsCount,
          cumulativeConsumedCostUsd: finalLedger.cumulativeConsumedCostUsd,
          haltedReason: finalLedger.haltedReason,
          records: finalLedger.records.map((r) => ({
            requestId: r.requestId,
            ok: r.ok,
            finishReason: r.finishReason,
            durationMs: r.durationMs,
            tokenUsage: r.tokenUsage,
            actualCostUsd: r.actualOrConsumedCostUsd,
            costDeltaVsEstimateUsd: r.costDeltaVsEstimateUsd
          }))
        }
      },
      null,
      2
    )
  );
}

async function main() {
  const phase = parseArg('phase') || 'preflight';
  if (phase === 'preflight') {
    await runPreflight();
  } else if (phase === 'req1') {
    await runReq1();
  } else if (phase === 'req2to4') {
    const sunTop = parseArg('sun-top-id');
    const pepsi = parseArg('pepsi-id');
    if (!sunTop || !pepsi) {
      throw new Error('Missing required --sun-top-id and --pepsi-id verified from req1.');
    }
    await runReq2To4(sunTop, pepsi);
  } else {
    throw new Error(`Unsupported phase: ${phase}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

