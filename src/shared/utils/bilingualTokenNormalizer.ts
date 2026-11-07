/**
 * Safe, Deterministic Bilingual Token Normalization and Word-Order Invariance Engine
 * Milestone 2B: WIFRAN-EXTRACTOR-IDENTITY-002B
 *
 * Provides deterministic, reusable tokenization for Arabic and English grocery product names,
 * curated dictionary normalization, and word-order invariant token bag comparison.
 * Strictly prevents attribute confusion (e.g. Full Fat vs Low Fat, Fresh vs Long Life,
 * Sella vs Plain Basmati) and preserves Phase 1 and 2A false-positive safeguards.
 */

import { normalizeArabicNumerals } from './priceAndUnitNormalizer'
import {
  normalizeMeasurement,
  getEquivalentMeasurements
} from './unitEquivalence'

export type TokenCategory = 'brand' | 'commodity' | 'modifier' | 'cut' | 'package_form' | 'raw'

export interface CuratedDictionaryEntry {
  canonicalId: string
  category: TokenCategory
  arabicForms: string[]
  englishForms: string[]
  description: string
}

export interface CanonicalToken {
  id: string              // e.g. "brand:nadec", "mod:full_fat", "com:milk", "meas:1000ml"
  category: TokenCategory | 'measurement'
  displayEn: string       // canonical English representation
  displayAr: string       // canonical Arabic representation
  rawValue: string        // original matched string
}

export interface NormalizedTokenBag {
  originalText: string
  normalizedText: string
  tokens: CanonicalToken[]
  tokenIds: string[]      // sorted unique list of canonical token IDs (for order invariance)
  tokenMultiSet: Record<string, number> // token multiplicity map
  brandId: string | null
  commodityId: string | null
  fatContentId: 'full_fat' | 'low_fat' | 'skimmed' | null
  preservationId: 'fresh' | 'long_life' | 'frozen' | 'chilled' | null
  cutId: string | null
  grainVariantId: string | null
  measurementToken: string | null // e.g. "meas:1000ml" or "meas:600g"
  unknownTokens: string[]         // unrecognized meaningful tokens (preserved for safety)
}

export interface TokenBagCompatibilityResult {
  isCompatible: boolean
  similarityScore: number // Jaccard similarity [0.0 - 1.0]
  sharedTokens: string[]
  offerOnlyTokens: string[]
  productOnlyTokens: string[]
  conflicts: string[]
  reason: string
}

/**
 * Static, Curated Bilingual Dictionary.
 * Explicitly verified mappings for brands, commodities, and modifiers.
 */
export const CURATED_BILINGUAL_DICTIONARY: CuratedDictionaryEntry[] = [
  // -------------------------------------------------------------
  // 1. Brands (category: 'brand')
  // -------------------------------------------------------------
  {
    canonicalId: 'nadec',
    category: 'brand',
    arabicForms: ['نادك'],
    englishForms: ['nadec'],
    description: 'National Agricultural Development Company (Nadec)'
  },
  {
    canonicalId: 'almarai',
    category: 'brand',
    arabicForms: ['المراعي'],
    englishForms: ['almarai', 'al-marai', 'marai', 'almaray'],
    description: 'Almarai Company'
  },
  {
    canonicalId: 'sunbulah',
    category: 'brand',
    arabicForms: ['السنبلة', 'سنبلة'],
    englishForms: ['sunbulah', 'al sunbulah', 'al-sunbulah'],
    description: 'Sunbulah Group (Frozen Foods & Pastry)'
  },
  {
    canonicalId: 'alsafi',
    category: 'brand',
    arabicForms: ['الصافي', 'الصافي دانون'],
    englishForms: ['alsafi', 'al-safi', 'safi', 'al safi'],
    description: 'Al Safi / Al Safi Danone'
  },
  {
    canonicalId: 'fakieh',
    category: 'brand',
    arabicForms: ['فقيه', 'دواجن فقيه'],
    englishForms: ['fakieh', 'fakieh poultry'],
    description: 'Fakieh Poultry Farms'
  },
  {
    canonicalId: 'alshalan',
    category: 'brand',
    arabicForms: ['الشعلان'],
    englishForms: ['alshalan', 'al-shalan', 'shalan', 'al shalan'],
    description: 'Al Shalan Rice'
  },
  {
    canonicalId: 'alwafa',
    category: 'brand',
    arabicForms: ['الوفاء', 'هايبر الوفاء'],
    englishForms: ['alwafa', 'al-wafa', 'wafa', 'al wafa'],
    description: 'Al Wafa Hypermarket / Brand'
  },
  {
    canonicalId: 'tanmiah',
    category: 'brand',
    arabicForms: ['تنمية', 'التنمية'],
    englishForms: ['tanmiah', 'al-tanmiah'],
    description: 'Tanmiah Food Company'
  },
  {
    canonicalId: 'dinar',
    category: 'brand',
    arabicForms: ['دينار'],
    englishForms: ['dinar'],
    description: 'Dinar Brand'
  },
  {
    canonicalId: 'abu_kass',
    category: 'brand',
    arabicForms: ['أبو كاس', 'ابو كاس'],
    englishForms: ['abu kass', 'abukass', 'abu-kass'],
    description: 'Abu Kass Basmati Rice'
  },
  {
    canonicalId: 'bab_alhind',
    category: 'brand',
    arabicForms: ['باب الهند'],
    englishForms: ['bab alhind', 'bab al-hind', 'bab al hind'],
    description: 'Bab Al Hind Basmati Rice'
  },
  {
    canonicalId: 'dunya',
    category: 'brand',
    arabicForms: ['دنيا'],
    englishForms: ['dunya'],
    description: 'Dunya Brand'
  },

  // -------------------------------------------------------------
  // 2. Commodities (category: 'commodity')
  // -------------------------------------------------------------
  {
    canonicalId: 'milk',
    category: 'commodity',
    arabicForms: ['حليب', 'لبن'],
    englishForms: ['milk'],
    description: 'Cow milk / dairy liquid milk'
  },
  {
    canonicalId: 'rice',
    category: 'commodity',
    arabicForms: ['أرز', 'ارز', 'رز'],
    englishForms: ['rice'],
    description: 'Rice grain'
  },
  {
    canonicalId: 'chicken',
    category: 'commodity',
    arabicForms: ['دجاج', 'فروج'],
    englishForms: ['chicken', 'poultry'],
    description: 'Chicken meat'
  },
  {
    canonicalId: 'egg',
    category: 'commodity',
    arabicForms: ['بيض'],
    englishForms: ['egg', 'eggs'],
    description: 'Table eggs'
  },
  {
    canonicalId: 'oil',
    category: 'commodity',
    arabicForms: ['زيت'],
    englishForms: ['oil'],
    description: 'Cooking / vegetable / olive oil'
  },
  {
    canonicalId: 'sugar',
    category: 'commodity',
    arabicForms: ['سكر'],
    englishForms: ['sugar'],
    description: 'Refined sugar'
  },
  {
    canonicalId: 'tea',
    category: 'commodity',
    arabicForms: ['شاي'],
    englishForms: ['tea'],
    description: 'Tea leaves / tea bags'
  },
  {
    canonicalId: 'coffee',
    category: 'commodity',
    arabicForms: ['قهوة', 'بن'],
    englishForms: ['coffee'],
    description: 'Coffee / coffee beans'
  },
  {
    canonicalId: 'cheese',
    category: 'commodity',
    arabicForms: ['جبن', 'جبنة', 'أجبان', 'اجبان'],
    englishForms: ['cheese'],
    description: 'Dairy cheese'
  },
  {
    canonicalId: 'butter',
    category: 'commodity',
    arabicForms: ['زبدة'],
    englishForms: ['butter'],
    description: 'Dairy butter'
  },
  {
    canonicalId: 'yogurt',
    category: 'commodity',
    arabicForms: ['زبادي', 'روب'],
    englishForms: ['yogurt', 'yoghurt'],
    description: 'Fermented yogurt'
  },
  {
    canonicalId: 'water',
    category: 'commodity',
    arabicForms: ['مياه', 'ماء'],
    englishForms: ['water'],
    description: 'Bottled drinking water'
  },
  {
    canonicalId: 'juice',
    category: 'commodity',
    arabicForms: ['عصير'],
    englishForms: ['juice'],
    description: 'Fruit juice'
  },
  {
    canonicalId: 'puff_pastry',
    category: 'commodity',
    arabicForms: ['بف بيستري', 'عجينة بف بيستري', 'رقائق بف بيستري', 'فطائر'],
    englishForms: ['puff pastry', 'puff pastry dough', 'pastry'],
    description: 'Puff pastry dough sheets and squares'
  },
  {
    canonicalId: 'square',
    category: 'package_form',
    arabicForms: ['مربعات', 'مربع'],
    englishForms: ['square', 'squares'],
    description: 'Square cut dough / pastry sheets'
  },
  {
    canonicalId: 'sheet',
    category: 'package_form',
    arabicForms: ['شيت', 'شيتات', 'شرائح', 'شريحة'],
    englishForms: ['sheet', 'sheets'],
    description: 'Dough / pastry continuous sheet'
  },

  // -------------------------------------------------------------
  // 3. Fat Content Modifiers (category: 'modifier')
  // -------------------------------------------------------------
  {
    canonicalId: 'full_fat',
    category: 'modifier',
    arabicForms: ['كامل الدسم', 'كامل دسم'],
    englishForms: ['full fat', 'full cream', 'whole milk', 'fullfat'],
    description: 'Full fat / whole fat dairy product'
  },
  {
    canonicalId: 'low_fat',
    category: 'modifier',
    arabicForms: ['قليل الدسم', 'قليل دسم', 'لايت'],
    englishForms: ['low fat', 'light', 'semi skimmed', 'lowfat', 'lite'],
    description: 'Low fat / semi-skimmed dairy product'
  },
  {
    canonicalId: 'skimmed',
    category: 'modifier',
    arabicForms: ['خالي الدسم', 'خالي دسم', 'منزوع الدسم', 'بدون دسم'],
    englishForms: ['skimmed', 'fat free', 'zero fat', 'non fat', 'non-fat', 'fatfree'],
    description: 'Skimmed / non-fat / fat-free dairy product'
  },

  // -------------------------------------------------------------
  // 4. Preservation & Thermal Processing (category: 'modifier')
  // -------------------------------------------------------------
  {
    canonicalId: 'long_life',
    category: 'modifier',
    arabicForms: ['طويل الأجل', 'طويل الاجل', 'طويل أجل', 'طويل اجل'],
    englishForms: ['long life', 'longlife', 'uht'],
    description: 'Ultra-High Temperature (UHT) long-life processing'
  },
  {
    canonicalId: 'fresh',
    category: 'modifier',
    arabicForms: ['طازج', 'طازجة'],
    englishForms: ['fresh'],
    description: 'Fresh / short-shelf-life product'
  },
  {
    canonicalId: 'frozen',
    category: 'modifier',
    arabicForms: ['مجمد', 'مجمدة'],
    englishForms: ['frozen'],
    description: 'Deep frozen food product'
  },
  {
    canonicalId: 'chilled',
    category: 'modifier',
    arabicForms: ['مبرد', 'مبردة'],
    englishForms: ['chilled'],
    description: 'Refrigerated / chilled food product'
  },

  // -------------------------------------------------------------
  // 5. Grain, Rice & Formulation Modifiers (category: 'modifier')
  // -------------------------------------------------------------
  {
    canonicalId: 'sella',
    category: 'modifier',
    arabicForms: ['سيلا', 'مزة'],
    englishForms: ['sella', 'sella basmati', 'mazza'],
    description: 'Sella / Parboiled basmati rice variant'
  },
  {
    canonicalId: 'basmati',
    category: 'modifier',
    arabicForms: ['بسمتي'],
    englishForms: ['basmati'],
    description: 'Basmati long-grain rice'
  },
  {
    canonicalId: 'white_rice',
    category: 'modifier',
    arabicForms: ['أبيض', 'ابيض'],
    englishForms: ['white'],
    description: 'White milled rice'
  },
  {
    canonicalId: 'brown_rice',
    category: 'modifier',
    arabicForms: ['بني'],
    englishForms: ['brown'],
    description: 'Brown whole-grain rice'
  },

  // -------------------------------------------------------------
  // 6. Poultry & Meat Cuts (category: 'cut')
  // -------------------------------------------------------------
  {
    canonicalId: 'drumstick',
    category: 'cut',
    arabicForms: ['سيقان', 'سيقان دجاج', 'أفخاذ', 'افخاذ'],
    englishForms: ['drumstick', 'drumsticks'],
    description: 'Chicken drumsticks / lower leg cuts'
  },
  {
    canonicalId: 'fillet',
    category: 'cut',
    arabicForms: ['فيليه', 'صدور', 'صدور فيليه', 'صدور دجاج'],
    englishForms: ['fillet', 'breast', 'breasts', 'boneless breast'],
    description: 'Chicken breast fillet / boneless cuts'
  },
  {
    canonicalId: 'wing',
    category: 'cut',
    arabicForms: ['أجنحة', 'اجنحة'],
    englishForms: ['wing', 'wings'],
    description: 'Chicken wings'
  },
  {
    canonicalId: 'whole_chicken',
    category: 'cut',
    arabicForms: ['دجاج كامل', 'كامل'],
    englishForms: ['whole chicken', 'whole'],
    description: 'Whole chicken carcass'
  },

  // -------------------------------------------------------------
  // 7. Flavor & Sugar Variants (category: 'modifier')
  // -------------------------------------------------------------
  {
    canonicalId: 'zero_sugar',
    category: 'modifier',
    arabicForms: ['بدون سكر', 'خالي من السكر', 'زيرو سكر'],
    englishForms: ['zero sugar', 'no sugar', 'sugar free', 'sugar-free'],
    description: 'Zero sugar / unsweetened variant'
  },
  {
    canonicalId: 'original',
    category: 'modifier',
    arabicForms: ['أصلي', 'اصلي'],
    englishForms: ['original'],
    description: 'Original / classic formulation'
  },
  {
    canonicalId: 'plain',
    category: 'modifier',
    arabicForms: ['سادة'],
    englishForms: ['plain'],
    description: 'Plain / unflavored base product'
  },
  {
    canonicalId: 'curry',
    category: 'modifier',
    arabicForms: ['كاري'],
    englishForms: ['curry', 'chicken curry'],
    description: 'Curry spice flavor'
  },
  {
    canonicalId: 'strawberry',
    category: 'modifier',
    arabicForms: ['فراولة'],
    englishForms: ['strawberry'],
    description: 'Strawberry flavor'
  },
  {
    canonicalId: 'chocolate',
    category: 'modifier',
    arabicForms: ['شوكولاته', 'شوكولاتة', 'شوكولاطة'],
    englishForms: ['chocolate', 'choc'],
    description: 'Chocolate flavor'
  },
  {
    canonicalId: 'vanilla',
    category: 'modifier',
    arabicForms: ['فانيلا', 'فانيليا'],
    englishForms: ['vanilla'],
    description: 'Vanilla flavor'
  },
  {
    canonicalId: 'mango',
    category: 'modifier',
    arabicForms: ['مانجو', 'مانجا'],
    englishForms: ['mango'],
    description: 'Mango flavor'
  }
]

/**
 * Stop-words and non-distinct promotional terms safe to ignore during token set comparison.
 */
const HARMFUL_PROMO_STOPWORDS = new Set([
  'and', 'with', 'for', 'of', 'in', 'the', 'a', 'an', 'to', 'by', 'on', 'at', 'from',
  'و', 'مع', 'من', 'في', 'على', 'عن', 'إلى', 'الى',
  'premium', 'quality', 'special', 'offer', 'promo', 'super', 'deal', 'pack', 'packet', 'carton',
  'عرض', 'خاص', 'فاخر', 'ممتاز', 'سعر', 'توفير', 'كرتون', 'باكيت', 'حبة'
])

/**
 * Common measurement unit keywords and packaging forms that are captured via
 * structured measurement/pack attributes and must not be treated as unknown specialty modifiers.
 */
const UNIT_AND_QUANTITY_STOPWORDS = new Set([
  'l', 'lt', 'ltr', 'liter', 'litre', 'liters', 'litres', 'لتر', 'ليتر',
  'ml', 'mls', 'milli', 'milliliter', 'millilitre', 'مل', 'ملي', 'ملل',
  'kg', 'kgs', 'kilo', 'kilogram', 'kilograms', 'كيلو', 'كجم', 'كغ',
  'g', 'gm', 'gms', 'grm', 'gram', 'grams', 'غ', 'غم', 'ج', 'جم', 'جرام',
  'pcs', 'piece', 'pieces', 'حبة', 'قطعة', 'حبات', 'قطع',
  'pack', 'packet', 'carton', 'كرتون', 'باكيت', 'علبة', 'علب'
])

/**
 * Normalizes text for bilingual tokenization:
 * - Converts Arabic digits to Western.
 * - Strips tatweel and tashkeel.
 * - Normalizes Alef, Yeh, Teh Marbuta.
 * - Lowercases English.
 * - Strips punctuation.
 */
export function normalizeBilingualText(text: string | null | undefined): string {
  if (!text) return ''
  let res = String(text).trim()

  // Convert multiplication * between digits (e.g. 4*250ml -> 4x250ml)
  res = res.replace(/(\d)\s*\*\s*(\d)/g, '$1x$2')
  // Remove decorative asterisks or punctuation symbols early
  res = res.replace(/[*#~`^&_={}\[\]|\\<>]/g, ' ')

  res = normalizeArabicNumerals(res)

  // Lowercase
  res = res.toLowerCase()

  // Remove tatweel (kashida)
  res = res.replace(/ـ/g, '')

  // Remove Arabic diacritics / tashkeel (U+064B-U+065F, U+0670)
  res = res.replace(/[\u064B-\u065F\u0670]/g, '')

  // Normalize Alef variants [أإآٱ] -> ا
  res = res.replace(/[أإآٱ]/g, 'ا')

  // Normalize Yeh ى -> ي
  res = res.replace(/ى/g, 'ي')

  // Normalize Teh Marbuta ة -> ه
  res = res.replace(/ة/g, 'ه')

  // Replace punctuation and symbols with space
  res = res.replace(/[.,/#!$%^&*;:{}=\-_`~()\[\]"'’،٫]/g, ' ')

  // Collapse whitespace
  res = res.replace(/\s+/g, ' ').trim()

  return res
}

/**
 * Builds a fast lookup table for dictionary phrases (sorted longest first to ensure greedy matching).
 */
interface CompiledPhrase {
  phrase: string
  wordCount: number
  entry: CuratedDictionaryEntry
}

const COMPILED_PHRASES: CompiledPhrase[] = []

for (const entry of CURATED_BILINGUAL_DICTIONARY) {
  for (const form of [...entry.arabicForms, ...entry.englishForms]) {
    const norm = normalizeBilingualText(form)
    if (norm) {
      COMPILED_PHRASES.push({
        phrase: norm,
        wordCount: norm.split(' ').length,
        entry
      })
    }
  }
}

// Sort: multi-word phrases first, longest phrase first
COMPILED_PHRASES.sort((a, b) => b.wordCount - a.wordCount || b.phrase.length - a.phrase.length)

/**
 * Extracts normalized measurement tokens from a title string (e.g. "1L" -> "meas:1000ml").
 * Supports multiple measurements in bilingual titles and cleans all measurement substrings.
 */
function extractMeasurementTokens(text: string): { measurementTokens: string[]; primaryMeasurement: string | null; cleanedText: string } {
  // Regex matching volume and mass measurements preceded by word boundary, space, or multipack-x
  const measureRegex = /(?:^|\s|[0-9xX×])(\d+(?:[.,]\d+)?)\s*(l|lt|ltr|liter|litre|liters|litres|لتر|ليتر|ml|mls|milli|milliliter|millilitre|مل|ملي|ملل|kg|kgs|kilo|kilogram|kilograms|كيلو|كجم|كغ|g|gm|gms|grm|gram|grams|غ|غم|جم|جرام)(?=$|\s|[^\w\u0600-\u06FF])/gi

  const tokens: string[] = []
  let cleaned = text
  let match: RegExpExecArray | null

  const matches: Array<{ start: number; end: number; token: string }> = []
  while ((match = measureRegex.exec(text)) !== null) {
    const numStr = match[1]
    const unitStr = match[2]
    const norm = normalizeMeasurement(numStr, unitStr)
    if (norm && norm.isRecognized) {
      const tok = `meas:${norm.baseValue}${norm.baseUnit}`
      if (!tokens.includes(tok)) {
        tokens.push(tok)
      }
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        token: tok
      })
    }
  }

  // Remove matched substrings from right to left to preserve index offsets
  for (let i = matches.length - 1; i >= 0; i--) {
    cleaned = cleaned.slice(0, matches[i].start) + ' ' + cleaned.slice(matches[i].end)
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return {
    measurementTokens: tokens,
    primaryMeasurement: tokens[0] || null,
    cleanedText: cleaned
  }
}

/**
 * Tokenizes and normalizes an input product title into a structured NormalizedTokenBag.
 * Supports word-order invariance by producing a canonical sorted list of token IDs.
 */
export function extractNormalizedTokenBag(rawText: string | null | undefined): NormalizedTokenBag {
  if (!rawText || !String(rawText).trim()) {
    return {
      originalText: '',
      normalizedText: '',
      tokens: [],
      tokenIds: [],
      tokenMultiSet: {},
      brandId: null,
      commodityId: null,
      fatContentId: null,
      preservationId: null,
      cutId: null,
      grainVariantId: null,
      measurementToken: null,
      unknownTokens: []
    }
  }

  const originalText = String(rawText).trim()
  const normText = normalizeBilingualText(originalText)

  // 1. Extract measurement tokens first
  const { measurementTokens, primaryMeasurement, cleanedText } = extractMeasurementTokens(normText)

  const tokens: CanonicalToken[] = []
  const tokenMultiSet: Record<string, number> = {}
  let remainingText = ` ${cleanedText} `

  let brandId: string | null = null
  let commodityId: string | null = null
  let fatContentId: 'full_fat' | 'low_fat' | 'skimmed' | null = null
  let preservationId: 'fresh' | 'long_life' | 'frozen' | 'chilled' | null = null
  let cutId: string | null = null
  let grainVariantId: string | null = null

  // Helper to add canonical token
  const addToken = (entry: CuratedDictionaryEntry, rawForm: string) => {
    const prefix = entry.category === 'brand' ? 'brand' : entry.category.slice(0, 3)
    const tokenId = `${prefix}:${entry.canonicalId}`
    tokens.push({
      id: tokenId,
      category: entry.category,
      displayEn: entry.englishForms[0],
      displayAr: entry.arabicForms[0],
      rawValue: rawForm
    })
    tokenMultiSet[tokenId] = (tokenMultiSet[tokenId] || 0) + 1

    if (entry.category === 'brand' && !brandId) {
      brandId = entry.canonicalId
    } else if (entry.category === 'commodity' && !commodityId) {
      commodityId = entry.canonicalId
    } else if (entry.category === 'modifier') {
      if (['full_fat', 'low_fat', 'skimmed'].includes(entry.canonicalId)) {
        fatContentId = entry.canonicalId as any
      } else if (['fresh', 'long_life', 'frozen', 'chilled'].includes(entry.canonicalId)) {
        preservationId = entry.canonicalId as any
      } else if (['sella', 'basmati', 'white_rice', 'brown_rice'].includes(entry.canonicalId)) {
        grainVariantId = entry.canonicalId
      }
    } else if (entry.category === 'cut' && !cutId) {
      cutId = entry.canonicalId
    }
  }

  // 2. Greedy match multi-word and compiled phrases first
  for (const cp of COMPILED_PHRASES) {
    const pattern = new RegExp(`(?:^|\\s)(${escapeRegex(cp.phrase)})(?:\\s|$)`, 'i')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(remainingText)) !== null) {
      addToken(cp.entry, match[1])
      // Replace matched phrase with single space
      remainingText = remainingText.slice(0, match.index) + ' ' + remainingText.slice(match.index + match[0].length)
    }
  }

  // 3. Process remaining single words (with Arabic definite article "ال" stripping where safe)
  const remainingWords = remainingText.trim().split(/\s+/).filter(Boolean)
  const unknownTokens: string[] = []

  for (const rawWord of remainingWords) {
    if (
      HARMFUL_PROMO_STOPWORDS.has(rawWord) ||
      UNIT_AND_QUANTITY_STOPWORDS.has(rawWord) ||
      /^\d+$/.test(rawWord)
    ) {
      continue
    }

    // Check if word starts with Arabic definite article "ال" and length > 3
    let matchedStem = false
    if (rawWord.startsWith('ال') && rawWord.length > 3) {
      const stem = rawWord.slice(2)
      for (const cp of COMPILED_PHRASES) {
        if (cp.phrase === stem && cp.entry.category !== 'brand') {
          addToken(cp.entry, rawWord)
          matchedStem = true
          break
        }
      }
    }

    if (!matchedStem) {
      // Meaningful unknown token: retain for strict false-match prevention
      const rawTokenId = `raw:${rawWord}`
      unknownTokens.push(rawWord)
      tokens.push({
        id: rawTokenId,
        category: 'raw',
        displayEn: rawWord,
        displayAr: rawWord,
        rawValue: rawWord
      })
      tokenMultiSet[rawTokenId] = (tokenMultiSet[rawTokenId] || 0) + 1
    }
  }

  // 4. Add measurement tokens if present
  for (const mt of measurementTokens) {
    tokens.push({
      id: mt,
      category: 'measurement',
      displayEn: mt.replace('meas:', ''),
      displayAr: mt.replace('meas:', ''),
      rawValue: mt
    })
    tokenMultiSet[mt] = (tokenMultiSet[mt] || 0) + 1
  }

  // Sort token IDs for word-order invariance
  const tokenIds = Array.from(new Set(tokens.map((t) => t.id))).sort()

  return {
    originalText,
    normalizedText: normText,
    tokens,
    tokenIds,
    tokenMultiSet,
    brandId,
    commodityId,
    fatContentId,
    preservationId,
    cutId,
    grainVariantId,
    measurementToken: primaryMeasurement,
    unknownTokens
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compares two NormalizedTokenBags to determine whether they represent the exact same product identity.
 * Evaluates attribute compatibility, detects material conflicts, and calculates token Jaccard similarity.
 */
export function areTokenBagsCompatible(
  bag1: NormalizedTokenBag,
  bag2: NormalizedTokenBag
): TokenBagCompatibilityResult {
  const conflicts: string[] = []

  // 1. Brand check
  if (bag1.brandId && bag2.brandId) {
    if (bag1.brandId !== bag2.brandId) {
      conflicts.push(`Brand mismatch: offer='${bag1.brandId}' vs product='${bag2.brandId}'`)
    }
  }

  // 2. Fat content check
  if (bag1.fatContentId && bag2.fatContentId) {
    if (bag1.fatContentId !== bag2.fatContentId) {
      conflicts.push(`Fat content mismatch: offer='${bag1.fatContentId}' vs product='${bag2.fatContentId}'`)
    }
  } else if (bag2.fatContentId && !bag1.fatContentId) {
    conflicts.push(`Offer lacks fat content specification to verify exact match against product (${bag2.fatContentId})`)
  } else if (bag1.fatContentId && !bag2.fatContentId) {
    conflicts.push(`Candidate product lacks fat content (${bag1.fatContentId}) claimed by offer`)
  }

  // 3. Preservation / thermal processing check
  if (bag1.preservationId && bag2.preservationId) {
    if (bag1.preservationId !== bag2.preservationId) {
      conflicts.push(`Preservation mismatch: offer='${bag1.preservationId}' vs product='${bag2.preservationId}'`)
    }
  }

  // 4. Cut / poultry part check
  if (bag1.cutId && bag2.cutId) {
    if (bag1.cutId !== bag2.cutId) {
      conflicts.push(`Cut/part mismatch: offer='${bag1.cutId}' vs product='${bag2.cutId}'`)
    }
  } else if (bag2.cutId && !bag1.cutId) {
    conflicts.push(`Offer lacks cut/part specification to verify exact match against product (${bag2.cutId})`)
  } else if (bag1.cutId && !bag2.cutId) {
    conflicts.push(`Candidate product lacks cut/part (${bag1.cutId}) claimed by offer`)
  }

  // 5. Grain variant check (e.g. Sella Basmati vs Plain Basmati)
  if (bag1.grainVariantId === 'sella' && bag2.grainVariantId !== 'sella') {
    conflicts.push(`Variant mismatch: offer specifies Sella Basmati but product lacks Sella distinction`)
  } else if (bag2.grainVariantId === 'sella' && bag1.grainVariantId !== 'sella') {
    conflicts.push(`Variant mismatch: product specifies Sella Basmati but offer lacks Sella distinction`)
  } else if (bag1.grainVariantId && bag2.grainVariantId && bag1.grainVariantId !== bag2.grainVariantId) {
    conflicts.push(`Grain variant mismatch: offer='${bag1.grainVariantId}' vs product='${bag2.grainVariantId}'`)
  }

  // 6. Unknown / Unrecognized meaningful tokens check
  // Unknown tokens must match or fail closed (preventing silent discard of meaningful variants)
  const isBag1Arabic = /[\u0600-\u06FF]/.test(bag1.originalText)
  const isBag1English = /[a-zA-Z]/.test(bag1.originalText)

  if (bag1.unknownTokens.length > 0 || bag2.unknownTokens.length > 0) {
    const set1 = new Set(bag1.unknownTokens)
    const set2 = new Set(bag2.unknownTokens)
    for (const u1 of bag1.unknownTokens) {
      if (!set2.has(u1)) {
        conflicts.push(`Offer contains meaningful modifier '${u1}' not present on candidate product`)
      }
    }
    for (const u2 of bag2.unknownTokens) {
      const isU2Arabic = /[\u0600-\u06FF]/.test(u2)
      // If the offer does not contain Arabic text, do not treat Arabic descriptive tokens on the product as missing modifiers
      if (isU2Arabic && !isBag1Arabic) {
        continue
      }
      // If the offer does not contain English text, do not treat English descriptive tokens on the product as missing modifiers
      if (!isU2Arabic && !isBag1English) {
        continue
      }
      if (!set1.has(u2)) {
        conflicts.push(`Candidate product contains meaningful modifier '${u2}' not present on offer`)
      }
    }
  }

  // 7. Calculate Jaccard token set similarity
  const setA = new Set(bag1.tokenIds)
  const setB = new Set(bag2.tokenIds)
  const sharedTokens = bag1.tokenIds.filter((t) => setB.has(t))
  const offerOnlyTokens = bag1.tokenIds.filter((t) => !setB.has(t))
  const productOnlyTokens = bag2.tokenIds.filter((t) => !setA.has(t))

  const unionSize = new Set([...bag1.tokenIds, ...bag2.tokenIds]).size
  const similarityScore = unionSize > 0 ? Number((sharedTokens.length / unionSize).toFixed(4)) : 0

  if (conflicts.length > 0) {
    return {
      isCompatible: false,
      similarityScore,
      sharedTokens,
      offerOnlyTokens,
      productOnlyTokens,
      conflicts,
      reason: `Token contradiction: ${conflicts.join('; ')}`
    }
  }

  // If token sets match completely
  return {
    isCompatible: true,
    similarityScore,
    sharedTokens,
    offerOnlyTokens,
    productOnlyTokens,
    conflicts: [],
    reason: `Bilingual token bags verified compatible (Jaccard=${similarityScore})`
  }
}

/**
 * Returns the canonical brand ID for a given Arabic or English brand name string.
 * Returns null if the brand is not in the curated dictionary.
 */
export function getCanonicalBrandId(brandStr: string | null | undefined): string | null {
  if (!brandStr) return null
  const norm = normalizeBilingualText(brandStr)
  for (const entry of CURATED_BILINGUAL_DICTIONARY) {
    if (entry.category === 'brand') {
      for (const form of [...entry.arabicForms, ...entry.englishForms]) {
        if (normalizeBilingualText(form) === norm) {
          return entry.canonicalId
        }
      }
    }
  }
  return null
}

/**
 * Generates alternative candidate search strings across Arabic, English, and word orders

 * to maximize catalog retrieval recall.
 */
export function generateBilingualCandidateSearchQueries(rawTitle: string | null | undefined): string[] {
  if (!rawTitle) return []
  const bag = extractNormalizedTokenBag(rawTitle)
  if (bag.tokenIds.length === 0) return []

  const queries = new Set<string>()

  // Original normalized
  if (bag.normalizedText) queries.add(bag.normalizedText)

  // Find brand entry
  const brandEntry = CURATED_BILINGUAL_DICTIONARY.find((d) => d.canonicalId === bag.brandId && d.category === 'brand')
  const comEntry = CURATED_BILINGUAL_DICTIONARY.find((d) => d.canonicalId === bag.commodityId && d.category === 'commodity')
  const modEntries = CURATED_BILINGUAL_DICTIONARY.filter(
    (d) =>
      d.category === 'modifier' &&
      (d.canonicalId === bag.fatContentId ||
        d.canonicalId === bag.preservationId ||
        d.canonicalId === bag.grainVariantId)
  )

  // Generate English variations (Brand first vs Mod first)
  if (brandEntry && comEntry) {
    const brandEn = brandEntry.englishForms[0]
    const comEn = comEntry.englishForms[0]
    const modEn = modEntries.map((m) => m.englishForms[0]).join(' ')

    // e.g. "Nadec Full Fat Milk"
    const q1 = [brandEn, modEn, comEn].filter(Boolean).join(' ')
    // e.g. "Full Fat Nadec Milk"
    const q2 = [modEn, brandEn, comEn].filter(Boolean).join(' ')
    // e.g. "Nadec Milk Full Fat"
    const q3 = [brandEn, comEn, modEn].filter(Boolean).join(' ')

    if (q1) queries.add(normalizeBilingualText(q1))
    if (q2) queries.add(normalizeBilingualText(q2))
    if (q3) queries.add(normalizeBilingualText(q3))

    // With measurement if available
    if (bag.measurementToken) {
      const rawMeas = bag.measurementToken.replace('meas:', '')
      const equivs = getEquivalentMeasurements(
        parseFloat(rawMeas) || 1,
        rawMeas.replace(/[\d.]+/g, '')
      )
      for (const eq of equivs) {
        queries.add(normalizeBilingualText(`${q1} ${eq.value}${eq.canonicalUnit}`))
        queries.add(normalizeBilingualText(`${q1} ${eq.value} ${eq.canonicalUnit}`))
        queries.add(normalizeBilingualText(`${q2} ${eq.value}${eq.canonicalUnit}`))
      }
    }

    // Generate Arabic variations
    const brandAr = brandEntry.arabicForms[0]
    const comAr = comEntry.arabicForms[0]
    const modAr = modEntries.map((m) => m.arabicForms[0]).join(' ')

    // e.g. "حليب نادك كامل الدسم"
    const ar1 = [comAr, brandAr, modAr].filter(Boolean).join(' ')
    // e.g. "حليب كامل الدسم نادك"
    const ar2 = [comAr, modAr, brandAr].filter(Boolean).join(' ')
    // e.g. "نادك حليب كامل الدسم"
    const ar3 = [brandAr, comAr, modAr].filter(Boolean).join(' ')

    if (ar1) queries.add(normalizeBilingualText(ar1))
    if (ar2) queries.add(normalizeBilingualText(ar2))
    if (ar3) queries.add(normalizeBilingualText(ar3))
  }

  return Array.from(queries)
}
