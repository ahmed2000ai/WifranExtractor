/**
 * WIFRAN-EXTRACTOR-IDENTITY-005H-B2-PREP
 * Strictly offline regression suite (zero paid API calls, zero Supabase writes).
 *
 * Covers:
 * 1. MAX_TOKENS fail-closed rejection & 16,384 output token floor (B1-REQ-04 Pepsi replay).
 * 2. Optimized `extraction_v3_crop_r1` / `wifran.extractor.crop/3.0` prompt + schema & lossless adapter.
 * 3. Simplified verified leaflet date resolution (`manifest.json` & cover page; zero folder-name fabrication)
 *    plus separation of historical offline accuracy usability vs `EXPIRED_OFFER_DATES` live block.
 * 4. Conditional/ambiguous price publication guards + Seara / Sun Top quantity semantics.
 * 5. Assortment completeness replay across B1 Lipton #10, Baskin Robbins, Pepsi, Moussy, Tide, Persil, L'Oreal/Garnier.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  V3_CROP_SCHEMA_VERSION,
  V3_EXTRACTION_SCHEMA_VERSION,
  adaptV3CropExtractionToV3PagePayload,
  decodeV3PageExtractionToOfferCards,
  getV3CardCropGenAiSchema,
  getV3LeafletPageGenAiSchema
} from '../../../shared/schemas/leafletPageExtractionV3Schema';
import { assessOfferPublicationOutcome } from '../../../shared/utils/nonCatalogPublicationPolicy';
import {
  V3_CROP_PROMPT_VERSION,
  V3_PROMPT_VERSION,
  buildV3CardCropSystemPrompt,
  buildV3CardCropUserPrompt,
  estimateV3CropPromptSavings,
  getV3CropPromptAndSchemaFingerprints,
  getV3PromptAndSchemaFingerprints
} from '../geminiV3PromptBuilder';
import { decomposeV3OfferCard } from '../offerV3DecompositionEngine';
import { adaptV3DecompositionToOfflineMatching } from '../../db/v3MatchingInputAdapter';
import {
  HYBRID_LIVE_MIN_CARD_OUTPUT_TOKENS,
  createHybridGeminiLiveProvider
} from '../hybrid/hybridGeminiLiveProvider';
import {
  evaluateHistoricalLeafletDateStatus,
  resolveLeafletDateMetadata
} from '../hybrid/leafletDateMetadata';
import { runHybridPageWorkflow } from '../hybrid/hybridWorkflowOrchestrator';

function loadJson<T = any>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), relPath), 'utf8')) as T;
}

describe('005H-B2-PREP: Core Extraction Fixes & B2 Readiness (Offline)', () => {
  it('enforces >= 16,384 output token floor on crops & pages and rejects MAX_TOKENS fail-closed (B1-REQ-04 Pepsi replay)', async () => {
    const b1PageRaw = loadJson(
      'Extracts/pilot_v3_005h_b1/raw/8dd795e5f3744a829c6e7853434d0b2ccdbf53d1e9c711a5288fdf7bdd3185a9_page.raw.json'
    );
    const b1PepsiRaw = loadJson(
      'Extracts/pilot_v3_005h_b1/raw/cf87505e1ae88413b9ac87c0ebd94f66417003cf483f660c50914810ba634d8c_crop_nonstop.raw.json'
    );
    const pepsiOfferId = 'panda-national-national-2026-10-20_p002_005';
    const pepsiCropPath = resolve(
      process.cwd(),
      'Extracts/pilot_v3_005h_b1/crops/panda-national-national-2026-10-20_p002/panda-national-national-2026-10-20_p002_005_crop.webp'
    );
    expect(existsSync(pepsiCropPath)).toBe(true);
    expect(b1PepsiRaw.finishReason).toBe('MAX_TOKENS');

    const capturedConfigs: any[] = [];
    const mockClient = {
      vertexai: true,
      models: {
        generateContent: async (req: any) => {
          capturedConfigs.push(req);
          if (req.config?.maxOutputTokens < HYBRID_LIVE_MIN_CARD_OUTPUT_TOKENS) {
            throw new Error('BUG: output floor violated');
          }
          // Replay exact MAX_TOKENS truncated failure observed in B1-REQ-04
          return {
            text: b1PepsiRaw.rawResponseText || '{"offers":[',
            candidates: [
              {
                finishReason: 'MAX_TOKENS',
                content: { parts: [{ text: b1PepsiRaw.rawResponseText || '{"offers":[' }] }
              }
            ],
            usageMetadata: b1PepsiRaw.usageMetadataRaw
          };
        }
      }
    };

    const workDir = mkdtempSync(join(tmpdir(), 'b2-prep-max-tokens-'));
    try {
      const liveProvider = createHybridGeminiLiveProvider({
        executionContext: 'isolated_hybrid_workflow',
        featureEnabled: true,
        explicitLiveAuthorization: true,
        maxOutputTokens: 6144, // Attempt to downgrade below 16,384 (must be clamped up!)
        archiveDir: join(workDir, 'raw'),
        client: mockClient
      });

      const directCropResult = await liveProvider.extractCardCrop({
        requestKind: 'card_crop',
        cacheKey: 'pepsi_max_tokens_replay',
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        retailer: 'Panda',
        sourceOfferId: pepsiOfferId,
        imagePath: pepsiCropPath,
        pixelBox: { x: 31, y: 1273, width: 730, height: 777 },
        promptText: ''
      });

      expect(capturedConfigs.length).toBe(1);
      expect(capturedConfigs[0].config.maxOutputTokens).toBe(HYBRID_LIVE_MIN_CARD_OUTPUT_TOKENS);
      expect(HYBRID_LIVE_MIN_CARD_OUTPUT_TOKENS).toBe(16384);
      expect(directCropResult.ok).toBe(false);
      expect(directCropResult.errorCode).toBe('GEMINI_FINISH_REASON_MAX_TOKENS');
      expect(directCropResult.parsedJson).toBeUndefined();

      // Verify end-to-end hybrid orchestrator holds P0 Pepsi fail-closed on MAX_TOKENS crop failure
      const workflowRes = await runHybridPageWorkflow({
        executionContext: 'isolated_hybrid_workflow',
        explicitAuthorization: true,
        featureEnabled: true,
        runId: 'test_pepsi_max_tokens_hold',
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        retailer: 'Panda',
        manifestPath: resolve(process.cwd(), 'Extracts/Panda_Test/manifest.json'),
        disablePageContextVerification: true,
        pageAssetPath: 'Extracts/Panda_Test/pages/page.2.png',
        pageImagePath: resolve(process.cwd(), 'Extracts/Panda_Test/pages/page.2.png'),
        cropOutputDir: join(workDir, 'crops'),
        allowedCropSourceOfferIds: [pepsiOfferId],
        budgetPolicy: { maxRequestsPerJob: 5, maxSpendUsdPerJob: 0.2 },
        provider: {
          providerId: 'mock_pepsi_max_tokens',
          isOfflineOrMock: true,
          extractPage: async () => ({
            ok: true,
            parsedJson: b1PageRaw.parsedResponse,
            durationMs: 100
          }),
          extractCardCrop: (req) => liveProvider.extractCardCrop(req)
        }
      });

      expect(workflowRes.ok).toBe(true);
      expect(workflowRes.cropsFailedOrInvalidCount).toBe(1);
      expect(workflowRes.telemetry.pageContextRequests).toBe(0);
      const pepsiReconciled = workflowRes.reconciledCards.find(
        (c) => c.sourceOfferId === pepsiOfferId
      );
      expect(pepsiReconciled).toBeDefined();
      expect(pepsiReconciled!.overallStatus).toBe('held_unverified_p0_budget_or_failure');
      expect(pepsiReconciled!.publicationAssessment.isSafeForNonCatalogPublication).toBe(false);
      expect(pepsiReconciled!.matchingAdapterSummary.matchableChildrenCount).toBe(0);
      expect(pepsiReconciled!.publicationAssessment.quarantineReasons).toContain(
        'UNVERIFIED_P0_FAILED'
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('uses lightweight extraction_v3_crop_r1 on card crops while keeping Stage 1 page prompt & schema frozen', async () => {
    const pageFp = getV3PromptAndSchemaFingerprints();
    const cropFp = getV3CropPromptAndSchemaFingerprints();
    expect(pageFp.promptVersion).toBe('extraction_v3_stage2_r1');
    expect(pageFp.schemaVersion).toBe('wifran.extractor.card/3.0');
    expect(V3_PROMPT_VERSION).toBe('extraction_v3_stage2_r1');
    expect(V3_EXTRACTION_SCHEMA_VERSION).toBe('wifran.extractor.card/3.0');
    expect(cropFp.promptVersion).toBe(V3_CROP_PROMPT_VERSION);
    expect(cropFp.promptVersion).toBe('extraction_v3_crop_r1');
    expect(cropFp.schemaVersion).toBe(V3_CROP_SCHEMA_VERSION);
    expect(cropFp.schemaVersion).toBe('wifran.extractor.crop/3.0');

    const savings = estimateV3CropPromptSavings();
    expect(savings.isEstimate).toBe(true);
    expect(savings.afterPromptChars).toBeLessThan(savings.beforePromptChars);
    expect(savings.afterSchemaJsonChars).toBeLessThan(savings.beforeSchemaJsonChars);
    expect(savings.estimatedPromptAndSchemaTokenReduction).toBeGreaterThan(1000);

    const cropSysPrompt = buildV3CardCropSystemPrompt();
    expect(cropSysPrompt).toContain('sub_items');
    expect(cropSysPrompt).toContain('manufacturer_pack_count');
    expect(cropSysPrompt).toContain('retailer_checkout_multibuy_qty');
    expect(cropSysPrompt).toContain('components bboxes');
    expect(cropSysPrompt).not.toContain('ignored_banners');
    expect(cropSysPrompt).not.toContain('validity_start_date');

    const cropSchema = getV3CardCropGenAiSchema();
    const fullPageSchema = getV3LeafletPageGenAiSchema();
    const cropProps = cropSchema.properties as Record<string, unknown>;
    const fullPageProps = fullPageSchema.properties as Record<string, unknown>;
    expect(cropProps.offers).toBeDefined();
    expect(cropProps.is_loyalty_page).toBeUndefined();
    expect(cropProps.validity_start_date).toBeUndefined();
    expect(fullPageProps.is_loyalty_page).toBeUndefined();
    expect(fullPageProps.page_currency).toBeUndefined();
    expect(fullPageProps.validity_start_date).toBeDefined();

    const userPrompt = buildV3CardCropUserPrompt({
      retailer: 'Panda',
      leafletId: 'panda-national-national-2026-10-20',
      slotId: 'panda_p002_008'
    });
    expect(userPrompt).toContain('panda_p002_008');

    // Replay Sun Top saved tiers through HybridGeminiLiveProvider crop mode -> lossless adaptation
    const sunTopRaw = loadJson(
      'Extracts/pilot_v3_005h_b1/raw/ed59201cbf5f7a4f2536c61de1d28104540b3a10f82391e0ce8e5a7fde05bf39_crop.raw.json'
    );
    const cropOnlyPayload = {
      schema_version: 'wifran.extractor.crop/3.0',
      page_currency: 'SAR',
      offers: sunTopRaw.parsedResponse.offers
    };
    const adapted = adaptV3CropExtractionToV3PagePayload(cropOnlyPayload);
    expect(adapted).toBeDefined();

    const decodedFromCrop = decodeV3PageExtractionToOfferCards(adapted, {
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 2,
      sourceOfferIdPrefix: 'panda_p002',
      retailerName: 'Panda',
      tolerateOmittedNullableFields: true
    });
    expect(decodedFromCrop.cards.length).toBe(2);
    expect(decodedFromCrop.cards[0].pricing.promo_price).toBe(41.99);
    expect(decodedFromCrop.cards[0].quantity_and_promo.loyalty_required).toBe(false);
    expect(decodedFromCrop.cards[1].pricing.promo_price).toBe(15.99);

    let capturedCropReq: any = null;
    const workDir = mkdtempSync(join(tmpdir(), 'b2-prep-crop-mode-'));
    try {
      const sunTopImgPath = resolve(
        process.cwd(),
        'Extracts/pilot_v3_005h_b1/crops/panda-national-national-2026-10-20_p002/panda-national-national-2026-10-20_p002_008_crop.webp'
      );
      const provider = createHybridGeminiLiveProvider({
        executionContext: 'isolated_hybrid_workflow',
        featureEnabled: true,
        explicitLiveAuthorization: true,
        archiveDir: join(workDir, 'raw'),
        client: {
          vertexai: true,
          models: {
            generateContent: async (req: any) => {
              capturedCropReq = req;
              return {
                text: JSON.stringify(cropOnlyPayload),
                candidates: [
                  {
                    finishReason: 'STOP',
                    content: { parts: [{ text: JSON.stringify(cropOnlyPayload) }] }
                  }
                ],
                usageMetadata: { promptTokenCount: 4400, candidatesTokenCount: 1600, thoughtsTokenCount: 1500 }
              };
            }
          }
        }
      });

      const res = await provider.extractCardCrop({
        requestKind: 'card_crop',
        cacheKey: 'suntop_crop_r1_test',
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        retailer: 'Panda',
        sourceOfferId: 'panda_p002_008',
        imagePath: sunTopImgPath,
        pixelBox: { x: 30, y: 1938, width: 709, height: 792 },
        promptText: ''
      });

      expect(res.ok).toBe(true);
      expect(res.promptVersion).toBe('extraction_v3_crop_r1');
      expect(res.schemaVersion).toBe('wifran.extractor.crop/3.0');
      expect(capturedCropReq.config.systemInstruction).toBe(buildV3CardCropSystemPrompt());
      expect(capturedCropReq.config.responseSchema.properties.is_loyalty_page).toBeUndefined();
      expect((res.parsedJson as any).offers).toHaveLength(2);
      const redecoded = decodeV3PageExtractionToOfferCards(res.parsedJson, {
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        sourceOfferIdPrefix: 'panda_p002',
        retailerName: 'Panda',
        tolerateOmittedNullableFields: true
      });
      expect(redecoded.cards[0].schema_version).toBe('wifran.extractor.card/3.0');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('resolves verified leaflet dates from manifest/operator/cover only (never folder names) and enforces EXPIRED_OFFER_DATES for consumer publication', () => {
    // 1. Panda manifest has 2026-10-13..2026-10-19 whereas folder slug has 2026-10-20
    const pandaDates = resolveLeafletDateMetadata({
      pageImagePath: resolve(process.cwd(), 'Extracts/Panda_Test/pages/page.2.png'),
      pageNumber: 2
    });
    expect(pandaDates.resolved).toBe(true);
    expect(pandaDates.source).toBe('operator_manifest');
    expect(pandaDates.offerStartDate).toBe('2026-10-13');
    expect(pandaDates.offerEndDate).toBe('2026-10-19');

    const bndwDates = resolveLeafletDateMetadata({
      manifestPath: resolve(process.cwd(), 'Extracts/BNDW_Test/manifest.json'),
      pageNumber: 4
    });
    expect(bndwDates.offerStartDate).toBe('2026-10-14');
    expect(bndwDates.offerEndDate).toBe('2026-10-20');

    const nooriDates = resolveLeafletDateMetadata({
      manifestPath: resolve(process.cwd(), 'Extracts/noori-supermarket-229798534-jeddah/manifest.json'),
      pageNumber: 1
    });
    expect(nooriDates.offerStartDate).toBe('2026-11-05');
    expect(nooriDates.offerEndDate).toBe('2026-11-15');

    // 2. Verified cover page resolves dates when pageNumber === 1, NEVER on unverified interior page
    const coverResolved = resolveLeafletDateMetadata({
      coverPageValidityStartDate: '2026-11-01',
      coverPageValidityEndDate: '2026-11-07',
      pageNumber: 1
    });
    expect(coverResolved.resolved).toBe(true);
    expect(coverResolved.source).toBe('verified_cover_page');

    // 3. Path/slug containing YYYY-MM-DD with no manifest & no cover dates MUST NOT fabricate dates
    const unresolvedFromSlug = resolveLeafletDateMetadata({
      pageImagePath: 'C:/tmp/panda-national-national-2026-12-25/pages/page.2.png',
      pageNumber: 2
    });
    expect(unresolvedFromSlug.resolved).toBe(false);
    expect(unresolvedFromSlug.source).toBe('unresolved');
    expect(unresolvedFromSlug.offerStartDate).toBeNull();
    expect(unresolvedFromSlug.offerEndDate).toBeNull();

    // 4. Historical expired leaflet usability in accuracy evaluation vs blocked in consumer publication
    const historicalStatus = evaluateHistoricalLeafletDateStatus({
      offerStartDate: pandaDates.offerStartDate,
      offerEndDate: pandaDates.offerEndDate,
      publicationReferenceDateIso: '2026-11-14'
    });
    expect(historicalStatus.hasValidRange).toBe(true);
    expect(historicalStatus.usableInOfflineAccuracyEvaluation).toBe(true);
    expect(historicalStatus.isExpiredForPublication).toBe(true);
    expect(historicalStatus.eligibleForConsumerPublication).toBe(false);
    expect(historicalStatus.quarantineCode).toBe('EXPIRED_OFFER_DATES');

    const expiredPolicy = assessOfferPublicationOutcome({
      offer: {
        batchOfferKey: 'panda_expired_pub_gate',
        supermarketId: 'panda',
        leafletId: 'panda-test',
        sourceOfferId: 'panda_p002_002',
        locationScope: 'national',
        offerStartDate: '2026-10-13',
        offerEndDate: '2026-10-19',
        titleEn: 'Seara Frozen Chicken 10x900g',
        titleAr: 'دجاج سيارا مجمد 10×900 جم',
        promoPrice: 134.99,
        currency: 'SAR'
      } as any,
      enforceNonExpiredForPublication: true,
      publicationReferenceDateIso: '2026-11-14'
    });
    expect(expiredPolicy.outcome).toBe('quarantined');
    expect(expiredPolicy.isEligibleForNonCatalogPublication).toBe(false);
    expect(expiredPolicy.quarantineReasons).toContain('EXPIRED_OFFER_DATES');
  });

  it('blocks B1 Lipton #10 generic/dietary invented variants while preserving Baskin Robbins, Moussy, Seara, and conditional-price protection', () => {
    const b1PageRaw = loadJson(
      'Extracts/pilot_v3_005h_b1/raw/8dd795e5f3744a829c6e7853434d0b2ccdbf53d1e9c711a5288fdf7bdd3185a9_page.raw.json'
    );
    const decoded = decodeV3PageExtractionToOfferCards(b1PageRaw.parsedResponse, {
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 2,
      sourceOfferIdPrefix: 'panda-national-national-2026-10-20_p002',
      retailerId: 'panda',
      retailerName: 'Panda',
      tolerateOmittedNullableFields: true
    });
    for (const c of decoded.cards) {
      c.source_card.offer_start_date = '2026-10-13';
      c.source_card.offer_end_date = '2026-10-19';
    }

    const cardByOfferNum = new Map(
      decoded.cards.map((c) => [Number(c.source_card.source_offer_id.slice(-3)), c])
    );

    // 1. Lipton #10 ("شاي مثلج متنوع ليبتون" with generic/dietary "Regular" / "Zero Sugar"): MUST NOT split!
    const liptonCard = cardByOfferNum.get(10)!;
    const liptonDec = decomposeV3OfferCard(liptonCard);
    expect(liptonDec.decomposed).toBe(false);
    expect(liptonDec.children.length).toBe(0);
    expect(liptonDec.conflict_codes).toContain('UNLABELED_SWATCH_OR_BOTTLE_VARIANTS');
    expect(liptonDec.parent_offer_retention_mode).toBe('unsplit_non_catalog_candidate');

    // 2. Baskin Robbins #6 (explicit named Vanilla / Chocolate): safely splits!
    const baskinDec = decomposeV3OfferCard(cardByOfferNum.get(6)!);
    expect(baskinDec.decomposed).toBe(true);
    expect(baskinDec.children.map((c) => c.variant_or_flavor)).toEqual(['Vanilla', 'Chocolate']);

    // 3. Moussy #9 (explicit named Classic / Pomegranate): safely splits!
    const moussyDec = decomposeV3OfferCard(cardByOfferNum.get(9)!);
    expect(moussyDec.decomposed).toBe(true);
    expect(moussyDec.children.map((c) => c.variant_or_flavor)).toEqual(['Classic', 'Pomegranate']);

    // 4. Seara #2 carton (10x900g mfg pack) vs Seara #3 checkout multibuy (3 PCS)
    const searaCartonDec = decomposeV3OfferCard(cardByOfferNum.get(2)!);
    expect(searaCartonDec.normalized_card.quantity_and_promo.manufacturer_pack_count).toBe(10);
    expect(searaCartonDec.normalized_card.quantity_and_promo.retailer_checkout_multibuy_qty).toBeNull();
    const searaMultibuyDec = decomposeV3OfferCard(cardByOfferNum.get(3)!);
    expect(searaMultibuyDec.normalized_card.quantity_and_promo.manufacturer_pack_count).toBe(1);
    expect(searaMultibuyDec.normalized_card.quantity_and_promo.retailer_checkout_multibuy_qty).toBe(3);

    // Conditional checkout multibuy price must NOT enter an unconditional consumer feed
    const searaUnconditionalGate = adaptV3DecompositionToOfflineMatching(searaMultibuyDec, {
      requireUnconditionalPriceForPublication: true
    });
    expect(searaUnconditionalGate.parentPublicationAssessment.outcome).toBe('quarantined');
    expect(
      searaUnconditionalGate.parentPublicationAssessment.isEligibleForNonCatalogPublication
    ).toBe(false);
    expect(searaUnconditionalGate.parentPublicationAssessment.quarantineReasons).toContain(
      'CONDITIONAL_PRICE_NOT_UNCONDITIONAL'
    );

    // Unrepresented conditional loyalty price (loyalty_required without program or promo note) must quarantine
    const searaCartonClone = structuredClone(cardByOfferNum.get(2)!);
    searaCartonClone.quantity_and_promo.loyalty_required = true;
    searaCartonClone.quantity_and_promo.loyalty_program_name = null;
    searaCartonClone.pricing.promo_conditions = null;
    const loyaltyWithoutConditionAdapter = adaptV3DecompositionToOfflineMatching(
      decomposeV3OfferCard(searaCartonClone)
    );
    expect(
      loyaltyWithoutConditionAdapter.parentPublicationAssessment.isEligibleForNonCatalogPublication
    ).toBe(false);
    expect(
      loyaltyWithoutConditionAdapter.parentPublicationAssessment.quarantineReasons
    ).toContain('UNREPRESENTED_CONDITIONAL_PRICE');

    // Replay control set from 005E: Tide, Persil, Wafir contradiction, L'Oreal/Garnier page card
    for (const [rp, leafletId, pageNum, expectedBlock] of [
      [
        'Extracts/pilot_v3_005e/responses/pilot_crop_02_moussy.raw.json',
        'Panda_Test',
        2,
        false
      ],
      [
        'Extracts/pilot_v3_005e/responses/pilot_crop_06_tide_partial_negative.raw.json',
        'BNDW_Test',
        4,
        true
      ],
      [
        'Extracts/pilot_v3_005e/responses/pilot_crop_07_persil_sku_negative.raw.json',
        'BNDW_Test',
        4,
        true
      ],
      [
        'Extracts/pilot_v3_005e/responses/pilot_crop_10_wafir_conflict_negative.raw.json',
        'noori-supermarket-229798534-jeddah',
        1,
        true
      ]
    ] as const) {
      const raw = loadJson(rp);
      const dec = decodeV3PageExtractionToOfferCards(raw.parsedResponse, {
        leafletId,
        pageNumber: pageNum,
        sourceOfferIdPrefix: leafletId,
        retailerName: leafletId,
        tolerateOmittedNullableFields: true
      });
      const decomp = decomposeV3OfferCard(dec.cards[0]);
      if (expectedBlock) {
        expect(decomp.children.length).toBe(0);
      } else {
        expect(decomp.decomposed).toBe(true);
        expect(decomp.children.length).toBe(2);
      }
    }

    const alwafaPageRaw = loadJson('Extracts/pilot_v3_005e/responses/pilot_page_04_alwafa_p001.raw.json');
    const alwafaDecoded = decodeV3PageExtractionToOfferCards(alwafaPageRaw.parsedResponse, {
      leafletId: 'Alwafa_Test',
      pageNumber: 1,
      sourceOfferIdPrefix: 'Alwafa_Test_p001',
      retailerName: 'Alwafa',
      tolerateOmittedNullableFields: true
    });
    const lorealCard = alwafaDecoded.cards.find(
      (c) => c.source_card.source_offer_id === 'Alwafa_Test_p001_011'
    )!;
    const lorealDec = decomposeV3OfferCard(lorealCard);
    expect(lorealDec.decomposed).toBe(false);
    expect(lorealDec.children.length).toBe(0);
    expect(lorealDec.conflict_codes).toContain('INCOMPLETE_VISIBLE_ASSORTMENT');
  });

  it('replays all four Stage B2 saved raw archives with strict crop decode and safety/quarantine enforcement', () => {
    const b2Cases = [
      {
        rawPath: 'Extracts/pilot_v3_005h_b2/raw/b2_b2-req-01_7213fc8a14b6_crop.raw.json',
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        retailerId: 'panda',
        retailerName: 'Panda',
        manifestRelPath: 'Extracts/Panda_Test/manifest.json'
      },
      {
        rawPath: 'Extracts/pilot_v3_005h_b2/raw/b2_b2-req-02_d921786d4a84_crop.raw.json',
        leafletId: 'BNDW_Test',
        pageNumber: 4,
        retailerId: 'bindawood',
        retailerName: 'BinDawood',
        manifestRelPath: 'Extracts/BNDW_Test/manifest.json'
      },
      {
        rawPath: 'Extracts/pilot_v3_005h_b2/raw/b2_b2-req-03_66d6ec00e804_crop.raw.json',
        leafletId: 'noori-supermarket-229798534-jeddah',
        pageNumber: 1,
        retailerId: 'noori',
        retailerName: 'Noori Supermarket',
        manifestRelPath: 'Extracts/noori-supermarket-229798534-jeddah/manifest.json'
      },
      {
        rawPath: 'Extracts/pilot_v3_005h_b2/raw/b2_b2-req-04_c297a98f0db9_crop.raw.json',
        leafletId: 'noori-supermarket-229798534-jeddah',
        pageNumber: 1,
        retailerId: 'noori',
        retailerName: 'Noori Supermarket',
        manifestRelPath: 'Extracts/noori-supermarket-229798534-jeddah/manifest.json'
      }
    ] as const;

    const replayed = b2Cases.map((tc) => {
      const raw = loadJson(tc.rawPath);
      expect(raw.finishReason).toBe('STOP');
      expect(raw.promptVersion).toBe('extraction_v3_crop_r1');
      expect(raw.schemaVersion).toBe('wifran.extractor.crop/3.0');
      const dates = resolveLeafletDateMetadata({
        manifestPath: resolve(process.cwd(), tc.manifestRelPath),
        pageNumber: tc.pageNumber
      });
      expect(dates.resolved).toBe(true);

      const strictDecoded = decodeV3PageExtractionToOfferCards(
        adaptV3CropExtractionToV3PagePayload(raw.parsedResponse),
        {
          leafletId: tc.leafletId,
          pageNumber: tc.pageNumber,
          sourceOfferIdPrefix: `${tc.leafletId}_p${String(tc.pageNumber).padStart(3, '0')}`,
          retailerId: tc.retailerId,
          retailerName: tc.retailerName,
          locationScope: 'national',
          tolerateOmittedNullableFields: false
        }
      );

      return strictDecoded.cards.map((card) => {
        card.source_card.offer_start_date = dates.offerStartDate;
        card.source_card.offer_end_date = dates.offerEndDate;
        const decomposition = decomposeV3OfferCard(card);
        const adapter = adaptV3DecompositionToOfflineMatching(decomposition, {
          enforceNonExpiredForPublication: true,
          publicationReferenceDateIso: '2026-11-14',
          nonCatalogApproval: {
            batchOfferKey: card.source_card.source_offer_id,
            decision: 'approved',
            category: 'valid_grocery_unresolved_sku',
            updatedAt: '2026-11-14T12:00:00.000Z'
          }
        });
        return { card, decomposition, adapter };
      });
    });

    // B2-REQ-01 Pepsi: 2 cards, zero truncation, 12x150ml preserved, incomplete assortment blocked from matchable children
    const pepsi = replayed[0];
    expect(pepsi).toHaveLength(2);
    expect(pepsi.map((x) => x.card.pricing.promo_price)).toEqual([15.99, 19.99]);
    for (const tier of pepsi) {
      expect(tier.card.quantity_and_promo.manufacturer_pack_count).toBe(12);
      expect(tier.card.quantity_and_promo.each_size_value).toBe(150);
      expect(tier.card.quantity_and_promo.each_size_unit).toBe('ml');
      expect(tier.card.quantity_and_promo.retailer_checkout_multibuy_qty).toBeNull();
      expect(tier.decomposition.conflict_codes).toContain('INCOMPLETE_VISIBLE_ASSORTMENT');
      expect(tier.adapter.matchableChildren).toHaveLength(0);
      expect(tier.adapter.parentPublicationAssessment.quarantineReasons).toContain('EXPIRED_OFFER_DATES');
    }

    // B2-REQ-02 Tide: 1 card, unnamed SKUs remain unsplit & non-matchable
    const tide = replayed[1];
    expect(tide).toHaveLength(1);
    expect(tide[0].card.pricing.promo_price).toBe(34.99);
    expect(tide[0].card.pricing.original_price).toBe(67.5);
    expect(tide[0].card.quantity_and_promo.each_size_value).toBe(4);
    expect(tide[0].card.quantity_and_promo.each_size_unit).toBe('kg');
    expect(tide[0].card.quantity_and_promo.manufacturer_pack_count).toBe(1);
    expect(tide[0].decomposition.conflict_codes).toContain('RETAILER_SKU_WITHOUT_VARIANT_NAMES');
    expect(tide[0].adapter.matchableChildren).toHaveLength(0);
    for (const s of tide[0].card.sub_items) {
      expect(s.variant_or_flavor).toBeNull();
      expect(s.unknown_attributes).toContain('variant_or_flavor');
    }

    // B2-REQ-03 Wafir: 2.5kg vs 2kg visual conflict quarantined even with mock operator approval
    const wafir = replayed[2];
    expect(wafir).toHaveLength(1);
    expect(wafir[0].card.pricing.promo_price).toBe(10.99);
    expect(wafir[0].card.pricing.original_price).toBe(27.95);
    expect(wafir[0].decomposition.conflict_codes).toContain('TEXT_VS_IMAGE_CONFLICT');
    expect(wafir[0].decomposition.parent_offer_retention_mode).toBe('quarantined_do_not_publish');
    expect(wafir[0].adapter.parentPublicationAssessment.outcome).toBe('quarantined');
    expect(wafir[0].adapter.parentPublicationAssessment.isEligibleForNonCatalogPublication).toBe(false);
    expect(wafir[0].adapter.parentPublicationAssessment.quarantineReasons).toContain('TEXT_VS_IMAGE_CONFLICT');

    // B2-REQ-04 Noori Fakieh: independent Carton (10x1000g @ 141) & Single (1000g @ 15.5) cards, non-expired & clean
    const fakieh = replayed[3];
    expect(fakieh).toHaveLength(2);
    expect(fakieh[0].card.pricing.promo_price).toBe(141);
    expect(fakieh[0].card.pricing.original_price).toBe(202);
    expect(fakieh[0].card.pricing.price_basis).toBe('per_pack');
    expect(fakieh[0].card.quantity_and_promo.sale_basis).toBe('sealed_multipack');
    expect(fakieh[0].card.quantity_and_promo.manufacturer_pack_count).toBe(10);
    expect(fakieh[0].card.quantity_and_promo.each_size_value).toBe(1000);
    expect(fakieh[0].card.quantity_and_promo.each_size_unit).toBe('g');
    expect(fakieh[1].card.pricing.promo_price).toBe(15.5);
    expect(fakieh[1].card.pricing.original_price).toBeNull();
    expect(fakieh[1].card.pricing.price_basis).toBe('each');
    expect(fakieh[1].card.quantity_and_promo.sale_basis).toBe('single_unit');
    expect(fakieh[1].card.quantity_and_promo.manufacturer_pack_count).toBe(1);
    expect(fakieh[1].card.quantity_and_promo.each_size_value).toBe(1000);
    expect(fakieh[1].card.quantity_and_promo.each_size_unit).toBe('g');
    for (const tier of fakieh) {
      expect(tier.card.quantity_and_promo.retailer_checkout_multibuy_qty).toBeNull();
      expect(tier.decomposition.conflict_codes).toHaveLength(0);
      expect(tier.adapter.parentPublicationAssessment.isEligibleForNonCatalogPublication).toBe(true);
      expect(tier.adapter.parentPublicationAssessment.quarantineReasons).toHaveLength(0);
    }
  });
});
