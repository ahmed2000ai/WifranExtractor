import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderedCalls: Array<{
  pdfPath: string;
  selectionMode?: string;
  selectedPages?: number[];
  pageCount?: number;
}> = [];

vi.mock('../../pdf/streamingPdfRenderService', () => ({
  renderPdfPagesStreaming: vi.fn(async (opts: any) => {
    renderedCalls.push({
      pdfPath: opts.pdfPath,
      selectionMode: opts.selectionMode,
      selectedPages: opts.selectedPages,
      pageCount: opts.pageCount
    });
    const pagesDir = path.join(opts.workspacePath, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const pagesToRender: number[] =
      opts.selectionMode === 'specific' && Array.isArray(opts.selectedPages) && opts.selectedPages.length > 0
        ? opts.selectedPages
        : Array.from({ length: opts.pageCount || 1 }, (_, i) => i + 1);

    const pngBuf = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 245, g: 245, b: 245 } }
    })
      .png()
      .toBuffer();

    for (const p of pagesToRender) {
      fs.writeFileSync(path.join(pagesDir, `page.${p}.png`), pngBuf);
    }
    return {
      pageCount: opts.pageCount || pagesToRender.length,
      renderedPages: pagesToRender
    };
  })
}));

import { parseStrictBatchPageSelection } from '../../../shared/utils/pageRangeParser';
import { computeStableSourceOfferId } from '../../../shared/utils/nonCatalogPublicationPolicy';
import { buildCrossRetailerGroups } from '../../../shared/utils/crossRetailerGrouping';
import { BatchOrchestrationService } from '../batchOrchestrationService';
import { CatalogMatchingOrchestrator } from '../catalogMatchingOrchestrator';
import { CatalogPublicationService } from '../../db/catalogPublicationService';
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService';
import { BrandGroupingService } from '../../db/brandGroupingService';
import { GeminiMatchingService } from '../../ocr/geminiMatchingService';
import * as dbResolver from '../../db/databaseEnvironmentResolver';
import * as leafletMetadataModule from '../../metadata/leafletMetadataService';
import type { HybridExtractionProvider } from '../../../shared/types/hybridExtractionV3';
import type { UnifiedBatchOffer } from '../../../shared/types/batchExtraction';
import type { MatchingRunManifest } from '../../../shared/types/catalogMatching';

function makeHybridPagePayload(titleAr: string, titleEn: string, brand: string, promoPrice: number) {
  return {
    is_loyalty_page: false,
    loyalty_program_name: null,
    validity_start_date: null,
    validity_end_date: null,
    page_currency: 'SAR',
    ignored_banners: [],
    offers: [
      {
        offer_number: 1,
        arabic_title: titleAr,
        english_title: titleEn,
        brand,
        size_text: '1L',
        promo_badge_text: null,
        assortment_status: 'confirmed_single_sku',
        visible_variant_count: 1,
        assortment_evidence: [],
        is_enumerated_list_complete: true,
        compound_group_id: null,
        shared_caption_text: null,
        item_domain: 'grocery',
        category_slug: 'dairy',
        promo_price: promoPrice,
        original_price: promoPrice + 3,
        currency: 'SAR',
        currency_evidence: 'SAR',
        price_basis: 'each',
        price_role_confidence: 'high',
        sale_basis: 'single_unit',
        is_per_weight_pricing: false,
        promo_conditions: null,
        each_size_value: 1,
        each_size_unit: 'l',
        manufacturer_pack_count: 1,
        retailer_checkout_multibuy_qty: null,
        factory_bonus_paid_qty: null,
        factory_bonus_free_qty: null,
        customer_limit_pcs: null,
        loyalty_required: false,
        printed_retailer_sku_codes: [],
        sub_items: [
          {
            sub_item_ref: 's01',
            brand_en: brand,
            brand_ar: 'المراعي',
            product_name_en: titleEn,
            product_name_ar: titleAr,
            variant_or_flavor: null,
            each_size_value: 1,
            each_size_unit: 'l',
            manufacturer_pack_count: 1,
            retailer_checkout_multibuy_qty: null,
            printed_retailer_sku_code: null,
            independent_promo_price: null,
            independent_original_price: null
          }
        ],
        non_grocery_specs: null,
        evidence_conflicts: [],
        confidence: 0.96,
        components: {
          product_graphic_box: [50, 50, 260, 260],
          promo_price_box: [270, 220, 340, 340],
          original_price_box: [220, 220, 265, 340],
          unit_and_size_badge_box: [180, 220, 215, 340],
          title_text_box: [270, 40, 350, 210]
        }
      }
    ]
  };
}

function makeBatchOffer(overrides: Partial<UnifiedBatchOffer> & { batchOfferKey: string; leafletId: string; sourceOfferId: string }): UnifiedBatchOffer {
  return {
    batchId: 'batch_uat_001',
    sourceFileName: 'leaflet.pdf',
    sourcePdfPath: '/tmp/leaflet.pdf',
    sourceFileFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourcePage: 2,
    canonicalSourceId: overrides.sourceOfferId,
    supermarketId: 'sup-panda',
    supermarketName: 'Panda',
    locationScope: 'national',
    locationLabel: 'National',
    cityId: null,
    regionId: null,
    offerStartDate: '2026-11-10',
    offerEndDate: '2026-11-25',
    currency: 'SAR',
    leafletTitle: 'Weekly Deals',
    metadataVerified: true,
    titleAr: 'حليب المراعي طازج 1 لتر',
    titleEn: 'Almarai Fresh Milk 1L',
    brand: 'Almarai',
    brandAr: 'المراعي',
    brandEn: 'Almarai',
    brandConfidence: 'high',
    variantOrFlavor: 'Full Fat',
    category: 'Dairy',
    promoPrice: 10.5,
    originalPrice: 13.5,
    discountPercent: 22,
    sizeOrWeight: '1L',
    each_size_value: 1,
    each_size_unit: 'L',
    inner_pack_count: 1,
    sale_unit_type: 'each',
    total_content_value: 1,
    total_content_unit: 'L',
    free_units_text: null,
    customer_limit: null,
    promoNotes: null,
    promotion_mechanic: null,
    offerCardCropPath: '/tmp/offer_card_crop.webp',
    productThumbCropPath: '/tmp/product_thumb_crop.webp',
    originalPageImagePath: '/tmp/page.2.png',
    status: 'extracted',
    confidence: 'high',
    quarantineReasons: [],
    operatorEdited: false,
    ...overrides
  };
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005J-FIX — UAT Unblocking Regression Suite', () => {
  let tempRoot: string;

  beforeEach(() => {
    renderedCalls.length = 0;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-005j-uat-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('Req 1: parseStrictBatchPageSelection rejects invalid, empty, duplicate, and out-of-range selections', () => {
    expect(parseStrictBatchPageSelection('2, 5', 12)).toMatchObject({ ok: true, pages: [2, 5] });
    expect(parseStrictBatchPageSelection('3-4', 10)).toMatchObject({ ok: true, pages: [3, 4] });

    const emptyRes = parseStrictBatchPageSelection('   ', 10);
    expect(emptyRes.pages).toEqual([]);
    expect(emptyRes.error).toBeTruthy();

    const zeroRes = parseStrictBatchPageSelection('0, 2', 10);
    expect(zeroRes.pages).toEqual([]);
    expect(zeroRes.error).toMatch(/1 or greater|exceeds bounds|positive/i);

    const oobRes = parseStrictBatchPageSelection('2, 15', 10);
    expect(oobRes.pages).toEqual([]);
    expect(oobRes.error).toMatch(/out of bounds|exceeds bounds/i);

    const dupRes = parseStrictBatchPageSelection('2, 2', 10);
    expect(dupRes.pages).toEqual([]);
    expect(dupRes.error).toMatch(/Duplicate page number/i);

    const rangeDupRes = parseStrictBatchPageSelection('2-4, 3', 10);
    expect(rangeDupRes.pages).toEqual([]);
    expect(rangeDupRes.error).toMatch(/Duplicate page number/i);
  });

  it('Req 1, 2 & 3: creates 3-PDF batch, runs offline cover-page discovery, enforces verified metadata, and renders/extracts ONLY 6 selected pages', async () => {
    const batchService = new BatchOrchestrationService();
    vi.spyOn(batchService, 'getBatchDir').mockImplementation((id) => path.join(tempRoot, 'batches', id));

    const pdf1 = path.join(tempRoot, 'panda_12p.pdf');
    const pdf2 = path.join(tempRoot, 'othaim_10p.pdf');
    const pdf3 = path.join(tempRoot, 'danube_8p.pdf');
    fs.writeFileSync(pdf1, Buffer.from('%PDF-1.4 panda leaflet'));
    fs.writeFileSync(pdf2, Buffer.from('%PDF-1.4 othaim leaflet'));
    fs.writeFileSync(pdf3, Buffer.from('%PDF-1.4 danube leaflet'));

    // Reject duplicate / out-of-range page selections fail-closed
    await expect(
      batchService.createBatch({
        files: [{ path: pdf1, name: 'panda_12p.pdf', pageCount: 12, pagesToProcess: [2, 2], pageSelectionMode: 'specific' }],
        extractionPipelineMode: 'hybrid_v3'
      })
    ).rejects.toThrow(/INVALID_PAGE_SELECTION: Duplicate/);

    await expect(
      batchService.createBatch({
        files: [{ path: pdf1, name: 'panda_12p.pdf', pageCount: 12, pagesToProcess: [2, 19], pageSelectionMode: 'specific' }],
        extractionPipelineMode: 'hybrid_v3'
      })
    ).rejects.toThrow(/INVALID_PAGE_SELECTION: Page 19/);

    const created = await batchService.createBatch({
      files: [
        {
          path: pdf1,
          name: 'panda_12p.pdf',
          pageCount: 12,
          pagesToProcess: [2, 5],
          pageSelectionMode: 'specific',
          pageSelectionInput: '2, 5',
          workspacePath: path.join(tempRoot, 'ws_panda')
        },
        {
          path: pdf2,
          name: 'othaim_10p.pdf',
          pageCount: 10,
          pagesToProcess: [1, 3],
          pageSelectionMode: 'specific',
          pageSelectionInput: '1, 3',
          workspacePath: path.join(tempRoot, 'ws_othaim')
        },
        {
          path: pdf3,
          name: 'danube_8p.pdf',
          pageCount: 8,
          pagesToProcess: [4, 7],
          pageSelectionMode: 'specific',
          pageSelectionInput: '4, 7',
          workspacePath: path.join(tempRoot, 'ws_danube')
        }
      ],
      extractionPipelineMode: 'hybrid_v3'
    });

    // Clean initial state: created (not silently extracting), totalPages = 6 (NOT 30)
    expect(created.status).toBe('created');
    expect(created.totals.totalPdfs).toBe(3);
    expect(created.totals.totalPages).toBe(6);
    expect(renderedCalls).toHaveLength(0);
    expect(created.leaflets.every((l) => l.metadata.verified === false)).toBe(true);

    // Offline cover-page metadata discovery passes full pdfPath + disableFilenameHints even though page 1 is unselected for Panda
    const metaSvc = leafletMetadataModule.getLeafletMetadataService();
    const discoverSpy = vi.spyOn(metaSvc, 'discoverMetadataFromPackage').mockResolvedValue({
      supermarketId: 'sup-panda',
      supermarketName: 'Panda',
      locationScope: null,
      locationLabel: null,
      locationSlug: null,
      cityId: null,
      regionId: null,
      offerStartDate: '2026-11-10',
      offerEndDate: '2026-11-25',
      leafletTitle: 'Panda Cover Promo',
      currency: 'SAR',
      discoverySource: 'cover_page_text'
    } as any);

    const discovered = await batchService.discoverLeafletMetadata({
      batchId: created.batchId,
      leafletId: 'leaflet-001'
    });
    expect(discoverSpy).toHaveBeenCalledWith(
      path.join(tempRoot, 'ws_panda'),
      expect.objectContaining({
        pdfPath: pdf1,
        sourceFileName: 'panda_12p.pdf',
        totalPages: 12,
        allowCoverPageEvidence: true,
        disableFilenameHints: true
      })
    );
    expect(discovered.leaflets[0].metadata.verified).toBe(false);
    expect(discovered.leaflets[0].metadata.locationScope).toBe('national');
    expect(discovered.leaflets[0].metadata.scopeSource).toBe('default_national');
    expect(discovered.leaflets[0].metadata.cityId).toBeNull();

    // Must fail closed if Hybrid V3 started before metadata verification
    const extractedCalls: Array<{ leafletFile: string; pageNumber: number }> = [];
    const provider: HybridExtractionProvider = {
      providerId: 'offline_uat_005j',
      isOfflineOrMock: true,
      async extractPage(req) {
        const base = path.basename(path.dirname(path.dirname(req.imagePath)));
        extractedCalls.push({ leafletFile: base, pageNumber: req.pageNumber });
        const price = base === 'ws_panda' ? 10.5 : base === 'ws_othaim' ? 9.95 : 11.25;
        return {
          ok: true,
          fromCache: false,
          parsedJson: makeHybridPagePayload('حليب المراعي طازج 1 لتر', 'Almarai Fresh Milk 1L', 'Almarai', price),
          durationMs: 5,
          costUsdOverride: 0.001
        };
      },
      async extractCardCrop() {
        return { ok: true, fromCache: false, parsedJson: makeHybridPagePayload('حليب المراعي طازج 1 لتر', 'Almarai Fresh Milk 1L', 'Almarai', 10.5), durationMs: 3, costUsdOverride: 0.0001 };
      },
      async verifyPageContext() {
        return { ok: false, errorMessage: 'disabled' };
      }
    };

    // WIFRAN-005J-UAT-FIX-05: Extraction CAN start without prior metadata verification once explicitly authorized;
    // metadata is verified afterward prior to Step 5 publication.
    const done = await batchService.startBatchExtraction(created.batchId, {
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3ExplicitLiveAuthorization: false,
      hybridV3Provider: provider,
      disablePageContextVerification: true
    });

    // Verify all 3 leaflets cleanly post-extraction (Step 3 Review & Verify)
    const leafletMeta = [
      { id: 'leaflet-001', supId: 'sup-panda', supName: 'Panda', scope: 'national' as const, label: 'National' },
      { id: 'leaflet-002', supId: 'sup-othaim', supName: 'Othaim', scope: 'city' as const, label: 'Riyadh' },
      { id: 'leaflet-003', supId: 'sup-danube', supName: 'Danube', scope: 'city' as const, label: 'Jeddah' }
    ];
    for (const m of leafletMeta) {
      await batchService.updateLeafletMetadata({
        batchId: created.batchId,
        leafletId: m.id,
        operatorId: 'uat_op',
        verified: true,
        metadata: {
          supermarketId: m.supId,
          supermarketName: m.supName,
          leafletTitle: `${m.supName} Mega Offers`,
          locationScope: m.scope,
          locationLabel: m.label,
          locationSlug: m.label.toLowerCase(),
          currency: 'SAR',
          offerStartDate: '2026-11-10',
          offerEndDate: '2026-11-25'
        }
      });
    }

    expect(done.status).toBe('completed');
    expect(done.totals.pagesProcessed).toBe(6);

    // Render spy called strictly with selectionMode='specific' and exact 2 pages per PDF
    expect(renderedCalls).toHaveLength(3);
    expect(renderedCalls.map((c) => c.selectedPages)).toEqual([
      [2, 5],
      [1, 3],
      [4, 7]
    ]);
    expect(renderedCalls.every((c) => c.selectionMode === 'specific')).toBe(true);

    // Unselected pages do NOT exist on disk
    expect(fs.existsSync(path.join(tempRoot, 'ws_panda', 'pages', 'page.1.png'))).toBe(false);
    expect(fs.existsSync(path.join(tempRoot, 'ws_panda', 'pages', 'page.2.png'))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'ws_panda', 'pages', 'page.5.png'))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'ws_danube', 'pages', 'page.1.png'))).toBe(false);
    expect(fs.existsSync(path.join(tempRoot, 'ws_danube', 'pages', 'page.4.png'))).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'ws_danube', 'pages', 'page.7.png'))).toBe(true);

    // Hybrid V3 extraction ran ONLY on the 6 selected pages
    expect(extractedCalls).toEqual([
      { leafletFile: 'ws_panda', pageNumber: 2 },
      { leafletFile: 'ws_panda', pageNumber: 5 },
      { leafletFile: 'ws_othaim', pageNumber: 1 },
      { leafletFile: 'ws_othaim', pageNumber: 3 },
      { leafletFile: 'ws_danube', pageNumber: 4 },
      { leafletFile: 'ws_danube', pageNumber: 7 }
    ]);

    const allOffers = await batchService.getUnifiedBatchOffers(created.batchId);
    expect(allOffers).toHaveLength(6);
    expect(allOffers.every((o) => Boolean(o.sourceFileFingerprint))).toBe(true);

    const page4Only = await batchService.getUnifiedBatchOffers(created.batchId, { sourcePage: 4 });
    expect(page4Only).toHaveLength(1);
    expect(page4Only[0].supermarketName).toBe('Danube');
  });

  it('Req 4: resumeBatch requires explicit auth, preserves pagesToProcess, and blocks unapproved scope expansion', async () => {
    const batchService = new BatchOrchestrationService();
    vi.spyOn(batchService, 'getBatchDir').mockImplementation((id) => path.join(tempRoot, 'batches', id));

    const pdf1 = path.join(tempRoot, 'resume_panda.pdf');
    fs.writeFileSync(pdf1, Buffer.from('%PDF-1.4 resume'));
    const ws = path.join(tempRoot, 'ws_resume');

    const created = await batchService.createBatch({
      files: [{ path: pdf1, name: 'resume_panda.pdf', pageCount: 8, pagesToProcess: [2, 5], workspacePath: ws }],
      extractionPipelineMode: 'hybrid_v3'
    });
    await batchService.updateLeafletMetadata({
      batchId: created.batchId,
      leafletId: 'leaflet-001',
      verified: true,
      metadata: {
        supermarketId: 'sup-panda',
        supermarketName: 'Panda',
        locationScope: 'national',
        locationLabel: 'National',
        offerStartDate: '2026-11-10',
        offerEndDate: '2026-11-25'
      }
    });

    // Simulate failed first run with initial approvedScope recorded
    const manifest = (await batchService.loadBatchManifest(created.batchId))!;
    manifest.status = 'failed';
    manifest.leaflets[0].status = 'failed';
    manifest.approvedScope = {
      hybridV3Authorized: true,
      hybridV3LiveAuthorized: false,
      pagesByLeafletId: { 'leaflet-001': [2, 5] },
      totalTargetPages: 2,
      authorizedAt: new Date().toISOString()
    };
    await batchService.saveBatchManifestAtomic(manifest);

    // 1. Missing explicit authorization -> fail closed
    await expect(batchService.resumeBatch(created.batchId)).rejects.toThrow(
      /HYBRID_V3_RESUME_AUTHORIZATION_REQUIRED/
    );

    // 2. Scope expansion without reauthorizeExpandedScope -> fail closed
    manifest.leaflets[0].pagesToProcess = [2, 5, 6];
    await batchService.saveBatchManifestAtomic(manifest);
    await expect(
      batchService.resumeBatch(created.batchId, {
        hybridV3ExplicitAuthorization: true,
        hybridV3FeatureEnabled: true
      })
    ).rejects.toThrow(/HYBRID_V3_SCOPE_EXPANSION_REAUTH_REQUIRED/);

    // 3. Explicit reauthorization succeeds and preserves hybridV3ExplicitLiveAuthorization=false (never auto-flipped to true!)
    const provider: HybridExtractionProvider = {
      providerId: 'offline_resume_005j',
      isOfflineOrMock: true,
      async extractPage(req) {
        return {
          ok: true,
          fromCache: false,
          parsedJson: makeHybridPagePayload('حليب', 'Milk', 'Almarai', 10 + req.pageNumber),
          durationMs: 1,
          costUsdOverride: 0.001
        };
      },
      async extractCardCrop() {
        return { ok: false, fromCache: false, durationMs: 0, errorMessage: 'skip' };
      },
      async verifyPageContext() {
        return { ok: false, errorMessage: 'skip' };
      }
    };

    const resumed = await batchService.resumeBatch(created.batchId, {
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3ExplicitLiveAuthorization: false,
      reauthorizeExpandedScope: true,
      hybridV3Provider: provider,
      disablePageContextVerification: true
    });
    expect(resumed.status).toBe('completed');
    expect(resumed.leaflets[0].pagesToProcess).toEqual([2, 5, 6]);
    expect(resumed.approvedScope?.hybridV3LiveAuthorized).toBe(false);
    expect(resumed.totals.pagesProcessed).toBe(3);
  });

  it('Req 9: computeStableSourceOfferId avoids cross-batch leaflet-001 collisions while preserving repeat-import idempotency', () => {
    const batchAOffer = {
      batchOfferKey: 'bA:l1:p2:i1',
      leafletId: 'leaflet-001',
      sourcePage: 2,
      sourceOfferId: 'leaflet-001:p002:i001:s01',
      sourceFileFingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
      sourceFileName: 'panda_week1.pdf',
      decomposedChildIndex: 1
    };
    const batchBOfferUnrelatedPdf = {
      batchOfferKey: 'bB:l1:p2:i1',
      leafletId: 'leaflet-001',
      sourcePage: 2,
      sourceOfferId: 'leaflet-001:p002:i001:s01',
      sourceFileFingerprint: '2222222222222222222222222222222222222222222222222222222222222222',
      sourceFileName: 'othaim_week1.pdf',
      decomposedChildIndex: 1
    };
    const batchCReimportSamePdf = {
      batchOfferKey: 'bC:l3:p2:i1',
      leafletId: 'leaflet-003',
      sourcePage: 2,
      sourceOfferId: 'leaflet-003:p002:i001:s01',
      sourceFileFingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
      sourceFileName: 'panda_week1_copy.pdf',
      decomposedChildIndex: 1
    };
    const decomposedChild2 = {
      ...batchAOffer,
      decomposedChildIndex: 2
    };

    const idA = computeStableSourceOfferId(batchAOffer);
    const idB = computeStableSourceOfferId(batchBOfferUnrelatedPdf);
    const idReimport = computeStableSourceOfferId(batchCReimportSamePdf);
    const idChild2 = computeStableSourceOfferId(decomposedChild2);

    expect(idA).toMatch(/^doc_[0-9a-f]{16}:p002:i001:s01$/);
    expect(idB).not.toBe(idA); // Unrelated PDF in another batch NEVER collides on leaflet-001
    expect(idReimport).toBe(idA); // Same PDF fingerprint in new batch produces identical idempotent key
    expect(idChild2).not.toBe(idA); // Multi-product decomposition preserves child index uniqueness
  });

  it('Req 5, 6 & 7: cross-retailer reconciliation matches identical SKU across 3 retailers, keeps prices/dates/scope independent, and isolates unresolved/variants', async () => {
    const cacheDir = path.join(tempRoot, 'cache');
    const cacheService = new VerifiedMatchCacheService(cacheDir, 'development');
    const geminiMock = {
      evaluateBatch: vi.fn(async (req: any) => ({
        matches: (req.items || []).map((item: any, idx: number) => ({
          item,
          matchedProductId: null,
          temporaryRef: `t_${idx + 1}`,
          validationIssues: [],
          rawModelSourceId: null
        })),
        usage: {
          inputTokens: 100,
          outputTokens: 40,
          thinkingTokens: 20,
          actualCostUsd: 0
        }
      }))
    } as unknown as GeminiMatchingService;
    const grouping = new BrandGroupingService();
    const orch = new CatalogMatchingOrchestrator(cacheService, geminiMock, grouping);
    vi.spyOn(orch, 'getMatchingDir').mockReturnValue(path.join(tempRoot, 'matching'));

    const mockCatalogProducts = [
      {
        id: 101,
        name_en: 'Almarai Fresh Milk 1L Full Fat',
        name_ar: 'حليب المراعي طازج كامل الدسم 1 لتر',
        brand_name: 'Almarai',
        variant_or_flavor: 'Full Fat',
        each_size_value: 1,
        each_size_unit: 'L',
        inner_pack_count: 1,
        is_active: true,
        verification_status: 'verified'
      }
    ];
    const mockSupabase = {
      from: () => ({
        select: (_cols?: any, opts?: { count?: string; head?: boolean }) => {
          const buildResult = (clause: string) => {
            const isAlmarai = clause.toLowerCase().includes('almarai');
            const rows = isAlmarai ? mockCatalogProducts : [];
            if (opts?.head) {
              return Promise.resolve({ count: rows.length, error: null });
            }
            return {
              limit: async () => ({ data: rows, error: null })
            };
          };
          return {
            or: (clause: string) => buildResult(clause),
            eq: () => ({
              ilike: () => ({
                limit: async () => ({ data: mockCatalogProducts, error: null })
              }),
              limit: async () => ({ data: mockCatalogProducts, error: null })
            })
          };
        }
      })
    } as any;

    const pandaOffer = makeBatchOffer({
      batchOfferKey: 'k_panda_milk',
      leafletId: 'leaflet-001',
      sourceOfferId: 'doc_111:p002:i001',
      sourceFileFingerprint: '111'.repeat(21) + '1',
      supermarketId: 'sup-panda',
      supermarketName: 'Panda',
      promoPrice: 10.5,
      originalPrice: 13.5,
      offerStartDate: '2026-11-10',
      offerEndDate: '2026-11-20',
      locationScope: 'national',
      locationLabel: 'National',
      sourcePage: 2
    });
    const othaimOffer = makeBatchOffer({
      batchOfferKey: 'k_othaim_milk',
      leafletId: 'leaflet-002',
      sourceOfferId: 'doc_222:p003:i001',
      sourceFileFingerprint: '222'.repeat(21) + '2',
      supermarketId: 'sup-othaim',
      supermarketName: 'Othaim',
      promoPrice: 9.95,
      originalPrice: 14.0,
      offerStartDate: '2026-11-12',
      offerEndDate: '2026-11-19',
      locationScope: 'city',
      locationLabel: 'Riyadh',
      cityId: 'city-riyadh',
      sourcePage: 3
    });
    const danubeOffer = makeBatchOffer({
      batchOfferKey: 'k_danube_milk',
      leafletId: 'leaflet-003',
      sourceOfferId: 'doc_333:p004:i001',
      sourceFileFingerprint: '333'.repeat(21) + '3',
      supermarketId: 'sup-danube',
      supermarketName: 'Danube',
      promoPrice: 11.25,
      originalPrice: 14.5,
      offerStartDate: '2026-11-11',
      offerEndDate: '2026-11-18',
      locationScope: 'city',
      locationLabel: 'Jeddah',
      cityId: 'city-jeddah',
      sourcePage: 4
    });

    // Negative case: different size (2L) + Ambiguous unresolved case (multi-brand missing identity)
    const variant2LOffer = makeBatchOffer({
      batchOfferKey: 'k_panda_milk_2l',
      leafletId: 'leaflet-001',
      sourceOfferId: 'doc_111:p005:i002',
      titleEn: 'Almarai Fresh Milk 2L',
      titleAr: 'حليب المراعي طازج 2 لتر',
      sizeOrWeight: '2L',
      each_size_value: 2,
      total_content_value: 2,
      promoPrice: 18.0,
      sourcePage: 5
    });
    const ambiguousOffer = makeBatchOffer({
      batchOfferKey: 'k_danube_ambig',
      leafletId: 'leaflet-003',
      sourceOfferId: 'doc_333:p007:i005',
      titleEn: 'Assorted Juices',
      titleAr: 'عصائر متنوعة',
      brand: null,
      brandEn: null,
      brandAr: null,
      sizeOrWeight: null,
      each_size_value: null,
      each_size_unit: null,
      total_content_value: null,
      total_content_unit: null,
      quarantineReasons: ['MULTIPLE_BRAND_ASSORTMENT'],
      sourcePage: 7
    });

    const manifest = await orch.executeMatchingRun({
      batchId: 'batch_uat_001',
      offers: [pandaOffer, othaimOffer, danubeOffer, variant2LOffer, ambiguousOffer],
      supabase: mockSupabase,
      databaseContext: 'DEVELOPMENT_TEST'
    });

    expect(manifest.matchingDatabaseContext).toBe('DEVELOPMENT_TEST');
    expect(manifest.proposals['k_panda_milk'].matchedProductId).toBe('101');
    expect(manifest.proposals['k_othaim_milk'].matchedProductId).toBe('101');
    expect(manifest.proposals['k_danube_milk'].matchedProductId).toBe('101');
    expect(manifest.proposals['k_panda_milk'].matchedDatabaseContext).toBe('DEVELOPMENT_TEST');

    // Different 2L variant does NOT collapse into 101 (1L), stays separate provisional temporary group
    expect(manifest.proposals['k_panda_milk_2l'].matchedProductId).toBeNull();
    expect(manifest.proposals['k_panda_milk_2l'].decision).toBe('temporary');

    // Ambiguous card stays unresolved
    expect(manifest.proposals['k_danube_ambig'].decision).toBe('unresolved');

    const grouped = buildCrossRetailerGroups(
      [pandaOffer, othaimOffer, danubeOffer, variant2LOffer, ambiguousOffer],
      manifest
    );
    expect(grouped.verifiedGroups).toHaveLength(1);
    expect(grouped.verifiedGroups[0].matchedProductId).toBe('101');
    expect(grouped.verifiedGroups[0].retailerCount).toBe(3);
    expect(grouped.verifiedGroups[0].retailerRows.map((r) => ({
      retailer: r.supermarketName,
      price: r.promoPrice,
      scope: r.locationLabel,
      dates: `${r.offerStartDate}..${r.offerEndDate}`,
      page: r.sourcePage
    }))).toEqual([
      { retailer: 'Danube', price: 11.25, scope: 'Jeddah', dates: '2026-11-11..2026-11-18', page: 4 },
      { retailer: 'Othaim', price: 9.95, scope: 'Riyadh', dates: '2026-11-12..2026-11-19', page: 3 },
      { retailer: 'Panda', price: 10.5, scope: 'National', dates: '2026-11-10..2026-11-20', page: 2 }
    ]);
    expect(grouped.provisionalGroups).toHaveLength(1);
    expect(grouped.provisionalGroups[0].groupType).toBe('provisional_temporary');
    expect(grouped.unresolvedRows).toHaveLength(1);
    expect(grouped.unresolvedRows[0].proposal.batchOfferKey).toBe('k_danube_ambig');
  });

  it('Req 9 & 10: preflight and publication block duplicate source_offer_id, cross-DB PROD->DEV IDs, and DEV numeric ID collisions', async () => {
    const pubService = new CatalogPublicationService(new VerifiedMatchCacheService(tempRoot, 'development'));
    const offer1 = makeBatchOffer({
      batchOfferKey: 'k1',
      leafletId: 'leaflet-001',
      sourceOfferId: 'doc_aaa:p002:i001',
      sourceFileFingerprint: 'aaa'.repeat(21) + 'a'
    });
    const duplicateOffer2 = makeBatchOffer({
      batchOfferKey: 'k2',
      leafletId: 'leaflet-002',
      sourceOfferId: 'doc_aaa:p002:i001',
      sourceFileFingerprint: 'aaa'.repeat(21) + 'a'
    });

    const prodMatchedManifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId: 'b_env_mismatch',
      runId: 'r1',
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:00:00Z',
      status: 'completed',
      matchingDatabaseContext: 'PRODUCTION_UI',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      brandSummaries: {},
      totals: {
        totalExtractedOffers: 2,
        uniqueIdentitiesCount: 1,
        cacheMatchesCount: 0,
        deterministicMatchesCount: 1,
        geminiEvaluatedCount: 0,
        proposedExistingCount: 1,
        proposedTemporaryCount: 0,
        unresolvedCount: 0,
        validationWarningsCount: 0,
        actualCostUsd: 0,
        estimatedCostUsd: 0,
        geminiRequestsCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0
      },
      proposals: {
        k1: {
          batchOfferKey: 'k1',
          sourceOfferId: offer1.sourceOfferId,
          sourcePage: 2,
          leafletId: 'leaflet-001',
          supermarketName: 'Panda',
          decision: 'existing',
          matchedProductId: '42',
          matchedDatabaseContext: 'PRODUCTION_UI',
          matchedProduct: {
            id: '42',
            nameEn: 'Almarai Fresh Milk 1L',
            nameAr: 'حليب المراعي 1 لتر',
            brand: 'Almarai',
            variant: 'Full Fat',
            sizeValue: 1,
            sizeUnit: 'L',
            packCount: 1
          },
          temporaryId: null,
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'approved',
          updatedAt: '2026-11-10T00:00:00Z'
        }
      },
      temporaryProducts: {}
    };

    // 1. PRODUCTION_UI match published into DEVELOPMENT_TEST must block in preflight
    const envMismatchPreflight = await pubService.assessPublicationPreflight({
      manifest: prodMatchedManifest,
      offers: [offer1],
      context: 'DEVELOPMENT_TEST',
      referenceDateIso: '2026-11-15'
    });
    expect(envMismatchPreflight.ready).toBe(false);
    expect(envMismatchPreflight.blockingReasons.some((r) => r.includes('CATALOG_ENVIRONMENT_MISMATCH'))).toBe(true);

    // 2. Duplicate source_offer_id in same batch must block in preflight
    const devManifestDup = {
      ...prodMatchedManifest,
      matchingDatabaseContext: 'DEVELOPMENT_TEST' as const,
      proposals: {
        k1: { ...prodMatchedManifest.proposals.k1, matchedDatabaseContext: 'DEVELOPMENT_TEST' as const }
      }
    };
    const dupPreflight = await pubService.assessPublicationPreflight({
      manifest: devManifestDup,
      offers: [offer1, duplicateOffer2],
      context: 'DEVELOPMENT_TEST',
      referenceDateIso: '2026-11-15'
    });
    expect(dupPreflight.ready).toBe(false);
    expect(dupPreflight.blockingReasons.some((r) => r.includes('DUPLICATE_SOURCE_OFFER_ID'))).toBe(true);

    // 3. Even if manifest lacked matchingDatabaseContext, numeric ID collision against wrong DEV product aborts transaction cleanly
    const legacyManifestCollision: MatchingRunManifest = {
      ...prodMatchedManifest,
      matchingDatabaseContext: undefined,
      proposals: {
        k1: { ...prodMatchedManifest.proposals.k1, matchedDatabaseContext: undefined }
      }
    };
    const fakeQueries: string[] = [];
    const fakePgClient = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string) => {
        fakeQueries.push(sql);
        if (sql.includes('FROM public.products WHERE id = $1')) {
          return {
            rows: [
              {
                id: 42,
                name_en: 'Sun Top Orange Drink 250ml',
                name_ar: 'شراب سن توب برتقال 250 مل',
                brand_name: 'Sun Top',
                variant_or_flavor: 'Orange',
                each_size_value: 250,
                each_size_unit: 'ml',
                inner_pack_count: 1,
                is_active: true,
                verification_status: 'verified'
              }
            ]
          };
        }
        return { rows: [] };
      })
    };
    vi.spyOn(dbResolver, 'createGuardedPgClient').mockReturnValue(fakePgClient as any);

    await expect(
      pubService.publishApprovedCatalogBatch({
        manifest: legacyManifestCollision,
        offers: [offer1],
        context: 'DEVELOPMENT_TEST',
        operatorId: 'uat_op',
        referenceDateIso: '2026-11-15'
      })
    ).rejects.toThrow(/CATALOG_PRODUCT_IDENTITY_MISMATCH/);
    expect(fakeQueries.some((q) => q === 'ROLLBACK')).toBe(true);

    // 4. PRODUCTION_UI publication remains strictly blocked
    const prodPreflight = await pubService.assessPublicationPreflight({
      manifest: prodMatchedManifest,
      offers: [offer1],
      context: 'PRODUCTION_UI',
      referenceDateIso: '2026-11-15'
    });
    expect(prodPreflight.ready).toBe(false);
    expect(prodPreflight.blockingReasons.some((r) => r.includes('PRODUCTION_PUBLICATION_BLOCKED'))).toBe(true);
  });
});
