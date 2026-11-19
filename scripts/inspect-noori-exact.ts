// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { getSupabaseAdminClient } from '../src/main/db/supabaseAdminClient'

async function inspectExact() {
  const supabase = getSupabaseAdminClient()
  const { data: leaflets } = await supabase.from('leaflets').select('*')
  console.log('Leaflets in DB:', JSON.stringify(leaflets, null, 2))
  
  const { data: offers } = await supabase.from('offers').select('*').order('created_at', { ascending: false })
  console.log('Total offers in DB:', offers?.length)
  const nooriOffers = offers?.filter((o: any) => 
    o.supermarket_id === '2a01a099-ab36-4150-90fb-d63f3c18fa6c' || 
    (o.source_offer_id && o.source_offer_id.includes('noori')) ||
    (o.title_en && /safi|shalan|10x600/i.test(o.title_en))
  )
  console.log('Noori offers count:', nooriOffers?.length)
  console.log('Noori offers:', JSON.stringify(nooriOffers, null, 2))
}

inspectExact().catch(console.error)

