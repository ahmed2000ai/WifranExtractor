import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { describe, expect, it, afterEach } from 'vitest'
import { computeStableSourceOfferId } from '../../../shared/utils/nonCatalogPublicationPolicy'
import {
  computeDocumentIdFromFingerprint,
  computeOfferAnchorSignature,
  normalizeFileNameForDuplicateCheck
} from '../../../shared/utils/sourceIdentityAndDuplicateUtils'
import { DocumentExtractionHistoryService } from '../../cache/documentExtractionHistoryService'
import { runHybridV3LeafletExtraction } from '../hybridV3BatchProcessor'
import type { HybridExtractionProvider } from '../../../shared/types/hybridExtractionV3'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(d)
  return d
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup error on Windows
    }
  }
})

function loadSingleRealV3PagePayload() {
  const b1Raw = path.join(
    process.cwd(),
    'Extracts',
    'pilot_v3_005h_b1',
    'raw',
    '8dd795e5f3744a829c6e7853434d0b2ccdbf53d1e9c711a5288fdf7bdd3185a9_page.raw.json'
  )
  const raw = JSON.parse(fs.readFileSync(b1Raw, 'utf8'))
  const parsedText = raw.parsedResponse || raw
  return {
    ...parsedText,
    offers: parsedText.offers ? [parsedText.offers[0]] : []
  }
}

function buildMockProvider(): { provider: HybridExtractionProvider; getFullPageCalls: () => number[] } {
  const fullPageCalls: number[] = []
  const samplePagePayload = loadSingleRealV3PagePayload()
  const provider: HybridExtractionProvider = {
    providerId: 'offline_fixture_provider',
    isOfflineOrMock: true,
    extractPage: async (req) => {
      fullPageCalls.push(req.pageNumber)
      return {
        ok: true,
        durationMs: 5,
        model: 'gemini-3.8-flash',
        tier: 'flex',
        usage: {
          promptTokenCount: 1000,
          candidatesTokenCount: 120,
          thoughtsTokenCount: 50,
          cachedContentTokenCount: 0,
          totalTokenCount: 1170
        },
        costUsdOverride: 0.0025,
        parsedJson: samplePagePayload
      }
    },
    extractCardCrop: async () => ({
      ok: true,
      durationMs: 2,
      parsedJson: samplePagePayload
    })
  }
  return { provider, getFullPageCalls: () => fullPageCalls }
}

describe('WIFRAN-005J-UAT-FIX-08 Phase 1: Stable Source Identity & Pre-Extraction Duplicate Prevention', () => {
  it('ID-01 & ID-02: derives canonical doc_<sha256_prefix> and stable array-index-invariant source_offer_id across filenames and OCR order changes', () => {
    const pdfHash = crypto.createHash('sha256').update('othaim-jeddah-2026-11-11-bytes').digest('hex')
    const docId = computeDocumentIdFromFingerprint(pdfHash, 'othaim.pdf')
    expect(docId).toBe(`doc_${pdfHash.slice(0, 16)}`)

    const anchor1 = computeOfferAnchorSignature({
      sourcePage: 27,
      supermarketId: 'othaim',
      titleEn: 'Almarai Fresh Milk Full Fat 1L',
      titleAr: 'حليب المراعي طازج كامل الدسم 1 لتر',
      brand: 'Almarai',
      promoPrice: 5.95,
      originalPrice: 7.95,
      sizeOrWeight: '1L',
      bboxNorm: [104, 122, 418, 479]
    })

    // Slightly shifted OCR box & reordered array index o07 vs o01 produce exact same anchor & source_offer_id
    const anchor2 = computeOfferAnchorSignature({
      sourcePage: 27,
      supermarketId: 'othaim',
      titleEn: 'Almarai Fresh Milk Full Fat 1L',
      titleAr: 'حليب المراعي طازج كامل الدسم 1 لتر',
      brand: 'Almarai',
      promoPrice: 5.95,
      originalPrice: 7.95,
      sizeOrWeight: '1L',
      bboxNorm: [108, 125, 421, 482]
    })
    expect(anchor1).toBe(anchor2)

    const idBatch1 = computeStableSourceOfferId({
      batchOfferKey: 'b1:l1:27:o1',
      leafletId: 'leaflet-001',
      sourceFileName: 'othaim-original.pdf',
      sourceFileFingerprint: pdfHash,
      sourcePage: 27,
      sourceOfferId: 'leaflet-001_p27_o01',
      sourceOfferAnchor: anchor1
    })

    const idBatch2Renamed = computeStableSourceOfferId({
      batchOfferKey: 'b2:l3:27:o7',
      leafletId: 'leaflet-003',
      sourceFileName: 'othaim-renamed-copy (2).pdf',
      sourceFileFingerprint: pdfHash,
      sourcePage: 27,
      sourceOfferId: 'leaflet-003_p27_o07',
      sourceOfferAnchor: anchor2
    })

    expect(idBatch1).toBe(idBatch2Renamed)
    expect(idBatch1.startsWith(`${docId}:p027:i${anchor1}:s01`)).toBe(true)

    // Existing structured slot contracts remain intact
    expect(
      computeStableSourceOfferId({
        batchOfferKey: 'b:l1:4:19',
        leafletId: 'leaflet-001',
        sourceFileFingerprint: pdfHash,
        sourcePage: 4,
        sourceOfferId: 'leaflet-001:p004:i019:s01'
      })
    ).toBe(`${docId}:p004:i019:s01`)
  })

  it('DUP-01A..G: detects filename & SHA-256 duplicates, reuses partial overlapping pages across renamed PDFs at $0 cost, and honors Force Re-extraction', async () => {
    const rootDir = makeTempDir('fix08-dup-')
    const ws1 = path.join(rootDir, 'ws1')
    const ws2 = path.join(rootDir, 'ws2')
    const ws3 = path.join(rootDir, 'ws3')
    const tinyPng = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 245, g: 245, b: 245 } }
    })
      .png()
      .toBuffer()
    for (const ws of [ws1, ws2, ws3]) {
      fs.mkdirSync(path.join(ws, 'pages'), { recursive: true })
      fs.writeFileSync(path.join(ws, 'pages', 'page.1.png'), tinyPng)
      fs.writeFileSync(path.join(ws, 'pages', 'page.2.png'), tinyPng)
      fs.writeFileSync(path.join(ws, 'pages', 'page.3.png'), tinyPng)
    }

    const pdfPathA = path.join(rootDir, 'othaim-markets.pdf')
    const pdfPathRenamed = path.join(rootDir, 'othaim-markets-copy.pdf')
    const pdfBytes = Buffer.from('%PDF-1.4\n%identical-binary-content-for-fix08-test\n')
    fs.writeFileSync(pdfPathA, pdfBytes)
    fs.writeFileSync(pdfPathRenamed, pdfBytes)
    const sha = DocumentExtractionHistoryService.computePdfSha256(pdfPathA)!
    expect(sha).toBe(DocumentExtractionHistoryService.computePdfSha256(pdfPathRenamed))

    const history = new DocumentExtractionHistoryService({ baseDir: rootDir })

    // Run 1: extract pages [1, 2] of pdfPathA
    const mock1 = buildMockProvider()
    const run1 = await runHybridV3LeafletExtraction({
      leafletId: 'leaflet-001',
      fileName: 'othaim-markets.pdf',
      filePath: pdfPathA,
      fileFingerprint: sha,
      workspacePath: ws1,
      pageCount: 3,
      pagesToProcess: [1, 2],
      metadata: { supermarketId: 'othaim', offerStartDate: '2026-11-11', offerEndDate: '2026-11-17', verified: true },
      executionContext: 'isolated_hybrid_workflow',
      explicitAuthorization: true,
      featureEnabled: true,
      historyService: history,
      provider: mock1.provider
    })
    expect(run1.ok).toBe(true)
    expect(mock1.getFullPageCalls()).toEqual([1, 2])
    expect(run1.offersCount).toBe(2)

    // Pre-extraction inspection with renamed PDF selecting overlapping pages [2, 3]
    const inspection = history.inspectPreExtractionDuplicates({
      files: [{ path: pdfPathRenamed, name: 'othaim-markets-copy.pdf', pageCount: 3, pagesToProcess: [2, 3] }],
      extractionPipelineMode: 'hybrid_v3',
      modelId: 'gemini-3.8-flash'
    })
    expect(inspection.perFile[0].classification).toBe('partial_page_overlap_reuse')
    expect(inspection.perFile[0].reusablePages).toEqual([2])
    expect(inspection.perFile[0].payablePages).toEqual([3])
    expect(inspection.totalReusablePages).toBe(1)
    expect(inspection.totalPayablePages).toBe(1)
    expect(inspection.adjustedCostEstimate.totalEstimatedLowUsd).toBeLessThan(
      inspection.originalCostEstimate.totalEstimatedLowUsd
    )

    // Same-name different-bytes check (DUP-01A/B)
    const pdfPathSameNameDiffBytes = path.join(rootDir, 'other', 'othaim-markets.pdf')
    fs.mkdirSync(path.dirname(pdfPathSameNameDiffBytes), { recursive: true })
    fs.writeFileSync(pdfPathSameNameDiffBytes, '%PDF-1.4\n%completely-different-issue-bytes\n')
    const diffCheck = history.inspectPreExtractionDuplicates({
      files: [{ path: pdfPathSameNameDiffBytes, name: 'othaim-markets.pdf', pageCount: 2, pagesToProcess: [1, 2] }],
      extractionPipelineMode: 'hybrid_v3'
    })
    expect(diffCheck.perFile[0].classification).toBe('filename_collision_different_content')
    expect(diffCheck.perFile[0].payablePages).toEqual([1, 2])
    expect(diffCheck.perFile[0].reusablePages).toEqual([])

    // Run 2: renamed PDF selecting [2, 3] only spends Gemini call on page 3!
    const mock2 = buildMockProvider()
    const run2 = await runHybridV3LeafletExtraction({
      leafletId: 'leaflet-001',
      fileName: 'othaim-markets-copy.pdf',
      filePath: pdfPathRenamed,
      fileFingerprint: sha,
      workspacePath: ws2,
      pageCount: 3,
      pagesToProcess: [2, 3],
      metadata: { supermarketId: 'othaim', offerStartDate: '2026-11-11', offerEndDate: '2026-11-17', verified: true },
      executionContext: 'isolated_hybrid_workflow',
      explicitAuthorization: true,
      featureEnabled: true,
      historyService: history,
      provider: mock2.provider
    })
    expect(run2.ok).toBe(true)
    expect(run2.reusedPageNumbers).toEqual([2])
    expect(mock2.getFullPageCalls()).toEqual([3])
    expect(run2.offersCount).toBe(2)

    // DUP-01D: Incompatible profile blocks reuse
    const incompat = history.inspectPreExtractionDuplicates({
      files: [{ path: pdfPathRenamed, name: 'othaim-markets-copy.pdf', pageCount: 3, pagesToProcess: [1, 2] }],
      extractionPipelineMode: 'hybrid_v3',
      modelId: 'gemini-4.0-next'
    })
    expect(incompat.perFile[0].classification).toBe('incompatible_or_corrupted_history')
    expect(incompat.perFile[0].reusablePages).toEqual([])
    expect(incompat.perFile[0].payablePages).toEqual([1, 2])

    // ID-03: Force Re-extraction re-runs page 1 & preserves backup in .revision_history
    const mock3 = buildMockProvider()
    const run3Force = await runHybridV3LeafletExtraction({
      leafletId: 'leaflet-001',
      fileName: 'othaim-markets.pdf',
      filePath: pdfPathA,
      fileFingerprint: sha,
      workspacePath: ws1,
      pageCount: 3,
      pagesToProcess: [1],
      metadata: { supermarketId: 'othaim', offerStartDate: '2026-11-11', offerEndDate: '2026-11-17', verified: true },
      executionContext: 'isolated_hybrid_workflow',
      explicitAuthorization: true,
      featureEnabled: true,
      forceReextract: true,
      historyService: history,
      provider: mock3.provider
    })
    expect(run3Force.ok).toBe(true)
    expect(mock3.getFullPageCalls()).toEqual([1])
    expect(fs.existsSync(path.join(ws1, '.revision_history'))).toBe(true)
    expect(fs.readdirSync(path.join(ws1, '.revision_history')).length).toBeGreaterThanOrEqual(1)

    const norm = normalizeFileNameForDuplicateCheck('Othaim_Markets (2) copy.pdf')
    expect(norm.normalizedStem).toBe('othaim_markets')
  })
})
