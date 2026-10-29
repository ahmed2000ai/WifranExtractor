import { copyFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type {
  ExtractedOfferRev1,
  LeafletPageExtractionRev1,
  NormalizedBox2D,
  Stage5AuditResult
} from '../../shared/types/leafletExtraction';

export type YoloAnnotationRow = {
  classId: number;
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
};

/**
 * Converts a normalized 0..1000 box [ymin, xmin, ymax, xmax] to YOLO format:
 * <x_center> <y_center> <width> <height> in 0.0..1.0
 */
export function convertBoxToYoloFormat(box2d: NormalizedBox2D, classId: number): YoloAnnotationRow {
  const [ymin, xmin, ymax, xmax] = box2d;
  const xCenter = (xmin + xmax) / 2000;
  const yCenter = (ymin + ymax) / 2000;
  const width = Math.max(0.001, (xmax - xmin) / 1000);
  const height = Math.max(0.001, (ymax - ymin) / 1000);

  return {
    classId,
    xCenter: Number(xCenter.toFixed(6)),
    yCenter: Number(yCenter.toFixed(6)),
    width: Number(width.toFixed(6)),
    height: Number(height.toFixed(6))
  };
}

export function formatYoloLine(row: YoloAnnotationRow): string {
  return `${row.classId} ${row.xCenter.toFixed(6)} ${row.yCenter.toFixed(6)} ${row.width.toFixed(6)} ${row.height.toFixed(6)}`;
}

export class ActiveLearningExporter {
  private baseDir: string;
  private imagesDir: string;
  private labelsDir: string;

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || join(process.cwd(), 'training_data', 'dataset');
    this.imagesDir = join(this.baseDir, 'images', 'train');
    this.labelsDir = join(this.baseDir, 'labels', 'train');
    mkdirSync(this.imagesDir, { recursive: true });
    mkdirSync(this.labelsDir, { recursive: true });
  }

  /**
   * Generates YOLO lines for all 5 atomic classes across all extracted offers.
   */
  generateYoloAnnotations(offers: ExtractedOfferRev1[]): string[] {
    const lines: string[] = [];

    for (const offer of offers) {
      const comp = offer.components;

      // 0: product_graphic
      if (
        comp.product_graphic_box &&
        comp.product_graphic_box[2] > comp.product_graphic_box[0] &&
        comp.product_graphic_box[3] > comp.product_graphic_box[1]
      ) {
        lines.push(formatYoloLine(convertBoxToYoloFormat(comp.product_graphic_box, 0)));
      }

      // 1: promo_price
      if (
        comp.promo_price_box &&
        comp.promo_price_box[2] > comp.promo_price_box[0] &&
        comp.promo_price_box[3] > comp.promo_price_box[1]
      ) {
        lines.push(formatYoloLine(convertBoxToYoloFormat(comp.promo_price_box, 1)));
      }

      // 2: original_price (strictly excluded when original_price === null or original_price_box === null)
      if (
        offer.original_price !== null &&
        offer.original_price !== undefined &&
        comp.original_price_box &&
        comp.original_price_box[2] > comp.original_price_box[0] &&
        comp.original_price_box[3] > comp.original_price_box[1]
      ) {
        lines.push(formatYoloLine(convertBoxToYoloFormat(comp.original_price_box, 2)));
      }

      // 3: unit_and_size_badge
      if (
        comp.unit_and_size_badge_box &&
        comp.unit_and_size_badge_box[2] > comp.unit_and_size_badge_box[0] &&
        comp.unit_and_size_badge_box[3] > comp.unit_and_size_badge_box[1]
      ) {
        lines.push(formatYoloLine(convertBoxToYoloFormat(comp.unit_and_size_badge_box, 3)));
      }

      // 4: title_block
      if (
        comp.title_text_box &&
        comp.title_text_box[2] > comp.title_text_box[0] &&
        comp.title_text_box[3] > comp.title_text_box[1]
      ) {
        lines.push(formatYoloLine(convertBoxToYoloFormat(comp.title_text_box, 4)));
      }
    }

    return lines;
  }

  /**
   * Confidence-Gated Exporter: Exports verified page annotations to the YOLO11 training pool.
   * If weightMultiplier > 1 (e.g. 3x for human corrections), writes duplicate weighted entries.
   */
  exportPageIfEligible(
    sourceImagePath: string,
    pageExtraction: LeafletPageExtractionRev1,
    auditResult: Stage5AuditResult,
    options?: { pageId?: string; weightMultiplier?: number; forceExport?: boolean }
  ): { exported: boolean; pageId: string; annotationCount: number; destinationImagePath?: string } {
    const minConfidence = 0.95;
    const isEligible =
      options?.forceExport ||
      (auditResult.passed && auditResult.page_confidence >= minConfidence);

    const pageId =
      options?.pageId || `page_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (!isEligible) {
      return { exported: false, pageId, annotationCount: 0 };
    }

    const yoloLines = this.generateYoloAnnotations(pageExtraction.offers);
    const weight = options?.weightMultiplier || 1;

    // Multiply lines if oversampling requested (e.g. 3x human feedback)
    const finalLines: string[] = [];
    for (let w = 0; w < weight; w++) {
      finalLines.push(...yoloLines);
    }

    const destImagePath = join(this.imagesDir, `${pageId}.jpg`);
    const destLabelPath = join(this.labelsDir, `${pageId}.txt`);

    copyFileSync(sourceImagePath, destImagePath);
    writeFileSync(destLabelPath, finalLines.join('\n') + '\n', 'utf8');

    return {
      exported: true,
      pageId,
      annotationCount: finalLines.length,
      destinationImagePath: destImagePath
    };
  }
}

export const sharedActiveLearningExporter = new ActiveLearningExporter();
