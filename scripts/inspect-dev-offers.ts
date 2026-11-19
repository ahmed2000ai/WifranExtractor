import { createGuardedPgClient } from '../src/main/db/databaseEnvironmentResolver'

async function inspectDevOffers() {
  const client = createGuardedPgClient('DEVELOPMENT_TEST')
  await client.connect()
  try {
    const res = await client.query(`
      SELECT id, title_ar, title_en, offer_price, original_price, 
             contract_v2 IS NOT NULL AS has_contract_v2,
             contract_version, status, created_at
      FROM public.offers;
    `)
    console.log('DEV public.offers rows:')
    console.log(JSON.stringify(res.rows, null, 2))
  } finally {
    await client.end()
  }
}

inspectDevOffers().catch(console.error)
