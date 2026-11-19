/**
 * WIFRAN-EXTRACTOR-IDENTITY-005I
 * Offline End-to-End Integration Suite for Hybrid V3 Extraction, Cropping,
 * Metadata Safety, Operator Review, Cancel/Resume, and Guarded Publication.
 *
 * Strictly offline: replays saved `005H-B1` and `005H-B2` raw archives on the
 * real `Panda_Test/pages/page.2.png` image with mock DB/Storage clients.
 * Zero paid Gemini calls. Zero live Supabase writes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import sharp from 'sharp';
import {
  BatchOrchestrationService
} from '../../batch/batchOrchestrationService';
import {
  HYBRID_EXTRACTION_DEFAULT_FLAGS,
  type HybridExtractionProvider
} from '../../../shared/types/hybridExtractionV3';
import type { MatchingRunManifest } from '../../../shared/types/catalogMatching';
import { BrandGroupingService } from '../../db/brandGroupingService';
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService';
import { CatalogPublicationService } from '../../db/catalogPublicationService';

const PANDA_PAGE_2_PNG = path.join(process.cwd(), 'Extracts', 'Panda_Test', 'pages', 'page.2.png');
const B1_PANDA_PAGE2_RAW = path.join(
  process.cwd(),
  'Extracts',
  'pilot_v3_005h_b1',
  'raw',
  '8dd795e5f3744a829c6e7853434d0b2ccdbf53d1e9c711a5288fdf7bdd3185a9_page.raw.json'
);
const B2_RAW_DIR = path.join(process.cwd(), 'Extracts', 'pilot_v3_005h_b2', 'raw');

function loadParsedArchive(filePath: string): any {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return raw.parsedResponse || raw;
}

function findB2Raw(prefix: string): any {
  const match = fs.readdirSync(B2_RAW_DIR).find((f) => f.startsWith(prefix));
  if (!match) throw new Error(`Missing saved B2 archive with prefix ${prefix}`);
  return loadParsedArchive(path.join(B2_RAW_DIR, match));
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005I: Hybrid V3 End-to-End Integration', () => {
  let tmpRoot: string;
  let batchesDir: string;
  let batchService: BatchOrchestrationService;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-005i-e2e-'));
    batchesDir = path.join(tmpRoot, 'batches');
    batchService = new BatchOrchestrationService(batchesDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup lock on Windows
    }
  });

  it('keeps HYBRID_EXTRACTION_DEFAULT_FLAGS disabled by default and blocks unauthorized Hybrid V3 runs', async () => {
    expect(HYBRID_EXTRACTION_DEFAULT_FLAGS.enabledByDefault).toBe(false);
    expect(HYBRID_EXTRACTION_DEFAULT_FLAGS.enableHybridOrchestration).toBe(false);
    expect(HYBRID_EXTRACTION_DEFAULT_FLAGS.allowDatabaseWrites).toBe(false);

    const ws = path.join(tmpRoot, 'ws_unauth');
    fs.mkdirSync(path.join(ws, 'pages'), { recursive: true });
    fs.copyFileSync(PANDA_PAGE_2_PNG, path.join(ws, 'pages', 'page.1.png'));
    const dummyPdf = path.join(tmpRoot, 'scan_01.pdf');
    fs.writeFileSync(dummyPdf, '%PDF-1.4 dummy', 'utf8');

    const manifest = await batchService.createBatch({
      files: [{ path: dummyPdf, name: 'scan_01.pdf', pageCount: 1, workspacePath: ws }],
      extractionPipelineMode: 'hybrid_v3'
    });

    const result = await batchService.startBatchExtraction(manifest.batchId, {
      skipPdfRenderIfPagesExist: true
      // Intentionally omit hybridV3ExplicitAuthorization & hybridV3FeatureEnabled
    });

    expect(result.status).toBe('failed');
    expect(result.leaflets[0].error).toContain('HYBRID_V3_NOT_AUTHORIZED');
  });

  it('does NOT guess retailer/dates or default locationScope="national" on uninformative filenames, and propagates verified metadata', async () => {
    const dummyPdf = path.join(tmpRoot, 'scan_batch_01.pdf');
    fs.writeFileSync(dummyPdf, '%PDF-1.4 generic scanned leaflet', 'utf8');

    const manifest = await batchService.createBatch({
      files: [{ path: dummyPdf, name: 'scan_batch_01.pdf', pageCount: 2, workspacePath: path.join(tmpRoot, 'ws_meta') }],
      extractionPipelineMode: 'hybrid_v3'
    });

    const leaf = manifest.leaflets[0];
    expect(leaf.metadata.supermarketId).toBeNull();
    expect(leaf.metadata.locationScope).toBeNull();
    expect(leaf.metadata.offerStartDate).toBeNull();
    expect(leaf.metadata.offerEndDate).toBeNull();
    expect(leaf.metadata.verified).toBe(false);

    const updated = await batchService.updateLeafletMetadata({
      batchId: manifest.batchId,
      leafletId: leaf.leafletId,
      operatorId: 'uat_operator',
      verified: true,
      metadata: {
        supermarketId: 'panda-retail-id',
        supermarketName: 'Panda',
        leafletTitle: 'Midweek Fresh & Grocery',
        locationScope: 'city',
        cityId: 'city-jeddah-id',
        locationLabel: 'Jeddah',
        locationSlug: 'jeddah',
        currency: 'SAR',
        offerStartDate: '2026-11-10',
        offerEndDate: '2026-11-25'
      }
    });

    const verifiedMeta = updated.leaflets[0].metadata;
    expect(verifiedMeta.verified).toBe(true);
    expect(verifiedMeta.supermarketId).toBe('panda-retail-id');
    expect(verifiedMeta.locationScope).toBe('city');
    expect(verifiedMeta.cityId).toBe('city-jeddah-id');
    expect(verifiedMeta.currency).toBe('SAR');

    const confirmedJsonPath = path.join(leaf.workspacePath, 'metadata', 'confirmed_metadata.json');
    expect(fs.existsSync(confirmedJsonPath)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(confirmedJsonPath, 'utf8'));
    expect(saved.record.operatorConfirmed).toBe(true);
    expect(saved.record.locationScope).toBe('city');
  });

  it('executes Full Combined E2E Chain (B1+B2 replay -> 2 crops -> decomposition -> edit preserving OCR -> matching -> preflight -> mock DEV publish)', async () => {
    const ws = path.join(tmpRoot, 'ws_combined');
    fs.mkdirSync(path.join(ws, 'pages'), { recursive: true });
    fs.copyFileSync(PANDA_PAGE_2_PNG, path.join(ws, 'pages', 'page.1.png'));

    const dummyPdf = path.join(tmpRoot, 'unnamed_upload_p2.pdf');
    fs.writeFileSync(dummyPdf, '%PDF-1.4 panda p2 replay', 'utf8');

    const b1PageJson = loadParsedArchive(B1_PANDA_PAGE2_RAW);
    const b2PepsiCrop = findB2Raw('b2_b2-req-01');
    const b2WafirCrop = findB2Raw('b2_b2-req-03');

    // Inject one conflict test card (Wafir caption 2.5kg vs pack 2kg) into the page payload alongside real B1 Panda cards
    const fullPageWithWafir = {
      ...b1PageJson,
      offers: [
        ...b1PageJson.offers,
        {
          ...(b2WafirCrop.offers[0] || {}),
          offer_number: 11,
          components: {
            product_graphic_box: [700, 650, 920, 880],
            promo_price_box: [920, 880, 975, 970],
            original_price_box: [890, 890, 918, 965],
            unit_and_size_badge_box: [850, 880, 888, 965],
            title_text_box: [925, 650, 978, 875]
          }
        }
      ]
    };

    const provider: HybridExtractionProvider = {
      providerId: 'offline_b1_b2_replay_005i',
      isOfflineOrMock: true,
      async extractPage() {
        return {
          ok: true,
          fromCache: false,
          parsedJson: fullPageWithWafir,
          durationMs: 12,
          costUsdOverride: 0.0012
        };
      },
      async extractCardCrop(req) {
        if (req.sourceOfferId?.endsWith('_005')) {
          return { ok: true, fromCache: false, parsedJson: b2PepsiCrop, durationMs: 8, costUsdOverride: 0.0004 };
        }
        if (req.sourceOfferId?.endsWith('_011')) {
          return { ok: true, fromCache: false, parsedJson: b2WafirCrop, durationMs: 8, costUsdOverride: 0.0004 };
        }
        const offerNumMatch = req.sourceOfferId?.match(/_(\d+)$/);
        const num = offerNumMatch ? parseInt(offerNumMatch[1], 10) : 1;
        const matchingOffer = fullPageWithWafir.offers.find((o: any) => o.offer_number === num);
        return {
          ok: true,
          fromCache: false,
          parsedJson: {
            is_loyalty_page: false,
            loyalty_program_name: null,
            validity_start_date: null,
            validity_end_date: null,
            page_currency: 'SAR',
            ignored_banners: [],
            offers: matchingOffer ? [matchingOffer] : []
          },
          durationMs: 5,
          costUsdOverride: 0.0002
        };
      },
      async verifyPageContext() {
        return { ok: false, errorMessage: 'skipped' };
      }
    };

    const createdManifest = await batchService.createBatch({
      files: [{ path: dummyPdf, name: 'unnamed_upload_p2.pdf', pageCount: 1, workspacePath: ws }],
      extractionPipelineMode: 'hybrid_v3'
    });

    await batchService.updateLeafletMetadata({
      batchId: createdManifest.batchId,
      leafletId: 'leaflet-001',
      operatorId: 'uat_op',
      verified: true,
      metadata: {
        supermarketId: 'sup-panda',
        supermarketName: 'Panda',
        leafletTitle: 'Weekly Mega Offers',
        locationScope: 'national',
        locationLabel: 'National',
        locationSlug: 'national',
        currency: 'SAR',
        offerStartDate: '2026-11-10',
        offerEndDate: '2026-11-28'
      }
    });

    const completedManifest = await batchService.startBatchExtraction(createdManifest.batchId, {
      skipPdfRenderIfPagesExist: true,
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3Provider: provider,
      disablePageContextVerification: true
    });

    expect(completedManifest.status).toBe('completed');
    const unifiedOffers = await batchService.getUnifiedBatchOffers(createdManifest.batchId);
    expect(unifiedOffers.length).toBeGreaterThanOrEqual(11);

    // 1. Verify BOTH Offer-Square & Product-Only crops were sliced on disk using Sharp
    const presidentOffer = unifiedOffers.find((o) =>
      o.titleEn?.toLowerCase().includes('mozzarella') || o.sourceOfferId.includes('_001')
    )!;
    expect(presidentOffer).toBeDefined();
    expect(presidentOffer.quarantineReasons).toEqual([]);
    expect(presidentOffer.offerCardCropPath).toContain('offer_card_crop.webp');
    expect(presidentOffer.productThumbCropPath).toContain('product_thumb_crop.webp');
    expect(fs.existsSync(presidentOffer.offerCardCropPath!)).toBe(true);
    expect(fs.existsSync(presidentOffer.productThumbCropPath!)).toBe(true);
    expect(presidentOffer.originalPageImagePath).toBe(path.join(ws, 'pages', 'page.1.png'));
    expect(presidentOffer.metadataVerified).toBe(true);
    expect(presidentOffer.imageSubjectScope).toBe('product_package');

    const thumbMeta = await sharp(presidentOffer.productThumbCropPath!).metadata();
    const cardMeta = await sharp(presidentOffer.offerCardCropPath!).metadata();
    expect((thumbMeta.width || 0) * (thumbMeta.height || 0)).toBeLessThan(
      (cardMeta.width || 0) * (cardMeta.height || 0)
    );

    // 2. Verify Multi-Product Assortment crops are marked representative_assortment (never unsafe exact SKU thumbs)
    const pepsiChildren = unifiedOffers.filter((o) => o.parentSourceOfferId?.endsWith('_005'));
    if (pepsiChildren.length > 1) {
      expect(pepsiChildren.every((c) => c.imageSubjectScope === 'representative_assortment')).toBe(true);
    }

    // 3. Verify Wafir 2.5kg vs 2kg conflict stayed quarantined and never marked product_package thumb
    const wafirOffer = unifiedOffers.find((o) => o.sourceOfferId.includes('_011'))!;
    expect(wafirOffer).toBeDefined();
    expect(wafirOffer.conflictCodes).toContain('TEXT_VS_IMAGE_CONFLICT');
    expect((wafirOffer.quarantineReasons || []).length).toBeGreaterThan(0);
    expect(wafirOffer.imageSubjectScope).not.toBe('product_package');

    // 4. Operator edits President offer & verifies immutable originalOcrSnapshot preservation
    const originalTitleBeforeEdit = presidentOffer.titleEn;
    const editedOffer = await batchService.updateBatchOfferFields({
      batchId: createdManifest.batchId,
      batchOfferKey: presidentOffer.batchOfferKey,
      operatorId: 'uat_op',
      patch: {
        titleEn: 'President Shredded Mozzarella Cheese 900g Verified',
        promoPrice: 28.95
      }
    });
    expect(editedOffer.titleEn).toBe('President Shredded Mozzarella Cheese 900g Verified');
    expect(editedOffer.promoPrice).toBe(28.95);
    expect(editedOffer.operatorEdited).toBe(true);
    expect((editedOffer.originalOcrSnapshot as any).titleEn).toBe(originalTitleBeforeEdit);

    // 5. Prepare MatchingRunManifest -> test Production Block, Expired Block, Image Upload & Mocked DEV publish
    const refreshedOffers = await batchService.getUnifiedBatchOffers(createdManifest.batchId);
    const updatedPresident = refreshedOffers.find((o) => o.batchOfferKey === presidentOffer.batchOfferKey)!;
    const brandGrouping = new BrandGroupingService();
    const attrs = brandGrouping.extractNormalizedAttributes(updatedPresident);
    const nowIso = new Date().toISOString();

    const matchingManifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId: createdManifest.batchId,
      runId: 'run-005i-test',
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'completed',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      totals: {
        totalExtractedOffers: 2,
        uniqueIdentitiesCount: 1,
        cacheMatchesCount: 0,
        deterministicMatchesCount: 0,
        geminiEvaluatedCount: 0,
        proposedExistingCount: 0,
        proposedTemporaryCount: 1,
        unresolvedCount: 0,
        validationWarningsCount: 0,
        geminiRequestsCount: 0,
        completedRequestsCount: 0,
        failedRequestsCount: 0,
        uncertainRequestsCount: 0,
        cancelledRequestsCount: 0,
        pendingRequestsCount: 0,
        estimatedCostUsd: 0,
        actualCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0
      },
      brandSummaries: {},
      proposals: {
        [updatedPresident.batchOfferKey]: {
          batchOfferKey: updatedPresident.batchOfferKey,
          sourceOfferId: updatedPresident.sourceOfferId,
          sourcePage: updatedPresident.sourcePage,
          leafletId: updatedPresident.leafletId,
          supermarketName: updatedPresident.supermarketName,
          decision: 'temporary',
          matchMethod: 'manual_operator',
          matchedProductId: null,
          matchedProduct: null,
          temporaryId: 'TEMP-001',
          confidence: 'high',
          validationIssues: [],
          operatorDecision: 'approved',
          operatorNotes: 'UAT verified',
          updatedAt: nowIso
        }
      },
      temporaryProducts: {
        'TEMP-001': {
          temporaryId: 'TEMP-001',
          brandKey: attrs.brandKey,
          brandNameEn: attrs.brandNameEn || 'President',
          brandNameAr: attrs.brandNameAr || 'بريزيدن',
          productNameEn: 'President Shredded Mozzarella Cheese',
          productNameAr: 'جبنة موزاريلا مبشورة بريزيدن',
          variantOrFlavor: 'Mozzarella',
          fatContent: null,
          eachSizeValue: 900,
          eachSizeUnit: 'g',
          innerPackCount: 1,
          saleUnitType: 'piece',
          productForm: 'shredded',
          sourceOfferKeys: [updatedPresident.batchOfferKey],
          retailers: ['Panda'],
          sampleThumbCropPath: updatedPresident.productThumbCropPath || null,
          operatorDecision: 'approved',
          validationWarnings: [],
          createdAt: nowIso,
          updatedAt: nowIso
        }
      },
      requests: {}
    };

    const pubService = new CatalogPublicationService(
      new VerifiedMatchCacheService(path.join(tmpRoot, 'cache.json'))
    );

    // 5a. PRODUCTION_UI fails closed
    const prodPreflight = await pubService.assessPublicationPreflight({
      manifest: matchingManifest,
      offers: [updatedPresident],
      context: 'PRODUCTION_UI',
      referenceDateIso: '2026-11-14',
      enforceMetadataVerification: true
    });
    expect(prodPreflight.ready).toBe(false);
    expect(prodPreflight.blockingReasons.some((r) => r.includes('PRODUCTION_PUBLICATION_BLOCKED'))).toBe(true);

    // 5b. Expired leaflet dates fail closed
    const expiredPreflight = await pubService.assessPublicationPreflight({
      manifest: matchingManifest,
      offers: [{ ...updatedPresident, offerEndDate: '2025-01-01' }],
      context: 'DEVELOPMENT_TEST',
      referenceDateIso: '2026-11-14',
      enforceMetadataVerification: true
    });
    expect(expiredPreflight.ready).toBe(false);
    expect(expiredPreflight.blockingReasons.some((r) => r.includes('EXPIRED_OFFER_DATES'))).toBe(true);

    // 5c. Mocked DEVELOPMENT_TEST publication uploads BOTH images, writes permanent product + offer, and re-runs idempotently
    const executedSql: Array<{ text: string; values?: any[] }> = [];
    const uploadedPaths: Array<{ storagePath: string; localImagePath: string }> = [];
    let productInserted = false;
    let offerInserted = false;
    const mockDbClient = {
      connect: async () => {},
      end: async () => {},
      query: async (text: string, values?: any[]) => {
        executedSql.push({ text, values });
        if (text.includes('FROM public.products') && text.includes('LIMIT')) {
          return { rows: productInserted ? [{ id: 9001 }] : [] };
        }
        if (text.includes('INSERT INTO public.products')) {
          productInserted = true;
          return { rows: [{ id: 9001 }] };
        }
        if (text.includes('FROM public.offers') && text.includes('source_offer_id')) {
          return {
            rows: offerInserted ? [{ id: 7001, catalog_match_status: 'verified_linked', product_id: 9001 }] : []
          };
        }
        if (text.includes('INSERT INTO public.offers')) {
          offerInserted = true;
          return { rows: [{ id: 7001 }] };
        }
        if (text.includes('UPDATE public.offers')) {
          return { rows: [{ id: 7001 }] };
        }
        return { rows: [] };
      }
    };

    const pgMod = await import('pg');
    const origConnect = pgMod.Client.prototype.connect;
    const origQuery = pgMod.Client.prototype.query;
    const origEnd = pgMod.Client.prototype.end;
    const prevDevUrl = process.env.DEV_SUPABASE_DB_PASSWORD;
    const prevDevSupaUrl = process.env.DEV_SUPABASE_URL;
    process.env.DEV_SUPABASE_URL = 'https://gykrbpykjhpyrdrinkuk.supabase.co';
    process.env.DEV_SUPABASE_DB_PASSWORD = 'mock-dev-password';

    pgMod.Client.prototype.connect = mockDbClient.connect as any;
    pgMod.Client.prototype.query = mockDbClient.query as any;
    pgMod.Client.prototype.end = mockDbClient.end as any;

    try {
      const pubRes = await pubService.publishApprovedCatalogBatch({
        manifest: matchingManifest,
        offers: [updatedPresident, wafirOffer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        referenceDateIso: '2026-11-14',
        enforceMetadataVerification: true,
        uploadImageFn: async (req) => {
          uploadedPaths.push({ storagePath: req.storagePath, localImagePath: req.localImagePath });
          return {
            imageUrl: `https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/offer-images/${req.storagePath}`,
            storagePath: req.storagePath
          };
        }
      });

      expect(pubRes.errors || []).toEqual([]);
      expect(pubRes.success).toBe(true);
      expect(pubRes.createdProductsCount).toBe(1);
      expect(pubRes.publishedOffersCount).toBe(1);
      expect(pubRes.quarantinedOffersCount).toBe(1); // Wafir conflict stays quarantined!
      expect(uploadedPaths).toHaveLength(2); // BOTH offer_card_crop & product_thumb_crop uploaded!

      const offerInsert = executedSql.find((q) => q.text.includes('INSERT INTO public.offers'))!;
      expect(offerInsert).toBeDefined();
      const params = offerInsert.values || [];
      // $41 is image_url, $42 is thumbnail_url (0-indexed 40 & 41)
      expect(params[40]).toContain('.webp');
      expect(params[41]).toContain('_thumb.webp');

      // Re-run publish: must UPDATE existing offer idempotently rather than creating duplicates
      const pubRes2 = await pubService.publishApprovedCatalogBatch({
        manifest: matchingManifest,
        offers: [updatedPresident, wafirOffer],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        referenceDateIso: '2026-11-14',
        enforceMetadataVerification: true,
        uploadImageFn: async (req) => ({
          imageUrl: `https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/offer-images/${req.storagePath}`,
          storagePath: req.storagePath
        })
      });
      expect(pubRes2.success).toBe(true);
      expect(pubRes2.publishedOffersCount).toBe(1);
      expect(executedSql.filter((q) => q.text.includes('INSERT INTO public.offers'))).toHaveLength(1);
      expect(executedSql.filter((q) => q.text.includes('UPDATE public.offers'))).toHaveLength(1);
    } finally {
      pgMod.Client.prototype.connect = origConnect;
      pgMod.Client.prototype.query = origQuery;
      pgMod.Client.prototype.end = origEnd;
      if (prevDevUrl === undefined) delete process.env.DEV_SUPABASE_DB_PASSWORD;
      else process.env.DEV_SUPABASE_DB_PASSWORD = prevDevUrl;
      if (prevDevSupaUrl === undefined) delete process.env.DEV_SUPABASE_URL;
      else process.env.DEV_SUPABASE_URL = prevDevSupaUrl;
    }
  }, 20000);

  it('supports durable page-level cancellation & resume across multi-page Hybrid V3 leaflets without duplicating finished pages', async () => {
    const ws = path.join(tmpRoot, 'ws_cancel_resume');
    fs.mkdirSync(path.join(ws, 'pages'), { recursive: true });
    fs.copyFileSync(PANDA_PAGE_2_PNG, path.join(ws, 'pages', 'page.1.png'));
    fs.copyFileSync(PANDA_PAGE_2_PNG, path.join(ws, 'pages', 'page.2.png'));

    const dummyPdf = path.join(tmpRoot, 'two_page_scan.pdf');
    fs.writeFileSync(dummyPdf, crypto.randomBytes(32));

    const b1PageJson = loadParsedArchive(B1_PANDA_PAGE2_RAW);
    const singleOfferPage = {
      ...b1PageJson,
      offers: [b1PageJson.offers[0]]
    };

    const pageCalls: number[] = [];
    const manifest = await batchService.createBatch({
      files: [{ path: dummyPdf, name: 'two_page_scan.pdf', pageCount: 2, workspacePath: ws }],
      extractionPipelineMode: 'hybrid_v3'
    });
    await batchService.updateLeafletMetadata({
      batchId: manifest.batchId,
      leafletId: 'leaflet-001',
      verified: true,
      metadata: {
        supermarketId: 'panda',
        supermarketName: 'Panda',
        locationScope: 'national',
        locationLabel: 'National',
        offerStartDate: '2026-10-20',
        offerEndDate: '2026-10-26'
      }
    });

    const provider: HybridExtractionProvider = {
      providerId: 'cancel_resume_provider',
      isOfflineOrMock: true,
      async extractPage(req) {
        pageCalls.push(req.pageNumber);
        if (req.pageNumber === 1) {
          // Request cancellation right as page 1 completes so page 2 is deferred cleanly
          await batchService.cancelBatch(manifest.batchId);
        }
        return {
          ok: true,
          fromCache: false,
          parsedJson: singleOfferPage,
          durationMs: 5,
          costUsdOverride: 0.001
        };
      },
      async extractCardCrop() {
        return { ok: true, fromCache: false, parsedJson: singleOfferPage, durationMs: 2, costUsdOverride: 0 };
      },
      async verifyPageContext() {
        return { ok: false, errorMessage: 'skipped' };
      }
    };

    const cancelledResult = await batchService.startBatchExtraction(manifest.batchId, {
      skipPdfRenderIfPagesExist: true,
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3Provider: provider,
      disablePageContextVerification: true
    });

    expect(cancelledResult.status).toBe('cancelled');
    expect(pageCalls).toEqual([1]);

    // Resume batch: page 1 must be skipped via checkpoint, only page 2 runs
    const resumedResult = await batchService.resumeBatch(manifest.batchId, {
      skipPdfRenderIfPagesExist: true,
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3Provider: provider,
      disablePageContextVerification: true
    });

    expect(resumedResult.status).toBe('completed');
    expect(pageCalls).toEqual([1, 2]);
    expect(resumedResult.leaflets[0].pagesProcessed).toBe(2);
    const allOffers = await batchService.getUnifiedBatchOffers(manifest.batchId);
    expect(allOffers.map((o) => o.sourcePage).sort()).toEqual([1, 2]);
  }, 15000);
});
