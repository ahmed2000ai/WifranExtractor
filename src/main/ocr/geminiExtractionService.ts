import sharp from 'sharp';
import { readFileSync } from 'fs';
import { getGeminiClient, isGeminiConfigured } from './geminiClient';
import {
  buildRev1PageExtractionSystemPrompt,
  buildRev1DiagnosticRetryPrompt
} from './geminiPromptBuilder';
import {
  getLeafletPageGenAiSchema,
  decodeLeafletPageExtraction,
  type LeafletPromptProfile,
  type LeafletSchemaProfile,
  type LeafletSchemaVersion
} from '../../shared/schemas/leafletPageExtractionSchema';
import type { LeafletPageExtractionRev1 } from '../../shared/types/leafletExtraction';
import { normalizeExtractedOffer } from '../../shared/utils/priceAndUnitNormalizer';
import {
  GeminiExtractionCacheService,
  sharedGeminiExtractionCacheService
} from './geminiExtractionCacheService';
import {
  GeminiProviderCacheService,
  sharedGeminiProviderCacheService
} from './geminiProviderCacheService';
import type {
  GeminiCacheEntry,
  GeminiInferenceMode,
  GeminiInferenceProgressEvent,
  GeminiPageUsageReport,
  GeminiProviderCacheMode,
  GeminiTokenUsage
} from './geminiCacheTypes';
import { calculateGeminiCost } from './geminiPricingTable';
import {
  archiveGeminiProviderAttempt,
  type GeminiProviderAttemptKind
} from './geminiProviderArchiveService';

export type GeminiExtractionOptions = {
  imagePath: string;
  pageNumber?: number;
  outputDir?: string;
  overrideModel?: string;
  executionMode?: GeminiInferenceMode;
  isDiagnosticRetry?: boolean;
  failureReasons?: string[];
  attemptKind?: GeminiProviderAttemptKind;
  correlationId?: string;
  /**
   * Prompt instructions profile to use.
   * 'legacy' = original verbose prompt
   * 'optimized' = compact OPT-001/002 prompt
   * 'master_quality' = comprehensive high-accuracy prompt with compact-schema orientation
   * Defaults to 'legacy' (or process.env.GEMINI_PROMPT_PROFILE).
   */
  promptProfile?: LeafletPromptProfile;
  /**
   * JSON response schema profile to request from the model.
   * 'legacy' = verbose JSON keys
   * 'optimized' = compact JSON keys (decoded losslessly to canonical contract)
   * Defaults to 'legacy' (or process.env.GEMINI_SCHEMA_PROFILE).
   */
  schemaProfile?: LeafletSchemaProfile;
  /**
   * Backward-compatible alias for schema profile / version.
   */
  schemaVersion?: LeafletSchemaVersion;
  /**
   * Model thinking level override. Defaults to 'HIGH'.
   */
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | string;
  /**
   * Google Provider-side Context Caching mode.
   * 'none' (default) = do not explicitly cache with Google
   * 'auto' = evaluate eligibility and economic break-even; use explicit cache only when justified
   * 'explicit' = operator requests explicit cache, subject to hard eligibility minimums
   */
  providerCacheMode?: GeminiProviderCacheMode;
  /**
   * Estimated number of workload pages for provider cache break-even calculation.
   */
  expectedWorkloadPages?: number;
  forceReextract?: boolean;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryWaitMs?: number;
  flexTimeoutMs?: number;
  standardTimeoutMs?: number;
  onProgress?: (event: GeminiInferenceProgressEvent) => void;
  signal?: AbortSignal;
  mockResponse?: any;
};

export type GeminiExtractionResult = LeafletPageExtractionRev1 & {
  usageReport?: GeminiPageUsageReport;
  cacheHit?: boolean;
  rawResponseText?: string;
  rawResponse?: unknown;
  rawResponseReconstructed?: boolean;
  providerCacheHit?: boolean;
  providerCacheResource?: string | null;
  providerArchivePath?: string;
  providerArchiveWarning?: string;
};

export class GeminiExtractionService {
  private cacheService: GeminiExtractionCacheService;
  private providerCacheService: GeminiProviderCacheService;
  private customClient?: any;

  constructor(
    cacheService?: GeminiExtractionCacheService,
    customClient?: any,
    providerCacheService?: GeminiProviderCacheService
  ) {
    this.cacheService = cacheService || sharedGeminiExtractionCacheService;
    this.providerCacheService = providerCacheService || sharedGeminiProviderCacheService;
    this.customClient = customClient;
  }

  /**
   * Helper to inspect if an error is transient and retryable (e.g. 429, 503, connection drops).
   */
  isRetryableError(err: any): boolean {
    if (!err) return false;
    const msg = (err.message || '').toLowerCase();
    const status = err.status || err.statusCode || err.code;

    if (status === 429 || status === 503) return true;
    if (
      msg.includes('429') ||
      msg.includes('resource_exhausted') ||
      msg.includes('quota') ||
      msg.includes('rate limit')
    ) {
      return true;
    }
    if (msg.includes('503') || msg.includes('service unavailable') || msg.includes('overloaded')) {
      return true;
    }
    if (
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('network') ||
      msg.includes('socket')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Parses standard Retry-After headers or error message delays.
   */
  parseRetryAfterMs(err: any): number | null {
    if (!err) return null;
    const headers = err.headers || err.response?.headers;
    if (headers) {
      const val = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
      if (val) {
        const parsed = parseFloat(val);
        if (!isNaN(parsed) && parsed > 0) {
          return Math.round(parsed * 1000);
        }
      }
    }

    const match = (err.message || '').match(/retry after (\d+(?:\.\d+)?)\s*(s|sec|seconds|ms)/i);
    if (match) {
      const val = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      return unit === 'ms' ? Math.round(val) : Math.round(val * 1000);
    }

    return null;
  }

  /**
   * Executes rev1 page extraction using Gemini via Vertex AI or Google AI Studio.
   * Features:
   * - Deterministic local cache with full-fingerprint validation (image, model, prompt, schema, settings).
   * - Avoids repeat API calls during staging preview, correction, or resumed extraction jobs.
   * - In-flight request deduplication preventing simultaneous duplicate API calls.
   * - Independent provider context caching support with eligibility and economic gates.
   * - Standard (Fast) vs Flex (Economy) service tiers without automatic cross-tier downgrades.
   * - Bounded exponential backoff with jitter and Retry-After support.
   * - Accurate token consumption metering (including thoughts and cached tokens) and configurable pricing.
   * - Verbatim raw response preservation with explicit reconstruction tracking for historical entries.
   */
  async extractLeafletPage(options: GeminiExtractionOptions): Promise<GeminiExtractionResult> {
    const {
      imagePath,
      pageNumber = 1,
      outputDir,
      overrideModel,
      isDiagnosticRetry,
      failureReasons,
      forceReextract = false,
      maxRetries = 3,
      onProgress,
      signal
    } = options;

    if (!isGeminiConfigured() && !this.customClient && !options.mockResponse) {
      throw new Error(
        'GEMINI_NOT_CONFIGURED: Please configure GOOGLE_APPLICATION_CREDENTIALS and GCP_PROJECT_ID (or GEMINI_API_KEY) in your .env.local file to run live extractions.'
      );
    }

    // 1. Prepare JPEG buffer for multimodal payload
    const imageBuffer = readFileSync(imagePath);
    const jpegBuffer = await sharp(imageBuffer)
      .jpeg({ quality: 92 })
      .toBuffer();

    const base64Image = jpegBuffer.toString('base64');

    // 2. Resolve request parameters
    const defaultModel = isDiagnosticRetry
      ? process.env.GEMINI_RETRY_MODEL || 'gemini-4-argon'
      : process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const model = overrideModel || defaultModel;

    const promptProfile: LeafletPromptProfile =
      options.promptProfile ||
      ((process.env.GEMINI_PROMPT_PROFILE as LeafletPromptProfile) ||
        (options.schemaProfile === 'compact_v1' || options.schemaVersion === 'compact_v1'
          ? 'compact_v1'
          : options.schemaProfile === 'optimized' || options.schemaVersion === 'optimized'
            ? 'optimized'
            : 'legacy'));

    const schemaProfile: LeafletSchemaProfile =
      options.schemaProfile ||
      options.schemaVersion ||
      ((process.env.GEMINI_SCHEMA_PROFILE as LeafletSchemaProfile) ||
        (process.env.GEMINI_SCHEMA_VERSION as LeafletSchemaProfile) ||
        'legacy');

    const thinkingLevel =
      options.thinkingLevel || process.env.GEMINI_THINKING_LEVEL || 'HIGH';

    const executionMode: GeminiInferenceMode =
      options.executionMode ||
      ((process.env.GEMINI_EXECUTION_MODE as GeminiInferenceMode) || 'flex');

    const providerCacheMode: GeminiProviderCacheMode =
      options.providerCacheMode ||
      ((process.env.GEMINI_PROVIDER_CACHE_MODE as GeminiProviderCacheMode) || 'none');

    const promptText =
      isDiagnosticRetry && failureReasons && failureReasons.length > 0
        ? buildRev1DiagnosticRetryPrompt(failureReasons, schemaProfile)
        : 'Analyze this promotional supermarket leaflet page. Extract all offers with exact 2D component bounding boxes.';

    const systemInstruction = buildRev1PageExtractionSystemPrompt(promptProfile);
    const responseSchema = getLeafletPageGenAiSchema(schemaProfile);
    const thinkingConfig = { thinkingLevel };
    const imageSettings = { format: 'jpeg' as const, quality: 92 };

    const client = this.customClient || (isGeminiConfigured() ? getGeminiClient() : null);
    const isVertex = client ? Boolean((client as any).vertexai) : true;
    const backendContext = isVertex
      ? {
          backend: 'vertex_ai',
          projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || 'default-project',
          location: process.env.GOOGLE_CLOUD_LOCATION || 'global'
        }
      : { backend: 'gemini_developer_api' };

    // 3. Compute deterministic local cache fingerprint
    const { fingerprint, fingerprintHash } = this.cacheService.computeFingerprint({
      imageBuffer: jpegBuffer,
      model,
      systemInstruction,
      promptText,
      promptProfile,
      promptVersion: promptProfile,
      schema: responseSchema,
      schemaProfile,
      schemaVersion: schemaProfile,
      thinkingConfig,
      imageSettings,
      isDiagnosticRetry: Boolean(isDiagnosticRetry),
      failureReasons,
      serviceTier: executionMode,
      backendContext
    });

    const cacheFilePath = outputDir
      ? isDiagnosticRetry
        ? this.cacheService.resolveContentAddressedCachePath(outputDir, fingerprintHash)
        : this.cacheService.resolveCachePath(outputDir, pageNumber)
      : null;

    // 4. Local Cache Check: Reuse verified local extraction if inputs are identical (0 API tokens)
    if (!forceReextract && cacheFilePath) {
      const cached = this.cacheService.readValidCacheEntry(cacheFilePath, fingerprint);
      if (cached) {
        onProgress?.({
          state: 'completed',
          pageNumber,
          serviceTier: executionMode,
          attempt: 1,
          maxRetries,
          message: `Local cache hit for page ${pageNumber}. Reusing verified extraction (0 new API requests).`,
          timestamp: new Date().toISOString()
        });

        const isReconstructed = !cached.rawResponseText;
        const rawResponseText = cached.rawResponseText ?? JSON.stringify(cached.rawResponse);

        const cachedReport: GeminiPageUsageReport = {
          ...cached.usageReport,
          promptProfile: cached.usageReport.promptProfile || fingerprint.promptProfile,
          schemaProfile: cached.usageReport.schemaProfile || fingerprint.schemaProfile,
          cacheHit: true,
          providerCacheHit: Boolean(cached.usageReport.providerCacheHit),
          providerCacheResource: cached.usageReport.providerCacheResource || null,
          providerCacheStatus: cached.usageReport.providerCacheStatus || 'disabled',
          rawResponseReconstructed: Boolean(cached.rawResponseReconstructed ?? isReconstructed),
          pageNumber,
          cost: {
            ...cached.usageReport.cost,
            totalCostUsd: 0,
            inputCostUsd: 0,
            outputCostUsd: 0,
            thinkingCostUsd: 0,
            cachedInputCostUsd: 0
          }
        };

        return {
          ...cached.decodedExtraction,
          page_number: pageNumber,
          usageReport: cachedReport,
          cacheHit: true,
          rawResponseText,
          rawResponse: cached.rawResponse,
          rawResponseReconstructed: Boolean(cached.rawResponseReconstructed ?? isReconstructed)
        };
      }
    }

    // 5. Deduplicate concurrent in-flight requests for the exact same fingerprint
    return await this.cacheService.executeWithDeduplication(fingerprintHash, async () => {
      // Re-check local cache in case an earlier in-flight request for the same page just finished
      if (!forceReextract && cacheFilePath) {
        const doubleCheck = this.cacheService.readValidCacheEntry(cacheFilePath, fingerprint);
        if (doubleCheck) {
          const isReconstructed = !doubleCheck.rawResponseText;
          const rawResponseText = doubleCheck.rawResponseText ?? JSON.stringify(doubleCheck.rawResponse);

          const cachedReport: GeminiPageUsageReport = {
            ...doubleCheck.usageReport,
            promptProfile: doubleCheck.usageReport.promptProfile || fingerprint.promptProfile,
            schemaProfile: doubleCheck.usageReport.schemaProfile || fingerprint.schemaProfile,
            cacheHit: true,
            providerCacheHit: Boolean(doubleCheck.usageReport.providerCacheHit),
            providerCacheResource: doubleCheck.usageReport.providerCacheResource || null,
            providerCacheStatus: doubleCheck.usageReport.providerCacheStatus || 'disabled',
            rawResponseReconstructed: Boolean(doubleCheck.rawResponseReconstructed ?? isReconstructed),
            pageNumber,
            cost: {
              ...doubleCheck.usageReport.cost,
              totalCostUsd: 0,
              inputCostUsd: 0,
              outputCostUsd: 0,
              thinkingCostUsd: 0,
              cachedInputCostUsd: 0
            }
          };
          return {
            ...doubleCheck.decodedExtraction,
            page_number: pageNumber,
            usageReport: cachedReport,
            cacheHit: true,
            rawResponseText,
            rawResponse: doubleCheck.rawResponse,
            rawResponseReconstructed: Boolean(doubleCheck.rawResponseReconstructed ?? isReconstructed)
          };
        }
      }

      // 6. Resolve Provider Context Cache eligibility and resource
      const providerCacheResolution = await this.providerCacheService.resolveProviderCache({
        mode: providerCacheMode,
        backendContext,
        model,
        systemInstruction,
        systemInstructionSha256: fingerprint.systemInstructionSha256,
        promptProfile,
        schemaProfile,
        tier: executionMode,
        expectedWorkloadPages: options.expectedWorkloadPages,
        mockClient: this.customClient,
        allowLiveCreation: false // Safe offline posture in OPT-004B
      });

      const activeClient = client || getGeminiClient();

      // Configure timeout: Flex queue timeout is 10-15 minutes; Standard is 2 minutes
      const flexTimeout =
        options.flexTimeoutMs ||
        Number(process.env.GEMINI_FLEX_TIMEOUT_MS) ||
        600_000; // 10 minutes default
      const standardTimeout = options.standardTimeoutMs || 120_000; // 2 minutes default
      const timeoutMs = executionMode === 'flex' ? flexTimeout : standardTimeout;

      let attempt = 0;
      let lastError: any = null;
      const startTime = Date.now();

      while (attempt <= maxRetries) {
        if (signal?.aborted) {
          onProgress?.({
            state: 'cancelled',
            pageNumber,
            serviceTier: executionMode,
            attempt: attempt + 1,
            maxRetries,
            message: 'Extraction cancelled by operator.',
            timestamp: new Date().toISOString()
          });
          throw new Error('REQUEST_CANCELLED: Operation was cancelled by operator.');
        }

        const attemptController = new AbortController();
        const timeoutTimer = setTimeout(() => {
          attemptController.abort();
        }, timeoutMs);

        const onParentAbort = () => {
          attemptController.abort();
        };
        signal?.addEventListener('abort', onParentAbort);

        try {
          onProgress?.({
            state: attempt === 0 ? 'running' : 'retrying',
            pageNumber,
            serviceTier: executionMode,
            attempt: attempt + 1,
            maxRetries,
            message:
              attempt === 0
                ? `Running Gemini extraction in ${executionMode === 'flex' ? 'Economy (Flex)' : 'Fast (Standard)'} tier...`
                : `Retrying Gemini extraction (attempt ${attempt + 1}/${maxRetries})...`,
            timestamp: new Date().toISOString()
          });

          let response: any;
          if (options.mockResponse) {
            response =
              typeof options.mockResponse === 'function'
                ? await options.mockResponse({ model, executionMode, attempt })
                : options.mockResponse;
          } else {
            // Live SDK call: Explicitly configure inference tier, headers, abortSignal, and provider cache
            const isLiveVertex = Boolean((activeClient as any).vertexai);
            const requestConfig: any = {
              thinkingConfig: thinkingConfig as any,
              responseMimeType: 'application/json',
              responseSchema,
              abortSignal: attemptController.signal
            };

            // Provider Context Caching Structure:
            // When an explicit provider cache is active, pass cachedContent and omit systemInstruction.
            // Otherwise, pass systemInstruction.
            if (providerCacheResolution.resourceName && providerCacheResolution.omitsSystemInstruction) {
              requestConfig.cachedContent = providerCacheResolution.resourceName;
            } else {
              requestConfig.systemInstruction = systemInstruction;
            }

            if (isLiveVertex) {
              // Vertex AI Flex Routing per official Google Cloud documentation:
              // - Global endpoint (location: 'global')
              // - Headers: X-Vertex-AI-LLM-Request-Type: shared, X-Vertex-AI-LLM-Shared-Request-Type: flex
              // - Do NOT pass serviceTier in request body (Vertex protobuf schema rejects it)
              // - Fail closed if Flex is requested on a non-global Vertex region or unsupported primary model
              if (executionMode === 'flex' && !isDiagnosticRetry) {
                if (backendContext.location && backendContext.location !== 'global') {
                  throw new Error(
                    `FLEX_REQUIRES_GLOBAL_LOCATION: Vertex AI Flex PayGo requires location="global", but resolved "${backendContext.location}". Refusing silent fallback to standard on-demand billing.`
                  );
                }
                if (model === 'gemini-4-argon') {
                  throw new Error(
                    `FLEX_UNSUPPORTED_MODEL: Model "${model}" is not supported on Vertex AI Flex routing. Refusing silent fallback to standard on-demand billing.`
                  );
                }
                requestConfig.httpOptions = {
                  headers: {
                    'X-Vertex-AI-LLM-Request-Type': 'shared',
                    'X-Vertex-AI-LLM-Shared-Request-Type': 'flex'
                  }
                };
              }
            } else {
              // Gemini Developer API: serviceTier in config body
              requestConfig.serviceTier = executionMode === 'flex' ? 'flex' : 'standard';
            }

            response = await activeClient.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64Image
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
          }

          clearTimeout(timeoutTimer);
          signal?.removeEventListener('abort', onParentAbort);

          const durationMs = Date.now() - startTime;
          const responseText =
            typeof response === 'string'
              ? response
              : response?.text !== undefined
                ? response.text
                : JSON.stringify(response);

          if (!responseText) {
            throw new Error('GEMINI_EMPTY_RESPONSE: Model returned an empty extraction response.');
          }

          let parsed: any;
          try {
            const parsedRaw = JSON.parse(responseText);
            const { stripUnexpectedCurrencyFromModelResponse } = await import(
              '../../shared/utils/geminiResponseSanitizer'
            );
            parsed = stripUnexpectedCurrencyFromModelResponse(parsedRaw).sanitized;
          } catch (err: any) {
            throw new Error(`GEMINI_JSON_PARSE_ERROR: Failed to parse JSON response: ${err.message}`);
          }

          // Decode and normalize offers using the active schema profile
          const decoded = decodeLeafletPageExtraction(parsed, schemaProfile);
          const normalizedOffers = (decoded.offers || []).map(normalizeExtractedOffer);

          // Extract usage metadata from provider response
          const meta = response.usageMetadata;
          const hasMeta = Boolean(meta && (meta.promptTokenCount !== undefined || meta.totalTokenCount !== undefined));

          const usage: GeminiTokenUsage = hasMeta
            ? {
                promptTokenCount: meta.promptTokenCount ?? 0,
                candidatesTokenCount: meta.candidatesTokenCount ?? meta.responseTokenCount ?? 0,
                thoughtsTokenCount: meta.thoughtsTokenCount ?? 0,
                cachedContentTokenCount: meta.cachedContentTokenCount ?? 0,
                totalTokenCount:
                  meta.totalTokenCount ??
                  (meta.promptTokenCount || 0) +
                    (meta.candidatesTokenCount || meta.responseTokenCount || 0) +
                    (meta.thoughtsTokenCount || 0),
                usageReported: true
              }
            : {
                promptTokenCount: undefined as any,
                candidatesTokenCount: undefined as any,
                thoughtsTokenCount: 0,
                cachedContentTokenCount: 0,
                totalTokenCount: 0,
                usageReported: false
              };

          let resolvedActualTier: GeminiInferenceMode = executionMode;
          if (response.usageMetadata?.trafficType) {
            resolvedActualTier =
              response.usageMetadata.trafficType === 'ON_DEMAND_FLEX' ? 'flex' : 'standard';
          } else if (response.usageMetadata?.serviceTier) {
            resolvedActualTier = response.usageMetadata.serviceTier === 'flex' ? 'flex' : 'standard';
          }

          // Calculate cost strictly from provider-reported actual service tier (never claim Flex pricing if trafficType is ON_DEMAND)
          const cost = calculateGeminiCost(usage, model, resolvedActualTier);

          const providerCacheHit = Boolean(
            usage.cachedContentTokenCount > 0 && providerCacheResolution.resourceName
          );

          const usageReport: GeminiPageUsageReport = {
            pageNumber,
            modelId: model,
            modelVersion: response.modelVersion,
            promptProfile,
            schemaProfile,
            requestedServiceTier: executionMode,
            actualServiceTier: resolvedActualTier,
            cacheHit: false,
            providerCacheHit,
            providerCacheResource: providerCacheResolution.resourceName,
            providerCacheStatus: providerCacheResolution.status,
            rawResponseReconstructed: false,
            requestDurationMs: durationMs,
            retriesCount: attempt,
            usage,
            cost,
            fingerprintHash
          };

          const finalExtraction: LeafletPageExtractionRev1 = {
            ...decoded,
            page_number: pageNumber,
            offers: normalizedOffers
          };

          // Atomically write verified local cache entry with verbatim rawResponseText
          if (cacheFilePath) {
            const cacheEntry: GeminiCacheEntry = {
              cacheVersion: 1,
              fingerprint,
              fingerprintHash,
              cachedAt: new Date().toISOString(),
              usageReport,
              rawResponse: parsed,
              rawResponseText: responseText,
              rawResponseReconstructed: false,
              decodedExtraction: finalExtraction
            };

            this.cacheService.writeCacheEntryAtomic(cacheFilePath, cacheEntry);
          }

          // Persist separate per-attempt raw provider archive (never overwriting earlier attempts)
          let providerArchivePath: string | undefined;
          let providerArchiveWarning: string | undefined;
          if (outputDir) {
            const resolvedAttemptKind: GeminiProviderAttemptKind =
              options.attemptKind || (isDiagnosticRetry ? 'retry' : 'primary');
            const resolvedCorrelationId =
              options.correlationId ||
              `gemini-p${pageNumber}-${fingerprintHash.slice(0, 12)}-${Date.now()}`;

            const archiveRes = archiveGeminiProviderAttempt({
              outputDir,
              pageNumber,
              attemptKind: resolvedAttemptKind,
              correlationId: resolvedCorrelationId,
              requestTimestamp: new Date(startTime).toISOString(),
              completedAt: new Date().toISOString(),
              response,
              rawResponseText: responseText,
              parsedResponse: parsed,
              decodedExtraction: finalExtraction,
              usageReport,
              fingerprint,
              fingerprintHash,
              failureReasons,
              cacheHit: false,
              providerCacheHit,
              providerCacheResource: providerCacheResolution.resourceName
            });

            if (archiveRes.ok && archiveRes.archivePath) {
              providerArchivePath = archiveRes.archivePath;
            } else if (archiveRes.error) {
              providerArchiveWarning = archiveRes.error;
              console.warn(`[GeminiExtraction] ${providerArchiveWarning}`);
              onProgress?.({
                state: 'completed',
                pageNumber,
                serviceTier: executionMode,
                attempt: attempt + 1,
                maxRetries,
                message: `Warning: Failed to archive raw Gemini provider response for page ${pageNumber}: ${providerArchiveWarning}`,
                timestamp: new Date().toISOString()
              });
            }
          }

          onProgress?.({
            state: 'completed',
            pageNumber,
            serviceTier: executionMode,
            attempt: attempt + 1,
            maxRetries,
            message: `Gemini extraction completed in ${durationMs}ms (${usage.totalTokenCount} tokens, ~$${cost.totalCostUsd.toFixed(4)}).`,
            timestamp: new Date().toISOString()
          });

          return {
            ...finalExtraction,
            usageReport,
            cacheHit: false,
            rawResponseText: responseText,
            rawResponse: parsed,
            rawResponseReconstructed: false,
            providerCacheHit,
            providerCacheResource: providerCacheResolution.resourceName,
            providerArchivePath,
            providerArchiveWarning
          };
        } catch (err: any) {
          clearTimeout(timeoutTimer);
          signal?.removeEventListener('abort', onParentAbort);
          lastError = err;

          // Check if error was due to provider cache expiration or not-found
          if (
            providerCacheResolution.resourceName &&
            (err.message?.includes('cached content') ||
              err.message?.includes('NOT_FOUND') ||
              err.message?.includes('expired'))
          ) {
            this.providerCacheService.invalidateCacheResource(providerCacheResolution.resourceName);
          }

          // Check if abort was due to timeout
          if (attemptController.signal.aborted && !signal?.aborted) {
            const timeoutErr = new Error(
              executionMode === 'flex'
                ? `FLEX_TIMEOUT: Gemini Flex request timed out after ${timeoutMs}ms. Never automatically downgrading to Standard. Operator may retry deliberately with Fast (Standard) mode.`
                : `STANDARD_TIMEOUT: Gemini Standard request timed out after ${timeoutMs}ms.`
            );
            onProgress?.({
              state: 'failed',
              pageNumber,
              serviceTier: executionMode,
              attempt: attempt + 1,
              maxRetries,
              message: timeoutErr.message,
              timestamp: new Date().toISOString()
            });
            throw timeoutErr;
          }

          // Non-retryable errors or exceeded retry limits fail immediately
          if (!this.isRetryableError(err) || attempt >= maxRetries) {
            let finalError = err;
            if (
              executionMode === 'flex' &&
              (err.status === 429 ||
                err.statusCode === 429 ||
                err.status === 503 ||
                err.statusCode === 503 ||
                /429|503|resource_exhausted|quota|overloaded|unavailable/i.test(err.message || ''))
            ) {
              finalError = new Error(
                `FLEX_CAPACITY_UNAVAILABLE: Vertex AI Flex PayGo capacity is currently unavailable. Never automatically falling back to Standard PayGo. Operator may explicitly switch to Fast (Standard) mode in import settings if immediate execution is required. (Details: ${err.message})`
              );
              (finalError as any).status = err.status || err.statusCode || 429;
              (finalError as any).originalError = err;
            }

            onProgress?.({
              state: 'failed',
              pageNumber,
              serviceTier: executionMode,
              attempt: attempt + 1,
              maxRetries,
              message: `Gemini extraction failed: ${finalError.message}`,
              timestamp: new Date().toISOString()
            });
            throw finalError;
          }

          // Calculate backoff with jitter and Retry-After
          const retryAfterMs = this.parseRetryAfterMs(err);
          const baseDelay = options.initialRetryDelayMs ?? 2000;
          const maxDelay = 30000;
          const maxRetryWaitMs = options.maxRetryWaitMs ?? 60000; // 60s max allowable wait deadline
          const jitter = options.initialRetryDelayMs !== undefined ? 2 : Math.random() * 1000;
          const expDelay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt) + jitter);

          let delayMs = expDelay;
          if (retryAfterMs !== null) {
            // Check if provider wait exceeds configured maximum allowable retry deadline
            if (retryAfterMs > maxRetryWaitMs) {
              const deadlineErr = new Error(
                `RETRY_AFTER_EXCEEDED: Provider requested retry wait of ${Math.round(retryAfterMs / 1000)}s, which exceeds maximum allowable wait deadline (${Math.round(maxRetryWaitMs / 1000)}s). Stopping safely without retrying.`
              );
              onProgress?.({
                state: 'failed',
                pageNumber,
                serviceTier: executionMode,
                attempt: attempt + 1,
                maxRetries,
                message: deadlineErr.message,
                timestamp: new Date().toISOString()
              });
              throw deadlineErr;
            }
            // Do not retry earlier than explicit provider Retry-After interval
            delayMs = retryAfterMs;
          }

          onProgress?.({
            state: 'retrying',
            pageNumber,
            serviceTier: executionMode,
            attempt: attempt + 1,
            maxRetries,
            delayMs,
            message: `Transient error (${err.message}). Retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})...`,
            timestamp: new Date().toISOString()
          });

          await new Promise(r => setTimeout(r, delayMs));
          attempt++;
        }
      }

      throw lastError || new Error('GEMINI_EXTRACTION_FAILED: Exceeded maximum retry attempts.');
    });
  }
}

export const sharedGeminiExtractionService = new GeminiExtractionService();
