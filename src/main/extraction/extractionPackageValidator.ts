import fs from 'fs'
import path from 'path'
import { ExtractionManifest, ExtractionPackageValidationResult, ExtractionPackageScanResult } from '../../shared/types/extractionManifest'

function countFilesInDir(dirPath: string, ext?: string): number {
  if (!fs.existsSync(dirPath)) return 0
  try {
    let count = 0
    const traverse = (currentDir: string) => {
      const files = fs.readdirSync(currentDir)
      for (const file of files) {
        const fullPath = path.join(currentDir, file)
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          traverse(fullPath)
        } else {
          if (!ext || file.endsWith(ext)) {
            count++
          }
        }
      }
    }
    traverse(dirPath)
    return count
  } catch (err) {
    return 0
  }
}

export async function validateExtractionPackage(packagePath: string, manifest: ExtractionManifest): Promise<ExtractionPackageValidationResult> {
  const result: ExtractionPackageValidationResult = {
    ok: false,
    dbEligible: false,
    warnings: [],
    errors: []
  }

  // Basic structure check
  const pdfPath = path.join(packagePath, manifest.paths.pdf)
  if (!fs.existsSync(pdfPath)) {
    result.errors.push({ code: 'EXTRACTION_PACKAGE_PDF_MISSING', message: 'Original PDF is missing' })
  }

  const pagesDir = path.join(packagePath, manifest.paths.pages_dir)
  if (!fs.existsSync(pagesDir)) {
    result.errors.push({ code: 'EXTRACTION_PACKAGE_PAGES_MISSING', message: 'Pages directory is missing' })
  }

  // Scan counts
  const scan = await scanExtractionPackageFiles(packagePath, manifest)
  
  if (scan.counts.orphan_json_files > 0) {
    result.warnings.push({ code: 'EXTRACTION_PACKAGE_ORPHAN_JSON_FILES', message: `Found ${scan.counts.orphan_json_files} JSON files without matching crop images.` })
  }

  if (scan.counts.orphan_crop_images > 0) {
    result.warnings.push({ code: 'EXTRACTION_PACKAGE_ORPHAN_CROP_FILES', message: `Found ${scan.counts.orphan_crop_images} crop images without matching JSON files.` })
  }

  // DB Eligibility Check
  let dbEligible = true
  if (scan.counts.matched_crop_json_pairs === 0) {
    result.errors.push({ code: 'EXTRACTION_PACKAGE_NO_MATCHED_ITEMS', message: 'No matched crop + JSON pairs found for DB sync.' })
    dbEligible = false
  }
  
  if (!manifest.supermarket?.id) {
    result.errors.push({ code: 'EXTRACTION_PACKAGE_METADATA_INCOMPLETE', message: 'Supermarket is not selected' })
    dbEligible = false
  }
  if (!manifest.location?.location_scope) {
    result.errors.push({ code: 'EXTRACTION_PACKAGE_METADATA_INCOMPLETE', message: 'Location is not selected' })
    dbEligible = false
  }
  if (!manifest.offer_dates?.valid_from || !manifest.offer_dates?.valid_to) {
    result.errors.push({ code: 'EXTRACTION_PACKAGE_METADATA_INCOMPLETE', message: 'Offer dates are missing' })
    dbEligible = false
  }

  result.dbEligible = dbEligible
  result.ok = result.errors.length === 0

  return result
}

export async function scanExtractionPackageFiles(packagePath: string, manifest: ExtractionManifest): Promise<ExtractionPackageScanResult> {
  const result: ExtractionPackageScanResult = {
    counts: {
      ...manifest.counts,
      pages_rendered: countFilesInDir(path.join(packagePath, manifest.paths.pages_dir), '.png'),
      crop_images: 0,
      json_files: 0,
      matched_crop_json_pairs: 0,
      orphan_crop_images: 0,
      orphan_json_files: 0
    },
    errors: [],
    warnings: []
  }

  const cropsDir = path.join(packagePath, manifest.paths.crops_dir)
  const jsonDir = path.join(packagePath, manifest.paths.json_dir)

  const cropFiles = new Set<string>()
  const jsonFiles = new Set<string>()

  if (fs.existsSync(cropsDir)) {
    const traverseCrops = (currentDir: string) => {
      const files = fs.readdirSync(currentDir)
      for (const file of files) {
        const fullPath = path.join(currentDir, file)
        if (fs.statSync(fullPath).isDirectory()) {
          traverseCrops(fullPath)
        } else if (file.endsWith('.webp') || file.endsWith('.jpg') || file.endsWith('.png')) {
          const basename = path.basename(file, path.extname(file))
          cropFiles.add(basename)
          result.counts.crop_images++
        }
      }
    }
    traverseCrops(cropsDir)
  }

  if (fs.existsSync(jsonDir)) {
    const traverseJson = (currentDir: string) => {
      const files = fs.readdirSync(currentDir)
      for (const file of files) {
        const fullPath = path.join(currentDir, file)
        if (fs.statSync(fullPath).isDirectory()) {
          traverseJson(fullPath)
        } else if (file.endsWith('.json')) {
          const basename = path.basename(file, '.json')
          jsonFiles.add(basename)
          result.counts.json_files++
        }
      }
    }
    traverseJson(jsonDir)
  }

  // Count matches and orphans
  let matched = 0
  let orphanCrops = 0
  let orphanJsons = 0

  for (const crop of cropFiles) {
    if (jsonFiles.has(crop)) {
      matched++
    } else {
      orphanCrops++
    }
  }

  for (const json of jsonFiles) {
    if (!cropFiles.has(json)) {
      orphanJsons++
    }
  }

  result.counts.matched_crop_json_pairs = matched
  result.counts.orphan_crop_images = orphanCrops
  result.counts.orphan_json_files = orphanJsons

  // Update manifest with new counts inside memory, saving it is up to the caller if needed
  return result
}
