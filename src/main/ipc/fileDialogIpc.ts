import { ipcMain, dialog } from 'electron'
import { stat } from 'fs/promises'
import { extname, basename, join } from 'path'
import { error as logError } from '../logging/logger'
import type { SelectedPdfFile } from '../../shared/types/importForm'
import { parseLeafletFilename } from '../../shared/utils/leafletFilenameParser'
import { loadSupermarketCodeMap, loadOfferLocationCodeMap } from '../reference/offerReferenceCodeLoader'
import { app } from 'electron'
export function registerFileDialogIpcHandlers(): void {
  ipcMain.handle('file:selectPdf', async (): Promise<SelectedPdfFile | null> => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select PDF Leaflet',
        properties: ['openFile'],
        filters: [
          { name: 'PDF Documents', extensions: ['pdf'] }
        ]
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      const filePath = result.filePaths[0]
      const extension = extname(filePath).toLowerCase()
      
      if (extension !== '.pdf') {
        throw new Error('Selected file is not a PDF.')
      }

      const fileStats = await stat(filePath)
      const baseFileName = basename(filePath)

      let parsedMetadata;
      try {
        const isPackaged = app.isPackaged;
        const projectRoot = isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : process.cwd();
        
        const supermarketCodes = await loadSupermarketCodeMap(projectRoot);
        const locationCodes = await loadOfferLocationCodeMap(projectRoot);
        
        parsedMetadata = parseLeafletFilename({
          fileName: baseFileName,
          supermarketCodes,
          locationCodes
        });
        
        if (parsedMetadata.ok) {
          console.log(`[FilenameParser] filename parsed successfully: ${baseFileName}`);
        } else {
          console.log(`[FilenameParser] filename parse failed: ${baseFileName}`);
          for (const err of parsedMetadata.errors) {
            console.log(`[FilenameParser] Error: ${err.message}`);
            if (err.code === 'unknown_supermarket_code') {
              console.log(`[FilenameParser] unknown supermarket code`);
            }
            if (err.code === 'unknown_location_code') {
              console.log(`[FilenameParser] unknown location code`);
            }
          }
        }
      } catch (err: any) {
        logError(`Failed to parse leaflet filename: ${err.message}`);
      }
      
      return {
        path: filePath,
        name: baseFileName,
        sizeBytes: fileStats.size,
        extension,
        parsedMetadata
      }
    } catch (err: any) {
      logError(`Error selecting PDF file: ${err.message}`)
      throw err // The renderer will catch this and display a validation error if needed
    }
  })
}
