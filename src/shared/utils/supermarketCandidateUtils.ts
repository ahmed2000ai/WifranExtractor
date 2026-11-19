/**
 * Browser-safe utilities for normalizing supermarket names, matching catalog entries,
 * generating ASCII slugs for Arabic/Latin names, and building pending catalog items
 * before database publishing.
 */

export interface SupermarketCatalogCandidate {
  id: string;
  name_en?: string | null;
  name_ar?: string | null;
  slug?: string | null;
  code?: string | null;
  is_active?: boolean;
  pendingCatalogCreation?: boolean;
}

export interface SupermarketSynonymEntry {
  slug: string;
  name_en: string;
  name_ar: string;
}

/**
 * Normalizes text for comparison across English and Arabic:
 * - Lowercases and trims
 * - Normalizes Arabic letter variants (أ|إ|آ|ٱ -> ا, ة -> ه, ى -> ي)
 * - Strips Arabic tashkeel (diacritics) and tatweel (ـ)
 * - Normalizes multiple spaces and punctuation
 */
export function normalizeEntityText(raw: string): string {
  if (!raw) return '';
  let text = String(raw).trim().toLowerCase();

  // Remove Arabic diacritics / tashkeel (\u064B to \u065F, \u0670)
  text = text.replace(/[\u064B-\u065F\u0670]/g, '');
  // Remove tatweel (\u0640)
  text = text.replace(/\u0640/g, '');

  // Normalize Arabic letters
  text = text.replace(/[أإآٱ]/g, 'ا');
  text = text.replace(/ة/g, 'ه');
  text = text.replace(/ى/g, 'ي');

  // Normalize unicode punctuation and hyphens
  text = text.replace(/[\u2010-\u2015\u2212]/g, '-');
  // Replace punctuation with spaces except hyphens
  text = text.replace(/[,._/\\()[\]{}'"`:;!?]/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

// Supermarket noise words in English and Arabic (Unicode-aware boundary)
const SUPERMARKET_NOISE_REGEX =
  /(?<![\p{L}\p{N}])(?:hypermarket|supermarket|hyper|super|markets|market|superstores|stores|store|company|co|llc|ksa|saudi|branch|هايبرماركت|هايبر\s*ماركت|هايبر|سوبرماركت|سوبر\s*ماركت|ماركت|أسواق|اسواق|سوق|متاجر|متجر|شركة|شركه|مؤسسة|مؤسسه|فرع|تخفيضات|عروض|مركز)(?![\p{L}\p{N}])/giu;

/**
 * Strips generic store noise words so slight variations never duplicate entries.
 */
export function stripSupermarketNoiseWords(text: string): string {
  const norm = normalizeEntityText(text);
  const stripped = norm.replace(SUPERMARKET_NOISE_REGEX, ' ').replace(/\s+/g, ' ').trim();
  return stripped || norm;
}

/**
 * Bilingual synonym dictionary for common Saudi supermarkets.
 */
export const SUPERMARKET_SYNONYMS: Record<string, SupermarketSynonymEntry> = {
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
  'أسواق نوري': { slug: 'noori', name_en: 'Noori Supermarket', name_ar: 'أسواق نوري' },
  // Dukan
  dukan: { slug: 'dukan', name_en: 'Dukan', name_ar: 'الدكان' },
  الدكان: { slug: 'dukan', name_en: 'Dukan', name_ar: 'الدكان' },
  دكان: { slug: 'dukan', name_en: 'Dukan', name_ar: 'الدكان' },
  'موقع الدكان': { slug: 'dukan', name_en: 'Dukan', name_ar: 'الدكان' },
  'اسواق الدكان': { slug: 'dukan', name_en: 'Dukan', name_ar: 'الدكان' },
  'أسواق الدكان': { slug: 'dukan', name_en: 'Dukan', name_ar: 'الدكان' },
  'متجر الدكان': { slug: 'dukan', name_en: 'Dukan', name_ar: 'الدكان' }
};

const ARABIC_CHAR_TRANSLIT_MAP: Record<string, string> = {
  '\u0627': 'a', // ا
  '\u0623': 'a', // أ
  '\u0625': 'i', // إ
  '\u0622': 'a', // آ
  '\u0671': 'a', // ٱ
  '\u0621': '',  // ء
  '\u0624': 'w', // ؤ
  '\u0626': 'y', // ئ
  '\u0628': 'b', // ب
  '\u062a': 't', // ت
  '\u062b': 'th', // ث
  '\u062c': 'j', // ج
  '\u062d': 'h', // ح
  '\u062e': 'kh', // خ
  '\u062f': 'd', // د
  '\u0630': 'dh', // ذ
  '\u0631': 'r', // ر
  '\u0632': 'z', // ز
  '\u0633': 's', // س
  '\u0634': 'sh', // ش
  '\u0635': 's', // ص
  '\u0636': 'd', // ض
  '\u0637': 't', // ط
  '\u0638': 'z', // ظ
  '\u0639': 'a', // ع
  '\u063a': 'gh', // غ
  '\u0641': 'f', // ف
  '\u0642': 'q', // ق
  '\u0643': 'k', // ك
  '\u0644': 'l', // ل
  '\u0645': 'm', // م
  '\u0646': 'n', // ن
  '\u0647': 'h', // ه
  '\u0629': 'a', // ة
  '\u0648': 'w', // و
  '\u064a': 'y', // ي
  '\u0649': 'a', // ى
  '\u0660': '0',
  '\u0661': '1',
  '\u0662': '2',
  '\u0663': '3',
  '\u0664': '4',
  '\u0665': '5',
  '\u0666': '6',
  '\u0667': '7',
  '\u0668': '8',
  '\u0669': '9',
  '\u06f0': '0',
  '\u06f1': '1',
  '\u06f2': '2',
  '\u06f3': '3',
  '\u06f4': '4',
  '\u06f5': '5',
  '\u06f6': '6',
  '\u06f7': '7',
  '\u06f8': '8',
  '\u06f9': '9'
};

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function titleCase(str: string): string {
  return str
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function cleanString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function lookupSupermarketSynonym(rawName?: string | null): SupermarketSynonymEntry | null {
  const input = cleanString(rawName);
  if (!input) return null;

  const normInput = normalizeEntityText(input);
  const strippedInput = stripSupermarketNoiseWords(input);

  return (
    SUPERMARKET_SYNONYMS[normInput] ||
    SUPERMARKET_SYNONYMS[strippedInput] ||
    SUPERMARKET_SYNONYMS[normInput.replace(/\s+/g, '-')] ||
    SUPERMARKET_SYNONYMS[strippedInput.replace(/\s+/g, '-')] ||
    null
  );
}

/**
 * Produces a deterministic URL/storage-safe ASCII slug `[a-z0-9-]+`
 * for English or Arabic supermarket names, with hash fallback if empty.
 */
export function toAsciiSlug(rawName: string, fallbackPrefix = 'sm'): string {
  const input = cleanString(rawName);
  if (!input) {
    return `${fallbackPrefix}-supermarket`;
  }

  const synonym = lookupSupermarketSynonym(input);
  if (synonym?.slug) {
    return synonym.slug;
  }

  const stripped = stripSupermarketNoiseWords(input) || normalizeEntityText(input) || input.toLowerCase();
  const rawChars = Array.from(stripped.trim().toLowerCase());
  const transliterated = rawChars
    .map((ch) => {
      if (/[a-z0-9]/.test(ch)) return ch;
      if (ch in ARABIC_CHAR_TRANSLIT_MAP) return ARABIC_CHAR_TRANSLIT_MAP[ch];
      if (/[\s-]/.test(ch)) return '-';
      return '-';
    })
    .join('');

  const asciiSlug = transliterated
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (asciiSlug.length >= 2) {
    return asciiSlug;
  }

  return `${fallbackPrefix}-${fnv1aHex(normalizeEntityText(input) || input)}`;
}

/**
 * Generates a browser-safe UUID v4 without importing Node `crypto`.
 */
export function generateUuidV4(): string {
  const webCrypto = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Matches a candidate supermarket against an existing catalog list by ID,
 * synonym slug, ASCII slug, or normalized/noise-stripped English/Arabic names.
 */
export function findMatchingCatalogSupermarket<T extends SupermarketCatalogCandidate>(
  candidate: {
    detectedName?: string | null;
    resolvedRetailerId?: string | null;
    resolvedSlug?: string | null;
    resolvedNameEn?: string | null;
    resolvedNameAr?: string | null;
  },
  catalog: readonly T[]
): T | undefined {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return undefined;
  }

  if (candidate.resolvedRetailerId) {
    const byId = catalog.find((s) => s.id === candidate.resolvedRetailerId);
    if (byId) return byId;
  }

  const probeTexts = [
    cleanString(candidate.detectedName),
    cleanString(candidate.resolvedNameEn),
    cleanString(candidate.resolvedNameAr),
    cleanString(candidate.resolvedSlug)
  ].filter(Boolean);

  const candidateSlugs = new Set<string>();
  const normalizedTargets = new Set<string>();
  const strippedTargets = new Set<string>();

  if (cleanString(candidate.resolvedSlug)) {
    candidateSlugs.add(cleanString(candidate.resolvedSlug).toLowerCase());
  }

  for (const probe of probeTexts) {
    const syn = lookupSupermarketSynonym(probe);
    if (syn?.slug) candidateSlugs.add(syn.slug.toLowerCase());
    const ascii = toAsciiSlug(probe);
    if (ascii) candidateSlugs.add(ascii.toLowerCase());
    const norm = normalizeEntityText(probe);
    const stripped = stripSupermarketNoiseWords(probe);
    if (norm) normalizedTargets.add(norm);
    if (stripped) strippedTargets.add(stripped);
  }

  return catalog.find((entry) => {
    const entrySlug = cleanString(entry.slug).toLowerCase();
    if (entrySlug && candidateSlugs.has(entrySlug)) {
      return true;
    }

    const entryNames = [cleanString(entry.name_en), cleanString(entry.name_ar)].filter(Boolean);
    for (const rawName of entryNames) {
      const normName = normalizeEntityText(rawName);
      const strippedName = stripSupermarketNoiseWords(rawName);
      if (normalizedTargets.has(normName) || strippedTargets.has(normName)) {
        return true;
      }
      if (strippedName && (normalizedTargets.has(strippedName) || strippedTargets.has(strippedName))) {
        return true;
      }
    }

    return false;
  });
}

export interface PendingSupermarketCatalogEntry extends SupermarketCatalogCandidate {
  id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
  pendingCatalogCreation: boolean;
}

export interface ParsedBilingualSupermarketInput {
  detectedName: string;
  resolvedNameEn?: string;
  resolvedNameAr?: string;
  hasExplicitBilingualPair: boolean;
}

export interface RetailerCandidatePromptSource {
  detectedName?: string | null;
  resolvedRetailerId?: string | null;
  resolvedSlug?: string | null;
  resolvedNameEn?: string | null;
  resolvedNameAr?: string | null;
  pendingCatalogCreation?: boolean;
  evidenceText?: string | null;
  status?: string | null;
}

export interface RawMetadataEvidenceItem {
  field?: string | null;
  method?: string | null;
}

const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF]/;

/**
 * Parses operator input that may be a single supermarket name (English or Arabic)
 * or a slash-separated bilingual pair such as "Dukan / الدكان" or "الدكان / Dukan".
 */
export function parseBilingualSupermarketInput(rawInput: string): ParsedBilingualSupermarketInput {
  const trimmed = cleanString(rawInput);
  if (!trimmed) {
    return { detectedName: '', hasExplicitBilingualPair: false };
  }

  const slashParts = trimmed
    .split(/\s*\/\s*/)
    .map(cleanString)
    .filter(Boolean);

  if (slashParts.length === 2) {
    const [left, right] = slashParts;
    const leftHasArabic = ARABIC_SCRIPT_REGEX.test(left);
    const rightHasArabic = ARABIC_SCRIPT_REGEX.test(right);

    if (!leftHasArabic && rightHasArabic) {
      return {
        detectedName: trimmed,
        resolvedNameEn: left,
        resolvedNameAr: right,
        hasExplicitBilingualPair: true
      };
    }

    if (leftHasArabic && !rightHasArabic) {
      return {
        detectedName: trimmed,
        resolvedNameEn: right,
        resolvedNameAr: left,
        hasExplicitBilingualPair: true
      };
    }
  }

  return {
    detectedName: trimmed,
    hasExplicitBilingualPair: false
  };
}

/**
 * Extracts API/discovered retailer fields while stripping out unrelated manual
 * catalog overrides (e.g. wrongly confirmed Farm Superstores over detected الدكان)
 * or purely manual dropdown selections when no API branding was discovered.
 */
export function extractApiDetectedRetailerCandidate(
  retailerCandidate?: RetailerCandidatePromptSource | null,
  rawEvidence?: readonly RawMetadataEvidenceItem[] | null
): {
  detectedName: string;
  resolvedSlug?: string;
  resolvedNameEn?: string;
  resolvedNameAr?: string;
} | null {
  if (!retailerCandidate) return null;

  const rawDetected = cleanString(retailerCandidate.detectedName);
  const rawSlug = cleanString(retailerCandidate.resolvedSlug);
  const rawEn = cleanString(retailerCandidate.resolvedNameEn);
  const rawAr = cleanString(retailerCandidate.resolvedNameAr);

  if (!rawDetected && !rawEn && !rawAr) {
    return null;
  }

  if (retailerCandidate.resolvedRetailerId) {
    const resolvedMatchesDetected = rawDetected
      ? Boolean(
          findMatchingCatalogSupermarket(
            { detectedName: rawDetected },
            [
              {
                id: retailerCandidate.resolvedRetailerId,
                slug: rawSlug,
                name_en: rawEn,
                name_ar: rawAr
              }
            ]
          )
        )
      : true;

    if (!resolvedMatchesDetected && rawDetected) {
      return { detectedName: rawDetected };
    }

    const hasNonManualRetailerEvidence = Array.isArray(rawEvidence)
      ? rawEvidence.some((e) => e?.field === 'retailer' && e?.method && e.method !== 'operator_manual')
      : false;

    const isPureManualSelection =
      retailerCandidate.evidenceText === 'Operator entered manually' &&
      !retailerCandidate.pendingCatalogCreation &&
      !hasNonManualRetailerEvidence &&
      (!rawDetected ||
        rawDetected.toLowerCase() === rawEn.toLowerCase() ||
        rawDetected === rawAr ||
        rawDetected === cleanString(retailerCandidate.resolvedRetailerId));

    if (isPureManualSelection) {
      return null;
    }
  }

  return {
    detectedName: rawDetected || rawEn || rawAr,
    ...(rawSlug ? { resolvedSlug: rawSlug } : {}),
    ...(rawEn ? { resolvedNameEn: rawEn } : {}),
    ...(rawAr ? { resolvedNameAr: rawAr } : {})
  };
}

/**
 * Formats the default pre-fill value for the "New supermarket..." prompt input
 * using the AR/EN retailer name returned by API discovery when available.
 */
export function getDefaultNewSupermarketPromptValue(
  retailerCandidate?: RetailerCandidatePromptSource | null,
  rawEvidence?: readonly RawMetadataEvidenceItem[] | null
): string {
  const apiCandidate = extractApiDetectedRetailerCandidate(retailerCandidate, rawEvidence);
  if (!apiCandidate) return '';

  const parsedDetected = parseBilingualSupermarketInput(apiCandidate.detectedName);
  const synonym =
    lookupSupermarketSynonym(apiCandidate.detectedName) ||
    lookupSupermarketSynonym(apiCandidate.resolvedNameEn) ||
    lookupSupermarketSynonym(apiCandidate.resolvedNameAr) ||
    lookupSupermarketSynonym(apiCandidate.resolvedSlug);

  const detectedIsArabic = ARABIC_SCRIPT_REGEX.test(apiCandidate.detectedName);
  const detectedIsLatinOnly =
    Boolean(apiCandidate.detectedName) && !detectedIsArabic && /[A-Za-z]/.test(apiCandidate.detectedName);

  const nameEn =
    cleanString(apiCandidate.resolvedNameEn) ||
    parsedDetected.resolvedNameEn ||
    synonym?.name_en ||
    (detectedIsLatinOnly ? apiCandidate.detectedName : '');

  const nameAr =
    cleanString(apiCandidate.resolvedNameAr) ||
    parsedDetected.resolvedNameAr ||
    synonym?.name_ar ||
    (detectedIsArabic ? apiCandidate.detectedName : '');

  if (nameEn && nameAr && nameEn.toLowerCase() !== nameAr.toLowerCase()) {
    return `${nameEn} / ${nameAr}`;
  }

  return nameEn || nameAr || apiCandidate.detectedName || '';
}

/**
 * Builds a deterministic pending catalog entry for an unmatched detected retailer
 * so the UI can immediately add and select it locally with zero DB writes until publish.
 */
export function buildPendingSupermarketCatalogEntry(params: {
  detectedName?: string | null;
  resolvedSlug?: string | null;
  resolvedNameEn?: string | null;
  resolvedNameAr?: string | null;
  preferExplicitNames?: boolean;
  existingCatalog?: readonly SupermarketCatalogCandidate[];
  existingId?: string | null;
}): {
  entry: PendingSupermarketCatalogEntry;
  alreadyInCatalog: boolean;
} {
  const existingCatalog = params.existingCatalog || [];
  const matchedExisting = findMatchingCatalogSupermarket(
    {
      detectedName: params.detectedName,
      resolvedSlug: params.resolvedSlug,
      resolvedNameEn: params.resolvedNameEn,
      resolvedNameAr: params.resolvedNameAr,
      resolvedRetailerId: params.existingId
    },
    existingCatalog
  );

  if (matchedExisting) {
    const fallbackSlug = cleanString(matchedExisting.slug) || toAsciiSlug(matchedExisting.name_en || matchedExisting.name_ar || params.detectedName || 'supermarket');
    const fallbackEn = cleanString(matchedExisting.name_en) || titleCase(fallbackSlug.replace(/-/g, ' '));
    const fallbackAr = cleanString(matchedExisting.name_ar) || cleanString(params.detectedName) || fallbackEn;
    return {
      entry: {
        ...matchedExisting,
        id: matchedExisting.id,
        slug: fallbackSlug,
        name_en: fallbackEn,
        name_ar: fallbackAr,
        is_active: matchedExisting.is_active !== false,
        pendingCatalogCreation: Boolean(matchedExisting.pendingCatalogCreation)
      },
      alreadyInCatalog: true
    };
  }

  const detected = cleanString(params.detectedName);
  const explicitEn = cleanString(params.resolvedNameEn);
  const explicitAr = cleanString(params.resolvedNameAr);
  const preferExplicit = Boolean(params.preferExplicitNames);

  const synonym =
    lookupSupermarketSynonym(detected) ||
    lookupSupermarketSynonym(explicitEn) ||
    lookupSupermarketSynonym(explicitAr) ||
    lookupSupermarketSynonym(params.resolvedSlug);

  const explicitAsciiSlug = cleanString(params.resolvedSlug).toLowerCase();
  const slug =
    (!preferExplicit ? synonym?.slug : '') ||
    (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(explicitAsciiSlug) ? explicitAsciiSlug : '') ||
    toAsciiSlug(explicitEn || detected || explicitAr || 'supermarket');

  const isArabicDetected = ARABIC_SCRIPT_REGEX.test(detected);
  const fallbackEnFromSlug = titleCase(slug.replace(/-/g, ' '));
  const name_en = preferExplicit
    ? (explicitEn || synonym?.name_en || (!isArabicDetected && detected ? titleCase(detected) : fallbackEnFromSlug) || 'Custom Supermarket')
    : (synonym?.name_en || explicitEn || (!isArabicDetected && detected ? titleCase(detected) : fallbackEnFromSlug) || 'Custom Supermarket');

  const name_ar = preferExplicit
    ? (explicitAr || synonym?.name_ar || (isArabicDetected && detected ? detected : detected || name_en))
    : (synonym?.name_ar || explicitAr || (isArabicDetected && detected ? detected : detected || name_en));

  return {
    entry: {
      id: cleanString(params.existingId) || generateUuidV4(),
      slug,
      name_en,
      name_ar,
      is_active: true,
      pendingCatalogCreation: true
    },
    alreadyInCatalog: false
  };
}

/**
 * Merges catalog lists while deduplicating by `id` and `slug`.
 * Authoritative entries (where `pendingCatalogCreation !== true`) replace pending ones
 * if they share an `id` or `slug`.
 */
export function mergeSupermarketCatalogLists<T extends SupermarketCatalogCandidate>(
  ...lists: Array<readonly T[] | null | undefined>
): T[] {
  const merged: T[] = [];
  const indexById = new Map<string, number>();
  const indexBySlug = new Map<string, number>();

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || !cleanString(item.id)) continue;
      const idKey = cleanString(item.id).toLowerCase();
      const slugKey = cleanString(item.slug).toLowerCase();
      const existingIdxById = indexById.get(idKey);
      const existingIdxBySlug = slugKey ? indexBySlug.get(slugKey) : undefined;
      const existingIdx = existingIdxById !== undefined ? existingIdxById : existingIdxBySlug;

      if (existingIdx !== undefined) {
        const existing = merged[existingIdx];
        // Prefer non-pending authoritative catalog entry over a local pending one
        if (existing.pendingCatalogCreation && !item.pendingCatalogCreation) {
          merged[existingIdx] = item;
          indexById.set(idKey, existingIdx);
          if (slugKey) indexBySlug.set(slugKey, existingIdx);
        }
        continue;
      }

      const nextIndex = merged.length;
      merged.push(item);
      indexById.set(idKey, nextIndex);
      if (slugKey) indexBySlug.set(slugKey, nextIndex);
    }
  }

  return merged;
}
