import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs';
import { join } from 'path';
import type {
  GeminiCacheFingerprint,
  GeminiCostCalculation,
  GeminiInferenceMode,
  GeminiPageUsageReport,
  GeminiProviderCacheStatus
} from './geminiCacheTypes';

export type GeminiProviderAttemptKind = 'primary' | 'retry' | 'manual';

export interface GeminiProviderArchiveRecord {
  archiveFormatVersion: 1;
  archiveKind: 'live_provider_attempt' | 'reconstructed_cache_backfill';
  reconstructedFromSavedCache: boolean;
  provenanceNote: string;
  attemptKind: GeminiProviderAttemptKind | 'reconstructed';
  attemptSequence: number;
  pageNumber: number;
  correlationId: string;
  requestTimestamp?: string;
  completedAt: string;
  cacheHit: boolean;
  providerCacheHit: boolean;
  providerCacheResource: string | null;
  providerCacheStatus?: GeminiProviderCacheStatus;
  modelId: string;
  modelVersion: string | null;
  requestedServiceTier: GeminiInferenceMode;
  actualServiceTier: GeminiInferenceMode;
  thinkingConfig: Record<string, unknown>;
  requestMetadata: {
    fingerprintHash: string;
    imageSha256: string;
    systemInstructionSha256: string;
    promptSha256: string;
    schemaSha256: string;
    promptProfile?: string;
    schemaProfile?: string;
    schemaVersion?: string;
    isDiagnosticRetry: boolean;
    failureReasons: string[] | null;
    backendContext?: Record<string, unknown>;
  };
  rawResponseText: string | null;
  rawResponseReconstructed?: boolean;
  providerSdkResponse: Record<string, unknown>;
  providerUsageMetadata: Record<string, unknown> | null;
  localUsageSummary: {
    totalDurationMs: number;
    retriesCount: number;
    usageReported: boolean;
    promptTokenCount: number | null;
    candidatesTokenCount: number | null;
    thoughtsTokenCount: number;
    cachedContentTokenCount: number;
    totalTokenCount: number;
    costEstimate: GeminiCostCalculation;
    costNote: string;
  };
  parsedApplicationResponse: {
    rawParsedJson: unknown;
    decodedExtraction: unknown;
  };
}

export interface ArchiveGeminiAttemptInput {
  outputDir: string;
  pageNumber: number;
  attemptKind: GeminiProviderAttemptKind;
  correlationId: string;
  requestTimestamp?: string;
  completedAt: string;
  response: unknown;
  rawResponseText: string;
  parsedResponse: unknown;
  decodedExtraction: unknown;
  usageReport: GeminiPageUsageReport;
  fingerprint: GeminiCacheFingerprint;
  fingerprintHash: string;
  failureReasons?: string[] | null;
  cacheHit?: boolean;
  providerCacheHit?: boolean;
  providerCacheResource?: string | null;
}

export interface ArchiveGeminiAttemptResult {
  ok: boolean;
  archivePath?: string;
  attemptSequence?: number;
  error?: string;
}

const SENSITIVE_KEY_PATTERN =
  /^(api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|client[-_]?secret|private[-_]?key|secret|password|authorization|x-goog-api-key|x-api-key|bearer|cookie|set-cookie|credentials?)$/i;

const SECRET_STRING_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bya29\.[0-9A-Za-z\-_]+/g,
  /\bsk-[A-Za-z0-9]{16,}/g
];

const SDK_ENVELOPE_KEYS = [
  'responseId',
  'modelVersion',
  'createTime',
  'candidates',
  'promptFeedback',
  'usageMetadata',
  'finishReason',
  'finishMessage',
  'safetyRatings',
  'trafficType',
  'serviceTier',
  'citationMetadata',
  'groundingMetadata',
  'executableCode',
  'codeExecutionResult',
  'functionCalls'
] as const;

function sanitizeStringValue(val: string, keyHint?: string): unknown {
  if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) {
    return '[REDACTED_CREDENTIAL]';
  }

  // Never store raw base64 media payloads in provider response archives
  if (
    keyHint &&
    /^(data|imageBase64|base64|bytesBase64Encoded|inlineBytes)$/i.test(keyHint) &&
    val.length > 64 &&
    /^[A-Za-z0-9+/=\s]+$/.test(val)
  ) {
    const clean = val.replace(/\s+/g, '');
    const decoded = Buffer.from(clean, 'base64');
    return {
      omittedBase64: true,
      byteLength: decoded.length,
      sha256: createHash('sha256').update(decoded).digest('hex')
    };
  }

  let redacted = val;
  for (const pattern of SECRET_STRING_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED_SECRET]');
  }
  return redacted;
}

export function sanitizeProviderPayloadForArchive(
  value: unknown,
  keyHint?: string,
  seen = new WeakSet<object>(),
  depth = 0
): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 16) return '[MAX_DEPTH_TRUNCATED]';

  if (typeof value === 'string') {
    return sanitizeStringValue(value, keyHint);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return {
      omittedBase64: true,
      byteLength: value.length,
      sha256: createHash('sha256').update(value).digest('hex')
    };
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeProviderPayloadForArchive(item, undefined, seen, depth + 1));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return '[CIRCULAR_REFERENCE]';
    seen.add(obj);

    if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) {
      return '[REDACTED_CREDENTIAL]';
    }

    // Special handling for Gemini inlineData blobs
    if (keyHint === 'inlineData' && typeof obj.data === 'string') {
      const clean = obj.data.replace(/\s+/g, '');
      const decoded = Buffer.from(clean, 'base64');
      return {
        mimeType: typeof obj.mimeType === 'string' ? obj.mimeType : 'application/octet-stream',
        data: {
          omittedBase64: true,
          byteLength: decoded.length,
          sha256: createHash('sha256').update(decoded).digest('hex')
        }
      };
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || typeof v === 'function') continue;
      if (k === 'text' && typeof v === 'string' && depth === 0) {
        // Skip duplicate top-level text on SDK envelope since rawResponseText stores it verbatim
        continue;
      }
      out[k] = sanitizeProviderPayloadForArchive(v, k, seen, depth + 1);
    }
    return out;
  }

  return String(value);
}

/**
 * Extracts only SDK fields actually present on the provider response object.
 * Never fabricates missing candidates, finish reasons, or hidden reasoning.
 */
export function extractActualProviderSdkFields(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return {};
  }
  const respObj = response as Record<string, unknown>;
  const extracted: Record<string, unknown> = {};

  for (const key of SDK_ENVELOPE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(respObj, key) && respObj[key] !== undefined) {
      extracted[key] = sanitizeProviderPayloadForArchive(respObj[key], key);
    }
  }

  return extracted;
}

function getNextAttemptSequence(archiveDir: string): number {
  if (!existsSync(archiveDir)) return 1;
  const files = readdirSync(archiveDir);
  let maxSeq = 0;
  for (const f of files) {
    const match = f.match(/-attempt-(\d+)\.json$/i);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (!Number.isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }
  return maxSeq + 1;
}

function writeJsonAtomicNoOverwrite(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const serialized = JSON.stringify(payload, null, 2);
  try {
    writeFileSync(tmpPath, serialized, { encoding: 'utf8', flag: 'wx' });
    renameSync(tmpPath, filePath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore cleanup failure
      }
    }
    throw err;
  }
}

export function archiveGeminiProviderAttempt(
  input: ArchiveGeminiAttemptInput
): ArchiveGeminiAttemptResult {
  const archiveDir = join(input.outputDir, 'provider-responses');
  try {
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }

    let seq = getNextAttemptSequence(archiveDir);
    let fileName = `${input.attemptKind}-attempt-${String(seq).padStart(3, '0')}.json`;
    let archivePath = join(archiveDir, fileName);

    // Guarantee earlier attempts are never overwritten even under concurrent writes
    while (existsSync(archivePath)) {
      seq++;
      fileName = `${input.attemptKind}-attempt-${String(seq).padStart(3, '0')}.json`;
      archivePath = join(archiveDir, fileName);
    }

    const providerSdkResponse = extractActualProviderSdkFields(input.response);
    const rawUsageMeta =
      input.response &&
      typeof input.response === 'object' &&
      !Array.isArray(input.response) &&
      (input.response as Record<string, unknown>).usageMetadata !== undefined
        ? (sanitizeProviderPayloadForArchive(
            (input.response as Record<string, unknown>).usageMetadata,
            'usageMetadata'
          ) as Record<string, unknown>)
        : null;

    const record: GeminiProviderArchiveRecord = {
      archiveFormatVersion: 1,
      archiveKind: 'live_provider_attempt',
      reconstructedFromSavedCache: false,
      provenanceNote:
        'Per-attempt archive of actual provider response fields and verbatim rawResponseText separated from parsed application extraction. Hidden model reasoning text is not exposed by the Gemini API and is never fabricated.',
      attemptKind: input.attemptKind,
      attemptSequence: seq,
      pageNumber: input.pageNumber,
      correlationId: input.correlationId,
      requestTimestamp: input.requestTimestamp,
      completedAt: input.completedAt,
      cacheHit: Boolean(input.cacheHit),
      providerCacheHit: Boolean(input.providerCacheHit),
      providerCacheResource: input.providerCacheResource ?? null,
      providerCacheStatus: input.usageReport.providerCacheStatus,
      modelId: input.usageReport.modelId,
      modelVersion:
        (typeof providerSdkResponse.modelVersion === 'string'
          ? providerSdkResponse.modelVersion
          : input.usageReport.modelVersion) ?? null,
      requestedServiceTier: input.usageReport.requestedServiceTier,
      actualServiceTier: input.usageReport.actualServiceTier,
      thinkingConfig: (sanitizeProviderPayloadForArchive(input.fingerprint.thinkingConfig || {}) as Record<
        string,
        unknown
      >) || {},
      requestMetadata: {
        fingerprintHash: input.fingerprintHash,
        imageSha256: input.fingerprint.imageSha256,
        systemInstructionSha256: input.fingerprint.systemInstructionSha256,
        promptSha256: input.fingerprint.promptSha256,
        schemaSha256: input.fingerprint.schemaSha256,
        promptProfile: input.fingerprint.promptProfile,
        schemaProfile: input.fingerprint.schemaProfile,
        schemaVersion: input.fingerprint.schemaVersion || input.fingerprint.schemaProfile,
        isDiagnosticRetry: Boolean(input.fingerprint.isDiagnosticRetry),
        failureReasons: input.failureReasons && input.failureReasons.length > 0 ? input.failureReasons : null,
        backendContext: input.fingerprint.backendContext
          ? (sanitizeProviderPayloadForArchive(input.fingerprint.backendContext) as Record<string, unknown>)
          : undefined
      },
      rawResponseText: input.rawResponseText,
      rawResponseReconstructed: false,
      providerSdkResponse,
      providerUsageMetadata: rawUsageMeta,
      localUsageSummary: {
        totalDurationMs: input.usageReport.requestDurationMs,
        retriesCount: input.usageReport.retriesCount,
        usageReported: Boolean(input.usageReport.usage?.usageReported),
        promptTokenCount:
          input.usageReport.usage?.promptTokenCount !== undefined
            ? input.usageReport.usage.promptTokenCount
            : null,
        candidatesTokenCount:
          input.usageReport.usage?.candidatesTokenCount !== undefined
            ? input.usageReport.usage.candidatesTokenCount
            : null,
        thoughtsTokenCount: input.usageReport.usage?.thoughtsTokenCount ?? 0,
        cachedContentTokenCount: input.usageReport.usage?.cachedContentTokenCount ?? 0,
        totalTokenCount: input.usageReport.usage?.totalTokenCount ?? 0,
        costEstimate: input.usageReport.cost,
        costNote: 'Locally estimated USD cost from pricing table (isEstimate=true), not official provider billing.'
      },
      parsedApplicationResponse: {
        rawParsedJson: sanitizeProviderPayloadForArchive(input.parsedResponse),
        decodedExtraction: sanitizeProviderPayloadForArchive(input.decodedExtraction)
      }
    };

    writeJsonAtomicNoOverwrite(archivePath, record);
    return { ok: true, archivePath, attemptSequence: seq };
  } catch (err: any) {
    return {
      ok: false,
      error: `PROVIDER_ARCHIVE_WRITE_FAILED: ${err?.message || String(err)}`
    };
  }
}

export interface BackfillProviderArchiveResult {
  archivedPaths: string[];
  skippedExistingPaths: string[];
  warnings: string[];
}

/**
 * Offline backfill that generates reconstructed provider-responses archives from
 * historical `metadata/rev1/page-NNN/raw_extracted_page_N.json` cache files without
 * issuing any provider API call. Strictly scoped to `selectedPages` when provided.
 */
export function backfillProviderResponseArchiveFromRawCache(
  packageDir: string,
  options: { selectedPages?: number[] } = {}
): BackfillProviderArchiveResult {
  const archivedPaths: string[] = [];
  const skippedExistingPaths: string[] = [];
  const warnings: string[] = [];

  const rev1Dir = join(packageDir, 'metadata', 'rev1');
  if (!existsSync(rev1Dir)) {
    return { archivedPaths, skippedExistingPaths, warnings };
  }

  const selectedSet =
    options.selectedPages && options.selectedPages.length > 0
      ? new Set(options.selectedPages)
      : null;

  const entries = readdirSync(rev1Dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    const match = dirent.name.match(/^page-(\d+)$/);
    if (!match) continue;
    const pageNumber = parseInt(match[1], 10);
    if (selectedSet && !selectedSet.has(pageNumber)) continue;

    const pageDir = join(rev1Dir, dirent.name);
    const rawCachePath = join(pageDir, `raw_extracted_page_${pageNumber}.json`);
    if (!existsSync(rawCachePath)) continue;

    const archiveDir = join(pageDir, 'provider-responses');
    if (existsSync(archiveDir)) {
      const existing = readdirSync(archiveDir).filter(f => f.endsWith('.json'));
      if (existing.length > 0) {
        for (const f of existing) {
          skippedExistingPaths.push(join(archiveDir, f));
        }
        continue;
      }
    }

    try {
      const parsedCache = JSON.parse(readFileSync(rawCachePath, 'utf8'));
      const usageReport: GeminiPageUsageReport = parsedCache.usageReport || {
        pageNumber,
        modelId: parsedCache.fingerprint?.model || 'gemini-3.8-flash',
        requestedServiceTier: parsedCache.fingerprint?.serviceTier || 'standard',
        actualServiceTier: parsedCache.fingerprint?.serviceTier || 'standard',
        cacheHit: true,
        rawResponseReconstructed: !parsedCache.rawResponseText,
        requestDurationMs: 0,
        retriesCount: 0,
        usage: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
          thoughtsTokenCount: 0,
          cachedContentTokenCount: 0,
          totalTokenCount: 0,
          usageReported: false
        },
        cost: {
          currency: 'USD',
          effectiveDate: '2026-11-07',
          modelId: parsedCache.fingerprint?.model || 'gemini-3.8-flash',
          tier: parsedCache.fingerprint?.serviceTier || 'standard',
          ratesApplied: { inputPerMillion: 0, outputPerMillion: 0, cachedInputPerMillion: 0 },
          inputCostUsd: 0,
          outputCostUsd: 0,
          thinkingCostUsd: 0,
          cachedInputCostUsd: 0,
          totalCostUsd: 0,
          isEstimate: true,
          metadataMissing: true
        },
        fingerprintHash: parsedCache.fingerprintHash || ''
      };

      if (!existsSync(archiveDir)) {
        mkdirSync(archiveDir, { recursive: true });
      }
      const targetPath = join(archiveDir, 'reconstructed-attempt-001.json');

      const record: GeminiProviderArchiveRecord = {
        archiveFormatVersion: 1,
        archiveKind: 'reconstructed_cache_backfill',
        reconstructedFromSavedCache: true,
        provenanceNote:
          'Reconstructed offline from saved raw_extracted_page cache file. Original SDK HTTP envelope fields (e.g. candidates, finishReason, safetyRatings) were not stored separately in historical cache and are omitted rather than fabricated.',
        attemptKind: 'reconstructed',
        attemptSequence: 1,
        pageNumber,
        correlationId: `backfill:p${pageNumber}:${parsedCache.fingerprintHash || 'legacy'}`,
        completedAt: parsedCache.cachedAt || new Date().toISOString(),
        cacheHit: Boolean(usageReport.cacheHit),
        providerCacheHit: Boolean(usageReport.providerCacheHit),
        providerCacheResource: usageReport.providerCacheResource ?? null,
        providerCacheStatus: usageReport.providerCacheStatus,
        modelId: usageReport.modelId,
        modelVersion: usageReport.modelVersion ?? null,
        requestedServiceTier: usageReport.requestedServiceTier,
        actualServiceTier: usageReport.actualServiceTier,
        thinkingConfig: parsedCache.fingerprint?.thinkingConfig || {},
        requestMetadata: {
          fingerprintHash: parsedCache.fingerprintHash || '',
          imageSha256: parsedCache.fingerprint?.imageSha256 || '',
          systemInstructionSha256: parsedCache.fingerprint?.systemInstructionSha256 || '',
          promptSha256: parsedCache.fingerprint?.promptSha256 || '',
          schemaSha256: parsedCache.fingerprint?.schemaSha256 || '',
          promptProfile: parsedCache.fingerprint?.promptProfile,
          schemaProfile: parsedCache.fingerprint?.schemaProfile,
          isDiagnosticRetry: Boolean(parsedCache.fingerprint?.isDiagnosticRetry),
          failureReasons: null,
          backendContext: parsedCache.fingerprint?.backendContext
        },
        rawResponseText: typeof parsedCache.rawResponseText === 'string' ? parsedCache.rawResponseText : null,
        rawResponseReconstructed: !parsedCache.rawResponseText || Boolean(parsedCache.rawResponseReconstructed),
        providerSdkResponse: {},
        providerUsageMetadata: null,
        localUsageSummary: {
          totalDurationMs: usageReport.requestDurationMs,
          retriesCount: usageReport.retriesCount,
          usageReported: Boolean(usageReport.usage?.usageReported),
          promptTokenCount:
            usageReport.usage?.promptTokenCount !== undefined ? usageReport.usage.promptTokenCount : null,
          candidatesTokenCount:
            usageReport.usage?.candidatesTokenCount !== undefined ? usageReport.usage.candidatesTokenCount : null,
          thoughtsTokenCount: usageReport.usage?.thoughtsTokenCount ?? 0,
          cachedContentTokenCount: usageReport.usage?.cachedContentTokenCount ?? 0,
          totalTokenCount: usageReport.usage?.totalTokenCount ?? 0,
          costEstimate: usageReport.cost,
          costNote: 'Locally estimated USD cost from pricing table (isEstimate=true), not official provider billing.'
        },
        parsedApplicationResponse: {
          rawParsedJson: sanitizeProviderPayloadForArchive(parsedCache.rawResponse ?? null),
          decodedExtraction: sanitizeProviderPayloadForArchive(parsedCache.decodedExtraction ?? parsedCache)
        }
      };

      writeJsonAtomicNoOverwrite(targetPath, record);
      archivedPaths.push(targetPath);
    } catch (err: any) {
      warnings.push(`Failed to backfill page ${pageNumber} archive: ${err?.message || String(err)}`);
    }
  }

  return { archivedPaths, skippedExistingPaths, warnings };
}

