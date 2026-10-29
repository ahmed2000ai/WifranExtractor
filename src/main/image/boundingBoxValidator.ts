import type { CropBoundingBox, CropRowIssue } from '../../shared/types/imageCropping'
import { VALIDATION_CODES } from '../../shared/schemas/validationCodes'

export type ValidationResult = {
  isValid: boolean
  box: CropBoundingBox | null
  issues: CropRowIssue[]
}

export function validateAndClampBoundingBox(
  box: CropBoundingBox | null | undefined,
  pageWidth: number,
  pageHeight: number
): ValidationResult {
  const issues: CropRowIssue[] = []

  if (!box || typeof box.x !== 'number' || typeof box.y !== 'number' || typeof box.width !== 'number' || typeof box.height !== 'number') {
    issues.push({
      severity: 'error',
      code: VALIDATION_CODES.MISSING_BOUNDING_BOX,
      message: 'Bounding box is missing or invalid type.'
    })
    return { isValid: false, box: null, issues }
  }

  if (Number.isNaN(box.x) || Number.isNaN(box.y) || Number.isNaN(box.width) || Number.isNaN(box.height)) {
    issues.push({
      severity: 'error',
      code: VALIDATION_CODES.INVALID_BOUNDING_BOX,
      message: 'Bounding box contains NaN values.'
    })
    return { isValid: false, box: null, issues }
  }

  if (box.width <= 0 || box.height <= 0) {
    issues.push({
      severity: 'error',
      code: VALIDATION_CODES.INVALID_BOUNDING_BOX,
      message: 'Bounding box width or height must be greater than zero.'
    })
    return { isValid: false, box: null, issues }
  }

  // Size Checks
  if (box.width < 40 || box.height < 40) {
    issues.push({
      severity: 'warning',
      code: VALIDATION_CODES.BOUNDING_BOX_TOO_SMALL,
      message: 'Bounding box is extremely small (less than 40px in a dimension).'
    })
  }

  const boxArea = box.width * box.height
  const pageArea = pageWidth * pageHeight
  if (pageArea > 0 && boxArea > pageArea * 0.7) {
    issues.push({
      severity: 'warning',
      code: VALIDATION_CODES.BOUNDING_BOX_TOO_LARGE,
      message: 'Bounding box covers more than 70% of the page area.'
    })
  }

  // Clamping
  let { x, y, width, height } = box
  let isClamped = false

  if (x < 0) {
    width = Math.max(1, width + x)
    x = 0
    isClamped = true
  }

  if (y < 0) {
    height = Math.max(1, height + y)
    y = 0
    isClamped = true
  }

  if (x + width > pageWidth) {
    width = Math.max(1, pageWidth - x)
    isClamped = true
  }

  if (y + height > pageHeight) {
    height = Math.max(1, pageHeight - y)
    isClamped = true
  }

  if (x >= pageWidth || y >= pageHeight) {
    issues.push({
      severity: 'error',
      code: VALIDATION_CODES.BOUNDING_BOX_OUT_OF_PAGE,
      message: 'Bounding box is entirely outside the page bounds.'
    })
    return { isValid: false, box: null, issues }
  }

  if (isClamped) {
    issues.push({
      severity: 'warning',
      code: VALIDATION_CODES.BOUNDING_BOX_CLAMPED,
      message: 'Bounding box was clamped to fit within page dimensions.'
    })
  }

  return {
    isValid: true,
    box: { x, y, width, height },
    issues
  }
}

export function padBoundingBox(
  box: CropBoundingBox,
  pageWidth: number,
  pageHeight: number,
  paddingPercent: number
): CropBoundingBox {
  const clampedPadding = Math.max(0, Math.min(15, paddingPercent))
  const padX = Math.round(box.width * (clampedPadding / 100))
  const padY = Math.round(box.height * (clampedPadding / 100))

  let newX = box.x - padX
  let newY = box.y - padY
  let newWidth = box.width + (padX * 2)
  let newHeight = box.height + (padY * 2)

  if (newX < 0) {
    newWidth += newX // newX is negative
    newX = 0
  }
  if (newY < 0) {
    newHeight += newY // newY is negative
    newY = 0
  }
  if (newX + newWidth > pageWidth) {
    newWidth = pageWidth - newX
  }
  if (newY + newHeight > pageHeight) {
    newHeight = pageHeight - newY
  }

  return {
    x: Math.round(newX),
    y: Math.round(newY),
    width: Math.round(newWidth),
    height: Math.round(newHeight)
  }
}
