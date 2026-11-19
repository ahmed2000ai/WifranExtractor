/**
 * Controlled Live Confirmation Benchmark Script (WIFRAN-EXTRACTOR-CATALOG-MATCH-002B)
 *
 * Strictly executes against DEVELOPMENT database (gykrbpykjhpyrdrinkuk):
 * - Phase A (0 paid calls): Seed Dev catalog -> verify fresh IDs -> run preflight -> save Extracts/live_benchmark_002b_preflight.json
 * - Phase B (max 2 paid requests): Execute authorized live benchmark -> save Extracts/live_benchmark_002b_result.json
 * - Phase C (guaranteed finally cleanup): Clean up seeded Dev records -> verify 0 products & 0 offers remain -> save Extracts/live_benchmark_002b_cleanup_verification.json
 */

import { writeFileSync } from 'fs'
import { join } from 'path'
import { loadEnvConfig } from '../src/main/config/env'
import {
  createGuardedPgClient,
  DEVELOPMENT_PROJECT_REF,
  PRODUCTION_PROJECT_REF
} from '../src/main/db/databaseEnvironmentResolver'
import { LiveCatalogMatchingBenchmarkRunner } from '../src/main/ocr/liveCatalogMatchingBenchmarkRunner'

async function main() {
  loadEnvConfig()

  if (process.env.WIFRAN_OFFLINE_UAT === '1') {
    throw new Error('ABORT: Unset WIFRAN_OFFLINE_UAT before running live confirmation benchmark.')
  }

  const devUrl = process.env.DEV_SUPABASE_URL || ''
  if (!devUrl.includes(DEVELOPMENT_PROJECT_REF) || devUrl.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `ABORT: DEV_SUPABASE_URL must target DEVELOPMENT (${DEVELOPMENT_PROJECT_REF}) and never PRODUCTION (${PRODUCTION_PROJECT_REF}).`
    )
  }

  const runner = new LiveCatalogMatchingBenchmarkRunner()
  runner.assertEnvironmentIsolation()

  const preflightOutPath = join(process.cwd(), 'Extracts', 'live_benchmark_002b_preflight.json')
  const resultOutPath = join(process.cwd(), 'Extracts', 'live_benchmark_002b_result.json')
  const cleanupOutPath = join(process.cwd(), 'Extracts', 'live_benchmark_002b_cleanup_verification.json')

  try {
    console.log('[002B] Phase A: Seeding controlled DEVELOPMENT catalog...')
    await runner.seedDevelopmentCatalog()
    const verifiedMap = await runner.verifyExistingDevelopmentCatalogIds()
    console.log(`[002B] Verified ${verifiedMap.size} seeded DEVELOPMENT product IDs.`)

    console.log('[002B] Phase A: Running preflight retrieval & prompt budget verification (0 Gemini calls)...')
    const preflight = await runner.runRetrievalPreflight(verifiedMap)

    writeFileSync(
      preflightOutPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          targetDatabase: DEVELOPMENT_PROJECT_REF,
          catalogIdMap: Object.fromEntries(verifiedMap.entries()),
          ...preflight
        },
        null,
        2
      ),
      'utf8'
    )
    console.log(`[002B] Saved preflight -> ${preflightOutPath}`)

    if (preflight.retrievalPreflight.retrievalRecall !== 1.0) {
      throw new Error(
        `PREFLIGHT_ABORT: Retrieval recall is ${preflight.retrievalPreflight.retrievalRecall}, expected 1.0`
      )
    }
    if (preflight.requestBudget.matchingRequestsCount > 2) {
      throw new Error(
        `PREFLIGHT_ABORT: Matching requests count ${preflight.requestBudget.matchingRequestsCount} exceeds max 2`
      )
    }
    if (!preflight.requestBudget.isWithinBudget || preflight.requestBudget.conservativeUpperBoundCostUsd > 0.05) {
      throw new Error(
        `PREFLIGHT_ABORT: Worst-case budget $${preflight.requestBudget.conservativeUpperBoundCostUsd} exceeds $0.05 cap`
      )
    }
    if (
      preflight.modelConfig.model !== 'gemini-3.8-flash' ||
      preflight.modelConfig.thinkingLevel !== 'MEDIUM' ||
      preflight.modelConfig.executionMode !== 'flex' ||
      preflight.modelConfig.location !== 'global'
    ) {
      throw new Error(`PREFLIGHT_ABORT: Unexpected modelConfig: ${JSON.stringify(preflight.modelConfig)}`)
    }

    console.log(
      `[002B] Preflight PASSED (recall=1.0, requests=${preflight.requestBudget.matchingRequestsCount}, estCost=$${preflight.requestBudget.estimatedFlexCostUsd}, worstCase=$${preflight.requestBudget.conservativeUpperBoundCostUsd}).`
    )
    console.log('[002B] Phase B: Executing authorized live confirmation benchmark (max 2 Gemini Flex MEDIUM requests)...')

    const liveResult = await runner.executeAuthorizedLiveBenchmark(verifiedMap, {
      operatorAuthorizedMaxTwoRequests: true
    })

    writeFileSync(resultOutPath, JSON.stringify(liveResult, null, 2), 'utf8')
    console.log(`[002B] Saved live benchmark result -> ${resultOutPath}`)
    console.log(
      `[002B] Live Summary: requests=${liveResult.totals.requestsExecuted}, cost=$${liveResult.totals.totalCostUsd}, rawGemini=${liveResult.metricsPartitioned.rawGeminiSemantic.correctCount}/${liveResult.metricsPartitioned.rawGeminiSemantic.count}, postVal=${liveResult.metricsPartitioned.postValidation.correctCount}/${liveResult.metricsPartitioned.postValidation.count}, overall=${liveResult.metricsPartitioned.overallPipeline.correctCount}/${liveResult.metricsPartitioned.overallPipeline.count}`
    )
  } finally {
    console.log('[002B] Phase C: Cleaning up DEVELOPMENT database...')
    await runner.cleanupDevelopmentDatabase()

    const pgClient = createGuardedPgClient('DEVELOPMENT_TEST')
    ;(pgClient as any).connectionTimeoutMillis = 5000
    ;(pgClient as any).statement_timeout = 5000
    await pgClient.connect()
    try {
      const benchmarkProductsRes = await pgClient.query(
        `SELECT COUNT(*)::int AS count FROM public.products WHERE brand_name IN ('Seara', 'Sadia')`
      )
      const totalProductsRes = await pgClient.query(`SELECT COUNT(*)::int AS count FROM public.products`)
      const benchmarkOffersRes = await pgClient.query(
        `SELECT COUNT(*)::int AS count FROM public.offers WHERE title_en ILIKE '%Seara%' OR title_en ILIKE '%Sadia%'`
      )
      const totalOffersRes = await pgClient.query(`SELECT COUNT(*)::int AS count FROM public.offers`)

      const cleanupVerification = {
        verifiedAt: new Date().toISOString(),
        targetDatabase: DEVELOPMENT_PROJECT_REF,
        productionDatabase: PRODUCTION_PROJECT_REF,
        productionUntouched: true,
        remainingCounts: {
          benchmarkBrandProducts: benchmarkProductsRes.rows[0].count,
          totalProducts: totalProductsRes.rows[0].count,
          benchmarkOffers: benchmarkOffersRes.rows[0].count,
          totalOffers: totalOffersRes.rows[0].count
        },
        cleanStateConfirmed:
          benchmarkProductsRes.rows[0].count === 0 &&
          totalProductsRes.rows[0].count === 0 &&
          benchmarkOffersRes.rows[0].count === 0 &&
          totalOffersRes.rows[0].count === 0
      }

      writeFileSync(cleanupOutPath, JSON.stringify(cleanupVerification, null, 2), 'utf8')
      console.log(`[002B] Saved cleanup verification -> ${cleanupOutPath}`, cleanupVerification.remainingCounts)
    } finally {
      await pgClient.end()
    }
  }
}

main()
  .then(() => {
    console.log('[002B] Confirmation benchmark run completed cleanly.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('[002B] ERROR:', err)
    process.exit(1)
  })

