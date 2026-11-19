// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function backupStorageObjects() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const supabase = createClient(url, serviceKey)

  const backupDir = path.resolve(process.cwd(), 'backups', 'db-prelaunch-reset-2026-11-11T22-38-45-937Z', 'storage-backup')
  fs.mkdirSync(backupDir, { recursive: true })

  console.log(`[STORAGE BACKUP] Downloading test objects into: ${backupDir}`)

  // 1. product-images/catalog (7 files)
  const productImgsDir = path.join(backupDir, 'product-images', 'catalog')
  fs.mkdirSync(productImgsDir, { recursive: true })
  const { data: pFiles } = await supabase.storage.from('product-images').list('catalog', { limit: 100 })
  console.log(`  Downloading ${pFiles?.length || 0} objects from product-images/catalog...`)
  for (const f of pFiles || []) {
    const { data: blob, error } = await supabase.storage.from('product-images').download(`catalog/${f.name}`)
    if (error || !blob) {
      console.warn(`    Failed to download catalog/${f.name}:`, error?.message)
      continue
    }
    const buf = Buffer.from(await blob.arrayBuffer())
    fs.writeFileSync(path.join(productImgsDir, f.name), buf)
    console.log(`    Downloaded: catalog/${f.name} (${buf.length} bytes)`)
  }

  // 2. offer-display-images/offers (31 files)
  const offerImgsDir = path.join(backupDir, 'offer-display-images', 'offers')
  fs.mkdirSync(offerImgsDir, { recursive: true })
  const { data: oFiles } = await supabase.storage.from('offer-display-images').list('offers', { limit: 100 })
  console.log(`  Downloading ${oFiles?.length || 0} objects from offer-display-images/offers...`)
  for (const f of oFiles || []) {
    const { data: blob, error } = await supabase.storage.from('offer-display-images').download(`offers/${f.name}`)
    if (error || !blob) {
      console.warn(`    Failed to download offers/${f.name}:`, error?.message)
      continue
    }
    const buf = Buffer.from(await blob.arrayBuffer())
    fs.writeFileSync(path.join(offerImgsDir, f.name), buf)
    console.log(`    Downloaded: offers/${f.name} (${buf.length} bytes)`)
  }

  console.log('[STORAGE BACKUP] Storage backup completed successfully!')
}

backupStorageObjects().catch(console.error)

