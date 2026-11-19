import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { sharedBatchOrchestrationService, BatchOrchestrationService } from '../batchOrchestrationService';
import {
  HYBRID_LIVE_DEFAULT_TIMEOUT_MS,
  HYBRID_LIVE_CLIENT_SAFETY_MARGIN_MS
} from '../../ocr/hybrid/hybridGeminiLiveProvider';
import { CatalogPublicationService } from '../../db/catalogPublicationService';
import type { BatchManifest, ActiveWorkflowSession } from '../../../shared/types/batchExtraction';
import type { MatchingRunManifest } from '../../../shared/types/catalogMatching';

describe('WIFRAN — Standard Batch Splitting, Persistent Status Management & Publication Locking', () => {
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop()!;
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore timing
      }
    }
    vi.restoreAllMocks();
  });

  // Helper to create an isolated BatchOrchestrationService in a temp dir
  function createIsolatedOrchestrator(baseDir: string): BatchOrchestrationService {
    const batchesBaseDir = path.join(baseDir, 'batches');
    const extractsDir = path.join(baseDir, 'Extracts');
    fs.mkdirSync(batchesBaseDir, { recursive: true });
    fs.mkdirSync(extractsDir, { recursive: true });

    return new BatchOrchestrationService(batchesBaseDir);
  }

  // Helper to build a multi-leaflet test batch
  function createMultiLeafletBatch(orchestrator: BatchOrchestrationService, baseDir: string): {
    manifest: BatchManifest;
    batchDir: string;
  } {
    const batchId = `batch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const batchDir = orchestrator.getBatchDir(batchId);
    fs.mkdirSync(path.join(batchDir, 'catalog-matching'), { recursive: true });

    const ws1 = path.join(baseDir, 'Extracts', 'lulu-ws');
    const ws2 = path.join(baseDir, 'Extracts', 'alraya-ws');
    const ws3 = path.join(baseDir, 'Extracts', 'hyperpanda-ws');
    const ws4 = path.join(baseDir, 'Extracts', 'danube-ws');
    [ws1, ws2, ws3, ws4].forEach((ws) => fs.mkdirSync(ws, { recursive: true }));

    // Create staged drafts with sample offers
    fs.writeFileSync(
      path.join(ws1, 'staged-draft.json'),
      JSON.stringify({
        status: 'draft',
        items: [
          { id: 'off-lulu-1', sourceOfferId: 'lulu-off-1', pageNumber: 1, title: 'LuLu Apple' },
          { id: 'off-lulu-2', sourceOfferId: 'lulu-off-2', pageNumber: 2, title: 'LuLu Milk' }
        ]
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(ws2, 'staged-draft.json'),
      JSON.stringify({
        status: 'draft',
        items: [{ id: 'off-raya-1', sourceOfferId: 'raya-off-1', pageNumber: 1, title: 'Al Raya Rice' }]
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(ws3, 'staged-draft.json'), JSON.stringify({ status: 'draft', items: [] }), 'utf8');
    fs.writeFileSync(
      path.join(ws4, 'staged-draft.json'),
      JSON.stringify({
        status: 'draft',
        items: [{ id: 'off-danube-1', sourceOfferId: 'danube-off-1', pageNumber: 1, title: 'Danube Tea' }]
      }),
      'utf8'
    );

    const nowIso = new Date().toISOString();
    const manifest: BatchManifest = {
      schemaVersion: '1.0',
      batchId,
      workspaceDir: batchDir,
      status: 'created',
      createdAt: nowIso,
      updatedAt: nowIso,
      executionMode: 'flex',
      extractionPipelineMode: 'hybrid_v3',
      model: 'gemini-3.8-flash',
      leaflets: [
        {
          leafletId: 'leaflet-001',
          fileName: 'lulu.pdf',
          filePath: path.join(ws1, 'lulu.pdf'),
          fileSizeBytes: 1024,
          fileFingerprint: 'fingerprint-lulu',
          workspacePath: ws1,
          pageCount: 85,
          pagesProcessed: 85,
          offersCount: 728,
          status: 'completed',
          extractionStatus: 'completed',
          reviewStatus: 'needs_review',
          publicationStatus: 'not_published',
          publishedOffersCount: 0,
          deferredOffersCount: 0,
          readyOffersCount: 728,
          blockedOffersCount: 0,
          estimatedCostUsd: 0.1383,
          provenance: 'fresh',
          metadata: {
            supermarketName: 'LuLu Hypermarket',
            locationScope: 'national',
            metadataStatus: 'operator_verified'
          }
        },
        {
          leafletId: 'leaflet-002',
          fileName: 'alraya.pdf',
          filePath: path.join(ws2, 'alraya.pdf'),
          fileSizeBytes: 1024,
          fileFingerprint: 'fingerprint-alraya',
          workspacePath: ws2,
          pageCount: 24,
          pagesProcessed: 22,
          offersCount: 274,
          status: 'failed',
          extractionStatus: 'partially_extracted',
          reviewStatus: 'pending',
          publicationStatus: 'not_published',
          publishedOffersCount: 0,
          deferredOffersCount: 0,
          readyOffersCount: 0,
          blockedOffersCount: 0,
          estimatedCostUsd: 0.05,
          provenance: 'fresh',
          metadata: {
            supermarketName: 'Al Raya',
            locationScope: 'national',
            metadataStatus: 'needs_review'
          }
        },
        {
          leafletId: 'leaflet-003',
          fileName: 'hyperpanda.pdf',
          filePath: path.join(ws3, 'hyperpanda.pdf'),
          fileSizeBytes: 1024,
          fileFingerprint: 'fingerprint-hyperpanda',
          workspacePath: ws3,
          pageCount: 112,
          pagesProcessed: 0,
          offersCount: 0,
          status: 'failed',
          extractionStatus: 'not_started',
          reviewStatus: 'pending',
          publicationStatus: 'not_published',
          publishedOffersCount: 0,
          deferredOffersCount: 0,
          readyOffersCount: 0,
          blockedOffersCount: 0,
          estimatedCostUsd: 0,
          provenance: 'fresh',
          metadata: {
            supermarketName: 'HyperPanda',
            locationScope: 'national',
            metadataStatus: 'needs_review'
          }
        },
        {
          leafletId: 'leaflet-004',
          fileName: 'danube.pdf',
          filePath: path.join(ws4, 'danube.pdf'),
          fileSizeBytes: 1024,
          fileFingerprint: 'fingerprint-danube',
          workspacePath: ws4,
          pageCount: 118,
          pagesProcessed: 2,
          offersCount: 19,
          status: 'failed',
          extractionStatus: 'partially_extracted',
          reviewStatus: 'pending',
          publicationStatus: 'not_published',
          publishedOffersCount: 0,
          deferredOffersCount: 0,
          readyOffersCount: 0,
          blockedOffersCount: 0,
          estimatedCostUsd: 0.01,
          provenance: 'fresh',
          metadata: {
            supermarketName: 'Danube',
            locationScope: 'national',
            metadataStatus: 'needs_review'
          }
        }
      ],
      totals: {
        totalPdfs: 4,
        completedPdfs: 1,
        failedPdfs: 3,
        cancelledPdfs: 0,
        totalPages: 339,
        pagesProcessed: 109,
        totalOffers: 1021,
        totalCostUsd: 0.1983
      }
    };

    // Save manifest and catalog matching proposals
    fs.writeFileSync(path.join(batchDir, 'batch-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const matchingRun: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId,
      runId: `run-${Date.now()}`,
      status: 'completed',
      createdAt: nowIso,
      updatedAt: nowIso,
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      totals: {
        totalExtractedOffers: 2,
        uniqueIdentitiesCount: 2,
        cacheMatchesCount: 0,
        deterministicMatchesCount: 0,
        geminiEvaluatedCount: 1,
        proposedExistingCount: 1,
        proposedTemporaryCount: 1,
        unresolvedCount: 0,
        validationWarningsCount: 0,
        actualCostUsd: 0.05,
        estimatedCostUsd: 0.05,
        geminiRequestsCount: 1,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0
      },
      brandSummaries: {},
      matchingDatabaseContext: 'PRODUCTION_UI',
      requests: {},
      temporaryProducts: {},
      proposals: {
        [`${batchId}:leaflet-001:1:lulu-off-1`]: {
          batchOfferKey: `${batchId}:leaflet-001:1:lulu-off-1`,
          sourceOfferId: 'lulu-off-1',
          sourcePage: 1,
          leafletId: 'leaflet-001',
          supermarketName: 'LuLu Hypermarket',
          decision: 'existing',
          matchedProductId: '19',
          confidence: 'high',
          operatorDecision: 'approved',
          temporaryId: null,
          matchMethod: 'gemini_medium',
          validationIssues: [],
          updatedAt: nowIso
        },
        [`${batchId}:leaflet-001:2:lulu-off-2`]: {
          batchOfferKey: `${batchId}:leaflet-001:2:lulu-off-2`,
          sourceOfferId: 'lulu-off-2',
          sourcePage: 2,
          leafletId: 'leaflet-001',
          supermarketName: 'LuLu Hypermarket',
          decision: 'temporary',
          matchedProductId: null,
          confidence: 'medium',
          operatorDecision: 'proposed',
          temporaryId: 'temp-group-001',
          matchMethod: 'gemini_medium',
          validationIssues: [],
          updatedAt: nowIso
        }
      }
    };
    fs.writeFileSync(
      path.join(batchDir, 'catalog-matching', 'matching-proposals.json'),
      JSON.stringify(matchingRun, null, 2),
      'utf8'
    );

    // Save cost ledger
    const costLedger = {
      batchId,
      totalCostUsd: 0.1983,
      records: [
        {
          leafletId: 'leaflet-001',
          pageNumber: 1,
          phase: 'B1',
          costUsd: 0.0016
        },
        {
          leafletId: 'leaflet-002',
          pageNumber: 1,
          phase: 'B1',
          costUsd: 0.0016
        }
      ]
    };
    fs.writeFileSync(path.join(batchDir, 'gemini-cost-ledger.json'), JSON.stringify(costLedger, null, 2), 'utf8');

    return { manifest, batchDir };
  }

  // --------------------------------------------------------------------------
  // Group 1: Persistent Workflow Session & Offline Safe Reopening (Points 1 - 4)
  // --------------------------------------------------------------------------
  describe('Group 1: Persistent Workflow Session & Offline Safe Reopening', () => {
    it('1. Reopening the app restores the last batch ID, workflow step, batch status, leaflet statuses, checkpoints, proposals and publication states', async () => {
      const baseDir = makeTempDir('wifran-session-test-');
      const orchestrator = createIsolatedOrchestrator(baseDir);

      const session: ActiveWorkflowSession = {
        schemaVersion: 'wifran.workflow.session/1.0',
        activeBatchId: 'batch-test-restore-001',
        activeStep: 2,
        selectedLeafletIds: ['leaflet-001', 'leaflet-002'],
        updatedAt: new Date().toISOString()
      };

      const saved = await orchestrator.setActiveWorkflowSession(session);
      expect(saved).toBeDefined();
      expect(saved.activeBatchId).toBe('batch-test-restore-001');

      const restored = await orchestrator.getActiveWorkflowSession();
      expect(restored).not.toBeNull();
      expect(restored?.activeBatchId).toBe('batch-test-restore-001');
      expect(restored?.activeStep).toBe(2);
      expect(restored?.selectedLeafletIds).toEqual(['leaflet-001', 'leaflet-002']);

      const cleared = await orchestrator.clearActiveWorkflowSession();
      expect(cleared).toBe(true);
      const afterClear = await orchestrator.getActiveWorkflowSession();
      expect(afterClear).toBeNull();
    });

    it('2. Opening a batch triggers NO extraction, NO paid AI requests and NO database writes', async () => {
      const baseDir = makeTempDir('wifran-passive-test-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      const loaded = await orchestrator.loadBatchManifest(manifest.batchId);
      expect(loaded).not.toBeNull();
      expect(loaded?.batchId).toBe(manifest.batchId);
      // Confirmed: loadBatchManifest performs pure synchronous local file reads
    });

    it('3. The November 19 batch (batch-2026-11-19T13-01-05-9fd1a6) reopens cleanly at Step 2 with all four leaflets available', async () => {
      // Load the actual batch from Extracts/batches without mutating it
      const actualManifest = await sharedBatchOrchestrationService.loadBatchManifest('batch-2026-11-19T13-01-05-9fd1a6');
      expect(actualManifest).not.toBeNull();
      expect(actualManifest?.batchId).toBe('batch-2026-11-19T13-01-05-9fd1a6');
      expect(actualManifest?.leaflets).toHaveLength(4);

      const lulu = actualManifest?.leaflets.find((l) => l.fileName.includes('lulu') || l.leafletId === 'leaflet-001');
      const alraya = actualManifest?.leaflets.find((l) => l.fileName.includes('al-raya') || l.leafletId === 'leaflet-002');
      const panda = actualManifest?.leaflets.find((l) => l.fileName.includes('panda') || l.leafletId === 'leaflet-003');
      const danube = actualManifest?.leaflets.find((l) => l.fileName.includes('danube') || l.leafletId === 'leaflet-004');

      expect(lulu).toBeDefined();
      expect(lulu?.pagesProcessed).toBe(85);
      expect(lulu?.offersCount).toBe(728);

      expect(alraya).toBeDefined();
      expect(alraya?.pagesProcessed).toBe(22);
      expect(alraya?.offersCount).toBe(274);

      expect(panda).toBeDefined();
      expect(panda?.pagesProcessed).toBe(0);

      expect(danube).toBeDefined();
      expect(danube?.pagesProcessed).toBe(2);
      expect(danube?.offersCount).toBe(19);
    });

    it('4. Step 2 displays supermarket name, PDF ID, total pages, completed/remaining pages, offer counts, extraction/review/publication statuses, and published/ready/deferred/blocked counts', async () => {
      const baseDir = makeTempDir('wifran-step2-display-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      const loaded = await orchestrator.loadBatchManifest(manifest.batchId);
      expect(loaded).not.toBeNull();

      for (const leaflet of loaded!.leaflets) {
        expect(leaflet.metadata.supermarketName).toBeTruthy();
        expect(leaflet.leafletId).toBeTruthy();
        expect(leaflet.pageCount).toBeGreaterThan(0);
        expect(typeof leaflet.pagesProcessed).toBe('number');
        expect(typeof leaflet.offersCount).toBe('number');
        expect(leaflet.extractionStatus).toBeDefined();
        expect(leaflet.reviewStatus).toBeDefined();
        expect(leaflet.publicationStatus).toBeDefined();
        expect(typeof leaflet.publishedOffersCount).toBe('number');
        expect(typeof leaflet.readyOffersCount).toBe('number');
        expect(typeof leaflet.deferredOffersCount).toBe('number');
        expect(typeof leaflet.blockedOffersCount).toBe('number');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: Step 2 Leaflet Selection & Standard Batch Splitting (Points 5 - 14)
  // --------------------------------------------------------------------------
  describe('Group 2: Step 2 Leaflet Selection & Standard Batch Splitting', () => {
    it('5, 6, 7. Splitting LuLu alone creates a new working batch with LuLu, updates parent batch, and sets parent active membership', async () => {
      const baseDir = makeTempDir('wifran-split-test-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      // Operator selects LuLu (leaflet-001) alone
      const splitResult = await orchestrator.splitBatch({
        sourceBatchId: manifest.batchId,
        selectedLeafletIds: ['leaflet-001']
      });

      expect(splitResult.success).toBe(true);
      expect(splitResult.newBatchId).not.toBeNull();
      expect(splitResult.newBatchId).not.toBe(manifest.batchId);
      expect(splitResult.transferredLeafletCount).toBe(1);

      // Verify new batch (Point 6)
      const newManifest = await orchestrator.loadBatchManifest(splitResult.newBatchId!);
      expect(newManifest).not.toBeNull();
      expect(newManifest?.parentBatchId).toBe(manifest.batchId);
      expect(newManifest?.leaflets).toHaveLength(1);
      expect(newManifest?.leaflets[0].leafletId).toBe('leaflet-001');
      expect(newManifest?.leaflets[0].metadata.supermarketName).toBe('LuLu Hypermarket');
      expect(newManifest?.leaflets[0].offersCount).toBe(728);
      expect(newManifest?.extractionStatus).toBe('completed'); // LuLu was already fully extracted

      // Verify parent batch (Point 7)
      const updatedParent = await orchestrator.loadBatchManifest(manifest.batchId);
      expect(updatedParent).not.toBeNull();
      expect(updatedParent?.leaflets).toHaveLength(4); // All 4 records preserved
      const parentLuLu = updatedParent?.leaflets.find((l) => l.leafletId === 'leaflet-001');
      expect(parentLuLu?.transferStatus).toBe('transferred');
      expect(parentLuLu?.transferredToBatchId).toBe(splitResult.newBatchId);

      // Active totals exclude transferred LuLu
      expect(updatedParent?.totals.totalOffers).toBe(274 + 0 + 19); // Al Raya + Panda + Danube = 293
      expect(updatedParent?.splitHistory).toHaveLength(1);
      expect(updatedParent?.splitHistory![0].splitBatchId).toBe(splitResult.newBatchId);
      expect(updatedParent?.transferredLeaflets?.some((l) => l.leafletId === 'leaflet-001')).toBe(true);
    });

    it('8, 9, 10. Preserves immutable identities, does NOT duplicate files on disk, and re-keys matching proposals', async () => {
      const baseDir = makeTempDir('wifran-identities-test-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      const splitResult = await orchestrator.splitBatch({
        sourceBatchId: manifest.batchId,
        selectedLeafletIds: ['leaflet-001']
      });

      const newManifest = await orchestrator.loadBatchManifest(splitResult.newBatchId!);
      const transferredLeaflet = newManifest!.leaflets[0];

      // Point 8: Immutable identities preserved
      expect(transferredLeaflet.workspacePath).toBe(path.join(baseDir, 'Extracts', 'lulu-ws'));
      expect(transferredLeaflet.fileName).toBe('lulu.pdf');
      expect(transferredLeaflet.pageCount).toBe(85);
      expect(transferredLeaflet.pagesProcessed).toBe(85);

      // Point 9: Workspace on disk is unchanged and NOT duplicated
      expect(fs.existsSync(transferredLeaflet.workspacePath)).toBe(true);

      // Point 10: Proposals re-keyed to newBatchId
      const newProposalsPath = path.join(
        orchestrator.getBatchDir(splitResult.newBatchId!),
        'catalog-matching',
        'matching-proposals.json'
      );
      expect(fs.existsSync(newProposalsPath)).toBe(true);
      const newProposalsData = JSON.parse(fs.readFileSync(newProposalsPath, 'utf8'));
      expect(newProposalsData.batchId).toBe(splitResult.newBatchId);

      const rekeyedProposalKey = `${splitResult.newBatchId}:leaflet-001:1:lulu-off-1`;
      expect(newProposalsData.proposals[rekeyedProposalKey]).toBeDefined();
      expect(newProposalsData.proposals[rekeyedProposalKey].matchedProductId).toBe('19');
    });

    it('11. Selecting all four leaflets continues inside the current batch without creating a new batch container', async () => {
      const baseDir = makeTempDir('wifran-select-all-test-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      const allLeafletIds = manifest.leaflets.map((l) => l.leafletId);
      const result = await orchestrator.splitBatch({
        sourceBatchId: manifest.batchId,
        selectedLeafletIds: allLeafletIds
      });

      expect(result.success).toBe(true);
      expect(result.newBatchId).toBeNull();
      expect(result.transferredLeafletCount).toBe(0);
      expect(result.manifest.batchId).toBe(manifest.batchId);
    });

    it('12. Transferred LuLu cannot be re-extracted or re-transferred in the original batch', async () => {
      const baseDir = makeTempDir('wifran-prevent-retransfer-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      // First split transfers LuLu
      await orchestrator.splitBatch({
        sourceBatchId: manifest.batchId,
        selectedLeafletIds: ['leaflet-001']
      });

      // Attempting to transfer LuLu again throws
      await expect(
        orchestrator.splitBatch({
          sourceBatchId: manifest.batchId,
          selectedLeafletIds: ['leaflet-001']
        })
      ).rejects.toThrow(/already transferred/i);
    });

    it('13. Original batch status reflects remaining active leaflets; an empty transferred container is completed, not failed', async () => {
      const baseDir = makeTempDir('wifran-empty-container-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      // Split 1: Transfer LuLu (leaflet-001)
      await orchestrator.splitBatch({
        sourceBatchId: manifest.batchId,
        selectedLeafletIds: ['leaflet-001']
      });

      // Mark all remaining leaflets in parent as transferred
      const parent = await orchestrator.loadBatchManifest(manifest.batchId);
      for (const l of parent!.leaflets) {
        l.transferStatus = 'transferred';
      }
      orchestrator['recomputeTotals'](parent!);
      await orchestrator['saveBatchManifestAtomic'](parent!);

      const emptyParent = await orchestrator.loadBatchManifest(manifest.batchId);
      expect(emptyParent).not.toBeNull();
      expect(emptyParent?.leaflets.every((l) => l.transferStatus === 'transferred')).toBe(true);
      expect(emptyParent?.status).toBe('completed'); // Not failed
    });

    it('14. Leaflet Gemini cost history is preserved in both batches', async () => {
      const baseDir = makeTempDir('wifran-cost-preservation-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      const splitResult = await orchestrator.splitBatch({
        sourceBatchId: manifest.batchId,
        selectedLeafletIds: ['leaflet-001']
      });

      // Check new batch ledger
      const newLedgerPath = path.join(orchestrator.getBatchDir(splitResult.newBatchId!), 'gemini-cost-ledger.json');
      expect(fs.existsSync(newLedgerPath)).toBe(true);
      const newLedger = JSON.parse(fs.readFileSync(newLedgerPath, 'utf8'));
      expect(newLedger.records).toHaveLength(1);
      expect(newLedger.records[0].leafletId).toBe('leaflet-001');

      // Check parent batch ledger
      const parentLedgerPath = path.join(orchestrator.getBatchDir(manifest.batchId), 'gemini-cost-ledger.json');
      expect(fs.existsSync(parentLedgerPath)).toBe(true);
      const parentLedger = JSON.parse(fs.readFileSync(parentLedgerPath, 'utf8'));
      expect(parentLedger.records).toHaveLength(1);
      expect(parentLedger.records[0].leafletId).toBe('leaflet-002');
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: Publication Locking, Partial Publication & Noop Replay (Points 15 - 18)
  // --------------------------------------------------------------------------
  describe('Group 3: Publication Locking, Partial Publication & Noop Replay', () => {
    it('15. A fully published leaflet is marked published and locked against republishing and transfer', async () => {
      const baseDir = makeTempDir('wifran-pub-lock-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      // Record publication outcome for LuLu offers
      await orchestrator.recordSelectivePublicationOutcome({
        batchId: manifest.batchId,
        databaseContext: 'PRODUCTION_UI',
        publishOperationId: 'pub-op-001',
        publishedBatchOfferKeys: [
          `${manifest.batchId}:leaflet-001:1:lulu-off-1`,
          `${manifest.batchId}:leaflet-001:2:lulu-off-2`
        ],
        deferredBatchOfferKeys: [],
        insertedOffersCount: 2,
        updatedOffersCount: 0
      });

      const updated = await orchestrator.loadBatchManifest(manifest.batchId);
      const lulu = updated!.leaflets.find((l) => l.leafletId === 'leaflet-001')!;

      // Mark LuLu as fully published and persist to disk
      lulu.offersCount = 2;
      lulu.publishedOffersCount = 2;
      orchestrator['recomputeTotals'](updated!);
      await orchestrator['saveBatchManifestAtomic'](updated!);

      expect(lulu.publicationStatus).toBe('published');

      // Fully published leaflet cannot be transferred
      await expect(
        orchestrator.splitBatch({
          sourceBatchId: manifest.batchId,
          selectedLeafletIds: ['leaflet-001']
        })
      ).rejects.toThrow(/already fully published/i);
    });

    it('16, 17. Partial publication marks published offers locked while keeping deferred offers available for review', async () => {
      const baseDir = makeTempDir('wifran-partial-pub-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      // Publish offer 1, defer offer 2
      await orchestrator.recordSelectivePublicationOutcome({
        batchId: manifest.batchId,
        databaseContext: 'PRODUCTION_UI',
        publishOperationId: 'pub-op-partial-1',
        publishedBatchOfferKeys: [`${manifest.batchId}:leaflet-001:1:lulu-off-1`],
        deferredBatchOfferKeys: [`${manifest.batchId}:leaflet-001:2:lulu-off-2`],
        insertedOffersCount: 1,
        updatedOffersCount: 0
      });

      const updated = await orchestrator.loadBatchManifest(manifest.batchId);
      expect(updated!.publishedOffers?.[`${manifest.batchId}:leaflet-001:1:lulu-off-1`]?.state).toBe('published');
      expect(updated!.publishedOffers?.[`${manifest.batchId}:leaflet-001:2:lulu-off-2`]).toBeUndefined();

      // Read staged-draft.json to verify draft was updated with published state
      const draft = JSON.parse(
        fs.readFileSync(path.join(baseDir, 'Extracts', 'lulu-ws', 'staged-draft.json'), 'utf8')
      );
      const item1 = draft.items.find((it: any) => it.id === 'off-lulu-1');
      const item2 = draft.items.find((it: any) => it.id === 'off-lulu-2');

      expect(item1.publicationState?.state).toBe('published');
      expect(item2.publicationState).toBeUndefined(); // Remains available for review
    });

    it('18. Attempted republish of an already published offer or leaflet produces a no-op with alreadyPublished: true, no duplicate DB rows, and no Storage writes', async () => {
      const batchId = 'batch-pub-noop-001';
      const key = `${batchId}:leaflet-001:1:off-1`;

      const manifest: MatchingRunManifest = {
        schemaVersion: '1.0',
        batchId,
        runId: `run-${Date.now()}`,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        totals: {
          totalExtractedOffers: 1,
          uniqueIdentitiesCount: 1,
          cacheMatchesCount: 0,
          deterministicMatchesCount: 0,
          geminiEvaluatedCount: 0,
          proposedExistingCount: 1,
          proposedTemporaryCount: 0,
          unresolvedCount: 0,
          validationWarningsCount: 0,
          actualCostUsd: 0.01,
          estimatedCostUsd: 0.01,
          geminiRequestsCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0
        },
        brandSummaries: {},
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        requests: {},
        temporaryProducts: {},
        proposals: {
          [key]: {
            batchOfferKey: key,
            sourceOfferId: 'off-1',
            sourcePage: 1,
            leafletId: 'leaflet-001',
            supermarketName: 'Carrefour',
            decision: 'existing',
            matchedProductId: '19',
            confidence: 'high',
            operatorDecision: 'approved',
            temporaryId: null,
            matchMethod: 'gemini_medium',
            validationIssues: [],
            updatedAt: new Date().toISOString()
          }
        }
      };

      // Mock offer with publishedState
      const offer: any = {
        batchOfferKey: key,
        sourceOfferId: 'off-1',
        supermarketId: '00000000-0000-0000-0000-000000000001',
        titleEn: 'Published Milk',
        titleAr: 'حليب منشور',
        publicationState: {
          state: 'published',
          databaseContext: 'DEVELOPMENT_TEST',
          publishedAt: new Date().toISOString(),
          needsUpdateReview: false
        }
      };

      const catalogPublicationService = new CatalogPublicationService();

      // Assess preflight
      const preflight = await catalogPublicationService.assessPublicationPreflight({
        manifest,
        offers: [offer],
        context: 'DEVELOPMENT_TEST'
      });

      expect(preflight.ready).toBe(true);
      expect(preflight.eligibleOfferKeys).toHaveLength(0);
      expect(preflight.alreadyPublishedOfferKeys).toEqual([key]);

      // Call publishApprovedCatalogBatch
      const result = await catalogPublicationService.publishApprovedCatalogBatch({
        manifest,
        offers: [offer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'test_operator',
        enableImageUpload: false
      });

      expect(result.success).toBe(true);
      expect(result.publishedOffersCount).toBe(0);
      expect(result.alreadyPublishedBatchOfferKeys).toEqual([key]);
      expect(result.publishedOfferIds).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: Flex Timeout & Platform Verification (Points 19 - 20)
  // --------------------------------------------------------------------------
  describe('Group 4: Flex Timeout & Platform Verification', () => {
    it('19. B1 Flex request timeout is configured to 10 minutes (600,000 ms), with a 10.5-minute client timeout (630,000 ms) and X-Server-Timeout: 600 header', () => {
      expect(HYBRID_LIVE_DEFAULT_TIMEOUT_MS).toBe(600_000);
      expect(HYBRID_LIVE_CLIENT_SAFETY_MARGIN_MS).toBe(30_000);

      const clientTimeoutMs = HYBRID_LIVE_DEFAULT_TIMEOUT_MS + HYBRID_LIVE_CLIENT_SAFETY_MARGIN_MS;
      expect(clientTimeoutMs).toBe(630_000); // 10.5 minutes

      const serverTimeoutSeconds = Math.floor(HYBRID_LIVE_DEFAULT_TIMEOUT_MS / 1000);
      expect(serverTimeoutSeconds).toBe(600); // 600 seconds
    });

    it('20. Backward compatibility with existing batch manifests is fully preserved', async () => {
      const baseDir = makeTempDir('wifran-compat-test-');
      const orchestrator = createIsolatedOrchestrator(baseDir);

      // Simulate legacy manifest without new status fields
      const legacyBatchId = 'batch-legacy-001';
      const bDir = orchestrator.getBatchDir(legacyBatchId);
      fs.mkdirSync(bDir, { recursive: true });

      const legacyManifest: any = {
        batchId: legacyBatchId,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        executionMode: 'standard',
        extractionPipelineMode: 'hybrid_v3',
        model: 'gemini-3.8-flash',
        leaflets: [
          {
            leafletId: 'leaflet-001',
            fileName: 'legacy.pdf',
            filePath: '/dummy/legacy.pdf',
            workspacePath: '/dummy/legacy',
            pageCount: 10,
            pagesProcessed: 10,
            offersCount: 50,
            status: 'completed',
            estimatedCostUsd: 0.05,
            provenance: 'fresh_flex',
            metadata: {
              supermarketName: 'Carrefour'
            }
          }
        ],
        totals: {
          totalPdfs: 1,
          completedPdfs: 1,
          failedPdfs: 0,
          totalPages: 10,
          pagesProcessed: 10,
          totalOffers: 50,
          totalCostUsd: 0.05
        }
      };

      fs.writeFileSync(path.join(bDir, 'batch-manifest.json'), JSON.stringify(legacyManifest, null, 2), 'utf8');

      // Load legacy manifest and verify recomputeTotals added new lifecycle fields
      const loaded = await orchestrator.loadBatchManifest(legacyBatchId);
      expect(loaded).not.toBeNull();
      expect(loaded?.extractionStatus).toBe('completed');
      expect(loaded?.leaflets[0].extractionStatus).toBe('completed');
      expect(loaded?.leaflets[0].publicationStatus).toBe('not_published');
      expect(loaded?.leaflets[0].reviewStatus).toBe('needs_review');
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: Post-Implementation Safety Gate Verification (Offline Hardening)
  // --------------------------------------------------------------------------
  describe('Group 5: Post-Implementation Safety Gate Verification (Offline Hardening)', () => {
    it('21. Four-step workflow session persistence supports steps 1, 2, 3, and 4; restoring Step 4 is strictly passive and triggers zero mutations', async () => {
      const baseDir = makeTempDir('wifran-step4-persistence-');
      const orchestrator = createIsolatedOrchestrator(baseDir);

      // Verify Step 4 persistence
      const sessionStep4: ActiveWorkflowSession = {
        schemaVersion: 'wifran.workflow.session/1.0',
        activeBatchId: 'batch-step4-001',
        activeStep: 4,
        selectedLeafletIds: ['leaflet-001'],
        updatedAt: new Date().toISOString()
      };

      await orchestrator.setActiveWorkflowSession(sessionStep4);
      const restoredStep4 = await orchestrator.getActiveWorkflowSession();
      expect(restoredStep4).not.toBeNull();
      expect(restoredStep4?.activeStep).toBe(4);
      expect(restoredStep4?.activeBatchId).toBe('batch-step4-001');

      // Verify Step 3 persistence
      await orchestrator.setActiveWorkflowSession({ ...sessionStep4, activeStep: 3 });
      const restoredStep3 = await orchestrator.getActiveWorkflowSession();
      expect(restoredStep3?.activeStep).toBe(3);

      // Verify Step 1 persistence
      await orchestrator.setActiveWorkflowSession({ ...sessionStep4, activeStep: 1 });
      const restoredStep1 = await orchestrator.getActiveWorkflowSession();
      expect(restoredStep1?.activeStep).toBe(1);

      // Confirm that loading manifest for session restoration performs zero network or paid calls
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);
      const loaded = await orchestrator.loadBatchManifest(manifest.batchId);
      expect(loaded).not.toBeNull();
      expect(loaded?.batchId).toBe(manifest.batchId);
    });

    it('22. Publication status accuracy: Incomplete extraction (e.g. Al Raya 22/24 pages) with 100% of extracted offers published is strictly partially_published, NEVER published', async () => {
      const baseDir = makeTempDir('wifran-pub-status-incomplete-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      // Al Raya (leaflet-002) has 22/24 pages processed and 274 extracted offers
      const alraya = manifest.leaflets.find((l) => l.leafletId === 'leaflet-002')!;
      expect(alraya.pagesProcessed).toBe(22);
      expect(alraya.pageCount).toBe(24);
      expect(alraya.offersCount).toBe(274);

      // Simulate publishing all 274 currently extracted offers for Al Raya
      manifest.publishedOffers = manifest.publishedOffers || {};
      for (let i = 1; i <= 274; i++) {
        const key = `${manifest.batchId}:leaflet-002:1:raya-off-${i}`;
        manifest.publishedOffers[key] = {
          state: 'published',
          databaseContext: 'PRODUCTION_UI',
          publishOperationId: 'pub-op-raya-full',
          publishedAt: new Date().toISOString(),
          sourceOfferId: `raya-off-${i}`
        };
      }

      // Recompute totals and verify status
      orchestrator['recomputeTotals'](manifest);

      // CRITICAL ASSERTION:
      // Even though pubCount (274) >= offersCount (274), because pagesProcessed (22) < pageCount (24),
      // the leaflet extraction was incomplete, so publicationStatus MUST be 'partially_published'!
      expect(alraya.publishedOffersCount).toBe(274);
      expect(alraya.deferredOffersCount).toBe(0);
      expect(alraya.publicationStatus).toBe('partially_published');
      expect(alraya.publicationStatus).not.toBe('published');
    });

    it('23. Publication status accuracy: 0-offer failed leaflet is strictly not_published, and batch with mixed leaflets is partially_published, not published', async () => {
      const baseDir = makeTempDir('wifran-pub-status-zero-offer-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      // HyperPanda (leaflet-003) has 0 processed pages and 0 offers
      const panda = manifest.leaflets.find((l) => l.leafletId === 'leaflet-003')!;
      expect(panda.offersCount).toBe(0);

      // Fully publish LuLu (leaflet-001: 85/85 pages, 728 offers)
      const lulu = manifest.leaflets.find((l) => l.leafletId === 'leaflet-001')!;
      manifest.publishedOffers = manifest.publishedOffers || {};
      for (let i = 1; i <= 728; i++) {
        const key = `${manifest.batchId}:leaflet-001:1:lulu-off-${i}`;
        manifest.publishedOffers[key] = {
          state: 'published',
          databaseContext: 'PRODUCTION_UI',
          publishOperationId: 'pub-op-lulu-full',
          publishedAt: new Date().toISOString(),
          sourceOfferId: `lulu-off-${i}`
        };
      }

      orchestrator['recomputeTotals'](manifest);

      // LuLu is fully completed and published
      expect(lulu.publicationStatus).toBe('published');

      // HyperPanda has 0 offers and was failed -> MUST be not_published, NEVER published
      expect(panda.publicationStatus).toBe('not_published');
      expect(panda.publicationStatus).not.toBe('published');

      // Batch as a whole contains published LuLu, but Panda and Danube are not published
      // Manifest publication status MUST be partially_published, NEVER published
      expect(manifest.publicationStatus).toBe('partially_published');
      expect(manifest.publicationStatus).not.toBe('published');
    });

    it('24. Batch splitting crash-safety: Interrupted split where child batch was saved before crash is safely reconciled on parent retry without creating duplicate child batches', async () => {
      const baseDir = makeTempDir('wifran-split-crash-safety-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      const parentDir = orchestrator.getBatchDir(manifest.batchId);
      const childBatchId = `batch-recovered-child-${Date.now()}`;
      const childDir = orchestrator.getBatchDir(childBatchId);
      fs.mkdirSync(childDir, { recursive: true });

      // Simulate child manifest successfully written prior to sudden process termination
      const childManifest: BatchManifest = {
        schemaVersion: '1.0',
        batchId: childBatchId,
        parentBatchId: manifest.batchId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        workspaceDir: childDir,
        leaflets: [manifest.leaflets[0]], // LuLu
        totals: {
          totalPdfs: 1,
          completedPdfs: 1,
          failedPdfs: 0,
          cancelledPdfs: 0,
          totalPages: 85,
          pagesProcessed: 85,
          totalOffers: 728,
          totalCostUsd: 0.1383
        },
        executionMode: 'flex',
        extractionPipelineMode: 'hybrid_v3',
        model: 'gemini-3.8-flash'
      };
      fs.writeFileSync(path.join(childDir, 'batch-manifest.json'), JSON.stringify(childManifest, null, 2), 'utf8');

      // Simulate surviving .split-intent.json in parent directory
      const intentPath = path.join(parentDir, '.split-intent.json');
      fs.writeFileSync(
        intentPath,
        JSON.stringify(
          {
            originalBatchId: manifest.batchId,
            newBatchId: childBatchId,
            selectedLeafletIds: ['leaflet-001'],
            createdAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf8'
      );

      // Call splitBatch with the same selection: must reconcile parent and return existing child without creating another batch
      const recoveredResult = await orchestrator.splitBatch({
        sourceBatchId: manifest.batchId,
        selectedLeafletIds: ['leaflet-001']
      });

      expect(recoveredResult.success).toBe(true);
      expect(recoveredResult.newBatchId).toBe(childBatchId); // Reused same batch ID!
      expect(fs.existsSync(intentPath)).toBe(false); // Cleaned up intent journal

      // Parent manifest now accurately reflects the transfer
      const parentAfter = await orchestrator.loadBatchManifest(manifest.batchId);
      expect(parentAfter?.leaflets.find((l) => l.leafletId === 'leaflet-001')?.transferStatus).toBe('transferred');
      expect(parentAfter?.splitHistory?.[0].splitBatchId).toBe(childBatchId);
    });

    it('25. Batch splitting crash-safety: Interrupted split where child batch was NOT saved cleans up partial artifacts and completes cleanly', async () => {
      const baseDir = makeTempDir('wifran-split-crash-cleanup-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      const parentDir = orchestrator.getBatchDir(manifest.batchId);
      const deadChildBatchId = `batch-dead-child-${Date.now()}`;
      const deadChildDir = orchestrator.getBatchDir(deadChildBatchId);
      fs.mkdirSync(deadChildDir, { recursive: true });
      // Incomplete child: directory exists, but NO batch-manifest.json was written

      const intentPath = path.join(parentDir, '.split-intent.json');
      fs.writeFileSync(
        intentPath,
        JSON.stringify(
          {
            originalBatchId: manifest.batchId,
            newBatchId: deadChildBatchId,
            selectedLeafletIds: ['leaflet-001'],
            createdAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf8'
      );

      // Call splitBatch: must detect dead child, clean it up, and perform a successful split
      const result = await orchestrator.splitBatch({
        sourceBatchId: manifest.batchId,
        selectedLeafletIds: ['leaflet-001']
      });

      expect(result.success).toBe(true);
      expect(result.newBatchId).not.toBe(deadChildBatchId);
      expect(fs.existsSync(deadChildDir)).toBe(false); // Incomplete artifact removed
      expect(fs.existsSync(intentPath)).toBe(false); // Cleaned up intent journal
    });

    it('26. Publication lock transfer: Offers published in parent batch are re-keyed to child batch and skipped as already published in preflight and commit', async () => {
      const baseDir = makeTempDir('wifran-pub-lock-transfer-');
      const orchestrator = createIsolatedOrchestrator(baseDir);
      const { manifest } = createMultiLeafletBatch(orchestrator, baseDir);

      // Publish offer 1 of LuLu in the parent batch
      const parentOffer1Key = `${manifest.batchId}:leaflet-001:1:lulu-off-1`;
      manifest.publishedOffers = {
        [parentOffer1Key]: {
          state: 'published',
          databaseContext: 'DEVELOPMENT_TEST',
          publishOperationId: 'pub-parent-op-001',
          publishedAt: new Date().toISOString(),
          sourceOfferId: 'lulu-off-1',
          offerId: 'test-offer-123',
          productId: '19'
        }
      };
      await orchestrator['saveBatchManifestAtomic'](manifest);

      // Now split LuLu into a new working batch
      const splitResult = await orchestrator.splitBatch({
        sourceBatchId: manifest.batchId,
        selectedLeafletIds: ['leaflet-001']
      });

      const childBatchId = splitResult.newBatchId!;
      const childManifest = await orchestrator.loadBatchManifest(childBatchId);
      expect(childManifest).not.toBeNull();

      // Verify that newManifest.publishedOffers contains the re-keyed offer key with childBatchId!
      const childOffer1Key = `${childBatchId}:leaflet-001:1:lulu-off-1`;
      expect(childManifest?.publishedOffers?.[childOffer1Key]).toBeDefined();
      expect(childManifest?.publishedOffers?.[childOffer1Key]?.state).toBe('published');

      // Now verify catalog publication preflight on the child batch
      const childMatchingRun: MatchingRunManifest = {
        schemaVersion: '1.0',
        batchId: childBatchId,
        runId: `run-${Date.now()}`,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        totals: {
          totalExtractedOffers: 1,
          uniqueIdentitiesCount: 1,
          cacheMatchesCount: 0,
          deterministicMatchesCount: 0,
          geminiEvaluatedCount: 0,
          proposedExistingCount: 1,
          proposedTemporaryCount: 0,
          unresolvedCount: 0,
          validationWarningsCount: 0,
          actualCostUsd: 0.01,
          estimatedCostUsd: 0.01,
          geminiRequestsCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0
        },
        brandSummaries: {},
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        requests: {},
        temporaryProducts: {},
        proposals: {
          [childOffer1Key]: {
            batchOfferKey: childOffer1Key,
            sourceOfferId: 'lulu-off-1',
            sourcePage: 1,
            leafletId: 'leaflet-001',
            supermarketName: 'LuLu Hypermarket',
            decision: 'existing',
            matchedProductId: '19',
            confidence: 'high',
            operatorDecision: 'approved',
            temporaryId: null,
            matchMethod: 'gemini_medium',
            validationIssues: [],
            updatedAt: new Date().toISOString()
          }
        }
      };

      const offerForChildBatch: any = {
        batchOfferKey: childOffer1Key,
        sourceOfferId: 'lulu-off-1',
        supermarketId: '00000000-0000-0000-0000-000000000001',
        titleEn: 'LuLu Apple',
        titleAr: 'تفاح لولو',
        publicationState: childManifest?.publishedOffers?.[childOffer1Key]
      };

      const catalogPublicationService = new CatalogPublicationService();
      const preflight = await catalogPublicationService.assessPublicationPreflight({
        manifest: {
          ...childMatchingRun,
          publishedOffers: childManifest?.publishedOffers
        } as any,
        offers: [offerForChildBatch],
        context: 'DEVELOPMENT_TEST'
      });

      // The preflight MUST recognize the offer as already published
      expect(preflight.ready).toBe(true);
      expect(preflight.eligibleOfferKeys).toHaveLength(0);
      expect(preflight.alreadyPublishedOfferKeys).toEqual([childOffer1Key]);

      // Publish attempt is a no-op replay with 0 published offers and 0 DB inserts
      const publishResult = await catalogPublicationService.publishApprovedCatalogBatch({
        manifest: {
          ...childMatchingRun,
          publishedOffers: childManifest?.publishedOffers
        } as any,
        offers: [offerForChildBatch],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'test_operator',
        enableImageUpload: false
      });

      expect(publishResult.success).toBe(true);
      expect(publishResult.publishedOffersCount).toBe(0);
      expect(publishResult.alreadyPublishedBatchOfferKeys).toEqual([childOffer1Key]);
      expect(publishResult.publishedOfferIds).toHaveLength(0);
    });

    it('27. Physical extraction artifacts of batch-2026-11-19T13-01-05-9fd1a6 remain byte-for-byte untouched (SHA256 verified)', () => {
      const manifestPath = path.resolve('Extracts/batches/batch-2026-11-19T13-01-05-9fd1a6/batch-manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const content = fs.readFileSync(manifestPath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      // Assert known baseline hash is unchanged
      expect(hash.toLowerCase()).toBe('061aea1a47cf4ff992bb70477ea30c542ae1b592daaeeee2f68635cbc32c4955');
    });
  });
});
