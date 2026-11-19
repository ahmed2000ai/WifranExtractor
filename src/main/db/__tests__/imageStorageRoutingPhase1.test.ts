import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createIsolatedWifranPostgres } from './isolatedPostgresHarness008'
import {
  CatalogPublicationService,
  PRIVATE_EVIDENCE_BUCKET,
  PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET,
  PUBLIC_PRODUCT_IMAGES_BUCKET
} from '../catalogPublicationService'
import { VerifiedMatchCacheService } from '../verifiedMatchCacheService'
import { undoLastPublish } from '../publicationJournalAndUndoService'
import {
  createInMemoryStorageAdapter,
  stageContentAddressedUpload
} from '../../storage/stagedStorageLifecycleService'
import { sanitizePublicConsumerImageUrl } from '../../../shared/utils/nonCatalogPublicationPolicy'
import type { MatchingRunManifest } from '../../../shared/types/catalogMatching'
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
      // ignore Windows cleanup timing
    }
  }
})

async function makeWebpFile(filePath: string, rgb: { r: number; g: number; b: number }): Promise<string> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const buf = await sharp({
    create: { width: 48, height: 48, channels: 3, background: rgb }
  })
    .webp()
    .toBuffer()
  fs.writeFileSync(filePath, buf)
  return filePath
}

const UUID_OTHAIM = 'c2cc16c2-0002-4444-b000-c00000000002'
const UUID_BINDAWOOD = 'c2cc16c2-0007-4444-b000-c00000000007'
const UUID_JEDDAH = 'a6f7b140-0002-4444-a000-000000000002'
const DEV_PUBLIC_BASE = 'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public'

function buildOffer(overrides: Partial<UnifiedBatchOffer>): UnifiedBatchOffer {
  return {
    batchOfferKey: 'b-p1:l1:1:o01',
    batchId: 'b-p1',
    leafletId: 'l1',
    sourceDocumentId: 'doc_phase1_test_0001',
    sourceFileName: 'othaim.pdf',
    sourcePdfPath: '/tmp/othaim.pdf',
    sourceFileFingerprint: 'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999',
    sourcePage: 1,
    sourceOfferId: 'doc_phase1_test_0001:p001:i001:s01',
    sourceOfferAnchor: 'anc_001',
    supermarketId: UUID_OTHAIM,
    supermarketName: 'Al Othaim Markets',
    locationScope: 'city',
    locationLabel: 'Jeddah',
    cityId: UUID_JEDDAH,
    regionId: null,
    offerStartDate: '2026-11-11',
    offerEndDate: '2026-11-17',
    currency: 'SAR',
    metadataVerified: true,
    metadataStatus: 'operator_verified',
    titleAr: 'جبن بوك قابل للدهن 500 جم',
    titleEn: 'Puck Spread Cheese 500g',
    brand: 'Puck',
    brandAr: 'بوك',
    brandEn: 'Puck',
    variantOrFlavor: 'Creamy',
    promoPrice: 16.95,
    originalPrice: 22.95,
    discountPercent: 26,
    promoNotes: null,
    sizeOrWeight: '500g',
    each_size_value: 500,
    each_size_unit: 'g',
    inner_pack_count: 1,
    sale_unit_type: 'piece',
    total_content_value: 500,
    total_content_unit: 'g',
    free_units_text: null,
    customer_limit: null,
    productThumbCropPath: null,
    offerCardCropPath: null,
    consumerProductImagePath: null,
    consumerDisplayImagePath: null,
    imageSubjectScope: 'product_package',
    status: 'ready_for_publication',
    confidence: 'high',
    category: 'dairy',
    ...overrides
  }
}

describe('FIX-08 Phase 1 — Publication Image Storage Routing & Fail-Closed Guards', () => {
  it('separates private evidence crops (`offer-images`) from approved consumer assets (`product-images` & `offer-display-images`) and preserves shared objects on Undo', async () => {
    const tmp = makeTempDir('fix08-phase1-sep-')
    const pg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      const evidenceCardPath = await makeWebpFile(path.join(tmp, 'offer_card_crop.webp'), { r: 20, g: 30, b: 40 })
      const evidenceThumbPath = await makeWebpFile(path.join(tmp, 'product_thumb_crop.webp'), { r: 50, g: 60, b: 70 })
      const sharedConsumerProdPath = await makeWebpFile(path.join(tmp, 'consumer_prod_shared.webp'), { r: 90, g: 120, b: 150 })
      const exclusiveConsumerDisplayPath = await makeWebpFile(path.join(tmp, 'consumer_display_exclusive.webp'), { r: 180, g: 210, b: 240 })

      const storage = createInMemoryStorageAdapter(DEV_PUBLIC_BASE)

      // Pre-stage shared consumer product image in public `product-images` BEFORE publication
      const preStagedProd = await stageContentAddressedUpload({
        adapter: storage,
        bucket: PUBLIC_PRODUCT_IMAGES_BUCKET,
        localFilePath: sharedConsumerProdPath,
        scopePrefix: 'products',
        extension: 'webp'
      })
      expect(preStagedProd).not.toBeNull()

      // Offer 1: Linked to new temporary product with BOTH private evidence crops AND consumerProductImagePath
      const offerCatalog = buildOffer({
        batchOfferKey: 'b-p1:l1:1:o01',
        sourceOfferId: 'doc_phase1_test_0001:p001:i001:s01',
        offerCardCropPath: evidenceCardPath,
        productThumbCropPath: evidenceThumbPath,
        consumerProductImagePath: sharedConsumerProdPath,
        consumerDisplayImagePath: null
      })

      // Offer 2: Approved non-catalog offer with private evidence crop + exclusive consumerDisplayImagePath
      const offerDisplayOnly = buildOffer({
        batchOfferKey: 'b-p1:l2:2:o02',
        leafletId: 'l2',
        supermarketId: UUID_BINDAWOOD,
        supermarketName: 'BinDawood',
        sourceOfferId: 'doc_phase1_test_0002:p002:i001:s01',
        titleEn: 'Assorted Fresh Dates 1kg',
        titleAr: 'تمر طازج مشكل 1 كجم',
        brand: null,
        brandAr: null,
        brandEn: null,
        sizeOrWeight: '1kg',
        each_size_value: 1,
        each_size_unit: 'kg',
        total_content_value: 1,
        total_content_unit: 'kg',
        sale_unit_type: 'kg',
        imageSubjectScope: 'representative_assortment',
        offerCardCropPath: evidenceCardPath,
        consumerDisplayImagePath: exclusiveConsumerDisplayPath,
        approvedConsumerImageSourceKind: 'generic_library' as any
      })

      const manifest: MatchingRunManifest = {
        schemaVersion: '1.0',
        runId: 'run_phase1_routing',
        batchId: 'b-p1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        totals: {} as any,
        requests: {
          req1: {
            requestKey: 'req1',
            status: 'completed',
            executionStatus: 'completed',
            validated: true
          } as any
        },
        proposals: {
          'b-p1:l1:1:o01': {
            batchOfferKey: 'b-p1:l1:1:o01',
            decision: 'temporary',
            temporaryId: 'TEMP_01',
            matchedDatabaseContext: 'DEVELOPMENT_TEST',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any,
          'b-p1:l2:2:o02': {
            batchOfferKey: 'b-p1:l2:2:o02',
            decision: 'unresolved',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        },
        temporaryProducts: {
          TEMP_01: {
            temporaryId: 'TEMP_01',
            brandKey: 'puck',
            brandNameEn: 'Puck',
            brandNameAr: 'بوك',
            productNameEn: 'Puck Spread Cheese Creamy 500g',
            productNameAr: 'جبن بوك قابل للدهن كريمي 500 جم',
            variantOrFlavor: 'Creamy',
            eachSizeValue: 500,
            eachSizeUnit: 'g',
            innerPackCount: 1,
            saleUnitType: 'piece',
            productForm: 'jar',
            sourceOfferKeys: ['b-p1:l1:1:o01'],
            retailers: ['othaim'],
            operatorDecision: 'approved'
          } as any
        },
        nonCatalogApprovals: {
          'b-p1:l2:2:o02': {
            batchOfferKey: 'b-p1:l2:2:o02',
            decision: 'approved',
            category: 'loose_produce',
            updatedAt: new Date().toISOString()
          }
        },
        brandSummaries: {}
      }

      const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'development'))
      const res = await pubService.publishApprovedCatalogBatch({
        manifest,
        offers: [offerCatalog, offerDisplayOnly],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true
      })

      expect(res.success).toBe(true)
      expect(res.storageSummary?.buckets).toEqual(
        expect.arrayContaining([
          PRIVATE_EVIDENCE_BUCKET,
          PUBLIC_PRODUCT_IMAGES_BUCKET,
          PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET
        ])
      )

      // 1) Verify publication_storage_operations recorded exact buckets, paths, hashes, and ownership modes
      const storageOps = await pg.client.query<{
        bucket: string
        object_path: string
        content_sha256: string
        ownership_mode: string
        storage_state: string
      }>(
        `SELECT bucket, object_path, content_sha256, ownership_mode, storage_state
         FROM public.publication_storage_operations
         WHERE publish_operation_id = $1
         ORDER BY bucket, object_path`,
        [res.publishOperationId]
      )
      expect(storageOps.rows.length).toBe(4) // 2 evidence crops + 1 reused product image + 1 exclusive display image
      const evidenceOps = storageOps.rows.filter((r) => r.bucket === PRIVATE_EVIDENCE_BUCKET)
      const productImgOps = storageOps.rows.filter((r) => r.bucket === PUBLIC_PRODUCT_IMAGES_BUCKET)
      const offerDisplayOps = storageOps.rows.filter((r) => r.bucket === PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET)

      expect(evidenceOps).toHaveLength(2)
      expect(evidenceOps.every((r) => r.ownership_mode === 'exclusive_created' && r.content_sha256.length === 64)).toBe(true)
      expect(productImgOps).toHaveLength(1)
      expect(productImgOps[0].ownership_mode).toBe('reused_existing')
      expect(offerDisplayOps).toHaveLength(1)
      expect(offerDisplayOps[0].ownership_mode).toBe('exclusive_created')

      // 2) Verify public.product_images & public.offer_display_images ONLY reference public buckets, NEVER offer-images
      const piRows = await pg.client.query<{ storage_bucket: string; public_url: string }>(
        `SELECT storage_bucket, public_url FROM public.product_images`
      )
      expect(piRows.rows).toHaveLength(1)
      expect(piRows.rows[0].storage_bucket).toBe(PUBLIC_PRODUCT_IMAGES_BUCKET)
      expect(sanitizePublicConsumerImageUrl(piRows.rows[0].public_url, 'DEVELOPMENT_TEST')).toBe(piRows.rows[0].public_url)

      const odiRows = await pg.client.query<{ storage_bucket: string; public_url: string }>(
        `SELECT storage_bucket, public_url FROM public.offer_display_images`
      )
      expect(odiRows.rows).toHaveLength(1)
      expect(odiRows.rows[0].storage_bucket).toBe(PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET)
      expect(sanitizePublicConsumerImageUrl(odiRows.rows[0].public_url, 'DEVELOPMENT_TEST')).toBe(odiRows.rows[0].public_url)

      // 3) Verify public.offers & v_consumer_offers NEVER contain `/offer-images/` URLs
      const offerRows = await pg.client.query<{
        source_offer_id: string
        image_url: string | null
        thumbnail_url: string | null
      }>(`SELECT source_offer_id, image_url, thumbnail_url FROM public.offers ORDER BY source_offer_id`)
      for (const r of offerRows.rows) {
        if (r.image_url) expect(r.image_url).not.toContain(`/${PRIVATE_EVIDENCE_BUCKET}/`)
        if (r.thumbnail_url) expect(r.thumbnail_url).not.toContain(`/${PRIVATE_EVIDENCE_BUCKET}/`)
      }

      const viewRows = await pg.client.query<{
        source_offer_id: string
        image_url: string | null
        display_image_url: string | null
      }>(`SELECT source_offer_id, image_url, display_image_url FROM public.v_consumer_offers ORDER BY source_offer_id`)
      const viewBySrc = Object.fromEntries(viewRows.rows.map((r) => [r.source_offer_id, r]))
      expect(viewBySrc['doc_phase1_test_0001:p001:i001:s01']?.image_url).toContain(`/${PUBLIC_PRODUCT_IMAGES_BUCKET}/`)
      expect(viewBySrc['doc_phase1_test_0002:p002:i001:s01']?.display_image_url).toContain(`/${PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET}/`)
      expect(viewBySrc['doc_phase1_test_0001:p001:i001:s01']?.image_url).not.toContain(PRIVATE_EVIDENCE_BUCKET)
      expect(viewBySrc['doc_phase1_test_0002:p002:i001:s01']?.display_image_url).not.toContain(PRIVATE_EVIDENCE_BUCKET)

      // 4) Undo Last Publish: deletes the 3 exclusive_created objects (2 in offer-images + 1 in offer-display-images)
      //    and PRESERVES the 1 reused_existing object in product-images!
      const undoRes = await undoLastPublish({
        client: pg.client,
        operatorId: 'uat_op',
        reason: 'Phase 1 storage routing & Undo check',
        storageAdapter: storage
      })
      expect(undoRes.success).toBe(true)
      expect(undoRes.status).toBe('undone')
      expect(undoRes.storageCleanup.deletedCount).toBe(3)
      expect(undoRes.storageCleanup.skippedReferencedCount).toBe(0)
      expect(storage.storedObjects.size).toBe(1)
      expect(
        await storage.objectExists(PUBLIC_PRODUCT_IMAGES_BUCKET, preStagedProd!.objectPath)
      ).toBe(true)
    } finally {
      await pg.client.end?.()
    }
  }, 60000)

  it('keeps v_consumer_offers display/image URLs NULL when only private evidence crops (`offerCardCropPath`) exist', async () => {
    const tmp = makeTempDir('fix08-phase1-priv-')
    const pg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      const evidenceCardPath = await makeWebpFile(path.join(tmp, 'offer_card_crop.webp'), { r: 10, g: 10, b: 10 })
      const storage = createInMemoryStorageAdapter(DEV_PUBLIC_BASE)
      const offer = buildOffer({
        offerCardCropPath: evidenceCardPath,
        consumerProductImagePath: null,
        consumerDisplayImagePath: null
      })

      const manifest: MatchingRunManifest = {
        schemaVersion: '1.0',
        runId: 'run_priv_only',
        batchId: 'b-p1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        totals: {} as any,
        requests: {
          req1: { requestKey: 'req1', status: 'completed', executionStatus: 'completed', validated: true } as any
        },
        proposals: {
          'b-p1:l1:1:o01': {
            batchOfferKey: 'b-p1:l1:1:o01',
            decision: 'temporary',
            temporaryId: 'TEMP_PRIV',
            matchedDatabaseContext: 'DEVELOPMENT_TEST',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        },
        temporaryProducts: {
          TEMP_PRIV: {
            temporaryId: 'TEMP_PRIV',
            brandKey: 'puck',
            brandNameEn: 'Puck',
            brandNameAr: 'بوك',
            productNameEn: 'Puck Spread Cheese Creamy 500g',
            productNameAr: 'جبن بوك قابل للدهن كريمي 500 جم',
            eachSizeValue: 500,
            eachSizeUnit: 'g',
            innerPackCount: 1,
            saleUnitType: 'piece',
            sourceOfferKeys: ['b-p1:l1:1:o01'],
            retailers: ['othaim'],
            operatorDecision: 'approved'
          } as any
        },
        nonCatalogApprovals: {},
        brandSummaries: {}
      }

      const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'development'))
      const res = await pubService.publishApprovedCatalogBatch({
        manifest,
        offers: [offer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true
      })

      expect(res.success).toBe(true)
      expect(res.storageSummary?.uploaded).toBe(1)
      expect(res.storageSummary?.buckets).toEqual([PRIVATE_EVIDENCE_BUCKET])

      const odiCount = await pg.client.query(`SELECT COUNT(*)::int AS cnt FROM public.offer_display_images`)
      const piCount = await pg.client.query(`SELECT COUNT(*)::int AS cnt FROM public.product_images`)
      expect(odiCount.rows[0].cnt).toBe(0)
      expect(piCount.rows[0].cnt).toBe(0)

      const viewRow = await pg.client.query<{ image_url: string | null; display_image_url: string | null }>(
        `SELECT image_url, display_image_url FROM public.v_consumer_offers`
      )
      expect(viewRow.rows[0].image_url).toBeNull()
      expect(viewRow.rows[0].display_image_url).toBeNull()
    } finally {
      await pg.client.end?.()
    }
  }, 45000)

  it('fails closed (zero commits, cleans up staged objects) if consumer images target `offer-images` or a non-public bucket, or if `offer-images` is misconfigured public', async () => {
    const tmp = makeTempDir('fix08-phase1-fail-')
    const pg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      const evidenceCardPath = await makeWebpFile(path.join(tmp, 'card.webp'), { r: 15, g: 25, b: 35 })
      const consumerDisplayPath = await makeWebpFile(path.join(tmp, 'disp.webp'), { r: 220, g: 230, b: 240 })

      const manifest: MatchingRunManifest = {
        schemaVersion: '1.0',
        runId: 'run_fail_closed',
        batchId: 'b-p1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        totals: {} as any,
        requests: {
          req1: { requestKey: 'req1', status: 'completed', executionStatus: 'completed', validated: true } as any
        },
        proposals: {
          'b-p1:l1:1:o01': {
            batchOfferKey: 'b-p1:l1:1:o01',
            decision: 'temporary',
            temporaryId: 'TEMP_FAIL',
            matchedDatabaseContext: 'DEVELOPMENT_TEST',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        },
        temporaryProducts: {
          TEMP_FAIL: {
            temporaryId: 'TEMP_FAIL',
            brandKey: 'puck',
            brandNameEn: 'Puck',
            brandNameAr: 'بوك',
            productNameEn: 'Puck Spread Cheese Creamy 500g',
            productNameAr: 'جبن بوك قابل للدهن كريمي 500 جم',
            eachSizeValue: 500,
            eachSizeUnit: 'g',
            innerPackCount: 1,
            saleUnitType: 'piece',
            sourceOfferKeys: ['b-p1:l1:1:o01'],
            retailers: ['othaim'],
            operatorDecision: 'approved'
          } as any
        },
        nonCatalogApprovals: {},
        brandSummaries: {}
      }

      const offer = buildOffer({
        offerCardCropPath: evidenceCardPath,
        consumerDisplayImagePath: consumerDisplayPath,
        approvedConsumerImageSourceKind: 'generic_library' as any
      })
      const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'development'))

      // Case 1: Consumer bucket overridden to private `offer-images` -> blocked cleanly!
      const storageOk = createInMemoryStorageAdapter(DEV_PUBLIC_BASE)
      const wrongBucketRes = await pubService.publishApprovedCatalogBatch({
        manifest,
        offers: [offer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        offerDisplayImagesBucket: PRIVATE_EVIDENCE_BUCKET,
        pgClient: pg.client,
        storageAdapter: storageOk,
        allowIsolatedTestDb: true
      })
      expect(wrongBucketRes.success).toBe(false)
      expect(wrongBucketRes.errors?.some((e) => e.includes('CONSUMER_IMAGE_WRONG_BUCKET'))).toBe(true)
      expect(storageOk.storedObjects.size).toBe(0)

      // Case 2: Public bucket `offer-display-images` is misconfigured as private (public=false) -> throws AFTER evidence upload, AND cleans up the earlier staged evidence object!
      const storagePrivateConsumer = createInMemoryStorageAdapter(DEV_PUBLIC_BASE, {
        'offer-display-images': false
      })
      await expect(
        pubService.publishApprovedCatalogBatch({
          manifest,
          offers: [offer],
          context: 'DEVELOPMENT_TEST',
          operatorId: 'uat_op',
          pgClient: pg.client,
          storageAdapter: storagePrivateConsumer,
          allowIsolatedTestDb: true
        })
      ).rejects.toThrow(/CONSUMER_IMAGE_BUCKET_NOT_PUBLIC/)
      expect(storagePrivateConsumer.storedObjects.size).toBe(0)

      // Case 3: Private bucket `offer-images` accidentally set to public=true -> fails closed!
      const storagePublicEvidence = createInMemoryStorageAdapter(DEV_PUBLIC_BASE, {
        'offer-images': true
      })
      await expect(
        pubService.publishApprovedCatalogBatch({
          manifest,
          offers: [offer],
          context: 'DEVELOPMENT_TEST',
          operatorId: 'uat_op',
          pgClient: pg.client,
          storageAdapter: storagePublicEvidence,
          allowIsolatedTestDb: true
        })
      ).rejects.toThrow(/EVIDENCE_IMAGE_BUCKET_MUST_BE_PRIVATE/)
      expect(storagePublicEvidence.storedObjects.size).toBe(0)

      // Case 4: Target database lacks Migration 012 check constraint -> fails closed with SCHEMA_MIGRATION_REQUIRED
      // and does NOT upload or associate the image!
      const storagePre012 = createInMemoryStorageAdapter(DEV_PUBLIC_BASE)
      const offerLeafletCrop = buildOffer({
        batchOfferKey: 'b-p1:l1:1:o01',
        offerCardCropPath: evidenceCardPath,
        consumerDisplayImagePath: consumerDisplayPath,
        approvedConsumerImageSourceKind: 'promotional_leaflet_crop' as any
      })
      const preflightPre012 = await pubService.assessPublicationPreflight({
        manifest,
        offers: [offerLeafletCrop],
        context: 'DEVELOPMENT_TEST',
        pgClient: pg.client,
        allowIsolatedTestDb: true
      })
      expect(preflightPre012.ready).toBe(false)
      expect(preflightPre012.blockingReasons.some((r) => r.includes('SCHEMA_MIGRATION_REQUIRED'))).toBe(true)

      const pubLeafletRes = await pubService.publishApprovedCatalogBatch({
        manifest,
        offers: [offerLeafletCrop],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        pgClient: pg.client,
        storageAdapter: storagePre012,
        allowIsolatedTestDb: true
      })
      expect(pubLeafletRes.success).toBe(false)
      expect(pubLeafletRes.errors?.some((e) => e.includes('SCHEMA_MIGRATION_REQUIRED'))).toBe(true)
      expect(storagePre012.storedObjects.size).toBe(0)

      // Zero DB rows mutated
      const offersCount = await pg.client.query(`SELECT COUNT(*)::int AS cnt FROM public.offers`)
      expect(offersCount.rows[0].cnt).toBe(0)
    } finally {
      await pg.client.end?.()
    }
  }, 45000)
})
