import { useMemo } from 'react'
import { usePipelineContext } from '../context/PipelineContext'
import { buildPipelineSummary } from '../../../shared/utils/pipelineSummaryBuilder'
import type { PipelineSummary } from '../../../shared/types/pipelineSummary'

export function usePipelineSummary(): PipelineSummary {
  const ctx = usePipelineContext()

  const summary = useMemo(() => {
    return buildPipelineSummary({
      formState: ctx.importForm.formState,
      pdfPreprocessResult: ctx.pdfPreprocess.result,
      ocrPipelineResult: ctx.ocrPipeline.result,
      imageCroppingResult: ctx.imageCropping.result,
      importTrackingResult: ctx.importTracking.result,
      entityMatchingResult: ctx.entityMatching.result,
      offerPreparationResult: ctx.offerPreparation.result,
      offerSyncResult: ctx.offerSync.result
    })
  }, [
    ctx.importForm.formState,
    ctx.pdfPreprocess.result,
    ctx.ocrPipeline.result,
    ctx.imageCropping.result,
    ctx.importTracking.result,
    ctx.entityMatching.result,
    ctx.offerPreparation.result,
    ctx.offerSync.result
  ])

  return summary
}
