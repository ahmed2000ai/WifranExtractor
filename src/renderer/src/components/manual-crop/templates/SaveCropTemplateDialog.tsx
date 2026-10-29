import React, { useState } from 'react'
import { SaveCropLayoutTemplateInput } from '../../../../../shared/types/cropLayoutTemplate'
import { ManualCropPageLayout } from '../../../../../shared/types/manualCrop'

type SaveCropTemplateDialogProps = {
  isOpen: boolean
  onClose: () => void
  onSave: (input: SaveCropLayoutTemplateInput) => Promise<void>
  currentLayout: ManualCropPageLayout
}

export const SaveCropTemplateDialog: React.FC<SaveCropTemplateDialogProps> = ({ isOpen, onClose, onSave, currentLayout }) => {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Template name is required')
      return
    }

    const includedBoxes = currentLayout.boxes.filter(b => b.included)
    if (includedBoxes.length === 0) {
      setError('Current page must have at least one included box to save a template')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        notes: notes.trim() || undefined,
        sourcePageWidth: currentLayout.pageWidth,
        sourcePageHeight: currentLayout.pageHeight,
        boxes: currentLayout.boxes,
        rowLines: currentLayout.rowLines || [],
        columnLines: currentLayout.columnLines || []
      })
      onClose()
      setName('')
      setNotes('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-96 max-w-full">
        <h2 className="text-xl font-semibold mb-4 text-gray-800">Save Template</h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md border border-red-200">
            {error}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Template Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., Othaim 4x4 Standard"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={saving}
            autoFocus
          />
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes (Optional)
          </label>
          <textarea
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 h-20 resize-none"
            placeholder="Layout for the snack section pages..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  )
}
