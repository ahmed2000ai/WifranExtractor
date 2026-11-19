import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createIsolatedWifranPostgres } from './isolatedPostgresHarness008'
import { assessSchemaCompatibility } from '../schemaCompatibilityService'
import { CatalogPublicationService } from '../catalogPublicationService'
import { VerifiedMatchCacheService } from '../verifiedMatchCacheService'
import { DocumentExtractionHistoryService } from '../../cache/documentExtractionHistoryService'
import {
  buildCandidateSnapshotFromUnifiedOffer,
  reconcileOffersAgainstDatabase
} from '../prePublicationDuplicateReconciler'
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
import { computeStableSourceOfferId } from '../../../shared/utils/nonCatalogPublicationPolicy'
import {
  computeDocumentIdFromFingerprint,
  computeOfferAnchorSignature
} from '../../../shared/utils/sourceIdentityAndDuplicateUtils'
import { CURRENT_HYBRID_COMPATIBILITY_PROFILE } from '../../../shared/utils/sourceIdentityAndDuplicateUtils'
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
    const dir = tempDirs.pop()!
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore Windows cleanup timing
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
const UUID_LULU = 'c2cc16c2-0003-4444-b000-c00000000003'
const UUID_JEDDAH = 'a6f7b140-0002-4444-a000-000000000002'

function buildOffer(overrides: Partial<UnifiedBatchOffer> = {}): UnifiedBatchOffer {
  return {
    batchOfferKey: 'batch-ver:l1:1:o01',
    batchId: 'batch-ver',
    leafletId: 'leaflet-001',
    sourceDocumentId: 'doc_aaaa1111bbbb2222',
    sourceFileName: 'othaim_wk46.pdf',
    sourcePdfPath: '/tmp/othaim_wk46.pdf',
    sourceFileFingerprint: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff66667777888899990000',
    sourcePage: 1,
    sourceOfferId: 'doc_aaaa1111bbbb2222:p001:i001:s01',
    sourceOfferAnchor: 'anc_ver_001',
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
    category: 'dairy',
    ...overrides
  }
}

function buildManifest(
  batchId: string,
  proposals: MatchingRunManifest['proposals'],
  temporaryProducts: MatchingRunManifest['temporaryProducts'] = {},
  nonCatalogApprovals: MatchingRunManifest['nonCatalogApprovals'] = {},
  context: 'DEVELOPMENT_TEST' | 'PRODUCTION_UI' = 'PRODUCTION_UI'
): MatchingRunManifest {
  return {
    schemaVersion: '1.0',
    runId: `run_${batchId}`,
    batchId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'completed',
    model: 'gemini-3.8-flash',
    thinkingLevel: 'MEDIUM',
    executionMode: 'flex',
    matchingDatabaseContext: context,
    totals: {} as any,
    proposals,
    temporaryProducts,
    nonCatalogApprovals,
    brandSummaries: {}
  }
}

describe('WIFRAN FIX-08 Pre-Deployment Verification: Identity, Migration 010 Audit, Lifecycle & Recovery', () => {
  it('SEC-2: Verifies source identity & duplicate guarantees across filenames, recompression, cross-batch, OCR jitter, price updates, weeks & promo tiers', async () => {
    const tmp = makeTempDir('fix08-sec2-')
    const pg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      // Seed catalog product
      const pRes = await pg.client.query<{ id: string }>(
        `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status)
         VALUES ('Nescafe Gold 200g', 'نسكافيه جولد 200 جم', 'Nescafe', 200, 'g', 1, 'verified')
         RETURNING id::text`
      )
      const prodId = Number(pRes.rows[0].id)

      // Create dummy cached artifact files for DocumentExtractionHistoryService pre-extraction checks
      const pdfBytes = Buffer.from('%PDF-1.4\n%Wifran Leaflet Othaim Wk46\n%%EOF')
      const shaPdf = crypto.createHash('sha256').update(pdfBytes).digest('hex')
      const pdfA = path.join(tmp, 'othaim-jeddah-wk46.pdf')
      const pdfB = path.join(tmp, 'copy_renamed_final_v2.pdf')
      const pdfRecompressed = path.join(tmp, 'othaim-jeddah-recompressed.pdf')
      fs.writeFileSync(pdfA, pdfBytes)
      fs.writeFileSync(pdfB, pdfBytes) // Identical bytes under different filename
      fs.writeFileSync(pdfRecompressed, Buffer.concat([pdfBytes, Buffer.from('\n%re-encoded-stream\n')])) // Distinct SHA-256!

      const docIdA = computeDocumentIdFromFingerprint(shaPdf, path.basename(pdfA))
      const docIdB = computeDocumentIdFromFingerprint(shaPdf, path.basename(pdfB))
      const shaRecomp = crypto.createHash('sha256').update(fs.readFileSync(pdfRecompressed)).digest('hex')
      const docIdRecomp = computeDocumentIdFromFingerprint(shaRecomp, path.basename(pdfRecompressed))

      // 2.1 Same PDF under different filenames -> identical documentId + pre-extraction duplicate full reuse
      expect(docIdA).toBe(docIdB)
      expect(docIdRecomp).not.toBe(docIdA)

      const resultJson = path.join(tmp, 'p27.json')
      const stagedJson = path.join(tmp, 'staged.json')
      const cropImg = await makeCropImage(path.join(tmp, 'crop.webp'), { r: 100, g: 120, b: 140 })
      fs.writeFileSync(resultJson, JSON.stringify({ pageResult: { ok: true } }))
      fs.writeFileSync(stagedJson, '{}')

      const historySvc = new DocumentExtractionHistoryService({ indexFilePath: path.join(tmp, 'doc-history.json') })
      historySvc.recordExtractedPage({
        documentId: docIdA,
        fileFingerprint: shaPdf,
        fileName: path.basename(pdfA),
        workspacePath: tmp,
        batchId: 'batch-1',
        leafletId: 'leaflet-1',
        pageNumber: 27,
        compatibilityProfile: CURRENT_HYBRID_COMPATIBILITY_PROFILE,
        resultJsonPath: resultJson,
        stagedDraftPath: stagedJson,
        cropPaths: [cropImg],
        offersCount: 1,
        quarantinedCount: 0,
        extractedAt: new Date().toISOString()
      })

      const preCheckRenamed = historySvc.inspectPreExtractionDuplicates({
        files: [{ path: pdfB, name: path.basename(pdfB), pageCount: 30, pagesToProcess: [27] }]
      })
      expect(preCheckRenamed.perFile[0].classification).toBe('exact_duplicate_full_reuse')
      expect(preCheckRenamed.perFile[0].documentId).toBe(docIdA)
      expect(preCheckRenamed.totalPayablePages).toBe(0)

      // 2.2 Re-encoded / recompressed PDF has distinct SHA-256 -> pre-extraction treats as new_document
      const preCheckRecomp = historySvc.inspectPreExtractionDuplicates({
        files: [{ path: pdfRecompressed, name: path.basename(pdfRecompressed), pageCount: 30, pagesToProcess: [27] }]
      })
      expect(preCheckRecomp.perFile[0].classification).toBe('new_document')

      // Publish original offer via CatalogPublicationService
      const anchorOrig = computeOfferAnchorSignature({
        sourcePage: 27,
        supermarketId: UUID_OTHAIM,
        titleEn: 'Nescafe Gold 200g',
        brand: 'Nescafe',
        promoPrice: 29.95,
        originalPrice: 42.0,
        sizeOrWeight: '200g',
        bboxNorm: [0.11, 0.21, 0.42, 0.51]
      })
      const baseOffer = buildOffer({
        batchId: 'batch-1',
        batchOfferKey: 'batch-1:leaflet-1:27:item_0',
        sourceDocumentId: docIdA,
        sourceFileFingerprint: shaPdf,
        sourceFileName: path.basename(pdfA),
        sourcePage: 27,
        sourceOfferAnchor: anchorOrig,
        sourceOfferId: undefined, // derive via computeStableSourceOfferId
        titleEn: 'Nescafe Gold 200g',
        titleAr: 'نسكافيه جولد 200 جم',
        brand: 'Nescafe',
        brandEn: 'Nescafe',
        each_size_value: 200,
        each_size_unit: 'g',
        sizeOrWeight: '200g',
        promoPrice: 29.95,
        originalPrice: 42.0
      })
      baseOffer.sourceOfferId = computeStableSourceOfferId(baseOffer)

      const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'production'))
      const pub1 = await pubService.publishApprovedCatalogBatch({
        manifest: buildManifest('batch-1', {
          [baseOffer.batchOfferKey]: {
            batchOfferKey: baseOffer.batchOfferKey,
            decision: 'existing',
            matchedProductId: String(prodId),
            matchedDatabaseContext: 'PRODUCTION_UI',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        }),
        offers: [baseOffer],
        context: 'PRODUCTION_UI',
        operatorId: 'ver-op',
        pgClient: pg.client,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        enableImageUpload: false,
        idempotencyKey: 'sec2-base-pub'
      })
      expect(pub1.success).toBe(true)
      expect(pub1.insertedOffersCount).toBe(1)

      // 2.2 cont: Recompressed PDF with distinct SHA-256 + slightly different promo/card produces distinct sourceOfferId,
      // MUST STILL BE CAUGHT by logical reconciliation against content/retailer/week/product -> duplicate_conflict!
      const recompressedOffer = buildOffer({
        ...baseOffer,
        batchId: 'batch-recomp',
        batchOfferKey: 'batch-recomp:leaflet-1:27:item_0',
        sourceDocumentId: docIdRecomp,
        sourceFileFingerprint: shaRecomp,
        sourceFileName: path.basename(pdfRecompressed),
        sourceOfferAnchor: 'anc_recompressed_different',
        sourceOfferId: undefined,
        promoPrice: 30.95
      })
      recompressedOffer.sourceOfferId = computeStableSourceOfferId(recompressedOffer)
      expect(recompressedOffer.sourceOfferId).not.toBe(baseOffer.sourceOfferId)

      const reconRecomp = await reconcileOffersAgainstDatabase({
        client: pg.client,
        candidates: [
          buildCandidateSnapshotFromUnifiedOffer(
            recompressedOffer,
            prodId,
            { unitPrice: 154.75, unitPriceUnit: 'kg' },
            'verified_linked'
          )
        ]
      })
      expect(reconRecomp.duplicateConflictCount).toBe(1)
      expect(reconRecomp.entries[0].classification).toBe('duplicate_conflict')

      // 2.3 Same source offer extracted in a DIFFERENT batch -> same sourceOfferId -> already_published no-op
      const differentBatchOffer = buildOffer({
        ...baseOffer,
        batchId: 'batch-2',
        leafletId: 'leaflet-other',
        batchOfferKey: 'batch-2:leaflet-other:27:item_0',
        sourceFileName: path.basename(pdfB),
        sourceOfferId: undefined
      })
      differentBatchOffer.sourceOfferId = computeStableSourceOfferId(differentBatchOffer)
      expect(differentBatchOffer.sourceOfferId).toBe(baseOffer.sourceOfferId)

      const pubDiffBatch = await pubService.publishApprovedCatalogBatch({
        manifest: buildManifest('batch-2', {
          [differentBatchOffer.batchOfferKey]: {
            batchOfferKey: differentBatchOffer.batchOfferKey,
            decision: 'existing',
            matchedProductId: String(prodId),
            matchedDatabaseContext: 'PRODUCTION_UI',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        }),
        offers: [differentBatchOffer],
        context: 'PRODUCTION_UI',
        operatorId: 'ver-op',
        pgClient: pg.client,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        enableImageUpload: false,
        idempotencyKey: 'sec2-diff-batch-noop'
      })
      expect(pubDiffBatch.noop).toBe(true)
      expect(pubDiffBatch.unchangedNoopCount).toBe(1)

      // 2.4 Changed OCR item ordering (e.g. item_7 vs item_0) & minor bbox jitter within quantization bucket -> IDENTICAL anchor & sourceOfferId!
      const anchorReordered = computeOfferAnchorSignature({
        sourcePage: 27,
        supermarketId: UUID_OTHAIM,
        titleEn: 'Nescafe Gold 200g',
        brand: 'Nescafe',
        promoPrice: 29.95,
        originalPrice: 42.0,
        sizeOrWeight: '200g',
        bboxNorm: [0.12, 0.22, 0.41, 0.52] // Quantized grid 1,2,4,5 matches [0.11, 0.21, 0.42, 0.51]
      })
      expect(anchorReordered).toBe(anchorOrig)
      const reorderedOffer = buildOffer({
        ...baseOffer,
        batchId: 'batch-reorder',
        batchOfferKey: 'batch-reorder:leaflet-1:27:item_7',
        sourceOfferAnchor: anchorReordered,
        sourceOfferId: undefined
      })
      reorderedOffer.sourceOfferId = computeStableSourceOfferId(reorderedOffer)
      expect(reorderedOffer.sourceOfferId).toBe(baseOffer.sourceOfferId)

      // 2.5 Same source offer with corrected promotional price -> update_candidate with field diff, then clean DB update
      const correctedPriceOffer = buildOffer({
        ...baseOffer,
        batchId: 'batch-price-fix',
        batchOfferKey: 'batch-price-fix:leaflet-1:27:item_0',
        promoPrice: 27.95,
        sourceOfferId: baseOffer.sourceOfferId
      })
      const reconPriceFix = await reconcileOffersAgainstDatabase({
        client: pg.client,
        candidates: [
          buildCandidateSnapshotFromUnifiedOffer(
            correctedPriceOffer,
            prodId,
            { unitPrice: 139.75, unitPriceUnit: 'kg' },
            'verified_linked'
          )
        ]
      })
      expect(reconPriceFix.updateCandidateCount).toBe(1)
      expect(reconPriceFix.entries[0].fieldDiffs.some((d) => d.field === 'offer_price')).toBe(true)

      const pubPriceFix = await pubService.publishApprovedCatalogBatch({
        manifest: buildManifest('batch-price-fix', {
          [correctedPriceOffer.batchOfferKey]: {
            batchOfferKey: correctedPriceOffer.batchOfferKey,
            decision: 'existing',
            matchedProductId: String(prodId),
            matchedDatabaseContext: 'PRODUCTION_UI',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        }),
        offers: [correctedPriceOffer],
        context: 'PRODUCTION_UI',
        operatorId: 'ver-op',
        pgClient: pg.client,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        enableImageUpload: false,
        enforceUpdateApproval: true,
        approvedUpdateSourceIds: [correctedPriceOffer.sourceOfferId!],
        idempotencyKey: 'sec2-price-fix'
      })
      expect(pubPriceFix.updatedOffersCount).toBe(1)

      // 2.6 Same product + retailer during a DIFFERENT offer week -> allowed as distinct row
      const nextWeekOffer = buildOffer({
        ...baseOffer,
        batchId: 'batch-wk47',
        batchOfferKey: 'batch-wk47:leaflet-wk47:1:item_0',
        sourceDocumentId: 'doc_wk47_different',
        sourceFileFingerprint: 'bbbb'.repeat(16),
        sourceOfferAnchor: 'anc_wk47_001',
        sourceOfferId: 'doc_wk47_different:p001:i001:s01',
        offerStartDate: '2026-11-18',
        offerEndDate: '2026-11-24',
        promoPrice: 31.95
      })

      // 2.7 Legitimate distinct promotional tiers (loyalty required vs standard price_cut, AND bundle_price) in same week/product -> allowed as distinct rows!
      const loyaltyTierOffer = buildOffer({
        ...baseOffer,
        batchId: 'batch-tiers',
        batchOfferKey: 'batch-tiers:l1:27:loyalty',
        sourceOfferAnchor: 'anc_ver_002_loyalty',
        sourceOfferId: 'doc_aaaa1111bbbb2222:p027:loyalty:s01',
        promoPrice: 24.95,
        promotion_mechanic: 'loyalty_price',
        canonical: { eligibility: { loyalty: { requirement: 'required' } } } as any
      })
      const bundleTierOffer = buildOffer({
        ...baseOffer,
        batchId: 'batch-tiers',
        batchOfferKey: 'batch-tiers:l1:27:bundle',
        sourceOfferAnchor: 'anc_ver_003_bundle',
        sourceOfferId: 'doc_aaaa1111bbbb2222:p027:bundle:s01',
        promoPrice: 28.5,
        originalPrice: 42.0,
        promotion_mechanic: 'buy_n_get_m'
      })

      const pubDistinct = await pubService.publishApprovedCatalogBatch({
        manifest: buildManifest('batch-distinct', {
          [nextWeekOffer.batchOfferKey]: {
            batchOfferKey: nextWeekOffer.batchOfferKey,
            decision: 'existing',
            matchedProductId: String(prodId),
            matchedDatabaseContext: 'PRODUCTION_UI',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any,
          [loyaltyTierOffer.batchOfferKey]: {
            batchOfferKey: loyaltyTierOffer.batchOfferKey,
            decision: 'existing',
            matchedProductId: String(prodId),
            matchedDatabaseContext: 'PRODUCTION_UI',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any,
          [bundleTierOffer.batchOfferKey]: {
            batchOfferKey: bundleTierOffer.batchOfferKey,
            decision: 'existing',
            matchedProductId: String(prodId),
            matchedDatabaseContext: 'PRODUCTION_UI',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        }),
        offers: [nextWeekOffer, loyaltyTierOffer, bundleTierOffer],
        context: 'PRODUCTION_UI',
        operatorId: 'ver-op',
        pgClient: pg.client,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        enableImageUpload: false,
        idempotencyKey: 'sec2-distinct-week-and-tiers'
      })
      expect(pubDistinct.errors ?? []).toEqual([])
      expect(pubDistinct.success).toBe(true)
      expect(pubDistinct.insertedOffersCount).toBe(3)
      expect(pubDistinct.conflictsCount).toBe(0)

      const totalOffers = await pg.client.query<{ c: string }>(`SELECT count(*)::text AS c FROM public.offers`)
      expect(Number(totalOffers.rows[0].c)).toBe(4) // 1 base (price-updated) + 1 nextWeek + 1 loyalty + 1 bundle
    } finally {
      await pg.client.end?.()
    }
  }, 30000)

  it('SEC-3: Executes read-only pre-migration SQL inspection queries cleanly against pre-010 and post-010 PostgreSQL schemas', async () => {
    const inspectQueries = {
      duplicateSourceOfferIds: `
        SELECT source_offer_id, count(*)::int AS row_count
        FROM public.offers
        WHERE source_offer_id IS NOT NULL
        GROUP BY source_offer_id
        HAVING count(*) > 1`,
      nullSourceOfferIdCount: `
        SELECT count(*)::int AS null_source_offer_id_count
        FROM public.offers
        WHERE source_offer_id IS NULL`,
      secondaryDuplicateGroups: `
        SELECT supermarket_id, product_id, offer_start_date, offer_end_date, location_scope, count(*)::int AS group_count
        FROM public.offers
        WHERE product_id IS NOT NULL AND status = 'published'
        GROUP BY supermarket_id, product_id, offer_start_date, offer_end_date, location_scope
        HAVING count(*) > 1`,
      sourceOfferIdTypeAndIndexes: `
        SELECT c.data_type, i.indexname, i.indexdef
        FROM information_schema.columns c
        LEFT JOIN pg_indexes i
          ON i.schemaname = c.table_schema
         AND i.tablename = c.table_name
         AND i.indexdef ILIKE '%source_offer_id%'
        WHERE c.table_schema = 'public'
          AND c.table_name = 'offers'
          AND c.column_name = 'source_offer_id'`,
      consumerViewDefinition: `
        SELECT viewname, definition
        FROM pg_views
        WHERE schemaname = 'public' AND viewname = 'v_consumer_offers'`,
      migration009Tables: `
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('product_alias_proposals', 'product_alias_audit_log', 'temp_product_staging')
        ORDER BY tablename`
    }

    // Check pre-010 schema (Migrations 001..009)
    const prePg = await createIsolatedWifranPostgres({ upToMigration: 9 })
    try {
      const preCompat = await assessSchemaCompatibility({
        context: 'DEVELOPMENT_TEST',
        pgClient: prePg.client,
        allowIsolatedTestDb: true
      })
      expect(preCompat.hasMigration009).toBe(true)
      expect(preCompat.hasMigration010).toBe(false)

      for (const sql of Object.values(inspectQueries)) {
        const res = await prePg.client.query(sql)
        expect(Array.isArray(res.rows)).toBe(true)
      }
      const m009 = await prePg.client.query<{ tablename: string }>(inspectQueries.migration009Tables)
      expect(m009.rows.map((r) => r.tablename)).toEqual([
        'product_alias_audit_log',
        'product_alias_proposals'
      ])
    } finally {
      await prePg.client.end?.()
    }

    // Check post-010 schema (Migrations 001..010)
    const postPg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      const postCompat = await assessSchemaCompatibility({
        context: 'PRODUCTION_UI',
        pgClient: postPg.client,
        allowIsolatedTestDb: true
      })
      expect(postCompat.compatible).toBe(true)
      expect(postCompat.hasSourceOfferUniqueIndex).toBe(true)

      for (const sql of Object.values(inspectQueries)) {
        const res = await postPg.client.query(sql)
        expect(Array.isArray(res.rows)).toBe(true)
      }
      const idxRes = await postPg.client.query<{ data_type: string; indexname: string }>(
        inspectQueries.sourceOfferIdTypeAndIndexes
      )
      expect(idxRes.rows.some((r) => r.data_type === 'text' && r.indexname === 'idx_offers_source_offer_id')).toBe(true)

      const readiness = await postPg.client.query<{ check_wifran_schema_readiness: Record<string, any> }>(
        `SELECT public.check_wifran_schema_readiness()`
      )
      expect(readiness.rows[0].check_wifran_schema_readiness.has_migration_009_alias_proposals).toBe(true)
      expect(readiness.rows[0].check_wifran_schema_readiness.has_migration_010_pub_ops).toBe(true)
    } finally {
      await postPg.client.end?.()
    }
  }, 30000)

  it('SEC-4: Executes full 12-step publish -> no-op -> update -> undo -> guardrails sequence with direct SQL assertions', async () => {
    const tmp = makeTempDir('fix08-sec4-')
    const pg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      const pExistingRes = await pg.client.query<{ id: string }>(
        `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status)
         VALUES ('Sadia Chicken 1000g', 'دجاج ساديا 1000 جم', 'Sadia', 1000, 'g', 1, 'verified')
         RETURNING id::text`
      )
      const pExistingId = pExistingRes.rows[0].id

      const sharedCrop = await makeCropImage(path.join(tmp, 'shared.webp'), { r: 25, g: 35, b: 45 })
      const exclusiveCrop = await makeCropImage(path.join(tmp, 'excl.webp'), { r: 210, g: 140, b: 20 })
      const storage = createInMemoryStorageAdapter()
      // Pre-stage sharedCrop before Op 1 so Op 1 treats it as reused_existing
      await stageContentAddressedUpload({
        adapter: storage,
        bucket: 'offer-images',
        localFilePath: sharedCrop,
        scopePrefix: 'offers',
        extension: 'webp'
      })

      const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'production'))

      // Step 1-2: Publish Op 1 (existing product offer, new temp product offer, approved non-catalog offer)
      const oCatalog = buildOffer({
        batchOfferKey: 'op1:l1:1:cat',
        supermarketId: UUID_OTHAIM,
        supermarketName: 'Al Othaim Markets',
        sourceOfferId: 'doc_sec4:p001:i001:s01',
        titleEn: 'Sadia Chicken 1000g',
        titleAr: 'دجاج ساديا 1000 جم',
        brand: 'Sadia',
        brandEn: 'Sadia',
        each_size_value: 1000,
        each_size_unit: 'g',
        sizeOrWeight: '1000g',
        promoPrice: 17.95,
        originalPrice: 22.0,
        offerCardCropPath: sharedCrop
      })
      const oTemp = buildOffer({
        batchOfferKey: 'op1:l2:2:tmp',
        leafletId: 'leaflet-002',
        supermarketId: UUID_LULU,
        supermarketName: 'LuLu Hypermarket',
        sourceOfferId: 'doc_sec4_b:p002:i002:s01',
        titleEn: 'Lurpak Unsalted Butter 400g',
        titleAr: 'زبدة لورباك غير مملحة 400 جم',
        brand: 'Lurpak',
        brandEn: 'Lurpak',
        brandAr: 'لورباك',
        each_size_value: 400,
        each_size_unit: 'g',
        sizeOrWeight: '400g',
        promoPrice: 19.5,
        originalPrice: 25.0,
        offerCardCropPath: exclusiveCrop
      })
      const oNonCat = buildOffer({
        batchOfferKey: 'op1:l3:3:noncat',
        leafletId: 'leaflet-003',
        supermarketId: UUID_PANDA,
        supermarketName: 'Hyper Panda',
        sourceOfferId: 'doc_sec4_c:p003:i003:s01',
        titleEn: 'Fresh Jordanian Tomatoes 1kg',
        titleAr: 'طماطم أردنية طازجة 1 كجم',
        brand: null,
        brandEn: null,
        brandAr: null,
        sizeOrWeight: '1kg',
        each_size_value: 1,
        each_size_unit: 'kg',
        sale_unit_type: 'kg',
        total_content_value: 1,
        total_content_unit: 'kg',
        promoPrice: 5.95,
        originalPrice: 8.5,
        imageSubjectScope: 'representative_assortment',
        offerCardCropPath: sharedCrop
      })

      const op1Manifest = buildManifest(
        'batch-op1',
        {
          [oCatalog.batchOfferKey]: {
            batchOfferKey: oCatalog.batchOfferKey,
            decision: 'existing',
            matchedProductId: pExistingId,
            matchedDatabaseContext: 'PRODUCTION_UI',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any,
          [oTemp.batchOfferKey]: {
            batchOfferKey: oTemp.batchOfferKey,
            decision: 'temporary',
            temporaryId: 'temp_lurpak_400',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any,
          [oNonCat.batchOfferKey]: {
            batchOfferKey: oNonCat.batchOfferKey,
            decision: 'unresolved',
            operatorDecision: 'approved',
            confidence: 'high'
          } as any
        },
        {
          temp_lurpak_400: {
            temporaryId: 'temp_lurpak_400',
            brandKey: 'lurpak',
            brandNameEn: 'Lurpak',
            brandNameAr: 'لورباك',
            productNameEn: 'Lurpak Unsalted Butter 400g',
            productNameAr: 'زبدة لورباك غير مملحة 400 جم',
            variantOrFlavor: 'Unsalted',
            eachSizeValue: 400,
            eachSizeUnit: 'g',
            innerPackCount: 1,
            saleUnitType: 'piece',
            productForm: 'block',
            sourceOfferKeys: [oTemp.batchOfferKey],
            retailers: [UUID_LULU],
            operatorDecision: 'approved'
          } as any
        },
        {
          [oNonCat.batchOfferKey]: {
            batchOfferKey: oNonCat.batchOfferKey,
            decision: 'approved',
            category: 'loose_produce',
            updatedAt: new Date().toISOString()
          }
        }
      )

      const op1Res = await pubService.publishApprovedCatalogBatch({
        manifest: op1Manifest,
        offers: [oCatalog, oTemp, oNonCat],
        context: 'PRODUCTION_UI',
        operatorId: 'sec4-op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        idempotencyKey: 'sec4-op1'
      })
      expect(op1Res.success).toBe(true)
      expect(op1Res.createdProductsCount).toBe(1)
      expect(op1Res.insertedOffersCount).toBe(3)

      // Assert DB tables & view directly via SQL
      const op1JournalRows = await pg.client.query<{ table_name: string; mutation_type: string; post_state: any }>(
        `SELECT table_name, mutation_type, post_state FROM public.publication_journal_mutations WHERE publish_operation_id = $1 ORDER BY sequence_no`,
        [op1Res.publishOperationId]
      )
      expect(op1JournalRows.rows.some((r) => r.table_name === 'products' && r.mutation_type === 'insert')).toBe(true)
      expect(op1JournalRows.rows.filter((r) => r.table_name === 'offers' && r.mutation_type === 'insert').length).toBe(3)

      const storageOps1 = await pg.client.query<{ ownership_mode: string; storage_state: string }>(
        `SELECT ownership_mode, storage_state FROM public.publication_storage_operations WHERE publish_operation_id = $1`,
        [op1Res.publishOperationId]
      )
      expect(storageOps1.rows.filter((r) => r.ownership_mode === 'exclusive_created' && r.storage_state === 'committed').length).toBe(1)
      expect(storageOps1.rows.some((r) => r.ownership_mode === 'reused_existing')).toBe(true)

      const viewOp1 = await pg.client.query<{ source_offer_id: string; product_id: string | null }>(
        `SELECT source_offer_id, product_id::text FROM public.v_consumer_offers ORDER BY source_offer_id`
      )
      expect(viewOp1.rows.length).toBe(3)
      expect(viewOp1.rows.find((r) => r.source_offer_id === oNonCat.sourceOfferId)?.product_id).toBeNull()
      expect(viewOp1.rows.find((r) => r.source_offer_id === oCatalog.sourceOfferId)?.product_id).toBe(pExistingId)

      // Step 3-4: Price Update Op 2 (modifies oCatalog only) + inspect before/after JSONB snapshots
      const oCatalogUpdated = { ...oCatalog, promoPrice: 15.95 }
      const op2UpdateRes = await pubService.publishApprovedCatalogBatch({
        manifest: op1Manifest,
        offers: [oCatalogUpdated, oTemp, oNonCat],
        context: 'PRODUCTION_UI',
        operatorId: 'sec4-op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        enforceUpdateApproval: true,
        approvedUpdateSourceIds: [oCatalog.sourceOfferId!],
        idempotencyKey: 'sec4-op2-update'
      })
      expect(op2UpdateRes.updatedOffersCount).toBe(1)

      const updateJournal = await pg.client.query<{ pre_state: any; post_state: any }>(
        `SELECT pre_state, post_state FROM public.publication_journal_mutations WHERE publish_operation_id = $1 AND table_name = 'offers' AND mutation_type = 'update'`,
        [op2UpdateRes.publishOperationId]
      )
      expect(Number(updateJournal.rows[0].pre_state.offer_price)).toBe(17.95)
      expect(Number(updateJournal.rows[0].post_state.offer_price)).toBe(15.95)

      // Step 5-6: Identical repeat -> Op 3 NO-OP, zero journal mutations
      const op3NoopRes = await pubService.publishApprovedCatalogBatch({
        manifest: op1Manifest,
        offers: [oCatalogUpdated, oTemp, oNonCat],
        context: 'PRODUCTION_UI',
        operatorId: 'sec4-op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        idempotencyKey: 'sec4-op3-noop'
      })
      expect(op3NoopRes.noop).toBe(true)
      const noopMutations = await pg.client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM public.publication_journal_mutations WHERE publish_operation_id = $1`,
        [op3NoopRes.publishOperationId]
      )
      expect(Number(noopMutations.rows[0].c)).toBe(0)

      // Step 7-8: Undo selector skips Op 3 (noop) and targets Op 2 (price update); Undo Op 2 restores price to 17.95 leaving Op 1 rows intact
      const previewOp2 = await previewUndoLastPublish({ client: pg.client })
      expect(previewOp2.canUndo).toBe(true)
      expect(previewOp2.targetOperation?.publishOperationId).toBe(op2UpdateRes.publishOperationId)

      const undoOp2 = await undoLastPublish({
        client: pg.client,
        operatorId: 'sec4-op',
        reason: 'Revert price update Op 2',
        storageAdapter: storage
      })
      expect(undoOp2.success).toBe(true)
      expect(undoOp2.status).toBe('undone')

      const priceAfterUndo2 = await pg.client.query<{ offer_price: string }>(
        `SELECT offer_price::text FROM public.offers WHERE source_offer_id = $1`,
        [oCatalog.sourceOfferId]
      )
      expect(Number(priceAfterUndo2.rows[0].offer_price)).toBe(17.95)
      const countAfterUndo2 = await pg.client.query<{ c: string }>(`SELECT count(*)::text AS c FROM public.offers`)
      expect(Number(countAfterUndo2.rows[0].c)).toBe(3) // Op 1 completely intact!

      // Step 9-10: External edit to an Op 1 row blocks Undo of Op 1 cleanly; restoring blocks allows Op 1 Undo, removing temp product & exclusive crop while preserving P_EXISTING & sharedCrop!
      await pg.client.query(
        `UPDATE public.offers SET offer_price = 18.88 WHERE source_offer_id = $1`,
        [oTemp.sourceOfferId]
      )
      const blockedUndoOp1 = await undoLastPublish({
        client: pg.client,
        operatorId: 'sec4-op',
        reason: 'Should fail due to external edit',
        storageAdapter: storage
      })
      expect(blockedUndoOp1.status).toBe('undo_blocked')

      // Revert external test mutation and run clean Undo of Op 1
      await pg.client.query(
        `UPDATE public.offers SET offer_price = 19.50 WHERE source_offer_id = $1`,
        [oTemp.sourceOfferId]
      )
      const undoOp1 = await undoLastPublish({
        client: pg.client,
        operatorId: 'sec4-op',
        reason: 'Clean revert Op 1',
        storageAdapter: storage
      })
      expect(undoOp1.success).toBe(true)
      expect(undoOp1.status).toBe('undone')
      expect(storage.storedObjects.size).toBe(1) // sharedCrop preserved, exclusiveCrop deleted!

      const remainingOffers = await pg.client.query<{ c: string }>(`SELECT count(*)::text AS c FROM public.offers`)
      const remainingProds = await pg.client.query<{ id: string }>(`SELECT id::text FROM public.products`)
      expect(Number(remainingOffers.rows[0].c)).toBe(0)
      expect(remainingProds.rows.map((r) => r.id)).toEqual([pExistingId]) // Pre-existing product preserved!
    } finally {
      await pg.client.end?.()
    }
  }, 30000)

  it('SEC-5: Verifies operational recovery (restart durability, post-commit timeout replay, staging crash rollback, undo_cleanup_pending retry, repeat undo)', async () => {
    const tmp = makeTempDir('fix08-sec5-')
    const pg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    try {
      const pRes = await pg.client.query<{ id: string }>(
        `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status)
         VALUES ('Nido 900g', 'نيدو 900 جم', 'Nestle', 900, 'g', 1, 'verified')
         RETURNING id::text`
      )
      const prodId = pRes.rows[0].id
      const crop1 = await makeCropImage(path.join(tmp, 'rec1.webp'), { r: 80, g: 160, b: 200 })
      const cropCrash = await makeCropImage(path.join(tmp, 'crash.webp'), { r: 250, g: 10, b: 10 })
      const storage = createInMemoryStorageAdapter()

      const offer1 = buildOffer({
        batchOfferKey: 'sec5:l1:1:o1',
        sourceOfferId: 'doc_sec5:p001:i001:s01',
        titleEn: 'Nido 900g',
        titleAr: 'نيدو 900 جم',
        brand: 'Nestle',
        brandEn: 'Nestle',
        each_size_value: 900,
        each_size_unit: 'g',
        total_content_value: 900,
        total_content_unit: 'g',
        sizeOrWeight: '900g',
        offerCardCropPath: crop1
      })
      const manifest1 = buildManifest('sec5-b1', {
        [offer1.batchOfferKey]: {
          batchOfferKey: offer1.batchOfferKey,
          decision: 'existing',
          matchedProductId: prodId,
          matchedDatabaseContext: 'PRODUCTION_UI',
          operatorDecision: 'approved',
          confidence: 'high'
        } as any
      })

      // 5.1 & 5.2 Timeout after DB commit before client ack + service restart -> replay via idempotencyKey returns original result cleanly
      const svcBeforeRestart = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'production'))
      const committedRes = await svcBeforeRestart.publishApprovedCatalogBatch({
        manifest: manifest1,
        offers: [offer1],
        context: 'PRODUCTION_UI',
        operatorId: 'sec5-op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        idempotencyKey: 'timeout-lost-ack-key-01'
      })
      expect(committedRes.success).toBe(true)

      const svcAfterRestart = new CatalogPublicationService(new VerifiedMatchCacheService(tmp, 'production'))
      const replayAfterTimeout = await svcAfterRestart.publishApprovedCatalogBatch({
        manifest: manifest1,
        offers: [offer1],
        context: 'PRODUCTION_UI',
        operatorId: 'sec5-op',
        pgClient: pg.client,
        storageAdapter: storage,
        allowIsolatedTestDb: true,
        operatorAuthorizedProductionPublish: true,
        idempotencyKey: 'timeout-lost-ack-key-01'
      })
      expect(replayAfterTimeout.idempotentReplay).toBe(true)
      expect(replayAfterTimeout.publishOperationId).toBe(committedRes.publishOperationId)

      const histAfterRestart = await listPublicationHistory({ client: pg.client })
      expect(histAfterRestart.some((h) => h.publishOperationId === committedRes.publishOperationId)).toBe(true)

      // 5.3 Crash during image staging of a new batch -> zero DB mutations, pre-existing storage object intact, nothing orphaned
      const offerCrash = buildOffer({
        batchOfferKey: 'sec5:l1:2:crash',
        sourceOfferId: 'doc_sec5_crash:p002:i001:s01',
        supermarketId: '00000000-0000-4000-a000-000000000000', // triggers FK rollback after cropCrash is staged
        titleEn: 'Nido 900g',
        titleAr: 'نيدو 900 جم',
        brand: 'Nestle',
        brandEn: 'Nestle',
        each_size_value: 900,
        each_size_unit: 'g',
        total_content_value: 900,
        total_content_unit: 'g',
        sizeOrWeight: '900g',
        offerCardCropPath: cropCrash
      })
      await expect(
        svcAfterRestart.publishApprovedCatalogBatch({
          manifest: buildManifest('sec5-crash', {
            [offerCrash.batchOfferKey]: {
              batchOfferKey: offerCrash.batchOfferKey,
              decision: 'existing',
              matchedProductId: prodId,
              matchedDatabaseContext: 'PRODUCTION_UI',
              operatorDecision: 'approved',
              confidence: 'high'
            } as any
          }),
          offers: [offerCrash],
          context: 'PRODUCTION_UI',
          operatorId: 'sec5-op',
          pgClient: pg.client,
          storageAdapter: storage,
          allowIsolatedTestDb: true,
          operatorAuthorizedProductionPublish: true,
          idempotencyKey: 'crash-during-staging-key'
        })
      ).rejects.toThrow(/Transaction rolled back/i)
      expect(storage.storedObjects.size).toBe(1) // Only crop1 from committedRes remains!

      // 5.4 Failure after DB reversal before storage cleanup -> undo_cleanup_pending survives restart & retry recovers cleanly
      const failDeleteAdapter = {
        ...storage,
        deleteObjects: async () => ({ error: 'Network partition before storage delete' })
      }
      const undoInterrupted = await undoLastPublish({
        client: pg.client,
        publishOperationId: committedRes.publishOperationId,
        operatorId: 'sec5-op',
        reason: 'Simulate crash before storage delete',
        storageAdapter: failDeleteAdapter
      })
      expect(undoInterrupted.success).toBe(true)
      expect(undoInterrupted.status).toBe('undo_cleanup_pending')
      expect(storage.storedObjects.size).toBe(1) // Storage object still present pending retry

      const detailsBeforeRetry = await getPublicationOperationDetails({
        client: pg.client,
        publishOperationId: committedRes.publishOperationId!
      })
      expect(detailsBeforeRetry.operation?.status).toBe('undo_cleanup_pending')

      const retryRes = await retryUndoStorageCleanup({
        client: pg.client,
        publishOperationId: committedRes.publishOperationId!,
        storageAdapter: storage
      })
      expect(retryRes.status).toBe('undone')
      expect(storage.storedObjects.size).toBe(0)

      // 5.5 Repeated Undo invocation -> idempotent alreadyUndone=true, zero double-delete errors
      const secondUndo = await undoLastPublish({
        client: pg.client,
        publishOperationId: committedRes.publishOperationId,
        operatorId: 'sec5-op',
        reason: 'Double-click Undo retry',
        storageAdapter: storage
      })
      expect(secondUndo.alreadyUndone).toBe(true)
    } finally {
      await pg.client.end?.()
    }
  }, 30000)
})
