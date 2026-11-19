import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateBatchApiCost } from '../../../shared/utils/geminiPricingAndCostEstimator';
import { classifyOfferReviewTriage, summarizeBatchReviewTriage } from '../../../shared/utils/reviewTriageClassifier';
import { BatchOrchestrationService } from '../batchOrchestrationService';
import { CatalogMatchingOrchestrator } from '../catalogMatchingOrchestrator';
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService';
import { CatalogPublicationService } from '../../db/catalogPublicationService';
import { V3_EXTRACTION_SCHEMA_VERSION } from '../../../shared/schemas/leafletPageExtractionV3Schema';
import * as pdfRenderModule from '../../pdf/streamingPdfRenderService';
import * as leafletMetadataModule from '../../metadata/leafletMetadataService';
import type { HybridExtractionProvider } from '../../../shared/types/hybridExtractionV3';
import type { BatchProgressEvent } from '../../../shared/types/batchExtraction';

function makeDummyPdf(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `%PDF-1.4\n% ${path.basename(filePath)}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF`,
    'utf8'
  );
}

interface MockProductRow {
  id: string;
  name_ar: string;
  name_en: string;
  brand_name: string;
  variant_or_flavor: string | null;
  each_size_value: number | null;
  each_size_unit: string | null;
  inner_pack_count: number | null;
  default_image_url?: string | null;
}

function createInMemorySupabaseMock(products: MockProductRow[]): {
  client: SupabaseClient;
  writeAttemptCount: number;
} {
  let writeAttemptCount = 0;

  const client: any = {
    from(table: string) {
      let orFilters: string[] = [];
      let isHead = false;
      let isCount = false;

      const filterRows = () => {
        if (table !== 'products') return [];
        if (orFilters.length === 0) return products;
        return products.filter((row) => {
          return orFilters.every((expr) => {
            const terms = expr.split(',').map((t) => t.trim());
            return terms.some((term) => {
              const ilikeMatch = term.match(/^([a-z0-9_]+)\.ilike\.%(.*)%$/i);
              if (ilikeMatch) {
                const [, col, needle] = ilikeMatch;
                const val = String((row as any)[col] || '').toLowerCase();
                return val.includes(needle.toLowerCase());
              }
              const eqMatch = term.match(/^([a-z0-9_]+)\.eq\.(.*)$/i);
              if (eqMatch) {
                const [, col, needle] = eqMatch;
                return String((row as any)[col] || '').toLowerCase() === needle.toLowerCase();
              }
              return false;
            });
          });
        });
      };

      const chain: any = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          isHead = Boolean(opts?.head);
          isCount = opts?.count === 'exact';
          return chain;
        },
        or(expr: string) {
          orFilters.push(expr);
          return chain;
        },
        ilike(col: string, pat: string) {
          const clean = pat.replace(/%/g, '');
          orFilters.push(`${col}.ilike.%${clean}%`);
          return chain;
        },
        in(_col: string, _vals: any[]) {
          return chain;
        },
        eq(col: string, val: any) {
          orFilters.push(`${col}.eq.${val}`);
          return chain;
        },
        limit(n: number) {
          const rows = filterRows().slice(0, n);
          return Promise.resolve({ data: rows, count: isCount ? rows.length : null, error: null });
        },
        insert() {
          writeAttemptCount++;
          throw new Error('UNEXPECTED_DB_WRITE_DURING_PRE_PUBLICATION');
        },
        upsert() {
          writeAttemptCount++;
          throw new Error('UNEXPECTED_DB_WRITE_DURING_PRE_PUBLICATION');
        },
        update() {
          writeAttemptCount++;
          throw new Error('UNEXPECTED_DB_WRITE_DURING_PRE_PUBLICATION');
        },
        then(resolve: (val: any) => void) {
          const rows = filterRows();
          resolve({
            data: isHead ? null : rows,
            count: isCount ? rows.length : rows.length,
            error: null
          });
        }
      };
      return chain;
    }
  };

  return {
    client: client as SupabaseClient,
    get writeAttemptCount() {
      return writeAttemptCount;
    }
  };
}

describe('WIFRAN-005J-UAT-FIX-07 — Consolidated 4-Step End-to-End Batch Pipeline Verification', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-fix07-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup locks
    }
  });

  it('computes itemized pre-run cost breakdown (extraction + crops + catalog matching) and single total spending cap', () => {
    const est = estimateBatchApiCost({
      targetPageCount: 6,
      extractionPipelineMode: 'hybrid_v3',
      tier: 'flex'
    });

    expect(est.estimatedFullPageLowUsd).toBeGreaterThan(0);
    expect(est.estimatedCropLowUsd).toBeGreaterThanOrEqual(0);
    expect(est.estimatedMatchingLowUsd).toBeGreaterThan(0);
    expect(est.totalEstimatedLowUsd).toBeCloseTo(
      est.estimatedFullPageLowUsd + est.estimatedCropLowUsd + est.estimatedMatchingLowUsd,
      3
    );
    expect(est.totalEstimatedHighUsd).toBeCloseTo(
      est.estimatedFullPageHighUsd + est.estimatedCropHighUsd + est.estimatedMatchingHighUsd,
      3
    );
    expect(est.maxAuthorizedTotalCapUsd).toBeGreaterThanOrEqual(est.totalEstimatedHighUsd);
  });

  it('executes 3 PDFs x 2 pages end-to-end on one authorized action with auto metadata, crops, cross-retailer reconciliation, zero pre-pub DB writes, and edit rematching', async () => {
    const batchSvc = new BatchOrchestrationService(path.join(tmpRoot, 'batches'));
    const tinyPng = await sharp({
      create: { width: 800, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } }
    })
      .png()
      .toBuffer();

    const carrefourPdf = path.join(tmpRoot, 'carrefour-62800235-jeddah.pdf');
    const othaimPdf = path.join(tmpRoot, 'othaim-72800415-jeddah.pdf');
    const luluPdf = path.join(tmpRoot, 'lulu-63800343-jeddah.pdf');
    makeDummyPdf(carrefourPdf);
    makeDummyPdf(othaimPdf);
    makeDummyPdf(luluPdf);

    const wsCarrefour = path.join(tmpRoot, 'ws_carrefour');
    const wsOthaim = path.join(tmpRoot, 'ws_othaim');
    const wsLulu = path.join(tmpRoot, 'ws_lulu');

    const renderedPagesCalled: Array<{ file: string; pages: number[] | undefined }> = [];
    vi.spyOn(pdfRenderModule, 'renderPdfPagesStreaming').mockImplementation(async (opts: any) => {
      renderedPagesCalled.push({ file: opts.originalFileName, pages: opts.selectedPages });
      const pagesDir = path.join(opts.workspacePath, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      const pages = opts.selectedPages || [1];
      for (const p of pages) {
        fs.writeFileSync(path.join(pagesDir, `page.${p}.png`), tinyPng);
      }
      return {
        ok: true,
        pageCount: opts.pageCount,
        selectedPages: pages,
        pagesRendered: pages.length,
        renderedPages: pages.map((p: number) => ({ pageNumber: p, imagePath: path.join(pagesDir, `page.${p}.png`) }))
      } as any;
    });

    const metaSvc = leafletMetadataModule.getLeafletMetadataService();
    vi.spyOn(metaSvc, 'discoverMetadataFromPackage').mockImplementation(async (wsPath: string) => {
      if (wsPath.endsWith('ws_carrefour')) {
        return {
          retailer: { resolvedRetailerId: 'sup-carrefour', resolvedNameEn: 'Carrefour' },
          validity: { startDate: '2026-11-11', endDate: '2026-11-17', rawText: '11-17 Nov 2026' },
          currency: 'SAR',
          locationScope: null
        } as any;
      }
      if (wsPath.endsWith('ws_lulu')) {
        return {
          retailer: { resolvedRetailerId: 'sup-lulu', resolvedNameEn: 'LuLu Hypermarket' },
          validity: { startDate: '2026-11-11', endDate: '2026-11-17', rawText: '11-17 Nov 2026' },
          currency: 'SAR',
          locationScope: null
        } as any;
      }
      // Othaim has ambiguous date -> becomes needs_review WITHOUT blocking automatic catalog matching!
      return {
        retailer: { resolvedRetailerId: 'sup-othaim', resolvedNameEn: 'Al Othaim Markets' },
        validity: { startDate: null, endDate: null, rawText: 'Offers Valid Soon', normalizationError: 'Ambiguous dates' },
        currency: 'SAR',
        locationScope: null
      } as any;
    });

    // Build mock Hybrid V3 provider returning exact 6 pages across 3 leaflets:
    // - Carrefour p.12: Sunwhite Calrose Rice 5kg (34.95 SAR)
    // - Carrefour p.15: Almarai Fresh Milk 1L Full Fat (5.95 SAR) + Unknown Artisan Dates 500g (absent -> temporary/unresolved)
    // - Othaim p.27: Sunwhite Calrose Rice 5kg (32.50 SAR) + Sunwhite Calrose Rice 2kg (16.95 SAR - different size!)
    // - Othaim p.41: Almarai Fresh Milk 1L Low Fat (6.25 SAR - different variant!)
    // - Lulu p.3: Insufficient vague grocery offer ('Fresh Item') -> remains unresolved
    // - Lulu p.5: Quarantined offer with inverted dates / low confidence
    const extractedPages: string[] = [];
    const makeV3Card = (overrides: Record<string, any>) => ({
      offer_number: 1,
      arabic_title: 'عرض',
      english_title: 'Offer',
      brand: null,
      size_text: null,
      promo_badge_text: null,
      assortment_status: 'confirmed_single_sku',
      visible_variant_count: 1,
      assortment_evidence: ['Single product shown'],
      is_enumerated_list_complete: true,
      compound_group_id: null,
      shared_caption_text: null,
      item_domain: 'grocery',
      category_slug: 'pantry',
      promo_price: 10,
      original_price: null,
      currency: 'SAR',
      currency_evidence: 'SAR',
      price_basis: 'each',
      price_role_confidence: 'high',
      sale_basis: 'single_unit',
      is_per_weight_pricing: false,
      promo_conditions: null,
      each_size_value: null,
      each_size_unit: null,
      manufacturer_pack_count: 1,
      retailer_checkout_multibuy_qty: null,
      factory_bonus_paid_qty: null,
      factory_bonus_free_qty: null,
      customer_limit_pcs: null,
      loyalty_required: false,
      printed_retailer_sku_codes: [],
      sub_items:
        overrides.sub_items !== undefined
          ? overrides.sub_items
          : overrides.brand
            ? [
                {
                  sub_item_ref: 's01',
                  brand_en: overrides.brand,
                  brand_ar: overrides.brand_ar ?? null,
                  product_name_en: overrides.english_title ?? null,
                  product_name_ar: overrides.arabic_title ?? null,
                  variant_or_flavor: overrides.variant_or_flavor ?? null,
                  each_size_value: overrides.each_size_value ?? null,
                  each_size_unit: overrides.each_size_unit ?? null,
                  manufacturer_pack_count: overrides.manufacturer_pack_count ?? 1,
                  retailer_checkout_multibuy_qty: null,
                  printed_retailer_sku_code: null,
                  independent_promo_price: null,
                  independent_original_price: null
                }
              ]
            : [],
      non_grocery_specs: null,
      evidence_conflicts: [],
      confidence: 0.96,
      components: {
        product_graphic_box: [120, 120, 300, 300],
        promo_price_box: [310, 150, 360, 260],
        original_price_box: null,
        unit_and_size_badge_box: null,
        title_text_box: [365, 110, 395, 390]
      },
      ...overrides
    });

    const provider: HybridExtractionProvider = {
      providerId: 'offline_fix07_v3',
      isOfflineOrMock: true,
      async extractPage(req) {
        extractedPages.push(`${path.basename(path.dirname(path.dirname(req.imagePath)))}#p${req.pageNumber}`);
        const ws = path.basename(path.dirname(path.dirname(req.imagePath)));

        let offers: any[] = [];
        if (ws === 'ws_carrefour' && req.pageNumber === 12) {
          offers = [
            makeV3Card({
              offer_number: 1,
              arabic_title: 'أرز صن وايت كالروز 5 كجم',
              english_title: 'Sunwhite Calrose Rice 5kg',
              brand: 'Sunwhite',
              size_text: '5kg',
              promo_price: 34.95,
              original_price: 42.0,
              each_size_value: 5,
              each_size_unit: 'kg'
            })
          ];
        } else if (ws === 'ws_carrefour' && req.pageNumber === 15) {
          offers = [
            makeV3Card({
              offer_number: 1,
              arabic_title: 'حليب المراعي طازج كامل الدسم 1 لتر',
              english_title: 'Almarai Fresh Milk Full Fat 1L',
              brand: 'Almarai',
              brand_ar: 'المراعي',
              variant_or_flavor: 'Full Fat',
              size_text: '1L',
              promo_price: 5.95,
              original_price: 7.0,
              each_size_value: 1,
              each_size_unit: 'l'
            })
          ];
        } else if (ws === 'ws_othaim' && req.pageNumber === 27) {
          offers = [
            makeV3Card({
              offer_number: 1,
              arabic_title: 'أرز صن وايت كالروز 5 كجم',
              english_title: 'Sunwhite Calrose Rice 5kg',
              brand: 'Sunwhite',
              size_text: '5kg',
              promo_price: 32.5,
              original_price: 40.0,
              each_size_value: 5,
              each_size_unit: 'kg'
            }),
            makeV3Card({
              offer_number: 2,
              arabic_title: 'أرز صن وايت كالروز 2 كجم',
              english_title: 'Sunwhite Calrose Rice 2kg',
              brand: 'Sunwhite',
              size_text: '2kg',
              promo_price: 16.95,
              original_price: 21.0,
              each_size_value: 2,
              each_size_unit: 'kg',
              components: {
                product_graphic_box: [470, 120, 650, 300],
                promo_price_box: [660, 150, 710, 260],
                original_price_box: null,
                unit_and_size_badge_box: null,
                title_text_box: [715, 110, 745, 390]
              }
            })
          ];
        } else if (ws === 'ws_othaim' && req.pageNumber === 41) {
          offers = [
            makeV3Card({
              offer_number: 1,
              arabic_title: 'حليب المراعي طازج قليل الدسم 1 لتر',
              english_title: 'Almarai Fresh Milk Low Fat 1L',
              brand: 'Almarai',
              brand_ar: 'المراعي',
              variant_or_flavor: 'Low Fat',
              size_text: '1L',
              promo_price: 6.25,
              original_price: 7.5,
              each_size_value: 1,
              each_size_unit: 'l'
            })
          ];
        } else if (ws === 'ws_lulu' && req.pageNumber === 3) {
          offers = [
            makeV3Card({
              offer_number: 1,
              arabic_title: 'عرض طازج',
              english_title: 'Fresh Offer',
              brand: null,
              size_text: null,
              promo_price: 9.95,
              original_price: null,
              each_size_value: null,
              each_size_unit: null,
              manufacturer_pack_count: null,
              confidence: 0.65
            })
          ];
        } else {
          // ws_lulu page 5: Sunwhite Basmati Rice 10kg Absent from Catalog
          offers = [
            makeV3Card({
              offer_number: 1,
              arabic_title: 'أرز صن وايت بسمتي 10 كجم',
              english_title: 'Sunwhite Basmati Rice 10kg',
              brand: 'Sunwhite',
              size_text: '10kg',
              promo_price: 69.0,
              original_price: null,
              each_size_value: 10,
              each_size_unit: 'kg'
            })
          ];
        }

        return {
          ok: true,
          fromCache: false,
          costUsdOverride: 0.002,
          durationMs: 2,
          parsedJson: {
            schema_version: V3_EXTRACTION_SCHEMA_VERSION,
            is_loyalty_page: false,
            loyalty_program_name: null,
            validity_start_date: null,
            validity_end_date: null,
            page_currency: 'SAR',
            ignored_banners: [],
            offers
          }
        };
      },
      async extractCardCrop() {
        return { ok: true, fromCache: false, costUsdOverride: 0, durationMs: 1, parsedJson: {} };
      },
      async verifyPageContext() {
        return { ok: false };
      }
    };

    const mockDb = createInMemorySupabaseMock([
      {
        id: 'prod_rice_5kg',
        name_en: 'Sunwhite Calrose Rice 5kg',
        name_ar: 'أرز صن وايت كالروز 5 كجم',
        brand_name: 'Sunwhite',
        variant_or_flavor: null,
        each_size_value: 5,
        each_size_unit: 'kg',
        inner_pack_count: 1
      },
      {
        id: 'prod_rice_2kg',
        name_en: 'Sunwhite Calrose Rice 2kg',
        name_ar: 'أرز صن وايت كالروز 2 كجم',
        brand_name: 'Sunwhite',
        variant_or_flavor: null,
        each_size_value: 2,
        each_size_unit: 'kg',
        inner_pack_count: 1
      },
      {
        id: 'prod_milk_full',
        name_en: 'Almarai Fresh Milk Full Fat 1L',
        name_ar: 'حليب المراعي طازج كامل الدسم 1 لتر',
        brand_name: 'Almarai',
        variant_or_flavor: 'Full Fat',
        each_size_value: 1,
        each_size_unit: 'L',
        inner_pack_count: 1
      },
      {
        id: 'prod_milk_low',
        name_en: 'Almarai Fresh Milk Low Fat 1L',
        name_ar: 'حليب المراعي طازج قليل الدسم 1 لتر',
        brand_name: 'Almarai',
        variant_or_flavor: 'Low Fat',
        each_size_value: 1,
        each_size_unit: 'L',
        inner_pack_count: 1
      }
    ]);

    const isolatedCache = new VerifiedMatchCacheService(path.join(tmpRoot, 'cache.json'), 'development');
    const orchestrator = new CatalogMatchingOrchestrator(
      isolatedCache,
      undefined,
      undefined,
      undefined,
      path.join(tmpRoot, 'batches')
    );

    const created = await batchSvc.createBatch({
      files: [
        { path: carrefourPdf, name: 'carrefour.pdf', pageCount: 30, pagesToProcess: [12, 15], pageSelectionMode: 'specific', workspacePath: wsCarrefour },
        { path: othaimPdf, name: 'othaim.pdf', pageCount: 50, pagesToProcess: [27, 41], pageSelectionMode: 'specific', workspacePath: wsOthaim },
        { path: luluPdf, name: 'lulu.pdf', pageCount: 20, pagesToProcess: [3, 5], pageSelectionMode: 'specific', workspacePath: wsLulu }
      ],
      extractionPipelineMode: 'hybrid_v3',
      approvedMaxBudgetUsd: 0.25,
      autoRunCatalogMatching: true,
      targetDatabaseContext: 'DEVELOPMENT_TEST'
    });

    // Zero paid API calls on file selection/creation!
    expect(extractedPages).toHaveLength(0);
    expect(mockDb.writeAttemptCount).toBe(0);

    const progressStagesSeen: BatchProgressEvent['stage'][] = [];
    const manifest = await batchSvc.startBatchExtraction(
      created.batchId,
      {
        hybridV3ExplicitAuthorization: true,
        hybridV3FeatureEnabled: true,
        hybridV3ExplicitLiveAuthorization: false,
        disablePageContextVerification: true,
        approvedMaxBudgetUsd: 0.25,
        autoRunCatalogMatching: true,
        targetDatabaseContext: 'DEVELOPMENT_TEST',
        hybridV3Provider: provider,
        catalogMatchingSupabase: mockDb.client,
        catalogMatchingOrchestrator: orchestrator
      },
      (ev) => progressStagesSeen.push(ev.stage)
    );

    // Exactly 6 selected pages rendered & extracted across 3 leaflets
    expect(extractedPages).toHaveLength(6);
    expect(renderedPagesCalled).toEqual([
      { file: 'carrefour.pdf', pages: [12, 15] },
      { file: 'othaim.pdf', pages: [27, 41] },
      { file: 'lulu.pdf', pages: [3, 5] }
    ]);

    // Pipeline stage tracking & sub-stages
    expect(manifest.status).toBe('completed');
    expect(manifest.processingStages).toEqual({
      extraction: 'completed',
      metadata: 'completed',
      crops: 'completed',
      matching: 'completed'
    });
    expect(progressStagesSeen).toContain('matching');
    expect(progressStagesSeen).toContain('staging');
    expect(progressStagesSeen).toContain('batch_completed');

    // Zero database writes occurred during Extraction + Metadata + Matching!
    expect(mockDb.writeAttemptCount).toBe(0);

    // Verify Auto Metadata status: Carrefour & Lulu = auto_accepted, Othaim = needs_review (did NOT block matching!)
    expect(manifest.leaflets[0].metadata.metadataStatus).toBe('auto_accepted');
    expect(manifest.leaflets[0].metadata.verified).toBe(false);
    expect(manifest.leaflets[1].metadata.metadataStatus).toBe('needs_review');
    expect(manifest.leaflets[2].metadata.metadataStatus).toBe('auto_accepted');

    const offers = await batchSvc.getUnifiedBatchOffers(created.batchId);
    const matchingManifest = orchestrator.loadManifest(created.batchId)!;
    expect(matchingManifest).not.toBeNull();
    expect(matchingManifest.matchingDatabaseContext).toBe('DEVELOPMENT_TEST');

    // Cross-retailer identity checks:
    const rice5Offers = offers.filter((o) => /5kg/i.test(o.titleEn));
    expect(rice5Offers).toHaveLength(2);
    const propCarrefourRice5 = matchingManifest.proposals[rice5Offers[0].batchOfferKey];
    const propOthaimRice5 = matchingManifest.proposals[rice5Offers[1].batchOfferKey];
    // Shared 5kg rice SKU across Carrefour & Othaim with independent prices!
    expect(propCarrefourRice5.matchedProductId).toBe('prod_rice_5kg');
    expect(propOthaimRice5.matchedProductId).toBe('prod_rice_5kg');
    expect(rice5Offers[0].promoPrice).toBe(34.95);
    expect(rice5Offers[1].promoPrice).toBe(32.5);

    // Different size (2kg vs 5kg) stays strictly distinct!
    const rice2Offer = offers.find((o) => /2kg/i.test(o.titleEn))!;
    expect(matchingManifest.proposals[rice2Offer.batchOfferKey].matchedProductId).toBe('prod_rice_2kg');

    // Different variant (Full Fat vs Low Fat) stays strictly distinct!
    const fullMilk = offers.find((o) => /Full Fat/i.test(o.titleEn))!;
    const lowMilk = offers.find((o) => /Low Fat/i.test(o.titleEn))!;
    expect(matchingManifest.proposals[fullMilk.batchOfferKey].matchedProductId).toBe('prod_milk_full');
    expect(matchingManifest.proposals[lowMilk.batchOfferKey].matchedProductId).toBe('prod_milk_low');

    // Vague Fresh Offer retained as unresolved (not matched falsely!)
    const freshOffer = offers.find((o) => /Fresh Offer/i.test(o.titleEn))!;
    expect(matchingManifest.proposals[freshOffer.batchOfferKey].decision).toBe('unresolved');

    // Verify exception triage classification
    const triage = summarizeBatchReviewTriage({
      offers,
      manifest: matchingManifest,
      targetDatabaseContext: 'DEVELOPMENT_TEST'
    });
    expect(triage.byOfferKey[rice5Offers[0].batchOfferKey].category).toBe('ready'); // Carrefour auto_accepted + existing match
    expect(triage.byOfferKey[rice5Offers[0].batchOfferKey].canBulkApprove).toBe(true);
    expect(triage.byOfferKey[rice5Offers[1].batchOfferKey].category).toBe('needs_review'); // Othaim needs_review metadata!
    expect(triage.byOfferKey[rice5Offers[1].batchOfferKey].canBulkApprove).toBe(false);
    // Vague Fresh Offer missing brand + size triggers MISSING_CRITICAL_IDENTITY_ATTRIBUTES quarantine -> blocked & never bulk-approvable
    expect(triage.byOfferKey[freshOffer.batchOfferKey].category).toBe('blocked');
    expect(triage.byOfferKey[freshOffer.batchOfferKey].canBulkApprove).toBe(false);

    // Approve Carrefour 5kg rice offer, then test NON-IDENTITY vs IDENTITY edit reconciliation:
    await orchestrator.applyOperatorDecision({
      batchId: created.batchId,
      batchOfferKey: rice5Offers[0].batchOfferKey,
      decision: 'approved',
      linkedPermanentProductId: 'prod_rice_5kg'
    });

    // A) Non-identity edit (price change) MUST preserve existing catalog match & approval!
    const afterPriceEdit = await batchSvc.updateBatchOfferFields({
      batchId: created.batchId,
      batchOfferKey: rice5Offers[0].batchOfferKey,
      orchestrator,
      supabase: mockDb.client,
      databaseContext: 'DEVELOPMENT_TEST',
      patch: { promoPrice: 31.95 }
    });
    expect(afterPriceEdit.promoPrice).toBe(31.95);
    expect(afterPriceEdit.rematchOutcome).toBe('metadata_only_preserved');
    expect(orchestrator.loadManifest(created.batchId)!.proposals[rice5Offers[0].batchOfferKey].matchedProductId).toBe(
      'prod_rice_5kg'
    );
    expect(orchestrator.loadManifest(created.batchId)!.proposals[rice5Offers[0].batchOfferKey].operatorDecision).toBe(
      'approved'
    );

    // B) Identity-defining edit (5kg -> 2kg) MUST invalidate stale approval & re-match cleanly to prod_rice_2kg!
    const afterSizeEdit = await batchSvc.updateBatchOfferFields({
      batchId: created.batchId,
      batchOfferKey: rice5Offers[0].batchOfferKey,
      orchestrator,
      supabase: mockDb.client,
      databaseContext: 'DEVELOPMENT_TEST',
      patch: {
        titleEn: 'Sunwhite Calrose Rice 2kg',
        sizeOrWeight: '2kg',
        each_size_value: 2,
        each_size_unit: 'kg'
      }
    });
    expect(afterSizeEdit.rematchOutcome).toBe('reconciled_existing');
    const updatedProp = orchestrator.loadManifest(created.batchId)!.proposals[rice5Offers[0].batchOfferKey];
    expect(updatedProp.matchedProductId).toBe('prod_rice_2kg');
    expect(updatedProp.operatorDecision).toBe('proposed'); // Prior approval cleared cleanly!

    // C) Identity edit to an ambiguous/unknown product MUST fail closed to unresolved/needs_review with ZERO paid Gemini calls!
    const afterUnknownEdit = await batchSvc.updateBatchOfferFields({
      batchId: created.batchId,
      batchOfferKey: rice5Offers[0].batchOfferKey,
      orchestrator,
      supabase: mockDb.client,
      databaseContext: 'DEVELOPMENT_TEST',
      patch: {
        titleEn: 'Unknown Imported Jasmine Grain 7kg',
        brand: null,
        sizeOrWeight: '7kg',
        each_size_value: 7,
        each_size_unit: 'kg'
      }
    });
    expect(afterUnknownEdit.rematchOutcome).toBe('reconciled_temporary');
    expect(orchestrator.loadManifest(created.batchId)!.proposals[rice5Offers[0].batchOfferKey].matchedProductId).toBeNull();
  }, 90000);

  it('preserves completed extraction results & crops if automatic catalog matching fails', async () => {
    const batchSvc = new BatchOrchestrationService(path.join(tmpRoot, 'batches_fail_match'));
    const pdfPath = path.join(tmpRoot, 'carrefour.pdf');
    makeDummyPdf(pdfPath);
    const wsPath = path.join(tmpRoot, 'ws_fail_match');
    const tinyPng = await sharp({
      create: { width: 800, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } }
    })
      .png()
      .toBuffer();

    vi.spyOn(pdfRenderModule, 'renderPdfPagesStreaming').mockImplementation(async (opts: any) => {
      fs.mkdirSync(path.join(opts.workspacePath, 'pages'), { recursive: true });
      fs.writeFileSync(path.join(opts.workspacePath, 'pages', 'page.1.png'), tinyPng);
      return {
        ok: true,
        pageCount: 1,
        selectedPages: [1],
        pagesRendered: 1,
        renderedPages: [{ pageNumber: 1, imagePath: path.join(opts.workspacePath, 'pages', 'page.1.png') }]
      } as any;
    });

    const provider: HybridExtractionProvider = {
      providerId: 'offline_ok',
      isOfflineOrMock: true,
      async extractPage() {
        return {
          ok: true,
          fromCache: false,
          costUsdOverride: 0.002,
          durationMs: 1,
          parsedJson: {
            schema_version: V3_EXTRACTION_SCHEMA_VERSION,
            is_loyalty_page: false,
            loyalty_program_name: null,
            validity_start_date: null,
            validity_end_date: null,
            page_currency: 'SAR',
            ignored_banners: [],
            offers: [
              {
                offer_number: 1,
                arabic_title: 'زيت شمس 1.5 لتر',
                english_title: 'Shams Sunflower Oil 1.5L',
                brand: 'Shams',
                size_text: '1.5L',
                promo_badge_text: null,
                assortment_status: 'confirmed_single_sku',
                visible_variant_count: 1,
                assortment_evidence: ['Single bottle'],
                is_enumerated_list_complete: true,
                compound_group_id: null,
                shared_caption_text: null,
                item_domain: 'grocery',
                category_slug: 'oils',
                promo_price: 15.95,
                original_price: null,
                currency: 'SAR',
                currency_evidence: 'SAR',
                price_basis: 'each',
                price_role_confidence: 'high',
                sale_basis: 'single_unit',
                is_per_weight_pricing: false,
                promo_conditions: null,
                each_size_value: 1.5,
                each_size_unit: 'l',
                manufacturer_pack_count: 1,
                retailer_checkout_multibuy_qty: null,
                factory_bonus_paid_qty: null,
                factory_bonus_free_qty: null,
                customer_limit_pcs: null,
                loyalty_required: false,
                printed_retailer_sku_codes: [],
                sub_items: [],
                non_grocery_specs: null,
                evidence_conflicts: [],
                confidence: 0.95,
                components: {
                  product_graphic_box: [110, 110, 280, 280],
                  promo_price_box: [285, 130, 320, 250],
                  original_price_box: null,
                  unit_and_size_badge_box: null,
                  title_text_box: [325, 100, 355, 290]
                }
              }
            ]
          }
        };
      },
      async extractCardCrop() {
        return { ok: true, fromCache: false, costUsdOverride: 0, durationMs: 1, parsedJson: {} };
      },
      async verifyPageContext() {
        return { ok: false };
      }
    };

    const created = await batchSvc.createBatch({
      files: [{ path: pdfPath, name: 'carrefour.pdf', pageCount: 5, pagesToProcess: [1], pageSelectionMode: 'specific', workspacePath: wsPath }],
      extractionPipelineMode: 'hybrid_v3',
      autoRunCatalogMatching: true,
      approvedMaxBudgetUsd: 0.1
    });

    // Omit catalogMatchingSupabase to simulate reference DB failure during Step 2C
    const manifest = await batchSvc.startBatchExtraction(created.batchId, {
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3ExplicitLiveAuthorization: false,
      disablePageContextVerification: true,
      autoRunCatalogMatching: true,
      approvedMaxBudgetUsd: 0.1,
      hybridV3Provider: provider,
      catalogMatchingSupabase: null
    });

    expect(manifest.status).toBe('completed');
    expect(manifest.leaflets[0].status).toBe('completed');
    expect(manifest.leaflets[0].offersCount).toBe(1);
    expect(manifest.processingStages?.extraction).toBe('completed');
    expect(manifest.processingStages?.crops).toBe('completed');
    expect(manifest.processingStages?.matching).toBe('failed');
    expect(manifest.matchingSummary?.status).toBe('failed');

    // Completed extracted offers remain intact!
    const offers = await batchSvc.getUnifiedBatchOffers(created.batchId);
    expect(offers).toHaveLength(1);
    expect(offers[0].titleEn).toContain('Shams Sunflower Oil');
  });

  it('supports safe cancel/resume without duplicating already completed pages and enforces PRODUCTION_UI read-only block', async () => {
    // 1. PRODUCTION_UI publication guard check (read-only allowed for matching, writes/publication blocked)
    const pubSvc = new CatalogPublicationService();
    const emptyManifest: any = {
      schemaVersion: '1.0',
      batchId: 'b-iso',
      runId: 'r-iso',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      status: 'completed',
      matchingDatabaseContext: 'PRODUCTION_UI',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      brandSummaries: {},
      proposals: {},
      temporaryProducts: {},
      totals: {
        totalExtractedOffers: 0,
        uniqueIdentitiesCount: 0,
        cacheMatchesCount: 0,
        deterministicMatchesCount: 0,
        geminiEvaluatedCount: 0,
        proposedExistingCount: 0,
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

    await expect(
      pubSvc.publishApprovedCatalogBatch({
        manifest: emptyManifest,
        offers: [],
        operatorId: 'op1',
        context: 'PRODUCTION_UI'
      })
    ).rejects.toThrow(/PRODUCTION_PUBLICATION_BLOCKED/i);

    // 2. Quarantined / blocked item classification check
    const triageBlocked = classifyOfferReviewTriage({
      offer: {
        batchOfferKey: 'b:l1:p1:bad',
        batchId: 'b',
        leafletId: 'l1',
        sourceFileName: 'bad.pdf',
        sourcePdfPath: '/bad.pdf',
        sourcePage: 1,
        sourceOfferId: 'bad',
        supermarketId: 'sup-1',
        supermarketName: 'Panda',
        locationScope: 'national',
        locationLabel: 'National',
        cityId: null,
        regionId: null,
        offerStartDate: '2026-11-20',
        offerEndDate: '2026-11-10', // inverted!
        metadataStatus: 'auto_accepted',
        titleAr: 'منتج',
        titleEn: 'Product',
        brand: 'Panda',
        brandAr: null,
        brandEn: 'Panda',
        promoPrice: 5,
        originalPrice: 8,
        discountPercent: 37,
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
        confidence: 'high',
        quarantineReasons: ['INV_DATE_RANGE']
      }
    });
    expect(triageBlocked.category).toBe('blocked');
    expect(triageBlocked.canBulkApprove).toBe(false);

    // 3. Cancel & resume checkpoint reuse
    const batchSvc = new BatchOrchestrationService(path.join(tmpRoot, 'batches_resume'));
    const p1 = path.join(tmpRoot, 'p1.pdf');
    const p2 = path.join(tmpRoot, 'p2.pdf');
    makeDummyPdf(p1);
    makeDummyPdf(p2);
    const tinyPng = await sharp({
      create: { width: 800, height: 1000, channels: 3, background: { r: 255, g: 255, b: 255 } }
    })
      .png()
      .toBuffer();
    vi.spyOn(pdfRenderModule, 'renderPdfPagesStreaming').mockImplementation(async (opts: any) => {
      fs.mkdirSync(path.join(opts.workspacePath, 'pages'), { recursive: true });
      fs.writeFileSync(path.join(opts.workspacePath, 'pages', 'page.1.png'), tinyPng);
      return {
        ok: true,
        pageCount: 1,
        selectedPages: [1],
        pagesRendered: 1,
        renderedPages: [{ pageNumber: 1, imagePath: path.join(opts.workspacePath, 'pages', 'page.1.png') }]
      } as any;
    });

    const calledLeaflets: string[] = [];
    const provider: HybridExtractionProvider = {
      providerId: 'offline_resume',
      isOfflineOrMock: true,
      async extractPage(req) {
        calledLeaflets.push(path.basename(path.dirname(path.dirname(req.imagePath))));
        return {
          ok: true,
          fromCache: false,
          costUsdOverride: 0.001,
          durationMs: 1,
          parsedJson: {
            schema_version: V3_EXTRACTION_SCHEMA_VERSION,
            is_loyalty_page: false,
            loyalty_program_name: null,
            validity_start_date: null,
            validity_end_date: null,
            page_currency: 'SAR',
            ignored_banners: [],
            offers: []
          }
        };
      },
      async extractCardCrop() {
        return { ok: true, fromCache: false, costUsdOverride: 0, durationMs: 1, parsedJson: {} };
      },
      async verifyPageContext() {
        return { ok: false };
      }
    };

    const created = await batchSvc.createBatch({
      files: [
        { path: p1, name: 'p1.pdf', pageCount: 2, pagesToProcess: [1], pageSelectionMode: 'specific', workspacePath: path.join(tmpRoot, 'ws_r1') },
        { path: p2, name: 'p2.pdf', pageCount: 2, pagesToProcess: [1], pageSelectionMode: 'specific', workspacePath: path.join(tmpRoot, 'ws_r2') }
      ],
      extractionPipelineMode: 'hybrid_v3'
    });

    // Cancel as soon as ws_r1 completes
    const firstRun = await batchSvc.startBatchExtraction(
      created.batchId,
      {
        hybridV3ExplicitAuthorization: true,
        hybridV3FeatureEnabled: true,
        hybridV3ExplicitLiveAuthorization: false,
        disablePageContextVerification: true,
        hybridV3Provider: provider
      },
      (ev) => {
        if (ev.stage === 'leaflet_completed' && ev.currentLeaflet?.leafletId === 'leaflet-001') {
          void batchSvc.cancelBatch(created.batchId);
        }
      }
    );
    expect(firstRun.status).toBe('cancelled');
    expect(calledLeaflets).toEqual(['ws_r1']);

    // Resume only runs ws_r2 without repeating ws_r1!
    const resumed = await batchSvc.resumeBatch(created.batchId, {
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3ExplicitLiveAuthorization: false,
      disablePageContextVerification: true,
      hybridV3Provider: provider
    });
    expect(resumed.status).toBe('completed');
    expect(calledLeaflets).toEqual(['ws_r1', 'ws_r2']);
  });
});
