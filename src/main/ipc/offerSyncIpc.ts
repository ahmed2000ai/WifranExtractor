import { ipcMain } from 'electron'
import { syncPreparedOffers } from '../db/offerSyncService'
import type { OfferSyncInput, OfferSyncResult } from '../../shared/types/offerSync'

export function setupOfferSyncHandlers() {
  ipcMain.handle('offerSync:syncPreparedOffers', async (event, input: OfferSyncInput): Promise<OfferSyncResult> => {
    try {
      return await syncPreparedOffers(input, (progressEvent) => {
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
