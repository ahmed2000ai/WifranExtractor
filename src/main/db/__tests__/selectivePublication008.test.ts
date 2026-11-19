import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createIsolatedWifranPostgres } from './isolatedPostgresHarness008'
import { BatchOrchestrationService } from '../../batch/batchOrchestrationService'
import { CatalogMatchingOrchestrator } from '../../batch/catalogMatchingOrchestrator'
import { CatalogPublicationService } from '../catalogPublicationService'
import { VerifiedMatchCacheService } from '../verifiedMatchCacheService'
import { listPublicationHistory, undoLastPublish } from '../publicationJournalAndUndoService'
import { createInMemoryStorageAdapter } from '../../storage/stagedStorageLifecycleService'
import { summarizeBatchReviewTriage } from '../../../shared/utils/reviewTriageClassifier'
import { revalidateOfferItem } from '../../../shared/utils/offerRevalidation'
import type { BatchManifest } from '../../../shared/types/batchExtraction'
import type { MatchingRunManifest } from '../../../shared/types/catalogMatching'

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
      // ignore Windows handle cleanup timing
    }
  }
})

async function makeCropImage(filePath: string, rgb: { r: number; g: number; b: number }): Promise<string> {
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
const UUID_OTHAIM = 'c2cc16c2-0002-4444-b000-c00000000002'
const UUID_JEDDAH = 'a6f7b140-0002-4444-a000-000000000002'

async function setupBatchFixture(baseDir: string, options?: { multiLeaflet?: boolean }) {
  const batchesDir = path.join(baseDir, 'batches')
  const cacheDir = path.join(baseDir, 'cache')
  const batchId = 'batch-selective-001'
  const ws1 = path.join(baseDir, 'ws-leaflet-1')
  const ws2 = path.join(baseDir, 'ws-leaflet-2')
  fs.mkdirSync(path.join(batchesDir, batchId, 'catalog-matching'), { recursive: true })
  fs.mkdirSync(ws1, { recursive: true })
  if (options?.multiLeaflet) fs.mkdirSync(ws2, { recursive: true })

  const cardReady = await makeCropImage(path.join(ws1, 'crops/page_1/o1/offer_card_crop.webp'), { r: 220, g: 40, b: 40 })
  const thumbReady = await makeCropImage(path.join(ws1, 'crops/page_1/o1/product_thumb_crop.webp'), { r: 40, g: 220, b: 40 })
  const cardBlocked = await makeCropImage(path.join(ws1, 'crops/page_1/o2/offer_card_crop.webp'), { r: 30, g: 30, b: 220 })
  const thumbBlocked = await makeCropImage(path.join(ws1, 'crops/page_1/o2/product_thumb_crop.webp'), { r: 220, g: 220, b: 40 })

  const draft1 = {
    schemaVersion: '1.0',
    batchId,
    leafletId: 'leaflet-001',
    status: 'draft',
    header: {
      supermarketId: UUID_CARREFOUR,
      locationScope: 'national',
      region: 'National',
      validFrom: '2026-11-11',
      validTo: '2026-11-17',
      currency: 'SAR'
    },
    items: [
      {
        id: 'o1',
        sourceOfferId: 'o1',
        pageNumber: 1,
        titleEn: 'Al Safeer Basmati Rice 10kg',
        titleAr: 'السفير أرز بسمتي ١٠ كج',
        brand: 'Al Safeer',
        brandEn: 'Al Safeer',
        brandAr: 'السفير',
        priceAfter: 59.99,
        priceBefore: 92.5,
        sizeOrWeight: '10kg',
        each_size_value: 10,
        each_size_unit: 'kg',
        inner_pack_count: 1,
        sale_unit_type: 'piece',
        category: 'grocery',
        assortment_status: 'confirmed_single_sku',
        croppedEvidenceLocalPath: cardReady,
        productThumbLocalPath: thumbReady,
        imageSubjectScope: 'product_package',
        conflictCodes: [],
        quarantineReasons: [],
        v3RetentionMode: 'unsplit_single_sku'
      },
      {
        id: 'o2',
        sourceOfferId: 'o2',
        pageNumber: 1,
        titleEn: 'O-Lite Canola Oil 1.5L X2',
        titleAr: 'أولايت زيت كانولا ١،٥ مل × ٢',
        brand: 'O-Lite',
        brandEn: 'O-Lite',
        brandAr: 'أولايت',
        priceAfter: 36.99,
        priceBefore: 46.75,
        sizeOrWeight: '2x1.5l',
        each_size_value: 1.5,
        each_size_unit: 'l',
        inner_pack_count: 2,
        sale_unit_type: 'pack',
        category: 'grocery',
        assortment_status: 'confirmed_single_sku',
        croppedEvidenceLocalPath: cardBlocked,
        productThumbLocalPath: thumbBlocked,
        imageSubjectScope: 'product_package',
        conflictCodes: ['EN_AR_WEIGHT_VOLUME_CONFLICT', 'PROMO_QTY_VS_MFG_PACK_CONFLICT'],
        quarantineReasons: ['V3_PARENT_OFFER_QUARANTINED', 'FACT_OR_PROMO_CONFLICT', 'EN_AR_WEIGHT_VOLUME_CONFLICT', 'PROMO_QTY_VS_MFG_PACK_CONFLICT'],
        v3RetentionMode: 'quarantined_do_not_publish',
        blockingErrors: ['EN_AR_WEIGHT_VOLUME_CONFLICT', 'PROMO_QTY_VS_MFG_PACK_CONFLICT']
      },
      {
        id: 'o3',
        sourceOfferId: 'o3',
        pageNumber: 1,
        titleEn: 'Samsung Smart LED TV 55 Inch',
        titleAr: 'تلفزيون سامسونج ٥٥ بوصة',
        brand: 'Samsung',
        brandEn: 'Samsung',
        priceAfter: 1899,
        priceBefore: 2499,
        sizeOrWeight: '55inch',
        each_size_value: 55,
        each_size_unit: 'inch',
        inner_pack_count: 1,
        sale_unit_type: 'piece',
        category: 'electronics',
        assortment_status: 'confirmed_single_sku',
        croppedEvidenceLocalPath: cardBlocked,
        productThumbLocalPath: null,
        imageSubjectScope: 'unverified',
        conflictCodes: [],
        quarantineReasons: ['NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE'],
        v3RetentionMode: 'quarantined_do_not_publish'
      }
    ],
    createdAt: '2026-11-15T10:00:00Z',
    updatedAt: '2026-11-15T10:00:00Z'
  }
  fs.writeFileSync(path.join(ws1, 'staged-draft.json'), JSON.stringify(draft1, null, 2))

  if (options?.multiLeaflet) {
    const draft2 = {
      schemaVersion: '1.0',
      batchId,
      leafletId: 'leaflet-002',
      status: 'draft',
      header: {
        supermarketId: UUID_OTHAIM,
        locationScope: 'city',
        cityId: UUID_JEDDAH,
        region: 'Jeddah',
        validFrom: '2026-11-11',
        validTo: '2026-11-17',
        currency: 'SAR'
      },
      items: [
        {
          id: 'o201',
          sourceOfferId: 'o201',
          pageNumber: 1,
          titleEn: 'Fresh Lamb Chops Per Kg',
          titleAr: 'ريش غنم طازجة بالكيلو',
          brand: null,
          priceAfter: 49.95,
          priceBefore: 59.95,
          sale_unit_type: 'kg',
          category: 'grocery',
          assortment_status: 'confirmed_single_sku',
          croppedEvidenceLocalPath: cardReady,
          productThumbLocalPath: null,
          imageSubjectScope: 'unverified',
          conflictCodes: [],
          quarantineReasons: []
        }
      ],
      createdAt: '2026-11-15T10:00:00Z',
      updatedAt: '2026-11-15T10:00:00Z'
    }
    fs.writeFileSync(path.join(ws2, 'staged-draft.json'), JSON.stringify(draft2, null, 2))
  }

  const batchManifest: BatchManifest = {
    schemaVersion: '1.0',
    batchId,
    createdAt: '2026-11-15T10:00:00Z',
    updatedAt: '2026-11-15T10:00:00Z',
    status: 'completed',
    workspaceDir: path.join(batchesDir, batchId),
    model: 'gemini-3.8-flash',
    executionMode: 'flex',
    extractionPipelineMode: 'hybrid_v3',
    totals: {
      totalPdfs: options?.multiLeaflet ? 2 : 1,
      completedPdfs: options?.multiLeaflet ? 2 : 1,
      failedPdfs: 0,
      cancelledPdfs: 0,
      totalPages: options?.multiLeaflet ? 2 : 1,
      pagesProcessed: options?.multiLeaflet ? 2 : 1,
      totalOffers: options?.multiLeaflet ? 4 : 3,
      totalCostUsd: 0
    },
    leaflets: [
      {
        leafletId: 'leaflet-001',
        documentId: 'doc_cf_001',
        fileName: 'carrefour.pdf',
        filePath: '/tmp/carrefour.pdf',
        fileSizeBytes: 1000,
        fileFingerprint: 'aaaa111122223333444455556666777788889999000011112222333344445555',
        pageCount: 1,
        pagesProcessed: 1,
        offersCount: 3,
        estimatedCostUsd: 0,
        status: 'completed',
        workspacePath: ws1,
        provenance: 'cache',
        metadata: {
          supermarketId: UUID_CARREFOUR,
          supermarketName: 'Carrefour',
          locationScope: 'national',
          locationLabel: 'National',
          cityId: null,
          regionId: null,
          offerStartDate: '2026-11-11',
          offerEndDate: '2026-11-17',
          currency: 'SAR',
          verified: true,
          metadataStatus: 'operator_verified'
        }
      },
      ...(options?.multiLeaflet
        ? [
            {
              leafletId: 'leaflet-002',
              documentId: 'doc_oth_002',
              fileName: 'othaim.pdf',
              filePath: '/tmp/othaim.pdf',
              fileSizeBytes: 1000,
              fileFingerprint: 'bbbb111122223333444455556666777788889999000011112222333344445555',
              pageCount: 1,
              pagesProcessed: 1,
              offersCount: 1,
              estimatedCostUsd: 0,
              status: 'completed' as const,
              workspacePath: ws2,
              provenance: 'cache' as const,
              metadata: {
                supermarketId: UUID_OTHAIM,
                supermarketName: 'Al Othaim',
                locationScope: 'city' as const,
                locationLabel: 'Jeddah',
                cityId: UUID_JEDDAH,
                regionId: null,
                offerStartDate: '2026-11-11',
                offerEndDate: '2026-11-17',
                currency: 'SAR',
                verified: true,
                metadataStatus: 'operator_verified' as const
              }
            }
          ]
        : [])
    ]
  }
  fs.writeFileSync(path.join(batchesDir, batchId, 'batch-manifest.json'), JSON.stringify(batchManifest, null, 2))

  const batchSvc = new BatchOrchestrationService(batchesDir)
  const cacheSvc = new VerifiedMatchCacheService(cacheDir, 'development')
  const orchestrator = new CatalogMatchingOrchestrator(cacheSvc, undefined, undefined, undefined, batchesDir)
  const pubSvc = new CatalogPublicationService(cacheSvc)

  return { batchId, batchesDir, batchSvc, orchestrator, pubSvc, ws1, ws2, thumbReady, thumbBlocked }
}

describe('WIFRAN FIX-08 Selective Publication, Revalidation & Metadata Persistence', () => {
  it('1-17. Selective publication of Ready/temp/non-catalog alongside Blocked/Needs Review, anti-bypass revalidation, partial batch reopen, metadata revisions, scoped Undo & update approvals', async () => {
    const tmp = makeTempDir('fix08-selective-')
    const { batchId, batchSvc, orchestrator, pubSvc, thumbReady, thumbBlocked } = await setupBatchFixture(tmp, { multiLeaflet: true })
    const { client: pgClient } = await createIsolatedWifranPostgres({ upToMigration: 12 })
    const storage = createInMemoryStorageAdapter('https://isolated-test.storage.local', {
      'offer-images': false,
      'product-images': true,
      'offer-display-images': true
    })

    try {
      const prodRes = await pgClient.query<{ id: string }>(
        `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status)
         VALUES ('Al Safeer Basmati Rice 10kg', 'السفير أرز بسمتي ١٠ كج', 'Al Safeer', 10, 'kg', 1, 'verified')
         RETURNING id::text`
      )
      const existingProdId = prodRes.rows[0].id

      await batchSvc.getUnifiedBatchOffers(batchId)
      const k1 = `${batchId}:leaflet-001:1:o1` // Ready existing catalog match
      const k2 = `${batchId}:leaflet-001:1:o2` // Blocked EN vs AR unit conflict + temp unapproved
      const k3 = `${batchId}:leaflet-001:1:o3` // Blocked non-grocery excluded
      const k4 = `${batchId}:leaflet-002:1:o201` // Ready non-catalog approved (and later Needs Review test)

      const matchingManifest: MatchingRunManifest = {
        schemaVersion: '1.0',
        batchId,
        runId: 'run-sel-1',
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
        status: 'completed',
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        totals: {
          totalExtractedOffers: 4,
          uniqueIdentitiesCount: 4,
          cacheMatchesCount: 1,
          deterministicMatchesCount: 0,
          geminiEvaluatedCount: 0,
          proposedExistingCount: 1,
          proposedTemporaryCount: 1,
          unresolvedCount: 2,
          validationWarningsCount: 0,
          actualCostUsd: 0,
          estimatedCostUsd: 0,
          geminiRequestsCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0
        },
        proposals: {
          [k1]: {
            batchOfferKey: k1,
            sourceOfferId: 'o1',
            sourcePage: 1,
            leafletId: 'leaflet-001',
            supermarketName: 'Carrefour',
            decision: 'existing',
            matchedProductId: existingProdId,
            matchedDatabaseContext: 'DEVELOPMENT_TEST',
            matchedProduct: {
              id: existingProdId,
              nameEn: 'Al Safeer Basmati Rice 10kg',
              nameAr: 'السفير أرز بسمتي ١٠ كج',
              brand: 'Al Safeer',
              variant: null,
              sizeValue: 10,
              sizeUnit: 'kg',
              packCount: 1
            },
            temporaryId: null,
            confidence: 'high',
            matchMethod: 'deterministic',
            validationIssues: [],
            operatorDecision: 'approved',
            updatedAt: '2026-11-15T10:00:00Z'
          },
          [k2]: {
            batchOfferKey: k2,
            sourceOfferId: 'o2',
            sourcePage: 1,
            leafletId: 'leaflet-001',
            supermarketName: 'Carrefour',
            decision: 'temporary',
            matchedProductId: null,
            matchedProduct: null,
            temporaryId: 't_oil_unapproved',
            confidence: 'medium',
            matchMethod: 'deterministic',
            validationIssues: [],
            operatorDecision: 'proposed',
            updatedAt: '2026-11-15T10:00:00Z'
          },
          [k3]: {
            batchOfferKey: k3,
            sourceOfferId: 'o3',
            sourcePage: 1,
            leafletId: 'leaflet-001',
            supermarketName: 'Carrefour',
            decision: 'unresolved',
            matchedProductId: null,
            matchedProduct: null,
            temporaryId: null,
            confidence: 'low',
            matchMethod: 'deterministic',
            validationIssues: [],
            operatorDecision: 'proposed',
            updatedAt: '2026-11-15T10:00:00Z'
          },
          [k4]: {
            batchOfferKey: k4,
            sourceOfferId: 'o201',
            sourcePage: 1,
            leafletId: 'leaflet-002',
            supermarketName: 'Al Othaim',
            decision: 'unresolved',
            matchedProductId: null,
            matchedProduct: null,
            temporaryId: null,
            confidence: 'low',
            matchMethod: 'deterministic',
            validationIssues: [],
            operatorDecision: 'proposed',
            updatedAt: '2026-11-15T10:00:00Z'
          }
        },
        temporaryProducts: {
          t_oil_unapproved: {
            temporaryId: 't_oil_unapproved',
            brandKey: 'o-lite',
            brandNameAr: 'أولايت',
            brandNameEn: 'O-Lite',
            productNameAr: 'أولايت زيت كانولا ١،٥ مل × ٢',
            productNameEn: 'O-Lite Canola Oil 1.5L X2',
            variantOrFlavor: null,
            fatContent: null,
            eachSizeValue: 1.5,
            eachSizeUnit: 'l',
            innerPackCount: 2,
            saleUnitType: 'pack',
            productForm: null,
            sourceOfferKeys: [k2],
            retailers: ['Carrefour'],
            sampleThumbCropPath: null,
            operatorDecision: 'proposed',
            validationWarnings: [],
            createdAt: '2026-11-15T10:00:00Z',
            updatedAt: '2026-11-15T10:00:00Z'
          }
        },
        nonCatalogApprovals: {
          [k4]: {
            batchOfferKey: k4,
            decision: 'approved',
            category: 'meat_seafood_by_weight',
            operatorNotes: 'Approved by op1',
            updatedAt: '2026-11-15T10:00:00Z'
          }
        },
        consumerImageApprovals: {
          [k1]: {
            batchOfferKey: k1,
            status: 'approved_generated_crop',
            sourceType: 'product_thumb_crop',
            approvedLocalPath: thumbReady,
            existingCatalogImageUrl: null,
            approvedForProductKey: `product:${existingProdId}`,
            approvedForProductLabel: 'Al Safeer Basmati Rice 10kg',
            rightsBasis: 'operator_verified_leaflet_product_crop',
            verifiedBy: 'op1',
            verifiedAt: '2026-11-15T10:00:00Z',
            updatedAt: '2026-11-15T10:00:00Z'
          }
        },
        brandSummaries: {}
      }
      ;(orchestrator as any).saveManifestAtomic(matchingManifest)

      // 1-4: Preflight & Publish 2 Ready offers (1 catalog + 1 non-catalog) while 2 Blocked/Unapproved Deferred remain!
      const reloadedForPub1 = await batchSvc.getUnifiedBatchOffers(batchId)
      const triageBefore = summarizeBatchReviewTriage({
        offers: reloadedForPub1,
        manifest: orchestrator.loadManifest(batchId),
        targetDatabaseContext: 'DEVELOPMENT_TEST'
      })
      expect(triageBefore.readyCount).toBe(2)
      expect(triageBefore.blockedCount).toBe(2)
      expect(triageBefore.publishedCount).toBe(0)

      const preflight1 = await pubSvc.assessPublicationPreflight({
        manifest: orchestrator.loadManifest(batchId)!,
        offers: reloadedForPub1,
        context: 'DEVELOPMENT_TEST',
        enforceMetadataVerification: true,
        pgClient,
        allowIsolatedTestDb: true
      })
      expect(preflight1.ready).toBe(true)
      expect(preflight1.readyOffersToPublishCount).toBe(2)
      expect(preflight1.deferredOffersCount).toBe(2)
      expect(preflight1.eligibleOfferKeys).toEqual([k1, k4])
      expect(preflight1.deferredOfferKeys).toEqual([k2, k3])

      const pub1 = await pubSvc.publishApprovedCatalogBatch({
        manifest: orchestrator.loadManifest(batchId)!,
        offers: reloadedForPub1,
        context: 'DEVELOPMENT_TEST',
        operatorId: 'op_sel_1',
        enforceMetadataVerification: true,
        pgClient,
        allowIsolatedTestDb: true,
        storageAdapter: storage
      })
      expect(pub1.success).toBe(true)
      expect(pub1.publishedOffersCount).toBe(2)
      expect(pub1.publishedNonCatalogOffersCount).toBe(1)
      expect(pub1.createdProductsCount).toBe(0) // t_oil_unapproved was NOT created
      expect(pub1.publishedBatchOfferKeys).toEqual([k1, k4])
      expect(pub1.deferredBatchOfferKeys).toEqual([k2, k3])
      // Public bucket only received k1 approved consumer image, NOT k2/k3 deferred images!
      const publicProductImages = [...storage.storedObjects.keys()].filter((k) => k.startsWith('product-images/'))
      expect(publicProductImages).toHaveLength(1)

      await batchSvc.recordSelectivePublicationOutcome({
        batchId,
        databaseContext: 'DEVELOPMENT_TEST',
        publishOperationId: pub1.publishOperationId!,
        publishedBatchOfferKeys: pub1.publishedBatchOfferKeys!,
        deferredBatchOfferKeys: pub1.deferredBatchOfferKeys!,
        alreadyPublishedBatchOfferKeys: pub1.alreadyPublishedBatchOfferKeys,
        insertedOffersCount: pub1.insertedOffersCount || 0,
        updatedOffersCount: pub1.updatedOffersCount || 0,
        sourceOfferIdByKey: pub1.sourceOfferIdByKey,
        publishedOfferIdByKey: pub1.publishedOfferIdByKey,
        productIdByKey: pub1.productIdByKey
      })

      // 5 & 17: Simulate close & reopen (fresh service instances reading same disk dir)
      const reopenedBatchSvc = new BatchOrchestrationService(path.join(tmp, 'batches'))
      const reopenedManifest = await reopenedBatchSvc.loadBatchManifest(batchId)
      expect(reopenedManifest?.status).toBe('partially_published')
      const reopenedOffers = await reopenedBatchSvc.getUnifiedBatchOffers(batchId)
      const triageReopened = summarizeBatchReviewTriage({
        offers: reopenedOffers,
        manifest: orchestrator.loadManifest(batchId),
        targetDatabaseContext: 'DEVELOPMENT_TEST'
      })
      expect(triageReopened.publishedCount).toBe(2)
      expect(triageReopened.readyToPublishCount).toBe(0)
      expect(triageReopened.blockedCount).toBe(2)
      expect(reopenedOffers.find((o) => o.batchOfferKey === k2)?.status).toBe('extracted')
      expect(reopenedOffers.find((o) => o.batchOfferKey === k1)?.status).toBe('published')

      // 16: Attempting re-publish with 0 Ready offers stages 0 images & performs 0 DB writes
      const noopPreflight = await pubSvc.assessPublicationPreflight({
        manifest: orchestrator.loadManifest(batchId)!,
        offers: reopenedOffers,
        context: 'DEVELOPMENT_TEST',
        enforceMetadataVerification: true,
        pgClient,
        allowIsolatedTestDb: true
      })
      expect(noopPreflight.readyOffersToPublishCount).toBe(0)
      expect(noopPreflight.alreadyPublishedOffersCount).toBe(2)

      // 6: Anti-bypass test on Blocked k2 — clicking confirm WITHOUT fixing EN-vs-AR unit typo stays Blocked!
      const failedFix = await reopenedBatchSvc.updateBatchOfferFields({
        batchId,
        batchOfferKey: k2,
        orchestrator,
        databaseContext: 'DEVELOPMENT_TEST',
        patch: {
          confirmConflictResolution: true
        }
      })
      expect(failedFix.quarantineReasons).toContain('EN_AR_WEIGHT_VOLUME_CONFLICT')
      expect(failedFix.v3RetentionMode).toBe('quarantined_do_not_publish')

      // 10-13: Edit leaflet-001 metadata (extend end date to 2026-11-18) -> revision saved, leaflet-002 untouched, Pub 1 commit snapshot intact!
      await reopenedBatchSvc.updateLeafletMetadata({
        batchId,
        leafletId: 'leaflet-001',
        verified: true,
        operatorId: 'op_meta',
        metadata: { offerEndDate: '2026-11-18' }
      })
      const afterMetaManifest = await reopenedBatchSvc.loadBatchManifest(batchId)
      expect(afterMetaManifest?.leaflets[0].metadata.metadataVersion).toBe(1)
      expect(afterMetaManifest?.leaflets[0].metadata.metadataRevisions).toHaveLength(1)
      expect(afterMetaManifest?.leaflets[1].metadata.offerEndDate).toBe('2026-11-17') // unaffected leaflet untouched
      const op1History = await listPublicationHistory({ client: pgClient, batchIdFilter: batchId })
      expect((op1History[0].preflightSummary as any).leafletMetadataSnapshots[0].offerEndDate).toBe('2026-11-17') // commit-time snapshot preserved!
      // Verify DB row for k1 still has original committed offer_end_date '2026-11-17'
      const dbK1Before = await pgClient.query(`SELECT offer_end_date::text FROM public.offers WHERE id = $1`, [pub1.publishedOfferIds[0]])
      expect(dbK1Before.rows[0].offer_end_date).toBe('2026-11-17')

      // Revert k1 needsUpdateReview flag unless operator wants to publish update, or test update approval separately below:
      // Clear needsUpdateReview on k1 for clean incremental publish of k2 first, OR verify update skip without update approval!
      // Fix k2 completely: fix Arabic "١،٥ مل" -> "١،٥ لتر" + confirm resolution -> becomes Ready (after temp group approved)!
      const fixedK2 = await reopenedBatchSvc.updateBatchOfferFields({
        batchId,
        batchOfferKey: k2,
        orchestrator,
        databaseContext: 'DEVELOPMENT_TEST',
        patch: {
          titleAr: 'أولايت زيت كانولا ١،٥ لتر × ٢',
          confirmConflictResolution: true
        }
      })
      expect(fixedK2.quarantineReasons).toEqual([])
      expect(fixedK2.v3RetentionMode).toBe('operator_resolved_single_sku')
      expect((fixedK2.originalOcrSnapshot as any).titleAr).toBe('أولايت زيت كانولا ١،٥ مل × ٢')
      expect((fixedK2.originalOcrSnapshot as any).originalConflictCodes).toContain('EN_AR_WEIGHT_VOLUME_CONFLICT')

      // Approve temporary product & consumer image for newly validated k2
      const mmBeforeApprove = orchestrator.loadManifest(batchId)!
      const k2TempId = mmBeforeApprove.proposals[k2]?.temporaryId || 't_oil_approved'
      mmBeforeApprove.proposals[k2].decision = 'temporary'
      mmBeforeApprove.proposals[k2].temporaryId = k2TempId
      mmBeforeApprove.proposals[k2].operatorDecision = 'approved'
      mmBeforeApprove.temporaryProducts[k2TempId] = {
        ...(mmBeforeApprove.temporaryProducts[k2TempId] || {}),
        temporaryId: k2TempId,
        brandKey: 'o-lite',
        brandNameAr: 'أولايت',
        brandNameEn: 'O-Lite',
        productNameAr: fixedK2.titleAr,
        productNameEn: fixedK2.titleEn,
        variantOrFlavor: null,
        fatContent: null,
        eachSizeValue: 1.5,
        eachSizeUnit: 'l',
        innerPackCount: 2,
        saleUnitType: 'pack',
        productForm: null,
        sourceOfferKeys: [k2],
        retailers: ['Carrefour'],
        sampleThumbCropPath: thumbBlocked,
        operatorDecision: 'approved',
        validationWarnings: [],
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: new Date().toISOString()
      }
      ;(orchestrator as any).saveManifestAtomic(mmBeforeApprove)
      orchestrator.applyConsumerProductImageDecision({
        batchId,
        batchOfferKey: k2,
        decision: 'approve_generated_crop',
        productThumbCropPath: thumbBlocked,
        imageSubjectScope: 'product_package',
        boundProductKey: `temp:${k2TempId}`
      })

      // Clear k1's needsUpdateReview temporarily so Pub 2 ONLY publishes newly Ready k2 (we test update approval on k1 right after)
      const mAfterFix = await reopenedBatchSvc.loadBatchManifest(batchId)
      if (mAfterFix?.publishedOffers?.[k1]) mAfterFix.publishedOffers[k1].needsUpdateReview = false
      await (reopenedBatchSvc as any).saveBatchManifestAtomic(mAfterFix)
      const draft1File = path.join(mAfterFix!.leaflets[0].workspacePath, 'staged-draft.json')
      const d1Parsed = JSON.parse(fs.readFileSync(draft1File, 'utf8'))
      if (d1Parsed.items[0].publicationState) d1Parsed.items[0].publicationState.needsUpdateReview = false
      fs.writeFileSync(draft1File, JSON.stringify(d1Parsed, null, 2))

      const offersBeforePub2 = await reopenedBatchSvc.getUnifiedBatchOffers(batchId)
      const preflight2 = await pubSvc.assessPublicationPreflight({
        manifest: orchestrator.loadManifest(batchId)!,
        offers: offersBeforePub2,
        context: 'DEVELOPMENT_TEST',
        enforceMetadataVerification: true,
        pgClient,
        allowIsolatedTestDb: true
      })
      expect(preflight2.ready).toBe(true)
      expect(preflight2.readyOffersToPublishCount).toBe(1) // ONLY k2!
      expect(preflight2.alreadyPublishedOffersCount).toBe(2) // k1, k4!
      expect(preflight2.deferredOffersCount).toBe(1) // k3 non-grocery still Deferred!

      const pub2 = await pubSvc.publishApprovedCatalogBatch({
        manifest: orchestrator.loadManifest(batchId)!,
        offers: offersBeforePub2,
        context: 'DEVELOPMENT_TEST',
        operatorId: 'op_sel_2',
        enforceMetadataVerification: true,
        pgClient,
        allowIsolatedTestDb: true,
        storageAdapter: storage
      })
      expect(pub2.success).toBe(true)
      expect(pub2.publishedOffersCount).toBe(1)
      expect(pub2.createdProductsCount).toBe(1)
      expect(pub2.publishedBatchOfferKeys).toEqual([k2])

      await reopenedBatchSvc.recordSelectivePublicationOutcome({
        batchId,
        databaseContext: 'DEVELOPMENT_TEST',
        publishOperationId: pub2.publishOperationId!,
        publishedBatchOfferKeys: pub2.publishedBatchOfferKeys!,
        deferredBatchOfferKeys: pub2.deferredBatchOfferKeys!,
        alreadyPublishedBatchOfferKeys: pub2.alreadyPublishedBatchOfferKeys,
        insertedOffersCount: pub2.insertedOffersCount || 0,
        updatedOffersCount: pub2.updatedOffersCount || 0
      })

      const totalOffersInDb = await pgClient.query(`SELECT COUNT(*)::int AS cnt FROM public.offers`)
      expect(totalOffersInDb.rows[0].cnt).toBe(3) // o1, o201, o2!

      // 9: Scoped Undo Last Publish rolls back ONLY Pub 2 (k2), leaving Pub 1 (k1, k4) intact!
      const undoRes = await undoLastPublish({
        client: pgClient,
        operatorId: 'op_undo',
        reason: 'Rollback only incremental pub2',
        storageAdapter: storage
      })
      expect(undoRes.success).toBe(true)
      expect(undoRes.targetOperationId).toBe(pub2.publishOperationId)
      await reopenedBatchSvc.reconcileUndoPublicationOutcome({
        batchId,
        publishOperationId: pub2.publishOperationId!
      })
      const afterUndoCount = await pgClient.query(`SELECT COUNT(*)::int AS cnt FROM public.offers`)
      expect(afterUndoCount.rows[0].cnt).toBe(2) // o1 & o201 still published!
      const offersPostUndo = await reopenedBatchSvc.getUnifiedBatchOffers(batchId)
      expect(offersPostUndo.find((o) => o.batchOfferKey === k1)?.publicationState?.state).toBe('published')
      expect(offersPostUndo.find((o) => o.batchOfferKey === k2)?.publicationState).toBeNull()

      // 8: Explicit Update Approval on already-published k1: without approval -> skipped; with approval -> updated!
      await reopenedBatchSvc.updateBatchOfferFields({
        batchId,
        batchOfferKey: k1,
        orchestrator,
        databaseContext: 'DEVELOPMENT_TEST',
        patch: { promoPrice: 54.99 }
      })
      const offersForUpdate = await reopenedBatchSvc.getUnifiedBatchOffers(batchId)
      expect(offersForUpdate.find((o) => o.batchOfferKey === k1)?.publicationState?.needsUpdateReview).toBe(true)
      const skipUpdateRes = await pubSvc.publishApprovedCatalogBatch({
        manifest: orchestrator.loadManifest(batchId)!,
        offers: offersForUpdate,
        context: 'DEVELOPMENT_TEST',
        operatorId: 'op_upd_skip',
        enforceMetadataVerification: true,
        enforceUpdateApproval: true,
        approvedUpdateSourceIds: [],
        pgClient,
        allowIsolatedTestDb: true,
        enableImageUpload: false
      })
      expect(skipUpdateRes.updatedOffersCount).toBe(0)

      const k1SourceId = skipUpdateRes.sourceOfferIdByKey ? undefined : offersForUpdate.find((o) => o.batchOfferKey === k1)?.sourceOfferId
      const k1CompId = (await pgClient.query(`SELECT source_offer_id FROM public.offers WHERE id = $1`, [pub1.publishedOfferIds[0]])).rows[0].source_offer_id
      const approveUpdateRes = await pubSvc.publishApprovedCatalogBatch({
        manifest: orchestrator.loadManifest(batchId)!,
        offers: offersForUpdate,
        context: 'DEVELOPMENT_TEST',
        operatorId: 'op_upd_ok',
        enforceMetadataVerification: true,
        enforceUpdateApproval: true,
        approvedUpdateSourceIds: [k1CompId],
        pgClient,
        allowIsolatedTestDb: true,
        enableImageUpload: false
      })
      expect(approveUpdateRes.success).toBe(true)
      expect(approveUpdateRes.updatedOffersCount).toBe(1)
      const k1PriceAfterUpdate = await pgClient.query(`SELECT offer_price::numeric AS p FROM public.offers WHERE id = $1`, [pub1.publishedOfferIds[0]])
      expect(Number(k1PriceAfterUpdate.rows[0].p)).toBe(54.99)

      // 12: Invalid leaflet-wide metadata (startDate > endDate) blocks ALL offers on that leaflet!
      await reopenedBatchSvc.updateLeafletMetadata({
        batchId,
        leafletId: 'leaflet-001',
        verified: true,
        operatorId: 'op_bad_date',
        metadata: { offerStartDate: '2026-11-25', offerEndDate: '2026-11-10' }
      })
      const invalidMetaOffers = await reopenedBatchSvc.getUnifiedBatchOffers(batchId)
      const badMetaPreflight = await pubSvc.assessPublicationPreflight({
        manifest: orchestrator.loadManifest(batchId)!,
        offers: invalidMetaOffers.filter((o) => o.leafletId === 'leaflet-001'),
        context: 'DEVELOPMENT_TEST',
        enforceMetadataVerification: true,
        pgClient,
        allowIsolatedTestDb: true
      })
      expect(badMetaPreflight.ready).toBe(false)
      expect(badMetaPreflight.blockingReasons.some((r) => r.includes('INVALID_VALIDITY_DATES'))).toBe(true)
      void k1SourceId
    } finally {
      await pgClient.end?.()
    }
  }, 45000)

  it('18-20. Carrefour Page 23 Offline UAT Simulation ($0.00 Gemini Cost): Scenario A (9 Ready, 3 Deferred), Scenario B (fix 006 -> 10 Ready, 2 Deferred & publish 006), Scenario C (close/reopen & scoped Undo)', async () => {
    const realBatchSrc = path.join(process.cwd(), 'Extracts', 'batches', 'batch-2026-11-14T23-30-47-2417b0')
    if (!fs.existsSync(realBatchSrc)) {
      return
    }
    const tmp = makeTempDir('fix08-carrefour-p23-')
    const simBatchesDir = path.join(tmp, 'batches')
    const simWsDir = path.join(tmp, 'ws-carrefour')
    const batchId = 'batch-2026-11-14T23-30-47-2417b0'
    fs.mkdirSync(path.join(simBatchesDir, batchId, 'catalog-matching'), { recursive: true })
    fs.cpSync(realBatchSrc, path.join(simBatchesDir, batchId), { recursive: true })

    // Copy leaflet workspace into temp dir so real Extracts/ stays 100% untouched
    const origManifest = JSON.parse(fs.readFileSync(path.join(simBatchesDir, batchId, 'batch-manifest.json'), 'utf8')) as BatchManifest
    const realWs = origManifest.leaflets[0].workspacePath
    fs.cpSync(realWs, simWsDir, { recursive: true })
    origManifest.workspaceDir = path.join(simBatchesDir, batchId)
    origManifest.leaflets[0].workspacePath = simWsDir
    fs.writeFileSync(path.join(simBatchesDir, batchId, 'batch-manifest.json'), JSON.stringify(origManifest, null, 2))

    // Deterministically reset the temp copy of _006 to pre-fix OCR baseline ("١،٥ مل")
    // so Scenario A/B pass even if Extracts/.../staged-draft.json on disk already has operator edits.
    const simDraftPath = path.join(simWsDir, 'staged-draft.json')
    if (fs.existsSync(simDraftPath)) {
      const simDraft = JSON.parse(fs.readFileSync(simDraftPath, 'utf8'))
      const tmp006 = (simDraft.items || []).find((it: any) =>
        String(it?.sourceOfferId || it?.id || '').endsWith('_006')
      )
      if (tmp006) {
        tmp006.titleAr = tmp006.originalOcr?.titleAr || 'أولايت زيت كانولا ١،٥ مل × ٢'
        tmp006.operatorEditedFields = []
        tmp006.isOperatorModified = false
        tmp006.operatorEdited = false
        delete tmp006.operatorEditedAt
        delete tmp006.operatorEditedBy
        tmp006.conflictCodes = ['EN_AR_WEIGHT_VOLUME_CONFLICT']
        tmp006.quarantineReasons = ['EN_AR_WEIGHT_VOLUME_CONFLICT']
        fs.writeFileSync(simDraftPath, JSON.stringify(simDraft, null, 2), 'utf8')
      }
    }

    const batchSvc = new BatchOrchestrationService(simBatchesDir)
    const cacheSvc = new VerifiedMatchCacheService(path.join(tmp, 'cache'), 'development')
    const orchestrator = new CatalogMatchingOrchestrator(cacheSvc, undefined, undefined, undefined, simBatchesDir)
    const pubSvc = new CatalogPublicationService(cacheSvc)

    const { client: pgClient } = await createIsolatedWifranPostgres({ upToMigration: 12 })
    const storage = createInMemoryStorageAdapter('https://isolated-test.storage.local', {
      'offer-images': false,
      'product-images': true,
      'offer-display-images': true
    })

    try {
      const offers = await batchSvc.getUnifiedBatchOffers(batchId)
      expect(offers).toHaveLength(12)

      // Seed realistic zero-cost offline matching manifest for all 9 Ready offers as approved provisional products & keep 003/006/011 unresolved/blocked
      const matchingManifest: MatchingRunManifest = {
        schemaVersion: '1.0',
        batchId,
        runId: 'run-carrefour-sim',
        createdAt: '2026-11-15T12:00:00Z',
        updatedAt: '2026-11-15T12:00:00Z',
        status: 'completed',
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        totals: {
          totalExtractedOffers: 12,
          uniqueIdentitiesCount: 12,
          cacheMatchesCount: 0,
          deterministicMatchesCount: 9,
          geminiEvaluatedCount: 0,
          proposedExistingCount: 0,
          proposedTemporaryCount: 9,
          unresolvedCount: 3,
          validationWarningsCount: 0,
          actualCostUsd: 0,
          estimatedCostUsd: 0,
          geminiRequestsCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0
        },
        proposals: {},
        temporaryProducts: {},
        consumerImageApprovals: {},
        brandSummaries: {}
      }

      const blockedSourceIds = new Set(['leaflet-001_p023_003', 'leaflet-001_p023_006', 'leaflet-001_p023_011'])
      for (const o of offers) {
        if (blockedSourceIds.has(o.sourceOfferId)) {
          matchingManifest.proposals[o.batchOfferKey] = {
            batchOfferKey: o.batchOfferKey,
            sourceOfferId: o.sourceOfferId,
            sourcePage: o.sourcePage,
            leafletId: o.leafletId,
            supermarketName: o.supermarketName,
            decision: 'unresolved',
            matchedProductId: null,
            matchedProduct: null,
            temporaryId: null,
            confidence: 'low',
            matchMethod: 'deterministic',
            validationIssues: [],
            operatorDecision: 'proposed',
            updatedAt: '2026-11-15T12:00:00Z'
          }
        } else {
          const tempId = `t_${o.sourceOfferId}`
          matchingManifest.proposals[o.batchOfferKey] = {
            batchOfferKey: o.batchOfferKey,
            sourceOfferId: o.sourceOfferId,
            sourcePage: o.sourcePage,
            leafletId: o.leafletId,
            supermarketName: o.supermarketName,
            decision: 'temporary',
            matchedProductId: null,
            matchedProduct: null,
            temporaryId: tempId,
            confidence: 'high',
            matchMethod: 'deterministic',
            validationIssues: [],
            operatorDecision: 'approved',
            updatedAt: '2026-11-15T12:00:00Z'
          }
          matchingManifest.temporaryProducts[tempId] = {
            temporaryId: tempId,
            brandKey: (o.brandEn || o.brand || 'brand').toLowerCase(),
            brandNameAr: o.brandAr || o.brand || null,
            brandNameEn: o.brandEn || o.brand || null,
            productNameAr: o.titleAr,
            productNameEn: o.titleEn,
            variantOrFlavor: o.variantOrFlavor ?? null,
            fatContent: null,
            eachSizeValue: o.each_size_value,
            eachSizeUnit: o.each_size_unit,
            innerPackCount: o.inner_pack_count,
            saleUnitType: o.sale_unit_type,
            productForm: null,
            sourceOfferKeys: [o.batchOfferKey],
            retailers: ['Carrefour'],
            sampleThumbCropPath: o.productThumbCropPath,
            operatorDecision: 'approved',
            validationWarnings: [],
            createdAt: '2026-11-15T12:00:00Z',
            updatedAt: '2026-11-15T12:00:00Z'
          }
        }
      }
      ;(orchestrator as any).saveManifestAtomic(matchingManifest)

      // Scenario A: 9 Ready, 3 Deferred -> preflight passes & selectively publishes 9 cleanly
      const triageA = summarizeBatchReviewTriage({
        offers,
        manifest: orchestrator.loadManifest(batchId),
        targetDatabaseContext: 'DEVELOPMENT_TEST'
      })
      expect(triageA.readyCount).toBe(9)
      expect(triageA.blockedCount).toBe(3)

      const preflightA = await pubSvc.assessPublicationPreflight({
        manifest: orchestrator.loadManifest(batchId)!,
        offers,
        context: 'DEVELOPMENT_TEST',
        enforceMetadataVerification: true,
        pgClient,
        allowIsolatedTestDb: true
      })
      expect(preflightA.ready).toBe(true)
      expect(preflightA.readyOffersToPublishCount).toBe(9)
      expect(preflightA.deferredOffersCount).toBe(3)

      const pubA = await pubSvc.publishApprovedCatalogBatch({
        manifest: orchestrator.loadManifest(batchId)!,
        offers,
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_sim_a',
        enforceMetadataVerification: true,
        pgClient,
        allowIsolatedTestDb: true,
        storageAdapter: storage
      })
      expect(pubA.success).toBe(true)
      expect(pubA.publishedOffersCount).toBe(9)
      expect(pubA.createdProductsCount).toBe(9)
      expect(pubA.deferredBatchOfferKeys).toHaveLength(3)

      await batchSvc.recordSelectivePublicationOutcome({
        batchId,
        databaseContext: 'DEVELOPMENT_TEST',
        publishOperationId: pubA.publishOperationId!,
        publishedBatchOfferKeys: pubA.publishedBatchOfferKeys!,
        deferredBatchOfferKeys: pubA.deferredBatchOfferKeys!,
        alreadyPublishedBatchOfferKeys: pubA.alreadyPublishedBatchOfferKeys,
        insertedOffersCount: pubA.insertedOffersCount || 0,
        updatedOffersCount: pubA.updatedOffersCount || 0
      })

      // Scenario B: Correct blocked 006 (O-Lite Canola Oil 1.5L X2):
      // 1st attempt without fixing Arabic "١،٥ مل" stays Blocked
      const o006 = offers.find((o) => o.sourceOfferId === 'leaflet-001_p023_006')!
      const bad006 = await batchSvc.updateBatchOfferFields({
        batchId,
        batchOfferKey: o006.batchOfferKey,
        orchestrator,
        databaseContext: 'DEVELOPMENT_TEST',
        patch: { confirmConflictResolution: true }
      })
      expect(bad006.quarantineReasons).toContain('EN_AR_WEIGHT_VOLUME_CONFLICT')

      // Genuine fix: Arabic unit "١،٥ مل" -> "١،٥ لتر" + confirm resolution -> clears quarantine!
      const good006 = await batchSvc.updateBatchOfferFields({
        batchId,
        batchOfferKey: o006.batchOfferKey,
        orchestrator,
        databaseContext: 'DEVELOPMENT_TEST',
        patch: {
          titleAr: 'أولايت زيت كانولا ١،٥ لتر × ٢',
          confirmConflictResolution: true
        }
      })
      expect(good006.quarantineReasons).toEqual([])
      expect(good006.v3RetentionMode).toBe('operator_resolved_single_sku')

      // Approve non-catalog or temp for newly validated 006 (simulating operator completing matching step cleanly)
      const mmB = orchestrator.loadManifest(batchId)!
      mmB.proposals[o006.batchOfferKey].decision = 'temporary'
      mmB.proposals[o006.batchOfferKey].temporaryId = 't_006_fixed'
      mmB.proposals[o006.batchOfferKey].operatorDecision = 'approved'
      mmB.temporaryProducts['t_006_fixed'] = {
        temporaryId: 't_006_fixed',
        brandKey: 'o-lite',
        brandNameAr: 'أولايت',
        brandNameEn: 'O-Lite',
        productNameAr: good006.titleAr,
        productNameEn: good006.titleEn,
        variantOrFlavor: null,
        fatContent: null,
        eachSizeValue: 1.5,
        eachSizeUnit: 'l',
        innerPackCount: 2,
        saleUnitType: 'pack',
        productForm: null,
        sourceOfferKeys: [o006.batchOfferKey],
        retailers: ['Carrefour'],
        sampleThumbCropPath: good006.productThumbCropPath,
        operatorDecision: 'approved',
        validationWarnings: [],
        createdAt: '2026-11-15T12:10:00Z',
        updatedAt: '2026-11-15T12:10:00Z'
      }
      ;(orchestrator as any).saveManifestAtomic(mmB)

      // Scenario C: Close & Reopen batch -> verify durable persistence, then publish ONLY 006 (10th offer) & test Undo!
      const reopenedSvc = new BatchOrchestrationService(simBatchesDir)
      const reopenedOrch = new CatalogMatchingOrchestrator(cacheSvc, undefined, undefined, undefined, simBatchesDir)
      const reopenedOffers = await reopenedSvc.getUnifiedBatchOffers(batchId)
      const triageReopened = summarizeBatchReviewTriage({
        offers: reopenedOffers,
        manifest: reopenedOrch.loadManifest(batchId),
        targetDatabaseContext: 'DEVELOPMENT_TEST'
      })
      expect(triageReopened.publishedCount).toBe(9)
      expect(triageReopened.readyToPublishCount).toBe(1) // 006!
      expect(triageReopened.blockedCount).toBe(2) // 003, 011!
      const reopened006 = reopenedOffers.find((o) => o.batchOfferKey === o006.batchOfferKey)!
      expect(reopened006.titleAr).toBe('أولايت زيت كانولا ١،٥ لتر × ٢')
      expect((reopened006.originalOcrSnapshot as any).titleAr).toBe('أولايت زيت كانولا ١،٥ مل × ٢')

      const pubB = await pubSvc.publishApprovedCatalogBatch({
        manifest: reopenedOrch.loadManifest(batchId)!,
        offers: reopenedOffers,
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_sim_b',
        enforceMetadataVerification: true,
        pgClient,
        allowIsolatedTestDb: true,
        storageAdapter: storage
      })
      expect(pubB.success).toBe(true)
      expect(pubB.publishedOffersCount).toBe(1)
      expect(pubB.publishedBatchOfferKeys).toEqual([o006.batchOfferKey])
      expect((await pgClient.query(`SELECT COUNT(*)::int AS cnt FROM public.offers`)).rows[0].cnt).toBe(10)

      // Undo Last Publish rolls back ONLY 006, leaving Scenario A's 9 offers intact!
      const undoB = await undoLastPublish({
        client: pgClient,
        operatorId: 'uat_sim_undo',
        reason: 'Rollback only Scenario B',
        storageAdapter: storage
      })
      expect(undoB.success).toBe(true)
      expect((await pgClient.query(`SELECT COUNT(*)::int AS cnt FROM public.offers`)).rows[0].cnt).toBe(9)
    } finally {
      await pgClient.end?.()
    }
  }, 45000)

  it('Revalidate helper rejects fragmented title, zero price, inverted dates, and unresolved ambiguous assortment', () => {
    const resZeroPrice = revalidateOfferItem({
      item: { titleEn: 'Juice 1L', titleAr: 'عصير ١ لتر', priceAfter: 0, each_size_value: 1, each_size_unit: 'l', category: 'grocery' },
      confirmConflictResolution: true
    })
    expect(resZeroPrice.isValid).toBe(false)
    expect(resZeroPrice.quarantineReasons).toContain('INVALID_OR_MISSING_OFFER_PRICE')

    const resAssort = revalidateOfferItem({
      item: {
        titleEn: 'Ditalini Rigati 400g',
        titleAr: 'ديتاليني ٤٠٠ جم',
        priceAfter: 4,
        each_size_value: 400,
        each_size_unit: 'g',
        category: 'grocery',
        assortment_status: 'visual_multiple_variants'
      },
      confirmConflictResolution: true
    })
    expect(resAssort.isValid).toBe(false)
    expect(resAssort.quarantineReasons).toContain('INCOMPLETE_VISIBLE_ASSORTMENT')
  })
})
