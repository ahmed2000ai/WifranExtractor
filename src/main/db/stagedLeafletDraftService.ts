import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { getSupabaseAdminClient } from './supabaseAdminClient'
import {
  StagedLeafletDraft,
  StagedOfferItem,
  StagedLeafletHeader,
  PreMatchLocalOffersResult,
  ExportStagedLeafletResult,
  ExportStagedLeafletRow,
  ImportStep2CsvResult,
  PostCorrectionDbMatch,
  PublishStagedLeafletOptions,
  PublishStagedLeafletResult
} from '../../shared/types/productImageEnrichment'
import {
  loadOfferRefMap,
  saveOfferRefMap,
  assignShortOfferRef,
  removeOfferRef
} from './offerImageRefMapper'
import {
  detectImageMimeType,
  formatOfferVisualItemName,
  formatBilingualItemName,
  validateSsrfSafeUrl,
  parseSimpleCsv
} from './productImageEnrichmentService'
import {
  resolveOrCreateSupermarket,
  resolveOrCreateRegion,
  parseLeafletFilenameMetadata,
  ResolvedEntity
} from './supermarketRegionResolutionService'
import { normalizeArabicText, normalizeEnglishText } from '../../shared/utils/textNormalization'
import { getDbEligibleItemsFromPackage } from '../extraction/extractionPackageService'
import { loadExtractionManifest, recoverManifestFromExistingFolder } from '../extraction/extractionManifestService'
import { ensureProductAliases } from './productAliasService'
import { validateProductIdentityCompatibility } from './productIdentityCompatibilityValidator'
import { executeTwoStageProductMatch } from './twoStageCandidateRetrievalService'

export { resolveOrCreateSupermarket, resolveOrCreateRegion, parseLeafletFilenameMetadata }
export type { ResolvedEntity }

function escapeCsv(val?: string | null): string {
  if (val == null) return ''
  return String(val).replace(/"/g, '""')
}

export function ensureActiveFields(item: StagedOfferItem): void {
  if (item.titleEn === undefined) item.titleEn = item.aiCorrected?.titleEn ?? item.originalOcr?.titleEn ?? null
  if (item.titleAr === undefined) item.titleAr = item.aiCorrected?.titleAr ?? item.originalOcr?.titleAr ?? null
  if (item.brand === undefined) item.brand = item.aiCorrected?.brand ?? item.originalOcr?.brand ?? null
  if (item.sizeOrWeight === undefined) item.sizeOrWeight = item.aiCorrected?.sizeOrWeight ?? item.originalOcr?.sizeOrWeight ?? null
  if (item.priceBefore === undefined) item.priceBefore = item.originalOcr?.priceBefore ?? null
  if (item.priceAfter === undefined) item.priceAfter = item.originalOcr?.priceAfter ?? null
  if (item.discountPercent === undefined) item.discountPercent = item.originalOcr?.discountPercent ?? null
  if (item.promoNotes === undefined) item.promoNotes = item.originalOcr?.promoNotes ?? null
  if (!item.operatorEditedFields) item.operatorEditedFields = []
}

/**
 * Loads the local staged-draft.json file from the job workspace directory.
 */
export async function loadStagedLeafletDraft(
  jobDir: string,
  options?: { skipAutoInit?: boolean; supabaseClient?: any }
): Promise<StagedLeafletDraft | null> {
  const draftPath = path.join(jobDir, 'staged-draft.json')
  try {
    const raw = await fs.promises.readFile(draftPath, 'utf8')
    const draft = JSON.parse(raw) as StagedLeafletDraft
    if (draft && Array.isArray(draft.items)) {
      draft.items.forEach(ensureActiveFields)
    }
    return draft
  } catch {
    if (!options?.skipAutoInit) {
      // Check if this workspace has extraction assets to auto-initialize
      const hasManifest =
        fs.existsSync(path.join(jobDir, 'extraction_manifest.json')) ||
        fs.existsSync(path.join(jobDir, 'manifest.json'))
      if (hasManifest) {
        try {
          return await initializeStagedDraftFromPackage(jobDir, { supabaseClient: options?.supabaseClient })
        } catch {
          // ignore error and return null
        }
      }
    }
    return null
  }
}

/**
 * Initializes a new StagedLeafletDraft from a completed or in-progress extraction package,
 * uploads boundary pages if available, pre-matches against existing DB products/images,
 * and saves staged-draft.json.
 */
export async function initializeStagedDraftFromPackage(
  jobDir: string,
  options?: {
    supabaseClient?: any
    leafletHash?: string
    supermarketId?: string | null
    region?: string | null
    validFrom?: string | null
    validTo?: string | null
    metadataPageNumber?: number | null
    pdfFileName?: string | null
    pdfFilePath?: string | null
  }
): Promise<StagedLeafletDraft> {
  let manifest = await loadExtractionManifest(jobDir)
  if (!manifest) {
    try {
      manifest = await recoverManifestFromExistingFolder(jobDir)
    } catch {
      // ignore
    }
  }

  // Determine candidate PDF filename
  let candidatePdfName = options?.pdfFileName || (options?.pdfFilePath ? path.basename(options.pdfFilePath) : null)
  if (!candidatePdfName && manifest) {
    candidatePdfName =
      manifest.pdf_file_name ||
      (manifest as any).source_pdf_name ||
      manifest.leaflet_filename_metadata?.source_file_name ||
      null
  }
  if (!candidatePdfName && fs.existsSync(jobDir)) {
    try {
      const files = fs.readdirSync(jobDir)
      const pdf = files.find((f) => f.toLowerCase().endsWith('.pdf'))
      if (pdf) candidatePdfName = pdf
    } catch {
      // ignore
    }
  }
  if (!candidatePdfName && options?.leafletHash && options.leafletHash.toLowerCase().endsWith('.pdf')) {
    candidatePdfName = options.leafletHash
  }

  const existing = await loadStagedLeafletDraft(jobDir, { skipAutoInit: true })
  if (existing) {
    let existingModified = false
    if (options?.metadataPageNumber !== undefined && options?.metadataPageNumber !== existing.header?.metadataPageNumber) {
      existing.header.metadataPageNumber = options.metadataPageNumber
      existingModified = true
      try {
        const boundaryRes = await uploadLeafletBoundaryPagesForMetadata(
          jobDir,
          existing.leafletHash || path.basename(jobDir),
          undefined,
          {
            supabaseClient: options?.supabaseClient,
            metadataPageNumber: options.metadataPageNumber
          }
        )
        existing.header.firstPagePublicUrl = boundaryRes.firstPagePublicUrl
        existing.header.lastPagePublicUrl = boundaryRes.lastPagePublicUrl
        existing.header.firstPageTmpPath = boundaryRes.firstPageTmpPath
        existing.header.lastPageTmpPath = boundaryRes.lastPageTmpPath
      } catch (err) {
        console.warn('Re-upload boundary pages with metadataPageNumber failed:', err)
      }
    }

    if ((!existing.header.supermarketId || !existing.header.region) && candidatePdfName) {
      const parsed = parseLeafletFilenameMetadata(candidatePdfName)
      if (!existing.header.supermarketId && parsed.rawSupermarketName) {
        try {
          const resolvedSm = await resolveOrCreateSupermarket(parsed.rawSupermarketName, {
            supabaseClient: options?.supabaseClient
          })
          existing.header.supermarketId = resolvedSm.id
          existingModified = true
        } catch {
          // ignore
        }
      }
      if (!existing.header.region && parsed.rawRegionName) {
        try {
          const resolvedReg = await resolveOrCreateRegion(parsed.rawRegionName, {
            supabaseClient: options?.supabaseClient
          })
          existing.header.region = resolvedReg.name_en || resolvedReg.slug || parsed.rawRegionName
          existingModified = true
        } catch {
          // ignore
        }
      }
    }

    if (existingModified) {
      await saveStagedLeafletDraft(jobDir, existing)
    }
    return existing
  }

  let filenameSupermarketId: string | null = null
  let filenameRegion: string | null = null

  if (candidatePdfName) {
    const parsed = parseLeafletFilenameMetadata(candidatePdfName)
    if (parsed.rawSupermarketName) {
      try {
        const resolvedSm = await resolveOrCreateSupermarket(parsed.rawSupermarketName, {
          supabaseClient: options?.supabaseClient
        })
        filenameSupermarketId = resolvedSm.id
      } catch (err) {
        console.warn(`Failed to resolve supermarket from filename '${parsed.rawSupermarketName}':`, err)
      }
    }
    if (parsed.rawRegionName) {
      try {
        const resolvedReg = await resolveOrCreateRegion(parsed.rawRegionName, {
          supabaseClient: options?.supabaseClient
        })
        filenameRegion = resolvedReg.name_en || resolvedReg.slug || parsed.rawRegionName
      } catch (err) {
        console.warn(`Failed to resolve region from filename '${parsed.rawRegionName}':`, err)
      }
    }
  }

  const supermarketId = options?.supermarketId ?? filenameSupermarketId ?? manifest?.supermarket?.id ?? null
  const region = options?.region ?? filenameRegion ?? manifest?.location?.display_name ?? manifest?.location?.location_slug ?? null
  const validFrom = options?.validFrom ?? manifest?.offer_dates?.valid_from ?? null
  const validTo = options?.validTo ?? manifest?.offer_dates?.valid_to ?? null
  const leafletHash =
    options?.leafletHash ?? candidatePdfName ?? manifest?.leaflet_filename_metadata?.source_file_name ?? path.basename(jobDir)

  let eligibleItems: any[] = []
  try {
    eligibleItems = await getDbEligibleItemsFromPackage(jobDir)
  } catch {
    eligibleItems = []
  }

  let firstPagePublicUrl: string | null = null
  let lastPagePublicUrl: string | null = null
  let firstPageTmpPath: string | null = null
  let lastPageTmpPath: string | null = null
  try {
    const boundaryRes = await uploadLeafletBoundaryPagesForMetadata(jobDir, leafletHash, undefined, {
      supabaseClient: options?.supabaseClient,
      metadataPageNumber: options?.metadataPageNumber
    })
    firstPagePublicUrl = boundaryRes.firstPagePublicUrl
    lastPagePublicUrl = boundaryRes.lastPagePublicUrl
    firstPageTmpPath = boundaryRes.firstPageTmpPath
    lastPageTmpPath = boundaryRes.lastPageTmpPath
  } catch (err) {
    // Graceful offline fallback
    console.warn('Boundary page upload skipped or failed:', err)
  }

  const stagedItems: StagedOfferItem[] = eligibleItems.map((item, idx) => {
    const data = item.jsonData || {}
    const offer = data.offer || {}
    const original = data.original || {}
    const source = data.source || {}
    const product = data.product || {}
    const prices = data.prices || {}
    const content = data.content || {}
    const promo = data.promotion || {}

    const titleEn = product.title_en || offer.title_en || original.product_name_en || null
    const titleAr = product.title_ar || offer.title_ar || original.product_name_ar || null
    const brand = product.brand_text || offer.brand || original.brand || null
    const sizeOrWeight = content.size_text || offer.size_or_weight || original.size_or_weight || null
    const priceBefore =
      prices.original_price != null
        ? Number(prices.original_price)
        : offer.price_before != null
          ? Number(offer.price_before)
          : original.price_before != null
            ? Number(original.price_before)
            : null
    const priceAfter =
      prices.offer_price != null
        ? Number(prices.offer_price)
        : offer.offer_price != null
          ? Number(offer.offer_price)
          : offer.price_after != null
            ? Number(offer.price_after)
            : original.offer_price != null
              ? Number(original.offer_price)
              : null
    const discountPercent =
      prices.discount_percentage != null
        ? Number(prices.discount_percentage)
        : offer.discount_percentage != null
          ? Number(offer.discount_percentage)
          : original.discount_percentage != null
            ? Number(original.discount_percentage)
            : null
    const promoNotes =
      promo.condition_text || promo.special_offer || offer.promo_notes || original.promo_notes || null

    const offerId = source.external_image_id || source.row_id || data.id || `offer-${idx + 1}`

    return {
      id: offerId,
      sourceOfferId: offerId,
      pageNumber: item.pageNumber,
      croppedEvidenceLocalPath: item.cropPath,
      selectedImageSource: 'none',
      isAiCorrected: false,
      isOperatorModified: false,
      operatorEditedFields: [],
      originalOcr: {
        titleEn,
        titleAr,
        brand,
        sizeOrWeight,
        priceBefore,
        priceAfter,
        discountPercent,
        promoNotes
      },
      titleEn,
      titleAr,
      brand,
      sizeOrWeight,
      priceBefore,
      priceAfter,
      discountPercent,
      promoNotes,
      each_size_value: typeof content.each_size_value === 'number' ? content.each_size_value : null,
      each_size_unit: content.each_size_unit || null,
      inner_pack_count: typeof content.pack_quantity === 'number' ? content.pack_quantity : 1,
      sale_unit_type: data.contract_v2?.quantity_semantics?.sale_unit || 'each'
    } as any
  })

  // Pre-match against DB (read-only)
  if (stagedItems.length > 0) {
    try {
      await preMatchLocalOffersAgainstDb(stagedItems, { supabaseClient: options?.supabaseClient })
    } catch (err) {
      console.warn('Pre-match against DB failed or offline:', err)
    }
  }

  const draft: StagedLeafletDraft = {
    schemaVersion: 'wifran.staged.draft/1.0',
    jobDir,
    leafletHash,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    header: {
      supermarketId,
      region,
      validFrom,
      validTo,
      firstPagePublicUrl,
      lastPagePublicUrl,
      firstPageTmpPath,
      lastPageTmpPath,
      metadataPageNumber: options?.metadataPageNumber ?? null,
      headerModifiedByOperator: false
    },
    items: stagedItems
  }

  await saveStagedLeafletDraft(jobDir, draft)
  return draft
}



export const initializeStagedLeafletDraftFromJobDir = initializeStagedDraftFromPackage



/**
 * Persists the staged-draft.json file into the job workspace directory.
 */
export async function saveStagedLeafletDraft(jobDir: string, draft: StagedLeafletDraft): Promise<void> {
  const draftPath = path.join(jobDir, 'staged-draft.json')
  draft.updatedAt = new Date().toISOString()
  await fs.promises.mkdir(jobDir, { recursive: true })
  await fs.promises.writeFile(draftPath, JSON.stringify(draft, null, 2), 'utf8')
}

export interface UploadLeafletBoundaryPagesOptions {
  supabaseClient?: any
  metadataPageNumber?: number | null
}

/**
 * Cleanly removes whichever temporary boundary page paths are non-null in Supabase 'tmp' bucket.
 */
export async function cleanupLeafletBoundaryPagesFromTmpBucket(
  draft: StagedLeafletDraft,
  supabaseClient?: any
): Promise<string[]> {
  const supabase = supabaseClient || getSupabaseAdminClient()
  const tmpPathsToDelete: string[] = []
  if (draft.header.firstPageTmpPath) {
    tmpPathsToDelete.push(draft.header.firstPageTmpPath)
  }
  if (draft.header.lastPageTmpPath && draft.header.lastPageTmpPath !== draft.header.firstPageTmpPath) {
    tmpPathsToDelete.push(draft.header.lastPageTmpPath)
  }

  if (tmpPathsToDelete.length > 0) {
    try {
      await supabase.storage.from('tmp').remove(tmpPathsToDelete)
    } catch (removeErr) {
      console.warn('Failed to remove boundary pages from tmp bucket:', removeErr)
    }
    draft.header.firstPageTmpPath = null
    draft.header.lastPageTmpPath = null
  }
  return tmpPathsToDelete
}

/**
 * Helper to sort image filenames by their natural page number.
 */
function sortPageFilePaths(filePaths: string[]): string[] {
  return [...filePaths].sort((a, b) => {
    const baseA = path.basename(a)
    const baseB = path.basename(b)

    const matchA = baseA.match(/(?:page[-._]?)(\d+)/i) || baseA.match(/(\d+)/)
    const matchB = baseB.match(/(?:page[-._]?)(\d+)/i) || baseB.match(/(\d+)/)

    const numA = matchA ? parseInt(matchA[1], 10) : NaN
    const numB = matchB ? parseInt(matchB[1], 10) : NaN

    if (!isNaN(numA) && !isNaN(numB)) {
      if (numA !== numB) return numA - numB
    }
    return baseA.localeCompare(baseB)
  })
}

/**
 * Uploads rendered page 1 and page N (last page) images of a leaflet,
 * or ONLY a single specified page if metadataPageNumber is provided,
 * to the public Supabase 'tmp' storage bucket.
 * Saves the resulting public URLs into staged-draft.json.
 */
export async function uploadLeafletBoundaryPagesForMetadata(
  jobDir: string,
  leafletHash: string,
  pageFilesOrOptions?: string[] | UploadLeafletBoundaryPagesOptions,
  options?: UploadLeafletBoundaryPagesOptions
): Promise<{
  firstPagePublicUrl: string
  lastPagePublicUrl: string | null
  firstPageTmpPath: string
  lastPageTmpPath: string | null
}> {
  let pageFiles: string[] | undefined
  let opts: UploadLeafletBoundaryPagesOptions | undefined

  if (Array.isArray(pageFilesOrOptions)) {
    pageFiles = pageFilesOrOptions
    opts = options
  } else if (pageFilesOrOptions && typeof pageFilesOrOptions === 'object') {
    pageFiles = undefined
    opts = pageFilesOrOptions
  } else {
    opts = options
  }

  let targetPages: string[] = []

  if (pageFiles && pageFiles.length > 0) {
    targetPages = [...pageFiles]
  } else {
    // Check path.join(jobDir, 'pages')
    const pagesDir = path.join(jobDir, 'pages')
    if (fs.existsSync(pagesDir)) {
      try {
        const files = await fs.promises.readdir(pagesDir)
        targetPages = files
          .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
          .map((f) => path.join(pagesDir, f))
      } catch {
        // ignore
      }
    }

    // Fall back to jobDir directly if pages/ was empty or missing
    if (targetPages.length === 0 && fs.existsSync(jobDir)) {
      try {
        const files = await fs.promises.readdir(jobDir)
        targetPages = files
          .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
          .map((f) => path.join(jobDir, f))
      } catch {
        // ignore
      }
    }
  }

  if (targetPages.length === 0) {
    throw new Error(`No rendered page images found in job directory: ${jobDir}`)
  }

  const sortedPages = sortPageFilePaths(targetPages)
  const supabase = opts?.supabaseClient || getSupabaseAdminClient()

  // Branch A: Single metadata page specified by operator
  if (opts?.metadataPageNumber != null) {
    const k = Number(opts.metadataPageNumber)
    let singlePagePath: string | undefined

    for (const p of sortedPages) {
      const base = path.basename(p)
      const match = base.match(/(?:page[-._]?)(\d+)/i) || base.match(/(\d+)/)
      if (match && parseInt(match[1], 10) === k) {
        singlePagePath = p
        break
      }
    }

    if (!singlePagePath) {
      const clampedIdx = Math.max(0, Math.min(sortedPages.length - 1, k - 1))
      singlePagePath = sortedPages[clampedIdx]
    }

    const singleBuf = await fs.promises.readFile(singlePagePath)
    const singleMime = detectImageMimeType(singleBuf)
    const singleExt = singleMime?.ext || path.extname(singlePagePath).replace('.', '').toLowerCase() || 'png'
    const singleContentType =
      singleMime?.mimeType || (singleExt === 'webp' ? 'image/webp' : singleExt === 'png' ? 'image/png' : 'image/jpeg')
    const singleStoragePath = `${leafletHash}_page_${k}.${singleExt}`

    const { error: err } = await supabase.storage
      .from('tmp')
      .upload(singleStoragePath, singleBuf, {
        contentType: singleContentType,
        upsert: true
      })
    if (err) {
      throw new Error(`Failed to upload metadata page ${k} to storage: ${err.message}`)
    }
    const { data: pub } = supabase.storage.from('tmp').getPublicUrl(singleStoragePath)
    const singlePageUrl = pub.publicUrl

    // Update or initialize staged-draft.json
    let draft = await loadStagedLeafletDraft(jobDir, { skipAutoInit: true })
    if (!draft) {
      draft = {
        schemaVersion: 'wifran.staged.draft/1.0',
        jobDir,
        leafletHash,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        header: {
          supermarketId: null,
          region: null,
          validFrom: null,
          validTo: null,
          firstPagePublicUrl: singlePageUrl,
          lastPagePublicUrl: null,
          firstPageTmpPath: singleStoragePath,
          lastPageTmpPath: null,
          metadataPageNumber: k,
          headerModifiedByOperator: false
        },
        items: []
      }
    } else {
      draft.header.firstPagePublicUrl = singlePageUrl
      draft.header.lastPagePublicUrl = null
      draft.header.firstPageTmpPath = singleStoragePath
      draft.header.lastPageTmpPath = null
      draft.header.metadataPageNumber = k
      if (!draft.leafletHash) draft.leafletHash = leafletHash
    }

    await saveStagedLeafletDraft(jobDir, draft)

    return {
      firstPagePublicUrl: singlePageUrl,
      lastPagePublicUrl: null,
      firstPageTmpPath: singleStoragePath,
      lastPageTmpPath: null
    }
  }

  // Branch B: Default boundary pages (1st and last)
  const firstPagePath = sortedPages[0]
  const lastPagePath = sortedPages[sortedPages.length - 1]

  const firstBuf = await fs.promises.readFile(firstPagePath)
  const lastBuf = await fs.promises.readFile(lastPagePath)

  const firstMime = detectImageMimeType(firstBuf)
  const lastMime = detectImageMimeType(lastBuf)

  const firstExt = firstMime?.ext || path.extname(firstPagePath).replace('.', '').toLowerCase() || 'png'
  const lastExt = lastMime?.ext || path.extname(lastPagePath).replace('.', '').toLowerCase() || 'png'

  const firstContentType =
    firstMime?.mimeType || (firstExt === 'webp' ? 'image/webp' : firstExt === 'png' ? 'image/png' : 'image/jpeg')
  const lastContentType =
    lastMime?.mimeType || (lastExt === 'webp' ? 'image/webp' : lastExt === 'png' ? 'image/png' : 'image/jpeg')

  const firstStoragePath = `${leafletHash}_first.${firstExt}`
  const lastStoragePath = `${leafletHash}_last.${lastExt}`

  // Upload first page to public 'tmp' bucket
  const { error: err1 } = await supabase.storage
    .from('tmp')
    .upload(firstStoragePath, firstBuf, {
      contentType: firstContentType,
      upsert: true
    })
  if (err1) {
    throw new Error(`Failed to upload first boundary page to storage: ${err1.message}`)
  }
  const { data: pub1 } = supabase.storage.from('tmp').getPublicUrl(firstStoragePath)
  const firstPagePublicUrl = pub1.publicUrl

  // Upload last page (if single page leaflet, both point to page 1 without redundant upload)
  let lastPagePublicUrl = firstPagePublicUrl
  let finalLastStoragePath = firstStoragePath
  if (firstPagePath !== lastPagePath) {
    finalLastStoragePath = lastStoragePath
    const { error: err2 } = await supabase.storage
      .from('tmp')
      .upload(lastStoragePath, lastBuf, {
        contentType: lastContentType,
        upsert: true
      })
    if (err2) {
      throw new Error(`Failed to upload last boundary page to storage: ${err2.message}`)
    }
    const { data: pub2 } = supabase.storage.from('tmp').getPublicUrl(lastStoragePath)
    lastPagePublicUrl = pub2.publicUrl
  }

  // Update or initialize staged-draft.json
  let draft = await loadStagedLeafletDraft(jobDir, { skipAutoInit: true })
  if (!draft) {
    draft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir,
      leafletHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      header: {
        supermarketId: null,
        region: null,
        validFrom: null,
        validTo: null,
        firstPagePublicUrl,
        lastPagePublicUrl,
        firstPageTmpPath: firstStoragePath,
        lastPageTmpPath: finalLastStoragePath,
        metadataPageNumber: null,
        headerModifiedByOperator: false
      },
      items: []
    }
  } else {
    draft.header.firstPagePublicUrl = firstPagePublicUrl
    draft.header.lastPagePublicUrl = lastPagePublicUrl
    draft.header.firstPageTmpPath = firstStoragePath
    draft.header.lastPageTmpPath = finalLastStoragePath
    draft.header.metadataPageNumber = null
    if (!draft.leafletHash) draft.leafletHash = leafletHash
  }

  await saveStagedLeafletDraft(jobDir, draft)

  return {
    firstPagePublicUrl,
    lastPagePublicUrl,
    firstPageTmpPath: firstStoragePath,
    lastPageTmpPath: finalLastStoragePath
  }
}

export interface PreMatchOptions {
  supabaseClient?: any
  mapFilePath?: string
}

/**
 * Performs a strictly READ-ONLY pre-matching lookup against Supabase
 * (public.products, public.product_aliases, public.offer_display_images).
 *
 * Case A: Matched product WITH existing approved image:
 *         Populates matchedProductId, existingDbImageUrl, selectedImageSource = 'existing_db', excludes from CSV.
 * Case B: Matched product WITHOUT approved image:
 *         Populates matchedProductId, imageRef = P<id>, selectedImageSource = 'none', included in CSV.
 * Case C: Unmatched / Generic offer:
 *         Computes visual_subject_key.
 *         - If existing approved image in DB: existingDbImageUrl populated, selectedImageSource = 'existing_db', excluded from CSV.
 *         - Else: compact sequential short ID (O1, O2...) assigned via offerImageRefMapper, included in CSV.
 */
export async function preMatchLocalOffersAgainstDb(
  localOffers: StagedOfferItem[],
  options?: PreMatchOptions
): Promise<PreMatchLocalOffersResult> {
  const supabase = options?.supabaseClient || getSupabaseAdminClient()
  const refMap = await loadOfferRefMap(options?.mapFilePath)
  let mapModified = false

  let matchedWithExistingDbImageCount = 0
  let matchedProductWithoutImageCount = 0
  let unmatchedOfferCount = 0
  let unmatchedWithExistingDbImageCount = 0

  for (const item of localOffers) {
    const titleEn = (item.titleEn || (item as any).title_en || item.originalOcr?.titleEn || '').trim()
    const titleAr = (item.titleAr || (item as any).title_ar || item.originalOcr?.titleAr || '').trim()

    const matchResult = await executeTwoStageProductMatch({
      titleEn,
      titleAr,
      brand: item.brand,
      sizeOrWeight: item.sizeOrWeight,
      saleUnitType: (item as any).sale_unit_type || (item as any).saleUnitType,
      eachSizeValue: (item as any).each_size_value || (item as any).eachSizeValue,
      eachSizeUnit: (item as any).each_size_unit || (item as any).eachSizeUnit,
      innerPackCount: (item as any).inner_pack_count || (item as any).innerPackCount,
      variantOrFlavor: (item as any).variant_or_flavor || (item as any).variantOrFlavor,
      originalOcr: item.originalOcr
    }, { supabaseClient: supabase })

    const matchedProduct = matchResult.matchedProduct
    const compatResult = matchResult.result

    // Case Evaluation: Product match vs. Unmatched
    if (matchedProduct) {
      const prodId = Number(matchedProduct.id)
      item.matchedProductId = prodId
      const hasImage = Boolean(matchedProduct.approved_primary_image_id || matchedProduct.default_image_url)

      if (hasImage) {
        // Case A: Matched product WITH image
        item.existingDbImageUrl = matchedProduct.default_image_url || null
        item.selectedImageSource = 'existing_db'
        item.status = 'skipped'
        item.imageRef = undefined
        matchedWithExistingDbImageCount++
      } else {
        // Case B: Matched product WITHOUT image
        item.existingDbImageUrl = null
        item.selectedImageSource = 'none'
        item.imageRef = `P${prodId}`
        item.status = 'ready'
        matchedProductWithoutImageCount++
      }
    } else {
      // Incompatible / unverified / ambiguous offer
      item.matchedProductId = undefined
      if (compatResult && compatResult.status !== 'verified_compatible') {
        ;(item as any).catalogMatchIssue = compatResult.reason
      }
      // Case C: Unmatched / Generic Offer
      const formatted = formatOfferVisualItemName({
        title_en: titleEn,
        title_ar: titleAr,
        sale_unit_type: (item as any).sale_unit_type || (item as any).saleUnitType,
        each_size_value: (item as any).each_size_value || (item as any).eachSizeValue,
        each_size_unit: (item as any).each_size_unit || (item as any).eachSizeUnit,
        contract_v2: (item as any).contract_v2 || (item as any).contractV2
      })
      const visualSubjectKey = formatted.visualSubjectKey
      item.matchedVisualSubjectKey = visualSubjectKey

      // Check if public.offer_display_images already has an approved image for this visual_subject_key
      let existingDisplayUrl: string | null = null

      const { data: directImg } = await supabase
        .from('offer_display_images')
        .select('public_url')
        .eq('visual_subject_key', visualSubjectKey)
        .eq('approval_status', 'approved')
        .limit(1)
        .maybeSingle()

      if (directImg?.public_url) {
        existingDisplayUrl = directImg.public_url
      } else {
        // Check offer_visual_group_members
        const { data: grpMem } = await supabase
          .from('offer_visual_group_members')
          .select('representative_offer_id')
          .eq('visual_subject_key', visualSubjectKey)
          .limit(1)
          .maybeSingle()

        if (grpMem?.representative_offer_id) {
          const { data: repImg } = await supabase
            .from('offer_display_images')
            .select('public_url')
            .eq('offer_id', grpMem.representative_offer_id)
            .eq('approval_status', 'approved')
            .limit(1)
            .maybeSingle()
          if (repImg?.public_url) {
            existingDisplayUrl = repImg.public_url
          }
        }
      }

      if (existingDisplayUrl) {
        // Case C1: Approved illustrative image already in DB
        item.existingDbImageUrl = existingDisplayUrl
        item.selectedImageSource = 'existing_db'
        item.status = 'skipped'
        item.imageRef = undefined
        unmatchedWithExistingDbImageCount++
      } else {
        // Case C2: Net-new un-imaged offer -> assign short ID
        const shortRef = assignShortOfferRef(item.id, refMap)
        item.imageRef = shortRef
        item.existingDbImageUrl = null
        item.selectedImageSource = 'none'
        item.status = 'ready'
        unmatchedOfferCount++
        mapModified = true
      }
    }
  }

  if (mapModified) {
    await saveOfferRefMap(refMap, options?.mapFilePath)
  }

  return {
    items: localOffers,
    matchedWithExistingDbImageCount,
    matchedProductWithoutImageCount,
    unmatchedOfferCount,
    unmatchedWithExistingDbImageCount,
    exportableCount: matchedProductWithoutImageCount + unmatchedOfferCount
  }
}

export interface ExportStagedLeafletOptions {
  mapFilePath?: string
  persistVisualGroups?: boolean
  supabaseClient?: any
}

/**
 * Exports an upgraded 6-column Step 1 CSV
 * (Image_Ref,Title_EN,Title_AR,Brand,Size_Or_Weight,image_url)
 * containing only net-new/un-imaged P<id> and short O<n> items,
 * consolidating visual subjects in the same leaflet under a single representative,
 * and appending the 6 M_ leaflet metadata rows at the bottom.
 */
export async function exportStagedLeafletForStep2(
  jobDir: string,
  options?: ExportStagedLeafletOptions
): Promise<ExportStagedLeafletResult> {
  const draft = await loadStagedLeafletDraft(jobDir)
  if (!draft) {
    throw new Error(`staged-draft.json not found in job directory: ${jobDir}`)
  }

  // Pre-match against DB if items have not been evaluated yet
  const hasEvaluated = draft.items.some((i) => i.selectedImageSource && i.selectedImageSource !== 'none')
  if (!hasEvaluated && draft.items.length > 0) {
    await preMatchLocalOffersAgainstDb(draft.items, {
      supabaseClient: options?.supabaseClient,
      mapFilePath: options?.mapFilePath
    })
  }

  const refMap = await loadOfferRefMap(options?.mapFilePath)
  let mapModified = false

  // Filter out items already imaged in DB
  const exportableItems = draft.items.filter((i) => i.selectedImageSource !== 'existing_db')
  const skippedAlreadyImagedCount = draft.items.length - exportableItems.length

  // 1. Separate into P items (matched product without image) and O items (uncatalogued)
  const pMap = new Map<number, StagedOfferItem>()
  const oItems: StagedOfferItem[] = []

  for (const item of exportableItems) {
    if (item.matchedProductId != null) {
      if (!pMap.has(item.matchedProductId)) {
        pMap.set(item.matchedProductId, item)
      }
    } else {
      oItems.push(item)
    }
  }

  // 2. Consolidate O items by visualSubjectKey
  const oGroups = new Map<string, StagedOfferItem[]>()
  for (const item of oItems) {
    const key =
      item.matchedVisualSubjectKey ||
      formatOfferVisualItemName({
        title_en: item.originalOcr?.titleEn,
        title_ar: item.originalOcr?.titleAr
      }).visualSubjectKey
    item.matchedVisualSubjectKey = key

    if (!oGroups.has(key)) {
      oGroups.set(key, [item])
    } else {
      oGroups.get(key)!.push(item)
    }
  }

  const pRows: ExportStagedLeafletRow[] = []
  const oRows: ExportStagedLeafletRow[] = []

  // Build P rows (sorted by Product ID ascending)
  const sortedPItems = Array.from(pMap.values()).sort((a, b) => (a.matchedProductId || 0) - (b.matchedProductId || 0))
  for (const item of sortedPItems) {
    const pId = item.matchedProductId!
    const row: ExportStagedLeafletRow = {
      imageRef: `P${pId}`,
      titleEn: item.originalOcr?.titleEn || '',
      titleAr: item.originalOcr?.titleAr || '',
      brand: item.originalOcr?.brand || '',
      sizeOrWeight: item.originalOcr?.sizeOrWeight || '',
      imageUrl: ''
    }
    pRows.push(row)
  }

  // Build representative O rows
  for (const [, members] of oGroups.entries()) {
    const rep = members[0]
    const shortRef = assignShortOfferRef(rep.id, refMap)
    mapModified = true

    rep.isRepresentative = true
    rep.imageRef = shortRef
    rep.visualGroupMemberIds = members.map((m) => m.id)

    // Mark remaining members
    for (let i = 1; i < members.length; i++) {
      const mem = members[i]
      mem.isRepresentative = false
      mem.representativeOfferId = rep.id
      mem.imageRef = shortRef
    }

    const row: ExportStagedLeafletRow = {
      imageRef: shortRef,
      titleEn: rep.originalOcr?.titleEn || '',
      titleAr: rep.originalOcr?.titleAr || '',
      brand: rep.originalOcr?.brand || '',
      sizeOrWeight: rep.originalOcr?.sizeOrWeight || '',
      imageUrl: ''
    }
    oRows.push(row)
  }

  // Sort O rows by numeric short ID index (e.g. O1, O2, O10)
  oRows.sort((a, b) => {
    const numA = parseInt(a.imageRef.replace(/^O/, ''), 10) || 0
    const numB = parseInt(b.imageRef.replace(/^O/, ''), 10) || 0
    return numA - numB
  })

  if (mapModified) {
    await saveOfferRefMap(refMap, options?.mapFilePath)
  }

  // Assemble strictly 2-column CSV: Image_Ref,Item_Name
  const headerLine = 'Image_Ref,Item_Name'
  const dataLines: string[] = []

  const allDataRows = [...pRows, ...oRows]
  for (const r of allDataRows) {
    let enDesc = (r.titleEn || '').trim()
    const arDesc = (r.titleAr || '').trim()
    const brand = (r.brand || '').trim()
    const size = (r.sizeOrWeight || '').trim()

    if (brand && !enDesc.toLowerCase().includes(brand.toLowerCase())) {
      enDesc = `${brand} ${enDesc}`.trim()
    }
    if (size && !enDesc.toLowerCase().includes(size.toLowerCase())) {
      enDesc = `${enDesc} ${size}`.trim()
    }

    const compactItemName = formatBilingualItemName(enDesc, arDesc)
    r.itemName = compactItemName
    dataLines.push(`"${escapeCsv(r.imageRef)}","${escapeCsv(compactItemName)}"`)
  }

  // Append boundary page row(s) at the bottom: FPTSP and conditionally LPTSP
  const firstUrl = draft.header?.firstPagePublicUrl || ''
  const lastUrl = draft.header?.lastPagePublicUrl || ''
  const isSingleMetadataPage = Boolean(
    draft.header?.metadataPageNumber != null || !draft.header?.lastPagePublicUrl
  )

  const metadataLines: string[] = []
  const metadataRowsObjects: ExportStagedLeafletRow[] = []

  if (firstUrl) {
    metadataLines.push(`FPTSP,${firstUrl}`)
    metadataRowsObjects.push({
      imageRef: 'FPTSP',
      itemName: firstUrl,
      titleEn: '',
      titleAr: '',
      brand: '',
      sizeOrWeight: '',
      imageUrl: firstUrl,
      isMetadata: true
    })
  }

  if (lastUrl && !isSingleMetadataPage) {
    metadataLines.push(`LPTSP,${lastUrl}`)
    metadataRowsObjects.push({
      imageRef: 'LPTSP',
      itemName: lastUrl,
      titleEn: '',
      titleAr: '',
      brand: '',
      sizeOrWeight: '',
      imageUrl: lastUrl,
      isMetadata: true
    })
  }

  // Prepend UTF-8 BOM (\uFEFF)
  const csvContent = '\uFEFF' + [headerLine, ...dataLines, ...metadataLines].join('\r\n')

  // Save updated draft to disk
  await saveStagedLeafletDraft(jobDir, draft)

  return {
    csvContent,
    exportableCount: allDataRows.length,
    skippedAlreadyImagedCount,
    pCount: pRows.length,
    oCount: oRows.length,
    metadataRowsCount: metadataLines.length,
    rows: [...allDataRows, ...metadataRowsObjects],
    draft
  }
}

// -------------------------------------------------------------
// PHASE 2: Step 2 CSV Ingestion, AI Text Corrections, Image Downloading & Inline Editing
// -------------------------------------------------------------

/**
 * Checks if newly corrected offer text matches an existing verified catalog product
 * that already has an approved primary image in Supabase.
 */
export async function checkPostCorrectionCatalogMatch(
  item: StagedOfferItem,
  supabase: any
): Promise<PostCorrectionDbMatch | null> {
  const titleEn = item.titleEn || item.originalOcr?.titleEn || ''
  const titleAr = item.titleAr || item.originalOcr?.titleAr || ''

  const matchResult = await executeTwoStageProductMatch({
    titleEn,
    titleAr,
    brand: item.brand,
    sizeOrWeight: item.sizeOrWeight,
    saleUnitType: (item as any).sale_unit_type || (item as any).saleUnitType,
    eachSizeValue: (item as any).each_size_value || (item as any).eachSizeValue,
    eachSizeUnit: (item as any).each_size_unit || (item as any).eachSizeUnit,
    innerPackCount: (item as any).inner_pack_count || (item as any).innerPackCount,
    variantOrFlavor: (item as any).variant_or_flavor || (item as any).variantOrFlavor,
    originalOcr: item.originalOcr
  }, { supabaseClient: supabase })

  const matchedProduct = matchResult.matchedProduct

  if (matchedProduct && (matchedProduct.default_image_url || matchedProduct.approved_primary_image_id)) {
    return {
      productId: Number(matchedProduct.id),
      existingImageUrl: matchedProduct.default_image_url,
      productTitleEn: matchedProduct.name_en || null,
      productTitleAr: matchedProduct.name_ar || null
    }
  }

  return null
}

function normalizeIsoDateString(raw?: string | null): string | null {
  if (!raw) return null
  const str = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(str)
    if (!isNaN(d.getTime())) return str
  }
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) {
    const norm = str.replace(/\//g, '-')
    const d = new Date(norm)
    if (!isNaN(d.getTime())) return norm
  }
  const dmyMatch = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  if (dmyMatch) {
    const norm = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`
    const d = new Date(norm)
    if (!isNaN(d.getTime())) return norm
  }
  const parsed = Date.parse(str)
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().split('T')[0]
  }
  return null
}

export interface ImportStep2CsvOptions {
  mapFilePath?: string
  supabaseClient?: any
  onProgress?: (event: { current: number; total: number; message: string; stage: string }) => void
}

/**
 * Parses and ingests the CSV returned from Step 2 into the local staged-draft.json,
 * supports strictly 2-column format (Image_Ref,image_url) and legacy 6-column format,
 * resolves SMN, REG, SD, ED metadata, detects AI text corrections,
 * performs read-only post-correction DB re-matching, downloads candidate image binaries
 * to local disk (staged-candidate-images/), and auto-deletes temporary boundary pages from 'tmp'.
 */
export async function importStep2CsvIntoStagedDraft(
  jobDir: string,
  csvContent: string,
  options?: ImportStep2CsvOptions
): Promise<ImportStep2CsvResult> {
  const draft = await loadStagedLeafletDraft(jobDir)
  if (!draft) {
    throw new Error(`staged-draft.json not found in job directory: ${jobDir}`)
  }

  const result: ImportStep2CsvResult = {
    totalRows: 0,
    matchedOffersCount: 0,
    aiCorrectedCount: 0,
    postCorrectionDbMatchCount: 0,
    candidateImagesDownloadedCount: 0,
    candidateImagesReusedCount: 0,
    candidateImagesFailedCount: 0,
    metadataUpdated: {},
    errors: [],
    draft
  }

  const parsedLines = parseSimpleCsv(csvContent)
  if (parsedLines.length < 2) {
    result.errors.push('CSV has no data rows.')
    return result
  }

  const header = parsedLines[0].map((h) => h.toLowerCase().trim())
  const isStrict2Col =
    header.length === 2 ||
    (header[0] === 'image_ref' && (header[1] === 'image_url' || header[1] === 'item_name' || header[1] === 'url'))

  const refIdx =
    header.findIndex((h) => h === 'image_ref' || h === 'product_id' || h === 'ref') !== -1
      ? header.findIndex((h) => h === 'image_ref' || h === 'product_id' || h === 'ref')
      : 0
  const titleEnIdx =
    header.findIndex((h) => h === 'title_en' || h === 'titleen' || h === 'name_en') !== -1
      ? header.findIndex((h) => h === 'title_en' || h === 'titleen' || h === 'name_en')
      : isStrict2Col ? -1 : 1
  const titleArIdx =
    header.findIndex((h) => h === 'title_ar' || h === 'titlear' || h === 'name_ar') !== -1
      ? header.findIndex((h) => h === 'title_ar' || h === 'titlear' || h === 'name_ar')
      : isStrict2Col ? -1 : 2
  const brandIdx =
    header.findIndex((h) => h === 'brand') !== -1
      ? header.findIndex((h) => h === 'brand')
      : isStrict2Col ? -1 : 3
  const sizeIdx =
    header.findIndex((h) => h === 'size_or_weight' || h === 'size' || h === 'weight') !== -1
      ? header.findIndex((h) => h === 'size_or_weight' || h === 'size' || h === 'weight')
      : isStrict2Col ? -1 : 4
  let urlIdx = header.findIndex((h) => h === 'image_url' || h === 'imageurl' || h === 'url')
  if (urlIdx === -1) {
    urlIdx = isStrict2Col ? 1 : parsedLines[0].length - 1
  }

  const refMap = await loadOfferRefMap(options?.mapFilePath)
  const supabase = options?.supabaseClient || getSupabaseAdminClient()

  // In-memory cache for downloaded candidates across this batch
  const batchCache = new Map<string, { buffer: Buffer; sha256: string; ext: string; localPath: string }>()
  const imagesDir = path.join(jobDir, 'staged-candidate-images')
  await fs.promises.mkdir(imagesDir, { recursive: true })

  const dataRows = parsedLines.slice(1)
  let rowIndex = 0

  for (const row of dataRows) {
    rowIndex++
    const ref = (row[refIdx] || '').trim()
    if (!ref) continue
    result.totalRows++

    const upperRef = ref.toUpperCase()

    // Ignore boundary pages echoed back
    if (upperRef === 'FPTSP' || upperRef === 'LPTSP' || upperRef === 'M_PAGE_FIRST' || upperRef === 'M_PAGE_LAST') {
      continue
    }

    // 1. Check Metadata Rows (SMN, REG, SD, ED, or legacy M_)
    if (
      upperRef === 'SMN' ||
      upperRef === 'REG' ||
      upperRef === 'SD' ||
      upperRef === 'ED' ||
      upperRef.startsWith('M_')
    ) {
      let metaVal = ''
      for (let col = 1; col < row.length; col++) {
        const cell = (row[col] || '').trim()
        if (cell) {
          metaVal = cell
          break
        }
      }

      if (metaVal) {
        if (upperRef === 'SMN') {
          try {
            const resolvedSm = await resolveOrCreateSupermarket(metaVal, { supabaseClient: supabase })
            if (!draft.header.headerModifiedByOperator && !draft.header.supermarketId) {
              draft.header.supermarketId = resolvedSm.id
            }
            result.metadataUpdated.supermarketId = resolvedSm.id
          } catch (smErr: any) {
            result.errors.push(`Failed to resolve supermarket '${metaVal}': ${smErr.message}`)
          }
        } else if (upperRef === 'M_SUPERMARKET_ID') {
          if (!draft.header.headerModifiedByOperator && !draft.header.supermarketId) {
            draft.header.supermarketId = metaVal
          }
          result.metadataUpdated.supermarketId = metaVal
        } else if (upperRef === 'REG') {
          try {
            const resolvedReg = await resolveOrCreateRegion(metaVal, { supabaseClient: supabase })
            const regValue = resolvedReg.name_en || resolvedReg.slug || metaVal
            if (!draft.header.headerModifiedByOperator && !draft.header.region) {
              draft.header.region = regValue
            }
            result.metadataUpdated.region = regValue
          } catch (regErr: any) {
            result.errors.push(`Failed to resolve region '${metaVal}': ${regErr.message}`)
          }
        } else if (upperRef === 'M_REGION') {
          if (!draft.header.headerModifiedByOperator && !draft.header.region) {
            draft.header.region = metaVal
          }
          result.metadataUpdated.region = metaVal
        } else if (upperRef === 'SD' || upperRef === 'M_VALID_FROM') {
          const isoDate = normalizeIsoDateString(metaVal)
          if (isoDate) {
            if (!draft.header.headerModifiedByOperator) {
              draft.header.validFrom = isoDate
            }
            result.metadataUpdated.validFrom = isoDate
            for (const item of draft.items) {
              ;(item as any).validFrom = isoDate
              ;(item as any).offer_start_date = isoDate
            }
          } else {
            result.errors.push(`Invalid start date format: '${metaVal}'`)
          }
        } else if (upperRef === 'ED' || upperRef === 'M_VALID_TO') {
          const isoDate = normalizeIsoDateString(metaVal)
          if (isoDate) {
            if (!draft.header.headerModifiedByOperator) {
              draft.header.validTo = isoDate
            }
            result.metadataUpdated.validTo = isoDate
            for (const item of draft.items) {
              ;(item as any).validTo = isoDate
              ;(item as any).offer_end_date = isoDate
            }
          } else {
            result.errors.push(`Invalid end date format: '${metaVal}'`)
          }
        }
      }
      continue
    }

    // 2. Match Offer / Product in Draft
    const isProductRef = /^P(\d+)$/i.test(ref)
    const matchedItems: StagedOfferItem[] = []

    if (isProductRef) {
      const pId = parseInt(ref.replace(/^P/i, ''), 10)
      for (const item of draft.items) {
        if (item.matchedProductId === pId || item.imageRef === ref) {
          matchedItems.push(item)
        }
      }
    } else {
      // O reference: O1, O2... or O<uuid>
      const resolvedUuid =
        refMap.shortToUuid[ref] ||
        (ref.startsWith('O') && ref.length === 37 ? ref.slice(1).toLowerCase() : null)

      for (const item of draft.items) {
        if (
          item.imageRef === ref ||
          (resolvedUuid && item.id.toLowerCase() === resolvedUuid) ||
          (resolvedUuid && item.representativeOfferId?.toLowerCase() === resolvedUuid) ||
          (item.representativeOfferId && item.imageRef === ref)
        ) {
          matchedItems.push(item)
        }
      }
    }

    if (matchedItems.length === 0) {
      result.errors.push(`Row ${rowIndex}: No staged offer item found matching reference ${ref}`)
      continue
    }

    result.matchedOffersCount += matchedItems.length

    // 3. Extract CSV text values & image URL
    // In 2-col format, col 2 may contain "Corrected Title|https://..."
    let rawColVal = urlIdx !== -1 && urlIdx < row.length ? (row[urlIdx] || '').trim() : ''
    let rawUrl = rawColVal
    let pipeTitleEn: string | undefined = undefined
    let pipeTitleAr: string | undefined = undefined

    if (rawColVal && rawColVal.includes('|')) {
      const parts = rawColVal.split('|').map((p) => p.trim())
      const httpIdx = parts.findIndex((p) => /^https?:\/\//i.test(p))
      if (httpIdx !== -1) {
        rawUrl = parts[httpIdx]
        const textParts = parts.filter((_, idx) => idx !== httpIdx)
        if (textParts.length >= 2) {
          pipeTitleEn = textParts[0]
          pipeTitleAr = textParts.slice(1).join(' | ')
        } else if (textParts.length === 1) {
          const singleText = textParts[0]
          if (/[\u0600-\u06FF]/.test(singleText) && /[a-zA-Z]/.test(singleText)) {
            pipeTitleEn = singleText
            pipeTitleAr = singleText
          } else if (/[\u0600-\u06FF]/.test(singleText)) {
            pipeTitleAr = singleText
          } else {
            pipeTitleEn = singleText
          }
        }
      }
    }

    const csvTitleEn =
      (titleEnIdx !== -1 && titleEnIdx < row.length ? (row[titleEnIdx] || '').trim() : '') || pipeTitleEn || ''
    const csvTitleAr =
      (titleArIdx !== -1 && titleArIdx < row.length ? (row[titleArIdx] || '').trim() : '') || pipeTitleAr || ''
    const csvBrand = brandIdx !== -1 && brandIdx < row.length ? (row[brandIdx] || '').trim() : ''
    const csvSize = sizeIdx !== -1 && sizeIdx < row.length ? (row[sizeIdx] || '').trim() : ''

    // 4. Detect & Apply AI Text Corrections
    for (const item of matchedItems) {
      ensureActiveFields(item)

      const origEn = (item.originalOcr?.titleEn || '').trim().replace(/\s+/g, ' ')
      const origAr = (item.originalOcr?.titleAr || '').trim().replace(/\s+/g, ' ')
      const origBrand = (item.originalOcr?.brand || '').trim().replace(/\s+/g, ' ')
      const origSize = (item.originalOcr?.sizeOrWeight || '').trim().replace(/\s+/g, ' ')

      const diffEn = Boolean(csvTitleEn && csvTitleEn.replace(/\s+/g, ' ').toLowerCase() !== origEn.toLowerCase())
      const diffAr = Boolean(csvTitleAr && csvTitleAr.replace(/\s+/g, ' ') !== origAr)
      const diffBrand = Boolean(csvBrand && csvBrand.replace(/\s+/g, ' ').toLowerCase() !== origBrand.toLowerCase())
      const diffSize = Boolean(csvSize && csvSize.replace(/\s+/g, ' ').toLowerCase() !== origSize.toLowerCase())

      if (diffEn || diffAr || diffBrand || diffSize) {
        item.aiCorrected = {
          titleEn: csvTitleEn || item.originalOcr?.titleEn || undefined,
          titleAr: csvTitleAr || item.originalOcr?.titleAr || undefined,
          brand: csvBrand || item.originalOcr?.brand || undefined,
          sizeOrWeight: csvSize || item.originalOcr?.sizeOrWeight || undefined
        }
        item.isAiCorrected = true
        result.aiCorrectedCount++

        // Update active working fields ONLY if not locked by operator
        if (!item.operatorEditedFields.includes('titleEn') && csvTitleEn) {
          item.titleEn = csvTitleEn
        }
        if (!item.operatorEditedFields.includes('titleAr') && csvTitleAr) {
          item.titleAr = csvTitleAr
        }
        if (!item.operatorEditedFields.includes('brand') && csvBrand) {
          item.brand = csvBrand
        }
        if (!item.operatorEditedFields.includes('sizeOrWeight') && csvSize) {
          item.sizeOrWeight = csvSize
        }

        // Post-Correction DB Re-match
        const postMatch = await checkPostCorrectionCatalogMatch(item, supabase)
        if (postMatch) {
          item.postCorrectionDbMatch = postMatch
          item.existingDbImageUrl = postMatch.existingImageUrl
          if (item.selectedImageSource !== 'custom_local' && item.selectedImageSource !== 'custom_url') {
            item.selectedImageSource = 'existing_db'
          }
          result.postCorrectionDbMatchCount++
        }
      }
    }

    // 5. Download Candidate Image & Stage Locally
    if (rawUrl && rawUrl.startsWith('http')) {
      options?.onProgress?.({
        current: rowIndex,
        total: dataRows.length,
        message: `Processing image for ${ref}...`,
        stage: 'downloading'
      })

      if (batchCache.has(rawUrl)) {
        const cached = batchCache.get(rawUrl)!
        for (const item of matchedItems) {
          item.candidateImageUrl = rawUrl
          item.candidateImageLocalPath = cached.localPath
          item.candidateImageSha256 = cached.sha256
          item.candidateDownloadError = null
          if (!item.postCorrectionDbMatch && item.selectedImageSource !== 'custom_local' && item.selectedImageSource !== 'custom_url') {
            item.selectedImageSource = 'candidate'
          }
        }
        result.candidateImagesReusedCount++
      } else {
        try {
          const ssrfCheck = await validateSsrfSafeUrl(rawUrl)
          if (!ssrfCheck.valid) {
            throw new Error(`SSRF guard blocked: ${ssrfCheck.reason}`)
          }

          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000)
          const response = await fetch(rawUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'WifranCatalogBot/2.0 (Candidate Downloader)' }
          })
          clearTimeout(timeoutId)

          if (!response.ok) {
            throw new Error(`HTTP fetch failed: ${response.status} ${response.statusText}`)
          }

          const arrayBuf = await response.arrayBuffer()
          const buffer = Buffer.from(arrayBuf)

          if (buffer.length > 10 * 1024 * 1024) {
            throw new Error(`Image size (${buffer.length} bytes) exceeds 10MB limit.`)
          }

          const detected = detectImageMimeType(buffer)
          if (!detected) {
            throw new Error('Image format unsupported or invalid magic bytes. Only JPEG, PNG, or WebP are permitted.')
          }

          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
          const localPath = path.join(imagesDir, `${sha256}.${detected.ext}`)
          await fs.promises.writeFile(localPath, buffer)

          batchCache.set(rawUrl, { buffer, sha256, ext: detected.ext, localPath })

          for (const item of matchedItems) {
            item.candidateImageUrl = rawUrl
            item.candidateImageLocalPath = localPath
            item.candidateImageSha256 = sha256
            item.candidateDownloadError = null
            if (!item.postCorrectionDbMatch && item.selectedImageSource !== 'custom_local' && item.selectedImageSource !== 'custom_url') {
              item.selectedImageSource = 'candidate'
            }
          }
          result.candidateImagesDownloadedCount++
        } catch (err: any) {
          result.candidateImagesFailedCount++
          for (const item of matchedItems) {
            item.candidateDownloadError = err.message
          }
        }
      }
    }
  }

  // 6. Automatic Deletion of Boundary Pages from 'tmp' Bucket
  await cleanupLeafletBoundaryPagesFromTmpBucket(draft, supabase)

  // 7. Check for Missing / Incomplete / Invalid Header Metadata
  const validationWarnings: string[] = []
  const missingFields: Array<'supermarket' | 'region' | 'validFrom' | 'validTo'> = []

  const smId = (draft.header.supermarketId || '').trim()
  if (!smId) {
    validationWarnings.push('Supermarket (SMN) is missing or unselected.')
    missingFields.push('supermarket')
  }

  const reg = (draft.header.region || '').trim()
  if (!reg) {
    validationWarnings.push('Region (REG) is missing or unselected.')
    missingFields.push('region')
  }

  const vFrom = draft.header.validFrom ? normalizeIsoDateString(draft.header.validFrom) : null
  if (!vFrom) {
    validationWarnings.push('Start Date (SD) is missing or invalid.')
    missingFields.push('validFrom')
  }

  const vTo = draft.header.validTo ? normalizeIsoDateString(draft.header.validTo) : null
  if (!vTo) {
    validationWarnings.push('End Date (ED) is missing or invalid.')
    missingFields.push('validTo')
  } else if (vFrom && vTo < vFrom) {
    validationWarnings.push(`End Date (${vTo}) cannot be earlier than Start Date (${vFrom}).`)
    if (!missingFields.includes('validTo')) {
      missingFields.push('validTo')
    }
  }

  result.missingMetadata = missingFields.length > 0
  result.missingFields = missingFields
  result.validationWarnings = validationWarnings
  result.requiresOperatorMetadataConfirmation = true

  await saveStagedLeafletDraft(jobDir, draft)
  return result
}

/**
 * Updates leaflet header metadata in staged-draft.json and marks headerModifiedByOperator = true.
 */
export async function updateStagedLeafletHeader(
  jobDir: string,
  headerPatch: Partial<StagedLeafletHeader>
): Promise<StagedLeafletDraft> {
  const draft = await loadStagedLeafletDraft(jobDir)
  if (!draft) throw new Error(`staged-draft.json not found in job directory: ${jobDir}`)

  if (headerPatch.supermarketId !== undefined) draft.header.supermarketId = headerPatch.supermarketId
  if (headerPatch.region !== undefined) draft.header.region = headerPatch.region
  if (headerPatch.validFrom !== undefined) {
    draft.header.validFrom = headerPatch.validFrom
    for (const item of draft.items) {
      ;(item as any).validFrom = headerPatch.validFrom
      ;(item as any).offer_start_date = headerPatch.validFrom
    }
  }
  if (headerPatch.validTo !== undefined) {
    draft.header.validTo = headerPatch.validTo
    for (const item of draft.items) {
      ;(item as any).validTo = headerPatch.validTo
      ;(item as any).offer_end_date = headerPatch.validTo
    }
  }
  if (headerPatch.firstPagePublicUrl !== undefined) draft.header.firstPagePublicUrl = headerPatch.firstPagePublicUrl
  if (headerPatch.lastPagePublicUrl !== undefined) draft.header.lastPagePublicUrl = headerPatch.lastPagePublicUrl

  draft.header.headerModifiedByOperator = true
  await saveStagedLeafletDraft(jobDir, draft)
  return draft
}





/**
 * Updates one or more offer fields on a staged offer item.
 * Automatically recalculates discount percent if priceBefore or priceAfter changed.
 * Records modified fields in operatorEditedFields and marks isOperatorModified = true.
 */
export async function updateStagedOfferField(
  jobDir: string,
  offerId: string,
  fieldUpdates: Partial<Pick<StagedOfferItem, 'titleEn' | 'titleAr' | 'brand' | 'sizeOrWeight' | 'priceBefore' | 'priceAfter' | 'discountPercent' | 'promoNotes'>>,
  options?: { supabaseClient?: any }
): Promise<StagedLeafletDraft> {
  const draft = await loadStagedLeafletDraft(jobDir)
  if (!draft) throw new Error(`staged-draft.json not found in job directory: ${jobDir}`)

  const item = draft.items.find((i) => i.id === offerId)
  if (!item) throw new Error(`Offer item ${offerId} not found in staged draft.`)

  ensureActiveFields(item)
  const modifiedFields: string[] = []

  for (const [key, val] of Object.entries(fieldUpdates)) {
    if (val !== undefined) {
      (item as any)[key] = val
      if (!item.operatorEditedFields.includes(key)) {
        item.operatorEditedFields.push(key)
      }
      modifiedFields.push(key)
    }
  }

  // Automatic discount percent recalculation if priceBefore or priceAfter changed
  if (fieldUpdates.discountPercent === undefined) {
    const pBefore = item.priceBefore
    const pAfter = item.priceAfter
    if (pBefore != null && pAfter != null && pBefore > pAfter && pBefore > 0) {
      item.discountPercent = Math.round(((pBefore - pAfter) / pBefore) * 100)
    }
  }

  item.isOperatorModified = item.operatorEditedFields.length > 0

  const identityFields = ['titleEn', 'titleAr', 'brand', 'sizeOrWeight', 'inner_pack_count', 'sale_unit_type', 'each_size_value', 'each_size_unit']
  if (modifiedFields.some((f) => identityFields.includes(f))) {
    const supabase = options?.supabaseClient || getSupabaseAdminClient()
    const postMatch = await checkPostCorrectionCatalogMatch(item, supabase)
    if (postMatch) {
      item.postCorrectionDbMatch = postMatch
      item.matchedProductId = postMatch.productId
    }
    // WIFRAN-002I-V Requirement 3: Invalidate approval when identity-relevant offer information changes,
    // including brand, size, package count, sale unit or variant—even if the candidate product ID stays unchanged.
    if (item.operatorApprovedIdentity) {
      item.operatorApprovedIdentity = false
      item.operatorApprovedProductId = null
      item.operatorApprovedBy = null
      item.operatorApprovedAt = null
    }
  }

  await saveStagedLeafletDraft(jobDir, draft)
  return draft
}

/**
 * Records an explicit operator approval for an offer's product identity,
 * bound to the exact offer and product ID (Requirement 5).
 */
export async function approveStagedOfferProductIdentity(
  jobDir: string,
  offerId: string,
  approvedProductId: number,
  operatorName?: string
): Promise<StagedLeafletDraft> {
  const draft = await loadStagedLeafletDraft(jobDir)
  if (!draft) throw new Error(`staged-draft.json not found in job directory: ${jobDir}`)

  const item = draft.items.find((i) => i.id === offerId)
  if (!item) throw new Error(`Offer item ${offerId} not found in staged draft.`)

  ensureActiveFields(item)
  item.operatorApprovedIdentity = true
  item.operatorApprovedProductId = approvedProductId
  item.operatorApprovedBy = operatorName || 'operator'
  item.operatorApprovedAt = new Date().toISOString()
  item.matchedProductId = approvedProductId

  await saveStagedLeafletDraft(jobDir, draft)
  return draft
}

/**
 * Reverts either a specific field or all operator edits on an offer back to
 * aiCorrected (if present) or originalOcr snapshot.
 */
export async function revertStagedOfferField(
  jobDir: string,
  offerId: string,
  fieldName?: string
): Promise<StagedLeafletDraft> {
  const draft = await loadStagedLeafletDraft(jobDir)
  if (!draft) throw new Error(`staged-draft.json not found in job directory: ${jobDir}`)

  const item = draft.items.find((i) => i.id === offerId)
  if (!item) throw new Error(`Offer item ${offerId} not found in staged draft.`)

  ensureActiveFields(item)
  const fieldsToRevert = fieldName ? [fieldName] : [...item.operatorEditedFields]

  for (const f of fieldsToRevert) {
    if (f === 'titleEn') {
      item.titleEn = item.aiCorrected?.titleEn ?? item.originalOcr?.titleEn ?? null
    } else if (f === 'titleAr') {
      item.titleAr = item.aiCorrected?.titleAr ?? item.originalOcr?.titleAr ?? null
    } else if (f === 'brand') {
      item.brand = item.aiCorrected?.brand ?? item.originalOcr?.brand ?? null
    } else if (f === 'sizeOrWeight') {
      item.sizeOrWeight = item.aiCorrected?.sizeOrWeight ?? item.originalOcr?.sizeOrWeight ?? null
    } else if (f === 'priceBefore') {
      item.priceBefore = item.originalOcr?.priceBefore ?? null
    } else if (f === 'priceAfter') {
      item.priceAfter = item.originalOcr?.priceAfter ?? null
    } else if (f === 'discountPercent') {
      item.discountPercent = item.originalOcr?.discountPercent ?? null
    } else if (f === 'promoNotes') {
      item.promoNotes = item.originalOcr?.promoNotes ?? null
    } else if (f === 'consumerImage') {
      item.selectedImageSource = item.candidateImageLocalPath
        ? 'candidate'
        : (item.existingDbImageUrl ? 'existing_db' : 'none')
      item.customImageUrl = null
      item.customImageLocalPath = null
    }

    item.operatorEditedFields = item.operatorEditedFields.filter((field) => field !== f)
  }

  item.isOperatorModified = item.operatorEditedFields.length > 0
  await saveStagedLeafletDraft(jobDir, draft)
  return draft
}





/**
 * Replaces the consumer display image for a staged offer item
 * (swapping to existing_db, candidate, custom_local, custom_url, or none).
 */
export async function replaceStagedOfferConsumerImage(
  jobDir: string,
  offerId: string,
  replacement: {
    mode: 'existing_db' | 'candidate' | 'custom_local' | 'custom_url' | 'none'
    localFilePath?: string
    customUrl?: string
  }
): Promise<StagedLeafletDraft> {
  const draft = await loadStagedLeafletDraft(jobDir)
  if (!draft) throw new Error(`staged-draft.json not found in job directory: ${jobDir}`)

  const item = draft.items.find((i) => i.id === offerId)
  if (!item) throw new Error(`Offer item ${offerId} not found in staged draft.`)

  ensureActiveFields(item)
  const imagesDir = path.join(jobDir, 'staged-candidate-images')
  await fs.promises.mkdir(imagesDir, { recursive: true })

  if (replacement.mode === 'custom_url') {
    if (!replacement.customUrl) throw new Error('customUrl is required for mode custom_url')
    const ssrf = await validateSsrfSafeUrl(replacement.customUrl)
    if (!ssrf.valid) throw new Error(`SSRF guard blocked URL: ${ssrf.reason}`)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(replacement.customUrl, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) throw new Error(`HTTP fetch failed: ${res.status} ${res.statusText}`)

    const buf = Buffer.from(await res.arrayBuffer())
    const detected = detectImageMimeType(buf)
    if (!detected) throw new Error('Image format unsupported or invalid magic bytes.')

    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    const stagedPath = path.join(imagesDir, `${sha256}.${detected.ext}`)
    await fs.promises.writeFile(stagedPath, buf)

    item.customImageUrl = replacement.customUrl
    item.customImageLocalPath = stagedPath
    item.selectedImageSource = 'custom_url'
  } else if (replacement.mode === 'custom_local') {
    if (!replacement.localFilePath || !fs.existsSync(replacement.localFilePath)) {
      throw new Error(`Local file not found: ${replacement.localFilePath}`)
    }
    const buf = await fs.promises.readFile(replacement.localFilePath)
    const detected = detectImageMimeType(buf)
    if (!detected) throw new Error('Local file format unsupported or invalid magic bytes.')

    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    const stagedPath = path.join(imagesDir, `${sha256}.${detected.ext}`)
    await fs.promises.writeFile(stagedPath, buf)

    item.customImageLocalPath = stagedPath
    item.selectedImageSource = 'custom_local'
  } else if (replacement.mode === 'existing_db') {
    if (!item.existingDbImageUrl) {
      throw new Error('No existing DB image available for this offer.')
    }
    item.selectedImageSource = 'existing_db'
  } else if (replacement.mode === 'candidate') {
    if (!item.candidateImageLocalPath) {
      throw new Error('No candidate image available for this offer.')
    }
    item.selectedImageSource = 'candidate'
  } else if (replacement.mode === 'none') {
    item.selectedImageSource = 'none'
  }

  if (!item.operatorEditedFields.includes('consumerImage')) {
    item.operatorEditedFields.push('consumerImage')
  }
  item.isOperatorModified = true

  await saveStagedLeafletDraft(jobDir, draft)
  return draft
}




/**
 * Publishes a staged leaflet draft atomically to PostgreSQL and Supabase Storage.
 * - Validates header fields and enforces operator authorization gate.
 * - Upserts leaflet and offer records.
 * - Uploads evidence crops to offer-images bucket.
 * - Routes consumer images to product-images (Route P) or offer-display-images (Route O).
 * - Learns product aliases from AI/operator corrected titles.
 * - Purges published short offer IDs from exports/offer-image-ref-map.json.
 * - Updates staged-draft.json status to 'published'.
 */
export async function publishStagedLeafletDraftToDb(
  jobDir: string,
  options?: PublishStagedLeafletOptions
): Promise<PublishStagedLeafletResult> {
  const result: PublishStagedLeafletResult = {
    ok: false,
    offersPublishedCount: 0,
    offersSkippedAlreadyPublishedCount: 0,
    productImagesUploadedCount: 0,
    offerDisplayImagesUploadedCount: 0,
    reusedExistingDbImagesCount: 0,
    aliasesLearnedCount: 0,
    purgedShortRefsCount: 0,
    errors: []
  }

  // 1. Authorization gate (WIFRAN-07J §4)
  if (!options?.operatorConfirmedPublish) {
    result.errors.push('Operator confirmation required to publish to database (WIFRAN-07J §4).')
    return result
  }

  // 2. Load staged draft
  const draft = await loadStagedLeafletDraft(jobDir, { skipAutoInit: true })
  if (!draft) {
    result.errors.push(`staged-draft.json not found in job directory: ${jobDir}`)
    return result
  }

  // 3. Header validation
  const header = draft.header
  if (!header.supermarketId || !header.supermarketId.trim()) {
    result.errors.push('Header validation failed: Supermarket ID is required.')
  }
  if (!header.region || !header.region.trim()) {
    result.errors.push('Header validation failed: Region is required.')
  }
  if (!header.validFrom || !header.validFrom.trim()) {
    result.errors.push('Header validation failed: Valid From date is required.')
  }
  if (!header.validTo || !header.validTo.trim()) {
    result.errors.push('Header validation failed: Valid To date is required.')
  }

  if (header.validFrom && header.validTo) {
    const fromTime = new Date(header.validFrom).getTime()
    const toTime = new Date(header.validTo).getTime()
    if (isNaN(fromTime) || isNaN(toTime)) {
      result.errors.push('Header validation failed: Valid From and Valid To must be valid dates.')
    } else if (toTime < fromTime) {
      result.errors.push('Header validation failed: Valid To must be greater than or equal to Valid From.')
    }
  }

  if (result.errors.length > 0) {
    return result
  }

  const supabase = options?.supabaseClient || getSupabaseAdminClient()
  const rightsBasis = options?.rightsBasis || 'operator_manual_verified'
  const reviewedBy = options?.reviewedBy || 'operator'

  const leafletId =
    draft.leafletHash ||
    `${header.supermarketId}-${header.region}-${header.validFrom}-${header.validTo}`
  result.leafletId = leafletId

  // 4. Upsert leaflet record
  const leafletRecord = {
    id: leafletId,
    supermarket_id: header.supermarketId,
    region: header.region,
    valid_from: header.validFrom,
    valid_to: header.validTo,
    first_page_url: header.firstPagePublicUrl || null,
    last_page_url: header.lastPagePublicUrl || null,
    updated_at: new Date().toISOString()
  }

  try {
    const { error: leafletErr } = await supabase.from('leaflets').upsert(leafletRecord, { onConflict: 'id' })
    if (leafletErr && (leafletErr.code === 'PGRST205' || leafletErr.message?.includes('does not exist'))) {
      // Fallback/mirror to offer_sources
      try {
        await supabase
          .from('offer_sources')
          .upsert(
            {
              leaflet_id: leafletId,
              supermarket_id: header.supermarketId,
              source_type: 'leaflet_pdf',
              valid_from: header.validFrom,
              valid_to: header.validTo
            },
            { onConflict: 'leaflet_id' }
          )
      } catch {
        // ignore
      }
    }
  } catch (err: any) {
    console.warn('Leaflet table upsert warning:', err)
  }

  // Load short-id ref map
  const refMap = await loadOfferRefMap(options?.mapFilePath)

  // 5. Process each staged offer item
  let currentOfferIndex = 0
  const totalOffers = draft.items.length

  for (const item of draft.items) {
    currentOfferIndex++
    options?.onProgress?.({
      current: currentOfferIndex,
      total: totalOffers,
      message: `Publishing offer ${item.imageRef || item.id} (${currentOfferIndex}/${totalOffers})`,
      stage: 'publishing_offers'
    })

    try {
      const sourceOfferId = item.sourceOfferId || item.id

      // 5a-pre. Check if an existing offer exists by source_offer_id to guarantee idempotency across repeated imports
      let existingOfferRow: any = null
      if (sourceOfferId) {
        const { data: existingRow, error: existingLookupErr } = await supabase
          .from('offers')
          .select('id, product_id, catalog_match_status, catalog_verification_basis, catalog_verified_by, catalog_verified_at, approved_by')
          .eq('source_offer_id', sourceOfferId)
          .maybeSingle()

        if (existingLookupErr) {
          result.errors.push(
            `Database lookup error for existing source offer '${sourceOfferId}': ${existingLookupErr.message || String(existingLookupErr)}. Publication aborted for this item.`
          )
          continue // Abort affected publishing operation before any write
        }
        existingOfferRow = existingRow
      }

      if (existingOfferRow?.id && !options?.allowExistingOfferUpdates) {
        // Safe default: existing source offer must be skipped without modification (true no-op)
        result.offersSkippedAlreadyPublishedCount++
        continue
      }

      // Determine final product_id with safety validation: candidate suggestions MUST be explicitly reviewed
      let candidateProductId: number | null = null
      if (item.postCorrectionDbMatch?.productId != null) {
        candidateProductId = item.postCorrectionDbMatch.productId
      } else if (item.matchedProductId != null) {
        candidateProductId = item.matchedProductId
      }

      // Re-verify compatibility before persisting product_id
      let isVerifiedAndCompatible = false
      let productId: number | null = null

      if (candidateProductId != null) {
        const { data: prodRecord, error: prodLookupErr } = await supabase
          .from('products')
          .select('id, name_en, name_ar, item_name_complete, canonical_product_key, brand_id, brand_name, variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type, verification_status')
          .eq('id', candidateProductId)
          .maybeSingle()
        if (prodLookupErr) {
          result.errors.push(`Database lookup error for offer ${item.id} on product #${candidateProductId}: ${prodLookupErr.message || String(prodLookupErr)}. Publication aborted for this item.`)
          continue // Abort publishing this offer to avoid unlinking on transient database failure
        } else if (!prodRecord) {
          result.errors.push(`Offer ${item.id} references missing or unverified product #${candidateProductId}; product link unlinked.`)
          productId = null
          isVerifiedAndCompatible = false
        } else {
          const compat = validateProductIdentityCompatibility(item, prodRecord)
          if (compat.isCompatible) {
            // Suggestion-to-publishing boundary enforcement (WIFRAN-002I-V):
            // 1. A candidate suggestion (matchedProductId) alone is NOT human verification.
            // 2. An automatically discovered post-correction match (postCorrectionDbMatch) is NOT human approval.
            // 3. Automatic selection of an existing DB image (selectedImageSource === 'existing_db') is NOT human approval.
            // 4. Operator approval must be strictly bound to the exact offer and candidate product ID:
            //    (item.operatorApprovedIdentity === true && item.operatorApprovedProductId === candidateProductId)
            // 5. Unsafe fallback shortcuts (operatorApprovedProductId === undefined) are eliminated.
            // 6. Canary auto-linking is disabled pending cryptographically authenticated operator subsystem.
            const isExplicitlyOperatorApproved =
              item.operatorApprovedIdentity === true &&
              item.operatorApprovedProductId === candidateProductId

            if (isExplicitlyOperatorApproved) {
              isVerifiedAndCompatible = true
              productId = candidateProductId
            } else {
              // Unreviewed suggestion, auto-selected image, or unverified canary auto-link:
              // Must remain unresolved in catalog with product_id = null
              isVerifiedAndCompatible = false
              productId = null
            }
          } else {
            result.errors.push(`Offer ${item.id} contradicted linked product #${candidateProductId}: ${compat.reason}`)
            productId = null // Block linking contradictory product
            isVerifiedAndCompatible = false
          }
        }
      }

      // Existing verified links and operator verification metadata must remain protected against degradation
      if (existingOfferRow?.catalog_match_status === 'verified_linked' && existingOfferRow?.product_id != null) {
        if (!isVerifiedAndCompatible || productId == null) {
          productId = Number(existingOfferRow.product_id)
          isVerifiedAndCompatible = true
        }
      }

      // 5a. Upload private evidence crop to offer-images bucket
      let evidenceCropStoragePath: string | null = null
      let evidenceCropPublicUrl: string | null = null

      if (item.croppedEvidenceLocalPath && fs.existsSync(item.croppedEvidenceLocalPath)) {
        try {
          const cropBuf = await fs.promises.readFile(item.croppedEvidenceLocalPath)
          const cropMime = detectImageMimeType(cropBuf)
          const cropExt = cropMime?.ext || 'webp'
          const cropContentType = cropMime?.mimeType || 'image/webp'
          const cropSha = crypto.createHash('sha256').update(cropBuf).digest('hex')
          evidenceCropStoragePath = `leaflets/${leafletId}/offers/${existingOfferRow?.id || item.id}/crop_${cropSha.slice(0, 12)}.${cropExt}`

          const { error: cropUploadErr } = await supabase.storage
            .from('offer-images')
            .upload(evidenceCropStoragePath, cropBuf, {
              contentType: cropContentType,
              upsert: true
            })

          if (!cropUploadErr) {
            const { data: pubData } = supabase.storage
              .from('offer-images')
              .getPublicUrl(evidenceCropStoragePath)
            evidenceCropPublicUrl = pubData?.publicUrl || null
          }
        } catch (cropErr) {
          console.warn(`Evidence crop upload failed for ${item.id}:`, cropErr)
        }
      }

      // 5b. Upsert offer record into public.offers
      let offerId = existingOfferRow?.id || item.id

      if (!offerId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(offerId)) {
        offerId = crypto.randomUUID()
      }

      const offerPayload: any = {
        id: offerId,
        source_offer_id: sourceOfferId,
        supermarket_id: header.supermarketId || null,
        title_en: item.titleEn || null,
        title_ar: item.titleAr || null,
        brand_candidate_text: item.brand || null,
        each_size_value: typeof (item as any).each_size_value === 'number' ? (item as any).each_size_value : null,
        each_size_unit: (item as any).each_size_unit || null,
        inner_pack_count: typeof (item as any).inner_pack_count === 'number' ? (item as any).inner_pack_count : 1,
        sale_unit_type: (item as any).sale_unit_type || 'each',
        original_price: item.priceBefore ?? null,
        offer_price: item.priceAfter ?? item.priceBefore ?? 0,
        discount_percentage: item.discountPercent ?? null,
        bonus_wording: item.promoNotes || null,
        product_id: productId,
        catalog_match_status: productId ? (isVerifiedAndCompatible ? 'verified_linked' : 'conflict_needs_review') : 'unresolved',
        offer_start_date: header.validFrom,
        offer_end_date: header.validTo,
        status: 'published',
        published_at: new Date().toISOString(),
        location_scope: (item as any).location_scope || (header as any).locationScope || 'city',
        city_id: (item as any).city_id || (header as any).cityId || null,
        region_id: (item as any).region_id || (header as any).regionId || null,
        quantity_limit: (item as any).quantity_limit ?? null,
        quantity_limit_value: (item as any).quantity_limit_value ?? null,
        updated_at: new Date().toISOString()
      }

      if (existingOfferRow?.catalog_match_status === 'verified_linked' && productId === Number(existingOfferRow.product_id)) {
        if (existingOfferRow.catalog_verification_basis) offerPayload.catalog_verification_basis = existingOfferRow.catalog_verification_basis
        if (existingOfferRow.catalog_verified_by) offerPayload.catalog_verified_by = existingOfferRow.catalog_verified_by
        if (existingOfferRow.catalog_verified_at) offerPayload.catalog_verified_at = existingOfferRow.catalog_verified_at
        if (existingOfferRow.approved_by) offerPayload.approved_by = existingOfferRow.approved_by
      } else if (productId && isVerifiedAndCompatible) {
        offerPayload.catalog_verification_basis = rightsBasis
        offerPayload.catalog_verified_by = reviewedBy
        offerPayload.catalog_verified_at = new Date().toISOString()
      }

      if (evidenceCropStoragePath) {
        offerPayload.thumbnail_storage_path = evidenceCropStoragePath
        offerPayload.thumbnail_url = evidenceCropPublicUrl
      }

      const { error: offerErr } = await supabase.from('offers').upsert(offerPayload, { onConflict: 'id' })
      if (offerErr) {
        if (
          offerErr.code === '23505' ||
          offerErr.message?.includes('23505') ||
          offerErr.message?.includes('idx_offers_source_offer_id') ||
          offerErr.message?.includes('unique constraint')
        ) {
          result.errors.push(
            `Concurrent insert conflict: source_offer_id '${sourceOfferId}' already exists in database (PostgreSQL 23505). Offer insert was safely rejected.`
          )
        } else {
          result.errors.push(`Failed to upsert offer ${item.id}: ${offerErr.message}`)
        }
      } else {
        result.offersPublishedCount++
      }

      // 5c. Alias Auto-Learning on Corrected Matches
      // OPERATIONAL LIMITATION (WIFRAN-EXTRACTOR-IDENTITY-001E):
      // Automatic alias learning is strictly disabled because the application does not yet implement
      // a cryptographically verified, session-authenticated operator authorization subsystem.
      // Arbitrary local draft JSON or IPC payloads must not be able to trigger database alias mutations.
      const isOperatorApproved = false
      if (productId && isVerifiedAndCompatible && isOperatorApproved) {
        const aliasesToLearn: Array<{ aliasText: string; language: 'ar' | 'en' | 'mixed' | 'unknown'; source: string }> = []
        if (item.originalOcr?.titleAr && item.originalOcr.titleAr !== item.titleAr) {
          aliasesToLearn.push({
            aliasText: item.originalOcr.titleAr,
            language: 'ar',
            source: 'auto_learned_ocr_correction'
          })
          const normAr = normalizeArabicText(item.originalOcr.titleAr)
          if (normAr && normAr !== item.originalOcr.titleAr) {
            aliasesToLearn.push({
              aliasText: normAr,
              language: 'ar',
              source: 'auto_learned_ocr_correction'
            })
          }
        }
        if (item.originalOcr?.titleEn && item.originalOcr.titleEn !== item.titleEn) {
          aliasesToLearn.push({
            aliasText: item.originalOcr.titleEn,
            language: 'en',
            source: 'auto_learned_ocr_correction'
          })
          const normEn = normalizeEnglishText(item.originalOcr.titleEn)
          if (normEn && normEn !== item.originalOcr.titleEn) {
            aliasesToLearn.push({
              aliasText: normEn,
              language: 'en',
              source: 'auto_learned_ocr_correction'
            })
          }
        }

        if (aliasesToLearn.length > 0) {
          const aliasRes = await ensureProductAliases(
            { productId, aliases: aliasesToLearn },
            { supabaseClient: supabase }
          )
          result.aliasesLearnedCount += aliasRes.createdCount
        }
      }

      // 5d. Consumer Display Image Routing & Upload
      if (item.selectedImageSource === 'none') {
        // Leave consumer display image NULL
      } else if (item.selectedImageSource === 'existing_db') {
        if (productId) {
          // Linked product automatically inherits product's primary image in view
          result.reusedExistingDbImagesCount++
        } else if (item.existingDbImageUrl) {
          // Reusing existing DB offer display image
          result.reusedExistingDbImagesCount++
          const { data: existingImg } = await supabase
            .from('offer_display_images')
            .select('id, storage_bucket, storage_object_path, public_url, content_sha256, mime_type, byte_size')
            .eq('public_url', item.existingDbImageUrl)
            .limit(1)

          if (existingImg && existingImg.length > 0) {
            await supabase
              .from('offer_display_images')
              .upsert(
                {
                  offer_id: offerId,
                  storage_bucket: existingImg[0].storage_bucket || 'offer-display-images',
                  storage_object_path: existingImg[0].storage_object_path,
                  public_url: existingImg[0].public_url,
                  mime_type: existingImg[0].mime_type || 'image/webp',
                  byte_size: existingImg[0].byte_size || 0,
                  content_sha256: existingImg[0].content_sha256,
                  source_kind: 'generated_illustration',
                  visual_subject_key: item.matchedVisualSubjectKey || item.imageRef || 'generic',
                  approval_status: 'approved',
                  rights_basis: rightsBasis,
                  reviewed_by: reviewedBy,
                  reviewed_at: new Date().toISOString()
                },
                { onConflict: 'offer_id' }
              )
              .catch(() => {})
          }
        }
      } else if (
        item.selectedImageSource === 'candidate' ||
        item.selectedImageSource === 'custom_local' ||
        item.selectedImageSource === 'custom_url'
      ) {
        const stagedImagePath =
          item.selectedImageSource === 'custom_local'
            ? item.customImageLocalPath
            : item.selectedImageSource === 'custom_url'
              ? item.customImageLocalPath || item.candidateImageLocalPath
              : item.candidateImageLocalPath

        if (stagedImagePath && fs.existsSync(stagedImagePath)) {
          const imgBuf = await fs.promises.readFile(stagedImagePath)
          const detectedMime = detectImageMimeType(imgBuf)
          if (detectedMime) {
            const contentSha256 = crypto.createHash('sha256').update(imgBuf).digest('hex')

            // Route P: Offer linked to product_id
            if (productId != null) {
              let storagePath = `catalog/${contentSha256}.${detectedMime.ext}`
              let publicUrl: string

              const { data: existingProdImg } = await supabase
                .from('product_images')
                .select('id, storage_bucket, storage_object_path, public_url')
                .eq('content_sha256', contentSha256)
                .eq('approval_status', 'approved')
                .limit(1)

              if (existingProdImg && existingProdImg.length > 0) {
                storagePath = existingProdImg[0].storage_object_path
                publicUrl = existingProdImg[0].public_url
                result.reusedExistingDbImagesCount++
              } else {
                const { error: uploadErr } = await supabase.storage
                  .from('product-images')
                  .upload(storagePath, imgBuf, {
                    contentType: detectedMime.mimeType,
                    upsert: true
                  })

                if (uploadErr) {
                  result.errors.push(`Storage upload failed for product ${productId}: ${uploadErr.message}`)
                  continue
                }

                const { data: pubData } = supabase.storage.from('product-images').getPublicUrl(storagePath)
                publicUrl = pubData.publicUrl
                result.productImagesUploadedCount++
              }

              // Check if active primary image exists for product
              const { data: activePrimary } = await supabase
                .from('product_images')
                .select('id')
                .eq('product_id', productId)
                .eq('role', 'primary')
                .eq('approval_status', 'approved')
                .limit(1)

              let primaryImageId: string
              if (activePrimary && activePrimary.length > 0) {
                await supabase
                  .from('product_images')
                  .update({
                    storage_bucket: 'product-images',
                    storage_object_path: storagePath,
                    public_url: publicUrl,
                    mime_type: detectedMime.mimeType,
                    byte_size: imgBuf.length,
                    content_sha256: contentSha256,
                    rights_basis: rightsBasis,
                    reviewed_by: reviewedBy,
                    reviewed_at: new Date().toISOString()
                  })
                  .eq('id', activePrimary[0].id)
                primaryImageId = activePrimary[0].id
              } else {
                const { data: insertedImg, error: imgErr } = await supabase
                  .from('product_images')
                  .insert({
                    product_id: productId,
                    role: 'primary',
                    storage_bucket: 'product-images',
                    storage_object_path: storagePath,
                    public_url: publicUrl,
                    mime_type: detectedMime.mimeType,
                    byte_size: imgBuf.length,
                    content_sha256: contentSha256,
                    source_url: item.candidateImageUrl || item.customImageUrl || publicUrl,
                    normalized_source_url: item.candidateImageUrl || item.customImageUrl || publicUrl,
                    approval_status: 'approved',
                    rights_basis: rightsBasis,
                    reviewed_by: reviewedBy,
                    reviewed_at: new Date().toISOString()
                  })
                  .select('id')
                  .single()

                if (imgErr) {
                  result.errors.push(`Failed to insert product image: ${imgErr.message}`)
                  continue
                }
                primaryImageId = insertedImg.id
              }

              // Update products table
              await supabase
                .from('products')
                .update({
                  approved_primary_image_id: primaryImageId,
                  default_image_url: publicUrl
                })
                .eq('id', productId)
            } else {
              // Route O: Uncatalogued offer
              let storagePath = `offers/${contentSha256}.${detectedMime.ext}`
              let publicUrl: string

              const { data: existingOfferImg } = await supabase
                .from('offer_display_images')
                .select('id, storage_bucket, storage_object_path, public_url')
                .eq('content_sha256', contentSha256)
                .eq('approval_status', 'approved')
                .limit(1)

              if (existingOfferImg && existingOfferImg.length > 0) {
                storagePath = existingOfferImg[0].storage_object_path
                publicUrl = existingOfferImg[0].public_url
                result.reusedExistingDbImagesCount++
              } else {
                const { error: uploadErr } = await supabase.storage
                  .from('offer-display-images')
                  .upload(storagePath, imgBuf, {
                    contentType: detectedMime.mimeType,
                    upsert: true
                  })

                if (uploadErr) {
                  result.errors.push(`Storage upload failed for offer ${item.id}: ${uploadErr.message}`)
                  continue
                }

                const { data: pubData } = supabase.storage.from('offer-display-images').getPublicUrl(storagePath)
                publicUrl = pubData.publicUrl
                result.offerDisplayImagesUploadedCount++
              }

              const visualSubjectKey = item.matchedVisualSubjectKey || item.imageRef || 'generic'

              const { data: activeOfferImg } = await supabase
                .from('offer_display_images')
                .select('id')
                .eq('offer_id', offerId)
                .eq('approval_status', 'approved')
                .limit(1)

              if (activeOfferImg && activeOfferImg.length > 0) {
                await supabase
                  .from('offer_display_images')
                  .update({
                    storage_bucket: 'offer-display-images',
                    storage_object_path: storagePath,
                    public_url: publicUrl,
                    mime_type: detectedMime.mimeType,
                    byte_size: imgBuf.length,
                    content_sha256: contentSha256,
                    visual_subject_key: visualSubjectKey,
                    rights_basis: rightsBasis,
                    reviewed_by: reviewedBy,
                    reviewed_at: new Date().toISOString()
                  })
                  .eq('id', activeOfferImg[0].id)
              } else {
                await supabase.from('offer_display_images').insert({
                  offer_id: offerId,
                  storage_bucket: 'offer-display-images',
                  storage_object_path: storagePath,
                  public_url: publicUrl,
                  mime_type: detectedMime.mimeType,
                  byte_size: imgBuf.length,
                  content_sha256: contentSha256,
                  source_kind: 'generated_illustration',
                  source_url: item.candidateImageUrl || item.customImageUrl || publicUrl,
                  normalized_source_url: item.candidateImageUrl || item.customImageUrl || publicUrl,
                  visual_subject_key: visualSubjectKey,
                  approval_status: 'approved',
                  rights_basis: rightsBasis,
                  reviewed_by: reviewedBy,
                  reviewed_at: new Date().toISOString()
                })
              }

              // Visual group member propagation
              if (item.visualGroupMemberIds && item.visualGroupMemberIds.length > 0) {
                const groupInserts = item.visualGroupMemberIds.map((mId) => ({
                  representative_offer_id: offerId,
                  member_offer_id: mId,
                  visual_subject_key: visualSubjectKey,
                  visual_subject_name: item.titleEn || item.titleAr || 'Product'
                }))
                await supabase
                  .from('offer_visual_group_members')
                  .upsert(groupInserts, { onConflict: 'representative_offer_id,member_offer_id' })
                  .catch(() => {})
              }
            }
          }
        }
      }

      // 5e. Short-ID map purge
      let purged = false
      if (item.imageRef && removeOfferRef(item.imageRef, refMap)) purged = true
      if (item.id && removeOfferRef(item.id, refMap)) purged = true
      if (item.sourceOfferId && removeOfferRef(item.sourceOfferId, refMap)) purged = true
      if (item.visualGroupMemberIds) {
        for (const mId of item.visualGroupMemberIds) {
          if (removeOfferRef(mId, refMap)) purged = true
        }
      }
      if (purged) result.purgedShortRefsCount++
    } catch (offerProcErr: any) {
      result.errors.push(`Error publishing offer ${item.id}: ${offerProcErr.message}`)
    }
  }

  // 6. Save updated short-ID map
  try {
    await saveOfferRefMap(refMap, options?.mapFilePath)
  } catch (mapErr: any) {
    console.warn('Failed to save updated offer ref map:', mapErr)
  }

  // 7. Fallback cleanup of boundary pages from 'tmp' bucket
  await cleanupLeafletBoundaryPagesFromTmpBucket(draft, supabase)

  // 8. Update draft status on disk only if publication succeeded without errors
  if (result.errors.length === 0) {
    draft.status = 'published'
    draft.publishedAt = new Date().toISOString()
  }
  await saveStagedLeafletDraft(jobDir, draft)

  result.ok = result.errors.length === 0
  return result
}
