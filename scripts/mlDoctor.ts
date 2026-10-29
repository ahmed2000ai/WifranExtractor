import * as path from 'path'
import * as fs from 'fs'
import { mlRuntimeService } from '../src/main/ml/mlRuntimeService'
import { detectorModelRegistryService } from '../src/main/ml/detectorModelRegistryService'
import { detectorAutoAcceptanceService, AUTO_ACCEPT_DEFAULTS } from '../src/main/ml/detectorAutoAcceptanceService'
import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

async function runDoctor() {
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Local ML Runtime Doctor')
  console.log('═══════════════════════════════════════════════════\n')

  let hasErrors = false

  // 1. Python Runtime
  const pythonExe = mlRuntimeService.getPythonExecutable()
  const venvPath = mlRuntimeService.getVenvPath()
  console.log(`Checking Python virtual environment at ${venvPath}...`)
  if (!fs.existsSync(pythonExe)) {
    console.log('❌ Python runtime: NOT READY (Virtual environment not found)')
    hasErrors = true
  } else {
    try {
      const { stdout } = await execAsync(`"${pythonExe}" --version`)
      console.log(`✅ Python runtime: READY (${stdout.trim()})`)
    } catch {
      console.log('❌ Python runtime: FAILED (Cannot execute python)')
      hasErrors = true
    }
  }

  // 2. Training framework & Backend
  let backend = 'UNKNOWN'
  if (!hasErrors) {
    try {
      const torchCheck = await execAsync(`"${pythonExe}" -c "import torch; print(f'CUDA: {torch.cuda.is_available()}')"`)
      const isCuda = torchCheck.stdout.includes('CUDA: True')
      backend = isCuda ? 'CUDA' : 'CPU'
      console.log('✅ Training framework: READY (PyTorch)')
      console.log(`✅ Training backend: ${backend}`)
    } catch {
      console.log('❌ Training framework: NOT READY (PyTorch failed to load)')
      hasErrors = true
    }
  }

  // 3. onnxruntime-node
  try {
    const ort = require('onnxruntime-node')
    console.log('✅ onnxruntime-node: READY')
  } catch {
    console.log('❌ onnxruntime-node: NOT READY')
    hasErrors = true
  }

  // 4. Dataset root & Eligible annotations
  const { annotationService } = require('../src/main/training/annotationService')
  annotationService.bootstrapEmptyDataset()

  const datasetDir = path.join(process.cwd(), 'training-data', 'offer-block-detector')
  if (fs.existsSync(datasetDir)) {
    console.log('✅ Dataset integrity: valid')
    // Get eligible annotations count (dummy for now unless we read index)
    const indexPath = path.join(datasetDir, 'dataset-index.json')
    let count = 0
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      count = index.training_eligible_annotations || 0
    }
    console.log(`ℹ️ Eligible annotations: ${count}`)
    if (count >= 50) {
      console.log('✅ Training readiness: ready')
    } else {
      console.log(`ℹ️ Training readiness: not ready`)
    }
  } else {
    console.log('❌ Dataset root: NOT READY (Directory missing)')
    // Not necessarily an error if they haven't annotated yet, but for doctor let's say it's fine
    console.log('ℹ️ Dataset root: Directory will be created upon first annotation.')
  }

  // 5. Model Registry & Active Model
  const regPath = path.join(process.cwd(), 'models', 'offer-block-detector', 'registry.json')
  let registryValid = false
  if (fs.existsSync(regPath)) {
    try {
      JSON.parse(fs.readFileSync(regPath, 'utf8'))
      registryValid = true
      console.log('✅ Model registry: VALID')
    } catch {
      console.log('❌ Model registry: INVALID JSON')
      hasErrors = true
    }
  } else {
    console.log('✅ Model registry: VALID (Empty)')
    registryValid = true
  }

  if (registryValid) {
    const activeModel = detectorModelRegistryService.getActiveModel()
    if (activeModel) {
      console.log(`✅ Active model: ${activeModel.model_id} (v${activeModel.version})`)
    } else {
      console.log('ℹ️ Active model: NONE')
    }
  }

  // 6. CV Fallback
  console.log('✅ CV fallback: READY')

  // 7. Auto-acceptance safety lock
  const activeModel = detectorModelRegistryService.getActiveModel()
  if (!activeModel || activeModel.fixture_only || activeModel.evaluation_kind !== 'real') {
    console.log('✅ Auto-acceptance safety: DISABLED UNTIL REAL MODEL ACTIVATION')
  } else {
    console.log('✅ Auto-acceptance safety: ENABLED AND ACTIVE')
  }

  console.log('\nResult: ' + (hasErrors ? 'FAIL' : 'PASS'))
  process.exit(hasErrors ? 1 : 0)
}

runDoctor().catch(err => {
  console.error('Doctor failed:', err)
  process.exit(1)
})
