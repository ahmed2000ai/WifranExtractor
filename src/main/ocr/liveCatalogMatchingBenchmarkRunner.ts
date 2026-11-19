/**
 * Live Gemini Catalog Matching Benchmark Runner
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-002
 *
 * Dedicated, strictly guarded benchmark runner that:
 * - Executes exclusively against DEVELOPMENT (gykrbpykjhpyrdrinkuk)
 * - Blocks execution if environment isolation is not established
 * - Enforces gemini-3.8-flash, MEDIUM thinking, Vertex AI Flex PayGo (global)
 * - Bounded to max 2 paid requests and <= $0.05 budget
 * - Seeds controlled development catalog products with Postgres-generated IDs
 * - Validates candidate retrieval completeness and exact matching requests offline
 * - Preserves complete request/response provenance and token accounting
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createGuardedPgClient,
  getGuardedSupabaseClient,
  DEVELOPMENT_PROJECT_REF,
  PRODUCTION_PROJECT_REF
} from '../db/databaseEnvironmentResolver'
import { BrandGroupingService } from '../db/brandGroupingService'
import { GeminiMatchingService } from './geminiMatchingService'
import { VerifiedMatchCacheService } from '../db/verifiedMatchCacheService'
import { CatalogMatchingBenchmarkEvaluator } from './catalogMatchingBenchmarkEvaluator'
import { calculateGeminiCost, getModelPricing } from './geminiPricingTable'
import { MatchingEvidenceOverlayService } from '../db/matchingEvidenceOverlayService'
import { evaluateIdentitySufficiency } from '../db/productIdentityPolicy'
import { TemporaryProductRegistry } from '../db/temporaryProductRegistry'
import { MatchingRunManifest, CompactCatalogCandidate } from '../../shared/types/catalogMatching'
import { UnifiedBatchOffer } from '../../shared/types/batchExtraction'

export interface SeededCatalogProduct {
  name_en: string
  name_ar: string
  brand_name: string
  variant_or_flavor: string | null
  each_size_value: number | null
  each_size_unit: string | null
  inner_pack_count: number | null
  sale_unit_type: string | null
}

export interface LiveBenchmarkPreflightReport {
  timestamp: string
  environment: {
    targetProjectRef: string
    isDevelopment: boolean
    isProductionBlocked: boolean
    productionProjectRef: string
  }
  dataset: {
    totalRealSourceIdentities: number
    existingVerifiedProductCases: number
    proposedNewProductCases: number
    deliberatelyUnresolvedCases: number
    brandCount: number
    brands: string[]
  }
  coveragePartitioning: {
    geminiEvaluatedIdentitiesCount: number
    geminiEvaluatedBrands: string[]
    geminiEvaluatedBreakdown: {
      existing: number
      temporary: number
      unresolved: number
    }
    locallyHandledIdentitiesCount: number
    locallyHandledBreakdown: {
      absentInTestCatalogOnly: number
      policyFlaggedUnresolved: number
    }
    crossRequestTempReconciliationTested: boolean
    testCatalogAbsenceScopeNote: string
  }
  pricingDocumentation: {
    modelId: string
    tier: 'flex'
    effectiveDate: string
    validThrough: string
    inputPerMillionUsd: number
    outputIncludingThinkingPerMillionUsd: number
    cachedInputPerMillionUsd: number
    doubleCountingGuard: string
  }
  retrievalPreflight: {
    retrievalRecall: number // 1.0 = 100%
    expectedMatchesVerified: Array<{
      sourceOfferId: string
      brand: string
      titleEn: string
      targetCatalogId: string
      targetCatalogNameEn: string
      retrievedStatus: 'found_in_shortlist' | 'missing'
      shortlistRank: number
    }>
    absenceProofsVerified: Array<{
      brand: string
      offersCount: number
      catalogProductsCount: number
      absenceProven: boolean
    }>
    unresolvedPoliciesVerified: Array<{
      sourceOfferId: string
      reason: string
    }>
  }
  requestBudget: {
    matchingRequestsCount: number // Must be <= 2
    estimatedInputTokens: number
    estimatedOutputTokens: number
    estimatedThinkingTokens: number
    estimatedTotalTokens: number
    estimatedFlexCostUsd: number
    conservativeUpperBoundCostUsd: number
    approvedSpendCapUsd: number // 0.05
    isWithinBudget: boolean
  }
  modelConfig: {
    model: string // 'gemini-3.8-flash'
    thinkingLevel: string // 'MEDIUM'
    executionMode: string // 'flex'
    location: string // 'global'
    responseMimeType: string // 'application/json'
    structuredSchemaContract: string
  }
  provenance: {
    datasetFixturePath: string
    exactRequestDrafts: Array<{
      requestNumber: number
      brandKey: string
      candidateCount: number
      itemCount: number
      promptSample: string
    }>
  }
}

export interface LiveBenchmarkExecutionResult {
  preflight: LiveBenchmarkPreflightReport
  actualRequests: Array<{
    requestIndex: number
    brandKey: string
    inputTokens: number
    outputTokens: number
    thinkingTokens: number
    totalTokens: number
    actualCostUsd: number
    latencyMs: number
    rawModelResponse: any
    validatedMatches: any[]
  }>
  metrics: any
  manifest: MatchingRunManifest
  totalCostUsd: number
  totalTokens: number
  durationMs: number
  verdict: 'SUCCESS' | 'FAILURE'
}

export class LiveCatalogMatchingBenchmarkRunner {
  public readonly brandService: BrandGroupingService
  public readonly cacheService: VerifiedMatchCacheService
  public readonly geminiService: GeminiMatchingService
  public readonly evaluator: CatalogMatchingBenchmarkEvaluator
  public readonly evidenceOverlay: MatchingEvidenceOverlayService | null

  constructor(options?: { evidenceOverlayPath?: string; disableEvidenceOverlay?: boolean }) {
    const defaultOverlayPath = join(
      process.cwd(),
      'test-fixtures',
      'matching-benchmarks',
      'verified_evidence_annotations_v1.json'
    )
    this.evidenceOverlay = options?.disableEvidenceOverlay
      ? null
      : new MatchingEvidenceOverlayService(
          options?.evidenceOverlayPath || defaultOverlayPath,
          'benchmark:live_benchmark_dataset_v1'
        )
    this.brandService = new BrandGroupingService(this.evidenceOverlay || undefined)
    this.cacheService = new VerifiedMatchCacheService(join(process.cwd(), 'Extracts', 'test_cache'), 'development')
    this.geminiService = new GeminiMatchingService()
    this.evaluator = new CatalogMatchingBenchmarkEvaluator()
  }

  /**
   * Shared adapter converting benchmark source items into UnifiedBatchOffer records
   * with full promotional, canonical, and verified-evidence fields intact.
   */
  public buildUnifiedBatchOffers(items: any[]): UnifiedBatchOffer[] {
    return items.map((it) => {
      const evidence = this.evidenceOverlay
        ? this.evidenceOverlay.getAnnotationForSource([it.sourceOfferId, it.canonicalSourceId])
        : null

      return {
        batchOfferKey: `live_bench:${it.sourceOfferId}`,
        batchId: 'live_benchmark_batch_002',
        leafletId: it.sourceLeaflet,
        sourceFileName: it.sourceFile,
        sourcePdfPath: it.sourceFile,
        sourcePage: it.pageNumber || 1,
        sourceOfferId: it.sourceOfferId,
        canonicalSourceId: it.canonicalSourceId || null,
        supermarketId: '00000000-0000-0000-0000-000000000001',
        supermarketName: it.retailer,
        locationScope: 'national',
        locationLabel: 'KSA',
        cityId: null,
        regionId: null,
        offerStartDate: '2026-11-01',
        offerEndDate: '2026-11-15',
        titleAr: it.titleAr,
        titleEn: it.titleEn,
        brand: it.brand,
        brandAr: it.brandAr,
        brandEn: it.brandEn,
        variantOrFlavor: it.variant || it.variantOrFlavor || null,
        promoPrice: it.promoPrice,
        originalPrice: it.originalPrice,
        discountPercent: null,
        promoNotes: it.promoNotes || it.sharedCropGroupingNote || null,
        sizeOrWeight: `${it.eachSizeValue} ${it.eachSizeUnit}`,
        each_size_value: it.eachSizeValue,
        each_size_unit: it.eachSizeUnit,
        inner_pack_count: it.innerPackCount,
        sale_unit_type: it.saleUnitType,
        total_content_value: it.eachSizeValue,
        total_content_unit: it.eachSizeUnit,
        free_units_text: null,
        customer_limit: it.customerPurchaseLimit || null,
        promo_condition_quantity: it.promoConditionQuantity ?? null,
        promotion_mechanic: it.promotionMechanic || null,
        quantity_semantics: it.quantitySemantics || null,
        assortment_status: it.assortmentStatus || null,
        matchingEvidence: evidence,
        productThumbCropPath: it.thumbCropPath,
        offerCardCropPath: it.cropPath,
        status: 'extracted',
        confidence: 'high',
        warnings: [],
        blockingErrors: []
      }
    })
  }

  /**
   * Asserts strict development-only boundaries. Fails closed if production is touched.
   */
  public assertEnvironmentIsolation(): void {
    const devUrl = process.env.DEV_SUPABASE_URL || ''
    if (!devUrl.includes(DEVELOPMENT_PROJECT_REF)) {
      throw new Error(`ENV_ISOLATION_FAILURE: Development project ref ${DEVELOPMENT_PROJECT_REF} not verified in DEV_SUPABASE_URL.`)
    }
    if (devUrl.includes(PRODUCTION_PROJECT_REF)) {
      throw new Error(`CRITICAL_ENV_VIOLATION: DEV_SUPABASE_URL points to PRODUCTION (${PRODUCTION_PROJECT_REF})! Operation blocked.`)
    }
  }

  /**
   * Controlled DEVELOPMENT catalog definition for Seara and Sadia.
   */
  public getBenchmarkCatalogDefinition(): SeededCatalogProduct[] {
    return [
      // SEARA CATALOG PRODUCTS
      {
        name_en: 'Seara Tender Chicken Breast 1.8Kg',
        name_ar: 'صدور دجاج طرية سيارا 1.8 كجم',
        brand_name: 'Seara',
        variant_or_flavor: 'Tender Breast',
        each_size_value: 1.8,
        each_size_unit: 'kg',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      },
      {
        name_en: 'Seara Tender Chicken Breast 1Kg',
        name_ar: 'صدور دجاج طرية سيارا 1 كجم',
        brand_name: 'Seara',
        variant_or_flavor: 'Tender Breast',
        each_size_value: 1.0,
        each_size_unit: 'kg',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      },
      {
        name_en: 'Seara Frozen Chicken 900g',
        name_ar: 'دجاج مجمد سيارا 900 جم',
        brand_name: 'Seara',
        variant_or_flavor: 'Whole Chicken',
        each_size_value: 900,
        each_size_unit: 'g',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      },
      {
        name_en: 'Seara Frozen Chicken 10 x 900g',
        name_ar: 'دجاج مجمد سيارا 10 × 900 جم',
        brand_name: 'Seara',
        variant_or_flavor: 'Whole Chicken',
        each_size_value: 900,
        each_size_unit: 'g',
        inner_pack_count: 10,
        sale_unit_type: 'piece'
      },
      {
        name_en: 'Seara Frozen Chicken 10 x 1000g',
        name_ar: 'دجاج مجمد سيارا 10 × 1000 جم',
        brand_name: 'Seara',
        variant_or_flavor: 'Whole Chicken',
        each_size_value: 1000,
        each_size_unit: 'g',
        inner_pack_count: 10,
        sale_unit_type: 'piece'
      },
      {
        name_en: 'Seara Chicken Burger 840g',
        name_ar: 'برجر دجاج سيارا 840 جم',
        brand_name: 'Seara',
        variant_or_flavor: 'Burger',
        each_size_value: 840,
        each_size_unit: 'g',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      },

      // SADIA CATALOG PRODUCTS
      {
        name_en: 'Sadia Whole Chicken 1000g',
        name_ar: 'دجاج مجمد ساديا 1000 جم',
        brand_name: 'Sadia',
        variant_or_flavor: 'Whole Chicken',
        each_size_value: 1000,
        each_size_unit: 'g',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      },
      {
        name_en: 'Sadia Whole Chicken 1200g',
        name_ar: 'دجاج مجمد ساديا 1200 جم',
        brand_name: 'Sadia',
        variant_or_flavor: 'Whole Chicken',
        each_size_value: 1200,
        each_size_unit: 'g',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      },
      {
        name_en: 'Sadia Nuggets Chicken 270g',
        name_ar: 'ساديا ناجتس دجاج 270 جم',
        brand_name: 'Sadia',
        variant_or_flavor: 'Nuggets',
        each_size_value: 270,
        each_size_unit: 'g',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      },
      {
        name_en: 'Sadia Chicken Breast 450g',
        name_ar: 'صدور دجاج ساديا 450 جم',
        brand_name: 'Sadia',
        variant_or_flavor: 'Breast',
        each_size_value: 450,
        each_size_unit: 'g',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      }
    ]
  }

  /**
   * Seeds the development catalog products and returns a map of name_en -> generated id.
   */
  public async seedDevelopmentCatalog(): Promise<Map<string, string>> {
    this.assertEnvironmentIsolation()
    const pgClient = createGuardedPgClient('DEVELOPMENT_TEST')
    ;(pgClient as any).connectionTimeoutMillis = 5000
    await pgClient.connect()

    const idMap = new Map<string, string>()

    try {
      const catalogDef = this.getBenchmarkCatalogDefinition()
      for (const prod of catalogDef) {
        // Check if already seeded to avoid duplicates
        const existing = await pgClient.query(
          `SELECT id FROM public.products WHERE brand_name = $1 AND name_en = $2`,
          [prod.brand_name, prod.name_en]
        )

        if (existing.rows.length > 0) {
          idMap.set(prod.name_en, String(existing.rows[0].id))
        } else {
          const insertRes = await pgClient.query(
            `INSERT INTO public.products (
              name_en, name_ar, brand_name, variant_or_flavor,
              each_size_value, each_size_unit, inner_pack_count,
              sale_unit_type, verification_status, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'verified', true)
            RETURNING id`,
            [
              prod.name_en,
              prod.name_ar,
              prod.brand_name,
              prod.variant_or_flavor,
              prod.each_size_value,
              prod.each_size_unit,
              prod.inner_pack_count,
              prod.sale_unit_type
            ]
          )
          idMap.set(prod.name_en, String(insertRes.rows[0].id))
        }
      }
    } finally {
      await pgClient.end()
    }

    return idMap
  }

  /**
   * Runs the complete candidate retrieval preflight offline.
   */
  public async runRetrievalPreflight(catalogIdMap: Map<string, string>): Promise<LiveBenchmarkPreflightReport> {
    this.assertEnvironmentIsolation()
    const supabase = getGuardedSupabaseClient('DEVELOPMENT_TEST')

    const datasetPath = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'live_benchmark_dataset_v1.json')
    const rawData = JSON.parse(readFileSync(datasetPath, 'utf8'))
    const items: any[] = rawData.items

    // Group into UnifiedBatchOffers
    const batchOffers: UnifiedBatchOffer[] = this.buildUnifiedBatchOffers(items)

    const brandGroups = this.brandService.groupOffersByBrand(batchOffers)

    let verifiedExpectedCount = 0
    let totalExpectedCases = 0
    const expectedMatchesVerified: any[] = []
    const absenceProofsVerified: any[] = []
    const unresolvedPoliciesVerified: any[] = []

    const requestsDrafts: any[] = []
    let totalInputTokensEst = 0
    let totalOutputTokensEst = 0
    let totalThinkingTokensEst = 0

    // Brands that will trigger paid calls: only Seara and Sadia (have candidates)
    for (const group of brandGroups) {
      const retrieval = await this.brandService.retrieveBrandCandidates(supabase, group, 50)
      group.candidates = retrieval.candidates

      if (retrieval.candidates.length > 0) {
        // Will generate a Gemini request using the corrected structured source_id prompt contract
        const reqIndex = requestsDrafts.length + 1
        const payload = this.geminiService.buildPromptPayload({
          brandKey: group.brandKey,
          brandName: group.brandNameEn || group.brandKey,
          candidates: retrieval.candidates,
          items: group.uniqueIdentities
        })

        const estInput = Math.ceil((payload.systemPrompt.length + payload.userContent.length) / 3.8)
        const estOutput = group.uniqueIdentities.length * 16
        const estThinking = 1200 // Realistic MEDIUM thinking average

        totalInputTokensEst += estInput
        totalOutputTokensEst += estOutput
        totalThinkingTokensEst += estThinking

        requestsDrafts.push({
          requestNumber: reqIndex,
          brandKey: group.brandKey,
          candidateCount: retrieval.candidates.length,
          itemCount: group.uniqueIdentities.length,
          promptSample: payload.userContent
        })

        // Verify retrieval for items expected to match existing
        for (const identity of group.uniqueIdentities) {
          for (const offer of identity.memberOffers) {
            const rawGold = items.find((x) => x.sourceOfferId === offer.sourceOfferId)
            if (rawGold?.expectedDecision === 'existing') {
              totalExpectedCases++
              const targetCatalogId = catalogIdMap.get(rawGold.targetProductNameEn)
              const foundRank = retrieval.candidates.findIndex((c) => String(c.id) === String(targetCatalogId))

              const isFound = foundRank !== -1
              if (isFound) verifiedExpectedCount++

              expectedMatchesVerified.push({
                sourceOfferId: rawGold.sourceOfferId,
                brand: rawGold.brand,
                titleEn: rawGold.titleEn,
                targetCatalogId: targetCatalogId || 'UNKNOWN',
                targetCatalogNameEn: rawGold.targetProductNameEn,
                retrievedStatus: isFound ? 'found_in_shortlist' : 'missing',
                shortlistRank: foundRank !== -1 ? foundRank + 1 : -1
              })
            }
          }
        }
      } else {
        // Zero candidates in catalog: verifyAbsenceInBrandCatalog
        const absence = await this.brandService.verifyAbsenceInBrandCatalog(supabase, group, group.uniqueIdentities[0])
        absenceProofsVerified.push({
          brand: group.brandKey,
          offersCount: group.uniqueIdentities.length,
          catalogProductsCount: 0,
          absenceProven: absence.isExhaustivelyAbsent
        })
      }
    }

    // Check unresolved policy cases
    const unresolvedCases = items.filter((x) => x.expectedDecision === 'unresolved')
    unresolvedCases.forEach((u) => {
      unresolvedPoliciesVerified.push({
        sourceOfferId: u.sourceOfferId,
        reason: u.notes
      })
    })

    // Pricing estimation using verified Flex PayGo rates through December 31, 2026
    const flexPricing = getModelPricing('gemini-3.8-flash', 'flex', '2026-11-13')
    const estTotalTokens = totalInputTokensEst + totalOutputTokensEst + totalThinkingTokensEst
    const estCost = calculateGeminiCost(
      {
        promptTokenCount: totalInputTokensEst,
        candidatesTokenCount: totalOutputTokensEst,
        thoughtsTokenCount: totalThinkingTokensEst
      },
      'gemini-3.8-flash',
      'flex',
      '2026-11-13'
    ).totalCostUsd

    // Conservative upper bound (assuming 4,000 thinking tokens per request)
    const worstCaseCost = calculateGeminiCost(
      {
        promptTokenCount: totalInputTokensEst * 1.5,
        candidatesTokenCount: totalOutputTokensEst * 2,
        thoughtsTokenCount: requestsDrafts.length * 4000
      },
      'gemini-3.8-flash',
      'flex',
      '2026-11-13'
    ).totalCostUsd

    const existingCount = items.filter((x) => x.expectedDecision === 'existing').length
    const tempCount = items.filter((x) => x.expectedDecision === 'temporary').length
    const unresCount = items.filter((x) => x.expectedDecision === 'unresolved').length

    const geminiItems = items.filter((x) => x.evaluationTrack === 'gemini_live')
    const localItems = items.filter((x) => x.evaluationTrack !== 'gemini_live')

    return {
      timestamp: new Date().toISOString(),
      environment: {
        targetProjectRef: DEVELOPMENT_PROJECT_REF,
        isDevelopment: true,
        isProductionBlocked: true,
        productionProjectRef: PRODUCTION_PROJECT_REF
      },
      dataset: {
        totalRealSourceIdentities: items.length,
        existingVerifiedProductCases: existingCount,
        proposedNewProductCases: tempCount,
        deliberatelyUnresolvedCases: unresCount,
        brandCount: brandGroups.length,
        brands: brandGroups.map((b) => b.brandKey)
      },
      coveragePartitioning: {
        geminiEvaluatedIdentitiesCount: geminiItems.length,
        geminiEvaluatedBrands: Array.from(new Set(geminiItems.map((x) => x.brand))),
        geminiEvaluatedBreakdown: {
          existing: geminiItems.filter((x) => x.expectedDecision === 'existing').length,
          temporary: geminiItems.filter((x) => x.expectedDecision === 'temporary').length,
          unresolved: geminiItems.filter((x) => x.expectedDecision === 'unresolved').length
        },
        locallyHandledIdentitiesCount: localItems.length,
        locallyHandledBreakdown: {
          absentInTestCatalogOnly: localItems.filter((x) => x.evaluationTrack === 'offline_absence').length,
          policyFlaggedUnresolved: localItems.filter((x) => x.evaluationTrack === 'offline_policy').length
        },
        crossRequestTempReconciliationTested: false,
        testCatalogAbsenceScopeNote: 'Absence proofs for Fakieh and Tanmiah apply strictly to the deliberately seeded development test catalog only—not proof that these products do not exist in the real world.'
      },
      pricingDocumentation: {
        modelId: 'gemini-3.8-flash',
        tier: 'flex',
        effectiveDate: flexPricing.effectiveDate,
        validThrough: '2026-12-31',
        inputPerMillionUsd: flexPricing.inputPerMillion,
        outputIncludingThinkingPerMillionUsd: flexPricing.outputPerMillion,
        cachedInputPerMillionUsd: flexPricing.cachedInputPerMillion,
        doubleCountingGuard: 'calculateGeminiCost subtracts thoughtsTokenCount from candidatesTokenCount whenever totalTokenCount == promptTokenCount + candidatesTokenCount'
      },
      retrievalPreflight: {
        retrievalRecall: totalExpectedCases > 0 ? verifiedExpectedCount / totalExpectedCases : 1.0,
        expectedMatchesVerified,
        absenceProofsVerified,
        unresolvedPoliciesVerified
      },
      requestBudget: {
        matchingRequestsCount: requestsDrafts.length,
        estimatedInputTokens: totalInputTokensEst,
        estimatedOutputTokens: totalOutputTokensEst,
        estimatedThinkingTokens: totalThinkingTokensEst,
        estimatedTotalTokens: estTotalTokens,
        estimatedFlexCostUsd: Number(estCost.toFixed(5)),
        conservativeUpperBoundCostUsd: Number(worstCaseCost.toFixed(5)),
        approvedSpendCapUsd: 0.05,
        isWithinBudget: worstCaseCost <= 0.05 && requestsDrafts.length <= 2
      },
      modelConfig: {
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        location: 'global',
        responseMimeType: 'application/json',
        structuredSchemaContract: '{ matches: [{ source_id: string, product_id: string | null }] }'
      },
      provenance: {
        datasetFixturePath: 'test-fixtures/matching-benchmarks/live_benchmark_dataset_v1.json',
        exactRequestDrafts: requestsDrafts
      }
    }
  }

  /**
   * Confirms that all 10 benchmark catalog products currently exist in DEVELOPMENT DB
   * and returns their verified PostgreSQL ID map without modifying production.
   */
  public async verifyExistingDevelopmentCatalogIds(): Promise<Map<string, string>> {
    this.assertEnvironmentIsolation()
    const pgClient = createGuardedPgClient('DEVELOPMENT_TEST')
    ;(pgClient as any).connectionTimeoutMillis = 5000
    await pgClient.connect()

    const idMap = new Map<string, string>()
    try {
      const catalogDef = this.getBenchmarkCatalogDefinition()
      for (const prod of catalogDef) {
        const res = await pgClient.query(
          `SELECT id, name_en, brand_name, each_size_value, each_size_unit, inner_pack_count
           FROM public.products WHERE brand_name = $1 AND name_en = $2`,
          [prod.brand_name, prod.name_en]
        )
        if (res.rows.length === 0) {
          throw new Error(
            `MISSING_DEV_CATALOG_PRODUCT: "${prod.name_en}" (${prod.brand_name}) is missing from DEVELOPMENT catalog ${DEVELOPMENT_PROJECT_REF}.`
          )
        }
        idMap.set(prod.name_en, String(res.rows[0].id))
      }
    } finally {
      await pgClient.end()
    }
    return idMap
  }

  /**
   * Executes the explicitly authorized live benchmark:
   * - Hard limit: MAX 2 paid Gemini requests (0 retries)
   * - Hard cap: <= $0.05 USD estimated budget
   * - Model: gemini-3.8-flash, MEDIUM thinking, Vertex AI Flex PayGo (global)
   * - Strictly targets DEVELOPMENT (gykrbpykjhpyrdrinkuk); zero production writes or offers publication
   */
  public async executeAuthorizedLiveBenchmark(
    catalogIdMap: Map<string, string>,
    options: { operatorAuthorizedMaxTwoRequests: true }
  ): Promise<any> {
    if (!options?.operatorAuthorizedMaxTwoRequests) {
      throw new Error('AUTHORIZATION_REQUIRED: Paid Gemini execution requires explicit operator authorization.')
    }
    if (process.env.WIFRAN_OFFLINE_UAT === '1') {
      throw new Error('LIVE_EXECUTION_BLOCKED_BY_OFFLINE_UAT: Unset WIFRAN_OFFLINE_UAT to execute authorized live calls.')
    }
    this.assertEnvironmentIsolation()

    const startTime = Date.now()
    const preflight = await this.runRetrievalPreflight(catalogIdMap)
    if (preflight.requestBudget.matchingRequestsCount > 2) {
      throw new Error(
        `REQUEST_LIMIT_EXCEEDED: Expected <= 2 paid requests, but preflight built ${preflight.requestBudget.matchingRequestsCount}. Aborting.`
      )
    }
    if (!preflight.requestBudget.isWithinBudget) {
      throw new Error(
        `BUDGET_CAP_EXCEEDED: Conservative upper bound $${preflight.requestBudget.conservativeUpperBoundCostUsd} exceeds $0.05. Aborting.`
      )
    }

    const supabase = getGuardedSupabaseClient('DEVELOPMENT_TEST')
    const datasetPath = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'live_benchmark_dataset_v1.json')
    const rawData = JSON.parse(readFileSync(datasetPath, 'utf8'))
    const items: any[] = rawData.items

    const batchOffers: UnifiedBatchOffer[] = this.buildUnifiedBatchOffers(items)

    const brandGroups = this.brandService.groupOffersByBrand(batchOffers)
    const idToCatalogName = new Map<string, string>()
    for (const [name, id] of catalogIdMap.entries()) {
      idToCatalogName.set(String(id), name)
    }

    const requestConfigSnapshot = this.geminiService.buildRequestConfig({ validSourceIds: ['1', '2'] })
    const sourceIdProp = requestConfigSnapshot?.responseSchema?.properties?.matches?.items?.properties?.source_id
    const schemaVerification = {
      sourceIdType: sourceIdProp?.type || null,
      sourceIdHasFormat: Object.prototype.hasOwnProperty.call(sourceIdProp || {}, 'format') && sourceIdProp?.format !== undefined,
      sourceIdEnumSample: sourceIdProp?.enum || null,
      responseMimeType: requestConfigSnapshot?.responseMimeType || null,
      thinkingLevel: requestConfigSnapshot?.thinkingConfig?.thinkingLevel || null,
      flexHeaders: requestConfigSnapshot?.httpOptions?.headers || null
    }

    const actualRequests: any[] = []
    const perItemResults: any[] = []
    const tempRegistry = new TemporaryProductRegistry('live_bench')
    let paidRequestCounter = 0

    for (const group of brandGroups) {
      const retrieval = await this.brandService.retrieveBrandCandidates(supabase, group, 50)
      group.candidates = retrieval.candidates

      if (retrieval.candidates.length > 0) {
        // Live Gemini request track (Seara and Sadia)
        if (paidRequestCounter >= 2) {
          throw new Error('HARD_REQUEST_CAP_HIT: Refusing to issue more than 2 paid Gemini requests.')
        }
        paidRequestCounter++
        const reqIdx = paidRequestCounter

        const reqInput = {
          brandKey: group.brandKey,
          brandName: group.brandNameEn || group.brandKey,
          candidates: retrieval.candidates,
          items: group.uniqueIdentities
        }
        const promptPreview = this.geminiService.buildPromptPayload(reqInput)

        let evalResult
        try {
          evalResult = await this.geminiService.evaluateBatch(reqInput)
        } catch (reqErr: any) {
          // Hard fail-stop: do NOT launch Request 2 or retry/fallback on Request 1 failure
          throw new Error(
            `LIVE_BENCHMARK_ABORTED_AT_REQUEST_${reqIdx}_BRAND_${group.brandKey.toUpperCase()}: ${reqErr?.message || String(reqErr)}`
          )
        }

        actualRequests.push({
          requestIndex: reqIdx,
          brandKey: group.brandKey,
          candidateCount: retrieval.candidates.length,
          candidatesSupplied: retrieval.candidates.map((c) => ({ id: c.id, nameEn: c.nameEn, size: `${c.sizeValue}${c.sizeUnit}`, pack: c.packCount })),
          itemCount: group.uniqueIdentities.length,
          inputTokens: evalResult.usage.inputTokens,
          outputTokens: evalResult.usage.outputTokens,
          thinkingTokens: evalResult.usage.thinkingTokens,
          cachedTokens: evalResult.usage.cachedTokens || 0,
          totalTokens: evalResult.usage.totalTokens || 0,
          actualCostUsd: evalResult.usage.actualCostUsd,
          executionTier: evalResult.usage.executionTier,
          latencyMs: evalResult.latencyMs || 0,
          promptSystemPrompt: promptPreview.systemPrompt,
          promptUserContent: promptPreview.userContent,
          sourcePromptMapping: evalResult.sourcePromptMapping || [],
          rawModelResponseText: evalResult.rawModelResponseText,
          rawParsedResponse: evalResult.rawParsedResponse,
          requestDiagnostics: evalResult.requestDiagnostics || [],
          unrecognizedEntries: evalResult.unrecognizedEntries || [],
          responseComplete: Boolean(evalResult.rawModelResponseText && evalResult.rawParsedResponse)
        })

        // Reconcile per-item Gemini evaluation (tracking BOTH raw semantic & post-validation outcomes)
        const requestScopedTempMap = new Map<string, string>()
        evalResult.matches.forEach((m, idx) => {
          const sourceIdStr =
            evalResult.sourcePromptMapping?.find((sp) => sp.identityKey === m.item.identityKey)?.sourceId || String(idx + 1)
          const rawMapEntry = (evalResult.rawParsedResponse?.matches || []).find((rm) => {
            const rawSid = String(rm.source_id || '').trim()
            return rawSid === sourceIdStr || String(m.rawModelSourceId || '').trim() === rawSid
          })
          const offer = m.item.memberOffers[0]
          const gold = items.find((it) => it.sourceOfferId === offer.sourceOfferId)!
          const expectedCatalogId = gold.targetProductNameEn ? catalogIdMap.get(gold.targetProductNameEn) || null : null

          const rawProductIdVal = rawMapEntry ? rawMapEntry.product_id : null
          let rawDecision: 'existing' | 'temporary' | 'unresolved' | 'omitted' = 'omitted'
          if (rawMapEntry) {
            if (rawProductIdVal === null || rawProductIdVal === undefined || rawProductIdVal === '') {
              rawDecision = 'unresolved'
            } else if (/^t\d+$/i.test(String(rawProductIdVal).trim())) {
              rawDecision = 'temporary'
            } else {
              rawDecision = 'existing'
            }
          }

          const rawIsCorrect =
            gold.expectedDecision === 'existing'
              ? rawDecision === 'existing' && String(rawProductIdVal) === String(expectedCatalogId)
              : rawDecision === gold.expectedDecision

          let actualDecision: 'existing' | 'temporary' | 'unresolved' = 'unresolved'
          let reconciledTemporaryId: string | null = null
          let canonicalFingerprint: string | null = null
          if (m.matchedProductId) actualDecision = 'existing'
          else if (m.temporaryRef) {
            actualDecision = 'temporary'
            for (const memberOffer of m.item.memberOffers) {
              const reg = tempRegistry.reconcileTemporaryOffer({
                requestTempRef: m.temporaryRef,
                requestScopedMap: requestScopedTempMap,
                attrs: m.item.normalizedAttrs,
                sourceOffer: memberOffer
              })
              reconciledTemporaryId = reg.temporaryId
            }
            if (reconciledTemporaryId) {
              canonicalFingerprint = tempRegistry.getGroup(reconciledTemporaryId)?.canonicalFingerprint || null
            }
          }

          const isExactMatch =
            gold.expectedDecision === 'existing'
              ? actualDecision === 'existing' && String(m.matchedProductId) === String(expectedCatalogId)
              : actualDecision === gold.expectedDecision

          perItemResults.push({
            sourceOfferId: gold.sourceOfferId,
            canonicalSourceId: gold.canonicalSourceId,
            brand: gold.brand,
            titleEn: gold.titleEn,
            evaluationTrack: 'gemini_live',
            requestIndex: reqIdx,
            promptSourceId: sourceIdStr,
            rawModelSourceId: m.rawModelSourceId ?? (rawMapEntry ? rawMapEntry.source_id : null),
            wasSourceIdNormalized: Boolean(m.wasSourceIdNormalized),
            goldDecision: gold.expectedDecision,
            expectedCatalogId,
            expectedCatalogName: gold.targetProductNameEn,
            rawModelProductId: rawMapEntry ? rawMapEntry.product_id : 'OMITTED',
            rawDecision,
            rawIsCorrect,
            actualDecision,
            actualCatalogId: m.matchedProductId,
            actualCatalogName: m.matchedProductId ? idToCatalogName.get(String(m.matchedProductId)) || null : null,
            actualTemporaryRef: m.temporaryRef,
            reconciledTemporaryId,
            canonicalFingerprint,
            validationIssues: m.validationIssues,
            isCorrect: isExactMatch,
            notes: gold.notes
          })
        })
      } else {
        // Offline track ($0.00): absence proofs and local brand-status policies
        const localScopedTempMap = new Map<string, string>()
        for (const identity of group.uniqueIdentities) {
          const offer = identity.memberOffers[0]
          const gold = items.find((it) => it.sourceOfferId === offer.sourceOfferId)!

          let actualDecision: 'existing' | 'temporary' | 'unresolved' = 'unresolved'
          let absenceProven = false
          let handlingReason = ''

          const sufficiency = evaluateIdentitySufficiency(
            identity.normalizedAttrs,
            offer,
            identity.normalizedAttrs.evidenceAnnotation
          )

          if (!sufficiency.isSufficient) {
            actualDecision = 'unresolved'
            handlingReason = `Identity sufficiency gate rejected (${sufficiency.codes.join(', ')}: ${sufficiency.reasons.join(' ')})`
          } else {
            const absence = await this.brandService.verifyAbsenceInBrandCatalog(supabase, group, identity)
            absenceProven = absence.isExhaustivelyAbsent
            if (absence.foundCandidate) {
              actualDecision = 'existing'
              handlingReason = `Secondary search matched candidate ${absence.foundCandidate.id}`
            } else if (absence.isExhaustivelyAbsent) {
              actualDecision = 'temporary'
              handlingReason = `verifyAbsenceInBrandCatalog proved 0 matching products in seeded test catalog AND identity sufficiency passed (${absence.searchDiagnostics.join('; ')})`
            } else {
              actualDecision = 'unresolved'
              handlingReason = `Absence inconclusive (${absence.coverage})`
            }
          }

          let reconciledTemporaryId: string | null = null
          let canonicalFingerprint: string | null = null
          if (actualDecision === 'temporary') {
            for (const memberOffer of identity.memberOffers) {
              const reg = tempRegistry.reconcileTemporaryOffer({
                requestTempRef: `local_${memberOffer.sourceOfferId}`,
                requestScopedMap: localScopedTempMap,
                attrs: identity.normalizedAttrs,
                sourceOffer: memberOffer
              })
              reconciledTemporaryId = reg.temporaryId
            }
            if (reconciledTemporaryId) {
              canonicalFingerprint = tempRegistry.getGroup(reconciledTemporaryId)?.canonicalFingerprint || null
            }
          }

          perItemResults.push({
            sourceOfferId: gold.sourceOfferId,
            canonicalSourceId: gold.canonicalSourceId,
            brand: gold.brand || group.brandKey,
            titleEn: gold.titleEn,
            evaluationTrack: gold.evaluationTrack,
            requestIndex: null,
            promptSourceId: null,
            rawModelSourceId: null,
            wasSourceIdNormalized: false,
            goldDecision: gold.expectedDecision,
            expectedCatalogId: null,
            expectedCatalogName: null,
            rawModelProductId: null,
            rawDecision: null,
            rawIsCorrect: null,
            actualDecision,
            actualCatalogId: null,
            actualCatalogName: null,
            actualTemporaryRef: reconciledTemporaryId,
            reconciledTemporaryId,
            canonicalFingerprint,
            validationIssues: sufficiency.isSufficient ? [] : sufficiency.codes,
            absenceProvenInTestCatalog: absenceProven,
            handlingReason,
            isCorrect: actualDecision === gold.expectedDecision,
            notes: gold.notes
          })
        }
      }
    }

    // Assess unannotated extraction-only vs evidence-assisted behavior for Track (§6)
    const bareGrouping = new BrandGroupingService()
    const evidenceAssistedVsAutomaticAssessment = items.map((goldItem) => {
      const offerWithOverlay = batchOffers.find((o) => o.sourceOfferId === goldItem.sourceOfferId)!
      const bareOffer = {
        ...offerWithOverlay,
        matchingEvidence: null,
        assortment_status: goldItem.assortmentStatus ?? null
      }
      const bareAttrs = bareGrouping.extractNormalizedAttributes(bareOffer)
      const bareSufficiency = evaluateIdentitySufficiency(bareAttrs, bareOffer, null)
      const overlaySufficiency = evaluateIdentitySufficiency(
        bareGrouping.extractNormalizedAttributes(offerWithOverlay),
        offerWithOverlay,
        offerWithOverlay.matchingEvidence || null
      )
      return {
        sourceOfferId: goldItem.sourceOfferId,
        goldDecision: goldItem.expectedDecision,
        hasEvidenceOverlay: Boolean(offerWithOverlay.matchingEvidence),
        extractionAssortmentStatus: goldItem.assortmentStatus ?? null,
        isSufficientWithoutOverlay: bareSufficiency.isSufficient,
        codesWithoutOverlay: bareSufficiency.codes,
        isSufficientWithOverlay: overlaySufficiency.isSufficient,
        codesWithOverlay: overlaySufficiency.codes,
        requiresOperatorOverlayForAbstention:
          bareSufficiency.isSufficient && !overlaySufficiency.isSufficient
      }
    })

    const geminiItems = perItemResults.filter((r) => r.evaluationTrack === 'gemini_live')
    const localItems = perItemResults.filter((r) => r.evaluationTrack !== 'gemini_live')

    const totalCostUsd = Number(actualRequests.reduce((s, r) => s + (r.actualCostUsd || 0), 0).toFixed(8))
    const totalInputTokens = actualRequests.reduce((s, r) => s + r.inputTokens, 0)
    const totalOutputTokens = actualRequests.reduce((s, r) => s + r.outputTokens, 0)
    const totalThinkingTokens = actualRequests.reduce((s, r) => s + r.thinkingTokens, 0)
    const totalCachedTokens = actualRequests.reduce((s, r) => s + (r.cachedTokens || 0), 0)
    const totalTokens = actualRequests.reduce((s, r) => s + r.totalTokens, 0)

    const geminiCorrect = geminiItems.filter((r) => r.isCorrect).length
    const rawGeminiCorrect = geminiItems.filter((r) => r.rawIsCorrect).length
    const localCorrect = localItems.filter((r) => r.isCorrect).length
    const overallCorrect = perItemResults.filter((r) => r.isCorrect).length

    const falseExistingMatches = geminiItems.filter(
      (r) => r.actualDecision === 'existing' && !r.isCorrect
    )
    const rawFalseExistingMatches = geminiItems.filter(
      (r) => r.rawDecision === 'existing' && !r.rawIsCorrect
    )
    const preventedFalseExistingMatches = rawFalseExistingMatches.filter(
      (r) => r.actualDecision !== 'existing'
    )
    const validationRejections = geminiItems.filter((r) => r.validationIssues && r.validationIssues.length > 0)
    const parserRejectedEntriesCount = actualRequests.reduce(
      (s, r) => s + (r.unrecognizedEntries?.length || 0),
      0
    )

    return {
      executedAt: new Date().toISOString(),
      environment: {
        targetProjectRef: DEVELOPMENT_PROJECT_REF,
        productionProjectRef: PRODUCTION_PROJECT_REF,
        productionUntouched: true
      },
      modelConfig: preflight.modelConfig,
      schemaVerification,
      pricingDocumentation: preflight.pricingDocumentation,
      actualRequests,
      totals: {
        requestsExecuted: paidRequestCounter,
        totalInputTokens,
        totalOutputTokens,
        totalThinkingTokens,
        totalCachedTokens,
        totalTokens,
        totalCostUsd,
        withinBudgetCap: totalCostUsd <= 0.05 && paidRequestCounter <= 2,
        totalLatencyMs: actualRequests.reduce((s, r) => s + r.latencyMs, 0),
        wallDurationMs: Date.now() - startTime
      },
      metricsPartitioned: {
        rawGeminiSemantic: {
          count: geminiItems.length,
          correctCount: rawGeminiCorrect,
          accuracy: geminiItems.length > 0 ? Number((rawGeminiCorrect / geminiItems.length).toFixed(4)) : 0,
          existingCorrectCount: geminiItems.filter((r) => r.rawDecision === 'existing' && r.rawIsCorrect).length,
          falseExistingMatchesCount: rawFalseExistingMatches.length,
          temporaryProposedCount: geminiItems.filter((r) => r.rawDecision === 'temporary').length,
          temporaryCorrectCount: geminiItems.filter((r) => r.rawDecision === 'temporary' && r.rawIsCorrect).length,
          unresolvedCount: geminiItems.filter((r) => r.rawDecision === 'unresolved').length,
          exactBareSourceIdCount: geminiItems.filter((r) => !r.wasSourceIdNormalized && r.rawDecision !== 'omitted').length,
          sourceIdNormalizedCount: geminiItems.filter((r) => r.wasSourceIdNormalized).length,
          parserRejectedEntriesCount
        },
        postValidation: {
          count: geminiItems.length,
          correctCount: geminiCorrect,
          accuracy: geminiItems.length > 0 ? Number((geminiCorrect / geminiItems.length).toFixed(4)) : 0,
          falseExistingMatchesCount: falseExistingMatches.length,
          preventedFalseExistingCount: preventedFalseExistingMatches.length,
          rejectedInvalidTempCount: geminiItems.filter(
            (r) => r.rawDecision === 'temporary' && r.actualDecision !== 'temporary'
          ).length,
          assortmentSafeguardBlocksCount: geminiItems.filter((r) =>
            (r.validationIssues || []).some((v: string) => v.includes('ASSORTMENT'))
          ).length,
          sufficiencyBlocksCount: geminiItems.filter((r) =>
            (r.validationIssues || []).some((v: string) => v.includes('SUFFICIENCY'))
          ).length,
          sourceIdNormalizedCount: geminiItems.filter((r) => r.wasSourceIdNormalized).length,
          unrecognizedEntriesCount: parserRejectedEntriesCount
        },
        geminiEvaluatedSubset: {
          count: geminiItems.length,
          correctCount: geminiCorrect,
          accuracy: geminiItems.length > 0 ? Number((geminiCorrect / geminiItems.length).toFixed(4)) : 0,
          falseExistingMatchesCount: falseExistingMatches.length,
          validationRejectionsCount: validationRejections.length,
          crossRequestTempReconciliationTested: false
        },
        locallyHandledSubset: {
          count: localItems.length,
          correctCount: localCorrect,
          accuracy: localItems.length > 0 ? Number((localCorrect / localItems.length).toFixed(4)) : 0,
          costUsd: 0
        },
        overallPipeline: {
          count: perItemResults.length,
          correctCount: overallCorrect,
          accuracy: perItemResults.length > 0 ? Number((overallCorrect / perItemResults.length).toFixed(4)) : 0,
          totalCostUsd
        }
      },
      evidenceAssistedVsAutomaticAssessment,
      temporaryProductGroups: tempRegistry.getGroups(),
      perItemResults
    }
  }

  /**
   * Deterministic Offline Replay Harness (§7):
   * Replays previously saved real Gemini responses from Extracts/live_benchmark_execution_result.json
   * through the shared production validator & identity sufficiency pipeline at $0.00 cost.
   * NEVER overwrites historical raw evidence or historical metrics.
   */
  public replayHistoricalBenchmarkOffline(options?: {
    executionResultPath?: string
    datasetPath?: string
  }): {
    replayedAt: string
    paidApiCallsExecuted: 0
    preservedHistoricalMetrics: any
    replayMetrics: {
      geminiSubsetPostValidation: {
        count: number
        correctCount: number
        accuracy: number
        falseExistingMatchesCount: number
        validationRejectionsCount: number
        falseOmittedByModelCount: number
        historicalSemanticErrorsPreserved: number
      }
      locallyHandledSubset: {
        count: number
        correctCount: number
        accuracy: number
        costUsd: 0
      }
      overallPipeline: {
        count: number
        correctCount: number
        accuracy: number
      }
    }
    temporaryProductGroups: Record<string, any>
    perItemReplayResults: Array<any>
  } {
    const execPath =
      options?.executionResultPath ||
      join(process.cwd(), 'Extracts', 'live_benchmark_execution_result.json')
    const dsPath =
      options?.datasetPath ||
      join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'live_benchmark_dataset_v1.json')

    const historical = JSON.parse(readFileSync(execPath, 'utf8'))
    const rawDataset = JSON.parse(readFileSync(dsPath, 'utf8'))
    const items: any[] = rawDataset.items

    const batchOffers = this.buildUnifiedBatchOffers(items)
    const brandGroups = this.brandService.groupOffersByBrand(batchOffers)

    const requestByBrand = new Map<string, any>()
    for (const req of historical.actualRequests || []) {
      requestByBrand.set(String(req.brandKey).toLowerCase(), req)
    }

    const perItemReplayResults: any[] = []
    const replayTempRegistry = new TemporaryProductRegistry('replay_002b')

    for (const group of brandGroups) {
      const recordedReq = requestByBrand.get(group.brandKey)
      if (recordedReq) {
        const requestScopedTempMap = new Map<string, string>()
        const candidates: CompactCatalogCandidate[] = (recordedReq.candidatesSupplied || []).map((c: any) => {
          const sizeMatch = String(c.size || '').match(/^([\d.]+)\s*([a-zA-Z]+)$/)
          return {
            id: String(c.id),
            brand: group.brandNameEn || group.brandKey,
            nameEn: c.nameEn,
            nameAr: c.nameEn,
            variant: null,
            sizeValue: sizeMatch ? Number(sizeMatch[1]) : null,
            sizeUnit: sizeMatch ? sizeMatch[2].toLowerCase() : null,
            packCount: Number(c.pack || 1)
          }
        })
        const authorizedIds = new Set<string>(candidates.map((c) => c.id))
        const candById = new Map<string, CompactCatalogCandidate>(candidates.map((c) => [c.id, c]))

        // Reconstruct exact request sourceMap matching historical sourcePromptMapping order
        const sourceMap = new Map<string, any>()
        for (const sp of recordedReq.sourcePromptMapping || []) {
          const foundItem = group.uniqueIdentities.find((ui) =>
            ui.memberOffers.some((mo) => {
              const dsItem = items.find((x) => x.sourceOfferId === mo.sourceOfferId)
              return dsItem && sp.titleEn === dsItem.titleEn
            })
          )
          if (foundItem) {
            sourceMap.set(String(sp.sourceId), foundItem)
          }
        }

        const reconciled = this.geminiService.validateAndReconcileResponseDetailed(
          recordedReq.rawParsedResponse,
          sourceMap,
          candidates,
          authorizedIds
        )

        for (const outcome of reconciled.matches) {
          const offer = outcome.item.memberOffers[0]
          const gold = items.find((it) => it.sourceOfferId === offer.sourceOfferId)!
          const expectedId =
            gold.targetProductNameEn &&
            candidates.find((c) => c.nameEn === gold.targetProductNameEn)?.id
              ? candidates.find((c) => c.nameEn === gold.targetProductNameEn)!.id
              : null

          let actualDecision: 'existing' | 'temporary' | 'unresolved' = 'unresolved'
          let reconciledTemporaryId: string | null = null
          let canonicalFingerprint: string | null = null
          if (outcome.matchedProductId) actualDecision = 'existing'
          else if (outcome.temporaryRef) {
            actualDecision = 'temporary'
            for (const memberOffer of outcome.item.memberOffers) {
              const reg = replayTempRegistry.reconcileTemporaryOffer({
                requestTempRef: outcome.temporaryRef,
                requestScopedMap: requestScopedTempMap,
                attrs: outcome.item.normalizedAttrs,
                sourceOffer: memberOffer
              })
              reconciledTemporaryId = reg.temporaryId
            }
            if (reconciledTemporaryId) {
              canonicalFingerprint = replayTempRegistry.getGroup(reconciledTemporaryId)?.canonicalFingerprint || null
            }
          }

          const isCorrect =
            gold.expectedDecision === 'existing'
              ? actualDecision === 'existing' && String(outcome.matchedProductId) === String(expectedId)
              : actualDecision === gold.expectedDecision

          perItemReplayResults.push({
            sourceOfferId: gold.sourceOfferId,
            brand: gold.brand,
            titleEn: gold.titleEn,
            evaluationTrack: 'offline_replay_gemini',
            promptSourceId: outcome.sourceId || null,
            rawModelSourceId: outcome.rawModelSourceId || null,
            wasSourceIdNormalized: Boolean(outcome.wasSourceIdNormalized),
            goldDecision: gold.expectedDecision,
            expectedCatalogId: expectedId,
            actualDecision,
            actualCatalogId: outcome.matchedProductId,
            actualCatalogName: outcome.matchedProductId ? candById.get(outcome.matchedProductId)?.nameEn || null : null,
            actualTemporaryRef: outcome.temporaryRef,
            reconciledTemporaryId,
            canonicalFingerprint,
            validationIssues: outcome.validationIssues,
            evidenceAnnotation: offer.matchingEvidence || null,
            isCorrect
          })
        }
      } else {
        const localScopedTempMap = new Map<string, string>()
        for (const identity of group.uniqueIdentities) {
          const offer = identity.memberOffers[0]
          const gold = items.find((it) => it.sourceOfferId === offer.sourceOfferId)!
          const sufficiency = evaluateIdentitySufficiency(
            identity.normalizedAttrs,
            offer,
            identity.normalizedAttrs.evidenceAnnotation
          )

          let actualDecision: 'temporary' | 'unresolved' = 'unresolved'
          let handlingReason = ''
          let reconciledTemporaryId: string | null = null
          let canonicalFingerprint: string | null = null
          if (!sufficiency.isSufficient) {
            actualDecision = 'unresolved'
            handlingReason = `Identity sufficiency gate rejected (${sufficiency.codes.join(', ')})`
          } else {
            // Historical offline tracks already proved test-catalog absence for Fakieh/Tanmiah
            actualDecision = 'temporary'
            handlingReason = 'Test-catalog absent brand with sufficient complete product identity'
            for (const memberOffer of identity.memberOffers) {
              const reg = replayTempRegistry.reconcileTemporaryOffer({
                requestTempRef: `local_${memberOffer.sourceOfferId}`,
                requestScopedMap: localScopedTempMap,
                attrs: identity.normalizedAttrs,
                sourceOffer: memberOffer
              })
              reconciledTemporaryId = reg.temporaryId
            }
            if (reconciledTemporaryId) {
              canonicalFingerprint = replayTempRegistry.getGroup(reconciledTemporaryId)?.canonicalFingerprint || null
            }
          }

          perItemReplayResults.push({
            sourceOfferId: gold.sourceOfferId,
            brand: gold.brand || group.brandKey,
            titleEn: gold.titleEn,
            evaluationTrack: 'offline_replay_local',
            goldDecision: gold.expectedDecision,
            actualDecision,
            actualTemporaryRef: reconciledTemporaryId,
            reconciledTemporaryId,
            canonicalFingerprint,
            handlingReason,
            validationIssues: sufficiency.reasons,
            isCorrect: actualDecision === gold.expectedDecision
          })
        }
      }
    }

    const geminiReplay = perItemReplayResults.filter((r) => r.evaluationTrack === 'offline_replay_gemini')
    const localReplay = perItemReplayResults.filter((r) => r.evaluationTrack === 'offline_replay_local')
    const falseExisting = geminiReplay.filter((r) => r.actualDecision === 'existing' && !r.isCorrect).length
    const valRejects = geminiReplay.filter((r) => r.validationIssues.length > 0).length
    const falseOmitted = geminiReplay.filter((r) =>
      r.validationIssues.some((v: string) => /OMITTED_BY_MODEL/i.test(v))
    ).length
    const historicalSemanticErrors = geminiReplay.filter(
      (r) => !r.isCorrect && r.actualDecision !== 'unresolved'
    ).length

    const geminiCorrect = geminiReplay.filter((r) => r.isCorrect).length
    const localCorrect = localReplay.filter((r) => r.isCorrect).length
    const totalCorrect = perItemReplayResults.filter((r) => r.isCorrect).length

    return {
      replayedAt: new Date().toISOString(),
      paidApiCallsExecuted: 0,
      preservedHistoricalMetrics: historical.metricsPartitioned,
      replayMetrics: {
        geminiSubsetPostValidation: {
          count: geminiReplay.length,
          correctCount: geminiCorrect,
          accuracy: geminiReplay.length > 0 ? Number((geminiCorrect / geminiReplay.length).toFixed(4)) : 0,
          falseExistingMatchesCount: falseExisting,
          validationRejectionsCount: valRejects,
          falseOmittedByModelCount: falseOmitted,
          historicalSemanticErrorsPreserved: historicalSemanticErrors
        },
        locallyHandledSubset: {
          count: localReplay.length,
          correctCount: localCorrect,
          accuracy: localReplay.length > 0 ? Number((localCorrect / localReplay.length).toFixed(4)) : 0,
          costUsd: 0
        },
        overallPipeline: {
          count: perItemReplayResults.length,
          correctCount: totalCorrect,
          accuracy:
            perItemReplayResults.length > 0
              ? Number((totalCorrect / perItemReplayResults.length).toFixed(4))
              : 0
        }
      },
      temporaryProductGroups: replayTempRegistry.getGroups(),
      perItemReplayResults
    }
  }

  /**
   * Cleans up seeded products and test offers from DEVELOPMENT database cleanly.
   */
  public async cleanupDevelopmentDatabase(): Promise<void> {
    this.assertEnvironmentIsolation()
    const pgClient = createGuardedPgClient('DEVELOPMENT_TEST')
    ;(pgClient as any).connectionTimeoutMillis = 5000
    await pgClient.connect()

    try {
      await pgClient.query(`DELETE FROM public.offers WHERE title_en ILIKE '%Seara%' OR title_en ILIKE '%Sadia%'`)
      await pgClient.query(`DELETE FROM public.products WHERE brand_name IN ('Seara', 'Sadia')`)
    } finally {
      await pgClient.end()
    }
  }
}
