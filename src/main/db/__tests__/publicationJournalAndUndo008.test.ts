import fs from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createIsolatedWifranPostgres } from './isolatedPostgresHarness008'
import { assessSchemaCompatibility } from '../schemaCompatibilityService'
import { CatalogPublicationService } from '../catalogPublicationService'
import { VerifiedMatchCacheService } from '../verifiedMatchCacheService'
import {
  getPublicationOperationDetails,
  listPublicationHistory,
  previewUndoLastPublish,
  retryUndoStorageCleanup,
  undoLastPublish
} from '../publicationJournalAndUndoService'
import {
  createInMemoryStorageAdapter,
  stageContentAddressedUpload
} from '../../storage/stagedStorageLifecycleService'
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

const UUID_PANDA = 'c2cc16c2-0001-4444-b000-c00000000001'
const UUID_OTHAIM = 'c2cc16c2-0002-4444-b000-c00000000002'
const UUID_BINDAWOOD = 'c2cc16c2-0007-4444-b000-c00000000007'
const UUID_JEDDAH = 'a6f7b140-0002-4444-a000-000000000002'

function buildOffer(overrides: Partial<UnifiedBatchOffer>): UnifiedBatchOffer {
  return {
    batchOfferKey: 'batch-1:leaflet-001:1:o01',
    batchId: 'batch-1',
    leafletId: 'leaflet-001',
    sourceDocumentId: 'doc_1111222233334444',
    sourceFileName: 'othaim.pdf',
    sourcePdfPath: '/tmp/othaim.pdf',
    sourceFileFingerprint: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    sourcePage: 1,
    sourceOfferId: 'doc_1111222233334444:p001:i001:s01',
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
    titleAr: 'حليب المراعي طويل الأجل',
    titleEn: 'Almarai UHT Milk 1L',
    brand: 'Almarai',
    brandAr: 'المراعي',
    brandEn: 'Almarai',
    variantOrFlavor: 'Full Fat',
    promoPrice: 4.95,
    originalPrice: 6.5,
    discountPercent: 24,
    promoNotes: null,
    sizeOrWeight: '1L',
    each_size_value: 1,
    each_size_unit: 'L',
    inner_pack_count: 1,
    sale_unit_type: 'piece',
    total_content_value: 1,
    total_content_unit: 'L',
    free_units_text: null,
    customer_limit: null,
    productThumbCropPath: null,
    offerCardCropPath: null,
    imageSubjectScope: 'product_package',
    status: 'ready_for_publication',
    confidence: 'high',
    category: 'grocery',
    ...overrides
  }
}

describe('WIFRAN-005J-UAT-FIX-08 Phase 2/3: Real Isolated PostgreSQL Publication, Journal, Storage & Undo', () => {
  it('TEST-D: Enforces schema parity gate for PRODUCTION_UI, DB source_offer_id uniqueness, and retry idempotency', async () => {
    const tmp = makeTempDir('fix08-pg-testd-')

    // 1. Database with ONLY Migrations 001..008 must fail schema parity gate cleanly
    const partialPg = await createIsolatedWifranPostgres({ upToMigration: 8 })
    try {
      const compat8 = await assessSchemaCompatibility({
        context: 'PRODUCTION_UI',
        pgClient: partialPg.client,
        allowIsolatedTestDb: true
      })
      expect(compat8.compatible).toBe(false)
      expect(compat8.hasMigration009).toBe(false)
      expect(compat8.hasMigration010).toBe(false)

      const pubPartial = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'development'))
      const preflightBlocked = await pubPartial.assessPublicationPreflight({
        manifest: { batchId: 'b1', proposals: {}, temporaryProducts: {}, brandSummaries: {}, totals: {} } as any,
        offers: [],
        context: 'PRODUCTION_UI',
        pgClient: partialPg.client,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true
      })
      expect(preflightBlocked.ready).toBe(false)
      expect(preflightBlocked.blockingReasons.some((r) => r.includes('PRODUCTION_PUBLICATION_BLOCKED'))).toBe(true)
    } finally {
      await partialPg.client.end?.()
    }

    // 2. Database with full Migrations 001..010 passes schema parity & rejects raw duplicate source_offer_id
    const fullPg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      const compat10 = await assessSchemaCompatibility({
        context: 'PRODUCTION_UI',
        pgClient: fullPg.client,
        allowIsolatedTestDb: true
      })
      expect(compat10.compatible).toBe(true)
      expect(compat10.hasMigration009).toBe(true)
      expect(compat10.hasMigration010).toBe(true)
      expect(compat10.hasConsumerView).toBe(true)
      expect(compat10.hasSourceOfferUniqueIndex).toBe(true)

      const prodRes = await fullPg.client.query<{ id: string }>(
        `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status)
         VALUES ('Almarai UHT Milk 1L', 'حليب المراعي طويل الأجل', 'Almarai', 1, 'L', 1, 'verified')
         RETURNING id::text`
      )
      const prodId = prodRes.rows[0].id

      const offer = buildOffer({})
      const manifest: MatchingRunManifest = {
        schemaVersion: '1.0',
        runId: 'run_batch-idemp-1',
        batchId: 'batch-idemp-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        matchingDatabaseContext: 'PRODUCTION_UI',
        totals: {} as any,
        proposals: {
          [offer.batchOfferKey]: {
            batchOfferKey: offer.batchOfferKey,
            decision: 'existing',
            matchedProductId: prodId,
            matchedDatabaseContext: 'PRODUCTION_UI',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        },
        temporaryProducts: {},
        brandSummaries: {}
      }

      const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'production'))
      const res1 = await pubService.publishApprovedCatalogBatch({
        manifest,
        offers: [offer],
        context: 'PRODUCTION_UI',
        operatorId: 'owner-op',
        pgClient: fullPg.client,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        enableImageUpload: false,
        idempotencyKey: 'fixed-op-key-001'
      })
      expect(res1.success).toBe(true)
      expect(res1.insertedOffersCount).toBe(1)
      expect(res1.idempotentReplay).toBe(false)

      // Exact repeat with same idempotencyKey -> zero duplicate writes, idempotentReplay: true
      const resReplay = await pubService.publishApprovedCatalogBatch({
        manifest,
        offers: [offer],
        context: 'PRODUCTION_UI',
        operatorId: 'owner-op',
        pgClient: fullPg.client,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        enableImageUpload: false,
        idempotencyKey: 'fixed-op-key-001'
      })
      expect(resReplay.success).toBe(true)
      expect(resReplay.idempotentReplay).toBe(true)
      expect(resReplay.publishOperationId).toBe(res1.publishOperationId)

      // Raw DB duplicate source_offer_id must fail unique index 23505
      await expect(
        fullPg.client.query(
          `INSERT INTO public.offers (supermarket_id, location_scope, title_ar, title_en, offer_start_date, offer_end_date, offer_price, status, source_offer_id)
           VALUES ($1, 'national', 'dup', 'dup', '2026-11-11', '2026-11-17', 5, 'published', $2)`,
          [UUID_OTHAIM, offer.sourceOfferId]
        )
      ).rejects.toThrow(/duplicate key|unique constraint/i)
    } finally {
      await fullPg.client.end?.()
    }
  }, 30000)

  it('TEST-E: Reconciles new/unchanged/update/conflict before publish and rolls back uncommitted storage + DB cleanly on error', async () => {
    const tmp = makeTempDir('fix08-pg-teste-')
    const pg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      const pRes = await pg.client.query<{ id: string }>(
        `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status)
         VALUES ('Suntop Orange 18x250ml', 'سن توب برتقال', 'Suntop', 250, 'ml', 18, 'verified') RETURNING id::text`
      )
      const prodId = pRes.rows[0].id

      const cardCrop = await makeCropImage(path.join(tmp, 'card1.webp'), { r: 220, g: 120, b: 20 })
      const storage = createInMemoryStorageAdapter()
      const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'development'))

      const baseOffer = buildOffer({
        batchOfferKey: 'b1:l1:1:suntop1',
        supermarketId: UUID_PANDA,
        supermarketName: 'Hyper Panda',
        sourceOfferId: 'doc_suntop:p001:i001:s01',
        titleEn: 'Suntop Orange 18x250ml',
        titleAr: 'سن توب برتقال',
        brand: 'Suntop',
        brandEn: 'Suntop',
        brandAr: 'سن توب',
        each_size_value: 250,
        each_size_unit: 'ml',
        inner_pack_count: 18,
        promoPrice: 24.95,
        originalPrice: 32.0,
        offerCardCropPath: cardCrop
      })

      const mkManifest = (bId: string, offersList: UnifiedBatchOffer[]): MatchingRunManifest => ({
        schemaVersion: '1.0',
        runId: `run_${bId}`,
        batchId: bId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        matchingDatabaseContext: 'DEVELOPMENT_TEST',
        totals: {} as any,
        proposals: Object.fromEntries(
          offersList.map((o) => [
            o.batchOfferKey,
            {
              batchOfferKey: o.batchOfferKey,
              decision: 'existing',
              matchedProductId: prodId,
              matchedDatabaseContext: 'DEVELOPMENT_TEST',
              operatorDecision: 'approved',
              confidence: 'high'
            } as any
          ])
        ),
        temporaryProducts: {},
        brandSummaries: {}
      })

      const pub1 = await pubService.publishApprovedCatalogBatch({
        manifest: mkManifest('b1', [baseOffer]),
        offers: [baseOffer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'dev-op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true
      })
      expect(pub1.success).toBe(true)
      expect(pub1.insertedOffersCount).toBe(1)
      expect(storage.storedObjects.size).toBe(1)

      // Now submit: (1) unchanged baseOffer -> already_published no-op,
      // (2) price-changed baseOffer? We'll test update candidate separately,
      // and (3) DIFFERENT source_offer_id colliding logically on same product/retailer/dates/scope!
      const logicalDupOffer = buildOffer({
        ...baseOffer,
        batchOfferKey: 'b2:l2:1:suntop_dup_pdf',
        sourceOfferId: 'doc_otherpdf:p002:i009:s01',
        promoPrice: 25.5
      })

      const preflight2 = await pubService.assessPublicationPreflight({
        manifest: mkManifest('b2', [baseOffer, logicalDupOffer]),
        offers: [baseOffer, logicalDupOffer],
        context: 'DEVELOPMENT_TEST',
        pgClient: pg.client,
        allowIsolatedTestDb: true
      })
      expect(preflight2.reconciliationSummary?.alreadyPublishedCount).toBe(1)
      expect(preflight2.reconciliationSummary?.duplicateConflictCount).toBe(1)

      const pub2NoopAndConflict = await pubService.publishApprovedCatalogBatch({
        manifest: mkManifest('b2', [baseOffer, logicalDupOffer]),
        offers: [baseOffer, logicalDupOffer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'dev-op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true
      })
      expect(pub2NoopAndConflict.success).toBe(true)
      expect(pub2NoopAndConflict.noop).toBe(true)
      expect(pub2NoopAndConflict.unchangedNoopCount).toBe(1)
      expect(pub2NoopAndConflict.conflictsCount).toBe(1)
      expect(pub2NoopAndConflict.publishedOffersCount).toBe(0)

      // Price update on baseOffer: blocked without approval when enforceUpdateApproval=true, applied cleanly with approval
      const updatedPriceOffer = { ...baseOffer, batchOfferKey: 'b3:l1:1:suntop1', promoPrice: 21.95 }
      const pub3Blocked = await pubService.publishApprovedCatalogBatch({
        manifest: mkManifest('b3', [updatedPriceOffer]),
        offers: [updatedPriceOffer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'dev-op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true,
        enforceUpdateApproval: true,
        approvedUpdateSourceIds: []
      })
      expect(pub3Blocked.noop).toBe(true)

      const pub3Approved = await pubService.publishApprovedCatalogBatch({
        manifest: mkManifest('b4', [updatedPriceOffer]),
        offers: [updatedPriceOffer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'dev-op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true,
        enforceUpdateApproval: true,
        approvedUpdateSourceIds: [updatedPriceOffer.sourceOfferId]
      })
      expect(pub3Approved.updatedOffersCount).toBe(1)
      expect(pub3Approved.noop).toBe(false)

      // Failed DB tx cleanup: invalid supermarket_id triggers FK error and must clean up newly staged exclusive crop
      const failCrop = await makeCropImage(path.join(tmp, 'fail_exclusive.webp'), { r: 99, g: 11, b: 199 })
      const failOffer = buildOffer({
        batchOfferKey: 'bfail:l1:1:f1',
        supermarketId: '00000000-0000-4000-a000-000000000000',
        sourceOfferId: 'doc_fail:p001:i001:s01',
        offerCardCropPath: failCrop
      })
      const countBeforeFail = storage.storedObjects.size
      await expect(
        pubService.publishApprovedCatalogBatch({
          manifest: mkManifest('bfail', [failOffer]),
          offers: [failOffer],
          context: 'DEVELOPMENT_TEST',
          operatorId: 'dev-op',
          pgClient: pg.client,
          storageAdapter: storage,
          allowIsolatedTestDb: true
        })
      ).rejects.toThrow(/Transaction rolled back/i)
      // New uncommitted exclusive object MUST have been removed on rollback, preserving prior count!
      expect(storage.storedObjects.size).toBe(countBeforeFail)
    } finally {
      await pg.client.end?.()
    }
  }, 30000)

  it('TEST-F/G/H/I: Full Undo Last Publish, external conflict guard, reused asset preservation, storage retry, and 3-retailer consumer view verification', async () => {
    const tmp = makeTempDir('fix08-pg-undo-')
    const pg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      // Pre-seed reused catalog product P_EXISTING and baseline offer O_BASE + pre-existing shared image
      const pExistingRes = await pg.client.query<{ id: string }>(
        `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status)
         VALUES ('Nido Fortified Milk 1800g', 'نيدو حليب مجفف 1800 جم', 'Nestle', 1800, 'g', 1, 'verified')
         RETURNING id::text`
      )
      const pExistingId = pExistingRes.rows[0].id

      await pg.client.query(
        `INSERT INTO public.offers (
          supermarket_id, city_id, location_scope, product_id, title_en, title_ar,
          offer_start_date, offer_end_date, offer_price, status, source_offer_id, catalog_match_status
        ) VALUES (
          $2, $3, 'city', $1, 'Nido 1800g Base', 'نيدو 1800 جم',
          '2026-11-11', '2026-11-17', 59.95, 'published', 'doc_base:p001:i001:s01', 'verified_linked'
        )`,
        [pExistingId, UUID_OTHAIM, UUID_JEDDAH]
      )

      const sharedCrop = await makeCropImage(path.join(tmp, 'shared.webp'), { r: 10, g: 20, b: 30 })
      const exclusiveCrop = await makeCropImage(path.join(tmp, 'exclusive_new.webp'), { r: 200, g: 200, b: 10 })
      const storage = createInMemoryStorageAdapter()

      // Pre-stage sharedCrop BEFORE Op 1 so Op 1 classifies it as reused_existing (not exclusive!)
      await stageContentAddressedUpload({
        adapter: storage,
        bucket: 'offer-images',
        localFilePath: sharedCrop,
        scopePrefix: 'offers',
        extension: 'webp'
      })

      const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'production'))

      // Build 3-retailer batch updating O_BASE price + adding new temporary product offer (BinDawood) + approved non-catalog offer (HyperPanda)
      const oUpdateBase = buildOffer({
        batchOfferKey: 'b_e2e:l1:27:base',
        supermarketId: UUID_OTHAIM,
        supermarketName: 'Othaim',
        sourceOfferId: 'doc_base:p001:i001:s01',
        titleEn: 'Nido 1800g Base',
        titleAr: 'نيدو 1800 جم',
        brand: 'Nestle',
        brandEn: 'Nestle',
        each_size_value: 1800,
        each_size_unit: 'g',
        promoPrice: 54.95,
        originalPrice: 69.95,
        offerCardCropPath: sharedCrop
      })
      const oNewCatalogTemp = buildOffer({
        batchOfferKey: 'b_e2e:l2:24:temp',
        leafletId: 'leaflet-002',
        supermarketId: UUID_BINDAWOOD,
        supermarketName: 'BinDawood',
        sourceOfferId: 'doc_bd:p024:i001:s01',
        titleEn: 'Goody Peanut Butter Creamy 510g',
        titleAr: 'زبدة الفول السوداني قودي ناعمة 510 جم',
        brand: 'Goody',
        brandEn: 'Goody',
        brandAr: 'قودي',
        each_size_value: 510,
        each_size_unit: 'g',
        promoPrice: 14.95,
        originalPrice: 19.5,
        consumerDisplayImagePath: exclusiveCrop,
        approvedConsumerImageSourceKind: 'generic_library' as any
      })
      const oNonCatalog = buildOffer({
        batchOfferKey: 'b_e2e:l3:7:fresh',
        leafletId: 'leaflet-003',
        supermarketId: UUID_PANDA,
        supermarketName: 'Hyper Panda',
        sourceOfferId: 'doc_panda:p007:i003:s01',
        titleEn: 'Fresh Yemeni Mangoes 1kg',
        titleAr: 'مانجو يمني طازج 1 كجم',
        brand: null,
        brandEn: null,
        brandAr: null,
        sizeOrWeight: '1kg',
        each_size_value: 1,
        each_size_unit: 'kg',
        total_content_value: 1,
        total_content_unit: 'kg',
        sale_unit_type: 'kg',
        promoPrice: 8.95,
        originalPrice: 12.95,
        imageSubjectScope: 'representative_assortment',
        offerCardCropPath: sharedCrop
      })

      const manifest: MatchingRunManifest = {
        schemaVersion: '1.0',
        runId: 'run_batch-3retailers-e2e',
        batchId: 'batch-3retailers-e2e',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        matchingDatabaseContext: 'PRODUCTION_UI',
        totals: {} as any,
        proposals: {
          [oUpdateBase.batchOfferKey]: {
            batchOfferKey: oUpdateBase.batchOfferKey,
            decision: 'existing',
            matchedProductId: pExistingId,
            matchedDatabaseContext: 'PRODUCTION_UI',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any,
          [oNewCatalogTemp.batchOfferKey]: {
            batchOfferKey: oNewCatalogTemp.batchOfferKey,
            decision: 'temporary',
            temporaryId: 'temp_goody_pb',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any,
          [oNonCatalog.batchOfferKey]: {
            batchOfferKey: oNonCatalog.batchOfferKey,
            decision: 'unresolved',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        },
        temporaryProducts: {
          temp_goody_pb: {
            temporaryId: 'temp_goody_pb',
            brandKey: 'goody',
            brandNameEn: 'Goody',
            brandNameAr: 'قودي',
            productNameEn: 'Goody Peanut Butter Creamy 510g',
            productNameAr: 'زبدة الفول السوداني قودي ناعمة 510 جم',
            variantOrFlavor: 'Creamy',
            eachSizeValue: 510,
            eachSizeUnit: 'g',
            innerPackCount: 1,
            saleUnitType: 'piece',
            productForm: 'jar',
            sourceOfferKeys: [oNewCatalogTemp.batchOfferKey],
            retailers: ['bindawood'],
            operatorDecision: 'approved'
          } as any
        },
        nonCatalogApprovals: {
          [oNonCatalog.batchOfferKey]: {
            batchOfferKey: oNonCatalog.batchOfferKey,
            decision: 'approved',
            category: 'loose_produce',
            updatedAt: new Date().toISOString()
          }
        },
        brandSummaries: {}
      }

      const pubRes = await pubService.publishApprovedCatalogBatch({
        manifest,
        offers: [oUpdateBase, oNewCatalogTemp, oNonCatalog],
        context: 'PRODUCTION_UI',
        operatorId: 'uat-operator',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        approveAllUpdates: true
      })
      expect(pubRes.errors ?? []).toEqual([])
      expect(pubRes.success).toBe(true)
      expect(pubRes.createdProductsCount).toBe(1)
      expect(pubRes.insertedOffersCount).toBe(2)
      expect(pubRes.updatedOffersCount).toBe(1)
      expect(pubRes.storageSummary?.uploaded).toBe(1) // exclusiveCrop
      expect(pubRes.storageSummary?.reused).toBe(1) // sharedCrop

      // Verify consumer view exposes catalog-linked product_id and MASKS product_id for non-catalog
      const viewAfterPub = await pg.client.query<{ source_offer_id: string; product_id: string | null; display_image_url: string | null }>(
        `SELECT source_offer_id, product_id::text, display_image_url FROM public.v_consumer_offers ORDER BY source_offer_id`
      )
      const viewMap = Object.fromEntries(viewAfterPub.rows.map((r) => [r.source_offer_id, r]))
      expect(viewMap['doc_base:p001:i001:s01']?.product_id).toBe(pExistingId)
      expect(viewMap['doc_bd:p024:i001:s01']?.product_id).toBeTruthy()
      expect(viewMap['doc_panda:p007:i003:s01']?.product_id).toBeNull()
      // Private evidence crops MUST NOT appear in v_consumer_offers; only consumerDisplayImagePath ('offer-display-images') does
      expect(viewMap['doc_base:p001:i001:s01']?.display_image_url).toBeNull()
      expect(viewMap['doc_panda:p007:i003:s01']?.display_image_url).toBeNull()
      expect(viewMap['doc_bd:p024:i001:s01']?.display_image_url).toContain('/offer-display-images/')

      // Subsequent strict NO-OP publish must NOT block or hide pubRes from Undo
      const preflightNoop = await pubService.assessPublicationPreflight({
        manifest,
        offers: [oUpdateBase, oNewCatalogTemp, oNonCatalog],
        context: 'PRODUCTION_UI',
        pgClient: pg.client,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true
      })
      const noopDiffs = (preflightNoop.reconciliationSummary?.entries || [])
        .filter((e) => e.classification !== 'already_published')
        .map((e) => ({ key: e.batchOfferKey, cls: e.classification, diffs: e.fieldDiffs }))
      expect(noopDiffs).toEqual([])

      const noopRes = await pubService.publishApprovedCatalogBatch({
        manifest,
        offers: [oUpdateBase, oNewCatalogTemp, oNonCatalog],
        context: 'PRODUCTION_UI',
        operatorId: 'uat-operator',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        idempotencyKey: 'explicit-different-key-noop'
      })
      expect(noopRes.noop).toBe(true)

      // Preview Undo: must pick pubRes (ignoring noopRes!), report counts accurately
      const previewClean = await previewUndoLastPublish({ client: pg.client })
      expect(previewClean.canUndo).toBe(true)
      expect(previewClean.targetOperation?.publishOperationId).toBe(pubRes.publishOperationId)
      expect(previewClean.affectedCounts.offersToDelete).toBe(2)
      expect(previewClean.affectedCounts.offersToRestore).toBe(1)
      expect(previewClean.affectedCounts.productsToDelete).toBe(1)
      expect(previewClean.affectedCounts.exclusiveStorageObjectsToDelete).toBe(1)
      expect(previewClean.affectedCounts.reusedStorageObjectsPreserved).toBe(1)

      // TEST-F: Concurrent post-publish edit blocks Undo cleanly with zero partial corruption
      await pg.client.query(
        `UPDATE public.offers SET offer_price = 12.00 WHERE source_offer_id = 'doc_bd:p024:i001:s01'`
      )
      const blockedUndo = await undoLastPublish({
        client: pg.client,
        operatorId: 'uat-operator',
        reason: 'Attempt during concurrent edit',
        storageAdapter: storage
      })
      expect(blockedUndo.success).toBe(false)
      expect(blockedUndo.status).toBe('undo_blocked')
      expect(blockedUndo.blockedReasons.some((r) => r.includes('CONCURRENT_POST_PUBLISH_EDIT'))).toBe(true)

      // Restore offer_price back to exact published value so Undo succeeds, testing TEST-H transient storage cleanup failure!
      await pg.client.query(
        `UPDATE public.offers SET offer_price = 14.95 WHERE source_offer_id = 'doc_bd:p024:i001:s01'`
      )
      const failingDeleteAdapter = {
        ...storage,
        deleteObjects: async () => ({ error: 'Simulated transient 503 storage error' })
      }
      const undoPendingCleanup = await undoLastPublish({
        client: pg.client,
        operatorId: 'uat-operator',
        reason: 'UAT rollback verification',
        storageAdapter: failingDeleteAdapter
      })
      expect(undoPendingCleanup.success).toBe(true)
      expect(undoPendingCleanup.status).toBe('undo_cleanup_pending')
      expect(undoPendingCleanup.revertedMutationsCount).toBeGreaterThanOrEqual(4)
      expect(undoPendingCleanup.storageCleanup.failedCount).toBe(1)

      // Verify DB completely restored to pre-publish state despite pending storage cleanup
      const offersPostUndo = await pg.client.query<{ source_offer_id: string; offer_price: string }>(
        `SELECT source_offer_id, offer_price::text FROM public.offers`
      )
      expect(offersPostUndo.rows.length).toBe(1)
      expect(offersPostUndo.rows[0].source_offer_id).toBe('doc_base:p001:i001:s01')
      expect(Number(offersPostUndo.rows[0].offer_price)).toBe(59.95)
      const prodsPostUndo = await pg.client.query<{ id: string }>(`SELECT id::text FROM public.products`)
      expect(prodsPostUndo.rows.map((r) => r.id)).toEqual([pExistingId])

      // Consumer view matches pre-publish state
      const viewPostUndo = await pg.client.query<{ source_offer_id: string }>(`SELECT source_offer_id FROM public.v_consumer_offers`)
      expect(viewPostUndo.rows.map((r) => r.source_offer_id)).toEqual(['doc_base:p001:i001:s01'])

      // Shared storage image was NEVER deleted; exclusive object still present until retry cleanup succeeds
      expect(storage.storedObjects.size).toBe(2)

      // Retry storage cleanup (STORAGE-04) finishes cleanup cleanly and preserves sharedCrop!
      const retryRes = await retryUndoStorageCleanup({
        client: pg.client,
        publishOperationId: pubRes.publishOperationId!,
        storageAdapter: storage
      })
      expect(retryRes.success).toBe(true)
      expect(retryRes.status).toBe('undone')
      expect(retryRes.storageCleanup.deletedCount).toBe(1)
      expect(storage.storedObjects.size).toBe(1) // ONLY sharedCrop remains!

      // REV-13: Repeat Undo is idempotent & history is permanently retained
      const opDetails = await getPublicationOperationDetails({
        client: pg.client,
        publishOperationId: pubRes.publishOperationId!
      })
      expect(opDetails.operation?.status).toBe('undone')
      const repeatUndo = await undoLastPublish({
        client: pg.client,
        operatorId: 'uat-operator',
        reason: 'Repeat safety check',
        storageAdapter: storage
      })
      expect(repeatUndo.alreadyUndone).toBe(true)

      const history = await listPublicationHistory({ client: pg.client })
      expect(history.length).toBeGreaterThanOrEqual(3) // noop + pubRes + undoAudit
    } finally {
      await pg.client.end?.()
    }
  }, 30000)
})
