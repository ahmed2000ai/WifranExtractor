import { describe, it, expect } from 'vitest'
import { evaluateBoxCompleteness, splitOverMergedBoxes } from '../cropSuggestionSplitting'
import { SuggestedCropBox } from '../../../shared/types/manualCrop'
import { PriceAnchorGroup } from '../../../shared/types/priceAnchors'

describe('cropSuggestionSplitting', () => {
  it('should flag multi-anchor boxes for review', () => {
    const boxes: SuggestedCropBox[] = [{
      id: 'box1',
      pageNumber: 1,
      x: 0, y: 0, width: 100, height: 100,
      confidence: 1.0,
      source: 'local_cv_detection',
      reasonCodes: [],
      status: 'suggested'
    }]
    const anchors: PriceAnchorGroup[] = [
      {
        id: 'a1',
        pageNumber: 1,
        bounds: { x: 20, y: 20, width: 10, height: 10 },
        currentPriceRegion: { bounds: { x: 20, y: 20, width: 10, height: 10 }, confidence: 0.9 },
        originalPriceRegions: [],
        currencyRegions: [],
        confidence: 0.9,
        reasonCodes: []
      },
      {
        id: 'a2',
        pageNumber: 1,
        bounds: { x: 70, y: 70, width: 10, height: 10 },
        currentPriceRegion: { bounds: { x: 70, y: 70, width: 10, height: 10 }, confidence: 0.9 },
        originalPriceRegions: [],
        currencyRegions: [],
        confidence: 0.9,
        reasonCodes: []
      }
    ]
    
    const result = evaluateBoxCompleteness(1, 1000, 1000, boxes, anchors)
    expect(result.status).toBe('review_required')
    expect(result.multiAnchorBoxIds).toContain('box1')
  })

  it('should split over-merged boxes correctly', () => {
    const boxes: SuggestedCropBox[] = [{
      id: 'box1',
      pageNumber: 1,
      x: 0, y: 0, width: 100, height: 100,
      confidence: 1.0,
      source: 'local_cv_detection',
      reasonCodes: [],
      status: 'suggested'
    }]
    const anchors: PriceAnchorGroup[] = [
      {
        id: 'a1',
        pageNumber: 1,
        bounds: { x: 20, y: 20, width: 10, height: 10 },
        currentPriceRegion: { bounds: { x: 20, y: 20, width: 10, height: 10 }, confidence: 0.9 },
        originalPriceRegions: [],
        currencyRegions: [],
        confidence: 0.9,
        reasonCodes: []
      },
      {
        id: 'a2',
        pageNumber: 1,
        bounds: { x: 70, y: 70, width: 10, height: 10 },
        currentPriceRegion: { bounds: { x: 70, y: 70, width: 10, height: 10 }, confidence: 0.9 },
        originalPriceRegions: [],
        currencyRegions: [],
        confidence: 0.9,
        reasonCodes: []
      }
    ]
    
    const splitBoxes = splitOverMergedBoxes(1000, 1000, boxes, anchors)
    expect(splitBoxes.length).toBe(2)
    expect(splitBoxes[0].source).toBe('price_anchor_split')
  })
})
