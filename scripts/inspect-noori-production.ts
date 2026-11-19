// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { getSupabaseAdminClient } from '../src/main/db/supabaseAdminClient'

async function inspectNoori() {
  const supabase = getSupabaseAdminClient()
  console.log('--- Inspecting Supermarkets ---')
  const { data: smData, error: smErr } = await supabase.from('supermarkets').select('*')
  if (smErr) console.error('Supermarket err:', smErr)
  else console.log('Supermarkets:', smData)

  console.log('--- Inspecting Cities ---')
  const { data: cityData, error: cityErr } = await supabase.from('cities').select('*')
  if (cityErr) console.error('City err:', cityErr)
  else console.log('Cities:', cityData)

  console.log('--- Inspecting Regions ---')
  const { data: regData, error: regErr } = await supabase.from('regions').select('*')
  if (regErr) console.error('Region err:', regErr)
  else console.log('Regions:', regData)

  console.log('--- Inspecting Leaflets ---')
  const { data: leafData, error: leafErr } = await supabase.from('leaflets').select('*')
  if (leafErr) console.error('Leaflet err:', leafErr)
  else console.log('Leaflets:', leafData)

  console.log('--- Inspecting Offers in DB ---')
  const { data: offData, error: offErr } = await supabase.from('offers').select('*')
  if (offErr) {
    console.error('Offers err:', offErr)
    return
  }
  console.log('Total offers in DB:', offData?.length)
  const nooriOffers = offData?.filter((o: any) => 
    (o.title_en && /noori|safi|shalan|10x600/i.test(o.title_en)) ||
    (o.source_offer_id && /noori/i.test(o.source_offer_id)) ||
    (o.supermarket_id && /noori/i.test(o.supermarket_id))
  )
  console.log('Matched candidate Noori/Phase 1N offers:', JSON.stringify(nooriOffers, null, 2))

  console.log('--- Inspecting Product #8 in detail ---')
  const { data: p8, error: p8Err } = await supabase.from('products').select('*').eq('id', 8)
  console.log('Product #8:', p8)

  console.log('--- Inspecting all 8 products in detail ---')
  const { data: allProds, error: allProdsErr } = await supabase.from('products').select('*').order('id', { ascending: true })
  console.log('All products:', JSON.stringify(allProds, null, 2))
}

inspectNoori().catch(console.error)

