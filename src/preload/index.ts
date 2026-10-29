import { contextBridge, ipcRenderer } from 'electron'

const api = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
    getHealth: (): Promise<any> => ipcRenderer.invoke('app:getHealth')
  },
  config: {
    getStatus: (): Promise<any> => ipcRenderer.invoke('config:getStatus')
  },
  reference: {
    loadAll: (): Promise<any> => ipcRenderer.invoke('reference:loadAll'),
    loadSupermarkets: (): Promise<any> => ipcRenderer.invoke('reference:loadSupermarkets'),
    loadLocationsForSupermarket: (supermarketId: string): Promise<any> => ipcRenderer.invoke('reference:loadLocationsForSupermarket', { supermarketId })
  },
  files: {
    selectPdf: (): Promise<any> => ipcRenderer.invoke('file:selectPdf')
  },
  pdf: {
    preprocess: (input: any): Promise<any> => ipcRenderer.invoke('pdf:preprocess', input),
    onPreprocessProgress: (callback: (event: any) => void) => {
      const listener = (_event: any, arg: any) => callback(arg)
      ipcRenderer.on('pdf:preprocess-progress', listener)
      return () => {
        ipcRenderer.removeListener('pdf:preprocess-progress', listener)
      }
    },
    renderStreaming: (input: any): Promise<any> => ipcRenderer.invoke('pdf:renderStreaming', input),
    onRenderStreamingProgress: (callback: (event: any) => void) => {
      const listener = (_event: any, arg: any) => callback(arg)
      ipcRenderer.on('pdf:renderStreamingProgress', listener)
      return () => {
        ipcRenderer.removeListener('pdf:renderStreamingProgress', listener)
      }
    }
  },
  ocr: {
    testSingleChunk: (input: any): Promise<any> => ipcRenderer.invoke('ocr:testSingleChunk', input),
    runPipeline: (input: any): Promise<any> => ipcRenderer.invoke('ocr:runPipeline', input),
    onPipelineProgress: (callback: any) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('ocr:pipeline-progress', listener)
      return () => {
        ipcRenderer.removeListener('ocr:pipeline-progress', listener)
      }
    },
    retryFailedChunks: (input: any): Promise<any> => ipcRenderer.invoke('ocr:retryFailedChunks', input),
    onRetryProgress: (callback: any) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('ocr:retry-progress', listener)
      return () => {
        ipcRenderer.removeListener('ocr:retry-progress', listener)
      }
    }
  },
  image: {
    cropOcrRows: (input: any): Promise<any> => ipcRenderer.invoke('image:cropOcrRows', input),
    onCropProgress: (callback: any) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('image:crop-progress', listener)
      return () => {
        ipcRenderer.removeListener('image:crop-progress', listener)
      }
    }
  },
  importTracking: {
    persist: (input: any): Promise<any> => ipcRenderer.invoke('importTracking:persist', input)
  },
  entityMatching: {
    matchRows: (input: any): Promise<any> => ipcRenderer.invoke('entityMatching:matchRows', input)
  },
  offerPreparation: {
    prepare: (input: any): Promise<any> => ipcRenderer.invoke('offerPreparation:prepare', input)
  },
  offerSync: {
    syncPreparedOffers: (input: any): Promise<any> => ipcRenderer.invoke('offerSync:syncPreparedOffers', input),
    onProgress: (callback: (event: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('offerSync:progress', listener)
      return () => {
        ipcRenderer.removeListener('offerSync:progress', listener)
      }
    }
  },
  prePublishPreview: {
    load: (workspacePath: string): Promise<any> => ipcRenderer.invoke('prePublishPreview:load', workspacePath),
    markOpened: (workspacePath: string): Promise<any> => ipcRenderer.invoke('prePublishPreview:markOpened', workspacePath),
    publishApproved: (workspacePath: string, summaryCounts: any): Promise<any> => ipcRenderer.invoke('prePublishPreview:publishApproved', workspacePath, summaryCounts),
    getStatus: (workspacePath: string): Promise<any> => ipcRenderer.invoke('prePublishPreview:getStatus', workspacePath),
    setDbStatus: (workspacePath: string, status: 'completed' | 'failed'): Promise<any> => ipcRenderer.invoke('prePublishPreview:setDbStatus', workspacePath, status),
    checkRehearsalGates: (workspacePath: string, typedConfirmation?: string): Promise<any> => ipcRenderer.invoke('prePublishPreview:checkRehearsalGates', workspacePath, typedConfirmation),
    getRehearsalConfig: (): Promise<any> => ipcRenderer.invoke('prePublishPreview:getRehearsalConfig')
  },
  manualCrop: {
    saveSession: (workspacePath: string, session: any): Promise<any> => ipcRenderer.invoke('manualCrop:saveSession', workspacePath, session),
    loadSession: (workspacePath: string): Promise<any> => ipcRenderer.invoke('manualCrop:loadSession', workspacePath),
    cropPage: (input: any): Promise<any> => ipcRenderer.invoke('manualCrop:cropPage', input),
    cropAllPages: (input: any): Promise<any> => ipcRenderer.invoke('manualCrop:cropAllPages', input),
    enqueuePageCrop: (workspacePath: string, layout: any): Promise<any> => ipcRenderer.invoke('manualCrop:enqueuePageCrop', { workspacePath, layout }),
    generateSuggestions: (manifest: any, pageNumber: number, pageImagePath: string): Promise<any> => ipcRenderer.invoke('manualCrop:generateSuggestions', { manifest, pageNumber, pageImagePath }),
    loadSuggestions: (manifestDir: string, pageNumber: number): Promise<any> => ipcRenderer.invoke('manualCrop:loadSuggestions', { manifestDir, pageNumber }),
    getReviewQueue: (workspacePath: string): Promise<any> => ipcRenderer.invoke('manualCrop:getReviewQueue', workspacePath),
    onPageCropProgress: (callback: (event: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('manualCrop:pageCropProgress', listener)
      return () => {
        ipcRenderer.removeListener('manualCrop:pageCropProgress', listener)
      }
    }
  },
  reviewWorkflow: {
    validateLayouts: (layouts: any[]): Promise<any> => ipcRenderer.invoke('reviewWorkflow:validateLayouts', layouts),
    runCropAndItemOcr: (input: any): Promise<any> => ipcRenderer.invoke('reviewWorkflow:runCropAndItemOcr', input),
    onProgress: (callback: (event: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('reviewWorkflow:progress', listener)
      return () => {
        ipcRenderer.removeListener('reviewWorkflow:progress', listener)
      }
    }
  },
  cropTemplates: {
    list: (): Promise<any> => ipcRenderer.invoke('cropTemplates:list'),
    save: (input: any): Promise<any> => ipcRenderer.invoke('cropTemplates:save', input),
    update: (templateId: string, patch: any): Promise<any> => ipcRenderer.invoke('cropTemplates:update', templateId, patch),
    delete: (templateId: string): Promise<any> => ipcRenderer.invoke('cropTemplates:delete', templateId),
    duplicate: (templateId: string, newName?: string): Promise<any> => ipcRenderer.invoke('cropTemplates:duplicate', templateId, newName)
  },
  extractionPackage: {
    listAvailable: (): Promise<any> => ipcRenderer.invoke('extractionPackage:listAvailable'),
    openFolderDialog: (): Promise<any> => ipcRenderer.invoke('extractionPackage:openFolderDialog'),
    open: (packagePath: string): Promise<any> => ipcRenderer.invoke('extractionPackage:open', packagePath),
    validate: (packagePath: string): Promise<any> => ipcRenderer.invoke('extractionPackage:validate', packagePath),
    continueExtraction: (packagePath: string): Promise<any> => ipcRenderer.invoke('extractionPackage:continue', packagePath),
    getDbEligibleItems: (packagePath: string): Promise<any> => ipcRenderer.invoke('extractionPackage:getDbEligibleItems', packagePath),
    updateMetadata: (input: any): Promise<any> => ipcRenderer.invoke('extractionPackage:updateMetadata', input)
  },
  styleProfileSelection: {
    listRenderedPages: (packagePath: string): Promise<any> => ipcRenderer.invoke('styleProfileSelection:listRenderedPages', packagePath),
    generateLeafletProfile: (input: any): Promise<any> => ipcRenderer.invoke('styleProfileSelection:generateLeafletProfile', input),
    skip: (packagePath: string): Promise<any> => ipcRenderer.invoke('styleProfileSelection:skip', packagePath),
    getStatus: (packagePath: string): Promise<any> => ipcRenderer.invoke('styleProfileSelection:getStatus', packagePath)
  },
  pageFirst: {
    processPage: (input: any): Promise<any> => ipcRenderer.invoke('pageFirst:processPage', input),
    processLeaflet: (input: any): Promise<any> => ipcRenderer.invoke('pageFirst:processLeaflet', input),
    resume: (input: any): Promise<any> => ipcRenderer.invoke('pageFirst:resume', input),
    rebuildCropsFromOcr: (input: any): Promise<any> => ipcRenderer.invoke('pageFirst:rebuildCropsFromOcr', input),
    getStatus: (packageDir: string): Promise<any> => ipcRenderer.invoke('pageFirst:getStatus', packageDir),
    quickTestPage: (input: any): Promise<any> => ipcRenderer.invoke('pageFirst:quickTestPage', input),
    onProgress: (callback: (event: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('pageFirst:progress', listener)
      return () => {
        ipcRenderer.removeListener('pageFirst:progress', listener)
      }
    },
    onLog: (callback: (log: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('pageFirst:log', listener)
      return () => {
        ipcRenderer.removeListener('pageFirst:log', listener)
      }
    },
    onQuickTestProgress: (callback: (event: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('pageFirst:quickTestProgress', listener)
      return () => {
        ipcRenderer.removeListener('pageFirst:quickTestProgress', listener)
      }
    },
    onQuickTestLog: (callback: (log: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('pageFirst:quickTestLog', listener)
      return () => {
        ipcRenderer.removeListener('pageFirst:quickTestLog', listener)
      }
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('wifranExtractor', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.wifranExtractor = api
}
