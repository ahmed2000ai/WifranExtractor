import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { LeafletLayoutSession, LeafletPageLayoutFingerprint, LeafletLayoutCluster } from '../../shared/types/leafletSession'
import { PriceAnchorGroup } from '../../shared/types/priceAnchors'
import { SuggestedCropBox, PageCropSuggestionResult } from '../../shared/types/manualCrop'
import { info as logInfo, error as logError } from '../logging/logger'
import { detectPriceAnchors } from '../image/priceAnchorDetector'
import { loadEnvConfig } from '../config/env'

export const sessionLayoutLearningService = {
  getSessionPath(manifestDir: string) {
    return path.join(manifestDir, 'metadata', 'session-layout-learning', 'leaflet-layout-session.json')
  },

  loadSession(manifestDir: string): LeafletLayoutSession {
    const sessionPath = this.getSessionPath(manifestDir)
    if (fs.existsSync(sessionPath)) {
      try {
        return JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
      } catch (e: any) {
        logError(`Failed to parse session layout: ${e.message}`)
      }
    }
    return {
      schema_version: 1,
      leafletId: path.basename(manifestDir),
      supermarketCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fingerprints: {},
      clusters: [],
      adaptationEvents: []
    }
  },

  saveSession(manifestDir: string, session: LeafletLayoutSession) {
    const sessionPath = this.getSessionPath(manifestDir)
    const dir = path.dirname(sessionPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    session.updatedAt = new Date().toISOString()
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2))
  },

  async calculateFingerprint(pageImagePath: string, pageNumber: number, pageWidth: number, pageHeight: number, anchors: PriceAnchorGroup[]): Promise<LeafletPageLayoutFingerprint> {
    // Simple spatial fingerprinting based on anchors for now
    const normalizedPriceAnchorCenters = anchors.map(a => ({
      x: (a.bounds.x + a.bounds.width / 2) / pageWidth,
      y: (a.bounds.y + a.bounds.height / 2) / pageHeight
    }))

    return {
      pageNumber,
      pageImagePath,
      pageWidth,
      pageHeight,
      perceptualHash: null,
      colorHistogram: [], // Mocked
      edgeGrid: [], // Mocked
      whitespaceGrid: [], // Mocked
      normalizedPriceAnchorCenters,
      priceAnchorCount: anchors.length,
      createdAt: new Date().toISOString()
    }
  },

  computeSimilarity(fp1: LeafletPageLayoutFingerprint, fp2: LeafletPageLayoutFingerprint): number {
    if (fp1.priceAnchorCount === 0 || fp2.priceAnchorCount === 0) {
        return fp1.priceAnchorCount === fp2.priceAnchorCount ? 1.0 : 0.0
    }
    if (Math.abs(fp1.priceAnchorCount - fp2.priceAnchorCount) > 2) return 0.0

    // Compare anchor positions
    let totalDist = 0
    for (const a1 of fp1.normalizedPriceAnchorCenters) {
      // Find closest in fp2
      let minDist = Infinity
      for (const a2 of fp2.normalizedPriceAnchorCenters) {
        const dist = Math.hypot(a1.x - a2.x, a1.y - a2.y)
        if (dist < minDist) minDist = dist
      }
      totalDist += minDist
    }
    const avgDist = totalDist / fp1.normalizedPriceAnchorCenters.length
    // If average distance is very small (e.g. < 0.05), they are very similar
    const similarity = Math.max(0, 1 - (avgDist * 10))
    return similarity
  },

  async handlePageConfirmed(manifestDir: string, pageNumber: number, confirmedBoxes: SuggestedCropBox[], pageImagePath: string, pageWidth: number, pageHeight: number) {
    const config = loadEnvConfig()
    if (!config.cropSuggestions.enabled) return

    logInfo(`[Session Learning] Handling confirmation for page ${pageNumber}...`)
    
    const anchors = await detectPriceAnchors({ pageImagePath, pageNumber, pageWidth, pageHeight })
    const fingerprint = await this.calculateFingerprint(pageImagePath, pageNumber, pageWidth, pageHeight, anchors)

    const session = this.loadSession(manifestDir)
    session.fingerprints[pageNumber] = fingerprint

    // Find cluster or create
    let bestCluster: LeafletLayoutCluster | null = null
    let bestSim = 0

    for (const cluster of session.clusters) {
      // Compare to the first confirmed page in the cluster (or any member)
      if (cluster.confirmedPageNumbers.length > 0) {
         const repFp = session.fingerprints[cluster.confirmedPageNumbers[0]]
         if (repFp) {
             const sim = this.computeSimilarity(fingerprint, repFp)
             if (sim > bestSim) {
                 bestSim = sim
                 bestCluster = cluster
             }
         }
      }
    }

    const MIN_SIM = 0.82 // LEAFLET_SESSION_MIN_SIMILARITY
    if (bestCluster && bestSim >= MIN_SIM) {
      if (!bestCluster.confirmedPageNumbers.includes(pageNumber)) {
        bestCluster.confirmedPageNumbers.push(pageNumber)
      }
    } else {
      bestCluster = {
        clusterId: crypto.randomUUID(),
        memberPageNumbers: [pageNumber],
        confirmedPageNumbers: [pageNumber],
        unreviewedPageNumbers: [],
        prototypeConfidence: 0.3,
        prototype: null
      }
      session.clusters.push(bestCluster)
    }

    // Update prototype
    bestCluster.prototypeConfidence = Math.min(1.0, bestCluster.confirmedPageNumbers.length * 0.33)
    bestCluster.prototype = {
      normalizedConfirmedBoxes: confirmedBoxes.map(b => ({
        x: b.x / pageWidth,
        y: b.y / pageHeight,
        width: b.width / pageWidth,
        height: b.height / pageHeight
      })),
      normalizedPriceAnchors: fingerprint.normalizedPriceAnchorCenters,
      expectedBoxCountRange: {
        min: confirmedBoxes.length,
        max: confirmedBoxes.length
      }
    }

    // Adapt unreviewed pages (mocked discovery of other pages in cluster for now)
    // We would normally scan all other pages, but here we just find pages already in the cluster's unreviewed list
    // OR we could eagerly assign unreviewed pages to clusters as they are generated.
    
    // For now, let's just log the adaptation event. The system runs local CV fallback sequentially, so adaptation happens on the fly as well.
    session.adaptationEvents.push({
      eventId: crypto.randomUUID(),
      confirmedPageNumber: pageNumber,
      clusterId: bestCluster.clusterId,
      affectedPageNumbers: [], // We'd list adapted pages here
      createdAt: new Date().toISOString(),
      resultSummary: `Updated prototype for cluster ${bestCluster.clusterId}`
    })

    this.saveSession(manifestDir, session)
    logInfo(`[Session Learning] Cluster ${bestCluster.clusterId} updated. Prototype confidence: ${bestCluster.prototypeConfidence}`)
  },

  tryAdaptUnreviewedPage(manifestDir: string, pageNumber: number, pageWidth: number, pageHeight: number, fingerprint: LeafletPageLayoutFingerprint): PageCropSuggestionResult | null {
    const session = this.loadSession(manifestDir)
    let bestCluster: LeafletLayoutCluster | null = null
    let bestSim = 0

    for (const cluster of session.clusters) {
      if (cluster.confirmedPageNumbers.length > 0 && cluster.prototype) {
         const repFp = session.fingerprints[cluster.confirmedPageNumbers[0]]
         if (repFp) {
             const sim = this.computeSimilarity(fingerprint, repFp)
             if (sim > bestSim) {
                 bestSim = sim
                 bestCluster = cluster
             }
         }
      }
    }

    if (bestCluster && bestSim >= 0.82 && bestCluster.prototype) {
      logInfo(`[Session Learning] Adapting page ${pageNumber} to cluster ${bestCluster.clusterId} (confidence ${bestCluster.prototypeConfidence})`)
      
      const adaptedBoxes: SuggestedCropBox[] = bestCluster.prototype.normalizedConfirmedBoxes.map(b => ({
        id: crypto.randomUUID(),
        pageNumber,
        x: b.x * pageWidth,
        y: b.y * pageHeight,
        width: b.width * pageWidth,
        height: b.height * pageHeight,
        confidence: bestCluster!.prototypeConfidence,
        source: 'leaflet_session_adapted' as const,
        reasonCodes: ['adapted_from_prototype'],
        status: bestCluster!.prototypeConfidence >= 1.0 ? 'accepted' : 'suggested'
      }))

      return {
        pageNumber,
        pageImagePath: fingerprint.pageImagePath,
        strategy: 'leaflet_session_adapted',
        confidence: bestCluster.prototypeConfidence,
        suggestedBoxes: adaptedBoxes,
        diagnostics: {
          pageWidth,
          pageHeight,
          candidateCountBeforeFiltering: adaptedBoxes.length,
          candidateCountAfterFiltering: adaptedBoxes.length,
          rejectedCandidateCount: 0,
          reasonCodes: ['SESSION_ADAPTED']
        },
        warnings: []
      }
    }
    
    return null
  }
}
