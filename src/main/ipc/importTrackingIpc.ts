import { ipcMain } from 'electron'
import { persistImportTracking } from '../db/importTrackingService'
import type { PersistImportTrackingInput } from '../../shared/types/importTracking'

export function registerImportTrackingIpcHandlers(): void {
  ipcMain.handle('importTracking:persist', async (_event, input: PersistImportTrackingInput) => {
    return persistImportTracking(input)
  })
}
