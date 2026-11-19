import crypto from 'crypto'
import path from 'path'
import { getSupabaseAdminClient } from './supabaseAdminClient'
import { MASTER_SUPERMARKETS, MASTER_REGIONS, MASTER_CITIES } from './referenceDataService'
import { assertNotOfflineUat } from '../config/offlineUatGuard'
import {
  normalizeEntityText,
  stripSupermarketNoiseWords,
  SUPERMARKET_SYNONYMS,
  toAsciiSlug
} from '../../shared/utils/supermarketCandidateUtils'

export { normalizeEntityText, stripSupermarketNoiseWords, SUPERMARKET_SYNONYMS }

export interface ResolvedEntity {
  id: string
  slug: string
  name_en: string
  name_ar: string
  isNew: boolean
}

export interface ResolveEntityOptions {
  supabaseClient?: any
}

export interface EnsureSupermarketOnPublishDescriptor {
  id: string
  slug?: string | null
  name_en?: string | null
  name_ar?: string | null
}

export interface EnsureSupermarketOnPublishResult {
  supermarketId: string
  slug: string
  name_en: string
  name_ar: string
  created: boolean
}

// Region and City noise words in English and Arabic (Unicode-aware boundary)
const REGION_NOISE_REGEX =
  /(?<![\p{L}\p{N}])(?:region|city|province|governorate|district|area|zone|state|ksa|saudi|منطقة|منطقه|مدينة|مدينه|محافظة|محافظه|حي|اقليم|إقليم|مركز)(?![\p{L}\p{N}])/giu

/**
 * Strips generic region/city noise words so slight variations never duplicate entries.
 */
export function stripRegionNoiseWords(text: string): string {
  const norm = normalizeEntityText(text)
  const stripped = norm.replace(REGION_NOISE_REGEX, ' ').replace(/\s+/g, ' ').trim()
  return stripped || norm
}

/**
 * Bilingual synonym dictionary for common Saudi regions and cities.
 */
export const REGION_SYNONYMS: Record<string, { slug: string; name_en: string; name_ar: string }> = {
  // Jeddah
  jeddah: { slug: 'jeddah', name_en: 'Jeddah', name_ar: 'جدة' },
  جدة: { slug: 'jeddah', name_en: 'Jeddah', name_ar: 'جدة' },
  جده: { slug: 'jeddah', name_en: 'Jeddah', name_ar: 'جدة' },
  'jeddah city': { slug: 'jeddah', name_en: 'Jeddah', name_ar: 'جدة' },
  'مدينة جدة': { slug: 'jeddah', name_en: 'Jeddah', name_ar: 'جدة' },
  'مدينه جده': { slug: 'jeddah', name_en: 'Jeddah', name_ar: 'جدة' },
  // Riyadh
  riyadh: { slug: 'riyadh', name_en: 'Riyadh', name_ar: 'الرياض' },
  الرياض: { slug: 'riyadh', name_en: 'Riyadh', name_ar: 'الرياض' },
  رياض: { slug: 'riyadh', name_en: 'Riyadh', name_ar: 'الرياض' },
  // Dammam
  dammam: { slug: 'dammam', name_en: 'Dammam', name_ar: 'الدمام' },
  الدمام: { slug: 'dammam', name_en: 'Dammam', name_ar: 'الدمام' },
  دمام: { slug: 'dammam', name_en: 'Dammam', name_ar: 'الدمام' },
  // Makkah
  makkah: { slug: 'makkah', name_en: 'Makkah', name_ar: 'مكة المكرمة' },
  mecca: { slug: 'makkah', name_en: 'Makkah', name_ar: 'مكة المكرمة' },
  مكة: { slug: 'makkah', name_en: 'Makkah', name_ar: 'مكة المكرمة' },
  مكه: { slug: 'makkah', name_en: 'Makkah', name_ar: 'مكة المكرمة' },
  // Madinah
  madinah: { slug: 'madinah', name_en: 'Madinah', name_ar: 'المدينة المنورة' },
  medina: { slug: 'madinah', name_en: 'Madinah', name_ar: 'المدينة المنورة' },
  المدينة: { slug: 'madinah', name_en: 'Madinah', name_ar: 'المدينة المنورة' },
  المدينه: { slug: 'madinah', name_en: 'Madinah', name_ar: 'المدينة المنورة' },
  // Commercial Regions
  eastern: { slug: 'eastern', name_en: 'Eastern Region', name_ar: 'المنطقة الشرقية' },
  الشرقية: { slug: 'eastern', name_en: 'Eastern Region', name_ar: 'المنطقة الشرقية' },
  الشرقيه: { slug: 'eastern', name_en: 'Eastern Region', name_ar: 'المنطقة الشرقية' },
  western: { slug: 'western', name_en: 'Western Region', name_ar: 'المنطقة الغربية' },
  الغربية: { slug: 'western', name_en: 'Western Region', name_ar: 'المنطقة الغربية' },
  الغربيه: { slug: 'western', name_en: 'Western Region', name_ar: 'المنطقة الغربية' },
  central: { slug: 'central', name_en: 'Central Region', name_ar: 'المنطقة الوسطى' },
  الوسطى: { slug: 'central', name_en: 'Central Region', name_ar: 'المنطقة الوسطى' },
  الوسطي: { slug: 'central', name_en: 'Central Region', name_ar: 'المنطقة الوسطى' },
  southern: { slug: 'southern', name_en: 'Southern Region', name_ar: 'المنطقة الجنوبية' },
  الجنوبية: { slug: 'southern', name_en: 'Southern Region', name_ar: 'المنطقة الجنوبية' },
  الجنوبيه: { slug: 'southern', name_en: 'Southern Region', name_ar: 'المنطقة الجنوبية' },
  northern: { slug: 'northern', name_en: 'Northern Region', name_ar: 'المنطقة الشمالية' },
  الشمالية: { slug: 'northern', name_en: 'Northern Region', name_ar: 'المنطقة الشمالية' },
  الشماليه: { slug: 'northern', name_en: 'Northern Region', name_ar: 'المنطقة الشمالية' },
  // Other Cities
  abha: { slug: 'abha', name_en: 'Abha', name_ar: 'أبها' },
  أبها: { slug: 'abha', name_en: 'Abha', name_ar: 'أبها' },
  ابها: { slug: 'abha', name_en: 'Abha', name_ar: 'أبها' },
  tabuk: { slug: 'tabuk', name_en: 'Tabuk', name_ar: 'تبوك' },
  تبوك: { slug: 'tabuk', name_en: 'Tabuk', name_ar: 'تبوك' },
  taif: { slug: 'taif', name_en: 'Taif', name_ar: 'الطائف' },
  الطائف: { slug: 'taif', name_en: 'Taif', name_ar: 'الطائف' },
  الطايف: { slug: 'taif', name_en: 'Taif', name_ar: 'الطائف' },
  qassim: { slug: 'qassim', name_en: 'Al Qassim', name_ar: 'القصيم' },
  القصيم: { slug: 'qassim', name_en: 'Al Qassim', name_ar: 'القصيم' },
  قصيم: { slug: 'qassim', name_en: 'Al Qassim', name_ar: 'القصيم' },
  khobar: { slug: 'khobar', name_en: 'Khobar', name_ar: 'الخبر' },
  الخبر: { slug: 'khobar', name_en: 'Khobar', name_ar: 'الخبر' },
  khamis: { slug: 'khamis-mushait', name_en: 'Khamis Mushait', name_ar: 'خميس مشيط' },
  'khamis-mushait': { slug: 'khamis-mushait', name_en: 'Khamis Mushait', name_ar: 'خميس مشيط' },
  'خميس مشيط': { slug: 'khamis-mushait', name_en: 'Khamis Mushait', name_ar: 'خميس مشيط' },
  // Neom
  neom: { slug: 'neom', name_en: 'Neom', name_ar: 'نيوم' },
  نيوم: { slug: 'neom', name_en: 'Neom', name_ar: 'نيوم' }
}

function createCanonicalSlug(raw: string, fallbackPrefix: string): string {
  const norm = normalizeEntityText(raw)
  const slug = norm
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug || `${fallbackPrefix}-${Date.now()}`
}

function titleCase(str: string): string {
  return str
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ''))
    .join(' ')
}

/**
 * Ensures an operator-confirmed pending supermarket exists in `public.supermarkets` at publish time.
 * Uses read-then-write lookup by `id` and `slug` so existing DB IDs take precedence without `23505` slug collisions.
 */
export async function ensureConfirmedSupermarketExistsInDb(
  descriptor: EnsureSupermarketOnPublishDescriptor,
  options?: ResolveEntityOptions
): Promise<EnsureSupermarketOnPublishResult> {
  const id = (descriptor.id || '').trim()
  if (!id) {
    throw new Error('Confirmed supermarket ID cannot be empty on publish.')
  }

  if (!options?.supabaseClient) {
    assertNotOfflineUat('Database supermarket creation on publish')
  }

  const supabase = options?.supabaseClient || getSupabaseAdminClient()
  const rawSlug = (descriptor.slug || '').trim().toLowerCase()
  const targetSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawSlug)
    ? rawSlug
    : toAsciiSlug(descriptor.name_en || descriptor.name_ar || id)
  const targetNameEn = (descriptor.name_en || '').trim() || titleCase(targetSlug.replace(/-/g, ' '))
  const targetNameAr = (descriptor.name_ar || '').trim() || targetNameEn

  const { data: idRows, error: idErr } = await supabase
    .from('supermarkets')
    .select('id, slug, name_en, name_ar')
    .eq('id', id)
    .limit(1)

  if (idErr) {
    throw new Error(`Failed to verify supermarket '${id}' in database: ${idErr.message || String(idErr)}`)
  }
  if (Array.isArray(idRows) && idRows.length > 0) {
    return {
      supermarketId: String(idRows[0].id),
      slug: idRows[0].slug || targetSlug,
      name_en: idRows[0].name_en || targetNameEn,
      name_ar: idRows[0].name_ar || targetNameAr,
      created: false
    }
  }

  const { data: slugRows, error: slugErr } = await supabase
    .from('supermarkets')
    .select('id, slug, name_en, name_ar')
    .eq('slug', targetSlug)
    .limit(1)

  if (slugErr) {
    throw new Error(`Failed to check existing supermarket slug '${targetSlug}' in database: ${slugErr.message || String(slugErr)}`)
  }
  if (Array.isArray(slugRows) && slugRows.length > 0) {
    return {
      supermarketId: String(slugRows[0].id),
      slug: slugRows[0].slug || targetSlug,
      name_en: slugRows[0].name_en || targetNameEn,
      name_ar: slugRows[0].name_ar || targetNameAr,
      created: false
    }
  }

  const newRecord = {
    id,
    slug: targetSlug,
    name_en: targetNameEn,
    name_ar: targetNameAr,
    is_active: true
  }

  const supermarketsTable = supabase.from('supermarkets')
  const writeResult =
    typeof supermarketsTable.upsert === 'function'
      ? await supermarketsTable.upsert([newRecord], { onConflict: 'id' })
      : await supermarketsTable.insert([newRecord])

  const writeErr = writeResult?.error
  if (writeErr) {
    const errMsg = writeErr.message || String(writeErr)
    const isUniqueConflict =
      writeErr.code === '23505' ||
      errMsg.includes('23505') ||
      errMsg.toLowerCase().includes('duplicate')

    if (isUniqueConflict) {
      const { data: retrySlugRows } = await supabase
        .from('supermarkets')
        .select('id, slug, name_en, name_ar')
        .eq('slug', targetSlug)
        .limit(1)
      if (Array.isArray(retrySlugRows) && retrySlugRows.length > 0) {
        return {
          supermarketId: String(retrySlugRows[0].id),
          slug: retrySlugRows[0].slug || targetSlug,
          name_en: retrySlugRows[0].name_en || targetNameEn,
          name_ar: retrySlugRows[0].name_ar || targetNameAr,
          created: false
        }
      }
    }

    throw new Error(`Failed to create supermarket '${targetNameEn}' (${targetSlug}) in database on publish: ${errMsg}`)
  }

  return {
    supermarketId: id,
    slug: targetSlug,
    name_en: targetNameEn,
    name_ar: targetNameAr,
    created: true
  }
}

/**
 * Deterministically resolves an incoming raw supermarket name to an existing DB record,
 * or inserts a new clean record if none exists.
 */
export async function resolveOrCreateSupermarket(
  rawName: string,
  options?: ResolveEntityOptions
): Promise<ResolvedEntity> {
  const input = (rawName || '').trim()
  if (!input) {
    throw new Error('Supermarket name cannot be empty.')
  }

  const supabase = options?.supabaseClient || getSupabaseAdminClient()
  const normInput = normalizeEntityText(input)
  const strippedInput = stripSupermarketNoiseWords(input)

  // 1. Check synonym dictionary
  const synonymMatch =
    SUPERMARKET_SYNONYMS[normInput] ||
    SUPERMARKET_SYNONYMS[strippedInput] ||
    SUPERMARKET_SYNONYMS[normInput.replace(/\s+/g, '-')] ||
    SUPERMARKET_SYNONYMS[strippedInput.replace(/\s+/g, '-')]

  const targetSlug = synonymMatch?.slug || null
  const canonicalSlug = targetSlug || createCanonicalSlug(strippedInput || normInput, 'supermarket')
  const isArabicInput = /[\u0600-\u06FF]/.test(input)
  const nameEn = synonymMatch?.name_en || (isArabicInput ? titleCase(canonicalSlug.replace(/-/g, ' ')) : titleCase(input))
  const nameAr = synonymMatch?.name_ar || (isArabicInput ? input : nameEn)

  // 2. Query DB supermarkets
  let dbRecords: any[] = []
  try {
    const { data, error } = await supabase.from('supermarkets').select('id, name_en, name_ar, slug')
    if (!error && Array.isArray(data)) {
      dbRecords = data
    }
  } catch (err) {
    console.warn('[supermarketResolution] Failed to fetch supermarkets from DB:', err)
  }

  // 3. Search DB records for existing match
  let matchedRecord = dbRecords.find((r) => {
    // Exact ID
    if (r.id === input) return true
    // Matched by synonym slug
    if (targetSlug && r.slug === targetSlug) return true
    // Match by slug directly
    if (r.slug === normInput || r.slug === strippedInput) return true

    // Match by name_en
    const normEn = normalizeEntityText(r.name_en || '')
    const strippedEn = stripSupermarketNoiseWords(r.name_en || '')
    if (normEn === normInput || normEn === strippedInput) return true
    if (strippedEn && (strippedEn === normInput || strippedEn === strippedInput)) return true

    // Match by name_ar
    const normAr = normalizeEntityText(r.name_ar || '')
    const strippedAr = stripSupermarketNoiseWords(r.name_ar || '')
    if (normAr === normInput || normAr === strippedInput) return true
    if (strippedAr && (strippedAr === normInput || strippedAr === strippedInput)) return true

    return false
  })

  if (matchedRecord) {
    return {
      id: String(matchedRecord.id),
      slug: matchedRecord.slug,
      name_en: matchedRecord.name_en,
      name_ar: matchedRecord.name_ar,
      isNew: false
    }
  }

  // 4. Check MASTER_SUPERMARKETS constants
  const masterMatch = MASTER_SUPERMARKETS.find((m) => {
    if (targetSlug && m.slug === targetSlug) return true
    if (m.slug === normInput || m.slug === strippedInput) return true
    const normEn = normalizeEntityText(m.name_en || '')
    const strippedEn = stripSupermarketNoiseWords(m.name_en || '')
    if (normEn === normInput || normEn === strippedInput || strippedEn === strippedInput) return true
    const normAr = normalizeEntityText(m.name_ar || '')
    const strippedAr = stripSupermarketNoiseWords(m.name_ar || '')
    if (normAr === normInput || normAr === strippedInput || strippedAr === strippedInput) return true
    return false
  })

  if (masterMatch) {
    // Try to seed into DB if missing
    try {
      await supabase.from('supermarkets').upsert([masterMatch], { onConflict: 'slug' })
    } catch {
      // ignore
    }
    return {
      id: masterMatch.id,
      slug: masterMatch.slug || canonicalSlug,
      name_en: masterMatch.name_en || nameEn,
      name_ar: masterMatch.name_ar || nameAr,
      isNew: false
    }
  }

  // 5. Genuinely brand-new supermarket: create deterministically
  // Check if a record with this slug was created in concurrent/prior run
  const existingBySlug = dbRecords.find((r) => r.slug === canonicalSlug)
  if (existingBySlug) {
    return {
      id: String(existingBySlug.id),
      slug: existingBySlug.slug,
      name_en: existingBySlug.name_en,
      name_ar: existingBySlug.name_ar,
      isNew: false
    }
  }

  const newId = crypto.randomUUID()

  const newRecord = {
    id: newId,
    slug: canonicalSlug,
    name_en: nameEn,
    name_ar: nameAr,
    is_active: true
  }

  try {
    const { error: insertErr } = await supabase.from('supermarkets').insert([newRecord])
    if (insertErr) {
      console.warn('[supermarketResolution] Insert supermarket warning:', insertErr.message)
    }
  } catch (err) {
    console.warn('[supermarketResolution] Insert supermarket error:', err)
  }

  return {
    id: newId,
    slug: canonicalSlug,
    name_en: nameEn,
    name_ar: nameAr,
    isNew: true
  }
}

/**
 * Deterministically resolves an incoming raw region/city name to an existing DB record,
 * or inserts a new clean record if none exists.
 */
export async function resolveOrCreateRegion(
  rawRegion: string,
  options?: ResolveEntityOptions
): Promise<ResolvedEntity> {
  const input = (rawRegion || '').trim()
  if (!input) {
    throw new Error('Region name cannot be empty.')
  }

  const supabase = options?.supabaseClient || getSupabaseAdminClient()
  const normInput = normalizeEntityText(input)
  const strippedInput = stripRegionNoiseWords(input)

  // 1. Check synonym dictionary
  const synonymMatch =
    REGION_SYNONYMS[normInput] ||
    REGION_SYNONYMS[strippedInput] ||
    REGION_SYNONYMS[normInput.replace(/\s+/g, '-')] ||
    REGION_SYNONYMS[strippedInput.replace(/\s+/g, '-')]

  const targetSlug = synonymMatch?.slug || null
  const canonicalSlug = targetSlug || createCanonicalSlug(strippedInput || normInput, 'region')
  const isArabicInput = /[\u0600-\u06FF]/.test(input)
  const nameEn = synonymMatch?.name_en || (isArabicInput ? titleCase(canonicalSlug.replace(/-/g, ' ')) : titleCase(input))
  const nameAr = synonymMatch?.name_ar || (isArabicInput ? input : nameEn)

  // 2. Query DB regions
  let dbRecords: any[] = []
  try {
    const { data, error } = await supabase.from('regions').select('id, name_en, name_ar, slug')
    if (!error && Array.isArray(data)) {
      dbRecords = data
    }
  } catch (err) {
    console.warn('[regionResolution] Failed to fetch regions from DB:', err)
  }

  // 3. Search DB records for existing match
  let matchedRecord = dbRecords.find((r) => {
    // Exact ID
    if (r.id === input) return true
    // Matched by synonym slug
    if (targetSlug && r.slug === targetSlug) return true
    // Match by slug directly
    if (r.slug === normInput || r.slug === strippedInput) return true

    // Match by name_en
    const normEn = normalizeEntityText(r.name_en || '')
    const strippedEn = stripRegionNoiseWords(r.name_en || '')
    if (normEn === normInput || normEn === strippedInput) return true
    if (strippedEn && (strippedEn === normInput || strippedEn === strippedInput)) return true

    // Match by name_ar
    const normAr = normalizeEntityText(r.name_ar || '')
    const strippedAr = stripRegionNoiseWords(r.name_ar || '')
    if (normAr === normInput || normAr === strippedInput) return true
    if (strippedAr && (strippedAr === normInput || strippedAr === strippedInput)) return true

    return false
  })

  if (matchedRecord) {
    return {
      id: String(matchedRecord.id),
      slug: matchedRecord.slug,
      name_en: matchedRecord.name_en,
      name_ar: matchedRecord.name_ar,
      isNew: false
    }
  }

  // 4. Check MASTER_REGIONS and MASTER_CITIES
  const masterRegionMatch = MASTER_REGIONS.find((m) => {
    if (targetSlug && m.slug === targetSlug) return true
    if (m.slug === normInput || m.slug === strippedInput) return true
    const normEn = normalizeEntityText(m.name_en || '')
    const strippedEn = stripRegionNoiseWords(m.name_en || '')
    if (normEn === normInput || normEn === strippedInput || strippedEn === strippedInput) return true
    const normAr = normalizeEntityText(m.name_ar || '')
    const strippedAr = stripRegionNoiseWords(m.name_ar || '')
    if (normAr === normInput || normAr === strippedInput || strippedAr === strippedInput) return true
    return false
  })

  if (masterRegionMatch) {
    try {
      await supabase.from('regions').upsert([masterRegionMatch], { onConflict: 'slug' })
    } catch {
      // ignore
    }
    return {
      id: masterRegionMatch.id,
      slug: masterRegionMatch.slug || 'region',
      name_en: masterRegionMatch.name_en || nameEn,
      name_ar: masterRegionMatch.name_ar || nameAr,
      isNew: false
    }
  }

  // Check MASTER_CITIES (e.g. if city name was passed like Jeddah or Riyadh)
  const masterCityMatch = MASTER_CITIES.find((c) => {
    if (targetSlug && c.slug === targetSlug) return true
    if (c.slug === normInput || c.slug === strippedInput) return true
    const normEn = normalizeEntityText(c.name_en || '')
    const strippedEn = stripRegionNoiseWords(c.name_en || '')
    if (normEn === normInput || normEn === strippedInput || strippedEn === strippedInput) return true
    const normAr = normalizeEntityText(c.name_ar || '')
    const strippedAr = stripRegionNoiseWords(c.name_ar || '')
    if (normAr === normInput || normAr === strippedInput || strippedAr === strippedInput) return true
    return false
  })

  if (masterCityMatch) {
    // If city has parent region_id in MASTER_REGIONS
    const parentRegion = MASTER_REGIONS.find((r) => r.id === masterCityMatch.region_id)
    return {
      id: masterCityMatch.id,
      slug: masterCityMatch.slug || 'city',
      name_en: parentRegion?.name_en || masterCityMatch.name_en || nameEn,
      name_ar: parentRegion?.name_ar || masterCityMatch.name_ar || nameAr,
      isNew: false
    }
  }

  // 5. Genuinely brand-new region: create deterministically
  const existingBySlug = dbRecords.find((r) => r.slug === canonicalSlug)
  if (existingBySlug) {
    return {
      id: String(existingBySlug.id),
      slug: existingBySlug.slug,
      name_en: existingBySlug.name_en,
      name_ar: existingBySlug.name_ar,
      isNew: false
    }
  }

  const newId = crypto.randomUUID()

  const newRecord = {
    id: newId,
    slug: canonicalSlug,
    name_en: nameEn,
    name_ar: nameAr,
    is_active: true
  }

  try {
    const { error: insertErr } = await supabase.from('regions').insert([newRecord])
    if (insertErr) {
      console.warn('[regionResolution] Insert region warning:', insertErr.message)
    }
  } catch (err) {
    console.warn('[regionResolution] Insert region error:', err)
  }

  return {
    id: newId,
    slug: canonicalSlug,
    name_en: nameEn,
    name_ar: nameAr,
    isNew: true
  }
}

/**
 * Parses leaflet PDF filename following the pattern: SupermarketName-LeafletNo-Region.pdf
 * where SupermarketName and Region may contain multiple hyphenated segments,
 * and LeafletNo is the numeric segment separating them.
 * e.g., 'Al-Wafa-04-Jeddah.pdf', 'Hyper-Panda-102-Western-Region.pdf', 'Al-Wafa-Hypermarket-12-Jeddah.pdf'.
 */
export function parseLeafletFilenameMetadata(pdfFileNameOrPath: string): {
  rawSupermarketName: string | null
  leafletNumber: string | null
  rawRegionName: string | null
} {
  if (!pdfFileNameOrPath) {
    return { rawSupermarketName: null, leafletNumber: null, rawRegionName: null }
  }

  const baseName = path.basename(pdfFileNameOrPath).replace(/\.[^.]+$/, '').trim()
  if (!baseName) {
    return { rawSupermarketName: null, leafletNumber: null, rawRegionName: null }
  }

  const segments = baseName.split('-').map((s) => s.trim()).filter(Boolean)
  if (segments.length < 3) {
    return { rawSupermarketName: null, leafletNumber: null, rawRegionName: null }
  }

  // Locate the first segment that represents the leaflet number
  // e.g. matches /^\d+[a-zA-Z]*$/ or /^(?:no|num|w|wk|issue)?\d+$/i
  const leafletNoPattern = /^(?:no|num|w|wk|issue)?\d+[a-zA-Z]*$/i
  let numericIndex = -1

  for (let i = 1; i < segments.length - 1; i++) {
    if (leafletNoPattern.test(segments[i])) {
      numericIndex = i
      break
    }
  }

  if (numericIndex === -1) {
    return { rawSupermarketName: null, leafletNumber: null, rawRegionName: null }
  }

  const rawSupermarketName = segments.slice(0, numericIndex).join(' ').trim() || null
  const leafletNumber = segments[numericIndex]
  const rawRegionName = segments.slice(numericIndex + 1).join(' ').trim() || null

  return {
    rawSupermarketName,
    leafletNumber,
    rawRegionName
  }
}
