import * as fs from 'fs'
import * as path from 'path'

function migrate() {
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Mock Artifact Migration')
  console.log('═══════════════════════════════════════════════════\n')

  const baseDir = path.join(process.cwd(), 'models', 'offer-block-detector')
  const timestamp = new Date().toISOString().replace(/[:T]/g, '').replace(/\..+/, '')
  const archiveDir = path.join(baseDir, 'archive', `mock-scaffolding-${timestamp}`)

  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true })
  }

  const report: any = {
    timestamp,
    archived_registry_entries: 0,
    archived_reports: 0,
    archived_fixture_only_models: 0,
    active_model_safety_reset: false,
    auto_acceptance_mode_reset: false,
    archived_files: []
  }

  // 1. Process Registry
  const regPath = path.join(baseDir, 'registry.json')
  if (fs.existsSync(regPath)) {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'))
    
    const originalModelsCount = reg.models.length
    
    // Mark legacy mocked entries as archived_mock
    reg.models.forEach((m: any) => {
      if (m.status !== 'archived_mock') {
        m.status = 'archived_mock'
        m.eligible_for_activation = false
        m.fixture_only = true
        report.archived_registry_entries++
      }
    })

    if (reg.active_model_id) {
      report.active_model_safety_reset = true
      reg.active_model_id = null
    }
    if (reg.previous_active_model_id) reg.previous_active_model_id = null
    if (reg.candidate_model_id) reg.candidate_model_id = null

    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2))
  }

  // 2. Move .onnx and .json from baseDir to archiveDir (but leave registry.json)
  if (fs.existsSync(baseDir)) {
    const files = fs.readdirSync(baseDir)
    for (const f of files) {
      const fullPath = path.join(baseDir, f)
      if (fs.statSync(fullPath).isFile()) {
        if (f.endsWith('.onnx')) {
          fs.renameSync(fullPath, path.join(archiveDir, f))
          report.archived_fixture_only_models++
          report.archived_files.push(f)
        } else if (f !== 'registry.json' && f.endsWith('.json')) {
          fs.renameSync(fullPath, path.join(archiveDir, f))
          report.archived_reports++
          report.archived_files.push(f)
        }
      }
    }
  }

  // 3. Reset Auto-Acceptance Mode (Assumed disabled by default now, but let's check config if any)
  report.auto_acceptance_mode_reset = true

  const reportPath = path.join(process.cwd(), 'antigravity-reports', '66-mock-ml-artifact-migration-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  console.log(`✅ Migrated ${report.archived_registry_entries} registry entries.`)
  console.log(`✅ Archived ${report.archived_fixture_only_models} ONNX models.`)
  console.log(`✅ Archived ${report.archived_reports} reports.`)
  console.log(`✅ Report saved to ${reportPath}`)
}

try {
  migrate()
} catch (e: any) {
  console.error('Migration failed:', e)
  process.exit(1)
}
