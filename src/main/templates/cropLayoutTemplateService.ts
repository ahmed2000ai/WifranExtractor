import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import { error as logError } from '../logging/logger'
import {
  CropLayoutTemplate,
  SaveCropLayoutTemplateInput
} from '../../shared/types/cropLayoutTemplate'

export class CropLayoutTemplateService {
  private getStorageDirectory(): string {
    const userDataPath = app.getPath('userData')
    const templatesDir = path.join(userDataPath, 'crop-layout-templates')
    const activeDir = path.join(templatesDir, 'active')
    const archiveDir = path.join(templatesDir, 'archive')
    
    if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true })
    if (!fs.existsSync(activeDir)) fs.mkdirSync(activeDir, { recursive: true })
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true })
      
    return templatesDir
  }

  private getActiveStoragePath(): string {
    return path.join(this.getStorageDirectory(), 'active', 'crop-layout-templates.json')
  }

  private getLegacyStoragePath(): string {
    return path.join(app.getPath('userData'), 'crop-layout-templates', 'crop-layout-templates.json')
  }

  private readStorage(): { templates: CropLayoutTemplate[] } {
    const storagePath = this.getActiveStoragePath()
    if (!fs.existsSync(storagePath)) {
      return { templates: [] }
    }
    try {
      const data = fs.readFileSync(storagePath, 'utf8')
      return JSON.parse(data)
    } catch (err: any) {
      logError(`Failed to read crop layout templates: ${err.message}`)
      return { templates: [] }
    }
  }

  private writeStorage(data: { templates: CropLayoutTemplate[] }): void {
    const storagePath = this.getActiveStoragePath()
    const tmpPath = `${storagePath}.tmp`
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
      fs.renameSync(tmpPath, storagePath)
    } catch (err: any) {
      logError(`Failed to write crop layout templates: ${err.message}`)
      throw err
    }
  }

  public async listTemplates(): Promise<CropLayoutTemplate[]> {
    const data = this.readStorage()
    return data.templates
  }

  public async saveTemplate(input: SaveCropLayoutTemplateInput): Promise<CropLayoutTemplate> {
    if (!input.supermarket_code) {
      throw new Error('Cannot save an active template because the supermarket code is unknown.')
    }
    
    const data = this.readStorage()
    const now = new Date().toISOString()
    const template: CropLayoutTemplate = {
      templateId: crypto.randomUUID(),
      name: input.name,
      notes: input.notes,
      supermarket_code: input.supermarket_code,
      supermarket_description: input.supermarket_description,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      sourcePageWidth: input.sourcePageWidth,
      sourcePageHeight: input.sourcePageHeight,
      boxCount: input.boxes.length,
      boxes: input.boxes,
      rowLines: input.rowLines,
      columnLines: input.columnLines,
      source: input.source,
      origin_strategy: input.origin_strategy,
      origin_confidence: input.origin_confidence
    }
    data.templates.push(template)
    this.writeStorage(data)
    return template
  }

  public async updateTemplate(templateId: string, patch: Partial<Pick<CropLayoutTemplate, 'name' | 'notes'>>): Promise<CropLayoutTemplate> {
    const data = this.readStorage()
    const templateIndex = data.templates.findIndex(t => t.templateId === templateId)
    if (templateIndex === -1) {
      throw new Error(`Template with id ${templateId} not found`)
    }
    const template = data.templates[templateIndex]
    
    if (patch.name !== undefined) template.name = patch.name
    if (patch.notes !== undefined) template.notes = patch.notes
    template.updatedAt = new Date().toISOString()
    
    data.templates[templateIndex] = template
    this.writeStorage(data)
    return template
  }

  public async deleteTemplate(templateId: string): Promise<void> {
    const data = this.readStorage()
    data.templates = data.templates.filter(t => t.templateId !== templateId)
    this.writeStorage(data)
  }

  public async duplicateTemplate(templateId: string, newName?: string): Promise<CropLayoutTemplate> {
    const data = this.readStorage()
    const templateToDuplicate = data.templates.find(t => t.templateId === templateId)
    if (!templateToDuplicate) {
      throw new Error(`Template with id ${templateId} not found`)
    }
    
    const now = new Date().toISOString()
    const newTemplate: CropLayoutTemplate = {
      ...templateToDuplicate,
      templateId: crypto.randomUUID(),
      name: newName || `${templateToDuplicate.name} copy`,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now
    }
    data.templates.push(newTemplate)
    this.writeStorage(data)
    return newTemplate
  }

  public async markTemplateUsed(templateId: string): Promise<void> {
    const data = this.readStorage()
    const template = data.templates.find(t => t.templateId === templateId)
    if (template) {
      template.lastUsedAt = new Date().toISOString()
      this.writeStorage(data)
    }
  }

  public async archiveLegacyTemplates(): Promise<any> {
    const baseDir = this.getStorageDirectory()
    const legacyPath = this.getLegacyStoragePath()
    const metadataDir = path.join(baseDir, 'metadata', 'template-migrations')
    const migrationFile = path.join(metadataDir, 'pre-automatic-detection-reset.json')

    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true })
    }

    if (fs.existsSync(migrationFile)) {
      return JSON.parse(fs.readFileSync(migrationFile, 'utf8'))
    }

    const now = new Date().toISOString()
    const timestamp = now.replace(/[:.]/g, '-').replace('T', '-').slice(0, 15)
    const archivePath = path.join(baseDir, 'archive', `pre-automatic-detection-reset-${timestamp}.json`)

    let sourceCount = 0
    let archivedCount = 0

    if (fs.existsSync(legacyPath)) {
      try {
        const legacyData = fs.readFileSync(legacyPath, 'utf8')
        const parsed = JSON.parse(legacyData)
        sourceCount = parsed.templates?.length || 0
        
        fs.writeFileSync(archivePath, legacyData, 'utf8')
        archivedCount = sourceCount
        
        // Remove legacy file after successful archive
        fs.unlinkSync(legacyPath)
      } catch (err: any) {
        logError(`Migration archive failed: ${err.message}`)
        throw err
      }
    }

    const migrationRecord = {
      schema_version: 1,
      migration_type: "archive_legacy_templates",
      created_at: now,
      source_template_count: sourceCount,
      archived_template_count: archivedCount,
      failed_template_count: 0,
      archive_path: archivePath,
      failures: []
    }

    fs.writeFileSync(migrationFile, JSON.stringify(migrationRecord, null, 2), 'utf8')
    return migrationRecord
  }
}

export const cropLayoutTemplateService = new CropLayoutTemplateService()
