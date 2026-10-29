import * as fs from 'fs'
import * as path from 'path'
import * as ort from 'onnxruntime-node'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function runFixture() {
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  ONNX Inference Fixture')
  console.log('═══════════════════════════════════════════════════\n')

  const mlDir = path.join(process.cwd(), 'ml', 'offer-block-detector')
  const fixturePath = path.join(mlDir, 'test_fixture.onnx')

  if (!fs.existsSync(mlDir)) {
    fs.mkdirSync(mlDir, { recursive: true })
  }

  if (!fs.existsSync(fixturePath)) {
    console.log('Generating deterministic test-only ONNX fixture...')
    try {
      const scriptPath = path.join(process.cwd(), 'scripts', 'generate_onnx_fixture.py')
      const { mlRuntimeService } = await import('../src/main/ml/mlRuntimeService')
      const pythonExe = fs.existsSync(mlRuntimeService.getPythonExecutable()) 
        ? mlRuntimeService.getPythonExecutable() 
        : 'python'
        
      await execAsync(`"${pythonExe}" "${scriptPath}" "${fixturePath}"`, {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
      })
    } catch (e: any) {
      console.log('❌ Failed to generate fixture:', e.message)
      console.log('Ensure Python and PyTorch are installed in the global environment or managed environment to generate the fixture.')
      process.exit(1)
    }
  }

  console.log('✅ onnxruntime-node loaded successfully.')

  try {
    const session = await ort.InferenceSession.create(fixturePath, { executionProviders: ['cpu'] })
    console.log('✅ Model session created.')

    // Create a dummy tensor [1, 3, 960, 960]
    const dims = [1, 3, 960, 960]
    const size = dims.reduce((a, b) => a * b)
    const float32Data = new Float32Array(size)
    const tensor = new ort.Tensor('float32', float32Data, dims)

    console.log('✅ Input tensor created.')

    const feeds: Record<string, ort.Tensor> = {}
    feeds[session.inputNames[0]] = tensor

    const results = await session.run(feeds)
    console.log('✅ Output tensor received.')

    const boxes = results['boxes']
    const labels = results['labels']
    const scores = results['scores']

    if (!boxes || !labels || !scores) {
       throw new Error('Missing output tensors')
    }

    console.log(`✅ Output decoding runs: found ${boxes.dims[1]} boxes.`)
    console.log(`   Box 0 coordinates: [${boxes.data.slice(0, 4).join(', ')}]`)

    // Simple validation of coordinates
    const boxData = boxes.data as Float32Array
    if (boxData[0] === 10 && boxData[1] === 10 && boxData[2] === 50 && boxData[3] === 50) {
      console.log('✅ Coordinates validated and deterministic.')
    } else {
      throw new Error('Coordinates did not match expected deterministic values')
    }

    console.log('\nNote: This is a test-only model, not a production detector. It is not eligible for activation.')
    console.log('\n✅ Fixture inference passed.')
    process.exit(0)
  } catch (err: any) {
    console.log('\n❌ Fixture inference FAILED:', err.message)
    process.exit(1)
  }
}

runFixture().catch(err => {
  console.error(err)
  process.exit(1)
})
