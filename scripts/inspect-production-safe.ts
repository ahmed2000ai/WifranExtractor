import { Client } from 'pg'
import path from 'path'
import dotenv from 'dotenv'

// Safely load environment configuration from .env.local and .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

// Safeguard 5: Overall execution deadline (30 seconds)
const deadlineTimeout = setTimeout(() => {
  console.error(`[${new Date().toISOString()}] [DEADLINE_EXCEEDED] Execution reached 30s deadline; terminating immediately.`)
  process.exit(1)
}, 30000)
deadlineTimeout.unref()

function logTimestamp(step: string) {
  console.log(`[${new Date().toISOString()}] ${step}`)
}

async function runSafeInspection() {
  logTimestamp('Starting safe database inspection script')

  // Derive connection parameters without logging credentials
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
  let port = Number(process.env.SUPABASE_DB_PORT) || 5432
  let user = process.env.SUPABASE_DB_USER || 'postgres'
  let database = process.env.SUPABASE_DB_NAME || 'postgres'
  let password = process.env.SUPABASE_DB_PASSWORD || ''

  if (process.env.DATABASE_URL) {
    try {
      const parsedUrl = new URL(process.env.DATABASE_URL)
      host = parsedUrl.hostname || host
      port = parsedUrl.port ? Number(parsedUrl.port) : port
      user = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : user
      database = parsedUrl.pathname ? parsedUrl.pathname.replace(/^\//, '') : database
      if (parsedUrl.password) {
        password = decodeURIComponent(parsedUrl.password)
      }
    } catch (urlErr: any) {
      console.error(`[${new Date().toISOString()}] [CONFIG_ERROR] Malformed DATABASE_URL: ${urlErr.message}`)
      process.exit(1)
    }
  }

  if (!host || !password) {
    console.error(`[${new Date().toISOString()}] [CONFIG_ERROR] Database host or password missing from environment.`)
    process.exit(1)
  }

  logTimestamp(`Target host derived: ${host}, database: ${database}, port: ${port}, user: ${user}`)

  const client = new Client({
    host,
    port,
    user,
    database,
    password,
    ssl: { rejectUnauthorized: false }, // Direct connection with TLS
    connectionTimeoutMillis: 10000 // Safeguard 5: 10 seconds connection timeout
  })

  try {
    logTimestamp('Connecting to database...')
    await client.connect()
    logTimestamp('Database connected successfully')

    // Safeguard 5 & 7: 15s statement timeout and strictly read-only transaction
    await client.query("SET statement_timeout = 15000")
    await client.query("BEGIN READ ONLY")
    logTimestamp('Set statement_timeout=15000 and entered READ ONLY transaction')

    // 1. Supermarkets query
    logTimestamp('Executing Query 1: Supermarket records for Noori')
    const smRes = await client.query(`
      SELECT id, name_ar, name_en, slug, is_active, created_at
      FROM public.supermarkets
      WHERE slug ILIKE '%noori%' OR name_en ILIKE '%noori%' OR name_ar ILIKE '%نوري%'
      ORDER BY id
    `)
    logTimestamp(`Query 1 complete. Found ${smRes.rows.length} supermarket record(s)`)
    console.log('Supermarkets:', JSON.stringify(smRes.rows, null, 2))

    // 2. Cities & Regions query
    logTimestamp('Executing Query 2: Location records for Jeddah and Western Region')
    const cityRes = await client.query(`
      SELECT id, name_ar, name_en, slug, code, region_id
      FROM public.cities
      WHERE slug ILIKE '%jeddah%' OR name_en ILIKE '%jeddah%' OR name_ar ILIKE '%جدة%'
    `)
    const regRes = await client.query(`
      SELECT id, name_ar, name_en, slug, code
      FROM public.regions
      WHERE slug ILIKE '%west%' OR name_en ILIKE '%west%' OR name_ar ILIKE '%غربية%'
    `)
    logTimestamp(`Query 2 complete. Found ${cityRes.rows.length} city row(s) and ${regRes.rows.length} region row(s)`)
    console.log('Cities:', JSON.stringify(cityRes.rows, null, 2))
    console.log('Regions:', JSON.stringify(regRes.rows, null, 2))

    // 3. Public tables query
    logTimestamp('Executing Query 3: Audit of all public tables')
    const tableRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    logTimestamp(`Query 3 complete. Found ${tableRes.rows.length} public table(s)`)
    console.log('Public tables:', tableRes.rows.map(r => r.table_name))

    // 4. Existing Noori Offers query (Comprehensive search across all criteria)
    logTimestamp('Executing Query 4: Detailed search for existing Noori / Phase 1N offers')
    const offRes = await client.query(`
      SELECT 
        id, 
        source_offer_id, 
        supermarket_id, 
        city_id, 
        region_id, 
        title_en, 
        title_ar, 
        original_price, 
        offer_price, 
        discount_percentage,
        inner_pack_count,
        each_size_value,
        each_size_unit,
        sale_unit_type,
        quantity_limit,
        offer_start_date, 
        offer_end_date, 
        product_id, 
        catalog_match_status, 
        status, 
        thumbnail_storage_path, 
        thumbnail_url,
        published_at,
        created_at
      FROM public.offers
      WHERE 
        source_offer_id ILIKE 'noori%' 
        OR supermarket_id = '2a01a099-ab36-4150-90fb-d63f3c18fa6c'
        OR title_en ILIKE '%safi%12x1%'
        OR title_en ILIKE '%fakieh%10x600%'
        OR title_en ILIKE '%shalan%5kg%'
        OR (offer_price = 32.99 AND original_price = 72)
        OR (offer_price = 62.99 AND original_price = 124.95)
        OR (offer_price = 19.99 AND original_price = 49.50)
      ORDER BY created_at ASC
    `)
    logTimestamp(`Query 4 complete. Found ${offRes.rows.length} offer row(s)`)
    console.log('Existing Noori Offers:', JSON.stringify(offRes.rows, null, 2))

    // 4b. Inspect indexes and constraints on public.offers
    logTimestamp('Executing Query 4b: Indexes and unique constraints on public.offers')
    const idxRes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'offers'
      ORDER BY indexname
    `)
    logTimestamp(`Query 4b complete. Found ${idxRes.rows.length} index(es)`)
    console.log('Indexes on public.offers:', JSON.stringify(idxRes.rows, null, 2))

    // 5. Total count of offers in public.offers
    logTimestamp('Executing Query 5: Total offer count in DB')
    const countRes = await client.query(`SELECT count(*)::int AS total FROM public.offers`)
    logTimestamp(`Query 5 complete. Total offers count: ${countRes.rows[0].total}`)

    // 6. Complete catalog inspection (All 8 verified products)
    logTimestamp('Executing Query 6: Verified products in catalog')
    const prodRes = await client.query(`
      SELECT 
        id, 
        canonical_product_key, 
        name_en, 
        name_ar, 
        item_name_complete, 
        brand_name, 
        each_size_value, 
        each_size_unit, 
        inner_pack_count, 
        sale_unit_type, 
        verification_status, 
        approved_primary_image_id
      FROM public.products
      ORDER BY id ASC
    `)
    logTimestamp(`Query 6 complete. Found ${prodRes.rows.length} product(s)`)
    console.log('Products in catalog:', JSON.stringify(prodRes.rows, null, 2))

    // 7. Consumer view projection check for the Noori offers
    logTimestamp('Executing Query 7: v_consumer_offers projection for Noori offers')
    const viewRes = await client.query(`
      SELECT 
        id,
        source_offer_id,
        title_en,
        product_id,
        display_image_url,
        display_image_kind,
        thumbnail_url,
        exact_identity_status
      FROM public.v_consumer_offers
      WHERE source_offer_id ILIKE 'noori%'
      ORDER BY id ASC
    `)
    logTimestamp(`Query 7 complete. Found ${viewRes.rows.length} row(s) in v_consumer_offers`)
    console.log('Consumer view projection:', JSON.stringify(viewRes.rows, null, 2))

    // Rollback read-only transaction cleanly
    await client.query("ROLLBACK")
    logTimestamp('READ ONLY transaction finished cleanly with zero mutations')

  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] [INSPECTION_ERROR] ${err.message}`)
    try { await client.query("ROLLBACK") } catch {}
    process.exit(1)
  } finally {
    logTimestamp('Closing database connection in finally block')
    await client.end()
    logTimestamp('Database connection closed')
  }

  logTimestamp('Inspection script completed successfully')
  process.exit(0)
}

runSafeInspection().catch((err) => {
  console.error(`[${new Date().toISOString()}] Unhandled error:`, err)
  process.exit(1)
})
