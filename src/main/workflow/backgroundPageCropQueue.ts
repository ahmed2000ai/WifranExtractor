import { EventEmitter } from 'events'
import { ManualCropPageLayout, ManualPageCropInfo } from '../../shared/types/manualCrop'
import { cropManualPageLayout } from '../image/manualCropService'
import { error as logError, warn as logWarn } from '../logging/logger'
import path from 'path'
import fs from 'fs'
import { info as logInfo } from '../logging/logger'
import { flexibleItemOcrDiscoveryQueue } from './flexibleItemOcrDiscoveryQueue'

class BackgroundPageCropQueue extends EventEmitter {
  private queue: Array<{ workspacePath: string; layout: ManualCropPageLayout }> = []
  private isProcessing = false
  private currentJob: { workspacePath: string; layout: ManualCropPageLayout } | null = null

  enqueue(workspacePath: string, layout: ManualCropPageLayout) {
    // Deduplicate: if already in queue, replace it
    const existingIndex = this.queue.findIndex(j => j.layout.pageNumber === layout.pageNumber && j.workspacePath === workspacePath)
    if (existingIndex >= 0) {
      this.queue[existingIndex] = { workspacePath, layout }
    } else {
      this.queue.push({ workspacePath, layout })
    }

    // If current job is running for the same page, we should ideally mark it needs rerun.
    // For simplicity, it will finish, and then the new queued job will overwrite it since it's now in the queue again.
    
    logInfo(`[BackgroundPageCropQueue] Queued job for page ${layout.pageNumber}`)
    this.emitProgress(workspacePath, layout.pageNumber, 'queued', layout.boxes.filter(b => b.included).length, 'Job queued')
    
    this.processNext()
  }

  private async processNext() {
    if (this.isProcessing) return
    if (this.queue.length === 0) return

    this.isProcessing = true
    this.currentJob = this.queue.shift()!

    const { workspacePath, layout } = this.currentJob
    const pageNumber = layout.pageNumber
    const includedBoxes = layout.boxes.filter(b => b.included)
    const expectedCropCount = includedBoxes.length

    try {
      logInfo(`[BackgroundPageCropQueue] Starting processing job for page ${pageNumber}...`)
      this.emitProgress(workspacePath, pageNumber, 'running', expectedCropCount, 'Cropping in progress')

      // Clear existing page folder first
      const outputDir = path.join(workspacePath, 'crops')
      const pageSubDir = path.join(outputDir, `page-${String(pageNumber).padStart(3, '0')}`)
      if (fs.existsSync(pageSubDir)) {
        fs.rmSync(pageSubDir, { recursive: true, force: true })
      }

      let pdfBaseName = 'doc'
      try {
        const sessionPath = path.join(workspacePath, 'manual-crop-layout.json')
        if (fs.existsSync(sessionPath)) {
          const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
          if (session.pdfPath) {
            pdfBaseName = path.basename(session.pdfPath, path.extname(session.pdfPath))
            pdfBaseName = pdfBaseName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
          }
        }
      } catch (err) {
        logWarn(`Could not determine pdfBaseName for background crop: ${err}`)
      }

      const result = await cropManualPageLayout({
        layout,
        outputDir,
        imageFormat: 'webp',
        quality: 85,
        pdfBaseName
      })

      if (result.ok) {
        const generatedCropCount = result.croppedImages.length
        
        let status: 'ready' | 'warning' | 'failed' = 'ready'
        let message = 'Crops generated successfully'
        
        if (generatedCropCount < expectedCropCount) {
          status = 'warning'
          message = `Expected ${expectedCropCount} images, generated ${generatedCropCount}`
          logWarn(`Page ${pageNumber} crop warning: ${message}`)
        } else if (generatedCropCount > expectedCropCount) {
          status = 'warning'
          message = `Expected ${expectedCropCount} images, generated ${generatedCropCount}. This should not happen.`
          logWarn(`Page ${pageNumber} crop warning: ${message}`)
        }

        const cropInfo: ManualPageCropInfo = {
          pageNumber,
          status,
          expectedCropCount,
          generatedCropCount,
          outputDir: pageSubDir,
          cropFiles: result.croppedImages.map(c => ({
            pageNumber: c.pageNumber,
            itemNumber: c.itemNumber,
            boxId: layout.boxes.find(b => b.itemNumber === c.itemNumber)?.id || '',
            localImagePath: c.cropPath,
            x: c.x,
            y: c.y,
            width: c.width,
            height: c.height
          }))
        }

        // Queue images for flexible OCR discovery
        for (const cropFile of cropInfo.cropFiles) {
          flexibleItemOcrDiscoveryQueue.enqueue(
            workspacePath,
            cropFile.pageNumber,
            cropFile.itemNumber,
            cropFile.localImagePath
          )
        }

        this.emitComplete(workspacePath, pageNumber, status, cropInfo, message)
      } else {
        this.emitComplete(workspacePath, pageNumber, 'failed', undefined, result.error?.message || 'Crop operation failed')
      }

    } catch (err: any) {
      logError(`Background crop job failed for page ${pageNumber}: ${err.message}`)
      this.emitComplete(workspacePath, pageNumber, 'failed', undefined, err.message)
    } finally {
      this.currentJob = null
      this.isProcessing = false
      // process next
      setTimeout(() => this.processNext(), 0)
    }
  }

  private emitProgress(workspacePath: string, pageNumber: number, status: string, expectedCropCount: number, message: string) {
    this.emit('progress', {
      workspacePath,
      pageNumber,
      status,
      expectedCropCount,
      message
    })
  }

  private emitComplete(workspacePath: string, pageNumber: number, status: string, cropInfo: ManualPageCropInfo | undefined, message: string) {
    this.emit('complete', {
      workspacePath,
      pageNumber,
      status,
      cropInfo,
      message
    })
  }
}

export const backgroundPageCropQueue = new BackgroundPageCropQueue()
