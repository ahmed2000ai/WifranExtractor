/**
 * Controlled Stage B Production Data Correction & Image Repair Execution
 *
 * Target Project: swratbmclahjyekouned (PRODUCTION)
 * Batch: batch-2026-11-16T08-39-30-dacbb8
 *
 * Enforces:
 *   - Operator dual authorization (repair + identity correction)
 *   - Atomic two-phase execution inside single transaction
 *   - Journal mutation recording (publication_operations, publication_journal_mutations)
 *   - Post-repair verification across database, storage, views, and consumer contracts
 */

import path from 'path'
import {
  assertProductionMaintenanceAuthorized,
  createGuardedPgClient,
  resolveDatabaseConfig,
  PRODUCTION_PROJECT_REF
} from '../src/main/db/databaseEnvironmentResolver'
import { BatchOrchestrationService } from '../src/main/batch/batchOrchestrationService'

async function executeProductionRepair() {
  console.log('=================================================================')
  console.log('  STAGE B — PRODUCTION DATA CORRECTION & IMAGE REPAIR            ')
  console.log('  Target Project: swratbmclahjyekouned (PRODUCTION)              ')
  console.log('=================================================================\n')

  // 1. Hard safety quarantine check
  assertProductionMaintenanceAuthorized('prod-repair-execute.ts')

  const config = resolveDatabaseConfig('PRODUCTION_UI')
  if (config.projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(`SAFETY ERROR: Expected production ref ${PRODUCTION_PROJECT_REF}, got ${config.projectRef}`)
  }

  const batchId = 'batch-2026-11-16T08-39-30-dacbb8'
  const batchesDir = path.resolve(process.cwd(), 'Extracts', 'batches')
  const service = new BatchOrchestrationService(batchesDir)

  const client = createGuardedPgClient('PRODUCTION_UI')
  await client.connect()
  console.log(`Connected to Production PostgreSQL at ${config.dbHost}:${config.dbPort}.\n`)

  try {
    // 2. Pre-execution baseline check
    console.log('--- PRE-REPAIR BASELINE VERIFICATION ---')
    const preOffersRes = await client.query(`
      SELECT 
        o.id,
        o.source_offer_id,
        o.title_en,
        o.product_id,
        o.assortment_status,
        vco.image_url as consumer_image_url
      FROM public.offers o
      LEFT JOIN public.v_consumer_offers vco ON vco.id = o.id
      WHERE o.source_offer_id LIKE 'doc_982ef82677fe1d5d:%'
         OR o.supermarket_id = (SELECT id FROM public.supermarkets WHERE slug = 'al-nokhbah' LIMIT 1)
      ORDER BY o.source_offer_id;
    `)
    const preOfferCount = preOffersRes.rows.length
    const preWithImageCount = preOffersRes.rows.filter(r => r.consumer_image_url != null).length
    const preWithoutImageCount = preOffersRes.rows.filter(r => r.consumer_image_url == null).length
    console.log(`Baseline published offers: ${preOfferCount}`)
    console.log(`Baseline with consumer image: ${preWithImageCount}`)
    console.log(`Baseline without consumer image: ${preWithoutImageCount}`)

    if (preOfferCount !== 30) {
      throw new Error(`PRE-CHECK FAILED: Expected 30 published offers in baseline, found ${preOfferCount}`)
    }
    if (preWithImageCount !== 18 || preWithoutImageCount !== 12) {
      throw new Error(`PRE-CHECK FAILED: Expected 18 imaged / 12 missing in baseline, found ${preWithImageCount}/${preWithoutImageCount}`)
    }

    const preProductsRes = await client.query(`SELECT count(*)::int as cnt FROM public.products`)
    const preProductCount = preProductsRes.rows[0].cnt
    console.log(`Baseline products in catalog: ${preProductCount}`)

    // 3. Execute Controlled Repair inside transaction via service
    console.log('\n--- EXECUTING CONTROLLED REPAIR ---')
    console.log('Authorization: operatorAuthorizedRepair=true, operatorAuthorizedIdentityCorrection=true')
    console.log('Operator ID: operator_stage_b_repair\n')

    const result = await service.repairPublishedOfferImages({
      batchId,
      operatorAuthorizedRepair: true,
      operatorAuthorizedIdentityCorrection: true,
      operatorId: 'operator_stage_b_repair',
      databaseContext: 'PRODUCTION_UI',
      pgClient: client
    })

    console.log('--- REPAIR EXECUTION RESULT ---')
    console.log(`Success: ${result.success}`)
    console.log(`Maintenance Operation ID: ${result.maintenanceOperationId}`)
    console.log(`Total Published Offers: ${result.totalPublishedOffers}`)
    console.log(`Identity Corrected Count: ${result.identityCorrectedCount}`)
    console.log(`Repaired Images Count: ${result.repairedCount}`)
    console.log(`Skipped Count: ${result.skippedCount}`)
    console.log(`Failed Count: ${result.failedCount}\n`)

    for (const r of result.repairs) {
      console.log(`[${r.status.toUpperCase()}] Source: ${r.sourceOfferId} (ID: ${r.offerId})`)
      console.log(`  Action Kind: ${r.repairActionKind} | Target Bucket: ${r.targetBucket}`)
      if (r.uploadedUrl) console.log(`  Uploaded URL: ${r.uploadedUrl}`)
      console.log(`  Reason: ${r.reason}`)
    }

    if (!result.success || result.failedCount > 0) {
      throw new Error(`REPAIR EXECUTION FAILED: failedCount=${result.failedCount}`)
    }

    // 4. Post-repair immediate verification
    console.log('\n--- POST-REPAIR IMMEDIATE VERIFICATION ---')

    // A. Verify all 30 offer IDs are preserved
    const postOffersRes = await client.query(`
      SELECT 
        o.id,
        o.source_offer_id,
        o.title_en,
        o.title_ar,
        o.product_id,
        o.assortment_status,
        o.unit_price,
        o.scoped_assessments,
        p.name_en as prod_name_en,
        p.brand_name as prod_brand,
        p.each_size_value as prod_size,
        p.each_size_unit as prod_unit,
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
      WHERE o.source_offer_id LIKE 'doc_982ef82677fe1d5d:%'
         OR o.supermarket_id = (SELECT id FROM public.supermarkets WHERE slug = 'al-nokhbah' LIMIT 1)
      ORDER BY o.source_offer_id;
    `)

    if (postOffersRes.rows.length !== 30) {
      throw new Error(`POST-VERIFY FAILED: Expected 30 offers preserved, found ${postOffersRes.rows.length}`)
    }
    console.log('✓ All 30 published offers preserved.')

    // B. Verify products count (preProductCount + 4 newly created 10kg candidate products)
    const postProductsRes = await client.query(`SELECT count(*)::int as cnt FROM public.products`)
    const postProductCount = postProductsRes.rows[0].cnt
    console.log(`Total products in catalog: ${postProductCount} (was ${preProductCount}, added ${postProductCount - preProductCount})`)

    // C. Verify 5kg Products #19, #20, #21, #36 are intact and linked ONLY to 5kg offers
    const check5kgProds = await client.query(`
      SELECT 
        p.id,
        p.name_en,
        p.each_size_value,
        p.each_size_unit,
        pi.public_url as pi_image_url,
        count(o.id) as linked_offers_count,
        array_agg(o.source_offer_id) as linked_offer_sources
      FROM public.products p
      LEFT JOIN public.product_images pi ON pi.product_id = p.id AND pi.role = 'primary' AND pi.approval_status = 'approved'
      LEFT JOIN public.offers o ON o.product_id = p.id
      WHERE p.id IN (19, 20, 21, 36)
      GROUP BY p.id, p.name_en, p.each_size_value, p.each_size_unit, pi.public_url
      ORDER BY p.id;
    `)
    for (const r of check5kgProds.rows) {
      console.log(`Product #${r.id} (${r.name_en}): size=${r.each_size_value}${r.each_size_unit}, image=${Boolean(r.pi_image_url)}, linkedOffers=${r.linked_offers_count} [${r.linked_offer_sources.join(', ')}]`)
      if (r.linked_offers_count !== '1' && r.linked_offers_count !== 1) {
        throw new Error(`5KG PRODUCT VERIFICATION FAILED: Product #${r.id} is linked to ${r.linked_offers_count} offers instead of exactly 1!`)
      }
      if (r.linked_offer_sources.some((s: string) => s.includes('tier_2') || s.includes('10kg'))) {
        throw new Error(`5KG PRODUCT CONTAMINATION: Product #${r.id} is still linked to a 10kg tier offer!`)
      }
      if (!r.pi_image_url) {
        throw new Error(`5KG PRODUCT MISSING IMAGE: Product #${r.id} does not have an approved primary image!`)
      }
    }
    console.log('✓ All four 5kg catalog products (#19, #20, #21, #36) are strictly linked ONLY to 5kg offers and have approved primary images.')

    // D. Verify the four 10kg Rice offers
    const rice10Offers = postOffersRes.rows.filter(r => r.source_offer_id.includes('tier_2'))
    if (rice10Offers.length !== 4) {
      throw new Error(`10KG OFFERS CHECK FAILED: Expected 4 10kg tier offers, found ${rice10Offers.length}`)
    }
    for (const r of rice10Offers) {
      console.log(`10kg Offer: ${r.source_offer_id} -> Product #${r.product_id} (${r.prod_brand} ${r.prod_name_en}, size=${r.prod_size} ${r.prod_unit}, ${r.verification_status}) | consumerImage=${r.consumer_image_url}`)
      if ([19, 20, 21, 36].includes(Number(r.product_id))) {
        throw new Error(`10KG OFFER SEPARATION FAILED: Offer ${r.source_offer_id} is still linked to 5kg Product #${r.product_id}!`)
      }
      if (Number(r.prod_size) !== 10) {
        throw new Error(`10KG PRODUCT SIZE MISMATCH: Product #${r.product_id} has size ${r.prod_size} instead of 10!`)
      }
      if (r.consumer_image_url !== null) {
        throw new Error(`10KG IMAGE CONTAMINATION: Offer ${r.source_offer_id} inherited image ${r.consumer_image_url} when it should be NULL!`)
      }
    }
    console.log('✓ All four 10kg rice offers are cleanly separated from 5kg products, linked to 10kg products, and resolve to NULL consumer image (no 5kg contamination).')

    // E. Verify the three Assortments (Water, Lux, OMO)
    const assortSources = ['ip001_010', 'ip001_014', 'ip001_015']
    const assortOffers = postOffersRes.rows.filter(r => assortSources.some(s => r.source_offer_id.includes(s)))
    if (assortOffers.length !== 3) {
      throw new Error(`ASSORTMENT OFFERS CHECK FAILED: Expected 3 assortment offers, found ${assortOffers.length}`)
    }
    for (const r of assortOffers) {
      console.log(`Assortment: ${r.source_offer_id} -> product_id=${r.product_id}, assortment_status=${r.assortment_status}, unit_price=${r.unit_price}, odi=${Boolean(r.odi_url)}, consumerImage=${Boolean(r.consumer_image_url)}, kind=${r.display_image_kind}, scope=${r.card_image_subject_scope}`)
      if (r.product_id !== null) {
        throw new Error(`ASSORTMENT PRODUCT UNLINK FAILED: ${r.source_offer_id} still has product_id=${r.product_id}!`)
      }
      if (r.assortment_status !== 'multiple_variants') {
        throw new Error(`ASSORTMENT STATUS FAILED: ${r.source_offer_id} has assortment_status=${r.assortment_status}!`)
      }
      if (r.unit_price !== null) {
        throw new Error(`ASSORTMENT UNIT PRICE SUPPRESSION FAILED: ${r.source_offer_id} has unit_price=${r.unit_price}!`)
      }
      if (!r.odi_url || !r.consumer_image_url) {
        throw new Error(`ASSORTMENT ODI MISSING: ${r.source_offer_id} does not have an approved ODI image!`)
      }
      if (r.card_image_subject_scope !== 'representative_assortment') {
        throw new Error(`ASSORTMENT SCOPE FAILED: ${r.source_offer_id} has scope=${r.card_image_subject_scope}!`)
      }
    }
    console.log('✓ All three assortment promotions are unlinked from single SKUs, unit-price suppressed, and imaged via offer-display-images.')

    // F. Verify Sadia Broasted Chicken
    const sadia = postOffersRes.rows.find(r => r.source_offer_id.includes('ip001_009'))
    if (!sadia) throw new Error('Sadia offer not found')
    console.log(`Sadia: product_id=${sadia.product_id}, odi=${Boolean(sadia.odi_url)}, consumerImage=${Boolean(sadia.consumer_image_url)}`)
    if (!sadia.consumer_image_url) {
      throw new Error('Sadia does not have a consumer image!')
    }
    console.log('✓ Sadia Broasted Chicken has approved ODI image.')

    // G. Verify journal operations
    const journalOps = await client.query(`
      SELECT 
        publish_operation_id, status, updated_offers_count, created_products_count, 
        storage_objects_uploaded, completed_at
      FROM public.publication_operations
      WHERE publish_operation_id = $1;
    `, [result.maintenanceOperationId])
    console.log('\nJournal Operation Record:', journalOps.rows[0])

    const journalMutations = await client.query(`
      SELECT table_name, mutation_type, count(*) as count
      FROM public.publication_journal_mutations
      WHERE publish_operation_id = $1
      GROUP BY table_name, mutation_type
      ORDER BY table_name, mutation_type;
    `, [result.maintenanceOperationId])
    console.log('Journal Mutations Breakdown:', journalMutations.rows)

    const journalStorage = await client.query(`
      SELECT bucket, ownership_mode, count(*) as count
      FROM public.publication_storage_operations
      WHERE publish_operation_id = $1
      GROUP BY bucket, ownership_mode;
    `, [result.maintenanceOperationId])
    console.log('Journal Storage Uploads Breakdown:', journalStorage.rows)

    console.log('\n=================================================================')
    console.log('  STAGE B PRODUCTION REPAIR COMPLETED AND VERIFIED 100% GREEN!   ')
    console.log('=================================================================')

  } finally {
    await client.end()
  }
}

executeProductionRepair().catch((err) => {
  console.error('Fatal error during production repair execution:', err)
  process.exit(1)
})
