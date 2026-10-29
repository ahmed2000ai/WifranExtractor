import { ipcMain, dialog } from 'electron'
import { openExtractionPackage, getDbEligibleItemsFromPackage, listAvailableExtractions } from '../extraction/extractionPackageService'
import { validateExtractionPackage } from '../extraction/extractionPackageValidator'
import { loadExtractionManifest, updateExtractionManifest } from '../extraction/extractionManifestService'

export function registerExtractionPackageHandlers() {
  ipcMain.handle('extractionPackage:listAvailable', async () => {
    try {
      const extracts = await listAvailableExtractions()
      return { ok: true, extracts }
    } catch (err: any) {
      return { ok: false, error: err.message, extracts: [] }
    }
  })

  ipcMain.handle('extractionPackage:openFolderDialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (canceled || filePaths.length === 0) {
      return null
    }
    return filePaths[0]
  })

  ipcMain.handle('extractionPackage:open', async (_, packagePath: string) => {
    return await openExtractionPackage(packagePath)
  })

  ipcMain.handle('extractionPackage:validate', async (_, packagePath: string) => {
    const manifest = await loadExtractionManifest(packagePath)
    if (!manifest) {
      return { ok: false, error: 'Manifest not found' }
    }
    return await validateExtractionPackage(packagePath, manifest)
  })

  ipcMain.handle('extractionPackage:continue', async (_, packagePath: string) => {
    // A simplified resume flow. A full implementation would check stages explicitly.
    const manifest = await loadExtractionManifest(packagePath)
    if (!manifest) {
      return { ok: false, error: 'Manifest not found' }
    }

    let resumeAction = 'start_rendering'
    if (manifest.stages.page_rendering === 'completed') {
      resumeAction = 'open_manual_crop'
      if (manifest.stages.manual_crop === 'completed') {
        resumeAction = 'resume_crops'
        if (manifest.stages.crop_generation === 'completed') {
          resumeAction = 'resume_ocr'
          if (manifest.stages.item_ocr === 'completed') {
            resumeAction = 'rebuild_review'
          }
        }
      }
    }

    return { ok: true, resumeAction }
  })

  ipcMain.handle('extractionPackage:getDbEligibleItems', async (_, packagePath: string) => {
    return await getDbEligibleItemsFromPackage(packagePath)
  })

  ipcMain.handle('extractionPackage:updateMetadata', async (_, { packagePath, patch }) => {
    const manifest = await updateExtractionManifest(packagePath, patch)
    const validation = await validateExtractionPackage(packagePath, manifest)
    return { ok: true, manifest, validation }
  })
}
