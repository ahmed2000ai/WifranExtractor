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
        verifySchemaReadiness: (context?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST') => Promise<any>
      }
      reference: {
        loadAll: () => Promise<import('../../shared/types/referenceData').ReferenceDataLoadResult>
        loadSupermarkets: () => Promise<import('../../shared/types/referenceData').ReferenceDataLoadResult>
        loadLocationsForSupermarket: (supermarketId: string) => Promise<import('../../shared/types/referenceData').ReferenceDataLoadResult>
      }
      files: {
        selectPdf: () => Promise<import('../../shared/types/importForm').SelectedPdfFile | null>
        selectMultiplePdfs: () => Promise<import('../../shared/types/importForm').SelectedPdfFile[]>
      }
      pdf: {
        getPageCount: (filePath: string) => Promise<number>
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
        publishApproved: (workspacePath: string, summaryCounts: any, options?: { forceRePublish?: boolean }) => Promise<{ ok: boolean; result?: import('../../shared/types/offerSync').OfferSyncResult; error?: string }>
        getStatus: (workspacePath: string) => Promise<{ ok: boolean; status?: string; db_update_status?: string; published_at?: string | null; folder_name?: string | null; error?: string }>
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
      catalog: {
        analyzeCandidates: (options?: any) => Promise<import('../shared/types/catalogResolution').AnalyzeOfferCatalogCandidatesResult>
        approveCandidates: (input: import('../shared/types/catalogResolution').ApproveCatalogCandidatesInput) => Promise<import('../shared/types/catalogResolution').ApproveCatalogCandidatesResult>
        exportImageCsv: (options?: any) => Promise<import('../shared/types/productImageEnrichment').ExportHybridImageRefsResult>
        saveExportedCsvDialog: (options: { defaultFileName?: string; csvContent: string }) => Promise<{ canceled: boolean; filePath?: string }>
        validateImageCsv: (csvContent: string) => Promise<import('../shared/types/productImageEnrichment').CsvValidationSummary>
        uploadProductImages: (input: import('../shared/types/productImageEnrichment').UploadProductImagesInput) => Promise<import('../shared/types/productImageEnrichment').UploadProductImagesResult>
        onUploadProgress: (callback: (event: any) => void) => () => void
        publishStagedDraft: (jobDir: string, options?: import('../shared/types/productImageEnrichment').PublishStagedLeafletOptions) => Promise<import('../shared/types/productImageEnrichment').PublishStagedLeafletResult>
      }
      productEnrichment: {
        exportCsv: (options?: any) => Promise<import('../shared/types/productImageEnrichment').ExportHybridImageRefsResult>
        saveCsvDialog: (options: { defaultFileName?: string; csvContent: string }) => Promise<{ canceled: boolean; filePath?: string }>
        validateCsv: (csvContent: string) => Promise<import('../shared/types/productImageEnrichment').CsvValidationSummary>
        uploadImages: (input: import('../shared/types/productImageEnrichment').UploadProductImagesInput) => Promise<import('../shared/types/productImageEnrichment').UploadProductImagesResult>
        importStep2Csv: (jobDir: string, csvContent: string, options?: any) => Promise<import('../shared/types/productImageEnrichment').ImportStep2CsvResult>
        updateHeader: (jobDir: string, headerPatch: any) => Promise<import('../shared/types/productImageEnrichment').StagedLeafletDraft>
        updateOfferField: (jobDir: string, offerId: string, fieldUpdates: any) => Promise<import('../shared/types/productImageEnrichment').StagedLeafletDraft>
        revertOfferField: (jobDir: string, offerId: string, fieldName?: string) => Promise<import('../shared/types/productImageEnrichment').StagedLeafletDraft>
        replaceConsumerImage: (jobDir: string, offerId: string, replacement: any) => Promise<import('../shared/types/productImageEnrichment').StagedLeafletDraft>
        loadDraft: (jobDir: string) => Promise<import('../shared/types/productImageEnrichment').StagedLeafletDraft | null>
        initializeDraft: (jobDir: string, options?: { metadataPageNumber?: number | null; pdfFileName?: string | null; pdfFilePath?: string | null; [key: string]: any }) => Promise<import('../shared/types/productImageEnrichment').StagedLeafletDraft>
        exportStep1Csv: (jobDir: string, options?: any) => Promise<import('../shared/types/productImageEnrichment').ExportStagedLeafletResult>
        publishStagedDraft: (jobDir: string, options?: import('../shared/types/productImageEnrichment').PublishStagedLeafletOptions) => Promise<import('../shared/types/productImageEnrichment').PublishStagedLeafletResult>
        selectCsvDialog: () => Promise<{ canceled: boolean; filePath?: string; content?: string }>
        selectImageDialog: () => Promise<{ canceled: boolean; filePath?: string }>
        getSupermarketsAndRegions: () => Promise<{ supermarkets: any[]; regions: any[] }>
        resolveSupermarket: (rawName: string) => Promise<import('../shared/types/productImageEnrichment').ResolvedEntity>
        resolveRegion: (rawName: string) => Promise<import('../shared/types/productImageEnrichment').ResolvedEntity>
      }
      metadata: {
        discover: (input: any) => Promise<{ ok: boolean; data?: any; error?: string }>
        discoverFromPackage: (packageDir: string, options?: any) => Promise<{ ok: boolean; data?: any; error?: string }>
        get: (fingerprint: string) => Promise<{ ok: boolean; data?: any; error?: string }>
        confirm: (input: any) => Promise<{ ok: boolean; data?: any; error?: string }>
        invalidate: (fingerprint: string) => Promise<{ ok: boolean; error?: string }>
        validatePublishReadiness: (input: any) => Promise<{ ok: boolean; error?: string; confirmedRecord?: any }>
        grantBudgetExtension: (fingerprint: string, additionalAttempts: number) => Promise<{ success: boolean; newAllowance: number; error?: string }>
        getBudgetStatus: (fingerprint: string) => Promise<{ ok: boolean; data?: any; error?: string }>
      }
      batch: {
        backfillHistory: (options?: {
          extractsDir?: string
          pdfSearchDirs?: string[]
          pruneStaleMissingEntries?: boolean
        }) => Promise<any>
        inspectDuplicates: (input: {
          files: Array<{
            path?: string
            filePath?: string
            name?: string
            fileName?: string
            pageCount?: number
            pagesToProcess?: number[]
            selectedPages?: number[]
            contentFingerprint?: string
          }>
          extractionPipelineMode?: import('../shared/types/batchExtraction').ExtractionPipelineMode
          forceReextract?: boolean
        }) => Promise<{
          totalSelectedFiles?: number
          totalSelectedPages: number
          totalReusedPages?: number
          totalReusablePages?: number
          totalPayablePages: number
          hasDuplicatesOrOverlaps?: boolean
          summaryMessage?: string
          adjustedEstimatedLowUsd?: number
          adjustedEstimatedHighUsd?: number
          matches?: Array<{
            fileName: string
            filePath: string
            reusedPages: number[]
            payablePages: number[]
            matchedFilenameHistory: boolean
            previousBatchIds: string[]
          }>
          perFile?: Array<{
            filePath: string
            fileName: string
            fileFingerprint: string | null
            documentId: string
            targetPages: number[]
            reusablePages: number[]
            payablePages: number[]
            classification:
              | 'exact_duplicate_full_reuse'
              | 'partial_page_overlap_reuse'
              | 'within_batch_binary_duplicate'
              | 'filename_collision_different_content'
              | 'incompatible_or_corrupted_history'
              | 'new_document'
            matchedPriorFileName?: string | null
            matchedPriorWorkspace?: string | null
            incompatibilityReasons: string[]
          }>
        }>
        create: (input: {
          files: Array<{
            path: string
            name?: string
            sizeBytes?: number
            contentFingerprint?: string
            pageCount?: number
            pagesToProcess?: number[]
            pageSelectionMode?: import('../shared/types/batchExtraction').PageSelectionMode
            pageSelectionInput?: string
            metadata?: import('../shared/types/batchExtraction').LeafletMetadataScope
          }>
          executionMode?: 'flex' | 'standard'
          extractionPipelineMode?: import('../shared/types/batchExtraction').ExtractionPipelineMode
          model?: string
          approvedMaxBudgetUsd?: number | null
          autoRunCatalogMatching?: boolean
          targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
        }) => Promise<import('../shared/types/batchExtraction').BatchManifest>
        start: (input: {
          batchId: string
          forceReextract?: boolean
          hybridV3ExplicitAuthorization?: boolean
          hybridV3FeatureEnabled?: boolean
          hybridV3ExplicitLiveAuthorization?: boolean
          disablePageContextVerification?: boolean
          reauthorizeExpandedScope?: boolean
          approvedMaxBudgetUsd?: number | null
          approvedAdditionalBudgetUsd?: number
          skipMetadataVerificationCheck?: boolean
          autoRunCatalogMatching?: boolean
          targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
        }) => Promise<import('../shared/types/batchExtraction').BatchManifest>
        cancel: (batchId: string) => Promise<import('../shared/types/batchExtraction').BatchManifest>
        resume: (input: {
          batchId: string
          forceReextract?: boolean
          hybridV3ExplicitAuthorization?: boolean
          hybridV3FeatureEnabled?: boolean
          hybridV3ExplicitLiveAuthorization?: boolean
          reauthorizeExpandedScope?: boolean
          approvedMaxBudgetUsd?: number | null
          approvedAdditionalBudgetUsd?: number
          disablePageContextVerification?: boolean
          skipMetadataVerificationCheck?: boolean
          autoRunCatalogMatching?: boolean
          targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
        }) => Promise<import('../shared/types/batchExtraction').BatchManifest>
        getManifest: (batchId: string) => Promise<import('../shared/types/batchExtraction').BatchManifest | null>
        list: () => Promise<import('../shared/types/batchExtraction').BatchManifest[]>
        getUnifiedOffers: (input: { batchId: string; filters?: import('../shared/types/batchExtraction').BatchFilterOptions }) => Promise<import('../shared/types/batchExtraction').UnifiedBatchOffer[]>
        getSummary: (batchId: string) => Promise<import('../shared/types/batchExtraction').UnifiedBatchSummary>
        discoverLeafletMetadata: (input: { batchId: string; leafletId: string; catalogSupermarkets?: any[]; throwOnError?: boolean; forceRefresh?: boolean }) => Promise<import('../shared/types/batchExtraction').BatchManifest>
        getMetadataVisionCostEstimate: (input: { batchId: string; leafletId: string }) => Promise<{
          ok: boolean
          targetPages: number[]
          estimate: import('../shared/utils/geminiPricingAndCostEstimator').MetadataVisionCostEstimate
          error?: string
        }>
        discoverLeafletMetadataWithVision: (input: {
          batchId: string
          leafletId: string
          explicitVisionAuthorization: boolean
          forceRefresh?: boolean
          throwOnError?: boolean
        }) => Promise<import('../shared/types/batchExtraction').BatchManifest>
        getCoverPreview: (input: { batchId: string; leafletId: string }) => Promise<{ ok: boolean; dataUrl?: string; previewPath?: string; error?: string }>
        updateLeafletMetadata: (input: { batchId: string; leafletId: string; metadata: Partial<import('../shared/types/batchExtraction').LeafletMetadataScope>; verified?: boolean; operatorId?: string }) => Promise<import('../shared/types/batchExtraction').BatchManifest>
        updateOfferFields: (input: { batchId: string; batchOfferKey: string; operatorId?: string; patch: Record<string, any> }) => Promise<import('../shared/types/batchExtraction').UnifiedBatchOffer>
        resolveOfferAsAssorted: (input: { batchId: string; batchOfferKey: string; operatorId?: string; customTitleEn?: string; customTitleAr?: string }) => Promise<import('../shared/types/batchExtraction').UnifiedBatchOffer>
        selectAndReplaceOfferImage: (input: { batchId: string; batchOfferKey: string; customFilePath?: string }) => Promise<{ success: boolean; canceled?: boolean; updatedOffer?: import('../shared/types/batchExtraction').UnifiedBatchOffer; error?: string }>
        restoreDefaultOfferImage: (input: { batchId: string; batchOfferKey: string }) => Promise<{ success: boolean; updatedOffer?: import('../shared/types/batchExtraction').UnifiedBatchOffer; error?: string }>
        updatePublishedOfferImage: (input: { batchId: string; batchOfferKey: string; operatorConfirmed: boolean; databaseContext?: any }) => Promise<{ success: boolean; newImageUrl?: string; error?: string }>
        confirmDerivedTierCrop: (input: { batchId: string; batchOfferKey: string }) => Promise<{ confirmed: boolean; metaPath: string | null }>
        previewPublishedOfferImageRepairs: (input: { batchId: string; confirmedCropOfferKeys?: string[]; databaseContext?: any }) => Promise<import('../shared/types/batchExtraction').PublishedOfferImageRepairResult>
        repairPublishedOfferImages: (input: { batchId: string; operatorAuthorizedRepair?: boolean; operatorAuthorizedIdentityCorrection?: boolean; confirmedCropOfferKeys?: string[]; operatorId?: string; databaseContext?: any }) => Promise<import('../shared/types/batchExtraction').PublishedOfferImageRepairResult>
        getActiveSession: () => Promise<import('../shared/types/batchExtraction').ActiveWorkflowSession | null>
        setActiveSession: (session: import('../shared/types/batchExtraction').ActiveWorkflowSession) => Promise<boolean>
        clearActiveSession: () => Promise<boolean>
        split: (input: { sourceBatchId: string; selectedLeafletIds: string[] }) => Promise<{
          success: boolean
          newBatchId: string | null
          manifest: import('../shared/types/batchExtraction').BatchManifest
          transferredLeafletCount: number
        }>
        onProgress: (callback: (event: import('../shared/types/batchExtraction').BatchProgressEvent) => void) => () => void
      }
      matching: {
        estimate: (batchId: string) => Promise<import('../shared/types/catalogMatching').MatchingPreflightEstimate>
        start: (input: {
          batchId: string
          mode?: 'full' | 'resume'
          approvedByOperator: boolean
          approvedMaxBudgetUsd: number
          flexTimeoutMs?: number
          targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
        }) => Promise<import('../shared/types/catalogMatching').MatchingRunManifest>
        pause: (batchId: string) => Promise<{ accepted: boolean; message: string }>
        cancel: (batchId: string) => Promise<{ accepted: boolean; message: string }>
        getRetryFailedSummary: (
          batchId: string
        ) => Promise<import('../shared/types/catalogMatching').RetryFailedPreflightSummary>
        retryFailedOnly: (input: {
          batchId: string
          approvedByOperator: boolean
          approvedMaxBudgetUsd: number
          targetRequestKeys?: string[]
          flexTimeoutMs?: number
          targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
        }) => Promise<import('../shared/types/catalogMatching').MatchingRunManifest>
        getStatus: (batchId: string) => Promise<import('../shared/types/catalogMatching').MatchingRunManifest | null>
        saveDecision: (input: {
          batchId: string
          batchOfferKey?: string
          temporaryId?: string
          decision: import('../shared/types/catalogMatching').OperatorDecisionStatus
          linkedPermanentProductId?: string
          operatorNotes?: string
          targetType?: 'catalog' | 'non_catalog'
          nonCatalogCategory?: import('../shared/types/catalogMatching').NonCatalogEligibilityCategory | null
        }) => Promise<import('../shared/types/catalogMatching').MatchingRunManifest>
        saveConsumerImageApproval: (input: {
          batchId: string
          batchOfferKey: string
          decision: 'approve_generated_crop' | 'reuse_existing_catalog_image' | 'reject'
          productThumbCropPath?: string | null
          existingCatalogImageUrl?: string | null
          imageSubjectScope?: string | null
          boundProductKey?: string | null
          boundProductLabel?: string | null
          rightsBasis?: string | null
          verifiedBy?: string | null
        }) => Promise<import('../shared/types/catalogMatching').MatchingRunManifest>
        publishApproved: (input: {
          batchId: string
          operatorId: string
          targetContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
          operatorAuthorizedDevPublish?: boolean
          operatorAuthorizedProductionPublish?: boolean
          allowExpiredForDevTest?: boolean
          preflightOnly?: boolean
          idempotencyKey?: string
          approvedUpdateSourceIds?: string[]
          approveAllUpdates?: boolean
          enforceUpdateApproval?: boolean
          overrideConflictSourceIds?: string[]
        }) => Promise<any>
        getPublicationHistory: (input?: {
          context?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
          limit?: number
          statusFilter?: string | null
          batchIdFilter?: string | null
        }) => Promise<any[]>
        getPublicationOperationDetails: (input: {
          context?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
          publishOperationId: string
        }) => Promise<any>
        previewUndoLastPublish: (input?: {
          context?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
          publishOperationId?: string | null
        }) => Promise<any>
        undoLastPublish: (input: {
          context?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
          operatorId: string
          reason: string
          publishOperationId?: string | null
          operatorAuthorizedProductionPublish?: boolean
        }) => Promise<any>
        retryUndoStorageCleanup: (input: {
          context?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
          publishOperationId: string
          operatorAuthorizedProductionPublish?: boolean
        }) => Promise<any>
        onProgress: (callback: (event: import('../shared/types/catalogMatching').MatchingProgressEvent) => void) => () => void
      }
    }
  }
}
