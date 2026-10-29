import crypto from 'crypto'
import { SuggestedCropBox } from '../../shared/types/manualCrop'
import { PriceAnchorGroup, OfferBoxAnchorDiagnostic, PageOfferCompletenessResult } from '../../shared/types/priceAnchors'

function getCenter(bounds: { x: number, y: number, width: number, height: number }) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  }
}

function containsCenter(box: { x: number, y: number, width: number, height: number }, bounds: { x: number, y: number, width: number, height: number }) {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  return cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height
}

export function evaluateBoxCompleteness(
  pageNumber: number,
  _pageWidth: number,
  _pageHeight: number,
  boxes: SuggestedCropBox[],
  anchors: PriceAnchorGroup[]
): PageOfferCompletenessResult {
  const uncoveredAnchorIds = new Set<string>(anchors.map(a => a.id))
  const duplicateAnchorIds = new Set<string>()
  const multiAnchorBoxIds = new Set<string>()
  const anchorlessBoxIds = new Set<string>()

  const boxDiagnostics: OfferBoxAnchorDiagnostic[] = []

  for (const box of boxes) {
    const containedAnchors = anchors.filter(a => containsCenter(box, a.bounds))
    
    containedAnchors.forEach(a => {
      if (!uncoveredAnchorIds.has(a.id)) {
        // It was already covered by another box -> duplicate!
        duplicateAnchorIds.add(a.id)
      } else {
        uncoveredAnchorIds.delete(a.id)
      }
    })

    let status: OfferBoxAnchorDiagnostic['status'] = 'valid_single_anchor'
    if (containedAnchors.length === 0) {
      status = 'no_anchor_requires_review'
      anchorlessBoxIds.add(box.id)
    } else if (containedAnchors.length > 1) {
      status = 'multi_anchor_requires_split'
      multiAnchorBoxIds.add(box.id)
    }

    boxDiagnostics.push({
      boxId: box.id,
      containedAnchorGroupIds: containedAnchors.map(a => a.id),
      containedIndependentCurrentPriceCount: containedAnchors.length,
      uncoveredAnchorGroupIds: [], // We calculate global uncovers below
      status,
      reasonCodes: [status]
    })
  }

  const largeUncoveredRegions: Array<{x: number, y: number, width: number, height: number}> = []
  // (We skip calculating largeUncoveredRegions for brevity unless specifically needed)

  const isFailed = uncoveredAnchorIds.size > 0 || duplicateAnchorIds.size > 0 || multiAnchorBoxIds.size > 0
  
  return {
    pageNumber,
    status: isFailed ? 'review_required' : 'complete', // "failed" or "review_required" based on safety gate
    priceAnchorCount: anchors.length,
    suggestedBoxCount: boxes.length,
    uncoveredAnchorIds: Array.from(uncoveredAnchorIds),
    duplicateAnchorIds: Array.from(duplicateAnchorIds),
    multiAnchorBoxIds: Array.from(multiAnchorBoxIds),
    anchorlessBoxIds: Array.from(anchorlessBoxIds),
    largeUncoveredRegions,
    score: isFailed ? 0 : 1,
    reasonCodes: isFailed ? ['COMPLETENESS_CHECK_FAILED'] : ['COMPLETENESS_CHECK_PASSED']
  }
}

export function splitOverMergedBoxes(
  pageWidth: number,
  pageHeight: number,
  boxes: SuggestedCropBox[],
  anchors: PriceAnchorGroup[]
): SuggestedCropBox[] {
  let finalBoxes: SuggestedCropBox[] = []

  for (const box of boxes) {
    const containedAnchors = anchors.filter(a => containsCenter(box, a.bounds))
    
    if (containedAnchors.length <= 1) {
      finalBoxes.push(box) // Keep valid or anchorless boxes
      continue
    }

    // Split over-merged region!
    // Construct Voronoi partitions around each anchor center inside the original box.
    // For simplicity, we assign each pixel coordinate in the box to the nearest anchor center.
    // Then calculate the bounding box of those pixels.

    const newBoxes = containedAnchors.map(a => {
      let minX = box.x + box.width
      let maxX = box.x
      let minY = box.y + box.height
      let maxY = box.y

      // Sample points within the box to find the boundary
      // A faster way than pixel-by-pixel: just compute the midlines between anchors.
      for (let y = Math.floor(box.y); y <= Math.ceil(box.y + box.height); y += 5) {
        for (let x = Math.floor(box.x); x <= Math.ceil(box.x + box.width); x += 5) {
          // Find nearest anchor
          let nearestId = ''
          let minDist = Infinity
          for (const ca of containedAnchors) {
            const caC = getCenter(ca.bounds)
            const dist = Math.hypot(x - caC.x, y - caC.y)
            if (dist < minDist) {
              minDist = dist
              nearestId = ca.id
            }
          }

          if (nearestId === a.id) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }

      return {
        id: crypto.randomUUID(),
        pageNumber: box.pageNumber,
        x: Math.max(0, minX),
        y: Math.max(0, minY),
        width: Math.min(pageWidth - minX, maxX - minX),
        height: Math.min(pageHeight - minY, maxY - minY),
        confidence: box.confidence,
        source: 'price_anchor_split' as const,
        reasonCodes: ['split_from_overmerged'],
        status: 'suggested' as const,
        templateId: box.templateId,
        supermarketCode: box.supermarketCode
      }
    })

    finalBoxes.push(...newBoxes)
  }

  return finalBoxes
}
