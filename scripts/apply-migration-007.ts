import { Client } from 'pg'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function applyMigration007() {
  const password = process.env.SUPABASE_DB_PASSWORD
  if (!password) {
    throw new Error('SUPABASE_DB_PASSWORD is missing from .env.local or environment.')
  }
  const migrationPath = path.resolve(process.cwd(), 'project-knowledge/wifran_docs/007_wifran_07g_07h_catalog_resolution_and_product_images.sql')
  const sql = fs.readFileSync(migrationPath, 'utf8')

  console.log('Connecting to Supabase PostgreSQL database to apply Migration 007...')
  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    user: 'postgres',
    password: password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    console.log('Connected! Executing Migration 007 SQL...')
    await client.query(sql)
    console.log('Migration 007 applied successfully to WifranV2!')

    // Verify products columns
    const prodCols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'products'
      ORDER BY ordinal_position;
    `)
    console.log('\nVerified products columns:', prodCols.rows.map(r => `${r.column_name} (${r.data_type})`))

    // Verify offers columns
    const offerCols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'offers' AND column_name LIKE 'catalog_%'
      ORDER BY ordinal_position;
    `)
    console.log('\nVerified offers catalog columns:', offerCols.rows.map(r => `${r.column_name} (${r.data_type})`))

    // Verify product_images table
    const imgCols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'product_images'
      ORDER BY ordinal_position;
    `)
    console.log('\nVerified product_images columns:', imgCols.rows.map(r => `${r.column_name} (${r.data_type})`))

    // Verify v_consumer_offers
    const viewCheck = await client.query(`
      SELECT count(*) as total_offers 
      FROM public.v_consumer_offers;
    `)
    console.log('\nVerified v_consumer_offers queryable, count =', viewCheck.rows[0].total_offers)

    await client.end()
  } catch (err: any) {
    console.error('Migration failed:', err)
    try { await client.end() } catch {}
    process.exit(1)
  }
}

applyMigration007()

