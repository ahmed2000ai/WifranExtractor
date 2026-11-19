import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentExtractionHistoryService } from '../../cache/documentExtractionHistoryService'
import { CURRENT_HYBRID_COMPATIBILITY_PROFILE } from '../../../shared/utils/sourceIdentityAndDuplicateUtils'
import { BatchOrchestrationService } from '../../batch/batchOrchestrationService'
import { CatalogMatchingOrchestrator } from '../../batch/catalogMatchingOrchestrator'
import { decomposeV3OfferCard } from '../../ocr/offerV3DecompositionEngine'
import { evaluateIdentitySufficiency } from '../productIdentityPolicy'
import { classifyOfferReviewTriage } from '../../../shared/utils/reviewTriageClassifier'
import { BrandGroupingService } from '../brandGroupingService'
import { CatalogPublicationService } from '../catalogPublicationService'
import { createIsolatedWifranPostgres } from './isolatedPostgresHarness008'
import { undoLastPublish } from '../publicationJournalAndUndoService'
import { createInMemoryStorageAdapter } from '../../storage/stagedStorageLifecycleService'
import type { OfferContractV3Record } from '../../../shared/types/extractorContractV3'
import type { MatchingRunManifest, MatchingTotals } from '../../../shared/types/catalogMatching'
import type { UnifiedBatchOffer } from '../../../shared/types/batchExtraction'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore Windows cleanup handle lag
    }
  }
})

async function makeWebp(filePath: string, rgb: { r: number; g: number; b: number }): Promise<string> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const buf = await sharp({
    create: { width: 48, height: 48, channels: 3, background: rgb }
  })
    .webp()
    .toBuffer()
  fs.writeFileSync(filePath, buf)
  return filePath
}

const UUID_CARREFOUR = 'c2cc16c2-0006-4444-b000-c00000000006'
const UUID_JEDDAH = 'a6f7b140-0002-4444-a000-000000000002'

function buildOffer(overrides: Partial<UnifiedBatchOffer>): UnifiedBatchOffer {
  return {
    batchOfferKey: 'b1:l1:23:c01',
    batchId: 'b1',
    leafletId: 'l1',
    sourceDocumentId: 'doc_cf_p23_test1',
    sourceFileName: 'carrefour.pdf',
    sourcePdfPath: '/tmp/carrefour.pdf',
    sourceFileFingerprint: 'c'.repeat(64),
    sourcePage: 23,
    sourceOfferId: 'doc_cf_p23_test1:p023:i001:s01',
    sourceOfferAnchor: 'anchor_cf_c01',
    supermarketId: UUID_CARREFOUR,
    supermarketName: 'Carrefour',
    locationScope: 'national',
    locationLabel: null,
    cityId: null,
    regionId: null,
    offerStartDate: '2026-11-11',
    offerEndDate: '2026-11-17',
    currency: 'SAR',
    metadataVerified: true,
    metadataStatus: 'operator_verified',
    titleEn: 'Al Safeer Basmati Rice 10kg',
    titleAr: 'أرز بسمتي السفير 10 كجم',
    brand: 'Al Safeer',
    brandAr: 'السفير',
    brandEn: 'Al Safeer',
    variantOrFlavor: null,
    promoPrice: 59.95,
    originalPrice: 79.95,
    discountPercent: 25,
    promoNotes: null,
    sizeOrWeight: '10kg',
    each_size_value: 10,
    each_size_unit: 'kg',
    inner_pack_count: 1,
    sale_unit_type: 'piece',
    total_content_value: 10,
    total_content_unit: 'kg',
    free_units_text: null,
    customer_limit: null,
    productThumbCropPath: null,
    offerCardCropPath: null,
    imageSubjectScope: 'product_package',
    status: 'reviewed',
    confidence: 'high',
    category: 'grocery',
    ...overrides
  }
}

function emptyTotals(overrides?: Partial<MatchingTotals>): MatchingTotals {
  return {
    totalExtractedOffers: 1,
    uniqueIdentitiesCount: 1,
    cacheMatchesCount: 0,
    deterministicMatchesCount: 0,
    geminiEvaluatedCount: 0,
    proposedExistingCount: 0,
    proposedTemporaryCount: 1,
    unresolvedCount: 0,
    validationWarningsCount: 0,
    actualCostUsd: 0,
    estimatedCostUsd: 0,
    geminiRequestsCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    ...overrides
  }
}

describe('WIFRAN FIX-08 Phase 3 Completion: Backfill, Consumer Image Approval & Diagnostics', () => {
  it('1-5. Backfills historical workspaces non-destructively by SHA-256, deduplicates, supports renamed PDFs, rejects byte mismatches/corrupt/legacy, and reuses at $0.00 in a new batch', async () => {
    const root = makeTempDir('wifran-p3-backfill-')
    const leafletsDir = path.join(root, 'Leaflets')
    const extractsDir = path.join(root, 'Extracts')
    const batchesDir = path.join(extractsDir, 'batches')
    fs.mkdirSync(leafletsDir, { recursive: true })
    fs.mkdirSync(batchesDir, { recursive: true })

    const pdfBytes = Buffer.from('%PDF-1.4\n%Wifran Carrefour Page 23 Fixture Bytes\n%%EOF')
    const shaA = crypto.createHash('sha256').update(pdfBytes).digest('hex')
    const pdfOrig = path.join(leafletsDir, 'carrefour-62800235-jeddah.pdf')
    const pdfRenamed = path.join(leafletsDir, 'renamed-carrefour-copy.pdf')
    const pdfDifferentBytes = path.join(leafletsDir, 'other', 'carrefour-62800235-jeddah.pdf')
    fs.mkdirSync(path.dirname(pdfDifferentBytes), { recursive: true })
    fs.writeFileSync(pdfOrig, pdfBytes)
    fs.writeFileSync(pdfRenamed, pdfBytes)
    fs.writeFileSync(pdfDifferentBytes, Buffer.concat([pdfBytes, Buffer.from('\n%diff-issue\n')]))

    // Workspace 1: valid completed Hybrid V3 workspace (NOT yet in .wifran-document-history.json)
    const wsCarrefour = path.join(extractsDir, 'carrefour-62800235-jeddah')
    const resDir = path.join(wsCarrefour, 'hybrid_v3_results')
    fs.mkdirSync(resDir, { recursive: true })
    fs.mkdirSync(path.join(wsCarrefour, 'pages'), { recursive: true })
    fs.writeFileSync(path.join(wsCarrefour, 'pages', 'page.23.png'), Buffer.from('png-placeholder'))
    const offerCrop = await makeWebp(path.join(wsCarrefour, 'crops', 'page_23', 'offer_01', 'offer_card_crop.webp'), { r: 200, g: 50, b: 50 })
    const thumbCrop = await makeWebp(path.join(wsCarrefour, 'crops', 'page_23', 'offer_01', 'product_thumb_crop.webp'), { r: 30, g: 180, b: 90 })

    const pageResultPayload = {
      pageResult: {
        ok: true,
        pageNumber: 23,
        modelId: CURRENT_HYBRID_COMPATIBILITY_PROFILE.modelId
      }
    }
    const stagedDraftPayload = {
      schemaVersion: '1.0',
      leafletHash: shaA,
      sourcePdfPath: pdfOrig,
      header: {
        supermarketId: UUID_CARREFOUR,
        validFrom: '2026-11-11',
        validTo: '2026-11-17',
        locationScope: 'national'
      },
      items: [
        {
          id: 'p23_c001',
          sourceOfferId: 'p23_c001',
          pageNumber: 23,
          titleEn: 'Al Safeer Basmati Rice 10kg',
          titleAr: 'أرز بسمتي السفير 10 كجم',
          brand: 'Al Safeer',
          priceAfter: 59.95,
          priceBefore: 79.95,
          sizeOrWeight: '10kg',
          each_size_value: 10,
          each_size_unit: 'kg',
          inner_pack_count: 1,
          sale_unit_type: 'piece',
          croppedEvidenceLocalPath: offerCrop,
          productThumbLocalPath: thumbCrop,
          originalPageImagePath: path.join(wsCarrefour, 'pages', 'page.23.png'),
          imageSubjectScope: 'product_package'
        }
      ]
    }

    const v3JsonPath = path.join(resDir, 'page_23.v3.json')
    const draftJsonPath = path.join(wsCarrefour, 'staged-draft.json')
    fs.writeFileSync(v3JsonPath, JSON.stringify(pageResultPayload, null, 2))
    fs.writeFileSync(draftJsonPath, JSON.stringify(stagedDraftPayload, null, 2))
    const rawV3Before = fs.readFileSync(v3JsonPath, 'utf8')
    const rawDraftBefore = fs.readFileSync(draftJsonPath, 'utf8')

    const histBatchDir = path.join(batchesDir, 'batch-hist-001')
    fs.mkdirSync(histBatchDir, { recursive: true })
    fs.writeFileSync(
      path.join(histBatchDir, 'batch-manifest.json'),
      JSON.stringify({
        batchId: 'batch-hist-001',
        extractionPipelineMode: 'hybrid_v3',
        model: CURRENT_HYBRID_COMPATIBILITY_PROFILE.modelId,
        leaflets: [
          {
            leafletId: 'leaflet-001',
            fileName: 'carrefour-62800235-jeddah.pdf',
            filePath: pdfOrig,
            fileFingerprint: shaA,
            workspacePath: wsCarrefour,
            metadata: {
              supermarketId: UUID_CARREFOUR,
              offerStartDate: '2026-11-11',
              offerEndDate: '2026-11-17',
              locationScope: 'national'
            }
          }
        ]
      })
    )

    // Workspace 2: Legacy incompatible Rev1 workspace
    const wsLegacy = path.join(extractsDir, 'legacy-panda')
    fs.mkdirSync(path.join(wsLegacy, 'json'), { recursive: true })
    fs.writeFileSync(path.join(wsLegacy, 'staged-draft.json'), JSON.stringify({ items: [{ id: '1', pageNumber: 1, titleEn: 'Old' }] }))

    // Workspace 3: Corrupted / missing crop Hybrid V3 workspace
    const wsCorrupt = path.join(extractsDir, 'corrupt-danube')
    fs.mkdirSync(path.join(wsCorrupt, 'hybrid_v3_results'), { recursive: true })
    fs.writeFileSync(
      path.join(wsCorrupt, 'hybrid_v3_results', 'page_5.v3.json'),
      JSON.stringify({ pageResult: { ok: true } })
    )
    fs.writeFileSync(
      path.join(wsCorrupt, 'staged-draft.json'),
      JSON.stringify({
        leafletHash: 'a'.repeat(64),
        items: [
          {
            id: 'c1',
            pageNumber: 5,
            titleEn: 'Broken Crop Item',
            croppedEvidenceLocalPath: path.join(wsCorrupt, 'crops', 'missing_crop.webp')
          }
        ]
      })
    )

    // Pre-populate stale nonexistent temp index entry
    const historySvc = new DocumentExtractionHistoryService({ baseDir: extractsDir })
    fs.writeFileSync(
      historySvc.getIndexFilePath(),
      JSON.stringify({
        schemaVersion: 'wifran.doc_history/1.0',
        updatedAt: new Date().toISOString(),
        pages: {
          'doc_deadbeef:p001:hybrid_v3:gemini-3.8-flash': {
            documentId: 'doc_deadbeef00001111',
            fileFingerprint: 'b'.repeat(64),
            fileName: 'temp_missing.pdf',
            normalizedStem: 'temp_missing',
            workspacePath: 'C:\\nonexistent\\temp\\ws',
            pageNumber: 1,
            compatibilityProfile: CURRENT_HYBRID_COMPATIBILITY_PROFILE,
            resultJsonPath: 'C:\\nonexistent\\temp\\p1.v3.json',
            stagedDraftPath: 'C:\\nonexistent\\temp\\staged-draft.json',
            cropPaths: [],
            offersCount: 1,
            quarantinedCount: 0,
            extractedAt: new Date().toISOString()
          }
        }
      })
    )

    // Backfill #1
    const summary1 = historySvc.backfillHistoricalExtractions({
      extractsDir,
      pdfSearchDirs: [leafletsDir],
      pruneStaleMissingEntries: true
    })
    expect(summary1.indexedPagesCount).toBe(1)
    expect(summary1.prunedStaleEntriesCount).toBe(1)
    expect(summary1.skippedIncompatibleCount).toBeGreaterThanOrEqual(1)
    expect(summary1.skippedIncompleteOrCorruptedCount).toBeGreaterThanOrEqual(1)

    // Originals remain untouched
    expect(fs.readFileSync(v3JsonPath, 'utf8')).toBe(rawV3Before)
    expect(fs.readFileSync(draftJsonPath, 'utf8')).toBe(rawDraftBefore)

    // Backfill #2 -> idempotent, zero duplicate records
    const summary2 = historySvc.backfillHistoricalExtractions({
      extractsDir,
      pdfSearchDirs: [leafletsDir]
    })
    expect(summary2.indexedPagesCount).toBe(0)
    expect(summary2.skippedAlreadyIndexedCount).toBe(1)

    // Renamed identical PDF matches by SHA-256 -> $0.00 full reuse
    const renamedCheck = historySvc.inspectPreExtractionDuplicates({
      files: [{ path: pdfRenamed, name: 'renamed-carrefour-copy.pdf', pageCount: 62, pagesToProcess: [23] }],
      extractionPipelineMode: 'hybrid_v3'
    })
    expect(renamedCheck.totalReusablePages).toBe(1)
    expect(renamedCheck.totalPayablePages).toBe(0)
    expect(renamedCheck.perFile[0].classification).toBe('exact_duplicate_full_reuse')

    // Different PDF bytes with identical filename -> must NOT reuse!
    const diffBytesCheck = historySvc.inspectPreExtractionDuplicates({
      files: [{ path: pdfDifferentBytes, name: 'carrefour-62800235-jeddah.pdf', pageCount: 62, pagesToProcess: [23] }],
      extractionPipelineMode: 'hybrid_v3'
    })
    expect(diffBytesCheck.totalReusablePages).toBe(0)
    expect(diffBytesCheck.totalPayablePages).toBe(1)
    expect(diffBytesCheck.perFile[0].classification).toBe('filename_collision_different_content')

    // Newly created batch reuses historical artifacts at $0.00 with ZERO paid Gemini calls
    const batchSvc = new BatchOrchestrationService(batchesDir)
    const wsNew = path.join(extractsDir, 'carrefour-new-batch-ws')
    fs.mkdirSync(path.join(wsNew, 'pages'), { recursive: true })
    fs.writeFileSync(path.join(wsNew, 'pages', 'page.23.png'), Buffer.from('png-placeholder'))
    const created = await batchSvc.createBatch({
      files: [
        {
          path: pdfRenamed,
          name: 'renamed-carrefour-copy.pdf',
          sizeBytes: pdfBytes.length,
          pageCount: 62,
          contentFingerprint: shaA,
          pageSelectionMode: 'specific',
          pagesToProcess: [23],
          workspacePath: wsNew,
          metadata: {
            supermarketId: UUID_CARREFOUR,
            supermarketName: 'Carrefour',
            offerStartDate: '2026-11-11',
            offerEndDate: '2026-11-17',
            locationScope: 'national',
            currency: 'SAR',
            verified: true,
            metadataStatus: 'operator_verified'
          }
        }
      ],
      extractionPipelineMode: 'hybrid_v3'
    })

    let providerCalls = 0
    const completed = await batchSvc.startBatchExtraction(created.batchId, {
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      skipPdfRenderIfPagesExist: true,
      hybridV3Provider: {
        providerId: 'mock_no_call',
        isOfflineOrMock: true,
        extractPage: async () => {
          providerCalls++
          throw new Error('Paid Gemini extraction call must NOT occur during cached page reuse!')
        },
        extractCardCrop: async () => {
          providerCalls++
          throw new Error('Paid crop call must NOT occur during cached page reuse!')
        }
      }
    })
    expect(providerCalls).toBe(0)
    expect(completed.status).toBe('completed')
    expect(completed.totals.totalCostUsd).toBe(0)
    expect(completed.totals.totalOffers).toBe(1)
    expect(completed.leaflets[0].reusedPages).toEqual([23])
    expect(completed.leaflets[0].payablePages).toEqual([])
  })

  it('6-10. Consumer image approval, evidence separation, existing catalog image reuse, sibling reuse, and identity-change invalidation', async () => {
    const root = makeTempDir('wifran-p3-img-approval-')
    const extractsDir = path.join(root, 'Extracts')
    const batchesDir = path.join(extractsDir, 'batches')
    const ws = path.join(extractsDir, 'ws-carrefour')
    fs.mkdirSync(path.join(ws, 'pages'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'pages', 'page.23.png'), Buffer.from('png'))

    const offerCrop = await makeWebp(path.join(ws, 'crops', 'o1', 'offer_card_crop.webp'), { r: 180, g: 40, b: 40 })
    const thumbCrop = await makeWebp(path.join(ws, 'crops', 'o1', 'product_thumb_crop.webp'), { r: 20, g: 160, b: 80 })
    const assortCrop = await makeWebp(path.join(ws, 'crops', 'o2', 'product_thumb_crop.webp'), { r: 60, g: 60, b: 180 })

    const batchId = 'batch-img-test-001'
    const batchDir = path.join(batchesDir, batchId)
    fs.mkdirSync(batchDir, { recursive: true })

    const key1 = `${batchId}:leaflet-001:23:o1`
    const key2 = `${batchId}:leaflet-001:23:o2`
    const key3Existing = `${batchId}:leaflet-001:23:o3`
    const key4Sibling = `${batchId}:leaflet-002:4:o4`

    fs.writeFileSync(
      path.join(ws, 'staged-draft.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        leafletHash: 'c'.repeat(64),
        sourcePdfPath: path.join(root, 'carrefour.pdf'),
        header: { supermarketId: UUID_CARREFOUR, validFrom: '2026-11-11', validTo: '2026-11-17', locationScope: 'national' },
        items: [
          {
            id: 'o1',
            sourceOfferId: 'o1',
            pageNumber: 23,
            titleEn: 'Al Safeer Basmati Rice 10kg',
            titleAr: 'أرز بسمتي السفير 10 كجم',
            brand: 'Al Safeer',
            priceAfter: 59.95,
            sizeOrWeight: '10kg',
            each_size_value: 10,
            each_size_unit: 'kg',
            inner_pack_count: 1,
            sale_unit_type: 'piece',
            croppedEvidenceLocalPath: offerCrop,
            productThumbLocalPath: thumbCrop,
            imageSubjectScope: 'product_package'
          },
          {
            id: 'o2',
            sourceOfferId: 'o2',
            pageNumber: 23,
            titleEn: 'Mixed Flavors Biscuits 150g',
            titleAr: 'بسكويت متنوع 150 جم',
            brand: 'Tishoo',
            priceAfter: 5.5,
            sizeOrWeight: '150g',
            each_size_value: 150,
            each_size_unit: 'g',
            inner_pack_count: 1,
            sale_unit_type: 'piece',
            croppedEvidenceLocalPath: offerCrop,
            productThumbLocalPath: assortCrop,
            imageSubjectScope: 'representative_assortment'
          },
          {
            id: 'o3',
            sourceOfferId: 'o3',
            pageNumber: 23,
            titleEn: 'Nescafe Gold 200g',
            titleAr: 'نسكافيه جولد 200 جم',
            brand: 'Nescafe',
            priceAfter: 29.95,
            sizeOrWeight: '200g',
            each_size_value: 200,
            each_size_unit: 'g',
            inner_pack_count: 1,
            sale_unit_type: 'piece',
            croppedEvidenceLocalPath: offerCrop,
            productThumbLocalPath: thumbCrop,
            imageSubjectScope: 'product_package'
          }
        ]
      })
    )

    const ws2 = path.join(extractsDir, 'ws-panda-sibling')
    fs.mkdirSync(ws2, { recursive: true })
    fs.writeFileSync(
      path.join(ws2, 'staged-draft.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        leafletHash: 'd'.repeat(64),
        sourcePdfPath: path.join(root, 'panda.pdf'),
        header: { supermarketId: 'c2cc16c2-0001-4444-b000-c00000000001', validFrom: '2026-11-11', validTo: '2026-11-17', locationScope: 'national' },
        items: [
          {
            id: 'o4',
            sourceOfferId: 'o4',
            pageNumber: 4,
            titleEn: 'Al Safeer Basmati Rice 10kg',
            titleAr: 'أرز بسمتي السفير 10 كجم',
            brand: 'Al Safeer',
            priceAfter: 61.95,
            sizeOrWeight: '10kg',
            each_size_value: 10,
            each_size_unit: 'kg',
            inner_pack_count: 1,
            sale_unit_type: 'piece',
            croppedEvidenceLocalPath: offerCrop,
            productThumbLocalPath: thumbCrop,
            imageSubjectScope: 'product_package'
          }
        ]
      })
    )

    fs.writeFileSync(
      path.join(batchDir, 'batch-manifest.json'),
      JSON.stringify({
        batchId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        executionMode: 'flex',
        extractionPipelineMode: 'hybrid_v3',
        model: CURRENT_HYBRID_COMPATIBILITY_PROFILE.modelId,
        leaflets: [
          {
            leafletId: 'leaflet-001',
            fileName: 'carrefour.pdf',
            filePath: path.join(root, 'carrefour.pdf'),
            fileFingerprint: 'c'.repeat(64),
            workspacePath: ws,
            status: 'completed',
            pageCount: 62,
            pagesProcessed: 1,
            offersCount: 3,
            estimatedCostUsd: 0,
            metadata: { supermarketId: UUID_CARREFOUR, supermarketName: 'Carrefour', offerStartDate: '2026-11-11', offerEndDate: '2026-11-17', locationScope: 'national', currency: 'SAR', verified: true, metadataStatus: 'operator_verified' }
          },
          {
            leafletId: 'leaflet-002',
            fileName: 'panda.pdf',
            filePath: path.join(root, 'panda.pdf'),
            fileFingerprint: 'd'.repeat(64),
            workspacePath: ws2,
            status: 'completed',
            pageCount: 40,
            pagesProcessed: 1,
            offersCount: 1,
            estimatedCostUsd: 0,
            metadata: { supermarketId: 'c2cc16c2-0001-4444-b000-c00000000001', supermarketName: 'Hyper Panda', offerStartDate: '2026-11-11', offerEndDate: '2026-11-17', locationScope: 'national', currency: 'SAR', verified: true, metadataStatus: 'operator_verified' }
          }
        ],
        totals: { totalPdfs: 2, completedPdfs: 2, failedPdfs: 0, cancelledPdfs: 0, totalPages: 2, pagesProcessed: 2, totalOffers: 4, totalCostUsd: 0 },
        approvedScope: { targetDatabaseContext: 'DEVELOPMENT_TEST', pagesByLeafletId: { 'leaflet-001': [23], 'leaflet-002': [4] }, totalTargetPages: 2, approvedMaxBudgetUsd: 0.5, authorizedAt: new Date().toISOString() }
      })
    )

    const orchestrator = new CatalogMatchingOrchestrator(undefined, undefined, undefined, undefined, batchesDir)
    const initialManifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId,
      runId: 'run-img-001',
      matchingDatabaseContext: 'DEVELOPMENT_TEST',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'completed',
      model: 'gemini-2.5-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      totals: emptyTotals({ totalExtractedOffers: 4, uniqueIdentitiesCount: 3, proposedExistingCount: 1, proposedTemporaryCount: 2, unresolvedCount: 1 }),
      proposals: {
        [key1]: {
          batchOfferKey: key1,
          sourceOfferId: 'o1',
          sourcePage: 23,
          leafletId: 'leaflet-001',
          supermarketName: 'Carrefour',
          decision: 'temporary',
          matchedProductId: null,
          temporaryId: 'temp_alsafeer_10kg',
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: new Date().toISOString()
        },
        [key2]: {
          batchOfferKey: key2,
          sourceOfferId: 'o2',
          sourcePage: 23,
          leafletId: 'leaflet-001',
          supermarketName: 'Carrefour',
          decision: 'unresolved',
          matchedProductId: null,
          temporaryId: null,
          confidence: 'low',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: new Date().toISOString()
        },
        [key3Existing]: {
          batchOfferKey: key3Existing,
          sourceOfferId: 'o3',
          sourcePage: 23,
          leafletId: 'leaflet-001',
          supermarketName: 'Carrefour',
          decision: 'existing',
          matchedProductId: '42',
          matchedProduct: {
            id: '42',
            brand: 'Nescafe',
            nameEn: 'Nescafe Gold 200g',
            nameAr: 'نسكافيه جولد 200 جم',
            variant: null,
            sizeValue: 200,
            sizeUnit: 'g',
            packCount: 1,
            imageUrl: 'https://cdn.example.com/storage/v1/object/public/product-images/products/42/main.webp'
          },
          matchedDatabaseContext: 'DEVELOPMENT_TEST',
          temporaryId: null,
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'approved',
          updatedAt: new Date().toISOString()
        },
        [key4Sibling]: {
          batchOfferKey: key4Sibling,
          sourceOfferId: 'o4',
          sourcePage: 4,
          leafletId: 'leaflet-002',
          supermarketName: 'Hyper Panda',
          decision: 'temporary',
          matchedProductId: null,
          temporaryId: 'temp_alsafeer_10kg',
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: new Date().toISOString()
        }
      },
      temporaryProducts: {
        temp_alsafeer_10kg: {
          temporaryId: 'temp_alsafeer_10kg',
          brandKey: 'al_safeer',
          brandNameEn: 'Al Safeer',
          brandNameAr: 'السفير',
          productNameEn: 'Al Safeer Basmati Rice 10kg',
          productNameAr: 'أرز بسمتي السفير 10 كجم',
          variantOrFlavor: null,
          fatContent: null,
          eachSizeValue: 10,
          eachSizeUnit: 'kg',
          innerPackCount: 1,
          saleUnitType: 'piece',
          productForm: null,
          sourceOfferKeys: [key1, key4Sibling],
          retailers: ['Carrefour', 'Hyper Panda'],
          sampleThumbCropPath: thumbCrop,
          operatorDecision: 'proposed',
          validationWarnings: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      },
      brandSummaries: {}
    }
    orchestrator.saveManifestAtomic(initialManifest)

    // 9A. Existing catalog product with imageUrl automatically inherits reuse_existing_catalog_image
    const loadedAfterSave = orchestrator.loadManifest(batchId)!
    expect(loadedAfterSave.consumerImageApprovals?.[key3Existing]?.status).toBe('reuse_existing_catalog_image')
    expect(loadedAfterSave.consumerImageApprovals?.[key3Existing]?.existingCatalogImageUrl).toContain('product-images')

    // 8. Private evidence offer_card_crop & representative_assortment crops MUST be blocked
    expect(() =>
      orchestrator.applyConsumerProductImageDecision({
        batchId,
        batchOfferKey: key1,
        decision: 'approve_generated_crop',
        productThumbCropPath: offerCrop,
        imageSubjectScope: 'product_package'
      })
    ).toThrow(/SECURITY_BLOCK/i)

    expect(() =>
      orchestrator.applyConsumerProductImageDecision({
        batchId,
        batchOfferKey: key2,
        decision: 'approve_generated_crop',
        productThumbCropPath: assortCrop,
        imageSubjectScope: 'representative_assortment'
      })
    ).toThrow(/IMAGE_SCOPE_BLOCK/i)

    // 7 + 9B. Approve product_thumb_crop.webp for key1 -> persists AND sibling key4 reuses it
    const approvedManifest = orchestrator.applyConsumerProductImageDecision({
      batchId,
      batchOfferKey: key1,
      decision: 'approve_generated_crop',
      productThumbCropPath: thumbCrop,
      imageSubjectScope: 'product_package',
      boundProductKey: 'temp:temp_alsafeer_10kg',
      rightsBasis: 'operator_verified_leaflet_product_crop',
      verifiedBy: 'uat_operator'
    })
    const batchSvc = new BatchOrchestrationService(batchesDir)
    await batchSvc.syncConsumerImageApprovalToStagedDraft({
      batchId,
      batchOfferKey: key1,
      approval: approvedManifest.consumerImageApprovals?.[key1] ?? null
    })

    const offersAfterApprove = await batchSvc.getUnifiedBatchOffers(batchId)
    const o1After = offersAfterApprove.find((o) => o.batchOfferKey === key1)!
    const o3After = offersAfterApprove.find((o) => o.batchOfferKey === key3Existing)!
    const o4Sibling = offersAfterApprove.find((o) => o.batchOfferKey === key4Sibling)!

    expect(o1After.consumerImageApprovalStatus).toBe('approved_generated_crop')
    expect(o1After.consumerProductImagePath).toBe(thumbCrop)
    expect(o1After.approvedConsumerImageRightsBasis).toBe('operator_verified_leaflet_product_crop')
    expect(o3After.consumerImageApprovalStatus).toBe('reuse_existing_catalog_image')
    expect(o3After.consumerProductImagePath).toBeNull()
    expect(o4Sibling.consumerImageApprovalStatus).toBe('approved_generated_crop')
    expect(o4Sibling.consumerProductImagePath).toBe(thumbCrop)

    // 10A. Changing product identity fields via updateBatchOfferFields invalidates staged consumer image approval
    const o1AfterIdentityEdit = await batchSvc.updateBatchOfferFields({
      batchId,
      batchOfferKey: key1,
      operatorId: 'uat_operator',
      orchestrator,
      patch: {
        each_size_value: 5,
        sizeOrWeight: '5kg',
        titleEn: 'Al Safeer Basmati Rice 5kg'
      }
    })
    expect(o1AfterIdentityEdit.consumerImageApprovalStatus).toBe('invalidated_identity_changed')
    expect(o1AfterIdentityEdit.consumerProductImagePath).toBeNull()

    // 10B. Re-approve for key4Sibling then relink key4Sibling to a different product ID -> cross-product misassignment blocked!
    orchestrator.applyConsumerProductImageDecision({
      batchId,
      batchOfferKey: key4Sibling,
      decision: 'approve_generated_crop',
      productThumbCropPath: thumbCrop,
      imageSubjectScope: 'product_package',
      boundProductKey: 'temp:temp_alsafeer_10kg'
    })
    const relinkedManifest = orchestrator.applyOperatorDecision({
      batchId,
      batchOfferKey: key4Sibling,
      decision: 'approved',
      linkedPermanentProductId: '999'
    })
    expect(relinkedManifest.consumerImageApprovals?.[key4Sibling]?.status).toBe('invalidated_identity_changed')
    expect(relinkedManifest.consumerImageApprovals?.[key4Sibling]?.approvedLocalPath).toBeNull()

    // BrandGroupingService enriches candidates with public.product_images primary approved URL when default_image_url is null
    const groupingSvc = new BrandGroupingService()
    const fakeSupabase: any = {
      from: (table: string) => {
        if (table === 'products') {
          const builder: any = {
            select: () => builder,
            or: () => {
              const p: any = Promise.resolve({ count: 1, error: null })
              p.limit = async () => ({
                data: [
                  {
                    id: 77,
                    name_en: 'Sunwhite Calrose Rice 5kg',
                    name_ar: 'أرز سنوايت كالروز 5 كجم',
                    brand_name: 'Sunwhite',
                    variant_or_flavor: null,
                    each_size_value: 5,
                    each_size_unit: 'kg',
                    inner_pack_count: 1,
                    default_image_url: null
                  }
                ],
                error: null
              })
              return p
            },
            ilike: () => builder,
            limit: async () => ({
              data: [
                {
                  id: 77,
                  name_en: 'Sunwhite Calrose Rice 5kg',
                  name_ar: 'أرز سنوايت كالروز 5 كجم',
                  brand_name: 'Sunwhite',
                  variant_or_flavor: null,
                  each_size_value: 5,
                  each_size_unit: 'kg',
                  inner_pack_count: 1,
                  default_image_url: null
                }
              ],
              count: 1,
              error: null
            })
          }
          return builder
        }
        if (table === 'product_images') {
          const piBuilder: any = {
            select: () => piBuilder,
            in: () => piBuilder,
            eq: async () => ({
              data: [
                {
                  product_id: 77,
                  role: 'primary',
                  approval_status: 'approved',
                  public_url: 'https://cdn.example.com/storage/v1/object/public/product-images/products/77.webp'
                }
              ],
              error: null
            })
          }
          return piBuilder
        }
        return {}
      }
    }
    const groups = groupingSvc.groupOffersByBrand([
      buildOffer({
        batchOfferKey: 'b:l:1:sun1',
        sourceOfferId: 'sun1',
        titleEn: 'Sunwhite Calrose Rice 5kg',
        titleAr: 'أرز سنوايت كالروز 5 كجم',
        brand: 'Sunwhite',
        brandEn: 'Sunwhite',
        sizeOrWeight: '5kg',
        each_size_value: 5,
        each_size_unit: 'kg'
      })
    ])
    const candRes = await groupingSvc.retrieveBrandCandidates(fakeSupabase, groups[0])
    expect(candRes.candidates[0]?.imageUrl).toBe(
      'https://cdn.example.com/storage/v1/object/public/product-images/products/77.webp'
    )
  })

  it('11. Publication + Undo with product-images: cleans up exclusive product_images/default_image_url & preserves shared images', async () => {
    const iso = await createIsolatedWifranPostgres({ upToMigration: 10 })
    const dir = makeTempDir('wifran-p3-pub-undo-')
    try {
      const storage = createInMemoryStorageAdapter(
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public'
      )
      const pubSvc = new CatalogPublicationService()

      const offerCardA = await makeWebp(path.join(dir, 'a_offer.webp'), { r: 210, g: 50, b: 50 })
      const prodThumbA = await makeWebp(path.join(dir, 'a_thumb.webp'), { r: 40, g: 190, b: 80 })
      const offerCardB = await makeWebp(path.join(dir, 'b_offer.webp'), { r: 100, g: 60, b: 190 })
      const prodThumbB = await makeWebp(path.join(dir, 'b_thumb.webp'), { r: 50, g: 120, b: 220 })

      const countBucket = (bucket: string) =>
        Array.from(storage.storedObjects.keys()).filter((k) => k.startsWith(`${bucket}/`)).length

      const buildTempManifest = (batchId: string, offers: UnifiedBatchOffer[], tempId: string): MatchingRunManifest => ({
        schemaVersion: '1.0',
        batchId,
        runId: `run-${batchId}`,
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-2.5-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        totals: emptyTotals({ totalExtractedOffers: offers.length, uniqueIdentitiesCount: 1, proposedTemporaryCount: offers.length }),
        proposals: Object.fromEntries(
          offers.map((o) => [
            o.batchOfferKey,
            {
              batchOfferKey: o.batchOfferKey,
              sourceOfferId: o.sourceOfferId,
              sourcePage: o.sourcePage,
              leafletId: o.leafletId,
              supermarketName: o.supermarketName,
              decision: 'temporary' as const,
              matchedProductId: null,
              temporaryId: tempId,
              confidence: 'high' as const,
              matchMethod: 'deterministic' as const,
              validationIssues: [],
              operatorDecision: 'approved' as const,
              updatedAt: new Date().toISOString()
            }
          ])
        ),
        temporaryProducts: {
          [tempId]: {
            temporaryId: tempId,
            brandKey: 'al_safeer',
            brandNameEn: 'Al Safeer',
            brandNameAr: 'السفير',
            productNameEn: 'Al Safeer Basmati Rice 10kg',
            productNameAr: 'أرز بسمتي السفير 10 كجم',
            variantOrFlavor: null,
            fatContent: null,
            eachSizeValue: 10,
            eachSizeUnit: 'kg',
            innerPackCount: 1,
            saleUnitType: 'piece',
            productForm: null,
            sourceOfferKeys: offers.map((o) => o.batchOfferKey),
            retailers: ['Carrefour'],
            sampleThumbCropPath: prodThumbA,
            operatorDecision: 'approved',
            validationWarnings: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        },
        brandSummaries: {}
      })

      const offer1 = buildOffer({
        offerCardCropPath: offerCardA,
        productThumbCropPath: prodThumbA,
        consumerProductImagePath: prodThumbA,
        approvedConsumerImageRightsBasis: 'operator_verified_leaflet_product_crop',
        consumerImageApprovalStatus: 'approved_generated_crop',
        imageSubjectScope: 'product_package'
      })

      const res1 = await pubSvc.publishApprovedCatalogBatch({
        manifest: buildTempManifest('b1', [offer1], 'temp_alsafeer_1'),
        offers: [offer1],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        referenceDateIso: '2026-11-12',
        pgClient: iso.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true
      })
      expect(res1.insertedOffersCount).toBe(1)
      expect(res1.createdProductsCount).toBe(1)

      const createdPid = Number(Object.values(res1.createdProductMap)[0])
      expect((await iso.client.query(`SELECT COUNT(*)::int AS c FROM public.product_images`)).rows[0].c).toBe(1)
      const prodRowAfter1 = await iso.client.query(`SELECT default_image_url FROM public.products WHERE id = $1`, [createdPid])
      expect(prodRowAfter1.rows[0].default_image_url).toContain('/storage/v1/object/public/product-images/')

      expect(countBucket('product-images')).toBe(1)
      expect(countBucket('offer-images')).toBe(2)

      // Undo Publish 1 cleanly deletes exclusive product_images + products row + product-images storage object
      const undo1 = await undoLastPublish({
        client: iso.client,
        storageAdapter: storage,
        operatorId: 'uat_op',
        reason: 'Verify product_images + storage cleanup',
        publishOperationId: res1.publishOperationId
      })
      expect(undo1.success).toBe(true)
      expect(countBucket('product-images')).toBe(0)
      expect(countBucket('offer-images')).toBe(0)
      expect((await iso.client.query(`SELECT COUNT(*)::int AS c FROM public.product_images`)).rows[0].c).toBe(0)

      // Existing product 901 single publish -> Undo restores products.default_image_url to null and cleans up product-images
      await iso.client.query(
        `INSERT INTO public.products (id, name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status)
         OVERRIDING SYSTEM VALUE
         VALUES (901, 'Existing Pasta 500g', 'مكرونة 500 جم', 'Barilla', 500, 'g', 1, 'verified')`
      )
      const existingSingleOffer = buildOffer({
        batchOfferKey: 'b2_single:l1:1:s1',
        batchId: 'b2_single',
        sourceOfferId: 'doc_cf_p23_test1:p001:i001:single901',
        sourceOfferAnchor: 'anchor_s1_single',
        titleEn: 'Barilla Spaghetti 500g',
        titleAr: 'مكرونة باريلا 500 جم',
        brand: 'Barilla',
        brandEn: 'Barilla',
        each_size_value: 500,
        each_size_unit: 'g',
        offerCardCropPath: offerCardB,
        productThumbCropPath: prodThumbB,
        consumerProductImagePath: prodThumbB,
        approvedConsumerImageRightsBasis: 'operator_verified_leaflet_product_crop',
        consumerImageApprovalStatus: 'approved_generated_crop'
      })
      const existingManifest = (batchId: string, o: UnifiedBatchOffer, targetPid = '901'): MatchingRunManifest => ({
        schemaVersion: '1.0',
        batchId,
        runId: `run-${batchId}`,
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-2.5-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        totals: emptyTotals({ totalExtractedOffers: 1, uniqueIdentitiesCount: 1, proposedExistingCount: 1, proposedTemporaryCount: 0 }),
        proposals: {
          [o.batchOfferKey]: {
            batchOfferKey: o.batchOfferKey,
            sourceOfferId: o.sourceOfferId,
            sourcePage: o.sourcePage,
            leafletId: o.leafletId,
            supermarketName: o.supermarketName,
            decision: 'existing',
            matchedProductId: targetPid,
            matchedDatabaseContext: 'DEVELOPMENT_TEST',
            temporaryId: null,
            confidence: 'high',
            matchMethod: 'deterministic',
            validationIssues: [],
            operatorDecision: 'approved',
            updatedAt: new Date().toISOString()
          }
        },
        temporaryProducts: {},
        brandSummaries: {}
      })

      const resSingle901 = await pubSvc.publishApprovedCatalogBatch({
        manifest: existingManifest('b2_single', existingSingleOffer, '901'),
        offers: [existingSingleOffer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        referenceDateIso: '2026-11-12',
        pgClient: iso.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true
      })
      expect(resSingle901.insertedOffersCount).toBe(1)
      expect((await iso.client.query(`SELECT default_image_url FROM public.products WHERE id = 901`)).rows[0].default_image_url).toContain('/storage/v1/object/public/product-images/')

      const undoSingle901 = await undoLastPublish({
        client: iso.client,
        storageAdapter: storage,
        operatorId: 'uat_op',
        reason: 'Verify default_image_url restoration + cleanup',
        publishOperationId: resSingle901.publishOperationId
      })
      expect(undoSingle901.blockedReasons).toEqual([])
      expect(undoSingle901.success).toBe(true)
      expect((await iso.client.query(`SELECT default_image_url FROM public.products WHERE id = 901`)).rows[0].default_image_url).toBeNull()
      expect(countBucket('product-images')).toBe(0)
      expect(countBucket('offer-images')).toBe(0)

      // Shared image preservation across two separate publications targeting existing product 902
      await iso.client.query(
        `INSERT INTO public.products (id, name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status)
         OVERRIDING SYSTEM VALUE
         VALUES (902, 'Existing Fusilli 500g', 'فوسيلي 500 جم', 'Barilla', 500, 'g', 1, 'verified')`
      )
      const sharedOffer1 = buildOffer({
        batchOfferKey: 'b2:l1:1:s1',
        batchId: 'b2',
        sourceOfferId: 'doc_cf_p23_test1:p001:i001:s01',
        sourceOfferAnchor: 'anchor_s1',
        titleEn: 'Barilla Fusilli 500g',
        titleAr: 'مكرونة باريلا فوسيلي 500 جم',
        brand: 'Barilla',
        brandEn: 'Barilla',
        each_size_value: 500,
        each_size_unit: 'g',
        offerCardCropPath: offerCardB,
        productThumbCropPath: prodThumbB,
        consumerProductImagePath: prodThumbB,
        approvedConsumerImageRightsBasis: 'operator_verified_leaflet_product_crop',
        consumerImageApprovalStatus: 'approved_generated_crop'
      })
      const sharedOffer2 = buildOffer({
        ...sharedOffer1,
        batchOfferKey: 'b3:l1:1:s2',
        batchId: 'b3',
        sourceOfferId: 'doc_cf_p23_test1:p001:i002:s01',
        sourceOfferAnchor: 'anchor_s2',
        cityId: UUID_JEDDAH,
        locationScope: 'city'
      })

      const resShared1 = await pubSvc.publishApprovedCatalogBatch({
        manifest: existingManifest('b2', sharedOffer1, '902'),
        offers: [sharedOffer1],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        referenceDateIso: '2026-11-12',
        pgClient: iso.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true
      })
      expect(resShared1.insertedOffersCount).toBe(1)
      expect(countBucket('product-images')).toBe(1)

      const resShared2 = await pubSvc.publishApprovedCatalogBatch({
        manifest: existingManifest('b3', sharedOffer2, '902'),
        offers: [sharedOffer2],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        referenceDateIso: '2026-11-12',
        pgClient: iso.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true
      })
      expect(resShared2.insertedOffersCount).toBe(1)

      // Undo Publish 2 must preserve shared objects still referenced by Publish 1!
      const undoShared2 = await undoLastPublish({
        client: iso.client,
        storageAdapter: storage,
        operatorId: 'uat_op',
        reason: 'Verify shared preservation',
        publishOperationId: resShared2.publishOperationId
      })
      expect(undoShared2).toMatchObject({ success: true })
      expect(countBucket('product-images')).toBe(1)
      expect(countBucket('offer-images')).toBe(2)
    } finally {
      await iso.db.close()
    }
  }, 20000)

  it('12-13. Non-grocery exclusion diagnostics: no "Blocked by conflict code(s): .", no grocery MISSING_UNIT_SIZE false positive', () => {
    const luluNonGroceryCard: OfferContractV3Record = {
      schema_version: 'wifran.extractor.card/3.0',
      source_card: {
        leaflet_id: 'lulu-jeddah',
        page_number: 7,
        source_offer_id: 'p7_lulu_tv_01',
        source_evidence_ref_internal: null,
        retailer_id: UUID_CARREFOUR,
        retailer_name: 'LuLu Hypermarket',
        offer_start_date: '2026-11-11',
        offer_end_date: '2026-11-17',
        location_scope: 'national',
        city_id: null,
        region_id: null,
        raw_text: {
          title_ar: 'تلفزيون إمبكس ذكي 55 بوصة',
          title_en: 'Impex Smart 4K QLED TV 55 Inch',
          size_text: '55 Inch',
          promo_badge_text: 'SAR 1399',
          price_text_candidates: ['1399', '1899']
        }
      },
      pricing: {
        promo_price: 1399,
        original_price: 1899,
        currency: 'SAR',
        currency_evidence: 'SAR',
        price_basis: 'each',
        price_role_confidence: 'high',
        promo_conditions: null,
        price_conflict_flags: []
      },
      assortment: {
        status: 'confirmed_single_sku',
        visible_variant_count: 1,
        identifiable_sub_item_count: 1,
        assortment_evidence: [],
        is_enumerated_list_complete: true,
        all_options_linkable: false
      },
      sub_items: [
        {
          sub_item_ref: 's01',
          brand_en: 'Impex',
          brand_ar: 'إمبكس',
          product_name_en: 'Impex Smart 4K QLED TV 55 Inch',
          product_name_ar: 'تلفزيون إمبكس ذكي 55 بوصة',
          variant_or_flavor: null,
          each_size_value: 1,
          each_size_unit: 'pcs',
          manufacturer_pack_count: 1,
          product_form: null,
          independent_promo_price: 1399,
          independent_original_price: 1899,
          printed_retailer_sku_code: null,
          is_retailer_sku_only_not_gtin: true,
          evidence_refs: [],
          unknown_attributes: [],
          conflict_attributes: [],
          safe_for_catalog_matching: true
        }
      ],
      quantity_and_promo: {
        sale_basis: 'single_unit',
        each_size_value: 1,
        each_size_unit: 'pcs',
        manufacturer_pack_count: 1,
        retailer_checkout_multibuy_qty: null,
        factory_bonus_paid_qty: null,
        factory_bonus_free_qty: null,
        customer_limit_pcs: null,
        shared_promotional_price: null,
        quantity_price_tiers: [],
        is_per_weight_pricing: false,
        loyalty_required: false,
        loyalty_program_name: null
      },
      non_grocery_specs: {
        domain: 'electronics',
        screen_size_inches: 55,
        excluded_from_default_grocery_feed: true
      },
      extraction_confidence: 'high',
      evidence_conflicts: [],
      evidence_ledger: [],
      printed_retailer_sku_codes: []
    }

    const decomp = decomposeV3OfferCard(luluNonGroceryCard)
    expect(decomp.parent_offer_retention_mode).toBe('quarantined_do_not_publish')
    expect(decomp.conflict_codes).toEqual([])
    expect(decomp.rejection_reasons.join(' ')).not.toContain('Blocked by conflict code(s): .')
    expect(decomp.rejection_reasons.join(' ').toLowerCase()).toContain('non-grocery')

    // evaluateIdentitySufficiency must NOT emit grocery MISSING_UNIT_SIZE for non-grocery items
    const nonGroceryEval = evaluateIdentitySufficiency(
      {
        brandKey: 'impex',
        brandNameEn: 'Impex',
        brandStatus: 'known',
        productNameEn: 'Impex Smart 4K QLED TV 55 Inch',
        eachSizeValue: 1,
        eachSizeUnit: 'pcs',
        saleUnitType: 'piece'
      },
      {
        titleEn: 'Impex Smart 4K QLED TV 55 Inch',
        category: 'electronics',
        canonical: { reconciled_v3: { non_grocery_specs: { domain: 'electronics', excluded_from_default_grocery_feed: true } } }
      }
    )
    expect(nonGroceryEval.codes).not.toContain('MISSING_UNIT_SIZE')
    expect(nonGroceryEval.codes).toContain('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')

    // Grocery item missing net size MUST still emit MISSING_UNIT_SIZE cleanly
    const groceryMissingSizeEval = evaluateIdentitySufficiency(
      {
        brandKey: 'almarai',
        brandNameEn: 'Almarai',
        brandStatus: 'known',
        productNameEn: 'Almarai Fresh Milk',
        eachSizeValue: null,
        eachSizeUnit: null,
        saleUnitType: 'piece'
      },
      {
        titleEn: 'Almarai Fresh Milk'
      }
    )
    expect(groceryMissingSizeEval.codes).toContain('MISSING_UNIT_SIZE')

    // Review triage cleanly distinguishes Non-Grocery Excluded vs Extraction Conflict vs Missing Identity
    const triageNonGrocery = classifyOfferReviewTriage({
      offer: buildOffer({
        batchOfferKey: 'b:l:7:tv1',
        sourceFileName: 'lulu.pdf',
        sourcePage: 7,
        sourceOfferId: 'tv1',
        titleEn: 'Impex Smart 4K QLED TV 55 Inch',
        titleAr: 'تلفزيون إمبكس ذكي',
        brand: 'Impex',
        promoPrice: 1399,
        originalPrice: 1899,
        sizeOrWeight: null,
        each_size_value: 1,
        each_size_unit: 'pcs',
        quarantineReasons: ['V3_PARENT_OFFER_QUARANTINED'],
        conflictCodes: [],
        v3RetentionMode: 'quarantined_do_not_publish',
        status: 'extracted',
        category: 'electronics',
        canonical: { reconciled_v3: { non_grocery_specs: { domain: 'electronics', excluded_from_default_grocery_feed: true } } }
      })
    })
    expect(triageNonGrocery.diagnosticKind).toBe('non_grocery_excluded')
    expect(triageNonGrocery.diagnosticLabel).toBe('Non-Grocery Excluded')
  })
})
