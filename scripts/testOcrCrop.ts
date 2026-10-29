import { runOcrPipeline } from '../src/main/ocr/ocrPipelineService'
import { cropImagesForOcrRows } from '../src/main/image/imageCroppingService'
import { renderPdfPages } from '../src/main/pdf/pdfRenderer'
import { join } from 'path'
import { mkdir, copyFile, writeFile } from 'fs/promises'
import * as fs from 'fs'

async function run() {
  console.log('Testing OCR and Cropping workflow...')
  
  const testDir = join(__dirname, '..', 'tests', 'ocr-crop')
  const outputDir = join(testDir, 'test-output')
  const tmpPagesDir = join(outputDir, 'pages')
  
  if (!fs.existsSync(testDir)) {
    console.error('Test directory not found:', testDir)
    process.exit(1)
  }

  await mkdir(outputDir, { recursive: true })
  await mkdir(tmpPagesDir, { recursive: true })
  
  const cropsDir = join(outputDir, 'crops')
  if (fs.existsSync(cropsDir)) {
    fs.rmSync(cropsDir, { recursive: true, force: true })
  }

  const pdfFiles = [
    'chunk-001-pages-001-001.pdf',
    'chunk-036-pages-036-036.pdf',
    'chunk-052-pages-052-052.pdf'
  ]

  let globalChunkIndex = 0
  let totalItemsExtracted = 0
  let totalItemsCropped = 0
  const pageSummaries: { page: number; filename: string; items: number; cropped: number }[] = []

  for (const filename of pdfFiles) {
    const pdfPath = join(testDir, filename)
    if (!fs.existsSync(pdfPath)) {
      console.warn('Skipping missing file:', filename)
      continue
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`--- Processing ${filename} ---`)
    console.log(`${'='.repeat(60)}`)
    
    // Fix the page number, assuming the page number is derived from the filename
    // e.g. "chunk-036-pages-036-036.pdf" -> page 36
    const match = filename.match(/pages-(\d+)-/)
    const pageNum = match ? parseInt(match[1], 10) : 1
    const dstImg = join(tmpPagesDir, `page-${String(pageNum).padStart(3, '0')}.jpg`)

    // 1. Render PDF to image (or reuse existing)
    let renderedPages: any[]
    if (fs.existsSync(dstImg)) {
      console.log(`Reusing existing rendered page: ${dstImg}`)
      const sharp = await import('sharp')
      const metadata = await sharp.default(dstImg).metadata()
      renderedPages = [{
        pageNumber: pageNum,
        imagePath: dstImg,
        width: metadata.width || 0,
        height: metadata.height || 0,
        dpi: 200
      }]
    } else {
      console.log('Rendering page to image...')
      renderedPages = await renderPdfPages(
        pdfPath,
        tmpPagesDir,
        200, // dpi
        1,   // pageCount
        () => {}
      )
      
      // renderPdfPages creates image at tmpPagesDir/page.1.png
      // Let's copy it to the actual page number
      const srcImg = renderedPages[0].imagePath
      await copyFile(srcImg, dstImg)
      
      renderedPages[0].imagePath = dstImg
      renderedPages[0].pageNumber = pageNum
    }

    // 2. Run OCR Pipeline
    console.log('Running OCR...')
    const input = {
      workspacePath: outputDir,
      chunks: [
        {
          chunkId: `chunk-${globalChunkIndex++}`,
          chunkIndex: 0,
          originalPageNumbers: [pageNum],
          chunkPdfPath: pdfPath
        }
      ],
      renderedPages: renderedPages
    }

    const ocrResult = await runOcrPipeline(input, (event) => {
      console.log(`[OCR] ${event.stage}: ${event.message}`)
    })

    if (!ocrResult.ok) {
      console.error(`OCR failed for ${filename}:`, ocrResult.error)
      pageSummaries.push({ page: pageNum, filename, items: 0, cropped: 0 })
      continue
    }

    // Save OCR Result
    const jsonPath = join(outputDir, `ocr-result-page-${pageNum}.json`)
    const validRows = ocrResult.normalizedRows.filter((r: any) => r.status !== 'skipped')
    await writeFile(jsonPath, JSON.stringify(validRows, null, 2))
    console.log(`Saved OCR Result to ${jsonPath} (Valid/Warning items only: ${validRows.length})`)
    totalItemsExtracted += validRows.length

    // Map rows to CropInputRow format
    const cropRows = ocrResult.normalizedRows.map((r: any) => ({
      rowId: r.source.row_id,
      pageNumber: r.source.page_number,
      status: r.status,
      skipReason: r.skip_reason,
      boundingBox: r.bounding_box || r.original?.bounding_box
    }))

    // 3. Crop Images
    console.log('Cropping images...')
    const cropResult = await cropImagesForOcrRows({
      workspacePath: outputDir,
      rows: cropRows,
      renderedPages: renderedPages,
      paddingPercent: 8,
      outputFormat: 'jpg',
      outputQuality: 90
    }, (event) => {
      // ignore verbose progress
    })

    let croppedCount = 0
    if (!cropResult.ok) {
      console.error(`Cropping failed for ${filename}:`, cropResult.error)
    } else {
      croppedCount = cropResult.croppedRows
      totalItemsCropped += croppedCount
      console.log(`Cropped ${croppedCount} items successfully.`)
    }
    pageSummaries.push({ page: pageNum, filename, items: validRows.length, cropped: croppedCount })
  }

  // Print summary
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 EXTRACTION SUMMARY')
  console.log(`${'='.repeat(60)}`)
  for (const s of pageSummaries) {
    console.log(`  Page ${String(s.page).padStart(3, ' ')}: ${String(s.items).padStart(3, ' ')} items extracted, ${String(s.cropped).padStart(3, ' ')} cropped  (${s.filename})`)
  }
  console.log(`${'─'.repeat(60)}`)
  console.log(`  TOTAL: ${totalItemsExtracted} items extracted, ${totalItemsCropped} cropped`)
  console.log(`${'='.repeat(60)}`)
  console.log('\n✅ All tests completed! Check tests/ocr-crop/test-output for results.')
}

run()
