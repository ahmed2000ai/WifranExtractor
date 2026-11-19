import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, copyFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type {
  BatchExtractionCostSummary,
  GeminiCostCategoryBreakdown,
  GeminiUsageLedgerEntry,
  GeminiUsageOutcome,
  GeminiUsageStageCategory,
  PerLeafletCostSummary,
  PerOfferCostAllocation,
  PerPageCostSummary
} from '../../shared/types/costAccounting';
import type { BatchManifest } from '../../shared/types/batchExtraction';
import { calculateGeminiCost, getModelPricing, type GeminiTokenUsageInput } from '../../shared/utils/geminiPricingAndCostEstimator';

export interface PersistedGeminiCostLedgerFile {
  schemaVersion: 'wifran.gemini_cost_ledger/1.0';
  batchId: string;
  latestRunId: string | null;
  updatedAt: string;
  entries: GeminiUsageLedgerEntry[];
}

function emptyBreakdown(): GeminiCostCategoryBreakdown {
  return {
    b1_full_page: 0,
    b2_selective_crop: 0,
    catalog_matching: 0,
    metadata_discovery: 0,
    other_gemini: 0
  };
}

function round8(value: number): number {
  return Number(value.toFixed(8));
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  try {
    renameSync(tmpPath, filePath);
  } catch {
    copyFileSync(tmpPath, filePath);
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore temp cleanup errors
    }
  }
}

export function buildLedgerEntryFromProviderCall(input: {
  requestId: string;
  batchId: string;
  runId: string;
  leafletId: string;
  pageNumber?: number | null;
  sourceOfferId?: string | null;
  sourceAnchor?: string | null;
  stageCategory: GeminiUsageStageCategory;
  requestPurpose: string;
  modelId: string;
  modelVersion?: string | null;
  apiProvider: 'vertex_ai' | 'gemini_developer' | 'mock' | 'cache';
  requestedTier: 'flex' | 'standard' | 'batch';
  actualTier?: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: GeminiUsageOutcome;
  finishReason?: string | null;
  cacheHit: boolean;
  usageReported: boolean;
  usage?: GeminiTokenUsageInput;
  rawUsageMetadata?: Record<string, unknown> | null;
  retryOfRequestId?: string | null;
  recoveryParentRequestId?: string | null;
  errorMessage?: string | null;
  asOfDate?: string;
}): GeminiUsageLedgerEntry {
  const effectiveTier = input.requestedTier === 'standard' ? 'standard' : 'flex';
  const asOfDate = input.asOfDate || input.completedAt.slice(0, 10);
  const pricingTier = getModelPricing(input.modelId, effectiveTier, asOfDate);

  if (input.cacheHit || input.outcome === 'cache_hit') {
    return {
      requestId: input.requestId,
      batchId: input.batchId,
      runId: input.runId,
      leafletId: input.leafletId,
      pageNumber: input.pageNumber ?? null,
      sourceOfferId: input.sourceOfferId ?? null,
      sourceAnchor: input.sourceAnchor ?? null,
      stageCategory: input.stageCategory,
      requestPurpose: input.requestPurpose,
      modelId: input.modelId,
      modelVersion: input.modelVersion ?? input.modelId,
      apiProvider: 'cache',
      requestedTier: input.requestedTier,
      actualTier: input.actualTier ?? 'cache_hit',
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: Math.max(0, input.durationMs),
      outcome: 'cache_hit',
      finishReason: input.finishReason ?? null,
      promptTokens: 0,
      responseTokens: 0,
      thinkingTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
      pricingEffectiveDate: pricingTier.effectiveDate,
      ratesApplied: null,
      usageStatus: 'cache_hit_zero',
      measuredCostUsd: 0,
      cacheHit: true,
      retryOfRequestId: input.retryOfRequestId ?? null,
      recoveryParentRequestId: input.recoveryParentRequestId ?? null,
      errorMessage: input.errorMessage ?? null,
      rawUsageMetadata: null
    };
  }

  const hasValidUsage =
    input.usageReported &&
    input.usage !== undefined &&
    input.usage.promptTokenCount !== undefined &&
    input.usage.promptTokenCount !== null;

  if (!hasValidUsage) {
    return {
      requestId: input.requestId,
      batchId: input.batchId,
      runId: input.runId,
      leafletId: input.leafletId,
      pageNumber: input.pageNumber ?? null,
      sourceOfferId: input.sourceOfferId ?? null,
      sourceAnchor: input.sourceAnchor ?? null,
      stageCategory: input.stageCategory,
      requestPurpose: input.requestPurpose,
      modelId: input.modelId,
      modelVersion: input.modelVersion ?? input.modelId,
      apiProvider: input.apiProvider,
      requestedTier: input.requestedTier,
      actualTier: input.actualTier ?? null,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: Math.max(0, input.durationMs),
      outcome: input.outcome,
      finishReason: input.finishReason ?? null,
      promptTokens: 0,
      responseTokens: 0,
      thinkingTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
      pricingEffectiveDate: pricingTier.effectiveDate,
      ratesApplied: {
        inputPerMillion: pricingTier.inputPerMillion,
        outputPerMillion: pricingTier.outputPerMillion,
        thinkingPerMillion: pricingTier.thinkingPerMillion,
        cachedInputPerMillion: pricingTier.cachedInputPerMillion
      },
      usageStatus: 'unavailable_unknown',
      measuredCostUsd: null,
      cacheHit: false,
      retryOfRequestId: input.retryOfRequestId ?? null,
      recoveryParentRequestId: input.recoveryParentRequestId ?? null,
      errorMessage: input.errorMessage ?? null,
      rawUsageMetadata: input.rawUsageMetadata ?? null
    };
  }

  const promptTokens = Math.max(0, input.usage!.promptTokenCount || 0);
  const rawRespTokens = Math.max(0, input.usage!.candidatesTokenCount || 0);
  const thinkingTokens = Math.max(0, input.usage!.thoughtsTokenCount ?? input.usage!.thinkingTokenCount ?? 0);
  const cachedInputTokens = Math.min(promptTokens, Math.max(0, input.usage!.cachedContentTokenCount || 0));
  const rawTotal = input.usage!.totalTokenCount;
  const visibleResponseTokens =
    typeof rawTotal === 'number' &&
    rawTotal > 0 &&
    thinkingTokens > 0 &&
    rawRespTokens >= thinkingTokens &&
    rawTotal === promptTokens + rawRespTokens
      ? Math.max(0, rawRespTokens - thinkingTokens)
      : rawRespTokens;
  const totalTokens =
    typeof rawTotal === 'number' && rawTotal > 0
      ? rawTotal
      : promptTokens + visibleResponseTokens + thinkingTokens;

  const costCalc = calculateGeminiCost(input.usage!, input.modelId, effectiveTier, asOfDate);

  return {
    requestId: input.requestId,
    batchId: input.batchId,
    runId: input.runId,
    leafletId: input.leafletId,
    pageNumber: input.pageNumber ?? null,
    sourceOfferId: input.sourceOfferId ?? null,
    sourceAnchor: input.sourceAnchor ?? null,
    stageCategory: input.stageCategory,
    requestPurpose: input.requestPurpose,
    modelId: input.modelId,
    modelVersion: input.modelVersion ?? input.modelId,
    apiProvider: input.apiProvider,
    requestedTier: input.requestedTier,
    actualTier: input.actualTier ?? (input.rawUsageMetadata?.trafficType ? String(input.rawUsageMetadata.trafficType) : null),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, input.durationMs),
    outcome: input.outcome,
    finishReason: input.finishReason ?? null,
    promptTokens,
    responseTokens: visibleResponseTokens,
    thinkingTokens,
    cachedInputTokens,
    totalTokens,
    pricingEffectiveDate: costCalc.effectiveDate,
    ratesApplied: {
      inputPerMillion: pricingTier.inputPerMillion,
      outputPerMillion: pricingTier.outputPerMillion,
      thinkingPerMillion: pricingTier.thinkingPerMillion,
      cachedInputPerMillion: pricingTier.cachedInputPerMillion
    },
    usageStatus: 'measured',
    measuredCostUsd: costCalc.totalCostUsd,
    cacheHit: false,
    retryOfRequestId: input.retryOfRequestId ?? null,
    recoveryParentRequestId: input.recoveryParentRequestId ?? null,
    errorMessage: input.errorMessage ?? null,
    rawUsageMetadata: input.rawUsageMetadata ?? null
  };
}

export class GeminiCostLedgerService {
  constructor(private readonly batchesBaseDir?: string) {}

  private resolveLedgerPath(batchId: string, explicitLedgerPath?: string): string {
    if (explicitLedgerPath) return explicitLedgerPath;
    const base =
      this.batchesBaseDir ||
      join(process.cwd(), process.env.WIFRAN_OFFLINE_UAT === '1' ? 'workspaces_uat/batches' : 'Extracts/batches');
    return join(base, batchId, 'gemini-cost-ledger.json');
  }

  public loadLedger(batchId: string, explicitLedgerPath?: string): PersistedGeminiCostLedgerFile {
    const filePath = this.resolveLedgerPath(batchId, explicitLedgerPath);
    if (existsSync(filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as PersistedGeminiCostLedgerFile;
        if (parsed && Array.isArray(parsed.entries)) {
          return {
            schemaVersion: 'wifran.gemini_cost_ledger/1.0',
            batchId: parsed.batchId || batchId,
            latestRunId: parsed.latestRunId ?? null,
            updatedAt: parsed.updatedAt || new Date().toISOString(),
            entries: parsed.entries
          };
        }
      } catch {
        // Fallback to clean empty structure if corrupted
      }
    }
    return {
      schemaVersion: 'wifran.gemini_cost_ledger/1.0',
      batchId,
      latestRunId: null,
      updatedAt: new Date().toISOString(),
      entries: []
    };
  }

  public setLatestRunId(batchId: string, runId: string, explicitLedgerPath?: string): void {
    const ledger = this.loadLedger(batchId, explicitLedgerPath);
    ledger.latestRunId = runId;
    ledger.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.resolveLedgerPath(batchId, explicitLedgerPath), ledger);
  }

  /**
   * Idempotently inserts or updates a ledger entry by `requestId` so retries/resumes/reopens
   * never double count the same API invocation.
   */
  public recordEntry(entry: GeminiUsageLedgerEntry, explicitLedgerPath?: string): PersistedGeminiCostLedgerFile {
    return this.recordEntries([entry], explicitLedgerPath);
  }

  public recordEntries(
    entries: GeminiUsageLedgerEntry[],
    explicitLedgerPath?: string,
    options?: { updateLatestRunId?: boolean }
  ): PersistedGeminiCostLedgerFile {
    if (entries.length === 0) {
      return this.loadLedger('unknown', explicitLedgerPath);
    }
    const batchId = entries[0].batchId;
    const ledger = this.loadLedger(batchId, explicitLedgerPath);
    const byId = new Map<string, GeminiUsageLedgerEntry>();
    for (const existing of ledger.entries) {
      byId.set(existing.requestId, existing);
    }
    for (const next of entries) {
      byId.set(next.requestId, next);
      if (next.runId && (options?.updateLatestRunId ?? true)) {
        ledger.latestRunId = next.runId;
      }
    }
    ledger.entries = Array.from(byId.values());
    ledger.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.resolveLedgerPath(batchId, explicitLedgerPath), ledger);
    return ledger;
  }

  /**
   * Idempotently reconciles historical unledgered Gemini API responses from preserved
   * archives (e.g. pre-ledger MAX_TOKENS attempts) into gemini-cost-ledger.json.
   *
   * Safeguards:
   * 1. Preserves archive files strictly read-only: NEVER mutates or deletes original files.
   * 2. Deterministic requestIds ensure idempotence: repeated reopens/resumes never double-count.
   * 3. Accurately calculates Gemini Flex/Standard cost using token metadata recorded in raw response.
   */
  public reconcileHistoricalArchives(
    batchId: string,
    leaflets: Array<{
      leafletId: string;
      workspacePath?: string;
      model?: string;
      executionMode?: 'flex' | 'standard';
    }>,
    explicitLedgerPath?: string
  ): { reconciledCount: number; ledger: PersistedGeminiCostLedgerFile } {
    const ledger = this.loadLedger(batchId, explicitLedgerPath);
    const existingRequestIds = new Set(ledger.entries.map((e) => e.requestId));
    const newEntries: GeminiUsageLedgerEntry[] = [];

    for (const leaflet of leaflets || []) {
      if (!leaflet.workspacePath || !existsSync(leaflet.workspacePath)) continue;
      const archiveDir = join(leaflet.workspacePath, 'hybrid_v3_archive');
      if (!existsSync(archiveDir)) continue;

      let files: string[] = [];
      try {
        files = readdirSync(archiveDir);
      } catch {
        continue;
      }

      for (const fileName of files) {
        if (!fileName.endsWith('.raw.json')) continue;
        const filePath = join(archiveDir, fileName);
        try {
          const raw = JSON.parse(readFileSync(filePath, 'utf8'));
          const usageMeta = raw.usageMetadataRaw;
          if (
            !usageMeta ||
            typeof usageMeta !== 'object' ||
            typeof usageMeta.promptTokenCount !== 'number'
          ) {
            continue;
          }

          const fileBase = fileName.replace(/\.raw\.json$/, '');
          const deterministicRequestId = `${batchId}:${leaflet.leafletId}:archive:${fileBase}`;

          if (existingRequestIds.has(deterministicRequestId)) {
            continue;
          }

          // Check if an existing entry already covers this exact usage to prevent duplication
          const isAlreadyCovered = ledger.entries.some(
            (e) =>
              e.leafletId === leaflet.leafletId &&
              e.promptTokens === usageMeta.promptTokenCount &&
              (e.responseTokens === (usageMeta.candidatesTokenCount || 0) ||
                e.responseTokens === Math.max(0, (usageMeta.candidatesTokenCount || 0) - (usageMeta.thoughtsTokenCount || 0))) &&
              e.outcome === (raw.finishReason && raw.finishReason !== 'STOP' ? 'failed' : 'success')
          );
          if (isAlreadyCovered) {
            continue;
          }

          // Determine page number if available from checkpoints
          let pageNumber: number | null = null;
          const checkpointDir = join(leaflet.workspacePath, 'hybrid_v3_checkpoints');
          if (existsSync(checkpointDir)) {
            try {
              const cpFiles = readdirSync(checkpointDir).filter((f) => f.endsWith('.checkpoint.json'));
              if (cpFiles.length === 1) {
                const match = cpFiles[0].match(/page_(\d+)\.checkpoint\.json/);
                if (match) pageNumber = Number(match[1]);
              }
            } catch {
              // Non-fatal
            }
          }

          const model = raw.model || leaflet.model || 'gemini-3.8-flash';
          const tier: 'flex' | 'standard' =
            raw.tier === 'standard' || usageMeta.trafficType === 'ON_DEMAND_STANDARD' ? 'standard' : 'flex';
          const actualTier = usageMeta.trafficType ? String(usageMeta.trafficType) : null;
          const isFailed = Boolean(raw.finishReason && raw.finishReason !== 'STOP');
          const outcome: GeminiUsageOutcome = isFailed ? 'failed' : 'success';
          const stageCategory: GeminiUsageStageCategory =
            raw.requestKind === 'card_crop' ? 'b2_selective_crop' : 'b1_full_page';
          const requestPurpose =
            raw.finishReason === 'MAX_TOKENS'
              ? 'b1_full_page_max_tokens'
              : (raw.requestPurpose || (stageCategory === 'b1_full_page' ? 'b1_full_page' : 'b2_selective_crop'));

          let startedAt: string;
          let completedAt: string;
          try {
            const st = statSync(filePath);
            completedAt = st.mtime.toISOString();
            startedAt = new Date(st.mtimeMs - 60000).toISOString();
          } catch {
            completedAt = new Date().toISOString();
            startedAt = completedAt;
          }

          const entry = buildLedgerEntryFromProviderCall({
            requestId: deterministicRequestId,
            batchId,
            runId: `historical_archive_${leaflet.leafletId}`,
            leafletId: leaflet.leafletId,
            pageNumber,
            stageCategory,
            requestPurpose,
            modelId: model,
            modelVersion: model,
            apiProvider: 'vertex_ai',
            requestedTier: tier,
            actualTier,
            startedAt,
            completedAt,
            durationMs: 60000,
            outcome,
            finishReason: raw.finishReason || (isFailed ? 'FAILED' : 'STOP'),
            cacheHit: false,
            usageReported: true,
            usage: {
              promptTokenCount: usageMeta.promptTokenCount,
              candidatesTokenCount: usageMeta.candidatesTokenCount,
              thoughtsTokenCount: usageMeta.thoughtsTokenCount ?? usageMeta.thinkingTokenCount,
              totalTokenCount: usageMeta.totalTokenCount,
              cachedContentTokenCount: usageMeta.cachedContentTokenCount
            },
            rawUsageMetadata: usageMeta,
            errorMessage:
              raw.errorMessage ||
              (raw.finishReason === 'MAX_TOKENS'
                ? 'Model finished with non-STOP finishReason=MAX_TOKENS; refusing partial/truncated JSON.'
                : null)
          });

          newEntries.push(entry);
          existingRequestIds.add(deterministicRequestId);
        } catch {
          // Non-fatal error reading single archive file
        }
      }
    }

    if (newEntries.length > 0) {
      const updatedLedger = this.recordEntries(newEntries, explicitLedgerPath, { updateLatestRunId: false });
      return { reconciledCount: newEntries.length, ledger: updatedLedger };
    }

    return { reconciledCount: 0, ledger };
  }

  public computeCostSummary(params: {
    batchId: string;
    manifest?: BatchManifest | null;
    offers?: Array<{ batchOfferKey: string; sourceOfferId: string; leafletId: string; sourcePage: number }>;
    explicitLedgerPath?: string;
    latestRunIdOverride?: string | null;
  }): BatchExtractionCostSummary {
    const ledger = this.loadLedger(params.batchId, params.explicitLedgerPath);
    const entries = ledger.entries;
    const latestRunId = params.latestRunIdOverride ?? ledger.latestRunId;

    const categoryBreakdown = emptyBreakdown();
    let totalMeasuredCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalThinkingTokens = 0;
    let totalCachedInputTokens = 0;
    let totalApiCalls = 0;
    let cacheHitCallsCount = 0;
    let failedOrRetriedApiCalls = 0;
    let failedAndRetriedMeasuredUsd = 0;
    let failedAndRetriedUnknownCount = 0;
    let unknownCostRequestsCount = 0;
    let priorSessionsCostUsd = 0;
    let latestSessionCostUsd = 0;

    const perLeafletMap = new Map<string, PerLeafletCostSummary>();
    for (const l of params.manifest?.leaflets || []) {
      perLeafletMap.set(l.leafletId, {
        leafletId: l.leafletId,
        fileName: l.fileName,
        pagesAttempted: 0,
        pagesCompleted: l.pagesProcessed || 0,
        offersExtracted: l.offersCount || 0,
        apiCallsCount: 0,
        failedOrRetriedCallsCount: 0,
        unknownCostCallsCount: 0,
        measuredCostUsd: 0,
        priorSessionsCostUsd: 0,
        latestSessionCostUsd: 0,
        categoryBreakdown: emptyBreakdown()
      });
    }

    const pageAttemptSetByLeaflet = new Map<string, Set<number>>();
    const perPageMap = new Map<string, PerPageCostSummary>();

    const getOrCreateLeaflet = (leafletId: string): PerLeafletCostSummary => {
      let row = perLeafletMap.get(leafletId);
      if (!row) {
        row = {
          leafletId,
          fileName: leafletId === 'batch' ? 'Batch-Level (Matching / Shared)' : leafletId,
          pagesAttempted: 0,
          pagesCompleted: 0,
          offersExtracted: 0,
          apiCallsCount: 0,
          failedOrRetriedCallsCount: 0,
          unknownCostCallsCount: 0,
          measuredCostUsd: 0,
          priorSessionsCostUsd: 0,
          latestSessionCostUsd: 0,
          categoryBreakdown: emptyBreakdown()
        };
        perLeafletMap.set(leafletId, row);
      }
      return row;
    };

    const getOrCreatePage = (leafletId: string, pageNumber: number): PerPageCostSummary => {
      const key = `${leafletId}::${pageNumber}`;
      let p = perPageMap.get(key);
      if (!p) {
        p = {
          leafletId,
          pageNumber,
          completed: false,
          offersExtracted: 0,
          apiCallsCount: 0,
          failedOrRetriedCallsCount: 0,
          unknownCostCallsCount: 0,
          measuredCostUsd: 0,
          b1CostUsd: 0,
          b2CostUsd: 0,
          recoveryCostUsd: 0,
          otherCostUsd: 0
        };
        perPageMap.set(key, p);
      }
      return p;
    };

    // Count completed pages and offers by page when available
    const offersByPageKey = new Map<string, Array<{ batchOfferKey: string; sourceOfferId: string; leafletId: string; sourcePage: number }>>();
    for (const off of params.offers || []) {
      const pk = `${off.leafletId}::${off.sourcePage}`;
      const arr = offersByPageKey.get(pk) || [];
      arr.push(off);
      offersByPageKey.set(pk, arr);
      const pg = getOrCreatePage(off.leafletId, off.sourcePage);
      pg.completed = true;
      pg.offersExtracted = arr.length;
    }

    for (const e of entries) {
      const lSum = getOrCreateLeaflet(e.leafletId || 'batch');
      if (typeof e.pageNumber === 'number' && Number.isFinite(e.pageNumber)) {
        const s = pageAttemptSetByLeaflet.get(lSum.leafletId) || new Set<number>();
        s.add(e.pageNumber);
        pageAttemptSetByLeaflet.set(lSum.leafletId, s);
      }

      if (e.cacheHit || e.usageStatus === 'cache_hit_zero') {
        cacheHitCallsCount++;
        continue;
      }

      totalApiCalls++;
      lSum.apiCallsCount++;
      totalInputTokens += e.promptTokens || 0;
      totalOutputTokens += e.responseTokens || 0;
      totalThinkingTokens += e.thinkingTokens || 0;
      totalCachedInputTokens += e.cachedInputTokens || 0;

      const isFailedOrRetried =
        e.outcome !== 'success' || Boolean(e.retryOfRequestId) || Boolean(e.recoveryParentRequestId);
      if (isFailedOrRetried) {
        failedOrRetriedApiCalls++;
        lSum.failedOrRetriedCallsCount++;
      }

      const isUnknown = e.usageStatus === 'unavailable_unknown' || e.measuredCostUsd === null;
      const costVal = isUnknown ? 0 : (e.measuredCostUsd || 0);

      if (isUnknown) {
        unknownCostRequestsCount++;
        lSum.unknownCostCallsCount++;
        if (isFailedOrRetried) failedAndRetriedUnknownCount++;
      } else {
        totalMeasuredCostUsd = round8(totalMeasuredCostUsd + costVal);
        categoryBreakdown[e.stageCategory] = round8(categoryBreakdown[e.stageCategory] + costVal);
        lSum.measuredCostUsd = round8(lSum.measuredCostUsd + costVal);
        lSum.categoryBreakdown[e.stageCategory] = round8(lSum.categoryBreakdown[e.stageCategory] + costVal);
        const isHistoricalArchive = e.runId.startsWith('historical_archive_') || Boolean(e.requestId.includes(':archive:'));
        if (!isHistoricalArchive && latestRunId && e.runId === latestRunId) {
          latestSessionCostUsd = round8(latestSessionCostUsd + costVal);
          lSum.latestSessionCostUsd = round8(lSum.latestSessionCostUsd + costVal);
        } else {
          priorSessionsCostUsd = round8(priorSessionsCostUsd + costVal);
          lSum.priorSessionsCostUsd = round8(lSum.priorSessionsCostUsd + costVal);
        }
        if (isFailedOrRetried) {
          failedAndRetriedMeasuredUsd = round8(failedAndRetriedMeasuredUsd + costVal);
        }
      }

      if (typeof e.pageNumber === 'number' && Number.isFinite(e.pageNumber) && e.leafletId !== 'batch') {
        const pg = getOrCreatePage(e.leafletId, e.pageNumber);
        pg.apiCallsCount++;
        if (isFailedOrRetried) pg.failedOrRetriedCallsCount++;
        if (isUnknown) pg.unknownCostCallsCount++;
        else {
          pg.measuredCostUsd = round8(pg.measuredCostUsd + costVal);
          if (e.stageCategory === 'b1_full_page') {
            if (e.recoveryParentRequestId) {
              pg.recoveryCostUsd = round8(pg.recoveryCostUsd + costVal);
            } else {
              pg.b1CostUsd = round8(pg.b1CostUsd + costVal);
            }
          } else if (e.stageCategory === 'b2_selective_crop') {
            pg.b2CostUsd = round8(pg.b2CostUsd + costVal);
          } else {
            pg.otherCostUsd = round8(pg.otherCostUsd + costVal);
          }
        }
      }
    }

    for (const [lid, pageSet] of pageAttemptSetByLeaflet.entries()) {
      const lSum = getOrCreateLeaflet(lid);
      lSum.pagesAttempted = Math.max(pageSet.size, lSum.pagesCompleted);
    }

    const pagesAttempted = Array.from(perLeafletMap.values()).reduce(
      (sum, l) => sum + (l.leafletId === 'batch' ? 0 : l.pagesAttempted),
      0
    );
    const pagesCompleted =
      params.manifest?.totals?.pagesProcessed ??
      Array.from(perPageMap.values()).filter((p) => p.completed).length;
    const offersExtracted =
      (params.offers && params.offers.length > 0 ? params.offers.length : params.manifest?.totals?.totalOffers) ?? 0;

    // Allocate measurable costs to extracted offers; keep failed/shared unattributable spend explicit
    const perOfferAllocations: PerOfferCostAllocation[] = [];
    let allocatedOfferTotal = 0;

    if (params.offers && params.offers.length > 0) {
      const directCostByOffer = new Map<string, number>();
      const sharedPageCostByPage = new Map<string, number>();

      for (const e of entries) {
        if (e.cacheHit || e.usageStatus !== 'measured' || e.measuredCostUsd == null) continue;
        if (e.sourceOfferId && (e.stageCategory === 'b2_selective_crop' || e.stageCategory === 'catalog_matching')) {
          const prev = directCostByOffer.get(e.sourceOfferId) || 0;
          directCostByOffer.set(e.sourceOfferId, round8(prev + e.measuredCostUsd));
        } else if (typeof e.pageNumber === 'number' && e.leafletId !== 'batch') {
          const pk = `${e.leafletId}::${e.pageNumber}`;
          if (offersByPageKey.has(pk)) {
            const prev = sharedPageCostByPage.get(pk) || 0;
            sharedPageCostByPage.set(pk, round8(prev + e.measuredCostUsd));
          }
        }
      }

      for (const off of params.offers) {
        const pk = `${off.leafletId}::${off.sourcePage}`;
        const pageOfferCount = offersByPageKey.get(pk)?.length || 1;
        const pageShared = sharedPageCostByPage.get(pk) || 0;
        const allocatedPageCostUsd = round8(pageShared / pageOfferCount);
        const directOfferCostUsd = round8(directCostByOffer.get(off.sourceOfferId) || 0);
        const totalAllocatedCostUsd = round8(allocatedPageCostUsd + directOfferCostUsd);
        allocatedOfferTotal = round8(allocatedOfferTotal + totalAllocatedCostUsd);
        perOfferAllocations.push({
          batchOfferKey: off.batchOfferKey,
          sourceOfferId: off.sourceOfferId,
          leafletId: off.leafletId,
          pageNumber: off.sourcePage,
          allocatedPageCostUsd,
          directOfferCostUsd,
          totalAllocatedCostUsd
        });
      }
    }

    const unallocatedSharedOrFailedCostUsd = round8(Math.max(0, totalMeasuredCostUsd - allocatedOfferTotal));

    const avgCostPerExtractedOfferUsd =
      offersExtracted > 0 ? round8(totalMeasuredCostUsd / offersExtracted) : null;
    const avgCostPerCompletedPageUsd =
      pagesCompleted > 0 ? round8(totalMeasuredCostUsd / pagesCompleted) : null;

    return {
      schemaVersion: 'wifran.gemini_cost_summary/1.0',
      batchId: params.batchId,
      latestRunId,
      totalMeasuredCostUsd,
      categoryBreakdown,
      failedAndRetriedInformational: {
        callsCount: failedOrRetriedApiCalls,
        measuredCostUsd: failedAndRetriedMeasuredUsd,
        unknownCostCallsCount: failedAndRetriedUnknownCount
      },
      pagesAttempted,
      pagesCompleted,
      offersExtracted,
      totalApiCalls,
      cacheHitCallsCount,
      failedOrRetriedApiCalls,
      unknownCostRequestsCount,
      hasUnconfirmedCosts: unknownCostRequestsCount > 0,
      totalInputTokens,
      totalOutputTokens,
      totalThinkingTokens,
      totalCachedInputTokens,
      avgCostPerExtractedOfferUsd,
      avgCostPerCompletedPageUsd,
      priorSessionsCostUsd,
      latestSessionCostUsd,
      maxAuthorizedSpendingUsd: params.manifest?.approvedScope?.approvedMaxBudgetUsd ?? null,
      unallocatedSharedOrFailedCostUsd,
      perLeaflet: Array.from(perLeafletMap.values()).filter(
        (l) => l.apiCallsCount > 0 || params.manifest?.leaflets.some((ml) => ml.leafletId === l.leafletId)
      ),
      perPage: Array.from(perPageMap.values()).sort((a, b) =>
        a.leafletId.localeCompare(b.leafletId) || a.pageNumber - b.pageNumber
      ),
      ...(perOfferAllocations.length > 0 ? { perOfferAllocations } : {}),
      measurementNote:
        unknownCostRequestsCount > 0
          ? `Measured subtotal from reported usage (${unknownCostRequestsCount} request(s) returned unavailable token metadata). Calculated locally from API-reported usage; final Google billing may differ.`
          : 'Calculated locally from API-reported token usage and applicable pricing schedule; final Google billing may differ.',
      updatedAt: new Date().toISOString()
    };
  }
}

export const sharedGeminiCostLedgerService = new GeminiCostLedgerService();
