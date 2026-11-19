import { ipcMain, BrowserWindow } from 'electron';
import { sharedBatchOrchestrationService } from '../batch/batchOrchestrationService';
import { sharedCatalogMatchingOrchestrator } from './catalogMatchingIpc';
import { getSupabaseAdminClient } from '../db/supabaseAdminClient';
import { getGuardedSupabaseClient, type DatabaseContext } from '../db/databaseEnvironmentResolver';
import type { BatchProgressEvent, BatchFilterOptions } from '../../shared/types/batchExtraction';
import type { MatchingProgressEvent } from '../../shared/types/catalogMatching';
import { error as logError } from '../logging/logger';

function resolveOptionalSupabaseClient(databaseContext: DatabaseContext) {
  try {
    return databaseContext === 'DEVELOPMENT_TEST'
      ? getGuardedSupabaseClient('DEVELOPMENT_TEST')
      : getSupabaseAdminClient();
  } catch {
    return null;
  }
}

export function registerBatchExtractionIpcHandlers(): void {
  ipcMain.handle('batch:backfillHistory', async (_event, options?: {
    extractsDir?: string;
    pdfSearchDirs?: string[];
    pruneStaleMissingEntries?: boolean;
  }) => {
    try {
      return sharedBatchOrchestrationService.getHistoryService().backfillHistoricalExtractions(options);
    } catch (err: any) {
      logError(`batch:backfillHistory error: ${err.message}`);
      throw err;
    }
  });

  ipcMain.handle('batch:inspectDuplicates', async (_event, input: {
    files: Array<{
      path?: string;
      filePath?: string;
      name?: string;
      fileName?: string;
      contentFingerprint?: string;
      pageCount?: number;
      pagesToProcess?: number[];
      selectedPages?: number[];
      metadata?: Partial<import('../../shared/types/batchExtraction').LeafletMetadataScope>;
    }>;
    extractionPipelineMode?: import('../../shared/types/batchExtraction').ExtractionPipelineMode;
    modelId?: string;
    tier?: 'flex' | 'standard';
    forceReextract?: boolean;
  }) => {
    try {
      const normalizedFiles = (input.files || []).map((f) => ({
        path: f.path || f.filePath || '',
        name: f.name || f.fileName,
        contentFingerprint: f.contentFingerprint,
        pageCount: f.pageCount,
        pagesToProcess: f.pagesToProcess || f.selectedPages,
        metadata: f.metadata
      }));
      const raw = sharedBatchOrchestrationService.inspectPreExtractionDuplicates({
        ...input,
        files: normalizedFiles
      });
      return {
        ...raw,
        totalReusedPages: raw.totalReusablePages,
        adjustedEstimatedLowUsd: raw.adjustedCostEstimate?.totalEstimatedLowUsd ?? 0,
        adjustedEstimatedHighUsd: raw.adjustedCostEstimate?.totalEstimatedHighUsd ?? 0,
        matches: raw.perFile.map((p) => ({
          fileName: p.fileName,
          filePath: p.filePath,
          reusedPages: p.reusablePages,
          payablePages: p.payablePages,
          matchedFilenameHistory:
            p.classification === 'filename_collision_different_content' || Boolean(p.matchedPriorFileName),
          previousBatchIds: Array.from(
            new Set(
              Object.values(p.reusableArtifactsByPage || {})
                .map((r) => r.batchId)
                .filter((id): id is string => Boolean(id))
            )
          )
        }))
      };
    } catch (err: any) {
      logError(`batch:inspectDuplicates error: ${err.message}`);
      throw err;
    }
  });

  ipcMain.handle('batch:create', async (_event, input: {
    files: Array<{
      path: string;
      name?: string;
      sizeBytes?: number;
      contentFingerprint?: string;
      pageCount?: number;
      pagesToProcess?: number[];
      pageSelectionMode?: 'all' | 'specific';
      pageSelectionInput?: string;
      metadata?: import('../../shared/types/batchExtraction').LeafletMetadataScope;
    }>;
    executionMode?: 'flex' | 'standard';
    extractionPipelineMode?: import('../../shared/types/batchExtraction').ExtractionPipelineMode;
    model?: string;
    approvedMaxBudgetUsd?: number | null;
    autoRunCatalogMatching?: boolean;
    targetDatabaseContext?: DatabaseContext;
  }) => {
    try {
      return await sharedBatchOrchestrationService.createBatch(input);
    } catch (err: any) {
      logError(`batch:create error: ${err.message}`);
      throw err;
    }
  });

  ipcMain.handle('batch:start', async (event, input: {
    batchId: string;
    forceReextract?: boolean;
    hybridV3ExplicitAuthorization?: boolean;
    hybridV3FeatureEnabled?: boolean;
    hybridV3ExplicitLiveAuthorization?: boolean;
    disablePageContextVerification?: boolean;
    approvedMaxBudgetUsd?: number | null;
    autoRunCatalogMatching?: boolean;
    targetDatabaseContext?: DatabaseContext;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const onProgress = (p: BatchProgressEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('batch:progress', p);
      }
    };
    const onMatchingProgress = (mp: MatchingProgressEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('matching:progress', mp);
      }
    };

    try {
      const targetDatabaseContext: DatabaseContext = input.targetDatabaseContext || 'PRODUCTION_UI';
      const autoRunCatalogMatching = input.autoRunCatalogMatching ?? true;
      const catalogMatchingSupabase = autoRunCatalogMatching
        ? resolveOptionalSupabaseClient(targetDatabaseContext)
        : null;

      return await sharedBatchOrchestrationService.startBatchExtraction(
        input.batchId,
        {
          forceReextract: input.forceReextract,
          hybridV3ExplicitAuthorization: input.hybridV3ExplicitAuthorization,
          hybridV3FeatureEnabled: input.hybridV3FeatureEnabled,
          hybridV3ExplicitLiveAuthorization: input.hybridV3ExplicitLiveAuthorization,
          disablePageContextVerification: input.disablePageContextVerification,
          approvedMaxBudgetUsd: input.approvedMaxBudgetUsd,
          autoRunCatalogMatching,
          targetDatabaseContext,
          catalogMatchingSupabase,
          catalogMatchingOrchestrator: sharedCatalogMatchingOrchestrator,
          onMatchingProgress
        },
        onProgress
      );
    } catch (err: any) {
      logError(`batch:start error: ${err.message}`);
      throw err;
    }
  });

  ipcMain.handle('batch:cancel', async (_event, batchId: string) => {
    try {
      sharedCatalogMatchingOrchestrator.requestCancel(batchId);
      return await sharedBatchOrchestrationService.cancelBatch(batchId);
    } catch (err: any) {
      logError(`batch:cancel error: ${err.message}`);
      throw err;
    }
  });

  ipcMain.handle('batch:resume', async (event, input: {
    batchId: string;
    forceReextract?: boolean;
    hybridV3ExplicitAuthorization?: boolean;
    hybridV3FeatureEnabled?: boolean;
    hybridV3ExplicitLiveAuthorization?: boolean;
    reauthorizeExpandedScope?: boolean;
    approvedMaxBudgetUsd?: number | null;
    approvedAdditionalBudgetUsd?: number;
    disablePageContextVerification?: boolean;
    autoRunCatalogMatching?: boolean;
    targetDatabaseContext?: DatabaseContext;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const onProgress = (p: BatchProgressEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('batch:progress', p);
      }
    };
    const onMatchingProgress = (mp: MatchingProgressEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('matching:progress', mp);
      }
    };

    try {
      const existing = await sharedBatchOrchestrationService.loadBatchManifest(input.batchId);
      const targetDatabaseContext: DatabaseContext =
        input.targetDatabaseContext ||
        existing?.approvedScope?.targetDatabaseContext ||
        'PRODUCTION_UI';
      const autoRunCatalogMatching =
        input.autoRunCatalogMatching ?? existing?.approvedScope?.autoRunCatalogMatching ?? true;
      const catalogMatchingSupabase = autoRunCatalogMatching
        ? resolveOptionalSupabaseClient(targetDatabaseContext)
        : null;

      return await sharedBatchOrchestrationService.resumeBatch(
        input.batchId,
        {
          forceReextract: input.forceReextract,
          hybridV3ExplicitAuthorization: input.hybridV3ExplicitAuthorization,
          hybridV3FeatureEnabled: input.hybridV3FeatureEnabled,
          hybridV3ExplicitLiveAuthorization: input.hybridV3ExplicitLiveAuthorization,
          reauthorizeExpandedScope: input.reauthorizeExpandedScope,
          approvedMaxBudgetUsd: input.approvedMaxBudgetUsd,
          approvedAdditionalBudgetUsd: input.approvedAdditionalBudgetUsd,
          disablePageContextVerification: input.disablePageContextVerification,
          autoRunCatalogMatching,
          targetDatabaseContext,
          catalogMatchingSupabase,
          catalogMatchingOrchestrator: sharedCatalogMatchingOrchestrator,
          onMatchingProgress
        },
        onProgress
      );
    } catch (err: any) {
      logError(`batch:resume error: ${err.message}`);
      throw err;
    }
  });

  ipcMain.handle('batch:getManifest', async (_event, batchId: string) => {
    return await sharedBatchOrchestrationService.loadBatchManifest(batchId);
  });

  ipcMain.handle('batch:getActiveSession', async () => {
    return await sharedBatchOrchestrationService.getActiveWorkflowSession();
  });

  ipcMain.handle('batch:setActiveSession', async (_event, input: any) => {
    return await sharedBatchOrchestrationService.setActiveWorkflowSession(input);
  });

  ipcMain.handle('batch:clearActiveSession', async () => {
    await sharedBatchOrchestrationService.clearActiveWorkflowSession();
    return { success: true };
  });

  ipcMain.handle('batch:split', async (_event, input: {
    originalBatchId: string;
    selectedLeafletIds: string[];
    operatorId?: string;
  }) => {
    return await sharedBatchOrchestrationService.splitBatch(input);
  });

  ipcMain.handle('batch:list', async () => {
    return await sharedBatchOrchestrationService.listBatches();
  });

  ipcMain.handle('batch:getUnifiedOffers', async (_event, input: {
    batchId: string;
    filters?: BatchFilterOptions;
  }) => {
    return await sharedBatchOrchestrationService.getUnifiedBatchOffers(input.batchId, input.filters);
  });

  ipcMain.handle('batch:getSummary', async (_event, batchId: string) => {
    return await sharedBatchOrchestrationService.getUnifiedBatchSummary(batchId);
  });

  ipcMain.handle('batch:discoverLeafletMetadata', async (_event, input: {
    batchId: string;
    leafletId: string;
    catalogSupermarkets?: any[];
    throwOnError?: boolean;
    forceRefresh?: boolean;
  }) => {
    return await sharedBatchOrchestrationService.discoverLeafletMetadata(input);
  });

  ipcMain.handle('batch:getMetadataVisionCostEstimate', async (_event, input: {
    batchId: string;
    leafletId: string;
  }) => {
    return await sharedBatchOrchestrationService.getMetadataVisionCostEstimate(input);
  });

  ipcMain.handle('batch:discoverLeafletMetadataWithVision', async (_event, input: {
    batchId: string;
    leafletId: string;
    explicitVisionAuthorization: boolean;
    forceRefresh?: boolean;
    throwOnError?: boolean;
  }) => {
    return await sharedBatchOrchestrationService.discoverLeafletMetadataWithVision(input);
  });

  ipcMain.handle('batch:getCoverPreview', async (_event, input: {
    batchId: string;
    leafletId: string;
  }) => {
    return await sharedBatchOrchestrationService.getLeafletCoverPreview(input);
  });

  ipcMain.handle('batch:updateLeafletMetadata', async (_event, input: {
    batchId: string;
    leafletId: string;
    metadata: Partial<import('../../shared/types/batchExtraction').LeafletMetadataScope>;
    verified?: boolean;
    operatorId?: string;
  }) => {
    return await sharedBatchOrchestrationService.updateLeafletMetadata(input);
  });

  ipcMain.handle('batch:updateOfferFields', async (_event, input: {
    batchId: string;
    batchOfferKey: string;
    operatorId?: string;
    patch: Record<string, any>;
  }) => {
    const manifest = await sharedBatchOrchestrationService.loadBatchManifest(input.batchId);
    const matchingManifest = sharedCatalogMatchingOrchestrator.loadManifest(input.batchId);
    const databaseContext: DatabaseContext =
      matchingManifest?.matchingDatabaseContext ||
      manifest?.approvedScope?.targetDatabaseContext ||
      'PRODUCTION_UI';
    const supabase = resolveOptionalSupabaseClient(databaseContext);
    return await sharedBatchOrchestrationService.updateBatchOfferFields({
      ...input,
      orchestrator: sharedCatalogMatchingOrchestrator,
      databaseContext,
      supabase
    });
  });

  ipcMain.handle('batch:resolveOfferAsAssorted', async (_event, input: {
    batchId: string;
    batchOfferKey: string;
    operatorId?: string;
    customTitleEn?: string;
    customTitleAr?: string;
  }) => {
    const manifest = await sharedBatchOrchestrationService.loadBatchManifest(input.batchId);
    const matchingManifest = sharedCatalogMatchingOrchestrator.loadManifest(input.batchId);
    const databaseContext: DatabaseContext =
      matchingManifest?.matchingDatabaseContext ||
      manifest?.approvedScope?.targetDatabaseContext ||
      'PRODUCTION_UI';
    const supabase = resolveOptionalSupabaseClient(databaseContext);
    return await sharedBatchOrchestrationService.resolveOfferAsAssorted({
      ...input,
      databaseContext,
      supabase
    });
  });

  ipcMain.handle('batch:selectAndReplaceOfferImage', async (event, input: {
    batchId: string;
    batchOfferKey: string;
    customFilePath?: string;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return await sharedBatchOrchestrationService.selectAndReplaceOfferImage({
      ...input,
      window: win
    });
  });

  ipcMain.handle('batch:restoreDefaultOfferImage', async (_event, input: {
    batchId: string;
    batchOfferKey: string;
  }) => {
    return await sharedBatchOrchestrationService.restoreDefaultOfferImage(input);
  });

  ipcMain.handle('batch:updatePublishedOfferImage', async (_event, input: {
    batchId: string;
    batchOfferKey: string;
    operatorConfirmed: boolean;
    databaseContext?: DatabaseContext;
  }) => {
    return await sharedBatchOrchestrationService.updatePublishedOfferImage(input);
  });

  ipcMain.handle('batch:confirmDerivedTierCrop', async (_event, input: {
    batchId: string;
    batchOfferKey: string;
  }) => {
    return await sharedBatchOrchestrationService.confirmDerivedTierCrop(input);
  });

  ipcMain.handle('batch:previewPublishedOfferImageRepairs', async (_event, input: {
    batchId: string;
    confirmedCropOfferKeys?: string[];
    databaseContext?: DatabaseContext;
  }) => {
    return await sharedBatchOrchestrationService.previewPublishedOfferImageRepairs(input);
  });

  ipcMain.handle('batch:repairPublishedOfferImages', async (_event, input: {
    batchId: string;
    operatorAuthorizedRepair?: boolean;
    operatorAuthorizedIdentityCorrection?: boolean;
    confirmedCropOfferKeys?: string[];
    operatorId?: string;
    databaseContext?: DatabaseContext;
  }) => {
    return await sharedBatchOrchestrationService.repairPublishedOfferImages(input);
  });
}

