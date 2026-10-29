import { writeFile } from 'fs/promises'
import type { 
  PdfPreprocessInput, 
  PdfPreprocessResult, 
  PdfPreprocessProgressEvent 
} from '../../shared/types/pdfPreprocess'
import { createPdfWorkspace } from './pdfWorkspace'
import { validatePdfFile } from './pdfValidator'
import { splitPdfIntoChunks } from './pdfSplitter'
import { renderPdfPages } from './pdfRenderer'
import { error as logError } from '../logging/logger'

export async function preprocessPdfForImport(
  input: PdfPreprocessInput,
  onProgress?: (event: PdfPreprocessProgressEvent) => void
): Promise<PdfPreprocessResult> {
  const emit = (stage: PdfPreprocessProgressEvent['stage'], message: string, current?: number, total?: number) => {
    if (onProgress) onProgress({ stage, message, current, total })
  }

  try {
    emit('pdf_validating', 'Validating PDF...')
    const validation = await validatePdfFile(input.pdfFilePath)
    
    if (!validation.isValid) {
      emit('failed', `Validation failed: ${validation.error?.message}`)
      return { ok: false, error: validation.error }
    }

    const pageCount = validation.pageCount
    emit('pdf_validated', `PDF validated. Total pages: ${pageCount}`, undefined, pageCount)

    emit('workspace_created', 'Creating local workspace...')
    const workspace = await createPdfWorkspace(input.pdfFilePath, input.originalFileName)
    emit('pdf_copying', `Original PDF copied to workspace.`)

    emit('page_rendering', 'Rendering pages to images...')
    const renderedPages = await renderPdfPages(
      workspace.originalPdfPath,
      workspace.pagesPath,
      input.renderDpi,
      pageCount,
      (current, total) => emit('page_rendering', `Rendered page ${current} of ${total}.`, current, total)
    )

    emit('pdf_splitting', 'Splitting PDF into chunks...')
    const chunks = await splitPdfIntoChunks(
      workspace.originalPdfPath,
      workspace.chunksPath,
      input.chunkSize
    )
    emit('pdf_splitting', `Created ${chunks.length} chunks.`, chunks.length, chunks.length)

    emit('metadata_written', 'Writing metadata JSON...')
    const result: PdfPreprocessResult = {
      ok: true,
      workspaceId: workspace.workspaceId,
      workspacePath: workspace.basePath,
      sourcePdfPath: workspace.originalPdfPath,
      originalFileName: input.originalFileName,
      pageCount,
      chunkSize: input.chunkSize,
      chunks,
      renderedPages,
      metadataPath: workspace.metadataJsonPath
    }

    const metadataJson = {
      workspaceId: workspace.workspaceId,
      originalFileName: input.originalFileName,
      sourcePdfPath: workspace.originalPdfPath,
      pageCount,
      chunkSize: input.chunkSize,
      renderDpi: input.renderDpi,
      chunks,
      renderedPages,
      createdAt: new Date().toISOString()
    }

    await writeFile(workspace.metadataJsonPath, JSON.stringify(metadataJson, null, 2))

    emit('completed', 'PDF preprocessing completed successfully.')
    return result

  } catch (err: any) {
    logError(`Preprocessing failed: ${err.message}`)
    emit('failed', `Preprocessing failed: ${err.message}`)
    return {
      ok: false,
      error: { code: 'PREPROCESS_ERROR', message: err.message }
    }
  }
}
