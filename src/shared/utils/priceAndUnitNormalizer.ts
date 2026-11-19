import type { ExtractedOfferRev1, CanonicalExtractionUnit } from '../types/leafletExtraction';

export const PROMO_MECHANIC_REGEX =
  /(?:buy\s*\d+\s*(?:get\s*\d+\s*free|pcs|pc|items|حبات|قطع)?|\b\d+\s*\+\s*\d+\s*free|\b\d+\s*for\s*(?:sar\s*)?\d+|\bاشتري\s*\d+\s*(?:واحصل\s*على\s*\d+|حبات|قطع)?|\b\d+\s*حبات\s*بسعر\s*\d+|\b\d+\s*pc(?:s)?\s*per\s*customer)/i;

/**
 * Detects customer purchase limits in Arabic and English (e.g. "حد أقصى 2 حبة", "Max 2 pcs per customer").
 * A purchase limit MUST NEVER be conflated with the offer's physical pack count!
 */
export function detectCustomerPurchaseLimit(
  text?: string | null
): { hasLimit: boolean; limitPcs: number | null; matchedPhrase?: string } {
  if (!text || typeof text !== 'string') return { hasLimit: false, limitPcs: null };
  const clean = normalizeArabicNumerals(text);

  // Pattern 1: Arabic "حد أقصى 2 حبة / كيس / قطع"
  const mAr = clean.match(
    /(?:حد\s*أقصى|كحد\s*أقصى|بحد\s*أقصى|أقصى\s*حد|الحد\s*الأقصى)\s*(\d+)\s*(?:حبة|حبات|قطع|أكياس|كيس|pcs?|pieces?)?/i
  );
  if (mAr) {
    return { hasLimit: true, limitPcs: parseInt(mAr[1], 10), matchedPhrase: mAr[0] };
  }

  // Pattern 2: English "Max 2 pcs per customer", "Limit 2 per customer"
  const mEn = clean.match(
    /(?:max(?:imum)?|limit(?:ed)?(?:\s*to)?)\s*(\d+)\s*(?:pcs?|pieces?|bags?|items?|units?)?(?:\s*(?:per|for|each)\s*(?:customer|family|shopper|person|cart|ticket))?/i
  );
  if (mEn) {
    return { hasLimit: true, limitPcs: parseInt(mEn[1], 10), matchedPhrase: mEn[0] };
  }

  // Pattern 3: "2 pcs per customer" / "لكل عميل 2 حبة"
  const mPer = clean.match(
    /(?:(?:per\s*(?:customer|family|shopper)|لكل\s*(?:عميل|زبون|أسرة|عائلة))\s*(\d+)\s*(?:حبة|حبات|pcs?|pieces?)?)|(?:(\d+)\s*(?:pcs?|pieces?|حبة|حبات)\s*(?:per\s*(?:customer|family|shopper)|لكل\s*(?:عميل|زبون|أسرة|عائلة)))/i
  );
  if (mPer) {
    const qty = mPer[1] || mPer[2];
    return { hasLimit: true, limitPcs: parseInt(qty, 10), matchedPhrase: mPer[0] };
  }

  return { hasLimit: false, limitPcs: null };
}

export type ParseQuantityInput = {
  size_text?: string | null;
  title_en?: string | null;
  title_ar?: string | null;
  item_domain?: string | null;
  unit_type?: string | null;
  ai_pack_quantity?: number | null;
  ai_each_size_value?: number | null;
  ai_each_size_unit?: string | null;
  is_uniform_size_across_variants?: boolean | null;
  offer_price?: number | null;
  price_basis?: string | null;
  bundle_quantity?: number | null;
  condition_text?: string | null;
  promotion_mechanic?: string | null;
  promo_notes?: string | null;
};

export type ParseQuantityOutput = {
  pack_quantity: number;
  bundle_quantity?: number | null;
  each_size_value: number | null;
  each_size_unit: CanonicalExtractionUnit | null;
  total_content_value: number | null;
  total_content_unit: CanonicalExtractionUnit | null;
  standardized_unit: 'kilogram' | 'liter' | 'piece' | null;
  standardized_total_value: number | null;
  standardized_unit_price: number | null;
  comparison_eligible: boolean;
  exclusion_reason: string | null;
  is_narrow_variant_range: boolean;
  raw_size_text: string | null;
};

/**
 * Normalizes price strings (e.g. hyphenated "18-99" or spaced "14 95") into standard floating-point numbers.
 */
export function normalizePriceValue(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return isNaN(raw) ? null : raw;
  }

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Clean currency symbols or Arabic chars while preserving standard hyphen, en-dash, and em-dash
  const cleaned = trimmed
    .replace(/[^\d.,\s\-\u2013\u2014]/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .trim();

  // Hyphenated format like "18-99" or "6-99"
  const hyphenMatch = cleaned.match(/^(\d+)[\s-]*[-][\s-]*(\d{1,2})$/);
  if (hyphenMatch) {
    const whole = hyphenMatch[1];
    const fraction = hyphenMatch[2].padEnd(2, '0').slice(0, 2);
    const parsed = parseFloat(`${whole}.${fraction}`);
    return isNaN(parsed) ? null : parsed;
  }

  // Superscript/spaced format like "14 95" or "5 00"
  const spaceMatch = cleaned.match(/^(\d+)[\s]+(\d{2})$/);
  if (spaceMatch) {
    const whole = spaceMatch[1];
    const fraction = spaceMatch[2];
    const parsed = parseFloat(`${whole}.${fraction}`);
    return isNaN(parsed) ? null : parsed;
  }

  // Standard comma or dot decimal
  const commaOrDot = cleaned.replace(',', '.');
  const parsed = parseFloat(commaOrDot);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Converts Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩), Arabic commas (،/٫), and multiplication symbols to standard Western format.
 */
export function normalizeArabicNumerals(str: string): string {
  if (!str) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let res = str;
  for (let i = 0; i < 10; i++) {
    res = res.replaceAll(arabicDigits[i], String(i));
  }
  // Replace Arabic decimal separators (e.g. "٢,٢٥" or "1٫5" or "1,5" between digits) with "."
  res = res.replace(/(\d)[,،٫](\d)/g, '$1.$2');
  // Normalize multiplication symbols (×, ✕, ✖, ⨯, *) to "x"
  res = res.replace(/[\u00d7\u2715\u2716\u2a2f\u2a09\u274c*]/g, 'x');
  return res;
}

/**
 * Helper to map CanonicalExtractionUnit ('g'|'kg'|'ml'|'l'|'pcs'|'roll'|'sheet')
 * to CanonicalOffer schema unit ('liter'|'milliliter'|'kilogram'|'gram'|'piece'|'inch'|'dozen'|'other'|null)
 */
export function toCanonicalOfferUnit(
  u: CanonicalExtractionUnit | null | undefined
): 'liter' | 'milliliter' | 'kilogram' | 'gram' | 'piece' | 'dozen' | 'other' | null {
  if (!u) return null;
  if (u === 'g') return 'gram';
  if (u === 'kg') return 'kilogram';
  if (u === 'ml') return 'milliliter';
  if (u === 'l') return 'liter';
  if (u === 'pcs') return 'piece';
  return 'other';
}

/**
 * Detects cellular network designations (e.g. "3G", "4G", "5G", "WiFi") and electronics specs (e.g. "256GB", "65 Inch", "120Hz")
 * to prevent false-positive parsing as mass/volume units (e.g. preventing "4G" from parsing as "4 grams").
 */
export function isTechOrCellularToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const t = token.trim();
  // Exact cellular / wireless networks
  if (/^(3G|4G|5G|LTE|WiFi|Wi-Fi|واي\s*فاي)$/i.test(t)) return true;
  // Tech units with or without leading numbers: GB, TB, MB, KB, GHz, MHz, MP, mAh, Wh, W, V, Inch, ", بوصة
  if (/^(?:\d+(?:\.\d+)?\s*)?(?:gb|tb|mb|kb|ghz|mhz|mp|mah|wh|w|v|inch|بوصة|["”])$/i.test(t)) return true;
  return false;
}

/**
 * Deterministically classifies item_domain based on English and Arabic title keywords,
 * with fallback to AI-extracted domain.
 */
export function detectItemDomainFromTitle(
  titleEn: string | null | undefined,
  titleAr: string | null | undefined,
  extractedDomain?: string | null,
  categoryEvidence?: { commodityTag?: string | null; categoryHint?: string | null } | null
): 'grocery' | 'household' | 'personal_care' | 'electronics' | 'appliance' | 'other_non_grocery' {
  const combined = `${titleEn || ''} ${titleAr || ''}`.toLowerCase();
  const commodityTag = (categoryEvidence?.commodityTag || '').toLowerCase().trim();
  const categoryHint = (categoryEvidence?.categoryHint || '').toLowerCase().trim();

  // Guard: Food/confectionery keywords override tech keyword ambiguities (e.g. Galaxy chocolate, Apple juice)
  if (
    /\b(chocolate|candy|wafer|biscuit|miniature|minis?|mnis|jewels|flutes|snack|bar|choc|milk|juice|sweet|bread|croissant|tomato(?:es)?|potato(?:es)?|chicken|beef|lamb|mutton|fish|cheese|yogurt|butter|olive\s*oil|rice|pasta)\b/i.test(combined) ||
    /(شوكولاته|شوكولاتة|بسكويت|حلوى|ميني|جواهر|فلوتس|عصير|حليب|خبز|طماطم|بطاطس|دجاج|لحم|سمك|جبن|زبادي|زبدة|زيت|أرز|ارز|مكرونة)/.test(combined)
  ) {
    return 'grocery';
  }

  // Deterministic electronics check
  // Note: Arabic characters are non-ASCII, so avoid \b for Arabic terms
  if (
    /\b(tv|qled|qned|oled|uhd|4k|smart tv|iphone|ipad|pad|airpods|macbook|laptop|tablet|smartwatch|playstation|xbox|earbuds|headphone|charger|powerbank|inch|honor|tecno|techno|xiaomi|redmi|huawei)\b/i.test(combined) ||
    /\b(samsung\s+galaxy|galaxy\s+(?:a|s|z|tab|watch|phone|note|fold|flip|\d+)|apple\s+watch)\b/i.test(combined) ||
    /(تلفزيون|شاشة|آيفون|آيباد|جوال|تابلت|سماعة|سماعات|ساعة\s*ذكية|تكنو|هونر|سامسونج\s*جالكسي|جالكسي\s*(?:ايه|إيه|اس|إس|تاب|فولد|فليب|نوت|واتش|[aAsSzZ]\s*\d+)|هواوي|شاومي|ريدمي|بوصة)/.test(combined)
  ) {
    return 'electronics';
  }

  // Deterministic appliance check
  if (
    /\b(microwave|blender|air fryer|refrigerator|freezer|kettle|vacuum cleaner|toaster|oven)\b/i.test(combined) ||
    /(غلاية|ميكروويف|خلاط|قلاية|ثلاجة|مكنسة|فرن)/.test(combined)
  ) {
    return 'appliance';
  }

  // Household consumables (detergents, paper products, foil/wrap/trash bags) belong in WP2 household consumables scope
  const isConsumableHouseholdTitle =
    /\b(detergent|dishwash(?:ing)?|laundry|softener|bleach|disinfectant|cleaner|facial\s*tissue|tissues?|toilet\s*paper|paper\s*towel|napkin|aluminum\s*foil|cling\s*film|trash\s*bag|garbage\s*bag|sponge|scourer|insecticide|air\s*freshener)\b/i.test(combined) ||
    /(مسحوق\s*غسيل|منظف|مبيض|مطهر|منعم|مناديل|ورق\s*تواليت|ورق\s*نشاف|قصدير|ورق\s*ألمنيوم|نايلون\s*تغليف|أكياس\s*نفايات|سفرة|معطر\s*جو|مبيد)/.test(combined);

  if (isConsumableHouseholdTitle) {
    return 'household';
  }

  // Durable household goods, home textiles, bedding, furniture, luggage, cookware, apparel -> non-grocery consumer exclusion
  const isDurableOrTextileNonGroceryTitle =
    /\b(bed\s*sheet|bedsheet|bed\s*spread|bedding|duvet|comforter|quilt|blanket|pillow|cushion|mattress|curtain|rug|carpet|towel|bathrobe|tablecloth|linen|cookware|frying\s*pan|saucepan|pressure\s*cooker|casserole|dinner\s*set|tableware|vacuum\s*flask|thermos|luggage|suitcase|trolley\s*bag|backpack|travel\s*bag|furniture|sofa|chair|dining\s*table|wardrobe|bookshelf|bicycle|treadmill|drill|tool\s*kit|slipper|sneaker|garment|t-?shirt|trouser|jeans)\b/i.test(combined) ||
    /(شرشف|مفرش|لحاف|بطانية|مخدة|وسادة|مرتبة|ستارة|ستائر|سجاد|سجادة|فوطة|منشفة|مناشف|طقم\s*قدور|قدر\s*(?:ضغط|طبخ)|مقلاة|طقم\s*أواني|أطباق|ترمس|شنطة\s*سفر|حقيبة\s*سفر|طاولة|كرسي|مروحة|دفاية|لمبة|دراجة|ملابس|حذاء|شبشب)/.test(combined);

  if (isDurableOrTextileNonGroceryTitle) {
    return 'other_non_grocery';
  }

  // Personal care items belong in WP2 personal care scope
  if (
    /\b(shampoo|conditioner|shower\s*gel|body\s*wash|hand\s*wash|toothpaste|toothbrush|deodorant|antiperspirant|sunscreen|lotion|moisturizer|diaper|pampers|sanitary\s*pad|razor|shaver)\b/i.test(combined) ||
    /(شامبو|بلسم|غسول\s*جسم|سائل\s*استحمام|معجون\s*أسنان|فرشاة\s*أسنان|مزيل\s*عرق|حفاضات|فوط\s*صحية|ماكينة\s*حلاقة)/.test(combined)
  ) {
    return 'personal_care';
  }

  // Structured non-grocery category evidence overrides loose "household" or default fallback
  const nonGroceryCategorySignals = new Set([
    'non_grocery_item',
    'non-grocery',
    'non_grocery',
    'other_non_grocery',
    'textiles_home',
    'home_textiles',
    'textiles',
    'bedding',
    'furniture',
    'apparel',
    'luggage',
    'cookware',
    'toys',
    'hardware'
  ]);
  if (categoryHint === 'electronics' || commodityTag === 'electronics') return 'electronics';
  if (categoryHint === 'appliances' || categoryHint === 'appliance' || commodityTag === 'appliance') return 'appliance';
  if (nonGroceryCategorySignals.has(commodityTag) || nonGroceryCategorySignals.has(categoryHint)) {
    return 'other_non_grocery';
  }

  if (extractedDomain === 'electronics') return 'electronics';
  if (extractedDomain === 'appliance') return 'appliance';
  if (extractedDomain === 'health_beauty' || extractedDomain === 'personal_care') return 'personal_care';
  if (extractedDomain === 'household') return 'household';
  if (extractedDomain === 'other_non_grocery') return 'other_non_grocery';

  return 'grocery';
}

/**
 * Maps raw unit strings (English and Arabic) to canonical units:
 * 'g' | 'kg' | 'ml' | 'l' | 'pcs' | 'roll' | 'sheet' | null
 */
export function canonicalizeUnit(unitStr: string | null | undefined): CanonicalExtractionUnit | null {
  if (!unitStr) return null;
  const rawTrimmed = unitStr.trim();
  if (isTechOrCellularToken(rawTrimmed)) return null;

  const u = normalizeArabicNumerals(rawTrimmed).toLowerCase();

  // Explicitly reject standalone tech spec "g" if original raw text was cellular like "4G" or "5G"
  if (u === '4g' || u === '5g' || u === '3g' || u === 'gb' || u === 'mb' || u === 'tb') return null;

  // Grams
  if (/^(g|gm|gms|grm|gram|grams|غ|غم|جم|جرام)$/i.test(u)) return 'g';

  // Kilograms
  if (/^(kg|kgs|kilo|kilogram|kilograms|كيلو|كجم|كغ)$/i.test(u)) return 'kg';

  // Milliliters
  if (/^(ml|milli|milliliter|millilitre|مل|ملي|ملل)$/i.test(u)) return 'ml';

  // Liters
  if (/^(l|lt|ltr|liter|litre|liters|litres|لتر|ليتر)$/i.test(u)) return 'l';

  // Pieces / Count
  if (/^(pcs|pc|p|piece|pieces|ct|count|pk|pack|packs|حبة|حبات|قطعة|قطع|بيضة|بيض|كيس|أكياس|ظرف|أظرف|علبة|علب|طبق)$/i.test(u)) return 'pcs';

  // Roll
  if (/^(roll|rolls|رول)$/i.test(u)) return 'roll';

  // Sheet
  if (/^(sheet|sheets|منديل|مناديل)$/i.test(u)) return 'sheet';

  return null;
}

/**
 * Evaluates a numeric range string like "245/250", "75g/80g", "117-150", or "185/170".
 * If difference is <= 15%, returns average size and flags as narrow variant range.
 * If difference > 15%, returns null (variable weight range).
 */
function parseNumericRange(
  rawRangeStr: string,
  unitPart: string
): { sizeValue: number; unit: CanonicalExtractionUnit; isNarrowRange: boolean; isWideRange: boolean } | null {
  const norm = normalizeArabicNumerals(rawRangeStr).replace(/[\s]+/g, '');
  const match = norm.match(/^(\d+(?:\.\d+)?)[a-zA-Z\u0600-\u06FF]*(?:[\/-]|–|—)(\d+(?:\.\d+)?)[a-zA-Z\u0600-\u06FF]*$/);
  if (!match) return null;

  const v1 = parseFloat(match[1]);
  const v2 = parseFloat(match[2]);
  if (isNaN(v1) || isNaN(v2) || v1 <= 0 || v2 <= 0) return null;

  const min = Math.min(v1, v2);
  const max = Math.max(v1, v2);
  const diffPercent = ((max - min) / max) * 100;

  const canonUnit = canonicalizeUnit(unitPart);
  if (!canonUnit) return null;

  if (diffPercent <= 15) {
    const avg = Number(((min + max) / 2).toFixed(2));
    return { sizeValue: avg, unit: canonUnit, isNarrowRange: true, isWideRange: false };
  } else {
    return { sizeValue: max, unit: canonUnit, isNarrowRange: false, isWideRange: true };
  }
}

/**
 * Deterministically parses bilingual size and quantity expressions:
 * Pattern A: Qty x SizeUnit (e.g. "10 x 900g", "6 x 330ml", "6x245/250ml")
 * Pattern B: SizeUnit x Qty (e.g. "900gmx10", "155gmx2", "٩٠٠ جم × ١٠")
 * Pattern B with count suffix: SizeUnit Qty"s" (e.g. "23gm 12s", "40gm 12s")
 * Pure count / trays: "30s", "24s", "30 PCS", "٣٠ حبة"
 * Single units: "5 Kg", "2.25Kg", "500gm", "1.5L"
 */
export function parseAndNormalizeQuantity(input: ParseQuantityInput): ParseQuantityOutput {
  const {
    size_text,
    title_en,
    title_ar,
    item_domain,
    unit_type,
    ai_pack_quantity,
    ai_each_size_value,
    ai_each_size_unit,
    is_uniform_size_across_variants,
    offer_price,
    price_basis,
    bundle_quantity,
    condition_text,
    promotion_mechanic,
    promo_notes
  } = input;

  const promoText = [
    condition_text,
    promotion_mechanic,
    promo_notes,
    title_en,
    title_ar,
    size_text
  ].filter(Boolean).join(' ');
  const limitCheck = detectCustomerPurchaseLimit(promoText);
  const isPromoMechanic =
    PROMO_MECHANIC_REGEX.test(promoText) ||
    limitCheck.hasLimit ||
    promotion_mechanic === 'multi_buy' ||
    promotion_mechanic === 'bonus_pack';

  let bundleQty: number | null = bundle_quantity || null;
  if (isPromoMechanic && !bundleQty && ai_pack_quantity && ai_pack_quantity > 1) {
    bundleQty = ai_pack_quantity;
  }

  let packQuantity = 1;
  let eachSizeValue: number | null = null;
  let eachSizeUnit: CanonicalExtractionUnit | null = null;
  let isNarrowVariantRange = false;
  let isWideVariantRange = false;
  let parsedFromText = false;

  // Clean raw size text
  let rawStr = size_text ? normalizeArabicNumerals(size_text).trim() : '';

  // Deterministically verify domain using titles if not explicitly set
  const effectiveDomain = item_domain || detectItemDomainFromTitle(title_en, title_ar);
  const isElectronicsOrAppliance =
    effectiveDomain === 'electronics' ||
    effectiveDomain === 'appliance' ||
    effectiveDomain === 'other_non_grocery';

  if (isElectronicsOrAppliance || isTechOrCellularToken(rawStr) || isTechOrCellularToken(unit_type)) {
    return {
      pack_quantity: 1,
      each_size_value: null,
      each_size_unit: null,
      total_content_value: null,
      total_content_unit: null,
      standardized_unit: null,
      standardized_total_value: null,
      standardized_unit_price: null,
      comparison_eligible: false,
      exclusion_reason: isElectronicsOrAppliance ? 'non_grocery_item' : 'tech_specs_non_comparable',
      is_narrow_variant_range: false,
      raw_size_text: rawStr || null
    };
  }

  // Helper parser for a given token string
  const tryParseToken = (text: string): boolean => {
    if (!text) return false;
    if (isTechOrCellularToken(text)) return false;
    const clean = normalizeArabicNumerals(text).trim().replace(/[()]/g, ' ');
    if (isTechOrCellularToken(clean)) return false;

    // 1. Pure count item: "30s", "24s", "100s", "30 pcs", "٣٠ حبة", "طبق بيض"
    const countMatch = clean.match(/^(\d+)\s*(?:s|pcs|pc|حبة|حبات|بيضة|بيض|كيس|ظرف|أكياس)$/i);
    if (countMatch) {
      packQuantity = 1;
      eachSizeValue = parseInt(countMatch[1], 10);
      eachSizeUnit = 'pcs';
      return true;
    }

    // 2. Pattern B with count suffix: "23gm 12s" or "40gm 12s"
    const patternBCountSuffix = clean.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)\s+(\d+)\s*s$/i);
    if (patternBCountSuffix) {
      const u = canonicalizeUnit(patternBCountSuffix[2]);
      if (u) {
        eachSizeValue = parseFloat(patternBCountSuffix[1]);
        eachSizeUnit = u;
        packQuantity = parseInt(patternBCountSuffix[3], 10);
        return true;
      }
    }

    // 3. Pattern B (Lulu Style): Size x Qty -> "900gmx10", "155gmx2", "160 gm x 2", "٩٠٠ جم × ١٠"
    const patternB = clean.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)\s*(?:x|×|\*)\s*(\d+)$/i);
    if (patternB) {
      const u = canonicalizeUnit(patternB[2]);
      if (u) {
        eachSizeValue = parseFloat(patternB[1]);
        eachSizeUnit = u;
        packQuantity = parseInt(patternB[3], 10);
        return true;
      }
    }

    // 4. Pattern A (Standard): Qty x Size -> "10x900g", "10 x 900g", "2 x 1.5L", "18 x 125ml", "6x245/250ml", "2 × 5 كجم"
    const patternA = clean.match(
      /^(\d+)\s*(?:pcs?|pieces?|bags?|cans?|bottles?|حبة|حبات|قطع|أكياس|كيس)?\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?(?:[\/-]\d+(?:\.\d+)?)?)\s*([a-zA-Z\u0600-\u06FF]+)$/i
    );
    if (patternA) {
      const q = parseInt(patternA[1], 10);
      const sizeStr = patternA[2];
      const uStr = patternA[3];

      // Check if sizeStr has range e.g. "245/250"
      if (/[\/-]/.test(sizeStr)) {
        const rangeRes = parseNumericRange(sizeStr, uStr);
        if (rangeRes) {
          packQuantity = q;
          eachSizeValue = rangeRes.sizeValue;
          eachSizeUnit = rangeRes.unit;
          isNarrowVariantRange = rangeRes.isNarrowRange;
          isWideVariantRange = rangeRes.isWideRange;
          return true;
        }
      } else {
        const u = canonicalizeUnit(uStr);
        if (u) {
          packQuantity = q;
          eachSizeValue = parseFloat(sizeStr);
          eachSizeUnit = u;
          return true;
        }
      }
    }

    // 5. Pattern with Range in simple size e.g. "117-150gm", "185g / 170g", "137.5-154gm"
    const standaloneRange = clean.match(/^(\d+(?:\.\d+)?\s*(?:[a-zA-Z\u0600-\u06FF]+)?\s*[\/-]\s*\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)$/i);
    if (standaloneRange) {
      const rangeRes = parseNumericRange(standaloneRange[1], standaloneRange[2]);
      if (rangeRes) {
        packQuantity = (!isPromoMechanic && ai_pack_quantity && ai_pack_quantity > 0) ? ai_pack_quantity : 1;
        eachSizeValue = rangeRes.sizeValue;
        eachSizeUnit = rangeRes.unit;
        isNarrowVariantRange = rangeRes.isNarrowRange;
        isWideVariantRange = rangeRes.isWideRange;
        return true;
      }
    }

    // 6. Simple Single Unit: "500gm", "5 Kg", "2.25Kg", "1.5L", "330ml", "90gm", "160gm"
    const singleUnit = clean.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z\u0600-\u06FF]+)$/i);
    if (singleUnit) {
      if (isTechOrCellularToken(singleUnit[2]) || isTechOrCellularToken(clean)) {
        return false;
      }
      const u = canonicalizeUnit(singleUnit[2]);
      if (u) {
        packQuantity = (!isPromoMechanic && ai_pack_quantity && ai_pack_quantity > 0) ? ai_pack_quantity : 1;
        eachSizeValue = parseFloat(singleUnit[1]);
        eachSizeUnit = u;
        return true;
      }
    }

    return false;
  };

  // Attempt 1: Parse from raw size_text
  if (rawStr && tryParseToken(rawStr)) {
    parsedFromText = true;
  }

  // Attempt 2: If size_text failed or was empty, search English and Arabic titles for embedded expressions
  if (!parsedFromText) {
    const titlesToSearch = [title_en, title_ar].filter(Boolean) as string[];
    for (const title of titlesToSearch) {
      const normalizedTitle = normalizeArabicNumerals(title);
      // Look for embedded expressions e.g. "10 x 900g", "900gm x 10", "155gm x 2", "30s", "500gm", "2 × 5 كجم"
      const candidateMatches = normalizedTitle.match(
        /\b\d+\s*(?:pcs?|pieces?|bags?|cans?|bottles?|حبة|حبات|قطع|أكياس|كيس)?\s*(?:x|×|\*)\s*\d+(?:\.\d+)?(?:[\/-]\d+(?:\.\d+)?)?\s*[a-zA-Z\u0600-\u06FF]+|\b\d+(?:\.\d+)?\s*[a-zA-Z\u0600-\u06FF]+\s*(?:x|×|\*)\s*\d+|\b\d+(?:\.\d+)?\s*[a-zA-Z\u0600-\u06FF]+\s+\d+\s*s|\b\d+\s*s\b|\b\d+(?:\.\d+)?\s*(?:kg|g|gm|ml|l|ltr|pcs|كيلو|كجم|جم|جرام|مل|لتر)\b/gi
      );
      if (candidateMatches) {
        for (const candidate of candidateMatches) {
          if (tryParseToken(candidate)) {
            parsedFromText = true;
            break;
          }
        }
      }
      if (parsedFromText) break;
    }
  }

  // Attempt 3: If still not parsed from text, check price_basis or unit_type
  if (!parsedFromText) {
    if (price_basis === 'per_kg' || (unit_type && unit_type.toLowerCase().includes('kg'))) {
      packQuantity = 1;
      eachSizeValue = 1;
      eachSizeUnit = 'kg';
      parsedFromText = true;
    } else if (price_basis === 'per_2kg') {
      packQuantity = 1;
      eachSizeValue = 2;
      eachSizeUnit = 'kg';
      parsedFromText = true;
    } else if (price_basis === 'per_dozen' || (unit_type && unit_type.toLowerCase().includes('dozen'))) {
      packQuantity = 1;
      eachSizeValue = 12;
      eachSizeUnit = 'pcs';
      parsedFromText = true;
    }
  }

  // Attempt 4: AI decomposition fallback / corroboration
  if (!parsedFromText && ai_each_size_value && ai_each_size_unit) {
    if (!isTechOrCellularToken(rawStr) && !isTechOrCellularToken(ai_each_size_unit) && !isElectronicsOrAppliance) {
      const canonAiUnit = canonicalizeUnit(ai_each_size_unit);
      if (canonAiUnit) {
        packQuantity = (!isPromoMechanic && ai_pack_quantity && ai_pack_quantity > 0) ? ai_pack_quantity : 1;
        eachSizeValue = ai_each_size_value;
        eachSizeUnit = canonAiUnit;
        parsedFromText = true;
      }
    }
  }

  // If AI flags non-uniform sizes across variants explicitly, mark as wide range
  if (is_uniform_size_across_variants === false) {
    isWideVariantRange = true;
  }

  // Guard: If customer purchase limit was detected and packQuantity equals the limit without
  // an explicit physical multipack parsed from text, isolate the limit from physical pack count!
  const hasExplicitMultipackText = Boolean(
    (rawStr && /\b\d+\s*(?:pcs?|pieces?|bags?|cans?|bottles?|حبة|حبات|قطع|أكياس|كيس)?\s*(?:x|×|\*)\s*\d+/i.test(rawStr)) ||
    (title_en && /\b\d+\s*(?:pcs?|pieces?|bags?|cans?|bottles?|حبة|حبات|قطع|أكياس|كيس)?\s*(?:x|×|\*)\s*\d+/i.test(title_en)) ||
    (title_ar && /\b\d+\s*(?:pcs?|pieces?|bags?|cans?|bottles?|حبة|حبات|قطع|أكياس|كيس)?\s*(?:x|×|\*)\s*\d+/i.test(title_ar))
  );
  if (limitCheck.hasLimit && !hasExplicitMultipackText && packQuantity === limitCheck.limitPcs && packQuantity > 1) {
    packQuantity = 1;
  }

  // Determine standardizations and comparison safety
  let totalContentValue: number | null = null;
  let totalContentUnit: CanonicalExtractionUnit | null = null;
  let standardizedUnit: 'kilogram' | 'liter' | 'piece' | null = null;
  let standardizedTotalValue: number | null = null;
  let standardizedUnitPrice: number | null = null;
  let comparisonEligible = false;
  let exclusionReason: string | null = null;

  if (isWideVariantRange) {
    comparisonEligible = false;
    exclusionReason = 'variable_weight_range';
  } else if (eachSizeValue !== null && eachSizeUnit !== null && eachSizeValue > 0) {
    const bundleMult = bundle_quantity && bundle_quantity > 0 ? bundle_quantity : 1;
    totalContentValue = Number((packQuantity * eachSizeValue * bundleMult).toFixed(4));
    totalContentUnit = eachSizeUnit;

    if (eachSizeUnit === 'g') {
      standardizedUnit = 'kilogram';
      standardizedTotalValue = Number((totalContentValue / 1000).toFixed(4));
    } else if (eachSizeUnit === 'kg') {
      standardizedUnit = 'kilogram';
      standardizedTotalValue = totalContentValue;
    } else if (eachSizeUnit === 'ml') {
      standardizedUnit = 'liter';
      standardizedTotalValue = Number((totalContentValue / 1000).toFixed(4));
    } else if (eachSizeUnit === 'l') {
      standardizedUnit = 'liter';
      standardizedTotalValue = totalContentValue;
    } else if (eachSizeUnit === 'pcs') {
      standardizedUnit = 'piece';
      standardizedTotalValue = totalContentValue;
    } else {
      // 'roll', 'sheet', etc.
      standardizedUnit = null;
      standardizedTotalValue = totalContentValue;
      exclusionReason = 'unsupported_comparison_unit';
    }

    if (standardizedUnit && standardizedTotalValue && standardizedTotalValue > 0) {
      if (offer_price && !isNaN(offer_price) && offer_price > 0) {
        standardizedUnitPrice = Number((offer_price / standardizedTotalValue).toFixed(2));
      }
      comparisonEligible = true;
      exclusionReason = null;
    }
  } else {
    // If unit is known but value is null, or neither is known:
    if (rawStr && /unknownunit/i.test(rawStr)) {
      exclusionReason = 'unsupported_comparison_unit';
    } else {
      exclusionReason = 'missing_total_content';
    }
  }

  return {
    pack_quantity: packQuantity,
    bundle_quantity: bundleQty,
    each_size_value: eachSizeValue,
    each_size_unit: eachSizeUnit,
    total_content_value: totalContentValue,
    total_content_unit: totalContentUnit,
    standardized_unit: standardizedUnit,
    standardized_total_value: standardizedTotalValue,
    standardized_unit_price: standardizedUnitPrice,
    comparison_eligible: comparisonEligible,
    exclusion_reason: exclusionReason,
    is_narrow_variant_range: isNarrowVariantRange,
    raw_size_text: size_text || (eachSizeValue && eachSizeUnit ? `${eachSizeValue}${eachSizeUnit}` : null)
  };
}

/**
 * Applies deterministic business normalization to extracted offers:
 * 1. Cleans hyphenated and superscript prices.
 * 2. Enforces that if no original_price_box exists, original_price MUST be null.
 * 3. Enforces that original_price must be strictly greater than promo_price if present.
 * 4. Normalizes and validates quantity / unit metrics.
 */
export function normalizeExtractedOffer(offer: ExtractedOfferRev1): ExtractedOfferRev1 {
  const normalizedPromo = normalizePriceValue(offer.promo_price) ?? offer.promo_price;
  let normalizedOriginal = normalizePriceValue(offer.original_price);

  // If no separate secondary price badge exists or original_price is null:
  if (!offer.components.original_price_box || normalizedOriginal === null) {
    normalizedOriginal = null;
    offer.components.original_price_box = null;
  }

  // Sanitize size value
  let cleanSize = offer.size_value ? offer.size_value.trim() : null;
  if (cleanSize) {
    // Standardize spacing around multiplication e.g. "8 x 135 g" -> "8x135g"
    cleanSize = cleanSize
      .replace(/\s*[xX×]\s*/g, 'x')
      .replace(/(\d+)\s*([gG]|kg|KG|Kg|ml|ML|l|L|PCS|pcs|Pcs)/g, '$1$2')
      .trim();
    // Special handling for "2 Kg" vs "2kg"
    if (/^\d+\s*kg$/i.test(cleanSize)) {
      cleanSize = cleanSize.replace(/(\d+)\s*kg/i, '$1 Kg');
    }
  }

  // Parse and normalize quantitative decomposition
  const qtyNorm = parseAndNormalizeQuantity({
    size_text: cleanSize,
    title_en: offer.english_title,
    title_ar: offer.arabic_title,
    unit_type: offer.unit_type,
    ai_pack_quantity: offer.pack_quantity,
    ai_each_size_value: offer.each_size_value,
    ai_each_size_unit: offer.each_size_unit,
    is_uniform_size_across_variants: offer.is_uniform_size_across_variants,
    offer_price: normalizedPromo
  });

  return {
    ...offer,
    promo_price: normalizedPromo,
    original_price: normalizedOriginal,
    size_value: cleanSize || qtyNorm.raw_size_text,
    pack_quantity: qtyNorm.pack_quantity,
    each_size_value: qtyNorm.each_size_value,
    each_size_unit: qtyNorm.each_size_unit,
    is_uniform_size_across_variants: offer.is_uniform_size_across_variants ?? !qtyNorm.is_narrow_variant_range
  };
}
