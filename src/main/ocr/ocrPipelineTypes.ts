import type { OcrPipelineInput, OcrPipelineProgressEvent, OcrPipelineResult } from '../../shared/types/ocrJob'

export type OcrPipelineService = {
  runOcrPipeline(
    input: OcrPipelineInput,
    onProgress?: (event: OcrPipelineProgressEvent) => void
  ): Promise<OcrPipelineResult>
}
