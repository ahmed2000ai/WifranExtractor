import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function audit() {
  console.log('=============================================================')
  console.log('AUDITING PRODUCTS.ID & PRODUCT_ID COLUMNS IN WIFRANV2')
  console.log('=============================================================\n')

  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  // 1. Columns
  console.log('--- 1. information_schema.columns for product_id and products.id ---')
  const cols = await client.query(`
    SELECT table_schema, table_name, column_name, data_type, is_nullable, identity_generation
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND (
        (table_name = 'products' AND column_name = 'id')
        OR column_name = 'product_id'
      )
    ORDER BY table_name, column_name;
  `)
  console.table(cols.rows)

  // 2. Foreign keys referencing products
  console.log('\n--- 2. Foreign keys referencing products(id) or on product_id columns ---')
  const fks = await client.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      tc.constraint_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public'
      AND (ccu.table_name = 'products' OR kcu.column_name = 'product_id');
  `)
  console.table(fks.rows)

  // 3. Immutability Trigger
  console.log('\n--- 3. Triggers on public.products ---')
  const trgs = await client.query(`
    SELECT trigger_name, event_manipulation, action_timing
    FROM information_schema.triggers
    WHERE event_object_schema = 'public' AND event_object_table = 'products';
  `)
  console.table(trgs.rows)

  // 4. New WIFRAN-07J tables
  console.log('\n--- 4. New WIFRAN-07J tables in public schema ---')
  const newTables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('offer_display_images', 'offer_visual_group_members');
  `)
  console.table(newTables.rows)

  // 5. v_consumer_offers image columns
  console.log('\n--- 5. v_consumer_offers display columns ---')
  const viewCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_consumer_offers' 
      AND column_name IN ('product_id', 'image_url', 'thumbnail_url', 'display_image_url', 'display_image_kind');
  `)
  console.table(viewCols.rows)

  await client.end()
}

audit().catch(console.error)

