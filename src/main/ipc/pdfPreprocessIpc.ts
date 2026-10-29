import { ipcMain } from 'electron'
import { preprocessPdfForImport } from '../pdf/pdfPreprocessService'
import type { PdfPreprocessInput, PdfPreprocessResult, StreamingPdfRenderInput, StreamingPdfRenderState } from '../../shared/types/pdfPreprocess'
import { renderPdfPagesStreaming } from '../pdf/streamingPdfRenderService'

export function registerPdfPreprocessIpcHandlers(): void {
  ipcMain.handle('pdf:preprocess', async (event, input: PdfPreprocessInput): Promise<PdfPreprocessResult> => {
    // Basic clamping validation for chunk size
    const clampedInput = {
      ...input,
      chunkSize: Math.max(1, Math.min(3, input.chunkSize || 2)),
      renderDpi: Math.max(100, Math.min(400, input.renderDpi || 200))
    }

    // Call service, emitting progress back to renderer
    return preprocessPdfForImport(clampedInput, (progressEvent) => {
      // Send the event back to the specific webContents that requested it
      event.sender.send('pdf:preprocess-progress', progressEvent)
    })
  })

  ipcMain.handle('pdf:renderStreaming', async (event, input: StreamingPdfRenderInput): Promise<StreamingPdfRenderState> => {
    return renderPdfPagesStreaming(input, (progressEvent) => {
      event.sender.send('pdf:renderStreamingProgress', progressEvent)
    })
  })
}
