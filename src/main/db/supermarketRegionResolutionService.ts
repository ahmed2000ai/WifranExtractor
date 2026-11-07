import crypto from 'crypto'
import path from 'path'
import { getSupabaseAdminClient } from './supabaseAdminClient'
import { MASTER_SUPERMARKETS, MASTER_REGIONS, MASTER_CITIES } from './referenceDataService'

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

/**
 * Normalizes text for comparison across English and Arabic:
 * - Lowercases and trims
 * - Normalizes Arabic letter variants (أ|إ|آ|ٱ -> ا, ة -> ه, ى -> ي)
 * - Strips Arabic tashkeel (diacritics) and tatweel (ـ)
 * - Normalizes multiple spaces and punctuation
 */
export function normalizeEntityText(raw: string): string {
  if (!raw) return ''
  let text = String(raw).trim().toLowerCase()

  // Remove Arabic diacritics / tashkeel (\u064B to \u065F, \u0670)
  text = text.replace(/[\u064B-\u065F\u0670]/g, '')
  // Remove tatweel (\u0640)
  text = text.replace(/\u0640/g, '')

  // Normalize Arabic letters
  text = text.replace(/[أإآٱ]/g, 'ا')
  text = text.replace(/ة/g, 'ه')
  text = text.replace(/ى/g, 'ي')

  // Normalize unicode punctuation and hyphens
  text = text.replace(/[\u2010-\u2015\u2212]/g, '-')
  // Replace punctuation with spaces except hyphens
  text = text.replace(/[,._/\\()[\]{}'"`:;!?]/g, ' ')
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim()

  return text
}

// Supermarket noise words in English and Arabic (Unicode-aware boundary)
const SUPERMARKET_NOISE_REGEX =
  /(?<![\p{L}\p{N}])(?:hypermarket|supermarket|hyper|super|markets|market|superstores|stores|store|company|co|llc|ksa|saudi|branch|هايبر|سوبرماركت|سوبر\s*ماركت|ماركت|أسواق|اسواق|سوق|متاجر|متجر|شركة|شركه|مؤسسة|مؤسسه|فرع|تخفيضات|عروض|مركز)(?![\p{L}\p{N}])/giu

/**
 * Strips generic store noise words so slight variations never duplicate entries.
 */
export function stripSupermarketNoiseWords(text: string): string {
  const norm = normalizeEntityText(text)
  const stripped = norm.replace(SUPERMARKET_NOISE_REGEX, ' ').replace(/\s+/g, ' ').trim()
  return stripped || norm
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
 * Bilingual synonym dictionary for common Saudi supermarkets.
 */
export const SUPERMARKET_SYNONYMS: Record<string, { slug: string; name_en: string; name_ar: string }> = {
  // Panda
  panda: { slug: 'panda', name_en: 'Panda', name_ar: 'بنده' },
  بنده: { slug: 'panda', name_en: 'Panda', name_ar: 'بنده' },
  'hyper panda': { slug: 'panda', name_en: 'Panda', name_ar: 'بنده' },
  'هايبر بنده': { slug: 'panda', name_en: 'Panda', name_ar: 'بنده' },
  'اسواق بنده': { slug: 'panda', name_en: 'Panda', name_ar: 'بنده' },
  'أسواق بنده': { slug: 'panda', name_en: 'Panda', name_ar: 'بنده' },
  'panda supermarket': { slug: 'panda', name_en: 'Panda', name_ar: 'بنده' },
  // Danube
  danube: { slug: 'danube', name_en: 'Danube', name_ar: 'الدانوب' },
  الدانوب: { slug: 'danube', name_en: 'Danube', name_ar: 'الدانوب' },
  دانوب: { slug: 'danube', name_en: 'Danube', name_ar: 'الدانوب' },
  // Othaim
  othaim: { slug: 'othaim', name_en: 'Othaim Markets', name_ar: 'أسواق العثيم' },
  العثيم: { slug: 'othaim', name_en: 'Othaim Markets', name_ar: 'أسواق العثيم' },
  عثيم: { slug: 'othaim', name_en: 'Othaim Markets', name_ar: 'أسواق العثيم' },
  // Carrefour
  carrefour: { slug: 'carrefour', name_en: 'Carrefour', name_ar: 'كارفور' },
  كارفور: { slug: 'carrefour', name_en: 'Carrefour', name_ar: 'كارفور' },
  // LuLu
  lulu: { slug: 'lulu', name_en: 'LuLu Hypermarket', name_ar: 'لولو هايبر ماركت' },
  لولو: { slug: 'lulu', name_en: 'LuLu Hypermarket', name_ar: 'لولو هايبر ماركت' },
  // BinDawood
  'bin-dawood': { slug: 'bin-dawood', name_en: 'BinDawood', name_ar: 'بن داود' },
  bindawood: { slug: 'bin-dawood', name_en: 'BinDawood', name_ar: 'بن داود' },
  'بن داود': { slug: 'bin-dawood', name_en: 'BinDawood', name_ar: 'بن داود' },
  'بن داوود': { slug: 'bin-dawood', name_en: 'BinDawood', name_ar: 'بن داود' },
  // Tamimi
  tamimi: { slug: 'tamimi', name_en: 'Tamimi Markets', name_ar: 'أسواق التميمي' },
  التميمي: { slug: 'tamimi', name_en: 'Tamimi Markets', name_ar: 'أسواق التميمي' },
  تميمي: { slug: 'tamimi', name_en: 'Tamimi Markets', name_ar: 'أسواق التميمي' },
  // Alwafa
  alwafa: { slug: 'alwafa', name_en: 'Hyper Alwafa', name_ar: 'هايبر الوفاء' },
  'al-wafa': { slug: 'alwafa', name_en: 'Hyper Alwafa', name_ar: 'هايبر الوفاء' },
  'al wafa': { slug: 'alwafa', name_en: 'Hyper Alwafa', name_ar: 'هايبر الوفاء' },
  wafa: { slug: 'alwafa', name_en: 'Hyper Alwafa', name_ar: 'هايبر الوفاء' },
  الوفاء: { slug: 'alwafa', name_en: 'Hyper Alwafa', name_ar: 'هايبر الوفاء' },
  وفاء: { slug: 'alwafa', name_en: 'Hyper Alwafa', name_ar: 'هايبر الوفاء' },
  // Nesto
  nesto: { slug: 'nesto', name_en: 'Nesto Hypermarket', name_ar: 'نستو هايبرماركت' },
  نستو: { slug: 'nesto', name_en: 'Nesto Hypermarket', name_ar: 'نستو هايبرماركت' },
  // Manuel
  manuel: { slug: 'manuel', name_en: 'Manuel Market', name_ar: 'مانويل' },
  مانويل: { slug: 'manuel', name_en: 'Manuel Market', name_ar: 'مانويل' },
  // Raya
  raya: { slug: 'raya', name_en: 'Al Raya Markets', name_ar: 'أسواق الراية' },
  الراية: { slug: 'raya', name_en: 'Al Raya Markets', name_ar: 'أسواق الراية' },
  رايه: { slug: 'raya', name_en: 'Al Raya Markets', name_ar: 'أسواق الراية' },
  // Farm
  farm: { slug: 'farm', name_en: 'Farm Superstores', name_ar: 'أسواق المزرعة' },
  المزرعة: { slug: 'farm', name_en: 'Farm Superstores', name_ar: 'أسواق المزرعة' },
  مزرعه: { slug: 'farm', name_en: 'Farm Superstores', name_ar: 'أسواق المزرعة' },
  // Al Ahlam
  'al-ahlam': { slug: 'al-ahlam', name_en: 'Al Ahlam', name_ar: 'الأحلام' },
  'al ahlam': { slug: 'al-ahlam', name_en: 'Al Ahlam', name_ar: 'الأحلام' },
  ahlam: { slug: 'al-ahlam', name_en: 'Al Ahlam', name_ar: 'الأحلام' },
  الاحلام: { slug: 'al-ahlam', name_en: 'Al Ahlam', name_ar: 'الأحلام' },
  الأحلام: { slug: 'al-ahlam', name_en: 'Al Ahlam', name_ar: 'الأحلام' },
  // Noori
  noori: { slug: 'noori', name_en: 'Noori Supermarket', name_ar: 'أسواق نوري' },
  'noori supermarket': { slug: 'noori', name_en: 'Noori Supermarket', name_ar: 'أسواق نوري' },
  نوري: { slug: 'noori', name_en: 'Noori Supermarket', name_ar: 'أسواق نوري' },
  'اسواق نوري': { slug: 'noori', name_en: 'Noori Supermarket', name_ar: 'أسواق نوري' },
  'أسواق نوري': { slug: 'noori', name_en: 'Noori Supermarket', name_ar: 'أسواق نوري' }
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
