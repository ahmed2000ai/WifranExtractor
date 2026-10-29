import fs from 'fs'
import path from 'path'
import { ExtractionManifest } from '../../shared/types/extractionManifest'
import { error as logError } from '../logging/logger'

const MANIFEST_FILENAME = 'extraction_manifest.json'

export async function createInitialExtractionManifest(input: {
  packagePath: string
  pdfBaseName: string
  pdfFileName: string
  pageCount?: number
  supermarketId?: string | null
  location?: any
  offerDates?: any
  parsedMetadata?: any
}): Promise<ExtractionManifest> {
  const manifest: ExtractionManifest = {
    schema_version: 1,
    extraction_status: 'in_progress',
    db_update_status: 'not_started',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    style_profile_selection: {
      status: 'not_started',
      selected_page_numbers: [],
      profile_path: null,
      selection_path: null,
      started_at: null,
      completed_at: null,
      skipped_at: null,
      error_message: null
    },
    extraction_folder_name: path.basename(input.packagePath),
    pdf_file_name: input.pdfFileName,
    pdf_base_name: input.pdfBaseName,
    page_count: input.pageCount || null,
    processing_scope: {
      mode: 'all_pages',
      pages: []
    },
    supermarket: {
      id: input.supermarketId || null
    },
    location: {
      location_scope: input.location?.locationScope || null,
      city_id: input.location?.cityId || null,
      region_id: input.location?.regionId || null,
      display_name: input.location?.label || null,
      location_slug: input.location?.locationSlug || null
    },
    offer_dates: {
      valid_from: input.offerDates?.offerStartDate || null,
      valid_to: input.offerDates?.offerEndDate || null
    },
    leaflet_filename_metadata: input.parsedMetadata ? {
      source_file_name: input.parsedMetadata.file_name || input.pdfFileName,
      parsed_ok: input.parsedMetadata.ok,
      supermarket_code: input.parsedMetadata.supermarket_code || null,
      supermarket_description: input.parsedMetadata.supermarket_description || null,
      location_code: input.parsedMetadata.location_code || null,
      location_description: input.parsedMetadata.location_description || null,
      promotion_start_date: input.parsedMetadata.promotion_start_date || null,
      errors: input.parsedMetadata.errors || [],
      warnings: input.parsedMetadata.warnings || []
    } : undefined,
    stages: {
      pdf_copy: 'completed',
      page_rendering: 'not_started',
      manual_crop: 'not_started',
      crop_generation: 'not_started',
      item_ocr: 'not_started',
      key_discovery: 'not_started',
      review_package: 'not_started',
      db_update: 'not_started'
    },
    counts: {
      pages_rendered: 0,
      chunks: 0,
      crop_images: 0,
      json_files: 0,
      matched_crop_json_pairs: 0,
      orphan_crop_images: 0,
      orphan_json_files: 0,
      keys_with_values: 0,
      keys_without_values: 0
    },
    paths: {
      pdf: input.pdfFileName,
      chunks_dir: 'chunks',
      pages_dir: 'pages',
      crops_dir: 'crops',
      json_dir: 'json',
      logs_dir: 'logs',
      metadata_dir: 'metadata',
      reports_dir: 'metadata/reports',
      accuracy_run_report: 'metadata/reports/accuracy-run-report.json',
      pre_publish_preview_summary: 'metadata/reports/pre-publish-preview-summary.json',
      manual_crop_layout: 'manual-crop-layout.json',
      flexible_item_ocr_summary: 'flexible-item-ocr-summary.json',
      ocr_returned_keys: 'ocr_returned_keys.json',
      ocr_keys_without_values: 'ocr_keys_without_values.json',
      session_layout_learning_dir: 'metadata/session-layout-learning'
    },
    reports: {
      accuracy_run_report: {
        status: 'not_started',
        path: 'metadata/reports/accuracy-run-report.json',
        updated_at: null
      },
      pre_publish_preview_summary: {
        status: 'not_started',
        path: 'metadata/reports/pre-publish-preview-summary.json',
        updated_at: null
      }
    },
    validation: {
      package_valid: false,
      db_update_eligible: false,
      checked_at: new Date().toISOString(),
      warnings: [],
      errors: []
    }
  }

  await saveExtractionManifest(input.packagePath, manifest)
  return manifest
}

export async function loadExtractionManifest(packagePath: string): Promise<ExtractionManifest | null> {
  let manifestPath = path.join(packagePath, MANIFEST_FILENAME)
  if (!fs.existsSync(manifestPath)) {
    const fallbackPath = path.join(packagePath, 'manifest.json')
    if (fs.existsSync(fallbackPath)) {
      manifestPath = fallbackPath
    } else {
      return null
    }
  }
  try {
    const data = await fs.promises.readFile(manifestPath, 'utf8')
    return JSON.parse(data) as ExtractionManifest
  } catch (err: any) {
    logError(`Failed to load extraction manifest at ${manifestPath}: ${err.message}`)
    return null
  }
}

export async function saveExtractionManifest(packagePath: string, manifest: ExtractionManifest): Promise<void> {
  const manifestPath = path.join(packagePath, MANIFEST_FILENAME)
  const tmpPath = `${manifestPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`
  try {
    manifest.updated_at = new Date().toISOString()
    await fs.promises.writeFile(tmpPath, JSON.stringify(manifest, null, 2))
    try {
      await fs.promises.rename(tmpPath, manifestPath)
    } catch {
      await fs.promises.copyFile(tmpPath, manifestPath)
      await fs.promises.unlink(tmpPath).catch(() => {})
    }
    // Also save manifest.json for backwards compatibility
    const legacyPath = path.join(packagePath, 'manifest.json')
    await fs.promises.writeFile(legacyPath, JSON.stringify(manifest, null, 2)).catch(() => {})
  } catch (err: any) {
    logError(`Failed to save extraction manifest at ${manifestPath}: ${err.message}`)
    throw err
  }
}

export async function updateExtractionManifest(packagePath: string, patch: Partial<ExtractionManifest>): Promise<ExtractionManifest> {
  const manifest = await loadExtractionManifest(packagePath)
  if (!manifest) {
    throw new Error(`Cannot update manifest: not found at ${packagePath}`)
  }
  const updated = { ...manifest, ...patch, updated_at: new Date().toISOString() }
  
  // deep merge for stages, counts, validation, paths if needed
  if (patch.stages) updated.stages = { ...manifest.stages, ...patch.stages }
  if (patch.counts) updated.counts = { ...manifest.counts, ...patch.counts }
  if (patch.validation) updated.validation = { ...manifest.validation, ...patch.validation }
  if (patch.paths) updated.paths = { ...manifest.paths, ...patch.paths }
  if (patch.style_profile_selection) updated.style_profile_selection = { ...manifest.style_profile_selection, ...patch.style_profile_selection } as any
  if (patch.supermarket) updated.supermarket = { ...manifest.supermarket, ...patch.supermarket }
  if (patch.location) updated.location = { ...manifest.location, ...patch.location }
  if (patch.offer_dates) updated.offer_dates = { ...manifest.offer_dates, ...patch.offer_dates }
  if (patch.processing_scope) updated.processing_scope = { ...manifest.processing_scope, ...patch.processing_scope }

  await saveExtractionManifest(packagePath, updated)
  return updated
}

export async function markExtractionCompleted(packagePath: string): Promise<ExtractionManifest> {
  const manifest = await loadExtractionManifest(packagePath)
  if (!manifest) throw new Error('Manifest not found')
  
  manifest.extraction_status = 'completed'
  manifest.completed_at = new Date().toISOString()
  return await updateExtractionManifest(packagePath, {
    extraction_status: 'completed',
    completed_at: manifest.completed_at
  })
}

export async function markExtractionPaused(packagePath: string): Promise<ExtractionManifest> {
  return await updateExtractionManifest(packagePath, {
    extraction_status: 'paused'
  })
}

export async function recoverManifestFromExistingFolder(packagePath: string): Promise<ExtractionManifest> {
  const folderName = path.basename(packagePath)
  const pdfFileName = `${folderName}.pdf` // Guessing
  
  const manifest: ExtractionManifest = {
    schema_version: 1,
    extraction_status: 'paused',
    db_update_status: 'not_started',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    recovered_from_existing_folder: true,
    extraction_folder_name: folderName,
    pdf_file_name: pdfFileName,
    pdf_base_name: folderName, // Approximation
    processing_scope: { mode: 'all_pages', pages: [] },
    supermarket: {},
    location: {},
    offer_dates: {},
    stages: {
      pdf_copy: 'completed',
      page_rendering: 'completed',
      manual_crop: 'in_progress',
      crop_generation: 'not_started',
      item_ocr: 'not_started',
      key_discovery: 'not_started',
      review_package: 'not_started',
      db_update: 'not_started'
    },
    counts: {
      pages_rendered: 0,
      chunks: 0,
      crop_images: 0,
      json_files: 0,
      matched_crop_json_pairs: 0,
      orphan_crop_images: 0,
      orphan_json_files: 0,
      keys_with_values: 0,
      keys_without_values: 0
    },
    paths: {
      pdf: pdfFileName,
      chunks_dir: 'chunks',
      pages_dir: 'pages',
      crops_dir: 'crops',
      json_dir: 'json',
      logs_dir: 'logs',
      metadata_dir: 'metadata',
      manual_crop_layout: 'manual-crop-layout.json',
      flexible_item_ocr_summary: 'flexible-item-ocr-summary.json',
      ocr_returned_keys: 'ocr_returned_keys.json',
      ocr_keys_without_values: 'ocr_keys_without_values.json'
    },
    validation: {
      package_valid: false,
      db_update_eligible: false,
      checked_at: new Date().toISOString(),
      warnings: [{ code: 'RECOVERED_MANIFEST', message: 'This package was recovered from an existing folder without a manifest.' }],
      errors: []
    }
  }

  await saveExtractionManifest(packagePath, manifest)
  return manifest
}
