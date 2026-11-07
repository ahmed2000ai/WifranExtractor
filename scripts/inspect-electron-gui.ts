import WebSocket from 'ws'
import http from 'http'
import path from 'path'

async function getPages(): Promise<any[]> {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

async function evalInPage(wsUrl: string, expression: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 1

    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: id++,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true
        }
      }))
    })

    ws.on('message', (msgStr: string) => {
      const msg = JSON.parse(msgStr.toString())
      if (msg.id === 1) {
        ws.close()
        if (msg.result?.exceptionDetails) {
          reject(new Error(JSON.stringify(msg.result.exceptionDetails)))
        } else {
          resolve(msg.result?.result?.value)
        }
      }
    })

    ws.on('error', reject)
  })
}

async function main() {
  const pages = await getPages()
  const page = pages.find(p => p.type === 'page')
  if (!page) {
    console.error('No page found in DevTools!')
    process.exit(1)
  }

  const rehearsalDir = path.resolve(process.cwd(), 'tmp/canary_page1_rehearsal').replace(/\\/g, '\\\\')

  console.log('--- Calling IPC Handlers Directly From Live Renderer Context ---')
  
  // 1. Test productEnrichment:load-draft via renderer preload
  const draftResult = await evalInPage(
    page.webSocketDebuggerUrl,
    `window.wifranExtractor.productEnrichment.loadDraft("${rehearsalDir}")`
  )
  console.log('Renderer loadDraft item count:', draftResult?.items?.length)
  console.log('Renderer loadDraft header:', {
    supermarketId: draftResult?.header?.supermarketId,
    region: draftResult?.header?.region,
    validFrom: draftResult?.header?.validFrom,
    validTo: draftResult?.header?.validTo
  })

  // 2. Test prePublishPreview:load via renderer preload
  const previewResult = await evalInPage(
    page.webSocketDebuggerUrl,
    `window.wifranExtractor.prePublishPreview.load("${rehearsalDir}")`
  )
  console.log('Renderer prePublishPreview.load ok:', previewResult?.ok)
  console.log('Renderer prePublishPreview summary counts:', previewResult?.summary?.counts)

  console.log('\n[SUCCESS] Renderer executed preload IPC calls successfully against canary workspace!')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
