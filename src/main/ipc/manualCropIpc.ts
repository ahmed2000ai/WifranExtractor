import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { ManualCropSession, ManualCropPageLayout, ManualCropResult } from '../../shared/types/manualCrop'
import { ExtractionManifest } from '../../shared/types/extractionManifest'
import { cropManualPageLayout } from '../image/manualCropService'
import { generateCropSuggestions, loadCropSuggestionsFromCache, saveCropSuggestionsToCache } from '../image/cropSuggestionService'
import { error as logError } from '../logging/logger'
import { backgroundPageCropQueue } from '../workflow/backgroundPageCropQueue'
import { BrowserWindow } from 'electron'
import { annotationService } from '../training/annotationService'

export function registerManualCropIpcHandlers(): void {

  ipcMain.handle('manualCrop:saveSession', async (_, workspacePath: string, session: ManualCropSession) => {
    try {
      const outPath = path.join(workspacePath, 'manual-crop-layout.json')
      fs.writeFileSync(outPath, JSON.stringify(session, null, 2), 'utf-8')

      // Save training annotations for confirmed pages
      try {
        const manifestPath = path.join(workspacePath, 'metadata', 'manifest.json')
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ExtractionManifest
          const meta = manifest.leaflet_filename_metadata
          if (meta && meta.supermarket_code) {
            for (const layout of session.pageLayouts) {
              if (layout && layout.pageComplete) {
                await annotationService.saveAnnotationFromLayout(layout, {
                  leafletFileName: meta.source_file_name || 'unknown.pdf',
                  supermarketCode: meta.supermarket_code,
                  supermarketDescription: meta.supermarket_description ?? undefined,
                  locationCode: meta.location_code ?? undefined,
                  promotionStartDate: meta.promotion_start_date ?? undefined
                })

                // -- SESSION ADAPTATION --
                const { sessionLayoutLearningService } = await import('../ml/sessionLayoutLearningService')
                // Reconstruct image path
                const pageImagePath = path.join(workspacePath, 'pages', `page.${layout.pageNumber}.png`)
                // Page size isn't directly in layout, but we can read it using sharp inside handlePageConfirmed if needed.
                // However, let's just get it from the layout boxes or metadata if available. We will fetch it via sharp.
                if (fs.existsSync(pageImagePath)) {
                   const sharp = (await import('sharp')).default
                   const pMeta = await sharp(pageImagePath).metadata()
                   const pWidth = pMeta.width || 1000
                   const pHeight = pMeta.height || 1000
                   await sessionLayoutLearningService.handlePageConfirmed(
                      path.join(workspacePath, 'metadata'),
                      layout.pageNumber,
                      layout.boxes.map(b => ({
                        id: b.id,
                        pageNumber: layout.pageNumber,
                        x: b.x, y: b.y, width: b.width, height: b.height,
                        confidence: 1.0,
                        source: 'operator_manual',
                        reasonCodes: [],
                        status: 'accepted'
                      })),
                      pageImagePath,
                      pWidth,
                      pHeight
                   )
                }
              }
            }
          }
        }
      } catch (err: any) {
        logError(`Failed to save training annotation or adapt session: ${err.message}`)
      }

      return { ok: true }
    } catch (err: any) {
      logError(`Failed to save manual crop session: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('manualCrop:loadSession', async (_, workspacePath: string) => {
    try {
      const inPath = path.join(workspacePath, 'manual-crop-layout.json')
      if (fs.existsSync(inPath)) {
        const raw = fs.readFileSync(inPath, 'utf-8')
        const session = JSON.parse(raw) as ManualCropSession
        return { ok: true, session }
      }
      return { ok: true, session: null }
    } catch (err: any) {
      logError(`Failed to load manual crop session: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('manualCrop:cropPage', async (_, args: { layout: ManualCropPageLayout, workspacePath: string }) => {
    try {
      const { layout, workspacePath } = args
      const outputDir = path.join(workspacePath, 'crops')
      
      let pdfBaseName = 'doc'
      try {
        const sessionPath = path.join(workspacePath, 'manual-crop-layout.json')
        if (fs.existsSync(sessionPath)) {
          const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
          if (session.pdfPath) {
            pdfBaseName = path.basename(session.pdfPath, path.extname(session.pdfPath)).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
          }
        }
      } catch (e) { logError(`Could not get pdfBaseName: ${e}`) }

      const result = await cropManualPageLayout({
        layout,
        outputDir,
        imageFormat: 'webp',
        quality: 90,
        pdfBaseName
      })
      
      return result
    } catch (err: any) {
      logError(`Failed to execute manual crop for page: ${err.message}`)
      return { ok: false, error: { code: 'MANUAL_CROP_ERROR', message: err.message } }
    }
  })

  ipcMain.handle('manualCrop:cropAllPages', async (_, args: { layouts: ManualCropPageLayout[], workspacePath: string }) => {
    try {
      const { layouts, workspacePath } = args
      const outputDir = path.join(workspacePath, 'crops')
      
      let pdfBaseName = 'doc'
      try {
        const sessionPath = path.join(workspacePath, 'manual-crop-layout.json')
        if (fs.existsSync(sessionPath)) {
          const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
          if (session.pdfPath) {
            pdfBaseName = path.basename(session.pdfPath, path.extname(session.pdfPath)).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
          }
        }
      } catch (e) { logError(`Could not get pdfBaseName: ${e}`) }

      const results: ManualCropResult[] = []
      for (const layout of layouts) {
        const res = await cropManualPageLayout({
          layout,
          outputDir,
          imageFormat: 'webp',
          quality: 90,
          pdfBaseName
        })
        results.push(res)
      }
      return { ok: true, results }
    } catch (err: any) {
      logError(`Failed to execute manual crop for all pages: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('manualCrop:generateSuggestions', async (_, args: { manifest: ExtractionManifest, pageNumber: number, pageImagePath: string }) => {
    try {
      const result = await generateCropSuggestions(args)
      if (args.manifest.paths?.metadata_dir) {
        await saveCropSuggestionsToCache(path.join(args.manifest.paths.metadata_dir, '..'), result)
      }
      return { ok: true, result }
    } catch (err: any) {
      logError(`Failed to generate crop suggestions: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('manualCrop:loadSuggestions', async (_, args: { manifestDir: string, pageNumber: number }) => {
    try {
      const result = await loadCropSuggestionsFromCache(args.manifestDir, args.pageNumber)
      return { ok: true, result }
    } catch (err: any) {
      logError(`Failed to load crop suggestions: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('manualCrop:getReviewQueue', async (_, manifestDir: string) => {
    try {
      const { detectorReviewQueueService } = await import('../ml/detectorReviewQueueService')
      const queue = detectorReviewQueueService.getQueue(manifestDir)
      return { ok: true, queue }
    } catch (err: any) {
      logError(`Failed to get review queue: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('manualCrop:enqueuePageCrop', async (_, args: { workspacePath: string, layout: ManualCropPageLayout }) => {
    backgroundPageCropQueue.enqueue(args.workspacePath, args.layout)
    return { ok: true }
  })

  backgroundPageCropQueue.on('progress', (data) => {
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('manualCrop:pageCropProgress', data)
    })
  })

  backgroundPageCropQueue.on('complete', (data) => {
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('manualCrop:pageCropProgress', data)
    })
  })
}
