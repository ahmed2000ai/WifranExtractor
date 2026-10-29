import * as fs from 'fs'
import * as path from 'path'
import { annotationService } from '../src/main/training/annotationService'

function runDatasetVerify() {
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Dataset Verifier')
  console.log('═══════════════════════════════════════════════════\n')

  annotationService.bootstrapEmptyDataset()

  const baseDir = path.join(process.cwd(), 'training-data', 'offer-block-detector')
  
  const indexPath = path.join(baseDir, 'dataset-index.json')
  if (!fs.existsSync(indexPath)) {
    console.log('❌ Base directory missing:', baseDir)
    process.exit(1)
  }

  let index: any
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  } catch {
    console.log('❌ Invalid index JSON')
    process.exit(1)
  }

  const annotationsDir = path.join(baseDir, 'annotations')
  const negativeDir = path.join(baseDir, 'negative_examples')
  const annotations: any[] = []

  const loadAnns = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) return
    for (const f of fs.readdirSync(dirPath)) {
      if (f.endsWith('.json')) {
        try {
          annotations.push(JSON.parse(fs.readFileSync(path.join(dirPath, f), 'utf8')))
        } catch {
          console.log(`❌ Corrupt annotation JSON: ${f}`)
          process.exit(1)
        }
      }
    }
  }

  loadAnns(annotationsDir)
  loadAnns(negativeDir)

  let hasErrors = false
  const ids = new Set<string>()
  const pages = new Set<string>()
  let eligibleCount = 0
  let excludedCount = 0
  const leaflets = new Set<string>()

  for (const ann of annotations) {
    if (ids.has(ann.annotation_id)) {
      console.log(`❌ Duplicate annotation ID: ${ann.annotation_id}`)
      hasErrors = true
    }
    ids.add(ann.annotation_id)

    const pageId = `${ann.source.leaflet_file_name}_${ann.image.page_number}`
    if (pages.has(pageId)) {
      console.log(`❌ Duplicate page identity: ${pageId}`)
      hasErrors = true
    }
    pages.add(pageId)

    if (!ann.source.supermarket_code) {
      console.log(`❌ Invalid supermarket code: missing in ${ann.annotation_id}`)
      hasErrors = true
    }

    if (ann.source.leaflet_file_name) {
      leaflets.add(ann.source.leaflet_file_name)
    }

    if (!fs.existsSync(ann.image.training_image_path)) {
      console.log(`❌ Missing image file: ${ann.image.training_image_path}`)
      hasErrors = true
    }

    if (ann.quality.eligible_for_training) {
      eligibleCount++
    } else {
      excludedCount++
    }

    // Check bounds
    for (const b of ann.confirmed?.boxes || []) {
      if (b.x < 0 || b.y < 0 || b.width <= 0 || b.height <= 0 || b.x + b.width > ann.image.width || b.y + b.height > ann.image.height) {
        console.log(`❌ Invalid box bounds in ${ann.annotation_id}: ${JSON.stringify(b)}`)
        hasErrors = true
      }
    }
  }

  const splitsDir = path.join(baseDir, 'splits')
  if (fs.existsSync(splitsDir) && fs.existsSync(path.join(splitsDir, 'train.json')) && fs.existsSync(path.join(splitsDir, 'val.json'))) {
      try {
          const train = JSON.parse(fs.readFileSync(path.join(splitsDir, 'train.json'), 'utf8'))
          const val = JSON.parse(fs.readFileSync(path.join(splitsDir, 'val.json'), 'utf8'))
          const trainLeaflets = new Set(train.map((a: any) => a.leaflet))
          for (const v of val) {
              if (trainLeaflets.has(v.leaflet)) {
                  console.log(`❌ Leaflet split leakage: ${v.leaflet} found in both train and val`)
                  hasErrors = true
              }
          }
      } catch (e) {}
  }

  if (hasErrors) {
    console.log('\nDataset integrity: INVALID')
    process.exit(1)
  }

  console.log('Dataset integrity: VALID')
  console.log(`Eligible annotations: ${eligibleCount}`)
  console.log(`Excluded annotations: ${excludedCount}`)
  console.log(`Distinct leaflets: ${leaflets.size}`)
  
  const required = 50
  if (eligibleCount >= required) {
    console.log('Training readiness: READY')
  } else {
    console.log('Training readiness: NOT READY')
  }
  console.log(`Required eligible pages: ${required}`)

  process.exit(0)
}

try {
  runDatasetVerify()
} catch (err: any) {
  console.error('Verify failed:', err)
  process.exit(1)
}
