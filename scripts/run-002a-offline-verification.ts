import 'dotenv/config'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { LiveCatalogMatchingBenchmarkRunner } from '../src/main/ocr/liveCatalogMatchingBenchmarkRunner'
import { createGuardedPgClient } from '../src/main/db/databaseEnvironmentResolver'

async function main() {
  // Ensure WIFRAN_OFFLINE_UAT is disabled so DEVELOPMENT_TEST DB client can connect for retrieval preflight
  // while NEVER invoking executeAuthorizedLiveBenchmark (0 paid Gemini calls).
  if (process.env.WIFRAN_OFFLINE_UAT === '1') {
    delete process.env.WIFRAN_OFFLINE_UAT
  }

  const runner = new LiveCatalogMatchingBenchmarkRunner({
    evidenceOverlayPath: join(
      process.cwd(),
      'test-fixtures',
      'matching-benchmarks',
      'verified_evidence_annotations_v1.json'
    )
  })

  // 1. Offline historical replay ($0.00, 0 paid calls)
  const replay = runner.replayHistoricalBenchmarkOffline()
  const replayPath = join(process.cwd(), 'Extracts', 'live_benchmark_offline_replay_002a.json')
  writeFileSync(replayPath, JSON.stringify(replay, null, 2), 'utf8')
  console.log('[002A-Verify] Offline replay saved:', replayPath)
  console.log('[002A-Verify] Replay Gemini Post-Val Accuracy:', replay.replayMetrics.geminiSubsetPostValidation)
  console.log('[002A-Verify] Replay Local Accuracy:', replay.replayMetrics.locallyHandledSubset)
  console.log('[002A-Verify] Replay Overall Accuracy:', replay.replayMetrics.overallPipeline)

  // 2. Seed DEVELOPMENT_TEST catalog -> run 002A retrieval & prompt preflight -> clean up DB
  try {
    const catalogIdMap = await runner.seedDevelopmentCatalog()
    console.log('[002A-Verify] Seeded DEVELOPMENT catalog products:', catalogIdMap.size)

    const preflight = await runner.runRetrievalPreflight(catalogIdMap)
    const preflightPath = join(process.cwd(), 'Extracts', 'live_benchmark_preflight_002a.json')
    writeFileSync(preflightPath, JSON.stringify(preflight, null, 2), 'utf8')
    console.log('[002A-Verify] 002A Preflight saved:', preflightPath)
    console.log('[002A-Verify] Preflight retrieval recall:', preflight.retrievalStats)
    console.log('[002A-Verify] Preflight estimated cost USD:', preflight.costEstimate)
  } finally {
    await runner.cleanupDevelopmentDatabase()
    console.log('[002A-Verify] Cleaned up seeded Seara/Sadia products & offers from DEVELOPMENT_TEST')
  }

  // 3. Verify cleanup counts cleanly with explicit connection timeout & pgClient.end()
  const pgClient = createGuardedPgClient('DEVELOPMENT_TEST')
  ;(pgClient as any).connectionTimeoutMillis = 5000
  await pgClient.connect()
  try {
    const prodRes = await pgClient.query(
      `SELECT count(*)::int AS cnt FROM public.products WHERE brand_name IN ('Seara', 'Sadia')`
    )
    const totalProdRes = await pgClient.query(`SELECT count(*)::int AS cnt FROM public.products`)
    const offersRes = await pgClient.query(
      `SELECT count(*)::int AS cnt FROM public.offers WHERE title_en ILIKE '%Seara%' OR title_en ILIKE '%Sadia%'`
    )
    const totalOffersRes = await pgClient.query(`SELECT count(*)::int AS cnt FROM public.offers`)

    const verification = {
      verifiedAt: new Date().toISOString(),
      environment: 'DEVELOPMENT_TEST',
      searaSadiaProductsCount: prodRes.rows[0].cnt,
      totalProductsCount: totalProdRes.rows[0].cnt,
      searaSadiaOffersCount: offersRes.rows[0].cnt,
      totalOffersCount: totalOffersRes.rows[0].cnt
    }
    const cleanupPath = join(process.cwd(), 'Extracts', 'live_benchmark_cleanup_verification_002a.json')
    writeFileSync(cleanupPath, JSON.stringify(verification, null, 2), 'utf8')
    console.log('[002A-Verify] Cleanup verification:', JSON.stringify(verification))
  } finally {
    await pgClient.end()
  }
}

main().catch((err) => {
  console.error('[002A-Verify] Fatal error:', err)
  process.exit(1)
})

