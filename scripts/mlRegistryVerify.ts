import * as fs from 'fs'
import * as path from 'path'

function runRegistryVerify() {
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Model Registry Verifier')
  console.log('═══════════════════════════════════════════════════\n')

  const regPath = path.join(process.cwd(), 'models', 'offer-block-detector', 'registry.json')
  if (!fs.existsSync(regPath)) {
    console.log('✅ Active model: none')
    console.log('✅ Inference mode: local CV fallback')
    console.log('✅ Auto-acceptance: disabled')
    process.exit(0)
  }

  let reg: any
  try {
    reg = JSON.parse(fs.readFileSync(regPath, 'utf8'))
  } catch {
    console.log('❌ Invalid registry JSON')
    process.exit(1)
  }

  let hasErrors = false

  if (reg.active_model_id) {
    const active = reg.models?.find((m: any) => m.model_id === reg.active_model_id)
    if (!active) {
      console.log(`❌ active_model_id ${reg.active_model_id} not found in models array`)
      hasErrors = true
    } else {
      if (active.status !== 'active') {
        console.log(`❌ Active model ${reg.active_model_id} has status ${active.status}, expected 'active'`)
        hasErrors = true
      }
      if (!active.onnx_model_path || !fs.existsSync(active.onnx_model_path)) {
        console.log(`❌ Active ONNX model file missing: ${active.onnx_model_path}`)
        hasErrors = true
      }
      if (active.evaluation_kind !== 'real') {
        console.log(`❌ Active model lacks real evaluation report.`)
        hasErrors = true
      }
      if (active.onnx_verification_kind !== 'real') {
        console.log(`❌ Active model lacks real ONNX verification.`)
        hasErrors = true
      }
    }
  }

  const activeCount = reg.models?.filter((m: any) => m.status === 'active').length || 0
  if (activeCount > 1) {
    console.log(`❌ Multiple models have 'active' status. Only 1 allowed.`)
    hasErrors = true
  }

  if (hasErrors) {
    console.log('\n❌ Registry verification FAILED')
    process.exit(1)
  } else {
    console.log(`✅ Active model: ${reg.active_model_id || 'none'}`)
    console.log(`✅ Inference mode: ${reg.active_model_id ? 'ONNX Local Detector' : 'local CV fallback'}`)
    console.log(`✅ Auto-acceptance: ${reg.active_model_id ? 'enabled (subject to thresholds)' : 'disabled'}`)
    process.exit(0)
  }
}

try {
  runRegistryVerify()
} catch (err: any) {
  console.error('Verify failed:', err)
  process.exit(1)
}
