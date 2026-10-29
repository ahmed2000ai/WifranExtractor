import { ipcMain } from 'electron'
import { cropImagesForOcrRows } from '../image/imageCroppingService'
import type { ImageCroppingInput } from '../../shared/types/imageCropping'

export function registerImageCroppingIpc(): void {
  ipcMain.handle('image:cropOcrRows', async (event, input: ImageCroppingInput) => {
    return cropImagesForOcrRows(input, (progressEvent) => {
      // Stream progress events directly back to the calling window
      event.sender.send('image:crop-progress', progressEvent)
    })
  })
}
