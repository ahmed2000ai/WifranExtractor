const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const sourceArgIndex = args.indexOf('--source')
const nameArgIndex = args.indexOf('--name')

if (sourceArgIndex === -1 || nameArgIndex === -1) {
  console.error('Usage: npm run qa:copy-extraction -- --source <path-to-source> --name <qa-name>')
  process.exit(1)
}

const sourceDir = args[sourceArgIndex + 1]
const qaName = args[nameArgIndex + 1]

if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory does not exist: ${sourceDir}`)
  process.exit(1)
}

const targetDir = path.join(path.dirname(sourceDir), '..', 'Extracts_QA', qaName)

console.log(`Copying extraction package from ${sourceDir} to ${targetDir}...`)

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

copyDir(sourceDir, targetDir)

// Modify manifest to include qa mode marker (optional but helpful)
const manifestPath = path.join(targetDir, 'manifest.json')
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  manifest.qa_mode = true
  manifest.extraction_folder_path = targetDir
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

console.log('Copy complete. QA sandbox ready.')
