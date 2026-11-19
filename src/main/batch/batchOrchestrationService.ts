import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type {
  BatchManifest,
  LeafletBatchItem,
  UnifiedBatchOffer,
  UnifiedBatchSummary,
  BatchFilterOptions,
  BatchProgressEvent,
  BatchProcessingStages,
  BatchMatchingStageSummary,
  LeafletMetadataScope,
  LeafletMetadataRevision,
  MetadataAcceptanceStatus,
  GeographicScopeSource,
  MetadataFieldEvidenceSummary,
  MetadataFieldKey,
  MetadataValidityConflictSummary,
  OfferBatchPublicationState,
  ExtractionPipelineMode,
  PageSelectionMode,
  PublishedOfferImageRepairResult,
  ActiveWorkflowSession
} from '../../shared/types/batchExtraction';
import {
  confirmDerivedTierCropOnDisk,
  executeOrPreviewPublishedOfferRepairs
} from './publishedOfferRepairService';
import type { SqlQueryable } from '../db/schemaCompatibilityService';
import type { StorageLifecycleAdapter } from '../storage/stagedStorageLifecycleService';
import { revalidateOfferItem, normalizeAssortedTitle } from '../../shared/utils/offerRevalidation';
import {
  hasCompleteCoreLeafletMetadata,
  isLeafletMetadataAccepted
} from '../../shared/utils/reviewTriageClassifier';
import type { MatchingProgressEvent } from '../../shared/types/catalogMatching';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DatabaseContext } from '../db/databaseEnvironmentResolver';
import { CatalogMatchingOrchestrator } from './catalogMatchingOrchestrator';
import type { HybridExtractionProvider, HybridPageRunResult } from '../../shared/types/hybridExtractionV3';
import { renderPdfPagesStreaming } from '../pdf/streamingPdfRenderService';
import { sharedPageFirstPipelineService } from '../page-first/pageFirstPipelineService';
import { loadStagedLeafletDraft, initializeStagedDraftFromPackage } from '../db/stagedLeafletDraftService';
import { runHybridV3LeafletExtraction } from './hybridV3BatchProcessor';
import { GeminiCostLedgerService, buildLedgerEntryFromProviderCall } from '../ocr/geminiCostLedgerService';
import { loadExtractionManifest, updateExtractionManifest } from '../extraction/extractionManifestService';
import { getLeafletMetadataService } from '../metadata/leafletMetadataService';
import { sanitizeCampaignTitle } from '../metadata/campaignTitleSanitizer';
import {
  extractStrictIsoDate,
  normalizeValidityRange,
  parseValidityDates
} from '../metadata/validityDateParser';
import { MASTER_CITIES, MASTER_SUPERMARKETS } from '../db/referenceDataService';
import {
  SUPERMARKET_SYNONYMS,
  normalizeEntityText,
  stripRegionNoiseWords,
  stripSupermarketNoiseWords
} from '../db/supermarketRegionResolutionService';
import {
  isLikelyFilenameSlug,
  prepareMetadataVisionImages,
  renderCoverPagePreviewToDataUrl,
  type PdfCoverPreviewResult
} from '../metadata/pdfCoverMetadataExtractor';
import { estimateBatchApiCost } from '../ocr/hybrid/hybridCostLatencyGovernor';
import {
  estimateMetadataVisionCost,
  type MetadataVisionCostEstimate
} from '../../shared/utils/geminiPricingAndCostEstimator';
import { info as logInfo, warn as logWarn, error as logError } from '../logging/logger';
import { MatchingEvidenceOverlayService } from '../db/matchingEvidenceOverlayService';
import { findMatchingRawExtractionEntry } from '../../shared/utils/canonicalRawAttributes';
import {
  DocumentExtractionHistoryService,
  sharedDocumentExtractionHistoryService,
  type DuplicateCandidateFileInput,
  type PreExtractionDuplicateInspectionResult
} from '../cache/documentExtractionHistoryService';
import { computeDocumentIdFromFingerprint } from '../../shared/utils/sourceIdentityAndDuplicateUtils';

export interface BatchCreateInput {
  files: Array<{
    path: string;
    name?: string;
    sizeBytes?: number;
    contentFingerprint?: string;
    pageCount?: number;
    pagesToProcess?: number[];
    pageSelectionMode?: PageSelectionMode;
    pageSelectionInput?: string;
    workspacePath?: string;
    metadata?: LeafletMetadataScope;
  }>;
  executionMode?: 'flex' | 'standard';
  extractionPipelineMode?: ExtractionPipelineMode;
  model?: string;
  approvedMaxBudgetUsd?: number | null;
  autoRunCatalogMatching?: boolean;
  targetDatabaseContext?: DatabaseContext;
}

export interface BatchExtractionOptions {
  forceReextract?: boolean;
  mockResponses?: Map<string, Map<number, any>>; // leafletId -> pageNumber -> mockResponse
  hybridV3Provider?: HybridExtractionProvider;
  hybridV3ExplicitAuthorization?: boolean;
  hybridV3FeatureEnabled?: boolean;
  hybridV3ExplicitLiveAuthorization?: boolean;
  disablePageContextVerification?: boolean;
  skipPdfRenderIfPagesExist?: boolean;
  reauthorizeExpandedScope?: boolean;
  approvedMaxBudgetUsd?: number | null;
  approvedAdditionalBudgetUsd?: number;
  requireVerifiedMetadata?: boolean;
  skipMetadataVerificationCheck?: boolean;
  autoRunCatalogMatching?: boolean;
  targetDatabaseContext?: DatabaseContext;
  catalogMatchingSupabase?: SupabaseClient | null;
  catalogMatchingOrchestrator?: CatalogMatchingOrchestrator;
  onMatchingProgress?: (event: MatchingProgressEvent) => void;
}

export class BatchOrchestrationService {
  private activeCancellations = new Map<string, boolean>();
  private scopedHistoryService: DocumentExtractionHistoryService | null = null;

  constructor(private customBatchesBaseDir?: string) { }

  public getHistoryService(): DocumentExtractionHistoryService {
    if (!this.customBatchesBaseDir) {
      return sharedDocumentExtractionHistoryService;
    }
    if (!this.scopedHistoryService) {
      const historyBaseDir =
        path.basename(this.customBatchesBaseDir).toLowerCase() === 'batches'
          ? path.dirname(this.customBatchesBaseDir)
          : this.customBatchesBaseDir;
      this.scopedHistoryService = new DocumentExtractionHistoryService({
        baseDir: historyBaseDir
      });
    }
    return this.scopedHistoryService;
  }

  public getBatchesBaseDir(): string {
    const fullPath =
      this.customBatchesBaseDir ||
      path.join(process.cwd(), process.env.WIFRAN_OFFLINE_UAT === '1' ? 'workspaces_uat/batches' : 'Extracts/batches');
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    return fullPath;
  }

  public getBatchDir(batchId: string): string {
    return path.join(this.getBatchesBaseDir(), batchId);
  }

  public getBatchManifestPath(batchId: string): string {
    return path.join(this.getBatchDir(batchId), 'batch-manifest.json');
  }

  private getCostLedgerService(): GeminiCostLedgerService {
    return new GeminiCostLedgerService(this.getBatchesBaseDir());
  }

  private async syncWorkspaceManifestStatus(
    leaflet: LeafletBatchItem,
    nextStatus: 'in_progress' | 'completed' | 'paused' | 'failed'
  ): Promise<void> {
    try {
      const existing = await loadExtractionManifest(leaflet.workspacePath);
      if (existing) {
        const mappedSelectionStatus: 'not_started' | 'in_progress' | 'completed' | 'partial' | 'failed' =
          nextStatus === 'completed'
            ? 'completed'
            : nextStatus === 'failed'
              ? 'failed'
              : nextStatus === 'paused'
                ? 'partial'
                : 'in_progress';
        const patch: any = {
          extraction_status: nextStatus === 'failed' ? 'paused' : nextStatus,
          ...(nextStatus === 'completed' ? { completed_at: new Date().toISOString() } : {})
        };
        if ((existing as any).processing_selection) {
          patch.processing_selection = {
            ...(existing as any).processing_selection,
            processingStatus: mappedSelectionStatus
          };
        }
        const updated = await updateExtractionManifest(leaflet.workspacePath, patch);
        // Ensure explicit 'failed' extraction_status is preserved if caller indicated failure
        if (nextStatus === 'failed') {
          (updated as any).extraction_status = 'failed';
          await fs.promises
            .writeFile(
              path.join(leaflet.workspacePath, 'extraction_manifest.json'),
              JSON.stringify(updated, null, 2),
              'utf8'
            )
            .catch(() => {});
          await fs.promises
            .writeFile(
              path.join(leaflet.workspacePath, 'manifest.json'),
              JSON.stringify(updated, null, 2),
              'utf8'
            )
            .catch(() => {});
        }
      }
      const metaJsonPaths = [
        path.join(leaflet.workspacePath, 'metadata.json'),
        path.join(leaflet.workspacePath, 'metadata', 'metadata.json')
      ];
      for (const metaPath of metaJsonPaths) {
        if (fs.existsSync(metaPath)) {
          try {
            const metaObj = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            metaObj.extractionStatus = nextStatus;
            metaObj.updatedAt = new Date().toISOString();
            fs.writeFileSync(metaPath, JSON.stringify(metaObj, null, 2), 'utf8');
          } catch {
            // Non-fatal metadata sync
          }
        }
      }
    } catch {
      // Non-fatal workspace status sync
    }
  }

  public async saveBatchManifestAtomic(manifest: BatchManifest): Promise<void> {
    const batchDir = this.getBatchDir(manifest.batchId);
    if (!fs.existsSync(batchDir)) {
      fs.mkdirSync(batchDir, { recursive: true });
    }
    manifest.updatedAt = new Date().toISOString();
    const manifestPath = this.getBatchManifestPath(manifest.batchId);
    const tempPath = `${manifestPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    await fs.promises.writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf8');
    let lastErr: any = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await fs.promises.rename(tempPath, manifestPath);
        return;
      } catch (err: any) {
        lastErr = err;
        if ((err?.code === 'EPERM' || err?.code === 'EBUSY' || err?.code === 'EACCES') && attempt < 3) {
          await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
          continue;
        }
        break;
      }
    }
    try {
      if (fs.existsSync(tempPath)) await fs.promises.unlink(tempPath);
    } catch {
      // Ignore temp cleanup failure
    }
    throw lastErr;
  }

  public async loadBatchManifest(batchId: string): Promise<BatchManifest | null> {
    const manifestPath = this.getBatchManifestPath(batchId);
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    try {
      const raw = await fs.promises.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw) as BatchManifest;
      if (Array.isArray(manifest.leaflets)) {
        for (const leaflet of manifest.leaflets) {
          if (leaflet.metadata) {
            leaflet.metadata = this.sanitizeLeafletMetadataFields(leaflet.metadata, {
              fileName: leaflet.fileName
            });
          }
        }
      }
      // Recompute lifecycle statuses and active totals
      this.recomputeTotals(manifest);
      // Hydrate costSummary read-only in memory from gemini-cost-ledger.json when available
      try {
        const ledgerSvc = this.getCostLedgerService();
        ledgerSvc.reconcileHistoricalArchives(manifest.batchId, manifest.leaflets);
        const ledger = ledgerSvc.loadLedger(manifest.batchId);
        if (!manifest.costSummary || ledger.entries.length > 0) {
          manifest.costSummary = ledgerSvc.computeCostSummary({
            batchId: manifest.batchId,
            manifest
          });
          if (ledger.entries.length > 0) {
            manifest.totals.totalCostUsd = manifest.costSummary.totalMeasuredCostUsd;
          }
        }
      } catch {
        // Non-fatal read-only hydration fallback
      }
      return manifest;
    } catch (err: any) {
      logError(`Failed to load batch manifest for ${batchId}: ${err.message}`);
      return null;
    }
  }

  public async listBatches(): Promise<BatchManifest[]> {
    const baseDir = this.getBatchesBaseDir();
    if (!fs.existsSync(baseDir)) return [];

    const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
    const manifests: BatchManifest[] = [];

    for (const ent of entries) {
      if (ent.isDirectory()) {
        const manifest = await this.loadBatchManifest(ent.name);
        if (manifest) {
          manifests.push(manifest);
        }
      }
    }

    manifests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return manifests;
  }

  public async getActiveWorkflowSession(): Promise<ActiveWorkflowSession | null> {
    const sessionPath = path.join(this.getBatchesBaseDir(), '.active-workflow-session.json');
    if (!fs.existsSync(sessionPath)) return null;
    try {
      const raw = await fs.promises.readFile(sessionPath, 'utf8');
      return JSON.parse(raw) as ActiveWorkflowSession;
    } catch {
      return null;
    }
  }

  public async setActiveWorkflowSession(session: Partial<ActiveWorkflowSession>): Promise<ActiveWorkflowSession> {
    const sessionPath = path.join(this.getBatchesBaseDir(), '.active-workflow-session.json');
    const existing = await this.getActiveWorkflowSession();
    const updated: ActiveWorkflowSession = {
      schemaVersion: 'wifran.workflow.session/1.0',
      activeBatchId: session.activeBatchId !== undefined ? session.activeBatchId : existing?.activeBatchId ?? null,
      activeStep: session.activeStep !== undefined ? session.activeStep : existing?.activeStep ?? 2,
      selectedLeafletIds: session.selectedLeafletIds !== undefined ? session.selectedLeafletIds : existing?.selectedLeafletIds ?? [],
      updatedAt: new Date().toISOString()
    };
    await fs.promises.writeFile(sessionPath, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  }

  public async clearActiveWorkflowSession(): Promise<boolean> {
    const sessionPath = path.join(this.getBatchesBaseDir(), '.active-workflow-session.json');
    if (fs.existsSync(sessionPath)) {
      try {
        await fs.promises.unlink(sessionPath);
      } catch {
        // Non-fatal
      }
    }
    return true;
  }

  /**
   * STANDARD BATCH SPLITTING (PART B):
   * Allows operators to select one or multiple leaflets at Step 2 and transfer them into a new working batch.
   * If all remaining active leaflets are selected, continues inside current batch without unnecessary split.
   * Preserves all immutable extraction identities, drafts, checkpoints, crops, and matching proposals.
   */
  public async splitBatch(input: {
    originalBatchId?: string;
    sourceBatchId?: string;
    selectedLeafletIds: string[];
    operatorId?: string;
  }): Promise<{
    success: boolean;
    newBatchId: string | null;
    manifest: BatchManifest;
    transferredLeafletCount: number;
    newBatchManifest: BatchManifest;
    originalBatchManifest: BatchManifest;
    isSubSplit: boolean;
  }> {
    const originalBatchId = input.originalBatchId || input.sourceBatchId;
    if (!originalBatchId) {
      throw new Error('MISSING_BATCH_ID: An originalBatchId or sourceBatchId must be provided.');
    }
    const originalManifest = await this.loadBatchManifest(originalBatchId);
    if (!originalManifest) {
      throw new Error(`Original batch manifest not found: ${originalBatchId}`);
    }

    const originalBatchDir = this.getBatchDir(originalBatchId);
    const intentPath = path.join(originalBatchDir, '.split-intent.json');

    // Crash-Recovery Check: Reconcile any prior interrupted split attempt
    if (fs.existsSync(intentPath)) {
      try {
        const intent = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
        if (intent?.newBatchId) {
          const childDir = this.getBatchDir(intent.newBatchId);
          const childManifestPath = path.join(childDir, 'batch-manifest.json');
          if (fs.existsSync(childManifestPath)) {
            const childManifest = await this.loadBatchManifest(intent.newBatchId);
            if (childManifest) {
              const transSet = new Set(intent.selectedLeafletIds || []);
              originalManifest.splitHistory = originalManifest.splitHistory || [];
              if (!originalManifest.splitHistory.some((h) => h.splitBatchId === intent.newBatchId)) {
                originalManifest.splitHistory.push({
                  splitBatchId: intent.newBatchId,
                  transferredLeafletIds: intent.selectedLeafletIds || [],
                  transferredAt: intent.createdAt || new Date().toISOString()
                });
              }
              originalManifest.transferredLeaflets = originalManifest.transferredLeaflets || [];
              for (const l of originalManifest.leaflets) {
                if (transSet.has(l.leafletId)) {
                  l.transferStatus = 'transferred';
                  l.transferredToBatchId = intent.newBatchId;
                  l.transferredAt = intent.createdAt || new Date().toISOString();
                  if (!originalManifest.transferredLeaflets.some((tl) => tl.leafletId === l.leafletId)) {
                    originalManifest.transferredLeaflets.push(JSON.parse(JSON.stringify(l)));
                  }
                }
              }
              this.recomputeTotals(originalManifest);
              await this.saveBatchManifestAtomic(originalManifest);

              // If the caller is retrying this exact split, return this completed child batch!
              const isSameSelection =
                Array.isArray(input.selectedLeafletIds) &&
                input.selectedLeafletIds.length === (intent.selectedLeafletIds || []).length &&
                input.selectedLeafletIds.every((id: string) => transSet.has(id));

              if (isSameSelection) {
                try { fs.unlinkSync(intentPath); } catch {}
                await this.setActiveWorkflowSession({
                  schemaVersion: 'wifran.workflow.session/1.0',
                  activeBatchId: intent.newBatchId,
                  activeStep: 2,
                  selectedLeafletIds: input.selectedLeafletIds,
                  updatedAt: new Date().toISOString()
                });
                return {
                  success: true,
                  newBatchId: intent.newBatchId,
                  manifest: childManifest,
                  transferredLeafletCount: childManifest.leaflets.length,
                  newBatchManifest: childManifest,
                  originalBatchManifest: originalManifest,
                  isSubSplit: true
                };
              }
            }
          } else {
            if (fs.existsSync(childDir)) {
              try { fs.rmSync(childDir, { recursive: true, force: true }); } catch {}
            }
          }
        }
        try { fs.unlinkSync(intentPath); } catch {}
      } catch {
        try { fs.unlinkSync(intentPath); } catch {}
      }
    }

    if (!Array.isArray(input.selectedLeafletIds) || input.selectedLeafletIds.length === 0) {
      throw new Error('NO_LEAFLETS_SELECTED: At least one leaflet must be selected to continue.');
    }

    const selectedSet = new Set(input.selectedLeafletIds);

    // Fail closed if attempting to transfer any leaflet that is already transferred
    const alreadyTransferred = originalManifest.leaflets.filter(
      (l) => selectedSet.has(l.leafletId) && (l.transferStatus === 'transferred' || Boolean(l.transferredToBatchId))
    );
    if (alreadyTransferred.length > 0) {
      throw new Error(
        `CANNOT_TRANSFER_ALREADY_TRANSFERRED: Leaflet(s) [${alreadyTransferred
          .map((l) => l.leafletId)
          .join(', ')}] are already transferred.`
      );
    }

    const activeOriginalLeaflets = originalManifest.leaflets.filter(
      (l) => l.transferStatus !== 'transferred'
    );

    const validSelectedLeaflets = activeOriginalLeaflets.filter((l) =>
      selectedSet.has(l.leafletId)
    );
    if (validSelectedLeaflets.length === 0) {
      throw new Error('INVALID_SELECTION: None of the selected leaflets are active in this batch.');
    }

    // Fail closed if attempting to transfer any leaflet that is already fully published
    const alreadyPublished = validSelectedLeaflets.filter((l) => l.publicationStatus === 'published');
    if (alreadyPublished.length > 0) {
      throw new Error(
        `CANNOT_TRANSFER_PUBLISHED: Leaflet(s) [${alreadyPublished
          .map((l) => l.leafletId)
          .join(', ')}] are already fully published and cannot be transferred.`
      );
    }

    // If ALL remaining active leaflets are selected, continue inside existing batch (no duplicate batch)
    if (validSelectedLeaflets.length === activeOriginalLeaflets.length) {
      await this.setActiveWorkflowSession({
        schemaVersion: 'wifran.workflow.session/1.0',
        activeBatchId: originalBatchId,
        activeStep: 3,
        selectedLeafletIds: input.selectedLeafletIds,
        updatedAt: new Date().toISOString()
      });
      return {
        success: true,
        newBatchId: null,
        manifest: originalManifest,
        transferredLeafletCount: 0,
        newBatchManifest: originalManifest,
        originalBatchManifest: originalManifest,
        isSubSplit: false
      };
    }

    // Proper subset selected -> Create new working batch
    const nowIso = new Date().toISOString();
    const tsStr = nowIso.replace(/[:.]/g, '-');
    const randomHex = crypto.randomUUID().slice(0, 6);
    const newBatchId = `batch-${tsStr.slice(0, 19)}-${randomHex}`;
    const newBatchDir = this.getBatchDir(newBatchId);

    // Record write-ahead split intent before mutating filesystem
    try {
      fs.writeFileSync(
        intentPath,
        JSON.stringify(
          {
            originalBatchId,
            newBatchId,
            selectedLeafletIds: input.selectedLeafletIds,
            createdAt: nowIso
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      // Non-fatal intent logging
    }

    fs.mkdirSync(newBatchDir, { recursive: true });

    // Deep copy transferred leaflets for new batch, retaining original lineage
    const transferredLeafletsForNewBatch: LeafletBatchItem[] = validSelectedLeaflets.map((l) => ({
      ...JSON.parse(JSON.stringify(l)),
      originalBatchId: l.originalBatchId || originalBatchId,
      transferStatus: 'active',
      transferredToBatchId: null,
      transferredAt: nowIso
    }));

    // Construct new manifest preserving immutable identities
    const newManifest: BatchManifest = {
      schemaVersion: '1.0',
      batchId: newBatchId,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'created',
      parentBatchId: originalBatchId,
      workspaceDir: newBatchDir,
      leaflets: transferredLeafletsForNewBatch,
      totals: {
        totalPdfs: transferredLeafletsForNewBatch.length,
        completedPdfs: transferredLeafletsForNewBatch.filter((l) => l.status === 'completed').length,
        failedPdfs: transferredLeafletsForNewBatch.filter((l) => l.status === 'failed').length,
        cancelledPdfs: transferredLeafletsForNewBatch.filter((l) => l.status === 'cancelled').length,
        totalPages: transferredLeafletsForNewBatch.reduce(
          (sum, l) => sum + (l.pagesToProcess?.length || l.pageCount || 1),
          0
        ),
        pagesProcessed: transferredLeafletsForNewBatch.reduce((sum, l) => sum + (l.pagesProcessed || 0), 0),
        totalOffers: transferredLeafletsForNewBatch.reduce((sum, l) => sum + (l.offersCount || 0), 0),
        totalCostUsd: transferredLeafletsForNewBatch.reduce((sum, l) => sum + (l.estimatedCostUsd || 0), 0)
      },
      executionMode: originalManifest.executionMode,
      extractionPipelineMode: originalManifest.extractionPipelineMode,
      approvedScope: originalManifest.approvedScope
        ? {
            ...JSON.parse(JSON.stringify(originalManifest.approvedScope)),
            authorizedAt: nowIso
          }
        : undefined,
      processingStages: originalManifest.processingStages
        ? { ...originalManifest.processingStages }
        : undefined,
      model: originalManifest.model,
      error: null
    };

    // Propagate published offers if any of the transferred leaflets already had published offers
    // Crucial: Re-key published offers to `${newBatchId}:...` so child batch immediately locks them
    if (originalManifest.publishedOffers) {
      newManifest.publishedOffers = {};
      const oldPrefix = `${originalBatchId}:`;
      const newPrefix = `${newBatchId}:`;
      for (const [key, pubState] of Object.entries(originalManifest.publishedOffers)) {
        const parts = key.split(':');
        const leafletId = parts[1];
        if (selectedSet.has(leafletId)) {
          const rekeyed = key.startsWith(oldPrefix)
            ? key.replace(oldPrefix, newPrefix)
            : `${newBatchId}:${parts.slice(1).join(':')}`;
          newManifest.publishedOffers[rekeyed] = {
            ...pubState,
            batchOfferKey: rekeyed
          };
          // Also keep original key for backward/lineage compatibility
          newManifest.publishedOffers[key] = { ...pubState };
        }
      }
    }

    // Transfer matching proposals if catalog matching has already run for these leaflets
    const parentMatchingFile = path.join(
      this.getBatchDir(originalBatchId),
      'catalog-matching',
      'matching-proposals.json'
    );
    if (fs.existsSync(parentMatchingFile)) {
      try {
        const parentMatching = JSON.parse(fs.readFileSync(parentMatchingFile, 'utf8'));
        if (parentMatching?.proposals) {
          const newMatchingDir = path.join(newBatchDir, 'catalog-matching');
          fs.mkdirSync(newMatchingDir, { recursive: true });
          const newProposals: Record<string, any> = {};
          const oldPrefix = `${originalBatchId}:`;
          const newPrefix = `${newBatchId}:`;
          for (const [offerKey, prop] of Object.entries(parentMatching.proposals)) {
            const parts = offerKey.split(':');
            const leafletId = parts[1];
            if (selectedSet.has(leafletId)) {
              const mappedKey = offerKey.startsWith(oldPrefix)
                ? offerKey.replace(oldPrefix, newPrefix)
                : offerKey;
              newProposals[mappedKey] = {
                ...(prop as any),
                batchOfferKey: mappedKey
              };
            }
          }
          const newMatchingManifest = {
            ...parentMatching,
            batchId: newBatchId,
            createdAt: nowIso,
            updatedAt: nowIso,
            proposals: newProposals,
            totals: {
              ...(parentMatching.totals || {}),
              totalExtractedOffers: Object.keys(newProposals).length
            }
          };
          fs.writeFileSync(
            path.join(newMatchingDir, 'matching-proposals.json'),
            JSON.stringify(newMatchingManifest, null, 2),
            'utf8'
          );
        }
      } catch {
        // Non-fatal matching proposals copy
      }
    }

    // Transfer Gemini cost ledger entries for selected leaflets
    const parentLedgerFile = path.join(this.getBatchDir(originalBatchId), 'gemini-cost-ledger.json');
    if (fs.existsSync(parentLedgerFile)) {
      try {
        const parentLedger = JSON.parse(fs.readFileSync(parentLedgerFile, 'utf8'));
        if (Array.isArray(parentLedger.records)) {
          const transferredRecords = parentLedger.records.filter((r: any) => selectedSet.has(r.leafletId));
          const remainingRecords = parentLedger.records.filter((r: any) => !selectedSet.has(r.leafletId));

          const newLedger = {
            batchId: newBatchId,
            totalCostUsd: transferredRecords.reduce((acc: number, r: any) => acc + (r.costUsd || 0), 0),
            records: transferredRecords
          };
          fs.writeFileSync(path.join(newBatchDir, 'gemini-cost-ledger.json'), JSON.stringify(newLedger, null, 2), 'utf8');

          parentLedger.records = remainingRecords;
          parentLedger.totalCostUsd = remainingRecords.reduce((acc: number, r: any) => acc + (r.costUsd || 0), 0);
          fs.writeFileSync(parentLedgerFile, JSON.stringify(parentLedger, null, 2), 'utf8');
        }
      } catch {
        // Non-fatal ledger transfer
      }
    }

    // Recompute totals & lifecycle statuses for the new manifest
    this.recomputeTotals(newManifest);

    // If all transferred leaflets are already completed, set extraction stage completed
    const allTransferredCompleted = newManifest.leaflets.every((l) => l.status === 'completed');
    if (allTransferredCompleted) {
      newManifest.status = 'completed';
      if (newManifest.processingStages) {
        newManifest.processingStages.extraction = 'completed';
      }
    }

    // Update original manifest:
    // Mark transferred leaflets on original manifest and record splitHistory
    originalManifest.transferredLeaflets = originalManifest.transferredLeaflets || [];
    originalManifest.splitHistory = originalManifest.splitHistory || [];
    originalManifest.splitHistory.push({
      splitBatchId: newBatchId,
      transferredLeafletIds: input.selectedLeafletIds,
      transferredAt: nowIso
    });

    for (const leaflet of originalManifest.leaflets) {
      if (selectedSet.has(leaflet.leafletId)) {
        leaflet.transferStatus = 'transferred';
        leaflet.transferredToBatchId = newBatchId;
        leaflet.transferredAt = nowIso;
        if (!originalManifest.transferredLeaflets.some((tl) => tl.leafletId === leaflet.leafletId)) {
          originalManifest.transferredLeaflets.push(JSON.parse(JSON.stringify(leaflet)));
        }
      }
    }
    originalManifest.updatedAt = nowIso;

    // Recompute totals for original manifest with remaining active leaflets
    this.recomputeTotals(originalManifest);
    const activeRemaining = originalManifest.leaflets.filter((l) => l.transferStatus !== 'transferred');
    if (activeRemaining.length === 0) {
      // Empty container batch is completed, not failed
      originalManifest.status = 'completed';
    }

    // Save both manifests atomically
    await this.saveBatchManifestAtomic(newManifest);
    await this.saveBatchManifestAtomic(originalManifest);

    // Clean up split intent journal
    try {
      if (fs.existsSync(intentPath)) fs.unlinkSync(intentPath);
    } catch {
      // Non-fatal
    }

    // Update active workflow session to point to the new batch at Step 2
    await this.setActiveWorkflowSession({
      schemaVersion: 'wifran.workflow.session/1.0',
      activeBatchId: newBatchId,
      activeStep: 2,
      selectedLeafletIds: input.selectedLeafletIds,
      updatedAt: nowIso
    });

    return {
      success: true,
      newBatchId,
      manifest: newManifest,
      transferredLeafletCount: validSelectedLeaflets.length,
      newBatchManifest: newManifest,
      originalBatchManifest: originalManifest,
      isSubSplit: true
    };
  }

  /**
   * DUP-01A..G: Inspects candidate PDFs & page selections against within-batch duplicates
   * and historical extraction history before spending API credits.
   */
  public inspectPreExtractionDuplicates(params: {
    files: DuplicateCandidateFileInput[];
    extractionPipelineMode?: ExtractionPipelineMode;
    modelId?: string;
    tier?: 'flex' | 'standard';
    forceReextract?: boolean;
    historyService?: DocumentExtractionHistoryService;
  }): PreExtractionDuplicateInspectionResult {
    const svc = params.historyService || this.getHistoryService();
    return svc.inspectPreExtractionDuplicates(params);
  }

  /**
   * Creates a new durable batch manifest from selected PDF files.
   * Performs duplicate detection and assigns durable leaflet identities.
   */
  public async createBatch(input: BatchCreateInput): Promise<BatchManifest> {
    if (!input.files || input.files.length === 0) {
      throw new Error('Cannot create batch: No PDF files provided.');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    const batchId = `batch-${timestamp}-${randomSuffix}`;
    const batchDir = this.getBatchDir(batchId);

    const seenFingerprints = new Set<string>();
    const seenPaths = new Set<string>();
    const leaflets: LeafletBatchItem[] = [];
    let leafletIndex = 1;

    for (const f of input.files) {
      const normPath = path.normalize(f.path);
      if (seenPaths.has(normPath)) {
        logWarn(`Duplicate file path skipped in batch creation: ${normPath}`);
        continue;
      }
      seenPaths.add(normPath);

      const baseName = f.name || path.basename(f.path);
      let sizeBytes = f.sizeBytes;
      if (!sizeBytes && fs.existsSync(f.path)) {
        try {
          const st = fs.statSync(f.path);
          sizeBytes = st.size;
        } catch {
          sizeBytes = 0;
        }
      }

      // Compute sha256 content fingerprint if missing
      let fingerprint = f.contentFingerprint;
      if (!fingerprint && fs.existsSync(f.path)) {
        try {
          const buf = fs.readFileSync(f.path);
          fingerprint = crypto.createHash('sha256').update(buf).digest('hex');
        } catch {
          fingerprint = `unknown-${Date.now()}-${leafletIndex}`;
        }
      }

      if (fingerprint && seenFingerprints.has(fingerprint)) {
        logWarn(`Duplicate content fingerprint skipped in batch creation: ${fingerprint} (${baseName})`);
        continue;
      }
      if (fingerprint) {
        seenFingerprints.add(fingerprint);
      }

      const leafletId = `leaflet-${String(leafletIndex++).padStart(3, '0')}`;
      const nameWithoutExt = baseName.replace(/\.[^/.]+$/, '');
      const workspaceFolder = process.env.WIFRAN_OFFLINE_UAT === '1' ? 'workspaces_uat' : 'Extracts';
      const workspacePath = f.workspacePath || path.join(process.cwd(), workspaceFolder, nameWithoutExt);

      // Fresh metadata safety: NEVER guess retailer, dates, or default locationScope='national' from filename.
      // Leave unverified fields null until discovered from leaflet pages and confirmed by the operator.
      const provided = f.metadata || {};
      const meta: LeafletMetadataScope = {
        supermarketId: provided.supermarketId ?? null,
        supermarketName: provided.supermarketName ?? null,
        locationScope: provided.locationScope ?? null,
        locationLabel: provided.locationLabel ?? null,
        locationSlug: provided.locationSlug ?? null,
        cityId: provided.cityId ?? null,
        regionId: provided.regionId ?? null,
        offerStartDate: provided.offerStartDate ?? null,
        offerEndDate: provided.offerEndDate ?? null,
        leafletTitle: provided.leafletTitle ?? null,
        currency: provided.currency ?? null,
        verified: Boolean(provided.verified),
        verifiedAt: provided.verified ? (provided.verifiedAt || new Date().toISOString()) : null,
        verifiedBy: provided.verifiedBy ?? null,
        discoverySource: provided.verified ? 'operator_verified' : 'unverified'
      };

      const declaredPageCount = f.pageCount || 1;
      let normalizedPagesToProcess: number[] | undefined = undefined;
      if (Array.isArray(f.pagesToProcess)) {
        if (f.pagesToProcess.length === 0) {
          throw new Error(
            `INVALID_PAGE_SELECTION: ${baseName} requires at least one selected page.`
          );
        }
        const seenPages = new Set<number>();
        for (const p of f.pagesToProcess) {
          if (!Number.isInteger(p) || p < 1 || p > declaredPageCount) {
            throw new Error(
              `INVALID_PAGE_SELECTION: Page ${p} is out of valid bounds (1..${declaredPageCount}) for ${baseName}.`
            );
          }
          if (seenPages.has(p)) {
            throw new Error(
              `INVALID_PAGE_SELECTION: Duplicate page number (${p}) is not allowed for ${baseName}.`
            );
          }
          seenPages.add(p);
        }
        normalizedPagesToProcess = [...f.pagesToProcess];
      } else if (f.pageSelectionMode === 'specific') {
        throw new Error(
          `INVALID_PAGE_SELECTION: Specific page mode selected for ${baseName} with no pages provided.`
        );
      }

      const resolvedSelectionMode: PageSelectionMode =
        f.pageSelectionMode ?? (normalizedPagesToProcess ? 'specific' : 'all');
      const documentId = computeDocumentIdFromFingerprint(fingerprint, baseName);

      leaflets.push({
        leafletId,
        documentId,
        fileName: baseName,
        filePath: f.path,
        fileSizeBytes: sizeBytes || 0,
        fileFingerprint: fingerprint || '',
        pageCount: declaredPageCount,
        pageSelectionMode: resolvedSelectionMode,
        ...(f.pageSelectionInput ? { pageSelectionInput: f.pageSelectionInput } : {}),
        ...(normalizedPagesToProcess ? { pagesToProcess: normalizedPagesToProcess } : {}),
        pagesProcessed: 0,
        offersCount: 0,
        estimatedCostUsd: 0,
        status: 'queued',
        workspacePath,
        provenance: 'fresh',
        metadata: meta
      });
    }

    if (leaflets.length === 0) {
      throw new Error('All selected files were duplicates or could not be inspected.');
    }

    const totalTargetPages = leaflets.reduce(
      (acc, l) => acc + (l.pagesToProcess && l.pagesToProcess.length > 0 ? l.pagesToProcess.length : (l.pageCount || 1)),
      0
    );

    const manifest: BatchManifest = {
      schemaVersion: '1.0',
      batchId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'created',
      workspaceDir: batchDir,
      leaflets,
      totals: {
        totalPdfs: leaflets.length,
        completedPdfs: 0,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: totalTargetPages,
        pagesProcessed: 0,
        totalOffers: 0,
        totalCostUsd: 0
      },
      executionMode: input.executionMode || 'flex',
      extractionPipelineMode: input.extractionPipelineMode || 'hybrid_v3',
      processingStages: {
        extraction: 'pending',
        metadata: 'pending',
        crops: 'pending',
        matching: 'pending'
      },
      model: input.model || 'gemini-3.8-flash'
    };

    await this.saveBatchManifestAtomic(manifest);
    return manifest;
  }

  /**
   * Starts or resumes batch extraction through the sequential queue.
   * Concurrency is strictly 1 to honor Gemini Flex capacity limits.
   * NOTE: Pre-extraction metadata verification is NOT mandatory; draft metadata
   * is discovered during/after extraction and verified prior to Step 5 publication.
   */
  public async startBatchExtraction(
    batchId: string,
    options?: BatchExtractionOptions,
    onProgress?: (event: BatchProgressEvent) => void
  ): Promise<BatchManifest> {
    const manifest = await this.loadBatchManifest(batchId);
    if (!manifest) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    const pagesByLeafletId: Record<string, number[]> = {};
    for (const l of manifest.leaflets) {
      pagesByLeafletId[l.leafletId] =
        l.pagesToProcess && l.pagesToProcess.length > 0
          ? [...l.pagesToProcess].sort((a, b) => a - b)
          : Array.from({ length: l.pageCount || 1 }, (_, idx) => idx + 1);
    }

    // DUP-01E/G: Determine cross-batch reusable pages so budget estimate scales to payable pages only
    const preRunInspection = !options?.forceReextract
      ? this.inspectPreExtractionDuplicates({
          files: manifest.leaflets.map((l) => ({
            path: l.filePath,
            name: l.fileName,
            contentFingerprint: l.fileFingerprint,
            pageCount: l.pageCount,
            pagesToProcess: pagesByLeafletId[l.leafletId],
            metadata: l.metadata
          })),
          extractionPipelineMode: manifest.extractionPipelineMode,
          modelId: manifest.model,
          tier: manifest.executionMode,
          forceReextract: false
        })
      : null;

    if (preRunInspection) {
      manifest.leaflets.forEach((l, idx) => {
        const fileCheck = preRunInspection.perFile[idx];
        if (fileCheck) {
          l.documentId = fileCheck.documentId;
          l.reusedPages = [...fileCheck.reusablePages];
          l.payablePages = [...fileCheck.payablePages];
        }
      });
    }

    const totalTargetPages = Object.values(pagesByLeafletId).reduce((acc, arr) => acc + arr.length, 0);
    const totalPayablePages = preRunInspection ? preRunInspection.totalPayablePages : totalTargetPages;
    const costEstimate = estimateBatchApiCost({
      targetPageCount: totalPayablePages,
      extractionPipelineMode: manifest.extractionPipelineMode,
      modelId: manifest.model,
      tier: manifest.executionMode
    });
    const autoRunCatalogMatching = Boolean(
      options?.autoRunCatalogMatching ?? manifest.approvedScope?.autoRunCatalogMatching
    );
    const targetDatabaseContext: DatabaseContext =
      options?.targetDatabaseContext ??
      manifest.approvedScope?.targetDatabaseContext ??
      'PRODUCTION_UI';
    const resolvedApprovedMaxBudgetUsd =
      typeof options?.approvedMaxBudgetUsd === 'number' &&
      Number.isFinite(options.approvedMaxBudgetUsd) &&
      options.approvedMaxBudgetUsd > 0
        ? Number(options.approvedMaxBudgetUsd.toFixed(4))
        : (manifest.approvedScope?.approvedMaxBudgetUsd ??
            (autoRunCatalogMatching ? costEstimate.maxAuthorizedTotalCapUsd : costEstimate.maxAuthorizedCapUsd));

    manifest.approvedScope = {
      hybridV3Authorized: Boolean(options?.hybridV3ExplicitAuthorization && options?.hybridV3FeatureEnabled),
      hybridV3LiveAuthorized: Boolean(options?.hybridV3ExplicitLiveAuthorization),
      pagesByLeafletId,
      totalTargetPages,
      approvedMaxBudgetUsd: resolvedApprovedMaxBudgetUsd,
      autoRunCatalogMatching,
      targetDatabaseContext,
      authorizedAt: manifest.approvedScope?.authorizedAt || new Date().toISOString()
    };

    const stages: BatchProcessingStages = {
      extraction: 'running',
      metadata: 'pending',
      crops: 'pending',
      matching: autoRunCatalogMatching ? 'pending' : 'skipped'
    };
    manifest.processingStages = { ...stages };

    const sessionRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      this.getCostLedgerService().setLatestRunId(batchId, sessionRunId);
    } catch {
      // Non-fatal ledger session init
    }

    this.activeCancellations.set(batchId, false);
    manifest.status = 'extracting';
    await this.saveBatchManifestAtomic(manifest);

    const emit = (
      stage: BatchProgressEvent['stage'],
      message: string,
      currentLeafletIndex: number,
      currentLeaflet?: LeafletBatchItem
    ) => {
      if (onProgress) {
        onProgress({
          batchId,
          currentLeafletIndex,
          totalLeaflets: manifest.leaflets.length,
          currentLeaflet,
          stage,
          message,
          totals: manifest.totals,
          processingStages: { ...stages }
        });
      }
    };

    emit('starting', `Starting extraction batch ${batchId}`, 0);

    for (let i = 0; i < manifest.leaflets.length; i++) {
      const leaflet = manifest.leaflets[i];

      // Check cancellation signal
      if (this.activeCancellations.get(batchId)) {
        logInfo(`Batch ${batchId} received cancellation signal.`);
        // Mark remaining queued leaflets as cancelled
        for (let j = i; j < manifest.leaflets.length; j++) {
          if (manifest.leaflets[j].status === 'queued') {
            manifest.leaflets[j].status = 'cancelled';
          }
        }
        manifest.status = 'cancelled';
        this.recomputeTotals(manifest);
        await this.saveBatchManifestAtomic(manifest);
        emit('batch_cancelled', `Batch ${batchId} was cancelled by operator.`, i, leaflet);
        return manifest;
      }

      // Skip already completed leaflets
      if (leaflet.status === 'completed') {
        continue;
      }

      leaflet.status = 'processing';
      leaflet.startedAt = new Date().toISOString();
      await this.saveBatchManifestAtomic(manifest);
      emit('rendering', `Processing leaflet ${i + 1}/${manifest.leaflets.length}: ${leaflet.fileName}`, i, leaflet);

      try {
        if (!fs.existsSync(leaflet.filePath)) {
          throw new Error(`PDF file not found: ${leaflet.filePath}`);
        }

        const remainingBatchBudgetUsd = Math.max(0, resolvedApprovedMaxBudgetUsd - manifest.totals.totalCostUsd);
        if (resolvedApprovedMaxBudgetUsd > 0 && manifest.totals.totalCostUsd >= resolvedApprovedMaxBudgetUsd) {
          throw new Error(
            `BUDGET_CAP_EXCEEDED: Batch spending ($${manifest.totals.totalCostUsd.toFixed(4)}) reached authorized ceiling ($${resolvedApprovedMaxBudgetUsd.toFixed(4)}).`
          );
        }

        // Check cache hit: does valid extraction already exist in workspace?
        const existingDraftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
        const existingDraft = fs.existsSync(existingDraftPath)
          ? await loadStagedLeafletDraft(leaflet.workspacePath, { skipAutoInit: true })
          : null;

        const expectedTargetPages =
          leaflet.pagesToProcess && leaflet.pagesToProcess.length > 0
            ? leaflet.pagesToProcess
            : Array.from({ length: leaflet.pageCount || 1 }, (_, idx) => idx + 1);
        const expectedTargetPageCount = expectedTargetPages.length;
        let isHybridPartialCheckpoint = false;
        if (manifest.extractionPipelineMode === 'hybrid_v3') {
          const progressPath = path.join(leaflet.workspacePath, 'hybrid_v3_checkpoints', 'leaflet_v3_progress.json');
          if (fs.existsSync(progressPath)) {
            try {
              const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8')) as { completedPages?: number[] };
              const completedSet = new Set(Array.isArray(progress?.completedPages) ? progress.completedPages : []);
              if (!expectedTargetPages.every((p) => completedSet.has(p))) {
                isHybridPartialCheckpoint = true;
              }
            } catch {
              isHybridPartialCheckpoint = true;
            }
          } else {
            isHybridPartialCheckpoint = true;
          }
        }

        const hasValidExistingDraft =
          !options?.forceReextract &&
          !isHybridPartialCheckpoint &&
          existingDraft &&
          Array.isArray(existingDraft.items) &&
          existingDraft.items.length > 0 &&
          (!leaflet.fileFingerprint || existingDraft.leafletHash === leaflet.fileFingerprint || !existingDraft.leafletHash);

        if (hasValidExistingDraft && existingDraft) {
          logInfo(`[BatchQueue] Cache hit for leaflet ${leaflet.fileName}. Reusing existing extraction.`);
          leaflet.status = 'completed';
          leaflet.completedAt = new Date().toISOString();
          leaflet.offersCount = existingDraft.items.length;
          leaflet.pagesProcessed = expectedTargetPageCount;
          leaflet.estimatedCostUsd = 0;
          leaflet.provenance = 'cache';
          if (existingDraft.header) {
            leaflet.metadata = this.sanitizeLeafletMetadataFields(
              {
                ...leaflet.metadata,
                supermarketId: existingDraft.header.supermarketId || leaflet.metadata.supermarketId,
                locationScope: (existingDraft.header.locationScope as any) || leaflet.metadata.locationScope,
                locationLabel: existingDraft.header.region || leaflet.metadata.locationLabel,
                locationSlug: existingDraft.header.locationSlug || leaflet.metadata.locationSlug,
                cityId: existingDraft.header.cityId || leaflet.metadata.cityId,
                regionId: existingDraft.header.regionId || leaflet.metadata.regionId,
                offerStartDate: existingDraft.header.validFrom || leaflet.metadata.offerStartDate,
                offerEndDate: existingDraft.header.validTo || leaflet.metadata.offerEndDate
              },
              { fileName: leaflet.fileName, applyDefaults: true }
            );
          }
          if (!isLeafletMetadataAccepted(leaflet.metadata) || !hasCompleteCoreLeafletMetadata(leaflet.metadata)) {
            stages.metadata = 'running';
            await this.discoverDraftMetadataAfterExtraction(leaflet, manifest, [], {
              ...options,
              hybridV3ExplicitLiveAuthorization: false
            });
          }
          stages.crops = 'completed';
          this.recomputeTotals(manifest);
          await this.saveBatchManifestAtomic(manifest);
          emit('leaflet_completed', `Reused cached extraction for ${leaflet.fileName} (${leaflet.offersCount} offers)`, i, leaflet);
          continue;
        }

        // Live extraction execution:
        // Step 1: Pre-render only the selected PDF pages streaming unless already rendered on disk when requested
        const canReuseRenderedPages =
          Boolean(options?.skipPdfRenderIfPagesExist) &&
          expectedTargetPages.every((p) =>
            fs.existsSync(path.join(leaflet.workspacePath, 'pages', `page.${p}.png`))
          );

        if (!canReuseRenderedPages) {
          emit('rendering', `Rendering pages for ${leaflet.fileName}...`, i, leaflet);

          const hasSpecificPages = Boolean(leaflet.pagesToProcess && leaflet.pagesToProcess.length > 0);
          await renderPdfPagesStreaming({
            pdfPath: leaflet.filePath,
            originalFileName: leaflet.fileName,
            workspacePath: leaflet.workspacePath,
            dpi: 200,
            pageCount: leaflet.pageCount,
            selectionMode: hasSpecificPages ? 'specific' : 'all',
            ...(hasSpecificPages ? { selectedPages: leaflet.pagesToProcess } : {}),
            metadata: {
              supermarketId: leaflet.metadata.supermarketId,
              location: leaflet.metadata.locationScope
                ? {
                  locationScope: leaflet.metadata.locationScope,
                  cityId: leaflet.metadata.cityId || null,
                  regionId: leaflet.metadata.regionId || null,
                  label: leaflet.metadata.locationLabel || 'Coverage',
                  coverageLabel: leaflet.metadata.locationLabel || 'Coverage',
                  locationSlug: leaflet.metadata.locationSlug || 'coverage'
                }
                : null,
              offerDates: {
                offerStartDate: leaflet.metadata.offerStartDate || '',
                offerEndDate: leaflet.metadata.offerEndDate || ''
              }
            }
          });
        }

        if (manifest.extractionPipelineMode === 'hybrid_v3') {
          emit('extracting', `Extracting offers with Hybrid V3 workflow for ${leaflet.fileName}...`, i, leaflet);

          const hybridRes = await runHybridV3LeafletExtraction({
            batchId,
            ledgerSessionRunId: sessionRunId,
            onLedgerEntry: (entry) => {
              try {
                this.getCostLedgerService().recordEntry(entry);
              } catch {
                // Non-fatal ledger write safeguard
              }
            },
            leafletId: leaflet.leafletId,
            fileName: leaflet.fileName,
            filePath: leaflet.filePath,
            fileFingerprint: leaflet.fileFingerprint,
            workspacePath: leaflet.workspacePath,
            pageCount: leaflet.pageCount,
            pagesToProcess: leaflet.pagesToProcess,
            metadata: leaflet.metadata,
            executionContext:
              options?.hybridV3ExplicitAuthorization && options?.hybridV3FeatureEnabled
                ? 'isolated_hybrid_workflow'
                : 'normal_app',
            explicitAuthorization: options?.hybridV3ExplicitAuthorization === true,
            featureEnabled: options?.hybridV3FeatureEnabled === true,
            explicitLiveAuthorization: options?.hybridV3ExplicitLiveAuthorization === true,
            disablePageContextVerification: options?.disablePageContextVerification ?? true,
            approvedMaxBudgetUsd: remainingBatchBudgetUsd > 0 ? remainingBatchBudgetUsd : null,
            forceReextract: options?.forceReextract,
            historyService: this.getHistoryService(),
            provider: options?.hybridV3Provider,
            isCancelled: () => Boolean(this.activeCancellations.get(batchId)),
            onPageProgress: (p) => {
              leaflet.pagesProcessed = p.completedPages;
              leaflet.offersCount = p.offersSoFar;
              leaflet.estimatedCostUsd = p.costUsdSoFar;
              this.recomputeTotals(manifest);
              void this.saveBatchManifestAtomic(manifest);
              emit('extracting', `[${leaflet.fileName}] ${p.message}`, i, leaflet);
            }
          });

          // Persist partial progress & actual API cost BEFORE checking failure or cancellation
          leaflet.pagesProcessed = hybridRes.pagesProcessed;
          leaflet.offersCount = hybridRes.offersCount;
          leaflet.estimatedCostUsd = hybridRes.estimatedCostUsd;

          if (hybridRes.cancelled) {
            leaflet.status = 'cancelled';
            leaflet.error = hybridRes.error || 'Cancelled by operator.';
            for (let j = i + 1; j < manifest.leaflets.length; j++) {
              if (manifest.leaflets[j].status === 'queued') {
                manifest.leaflets[j].status = 'cancelled';
              }
            }
            manifest.status = 'cancelled';
            await this.syncWorkspaceManifestStatus(leaflet, 'paused');
            this.recomputeTotals(manifest);
            await this.saveBatchManifestAtomic(manifest);
            emit('batch_cancelled', `Batch ${batchId} paused/cancelled cleanly during ${leaflet.fileName}.`, i, leaflet);
            return manifest;
          }

          if (!hybridRes.ok) {
            this.recomputeTotals(manifest);
            throw new Error(hybridRes.error || 'Hybrid V3 extraction failed.');
          }

          if (!isLeafletMetadataAccepted(leaflet.metadata) || !hasCompleteCoreLeafletMetadata(leaflet.metadata)) {
            stages.metadata = 'running';
            await this.discoverDraftMetadataAfterExtraction(leaflet, manifest, hybridRes.pageResults, options);
          }
          stages.crops = 'completed';

          leaflet.status = 'completed';
          leaflet.completedAt = new Date().toISOString();
          await this.syncWorkspaceManifestStatus(leaflet, 'completed');
          if (hybridRes.reusedPageNumbers && hybridRes.reusedPageNumbers.length > 0) {
            leaflet.reusedPages = hybridRes.reusedPageNumbers;
            leaflet.provenance =
              hybridRes.reusedPageNumbers.length >= (hybridRes.completedPageNumbers?.length || 0) &&
              hybridRes.estimatedCostUsd === 0
                ? 'cache'
                : 'mixed';
          } else {
            leaflet.provenance = hybridRes.estimatedCostUsd === 0 ? 'cache' : 'fresh';
          }

          this.recomputeTotals(manifest);
          await this.saveBatchManifestAtomic(manifest);
          emit('leaflet_completed', `Hybrid V3 extracted ${leaflet.offersCount} offers from ${leaflet.fileName}`, i, leaflet);
          continue;
        }

        // Step 2: Run Legacy PageFirst pipeline with Gemini Flex
        emit('extracting', `Extracting offers with Gemini 3.8 Flash for ${leaflet.fileName}...`, i, leaflet);

        const trustedContext = {
          supermarketId: leaflet.metadata.supermarketId || null,
          locationScope: leaflet.metadata.locationScope || null,
          cityId: leaflet.metadata.cityId || null,
          regionId: leaflet.metadata.regionId || null,
          offerStartDate: leaflet.metadata.offerStartDate || null,
          offerEndDate: leaflet.metadata.offerEndDate || null,
          leafletId: leaflet.fileFingerprint || leaflet.leafletId
        };

        const mockForLeaflet = options?.mockResponses?.get(leaflet.leafletId);

        const pdfBaseName = path.basename(leaflet.fileName, path.extname(leaflet.fileName));
        const pipelineResult = await sharedPageFirstPipelineService.runPipeline({
          packageDir: leaflet.workspacePath,
          pdfBaseName,
          trustedContext,
          executionMode: manifest.executionMode,
          overrideModel: manifest.model,
          forceReextract: options?.forceReextract,
          mockPageResponses: mockForLeaflet,
          onProgress: (p) => {
            emit('extracting', `[${leaflet.fileName}] ${p.stage}: ${p.message}`, i, leaflet);
          }
        });

        // Step 3: Initialize or update staged draft
        try {
          await initializeStagedDraftFromPackage(leaflet.workspacePath, {
            supermarketId: leaflet.metadata.supermarketId,
            leafletHash: leaflet.fileFingerprint,
            pdfFileName: leaflet.fileName,
            pdfFilePath: leaflet.filePath,
            locationScope: leaflet.metadata.locationScope,
            cityId: leaflet.metadata.cityId,
            regionId: leaflet.metadata.regionId,
            validFrom: leaflet.metadata.offerStartDate,
            validTo: leaflet.metadata.offerEndDate
          });
        } catch (draftErr: any) {
          logWarn(`Staged draft init warning for ${leaflet.fileName}: ${draftErr.message}`);
        }

        const isCacheOnly =
          pipelineResult.geminiUsageSummary &&
          pipelineResult.geminiUsageSummary.apiCallsCount > 0 &&
          pipelineResult.geminiUsageSummary.cacheHitsCount === pipelineResult.geminiUsageSummary.apiCallsCount;

        leaflet.status = pipelineResult.ok ? 'completed' : 'failed';
        leaflet.completedAt = new Date().toISOString();
        leaflet.pagesProcessed = pipelineResult.completedPages;
        leaflet.offersCount = pipelineResult.offersDetected;
        leaflet.estimatedCostUsd = pipelineResult.estimatedCostUsd;
        leaflet.provenance = isCacheOnly ? 'cache' : 'fresh';

        this.recomputeTotals(manifest);
        await this.saveBatchManifestAtomic(manifest);
        emit('leaflet_completed', `Extracted ${leaflet.offersCount} offers from ${leaflet.fileName}`, i, leaflet);
      } catch (leafErr: any) {
        logError(`Failed to process leaflet ${leaflet.fileName}: ${leafErr.message}`);
        leaflet.status = 'failed';
        leaflet.error = leafErr.message;
        leaflet.completedAt = new Date().toISOString();
        await this.syncWorkspaceManifestStatus(leaflet, 'failed');
        this.recomputeTotals(manifest);
        await this.saveBatchManifestAtomic(manifest);
        emit('leaflet_failed', `Extraction failed for ${leaflet.fileName}: ${leafErr.message}`, i, leaflet);
      }
    }

    // Determine final batch status
    const allCompleted = manifest.leaflets.every((l) => l.status === 'completed');
    const allFailed = manifest.leaflets.every((l) => l.status === 'failed');
    const anyCancelled = manifest.leaflets.some((l) => l.status === 'cancelled');

    if (anyCancelled) {
      manifest.status = 'cancelled';
      stages.extraction = 'failed';
      if (stages.metadata === 'running' || stages.metadata === 'pending') stages.metadata = 'skipped';
      if (stages.crops === 'running' || stages.crops === 'pending') stages.crops = 'skipped';
      if (autoRunCatalogMatching) stages.matching = 'skipped';
    } else if (allCompleted) {
      manifest.status = 'completed';
      stages.extraction = 'completed';
      if (stages.metadata !== 'failed') stages.metadata = 'completed';
      if (stages.crops !== 'failed') stages.crops = 'completed';
    } else if (allFailed) {
      manifest.status = 'failed';
      stages.extraction = 'failed';
      stages.metadata = 'skipped';
      stages.crops = 'skipped';
      if (autoRunCatalogMatching) stages.matching = 'skipped';
    } else {
      manifest.status = 'completed_with_errors';
      stages.extraction = 'completed';
      if (stages.metadata !== 'failed') stages.metadata = 'completed';
      if (stages.crops !== 'failed') stages.crops = 'completed';
    }

    manifest.processingStages = { ...stages };
    this.recomputeTotals(manifest);
    await this.saveBatchManifestAtomic(manifest);

    if (autoRunCatalogMatching && !anyCancelled && !allFailed && !this.activeCancellations.get(batchId)) {
      stages.matching = 'running';
      manifest.processingStages = { ...stages };
      await this.saveBatchManifestAtomic(manifest);
      emit(
        'matching',
        'Running cross-leaflet product normalization & catalog matching...',
        manifest.leaflets.length
      );

      try {
        const remainingMatchingBudgetUsd = Math.max(
          0,
          Number((resolvedApprovedMaxBudgetUsd - (manifest.totals.totalCostUsd || 0)).toFixed(6))
        );
        const orchestrator =
          options?.catalogMatchingOrchestrator ||
          new CatalogMatchingOrchestrator(
            undefined,
            undefined,
            undefined,
            undefined,
            this.getBatchesBaseDir()
          );

        if (!options?.catalogMatchingSupabase) {
          throw new Error(
            'CATALOG_MATCHING_CLIENT_UNAVAILABLE: Reference DB client unavailable for automatic matching.'
          );
        }

        const unifiedOffers = await this.getUnifiedBatchOffers(batchId);
        const matchingManifest = await orchestrator.executeMatchingRun({
          batchId,
          offers: unifiedOffers,
          supabase: options.catalogMatchingSupabase,
          databaseContext: targetDatabaseContext,
          mode: 'full',
          approvedMaxBudgetUsd: remainingMatchingBudgetUsd,
          progressCallback: (statusText, percent, details) => {
            if (options?.onMatchingProgress) {
              options.onMatchingProgress({
                batchId,
                runId: details?.runId || 'auto',
                statusText,
                percent,
                completedRequests: details?.completedRequests || 0,
                totalRequests: details?.totalRequests || 0,
                failedRequests: details?.failedRequests || 0,
                currentBrand: details?.currentBrand
              });
            }
          }
        });

        const matchingStageStatus =
          matchingManifest.status === 'failed'
            ? 'failed'
            : matchingManifest.status === 'cancelled' || matchingManifest.status === 'paused'
              ? 'pending'
              : 'completed';
        stages.matching = matchingStageStatus;

        const matchingSummary: BatchMatchingStageSummary = {
          status: matchingStageStatus,
          databaseContext: matchingManifest.matchingDatabaseContext || targetDatabaseContext,
          actualCostUsd: Number((matchingManifest.totals.estimatedCostUsd || 0).toFixed(6)),
          existingMatchesCount: matchingManifest.totals.proposedExistingCount || 0,
          temporaryGroupsCount: matchingManifest.totals.proposedTemporaryCount || 0,
          unresolvedCount: matchingManifest.totals.unresolvedCount || 0,
          error:
            (matchingManifest.totals.failedRequestsCount || 0) > 0
              ? `${matchingManifest.totals.failedRequestsCount} matching request(s) failed.`
              : null
        };
        manifest.matchingSummary = matchingSummary;
      } catch (matchErr: any) {
        logWarn(`Automatic catalog matching paused/failed cleanly (completed extractions preserved): ${matchErr?.message}`);
        stages.matching = 'failed';
        manifest.matchingSummary = {
          status: 'failed',
          databaseContext: targetDatabaseContext,
          actualCostUsd: 0,
          existingMatchesCount: 0,
          temporaryGroupsCount: 0,
          unresolvedCount: manifest.totals.totalOffers || 0,
          error: matchErr?.message || 'Catalog matching failed.'
        };
      }

      manifest.processingStages = { ...stages };
      this.recomputeTotals(manifest);
      await this.saveBatchManifestAtomic(manifest);
      emit(
        'staging',
        'Staging offers & catalog reconciliation locally (zero DB writes)...',
        manifest.leaflets.length
      );
    }

    emit('batch_completed', `Batch extraction finished with status: ${manifest.status}`, manifest.leaflets.length);

    return manifest;
  }

  public async cancelBatch(batchId: string): Promise<BatchManifest> {
    this.activeCancellations.set(batchId, true);
    const manifest = await this.loadBatchManifest(batchId);
    if (!manifest) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    for (const leaflet of manifest.leaflets) {
      if (leaflet.status === 'queued') {
        leaflet.status = 'cancelled';
      }
    }

    manifest.status = 'cancelled';
    this.recomputeTotals(manifest);
    await this.saveBatchManifestAtomic(manifest);
    return manifest;
  }

  private sanitizeLeafletMetadataFields(
    meta: LeafletMetadataScope,
    options?: {
      fileName?: string;
      applyDefaults?: boolean;
      isOperatorSave?: boolean;
    }
  ): LeafletMetadataScope {
    const applyDefaults =
      options?.applyDefaults ??
      (Boolean(meta.verified) || (Boolean(meta.discoverySource) && meta.discoverySource !== 'unverified'));

    // 1. Validity Date Sanitization
    const startCheck = extractStrictIsoDate(meta.offerStartDate);
    const endCheck = extractStrictIsoDate(meta.offerEndDate);
    const validityEvidence = meta.evidenceByField?.validity?.evidenceText || null;

    let offerStartDate = startCheck.date;
    let offerEndDate = endCheck.date;
    let validityNormalizationError = meta.validityNormalizationError ?? null;

    if (startCheck.rawHadInvalidFormat || endCheck.rawHadInvalidFormat) {
      const normalized = normalizeValidityRange({
        startDate: meta.offerStartDate,
        endDate: meta.offerEndDate,
        rawText: validityEvidence,
        pageNumber: meta.evidenceByField?.validity?.sourcePage || 1
      });
      offerStartDate = normalized.startDate;
      offerEndDate = normalized.endDate;
      validityNormalizationError = normalized.normalizationError;
    } else if (offerStartDate && offerEndDate && offerStartDate <= offerEndDate) {
      validityNormalizationError = null;
    }

    const nextEvidenceByField: Partial<Record<MetadataFieldKey, MetadataFieldEvidenceSummary>> = {
      ...(meta.evidenceByField || {})
    };

    // 2. Campaign Title Sanitization (preserve raw diagnostic evidence, reject commentary/loops/slogans)
    let nextTitle: string | null = null;
    if (meta.leafletTitle) {
      const titleCheck = sanitizeCampaignTitle(meta.leafletTitle, {
        fileName: options?.fileName,
        retailerNames: [meta.supermarketName]
      });
      if (titleCheck.valid && titleCheck.sanitizedTitle) {
        nextTitle = titleCheck.sanitizedTitle;
      } else if (!nextEvidenceByField.title) {
        nextEvidenceByField.title = {
          field: 'title',
          sourcePage: 1,
          method: 'targeted_vision',
          evidenceText: String(meta.leafletTitle),
          confidence: 0
        };
      }
    }

    // 3. Currency is strictly fixed internal SAR (not extracted from Gemini and never flags currencyConflict)
    const nextCurrency = 'SAR';
    const currencyConflict = false;
    if (!nextEvidenceByField.currency || nextEvidenceByField.currency.method !== 'default_rule') {
      nextEvidenceByField.currency = {
        field: 'currency',
        sourcePage: null,
        method: 'default_rule',
        evidenceText: 'Fixed internal currency SAR',
        confidence: 1
      };
    }

    // 4. Geographic Scope Normalization & National (assumed) Default
    const detectedCities = Array.isArray(meta.detectedCities) ? meta.detectedCities : [];
    const hasGeoConflict =
      (!meta.verified && Boolean(meta.geographicNotice)) ||
      (!meta.verified && detectedCities.length > 1);

    let nextScope = meta.locationScope ?? null;
    let nextScopeSource: GeographicScopeSource | null = meta.scopeSource ?? null;
    let nextLocationSlug = meta.locationSlug ?? null;
    let nextLocationLabel = meta.locationLabel ?? null;

    if (nextScope) {
      if (options?.isOperatorSave && meta.verified) {
        nextScopeSource = 'operator_override';
      } else if (!nextScopeSource) {
        const isAssumedDefaultLabel = (nextLocationLabel || '').toLowerCase().includes('assumed');
        const isDefaultRuleEvidence = nextEvidenceByField.locationScope?.method === 'default_rule';
        if (nextScope === 'national' && (isAssumedDefaultLabel || isDefaultRuleEvidence || !nextEvidenceByField.locationScope)) {
          nextScopeSource = 'default_national';
        } else {
          nextScopeSource = 'explicit_leaflet_evidence';
        }
      }
      if (nextScope === 'national' && nextScopeSource === 'default_national') {
        nextLocationSlug = 'national';
        nextLocationLabel = 'National — Saudi Arabia (assumed)';
      }
    } else if (applyDefaults && !hasGeoConflict) {
      nextScope = 'national';
      nextLocationSlug = 'national';
      nextLocationLabel = 'National — Saudi Arabia (assumed)';
      nextScopeSource = 'default_national';
      if (!nextEvidenceByField.locationScope) {
        nextEvidenceByField.locationScope = {
          field: 'locationScope',
          sourcePage: null,
          method: 'default_rule',
          evidenceText: 'Defaulted to National — Saudi Arabia (assumed); no narrower city/region scope printed on leaflet.',
          confidence: 1
        };
      }
    } else {
      nextScopeSource = null;
    }

    const sanitized: LeafletMetadataScope = {
      ...meta,
      offerStartDate,
      offerEndDate,
      validityNormalizationError,
      leafletTitle: nextTitle,
      currency: nextCurrency,
      currencyConflict,
      locationScope: nextScope,
      locationSlug: nextLocationSlug,
      locationLabel: nextLocationLabel,
      scopeSource: nextScopeSource,
      evidenceByField: nextEvidenceByField
    };

    sanitized.unresolvedFields = this.computeUnresolvedMetadataFields(sanitized);
    const { status, reasons } = this.evaluateMetadataAcceptanceStatus(sanitized);
    sanitized.metadataStatus = status;
    sanitized.metadataStatusReasons = reasons;
    return sanitized;
  }

  private evaluateMetadataAcceptanceStatus(meta: LeafletMetadataScope): {
    status: MetadataAcceptanceStatus;
    reasons: string[];
  } {
    const reasons: string[] = [];
    const hasUniqueRetailer = Boolean(meta.supermarketId && meta.supermarketName);
    if (!hasUniqueRetailer) {
      reasons.push('Retailer is not uniquely matched to catalog.');
    }

    const startIso = extractStrictIsoDate(meta.offerStartDate).date;
    const endIso = extractStrictIsoDate(meta.offerEndDate).date;
    if (!startIso || !endIso) {
      reasons.push('Offer validity start/end dates are missing or invalid.');
    } else if (startIso > endIso) {
      reasons.push(`Offer start date (${startIso}) is after end date (${endIso}).`);
    }

    if (meta.validityNormalizationError) {
      reasons.push(`Date check: ${meta.validityNormalizationError}`);
    }

    const hasValidityEvidence = Boolean(
      meta.verified ||
        meta.evidenceByField?.validity?.evidenceText ||
        (meta.discoverySource && meta.discoverySource !== 'unverified')
    );
    if (startIso && endIso && !hasValidityEvidence) {
      reasons.push('Validity dates lack supporting leaflet evidence.');
    }

    if (!meta.verified && Array.isArray(meta.conflictingValidity) && meta.conflictingValidity.length > 0) {
      reasons.push('Conflicting promotional/exception dates require review.');
    }

    const hasValidGeo = Boolean(
      meta.locationScope === 'national' ||
        (meta.locationScope === 'region' && Boolean(meta.regionId || meta.locationLabel)) ||
        (meta.locationScope === 'city' && Boolean(meta.cityId || meta.locationLabel))
    );
    if (!hasValidGeo) {
      reasons.push('Geographic scope is missing or ambiguous.');
    }

    if (!meta.verified && (meta.geographicNotice || (meta.detectedCities && meta.detectedCities.length > 1))) {
      reasons.push(meta.geographicNotice || 'Multiple cities detected — confirm geographic scope.');
    }

    if (meta.verified && reasons.length === 0) {
      return { status: 'operator_verified', reasons: [] };
    }
    if (reasons.length === 0) {
      return { status: 'auto_accepted', reasons: [] };
    }
    return { status: 'needs_review', reasons };
  }

  private computeUnresolvedMetadataFields(meta: LeafletMetadataScope): MetadataFieldKey[] {
    const unresolved: MetadataFieldKey[] = [];
    if (!meta.supermarketId || !meta.supermarketName) unresolved.push('retailer');
    const startIso = extractStrictIsoDate(meta.offerStartDate).date;
    const endIso = extractStrictIsoDate(meta.offerEndDate).date;
    if (!startIso || !endIso || startIso > endIso || (!meta.verified && (meta.conflictingValidity?.length || 0) > 0)) {
      unresolved.push('validity');
    }
    // Note: `title` is strictly optional and NEVER marks metadata incomplete.
    // Note: `currency` is strictly fixed internal SAR and never unresolved.
    if (!meta.locationScope || (!meta.verified && (Boolean(meta.geographicNotice) || (meta.detectedCities?.length || 0) > 1))) {
      unresolved.push('locationScope');
    }
    return unresolved;
  }

  /**
   * Reuses offline package inspection, Hybrid V3 full-page extraction banners/metadata,
   * valid workspace cache, and (only if still incomplete + authorized within remaining cap)
   * cover-page metadata Vision fallback. Never auto-marks verified=true.
   */
  private async discoverDraftMetadataAfterExtraction(
    leaflet: LeafletBatchItem,
    manifest: BatchManifest,
    pageResults: HybridPageRunResult[],
    options?: BatchExtractionOptions
  ): Promise<void> {
    await this.applyPackageMetadataDiscovery(leaflet);

    const meta = this.sanitizeLeafletMetadataFields(leaflet.metadata || {});
    const evidenceByField: Partial<Record<MetadataFieldKey, MetadataFieldEvidenceSummary>> = {
      ...(meta.evidenceByField || {})
    };
    const conflictingValidity: MetadataValidityConflictSummary[] = [...(meta.conflictingValidity || [])];
    const detectedCities = new Set<string>(meta.detectedCities || []);
    let geographicNotice = meta.geographicNotice || null;

    for (const pr of pageResults || []) {
      const pNum = pr.pageNumber || 1;
      const rawMeta = pr.rawPageMetadata;
      if (!rawMeta) continue;

      if (!meta.currency && rawMeta.pageCurrency) {
        const cur = rawMeta.pageCurrency.trim().toUpperCase();
        if (cur === 'SAR' || cur === 'SR' || /ريال|ر\.س/u.test(rawMeta.pageCurrency)) {
          meta.currency = 'SAR';
          if (!evidenceByField.currency) {
            evidenceByField.currency = {
              field: 'currency',
              sourcePage: pNum,
              method: 'hybrid_extraction',
              evidenceText: rawMeta.pageCurrency,
              confidence: 0.9
            };
          }
        }
      }

      const banners = Array.isArray(rawMeta.ignoredBanners) ? rawMeta.ignoredBanners : [];
      let pageHasSingleDayBanner = false;

      for (const banner of banners) {
        const cleanBanner = String(banner || '').trim();
        if (!cleanBanner) continue;

        // Retailer check from extracted banners (never from filename)
        const normBanner = normalizeEntityText(cleanBanner);
        const strippedBanner = stripSupermarketNoiseWords(cleanBanner);
        const syn = SUPERMARKET_SYNONYMS[normBanner] || SUPERMARKET_SYNONYMS[strippedBanner];
        const matchedRetailer = MASTER_SUPERMARKETS.find((s) => {
          if (syn && s.slug === syn.slug) return true;
          const sEn = normalizeEntityText(s.name_en || '');
          const sAr = normalizeEntityText(s.name_ar || '');
          return (
            (sEn.length >= 4 && normBanner.includes(sEn)) ||
            (sAr.length >= 4 && normBanner.includes(sAr))
          );
        });
        const bannerIsRetailer = Boolean(matchedRetailer);
        if (matchedRetailer && !meta.supermarketId && !meta.supermarketName) {
          meta.supermarketId = matchedRetailer.id;
          meta.supermarketName = matchedRetailer.name_en;
          if (!evidenceByField.retailer) {
            evidenceByField.retailer = {
              field: 'retailer',
              sourcePage: pNum,
              method: 'hybrid_extraction',
              evidenceText: cleanBanner,
              confidence: 0.9
            };
          }
        }

        // Date parsing from extracted banners (handles "11th 17th NOVEMBER 2026" and flags ONE DAY ONLY)
        const parsedBannerDates = parseValidityDates(cleanBanner, { pageNumber: pNum });
        if (parsedBannerDates) {
          if (parsedBannerDates.isException) {
            pageHasSingleDayBanner = true;
            const alreadyInConflicts = conflictingValidity.some(
              (c) =>
                c.startDate === parsedBannerDates.startDate &&
                c.endDate === parsedBannerDates.endDate &&
                c.rawPrintedText === parsedBannerDates.rawPrintedText
            );
            if (!alreadyInConflicts) {
              conflictingValidity.push({
                startDate: parsedBannerDates.startDate,
                endDate: parsedBannerDates.endDate,
                rawPrintedText: parsedBannerDates.rawPrintedText,
                sourcePage: pNum
              });
            }
          } else if (parsedBannerDates.startDate && parsedBannerDates.endDate) {
            if (!meta.offerStartDate || !meta.offerEndDate) {
              meta.offerStartDate = parsedBannerDates.startDate;
              meta.offerEndDate = parsedBannerDates.endDate;
              meta.validityNormalizationError = null;
              evidenceByField.validity = {
                field: 'validity',
                sourcePage: pNum,
                method: 'hybrid_extraction',
                evidenceText: parsedBannerDates.rawPrintedText,
                confidence: parsedBannerDates.confidence
              };
            }
          }
        }

        // Multi-city / city list detection in banners (never collapse multi-city into national or 1 city)
        const tokens = cleanBanner
          .split(/[,،/|;\u2013\u2014-]+/)
          .map((t) => t.trim())
          .filter((t) => t.length >= 2);
        const bannerCities: string[] = [];
        for (const tok of tokens) {
          const nTok = normalizeEntityText(tok);
          const sTok = stripRegionNoiseWords(tok);
          const city = MASTER_CITIES.find(
            (c) =>
              normalizeEntityText(c.name_en || '') === nTok ||
              normalizeEntityText(c.name_ar || '') === nTok ||
              normalizeEntityText(c.name_en || '') === sTok ||
              c.slug === nTok
          );
          if (city) {
            const cityLabel = city.name_en || city.name_ar || city.slug || tok;
            if (!bannerCities.includes(cityLabel)) bannerCities.push(cityLabel);
          }
        }
        if (bannerCities.length >= 2) {
          bannerCities.forEach((c) => detectedCities.add(c));
          geographicNotice = `Multiple cities printed (${Array.from(detectedCities).join(', ')}) — verify target city/region/national scope explicitly; multi-city evidence preserved.`;
          if (meta.scopeSource === 'default_national') {
            meta.locationScope = null;
            meta.locationSlug = null;
            meta.locationLabel = null;
            meta.scopeSource = null;
          }
          if (!evidenceByField.locationScope) {
            evidenceByField.locationScope = {
              field: 'locationScope',
              sourcePage: pNum,
              method: 'hybrid_extraction',
              evidenceText: cleanBanner,
              confidence: 0.9
            };
          }
        } else if (bannerCities.length === 1 && detectedCities.size === 0 && !meta.locationScope) {
          const singleCity = MASTER_CITIES.find((c) => c.name_en === bannerCities[0]);
          if (singleCity) {
            meta.locationScope = 'city';
            meta.cityId = singleCity.id;
            meta.regionId = singleCity.region_id;
            meta.locationSlug = singleCity.slug;
            meta.locationLabel = singleCity.name_en;
            meta.scopeSource = 'explicit_leaflet_evidence';
            evidenceByField.locationScope = {
              field: 'locationScope',
              sourcePage: pNum,
              method: 'hybrid_extraction',
              evidenceText: cleanBanner,
              confidence: 0.9
            };
          }
        }

        // Campaign title banner (e.g. "11.11 DEALS") — never reuse retailer banner, date/city line, or model slogans
        if (
          !meta.leafletTitle &&
          !bannerIsRetailer &&
          !parsedBannerDates &&
          bannerCities.length === 0 &&
          !/one\s+day\s+only/i.test(cleanBanner)
        ) {
          const titleCheck = sanitizeCampaignTitle(cleanBanner, {
            fileName: leaflet.fileName,
            retailerNames: [meta.supermarketName]
          });
          if (titleCheck.valid && titleCheck.sanitizedTitle) {
            meta.leafletTitle = titleCheck.sanitizedTitle;
            if (!evidenceByField.title) {
              evidenceByField.title = {
                field: 'title',
                sourcePage: pNum,
                method: 'hybrid_extraction',
                evidenceText: cleanBanner,
                confidence: 0.85
              };
            }
          }
        }
      }

      // Structured validity_start_date / validity_end_date from full-page extraction
      if ((!meta.offerStartDate || !meta.offerEndDate) && !pageHasSingleDayBanner) {
        const normFullPage = normalizeValidityRange({
          startDate: rawMeta.validityStartDate,
          endDate: rawMeta.validityEndDate,
          rawText: null,
          pageNumber: pNum
        });
        if (normFullPage.startDate && normFullPage.endDate) {
          meta.offerStartDate = normFullPage.startDate;
          meta.offerEndDate = normFullPage.endDate;
          meta.validityNormalizationError = null;
          if (!evidenceByField.validity) {
            evidenceByField.validity = {
              field: 'validity',
              sourcePage: pNum,
              method: 'hybrid_extraction',
              evidenceText: `${normFullPage.startDate} to ${normFullPage.endDate}`,
              confidence: 0.9
            };
          }
        } else if (normFullPage.normalizationError && !meta.validityNormalizationError) {
          meta.validityNormalizationError = normFullPage.normalizationError;
        }
      }
    }

    meta.evidenceByField = evidenceByField;
    if (conflictingValidity.length > 0) meta.conflictingValidity = conflictingValidity;
    if (detectedCities.size > 0) meta.detectedCities = Array.from(detectedCities);
    if (geographicNotice) meta.geographicNotice = geographicNotice;
    if (!meta.discoverySource || meta.discoverySource === 'unverified') {
      meta.discoverySource = 'package_discovery';
    }
    leaflet.metadata = this.sanitizeLeafletMetadataFields(meta, {
      fileName: leaflet.fileName,
      applyDefaults: true
    });

    // Check existing disk Vision cache at $0 (or authorized live cover fallback if still incomplete/ambiguous and within cap)
    const missingCore =
      !leaflet.metadata.supermarketId ||
      !leaflet.metadata.supermarketName ||
      !leaflet.metadata.offerStartDate ||
      !leaflet.metadata.offerEndDate ||
      !leaflet.metadata.locationScope ||
      Boolean(leaflet.metadata.geographicNotice);

    if (missingCore) {
      const visionCacheDir = path.join(leaflet.workspacePath, 'metadata', 'vision_cache');
      const hasDiskCache = fs.existsSync(visionCacheDir) && fs.readdirSync(visionCacheDir).some((f) => f.endsWith('.json'));
      const remainingBudgetUsd =
        (manifest.approvedScope?.approvedMaxBudgetUsd ?? 0) - manifest.totals.totalCostUsd;
      const canUseVisionCacheOrAuthorizedFallback =
        hasDiskCache ||
        (Boolean(options?.hybridV3ExplicitLiveAuthorization) &&
          remainingBudgetUsd > 0.002 &&
          !process.env.VITEST &&
          process.env.WIFRAN_OFFLINE_UAT !== '1');

      if (canUseVisionCacheOrAuthorizedFallback) {
        try {
          await this.runTargetedVisionForLeaflet(leaflet, manifest, {
            explicitVisionAuthorization: true,
            enableLiveGemini: Boolean(options?.hybridV3ExplicitLiveAuthorization) && !hasDiskCache
          });
        } catch (err: any) {
          logWarn(`Post-extraction Vision metadata assist skipped for ${leaflet.fileName}: ${err?.message || err}`);
        }
      }
    }
  }

  /**
   * Discovers metadata hints from workspace pages/OCR and offline selected PDF pages
   * WITHOUT guessing from filename and WITHOUT defaulting unknown locationScope to 'national'.
   * Never marks verified=true automatically.
   */
  private async applyPackageMetadataDiscovery(
    leaflet: LeafletBatchItem,
    catalogSupermarkets?: any[],
    options?: { throwOnError?: boolean; forceRefresh?: boolean }
  ): Promise<void> {
    try {
      fs.mkdirSync(leaflet.workspacePath, { recursive: true });
      const metadataService = getLeafletMetadataService();
      const discovery = await metadataService.discoverMetadataFromPackage(
        leaflet.workspacePath,
        {
          catalogSupermarkets,
          allowAiFallback: false,
          pdfPath: leaflet.filePath,
          sourceFileName: leaflet.fileName,
          selectedPages:
            leaflet.pagesToProcess && leaflet.pagesToProcess.length > 0
              ? leaflet.pagesToProcess
              : undefined,
          selectionMode: leaflet.pageSelectionMode,
          totalPages: leaflet.pageCount,
          allowCoverPageEvidence: true,
          disableFilenameHints: true,
          forceRefresh: options?.forceRefresh
        }
      );

      const rec: any = discovery;
      if (!rec) {
        const nextMeta: LeafletMetadataScope = this.sanitizeLeafletMetadataFields(
          {
            ...leaflet.metadata,
            discoverySource: leaflet.metadata.discoverySource === 'targeted_vision' ? 'targeted_vision' : 'package_discovery',
            discoveryStatus: 'no_text_found',
            discoveryError: null,
            discoveryMessage: 'No metadata hints found offline; use AI Vision Discovery or enter fields manually.'
          },
          { fileName: leaflet.fileName, applyDefaults: true }
        );
        leaflet.metadata = nextMeta;
        return;
      }

      const discoveredScope = rec.locationScope ?? leaflet.metadata.locationScope ?? null;
      const resolvedSupermarketId = rec.retailer?.resolvedRetailerId ?? rec.supermarketId ?? null;
      const resolvedSupermarketName =
        rec.retailer?.resolvedNameEn ??
        rec.retailer?.detectedName ??
        rec.supermarketName ??
        null;
      const normResolved = normalizeValidityRange({
        startDate: rec.validity?.startDate ?? rec.offerStartDate ?? null,
        endDate: rec.validity?.endDate ?? rec.offerEndDate ?? null,
        rawText: rec.validity?.rawPrintedText || null,
        pageNumber: rec.validity?.sourcePage ?? 1
      });
      const resolvedStartDate = normResolved.startDate;
      const resolvedEndDate = normResolved.endDate;
      const rawResolvedTitle = rec.leafletTitle ?? rec.title ?? null;
      const resolvedTitle =
        rawResolvedTitle && !isLikelyFilenameSlug(rawResolvedTitle, leaflet.fileName)
          ? rawResolvedTitle
          : null;
      const resolvedCurrency = rec.currency ?? null;
      const coverStatus = rec.coverInspection?.status;
      const coverMessage = rec.coverInspection?.message ?? null;

      const evidenceByField: Partial<Record<MetadataFieldKey, MetadataFieldEvidenceSummary>> = {
        ...(leaflet.metadata.evidenceByField || {})
      };
      if (resolvedSupermarketName && !evidenceByField.retailer) {
        evidenceByField.retailer = {
          field: 'retailer',
          sourcePage: rec.retailer?.sourcePage ?? null,
          method: 'offline_text',
          evidenceText: rec.retailer?.evidenceText || resolvedSupermarketName,
          confidence: rec.retailer?.confidence
        };
      }
      if ((resolvedStartDate || resolvedEndDate) && !evidenceByField.validity) {
        evidenceByField.validity = {
          field: 'validity',
          sourcePage: rec.validity?.sourcePage ?? null,
          method: 'offline_text',
          evidenceText: rec.validity?.rawPrintedText || `${resolvedStartDate || '?'} to ${resolvedEndDate || '?'}`,
          confidence: rec.validity?.confidence
        };
      }
      if (resolvedTitle && !evidenceByField.title) {
        evidenceByField.title = {
          field: 'title',
          sourcePage: 1,
          method: 'offline_text',
          evidenceText: resolvedTitle
        };
      }
      if (discoveredScope && !evidenceByField.locationScope) {
        evidenceByField.locationScope = {
          field: 'locationScope',
          sourcePage: null,
          method: 'offline_text',
          evidenceText: rec.locationNameEn || discoveredScope
        };
      }

      const conflictingValidity: MetadataValidityConflictSummary[] = Array.isArray(rec.conflictingValidity)
        ? rec.conflictingValidity.map((c: any) => ({
          startDate: c.startDate || null,
          endDate: c.endDate || null,
          rawPrintedText: c.rawPrintedText,
          sourcePage: Number(c.sourcePage || 1)
        }))
        : leaflet.metadata.conflictingValidity || [];

      let discoveryStatus: LeafletMetadataScope['discoveryStatus'] = 'ok';
      let discoveryError: string | null = null;
      let discoveryMessage: string | null = coverMessage;

      if (coverStatus === 'error') {
        discoveryStatus = 'error';
        discoveryError = coverMessage;
      } else if (!resolvedSupermarketName && !resolvedStartDate && !resolvedEndDate) {
        discoveryStatus = 'no_text_found';
        if (!discoveryMessage) {
          discoveryMessage =
            'Cover & selected pages contain raster artwork with no embedded searchable text. Use AI Vision Discovery or enter metadata manually.';
        }
      } else if (!resolvedSupermarketName || !resolvedStartDate || !resolvedEndDate || !discoveredScope) {
        discoveryStatus = 'partial';
        if (!discoveryMessage) {
          discoveryMessage = 'Partial metadata discovered offline; use AI Vision Discovery or review and complete remaining fields.';
        }
      }

      const rawTitleCandidate =
        (leaflet.metadata.leafletTitle && sanitizeCampaignTitle(leaflet.metadata.leafletTitle, { fileName: leaflet.fileName, retailerNames: [resolvedSupermarketName] }).sanitizedTitle) ||
        (resolvedTitle && sanitizeCampaignTitle(resolvedTitle, { fileName: leaflet.fileName, retailerNames: [resolvedSupermarketName] }).sanitizedTitle) ||
        null;

      const recExtra = rec as typeof rec & {
        detectedCities?: string[];
        geographicNotice?: string | null;
      };
      const mergedDetectedCities =
        Array.isArray(recExtra.detectedCities) && recExtra.detectedCities.length > 0
          ? recExtra.detectedCities
          : leaflet.metadata.detectedCities;
      const mergedGeographicNotice =
        recExtra.geographicNotice !== undefined
          ? recExtra.geographicNotice
          : (leaflet.metadata.geographicNotice ?? null);

      const updatedMeta: LeafletMetadataScope = {
        ...leaflet.metadata,
        supermarketId: leaflet.metadata.supermarketId || resolvedSupermarketId,
        supermarketName: leaflet.metadata.supermarketName || resolvedSupermarketName,
        leafletTitle: rawTitleCandidate,
        locationScope: discoveredScope,
        locationSlug: leaflet.metadata.locationSlug || rec.locationSlug || null,
        cityId: leaflet.metadata.cityId || rec.cityId || null,
        regionId: leaflet.metadata.regionId || rec.regionId || null,
        scopeSource:
          leaflet.metadata.scopeSource ||
          (rec.locationScope ? 'explicit_leaflet_evidence' : null),
        ...(mergedDetectedCities && mergedDetectedCities.length > 0
          ? { detectedCities: mergedDetectedCities }
          : {}),
        geographicNotice: mergedGeographicNotice,
        offerStartDate: extractStrictIsoDate(leaflet.metadata.offerStartDate).date || resolvedStartDate,
        offerEndDate: extractStrictIsoDate(leaflet.metadata.offerEndDate).date || resolvedEndDate,
        validityNormalizationError:
          leaflet.metadata.validityNormalizationError ?? normResolved.normalizationError ?? null,
        currency: leaflet.metadata.currency || resolvedCurrency,
        verified: Boolean(leaflet.metadata.verified || rec.operatorConfirmed === true),
        discoverySource: rec.operatorConfirmed ? 'operator_verified' : (leaflet.metadata.discoverySource === 'targeted_vision' ? 'targeted_vision' : 'package_discovery'),
        discoveryStatus,
        discoveryMessage,
        discoveryError,
        evidenceByField,
        ...(conflictingValidity.length > 0 ? { conflictingValidity } : {})
      };
      leaflet.metadata = this.sanitizeLeafletMetadataFields(updatedMeta, {
        fileName: leaflet.fileName,
        applyDefaults: true
      });
      if (leaflet.metadata.locationScope && discoveryStatus === 'partial') {
        if (leaflet.metadata.supermarketName && leaflet.metadata.offerStartDate && leaflet.metadata.offerEndDate) {
          leaflet.metadata.discoveryStatus = 'ok';
        }
      }

      if (options?.throwOnError && discoveryStatus === 'error' && discoveryError) {
        throw new Error(discoveryError);
      }
    } catch (err: any) {
      logWarn(`Metadata discovery failed for ${leaflet.fileName}: ${err.message}`);
      leaflet.metadata = {
        ...leaflet.metadata,
        discoveryStatus: 'error',
        discoveryError: err?.message || String(err),
        discoveryMessage: err?.message || String(err)
      };
      if (options?.throwOnError) {
        throw err;
      }
    }
  }

  public async discoverLeafletMetadata(input: {
    batchId: string;
    leafletId: string;
    catalogSupermarkets?: any[];
    throwOnError?: boolean;
    forceRefresh?: boolean;
  }): Promise<BatchManifest> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);
    const leaflet = manifest.leaflets.find((l) => l.leafletId === input.leafletId);
    if (!leaflet) throw new Error(`Leaflet not found: ${input.leafletId}`);

    let thrownErr: any = null;
    try {
      await this.applyPackageMetadataDiscovery(leaflet, input.catalogSupermarkets, {
        throwOnError: input.throwOnError,
        forceRefresh: input.forceRefresh
      });
    } catch (err) {
      thrownErr = err;
    }
    await this.saveBatchManifestAtomic(manifest);
    if (thrownErr) {
      throw thrownErr;
    }
    return manifest;
  }

  public async getMetadataVisionCostEstimate(input: {
    batchId: string;
    leafletId: string;
  }): Promise<{
    ok: boolean;
    targetPages: number[];
    estimate: MetadataVisionCostEstimate;
    error?: string;
  }> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) {
      return {
        ok: false,
        targetPages: [1],
        estimate: estimateMetadataVisionCost({ targetImageCount: 1 }),
        error: `Batch not found: ${input.batchId}`
      };
    }
    const leaflet = manifest.leaflets.find((l) => l.leafletId === input.leafletId);
    if (!leaflet) {
      return {
        ok: false,
        targetPages: [1],
        estimate: estimateMetadataVisionCost({ targetImageCount: 1 }),
        error: `Leaflet not found: ${input.leafletId}`
      };
    }
    const selectedInterior = Array.from(
      new Set((leaflet.pagesToProcess || []).filter((p) => Number.isFinite(p) && p >= 2))
    )
      .sort((a, b) => a - b)
      .slice(0, 4);
    const targetPages = [1, ...selectedInterior];
    const targetImageCount = selectedInterior.length > 0 ? 2 : 1;

    return {
      ok: true,
      targetPages,
      estimate: estimateMetadataVisionCost({
        targetImageCount,
        modelId: manifest.model || 'gemini-3.8-flash',
        tier: manifest.executionMode === 'standard' ? 'standard' : 'flex'
      })
    };
  }

  /**
   * Tier B: Targeted AI Vision metadata discovery using compressed Page 1 cover
   * + selected interior page header/footer composite strips ONLY.
   * Requires explicit operator authorization; NEVER modifies pagesToProcess or triggers offer extraction.
   */
  public async discoverLeafletMetadataWithVision(input: {
    batchId: string;
    leafletId: string;
    explicitVisionAuthorization: boolean;
    forceRefresh?: boolean;
    mockResponsesByPage?: Record<number, any>;
    genAiClient?: any;
    enableLiveGemini?: boolean;
    throwOnError?: boolean;
  }): Promise<BatchManifest> {
    if (!input.explicitVisionAuthorization) {
      throw new Error('Explicit operator authorization is required before running Targeted Metadata AI Vision.');
    }

    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);
    const leaflet = manifest.leaflets.find((l) => l.leafletId === input.leafletId);
    if (!leaflet) throw new Error(`Leaflet not found: ${input.leafletId}`);

    await this.runTargetedVisionForLeaflet(leaflet, manifest, input);
    await this.saveBatchManifestAtomic(manifest);
    return manifest;
  }

  private async runTargetedVisionForLeaflet(
    leaflet: LeafletBatchItem,
    manifest: BatchManifest,
    input: {
      explicitVisionAuthorization: boolean;
      forceRefresh?: boolean;
      mockResponsesByPage?: Record<number, any>;
      genAiClient?: any;
      enableLiveGemini?: boolean;
      throwOnError?: boolean;
    }
  ): Promise<void> {
    fs.mkdirSync(leaflet.workspacePath, { recursive: true });
    const prep = await prepareMetadataVisionImages({
      pdfPath: leaflet.filePath,
      workspacePath: leaflet.workspacePath,
      selectedPages: leaflet.pagesToProcess,
      totalPages: leaflet.pageCount
    });

    if (!prep.ok || !prep.coverImagePath) {
      leaflet.metadata = {
        ...leaflet.metadata,
        discoveryStatus: 'error',
        discoveryError: prep.error || 'Failed to prepare cover/header images for Vision metadata discovery.',
        discoveryMessage: prep.error || 'Failed to prepare cover/header images for Vision metadata discovery.'
      };
      await this.saveBatchManifestAtomic(manifest);
      if (input.throwOnError) {
        throw new Error(leaflet.metadata.discoveryError || 'Vision image preparation failed');
      }
      return;
    }

    const unresolved = this.computeUnresolvedMetadataFields(leaflet.metadata);
    const targetFields: MetadataFieldKey[] =
      unresolved.length > 0 ? unresolved : ['retailer', 'validity', 'title', 'currency', 'locationScope'];

    const metadataService = getLeafletMetadataService();
    const visionService = metadataService.getVisionService();
    const fingerprint = leaflet.fileFingerprint || leaflet.leafletId;
    const visionCacheDir = path.join(leaflet.workspacePath, 'metadata', 'vision_cache');

    const visionRes = await visionService.executeTargetedVision({
      request: {
        leafletFingerprint: fingerprint,
        unresolvedFields: targetFields,
        candidatePages: prep.targetPages,
        maxAttempts: 2
      },
      operatorAuthorized: input.explicitVisionAuthorization,
      imagePathsByPage: { 1: prep.coverImagePath },
      compositeImage: prep.compositeImagePath
        ? {
          imagePath: prep.compositeImagePath,
          pages: prep.compositePages
        }
        : undefined,
      cacheDir: input.forceRefresh ? undefined : visionCacheDir,
      mockResponsesByPage: input.mockResponsesByPage,
      genAiClient: input.genAiClient,
      enableLiveGemini:
        input.enableLiveGemini ?? Boolean(!input.mockResponsesByPage && !input.genAiClient),
      model: manifest.model || 'gemini-3.8-flash',
      tier: manifest.executionMode === 'standard' ? 'standard' : 'flex'
    });

    const visionAttempts = visionRes.usageAttempts || [];
    if (visionAttempts.length > 0) {
      const ledgerSvc = this.getCostLedgerService();
      const visionRunId = `vision_${Date.now()}`;
      for (const att of visionAttempts) {
        try {
          const tsNow = new Date().toISOString();
          ledgerSvc.recordEntry(
            buildLedgerEntryFromProviderCall({
              requestId: `${manifest.batchId}:vision:${leaflet.leafletId}:p${att.pageNumber}:a${att.attemptIndex}:${att.fromCache ? 'cache' : visionRunId}`,
              batchId: manifest.batchId,
              runId: visionRunId,
              leafletId: leaflet.leafletId,
              pageNumber: att.pageNumber,
              sourceAnchor: `metadata:vision:p${att.pageNumber}`,
              stageCategory: 'metadata_discovery',
              requestPurpose: 'metadata_vision_discovery',
              modelId: att.modelId || manifest.model || 'gemini-3.8-flash',
              apiProvider: att.fromCache ? 'cache' : input.genAiClient ? 'mock' : 'vertex_ai',
              requestedTier: att.tier,
              startedAt: tsNow,
              completedAt: tsNow,
              durationMs: att.durationMs,
              outcome: att.outcome,
              finishReason: att.finishReason ?? null,
              cacheHit: att.fromCache,
              usageReported: att.usageReported,
              usage: att.usage,
              rawUsageMetadata: att.rawUsageMetadata ?? null,
              errorMessage: att.errorMessage ?? null
            })
          );
        } catch {
          // Non-fatal ledger write safeguard
        }
      }
    }

    if (!visionRes.ok && visionRes.error) {
      leaflet.metadata = {
        ...leaflet.metadata,
        discoveryStatus: 'error',
        discoveryError: visionRes.error,
        discoveryMessage: visionRes.error,
        visionCostUsd: visionRes.costUsd ?? 0,
        visionRequestsUsed: visionRes.attemptsUsed ?? 0,
        visionCacheHit: Boolean(visionRes.cacheHit),
        visionTargetPages: prep.targetPages
      };
      this.recomputeTotals(manifest);
      await this.saveBatchManifestAtomic(manifest);
      if (input.throwOnError) {
        throw new Error(visionRes.error);
      }
      return;
    }

    const prevMeta = this.sanitizeLeafletMetadataFields(leaflet.metadata);
    const mergedEvidence: Partial<Record<MetadataFieldKey, MetadataFieldEvidenceSummary>> = {
      ...(prevMeta.evidenceByField || {}),
      ...(visionRes.evidenceByField || {})
    };

    const nextRetailerId = prevMeta.supermarketId || visionRes.retailerCandidate?.resolvedRetailerId || null;
    const nextRetailerName =
      prevMeta.supermarketName ||
      visionRes.retailerCandidate?.resolvedNameEn ||
      visionRes.retailerCandidate?.detectedName ||
      null;

    const visionValidityNorm = visionRes.validityCandidate
      ? normalizeValidityRange({
        startDate: visionRes.validityCandidate.startDate,
        endDate: visionRes.validityCandidate.endDate,
        rawText: visionRes.validityCandidate.rawPrintedText,
        pageNumber: visionRes.validityCandidate.sourcePage
      })
      : { startDate: null, endDate: null, normalizationError: null, parsedCandidate: null };

    const prevStart = extractStrictIsoDate(prevMeta.offerStartDate).date;
    const prevEnd = extractStrictIsoDate(prevMeta.offerEndDate).date;
    const nextStartDate = prevStart || visionValidityNorm.startDate || null;
    const nextEndDate = prevEnd || visionValidityNorm.endDate || null;
    const validityNormError =
      nextStartDate && nextEndDate
        ? null
        : visionRes.validityCandidate?.normalizationError || visionValidityNorm.normalizationError || prevMeta.validityNormalizationError || null;

    const existingTitleSanitized = sanitizeCampaignTitle(prevMeta.leafletTitle, {
      fileName: leaflet.fileName,
      retailerNames: [nextRetailerName]
    });
    const visionTitleSanitized = sanitizeCampaignTitle(visionRes.leafletTitle, {
      fileName: leaflet.fileName,
      retailerNames: [nextRetailerName]
    });
    const nextTitle =
      (existingTitleSanitized.valid ? existingTitleSanitized.sanitizedTitle : null) ||
      (visionTitleSanitized.valid ? visionTitleSanitized.sanitizedTitle : null) ||
      null;

    const visionDetectedCities = visionRes.detectedCities || [];
    const visionHasGeoConflict = Boolean(visionRes.geographicNotice) || visionDetectedCities.length > 1;
    const prevWasDefaultNational = prevMeta.scopeSource === 'default_national';
    const nextCurrency = prevMeta.currency || visionRes.currency || null;
    const nextLocationScope =
      visionHasGeoConflict && prevWasDefaultNational
        ? null
        : prevMeta.locationScope || visionRes.locationHint?.scope || null;
    const nextScopeSource: GeographicScopeSource | null =
      prevMeta.scopeSource && !(visionHasGeoConflict && prevWasDefaultNational)
        ? prevMeta.scopeSource
        : visionRes.locationHint?.scope
          ? 'explicit_leaflet_evidence'
          : null;
    const nextCityId =
      visionHasGeoConflict && prevWasDefaultNational
        ? null
        : prevMeta.cityId || visionRes.locationHint?.cityId || null;
    const nextRegionId =
      visionHasGeoConflict && prevWasDefaultNational
        ? null
        : prevMeta.regionId || visionRes.locationHint?.regionId || null;
    const nextLocationSlug =
      visionHasGeoConflict && prevWasDefaultNational
        ? null
        : prevMeta.locationSlug || visionRes.locationHint?.locationSlug || null;
    const nextLocationLabel =
      visionHasGeoConflict && prevWasDefaultNational
        ? null
        : prevMeta.locationLabel || visionRes.locationHint?.locationNameEn || null;
    const nextDetectedCities =
      visionDetectedCities.length > 0
        ? visionDetectedCities
        : prevMeta.detectedCities;
    const nextGeographicNotice =
      nextLocationScope && !visionHasGeoConflict
        ? null
        : visionRes.geographicNotice || prevMeta.geographicNotice || null;

    const conflicts: MetadataValidityConflictSummary[] = (visionRes.conflictingValidity || []).map(
      (c) => ({
        startDate: c.startDate,
        endDate: c.endDate,
        rawPrintedText: c.rawPrintedText,
        sourcePage: c.sourcePage
      })
    );

    const updatedMeta: LeafletMetadataScope = this.sanitizeLeafletMetadataFields(
      {
        ...prevMeta,
        supermarketId: nextRetailerId,
        supermarketName: nextRetailerName,
        offerStartDate: nextStartDate,
        offerEndDate: nextEndDate,
        validityNormalizationError: validityNormError,
        leafletTitle: nextTitle,
        currency: nextCurrency,
        locationScope: nextLocationScope,
        scopeSource: nextScopeSource,
        cityId: nextCityId,
        regionId: nextRegionId,
        locationSlug: nextLocationSlug,
        locationLabel: nextLocationLabel,
        ...(nextDetectedCities && nextDetectedCities.length > 0 ? { detectedCities: nextDetectedCities } : {}),
        geographicNotice: nextGeographicNotice,
        verified: false,
        discoverySource: 'targeted_vision',
        discoveryError: null,
        evidenceByField: mergedEvidence,
        ...(conflicts.length > 0 ? { conflictingValidity: conflicts } : {}),
        visionCostUsd: visionRes.costUsd ?? 0,
        visionRequestsUsed: visionRes.attemptsUsed ?? 0,
        visionCacheHit: Boolean(visionRes.cacheHit),
        visionTargetPages: prep.targetPages
      },
      { fileName: leaflet.fileName, applyDefaults: true }
    );

    const coreMissing =
      !updatedMeta.supermarketId ||
      !updatedMeta.supermarketName ||
      !updatedMeta.offerStartDate ||
      !updatedMeta.offerEndDate ||
      !updatedMeta.locationScope ||
      Boolean(updatedMeta.geographicNotice);
    updatedMeta.discoveryStatus =
      !updatedMeta.supermarketName && !updatedMeta.offerStartDate && !updatedMeta.offerEndDate
        ? 'no_text_found'
        : coreMissing
          ? 'partial'
          : 'ok';

    const foundParts: string[] = [];
    if (updatedMeta.supermarketName) foundParts.push(`Retailer (p.${mergedEvidence.retailer?.sourcePage ?? 1})`);
    if (updatedMeta.offerStartDate || updatedMeta.offerEndDate) foundParts.push(`Validity (p.${mergedEvidence.validity?.sourcePage ?? 1})`);
    if (updatedMeta.leafletTitle) foundParts.push(`Title (p.${mergedEvidence.title?.sourcePage ?? 1})`);
    if (updatedMeta.locationScope) {
      foundParts.push(
        updatedMeta.scopeSource === 'default_national'
          ? 'Location (National assumed)'
          : `Location (p.${mergedEvidence.locationScope?.sourcePage ?? 1})`
      );
    }

    const costLabel = visionRes.cacheHit
      ? 'cache hit ($0.0000)'
      : `${visionRes.attemptsUsed} call(s), $${(visionRes.costUsd ?? 0).toFixed(4)}`;

    const extraNotes = [
      conflicts.length > 0 ? 'Conflicting validity dates found — confirm carefully.' : '',
      updatedMeta.geographicNotice || '',
      validityNormError ? `Date check: ${validityNormError}` : ''
    ].filter(Boolean).join(' ');

    updatedMeta.discoveryMessage = foundParts.length > 0
      ? `AI Vision inspected pages [${prep.targetPages.join(', ')}] (${costLabel}) -> Proposed: ${foundParts.join(', ')}.${extraNotes ? ` ${extraNotes}` : ''}`
      : `AI Vision inspected pages [${prep.targetPages.join(', ')}] (${costLabel}) but could not read retailer or dates confidently.${extraNotes ? ` ${extraNotes}` : ''}`;

    leaflet.metadata = updatedMeta;
    this.recomputeTotals(manifest);
  }

  public async getLeafletCoverPreview(input: {
    batchId: string;
    leafletId: string;
  }): Promise<PdfCoverPreviewResult> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) {
      return { ok: false, error: `Batch not found: ${input.batchId}` };
    }
    const leaflet = manifest.leaflets.find((l) => l.leafletId === input.leafletId);
    if (!leaflet) {
      return { ok: false, error: `Leaflet not found: ${input.leafletId}` };
    }
    return await renderCoverPagePreviewToDataUrl({
      pdfPath: leaflet.filePath,
      workspacePath: leaflet.workspacePath
    });
  }

  /**
   * Confirms / updates leaflet metadata by the operator and propagates it into
   * both batch manifest and workspace `confirmed_metadata.json` + `staged-draft.json`.
   */
  public async updateLeafletMetadata(input: {
    batchId: string;
    leafletId: string;
    metadata: Partial<LeafletMetadataScope>;
    verified?: boolean;
    operatorId?: string;
  }): Promise<BatchManifest> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);
    const leaflet = manifest.leaflets.find((l) => l.leafletId === input.leafletId);
    if (!leaflet) throw new Error(`Leaflet not found: ${input.leafletId}`);

    const nowIso = new Date().toISOString();
    const isVerified = input.verified !== false;
    const rawMerged: LeafletMetadataScope = {
      ...leaflet.metadata,
      ...input.metadata,
      verified: isVerified,
      verifiedAt: isVerified ? nowIso : null,
      verifiedBy: isVerified ? (input.operatorId || 'operator') : null,
      discoverySource: isVerified ? 'operator_verified' : (leaflet.metadata.discoverySource || 'unverified'),
      discoveryError: null,
      ...(input.metadata.locationScope ? { geographicNotice: null } : {})
    };
    const mergedMeta = this.sanitizeLeafletMetadataFields(rawMerged, {
      fileName: leaflet.fileName,
      applyDefaults: true,
      isOperatorSave: isVerified
    });
    if (mergedMeta.offerStartDate && mergedMeta.offerEndDate) {
      mergedMeta.validityNormalizationError = null;
    }

    const prevRevisions = Array.isArray(leaflet.metadata.metadataRevisions)
      ? leaflet.metadata.metadataRevisions
      : [];
    const nextVersion = (leaflet.metadata.metadataVersion ?? prevRevisions.length) + 1;
    const revisionEntry: LeafletMetadataRevision = {
      revision: nextVersion,
      updatedAt: nowIso,
      updatedBy: input.operatorId || 'operator',
      reason: isVerified ? 'operator_metadata_verification' : 'metadata_update',
      metadata: {
        supermarketId: mergedMeta.supermarketId ?? null,
        supermarketName: mergedMeta.supermarketName ?? null,
        locationScope: mergedMeta.locationScope ?? null,
        locationLabel: mergedMeta.locationLabel ?? null,
        locationSlug: mergedMeta.locationSlug ?? null,
        cityId: mergedMeta.cityId ?? null,
        regionId: mergedMeta.regionId ?? null,
        offerStartDate: mergedMeta.offerStartDate ?? null,
        offerEndDate: mergedMeta.offerEndDate ?? null,
        currency: mergedMeta.currency ?? null,
        leafletTitle: mergedMeta.leafletTitle ?? null
      }
    };
    const committedKeyChanged =
      (leaflet.metadata.supermarketId ?? null) !== (mergedMeta.supermarketId ?? null) ||
      (leaflet.metadata.offerStartDate ?? null) !== (mergedMeta.offerStartDate ?? null) ||
      (leaflet.metadata.offerEndDate ?? null) !== (mergedMeta.offerEndDate ?? null) ||
      (leaflet.metadata.locationScope ?? null) !== (mergedMeta.locationScope ?? null) ||
      (leaflet.metadata.cityId ?? null) !== (mergedMeta.cityId ?? null) ||
      (leaflet.metadata.regionId ?? null) !== (mergedMeta.regionId ?? null) ||
      (leaflet.metadata.currency ?? null) !== (mergedMeta.currency ?? null);

    mergedMeta.metadataVersion = nextVersion;
    mergedMeta.metadataRevisions = [...prevRevisions, revisionEntry];
    leaflet.metadata = mergedMeta;

    // Flag previously published offers on THIS leaflet ONLY if key published metadata changed (without mutating unaffected leaflets or DB rows)
    if (committedKeyChanged && manifest.publishedOffers) {
      const prefix = `${input.batchId}:${leaflet.leafletId}:`;
      for (const [k, pubState] of Object.entries(manifest.publishedOffers)) {
        if (k.startsWith(prefix) && pubState?.state === 'published') {
          pubState.needsUpdateReview = true;
        }
      }
    }

    // Persist confirmed_metadata.json inside leaflet workspace when workspace exists
    try {
      const metaDir = path.join(leaflet.workspacePath, 'metadata');
      fs.mkdirSync(metaDir, { recursive: true });
      const confirmedRecord = {
        schemaVersion: 'wifran.leaflet.metadata/1.0',
        leafletFingerprint: leaflet.fileFingerprint || leaflet.leafletId,
        metadataVersion: nextVersion,
        metadataRevisions: mergedMeta.metadataRevisions,
        operatorConfirmed: isVerified,
        confirmedAt: isVerified ? nowIso : null,
        confirmedBy: isVerified ? (input.operatorId || 'operator') : null,
        retailer: {
          resolvedRetailerId: leaflet.metadata.supermarketId || null,
          resolvedNameEn: leaflet.metadata.supermarketName || null,
          detectedName: leaflet.metadata.supermarketName || null
        },
        locationScope: leaflet.metadata.locationScope || null,
        locationSlug: leaflet.metadata.locationSlug || null,
        cityId: leaflet.metadata.cityId || null,
        regionId: leaflet.metadata.regionId || null,
        leafletTitle: leaflet.metadata.leafletTitle || null,
        currency: leaflet.metadata.currency || null,
        validity: {
          startDate: leaflet.metadata.offerStartDate || null,
          endDate: leaflet.metadata.offerEndDate || null
        }
      };
      fs.writeFileSync(
        path.join(metaDir, 'confirmed_metadata.json'),
        JSON.stringify({ record: confirmedRecord }, null, 2),
        'utf8'
      );
    } catch (err: any) {
      logWarn(`Failed writing confirmed_metadata.json for ${leaflet.leafletId}: ${err.message}`);
    }

    // Propagate verified header into staged-draft.json and flag/revalidate local draft items
    const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
    if (fs.existsSync(draftPath)) {
      try {
        const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
        draft.header = {
          ...(draft.header || {}),
          supermarketId: leaflet.metadata.supermarketId ?? null,
          region: leaflet.metadata.locationLabel ?? null,
          locationScope: leaflet.metadata.locationScope ?? null,
          cityId: leaflet.metadata.cityId ?? null,
          regionId: leaflet.metadata.regionId ?? null,
          locationSlug: leaflet.metadata.locationSlug ?? null,
          validFrom: leaflet.metadata.offerStartDate ?? null,
          validTo: leaflet.metadata.offerEndDate ?? null,
          currency: leaflet.metadata.currency ?? null,
          metadataVersion: nextVersion,
          headerModifiedByOperator: true
        };
        if (committedKeyChanged && Array.isArray(draft.items)) {
          for (const it of draft.items) {
            if (it?.publicationState?.state === 'published') {
              it.publicationState.needsUpdateReview = true;
            }
          }
        }
        draft.updatedAt = nowIso;
        fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');
      } catch (err: any) {
        logWarn(`Failed propagating metadata to staged-draft.json: ${err.message}`);
      }
    }

    await this.saveBatchManifestAtomic(manifest);
    return manifest;
  }

  /**
   * Operator edit of an extracted offer in batch review, preserving original source evidence (`originalOcr`).
   */
  public async updateBatchOfferFields(input: {
    batchId: string;
    batchOfferKey: string;
    operatorId?: string;
    supabase?: SupabaseClient | null;
    orchestrator?: CatalogMatchingOrchestrator;
    databaseContext?: DatabaseContext;
    patch: {
      titleAr?: string | null;
      titleEn?: string | null;
      brand?: string | null;
      brandAr?: string | null;
      brandEn?: string | null;
      variantOrFlavor?: string | null;
      promoPrice?: number | null;
      originalPrice?: number | null;
      sizeOrWeight?: string | null;
      each_size_value?: number | null;
      each_size_unit?: string | null;
      inner_pack_count?: number | null;
      sale_unit_type?: string | null;
      promoNotes?: string | null;
      currency?: string | null;
      assortment_status?: string | null;
      revalidate?: boolean;
      confirmConflictResolution?: boolean;
    };
  }): Promise<UnifiedBatchOffer> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);

    const parts = input.batchOfferKey.split(':');
    const leafletId = parts[1];
    const sourceOfferId = parts.slice(3).join(':');
    const leaflet = manifest.leaflets.find((l) => l.leafletId === leafletId);
    if (!leaflet) throw new Error(`Leaflet ${leafletId} not found in batch ${input.batchId}`);

    const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
    if (!fs.existsSync(draftPath)) {
      throw new Error(`staged-draft.json not found for leaflet ${leafletId}`);
    }

    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    const idx = Array.isArray(draft.items)
      ? draft.items.findIndex((it: any) => (it.sourceOfferId || it.id) === sourceOfferId)
      : -1;
    if (idx < 0) {
      throw new Error(`Offer ${sourceOfferId} not found in leaflet ${leafletId}`);
    }

    const item = draft.items[idx];
    const wasQuarantined =
      item.v3RetentionMode === 'quarantined_do_not_publish' ||
      (Array.isArray(item.quarantineReasons) && item.quarantineReasons.length > 0);

    // Preserve immutable originalOcr snapshot
    if (!item.originalOcr) {
      item.originalOcr = {
        titleEn: item.titleEn ?? null,
        titleAr: item.titleAr ?? null,
        brand: item.brand ?? null,
        sizeOrWeight: item.sizeOrWeight ?? null,
        priceBefore: item.priceBefore ?? null,
        priceAfter: item.priceAfter ?? null,
        discountPercent: item.discountPercent ?? null,
        promoNotes: item.promoNotes ?? null,
        inner_pack_count: item.inner_pack_count ?? null,
        each_size_value: item.each_size_value ?? null,
        each_size_unit: item.each_size_unit ?? null,
        total_content_value: item.total_content_value ?? null,
        total_content_unit: item.total_content_unit ?? null,
        free_units_text: item.free_units_text ?? null,
        customer_limit: item.customer_limit ?? null,
        sale_unit_type: item.sale_unit_type ?? null,
        productThumbLocalPath: item.productThumbLocalPath ?? null,
        originalConflictCodes: Array.isArray(item.conflictCodes) ? [...item.conflictCodes] : [],
        originalQuarantineReasons: Array.isArray(item.quarantineReasons) ? [...item.quarantineReasons] : [],
        originalV3RetentionMode: item.v3RetentionMode ?? null,
        originalAssortmentStatus: item.assortment_status ?? null
      };
    }

    const p = input.patch;
    const isFieldChanged = (oldVal: unknown, newVal: unknown): boolean => {
      if (newVal === undefined) return false;
      const norm = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
      return norm(oldVal) !== norm(newVal);
    };

    const identityFieldChanged =
      isFieldChanged(item.titleAr, p.titleAr) ||
      isFieldChanged(item.titleEn, p.titleEn) ||
      isFieldChanged(item.brand, p.brand) ||
      isFieldChanged(item.brandAr, p.brandAr) ||
      isFieldChanged(item.brandEn, p.brandEn) ||
      isFieldChanged(item.variantOrFlavor, p.variantOrFlavor) ||
      isFieldChanged(item.sizeOrWeight, p.sizeOrWeight) ||
      isFieldChanged(item.each_size_value, p.each_size_value) ||
      isFieldChanged(item.each_size_unit, p.each_size_unit) ||
      isFieldChanged(item.inner_pack_count, p.inner_pack_count) ||
      isFieldChanged(item.sale_unit_type, p.sale_unit_type) ||
      isFieldChanged(item.assortment_status, p.assortment_status);

    const priceOrFactChanged =
      isFieldChanged(item.priceAfter, p.promoPrice) ||
      isFieldChanged(item.priceBefore, p.originalPrice) ||
      isFieldChanged(item.promoNotes, p.promoNotes) ||
      isFieldChanged(item.currency, p.currency);

    const editedFields = new Set<string>(Array.isArray(item.operatorEditedFields) ? item.operatorEditedFields : []);
    const applyField = (draftKey: string, val: unknown) => {
      if (val !== undefined) {
        item[draftKey] = val;
        editedFields.add(draftKey);
      }
    };

    applyField('titleAr', p.titleAr);
    applyField('titleEn', p.titleEn);
    applyField('brand', p.brand);
    applyField('brandAr', p.brandAr);
    applyField('brandEn', p.brandEn);
    applyField('variantOrFlavor', p.variantOrFlavor);
    applyField('priceAfter', p.promoPrice);
    applyField('priceBefore', p.originalPrice);
    applyField('sizeOrWeight', p.sizeOrWeight);
    applyField('each_size_value', p.each_size_value);
    applyField('each_size_unit', p.each_size_unit);
    applyField('inner_pack_count', p.inner_pack_count);
    applyField('sale_unit_type', p.sale_unit_type);
    applyField('promoNotes', p.promoNotes);
    applyField('currency', p.currency);
    applyField('assortment_status', p.assortment_status);

    const nowIso = new Date().toISOString();
    // Deterministic revalidation after applying operator corrections (never bypasses failed rules)
    if (p.revalidate !== false) {
      const reval = revalidateOfferItem({
        item,
        leafletMetadata: leaflet.metadata,
        confirmConflictResolution: Boolean(p.confirmConflictResolution)
      });
      item.conflictCodes = reval.conflictCodes;
      item.quarantineReasons = reval.quarantineReasons;
      item.blockingErrors = reval.blockingErrors;
      item.warnings = reval.warnings;
      item.v3RetentionMode = reval.v3RetentionMode;
      if (reval.imageSubjectScope !== undefined) {
        item.imageSubjectScope = reval.imageSubjectScope;
      }
      item.canUseProductThumbForCatalogSku = Boolean(
        reval.isValid && item.productThumbLocalPath && item.imageSubjectScope === 'product_package'
      );
      item.lastValidatedAt = nowIso;
      item.validationOrigin = 'operator_revalidate';
    }

    const nowQuarantineFree =
      item.v3RetentionMode !== 'quarantined_do_not_publish' &&
      (!Array.isArray(item.quarantineReasons) || item.quarantineReasons.length === 0);

    if (item.publicationState?.state === 'published' && (identityFieldChanged || priceOrFactChanged)) {
      item.publicationState.needsUpdateReview = true;
      if (manifest.publishedOffers?.[input.batchOfferKey]) {
        manifest.publishedOffers[input.batchOfferKey].needsUpdateReview = true;
        await this.saveBatchManifestAtomic(manifest);
      }
    }
    if (
      identityFieldChanged &&
      (item.approvedConsumerImageRightsBasis === 'operator_verified_leaflet_product_crop' ||
        (item.consumerProductImagePath && item.approvedConsumerImageRightsBasis !== 'generated_product_crop'))
    ) {
      item.consumerProductImagePath = null;
      item.approvedConsumerImageRightsBasis = null;
      item.consumerImageApprovalStatus = 'invalidated_identity_changed';
    } else if (identityFieldChanged && item.approvedConsumerImageRightsBasis === 'generated_product_crop') {
      item.consumerProductImagePath = null;
      item.approvedConsumerImageRightsBasis = null;
      item.consumerImageApprovalStatus = null;
    }
    item.operatorEditedFields = Array.from(editedFields);
    item.isOperatorModified = true;
    item.operatorEdited = true;
    item.operatorEditedAt = nowIso;
    item.operatorEditedBy = input.operatorId || 'operator';
    draft.updatedAt = nowIso;

    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');

    const refreshed = await this.getUnifiedBatchOffers(input.batchId, { leafletId });
    const match = refreshed.find((o) => o.batchOfferKey === input.batchOfferKey);
    if (!match) {
      throw new Error(`Updated offer ${input.batchOfferKey} could not be reloaded.`);
    }

    try {
      const orchestrator =
        input.orchestrator ||
        new CatalogMatchingOrchestrator(undefined, undefined, undefined, undefined, this.getBatchesBaseDir());
      const matchingManifest = orchestrator.loadManifest(input.batchId);
      if (matchingManifest) {
        const allBatchOffers = await this.getUnifiedBatchOffers(input.batchId);
        const rematchRes = await orchestrator.rematchUpdatedOffer({
          batchId: input.batchId,
          updatedOffer: match,
          allBatchOffers,
          supabase: input.supabase || undefined,
          databaseContext: input.databaseContext ?? manifest.approvedScope?.targetDatabaseContext,
          identityFieldChanged: identityFieldChanged || (wasQuarantined && nowQuarantineFree),
          priceOrFactChanged
        });
        match.rematchOutcome = rematchRes.outcome;
        match.rematchMessage = rematchRes.message;
        const imgApprovalAfter = rematchRes.manifest?.consumerImageApprovals?.[input.batchOfferKey];
        if (imgApprovalAfter) {
          match.consumerImageApprovalStatus = imgApprovalAfter.status;
          match.consumerProductImagePath =
            imgApprovalAfter.status === 'approved_generated_crop' ? imgApprovalAfter.approvedLocalPath : null;
          match.existingCatalogProductImageUrl = imgApprovalAfter.existingCatalogImageUrl ?? match.existingCatalogProductImageUrl ?? null;
          match.approvedConsumerImageRightsBasis = imgApprovalAfter.rightsBasis ?? null;
          match.consumerImageApprovedForProductKey = imgApprovalAfter.approvedForProductKey;
          match.consumerImageInvalidationReason = imgApprovalAfter.invalidationReason ?? null;
        } else if (identityFieldChanged && item.consumerImageApprovalStatus === 'invalidated_identity_changed') {
          match.consumerImageApprovalStatus = 'invalidated_identity_changed';
          match.consumerProductImagePath = null;
          match.approvedConsumerImageRightsBasis = null;
        }

        if (manifest.matchingSummary && rematchRes.manifest) {
          manifest.matchingSummary = {
            ...manifest.matchingSummary,
            existingMatchesCount: rematchRes.manifest.totals.proposedExistingCount || 0,
            temporaryGroupsCount: rematchRes.manifest.totals.proposedTemporaryCount || 0,
            unresolvedCount: rematchRes.manifest.totals.unresolvedCount || 0,
            actualCostUsd: Number((rematchRes.manifest.totals.estimatedCostUsd || manifest.matchingSummary.actualCostUsd || 0).toFixed(6))
          };
          this.recomputeTotals(manifest);
          await this.saveBatchManifestAtomic(manifest);
        }
      }
    } catch (rematchErr: any) {
      logWarn(`Offer edit rematch warning for ${input.batchOfferKey}: ${rematchErr?.message}`);
    }

    return match;
  }

  /**
   * Resolves an offer as an assorted multi-variant product:
   * - Appends " — Assorted" to English title and " — متنوع" to Arabic title
   * - Sets assortment_status to 'unsplit_assortment'
   * - Suppresses per-unit pricing on mixed sizes
   * - Clears non-fatal assortment conflicts (INCOMPLETE_VISIBLE_ASSORTMENT, MULTIPLE_PRODUCT_VARIANTS_DETECTED, WEIGHT_RANGE_UNPAIRED)
   * - Sets selectedImageSource to 'product_thumb' and imageSubjectScope to 'representative_assortment'
   * - Revalidates offer and updates catalog matching proposal to provisional/temporary
   */
  public async resolveOfferAsAssorted(input: {
    batchId: string;
    batchOfferKey: string;
    operatorId?: string;
    customTitleEn?: string;
    customTitleAr?: string;
    appendAssortedSuffix?: boolean;
    databaseContext?: DatabaseContext;
    supabase?: SupabaseClient | null;
  }): Promise<UnifiedBatchOffer> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);

    const parts = input.batchOfferKey.split(':');
    const leafletId = parts[1];
    const sourceOfferId = parts.slice(3).join(':');
    const leaflet = manifest.leaflets.find((l) => l.leafletId === leafletId);
    if (!leaflet) throw new Error(`Leaflet ${leafletId} not found in batch ${input.batchId}`);

    const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
    if (!fs.existsSync(draftPath)) throw new Error(`staged-draft.json not found for leaflet ${leafletId}`);

    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    const idx = Array.isArray(draft.items)
      ? draft.items.findIndex((it: any) => (it.sourceOfferId || it.id) === sourceOfferId)
      : -1;
    if (idx < 0) throw new Error(`Offer ${sourceOfferId} not found in leaflet ${leafletId}`);

    const item = draft.items[idx];

    // Determine normalized assorted titles
    const currentTitleEn = input.customTitleEn || item.titleEn || '';
    const currentTitleAr = input.customTitleAr || item.titleAr || '';
    const normTitleEn = normalizeAssortedTitle(currentTitleEn, 'en');
    const normTitleAr = normalizeAssortedTitle(currentTitleAr, 'ar');

    // Clean non-fatal assortment conflict codes
    const NON_FATAL_ASSORTMENT_CODES = new Set([
      'INCOMPLETE_VISIBLE_ASSORTMENT',
      'MULTIPLE_PRODUCT_VARIANTS_DETECTED',
      'WEIGHT_RANGE_UNPAIRED'
    ]);
    if (Array.isArray(item.conflictCodes)) {
      item.conflictCodes = item.conflictCodes.filter((c: string) => !NON_FATAL_ASSORTMENT_CODES.has(c));
    }
    if (Array.isArray(item.quarantineReasons)) {
      item.quarantineReasons = item.quarantineReasons.filter((c: string) => !NON_FATAL_ASSORTMENT_CODES.has(c));
    }
    item.blockingErrors = [];
    item.selectedImageSource = 'product_thumb';
    item.imageSubjectScope = 'representative_assortment';

    // Check mixed sizes and suppress unit pricing
    const combinedSizes = `${normTitleEn} ${normTitleAr} ${item.sizeOrWeight || ''}`;
    const hasMultipleSizes = /\d+(?:\.\d+)?\s*(?:ml|l|ltr|g|gm|gms|kg)\s*[\/\\,]\s*\d+(?:\.\d+)?\s*(?:ml|l|ltr|g|gm|gms|kg)/i.test(combinedSizes);
    if (hasMultipleSizes) {
      item.unit_price = null;
      item.unit_price_unit = null;
      item.informational_inner_unit_price = null;
      item.display_unit_price_label_ar = null;
      item.display_unit_price_label_en = null;
    }

    item.operatorAssortmentResolution = {
      resolvedAt: new Date().toISOString(),
      resolvedBy: input.operatorId || 'operator_ui',
      previousAssortmentStatus: item.originalOcr?.originalAssortmentStatus || 'unknown'
    };

    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');

    // Delegate to updateBatchOfferFields to run complete authoritative revalidation & catalog rematching
    return await this.updateBatchOfferFields({
      batchId: input.batchId,
      batchOfferKey: input.batchOfferKey,
      operatorId: input.operatorId || 'operator_ui',
      databaseContext: input.databaseContext,
      supabase: input.supabase,
      patch: {
        titleEn: normTitleEn,
        titleAr: normTitleAr,
        assortment_status: 'unsplit_assortment',
        revalidate: true,
        confirmConflictResolution: true
      }
    });
  }

  /**
   * Replaces an offer's product image using a selected image file:
   * - Validates dimensions (min 100x100) and size (max 20MB)
   * - Copies and converts into durable batch workspace asset (crops/custom/<sourceOfferId>_custom.webp)
   * - Updates staged-draft.json and matching-proposals.json
   */
  public async selectAndReplaceOfferImage(input: {
    batchId: string;
    batchOfferKey: string;
    customFilePath?: string;
    window?: any;
  }): Promise<{ success: boolean; canceled?: boolean; updatedOffer?: UnifiedBatchOffer; error?: string }> {
    let sourceFilePath = input.customFilePath;

    if (!sourceFilePath) {
      const { dialog } = await import('electron');
      const dialogRes = await dialog.showOpenDialog(input.window || null, {
        title: 'Select Replacement Product Image',
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }
        ],
        properties: ['openFile']
      });
      if (dialogRes.canceled || !dialogRes.filePaths?.length) {
        return { success: false, canceled: true };
      }
      sourceFilePath = dialogRes.filePaths[0];
    }

    if (!fs.existsSync(sourceFilePath)) {
      return { success: false, error: `Selected file does not exist: ${sourceFilePath}` };
    }

    const stat = fs.statSync(sourceFilePath);
    if (stat.size > 20 * 1024 * 1024) {
      return { success: false, error: `Image file exceeds maximum 20MB limit (${(stat.size / 1024 / 1024).toFixed(1)}MB)` };
    }

    const sharp = (await import('sharp')).default;
    const meta = await sharp(sourceFilePath).metadata();
    if (!meta.width || !meta.height || meta.width < 100 || meta.height < 100) {
      return { success: false, error: `Image dimensions (${meta.width || 0}x${meta.height || 0}) must be at least 100x100 pixels` };
    }

    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);

    const parts = input.batchOfferKey.split(':');
    const leafletId = parts[1];
    const sourceOfferId = parts.slice(3).join(':');
    const leaflet = manifest.leaflets.find((l) => l.leafletId === leafletId);
    if (!leaflet) throw new Error(`Leaflet ${leafletId} not found in batch ${input.batchId}`);

    const customCropsDir = path.join(leaflet.workspacePath, 'crops', 'custom');
    if (!fs.existsSync(customCropsDir)) {
      fs.mkdirSync(customCropsDir, { recursive: true });
    }

    const targetCustomPath = path.join(customCropsDir, `${sourceOfferId}_custom.webp`);
    await sharp(sourceFilePath).webp({ quality: 90 }).toFile(targetCustomPath);

    const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    const item = draft.items.find((it: any) => (it.sourceOfferId || it.id) === sourceOfferId);
    if (!item) throw new Error(`Offer ${sourceOfferId} not found in draft`);

    item.customProductThumbCropPath = targetCustomPath;
    item.productThumbLocalPath = targetCustomPath;
    item.selectedImageSource = 'custom_thumb';
    item.consumerProductImagePath = targetCustomPath;
    item.consumerImageApprovalStatus = 'approved_generated_crop';
    item.approvedConsumerImageRightsBasis = 'operator_replaced_image';
    item.imageSubjectScope = item.assortment_status === 'unsplit_assortment' ? 'representative_assortment' : 'product_package';
    draft.updatedAt = new Date().toISOString();
    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');

    // Update matching manifest
    const orchestrator = new CatalogMatchingOrchestrator(undefined, undefined, undefined, undefined, this.getBatchesBaseDir());
    const matchingManifest = orchestrator.loadManifest(input.batchId);
    if (matchingManifest) {
      matchingManifest.consumerImageApprovals = matchingManifest.consumerImageApprovals || {};
      matchingManifest.consumerImageApprovals[input.batchOfferKey] = {
        batchOfferKey: input.batchOfferKey,
        status: 'approved_generated_crop',
        sourceType: 'product_thumb_crop',
        approvedLocalPath: targetCustomPath,
        existingCatalogImageUrl: null,
        approvedForProductKey: `custom:${sourceOfferId}`,
        approvedForProductLabel: item.titleEn || item.titleAr || null,
        rightsBasis: 'operator_replaced_image',
        verifiedBy: 'operator_ui',
        updatedAt: new Date().toISOString()
      };
      orchestrator.saveManifestAtomic(matchingManifest);
    }

    const refreshedOffers = await this.getUnifiedBatchOffers(input.batchId, { leafletId });
    const updatedOffer = refreshedOffers.find((o) => o.batchOfferKey === input.batchOfferKey);

    return { success: true, updatedOffer };
  }

  /**
   * Restores an offer's original auto-generated product crop, clearing custom replacement.
   */
  public async restoreDefaultOfferImage(input: {
    batchId: string;
    batchOfferKey: string;
  }): Promise<{ success: boolean; updatedOffer?: UnifiedBatchOffer; error?: string }> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);

    const parts = input.batchOfferKey.split(':');
    const leafletId = parts[1];
    const sourceOfferId = parts.slice(3).join(':');
    const leaflet = manifest.leaflets.find((l) => l.leafletId === leafletId);
    if (!leaflet) throw new Error(`Leaflet ${leafletId} not found in batch ${input.batchId}`);

    const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    const item = draft.items.find((it: any) => (it.sourceOfferId || it.id) === sourceOfferId);
    if (!item) throw new Error(`Offer ${sourceOfferId} not found in draft`);

    const pageNum = item.pageNumber || parts[2] || 1;
    const defaultCropPath = path.join(
      leaflet.workspacePath,
      'crops',
      `page_${pageNum}`,
      sourceOfferId,
      'product_thumb_crop.webp'
    );

    item.customProductThumbCropPath = null;
    if (fs.existsSync(defaultCropPath)) {
      item.productThumbLocalPath = defaultCropPath;
      item.selectedImageSource = 'product_thumb';
      item.consumerProductImagePath = defaultCropPath;
      item.consumerImageApprovalStatus = 'approved_generated_crop';
      item.approvedConsumerImageRightsBasis = 'generated_product_crop';
    } else {
      item.selectedImageSource = 'none';
      item.consumerProductImagePath = null;
      item.consumerImageApprovalStatus = 'unreviewed';
      item.approvedConsumerImageRightsBasis = null;
    }
    draft.updatedAt = new Date().toISOString();
    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');

    // Update matching manifest
    const orchestrator = new CatalogMatchingOrchestrator(undefined, undefined, undefined, undefined, this.getBatchesBaseDir());
    const matchingManifest = orchestrator.loadManifest(input.batchId);
    if (matchingManifest) {
      if (fs.existsSync(defaultCropPath)) {
        matchingManifest.consumerImageApprovals = matchingManifest.consumerImageApprovals || {};
        matchingManifest.consumerImageApprovals[input.batchOfferKey] = {
          batchOfferKey: input.batchOfferKey,
          status: 'approved_generated_crop',
          sourceType: 'product_thumb_crop',
          approvedLocalPath: defaultCropPath,
          existingCatalogImageUrl: null,
          approvedForProductKey: `offer:${input.batchOfferKey}`,
          approvedForProductLabel: item.titleEn || item.titleAr || null,
          rightsBasis: 'generated_product_crop',
          verifiedBy: 'system_auto_selected',
          updatedAt: new Date().toISOString()
        };
      } else if (matchingManifest.consumerImageApprovals?.[input.batchOfferKey]) {
        delete matchingManifest.consumerImageApprovals[input.batchOfferKey];
      }
      orchestrator.saveManifestAtomic(matchingManifest);
    }

    const refreshedOffers = await this.getUnifiedBatchOffers(input.batchId, { leafletId });
    const updatedOffer = refreshedOffers.find((o) => o.batchOfferKey === input.batchOfferKey);

    return { success: true, updatedOffer };
  }

  /**
   * Updates the consumer product image for an already-published offer:
   * - Uploads the replacement image to storage bucket
   * - Updates image_url and thumbnail_url on the existing published offer row in public.offers
   * - Updates product_images for the associated product
   * - Does NOT create a new offer or duplicate the product!
   */
  /**
   * Updates the consumer product image for an already-published offer:
   * - Uploads the replacement image to storage bucket
   * - Protects shared products: routes to offer-display-images if product_id is shared across tiers
   * - Updates image_url and thumbnail_url on the existing published offer row in public.offers
   * - Does NOT create a new offer or duplicate the product!
   */
  public async updatePublishedOfferImage(input: {
    batchId: string;
    batchOfferKey: string;
    operatorConfirmed: boolean;
    databaseContext?: DatabaseContext;
    pgClient?: SqlQueryable;
    storageAdapter?: StorageLifecycleAdapter;
  }): Promise<{ success: boolean; newImageUrl?: string; error?: string }> {
    if (!input.operatorConfirmed) {
      return { success: false, error: 'Operator confirmation is required to update published offer image.' };
    }

    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);

    const parts = input.batchOfferKey.split(':');
    const leafletId = parts[1];
    const sourceOfferId = parts.slice(3).join(':');
    const leaflet = manifest.leaflets.find((l) => l.leafletId === leafletId);
    if (!leaflet) throw new Error(`Leaflet ${leafletId} not found in batch ${input.batchId}`);

    const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    const item = draft.items.find((it: any) => (it.sourceOfferId || it.id) === sourceOfferId);
    if (!item) throw new Error(`Offer ${sourceOfferId} not found in draft`);

    if (item.publicationState?.state !== 'published') {
      return { success: false, error: 'Offer is not currently in published state.' };
    }

    const localImgPath = item.customProductThumbCropPath || item.consumerProductImagePath || item.productThumbLocalPath;
    if (!localImgPath || !fs.existsSync(localImgPath)) {
      return { success: false, error: `Image file does not exist: ${localImgPath}` };
    }

    // Check if productId is shared OR if this is an assortment / non-catalog display visual
    const productId = item.publicationState.productId ? String(item.publicationState.productId) : null;
    const isSharedProduct = Boolean(
      productId &&
      draft.items.filter((it: any) => String(it.publicationState?.productId) === productId).length > 1
    );
    const isAssortmentItem =
      item.imageSubjectScope === 'representative_assortment' ||
      ['unsplit_assortment', 'multiple_variants', 'explicit_assortment', 'assorted'].includes(
        String(item.assortment_status || '').toLowerCase()
      );
    const useOfferDisplayRouting = isSharedProduct || !productId || isAssortmentItem;

    const targetBucket = useOfferDisplayRouting ? 'offer-display-images' : 'product-images';
    const dbContext = input.databaseContext || item.publicationState.databaseContext || 'PRODUCTION_UI';

    let adapter = input.storageAdapter;
    if (!adapter) {
      const { createGuardedStorageAdapter } = await import('../storage/stagedStorageLifecycleService');
      adapter = createGuardedStorageAdapter(dbContext);
    }
    const { stageContentAddressedUpload } = await import('../storage/stagedStorageLifecycleService');

    const stagedImg = await stageContentAddressedUpload({
      adapter,
      bucket: targetBucket,
      localFilePath: localImgPath,
      scopePrefix: useOfferDisplayRouting ? 'offers' : 'products',
      extension: 'webp'
    });
    if (!stagedImg?.publicUrl) {
      return { success: false, error: 'Failed to upload replacement image to storage bucket.' };
    }

    let ownedClient = false;
    let pgClient = input.pgClient;
    if (!pgClient) {
      const { createGuardedPgClient } = await import('../db/databaseEnvironmentResolver');
      const guarded = createGuardedPgClient(dbContext);
      await guarded.connect();
      pgClient = guarded;
      ownedClient = true;
    }

    try {
      const offerId = item.publicationState.offerId;

      await pgClient.query(
        `UPDATE public.offers
         SET thumbnail_url = $1, image_url = $1, updated_at = NOW()
         WHERE id = $2`,
        [stagedImg.publicUrl, offerId]
      );

      if (useOfferDisplayRouting) {
        // Shared product or assortment: isolate image reference at offer level in offer_display_images
        const existingOdi = await pgClient.query(
          `SELECT id FROM public.offer_display_images WHERE offer_id = $1 AND approval_status = 'approved' LIMIT 1`,
          [offerId]
        );
        if (existingOdi.rows.length > 0) {
          await pgClient.query(
            `UPDATE public.offer_display_images
             SET public_url = $1, storage_object_path = $2, storage_bucket = $3, byte_size = $4, content_sha256 = $5, updated_at = NOW()
             WHERE id = $6`,
            [stagedImg.publicUrl, stagedImg.objectPath, targetBucket, stagedImg.byteSize || 1024, stagedImg.contentSha256 || 'unknown', existingOdi.rows[0].id]
          );
        } else {
          await pgClient.query(
            `INSERT INTO public.offer_display_images (
              offer_id, storage_bucket, storage_object_path, public_url,
              mime_type, byte_size, content_sha256, source_kind, visual_subject_key,
              approval_status, rights_basis, reviewed_by
            ) VALUES ($1, $2, $3, $4, 'image/webp', $5, $6, 'promotional_leaflet_crop', $7, 'approved', 'operator_manual_verified', 'operator')`,
            [offerId, targetBucket, stagedImg.objectPath, stagedImg.publicUrl, stagedImg.byteSize || 1024, stagedImg.contentSha256 || 'unknown', sourceOfferId]
          );
        }
      } else if (productId) {
        // Unique product: update canonical product image in product_images
        const existingPi = await pgClient.query(
          `SELECT id FROM public.product_images WHERE product_id = $1 AND role = 'primary' AND approval_status = 'approved' LIMIT 1`,
          [Number(productId)]
        );
        if (existingPi.rows.length > 0) {
          await pgClient.query(
            `UPDATE public.product_images
             SET public_url = $1, storage_object_path = $2, byte_size = $3, content_sha256 = $4, updated_at = NOW()
             WHERE id = $5`,
            [stagedImg.publicUrl, stagedImg.objectPath, stagedImg.byteSize || 1024, stagedImg.contentSha256 || 'unknown', existingPi.rows[0].id]
          );
        } else {
          await pgClient.query(
            `INSERT INTO public.product_images (
              product_id, role, storage_bucket, storage_object_path, public_url,
              mime_type, byte_size, content_sha256, source_url, normalized_source_url,
              approval_status, rights_basis, reviewed_by
            ) VALUES ($1, 'primary', $2, $3, $4, 'image/webp', $5, $6, $4, $4, 'approved', 'operator_manual_verified', 'operator')`,
            [Number(productId), targetBucket, stagedImg.objectPath, stagedImg.publicUrl, stagedImg.byteSize || 1024, stagedImg.contentSha256 || 'unknown']
          );
        }
      }

      item.publicationState.imageUrl = stagedImg.publicUrl;
      item.publicationState.needsUpdateReview = false;
      fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');

      return { success: true, newImageUrl: stagedImg.publicUrl };
    } finally {
      if (ownedClient && (pgClient as any).end) {
        await (pgClient as any).end();
      }
    }
  }

  /**
   * Records explicit operator confirmation for a derived tier crop after visual inspection.
   */
  public async confirmDerivedTierCrop(input: {
    batchId: string;
    batchOfferKey: string;
  }): Promise<{ confirmed: boolean; metaPath: string | null }> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);
    return confirmDerivedTierCropOnDisk({
      batchDir: this.getBatchDir(input.batchId),
      batchId: input.batchId,
      batchOfferKey: input.batchOfferKey,
      manifest
    });
  }

  /**
   * Read-only preview of proposed identity corrections and image repairs for published offers.
   * Performs zero database writes and zero storage mutations.
   */
  public async previewPublishedOfferImageRepairs(input: {
    batchId: string;
    confirmedCropOfferKeys?: string[];
    databaseContext?: DatabaseContext;
    pgClient?: SqlQueryable;
  }): Promise<PublishedOfferImageRepairResult> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);
    return executeOrPreviewPublishedOfferRepairs({
      batchesDir: path.dirname(this.getBatchDir(input.batchId)),
      manifest,
      batchId: input.batchId,
      previewOnly: true,
      operatorAuthorizedRepair: false,
      operatorAuthorizedIdentityCorrection: false,
      confirmedCropOfferKeys: input.confirmedCropOfferKeys,
      databaseContext: input.databaseContext,
      pgClient: input.pgClient
    });
  }

  /**
   * Controlled, guarded maintenance & image repair for published offers:
   * - Requires explicit operator authorization (operatorAuthorizedRepair and/or operatorAuthorizedIdentityCorrection)
   * - Fixes 10kg-to-5kg tier catalog links and assortment single-SKU links safely
   * - Rejects unsuitable dual-price offer_card_crop.webp images
   * - Protects shared product_images via offer_display_images routing
   * - Transactional with maintenance journal capture and compensating storage cleanup on rollback
   */
  public async repairPublishedOfferImages(input: {
    batchId: string;
    operatorAuthorizedRepair?: boolean;
    operatorAuthorizedIdentityCorrection?: boolean;
    confirmedCropOfferKeys?: string[];
    targetBatchOfferKeys?: string[];
    previewOnly?: boolean;
    operatorId?: string;
    databaseContext?: DatabaseContext;
    pgClient?: SqlQueryable;
    storageAdapter?: StorageLifecycleAdapter;
  }): Promise<PublishedOfferImageRepairResult> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) throw new Error(`Batch not found: ${input.batchId}`);
    return executeOrPreviewPublishedOfferRepairs({
      batchesDir: path.dirname(this.getBatchDir(input.batchId)),
      manifest,
      ...input
    });
  }


  public async resumeBatch(
    batchId: string,
    options?: BatchExtractionOptions,
    onProgress?: (event: BatchProgressEvent) => void
  ): Promise<BatchManifest> {
    const manifest = await this.loadBatchManifest(batchId);
    if (!manifest) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    if (manifest.extractionPipelineMode === 'hybrid_v3') {
      if (!options?.hybridV3ExplicitAuthorization || !options?.hybridV3FeatureEnabled) {
        throw new Error(
          'HYBRID_V3_RESUME_AUTHORIZATION_REQUIRED: Resuming Hybrid V3 batch requires explicit operator authorization.'
        );
      }
      if (manifest.approvedScope?.pagesByLeafletId) {
        let scopeExpanded = false;
        for (const leaflet of manifest.leaflets) {
          const currentPages =
            leaflet.pagesToProcess && leaflet.pagesToProcess.length > 0
              ? leaflet.pagesToProcess
              : Array.from({ length: leaflet.pageCount || 1 }, (_, idx) => idx + 1);
          const approvedPages = new Set(manifest.approvedScope.pagesByLeafletId[leaflet.leafletId] || []);
          if (currentPages.some((p) => !approvedPages.has(p))) {
            scopeExpanded = true;
            break;
          }
        }
        if (scopeExpanded && !options?.reauthorizeExpandedScope) {
          throw new Error(
            'HYBRID_V3_SCOPE_EXPANSION_REAUTH_REQUIRED: Batch scope expanded beyond originally approved pages. Explicit reauthorization is required.'
          );
        }
      }
    }

    // Reset failed or cancelled leaflets to queued while preserving pagesToProcess and checkpoints
    for (const leaflet of manifest.leaflets) {
      if (leaflet.status === 'failed' || leaflet.status === 'cancelled') {
        leaflet.status = 'queued';
        leaflet.error = null;
      }
    }

    manifest.status = 'created';
    this.recomputeTotals(manifest);
    await this.saveBatchManifestAtomic(manifest);

    return await this.startBatchExtraction(batchId, options, onProgress);
  }

  public async syncConsumerImageApprovalToStagedDraft(params: {
    batchId: string;
    batchOfferKey: string;
    approval: import('../../shared/types/catalogMatching').ConsumerProductImageApproval | null;
  }): Promise<void> {
    const manifest = await this.loadBatchManifest(params.batchId);
    if (!manifest) return;
    const parts = params.batchOfferKey.split(':');
    const leafletId = parts[1];
    const targetSourceOfferId = parts.slice(3).join(':');
    const leaflet = manifest.leaflets.find((l) => l.leafletId === leafletId);
    if (!leaflet?.workspacePath) return;
    const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
    if (!fs.existsSync(draftPath)) return;
    try {
      const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
      const item = Array.isArray(draft?.items)
        ? draft.items.find((it: any) => (it.sourceOfferId || it.id) === targetSourceOfferId)
        : null;
      if (!item) return;
      const app = params.approval;
      item.consumerImageApprovalStatus = app?.status ?? 'unreviewed';
      item.consumerProductImagePath =
        app?.status === 'approved_generated_crop' ? app.approvedLocalPath : null;
      item.approvedConsumerImageRightsBasis = app?.rightsBasis ?? null;
      item.existingCatalogProductImageUrl = app?.existingCatalogImageUrl ?? null;
      draft.updatedAt = new Date().toISOString();
      fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');
    } catch {
      // Non-fatal sync if draft is unavailable
    }
  }

  /**
   * Aggregates all offers across all leaflets in the batch into a unified list.
   * Resolves thumbnail crops, preserves brand evidence, and attaches stable batch-scoped offer keys.
   */
  public async getUnifiedBatchOffers(
    batchId: string,
    filters?: BatchFilterOptions
  ): Promise<UnifiedBatchOffer[]> {
    const manifest = await this.loadBatchManifest(batchId);
    if (!manifest) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    const batchOverlay = new MatchingEvidenceOverlayService(
      path.join(this.getBatchDir(batchId), 'catalog-matching', 'evidence-annotations.json'),
      `batch:${batchId}`
    );
    const workspaceOverlay = new MatchingEvidenceOverlayService();
    let matchingManifest: import('../../shared/types/catalogMatching').MatchingRunManifest | null = null;
    try {
      matchingManifest = new CatalogMatchingOrchestrator(
        undefined,
        undefined,
        undefined,
        undefined,
        this.getBatchesBaseDir()
      ).loadManifest(batchId);
    } catch {
      matchingManifest = null;
    }
    const unifiedOffers: UnifiedBatchOffer[] = [];

    for (const leaflet of manifest.leaflets) {
      if (leaflet.status !== 'completed') {
        continue;
      }

      // 1. Try loading staged draft
      const draft = await loadStagedLeafletDraft(leaflet.workspacePath, { skipAutoInit: true });
      if (draft && Array.isArray(draft.items) && draft.items.length > 0) {
        for (const item of draft.items) {
          const sourceOfferId = item.sourceOfferId || item.id;
          const canonicalSourceId =
            (item as any).canonicalSourceId ||
            (item as any).canonical?.source?.external_image_id ||
            (item as any).canonical?.source?.source_item_number ||
            null;
          const pageNum = item.pageNumber || 1;
          const batchOfferKey = `${batchId}:${leaflet.leafletId}:${pageNum}:${sourceOfferId}`;

          // Resolve crops
          let thumbPath = item.productThumbLocalPath || null;
          let cropPath = item.croppedEvidenceLocalPath || null;

          if (thumbPath && !path.isAbsolute(thumbPath)) {
            thumbPath = path.join(leaflet.workspacePath, thumbPath);
          }
          if (cropPath && !path.isAbsolute(cropPath)) {
            cropPath = path.join(leaflet.workspacePath, cropPath);
          }

          // Fallback thumbnail search
          if (!thumbPath && cropPath) {
            const siblingThumb = path.join(path.dirname(cropPath), 'product_thumb_crop.webp');
            if (fs.existsSync(siblingThumb)) {
              thumbPath = siblingThumb;
            }
          }

          const rawExt0 =
            findMatchingRawExtractionEntry((item as any).canonical || item) ||
            (Array.isArray((item as any).raw_extraction_json) ? (item as any).raw_extraction_json[0] : null) ||
            null;
          const customerLimitRaw =
            typeof item.customer_limit === 'number'
              ? item.customer_limit
              : typeof rawExt0?.quantity_limit_per_customer === 'number'
                ? rawExt0.quantity_limit_per_customer
                : null;
          const promoConditionRaw =
            typeof (item as any).promo_condition_quantity === 'number'
              ? (item as any).promo_condition_quantity
              : typeof (item as any).promotion?.bundle_quantity === 'number'
                ? (item as any).promotion.bundle_quantity
                : null;
          const bundleQtyRaw =
            typeof (item as any).bundle_quantity === 'number'
              ? (item as any).bundle_quantity
              : typeof (item as any).content?.bundle_quantity === 'number'
                ? (item as any).content.bundle_quantity
                : null;
          const assortmentStatusRaw =
            (item as any).assortment_status ||
            (item as any).contract_v2?.assortment?.status ||
            (rawExt0?.is_multi_brand_or_variant ? 'multiple_variants' : null);

          const lookupIds = [sourceOfferId, canonicalSourceId, batchOfferKey];
          const resolvedEvidence =
            (item as any).matchingEvidence ||
            batchOverlay.getAnnotationForSource(lookupIds) ||
            workspaceOverlay.getAnnotationForSource(lookupIds) ||
            null;

          const candidatePageImg = (item as any).originalPageImagePath ||
            path.join(leaflet.workspacePath, 'pages', `page.${pageNum}.png`);
          const resolvedPageImg = fs.existsSync(candidatePageImg) ? candidatePageImg : null;

          const resolvedSupermarketId = leaflet.metadata.supermarketId || draft.header?.supermarketId || null;
          const resolvedOfferStartDate =
            extractStrictIsoDate(leaflet.metadata.offerStartDate).date ||
            extractStrictIsoDate(draft.header?.validFrom).date ||
            null;
          const resolvedOfferEndDate =
            extractStrictIsoDate(leaflet.metadata.offerEndDate).date ||
            extractStrictIsoDate(draft.header?.validTo).date ||
            null;
          const resolvedLocationScope = leaflet.metadata.locationScope || (draft.header?.locationScope as any) || null;
          const resolvedCityId = leaflet.metadata.cityId || draft.header?.cityId || null;
          const resolvedRegionId = leaflet.metadata.regionId || draft.header?.regionId || null;
          const hasValidScope =
            resolvedLocationScope === 'national' ||
            (resolvedLocationScope === 'region' && Boolean(resolvedRegionId)) ||
            (resolvedLocationScope === 'city' && Boolean(resolvedCityId));
          const pruneResolvedMetadataError = (code: unknown): boolean => {
            const s = String(code || '');
            if (s === 'MISSING_SUPERMARKET_PROVENANCE' && (resolvedSupermarketId || leaflet.metadata?.supermarketName)) return false;
            if (
              (s === 'MISSING_CRITICAL_OFFER_DATES' || s === 'MISSING_OR_INVALID_VALIDITY_DATES') &&
              resolvedOfferStartDate &&
              resolvedOfferEndDate
            ) {
              return false;
            }
            if (s === 'INVALID_LOCATION_SCOPE' && hasValidScope) return false;
            return true;
          };

          const offer: UnifiedBatchOffer = {
            batchOfferKey,
            batchId,
            leafletId: leaflet.leafletId,
            sourceDocumentId:
              (item as any).sourceDocumentId ||
              leaflet.documentId ||
              computeDocumentIdFromFingerprint(leaflet.fileFingerprint, leaflet.fileName),
            sourceFileName: leaflet.fileName,
            sourcePdfPath: leaflet.filePath,
            sourceFileFingerprint: leaflet.fileFingerprint || null,
            sourcePage: pageNum,
            sourceOfferId,
            sourceOfferAnchor: (item as any).sourceOfferAnchor ?? null,
            sourceBboxNorm: (item as any).sourceBboxNorm ?? null,
            canonicalSourceId,

            supermarketId: resolvedSupermarketId,
            supermarketName: leaflet.metadata.supermarketName || null,
            locationScope: resolvedLocationScope,
            locationLabel: leaflet.metadata.locationLabel || draft.header?.region || null,
            cityId: resolvedCityId,
            regionId: resolvedRegionId,
            offerStartDate: resolvedOfferStartDate,
            offerEndDate: resolvedOfferEndDate,
            currency: 'SAR',
            leafletTitle: leaflet.metadata.leafletTitle || null,
            metadataVerified: Boolean(leaflet.metadata.verified),
            metadataStatus: leaflet.metadata.metadataStatus,
            scopeSource: leaflet.metadata.scopeSource ?? null,

            titleAr: item.titleAr || '',
            titleEn: item.titleEn || '',
            brand: item.brand || null,
            brandAr: (item as any).brand_ar || (item as any).brandAr || item.brand || null,
            brandEn: (item as any).brand_en || (item as any).brandEn || item.brand || null,
            brandConfidence: (item as any).brandConfidence || null,
            variantOrFlavor:
              (item as any).variantOrFlavor ||
              (item as any).variant_or_flavor ||
              rawExt0?.variant_or_flavor ||
              null,

            promoPrice: typeof item.priceAfter === 'number' ? item.priceAfter : null,
            originalPrice: typeof item.priceBefore === 'number' ? item.priceBefore : null,
            discountPercent: typeof item.discountPercent === 'number' ? item.discountPercent : null,
            promoNotes: item.promoNotes || null,

            sizeOrWeight: item.sizeOrWeight || null,
            each_size_value: typeof item.each_size_value === 'number' ? item.each_size_value : null,
            each_size_unit: item.each_size_unit || null,
            inner_pack_count: typeof item.inner_pack_count === 'number' ? item.inner_pack_count : null,
            sale_unit_type: item.sale_unit_type || null,
            total_content_value: typeof item.total_content_value === 'number' ? item.total_content_value : null,
            total_content_unit: item.total_content_unit || null,
            free_units_text: item.free_units_text || null,
            customer_limit: typeof customerLimitRaw === 'number' ? Number(customerLimitRaw) : null,
            promotion_mechanic: (item as any).promotion_mechanic || (item as any).promotion?.mechanic || null,
            promo_condition_quantity:
              typeof promoConditionRaw === 'number' ? Number(promoConditionRaw) : null,
            bundle_quantity:
              typeof bundleQtyRaw === 'number' ? Number(bundleQtyRaw) : null,
            quantity_semantics: (item as any).quantity_semantics || null,
            assortment_status: assortmentStatusRaw,
            matchingEvidence: resolvedEvidence,

            productThumbCropPath: thumbPath,
            offerCardCropPath: cropPath,
            originalPageImagePath: resolvedPageImg,
            imageSubjectScope: (item as any).imageSubjectScope || null,

            conflictCodes: Array.isArray((item as any).conflictCodes) ? (item as any).conflictCodes : [],
            quarantineReasons: Array.isArray((item as any).quarantineReasons)
              ? (item as any).quarantineReasons.filter(pruneResolvedMetadataError)
              : [],
            v3RetentionMode: (item as any).v3RetentionMode || null,
            v3CropStatus: (item as any).v3CropStatus || null,
            parentSourceOfferId: (item as any).parentSourceOfferId || null,
            decomposedChildIndex: (item as any).decomposedChildIndex ?? null,
            decomposedChildrenCount: (item as any).decomposedChildrenCount ?? null,
            operatorEdited: Boolean(item.isOperatorModified || (item as any).operatorEdited),
            operatorEditedAt: (item as any).operatorEditedAt || null,
            originalOcrSnapshot: item.originalOcr ? (item.originalOcr as unknown as Record<string, unknown>) : null,
            lastValidatedAt: (item as any).lastValidatedAt || null,
            validationOrigin: (item as any).validationOrigin || null,
            publicationState: (() => {
              const directPub =
                manifest.publishedOffers?.[batchOfferKey] ??
                ((item as any).publicationState as OfferBatchPublicationState | null) ??
                null;
              if (directPub) return directPub;
              if (manifest.publishedOffers) {
                const matchEntry = Object.entries(manifest.publishedOffers).find(([k]) => {
                  const kParts = k.split(':');
                  return (
                    kParts.length >= 4 &&
                    kParts[1] === leaflet.leafletId &&
                    kParts[2] === String(pageNum) &&
                    kParts[3] === sourceOfferId
                  );
                });
                if (matchEntry) return matchEntry[1];
              }
              return null;
            })(),

            status: (() => {
              const isDirectPub =
                manifest.publishedOffers?.[batchOfferKey]?.state === 'published' ||
                (item as any).publicationState?.state === 'published';
              if (isDirectPub) return 'published';
              if (manifest.publishedOffers) {
                const isSuffixPub = Object.entries(manifest.publishedOffers).some(([k, st]) => {
                  const kParts = k.split(':');
                  return (
                    kParts.length >= 4 &&
                    kParts[1] === leaflet.leafletId &&
                    kParts[2] === String(pageNum) &&
                    kParts[3] === sourceOfferId &&
                    st?.state === 'published'
                  );
                });
                if (isSuffixPub) return 'published';
              }
              return item.isOperatorModified ? 'reviewed' : 'extracted';
            })(),
            confidence: (item as any).confidence || 'medium',
            category: (item as any).category || null,
            warnings: (item as any).warnings || [],
            blockingErrors: Array.isArray((item as any).blockingErrors)
              ? (item as any).blockingErrors.filter(pruneResolvedMetadataError)
              : [],
            canonical: (item as any).canonical
          };

          // Dynamic non-destructive reassessment so cached extracts immediately inherit updated
          // currency/pack/conflict rules without mutating raw extraction artifacts on disk.
          const sanitizedExistingConflicts = (offer.conflictCodes || []).filter(
            (c) => !/^(?:CURRENCY_UNVERIFIED_OR_CONFLICT|CURRENCY_CONFLICT|UNSUPPORTED_OR_UNVERIFIED_CURRENCY)$/i.test(String(c))
          );
          const dynamicReval = revalidateOfferItem({
            item: {
              ...offer,
              priceAfter: offer.promoPrice,
              priceBefore: offer.originalPrice,
              brand: offer.brandEn || offer.brand || offer.brandAr,
              conflictCodes: sanitizedExistingConflicts,
              productThumbLocalPath: thumbPath
            },
            leafletMetadata: leaflet.metadata
          });
          offer.conflictCodes = dynamicReval.conflictCodes;
          offer.quarantineReasons = dynamicReval.quarantineReasons.filter(pruneResolvedMetadataError);
          offer.blockingErrors = dynamicReval.blockingErrors.filter(pruneResolvedMetadataError);
          offer.warnings = (offer.warnings || []).filter(
            (w) =>
              !/^(?:CURRENCY_UNVERIFIED_OR_CONFLICT|UNSUPPORTED_OR_UNVERIFIED_CURRENCY)$/i.test(String(w)) &&
              !(String(w) === 'PROMO_QTY_VS_MFG_PACK_CONFLICT' && !dynamicReval.conflictCodes.includes('PROMO_QTY_VS_MFG_PACK_CONFLICT'))
          );
          if (dynamicReval.v3RetentionMode) {
            offer.v3RetentionMode = dynamicReval.v3RetentionMode;
          }
          if (dynamicReval.imageSubjectScope !== undefined && dynamicReval.imageSubjectScope !== null) {
            offer.imageSubjectScope = dynamicReval.imageSubjectScope;
          }

          // Auto-select product_thumb_crop.webp as default consumer image when single-SKU & safe,
          // while strictly blocking multi-variant / assortment crops (e.g. Ditalini / Barilla).
          const prop = matchingManifest?.proposals?.[batchOfferKey] ?? null;
          const imgApp = matchingManifest?.consumerImageApprovals?.[batchOfferKey] ?? null;
          const fallbackCatalogImg = prop?.matchedProduct?.imageUrl ?? null;
          const isAssortment =
            offer.assortment_status === 'unsplit_assortment' ||
            offer.assortment_status === 'assorted' ||
            offer.assortment_status === 'explicit_assortment' ||
            offer.assortment_status === 'multiple_variants' ||
            dynamicReval.v3RetentionMode === 'unsplit_assortment' ||
            offer.v3RetentionMode === 'decomposed_shared_promo_parent' ||
            /assorted|متنوع/i.test(`${offer.titleEn} ${offer.titleAr}`);

          const hasUnsafeImageConflict = offer.conflictCodes.some(
            (c) => c === 'TEXT_VS_IMAGE_CONFLICT' || c === 'UNLABELED_SWATCH_OR_BOTTLE_VARIANTS'
          );

          const isUnsafeMultiVariantCrop =
            !isAssortment &&
            (offer.assortment_status === 'visual_multiple_variants' ||
              offer.assortment_status === 'ambiguous_alternatives' ||
              hasUnsafeImageConflict);

          const customCropPath = (item as any).customProductThumbCropPath;
          const hasCustomCrop = Boolean(customCropPath && fs.existsSync(customCropPath));
          const effectiveProductCrop = hasCustomCrop ? customCropPath : thumbPath;
          const validProductCrop =
            Boolean(effectiveProductCrop) &&
            !String(effectiveProductCrop).toLowerCase().includes('offer_card_crop') &&
            fs.existsSync(effectiveProductCrop!);

          let requiresDerivedCropConfirm = false;
          if (!hasCustomCrop && validProductCrop && effectiveProductCrop) {
            const derivedMetaPath = path.join(path.dirname(effectiveProductCrop), 'derived_tier_crop_meta.json');
            if (fs.existsSync(derivedMetaPath)) {
              try {
                const dm = JSON.parse(fs.readFileSync(derivedMetaPath, 'utf8'));
                if (dm.sizeConfirmationStatus === 'shared_single_graphic_requires_confirmation' && !dm.operatorConfirmed) {
                  requiresDerivedCropConfirm = true;
                }
              } catch {
                // ignore malformed meta
              }
            }
          }

          offer.selectedImageSource = (item as any).selectedImageSource || (validProductCrop ? 'product_thumb' : 'none');

          if (imgApp?.status === 'rejected' || (item as any).consumerImageApprovalStatus === 'rejected') {
            offer.consumerProductImagePath = null;
            offer.consumerImageApprovalStatus = 'rejected';
            offer.approvedConsumerImageRightsBasis = null;
            offer.existingCatalogProductImageUrl = imgApp?.existingCatalogImageUrl ?? fallbackCatalogImg;
            offer.consumerImageApprovedForProductKey = imgApp?.approvedForProductKey ?? null;
            offer.consumerImageInvalidationReason = imgApp?.invalidationReason ?? 'Declined by operator.';
          } else if (
            imgApp?.status === 'invalidated_identity_changed' ||
            (item as any).consumerImageApprovalStatus === 'invalidated_identity_changed'
          ) {
            offer.consumerProductImagePath = null;
            offer.consumerImageApprovalStatus = 'invalidated_identity_changed';
            offer.approvedConsumerImageRightsBasis = null;
            offer.existingCatalogProductImageUrl = fallbackCatalogImg;
            offer.consumerImageApprovedForProductKey = imgApp?.approvedForProductKey ?? null;
            offer.consumerImageInvalidationReason =
              imgApp?.invalidationReason ?? 'Product identity changed; reconfirm product image.';
          } else if (imgApp?.status === 'reuse_existing_catalog_image' || (!imgApp && fallbackCatalogImg)) {
            offer.consumerProductImagePath = null;
            offer.consumerImageApprovalStatus = 'reuse_existing_catalog_image';
            offer.approvedConsumerImageRightsBasis = imgApp?.rightsBasis ?? 'existing_verified_catalog_image';
            offer.existingCatalogProductImageUrl = imgApp?.existingCatalogImageUrl ?? fallbackCatalogImg;
            offer.consumerImageApprovedForProductKey = imgApp?.approvedForProductKey ?? null;
          } else if (hasCustomCrop) {
            offer.consumerProductImagePath = customCropPath;
            offer.consumerImageApprovalStatus = 'approved_generated_crop';
            offer.approvedConsumerImageRightsBasis = 'operator_replaced_image';
            offer.imageSubjectScope = isAssortment ? 'representative_assortment' : 'product_package';
            offer.selectedImageSource = 'custom_thumb';
            offer.existingCatalogProductImageUrl = fallbackCatalogImg;
          } else if (!isUnsafeMultiVariantCrop && !requiresDerivedCropConfirm && imgApp?.status === 'approved_generated_crop' && imgApp.approvedLocalPath && fs.existsSync(imgApp.approvedLocalPath)) {
            offer.consumerProductImagePath = imgApp.approvedLocalPath;
            offer.consumerImageApprovalStatus = 'approved_generated_crop';
            offer.approvedConsumerImageRightsBasis = imgApp.rightsBasis ?? 'operator_verified_leaflet_product_crop';
            offer.existingCatalogProductImageUrl = imgApp.existingCatalogImageUrl ?? fallbackCatalogImg;
            offer.consumerImageApprovedForProductKey = imgApp.approvedForProductKey ?? null;
          } else if (!isUnsafeMultiVariantCrop && !requiresDerivedCropConfirm && validProductCrop && dynamicReval.isValid) {
            offer.consumerProductImagePath = effectiveProductCrop;
            offer.consumerImageApprovalStatus = 'approved_generated_crop';
            offer.approvedConsumerImageRightsBasis = 'generated_product_crop';
            offer.imageSubjectScope = isAssortment ? 'representative_assortment' : 'product_package';
            offer.selectedImageSource = 'product_thumb';
            offer.existingCatalogProductImageUrl = fallbackCatalogImg;
          } else if (!hasUnsafeImageConflict && !requiresDerivedCropConfirm && validProductCrop) {
            // Valid local crop auto-selected by default without requiring separate approval click
            offer.consumerProductImagePath = effectiveProductCrop;
            offer.consumerImageApprovalStatus = 'approved_generated_crop';
            offer.approvedConsumerImageRightsBasis = 'generated_product_crop';
            offer.imageSubjectScope =
              isAssortment || offer.assortment_status === 'visual_multiple_variants'
                ? 'representative_assortment'
                : 'product_package';
            offer.selectedImageSource = 'product_thumb';
            offer.existingCatalogProductImageUrl = fallbackCatalogImg;
          } else {
            offer.consumerProductImagePath = null;
            offer.consumerImageApprovalStatus = 'unreviewed';
            offer.approvedConsumerImageRightsBasis = null;
            offer.existingCatalogProductImageUrl = fallbackCatalogImg;
          }
          offer.consumerDisplayImagePath =
            (item as any).consumerDisplayImagePath ??
            ((isAssortment || offer.imageSubjectScope === 'representative_assortment') &&
            offer.consumerProductImagePath &&
            !String(offer.consumerProductImagePath).toLowerCase().includes('offer_card_crop')
              ? offer.consumerProductImagePath
              : null);

          unifiedOffers.push(offer);
        }
      } else {
        // Fallback: Read from json/ canonical files
        const jsonDir = path.join(leaflet.workspacePath, 'json');
        if (fs.existsSync(jsonDir)) {
          const files = fs.readdirSync(jsonDir).filter((f) => f.endsWith('.canonical.json'));
          for (const file of files) {
            try {
              const canonical = JSON.parse(fs.readFileSync(path.join(jsonDir, file), 'utf8'));
              const pageNum = canonical.source?.source_page_number || 1;
              const canonicalSourceId =
                canonical.source?.external_image_id ||
                canonical.source?.source_item_number ||
                null;
              const sourceOfferId =
                canonical.source?.source_item_number ||
                canonical.source?.external_image_id ||
                file;
              const batchOfferKey = `${batchId}:${leaflet.leafletId}:${pageNum}:${sourceOfferId}`;

              let thumbPath = canonical.image?.thumbnail_path || canonical.image?.image_path || null;
              let cropPath = canonical.source?.crop_path || canonical.image?.image_path || null;

              if (thumbPath && !path.isAbsolute(thumbPath)) thumbPath = path.join(leaflet.workspacePath, thumbPath);
              if (cropPath && !path.isAbsolute(cropPath)) cropPath = path.join(leaflet.workspacePath, cropPath);

              if (!thumbPath && cropPath) {
                const siblingThumb = path.join(path.dirname(cropPath), 'product_thumb_crop.webp');
                if (fs.existsSync(siblingThumb)) thumbPath = siblingThumb;
              }

              const rawExt0 = findMatchingRawExtractionEntry(canonical);
              const lookupIds = [sourceOfferId, canonicalSourceId, batchOfferKey];
              const resolvedEvidence =
                batchOverlay.getAnnotationForSource(lookupIds) ||
                workspaceOverlay.getAnnotationForSource(lookupIds) ||
                null;

              const confirmedMetaPath = path.join(leaflet.workspacePath, 'metadata', 'confirmed_metadata.json');
              let confirmedMeta: any = null;
              if (fs.existsSync(confirmedMetaPath)) {
                try {
                  const parsedMeta = JSON.parse(fs.readFileSync(confirmedMetaPath, 'utf8'));
                  const rec = parsedMeta?.record || parsedMeta;
                  if (rec?.operatorConfirmed === true) {
                    confirmedMeta = rec;
                  }
                } catch {
                  // Ignore malformed confirmed metadata file
                }
              }

              const trustedCtx = canonical.trusted_context || {};
              const resolvedSupermarketId =
                leaflet.metadata.supermarketId ||
                confirmedMeta?.retailer?.resolvedRetailerId ||
                trustedCtx.supermarket_id ||
                null;
              const resolvedSupermarketName =
                leaflet.metadata.supermarketName ||
                confirmedMeta?.retailer?.resolvedNameEn ||
                confirmedMeta?.retailer?.detectedName ||
                null;
              const resolvedLocationScope =
                leaflet.metadata.locationScope ||
                confirmedMeta?.locationScope ||
                trustedCtx.location_scope ||
                null;
              const resolvedLocationLabel =
                leaflet.metadata.locationLabel ||
                confirmedMeta?.locationSlug ||
                null;
              const resolvedCityId =
                leaflet.metadata.cityId ||
                confirmedMeta?.cityId ||
                trustedCtx.city_id ||
                null;
              const resolvedRegionId =
                leaflet.metadata.regionId ||
                confirmedMeta?.regionId ||
                trustedCtx.region_id ||
                null;
              const resolvedStartDate =
                leaflet.metadata.offerStartDate ||
                confirmedMeta?.validity?.startDate ||
                trustedCtx.offer_start_date ||
                null;
              const resolvedEndDate =
                leaflet.metadata.offerEndDate ||
                confirmedMeta?.validity?.endDate ||
                trustedCtx.offer_end_date ||
                null;

              unifiedOffers.push({
                batchOfferKey,
                batchId,
                leafletId: leaflet.leafletId,
                sourceDocumentId:
                  leaflet.documentId ||
                  computeDocumentIdFromFingerprint(leaflet.fileFingerprint, leaflet.fileName),
                sourceFileName: leaflet.fileName,
                sourcePdfPath: leaflet.filePath,
                sourceFileFingerprint: leaflet.fileFingerprint || null,
                sourcePage: pageNum,
                sourceOfferId,
                canonicalSourceId,

                supermarketId: resolvedSupermarketId,
                supermarketName: resolvedSupermarketName,
                locationScope: resolvedLocationScope,
                locationLabel: resolvedLocationLabel,
                cityId: resolvedCityId,
                regionId: resolvedRegionId,
                offerStartDate: resolvedStartDate,
                offerEndDate: resolvedEndDate,

                titleAr: canonical.product?.product_name_ar || canonical.product?.title_ar || '',
                titleEn: canonical.product?.product_name_en || canonical.product?.title_en || '',
                brand: canonical.product?.brand || canonical.product?.brand_text || null,
                brandAr: canonical.product?.brand_ar || canonical.product?.brand || canonical.product?.brand_text || null,
                brandEn: canonical.product?.brand_en || canonical.product?.brand || canonical.product?.brand_text || null,
                brandConfidence: canonical.product?.brand_confidence || null,
                variantOrFlavor:
                  canonical.product?.variant_or_flavor ||
                  canonical.product?.variant ||
                  rawExt0?.variant_or_flavor ||
                  null,

                promoPrice: canonical.pricing?.promotional_price ?? canonical.prices?.offer_price ?? null,
                originalPrice: canonical.pricing?.original_price ?? canonical.prices?.original_price ?? null,
                discountPercent: canonical.pricing?.discount_percentage ?? canonical.prices?.discount_percent ?? null,
                promoNotes:
                  canonical.pricing?.promo_description ||
                  canonical.promotion?.condition_text ||
                  canonical.promotion?.special_offer ||
                  null,

                sizeOrWeight: canonical.package?.declared_quantity_string || canonical.content?.size_text || null,
                each_size_value: canonical.package?.declared_quantity_value ?? canonical.content?.each_size_value ?? null,
                each_size_unit: canonical.package?.declared_quantity_unit ?? canonical.content?.each_size_unit ?? null,
                inner_pack_count: canonical.package?.inner_pack_count ?? canonical.content?.pack_quantity ?? null,
                sale_unit_type: canonical.package?.sale_unit_type || canonical.content?.sale_unit_type || null,
                total_content_value: canonical.package?.total_content_value ?? canonical.content?.total_content_value ?? null,
                total_content_unit: canonical.package?.total_content_unit ?? canonical.content?.total_content_unit ?? null,
                free_units_text: canonical.package?.free_units_text || null,
                customer_limit:
                  canonical.pricing?.customer_limit ??
                  canonical.promotion?.customer_limit ??
                  rawExt0?.quantity_limit_per_customer ??
                  null,
                promotion_mechanic: canonical.promotion?.mechanic || null,
                promo_condition_quantity:
                  typeof canonical.promotion?.promo_condition_quantity === 'number'
                    ? canonical.promotion.promo_condition_quantity
                    : typeof canonical.promotion?.bundle_quantity === 'number'
                      ? canonical.promotion.bundle_quantity
                      : null,
                bundle_quantity:
                  typeof canonical.content?.bundle_quantity === 'number'
                    ? canonical.content.bundle_quantity
                    : null,
                quantity_semantics: canonical.content?.quantity_semantics || null,
                assortment_status:
                  canonical.contract_v2?.assortment?.status ||
                  (rawExt0?.is_multi_brand_or_variant ? 'multiple_variants' : null),
                matchingEvidence: resolvedEvidence,

                productThumbCropPath: thumbPath,
                offerCardCropPath: cropPath,
                ...(() => {
                  const prop = matchingManifest?.proposals?.[batchOfferKey] ?? null;
                  const imgApp = matchingManifest?.consumerImageApprovals?.[batchOfferKey] ?? null;
                  const fallbackCatalogImg = prop?.matchedProduct?.imageUrl ?? null;
                  return {
                    consumerProductImagePath: imgApp
                      ? imgApp.status === 'approved_generated_crop'
                        ? imgApp.approvedLocalPath
                        : null
                      : null,
                    approvedConsumerImageRightsBasis: imgApp?.rightsBasis ?? null,
                    consumerImageApprovalStatus:
                      imgApp?.status ?? (fallbackCatalogImg ? 'reuse_existing_catalog_image' : 'unreviewed'),
                    existingCatalogProductImageUrl: imgApp?.existingCatalogImageUrl ?? fallbackCatalogImg,
                    consumerImageApprovedForProductKey: imgApp?.approvedForProductKey ?? null,
                    consumerImageInvalidationReason: imgApp?.invalidationReason ?? null
                  };
                })(),

                status: 'extracted',
                confidence:
                  canonical.quality?.extraction_confidence === 'high' ||
                    canonical.quality?.extraction_confidence === 'medium' ||
                    canonical.quality?.extraction_confidence === 'low'
                    ? canonical.quality.extraction_confidence
                    : 'medium',
                category: canonical.product?.item_domain || null,
                canonical
              });
            } catch {
              // ignore malformed
            }
          }
        }
      }
    }

    // Apply filtering
    let filtered = unifiedOffers;
    if (filters) {
      if (filters.leafletId) {
        filtered = filtered.filter((o) => o.leafletId === filters.leafletId);
      }
      if (filters.supermarketId) {
        filtered = filtered.filter((o) => o.supermarketId === filters.supermarketId);
      }
      if (typeof filters.sourcePage === 'number' && Number.isFinite(filters.sourcePage)) {
        filtered = filtered.filter((o) => o.sourcePage === filters.sourcePage);
      }
      if (filters.status && filters.status !== 'all') {
        filtered = filtered.filter((o) => o.status === filters.status);
      }
      if (filters.category) {
        filtered = filtered.filter((o) => o.category === filters.category);
      }
      if (filters.searchQuery && filters.searchQuery.trim().length > 0) {
        const q = filters.searchQuery.trim().toLowerCase();
        filtered = filtered.filter(
          (o) =>
            o.titleAr?.toLowerCase().includes(q) ||
            o.titleEn?.toLowerCase().includes(q) ||
            o.brand?.toLowerCase().includes(q) ||
            o.brandAr?.toLowerCase().includes(q) ||
            o.brandEn?.toLowerCase().includes(q)
        );
      }
    }

    return filtered;
  }

  public async getUnifiedBatchSummary(batchId: string): Promise<UnifiedBatchSummary> {
    const manifest = await this.loadBatchManifest(batchId);
    if (!manifest) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    const supermarkets = new Set<string>();
    for (const l of manifest.leaflets) {
      const name = l.metadata.supermarketName || l.metadata.supermarketId;
      if (name) supermarkets.add(name);
    }

    return {
      batchId: manifest.batchId,
      status: manifest.status,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
      totals: manifest.totals,
      costSummary: manifest.costSummary ?? null,
      leaflets: manifest.leaflets,
      supermarketsRepresented: Array.from(supermarkets),
      totalOffers: manifest.totals.totalOffers,
      approvedScope: manifest.approvedScope,
      processingStages: manifest.processingStages,
      matchingSummary: manifest.matchingSummary
    };
  }

  public recomputeTotals(manifest: BatchManifest): void {
    let completedPdfs = 0;
    let failedPdfs = 0;
    let cancelledPdfs = 0;
    let pagesProcessed = 0;
    let totalOffers = 0;
    let legacyLeafletCostUsd = 0;

    const publishedOffersMap = manifest.publishedOffers || {};
    const activeLeaflets = Array.isArray(manifest.leaflets)
      ? manifest.leaflets.filter((l) => l.transferStatus !== 'transferred')
      : [];

    for (const l of activeLeaflets) {
      if (l.status === 'completed') completedPdfs++;
      else if (l.status === 'failed') failedPdfs++;
      else if (l.status === 'cancelled') cancelledPdfs++;

      pagesProcessed += l.pagesProcessed || 0;
      totalOffers += l.offersCount || 0;
      legacyLeafletCostUsd += (l.estimatedCostUsd || 0) + (l.metadata?.visionCostUsd || 0);

      // Compute per-leaflet lifecycle status
      // 1. Extraction lifecycle
      const totalLeafletPages = l.pagesToProcess?.length || l.pageCount || 1;
      if (l.status === 'completed' || (l.pagesProcessed >= totalLeafletPages && totalLeafletPages > 0)) {
        l.extractionStatus = 'completed';
      } else if (l.status === 'processing') {
        l.extractionStatus = 'in_progress';
      } else if (l.status === 'failed' || l.status === 'cancelled') {
        l.extractionStatus = (l.pagesProcessed || 0) > 0 ? 'partially_extracted' : l.status;
      } else {
        l.extractionStatus = (l.pagesProcessed || 0) > 0 ? 'partially_extracted' : 'not_started';
      }

      // 2. Publication lifecycle & counts
      const leafletPrefix = `${manifest.batchId}:${l.leafletId}:`;
      let pubCount = 0;
      for (const [key, state] of Object.entries(publishedOffersMap)) {
        const parts = key.split(':');
        const keyLeafletId = parts[1];
        if ((key.startsWith(leafletPrefix) || keyLeafletId === l.leafletId) && state?.state === 'published') {
          pubCount++;
        }
      }
      l.publishedOffersCount = pubCount;
      l.deferredOffersCount = Math.max(0, (l.offersCount || 0) - pubCount);

      const isExtractionFullyCompleted =
        (l.status === 'completed' || l.extractionStatus === 'completed') &&
        (l.pagesProcessed || 0) >= totalLeafletPages;

      if (
        isExtractionFullyCompleted &&
        (l.offersCount || 0) > 0 &&
        pubCount >= (l.offersCount || 0) &&
        l.deferredOffersCount === 0 &&
        (l.blockedOffersCount || 0) === 0
      ) {
        l.publicationStatus = 'published';
      } else if (pubCount > 0) {
        l.publicationStatus = 'partially_published';
      } else {
        l.publicationStatus = l.publicationStatus === 'failed' ? 'failed' : 'not_published';
      }

      // 3. Review lifecycle
      const isMetaVerified = Boolean(l.metadata?.verified || l.metadata?.metadataStatus === 'operator_verified');
      const isMetaAutoAccepted = l.metadata?.metadataStatus === 'auto_accepted';
      if (isMetaVerified) {
        l.reviewStatus = 'completed';
      } else if (isMetaAutoAccepted) {
        l.reviewStatus = 'ready';
      } else if (l.metadata?.metadataStatus === 'needs_review') {
        l.reviewStatus = 'needs_review';
      } else {
        l.reviewStatus =
          l.extractionStatus === 'completed' || l.extractionStatus === 'partially_extracted'
            ? 'needs_review'
            : 'pending';
      }
    }

    const totalTargetPages = activeLeaflets.reduce(
      (acc, l) => acc + (l.pagesToProcess && l.pagesToProcess.length > 0 ? l.pagesToProcess.length : (l.pageCount || 1)),
      0
    );

    const legacyTotalCostUsd = Number(
      (legacyLeafletCostUsd + (manifest.matchingSummary?.actualCostUsd || 0)).toFixed(6)
    );

    let costSummary = manifest.costSummary ?? null;
    try {
      const ledgerSvc = this.getCostLedgerService();
      ledgerSvc.reconcileHistoricalArchives(manifest.batchId, manifest.leaflets);
      const ledger = ledgerSvc.loadLedger(manifest.batchId);
      const computed = ledgerSvc.computeCostSummary({
        batchId: manifest.batchId,
        manifest
      });
      if (ledger.entries.length > 0) {
        costSummary = computed;
      } else {
        // Preserve legacy cost visibility cleanly for runs/fixtures without a per-request ledger file
        costSummary = {
          ...computed,
          totalMeasuredCostUsd: legacyTotalCostUsd,
          latestSessionCostUsd: legacyTotalCostUsd,
          avgCostPerExtractedOfferUsd:
            totalOffers > 0 ? Number((legacyTotalCostUsd / totalOffers).toFixed(8)) : null,
          avgCostPerCompletedPageUsd:
            pagesProcessed > 0 ? Number((legacyTotalCostUsd / pagesProcessed).toFixed(8)) : null
        };
      }
    } catch {
      // Fallback safely to legacy totals
    }

    manifest.totals = {
      totalPdfs: activeLeaflets.length,
      completedPdfs,
      failedPdfs,
      cancelledPdfs,
      totalPages: totalTargetPages,
      pagesProcessed,
      totalOffers,
      totalCostUsd: costSummary && costSummary.totalApiCalls > 0 ? costSummary.totalMeasuredCostUsd : legacyTotalCostUsd
    };
    manifest.costSummary = costSummary;

    // Batch-level aggregated lifecycle statuses
    const isTransferredEmptyContainer =
      activeLeaflets.length === 0 &&
      Array.isArray(manifest.transferredLeaflets) &&
      manifest.transferredLeaflets.length > 0;

    if (isTransferredEmptyContainer) {
      manifest.extractionStatus = 'completed';
      manifest.reviewStatus = 'completed';
      manifest.publicationStatus = 'not_published';
      manifest.status = 'completed';
    } else if (activeLeaflets.length > 0) {
      // Extraction lifecycle
      if (activeLeaflets.every((l) => l.extractionStatus === 'completed')) {
        manifest.extractionStatus = 'completed';
      } else if (activeLeaflets.every((l) => l.extractionStatus === 'not_started')) {
        manifest.extractionStatus = 'not_started';
      } else if (activeLeaflets.every((l) => l.extractionStatus === 'failed')) {
        manifest.extractionStatus = 'failed';
      } else if (
        activeLeaflets.some((l) => l.extractionStatus === 'completed') &&
        activeLeaflets.some((l) => l.extractionStatus === 'failed' || l.extractionStatus === 'partially_extracted')
      ) {
        manifest.extractionStatus = 'completed_with_errors';
      } else if (activeLeaflets.some((l) => l.extractionStatus === 'in_progress')) {
        manifest.extractionStatus = 'in_progress';
      } else {
        manifest.extractionStatus = 'partially_extracted';
      }

      // Publication lifecycle
      const totalActivePublished = activeLeaflets.reduce((acc, l) => acc + (l.publishedOffersCount || 0), 0);
      const allActiveFullyPublished =
        activeLeaflets.length > 0 &&
        activeLeaflets.every((l) => l.publicationStatus === 'published');

      if (allActiveFullyPublished) {
        manifest.publicationStatus = 'published';
      } else if (totalActivePublished > 0) {
        manifest.publicationStatus = 'partially_published';
      } else {
        manifest.publicationStatus = 'not_published';
      }

      // Review lifecycle
      if (activeLeaflets.every((l) => l.reviewStatus === 'completed' || l.reviewStatus === 'ready')) {
        manifest.reviewStatus = 'ready';
      } else if (activeLeaflets.some((l) => l.reviewStatus === 'needs_review')) {
        manifest.reviewStatus = 'needs_review';
      } else {
        manifest.reviewStatus = 'pending';
      }
    }
  }

  /**
   * Persists selective publication results onto batch-manifest.json and per-item staged-draft.json
   * without marking deferred or unresolved offers as published.
   */
  public async recordSelectivePublicationOutcome(input: {
    batchId: string;
    databaseContext: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST';
    publishOperationId: string;
    publishedBatchOfferKeys: string[];
    deferredBatchOfferKeys: string[];
    alreadyPublishedBatchOfferKeys?: string[];
    insertedOffersCount: number;
    updatedOffersCount: number;
    sourceOfferIdByKey?: Record<string, string>;
    publishedOfferIdByKey?: Record<string, string>;
    productIdByKey?: Record<string, string | null>;
  }): Promise<BatchManifest | null> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) return null;

    const nowIso = new Date().toISOString();
    const publishedSet = new Set(input.publishedBatchOfferKeys);
    manifest.publishedOffers = { ...(manifest.publishedOffers || {}) };

    const metadataVersionByLeaflet = new Map<string, number>();
    for (const leaflet of manifest.leaflets) {
      metadataVersionByLeaflet.set(leaflet.leafletId, leaflet.metadata.metadataVersion ?? 1);
    }

    for (const key of input.publishedBatchOfferKeys) {
      const parts = key.split(':');
      const leafletId = parts[1];
      const fallbackSourceId = parts.slice(3).join(':');
      manifest.publishedOffers[key] = {
        state: 'published',
        databaseContext: input.databaseContext,
        publishOperationId: input.publishOperationId,
        publishedAt: nowIso,
        sourceOfferId: input.sourceOfferIdByKey?.[key] || fallbackSourceId,
        offerId: input.publishedOfferIdByKey?.[key] ?? null,
        productId: input.productIdByKey?.[key] ?? null,
        committedMetadataVersion: metadataVersionByLeaflet.get(leafletId) ?? 1,
        needsUpdateReview: false
      };
    }

    // Propagate per-item publicationState onto each leaflet's staged-draft.json (never bulk-marking deferred items)
    for (const leaflet of manifest.leaflets) {
      const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
      if (!fs.existsSync(draftPath)) continue;
      try {
        const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
        let mutated = false;
        let allItemsPublished = Array.isArray(draft.items) && draft.items.length > 0;
        if (Array.isArray(draft.items)) {
          for (const it of draft.items) {
            const pageNum = it.pageNumber || 1;
            const sourceOfferId = it.sourceOfferId || it.id;
            const key = `${input.batchId}:${leaflet.leafletId}:${pageNum}:${sourceOfferId}`;
            if (publishedSet.has(key)) {
              it.publicationState = manifest.publishedOffers[key];
              mutated = true;
            } else if (!manifest.publishedOffers[key] && it.publicationState?.state !== 'published') {
              allItemsPublished = false;
            }
          }
        }
        if (allItemsPublished && draft.items.length > 0) {
          draft.status = 'published';
          mutated = true;
        }
        if (mutated) {
          draft.updatedAt = nowIso;
          fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');
        }
      } catch (err: any) {
        logWarn(`Failed persisting per-offer publicationState in ${draftPath}: ${err.message}`);
      }
    }

    const totalDeferredRemaining = input.deferredBatchOfferKeys.length;
    manifest.publicationOperations = Array.isArray(manifest.publicationOperations)
      ? [...manifest.publicationOperations]
      : [];
    manifest.publicationOperations.push({
      publishOperationId: input.publishOperationId,
      databaseContext: input.databaseContext,
      publishedAt: nowIso,
      publishedOfferKeys: [...input.publishedBatchOfferKeys],
      deferredOfferKeys: [...input.deferredBatchOfferKeys],
      alreadyPublishedOfferKeys: [...(input.alreadyPublishedBatchOfferKeys || [])],
      insertedOffersCount: input.insertedOffersCount,
      updatedOffersCount: input.updatedOffersCount,
      undoneAt: null
    });

    if (input.publishedBatchOfferKeys.length > 0 || (input.alreadyPublishedBatchOfferKeys?.length || 0) > 0) {
      manifest.status = totalDeferredRemaining > 0 ? 'partially_published' : 'completed';
    }
    this.recomputeTotals(manifest);
    manifest.updatedAt = nowIso;
    await this.saveBatchManifestAtomic(manifest);
    return manifest;
  }

  /**
   * Reconciles local batch/draft publicationState when an Undo Last Publish rolls back
   * one specific `publishOperationId` (leaving earlier operations from the same batch published).
   */
  public async reconcileUndoPublicationOutcome(input: {
    batchId: string;
    publishOperationId: string;
  }): Promise<BatchManifest | null> {
    const manifest = await this.loadBatchManifest(input.batchId);
    if (!manifest) return null;

    const nowIso = new Date().toISOString();
    const revertedKeys = new Set<string>();

    if (manifest.publishedOffers) {
      for (const [key, state] of Object.entries(manifest.publishedOffers)) {
        if (state?.publishOperationId === input.publishOperationId) {
          delete manifest.publishedOffers[key];
          revertedKeys.add(key);
        }
      }
    }

    if (Array.isArray(manifest.publicationOperations)) {
      for (const op of manifest.publicationOperations) {
        if (op.publishOperationId === input.publishOperationId) {
          op.undoneAt = nowIso;
        }
      }
    }

    for (const leaflet of manifest.leaflets) {
      const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
      if (!fs.existsSync(draftPath)) continue;
      try {
        const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
        let mutated = false;
        if (Array.isArray(draft.items)) {
          for (const it of draft.items) {
            if (it.publicationState?.publishOperationId === input.publishOperationId) {
              delete it.publicationState;
              mutated = true;
            }
          }
        }
        if (draft.status === 'published' && mutated) {
          draft.status = 'draft';
        }
        if (mutated) {
          draft.updatedAt = nowIso;
          fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), 'utf8');
        }
      } catch (err: any) {
        logWarn(`Failed reconciling undo publicationState in ${draftPath}: ${err.message}`);
      }
    }

    const remainingPublished = Object.keys(manifest.publishedOffers || {}).length;
    manifest.status =
      remainingPublished > 0 && remainingPublished < (manifest.totals?.totalOffers || 0)
        ? 'partially_published'
        : 'completed';
    this.recomputeTotals(manifest);
    manifest.updatedAt = nowIso;
    await this.saveBatchManifestAtomic(manifest);
    return manifest;
  }
}

export const sharedBatchOrchestrationService = new BatchOrchestrationService();
