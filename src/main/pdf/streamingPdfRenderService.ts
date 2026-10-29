import { writeFile } from 'fs/promises'
import { fromPath } from 'pdf2pic'
import sharp from 'sharp'
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
import { createInitialExtractionManifest } from '../extraction/extractionManifestService'
import fs from 'fs'
import path from 'path'

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
      state.totalPages = pageCount
      emit('pdf_validated', `PDF validated. Total pages: ${pageCount}`)
    }

    // 2. Initialize pages array
    for (let i = 1; i <= pageCount; i++) {
      state.pages.push({
        pageNumber: i,
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
      originalPdfPath = path.join(workspacePath, 'original.pdf')
      chunksPath = path.join(workspacePath, 'chunks')
      metadataJsonPath = path.join(workspacePath, 'metadata.json')
      state.workspacePath = workspacePath
    }

    const pagesDir = path.join(workspacePath, 'pages')
    if (!fs.existsSync(pagesDir)) {
      fs.mkdirSync(pagesDir, { recursive: true })
    }

    // Initialize extraction manifest
    await createInitialExtractionManifest({
      packagePath: workspacePath,
      pdfBaseName: path.basename(input.originalFileName || input.pdfPath, path.extname(input.originalFileName || input.pdfPath)),
      pdfFileName: input.originalFileName || path.basename(input.pdfPath),
      pageCount: pageCount,
      supermarketId: input.metadata?.supermarketId,
      location: input.metadata?.location,
      offerDates: input.metadata?.offerDates,
      parsedMetadata: input.metadata?.parsedMetadata
    })

    // 4. Split into chunks (do this up front so it's ready for OCR later)
    if (input.chunkSize && !state.chunks) {
      emit('pdf_splitting', 'Splitting PDF into chunks...')
      const chunks = await splitPdfIntoChunks(originalPdfPath, chunksPath, input.chunkSize)
      state.chunks = chunks
      emit('pdf_splitting', `Created ${chunks.length} chunks.`)
    }

    // Initialize metadata
    const metadataJson: any = {
      workspaceId: path.basename(workspacePath),
      originalFileName: input.originalFileName || path.basename(input.pdfPath),
      sourcePdfPath: originalPdfPath,
      pageCount,
      chunkSize: input.chunkSize || 1,
      renderDpi: input.dpi,
      chunks: state.chunks || [],
      renderedPages: [],
      createdAt: new Date().toISOString()
    }
    
    // Write initial metadata
    await writeFile(metadataJsonPath, JSON.stringify(metadataJson, null, 2))

    // 5. Start Render Loop
    const actualDpi = Math.max(100, Math.min(400, input.dpi))
    const storeAsImage = fromPath(originalPdfPath, {
      density: actualDpi,
      saveFilename: 'page',
      savePath: pagesDir,
      format: 'png',
      width: undefined,
      height: undefined
    })

    for (let i = 1; i <= pageCount; i++) {
      const pageInfo = state.pages[i - 1]
      pageInfo.status = 'rendering'
      emit('page_rendering', `Rendering page ${i}...`, pageInfo)

      try {
        const result = await storeAsImage(i, { responseType: 'image' })
        
        if (result && result.path) {
          const imagePath = result.path
          const metadata = await sharp(imagePath).metadata()
          
          pageInfo.status = 'rendered'
          pageInfo.imagePath = imagePath
          pageInfo.width = metadata.width || 0
          pageInfo.height = metadata.height || 0
          
          state.renderedPages++
          if (i === 1) state.firstPageReady = true

          // Update workspace metadata
          metadataJson.renderedPages.push({
            pageNumber: i,
            imagePath,
            width: pageInfo.width,
            height: pageInfo.height,
            dpi: actualDpi
          })
          await writeFile(metadataJsonPath, JSON.stringify(metadataJson, null, 2))

          emit('page_rendered', `Page ${i} rendered successfully.`, pageInfo)
        } else {
          throw new Error('pdf2pic returned empty path.')
        }
      } catch (err: any) {
        logError(`Failed to render page ${i}: ${err.message}`)
        pageInfo.status = 'failed'
        pageInfo.error = { code: 'RENDER_FAILED', message: err.message }
        state.failedPages++
        emit('page_failed', `Failed to render page ${i}: ${err.message}`, pageInfo)
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
