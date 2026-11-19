/**
 * WIFRAN-005J-UAT-FIX-05
 * Comprehensive Offline Verification Suite (Backend & Publication Gates)
 * Zero paid Gemini calls. Zero Supabase writes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  normalizeValidityRange,
  parseValidityDates,
  detectSingleDayOfferException
} from '../../metadata/validityDateParser';
import { TargetedMetadataVisionService } from '../../metadata/targetedMetadataVisionService';
import { BatchOrchestrationService } from '../batchOrchestrationService';
import { CatalogPublicationService } from '../../db/catalogPublicationService';
import type { HybridExtractionProvider } from '../../../shared/types/hybridExtractionV3';
import type { MatchingRunManifest } from '../../../shared/types/catalogMatching';

function makeMinimalValidPdf(filePath: string): void {
  const minimalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
xref
0 4
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
trailer << /Size 4 /Root 1 0 R >>
startxref
190
%%EOF`;
  fs.writeFileSync(filePath, minimalPdf, 'utf8');
}

async function makeDummyPng(filePath: string): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const pngBuf = await sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 245, g: 245, b: 245 } }
  })
    .png()
    .toBuffer();
  fs.writeFileSync(filePath, pngBuf);
}

describe('WIFRAN-005J-UAT-FIX-05 — Date Normalization, Multi-City Scope, & Streamlined Workflow', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-fix05-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('Test 1: parses Lulu validity date formats including ordinals, spaces, pipes, dashes, and bilingual Arabic/English', () => {
    const cases = [
      '11th 17th NOVEMBER 2026',
      '11th | 17th | NOVEMBER 2026',
      '11th - 17th November 2026',
      '11–17 November 2026',
      'NOVEMBER 11th - 17th, 2026',
      '11 | 17 نوفمبر 2026',
      'من 11 إلى 17 نوفمبر 2026'
    ];

    for (const raw of cases) {
      const parsed = parseValidityDates(raw, { pageNumber: 1 });
      expect(parsed, `Failed for "${raw}"`).not.toBeNull();
      expect(parsed!.startDate, `Start mismatch for "${raw}"`).toBe('2026-11-11');
      expect(parsed!.endDate, `End mismatch for "${raw}"`).toBe('2026-11-17');
      expect(parsed!.isAmbiguous).toBe(false);
    }

    // Ambiguous / invalid printed text must never guess from filename or inject 7 days
    const unparseable = normalizeValidityRange({
      startDate: 'invalid-date-commentary',
      endDate: null,
      rawText: 'Special Winter Promotion'
    });
    expect(unparseable.startDate).toBeNull();
    expect(unparseable.endDate).toBeNull();
    expect(unparseable.normalizationError).toMatch(/Unable to normalize|malformed/i);
  });

  it('Test 2: recovers clean ISO dates when model returns malformed commentary inside start_date (actual Lulu cached Vision defect)', async () => {
    const visionService = new TargetedMetadataVisionService();
    const cacheDir = path.join(tmpRoot, 'vision_cache');
    fs.mkdirSync(cacheDir, { recursive: true });

    const img1 = path.join(tmpRoot, 'cover.png');
    await makeDummyPng(img1);

    // Exact structure observed in real cached Lulu Vision response:
    const malformedLuluMock = {
      candidate_retailer: {
        name: 'Lulu Hypermarket',
        source_page: 1,
        evidence_text: 'LuLu',
        confidence: 1
      },
      validity: {
        start_date: '2026-11-11Date validation: 2026-11-11 to 2026-11-17',
        end_date: null,
        raw_text: '11th 17th NOVEMBER 2026',
        source_page: 1,
        calendar_type: 'gregorian' as const,
        is_general_or_exception: 'general' as const,
        confidence: 1
      },
      leaflet_title: {
        value: '11.11 DEALS',
        source_page: 1,
        evidence_text: '11.11 DEALS',
        confidence: 1
      },
      currency: {
        code: 'SAR',
        source_page: 3,
        evidence_text: 'Currency symbol for SAR printed next to all product prices',
        confidence: 1
      },
      geographic_scope: {
        scope_level: 'city' as const,
        location_name: 'Jeddah, Makkah, Yanbu, Tabuk, Khamis Mushaith, Taif, Madinah',
        source_page: 3,
        evidence_text:
          'جدة ، مكة ، ينبع ، تبوك ، خميس مشيط ، الطائف ، المنورة JEDDAH - MAKKAH - YANBU - TABUK - KHAMIS MUSHAITH - TAIF - MADINAH',
        confidence: 1
      }
    };

    const res = await visionService.executeTargetedVision({
      request: {
        leafletFingerprint: 'lulu-fp-01',
        unresolvedFields: ['retailer', 'validity', 'title', 'currency', 'locationScope'],
        candidatePages: [1, 3],
        maxAttempts: 2
      },
      operatorAuthorized: true,
      mockResponsesByPage: { 1: malformedLuluMock, 3: malformedLuluMock },
      cacheDir
    });

    expect(res.ok).toBe(true);
    expect(res.validityCandidate?.startDate).toBe('2026-11-11');
    expect(res.validityCandidate?.endDate).toBe('2026-11-17');
    expect(res.validityCandidate?.isAmbiguous).toBe(false);
    expect(res.validityCandidate?.normalizationError).toBeNull();
    expect(res.currency).toBe('SAR');
    expect(res.leafletTitle).toBe('11.11 DEALS');

    // Test 3/4 check on multi-city scope: MUST NOT collapse into national or single city!
    expect(res.locationHint).toBeUndefined();
    expect(res.detectedCities).toEqual([
      'Jeddah',
      'Makkah',
      'Yanbu',
      'Tabuk',
      'Khamis Mushaith',
      'Taif',
      'Madinah'
    ]);
    expect(res.geographicNotice).toMatch(/Multiple cities printed/i);
    expect(res.evidenceByField?.locationScope?.sourcePage).toBe(3);
    expect(res.evidenceByField?.locationScope?.evidenceText).toContain('JEDDAH - MAKKAH - YANBU');
  });

  it('Test 3: BatchOrchestrationService defaults to hybrid_v3, allows extraction without pre-verified metadata, discovers draft metadata & flags ONE DAY ONLY', async () => {
    const batchesDir = path.join(tmpRoot, 'batches');
    const batchService = new BatchOrchestrationService(batchesDir);

    const luluPdf = path.join(tmpRoot, 'lulu-hypermarket-63800343-jeddah.pdf');
    makeMinimalValidPdf(luluPdf);

    // Default pipeline must be hybrid_v3 when omitted
    const created = await batchService.createBatch({
      files: [
        {
          path: luluPdf,
          name: 'lulu-hypermarket-63800343-jeddah.pdf',
          sizeBytes: 512,
          contentFingerprint: 'lulu-fingerprint-abc',
          pageCount: 85,
          pageSelectionMode: 'specific',
          pageSelectionInput: '3',
          pagesToProcess: [3],
          workspacePath: path.join(tmpRoot, 'ws_lulu')
        }
      ]
    });

    expect(created.extractionPipelineMode).toBe('hybrid_v3');
    expect(created.leaflets[0].metadata.verified).toBe(false);

    // Pre-create page.3.png so render step is skipped cleanly offline
    await makeDummyPng(path.join(tmpRoot, 'ws_lulu', 'pages', 'page.3.png'));

    const luluPagePayload = {
      is_loyalty_page: false,
      loyalty_program_name: null,
      validity_start_date: null,
      validity_end_date: null,
      page_currency: 'SAR',
      ignored_banners: [
        'LULU HYPERMARKET',
        '11.11 DEALS',
        '11th 17th NOVEMBER 2026',
        'JEDDAH - MAKKAH - YANBU - TABUK - KHAMIS MUSHait - TAIF - MADINAH',
        'ONE DAY ONLY 11 Nov'
      ],
      offers: [
        {
          offer_number: 1,
          arabic_title: 'زيت زيتون بكر 1 لتر',
          english_title: 'Virgin Olive Oil 1L',
          brand: 'Lulu',
          size_text: '1L',
          promo_badge_text: null,
          assortment_status: 'confirmed_single_sku',
          visible_variant_count: 1,
          assortment_evidence: [],
          is_enumerated_list_complete: true,
          compound_group_id: null,
          shared_caption_text: null,
          item_domain: 'grocery',
          category_slug: 'oils',
          promo_price: 19.95,
          original_price: 34.95,
          currency: 'SAR',
          currency_evidence: 'SAR',
          price_basis: 'each',
          price_role_confidence: 'high',
          sale_basis: 'single_unit',
          is_per_weight_pricing: false,
          promo_conditions: 'ONE DAY ONLY',
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
              brand_en: 'Lulu',
              brand_ar: 'لولو',
              product_name_en: 'Virgin Olive Oil 1L',
              product_name_ar: 'زيت زيتون بكر 1 لتر',
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

    const mockHybridProvider: HybridExtractionProvider = {
      providerId: 'offline_fix05_mock',
      isOfflineOrMock: true,
      async extractPage() {
        return {
          ok: true,
          fromCache: false,
          durationMs: 10,
          costUsdOverride: 0.023,
          parsedJson: luluPagePayload
        };
      },
      async extractCardCrop() {
        return {
          ok: true,
          fromCache: false,
          durationMs: 3,
          costUsdOverride: 0.0001,
          parsedJson: luluPagePayload
        };
      },
      async verifyPageContext() {
        return { ok: false, errorMessage: 'disabled' };
      }
    };

    // Must NOT throw METADATA_VERIFICATION_REQUIRED!
    const finished = await batchService.startBatchExtraction(created.batchId, {
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3ExplicitLiveAuthorization: false,
      hybridV3Provider: mockHybridProvider,
      disablePageContextVerification: true,
      skipPdfRenderIfPagesExist: true
    });

    expect(finished.status).toBe('completed');
    const leaf = finished.leaflets[0];

    // Draft metadata was discovered from Hybrid V3 extraction banners without extra paid calls
    expect(leaf.metadata.verified).toBe(false); // Not auto-verified
    expect(leaf.metadata.offerStartDate).toBe('2026-11-11');
    expect(leaf.metadata.offerEndDate).toBe('2026-11-17');
    expect(leaf.metadata.currency).toBe('SAR');
    expect(leaf.metadata.leafletTitle).toBe('11.11 DEALS');
    // Multi-city header preserved & NOT collapsed into national/single city
    expect(leaf.metadata.locationScope).toBeNull();
    expect(leaf.metadata.detectedCities?.length).toBeGreaterThanOrEqual(5);
    expect(leaf.metadata.geographicNotice).toMatch(/Multiple cities printed/i);
    // ONE DAY ONLY recorded as conflicting exception instead of overwriting 11th..17th range
    expect(leaf.metadata.conflictingValidity?.some((c) => /11 Nov/i.test(c.rawPrintedText || ''))).toBe(true);

    // Extracted offer preserved in staged local draft with ONE DAY ONLY exception flag
    const unified = await batchService.getUnifiedBatchOffers(created.batchId);
    expect(unified).toHaveLength(1);
    expect(unified[0].conflictCodes).toContain('SINGLE_DAY_OFFER_EXCEPTION');
    expect(unified[0].promoNotes).toMatch(/ONE DAY ONLY/i);
    expect(detectSingleDayOfferException('ONE DAY ONLY').isSingleDay).toBe(true);

    // Publication Gate MUST reject unverified metadata + unresolved multi-city scope!
    const pubService = new CatalogPublicationService();
    const matchingManifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId: created.batchId,
      runId: 'run-uat-05',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'completed',
      model: 'gemini-3.1-flash-lite-preview',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      matchingDatabaseContext: 'DEVELOPMENT_TEST',
      totals: {
        totalOffers: 1,
        matchedExisting: 1,
        matchedTemporary: 0,
        newTemporaryProducts: 0,
        unresolved: 0,
        tokensInput: 0,
        tokensOutput: 0,
        actualCostUsd: 0.01
      } as any,
      brandSummaries: {},
      requests: {},
      proposals: {
        [unified[0].batchOfferKey]: {
          batchOfferKey: unified[0].batchOfferKey,
          leafletId: leaf.leafletId,
          sourcePage: 3,
          sourceOfferId: unified[0].sourceOfferId,
          status: 'existing_product_matched',
          decision: 'existing',
          matchedProductId: 101,
          confidence: 0.99,
          rationale: 'Matched in test',
          operatorDecision: 'approved',
          candidateSnapshot: { titleEn: 'Virgin Olive Oil 1L' },
          matchedDatabaseContext: 'DEVELOPMENT_TEST'
        } as any
      },
      temporaryProducts: {}
    };

    const blockedPreflight = await pubService.assessPublicationPreflight({
      manifest: matchingManifest,
      offers: unified,
      context: 'DEVELOPMENT_TEST',
      referenceDateIso: '2026-11-11',
      enforceMetadataVerification: true
    });
    expect(blockedPreflight.ready).toBe(false);
    expect(blockedPreflight.blockingReasons.some((r) => /UNVERIFIED_LEAFLET_METADATA|MISSING_RETAILER_OR_SCOPE_METADATA/i.test(r))).toBe(true);

    // PRODUCTION_UI remains strictly blocked even after verification
    await batchService.updateLeafletMetadata({
      batchId: created.batchId,
      leafletId: leaf.leafletId,
      verified: true,
      operatorId: 'uat_op',
      metadata: {
        supermarketId: 'sup-lulu',
        supermarketName: 'LuLu Hypermarket',
        locationScope: 'city',
        cityId: 'city-jeddah',
        regionId: 'reg-makkah',
        locationLabel: 'Jeddah',
        offerStartDate: '2026-11-11',
        offerEndDate: '2026-11-17',
        currency: 'SAR'
      }
    });

    const unifiedVerified = await batchService.getUnifiedBatchOffers(created.batchId);
    expect(unifiedVerified[0].blockingErrors).toEqual([]);
    const prodBlocked = await pubService.assessPublicationPreflight({
      manifest: matchingManifest,
      offers: unifiedVerified,
      context: 'PRODUCTION_UI',
      referenceDateIso: '2026-11-11',
      enforceMetadataVerification: true
    });
    expect(prodBlocked.ready).toBe(false);
    expect(prodBlocked.blockingReasons.some((r) => /PRODUCTION_PUBLICATION_BLOCKED/i.test(r))).toBe(true);

    // DEVELOPMENT_TEST passes ONLY once verified + resolved city/region/national scope + matching complete!
    const devReady = await pubService.assessPublicationPreflight({
      manifest: matchingManifest,
      offers: unifiedVerified,
      context: 'DEVELOPMENT_TEST',
      referenceDateIso: '2026-11-11',
      enforceMetadataVerification: true
    });
    expect(devReady.blockingReasons).toEqual([]);
    expect(devReady.ready).toBe(true);
  });

  it('Test 4: preserves backwards compatibility for legacy_rev1 manifests and sanitizes malformed dates when loading manifest', async () => {
    const batchesDir = path.join(tmpRoot, 'batches');
    const batchService = new BatchOrchestrationService(batchesDir);
    const pdf = path.join(tmpRoot, 'legacy.pdf');
    makeMinimalValidPdf(pdf);

    const legacyBatch = await batchService.createBatch({
      files: [{ path: pdf, name: 'legacy.pdf', pageCount: 1 }],
      extractionPipelineMode: 'legacy_rev1'
    });
    expect(legacyBatch.extractionPipelineMode).toBe('legacy_rev1');

    // Inject malformed date defect (simulating pre-fix manifest on disk)
    const manifestPath = path.join(batchesDir, legacyBatch.batchId, 'batch-manifest.json');
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    raw.leaflets[0].metadata.offerStartDate = '2026-11-11Date validation: 2026-11-11 to 2026-11-17';
    raw.leaflets[0].metadata.offerEndDate = null;
    raw.leaflets[0].metadata.evidenceByField = {
      validity: { field: 'validity', sourcePage: 1, method: 'targeted_vision', evidenceText: '11th 17th NOVEMBER 2026' }
    };
    fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2), 'utf8');

    const reloaded = await batchService.loadBatchManifest(legacyBatch.batchId);
    expect(reloaded?.extractionPipelineMode).toBe('legacy_rev1');
    expect(reloaded?.leaflets[0].metadata.offerStartDate).toBe('2026-11-11');
    expect(reloaded?.leaflets[0].metadata.offerEndDate).toBe('2026-11-17');
  });
});
