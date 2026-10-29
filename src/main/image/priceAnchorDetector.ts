import sharp from 'sharp'
import crypto from 'crypto'
import { PriceAnchorGroup } from '../../shared/types/priceAnchors'
import { info as logInfo } from '../logging/logger'

export async function detectPriceAnchors(input: {
  pageImagePath: string;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}): Promise<PriceAnchorGroup[]> {
  const { pageImagePath, pageNumber, pageWidth, pageHeight } = input

  // 1. Load rendered page image and downscale for analysis while retaining coordinate scale.
  const processWidth = 800
  const scale = processWidth / pageWidth
  const processHeight = Math.floor(pageHeight * scale)

  const rawBuffer = await sharp(pageImagePath)
    .resize(processWidth, processHeight, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { data, info } = rawBuffer
  const width = info.width
  const height = info.height

  // 3. Find saturated/high-contrast candidate label regions dynamically.
  // We'll create a binary mask of "interesting" pixels.
  // A pixel is interesting if it has high saturation OR it's dark text on light background (high local contrast).
  const mask = new Uint8Array(width * height)

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    // Simple saturation calculation
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    let s = 0
    if (max !== min) {
      s = l > 127 ? (max - min) / (510 - max - min) : (max - min) / (max + min)
    }

    // Saturated colors (e.g., red, purple, orange, green, gold price tags)
    // Or very dark pixels (black text for prices)
    const isSaturated = s > 0.4 && l > 50 && l < 200
    const isDark = l < 60

    if (isSaturated || isDark) {
      mask[i / 4] = 1
    }
  }

  // 4. Find text/digit-like connected components (CCL)
  const labels = new Int32Array(width * height)
  let currentLabel = 1
  const components: Record<number, { xMin: number; xMax: number; yMin: number; yMax: number; area: number }> = {}

  // Iterative flood fill for connected components
  const stack: number[] = []
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (mask[idx] === 1 && labels[idx] === 0) {
        // Start new component
        const label = currentLabel++
        components[label] = { xMin: x, xMax: x, yMin: y, yMax: y, area: 0 }
        
        stack.push(idx)
        labels[idx] = label

        while (stack.length > 0) {
          const currIdx = stack.pop()!
          const cx = currIdx % width
          const cy = Math.floor(currIdx / width)

          components[label].area++
          if (cx < components[label].xMin) components[label].xMin = cx
          if (cx > components[label].xMax) components[label].xMax = cx
          if (cy < components[label].yMin) components[label].yMin = cy
          if (cy > components[label].yMax) components[label].yMax = cy

          // Check 4-way neighbors
          const neighbors = [
            currIdx - width, // up
            currIdx + width, // down
            currIdx - 1,     // left
            currIdx + 1      // right
          ]

          for (const nIdx of neighbors) {
            if (nIdx >= 0 && nIdx < mask.length && mask[nIdx] === 1 && labels[nIdx] === 0) {
              // Ensure left/right don't wrap around
              const nx = nIdx % width
              if (Math.abs(nx - cx) > 1) continue

              labels[nIdx] = label
              stack.push(nIdx)
            }
          }
        }
      }
    }
  }

  // Filter components to find those that are digit-like or label-like
  const candidateRegions = Object.values(components).filter(c => {
    const w = c.xMax - c.xMin
    const h = c.yMax - c.yMin
    // Reject noise
    if (c.area < 20 || w < 5 || h < 5) return false
    // Reject massive backgrounds
    if (w > width * 0.4 || h > height * 0.3) return false
    return true
  }).map(c => ({
    x: c.xMin / scale,
    y: c.yMin / scale,
    width: (c.xMax - c.xMin) / scale,
    height: (c.yMax - c.yMin) / scale,
    area: c.area / (scale * scale)
  }))

  // 5. Detect repeated prominent numeric-region styles and Group
  // For this local CV, we cluster nearby candidate regions into "Price Anchor Groups"
  const groups: PriceAnchorGroup[] = []
  
  // Spatial clustering: Group candidates that are very close to each other
  const clusters: Array<typeof candidateRegions> = []
  for (const reg of candidateRegions) {
    let placed = false
    for (const cluster of clusters) {
      const clusterBounds = getBounds(cluster)
      // If region is within a certain distance of the cluster
      const xDist = Math.max(0, Math.max(clusterBounds.x - (reg.x + reg.width), reg.x - (clusterBounds.x + clusterBounds.width)))
      const yDist = Math.max(0, Math.max(clusterBounds.y - (reg.y + reg.height), reg.y - (clusterBounds.y + clusterBounds.height)))
      
      // Threshold distance for grouping into an anchor (e.g., 50 pixels)
      if (xDist < 50 && yDist < 30) {
        cluster.push(reg)
        placed = true
        break
      }
    }
    if (!placed) {
      clusters.push([reg])
    }
  }

  for (const cluster of clusters) {
    const cb = getBounds(cluster)
    // Filter out clusters that don't look like price anchors (too small or too big overall)
    if (cb.width < 20 || cb.height < 15 || cb.width > pageWidth * 0.4 || cb.height > pageHeight * 0.4) {
      continue
    }

    // Inside the cluster, the largest region is typically the current price.
    // Smaller regions are currencies or original prices.
    cluster.sort((a, b) => b.area - a.area)
    const currentPriceReg = cluster[0]
    
    groups.push({
      id: crypto.randomUUID(),
      pageNumber,
      bounds: cb,
      currentPriceRegion: {
        bounds: currentPriceReg,
        confidence: 0.85
      },
      originalPriceRegions: cluster.slice(1).filter(r => r.area > currentPriceReg.area * 0.2).map(r => ({
        bounds: r,
        confidence: 0.7,
        likelyCrossedOut: false
      })),
      currencyRegions: cluster.slice(1).filter(r => r.area <= currentPriceReg.area * 0.2).map(r => ({
        bounds: r,
        confidence: 0.6
      })),
      confidence: 0.8,
      reasonCodes: ['local_cv_anchor_detection']
    })
  }

  logInfo(`[Price Anchor Detector] Found ${groups.length} price anchors on page ${pageNumber}`)
  return groups
}

function getBounds(regions: Array<{x: number, y: number, width: number, height: number}>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of regions) {
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.width > maxX) maxX = r.x + r.width
    if (r.y + r.height > maxY) maxY = r.y + r.height
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  }
}
