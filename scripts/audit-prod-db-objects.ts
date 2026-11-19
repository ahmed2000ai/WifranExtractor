import { createGuardedPgClient } from '../src/main/db/databaseEnvironmentResolver'

async function auditProductionDatabaseObjects() {
  const client = createGuardedPgClient('PRODUCTION_UI')
  await client.connect()
  try {
    // 1. All tables in public schema
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `)
    console.log(`\n=== 1. PRODUCTION TABLES (${tablesRes.rows.length} total) ===`)
    console.log(tablesRes.rows.map(r => r.table_name).join(', '))

    // 2. All views in public schema
    const viewsRes = await client.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `)
    console.log(`\n=== 2. PRODUCTION VIEWS (${viewsRes.rows.length} total) ===`)
    console.log(viewsRes.rows.map(r => r.table_name).join(', '))

    // 3. Row counts for all tables
    console.log(`\n=== 3. TABLE ROW COUNTS ===`)
    for (const r of tablesRes.rows) {
      try {
        const cntRes = await client.query(`SELECT count(*)::int as count FROM public."${r.table_name}";`)
        console.log(`- ${r.table_name}: ${cntRes.rows[0].count} rows`)
      } catch (err: any) {
        console.log(`- ${r.table_name}: ERROR (${err.message})`)
      }
    }

    // 4. Custom functions in public schema
    const funcsRes = await client.query(`
      SELECT routine_name, routine_type, data_type
      FROM information_schema.routines
      WHERE specific_schema = 'public'
      ORDER BY routine_name;
    `)
    console.log(`\n=== 4. PUBLIC FUNCTIONS (${funcsRes.rows.length} total) ===`)
    console.log(funcsRes.rows.map(r => `${r.routine_name} (${r.routine_type} -> ${r.data_type})`).join('\n'))

    // 5. Triggers in public schema
    const trigRes = await client.query(`
      SELECT trigger_name, event_manipulation, event_object_table, action_statement
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
      ORDER BY event_object_table, trigger_name;
    `)
    console.log(`\n=== 5. PUBLIC TRIGGERS (${trigRes.rows.length} total) ===`)
    for (const tr of trigRes.rows) {
      console.log(`- [${tr.event_object_table}] ${tr.trigger_name} ON ${tr.event_manipulation}`)
    }

    // 6. RLS Policies
    const rlsRes = await client.query(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname;
    `)
    console.log(`\n=== 6. PUBLIC RLS POLICIES (${rlsRes.rows.length} total) ===`)
    for (const pol of rlsRes.rows) {
      console.log(`- [${pol.tablename}] ${pol.policyname} (${pol.cmd} to ${JSON.stringify(pol.roles)})`)
    }

    // 7. Applied migrations table
    const migRes = await client.query(`
      SELECT id, applied_at FROM public._applied_migrations ORDER BY applied_at;
    `)
    console.log(`\n=== 7. APPLIED MIGRATIONS (${migRes.rows.length} total) ===`)
    for (const m of migRes.rows) {
      console.log(`- ${m.id} (at ${m.applied_at})`)
    }

  } finally {
    await client.end()
  }
}

auditProductionDatabaseObjects().catch(console.error)
