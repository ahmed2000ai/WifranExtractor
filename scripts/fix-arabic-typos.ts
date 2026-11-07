import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function run() {
  const c = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await c.connect()

  console.log('=== FIXING 2 ARABIC TYPOS IN PUBLIC.OFFERS ===\n')

  // 1. Fix L'Oreal / Garnier Shampoo
  const lorealRes = await c.query("SELECT id, title_ar, contract_v2 FROM public.offers WHERE id = 'd8d8d79a-1177-47c7-9bf1-b65a85d16118'")
  if (lorealRes.rows.length === 0) {
    throw new Error('Loreal offer not found')
  }
  const lorealOffer = lorealRes.rows[0]
  const lorealContract = lorealOffer.contract_v2 || {}

  // Update contract_v2
  if (lorealContract.assortment?.source_assertions?.[0]?.value) {
    lorealContract.assortment.source_assertions[0].value = lorealContract.assortment.source_assertions[0].value.replace('رويال', 'لوريال')
  }

  await c.query(`
    UPDATE public.offers
    SET title_ar = 'لوريال / غارنييه شامبو ٤٠٠ مل منوع',
        contract_v2 = $1,
        updated_at = now()
    WHERE id = 'd8d8d79a-1177-47c7-9bf1-b65a85d16118'
  `, [JSON.stringify(lorealContract)])
  console.log("Updated Offer d8d8d79a (L'Oreal): title_ar -> 'لوريال / غارنييه شامبو ٤٠٠ مل منوع'")

  // 2. Fix Mini Fan (Remove OCR hallucination "روكي")
  const fanRes = await c.query("SELECT id, title_ar, contract_v2 FROM public.offers WHERE id = '062cdc51-c4ff-42dc-bd48-60f5d2c31308'")
  if (fanRes.rows.length === 0) {
    throw new Error('Mini Fan offer not found')
  }
  const fanOffer = fanRes.rows[0]
  const fanContract = fanOffer.contract_v2 || {}

  if (fanContract.assortment?.source_assertions?.[0]?.value) {
    fanContract.assortment.source_assertions[0].value = fanContract.assortment.source_assertions[0].value.replace('روكي ', '')
  }
  if (fanContract.product_facts?.brand_assertion) {
    fanContract.product_facts.brand_assertion.candidate_unverified = null
  }

  await c.query(`
    UPDATE public.offers
    SET title_ar = 'مروحة ميني منوع',
        contract_v2 = $1,
        updated_at = now()
    WHERE id = '062cdc51-c4ff-42dc-bd48-60f5d2c31308'
  `, [JSON.stringify(fanContract)])
  console.log("Updated Offer 062cdc51 (Mini Fan): title_ar -> 'مروحة ميني منوع' (removed 'روكي')")

  // Verify
  const verifyRes = await c.query(`
    SELECT id, title_en, title_ar
    FROM public.offers
    WHERE id IN ('d8d8d79a-1177-47c7-9bf1-b65a85d16118', '062cdc51-c4ff-42dc-bd48-60f5d2c31308')
  `)
  console.log('\nVerified updated rows:')
  console.table(verifyRes.rows)

  await c.end()
}

run().catch((err) => {
  console.error('Failed to fix typos:', err)
  process.exit(1)
})

