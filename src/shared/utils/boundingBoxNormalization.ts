import type { CropBoundingBox } from '../types/imageCropping'

export function normalizeBoundingBox(
  input: any,
  pageWidth: number,
  pageHeight: number
): CropBoundingBox | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  let x: number | undefined
  let y: number | undefined
  let width: number | undefined
  let height: number | undefined

  // 1. Already normalized pixel box
  if ('x' in input && 'y' in input && 'width' in input && 'height' in input) {
    x = Number(input.x)
    y = Number(input.y)
    width = Number(input.width)
    height = Number(input.height)
  }
  // 2. Top-left and bottom-right (snake_case)
  else if ('top_left_x' in input && 'top_left_y' in input && 'bottom_right_x' in input && 'bottom_right_y' in input) {
    x = Number(input.top_left_x)
    y = Number(input.top_left_y)
    width = Number(input.bottom_right_x) - x
    height = Number(input.bottom_right_y) - y
  }
  // 3. Top-left and bottom-right (camelCase)
  else if ('topLeftX' in input && 'topLeftY' in input && 'bottomRightX' in input && 'bottomRightY' in input) {
    x = Number(input.topLeftX)
    y = Number(input.topLeftY)
    width = Number(input.bottomRightX) - x
    height = Number(input.bottomRightY) - y
  }
  // 4. Polygon
  else if (Array.isArray(input.polygon) && input.polygon.length >= 3) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const pt of input.polygon) {
      if (typeof pt.x === 'number' && typeof pt.y === 'number') {
        minX = Math.min(minX, pt.x)
        minY = Math.min(minY, pt.y)
        maxX = Math.max(maxX, pt.x)
        maxY = Math.max(maxY, pt.y)
      }
    }

    if (minX !== Infinity && minY !== Infinity && maxX !== -Infinity && maxY !== -Infinity) {
      x = minX
      y = minY
      width = maxX - minX
      height = maxY - minY
    }
  }

  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return null
  }

  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(width) || Number.isNaN(height)) {
    return null
  }

  // Handle 0-to-1 normalized coordinates
  if (width > 0 && width <= 1 && height > 0 && height <= 1 && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
    // Looks like percentage based bounding box
    x = x * pageWidth
    y = y * pageHeight
    width = width * pageWidth
    height = height * pageHeight
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

export function isLikelyNormalizedBox(box: CropBoundingBox): boolean {
  if (!box) return false
  return (
    typeof box.x === 'number' &&
    typeof box.y === 'number' &&
    typeof box.width === 'number' &&
    typeof box.height === 'number' &&
    !Number.isNaN(box.x) &&
    !Number.isNaN(box.y) &&
    !Number.isNaN(box.width) &&
    !Number.isNaN(box.height)
  )
}
