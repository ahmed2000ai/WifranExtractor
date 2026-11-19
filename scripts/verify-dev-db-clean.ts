import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import {
  getGuardedSupabaseClient,
  createGuardedPgClient,
  DEVELOPMENT_PROJECT_REF
} from '../src/main/db/databaseEnvironmentResolver'

async function verifyDevDb() {
  console.log(`[Dev DB Clean Check] Target Development Project Ref: ${DEVELOPMENT_PROJECT_REF}`)
  
  // 1. Check via Supabase REST API (HTTPS port 443 - zero socket hang risk)
  console.log('[Dev DB Clean Check] Verifying via Guarded Supabase REST Client...')
  const supabase = getGuardedSupabaseClient('DEVELOPMENT_TEST')
  
  const { count: prodCount, error: prodErr } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
  
  if (prodErr) {
    console.error('[Dev DB Clean Check] Error counting products:', prodErr)
  } else {
    console.log(`[Dev DB Clean Check] public.products count: ${prodCount}`)
  }

  const { count: offerCount, error: offerErr } = await supabase
    .from('offers')
    .select('id', { count: 'exact', head: true })

  if (offerErr) {
    console.error('[Dev DB Clean Check] Error counting offers:', offerErr)
  } else {
    console.log(`[Dev DB Clean Check] public.offers count: ${offerCount}`)
  }

  // 2. Also check via pg client with explicit connectionTimeoutMillis
  console.log('[Dev DB Clean Check] Verifying via Guarded pg.Client...')
  const pgClient = createGuardedPgClient('DEVELOPMENT_TEST')
  // Configure client timeout
  ;(pgClient as any).connectionTimeoutMillis = 5000

  let pgConnected = false
  try {
    const connectPromise = pgClient.connect()
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timed out after 5000ms')), 5000)
    )
    await Promise.race([connectPromise, timeoutPromise])
    pgConnected = true
    console.log('[Dev DB Clean Check] Connected to PostgreSQL direct!')

    const { rows: prodRows } = await pgClient.query('SELECT count(*) FROM public.products')
    const { rows: offerRows } = await pgClient.query('SELECT count(*) FROM public.offers')
    console.log(`[Dev DB Clean Check] PG query products count: ${prodRows[0].count}`)
    console.log(`[Dev DB Clean Check] PG query offers count: ${offerRows[0].count}`)

    // If any test records remain, clean them up
    if (Number(prodRows[0].count) > 0 || Number(offerRows[0].count) > 0) {
      console.log('[Dev DB Clean Check] Cleaning up remaining test records...')
      await pgClient.query('DELETE FROM public.offers')
      await pgClient.query('DELETE FROM public.products')
      console.log('[Dev DB Clean Check] Cleanup completed.')
    }
  } catch (err: any) {
    console.warn(`[Dev DB Clean Check] PG client warning: ${err.message}`)
  } finally {
    if (pgConnected) {
      try {
        await pgClient.end()
        console.log('[Dev DB Clean Check] PostgreSQL client closed cleanly.')
      } catch {}
    }
  }

  console.log('[Dev DB Clean Check] Final verification complete.')
  process.exit(0)
}

verifyDevDb().catch((err) => {
  console.error('[Dev DB Clean Check] Fatal error:', err)
  process.exit(1)
})

