import { buildMinimalOcrPrompt, buildMinimalOcrSchema } from '../src/main/ocr/minimalOcrPromptBuilder'
import { minimalOcrResponseSchema } from '../src/shared/schemas/minimalOcrSchema'
import { renderPdfPages } from '../src/main/pdf/pdfRenderer'
import sharp from 'sharp'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import * as fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({ path: join(__dirname, '..', '.env.local') })

// Simple argument parser
const args = process.argv.slice(2)
let outDir = join(__dirname, '..', 'ocr-test-output')
let specificPdf: string | null = null
let specificPage: string = '1'

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pdf' && args[i+1]) specificPdf = args[++i]
  else if (args[i] === '--pages' && args[i+1]) specificPage = args[++i]
  else if (args[i] === '--out' && args[i+1]) outDir = args[++i]
}

const defaultPdfs = [
  { path: join(__dirname, '..', 'tests', 'ocr-crop', 'chunk-001-pages-001-001.pdf'), page: 1 },
  { path: join(__dirname, '..', 'tests', 'ocr-crop', 'chunk-036-pages-036-036.pdf'), page: 36 },
  { path: join(__dirname, '..', 'tests', 'ocr-crop', 'chunk-052-pages-052-052.pdf'), page: 52 }
]

const jobs = specificPdf 
  ? [{ path: specificPdf, page: Number(specificPage.split('-')[0]) }]
  : defaultPdfs

async function run() {
  console.log('Starting Minimal Mistral OCR Diagnostic Test...')
  console.log(`Out: ${outDir}`)

  await mkdir(outDir, { recursive: true })

  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('MISTRAL_API_KEY is missing')

  const summary = {
    model: 'mistral-ocr-latest',
    total_pages: jobs.length,
    total_items: 0,
    pages: [] as any[]
  }

  const pageCounts: Record<number, number> = {}

  for (const job of jobs) {
    if (!fs.existsSync(job.path)) {
      console.error(`PDF not found: ${job.path}`)
      continue
    }

    console.log(`\nProcessing page ${job.page} from ${job.path}...`)
    
    const tmpPagesDir = join(outDir, 'pages')
    await mkdir(tmpPagesDir, { recursive: true })
    
    // Render PDF (assuming single-page chunks where physical page is 1)
    const renderedPages = await renderPdfPages(job.path, tmpPagesDir, 200, 1)
    if (renderedPages.length === 0) {
      console.error(`Page ${job.page} failed to render.`)
      continue
    }
    
    const page = renderedPages[0]
    page.pageNumber = job.page // Set logical page number
    
    // Read page image
    const pageBuffer = await sharp(page.imagePath).jpeg({ quality: 90 }).toBuffer()
    const pageDataUrl = `data:image/jpeg;base64,${pageBuffer.toString('base64')}`

    const requestBody = {
      model: 'mistral-ocr-latest', // Strict requirement
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildMinimalOcrPrompt() },
            { type: 'image_url', image_url: pageDataUrl }
          ]
        }
      ],
      response_format: buildMinimalOcrSchema(),
      temperature: 0
    }

    // Call Mistral API directly (no queue, no retry for this pure test)
    console.log(`Calling mistral-ocr-2512...`)
    let response
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }

      response = await res.json()
    } catch (e: any) {
      console.error(`Page ${page.pageNumber} failed:`, e.message)
      continue
    }

    const contentStr = response.choices?.[0]?.message?.content
    if (!contentStr) {
      console.error(`Page ${page.pageNumber} returned no content.`)
      continue
    }

    let parsed: any
    try {
      parsed = JSON.parse(contentStr)
    } catch (e) {
      console.error(`Page ${page.pageNumber} returned invalid JSON:`, contentStr)
      continue
    }

    // Strict validation
    let validationPassed = false
    try {
      const validated = minimalOcrResponseSchema.parse(parsed)
      parsed = validated
      validationPassed = true
    } catch (e: any) {
      console.error(`Page ${page.pageNumber} schema validation failed:`)
      console.error(JSON.stringify(e.issues || e, null, 2))
      console.log('Keeping raw parsed output for debugging despite validation failure.')
    }

    const itemCount = parsed.items ? parsed.items.length : 0
    pageCounts[page.pageNumber] = itemCount
    summary.total_items += itemCount

    const outFilename = `page-${String(page.pageNumber).padStart(3, '0')}-minimal-ocr.json`
    const outPath = join(outDir, outFilename)
    await writeFile(outPath, JSON.stringify(parsed, null, 2))

    summary.pages.push({
      page_number: page.pageNumber,
      item_count: itemCount,
      output_file: outFilename,
      validation_passed: validationPassed
    })

    console.log(`Saved ${itemCount} items to ${outFilename}`)

    // Rate limit safety
    if (job !== jobs[jobs.length - 1]) {
      console.log(`Waiting 5s before next Mistral request...`)
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  // Save summary
  const summaryPath = join(outDir, 'minimal-ocr-summary.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2))

  console.log(`\n============================================================`)
  console.log(`Minimal OCR test completed.`)
  console.log(`Model: ${summary.model}`)
  for (const pageNum of Object.keys(pageCounts)) {
    console.log(`Page ${pageNum}: ${pageCounts[Number(pageNum)]} items`)
  }
  console.log(`Total: ${summary.total_items} items`)
  console.log(`Output folder: ${outDir}`)
  console.log(`Schema validation: ${summary.pages.every(p => p.validation_passed) ? 'passed' : 'FAILED'}`)
  console.log(`No cropping, coordinates, DB writes, image upload, or sync were performed.`)
  console.log(`============================================================\n`)
}

run().catch(console.error)
