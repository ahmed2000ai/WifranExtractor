import { createGuardedPgClient, resolveDatabaseConfig } from '../src/main/db/databaseEnvironmentResolver'
import fs from 'fs'
import path from 'path'

const MIGRATIONS_TO_APPLY = [
  {
    id: '011_wifran_mvp_candidate_consumer_visibility.sql',
    path: 'project-knowledge/wifran_docs/011_wifran_mvp_candidate_consumer_visibility.sql'
  },
  {
    id: '012_wifran_offer_display_image_precedence.sql',
    path: 'project-knowledge/wifran_docs/012_wifran_offer_display_image_precedence.sql'
  },
  {
    id: '013_wifran_product_verification_defaults.sql',
    path: 'project-knowledge/wifran_docs/013_wifran_product_verification_defaults.sql'
  }
]

async function deployStageAToDev() {
  console.log('=================================================================')
  console.log('  CONTROLLED STAGE A DEPLOYMENT TO DEV (gykrbpykjhpyrdrinkuk)   ')
  console.log('=================================================================')

  const config = resolveDatabaseConfig('DEVELOPMENT_TEST')
  console.log(`Context: ${config.context}`)
  console.log(`Target Project Ref: ${config.projectRef}`)
  console.log(`Target Host: ${config.dbHost}`)

  if (config.projectRef !== 'gykrbpykjhpyrdrinkuk') {
    throw new Error(`CRITICAL ABORT: Target project ref is "${config.projectRef}", expected "gykrbpykjhpyrdrinkuk"!`)
  }

  // Confirm backup exists
  const backupDir = path.resolve(process.cwd(), 'backups/dev_stage_a')
  const backupFiles = fs.readdirSync(backupDir).filter(f => f.startsWith('dev_backup_') && f.endsWith('.json'))
  if (backupFiles.length === 0) {
    throw new Error('CRITICAL ABORT: No dev recovery backup found in backups/dev_stage_a/!')
  }
  console.log(`Verified restorable recovery backup: ${backupFiles[backupFiles.length - 1]}`)

  const client = createGuardedPgClient('DEVELOPMENT_TEST')
  await client.connect()

  try {
    // 1. Confirm migration history
    const existingMigRes = await client.query<{ id: string }>(`
      SELECT id FROM public._applied_migrations ORDER BY applied_at;
    `)
    const appliedSet = new Set(existingMigRes.rows.map(r => r.id))
    console.log('\nCurrently applied migrations in DEV:', Array.from(appliedSet))

    if (appliedSet.has('011_wifran_mvp_candidate_consumer_visibility.sql')) {
      console.warn('NOTE: 011 is already recorded in _applied_migrations.')
    }

    // 2. Apply migrations in strict sequential order
    for (const mig of MIGRATIONS_TO_APPLY) {
      console.log(`\n-----------------------------------------------------------------`)
      console.log(`Applying Migration: ${mig.id}`)
      console.log(`Source File: ${mig.path}`)

      const fullPath = path.resolve(process.cwd(), mig.path)
      const sql = fs.readFileSync(fullPath, 'utf8')

      const startMs = Date.now()
      try {
        await client.query(sql)
        await client.query(
          `INSERT INTO public._applied_migrations (id, applied_at)
           VALUES ($1, now())
           ON CONFLICT (id) DO UPDATE SET applied_at = now();`,
          [mig.id]
        )
        const durationMs = Date.now() - startMs
        console.log(`✓ Migration ${mig.id} applied successfully in ${durationMs}ms!`)
      } catch (err: any) {
        console.error(`\n❌ FAILED applying migration ${mig.id}!`)
        console.error(`Error details: ${err?.message || err}`)
        console.error('ABORTING deployment. No further migrations will be executed.')
        throw err
      }
    }

    console.log('\n=================================================================')
    console.log('  ALL STAGE A MIGRATIONS APPLIED SUCCESSFULLY TO DEV            ')
    console.log('=================================================================')

  } finally {
    await client.end()
  }
}

deployStageAToDev().catch((err) => {
  console.error('\nDeployment aborted with fatal error:', err)
  process.exit(1)
})
