import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { getSupabaseAdminClient } from './supabaseAdminClient'
import { assertNotOfflineUat, isOfflineUatMode } from '../config/offlineUatGuard'
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
  removeOfferRef,
  type OfferImageRefMap
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
  ensureConfirmedSupermarketExistsInDb,
  parseLeafletFilenameMetadata,
  ResolvedEntity
} from './supermarketRegionResolutionService'
import { normalizeArabicText, normalizeEnglishText } from '../../shared/utils/textNormalization'
import { getDbEligibleItemsFromPackage } from '../extraction/extractionPackageService'
import { loadExtractionManifest, recoverManifestFromExistingFolder } from '../extraction/extractionManifestService'
import { ensureProductAliases } from './productAliasService'
import { validateProductIdentityCompatibility } from './productIdentityCompatibilityValidator'
import { executeTwoStageProductMatch } from './twoStageCandidateRetrievalService'
import { isInvalidFingerprintPlaceholder } from '../metadata/leafletMetadataCacheService'

export { resolveOrCreateSupermarket, resolveOrCreateRegion, parseLeafletFilenameMetadata }
export type { ResolvedEntity }

function computeFileSha256Sync(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const buf = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(buf).digest('hex')
  } catch {
    return null
  }
}

function tryResolveRealPdfFingerprint(
  jobDir: string,
  manifest: any,
  explicitHash?: string | null,
  pdfFilePath?: string | null
): string | null {
  if (explicitHash && !isInvalidFingerprintPlaceholder(explicitHash)) {
    return explicitHash.trim()
  }
  const manifestFp = manifest?.processing_selection?.pdfFingerprint
  if (manifestFp && !isInvalidFingerprintPlaceholder(manifestFp)) {
    return String(manifestFp).trim()
  }
  const confirmedPath = path.join(jobDir, 'metadata', 'confirmed_metadata.json')
  if (fs.existsSync(confirmedPath)) {
    try {
      const conf = JSON.parse(fs.readFileSync(confirmedPath, 'utf8'))
      const fp = conf?.record?.leafletFingerprint || conf?.leafletFingerprint
      if (fp && !isInvalidFingerprintPlaceholder(fp)) {
        return String(fp).trim()
      }
    } catch {
      // ignore malformed confirmed metadata
    }
  }
  if (pdfFilePath && fs.existsSync(pdfFilePath)) {
    const fp = computeFileSha256Sync(pdfFilePath)
    if (fp && !isInvalidFingerprintPlaceholder(fp)) return fp
  }
  if (fs.existsSync(jobDir)) {
    try {
      const pdfs = fs.readdirSync(jobDir).filter((f) => f.toLowerCase().endsWith('.pdf'))
      if (pdfs.length > 0) {
        const fp = computeFileSha256Sync(path.join(jobDir, pdfs[0]))
        if (fp && !isInvalidFingerprintPlaceholder(fp)) return fp
      }
    } catch {
      // ignore readdir failure
    }
  }
  return null
}

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

const STAGED_DRAFT_HISTORY_FILENAME = 'staged-draft-history.json'

interface StagedDraftHistoryRecord {
  schemaVersion: 'wifran.staged.draft.history/1.0'
  updatedAt: string
  itemsByKey: Record<string, StagedOfferItem>
  publishedOfferKeys?: string[]
  publishedPages?: number[]
}

function cloneStagedOfferItem(item: StagedOfferItem): StagedOfferItem {
  return JSON.parse(JSON.stringify(item)) as StagedOfferItem
}

function getStagedItemPageNumber(item: any): number | null {
  const raw = item?.pageNumber ?? item?.sourcePageNumber
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw
  }
  const idStr = String(item?.sourceOfferId || item?.id || '')
  const m = idStr.match(/(?:^|[_-])p(?:age)?0*(\d+)(?:[_-]|$)/i) || idStr.match(/^page-0*(\d+)-/i)
  return m ? parseInt(m[1], 10) : null
}

function getStagedItemKey(item: any, fallbackIndex = 0): string {
  const raw = String(item?.sourceOfferId || item?.id || '').trim()
  if (raw) return raw
  const page = getStagedItemPageNumber(item) ?? 0
  return `page-${page}-idx-${fallbackIndex}`
}

function resolveSelectedScopeSetFromManifest(manifest: any): Set<number> | null {
  const sel = manifest?.processing_selection
  if (
    sel?.selectionMode === 'specific' &&
    Array.isArray(sel.selectedPages) &&
    sel.selectedPages.length > 0
  ) {
    return new Set(sel.selectedPages)
  }
  return null
}

async function loadStagedDraftHistory(jobDir: string): Promise<StagedDraftHistoryRecord | null> {
  const historyPath = path.join(jobDir, STAGED_DRAFT_HISTORY_FILENAME)
  try {
    const raw = await fs.promises.readFile(historyPath, 'utf8')
    const parsed = JSON.parse(raw) as StagedDraftHistoryRecord
    if (parsed && typeof parsed === 'object' && parsed.itemsByKey && typeof parsed.itemsByKey === 'object') {
      return parsed
    }
  } catch {
    // Missing or unreadable history is treated as empty
  }
  return null
}

async function upsertItemsIntoStagedDraftHistory(
  jobDir: string,
  items: StagedOfferItem[],
  extra?: { markPublishedKeys?: string[]; markPublishedPages?: number[] }
): Promise<StagedDraftHistoryRecord> {
  const existing = await loadStagedDraftHistory(jobDir)
  const history: StagedDraftHistoryRecord = existing || {
    schemaVersion: 'wifran.staged.draft.history/1.0',
    updatedAt: new Date().toISOString(),
    itemsByKey: {},
    publishedOfferKeys: [],
    publishedPages: []
  }

  if (Array.isArray(items)) {
    items.forEach((item, idx) => {
      ensureActiveFields(item)
      const key = getStagedItemKey(item, idx)
      history.itemsByKey[key] = cloneStagedOfferItem(item)
    })
  }

  if (Array.isArray(extra?.markPublishedKeys) && extra.markPublishedKeys.length > 0) {
    const pubKeys = new Set(history.publishedOfferKeys || [])
    for (const k of extra.markPublishedKeys) {
      if (k) pubKeys.add(k)
    }
    history.publishedOfferKeys = Array.from(pubKeys)
  }

  if (Array.isArray(extra?.markPublishedPages) && extra.markPublishedPages.length > 0) {
    const pubPages = new Set(history.publishedPages || [])
    for (const p of extra.markPublishedPages) {
      if (typeof p === 'number' && Number.isFinite(p) && p > 0) pubPages.add(p)
    }
    history.publishedPages = Array.from(pubPages).sort((a, b) => a - b)
  }

  history.updatedAt = new Date().toISOString()
  await fs.promises.mkdir(jobDir, { recursive: true })
  await fs.promises.writeFile(
    path.join(jobDir, STAGED_DRAFT_HISTORY_FILENAME),
    JSON.stringify(history, null, 2),
    'utf8'
  )
  return history
}

function mergeScopedItemsFromHistory(
  draftItems: StagedOfferItem[],
  history: StagedDraftHistoryRecord | null,
  selectedScopeSet: Set<number> | null
): { items: StagedOfferItem[]; recoveredCount: number } {
  const isInScope = (item: StagedOfferItem): boolean => {
    if (!selectedScopeSet) return true
    const itemPage = getStagedItemPageNumber(item)
    return itemPage == null || selectedScopeSet.has(itemPage)
  }

  const activeInScope = (Array.isArray(draftItems) ? draftItems : []).filter(isInScope)
  const activeKeySet = new Set(activeInScope.map((item, idx) => getStagedItemKey(item, idx)))

  const mergedByKey = new Map<string, StagedOfferItem>()
  let recoveredCount = 0

  if (history && history.itemsByKey) {
    for (const [key, archivedItem] of Object.entries(history.itemsByKey)) {
      if (isInScope(archivedItem)) {
        const cloned = cloneStagedOfferItem(archivedItem)
        ensureActiveFields(cloned)
        mergedByKey.set(key, cloned)
        if (!activeKeySet.has(key)) {
          recoveredCount++
        }
      }
    }
  }

  // Active in-scope draft items always win on key collision so partial-run edits are preserved
  activeInScope.forEach((item, idx) => {
    const key = getStagedItemKey(item, idx)
    ensureActiveFields(item)
    mergedByKey.set(key, item)
  })

  const mergedItems = Array.from(mergedByKey.values())
  if (recoveredCount > 0) {
    mergedItems.sort((a, b) => {
      const pA = getStagedItemPageNumber(a) ?? Number.MAX_SAFE_INTEGER
      const pB = getStagedItemPageNumber(b) ?? Number.MAX_SAFE_INTEGER
      return pA - pB
    })
  }

  return { items: mergedItems, recoveredCount }
}

function resetPublishedStatusIfUnpublishedItemsPresent(
  draft: StagedLeafletDraft,
  history: StagedDraftHistoryRecord | null
): boolean {
  if (draft.status !== 'published') return false
  if (!Array.isArray(draft.items) || draft.items.length === 0) return false
  const pubKeys = new Set(history?.publishedOfferKeys || [])
  if (pubKeys.size === 0 && !draft.partialCoveragePublish) {
    return false
  }
  const hasUnpublishedInScopeItem = draft.items.some((item, idx) => !pubKeys.has(getStagedItemKey(item, idx)))
  if (hasUnpublishedInScopeItem) {
    draft.status = 'draft'
    return true
  }
  return false
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

    if (!options?.skipAutoInit && draft) {
      try {
        const manifest = await loadExtractionManifest(jobDir)
        const selectedScopeSet = resolveSelectedScopeSetFromManifest(manifest)
        const existingHistory = await loadStagedDraftHistory(jobDir)
        let changed = false

        if (!draft.leafletHash || isInvalidFingerprintPlaceholder(draft.leafletHash)) {
          const repairedFp = tryResolveRealPdfFingerprint(jobDir, manifest, draft.leafletHash)
          if (repairedFp && repairedFp !== draft.leafletHash) {
            draft.leafletHash = repairedFp
            changed = true
          }
        }

        if (selectedScopeSet !== null || (existingHistory && Object.keys(existingHistory.itemsByKey).length > 0)) {
          let activeHistory = existingHistory
          if (Array.isArray(draft.items) && draft.items.length > 0) {
            activeHistory = await upsertItemsIntoStagedDraftHistory(jobDir, draft.items)
          }
          const prevKeys = (draft.items || []).map((i, idx) => getStagedItemKey(i, idx))
          const { items: scopedMerged } = mergeScopedItemsFromHistory(draft.items || [], activeHistory, selectedScopeSet)
          const nextKeys = scopedMerged.map((i, idx) => getStagedItemKey(i, idx))
          if (
            prevKeys.length !== nextKeys.length ||
            prevKeys.some((k, idx) => k !== nextKeys[idx])
          ) {
            changed = true
          }
          draft.items = scopedMerged
          if (resetPublishedStatusIfUnpublishedItemsPresent(draft, activeHistory)) {
            changed = true
          }
        }

        if (changed) {
          await saveStagedLeafletDraft(jobDir, draft, { skipHistorySync: true })
        }
      } catch {
        // Keep loadStagedLeafletDraft resilient when manifest or history cannot be read
      }
    }

    if (draft && draft.header && (!draft.header.firstPageLocalPath || !draft.header.localPreviewPages)) {
      try {
        const localPreviews = await resolveLocalLeafletPreviewPages(jobDir, {
          metadataPageNumber: draft.header.metadataPageNumber ?? null
        })
        draft.header.firstPageLocalPath = draft.header.firstPageLocalPath ?? localPreviews.firstPageLocalPath
        draft.header.lastPageLocalPath = draft.header.lastPageLocalPath ?? localPreviews.lastPageLocalPath
        draft.header.firstPageNumber = draft.header.firstPageNumber ?? localPreviews.firstPageNumber
        draft.header.lastPageNumber = draft.header.lastPageNumber ?? localPreviews.lastPageNumber
        draft.header.localPreviewPages = localPreviews.localPreviewPages
      } catch {
        // Leave existing header fields intact if local rendered pages are absent
      }
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

export function buildStagedItemsFromEligible(eligibleItems: any[], indexOffset = 0): StagedOfferItem[] {
  return eligibleItems.map((item, idx) => {
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
    const contractV2 = data.contract_v2 || {}
    const qtySemantics = contractV2.quantity_semantics || {}

    const innerPackCount =
      typeof content.pack_quantity === 'number'
        ? content.pack_quantity
        : typeof qtySemantics.inner_count === 'number'
          ? qtySemantics.inner_count
          : typeof offer.pack_quantity === 'number'
            ? offer.pack_quantity
            : typeof original.pack_quantity === 'number'
              ? original.pack_quantity
              : null

    const eachSizeValue =
      typeof content.each_size_value === 'number'
        ? content.each_size_value
        : typeof qtySemantics.per_inner_content?.value === 'number'
          ? qtySemantics.per_inner_content.value
          : null

    const eachSizeUnit =
      content.each_size_unit ||
      qtySemantics.per_inner_content?.unit ||
      null

    const totalContentValue =
      typeof content.total_content_value === 'number'
        ? content.total_content_value
        : typeof qtySemantics.total_content?.value === 'number'
          ? qtySemantics.total_content.value
          : null

    const totalContentUnit =
      content.total_content_unit ||
      qtySemantics.total_content?.unit ||
      null

    const rawSpecial = promo.special_offer || offer.special_offer || original.special_offer || ''
    const freeUnitsText =
      /free|مجانا|مجاني|\+\s*\d+/i.test(rawSpecial) ? rawSpecial : null

    const customerLimit =
      promo.quantity_limit != null
        ? String(promo.quantity_limit)
        : offer.quantity_limit != null
          ? String(offer.quantity_limit)
          : original.quantity_limit != null
            ? String(original.quantity_limit)
            : null

    const saleUnitType =
      qtySemantics.sale_unit ||
      promo.unit_type ||
      offer.unit_type ||
      original.unit_type ||
      'each'

    const rawSize = content.size_text || offer.size_or_weight || original.size_or_weight || null
    let sizeOrWeight = rawSize
    if (innerPackCount && innerPackCount > 1) {
      const alreadyHasCount = rawSize && new RegExp(`(^|\\s|x|×)(${innerPackCount})($|\\s|x|×|حبات|قطع|علب|أكياس|كيس|حبة)`, 'i').test(rawSize)
      if (!alreadyHasCount) {
        if (rawSize) {
          sizeOrWeight = `${innerPackCount} × ${rawSize}`
        } else if (eachSizeValue != null && eachSizeUnit) {
          sizeOrWeight = `${innerPackCount} × ${eachSizeValue} ${eachSizeUnit}`
        } else {
          sizeOrWeight = `${innerPackCount} units`
        }
      }
    }

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

    const fallbackOfferId =
      typeof item.pageNumber === 'number' && item.itemNumber != null
        ? `offer-p${String(item.pageNumber).padStart(3, '0')}-${String(item.itemNumber)}`
        : `offer-${indexOffset + idx + 1}`
    const offerId =
      source.external_image_id ||
      source.row_id ||
      data.id ||
      data.record_metadata?.source_offer_id ||
      fallbackOfferId

    const resolvedProductThumbPath =
      item.thumbnailPath ||
      source.thumbnail_path ||
      data.image?.thumbnail_path ||
      (item.cropPath ? path.join(path.dirname(item.cropPath), 'product_thumb_crop.webp') : null)

    const hasValidThumb =
      resolvedProductThumbPath && fs.existsSync(resolvedProductThumbPath)
        ? resolvedProductThumbPath
        : null

    const initialImageSource: 'existing_db' | 'candidate' | 'product_thumb' | 'none' =
      hasValidThumb ? 'product_thumb' : 'none'

    return {
      id: offerId,
      sourceOfferId: offerId,
      pageNumber: item.pageNumber,
      croppedEvidenceLocalPath: item.cropPath,
      productThumbLocalPath: hasValidThumb || resolvedProductThumbPath || null,
      selectedImageSource: initialImageSource,
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
        promoNotes,
        inner_pack_count: innerPackCount,
        each_size_value: eachSizeValue,
        each_size_unit: eachSizeUnit,
        total_content_value: totalContentValue,
        total_content_unit: totalContentUnit,
        free_units_text: freeUnitsText,
        customer_limit: customerLimit,
        sale_unit_type: saleUnitType,
        productThumbLocalPath: hasValidThumb || resolvedProductThumbPath || null
      },
      titleEn,
      titleAr,
      brand,
      sizeOrWeight,
      priceBefore,
      priceAfter,
      discountPercent,
      promoNotes,
      inner_pack_count: innerPackCount,
      each_size_value: eachSizeValue,
      each_size_unit: eachSizeUnit,
      total_content_value: totalContentValue,
      total_content_unit: totalContentUnit,
      free_units_text: freeUnitsText,
      customer_limit: customerLimit,
      sale_unit_type: saleUnitType
    }
  })
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
    locationScope?: 'national' | 'region' | 'city' | null
    cityId?: string | null
    regionId?: string | null
    locationSlug?: string | null
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

  const isSpecificScope = manifest?.processing_selection?.selectionMode === 'specific'
  const suppressFilenameGuesses =
    isSpecificScope || (manifest?.location != null && manifest.location.location_scope === null)
  const selectedScopeSet = resolveSelectedScopeSetFromManifest(manifest)
  const resolvedRealFingerprint = tryResolveRealPdfFingerprint(
    jobDir,
    manifest,
    options?.leafletHash,
    options?.pdfFilePath
  )

  const existing = await loadStagedLeafletDraft(jobDir, { skipAutoInit: true })
  if (existing) {
    let existingModified = false

    if (
      resolvedRealFingerprint &&
      (!existing.leafletHash || isInvalidFingerprintPlaceholder(existing.leafletHash))
    ) {
      existing.leafletHash = resolvedRealFingerprint
      existingModified = true
    }

    // WIFRAN-EXTRACTOR-IMPORT-PAGES-001-R2: Non-destructive partial staging!
    // Archive all existing items into staged-draft-history.json BEFORE filtering or merging,
    // so previously reviewed/approved work from unselected pages is never lost when narrowing
    // or switching scopes and is cleanly recovered when reopening the full workspace.
    let activeHistory = await loadStagedDraftHistory(jobDir)
    if (Array.isArray(existing.items) && existing.items.length > 0) {
      activeHistory = await upsertItemsIntoStagedDraftHistory(jobDir, existing.items)
    }

    if (Array.isArray(existing.items) && (selectedScopeSet !== null || activeHistory !== null)) {
      const prevKeys = existing.items.map((item, idx) => getStagedItemKey(item, idx))
      const { items: scopedMerged } = mergeScopedItemsFromHistory(existing.items, activeHistory, selectedScopeSet)
      const nextKeys = scopedMerged.map((item, idx) => getStagedItemKey(item, idx))
      if (
        prevKeys.length !== nextKeys.length ||
        prevKeys.some((k, idx) => k !== nextKeys[idx])
      ) {
        existing.items = scopedMerged
        existingModified = true
      }
      if (resetPublishedStatusIfUnpublishedItemsPresent(existing, activeHistory)) {
        existingModified = true
      }
    }

    if (selectedScopeSet !== null || manifest) {
      try {
        const scopedEligible = await getDbEligibleItemsFromPackage(jobDir)
        if (scopedEligible.length > 0) {
          const freshStagedItems = buildStagedItemsFromEligible(scopedEligible, 0)
          const freshMap = new Map<string, StagedOfferItem>()
          for (const cand of freshStagedItems) {
            if (cand.sourceOfferId) freshMap.set(cand.sourceOfferId, cand)
            if (cand.id) freshMap.set(cand.id, cand)
            if (cand.croppedEvidenceLocalPath) freshMap.set(cand.croppedEvidenceLocalPath, cand)
          }

          // Backfill/reconcile quantity fields and composite size for existing items
          for (const existingItem of existing.items) {
            const fresh =
              freshMap.get(existingItem.sourceOfferId || '') ||
              freshMap.get(existingItem.id || '') ||
              freshMap.get(existingItem.croppedEvidenceLocalPath || '')
            if (fresh) {
              if (existingItem.inner_pack_count === undefined || existingItem.total_content_value === undefined) {
                existingItem.inner_pack_count = fresh.inner_pack_count
                existingItem.each_size_value = fresh.each_size_value
                existingItem.each_size_unit = fresh.each_size_unit
                existingItem.total_content_value = fresh.total_content_value
                existingItem.total_content_unit = fresh.total_content_unit
                existingItem.free_units_text = fresh.free_units_text
                existingItem.customer_limit = fresh.customer_limit
                existingItem.sale_unit_type = fresh.sale_unit_type
                existingModified = true
              }
              const isOperatorEditedSize =
                Array.isArray(existingItem.operatorEditedFields) &&
                existingItem.operatorEditedFields.includes('sizeOrWeight')
              if (!isOperatorEditedSize && fresh.sizeOrWeight && existingItem.sizeOrWeight !== fresh.sizeOrWeight) {
                existingItem.sizeOrWeight = fresh.sizeOrWeight
                if (existingItem.originalOcr) {
                  existingItem.originalOcr.sizeOrWeight = fresh.sizeOrWeight
                  existingItem.originalOcr.inner_pack_count = fresh.inner_pack_count
                  existingItem.originalOcr.total_content_value = fresh.total_content_value
                }
                existingModified = true
              }

              // Backfill local product thumbnail crop references
              if (!existingItem.productThumbLocalPath && fresh.productThumbLocalPath) {
                existingItem.productThumbLocalPath = fresh.productThumbLocalPath
                if (existingItem.originalOcr) {
                  existingItem.originalOcr.productThumbLocalPath = fresh.productThumbLocalPath
                }
                existingModified = true
              }
              if (
                (!existingItem.selectedImageSource || existingItem.selectedImageSource === 'none') &&
                (existingItem.productThumbLocalPath || fresh.productThumbLocalPath)
              ) {
                existingItem.selectedImageSource = 'product_thumb'
                existingModified = true
              }
            } else if (!existingItem.productThumbLocalPath && existingItem.croppedEvidenceLocalPath) {
              const sibling = path.join(path.dirname(existingItem.croppedEvidenceLocalPath), 'product_thumb_crop.webp')
              if (fs.existsSync(sibling)) {
                existingItem.productThumbLocalPath = sibling
                if (existingItem.originalOcr) {
                  existingItem.originalOcr.productThumbLocalPath = sibling
                }
                if (!existingItem.selectedImageSource || existingItem.selectedImageSource === 'none') {
                  existingItem.selectedImageSource = 'product_thumb'
                }
                existingModified = true
              }
            }
          }

          const existingIds = new Set(
            existing.items.flatMap((it) => [it.sourceOfferId, it.id, it.croppedEvidenceLocalPath].filter(Boolean) as string[])
          )
          const candidates = freshStagedItems.filter((cand) => {
            const cId = cand.sourceOfferId || cand.id
            return !existingIds.has(cId) && (!cand.croppedEvidenceLocalPath || !existingIds.has(cand.croppedEvidenceLocalPath))
          })
          if (candidates.length > 0) {
            try {
              await preMatchLocalOffersAgainstDb(candidates, { supabaseClient: options?.supabaseClient })
            } catch (err) {
              console.warn('Pre-match against DB failed or offline:', err)
            }
            existing.items.push(...candidates)
            if (existing.status === 'published') {
              existing.status = 'draft'
            }
            existingModified = true
          }
        }
      } catch {
        // ignore eligible merge errors on partial draft refresh
      }
    }

    if (options?.locationScope !== undefined && options.locationScope !== existing.header?.locationScope) {
      existing.header.locationScope = options.locationScope
      existingModified = true
    }
    if (options?.cityId !== undefined && options.cityId !== existing.header?.cityId) {
      existing.header.cityId = options.cityId
      existingModified = true
    }
    if (options?.regionId !== undefined && options.regionId !== existing.header?.regionId) {
      existing.header.regionId = options.regionId
      existingModified = true
    }
    if (options?.locationSlug !== undefined && options.locationSlug !== existing.header?.locationSlug) {
      existing.header.locationSlug = options.locationSlug
      existingModified = true
    }

    if (options?.metadataPageNumber !== undefined && options?.metadataPageNumber !== existing.header?.metadataPageNumber) {
      existing.header.metadataPageNumber = options.metadataPageNumber
      existingModified = true
      try {
        const localPreviews = await resolveLocalLeafletPreviewPages(jobDir, {
          metadataPageNumber: options.metadataPageNumber
        })
        existing.header.firstPageLocalPath = localPreviews.firstPageLocalPath
        existing.header.lastPageLocalPath = localPreviews.lastPageLocalPath
        existing.header.firstPageNumber = localPreviews.firstPageNumber
        existing.header.lastPageNumber = localPreviews.lastPageNumber
        existing.header.localPreviewPages = localPreviews.localPreviewPages
      } catch (err) {
        console.warn('Local boundary preview resolution failed:', err)
      }
    } else if (!existing.header?.firstPageLocalPath || !existing.header?.localPreviewPages) {
      try {
        const localPreviews = await resolveLocalLeafletPreviewPages(jobDir, {
          metadataPageNumber: existing.header?.metadataPageNumber ?? null
        })
        existing.header.firstPageLocalPath = existing.header.firstPageLocalPath ?? localPreviews.firstPageLocalPath
        existing.header.lastPageLocalPath = existing.header.lastPageLocalPath ?? localPreviews.lastPageLocalPath
        existing.header.firstPageNumber = existing.header.firstPageNumber ?? localPreviews.firstPageNumber
        existing.header.lastPageNumber = existing.header.lastPageNumber ?? localPreviews.lastPageNumber
        existing.header.localPreviewPages = localPreviews.localPreviewPages
        existingModified = true
      } catch {
        // Ignore when rendered pages are absent
      }
    }

    const canResolveFilenameOnExisting =
      !suppressFilenameGuesses &&
      Boolean(candidatePdfName) &&
      (Boolean(options?.supabaseClient) || !isOfflineUatMode())

    if (canResolveFilenameOnExisting && candidatePdfName && (!existing.header.supermarketId || !existing.header.region)) {
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
      if (!existing.header.region && !options?.locationScope && parsed.rawRegionName) {
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

  const hasExplicitSupermarket = Boolean(options?.supermarketId || manifest?.supermarket?.id)
  const hasExplicitRegionOrScope = Boolean(
    options?.region !== undefined ||
    options?.locationScope ||
    manifest?.location?.location_scope ||
    manifest?.location?.display_name
  )
  const canResolveFilenameOnNew =
    !suppressFilenameGuesses &&
    Boolean(candidatePdfName) &&
    (Boolean(options?.supabaseClient) || !isOfflineUatMode())

  if (canResolveFilenameOnNew && candidatePdfName && (!hasExplicitSupermarket || !hasExplicitRegionOrScope)) {
    const parsed = parseLeafletFilenameMetadata(candidatePdfName)
    if (!hasExplicitSupermarket && parsed.rawSupermarketName) {
      try {
        const resolvedSm = await resolveOrCreateSupermarket(parsed.rawSupermarketName, {
          supabaseClient: options?.supabaseClient
        })
        filenameSupermarketId = resolvedSm.id
      } catch (err) {
        console.warn(`Failed to resolve supermarket from filename '${parsed.rawSupermarketName}':`, err)
      }
    }
    if (!hasExplicitRegionOrScope && parsed.rawRegionName) {
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
  const region =
    options?.region !== undefined
      ? (options.region || null)
      : (filenameRegion ?? manifest?.location?.display_name ?? manifest?.location?.location_slug ?? null)
  const locationScope = options?.locationScope ?? manifest?.location?.location_scope ?? null
  const cityId = options?.cityId ?? manifest?.location?.city_id ?? null
  const regionId = options?.regionId ?? manifest?.location?.region_id ?? null
  const locationSlug = options?.locationSlug ?? manifest?.location?.location_slug ?? null
  const validFrom = options?.validFrom ?? manifest?.offer_dates?.valid_from ?? null
  const validTo = options?.validTo ?? manifest?.offer_dates?.valid_to ?? null
  const leafletHash =
    resolvedRealFingerprint ??
    (options?.leafletHash && !isInvalidFingerprintPlaceholder(options.leafletHash)
      ? options.leafletHash
      : undefined) ??
    manifest?.leaflet_filename_metadata?.source_file_name ??
    candidatePdfName ??
    path.basename(jobDir)

  let eligibleItems: any[] = []
  try {
    eligibleItems = await getDbEligibleItemsFromPackage(jobDir)
  } catch {
    eligibleItems = []
  }

  // Temporary public leaflet page uploads were retired in WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001;
  // resolve local rendered pages only for operator UI preview.
  const firstPagePublicUrl: string | null = null
  const lastPagePublicUrl: string | null = null
  const firstPageTmpPath: string | null = null
  const lastPageTmpPath: string | null = null
  let firstPageLocalPath: string | null = null
  let lastPageLocalPath: string | null = null
  let firstPageNumber: number | null = null
  let lastPageNumber: number | null = null
  let localPreviewPages: Array<{ pageNumber: number; imagePath: string }> = []
  try {
    const localPreviews = await resolveLocalLeafletPreviewPages(jobDir, {
      metadataPageNumber: options?.metadataPageNumber
    })
    firstPageLocalPath = localPreviews.firstPageLocalPath
    lastPageLocalPath = localPreviews.lastPageLocalPath
    firstPageNumber = localPreviews.firstPageNumber
    lastPageNumber = localPreviews.lastPageNumber
    localPreviewPages = localPreviews.localPreviewPages
  } catch (err) {
    console.warn('Local boundary preview resolution skipped or failed:', err)
  }

  const builtItems: StagedOfferItem[] = buildStagedItemsFromEligible(eligibleItems)

  // Pre-match net-new items against DB (read-only), preserving any previously archived reviewed items
  const existingHistory = await loadStagedDraftHistory(jobDir)
  let stagedItems: StagedOfferItem[] = builtItems
  if (existingHistory) {
    const mergedFromHistory = mergeScopedItemsFromHistory([], existingHistory, selectedScopeSet).items
    const archivedKeySet = new Set(mergedFromHistory.map((it, idx) => getStagedItemKey(it, idx)))
    const netNewItems = builtItems.filter((cand, idx) => !archivedKeySet.has(getStagedItemKey(cand, idx)))
    if (netNewItems.length > 0) {
      try {
        await preMatchLocalOffersAgainstDb(netNewItems, { supabaseClient: options?.supabaseClient })
      } catch (err) {
        console.warn('Pre-match against DB failed or offline:', err)
      }
    }
    stagedItems = [...mergedFromHistory, ...netNewItems]
  } else if (stagedItems.length > 0) {
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
      locationScope,
      cityId,
      regionId,
      locationSlug,
      validFrom,
      validTo,
      firstPagePublicUrl,
      lastPagePublicUrl,
      firstPageTmpPath,
      lastPageTmpPath,
      firstPageLocalPath,
      lastPageLocalPath,
      firstPageNumber,
      lastPageNumber,
      localPreviewPages,
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
 * Persists the staged-draft.json file into the job workspace directory,
 * non-destructively archiving active items into staged-draft-history.json.
 */
export async function saveStagedLeafletDraft(
  jobDir: string,
  draft: StagedLeafletDraft,
  options?: { skipHistorySync?: boolean }
): Promise<void> {
  const draftPath = path.join(jobDir, 'staged-draft.json')
  draft.updatedAt = new Date().toISOString()
  await fs.promises.mkdir(jobDir, { recursive: true })
  await fs.promises.writeFile(draftPath, JSON.stringify(draft, null, 2), 'utf8')
  if (!options?.skipHistorySync && Array.isArray(draft.items) && draft.items.length > 0) {
    await upsertItemsIntoStagedDraftHistory(jobDir, draft.items)
  }
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

export interface LocalLeafletPreviewPagesResult {
  firstPageLocalPath: string
  lastPageLocalPath: string | null
  firstPageNumber: number
  lastPageNumber: number | null
  localPreviewPages: Array<{ pageNumber: number; imagePath: string }>
}

function extractPageNumberFromPath(filePath: string): number | null {
  const base = path.basename(filePath)
  const match = base.match(/(?:page[-._]?)(\d+)/i) || base.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Resolves local rendered leaflet page images for operator preview in the Staging UI
 * without performing any remote storage upload. Respects selected-page scope fail-closed.
 */
export async function resolveLocalLeafletPreviewPages(
  jobDir: string,
  options?: { pageFiles?: string[]; metadataPageNumber?: number | null }
): Promise<LocalLeafletPreviewPagesResult> {
  const pageFiles = options?.pageFiles
  let targetPages: string[] = []

  if (pageFiles && pageFiles.length > 0) {
    targetPages = [...pageFiles]
  } else {
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

  let specificScopePages: number[] | null = null
  try {
    const manifest = await loadExtractionManifest(jobDir)
    const sel = manifest?.processing_selection
    if (sel?.selectionMode === 'specific' && Array.isArray(sel.selectedPages) && sel.selectedPages.length > 0) {
      specificScopePages = sel.selectedPages
    }
  } catch {
    // ignore manifest load error
  }

  if (specificScopePages) {
    const selSet = new Set(specificScopePages)
    targetPages = targetPages.filter((p) => {
      const pageNum = extractPageNumberFromPath(p)
      return pageNum != null ? selSet.has(pageNum) : false
    })
    if (targetPages.length === 0) {
      throw new Error(
        `No rendered page images found within selected pages scope [${specificScopePages.join(', ')}] in job directory: ${jobDir}`
      )
    }
  }

  const sortedPages = sortPageFilePaths(targetPages)
  const localPreviewPages = sortedPages.map((imgPath, idx) => ({
    pageNumber: extractPageNumberFromPath(imgPath) ?? idx + 1,
    imagePath: imgPath
  }))

  if (options?.metadataPageNumber != null) {
    const k = Number(options.metadataPageNumber)
    if (specificScopePages && !specificScopePages.includes(k)) {
      throw new Error(
        `Requested metadataPageNumber ${k} is outside selected pages scope [${specificScopePages.join(', ')}].`
      )
    }

    let matchedEntry = localPreviewPages.find((p) => p.pageNumber === k)
    if (!matchedEntry) {
      const clampedIdx = Math.max(0, Math.min(localPreviewPages.length - 1, k - 1))
      matchedEntry = localPreviewPages[clampedIdx]
    }

    return {
      firstPageLocalPath: matchedEntry.imagePath,
      lastPageLocalPath: null,
      firstPageNumber: matchedEntry.pageNumber,
      lastPageNumber: null,
      localPreviewPages
    }
  }

  const firstEntry = localPreviewPages[0]
  const lastEntry = localPreviewPages[localPreviewPages.length - 1]

  return {
    firstPageLocalPath: firstEntry.imagePath,
    lastPageLocalPath: lastEntry.imagePath,
    firstPageNumber: firstEntry.pageNumber,
    lastPageNumber: lastEntry.pageNumber,
    localPreviewPages
  }
}

/**
 * Legacy helper retained for backward-compatible imports.
 * Public Supabase 'tmp' boundary uploads have been retired (WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001):
 * metadata is discovered and confirmed in Stage 2 before sourcing, and operator previews load local files.
 * Zero remote storage uploads are performed; returns null public/tmp URLs and resolved local preview paths.
 */
export async function uploadLeafletBoundaryPagesForMetadata(
  jobDir: string,
  leafletHash: string,
  pageFilesOrOptions?: string[] | UploadLeafletBoundaryPagesOptions,
  options?: UploadLeafletBoundaryPagesOptions
): Promise<{
  firstPagePublicUrl: string | null
  lastPagePublicUrl: string | null
  firstPageTmpPath: string | null
  lastPageTmpPath: string | null
  firstPageLocalPath: string
  lastPageLocalPath: string | null
  firstPageNumber: number
  lastPageNumber: number | null
  localPreviewPages: Array<{ pageNumber: number; imagePath: string }>
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

  const resolved = await resolveLocalLeafletPreviewPages(jobDir, {
    pageFiles,
    metadataPageNumber: opts?.metadataPageNumber
  })

  let draft = await loadStagedLeafletDraft(jobDir, { skipAutoInit: true })
  const normalizedMetaPage = opts?.metadataPageNumber != null ? Number(opts.metadataPageNumber) : null

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
        firstPagePublicUrl: null,
        lastPagePublicUrl: null,
        firstPageTmpPath: null,
        lastPageTmpPath: null,
        firstPageLocalPath: resolved.firstPageLocalPath,
        lastPageLocalPath: resolved.lastPageLocalPath,
        firstPageNumber: resolved.firstPageNumber,
        lastPageNumber: resolved.lastPageNumber,
        localPreviewPages: resolved.localPreviewPages,
        metadataPageNumber: normalizedMetaPage,
        headerModifiedByOperator: false
      },
      items: []
    }
  } else {
    draft.header.firstPagePublicUrl = null
    draft.header.lastPagePublicUrl = null
    draft.header.firstPageTmpPath = null
    draft.header.lastPageTmpPath = null
    draft.header.firstPageLocalPath = resolved.firstPageLocalPath
    draft.header.lastPageLocalPath = resolved.lastPageLocalPath
    draft.header.firstPageNumber = resolved.firstPageNumber
    draft.header.lastPageNumber = resolved.lastPageNumber
    draft.header.localPreviewPages = resolved.localPreviewPages
    draft.header.metadataPageNumber = normalizedMetaPage
    if (!draft.leafletHash) draft.leafletHash = leafletHash
  }

  await saveStagedLeafletDraft(jobDir, draft)

  return {
    firstPagePublicUrl: null,
    lastPagePublicUrl: null,
    firstPageTmpPath: null,
    lastPageTmpPath: null,
    firstPageLocalPath: resolved.firstPageLocalPath,
    lastPageLocalPath: resolved.lastPageLocalPath,
    firstPageNumber: resolved.firstPageNumber,
    lastPageNumber: resolved.lastPageNumber,
    localPreviewPages: resolved.localPreviewPages
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

function preserveOrAssignShortOfferRef(
  rep: StagedOfferItem,
  refMap: OfferImageRefMap
): { shortRef: string; modified: boolean } {
  const normalizedUuid = rep.id.trim().toLowerCase()
  const existingRef = (rep.imageRef || '').trim()
  const shortMatch = existingRef.match(/^O([1-9]\d*)$/i)

  if (shortMatch) {
    const canonicalShort = `O${shortMatch[1]}`
    const mappedUuid = refMap.shortToUuid[canonicalShort]?.toLowerCase()
    if (!mappedUuid || mappedUuid === normalizedUuid) {
      let modified = false
      if (mappedUuid !== normalizedUuid || refMap.uuidToShort[normalizedUuid] !== canonicalShort) {
        refMap.shortToUuid[canonicalShort] = normalizedUuid
        refMap.uuidToShort[normalizedUuid] = canonicalShort
        const seqNum = parseInt(shortMatch[1], 10)
        if (refMap.nextSeq <= seqNum) {
          refMap.nextSeq = seqNum + 1
        }
        modified = true
      }
      return { shortRef: canonicalShort, modified }
    }
  }

  const existingMappedShort = refMap.uuidToShort[normalizedUuid]
  if (existingMappedShort && /^O([1-9]\d*)$/i.test(existingMappedShort)) {
    return { shortRef: existingMappedShort, modified: false }
  }

  return {
    shortRef: assignShortOfferRef(rep.id, refMap),
    modified: true
  }
}

/**
 * Exports a strictly 2-column Step 1 product/offer image-sourcing CSV
 * (Image_Ref,Item_Name)
 * containing only net-new/un-imaged P<id> and preserved short O<n> references,
 * consolidating visual subjects in the same leaflet under a single representative.
 * Emits zero FPTSP/LPTSP boundary rows and zero leaflet metadata rows.
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
  const hasEvaluated = draft.items.some(
    (i) =>
      (i.selectedImageSource && i.selectedImageSource !== 'none') ||
      Boolean(i.imageRef && /^(P[1-9]\d*|O[1-9]\d*)$/i.test(i.imageRef.trim())) ||
      i.status === 'ready' ||
      i.status === 'skipped'
  )
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
        title_en: item.titleEn || item.originalOcr?.titleEn,
        title_ar: item.titleAr || item.originalOcr?.titleAr
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
    const canonicalPRef = `P${pId}`
    item.imageRef = canonicalPRef
    const row: ExportStagedLeafletRow = {
      imageRef: canonicalPRef,
      titleEn: item.titleEn || item.originalOcr?.titleEn || '',
      titleAr: item.titleAr || item.originalOcr?.titleAr || '',
      brand: item.brand || item.originalOcr?.brand || '',
      sizeOrWeight: item.sizeOrWeight || item.originalOcr?.sizeOrWeight || '',
      imageUrl: ''
    }
    pRows.push(row)
  }

  // Build representative O rows, preserving existing O<n> references without renumbering
  for (const [, rawMembers] of oGroups.entries()) {
    const existingRepIdx = rawMembers.findIndex((m) => m.isRepresentative === true)
    const members =
      existingRepIdx > 0
        ? [rawMembers[existingRepIdx], ...rawMembers.slice(0, existingRepIdx), ...rawMembers.slice(existingRepIdx + 1)]
        : rawMembers

    const rep = members[0]
    const refResolution = preserveOrAssignShortOfferRef(rep, refMap)
    const shortRef = refResolution.shortRef
    if (refResolution.modified) {
      mapModified = true
    }

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
      titleEn: rep.titleEn || rep.originalOcr?.titleEn || '',
      titleAr: rep.titleAr || rep.originalOcr?.titleAr || '',
      brand: rep.brand || rep.originalOcr?.brand || '',
      sizeOrWeight: rep.sizeOrWeight || rep.originalOcr?.sizeOrWeight || '',
      imageUrl: ''
    }
    oRows.push(row)
  }

  // Sort O rows by numeric short ID index (e.g. O1, O2, O51)
  oRows.sort((a, b) => {
    const numA = parseInt(a.imageRef.replace(/^O/i, ''), 10) || 0
    const numB = parseInt(b.imageRef.replace(/^O/i, ''), 10) || 0
    return numA - numB
  })

  if (mapModified) {
    await saveOfferRefMap(refMap, options?.mapFilePath)
  }

  // Assemble strictly 2-column CSV: Image_Ref,Item_Name (products and offers only)
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

  // Prepend UTF-8 BOM (\uFEFF) with zero boundary-page or metadata rows
  const csvContent = '\uFEFF' + [headerLine, ...dataLines].join('\r\n')

  draft.step1ExportedAt = new Date().toISOString()

  // Save updated draft to disk
  await saveStagedLeafletDraft(jobDir, draft)

  return {
    csvContent,
    exportableCount: allDataRows.length,
    skippedAlreadyImagedCount,
    pCount: pRows.length,
    oCount: oRows.length,
    metadataRowsCount: 0,
    rows: allDataRows,
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

const LEGACY_SOURCING_PAGE_REFS = new Set(['FPTSP', 'LPTSP', 'M_PAGE_FIRST', 'M_PAGE_LAST'])
const LEGACY_SOURCING_METADATA_REFS = new Set([
  'SMN',
  'REG',
  'SD',
  'ED',
  'M_SUPERMARKET_ID',
  'M_REGION',
  'M_VALID_FROM',
  'M_VALID_TO'
])

/**
 * Parses and ingests the CSV returned from Step 2 into the local staged-draft.json,
 * supporting strictly 2-column format (Image_Ref,image_url) with optional
 * "Corrected_Item_Name|https_image_url" syntax as well as legacy 6-column CSVs.
 *
 * WIFRAN-EXTRACTOR-IMAGE-SOURCING-CSV-001:
 * - Stage 2 LeafletMetadataService + confirmed_metadata.json own leaflet metadata.
 * - Legacy FPTSP/LPTSP/SD/ED/SMN/REG/M_* rows are ignored safely without error,
 *   without treating values as image URLs, and without overwriting draft.header.
 * - Rejects unknown, duplicate, conflicting P/O refs and invalid/non-HTTPS URLs.
 * - Does not perform automatic remote deletion of historical 'tmp' objects.
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
    ignoredLegacyRowsCount: 0,
    errors: [],
    draft
  }

  const parsedLines = parseSimpleCsv(csvContent)
  if (parsedLines.length < 2) {
    result.errors.push('CSV has no data rows.')
    return result
  }

  const header = parsedLines[0].map((h) => h.toLowerCase().trim())
  const foundRefIdx = header.findIndex((h) => h === 'image_ref' || h === 'product_id' || h === 'ref')
  const foundUrlIdx = header.findIndex((h) => h === 'image_url' || h === 'imageurl' || h === 'url')

  if (foundRefIdx === -1 || (foundUrlIdx === -1 && header[1] !== 'item_name')) {
    result.errors.push(
      `Invalid CSV header. Expected 'Image_Ref,image_url' (or 'Image_Ref,Title_EN,Title_AR,Brand,Size_Or_Weight,image_url'). Found: '${parsedLines[0].join(',')}'`
    )
    return result
  }

  const isStrict2Col =
    header.length === 2 ||
    (header[0] === 'image_ref' && (header[1] === 'image_url' || header[1] === 'item_name' || header[1] === 'url'))

  const refIdx = foundRefIdx
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
  const urlIdx = foundUrlIdx !== -1 ? foundUrlIdx : isStrict2Col ? 1 : parsedLines[0].length - 1

  const refMap = await loadOfferRefMap(options?.mapFilePath)
  const supabase = options?.supabaseClient || getSupabaseAdminClient()

  // In-memory cache for downloaded candidates across this batch
  const batchCache = new Map<string, { buffer: Buffer; sha256: string; ext: string; localPath: string }>()
  const imagesDir = path.join(jobDir, 'staged-candidate-images')
  await fs.promises.mkdir(imagesDir, { recursive: true })

  const legacyIgnoredWarnings: string[] = []
  const seenImageRefs = new Map<string, string>() // UPPER ref -> rawUrl
  const seenTargetItemIds = new Map<string, string>() // item.id -> first ref

  const dataRows = parsedLines.slice(1)
  let rowIndex = 0

  for (const row of dataRows) {
    rowIndex++
    const ref = (row[refIdx] || '').trim()
    if (!ref) continue
    result.totalRows++

    const upperRef = ref.toUpperCase()

    // 1. Cleanly ignore legacy boundary & metadata rows without altering Stage 2 metadata or failing import
    if (
      LEGACY_SOURCING_PAGE_REFS.has(upperRef) ||
      LEGACY_SOURCING_METADATA_REFS.has(upperRef) ||
      upperRef.startsWith('M_')
    ) {
      result.ignoredLegacyRowsCount = (result.ignoredLegacyRowsCount || 0) + 1
      legacyIgnoredWarnings.push(
        `Row ${rowIndex}: Legacy metadata/boundary row '${ref}' was ignored (leaflet metadata is confirmed in Stage 2).`
      )
      continue
    }

    // Extract rawUrl early to report URL conflicts cleanly
    let rawColVal = urlIdx !== -1 && urlIdx < row.length ? (row[urlIdx] || '').trim() : ''
    let rawUrl = rawColVal
    let pipeTitleEn: string | undefined = undefined
    let pipeTitleAr: string | undefined = undefined

    if (rawColVal && rawColVal.includes('|')) {
      const parts = rawColVal.split('|').map((p) => p.trim())
      const urlIdxInPipe = parts.findIndex((p) => /^(?:https?:\/\/|ftp:\/\/|javascript:|data:|mailto:)/i.test(p))
      if (urlIdxInPipe !== -1) {
        rawUrl = parts[urlIdxInPipe]
        const textParts = parts.filter((_, idx) => idx !== urlIdxInPipe)
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
      } else if (parts[parts.length - 1] === '' && parts.length >= 2) {
        // Handle "Corrected Product Name|" with empty URL
        rawUrl = ''
        const textParts = parts.slice(0, -1).filter(Boolean)
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

    // Reject duplicate Image_Ref rows in CSV (case-insensitive)
    if (seenImageRefs.has(upperRef)) {
      const prevUrl = seenImageRefs.get(upperRef)!
      if (prevUrl !== rawUrl) {
        result.errors.push(
          `Row ${rowIndex}: Conflicting duplicate image reference '${ref}' (conflicts with previous URL '${prevUrl || '<blank>'}').`
        )
      } else {
        result.errors.push(`Row ${rowIndex}: Duplicate image reference '${ref}' in CSV.`)
      }
      continue
    }

    // 2. Match Offer / Product strictly by original P<id> or O<n>/O<uuid> reference
    const pMatch = upperRef.match(/^P([1-9]\d*)$/)
    const oShortMatch = upperRef.match(/^O([1-9]\d*)$/)
    const oUuidMatch = upperRef.match(/^O([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/)

    if (!pMatch && !oShortMatch && !oUuidMatch) {
      result.errors.push(`Row ${rowIndex}: Unsupported or invalid image reference '${ref}'. Expected P<id> or O<n>.`)
      continue
    }

    const matchedItems: StagedOfferItem[] = []

    if (pMatch) {
      const pId = parseInt(pMatch[1], 10)
      for (const item of draft.items) {
        if (item.matchedProductId === pId || (item.imageRef && item.imageRef.toUpperCase() === upperRef)) {
          matchedItems.push(item)
        }
      }
    } else {
      const resolvedUuid =
        refMap.shortToUuid[upperRef]?.toLowerCase() ||
        (oUuidMatch ? oUuidMatch[1].toLowerCase() : null)

      for (const item of draft.items) {
        if (
          (item.imageRef && item.imageRef.toUpperCase() === upperRef) ||
          (resolvedUuid && item.id.toLowerCase() === resolvedUuid) ||
          (resolvedUuid && item.representativeOfferId?.toLowerCase() === resolvedUuid)
        ) {
          matchedItems.push(item)
        }
      }
    }

    if (matchedItems.length === 0) {
      result.errors.push(`Row ${rowIndex}: Unknown or unmatched image reference '${ref}'.`)
      continue
    }

    // Reject conflicting references pointing to the same staged offer item(s)
    const conflictingItem = matchedItems.find((item) => seenTargetItemIds.has(item.id))
    if (conflictingItem) {
      const firstRef = seenTargetItemIds.get(conflictingItem.id)!
      result.errors.push(
        `Row ${rowIndex}: Conflicting image reference '${ref}' targets offer '${conflictingItem.id}' already referenced by '${firstRef}'.`
      )
      continue
    }

    seenImageRefs.set(upperRef, rawUrl)
    for (const item of matchedItems) {
      seenTargetItemIds.set(item.id, ref)
    }

    // Validate non-blank image URL strictly before applying item mutations
    if (rawUrl) {
      let parsedUrl: URL | null = null
      try {
        parsedUrl = new URL(rawUrl)
      } catch {
        parsedUrl = null
      }
      if (!parsedUrl) {
        const msg = `Row ${rowIndex}: Invalid image URL format for '${ref}': '${rawUrl}'.`
        result.errors.push(msg)
        result.candidateImagesFailedCount++
        for (const item of matchedItems) {
          item.candidateDownloadError = msg
        }
        continue
      }
      if (parsedUrl.protocol !== 'https:') {
        const msg = `Row ${rowIndex}: Image URL for '${ref}' must use HTTPS protocol: '${rawUrl}'.`
        result.errors.push(msg)
        result.candidateImagesFailedCount++
        for (const item of matchedItems) {
          item.candidateDownloadError = msg
        }
        continue
      }
    }

    result.matchedOffersCount += matchedItems.length

    // 3. Extract CSV text corrections (if provided)
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

    // 5. Download Candidate Image & Stage Locally (skip cleanly when blank URL)
    if (rawUrl) {
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
          assertNotOfflineUat('Remote Candidate Image Download')
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

  // 6. Check Header Metadata Completeness (Stage 2 Metadata remains authoritative; CSV never mutates it)
  const validationWarnings: string[] = [...legacyIgnoredWarnings]
  const missingFields: Array<'supermarket' | 'region' | 'validFrom' | 'validTo'> = []

  const smId = (draft.header.supermarketId || '').trim()
  if (!smId) {
    validationWarnings.push('Supermarket is missing or unselected.')
    missingFields.push('supermarket')
  }

  const reg = (draft.header.region || '').trim()
  if (!reg) {
    validationWarnings.push('Region is missing or unselected.')
    missingFields.push('region')
  }

  const vFrom = draft.header.validFrom ? normalizeIsoDateString(draft.header.validFrom) : null
  if (!vFrom) {
    validationWarnings.push('Start Date is missing or invalid.')
    missingFields.push('validFrom')
  }

  const vTo = draft.header.validTo ? normalizeIsoDateString(draft.header.validTo) : null
  if (!vTo) {
    validationWarnings.push('End Date is missing or invalid.')
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
  result.requiresOperatorMetadataConfirmation = missingFields.length > 0

  draft.step2ImportedAt = new Date().toISOString()
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
  if (headerPatch.locationScope !== undefined) draft.header.locationScope = headerPatch.locationScope
  if (headerPatch.cityId !== undefined) draft.header.cityId = headerPatch.cityId
  if (headerPatch.regionId !== undefined) draft.header.regionId = headerPatch.regionId
  if (headerPatch.locationSlug !== undefined) draft.header.locationSlug = headerPatch.locationSlug
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
    mode: 'existing_db' | 'candidate' | 'custom_local' | 'custom_url' | 'product_thumb' | 'none'
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
    assertNotOfflineUat('Remote Custom Image URL Download')
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
  } else if (replacement.mode === 'product_thumb') {
    if (!item.productThumbLocalPath) {
      throw new Error('No product thumbnail available for this offer.')
    }
    item.selectedImageSource = 'product_thumb'
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

  // 4. Authoritative Leaflet Metadata Confirmation Gate (WIFRAN-EXTRACTOR-METADATA-004: Unconditional Fail-Closed Gate)
  const { getLeafletMetadataService } = await import('../metadata/leafletMetadataService')
  const metadataService = getLeafletMetadataService()
  const readiness = metadataService.validatePublishReadiness({
    workspacePath: jobDir,
    leafletFingerprint: draft.leafletHash,
    expectedSupermarketId: header.supermarketId || undefined,
    expectedValidityFrom: header.validFrom || undefined,
    expectedValidityTo: header.validTo || undefined,
    locationScope: header.locationScope !== undefined ? header.locationScope : undefined,
    cityId: header.cityId !== undefined ? header.cityId : undefined,
    regionId: header.regionId !== undefined ? header.regionId : undefined
  })
  if (!readiness.ok) {
    result.errors.push(readiness.error || 'Leaflet metadata failed publish readiness validation.')
    return result
  }

  const supabase = options?.supabaseClient || getSupabaseAdminClient()
  const rightsBasis = options?.rightsBasis || 'operator_manual_verified'
  const reviewedBy = options?.reviewedBy || 'operator'

  let effectiveSupermarketId = header.supermarketId!
  const confirmedRetailer = readiness.confirmedRecord?.retailer
  if (confirmedRetailer?.pendingCatalogCreation === true) {
    try {
      const ensured = await ensureConfirmedSupermarketExistsInDb(
        {
          id: effectiveSupermarketId,
          slug: confirmedRetailer.resolvedSlug || null,
          name_en: confirmedRetailer.resolvedNameEn || confirmedRetailer.detectedName || null,
          name_ar: confirmedRetailer.resolvedNameAr || confirmedRetailer.detectedName || null
        },
        { supabaseClient: options?.supabaseClient }
      )
      effectiveSupermarketId = ensured.supermarketId
    } catch (smErr: any) {
      result.errors.push(smErr?.message || 'Failed to create confirmed supermarket in database on publish.')
      return result
    }
  }

  const leafletId =
    (!isInvalidFingerprintPlaceholder(draft.leafletHash) ? draft.leafletHash : null) ||
    readiness.resolvedFingerprint ||
    draft.leafletHash ||
    `${effectiveSupermarketId}-${header.region}-${header.validFrom}-${header.validTo}`
  result.leafletId = leafletId

  // 4. Upsert leaflet record
  const leafletRecord = {
    id: leafletId,
    supermarket_id: effectiveSupermarketId,
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
              supermarket_id: effectiveSupermarketId,
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

  // Check authoritative selected-page scope if present in manifest
  let selectedPublishScopeSet: Set<number> | null = null
  try {
    const manifest = await loadExtractionManifest(jobDir)
    selectedPublishScopeSet = resolveSelectedScopeSetFromManifest(manifest)
  } catch {
    // ignore
  }

  // 5. Process each staged offer item
  let currentOfferIndex = 0
  const totalOffers = draft.items.length
  const publishedOfferKeysThisRun: string[] = []
  const publishedPagesThisRun = new Set<number>()

  for (const item of draft.items) {
    currentOfferIndex++
    const itemPage = (item as any).sourcePageNumber || getStagedItemPageNumber(item) || 0

    // Do not publish or upload images for offers outside the selected pages scope
    if (selectedPublishScopeSet && (itemPage <= 0 || !selectedPublishScopeSet.has(itemPage))) {
      result.offersSkippedAlreadyPublishedCount++
      continue
    }

    // Check item-level quarantine from publishDecision or quality
    if (
      (item as any).publishDecision === 'skip_or_quarantine' ||
      (item as any).quality?.publish_decision === 'skip_or_quarantine'
    ) {
      result.offersSkippedAlreadyPublishedCount++
      continue
    }

    const matchingResolution = readiness.confirmedRecord?.resolvedExceptions?.find(r => r.pageNumber === itemPage)
    if (matchingResolution) {
      if (matchingResolution.resolution === 'quarantined') {
        const isPageWide = !matchingResolution.scope || matchingResolution.scope === 'page_wide'
        if (isPageWide) {
          result.offersSkippedAlreadyPublishedCount++
          continue
        } else if (matchingResolution.scope === 'specific_offers') {
          const itemId = String(item.id || '').toLowerCase()
          const sourceId = String(item.sourceOfferId || '').toLowerCase()
          const rawItemNum = String((item as any).sourceItemNumber || (item as any).itemNumber || '').toLowerCase()
          const isAffected = (matchingResolution.affectedOfferIds || []).some(id => {
            const clean = String(id).toLowerCase().trim()
            return clean === itemId || clean === sourceId || clean === rawItemNum || clean.endsWith(`_${rawItemNum}`) || itemId.endsWith(`_${clean}`)
          })
          if (isAffected) {
            result.offersSkippedAlreadyPublishedCount++
            continue
          }
        } else if (matchingResolution.scope === 'category') {
          const catHint = (matchingResolution.categoryHint || '').toLowerCase().trim()
          const titleEn = String(item.titleEn || '').toLowerCase()
          const titleAr = String(item.titleAr || '').toLowerCase()
          const brand = String(item.brand || '').toLowerCase()
          if (catHint && (titleEn.includes(catHint) || titleAr.includes(catHint) || brand.includes(catHint))) {
            result.offersSkippedAlreadyPublishedCount++
            continue
          }
        }
      } else if (matchingResolution.resolution === 'applied') {
        // Unconfirmed category match quarantine
        if (matchingResolution.scope === 'category' && matchingResolution.operatorConfirmedMatches !== true) {
          const catHint = (matchingResolution.categoryHint || '').toLowerCase().trim()
          const titleEn = String(item.titleEn || '').toLowerCase()
          const titleAr = String(item.titleAr || '').toLowerCase()
          const brand = String(item.brand || '').toLowerCase()
          if (catHint && (titleEn.includes(catHint) || titleAr.includes(catHint) || brand.includes(catHint))) {
            result.offersSkippedAlreadyPublishedCount++
            continue
          }
        }
      }
    }

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

      const resolvedLocationScope =
        (item as any).location_scope ??
        header.locationScope ??
        readiness.confirmedRecord?.locationScope ??
        null
      if (!resolvedLocationScope) {
        result.errors.push(
          `Offer ${item.id} cannot be published without an explicitly resolved location_scope.`
        )
        continue
      }
      const resolvedCityId =
        resolvedLocationScope === 'city'
          ? ((item as any).city_id ?? header.cityId ?? readiness.confirmedRecord?.cityId ?? null)
          : null
      const resolvedRegionId =
        resolvedLocationScope === 'region'
          ? ((item as any).region_id ?? header.regionId ?? readiness.confirmedRecord?.regionId ?? null)
          : null

      const offerPayload: any = {
        id: offerId,
        source_offer_id: sourceOfferId,
        source_page_number: itemPage > 0 ? itemPage : null,
        supermarket_id: effectiveSupermarketId || null,
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
        offer_start_date: (() => {
          let sDate = (item as any).offerStartDate || header.validFrom
          if (matchingResolution && matchingResolution.resolution === 'applied') {
            const isPageWide = !matchingResolution.scope || matchingResolution.scope === 'page_wide'
            let isAffected = isPageWide
            if (matchingResolution.scope === 'specific_offers') {
              const itemId = String(item.id || '').toLowerCase()
              const sourceId = String(item.sourceOfferId || '').toLowerCase()
              const rawItemNum = String((item as any).sourceItemNumber || (item as any).itemNumber || '').toLowerCase()
              isAffected = (matchingResolution.affectedOfferIds || []).some(id => {
                const clean = String(id).toLowerCase().trim()
                return clean === itemId || clean === sourceId || clean === rawItemNum || clean.endsWith(`_${rawItemNum}`) || itemId.endsWith(`_${clean}`)
              })
            } else if (matchingResolution.scope === 'category') {
              if (matchingResolution.operatorConfirmedMatches === true) {
                const catHint = (matchingResolution.categoryHint || '').toLowerCase().trim()
                const titleEn = String(item.titleEn || '').toLowerCase()
                const titleAr = String(item.titleAr || '').toLowerCase()
                const brand = String(item.brand || '').toLowerCase()
                isAffected = Boolean(catHint && (titleEn.includes(catHint) || titleAr.includes(catHint) || brand.includes(catHint)))
              } else {
                isAffected = false
              }
            }
            if (isAffected && matchingResolution.startDate) {
              sDate = matchingResolution.startDate
            }
          }
          return sDate
        })(),
        offer_end_date: (() => {
          let eDate = (item as any).offerEndDate || header.validTo
          if (matchingResolution && matchingResolution.resolution === 'applied') {
            const isPageWide = !matchingResolution.scope || matchingResolution.scope === 'page_wide'
            let isAffected = isPageWide
            if (matchingResolution.scope === 'specific_offers') {
              const itemId = String(item.id || '').toLowerCase()
              const sourceId = String(item.sourceOfferId || '').toLowerCase()
              const rawItemNum = String((item as any).sourceItemNumber || (item as any).itemNumber || '').toLowerCase()
              isAffected = (matchingResolution.affectedOfferIds || []).some(id => {
                const clean = String(id).toLowerCase().trim()
                return clean === itemId || clean === sourceId || clean === rawItemNum || clean.endsWith(`_${rawItemNum}`) || itemId.endsWith(`_${clean}`)
              })
            } else if (matchingResolution.scope === 'category') {
              if (matchingResolution.operatorConfirmedMatches === true) {
                const catHint = (matchingResolution.categoryHint || '').toLowerCase().trim()
                const titleEn = String(item.titleEn || '').toLowerCase()
                const titleAr = String(item.titleAr || '').toLowerCase()
                const brand = String(item.brand || '').toLowerCase()
                isAffected = Boolean(catHint && (titleEn.includes(catHint) || titleAr.includes(catHint) || brand.includes(catHint)))
              } else {
                isAffected = false
              }
            }
            if (isAffected && matchingResolution.endDate) {
              eDate = matchingResolution.endDate
            }
          }
          return eDate
        })(),
        status: 'published',
        published_at: new Date().toISOString(),
        location_scope: resolvedLocationScope,
        city_id: resolvedCityId,
        region_id: resolvedRegionId,
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
        publishedOfferKeysThisRun.push(getStagedItemKey(item, currentOfferIndex - 1))
        if (itemPage > 0) {
          publishedPagesThisRun.add(itemPage)
        }
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
      if (item.selectedImageSource === 'none' || item.selectedImageSource === 'product_thumb') {
        // Leave consumer display image NULL - leaflet crops (both card and thumb) are private evidence only
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

  // 7. Historical public 'tmp' boundary objects are intentionally left untouched (no auto-delete).

  // 8. Update draft status on disk only if publication succeeded without errors
  if (result.errors.length === 0) {
    draft.status = 'published'
    draft.publishedAt = new Date().toISOString()
    if (selectedPublishScopeSet !== null) {
      draft.partialCoveragePublish = true
      const mergedPages = new Set<number>(draft.publishedPages || [])
      for (const p of publishedPagesThisRun) {
        mergedPages.add(p)
      }
      draft.publishedPages = Array.from(mergedPages).sort((a, b) => a - b)
    } else {
      draft.partialCoveragePublish = false
    }
  }
  await saveStagedLeafletDraft(jobDir, draft, { skipHistorySync: true })
  if (Array.isArray(draft.items) && (draft.items.length > 0 || publishedOfferKeysThisRun.length > 0)) {
    await upsertItemsIntoStagedDraftHistory(jobDir, draft.items, {
      markPublishedKeys: publishedOfferKeysThisRun,
      markPublishedPages: Array.from(publishedPagesThisRun)
    })
  }

  result.ok = result.errors.length === 0
  return result
}
