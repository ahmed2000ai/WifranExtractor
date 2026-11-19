/**
 * WIFRAN-EXTRACTOR-IDENTITY-005E (WP5)
 * Isolated, Durable, Resumable Controlled Live V3 Extraction Pilot Runner.
 *
 * Strictly isolated from normal app extraction workflows (`legacy`, `optimized`, `compact_v1`).
 * Never touches production Supabase DB, never retries automatically on timeout/504/429,
 * never downgrades to Standard PayGo, never switches thinkingLevel away from MEDIUM,
 * and enforces strict 16-request and $0.25 USD cumulative caps.
 */

import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'fs';
import { dirname, join, resolve } from 'path';
import type { GoogleGenAI } from '@google/genai';
import {
  getGeminiClient,
  isVertexAiConfigured
} from './geminiClient';
import { calculateGeminiCost } from './geminiPricingTable';
import {
  buildV3PageExtractionSystemPrompt,
  buildV3PilotUserPrompt,
  getV3PromptAndSchemaFingerprints,
  runV3PilotProfilePreflight
} from './geminiV3PromptBuilder';
import {
  V3_EXTRACTION_SCHEMA_VERSION,
  decodeV3PageExtractionToOfferCards,
  getV3LeafletPageGenAiSchema
} from '../../shared/schemas/leafletPageExtractionV3Schema';

export const V3_PILOT_HARD_MAX_REQUESTS = 16;
export const V3_PILOT_HARD_SPEND_CAP_USD = 0.25;
export const V3_PILOT_DEFAULT_TIMEOUT_MS = 600_000;
export const V3_PILOT_DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
export const V3_PILOT_DEFAULT_MODEL = 'gemini-3.8-flash';
export const V3_PILOT_DEFAULT_THINKING_LEVEL = 'MEDIUM' as const;
export const V3_PILOT_DEFAULT_TIER = 'flex' as const;
export const V3_PILOT_DEFAULT_LOCATION = 'global';
export const V3_PILOT_COST_AS_OF_DATE = '2026-11-14';

// Conservative upper-bound pre-dispatch cost reserve per request type
const CONSERVATIVE_RESERVE_CROP_USD = 0.008;
const CONSERVATIVE_RESERVE_PAGE_USD = 0.025;

export type V3PilotSlotKind = 'crop' | 'page';
export type V3PilotSlotStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'outcome_unknown';

export interface V3PilotManifestSlot {
  slotIndex: number;
  slotId: string;
  kind: V3PilotSlotKind;
  retailer: string;
  leafletId: string;
  pageNumber: number;
  sourceOfferId: string | null;
  filePath: string;
  mimeType: 'image/webp' | 'application/pdf';
  assetSha256: string;
  assetBytes: number;
  status: V3PilotSlotStatus;
  attemptCount: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  finishReason: string | null;
  schemaValid: boolean | null;
  extractedOfferCount: number | null;
  usage: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    thoughtsTokenCount: number;
    cachedContentTokenCount: number;
    totalTokenCount: number;
    usageReported: boolean;
  } | null;
  estimatedCostUsd: number;
  rawArchivePath: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface V3PilotManifest {
  manifestVersion: 'wifran.v3.pilot.manifest/1.0';
  milestone: 'WIFRAN-EXTRACTOR-IDENTITY-005E';
  createdAt: string;
  updatedAt: string;
  specSha256: string;
  frozenGroundTruthSha256: string;
  runtimeConfig: {
    model: string;
    thinkingLevel: 'MEDIUM';
    tier: 'flex';
    vertexLocation: 'global';
    perRequestTimeoutMs: number;
    maxOutputTokens: number;
    concurrency: 1;
    automaticRetriesAllowed: false;
    standardFallbackAllowed: false;
    promptVersion: string;
    schemaVersion: string;
    promptSha256: string;
    schemaSha256: string;
  };
  limits: {
    hardMaxRequests: number;
    hardSpendCapUsd: number;
  };
  counters: {
    submittedAttemptsCount: number;
    completedCount: number;
    failedCount: number;
    outcomeUnknownCount: number;
    pendingCount: number;
    cumulativeEstimatedCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
    totalCachedInputTokens: number;
  };
  stoppedReason: string | null;
  slots: V3PilotManifestSlot[];
}

export interface RunV3LivePilotOptions {
  repoRoot?: string;
  specPath?: string;
  groundTruthPath?: string;
  outputDir?: string;
  onlySlotId?: string;
  maxSlotsToRunThisInvocation?: number;
  perRequestTimeoutMs?: number;
  maxOutputTokens?: number;
  hardSpendCapUsd?: number;
  client?: GoogleGenAI;
  signal?: AbortSignal;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

function sanitizeErrorMessage(rawMessage: string): string {
  return rawMessage
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/private_key['":\s]+[^",\n}]+/gi, 'private_key: [REDACTED]');
}

function recomputeManifestCounters(manifest: V3PilotManifest): void {
  let completedCount = 0;
  let failedCount = 0;
  let outcomeUnknownCount = 0;
  let pendingCount = 0;
  let cumulativeEstimatedCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalThinkingTokens = 0;
  let totalCachedInputTokens = 0;

  for (const s of manifest.slots) {
    if (s.status === 'completed') completedCount++;
    else if (s.status === 'failed') failedCount++;
    else if (s.status === 'outcome_unknown') outcomeUnknownCount++;
    else if (s.status === 'pending') pendingCount++;

    cumulativeEstimatedCostUsd += s.estimatedCostUsd || 0;
    if (s.usage?.usageReported) {
      totalInputTokens += s.usage.promptTokenCount || 0;
      totalOutputTokens += s.usage.candidatesTokenCount || 0;
      totalThinkingTokens += s.usage.thoughtsTokenCount || 0;
      totalCachedInputTokens += s.usage.cachedContentTokenCount || 0;
    }
  }

  manifest.counters = {
    submittedAttemptsCount: manifest.slots.reduce((sum, s) => sum + (s.attemptCount || 0), 0),
    completedCount,
    failedCount,
    outcomeUnknownCount,
    pendingCount,
    cumulativeEstimatedCostUsd: Number(cumulativeEstimatedCostUsd.toFixed(8)),
    totalInputTokens,
    totalOutputTokens,
    totalThinkingTokens,
    totalCachedInputTokens
  };
  manifest.updatedAt = new Date().toISOString();
}

function inferRetailerName(filePath: string, fallback?: string): { retailerId: string | null; retailerName: string } {
  const lower = filePath.toLowerCase();
  if (lower.includes('panda')) return { retailerId: 'c2cc16c2-0005-4444-b000-c00000000005', retailerName: 'Panda' };
  if (lower.includes('bndw')) return { retailerId: 'c2cc16c2-0001-4444-b000-c00000000001', retailerName: 'BinDawood' };
  if (lower.includes('noori')) return { retailerId: 'c2cc16c2-0009-4444-b000-c00000000009', retailerName: 'Noori Supermarket' };
  if (lower.includes('alwafa')) return { retailerId: 'c2cc16c2-0008-4444-b000-c00000000008', retailerName: 'AlWafa' };
  return { retailerId: null, retailerName: fallback || 'Unknown' };
}

function inferLeafletAndPage(slot: V3PilotManifestSlot): { leafletId: string; pageNumber: number } {
  return {
    leafletId: slot.leafletId,
    pageNumber: slot.pageNumber
  };
}

/**
 * Initializes or loads a durable 16-slot pilot manifest, failing closed on any asset
 * mismatch or prompt/schema tampering and marking leftover `in_progress` slots as `outcome_unknown`.
 */
export function initializeOrLoadV3PilotManifest(options: {
  repoRoot: string;
  specPath: string;
  groundTruthPath: string;
  outputDir: string;
  perRequestTimeoutMs: number;
  maxOutputTokens: number;
  hardSpendCapUsd: number;
}): { manifest: V3PilotManifest; manifestPath: string; recoveredInterruptedSlots: string[] } {
  const {
    repoRoot,
    specPath,
    groundTruthPath,
    outputDir,
    perRequestTimeoutMs,
    maxOutputTokens,
    hardSpendCapUsd
  } = options;

  if (!existsSync(specPath)) {
    throw new Error(`V3_PILOT_MISSING_SPEC: Spec file not found at ${specPath}`);
  }
  if (!existsSync(groundTruthPath)) {
    throw new Error(`V3_PILOT_MISSING_GROUND_TRUTH: Frozen ground truth file not found at ${groundTruthPath}`);
  }

  const specRaw = readFileSync(specPath, 'utf8');
  const spec = JSON.parse(specRaw);
  const gtRaw = readFileSync(groundTruthPath, 'utf8');
  const specSha256 = sha256Hex(specRaw);
  const frozenGroundTruthSha256 = sha256Hex(gtRaw);

  const fingerprints = getV3PromptAndSchemaFingerprints();
  const manifestPath = join(outputDir, 'manifest.json');
  const recoveredInterruptedSlots: string[] = [];

  if (existsSync(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, 'utf8')) as V3PilotManifest;
    if (existing.frozenGroundTruthSha256 !== frozenGroundTruthSha256) {
      throw new Error(
        `V3_PILOT_GT_DRIFT_ABORT: Frozen ground truth SHA-256 changed after manifest initialization (${existing.frozenGroundTruthSha256} vs ${frozenGroundTruthSha256}).`
      );
    }
    if (existing.runtimeConfig.promptSha256 !== fingerprints.promptSha256) {
      throw new Error(
        `V3_PILOT_PROMPT_DRIFT_ABORT: V3 prompt SHA-256 changed after live execution started (${existing.runtimeConfig.promptSha256} vs ${fingerprints.promptSha256}).`
      );
    }
    if (existing.runtimeConfig.schemaSha256 !== fingerprints.schemaSha256) {
      throw new Error(
        `V3_PILOT_SCHEMA_DRIFT_ABORT: V3 schema SHA-256 changed after live execution started (${existing.runtimeConfig.schemaSha256} vs ${fingerprints.schemaSha256}).`
      );
    }

    for (const slot of existing.slots) {
      if (slot.status === 'in_progress') {
        slot.status = 'outcome_unknown';
        slot.completedAt = new Date().toISOString();
        slot.errorCode = 'INTERRUPTED_IN_PROGRESS';
        slot.errorMessage =
          'Process terminated while slot was in_progress; marked outcome_unknown to prevent duplicate paid submission.';
        recoveredInterruptedSlots.push(slot.slotId);
      }
    }

    recomputeManifestCounters(existing);
    existing.limits.hardSpendCapUsd = Math.min(existing.limits.hardSpendCapUsd, hardSpendCapUsd);
    if (recoveredInterruptedSlots.length > 0) {
      writeJsonAtomic(manifestPath, existing);
    }
    return { manifest: existing, manifestPath, recoveredInterruptedSlots };
  }

  const slots: V3PilotManifestSlot[] = [];
  let idx = 0;

  // Order: 12 crops first (starting with pilot_crop_01_baskin_robbins for Stage 1 single-crop gate §7), then 4 full pages
  for (const crop of spec.crops || []) {
    const absPath = resolve(repoRoot, crop.file_path);
    if (!existsSync(absPath)) {
      throw new Error(`V3_PILOT_MISSING_ASSET: Crop file not found: ${crop.file_path}`);
    }
    const buf = readFileSync(absPath);
    const { retailerName } = inferRetailerName(crop.file_path);
    const pageMatch = String(crop.source_offer_id || '').match(/_p(\d+)_/i);
    const pageNumber = pageMatch ? Number(pageMatch[1]) : 1;
    const leafletId =
      retailerName === 'Panda'
        ? 'panda-national-national-2026-10-20'
        : retailerName === 'BinDawood'
          ? 'bin-dawood-national-national-2026-10-20'
          : retailerName === 'Noori Supermarket'
            ? 'noori-jeddah-2026-11-15'
            : 'alwafa-city-jeddah-2026-10-20';

    slots.push({
      slotIndex: idx++,
      slotId: crop.pilot_crop_id,
      kind: 'crop',
      retailer: retailerName,
      leafletId,
      pageNumber,
      sourceOfferId: crop.source_offer_id,
      filePath: crop.file_path,
      mimeType: 'image/webp',
      assetSha256: sha256Hex(buf),
      assetBytes: buf.length,
      status: 'pending',
      attemptCount: 0,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      finishReason: null,
      schemaValid: null,
      extractedOfferCount: null,
      usage: null,
      estimatedCostUsd: 0,
      rawArchivePath: null,
      errorCode: null,
      errorMessage: null
    });
  }

  for (const page of spec.pages || []) {
    const absPath = resolve(repoRoot, page.file_path);
    if (!existsSync(absPath)) {
      throw new Error(`V3_PILOT_MISSING_ASSET: Page PDF file not found: ${page.file_path}`);
    }
    const buf = readFileSync(absPath);
    slots.push({
      slotIndex: idx++,
      slotId: page.pilot_page_id,
      kind: 'page',
      retailer: page.retailer,
      leafletId: page.leaflet_id,
      pageNumber: page.page_number,
      sourceOfferId: null,
      filePath: page.file_path,
      mimeType: 'application/pdf',
      assetSha256: sha256Hex(buf),
      assetBytes: buf.length,
      status: 'pending',
      attemptCount: 0,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      finishReason: null,
      schemaValid: null,
      extractedOfferCount: null,
      usage: null,
      estimatedCostUsd: 0,
      rawArchivePath: null,
      errorCode: null,
      errorMessage: null
    });
  }

  if (slots.length !== V3_PILOT_HARD_MAX_REQUESTS) {
    throw new Error(
      `V3_PILOT_SLOT_COUNT_MISMATCH: Expected exactly ${V3_PILOT_HARD_MAX_REQUESTS} slots, got ${slots.length}.`
    );
  }

  const manifest: V3PilotManifest = {
    manifestVersion: 'wifran.v3.pilot.manifest/1.0',
    milestone: 'WIFRAN-EXTRACTOR-IDENTITY-005E',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    specSha256,
    frozenGroundTruthSha256,
    runtimeConfig: {
      model: V3_PILOT_DEFAULT_MODEL,
      thinkingLevel: V3_PILOT_DEFAULT_THINKING_LEVEL,
      tier: V3_PILOT_DEFAULT_TIER,
      vertexLocation: V3_PILOT_DEFAULT_LOCATION,
      perRequestTimeoutMs,
      maxOutputTokens,
      concurrency: 1,
      automaticRetriesAllowed: false,
      standardFallbackAllowed: false,
      promptVersion: fingerprints.promptVersion,
      schemaVersion: V3_EXTRACTION_SCHEMA_VERSION,
      promptSha256: fingerprints.promptSha256,
      schemaSha256: fingerprints.schemaSha256
    },
    limits: {
      hardMaxRequests: V3_PILOT_HARD_MAX_REQUESTS,
      hardSpendCapUsd
    },
    counters: {
      submittedAttemptsCount: 0,
      completedCount: 0,
      failedCount: 0,
      outcomeUnknownCount: 0,
      pendingCount: slots.length,
      cumulativeEstimatedCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalThinkingTokens: 0,
      totalCachedInputTokens: 0
    },
    stoppedReason: null,
    slots
  };

  writeJsonAtomic(manifestPath, manifest);
  return { manifest, manifestPath, recoveredInterruptedSlots };
}

/**
 * Executes pending authorized slots sequentially (concurrency = 1, 0 retries, hard budget/call caps).
 */
export async function runV3LivePilot(options: RunV3LivePilotOptions = {}): Promise<{
  manifest: V3PilotManifest;
  manifestPath: string;
  executedThisRun: string[];
}> {
  const repoRoot = options.repoRoot || process.cwd();
  const specPath = options.specPath || join(repoRoot, 'src', 'shared', 'fixtures', 'v3', 'pilot_4pages_12crops_spec.json');
  const groundTruthPath =
    options.groundTruthPath || join(repoRoot, 'src', 'shared', 'fixtures', 'v3', 'pilot_005e_frozen_ground_truth.json');
  const outputDir = options.outputDir || join(repoRoot, 'Extracts', 'pilot_v3_005e');
  const perRequestTimeoutMs = options.perRequestTimeoutMs ?? V3_PILOT_DEFAULT_TIMEOUT_MS;
  const maxOutputTokens = options.maxOutputTokens ?? V3_PILOT_DEFAULT_MAX_OUTPUT_TOKENS;
  const hardSpendCapUsd = Math.min(
    V3_PILOT_HARD_SPEND_CAP_USD,
    options.hardSpendCapUsd ?? V3_PILOT_HARD_SPEND_CAP_USD
  );

  // Strict location check for live Vertex Flex runs
  const configuredLocation = process.env.GCP_LOCATION || 'global';
  if (!options.client) {
    if (!isVertexAiConfigured()) {
      throw new Error(
        'V3_PILOT_VERTEX_NOT_CONFIGURED: GCP_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS must be set for live Vertex AI Flex execution.'
      );
    }
    if (configuredLocation !== 'global') {
      throw new Error(
        `V3_PILOT_INVALID_LOCATION: Vertex AI Flex requires location="global", got "${configuredLocation}".`
      );
    }
  }

  const systemInstruction = buildV3PageExtractionSystemPrompt();
  const responseSchema = getV3LeafletPageGenAiSchema();

  const preflight = runV3PilotProfilePreflight({
    executionContext: 'isolated_pilot_runner',
    requestedProfile: 'extraction_v3',
    explicitV3Authorization: true,
    model: V3_PILOT_DEFAULT_MODEL,
    thinkingLevel: V3_PILOT_DEFAULT_THINKING_LEVEL,
    tier: V3_PILOT_DEFAULT_TIER,
    vertexLocation: configuredLocation as 'global',
    promptPayloadCandidate: systemInstruction
  });

  if (!preflight.ok || !preflight.canExecute || !preflight.v3Activated) {
    throw new Error(`V3_PILOT_PREFLIGHT_ABORT: ${preflight.abortedReason || 'Preflight blocked execution.'}`);
  }

  const activeClient = options.client || getGeminiClient();
  if (!options.client && !(activeClient as any).vertexai) {
    throw new Error(
      'V3_PILOT_BACKEND_ABORT: Active Gemini client is not Vertex AI; refusing to fall back to Developer API.'
    );
  }

  const { manifest, manifestPath } = initializeOrLoadV3PilotManifest({
    repoRoot,
    specPath,
    groundTruthPath,
    outputDir,
    perRequestTimeoutMs,
    maxOutputTokens,
    hardSpendCapUsd
  });

  const executedThisRun: string[] = [];
  let slotsRanHere = 0;

  for (const slot of manifest.slots) {
    if (options.onlySlotId && slot.slotId !== options.onlySlotId) {
      continue;
    }
    if (slot.status !== 'pending') {
      continue;
    }
    if (options.signal?.aborted) {
      manifest.stoppedReason = 'OPERATOR_ABORTED';
      recomputeManifestCounters(manifest);
      writeJsonAtomic(manifestPath, manifest);
      break;
    }
    if (
      options.maxSlotsToRunThisInvocation !== undefined &&
      slotsRanHere >= options.maxSlotsToRunThisInvocation
    ) {
      break;
    }

    recomputeManifestCounters(manifest);
    if (manifest.counters.submittedAttemptsCount >= manifest.limits.hardMaxRequests) {
      manifest.stoppedReason = 'HARD_REQUEST_CAP_REACHED';
      writeJsonAtomic(manifestPath, manifest);
      break;
    }

    const slotReserveUsd =
      slot.kind === 'page' ? CONSERVATIVE_RESERVE_PAGE_USD : CONSERVATIVE_RESERVE_CROP_USD;
    if (manifest.counters.cumulativeEstimatedCostUsd + slotReserveUsd > manifest.limits.hardSpendCapUsd) {
      manifest.stoppedReason = `HARD_SPEND_CAP_REACHED_PRE_DISPATCH (cumulative=$${manifest.counters.cumulativeEstimatedCostUsd.toFixed(6)}, reserve=$${slotReserveUsd.toFixed(4)}, cap=$${manifest.limits.hardSpendCapUsd})`;
      writeJsonAtomic(manifestPath, manifest);
      break;
    }

    const userPrompt = buildV3PilotUserPrompt({
      mode: slot.kind,
      retailer: slot.retailer,
      leafletId: slot.leafletId,
      pageNumber: slot.pageNumber,
      slotId: slot.slotId
    });

    // Double-check user prompt contains zero ground-truth marker keys
    const userPreflight = runV3PilotProfilePreflight({
      executionContext: 'isolated_pilot_runner',
      requestedProfile: 'extraction_v3',
      explicitV3Authorization: true,
      promptPayloadCandidate: userPrompt
    });
    if (!userPreflight.ok) {
      throw new Error(`V3_PILOT_USER_PROMPT_ABORT: ${userPreflight.abortedReason}`);
    }

    const assetAbsPath = resolve(repoRoot, slot.filePath);
    const assetBuffer = readFileSync(assetAbsPath);
    const base64Data = assetBuffer.toString('base64');

    // Crash-safe checkpoint BEFORE network submission: slot becomes in_progress & attemptCount increments
    slot.status = 'in_progress';
    slot.attemptCount += 1;
    slot.startedAt = new Date().toISOString();
    recomputeManifestCounters(manifest);
    writeJsonAtomic(manifestPath, manifest);

    const attemptStartMs = Date.now();
    const attemptController = new AbortController();
    const timer = setTimeout(() => attemptController.abort(), perRequestTimeoutMs);
    const onParentAbort = () => attemptController.abort();
    options.signal?.addEventListener('abort', onParentAbort);

    const requestConfig: Record<string, any> = {
      thinkingConfig: { thinkingLevel: V3_PILOT_DEFAULT_THINKING_LEVEL },
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema,
      systemInstruction,
      abortSignal: attemptController.signal,
      httpOptions: {
        timeout: perRequestTimeoutMs,
        headers: {
          'X-Vertex-AI-LLM-Request-Type': 'shared',
          'X-Vertex-AI-LLM-Shared-Request-Type': 'flex'
        }
      }
    };

    try {
      const response: any = await activeClient.models.generateContent({
        model: V3_PILOT_DEFAULT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: slot.mimeType,
                  data: base64Data
                }
              },
              {
                text: userPrompt
              }
            ]
          }
        ],
        config: requestConfig
      });

      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onParentAbort);

      const durationMs = Date.now() - attemptStartMs;
      const finishReason: string | null = response?.candidates?.[0]?.finishReason ?? null;
      const rawResponseText =
        typeof response === 'string'
          ? response
          : response?.text !== undefined
            ? response.text
            : JSON.stringify(response);

      if (!rawResponseText) {
        throw new Error('GEMINI_EMPTY_RESPONSE: Model returned empty text.');
      }

      const meta = response?.usageMetadata;
      const usageReported = Boolean(
        meta && (meta.promptTokenCount !== undefined || meta.totalTokenCount !== undefined)
      );
      const usageObj = {
        promptTokenCount: meta?.promptTokenCount ?? 0,
        candidatesTokenCount: meta?.candidatesTokenCount ?? meta?.responseTokenCount ?? 0,
        thoughtsTokenCount: meta?.thoughtsTokenCount ?? 0,
        cachedContentTokenCount: meta?.cachedContentTokenCount ?? 0,
        totalTokenCount:
          meta?.totalTokenCount ??
          (meta?.promptTokenCount || 0) +
            (meta?.candidatesTokenCount || meta?.responseTokenCount || 0) +
            (meta?.thoughtsTokenCount || 0),
        usageReported
      };

      const costCalc = calculateGeminiCost(
        usageReported ? usageObj : {},
        V3_PILOT_DEFAULT_MODEL,
        V3_PILOT_DEFAULT_TIER,
        V3_PILOT_COST_AS_OF_DATE
      );

      let parsedJson: unknown = null;
      let parseError: string | null = null;
      try {
        parsedJson = JSON.parse(rawResponseText);
      } catch (err: any) {
        parseError = `JSON_PARSE_ERROR: ${err?.message || String(err)}`;
      }

      const { retailerId, retailerName } = inferRetailerName(slot.filePath, slot.retailer);
      const { leafletId, pageNumber } = inferLeafletAndPage(slot);
      const decoded = parsedJson
        ? decodeV3PageExtractionToOfferCards(parsedJson, {
            leafletId,
            pageNumber,
            sourceOfferIdPrefix: slot.slotId,
            explicitSingleOfferId: slot.sourceOfferId,
            retailerId,
            retailerName,
            sourceEvidenceRefInternal: slot.filePath
          })
        : {
            schemaValid: false,
            schemaErrors: [parseError || 'JSON parse failed'],
            rawExtraction: null,
            cards: []
          };

      const rawArchiveRel = `responses/${slot.slotId}.raw.json`;
      const rawArchiveAbs = join(outputDir, rawArchiveRel);
      writeJsonAtomic(rawArchiveAbs, {
        slotId: slot.slotId,
        kind: slot.kind,
        retailer: slot.retailer,
        filePath: slot.filePath,
        assetSha256: slot.assetSha256,
        assetBytes: slot.assetBytes,
        requestFingerprint: {
          model: V3_PILOT_DEFAULT_MODEL,
          thinkingLevel: V3_PILOT_DEFAULT_THINKING_LEVEL,
          tier: V3_PILOT_DEFAULT_TIER,
          vertexLocation: configuredLocation,
          maxOutputTokens,
          promptVersion: manifest.runtimeConfig.promptVersion,
          schemaVersion: manifest.runtimeConfig.schemaVersion,
          promptSha256: manifest.runtimeConfig.promptSha256,
          schemaSha256: manifest.runtimeConfig.schemaSha256,
          userPrompt
        },
        startedAt: slot.startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        finishReason,
        usageMetadataRaw: meta ?? null,
        costCalculation: costCalc,
        schemaValid: decoded.schemaValid,
        schemaErrors: decoded.schemaErrors,
        rawResponseText,
        parsedResponse: parsedJson,
        decodedOfferCardsCount: decoded.cards.length,
        decodedOfferCards: decoded.cards
      });

      slot.status = decoded.schemaValid && !parseError ? 'completed' : 'failed';
      slot.completedAt = new Date().toISOString();
      slot.durationMs = durationMs;
      slot.finishReason = finishReason;
      slot.schemaValid = decoded.schemaValid;
      slot.extractedOfferCount = decoded.cards.length;
      slot.usage = usageObj;
      slot.estimatedCostUsd = costCalc.totalCostUsd;
      slot.rawArchivePath = rawArchiveRel;
      if (parseError || !decoded.schemaValid) {
        slot.errorCode = parseError ? 'JSON_PARSE_ERROR' : 'SCHEMA_VALIDATION_ERROR';
        slot.errorMessage = (decoded.schemaErrors || [parseError || '']).slice(0, 3).join('; ');
      }

      recomputeManifestCounters(manifest);
      writeJsonAtomic(manifestPath, manifest);
      executedThisRun.push(slot.slotId);
      slotsRanHere++;

      if (manifest.counters.cumulativeEstimatedCostUsd >= manifest.limits.hardSpendCapUsd) {
        manifest.stoppedReason = `HARD_SPEND_CAP_REACHED_POST_RESPONSE ($${manifest.counters.cumulativeEstimatedCostUsd.toFixed(6)})`;
        writeJsonAtomic(manifestPath, manifest);
        break;
      }
    } catch (err: any) {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onParentAbort);

      const durationMs = Date.now() - attemptStartMs;
      const isTimeout = attemptController.signal.aborted && !options.signal?.aborted;
      const rawErrMsg = sanitizeErrorMessage(err?.message || String(err));
      const statusCode = err?.status || err?.statusCode || null;
      const errorCode = isTimeout
        ? 'FLEX_TIMEOUT_NO_RETRY'
        : statusCode
          ? `HTTP_${statusCode}`
          : 'GEMINI_REQUEST_ERROR';

      const errorArchiveRel = `responses/${slot.slotId}.error.json`;
      writeJsonAtomic(join(outputDir, errorArchiveRel), {
        slotId: slot.slotId,
        kind: slot.kind,
        filePath: slot.filePath,
        startedAt: slot.startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        errorCode,
        statusCode,
        errorMessage: rawErrMsg
      });

      // Strictly NO retry and NO fallback
      slot.status = 'failed';
      slot.completedAt = new Date().toISOString();
      slot.durationMs = durationMs;
      slot.errorCode = errorCode;
      slot.errorMessage = rawErrMsg;
      slot.rawArchivePath = errorArchiveRel;

      recomputeManifestCounters(manifest);
      writeJsonAtomic(manifestPath, manifest);
      executedThisRun.push(slot.slotId);
      slotsRanHere++;
    }
  }

  return {
    manifest,
    manifestPath,
    executedThisRun
  };
}
