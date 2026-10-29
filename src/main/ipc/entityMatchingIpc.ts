import { ipcMain } from 'electron'
import { matchEntitiesForRows } from '../db/entityMatchingService'
import type { EntityMatchingInput, EntityMatchingResult } from '../../shared/types/entityMatching'

export function setupEntityMatchingHandlers() {
  ipcMain.handle('entityMatching:matchRows', async (_, input: EntityMatchingInput): Promise<EntityMatchingResult> => {
    try {
      return await matchEntitiesForRows(input)
    } catch (error: any) {
      console.error('Failed to match entities:', error)
      return {
        ok: false,
        totalRows: input.rows?.length || 0,
        matchedRows: 0,
        warningRows: 0,
        errorRows: 0,
        skippedRows: 0,
        brandsCreated: 0,
        productsCreated: 0,
        aliasesCreated: 0,
        categoriesCreated: 0,
        results: [],
        error: {
          code: 'ENTITY_MATCHING_FAILED',
          message: error.message || 'Unknown error occurred during entity matching.'
        }
      }
    }
  })
}
