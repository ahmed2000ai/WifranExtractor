import { ipcMain, dialog } from 'electron'
import { promises as fs } from 'fs'
import { getSupabaseAdminClient } from '../db/supabaseAdminClient'
import {
  analyzeOfferCatalogCandidates,
  approveCatalogProductCandidates,
  ApproveCatalogCandidatesInput
} from '../db/productCatalogResolutionService'
import {
  exportProductsForImageSearch,
  validateProductImageCsvImport,
  uploadApprovedProductImagesToDb,
  UploadProductImagesInput,
  importStep2CsvIntoStagedDraft,
  updateStagedLeafletHeader,
  updateStagedOfferField,
  revertStagedOfferField,
  replaceStagedOfferConsumerImage,
  loadStagedLeafletDraft,
  initializeStagedDraftFromPackage,
  exportStagedLeafletForStep2,
  publishStagedLeafletDraftToDb,
  resolveOrCreateSupermarket,
  resolveOrCreateRegion
} from '../db/productImageEnrichmentService'

export function registerProductEnrichmentIpcHandlers(): void {
  ipcMain.handle('catalog:analyzeCandidates', async (_event, options) => {
    return await analyzeOfferCatalogCandidates(options)
  })

  ipcMain.handle('catalog:approveCandidates', async (_event, input: ApproveCatalogCandidatesInput) => {
    return await approveCatalogProductCandidates(input)
  })

  ipcMain.handle('catalog:exportImageCsv', async (_event, options) => {
    return await exportProductsForImageSearch(options)
  })

  ipcMain.handle('productEnrichment:export-csv', async (_event, options) => {
    return await exportProductsForImageSearch(options)
  })

  ipcMain.handle('catalog:saveExportedCsvDialog', async (_event, options: { defaultFileName?: string; csvContent: string }) => {
    const result = await dialog.showSaveDialog({
      title: 'Save Hybrid Image Search CSV',
      defaultPath: options.defaultFileName || 'wifran_v2_hybrid_image_refs_for_search.csv',
      filters: [
        { name: 'CSV Files (*.csv)', extensions: ['csv'] },
        { name: 'All Files (*.*)', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }

    await fs.writeFile(result.filePath, options.csvContent, 'utf-8')
    return { canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('productEnrichment:save-csv-dialog', async (event, options) => {
    const handler = ipcMain.rawListeners('catalog:saveExportedCsvDialog')[0]
    // @ts-ignore
    return await handler(event, options)
  })

  ipcMain.handle('catalog:validateImageCsv', async (_event, csvContent: string, options?: any) => {
    return await validateProductImageCsvImport(csvContent, options)
  })

  ipcMain.handle('productEnrichment:validate-csv', async (_event, csvContent: string, options?: any) => {
    return await validateProductImageCsvImport(csvContent, options)
  })

  ipcMain.handle('catalog:uploadProductImages', async (event, input: UploadProductImagesInput) => {
    return await uploadApprovedProductImagesToDb({
      ...input,
      onProgress: (p) => {
        event.sender.send('catalog:uploadProgress', p)
      }
    })
  })

  ipcMain.handle('productEnrichment:upload-images', async (event, input: UploadProductImagesInput) => {
    return await uploadApprovedProductImagesToDb({
      ...input,
      onProgress: (p) => {
        event.sender.send('catalog:uploadProgress', p)
      }
    })
  })

  // Phase 2: Local-First Staged Draft Handlers
  ipcMain.handle('productEnrichment:import-step2-csv', async (_event, jobDir: string, csvContent: string, options?: any) => {
    return await importStep2CsvIntoStagedDraft(jobDir, csvContent, options)
  })

  ipcMain.handle('catalog:importStep2Csv', async (_event, jobDir: string, csvContent: string, options?: any) => {
    return await importStep2CsvIntoStagedDraft(jobDir, csvContent, options)
  })

  ipcMain.handle('productEnrichment:update-header', async (_event, jobDir: string, headerPatch: any) => {
    return await updateStagedLeafletHeader(jobDir, headerPatch)
  })

  ipcMain.handle('productEnrichment:update-offer-field', async (_event, jobDir: string, offerId: string, fieldUpdates: any) => {
    return await updateStagedOfferField(jobDir, offerId, fieldUpdates)
  })

  ipcMain.handle('productEnrichment:revert-offer-field', async (_event, jobDir: string, offerId: string, fieldName?: string) => {
    return await revertStagedOfferField(jobDir, offerId, fieldName)
  })

  ipcMain.handle('productEnrichment:replace-consumer-image', async (_event, jobDir: string, offerId: string, replacement: any) => {
    return await replaceStagedOfferConsumerImage(jobDir, offerId, replacement)
  })

  ipcMain.handle('productEnrichment:load-draft', async (_event, jobDir: string) => {
    return await loadStagedLeafletDraft(jobDir)
  })

  ipcMain.handle('productEnrichment:initialize-draft', async (_event, jobDir: string, options?: any) => {
    return await initializeStagedDraftFromPackage(jobDir, options)
  })

  ipcMain.handle('productEnrichment:export-step1-csv', async (_event, jobDir: string, options?: any) => {
    return await exportStagedLeafletForStep2(jobDir, options)
  })

  ipcMain.handle('productEnrichment:publish-staged-draft', async (event, jobDir: string, options?: any) => {
    return await publishStagedLeafletDraftToDb(jobDir, {
      ...options,
      onProgress: (p: any) => {
        event.sender.send('productEnrichment:publishProgress', p)
      }
    })
  })

  ipcMain.handle('catalog:publishStagedDraft', async (event, jobDir: string, options?: any) => {
    return await publishStagedLeafletDraftToDb(jobDir, {
      ...options,
      onProgress: (p: any) => {
        event.sender.send('productEnrichment:publishProgress', p)
      }
    })
  })

  ipcMain.handle('productEnrichment:select-csv-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Step 2 Returned CSV',
      filters: [{ name: 'CSV Files (*.csv)', extensions: ['csv'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const content = await fs.readFile(result.filePaths[0], 'utf-8')
    return { canceled: false, filePath: result.filePaths[0], content }
  })

  ipcMain.handle('productEnrichment:select-image-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Consumer Display Image',
      filters: [{ name: 'Images (*.webp, *.png, *.jpg, *.jpeg)', extensions: ['webp', 'png', 'jpg', 'jpeg'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  ipcMain.handle('catalog:getSupermarketsAndRegions', async () => {
    const supabase = getSupabaseAdminClient()
    const [{ data: supermarkets }, { data: regions }] = await Promise.all([
      supabase.from('supermarkets').select('id, name_en, name_ar, slug').order('name_en', { ascending: true }),
      supabase.from('regions').select('id, name_en, name_ar, slug').order('name_en', { ascending: true })
    ])
    return {
      supermarkets: supermarkets || [],
      regions: regions || []
    }
  })

  ipcMain.handle('productEnrichment:get-supermarkets-and-regions', async () => {
    const supabase = getSupabaseAdminClient()
    const [{ data: supermarkets }, { data: regions }] = await Promise.all([
      supabase.from('supermarkets').select('id, name_en, name_ar, slug').order('name_en', { ascending: true }),
      supabase.from('regions').select('id, name_en, name_ar, slug').order('name_en', { ascending: true })
    ])
    return {
      supermarkets: supermarkets || [],
      regions: regions || []
    }
  })

  ipcMain.handle('productEnrichment:resolve-supermarket', async (_event, rawName: string) => {
    return await resolveOrCreateSupermarket(rawName)
  })

  ipcMain.handle('productEnrichment:resolve-region', async (_event, rawName: string) => {
    return await resolveOrCreateRegion(rawName)
  })
}

