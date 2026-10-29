import { ManualCropPageLayout, ManualCropResult } from '../../shared/types/manualCrop'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import { info as logInfo, error as logError, warn as logWarn } from '../logging/logger'

export async function cropManualPageLayout(input: {
  layout: ManualCropPageLayout;
  outputDir: string;
  imageFormat: 'webp' | 'jpg' | 'jpeg' | 'png';
  quality: number;
  pdfBaseName: string;
}): Promise<ManualCropResult> {
  const { layout, outputDir, imageFormat, quality, pdfBaseName } = input
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const result: ManualCropResult = {
    ok: true,
    pageNumber: layout.pageNumber,
    totalBoxes: layout.boxes.length,
    includedBoxes: 0,
    skippedBoxes: 0,
    croppedImages: []
  }

  if (!fs.existsSync(layout.pageImagePath)) {
    result.ok = false
    result.error = { code: 'MANUAL_CROP_PAGE_IMAGE_MISSING', message: `Page image not found: ${layout.pageImagePath}` }
    return result
  }

  try {
    const pageImage = sharp(layout.pageImagePath)
    const metadata = await pageImage.metadata()
    
    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read image dimensions')
    }

    for (const box of layout.boxes) {
      if (!box.included) {
        result.skippedBoxes++
        continue
      }
      result.includedBoxes++

      // Strict bounds check instead of clamping
      if (box.x < 0 || box.y < 0 || box.x + box.width > metadata.width || box.y + box.height > metadata.height) {
        logError(`Box extends outside page ${layout.pageNumber} item ${box.itemNumber}`)
        result.error = { code: 'MANUAL_CROP_BOX_OUT_OF_PAGE', message: `Item ${box.itemNumber} extends outside the page` }
        result.ok = false // mark overall as failed or warning?
        continue
      }

      const x = Math.floor(box.x)
      const y = Math.floor(box.y)
      const width = Math.floor(box.width)
      const height = Math.floor(box.height)

      if (width < 10 || height < 10) {
        logWarn(`Box too small to crop for page ${layout.pageNumber} item ${box.itemNumber}: ${width}x${height}`)
        result.error = { code: 'MANUAL_CROP_BOX_TOO_SMALL', message: `Item ${box.itemNumber} is too small` }
        result.ok = false
        continue
      }

      const pageSubDir = path.join(outputDir, `page-${String(layout.pageNumber).padStart(3, '0')}`)
      if (!fs.existsSync(pageSubDir)) {
        fs.mkdirSync(pageSubDir, { recursive: true })
      }

      const pageStr = String(layout.pageNumber).padStart(3, '0')
      const itemStr = String(box.itemNumber).padStart(3, '0')
      const fileName = `${pdfBaseName}_${pageStr}_${itemStr}.${imageFormat}`
      const outPath = path.join(pageSubDir, fileName)

      const cropPipeline = sharp(layout.pageImagePath).extract({ left: x, top: y, width, height })
      
      if (imageFormat === 'webp') {
        cropPipeline.webp({ quality })
      } else if (imageFormat === 'jpg' || imageFormat === 'jpeg') {
        cropPipeline.jpeg({ quality })
      } else if (imageFormat === 'png') {
        cropPipeline.png()
      }

      await cropPipeline.toFile(outPath)

      result.croppedImages.push({
        itemNumber: box.itemNumber,
        pageNumber: layout.pageNumber,
        cropPath: outPath,
        x,
        y,
        width,
        height
      })
    }
    
    logInfo(`Manual crop completed for page ${layout.pageNumber}: ${result.croppedImages.length} images saved`)
    
  } catch (err: any) {
    logError(`Manual crop failed for page ${layout.pageNumber}: ${err.message}`)
    result.ok = false
    result.error = { code: 'MANUAL_CROP_OUTPUT_FAILED', message: err.message }
  }

  return result
}
