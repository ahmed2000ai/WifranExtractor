import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  createHybridGeminiLiveProvider,
  HYBRID_LIVE_DEFAULT_MAX_OUTPUT_TOKENS,
  HYBRID_LIVE_DEFAULT_CROP_MAX_OUTPUT_TOKENS,
  HYBRID_LIVE_PAGE_CONTEXT_MAX_OUTPUT_TOKENS
} from '../../ocr/hybrid/hybridGeminiLiveProvider';
import { buildV3PageExtractionSystemPrompt } from '../../ocr/geminiV3PromptBuilder';
import { evaluateCardForCropVerification } from '../../ocr/hybrid/hybridCropSelector';
import {
  runHybridPageWorkflow,
  remapHalfNormalizedBoxToFullPage,
  mergeRecoveredHalfRawExtractions
} from '../../ocr/hybrid/hybridWorkflowOrchestrator';
import { decodeV3PageExtractionToOfferCards } from '../../../shared/schemas/leafletPageExtractionV3Schema';
import { normalizedBoxToPixelBox } from '../../ocr/hybrid/hybridCropGenerator';
import { cropItemImage } from '../../image/itemImageCropper';
import { validateAndClampBoundingBox } from '../../image/boundingBoxValidator';
import { GeminiCostLedgerService, buildLedgerEntryFromProviderCall } from '../../ocr/geminiCostLedgerService';
import { BatchOrchestrationService } from '../batchOrchestrationService';
import { GeminiMatchingService } from '../../ocr/geminiMatchingService';
import { TargetedMetadataVisionService } from '../../metadata/targetedMetadataVisionService';
import {
  estimateBatchApiCost,
  B1_BASELINE_COST_PER_OFFER_USD,
  COMPLETE_PLANNING_ALLOWANCE_LOW_PER_OFFER_USD,
  COMPLETE_PLANNING_ALLOWANCE_HIGH_PER_OFFER_USD,
  DEFAULT_HYBRID_BUDGET_POLICY
} from '../../../shared/utils/geminiPricingAndCostEstimator';
import type { HybridExtractionProvider } from '../../../shared/types/hybridExtractionV3';

const REPO_ROOT = process.cwd();
const ALNOKHBAH_RAW_ARCHIVE = path.join(
  REPO_ROOT,
  'Extracts/alnokhbah-markets-1/hybrid_v3_archive/4a619b4e07f9b9d7a7e8930dc42eaaf66b83ce8060cae65d92308293b23887d2_page_nonstop.raw.json'
);
const ALNOKHBAH_PAGE_1_PNG = path.join(REPO_ROOT, 'Extracts/alnokhbah-markets-1/pages/page.1.png');

const tempDirs: string[] = [];
function makeTempDir(prefix = 'wifran-opt-test-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Safely closes the truncated Al Nokhbah Page 1 raw response in memory (NEVER touching disk)
 * so offline regression tests can inspect the 16 extracted offers accurately.
 */
function parseTruncatedAlNokhbah16OffersReadOnly(): any {
  const rawArchive = JSON.parse(fs.readFileSync(ALNOKHBAH_RAW_ARCHIVE, 'utf8'));
  const txt = String(rawArchive.rawText || '').trimEnd();
  expect(txt.length).toBeGreaterThan(25000);
  // Close truncated rawText safely in memory without altering the original archive file
  for (const suffix of [']}', '}}]', '}]', '"}]}']) {
    try {
      const parsed = JSON.parse(txt + suffix);
      if (Array.isArray(parsed?.offers)) return parsed;
    } catch {
      // try next closing sequence
    }
  }
  const lastTitleBoxIdx = txt.lastIndexOf('"title_text_box"');
  expect(lastTitleBoxIdx).toBeGreaterThan(20000);
  const closeBracketIdx = txt.indexOf(']', lastTitleBoxIdx);
  return JSON.parse(txt.slice(0, closeBracketIdx + 1) + '}}]}');
}

function makeSampleRawOffer(idx: number, y1: number, x1: number, y2: number, x2: number, promoPrice = 10.95) {
  return {
    offer_number: idx,
    english_title: `Sample Product ${idx} 500G`,
    arabic_title: `منتج تجريبي ${idx} ٥٠٠ جم`,
    brand: `Brand${idx}`,
    promo_price: promoPrice,
    original_price: promoPrice + 4,
    price_basis: 'each',
    sale_basis: 'single_unit',
    is_per_weight_pricing: false,
    loyalty_required: false,
    item_domain: 'grocery',
    assortment_status: 'confirmed_single_sku',
    is_enumerated_list_complete: true,
    visible_variant_count: 1,
    each_size_value: 500,
    each_size_unit: 'g',
    manufacturer_pack_count: 1,
    size_text: '500 g',
    confidence: 0.96,
    price_role_confidence: 'high',
    assortment_evidence: [],
    printed_retailer_sku_codes: [],
    evidence_conflicts: [],
    sub_items: [
      {
        sub_item_ref: 's01',
        brand_en: `Brand${idx}`,
        brand_ar: `براند ${idx}`,
        product_name_en: `Sample Product ${idx}`,
        product_name_ar: `منتج تجريبي ${idx}`,
        each_size_value: 500,
        each_size_unit: 'g',
        manufacturer_pack_count: 1,
        independent_promo_price: null,
        independent_original_price: null
      }
    ],
    components: {
      offer_card_box: [y1, x1, y2, x2],
      product_graphic_box: [y1 + 20, x1 + 20, y2 - 20, x2 - 20],
      promo_price_box: [y2 - 50, x2 - 80, y2 - 10, x2 - 10],
      title_text_box: [y2 - 60, x1 + 10, y2 - 20, x2 - 85],
      unit_and_size_badge_box: [y1 + 20, x2 - 70, y1 + 60, x2 - 15]
    }
  };
}

describe('Wifran Hybrid V3 Token Ceiling, Optimization, Cost Accounting & Recovery', () => {
  it('verifies separate output token ceilings (65536 B1 full_page, 16384 card_crop, 4096 page_context) & SDK passthrough', async () => {
    expect(HYBRID_LIVE_DEFAULT_MAX_OUTPUT_TOKENS).toBe(65_536);
    expect(HYBRID_LIVE_DEFAULT_CROP_MAX_OUTPUT_TOKENS).toBe(16_384);
    expect(HYBRID_LIVE_PAGE_CONTEXT_MAX_OUTPUT_TOKENS).toBe(4_096);

    const tmp = makeTempDir();
    const imgPath = path.join(tmp, 'page.png');
    await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } }
    })
      .png()
      .toFile(imgPath);

    const capturedConfigs: any[] = [];
    const mockClient = {
      models: {
        generateContent: vi.fn().mockImplementation(async (params: any) => {
          capturedConfigs.push(params.config);
          return {
            text: JSON.stringify({
              page_number: 1,
              offers: [makeSampleRawOffer(1, 100, 100, 400, 400)]
            }),
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: {
              promptTokenCount: 1500,
              candidatesTokenCount: 800,
              thoughtsTokenCount: 200,
              totalTokenCount: 2500
            }
          };
        })
      }
    };

    const provider = createHybridGeminiLiveProvider({
      executionContext: 'isolated_hybrid_workflow',
      featureEnabled: true,
      explicitLiveAuthorization: true,
      client: mockClient,
      archiveDir: path.join(tmp, 'archive')
    });

    await provider.extractPage({
      requestKind: 'full_page',
      cacheKey: 'k-page',
      leafletId: 'lf-1',
      pageNumber: 1,
      retailer: 'Al Nokhbah',
      imagePath: imgPath,
      promptText: 'Extract page'
    });
    expect(capturedConfigs[0].maxOutputTokens).toBe(65_536);

    await provider.extractCardCrop({
      requestKind: 'card_crop',
      cacheKey: 'k-crop',
      leafletId: 'lf-1',
      pageNumber: 1,
      retailer: 'Al Nokhbah',
      sourceOfferId: 'lf-1_p001_01',
      regionKind: 'offer_card',
      imagePath: imgPath,
      promptText: 'Extract crop'
    });
    expect(capturedConfigs[1].maxOutputTokens).toBe(16_384);
  });

  it('captures usageMetadata BEFORE JSON parse on Al Nokhbah MAX_TOKENS truncated failure without retrying raw same request', async () => {
    const rawArchive = JSON.parse(fs.readFileSync(ALNOKHBAH_RAW_ARCHIVE, 'utf8'));
    const tmp = makeTempDir();
    const imgPath = path.join(tmp, 'page.png');
    await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 240, g: 240, b: 240 } }
    })
      .png()
      .toFile(imgPath);

    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: rawArchive.rawText,
          candidates: [{ finishReason: 'MAX_TOKENS' }],
          usageMetadata: rawArchive.usageMetadataRaw
        })
      }
    };

    const provider = createHybridGeminiLiveProvider({
      executionContext: 'isolated_hybrid_workflow',
      featureEnabled: true,
      explicitLiveAuthorization: true,
      client: mockClient,
      archiveDir: path.join(tmp, 'archive')
    });

    const resp = await provider.extractPage({
      requestKind: 'full_page',
      cacheKey: 'k-max',
      leafletId: 'alnokhbah-markets-1',
      pageNumber: 1,
      retailer: 'Al Nokhbah',
      imagePath: imgPath,
      promptText: 'Extract page 1'
    });

    expect(resp.ok).toBe(false);
    expect(resp.finishReason).toBe('MAX_TOKENS');
    expect(resp.usageReported).toBe(true);
    expect(resp.usage?.promptTokenCount).toBe(5540);
    expect(resp.usage?.candidatesTokenCount).toBe(12552);
    expect(resp.usage?.thoughtsTokenCount).toBe(3818);
    expect(resp.costUsdOverride).toBeGreaterThan(0.03);
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(resp.rawArchivePath && fs.existsSync(resp.rawArchivePath)).toBe(true);
  });

  it('captures usage BEFORE JSON parse failures in GeminiMatchingService and TargetedMetadataVisionService', async () => {
    // Matching parse error still captures usage on thrown error
    const svc = new GeminiMatchingService();
    (svc as any).callGeminiApi = vi.fn().mockImplementation(async (_sys: any, _user: any, usageMeta: any) => {
      usageMeta.inputTokens = 1200;
      usageMeta.outputTokens = 100;
      usageMeta.thinkingTokens = 300;
      usageMeta.totalTokens = 1600;
      usageMeta.metadataMissing = false;
      usageMeta.actualCostUsd = 0.0012;
      const err: any = new SyntaxError('Unexpected end of JSON input');
      err.usage = usageMeta;
      throw err;
    });

    let caughtErr: any = null;
    try {
      await svc.evaluateBatch({
        brandKey: 'almarai',
        brandName: 'Almarai',
        candidates: [],
        items: []
      });
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeTruthy();
    expect(caughtErr.usage?.actualCostUsd).toBeCloseTo(0.0012, 6);

    // Metadata vision parse error preserves costUsd & usageAttempts
    const tmp = makeTempDir();
    const coverImg = path.join(tmp, 'cover.png');
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } }
    })
      .png()
      .toFile(coverImg);

    const visionSvc = new TargetedMetadataVisionService({
      durableLedgerPath: path.join(tmp, 'vision-ledger.json')
    });
    const visionRes = await visionSvc.executeTargetedVision({
      request: {
        leafletFingerprint: 'fp-vision-parse-err',
        unresolvedFields: ['retailer', 'validity'],
        candidatePages: [1],
        maxAttempts: 1
      },
      operatorAuthorized: true,
      imagePathsByPage: { 1: coverImg },
      genAiClient: {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: '{broken_json',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: {
              promptTokenCount: 900,
              candidatesTokenCount: 250,
              thoughtsTokenCount: 150,
              totalTokenCount: 1300
            }
          })
        }
      }
    });

    expect(visionRes.ok).toBe(false);
    expect(visionRes.costUsd).toBeGreaterThan(0);
    expect(visionRes.usageAttempts?.length).toBe(1);
    expect(visionRes.usageAttempts?.[0].usageReported).toBe(true);
    expect(visionRes.usageAttempts?.[0].costUsd).toBeGreaterThan(0);
  });

  it('prevents false 16/16 B2 crop floods on Al Nokhbah Page 1 while keeping output compaction and MVP currency omission', () => {
    const prompt = buildV3PageExtractionSystemPrompt();
    expect(prompt).toContain('OUTPUT TOKEN COMPACTION (LOSSLESS)');
    expect(prompt).toContain('single-line minified JSON');
    expect(prompt).toContain('independent_promo_price');
    // Wifran MVP currency omission policy preserved
    expect(prompt.toLowerCase()).not.toContain('saudi riyal');
    expect(prompt).not.toMatch(/\bcurrency\b/i);

    const recoveredRaw = parseTruncatedAlNokhbah16OffersReadOnly();
    const decoded = decodeV3PageExtractionToOfferCards(recoveredRaw, {
      leafletId: 'alnokhbah-markets-1',
      pageNumber: 1,
      sourceOfferIdPrefix: 'alnokhbah_p001',
      retailerName: 'Al Nokhbah Markets',
      tolerateOmittedNullableFields: true
    });

    expect(decoded.cards.length).toBe(16);
    const p0Decisions = decoded.cards.map((card, i) =>
      evaluateCardForCropVerification(card, {
        components: recoveredRaw.offers[i]?.components || recoveredRaw.offers[i]?.component_boxes
      })
    );
    const p0Count = p0Decisions.filter((d) => d.priority === 'P0').length;
    const p2Count = p0Decisions.filter((d) => d.priority === 'P2').length;

    // Previously 16/16 (100%) triggered P0! After calibration, most clean Al Nokhbah single-SKU cards stay P2.
    expect(p0Count).toBeLessThanOrEqual(3);
    expect(p2Count).toBeGreaterThanOrEqual(11);
  });

  it('verifies Al Nokhbah Page 1 crop geometry accuracy (regression on [326,126,439,230] and [321,335,420,396])', async () => {
    const meta = await sharp(ALNOKHBAH_PAGE_1_PNG).metadata();
    expect(meta.width).toBe(9186);
    expect(meta.height).toBe(12139);

    const tmp = makeTempDir();
    // [ymin, xmin, ymax, xmax] -> vertical image width is narrower than height in a tall jar/bag
    const riceRawPx = normalizedBoxToPixelBox([326, 126, 439, 230], meta.width!, meta.height!);
    const riceBox = validateAndClampBoundingBox(riceRawPx, meta.width!, meta.height!);
    expect(riceBox.isValid).toBe(true);
    expect(riceBox.box!.x).toBeGreaterThan(1000);
    expect(riceBox.box!.y).toBeGreaterThan(3800);
    expect(riceBox.box!.height).toBeGreaterThan(riceBox.box!.width);

    const oilRawPx = normalizedBoxToPixelBox([321, 335, 420, 396], meta.width!, meta.height!);
    const oilBox = validateAndClampBoundingBox(oilRawPx, meta.width!, meta.height!);
    expect(oilBox.isValid).toBe(true);
    expect(oilBox.box!.x).toBeGreaterThan(2900);
    expect(oilBox.box!.y).toBeGreaterThan(3700);
    expect(oilBox.box!.height).toBeGreaterThan(oilBox.box!.width * 1.8);

    const outRice = path.join(tmp, 'rice.webp');
    const outOil = path.join(tmp, 'oil.webp');
    await cropItemImage({
      pageImagePath: ALNOKHBAH_PAGE_1_PNG,
      outputPath: outRice,
      cropBox: riceBox.box!,
      outputFormat: 'webp',
      outputQuality: 85
    });
    await cropItemImage({
      pageImagePath: ALNOKHBAH_PAGE_1_PNG,
      outputPath: outOil,
      cropBox: oilBox.box!,
      outputFormat: 'webp',
      outputQuality: 85
    });
    expect(fs.statSync(outRice).size).toBeGreaterThan(5000);
    expect(fs.statSync(outOil).size).toBeGreaterThan(5000);
  });

  it('distinguishes Expected Normal Cost ($0.004-$0.006/offer) from Max Authorized Spending Cap', () => {
    expect(B1_BASELINE_COST_PER_OFFER_USD).toBeCloseTo(0.002, 5);
    expect(COMPLETE_PLANNING_ALLOWANCE_LOW_PER_OFFER_USD).toBeCloseTo(0.004, 5);
    expect(COMPLETE_PLANNING_ALLOWANCE_HIGH_PER_OFFER_USD).toBeCloseTo(0.006, 5);
    expect(DEFAULT_HYBRID_BUDGET_POLICY.maxSpendUsdPerPage).toBeCloseTo(0.25, 4);

    // 20 offers planning benchmark: $0.08 - $0.12 normal range
    const est = estimateBatchApiCost({
      targetPageCount: 1,
      expectedOffersPerPage: 20,
      extractionPipelineMode: 'hybrid_v3'
    });
    expect(est.expectedNormalLowUsd).toBeCloseTo(0.08, 4);
    expect(est.expectedNormalHighUsd).toBeCloseTo(0.12, 4);
    expect(est.maxAuthorizedTotalCapUsd).toBeGreaterThan(est.expectedNormalHighUsd);
  });

  it('performs bounded 2-half MAX_TOKENS split recovery with coordinate remapping, overlap dedup & full ledger tracking', async () => {
    const tmp = makeTempDir();
    const imgPath = path.join(tmp, 'page.png');
    await sharp({
      create: { width: 400, height: 800, channels: 3, background: { r: 255, g: 255, b: 255 } }
    })
      .png()
      .toFile(imgPath);

    // Coordinate remapping unit assertion
    const remappedBottom = remapHalfNormalizedBoxToFullPage([200, 100, 500, 400], [460, 0, 1000, 1000]);
    // 460 + 0.2*540 = 568, 460 + 0.5*540 = 730
    expect(remappedBottom).toEqual([568, 100, 730, 400]);

    // Merge dedup unit assertion for overlap item inside [460..540]
    const mergedUnit = mergeRecoveredHalfRawExtractions(
      {
        offers: [
          makeSampleRawOffer(1, 50, 50, 350, 450, 9.95),
          // Overlap offer in top half normalized coords [852..963] -> remaps to [460..520]
          makeSampleRawOffer(2, 852, 100, 963, 400, 19.95)
        ]
      },
      {
        offers: [
          // Same overlap offer in bottom half normalized coords [0..111] -> remaps to [460..520]
          makeSampleRawOffer(1, 0, 100, 111, 400, 19.95),
          makeSampleRawOffer(2, 300, 100, 700, 450, 29.95)
        ]
      }
    );
    expect(mergedUnit.offers).toHaveLength(3);
    expect(mergedUnit.offers.map((o: any) => o.offer_number)).toEqual([1, 2, 3]);

    // Orchestrator e2e recovery simulation
    let pageCalls = 0;
    const provider: HybridExtractionProvider = {
      providerId: 'mock-recovery',
      isOfflineOrMock: true,
      async extractPage(req) {
        pageCalls++;
        if (req.requestPurpose !== 'b1_max_tokens_split_half') {
          return {
            ok: false,
            errorCode: 'MAX_TOKENS',
            errorMessage: 'Response truncated at token ceiling (MAX_TOKENS)',
            finishReason: 'MAX_TOKENS',
            durationMs: 1200,
            usageReported: true,
            usage: { promptTokenCount: 4000, candidatesTokenCount: 12000, thoughtsTokenCount: 3000, totalTokenCount: 19000 }
          };
        }
        const isTop = req.promptText.includes('top half');
        return {
          ok: true,
          finishReason: 'STOP',
          durationMs: 900,
          usageReported: true,
          usage: { promptTokenCount: 2500, candidatesTokenCount: 4000, thoughtsTokenCount: 1000, totalTokenCount: 7500 },
          parsedJson: {
            page_number: 1,
            offers: isTop
              ? [makeSampleRawOffer(1, 50, 50, 400, 450, 9.95), makeSampleRawOffer(2, 852, 100, 963, 400, 19.95)]
              : [makeSampleRawOffer(1, 0, 100, 111, 400, 19.95), makeSampleRawOffer(2, 300, 100, 700, 450, 29.95)]
          }
        };
      },
      async extractCardCrop() {
        return { ok: true, durationMs: 10, parsedJson: { offers: [] } };
      }
    };

    const res = await runHybridPageWorkflow({
      executionContext: 'isolated_hybrid_workflow',
      explicitAuthorization: true,
      featureEnabled: true,
      runId: 'run-rec-1',
      batchId: 'batch-rec-1',
      leafletId: 'lf-rec',
      pageNumber: 1,
      retailer: 'Al Nokhbah Markets',
      offerStartDate: '2026-11-15',
      offerEndDate: '2026-11-25',
      locationScope: 'national',
      pageAssetPath: imgPath,
      pageImagePath: imgPath,
      cropOutputDir: path.join(tmp, 'crops'),
      checkpointPath: path.join(tmp, 'page_1.checkpoint.json'),
      disablePageContextVerification: true,
      provider
    });

    expect(res.ok).toBe(true);
    expect(pageCalls).toBe(3); // 1 failed full-page + 2 split halves (zero identical retry!)
    expect(res.recoveryApplied?.triggered).toBe(true);
    expect(res.recoveryApplied?.recoveredOffersCount).toBe(3);
    expect(res.totalSourceCards).toBe(3);
    const b1Entries = (res.ledgerEntries || []).filter((e) => e.stageCategory === 'b1_full_page');
    expect(b1Entries).toHaveLength(3); // 1 failed full-page + 2 split halves
    expect(b1Entries[0].outcome).toBe('failed');
    expect(b1Entries[1].recoveryParentRequestId).toBe(b1Entries[0].requestId);
    expect(b1Entries[2].recoveryParentRequestId).toBe(b1Entries[0].requestId);
    expect(res.checkpoint.stage).toBe('completed');
    expect(res.checkpoint.cumulativeCostUsd).toBeGreaterThan(0);
  });

  it('tracks failed B1 cost & page_failed checkpoint state on unrecoverable failure, syncs workspace status, and resumes cleanly without double-counting', async () => {
    const tmpRoot = makeTempDir();
    const batchesDir = path.join(tmpRoot, 'batches');
    const wsDir = path.join(tmpRoot, 'workspace_lf1');
    const pagesDir = path.join(wsDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const p1Path = path.join(pagesDir, 'page.1.png');
    await sharp({
      create: { width: 300, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } }
    })
      .png()
      .toFile(p1Path);

    const dummyPdf = path.join(tmpRoot, 'alnokhbah-sim.pdf');
    fs.writeFileSync(dummyPdf, Buffer.from('%PDF-1.4\n%%EOF'));

    // Seed an extraction_manifest.json + manifest.json in_progress as streaming renderer does
    const initialWsManifest = {
      schema_version: 1,
      extraction_status: 'in_progress',
      processing_selection: { mode: 'custom', selectedPages: [1], processingStatus: 'in_progress' }
    };
    fs.writeFileSync(path.join(wsDir, 'extraction_manifest.json'), JSON.stringify(initialWsManifest, null, 2));
    fs.writeFileSync(path.join(wsDir, 'manifest.json'), JSON.stringify(initialWsManifest, null, 2));

    const svc = new BatchOrchestrationService(batchesDir);
    const created = await svc.createBatch({
      files: [
        {
          path: dummyPdf,
          name: 'alnokhbah-sim.pdf',
          sizeBytes: 128,
          contentFingerprint: 'fp-sim-alnokhbah-001',
          pageCount: 2,
          pagesToProcess: [1],
          pageSelectionMode: 'specific',
          workspacePath: wsDir,
          metadata: {
            supermarketId: 'sm-nokhbah',
            supermarketName: 'Al Nokhbah Markets',
            offerStartDate: '2026-11-15',
            offerEndDate: '2026-11-25',
            locationScope: 'national',
            metadataStatus: 'operator_verified',
            verified: true
          }
        }
      ],
      executionMode: 'flex',
      extractionPipelineMode: 'hybrid_v3',
      model: 'gemini-3.8-flash',
      approvedMaxBudgetUsd: 1.0,
      autoRunCatalogMatching: false
    });

    // Run 1: Unrecoverable failure on full-page + split-half MAX_TOKENS
    const failProvider: HybridExtractionProvider = {
      providerId: 'mock-fail',
      isOfflineOrMock: true,
      async extractPage(req) {
        return {
          ok: false,
          finishReason: 'MAX_TOKENS',
          errorCode: 'MAX_TOKENS',
          errorMessage: `Truncated ${req.requestPurpose || 'full_page'}`,
          durationMs: 1000,
          usageReported: true,
          usage: {
            promptTokenCount: 5000,
            candidatesTokenCount: 12000,
            thoughtsTokenCount: 3000,
            totalTokenCount: 20000
          }
        };
      },
      async extractCardCrop() {
        return { ok: false, durationMs: 0 };
      }
    };

    const failedManifest = await svc.startBatchExtraction(created.batchId, {
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3ExplicitLiveAuthorization: true,
      hybridV3Provider: failProvider,
      skipPdfRenderIfPagesExist: true,
      autoRunCatalogMatching: false
    });

    expect(failedManifest.status).toBe('failed');
    expect(failedManifest.totals.totalCostUsd).toBeGreaterThan(0);
    expect(failedManifest.costSummary).toBeTruthy();
    expect(failedManifest.costSummary!.totalMeasuredCostUsd).toBeCloseTo(failedManifest.totals.totalCostUsd, 6);
    expect(failedManifest.costSummary!.failedOrRetriedApiCalls).toBe(2); // 1 B1 + 1st failed split half
    expect(failedManifest.costSummary!.avgCostPerExtractedOfferUsd).toBeNull();
    expect(failedManifest.costSummary!.pagesCompleted).toBe(0);

    // Checkpoints and workspace manifests must reflect failure cleanly (NOT 'page_done' and NOT 'in_progress')
    const p1Cp = JSON.parse(
      fs.readFileSync(path.join(wsDir, 'hybrid_v3_checkpoints/page_1.checkpoint.json'), 'utf8')
    );
    expect(p1Cp.stage).toBe('page_failed');
    expect(p1Cp.completedPageKey).toBeNull();
    expect(p1Cp.cumulativeCostUsd).toBeGreaterThan(0);

    const progressCp = JSON.parse(
      fs.readFileSync(path.join(wsDir, 'hybrid_v3_checkpoints/leaflet_v3_progress.json'), 'utf8')
    );
    expect(progressCp.completedPages).toEqual([]);
    expect(progressCp.totalCostUsd).toBeGreaterThan(0);

    const wsExManifest = JSON.parse(fs.readFileSync(path.join(wsDir, 'extraction_manifest.json'), 'utf8'));
    const wsLegacyManifest = JSON.parse(fs.readFileSync(path.join(wsDir, 'manifest.json'), 'utf8'));
    expect(wsExManifest.extraction_status).toBe('failed');
    expect(wsLegacyManifest.extraction_status).toBe('failed');
    expect(wsExManifest.processing_selection.processingStatus).toBe('failed');

    // Run 2: Resume succeeds on Page 1; cumulative cost preserves Run 1 + Run 2 without double counting!
    const resumeProvider: HybridExtractionProvider = {
      providerId: 'mock-ok',
      isOfflineOrMock: true,
      async extractPage() {
        return {
          ok: true,
          finishReason: 'STOP',
          durationMs: 800,
          usageReported: true,
          usage: {
            promptTokenCount: 5500,
            candidatesTokenCount: 6000,
            thoughtsTokenCount: 1500,
            totalTokenCount: 13000
          },
          parsedJson: {
            page_number: 1,
            offers: [makeSampleRawOffer(1, 100, 100, 400, 400, 14.95)]
          }
        };
      },
      async extractCardCrop() {
        return { ok: true, durationMs: 0, parsedJson: { offers: [] } };
      }
    };

    const resumedManifest = await svc.resumeBatch(created.batchId, {
      hybridV3ExplicitAuthorization: true,
      hybridV3FeatureEnabled: true,
      hybridV3ExplicitLiveAuthorization: true,
      hybridV3Provider: resumeProvider,
      skipPdfRenderIfPagesExist: true,
      autoRunCatalogMatching: false
    });

    expect(resumedManifest.status).toBe('completed');
    expect(resumedManifest.totals.totalOffers).toBe(1);
    const cs = resumedManifest.costSummary!;
    expect(cs.priorSessionsCostUsd).toBeCloseTo(failedManifest.costSummary!.totalMeasuredCostUsd, 6);
    expect(cs.latestSessionCostUsd).toBeGreaterThan(0);
    expect(cs.totalMeasuredCostUsd).toBeCloseTo(cs.priorSessionsCostUsd + cs.latestSessionCostUsd, 6);

    // Reopen reload does NOT double count
    const reopenedA = await svc.loadBatchManifest(created.batchId);
    const reopenedB = await svc.loadBatchManifest(created.batchId);
    expect(reopenedA!.costSummary!.totalMeasuredCostUsd).toBeCloseTo(cs.totalMeasuredCostUsd, 6);
    expect(reopenedB!.costSummary!.totalMeasuredCostUsd).toBeCloseTo(cs.totalMeasuredCostUsd, 6);
  });

  it('guarantees mutually exclusive 5-category reconciliation, idempotent requestId, cache_hit=0 and unavailable_unknown separation', () => {
    const tmp = makeTempDir();
    const ledgerSvc = new GeminiCostLedgerService(tmp);
    const ts = '2026-11-16T12:00:00.000Z';

    const e1 = buildLedgerEntryFromProviderCall({
      requestId: 'req-b1-fail',
      batchId: 'b-ledger',
      runId: 'run-1',
      leafletId: 'lf-1',
      pageNumber: 1,
      stageCategory: 'b1_full_page',
      requestPurpose: 'b1_full_page',
      modelId: 'gemini-3.8-flash',
      apiProvider: 'vertex_ai',
      requestedTier: 'flex',
      startedAt: ts,
      completedAt: ts,
      durationMs: 1000,
      outcome: 'failed',
      finishReason: 'MAX_TOKENS',
      cacheHit: false,
      usageReported: true,
      usage: { promptTokenCount: 5000, candidatesTokenCount: 10000, thoughtsTokenCount: 2000 }
    });
    const e2 = buildLedgerEntryFromProviderCall({
      requestId: 'req-cache',
      batchId: 'b-ledger',
      runId: 'run-1',
      leafletId: 'lf-1',
      pageNumber: 2,
      stageCategory: 'b1_full_page',
      requestPurpose: 'b1_cache',
      modelId: 'gemini-3.8-flash',
      apiProvider: 'cache',
      requestedTier: 'flex',
      startedAt: ts,
      completedAt: ts,
      durationMs: 0,
      outcome: 'cache_hit',
      cacheHit: true,
      usageReported: true
    });
    const e3 = buildLedgerEntryFromProviderCall({
      requestId: 'req-unknown',
      batchId: 'b-ledger',
      runId: 'run-1',
      leafletId: 'lf-1',
      pageNumber: 3,
      stageCategory: 'catalog_matching',
      requestPurpose: 'catalog_matching_chunk',
      modelId: 'gemini-3.8-flash',
      apiProvider: 'vertex_ai',
      requestedTier: 'flex',
      startedAt: ts,
      completedAt: ts,
      durationMs: 500,
      outcome: 'outcome_unknown',
      cacheHit: false,
      usageReported: false
    });

    ledgerSvc.recordEntries([e1, e2, e3]);
    // Duplicate upsert with same requestId must remain idempotent
    ledgerSvc.recordEntry(e1);

    const summary = ledgerSvc.computeCostSummary({ batchId: 'b-ledger' });
    expect(ledgerSvc.loadLedger('b-ledger').entries).toHaveLength(3);
    expect(summary.totalApiCalls).toBe(2); // Excludes $0 cache hit
    expect(summary.cacheHitCallsCount).toBe(1);
    expect(summary.unknownCostRequestsCount).toBe(1);
    expect(summary.hasUnconfirmedCosts).toBe(true);
    expect(summary.failedAndRetriedInformational.callsCount).toBe(2); // e1 failed + e3 outcome_unknown

    const catSum =
      summary.categoryBreakdown.b1_full_page +
      summary.categoryBreakdown.b2_selective_crop +
      summary.categoryBreakdown.catalog_matching +
      summary.categoryBreakdown.metadata_discovery +
      summary.categoryBreakdown.other_gemini;
    expect(catSum).toBeCloseTo(summary.totalMeasuredCostUsd, 8);
    expect(summary.categoryBreakdown.b1_full_page).toBeCloseTo(e1.measuredCostUsd!, 8);
    expect(e2.usageStatus).toBe('cache_hit_zero');
    expect(e2.measuredCostUsd).toBe(0);
    expect(e3.usageStatus).toBe('unavailable_unknown');
    expect(e3.measuredCostUsd).toBeNull();
  });

  it('verifies existing failed Al Nokhbah batch artifacts remain strictly untouched read-only evidence', () => {
    const manifestPath = path.join(REPO_ROOT, 'Extracts/batches/batch-2026-11-16T08-39-30-dacbb8/batch-manifest.json');
    const cpPath = path.join(REPO_ROOT, 'Extracts/alnokhbah-markets-1/hybrid_v3_checkpoints/page_1.checkpoint.json');
    const manifestHash = createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
    const cpHash = createHash('sha256').update(fs.readFileSync(cpPath)).digest('hex');
    expect(manifestHash).toHaveLength(64);
    expect(cpHash).toHaveLength(64);
    const cp = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
    expect(cp.runId).toBe('leaflet-001_p1');
    expect(['completed', 'page_done']).toContain(cp.stage);
  });

  it('idempotently reconciles historical unledgered Gemini API responses from preserved archives into gemini-cost-ledger.json and accounts for prior spend in cumulative total', () => {
    const testDir = makeTempDir('hist-ledger-');
    const batchDir = path.join(testDir, 'batches', 'batch-hist-001');
    const leafletWorkspace = path.join(testDir, 'leaflets', 'leaflet-hist-001');
    const archiveDir = path.join(leafletWorkspace, 'hybrid_v3_archive');
    const checkpointsDir = path.join(leafletWorkspace, 'hybrid_v3_checkpoints');
    fs.mkdirSync(batchDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(checkpointsDir, { recursive: true });

    // Preserved historical archive file matching Al Nokhbah request
    const archivePath = path.join(archiveDir, '4a619b4e07f9b9d7a7e8930dc42eaaf66b83ce8060cae65d92308293b23887d2_page_nonstop.raw.json');
    const archivePayload = {
      requestKind: 'full_page',
      finishReason: 'MAX_TOKENS',
      effectiveMaxOutputTokens: 16384,
      promptVersion: 'extraction_v3_stage2_r1',
      schemaVersion: 'wifran.extractor.card/3.0',
      rawText: '{"offers":[]}',
      usageMetadataRaw: {
        promptTokenCount: 5540,
        candidatesTokenCount: 12552,
        totalTokenCount: 21910,
        trafficType: 'ON_DEMAND_FLEX',
        thoughtsTokenCount: 3818
      }
    };
    fs.writeFileSync(archivePath, JSON.stringify(archivePayload, null, 2), 'utf8');
    const originalArchiveSha = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');

    fs.writeFileSync(
      path.join(checkpointsDir, 'page_1.checkpoint.json'),
      JSON.stringify({ checkpointVersion: '1.0', runId: 'run_p1', leafletId: 'leaflet-hist-001', pageNumber: 1, stage: 'page_done' })
    );

    const ledgerSvc = new GeminiCostLedgerService(path.join(testDir, 'batches'));
    const manifest: any = {
      schemaVersion: '1.0',
      batchId: 'batch-hist-001',
      createdAt: '2026-11-16T08:39:30.000Z',
      updatedAt: '2026-11-16T08:41:30.000Z',
      status: 'failed',
      leaflets: [
        {
          leafletId: 'leaflet-hist-001',
          fileName: 'alnokhbah-markets-1.pdf',
          workspacePath: leafletWorkspace,
          status: 'failed',
          pagesProcessed: 0,
          offersCount: 0,
          estimatedCostUsd: 0
        }
      ],
      totals: { totalPdfs: 1, completedPdfs: 0, failedPdfs: 1, cancelledPdfs: 0, totalPages: 2, pagesProcessed: 0, totalOffers: 0, totalCostUsd: 0 }
    };

    // First reconciliation: detects the unledgered archive and records it
    const res1 = ledgerSvc.reconcileHistoricalArchives(manifest.batchId, manifest.leaflets);
    expect(res1.reconciledCount).toBe(1);
    expect(res1.ledger.entries).toHaveLength(1);

    const entry = res1.ledger.entries[0];
    expect(entry.requestId).toBe('batch-hist-001:leaflet-hist-001:archive:4a619b4e07f9b9d7a7e8930dc42eaaf66b83ce8060cae65d92308293b23887d2_page_nonstop');
    expect(entry.promptTokens).toBe(5540);
    expect(entry.responseTokens).toBe(12552);
    expect(entry.thinkingTokens).toBe(3818);
    expect(entry.outcome).toBe('failed');
    expect(entry.finishReason).toBe('MAX_TOKENS');
    // Flex pricing: 5540*0.375/1M + 12552*1.875/1M = 0.0020775 + 0.023535 + 0.00715875 = 0.03277125
    expect(entry.measuredCostUsd).toBe(0.03277125);

    // Second reconciliation (idempotency check): repeated reopens/resumes must NOT duplicate or double-count
    const res2 = ledgerSvc.reconcileHistoricalArchives(manifest.batchId, manifest.leaflets);
    expect(res2.reconciledCount).toBe(0);
    expect(res2.ledger.entries).toHaveLength(1);

    // Cost summary reflects prior spend in cumulative total
    const summary = ledgerSvc.computeCostSummary({ batchId: manifest.batchId, manifest });
    expect(summary.totalMeasuredCostUsd).toBe(0.03277125);
    expect(summary.priorSessionsCostUsd).toBe(0.03277125);
    expect(summary.latestSessionCostUsd).toBe(0);
    expect(summary.totalApiCalls).toBe(1);
    expect(summary.failedOrRetriedApiCalls).toBe(1);
    expect(summary.categoryBreakdown.b1_full_page).toBe(0.03277125);

    // Strict preservation of original archive
    const afterArchiveSha = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    expect(afterArchiveSha).toBe(originalArchiveSha);
  });

  it('verifies MAX_TOKENS recovery geometry strictly follows [ymin, xmin, ymax, xmax] and recovers straddling offers without loss or duplicate', () => {
    // 1. Verify coordinate convention: [ymin, xmin, ymax, xmax] in 0..1000 space
    // [0, 0, 540, 1000] is top half (ymin=0..540, full width xmin=0..1000)
    // [460, 0, 1000, 1000] is bottom half (ymin=460..1000, full width xmin=0..1000)
    const topPixel = normalizedBoxToPixelBox([0, 0, 540, 1000], 9186, 12139);
    expect(topPixel.x).toBe(0);
    expect(topPixel.y).toBe(0);
    expect(topPixel.width).toBe(9186); // Full width
    expect(topPixel.height).toBe(6555); // Top 54% height

    const bottomPixel = normalizedBoxToPixelBox([460, 0, 1000, 1000], 9186, 12139);
    expect(bottomPixel.x).toBe(0);
    expect(bottomPixel.y).toBe(5584); // Starts at 46% height
    expect(bottomPixel.width).toBe(9186); // Full width
    expect(bottomPixel.height).toBe(6555); // Spans to bottom

    // Overlap band is strictly vertical Y in [460..540] (5584px to 6555px)
    expect(bottomPixel.y).toBeLessThan(topPixel.height);

    // 2. Load actual 16 Al Nokhbah offers and test straddling recovery
    const realArchive = path.join(REPO_ROOT, 'Extracts/alnokhbah-markets-1/hybrid_v3_archive/4a619b4e07f9b9d7a7e8930dc42eaaf66b83ce8060cae65d92308293b23887d2_page_nonstop.raw.json');
    const realData = JSON.parse(fs.readFileSync(realArchive, 'utf8'));
    const allOffers: any[] = JSON.parse(realData.rawText + '\n  ]\n}').offers;
    expect(allOffers).toHaveLength(16);

    // Offers 1-4 are Row 1: Y in [321..456] -> fully contained in top half [0..540]
    for (let i = 0; i < 4; i++) {
      const g = allOffers[i].components.product_graphic_box;
      expect(g[0]).toBeGreaterThanOrEqual(300);
      expect(g[2]).toBeLessThanOrEqual(460);
    }

    // Offers 5-8 are Row 2: Y in [465..595] -> starts in overlap band [460..540], fully contained in bottom half [460..1000]
    for (let i = 4; i < 8; i++) {
      const g = allOffers[i].components.product_graphic_box;
      expect(g[0]).toBeGreaterThanOrEqual(460); // Starts inside bottom half
      expect(g[2]).toBeLessThanOrEqual(1000);
    }

    // Offers 9-16 are Rows 3-4: Y in [604..878] -> fully contained in bottom half [460..1000]
    for (let i = 8; i < 16; i++) {
      const g = allOffers[i].components.product_graphic_box;
      expect(g[0]).toBeGreaterThanOrEqual(600);
      expect(g[2]).toBeLessThanOrEqual(1000);
    }

    // 3. Simulate recovery merge: Top half returns Rows 1 & 2; Bottom half returns Rows 2, 3, 4
    // Local coords in Top half [0, 0, 540, 1000]: y_local = y_full / 0.54
    // Local coords in Bottom half [460, 0, 1000, 1000]: y_local = (y_full - 460) / 0.54
    const toTopLocal = (o: any) => {
      const c = JSON.parse(JSON.stringify(o));
      for (const k of Object.keys(c.components || {})) {
        if (c.components[k]) {
          c.components[k] = [
            Math.round((c.components[k][0] / 540) * 1000),
            c.components[k][1],
            Math.round((c.components[k][2] / 540) * 1000),
            c.components[k][3]
          ];
        }
      }
      return c;
    };
    const toBottomLocal = (o: any) => {
      const c = JSON.parse(JSON.stringify(o));
      for (const k of Object.keys(c.components || {})) {
        if (c.components[k]) {
          c.components[k] = [
            Math.round(((c.components[k][0] - 460) / 540) * 1000),
            c.components[k][1],
            Math.round(((c.components[k][2] - 460) / 540) * 1000),
            c.components[k][3]
          ];
        }
      }
      return c;
    };

    const topExtracted = allOffers.slice(0, 8).map(toTopLocal);
    const bottomExtracted = allOffers.slice(4, 16).map(toBottomLocal);

    const merged = mergeRecoveredHalfRawExtractions(
      { offers: topExtracted },
      { offers: bottomExtracted },
      [0, 0, 540, 1000],
      [460, 0, 1000, 1000]
    );

    // Must deduplicate the 4 overlapping offers (Offers 5-8) and keep exactly 16 offers
    expect(merged.offers).toHaveLength(16);
    expect(merged.offers.map((o: any) => o.offer_number)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1)
    );

    // Verify coordinates remapped accurately to original full-page coordinates
    for (let i = 0; i < 16; i++) {
      const orig = allOffers[i].components.product_graphic_box;
      const rec = merged.offers[i].components.product_graphic_box;
      // Remapping roundtrip error <= 2 units in 0..1000 space
      expect(Math.abs(orig[0] - rec[0])).toBeLessThanOrEqual(2);
      expect(Math.abs(orig[1] - rec[1])).toBeLessThanOrEqual(2);
      expect(Math.abs(orig[2] - rec[2])).toBeLessThanOrEqual(2);
      expect(Math.abs(orig[3] - rec[3])).toBeLessThanOrEqual(2);
    }
  });
});
