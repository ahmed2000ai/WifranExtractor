import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CatalogMatchingOrchestrator } from '../catalogMatchingOrchestrator'
import { GeminiMatchingService, classifyMatchingError } from '../../ocr/geminiMatchingService'
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService'
import { BrandGroupingService } from '../../db/brandGroupingService'
import { CatalogPublicationService } from '../../db/catalogPublicationService'
import { evaluateIdentitySufficiency } from '../../db/productIdentityPolicy'
import { TemporaryProductRegistry } from '../../db/temporaryProductRegistry'
import { UnifiedBatchOffer } from '../../../shared/types/batchExtraction'
import { MatchingProgressEvent } from '../../../shared/types/catalogMatching'

function createDeferred<T>() {
  let resolve!: (val: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeOffer(overrides: Partial<UnifiedBatchOffer> & { batchOfferKey: string; sourceOfferId: string }): UnifiedBatchOffer {
  return {
    leafletId: 'l1',
    supermarketName: 'Panda',
    sourcePage: 1,
    titleAr: 'منتج المراعي',
    titleEn: 'Almarai Product',
    brand: 'Almarai',
    variant: 'Plain',
    each_size_value: 500,
    each_size_unit: 'g',
    pack_quantity: 1,
    promoPrice: 10,
    originalPrice: 12,
    assortment_status: 'single_sku',
    isMultiBrandOrVariant: false,
    status: 'extracted',
    ...overrides
  } as UnifiedBatchOffer
}

function makeMockSupabase(rowsByBrand: Record<string, any[]>): SupabaseClient {
  return {
    from: (_table: string) => {
      const state = { filters: [] as Array<{ col: string; val: unknown }> }
      const query: any = {
        select: () => query,
        eq: (col: string, val: unknown) => {
          state.filters.push({ col, val })
          return query
        },
        ilike: (col: string, val: unknown) => {
          state.filters.push({ col, val })
          return query
        },
        or: () => query,
        limit: () => query,
        order: () => query,
        then: (onFulfilled: any) => {
          const allRows = Object.values(rowsByBrand).flat()
          const brandFilter = state.filters.find((f) => f.col === 'brand_name')
          let matched = allRows
          if (brandFilter && typeof brandFilter.val === 'string') {
            const needle = brandFilter.val.replace(/%/g, '').toLowerCase()
            matched = allRows.filter((r) => String(r.brand_name || '').toLowerCase().includes(needle))
          }
          return Promise.resolve({ data: matched, error: null, count: matched.length }).then(onFulfilled)
        }
      }
      return query
    }
  } as unknown as SupabaseClient
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005B: WP3 Flex Reliability, Cancellation, Checkpoints & Spend Cap', () => {
  let tempRoot: string
  let origCwd: string
  let cacheDir: string
  let createdBatchIds: string[] = []

  beforeEach(() => {
    origCwd = process.cwd()
    tempRoot = mkdtempSync(join(tmpdir(), 'wifran-wp3-'))
    cacheDir = join(tempRoot, 'cache')
    createdBatchIds = []
  })

  afterEach(() => {
    process.chdir(origCwd)
    for (const batchId of createdBatchIds) {
      const dir = join(origCwd, 'Extracts', 'batches', batchId)
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  function newOrchestrator(
    mockEvaluator: ConstructorParameters<typeof GeminiMatchingService>[0],
    dirOverride?: string
  ) {
    const cache = new VerifiedMatchCacheService(cacheDir, 'development')
    const gemini = new GeminiMatchingService(mockEvaluator)
    const grouping = new BrandGroupingService()
    const orch = new CatalogMatchingOrchestrator(cache, gemini, grouping)
    if (dirOverride) {
      ;(orch as any).getMatchingDir = (batchId: string) => join(dirOverride, batchId, 'catalog-matching')
    }
    return { orch, cache, gemini }
  }

  const dummyCatalog = {
    almarai: [
      {
        id: '9001',
        brand_name: 'Almarai',
        name_en: 'Almarai Existing Anchor Product',
        name_ar: 'منتج المراعي مرجعي',
        variant_or_flavor: 'Plain',
        each_size_value: 999,
        each_size_unit: 'g',
        inner_pack_count: 1,
        is_active: true,
        verification_status: 'verified'
      }
    ],
    nadec: [
      {
        id: '9002',
        brand_name: 'Nadec',
        name_en: 'Nadec Existing Anchor Product',
        name_ar: 'منتج نادك مرجعي',
        variant_or_flavor: 'Plain',
        each_size_value: 999,
        each_size_unit: 'g',
        inner_pack_count: 1,
        is_active: true,
        verification_status: 'verified'
      }
    ],
    sadia: [
      {
        id: '9003',
        brand_name: 'Sadia',
        name_en: 'Sadia Existing Anchor Product',
        name_ar: 'منتج ساديا مرجعي',
        variant_or_flavor: 'Plain',
        each_size_value: 999,
        each_size_unit: 'g',
        inner_pack_count: 1,
        is_active: true,
        verification_status: 'verified'
      }
    ]
  }

  it('Scenario 1 & 2 & 10: Isolates 504 timeout on Request 1, preserves Request 2 & 3 durable checkpoints, keeps failed offers non-unresolved & unpublishable', async () => {
    const offers = [
      makeOffer({ batchOfferKey: 'o1', sourceOfferId: 'o1', brand: 'Almarai', titleEn: 'Almarai Cheese 200g', titleAr: 'جبنة المراعي', each_size_value: 200 }),
      makeOffer({ batchOfferKey: 'o2', sourceOfferId: 'o2', brand: 'Nadec', titleEn: 'Nadec Laban 1000ml', titleAr: 'لبن نادك', each_size_value: 1000, each_size_unit: 'ml' }),
      makeOffer({ batchOfferKey: 'o3', sourceOfferId: 'o3', brand: 'Sadia', titleEn: 'Sadia Chicken 900g', titleAr: 'دجاج ساديا', each_size_value: 900 })
    ]
    const seenBrands: string[] = []
    let midRunDiskCheckOk = false

    const { orch } = newOrchestrator(async (req) => {
      seenBrands.push(req.brandKey)
      if (req.brandKey === 'almarai') {
        throw Object.assign(new Error('504 DEADLINE_EXCEEDED from Vertex AI Flex'), { status: 504 })
      }
      if (req.brandKey === 'sadia') {
        // Verify Request 2 (nadec) was already persisted durably BEFORE Request 3 starts
        const onDisk = JSON.parse(readFileSync(orch.getManifestPath('b_iso'), 'utf8'))
        const nadecReq = Object.values(onDisk.requests || {}).find((r: any) => r.brandKey === 'nadec') as any
        midRunDiskCheckOk = Boolean(nadecReq?.executionStatus === 'completed' && nadecReq?.validated && nadecReq?.responseArtifactRef)
      }
      return { matches: [{ source_id: '1', product_id: 't1' }] }
    }, tempRoot)

    const manifest = await orch.executeMatchingRun({
      batchId: 'b_iso',
      offers,
      supabase: makeMockSupabase(dummyCatalog)
    })

    expect(midRunDiskCheckOk).toBe(true)
    expect(seenBrands).toEqual(['almarai', 'nadec', 'sadia'])
    expect(manifest.status).toBe('completed_with_failures')

    const reqs = Object.values(manifest.requests!)
    const almaraiReq = reqs.find((r) => r.brandKey === 'almarai')!
    const nadecReq = reqs.find((r) => r.brandKey === 'nadec')!
    const sadiaReq = reqs.find((r) => r.brandKey === 'sadia')!

    expect(almaraiReq.executionStatus).toBe('outcome_unknown')
    expect(almaraiReq.validated).toBe(false)
    expect(almaraiReq.uncertainBillingWarning).toContain('Vertex AI may still have processed')
    expect(nadecReq.executionStatus).toBe('completed')
    expect(sadiaReq.executionStatus).toBe('completed')
    expect(existsSync(join(orch.getMatchingDir('b_iso'), nadecReq.responseArtifactRef!))).toBe(true)

    // Failed offer MUST NOT receive fake semantic 'unresolved' proposal
    expect(manifest.proposals['o1']).toBeUndefined()
    expect(manifest.proposals['o2']?.decision).toBe('temporary')
    expect(manifest.proposals['o3']?.decision).toBe('temporary')

    // Publication preflight MUST block until failed/uncertain requests are resolved/retried
    const pub = new CatalogPublicationService(new VerifiedMatchCacheService(cacheDir, 'development'))
    const preflight = await pub.assessPublicationPreflight({
      manifest,
      offers,
      context: 'DEVELOPMENT_TEST'
    })
    expect(preflight.ready).toBe(false)
    expect(preflight.incompleteOrFailedRequestsCount).toBe(1)
    expect(preflight.blockingReasons.some((r) => r.includes('INCOMPLETE_MATCHING_EXECUTION'))).toBe(true)
  })

  it('Scenario 3 & 4 & 5: Crash recovery transitions in_progress -> outcome_unknown; resume skips completed requests; t1 scopes safely across requests', async () => {
    const offers = [
      makeOffer({ batchOfferKey: 'o1', sourceOfferId: 'o1', brand: 'Almarai', titleEn: 'Almarai Cheese 200g', titleAr: 'جبنة المراعي', each_size_value: 200 }),
      makeOffer({ batchOfferKey: 'o2', sourceOfferId: 'o2', brand: 'Nadec', titleEn: 'Nadec Yogurt 170g', titleAr: 'زبادي نادك', each_size_value: 170 })
    ]

    let callCount = 0
    const { orch } = newOrchestrator(async (_req) => {
      callCount++
      // Both requests independently emit "t1" from Gemini!
      return { matches: [{ source_id: '1', product_id: 't1' }] }
    }, tempRoot)

    // Simulate interruption after Almarai completed and while Nadec was in_progress
    const initial = await orch.executeMatchingRun({
      batchId: 'b_crash',
      offers: [offers[0]],
      supabase: makeMockSupabase(dummyCatalog)
    })
    expect(callCount).toBe(1)

    // Preserve operator approval on Request 1 before simulated crash
    orch.applyOperatorDecision({
      batchId: 'b_crash',
      temporaryId: initial.proposals['o1'].temporaryId!,
      decision: 'approved'
    })

    // Write crashed manifest containing an in_progress Nadec request without recorded response
    const crashed = orch.loadManifest('b_crash')!
    const nadecKey = 'req_nadec_c1_simcrash'
    crashed.status = 'running'
    crashed.requestOrder = [...(crashed.requestOrder || []), nadecKey]
    crashed.requests![nadecKey] = {
      requestKey: nadecKey,
      batchId: 'b_crash',
      runId: 'run_crashed',
      brandKey: 'nadec',
      brandName: 'Nadec',
      chunkIndex: 1,
      totalChunksInBrand: 1,
      chunkSize: 40,
      identityKeys: [
        new BrandGroupingService().extractNormalizedAttributes(offers[1]).brandKey + ':crashed'
      ],
      sourceOfferKeys: ['o2'],
      sourceIds: ['1'],
      requestConfig: { model: 'gemini-3.8-flash', thinkingLevel: 'MEDIUM', executionTier: 'flex', location: 'global', timeoutMs: 600_000 },
      executionStatus: 'in_progress',
      attemptCount: 1,
      attempts: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      usageMetadata: null,
      estimatedCostUsd: 0.001,
      responseArtifactRef: null,
      validated: false
    }
    orch.saveManifestAtomic(crashed)

    // Reload recovers interrupted in_progress -> outcome_unknown
    const recovered = orch.loadManifest('b_crash')!
    expect(recovered.requests![nadecKey].executionStatus).toBe('outcome_unknown')
    expect(recovered.requests![nadecKey].error?.code).toBe('INTERRUPTED_IN_FLIGHT')
    expect(recovered.status).toBe('completed_with_failures')

    // Plain resume must NOT auto-retry Almarai (completed) OR auto-retry outcome_unknown Nadec
    const resumed = await orch.executeMatchingRun({
      batchId: 'b_crash',
      offers: [offers[0]],
      supabase: makeMockSupabase(dummyCatalog),
      mode: 'resume'
    })
    expect(callCount).toBe(1) // ZERO duplicate Gemini calls
    expect(resumed.temporaryProducts[initial.proposals['o1'].temporaryId!].operatorDecision).toBe('approved')

    // Now test distinct t1 reconciliation across two separate completed requests
    const { orch: orchT1 } = newOrchestrator(async () => ({
      matches: [{ source_id: '1', product_id: 't1' }]
    }), tempRoot)
    const t1Manifest = await orchT1.executeMatchingRun({
      batchId: 'b_t1_iso',
      offers,
      supabase: makeMockSupabase(dummyCatalog)
    })
    const tempId1 = t1Manifest.proposals['o1'].temporaryId
    const tempId2 = t1Manifest.proposals['o2'].temporaryId
    expect(tempId1).toBeTruthy()
    expect(tempId2).toBeTruthy()
    expect(tempId1).not.toBe(tempId2) // Request 2's "t1" MUST NOT merge into Request 1's "t1"
    expect(Object.keys(t1Manifest.temporaryProducts)).toHaveLength(2)
  })

  it('Scenario 6: Pause after current request completes in-flight Request 1 and leaves Request 2 pending', async () => {
    const offers = [
      makeOffer({ batchOfferKey: 'o1', sourceOfferId: 'o1', brand: 'Almarai', titleEn: 'Almarai Cheese 200g', titleAr: 'جبنة المراعي', each_size_value: 200 }),
      makeOffer({ batchOfferKey: 'o2', sourceOfferId: 'o2', brand: 'Nadec', titleEn: 'Nadec Laban 1000ml', titleAr: 'لبن نادك', each_size_value: 1000, each_size_unit: 'ml' })
    ]

    const req1Started = createDeferred<void>()
    const req1Finish = createDeferred<{ matches: Array<{ source_id: string; product_id: string }> }>()
    const dispatched: string[] = []

    const { orch } = newOrchestrator(async (req) => {
      dispatched.push(req.brandKey)
      if (req.brandKey === 'almarai') {
        req1Started.resolve()
        return await req1Finish.promise
      }
      return { matches: [{ source_id: '1', product_id: 't1' }] }
    }, tempRoot)

    const runPromise = orch.executeMatchingRun({
      batchId: 'b_pause',
      offers,
      supabase: makeMockSupabase(dummyCatalog)
    })

    await req1Started.promise
    const pauseAck = orch.requestPause('b_pause')
    expect(pauseAck.accepted).toBe(true)

    req1Finish.resolve({ matches: [{ source_id: '1', product_id: 't1' }] })
    const pausedManifest = await runPromise

    expect(dispatched).toEqual(['almarai'])
    expect(pausedManifest.status).toBe('paused')
    const reqs = Object.values(pausedManifest.requests!)
    expect(reqs.find((r) => r.brandKey === 'almarai')?.executionStatus).toBe('completed')
    expect(reqs.find((r) => r.brandKey === 'nadec')?.executionStatus).toBe('pending')

    // Resuming later runs ONLY pending Nadec without repeating Almarai
    const completedManifest = await orch.executeMatchingRun({
      batchId: 'b_pause',
      offers,
      supabase: makeMockSupabase(dummyCatalog),
      mode: 'resume'
    })
    expect(dispatched).toEqual(['almarai', 'nadec'])
    expect(completedManifest.status).toBe('completed')
  })

  it('Scenario 7: Cancel current operation triggers AbortSignal, marks in-flight outcome_unknown, leaves unstarted pending', async () => {
    const offers = [
      makeOffer({ batchOfferKey: 'o1', sourceOfferId: 'o1', brand: 'Almarai', titleEn: 'Almarai Cheese 200g', titleAr: 'جبنة المراعي', each_size_value: 200 }),
      makeOffer({ batchOfferKey: 'o2', sourceOfferId: 'o2', brand: 'Nadec', titleEn: 'Nadec Laban 1000ml', titleAr: 'لبن نادك', each_size_value: 1000, each_size_unit: 'ml' })
    ]

    const req1Started = createDeferred<void>()
    let observedAbortSignal = false
    const dispatched: string[] = []

    const { orch } = newOrchestrator(async (req) => {
      dispatched.push(req.brandKey)
      req.abortSignal?.addEventListener('abort', () => {
        observedAbortSignal = true
      })
      req1Started.resolve()
      // Never resolves on its own unless aborted by wrapper
      return await new Promise(() => {})
    }, tempRoot)

    const runPromise = orch.executeMatchingRun({
      batchId: 'b_cancel',
      offers,
      supabase: makeMockSupabase(dummyCatalog)
    })

    await req1Started.promise
    const cancelAck = orch.requestCancel('b_cancel')
    expect(cancelAck.accepted).toBe(true)

    const cancelledManifest = await runPromise
    expect(observedAbortSignal).toBe(true)
    expect(dispatched).toEqual(['almarai'])
    expect(cancelledManifest.status).toBe('cancelled')

    const almaraiReq = Object.values(cancelledManifest.requests!).find((r) => r.brandKey === 'almarai')!
    const nadecReq = Object.values(cancelledManifest.requests!).find((r) => r.brandKey === 'nadec')!
    expect(almaraiReq.executionStatus).toBe('outcome_unknown')
    expect(almaraiReq.uncertainBillingWarning).toBeTruthy()
    expect(nadecReq.executionStatus).toBe('pending')
    expect(cancelledManifest.proposals['o1']).toBeUndefined()
  })

  it('Scenario 8: Retry Failed Only requires explicit auth, preserves completed + temp groups + operator approvals, retries only failed', async () => {
    const offers = [
      makeOffer({ batchOfferKey: 'o1', sourceOfferId: 'o1', brand: 'Almarai', titleEn: 'Almarai Cheese 200g', titleAr: 'جبنة المراعي', each_size_value: 200 }),
      makeOffer({ batchOfferKey: 'o2', sourceOfferId: 'o2', brand: 'Nadec', titleEn: 'Nadec Laban 1000ml', titleAr: 'لبن نادك', each_size_value: 1000, each_size_unit: 'ml' })
    ]
    let failAlmarai = true
    const calls: string[] = []

    const { orch } = newOrchestrator(async (req) => {
      calls.push(req.brandKey)
      if (req.brandKey === 'almarai' && failAlmarai) {
        throw Object.assign(new Error('504 DEADLINE_EXCEEDED'), { status: 504 })
      }
      return { matches: [{ source_id: '1', product_id: 't1' }] }
    }, tempRoot)

    const firstRun = await orch.executeMatchingRun({
      batchId: 'b_retry',
      offers,
      supabase: makeMockSupabase(dummyCatalog)
    })
    expect(firstRun.status).toBe('completed_with_failures')

    const nadecTempId = firstRun.proposals['o2'].temporaryId!
    orch.applyOperatorDecision({
      batchId: 'b_retry',
      temporaryId: nadecTempId,
      decision: 'approved'
    })

    const summary = orch.getRetryFailedPreflightSummary('b_retry')
    expect(summary.eligibleCount).toBe(1)
    expect(summary.completedExcludedCount).toBe(1)
    expect(summary.hasUncertainPreviousAttempts).toBe(true)
    expect(summary.uncertainBillingWarning).toContain('504')

    // Refuses un-authorized retry
    await expect(
      orch.retryFailedOnly({
        batchId: 'b_retry',
        offers,
        supabase: makeMockSupabase(dummyCatalog),
        approvedByOperator: false,
        approvedMaxBudgetUsd: 0.05
      })
    ).rejects.toThrow(/RETRY_AUTHORIZATION_REQUIRED/)

    await expect(
      orch.retryFailedOnly({
        batchId: 'b_retry',
        offers,
        supabase: makeMockSupabase(dummyCatalog),
        approvedByOperator: true,
        approvedMaxBudgetUsd: 0
      })
    ).rejects.toThrow(/RETRY_AUTHORIZATION_REQUIRED/)

    // Authorized Retry Failed Only retries ONLY Almarai
    failAlmarai = false
    const retried = await orch.retryFailedOnly({
      batchId: 'b_retry',
      offers,
      supabase: makeMockSupabase(dummyCatalog),
      approvedByOperator: true,
      approvedMaxBudgetUsd: 0.05
    })

    expect(calls).toEqual(['almarai', 'nadec', 'almarai']) // nadec NOT called a second time
    expect(retried.status).toBe('completed')
    const almaraiReq = Object.values(retried.requests!).find((r) => r.brandKey === 'almarai')!
    expect(almaraiReq.attemptCount).toBe(2)
    expect(almaraiReq.attempts).toHaveLength(2)
    expect(almaraiReq.attempts[0].executionStatus).toBe('outcome_unknown')
    expect(almaraiReq.attempts[1].executionStatus).toBe('completed')
    expect(retried.temporaryProducts[nadecTempId].operatorDecision).toBe('approved')
  })

  it('Scenario 9: Pre-request conservative spend-cap gate halts before exceeding approved budget', async () => {
    const offers = [
      makeOffer({ batchOfferKey: 'o1', sourceOfferId: 'o1', brand: 'Almarai', titleEn: 'Almarai Cheese 200g', titleAr: 'جبنة المراعي', each_size_value: 200 }),
      makeOffer({ batchOfferKey: 'o2', sourceOfferId: 'o2', brand: 'Nadec', titleEn: 'Nadec Laban 1000ml', titleAr: 'لبن نادك', each_size_value: 1000, each_size_unit: 'ml' })
    ]
    const calls: string[] = []
    const { orch } = newOrchestrator(async (req) => {
      calls.push(req.brandKey)
      return { matches: [{ source_id: '1', product_id: 't1' }] }
    }, tempRoot)

    // Single request estimate is ~$0.00109. Cap of $0.0015 allows Request 1 but blocks Request 2 before dispatch!
    const singleEst = orch.estimateSingleRequestCostUsd(1)
    const capAllowingOne = Number((singleEst.maxCostUsd * 1.15).toFixed(6))

    const cappedManifest = await orch.executeMatchingRun({
      batchId: 'b_cap',
      offers,
      supabase: makeMockSupabase(dummyCatalog),
      approvedMaxBudgetUsd: capAllowingOne
    })

    expect(calls).toEqual(['almarai'])
    expect(cappedManifest.status).toBe('stopped_budget_cap')
    expect(cappedManifest.stoppedReason).toContain('ESTIMATED_SPEND_CAP_REACHED')
    const reqs = Object.values(cappedManifest.requests!)
    expect(reqs.find((r) => r.brandKey === 'almarai')?.executionStatus).toBe('completed')
    expect(reqs.find((r) => r.brandKey === 'nadec')?.executionStatus).toBe('pending')
  })

  it('Scenario 11 & 12: Preserves Flex 600s/MEDIUM/global config, zero auto Standard/HIGH fallback, halts safely on systemic error', async () => {
    const gemini = new GeminiMatchingService()
    const cfg = gemini.buildRequestConfig({ validSourceIds: ['1', '2'] })
    expect(cfg.thinkingConfig.thinkingLevel).toBe('MEDIUM')
    expect(cfg.httpOptions.timeout).toBe(600_000)
    expect(cfg.httpOptions.headers['X-Vertex-AI-LLM-Shared-Request-Type']).toBe('flex')

    const sys504 = classifyMatchingError(Object.assign(new Error('504 DEADLINE_EXCEEDED'), { status: 504 }))
    expect(sys504.isSystemic).toBe(false)
    expect(sys504.isUncertainOutcome).toBe(true)

    const sysLoc = classifyMatchingError(new Error('FLEX_REQUIRES_GLOBAL_LOCATION: location="us-central1"'))
    expect(sysLoc.isSystemic).toBe(true)

    // Systemic error on Request 2 halts Request 3 while preserving completed Request 1 checkpoint
    const offers = [
      makeOffer({ batchOfferKey: 'o1', sourceOfferId: 'o1', brand: 'Almarai', titleEn: 'Almarai Cheese 200g', titleAr: 'جبنة المراعي', each_size_value: 200 }),
      makeOffer({ batchOfferKey: 'o2', sourceOfferId: 'o2', brand: 'Nadec', titleEn: 'Nadec Laban 1000ml', titleAr: 'لبن نادك', each_size_value: 1000, each_size_unit: 'ml' }),
      makeOffer({ batchOfferKey: 'o3', sourceOfferId: 'o3', brand: 'Sadia', titleEn: 'Sadia Chicken 900g', titleAr: 'دجاج ساديا', each_size_value: 900 })
    ]
    const calls: string[] = []
    const { orch } = newOrchestrator(async (req) => {
      calls.push(req.brandKey)
      if (req.brandKey === 'nadec') {
        throw new Error('FLEX_REQUIRES_GLOBAL_LOCATION: Refusing non-global region.')
      }
      return { matches: [{ source_id: '1', product_id: 't1' }] }
    }, tempRoot)

    const sysManifest = await orch.executeMatchingRun({
      batchId: 'b_sys',
      offers,
      supabase: makeMockSupabase(dummyCatalog)
    })

    expect(calls).toEqual(['almarai', 'nadec']) // sadia never called after systemic halt
    expect(sysManifest.status).toBe('failed')
    expect(sysManifest.error).toContain('FLEX_REQUIRES_GLOBAL_LOCATION')
    expect(Object.values(sysManifest.requests!).find((r) => r.brandKey === 'almarai')?.executionStatus).toBe('completed')
    expect(Object.values(sysManifest.requests!).find((r) => r.brandKey === 'nadec')?.executionStatus).toBe('failed')
    expect(Object.values(sysManifest.requests!).find((r) => r.brandKey === 'sadia')?.executionStatus).toBe('pending')
  })

  it('Scenario 13 & 14: Live progress phases/telemetry, fail-closed approval gates & WP1 §1.A/§1.B safety preservation', async () => {
    const offers = [
      makeOffer({
        batchOfferKey: 'o1',
        sourceOfferId: 'o1',
        brand: 'Almarai',
        titleEn: 'Almarai Cheese 200g',
        titleAr: 'جبنة المراعي',
        each_size_value: 200,
        supermarketId: 'c2cc16c2-0006-4444-b000-c00000000001',
        locationScope: 'national',
        offerStartDate: '2026-11-11',
        offerEndDate: '2026-11-25'
      })
    ]
    const phasesSeen: string[] = []
    let latestEvent: MatchingProgressEvent | null = null

    const { orch, cache } = newOrchestrator(async () => ({
      matches: [{ source_id: '1', product_id: 't1' }]
    }), tempRoot)

    const manifest = await orch.executeMatchingRun({
      batchId: 'b_prog',
      offers,
      supabase: makeMockSupabase(dummyCatalog),
      approvedMaxBudgetUsd: 0.05,
      progressCallback: (_txt, _pct, details) => {
        if (details?.phase) phasesSeen.push(details.phase)
        if (details) latestEvent = details
      }
    })

    expect(phasesSeen).toContain('Preparing candidates')
    expect(phasesSeen).toContain('Waiting for Gemini / Flex processing')
    expect(phasesSeen).toContain('Validating response')
    expect(phasesSeen).toContain('Saving checkpoint')
    expect(phasesSeen).toContain('Completed')
    expect(latestEvent!.completedRequests).toBe(1)
    expect(latestEvent!.totalRequests).toBe(1)
    expect(latestEvent!.cumulativeObservedCostUsd).toBeGreaterThan(0)
    expect(latestEvent!.remainingEstimatedBudgetUsd).toBeLessThan(0.05)

    // Unambiguous temporary product defaults to Ready; PRODUCTION_UI remains fail-closed
    const pub = new CatalogPublicationService(cache)
    const devPreflight = await pub.assessPublicationPreflight({
      manifest,
      offers,
      context: 'DEVELOPMENT_TEST'
    })
    expect(devPreflight.ready).toBe(true)
    expect(devPreflight.newProductsToCreateCount).toBe(1)

    const prodPreflight = await pub.assessPublicationPreflight({
      manifest,
      offers,
      context: 'PRODUCTION_UI'
    })
    expect(prodPreflight.ready).toBe(false)
    expect(prodPreflight.blockingReasons.some((r) => r.includes('PRODUCTION_PUBLICATION_BLOCKED'))).toBe(true)

    // WP1 §1.A & §1.B safety sanity checks
    const grouping = new BrandGroupingService()
    const coca4x1Pcs = makeOffer({
      batchOfferKey: 'coca',
      sourceOfferId: 'othaim-week24_002_004',
      brand: 'Coca-Cola',
      titleEn: 'Coca Cola 4x1 pcs',
      titleAr: 'كوكا كولا بلاستيك',
      each_size_value: 1,
      each_size_unit: 'pcs',
      inner_pack_count: 4,
      variantOrFlavor: null
    })
    const sufCoca = evaluateIdentitySufficiency(grouping.extractNormalizedAttributes(coca4x1Pcs), coca4x1Pcs)
    expect(sufCoca.isSufficient).toBe(false)
    expect(sufCoca.codes).toContain('MISSING_UNIT_SIZE')

    const zeroSugarOffer = makeOffer({
      batchOfferKey: 'zs',
      sourceOfferId: 'zs',
      brand: 'Coca-Cola',
      titleEn: 'Coca Cola Sugar Free 320ml',
      titleAr: 'كوكا كولا خالي من السكر',
      each_size_value: 320,
      each_size_unit: 'ml'
    })
    const regColaOffer = makeOffer({
      batchOfferKey: 'reg',
      sourceOfferId: 'reg',
      brand: 'Coca-Cola',
      titleEn: 'Coca Cola 320ml',
      titleAr: 'كوكا كولا',
      each_size_value: 320,
      each_size_unit: 'ml',
      variantOrFlavor: null
    })
    const tempReg = new TemporaryProductRegistry('wp1_check')
    const zsRes = tempReg.reconcileTemporaryOffer({
      requestTempRef: 't1',
      requestScopedMap: new Map(),
      attrs: grouping.extractNormalizedAttributes(zeroSugarOffer),
      sourceOffer: zeroSugarOffer
    })
    const regRes = tempReg.reconcileTemporaryOffer({
      requestTempRef: 't2',
      requestScopedMap: new Map(),
      attrs: grouping.extractNormalizedAttributes(regColaOffer),
      sourceOffer: regColaOffer
    })
    expect(zsRes.temporaryId).not.toBe(regRes.temporaryId)
  })
})
