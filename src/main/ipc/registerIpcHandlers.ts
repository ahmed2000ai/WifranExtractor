import { ipcMain, app } from 'electron'
import { AppHealthStatus } from '../../shared/types/app'
import { getSafeConfigStatus } from '../config/configStatus'
import type { DatabaseContext } from '../db/databaseEnvironmentResolver'
import { assessSchemaCompatibility } from '../db/schemaCompatibilityService'
import { registerReferenceDataIpcHandlers } from './referenceDataIpc'
import { registerFileDialogIpcHandlers } from './fileDialogIpc'
import { registerPdfPreprocessIpcHandlers } from './pdfPreprocessIpc'
import { registerOcrIpcHandlers } from './ocrIpc'
import { registerImageCroppingIpc } from './imageCroppingIpc'
import { registerImportTrackingIpcHandlers } from './importTrackingIpc'
import { setupEntityMatchingHandlers } from './entityMatchingIpc'
import { setupOfferPreparationHandlers } from './offerPreparationIpc'
import { setupOfferSyncHandlers } from './offerSyncIpc'
import { registerManualCropIpcHandlers } from './manualCropIpc'
import { registerReviewWorkflowIpcHandlers } from './reviewWorkflowIpc'
import { registerCropLayoutTemplateIpcHandlers } from './cropLayoutTemplateIpc'
import { registerExtractionPackageHandlers } from './extractionPackageIpc'
import { registerStyleProfileSelectionIpcHandlers } from './styleProfileSelectionIpc'
import { registerPrePublishIpc } from './prePublishIpc'
import { registerPageFirstIpcHandlers } from './pageFirstIpc'
import { registerRev1IpcHandlers } from './rev1Ipc'
import { registerProductEnrichmentIpcHandlers } from './productEnrichmentIpc'
import { registerLeafletMetadataIpc } from './leafletMetadataIpc'
import { registerBatchExtractionIpcHandlers } from './batchExtractionIpc'
import { registerCatalogMatchingIpcHandlers } from './catalogMatchingIpc'

export function registerIpcHandlers(): void {
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('app:getHealth', (): AppHealthStatus => {
    const { databaseEnvironment } = getSafeConfigStatus()

    return {
      ok: true,
      appVersion: app.getVersion(),
      environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
      isOfflineUat: process.env.WIFRAN_OFFLINE_UAT === '1',
      databaseEnvironment
    }
  })

  ipcMain.handle('config:getStatus', () => {
    return getSafeConfigStatus()
  })

  ipcMain.handle('config:verifySchemaReadiness', async (_event, context?: DatabaseContext) => {
    const resolvedContext: DatabaseContext = context === 'DEVELOPMENT_TEST' ? 'DEVELOPMENT_TEST' : 'PRODUCTION_UI'
    return await assessSchemaCompatibility({ context: resolvedContext })
  })

  registerReferenceDataIpcHandlers()
  registerFileDialogIpcHandlers()
  registerPdfPreprocessIpcHandlers()
  registerOcrIpcHandlers()
  registerImageCroppingIpc()
  registerImportTrackingIpcHandlers()
  setupEntityMatchingHandlers()
  setupOfferPreparationHandlers()
  setupOfferSyncHandlers()
  registerManualCropIpcHandlers()
  registerReviewWorkflowIpcHandlers()
  registerCropLayoutTemplateIpcHandlers()
  registerExtractionPackageHandlers()
  registerStyleProfileSelectionIpcHandlers()
  registerPrePublishIpc()
  registerPageFirstIpcHandlers()
  registerRev1IpcHandlers()
  registerProductEnrichmentIpcHandlers()
  registerLeafletMetadataIpc()
  registerBatchExtractionIpcHandlers()
  registerCatalogMatchingIpcHandlers()
}
