import { getGuardedSupabaseClient } from '../src/main/db/databaseEnvironmentResolver'

async function run() {
  const supabase = getGuardedSupabaseClient('DEVELOPMENT_TEST')
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) {
    console.error('Error listing buckets:', error)
  } else {
    console.log('Development Storage Buckets:', buckets?.map((b) => ({ id: b.id, name: b.name, public: b.public })))
  }
}

run().catch(console.error)
