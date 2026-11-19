import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import type { LeafletSchemaVersion } from '../../shared/schemas/leafletPageExtractionSchema';

const cwd = process.cwd();

export interface BenchmarkPageSpec {
  id: string;
  retailer: string;
  pageNum: number;
  imagePath: string;
  expectedOfferCount: number;
  hasVerifiedGroundTruth: boolean;
  groundTruthPath?: string;
}

/**
 * 15 Verified Benchmark Pages with complete operator-reviewed ground truth (168 offers)
 * across 5 major grocery retailers in Saudi Arabia.
 */
export const VERIFIED_BENCHMARK_PAGES: BenchmarkPageSpec[] = [
  // 1. Othaim Golden Fixtures (2 pages, 20 offers)
  { id: 'GOLDEN-P1', retailer: 'Othaim', pageNum: 1, imagePath: 'test-fixtures/page1_small.png', expectedOfferCount: 9, hasVerifiedGroundTruth: true, groundTruthPath: 'test-fixtures/page1_golden.json' },
  { id: 'GOLDEN-P4', retailer: 'Othaim', pageNum: 4, imagePath: 'test-fixtures/page4_small.png', expectedOfferCount: 11, hasVerifiedGroundTruth: true, groundTruthPath: 'test-fixtures/page4_golden.json' },

  // 2. Alwafa Test Set (3 pages, 42 offers)
  { id: 'ALWAFA-P1', retailer: 'Alwafa', pageNum: 1, imagePath: 'Extracts/Alwafa_Test/pages/page.1.png', expectedOfferCount: 13, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/Alwafa_Test/json' },
  { id: 'ALWAFA-P2', retailer: 'Alwafa', pageNum: 2, imagePath: 'Extracts/Alwafa_Test/pages/page.2.png', expectedOfferCount: 13, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/Alwafa_Test/json' },
  { id: 'ALWAFA-P3', retailer: 'Alwafa', pageNum: 3, imagePath: 'Extracts/Alwafa_Test/pages/page.3.png', expectedOfferCount: 16, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/Alwafa_Test/json' },

  // 3. BinDawood Test Set (4 pages, 45 offers)
  { id: 'BNDW-P1', retailer: 'BinDawood', pageNum: 1, imagePath: 'Extracts/BNDW_Test/pages/page.1.png', expectedOfferCount: 14, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/BNDW_Test/json' },
  { id: 'BNDW-P2', retailer: 'BinDawood', pageNum: 2, imagePath: 'Extracts/BNDW_Test/pages/page.2.png', expectedOfferCount: 7, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/BNDW_Test/json' },
  { id: 'BNDW-P3', retailer: 'BinDawood', pageNum: 3, imagePath: 'Extracts/BNDW_Test/pages/page.3.png', expectedOfferCount: 12, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/BNDW_Test/json' },
  { id: 'BNDW-P4', retailer: 'BinDawood', pageNum: 4, imagePath: 'Extracts/BNDW_Test/pages/page.4.png', expectedOfferCount: 12, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/BNDW_Test/json' },

  // 4. Lulu Test Set (3 pages, 26 offers)
  { id: 'LULU-P1', retailer: 'Lulu', pageNum: 1, imagePath: 'Extracts/Lulu_Test/pages/page.1.png', expectedOfferCount: 4, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/Lulu_Test/json' },
  { id: 'LULU-P2', retailer: 'Lulu', pageNum: 2, imagePath: 'Extracts/Lulu_Test/pages/page.2.png', expectedOfferCount: 11, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/Lulu_Test/json' },
  { id: 'LULU-P3', retailer: 'Lulu', pageNum: 3, imagePath: 'Extracts/Lulu_Test/pages/page.3.png', expectedOfferCount: 11, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/Lulu_Test/json' },

  // 5. Panda Test Set (3 pages, 35 offers)
  { id: 'PANDA-P1', retailer: 'Panda', pageNum: 1, imagePath: 'Extracts/Panda_Test/pages/page.1.png', expectedOfferCount: 8, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/Panda_Test/json' },
  { id: 'PANDA-P2', retailer: 'Panda', pageNum: 2, imagePath: 'Extracts/Panda_Test/pages/page.2.png', expectedOfferCount: 12, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/Panda_Test/json' },
  { id: 'PANDA-P3', retailer: 'Panda', pageNum: 3, imagePath: 'Extracts/Panda_Test/pages/page.3.png', expectedOfferCount: 15, hasVerifiedGroundTruth: true, groundTruthPath: 'Extracts/Panda_Test/json' }
];

export const UNVERIFIED_PAGES_AUDIT: BenchmarkPageSpec[] = [
  { id: 'PANDA-P4', retailer: 'Panda', pageNum: 4, imagePath: 'Extracts/PAND-JEDC-150726/pages/page.4.png', expectedOfferCount: 10, hasVerifiedGroundTruth: false },
  { id: 'OTHM-P2', retailer: 'Othaim', pageNum: 2, imagePath: 'Extracts/Othaim_week24/pages/page.2.png', expectedOfferCount: 4, hasVerifiedGroundTruth: false },
  { id: 'OTHM-P3', retailer: 'Othaim', pageNum: 3, imagePath: 'Extracts/Othaim_week24/pages/page.3.png', expectedOfferCount: 6, hasVerifiedGroundTruth: false },
  { id: 'OTHM-P6', retailer: 'Othaim', pageNum: 6, imagePath: 'Extracts/Othaim_week24/pages/page.6.png', expectedOfferCount: 11, hasVerifiedGroundTruth: false },
  { id: 'TAMI-P1', retailer: 'Tamimi', pageNum: 1, imagePath: 'Extracts/TAMI-JEDC-150726/pages/page.1.png', expectedOfferCount: 2, hasVerifiedGroundTruth: false }
];

export interface PersistedBenchmarkRecord {
  pageId: string;
  retailer: string;
  imagePath: string;
  imageSha256: string;
  backend: 'vertex' | 'developer';
  model: string;
  schemaVersion: LeafletSchemaVersion;
  promptVersion: LeafletSchemaVersion;
  configType: 'legacy_standard' | 'opt_standard' | 'opt_flex';
  requestedServiceTier: 'standard' | 'flex';
  actualTrafficType: string;
  thinkingConfig: { thinkingLevel: string };
  rawResponseText: string;
  decodedCanonicalOffers: any[];
  usageMetadata: Record<string, any>;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  requestDurationMs: number;
  costUsd: number;
  benchmarkCompletionStatus: 'completed' | 'reused_from_disk';
  savedAt: string;
}

export interface LedgerEntry {
  attemptNumber: number;
  timestamp: string;
  pageId: string;
  configType: 'legacy_standard' | 'opt_standard' | 'opt_flex';
  backend: 'vertex' | 'developer';
  model: string;
  status: 'success' | 'network_error' | 'rejected' | 'reused_from_disk';
  httpStatus?: number;
  trafficType?: string;
  promptTokens?: number;
  candidatesTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  error?: string;
  recordFile?: string;
}

export class PersistedBenchmarkRunner {
  private runsDir: string;
  private ledgerPath: string;
  private ledger: LedgerEntry[] = [];
  private totalSpendUsd = 0;
  private attemptCount = 0;

  constructor(baseDir: string = cwd) {
    this.runsDir = join(baseDir, 'temp/benchmark_runs');
    this.ledgerPath = join(baseDir, 'temp/benchmark_ledger.json');
    if (!existsSync(this.runsDir)) {
      mkdirSync(this.runsDir, { recursive: true });
    }
    this.loadOrCreateLedger();
  }

  private loadOrCreateLedger() {
    if (existsSync(this.ledgerPath)) {
      try {
        const raw = readFileSync(this.ledgerPath, 'utf8');
        this.ledger = JSON.parse(raw);
        this.attemptCount = this.ledger.length;
        this.totalSpendUsd = this.ledger.reduce((acc, e) => acc + (e.costUsd || 0), 0);
      } catch {
        this.ledger = [];
      }
    } else {
      this.ledger = [];
      this.attemptCount = 0;
      this.totalSpendUsd = 0;
    }
  }

  private persistLedger() {
    const tmp = `${this.ledgerPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.ledger, null, 2), 'utf8');
    renameSync(tmp, this.ledgerPath);
  }

  public getRecordPath(pageId: string, configType: string): string {
    return join(this.runsDir, `${pageId}__${configType}.json`);
  }

  public getExistingRecord(pageId: string, configType: string): PersistedBenchmarkRecord | null {
    const p = this.getRecordPath(pageId, configType);
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.pageId === pageId && parsed.configType === configType && Array.isArray(parsed.decodedCanonicalOffers)) {
          return { ...parsed, benchmarkCompletionStatus: 'reused_from_disk' };
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  public atomicallySaveRecord(record: PersistedBenchmarkRecord) {
    const target = this.getRecordPath(record.pageId, record.configType);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    renameSync(tmp, target);
  }

  public recordLedgerEntry(entry: Omit<LedgerEntry, 'attemptNumber' | 'timestamp'>) {
    this.attemptCount++;
    const fullEntry: LedgerEntry = {
      attemptNumber: this.attemptCount,
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.ledger.push(fullEntry);
    if (entry.costUsd) {
      this.totalSpendUsd += entry.costUsd;
    }
    this.persistLedger();
    return fullEntry;
  }

  public getStats() {
    return {
      attemptCount: this.attemptCount,
      totalSpendUsd: this.totalSpendUsd,
      completedRecords: this.ledger.filter(l => l.status === 'success' || l.status === 'reused_from_disk').length
    };
  }
}

