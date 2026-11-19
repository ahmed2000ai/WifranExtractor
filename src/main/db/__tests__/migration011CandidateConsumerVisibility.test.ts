import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { BatchOrchestrationService } from '../../batch/batchOrchestrationService'
import { CatalogMatchingOrchestrator } from '../../batch/catalogMatchingOrchestrator'
import { CatalogPublicationService } from '../catalogPublicationService'
import { VerifiedMatchCacheService } from '../verifiedMatchCacheService'
import { createIsolatedWifranPostgres } from './isolatedPostgresHarness008'
import { listPublicationHistory, undoLastPublish } from '../publicationJournalAndUndoService'
import { createInMemoryStorageAdapter } from '../../storage/stagedStorageLifecycleService'

const CACHED_BATCH_ID = 'batch-2026-11-15T14-18-37-692853'
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

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

async function prepareCorrectedCarrefourFixture() {
  const repoBatchDir = path.join(process.cwd(), 'Extracts', 'batches', CACHED_BATCH_ID)
  const repoWorkspaceDir = path.join(process.cwd(), 'Extracts', 'carrefour-62800235-jeddah')
  const repoManifestFile = path.join(repoBatchDir, 'batch-manifest.json')
  const repoDraftFile = path.join(repoWorkspaceDir, 'staged-draft.json')

  const origManifestSha = sha256File(repoManifestFile)
  const origDraftSha = sha256File(repoDraftFile)

  const tmp = makeTempDir('wifran-mig011-carrefour-')
  const tmpBatchesDir = path.join(tmp, 'batches')
  const tmpBatchDir = path.join(tmpBatchesDir, CACHED_BATCH_ID)
  const tmpWorkspaceDir = path.join(tmp, 'carrefour-62800235-jeddah')
  const tmpCacheDir = path.join(tmp, 'cache')

  fs.cpSync(repoBatchDir, tmpBatchDir, { recursive: true })
  fs.cpSync(repoWorkspaceDir, tmpWorkspaceDir, { recursive: true })

  const repointJsonFile = (filePath: string) => {
    if (!fs.existsSync(filePath)) return
    const replaceRecursive = (node: unknown): unknown => {
      if (typeof node === 'string') {
        return node
          .split(repoWorkspaceDir).join(tmpWorkspaceDir)
          .split(repoBatchDir).join(tmpBatchDir)
      }
      if (Array.isArray(node)) return node.map(replaceRecursive)
      if (node && typeof node === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          out[k] = replaceRecursive(v)
        }
        return out
      }
      return node
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    fs.writeFileSync(filePath, JSON.stringify(replaceRecursive(parsed), null, 2), 'utf8')
  }

  repointJsonFile(path.join(tmpBatchDir, 'batch-manifest.json'))
  repointJsonFile(path.join(tmpBatchDir, 'catalog-matching', 'matching-proposals.json'))
  repointJsonFile(path.join(tmpWorkspaceDir, 'staged-draft.json'))

  const batchService = new BatchOrchestrationService(tmpBatchesDir)
  const matchingOrchestrator = new CatalogMatchingOrchestrator(
    new VerifiedMatchCacheService(tmpCacheDir, 'development'),
    undefined,
    undefined,
    undefined,
    tmpBatchesDir
  )
  const pubService = new CatalogPublicationService(
    new VerifiedMatchCacheService(tmpCacheDir, 'development')
  )

  const initialOffers = await batchService.getUnifiedBatchOffers(CACHED_BATCH_ID)
  const offer006 = initialOffers.find((o) => o.sourceOfferId.endsWith('_006'))!
  await batchService.updateBatchOfferFields({
    batchId: CACHED_BATCH_ID,
    batchOfferKey: offer006.batchOfferKey,
    orchestrator: matchingOrchestrator,
    patch: {
      titleAr: 'أولايت زيت كانولا ١،٥ لتر × ٢',
      revalidate: true
    }
  })

  const offers = await batchService.getUnifiedBatchOffers(CACHED_BATCH_ID)
  const manifest = matchingOrchestrator.loadManifest(CACHED_BATCH_ID)!

  // Mark offer 001 explicitly operator-verified so we have 1 verified_linked + 9 candidate_pending_review
  const offer001 = offers.find((o) => o.sourceOfferId.endsWith('_001'))!
  const prop001 = manifest.proposals[offer001.batchOfferKey]
  const temp001Id = prop001.temporaryId!
  manifest.temporaryProducts[temp001Id].operatorDecision = 'approved'
  prop001.operatorDecision = 'approved'

  return {
    repoManifestFile,
    repoDraftFile,
    origManifestSha,
    origDraftSha,
    batchService,
    offers,
    manifest,
    offer001,
    offer006,
    temp001Id,
    pubService
  }
}

describe('Migration 011 — WIFRAN MVP Candidate Consumer Visibility & Brand Fallback', { timeout: 45000 }, () => {
  it('compares Before (001-010) vs After (001-011) Carrefour Page 23 consumer DTO visibility, RPC, and brand fallback', async () => {
    const fixture = await prepareCorrectedCarrefourFixture()

    // --- BEFORE: Migrations 001..010 ---
    const beforePg = await createIsolatedWifranPostgres({ upToMigration: 10 })
    const beforeStorage = createInMemoryStorageAdapter()
    let beforeRows: any[] = []
    try {
      const pubBefore = await fixture.pubService.publishApprovedCatalogBatch({
        manifest: fixture.manifest,
        offers: fixture.offers,
        context: 'DEVELOPMENT_TEST',
        pgClient: beforePg.client,
        allowIsolatedTestDb: true,
        enableImageUpload: true,
        storageAdapter: beforeStorage,
        operatorId: 'mig011_before_check'
      })
      expect(pubBefore.success).toBe(true)
      expect(pubBefore.publishedOffersCount).toBe(10)

      const resBefore = await beforePg.client.query<any>(
        `SELECT source_offer_id, product_id, exact_identity_status, brand_id, brand_name_en, brand_candidate_text,
                title_en, title_ar, each_size_value, each_size_unit, offer_price, currency,
                image_url, thumbnail_url, display_image_url, display_image_kind,
                card_image_upload_state, thumbnail_upload_state, consumer_contract_v2
         FROM public.v_consumer_offers
         ORDER BY source_offer_id`
      )
      beforeRows = resBefore.rows
      expect(beforeRows).toHaveLength(10)

      const verifiedSourceIdBefore = pubBefore.sourceOfferIdByKey![fixture.offer001.batchOfferKey]
      const beforeVerified = beforeRows.filter((r) => r.product_id !== null)
      const beforeCandidates = beforeRows.filter((r) => r.product_id === null)
      expect(beforeVerified).toHaveLength(1)
      expect(beforeVerified[0].source_offer_id).toBe(verifiedSourceIdBefore)
      expect(beforeCandidates).toHaveLength(9)
      for (const c of beforeCandidates) {
        expect(c.image_url).toBeNull()
        expect(c.display_image_url).toBeNull()
        expect(c.display_image_kind).toBeNull()
        expect(c.card_image_upload_state).toBe('pending')
        expect(c.brand_name_en).toBeNull()
      }
    } finally {
      await beforePg.client.end?.()
    }

    // --- AFTER: Migrations 001..011 ---
    const afterPg = await createIsolatedWifranPostgres()
    const afterStorage = createInMemoryStorageAdapter()
    try {
      // Exact 98-column count check on v_consumer_offers
      const colCountRes = await afterPg.client.query<{ cnt: number }>(
        `SELECT count(*)::int AS cnt
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'`
      )
      expect(colCountRes.rows[0].cnt).toBe(98)

      const pubAfter = await fixture.pubService.publishApprovedCatalogBatch({
        manifest: fixture.manifest,
        offers: fixture.offers,
        context: 'DEVELOPMENT_TEST',
        pgClient: afterPg.client,
        allowIsolatedTestDb: true,
        enableImageUpload: true,
        storageAdapter: afterStorage,
        operatorId: 'mig011_after_check'
      })
      expect(pubAfter.success).toBe(true)
      expect(pubAfter.publishedOffersCount).toBe(10)

      const resAfter = await afterPg.client.query<any>(
        `SELECT o_src.catalog_match_status, p_src.verification_status,
                v.source_offer_id, v.product_id, v.exact_identity_status,
                v.brand_id, v.brand_name_ar, v.brand_name_en, v.brand_state, v.brand_candidate_text,
                v.title_en, v.title_ar, v.each_size_value, v.each_size_unit, v.offer_price, v.currency,
                v.image_url, v.thumbnail_url, v.display_image_url, v.display_image_kind,
                v.card_image_upload_state, v.thumbnail_upload_state, v.consumer_contract_v2
         FROM public.v_consumer_offers v
         JOIN public.offers o_src ON o_src.id = v.id
         JOIN public.products p_src ON p_src.id = o_src.product_id
         ORDER BY v.source_offer_id`
      )
      const afterRows = resAfter.rows
      expect(afterRows).toHaveLength(10)

      // Distinct products for all 10 single-SKU Carrefour Page 23 offers (no cross-product mixup)
      const distinctProductIds = new Set(afterRows.map((r: any) => String(r.product_id)))
      expect(distinctProductIds.size).toBe(10)

      for (const r of afterRows) {
        expect(r.product_id).not.toBeNull()
        expect(String(r.image_url || '')).toContain('/product-images/products/sha256/')
        expect(r.thumbnail_url).toBe(r.image_url)
        expect(r.display_image_url).toBe(r.image_url)
        expect(r.display_image_kind).toBe('exact_product')
        expect(r.card_image_upload_state).toBe('uploaded')
        expect(r.thumbnail_upload_state).toBe('uploaded')
        expect(r.currency).toBe('SAR')
        expect(Number(r.offer_price)).toBeGreaterThan(0)
        expect(r.title_en).toBeTruthy()
        expect(r.title_ar).toBeTruthy()

        // No private crop paths leaked in consumer_contract_v2 (null when contract_v2 not written)
        if (r.consumer_contract_v2 !== null) {
          const serializedContract = JSON.stringify(r.consumer_contract_v2)
          expect(serializedContract).toContain(r.image_url)
          expect(serializedContract).not.toContain('Extracts')
          expect(serializedContract).not.toContain('offer-images')
          expect(serializedContract).not.toContain('C:')
          expect(serializedContract).not.toContain('file://')
        }

        // Brand fallback without fabricating brand_id UUID
        expect(r.brand_id).toBeNull()
        expect(r.brand_name_en).toBeTruthy()
        expect(r.brand_candidate_text).toBe(r.brand_name_en)

        const verifiedSourceIdAfter = pubAfter.sourceOfferIdByKey![fixture.offer001.batchOfferKey]
        if (r.source_offer_id === verifiedSourceIdAfter) {
          expect(r.catalog_match_status).toBe('verified_linked')
          expect(r.verification_status).toBe('verified')
          expect(r.exact_identity_status).toBe('verified_sku')
        } else {
          expect(r.catalog_match_status).toBe('candidate_pending_review')
          expect(r.verification_status).toBe('candidate')
          expect(r.exact_identity_status).toBe('unresolved')
        }
      }

      // Specific spot checks for O-Lite 006
      const oLiteSourceIdAfter = pubAfter.sourceOfferIdByKey![fixture.offer006.batchOfferKey]
      const oLiteRow = afterRows.find((r: any) => r.source_offer_id === oLiteSourceIdAfter)!
      expect(oLiteRow.title_en).toBe('O-LITE CANOLA OIL 1.5L X2')
      expect(oLiteRow.brand_name_en).toBe('O-Lite')
      expect(Number(oLiteRow.each_size_value)).toBe(1.5)
      expect(oLiteRow.each_size_unit).toBe('l')
      expect(Number(oLiteRow.offer_price)).toBe(36.99)

      // Parameterized RPC as anon role exposes all 10 offers for the leaflet validity window
      const sampleOfferDates = await afterPg.client.query<{ offer_start_date: string; offer_end_date: string; city_id: string | null }>(
        `SELECT offer_start_date::text, offer_end_date::text, city_id
         FROM public.offers
         ORDER BY source_offer_id
         LIMIT 1`
      )
      const { offer_start_date, city_id } = sampleOfferDates.rows[0]
      await afterPg.db.exec('SET ROLE anon;')
      try {
        const rpcRes = await afterPg.client.query<any>(
          `SELECT source_offer_id, product_id, exact_identity_status, image_url, display_image_kind, brand_name_en
           FROM public.get_consumer_offers_for_shopping_date($1::date, $2::text, NULL)
           ORDER BY source_offer_id`,
          [offer_start_date, city_id]
        )
        expect(rpcRes.rows).toHaveLength(10)
        expect(rpcRes.rows.every((r: any) => r.product_id !== null && r.display_image_kind === 'exact_product')).toBe(true)
      } finally {
        await afterPg.db.exec('RESET ROLE;')
      }

      // Duplicate prevention remains intact
      await fixture.batchService.recordSelectivePublicationOutcome({
        batchId: CACHED_BATCH_ID,
        databaseContext: 'DEVELOPMENT_TEST',
        publishOperationId: pubAfter.publishOperationId!,
        publishedBatchOfferKeys: pubAfter.publishedBatchOfferKeys ?? [],
        deferredBatchOfferKeys: pubAfter.deferredBatchOfferKeys ?? [],
        insertedOffersCount: pubAfter.insertedOffersCount ?? 0,
        updatedOffersCount: pubAfter.updatedOffersCount ?? 0,
        sourceOfferIdByKey: pubAfter.sourceOfferIdByKey,
        publishedOfferIdByKey: pubAfter.publishedOfferIdByKey,
        productIdByKey: pubAfter.productIdByKey
      })
      const retryOffers = await fixture.batchService.getUnifiedBatchOffers(CACHED_BATCH_ID)
      const dupRes = await fixture.pubService.publishApprovedCatalogBatch({
        manifest: fixture.manifest,
        offers: retryOffers,
        context: 'DEVELOPMENT_TEST',
        pgClient: afterPg.client,
        allowIsolatedTestDb: true,
        enableImageUpload: true,
        storageAdapter: afterStorage,
        operatorId: 'mig011_dup_check'
      })
      expect(dupRes.publishedOffersCount).toBe(0)
      expect(dupRes.skippedDuplicatesCount).toBe(10)
      const offerCountAfterDup = await afterPg.client.query<{ cnt: number }>('SELECT count(*)::int AS cnt FROM public.offers')
      expect(offerCountAfterDup.rows[0].cnt).toBe(10)
    } finally {
      await afterPg.client.end?.()
    }

    expect(sha256File(fixture.repoManifestFile)).toBe(fixture.origManifestSha)
    expect(sha256File(fixture.repoDraftFile)).toBe(fixture.origDraftSha)
  })

  it('strictly masks disputed, unresolved, ambiguous, rejected, and inactive products in v_consumer_offers and preserves shared assets on Undo', async () => {
    const { db, client } = await createIsolatedWifranPostgres()
    const storage = createInMemoryStorageAdapter()

    try {
      // Seed verified, candidate, rejected, inactive products + approved primary product_images
      const prodRes = await client.query<{ id: string; canonical_product_key: string }>(
        `INSERT INTO public.products (
           name_en, name_ar, brand_name, canonical_product_key,
           verification_status, is_active, default_image_url
         )
         VALUES
           ('Verified Shared Product', 'منتج موثق', 'VerifiedBrand', 'key-verified', 'verified', true, 'https://example.supabase.co/storage/v1/object/public/product-images/shared.webp'),
           ('Rejected Product', 'منتج مرفوض', 'RejectedBrand', 'key-rejected', 'rejected', true, 'https://example.supabase.co/storage/v1/object/public/product-images/rejected.webp'),
           ('Inactive Candidate Product', 'منتج مرشح معطل', 'InactiveBrand', 'key-inactive', 'candidate', false, 'https://example.supabase.co/storage/v1/object/public/product-images/inactive.webp'),
           ('Active Candidate Product', 'منتج مرشح نشط', 'CandBrand', 'key-cand-active', 'candidate', true, 'https://example.supabase.co/storage/v1/object/public/product-images/cand-active.webp')
         RETURNING id::text, canonical_product_key`
      )
      const prodByKey = Object.fromEntries(prodRes.rows.map((r) => [r.canonical_product_key, r.id]))

      await client.query(
        `INSERT INTO public.product_images (
           product_id, role, approval_status, rights_basis, storage_bucket, storage_object_path, public_url,
           mime_type, byte_size, content_sha256, source_url, normalized_source_url
         )
         VALUES
           ($1::bigint, 'primary', 'approved', 'generated_product_crop', 'product-images', 'products/shared.webp', 'https://example.supabase.co/storage/v1/object/public/product-images/shared.webp', 'image/webp', 120, 'sha-shared', 'https://example.supabase.co/storage/v1/object/public/product-images/shared.webp', 'products/shared.webp'),
           ($2::bigint, 'primary', 'approved', 'generated_product_crop', 'product-images', 'products/rejected.webp', 'https://example.supabase.co/storage/v1/object/public/product-images/rejected.webp', 'image/webp', 120, 'sha-rejected', 'https://example.supabase.co/storage/v1/object/public/product-images/rejected.webp', 'products/rejected.webp'),
           ($3::bigint, 'primary', 'approved', 'generated_product_crop', 'product-images', 'products/inactive.webp', 'https://example.supabase.co/storage/v1/object/public/product-images/inactive.webp', 'image/webp', 120, 'sha-inactive', 'https://example.supabase.co/storage/v1/object/public/product-images/inactive.webp', 'products/inactive.webp'),
           ($4::bigint, 'primary', 'approved', 'generated_product_crop', 'product-images', 'products/cand-active.webp', 'https://example.supabase.co/storage/v1/object/public/product-images/cand-active.webp', 'image/webp', 120, 'sha-cand-active', 'https://example.supabase.co/storage/v1/object/public/product-images/cand-active.webp', 'products/cand-active.webp')`,
        [prodByKey['key-verified'], prodByKey['key-rejected'], prodByKey['key-inactive'], prodByKey['key-cand-active']]
      )

      const UUID_CARREFOUR = 'c2cc16c2-0006-4444-b000-c00000000006'
      await client.query(
        `INSERT INTO public.offers (
           id, source_offer_id, supermarket_id, product_id, catalog_match_status, exact_identity_status,
           title_ar, title_en, offer_price, offer_start_date, offer_end_date, status, contract_v2
         )
         VALUES
           (gen_random_uuid(), 'MASK-CONFLICT', $5, $1::bigint, 'conflict_needs_review', 'disputed', 'متنازع', 'Conflict', 10, CURRENT_DATE - 1, CURRENT_DATE + 5, 'published', NULL),
           (gen_random_uuid(), 'MASK-UNRESOLVED', $5, $1::bigint, 'unresolved', 'unresolved', 'غير محلول', 'Unresolved', 10, CURRENT_DATE - 1, CURRENT_DATE + 5, 'published', NULL),
           (gen_random_uuid(), 'MASK-AMBIGUOUS', $5, $1::bigint, 'excluded_ambiguous', 'ambiguous', 'غامض', 'Ambiguous', 10, CURRENT_DATE - 1, CURRENT_DATE + 5, 'published', NULL),
           (gen_random_uuid(), 'MASK-REJECTED-CAND', $5, $2::bigint, 'candidate_pending_review', 'unresolved', 'مرفوض مرشح', 'Rejected Cand', 10, CURRENT_DATE - 1, CURRENT_DATE + 5, 'published', NULL),
           (gen_random_uuid(), 'MASK-REJECTED-VERIFIED', $5, $2::bigint, 'verified_linked', 'verified_sku', 'مرفوض موثق', 'Rejected Verified', 10, CURRENT_DATE - 1, CURRENT_DATE + 5, 'published', NULL),
           (gen_random_uuid(), 'MASK-INACTIVE-CAND', $5, $3::bigint, 'candidate_pending_review', 'unresolved', 'معطل مرشح', 'Inactive Cand', 10, CURRENT_DATE - 1, CURRENT_DATE + 5, 'published', NULL),
           (gen_random_uuid(), 'VISIBLE-CAND', $5, $4::bigint, 'candidate_pending_review', 'unresolved', 'مرشح ظاهر', 'Visible Cand', 12.5, CURRENT_DATE - 1, CURRENT_DATE + 5, 'published', '{"assets":{"offer_card":{"storage_bucket":"offer-images","storage_object_path":"private/leak.webp","upload_state":"uploaded"}}}'::jsonb)`,
        [prodByKey['key-verified'], prodByKey['key-rejected'], prodByKey['key-inactive'], prodByKey['key-cand-active'], UUID_CARREFOUR]
      )

      const viewRes = await client.query<any>(
        `SELECT source_offer_id, product_id, exact_identity_status, image_url, display_image_kind, brand_name_en, consumer_contract_v2
         FROM public.v_consumer_offers
         ORDER BY source_offer_id`
      )
      const byId = Object.fromEntries(viewRes.rows.map((r) => [r.source_offer_id, r]))

      for (const maskedId of [
        'MASK-CONFLICT',
        'MASK-UNRESOLVED',
        'MASK-AMBIGUOUS',
        'MASK-REJECTED-CAND',
        'MASK-REJECTED-VERIFIED',
        'MASK-INACTIVE-CAND'
      ]) {
        expect(byId[maskedId].product_id).toBeNull()
        expect(byId[maskedId].image_url).toBeNull()
        expect(byId[maskedId].display_image_kind).toBeNull()
        expect(byId[maskedId].brand_name_en).toBeNull()
      }

      expect(String(byId['VISIBLE-CAND'].product_id)).toBe(prodByKey['key-cand-active'])
      expect(byId['VISIBLE-CAND'].exact_identity_status).toBe('unresolved')
      expect(byId['VISIBLE-CAND'].display_image_kind).toBe('exact_product')
      expect(byId['VISIBLE-CAND'].brand_name_en).toBe('CandBrand')
      expect(byId['VISIBLE-CAND'].consumer_contract_v2?.assets?.offer_card?.delivery_url).toBe(
        'https://example.supabase.co/storage/v1/object/public/product-images/cand-active.webp'
      )
      expect(JSON.stringify(byId['VISIBLE-CAND'].consumer_contract_v2)).not.toContain('offer-images')
      expect(JSON.stringify(byId['VISIBLE-CAND'].consumer_contract_v2)).not.toContain('private/leak.webp')

      // Shared asset Undo check: publish a new offer referencing an existing shared asset key in storage
      const sharedBucketPath = 'product-images/products/shared-asset.webp'
      await storage.uploadObject({
        bucket: 'product-images',
        objectPath: 'products/shared-asset.webp',
        buffer: Buffer.from('shared-image-bytes'),
        contentType: 'image/webp'
      })
      const sharedPublicUrl = storage.getPublicUrl('product-images', 'products/shared-asset.webp')

      const opId = '11111111-1111-4111-8111-111111111111'
      await client.query(
        `INSERT INTO public.publication_operations (
           publish_operation_id, idempotency_key, payload_fingerprint, target_project_ref,
           environment_context, batch_id, operator_id, status, undo_eligible
         )
         VALUES ($1::uuid, 'idem-mig011-undo-test', 'fp-mig011-undo-test', 'isolated-test', 'ISOLATED_TEST', 'batch-undo-test', 'mig011_undo_test', 'completed', true)`,
        [opId]
      )
      const undoProd = await client.query<{ id: string }>(
        `INSERT INTO public.products (name_en, name_ar, canonical_product_key, verification_status, default_image_url)
         VALUES ('Undo Only Prod', 'منتج التراجع', 'key-undo-only', 'candidate', $1)
         RETURNING id::text`,
        [sharedPublicUrl]
      )
      await client.query(
        `INSERT INTO public.publication_journal_mutations (
           publish_operation_id, sequence_no, table_name, record_pk, mutation_type,
           pre_state, post_state, reused_existing
         )
         VALUES ($1::uuid, 1, 'products', $2, 'insert', NULL, '{}'::jsonb, false)`,
        [opId, undoProd.rows[0].id]
      )
      // Mark shared object ownership_mode = 'reused_existing' and exclusive card crop ownership_mode = 'exclusive_created'
      await storage.uploadObject({
        bucket: 'offer-images',
        objectPath: 'offers/undo-exclusive-card.webp',
        buffer: Buffer.from('exclusive-card'),
        contentType: 'image/webp'
      })
      await client.query(
        `INSERT INTO public.publication_storage_operations (
           publish_operation_id, bucket, object_path, ownership_mode, storage_state
         )
         VALUES
           ($1::uuid, 'product-images', 'products/shared-asset.webp', 'reused_existing', 'committed'),
           ($1::uuid, 'offer-images', 'offers/undo-exclusive-card.webp', 'exclusive_created', 'committed')`,
        [opId]
      )

      const undoRes = await undoLastPublish({
        client,
        publishOperationId: opId,
        storageAdapter: storage,
        operatorId: 'mig011_undo_test',
        reason: 'Verify shared asset preservation'
      })
      expect(undoRes.success).toBe(true)
      expect(storage.storedObjects.has(sharedBucketPath)).toBe(true)
      expect(storage.storedObjects.has('offer-images/offers/undo-exclusive-card.webp')).toBe(false)

      const hist = await listPublicationHistory({ client })
      expect(hist.some((h) => h.publishOperationId === opId && h.status === 'undone')).toBe(true)
    } finally {
      await db.close()
    }
  })
})
