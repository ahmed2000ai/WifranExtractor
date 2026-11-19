import { ipcMain, dialog, app } from 'electron'
import { stat, readFile } from 'fs/promises'
import crypto from 'crypto'
import { extname, basename, join } from 'path'
import { error as logError } from '../logging/logger'
import type { SelectedPdfFile } from '../../shared/types/importForm'
import { parseLeafletFilename } from '../../shared/utils/leafletFilenameParser'
import { loadSupermarketCodeMap, loadOfferLocationCodeMap } from '../reference/offerReferenceCodeLoader'
import { validatePdfFile } from '../pdf/pdfValidator'

export async function inspectPdfFile(filePath: string): Promise<SelectedPdfFile> {
  const extension = extname(filePath).toLowerCase()
  if (extension !== '.pdf') {
    throw new Error(`Selected file is not a PDF: ${filePath}`)
  }

  const fileStats = await stat(filePath)
  const baseFileName = basename(filePath)

  let pageCount: number | undefined
  let contentFingerprint: string | undefined
  try {
    const pdfVal = await validatePdfFile(filePath)
    if (pdfVal.isValid && typeof pdfVal.pageCount === 'number') {
      pageCount = pdfVal.pageCount
    }
    const pdfBytes = await readFile(filePath)
    contentFingerprint = crypto.createHash('sha256').update(pdfBytes).digest('hex')
  } catch (valErr: any) {
    logError(`Failed to inspect PDF file ${filePath}: ${valErr.message}`)
  }

  let parsedMetadata
  try {
    const isPackaged = app.isPackaged
    const projectRoot = isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : process.cwd()

    const supermarketCodes = await loadSupermarketCodeMap(projectRoot)
    const locationCodes = await loadOfferLocationCodeMap(projectRoot)

    parsedMetadata = parseLeafletFilename({
      fileName: baseFileName,
      supermarketCodes,
      locationCodes
    })
  } catch (err: any) {
    logError(`Failed to parse leaflet filename for ${baseFileName}: ${err.message}`)
  }

  return {
    path: filePath,
    name: baseFileName,
    sizeBytes: fileStats.size,
    extension,
    pageCount,
    contentFingerprint,
    parsedMetadata
  }
}

export function registerFileDialogIpcHandlers(): void {
  ipcMain.handle('file:selectPdf', async (): Promise<SelectedPdfFile | null> => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select PDF Leaflet',
        properties: ['openFile'],
        filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return await inspectPdfFile(result.filePaths[0])
    } catch (err: any) {
      logError(`Error selecting PDF file: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle('file:selectMultiplePdfs', async (): Promise<SelectedPdfFile[]> => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select PDF Leaflets (Multi-Select Supported)',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
      })

      if (result.canceled || result.filePaths.length === 0) {
        return []
      }

      const files: SelectedPdfFile[] = []
      for (const fp of result.filePaths) {
        try {
          const inspected = await inspectPdfFile(fp)
          files.push(inspected)
        } catch (fileErr: any) {
          logError(`Skipping invalid PDF file ${fp}: ${fileErr.message}`)
        }
      }
      return files
    } catch (err: any) {
      logError(`Error selecting multiple PDF files: ${err.message}`)
      throw err
    }
  })

  ipcMain.handle('pdf:getPageCount', async (_event, filePath: string): Promise<number> => {
    try {
      const val = await validatePdfFile(filePath)
      return val.pageCount || 0
    } catch (err: any) {
      logError(`pdf:getPageCount error: ${err.message}`)
      return 0
    }
  })
}
