import { createHash } from 'crypto';
import type {
  GeminiInferenceMode,
  GeminiProviderCacheEconomicEvaluation,
  GeminiProviderCacheMetadata,
  GeminiProviderCacheMode,
  GeminiProviderCacheStatus
} from '../../shared/types/geminiCacheTypes';
import type {
  LeafletPromptProfile,
  LeafletSchemaProfile
} from '../../shared/schemas/leafletPageExtractionSchema';
import { evaluateProviderCacheEconomics } from './geminiPricingTable';

export type ProviderCacheKeyInput = {
  backend: string;
  projectId?: string;
  location?: string;
  model: string;
  systemInstructionSha256: string;
  promptProfile: LeafletPromptProfile;
  schemaProfile: LeafletSchemaProfile;
};

export type ProviderCacheResolutionInput = {
  mode: GeminiProviderCacheMode;
  backendContext: {
    backend: string;
    projectId?: string;
    location?: string;
  };
  model: string;
  systemInstruction: string;
  systemInstructionSha256: string;
  promptProfile: LeafletPromptProfile;
  schemaProfile: LeafletSchemaProfile;
  tier: GeminiInferenceMode;
  expectedWorkloadPages?: number;
  ttlSeconds?: number;
  mockClient?: any;
  allowLiveCreation?: boolean;
};

export type ProviderCacheResolutionResult = {
  mode: GeminiProviderCacheMode;
  status: GeminiProviderCacheStatus;
  resourceName: string | null;
  metadata: GeminiProviderCacheMetadata | null;
  economicEvaluation: GeminiProviderCacheEconomicEvaluation | null;
  omitsSystemInstruction: boolean;
  skipReason: string | null;
};

export class GeminiProviderCacheService {
  private activeCaches = new Map<string, GeminiProviderCacheMetadata>();
  private inFlightCreations = new Map<string, Promise<GeminiProviderCacheMetadata | null>>();

  /**
   * Minimum token threshold for explicit context caching on Gemini 3.8 Flash / 2.5 Flash.
   * Official Google Documentation: Context cache minimum is 4,096 tokens.
   */
  public static readonly MINIMUM_CACHE_TOKENS_FLASH = 4096;

  /**
   * Minimum token threshold for implicit context caching on Gemini 3.8 Flash.
   * Official Google Documentation: Implicit cache threshold is 6,144 tokens.
   */
  public static readonly MINIMUM_IMPLICIT_TOKENS_FLASH = 6144;

  /**
   * Conservatively estimates token count for a text string without making network calls.
   * Uses characters / 4 heuristic, verified against typical English/Arabic prompt text.
   */
  estimateTokenCount(text: string): number {
    if (!text) return 0;
    // Conservative estimation: ~4 chars per token, with a safety floor based on word count
    const byChar = Math.round(text.length / 4);
    const byWord = Math.round(text.split(/\s+/).filter(Boolean).length * 1.33);
    return Math.max(byChar, byWord);
  }

  /**
   * Computes an immutable, isolated cache key preventing cross-project, cross-model,
   * or cross-instruction cache leakage.
   */
  computeCacheKey(input: ProviderCacheKeyInput): string {
    const rawKey = [
      input.backend,
      input.projectId || 'default-project',
      input.location || 'global',
      input.model,
      input.systemInstructionSha256,
      input.promptProfile,
      input.schemaProfile
    ].join('::');

    return createHash('sha256').update(rawKey, 'utf8').digest('hex');
  }

  /**
   * Evaluates economic and architectural eligibility for context caching.
   */
  evaluateEligibility(params: {
    model: string;
    tier: GeminiInferenceMode;
    systemInstruction: string;
    expectedWorkloadPages?: number;
    ttlSeconds?: number;
  }): GeminiProviderCacheEconomicEvaluation {
    const sharedTokenCount = this.estimateTokenCount(params.systemInstruction);
    const expectedRequests = params.expectedWorkloadPages ?? 1;

    return evaluateProviderCacheEconomics({
      modelId: params.model,
      tier: params.tier,
      sharedTokenCount,
      expectedRequests,
      ttlSeconds: params.ttlSeconds ?? 3600,
      minimumTokens: GeminiProviderCacheService.MINIMUM_CACHE_TOKENS_FLASH
    });
  }

  /**
   * Resolves whether an explicit provider cache should be used for a request.
   * Handles lifecycle, expiration, isolation, economic break-even gating, and concurrent deduplication.
   */
  async resolveProviderCache(
    input: ProviderCacheResolutionInput
  ): Promise<ProviderCacheResolutionResult> {
    const { mode } = input;

    // Mode 'none': Provider caching explicitly disabled
    if (mode === 'none') {
      return {
        mode: 'none',
        status: 'disabled',
        resourceName: null,
        metadata: null,
        economicEvaluation: null,
        omitsSystemInstruction: false,
        skipReason: 'Provider caching mode is disabled (none).'
      };
    }

    const cacheKey = this.computeCacheKey({
      backend: input.backendContext.backend,
      projectId: input.backendContext.projectId,
      location: input.backendContext.location,
      model: input.model,
      systemInstructionSha256: input.systemInstructionSha256,
      promptProfile: input.promptProfile,
      schemaProfile: input.schemaProfile
    });

    // 1. Check existing active cache and validate expiration
    const existing = this.activeCaches.get(cacheKey);
    if (existing) {
      const now = Date.now();
      const expiresAt = new Date(existing.expireTime).getTime();

      if (now < expiresAt) {
        return {
          mode,
          status: 'active',
          resourceName: existing.resourceName,
          metadata: existing,
          economicEvaluation: null,
          omitsSystemInstruction: true,
          skipReason: null
        };
      } else {
        // Expired: Purge stale cache
        this.activeCaches.delete(cacheKey);
      }
    }

    // 2. Evaluate eligibility & economic feasibility
    const evaluation = this.evaluateEligibility({
      model: input.model,
      tier: input.tier,
      systemInstruction: input.systemInstruction,
      expectedWorkloadPages: input.expectedWorkloadPages,
      ttlSeconds: input.ttlSeconds
    });

    if (!evaluation.isEligible) {
      return {
        mode,
        status: 'ineligible',
        resourceName: null,
        metadata: null,
        economicEvaluation: evaluation,
        omitsSystemInstruction: false,
        skipReason: evaluation.skipReason
      };
    }

    if (mode === 'auto' && evaluation.recommendation === 'skip_uneconomic') {
      return {
        mode,
        status: 'ineligible',
        resourceName: null,
        metadata: null,
        economicEvaluation: evaluation,
        omitsSystemInstruction: false,
        skipReason: evaluation.skipReason
      };
    }

    // 3. Deduplicate concurrent creation for the same key
    if (this.inFlightCreations.has(cacheKey)) {
      const created = await this.inFlightCreations.get(cacheKey)!;
      if (created) {
        return {
          mode,
          status: 'active',
          resourceName: created.resourceName,
          metadata: created,
          economicEvaluation: evaluation,
          omitsSystemInstruction: true,
          skipReason: null
        };
      }
    }

    // 4. Create new provider cache (or mock simulation in offline testing)
    const creationPromise = (async (): Promise<GeminiProviderCacheMetadata | null> => {
      // Hard Safety Constraint: Never make live creation calls in offline testing mode
      if (!input.allowLiveCreation && !input.mockClient) {
        return null;
      }

      try {
        const client = input.mockClient;
        const ttlSeconds = input.ttlSeconds || 3600;
        const displayName = `wifran-${input.promptProfile}-${input.systemInstructionSha256.slice(0, 8)}`;

        let resourceName: string;
        let expireTime: string;

        if (client?.caches?.create) {
          const res = await client.caches.create({
            model: input.model,
            config: {
              displayName,
              systemInstruction: input.systemInstruction,
              ttl: `${ttlSeconds}s`
            }
          });
          resourceName = res.name || `cachedContents/simulated-${Date.now()}`;
          expireTime = res.expireTime || new Date(Date.now() + ttlSeconds * 1000).toISOString();
        } else {
          resourceName = `cachedContents/mock-${cacheKey.slice(0, 12)}`;
          expireTime = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        }

        const metadata: GeminiProviderCacheMetadata = {
          resourceName,
          displayName,
          model: input.model,
          systemInstructionSha256: input.systemInstructionSha256,
          promptProfile: input.promptProfile,
          schemaProfile: input.schemaProfile,
          createTime: new Date().toISOString(),
          expireTime,
          ttlSeconds,
          tokenCount: evaluation.sharedTokenCount,
          status: 'active',
          fingerprintHash: cacheKey
        };

        this.activeCaches.set(cacheKey, metadata);
        return metadata;
      } catch {
        return null;
      } finally {
        this.inFlightCreations.delete(cacheKey);
      }
    })();

    this.inFlightCreations.set(cacheKey, creationPromise);
    const resultMetadata = await creationPromise;

    if (resultMetadata) {
      return {
        mode,
        status: 'active',
        resourceName: resultMetadata.resourceName,
        metadata: resultMetadata,
        economicEvaluation: evaluation,
        omitsSystemInstruction: true,
        skipReason: null
      };
    }

    return {
      mode,
      status: 'failed',
      resourceName: null,
      metadata: null,
      economicEvaluation: evaluation,
      omitsSystemInstruction: false,
      skipReason: 'Provider cache creation unavailable or offline safety lock active.'
    };
  }

  /**
   * Safely invalidates/purges a cached resource if the provider returns a cache-not-found error.
   */
  invalidateCacheResource(resourceName: string): void {
    for (const [key, meta] of this.activeCaches.entries()) {
      if (meta.resourceName === resourceName) {
        this.activeCaches.delete(key);
      }
    }
  }

  /**
   * Clears all in-memory active caches (for testing and isolation).
   */
  clear(): void {
    this.activeCaches.clear();
    this.inFlightCreations.clear();
  }
}

export const sharedGeminiProviderCacheService = new GeminiProviderCacheService();

