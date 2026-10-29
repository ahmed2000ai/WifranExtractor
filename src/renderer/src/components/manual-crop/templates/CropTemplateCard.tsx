import React, { useState, useEffect, useRef } from 'react'
import { CropLayoutTemplate } from '../../../../../shared/types/cropLayoutTemplate'
import { CropTemplateThumbnail } from './CropTemplateThumbnail'

type CropTemplateCardProps = {
  template: CropLayoutTemplate
  isSelected: boolean
  onClick: () => void
  onDoubleClick: () => void
  onRename: (templateId: string, newName: string, newNotes: string) => void
  onDuplicate: (templateId: string) => void
  onDelete: (templateId: string) => void
}

export const CropTemplateCard: React.FC<CropTemplateCardProps> = ({ 
  template, isSelected, onClick, onDoubleClick, onRename, onDuplicate, onDelete 
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [editName, setEditName] = useState(template.name)
  const [editNotes, setEditNotes] = useState(template.notes || '')
  
  const rowRef = useRef<HTMLDivElement>(null)

  const lastUpdated = template.updatedAt ? new Date(template.updatedAt).toLocaleDateString() : 'Unknown'

  const handleSaveRename = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editName.trim()) {
      onRename(template.templateId, editName.trim(), editNotes.trim())
    }
    setIsRenaming(false)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm(`Are you sure you want to delete template "${template.name}"? This cannot be undone.`)) {
      onDelete(template.templateId)
    }
    setMenuOpen(false)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onClick() // select it
    setMenuOpen(true)
  }

  // Close context menu if clicked outside
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  return (
    <div 
      ref={rowRef}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: '8px',
        borderBottom: '1px solid #e2e8f0',
        cursor: 'pointer',
        userSelect: 'none',
        backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
        outline: isSelected ? '2px solid #60a5fa' : 'none',
        outlineOffset: '-1px',
        boxSizing: 'border-box',
        width: '100%'
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={handleContextMenu}
      title={`Template: ${template.name}\nUpdated: ${lastUpdated}\nBoxes: ${template.boxCount}${template.notes ? '\nNotes: ' + template.notes : ''}`}
    >
      {/* Thumbnail */}
      <div style={{
        border: isSelected ? '1px solid #93c5fd' : '1px solid #e2e8f0',
        borderRadius: '4px',
        overflow: 'hidden',
        flexShrink: 0,
        backgroundColor: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: isSelected ? '0 1px 2px 0 rgba(0, 0, 0, 0.05)' : 'none'
      }}>
        <CropTemplateThumbnail template={template} width={72} height={100} />
      </div>

      {isRenaming && (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '8px' }} onClick={e => e.stopPropagation()}>
            <input
              type="text"
              style={{ boxSizing: 'border-box', width: '100%', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '2px 6px', fontSize: '0.875rem' }}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveRename(e as any)
                if (e.key === 'Escape') setIsRenaming(false)
              }}
            />
            <input
              type="text"
              style={{ boxSizing: 'border-box', width: '100%', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '2px 6px', fontSize: '0.75rem', color: '#475569' }}
              placeholder="Notes (optional)"
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveRename(e as any)
                if (e.key === 'Escape') setIsRenaming(false)
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button style={{ fontSize: '0.75rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setIsRenaming(false) }}>Cancel</button>
              <button style={{ fontSize: '0.75rem', color: '#2563eb', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }} onClick={handleSaveRename}>Save</button>
            </div>
          </div>
        </div>
      )}

      {!isRenaming && (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', marginLeft: '12px' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {template.name}
          </div>
          {template.supermarket_code && (
            <div style={{ display: 'inline-block', alignSelf: 'flex-start', marginTop: '4px', padding: '2px 6px', fontSize: '0.65rem', fontWeight: 600, color: '#0369a1', backgroundColor: '#e0f2fe', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {template.supermarket_description || template.supermarket_code}
            </div>
          )}
          {template.notes && (
            <div style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
              {template.notes}
            </div>
          )}
        </div>
      )}

      {/* Right-click Context Menu */}
      {menuOpen && (
        <div 
          style={{ 
            position: 'absolute', 
            zIndex: 20, 
            backgroundColor: '#ffffff', 
            borderRadius: '6px', 
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)', 
            border: '1px solid #e2e8f0', 
            padding: '4px 0',
            top: '100%', 
            left: '50px', 
            minWidth: '150px' 
          }}
          onClick={e => e.stopPropagation()}
        >
          <button 
            style={{ width: '100%', textAlign: 'left', padding: '6px 16px', fontSize: '0.75rem', color: '#334155', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onDoubleClick(); setMenuOpen(false); }}
          >
            Apply Template
          </button>
          <div style={{ height: '1px', backgroundColor: '#f1f5f9', margin: '4px 0' }} />
          <button 
            style={{ width: '100%', textAlign: 'left', padding: '6px 16px', fontSize: '0.75rem', color: '#334155', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); setIsRenaming(true); setMenuOpen(false); }}
          >
            Rename
          </button>
          <button 
            style={{ width: '100%', textAlign: 'left', padding: '6px 16px', fontSize: '0.75rem', color: '#334155', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onDuplicate(template.templateId); setMenuOpen(false); }}
          >
            Duplicate
          </button>
          <div style={{ height: '1px', backgroundColor: '#f1f5f9', margin: '4px 0' }} />
          <button 
            style={{ width: '100%', textAlign: 'left', padding: '6px 16px', fontSize: '0.75rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
