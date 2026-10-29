import { useState, useCallback, useEffect } from 'react'
import { CropLayoutTemplate, SaveCropLayoutTemplateInput } from '../../../shared/types/cropLayoutTemplate'

export function useCropLayoutTemplates() {
  const [templates, setTemplates] = useState<CropLayoutTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await window.wifranExtractor.cropTemplates.list()
      setTemplates(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const saveTemplate = useCallback(async (input: SaveCropLayoutTemplateInput) => {
    try {
      const newTemplate = await window.wifranExtractor.cropTemplates.save(input)
      setTemplates(prev => [...prev, newTemplate])
      return newTemplate
    } catch (err: any) {
      throw new Error(`Failed to save template: ${err.message}`)
    }
  }, [])

  const updateTemplate = useCallback(async (templateId: string, patch: Partial<Pick<CropLayoutTemplate, 'name' | 'notes'>>) => {
    try {
      const updated = await window.wifranExtractor.cropTemplates.update(templateId, patch)
      setTemplates(prev => prev.map(t => t.templateId === templateId ? updated : t))
      return updated
    } catch (err: any) {
      throw new Error(`Failed to update template: ${err.message}`)
    }
  }, [])

  const deleteTemplate = useCallback(async (templateId: string) => {
    try {
      await window.wifranExtractor.cropTemplates.delete(templateId)
      setTemplates(prev => prev.filter(t => t.templateId !== templateId))
    } catch (err: any) {
      throw new Error(`Failed to delete template: ${err.message}`)
    }
  }, [])

  const duplicateTemplate = useCallback(async (templateId: string, newName?: string) => {
    try {
      const duplicated = await window.wifranExtractor.cropTemplates.duplicate(templateId, newName)
      setTemplates(prev => [...prev, duplicated])
      return duplicated
    } catch (err: any) {
      throw new Error(`Failed to duplicate template: ${err.message}`)
    }
  }, [])

  return {
    templates,
    isLoading,
    error,
    loadTemplates,
    saveTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate
  }
}
