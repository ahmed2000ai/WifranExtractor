import { getGuardedSupabaseClient } from '../src/main/db/databaseEnvironmentResolver'
// @ts-expect-error importing from consumer-app for contract mapping verification
import { mapConsumerOfferRow } from '../../Wifran/consumer-app/src/lib/consumer-offers/mapper'

async function verifyAll30ProductionOffers() {
  const supabase = getGuardedSupabaseClient('PRODUCTION_UI')

  // Query all 30 published offers from Production v_consumer_offers
  const { data: rows, error } = await supabase
    .from('v_consumer_offers')
    .select('*')
    .limit(50)

  if (error) {
    console.error('Error querying production v_consumer_offers:', error.message)
    process.exit(1)
  }

  console.log(`Fetched ${rows?.length || 0} production offer rows from swratbmclahjyekouned.`)
  if (rows && rows.length > 0) {
    console.log('Sample row consumer_contract_v2:', rows[0].consumer_contract_v2)
    console.log('Sample row contract_v2:', rows[0].contract_v2)
  }

  let successCount = 0
  let failureCount = 0
  let totalMediaWarnings = 0

  for (const row of rows || []) {
    // Under Migration 012 projection:
    // contract_version is COALESCE(NULLIF(o.contract_version, '2.0'), 'wifran.extractor.offer/2.0')
    const projectedRow = {
      ...row,
      contract_version: row.contract_version || 'wifran.extractor.offer/2.0'
    }

    const mapRes = mapConsumerOfferRow(projectedRow, { referenceRiyadhDate: '2026-11-19' })
    if (mapRes.ok) {
      successCount++
      totalMediaWarnings += mapRes.dto.media_warnings.length
      if (mapRes.dto.contract_source !== 'consumer_contract_v2') {
        console.warn(`Row ${row.id} has unexpected contract_source: ${mapRes.dto.contract_source}`)
      }
    } else {
      failureCount++
      console.error(`Row ${row.id} (${row.title_en}): FAILED mapping: [${mapRes.code}] ${mapRes.message}`)
    }
  }

  console.log(`Mapping Results:`)
  console.log(`- Successfully mapped DTOs: ${successCount} / ${rows?.length || 0}`)
  console.log(`- Failed mappings: ${failureCount}`)
  console.log(`- Media warnings: ${totalMediaWarnings}`)

  if (failureCount > 0 || successCount !== 30) {
    console.error(`Verification FAILED! Expected 30 clean mappings, got ${successCount}`)
    process.exit(1)
  }

  console.log(`100% SUCCESS: All 30 production offers map cleanly to ConsumerOfferDTO under Migration 012 projection!`)
}

verifyAll30ProductionOffers().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
