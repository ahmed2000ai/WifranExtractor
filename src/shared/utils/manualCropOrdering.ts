import { ManualCropBox } from '../types/manualCrop'

/**
 * Renumbers an array of crop boxes sequentially from top-to-bottom, left-to-right.
 * Only included boxes get a number; excluded boxes retain their id or get null itemNumber.
 */
export function renumberManualCropBoxes(boxes: ManualCropBox[]): ManualCropBox[] {
  // Sort boxes spatially: top-to-bottom, left-to-right
  const sortedBoxes = [...boxes].sort((a, b) => {
    // If y differs by more than 20 pixels, sort by Y
    if (Math.abs(a.y - b.y) > 20) {
      return a.y - b.y
    }
    // Otherwise sort by X
    return a.x - b.x
  })

  let counter = 1
  return sortedBoxes.map(box => {
    if (!box.included) {
      return { ...box, itemNumber: '' }
    }
    const itemNumber = String(counter++).padStart(3, '0')
    return { ...box, itemNumber }
  })
}
