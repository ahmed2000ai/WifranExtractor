import EventEmitter from 'events'
import fs from 'fs'
import path from 'path'
import { error as logError } from '../logging/logger'
import { ocrSingleItemImage } from '../ocr/itemImageOcrService'
import { ocrReturnedKeysDiscoveryService } from '../ocr/ocrReturnedKeysDiscoveryService'
import type { FlexibleItemOcrSummaryJson, CropAndItemOcrProgressEvent } from '../../shared/types/reviewWorkflow'

type OcrDiscoveryJob = {
  workspacePath: string;
  pageNumber: number;
  itemNumber: string;
  localImagePath: string;
}

class FlexibleItemOcrDiscoveryQueue extends EventEmitter {
  private queue: OcrDiscoveryJob[] = []
  private isProcessing = false
  private currentJob: OcrDiscoveryJob | null = null
  private lastRequestTime = 0
  private readonly MIN_REQUEST_INTERVAL_MS = 1100

  // Keyed by workspacePath
  private summaries: Map<string, FlexibleItemOcrSummaryJson> = new Map()

  private getJsonPath(workspacePath: string, localImagePath: string): string {
    const fileName = path.basename(localImagePath, path.extname(localImagePath)) + '.json'
    const pageDirName = path.basename(path.dirname(localImagePath))
    return path.join(workspacePath, 'json', pageDirName, fileName)
  }

  public enqueue(workspacePath: string, pageNumber: number, itemNumber: string, localImagePath: string) {
    // Deduplicate in queue
    const exists = this.queue.some(j => j.localImagePath === localImagePath)
    if (exists) return

    this.queue.push({ workspacePath, pageNumber, itemNumber, localImagePath })
    
    // Update total count
    const summary = this.getSummary(workspacePath)
    if (!summary.items.some(i => i.image_path === localImagePath)) {
      summary.total_images++
      summary.items.push({
        image_path: localImagePath,
        json_path: this.getJsonPath(workspacePath, localImagePath),
        status: 'pending',
        keys_returned: [],
        new_keys_with_values_added: [],
        new_keys_without_values_added: [],
        error: null
      })
      this.saveSummary(workspacePath)
    }
    
    this.emitProgress(workspacePath, 'flexible_item_ocr_queued', 'Job queued', localImagePath)

    this.processNext()
  }

  private getSummary(workspacePath: string): FlexibleItemOcrSummaryJson {
    if (this.summaries.has(workspacePath)) {
      return this.summaries.get(workspacePath)!
    }

    const summaryPath = path.join(workspacePath, 'flexible-item-ocr-summary.json')
    if (fs.existsSync(summaryPath)) {
      try {
        const raw = fs.readFileSync(summaryPath, 'utf8')
        const parsed = JSON.parse(raw) as FlexibleItemOcrSummaryJson
        this.summaries.set(workspacePath, parsed)
        return parsed
      } catch (e) {
        logError(`Failed to load flexible item OCR summary: ${e}`)
      }
    }

    const newSummary: FlexibleItemOcrSummaryJson = {
      total_images: 0,
      ocr_completed: 0,
      ocr_failed: 0,
      json_files_written: 0,
      returned_keys_registry_path: path.join(workspacePath, 'ocr_returned_keys.json'),
      keys_without_values_path: path.join(workspacePath, 'ocr_keys_without_values.json'),
      items: []
    }
    this.summaries.set(workspacePath, newSummary)
    return newSummary
  }

  private saveSummary(workspacePath: string) {
    const summary = this.summaries.get(workspacePath)
    if (!summary) return
    const summaryPath = path.join(workspacePath, 'flexible-item-ocr-summary.json')
    try {
      // Safe write
      const tmpPath = summaryPath + '.tmp'
      fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2))
      fs.renameSync(tmpPath, summaryPath)
    } catch (e) {
      logError(`Failed to write flexible OCR summary: ${e}`)
    }
  }

  private emitProgress(workspacePath: string, stage: CropAndItemOcrProgressEvent['stage'], message: string, imagePath?: string, waitMs?: number) {
    const summary = this.getSummary(workspacePath)
    this.emit('progress', {
      stage,
      message,
      localImagePath: imagePath,
      jsonPath: imagePath ? this.getJsonPath(workspacePath, imagePath) : undefined,
      queuePending: this.queue.length,
      completed: summary.ocr_completed,
      failed: summary.ocr_failed,
      waitMs
    })
  }

  private async processNext() {
    if (this.isProcessing) return
    if (this.queue.length === 0) return

    this.isProcessing = true
    this.currentJob = this.queue.shift()!

    const { workspacePath, pageNumber, itemNumber, localImagePath } = this.currentJob
    const jsonPath = this.getJsonPath(workspacePath, localImagePath)
    const summary = this.getSummary(workspacePath)
    const itemRecord = summary.items.find(i => i.image_path === localImagePath)

    try {
      // 1. Throttle
      const now = Date.now()
      const timeSinceLast = now - this.lastRequestTime
      if (timeSinceLast < this.MIN_REQUEST_INTERVAL_MS) {
        const waitTime = this.MIN_REQUEST_INTERVAL_MS - timeSinceLast
        this.emitProgress(workspacePath, 'flexible_item_ocr_waiting_rate_limit', `Rate limiting, waiting ${waitTime}ms`, localImagePath, waitTime)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }

      if (itemRecord) itemRecord.status = 'running'
      this.emitProgress(workspacePath, 'flexible_item_ocr_started', 'Starting OCR', localImagePath)

      // 2. Call OCR API
      this.lastRequestTime = Date.now()
      const ocrResult = await ocrSingleItemImage({
        localImagePath,
        itemNumber,
        pageNumber
      })

      if (!ocrResult.ok || !ocrResult.ocr) {
        throw new Error(ocrResult.error?.message || 'Unknown OCR failure')
      }

      // Remove currency entry as requested by the user
      if ('currency' in ocrResult.ocr) {
        delete ocrResult.ocr.currency
      }

      // 3. Update Registry
      const { newKeysWithValues, newKeysWithoutValues } = await ocrReturnedKeysDiscoveryService.updateRegistry(workspacePath, jsonPath, ocrResult.ocr)

      if (newKeysWithValues.length > 0) {
        this.emitProgress(workspacePath, 'ocr_returned_keys_updated', `Registry updated with ${newKeysWithValues.length} new keys with values`, localImagePath)
      }
      if (newKeysWithoutValues.length > 0) {
        this.emitProgress(workspacePath, 'ocr_keys_without_values_updated', `Registry updated with ${newKeysWithoutValues.length} new keys without values`, localImagePath)
      }

      // 4. Write Raw JSON
      const jsonDir = path.dirname(jsonPath)
      if (!fs.existsSync(jsonDir)) {
        fs.mkdirSync(jsonDir, { recursive: true })
      }
      fs.writeFileSync(jsonPath, JSON.stringify(ocrResult.ocr, null, 2))
      summary.json_files_written++
      this.emitProgress(workspacePath, 'flexible_item_json_written', 'Raw JSON saved', localImagePath)

      // 5. Update Summary
      if (itemRecord) {
        itemRecord.status = 'completed'
        itemRecord.keys_returned = Object.keys(ocrResult.ocr)
        itemRecord.new_keys_with_values_added = newKeysWithValues
        itemRecord.new_keys_without_values_added = newKeysWithoutValues
        itemRecord.error = null
      }
      summary.ocr_completed++
      
      this.emitProgress(workspacePath, 'flexible_item_ocr_completed', 'OCR finished successfully', localImagePath)

    } catch (err: any) {
      logError(`Flexible Item OCR failed for ${localImagePath}: ${err.message}`)
      if (itemRecord) {
        itemRecord.status = 'failed'
        itemRecord.error = err.message
      }
      summary.ocr_failed++
      this.emitProgress(workspacePath, 'flexible_item_ocr_failed', `OCR failed: ${err.message}`, localImagePath)
    } finally {
      this.saveSummary(workspacePath)
      this.currentJob = null
      this.isProcessing = false
      setTimeout(() => this.processNext(), 0)
    }
  }
}

export const flexibleItemOcrDiscoveryQueue = new FlexibleItemOcrDiscoveryQueue()
