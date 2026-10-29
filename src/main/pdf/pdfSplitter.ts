import { PDFDocument } from 'pdf-lib'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { PdfChunkMetadata } from '../../shared/types/pdfPreprocess'

export async function splitPdfIntoChunks(
  sourcePdfPath: string, 
  outputChunksDir: string, 
  chunkSize: number
): Promise<PdfChunkMetadata[]> {
  const actualChunkSize = Math.max(1, Math.min(3, chunkSize)) // Clamp between 1 and 3
  
  const pdfBuffer = await readFile(sourcePdfPath)
  const sourceDoc = await PDFDocument.load(pdfBuffer)
  const totalPages = sourceDoc.getPageCount()
  
  const chunks: PdfChunkMetadata[] = []
  let chunkIndex = 1

  for (let i = 0; i < totalPages; i += actualChunkSize) {
    const chunkDoc = await PDFDocument.create()
    const originalPageNumbers: number[] = []

    const endPage = Math.min(i + actualChunkSize, totalPages)
    const pageIndices = Array.from({ length: endPage - i }, (_, k) => i + k)

    const copiedPages = await chunkDoc.copyPages(sourceDoc, pageIndices)

    for (let j = 0; j < copiedPages.length; j++) {
      chunkDoc.addPage(copiedPages[j])
      // Original pages are 1-indexed
      originalPageNumbers.push(i + j + 1)
    }

    const firstPage = originalPageNumbers[0]
    const lastPage = originalPageNumbers[originalPageNumbers.length - 1]

    const paddedIndex = chunkIndex.toString().padStart(3, '0')
    const paddedStart = firstPage.toString().padStart(3, '0')
    const paddedEnd = lastPage.toString().padStart(3, '0')
    
    const chunkFileName = `chunk-${paddedIndex}-pages-${paddedStart}-${paddedEnd}.pdf`
    const chunkFilePath = join(outputChunksDir, chunkFileName)

    const chunkBytes = await chunkDoc.save()
    await writeFile(chunkFilePath, chunkBytes)

    chunks.push({
      chunkId: `chunk-${paddedIndex}`,
      chunkIndex,
      chunkPdfPath: chunkFilePath,
      originalPageNumbers,
      firstOriginalPageNumber: firstPage,
      lastOriginalPageNumber: lastPage
    })

    chunkIndex++
  }

  return chunks
}
