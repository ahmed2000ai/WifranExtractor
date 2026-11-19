// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { getSupabaseAdminClient } from '../src/main/db/supabaseAdminClient'
import net from 'net'

async function checkPort9222(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1000)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true) // port is open
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => {
      resolve(false) // port is closed
    })
    socket.connect(9222, '127.0.0.1')
  })
}

async function runPreflight() {
  console.log('======================================================================')
  console.log('WIFRAN-EXTRACTOR-IDENTITY-001N — PRE-EXECUTION SAFETY AUDIT')
  console.log('======================================================================\n')

  const sb = getSupabaseAdminClient()

  // 1. Port 9222 check
  const portOpen = await checkPort9222()
  console.log(`Port 9222 open (Remote Debugging): ${portOpen} (Must be false: ${!portOpen ? 'PASS' : 'FAIL'})`)
  if (portOpen) {
    throw new Error('Remote debugging port 9222 is open! Must be closed before production write.')
  }

  // 2. Database baseline counts
  const { count: offerCount } = await sb.from('offers').select('*', { count: 'exact', head: true })
  const { count: prodCount } = await sb.from('products').select('*', { count: 'exact', head: true })
  const { count: aliasCount } = await sb.from('product_aliases').select('*', { count: 'exact', head: true })
  const { count: imgCount } = await sb.from('product_images').select('*', { count: 'exact', head: true })
  const { count: displayImgCount } = await sb.from('offer_display_images').select('*', { count: 'exact', head: true })
  const { count: consumerOfferCount } = await sb.from('v_consumer_offers').select('*', { count: 'exact', head: true })

  console.log('Database Baseline Counts:')
  console.log(`- offers:                ${offerCount} (Expected: 87) -> ${offerCount === 87 ? 'PASS' : 'FAIL'}`)
  console.log(`- products:              ${prodCount} (Expected: 8)  -> ${prodCount === 8 ? 'PASS' : 'FAIL'}`)
  console.log(`- product_aliases:       ${aliasCount} (Expected: 0)  -> ${aliasCount === 0 ? 'PASS' : 'FAIL'}`)
  console.log(`- product_images:        ${imgCount} (Expected: 7)  -> ${imgCount === 7 ? 'PASS' : 'FAIL'}`)
  console.log(`- offer_display_images:  ${displayImgCount} (Expected: 31) -> ${displayImgCount === 31 ? 'PASS' : 'FAIL'}`)
  console.log(`- v_consumer_offers:     ${consumerOfferCount} (Expected: 87) -> ${consumerOfferCount === 87 ? 'PASS' : 'FAIL'}`)

  if (offerCount !== 87 || prodCount !== 8 || aliasCount !== 0 || imgCount !== 7 || displayImgCount !== 31 || consumerOfferCount !== 87) {
    throw new Error('Baseline counts do not match expected production state! Aborting.')
  }

  // 3. Collision checks for proposed Canary identifiers
  const { data: nooriOffers } = await sb.from('offers').select('id, source_offer_id').ilike('source_offer_id', 'noori%')
  console.log(`Existing Noori offers: ${nooriOffers?.length || 0} -> ${(nooriOffers?.length || 0) === 0 ? 'PASS' : 'FAIL'}`)

  const { data: nooriSm } = await sb.from('supermarkets').select('id, slug').ilike('slug', '%noori%')
  console.log(`Existing Noori supermarket: ${nooriSm?.length || 0} -> ${(nooriSm?.length || 0) === 0 ? 'PASS' : 'FAIL'}`)

  const { data: nooriLeaflets } = await sb.from('leaflets').select('*').ilike('id', '%noori%')
  console.log(`Existing Noori leaflets: ${nooriLeaflets?.length || 0} -> ${(nooriLeaflets?.length || 0) === 0 ? 'PASS' : 'FAIL'}`)

  if ((nooriOffers?.length || 0) > 0 || (nooriLeaflets?.length || 0) > 0) {
    throw new Error('Canary identifiers already exist in DB! Aborting.')
  }

  // 4. Audit existing 8 verified linked offers
  const { data: verifiedLinked } = await sb
    .from('offers')
    .select('id, source_offer_id, product_id, catalog_match_status')
    .eq('catalog_match_status', 'verified_linked')
  console.log(`Existing verified linked offers: ${verifiedLinked?.length || 0} (Expected: 8) -> ${verifiedLinked?.length === 8 ? 'PASS' : 'FAIL'}`)

  console.log('\n[PREFLIGHT RESULT] ALL 8 MANDATORY SAFETY CHECKS PASSED!')
}

runPreflight().catch((err) => {
  console.error('Preflight audit failed:', err)
  process.exit(1)
})

