import { ipcMain } from 'electron'
import { syncPreparedOffers } from '../db/offerSyncService'
import type { OfferSyncInput, OfferSyncResult } from '../../shared/types/offerSync'

/**
 * Strips untrusted renderer-supplied overrides (such as spoofed Supabase clients
 * or disabling mandatory Pre-Publish approval) before crossing into main-process sync.
 */
export function sanitizeOfferSyncIpcInput(input: OfferSyncInput): OfferSyncInput {
  const rawOptions: any = (input && typeof input === 'object' && input.options) ? input.options : {}
  const { supabaseClient: _ignoredClient, requirePrePublishApproval: rawRequireApproval, ...safeOptions } = rawOptions
  const isDryRun = safeOptions.dryRun === true

  return {
    ...input,
    options: {
      ...safeOptions,
      // Non-dry-run IPC syncs MUST always enforce backend Pre-Publish Preview & Metadata gates.
      requirePrePublishApproval: isDryRun ? rawRequireApproval !== false : true
    }
  }
}

export function setupOfferSyncHandlers() {
  ipcMain.handle('offerSync:syncPreparedOffers', async (event, input: OfferSyncInput): Promise<OfferSyncResult> => {
    try {
      const sanitizedInput = sanitizeOfferSyncIpcInput(input)
      return await syncPreparedOffers(sanitizedInput, (progressEvent) => {
        // Broadcast back to renderer
        event.sender.send('offerSync:progress', progressEvent)
      })
    } catch (error: any) {
      console.error('Failed to sync offers:', error)
      return {
        ok: false,
        status: 'failed',
        totalRows: input.rows?.length || 0,
        importedRows: 0,
        publishedRows: 0,
        needsReviewImportedRows: 0,
        skippedRows: 0,
        duplicateRows: 0,
        errorRows: 0,
        imageUploadedRows: 0,
        imageFailedRows: 0,
        results: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        error: {
          code: 'OFFER_SYNC_FAILED',
          message: error.message || 'Unknown error occurred during offer sync.'
        }
      }
    }
  })
}
