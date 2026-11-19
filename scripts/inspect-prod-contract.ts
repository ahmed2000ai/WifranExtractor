import { getGuardedSupabaseClient } from '../src/main/db/databaseEnvironmentResolver'

async function checkCount() {
  const supabase = getGuardedSupabaseClient('PRODUCTION_UI')
  const { data, count, error } = await supabase
    .from('offers')
    .select('id', { count: 'exact' })
    .not('contract_v2', 'is', null)

  console.log('Production offers with contract_v2 NOT NULL:', count, error)
}

checkCount().catch(console.error)
