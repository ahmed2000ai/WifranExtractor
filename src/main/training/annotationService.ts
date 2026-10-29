import * as fs from 'fs'
import * as path from 'path'
import { error as logError } from '../logging/logger'
import { ManualCropPageLayout } from '../../shared/types/manualCrop'

export type OfferBlockTrainingAnnotation = {
  schema_version: 1;

  annotation_id: string;
  created_at: string;
  updated_at: string;

  image: {
    source_page_image_path: string;
    training_image_path: string;
    width: number;
    height: number;
    page_number: number;
  };

  source: {
    leaflet_file_name: string;
    leaflet_id?: string | null;
    supermarket_code: string;
    supermarket_description?: string | null;
    location_code?: string | null;
    promotion_start_date?: string | null;
  };

  prediction: {
    strategy:
      | 'brand_template_auto_match'
      | 'local_cv_detection'
      | 'none'
      | 'operator_manual';
    overall_confidence: number | null;
    original_boxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      confidence?: number | null;
    }>;
  };

  confirmed: {
    boxes: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      class_name: 'offer_block';
    }>;

    confirmed_by: 'operator';
    confirmation_type:
      | 'accepted_without_changes'
      | 'corrected_detection'
      | 'manual_layout';

    added_box_count: number;
    removed_box_count: number;
    moved_or_resized_box_count: number;
  };

  quality: {
    eligible_for_training: boolean;
    exclusion_reasons: string[];
  };
};

export class AnnotationService {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(process.cwd(), 'training-data', 'offer-block-detector')
  }

  private ensureDirectories() {
    const dirs = ['images', 'annotations', 'predictions', 'metadata', 'splits', 'negative_examples', 'history']
    for (const dir of dirs) {
      const p = path.join(this.baseDir, dir)
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true })
      }
    }
  }

  public bootstrapEmptyDataset() {
    this.ensureDirectories()
    const indexPath = path.join(this.baseDir, 'dataset-index.json')
    if (!fs.existsSync(indexPath)) {
      const indexData = {
        schema_version: 1,
        updated_at: new Date().toISOString(),
        total_annotations: 0,
        training_eligible_annotations: 0,
        negative_examples: 0,
        supermarkets: {}
      }
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8')
    }
  }

  public async saveAnnotationFromLayout(
    layout: ManualCropPageLayout,
    sourceMetadata: {
      leafletFileName: string;
      supermarketCode: string;
      supermarketDescription?: string;
      leafletId?: string;
      locationCode?: string;
      promotionStartDate?: string;
    }
  ): Promise<{ success: boolean; error?: string; isNegative: boolean }> {
    try {
      if (!sourceMetadata.supermarketCode) {
        return { success: false, error: 'supermarketCode is missing', isNegative: false }
      }

      this.bootstrapEmptyDataset()

      const leafletBase = path.parse(sourceMetadata.leafletFileName).name
      const pageStr = String(layout.pageNumber).padStart(3, '0')
      let annotationId = `${sourceMetadata.supermarketCode}-${leafletBase}-page-${pageStr}`
      // ensure no double prefix if leaflet starts with code
      if (leafletBase.startsWith(sourceMetadata.supermarketCode)) {
        annotationId = `${leafletBase}-page-${pageStr}`
      }

      const isNegative = layout.boxes.length === 0
      const excludedReasons: string[] = []

      if (!layout.pageImagePath || !fs.existsSync(layout.pageImagePath)) {
        excludedReasons.push('page_image_missing')
      }
      if (layout.pageWidth <= 0 || layout.pageHeight <= 0) {
        excludedReasons.push('invalid_dimensions')
      }
      if (!layout.pageComplete) {
        excludedReasons.push('page_not_confirmed')
      }

      for (const box of layout.boxes) {
        if (!box.included) continue
        if (box.width <= 0 || box.height <= 0) excludedReasons.push('invalid_box_size')
        if (box.x < 0 || box.y < 0 || box.x + box.width > layout.pageWidth || box.y + box.height > layout.pageHeight) {
          excludedReasons.push('box_out_of_bounds')
        }
      }

      const eligible = !isNegative && excludedReasons.length === 0

      // Copy image
      const imageExt = path.extname(layout.pageImagePath) || '.webp'
      const trainingImagePath = path.join(this.baseDir, 'images', `${annotationId}${imageExt}`)
      if (fs.existsSync(layout.pageImagePath)) {
        fs.copyFileSync(layout.pageImagePath, trainingImagePath)
      }

      const originalSuggested = layout.suggestedBoxes || []
      const strategy = originalSuggested.length > 0 ? (originalSuggested[0].source || 'none') : 'none'
      
      const confirmedBoxes = layout.boxes.filter(b => b.included).map(b => ({
        id: b.id,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        class_name: 'offer_block' as const
      }))

      // Heuristics for changes
      const added = Math.max(0, confirmedBoxes.length - originalSuggested.length)
      const removed = Math.max(0, originalSuggested.length - confirmedBoxes.length)
      const moved = originalSuggested.length > 0 && confirmedBoxes.length > 0 ? 1 : 0 // simplify

      let confirmationType: 'accepted_without_changes' | 'corrected_detection' | 'manual_layout' = 'accepted_without_changes'
      if (originalSuggested.length === 0) {
        confirmationType = 'manual_layout'
      } else if (added > 0 || removed > 0 || moved > 0) {
        confirmationType = 'corrected_detection'
      }

      const now = new Date().toISOString()

      const annotation: OfferBlockTrainingAnnotation = {
        schema_version: 1,
        annotation_id: annotationId,
        created_at: now,
        updated_at: now,
        image: {
          source_page_image_path: layout.pageImagePath,
          training_image_path: trainingImagePath,
          width: layout.pageWidth,
          height: layout.pageHeight,
          page_number: layout.pageNumber
        },
        source: {
          leaflet_file_name: sourceMetadata.leafletFileName,
          leaflet_id: sourceMetadata.leafletId,
          supermarket_code: sourceMetadata.supermarketCode,
          supermarket_description: sourceMetadata.supermarketDescription,
          location_code: sourceMetadata.locationCode,
          promotion_start_date: sourceMetadata.promotionStartDate
        },
        prediction: {
          strategy: strategy as any,
          overall_confidence: originalSuggested[0]?.confidence || null,
          original_boxes: originalSuggested.map(b => ({
            x: b.x, y: b.y, width: b.width, height: b.height, confidence: b.confidence
          }))
        },
        confirmed: {
          boxes: confirmedBoxes,
          confirmed_by: 'operator',
          confirmation_type: confirmationType,
          added_box_count: added,
          removed_box_count: removed,
          moved_or_resized_box_count: moved
        },
        quality: {
          eligible_for_training: eligible,
          exclusion_reasons: excludedReasons
        }
      }

      const annotationPath = isNegative 
        ? path.join(this.baseDir, 'negative_examples', `${annotationId}.json`)
        : path.join(this.baseDir, 'annotations', `${annotationId}.json`)

      // Handle history revision
      if (fs.existsSync(annotationPath)) {
        const historyDir = path.join(this.baseDir, 'history', annotationId)
        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true })
        const revision = fs.readdirSync(historyDir).length + 1
        const revPath = path.join(historyDir, `revision-${String(revision).padStart(3, '0')}.json`)
        fs.copyFileSync(annotationPath, revPath)
        
        const oldStr = fs.readFileSync(annotationPath, 'utf8')
        const oldParsed = JSON.parse(oldStr)
        annotation.created_at = oldParsed.created_at
      }

      fs.writeFileSync(annotationPath, JSON.stringify(annotation, null, 2), 'utf8')

      // Save predictions
      if (!isNegative) {
        const predPath = path.join(this.baseDir, 'predictions', `${annotationId}.json`)
        fs.writeFileSync(predPath, JSON.stringify(annotation.prediction, null, 2), 'utf8')
      }

      await this.updateIndex()
      
      // Update Auto-Acceptance Evidence
      try {
        const metadataDir = path.join(path.dirname(layout.pageImagePath), '..', '..', 'metadata')
        const decisionPath = path.join(metadataDir, 'auto-acceptance', `page-${String(layout.pageNumber).padStart(3, '0')}-decision.json`)
        if (fs.existsSync(decisionPath)) {
          const decision: import('../../shared/types/autoAcceptance').PageAutoAcceptanceDecision = JSON.parse(fs.readFileSync(decisionPath, 'utf8'))
          const { detectorAutoAcceptanceModeService } = await import('../ml/detectorAutoAcceptanceModeService')
          
          const unchanged = confirmationType === 'accepted_without_changes'
          // A crude missed offer heuristic for this test: if operator added boxes, it's a missed offer
          const missedOffers = added
          
          if (decision.mode === 'shadow') {
            detectorAutoAcceptanceModeService.recordShadowEvidence(sourceMetadata.supermarketCode, decision.would_auto_accept_in_automatic_mode, unchanged, missedOffers)
          } else if (decision.mode === 'assisted') {
            detectorAutoAcceptanceModeService.recordAssistedEvidence(sourceMetadata.supermarketCode, decision.decision === 'recommend_accept', unchanged, missedOffers)
          } else if (decision.mode === 'automatic') {
            detectorAutoAcceptanceModeService.recordAutomaticEvidence(sourceMetadata.supermarketCode, missedOffers)
          }
        }
      } catch (e: any) {
        logError(`Failed to update auto-acceptance evidence: ${e.message}`)
      }

      return { success: true, isNegative }
    } catch (err: any) {
      logError(`Failed to save annotation: ${err.message}`)
      return { success: false, error: err.message, isNegative: false }
    }
  }

  private async updateIndex() {
    const indexPath = path.join(this.baseDir, 'dataset-index.json')
    const annDir = path.join(this.baseDir, 'annotations')
    const negDir = path.join(this.baseDir, 'negative_examples')

    let total = 0
    let eligible = 0
    let negative = 0
    const supermarkets: Record<string, any> = {}

    if (fs.existsSync(annDir)) {
      for (const file of fs.readdirSync(annDir)) {
        if (file.endsWith('.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(annDir, file), 'utf8')) as OfferBlockTrainingAnnotation
            total++
            if (data.quality.eligible_for_training) eligible++
            
            const code = data.source.supermarket_code
            if (!supermarkets[code]) {
              supermarkets[code] = {
                annotation_count: 0,
                corrected_detection_count: 0,
                accepted_without_changes_count: 0,
                manual_layout_count: 0
              }
            }
            supermarkets[code].annotation_count++
            if (data.confirmed.confirmation_type === 'corrected_detection') supermarkets[code].corrected_detection_count++
            else if (data.confirmed.confirmation_type === 'accepted_without_changes') supermarkets[code].accepted_without_changes_count++
            else if (data.confirmed.confirmation_type === 'manual_layout') supermarkets[code].manual_layout_count++
          } catch(e){}
        }
      }
    }

    if (fs.existsSync(negDir)) {
      negative = fs.readdirSync(negDir).filter(f => f.endsWith('.json')).length
    }

    const indexData = {
      schema_version: 1,
      updated_at: new Date().toISOString(),
      total_annotations: total,
      training_eligible_annotations: eligible,
      negative_examples: negative,
      supermarkets
    }

    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8')

    // Trigger ML training check
    try {
      const { detectorTrainingSchedulerService } = await import('../ml/detectorTrainingSchedulerService')
      detectorTrainingSchedulerService.checkAndTriggerTraining(eligible, indexPath)
    } catch (e: any) {
      logError(`Failed to trigger training scheduler: ${e.message}`)
    }
  }
}

export const annotationService = new AnnotationService()
