import { ipcMain } from 'electron'
import { prepareOffersForSync } from '../db/offerPreparationService'
import type { OfferPreparationInput, OfferPreparationResult } from '../../shared/types/offerPayload'

export function setupOfferPreparationHandlers() {
  ipcMain.handle('offerPreparation:prepare', async (_, input: OfferPreparationInput): Promise<OfferPreparationResult> => {
    try {
      return await prepareOffersForSync(input)
    } catch (error: any) {
      console.error('Failed to prepare offers:', error)
      return {
        ok: false,
        totalRows: input.rows?.length || 0,
        preparedRows: 0,
        needsReviewRows: 0,
        duplicateRows: 0,
        errorRows: 0,
        skippedRows: 0,
        results: [],
        error: {
          code: 'OFFER_PREPARATION_FAILED',
          message: error.message || 'Unknown error occurred during offer preparation.'
        }
      }
    }
  })
}
