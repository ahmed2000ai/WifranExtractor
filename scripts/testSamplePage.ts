import { runOcrPipeline } from '../src/main/ocr/ocrPipelineService'
import { join } from 'path'
import { mkdir, copyFile } from 'fs/promises'
import * as fs from 'fs'

// Note: To run this, you need to compile a PDF from the sample JPG.
import { PDFDocument } from 'pdf-lib'

async function run() {
  console.log('Testing OCR Pipeline with sample page...')
  
  const sampleImagePath = 'C:\\Users\\AHMED\\.gemini\\antigravity-ide\\brain\\8071cac9-6dd0-47b0-bc7e-467b3a27d4b0\\media__1780884916833.jpg'
  
  if (!fs.existsSync(sampleImagePath)) {
    console.error('Sample image not found at', sampleImagePath)
    process.exit(1)
  }

  const workspaceId = `test-import-${Date.now()}`
  const basePath = join(__dirname, '..', 'tmp', workspaceId)
  const chunksPath = join(basePath, 'chunks')
  const pagesPath = join(basePath, 'pages')
  const pdfPath = join(chunksPath, 'chunk-1.pdf')
  
  await mkdir(chunksPath, { recursive: true })
  await mkdir(pagesPath, { recursive: true })

  // 1. Copy the image to pages path (simulate rendered page)
  const renderedPagePath = join(pagesPath, 'page-1.jpg')
  await copyFile(sampleImagePath, renderedPagePath)
  
  console.log('Generating dummy PDF chunk from image...')
  // 2. Generate a PDF from the image to simulate a chunk
  const doc = await PDFDocument.create()
  const imageBytes = await fs.promises.readFile(sampleImagePath)
  const image = await doc.embedJpg(imageBytes)
  const page = doc.addPage([image.width, image.height])
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  
  const pdfBytes = await doc.save()
  await fs.promises.writeFile(pdfPath, pdfBytes)

  const input = {
    workspacePath: basePath,
    chunks: [
      {
        chunkId: 'chunk-1',
        chunkIndex: 0,
        originalPageNumbers: [1],
        chunkPdfPath: pdfPath
      }
    ],
    renderedPages: [
      {
        pageNumber: 1,
        imagePath: renderedPagePath
      }
    ]
  }

  console.log('Starting runOcrPipeline...')
  try {
    const result = await runOcrPipeline(input, (event) => {
      console.log(`[PROGRESS] ${event.stage}: ${event.message}`)
    })

    console.log('\n✅ Pipeline Result:')
    console.log(JSON.stringify(result, null, 2))
    
    if (result.ok) {
      console.log(`\n🎉 Successfully extracted ${result.totalExtractedItems} items!`)
    } else {
      console.error('\n❌ Pipeline failed:', result.error)
    }
  } catch (error) {
    console.error('\n❌ Fatal Error running pipeline:', error)
  }
}

run()
