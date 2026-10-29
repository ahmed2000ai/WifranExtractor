import { ManualCropPageLayout, ManualCropBox } from '../types/manualCrop'
import { rebuildLayoutStructureFromBoxes } from './manualCropStructure'
import { renumberManualCropBoxes } from './manualCropOrdering'

export function calculateDefaultGridSizeFromTemplateBox(input: {
  pageWidth: number;
  pageHeight: number;
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  minRows?: number;
  maxRows?: number;
  minColumns?: number;
  maxColumns?: number;
}): {
  rows: number;
  columns: number;
  boxesLeft: number;
  boxesRight: number;
  boxesAbove: number;
  boxesBelow: number;
  leftoverMargins: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
} {
  const {
    pageWidth, pageHeight, boxX, boxY, boxWidth, boxHeight,
    minRows = 1, maxRows = 20, minColumns = 1, maxColumns = 20
  } = input

  if (!pageWidth || !pageHeight || !boxWidth || !boxHeight) {
    throw new Error('Invalid dimensions provided for grid calculation')
  }

  const leftSpace = Math.max(0, boxX)
  const rightSpace = Math.max(0, pageWidth - (boxX + boxWidth))
  const topSpace = Math.max(0, boxY)
  const bottomSpace = Math.max(0, pageHeight - (boxY + boxHeight))

  const boxesLeft = Math.floor(leftSpace / boxWidth)
  const boxesRight = Math.floor(rightSpace / boxWidth)
  const boxesAbove = Math.floor(topSpace / boxHeight)
  const boxesBelow = Math.floor(bottomSpace / boxHeight)

  let columns = boxesLeft + 1 + boxesRight
  let rows = boxesAbove + 1 + boxesBelow

  columns = Math.min(Math.max(columns, minColumns), maxColumns)
  rows = Math.min(Math.max(rows, minRows), maxRows)

  const leftoverLeft = leftSpace - boxesLeft * boxWidth
  const leftoverRight = rightSpace - boxesRight * boxWidth
  const leftoverTop = topSpace - boxesAbove * boxHeight
  const leftoverBottom = bottomSpace - boxesBelow * boxHeight

  return {
    rows,
    columns,
    boxesLeft,
    boxesRight,
    boxesAbove,
    boxesBelow,
    leftoverMargins: {
      left: leftoverLeft,
      right: leftoverRight,
      top: leftoverTop,
      bottom: leftoverBottom
    }
  }
}

export function generateGridFromTemplateBox(input: {
  layout: ManualCropPageLayout;
  selectedBoxId: string;
  rows: number;
  columns: number;
}): ManualCropPageLayout {
  const { layout, selectedBoxId, rows, columns } = input
  const selectedBox = layout.boxes.find(b => b.id === selectedBoxId)
  if (!selectedBox) throw new Error('Selected box not found')

  const { width, height } = selectedBox
  let bestAnchorRow = 0
  let bestAnchorCol = 0
  let bestOverflow = Infinity
  let bestScore = -Infinity // For tie-breaking

  // Find best anchor position (which cell in the new grid the selected box occupies)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const startX = selectedBox.x - c * width
      const startY = selectedBox.y - r * height
      const endX = startX + columns * width
      const endY = startY + rows * height

      const overflowLeft = Math.max(0, -startX)
      const overflowTop = Math.max(0, -startY)
      const overflowRight = Math.max(0, endX - layout.pageWidth)
      const overflowBottom = Math.max(0, endY - layout.pageHeight)
      const totalOverflow = overflowLeft + overflowTop + overflowRight + overflowBottom

      // Score for balanced placement when overflow is identical (e.g., both 0)
      // We want the box to expand into available space.
      // If there's more space to the right, we want the anchor column to be smaller (i.e. more generated boxes to the right).
      const spaceRight = layout.pageWidth - (selectedBox.x + width)
      const spaceLeft = selectedBox.x
      const spaceBottom = layout.pageHeight - (selectedBox.y + height)
      const spaceTop = selectedBox.y
      
      const boxesToRight = columns - 1 - c
      const boxesToLeft = c
      const boxesBelow = rows - 1 - r
      const boxesAbove = r
      
      // A simple heuristic: try to distribute boxes proportionally to available space
      const expectedBoxesRight = (spaceRight / (spaceRight + spaceLeft || 1)) * (columns - 1)
      const expectedBoxesLeft = (spaceLeft / (spaceRight + spaceLeft || 1)) * (columns - 1)
      const expectedBoxesBelow = (spaceBottom / (spaceBottom + spaceTop || 1)) * (rows - 1)
      const expectedBoxesAbove = (spaceTop / (spaceBottom + spaceTop || 1)) * (rows - 1)

      const score = -Math.abs(boxesToRight - expectedBoxesRight) 
                    -Math.abs(boxesToLeft - expectedBoxesLeft)
                    -Math.abs(boxesBelow - expectedBoxesBelow)
                    -Math.abs(boxesAbove - expectedBoxesAbove)

      if (totalOverflow < bestOverflow || (totalOverflow === bestOverflow && score > bestScore)) {
        bestOverflow = totalOverflow
        bestScore = score
        bestAnchorRow = r
        bestAnchorCol = c
      }
    }
  }

  // Generate new boxes
  const startX = selectedBox.x - bestAnchorCol * width
  const startY = selectedBox.y - bestAnchorRow * height

  let newBoxes: ManualCropBox[] = [selectedBox]

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      if (r === bestAnchorRow && c === bestAnchorCol) continue // Skip the selected box

      newBoxes.push({
        id: `box-gen-grid-${Math.random().toString(36).substring(2, 9)}`,
        pageNumber: layout.pageNumber,
        itemNumber: '',
        x: startX + c * width,
        y: startY + r * height,
        width,
        height,
        included: true,
        rowId: '',
        columnId: '',
        createdFromGrid: true
      })
    }
  }

  // Rebuild structure with ONLY the new boxes (removes all other previous boxes)
  let newLayout = { ...layout, boxes: newBoxes }
  newLayout = rebuildLayoutStructureFromBoxes(newLayout)
  newLayout.boxes = renumberManualCropBoxes(newLayout.boxes)
  return newLayout
}

export function generateRowFromTemplateBox(input: {
  layout: ManualCropPageLayout;
  selectedBoxId: string;
  columns: number;
}): ManualCropPageLayout {
  const { layout, selectedBoxId, columns } = input
  const selectedBox = layout.boxes.find(b => b.id === selectedBoxId)
  if (!selectedBox) throw new Error('Selected box not found')

  const { width } = selectedBox
  let bestAnchorCol = 0
  let bestOverflow = Infinity
  let bestScore = -Infinity

  for (let c = 0; c < columns; c++) {
    const startX = selectedBox.x - c * width
    const endX = startX + columns * width

    const overflowLeft = Math.max(0, -startX)
    const overflowRight = Math.max(0, endX - layout.pageWidth)
    const totalOverflow = overflowLeft + overflowRight

    const spaceRight = layout.pageWidth - (selectedBox.x + width)
    const spaceLeft = selectedBox.x
    
    const boxesToRight = columns - 1 - c
    const boxesToLeft = c
    
    const expectedBoxesRight = (spaceRight / (spaceRight + spaceLeft || 1)) * (columns - 1)
    const expectedBoxesLeft = (spaceLeft / (spaceRight + spaceLeft || 1)) * (columns - 1)

    const score = -Math.abs(boxesToRight - expectedBoxesRight) - Math.abs(boxesToLeft - expectedBoxesLeft)

    if (totalOverflow < bestOverflow || (totalOverflow === bestOverflow && score > bestScore)) {
      bestOverflow = totalOverflow
      bestScore = score
      bestAnchorCol = c
    }
  }

  const startX = selectedBox.x - bestAnchorCol * width
  
  // Keep boxes OUTSIDE the selected box's row unchanged
  const rowBoxIds = layout.rows?.find(r => r.id === selectedBox.rowId)?.boxIds || []
  const boxesToKeep = layout.boxes.filter(b => !rowBoxIds.includes(b.id) && b.id !== selectedBoxId)
  
  let newBoxes: ManualCropBox[] = [...boxesToKeep, selectedBox]

  for (let c = 0; c < columns; c++) {
    if (c === bestAnchorCol) continue

    newBoxes.push({
      id: `box-gen-row-${Math.random().toString(36).substring(2, 9)}`,
      pageNumber: layout.pageNumber,
      itemNumber: '',
      x: startX + c * width,
      y: selectedBox.y,
      width,
      height: selectedBox.height,
      included: true,
      rowId: '',
      columnId: '',
      createdFromGrid: true
    })
  }

  let newLayout = { ...layout, boxes: newBoxes }
  newLayout = rebuildLayoutStructureFromBoxes(newLayout)
  newLayout.boxes = renumberManualCropBoxes(newLayout.boxes)
  return newLayout
}

export function generateColumnFromTemplateBox(input: {
  layout: ManualCropPageLayout;
  selectedBoxId: string;
  rows: number;
}): ManualCropPageLayout {
  const { layout, selectedBoxId, rows } = input
  const selectedBox = layout.boxes.find(b => b.id === selectedBoxId)
  if (!selectedBox) throw new Error('Selected box not found')

  const { height } = selectedBox
  let bestAnchorRow = 0
  let bestOverflow = Infinity
  let bestScore = -Infinity

  for (let r = 0; r < rows; r++) {
    const startY = selectedBox.y - r * height
    const endY = startY + rows * height

    const overflowTop = Math.max(0, -startY)
    const overflowBottom = Math.max(0, endY - layout.pageHeight)
    const totalOverflow = overflowTop + overflowBottom

    const spaceBottom = layout.pageHeight - (selectedBox.y + height)
    const spaceTop = selectedBox.y
    
    const boxesBelow = rows - 1 - r
    const boxesAbove = r
    
    const expectedBoxesBelow = (spaceBottom / (spaceBottom + spaceTop || 1)) * (rows - 1)
    const expectedBoxesAbove = (spaceTop / (spaceBottom + spaceTop || 1)) * (rows - 1)

    const score = -Math.abs(boxesBelow - expectedBoxesBelow) - Math.abs(boxesAbove - expectedBoxesAbove)

    if (totalOverflow < bestOverflow || (totalOverflow === bestOverflow && score > bestScore)) {
      bestOverflow = totalOverflow
      bestScore = score
      bestAnchorRow = r
    }
  }

  const startY = selectedBox.y - bestAnchorRow * height
  
  // Keep boxes OUTSIDE the selected box's column unchanged
  const colBoxIds = layout.columns?.find(c => c.id === selectedBox.columnId)?.boxIds || []
  const boxesToKeep = layout.boxes.filter(b => !colBoxIds.includes(b.id) && b.id !== selectedBoxId)
  
  let newBoxes: ManualCropBox[] = [...boxesToKeep, selectedBox]

  for (let r = 0; r < rows; r++) {
    if (r === bestAnchorRow) continue

    newBoxes.push({
      id: `box-gen-col-${Math.random().toString(36).substring(2, 9)}`,
      pageNumber: layout.pageNumber,
      itemNumber: '',
      x: selectedBox.x,
      y: startY + r * height,
      width: selectedBox.width,
      height,
      included: true,
      rowId: '',
      columnId: '',
      createdFromGrid: true
    })
  }

  let newLayout = { ...layout, boxes: newBoxes }
  newLayout = rebuildLayoutStructureFromBoxes(newLayout)
  newLayout.boxes = renumberManualCropBoxes(newLayout.boxes)
  return newLayout
}
