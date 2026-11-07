import { getSupabaseAdminClient } from '../src/main/db/supabaseAdminClient'

async function run() {
  const supabase = getSupabaseAdminClient()
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) {
    console.error('Error listing buckets:', error)
  } else {
    console.log('Buckets:', buckets?.map((b) => ({ name: b.name, public: b.public })))
  }
}

run().catch(console.error)

