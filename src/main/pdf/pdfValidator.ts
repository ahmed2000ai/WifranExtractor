import { stat } from 'fs/promises'
import { extname } from 'path'
import { PDFDocument } from 'pdf-lib'
import { readFile } from 'fs/promises'

export type PdfValidationResult = {
  isValid: boolean
  pageCount: number
  error?: {
    code: string
    message: string
  }
}

export async function validatePdfFile(filePath: string): Promise<PdfValidationResult> {
  try {
    const fileStats = await stat(filePath)
    
    if (fileStats.size === 0) {
      return { isValid: false, pageCount: 0, error: { code: 'PDF_FILE_EMPTY', message: 'The selected PDF file is empty.' } }
    }
  } catch (err) {
    return { isValid: false, pageCount: 0, error: { code: 'PDF_FILE_NOT_FOUND', message: 'The selected PDF file could not be found.' } }
  }

  const extension = extname(filePath).toLowerCase()
  if (extension !== '.pdf') {
    return { isValid: false, pageCount: 0, error: { code: 'PDF_EXTENSION_INVALID', message: 'The selected file is not a PDF document.' } }
  }

  try {
    const fileBuffer = await readFile(filePath)
    
    let pdfDoc: PDFDocument
    try {
      // ignoreEncryption allows reading if not fully encrypted, but if it requires password, it might still fail to read contents properly
      pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true })
    } catch (e: any) {
      if (e.message?.toLowerCase().includes('encrypted')) {
        return { isValid: false, pageCount: 0, error: { code: 'PDF_PASSWORD_PROTECTED', message: 'The PDF is encrypted or password-protected.' } }
      }
      throw e
    }

    if (pdfDoc.isEncrypted) {
      // Check if it's strictly locked
      return { isValid: false, pageCount: 0, error: { code: 'PDF_PASSWORD_PROTECTED', message: 'The PDF is encrypted and requires a password.' } }
    }

    const pageCount = pdfDoc.getPageCount()
    
    if (pageCount === 0) {
      return { isValid: false, pageCount: 0, error: { code: 'PDF_PAGE_COUNT_ZERO', message: 'The PDF has zero pages.' } }
    }

    if (pageCount > 500) {
      return { isValid: false, pageCount: 0, error: { code: 'PDF_TOO_LARGE', message: `The PDF has too many pages (${pageCount}).` } }
    }

    return {
      isValid: true,
      pageCount
    }
  } catch (err: any) {
    return { isValid: false, pageCount: 0, error: { code: 'PDF_READ_ERROR', message: `Failed to read the PDF: ${err.message}` } }
  }
}
