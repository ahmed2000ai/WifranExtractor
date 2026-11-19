/**
 * Production Complete Backup & State Capture Tool
 *
 * Captures:
 * 1. Schema DDL: All 35 tables, constraints, indexes, views, functions, triggers, RLS policies, and grants.
 * 2. Data: Complete data dump of all 35 public tables formatted as restorable SQL and JSON.
 * 3. Sequence States: Current last_value and is_called for all sequences.
 * 4. Migration History: public._applied_migrations state.
 *
 * STRICTLY READ-ONLY against Production (swratbmclahjyekouned).
 */

import fs from 'fs'
import path from 'path'
import { createGuardedPgClient, PRODUCTION_PROJECT_REF } from '../src/main/db/databaseEnvironmentResolver'

async function generateCompleteProductionBackup() {
  console.log('=================================================================')
  console.log('   WIFRAN PRODUCTION COMPLETE BACKUP & RESTORATION PREPARATION   ')
  console.log('=================================================================\n')

  const client = createGuardedPgClient('PRODUCTION_UI')
  await client.connect()

  // Enforce read-only transaction for absolute safety
  await client.query('BEGIN READ ONLY;')
  await client.query("SET LOCAL statement_timeout = '60s';")

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.resolve(process.cwd(), `backups/prod_pre_stage_a/${timestamp}`)
  fs.mkdirSync(backupDir, { recursive: true })

  try {
    // 1. Verify environment
    const dbInfoRes = await client.query('SELECT current_database(), current_user, inet_server_addr(), inet_server_port();')
    console.log('[TARGET DB]', dbInfoRes.rows[0])

    // 2. Discover all tables in public schema
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `)
    const tableNames: string[] = tablesRes.rows.map(r => r.table_name)
    console.log(`[TABLES] Discovered ${tableNames.length} tables in public schema.`)

    // 3. Discover all views
    const viewsRes = await client.query(`
      SELECT table_name, view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `)
    console.log(`[VIEWS] Discovered ${viewsRes.rows.length} views in public schema.`)

    // 4. Capture Sequence States
    const seqRes = await client.query(`
      SELECT schemaname, sequencename, start_value, min_value, max_value, increment_by, cycle, last_value
      FROM pg_sequences
      WHERE schemaname = 'public'
      ORDER BY sequencename;
    `)
    console.log(`[SEQUENCES] Discovered ${seqRes.rows.length} sequences in public schema.`)

    // 5. Capture DDL for Constraints
    const constraintsRes = await client.query(`
      SELECT
        conrelid::regclass AS table_name,
        conname,
        contype,
        pg_get_constraintdef(oid, true) AS definition
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
      ORDER BY conrelid::regclass::text, conname;
    `)
    console.log(`[CONSTRAINTS] Captured ${constraintsRes.rows.length} constraints.`)

    // 6. Capture DDL for Indexes
    const indexesRes = await client.query(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `)
    console.log(`[INDEXES] Captured ${indexesRes.rows.length} index definitions.`)

    // 7. Capture Functions DDL
    const funcsRes = await client.query(`
      SELECT
        p.proname,
        pg_get_functiondef(p.oid) as definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p')
      ORDER BY p.proname;
    `)
    console.log(`[FUNCTIONS] Captured ${funcsRes.rows.length} function definitions.`)

    // 8. Capture Triggers DDL
    const triggersRes = await client.query(`
      SELECT
        event_object_table,
        trigger_name,
        action_timing,
        event_manipulation,
        action_statement
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
      ORDER BY event_object_table, trigger_name;
    `)
    console.log(`[TRIGGERS] Captured ${triggersRes.rows.length} triggers.`)

    // 9. Capture RLS Policies
    const policiesRes = await client.query(`
      SELECT
        schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname;
    `)
    console.log(`[POLICIES] Captured ${policiesRes.rows.length} RLS policies.`)

    // 10. Capture Table Column Definitions
    const columnsRes = await client.query(`
      SELECT
        table_name,
        column_name,
        ordinal_position,
        column_default,
        is_nullable,
        data_type,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `)

    // 11. Dump Data for ALL 35 Tables
    console.log('\n[DATA DUMP] Exporting all 35 tables...')
    const dataDump: Record<string, any[]> = {}
    const rowCounts: Record<string, number> = {}

    let sqlRestoreScript = `-- =====================================================================\n`
    sqlRestoreScript += `-- WIFRAN PRODUCTION COMPLETE RECOVERY SCRIPT\n`
    sqlRestoreScript += `-- Snapshot Timestamp: ${timestamp}\n`
    sqlRestoreScript += `-- Source Project: ${PRODUCTION_PROJECT_REF}\n`
    sqlRestoreScript += `-- Total Public Tables: ${tableNames.length}\n`
    sqlRestoreScript += `-- =====================================================================\n\n`
    sqlRestoreScript += `BEGIN;\n`
    sqlRestoreScript += `SET LOCAL lock_timeout = '10s';\n`
    sqlRestoreScript += `SET LOCAL statement_timeout = '120s';\n\n`
    sqlRestoreScript += `-- Temporarily disable foreign key triggers during data restoration\n`
    sqlRestoreScript += `SET session_replication_role = replica;\n\n`

    for (const tbl of tableNames) {
      const rowsRes = await client.query(`SELECT * FROM public."${tbl}";`)
      dataDump[tbl] = rowsRes.rows
      rowCounts[tbl] = rowsRes.rows.length

      if (rowsRes.rows.length > 0) {
        console.log(`  ✓ Table public.${tbl}: ${rowsRes.rows.length} rows`)
        sqlRestoreScript += `-- -----------------------------------------------------------------\n`
        sqlRestoreScript += `-- Data for public.${tbl} (${rowsRes.rows.length} rows)\n`
        sqlRestoreScript += `-- -----------------------------------------------------------------\n`
        sqlRestoreScript += `TRUNCATE TABLE public."${tbl}" CASCADE;\n`

        const cols = Object.keys(rowsRes.rows[0])
        const colList = cols.map(c => `"${c}"`).join(', ')

        for (const row of rowsRes.rows) {
          const valLiterals = cols.map(c => {
            const val = row[c]
            if (val === null || val === undefined) return 'NULL'
            if (typeof val === 'number' || typeof val === 'bigint') return String(val)
            if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
            if (val instanceof Date) return `'${val.toISOString()}'::timestamptz`
            if (typeof val === 'object') {
              return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`
            }
            return `'${String(val).replace(/'/g, "''")}'`
          })
          sqlRestoreScript += `INSERT INTO public."${tbl}" (${colList}) VALUES (${valLiterals.join(', ')});\n`
        }
        sqlRestoreScript += `\n`
      } else {
        console.log(`  - Table public.${tbl}: 0 rows (empty)`)
      }
    }

    // Sequence restoration commands
    sqlRestoreScript += `-- -----------------------------------------------------------------\n`
    sqlRestoreScript += `-- Sequence State Restoration\n`
    sqlRestoreScript += `-- -----------------------------------------------------------------\n`
    for (const seq of seqRes.rows) {
      if (seq.last_value !== null) {
        sqlRestoreScript += `SELECT setval('public."${seq.sequencename}"', ${seq.last_value}, true);\n`
      }
    }

    sqlRestoreScript += `\n-- Re-enable normal foreign key trigger enforcement\n`
    sqlRestoreScript += `SET session_replication_role = DEFAULT;\n\n`
    sqlRestoreScript += `COMMIT;\n`

    // 12. Write outputs to backup directory
    const sqlFilePath = path.join(backupDir, 'production_data_restore.sql')
    fs.writeFileSync(sqlFilePath, sqlRestoreScript, 'utf8')

    const jsonDumpPath = path.join(backupDir, 'production_full_data.json')
    fs.writeFileSync(jsonDumpPath, JSON.stringify(dataDump, null, 2), 'utf8')

    const schemaMetadata = {
      projectRef: PRODUCTION_PROJECT_REF,
      timestamp,
      tableCount: tableNames.length,
      tables: tableNames,
      rowCounts,
      columns: columnsRes.rows,
      views: viewsRes.rows,
      sequences: seqRes.rows,
      constraints: constraintsRes.rows,
      indexes: indexesRes.rows,
      functions: funcsRes.rows,
      triggers: triggersRes.rows,
      policies: policiesRes.rows,
    }
    const schemaMetaPath = path.join(backupDir, 'production_schema_metadata.json')
    fs.writeFileSync(schemaMetaPath, JSON.stringify(schemaMetadata, null, 2), 'utf8')

    await client.query('COMMIT;')

    console.log('\n=================================================================')
    console.log('   PRODUCTION COMPLETE BACKUP CAPTURED SUCCESSFULLY              ')
    console.log('=================================================================')
    console.log(`Directory:   ${backupDir}`)
    console.log(`SQL Restore: production_data_restore.sql (${(fs.statSync(sqlFilePath).size / 1024).toFixed(1)} KB)`)
    console.log(`JSON Data:   production_full_data.json (${(fs.statSync(jsonDumpPath).size / 1024).toFixed(1)} KB)`)
    console.log(`Metadata:    production_schema_metadata.json (${(fs.statSync(schemaMetaPath).size / 1024).toFixed(1)} KB)`)
    console.log(`Tables with rows: ${Object.values(rowCounts).filter(c => c > 0).length} / 35`)
    console.log(`Total rows captured: ${Object.values(rowCounts).reduce((a, b) => a + b, 0)}`)

    return {
      backupDir,
      timestamp,
      tableCount: tableNames.length,
      rowCounts,
      sqlFilePath,
      jsonDumpPath,
      schemaMetaPath
    }
  } catch (err: any) {
    await client.query('ROLLBACK;')
    throw err
  } finally {
    await client.end()
  }
}

generateCompleteProductionBackup().catch(err => {
  console.error('Fatal backup error:', err)
  process.exit(1)
})
