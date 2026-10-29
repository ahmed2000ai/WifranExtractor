const fs = require('fs/promises')
async function test() {
  try {
    console.log('starting rm')
    await fs.rm('F:\\Work\\AI Projects\\wifran-offers-extractor\\Extracts\\Othaim_week24', { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    console.log('rm completed')
  } catch(e) {
    console.error('error', e)
  }
}
test()
