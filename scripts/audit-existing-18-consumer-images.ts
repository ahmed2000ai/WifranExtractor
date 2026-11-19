/**
 * Audit Existing 18 Consumer Images on Production (swratbmclahjyekouned)
 *
 * Inspects all 30 published offers, focusing on the 18 offers that currently
 * have images visible in v_consumer_offers, to verify product/size correctness.
 */

import {
  assertProductionMaintenanceAuthorized,
  createGuardedPgClient,
  resolveDatabaseConfig
} from '../src/main/db/databaseEnvironmentResolver'

async function auditExistingImages() {
  assertProductionMaintenanceAuthorized('audit-existing-18-consumer-images.ts')

  const config = resolveDatabaseConfig('PRODUCTION_UI')
  console.log('=================================================================')
  console.log('  STAGE B — AUDIT EXISTING 18 CONSUMER IMAGES ON PRODUCTION       ')
  console.log(`  Target Project: ${config.projectRef}`)
  console.log('=================================================================\n')

  const client = createGuardedPgClient('PRODUCTION_UI')
  await client.connect()

  try {
    const res = await client.query(`
      SELECT 
        o.id as offer_id,
        o.source_offer_id,
        o.title_en as offer_title_en,
        o.title_ar as offer_title_ar,
        o.offer_price,
        o.each_size_value as o_size,
        o.each_size_unit as o_unit,
        o.assortment_status,
        o.product_id,
        p.name_en as prod_name_en,
        p.brand_name as prod_brand,
        p.each_size_value as p_size,
        p.each_size_unit as p_unit,
        p.verification_status,
        pi.public_url as pi_url,
        odi.public_url as odi_url,
        vco.image_url as consumer_image_url,
        vco.display_image_kind,
        vco.card_image_subject_scope
      FROM public.offers o
      LEFT JOIN public.products p ON p.id = o.product_id
      LEFT JOIN public.product_images pi ON pi.product_id = p.id AND pi.role = 'primary' AND pi.approval_status = 'approved'
      LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id AND odi.approval_status = 'approved'
      LEFT JOIN public.v_consumer_offers vco ON vco.id = o.id
      WHERE o.supermarket_id = (SELECT id FROM public.supermarkets WHERE slug = 'al-nokhbah' LIMIT 1)
         OR o.source_offer_id LIKE 'doc_982ef82677fe1d5d:%'
      ORDER BY 
        CASE WHEN vco.image_url IS NOT NULL THEN 0 ELSE 1 END,
        o.source_offer_id;
    `)

    const withImage = res.rows.filter(r => r.consumer_image_url != null)
    const withoutImage = res.rows.filter(r => r.consumer_image_url == null)

    console.log(`Total Offers: ${res.rows.length}`)
    console.log(`Offers WITH Consumer Image: ${withImage.length}`)
    console.log(`Offers WITHOUT Consumer Image: ${withoutImage.length}\n`)

    console.log('--- OFFERS WITH CONSUMER IMAGE (18) ---')
    let mismatchCount = 0
    for (const r of withImage) {
      const sizeMismatch = (r.o_size != null && r.p_size != null && (Number(r.o_size) !== Number(r.p_size) || r.o_unit !== r.p_unit))
      const flag = sizeMismatch ? ' [MISMATCH]' : ' [OK]'
      if (sizeMismatch) mismatchCount++
      console.log(`\n${flag} Offer: ${r.source_offer_id} (ID: ${r.offer_id})`)
      console.log(`  Offer Title: ${r.offer_title_en} | Size: ${r.o_size} ${r.o_unit}`)
      console.log(`  Linked Product: #${r.product_id} ${r.prod_brand || ''} ${r.prod_name_en} | Size: ${r.p_size} ${r.p_unit} (${r.verification_status})`)
      console.log(`  Consumer Image URL: ${r.consumer_image_url}`)
      console.log(`  Image Source: pi=${Boolean(r.pi_url)}, odi=${Boolean(r.odi_url)}, kind=${r.display_image_kind}, scope=${r.card_image_subject_scope}`)
    }

    console.log(`\nExisting Image Size Mismatches: ${mismatchCount}`)

    console.log('\n--- OFFERS WITHOUT CONSUMER IMAGE (12) ---')
    for (const r of withoutImage) {
      console.log(`\nOffer: ${r.source_offer_id} (ID: ${r.offer_id})`)
      console.log(`  Offer Title: ${r.offer_title_en} | Size: ${r.o_size} ${r.o_unit}`)
      console.log(`  Linked Product: #${r.product_id} ${r.prod_brand || ''} ${r.prod_name_en} | Size: ${r.p_size} ${r.p_unit} (${r.verification_status})`)
      console.log(`  Assortment Status: ${r.assortment_status}`)
    }

  } finally {
    await client.end()
  }
}

auditExistingImages().catch((err) => {
  console.error('Fatal error during existing image audit:', err)
  process.exit(1)
})
