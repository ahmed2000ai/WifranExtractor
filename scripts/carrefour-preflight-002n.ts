import { Client } from 'pg'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const deadline = setTimeout(() => {
  console.error('[DEADLINE_EXCEEDED] 25s reached; terminating immediately.')
  process.exit(1)
}, 25000)
deadline.unref()

async function runPreflight002N() {
  console.log('======================================================================')
  console.log('WIFRAN-EXTRACTOR-IDENTITY-002N — READ-ONLY PRODUCTION PREFLIGHT')
  console.log('======================================================================\n')

  let host = process.env.SUPABASE_DB_HOST || ''
  if (!host && process.env.SUPABASE_URL) {
    try {
      const url = new URL(process.env.SUPABASE_URL)
      const projectRef = url.hostname.split('.')[0]
      if (projectRef && url.hostname.endsWith('.supabase.co')) {
        host = `db.${projectRef}.supabase.co`
      }
    } catch {}
  }
  const port = Number(process.env.SUPABASE_DB_PORT) || 5432
  const user = process.env.SUPABASE_DB_USER || 'postgres'
  const database = process.env.SUPABASE_DB_NAME || 'postgres'
  const password = process.env.SUPABASE_DB_PASSWORD || ''

  console.log(`Connecting to database host: ${host}, database: ${database}...`)

  const client = new Client({
    host,
    port,
    user,
    database,
    password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  })

  await client.connect()
  await client.query('SET statement_timeout = 15000')
  await client.query('BEGIN READ ONLY')
  console.log('Connected and entered READ ONLY transaction with 15s statement timeout.\n')

  // 1. Database integrity: Project ref check
  console.log('--- Check 1: Target Database & Project Integrity ---')
  const dbNameRes = await client.query('SELECT current_database(), current_user;')
  console.log('Current database / user:', dbNameRes.rows[0])
  const projectVerified = host.includes('swratbmclahjyekouned')
  console.log(`Project ref 'swratbmclahjyekouned' confirmed in host: ${projectVerified ? 'PASS' : 'FAIL'}`)

  // 2. Offer baseline count
  console.log('\n--- Check 2: Production Offers Baseline ---')
  const countRes = await client.query('SELECT count(*)::int AS total FROM public.offers;')
  const totalOffers = countRes.rows[0].total
  console.log(`Current total offers in public.offers: ${totalOffers} (Baseline: 90) -> ${totalOffers === 90 ? 'PASS' : 'FAIL'}`)

  // 3. Verified catalog associations (exactly 8)
  console.log('\n--- Check 3: Verified Product Associations ---')
  const verifiedRes = await client.query(`
    SELECT id, source_offer_id, product_id, catalog_match_status, title_en
    FROM public.offers
    WHERE product_id IS NOT NULL;
  `)
  console.log(`Verified product links found: ${verifiedRes.rows.length} (Expected: 8) -> ${verifiedRes.rows.length === 8 ? 'PASS' : 'FAIL'}`)

  // 4. Existing 3 Noori Page 1 offers intact
  console.log('\n--- Check 4: Historical Phase 1N Noori Offers Intact ---')
  const nooriRes = await client.query(`
    SELECT id, source_offer_id, title_en, offer_price, status, catalog_match_status
    FROM public.offers
    WHERE id IN (
      'fd865e4e-e9cb-444a-b71a-80c74efc16e4',
      '2ec312c1-634e-4bc0-98f4-ca45681e2a27',
      '3b3915b7-702b-41c0-95e3-464e8fa3b90f'
    )
    ORDER BY source_offer_id;
  `)
  console.log(`Noori historical offers found: ${nooriRes.rows.length} (Expected: 3) -> ${nooriRes.rows.length === 3 ? 'PASS' : 'FAIL'}`)
  for (const n of nooriRes.rows) {
    console.log(`  - [${n.id}] ${n.source_offer_id} | ${n.title_en} | ${n.offer_price} SAR | Status: ${n.status}`)
  }

  // 5. Frozen consumer view: 98 columns
  console.log('\n--- Check 5: Consumer Contract View (v_consumer_offers) ---')
  const vColsRes = await client.query(`
    SELECT count(*)::int AS col_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
  `)
  const colCount = vColsRes.rows[0].col_count
  console.log(`v_consumer_offers column count: ${colCount} (Expected: 98) -> ${colCount === 98 ? 'PASS' : 'FAIL'}`)

  // 6. Migration 009 status: undeployed
  console.log('\n--- Check 6: Migration 009 Status ---')
  const m009FuncRes = await client.query(`
    SELECT count(*)::int AS cnt
    FROM pg_proc
    WHERE proname IN ('stage_product_alias', 'approve_product_alias', 'reject_product_alias');
  `)
  const m009Procs = m009FuncRes.rows[0].cnt
  console.log(`Migration 009 procedures found in pg_proc: ${m009Procs} (Expected: 0) -> ${m009Procs === 0 ? 'PASS (UNDEPLOYED)' : 'FAIL'}`)

  const m009TblRes = await client.query(`
    SELECT count(*)::int AS cnt
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('product_alias_staging', 'product_alias_audit');
  `)
  const m009Tbls = m009TblRes.rows[0].cnt
  console.log(`Migration 009 staging tables found: ${m009Tbls} (Expected: 0) -> ${m009Tbls === 0 ? 'PASS (UNDEPLOYED)' : 'FAIL'}`)

  // 7. Duplicate protection & Collision check for the 3 Carrefour source IDs
  console.log('\n--- Check 7: Collision & Idempotency Audit for Candidate Carrefour Offers ---')
  const targetSourceIds = [
    'carrefour-city-jeddah-2026-11-10:p001:i001:s01',
    'carrefour-city-jeddah-2026-11-10:p001:i002:s01',
    'carrefour-city-jeddah-2026-11-10:p001:i003:s01'
  ]
  const collRes = await client.query(`
    SELECT id, source_offer_id, title_en, supermarket_id
    FROM public.offers
    WHERE source_offer_id = ANY($1::text[])
       OR title_en ILIKE '%Nestle Pure Life Water 330ml x 40%'
       OR title_en ILIKE '%Nadec Cooking Cream 1L%'
       OR title_en ILIKE '%Sadia Frozen Chicken 10x900g%';
  `, [targetSourceIds])
  console.log(`Colliding offers found in public.offers: ${collRes.rows.length} (Expected: 0) -> ${collRes.rows.length === 0 ? 'PASS (ZERO COLLISIONS)' : 'FAIL'}`)

  // 8. Supermarket, City, Region ID verification
  console.log('\n--- Check 8: Retailer and Location Entity IDs ---')
  const smRes = await client.query(`
    SELECT id, name_en, slug, is_active
    FROM public.supermarkets
    WHERE id = 'c2cc16c2-0006-4444-b000-c00000000006';
  `)
  console.log(`Carrefour Supermarket in DB:`, smRes.rows[0])
  const smPass = smRes.rows.length === 1 && smRes.rows[0].is_active === true

  const cityRes = await client.query(`
    SELECT id, name_en, code, region_id
    FROM public.cities
    WHERE id = 'a6f7b140-0002-4444-a000-000000000002';
  `)
  console.log(`Jeddah City in DB:`, cityRes.rows[0])
  const cityPass = cityRes.rows.length === 1

  const regRes = await client.query(`
    SELECT id, name_en, code
    FROM public.regions
    WHERE id = 'b144b6c8-2222-4444-b000-000000000002';
  `)
  console.log(`Western Region in DB:`, regRes.rows[0])
  const regPass = regRes.rows.length === 1

  console.log(`Entity resolution audit: ${smPass && cityPass && regPass ? 'PASS' : 'FAIL'}`)

  await client.query('ROLLBACK')
  await client.end()

  const allPassed =
    projectVerified &&
    totalOffers === 90 &&
    verifiedRes.rows.length === 8 &&
    nooriRes.rows.length === 3 &&
    colCount === 98 &&
    m009Procs === 0 &&
    m009Tbls === 0 &&
    collRes.rows.length === 0 &&
    smPass &&
    cityPass &&
    regPass

  console.log('\n======================================================================')
  console.log(`PREFLIGHT VERDICT: ${allPassed ? 'ALL PREFLIGHT CHECKS PASSED (100% READY)' : 'FAILED PREFLIGHT DETECTED'}`)
  console.log('======================================================================')

  if (!allPassed) {
    process.exit(1)
  }
}

runPreflight002N().catch(err => {
  console.error('Preflight error:', err)
  process.exit(1)
})

