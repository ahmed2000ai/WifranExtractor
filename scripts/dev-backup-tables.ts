import { createGuardedPgClient, resolveDatabaseConfig } from '../src/main/db/databaseEnvironmentResolver'
import fs from 'fs'
import path from 'path'

async function backupDevTables() {
  const config = resolveDatabaseConfig('DEVELOPMENT_TEST')
  console.log('=== CAPTURING DEV DATABASE RECOVERY BACKUP ===')
  if (config.projectRef !== 'gykrbpykjhpyrdrinkuk') {
    throw new Error('Safety guard: Not connected to DEV!')
  }

  const client = createGuardedPgClient('DEVELOPMENT_TEST')
  await client.connect()

  const backupDir = path.resolve(process.cwd(), 'backups/dev_stage_a')
  fs.mkdirSync(backupDir, { recursive: true })

  try {
    const tables = [
      '_applied_migrations', 'supermarkets', 'products', 'offers',
      'product_images', 'offer_display_images', 'categories', 'brands',
      'cities', 'regions', 'publication_operations', 'publication_journal_mutations'
    ]

    const fullDump: Record<string, any[]> = {}

    for (const tbl of tables) {
      try {
        const res = await client.query(`SELECT * FROM public.${tbl};`)
        fullDump[tbl] = res.rows
        console.log(`- Dumped public.${tbl}: ${res.rows.length} rows`)
      } catch (err: any) {
        console.log(`- Skipping ${tbl} (not present or error: ${err?.message})`)
      }
    }

    // Capture views
    const viewRes = await client.query(`
      SELECT table_name, view_definition
      FROM information_schema.views
      WHERE table_schema = 'public';
    `)
    fullDump['_views'] = viewRes.rows

    const backupFile = path.join(backupDir, `dev_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(backupFile, JSON.stringify(fullDump, null, 2))
    console.log(`\nRecovery snapshot captured successfully: ${backupFile}`)
  } finally {
    await client.end()
  }
}

backupDevTables().catch((err) => {
  console.error('Backup failed:', err)
  process.exit(1)
})
