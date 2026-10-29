
import { fromPath } from 'pdf2pic'
import sharp from 'sharp'
import type { RenderedPageMetadata } from '../../shared/types/pdfPreprocess'
import { error as logError } from '../logging/logger'
import fs from 'fs'
import path from 'path'

// On Windows, users often install GS and GM but forget to restart their terminal to refresh PATH.
// We dynamically inject their standard installation paths to prevent "All pages failed to render".
if (process.platform === 'win32') {
  try {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    
    // Inject Ghostscript
    const gsDir = path.join(pf, 'gs')
    if (fs.existsSync(gsDir)) {
      const versions = fs.readdirSync(gsDir).filter(f => f.startsWith('gs'))
      if (versions.length > 0) {
        // e.g. C:\Program Files\gs\gs10.07.1\bin
        const latestGsBin = path.join(gsDir, versions[versions.length - 1], 'bin')
        if (fs.existsSync(latestGsBin) && !process.env.PATH?.includes(latestGsBin)) {
          process.env.PATH = `${latestGsBin};${process.env.PATH}`
        }
      }
    }

    // Inject GraphicsMagick
    if (fs.existsSync(pf)) {
      const dirs = fs.readdirSync(pf)
      const gmDirs = dirs.filter(f => f.startsWith('GraphicsMagick'))
      if (gmDirs.length > 0) {
        // e.g. C:\Program Files\GraphicsMagick-1.3.46-Q16
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

export async function renderPdfPages(
  sourcePdfPath: string,
  outputPagesDir: string,
  renderDpi: number,
  pageCount: number,
  onProgress?: (current: number, total: number) => void
): Promise<RenderedPageMetadata[]> {
  const actualDpi = Math.max(100, Math.min(400, renderDpi))
  
  const renderedPages: RenderedPageMetadata[] = []

  // pdf2pic requires Ghostscript and GraphicsMagick installed on the system
  const options = {
    density: actualDpi,
    saveFilename: 'page',
    savePath: outputPagesDir,
    format: 'png',
    width: undefined, // Let it calculate based on density
    height: undefined
  }

  const storeAsImage = fromPath(sourcePdfPath, options)

  for (let i = 1; i <= pageCount; i++) {
    try {
      const result = await storeAsImage(i, { responseType: 'image' })

      if (result && result.path) {
        // Since pdf2pic names it page.1.png, accept its path
        const imagePath = result.path
        
        // Read metadata using sharp
        const metadata = await sharp(imagePath).metadata()

        renderedPages.push({
          pageNumber: i,
          imagePath,
          width: metadata.width || 0,
          height: metadata.height || 0,
          dpi: actualDpi
        })

        if (onProgress) {
          onProgress(i, pageCount)
        }
      }
    } catch (err: any) {
      logError(`Failed to render page ${i}: ${err.message}`)
      // We log but continue with other pages if possible
    }
  }

  if (renderedPages.length === 0) {
    throw new Error('All pages failed to render.')
  }

  return renderedPages
}
