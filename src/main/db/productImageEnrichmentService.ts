import * as crypto from 'crypto'
import * as dns from 'dns/promises'
import * as net from 'net'
import { getSupabaseAdminClient } from './supabaseAdminClient'
import {
  ValidatedCsvRow,
  CsvValidationSummary,
  UploadProductImagesInput,
  UploadProductImagesResult,
  HybridImageRefRow,
  ExportHybridImageRefsResult
} from '../../shared/types/productImageEnrichment'
import {
  loadOfferRefMap,
  saveOfferRefMap,
  assignShortOfferRef,
  removeOfferRef,
  pruneStaleOfferRefs,
  parseImageRef,
  OfferImageRefMap,
  getDefaultOfferRefMapPath,
  setCustomOfferRefMapPath,
  getOfferRefMapPath
} from './offerImageRefMapper'

export {
  loadOfferRefMap,
  saveOfferRefMap,
  assignShortOfferRef,
  removeOfferRef,
  pruneStaleOfferRefs,
  parseImageRef,
  getDefaultOfferRefMapPath,
  setCustomOfferRefMapPath,
  getOfferRefMapPath
}
export type { OfferImageRefMap }

export {
  loadStagedLeafletDraft,
  saveStagedLeafletDraft,
  initializeStagedDraftFromPackage,
  initializeStagedLeafletDraftFromJobDir,
  uploadLeafletBoundaryPagesForMetadata,
  cleanupLeafletBoundaryPagesFromTmpBucket,
  preMatchLocalOffersAgainstDb,
  exportStagedLeafletForStep2,
  checkPostCorrectionCatalogMatch,
  importStep2CsvIntoStagedDraft,
  updateStagedLeafletHeader,
  updateStagedOfferField,
  revertStagedOfferField,
  replaceStagedOfferConsumerImage,
  publishStagedLeafletDraftToDb,
  resolveOrCreateSupermarket,
  resolveOrCreateRegion,
  parseLeafletFilenameMetadata
} from './stagedLeafletDraftService'

export type { ResolvedEntity } from './stagedLeafletDraftService'

export type {
  StagedLeafletHeader,
  OriginalOcrSnapshot,
  AiCorrectedSnapshot,
  PostCorrectionDbMatch,
  StagedOfferItem,
  StagedLeafletDraft,
  PreMatchLocalOffersResult,
  ExportStagedLeafletResult,
  ExportStagedLeafletRow,
  ImportStep2CsvResult,
  PublishStagedLeafletOptions,
  PublishStagedLeafletResult
} from '../../shared/types/productImageEnrichment'

export type {
  ValidatedCsvRow,
  CsvValidationSummary,
  UploadProductImagesInput,
  UploadProductImagesResult,
  HybridImageRefRow,
  ExportHybridImageRefsResult
}

export function isPrivateOrInternalIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number)
    // 10.0.0.0/8
    if (parts[0] === 10) return true
    // 172.16.0.0/12 (172.16 - 172.31)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true
    // 169.254.0.0/16 (Link local / AWS metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true
    // 127.0.0.0/8
    if (parts[0] === 127) return true
  } else if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    // fc00::/7 (Unique local)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    // fe80::/10 (Link local)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true
  }

  return false
}

export async function validateSsrfSafeUrl(rawUrl: string): Promise<{ valid: boolean; reason?: string }> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { valid: false, reason: 'Malformed URL.' }
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only secure HTTPS image URLs are permitted.' }
  }

  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { valid: false, reason: 'Local and internal hostnames are prohibited.' }
  }

  // Check if hostname is direct IP literal
  if (net.isIP(hostname)) {
    if (isPrivateOrInternalIp(hostname)) {
      return { valid: false, reason: 'Private IP addresses are prohibited.' }
    }
    return { valid: true }
  }

  // Resolve hostname DNS to verify destination IP
  try {
    const addresses = await dns.resolve(hostname)
    for (const addr of addresses) {
      if (isPrivateOrInternalIp(addr)) {
        return { valid: false, reason: `Resolved IP (${addr}) points to private/internal network.` }
      }
    }
  } catch (dnsErr: any) {
    return { valid: false, reason: `DNS resolution failed: ${dnsErr.message}` }
  }

  return { valid: true }
}

export function detectImageMimeType(buffer: Buffer): { mimeType: string; ext: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' }
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: 'image/png', ext: 'png' }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ext: 'webp' }
  }
  return null
}

export function normalizeSourceUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    // Strip common tracking query params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']
    for (const p of trackingParams) {
      u.searchParams.delete(p)
    }
    return u.toString()
  } catch {
    return rawUrl.trim()
  }
}

// -------------------------------------------------------------
// Visual Subject Classification & Formatting (WIFRAN-07J §3 & §4)
// -------------------------------------------------------------
export interface FormattedVisualSubject {
  visualSubjectKey: string
  visualSubjectName: string
  ambiguityClass: 'choice_assortment' | 'loose_commodity' | 'generic_merchandise'
  formattedItemName: string
}

/**
 * Removes redundant weight/volume strings from Arabic strings (e.g., ٤٥٠ جرام, ١ كج, 600 ج, 10Kg, ٥ كجم)
 * while preserving dimensional specs (e.g. 25.5 cm), counts/layers (e.g. 3 طبقات), and electrical specs (e.g. 50w).
 */
export function cleanArabicWeightAndVolume(rawAr: string): string {
  if (!rawAr) return ''
  let cleaned = rawAr
    // 1. Multiplier weight/volume (unit REQUIRED): e.g., 4x1L, ٤ × ١ لتر, 10x75Gm, ٧٥x١٠ جم
    .replace(/[٠-٩0-9]+(?:\s*[,.٫]\s*[٠-٩0-9]+)?\s*[×xX*]\s*[٠-٩0-9]+(?:\s*[,.٫]\s*[٠-٩0-9]+)?\s*(?:كيلو\s*جرام|كيلوجرام|جرام|كجم|كيلو|كج|مل|ملل|مليلتر|ليتر|لتر|جم|ك|ج|ل|kg|kilo|gm|gms|g|ml|ltr|l)(?!\p{L})/giu, '')
    // 2. Standalone quantity + weight/volume (unit REQUIRED): e.g. ٤٥٠ جرام, ١ كج, 600 ج, 10Kg, 5Kg, 400ml, 125Gm, ٥ كجم
    .replace(/[٠-٩0-9]+(?:\s*[,.٫]\s*[٠-٩0-9]+)?\s*(?:كيلو\s*جرام|كيلوجرام|جرام|كجم|كيلو|كج|مل|ملل|مليلتر|ليتر|لتر|جم|ك|ج|ل|kg|kilo|gm|gms|g|ml|ltr|l)(?!\p{L})/giu, '')
    // 3. Per kg phrases: للكيلو, لكل كيلو, بالكيلو
    .replace(/\s*(?:للكيلو|لكل كيلو|بالكيلو)(?!\p{L})/gu, '')
    // 4. Clean trailing/leading/dangling punctuation, slashes, spaces
    .replace(/\s*[\/\\]\s*(?=[\/\\]|$)/gu, '')
    .replace(/^[\s\-_,،|\/\\]+/gu, '')
    .replace(/[\s\-_,،|\/\\]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned
}

/**
 * Constructs concise bilingual item name: "${English} | ${Arabic}".
 * Omits the pipe and Arabic portion if Arabic is empty or identical to English.
 */
export function formatBilingualItemName(englishDesc: string, rawArabicDesc?: string | null): string {
  const en = (englishDesc || '').trim()
  const cleanedAr = cleanArabicWeightAndVolume((rawArabicDesc || '').trim())

  if (!cleanedAr || cleanedAr.toLowerCase() === en.toLowerCase()) {
    return en
  }
  if (!en) {
    return cleanedAr
  }
  return `${en} | ${cleanedAr}`
}

export function formatOfferVisualItemName(offer: {
  title_en?: string | null
  title_ar?: string | null
  sale_unit_type?: string | null
  each_size_value?: number | null
  each_size_unit?: string | null
  assortment?: any
  contract_v2?: any
}): FormattedVisualSubject {
  const titleEn = (offer.title_en || '').trim()
  const titleAr = (offer.title_ar || '').trim()
  const baseTitle = titleEn || titleAr || 'Unspecified Item'
  const lowerTitle = baseTitle.toLowerCase()

  const saleUnit = (offer.sale_unit_type || '').toLowerCase()
  const assortmentStatus =
    offer.contract_v2?.assortment?.status ||
    offer.assortment?.status ||
    null

  const isCommodity =
    saleUnit === 'kg' ||
    lowerTitle.includes('per kg') ||
    lowerTitle.includes('perkg') ||
    lowerTitle.includes('للكيلو') ||
    lowerTitle.includes('لكل كيلو')

  // Check for brand conflict between English and Arabic (e.g. Krypton in EN vs Geepas / جيباس in AR)
  const isEnKrypton = lowerTitle.includes('krypton')
  const isArGeepas = titleAr.includes('جيباس') || titleAr.toLowerCase().includes('geepas')
  const isBrandConflict = isEnKrypton && isArGeepas

  const isAssortment =
    !isCommodity && (
      isBrandConflict ||
      lowerTitle.includes('/') ||
      lowerTitle.includes(' asstd') ||
      lowerTitle.includes('assorted') ||
      lowerTitle.includes('منوع') ||
      lowerTitle.includes('متنوع') ||
      ['assortment_indicated', 'indicated_with_conflict', 'choice_among_options', 'unknown_composition'].includes(assortmentStatus)
    )

  if (isCommodity) {
    const cleaned = (titleEn || baseTitle)
      .replace(/\s*(?:\/|\bper\b)\s*k(?:g|ilogram)\b/gi, '')
      .replace(/\s*للكيلو\b/gi, '')
      .replace(/\s*لكل كيلو\b/gi, '')
      .trim()
    const slug = cleaned.toLowerCase().replace(/[^\w\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, '')
    const visualSubjectKey = `commodity:${slug}:kg`
    const visualSubjectName = `${cleaned}, sold by kg`
    const formattedItemName = formatBilingualItemName(cleaned, titleAr)
    return {
      visualSubjectKey,
      visualSubjectName,
      ambiguityClass: 'loose_commodity',
      formattedItemName
    }
  }

  if (isAssortment) {
    let displayTitle = titleEn || baseTitle
    if (isBrandConflict) {
      displayTitle = 'Krypton / Geepas Zoomable LED Flashlight Asstd.'
    }
    const slug = displayTitle.toLowerCase().replace(/[^\w\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, '')
    const visualSubjectKey = `assortment:${slug}`
    const visualSubjectName = displayTitle
    const formattedItemName = formatBilingualItemName(displayTitle, titleAr)
    return {
      visualSubjectKey,
      visualSubjectName,
      ambiguityClass: 'choice_assortment',
      formattedItemName
    }
  }

  const slug = baseTitle.toLowerCase().replace(/[^\w\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, '')
  const visualSubjectKey = `generic:${slug}`
  const visualSubjectName = baseTitle
  const formattedItemName = formatBilingualItemName(titleEn || baseTitle, titleAr)
  return {
    visualSubjectKey,
    visualSubjectName,
    ambiguityClass: 'generic_merchandise',
    formattedItemName
  }
}

// -------------------------------------------------------------
// 1. Export Hybrid Image References for Search (WIFRAN-07J §3)
// -------------------------------------------------------------
export interface ExportProductsForImageSearchOptions {
  productIds?: Array<number | string>
  offerIds?: string[]
  supermarketId?: string
  supermarketName?: string
  sourcePrefix?: string
  includeUnresolvedOffers?: boolean
  persistVisualGroups?: boolean
  mapFilePath?: string
}

export async function exportProductsForImageSearch(
  options?: ExportProductsForImageSearchOptions
): Promise<ExportHybridImageRefsResult> {
  const supabase = getSupabaseAdminClient()
  const includeUnresolved = options?.includeUnresolvedOffers !== false

  // 1. Query Verified Catalog Products (P rows)
  let prodQuery = supabase
    .from('products')
    .select('id, name_en, name_ar, item_name_complete, each_size_value, each_size_unit, approved_primary_image_id')
    .eq('verification_status', 'verified')
    .is('approved_primary_image_id', null)
    .order('id', { ascending: true })

  if (options?.productIds && options.productIds.length > 0) {
    prodQuery = prodQuery.in('id', options.productIds)
  }

  const { data: prodData, error: prodErr } = await prodQuery
  if (prodErr) {
    throw new Error(`Failed to export verified products for image search: ${prodErr.message}`)
  }

  const rawProducts = prodData || []
  const productsToExport: Array<{ id: number | string; item_name: string }> = []
  for (const p of rawProducts) {
    let enDesc = (p.name_en || '').trim()
    if (!enDesc) {
      enDesc = (p.item_name_complete || `Product ${p.id}`).trim()
    } else if (p.each_size_value && p.each_size_unit) {
      const sizeNum = String(p.each_size_value)
      if (!enDesc.includes(sizeNum)) {
        enDesc = `${enDesc} (${p.each_size_value} ${p.each_size_unit})`
      }
    }
    const formattedItemName = formatBilingualItemName(enDesc, p.name_ar)
    productsToExport.push({
      id: p.id,
      item_name: formattedItemName
    })
  }

  // 2. Query Unresolved Offers (O rows) if requested
  interface UnresolvedOfferItem {
    id: string
    source_offer_id: string
    title_en: string | null
    title_ar: string | null
    sale_unit_type: string | null
    each_size_value: number | null
    each_size_unit: string | null
    inner_pack_count: number | null
    contract_v2: any
    formatted: FormattedVisualSubject
  }

  const representativeOffers: Array<{
    id: string
    source_offer_id: string
    formattedItemName: string
    visualSubjectKey: string
    visualSubjectName: string
    memberOfferIds: string[]
  }> = []
  let groupedExclusionsCount = 0

  if (includeUnresolved) {
    let offerQuery = supabase
      .from('offers')
      .select('id, source_offer_id, title_en, title_ar, sale_unit_type, each_size_value, each_size_unit, inner_pack_count, contract_v2, status, supermarket_id')
      .is('product_id', null)

    if (options?.offerIds && options.offerIds.length > 0) {
      offerQuery = offerQuery.in('id', options.offerIds)
    }
    if (options?.supermarketId) {
      offerQuery = offerQuery.eq('supermarket_id', options.supermarketId)
    }
    if (options?.sourcePrefix) {
      offerQuery = offerQuery.ilike('source_offer_id', `${options.sourcePrefix}%`)
    }

    const { data: rawOffers, error: offerErr } = await offerQuery
    if (offerErr) {
      throw new Error(`Failed to query unresolved offers for image export: ${offerErr.message}`)
    }

    if (rawOffers && rawOffers.length > 0) {
      const offerIds = rawOffers.map((o) => o.id)
      const { data: approvedImages } = await supabase
        .from('offer_display_images')
        .select('offer_id')
        .in('offer_id', offerIds)
        .eq('approval_status', 'approved')

      const approvedOfferIds = new Set((approvedImages || []).map((img) => img.offer_id))

      const eligibleOffers: UnresolvedOfferItem[] = []
      for (const o of rawOffers) {
        if (approvedOfferIds.has(o.id)) continue
        const formatted = formatOfferVisualItemName(o)
        eligibleOffers.push({
          id: o.id,
          source_offer_id: o.source_offer_id || '',
          title_en: o.title_en,
          title_ar: o.title_ar,
          sale_unit_type: o.sale_unit_type,
          each_size_value: o.each_size_value,
          each_size_unit: o.each_size_unit,
          inner_pack_count: o.inner_pack_count,
          contract_v2: o.contract_v2,
          formatted
        })
      }

      // Sort eligible offers deterministically
      eligibleOffers.sort((a, b) => {
        const cmp = a.source_offer_id.localeCompare(b.source_offer_id)
        if (cmp !== 0) return cmp
        return a.id.localeCompare(b.id)
      })

      // Group by visualSubjectKey
      const groupMap = new Map<
        string,
        {
          representative: UnresolvedOfferItem
          members: UnresolvedOfferItem[]
        }
      >()

      for (const offer of eligibleOffers) {
        const key = offer.formatted.visualSubjectKey
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            representative: offer,
            members: [offer]
          })
        } else {
          groupMap.get(key)!.members.push(offer)
          groupedExclusionsCount++
        }
      }

      // If persistVisualGroups !== false, persist mappings for multi-member groups
      if (options?.persistVisualGroups !== false) {
        const groupInserts: Array<{
          representative_offer_id: string
          member_offer_id: string
          visual_subject_key: string
          visual_subject_name: string
        }> = []

        for (const [key, grp] of groupMap.entries()) {
          if (grp.members.length > 1) {
            for (const member of grp.members) {
              if (member.id !== grp.representative.id) {
                groupInserts.push({
                  representative_offer_id: grp.representative.id,
                  member_offer_id: member.id,
                  visual_subject_key: key,
                  visual_subject_name: grp.representative.formatted.visualSubjectName
                })
              }
            }
          }
        }

        if (groupInserts.length > 0) {
          await supabase
            .from('offer_visual_group_members')
            .upsert(groupInserts, { onConflict: 'representative_offer_id,member_offer_id' })
        }
      }

      // Add representative offers in deterministic order
      for (const grp of groupMap.values()) {
        representativeOffers.push({
          id: grp.representative.id,
          source_offer_id: grp.representative.source_offer_id,
          formattedItemName: grp.representative.formatted.formattedItemName,
          visualSubjectKey: grp.representative.formatted.visualSubjectKey,
          visualSubjectName: grp.representative.formatted.visualSubjectName,
          memberOfferIds: grp.members.map((m) => m.id)
        })
      }

      // Sort representative offers deterministically
      representativeOffers.sort((a, b) => {
        const cmp = a.source_offer_id.localeCompare(b.source_offer_id)
        if (cmp !== 0) return cmp
        return a.id.localeCompare(b.id)
      })
    }
  }

  // 3. Assemble Unified CSV Lines (Image_Ref,item_name)
  const csvLines: string[] = ['Image_Ref,item_name']
  const hybridRows: HybridImageRefRow[] = []

  // Add P rows first
  for (const p of productsToExport) {
    const safeName = p.item_name.replace(/"/g, '""')
    csvLines.push(`"P${p.id}","${safeName}"`)
    hybridRows.push({
      imageRef: `P${p.id}`,
      itemName: p.item_name,
      kind: 'product',
      productId: p.id
    })
  }

  // Load and prune local short-ID ref map for unresolved offers
  const refMap = await loadOfferRefMap(options?.mapFilePath)
  if (includeUnresolved) {
    await pruneStaleOfferRefs(refMap, supabase)
  }

  // Add O rows next using short sequential references (O1, O2, ...)
  for (const o of representativeOffers) {
    const safeName = o.formattedItemName.replace(/"/g, '""')
    const shortRef = assignShortOfferRef(o.id, refMap)
    csvLines.push(`"${shortRef}","${safeName}"`)
    hybridRows.push({
      imageRef: shortRef,
      itemName: o.formattedItemName,
      kind: 'offer',
      offerId: o.id,
      visualSubjectKey: o.visualSubjectKey,
      memberOfferIds: o.memberOfferIds
    })
  }

  if (includeUnresolved && representativeOffers.length > 0) {
    await saveOfferRefMap(refMap, options?.mapFilePath)
  }

  return {
    csvContent: '\uFEFF' + csvLines.join('\r\n'),
    count: hybridRows.length,
    pCount: productsToExport.length,
    oCount: representativeOffers.length,
    groupedOffersCount: groupedExclusionsCount,
    rows: hybridRows,
    products: productsToExport.map((p) => ({ id: p.id, item_name: p.item_name })),
    offers: representativeOffers.map((o) => ({
      id: o.id,
      item_name: o.formattedItemName,
      visual_subject_key: o.visualSubjectKey,
      short_ref: assignShortOfferRef(o.id, refMap)
    }))
  }
}

// -------------------------------------------------------------
// 2. CSV Import Validation (Zero network operations) (WIFRAN-07G §5 & WIFRAN-07J §5)
// -------------------------------------------------------------
export function parseSimpleCsv(content: string): string[][] {
  const lines: string[][] = []
  // Strip UTF-8 BOM if present
  const cleanContent = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  const rawLines = cleanContent.split(/\r?\n/)

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    const row: string[] = []
    let inQuotes = false
    let currentField = ''

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (ch === '"') {
        if (inQuotes && trimmed[i + 1] === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === ',' && !inQuotes) {
        row.push(currentField.trim())
        currentField = ''
      } else {
        currentField += ch
      }
    }
    row.push(currentField.trim())
    lines.push(row)
  }

  return lines
}

export async function validateProductImageCsvImport(
  csvContent: string,
  options?: { mapFilePath?: string }
): Promise<CsvValidationSummary> {
  const parsedRows = parseSimpleCsv(csvContent)
  const errors: string[] = []

  if (parsedRows.length === 0) {
    return {
      ok: false,
      totalRows: 0,
      validRowsCount: 0,
      blankSkippedCount: 0,
      alreadyHasImageCount: 0,
      errorCount: 1,
      rows: [],
      errors: ['CSV file is empty.']
    }
  }

  const rawHeader = parsedRows[0].map((h) => h.toLowerCase().replace(/[\s_-]/g, ''))
  // WIFRAN-07J §3 & §5: Exactly two columns: (Image_Ref or Product_ID) and image_url
  const validCol0 = rawHeader[0] === 'imageref' || rawHeader[0] === 'productid'
  const validCol1 = rawHeader[1] === 'imageurl'

  if (rawHeader.length !== 2 || !validCol0 || !validCol1) {
    return {
      ok: false,
      totalRows: 0,
      validRowsCount: 0,
      blankSkippedCount: 0,
      alreadyHasImageCount: 0,
      errorCount: 1,
      rows: [],
      errors: [
        `Invalid CSV header. Expected exactly two columns: 'Image_Ref,image_url' (or 'Product_ID,image_url'). Found: '${parsedRows[0].join(',')}'`
      ]
    }
  }

  const supabase = getSupabaseAdminClient()
  const dataRows = parsedRows.slice(1)
  const refMap = await loadOfferRefMap(options?.mapFilePath)

  // Parse identifiers: P<id> / <id> (bigint) vs O<n> / O<uuid> / <uuid>
  const rawProductIds: number[] = []
  const rawOfferIds: string[] = []

  for (const r of dataRows) {
    const rawVal = (r[0] || '').trim()
    if (!rawVal) continue

    const parsedRef = parseImageRef(rawVal, refMap)
    if (parsedRef.kind === 'product' && parsedRef.productId) {
      rawProductIds.push(parsedRef.productId)
    } else if (parsedRef.kind === 'offer' && parsedRef.offerId) {
      rawOfferIds.push(parsedRef.offerId)
    }
  }

  // Query products
  const { data: dbProducts, error: prodErr } = rawProductIds.length > 0
    ? await supabase
        .from('products')
        .select('id, item_name_complete, approved_primary_image_id, verification_status')
        .in('id', rawProductIds)
    : { data: [], error: null }

  if (prodErr) {
    throw new Error(`Failed to query products for CSV validation: ${prodErr.message}`)
  }

  // Query offers
  const { data: dbOffers, error: offerErr } = rawOfferIds.length > 0
    ? await supabase
        .from('offers')
        .select('id, title_en, title_ar, sale_unit_type, contract_v2, product_id, status')
        .in('id', rawOfferIds)
    : { data: [], error: null }

  if (offerErr) {
    throw new Error(`Failed to query offers for CSV validation: ${offerErr.message}`)
  }

  const productMap = new Map<string, any>()
  if (dbProducts) {
    for (const p of dbProducts) {
      productMap.set(String(p.id), p)
    }
  }

  const offerMap = new Map<string, any>()
  if (dbOffers) {
    for (const o of dbOffers) {
      offerMap.set(o.id, o)
    }
  }

  let approvedOfferImageIds = new Set<string>()
  if (rawOfferIds.length > 0) {
    const { data: approvedOfferImgs } = await supabase
      .from('offer_display_images')
      .select('offer_id')
      .in('offer_id', rawOfferIds)
      .eq('approval_status', 'approved')
    if (approvedOfferImgs) {
      approvedOfferImageIds = new Set(approvedOfferImgs.map((img) => img.offer_id))
    }
  }

  const validatedRows: ValidatedCsvRow[] = []
  const seenRefs = new Set<string>()

  let validCount = 0
  let blankCount = 0
  let alreadyHasImageCount = 0
  let errCount = 0

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2
    const row = dataRows[i]
    const rawRef = (row[0] || '').trim()
    const imageUrl = (row[1] || '').trim()

    const parsedRef = parseImageRef(rawRef, refMap)
    const targetKind: 'product' | 'offer' = parsedRef.kind === 'offer' ? 'offer' : 'product'
    const resolvedId = parsedRef.kind === 'product'
      ? (parsedRef.productId ? String(parsedRef.productId) : '')
      : (parsedRef.offerId || '')

    const item: ValidatedCsvRow = {
      rowNumber: rowNum,
      imageRef: rawRef,
      targetKind,
      productId: targetKind === 'product' ? resolvedId : undefined,
      offerId: targetKind === 'offer' ? resolvedId : undefined,
      imageUrl: imageUrl || null,
      status: 'valid'
    }

    if (!rawRef) {
      item.status = 'unknown_product'
      item.issueMessage = 'Missing Image_Ref / Product_ID.'
      errCount++
      errors.push(`Row ${rowNum}: ${item.issueMessage}`)
      validatedRows.push(item)
      continue
    }

    if (parsedRef.error) {
      item.status = 'unknown_product'
      item.issueMessage = parsedRef.error
      errCount++
      errors.push(`Row ${rowNum}: ${item.issueMessage}`)
      validatedRows.push(item)
      continue
    }

    if (seenRefs.has(rawRef)) {
      item.status = 'duplicate_product'
      item.issueMessage = `Duplicate reference '${rawRef}' in CSV.`
      errCount++
      errors.push(`Row ${rowNum}: ${item.issueMessage}`)
      validatedRows.push(item)
      continue
    }
    seenRefs.add(rawRef)

    const entityKey = `${targetKind}:${resolvedId}`
    if (seenRefs.has(entityKey)) {
      item.status = 'duplicate_product'
      item.issueMessage = `Duplicate ${targetKind} reference '${resolvedId}' in CSV.`
      errCount++
      errors.push(`Row ${rowNum}: ${item.issueMessage}`)
      validatedRows.push(item)
      continue
    }
    seenRefs.add(entityKey)

    let hasImage = false
    if (targetKind === 'product') {
      const parsedInt = Number(resolvedId)
      if (isNaN(parsedInt) || !Number.isInteger(parsedInt) || parsedInt <= 0) {
        item.status = 'unknown_product'
        item.issueMessage = `Product ID in reference '${rawRef}' must be a positive integer.`
        errCount++
        errors.push(`Row ${rowNum}: ${item.issueMessage}`)
        validatedRows.push(item)
        continue
      }

      const dbProduct = productMap.get(resolvedId)
      if (!dbProduct) {
        item.status = 'unknown_product'
        item.issueMessage = `Product '${resolvedId}' does not exist in the database.`
        errCount++
        errors.push(`Row ${rowNum}: ${item.issueMessage}`)
        validatedRows.push(item)
        continue
      }

      if (dbProduct.verification_status !== 'verified') {
        item.status = 'unknown_product'
        item.issueMessage = `Product '${resolvedId}' is not a verified catalog product.`
        errCount++
        errors.push(`Row ${rowNum}: ${item.issueMessage}`)
        validatedRows.push(item)
        continue
      }

      item.productName = dbProduct.item_name_complete
      if (dbProduct.approved_primary_image_id) {
        hasImage = true
        alreadyHasImageCount++
      }
    } else {
      const dbOffer = offerMap.get(resolvedId)
      if (!dbOffer) {
        item.status = 'unknown_product'
        item.issueMessage = `Offer '${resolvedId}' does not exist in the database.`
        errCount++
        errors.push(`Row ${rowNum}: ${item.issueMessage}`)
        validatedRows.push(item)
        continue
      }

      if (dbOffer.product_id) {
        item.status = 'unknown_product'
        item.issueMessage = `Offer '${resolvedId}' is linked to a verified catalog product; use P${dbOffer.product_id} instead.`
        errCount++
        errors.push(`Row ${rowNum}: ${item.issueMessage}`)
        validatedRows.push(item)
        continue
      }

      const visualObj = formatOfferVisualItemName(dbOffer)
      item.visualSubjectKey = visualObj.visualSubjectKey
      item.productName = visualObj.formattedItemName

      if (approvedOfferImageIds.has(resolvedId)) {
        hasImage = true
        alreadyHasImageCount++
      }
    }

    if (!imageUrl) {
      if (hasImage) {
        item.status = 'already_has_image'
        item.issueMessage = targetKind === 'product'
          ? 'Product already has an approved primary image; blank URL skipped.'
          : 'Offer already has an approved display image; blank URL skipped.'
      } else {
        item.status = 'blank_skipped'
        item.issueMessage = 'Empty image URL; skipped without error.'
      }
      blankCount++
      validatedRows.push(item)
      continue
    }

    try {
      const parsedUrl = new URL(imageUrl)
      if (parsedUrl.protocol !== 'https:') {
        item.status = 'invalid_url'
        item.issueMessage = 'URL must use HTTPS protocol.'
        errCount++
        errors.push(`Row ${rowNum}: ${item.issueMessage}`)
        validatedRows.push(item)
        continue
      }
    } catch {
      item.status = 'invalid_url'
      item.issueMessage = 'Invalid URL format.'
      errCount++
      errors.push(`Row ${rowNum}: ${item.issueMessage}`)
      validatedRows.push(item)
      continue
    }

    item.status = 'valid'
    if (hasImage) {
      item.issueMessage = 'Target has existing approved image; will verify hash for idempotent deduplication or update.'
    }
    validCount++
    validatedRows.push(item)
  }

  const ok = errCount === 0

  return {
    ok,
    totalRows: dataRows.length,
    validRowsCount: validCount,
    blankSkippedCount: blankCount,
    alreadyHasImageCount,
    errorCount: errCount,
    rows: validatedRows,
    errors
  }
}

// -------------------------------------------------------------
// 3. Explicit Operator Download & Deduplicated Upload (WIFRAN-07G §5)
// -------------------------------------------------------------
export async function uploadApprovedProductImagesToDb(
  input: UploadProductImagesInput
): Promise<UploadProductImagesResult> {
  // WIFRAN-07G §4 & §5: Mandatory operator review confirmation
  if (!input.operatorConfirmedReview) {
    throw new Error(
      'Upload blocked: Operator review confirmation is required before downloading and uploading catalog product images.'
    )
  }

  const validation = await validateProductImageCsvImport(input.csvContent, { mapFilePath: input.mapFilePath })
  if (!validation.ok) {
    throw new Error(
      `CSV validation failed with ${validation.errorCount} error(s). Please resolve invalid or duplicate product IDs first.`
    )
  }

  const supabase = getSupabaseAdminClient()
  const reviewedBy = input.reviewedBy || 'operator'
  const rightsBasis = input.rightsBasis || 'operator_manual_verified'
  const refMap = await loadOfferRefMap(input.mapFilePath)
  let mapModified = false

  const result: UploadProductImagesResult = {
    totalRows: validation.rows.length,
    uploadedCount: 0,
    reusedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    results: []
  }

  const downloadCache = new Map<
    string,
    { buffer: Buffer; detected: NonNullable<ReturnType<typeof detectImageMimeType>> }
  >()

  let index = 0
  for (const row of validation.rows) {
    index++
    if (row.status === 'blank_skipped' || !row.imageUrl) {
      result.skippedCount++
      result.results.push({
        productId: row.productId,
        offerId: row.offerId,
        imageRef: row.imageRef,
        targetKind: row.targetKind,
        status: 'skipped',
        error: 'Empty or unprovided image URL'
      })
      input.onProgress?.({
        current: index,
        total: validation.rows.length,
        message: `Skipped reference ${row.imageRef || row.productId || row.offerId} (blank URL)`,
        stage: 'skipped'
      })
      continue
    }

    if (row.status === 'already_has_image') {
      result.skippedCount++
      result.results.push({
        productId: row.productId,
        offerId: row.offerId,
        imageRef: row.imageRef,
        targetKind: row.targetKind,
        status: 'skipped',
        error: 'Target already has approved image; blank URL skipped'
      })
      if (row.targetKind === 'offer' && row.offerId) {
        if (removeOfferRef(row.offerId, refMap)) {
          mapModified = true
        }
      }
      input.onProgress?.({
        current: index,
        total: validation.rows.length,
        message: `Skipped reference ${row.imageRef || row.productId || row.offerId} (already has image)`,
        stage: 'skipped'
      })
      continue
    }

    input.onProgress?.({
      current: index,
      total: validation.rows.length,
      message: `Fetching image for ${row.productName || row.imageRef || row.productId || row.offerId}...`,
      stage: 'downloading'
    })

    try {
      const normalizedSource = normalizeSourceUrl(row.imageUrl)
      let buffer: Buffer
      let detected: NonNullable<ReturnType<typeof detectImageMimeType>>

      if (downloadCache.has(normalizedSource)) {
        const cached = downloadCache.get(normalizedSource)!
        buffer = cached.buffer
        detected = cached.detected
        input.onProgress?.({
          current: index,
          total: validation.rows.length,
          message: `Reusing downloaded buffer for ${row.productName || row.imageRef || row.productId || row.offerId}...`,
          stage: 'downloading'
        })
      } else {
        // 1. SSRF Guard
        const ssrfCheck = await validateSsrfSafeUrl(row.imageUrl)
        if (!ssrfCheck.valid) {
          throw new Error(`SSRF guard blocked destination: ${ssrfCheck.reason}`)
        }

        // 2. Fetch image with limits (10s timeout, max 10MB)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const response = await fetch(row.imageUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'WifranCatalogBot/2.0 (Product Image Enrichment)'
          }
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`HTTP fetch failed with status ${response.status} ${response.statusText}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        buffer = Buffer.from(arrayBuffer)

        if (buffer.length > 10 * 1024 * 1024) {
          throw new Error(`Image size (${buffer.length} bytes) exceeds 10MB limit.`)
        }

        // 3. Magic bytes validation
        const detectedMime = detectImageMimeType(buffer)
        if (!detectedMime) {
          throw new Error('Image format unsupported or invalid magic bytes. Only JPEG, PNG, or WebP are permitted.')
        }
        detected = detectedMime
        downloadCache.set(normalizedSource, { buffer, detected })
      }

      // 4. Content SHA-256
      const contentSha256 = crypto.createHash('sha256').update(buffer).digest('hex')

      if (row.targetKind === 'offer') {
        const offerId = row.offerId!

        // 5a. Deduplication check: Is exact hash already linked to this offer?
        const { data: alreadyLinkedOffer } = await supabase
          .from('offer_display_images')
          .select('id, storage_bucket, storage_object_path, public_url')
          .eq('offer_id', offerId)
          .eq('content_sha256', contentSha256)
          .eq('approval_status', 'approved')
          .limit(1)

        if (alreadyLinkedOffer && alreadyLinkedOffer.length > 0) {
          result.skippedCount++
          result.results.push({
            offerId,
            imageRef: row.imageRef,
            targetKind: 'offer',
            status: 'skipped',
            publicUrl: alreadyLinkedOffer[0].public_url,
            storagePath: alreadyLinkedOffer[0].storage_object_path,
            error: 'Image already associated with offer'
          })
          if (removeOfferRef(offerId, refMap)) {
            mapModified = true
          }
          input.onProgress?.({
            current: index,
            total: validation.rows.length,
            message: `Skipped reference ${row.imageRef || offerId} (hash already linked to offer)`,
            stage: 'skipped'
          })
          continue
        }

        // 5b. Storage reuse check across offer_display_images
        let storagePath = `offers/${contentSha256}.${detected.ext}`
        let publicUrl: string
        let isReused = false

        const { data: existingOfferAsset } = await supabase
          .from('offer_display_images')
          .select('id, storage_bucket, storage_object_path, public_url')
          .eq('content_sha256', contentSha256)
          .eq('approval_status', 'approved')
          .limit(1)

        if (existingOfferAsset && existingOfferAsset.length > 0) {
          isReused = true
          storagePath = existingOfferAsset[0].storage_object_path
          publicUrl = existingOfferAsset[0].public_url
        } else {
          const { error: uploadErr } = await supabase.storage
            .from('offer-display-images')
            .upload(storagePath, buffer, {
              contentType: detected.mimeType,
              upsert: true
            })

          if (uploadErr) {
            throw new Error(`Supabase storage upload failed: ${uploadErr.message}`)
          }

          const { data: pubUrlData } = supabase.storage
            .from('offer-display-images')
            .getPublicUrl(storagePath)

          publicUrl = pubUrlData.publicUrl
        }

        // 6a. Record approved display image in public.offer_display_images
        const visualSubjectKey = row.visualSubjectKey || 'generic'

        const { data: activeOfferImage } = await supabase
          .from('offer_display_images')
          .select('id')
          .eq('offer_id', offerId)
          .eq('approval_status', 'approved')
          .limit(1)

        if (activeOfferImage && activeOfferImage.length > 0) {
          const { error: updateErr } = await supabase
            .from('offer_display_images')
            .update({
              storage_bucket: 'offer-display-images',
              storage_object_path: storagePath,
              public_url: publicUrl,
              mime_type: detected.mimeType,
              byte_size: buffer.length,
              content_sha256: contentSha256,
              source_url: row.imageUrl,
              normalized_source_url: normalizedSource,
              visual_subject_key: visualSubjectKey,
              rights_basis: rightsBasis,
              reviewed_by: reviewedBy,
              reviewed_at: new Date().toISOString()
            })
            .eq('id', activeOfferImage[0].id)

          if (updateErr) {
            throw new Error(`Failed to update offer display image: ${updateErr.message}`)
          }
        } else {
          const { error: insertErr } = await supabase
            .from('offer_display_images')
            .insert({
              offer_id: offerId,
              storage_bucket: 'offer-display-images',
              storage_object_path: storagePath,
              public_url: publicUrl,
              mime_type: detected.mimeType,
              byte_size: buffer.length,
              content_sha256: contentSha256,
              source_kind: 'generated_illustration',
              source_url: row.imageUrl,
              normalized_source_url: normalizedSource,
              visual_subject_key: visualSubjectKey,
              approval_status: 'approved',
              rights_basis: rightsBasis,
              reviewed_by: reviewedBy,
              reviewed_at: new Date().toISOString()
            })

          if (insertErr) {
            throw new Error(`Failed to insert offer display image: ${insertErr.message}`)
          }
        }

        // 7a. Propagate display image to group members in offer_visual_group_members
        const { data: groupMembers } = await supabase
          .from('offer_visual_group_members')
          .select('member_offer_id')
          .eq('representative_offer_id', offerId)

        if (groupMembers && groupMembers.length > 0) {
          for (const gm of groupMembers) {
            const memberId = gm.member_offer_id
            const { data: memActive } = await supabase
              .from('offer_display_images')
              .select('id, content_sha256')
              .eq('offer_id', memberId)
              .eq('approval_status', 'approved')
              .limit(1)

            if (memActive && memActive.length > 0) {
              if (memActive[0].content_sha256 !== contentSha256) {
                await supabase
                  .from('offer_display_images')
                  .update({
                    storage_bucket: 'offer-display-images',
                    storage_object_path: storagePath,
                    public_url: publicUrl,
                    mime_type: detected.mimeType,
                    byte_size: buffer.length,
                    content_sha256: contentSha256,
                    source_url: row.imageUrl,
                    normalized_source_url: normalizedSource,
                    visual_subject_key: visualSubjectKey,
                    rights_basis: rightsBasis,
                    reviewed_by: reviewedBy,
                    reviewed_at: new Date().toISOString()
                  })
                  .eq('id', memActive[0].id)
              }
            } else {
              await supabase
                .from('offer_display_images')
                .insert({
                  offer_id: memberId,
                  storage_bucket: 'offer-display-images',
                  storage_object_path: storagePath,
                  public_url: publicUrl,
                  mime_type: detected.mimeType,
                  byte_size: buffer.length,
                  content_sha256: contentSha256,
                  source_kind: 'generated_illustration',
                  source_url: row.imageUrl,
                  normalized_source_url: normalizedSource,
                  visual_subject_key: visualSubjectKey,
                  approval_status: 'approved',
                  rights_basis: rightsBasis,
                  reviewed_by: reviewedBy,
                  reviewed_at: new Date().toISOString()
                })
            }
          }
        }

        // Cleanup local temporary short-ID mapping upon successful offer image association
        if (removeOfferRef(offerId, refMap)) {
          mapModified = true
        }
        if (groupMembers && groupMembers.length > 0) {
          for (const gm of groupMembers) {
            if (removeOfferRef(gm.member_offer_id, refMap)) {
              mapModified = true
            }
          }
        }

        if (isReused) {
          result.reusedCount++
          result.results.push({
            offerId,
            imageRef: row.imageRef,
            targetKind: 'offer',
            status: 'reused',
            publicUrl,
            storagePath
          })
        } else {
          result.uploadedCount++
          result.results.push({
            offerId,
            imageRef: row.imageRef,
            targetKind: 'offer',
            status: 'uploaded',
            publicUrl,
            storagePath
          })
        }

        input.onProgress?.({
          current: index,
          total: validation.rows.length,
          message: `${isReused ? 'Reused' : 'Uploaded'} illustrative visual for ${row.imageRef || offerId}`,
          stage: 'completed'
        })
      } else {
        // Product routing (row.targetKind === 'product')
        const productId = Number(row.productId)

        // 5b. Deduplication check: Is exact hash already linked to this product?
        const { data: alreadyLinkedProd } = await supabase
          .from('product_images')
          .select('id, storage_bucket, storage_object_path, public_url')
          .eq('product_id', productId)
          .eq('content_sha256', contentSha256)
          .eq('approval_status', 'approved')
          .limit(1)

        if (alreadyLinkedProd && alreadyLinkedProd.length > 0) {
          result.skippedCount++
          result.results.push({
            productId,
            imageRef: row.imageRef,
            targetKind: 'product',
            status: 'skipped',
            publicUrl: alreadyLinkedProd[0].public_url,
            storagePath: alreadyLinkedProd[0].storage_object_path,
            error: 'Image already associated with product'
          })
          input.onProgress?.({
            current: index,
            total: validation.rows.length,
            message: `Skipped reference ${row.imageRef || productId} (hash already linked to product)`,
            stage: 'skipped'
          })
          continue
        }

        // Storage reuse check
        let storagePath = `catalog/${contentSha256}.${detected.ext}`
        let publicUrl: string
        let isReused = false

        const { data: existingImage } = await supabase
          .from('product_images')
          .select('id, storage_bucket, storage_object_path, public_url')
          .eq('content_sha256', contentSha256)
          .eq('approval_status', 'approved')
          .limit(1)

        if (existingImage && existingImage.length > 0) {
          isReused = true
          storagePath = existingImage[0].storage_object_path
          publicUrl = existingImage[0].public_url
        } else {
          const { error: uploadErr } = await supabase.storage
            .from('product-images')
            .upload(storagePath, buffer, {
              contentType: detected.mimeType,
              upsert: true
            })

          if (uploadErr) {
            throw new Error(`Supabase storage upload failed: ${uploadErr.message}`)
          }

          const { data: pubUrlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(storagePath)

          publicUrl = pubUrlData.publicUrl
        }

        // Check if an approved primary image already exists:
        const { data: activePrimary } = await supabase
          .from('product_images')
          .select('id')
          .eq('product_id', productId)
          .eq('role', 'primary')
          .eq('approval_status', 'approved')
          .limit(1)

        let primaryImageId: string
        if (activePrimary && activePrimary.length > 0) {
          const { error: updateImgErr } = await supabase
            .from('product_images')
            .update({
              storage_bucket: 'product-images',
              storage_object_path: storagePath,
              public_url: publicUrl,
              mime_type: detected.mimeType,
              byte_size: buffer.length,
              content_sha256: contentSha256,
              source_url: row.imageUrl,
              normalized_source_url: normalizedSource,
              rights_basis: rightsBasis,
              reviewed_by: reviewedBy,
              reviewed_at: new Date().toISOString()
            })
            .eq('id', activePrimary[0].id)

          if (updateImgErr) {
            throw new Error(`Failed to update product image in database: ${updateImgErr.message}`)
          }
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
              mime_type: detected.mimeType,
              byte_size: buffer.length,
              content_sha256: contentSha256,
              source_url: row.imageUrl,
              normalized_source_url: normalizedSource,
              approval_status: 'approved',
              rights_basis: rightsBasis,
              reviewed_by: reviewedBy,
              reviewed_at: new Date().toISOString()
            })
            .select('id')
            .single()

          if (imgErr) {
            throw new Error(`Failed to record product image in database: ${imgErr.message}`)
          }
          primaryImageId = insertedImg.id
        }

        // Update products.approved_primary_image_id
        const { error: prodUpdateErr } = await supabase
          .from('products')
          .update({
            approved_primary_image_id: primaryImageId,
            default_image_url: publicUrl
          })
          .eq('id', productId)

        if (prodUpdateErr) {
          throw new Error(`Failed to link approved image to product: ${prodUpdateErr.message}`)
        }

        if (isReused) {
          result.reusedCount++
          result.results.push({
            productId,
            imageRef: row.imageRef,
            targetKind: 'product',
            status: 'reused',
            publicUrl,
            storagePath
          })
        } else {
          result.uploadedCount++
          result.results.push({
            productId,
            imageRef: row.imageRef,
            targetKind: 'product',
            status: 'uploaded',
            publicUrl,
            storagePath
          })
        }

        input.onProgress?.({
          current: index,
          total: validation.rows.length,
          message: `${isReused ? 'Reused' : 'Uploaded'} image for ${row.imageRef || productId}`,
          stage: 'completed'
        })
      }
    } catch (err: any) {
      result.failedCount++
      result.results.push({
        productId: row.productId,
        offerId: row.offerId,
        imageRef: row.imageRef,
        targetKind: row.targetKind,
        status: 'failed',
        error: err.message
      })
      input.onProgress?.({
        current: index,
        total: validation.rows.length,
        message: `Failed for ${row.imageRef || row.productId || row.offerId}: ${err.message}`,
        stage: 'failed'
      })
    }
  }

  if (mapModified) {
    await saveOfferRefMap(refMap, input.mapFilePath)
  }

  result.success = result.uploadedCount + result.reusedCount
  result.skipped = result.skippedCount
  result.errors = result.failedCount

  return result
}
