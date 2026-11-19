import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type {
  GeminiCacheFingerprint,
  GeminiCacheEntry,
  GeminiInferenceMode
} from './geminiCacheTypes';
import type {
  LeafletPromptProfile,
  LeafletSchemaProfile,
  LeafletSchemaVersion
} from '../../shared/schemas/leafletPageExtractionSchema';

export type FingerprintInput = {
  imageBuffer: Buffer;
  model: string;
  systemInstruction?: string;
  systemInstructionSha256?: string;
  promptText: string;
  promptProfile?: LeafletPromptProfile;
  promptVersion?: LeafletSchemaVersion | string;
  schema: Record<string, unknown>;
  schemaProfile?: LeafletSchemaProfile;
  schemaVersion?: LeafletSchemaVersion | string;
  thinkingConfig: { thinkingLevel?: string; [key: string]: unknown };
  imageSettings?: { format: 'jpeg'; quality: number };
  isDiagnosticRetry?: boolean;
  failureReasons?: string[] | null;
  serviceTier?: GeminiInferenceMode;
  backendContext?: {
    backend: string;
    projectId?: string;
    location?: string;
  };
};

export class GeminiExtractionCacheService {
  private inFlightRequests = new Map<string, Promise<any>>();

  /**
   * Deterministically computes the cache fingerprint over all semantic inputs,
   * incorporating the actual system instructions, prompt profile, schema definition,
   * thinking configuration, image preprocessing, and runtime parameters.
   */
  computeFingerprint(input: FingerprintInput): {
    fingerprint: GeminiCacheFingerprint;
    fingerprintHash: string;
  } {
    const imageSha256 = createHash('sha256').update(input.imageBuffer).digest('hex');
    const systemInstructionSha256 =
      input.systemInstructionSha256 ||
      createHash('sha256').update(input.systemInstruction || '', 'utf8').digest('hex');
    const promptSha256 = createHash('sha256').update(input.promptText, 'utf8').digest('hex');
    const schemaSha256 = createHash('sha256')
      .update(JSON.stringify(input.schema), 'utf8')
      .digest('hex');

    const failureReasonsSha256 =
      input.failureReasons && input.failureReasons.length > 0
        ? createHash('sha256').update(JSON.stringify(input.failureReasons), 'utf8').digest('hex')
        : null;

    const promptProfile: LeafletPromptProfile =
      input.promptProfile || ((input.promptVersion as LeafletPromptProfile) || 'legacy');
    const schemaProfile: LeafletSchemaProfile =
      input.schemaProfile || ((input.schemaVersion as LeafletSchemaProfile) || 'legacy');

    const fingerprint: GeminiCacheFingerprint = {
      imageSha256,
      model: input.model,
      systemInstructionSha256,
      promptSha256,
      promptProfile,
      promptVersion: input.promptVersion || promptProfile,
      schemaSha256,
      schemaProfile,
      schemaVersion: input.schemaVersion || schemaProfile,
      thinkingConfig: input.thinkingConfig,
      imageSettings: input.imageSettings || { format: 'jpeg', quality: 92 },
      isDiagnosticRetry: Boolean(input.isDiagnosticRetry),
      failureReasonsSha256,
      serviceTier: input.serviceTier,
      backendContext: input.backendContext
    };

    const fingerprintHash = createHash('sha256')
      .update(JSON.stringify(fingerprint), 'utf8')
      .digest('hex');

    return { fingerprint, fingerprintHash };
  }

  /**
   * Resolves the primary cache file path for an extracted page.
   */
  resolveCachePath(outputDir: string, pageNumber?: number): string {
    const pageNum = pageNumber || 1;
    return join(outputDir, `raw_extracted_page_${pageNum}.json`);
  }

  /**
   * Resolves the secondary content-addressed cache path in .gemini-cache.
   */
  resolveContentAddressedCachePath(outputDir: string, fingerprintHash: string): string {
    return join(outputDir, '.gemini-cache', `${fingerprintHash}.json`);
  }

  /**
   * Validates coordinate array structure: [ymin, xmin, ymax, xmax] in 0..1000.
   */
  isValidCoordinateBox(box: unknown): boolean {
    if (!Array.isArray(box) || box.length !== 4) return false;
    for (const val of box) {
      if (typeof val !== 'number' || isNaN(val) || val < 0 || val > 1000) {
        return false;
      }
    }
    // Spatial sanity: ymin <= ymax and xmin <= xmax
    return box[0] <= box[2] && box[1] <= box[3];
  }

  /**
   * Validates decoded extraction response integrity before reusing from cache.
   * Confirms required prices, descriptions, and coordinate structures.
   */
  validateDecodedExtractionIntegrity(extraction: any): boolean {
    if (!extraction || typeof extraction !== 'object' || !Array.isArray(extraction.offers)) {
      return false;
    }

    for (const offer of extraction.offers) {
      if (typeof offer.offer_number !== 'number') return false;
      if (typeof offer.promo_price !== 'number' || isNaN(offer.promo_price) || offer.promo_price < 0) {
        return false;
      }
      if (
        offer.original_price !== null &&
        offer.original_price !== undefined &&
        (typeof offer.original_price !== 'number' || isNaN(offer.original_price))
      ) {
        return false;
      }

      // At least one description must be present and non-empty
      const hasArabic = typeof offer.arabic_title === 'string' && offer.arabic_title.trim().length > 0;
      const hasEnglish = typeof offer.english_title === 'string' && offer.english_title.trim().length > 0;
      if (!hasArabic && !hasEnglish) return false;

      // Validate bounding box coordinates
      const comp = offer.components;
      if (!comp || typeof comp !== 'object') return false;
      if (!this.isValidCoordinateBox(comp.product_graphic_box)) return false;
      if (!this.isValidCoordinateBox(comp.promo_price_box)) return false;
      if (comp.original_price_box && !this.isValidCoordinateBox(comp.original_price_box)) return false;
      if (comp.unit_and_size_badge_box && !this.isValidCoordinateBox(comp.unit_and_size_badge_box)) return false;
      if (comp.title_text_box && !this.isValidCoordinateBox(comp.title_text_box)) return false;
    }

    return true;
  }

  /**
   * Validates and reads a cached entry, confirming that the recorded fingerprint
   * strictly matches the expected request inputs and satisfies complete data integrity.
   * Compares system instruction hash, schema hash, prompt text, thinking level, and image settings.
   * Rejects corrupted, incomplete, or incompatible entries.
   */
  readValidCacheEntry(
    filePath: string,
    expectedFingerprint: GeminiCacheFingerprint
  ): GeminiCacheEntry | null {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      if (!content || !content.trim()) {
        return null;
      }

      const parsed = JSON.parse(content);

      // Verify modern envelope structure
      if (parsed.cacheVersion && parsed.fingerprint) {
        const fp: GeminiCacheFingerprint = parsed.fingerprint;

        // 1. Strict core fingerprint input validation
        if (
          fp.imageSha256 !== expectedFingerprint.imageSha256 ||
          fp.model !== expectedFingerprint.model ||
          fp.promptSha256 !== expectedFingerprint.promptSha256 ||
          fp.schemaSha256 !== expectedFingerprint.schemaSha256 ||
          fp.isDiagnosticRetry !== expectedFingerprint.isDiagnosticRetry ||
          fp.failureReasonsSha256 !== expectedFingerprint.failureReasonsSha256
        ) {
          return null; // Input mismatch: cache invalidated
        }

        // 2. Validate system instructions hash (invalidates cache on prompt changes)
        if (
          expectedFingerprint.systemInstructionSha256 &&
          fp.systemInstructionSha256 &&
          fp.systemInstructionSha256 !== expectedFingerprint.systemInstructionSha256
        ) {
          return null; // System instruction divergence: cache invalidated
        }

        // 3. Validate prompt & schema profile matching
        const recordedPrompt = fp.promptProfile || fp.promptVersion;
        const expectedPrompt = expectedFingerprint.promptProfile || expectedFingerprint.promptVersion;
        if (recordedPrompt && expectedPrompt && recordedPrompt !== expectedPrompt) {
          return null;
        }

        const recordedSchema = fp.schemaProfile || fp.schemaVersion;
        const expectedSchema = expectedFingerprint.schemaProfile || expectedFingerprint.schemaVersion;
        if (recordedSchema && expectedSchema && recordedSchema !== expectedSchema) {
          return null;
        }

        // 4. Validate thinking configuration (invalidates cache if thinking level changes)
        if (
          expectedFingerprint.thinkingConfig?.thinkingLevel &&
          fp.thinkingConfig?.thinkingLevel &&
          fp.thinkingConfig.thinkingLevel !== expectedFingerprint.thinkingConfig.thinkingLevel
        ) {
          return null;
        }

        // 5. Validate image preprocessing settings (quality, format)
        if (
          expectedFingerprint.imageSettings &&
          fp.imageSettings &&
          (fp.imageSettings.quality !== expectedFingerprint.imageSettings.quality ||
            fp.imageSettings.format !== expectedFingerprint.imageSettings.format)
        ) {
          return null;
        }

        // 6. Validate service tier consistency if specified on both
        if (
          expectedFingerprint.serviceTier &&
          fp.serviceTier &&
          fp.serviceTier !== expectedFingerprint.serviceTier
        ) {
          return null;
        }

        // 7. Validate decoded extraction integrity (prices, titles, 5 bounding boxes)
        if (!this.validateDecodedExtractionIntegrity(parsed.decodedExtraction)) {
          return null; // Incomplete, invalid, or corrupted extraction content
        }

        return parsed as GeminiCacheEntry;
      }

      // Legacy fallback: Raw un-enveloped JSON
      // A bare file alone is NOT sufficient proof of cache validity without verifiable provenance
      return null;
    } catch {
      return null; // Corrupted or truncated JSON
    }
  }

  /**
   * Reads legacy raw extraction evidence (e.g., historical raw_extracted_page_*.json without envelope),
   * ensuring legacy extraction evidence remains readable through existing application entrypoints.
   */
  readLegacyRawEvidence(filePath: string): any | null {
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, 'utf8');
      if (!content || !content.trim()) return null;
      const parsed = JSON.parse(content);
      // Return decoded extraction if envelope or raw payload
      return parsed.decodedExtraction || parsed;
    } catch {
      return null;
    }
  }

  /**
   * Writes a cache entry atomically using a temporary file and atomic rename.
   */
  writeCacheEntryAtomic(filePath: string, entry: GeminiCacheEntry): void {
    const targetDir = dirname(filePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
    const serialized = JSON.stringify(entry, null, 2);

    try {
      writeFileSync(tmpPath, serialized, 'utf8');
      renameSync(tmpPath, filePath);
    } catch (err: any) {
      if (err.code === 'EEXIST' || err.code === 'EBUSY' || err.code === 'EPERM') {
        writeFileSync(filePath, serialized, 'utf8');
      } else {
        throw err;
      }
    }
  }

  /**
   * Deduplicates concurrent in-flight requests for the exact same fingerprintHash.
   */
  async executeWithDeduplication<T>(
    fingerprintHash: string,
    factory: () => Promise<T>
  ): Promise<T> {
    const existing = this.inFlightRequests.get(fingerprintHash);
    if (existing) {
      return (await existing) as T;
    }

    const promise = factory().finally(() => {
      this.inFlightRequests.delete(fingerprintHash);
    });

    this.inFlightRequests.set(fingerprintHash, promise);
    return await promise;
  }
}

export const sharedGeminiExtractionCacheService = new GeminiExtractionCacheService();
