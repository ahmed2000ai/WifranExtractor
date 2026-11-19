import { createGuardedPgClient, getGuardedSupabaseClient, DEVELOPMENT_PROJECT_REF } from '../src/main/db/databaseEnvironmentResolver'

async function auditDevSchema() {
  console.log('===============================================================')
  console.log('   AUDITING DEVELOPMENT SCHEMA (gykrbpykjhpyrdrinkuk)')
  console.log('===============================================================')

  const client = createGuardedPgClient('DEVELOPMENT_TEST')
  await client.connect()

  // 1. Tables
  const tRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `)
  const baseTables = tRes.rows.map(r => r.table_name)
  console.log(`\nBase tables (${baseTables.length}):\n `, baseTables.join(', '))

  // 2. Views
  const vRes = await client.query(`
    SELECT table_name 
    FROM information_schema.views 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `)
  const views = vRes.rows.map(r => r.table_name)
  console.log(`\nViews (${views.length}):\n `, views.join(', '))

  // 3. RLS Policies
  const pRes = await client.query(`
    SELECT tablename, policyname, roles, cmd 
    FROM pg_policies 
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `)
  console.log(`\nRLS Policies (${pRes.rows.length}):`)
  const policiesByTable: Record<string, string[]> = {}
  for (const p of pRes.rows) {
    if (!policiesByTable[p.tablename]) policiesByTable[p.tablename] = []
    policiesByTable[p.tablename].push(`${p.policyname} (${p.cmd})`)
  }
  for (const [table, pols] of Object.entries(policiesByTable)) {
    console.log(`  - ${table} (${pols.length}):`)
    for (const pol of pols) {
      console.log(`      * ${pol}`)
    }
  }

  // 4. Triggers
  const trRes = await client.query(`
    SELECT DISTINCT trigger_name, event_manipulation, event_object_table
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  `)
  console.log(`\nTriggers (${trRes.rows.length}):`)
  for (const tr of trRes.rows) {
    console.log(`  - ${tr.event_object_table}: ${tr.trigger_name} (${tr.event_manipulation})`)
  }

  // 5. Constraints on core tables
  const cRes = await client.query(`
    SELECT table_name, constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name IN ('products', 'offers', 'product_aliases', 'product_alias_proposals', 'product_images', 'offer_display_images')
    ORDER BY table_name, constraint_type, constraint_name;
  `)
  console.log(`\nCore Table Constraints (${cRes.rows.length}):`)
  for (const c of cRes.rows) {
    console.log(`  - ${c.table_name}: [${c.constraint_type}] ${c.constraint_name}`)
  }

  // 6. Storage Buckets
  const sb = getGuardedSupabaseClient('DEVELOPMENT_TEST')
  const { data: buckets, error: bErr } = await sb.storage.listBuckets()
  console.log(`\nStorage Buckets:`)
  if (bErr) {
    console.error('Error listing buckets:', bErr.message)
  } else {
    for (const b of buckets || []) {
      console.log(`  - ${b.id} (public: ${b.public}, fileSizeLimit: ${b.file_size_limit})`)
    }
  }

  await client.end()
}

auditDevSchema().catch(console.error)

