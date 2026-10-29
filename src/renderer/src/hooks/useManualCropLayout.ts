import { useState, useCallback } from 'react'
import { ManualCropPageLayout, ManualCropBox } from '../../../shared/types/manualCrop'
import { renumberManualCropBoxes } from '../../../shared/utils/manualCropOrdering'
import { createInitialGridLayout } from '../../../shared/utils/manualCropGeometry'
import { rebuildLayoutStructureFromBoxes } from '../../../shared/utils/manualCropStructure'

export function useManualCropLayout(initialLayout: ManualCropPageLayout) {
  const [layout, setLayout] = useState<ManualCropPageLayout>(initialLayout)
  const [selectedBoxIds, setSelectedBoxIds] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<ManualCropPageLayout[]>([initialLayout])
  const [historyIndex, setHistoryIndex] = useState(0)

  const pushHistory = useCallback((newLayout: ManualCropPageLayout, isStatusUpdate = false) => {
    let finalLayout = newLayout
    if (!isStatusUpdate && finalLayout.cropStatus && finalLayout.cropStatus !== 'not_started' && finalLayout.cropStatus !== 'stale') {
      finalLayout = { ...finalLayout, cropStatus: 'stale' }
    }
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(finalLayout)
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
    setLayout(finalLayout)
  }, [history, historyIndex])

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1)
      setLayout(history[historyIndex - 1])
    }
  }, [history, historyIndex])

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1)
      setLayout(history[historyIndex + 1])
    }
  }, [history, historyIndex])

  const toggleBoxSelection = useCallback((id: string, multi: boolean) => {
    setSelectedBoxIds(prev => {
      const next = new Set(multi ? prev : [])
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectBoxesInRect = useCallback((rect: { x: number, y: number, width: number, height: number }, mode: 'replace' | 'add' | 'toggle' = 'replace') => {
    const rx2 = rect.x + rect.width
    const ry2 = rect.y + rect.height
    
    setSelectedBoxIds(prev => {
      const next = mode === 'replace' ? new Set<string>() : new Set(prev)
      layout.boxes.forEach(box => {
        const bx2 = box.x + box.width
        const by2 = box.y + box.height
        // Box must be FULLY inside the rectangle
        if (box.x >= rect.x && bx2 <= rx2 && box.y >= rect.y && by2 <= ry2) {
          if (mode === 'toggle') {
            if (next.has(box.id)) next.delete(box.id)
            else next.add(box.id)
          } else {
            next.add(box.id)
          }
        }
      })
      return next
    })
  }, [layout.boxes])

  const selectAllBoxes = useCallback(() => {
    setSelectedBoxIds(new Set(layout.boxes.filter(b => b.included).map(b => b.id)))
  }, [layout.boxes])

  const clearSelection = useCallback(() => {
    setSelectedBoxIds(new Set())
  }, [])

  const setSelectedBoxIdsList = useCallback((ids: string[]) => {
    setSelectedBoxIds(new Set(ids))
  }, [])

  const updateBoxes = useCallback((updates: Partial<ManualCropBox>[]) => {
    const newBoxes = [...layout.boxes]
    let changed = false
    updates.forEach(u => {
      const idx = newBoxes.findIndex(b => b.id === u.id)
      if (idx !== -1) {
        newBoxes[idx] = { ...newBoxes[idx], ...u, linkedRowIndex: null, linkedColumnIndex: null }
        changed = true
      }
    })
    if (changed) {
      let newLayout = { ...layout, boxes: newBoxes, updatedAt: new Date().toISOString() }
      newLayout = rebuildLayoutStructureFromBoxes(newLayout)
      pushHistory(newLayout)
    }
  }, [layout, pushHistory])

  const moveSelectedBoxes = useCallback((dx: number, dy: number) => {
    const updates = Array.from(selectedBoxIds).map(id => {
      const box = layout.boxes.find(b => b.id === id)
      if (!box) return null
      return { id, x: box.x + dx, y: box.y + dy }
    }).filter(Boolean) as Partial<ManualCropBox>[]
    
    if (updates.length > 0) {
      updateBoxes(updates)
    }
  }, [selectedBoxIds, layout.boxes, updateBoxes])

  const resizeSelectedBoxes = useCallback((edges: { top?: number, right?: number, bottom?: number, left?: number }) => {
    const updates = Array.from(selectedBoxIds).map(id => {
      const box = layout.boxes.find(b => b.id === id)
      if (!box) return null
      return {
        id,
        x: edges.left !== undefined ? box.x + edges.left : box.x,
        y: edges.top !== undefined ? box.y + edges.top : box.y,
        width: Math.max(10, box.width + (edges.right || 0) - (edges.left || 0)),
        height: Math.max(10, box.height + (edges.bottom || 0) - (edges.top || 0))
      }
    }).filter(Boolean) as Partial<ManualCropBox>[]
    
    if (updates.length > 0) {
      updateBoxes(updates)
    }
  }, [selectedBoxIds, layout.boxes, updateBoxes])

  const setIncluded = useCallback((ids: string[], included: boolean) => {
    const updates = ids.map(id => ({ id, included }))
    updateBoxes(updates)
  }, [updateBoxes])

  const deleteSelected = useCallback(() => {
    if (selectedBoxIds.size === 0) return
    const newBoxes = layout.boxes.filter(b => !selectedBoxIds.has(b.id))
    let newLayout = { ...layout, boxes: newBoxes, updatedAt: new Date().toISOString() }
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    newLayout.boxes = renumberManualCropBoxes(newLayout.boxes)
    pushHistory(newLayout)
    setSelectedBoxIds(new Set())
  }, [selectedBoxIds, layout, pushHistory])
  
  const deleteBox = useCallback((id: string) => {
    const newBoxes = layout.boxes.filter(b => b.id !== id)
    let newLayout = { ...layout, boxes: newBoxes, updatedAt: new Date().toISOString() }
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    newLayout.boxes = renumberManualCropBoxes(newLayout.boxes)
    pushHistory(newLayout)
    if (selectedBoxIds.has(id)) {
      const newSelection = new Set(selectedBoxIds)
      newSelection.delete(id)
      setSelectedBoxIds(newSelection)
    }
  }, [layout, pushHistory, selectedBoxIds])

  const addBox = useCallback((x: number, y: number, width: number, height: number) => {
    const newBox: ManualCropBox = {
      id: `box-m-${Math.random().toString(36).substring(2, 9)}`,
      pageNumber: layout.pageNumber,
      itemNumber: '',
      x, y, width, height,
      included: true,
      rowId: '',
      columnId: ''
    }
    const newBoxes = [...layout.boxes, newBox]
    let newLayout = { ...layout, boxes: newBoxes, updatedAt: new Date().toISOString() }
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    pushHistory(newLayout)
    setSelectedBoxIds(new Set([newBox.id]))
  }, [layout, pushHistory])

  const cloneSelectedBoxes = useCallback((dx: number, dy: number) => {
    if (selectedBoxIds.size === 0) return

    const newBoxes = [...layout.boxes]
    const newSelection = new Set<string>()

    selectedBoxIds.forEach(id => {
      const box = layout.boxes.find(b => b.id === id)
      if (!box) return
      
      const newBoxId = `box-clone-${Math.random().toString(36).substring(2, 9)}`
      const newBox: ManualCropBox = {
        ...box,
        id: newBoxId,
        x: box.x + dx,
        y: box.y + dy,
        // Reset derived states per Prompt Chunk 67
        itemNumber: '',
        provenance: 'ctrl_drag_clone' as const
      }
      
      newBoxes.push(newBox)
      newSelection.add(newBoxId)
    })

    let newLayout = { ...layout, boxes: newBoxes, updatedAt: new Date().toISOString() }
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    newLayout.boxes = renumberManualCropBoxes(newLayout.boxes)
    pushHistory(newLayout)
    setSelectedBoxIds(newSelection)
  }, [selectedBoxIds, layout, pushHistory])

  const mergeSelected = useCallback(() => {
    if (selectedBoxIds.size < 2) return

    const boxes = Array.from(selectedBoxIds).map(id => layout.boxes.find(b => b.id === id)).filter(Boolean) as ManualCropBox[]
    
    const minX = Math.min(...boxes.map(b => b.x))
    const minY = Math.min(...boxes.map(b => b.y))
    const maxX = Math.max(...boxes.map(b => b.x + b.width))
    const maxY = Math.max(...boxes.map(b => b.y + b.height))

    const newBox: ManualCropBox = {
      id: `box-merged-${Math.random().toString(36).substring(2, 9)}`,
      pageNumber: layout.pageNumber,
      itemNumber: '',
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      included: true,
      rowId: '',
      columnId: ''
    }

    const newBoxes = layout.boxes.filter(b => !selectedBoxIds.has(b.id))
    newBoxes.push(newBox)
    
    let newLayout = { ...layout, boxes: newBoxes, updatedAt: new Date().toISOString() }
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    pushHistory(newLayout)
    setSelectedBoxIds(new Set([newBox.id]))
  }, [selectedBoxIds, layout, pushHistory])

  const splitSelected = useCallback((orientation: 'horizontal' | 'vertical') => {
    if (selectedBoxIds.size === 0) return

    let newBoxes = [...layout.boxes]
    const newSelection = new Set<string>()

    selectedBoxIds.forEach(id => {
      const box = newBoxes.find(b => b.id === id)
      if (!box) return
      
      // Remove original box
      newBoxes = newBoxes.filter(b => b.id !== id)
      
      const b1 = { ...box, id: `box-split1-${Math.random().toString(36).substring(2, 9)}` }
      const b2 = { ...box, id: `box-split2-${Math.random().toString(36).substring(2, 9)}` }
      
      if (orientation === 'horizontal') {
        b1.width = box.width / 2
        b2.width = box.width / 2
        b2.x = box.x + b1.width
      } else {
        b1.height = box.height / 2
        b2.height = box.height / 2
        b2.y = box.y + b1.height
      }
      
      newBoxes.push(b1, b2)
      newSelection.add(b1.id)
      newSelection.add(b2.id)
    })

    let newLayout = { ...layout, boxes: newBoxes, updatedAt: new Date().toISOString() }
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    pushHistory(newLayout)
    setSelectedBoxIds(newSelection)
  }, [selectedBoxIds, layout, pushHistory])

  const convertColumnToStacked = useCallback((boxesToStack: number) => {
    if (selectedBoxIds.size === 0) return
    
    // Group selected boxes by rough column (x coordinate proximity)
    // To simplify: we assume the user selected a vertical stack of boxes they want to merge and re-split
    const boxes = Array.from(selectedBoxIds).map(id => layout.boxes.find(b => b.id === id)).filter(Boolean) as ManualCropBox[]
    
    const minX = Math.min(...boxes.map(b => b.x))
    const minY = Math.min(...boxes.map(b => b.y))
    const maxX = Math.max(...boxes.map(b => b.x + b.width))
    const maxY = Math.max(...boxes.map(b => b.y + b.height))
    
    const totalHeight = maxY - minY
    const cellHeight = totalHeight / boxesToStack
    
    const newBoxesList: ManualCropBox[] = []
    for (let i = 0; i < boxesToStack; i++) {
      newBoxesList.push({
        id: `box-stacked-${Math.random().toString(36).substring(2, 9)}`,
        pageNumber: layout.pageNumber,
        itemNumber: '',
        x: minX,
        y: minY + i * cellHeight,
        width: maxX - minX,
        height: cellHeight,
        included: true,
        rowId: '',
        columnId: ''
      })
    }
    
    const remainingBoxes = layout.boxes.filter(b => !selectedBoxIds.has(b.id))
    let newLayout = { ...layout, boxes: [...remainingBoxes, ...newBoxesList], updatedAt: new Date().toISOString() }
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    pushHistory(newLayout)
    setSelectedBoxIds(new Set(newBoxesList.map(b => b.id)))
  }, [selectedBoxIds, layout, pushHistory])

  const moveRowLine = useCallback((index: number, newY: number) => {
    const newLineY = Math.max(0, Math.min(layout.pageHeight, newY))
    const newLines = [...layout.rowLines]
    newLines[index] = newLineY
    
    // Adjust boxes linked to this row
    const newBoxes = layout.boxes.map(b => {
      if (!b.createdFromGrid) return b
      if (b.linkedRowIndex === index) { // Box is immediately below the line (top edge is moving)
        const oldBottom = b.y + b.height
        return { ...b, y: newLineY, height: Math.max(10, oldBottom - newLineY) }
      }
      if (b.linkedRowIndex === index - 1 || (index === 0 && b.linkedRowIndex === null && b.y < newLineY)) { 
        // Box is immediately above the line (bottom edge is moving)
        return { ...b, height: Math.max(10, newLineY - b.y) }
      }
      return b
    })

    let newLayout = { ...layout, rowLines: newLines, boxes: newBoxes, updatedAt: new Date().toISOString() }
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    pushHistory(newLayout)
  }, [layout, pushHistory])

  const moveColumnLine = useCallback((index: number, newX: number) => {
    const newLineX = Math.max(0, Math.min(layout.pageWidth, newX))
    const newLines = [...layout.columnLines]
    newLines[index] = newLineX
    
    // Adjust boxes linked to this column
    const newBoxes = layout.boxes.map(b => {
      if (!b.createdFromGrid) return b
      if (b.linkedColumnIndex === index) { // Box is immediately to the right of line
        const oldRight = b.x + b.width
        return { ...b, x: newLineX, width: Math.max(10, oldRight - newLineX) }
      }
      if (b.linkedColumnIndex === index - 1 || (index === 0 && b.linkedColumnIndex === null && b.x < newLineX)) {
        // Box is immediately to the left of line
        return { ...b, width: Math.max(10, newLineX - b.x) }
      }
      return b
    })

    let newLayout = { ...layout, columnLines: newLines, boxes: newBoxes, updatedAt: new Date().toISOString() }
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    pushHistory(newLayout)
  }, [layout, pushHistory])

  const renumber = useCallback(() => {
    const newBoxes = renumberManualCropBoxes(layout.boxes)
    pushHistory({ ...layout, boxes: newBoxes, updatedAt: new Date().toISOString() })
  }, [layout, pushHistory])

  const applyTemplateGeneratedLayout = useCallback((newLayout: ManualCropPageLayout) => {
    pushHistory({ ...newLayout, updatedAt: new Date().toISOString() })
    setSelectedBoxIds(new Set())
  }, [pushHistory])

  const setSuggestions = useCallback((suggestions: any[]) => {
    pushHistory({ ...layout, suggestedBoxes: suggestions, updatedAt: new Date().toISOString() })
  }, [layout, pushHistory])

  const acceptSuggestions = useCallback(() => {
    if (!layout.suggestedBoxes || layout.suggestedBoxes.length === 0) return
    const newBoxes = layout.suggestedBoxes.map((s) => ({
      id: s.id,
      pageNumber: layout.pageNumber,
      itemNumber: '',
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      included: true,
      rowId: '',
      columnId: ''
    }))
    let newLayout = { ...layout, boxes: newBoxes, suggestedBoxes: undefined, updatedAt: new Date().toISOString() } as ManualCropPageLayout
    newLayout = rebuildLayoutStructureFromBoxes(newLayout)
    newLayout.boxes = renumberManualCropBoxes(newLayout.boxes)
    pushHistory(newLayout)
  }, [layout, pushHistory])

  const rejectSuggestions = useCallback(() => {
    pushHistory({ ...layout, suggestedBoxes: undefined, updatedAt: new Date().toISOString() })
  }, [layout, pushHistory])

  const resetGrid = useCallback((rows: number, columns: number) => {
    const newLayout = createInitialGridLayout({
      pageNumber: layout.pageNumber,
      pageImagePath: layout.pageImagePath,
      pageWidth: layout.pageWidth,
      pageHeight: layout.pageHeight,
      rows,
      columns
    })
    pushHistory(newLayout)
    setSelectedBoxIds(new Set())
  }, [layout, pushHistory])

  return {
    layout,
    selectedBoxIds,
    historyIndex,
    historyLength: history.length,
    undo,
    redo,
    toggleBoxSelection,
    selectBoxesInRect,
    updateBoxes,
    moveSelectedBoxes,
    resizeSelectedBoxes,
    setIncluded,
    deleteSelected,
    deleteBox,
    addBox,
    mergeSelected,
    splitSelected,
    convertColumnToStacked,
    moveRowLine,
    moveColumnLine,
    renumber,
    resetGrid,
    applyTemplateGeneratedLayout,
    selectAllBoxes,
    clearSelection,
    setSelectedBoxIdsList,
    setSuggestions,
    acceptSuggestions,
    rejectSuggestions,
    cloneSelectedBoxes
  }
}
