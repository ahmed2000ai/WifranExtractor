import { PageCropSuggestionResult } from '../../shared/types/manualCrop'

export async function suggestCropBoxesWithVisionModel(input: {
  pageNumber: number;
  pageImagePath: string;
  supermarketCode?: string | null;
}): Promise<PageCropSuggestionResult> {
  // Low-confidence fallback hook for future model-based layout detection
  // Must return a disabled/not_implemented result. Do not call Mistral here.
  return {
    pageNumber: input.pageNumber,
    pageImagePath: input.pageImagePath,
    strategy: 'none',
    confidence: 0,
    suggestedBoxes: [],
    diagnostics: {
      pageWidth: 0,
      pageHeight: 0,
      candidateCountBeforeFiltering: 0,
      candidateCountAfterFiltering: 0,
      rejectedCandidateCount: 0,
      reasonCodes: ['VISION_MODEL_NOT_IMPLEMENTED']
    },
    warnings: [
      {
        code: 'VISION_MODEL_NOT_IMPLEMENTED',
        message: 'Vision model suggestion is currently a stub and not implemented.'
      }
    ]
  }
}
