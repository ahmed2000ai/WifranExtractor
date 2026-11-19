import { writeFile } from 'fs/promises'
import { fromPath } from 'pdf2pic'
import sharp from 'sharp'
import crypto from 'crypto'
import type { 
  StreamingPdfRenderInput, 
  StreamingPdfRenderState, 
  StreamingPdfRenderProgressEvent,
  RenderedPageInfo
} from '../../shared/types/pdfPreprocess'
import { createPdfWorkspace } from './pdfWorkspace'
import { validatePdfFile } from './pdfValidator'
import { splitPdfIntoChunks } from './pdfSplitter'
import { error as logError, info } from '../logging/logger'
import { createInitialExtractionManifest, loadExtractionManifest, saveExtractionManifest } from '../extraction/extractionManifestService'
import fs from 'fs'
import path from 'path'

async function computeRenderedPageFingerprints(imagePath: string): Promise<{
  pageContentSha256: string | null
  pagePerceptualHash: string | null
}> {
  let pageContentSha256: string | null = null
  let pagePerceptualHash: string | null = null
  try {
    const fileBuf = fs.readFileSync(imagePath)
    pageContentSha256 = crypto.createHash('sha256').update(fileBuf).digest('hex')
    try {
      const { data } = await sharp(fileBuf)
        .grayscale()
        .resize(9, 8, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true })
      if (data && data.length >= 72) {
        let bits = 0n
        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 8; col++) {
            const left = data[row * 9 + col]
            const right = data[row * 9 + col + 1]
            bits = (bits << 1n) | (left > right ? 1n : 0n)
          }
        }
        pagePerceptualHash = bits.toString(16).padStart(16, '0')
      }
    } catch {
      pagePerceptualHash = null
    }
  } catch {
    pageContentSha256 = null
  }
  return { pageContentSha256, pagePerceptualHash }
}

// Inject GS and GM into PATH if on Windows (from pdfRenderer)
if (process.platform === 'win32') {
  try {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    const gsDir = path.join(pf, 'gs')
    if (fs.existsSync(gsDir)) {
      const versions = fs.readdirSync(gsDir).filter(f => f.startsWith('gs'))
      if (versions.length > 0) {
        const latestGsBin = path.join(gsDir, versions[versions.length - 1], 'bin')
        if (fs.existsSync(latestGsBin) && !process.env.PATH?.includes(latestGsBin)) {
          process.env.PATH = `${latestGsBin};${process.env.PATH}`
        }
      }
    }
    if (fs.existsSync(pf)) {
      const dirs = fs.readdirSync(pf)
      const gmDirs = dirs.filter(f => f.startsWith('GraphicsMagick'))
      if (gmDirs.length > 0) {
        const latestGm = path.join(pf, gmDirs[gmDirs.length - 1])
        if (fs.existsSync(latestGm) && !process.env.PATH?.includes(latestGm)) {
          process.env.PATH = `${latestGm};${process.env.PATH}`
        }
      }
    }
  } catch (err) {
    logError(`Failed to inject GS/GM into PATH: ${err}`)
  }
}

export async function renderPdfPagesStreaming(
  input: StreamingPdfRenderInput,
  onProgress?: (event: StreamingPdfRenderProgressEvent) => void
): Promise<StreamingPdfRenderState> {
  const state: StreamingPdfRenderState = {
    status: 'running',
    totalPages: input.pageCount || 0,
    renderedPages: 0,
    failedPages: 0,
    pages: [],
    firstPageReady: false,
    startedAt: new Date().toISOString()
  }

  const emit = (eventStage: StreamingPdfRenderProgressEvent['stage'], message: string, page?: RenderedPageInfo) => {
    info(`[StreamingRender] ${eventStage}: ${message}`)
    if (onProgress) {
      onProgress({
        jobId: input.jobId,
        stage: eventStage,
        message,
        pageNumber: page?.pageNumber,
        renderedPages: state.renderedPages,
        failedPages: state.failedPages,
        totalPages: state.totalPages,
        page,
        workspacePath: state.workspacePath,
        chunks: state.chunks
      })
    }
  }

  try {
    emit('started', 'Starting streaming PDF render...')

    // 1. Validate
    let pageCount = input.pageCount || 0
    if (!pageCount) {
      emit('pdf_validating', 'Validating PDF...')
      const validation = await validatePdfFile(input.pdfPath)
      if (!validation.isValid || !validation.pageCount) {
        throw new Error(`Validation failed: ${validation.error?.message}`)
      }
      pageCount = validation.pageCount
      emit('pdf_validated', `PDF validated. Total pages: ${pageCount}`)
    }

    // 1b. Determine strict processing page scope
    const selectionMode: 'all' | 'specific' =
      input.selectionMode ||
      (input.selectedPages && input.selectedPages.length > 0 && input.selectedPages.length < pageCount ? 'specific' : 'all')

    let pagesToRender: number[]
    if (selectionMode === 'specific') {
      if (!input.selectedPages || input.selectedPages.length === 0) {
        throw new Error('INVALID_PAGE_SELECTION: Specific pages mode selected, but no pages were specified.')
      }
      const outOfBounds = input.selectedPages.filter(p => p < 1 || p > pageCount)
      if (outOfBounds.length > 0) {
        throw new Error(`INVALID_PAGE_SELECTION: Selected pages [${outOfBounds.join(', ')}] exceed PDF page count (${pageCount}).`)
      }
      pagesToRender = Array.from(new Set(input.selectedPages)).sort((a, b) => a - b)
    } else {
      pagesToRender = Array.from({ length: pageCount }, (_, i) => i + 1)
    }

    state.totalDocumentPages = pageCount
    state.selectedPages = pagesToRender
    state.selectionMode = selectionMode
    state.totalPages = pagesToRender.length

    // 2. Initialize pages array STRICTLY for selected pages
    for (const pNum of pagesToRender) {
      state.pages.push({
        pageNumber: pNum,
        imagePath: '',
        width: 0,
        height: 0,
        dpi: input.dpi,
        status: 'queued'
      })
    }

    // 3. Create Workspace
    let workspacePath = input.workspacePath
    let originalPdfPath = input.pdfPath
    let chunksPath = ''
    let metadataJsonPath = ''
    
    // Only create workspace if not provided
    if (!workspacePath) {
      emit('workspace_created', 'Creating local workspace...')
      const workspace = await createPdfWorkspace(input.pdfPath, input.originalFileName || path.basename(input.pdfPath))
      workspacePath = workspace.basePath
      originalPdfPath = workspace.originalPdfPath
      chunksPath = workspace.chunksPath
      metadataJsonPath = workspace.metadataJsonPath
      state.workspacePath = workspacePath
      emit('pdf_copying', `Original PDF copied to workspace.`)
    } else {
      if (!fs.existsSync(workspacePath)) {
        fs.mkdirSync(workspacePath, { recursive: true })
      }
      originalPdfPath = path.join(workspacePath, 'original.pdf')
      if (!fs.existsSync(originalPdfPath)) {
        if (input.pdfPath && fs.existsSync(input.pdfPath)) {
          try {
            fs.copyFileSync(input.pdfPath, originalPdfPath)
          } catch {
            originalPdfPath = input.pdfPath
          }
        } else if (input.originalFileName && fs.existsSync(path.join(workspacePath, input.originalFileName))) {
          originalPdfPath = path.join(workspacePath, input.originalFileName)
        } else if (input.pdfPath) {
          originalPdfPath = input.pdfPath
        }
      }
      chunksPath = path.join(workspacePath, 'chunks')
      metadataJsonPath = path.join(workspacePath, 'metadata.json')
      state.workspacePath = workspacePath
      if (!fs.existsSync(chunksPath)) {
        fs.mkdirSync(chunksPath, { recursive: true })
      }
    }

    const pagesDir = path.join(workspacePath, 'pages')
    if (!fs.existsSync(pagesDir)) {
      fs.mkdirSync(pagesDir, { recursive: true })
    }

    // Compute PDF content fingerprint
    let pdfFingerprint = ''
    try {
      const pdfBytes = fs.readFileSync(originalPdfPath)
      pdfFingerprint = crypto.createHash('sha256').update(pdfBytes).digest('hex')
    } catch {
      pdfFingerprint = path.basename(originalPdfPath)
    }

    // If operator-confirmed metadata already exists in durable cache for this PDF fingerprint, sync it into the workspace
    try {
      const { getLeafletMetadataService } = await import('../metadata/leafletMetadataService')
      const cache = getLeafletMetadataService().getCache()
      const existingConfirmed = cache.getConfirmed(pdfFingerprint)
      if (existingConfirmed && existingConfirmed.operatorConfirmed) {
        cache.saveConfirmedMetadata(pdfFingerprint, existingConfirmed, workspacePath)
      }
    } catch {
      // Non-fatal in offline/minimal unit tests
    }

    const processingSelection = {
      pdfFingerprint,
      totalDocumentPages: pageCount,
      selectionMode,
      selectedPages: pagesToRender,
      processingStatus: 'in_progress' as const,
      coverage: (pagesToRender.length === pageCount ? 'full' : 'partial') as 'full' | 'partial'
    }

    // Initialize or update extraction manifest without destroying existing artifacts
    const existingManifest = await loadExtractionManifest(workspacePath)
    if (existingManifest) {
      existingManifest.processing_selection = processingSelection
      existingManifest.processing_scope = {
        mode: selectionMode === 'specific' ? 'selected_pages' : 'all_pages',
        pages: pagesToRender
      }
      await saveExtractionManifest(workspacePath, existingManifest)
    } else {
      await createInitialExtractionManifest({
        packagePath: workspacePath,
        pdfBaseName: path.basename(input.originalFileName || input.pdfPath, path.extname(input.originalFileName || input.pdfPath)),
        pdfFileName: input.originalFileName || path.basename(input.pdfPath),
        pageCount: pageCount,
        supermarketId: input.metadata?.supermarketId,
        location: input.metadata?.location,
        offerDates: input.metadata?.offerDates,
        parsedMetadata: input.metadata?.parsedMetadata,
        processingSelection
      })
    }

    // 4. Split into chunks (ONLY for selected pages!)
    if (input.chunkSize && !state.chunks) {
      emit('pdf_splitting', 'Splitting selected PDF pages into chunks...')
      const chunks = await splitPdfIntoChunks(originalPdfPath, chunksPath, input.chunkSize, pagesToRender)
      state.chunks = chunks
      emit('pdf_splitting', `Created ${chunks.length} chunks for ${pagesToRender.length} selected pages.`)
    }

    // Initialize metadata
    const metadataJson: any = {
      workspaceId: path.basename(workspacePath),
      originalFileName: input.originalFileName || path.basename(input.pdfPath),
      sourcePdfPath: originalPdfPath,
      pdfFingerprint,
      pageCount,
      totalDocumentPages: pageCount,
      selectionMode,
      selectedPages: pagesToRender,
      chunkSize: input.chunkSize || 1,
      renderDpi: input.dpi,
      chunks: state.chunks || [],
      renderedPages: [],
      createdAt: new Date().toISOString()
    }
    
    // Write initial metadata
    await writeFile(metadataJsonPath, JSON.stringify(metadataJson, null, 2))

    // 5. Start Render Loop STRICTLY over pagesToRender
    const actualDpi = Math.max(100, Math.min(400, input.dpi))
    const storeAsImage = fromPath(originalPdfPath, {
      density: actualDpi,
      saveFilename: 'page',
      savePath: pagesDir,
      format: 'png',
      width: undefined,
      height: undefined
    })

    const customRenderer = (input as any)._customPageRenderer as ((pageNum: number, pagesDir: string) => Promise<{ path: string; width?: number; height?: number }>) | undefined

    for (let idx = 0; idx < pagesToRender.length; idx++) {
      const pageNum = pagesToRender[idx]
      const pageInfo = state.pages[idx]
      pageInfo.status = 'rendering'
      emit('page_rendering', `Rendering page ${pageNum}...`, pageInfo)

      try {
        const result = customRenderer
          ? await customRenderer(pageNum, pagesDir)
          : await storeAsImage(pageNum, { responseType: 'image' })
        
        if (result && result.path) {
          const imagePath = result.path
          const metadata = (result as any).width && (result as any).height
            ? { width: (result as any).width, height: (result as any).height }
            : await sharp(imagePath).metadata()
          
          const { pageContentSha256, pagePerceptualHash } = await computeRenderedPageFingerprints(imagePath)

          pageInfo.status = 'rendered'
          pageInfo.imagePath = imagePath
          pageInfo.width = metadata.width || 0
          pageInfo.height = metadata.height || 0
          ;(pageInfo as any).pageContentSha256 = pageContentSha256
          ;(pageInfo as any).pagePerceptualHash = pagePerceptualHash

          state.renderedPages++
          if (state.renderedPages === 1) state.firstPageReady = true

          // Update workspace metadata
          metadataJson.renderedPages.push({
            pageNumber: pageNum,
            imagePath,
            width: pageInfo.width,
            height: pageInfo.height,
            dpi: actualDpi,
            pageContentSha256,
            pagePerceptualHash
          })
          await writeFile(metadataJsonPath, JSON.stringify(metadataJson, null, 2))

          emit('page_rendered', `Page ${pageNum} rendered successfully.`, pageInfo)
        } else {
          throw new Error('pdf2pic returned empty path.')
        }
      } catch (err: any) {
        logError(`Failed to render page ${pageNum}: ${err.message}`)
        pageInfo.status = 'failed'
        pageInfo.error = { code: 'RENDER_FAILED', message: err.message }
        state.failedPages++
        emit('page_failed', `Failed to render page ${pageNum}: ${err.message}`, pageInfo)
      }
    }

    state.status = state.failedPages === 0 ? 'completed' : state.renderedPages > 0 ? 'partially_completed' : 'failed'
    state.completedAt = new Date().toISOString()
    
    emit(state.status as any, `Streaming render ${state.status}. ${state.renderedPages} rendered, ${state.failedPages} failed.`)
    return state

  } catch (err: any) {
    logError(`Streaming render failed: ${err.message}`)
    state.status = 'failed'
    state.error = err.message
    state.completedAt = new Date().toISOString()
    emit('failed', `Streaming render fatal error: ${err.message}`)
    return state
  }
}
