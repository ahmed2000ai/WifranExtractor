// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { Client } from 'pg'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function createBackup() {
  const host = process.env.SUPABASE_DB_HOST || 'db.swratbmclahjyekouned.supabase.co'
  const port = parseInt(process.env.SUPABASE_DB_PORT || '5432', 10)
  const user = process.env.SUPABASE_DB_USER || 'postgres'
  const password = process.env.SUPABASE_DB_PASSWORD
  const database = 'postgres'

  console.log(`[BACKUP] Connecting to ${host}:${port}...`)
  const client = new Client({
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.resolve(process.cwd(), 'backups', `db-prelaunch-reset-${timestamp}`)
  fs.mkdirSync(backupDir, { recursive: true })
  console.log(`[BACKUP] Target directory: ${backupDir}`)

  // Tables in scope for removal / verification
  const targetTables = [
    'offer_display_images',
    'offers',
    'product_images',
    'products',
    'product_aliases',
    'offer_revision_snapshots',
    'offer_status_history',
    'offer_visual_group_members',
    'saved_offers',
    'watched_items',
    'shopping_list_items',
    'shopping_lists',
    'issue_reports',
    'import_rows',
    'import_batches',
    'validation_errors'
  ]

  const manifest: {
    timestamp: string
    supabaseHost: string
    projectRef: string
    tables: Record<string, { count: number; jsonFile: string; sha256: string }>
    totalRecords: number
    verified: boolean
  } = {
    timestamp: new Date().toISOString(),
    supabaseHost: host,
    projectRef: 'swratbmclahjyekouned',
    tables: {},
    totalRecords: 0,
    verified: false
  }

  const sqlStatements: string[] = [
    `-- Wifran Prelaunch Test Data Restore Script`,
    `-- Generated: ${manifest.timestamp}`,
    `-- Target Project: ${manifest.projectRef} (${manifest.supabaseHost})`,
    `BEGIN;`,
    ``
  ]

  for (const table of targetTables) {
    const res = await client.query(`SELECT * FROM public."${table}";`)
    const rows = res.rows
    manifest.totalRecords += rows.length

    const jsonPath = path.join(backupDir, `${table}.json`)
    const jsonContent = JSON.stringify(rows, null, 2)
    fs.writeFileSync(jsonPath, jsonContent, 'utf-8')

    const hash = crypto.createHash('sha256').update(jsonContent).digest('hex')
    manifest.tables[table] = {
      count: rows.length,
      jsonFile: `${table}.json`,
      sha256: hash
    }
    console.log(`  Exported ${table}: ${rows.length} rows (SHA-256: ${hash.slice(0, 12)}...)`)
  }

  // Generate SQL restore script for the populated tables
  // In reverse order of deletion for restore:
  // 1. products
  // 2. product_images
  // 3. update products.approved_primary_image_id
  // 4. offers
  // 5. offer_display_images

  function escapeSqlVal(val: any): string {
    if (val === null || val === undefined) return 'NULL'
    if (typeof val === 'number') return String(val)
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
    if (val instanceof Date) return `'${val.toISOString()}'`
    if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`
    return `'${String(val).replace(/'/g, "''")}'`
  }

  // 1. Products (without circular FK approved_primary_image_id initially)
  const products = JSON.parse(fs.readFileSync(path.join(backupDir, 'products.json'), 'utf-8'))
  if (products.length > 0) {
    sqlStatements.push(`-- 1. Restore Products`)
    for (const p of products) {
      const cols = Object.keys(p).filter((c) => c !== 'approved_primary_image_id')
      const vals = cols.map((c) => escapeSqlVal(p[c]))
      sqlStatements.push(
        `INSERT INTO public.products (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`
      )
    }
    sqlStatements.push(``)
  }

  // 2. Product Images
  const pImgs = JSON.parse(fs.readFileSync(path.join(backupDir, 'product_images.json'), 'utf-8'))
  if (pImgs.length > 0) {
    sqlStatements.push(`-- 2. Restore Product Images`)
    for (const pi of pImgs) {
      const cols = Object.keys(pi)
      const vals = cols.map((c) => escapeSqlVal(pi[c]))
      sqlStatements.push(
        `INSERT INTO public.product_images (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`
      )
    }
    sqlStatements.push(``)
  }

  // 3. Restore approved_primary_image_id on products
  const productsWithImage = products.filter((p: any) => p.approved_primary_image_id)
  if (productsWithImage.length > 0) {
    sqlStatements.push(`-- 3. Restore Products Circular Image Foreign Key`)
    for (const p of productsWithImage) {
      sqlStatements.push(
        `UPDATE public.products SET approved_primary_image_id = ${escapeSqlVal(p.approved_primary_image_id)} WHERE id = ${escapeSqlVal(p.id)};`
      )
    }
    sqlStatements.push(``)
  }

  // 4. Offers
  const offers = JSON.parse(fs.readFileSync(path.join(backupDir, 'offers.json'), 'utf-8'))
  if (offers.length > 0) {
    sqlStatements.push(`-- 4. Restore Offers`)
    for (const o of offers) {
      const cols = Object.keys(o)
      const vals = cols.map((c) => escapeSqlVal(o[c]))
      sqlStatements.push(
        `INSERT INTO public.offers (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`
      )
    }
    sqlStatements.push(``)
  }

  // 5. Offer Display Images
  const oImgs = JSON.parse(fs.readFileSync(path.join(backupDir, 'offer_display_images.json'), 'utf-8'))
  if (oImgs.length > 0) {
    sqlStatements.push(`-- 5. Restore Offer Display Images`)
    for (const oi of oImgs) {
      const cols = Object.keys(oi)
      const vals = cols.map((c) => escapeSqlVal(oi[c]))
      sqlStatements.push(
        `INSERT INTO public.offer_display_images (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`
      )
    }
    sqlStatements.push(``)
  }

  sqlStatements.push(`COMMIT;`)
  const sqlContent = sqlStatements.join('\n')
  const sqlPath = path.join(backupDir, 'restore_test_data.sql')
  fs.writeFileSync(sqlPath, sqlContent, 'utf-8')
  console.log(`  Generated SQL restore script: ${sqlPath} (${(sqlContent.length / 1024).toFixed(1)} KB)`)

  // Verification step: Read files back and verify hashes
  let verificationPassed = true
  for (const [table, meta] of Object.entries(manifest.tables)) {
    const fPath = path.join(backupDir, meta.jsonFile)
    if (!fs.existsSync(fPath)) {
      verificationPassed = false
      console.error(`Verification FAILED: Missing file ${fPath}`)
      continue
    }
    const content = fs.readFileSync(fPath, 'utf-8')
    const reHash = crypto.createHash('sha256').update(content).digest('hex')
    if (reHash !== meta.sha256) {
      verificationPassed = false
      console.error(`Verification FAILED: Hash mismatch for ${table}`)
    }
  }

  manifest.verified = verificationPassed
  const manifestPath = path.join(backupDir, 'backup-manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  console.log(`\n[BACKUP] Backup Manifest saved: ${manifestPath}`)
  console.log(`[BACKUP] Verification Status: ${verificationPassed ? 'SUCCESS (PASS)' : 'FAILED'}`)

  await client.end()
  return { backupDir, manifest }
}

createBackup().catch(console.error)

