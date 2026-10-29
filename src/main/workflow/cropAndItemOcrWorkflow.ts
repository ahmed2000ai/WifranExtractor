import path from 'path'
import fs from 'fs'
import { ManualCropPageLayout } from '../../shared/types/manualCrop'
import { ReviewItem } from '../../shared/types/itemOcr'
import {
  CropAndItemOcrWorkflowInput,
  CropAndItemOcrWorkflowResult,
  CropAndItemOcrProgressEvent,
  PreDbReviewSummaryJson,
  PreDbReviewItemsJson,
  LayoutValidationResult
} from '../../shared/types/reviewWorkflow'
import { cropManualPageLayout } from '../image/manualCropService'
import { loadEnvConfig } from '../config/env'
import { info, error as logError, warn } from '../logging/logger'
import { markExtractionCompleted } from '../extraction/extractionManifestService'
import { ocrSingleItemImage } from '../ocr/itemImageOcrService'
import { ocrReturnedKeysDiscoveryService } from '../ocr/ocrReturnedKeysDiscoveryService'
import { mistralRateLimitQueue } from '../ocr/mistralRateLimitQueue'
// ── Layout Validation ───────────────────────────────────────────────────────

export function validateManualLayouts(layouts: ManualCropPageLayout[]): LayoutValidationResult {
  const issues: { pageNumber: number; message: string }[] = []

  if (layouts.length === 0) {
    issues.push({ pageNumber: 0, message: 'No page layouts exist.' })
    return { ok: false, issues }
  }

  for (const layout of layouts) {
    if (!layout) {
      issues.push({ pageNumber: 0, message: 'A page layout is null or undefined.' })
      continue
    }

    const included = layout.boxes.filter(b => b.included)

    if (included.length === 0) {
      issues.push({ pageNumber: layout.pageNumber, message: `Page ${layout.pageNumber} has no included boxes.` })
    }

    // Check minimum size
    for (const box of included) {
      if (box.width < 10 || box.height < 10) {
        issues.push({ pageNumber: layout.pageNumber, message: `Page ${layout.pageNumber} item ${box.itemNumber} is too small (${Math.round(box.width)}x${Math.round(box.height)}).` })
      }
      // Bounds check
      if (box.x < 0 || box.y < 0 || box.x + box.width > layout.pageWidth + 2 || box.y + box.height > layout.pageHeight + 2) {
        issues.push({ pageNumber: layout.pageNumber, message: `Page ${layout.pageNumber} item ${box.itemNumber} is outside page bounds.` })
      }
    }

    // Check item numbers present and unique
    const itemNumbers = included.map(b => b.itemNumber)
    const missingNumbers = itemNumbers.filter(n => !n || n.trim() === '')
    if (missingNumbers.length > 0) {
      issues.push({ pageNumber: layout.pageNumber, message: `Page ${layout.pageNumber} has ${missingNumbers.length} boxes with missing item numbers.` })
    }

    const uniqueNumbers = new Set(itemNumbers.filter(n => n && n.trim() !== ''))
    if (uniqueNumbers.size < itemNumbers.filter(n => n && n.trim() !== '').length) {
      issues.push({ pageNumber: layout.pageNumber, message: `Page ${layout.pageNumber} has duplicate item numbers.` })
    }
  }

  return { ok: issues.length === 0, issues }
}

// ── Producer/Consumer Workflow ──────────────────────────────────────────────

type CropJob = {
  pageNumber: number;
  itemNumber: string;
  localImagePath: string;
  cropBox: { x: number; y: number; width: number; height: number };
};

export async function runCropAndItemOcrWorkflow(
  input: CropAndItemOcrWorkflowInput,
  onProgress?: (event: CropAndItemOcrProgressEvent) => void
): Promise<CropAndItemOcrWorkflowResult> {
  const config = loadEnvConfig()
  const minDelayMs = Math.max(1000, config.ocr.minRequestIntervalMs || 1100)

  const emit = (event: CropAndItemOcrProgressEvent) => {
    info(`[Workflow] ${event.stage}: ${event.message}`)
    onProgress?.(event)
  }

  emit({ stage: 'started', message: 'Manual crop + item OCR workflow started.' })

  // 1. Validate layouts
  emit({ stage: 'validating_layouts', message: 'Validating manual crop layouts...' })
  const validation = validateManualLayouts(input.layouts)
  if (!validation.ok) {
    const msgs = validation.issues.map(i => i.message).join(' ')
    emit({ stage: 'failed', message: `Layout validation failed: ${msgs}` })
    return {
      ok: false,
      totalPages: input.layouts.length,
      totalCrops: 0,
      totalOcrCompleted: 0,
      totalOcrFailed: 0,
      reviewItems: [],
      reviewSummaryPath: '',
      reviewItemsPath: '',
      cropFolderPath: '',
      returnedKeysRegistryPath: path.join(input.workspacePath, 'ocr_returned_keys.json'),
      keysWithoutValuesPath: path.join(input.workspacePath, 'ocr_keys_without_values.json'),
    }
  }

  // 1b. Check Review Queue
  try {
    const { detectorReviewQueueService } = await import('../ml/detectorReviewQueueService')
    const queue = detectorReviewQueueService.getQueue(input.workspacePath)
    if (queue) {
      const unresolved = queue.entries.filter(e => e.status !== 'resolved')
      if (unresolved.length > 0) {
        emit({ stage: 'failed', message: `Cannot start extraction. There are ${unresolved.length} pages requiring manual review.` })
        return {
          ok: false,
          totalPages: input.layouts.length,
          totalCrops: 0,
          totalOcrCompleted: 0,
          totalOcrFailed: 0,
          reviewItems: [],
          reviewSummaryPath: '',
          reviewItemsPath: '',
          cropFolderPath: '',
          returnedKeysRegistryPath: path.join(input.workspacePath, 'ocr_returned_keys.json'),
          keysWithoutValuesPath: path.join(input.workspacePath, 'ocr_keys_without_values.json'),
          error: `Cannot start extraction. There are ${unresolved.length} pages requiring manual review.`
        }
      }
    }
  } catch (err: any) {
    logError(`Error checking review queue: ${err.message}`)
  }

  const cropFolderPath = path.join(input.workspacePath, 'crops')
  const reviewDir = path.join(input.workspacePath, 'review')

  const getJsonPath = (workspacePath: string, localImagePath: string): string => {
    const fileName = path.basename(localImagePath, path.extname(localImagePath)) + '.json'
    const pageDirName = path.basename(path.dirname(localImagePath))
    return path.join(workspacePath, 'json', pageDirName, fileName)
  }

  // Shared queue between producer (cropper) and consumer (OCR)
  const cropQueue: CropJob[] = []
  let croppingDone = false
  const reviewItems: ReviewItem[] = []
  let totalCrops = 0
  let totalOcrCompleted = 0
  let totalOcrFailed = 0

  const pageProfilesCache = new Map<number, any>()
  const failedPageProfiles = new Set<number>()

  // 2. Start crop producer (runs in background via promise)
  const cropProducerPromise = (async () => {
    emit({ stage: 'cropping_started', message: 'Starting local crop image generation...' })

    let cropIndex = 0
    // Count total expected crops
    const totalExpected = input.layouts.reduce((sum, l) => sum + l.boxes.filter(b => b.included).length, 0)

    let pdfBaseName = 'doc'
    try {
      const sessionPath = path.join(input.workspacePath, 'manual-crop-layout.json')
      if (fs.existsSync(sessionPath)) {
        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
        if (session.pdfPath) {
          pdfBaseName = path.basename(session.pdfPath, path.extname(session.pdfPath)).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
        }
      }
    } catch (e) { logError(`Could not get pdfBaseName: ${e}`) }

    for (const layout of input.layouts) {
      const pageDir = path.join(cropFolderPath, `page-${String(layout.pageNumber).padStart(3, '0')}`)
      const includedBoxes = layout.boxes.filter(b => b.included)
      
      let isFresh = layout.cropStatus === 'ready' && layout.cropInfo && layout.cropInfo.generatedCropCount === includedBoxes.length
      
      if (isFresh && layout.cropInfo) {
        // verify files exist
        for (const cf of layout.cropInfo.cropFiles) {
          if (!fs.existsSync(cf.localImagePath)) {
            isFresh = false
            break
          }
          const jsonPath = getJsonPath(input.workspacePath, cf.localImagePath)
          if (!fs.existsSync(jsonPath)) {
            isFresh = false
            break
          }
        }
      }

      if (isFresh && layout.cropInfo) {
        emit({ stage: 'cropping_started', message: `Using fresh existing crops for page ${layout.pageNumber}` })
        for (const crop of layout.cropInfo.cropFiles) {
          cropIndex++
          totalCrops++
          cropQueue.push({
            pageNumber: crop.pageNumber,
            itemNumber: crop.itemNumber,
            localImagePath: crop.localImagePath,
            cropBox: { x: crop.x, y: crop.y, width: crop.width, height: crop.height }
          })
          emit({
            stage: 'crop_completed',
            message: `Reused crop page ${crop.pageNumber} item ${crop.itemNumber}`,
            pageNumber: crop.pageNumber,
            itemNumber: crop.itemNumber,
            currentCrop: cropIndex,
            totalCrops: totalExpected,
            localImagePath: crop.localImagePath
          })
        }
        continue
      }

      try {
        // Clear page dir if we need to regenerate to avoid stale extra files
        if (fs.existsSync(pageDir)) {
          fs.rmSync(pageDir, { recursive: true, force: true })
        }

        const result = await cropManualPageLayout({
          layout,
          outputDir: pageDir,
          imageFormat: input.imageFormat,
          quality: input.imageQuality,
          pdfBaseName
        })

        if (!result.ok) {
          emit({
            stage: 'crop_failed',
            message: `Crop failed for page ${layout.pageNumber}: ${result.error?.message || 'Unknown error'}`,
            pageNumber: layout.pageNumber
          })
          // Record failed crops as review items with pending status (won't be OCR'd)
          for (const box of includedBoxes) {
            reviewItems.push({
              pageNumber: layout.pageNumber,
              itemNumber: box.itemNumber,
              localImagePath: '',
              cropBox: { x: box.x, y: box.y, width: box.width, height: box.height },
              ocr: null,
              ocrStatus: 'failed',
              ocrError: { code: 'CROP_FAILED', message: result.error?.message || 'Crop generation failed' }
            })
          }
          continue
        }

        for (const crop of result.croppedImages) {
          cropIndex++
          totalCrops++

          const job: CropJob = {
            pageNumber: crop.pageNumber,
            itemNumber: crop.itemNumber,
            localImagePath: crop.cropPath,
            cropBox: { x: crop.x, y: crop.y, width: crop.width, height: crop.height }
          }
          cropQueue.push(job)

          emit({
            stage: 'crop_completed',
            message: `Cropped page ${crop.pageNumber} item ${crop.itemNumber}`,
            pageNumber: crop.pageNumber,
            itemNumber: crop.itemNumber,
            currentCrop: cropIndex,
            totalCrops: totalExpected,
            localImagePath: crop.cropPath
          })
        }
      } catch (err: any) {
        logError(`Crop error for page ${layout.pageNumber}: ${err.message}`)
        emit({
          stage: 'crop_failed',
          message: `Crop exception for page ${layout.pageNumber}: ${err.message}`,
          pageNumber: layout.pageNumber
        })
      }
    }

    croppingDone = true
    info(`[Workflow] Crop producer finished. ${totalCrops} crop images created.`)
  })()

  // 3. Start OCR consumer (processes jobs as they appear)
  const ocrConsumerPromise = (async () => {
    let ocrIndex = 0
    let lastOcrTime = 0

    // Wait for at least one job or for cropping to finish
    while (!croppingDone || cropQueue.length > 0) {
      if (cropQueue.length === 0) {
        // Spin wait — check every 100ms
        await new Promise(r => setTimeout(r, 100))
        continue
      }

      const job = cropQueue.shift()!
      ocrIndex++

      // Create pending review item
      const reviewItem: ReviewItem = {
        pageNumber: job.pageNumber,
        itemNumber: job.itemNumber,
        localImagePath: job.localImagePath,
        cropBox: job.cropBox,
        ocr: null,
        ocrStatus: 'running',
        ocrError: null
      }

      emit({
        stage: 'ocr_started',
        message: `OCR started for page ${job.pageNumber} item ${job.itemNumber}`,
        pageNumber: job.pageNumber,
        itemNumber: job.itemNumber,
        currentOcr: ocrIndex,
        totalOcr: totalCrops
      })

      // Enforce minimum delay between OCR calls
      const now = Date.now()
      const elapsed = now - lastOcrTime
      if (lastOcrTime > 0 && elapsed < minDelayMs) {
        const waitMs = minDelayMs - elapsed
        emit({
          stage: 'ocr_waiting_rate_limit',
          message: `Waiting ${(waitMs / 1000).toFixed(1)}s before next Mistral OCR request.`,
          waitMs,
          pageNumber: job.pageNumber,
          itemNumber: job.itemNumber
        })
        await new Promise(r => setTimeout(r, waitMs))
      }

      const jsonPath = getJsonPath(input.workspacePath, job.localImagePath)
      
      let ocrData: Record<string, unknown> | null = null
      let ocrErrorStr = ''

      if (fs.existsSync(jsonPath)) {
        try {
          ocrData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
        } catch (e) {
          // Fallback to API if JSON is corrupt
        }
      }

      if (!ocrData) {
        lastOcrTime = Date.now()
        try {
          // 1. Run API
          const ocrResult = await ocrSingleItemImage({
            localImagePath: job.localImagePath,
            itemNumber: job.itemNumber,
            pageNumber: job.pageNumber
          })

          if (ocrResult.ok && ocrResult.ocr) {
            // 2. Load Registry
            // 3. Update Registry
            await ocrReturnedKeysDiscoveryService.updateRegistry(input.workspacePath, jsonPath, ocrResult.ocr)

            const jsonDir = path.dirname(jsonPath)
            if (!fs.existsSync(jsonDir)) {
              fs.mkdirSync(jsonDir, { recursive: true })
            }
            fs.writeFileSync(jsonPath, JSON.stringify(ocrResult.ocr, null, 2))
            
            ocrData = ocrResult.ocr
          } else {
            ocrErrorStr = ocrResult.error?.message || 'OCR returned no data'
          }
        } catch (err: any) {
          ocrErrorStr = err.message
        }
      }

      if (ocrData) {
        reviewItem.ocr = ocrData
        reviewItem.ocrStatus = 'completed'
        totalOcrCompleted++

        // Try to get name for display
        const nameAr = typeof ocrData.product_name_ar === 'string' ? ocrData.product_name_ar : null
        const nameEn = typeof ocrData.product_name_en === 'string' ? ocrData.product_name_en : null

        emit({
          stage: 'ocr_completed',
          message: `OCR completed for page ${job.pageNumber} item ${job.itemNumber}: ${nameAr || nameEn || '(no name)'}`,
          pageNumber: job.pageNumber,
          itemNumber: job.itemNumber,
          currentOcr: ocrIndex,
          totalOcr: totalCrops
        })

        // -- Canonical Normalization & Validation --
        try {
          const { normalizeToCanonicalOffer } = require('../../shared/utils/canonicalOfferNormalizer')
          const canonical = normalizeToCanonicalOffer({
            rawOcrJson: ocrData,
            source: {
              sourceItemNumber: job.itemNumber,
              sourcePageNumber: job.pageNumber,
              crop_path: job.localImagePath,
              json_path: jsonPath
            }
          })

          // Attempt to load or generate page-level style profile
          let styleProfile: any = null
          const mode = process.env.PAGE_STYLE_PROFILE_MODE || 'all_pages'
          
          if (mode !== 'disabled') {
            if (pageProfilesCache.has(job.pageNumber)) {
              styleProfile = pageProfilesCache.get(job.pageNumber)
            } else if (!failedPageProfiles.has(job.pageNumber)) {
              try {
                // Find page image
                const paddedPage = String(job.pageNumber).padStart(3, '0')
                const pageImgPath = require('path').join(input.workspacePath, 'pages', `page-${paddedPage}.png`)
                
                if (fs.existsSync(pageImgPath)) {
                  emit({
                    stage: 'ocr_completed', // Not perfect but to show progress
                    message: `Loading/generating page style profile for page ${job.pageNumber}...`,
                    pageNumber: job.pageNumber,
                    itemNumber: job.itemNumber
                  })
                  
                  const { loadExtractionManifest } = require('../extraction/extractionManifestService')
                  const manifest = await loadExtractionManifest(input.workspacePath)
                  
                  const { loadOrGeneratePageStyleProfile } = require('../ocr/pageStyleProfileService')
                  const profile = await loadOrGeneratePageStyleProfile({
                    leafletId: manifest?.location?.leaflet_id || null,
                    pageNumber: job.pageNumber,
                    pageImagePath: pageImgPath,
                    extractionPackagePath: input.workspacePath
                  })
                  if (profile) {
                    pageProfilesCache.set(job.pageNumber, profile)
                    styleProfile = profile
                  } else {
                    failedPageProfiles.add(job.pageNumber)
                  }
                } else {
                  failedPageProfiles.add(job.pageNumber)
                  warn(`Page image not found for style profiling: ${pageImgPath}`)
                }
              } catch (e: any) {
                failedPageProfiles.add(job.pageNumber)
                warn(`Failed to get page style profile for page ${job.pageNumber}: ${e.message}`)
              }
            }
          }

          // Run validation
          const { validateItemWithStyleAwareness } = require('../ocr/styleAwareItemValidationService')
          const validationResult = await validateItemWithStyleAwareness({
            sourcePageNumber: job.pageNumber,
            sourceItemNumber: job.itemNumber,
            cropPath: job.localImagePath,
            rawExtractionJson: ocrData,
            canonicalDraft: canonical,
            styleProfile,
            extractionPackagePath: input.workspacePath
          })

          if (validationResult) {
            canonical.style_validation.validation_result = validationResult.validation_result
            canonical.style_validation.visual_evidence = validationResult.visual_evidence
            canonical.style_validation.corrected_fields = validationResult.corrected_fields
            canonical.style_validation.style_profile_scope = styleProfile ? styleProfile.scope : 'none'
            canonical.raw.raw_validation_json = validationResult.raw_model_response
            canonical.quality.validation_confidence = validationResult.confidence
            canonical.quality.blocking_errors.push(...validationResult.blocking_errors)
            canonical.quality.non_blocking_warnings.push(...validationResult.non_blocking_warnings)
          } else {
            canonical.style_validation.validation_result = process.env.VALIDATE_EVERY_ITEM === 'false' ? 'not_run' : 'fail'
            if (process.env.VALIDATE_EVERY_ITEM !== 'false') {
              canonical.quality.blocking_errors.push({ code: 'style_validation_failed', message: 'Style validation failed', severity: 'error' })
            }
          }

          // Run Deterministic Checks
          const { runDeterministicOfferChecks, applyDeterministicCheckResultToCanonicalOffer } = require('../../shared/utils/deterministicOfferChecks')
          const checks = runDeterministicOfferChecks({ canonicalOffer: canonical })
          applyDeterministicCheckResultToCanonicalOffer(canonical, checks)

          // Run Comparison Safety
          const { evaluateComparisonSafety, applyComparisonSafetyToCanonicalOffer } = require('../../shared/utils/comparisonSafety')
          const compResult = evaluateComparisonSafety({ canonicalOffer: canonical })
          applyComparisonSafetyToCanonicalOffer(canonical, compResult)

          // Run Publish Decision Engine
          const { decidePublishAction, applyPublishDecisionToCanonicalOffer } = require('../../shared/utils/publishDecisionEngine')
          const decisionResult = decidePublishAction({ canonicalOffer: canonical, comparisonResult: compResult })
          applyPublishDecisionToCanonicalOffer(canonical, decisionResult)

          reviewItem.canonical = canonical

          // Save Canonical JSON side-by-side with raw JSON
          const canonicalPath = jsonPath.replace('.json', '.canonical.json')
          fs.writeFileSync(canonicalPath, JSON.stringify(canonical, null, 2))
          
        } catch (e: any) {
          logError(`Validation/Deterministic integration failed for page ${job.pageNumber} item ${job.itemNumber}: ${e.message}`)
        }
      } else {
        reviewItem.ocrStatus = 'failed'
        reviewItem.ocrError = { code: 'OCR_FAILED', message: ocrErrorStr }
        totalOcrFailed++

        emit({
          stage: 'ocr_failed',
          message: `OCR failed for page ${job.pageNumber} item ${job.itemNumber}: ${ocrErrorStr}`,
          pageNumber: job.pageNumber,
          itemNumber: job.itemNumber,
          currentOcr: ocrIndex,
          totalOcr: totalCrops
        })
      }

      reviewItems.push(reviewItem)
    }

    info(`[Workflow] OCR consumer finished. Completed: ${totalOcrCompleted}, Failed: ${totalOcrFailed}`)
  })()

  // 4. Wait for both producer and consumer to finish
  await Promise.all([cropProducerPromise, ocrConsumerPromise])

  // 5. Write local review package
  emit({ stage: 'writing_review_package', message: 'Writing local review package...' })

  if (!fs.existsSync(reviewDir)) {
    fs.mkdirSync(reviewDir, { recursive: true })
  }

  // Build per-page summary
  const pageMap = new Map<number, { crop_count: number; ocr_completed: number; ocr_failed: number }>()
  for (const item of reviewItems) {
    if (!pageMap.has(item.pageNumber)) {
      pageMap.set(item.pageNumber, { crop_count: 0, ocr_completed: 0, ocr_failed: 0 })
    }
    const p = pageMap.get(item.pageNumber)!
    p.crop_count++
    if (item.ocrStatus === 'completed') p.ocr_completed++
    if (item.ocrStatus === 'failed') p.ocr_failed++
  }

  const reviewSummary: PreDbReviewSummaryJson = {
    total_pages: input.layouts.length,
    total_crops: totalCrops,
    total_ocr_completed: totalOcrCompleted,
    total_ocr_failed: totalOcrFailed,
    pages: Array.from(pageMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([page_number, stats]) => ({ page_number, ...stats }))
  }

  const reviewItemsJson: PreDbReviewItemsJson = {
    items: reviewItems.map(ri => ({
      page_number: ri.pageNumber,
      item_number: ri.itemNumber,
      local_image_path: ri.localImagePath,
      crop_box: ri.cropBox,
      ocr_status: ri.ocrStatus,
      ocr: ri.ocr,
      ocr_error: ri.ocrError || null,
      canonical: ri.canonical || null
    }))
  }

  const summaryPath = path.join(reviewDir, 'pre-db-review-summary.json')
  const itemsPath = path.join(reviewDir, 'pre-db-review-items.json')

  fs.writeFileSync(summaryPath, JSON.stringify(reviewSummary, null, 2), 'utf-8')
  fs.writeFileSync(itemsPath, JSON.stringify(reviewItemsJson, null, 2), 'utf-8')

  info(`[Workflow] Review package written to ${reviewDir}`)

  const finalStage = totalOcrFailed > 0 && totalOcrCompleted > 0 ? 'partially_completed' : totalOcrCompleted > 0 ? 'completed' : 'failed'

  emit({
    stage: finalStage,
    message: `Workflow ${finalStage}. ${totalCrops} crops, ${totalOcrCompleted} OCR completed, ${totalOcrFailed} OCR failed. Ready for operator review before DB update.`
  })

  if (totalOcrCompleted > 0) {
    try {
      await markExtractionCompleted(input.workspacePath)
      info(`[Workflow] Marked extraction manifest as completed for ${input.workspacePath}`)
      
      // Generate Accuracy Run Report
      const { buildAccuracyRunReport, writeAccuracyRunReport } = require('../reporting/accuracyRunReportService');
      const canonicalOffers = reviewItems.filter(ri => ri.canonical).map(ri => ri.canonical);
      const queueSummary = mistralRateLimitQueue.getQueueSummary();
      
      const mode = process.env.PAGE_STYLE_PROFILE_MODE || 'all_pages'
      if (mode !== 'disabled') {
        const { updateExtractionManifest } = require('../extraction/extractionManifestService')
        const failures = Array.from(failedPageProfiles).map(fp => ({ page_number: fp, message: 'Failed to generate profile' }))
        await updateExtractionManifest(input.workspacePath, {
          page_style_profiles: {
            mode: 'all_pages',
            status: failedPageProfiles.size === 0 ? 'completed' : pageProfilesCache.size > 0 ? 'completed_with_warnings' : 'failed',
            total_pages: input.layouts.length,
            completed_pages: pageProfilesCache.size,
            failed_pages: failedPageProfiles.size,
            profile_dir: 'metadata/style-profiles',
            started_at: null,
            completed_at: new Date().toISOString(),
            failures
          }
        })
      }

      const report = await buildAccuracyRunReport({
        extractionPackagePath: input.workspacePath,
        canonicalItems: canonicalOffers,
        queueSummary
      });
      await writeAccuracyRunReport({
        extractionPackagePath: input.workspacePath,
        report
      });
      info(`[Workflow] Accuracy run report generated successfully.`);

      // Run Runtime Accuracy Harness
      try {
        const { runRuntimeAccuracyHarness } = require('../accuracy/runtimeAccuracyHarnessService');
        const harnessResult = await runRuntimeAccuracyHarness(input.workspacePath);
        info(`[Workflow] Runtime accuracy harness completed with decision: ${harnessResult.decision}`);
      } catch (harnessErr: any) {
        logError(`[Workflow] Runtime accuracy harness failed: ${harnessErr.message}`);
      }

    } catch (err: any) {
      logError(`Failed to mark extraction completed or generate reports: ${err.message}`)
    }
  }

  return {
    ok: totalOcrCompleted > 0,
    totalPages: input.layouts.length,
    totalCrops,
    totalOcrCompleted,
    totalOcrFailed,
    reviewItems,
    reviewSummaryPath: summaryPath,
    reviewItemsPath: itemsPath,
    cropFolderPath,
    returnedKeysRegistryPath: path.join(input.workspacePath, 'ocr_returned_keys.json'),
    keysWithoutValuesPath: path.join(input.workspacePath, 'ocr_keys_without_values.json')
  }
}
