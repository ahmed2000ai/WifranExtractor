/**
 * Catalog Matching IPC Handlers
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001
 *
 * Exposes IPC channels for:
 * - Preflight estimation (matching:estimate)
 * - Starting matching pipeline with progress (matching:start)
 * - Retrieving matching manifest (matching:getStatus)
 * - Operator review actions: approve, reject, merge, split (matching:saveDecision)
 * - Safe catalog publication (matching:publishApproved)
 */

import { ipcMain, BrowserWindow } from 'electron'
import { sharedBatchOrchestrationService } from '../batch/batchOrchestrationService'
import { CatalogMatchingOrchestrator } from '../batch/catalogMatchingOrchestrator'
import { CatalogPublicationService } from '../db/catalogPublicationService'
import { getSupabaseAdminClient } from '../db/supabaseAdminClient'
import { createGuardedPgClient, getGuardedSupabaseClient, type DatabaseContext } from '../db/databaseEnvironmentResolver'
import { assessSchemaCompatibility } from '../db/schemaCompatibilityService'
import {
  getPublicationOperationDetails,
  listPublicationHistory,
  previewUndoLastPublish,
  retryUndoStorageCleanup,
  undoLastPublish
} from '../db/publicationJournalAndUndoService'
import { createGuardedStorageAdapter } from '../storage/stagedStorageLifecycleService'
import { error as logError } from '../logging/logger'
import {
  OperatorDecisionStatus,
  MatchingProgressEvent,
  NonCatalogEligibilityCategory
} from '../../shared/types/catalogMatching'

export const sharedCatalogMatchingOrchestrator = new CatalogMatchingOrchestrator()
export const sharedCatalogPublicationService = new CatalogPublicationService()

function buildProgressEmitter(sender: Electron.WebContents, batchId: string) {
  const win = BrowserWindow.fromWebContents(sender)
  return (statusText: string, percent: number, details?: MatchingProgressEvent) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('matching:progress', {
        ...(details || {}),
        batchId,
        statusText,
        percent
      })
    }
  }
}

export function registerCatalogMatchingIpcHandlers(): void {
  ipcMain.handle('matching:estimate', async (_event, batchId: string) => {
    try {
      const offers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(batchId)
      return sharedCatalogMatchingOrchestrator.generatePreflightEstimate(offers)
    } catch (err: any) {
      logError(`matching:estimate error: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle(
    'matching:start',
    async (
      event,
      rawInput:
        | string
        | {
            batchId: string
            mode?: 'full' | 'resume'
            approvedByOperator: boolean
            approvedMaxBudgetUsd: number
            flexTimeoutMs?: number
            targetDatabaseContext?: DatabaseContext
          }
    ) => {
      const input =
        typeof rawInput === 'string'
          ? { batchId: rawInput, approvedByOperator: false, approvedMaxBudgetUsd: 0 }
          : rawInput

      if (
        !input?.approvedByOperator ||
        typeof input.approvedMaxBudgetUsd !== 'number' ||
        !Number.isFinite(input.approvedMaxBudgetUsd) ||
        input.approvedMaxBudgetUsd <= 0
      ) {
        throw new Error(
          'MATCHING_PREFLIGHT_CONFIRMATION_REQUIRED: Operator must review preflight cost/latency estimate and approve a positive max estimated budget before starting Gemini matching.'
        )
      }

      const onProgress = buildProgressEmitter(event.sender, input.batchId)
      const databaseContext: DatabaseContext = input.targetDatabaseContext || 'PRODUCTION_UI'

      try {
        const offers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(input.batchId)
        const supabase =
          databaseContext === 'DEVELOPMENT_TEST'
            ? getGuardedSupabaseClient('DEVELOPMENT_TEST')
            : getSupabaseAdminClient()

        return await sharedCatalogMatchingOrchestrator.executeMatchingRun({
          batchId: input.batchId,
          offers,
          supabase,
          databaseContext,
          mode: input.mode || 'full',
          approvedMaxBudgetUsd: input.approvedMaxBudgetUsd,
          flexTimeoutMs: input.flexTimeoutMs,
          progressCallback: onProgress
        })
      } catch (err: any) {
        logError(`matching:start error: ${err.message}`)
        throw err
      }
    }
  )

  ipcMain.handle('matching:pause', async (_event, batchId: string) => {
    try {
      return sharedCatalogMatchingOrchestrator.requestPause(batchId)
    } catch (err: any) {
      logError(`matching:pause error: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle('matching:cancel', async (_event, batchId: string) => {
    try {
      return sharedCatalogMatchingOrchestrator.requestCancel(batchId)
    } catch (err: any) {
      logError(`matching:cancel error: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle('matching:getRetryFailedSummary', async (_event, batchId: string) => {
    try {
      return sharedCatalogMatchingOrchestrator.getRetryFailedPreflightSummary(batchId)
    } catch (err: any) {
      logError(`matching:getRetryFailedSummary error: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle(
    'matching:retryFailedOnly',
    async (
      event,
      input: {
        batchId: string
        approvedByOperator: boolean
        approvedMaxBudgetUsd: number
        targetRequestKeys?: string[]
        flexTimeoutMs?: number
        targetDatabaseContext?: DatabaseContext
      }
    ) => {
      const onProgress = buildProgressEmitter(event.sender, input.batchId)
      const existingManifest = sharedCatalogMatchingOrchestrator.loadManifest(input.batchId)
      const databaseContext: DatabaseContext =
        input.targetDatabaseContext || existingManifest?.matchingDatabaseContext || 'PRODUCTION_UI'
      try {
        const offers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(input.batchId)
        const supabase =
          databaseContext === 'DEVELOPMENT_TEST'
            ? getGuardedSupabaseClient('DEVELOPMENT_TEST')
            : getSupabaseAdminClient()
        return await sharedCatalogMatchingOrchestrator.retryFailedOnly({
          batchId: input.batchId,
          offers,
          supabase,
          databaseContext,
          approvedByOperator: input.approvedByOperator,
          approvedMaxBudgetUsd: input.approvedMaxBudgetUsd,
          targetRequestKeys: input.targetRequestKeys,
          flexTimeoutMs: input.flexTimeoutMs,
          progressCallback: onProgress
        })
      } catch (err: any) {
        logError(`matching:retryFailedOnly error: ${err.message}`)
        throw err
      }
    }
  )

  ipcMain.handle('matching:getStatus', async (_event, batchId: string) => {
    try {
      return sharedCatalogMatchingOrchestrator.loadManifest(batchId)
    } catch (err: any) {
      logError(`matching:getStatus error: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle(
    'matching:saveDecision',
    async (
      _event,
      input: {
        batchId: string
        batchOfferKey?: string
        temporaryId?: string
        decision: OperatorDecisionStatus
        linkedPermanentProductId?: string
        operatorNotes?: string
        targetType?: 'catalog' | 'non_catalog'
        nonCatalogCategory?: NonCatalogEligibilityCategory | null
      }
    ) => {
      try {
        return sharedCatalogMatchingOrchestrator.applyOperatorDecision(input)
      } catch (err: any) {
        logError(`matching:saveDecision error: ${err.message}`)
        throw err
      }
    }
  )

  ipcMain.handle(
    'matching:saveConsumerImageApproval',
    async (
      _event,
      input: {
        batchId: string
        batchOfferKey: string
        decision: 'approve_generated_crop' | 'reuse_existing_catalog_image' | 'reject'
        productThumbCropPath?: string | null
        existingCatalogImageUrl?: string | null
        imageSubjectScope?: string | null
        boundProductKey?: string | null
        boundProductLabel?: string | null
        rightsBasis?: string | null
        verifiedBy?: string | null
      }
    ) => {
      try {
        const manifest = sharedCatalogMatchingOrchestrator.applyConsumerProductImageDecision(input)
        // Also persist consumerProductImagePath / rightsBasis on staged draft item for downstream direct-draft callers
        await sharedBatchOrchestrationService.syncConsumerImageApprovalToStagedDraft({
          batchId: input.batchId,
          batchOfferKey: input.batchOfferKey,
          approval: manifest.consumerImageApprovals?.[input.batchOfferKey] ?? null
        })
        return manifest
      } catch (err: any) {
        logError(`matching:saveConsumerImageApproval error: ${err.message}`)
        throw err
      }
    }
  )

  ipcMain.handle(
    'matching:publishApproved',
    async (
      _event,
      input: {
        batchId: string
        operatorId: string
        targetContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
        operatorAuthorizedDevPublish?: boolean
        operatorAuthorizedProductionPublish?: boolean
        allowExpiredForDevTest?: boolean
        preflightOnly?: boolean
        idempotencyKey?: string
        approvedUpdateSourceIds?: string[]
        approveAllUpdates?: boolean
        enforceUpdateApproval?: boolean
        overrideConflictSourceIds?: string[]
      }
    ) => {
      try {
        const manifest = sharedCatalogMatchingOrchestrator.loadManifest(input.batchId)
        if (!manifest) {
          throw new Error(`Matching manifest not found for batch ${input.batchId}`)
        }
        const offers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(input.batchId)
        const targetContext = input.targetContext === 'DEVELOPMENT_TEST' ? 'DEVELOPMENT_TEST' : 'PRODUCTION_UI'

        if (targetContext === 'DEVELOPMENT_TEST' && input.operatorAuthorizedDevPublish !== true && !input.preflightOnly) {
          throw new Error(
            'DEVELOPMENT_PUBLISH_AUTHORIZATION_REQUIRED: Writing to DEVELOPMENT_TEST requires explicit operator authorization.'
          )
        }

        const referenceDateIso =
          targetContext === 'DEVELOPMENT_TEST' && input.allowExpiredForDevTest
            ? null
            : new Date().toISOString().slice(0, 10)

        // Assess preflight first with verified metadata, DB duplicate reconciliation & schema parity
        const preflight = await sharedCatalogPublicationService.assessPublicationPreflight({
          manifest,
          offers,
          context: targetContext,
          referenceDateIso,
          enforceMetadataVerification: true,
          operatorAuthorizedProductionPublish: input.operatorAuthorizedProductionPublish,
          runDatabaseReconciliation: true
        })

        if (input.preflightOnly || !preflight.ready) {
          return {
            success: preflight.ready,
            preflightOnly: Boolean(input.preflightOnly),
            preflight,
            message: preflight.ready
              ? 'Publication preflight passed cleanly.'
              : 'Publication preflight checks failed.'
          }
        }

        const result = await sharedCatalogPublicationService.publishApprovedCatalogBatch({
          manifest,
          offers,
          context: targetContext,
          operatorId: input.operatorId || 'operator',
          referenceDateIso,
          enforceMetadataVerification: true,
          operatorAuthorizedProductionPublish: input.operatorAuthorizedProductionPublish,
          idempotencyKey: input.idempotencyKey,
          approvedUpdateSourceIds: input.approvedUpdateSourceIds,
          approveAllUpdates: input.approveAllUpdates,
          enforceUpdateApproval: input.enforceUpdateApproval,
          overrideConflictSourceIds: input.overrideConflictSourceIds
        })

        if (
          result.success &&
          result.publishOperationId &&
          (result.publishedBatchOfferKeys?.length || 0) > 0
        ) {
          await sharedBatchOrchestrationService.recordSelectivePublicationOutcome({
            batchId: input.batchId,
            databaseContext: targetContext,
            publishOperationId: result.publishOperationId,
            publishedBatchOfferKeys: result.publishedBatchOfferKeys || [],
            deferredBatchOfferKeys: result.deferredBatchOfferKeys || [],
            alreadyPublishedBatchOfferKeys: result.alreadyPublishedBatchOfferKeys || [],
            insertedOffersCount: result.insertedOffersCount || 0,
            updatedOffersCount: result.updatedOffersCount || 0,
            sourceOfferIdByKey: result.sourceOfferIdByKey,
            publishedOfferIdByKey: result.publishedOfferIdByKey,
            productIdByKey: result.productIdByKey
          })
        }

        return {
          success: true,
          preflight,
          result
        }
      } catch (err: any) {
        logError(`matching:publishApproved error: ${err.message}`)
        throw err
      }
    }
  )

  const withGuardedClient = async <T>(
    context: DatabaseContext | undefined,
    fn: (client: ReturnType<typeof createGuardedPgClient>, resolvedContext: DatabaseContext) => Promise<T>
  ): Promise<T> => {
    const resolvedContext: DatabaseContext = context === 'DEVELOPMENT_TEST' ? 'DEVELOPMENT_TEST' : 'PRODUCTION_UI'
    const client = createGuardedPgClient(resolvedContext)
    await client.connect()
    try {
      return await fn(client, resolvedContext)
    } finally {
      await client.end().catch(() => {})
    }
  }

  ipcMain.handle(
    'matching:getPublicationHistory',
    async (
      _event,
      input?: {
        context?: DatabaseContext
        limit?: number
        statusFilter?: string | null
        batchIdFilter?: string | null
      }
    ) => {
      try {
        return await withGuardedClient(input?.context, async (client) => {
          return await listPublicationHistory({
            client,
            limit: input?.limit,
            statusFilter: input?.statusFilter,
            batchIdFilter: input?.batchIdFilter
          })
        })
      } catch (err: any) {
        logError(`matching:getPublicationHistory error: ${err.message}`)
        throw err
      }
    }
  )

  ipcMain.handle(
    'matching:getPublicationOperationDetails',
    async (
      _event,
      input: { context?: DatabaseContext; publishOperationId: string }
    ) => {
      try {
        return await withGuardedClient(input?.context, async (client) => {
          return await getPublicationOperationDetails({
            client,
            publishOperationId: input.publishOperationId
          })
        })
      } catch (err: any) {
        logError(`matching:getPublicationOperationDetails error: ${err.message}`)
        throw err
      }
    }
  )

  ipcMain.handle(
    'matching:previewUndoLastPublish',
    async (
      _event,
      input?: { context?: DatabaseContext; publishOperationId?: string | null }
    ) => {
      try {
        return await withGuardedClient(input?.context, async (client) => {
          return await previewUndoLastPublish({
            client,
            publishOperationId: input?.publishOperationId
          })
        })
      } catch (err: any) {
        logError(`matching:previewUndoLastPublish error: ${err.message}`)
        throw err
      }
    }
  )

  ipcMain.handle(
    'matching:undoLastPublish',
    async (
      _event,
      input: {
        context?: DatabaseContext
        operatorId: string
        reason: string
        publishOperationId?: string | null
        operatorAuthorizedProductionPublish?: boolean
      }
    ) => {
      try {
        const resolvedContext: DatabaseContext =
          input?.context === 'DEVELOPMENT_TEST' ? 'DEVELOPMENT_TEST' : 'PRODUCTION_UI'
        if (resolvedContext === 'PRODUCTION_UI') {
          const isAuthorized =
            input.operatorAuthorizedProductionPublish === true ||
            process.env.WIFRAN_PRODUCTION_PUBLICATION_AUTHORIZED === '1'
          if (!isAuthorized) {
            throw new Error(
              'PRODUCTION_UNDO_BLOCKED: Rolling back PRODUCTION_UI requires explicit production owner authorization.'
            )
          }
          const schemaReport = await assessSchemaCompatibility({ context: 'PRODUCTION_UI' })
          if (!schemaReport.compatible) {
            throw new Error(
              `PRODUCTION_UNDO_BLOCKED: Schema parity check failed (${schemaReport.blockingReasons.join(' | ')}).`
            )
          }
        }
        return await withGuardedClient(resolvedContext, async (client) => {
          const undoRes = await undoLastPublish({
            client,
            operatorId: input.operatorId || 'operator',
            reason: input.reason || 'Operator undo last publish',
            publishOperationId: input.publishOperationId,
            storageAdapter: createGuardedStorageAdapter(resolvedContext)
          })
          if (undoRes.success && undoRes.targetOperationId) {
            const opRow = await client.query<{ batch_id: string | null }>(
              `SELECT batch_id FROM public.publication_operations WHERE publish_operation_id = $1 LIMIT 1`,
              [undoRes.targetOperationId]
            )
            const targetBatchId = opRow.rows[0]?.batch_id
            if (targetBatchId) {
              await sharedBatchOrchestrationService.reconcileUndoPublicationOutcome({
                batchId: targetBatchId,
                publishOperationId: undoRes.targetOperationId
              })
            }
          }
          return undoRes
        })
      } catch (err: any) {
        logError(`matching:undoLastPublish error: ${err.message}`)
        throw err
      }
    }
  )

  ipcMain.handle(
    'matching:retryUndoStorageCleanup',
    async (
      _event,
      input: {
        context?: DatabaseContext
        publishOperationId: string
        operatorAuthorizedProductionPublish?: boolean
      }
    ) => {
      try {
        const resolvedContext: DatabaseContext =
          input?.context === 'DEVELOPMENT_TEST' ? 'DEVELOPMENT_TEST' : 'PRODUCTION_UI'
        if (resolvedContext === 'PRODUCTION_UI') {
          const isAuthorized =
            input.operatorAuthorizedProductionPublish === true ||
            process.env.WIFRAN_PRODUCTION_PUBLICATION_AUTHORIZED === '1'
          if (!isAuthorized) {
            throw new Error(
              'PRODUCTION_STORAGE_CLEANUP_BLOCKED: Production storage cleanup retry requires explicit owner authorization.'
            )
          }
        }
        return await withGuardedClient(resolvedContext, async (client) => {
          return await retryUndoStorageCleanup({
            client,
            publishOperationId: input.publishOperationId,
            storageAdapter: createGuardedStorageAdapter(resolvedContext)
          })
        })
      } catch (err: any) {
        logError(`matching:retryUndoStorageCleanup error: ${err.message}`)
        throw err
      }
    }
  )
}

