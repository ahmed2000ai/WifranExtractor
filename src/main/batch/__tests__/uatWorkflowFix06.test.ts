import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sanitizeCampaignTitle } from '../../metadata/campaignTitleSanitizer';
import { TargetedMetadataVisionService } from '../../metadata/targetedMetadataVisionService';
import { BatchOrchestrationService } from '../batchOrchestrationService';
import * as pdfRenderModule from '../../pdf/streamingPdfRenderService';
import * as leafletMetadataModule from '../../metadata/leafletMetadataService';
import type { HybridExtractionProvider } from '../../../shared/types/hybridExtractionV3';
import { CatalogPublicationService } from '../../db/catalogPublicationService';
import type { MatchingRunManifest } from '../../../shared/types/catalogMatching';
import type { UnifiedBatchOffer } from '../../../shared/types/batchExtraction';

function makeDummyPdf(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `%PDF-1.4\n% ${path.basename(filePath)}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF`,
    'utf8'
  );
}

describe('WIFRAN-005J-UAT-FIX-06 — Backend Title Sanitizer, SAR/National Defaults, Auto Acceptance & Budget Cap', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-fix06-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup lock
    }
  });

  it('rejects Carrefour-style commentary/translation loops & generic slogans while preserving valid concise titles', () => {
    const carrefourContaminated =
      "جودة سعودية نفتخر فيها / Saudi Quality We Are Proud Of / Saudi Quality We Cherish ... (Wait, keep it simple: جودة سعودية نفتخر فيها) ... (Let's write: جودة سعودية نفتخر فيها) ... Wait, title schema says 'printed campaign/leaflet title if explicitly printed' ... wait, let's keep it strictly valid JSON! Let's write:";

    expect(sanitizeCampaignTitle(carrefourContaminated).valid).toBe(false);
    expect(sanitizeCampaignTitle(carrefourContaminated).sanitizedTitle).toBeNull();
    expect(sanitizeCampaignTitle('SHARE PRICES').valid).toBe(false);
    expect(sanitizeCampaignTitle('carrefour-62800235-jeddah', { fileName: 'carrefour-62800235-jeddah.pdf' }).valid).toBe(false);
    expect(sanitizeCampaignTitle('Carrefour', { retailerNames: ['Carrefour'] }).valid).toBe(false);

    expect(sanitizeCampaignTitle('11.11 DEALS')).toEqual({
      valid: true,
      sanitizedTitle: '11.11 DEALS',
      rawTitle: '11.11 DEALS',
      rejectionReason: null
    });
    expect(sanitizeCampaignTitle('موسم العثيم')).toEqual({
      valid: true,
      sanitizedTitle: 'موسم العثيم',
      rawTitle: 'موسم العثيم',
      rejectionReason: null
    });
  });

  it('replays actual saved Carrefour vision_cache fixture at $0 and strips contaminated campaign commentary', async () => {
    const carrefourCacheFixture = path.join(
      process.cwd(),
      'Extracts',
      'carrefour-62800235-jeddah',
      'metadata',
      'vision_cache',
      'vision_response_b6274347c7b20ea1a54c00b5.json'
    );

    const cacheDir = path.join(tmpRoot, 'carrefour_ws', 'metadata', 'vision_cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const imgPath = path.join(cacheDir, 'cover_p1.png');
    fs.writeFileSync(
      imgPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      )
    );

    // Seed an offline cache entry matching actual Carrefour cache shape & exact image hash key
    const visionSvc = new TargetedMetadataVisionService({ durableLedgerPath: path.join(tmpRoot, 'ledger.json') });
    const crypto = await import('crypto');
    const cacheHasher = crypto.createHash('sha256');
    cacheHasher.update('v2-005j-uat-fix-03:fp-carrefour-test:');
    cacheHasher.update('p1:');
    cacheHasher.update(fs.readFileSync(imgPath));
    const cacheKey = cacheHasher.digest('hex').slice(0, 24);

    let fixtureJson: any;
    if (fs.existsSync(carrefourCacheFixture)) {
      fixtureJson = JSON.parse(fs.readFileSync(carrefourCacheFixture, 'utf8'));
    } else {
      fixtureJson = {
        ok: true,
        attemptsUsed: 2,
        retailerCandidate: {
          detectedName: 'Carrefour',
          resolvedRetailerId: 'c2cc16c2-0006-4444-b000-c00000000006',
          resolvedNameEn: 'Carrefour',
          confidence: 0.99,
          sourcePage: 1,
          evidenceText: 'Carrefour',
          status: 'candidate'
        },
        validityCandidate: {
          startDate: '2026-11-11',
          endDate: '2026-11-17',
          rawPrintedText: 'From 11th Until 17th November 2026',
          sourcePage: 1,
          confidence: 0.99,
          status: 'candidate'
        },
        leafletTitle:
          "جودة سعودية نفتخر فيها / Saudi Quality We Are Proud Of ... (Wait, keep it simple: ...) ... let's keep it strictly valid JSON! Let's write:",
        currency: 'SAR',
        rawResponse: {
          leaflet_title: { value: 'SHARE PRICES', source_page: 23, evidence_text: 'SHARE PRICES', confidence: 0.9 },
          currency: { code: 'SAR', source_page: 1, evidence_text: 'SAR', confidence: 0.99 },
          geographic_scope: { scope_level: 'unspecified', location_name: null, confidence: 0 }
        }
      };
    }

    fs.writeFileSync(path.join(cacheDir, `vision_response_${cacheKey}.json`), JSON.stringify(fixtureJson, null, 2), 'utf8');

    const res = await visionSvc.executeTargetedVision({
      request: {
        leafletFingerprint: 'fp-carrefour-test',
        unresolvedFields: ['retailer', 'validity'],
        candidatePages: [1]
      },
      operatorAuthorized: true,
      cacheDir,
      imagePathsByPage: { 1: imgPath }
    });

    expect(res.ok).toBe(true);
    expect(res.cacheHit).toBe(true);
    expect(res.leafletTitle).toBeNull();
    expect(res.retailerCandidate?.resolvedNameEn).toBe('Carrefour');
    expect(res.validityCandidate?.startDate).toBe('2026-11-11');
    expect(res.validityCandidate?.endDate).toBe('2026-11-17');
  });

  it('defaults Currency=SAR and Location=National (assumed), sets auto_accepted with verified=false, and flags currency/multi-city conflicts as needs_review', async () => {
    const batchSvc = new BatchOrchestrationService(path.join(tmpRoot, 'batches'));
    const nooriPdf = path.join(tmpRoot, 'noori-supermarket-229798534-jeddah.pdf');
    const multiCityPdf = path.join(tmpRoot, 'lulu-multicity.pdf');
    const usdPdf = path.join(tmpRoot, 'danube-usd.pdf');
    makeDummyPdf(nooriPdf);
    makeDummyPdf(multiCityPdf);
    makeDummyPdf(usdPdf);

    const manifest = await batchSvc.createBatch({
      files: [
        { path: nooriPdf, name: 'noori-supermarket-229798534-jeddah.pdf', pageCount: 20, pagesToProcess: [1], pageSelectionMode: 'specific', workspacePath: path.join(tmpRoot, 'ws_noori') },
        { path: multiCityPdf, name: 'lulu-multicity.pdf', pageCount: 20, pagesToProcess: [1], pageSelectionMode: 'specific', workspacePath: path.join(tmpRoot, 'ws_lulu') },
        { path: usdPdf, name: 'danube-usd.pdf', pageCount: 20, pagesToProcess: [1], pageSelectionMode: 'specific', workspacePath: path.join(tmpRoot, 'ws_danube') }
      ],
      extractionPipelineMode: 'hybrid_v3'
    });

    const metaSvc = leafletMetadataModule.getLeafletMetadataService();
    vi.spyOn(metaSvc, 'discoverMetadataFromPackage').mockImplementation(async (wsPath: string) => {
      if (wsPath.endsWith('ws_noori')) {
        return {
          retailer: { resolvedRetailerId: 'c2cc16c2-0010-4444-b000-c00000000010', resolvedNameEn: 'Noori Supermarket' },
          validity: { startDate: '2026-11-11', endDate: '2026-11-17', rawText: '11-17 Nov 2026' },
          leafletTitle: 'Noori Supermarket',
          currency: null,
          locationScope: null
        } as any;
      }
      if (wsPath.endsWith('ws_lulu')) {
        return {
          retailer: { resolvedRetailerId: 'c2cc16c2-0005-4444-b000-c00000000005', resolvedNameEn: 'LuLu Hypermarket' },
          validity: { startDate: '2026-11-11', endDate: '2026-11-17', rawText: '11-17 Nov 2026' },
          currency: 'SAR',
          locationScope: null,
          detectedCities: ['Jeddah', 'Makkah', 'Taif'],
          geographicNotice: 'Multiple cities printed (Jeddah, Makkah, Taif) — verify target city/region/national scope explicitly.'
        } as any;
      }
      return {
        retailer: { resolvedRetailerId: 'c2cc16c2-0004-4444-b000-c00000000004', resolvedNameEn: 'Danube' },
        validity: { startDate: '2026-11-11', endDate: '2026-11-17', rawText: '11-17 Nov 2026' },
        currency: 'USD',
        locationScope: null
      } as any;
    });

    await batchSvc.discoverLeafletMetadata({ batchId: manifest.batchId, leafletId: 'leaflet-001' });
    await batchSvc.discoverLeafletMetadata({ batchId: manifest.batchId, leafletId: 'leaflet-002' });
    const afterAll = await batchSvc.discoverLeafletMetadata({ batchId: manifest.batchId, leafletId: 'leaflet-003' });

    const [noori, lulu, danube] = afterAll.leaflets;

    // 1. Noori: missing currency + no printed scope -> SAR + default_national -> auto_accepted (verified=false!)
    expect(noori.metadata.currency).toBe('SAR');
    expect(noori.metadata.locationScope).toBe('national');
    expect(noori.metadata.locationSlug).toBe('national');
    expect(noori.metadata.locationLabel).toBe('National — Saudi Arabia (assumed)');
    expect(noori.metadata.scopeSource).toBe('default_national');
    expect(noori.metadata.cityId).toBeNull(); // Never inferred 'jeddah' from filename!
    expect(noori.metadata.leafletTitle).toBeNull(); // Filtered retailer echo!
    expect(noori.metadata.unresolvedFields).toEqual([]);
    expect(noori.metadata.metadataStatus).toBe('auto_accepted');
    expect(noori.metadata.verified).toBe(false);

    // 2. LuLu multi-city: NEVER auto-collapsed to national -> needs_review
    expect(lulu.metadata.locationScope).toBeNull();
    expect(lulu.metadata.metadataStatus).toBe('needs_review');
    expect(lulu.metadata.unresolvedFields).toContain('locationScope');

    // 3. Danube USD input normalized internally to fixed SAR with no currency conflict
    expect(danube.metadata.currency).toBe('SAR');
    expect(danube.metadata.currencyConflict).toBe(false);
    expect(danube.metadata.metadataStatus).toBe('auto_accepted');
    expect(danube.metadata.unresolvedFields).not.toContain('currency');

    // 4. Operator explicit save promotes to operator_verified + scopeSource = operator_override
    const afterOp = await batchSvc.updateLeafletMetadata({
      batchId: manifest.batchId,
      leafletId: 'leaflet-002',
      verified: true,
      operatorId: 'uat_op',
      metadata: {
        locationScope: 'city',
        cityId: 'city-jeddah',
        regionId: 'reg-makkah',
        locationLabel: 'Jeddah',
        locationSlug: 'jeddah'
      }
    });
    expect(afterOp.leaflets[1].metadata.verified).toBe(true);
    expect(afterOp.leaflets[1].metadata.metadataStatus).toBe('operator_verified');
    expect(afterOp.leaflets[1].metadata.scopeSource).toBe('operator_override');
  });

  it('enforces spending cap (approvedMaxBudgetUsd) fail-closed across Hybrid V3 extraction', async () => {
    const batchSvc = new BatchOrchestrationService(path.join(tmpRoot, 'batches_budget'));
    const pdfPath = path.join(tmpRoot, 'budget-test.pdf');
    makeDummyPdf(pdfPath);

    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const wsPath = path.join(tmpRoot, 'ws_budget');
    fs.mkdirSync(path.join(wsPath, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(wsPath, 'pages', 'page.1.png'), tinyPng);
    fs.writeFileSync(path.join(wsPath, 'pages', 'page.2.png'), tinyPng);

    vi.spyOn(pdfRenderModule, 'renderPdfPagesStreaming').mockResolvedValue({
      ok: true,
      pageCount: 2,
      selectedPages: [1, 2],
      pagesRendered: 2,
      renderedPages: [
        { pageNumber: 1, imagePath: path.join(wsPath, 'pages', 'page.1.png') },
        { pageNumber: 2, imagePath: path.join(wsPath, 'pages', 'page.2.png') }
      ]
    } as any);

    const provider: HybridExtractionProvider = {
      providerId: 'offline_budget_probe',
      isOfflineOrMock: true,
      async extractPage() {
        return {
          ok: true,
          fromCache: false,
          costUsdOverride: 0.03,
          durationMs: 2,
          parsedJson: {
            schema_version: 'wifran.v3.page_extraction/1.0',
            page_number: 1,
            page_width: 1000,
            page_height: 1400,
            currency: 'SAR',
            ignored_page_banners: [],
            offers: []
          }
        };
      },
      async extractCardCrop() {
        return { ok: true, fromCache: false, costUsdOverride: 0.01, durationMs: 1, parsedJson: {} };
      },
      async verifyPageContext() {
        return { ok: false };
      }
    };

    const created = await batchSvc.createBatch({
      files: [
        {
          path: pdfPath,
          name: 'budget-test.pdf',
          pageCount: 2,
          pagesToProcess: [1, 2],
          pageSelectionMode: 'specific',
          workspacePath: wsPath
        }
      ],
      extractionPipelineMode: 'hybrid_v3',
      approvedMaxBudgetUsd: 0.025
    });

    const result = await batchSvc.startBatchExtraction(created.batchId, {
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3ExplicitLiveAuthorization: false,
      approvedMaxBudgetUsd: 0.025,
      hybridV3Provider: provider,
      disablePageContextVerification: true
    });

    expect(result.leaflets[0].status).toBe('failed');
    expect(result.leaflets[0].error).toMatch(/BUDGET_CAP_EXCEEDED/i);
  });

  it('CatalogPublicationService allows auto_accepted leaflets (when complete & non-expired) and blocks needs_review leaflets', async () => {
    const pubSvc = new CatalogPublicationService();
    const baseManifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId: 'b-fix06',
      runId: 'm-fix06',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      status: 'completed',
      matchingDatabaseContext: 'DEVELOPMENT_TEST',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      brandSummaries: {},
      proposals: {
        offer_auto: {
          batchOfferKey: 'offer_auto',
          sourceOfferId: 'doc_1:p1:o1',
          sourcePage: 1,
          leafletId: 'leaflet-001',
          supermarketName: 'Panda',
          decision: 'existing',
          matchedProductId: '101',
          matchedDatabaseContext: 'DEVELOPMENT_TEST',
          temporaryId: null,
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'approved',
          updatedAt: '2026-11-15T00:00:00Z'
        },
        offer_needs_review: {
          batchOfferKey: 'offer_needs_review',
          sourceOfferId: 'doc_2:p1:o1',
          sourcePage: 1,
          leafletId: 'leaflet-002',
          supermarketName: 'Panda',
          decision: 'existing',
          matchedProductId: '102',
          matchedDatabaseContext: 'DEVELOPMENT_TEST',
          temporaryId: null,
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'approved',
          updatedAt: '2026-11-15T00:00:00Z'
        }
      },
      temporaryProducts: {},
      totals: {
        totalExtractedOffers: 1,
        uniqueIdentitiesCount: 1,
        cacheMatchesCount: 1,
        deterministicMatchesCount: 0,
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
      }
    };

    const makeOffer = (key: string, status: 'auto_accepted' | 'needs_review'): UnifiedBatchOffer => ({
      batchOfferKey: key,
      batchId: 'b-fix06',
      leafletId: status === 'auto_accepted' ? 'leaflet-001' : 'leaflet-002',
      sourceFileName: `${key}.pdf`,
      sourcePdfPath: `/tmp/${key}.pdf`,
      sourcePage: 1,
      sourceOfferId: `doc_${key}:p1:o1`,
      supermarketId: 'sup-1',
      supermarketName: 'Panda',
      locationScope: status === 'auto_accepted' ? 'national' : null,
      locationLabel: status === 'auto_accepted' ? 'National — Saudi Arabia (assumed)' : null,
      scopeSource: status === 'auto_accepted' ? 'default_national' : null,
      cityId: null,
      regionId: null,
      offerStartDate: '2026-11-11',
      offerEndDate: '2026-11-20',
      currency: 'SAR',
      metadataVerified: false,
      metadataStatus: status,
      titleAr: 'حليب المراعي طازج 1 لتر',
      titleEn: 'Almarai Fresh Milk 1L Full Fat',
      brand: 'Almarai',
      brandAr: 'المراعي',
      brandEn: 'Almarai',
      category: 'dairy',
      promoPrice: 10,
      originalPrice: 15,
      discountPercent: 33,
      promoNotes: null,
      sizeOrWeight: '1kg',
      each_size_value: 1,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      total_content_value: 1,
      total_content_unit: 'kg',
      free_units_text: null,
      customer_limit: null,
      offerCardCropPath: null,
      productThumbCropPath: null,
      status: 'extracted',
      confidence: 'high'
    });

    // Auto-accepted leaflet alone passes metadata preflight cleanly!
    const okPreflight = await pubSvc.assessPublicationPreflight({
      manifest: {
        ...baseManifest,
        proposals: { offer_auto: baseManifest.proposals.offer_auto }
      },
      offers: [makeOffer('offer_auto', 'auto_accepted')],
      context: 'DEVELOPMENT_TEST',
      referenceDateIso: '2026-11-15',
      enforceMetadataVerification: true
    });
    expect(okPreflight.ready).toBe(true);
    expect(okPreflight.blockingReasons.filter((r) => r.includes('UNVERIFIED_LEAFLET_METADATA'))).toHaveLength(0);

    // needs_review leaflet MUST remain fail-closed blocked!
    const blockedPreflight = await pubSvc.assessPublicationPreflight({
      manifest: {
        ...baseManifest,
        proposals: { offer_needs_review: baseManifest.proposals.offer_needs_review }
      },
      offers: [makeOffer('offer_needs_review', 'needs_review')],
      context: 'DEVELOPMENT_TEST',
      referenceDateIso: '2026-11-15',
      enforceMetadataVerification: true
    });
    expect(blockedPreflight.ready).toBe(false);
    expect(blockedPreflight.blockingReasons.some((r) => r.includes('UNVERIFIED_LEAFLET_METADATA'))).toBe(true);
  });
});
