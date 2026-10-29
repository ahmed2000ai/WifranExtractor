import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { cropItemImage } from './itemImageCropper'
import { normalizeBoundingBox } from '../../shared/utils/boundingBoxNormalization'
import { validateAndClampBoundingBox, padBoundingBox } from './boundingBoxValidator'
import { VALIDATION_CODES } from '../../shared/schemas/validationCodes'
import type {
  ImageCroppingInput,
  ImageCroppingResult,
  ImageCroppingProgressEvent,
  CropRowResult,
  CropRenderedPage
} from '../../shared/types/imageCropping'

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export async function cropImagesForOcrRows(
  input: ImageCroppingInput,
  onProgress?: (event: ImageCroppingProgressEvent) => void
): Promise<ImageCroppingResult> {
  const startedAt = new Date().toISOString()
  const startTimeMs = Date.now()

  if (!input.workspacePath || !existsSync(input.workspacePath)) {
    return {
      ok: false,
      workspacePath: input.workspacePath,
      totalRows: input.rows.length,
      croppedRows: 0,
      skippedRows: 0,
      warningRows: 0,
      errorRows: 0,
      results: [],
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTimeMs,
      error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace path does not exist.' }
    }
  }

  const cropsDir = join(input.workspacePath, 'crops')
  if (!existsSync(cropsDir)) {
    mkdirSync(cropsDir, { recursive: true })
  }

  const pageMap = new Map<number, CropRenderedPage>()
  for (const page of input.renderedPages) {
    pageMap.set(page.pageNumber, page)
  }

  let croppedRows = 0
  let skippedRows = 0
  let warningRows = 0
  let errorRows = 0

  const results: CropRowResult[] = []

  onProgress?.({
    stage: 'started',
    message: `Starting image cropping for ${input.rows.length} rows.`,
    current: 0,
    total: input.rows.length
  })

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i]
    
    const rowResult: CropRowResult = {
      rowId: row.rowId,
      pageNumber: row.pageNumber,
      status: 'error',
      localImagePath: null,
      originalBoundingBox: null,
      normalizedBoundingBox: null,
      paddedBoundingBox: null,
      issues: []
    }

    if (row.status === 'skipped') {
      if (row.skipReason === VALIDATION_CODES.NON_PRODUCT_PROMOTIONAL_AREA) {
        rowResult.status = 'skipped'
        rowResult.issues.push({ severity: 'info', code: VALIDATION_CODES.NON_PRODUCT_PROMOTIONAL_AREA, message: 'Row skipped due to being promotional area.' })
        
        onProgress?.({
          stage: 'row_skipped',
          rowId: row.rowId,
          message: `Skipping ${row.rowId} because it is non-product promotional content.`,
          current: i + 1,
          total: input.rows.length
        })
        skippedRows++
      } else {
        rowResult.status = 'skipped'
        rowResult.issues.push({ severity: 'info', code: 'SKIPPED', message: `Row skipped: ${row.skipReason || 'Unknown reason'}` })
        skippedRows++
      }
      results.push(rowResult)
      continue
    }

    if (row.status === 'error') {
      rowResult.status = 'skipped'
      rowResult.issues.push({ severity: 'error', code: 'ROW_HAS_ERRORS', message: 'Row has blocking validation errors and was not cropped.' })
      errorRows++
      results.push(rowResult)
      continue
    }

    const renderedPage = pageMap.get(row.pageNumber)
    if (!renderedPage || !existsSync(renderedPage.imagePath)) {
      rowResult.status = 'error'
      rowResult.issues.push({ severity: 'error', code: VALIDATION_CODES.PAGE_IMAGE_NOT_FOUND, message: `Rendered image for page ${row.pageNumber} not found.` })
      errorRows++
      results.push(rowResult)
      continue
    }

    const normalizedBox = normalizeBoundingBox(row.boundingBox, renderedPage.width, renderedPage.height)
    rowResult.originalBoundingBox = row.boundingBox as any
    rowResult.normalizedBoundingBox = normalizedBox

    const validation = validateAndClampBoundingBox(normalizedBox, renderedPage.width, renderedPage.height)
    rowResult.issues.push(...validation.issues)

    if (!validation.isValid || !validation.box) {
      if (row.status === 'warning' && !normalizedBox) {
        rowResult.status = 'warning'
        warningRows++
      } else {
        rowResult.status = 'error'
        errorRows++
      }
      results.push(rowResult)
      continue
    }

    const paddedBox = padBoundingBox(validation.box, renderedPage.width, renderedPage.height, input.paddingPercent || 8)
    rowResult.paddedBoundingBox = paddedBox

    const safeRowId = sanitizeFilename(row.rowId)
    const outputPath = join(cropsDir, `page-${String(row.pageNumber).padStart(3, '0')}-item-${safeRowId}.${input.outputFormat || 'jpg'}`)

    onProgress?.({
      stage: 'row_cropping',
      rowId: row.rowId,
      message: `Cropping ${row.rowId}.`,
      current: i + 1,
      total: input.rows.length
    })

    try {
      await cropItemImage({
        pageImagePath: renderedPage.imagePath,
        outputPath,
        cropBox: paddedBox,
        outputFormat: input.outputFormat || 'jpg',
        outputQuality: input.outputQuality || 85
      })

      rowResult.status = 'cropped'
      rowResult.localImagePath = outputPath
      croppedRows++

      onProgress?.({
        stage: 'row_cropped',
        rowId: row.rowId,
        message: `Cropped ${row.rowId} successfully.`,
        current: i + 1,
        total: input.rows.length
      })

    } catch (e: any) {
      rowResult.status = 'error'
      rowResult.issues.push({ severity: 'error', code: VALIDATION_CODES.IMAGE_CROP_FAILED, message: e.message })
      errorRows++

      onProgress?.({
        stage: 'row_failed',
        rowId: row.rowId,
        message: `Cropping failed for ${row.rowId}: ${e.message}`,
        current: i + 1,
        total: input.rows.length
      })
    }

    results.push(rowResult)
  }

  const durationMs = Date.now() - startTimeMs

  const resultPayload: ImageCroppingResult = {
    ok: true,
    workspacePath: input.workspacePath,
    totalRows: input.rows.length,
    croppedRows,
    skippedRows,
    warningRows,
    errorRows,
    results,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs
  }

  try {
    const metaPath = join(input.workspacePath, 'metadata')
    if (!existsSync(metaPath)) {
      mkdirSync(metaPath, { recursive: true })
    }
    writeFileSync(join(metaPath, 'image-cropping-result.json'), JSON.stringify(resultPayload, null, 2))
  } catch (err) {
    // ignore
  }

  onProgress?.({
    stage: 'completed',
    message: `Image cropping completed: ${croppedRows} cropped, ${skippedRows} skipped, ${errorRows} errors.`,
    current: input.rows.length,
    total: input.rows.length
  })

  return resultPayload
}
