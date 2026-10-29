import { ipcMain } from 'electron'
import { cropLayoutTemplateService } from '../templates/cropLayoutTemplateService'
import { SaveCropLayoutTemplateInput, CropLayoutTemplate } from '../../shared/types/cropLayoutTemplate'

export function registerCropLayoutTemplateIpcHandlers(): void {
  ipcMain.handle('cropTemplates:list', async () => {
    return cropLayoutTemplateService.listTemplates()
  })

  ipcMain.handle('cropTemplates:save', async (_, input: SaveCropLayoutTemplateInput) => {
    return cropLayoutTemplateService.saveTemplate(input)
  })

  ipcMain.handle('cropTemplates:update', async (_, templateId: string, patch: Partial<Pick<CropLayoutTemplate, 'name' | 'notes'>>) => {
    return cropLayoutTemplateService.updateTemplate(templateId, patch)
  })

  ipcMain.handle('cropTemplates:delete', async (_, templateId: string) => {
    return cropLayoutTemplateService.deleteTemplate(templateId)
  })

  ipcMain.handle('cropTemplates:duplicate', async (_, templateId: string, newName?: string) => {
    return cropLayoutTemplateService.duplicateTemplate(templateId, newName)
  })
}
