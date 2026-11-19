import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import type { PageFirstRolloutMode, ExtractionMode } from '../../shared/types/pageFirstExtractionMode';
import type { PageFirstReportPageItem, PageFirstReportOfferItem, PageFirstExtractionReport } from '../../shared/types/pageFirstExtractionReport';
import type { CanonicalOffer } from '../../shared/types/canonicalOffer';
import { constructAutomaticOfferCrops } from './automaticOfferCropService';
import { linkOfferEvidenceToBlocks } from './evidenceLinkerService';
import { mapPageOfferToCanonical, mapRev1OfferToCanonical, TrustedLeafletContext } from './pageOfferCanonicalMapper';
import { sharedRev1PipelineService } from './rev1PipelineService';
import { createCostTracker, checkPrimaryPassBudget, calculateEstimatedCostUsd } from './pageFirstCostBudget';
import { generatePageFirstReport } from '../reporting/pageFirstReportService';
import { evaluateRuntimeAccuracy } from '../../shared/utils/runtimeAccuracyHarness';
import { loadExtractionManifest, saveExtractionManifest } from '../extraction/extractionManifestService';
import { buildPrePublishSummary } from '../prepublish/prePublishApprovalService';
import { info as logInfo, warn as logWarn, error as logError } from '../logging/logger';
import sharp from 'sharp';
import type { GeminiInferenceMode, GeminiJobUsageSummary, GeminiPageUsageReport } from '../ocr/geminiCacheTypes';
import { aggregateJobUsage, calculateGeminiCost } from '../ocr/geminiPricingTable';

export type PageFirstProgressEvent = {
  stage: 'initializing' | 'rendering' | 'ocr_running' | 'linking' | 'cropping' | 'validating' | 'retrying' | 'completed' | 'failed';
  currentPage: number;
  totalPages: number;
  primaryCompletedPages: number;
  retryCompletedPages: number;
  completedPages: number;
  unresolvedPages: number;
  failedPages?: number;
  offersDetected: number;
  offersLinked: number;
  cropsGenerated: number;
  estimatedCostUsd: number;
  elapsedMs: number;
  message: string;
  logCode?: string;
};

export type PageFirstLogEvent = {
  code: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  timestamp?: string;
};

export type PageFirstPageState = {
  pageNumber: number;
  status: 'not_started' | 'completed' | 'unresolved' | 'failed';
  passStatus: 'primary_completed' | 'retry_completed' | 'unresolved' | 'failed' | 'skipped';
  completenessStatus: string;
  offerCount: number;
  anchorCount: number;
  cropCount: number;
  updatedAt: string;
};

export type PageFirstPipelineInput = {
  packageDir: string;
  pdfPath?: string;
  pdfBaseName: string;
  pages?: number[]; // Specific pages or undefined for all
  trustedContext: TrustedLeafletContext;
  rolloutMode?: PageFirstRolloutMode;
  overrideModel?: string;
  maxOffers?: number; // Limit offers per page (Quick Test mode)
  promptProfile?: import('../../shared/schemas/leafletPageExtractionSchema').LeafletPromptProfile;
  schemaProfile?: import('../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaProfile;
  schemaVersion?: import('../../shared/schemas/leafletPageExtractionSchema').LeafletSchemaVersion;
  executionMode?: GeminiInferenceMode;
  forceReextract?: boolean;
  mockPageResponses?: Map<number, any>; // Offline mock responses
  onProgress?: (progress: PageFirstProgressEvent) => void;
  onLog?: (log: PageFirstLogEvent) => void;
};

export type PageFirstPipelineResult = {
  ok: boolean;
  extractionMode: ExtractionMode;
  rolloutMode: PageFirstRolloutMode;
  totalPages: number;
  completedPages: number;
  unresolvedPages: number;
  failedPages: number;
  offersDetected: number;
  offersLinked: number;
  cropsGenerated: number;
  estimatedCostUsd: number;
  report: PageFirstExtractionReport;
  items: CanonicalOffer[];
  geminiUsageSummary?: GeminiJobUsageSummary;
  error?: string;
};

export class PageFirstPipelineService {
  public async runPipeline(input: PageFirstPipelineInput): Promise<PageFirstPipelineResult> {
    const startTime = Date.now();
    const {
      packageDir,
      pdfBaseName,
      trustedContext,
      rolloutMode = 'pilot',
      overrideModel,
      maxOffers,
      promptProfile,
      schemaProfile,
      schemaVersion,
      executionMode = (process.env.GEMINI_EXECUTION_MODE as GeminiInferenceMode) || 'flex',
      forceReextract = false,
      mockPageResponses,
      onProgress
    } = input;

    const manifest = await loadExtractionManifest(packageDir);

    // Determine target pages
    const pagesDir = join(packageDir, 'pages');
    const availablePages: number[] = [];
    if (existsSync(pagesDir)) {
      const files = readdirSync(pagesDir);
      for (const f of files) {
        const m = f.match(/page[._-]?(\d+)\.(png|jpe?g|webp)$/i);
        if (m) availablePages.push(parseInt(m[1], 10));
      }
      availablePages.sort((a, b) => a - b);
    }

    const selectedFromManifest = manifest?.processing_selection?.selectedPages;
    const targetPages = (input.pages && input.pages.length > 0)
      ? Array.from(new Set(input.pages)).sort((a, b) => a - b)
      : (selectedFromManifest && selectedFromManifest.length > 0)
        ? selectedFromManifest.slice().sort((a, b) => a - b)
        : availablePages.length > 0
          ? availablePages
          : [1];

    // Budget Gate (Section 41)
    const costTracker = createCostTracker();
    const budgetCheck = checkPrimaryPassBudget(targetPages.length);
    if (!budgetCheck.allowed) {
      const errMsg = `BUDGET_EXCEEDED: ${budgetCheck.reason}`;
      throw new Error(errMsg);
    }

    // Load state
    const statePath = join(packageDir, 'metadata', 'page-first-ocr', 'page-state.json');
    let pageStateMap = new Map<number, PageFirstPageState>();
    if (existsSync(statePath)) {
      try {
        const rawStates: PageFirstPageState[] = JSON.parse(readFileSync(statePath, 'utf8'));
        rawStates.forEach(s => pageStateMap.set(s.pageNumber, s));
      } catch {
        // ignore
      }
    }

    const reportPages: PageFirstReportPageItem[] = [];
    const reportOffers: PageFirstReportOfferItem[] = [];
    const allCanonicalItems: CanonicalOffer[] = [];
    const geminiPageReports: GeminiPageUsageReport[] = [];

    let primaryCompleted = 0;
    let retryCompleted = 0;
    let totalCompleted = 0;
    let totalUnresolved = 0;
    let totalFailed = 0;
    let totalOffersDetected = 0;
    let totalOffersLinked = 0;
    let totalCropsGenerated = 0;

    const emitLog = (code: string, message: string, level: 'info' | 'warning' | 'error' = 'info') => {
      const formatted = `[PageFirstPipeline] [${code}] ${message}`;
      console.log(formatted);
      if (level === 'error') logError(formatted);
      else if (level === 'warning') logWarn(formatted);
      else logInfo(formatted);

      if (input.onLog) {
        input.onLog({
          code,
          message,
          level,
          timestamp: new Date().toISOString()
        });
      }
    };

    const emitProgress = (
      stage: PageFirstProgressEvent['stage'],
      currentPage: number,
      message: string,
      logCode?: string
    ) => {
      if (logCode) {
        emitLog(logCode, message, stage === 'failed' ? 'error' : 'info');
      }
      if (onProgress) {
        const runningEstimatedCost =
          geminiPageReports.length > 0
            ? Number(geminiPageReports.reduce((sum, r) => sum + (r.cost?.totalCostUsd || 0), 0).toFixed(8))
            : calculateEstimatedCostUsd(costTracker);
        onProgress({
          stage,
          currentPage,
          totalPages: targetPages.length,
          primaryCompletedPages: primaryCompleted,
          retryCompletedPages: retryCompleted,
          completedPages: totalCompleted,
          unresolvedPages: totalUnresolved,
          failedPages: totalFailed,
          offersDetected: totalOffersDetected,
          offersLinked: totalOffersLinked,
          cropsGenerated: totalCropsGenerated,
          estimatedCostUsd: runningEstimatedCost,
          elapsedMs: Date.now() - startTime,
          message,
          logCode
        });
      }
    };

    emitProgress('initializing', 0, 'Initializing page-first pipeline...');

    // Process pages sequentially
    for (const pageNumber of targetPages) {
      const pagePadded = String(pageNumber).padStart(3, '0');
      emitLog('PAGE_FIRST_TEST_START', `Starting page-first OCR pipeline for page ${pageNumber}`);

      const pageImagePath = this.resolvePageImagePath(packageDir, pageNumber);

      if (!existsSync(pageImagePath)) {
        const errorMsg = `page image missing for page ${pageNumber} at ${pageImagePath}`;
        totalFailed++;
        emitProgress('failed', pageNumber, errorMsg, 'MISTRAL_OCR_REQUEST_FAILED');
        reportPages.push({
          page_number: pageNumber,
          page_classification: 'unknown',
          structured_offer_count: 0,
          current_price_anchor_count: 0,
          linked_offer_count: 0,
          uncovered_anchor_count: 0,
          uncovered_anchor_block_ids: [],
          pass_status: 'failed',
          completeness_status: 'failed',
          crop_count: 0,
          unresolved_reason: errorMsg,
          pages_processed_usage: 0,
          estimated_cost_usd: 0,
          warnings: [errorMsg],
          blocking_issues: ['PAGE_IMAGE_MISSING']
        });
        throw new Error(errorMsg);
      }

      // Check if already completed and resumable (do not skip for single page test)
      const isSinglePageTest = targetPages.length === 1;
      const existingState = pageStateMap.get(pageNumber);
      if (!isSinglePageTest && existingState && existingState.status === 'completed' && !mockPageResponses) {
        emitLog('PAGE_FIRST_TEST_START', `Page ${pageNumber} already completed. Resuming...`);
        totalCompleted++;
        continue;
      }

      emitProgress('ocr_running', pageNumber, `Running rev1 extraction (Gemini 3.8 Flash High Thinking) for page ${pageNumber}...`);

      const outputDir = join(packageDir, 'metadata', 'rev1', `page-${pagePadded}`);

      let rev1Result: any;
      let pageUsageReports: GeminiPageUsageReport[] = [];
      if (mockPageResponses && mockPageResponses.has(pageNumber)) {
        const mockRaw = mockPageResponses.get(pageNumber);
        const rawOffers = mockRaw.offers || (mockRaw.document_annotation?.offers || []).map((o: any, idx: number) => ({
          offer_number: idx + 1,
          original_price: o.selected_prices?.original_price ?? null,
          promo_price: o.selected_prices?.offer_price ?? 0,
          unit_type: o.price_basis?.raw_text || 'each',
          english_title: o.product?.title_en || '',
          arabic_title: o.product?.title_ar || '',
          item_domain: o.product?.item_domain || 'grocery',
          size_value: o.content?.size_text || null,
          pack_quantity: o.content?.pack_quantity || null,
          each_size_value: o.content?.each_size_value || null,
          each_size_unit: o.content?.each_size_unit || null,
          is_uniform_size_across_variants: null,
          promo_condition: o.promotion?.mechanic === 'loyalty_required' ? 'LOYALTY_CARD_REQUIRED' : null,
          quantity_limit: null,
          components: {
            product_visual_box: [100, 100, 300, 300],
            promo_price_box: [100, 310, 200, 360]
          }
        }));

        const cropRectangles = (rawOffers || []).map((o: any) => ({
          offer_number: o.offer_number,
          union_box_px: { xmin: 50, ymin: 50, xmax: 350, ymax: 350, width: 300, height: 300 },
          product_thumb_box_px: { xmin: 50, ymin: 50, xmax: 350, ymax: 350, width: 300, height: 300 },
          offer_card_crop_path: null,
          product_thumb_crop_path: null
        }));

        if (Array.isArray(mockRaw.attemptUsageReports) && mockRaw.attemptUsageReports.length > 0) {
          pageUsageReports = mockRaw.attemptUsageReports;
        } else if (mockRaw.usageReport) {
          pageUsageReports = [mockRaw.usageReport];
        } else if (mockRaw.usageMetadata) {
          const mockModel = overrideModel || mockRaw.modelVersion || 'gemini-3.8-flash';
          const meta = mockRaw.usageMetadata;
          const usage = {
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
          };
          pageUsageReports = [
            {
              pageNumber,
              modelId: mockModel,
              modelVersion: mockRaw.modelVersion,
              requestedServiceTier: executionMode,
              actualServiceTier: executionMode,
              cacheHit: Boolean(mockRaw.cacheHit),
              requestDurationMs: 0,
              retriesCount: 0,
              usage,
              cost: mockRaw.cacheHit
                ? {
                    ...calculateGeminiCost(usage, mockModel, executionMode),
                    inputCostUsd: 0,
                    outputCostUsd: 0,
                    thinkingCostUsd: 0,
                    cachedInputCostUsd: 0,
                    totalCostUsd: 0
                  }
                : calculateGeminiCost(usage, mockModel, executionMode),
              fingerprintHash: 'mock-usage-report'
            }
          ];
        }

        rev1Result = {
          ok: true,
          pageNumber,
          pageMetadata: mockRaw.pageMetadata || {
            is_loyalty_page: Boolean(mockRaw.is_loyalty_page),
            loyalty_program_name: mockRaw.loyalty_program_name ?? null,
            validity_start_date: mockRaw.validity_start_date ?? null,
            validity_end_date: mockRaw.validity_end_date ?? null,
            ignored_banners: Array.isArray(mockRaw.ignored_banners) ? mockRaw.ignored_banners : []
          },
          nativeDimensions: { width: 400, height: 400 },
          offers: rawOffers.map((o: any) => ({ ...o, confidence: o.confidence ?? 0.95 })),
          cropRectangles,
          auditResult: {
            passed: true,
            page_confidence: 0.95,
            issues: [],
            total_offers: rawOffers.length,
            unresolved_retries: 0,
            suspect_regions: []
          },
          retryExecuted: Boolean(mockRaw.retryExecuted),
          exportedToActiveLearning: false,
          enqueuedExceptionsCount: 0,
          usageReport: pageUsageReports[0],
          attemptUsageReports: pageUsageReports
        };
      } else {
        try {
          rev1Result = await sharedRev1PipelineService.processPage({
            imagePath: pageImagePath,
            outputDir,
            pageNumber,
            overrideModel: overrideModel || 'gemini-3.8-flash',
            promptProfile,
            schemaProfile,
            schemaVersion,
            executionMode,
            forceReextract,
            onProgress: (stage, message) => {
              const mappedStage: PageFirstProgressEvent['stage'] =
                stage === 'stage_8_cropping' ? 'cropping' :
                stage === 'stage_5_audit' ? 'validating' :
                stage === 'stage_6_retry' ? 'retrying' : 'ocr_running';
              emitProgress(mappedStage, pageNumber, message);
            }
          });
          pageUsageReports =
            rev1Result.attemptUsageReports && rev1Result.attemptUsageReports.length > 0
              ? rev1Result.attemptUsageReports
              : rev1Result.usageReport
                ? [rev1Result.usageReport]
                : [];
        } catch (err: any) {
          totalFailed++;
          const errMsg = err.message || 'Gemini 3.8 Flash extraction failed';
          emitProgress('failed', pageNumber, errMsg, 'GEMINI_EXTRACTION_FAILED');
          reportPages.push({
            page_number: pageNumber,
            page_classification: 'unknown',
            structured_offer_count: 0,
            current_price_anchor_count: 0,
            linked_offer_count: 0,
            uncovered_anchor_count: 0,
            uncovered_anchor_block_ids: [],
            pass_status: 'failed',
            completeness_status: 'failed',
            crop_count: 0,
            unresolved_reason: errMsg,
            pages_processed_usage: 1,
            estimated_cost_usd: 0,
            is_cost_estimate: true,
            warnings: [errMsg],
            blocking_issues: ['FATAL_GEMINI_CALL_FAILURE']
          });
          throw err;
        }
      }

      if (pageUsageReports.length > 0) {
        geminiPageReports.push(...pageUsageReports);
      }

      primaryCompleted++;
      costTracker.primaryPageCalls++;
      const pageRetryAttempts = Math.max(
        rev1Result.retryExecuted ? 1 : 0,
        Math.max(0, pageUsageReports.length - 1)
      );
      if (rev1Result.retryExecuted || pageRetryAttempts > 0) {
        if (rev1Result.retryExecuted) {
          retryCompleted++;
        }
        costTracker.retryPageCalls += pageRetryAttempts;
      }

      // Quick Test mode limit if requested
      let offersToProcess = rev1Result.offers;
      if (maxOffers && maxOffers > 0 && offersToProcess.length > maxOffers) {
        const skipped = offersToProcess.length - maxOffers;
        emitLog('QUICK_TEST_LIMIT', `Quick Test mode: limiting to ${maxOffers} of ${offersToProcess.length} offers (${skipped} skipped)`);
        offersToProcess = offersToProcess.slice(0, maxOffers);
      }

      // Map rev1 offers to canonical offers
      emitProgress('cropping', pageNumber, `Mapping ${offersToProcess.length} offers to canonical structure...`);
      for (const off of offersToProcess) {
        const cropRect = rev1Result.cropRectangles.find(c => c.offer_number === off.offer_number)
          || rev1Result.cropRectangles[0]
          || {
            offer_number: off.offer_number,
            union_box_px: { xmin: 0, ymin: 0, xmax: rev1Result.nativeDimensions.width, ymax: rev1Result.nativeDimensions.height, width: rev1Result.nativeDimensions.width, height: rev1Result.nativeDimensions.height },
            product_thumb_box_px: { xmin: 0, ymin: 0, xmax: rev1Result.nativeDimensions.width, ymax: rev1Result.nativeDimensions.height, width: rev1Result.nativeDimensions.width, height: rev1Result.nativeDimensions.height },
            offer_card_crop_path: null,
            product_thumb_crop_path: null
          };

        const canonical = mapRev1OfferToCanonical({
          offer: off,
          cropRect,
          pageNumber,
          pdfBaseName,
          packageDir,
          trustedContext,
          rawMetadata: {
            rawOfferExtraction: off,
            auditResult: rev1Result.auditResult,
            retryExecuted: rev1Result.retryExecuted
          }
        });

        allCanonicalItems.push(canonical);

        // Persist canonical JSON in packageDir/json/
        const jsonDir = join(packageDir, 'json');
        if (!existsSync(jsonDir)) mkdirSync(jsonDir, { recursive: true });
        const canonicalFileName = `page-${pagePadded}-${canonical.source.source_item_number}.canonical.json`;
        writeFileSync(join(jsonDir, canonicalFileName), JSON.stringify(canonical, null, 2), 'utf8');

        const offerNumStr = String(off.offer_number).padStart(3, '0');
        const hasValidPriceBox = Boolean(
          off.components.promo_price_box &&
          off.components.promo_price_box[2] > off.components.promo_price_box[0] &&
          off.components.promo_price_box[3] > off.components.promo_price_box[1]
        );
        const anchorBlockId = hasValidPriceBox
          ? `rev1_price_anchor_p${pagePadded}_${offerNumStr}`
          : null;

        const activeLinkedBlocks: string[] = [];
        if (off.components.product_graphic_box) activeLinkedBlocks.push('product_graphic_box');
        if (off.components.promo_price_box) activeLinkedBlocks.push('promo_price_box');
        if (off.components.unit_and_size_badge_box) activeLinkedBlocks.push('unit_and_size_badge_box');
        if (off.components.title_text_box) activeLinkedBlocks.push('title_text_box');

        reportOffers.push({
          temporary_offer_id: `offer_${off.offer_number}`,
          source_item_number: canonical.source.source_item_number,
          source_offer_key: canonical.source.external_image_id || '',
          page_number: pageNumber,
          title_ar: off.arabic_title,
          title_en: off.english_title,
          offer_price: off.promo_price,
          original_price: off.original_price,
          size_text: off.size_value,
          current_price_anchor_block_id: anchorBlockId,
          linked_block_ids: activeLinkedBlocks,
          crop_path: cropRect.offer_card_crop_path || null,
          crop_strategy: 'evidence_union',
          crop_confidence: off.confidence,
          extraction_confidence: off.confidence >= 0.9 ? 'high' : 'medium',
          publish_decision: canonical.quality.publish_decision,
          warnings: canonical.quality.non_blocking_warnings.map(w => w.message)
        });
      }

      const passStatus: PageFirstReportPageItem['pass_status'] = rev1Result.auditResult.passed
        ? 'primary_completed'
        : rev1Result.retryExecuted
          ? 'retry_completed'
          : 'unresolved';

      if (passStatus === 'unresolved') {
        totalUnresolved++;
      } else {
        totalCompleted++;
      }

      totalOffersDetected += offersToProcess.length;
      totalOffersLinked += offersToProcess.length;
      totalCropsGenerated += rev1Result.cropRectangles.length;

      const pageMeasuredCostUsd = pageUsageReports.length > 0
        ? Number(pageUsageReports.reduce((sum, r) => sum + (r.cost?.totalCostUsd || 0), 0).toFixed(8))
        : Number(((1 + pageRetryAttempts) * costTracker.estimatedPricePerPage).toFixed(4));

      const pageTokenUsage = pageUsageReports.length > 0
        ? {
            prompt_tokens: pageUsageReports.reduce((s, r) => s + (r.usage?.promptTokenCount || 0), 0),
            candidates_tokens: pageUsageReports.reduce((s, r) => s + (r.usage?.candidatesTokenCount || 0), 0),
            thoughts_tokens: pageUsageReports.reduce((s, r) => s + (r.usage?.thoughtsTokenCount || 0), 0),
            cached_tokens: pageUsageReports.reduce((s, r) => s + (r.usage?.cachedContentTokenCount || 0), 0),
            total_tokens: pageUsageReports.reduce((s, r) => s + (r.usage?.totalTokenCount || 0), 0),
            cache_hit: pageUsageReports.every(r => r.cacheHit)
          }
        : undefined;

      reportPages.push({
        page_number: pageNumber,
        page_classification: rev1Result.pageMetadata.is_loyalty_page ? 'loyalty_page' : 'standard_promotional',
        structured_offer_count: offersToProcess.length,
        current_price_anchor_count: offersToProcess.length,
        linked_offer_count: offersToProcess.length,
        uncovered_anchor_count: 0,
        uncovered_anchor_block_ids: [],
        pass_status: passStatus,
        completeness_status: rev1Result.auditResult.passed ? 'pass' : 'unresolved',
        crop_count: rev1Result.cropRectangles.length,
        unresolved_reason: rev1Result.auditResult.passed ? null : rev1Result.auditResult.issues[0]?.message || null,
        pages_processed_usage: 1,
        estimated_cost_usd: pageMeasuredCostUsd,
        is_cost_estimate: true,
        ...(pageTokenUsage ? { token_usage: pageTokenUsage } : {}),
        warnings: rev1Result.auditResult.issues.filter(i => i.severity === 'warning').map(i => i.message),
        blocking_issues: rev1Result.auditResult.issues.filter(i => i.severity === 'error').map(i => i.message)
      });

      pageStateMap.set(pageNumber, {
        pageNumber,
        status: rev1Result.auditResult.passed ? 'completed' : 'unresolved',
        passStatus,
        completenessStatus: rev1Result.auditResult.passed ? 'pass' : 'unresolved',
        offerCount: offersToProcess.length,
        anchorCount: offersToProcess.length,
        cropCount: rev1Result.cropRectangles.length,
        updatedAt: new Date().toISOString()
      });

      // Persist page states atomically
      mkdirSync(join(packageDir, 'metadata', 'page-first-ocr'), { recursive: true });
      writeFileSync(statePath, JSON.stringify(Array.from(pageStateMap.values()), null, 2), 'utf8');
    }

    // Aggregate measured Gemini token consumption & reconciled USD estimate BEFORE generating report & manifest
    const geminiUsageSummary = geminiPageReports.length > 0
      ? aggregateJobUsage(geminiPageReports, targetPages.length)
      : undefined;
    const modelsUsed = geminiPageReports.length > 0
      ? Array.from(new Set(geminiPageReports.map(r => r.modelId).filter(Boolean)))
      : [];
    if (geminiUsageSummary && modelsUsed.length > 0) {
      geminiUsageSummary.modelsUsed = modelsUsed;
    }
    const authoritativeEstimatedCostUsd = geminiUsageSummary
      ? geminiUsageSummary.totalCostUsd
      : calculateEstimatedCostUsd(costTracker);

    emitProgress('completed', targetPages.length, 'Generating final extraction report and Pre-Publish Preview...');

    // Generate Final Reports (Section 46 & 47)
    const activeModel = overrideModel || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const report = generatePageFirstReport({
      packageDir,
      pdfBaseName,
      model: activeModel,
      rolloutMode,
      pages: reportPages,
      offers: reportOffers,
      startTime,
      costTracker,
      geminiUsageSummary
    });

    // Generate Pre-Publish Preview summary immediately (metadata/reports/pre-publish-preview-summary.json)
    try {
      await buildPrePublishSummary(packageDir, allCanonicalItems);
    } catch (e: any) {
      logWarn(`[PageFirstPipeline] Failed to build pre-publish summary: ${e.message}`);
    }

    emitLog('PAGE_FIRST_TEST_COMPLETE', `Page-first test completed for page(s) ${targetPages.join(', ')}`);
    emitProgress(
      'completed',
      targetPages.length,
      `Page-first extraction complete. Detected ${totalOffersDetected} offers, generated ${totalCropsGenerated} crops.`,
      'PAGE_FIRST_TEST_COMPLETE'
    );

    // Run Runtime Accuracy Harness (Section 44 & 45)
    evaluateRuntimeAccuracy({
      extractionPackagePath: packageDir,
      leafletId: trustedContext.leafletId,
      pageStyleProfileStatus: {
        mode: 'disabled',
        totalPagesWithCrops: targetPages.length,
        completedPages: targetPages.length,
        failedPages: 0,
        missingPages: [],
        failures: []
      },
      items: allCanonicalItems,
      context: {
        supermarketSlug: trustedContext.supermarketSlug || null,
        locationScope: trustedContext.locationScope,
        cityId: trustedContext.cityId,
        regionId: trustedContext.regionId,
        offerStartDate: trustedContext.offerStartDate,
        offerEndDate: trustedContext.offerEndDate
      },
      isDryRun: rolloutMode === 'pilot'
    });

    // Update Extraction Manifest (Section 43)
    if (manifest) {
      const totalDocPages = manifest.processing_selection?.totalDocumentPages || manifest.page_count || targetPages.length;
      const isSpecific = (manifest.processing_selection?.selectionMode === 'specific') || (targetPages.length < totalDocPages);

      manifest.processing_selection = {
        pdfFingerprint: manifest.processing_selection?.pdfFingerprint || '',
        totalDocumentPages: totalDocPages,
        selectionMode: isSpecific ? 'specific' : 'all',
        selectedPages: targetPages,
        processingStatus: totalFailed > 0 ? 'partial' : totalUnresolved > 0 ? 'partial' : 'completed',
        coverage: targetPages.length === totalDocPages ? 'full' : 'partial'
      };
      manifest.processing_scope = {
        mode: isSpecific ? 'selected_pages' : 'all_pages',
        pages: targetPages
      };
      manifest.extraction_mode = 'page_first_annotated_ocr';
      manifest.page_first_ocr = {
        status: totalUnresolved > 0 ? 'paused' : 'completed',
        rollout_mode: rolloutMode,
        model: activeModel,
        total_pages: targetPages.length,
        primary_completed_pages: primaryCompleted,
        retry_completed_pages: retryCompleted,
        completed_pages: totalCompleted,
        unresolved_pages: totalUnresolved,
        failed_pages: totalFailed,
        offers_detected: totalOffersDetected,
        offers_linked: totalOffersLinked,
        crops_generated: totalCropsGenerated,
        estimated_cost_usd: authoritativeEstimatedCostUsd,
        is_cost_estimate: true,
        budget_usd: costTracker.budgetUsd,
        ...(geminiUsageSummary
          ? {
              gemini_usage_summary: {
                api_calls_count: geminiUsageSummary.apiCallsCount,
                cache_hits_count: geminiUsageSummary.cacheHitsCount,
                retries_count: geminiUsageSummary.retriesCount,
                total_prompt_tokens: geminiUsageSummary.totalPromptTokens,
                total_candidates_tokens: geminiUsageSummary.totalCandidatesTokens,
                total_thoughts_tokens: geminiUsageSummary.totalThoughtsTokens,
                total_cached_tokens: geminiUsageSummary.totalCachedTokens,
                total_tokens: geminiUsageSummary.totalTokens,
                total_cost_usd: geminiUsageSummary.totalCostUsd,
                is_estimate: true,
                models_used: geminiUsageSummary.modelsUsed || [activeModel]
              }
            }
          : {}),
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        page_state_path: 'metadata/page-first-ocr/page-state.json',
        report_path: 'metadata/reports/page-first-extraction-report.json'
      };
      await saveExtractionManifest(packageDir, manifest);
    }

    return {
      ok: totalFailed === 0 && totalUnresolved === 0,
      extractionMode: 'page_first_annotated_ocr',
      rolloutMode,
      totalPages: targetPages.length,
      completedPages: totalCompleted,
      unresolvedPages: totalUnresolved,
      failedPages: totalFailed,
      offersDetected: totalOffersDetected,
      offersLinked: totalOffersLinked,
      cropsGenerated: totalCropsGenerated,
      estimatedCostUsd: authoritativeEstimatedCostUsd,
      report,
      items: allCanonicalItems,
      geminiUsageSummary
    };
  }

  public resolvePageImagePath(packageDir: string, pageNumber: number): string {
    const pagesDir = join(packageDir, 'pages');
    const pagePadded = String(pageNumber).padStart(3, '0');
    const extensions = ['png', 'jpg', 'jpeg', 'webp'];

    // 1. Check workspace metadata.json if renderedPages lists this page
    const metaPath = join(packageDir, 'metadata', 'metadata.json');
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        const matched = meta.renderedPages?.find((p: any) => p.pageNumber === pageNumber);
        if (matched?.imagePath && existsSync(matched.imagePath)) {
          return matched.imagePath;
        }
      } catch {}
    }

    // 2. Candidate filenames in pages/
    const candidates = [
      ...extensions.map(ext => join(pagesDir, `page-${pagePadded}.${ext}`)),
      ...extensions.map(ext => join(pagesDir, `page-${pageNumber}.${ext}`)),
      ...extensions.map(ext => join(pagesDir, `page.${pageNumber}.${ext}`)),
      ...extensions.map(ext => join(pagesDir, `page.${pagePadded}.${ext}`)),
      ...extensions.map(ext => join(pagesDir, `page_${pageNumber}.${ext}`)),
      ...extensions.map(ext => join(pagesDir, `page_${pagePadded}.${ext}`)),
      ...extensions.map(ext => join(pagesDir, `page${pageNumber}.${ext}`))
    ];

    for (const c of candidates) {
      if (existsSync(c)) return c;
    }

    // 3. Scan directory files with regex
    if (existsSync(pagesDir)) {
      try {
        const files = readdirSync(pagesDir);
        const regex = new RegExp(`^page[._-]?0*${pageNumber}\\.(png|jpe?g|webp)$`, 'i');
        const found = files.find(f => regex.test(f));
        if (found) {
          return join(pagesDir, found);
        }
      } catch {}
    }

    return join(pagesDir, `page-${pagePadded}.png`);
  }

  /**
   * Rebuilds crops from existing OCR artifacts without calling Mistral (Section 37)
   */
  public async rebuildCropsFromExistingOcr(
    packageDir: string,
    pdfBaseName: string,
    trustedContext: TrustedLeafletContext,
    pages?: number[]
  ): Promise<CanonicalOffer[]> {
    const baseOcrDir = join(packageDir, 'metadata', 'page-first-ocr');
    if (!existsSync(baseOcrDir)) return [];

    const targetPages = pages && pages.length > 0 ? pages : [1];
    const canonicalItems: CanonicalOffer[] = [];

    for (const pageNum of targetPages) {
      const pagePadded = String(pageNum).padStart(3, '0');
      const pageDir = join(baseOcrDir, `page-${pagePadded}`);
      const annotationPath = join(pageDir, 'annotation.json');
      const blocksPath = join(pageDir, 'blocks.json');
      const pageImagePath = this.resolvePageImagePath(packageDir, pageNum);

      if (!existsSync(annotationPath) || !existsSync(blocksPath) || !existsSync(pageImagePath)) {
        continue;
      }

      const annotation = JSON.parse(readFileSync(annotationPath, 'utf8'));
      const blocks = JSON.parse(readFileSync(blocksPath, 'utf8'));

      const imgMeta = await sharp(pageImagePath).metadata();
      const pageDimensions = { width: imgMeta.width || 1200, height: imgMeta.height || 1800 };

      const links = linkOfferEvidenceToBlocks(annotation.offers || [], blocks, { pageDimensions });
      const cropResult = await constructAutomaticOfferCrops({
        pdfBaseName,
        pageNumber: pageNum,
        renderedImagePath: pageImagePath,
        packageDir,
        pageDimensions,
        offers: annotation.offers || [],
        blocks,
        links
      });

      for (const off of annotation.offers || []) {
        const link = links.find(l => l.temporary_offer_id === off.temporary_offer_id) || links[0];
        const crop = cropResult.crops.find(c => c.current_price_anchor_block_id === link?.current_price_anchor_block_id) || cropResult.crops[0];
        const cropPath = crop ? cropResult.cropFilePaths.get(crop.source_item_number) || null : null;

        const canonical = mapPageOfferToCanonical({
          offer: off,
          crop,
          link,
          cropFilePath: cropPath,
          pageNumber: pageNum,
          pdfBaseName,
          packageDir,
          trustedContext,
          rawMetadata: {
            rawAnnotationJson: annotation,
            completenessStatus: 'pass'
          }
        });
        canonicalItems.push(canonical);
      }
    }

    return canonicalItems;
  }
}

export const sharedPageFirstPipelineService = new PageFirstPipelineService();

export function resolvePageImagePath(packageDir: string, pageNumber: number): string {
  return sharedPageFirstPipelineService.resolvePageImagePath(packageDir, pageNumber);
}
