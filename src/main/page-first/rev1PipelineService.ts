import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  ExtractedOfferRev1,
  LeafletPageExtractionRev1,
  OfferCropRectangles,
  Stage5AuditResult
} from '../../shared/types/leafletExtraction';
import {
  GeminiExtractionService,
  sharedGeminiExtractionService
} from '../ocr/geminiExtractionService';
import {
  computeOfferUnionAndThumbBoxes,
  cropAndSaveOfferAssets
} from './spatialUnionAndClampingService';
import { runStage5CompletenessAudit } from './rev1CompletenessAuditService';
import { getNativeDimensions } from '../image/nativeResolutionService';
import { sharedActiveLearningExporter } from '../ml/activeLearningExporter';
import { sharedExceptionsQueueService } from '../ml/exceptionsQueueService';
import { sharedSkuMemoryService } from './skuMemoryService';
import { sharedTrainingOrchestrator } from '../ml/trainingOrchestrator';

export type Rev1PageProcessInput = {
  imagePath: string;
  outputDir: string;
  pageNumber?: number;
  overrideModel?: string;
  onProgress?: (stage: string, message: string) => void;
};

export type Rev1PageProcessResult = {
  ok: boolean;
  pageNumber: number;
  pageMetadata: {
    is_loyalty_page: boolean;
    loyalty_program_name: string | null;
    validity_start_date: string | null;
    validity_end_date: string | null;
    ignored_banners: string[];
  };
  nativeDimensions: { width: number; height: number };
  offers: ExtractedOfferRev1[];
  cropRectangles: OfferCropRectangles[];
  auditResult: Stage5AuditResult;
  retryExecuted: boolean;
  exportedToActiveLearning: boolean;
  enqueuedExceptionsCount: number;
  error?: string;
};

export class Rev1PipelineService {
  private geminiService: GeminiExtractionService;

  constructor(geminiService?: GeminiExtractionService) {
    this.geminiService = geminiService || sharedGeminiExtractionService;
  }

  /**
   * Runs the complete rev1 extraction pipeline on a leaflet page image.
   * 100% live API execution using Gemini 3.8 Flash.
   */
  async processPage(input: Rev1PageProcessInput): Promise<Rev1PageProcessResult> {
    const { imagePath, outputDir, pageNumber = 1, overrideModel, onProgress } = input;

    if (!existsSync(imagePath)) {
      throw new Error(`FILE_NOT_FOUND: Image path does not exist: ${imagePath}`);
    }

    mkdirSync(outputDir, { recursive: true });

    // Stage 1: Dual-Stream Native Resolution Preservation
    onProgress?.('stage_1_native_res', 'Preserving native resolution image dimensions...');
    const nativeDims = await getNativeDimensions(imagePath);

    // Stage 3: Multimodal Extraction via Gemini 3.8 Flash High Thinking
    onProgress?.('stage_3_extraction', 'Extracting offers and atomic 2D boxes with Gemini 3.8 Flash...');
    let extraction: LeafletPageExtractionRev1 = await this.geminiService.extractLeafletPage({
      imagePath,
      pageNumber,
      overrideModel
    });

    // Stage 4: Deterministic Union Box & Voronoi Neighbor-Bleed Clamping
    onProgress?.('stage_4_union_box', 'Calculating deterministic union boxes and Voronoi midpoint clamping...');
    let cropRects = computeOfferUnionAndThumbBoxes(extraction.offers, nativeDims.width, nativeDims.height);

    // Stage 5: Spatial & Price Completeness Audit
    onProgress?.('stage_5_audit', 'Running Stage 5 Spatial & Price Completeness Audit...');
    let auditResult = runStage5CompletenessAudit(extraction, nativeDims.width, nativeDims.height);
    let retryExecuted = false;

    // Stage 6 & 7: Native-Resolution Targeted Retry & Reconciliation (if audit failed)
    if (!auditResult.passed && auditResult.suspect_regions.length > 0) {
      onProgress?.('stage_6_retry', 'Stage 5 Audit flagged issues. Executing Stage 6 Native-Res Diagnostic Retry with Gemini 4 Argon...');
      try {
        const failureReasons = auditResult.issues.map(iss => iss.message);
        const retryResult = await this.geminiService.extractLeafletPage({
          imagePath,
          pageNumber,
          isDiagnosticRetry: true,
          failureReasons
        });

        // Reconcile offers: Merge and re-normalize
        if (retryResult.offers.length > 0) {
          extraction.offers = retryResult.offers;
          cropRects = computeOfferUnionAndThumbBoxes(extraction.offers, nativeDims.width, nativeDims.height);
          auditResult = runStage5CompletenessAudit(extraction, nativeDims.width, nativeDims.height);
          retryExecuted = true;
        }
      } catch (err: any) {
        console.warn(`[Rev1Pipeline] Diagnostic retry failed: ${err.message}`);
      }
    }

    // Stage 8: Native-Resolution Dual-Asset Cropping & SKU Memory Auto-Correction
    onProgress?.('stage_8_cropping', 'Cropping dual assets (offer_card_crop and product_thumb_crop) at full native resolution...');
    const croppedAssetsDir = join(outputDir, 'crops');
    const savedCrops = await cropAndSaveOfferAssets(
      imagePath,
      cropRects,
      croppedAssetsDir,
      nativeDims.width,
      nativeDims.height
    );

    // Auto-correct with SKU Memory
    extraction.offers = extraction.offers.map(offer => {
      const { correctedOffer } = sharedSkuMemoryService.autoCorrectOfferWithSkuMemory(offer);
      return correctedOffer;
    });

    // Stage 9A: Confidence-Gated Active Learning Export (if audit passed with confidence >= 0.95)
    let exportedToActiveLearning = false;
    if (auditResult.passed && auditResult.page_confidence >= 0.95) {
      onProgress?.('stage_9_active_learning', 'Page verified. Exporting to YOLO training pool...');
      const exportRes = sharedActiveLearningExporter.exportPageIfEligible(
        imagePath,
        extraction,
        auditResult,
        { pageId: `page_${pageNumber}_${Date.now()}` }
      );
      exportedToActiveLearning = exportRes.exported;

      // Stage 10: Record verified page in TrainingOrchestrator
      sharedTrainingOrchestrator.recordVerifiedPage();
    }

    // Stage 9B: Route remaining anomalies to Exceptions Queue
    let enqueuedExceptionsCount = 0;
    if (!auditResult.passed) {
      onProgress?.('stage_9_exceptions', 'Routing unverified offers to Electron Exceptions Queue...');
      for (const issue of auditResult.issues) {
        if (issue.offer_number) {
          const offer = extraction.offers.find(o => o.offer_number === issue.offer_number);
          if (offer) {
            sharedExceptionsQueueService.enqueueException(pageNumber, imagePath, offer, [issue]);
            enqueuedExceptionsCount++;
          }
        }
      }
    }

    onProgress?.('completed', `Page ${pageNumber} processing complete.`);

    return {
      ok: true,
      pageNumber,
      pageMetadata: {
        is_loyalty_page: extraction.is_loyalty_page,
        loyalty_program_name: extraction.loyalty_program_name,
        validity_start_date: extraction.validity_start_date,
        validity_end_date: extraction.validity_end_date,
        ignored_banners: extraction.ignored_banners
      },
      nativeDimensions: nativeDims,
      offers: extraction.offers,
      cropRectangles: savedCrops,
      auditResult,
      retryExecuted,
      exportedToActiveLearning,
      enqueuedExceptionsCount
    };
  }
}

export const sharedRev1PipelineService = new Rev1PipelineService();
