/**
 * WIFRAN-EXTRACTOR-IDENTITY-005H (WP7-F)
 * Production-Capable Vertex AI Flex Live Extraction Adapter for Hybrid Workflow.
 *
 * Implements `HybridExtractionProvider` over `@google/genai` (Vertex AI Flex tier)
 * behind explicit activation & authorization guards (`enabledByDefault = false`).
 *
 * Safeguards:
 * - Zero auto-retries (single attempt per call; errors/timeouts surface immediately).
 * - Zero fallback to legacy V2 extractors or Developer API keys.
 * - Zero Supabase/database writes.
 * - Conservative cost reservation (`outcomeUnknown = true`) when HTTP timeout/abort
 *   leaves billing status ambiguous.
 * - Full prompt/schema fingerprinting, finishReason tracking, nullable tolerance,
 *   and raw response archival.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { loadEnvConfig } from '../../config/env';
import { getGeminiClient, isVertexAiConfigured } from '../geminiClient';
import { calculateGeminiCost, type GeminiTokenUsageInput } from '../geminiPricingTable';
import {
  V3_CROP_PROMPT_VERSION,
  V3_PROMPT_VERSION,
  buildV3CardCropSystemPrompt,
  buildV3CardCropUserPrompt,
  buildV3PageExtractionSystemPrompt,
  buildV3PilotUserPrompt,
  getV3CropPromptAndSchemaFingerprints,
  getV3PromptAndSchemaFingerprints
} from '../geminiV3PromptBuilder';
import {
  V3_CROP_SCHEMA_VERSION,
  V3_EXTRACTION_SCHEMA_VERSION,
  adaptV3CropExtractionToV3PagePayload,
  decodeV3PageExtractionToOfferCards,
  getV3CardCropGenAiSchema,
  getV3LeafletPageGenAiSchema
} from '../../../shared/schemas/leafletPageExtractionV3Schema';
import { stripUnexpectedCurrencyFromModelResponse } from '../../../shared/utils/geminiResponseSanitizer';
import type {
  HybridExecutionContext,
  HybridExtractionProvider,
  HybridExtractionProviderResponse,
  HybridExtractionRequestPayload,
  PageContextVerificationEvidence
} from '../../../shared/types/hybridExtractionV3';
import { PILOT_005E_TELEMETRY_BASELINE } from './hybridCostLatencyGovernor';

export const HYBRID_LIVE_DEFAULT_MODEL = 'gemini-3.8-flash';
export const HYBRID_LIVE_DEFAULT_THINKING_LEVEL = 'MEDIUM' as const;
export const HYBRID_LIVE_DEFAULT_TIER = 'flex' as const;
/**
 * Target consistent 10-minute B1 Flex server-side request deadline (600,000 ms).
 * Coordinated with client AbortController safety margin (30,000 ms).
 */
export const HYBRID_LIVE_DEFAULT_TIMEOUT_MS = 600_000;
export const HYBRID_LIVE_CLIENT_SAFETY_MARGIN_MS = 30_000;
/**
 * Full-page B1 safety ceiling: Gemini 3.8 Flash (Vertex AI global) supports 65,536
 * output tokens (shared across visible JSON candidates + thinking tokens).
 */
export const HYBRID_LIVE_DEFAULT_MAX_OUTPUT_TOKENS = 65_536;
export const HYBRID_LIVE_DEFAULT_CROP_MAX_OUTPUT_TOKENS = 16_384;
export const HYBRID_LIVE_PAGE_CONTEXT_MAX_OUTPUT_TOKENS = 4_096;
/**
 * Minimum effective `maxOutputTokens` enforced for `card_crop`
 * calls so callers cannot silently downgrade card crops (e.g. 6,144)
 * and trigger `MAX_TOKENS` truncation during `thinkingLevel: MEDIUM` bursts.
 */
export const HYBRID_LIVE_MIN_CARD_OUTPUT_TOKENS = 16_384;

export interface MinimalGenAiClient {
  vertexai?: boolean;
  models: {
    generateContent(params: Record<string, any>): Promise<any>;
  };
}

export interface HybridGeminiLiveProviderOptions {
  executionContext: HybridExecutionContext;
  featureEnabled: boolean;
  explicitLiveAuthorization: boolean;
  model?: string;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  tier?: 'flex' | 'standard';
  perRequestTimeoutMs?: number;
  maxOutputTokens?: number;
  cropMaxOutputTokens?: number;
  pageContextMaxOutputTokens?: number;
  archiveDir?: string;
  abortSignal?: AbortSignal;
  /**
   * Optional injected mock/test client conforming to `@google/genai`.
   * When provided in offline tests, live Vertex env credentials are not required.
   */
  client?: MinimalGenAiClient;
}

const PAGE_CONTEXT_SYSTEM_INSTRUCTION =
  'You are verifying header and footer context of a retail promotional leaflet page. Extract ONLY printed validity dates, explicit regional/branch restrictions, and explicit printed offer-number exceptions if applicable. Quote explicit qualifying wording verbatim.';

export function getHybridPageContextGenAiSchema(): Record<string, unknown> {
  return {
    type: 'OBJECT',
    required: [
      'verified',
      'explicit_scope_evidence',
      'scope_proof_quote',
      'validity_start_date',
      'validity_end_date',
      'regional_scope',
      'exception_offer_numbers'
    ],
    properties: {
      verified: { type: 'BOOLEAN' },
      explicit_scope_evidence: { type: 'STRING', nullable: true },
      scope_proof_quote: { type: 'STRING', nullable: true },
      validity_start_date: { type: 'STRING', nullable: true },
      validity_end_date: { type: 'STRING', nullable: true },
      regional_scope: { type: 'STRING', nullable: true },
      exception_offer_numbers: { type: 'ARRAY', items: { type: 'INTEGER' } }
    }
  };
}

function inferImageMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

function isAbortOrTimeoutError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err || '').toLowerCase();
  const name = String(err instanceof Error ? err.name : '').toLowerCase();
  return (
    name.includes('abort') ||
    msg.includes('abort') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset')
  );
}

function writeRawArchive(
  archiveDir: string | undefined,
  fileName: string,
  payload: Record<string, unknown>
): string | null {
  if (!archiveDir) return null;
  mkdirSync(archiveDir, { recursive: true });
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const fullPath = join(archiveDir, `${safeName}.raw.json`);
  writeFileSync(fullPath, JSON.stringify(payload, null, 2), 'utf8');
  return fullPath;
}

/**
 * Validates offline or preflight readiness of the live Gemini/Vertex hybrid adapter
 * without triggering any network request.
 */
export function preflightHybridLiveProvider(
  options: HybridGeminiLiveProviderOptions
): { ok: boolean; reason: string | null } {
  if (options.executionContext !== 'isolated_hybrid_workflow') {
    return {
      ok: false,
      reason: 'HYBRID_LIVE_CONTEXT_BLOCKED: Live hybrid calls require executionContext="isolated_hybrid_workflow".'
    };
  }
  if (!options.featureEnabled) {
    return {
      ok: false,
      reason: 'HYBRID_LIVE_DISABLED_BY_DEFAULT: featureEnabled must be explicitly true.'
    };
  }
  if (!options.explicitLiveAuthorization) {
    return {
      ok: false,
      reason: 'HYBRID_LIVE_AUTHORIZATION_REQUIRED: explicitLiveAuthorization must be explicitly true.'
    };
  }
  if (!options.client) {
    const env = loadEnvConfig();
    if (!isVertexAiConfigured()) {
      return {
        ok: false,
        reason:
          'HYBRID_LIVE_VERTEX_NOT_CONFIGURED: GCP_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS are required; never falling back to Developer API.'
      };
    }
    if (env.gemini.gcpLocation !== 'global') {
      return {
        ok: false,
        reason: `HYBRID_LIVE_INVALID_LOCATION: Vertex AI Flex requires GCP_LOCATION="global", got "${env.gemini.gcpLocation}".`
      };
    }
  }
  return { ok: true, reason: null };
}

/**
 * Creates a production-capable `HybridExtractionProvider` bound to `@google/genai` Vertex AI Flex
 * (or an injected mock client in offline Stage A tests).
 */
export function createHybridGeminiLiveProvider(
  options: HybridGeminiLiveProviderOptions
): HybridExtractionProvider {
  const preflight = preflightHybridLiveProvider(options);
  if (!preflight.ok) {
    throw new Error(preflight.reason || 'HYBRID_LIVE_PREFLIGHT_FAILED');
  }

  const activeClient: MinimalGenAiClient = options.client || (getGeminiClient() as unknown as MinimalGenAiClient);
  if (!options.client && !activeClient.vertexai) {
    throw new Error(
      'HYBRID_LIVE_NON_VERTEX_CLIENT: Active Gemini client is not Vertex AI; refusing execution.'
    );
  }

  const model = options.model || HYBRID_LIVE_DEFAULT_MODEL;
  const thinkingLevel = options.thinkingLevel || HYBRID_LIVE_DEFAULT_THINKING_LEVEL;
  const tier = options.tier || HYBRID_LIVE_DEFAULT_TIER;
  const timeoutMs = options.perRequestTimeoutMs ?? HYBRID_LIVE_DEFAULT_TIMEOUT_MS;
  const configuredPageMaxOutputTokens = options.maxOutputTokens ?? HYBRID_LIVE_DEFAULT_MAX_OUTPUT_TOKENS;
  const configuredCropMaxOutputTokens = Math.max(
    options.cropMaxOutputTokens ?? options.maxOutputTokens ?? HYBRID_LIVE_DEFAULT_CROP_MAX_OUTPUT_TOKENS,
    HYBRID_LIVE_MIN_CARD_OUTPUT_TOKENS
  );
  const configuredContextMaxOutputTokens =
    options.pageContextMaxOutputTokens ?? HYBRID_LIVE_PAGE_CONTEXT_MAX_OUTPUT_TOKENS;
  const pageFingerprints = getV3PromptAndSchemaFingerprints();
  const cropFingerprints = getV3CropPromptAndSchemaFingerprints();
  const pageSystemInstruction = buildV3PageExtractionSystemPrompt();
  const cropSystemInstruction = buildV3CardCropSystemPrompt();
  const pageSchema = getV3LeafletPageGenAiSchema();
  const cropSchema = getV3CardCropGenAiSchema();
  const pageContextSchema = getHybridPageContextGenAiSchema();

  async function invokeSingleAttempt(params: {
    req: HybridExtractionRequestPayload;
    mode: 'page' | 'crop' | 'page_context';
    promptText: string;
    sysInstruction: string;
    responseSchema: Record<string, unknown>;
    promptVersion: string;
    schemaVersion: string;
    promptSha256: string;
    schemaSha256: string;
    fallbackReserveCostUsd: number;
  }): Promise<HybridExtractionProviderResponse> {
    const {
      req,
      mode,
      promptText,
      sysInstruction,
      responseSchema,
      promptVersion,
      schemaVersion,
      promptSha256,
      schemaSha256,
      fallbackReserveCostUsd
    } = params;
    const effectiveMaxOutputTokens =
      mode === 'page_context'
        ? configuredContextMaxOutputTokens
        : mode === 'crop'
          ? configuredCropMaxOutputTokens
          : configuredPageMaxOutputTokens;
    const apiProvider: 'vertex_ai' | 'gemini_developer' | 'mock' = options.client
      ? 'mock'
      : activeClient.vertexai
        ? 'vertex_ai'
        : 'gemini_developer';
    const startedMs = Date.now();
    const serverTimeoutMs = timeoutMs;
    const clientTimeoutMs = serverTimeoutMs + HYBRID_LIVE_CLIENT_SAFETY_MARGIN_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), clientTimeoutMs);
    const onAbort = () => controller.abort();
    options.abortSignal?.addEventListener('abort', onAbort);

    if (!existsSync(req.imagePath)) {
      clearTimeout(timer);
      options.abortSignal?.removeEventListener('abort', onAbort);
      return {
        ok: false,
        errorCode: 'HYBRID_IMAGE_NOT_FOUND',
        errorMessage: `Input image not found at ${req.imagePath}`,
        outcomeUnknown: false,
        durationMs: Date.now() - startedMs,
        model,
        thinkingLevel,
        tier,
        apiProvider,
        usageReported: false,
        promptVersion,
        schemaVersion,
        promptSha256,
        schemaSha256,
        costUsdOverride: 0
      };
    }

    const base64Data = readFileSync(req.imagePath).toString('base64');
    const mimeType = inferImageMimeType(req.imagePath);

    let capturedMeta: Record<string, unknown> | null = null;
    let capturedUsageReported = false;
    let capturedUsage: GeminiTokenUsageInput | undefined;
    let capturedCostUsd: number | undefined;
    let capturedFinishReason: string | null = null;
    let capturedActualTier: string | null = null;

    try {
      const requestConfig: Record<string, any> = {
        thinkingConfig: { thinkingLevel },
        maxOutputTokens: effectiveMaxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema,
        systemInstruction: sysInstruction,
        abortSignal: controller.signal,
        httpOptions: {
          timeout: serverTimeoutMs,
          headers: {
            'X-Server-Timeout': String(Math.floor(serverTimeoutMs / 1000)),
            ...(tier === 'flex'
              ? {
                  'X-Vertex-AI-LLM-Request-Type': 'shared',
                  'X-Vertex-AI-LLM-Shared-Request-Type': 'flex'
                }
              : {})
          }
        }
      };

      const rawResponse = await activeClient.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data
                }
              },
              {
                text: promptText
              }
            ]
          }
        ],
        config: requestConfig
      });

      clearTimeout(timer);
      options.abortSignal?.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - startedMs;
      capturedFinishReason = rawResponse?.candidates?.[0]?.finishReason ?? null;
      const finishReason = capturedFinishReason;
      const rawText: string =
        typeof rawResponse === 'string'
          ? rawResponse
          : typeof rawResponse?.text === 'string'
            ? rawResponse.text
            : rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Capture usage metadata BEFORE checking finishReason, JSON.parse, or schema decoding
      const meta = rawResponse?.usageMetadata ?? null;
      capturedMeta = meta as Record<string, unknown> | null;
      const usageReported = Boolean(
        meta && (meta.promptTokenCount !== undefined || meta.totalTokenCount !== undefined)
      );
      capturedUsageReported = usageReported;
      capturedActualTier = meta?.trafficType ? String(meta.trafficType) : null;
      const usage: GeminiTokenUsageInput | undefined = usageReported
        ? {
            promptTokenCount: meta?.promptTokenCount ?? 0,
            candidatesTokenCount: meta?.candidatesTokenCount ?? meta?.responseTokenCount ?? 0,
            thoughtsTokenCount: meta?.thoughtsTokenCount ?? 0,
            cachedContentTokenCount: meta?.cachedContentTokenCount ?? 0,
            totalTokenCount:
              meta?.totalTokenCount ??
              (meta?.promptTokenCount || 0) +
                (meta?.candidatesTokenCount || meta?.responseTokenCount || 0) +
                (meta?.thoughtsTokenCount || 0)
          }
        : undefined;
      capturedUsage = usage;

      const costCalc = usage ? calculateGeminiCost(usage, model, tier) : null;
      capturedCostUsd = costCalc?.totalCostUsd;
      const costUsd = costCalc?.totalCostUsd ?? fallbackReserveCostUsd;

      if (!rawText) {
        return {
          ok: false,
          errorCode: 'GEMINI_EMPTY_RESPONSE',
          errorMessage: `Empty model response (finishReason=${String(finishReason)})`,
          outcomeUnknown: !usageReported,
          finishReason,
          durationMs,
          usage,
          usageReported,
          rawUsageMetadata: capturedMeta,
          costUsdOverride: usageReported ? costUsd : undefined,
          model,
          thinkingLevel,
          tier,
          actualTier: capturedActualTier,
          apiProvider,
          promptVersion,
          schemaVersion,
          promptSha256,
          schemaSha256
        };
      }

      if (finishReason && finishReason !== 'STOP') {
        const archivePath = writeRawArchive(
          options.archiveDir,
          `${req.cacheKey}_${mode}_nonstop`,
          {
            requestKind: req.requestKind,
            finishReason,
            effectiveMaxOutputTokens,
            promptVersion,
            schemaVersion,
            rawText,
            usageMetadataRaw: meta ?? null
          }
        );
        return {
          ok: false,
          rawText,
          errorCode: `GEMINI_FINISH_REASON_${finishReason}`,
          errorMessage: `Model finished with non-STOP finishReason=${finishReason}; refusing partial/truncated JSON.`,
          outcomeUnknown: !usageReported,
          finishReason,
          durationMs,
          usage,
          usageReported,
          rawUsageMetadata: capturedMeta,
          costUsdOverride: usageReported ? costUsd : undefined,
          model,
          thinkingLevel,
          tier,
          actualTier: capturedActualTier,
          apiProvider,
          promptVersion,
          schemaVersion,
          promptSha256,
          schemaSha256,
          rawArchivePath: archivePath
        };
      }

      const { sanitized: rawParsed } = stripUnexpectedCurrencyFromModelResponse<unknown>(
        JSON.parse(rawText)
      );
      const parsedJson: unknown =
        mode === 'crop' ? adaptV3CropExtractionToV3PagePayload(rawParsed) : rawParsed;
      if (mode !== 'page_context') {
        if (
          !parsedJson ||
          typeof parsedJson !== 'object' ||
          !Array.isArray((parsedJson as Record<string, unknown>).offers)
        ) {
          throw new Error('HYBRID_SCHEMA_INVALID: Missing offers array in V3 response.');
        }
        // Validate compatibility with Stage 2 V3 decoder (with nullable-field tolerance)
        decodeV3PageExtractionToOfferCards(parsedJson, {
          leafletId: req.leafletId,
          pageNumber: req.pageNumber,
          sourceOfferIdPrefix: req.sourceOfferId || `${req.leafletId}_p${req.pageNumber}`,
          retailerName: req.retailer,
          tolerateOmittedNullableFields: true
        });
      }

      const rawArchivePath = writeRawArchive(
        options.archiveDir,
        `${req.cacheKey}_${mode}`,
        {
          requestKind: req.requestKind,
          leafletId: req.leafletId,
          pageNumber: req.pageNumber,
          sourceOfferId: req.sourceOfferId ?? null,
          model,
          thinkingLevel,
          tier,
          effectiveMaxOutputTokens,
          promptVersion,
          schemaVersion,
          promptSha256,
          schemaSha256,
          finishReason,
          durationMs,
          usageMetadataRaw: meta ?? null,
          costUsd,
          parsedResponse: parsedJson,
          rawResponseText: rawText
        }
      );

      return {
        ok: true,
        rawText,
        parsedJson,
        outcomeUnknown: false,
        finishReason,
        durationMs,
        usage,
        usageReported,
        rawUsageMetadata: capturedMeta,
        costUsdOverride: costUsd,
        model,
        thinkingLevel,
        tier,
        actualTier: capturedActualTier,
        apiProvider,
        promptVersion,
        schemaVersion,
        promptSha256,
        schemaSha256,
        rawArchivePath
      };
    } catch (err) {
      clearTimeout(timer);
      options.abortSignal?.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - startedMs;
      const outcomeUnknown = capturedUsageReported ? false : isAbortOrTimeoutError(err) || true;
      const archivePath = writeRawArchive(
        options.archiveDir,
        `${req.cacheKey}_${mode}_error`,
        {
          requestKind: req.requestKind,
          outcomeUnknown,
          effectiveMaxOutputTokens,
          promptVersion,
          schemaVersion,
          usageMetadataRaw: capturedMeta,
          errorMessage: err instanceof Error ? err.message : String(err),
          durationMs
        }
      );

      return {
        ok: false,
        errorCode: !capturedUsageReported && isAbortOrTimeoutError(err) ? 'HYBRID_TIMEOUT_OUTCOME_UNKNOWN' : 'HYBRID_PROVIDER_ERROR',
        errorMessage: err instanceof Error ? err.message : String(err),
        outcomeUnknown,
        finishReason: capturedFinishReason,
        durationMs,
        usage: capturedUsage,
        usageReported: capturedUsageReported,
        rawUsageMetadata: capturedMeta,
        costUsdOverride: capturedUsageReported ? capturedCostUsd : undefined,
        model,
        thinkingLevel,
        tier,
        actualTier: capturedActualTier,
        apiProvider,
        promptVersion,
        schemaVersion,
        promptSha256,
        schemaSha256,
        rawArchivePath: archivePath
      };
    }
  }

  return {
    providerId: `vertex_gemini_${model}_${tier}`,
    isOfflineOrMock: Boolean(options.client),
    async extractPage(req) {
      const prompt =
        req.promptText ||
        buildV3PilotUserPrompt({
          mode: 'page',
          retailer: req.retailer,
          leafletId: req.leafletId,
          pageNumber: req.pageNumber,
          slotId: req.cacheKey
        });
      return invokeSingleAttempt({
        req,
        mode: 'page',
        promptText: prompt,
        sysInstruction: pageSystemInstruction,
        responseSchema: pageSchema,
        promptVersion: V3_PROMPT_VERSION,
        schemaVersion: V3_EXTRACTION_SCHEMA_VERSION,
        promptSha256: pageFingerprints.promptSha256,
        schemaSha256: pageFingerprints.schemaSha256,
        fallbackReserveCostUsd: PILOT_005E_TELEMETRY_BASELINE.meanPageCostUsd
      });
    },
    async extractCardCrop(req) {
      const prompt =
        req.promptText ||
        buildV3CardCropUserPrompt({
          retailer: req.retailer,
          leafletId: req.leafletId,
          slotId: req.sourceOfferId || req.cacheKey
        });
      return invokeSingleAttempt({
        req,
        mode: 'crop',
        promptText: prompt,
        sysInstruction: cropSystemInstruction,
        responseSchema: cropSchema,
        promptVersion: V3_CROP_PROMPT_VERSION,
        schemaVersion: V3_CROP_SCHEMA_VERSION,
        promptSha256: cropFingerprints.promptSha256,
        schemaSha256: cropFingerprints.schemaSha256,
        fallbackReserveCostUsd: PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd
      });
    },
    async verifyPageContext(req) {
      const res = await invokeSingleAttempt({
        req,
        mode: 'page_context',
        promptText:
          req.promptText ||
          `Inspect leaflet page context (${req.retailer}, p${req.pageNumber}) for validity dates and regional restrictions.`,
        sysInstruction: PAGE_CONTEXT_SYSTEM_INSTRUCTION,
        responseSchema: pageContextSchema,
        promptVersion: V3_PROMPT_VERSION,
        schemaVersion: V3_EXTRACTION_SCHEMA_VERSION,
        promptSha256: pageFingerprints.promptSha256,
        schemaSha256: pageFingerprints.schemaSha256,
        fallbackReserveCostUsd: PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd
      });
      if (!res.ok || !res.parsedJson) {
        return {
          ok: false,
          rawResponse: res,
          errorMessage: res.errorMessage
        };
      }
      const evidenceObj = {
        ...(res.parsedJson as Omit<PageContextVerificationEvidence, 'sourceRegionKind'>),
        sourceRegionKind:
          req.regionKind === 'page_footer'
            ? 'page_footer'
            : req.regionKind === 'page_header'
              ? 'page_header'
              : 'full_page_context'
      } as PageContextVerificationEvidence;
      return {
        ok: true,
        evidence: evidenceObj,
        rawResponse: res
      };
    }
  };
}
