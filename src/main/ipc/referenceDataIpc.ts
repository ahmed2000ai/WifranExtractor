import { ipcMain } from 'electron'
import { loadReferenceDataBundle, loadSupermarkets, loadSupermarketRegions } from '../db/referenceDataService'
import type { ReferenceDataLoadResult } from '../../shared/types/referenceData'

export function registerReferenceDataIpcHandlers(): void {
  ipcMain.handle('reference:loadAll', async (): Promise<ReferenceDataLoadResult> => {
    try {
      const data = await loadReferenceDataBundle()
      return { ok: true, data }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle('reference:loadSupermarkets', async (): Promise<ReferenceDataLoadResult> => {
    try {
      const supermarkets = await loadSupermarkets()
      // We return the array wrapped in the bundle's expected format (only populating supermarkets)
      return { ok: true, data: { supermarkets, cities: [], regions: [], supermarketRegions: [], categories: [], brands: [], units: [] } }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle('reference:loadLocationsForSupermarket', async (_event, { supermarketId }: { supermarketId: string }): Promise<ReferenceDataLoadResult> => {
    try {
      const supermarketRegions = await loadSupermarketRegions()
      const filtered = supermarketRegions.filter(sr => sr.supermarket_id === supermarketId)
      return { ok: true, data: { supermarkets: [], cities: [], regions: [], supermarketRegions: filtered, categories: [], brands: [], units: [] } }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
}
