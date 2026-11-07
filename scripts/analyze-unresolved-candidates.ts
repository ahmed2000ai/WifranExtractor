import path from 'path'
import dotenv from 'dotenv'
import { Client } from 'pg'
import { classifyOfferAmbiguity, buildCanonicalProductKey, buildItemNameComplete } from '../src/main/db/productCatalogResolutionService'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function run() {
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

  const res = await client.query(`
    SELECT o.id, o.source_offer_id, o.title_en, o.title_ar, o.brand_candidate_text,
           o.sale_unit_type, o.inner_pack_count, o.each_size_value, o.each_size_unit,
           o.offer_price, o.original_price, o.catalog_match_status, o.assortment_status,
           o.supermarket_id, s.name_en AS supermarket_name
    FROM public.offers o
    LEFT JOIN public.supermarkets s ON s.id = o.supermarket_id
    WHERE o.product_id IS NULL
    ORDER BY s.name_en, o.source_offer_id;
  `)

  console.log(`Analyzing ${res.rows.length} unresolved offers...`)

  const packagedCandidates: any[] = []
  const ambiguousExcluded: any[] = []

  for (const o of res.rows) {
    const rawBrand = o.brand_candidate_text || null
    const eachSizeVal = o.each_size_value != null ? Number(o.each_size_value) : null
    const innerPack = o.inner_pack_count != null ? Number(o.inner_pack_count) : 1
    const saleUnit = o.sale_unit_type || 'each'

    const ambiguity = classifyOfferAmbiguity({
      title_en: o.title_en,
      title_ar: o.title_ar,
      brand_name: rawBrand,
      brand_state: null,
      sale_unit_type: saleUnit,
      inner_pack_count: innerPack,
      each_size_value: eachSizeVal,
      each_size_unit: o.each_size_unit,
      assortment_status: o.assortment_status
    })

    if (ambiguity.isAmbiguous) {
      ambiguousExcluded.push({
        id: o.id,
        source_offer_id: o.source_offer_id,
        supermarket: o.supermarket_name,
        title_en: o.title_en,
        reason: ambiguity.reason,
        details: ambiguity.details
      })
    } else {
      const candidateKey = buildCanonicalProductKey({
        brandName: rawBrand,
        normalizedTitleEn: o.title_en,
        variantOrFlavor: null,
        eachSizeValue: eachSizeVal,
        eachSizeUnit: o.each_size_unit,
        innerPackCount: innerPack,
        saleUnitType: saleUnit
      })

      const completeName = buildItemNameComplete({
        brandName: rawBrand,
        titleEn: o.title_en,
        titleAr: o.title_ar,
        variantOrFlavor: null,
        eachSizeValue: eachSizeVal,
        eachSizeUnit: o.each_size_unit,
        innerPackCount: innerPack,
        saleUnitType: saleUnit
      })

      packagedCandidates.push({
        id: o.id,
        source_offer_id: o.source_offer_id,
        supermarket: o.supermarket_name,
        title_en: o.title_en,
        title_ar: o.title_ar,
        brand: rawBrand,
        candidateKey,
        completeName,
        pack: `${innerPack}x ${eachSizeVal} ${o.each_size_unit || ''} (${saleUnit})`,
        price: o.offer_price
      })
    }
  }

  console.log(`\nPackaged Candidates Found: ${packagedCandidates.length}`)
  console.log(`Ambiguous Excluded Offers: ${ambiguousExcluded.length}`)

  const smMap: Record<string, { candidates: number; excluded: number }> = {}
  for (const c of packagedCandidates) {
    smMap[c.supermarket] = smMap[c.supermarket] || { candidates: 0, excluded: 0 }
    smMap[c.supermarket].candidates++
  }
  for (const a of ambiguousExcluded) {
    smMap[a.supermarket] = smMap[a.supermarket] || { candidates: 0, excluded: 0 }
    smMap[a.supermarket].excluded++
  }
  console.log('\n--- Breakdown by Supermarket ---')
  console.log(JSON.stringify(smMap, null, 2))

  console.log('\n--- Packaged Grocery Candidates ---')
  for (const c of packagedCandidates) {
    console.log(`[${c.supermarket}] ID: ${c.id} | ${c.candidateKey} | Title: ${c.title_en} | Pack: ${c.pack} | SAR ${c.price}`)
  }

  // Also check why Carrefour / Noori / Alwafa might have been classified
  console.log('\n--- Carrefour / Noori / Alwafa Candidates ---')
  const targetSupermarkets = ['Carrefour', 'Noori Supermarket', 'Hyper Alwafa']
  for (const c of packagedCandidates.filter((p) => targetSupermarkets.includes(p.supermarket))) {
    console.log(`[${c.supermarket}] ID: ${c.id} | Key: ${c.candidateKey} | Title: ${c.title_en} | Pack: ${c.pack} | SAR ${c.price}`)
  }

  await client.query('ROLLBACK')
  await client.end()
}

run().catch((err) => {
  console.error('Run failed:', err)
  process.exit(1)
})
