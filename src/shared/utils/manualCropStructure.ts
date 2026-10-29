import { ManualCropPageLayout, ManualCropRow, ManualCropColumn } from '../types/manualCrop'

export function getIncludedRowCount(layout: ManualCropPageLayout): number {
  if (!layout.rows) return 0
  return layout.rows.filter(r => r.boxIds.some(id => {
    const b = layout.boxes.find(box => box.id === id)
    return b && b.included
  })).length
}

export function getIncludedColumnCount(layout: ManualCropPageLayout): number {
  if (!layout.columns) return 0
  return layout.columns.filter(c => c.boxIds.some(id => {
    const b = layout.boxes.find(box => box.id === id)
    return b && b.included
  })).length
}

export function getIncludedBoxCountInRow(layout: ManualCropPageLayout, rowId: string): number {
  const row = layout.rows?.find(r => r.id === rowId)
  if (!row) return 0
  return row.boxIds.filter(id => {
    const b = layout.boxes.find(box => box.id === id)
    return b && b.included
  }).length
}

export function getIncludedBoxCountInColumn(layout: ManualCropPageLayout, columnId: string): number {
  const col = layout.columns?.find(c => c.id === columnId)
  if (!col) return 0
  return col.boxIds.filter(id => {
    const b = layout.boxes.find(box => box.id === id)
    return b && b.included
  }).length
}

export function rebuildLayoutStructureFromBoxes(layout: ManualCropPageLayout): ManualCropPageLayout {
  const newLayout = { ...layout }
  
  // Create rows based on Y proximity
  const sortedByY = [...newLayout.boxes].sort((a, b) => a.y - b.y)
  const rows: ManualCropRow[] = []
  
  sortedByY.forEach(box => {
    // Find a row where the box fits (y center falls within row's y range or close)
    let matchedRow = rows.find(r => {
      const firstBox = newLayout.boxes.find(b => b.id === r.boxIds[0])
      if (!firstBox) return false
      // A box belongs to a row if their Y positions are within 20px of each other
      return Math.abs(firstBox.y - box.y) < 20
    })
    
    if (!matchedRow) {
      matchedRow = {
        id: `row-${Math.random().toString(36).substring(2, 9)}`,
        order: rows.length,
        boxIds: []
      }
      rows.push(matchedRow)
    }
    
    matchedRow.boxIds.push(box.id)
    box.rowId = matchedRow.id
  })
  
  // Sort rows by Y
  rows.sort((a, b) => {
    const boxA = newLayout.boxes.find(bx => bx.id === a.boxIds[0])
    const boxB = newLayout.boxes.find(bx => bx.id === b.boxIds[0])
    return (boxA?.y || 0) - (boxB?.y || 0)
  })
  rows.forEach((r, i) => r.order = i)
  
  // Create columns based on X proximity
  const sortedByX = [...newLayout.boxes].sort((a, b) => a.x - b.x)
  const columns: ManualCropColumn[] = []
  
  sortedByX.forEach(box => {
    let matchedCol = columns.find(c => {
      const firstBox = newLayout.boxes.find(b => b.id === c.boxIds[0])
      if (!firstBox) return false
      // A box belongs to a column if their X positions are within 20px of each other
      return Math.abs(firstBox.x - box.x) < 20
    })
    
    if (!matchedCol) {
      matchedCol = {
        id: `col-${Math.random().toString(36).substring(2, 9)}`,
        order: columns.length,
        boxIds: []
      }
      columns.push(matchedCol)
    }
    
    matchedCol.boxIds.push(box.id)
    box.columnId = matchedCol.id
  })
  
  // Sort columns by X
  columns.sort((a, b) => {
    const boxA = newLayout.boxes.find(bx => bx.id === a.boxIds[0])
    const boxB = newLayout.boxes.find(bx => bx.id === b.boxIds[0])
    return (boxA?.x || 0) - (boxB?.x || 0)
  })
  columns.forEach((c, i) => c.order = i)
  
  newLayout.rows = rows
  newLayout.columns = columns
  
  return newLayout
}
