import path from 'path'
import dotenv from 'dotenv'
import { Client } from 'pg'
import { getSupabaseAdminClient } from '../src/main/db/supabaseAdminClient'
import { publishStagedLeafletDraftToDb } from '../src/main/db/stagedLeafletDraftService'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const deadline = setTimeout(() => {
  console.error('[DEADLINE_EXCEEDED] 60s reached; terminating immediately.')
  process.exit(1)
}, 60000)
deadline.unref()

async function main() {
  const isAuthorized = process.argv.includes('--authorize')

  console.log('======================================================================')
  console.log('WIFRAN-EXTRACTOR-IDENTITY-002N — CONTROLLED CANARY PUBLISHING RUNNER')
  console.log('======================================================================\n')
  console.log(`Execution Mode: ${isAuthorized ? 'LIVE PRODUCTION PUBLISHING (AUTHORIZED)' : 'DRY-RUN / AUTHORIZATION GATE AUDIT'}`)

  // 1. Mandatory Preflight
  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  })

  await client.connect()
  await client.query('SET statement_timeout = 15000')
  await client.query('BEGIN READ ONLY')

  const countRes = await client.query('SELECT count(*)::int AS total FROM public.offers;')
  const baselineCount = countRes.rows[0].total

  const collRes = await client.query(`
    SELECT id, source_offer_id FROM public.offers
    WHERE source_offer_id IN (
      'carrefour-city-jeddah-2026-11-10:p001:i001:s01',
      'carrefour-city-jeddah-2026-11-10:p001:i002:s01',
      'carrefour-city-jeddah-2026-11-10:p001:i003:s01'
    );
  `)

  await client.query('ROLLBACK')
  await client.end()

  console.log(`Production baseline offers: ${baselineCount} (Expected: 90)`)
  console.log(`Colliding source offers: ${collRes.rows.length} (Expected: 0)`)

  if (baselineCount !== 90 || collRes.rows.length !== 0) {
    throw new Error('Preflight checks failed! Database baseline is invalid or collisions exist. Aborting.')
  }

  if (!isAuthorized) {
    console.log('\n----------------------------------------------------------------------')
    console.log('STATUS: READY FOR EXPLICIT OPERATOR AUTHORIZATION — NO PRODUCTION WRITES EXECUTED')
    console.log('To execute the live canary, invoke with: --authorize')
    console.log('----------------------------------------------------------------------')
    return
  }

  // 2. Execute via Application Service
  console.log('\n--- Executing publishStagedLeafletDraftToDb for tmp/carrefour_canary_002m ---')
  const supabase = getSupabaseAdminClient()
  const jobDir = path.resolve(process.cwd(), 'tmp/carrefour_canary_002m')

  const publishResult = await publishStagedLeafletDraftToDb(jobDir, {
    supabaseClient: supabase,
    operatorConfirmedPublish: true,
    reviewedBy: 'wifran_operator_canary_002n',
    rightsBasis: 'operator_manual_verified',
    onProgress: (p) => {
      console.log(`[Publish Progress] ${p.stage}: ${p.message}`)
    }
  })

  console.log('\nPublish result from stagedLeafletDraftService:')
  console.log(JSON.stringify(publishResult, null, 2))

  if (!publishResult.ok || publishResult.errors.length > 0) {
    throw new Error(`Canary publication encountered errors: ${publishResult.errors.join('; ')}`)
  }

  // 3. Post-Publishing Acceptance Verification
  console.log('\n--- Running Post-Publishing Acceptance Audit ---')
  const auditClient = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  })

  await auditClient.connect()
  await auditClient.query('SET statement_timeout = 15000')
  await auditClient.query('BEGIN READ ONLY')

  // A. Exactly 93 total offers (+3)
  const postCountRes = await auditClient.query('SELECT count(*)::int AS total FROM public.offers;')
  const postTotal = postCountRes.rows[0].total
  console.log(`Post-publish total offers: ${postTotal} (Expected: 93) -> ${postTotal === 93 ? 'PASS' : 'FAIL'}`)

  // B. Exactly 3 Carrefour offers
  const carrefourRes = await auditClient.query(`
    SELECT id, source_offer_id, title_en, offer_price, original_price,
           product_id, catalog_match_status, status, supermarket_id, city_id
    FROM public.offers
    WHERE source_offer_id IN (
      'carrefour-city-jeddah-2026-11-10:p001:i001:s01',
      'carrefour-city-jeddah-2026-11-10:p001:i002:s01',
      'carrefour-city-jeddah-2026-11-10:p001:i003:s01'
    )
    ORDER BY source_offer_id;
  `)
  console.log(`Carrefour offers inserted: ${carrefourRes.rows.length} (Expected: 3) -> ${carrefourRes.rows.length === 3 ? 'PASS' : 'FAIL'}`)
  console.log('Inserted Carrefour Records:')
  console.log(JSON.stringify(carrefourRes.rows, null, 2))

  const allUnresolved = carrefourRes.rows.every(r => r.product_id === null && r.catalog_match_status === 'unresolved' && r.status === 'published')
  console.log(`All 3 Carrefour offers unresolved with product_id=NULL: ${allUnresolved ? 'PASS' : 'FAIL'}`)

  // C. Baseline data protection
  const baseCheckRes = await auditClient.query(`
    SELECT count(*)::int AS cnt FROM public.offers
    WHERE product_id IS NOT NULL;
  `)
  const verifiedCount = baseCheckRes.rows[0].cnt
  console.log(`Verified product links count: ${verifiedCount} (Expected: 8) -> ${verifiedCount === 8 ? 'PASS' : 'FAIL'}`)

  const nooriCheckRes = await auditClient.query(`
    SELECT count(*)::int AS cnt FROM public.offers
    WHERE id IN (
      'fd865e4e-e9cb-444a-b71a-80c74efc16e4',
      '2ec312c1-634e-4bc0-98f4-ca45681e2a27',
      '3b3915b7-702b-41c0-95e3-464e8fa3b90f'
    );
  `)
  const nooriCount = nooriCheckRes.rows[0].cnt
  console.log(`Historical Noori offers intact: ${nooriCount} (Expected: 3) -> ${nooriCount === 3 ? 'PASS' : 'FAIL'}`)

  // D. Consumer view 98 columns and projection
  const viewColsRes = await auditClient.query(`
    SELECT count(*)::int AS cnt FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
  `)
  const viewCols = viewColsRes.rows[0].cnt
  console.log(`Consumer view column count: ${viewCols} (Expected: 98) -> ${viewCols === 98 ? 'PASS' : 'FAIL'}`)

  const viewRowsRes = await auditClient.query(`
    SELECT id, source_offer_id, title_en, product_id, display_image_url, image_url, thumbnail_url
    FROM public.v_consumer_offers
    WHERE source_offer_id IN (
      'carrefour-city-jeddah-2026-11-10:p001:i001:s01',
      'carrefour-city-jeddah-2026-11-10:p001:i002:s01',
      'carrefour-city-jeddah-2026-11-10:p001:i003:s01'
    );
  `)
  console.log(`Carrefour offers in v_consumer_offers: ${viewRowsRes.rows.length} (Expected: 3) -> ${viewRowsRes.rows.length === 3 ? 'PASS' : 'FAIL'}`)
  const viewMasked = viewRowsRes.rows.every(r => r.product_id === null && r.display_image_url === null && r.thumbnail_url === null)
  console.log(`Consumer view masks product IDs and isolates private crops: ${viewMasked ? 'PASS' : 'FAIL'}`)

  // E. RPC verification for shopping date 2026-11-07 in Jeddah
  const rpcRes = await auditClient.query(`
    SELECT id, source_offer_id, title_en, offer_price, supermarket_name_en, city_name_en
    FROM public.get_consumer_offers_for_shopping_date(
      '2026-11-07'::date,
      'a6f7b140-0002-4444-a000-000000000002'::text
    )
    ORDER BY source_offer_id;
  `)
  console.log(`Total active offers in Jeddah returned by RPC: ${rpcRes.rows.length}`)
  const carrefourInRpc = rpcRes.rows.filter(r => r.source_offer_id?.startsWith('carrefour'))
  console.log(`Carrefour offers in RPC: ${carrefourInRpc.length} (Expected: 3) -> ${carrefourInRpc.length === 3 ? 'PASS' : 'FAIL'}`)
  console.log(JSON.stringify(carrefourInRpc, null, 2))

  await auditClient.query('ROLLBACK')
  await auditClient.end()

  const allPassed =
    postTotal === 93 &&
    carrefourRes.rows.length === 3 &&
    allUnresolved &&
    verifiedCount === 8 &&
    nooriCount === 3 &&
    viewCols === 98 &&
    viewRowsRes.rows.length === 3 &&
    viewMasked &&
    carrefourInRpc.length === 3

  console.log('\n======================================================================')
  console.log(`POST-PUBLISH CANARY VERDICT: ${allPassed ? 'ALL ACCEPTANCE ASSERTIONS PASSED (100% SUCCESS)' : 'FAILED ASSERTIONS DETECTED'}`)
  console.log('======================================================================')

  if (!allPassed) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Execution error:', err)
  process.exit(1)
})

