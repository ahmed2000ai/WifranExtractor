import fs from 'fs'
import path from 'path'
import { 
  OpenExtractionPackageResult, 
  DbEligiblePackageItem,
  AvailableExtractionItem
} from '../../shared/types/extractionManifest'
import { 
  loadExtractionManifest, 
  recoverManifestFromExistingFolder, 
  updateExtractionManifest 
} from './extractionManifestService'
import { validateExtractionPackage, scanExtractionPackageFiles } from './extractionPackageValidator'
import { info, error as logError } from '../logging/logger'
import { isOfflineUatMode } from '../config/offlineUatGuard'

export async function openExtractionPackage(packagePath: string): Promise<OpenExtractionPackageResult> {
  if (!fs.existsSync(packagePath)) {
    return { ok: false, error: 'Package folder does not exist.' }
  }

  let manifest = await loadExtractionManifest(packagePath)
  let mode: 'loaded_completed' | 'loaded_incomplete' | 'recovered' = 'loaded_incomplete'

  if (!manifest) {
    info(`No manifest found at ${packagePath}. Recovering...`)
    manifest = await recoverManifestFromExistingFolder(packagePath)
    mode = 'recovered'
  }

  // Rescan counts and update manifest
  const scan = await scanExtractionPackageFiles(packagePath, manifest)
  manifest = await updateExtractionManifest(packagePath, { counts: scan.counts })

  // Validate
  const validation = await validateExtractionPackage(packagePath, manifest)

  if (manifest.extraction_status === 'completed' && validation.ok) {
    mode = 'loaded_completed'
  }

  return {
    ok: true,
    manifest,
    validation,
    mode
  }
}

export async function getDbEligibleItemsFromPackage(packagePath: string): Promise<DbEligiblePackageItem[]> {
  const manifest = await loadExtractionManifest(packagePath)
  if (!manifest) {
    throw new Error('Manifest not found for DB eligible item extraction')
  }

  const items: DbEligiblePackageItem[] = []

  const cropsDir = path.isAbsolute(manifest.paths.crops_dir)
    ? manifest.paths.crops_dir
    : path.join(packagePath, manifest.paths.crops_dir)
  const jsonDir = path.isAbsolute(manifest.paths.json_dir)
    ? manifest.paths.json_dir
    : path.join(packagePath, manifest.paths.json_dir)

  if (!fs.existsSync(jsonDir)) {
    return items
  }

  const sel = manifest.processing_selection
  const selectedPageSet =
    sel?.selectionMode === 'specific' && Array.isArray(sel.selectedPages) && sel.selectedPages.length > 0
      ? new Set(sel.selectedPages)
      : null

  const cropFiles = new Set<string>()
  const cropPathMap = new Map<string, string>() // basename -> full path

  const traverseCrops = (currentDir: string) => {
    const files = fs.readdirSync(currentDir)
    for (const file of files) {
      const fullPath = path.join(currentDir, file)
      if (fs.statSync(fullPath).isDirectory()) {
        traverseCrops(fullPath)
      } else if (file.endsWith('.webp') || file.endsWith('.jpg') || file.endsWith('.png')) {
        const basename = path.basename(file, path.extname(file))
        cropFiles.add(basename)
        cropPathMap.set(basename, fullPath)
      }
    }
  }
  if (fs.existsSync(cropsDir)) {
    traverseCrops(cropsDir)
  }

  const traverseJson = (currentDir: string) => {
    const files = fs.readdirSync(currentDir)
    for (const file of files) {
      const fullPath = path.join(currentDir, file)
      if (fs.statSync(fullPath).isDirectory()) {
        traverseJson(fullPath)
      } else if (file.endsWith('.json')) {
        const isCanonical = file.endsWith('.canonical.json')
        const basename = path.basename(file, '.json')
        if (!cropFiles.has(basename) && !isCanonical) {
          continue
        }

        try {
          const data = fs.readFileSync(fullPath, 'utf8')
          const jsonData = JSON.parse(data)

          // Extract page and item number from basename or canonical metadata
          // legacy example: othaim-week24_001_001
          // canonical example: page-002-001.canonical
          const match = basename.match(/_(\d+)_(\d+)$/)
          const canonMatch = basename.match(/^page-(\d+)-(\d+)\.canonical$/i)
          let pageNumber = 1
          let itemNumber = basename
          if (match) {
            pageNumber = parseInt(match[1], 10)
            itemNumber = match[2]
          } else if (canonMatch) {
            pageNumber = parseInt(canonMatch[1], 10)
            itemNumber = canonMatch[2]
          }

          if (typeof jsonData.source?.source_page_number === 'number') {
            pageNumber = jsonData.source.source_page_number
          } else if (typeof jsonData.source?.page_number === 'number') {
            pageNumber = jsonData.source.page_number
          }
          if (typeof jsonData.source?.source_item_number === 'string' && jsonData.source.source_item_number.trim()) {
            itemNumber = jsonData.source.source_item_number.trim()
          }

          // Strict selected-page isolation: never include unselected-page offers in staged batch
          if (selectedPageSet && !selectedPageSet.has(pageNumber)) {
            continue
          }

          let resolvedCropPath = cropPathMap.get(basename) || ''
          if (!resolvedCropPath && isCanonical && typeof jsonData.source?.crop_path === 'string' && jsonData.source.crop_path.trim()) {
            const candidate = path.isAbsolute(jsonData.source.crop_path)
              ? jsonData.source.crop_path
              : path.join(packagePath, jsonData.source.crop_path)
            if (fs.existsSync(candidate)) {
              resolvedCropPath = candidate
            }
          }
          if (!resolvedCropPath && isCanonical && fs.existsSync(cropsDir)) {
            const pagePadded = String(pageNumber).padStart(3, '0')
            for (const ext of ['webp', 'png', 'jpg', 'jpeg']) {
              const candidate = path.join(cropsDir, `page-${pagePadded}`, `${itemNumber}.${ext}`)
              if (fs.existsSync(candidate)) {
                resolvedCropPath = candidate
                break
              }
            }
          }

          if (!resolvedCropPath) {
            continue
          }

          let resolvedThumbPath: string | null = null
          if (isCanonical && typeof jsonData.source?.thumbnail_path === 'string' && jsonData.source.thumbnail_path.trim()) {
            const candidate = path.isAbsolute(jsonData.source.thumbnail_path)
              ? jsonData.source.thumbnail_path
              : path.join(packagePath, jsonData.source.thumbnail_path)
            if (fs.existsSync(candidate)) {
              resolvedThumbPath = candidate
            }
          }
          if (!resolvedThumbPath && isCanonical && typeof jsonData.image?.thumbnail_path === 'string' && jsonData.image.thumbnail_path.trim()) {
            const candidate = path.isAbsolute(jsonData.image.thumbnail_path)
              ? jsonData.image.thumbnail_path
              : path.join(packagePath, jsonData.image.thumbnail_path)
            if (fs.existsSync(candidate)) {
              resolvedThumbPath = candidate
            }
          }
          if (!resolvedThumbPath && resolvedCropPath) {
            const siblingThumb = path.join(path.dirname(resolvedCropPath), 'product_thumb_crop.webp')
            if (fs.existsSync(siblingThumb)) {
              resolvedThumbPath = siblingThumb
            }
          }

          items.push({
            pageNumber,
            itemNumber,
            cropPath: resolvedCropPath,
            thumbnailPath: resolvedThumbPath,
            jsonPath: fullPath,
            jsonData
          })
        } catch (e) {
          logError(`Failed to parse json file for eligible item: ${fullPath}`)
        }
      }
    }
  }
  traverseJson(jsonDir)

  return items
}

export async function listAvailableExtractions(): Promise<AvailableExtractionItem[]> {
  const workspaceFolder = isOfflineUatMode() ? 'workspaces_uat' : 'Extracts'
  const extractsDir = path.join(process.cwd(), workspaceFolder)
  if (!fs.existsSync(extractsDir)) {
    return []
  }

  const entries = await fs.promises.readdir(extractsDir, { withFileTypes: true })
  const dirNames = entries.filter(e => e.isDirectory()).map(e => e.name)

  const results: AvailableExtractionItem[] = []

  for (const dirName of dirNames) {
    const packagePath = path.join(extractsDir, dirName)
    try {
      const stats = await fs.promises.stat(packagePath)
      const manifest = await loadExtractionManifest(packagePath)

      const reportsDir = path.join(packagePath, 'metadata', 'reports')
      const prePublishPath = path.join(reportsDir, 'pre-publish-preview-summary.json')
      const hasPrePublishSummary = fs.existsSync(prePublishPath)

      const jsonDir = path.join(packagePath, manifest?.paths?.json_dir || 'json')
      let hasCanonicalJson = false
      let canonicalCount = 0
      if (fs.existsSync(jsonDir)) {
        try {
          const jsonFiles = await fs.promises.readdir(jsonDir)
          const canonicalFiles = jsonFiles.filter(f => f.endsWith('.canonical.json'))
          hasCanonicalJson = canonicalFiles.length > 0
          canonicalCount = canonicalFiles.length
        } catch {
          // ignore
        }
      }

      let prePublishItemCount = 0
      if (hasPrePublishSummary) {
        try {
          const reportRaw = JSON.parse(await fs.promises.readFile(prePublishPath, 'utf8'))
          prePublishItemCount = reportRaw.counts?.total_items || (Array.isArray(reportRaw.items) ? reportRaw.items.length : 0)
        } catch {
          // ignore
        }
      }

      const itemCount = prePublishItemCount || canonicalCount || manifest?.counts?.matched_crop_json_pairs || 0
      const canPreview = hasPrePublishSummary || hasCanonicalJson || (manifest?.counts?.matched_crop_json_pairs || 0) > 0 || (manifest?.counts?.crop_images || 0) > 0

      // Page count
      let pageCount = manifest?.page_count || manifest?.counts?.pages_rendered || 0
      if (!pageCount) {
        const pagesDir = path.join(packagePath, 'pages')
        if (fs.existsSync(pagesDir)) {
          try {
            const pageFiles = await fs.promises.readdir(pagesDir)
            pageCount = pageFiles.filter(f => /^page\.\d+\.png$/i.test(f) || /\.png$/i.test(f)).length
          } catch {
            // ignore
          }
        }
      }

      // Crop count
      let cropCount = manifest?.counts?.crop_images || 0
      if (!cropCount) {
        const cropsDir = path.join(packagePath, 'crops')
        if (fs.existsSync(cropsDir)) {
          try {
            cropCount = (await fs.promises.readdir(cropsDir)).length
          } catch {
            // ignore
          }
        }
      }

      results.push({
        folderName: dirName,
        folderPath: packagePath,
        supermarketId: manifest?.supermarket?.id || null,
        supermarketName: manifest?.supermarket?.name || (manifest?.supermarket as any)?.name_en || manifest?.leaflet_filename_metadata?.supermarket_description || null,
        supermarketCode: manifest?.leaflet_filename_metadata?.supermarket_code || null,
        locationLabel: manifest?.location?.display_name || (manifest?.location as any)?.label || manifest?.leaflet_filename_metadata?.location_description || null,
        offerDates: manifest?.offer_dates || null,
        extractionStatus: manifest?.extraction_status || (hasPrePublishSummary || hasCanonicalJson ? 'completed' : 'in_progress'),
        dbUpdateStatus: manifest?.db_update_status || 'not_started',
        pageCount,
        cropCount,
        itemCount,
        createdAt: manifest?.created_at || stats.birthtime.toISOString(),
        updatedAt: manifest?.updated_at || stats.mtime.toISOString(),
        hasPrePublishSummary,
        hasCanonicalJson,
        canPreview
      })
    } catch (e: any) {
      logError(`Error inspecting extraction directory ${dirName}: ${e.message}`)
    }
  }

  // Sort by updatedAt descending (newest first)
  results.sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime()
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime()
    return timeB - timeA
  })

  return results
}

