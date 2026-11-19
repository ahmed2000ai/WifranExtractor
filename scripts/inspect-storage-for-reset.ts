// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function inspectStorage() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  console.log(`[STORAGE] Connecting to ${url}...`)
  const supabase = createClient(url, serviceKey)

  const { data: buckets, error: bErr } = await supabase.storage.listBuckets()
  if (bErr) {
    console.error('Failed to list buckets:', bErr)
    return
  }

  console.log(`\n=== STORAGE BUCKETS (${buckets.length}) ===`)
  for (const b of buckets) {
    console.log(`  - Bucket: ${b.name} (id: ${b.id}, public: ${b.public})`)

    // List objects in root
    const { data: files, error: fErr } = await supabase.storage.from(b.name).list('', {
      limit: 100,
      sortBy: { column: 'name', order: 'asc' }
    })
    if (fErr) {
      console.warn(`    Failed to list files in ${b.name}:`, fErr.message)
      continue
    }

    async function listRecursive(bucket: string, prefix = ''): Promise<void> {
      const { data: items, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100 })
      if (error) {
        console.warn(`    Error listing ${bucket}/${prefix}:`, error.message)
        return
      }
      for (const it of items || []) {
        const fullPath = prefix ? `${prefix}/${it.name}` : it.name
        if (it.id) {
          console.log(`      * ${fullPath} (${it.metadata?.size || 'N/A'} bytes)`)
        } else {
          console.log(`      > [DIR] ${fullPath}`)
          await listRecursive(bucket, fullPath)
        }
      }
    }

    console.log(`\n    Items in ${b.name}:`)
    await listRecursive(b.name)
  }
}

inspectStorage().catch(console.error)
