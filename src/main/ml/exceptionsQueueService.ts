import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  ExtractedOfferRev1,
  Stage5AuditIssue
} from '../../shared/types/leafletExtraction';
import { sharedActiveLearningExporter } from './activeLearningExporter';

export type PendingException = {
  id: string;
  pageNumber: number;
  sourceImagePath: string;
  offer: ExtractedOfferRev1;
  issues: Stage5AuditIssue[];
  createdAt: string;
  status: 'pending' | 'resolved' | 'dismissed';
};

export class ExceptionsQueueService {
  private queueFilePath: string;
  private memoryQueue: Map<string, PendingException> = new Map();

  constructor(customStoreDir?: string) {
    const dir = customStoreDir || join(process.cwd(), 'training_data', 'exceptions');
    mkdirSync(dir, { recursive: true });
    this.queueFilePath = join(dir, 'exceptions_queue.json');
    this.loadQueue();
  }

  private loadQueue(): void {
    if (existsSync(this.queueFilePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.queueFilePath, 'utf8'));
        if (Array.isArray(raw)) {
          raw.forEach(item => this.memoryQueue.set(item.id, item));
        }
      } catch {
        // ignore
      }
    }
  }

  private persistQueue(): void {
    const array = Array.from(this.memoryQueue.values());
    writeFileSync(this.queueFilePath, JSON.stringify(array, null, 2), 'utf8');
  }

  enqueueException(
    pageNumber: number,
    sourceImagePath: string,
    offer: ExtractedOfferRev1,
    issues: Stage5AuditIssue[]
  ): PendingException {
    const id = `exc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const exceptionItem: PendingException = {
      id,
      pageNumber,
      sourceImagePath,
      offer,
      issues,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    this.memoryQueue.set(id, exceptionItem);
    this.persistQueue();
    return exceptionItem;
  }

  getPendingExceptions(): PendingException[] {
    return Array.from(this.memoryQueue.values()).filter(e => e.status === 'pending');
  }

  /**
   * Submits human correction for an exception.
   * Updates the record and exports to YOLO training pool with a 3x oversampling multiplier.
   */
  submitHumanCorrection(
    exceptionId: string,
    correctedOffer: ExtractedOfferRev1
  ): { success: boolean; exportedToTrainingPool: boolean; message: string } {
    const existing = this.memoryQueue.get(exceptionId);
    if (!existing) {
      return { success: false, exportedToTrainingPool: false, message: 'Exception item not found' };
    }

    existing.offer = correctedOffer;
    existing.status = 'resolved';
    this.persistQueue();

    // Export with 3x oversampling weight into YOLO training pool
    let exported = false;
    if (existsSync(existing.sourceImagePath)) {
      const exportResult = sharedActiveLearningExporter.exportPageIfEligible(
        existing.sourceImagePath,
        {
          is_loyalty_page: false,
          loyalty_program_name: null,
          validity_start_date: null,
          validity_end_date: null,
          ignored_banners: [],
          offers: [correctedOffer]
        },
        {
          passed: true,
          page_confidence: 1.0,
          issues: [],
          total_offers: 1,
          unresolved_retries: 0,
          suspect_regions: []
        },
        {
          pageId: `human_${exceptionId}`,
          weightMultiplier: 3, // 3x oversampling weight for human-corrected data
          forceExport: true
        }
      );
      exported = exportResult.exported;
    }

    return {
      success: true,
      exportedToTrainingPool: exported,
      message: 'Human correction applied and exported with 3x weight'
    };
  }
}

export const sharedExceptionsQueueService = new ExceptionsQueueService();
