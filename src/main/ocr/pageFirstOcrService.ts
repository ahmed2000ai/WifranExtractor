import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { loadEnvConfig } from '../config/env';
import { runWithMistralRateLimit } from './mistralRateLimitQueue';
import { info, warn, error as logError } from '../logging/logger';
import {
  buildPageFirstOfferPrompt,
  buildPageFirstRetryPrompt,
  buildPageFirstAnnotationFormat,
  PageFirstRetryDiagnostics
} from './pageFirstOfferPromptBuilder';
import { pageFirstOfferExtractionSchema } from '../../shared/schemas/pageFirstOfferExtractionSchema';
import type { PageFirstOfferExtraction } from '../../shared/types/pageFirstOfferExtraction';
import type { NormalizedOcrBlock } from '../../shared/types/normalizedOcrBlock';
import { getMistralClient } from './mistralClient';

export type PageFirstOcrLogEvent = {
  code: string;
  message: string;
  level: 'info' | 'warning' | 'error';
};

export type PageFirstOcrExecutionOptions = {
  pageNumber: number;
  renderedImagePath: string;
  packageDir: string;
  isRetry?: boolean;
  retryIndex?: number;
  retryDiagnostics?: PageFirstRetryDiagnostics;
  overrideModel?: string;
  mockResponse?: any; // For offline tests without calling network
  onLog?: (event: PageFirstOcrLogEvent) => void;
};

export type PageFirstOcrResult = {
  ok: boolean;
  pageNumber: number;
  rawResponse: any;
  annotation: PageFirstOfferExtraction | null;
  blocks: NormalizedOcrBlock[];
  renderedDimensions: { width: number; height: number };
  analysisDimensions: { width: number; height: number };
  scale: { scaleX: number; scaleY: number };
  usage: { pagesProcessed: number; promptTokens?: number; totalTokens?: number };
  model: string;
  error?: string;
  artifactPaths: {
    dir: string;
    rawResponsePath: string;
    annotationPath: string;
    blocksPath: string;
    requestMetadataPath: string;
  };
};

function atomicWriteJson(filePath: string, data: unknown): void {
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
  writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  // Atomic rename / overwrite
  try {
    const fs = require('fs');
    fs.renameSync(tempPath, filePath);
  } catch {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    try {
      require('fs').unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }
}

export async function executePageFirstOcr(
  options: PageFirstOcrExecutionOptions
): Promise<PageFirstOcrResult> {
  const config = loadEnvConfig();
  const apiKey = process.env.MISTRAL_API_KEY || config.mistral.apiKey;
  const model = options.overrideModel || process.env.MISTRAL_OCR_MODEL || process.env.MISTRAL_PAGE_OCR_MODEL || config.mistral.ocrModel || 'mistral-ocr-latest';
  const pageNumber = options.pageNumber;
  const pagePadded = String(pageNumber).padStart(3, '0');

  console.log(`[PageFirstPipeline] Initializing OCR request: model=${model}, endpoint=${config.mistral.ocrEndpoint}, apiKeyConfigured=${Boolean(apiKey)}`);
  info(`[PageFirstPipeline] Initializing OCR request: model=${model}, endpoint=${config.mistral.ocrEndpoint}, apiKeyConfigured=${Boolean(apiKey)}`);

  // Artifact directories
  const baseDir = join(options.packageDir, 'metadata', 'page-first-ocr', `page-${pagePadded}`);
  const targetDir = options.isRetry
    ? join(baseDir, `retry-${String(options.retryIndex || 1).padStart(3, '0')}`)
    : baseDir;

  mkdirSync(targetDir, { recursive: true });

  const rawResponsePath = join(targetDir, 'raw-response.json');
  const annotationPath = join(targetDir, 'annotation.json');
  const blocksPath = join(targetDir, 'blocks.json');
  const requestMetadataPath = join(targetDir, 'request-metadata.json');

  const artifactPaths = {
    dir: targetDir,
    rawResponsePath,
    annotationPath,
    blocksPath,
    requestMetadataPath
  };

  // Inspect rendered image dimensions
  const imageMetadata = await sharp(options.renderedImagePath).metadata();
  const origW = imageMetadata.width || 1200;
  const origH = imageMetadata.height || 1800;

  // Analysis downscaling if > 2500 px
  const maxDim = 2500;
  let analysisW = origW;
  let analysisH = origH;
  let imageBufferForOcr: Buffer;

  if (Math.max(origW, origH) > maxDim) {
    if (origW >= origH) {
      analysisW = maxDim;
      analysisH = Math.round((origH / origW) * maxDim);
    } else {
      analysisH = maxDim;
      analysisW = Math.round((origW / origH) * maxDim);
    }
    imageBufferForOcr = await sharp(options.renderedImagePath)
      .resize(analysisW, analysisH, { fit: 'inside' })
      .jpeg({ quality: 90 })
      .toBuffer();
  } else {
    imageBufferForOcr = await sharp(options.renderedImagePath)
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  const scaleX = origW / analysisW;
  const scaleY = origH / analysisH;

  const promptText = options.isRetry && options.retryDiagnostics
    ? buildPageFirstRetryPrompt(options.retryDiagnostics)
    : buildPageFirstOfferPrompt();

  const annotationFormat = buildPageFirstAnnotationFormat();

  let rawResponse: any = null;
  const requestTimestamp = new Date().toISOString();

  if (options.mockResponse) {
    // Offline / Mock execution
    options.onLog?.({
      code: 'PAGE_FIRST_REQUEST_QUEUED',
      message: `Page ${pageNumber} request queued (mock mode)`,
      level: 'info'
    });
    options.onLog?.({
      code: 'MISTRAL_OCR_REQUEST_START',
      message: `Sending mock OCR request for page ${pageNumber}`,
      level: 'info'
    });
    rawResponse = options.mockResponse;
    options.onLog?.({
      code: 'MISTRAL_OCR_REQUEST_SUCCESS',
      message: `OCR response received for page ${pageNumber} (mock mode)`,
      level: 'info'
    });
  } else {
    if (!apiKey) {
      const err = new Error('Mistral API key missing. Please configure MISTRAL_API_KEY in .env.local');
      console.error(`[PageFirstPipeline] ${err.message}`);
      logError(`[PageFirstPipeline] ${err.message}`);
      options.onLog?.({
        code: 'MISTRAL_OCR_REQUEST_FAILED',
        message: err.message,
        level: 'error'
      });
      throw err;
    }

    const requestKind = options.isRetry ? 'page_offer_retry' : 'page_offer_extraction';
    const label = options.isRetry
      ? `Mistral OCR Page Retry (p.${pageNumber})`
      : `Mistral OCR Page Extraction (p.${pageNumber})`;

    options.onLog?.({
      code: 'PAGE_FIRST_REQUEST_QUEUED',
      message: `Page ${pageNumber} request queued in Mistral OCR rate-limit queue`,
      level: 'info'
    });

    try {
      const activeClient = await getMistralClient(apiKey);

      const res = await runWithMistralRateLimit(
        { kind: requestKind, label, pageNumber },
        async () => {
          options.onLog?.({
            code: 'MISTRAL_OCR_REQUEST_START',
            message: `Sending Mistral OCR request for page ${pageNumber} (model: ${model})`,
            level: 'info'
          });

          // Upload rendered page image with purpose: "ocr"
          const uploadedFile = await activeClient.files.upload({
            file: {
              fileName: `page-${pageNumber}.jpg`,
              content: imageBufferForOcr
            },
            purpose: 'ocr'
          });

          if (!uploadedFile?.id) {
            throw new Error('OCR_UPLOAD_FAILED: Failed to upload page image to Mistral.');
          }

          // Pass the returned id as a file_id type object into client.ocr.process
          return await activeClient.ocr.process({
            model: model || 'mistral-ocr-latest',
            document: {
              type: 'file',
              fileId: uploadedFile.id
            },
            includeImageBase64: false,
            documentAnnotationFormat: annotationFormat,
            documentAnnotationPrompt: promptText
          });
        }
      );

      rawResponse = res;
      options.onLog?.({
        code: 'MISTRAL_OCR_REQUEST_SUCCESS',
        message: `Mistral OCR response received for page ${pageNumber}`,
        level: 'info'
      });
    } catch (err: any) {
      console.error(`[PageFirstPipeline] Mistral OCR request failed for page ${pageNumber}: ${err.message}`);
      logError(`[PageFirstPipeline] Mistral OCR request failed for page ${pageNumber}: ${err.message}`);
      options.onLog?.({
        code: 'MISTRAL_OCR_REQUEST_FAILED',
        message: `Mistral OCR request failed for page ${pageNumber}: ${err.message}`,
        level: 'error'
      });
      throw err;
    }
  }

  // Extract structured document annotation
  let rawAnnotationJson: any = null;
  if (rawResponse) {
    if (rawResponse.document_annotation) {
      try {
        rawAnnotationJson = typeof rawResponse.document_annotation === 'string'
          ? JSON.parse(rawResponse.document_annotation)
          : rawResponse.document_annotation;
      } catch (e: any) {
        console.error(`[pageFirstOcrService] Failed to parse document_annotation string:`, e);
      }
    } else if (rawResponse.documentAnnotation) {
      try {
        rawAnnotationJson = typeof rawResponse.documentAnnotation === 'string'
          ? JSON.parse(rawResponse.documentAnnotation)
          : rawResponse.documentAnnotation;
      } catch (e: any) {
        console.error(`[pageFirstOcrService] Failed to parse documentAnnotation string:`, e);
      }
    } else if (rawResponse.annotation) {
      rawAnnotationJson = rawResponse.annotation;
    }
  }

  // Validate annotation with strict Zod schema
  let parsedAnnotation: PageFirstOfferExtraction | null = null;
  let validationError: string | undefined = undefined;

  if (rawAnnotationJson) {
    const parseRes = pageFirstOfferExtractionSchema.safeParse(rawAnnotationJson);
    if (parseRes.success) {
      parsedAnnotation = parseRes.data;
      options.onLog?.({
        code: 'PAGE_FIRST_ANNOTATION_PARSED',
        message: `Parsed ${parsedAnnotation.offers.length} structured offers from page ${pageNumber}`,
        level: 'info'
      });
    } else {
      validationError = `OCR schema validation failed: ${parseRes.error.message}`;
      console.warn(`[PageFirstPipeline] ${validationError}`);
      warn(`[PageFirstPipeline] ${validationError}`);
      options.onLog?.({
        code: 'MISTRAL_OCR_REQUEST_FAILED',
        message: validationError,
        level: 'error'
      });
    }
  } else {
    validationError = 'No document_annotation present in OCR response';
    console.warn(`[PageFirstPipeline] ${validationError}`);
    warn(`[PageFirstPipeline] ${validationError}`);
    options.onLog?.({
      code: 'MISTRAL_OCR_REQUEST_FAILED',
      message: validationError,
      level: 'error'
    });
  }

  // Normalize OCR Blocks
  const normalizedBlocks: NormalizedOcrBlock[] = extractAndNormalizeBlocks(
    rawResponse,
    pageNumber,
    { width: origW, height: origH },
    { width: analysisW, height: analysisH },
    { scaleX, scaleY }
  );

  // Extract usage info
  const usage = {
    pagesProcessed: rawResponse?.usage_info?.pages_processed ?? rawResponse?.usageInfo?.pagesProcessed ?? 1,
    promptTokens: rawResponse?.usage_info?.prompt_tokens ?? rawResponse?.usageInfo?.promptTokens,
    totalTokens: rawResponse?.usage_info?.total_tokens ?? rawResponse?.usageInfo?.totalTokens
  };

  // Save atomic raw response without base64
  const sanitizedRawResponse = sanitizeRawResponseForStorage(rawResponse);
  atomicWriteJson(rawResponsePath, sanitizedRawResponse);

  if (parsedAnnotation) {
    atomicWriteJson(annotationPath, parsedAnnotation);
  } else if (rawAnnotationJson) {
    atomicWriteJson(annotationPath, { unvalidated: rawAnnotationJson, error: validationError });
  }

  atomicWriteJson(blocksPath, normalizedBlocks);

  const requestMetadata = {
    model,
    page_number: pageNumber,
    requested_at: requestTimestamp,
    completed_at: new Date().toISOString(),
    is_retry: Boolean(options.isRetry),
    retry_index: options.retryIndex || 0,
    rendered_dimensions: { width: origW, height: origH },
    analysis_dimensions: { width: analysisW, height: analysisH },
    scale: { scale_x: scaleX, scale_y: scaleY },
    usage,
    block_count: normalizedBlocks.length,
    offer_count: parsedAnnotation?.offers?.length ?? 0,
    schema_valid: Boolean(parsedAnnotation),
    validation_error: validationError || null
  };
  atomicWriteJson(requestMetadataPath, requestMetadata);

  return {
    ok: Boolean(parsedAnnotation),
    pageNumber,
    rawResponse: sanitizedRawResponse,
    annotation: parsedAnnotation,
    blocks: normalizedBlocks,
    renderedDimensions: { width: origW, height: origH },
    analysisDimensions: { width: analysisW, height: analysisH },
    scale: { scaleX, scaleY },
    usage,
    model,
    error: validationError,
    artifactPaths
  };
}

function sanitizeRawResponseForStorage(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  const clone = JSON.parse(JSON.stringify(raw));
  // Strip image_base64 from pages
  if (Array.isArray(clone.pages)) {
    for (const page of clone.pages) {
      if (Array.isArray(page.images)) {
        for (const img of page.images) {
          if (img.image_base64) delete img.image_base64;
          if (img.imageBase64) delete img.imageBase64;
        }
      }
    }
  }
  return clone;
}

export function extractAndNormalizeBlocks(
  rawResponse: any,
  pageNumber: number,
  origDim: { width: number; height: number },
  analysisDim: { width: number; height: number },
  scale: { scaleX: number; scaleY: number }
): NormalizedOcrBlock[] {
  const blocks: NormalizedOcrBlock[] = [];
  if (!rawResponse) return blocks;

  const pageObj = Array.isArray(rawResponse.pages) && rawResponse.pages.length > 0
    ? rawResponse.pages[0]
    : rawResponse;

  // 1. Direct blocks if available
  if (Array.isArray(pageObj.blocks)) {
    pageObj.blocks.forEach((blk: any, idx: number) => {
      const blkId = blk.id || `block_${pageNumber}_${idx + 1}`;
      const text = blk.text || blk.content || '';
      const rawBounds = blk.bounds || blk.bbox || {
        x: blk.x ?? blk.top_left_x ?? 0,
        y: blk.y ?? blk.top_left_y ?? 0,
        width: blk.width ?? ((blk.bottom_right_x ?? 0) - (blk.top_left_x ?? 0)),
        height: blk.height ?? ((blk.bottom_right_y ?? 0) - (blk.top_left_y ?? 0))
      };

      const mappedBounds = {
        x: Math.max(0, Math.min(origDim.width, Math.round(rawBounds.x * scale.scaleX))),
        y: Math.max(0, Math.min(origDim.height, Math.round(rawBounds.y * scale.scaleY))),
        width: Math.max(1, Math.min(origDim.width, Math.round(rawBounds.width * scale.scaleX))),
        height: Math.max(1, Math.min(origDim.height, Math.round(rawBounds.height * scale.scaleY)))
      };

      blocks.push({
        block_id: blkId,
        page_number: pageNumber,
        block_type: blk.type || blk.block_type || 'text',
        text,
        normalized_text: text.trim(),
        confidence: typeof blk.confidence === 'number' ? blk.confidence : null,
        bounds: rawBounds,
        source_dimensions: analysisDim,
        rendered_page_bounds: mappedBounds
      });
    });
  }

  // 2. Images as image blocks
  if (Array.isArray(pageObj.images)) {
    pageObj.images.forEach((img: any, idx: number) => {
      const imgId = img.id || `img_${pageNumber}_${idx + 1}`;
      const rawBounds = {
        x: img.top_left_x ?? 0,
        y: img.top_left_y ?? 0,
        width: (img.bottom_right_x ?? 0) - (img.top_left_x ?? 0),
        height: (img.bottom_right_y ?? 0) - (img.top_left_y ?? 0)
      };

      const mappedBounds = {
        x: Math.max(0, Math.min(origDim.width, Math.round(rawBounds.x * scale.scaleX))),
        y: Math.max(0, Math.min(origDim.height, Math.round(rawBounds.y * scale.scaleY))),
        width: Math.max(1, Math.min(origDim.width, Math.round(rawBounds.width * scale.scaleX))),
        height: Math.max(1, Math.min(origDim.height, Math.round(rawBounds.height * scale.scaleY)))
      };

      blocks.push({
        block_id: imgId,
        page_number: pageNumber,
        block_type: 'image',
        text: '',
        normalized_text: '',
        confidence: null,
        bounds: rawBounds,
        source_dimensions: analysisDim,
        rendered_page_bounds: mappedBounds
      });
    });
  }

  return blocks;
}
