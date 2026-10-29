import { ipcMain, BrowserWindow } from 'electron'
import { runCropAndItemOcrWorkflow, validateManualLayouts } from '../workflow/cropAndItemOcrWorkflow'
import { error as logError } from '../logging/logger'
import type { CropAndItemOcrWorkflowInput, CropAndItemOcrProgressEvent } from '../../shared/types/reviewWorkflow'
import { flexibleItemOcrDiscoveryQueue } from '../workflow/flexibleItemOcrDiscoveryQueue'

export function registerReviewWorkflowIpcHandlers(): void {
  ipcMain.handle('reviewWorkflow:validateLayouts', async (_, layouts: any[]) => {
    try {
      return validateManualLayouts(layouts)
    } catch (err: any) {
      logError(`Layout validation error: ${err.message}`)
      return { ok: false, issues: [{ pageNumber: 0, message: err.message }] }
    }
  })

  ipcMain.handle('reviewWorkflow:runCropAndItemOcr', async (event, input: CropAndItemOcrWorkflowInput) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)

      const result = await runCropAndItemOcrWorkflow(input, (progressEvent: CropAndItemOcrProgressEvent) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('reviewWorkflow:progress', progressEvent)
        }
      })

      return result
    } catch (err: any) {
      logError(`Crop+OCR workflow error: ${err.message}`)
      return {
        ok: false,
        totalPages: 0,
        totalCrops: 0,
        totalOcrCompleted: 0,
        totalOcrFailed: 0,
        reviewItems: [],
        reviewSummaryPath: '',
        reviewItemsPath: '',
        cropFolderPath: '',
        error: err.message
      }
    }
  })

  flexibleItemOcrDiscoveryQueue.on('progress', (data) => {
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('reviewWorkflow:progress', data)
    })
  })
}
