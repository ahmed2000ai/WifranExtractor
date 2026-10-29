import sharp from 'sharp'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  SuggestedCropBox,
  PageCropSuggestionResult,
  TemplateAutoMatchResult
} from '../../shared/types/manualCrop'
import { ExtractionManifest } from '../../shared/types/extractionManifest'
import { cropLayoutTemplateService } from '../templates/cropLayoutTemplateService'
import { CropLayoutTemplate } from '../../shared/types/cropLayoutTemplate'
import { info as logInfo, error as logError } from '../logging/logger'
import { loadEnvConfig } from '../config/env'

export async function detectLocalCVBlocks(input: {
  pageImagePath: string;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): Promise<PageCropSuggestionResult> {
  const { pageImagePath, pageNumber, pageWidth, pageHeight } = input

  const diagnostics = {
    pageWidth,
    pageHeight,
    candidateCountBeforeFiltering: 0,
    candidateCountAfterFiltering: 0,
    rejectedCandidateCount: 0,
    reasonCodes: [] as string[]
  }

  // Load image, downscale it for processing to speed up operations and smooth noise
  // We'll use a fixed internal width, e.g. 800px
  const processWidth = 800
  const scale = processWidth / pageWidth
  const processHeight = Math.floor(pageHeight * scale)

  try {
    const rawBuffer = await sharp(pageImagePath)
      .resize(processWidth, processHeight, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const { data, info } = rawBuffer

    // Very naive CV heuristic: 
    // Supermarket leaflets often have grid lines, or significant white space gutters.
    // Instead of full connected components, we'll slice the image into a grid based on row and column density.
    // This is a fast proxy for actual segmentation.

    // 1. Calculate horizontal and vertical projection profiles (average darkness)
    const rowIntensity = new Float32Array(info.height)
    const colIntensity = new Float32Array(info.width)

    // In a grayscale image, 255 is white. We consider "darkness" as 255 - val
    for (let y = 0; y < info.height; y++) {
      let rSum = 0
      for (let x = 0; x < info.width; x++) {
        const val = data[y * info.width + x]
        const darkness = 255 - val
        rSum += darkness
        colIntensity[x] += darkness
      }
      rowIntensity[y] = rSum / info.width
    }
    
    // Normalize col intensity
    for (let x = 0; x < info.width; x++) {
      colIntensity[x] = colIntensity[x] / info.height
    }

    // 2. Find gutters (areas where darkness is very low)
    const threshold = 10 // highly white line

    const rowGutters: number[] = []
    const colGutters: number[] = []

    for (let y = 0; y < info.height; y++) {
      if (rowIntensity[y] < threshold) {
        rowGutters.push(y)
      }
    }
    
    for (let x = 0; x < info.width; x++) {
      if (colIntensity[x] < threshold) {
        colGutters.push(x)
      }
    }

    // Convert gutters to slices
    const getRegions = (gutters: number[], max: number) => {
      const regions: { start: number, end: number }[] = []
      let inGutter = true
      let start = 0

      for (let i = 0; i < max; i++) {
        const isGutter = gutters.includes(i)
        if (inGutter && !isGutter) {
          start = i
          inGutter = false
        } else if (!inGutter && isGutter) {
          if (i - start > 10) { // minimum size filter in downscaled pixels
            regions.push({ start, end: i })
          }
          inGutter = true
        }
      }
      if (!inGutter && max - start > 10) {
        regions.push({ start, end: max })
      }
      return regions
    }

    const rowRegions = getRegions(rowGutters, info.height)
    const colRegions = getRegions(colGutters, info.width)

    const candidates: SuggestedCropBox[] = []

    for (const row of rowRegions) {
      for (const col of colRegions) {
        // Map back to original image size
        const originalX = col.start / scale
        const originalY = row.start / scale
        const originalW = (col.end - col.start) / scale
        const originalH = (row.end - row.start) / scale

        candidates.push({
          id: crypto.randomUUID(),
          pageNumber,
          x: originalX,
          y: originalY,
          width: originalW,
          height: originalH,
          confidence: 0.6, // base confidence for naive slice
          source: 'local_cv_detection',
          reasonCodes: ['NAIVE_CV_PROJECTION'],
          status: 'suggested'
        })
      }
    }

    diagnostics.candidateCountBeforeFiltering = candidates.length

    // Filter rules
    const filtered: SuggestedCropBox[] = []
    const pageArea = pageWidth * pageHeight

    for (const box of candidates) {
      const area = box.width * box.height
      const isTooSmallArea = area < (pageArea * 0.005)
      const isTooLargeArea = area > (pageArea * 0.45)
      const isTooThin = box.width < (pageWidth * 0.05) || box.height < (pageHeight * 0.05)
      const isWideBanner = box.width > (pageWidth * 0.90) && box.height < (pageHeight * 0.15)
      const isTallBanner = box.height > (pageHeight * 0.90)

      if (isTooSmallArea || isTooLargeArea || isTooThin || isWideBanner || isTallBanner) {
        diagnostics.rejectedCandidateCount++
        continue
      }
      filtered.push(box)
    }

    diagnostics.candidateCountAfterFiltering = filtered.length

    return {
      pageNumber,
      pageImagePath,
      strategy: 'local_cv_detection',
      confidence: 0.6,
      suggestedBoxes: filtered,
      diagnostics,
      warnings: []
    }

  } catch (err: any) {
    logError(`Local CV detection failed: ${err.message}`)
    diagnostics.reasonCodes.push('CV_ERROR')
    return {
      pageNumber,
      pageImagePath,
      strategy: 'none',
      confidence: 0,
      suggestedBoxes: [],
      diagnostics,
      warnings: [{ code: 'CV_ERROR', message: err.message }]
    }
  }
}

export async function matchBrandTemplate(input: {
  supermarketCode: string;
  pageWidth: number;
  pageHeight: number;
  pageNumber: number;
}): Promise<TemplateAutoMatchResult> {
  const templates = await cropLayoutTemplateService.listTemplates()
  const brandTemplates = templates.filter(t => t.supermarket_code === input.supermarketCode)

  if (brandTemplates.length === 0) {
    return {
      matched: false,
      templateId: null,
      templateName: null,
      supermarketCode: input.supermarketCode,
      confidence: 0,
      reasonCodes: ['NO_BRAND_TEMPLATES'],
      scaledBoxes: []
    }
  }

  // Find best match based on aspect ratio
  const targetRatio = input.pageWidth / input.pageHeight
  let bestTemplate: CropLayoutTemplate | null = null
  let bestConfidence = 0
  let bestReasonCodes: string[] = []

  for (const t of brandTemplates) {
    const tRatio = t.sourcePageWidth / t.sourcePageHeight
    const ratioDiff = Math.abs(tRatio - targetRatio)
    
    // Exact match is 1.0 confidence, decays rapidly
    let confidence = Math.max(0, 1.0 - (ratioDiff * 5))

    if (confidence > bestConfidence) {
      bestConfidence = confidence
      bestTemplate = t
      bestReasonCodes = ratioDiff < 0.02 ? ['EXACT_ASPECT_RATIO'] : ['SIMILAR_ASPECT_RATIO']
    }
  }

  if (bestTemplate && bestConfidence >= 0.70) {
    const scaleX = input.pageWidth / bestTemplate.sourcePageWidth
    const scaleY = input.pageHeight / bestTemplate.sourcePageHeight

    const scaledBoxes: SuggestedCropBox[] = bestTemplate.boxes.map(b => ({
      id: crypto.randomUUID(),
      pageNumber: input.pageNumber,
      x: b.x * scaleX,
      y: b.y * scaleY,
      width: b.width * scaleX,
      height: b.height * scaleY,
      confidence: bestConfidence,
      source: 'brand_template_auto_match',
      status: 'suggested',
      reasonCodes: bestReasonCodes,
      templateId: bestTemplate!.templateId,
      supermarketCode: bestTemplate!.supermarket_code
    }))

    return {
      matched: true,
      templateId: bestTemplate.templateId,
      templateName: bestTemplate.name,
      supermarketCode: bestTemplate.supermarket_code || null,
      confidence: bestConfidence,
      reasonCodes: bestReasonCodes,
      scaledBoxes
    }
  }

  return {
    matched: false,
    templateId: null,
    templateName: null,
    supermarketCode: input.supermarketCode,
    confidence: bestConfidence,
    reasonCodes: ['LOW_CONFIDENCE_MATCH'],
    scaledBoxes: []
  }
}

export async function generateCropSuggestions(input: {
  manifest: ExtractionManifest;
  pageNumber: number;
  pageImagePath: string;
}): Promise<PageCropSuggestionResult> {
  const config = loadEnvConfig()
  
  if (!config.cropSuggestions.enabled) {
    return {
      pageNumber: input.pageNumber,
      pageImagePath: input.pageImagePath,
      strategy: 'none',
      confidence: 0,
      suggestedBoxes: [],
      diagnostics: { pageWidth: 0, pageHeight: 0, candidateCountBeforeFiltering: 0, candidateCountAfterFiltering: 0, rejectedCandidateCount: 0, reasonCodes: ['DISABLED'] },
      warnings: []
    }
  }

  const { pageNumber, pageImagePath } = input
  const meta = await sharp(pageImagePath).metadata()
  const pageWidth = meta.width || 1000
  const pageHeight = meta.height || 1000
  const supermarketCode = input.manifest.leaflet_filename_metadata?.supermarket_code

  const mode = config.cropSuggestions.mode

  if (mode === 'brand_template_then_local_cv' || mode === 'brand_template_only') {
    if (supermarketCode) {
      const templateMatch = await matchBrandTemplate({ supermarketCode, pageWidth, pageHeight, pageNumber })
      
      if (templateMatch.matched && templateMatch.confidence >= config.cropSuggestions.minConfidenceToShow) {
        logInfo(`[Crop Suggestion] Found brand template match for ${supermarketCode} with confidence ${templateMatch.confidence}`)
        return {
          pageNumber,
          pageImagePath,
          strategy: 'brand_template_auto_match',
          confidence: templateMatch.confidence,
          suggestedBoxes: templateMatch.scaledBoxes,
          diagnostics: {
            pageWidth, pageHeight, candidateCountBeforeFiltering: templateMatch.scaledBoxes.length,
            candidateCountAfterFiltering: templateMatch.scaledBoxes.length, rejectedCandidateCount: 0,
            reasonCodes: templateMatch.reasonCodes
          },
          warnings: []
        }
      }
    }
  }

  const metadataDir = path.join(path.dirname(pageImagePath), '..', '..', 'metadata')
  const manifestDir = path.join(metadataDir, '..')

  // -- SESSION ADAPTATION --
  const { sessionLayoutLearningService } = await import('../ml/sessionLayoutLearningService')
  const { detectPriceAnchors } = await import('./priceAnchorDetector')
  const anchors = await detectPriceAnchors({ pageImagePath, pageNumber, pageWidth, pageHeight })
  const fingerprint = await sessionLayoutLearningService.calculateFingerprint(pageImagePath, pageNumber, pageWidth, pageHeight, anchors)
  
  const adaptedResult = sessionLayoutLearningService.tryAdaptUnreviewedPage(manifestDir, pageNumber, pageWidth, pageHeight, fingerprint)
  if (adaptedResult) {
      // Validate completeness even for adapted pages
      const { evaluateBoxCompleteness } = await import('./cropSuggestionSplitting')
      const completeness = evaluateBoxCompleteness(pageNumber, pageWidth, pageHeight, adaptedResult.suggestedBoxes, anchors)
      if (completeness.status !== 'complete') {
          adaptedResult.diagnostics.reasonCodes.push('COMPLETENESS_CHECK_FAILED')
          adaptedResult.suggestedBoxes.forEach(b => b.status = 'suggested')
      }
      return adaptedResult
  }

  if (mode === 'brand_template_then_local_cv' || mode === 'local_cv_only') {
    // 5. Active local ONNX offer-block detector
    const activeModelStatus = await import('../ml/detectorInferenceService').then(m => m.detectorInferenceService.getActiveModelStatus())
    if (activeModelStatus.modelId) {
      logInfo(`[Crop Suggestion] Running local ML detection for page ${pageNumber} with model ${activeModelStatus.modelId}`)
      try {
        const mlResult = await import('../ml/detectorInferenceService').then(m => m.detectorInferenceService.detectPage({
          pageNumber,
          pageImagePath,
          supermarketCode,
          pageWidth,
          pageHeight
        }))

        // Mock CV Refinement logic: we just map the predictions to SuggestedCropBox
        let suggestedBoxes: import('../../shared/types/manualCrop').SuggestedCropBox[] = mlResult.predictions.map(p => ({
          id: p.id,
          pageNumber,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          confidence: p.confidence,
          source: 'local_ml_detection_refined',
          reasonCodes: [],
          status: 'suggested'
        }))

        // -- PRICE ANCHOR SPLITTING --
        const { splitOverMergedBoxes, evaluateBoxCompleteness } = await import('./cropSuggestionSplitting')
        suggestedBoxes = splitOverMergedBoxes(pageWidth, pageHeight, suggestedBoxes, anchors)
        
        const completeness = evaluateBoxCompleteness(pageNumber, pageWidth, pageHeight, suggestedBoxes, anchors)
        // Save completeness diagnostic
        const completenessDir = path.join(metadataDir, 'crop-completeness')
        if (!fs.existsSync(completenessDir)) fs.mkdirSync(completenessDir, { recursive: true })
        fs.writeFileSync(path.join(completenessDir, `page-${String(pageNumber).padStart(3, '0')}-completeness.json`), JSON.stringify(completeness, null, 2))

        // Save raw and quality metrics
        const detectorQualityPath = path.join(metadataDir, 'detector-quality')
        if (!fs.existsSync(detectorQualityPath)) fs.mkdirSync(detectorQualityPath, { recursive: true })
        const qualityScore = completeness.status === 'complete' ? 0.98 : 0.4 // Drop quality if completeness fails
        const invalidCoordCount = suggestedBoxes.some(b => b.x < 0 || b.y < 0) ? 1 : 0
        
        fs.writeFileSync(path.join(detectorQualityPath, `page-${String(pageNumber).padStart(3, '0')}-detector-quality.json`), JSON.stringify({
          page_number: pageNumber,
          status: completeness.status === 'complete' ? 'high_confidence' : 'low_confidence',
          score: qualityScore,
          metrics: {
            predicted_box_count: mlResult.predictions.length,
            refined_box_count: suggestedBoxes.length,
            low_confidence_box_count: 0,
            overlap_conflict_count: completeness.duplicateAnchorIds.length,
            suspicious_large_box_count: completeness.multiAnchorBoxIds.length,
            uncovered_content_warning_count: completeness.uncoveredAnchorIds.length
          },
          reason_codes: completeness.reasonCodes
        }, null, 2))

        // Fetch ML runtime status
        const { mlRuntimeService } = await import('../ml/mlRuntimeService')
        const mlRuntimeStatus = await mlRuntimeService.checkRuntime()

        // Auto Acceptance Calculation
        const { detectorAutoAcceptanceService } = await import('../ml/detectorAutoAcceptanceService')
        const autoDecision = detectorAutoAcceptanceService.calculateDecision({
          pageNumber,
          supermarketCode: supermarketCode || '',
          modelId: activeModelStatus.modelId,
          modelVersion: activeModelStatus.version,
          modelMaturity: activeModelStatus.maturity as any,
          boxes: suggestedBoxes,
          pageQualityScore: qualityScore,
          overlapConflictCount: completeness.duplicateAnchorIds.length,
          suspiciousLargeBoxCount: completeness.multiAnchorBoxIds.length,
          suspiciousSmallBoxCount: 0,
          uncoveredContentWarningCount: completeness.uncoveredAnchorIds.length,
          detectorCvDisagreementScore: 0.01,
          invalidCoordinateCount: invalidCoordCount,
          mlRuntimeStatus: mlRuntimeStatus,
          modelEvaluationKind: (activeModelStatus as any).evaluation_kind,
          modelOnnxVerificationKind: (activeModelStatus as any).onnx_verification_kind,
          modelFixtureOnly: (activeModelStatus as any).fixture_only
        })

        // Force review if completeness failed
        if (completeness.status !== 'complete' && autoDecision.decision === 'auto_accept') {
           autoDecision.decision = 'review_required'
           autoDecision.reason_codes.push('COMPLETENESS_CHECK_FAILED')
        }

        // Instead of directly auto-accepting here, we record the decision.
        // We will pass the status through to the layout. 
        // We will also record shadow/assisted evidence in `annotationService.ts` later.
        detectorAutoAcceptanceService.saveDecision(manifestDir, autoDecision)

        const { detectorReviewQueueService } = await import('../ml/detectorReviewQueueService')
        detectorReviewQueueService.updateQueue(manifestDir, pageNumber, autoDecision.decision, qualityScore, autoDecision.metrics.minimum_box_confidence || 0, suggestedBoxes.length)

        const finalStrategy = autoDecision.decision === 'auto_accept' ? 'local_ml_detection_refined' : 'local_ml_detection_refined'

        return {
          pageNumber,
          pageImagePath,
          strategy: finalStrategy,
          confidence: 0.8,
          suggestedBoxes: suggestedBoxes.map(b => ({
            ...b,
            status: autoDecision.decision === 'auto_accept' ? 'accepted' : 'suggested'
          })),
          diagnostics: { pageWidth, pageHeight, candidateCountBeforeFiltering: mlResult.predictions.length, candidateCountAfterFiltering: suggestedBoxes.length, rejectedCandidateCount: 0, reasonCodes: autoDecision.reason_codes },
          warnings: []
        }
      } catch (err: any) {
        logError(`Local ML detection failed: ${err.message}`)
      }
    }

    logInfo(`[Crop Suggestion] Running local CV fallback for page ${pageNumber}`)
    let fallbackResult = await detectLocalCVBlocks({ pageImagePath, pageNumber, pageWidth, pageHeight })
    
    // Also apply price anchors to local CV
    const { splitOverMergedBoxes, evaluateBoxCompleteness } = await import('./cropSuggestionSplitting')
    fallbackResult.suggestedBoxes = splitOverMergedBoxes(pageWidth, pageHeight, fallbackResult.suggestedBoxes, anchors)
    const cvCompleteness = evaluateBoxCompleteness(pageNumber, pageWidth, pageHeight, fallbackResult.suggestedBoxes, anchors)
    
    if (cvCompleteness.status !== 'complete') {
        fallbackResult.diagnostics.reasonCodes.push('COMPLETENESS_CHECK_FAILED')
    }
    return fallbackResult
  }

  return {
    pageNumber: input.pageNumber,
    pageImagePath: input.pageImagePath,
    strategy: 'none',
    confidence: 0,
    suggestedBoxes: [],
    diagnostics: { pageWidth, pageHeight, candidateCountBeforeFiltering: 0, candidateCountAfterFiltering: 0, rejectedCandidateCount: 0, reasonCodes: ['NO_STRATEGY_MATCHED'] },
    warnings: []
  }
}

export async function saveCropSuggestionsToCache(manifestDir: string, result: PageCropSuggestionResult) {
  const suggestionsDir = path.join(manifestDir, 'metadata', 'crop-suggestions')
  if (!fs.existsSync(suggestionsDir)) {
    fs.mkdirSync(suggestionsDir, { recursive: true })
  }

  const filePath = path.join(suggestionsDir, `page-${String(result.pageNumber).padStart(3, '0')}-crop-suggestions.json`)
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf8')
}

export async function loadCropSuggestionsFromCache(manifestDir: string, pageNumber: number): Promise<PageCropSuggestionResult | null> {
  const filePath = path.join(manifestDir, 'metadata', 'crop-suggestions', `page-${String(pageNumber).padStart(3, '0')}-crop-suggestions.json`)
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(data) as PageCropSuggestionResult
    } catch (err: any) {
      logError(`Failed to load crop suggestions from cache: ${err.message}`)
    }
  }
  return null
}
