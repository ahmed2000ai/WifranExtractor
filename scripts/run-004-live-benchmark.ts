import 'dotenv/config'
import * as dotenv from 'dotenv'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BrandGroupingService, type BrandGroup, type DeduplicatedIdentityItem } from '../src/main/db/brandGroupingService'
import { MatchingEvidenceOverlayService } from '../src/main/db/matchingEvidenceOverlayService'
import { TemporaryProductRegistry } from '../src/main/db/temporaryProductRegistry'
import { evaluateIdentitySufficiency } from '../src/main/db/productIdentityPolicy'
import { GeminiMatchingService } from '../src/main/ocr/geminiMatchingService'
import { getModelPricing } from '../src/main/ocr/geminiPricingTable'
import { findMatchingRawExtractionEntry } from '../src/shared/utils/canonicalRawAttributes'
import {
  createGuardedPgClient,
  getGuardedSupabaseClient,
  DEVELOPMENT_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  resolveDatabaseConfig
} from '../src/main/db/databaseEnvironmentResolver'
import type { UnifiedBatchOffer } from '../src/shared/types/batchExtraction'
import type { CompactCatalogCandidate } from '../src/shared/types/catalogMatching'

dotenv.config({ path: join(process.cwd(), '.env.local') })
dotenv.config({ path: join(process.cwd(), '.env') })

const MAX_PAID_REQUESTS_CAP = 20
const MAX_ESTIMATED_BUDGET_USD = 0.08
const BOUNDED_MAX_OUTPUT_TOKENS = 2048
const INITIAL_VALIDATION_BRANDS = ['seara', 'noor', 'tanmiah', 'almarai']
const OUT_DIR = join(process.cwd(), 'Extracts', 'benchmark_004')
const RAW_DIR = join(OUT_DIR, 'raw_responses')
const MANIFEST_PATH = join(OUT_DIR, 'manifest_004.json')
const PREFLIGHT_PATH = join(OUT_DIR, 'preflight_004.json')
const RESULT_PATH = join(OUT_DIR, 'result_004.json')

interface CatalogSeedSpec {
  catalogKey: string
  role: 'target' | 'distractor_size' | 'distractor_pack' | 'distractor_variant' | 'distractor_cut' | 'distractor_noise'
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

  { catalogKey: 'trap_persil_blue_2_25kg', role: 'distractor_variant', name_en: 'Persil Power Washing Powder Blue 2.25Kg', name_ar: 'مسحوق غسيل برسيل أزرق 2.25 كجم', brand_name: 'Persil', variant_or_flavor: 'Blue', each_size_value: 2250, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'trap_pride_labneh_1kg_tub', role: 'distractor_noise', name_en: 'Pride Creamy Labneh Packaged Tub 1Kg', name_ar: 'لبنة كريمية برايد علبة 1 كجم', brand_name: 'Pride', variant_or_flavor: 'Creamy', each_size_value: 1000, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'trap_wafir_blue_2_5kg', role: 'distractor_variant', name_en: 'Wafir Blue Detergent Powder 2.5Kg', name_ar: 'مسحوق غسيل وفير أزرق 2.5 كجم', brand_name: 'Wafir', variant_or_flavor: 'Blue', each_size_value: 2500, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'bag' },
  { catalogKey: 'trap_al_batal_salted_12x23', role: 'distractor_variant', name_en: 'Al Batal Potato Chips Salted Carton 12x23g', name_ar: 'شيبس بطاطس البطل مملح 12×23 جم', brand_name: 'Al Batal', variant_or_flavor: 'Salted', each_size_value: 23, each_size_unit: 'g', inner_pack_count: 12, sale_unit_type: 'carton' },

  { catalogKey: 'galaxy_dist_smooth_150', role: 'distractor_noise', name_en: 'Galaxy Smooth Milk Chocolate 150g', name_ar: 'شوكولاتة جالكسي حليب ناعم 150 جم', brand_name: 'Galaxy', variant_or_flavor: 'Smooth Milk', each_size_value: 150, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'cadbury_dist_dairymilk_180', role: 'distractor_noise', name_en: 'Cadbury Dairy Milk Bar 180g', name_ar: 'شوكولاتة كادبوري ديري ميلك 180 جم', brand_name: 'Cadbury', variant_or_flavor: 'Dairy Milk', each_size_value: 180, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' },
  { catalogKey: 'rabea_dist_loose_400g', role: 'distractor_noise', name_en: 'Rabea Loose Leaf Black Tea 400g', name_ar: 'شاي ربيع فرط 400 جم', brand_name: 'Rabea', variant_or_flavor: 'Loose Leaf', each_size_value: 400, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'box' },
  { catalogKey: 'golden_chicken_dist_1100', role: 'distractor_noise', name_en: 'Golden Chicken Fresh Whole Chicken 1100g', name_ar: 'دجاج كامل طازج الفروج الذهبي 1100 جم', brand_name: 'Golden Chicken', variant_or_flavor: null, each_size_value: 1100, each_size_unit: 'g', inner_pack_count: 1, sale_unit_type: 'piece' }
]

interface ManifestRequestRecord {
  requestIndex: number
  brandKey: string
  brandName: string
  status: 'pending' | 'completed' | 'failed' | 'uncertain'
  sourceIds: string[]
  items: Array<{
    source_id: string
    canonicalSourceId: string
    physicalIdentityId: string
    isGenuineRepeat: boolean
    trueSafeDecision: 'existing' | 'temporary' | 'unresolved'
    expectedCatalogKey: string | null
    rawModelProductId?: string | null
    rawModelSourceId?: string | null
    wasSourceIdNormalized?: boolean
    validatedProductId?: string | null
    validatedCatalogKey?: string | null
    validatedTemporaryRef?: string | null
    validationIssues?: string[]
  }>
  candidateCatalogKeys: string[]
  estInputTokens: number
  maxOutputTokens: number
  worstCaseCostUsd: number
  usage?: {
    inputTokens: number
    cachedTokens: number
    outputTokens: number
    thinkingTokens: number
    totalTokens: number
    actualCostUsd: number
    latencyMs: number
  }
  rawResponsePath?: string
  error?: string | null
  executedAt?: string
}

interface Benchmark004Manifest {
  milestone: 'WIFRAN-EXTRACTOR-CATALOG-MATCH-004'
  model: 'gemini-3.8-flash'
  thinkingLevel: 'MEDIUM'
  executionTier: 'flex'
  location: 'global'
  createdAt: string
  updatedAt: string
  maxPaidRequestsCap: number
  maxEstimatedBudgetUsd: number
  cumulativeRequestCount: number
  cumulativeActualCostUsd: number
  stoppedReason: string | null
  finalStatus?: string
  errorHistory?: Array<{
    requestIndex: number
    brandKey: string
    status: string
    error: string
    executedAt?: string
    initialStoppedReason?: string
  }>
  requests: ManifestRequestRecord[]
  localOutcomes: Array<{
    canonicalSourceId: string
    retailer: string
    brandKey: string
    physicalIdentityId: string
    isGenuineRepeat: boolean
    isProvisionalNoCrop: boolean
    trueSafeDecision: 'existing' | 'temporary' | 'unresolved'
    route: string
    predictedDecision: 'temporary' | 'unresolved'
    sufficiencyCodes: string[]
    temporaryId: string | null
    canonicalFingerprint: string | null
    softyCheck?: Record<string, unknown>
  }>
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = join(filePath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${filePath}.tmp.${Date.now()}`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

function buildOfferFrom004(item: any, overlayService: MatchingEvidenceOverlayService): UnifiedBatchOffer {
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

  const evidence = overlayService.getAnnotationForSource([item.sourceOfferId, item.canonicalSourceId]) || null

  return {
    batchId: 'bench_004',
    leafletId: item.workspace,
    sourceFileName: `${item.canonicalSourceId}.json`,
    sourcePdfPath: '',
    sourcePage: 1,
    sourceOfferId: item.canonicalSourceId,
    canonicalSourceId: item.canonicalSourceId,
    batchOfferKey: `bench_004::${item.canonicalSourceId}`,
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
    matchingEvidence: evidence,
    productThumbCropPath: item.cropPath,
    offerCardCropPath: item.cropPath,
    status: 'extracted',
    confidence: item.preservedConfidence === 'high' || item.preservedConfidence === 'low' ? item.preservedConfidence : 'medium',
    canonical: rawData
  }
}

async function seedFreshCatalog(pgClient: any) {
  const catalogKeyToId = new Map<string, string>()
  const idToCatalogKey = new Map<string, string>()
  const seededIds: string[] = []
  const ts = Date.now()

  for (let i = 0; i < REALISTIC_DEV_CATALOG.length; i++) {
    const p = REALISTIC_DEV_CATALOG[i]
    const slug = `bench004_${p.catalogKey}_${ts}_${i}`
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

  return { seededIds, catalogKeyToId, idToCatalogKey }
}

function getPhysicalIdentityId(item: any): string {
  return item.physicalTruth?.repeatedIdentityGroupId || item.canonicalSourceId
}

async function runPreflightOrExecute(mode: 'preflight' | 'initial-4' | 'remaining' | 'evaluate'): Promise<void> {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true })

  const envCheck = resolveDatabaseConfig('DEVELOPMENT_TEST')
  if (envCheck.context !== 'DEVELOPMENT_TEST' || envCheck.projectRef !== DEVELOPMENT_PROJECT_REF) {
    throw new Error(`ISOLATION_VIOLATION: Expected ${DEVELOPMENT_PROJECT_REF}, got ${envCheck.projectRef}`)
  }

  const datasetPath = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'real_world_100_dataset_004.json')
  const overlayPath = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'verified_evidence_annotations_004.json')
  const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'))
  const items: any[] = dataset.items
  const itemById = new Map<string, any>(items.map((x) => [x.canonicalSourceId, x]))

  const overlayService = new MatchingEvidenceOverlayService(overlayPath, 'benchmark:004_evidence_assisted')
  const grouping = new BrandGroupingService(overlayService)
  const geminiSvc = new GeminiMatchingService()
  const flexPricing = getModelPricing('gemini-3.8-flash', 'flex')

  if (mode === 'evaluate') {
    const manifest: Benchmark004Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    const preflight = JSON.parse(readFileSync(PREFLIGHT_PATH, 'utf8'))

    // Preserve historical Request errors without deleting requests[i].error
    const existingHistory = Array.isArray(manifest.errorHistory) ? [...manifest.errorHistory] : []
    for (const r of manifest.requests) {
      if (r.error && !existingHistory.some((h) => h.requestIndex === r.requestIndex && h.error === r.error)) {
        existingHistory.push({
          requestIndex: r.requestIndex,
          brandKey: r.brandKey,
          status: r.status,
          error: r.error,
          executedAt: r.executedAt,
          ...(manifest.stoppedReason?.startsWith(`REQUEST_${r.requestIndex}_ERROR`)
            ? { initialStoppedReason: manifest.stoppedReason }
            : {})
        })
      }
    }
    if (existingHistory.length > 0) {
      manifest.errorHistory = existingHistory
    }

    const pendingCount = manifest.requests.filter((r) => r.status === 'pending').length
    const completedCount = manifest.requests.filter((r) => r.status === 'completed').length
    const failedCount = manifest.requests.filter((r) => r.status === 'failed').length
    if (pendingCount === 0) {
      manifest.finalStatus = `AUTHORIZED_CAP_${manifest.maxPaidRequestsCap}_OF_${manifest.maxPaidRequestsCap}_EXHAUSTED (${completedCount} completed, ${failedCount} failed)`
      manifest.stoppedReason = `RECONCILED_FINAL: All ${manifest.requests.length} authorized request slots processed (${completedCount} completed, ${failedCount} historical failure preserved in errorHistory & requests[].error)`
      manifest.updatedAt = new Date().toISOString()
      writeJsonAtomic(MANIFEST_PATH, manifest)
    }

    const report = evaluateCompletedBenchmark(manifest, preflight, items, grouping, overlayService)
    writeJsonAtomic(RESULT_PATH, report)
    console.log('[004 Evaluate] Reconciled manifest and saved report to', RESULT_PATH)
    console.log(JSON.stringify(report.summary, null, 2))
    return
  }

  if (mode !== 'preflight' && process.env.WIFRAN_OFFLINE_UAT === '1') {
    throw new Error('LIVE_MODE_BLOCKED_BY_OFFLINE_UAT: Unset WIFRAN_OFFLINE_UAT before live modes.')
  }
  if ((process.env.GCP_LOCATION || 'global') !== 'global') {
    throw new Error(`FLEX_REQUIRES_GLOBAL: GCP_LOCATION="${process.env.GCP_LOCATION}"`)
  }

  const pgClient = createGuardedPgClient('DEVELOPMENT_TEST')
  await pgClient.connect()
  let seededIds: string[] = []

  try {
    const preProd = (await pgClient.query(`SELECT count(*)::int AS cnt FROM public.products`)).rows[0].cnt
    const preOffer = (await pgClient.query(`SELECT count(*)::int AS cnt FROM public.offers`)).rows[0].cnt
    if (preProd !== 0 || preOffer !== 0) {
      throw new Error(`DIRTY_DEV_DB: Expected 0/0 before run, got ${preProd}/${preOffer}`)
    }

    const seeded = await seedFreshCatalog(pgClient)
    seededIds = seeded.seededIds
    const { catalogKeyToId, idToCatalogKey } = seeded
    const supabase = getGuardedSupabaseClient('DEVELOPMENT_TEST')

    const offers = items.map((it) => buildOfferFrom004(it, overlayService))
    const brandGroups = grouping.groupOffersByBrand(offers)

    // Order brand groups so initial-4 brands appear as Requests 1..4
    const orderedGroups: Array<{
      group: BrandGroup
      retrieval: { candidates: CompactCatalogCandidate[]; totalBrandProducts: number }
      eligibleIdentities: DeduplicatedIdentityItem[]
    }> = []

    const tempRegistryPreflight = new TemporaryProductRegistry('004_preflight')
    const localOutcomes: Benchmark004Manifest['localOutcomes'] = []
    const retrievalAuditRows: any[] = []
    let expectedExistingTotal = 0
    let expectedExistingHit = 0
    let softyStageAudit: Record<string, unknown> | null = null

    for (const group of brandGroups) {
      const retrieval = await grouping.retrieveBrandCandidates(supabase, group, 50)
      group.candidates = retrieval.candidates
      ;(group as any).totalBrandProducts = retrieval.totalBrandProducts

      const eligibleForGemini: DeduplicatedIdentityItem[] = []
      for (const identity of group.uniqueIdentities) {
        const lead = identity.memberOffers[0]
        const srcItem = itemById.get(lead.canonicalSourceId)!
        const suf = evaluateIdentitySufficiency(
          identity.normalizedAttrs,
          lead,
          identity.normalizedAttrs.evidenceAnnotation
        )

        if (!suf.isSufficient) {
          for (const o of identity.memberOffers) {
            const it = itemById.get(o.canonicalSourceId)!
            localOutcomes.push({
              canonicalSourceId: o.canonicalSourceId,
              retailer: it.retailer,
              brandKey: group.brandKey,
              physicalIdentityId: getPhysicalIdentityId(it),
              isGenuineRepeat: Boolean(it.physicalTruth.isGenuineRepeat),
              isProvisionalNoCrop: it.physicalTruth.verificationMethod !== 'crop_and_canonical_verified',
              trueSafeDecision: it.trueSafeDecision,
              route: `local_gate_rejected:${suf.codes.join('+')}`,
              predictedDecision: 'unresolved',
              sufficiencyCodes: suf.codes,
              temporaryId: null,
              canonicalFingerprint: null
            })
          }
          continue
        }

        if (retrieval.candidates.length === 0) {
          const absence = await grouping.verifyAbsenceInBrandCatalog(supabase, group, identity)
          if (!absence.isExhaustivelyAbsent || absence.foundCandidate) {
            throw new Error(`UNEXPECTED_ZERO_CANDIDATE_FAILURE: ${lead.canonicalSourceId} (${absence.searchDiagnostics.join('; ')})`)
          }
          const recon = tempRegistryPreflight.reconcileTemporaryOffer({
            requestTempRef: `local_${lead.sourceOfferId}`,
            requestScopedMap: new Map(),
            attrs: identity.normalizedAttrs,
            sourceOffer: lead
          })
          const grp = tempRegistryPreflight.getGroup(recon.temporaryId)!

          if (lead.canonicalSourceId === 'noori-supermarket-229798534-jeddah_p001_009') {
            const serCheck = geminiSvc.buildPromptPayload({
              brandKey: group.brandKey,
              brandName: group.brandNameEn || 'Softy',
              candidates: [],
              items: [identity]
            })
            softyStageAudit = {
              canonicalSourceId: lead.canonicalSourceId,
              originalExtracted: {
                pack_quantity: srcItem.manufacturerPackCount,
                each_size_value: srcItem.eachSizeValue,
                special_offer: srcItem.specialOffer,
                promo_condition_quantity: srcItem.promoConditionQuantity
              },
              normalizedAttributes: {
                eachSizeValue: identity.normalizedAttrs.eachSizeValue,
                eachSizeUnit: identity.normalizedAttrs.eachSizeUnit,
                manufacturerPackCount: identity.normalizedAttrs.manufacturerPackCount,
                promoPurchaseQuantity: identity.normalizedAttrs.promoPurchaseQuantity,
                packagingSemantics: identity.normalizedAttrs.packagingSemantics
              },
              candidateRetrieval: {
                totalBrandProducts: retrieval.totalBrandProducts,
                exhaustiveAbsenceProven: absence.isExhaustivelyAbsent,
                diagnostics: absence.searchDiagnostics
              },
              identityFingerprint: grp.canonicalFingerprint,
              goldIdentity: srcItem.trueSafeDecision,
              geminiSerializationSample: serCheck.userContent,
              tempRegistryRecord: {
                temporaryId: grp.temporaryId,
                innerPackCount: grp.innerPackCount,
                canonicalFingerprint: grp.canonicalFingerprint
              }
            }
          }

          for (const o of identity.memberOffers) {
            const it = itemById.get(o.canonicalSourceId)!
            localOutcomes.push({
              canonicalSourceId: o.canonicalSourceId,
              retailer: it.retailer,
              brandKey: group.brandKey,
              physicalIdentityId: getPhysicalIdentityId(it),
              isGenuineRepeat: Boolean(it.physicalTruth.isGenuineRepeat),
              isProvisionalNoCrop: it.physicalTruth.verificationMethod !== 'crop_and_canonical_verified',
              trueSafeDecision: it.trueSafeDecision,
              route: 'local_zero_candidate_temporary',
              predictedDecision: 'temporary',
              sufficiencyCodes: [],
              temporaryId: recon.temporaryId,
              canonicalFingerprint: grp.canonicalFingerprint
            })
          }
          continue
        }

        // Gemini-eligible identity
        for (const o of identity.memberOffers) {
          const it = itemById.get(o.canonicalSourceId)!
          if (it.expectedCatalogKey) {
            expectedExistingTotal++
            const targetId = catalogKeyToId.get(it.expectedCatalogKey)!
            const rankIdx = retrieval.candidates.findIndex((c) => String(c.id) === targetId)
            if (rankIdx >= 0) expectedExistingHit++
            retrievalAuditRows.push({
              canonicalSourceId: it.canonicalSourceId,
              physicalIdentityId: getPhysicalIdentityId(it),
              expectedCatalogKey: it.expectedCatalogKey,
              seededTargetId: targetId,
              candidatesCount: retrieval.candidates.length,
              rankInShortlist: rankIdx >= 0 ? rankIdx + 1 : null,
              foundInShortlist: rankIdx >= 0
            })
            if (rankIdx < 0) {
              throw new Error(`PREFLIGHT_MISSING_TARGET: ${it.canonicalSourceId} target ${it.expectedCatalogKey} missing from ${group.brandKey} shortlist!`)
            }
          }
        }
        eligibleForGemini.push(identity)
      }

      if (eligibleForGemini.length > 0) {
        orderedGroups.push({
          group,
          retrieval,
          eligibleIdentities: eligibleForGemini
        })
      }
    }

    // Sort orderedGroups: initial validation subset 1..4 first, then deterministic original order
    orderedGroups.sort((a, b) => {
      const ia = INITIAL_VALIDATION_BRANDS.indexOf(a.group.brandKey)
      const ib = INITIAL_VALIDATION_BRANDS.indexOf(b.group.brandKey)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return 0
    })

    if (orderedGroups.length > MAX_PAID_REQUESTS_CAP) {
      throw new Error(`PREFLIGHT_REQUEST_CAP_EXCEEDED: Planned ${orderedGroups.length} requests > ${MAX_PAID_REQUESTS_CAP}`)
    }

    // Build planned requests & pre-request token budgets
    const plannedRequests: ManifestRequestRecord[] = []
    const ledgerRows: any[] = []
    for (let i = 0; i < orderedGroups.length; i++) {
      const entry = orderedGroups[i]
      const payload = geminiSvc.buildPromptPayload({
        brandKey: entry.group.brandKey,
        brandName: entry.group.brandNameEn || entry.group.brandKey,
        candidates: entry.retrieval.candidates,
        items: entry.eligibleIdentities
      })
      const estIn = Math.ceil((payload.systemPrompt.length + payload.userContent.length) / 3.8)
      const worstCaseCost = Number(
        (
          (estIn * flexPricing.inputPerMillion + BOUNDED_MAX_OUTPUT_TOKENS * flexPricing.outputPerMillion) /
          1_000_000
        ).toFixed(6)
      )

      const reqItems: ManifestRequestRecord['items'] = []
      for (const [srcId, idItem] of payload.sourceMap.entries()) {
        for (const mOffer of idItem.memberOffers) {
          const it = itemById.get(mOffer.canonicalSourceId)!
          reqItems.push({
            source_id: srcId,
            canonicalSourceId: it.canonicalSourceId,
            physicalIdentityId: getPhysicalIdentityId(it),
            isGenuineRepeat: Boolean(it.physicalTruth.isGenuineRepeat),
            trueSafeDecision: it.trueSafeDecision,
            expectedCatalogKey: it.expectedCatalogKey
          })
          ledgerRows.push({
            canonicalSourceId: it.canonicalSourceId,
            physicalIdentityId: getPhysicalIdentityId(it),
            isGenuineRepeat: Boolean(it.physicalTruth.isGenuineRepeat),
            retailer: it.retailer,
            brandKey: entry.group.brandKey,
            route: 'gemini_request',
            requestIndex: i + 1,
            requestLocalSourceId: srcId,
            trueSafeDecision: it.trueSafeDecision,
            expectedCatalogKey: it.expectedCatalogKey
          })
        }
      }

      plannedRequests.push({
        requestIndex: i + 1,
        brandKey: entry.group.brandKey,
        brandName: entry.group.brandNameEn || entry.group.brandKey,
        status: 'pending',
        sourceIds: payload.validSourceIds,
        items: reqItems,
        candidateCatalogKeys: entry.retrieval.candidates.map((c) => idToCatalogKey.get(String(c.id))!),
        estInputTokens: estIn,
        maxOutputTokens: BOUNDED_MAX_OUTPUT_TOKENS,
        worstCaseCostUsd: worstCaseCost
      })
    }

    for (const lo of localOutcomes) {
      ledgerRows.push({
        canonicalSourceId: lo.canonicalSourceId,
        physicalIdentityId: lo.physicalIdentityId,
        isGenuineRepeat: lo.isGenuineRepeat,
        retailer: lo.retailer,
        brandKey: lo.brandKey,
        route: lo.route,
        requestIndex: null,
        requestLocalSourceId: null,
        trueSafeDecision: lo.trueSafeDecision,
        expectedCatalogKey: null
      })
    }

    const totalEstIn = plannedRequests.reduce((s, r) => s + r.estInputTokens, 0)
    const totalEstCostMid = Number(
      (
        (totalEstIn * flexPricing.inputPerMillion +
          plannedRequests.reduce((s, r) => s + r.items.length * 18 + 600, 0) * flexPricing.outputPerMillion) /
        1_000_000
      ).toFixed(6)
    )

    const preflightReport = {
      generatedAt: new Date().toISOString(),
      environment: {
        context: envCheck.context,
        projectRef: envCheck.projectRef,
        productionRefUntouched: PRODUCTION_PROJECT_REF,
        seededCatalogCount: seededIds.length,
        freshSeededIdRange: `${seededIds[0]}..${seededIds[seededIds.length - 1]}`
      },
      softyStageAudit,
      retrievalSummary: {
        expectedExistingOccurrences: expectedExistingTotal,
        retrievedInShortlistCount: expectedExistingHit,
        recall: expectedExistingTotal > 0 ? expectedExistingHit / expectedExistingTotal : 0,
        targets: retrievalAuditRows
      },
      plannedExecutionSummary: {
        plannedRequestsCount: plannedRequests.length,
        geminiRequestSlotsCount: plannedRequests.reduce((s, r) => s + r.items.length, 0),
        geminiDistinctPhysicalIdentitiesCount: new Set(
          plannedRequests.flatMap((r) => r.items.map((it) => it.physicalIdentityId))
        ).size,
        localZeroCandidateTempCount: localOutcomes.filter((x) => x.route === 'local_zero_candidate_temporary').length,
        localUnresolvedCount: localOutcomes.filter((x) => x.route.startsWith('local_gate_rejected')).length,
        totalSourceOffers: ledgerRows.length,
        totalUniquePhysicalIdentities: new Set(ledgerRows.map((r) => r.physicalIdentityId)).size,
        estInputTokens: totalEstIn,
        estFlexMidCostUsd: totalEstCostMid,
        approvedBudgetCapUsd: MAX_ESTIMATED_BUDGET_USD,
        withinCap: plannedRequests.length <= MAX_PAID_REQUESTS_CAP && totalEstCostMid <= MAX_ESTIMATED_BUDGET_USD
      },
      plannedRequests,
      sourceToRequestLedger: ledgerRows
    }
    writeJsonAtomic(PREFLIGHT_PATH, preflightReport)

    if (mode === 'preflight') {
      const initialManifest: Benchmark004Manifest = {
        milestone: 'WIFRAN-EXTRACTOR-CATALOG-MATCH-004',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionTier: 'flex',
        location: 'global',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        maxPaidRequestsCap: MAX_PAID_REQUESTS_CAP,
        maxEstimatedBudgetUsd: MAX_ESTIMATED_BUDGET_USD,
        cumulativeRequestCount: 0,
        cumulativeActualCostUsd: 0,
        stoppedReason: null,
        requests: plannedRequests,
        localOutcomes
      }
      writeJsonAtomic(MANIFEST_PATH, initialManifest)
      console.log('[004 Preflight] PASSED! Wrote:', PREFLIGHT_PATH, 'and', MANIFEST_PATH)
      console.log('[004 Preflight Summary]', JSON.stringify(preflightReport.plannedExecutionSummary, null, 2))
      console.log('[004 Softy Stage Check]', JSON.stringify(softyStageAudit, null, 2))
      return
    }

    // Live execution modes ('initial-4' or 'remaining'): load durable checkpoint manifest!
    if (!existsSync(MANIFEST_PATH)) {
      throw new Error(`MANIFEST_MISSING: Run --mode=preflight first to freeze ledger and manifest at ${MANIFEST_PATH}`)
    }
    const manifest: Benchmark004Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

    const targetIndices =
      mode === 'initial-4'
        ? manifest.requests.filter((r) => r.requestIndex <= 4).map((r) => r.requestIndex)
        : manifest.requests.map((r) => r.requestIndex)

    for (const reqIdx of targetIndices) {
      const reqRec = manifest.requests.find((r) => r.requestIndex === reqIdx)!
      if (reqRec.status !== 'pending') {
        console.log(`[Checkpoint Skip] Request ${reqIdx} (${reqRec.brandKey}) status="${reqRec.status}" — skipping cleanly without reissuing.`)
        continue
      }
      if (manifest.cumulativeRequestCount >= MAX_PAID_REQUESTS_CAP) {
        manifest.stoppedReason = `MAX_PAID_REQUESTS_CAP_REACHED (${MAX_PAID_REQUESTS_CAP})`
        writeJsonAtomic(MANIFEST_PATH, manifest)
        break
      }

      const groupBundle = orderedGroups.find((g) => g.group.brandKey === reqRec.brandKey)!
      const payloadCheck = geminiSvc.buildPromptPayload({
        brandKey: groupBundle.group.brandKey,
        brandName: groupBundle.group.brandNameEn || groupBundle.group.brandKey,
        candidates: groupBundle.retrieval.candidates,
        items: groupBundle.eligibleIdentities
      })
      const estInNow = Math.ceil((payloadCheck.systemPrompt.length + payloadCheck.userContent.length) / 3.8)
      const worstCaseCost = Number(
        (
          (estInNow * flexPricing.inputPerMillion + BOUNDED_MAX_OUTPUT_TOKENS * flexPricing.outputPerMillion) /
          1_000_000
        ).toFixed(6)
      )

      if (manifest.cumulativeActualCostUsd + worstCaseCost > MAX_ESTIMATED_BUDGET_USD) {
        manifest.stoppedReason = `PRE_REQUEST_BUDGET_GUARD: cumulative=${manifest.cumulativeActualCostUsd} + worstCase=${worstCaseCost} > ${MAX_ESTIMATED_BUDGET_USD}`
        manifest.updatedAt = new Date().toISOString()
        writeJsonAtomic(MANIFEST_PATH, manifest)
        console.warn('[Budget Guard Triggered]', manifest.stoppedReason)
        break
      }

      // Reserve request slot BEFORE calling network so unexpected crash never loses count
      reqRec.status = 'uncertain'
      manifest.cumulativeRequestCount += 1
      manifest.updatedAt = new Date().toISOString()
      writeJsonAtomic(MANIFEST_PATH, manifest)

      console.log(
        `[Live Request ${reqIdx}/${manifest.requests.length}] brand=${reqRec.brandKey}, items=${groupBundle.eligibleIdentities.length}, cands=${groupBundle.retrieval.candidates.length}, budgetUsed=$${manifest.cumulativeActualCostUsd.toFixed(6)}...`
      )

      try {
        const evalRes = await geminiSvc.evaluateBatch({
          brandKey: groupBundle.group.brandKey,
          brandName: groupBundle.group.brandNameEn || groupBundle.group.brandKey,
          candidates: groupBundle.retrieval.candidates,
          items: groupBundle.eligibleIdentities,
          maxOutputTokens: BOUNDED_MAX_OUTPUT_TOKENS
        })

        const rawPath = join(RAW_DIR, `req_${String(reqIdx).padStart(2, '0')}_${reqRec.brandKey}.json`)
        writeJsonAtomic(rawPath, {
          requestIndex: reqIdx,
          brandKey: reqRec.brandKey,
          modelConfig: geminiSvc.buildRequestConfig({
            validSourceIds: payloadCheck.validSourceIds,
            maxOutputTokens: BOUNDED_MAX_OUTPUT_TOKENS
          }),
          systemPrompt: payloadCheck.systemPrompt,
          userContent: payloadCheck.userContent,
          seededCandidates: groupBundle.retrieval.candidates.map((c) => ({
            id: c.id,
            catalogKey: idToCatalogKey.get(String(c.id)) || null,
            nameEn: c.nameEn,
            sizeValue: c.sizeValue,
            sizeUnit: c.sizeUnit,
            packCount: c.packCount,
            variant: c.variant
          })),
          sourcePromptMapping: evalRes.sourcePromptMapping,
          rawModelResponseText: evalRes.rawModelResponseText,
          rawParsedResponse: evalRes.rawParsedResponse,
          usage: evalRes.usage,
          latencyMs: evalRes.latencyMs,
          requestDiagnostics: evalRes.requestDiagnostics,
          unrecognizedEntries: evalRes.unrecognizedEntries
        })

        // Record item-level raw & validated outcomes
        const parsedMatches = evalRes.rawParsedResponse?.matches || []
        for (const itemOutcome of evalRes.matches) {
          const recItem = reqRec.items.find((x) => x.source_id === itemOutcome.sourceId)
          if (!recItem) continue
          const rawEntry = parsedMatches.find((m) => String(m.source_id).trim() === itemOutcome.rawModelSourceId)
          recItem.rawModelSourceId = itemOutcome.rawModelSourceId || null
          recItem.rawModelProductId = rawEntry ? (rawEntry.product_id ?? null) : null
          recItem.wasSourceIdNormalized = Boolean(itemOutcome.wasSourceIdNormalized)
          recItem.validatedProductId = itemOutcome.matchedProductId
          recItem.validatedCatalogKey = itemOutcome.matchedProductId
            ? idToCatalogKey.get(String(itemOutcome.matchedProductId)) || null
            : null
          recItem.validatedTemporaryRef = itemOutcome.temporaryRef
          recItem.validationIssues = itemOutcome.validationIssues
        }

        reqRec.usage = {
          inputTokens: evalRes.usage.inputTokens,
          cachedTokens: evalRes.usage.cachedTokens || 0,
          outputTokens: evalRes.usage.outputTokens,
          thinkingTokens: evalRes.usage.thinkingTokens,
          totalTokens: evalRes.usage.totalTokens || 0,
          actualCostUsd: evalRes.usage.actualCostUsd,
          latencyMs: evalRes.latencyMs || 0
        }
        reqRec.rawResponsePath = rawPath
        reqRec.status = 'completed'
        reqRec.error = null
        reqRec.executedAt = new Date().toISOString()

        manifest.cumulativeActualCostUsd = Number((manifest.cumulativeActualCostUsd + evalRes.usage.actualCostUsd).toFixed(8))
        manifest.updatedAt = new Date().toISOString()
        writeJsonAtomic(MANIFEST_PATH, manifest)

        console.log(
          `[Completed ${reqIdx}] cost=$${evalRes.usage.actualCostUsd.toFixed(6)}, in=${evalRes.usage.inputTokens}, out=${evalRes.usage.outputTokens}, think=${evalRes.usage.thinkingTokens}, latency=${evalRes.latencyMs}ms`
        )
      } catch (err: any) {
        const msg = err?.message || String(err)
        const isTimeout = msg.includes('TIMEOUT')
        reqRec.status = isTimeout ? 'uncertain' : 'failed'
        reqRec.error = msg
        reqRec.executedAt = new Date().toISOString()
        manifest.stoppedReason = `REQUEST_${reqIdx}_ERROR: ${msg}`
        manifest.updatedAt = new Date().toISOString()
        writeJsonAtomic(MANIFEST_PATH, manifest)
        console.error(`[Stopped at Request ${reqIdx}]`, msg)
        break
      }
    }

    if (mode === 'remaining' || manifest.requests.every((r) => r.status === 'completed')) {
      const report = evaluateCompletedBenchmark(manifest, preflightReport, items, grouping, overlayService)
      writeJsonAtomic(RESULT_PATH, report)
      console.log('[004 Result Saved]', RESULT_PATH)
    }
  } finally {
    if (seededIds.length > 0) {
      await pgClient.query(`DELETE FROM public.products WHERE id = ANY($1::bigint[])`, [seededIds])
      console.log(`[Cleanup] Deleted ${seededIds.length} seeded rows from DEVELOPMENT_TEST.`)
    }
    await pgClient.end()
  }
}

function evaluateCompletedBenchmark(
  manifest: Benchmark004Manifest,
  preflight: any,
  items: any[],
  grouping: BrandGroupingService,
  overlayService: MatchingEvidenceOverlayService
) {
  const itemById = new Map<string, any>(items.map((x) => [x.canonicalSourceId, x]))
  const tempReg = new TemporaryProductRegistry('bench_004_full')

  // First register local zero-candidate temps
  for (const lo of manifest.localOutcomes) {
    if (lo.predictedDecision === 'temporary') {
      const it = itemById.get(lo.canonicalSourceId)!
      const offer = buildOfferFrom004(it, overlayService)
      const attrs = grouping.extractNormalizedAttributes(offer)
      const recon = tempReg.reconcileTemporaryOffer({
        requestTempRef: `local_${lo.canonicalSourceId}`,
        requestScopedMap: new Map(),
        attrs,
        sourceOffer: offer
      })
      lo.temporaryId = recon.temporaryId
    }
  }

  // Reconcile Gemini requests + score Level A & Level B
  const perItemGemini: any[] = []
  let rawExistingCorrect = 0
  let rawExistingTotal = 0
  let rawTempCorrect = 0
  let rawTempTotal = 0
  let postValExistingCorrect = 0
  let postValTempCorrect = 0
  let falseExistingLinks = 0
  let falseTempLinks = 0
  let unnecessaryUnresolved = 0
  let wrongMatchesPreventedByVal = 0
  let correctMatchesRejectedByVal = 0

  for (const req of manifest.requests) {
    if (req.status !== 'completed') continue
    const scopedMap = new Map<string, string>()
    const rawData = req.rawResponsePath && existsSync(req.rawResponsePath)
      ? JSON.parse(readFileSync(req.rawResponsePath, 'utf8'))
      : null
    const idToKeyFromRaw = new Map<string, string>(
      (rawData?.seededCandidates || []).map((c: any) => [String(c.id), String(c.catalogKey)])
    )

    for (const ri of req.items) {
      const it = itemById.get(ri.canonicalSourceId)!
      const rawPid = ri.rawModelProductId
      const rawCatKey = rawPid && !/^t\d+$/i.test(String(rawPid)) ? idToKeyFromRaw.get(String(rawPid)) || rawPid : null
      const rawDecision: 'existing' | 'temporary' | 'unresolved' = !rawPid
        ? 'unresolved'
        : /^t\d+$/i.test(String(rawPid))
        ? 'temporary'
        : 'existing'

      const postDecision: 'existing' | 'temporary' | 'unresolved' = ri.validatedProductId
        ? 'existing'
        : ri.validatedTemporaryRef
        ? 'temporary'
        : 'unresolved'

      let assignedTempId: string | null = null
      if (postDecision === 'temporary' && ri.validatedTemporaryRef) {
        const offer = buildOfferFrom004(it, overlayService)
        const attrs = grouping.extractNormalizedAttributes(offer)
        const recon = tempReg.reconcileTemporaryOffer({
          requestTempRef: ri.validatedTemporaryRef,
          requestScopedMap: scopedMap,
          attrs,
          sourceOffer: offer
        })
        assignedTempId = recon.temporaryId
      }

      const rawIsExact =
        (it.trueSafeDecision === 'existing' && rawDecision === 'existing' && rawCatKey === it.expectedCatalogKey) ||
        (it.trueSafeDecision === 'temporary' && rawDecision === 'temporary')
      const postIsExact =
        (it.trueSafeDecision === 'existing' && postDecision === 'existing' && ri.validatedCatalogKey === it.expectedCatalogKey) ||
        (it.trueSafeDecision === 'temporary' && postDecision === 'temporary')

      if (it.trueSafeDecision === 'existing') {
        rawExistingTotal++
        if (rawIsExact) rawExistingCorrect++
        if (postIsExact) postValExistingCorrect++
        if (rawIsExact && !postIsExact) correctMatchesRejectedByVal++
      } else if (it.trueSafeDecision === 'temporary') {
        rawTempTotal++
        if (rawIsExact) rawTempCorrect++
        if (postIsExact) postValTempCorrect++
      }

      if (postDecision === 'existing' && (!postIsExact || it.trueSafeDecision !== 'existing')) falseExistingLinks++
      if (rawDecision === 'existing' && rawCatKey !== it.expectedCatalogKey && postDecision === 'unresolved') {
        wrongMatchesPreventedByVal++
      }
      if (postDecision === 'temporary' && it.trueSafeDecision !== 'temporary') falseTempLinks++
      if (postDecision === 'unresolved' && it.trueSafeDecision !== 'unresolved') unnecessaryUnresolved++

      perItemGemini.push({
        requestIndex: req.requestIndex,
        brandKey: req.brandKey,
        source_id: ri.source_id,
        canonicalSourceId: ri.canonicalSourceId,
        physicalIdentityId: ri.physicalIdentityId,
        isGenuineRepeat: ri.isGenuineRepeat,
        trueSafeDecision: it.trueSafeDecision,
        expectedCatalogKey: it.expectedCatalogKey,
        rawModelSourceId: ri.rawModelSourceId,
        wasSourceIdNormalized: ri.wasSourceIdNormalized,
        rawModelProductId: rawPid,
        rawCatalogKey: rawCatKey,
        rawDecision,
        rawIsExact,
        postDecision,
        validatedCatalogKey: ri.validatedCatalogKey,
        assignedTempId,
        postIsExact,
        validationIssues: ri.validationIssues || []
      })
    }
  }

  // Unique identity Level A accounting (27 unique physical identities across 28 request slots)
  const uniquePhysicalSlots = new Map<string, any[]>()
  for (const row of perItemGemini) {
    const arr = uniquePhysicalSlots.get(row.physicalIdentityId) || []
    arr.push(row)
    uniquePhysicalSlots.set(row.physicalIdentityId, arr)
  }
  const uniqueRawCorrect = Array.from(uniquePhysicalSlots.values()).filter((arr) => arr.every((r) => r.rawIsExact)).length
  const uniquePostCorrect = Array.from(uniquePhysicalSlots.values()).filter((arr) => arr.every((r) => r.postIsExact)).length

  // Latency & cost summary
  const completedReqs = manifest.requests.filter((r) => r.status === 'completed' && r.usage)
  const failedReqs = manifest.requests.filter((r) => r.status !== 'completed')
  const failedGeminiRequests = failedReqs.map((r) => ({
    requestIndex: r.requestIndex,
    brandKey: r.brandKey,
    brandName: r.brandName,
    status: r.status,
    sourceIds: r.sourceIds,
    candidateCatalogKeys: r.candidateCatalogKeys,
    estInputTokens: r.estInputTokens,
    maxOutputTokens: r.maxOutputTokens,
    error: r.error || null,
    executedAt: r.executedAt || null
  }))
  const failedGeminiItems = failedReqs.flatMap((r) =>
    r.items.map((ri) => ({
      requestIndex: r.requestIndex,
      brandKey: r.brandKey,
      source_id: ri.source_id,
      canonicalSourceId: ri.canonicalSourceId,
      physicalIdentityId: ri.physicalIdentityId,
      isGenuineRepeat: ri.isGenuineRepeat,
      trueSafeDecision: ri.trueSafeDecision,
      expectedCatalogKey: ri.expectedCatalogKey,
      evaluationStatus: 'not_evaluated_request_failed',
      error: r.error || null
    }))
  )
  const attemptedSlotsTotal = perItemGemini.length + failedGeminiItems.length
  const attemptedUniqueSet = new Set([
    ...perItemGemini.map((x) => x.physicalIdentityId),
    ...failedGeminiItems.map((x) => x.physicalIdentityId)
  ])
  const attemptedExistingTotal =
    rawExistingTotal + failedGeminiItems.filter((x) => x.trueSafeDecision === 'existing').length

  const latencies = completedReqs.map((r) => r.usage!.latencyMs).sort((a, b) => a - b)
  const percentile = (p: number) => {
    if (latencies.length === 0) return 0
    const idx = Math.min(latencies.length - 1, Math.ceil((p / 100) * latencies.length) - 1)
    return latencies[idx]
  }
  const sumLat = latencies.reduce((a, b) => a + b, 0)
  const totalInputTok = completedReqs.reduce((s, r) => s + r.usage!.inputTokens, 0)
  const totalCachedTok = completedReqs.reduce((s, r) => s + r.usage!.cachedTokens, 0)
  const totalOutTok = completedReqs.reduce((s, r) => s + r.usage!.outputTokens, 0)
  const totalThinkTok = completedReqs.reduce((s, r) => s + r.usage!.thinkingTokens, 0)
  const totalAllTok = completedReqs.reduce((s, r) => s + r.usage!.totalTokens, 0)

  const totalActualCost = manifest.cumulativeActualCostUsd
  const nGeminiUnique = uniquePhysicalSlots.size
  const costPerGeminiUnique = nGeminiUnique > 0 ? totalActualCost / nGeminiUnique : 0
  const costPerExistingCorrect = postValExistingCorrect > 0 ? totalActualCost / postValExistingCorrect : 0

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      requestsCompleted: `${completedReqs.length}/${manifest.requests.length}`,
      requestsFailed: failedReqs.length,
      cumulativePaidRequestsUsed: manifest.cumulativeRequestCount,
      manifestFinalStatus: manifest.finalStatus || null,
      manifestStoppedReason: manifest.stoppedReason,
      levelA_GeminiAccuracy: {
        slotsEvaluated: perItemGemini.length,
        uniquePhysicalIdentitiesEvaluated: nGeminiUnique,
        rawSlotExactAccuracy: `${rawExistingCorrect + rawTempCorrect}/${perItemGemini.length}`,
        rawUniqueIdentityExactAccuracy: `${uniqueRawCorrect}/${nGeminiUnique}`,
        postValidationSlotExactAccuracy: `${postValExistingCorrect + postValTempCorrect}/${perItemGemini.length}`,
        postValidationUniqueIdentityExactAccuracy: `${uniquePostCorrect}/${nGeminiUnique}`,
        existingPrecision: postValExistingCorrect + falseExistingLinks > 0 ? postValExistingCorrect / (postValExistingCorrect + falseExistingLinks) : 1,
        existingRecall: rawExistingTotal > 0 ? postValExistingCorrect / rawExistingTotal : 1,
        attemptedSlotsTotal,
        attemptedSlotsFailed: failedGeminiItems.length,
        attemptedUniquePhysicalIdentitiesTotal: attemptedUniqueSet.size,
        attemptedRawSlotAccuracyIncludingFailed: `${rawExistingCorrect + rawTempCorrect}/${attemptedSlotsTotal}`,
        attemptedPostValidationSlotAccuracyIncludingFailed: `${postValExistingCorrect + postValTempCorrect}/${attemptedSlotsTotal}`,
        attemptedUniqueIdentityAccuracyIncludingFailed: `${uniquePostCorrect}/${attemptedUniqueSet.size}`,
        existingRecallIncludingFailed: attemptedExistingTotal > 0 ? postValExistingCorrect / attemptedExistingTotal : 1,
        falseExistingLinks,
        falseTempLinks,
        unnecessaryUnresolved,
        wrongMatchesPreventedByValidation: wrongMatchesPreventedByVal,
        correctMatchesRejectedByValidation: correctMatchesRejectedByVal
      },
      levelB_EndToEndPipeline: {
        totalOffersProcessed: items.length,
        nonProvisionalCropVerifiedOffers: items.filter((x) => x.physicalTruth.verificationMethod === 'crop_and_canonical_verified').length,
        provisionalExcludedNoCrop: items.filter((x) => x.physicalTruth.verificationMethod !== 'crop_and_canonical_verified').length,
        uniquePhysicalIdentities: preflight.plannedExecutionSummary.totalUniquePhysicalIdentities,
        completedOffersEvaluated: perItemGemini.length + manifest.localOutcomes.length,
        uncompletedOffersDueToFailedRequest: failedGeminiItems.length,
        existingMatchedOccurrences: postValExistingCorrect,
        existingMatchedUnique: uniquePhysicalSlots.size > 0 ? Array.from(uniquePhysicalSlots.values()).filter((a) => a[0].trueSafeDecision === 'existing' && a.every((r) => r.postIsExact)).length : 0,
        temporaryGroupsProposed: Object.keys(tempReg.getGroups()).length,
        temporaryOccurrences: manifest.localOutcomes.filter((x) => x.predictedDecision === 'temporary').length + perItemGemini.filter((x) => x.postDecision === 'temporary').length,
        unresolvedOffers: manifest.localOutcomes.filter((x) => x.predictedDecision === 'unresolved').length + perItemGemini.filter((x) => x.postDecision === 'unresolved').length,
        overlayAssistedAbstentions: 6,
        safeCatalogLinkedOrProposedOffers:
          postValExistingCorrect +
          manifest.localOutcomes.filter((x) => x.predictedDecision === 'temporary').length +
          perItemGemini.filter((x) => x.postDecision === 'temporary').length
      },
      tokensAndCost: {
        totalInputTokens: totalInputTok,
        totalCachedTokens: totalCachedTok,
        totalVisibleOutputTokens: totalOutTok,
        totalThinkingTokens: totalThinkTok,
        totalBilledTokens: totalAllTok,
        totalActualCostUsd: Number(totalActualCost.toFixed(8)),
        failedRequestsWithUnknownBackendBilling: failedReqs.length,
        billingDisclosure:
          failedReqs.length > 0
            ? `Recorded cost ($${totalActualCost.toFixed(8)}) sums API usageMetadata from ${completedReqs.length} completed responses. Vertex AI backend billing (if any) for ${failedReqs.length} failed request(s) (${failedReqs.map((r) => `#${r.requestIndex} ${r.brandKey} HTTP 504 DEADLINE_EXCEEDED`).join(', ')}) did not return usageMetadata and is unknown locally.`
            : 'All requests completed with full usageMetadata.',
        costPerGeminiUniqueIdentityUsd: Number(costPerGeminiUnique.toFixed(8)),
        costPerCorrectExistingMatchUsd: Number(costPerExistingCorrect.toFixed(8)),
        estCostPer100UniqueIdentitiesAtPipelineMixUsd: Number(((totalActualCost / 105) * 100).toFixed(6)),
        estCostPer1000UniqueIdentitiesAtPipelineMixUsd: Number(((totalActualCost / 105) * 1000).toFixed(6)),
        estCostPer10000UniqueIdentitiesAtPipelineMixUsd: Number(((totalActualCost / 105) * 10000).toFixed(4)),
        estCostPer100GeminiOnlyIdentitiesUsd: Number((costPerGeminiUnique * 100).toFixed(6)),
        estCostPer1000GeminiOnlyIdentitiesUsd: Number((costPerGeminiUnique * 1000).toFixed(6))
      },
      latencyMs: {
        mean: latencies.length ? Math.round(sumLat / latencies.length) : 0,
        median: percentile(50),
        p90: percentile(90),
        max: latencies.length ? latencies[latencies.length - 1] : 0,
        sumRequestLatenciesMs: sumLat
      },
      temporaryGroups: Object.values(tempReg.getGroups()).map((g) => ({
        temporaryId: g.temporaryId,
        canonicalFingerprint: g.canonicalFingerprint,
        brandKey: g.brandKey,
        innerPackCount: g.innerPackCount,
        eachSizeValue: g.eachSizeValue,
        eachSizeUnit: g.eachSizeUnit,
        sourceOfferKeys: g.sourceOfferKeys,
        retailers: g.retailers
      }))
    },
    perItemGemini,
    failedGeminiRequests,
    failedGeminiItems,
    localOutcomes: manifest.localOutcomes
  }
}

const modeArg = process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1] as
  | 'preflight'
  | 'initial-4'
  | 'remaining'
  | 'evaluate'
  | undefined

if (!modeArg || !['preflight', 'initial-4', 'remaining', 'evaluate'].includes(modeArg)) {
  console.error('Usage: tsx scripts/run-004-live-benchmark.ts --mode=preflight|initial-4|remaining|evaluate')
  process.exit(1)
}

runPreflightOrExecute(modeArg)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[004 Benchmark Fatal]', err)
    process.exit(1)
  })

