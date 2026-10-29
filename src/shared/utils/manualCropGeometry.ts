import { ManualCropPageLayout, ManualCropBox } from '../types/manualCrop'
import { renumberManualCropBoxes } from './manualCropOrdering'
import { rebuildLayoutStructureFromBoxes } from './manualCropStructure'

export function createInitialGridLayout(input: {
  pageNumber: number;
  pageImagePath: string;
  pageWidth: number;
  pageHeight: number;
  rows: number;
  columns: number;
  topMargin?: number;
  bottomMargin?: number;
  leftMargin?: number;
  rightMargin?: number;
}): ManualCropPageLayout {
  const {
    pageNumber,
    pageImagePath,
    pageWidth,
    pageHeight,
    rows,
    columns,
    topMargin = 0,
    bottomMargin = 0,
    leftMargin = 0,
    rightMargin = 0
  } = input

  const usableWidth = pageWidth - leftMargin - rightMargin
  const usableHeight = pageHeight - topMargin - bottomMargin

  const cellWidth = usableWidth / columns
  const cellHeight = usableHeight / rows

  const rowLines: number[] = []
  for (let i = 1; i < rows; i++) {
    rowLines.push(topMargin + i * cellHeight)
  }

  const columnLines: number[] = []
  for (let j = 1; j < columns; j++) {
    columnLines.push(leftMargin + j * cellWidth)
  }

  let boxes: ManualCropBox[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      boxes.push({
        id: `box-p${pageNumber}-r${r}-c${c}-${Math.random().toString(36).substring(2, 9)}`,
        pageNumber,
        itemNumber: '',
        x: leftMargin + c * cellWidth,
        y: topMargin + r * cellHeight,
        width: cellWidth,
        height: cellHeight,
        included: true,
        rowId: '', // To be filled by rebuild
        columnId: '', // To be filled by rebuild
        createdFromGrid: true,
        linkedRowIndex: r, // top row line index
        linkedColumnIndex: c // left column line index
      })
    }
  }

  boxes = renumberManualCropBoxes(boxes)

  let initialLayout: ManualCropPageLayout = {
    pageNumber,
    pageImagePath,
    pageWidth,
    pageHeight,
    gridRows: rows,
    gridColumns: columns,
    rowLines,
    columnLines,
    boxes,
    updatedAt: new Date().toISOString()
  }

  return rebuildLayoutStructureFromBoxes(initialLayout)
}
