import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { LiveCatalogMatchingBenchmarkRunner } from '../src/main/ocr/liveCatalogMatchingBenchmarkRunner'
import { createGuardedPgClient } from '../src/main/db/databaseEnvironmentResolver'

async function verifyDevelopmentCleanup() {
  const pgClient = createGuardedPgClient('DEVELOPMENT_TEST')
  await pgClient.connect()
  try {
    await pgClient.query('SET statement_timeout = 8000')
    const productsRes = await pgClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.products WHERE brand_name IN ('Seara', 'Sadia')`
    )
    const totalProductsRes = await pgClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.products`
    )
    const offersRes = await pgClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.offers WHERE title_en ILIKE '%Seara%' OR title_en ILIKE '%Sadia%'`
    )
    const totalOffersRes = await pgClient.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.offers`
    )

    return {
      verifiedAt: new Date().toISOString(),
      targetContext: 'DEVELOPMENT_TEST (gykrbpykjhpyrdrinkuk)',
      searaSadiaProductsCount: Number(productsRes.rows[0]?.count ?? -1),
      totalProductsCount: Number(totalProductsRes.rows[0]?.count ?? -1),
      searaSadiaOffersCount: Number(offersRes.rows[0]?.count ?? -1),
      totalOffersCount: Number(totalOffersRes.rows[0]?.count ?? -1)
    }
  } finally {
    await pgClient.end()
  }
}

async function main() {
  console.log('=========================================================================')
  console.log('  WIFRAN-EXTRACTOR-CATALOG-MATCH-002: AUTHORIZED LIVE BENCHMARK RUNNER   ')
  console.log('=========================================================================')

  const runner = new LiveCatalogMatchingBenchmarkRunner()

  console.log('[1/5] Verifying Environment Isolation...')
  runner.assertEnvironmentIsolation()
  console.log('✓ Development Isolation Verified: gykrbpykjhpyrdrinkuk')

  console.log('[2/5] Verifying Existing Development Catalog IDs...')
  const catalogIdMap = await runner.verifyExistingDevelopmentCatalogIds()
  console.log(`✓ Verified ${catalogIdMap.size} development catalog products:`)
  for (const [name, id] of catalogIdMap.entries()) {
    console.log(`    - ID ${id}: ${name}`)
  }

  console.log('[3/5] Executing Authorized Live Benchmark (MAX 2 Gemini Flex MEDIUM Requests)...')
  const result = await runner.executeAuthorizedLiveBenchmark(catalogIdMap, {
    operatorAuthorizedMaxTwoRequests: true
  })

  const outPath = path.resolve(process.cwd(), 'Extracts', 'live_benchmark_execution_result.json')
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
  console.log(`✓ Saved full execution result to: ${outPath}`)

  console.log('\n[4/5] Summary Telemetry:')
  console.log(`• Requests Executed: ${result.totals.requestsExecuted} (max 2)`)
  console.log(`• Input Tokens: ${result.totals.totalInputTokens}`)
  console.log(`• Output Tokens: ${result.totals.totalOutputTokens}`)
  console.log(`• Thinking Tokens: ${result.totals.totalThinkingTokens}`)
  console.log(`• Total Tokens: ${result.totals.totalTokens}`)
  console.log(`• Total Flex Cost: $${result.totals.totalCostUsd.toFixed(6)} USD (within $0.05 cap: ${result.totals.withinBudgetCap})`)
  console.log(`• Latency: sum=${result.totals.totalLatencyMs}ms, wall=${result.totals.wallDurationMs}ms`)
  console.log(
    `• Gemini-Evaluated Subset (${result.metricsPartitioned.geminiEvaluatedSubset.count}): ${result.metricsPartitioned.geminiEvaluatedSubset.correctCount}/${result.metricsPartitioned.geminiEvaluatedSubset.count} (${(result.metricsPartitioned.geminiEvaluatedSubset.accuracy * 100).toFixed(1)}%), false existing=${result.metricsPartitioned.geminiEvaluatedSubset.falseExistingMatchesCount}, val rejects=${result.metricsPartitioned.geminiEvaluatedSubset.validationRejectionsCount}`
  )
  console.log(
    `• Locally-Handled Subset (${result.metricsPartitioned.locallyHandledSubset.count}): ${result.metricsPartitioned.locallyHandledSubset.correctCount}/${result.metricsPartitioned.locallyHandledSubset.count} (${(result.metricsPartitioned.locallyHandledSubset.accuracy * 100).toFixed(1)}%), cost=$0.00`
  )
  console.log(
    `• Overall Pipeline (${result.metricsPartitioned.overallPipeline.count}): ${result.metricsPartitioned.overallPipeline.correctCount}/${result.metricsPartitioned.overallPipeline.count} (${(result.metricsPartitioned.overallPipeline.accuracy * 100).toFixed(1)}%)`
  )

  console.log('\n[5/5] Cleaning Up Development Test Records & Verifying Cleanup...')
  await runner.cleanupDevelopmentDatabase()
  const cleanupCheck = await verifyDevelopmentCleanup()
  const cleanupPath = path.resolve(process.cwd(), 'Extracts', 'live_benchmark_cleanup_verification.json')
  fs.writeFileSync(cleanupPath, JSON.stringify(cleanupCheck, null, 2))
  console.log('✓ Cleanup verified:', JSON.stringify(cleanupCheck))
}

main().catch((err) => {
  console.error('Live benchmark execution failed:', err)
  process.exit(1)
})

