import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'
import { analyzeOfferCatalogCandidates, approveCatalogProductCandidates } from '../src/main/db/productCatalogResolutionService'

async function reseed() {
  console.log('=============================================================')
  console.log('RE-SEEDING ALWAFA_TEST PRODUCTS WITH SEQUENTIAL BIGINT (1..8)')
  console.log('=============================================================\n')

  const pgClient = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await pgClient.connect()

  // 1. Reset sequence to 1
  await pgClient.query(`
    DELETE FROM public.products;
    UPDATE public.offers SET product_id = NULL WHERE supermarket_id = 'c2cc16c2-0008-4444-b000-c00000000008';
    ALTER TABLE public.products ALTER COLUMN id RESTART WITH 1;
  `)
  console.log('Reset public.products and sequence to 1.')

  // 2. Run analysis
  console.log('Analyzing offers for supermarket c2cc16c2-0008-4444-b000-c00000000008...')
  const analysis = await analyzeOfferCatalogCandidates({
    supermarketId: 'c2cc16c2-0008-4444-b000-c00000000008'
  })
  console.log(`Found ${analysis.candidates.length} candidates, ${analysis.excludedOffers.length} excluded offers.`)

  const candidateKeys = analysis.candidates.map((c) => c.candidateKey)
  console.log('Candidate keys to approve:', candidateKeys)

  // 3. Approve candidates
  console.log('Approving catalog candidates in deterministic alphabetical order...')
  const approval = await approveCatalogProductCandidates({
    candidateKeys,
    operatorConfirmedIdentity: true,
    verifiedBy: 'operator',
    verificationBasis: 'operator_verified_pack_identity'
  })
  console.log(`Approval result: ${approval.approvedCount} products approved, ${approval.linkedOffersCount} offers linked.`)
  console.log('Created product IDs:', approval.createdProductIds)

  // 4. Query live DB to verify sequential IDs
  const prods = await pgClient.query(`
    SELECT id, canonical_product_key, item_name_complete, verification_status
    FROM public.products
    ORDER BY id ASC;
  `)
  console.log(`\nVerified Products in DB (${prods.rowCount} total):`)
  console.table(prods.rows)

  const linkedOffers = await pgClient.query(`
    SELECT id, title_en, product_id, catalog_match_status
    FROM public.offers
    WHERE supermarket_id = 'c2cc16c2-0008-4444-b000-c00000000008'
      AND product_id IS NOT NULL
    ORDER BY product_id ASC;
  `)
  console.log(`\nVerified Linked Offers in DB (${linkedOffers.rowCount} total):`)
  console.table(linkedOffers.rows)

  await pgClient.end()
}

reseed().catch((err) => {
  console.error('ERROR during reseed:', err)
  process.exit(1)
})

