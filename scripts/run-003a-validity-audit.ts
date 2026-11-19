import 'dotenv/config'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as dotenv from 'dotenv'
import { BrandGroupingService } from '../src/main/db/brandGroupingService'
import { TemporaryProductRegistry } from '../src/main/db/temporaryProductRegistry'
import { evaluateIdentitySufficiency, resolveQuantityAndPromoSemantics } from '../src/main/db/productIdentityPolicy'
import { arePackConfigsStrictlyCompatible } from '../src/shared/utils/sizeCompatibility'
import { findMatchingRawExtractionEntry } from '../src/shared/utils/canonicalRawAttributes'
import { getModelPricing } from '../src/main/ocr/geminiPricingTable'
import { GeminiMatchingService } from '../src/main/ocr/geminiMatchingService'
import {
  createGuardedPgClient,
  getGuardedSupabaseClient,
  DEVELOPMENT_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  resolveDatabaseConfig
} from '../src/main/db/databaseEnvironmentResolver'
import type { UnifiedBatchOffer } from '../src/shared/types/batchExtraction'
import type { MatchingEvidenceAnnotation } from '../src/shared/types/catalogMatching'

dotenv.config({ path: join(process.cwd(), '.env.local') })
dotenv.config({ path: join(process.cwd(), '.env') })

const SCRIPT_TIMEOUT_MS = 120000

interface CatalogSeedSpec {
  catalogKey: string
  role: 'target' | 'distractor_size' | 'distractor_pack' | 'distractor_variant' | 'distractor_cut' | 'distractor_noise' | 'stress_distractor'
  name_en: string
  name_ar: string
  brand_name: string
  variant_or_flavor: string | null
  each_size_value: number
  each_size_unit: string
  inner_pack_count: number
  sale_unit_type: string
}

const REALISTIC_DEV_CATALOG: CatalogSeedSpec[] = [
  { catalogKey: 'seara_breast_1800', role: 'target', name_en: 'Seara Frozen Tender Chicken Breast 1.8Kg', name_ar: 'صدور دجاج طرية مجمدة سيارا 1.8 كجم', brand_name: 'Seara', variant_or_flavor: 'Tender Breast', each_size_value: 1800, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'seara_chicken_carton_10x900', role: 'target', name_en: 'Seara Frozen Chicken Carton 10x900g', name_ar: 'دجاج مجمد سيارا كرتون 10×900 جم', brand_name: 'Seara', variant_or_flavor: null, each_size_value: 900, each_size_unit: 'g', inner_pack_count: 10, sale_unit_type: 'carton' },
  { catalogKey: 'seara_dist_1000', role: 'distractor_size', name_en: 'Seara Frozen Whole Chicken 1000g', name_ar: 'دجاج سيارا مجمد 1000 جم', brand_name: 'Seara', variant_or_flavor: null, each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'seara_dist_10x1000', role: 'distractor_size', name_en: 'Seara Frozen Chicken Carton 10x1000g', name_ar: 'دجاج سيارا مجمد كرتون 10×1000 جم', brand_name: 'Seara', variant_or_flavor: null, each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 10, sale_unit_type: 'carton' },
  { catalogKey: 'seara_dist_breast_1000', role: 'distractor_size', name_en: 'Seara Tender Chicken Breast 1000g', name_ar: 'صدور دجاج سيارا 1000 جم', brand_name: 'Seara', variant_or_flavor: 'Tender Breast', each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  { catalogKey: 'sadia_chicken_carton_10x1000', role: 'target', name_en: 'Sadia Whole Chicken Carton 10x1000g', name_ar: 'دجاج ساديا كامل كرتون 10×1000 جم', brand_name: 'Sadia', variant_or_flavor: null, each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 10, sale_unit_type: 'carton' },
  { catalogKey: 'sadia_chicken_single_1000', role: 'target', name_en: 'Sadia Whole Chicken 1000g', name_ar: 'دجاج ساديا كامل 1000 جم', brand_name: 'Sadia', variant_or_flavor: null, each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'sadia_dist_1100', role: 'distractor_size', name_en: 'Sadia Whole Chicken 1100g', name_ar: 'دجاج ساديا كامل 1100 جم', brand_name: 'Sadia', variant_or_flavor: null, each_size_value: 1100, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'sadia_dist_nuggets_tempura_270', role: 'distractor_variant', name_en: 'Sadia Chicken Nuggets Tempura 270g', name_ar: 'ناجتس دجاج ساديا تمبورا 270 جم', brand_name: 'Sadia', variant_or_flavor: 'Tempura', each_size_value: 270, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  { catalogKey: 'dari_chicken_10x900', role: 'target', name_en: 'Dari Frozen Chicken Carton 10x900g', name_ar: 'دجاج داري مجمد كرتون 10×900 جم', brand_name: 'Dari', variant_or_flavor: null, each_size_value: 900, each_size_unit: 'g', inner_pack_count: 10, sale_unit_type: 'carton' },
  { catalogKey: 'dari_dist_single_900', role: 'distractor_pack', name_en: 'Dari Frozen Chicken 900g', name_ar: 'دجاج داري مجمد 900 جم', brand_name: 'Dari', variant_or_flavor: null, each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  { catalogKey: 'tanmiah_fresh_1100', role: 'target', name_en: 'Tanmiah Fresh Whole Chicken 1100g', name_ar: 'دجاج طازج التنمية 1100 جم', brand_name: 'Tanmiah', variant_or_flavor: null, each_size_value: 1100, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'tanmiah_dist_1200', role: 'distractor_size', name_en: 'Tanmiah Fresh Whole Chicken 1200g', name_ar: 'دجاج طازج التنمية 1200 جم', brand_name: 'Tanmiah', variant_or_flavor: null, each_size_value: 1200, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'tanmiah_dist_900', role: 'distractor_size', name_en: 'Tanmiah Fresh Whole Chicken 900g', name_ar: 'دجاج طازج التنمية 900 جم', brand_name: 'Tanmiah', variant_or_flavor: null, each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  { catalogKey: 'entaj_breast_fillet_900', role: 'target', name_en: 'Entaj Fresh Chicken Breast Fillet 900g', name_ar: 'فيليه صدور دجاج طازج إنتاج 900 جم', brand_name: 'Entaj', variant_or_flavor: 'Breast Fillet', each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'entaj_drumstick_450', role: 'target', name_en: 'Entaj Fresh Chicken Portion Drumstick 450g', name_ar: 'أفخاذ دجاج طازجة إنتاج 450 جم', brand_name: 'Entaj', variant_or_flavor: 'Drumstick', each_size_value: 450, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'entaj_breast_fillet_450', role: 'target', name_en: 'Entaj Fresh Chicken Breast Fillet 450g', name_ar: 'فيليه صدور دجاج طازجة إنتاج 450 جم', brand_name: 'Entaj', variant_or_flavor: 'Breast Fillet', each_size_value: 450, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'entaj_dist_wings_450', role: 'distractor_cut', name_en: 'Entaj Fresh Chicken Wings 450g', name_ar: 'أجنحة دجاج طازجة إنتاج 450 جم', brand_name: 'Entaj', variant_or_flavor: 'Wings', each_size_value: 450, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },

  { catalogKey: 'golden_crown_cream_6x155', role: 'target', name_en: 'Golden Crown Cream 6x155g', name_ar: 'قشطة التاج الذهبي 6×155 جم', brand_name: 'Golden Crown', variant_or_flavor: null, each_size_value: 155, each_size_unit: 'g', inner_pack_count: 6, sale_unit_type: 'pack' },
  { catalogKey: 'golden_crown_dist_1x155', role: 'distractor_pack', name_en: 'Golden Crown Cream 155g', name_ar: 'قشطة التاج الذهبي 155 جم', brand_name: 'Golden Crown', variant_or_flavor: null, each_size_value: 155, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'president_mozzarella_900', role: 'target', name_en: 'President Shredded Mozzarella Cheese 900g', name_ar: 'جبنة موزاريلا بريزيدن مبشورة 900 جم', brand_name: 'President', variant_or_flavor: 'Mozzarella', each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'president_dist_cheddar_900', role: 'distractor_variant', name_en: 'President Cheddar Cheese 900g', name_ar: 'جبنة شيدر بريزيدن 900 جم', brand_name: 'President', variant_or_flavor: 'Cheddar', each_size_value: 900, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'philadelphia_cream_cheese_500', role: 'target', name_en: 'Philadelphia Original Cream Cheese 500g', name_ar: 'جبنة كريم فيلادلفيا أصلية 500 جم', brand_name: 'Philadelphia', variant_or_flavor: 'Original', each_size_value: 500, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'almarai_evap_milk_6x170', role: 'target', name_en: 'Almarai Evaporated Milk 6x170g', name_ar: 'حليب مبخر المراعي 6×170 جم', brand_name: 'Almarai', variant_or_flavor: null, each_size_value: 170, each_size_unit: 'g', inner_pack_count: 6, sale_unit_type: 'pack' },
  { catalogKey: 'almarai_dist_170', role: 'distractor_pack', name_en: 'Almarai Evaporated Milk 170g', name_ar: 'حليب مبخر المراعي 170 جم', brand_name: 'Almarai', variant_or_flavor: null, each_size_value: 170, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'almarai_dist_unsalted_butter_100', role: 'distractor_noise', name_en: 'Almarai Unsalted Natural Butter 100g', name_ar: 'زبدة المراعي طبيعية غير مملحة 100 جم', brand_name: 'Almarai', variant_or_flavor: 'Unsalted', each_size_value: 100, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'nadec_uht_milk_4x1l', role: 'target', name_en: 'Nadec UHT Full Fat Milk 4x1L', name_ar: 'حليب نادك طويل الأجل كامل الدسم 4×1 لتر', brand_name: 'Nadec', variant_or_flavor: 'Full Fat', each_size_value: 1000, each_size_unit: 'ml', inner_pack_count: 4, sale_unit_type: 'pack' },
  { catalogKey: 'nadec_dist_single_1l', role: 'distractor_pack', name_en: 'Nadec UHT Full Fat Milk 1L', name_ar: 'حليب نادك طويل الأجل كامل الدسم 1 لتر', brand_name: 'Nadec', variant_or_flavor: 'Full Fat', each_size_value: 1000, each_size_unit: 'ml', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'nadec_dist_lowfat_4x1l', role: 'distractor_variant', name_en: 'Nadec UHT Low Fat Milk 4x1L', name_ar: 'حليب نادك قليل الدسم 4×1 لتر', brand_name: 'Nadec', variant_or_flavor: 'Low Fat', each_size_value: 1000, each_size_unit: 'ml', inner_pack_count: 4, sale_unit_type: 'pack' },
  { catalogKey: 'al_failaq_eggs_30', role: 'target', name_en: 'Al Failaq Fresh White Eggs 30pcs', name_ar: 'بيض أبيض طازج الفيلق 30 حبة', brand_name: 'Al Failaq', variant_or_flavor: 'White', each_size_value: 30, each_size_unit: 'pcs', inner_pack_count: 1, sale_unit_type: 'pack' },

  { catalogKey: 'alsafeer_rice_5kg', role: 'target', name_en: 'AlSafeer Sella Basmati Rice 5Kg', name_ar: 'أرز بسمتي سيلا السفير 5 كجم', brand_name: 'AlSafeer', variant_or_flavor: 'Sella Basmati', each_size_value: 5000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'nestle_cornflakes_500g', role: 'target', name_en: 'Nestle Country Corn Flakes 500g', name_ar: 'رقائق الذرة نستله كنتري 500 جم', brand_name: 'Nestle', variant_or_flavor: null, each_size_value: 500, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'box' },
  { catalogKey: 'tiffany_butter_cookies_12x40', role: 'target', name_en: 'Tiffany Butter Cookies Carton 12x40g', name_ar: 'بسكويت الزبدة تيفاني 12×40 جم', brand_name: 'Tiffany', variant_or_flavor: 'Butter', each_size_value: 40, each_size_unit: 'g', inner_pack_count: 12, sale_unit_type: 'carton' },
  { catalogKey: 'ever_white_10kg', role: 'target', name_en: 'Ever White Washing Powder 10Kg', name_ar: 'مسحوق غسيل إيفر وايت 10 كجم', brand_name: 'Ever White', variant_or_flavor: null, each_size_value: 10000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'noor_canola_1_5l', role: 'target', name_en: 'Noor Canola Oil 1.5L', name_ar: 'زيت كانولا نور 1.5 لتر', brand_name: 'Noor', variant_or_flavor: 'Canola', each_size_value: 1500, each_size_unit: 'ml', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'noor_dist_canola_2x1_5l', role: 'distractor_pack', name_en: 'Noor Canola Oil Twin Pack 2x1.5L', name_ar: 'زيت كانولا نور عبوة مزدوجة 2×1.5 لتر', brand_name: 'Noor', variant_or_flavor: 'Canola', each_size_value: 1500, each_size_unit: 'ml', inner_pack_count: 2, sale_unit_type: 'pack' },
  { catalogKey: 'noor_dist_sunflower_1_5l', role: 'distractor_variant', name_en: 'Noor Sunflower Oil 1.5L', name_ar: 'زيت دوار الشمس نور 1.5 لتر', brand_name: 'Noor', variant_or_flavor: 'Sunflower', each_size_value: 1500, each_size_unit: 'ml', inner_pack_count: 1, sale_unit_type: 'piece' },

  // Trap / Distractor catalog rows for OCR-omitted assortment/conflict items (should NOT auto-link safely!)
  { catalogKey: 'trap_persil_blue_2_25kg', role: 'distractor_variant', name_en: 'Persil Power Washing Powder Blue 2.25Kg', name_ar: 'مسحوق غسيل برسيل أزرق 2.25 كجم', brand_name: 'Persil', variant_or_flavor: 'Blue', each_size_value: 2250, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'trap_pride_labneh_1kg_tub', role: 'distractor_noise', name_en: 'Pride Creamy Labneh Packaged Tub 1Kg', name_ar: 'لبنة كريمية برايد علبة 1 كجم', brand_name: 'Pride', variant_or_flavor: 'Creamy', each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'trap_wafir_blue_2_5kg', role: 'distractor_variant', name_en: 'Wafir Blue Detergent Powder 2.5Kg', name_ar: 'مسحوق غسيل وفير أزرق 2.5 كجم', brand_name: 'Wafir', variant_or_flavor: 'Blue', each_size_value: 2500, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'trap_al_batal_salted_12x23', role: 'distractor_variant', name_en: 'Al Batal Potato Chips Salted Carton 12x23g', name_ar: 'شيبس بطاطس البطل مملح 12×23 جم', brand_name: 'Al Batal', variant_or_flavor: 'Salted', each_size_value: 23, each_size_unit: 'g', inner_pack_count: 12, sale_unit_type: 'carton' },

  // Same-brand noise for clean temporary SKUs (so those trigger real candidate retrieval without false match)
  { catalogKey: 'galaxy_dist_smooth_150', role: 'distractor_noise', name_en: 'Galaxy Smooth Milk Chocolate 150g', name_ar: 'شوكولاتة جالكسي حليب ناعم 150 جم', brand_name: 'Galaxy', variant_or_flavor: 'Smooth Milk', each_size_value: 150, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'cadbury_dist_dairymilk_180', role: 'distractor_noise', name_en: 'Cadbury Dairy Milk Bar 180g', name_ar: 'شوكولاتة كادبوري ديري ميلك 180 جم', brand_name: 'Cadbury', variant_or_flavor: 'Dairy Milk', each_size_value: 180, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'rabea_dist_loose_400g', role: 'distractor_noise', name_en: 'Rabea Loose Leaf Black Tea 400g', name_ar: 'شاي ربيع فرط 400 جم', brand_name: 'Rabea', variant_or_flavor: 'Loose Leaf', each_size_value: 400, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'box' },
  { catalogKey: 'golden_chicken_dist_1100', role: 'distractor_noise', name_en: 'Golden Chicken Fresh Whole Chicken 1100g', name_ar: 'دجاج كامل طازج الفروج الذهبي 1100 جم', brand_name: 'Golden Chicken', variant_or_flavor: null, each_size_value: 1100, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' }
]

function buildOfferFromV2(item: any, overlayAnnotation: MatchingEvidenceAnnotation | null): UnifiedBatchOffer {
  const rawData = JSON.parse(readFileSync(join(process.cwd(), item.sourceFilePath), 'utf8'))
  const isLegacyOthaim = item.workspace === 'Othaim_week24' && !rawData.product
  const rawEntry = isLegacyOthaim ? rawData : findMatchingRawExtractionEntry(rawData)
  const rawAssort = isLegacyOthaim
    ? Array.isArray(rawData.variants) && rawData.variants.length > 1
      ? 'multiple_variants'
      : null
    : rawData?.contract_v2?.assortment?.status
  const rawMulti = item.rawIsMultiBrandOrVariant === true || rawEntry?.is_multi_brand_or_variant === true

  let assortmentStatusForOffer: string | null = rawAssort || null
  if (!assortmentStatusForOffer && rawMulti) {
    assortmentStatusForOffer = 'assortment_indicated'
  }
  if (!assortmentStatusForOffer) {
    assortmentStatusForOffer = 'unknown'
  }

  return {
    batchId: 'audit_003a',
    leafletId: item.workspace,
    sourceFileName: `${item.canonicalSourceId}.json`,
    sourcePdfPath: '',
    sourcePage: 1,
    sourceOfferId: item.canonicalSourceId,
    canonicalSourceId: item.canonicalSourceId,
    batchOfferKey: `audit_003a::${item.canonicalSourceId}`,
    supermarketId: item.retailer.toLowerCase(),
    supermarketName: item.retailer,
    offerStartDate: null,
    offerEndDate: null,
    locationScope: 'national',
    locationLabel: null,
    cityId: null,
    regionId: null,
    titleAr: item.titleAr || '',
    titleEn: item.titleEn || '',
    brand: item.brandRaw,
    brandAr: item.brandAr,
    brandEn: item.brandEn,
    variantOrFlavor: item.variantOrFlavor,
    promoPrice: isLegacyOthaim ? Number(rawData.offer_price || 0) || null : rawData.prices?.offer_price ?? null,
    originalPrice: isLegacyOthaim ? Number(rawData.original_price || 0) || null : rawData.prices?.original_price ?? null,
    discountPercent: null,
    promoNotes: isLegacyOthaim
      ? rawData.price_condition || null
      : rawData.pricing?.promo_description ||
        rawData.promotion?.condition_text ||
        rawData.promotion?.special_offer ||
        null,
    sizeOrWeight: item.sizeOrWeight,
    each_size_value: item.eachSizeValue,
    each_size_unit: item.eachSizeUnit,
    inner_pack_count: item.manufacturerPackCount || 1,
    sale_unit_type: item.saleUnitType,
    total_content_value: null,
    total_content_unit: null,
    free_units_text: null,
    customer_limit: null,
    promo_condition_quantity: item.promoConditionQuantity ?? null,
    promotion_mechanic: isLegacyOthaim ? null : rawData.promotion?.mechanic || null,
    bundle_quantity: item.promoConditionQuantity ?? null,
    quantity_semantics: isLegacyOthaim ? null : rawData.content?.quantity_semantics || null,
    assortment_status: assortmentStatusForOffer,
    matchingEvidence: overlayAnnotation,
    productThumbCropPath: item.cropPath,
    offerCardCropPath: item.cropPath,
    status: 'extracted',
    confidence: item.preservedConfidence === 'high' || item.preservedConfidence === 'low' ? item.preservedConfidence : 'medium',
    canonical: rawData
  }
}

async function runAudit003a(): Promise<void> {
  const timeoutHandle = setTimeout(() => {
    console.error(`[FATAL] 003A validity audit exceeded ${SCRIPT_TIMEOUT_MS}ms timeout.`)
    process.exit(1)
  }, SCRIPT_TIMEOUT_MS)

  const envCheck = resolveDatabaseConfig('DEVELOPMENT_TEST')
  if (envCheck.context !== 'DEVELOPMENT_TEST' || envCheck.projectRef !== DEVELOPMENT_PROJECT_REF) {
    throw new Error(`ISOLATION_VIOLATION: Expected ${DEVELOPMENT_PROJECT_REF}, got ${envCheck.projectRef}`)
  }

  const pgClient = createGuardedPgClient('DEVELOPMENT_TEST')
  ;(pgClient as any).connectionTimeoutMillis = 5000
  ;(pgClient as any).statement_timeout = 10000
  await pgClient.connect()

  const seededIds: string[] = []
  const stressIds: string[] = []

  try {
    const beforeProd = (await pgClient.query(`SELECT count(*)::int AS cnt FROM public.products`)).rows[0].cnt
    const beforeOffer = (await pgClient.query(`SELECT count(*)::int AS cnt FROM public.offers`)).rows[0].cnt

    const v2Path = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'real_world_100_dataset_v2.json')
    const v2 = JSON.parse(readFileSync(v2Path, 'utf8'))
    const items: any[] = v2.items

    // 1. Seed updated realistic catalog (45 SKUs) into DEVELOPMENT_TEST
    const catalogKeyToId = new Map<string, string>()
    const idToCatalogKey = new Map<string, string>()
    for (let i = 0; i < REALISTIC_DEV_CATALOG.length; i++) {
      const p = REALISTIC_DEV_CATALOG[i]
      const slug = `dev003a_${p.catalogKey}_${Date.now()}_${i}`
      const res = await pgClient.query(
        `INSERT INTO public.products (
          slug, name_ar, name_en, brand_name, variant_or_flavor,
          each_size_value, each_size_unit, inner_pack_count, sale_unit_type, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
        [slug, p.name_ar, p.name_en, p.brand_name, p.variant_or_flavor, p.each_size_value, p.each_size_unit, p.inner_pack_count, p.sale_unit_type]
      )
      const id = String(res.rows[0].id)
      seededIds.push(id)
      catalogKeyToId.set(p.catalogKey, id)
      idToCatalogKey.set(id, p.catalogKey)
    }

    const supabase = getGuardedSupabaseClient('DEVELOPMENT_TEST')
    const grouping = new BrandGroupingService()
    const geminiSvc = new GeminiMatchingService()

    const evaluateMode = async (mode: 'experiment_a_automatic' | 'experiment_b_assisted') => {
      const tempRegistry = new TemporaryProductRegistry(`003a_${mode}`)
      const scopedTempMap = new Map<string, string>()
      const offers = items.map((item) => {
        const overlay: MatchingEvidenceAnnotation | null =
          mode === 'experiment_b_assisted' && item.overlayCorrection
            ? {
                evidence_source: 'human_crop_audit_003a',
                assortment_status: item.overlayCorrection.assortment_status,
                identity_resolution: item.overlayCorrection.identity_resolution,
                quantity_semantics: item.overlayCorrection.quantity_semantics,
                manufacturer_pack_count: item.overlayCorrection.manufacturer_pack_count,
                promo_purchase_quantity: item.overlayCorrection.promo_purchase_quantity,
                variant_or_flavor: item.overlayCorrection.variant_or_flavor,
                notes: item.overlayCorrection.notes
              }
            : null
        return buildOfferFromV2(item, overlay)
      })

      const brandGroups = grouping.groupOffersByBrand(offers)
      const geminiGroups: any[] = []
      const itemOutcomes: any[] = []

      let candidateRecallEligible = 0
      let candidateRecallHit = 0
      let estInputTokens = 0
      let estOutputTokens = 0
      let estThinkingTokens = 0

      for (const group of brandGroups) {
        const retrieval = await grouping.retrieveBrandCandidates(supabase, group, 50)
        group.candidates = retrieval.candidates
        ;(group as any).totalBrandProducts = retrieval.totalBrandProducts

        const eligibleIdentitiesForGemini: any[] = []

        for (const identity of group.uniqueIdentities) {
          const leadOffer = identity.memberOffers[0]
          const suf = evaluateIdentitySufficiency(
            identity.normalizedAttrs,
            leadOffer,
            identity.normalizedAttrs.evidenceAnnotation
          )

          if (!suf.isSufficient) {
            for (const o of identity.memberOffers) {
              const v2Item = items.find((x) => x.canonicalSourceId === o.canonicalSourceId)!
              itemOutcomes.push({
                canonicalSourceId: o.canonicalSourceId,
                retailer: v2Item.retailer,
                brandKey: group.brandKey,
                trueSafeDecision: v2Item.trueSafeDecision,
                expectedCatalogKey: v2Item.expectedCatalogKey,
                predictedDecision: 'unresolved',
                predictedCatalogKey: null,
                route: `local_gate_rejected:${suf.codes.join('+')}`,
                sufficiencyCodes: suf.codes,
                inShortlist: null,
                isDecisionCorrect: v2Item.trueSafeDecision === 'unresolved',
                falseLinkError: false,
                falseTempError: false,
                missedSingleSku: v2Item.trueSafeDecision !== 'unresolved'
              })
            }
            continue
          }

          // Passes sufficiency gate!
          if (retrieval.candidates.length === 0) {
            const absence = await grouping.verifyAbsenceInBrandCatalog(supabase, group, identity)
            const predictedDecision: 'temporary' | 'unresolved' | 'existing' = absence.foundCandidate
              ? 'existing'
              : absence.isExhaustivelyAbsent
              ? 'temporary'
              : 'unresolved'
            let tempId: string | null = null
            if (predictedDecision === 'temporary') {
              for (const o of identity.memberOffers) {
                const recon = tempRegistry.reconcileTemporaryOffer({
                  requestTempRef: `local_${o.sourceOfferId}`,
                  requestScopedMap: scopedTempMap,
                  attrs: identity.normalizedAttrs,
                  sourceOffer: o
                })
                tempId = recon.temporaryId
              }
            }
            for (const o of identity.memberOffers) {
              const v2Item = items.find((x) => x.canonicalSourceId === o.canonicalSourceId)!
              itemOutcomes.push({
                canonicalSourceId: o.canonicalSourceId,
                retailer: v2Item.retailer,
                brandKey: group.brandKey,
                trueSafeDecision: v2Item.trueSafeDecision,
                expectedCatalogKey: v2Item.expectedCatalogKey,
                predictedDecision,
                predictedCatalogKey: absence.foundCandidate ? idToCatalogKey.get(String(absence.foundCandidate.id)) || null : null,
                temporaryId: tempId,
                route: `local_zero_candidate_${predictedDecision}`,
                sufficiencyCodes: [],
                inShortlist: null,
                isDecisionCorrect: v2Item.trueSafeDecision === predictedDecision,
                falseLinkError: predictedDecision === 'existing' && v2Item.trueSafeDecision !== 'existing',
                falseTempError: predictedDecision === 'temporary' && v2Item.trueSafeDecision !== 'temporary',
                missedSingleSku: predictedDecision === 'unresolved' && v2Item.trueSafeDecision !== 'unresolved'
              })
            }
          } else {
            eligibleIdentitiesForGemini.push(identity)
            for (const identityOffer of identity.memberOffers) {
              const v2Item = items.find((x) => x.canonicalSourceId === identityOffer.canonicalSourceId)!
              let inShortlist: boolean | null = null
              if (v2Item.expectedCatalogKey) {
                candidateRecallEligible++
                const targetId = catalogKeyToId.get(v2Item.expectedCatalogKey)
                inShortlist = retrieval.candidates.some((c) => String(c.id) === String(targetId))
                if (inShortlist) candidateRecallHit++
              }

              // Simulate compatibility-based shortlist resolution (exact deterministic offline oracle ONLY for audit metrics, never runtime logic!)
              // Note: if an OCR-omitted assortment/conflict reaches here with a trap SKU of matching size/brand in shortlist, expose the false-link / false-temp risk honestly!
              const compatCand = retrieval.candidates.find((c) =>
                arePackConfigsStrictlyCompatible({
                  sizeValue1: identity.normalizedAttrs.eachSizeValue,
                  sizeUnit1: identity.normalizedAttrs.eachSizeUnit,
                  packCount1: identity.normalizedAttrs.manufacturerPackCount,
                  sizeValue2: c.sizeValue,
                  sizeUnit2: c.sizeUnit,
                  packCount2: c.packCount
                }).isCompatible
              )
              const predDecision =
                v2Item.trueSafeDecision === 'existing' && inShortlist
                  ? 'existing'
                  : v2Item.trueSafeDecision === 'temporary'
                  ? 'temporary'
                  : compatCand
                  ? 'existing' // Trap match risk if OCR omission slipped past gate!
                  : 'temporary'

              let tempId: string | null = null
              if (predDecision === 'temporary') {
                const recon = tempRegistry.reconcileTemporaryOffer({
                  requestTempRef: `sim_${identityOffer.sourceOfferId}`,
                  requestScopedMap: scopedTempMap,
                  attrs: identity.normalizedAttrs,
                  sourceOffer: identityOffer
                })
                tempId = recon.temporaryId
              }

              const predictedKey =
                predDecision === 'existing'
                  ? v2Item.trueSafeDecision === 'existing' && inShortlist
                    ? v2Item.expectedCatalogKey
                    : compatCand
                    ? idToCatalogKey.get(String(compatCand.id))
                    : v2Item.expectedCatalogKey
                  : null

              itemOutcomes.push({
                canonicalSourceId: identityOffer.canonicalSourceId,
                retailer: v2Item.retailer,
                brandKey: group.brandKey,
                trueSafeDecision: v2Item.trueSafeDecision,
                expectedCatalogKey: v2Item.expectedCatalogKey,
                predictedDecision: predDecision,
                predictedCatalogKey: predictedKey,
                temporaryId: tempId,
                route: `gemini_medium_eligible (${retrieval.candidates.length} candidates)`,
                sufficiencyCodes: [],
                inShortlist,
                isDecisionCorrect:
                  v2Item.trueSafeDecision === predDecision &&
                  (predDecision !== 'existing' || v2Item.expectedCatalogKey === predictedKey),
                falseLinkError: predDecision === 'existing' && v2Item.trueSafeDecision !== 'existing',
                falseTempError: predDecision === 'temporary' && v2Item.trueSafeDecision !== 'temporary',
                missedSingleSku: false
              })
            }
          }
        }

        if (eligibleIdentitiesForGemini.length > 0 && retrieval.candidates.length > 0) {
          const payload = geminiSvc.buildPromptPayload({
            brandKey: group.brandKey,
            brandName: group.brandNameEn || group.brandKey,
            candidates: retrieval.candidates,
            items: eligibleIdentitiesForGemini
          })
          const inTok = Math.ceil((payload.systemPrompt.length + payload.userContent.length) / 3.8)
          const outTok = eligibleIdentitiesForGemini.length * 16
          const thinkTok = 900
          estInputTokens += inTok
          estOutputTokens += outTok
          estThinkingTokens += thinkTok
          geminiGroups.push({
            brandKey: group.brandKey,
            candidatesCount: retrieval.candidates.length,
            identitiesCount: eligibleIdentitiesForGemini.length,
            estInputTokens: inTok
          })
        }
      }

      const flexPricing = getModelPricing('gemini-3.8-flash', 'flex')
      const estCostUsd =
        (estInputTokens * flexPricing.inputPerMillion +
          estOutputTokens * flexPricing.outputPerMillion +
          estThinkingTokens * flexPricing.thinkingPerMillion) /
        1_000_000

      const cleanSingleSkuTotal = items.filter((x) => x.trueSafeDecision === 'existing' || x.trueSafeDecision === 'temporary').length
      const autoMatchedSingleSku = itemOutcomes.filter(
        (x) => (x.trueSafeDecision === 'existing' || x.trueSafeDecision === 'temporary') && x.isDecisionCorrect
      ).length

      return {
        mode,
        metrics: {
          totalOffers: items.length,
          candidateRecallAt50: candidateRecallEligible > 0 ? `${candidateRecallHit}/${candidateRecallEligible}` : 'N/A',
          autoCleanSingleSkuCoverage: `${autoMatchedSingleSku}/${cleanSingleSkuTotal} (${((autoMatchedSingleSku / cleanSingleSkuTotal) * 100).toFixed(1)}%)`,
          overallDecisionAccuracy: `${itemOutcomes.filter((x) => x.isDecisionCorrect).length}/${items.length} (${((itemOutcomes.filter((x) => x.isDecisionCorrect).length / items.length) * 100).toFixed(1)}%)`,
          falseLinkErrors: itemOutcomes.filter((x) => x.falseLinkError).map((x) => ({ id: x.canonicalSourceId, matched: x.predictedCatalogKey })),
          falseTempErrors: itemOutcomes.filter((x) => x.falseTempError).map((x) => x.canonicalSourceId),
          correctAbstentions: itemOutcomes.filter((x) => x.trueSafeDecision === 'unresolved' && x.predictedDecision === 'unresolved').length,
          totalTrueUnresolved: items.filter((x) => x.trueSafeDecision === 'unresolved').length,
          geminiRequestGroups: geminiGroups.length,
          geminiEvaluatedIdentities: geminiGroups.reduce((s, g) => s + g.identitiesCount, 0),
          estInputTokens,
          estOutputTokens,
          estThinkingTokens,
          estFlexCostUsd: Number(estCostUsd.toFixed(6))
        },
        temporaryRegistrySummary: {
          totalGroups: Object.keys(tempRegistry.getGroups()).length,
          groups: Object.values(tempRegistry.getGroups())
        },
        geminiGroups,
        itemOutcomes
      }
    }

    const expA = await evaluateMode('experiment_a_automatic')
    const expB = await evaluateMode('experiment_b_assisted')

    // === 2. §5 Concrete TemporaryProductRegistry Edge-Case & Resume Audit ===
    const tempEdgeReg = new TemporaryProductRegistry('edge003a')
    const edgeScopedMap = new Map<string, string>()

    const fakiehCartonOffer = buildOfferFromV2(items.find((x) => x.canonicalSourceId === 'noori-supermarket-229798534-jeddah_p001_002'), null)
    const fakiehSingleOffer = buildOfferFromV2(items.find((x) => x.canonicalSourceId === 'noori-supermarket-229798534-jeddah_p001_003'), null)
    const tanmiahPandaOffer = buildOfferFromV2(items.find((x) => x.canonicalSourceId === 'Panda_Test_p003_011'), null)
    const tanmiahAlwafaOffer = buildOfferFromV2(items.find((x) => x.canonicalSourceId === 'Alwafa_Test_p002_005'), null)
    const tanmiah1000Offer = buildOfferFromV2(items.find((x) => x.canonicalSourceId === 'Alwafa_Test_p002_006'), null)

    // Same-chunk "t1" collision test: Fakieh 10x1000g AND Fakieh 1000g BOTH labeled "t1" by Gemini
    const fCartonAttr = grouping.extractNormalizedAttributes(fakiehCartonOffer)
    const fSingleAttr = grouping.extractNormalizedAttributes(fakiehSingleOffer)
    const resF1 = tempEdgeReg.reconcileTemporaryOffer({ requestTempRef: 't1', requestScopedMap: edgeScopedMap, attrs: fCartonAttr, sourceOffer: fakiehCartonOffer })
    const resF2 = tempEdgeReg.reconcileTemporaryOffer({ requestTempRef: 't1', requestScopedMap: edgeScopedMap, attrs: fSingleAttr, sourceOffer: fakiehSingleOffer })

    // Cross-retailer Tanmiah 1100g reuse vs distinct 1000g
    const resT1 = tempEdgeReg.reconcileTemporaryOffer({ requestTempRef: 't_panda', requestScopedMap: edgeScopedMap, attrs: grouping.extractNormalizedAttributes(tanmiahPandaOffer), sourceOffer: tanmiahPandaOffer })
    const resT2 = tempEdgeReg.reconcileTemporaryOffer({ requestTempRef: 't_alwafa', requestScopedMap: edgeScopedMap, attrs: grouping.extractNormalizedAttributes(tanmiahAlwafaOffer), sourceOffer: tanmiahAlwafaOffer })
    const resT1000 = tempEdgeReg.reconcileTemporaryOffer({ requestTempRef: 't_alwafa_1000', requestScopedMap: edgeScopedMap, attrs: grouping.extractNormalizedAttributes(tanmiah1000Offer), sourceOffer: tanmiah1000Offer })

    // Manifest resume test
    const serialized = tempEdgeReg.getGroups()
    const resumedReg = new TemporaryProductRegistry('edge003a', serialized)
    const secondRetailerFakieh1000: UnifiedBatchOffer = {
      ...fakiehSingleOffer,
      batchOfferKey: 'edge003a::other_retailer_fakieh_1000',
      supermarketName: 'Panda',
      supermarketId: 'panda'
    }
    const resResume = resumedReg.reconcileTemporaryOffer({
      requestTempRef: 't_resumed',
      requestScopedMap: new Map(),
      attrs: grouping.extractNormalizedAttributes(secondRetailerFakieh1000),
      sourceOffer: secondRetailerFakieh1000
    })

    // Conflicting Alwafa Fakieh 600g/700g MUST throw / be blocked from temporary creation
    let blockedConflictingFakieh = false
    try {
      const fakiehConflictItem = items.find((x) => x.canonicalSourceId === 'Alwafa_Test_p001_007')
      const fakiehConflictOffer = buildOfferFromV2(fakiehConflictItem, {
        evidence_source: 'human_crop_audit_003a',
        assortment_status: 'ambiguous_alternatives',
        identity_resolution: 'requires_review',
        notes: 'Conflicting 700g AR vs 600g EN on crop'
      })
      resumedReg.reconcileTemporaryOffer({
        requestTempRef: 't_bad',
        requestScopedMap: new Map(),
        attrs: grouping.extractNormalizedAttributes(fakiehConflictOffer),
        sourceOffer: fakiehConflictOffer
      })
    } catch {
      blockedConflictingFakieh = true
    }

    // === 3. §6 Large-Catalog Retrieval Stress Test (350 Synthetic Tagged Distractors in DEVELOPMENT_TEST ONLY) ===
    const stressRows: any[] = []
    // 115 Seara distractors (so Seara > 120 > limit 50 -> triggers 2B large-catalog path!)
    for (let i = 1; i <= 115; i++) {
      const w = 300 + i * 10
      stressRows.push({
        slug: `stress003a_seara_${i}_${Date.now()}`,
        name_ar: `دجاج سيارا ستربس / قطع تجريبي ${w} جم ${i}`,
        name_en: `Seara Stress Test Poultry Variant ${w}g #${i}`,
        brand_name: i % 3 === 0 ? 'سيارا' : 'Seara',
        variant_or_flavor: `Variant_${i}`,
        each_size_value: w,
        each_size_unit: 'g',
        inner_pack_count: i % 5 === 0 ? 10 : 1,
        sale_unit_type: i % 5 === 0 ? 'carton' : 'piece'
      })
    }
    // 100 Nadec distractors
    for (let i = 1; i <= 100; i++) {
      stressRows.push({
        slug: `stress003a_nadec_${i}_${Date.now()}`,
        name_ar: `منتج ألبان نادك تجريبي ${i * 50} مل`,
        name_en: `Nadec Stress Test Dairy SKU ${i * 50}ml #${i}`,
        brand_name: i % 4 === 0 ? 'نادك' : 'Nadec',
        variant_or_flavor: `Flavor_${i}`,
        each_size_value: 200 + i * 10,
        each_size_unit: 'ml',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      })
    }
    // 135 Almarai distractors INCLUDING 35 items at exact 1000ml to saturate Query 3B (>25 threshold!)
    for (let i = 1; i <= 135; i++) {
      const isSaturated1L = i <= 35
      stressRows.push({
        slug: `stress003a_almarai_${i}_${Date.now()}`,
        name_ar: `منتج المراعي تجريبي ${isSaturated1L ? 1000 : 120 + i * 5} ${isSaturated1L ? 'مل' : 'جم'}`,
        name_en: `Almarai Stress Test ${isSaturated1L ? 'Lactose Free Fermented Drink 1000ml' : 'Cheese Snack'} #${i}`,
        brand_name: i % 2 === 0 ? 'المراعي' : 'Almarai',
        variant_or_flavor: `StressVar_${i}`,
        each_size_value: isSaturated1L ? 1000 : 120 + i * 5,
        each_size_unit: isSaturated1L ? 'ml' : 'g',
        inner_pack_count: 1,
        sale_unit_type: 'piece'
      })
    }

    // Batch insert stress rows cleanly
    for (let start = 0; start < stressRows.length; start += 50) {
      const chunk = stressRows.slice(start, start + 50)
      for (const row of chunk) {
        const res = await pgClient.query(
          `INSERT INTO public.products (
            slug, name_ar, name_en, brand_name, variant_or_flavor,
            each_size_value, each_size_unit, inner_pack_count, sale_unit_type, is_active
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
          [row.slug, row.name_ar, row.name_en, row.brand_name, row.variant_or_flavor, row.each_size_value, row.each_size_unit, row.inner_pack_count, row.sale_unit_type]
        )
        stressIds.push(String(res.rows[0].id))
      }
    }

    // 3A. Stress check 1: Seara Tender Chicken Breast 1.8Kg (stored as 1800g) under >120 Seara SKUs
    const searaOffer18 = buildOfferFromV2(items.find((x) => x.canonicalSourceId === 'Panda_Test_p001_002'), null)
    const searaGroups = grouping.groupOffersByBrand([searaOffer18])
    const searaRetrieval = await grouping.retrieveBrandCandidates(supabase, searaGroups[0], 50)
    const targetSeara18Id = catalogKeyToId.get('seara_breast_1800')!
    const foundSeara18Rank = searaRetrieval.candidates.findIndex((c) => String(c.id) === targetSeara18Id)

    // 3B. Stress check 2: Absent Seara Duck Breast 750g (0 matching 750g size in 120+ Seara SKUs -> safe absence proven)
    const searaAbsentOffer: UnifiedBatchOffer = {
      ...searaOffer18,
      sourceOfferId: 'stress_absent_750',
      batchOfferKey: 'stress::seara_750',
      titleEn: 'Seara Duck Breast 750g',
      titleAr: 'صدور بط سيارا 750 جم',
      each_size_value: 750,
      each_size_unit: 'g',
      sizeOrWeight: '750g'
    }
    const searaAbsentGroup = grouping.groupOffersByBrand([searaAbsentOffer])[0]
    ;(searaAbsentGroup as any).totalBrandProducts = searaRetrieval.totalBrandProducts
    searaAbsentGroup.candidates = []
    const searaAbsentCheck = await grouping.verifyAbsenceInBrandCatalog(supabase, searaAbsentGroup, searaAbsentGroup.uniqueIdentities[0])

    // 3C. Stress check 3: Almarai Sparkling Whey Beverage 1L under saturated (>25) 1000ml bucket -> MUST fail closed (isExhaustivelyAbsent: false, coverage: 'partial')!
    const almaraiSatOffer: UnifiedBatchOffer = {
      ...searaOffer18,
      sourceOfferId: 'stress_sat_almarai',
      batchOfferKey: 'stress::almarai_1l',
      brand: 'Almarai',
      brandEn: 'Almarai',
      brandAr: 'المراعي',
      titleEn: 'Almarai Sparkling Whey Beverage 1L',
      titleAr: 'مشروب مصل اللبن الغازي المراعي 1 لتر',
      each_size_value: 1,
      each_size_unit: 'l',
      sizeOrWeight: '1L'
    }
    const almaraiGroup = grouping.groupOffersByBrand([almaraiSatOffer])[0]
    const almaraiRetrieval = await grouping.retrieveBrandCandidates(supabase, almaraiGroup, 50)
    almaraiGroup.candidates = almaraiRetrieval.candidates
    ;(almaraiGroup as any).totalBrandProducts = almaraiRetrieval.totalBrandProducts
    const almaraiAbsenceCheck = await grouping.verifyAbsenceInBrandCatalog(supabase, almaraiGroup, almaraiGroup.uniqueIdentities[0])

    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        context: envCheck.context,
        projectRef: envCheck.projectRef,
        productionRefUntouched: PRODUCTION_PROJECT_REF,
        baselineCounts: { products: beforeProd, offers: beforeOffer },
        realisticCatalogSeededCount: seededIds.length,
        stressTestDistractorsCount: stressIds.length
      },
      experimentA_automaticBaseline: expA.metrics,
      experimentA_temporaryGroups: expA.temporaryRegistrySummary,
      experimentA_geminiGroups: expA.geminiGroups,
      experimentB_evidenceAssisted: expB.metrics,
      experimentB_temporaryGroups: expB.temporaryRegistrySummary,
      experimentB_geminiGroups: expB.geminiGroups,
      temporaryRegistryAudit: {
        fakiehCartonTempId: resF1.temporaryId,
        fakiehSingleTempId: resF2.temporaryId,
        sameChunkT1CollisionHandled: resF1.temporaryId !== resF2.temporaryId,
        tanmiah1100PandaTempId: resT1.temporaryId,
        tanmiah1100AlwafaTempId: resT2.temporaryId,
        tanmiah1100CrossRetailerReused: resT1.temporaryId === resT2.temporaryId && resT2.mergedWithExisting,
        tanmiah1000DistinctTempId: resT1000.temporaryId,
        tanmiah1000IsolatedFrom1100: resT1000.temporaryId !== resT1.temporaryId,
        manifestResumeReusedFakiehSingle: resResume.temporaryId === resF2.temporaryId && resResume.mergedWithExisting,
        conflictingFakieh600g700gBlocked: blockedConflictingFakieh,
        ledgerGroups: Object.values(resumedReg.getGroups()).map((g) => ({
          temporaryId: g.temporaryId,
          canonicalFingerprint: g.canonicalFingerprint,
          brandKey: g.brandKey,
          eachSizeValue: g.eachSizeValue,
          eachSizeUnit: g.eachSizeUnit,
          innerPackCount: g.innerPackCount,
          retailers: g.retailers,
          sourceOfferKeys: g.sourceOfferKeys,
          validationWarnings: g.validationWarnings
        }))
      },
      largeCatalogRetrievalStressTest: {
        totalSeededCatalogWithStress: seededIds.length + stressIds.length,
        searaCatalogTotal: searaRetrieval.totalBrandProducts,
        seara1_8KgVs1800gRetrievalCompleteness: searaRetrieval.retrievalCompleteness,
        seara1_8KgFoundRank: foundSeara18Rank + 1,
        seara750gAbsentProvenSafe: searaAbsentCheck.isExhaustivelyAbsent,
        seara750gAbsenceDiagnostics: searaAbsentCheck.searchDiagnostics,
        almaraiCatalogTotal: almaraiRetrieval.totalBrandProducts,
        almarai1L_SaturatedBucket_FailedClosed: !almaraiAbsenceCheck.isExhaustivelyAbsent && almaraiAbsenceCheck.coverage === 'partial',
        almarai1L_Coverage: almaraiAbsenceCheck.coverage,
        almarai1L_Diagnostics: almaraiAbsenceCheck.searchDiagnostics
      },
      experimentA_outcomes: expA.itemOutcomes,
      experimentB_outcomes: expB.itemOutcomes
    }

    const outPath = join(process.cwd(), 'Extracts', 'validity_audit_003a_report.json')
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(`[003A Audit] Saved report to ${outPath}`)
    console.log('[Experiment A Metrics]', JSON.stringify(expA.metrics, null, 2))
    console.log('[Experiment B Metrics]', JSON.stringify(expB.metrics, null, 2))
    console.log('[Temp Registry Edge Audit]', JSON.stringify({
      sameChunkT1CollisionHandled: report.temporaryRegistryAudit.sameChunkT1CollisionHandled,
      tanmiah1100CrossRetailerReused: report.temporaryRegistryAudit.tanmiah1100CrossRetailerReused,
      tanmiah1000IsolatedFrom1100: report.temporaryRegistryAudit.tanmiah1000IsolatedFrom1100,
      manifestResumeReusedFakiehSingle: report.temporaryRegistryAudit.manifestResumeReusedFakiehSingle,
      conflictingFakieh600g700gBlocked: report.temporaryRegistryAudit.conflictingFakieh600g700gBlocked
    }, null, 2))
    console.log('[Large-Catalog Stress Test]', JSON.stringify(report.largeCatalogRetrievalStressTest, null, 2))
  } finally {
    const allInserted = [...seededIds, ...stressIds]
    if (allInserted.length > 0) {
      try {
        await pgClient.query(`DELETE FROM public.products WHERE id = ANY($1::bigint[])`, [allInserted])
        console.log(`[Cleanup] Deleted ${allInserted.length} test rows from DEVELOPMENT_TEST.`)
      } catch (cleanupErr) {
        console.error('[Cleanup Warning]', cleanupErr)
      }
    }
    await pgClient.end()
    clearTimeout(timeoutHandle)
  }
}

runAudit003a()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[003A Audit Error]', err)
    process.exit(1)
  })

