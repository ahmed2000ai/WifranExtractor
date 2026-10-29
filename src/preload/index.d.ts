import { AppEnvironment, AppHealthStatus } from '../shared/types/app'

declare global {
  interface Window {
    wifranExtractor: {
      app: {
        getVersion: () => Promise<string>
        getHealth: () => Promise<AppHealthStatus>
      }
      config: {
        getStatus: () => Promise<import('../../shared/types/config').SafeConfigStatus>
      }
      reference: {
        loadAll: () => Promise<import('../../shared/types/referenceData').ReferenceDataLoadResult>
        loadSupermarkets: () => Promise<import('../../shared/types/referenceData').ReferenceDataLoadResult>
        loadLocationsForSupermarket: (supermarketId: string) => Promise<import('../../shared/types/referenceData').ReferenceDataLoadResult>
      }
      files: {
        selectPdf: () => Promise<import('../../shared/types/importForm').SelectedPdfFile | null>
      }
      pdf: {
        preprocess: (input: import('../../shared/types/pdfPreprocess').PdfPreprocessInput) => Promise<import('../../shared/types/pdfPreprocess').PdfPreprocessResult>
        onPreprocessProgress: (callback: (event: import('../../shared/types/pdfPreprocess').PdfPreprocessProgressEvent) => void) => () => void
        renderStreaming: (input: import('../../shared/types/pdfPreprocess').StreamingPdfRenderInput) => Promise<import('../../shared/types/pdfPreprocess').StreamingPdfRenderState>
        onRenderStreamingProgress: (callback: (event: import('../../shared/types/pdfPreprocess').StreamingPdfRenderProgressEvent) => void) => () => void
      }
      ocr: {
        testSingleChunk: (input: import('../../shared/types/ocrJob').OcrSingleChunkTestInput) => Promise<import('../../shared/types/ocrJob').OcrSingleChunkTestResult>
        runPipeline: (input: import('../../shared/types/ocrJob').OcrPipelineInput) => Promise<import('../../shared/types/ocrJob').OcrPipelineResult>
        onPipelineProgress: (callback: (event: import('../../shared/types/ocrJob').OcrPipelineProgressEvent) => void) => () => void
        retryFailedChunks: (input: import('../../shared/types/ocrJob').RetryFailedOcrChunksInput) => Promise<import('../../shared/types/ocrJob').RetryFailedOcrChunksResult>
        onRetryProgress: (callback: (event: import('../../shared/types/ocrJob').OcrPipelineProgressEvent) => void) => () => void
      }
      image: {
        cropOcrRows: (input: import('../../shared/types/imageCropping').ImageCroppingInput) => Promise<import('../../shared/types/imageCropping').ImageCroppingResult>
        onCropProgress: (callback: (event: import('../../shared/types/imageCropping').ImageCroppingProgressEvent) => void) => () => void
      }
      importTracking: {
        persist: (input: import('../../shared/types/importTracking').PersistImportTrackingInput) => Promise<import('../../shared/types/importTracking').PersistImportTrackingResult>
      }
      entityMatching: {
        matchRows: (input: import('../../shared/types/entityMatching').EntityMatchingInput) => Promise<import('../../shared/types/entityMatching').EntityMatchingResult>
      }
      offerPreparation: {
        prepare: (input: import('../../shared/types/offerPayload').OfferPreparationInput) => Promise<import('../../shared/types/offerPayload').OfferPreparationResult>
      }
      offerSync: {
        syncPreparedOffers: (input: import('../../shared/types/offerSync').OfferSyncInput) => Promise<import('../../shared/types/offerSync').OfferSyncResult>
        onProgress: (callback: (event: import('../../shared/types/offerSync').OfferSyncProgressEvent) => void) => () => void
      }
      manualCrop: {
        saveSession: (workspacePath: string, session: import('../../shared/types/manualCrop').ManualCropSession) => Promise<{ ok: boolean; error?: string }>
        loadSession: (workspacePath: string) => Promise<{ ok: boolean; session?: import('../../shared/types/manualCrop').ManualCropSession | null; error?: string }>
        cropPage: (input: { layout: import('../../shared/types/manualCrop').ManualCropPageLayout; workspacePath: string }) => Promise<import('../../shared/types/manualCrop').ManualCropResult>
        cropAllPages: (input: { layouts: import('../../shared/types/manualCrop').ManualCropPageLayout[]; workspacePath: string }) => Promise<{ ok: boolean; results?: import('../../shared/types/manualCrop').ManualCropResult[]; error?: string }>
        enqueuePageCrop: (workspacePath: string, layout: import('../../shared/types/manualCrop').ManualCropPageLayout) => Promise<{ ok: boolean }>
        generateSuggestions: (manifest: any, pageNumber: number, pageImagePath: string) => Promise<{ ok: boolean; result?: import('../../shared/types/manualCrop').PageCropSuggestionResult; error?: string }>
        loadSuggestions: (manifestDir: string, pageNumber: number) => Promise<{ ok: boolean; result?: import('../../shared/types/manualCrop').PageCropSuggestionResult; error?: string }>
        getReviewQueue: (workspacePath: string) => Promise<{ ok: boolean; queue?: import('../../shared/types/reviewQueue').DetectorReviewQueue; error?: string }>
        onPageCropProgress: (callback: (event: any) => void) => () => void
      }
      reviewWorkflow: {
        validateLayouts: (layouts: import('../../shared/types/manualCrop').ManualCropPageLayout[]) => Promise<import('../../shared/types/reviewWorkflow').LayoutValidationResult>
        runCropAndItemOcr: (input: import('../../shared/types/reviewWorkflow').CropAndItemOcrWorkflowInput) => Promise<import('../../shared/types/reviewWorkflow').CropAndItemOcrWorkflowResult>
        onProgress: (callback: (event: import('../../shared/types/reviewWorkflow').CropAndItemOcrProgressEvent) => void) => () => void
      }
      cropTemplates: {
        list: () => Promise<import('../../shared/types/cropLayoutTemplate').CropLayoutTemplate[]>
        save: (input: import('../../shared/types/cropLayoutTemplate').SaveCropLayoutTemplateInput) => Promise<import('../../shared/types/cropLayoutTemplate').CropLayoutTemplate>
        update: (templateId: string, patch: Partial<Pick<import('../../shared/types/cropLayoutTemplate').CropLayoutTemplate, 'name' | 'notes'>>) => Promise<import('../../shared/types/cropLayoutTemplate').CropLayoutTemplate>
        delete: (templateId: string) => Promise<void>
        duplicate: (templateId: string, newName?: string) => Promise<import('../../shared/types/cropLayoutTemplate').CropLayoutTemplate>
      }
      extractionPackage: {
        listAvailable: () => Promise<{ ok: boolean; extracts?: import('../../shared/types/extractionManifest').AvailableExtractionItem[]; error?: string }>
        openFolderDialog: () => Promise<string | null>
        open: (packagePath: string) => Promise<import('../../shared/types/extractionManifest').OpenExtractionPackageResult>
        validate: (packagePath: string) => Promise<import('../../shared/types/extractionManifest').ExtractionPackageValidationResult>
        continueExtraction: (packagePath: string) => Promise<import('../../shared/types/extractionManifest').ContinueExtractionResult>
        getDbEligibleItems: (packagePath: string) => Promise<import('../../shared/types/extractionManifest').DbEligiblePackageItem[]>
        updateMetadata: (input: { packagePath: string; patch: Partial<import('../../shared/types/extractionManifest').ExtractionManifest> }) => Promise<{ ok: boolean; manifest: import('../../shared/types/extractionManifest').ExtractionManifest; validation: import('../../shared/types/extractionManifest').ExtractionPackageValidationResult }>
      }
      styleProfileSelection: {
        listRenderedPages: (packagePath: string) => Promise<any>
        generateLeafletProfile: (input: any) => Promise<any>
        skip: (packagePath: string) => Promise<any>
        getStatus: (packagePath: string) => Promise<any>
      }
      prePublishPreview: {
        load: (workspacePath: string) => Promise<{ ok: boolean; summary?: import('../../shared/types/prePublishPreview').PrePublishPreviewSummary; error?: string }>
        markOpened: (workspacePath: string) => Promise<{ ok: boolean; error?: string }>
        publishApproved: (workspacePath: string, summaryCounts: any) => Promise<{ ok: boolean; error?: string }>
        getStatus: (workspacePath: string) => Promise<{ ok: boolean; status?: string; db_update_status?: string; error?: string }>
        setDbStatus: (workspacePath: string, status: 'completed' | 'failed') => Promise<{ ok: boolean; error?: string }>
        checkRehearsalGates: (workspacePath: string, typedConfirmation?: string) => Promise<any>
        getRehearsalConfig: () => Promise<any>
      }
      pageFirst: {
        processPage: (input: any) => Promise<any>
        processLeaflet: (input: any) => Promise<any>
        resume: (input: any) => Promise<any>
        rebuildCropsFromOcr: (input: any) => Promise<any>
        getStatus: (packageDir: string) => Promise<any>
        onProgress: (callback: (event: any) => void) => () => void
        onLog: (callback: (event: any) => void) => () => void
      }
    }
  }
}
