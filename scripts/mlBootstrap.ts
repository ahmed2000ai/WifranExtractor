import { mlRuntimeService } from '../src/main/ml/mlRuntimeService'

async function run() {
  console.log('Bootstrapping ML Runtime...')
  const success = await mlRuntimeService.bootstrapRuntime()
  if (success) {
    console.log('✅ Bootstrap successful')
    process.exit(0)
  } else {
    console.log('❌ Bootstrap failed')
    process.exit(1)
  }
}

run()
