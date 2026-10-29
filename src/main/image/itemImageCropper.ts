import sharp from 'sharp'
import { dirname } from 'path'
import { mkdirSync } from 'fs'
import type { CropBoundingBox } from '../../shared/types/imageCropping'

export async function cropItemImage(input: {
  pageImagePath: string
  outputPath: string
  cropBox: CropBoundingBox
  outputFormat: 'jpg' | 'png' | 'webp'
  outputQuality: number
}): Promise<void> {
  const { pageImagePath, outputPath, cropBox, outputFormat, outputQuality } = input

  if (cropBox.width <= 0 || cropBox.height <= 0) {
    throw new Error('IMAGE_CROP_FAILED: Invalid dimensions for cropping.')
  }

  try {
    const dir = dirname(outputPath)
    mkdirSync(dir, { recursive: true })

    const image = sharp(pageImagePath)
    
    // We must ensure the extracted area is bounded by integer coordinates
    const left = Math.round(cropBox.x)
    const top = Math.round(cropBox.y)
    const width = Math.round(cropBox.width)
    const height = Math.round(cropBox.height)

    image.extract({ left, top, width, height })

    if (outputFormat === 'jpg') {
      image.jpeg({ quality: outputQuality })
    } else if (outputFormat === 'png') {
      image.png({ quality: outputQuality })
    } else if (outputFormat === 'webp') {
      image.webp({ quality: outputQuality })
    }

    await image.toFile(outputPath)
  } catch (error: any) {
    throw new Error(`IMAGE_CROP_FAILED: ${error.message}`)
  }
}
