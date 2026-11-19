import type { LeafletPageExtractionRev1 } from './leafletExtraction';
import type {
  LeafletPromptProfile,
  LeafletSchemaProfile
} from '../schemas/leafletPageExtractionSchema';

export type GeminiInferenceMode = 'standard' | 'flex';

export type GeminiProviderCacheMode = 'none' | 'auto' | 'explicit';

export type GeminiProviderCacheStatus =
  | 'disabled'
  | 'ineligible'
  | 'eligible'
  | 'active'
  | 'expired'
  | 'failed';

export type GeminiProviderCacheEconomicEvaluation = {
  modelId: string;
  asOfDate: string;
  tier: GeminiInferenceMode;
  sharedTokenCount: number;
  minimumRequiredTokens: number;
  isEligible: boolean;
  ttlSeconds: number;
  storageCostPerMillionPerHour: number;
  storageCostUsd: number;
  creationInputCostUsd: number;
  nonCachedInputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  netSavingsPerRequestUsd: number;
  breakEvenRequests: number;
  expectedRequests: number;
  netProjectedSavingsUsd: number;
  recommendation: 'skip_ineligible' | 'skip_uneconomic' | 'create_cache';
  skipReason: string | null;
};

export type GeminiProviderCacheMetadata = {
  resourceName: string;
  displayName: string;
  model: string;
  systemInstructionSha256: string;
  promptProfile: LeafletPromptProfile;
  schemaProfile: LeafletSchemaProfile;
  createTime: string;
  expireTime: string;
  ttlSeconds: number;
  tokenCount: number;
  status: GeminiProviderCacheStatus;
  fingerprintHash: string;
};

export type GeminiCostCalculation = {
  currency: 'USD';
  effectiveDate: string;
  modelId: string;
  tier: 'standard' | 'flex';
  ratesApplied: {
    inputPerMillion: number;
    outputPerMillion: number;
    cachedInputPerMillion: number;
  };
  inputCostUsd: number;
  outputCostUsd: number;
  thinkingCostUsd: number;
  cachedInputCostUsd: number;
  totalCostUsd: number;
  isEstimate: boolean;
  metadataMissing?: boolean;
};

export type GeminiInferenceProgressState =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GeminiInferenceProgressEvent = {
  state: GeminiInferenceProgressState;
  pageNumber?: number;
  serviceTier: GeminiInferenceMode;
  attempt: number;
  maxRetries: number;
  delayMs?: number;
  message: string;
  timestamp: string;
};

export type GeminiCacheFingerprint = {
  imageSha256: string;
  model: string;
  systemInstructionSha256: string;
  promptSha256: string;
  promptProfile?: LeafletPromptProfile;
  promptVersion?: string;
  schemaSha256: string;
  schemaProfile?: LeafletSchemaProfile;
  schemaVersion?: string;
  thinkingConfig?: { thinkingLevel?: string; [key: string]: unknown };
  imageSettings?: { format: string; quality: number };
  isDiagnosticRetry?: boolean;
  failureReasonsSha256?: string | null;
  serviceTier?: GeminiInferenceMode;
  backendContext?: {
    backend: string;
    projectId?: string;
    location?: string;
  };
  combinedHash?: string;
};

export type GeminiTokenUsage = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  cachedContentTokenCount: number;
  totalTokenCount: number;
  usageReported: boolean;
};

export type GeminiPageUsageReport = {
  pageNumber?: number;
  modelId: string;
  modelVersion?: string;
  promptProfile?: LeafletPromptProfile;
  schemaProfile?: LeafletSchemaProfile;
  requestedServiceTier: GeminiInferenceMode;
  actualServiceTier: GeminiInferenceMode;
  cacheHit: boolean;
  providerCacheHit?: boolean;
  providerCacheResource?: string | null;
  providerCacheStatus?: GeminiProviderCacheStatus;
  rawResponseReconstructed?: boolean;
  requestDurationMs: number;
  retriesCount: number;
  usage: GeminiTokenUsage;
  cost: GeminiCostCalculation;
  fingerprintHash: string;
};

export type GeminiCacheEntry = {
  cacheVersion: number;
  fingerprint: GeminiCacheFingerprint;
  fingerprintHash: string;
  cachedAt: string;
  usageReport: GeminiPageUsageReport;
  rawResponse: unknown;
  rawResponseText?: string;
  rawResponseReconstructed?: boolean;
  decodedExtraction: LeafletPageExtractionRev1;
};

export type GeminiJobUsageSummary = {
  totalPages: number;
  processedPages: number;
  apiCallsCount: number;
  cacheHitsCount: number;
  retriesCount: number;
  totalPromptTokens: number;
  totalCandidatesTokens: number;
  totalThoughtsTokens: number;
  totalCachedTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  serviceTiersUsed: Record<GeminiInferenceMode, number>;
  modelsUsed?: string[];
  pageReports?: GeminiPageUsageReport[];
};
