import React, { useState, useEffect, useRef } from 'react'
import { CropLayoutTemplate } from '../../../../../shared/types/cropLayoutTemplate'
import { CropTemplateCard } from './CropTemplateCard'

type CropTemplateBrowserProps = {
  templates: CropLayoutTemplate[]
  isLoading: boolean
  error: string | null
  onApply: (template: CropLayoutTemplate) => void
  onRename: (templateId: string, newName: string, newNotes: string) => void
  onDuplicate: (templateId: string) => void
  onDelete: (templateId: string) => void
  activeSupermarketCode?: string
  activeSupermarketDescription?: string
}

export const CropTemplateBrowser: React.FC<CropTemplateBrowserProps> = ({
  templates,
  isLoading,
  error,
  onApply,
  onRename,
  onDuplicate,
  onDelete,
  activeSupermarketCode,
  activeSupermarketDescription
}) => {
  const [search, setSearch] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  
  const containerRef = useRef<HTMLDivElement>(null)

  // Clear selection if the selected template is deleted
  useEffect(() => {
    if (selectedTemplateId && !templates.find(t => t.templateId === selectedTemplateId)) {
      setSelectedTemplateId(null)
    }
  }, [templates, selectedTemplateId])

  const handleApply = (template: CropLayoutTemplate) => {
    onApply(template)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ignore if user is typing in the search box
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTemplateId) {
      e.preventDefault()
      e.stopPropagation()
      
      const template = templates.find(t => t.templateId === selectedTemplateId)
      if (template) {
        if (window.confirm(`Delete template "${template.name}"?\n\nThis permanently deletes the saved template.\nIt will not affect the current page layout.`)) {
          onDelete(template.templateId)
        }
      }
    }
  }

  const filteredTemplates = templates
    .filter(t => {
      const s = search.toLowerCase()
      return t.name.toLowerCase().includes(s) || (t.notes || '').toLowerCase().includes(s)
    })
    .sort((a, b) => {
      // Sort: lastUsedAt desc, then updatedAt desc, then name asc
      if (a.lastUsedAt && b.lastUsedAt) {
        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
      }
      if (a.lastUsedAt) return -1
      if (b.lastUsedAt) return 1
      if (a.updatedAt && b.updatedAt) {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }
      return a.name.localeCompare(b.name)
    })

  const brandTemplates = filteredTemplates.filter(t => t.supermarket_code && t.supermarket_code === activeSupermarketCode)
  const legacyTemplates = filteredTemplates.filter(t => !t.supermarket_code)

  return (
    <div 
      ref={containerRef}
      style={{ backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0, outline: 'none', overflowX: 'hidden' }}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onClick={() => containerRef.current?.focus()}
    >
      <div style={{ padding: '8px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', flexShrink: 0 }}>
        <input
          type="text"
          style={{ boxSizing: 'border-box', width: '100%', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '4px 8px', fontSize: '0.875rem', outline: 'none' }}
          placeholder="Search templates..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }} tabIndex={0}>
        {isLoading && <div style={{ fontSize: '0.875rem', color: '#64748b', textAlign: 'center', padding: '16px 0' }}>Loading templates...</div>}
        
        {error && <div style={{ fontSize: '0.75rem', color: '#ef4444', padding: '8px', margin: '8px', backgroundColor: '#fef2f2', borderRadius: '4px', border: '1px solid #fee2e2' }}>{error}</div>}
        
        {!isLoading && filteredTemplates.length === 0 && (
          <div style={{ fontSize: '0.875rem', color: '#64748b', textAlign: 'center', padding: '16px 8px' }}>
            {search ? 'No matching templates found.' : 'No templates saved yet.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {activeSupermarketCode && brandTemplates.length > 0 && (
            <div style={{ padding: '8px', fontSize: '0.75rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: '#f1f5f9' }}>
              {activeSupermarketDescription || activeSupermarketCode} Templates
            </div>
          )}
          {activeSupermarketCode && brandTemplates.length === 0 && !search && !isLoading && (
            <div style={{ padding: '16px', fontSize: '0.875rem', color: '#64748b', textAlign: 'center', fontStyle: 'italic' }}>
              No templates saved for {activeSupermarketDescription || activeSupermarketCode}.
            </div>
          )}
          
          {(activeSupermarketCode ? brandTemplates : filteredTemplates.filter(t => t.supermarket_code)).map(template => (
            <CropTemplateCard
              key={template.templateId}
              template={template}
              isSelected={selectedTemplateId === template.templateId}
              onClick={() => {
                setSelectedTemplateId(template.templateId)
                containerRef.current?.focus()
              }}
              onDoubleClick={() => {
                setSelectedTemplateId(template.templateId)
                handleApply(template)
              }}
              onRename={onRename}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          ))}

          {legacyTemplates.length > 0 && (
            <>
              <div style={{ padding: '8px', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0', marginTop: brandTemplates.length > 0 ? '8px' : 0 }}>
                Legacy / Unassigned
              </div>
              {legacyTemplates.map(template => (
                <CropTemplateCard
                  key={template.templateId}
                  template={template}
                  isSelected={selectedTemplateId === template.templateId}
                  onClick={() => {
                    setSelectedTemplateId(template.templateId)
                    containerRef.current?.focus()
                  }}
                  onDoubleClick={() => {
                    setSelectedTemplateId(template.templateId)
                    handleApply(template)
                  }}
                  onRename={onRename}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
