import { createContext, useContext, ReactNode } from 'react'
import { useImportForm } from '../hooks/useImportForm'
import { usePdfPreprocess } from '../hooks/usePdfPreprocess'
import { useOcrTest } from '../hooks/useOcrTest'
import { useOcrPipeline } from '../hooks/useOcrPipeline'
import { useImageCropping } from '../hooks/useImageCropping'
import { useImportTracking } from '../hooks/useImportTracking'
import { useEntityMatching } from '../hooks/useEntityMatching'
import { useOfferPreparation } from '../hooks/useOfferPreparation'
import { useOfferSync } from '../hooks/useOfferSync'
import { useCropAndItemOcrWorkflow } from '../hooks/useCropAndItemOcrWorkflow'
import { useStreamingPdfRender } from '../hooks/useStreamingPdfRender'
import { usePageFirstPipeline } from '../hooks/usePageFirstPipeline'

type PipelineContextType = {
  importForm: ReturnType<typeof useImportForm>
  pdfPreprocess: ReturnType<typeof usePdfPreprocess>
  ocrTest: ReturnType<typeof useOcrTest>
  ocrPipeline: ReturnType<typeof useOcrPipeline>
  imageCropping: ReturnType<typeof useImageCropping>
  importTracking: ReturnType<typeof useImportTracking>
  entityMatching: ReturnType<typeof useEntityMatching>
  offerPreparation: ReturnType<typeof useOfferPreparation>
  offerSync: ReturnType<typeof useOfferSync>
  cropAndItemOcr: ReturnType<typeof useCropAndItemOcrWorkflow>
  streamingPdfRender: ReturnType<typeof useStreamingPdfRender>
  pageFirstPipeline: ReturnType<typeof usePageFirstPipeline>
}

const PipelineContext = createContext<PipelineContextType | undefined>(undefined)

export function PipelineProvider({ children }: { children: ReactNode }) {
  const importForm = useImportForm()
  const pdfPreprocess = usePdfPreprocess()
  const ocrTest = useOcrTest()
  const ocrPipeline = useOcrPipeline()
  const imageCropping = useImageCropping()
  const importTracking = useImportTracking()
  const entityMatching = useEntityMatching()
  const offerPreparation = useOfferPreparation()
  const offerSync = useOfferSync()
  const cropAndItemOcr = useCropAndItemOcrWorkflow()
  const streamingPdfRender = useStreamingPdfRender()
  const pageFirstPipeline = usePageFirstPipeline()

  return (
    <PipelineContext.Provider value={{
      importForm,
      pdfPreprocess,
      ocrTest,
      ocrPipeline,
      imageCropping,
      importTracking,
      entityMatching,
      offerPreparation,
      offerSync,
      cropAndItemOcr,
      streamingPdfRender,
      pageFirstPipeline
    }}>
      {children}
    </PipelineContext.Provider>
  )
}

export function usePipelineContext() {
  const context = useContext(PipelineContext)
  if (!context) throw new Error('usePipelineContext must be used within a PipelineProvider')
  return context
}
