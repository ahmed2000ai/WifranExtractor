import { PDFDocument } from 'pdf-lib'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { PdfChunkMetadata } from '../../shared/types/pdfPreprocess'

export async function splitPdfIntoChunks(
  sourcePdfPath: string, 
  outputChunksDir: string, 
  chunkSize: number,
  selectedPages?: number[]
): Promise<PdfChunkMetadata[]> {
  const actualChunkSize = Math.max(1, Math.min(3, chunkSize)) // Clamp between 1 and 3
  
  await mkdir(outputChunksDir, { recursive: true })
  const pdfBuffer = await readFile(sourcePdfPath)
  const sourceDoc = await PDFDocument.load(pdfBuffer)
  const totalPages = sourceDoc.getPageCount()

  const pagesToInclude = (selectedPages && selectedPages.length > 0)
    ? selectedPages.filter(p => p >= 1 && p <= totalPages)
    : Array.from({ length: totalPages }, (_, idx) => idx + 1)
  
  const chunks: PdfChunkMetadata[] = []
  let chunkIndex = 1

  for (let i = 0; i < pagesToInclude.length; i += actualChunkSize) {
    const chunkDoc = await PDFDocument.create()
    const batchPages = pagesToInclude.slice(i, i + actualChunkSize)
    const pageIndices = batchPages.map(p => p - 1) // 0-indexed for pdf-lib

    const copiedPages = await chunkDoc.copyPages(sourceDoc, pageIndices)

    for (let j = 0; j < copiedPages.length; j++) {
      chunkDoc.addPage(copiedPages[j])
    }

    const originalPageNumbers = batchPages
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
