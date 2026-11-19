import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BatchOrchestrationService } from '../batchOrchestrationService'
import { CatalogMatchingOrchestrator } from '../catalogMatchingOrchestrator'
import { CatalogPublicationService } from '../../db/catalogPublicationService'
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService'
import { createIsolatedWifranPostgres } from '../../db/__tests__/isolatedPostgresHarness008'
import { listPublicationHistory, undoLastPublish } from '../../db/publicationJournalAndUndoService'
import { createInMemoryStorageAdapter } from '../../storage/stagedStorageLifecycleService'
import { stripUnexpectedCurrencyFromModelResponse } from '../../../shared/utils/geminiResponseSanitizer'
import {
  assessOfferQuantitySemanticsConflict
} from '../../../shared/utils/nonCatalogPublicationPolicy'
import { revalidateOfferItem } from '../../../shared/utils/offerRevalidation'
import {
  classifyOfferReviewTriage,
  summarizeBatchReviewTriage
} from '../../../shared/utils/reviewTriageClassifier'
import { createHybridGeminiLiveProvider } from '../../ocr/hybrid/hybridGeminiLiveProvider'
import { GeminiExtractionService } from '../../ocr/geminiExtractionService'
import { GeminiMatchingService } from '../../ocr/geminiMatchingService'
import * as geminiClientModule from '../../ocr/geminiClient'
import { runHybridPageWorkflow } from '../../ocr/hybrid/hybridWorkflowOrchestrator'
import { TargetedMetadataVisionService } from '../../metadata/targetedMetadataVisionService'
import {
  buildV3PageExtractionSystemPrompt,
  buildV3CardCropSystemPrompt
} from '../../ocr/geminiV3PromptBuilder'
import {
  getV3LeafletPageGenAiSchema,
  getV3CardCropGenAiSchema
} from '../../../shared/schemas/leafletPageExtractionV3Schema'
import {
  buildLegacyPageExtractionSystemPrompt,
  buildOptimizedPageExtractionSystemPrompt,
  buildMasterQualityPageExtractionSystemPrompt,
  buildCompactSingleLetterPageExtractionSystemPrompt
} from '../../ocr/geminiPromptBuilder'
import {
  getLeafletPageGenAiSchema,
  getCompactSingleLetterLeafletPageGenAiSchema
} from '../../../shared/schemas/leafletPageExtractionSchema'
import {
  buildItemImageOcrPrompt,
  buildItemImageOcrSchema
} from '../../ocr/itemImageOcrPromptBuilder'
import {
  buildMinimalOcrPrompt,
  buildMinimalOcrSchema
} from '../../ocr/minimalOcrPromptBuilder'
import { buildFlexibleItemOcrPrompt } from '../../ocr/flexibleItemOcrPromptBuilder'
import {
  buildPageFirstOfferPrompt,
  buildPageFirstAnnotationFormat
} from '../../ocr/pageFirstOfferPromptBuilder'
import { buildStyleAwareValidationPrompt } from '../../ocr/styleAwareValidationPromptBuilder'
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
      // ignore Windows cleanup handle timing
    }
  }
})

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function collectObjectKeys(obj: unknown, out: Set<string> = new Set()): Set<string> {
  if (!obj || typeof obj !== 'object') return out
  if (Array.isArray(obj)) {
    for (const item of obj) collectObjectKeys(item, out)
    return out
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out.add(k)
    collectObjectKeys(v, out)
  }
  return out
}

const UUID_CARREFOUR = 'c2cc16c2-0006-4444-b000-c00000000006'
const CACHED_BATCH_ID = 'batch-2026-11-15T14-18-37-692853'

describe('WIFRAN MVP Workflow Simplification & Gemini Token Optimization', () => {
  describe('1. Zero Currency & Promotional Conditions Sent to Gemini + Sanitizer', () => {
    it('captures live-shaped HybridGeminiLiveProvider & TargetedMetadataVisionService requests with zero currency/condition fields', async () => {
      const tmp = makeTempDir('wifran-mvp-sdk-')
      const imgPath = path.join(tmp, 'page1.webp')
      const buf = await sharp({
        create: { width: 64, height: 64, channels: 3, background: { r: 240, g: 240, b: 240 } }
      })
        .webp()
        .toBuffer()
      fs.writeFileSync(imgPath, buf)

      const capturedRequests: any[] = []
      const capturingClient = {
        vertexai: true,
        models: {
          generateContent: async (req: Record<string, any>) => {
            capturedRequests.push(req)
            // Adversarial response with unexpected currency keys to test post-response sanitizer
            return {
              candidates: [
                {
                  finishReason: 'STOP',
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          validity_start_date: '2026-11-11',
                          validity_end_date: '2026-11-17',
                          page_currency: 'USD',
                          ignored_banners: [],
                          offers: [],
                          verified: true,
                          retailer_name: 'Carrefour',
                          start_date: '2026-11-11',
                          end_date: '2026-11-17',
                          currency: 'AED'
                        })
                      }
                    ]
                  }
                }
              ],
              usageMetadata: {
                promptTokenCount: 100,
                candidatesTokenCount: 20,
                totalTokenCount: 120,
                trafficType: 'ON_DEMAND_FLEX'
              }
            }
          }
        }
      }

      const provider = createHybridGeminiLiveProvider({
        executionContext: 'isolated_hybrid_workflow',
        featureEnabled: true,
        explicitLiveAuthorization: true,
        archiveDir: path.join(tmp, 'archive'),
        client: capturingClient
      })

      const pageRes = await provider.extractPage({
        requestKind: 'full_page',
        cacheKey: 'cf-test-p001',
        leafletId: 'cf-test',
        pageNumber: 1,
        retailer: 'Carrefour',
        imagePath: imgPath,
        promptText: buildV3PageExtractionSystemPrompt()
      })
      expect(pageRes.ok).toBe(true)
      expect((pageRes.parsedJson as any)?.page_currency).toBeUndefined()

      await provider.extractCardCrop({
        requestKind: 'card_crop',
        cacheKey: 'cf-test-p001-001',
        leafletId: 'cf-test',
        pageNumber: 1,
        sourceOfferId: 'cf-test_p001_001',
        retailer: 'Carrefour',
        imagePath: imgPath,
        promptText: buildV3CardCropSystemPrompt()
      })

      await provider.verifyPageContext!({
        requestKind: 'page_context',
        cacheKey: 'cf-test-p001-ctx',
        leafletId: 'cf-test',
        pageNumber: 1,
        retailer: 'Carrefour',
        imagePath: imgPath,
        promptText: 'Verify leaflet page validity header.'
      })

      const visionSvc = new TargetedMetadataVisionService()
      const visionRes = await visionSvc.executeTargetedVision({
        request: {
          leafletFingerprint: 'fp-mvp-test',
          unresolvedFields: ['retailer', 'validity'],
          candidatePages: [1]
        },
        operatorAuthorized: true,
        imagePathsByPage: { 1: imgPath },
        genAiClient: capturingClient
      })
      expect(visionRes.currency).toBe('SAR')

      expect(capturedRequests.length).toBeGreaterThanOrEqual(4)
      for (const req of capturedRequests) {
        const schema = req.config?.responseJsonSchema || req.config?.responseSchema || {}
        const schemaKeys = collectObjectKeys(schema)
        expect(schemaKeys.has('currency')).toBe(false)
        expect(schemaKeys.has('page_currency')).toBe(false)
        expect(schemaKeys.has('currency_evidence')).toBe(false)
        expect(schemaKeys.has('promo_conditions')).toBe(false)
        expect(schemaKeys.has('promo_condition')).toBe(false)
        expect(schemaKeys.has('loyalty_required')).toBe(false)
        expect(schemaKeys.has('loyalty_program_name')).toBe(false)
        expect(schemaKeys.has('is_loyalty_page')).toBe(false)
        expect(schemaKeys.has('customer_limit_pcs')).toBe(false)

        const sysInst = String(req.config?.systemInstruction || '')
        const contentsText = JSON.stringify(req.contents || '')
        const combinedPromptText = `${sysInst}\n${contentsText}`
        expect(combinedPromptText).not.toMatch(/\b(?:SAR|AED|USD|Riyal)\b/i)
        expect(combinedPromptText).not.toMatch(/\bcurrency\b/i)
        expect(combinedPromptText).not.toMatch(/\bcustomer[_\s]limit/i)
        expect(combinedPromptText).not.toMatch(/\bloyalty[_\s]program/i)
      }
    })

    it('captures GeminiExtractionService, GeminiMatchingService, and HybridWorkflowOrchestrator outbound SDK calls with zero currency/promo-condition requests', async () => {
      const tmp = makeTempDir('wifran-mvp-sdk-all-')
      const imgPath = path.join(tmp, 'page1.webp')
      const buf = await sharp({
        create: { width: 120, height: 120, channels: 3, background: { r: 245, g: 245, b: 245 } }
      })
        .webp()
        .toBuffer()
      fs.writeFileSync(imgPath, buf)

      const capturedSdkRequests: Array<{ caller: string; req: any }> = []
      const makeCapturingClient = (caller: string, jsonPayload: Record<string, any>) => ({
        vertexai: true,
        models: {
          generateContent: async (req: Record<string, any>) => {
            capturedSdkRequests.push({ caller, req })
            return {
              text: JSON.stringify(jsonPayload),
              candidates: [
                {
                  finishReason: 'STOP',
                  content: { parts: [{ text: JSON.stringify(jsonPayload) }] }
                }
              ],
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 30,
                thoughtsTokenCount: 10,
                totalTokenCount: 160,
                trafficType: 'ON_DEMAND_FLEX'
              }
            }
          }
        }
      })

      // 1. GeminiExtractionService (compact_v1)
      const extClient = makeCapturingClient('GeminiExtractionService', {
        s: '2026-11-11',
        e: '2026-11-17',
        b: [],
        o: []
      })
      const extSvc = new GeminiExtractionService(undefined, extClient as any)
      await extSvc.extractLeafletPage({
        imagePath: imgPath,
        pageNumber: 1,
        promptProfile: 'compact_v1',
        schemaProfile: 'compact_v1',
        executionMode: 'flex',
        forceReextract: true
      })

      // 2. GeminiMatchingService.evaluateBatch
      const prevOffline = process.env.WIFRAN_OFFLINE_UAT
      const prevLoc = process.env.GCP_LOCATION
      delete process.env.WIFRAN_OFFLINE_UAT
      process.env.GCP_LOCATION = 'global'
      const matchClient = makeCapturingClient('GeminiMatchingService', {
        matches: [{ source_id: '1', product_id: 't1' }]
      })
      const spy = vi.spyOn(geminiClientModule, 'getGeminiClient').mockReturnValue(matchClient as any)
      try {
        const matchSvc = new GeminiMatchingService()
        await matchSvc.evaluateBatch({
          brandKey: 'almarai',
          brandName: 'Almarai',
          candidates: [
            {
              id: '42',
              brand: 'Almarai',
              nameEn: 'Almarai Fresh Milk 1L',
              nameAr: 'المراعي حليب طازج ١ لتر',
              variant: null,
              sizeValue: 1,
              sizeUnit: 'l',
              packCount: 1
            }
          ],
          items: [
            {
              identityKey: 'almarai|milk|1|l|1',
              normalizedAttrs: {
                brandKey: 'almarai',
                brandNameEn: 'Almarai',
                brandNameAr: 'المراعي',
                brandStatus: 'known',
                productNameEn: 'Almarai Fresh Milk 1L',
                productNameAr: 'المراعي حليب طازج ١ لتر',
                eachSizeValue: 1,
                eachSizeUnit: 'l',
                innerPackCount: 1,
                manufacturerPackCount: 1,
                saleUnitType: 'piece',
                fatContent: null,
                variantOrFlavor: null,
                productForm: null,
                isAssortment: false
              },
              memberOffers: []
            }
          ]
        })
      } finally {
        spy.mockRestore()
        if (prevOffline !== undefined) process.env.WIFRAN_OFFLINE_UAT = prevOffline
        if (prevLoc !== undefined) process.env.GCP_LOCATION = prevLoc
        else delete process.env.GCP_LOCATION
      }

      // 3. HybridWorkflowOrchestrator -> verifyPageContext (checking promptText at line 562)
      const hybridClient = makeCapturingClient('HybridWorkflowOrchestrator', {
        offers: []
      })
      const hybridProvider = createHybridGeminiLiveProvider({
        executionContext: 'isolated_hybrid_workflow',
        featureEnabled: true,
        explicitLiveAuthorization: true,
        archiveDir: path.join(tmp, 'hybrid-archive'),
        client: hybridClient
      })
      await runHybridPageWorkflow({
        runId: 'sdk-audit-run',
        executionContext: 'isolated_hybrid_workflow',
        featureEnabled: true,
        explicitAuthorization: true,
        leafletId: 'sdk-audit-leaflet',
        pageNumber: 1,
        retailer: 'Carrefour',
        retailerId: 'c2cc16c2-0006-4444-b000-c00000000006',
        locationScope: 'national',
        offerStartDate: '2026-11-11',
        offerEndDate: '2026-11-17',
        pageAssetPath: imgPath,
        pageImagePath: imgPath,
        cropOutputDir: path.join(tmp, 'crops'),
        provider: hybridProvider,
        forceAllowlistedPageContext: true
      })

      expect(capturedSdkRequests.map((x) => x.caller)).toEqual(
        expect.arrayContaining([
          'GeminiExtractionService',
          'GeminiMatchingService',
          'HybridWorkflowOrchestrator'
        ])
      )
      expect(capturedSdkRequests.length).toBeGreaterThanOrEqual(3)

      for (const { caller, req } of capturedSdkRequests) {
        const schema = req.config?.responseJsonSchema || req.config?.responseSchema || {}
        const schemaKeys = collectObjectKeys(schema)
        for (const forbidden of [
          'currency',
          'page_currency',
          'currency_evidence',
          'promo_conditions',
          'promo_condition',
          'loyalty_required',
          'loyalty_program_name',
          'is_loyalty_page',
          'customer_limit_pcs',
          'quantity_limit'
        ]) {
          expect(schemaKeys.has(forbidden), `${caller} schema exposed ${forbidden}`).toBe(false)
        }

        const sysInst = String(req.config?.systemInstruction || '')
        const contentsText = JSON.stringify(req.contents || '')
        const combinedPromptText = `${sysInst}\n${contentsText}`
        expect(combinedPromptText, `${caller} mentioned currency code`).not.toMatch(/\b(?:SAR|AED|USD|Riyal)\b/i)
        expect(combinedPromptText, `${caller} mentioned currency`).not.toMatch(/\bcurrency\b/i)
        expect(combinedPromptText, `${caller} mentioned customer limit`).not.toMatch(/\bcustomer[_\s]limit/i)
        expect(combinedPromptText, `${caller} mentioned loyalty program`).not.toMatch(/\bloyalty[_\s]program/i)
        expect(combinedPromptText, `${caller} mentioned promo_conditions`).not.toMatch(/\bpromo_conditions?\b/i)
      }
    })

    it('verifies all prompt & schema builders exclude currency/condition properties and measure reduced payload sizes', () => {
      const forbiddenSchemaKeys = [
        'currency',
        'page_currency',
        'currency_evidence',
        'promo_conditions',
        'promo_condition',
        'loyalty_required',
        'loyalty_program_name',
        'is_loyalty_page',
        'customer_limit_pcs',
        'quantity_limit'
      ]

      const schemasToInspect = [
        getV3LeafletPageGenAiSchema(),
        getV3CardCropGenAiSchema(),
        getLeafletPageGenAiSchema('legacy'),
        getLeafletPageGenAiSchema('optimized'),
        getCompactSingleLetterLeafletPageGenAiSchema(),
        buildItemImageOcrSchema(),
        buildMinimalOcrSchema(),
        buildPageFirstAnnotationFormat()
      ]

      for (const schema of schemasToInspect) {
        const keys = collectObjectKeys(schema)
        for (const forbidden of forbiddenSchemaKeys) {
          expect(keys.has(forbidden), `Found forbidden schema key: ${forbidden}`).toBe(false)
        }
      }

      const activePrompts = [
        buildV3PageExtractionSystemPrompt(),
        buildV3CardCropSystemPrompt(),
        buildLegacyPageExtractionSystemPrompt(),
        buildOptimizedPageExtractionSystemPrompt(),
        buildMasterQualityPageExtractionSystemPrompt(),
        buildCompactSingleLetterPageExtractionSystemPrompt(),
        buildItemImageOcrPrompt('1'),
        buildMinimalOcrPrompt(),
        buildFlexibleItemOcrPrompt('1'),
        buildPageFirstOfferPrompt(),
        buildStyleAwareValidationPrompt({
          sourceItemNumber: '1',
          rawExtractionJson: { title_en: 'Test', title_ar: 'تجربة' },
          canonicalDraft: { title_en: 'Test', title_ar: 'تجربة' }
        })
      ]
      for (const p of activePrompts) {
        expect(p).not.toMatch(/\b(?:SAR|AED|USD|Riyal)\b/i)
        expect(p).not.toMatch(/\bcurrency\b/i)
        expect(p).not.toMatch(/\bpromo_condition\b/i)
        expect(p).not.toMatch(/special offer conditions?/i)
        expect(p).not.toMatch(/\bcustomer[_\s]limit/i)
        expect(p).not.toMatch(/\bloyalty[_\s](?:program|card|points|page)/i)
      }

      // Deterministic compression improvements verified
      const masterPromptLen = buildMasterQualityPageExtractionSystemPrompt().length
      expect(masterPromptLen).toBe(11845)
      expect(masterPromptLen).toBeLessThan(12201)
      const compactSchemaBytes = Buffer.byteLength(
        JSON.stringify(getCompactSingleLetterLeafletPageGenAiSchema()),
        'utf8'
      )
      expect(compactSchemaBytes).toBe(2902)
      expect(compactSchemaBytes).toBeLessThan(3276)
    })

    it('strips nested unexpected currency fields cleanly post-response via stripUnexpectedCurrencyFromModelResponse', () => {
      const raw = {
        page_currency: 'AED',
        offers: [
          { offer_number: 1, promo_price: 9.95, currency: 'USD', currency_evidence: 'USD 9.95' }
        ]
      }
      const res = stripUnexpectedCurrencyFromModelResponse(raw)
      expect(res.strippedKeys).toEqual([
        'page_currency',
        'offers[0].currency',
        'offers[0].currency_evidence'
      ])
      expect((res.sanitized as any).page_currency).toBeUndefined()
      expect((res.sanitized as any).offers[0].currency).toBeUndefined()
      expect((res.sanitized as any).offers[0].currency_evidence).toBeUndefined()
    })
  })

  describe('2. O-Lite (006), Barilla (011), PEEP (003) & Cross-Dimension Bleed Rules', () => {
    function makeBaseOffer(overrides: Partial<UnifiedBatchOffer>): UnifiedBatchOffer {
      return {
        batchOfferKey: 'b:l1:23:o1',
        batchId: 'b',
        leafletId: 'l1',
        sourceFileName: 'carrefour.pdf',
        sourcePdfPath: '/tmp/carrefour.pdf',
        sourcePage: 23,
        sourceOfferId: 'leaflet-001_p023_006',
        supermarketId: UUID_CARREFOUR,
        supermarketName: 'Carrefour',
        locationScope: 'national',
        locationLabel: 'National',
        cityId: null,
        regionId: null,
        offerStartDate: '2026-11-11',
        offerEndDate: '2026-11-17',
        currency: 'SAR',
        metadataVerified: false,
        metadataStatus: 'auto_accepted',
        titleEn: 'O-LITE CANOLA OIL 1.5L X2',
        titleAr: 'أولايت زيت كانولا ١،٥ مل × ٢',
        brand: 'O-Lite',
        brandAr: 'أولايت',
        brandEn: 'O-Lite',
        promoPrice: 24.95,
        originalPrice: 44.5,
        discountPercent: 44,
        promoNotes: null,
        sizeOrWeight: '2x1.5l',
        each_size_value: 1.5,
        each_size_unit: 'l',
        inner_pack_count: 2,
        sale_unit_type: 'pack',
        total_content_value: 3,
        total_content_unit: 'l',
        free_units_text: null,
        customer_limit: null,
        assortment_status: 'confirmed_single_sku',
        productThumbCropPath: null,
        offerCardCropPath: null,
        status: 'extracted',
        confidence: 'high',
        warnings: [],
        blockingErrors: [],
        ...overrides
      }
    }

    it('preserves ×2, normalizes Arabic comma ١،٥, clears false PROMO_QTY_VS_MFG_PACK_CONFLICT, catches 1.5ml vs 1.5L cleanly, and clears to Ready once fixed', () => {
      const oLiteWrong = makeBaseOffer({
        conflictCodes: ['EN_AR_WEIGHT_VOLUME_CONFLICT', 'PROMO_QTY_VS_MFG_PACK_CONFLICT']
      })

      const semErr = assessOfferQuantitySemanticsConflict(oLiteWrong)
      expect(semErr.hasConflict).toBe(true)
      expect(semErr.conflictKind).toBe('unit_or_measure_conflict')
      expect(semErr.reason).toContain('1500ml')
      expect(semErr.reason).toContain('1.5ml')

      const revalWrong = revalidateOfferItem({ item: oLiteWrong })
      expect(revalWrong.isValid).toBe(false)
      expect(revalWrong.conflictCodes).toContain('EN_AR_WEIGHT_VOLUME_CONFLICT')
      expect(revalWrong.conflictCodes).not.toContain('PROMO_QTY_VS_MFG_PACK_CONFLICT')

      const proposal = {
        batchOfferKey: oLiteWrong.batchOfferKey,
        sourceOfferId: oLiteWrong.sourceOfferId,
        sourcePage: 23,
        leafletId: 'l1',
        supermarketName: 'Carrefour',
        decision: 'temporary' as const,
        matchedProductId: null,
        temporaryId: 't_olite',
        confidence: 'medium' as const,
        matchMethod: 'deterministic' as const,
        validationIssues: [],
        operatorDecision: 'proposed' as const,
        updatedAt: '2026-11-15T14:00:00Z'
      }
      const tempGroup = {
        temporaryId: 't_olite',
        brandKey: 'olite',
        brandNameAr: 'أولايت',
        brandNameEn: 'O-Lite',
        productNameAr: 'أولايت زيت كانولا ١،٥ لتر × ٢',
        productNameEn: 'O-LITE CANOLA OIL 1.5L X2',
        variantOrFlavor: null,
        fatContent: null,
        eachSizeValue: 1.5,
        eachSizeUnit: 'l',
        innerPackCount: 2,
        saleUnitType: 'pack' as const,
        productForm: null,
        sampleThumbCropPath: null,
        sourceOfferKeys: [oLiteWrong.batchOfferKey],
        retailers: ['Carrefour'],
        validationWarnings: [],
        operatorDecision: 'proposed' as const,
        createdAt: '2026-11-15T14:00:00Z',
        updatedAt: '2026-11-15T14:00:00Z'
      }

      const triageBlocked = classifyOfferReviewTriage({
        offer: { ...oLiteWrong, conflictCodes: revalWrong.conflictCodes, quarantineReasons: revalWrong.quarantineReasons },
        proposal,
        temporaryProducts: { t_olite: tempGroup }
      })
      expect(triageBlocked.category).toBe('blocked')
      expect(triageBlocked.reasons[0]).toBe('Quantity conflict detected. Verify the bottle size and number of bottles.')

      // Fixing Arabic ml -> لتر clears conflict completely and promotes to Ready without manual product approval
      const oLiteFixed = makeBaseOffer({
        titleAr: 'أولايت زيت كانولا ١،٥ لتر × ٢',
        conflictCodes: oLiteWrong.conflictCodes
      })
      const revalFixed = revalidateOfferItem({ item: oLiteFixed })
      expect(revalFixed.isValid).toBe(true)
      expect(revalFixed.conflictCodes).toEqual([])

      const triageReady = classifyOfferReviewTriage({
        offer: { ...oLiteFixed, conflictCodes: revalFixed.conflictCodes, quarantineReasons: revalFixed.quarantineReasons },
        proposal,
        temporaryProducts: { t_olite: tempGroup }
      })
      expect(triageReady.category).toBe('ready')
      expect(triageReady.assessment.catalogMatchStatus).toBe('candidate_pending_review')
    })

    it('ignores stray cross-dimension text bleed (LARGE 400G) when primary EN+AR volume matches structured spec', () => {
      const strayBleed = makeBaseOffer({
        titleEn: 'O-LITE CANOLA OIL 1.5L X2 LARGE 400G',
        titleAr: 'أولايت زيت كانولا ١،٥ لتر × ٢'
      })
      const sem = assessOfferQuantitySemanticsConflict(strayBleed)
      expect(sem.hasConflict).toBe(false)
      const reval = revalidateOfferItem({ item: strayBleed })
      expect(reval.isValid).toBe(true)
    })

    it('keeps Barilla (011) and PEEP Ditalini (003) Blocked/Deferred with clean operator messages and no currency conflict', () => {
      const peep003 = makeBaseOffer({
        batchOfferKey: 'b:l1:23:leaflet-001_p023_003',
        sourceOfferId: 'leaflet-001_p023_003',
        titleEn: 'Ditalini Rigati Large',
        titleAr: 'مكرونة ديتاليني ريجاتي لارج 400 جم',
        each_size_value: 400,
        each_size_unit: 'g',
        inner_pack_count: 1,
        assortment_status: 'visual_multiple_variants',
        conflictCodes: ['INCOMPLETE_VISIBLE_ASSORTMENT', 'CURRENCY_UNVERIFIED_OR_CONFLICT']
      })
      const reval003 = revalidateOfferItem({ item: peep003 })
      expect(reval003.conflictCodes).not.toContain('CURRENCY_UNVERIFIED_OR_CONFLICT')
      expect(reval003.conflictCodes).toContain('INCOMPLETE_VISIBLE_ASSORTMENT')
      const triage003 = classifyOfferReviewTriage({
        offer: { ...peep003, conflictCodes: reval003.conflictCodes, quarantineReasons: reval003.quarantineReasons }
      })
      expect(triage003.category).toBe('needs_review')
      expect(triage003.reasons.length).toBeGreaterThan(0)

      const barilla011 = makeBaseOffer({
        batchOfferKey: 'b:l1:23:leaflet-001_p023_011',
        sourceOfferId: 'leaflet-001_p023_011',
        titleEn: 'Barilla Sauce Bolognese',
        titleAr: 'صلصة بولونيز باريلا',
        each_size_value: 400,
        each_size_unit: 'g',
        inner_pack_count: 1,
        assortment_status: 'visual_multiple_variants',
        conflictCodes: ['TEXT_VS_IMAGE_CONFLICT', 'CURRENCY_UNVERIFIED_OR_CONFLICT']
      })
      const reval011 = revalidateOfferItem({ item: barilla011 })
      expect(reval011.conflictCodes).not.toContain('CURRENCY_UNVERIFIED_OR_CONFLICT')
      expect(reval011.conflictCodes).toContain('TEXT_VS_IMAGE_CONFLICT')
      const triage011 = classifyOfferReviewTriage({
        offer: { ...barilla011, conflictCodes: reval011.conflictCodes, quarantineReasons: reval011.quarantineReasons }
      })
      expect(triage011.category).toBe('blocked')
      expect(triage011.reasons).toContain('Multiple product varieties detected. Verify the varieties before publishing.')
    })
  })

  describe('3. Cached Carrefour Page 23 Non-Destructive Replay, Auto-Crop, Auto-Ready Publish & Undo', { timeout: 30000 }, () => {
    it('replays cached Carrefour Page 23 at $0.00 -> 9 Ready / 3 Deferred -> fixes O-Lite to 10 Ready / 2 Deferred -> publishes candidate provenance, prevents duplicates, and supports Undo', async () => {
      const repoBatchDir = path.join(process.cwd(), 'Extracts', 'batches', CACHED_BATCH_ID)
      const repoWorkspaceDir = path.join(process.cwd(), 'Extracts', 'carrefour-62800235-jeddah')
      const repoManifestFile = path.join(repoBatchDir, 'batch-manifest.json')
      const repoDraftFile = path.join(repoWorkspaceDir, 'staged-draft.json')

      const origManifestSha = sha256File(repoManifestFile)
      const origDraftSha = sha256File(repoDraftFile)

      const tmp = makeTempDir('wifran-mvp-carrefour-')
      const tmpBatchesDir = path.join(tmp, 'batches')
      const tmpBatchDir = path.join(tmpBatchesDir, CACHED_BATCH_ID)
      const tmpWorkspaceDir = path.join(tmp, 'carrefour-62800235-jeddah')
      const tmpCacheDir = path.join(tmp, 'cache')

      fs.cpSync(repoBatchDir, tmpBatchDir, { recursive: true })
      fs.cpSync(repoWorkspaceDir, tmpWorkspaceDir, { recursive: true })

      // Repoint copied batch files strictly to temp workspace so real repo files remain completely untouched
      const repointPaths = (filePath: string) => {
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
      repointPaths(path.join(tmpBatchDir, 'batch-manifest.json'))
      repointPaths(path.join(tmpBatchDir, 'catalog-matching', 'matching-proposals.json'))
      repointPaths(path.join(tmpWorkspaceDir, 'staged-draft.json'))

      // Deterministically reset temp copy of O-Lite (_006) to pre-fix OCR baseline (مل)
      // so this test passes regardless of whether Extracts/.../staged-draft.json already holds operator edits.
      const tmpDraftPath = path.join(tmpWorkspaceDir, 'staged-draft.json')
      const tmpDraft = JSON.parse(fs.readFileSync(tmpDraftPath, 'utf8'))
      const tmpItem006 = (tmpDraft.items || []).find((it: any) =>
        String(it?.sourceOfferId || it?.id || '').endsWith('_006')
      )
      if (tmpItem006) {
        tmpItem006.titleAr = tmpItem006.originalOcr?.titleAr || 'أولايت زيت كانولا ١،٥ مل × ٢'
        tmpItem006.operatorEditedFields = []
        tmpItem006.isOperatorModified = false
        tmpItem006.operatorEdited = false
        delete tmpItem006.operatorEditedAt
        delete tmpItem006.operatorEditedBy
        tmpItem006.conflictCodes = ['EN_AR_WEIGHT_VOLUME_CONFLICT']
        tmpItem006.quarantineReasons = ['EN_AR_WEIGHT_VOLUME_CONFLICT']
        fs.writeFileSync(tmpDraftPath, JSON.stringify(tmpDraft, null, 2), 'utf8')
      }

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
      const initialMatching = matchingOrchestrator.loadManifest(CACHED_BATCH_ID)!
      expect(initialOffers).toHaveLength(12)
      expect(initialOffers.every((o) => o.currency === 'SAR')).toBe(true)

      const initialSummary = summarizeBatchReviewTriage({
        offers: initialOffers,
        manifest: initialMatching,
        targetDatabaseContext: 'DEVELOPMENT_TEST'
      })
      expect(initialSummary.readyCount).toBe(9)
      expect(initialSummary.blockedCount).toBe(3)
      expect(initialSummary.needsReviewCount).toBe(0)

      // Check 003, 006, 011 are the exact 3 Deferred items & 006 lost false PROMO_QTY_VS_MFG_PACK_CONFLICT
      const offer003 = initialOffers.find((o) => o.sourceOfferId.endsWith('_003'))!
      const offer006 = initialOffers.find((o) => o.sourceOfferId.endsWith('_006'))!
      const offer011 = initialOffers.find((o) => o.sourceOfferId.endsWith('_011'))!
      const offer001 = initialOffers.find((o) => o.sourceOfferId.endsWith('_001'))!
      expect(offer006.conflictCodes).not.toContain('PROMO_QTY_VS_MFG_PACK_CONFLICT')
      expect(offer006.conflictCodes).toContain('EN_AR_WEIGHT_VOLUME_CONFLICT')

      // Auto-crop: all extracted offers auto-select local product_thumb_crop.webp as consumer-facing image
      expect(offer001.consumerImageApprovalStatus).toBe('approved_generated_crop')
      expect(offer001.approvedConsumerImageRightsBasis).toBe('generated_product_crop')
      expect(offer001.consumerProductImagePath).toContain('product_thumb_crop.webp')
      expect(offer003.consumerProductImagePath).toContain('product_thumb_crop.webp')

      // Fix O-Lite Arabic unit ml -> لتر -> 10 Ready / 2 Deferred
      await batchService.updateBatchOfferFields({
        batchId: CACHED_BATCH_ID,
        batchOfferKey: offer006.batchOfferKey,
        orchestrator: matchingOrchestrator,
        patch: {
          titleAr: 'أولايت زيت كانولا ١،٥ لتر × ٢',
          revalidate: true
        }
      })

      const afterFixOffers = await batchService.getUnifiedBatchOffers(CACHED_BATCH_ID)
      const afterFixMatching = matchingOrchestrator.loadManifest(CACHED_BATCH_ID)!
      const afterFixSummary = summarizeBatchReviewTriage({
        offers: afterFixOffers,
        manifest: afterFixMatching,
        targetDatabaseContext: 'DEVELOPMENT_TEST'
      })
      expect(afterFixSummary.readyCount).toBe(10)
      expect(afterFixSummary.blockedCount).toBe(2)

      // Reloading the corrected temp batch from disk must deterministically retain 10 Ready / 2 Deferred
      const reloadedBatchService = new BatchOrchestrationService(tmpBatchesDir)
      const reloadedOffers = await reloadedBatchService.getUnifiedBatchOffers(CACHED_BATCH_ID)
      const reloadedSummary = summarizeBatchReviewTriage({
        offers: reloadedOffers,
        manifest: afterFixMatching,
        targetDatabaseContext: 'DEVELOPMENT_TEST'
      })
      expect(reloadedSummary.readyCount).toBe(10)
      expect(reloadedSummary.blockedCount).toBe(2)

      // Mark 001 explicitly operator-verified to contrast DB provenance against auto-Ready provisional (002..012)
      const prop001 = afterFixMatching.proposals[offer001.batchOfferKey]
      const temp001Id = prop001.temporaryId!
      afterFixMatching.temporaryProducts[temp001Id].operatorDecision = 'approved'
      prop001.operatorDecision = 'approved'

      const { client: pgClient } = await createIsolatedWifranPostgres()
      const storage = createInMemoryStorageAdapter()

      try {
        const pubRes = await pubService.publishApprovedCatalogBatch({
          manifest: afterFixMatching,
          offers: afterFixOffers,
          context: 'DEVELOPMENT_TEST',
          pgClient,
          allowIsolatedTestDb: true,
          enableImageUpload: true,
          storageAdapter: storage,
          operatorId: 'mvp_uat_op'
        })

        expect(pubRes.success).toBe(true)
        expect(pubRes.publishedOffersCount).toBe(10)
        expect(pubRes.deferredBatchOfferKeys).toHaveLength(2)
        expect(pubRes.deferredBatchOfferKeys).toContain(offer003.batchOfferKey)
        expect(pubRes.deferredBatchOfferKeys).toContain(offer011.batchOfferKey)

        await batchService.recordSelectivePublicationOutcome({
          batchId: CACHED_BATCH_ID,
          databaseContext: 'DEVELOPMENT_TEST',
          publishOperationId: pubRes.publishOperationId!,
          publishedBatchOfferKeys: pubRes.publishedBatchOfferKeys ?? [],
          deferredBatchOfferKeys: pubRes.deferredBatchOfferKeys ?? [],
          insertedOffersCount: pubRes.insertedOffersCount ?? 0,
          updatedOffersCount: pubRes.updatedOffersCount ?? 0,
          sourceOfferIdByKey: pubRes.sourceOfferIdByKey,
          publishedOfferIdByKey: pubRes.publishedOfferIdByKey,
          productIdByKey: pubRes.productIdByKey
        })

        // Contrast DB provenance: offer001 operator-verified vs auto-Ready provisional (e.g. offer006)
        const prodRows = await pgClient.query(
          `SELECT id, name_en, verification_status, verification_basis, verified_by, verified_at, default_image_url
           FROM public.products`
        )
        expect(prodRows.rows).toHaveLength(10)
        const opVerifiedProd = prodRows.rows.find(
          (r) => String(r.id) === pubRes.createdProductMap[temp001Id]
        )!
        expect(opVerifiedProd.verification_status).toBe('verified')
        expect(opVerifiedProd.verification_basis).toBe('operator_matching_approval')
        expect(opVerifiedProd.verified_by).toBe('mvp_uat_op')
        expect(opVerifiedProd.verified_at).not.toBeNull()

        const provisionalProds = prodRows.rows.filter(
          (r) => String(r.id) !== pubRes.createdProductMap[temp001Id]
        )
        expect(provisionalProds).toHaveLength(9)
        for (const p of provisionalProds) {
          expect(p.verification_status).toBe('candidate')
          expect(p.verification_basis).toBe('auto_extraction_provisional')
          expect(p.verified_by).toBeNull()
          expect(p.verified_at).toBeNull()
          expect(String(p.default_image_url || '')).toContain('/product-images/products/sha256/')
        }

        const offerRows = await pgClient.query(
          `SELECT product_id, source_offer_id, currency, catalog_match_status, catalog_verification_basis,
                  catalog_verified_by, catalog_verified_at, exact_identity_status
           FROM public.offers`
        )
        expect(offerRows.rows).toHaveLength(10)
        const row001 = offerRows.rows.find(
          (r) => String(r.product_id) === pubRes.createdProductMap[temp001Id]
        )!
        expect(row001.catalog_match_status).toBe('verified_linked')
        expect(row001.exact_identity_status).toBe('verified_sku')

        const provisionalOffers = offerRows.rows.filter(
          (r) => String(r.product_id) !== pubRes.createdProductMap[temp001Id]
        )
        expect(provisionalOffers).toHaveLength(9)
        for (const r of provisionalOffers) {
          expect(r.currency).toBe('SAR')
          expect(r.catalog_match_status).toBe('candidate_pending_review')
          expect(r.catalog_verification_basis).toBe('auto_extraction_provisional')
          expect(r.catalog_verified_by).toBeNull()
          expect(r.catalog_verified_at).toBeNull()
          expect(r.exact_identity_status).toBe('unresolved')
        }

        // Storage routing: 20 private evidence crops (card + thumb per offer) in offer-images, 10 generated crops in product-images
        const countBucketObjects = (bucket: string) =>
          Array.from(storage.storedObjects.keys()).filter((k) => k.startsWith(`${bucket}/`)).length
        expect(countBucketObjects('offer-images')).toBe(20)
        expect(countBucketObjects('product-images')).toBe(10)

        // Duplicate prevention on repeat publish
        const retryOffers = await batchService.getUnifiedBatchOffers(CACHED_BATCH_ID)
        const retryRes = await pubService.publishApprovedCatalogBatch({
          manifest: afterFixMatching,
          offers: retryOffers,
          context: 'DEVELOPMENT_TEST',
          pgClient,
          allowIsolatedTestDb: true,
          enableImageUpload: true,
          storageAdapter: storage,
          operatorId: 'mvp_uat_op'
        })
        expect(retryRes.publishedOffersCount).toBe(0)
        expect(retryRes.skippedDuplicatesCount).toBe(10)

        // Undo Last Publish rolls back products, offers, and exclusively created storage images
        const hist = await listPublicationHistory({
          client: pgClient,
          batchIdFilter: CACHED_BATCH_ID
        })
        expect(hist.length).toBeGreaterThanOrEqual(1)
        const undoRes = await undoLastPublish({
          client: pgClient,
          publishOperationId: pubRes.publishOperationId,
          storageAdapter: storage,
          operatorId: 'mvp_uat_op',
          reason: 'MVP verification undo'
        })
        expect(undoRes.success).toBe(true)
        const postUndoOffers = await pgClient.query('SELECT count(*) FROM public.offers')
        const postUndoProds = await pgClient.query('SELECT count(*) FROM public.products')
        expect(Number(postUndoOffers.rows[0].count)).toBe(0)
        expect(Number(postUndoProds.rows[0].count)).toBe(0)
        expect(countBucketObjects('offer-images')).toBe(0)
        expect(countBucketObjects('product-images')).toBe(0)
      } finally {
        await pgClient.end?.()
      }

      // Real repo cached batch files untouched
      expect(sha256File(repoManifestFile)).toBe(origManifestSha)
      expect(sha256File(repoDraftFile)).toBe(origDraftSha)
    })
  })
})
